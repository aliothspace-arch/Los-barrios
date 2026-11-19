import type {
  ColliderAABB,
  ControlInput,
  PedState,
  PlayerState,
  VehicleState,
  WeatherType,
} from './types';
import {
  TRAFFIC_LOOPS,
  VEHICLE_SPECS,
  WORLD_HALF_SIZE,
} from './worldLayout';
import {
  SpatialHashGrid,
  type StaticColliderSource,
} from './simulation/spatialHash';

// Reusable scratch array to keep broad-phase SpatialHashGrid queries zero-allocation per frame
const _colliderQueryScratch: ColliderAABB[] = [];

function getCandidateColliders(
  source: StaticColliderSource,
  x: number,
  z: number,
  radius: number,
): readonly ColliderAABB[] {
  if (source instanceof SpatialHashGrid) {
    return source.queryCircle(x, z, radius, _colliderQueryScratch);
  }
  return source;
}

function hasAnyColliders(source: StaticColliderSource): boolean {
  return source instanceof SpatialHashGrid ? source.colliderCount > 0 : source.length > 0;
}

export interface CollisionImpact {
  hit: boolean;
  normalX: number;
  normalZ: number;
  impulseSpeed: number;
  colliderId: string;
}

export interface VehicleStepResult {
  impact: CollisionImpact;
  skidIntensity: number; // 0..1 for tire smoke & screech
}

export function getWeatherGripMultiplier(weather: WeatherType): number {
  switch (weather) {
    case 'golden':
    case 'clear':
      return 1.0;
    case 'fog':
      return 0.94;
    case 'rain':
      return 0.68;
    case 'storm':
      return 0.52;
  }
}

export function normalizeAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

export function dampValue(
  current: number,
  target: number,
  lambda: number,
  dt: number,
): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export function resolveCircleVsAABBs(
  x: number,
  z: number,
  vx: number,
  vz: number,
  radius: number,
  colliders: StaticColliderSource,
  restitution = 0.22,
): { x: number; z: number; vx: number; vz: number; impact: CollisionImpact } {
  let cx = x;
  let cz = z;
  let nvx = vx;
  let nvz = vz;
  const impact: CollisionImpact = {
    hit: false,
    normalX: 0,
    normalZ: 0,
    impulseSpeed: 0,
    colliderId: '',
  };

  for (let iter = 0; iter < 2; iter++) {
    const candidates = getCandidateColliders(colliders, cx, cz, radius + 0.25);
    for (let i = 0; i < candidates.length; i++) {
      const box = candidates[i];
      const closestX = Math.max(box.minX, Math.min(cx, box.maxX));
      const closestZ = Math.max(box.minZ, Math.min(cz, box.maxZ));
      const dx = cx - closestX;
      const dz = cz - closestZ;
      const distSq = dx * dx + dz * dz;

      if (distSq < radius * radius) {
        let nx = 0;
        let nz = 0;
        let pen = 0;

        if (distSq > 1e-8) {
          const dist = Math.sqrt(distSq);
          nx = dx / dist;
          nz = dz / dist;
          pen = radius - dist;
        } else {
          // Circle center is inside the AABB — push out along shallowest axis
          const left = cx - box.minX;
          const right = box.maxX - cx;
          const top = cz - box.minZ;
          const bottom = box.maxZ - cz;
          const m = Math.min(left, right, top, bottom);
          if (m === left) {
            nx = -1;
            pen = left + radius;
          } else if (m === right) {
            nx = 1;
            pen = right + radius;
          } else if (m === top) {
            nz = -1;
            pen = top + radius;
          } else {
            nz = 1;
            pen = bottom + radius;
          }
        }

        cx += nx * pen;
        cz += nz * pen;

        const vn = nvx * nx + nvz * nz;
        if (vn < 0) {
          const impulse = -vn;
          if (impulse > impact.impulseSpeed) {
            impact.hit = true;
            impact.normalX = nx;
            impact.normalZ = nz;
            impact.impulseSpeed = impulse;
            impact.colliderId = box.id;
          }
          // Slide with friction + subtle elastic bounce
          const bounce = -(1 + restitution) * vn;
          nvx += nx * bounce;
          nvz += nz * bounce;
          // Tangential wall scrape friction
          const tx = -nz;
          const tz = nx;
          const vt = nvx * tx + nvz * tz;
          nvx -= tx * vt * 0.12;
          nvz -= tz * vt * 0.12;
        }
      }
    }
  }

  // Soft city boundary containment
  const limit = WORLD_HALF_SIZE - radius;
  if (cx < -limit) {
    cx = -limit;
    if (nvx < 0) nvx = -nvx * 0.25;
  } else if (cx > limit) {
    cx = limit;
    if (nvx > 0) nvx = -nvx * 0.25;
  }
  if (cz < -limit) {
    cz = -limit;
    if (nvz < 0) nvz = -nvz * 0.25;
  } else if (cz > limit) {
    cz = limit;
    if (nvz > 0) nvz = -nvz * 0.25;
  }

  return { x: cx, z: cz, vx: nvx, vz: nvz, impact };
}

export function stepVehiclePhysics(
  v: VehicleState,
  input: {
    throttle: number;
    brake: number;
    steer: number; // -1 (right) to +1 (left)
    handbrake: boolean;
    nitro: boolean;
  },
  weather: WeatherType,
  colliders: StaticColliderSource,
  dt: number,
): VehicleStepResult {
  const spec = v.spec;
  const gripMult = getWeatherGripMultiplier(weather);

  // Forward unit vector: heading = 0 -> (0, 1), heading = Math.PI -> (0, -1)
  const fx = Math.sin(v.heading);
  const fz = Math.cos(v.heading);
  // Right unit vector (90° clockwise from forward in XZ)
  const rx = Math.cos(v.heading);
  const rz = -Math.sin(v.heading);

  let vForward = v.vx * fx + v.vz * fz;
  let vLateral = v.vx * rx + v.vz * rz;

  // Steering curve narrows gently at high speed for realistic stability
  const speedRatio = Math.min(1, Math.abs(vForward) / spec.maxSpeed);
  const effectiveMaxSteer = spec.maxSteerAngle * (1 - 0.42 * speedRatio);
  const targetSteer = input.steer * effectiveMaxSteer;
  v.steerAngle = dampValue(v.steerAngle, targetSteer, spec.steerRate * 2.4, dt);

  // Nitro boost management
  const canNitro = input.nitro && v.nitro > 2 && input.throttle > 0.1;
  v.nitroActive = canNitro;
  if (canNitro) {
    v.nitro = Math.max(0, v.nitro - 28 * dt);
  } else {
    v.nitro = Math.min(100, v.nitro + 5.5 * dt);
  }

  // Longitudinal engine / braking forces
  let accelLong = 0;
  v.braking = false;

  if (input.throttle > 0.02) {
    const nitroBoost = canNitro ? 1.55 : 1.0;
    const torqueCurve = 1.0 - 0.35 * speedRatio;
    accelLong += input.throttle * spec.maxEngineForce * nitroBoost * torqueCurve;
  }

  if (input.brake > 0.02) {
    if (vForward > 1.2) {
      // Service braking
      accelLong -= input.brake * spec.maxBrakeForce * (0.7 + 0.3 * gripMult);
      v.braking = true;
    } else {
      // Reverse gear engagement
      accelLong -= input.brake * spec.maxEngineForce * 0.58;
      v.braking = true;
    }
  }

  if (input.handbrake) {
    v.braking = true;
    const hbDecel = Math.sign(vForward) * spec.maxBrakeForce * 0.52 * gripMult;
    if (Math.abs(vForward) > Math.abs(hbDecel * dt)) {
      accelLong -= hbDecel;
    } else {
      vForward = 0;
    }
  }

  // Aerodynamic drag + rolling resistance
  const aeroDrag = -vForward * Math.abs(vForward) * spec.dragCoeff;
  const rollingResist =
    Math.abs(vForward) > 0.05 ? -Math.sign(vForward) * 1.45 : -vForward * 6.0;
  const totalLongAccel = accelLong + aeroDrag + rollingResist;

  vForward += totalLongAccel * dt;

  const topSpeed = canNitro ? spec.maxSpeed * 1.26 : spec.maxSpeed;
  if (vForward > topSpeed) vForward = dampValue(vForward, topSpeed, 4.0, dt);
  if (vForward < -spec.reverseSpeed) vForward = -spec.reverseSpeed;

  // Yaw dynamics (bicycle model with slip angle & handbrake oversteer)
  const wheelbase = spec.length * 0.62;
  const moveSign = vForward >= -0.05 ? 1 : -1;
  const absSpeed = Math.abs(vForward);

  const yawFactor =
    absSpeed > 0.25 ? (vForward / wheelbase) * Math.tan(v.steerAngle) : 0;
  const driftOversteer =
    input.handbrake && absSpeed > 5.0
      ? input.steer * moveSign * 1.55 * (1.15 - 0.3 * gripMult)
      : 0;

  const targetYawRate = yawFactor + driftOversteer;
  v.angularVel = dampValue(
    v.angularVel,
    targetYawRate,
    input.handbrake ? 5.2 : 9.5,
    dt,
  );
  v.heading = normalizeAngle(v.heading + v.angularVel * dt);

  // Recompute forward/right basis after heading update
  const nfx = Math.sin(v.heading);
  const nfz = Math.cos(v.heading);
  const nrx = Math.cos(v.heading);
  const nrz = -Math.sin(v.heading);

  // Pacejka-inspired lateral tire friction (sliding vs gripping)
  const baseLatGrip = input.handbrake ? spec.driftGrip : spec.lateralGrip;
  const effectiveLatGrip = baseLatGrip * gripMult;
  // Centrifugal drift kick when cornering hard on wet road or handbrake
  const cornerLateralKick = -v.angularVel * vForward * (input.handbrake ? 0.34 : 0.14);
  vLateral += cornerLateralKick * dt;
  vLateral *= Math.exp(-effectiveLatGrip * dt);

  // Reconstruct world velocity
  v.vx = nfx * vForward + nrx * vLateral;
  v.vz = nfz * vForward + nrz * vLateral;

  // Integrate position and resolve collisions against buildings & trees
  const nextX = v.x + v.vx * dt;
  const nextZ = v.z + v.vz * dt;
  const resolved = resolveCircleVsAABBs(
    nextX,
    nextZ,
    v.vx,
    v.vz,
    spec.radius,
    colliders,
    0.26,
  );
  v.x = resolved.x;
  v.z = resolved.z;
  v.vx = resolved.vx;
  v.vz = resolved.vz;

  // Re-project speed & lateral speed post-collision
  v.speed = v.vx * nfx + v.vz * nfz;
  v.lateralSpeed = v.vx * nrx + v.vz * nrz;

  // Weight transfer suspension pitch & body roll (spring-damped)
  const targetPitch = Math.max(-0.07, Math.min(0.07, -totalLongAccel * 0.0022));
  const latAccel = v.angularVel * v.speed;
  const targetRoll = Math.max(-0.11, Math.min(0.11, latAccel * 0.0068));
  v.pitch = dampValue(v.pitch, targetPitch, 9.0, dt);
  v.roll = dampValue(v.roll, targetRoll, 8.5, dt);

  // Wheel rotation
  v.wheelSpin += (v.speed / 0.37) * dt;

  // Automatic 5-speed transmission & RPM simulation
  const speedKmh = Math.abs(v.speed) * 3.6;
  if (v.speed < -0.5) {
    v.gear = -1;
    v.rpm = Math.min(6200, 1200 + speedKmh * 95);
  } else {
    const thresholds = [0, 32, 62, 95, 132, 220];
    let g = 1;
    for (let i = 1; i <= 5; i++) {
      if (speedKmh >= thresholds[i - 1]) g = i;
    }
    v.gear = g;
    const gearMin = thresholds[g - 1];
    const gearMax = thresholds[g];
    const gearFrac = Math.max(0, Math.min(1, (speedKmh - gearMin) / (gearMax - gearMin)));
    const targetRpm = 950 + gearFrac * 5600 + (input.throttle > 0.1 ? 650 : 0) + (canNitro ? 700 : 0);
    v.rpm = dampValue(v.rpm, Math.min(7600, targetRpm), 10, dt);
  }

  // Tire skid & drift intensity
  const skidIntensity = Math.min(
    1,
    Math.max(
      0,
      (Math.abs(v.lateralSpeed) - 2.4) / 7.5 +
        (input.handbrake && absSpeed > 4.5 ? 0.55 : 0),
    ),
  );
  v.drifting = skidIntensity > 0.28;

  if (resolved.impact.hit && resolved.impact.impulseSpeed > 6.0) {
    const dmg = Math.min(30, (resolved.impact.impulseSpeed - 5.5) * 1.65);
    v.health = Math.max(0, v.health - dmg);
    v.damageFlash = 0.18;
  }
  if (v.damageFlash > 0) {
    v.damageFlash = Math.max(0, v.damageFlash - dt);
  }

  return { impact: resolved.impact, skidIntensity };
}

export function resolveVehicleVsVehicle(
  a: VehicleState,
  b: VehicleState,
): { collided: boolean; impactSpeed: number; contactX: number; contactZ: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const minDist = a.spec.radius + b.spec.radius;
  const distSq = dx * dx + dz * dz;

  if (distSq >= minDist * minDist || distSq < 1e-8) {
    return { collided: false, impactSpeed: 0, contactX: 0, contactZ: 0 };
  }

  const dist = Math.sqrt(distSq);
  const nx = dx / dist;
  const nz = dz / dist;
  const overlap = minDist - dist;

  const totalMass = a.spec.mass + b.spec.mass;
  const ratioA = b.spec.mass / totalMass;
  const ratioB = a.spec.mass / totalMass;

  // Separate positions proportional to inverse mass
  a.x -= nx * overlap * ratioA;
  a.z -= nz * overlap * ratioA;
  b.x += nx * overlap * ratioB;
  b.z += nz * overlap * ratioB;

  // Relative velocity along collision normal
  const rvx = b.vx - a.vx;
  const rvz = b.vz - a.vz;
  const velAlongNormal = rvx * nx + rvz * nz;

  if (velAlongNormal > 0) {
    return {
      collided: true,
      impactSpeed: 0,
      contactX: a.x + nx * a.spec.radius,
      contactZ: a.z + nz * a.spec.radius,
    };
  }

  const restitution = 0.34;
  const j = (-(1 + restitution) * velAlongNormal) / (1 / a.spec.mass + 1 / b.spec.mass);
  const impX = j * nx;
  const impZ = j * nz;

  a.vx -= impX / a.spec.mass;
  a.vz -= impZ / a.spec.mass;
  b.vx += impX / b.spec.mass;
  b.vz += impZ / b.spec.mass;

  const impactSpeed = Math.abs(velAlongNormal);
  if (impactSpeed > 5.0) {
    const dmgA = Math.min(24, (impactSpeed - 4.5) * 1.4 * ratioA * 2);
    const dmgB = Math.min(24, (impactSpeed - 4.5) * 1.4 * ratioB * 2);
    a.health = Math.max(0, a.health - dmgA);
    b.health = Math.max(0, b.health - dmgB);
    a.damageFlash = 0.16;
    b.damageFlash = 0.16;
  }

  return {
    collided: true,
    impactSpeed,
    contactX: a.x + nx * a.spec.radius,
    contactZ: a.z + nz * a.spec.radius,
  };
}

export function stepPlayerOnFoot(
  player: PlayerState,
  input: ControlInput,
  cameraYaw: number,
  colliders: StaticColliderSource,
  vehicles: VehicleState[],
  dt: number,
): { jumped: boolean; landed: boolean } {
  let jumped = false;
  let landed = false;

  // Movement vector relative to camera yaw
  const moveForward = input.forward - input.backward;
  const moveRight = input.right - input.left;
  const inputMag = Math.hypot(moveForward, moveRight);

  // Camera forward on XZ plane when camera orbits behind at yaw
  const camFwdX = -Math.sin(cameraYaw);
  const camFwdZ = -Math.cos(cameraYaw);
  const camRightX = Math.cos(cameraYaw);
  const camRightZ = -Math.sin(cameraYaw);

  let wishX = camFwdX * moveForward + camRightX * moveRight;
  let wishZ = camFwdZ * moveForward + camRightZ * moveRight;
  const wishLen = Math.hypot(wishX, wishZ);
  if (wishLen > 1e-4) {
    wishX /= wishLen;
    wishZ /= wishLen;
  }

  player.sprinting = input.sprintOrNitro && inputMag > 0.1;
  const maxSpeed = player.sprinting ? 8.2 : 4.6;
  const clampedMag = Math.min(1, inputMag);
  const targetVx = wishX * maxSpeed * clampedMag;
  const targetVz = wishZ * maxSpeed * clampedMag;

  const accelRate = player.grounded ? 14.0 : 5.0;
  player.vx = dampValue(player.vx, targetVx, accelRate, dt);
  player.vz = dampValue(player.vz, targetVz, accelRate, dt);

  if (wishLen > 0.08) {
    const targetHeading = Math.atan2(wishX, wishZ);
    const diff = normalizeAngle(targetHeading - player.heading);
    player.heading = normalizeAngle(player.heading + diff * (1 - Math.exp(-12 * dt)));
  }

  // Coyote time + Jump input buffer
  if (player.grounded) {
    player.coyoteTimer = 0.11;
  } else {
    player.coyoteTimer = Math.max(0, player.coyoteTimer - dt);
  }

  if (input.jumpOrAction) {
    player.jumpBufferTimer = 0.12;
  } else {
    player.jumpBufferTimer = Math.max(0, player.jumpBufferTimer - dt);
  }

  if (player.jumpBufferTimer > 0 && player.coyoteTimer > 0) {
    player.vy = 6.9;
    player.grounded = false;
    player.coyoteTimer = 0;
    player.jumpBufferTimer = 0;
    jumped = true;
  }

  // Gravity
  player.vy -= 19.5 * dt;
  player.y += player.vy * dt;
  if (player.y <= 0) {
    if (!player.grounded && player.vy < -2.5) {
      landed = true;
    }
    player.y = 0;
    player.vy = 0;
    player.grounded = true;
  }

  // Horizontal integration + building/tree AABB sliding
  const res = resolveCircleVsAABBs(
    player.x + player.vx * dt,
    player.z + player.vz * dt,
    player.vx,
    player.vz,
    0.45,
    colliders,
    0.0,
  );
  player.x = res.x;
  player.z = res.z;
  player.vx = res.vx;
  player.vz = res.vz;

  // Push out of solid parked/moving vehicles
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    const dx = player.x - v.x;
    const dz = player.z - v.z;
    const minDist = v.spec.radius + 0.48;
    const dSq = dx * dx + dz * dz;
    if (dSq < minDist * minDist && dSq > 1e-6) {
      const d = Math.sqrt(dSq);
      const nx = dx / d;
      const nz = dz / d;
      player.x = v.x + nx * minDist;
      player.z = v.z + nz * minDist;
    }
  }

  // Distance-synced gait cycle (never skates!)
  const horizSpeed = Math.hypot(player.vx, player.vz);
  if (player.grounded && horizSpeed > 0.15) {
    player.walkCycle += horizSpeed * dt * 2.15;
  }

  if (player.attackTimer > 0) player.attackTimer = Math.max(0, player.attackTimer - dt);
  if (player.damageFlash > 0) player.damageFlash = Math.max(0, player.damageFlash - dt);

  return { jumped, landed };
}

export function findNearestEnterableVehicle(
  px: number,
  pz: number,
  vehicles: VehicleState[],
  maxRange = 4.6,
): VehicleState | null {
  let best: VehicleState | null = null;
  let bestDist = maxRange;
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    const d = Math.hypot(v.x - px, v.z - pz);
    if (d < bestDist) {
      bestDist = d;
      best = v;
    }
  }
  return best;
}

function probePointBlocked(
  x: number,
  z: number,
  margin: number,
  colliders: StaticColliderSource,
): boolean {
  const candidates = getCandidateColliders(colliders, x, z, margin + 0.1);
  for (let i = 0; i < candidates.length; i++) {
    const b = candidates[i];
    if (
      x >= b.minX - margin &&
      x <= b.maxX + margin &&
      z >= b.minZ - margin &&
      z <= b.maxZ + margin
    ) {
      return true;
    }
  }
  return false;
}

export function computeVehicleAIControls(
  v: VehicleState,
  targetX: number,
  targetZ: number,
  wantedLevel: number,
  playerX: number,
  playerZ: number,
  allVehicles: VehicleState[],
  dt: number,
  colliders: StaticColliderSource = [],
): { throttle: number; brake: number; steer: number; handbrake: boolean; nitro: boolean } {
  const isPursuingPolice = v.driver === 'police' && wantedLevel > 0;
  v.sirenOn = isPursuingPolice;

  let goalX = targetX;
  let goalZ = targetZ;
  let approachingCorner = false;

  if (isPursuingPolice) {
    const distToPlayer = Math.hypot(playerX - v.x, playerZ - v.z);
    if (distToPlayer > 9) {
      goalX = playerX;
      goalZ = playerZ;
    } else {
      goalX = playerX + Math.cos(v.heading) * 2.5;
      goalZ = playerZ - Math.sin(v.heading) * 2.5;
    }
  } else {
    const loop = TRAFFIC_LOOPS[v.routeLoop % TRAFFIC_LOOPS.length];
    const wp = loop[v.waypointIndex % loop.length];
    const nextWp = loop[(v.waypointIndex + 1) % loop.length];
    goalX = wp.x;
    goalZ = wp.z;

    const distToWp = Math.hypot(goalX - v.x, goalZ - v.z);
    // Advance waypoint smoothly at 5.2m radius so car stays tightly centered in intersection
    if (distToWp < 5.2) {
      v.waypointIndex = (v.waypointIndex + 1) % loop.length;
      goalX = nextWp.x;
      goalZ = nextWp.z;
    } else if (distToWp < 16.5) {
      // Check if upcoming waypoint requires a 90° turn so we brake early like a real driver!
      const seg1Angle = Math.atan2(wp.x - v.x, wp.z - v.z);
      const seg2Angle = Math.atan2(nextWp.x - wp.x, nextWp.z - wp.z);
      if (Math.abs(normalizeAngle(seg2Angle - seg1Angle)) > 0.55) {
        approachingCorner = true;
      }
    }
  }

  const dx = goalX - v.x;
  const dz = goalZ - v.z;
  const desiredAngle = Math.atan2(dx, dz);
  const angleErr = normalizeAngle(desiredAngle - v.heading);

  // Detect if stuck against obstacle
  if (Math.abs(v.speed) < 0.6) {
    v.aiStuckTimer += dt;
  } else {
    v.aiStuckTimer = Math.max(0, v.aiStuckTimer - dt * 2.5);
  }

  if (v.aiStuckTimer > 1.6) {
    if (v.aiStuckTimer > 2.9) v.aiStuckTimer = 0;
    return {
      throttle: 0,
      brake: 0.8,
      steer: angleErr >= 0 ? -0.95 : 0.95,
      handbrake: false,
      nitro: false,
    };
  }

  const fx = Math.sin(v.heading);
  const fz = Math.cos(v.heading);
  // In Y-up world where heading=0 is +Z and +heading turns CCW (left):
  // Left unit vector = (+cos(h), -sin(h)), Right unit vector = (-cos(h), +sin(h))
  const leftX = Math.cos(v.heading);
  const leftZ = -Math.sin(v.heading);

  // Building / Tree Avoidance Whisker Feelers (prevents ANY AI car from driving into walls or palms!)
  let avoidSteer = 0;
  let wallAhead = false;
  if (hasAnyColliders(colliders)) {
    const lookDist = Math.max(5.0, Math.min(9.5, Math.abs(v.speed) * 0.6 + 3.5));
    const margin = v.spec.radius + 0.12;
    const hitCenter = probePointBlocked(v.x + fx * lookDist, v.z + fz * lookDist, margin, colliders);
    const hitLeft = probePointBlocked(
      v.x + (fx * 0.92 + leftX * 0.25) * lookDist,
      v.z + (fz * 0.92 + leftZ * 0.25) * lookDist,
      margin,
      colliders,
    );
    const hitRight = probePointBlocked(
      v.x + (fx * 0.92 - leftX * 0.25) * lookDist,
      v.z + (fz * 0.92 - leftZ * 0.25) * lookDist,
      margin,
      colliders,
    );

    if (hitLeft && !hitRight) {
      avoidSteer = -0.75; // Obstacle on left -> steer right (-steer)
    } else if (hitRight && !hitLeft) {
      avoidSteer = 0.75; // Obstacle on right -> steer left (+steer)
    } else if (hitCenter) {
      wallAhead = true;
      avoidSteer = angleErr >= 0 ? 0.95 : -0.95;
    }
  }

  // Civilian cars brake smoothly if player or another vehicle is right ahead
  let obstacleAhead = false;
  if (!isPursuingPolice) {
    const pdx = playerX - v.x;
    const pdz = playerZ - v.z;
    const pFwd = pdx * fx + pdz * fz;
    const pSide = Math.abs(pdx * fz - pdz * fx);
    if (pFwd > 0 && pFwd < 11.5 && pSide < 3.0) {
      obstacleAhead = true;
    }
    for (let i = 0; i < allVehicles.length; i++) {
      const other = allVehicles[i];
      if (other.id === v.id) continue;
      const odx = other.x - v.x;
      const odz = other.z - v.z;
      const oFwd = odx * fx + odz * fz;
      const oSide = Math.abs(odx * fz - odz * fx);
      if (oFwd > 0 && oFwd < 12.5 && oSide < 3.0) {
        obstacleAhead = true;
        break;
      }
    }
  }

  const baseSteer = Math.max(-1, Math.min(1, angleErr * 1.95));
  const steer = Math.max(-1, Math.min(1, avoidSteer !== 0 ? avoidSteer : baseSteer));
  const sharpTurn = Math.abs(angleErr) > 0.42 || approachingCorner;
  const desiredSpeed = isPursuingPolice
    ? wallAhead
      ? 6.0
      : Math.min(v.spec.maxSpeed * (0.64 + wantedLevel * 0.06), 31)
    : wallAhead
      ? 4.0
      : sharpTurn
        ? 7.2
        : 13.5;

  if (obstacleAhead) {
    return { throttle: 0, brake: 0.92, steer, handbrake: false, nitro: false };
  }

  const throttle = v.speed < desiredSpeed ? (isPursuingPolice ? 0.9 : 0.56) : 0.06;
  const brake = v.speed > desiredSpeed + 2.2 ? 0.65 : 0;

  return {
    throttle,
    brake,
    steer,
    handbrake: false,
    nitro: false,
  };
}

export function stepPedestrianAI(
  ped: PedState,
  playerX: number,
  playerZ: number,
  playerInCar: boolean,
  playerSpeed: number,
  colliders: StaticColliderSource,
  dt: number,
  wantedLevel = 0,
  simTimeSec = 0,
): { dealtDamageToPlayer: number } {
  let dealtDamageToPlayer = 0;

  if (ped.hitFlash > 0) ped.hitFlash = Math.max(0, ped.hitFlash - dt);

  if (ped.state === 'ko') {
    ped.koTimer += dt;
    ped.vx *= Math.exp(-6 * dt);
    ped.vz *= Math.exp(-6 * dt);
    ped.x += ped.vx * dt;
    ped.z += ped.vz * dt;
    if (ped.koTimer > 8.0) {
      // Recover far from action
      ped.state = 'walk';
      ped.health = 100;
      ped.koTimer = 0;
    }
    return { dealtDamageToPlayer: 0 };
  }

  const dxPlayer = playerX - ped.x;
  const dzPlayer = playerZ - ped.z;
  const distPlayer = Math.hypot(dxPlayer, dzPlayer);

  // Distinct policies:
  // 1) Civilian: flees fast cars or nearby chaos, otherwise patrols sidewalk
  // 2) Ballas rival: confronts player on foot in East Los Santos with a visible 0.55s windup telegraph
  // 3) LSPD Foot Officer: patrols near Precinct, pursues & attacks when wantedLevel >= 1
  // 4) Store Clerk: stays stationed near their shop storefront
  // 5) Grove ally: stands guard / patrols Grove Street proudly
  const isHostile =
    ped.role === 'ballas' || (ped.role === 'police_foot' && wantedLevel >= 1);

  if (playerInCar && playerSpeed > 8.5 && distPlayer < 9.5) {
    ped.state = 'flee';
    ped.stateTimer = 2.5;
  } else if (isHostile && !playerInCar && distPlayer < (ped.role === 'police_foot' ? 24 : 16)) {
    if (ped.state !== 'windup') {
      if (distPlayer < 2.2) {
        ped.state = 'windup';
        ped.stateTimer = 0.55; // Visible windup telegraph before strike
      } else {
        ped.state = 'chase';
      }
    }
  } else if (ped.state === 'chase' && (distPlayer > 26 || playerInCar || !isHostile)) {
    ped.state = 'walk';
  }

  let speed =
    ped.role === 'clerk'
      ? 0.65
      : ped.activity === 'jog'
        ? 3.15
        : 1.65;
  let goalX = ped.targetX;
  let goalZ = ped.targetZ;

  if (ped.state === 'flee') {
    speed = 5.4;
    const inv = 1 / Math.max(0.01, distPlayer);
    goalX = ped.x - dxPlayer * inv * 12;
    goalZ = ped.z - dzPlayer * inv * 12;
    ped.stateTimer -= dt;
    if (ped.stateTimer <= 0) ped.state = 'walk';
  } else if (ped.state === 'chase') {
    speed = ped.role === 'police_foot' ? 4.35 : 3.9;
    goalX = playerX;
    goalZ = playerZ;
  } else if (ped.state === 'windup') {
    speed = 0;
    ped.heading = Math.atan2(dxPlayer, dzPlayer);
    ped.stateTimer -= dt;
    if (ped.stateTimer <= 0) {
      if (distPlayer < 2.6 && !playerInCar) {
        dealtDamageToPlayer = ped.role === 'police_foot' ? 14 : 12;
      }
      ped.state = 'chase';
    }
  } else if (ped.role === 'clerk') {
    // Store clerk stays right by their storefront entrance
    const homeDist = Math.hypot(ped.homeX - ped.x, ped.homeZ - ped.z);
    if (homeDist > 1.4) {
      goalX = ped.homeX;
      goalZ = ped.homeZ;
    } else {
      speed = 0;
      if (distPlayer < 10) {
        ped.heading = Math.atan2(dxPlayer, dzPlayer);
      }
    }
  } else if (ped.activity === 'chat' || ped.activity === 'wait') {
    // Social chatting pair or bus-shelter / storefront commuter
    const homeDist = Math.hypot(ped.homeX - ped.x, ped.homeZ - ped.z);
    if (homeDist > 1.2) {
      speed = 1.45;
      goalX = ped.homeX;
      goalZ = ped.homeZ;
    } else {
      speed = 0;
      if (ped.faceAngle !== undefined) {
        ped.heading = ped.faceAngle;
      }
    }
  } else if (ped.walkAxis) {
    // Purposeful linear sidewalk stroll or fitness jog staying strictly along the boulevard sidewalk
    const span = ped.walkSpan ?? 10.0;
    if (Math.hypot(ped.targetX - ped.x, ped.targetZ - ped.z) < 1.2) {
      if (ped.walkAxis === 'x') {
        const dir = ped.targetX >= ped.homeX ? -1 : 1;
        ped.targetX = ped.homeX + dir * span;
        ped.targetZ = ped.homeZ;
      } else {
        const dir = ped.targetZ >= ped.homeZ ? -1 : 1;
        ped.targetX = ped.homeX;
        ped.targetZ = ped.homeZ + dir * span;
      }
    }
    goalX = ped.targetX;
    goalZ = ped.targetZ;
  } else {
    // Sidewalk patrol around home block (deterministic via injected simTimeSec)
    if (Math.hypot(ped.targetX - ped.x, ped.targetZ - ped.z) < 1.5) {
      const angle = (ped.homeX * 13 + ped.homeZ * 7 + simTimeSec * 0.73) % (Math.PI * 2);
      const radius = ped.role === 'grove' ? 5.5 : 8.0;
      ped.targetX = ped.homeX + Math.cos(angle) * radius;
      ped.targetZ = ped.homeZ + Math.sin(angle) * radius;
    }
  }

  if (speed > 0.05) {
    const gx = goalX - ped.x;
    const gz = goalZ - ped.z;
    const gLen = Math.hypot(gx, gz);
    if (gLen > 0.1) {
      ped.vx = dampValue(ped.vx, (gx / gLen) * speed, 8, dt);
      ped.vz = dampValue(ped.vz, (gz / gLen) * speed, 8, dt);
      ped.heading = Math.atan2(gx, gz);
    }
  } else {
    ped.vx = dampValue(ped.vx, 0, 12, dt);
    ped.vz = dampValue(ped.vz, 0, 12, dt);
  }

  const res = resolveCircleVsAABBs(
    ped.x + ped.vx * dt,
    ped.z + ped.vz * dt,
    ped.vx,
    ped.vz,
    0.4,
    colliders,
    0,
  );
  ped.x = res.x;
  ped.z = res.z;
  ped.vx = res.vx;
  ped.vz = res.vz;

  const moveSpd = Math.hypot(ped.vx, ped.vz);
  if (moveSpd > 0.1) {
    ped.walkCycle += moveSpd * dt * 2.2;
  }

  return { dealtDamageToPlayer };
}

export function createVehicleState(
  id: string,
  kind: keyof typeof VEHICLE_SPECS,
  x: number,
  z: number,
  heading: number,
  driver: VehicleState['driver'],
  waypointIndex = 0,
  customPaintHex?: number,
  routeLoop = 0,
): VehicleState {
  return {
    id,
    spec: VEHICLE_SPECS[kind],
    x,
    y: 0,
    z,
    vx: 0,
    vz: 0,
    heading,
    angularVel: 0,
    steerAngle: 0,
    speed: 0,
    lateralSpeed: 0,
    rpm: 950,
    gear: 1,
    pitch: 0,
    roll: 0,
    wheelSpin: 0,
    health: 100,
    nitro: 100,
    nitroActive: false,
    braking: false,
    drifting: false,
    sirenOn: false,
    driver,
    routeLoop,
    waypointIndex,
    aiStuckTimer: 0,
    damageFlash: 0,
    customPaintHex,
  };
}
