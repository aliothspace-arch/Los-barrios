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
import { sampleRoadSurfaceHeight } from './roadSurface';

// Reusable scratch array & buffers to keep 60Hz vehicle/OBB physics zero-allocation
const _colliderQueryScratch: ColliderAABB[] = [];
const _obbCornersAX = new Float64Array(4);
const _obbCornersAZ = new Float64Array(4);
const _obbCornersBX = new Float64Array(4);
const _obbCornersBZ = new Float64Array(4);

const GRAVITY = 9.81;
const WHEEL_RADIUS_EFF = 0.355;

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
  gearShiftDir: -1 | 0 | 1;
  curbPulse: number;
  scrapeIntensity: number;
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

function clampNum(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
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

function writeOBBCorners(
  cx: number,
  cz: number,
  lx: number,
  lz: number,
  fx: number,
  fz: number,
  halfW: number,
  halfL: number,
  outX: Float64Array,
  outZ: Float64Array,
): void {
  const lhx = lx * halfW;
  const lhz = lz * halfW;
  const fhx = fx * halfL;
  const fhz = fz * halfL;
  outX[0] = cx + lhx + fhx;
  outZ[0] = cz + lhz + fhz;
  outX[1] = cx - lhx + fhx;
  outZ[1] = cz - lhz + fhz;
  outX[2] = cx + lhx - fhx;
  outZ[2] = cz + lhz - fhz;
  outX[3] = cx - lhx - fhx;
  outZ[3] = cz - lhz - fhz;
}

/**
 * 2D Separating Axis Theorem (SAT) vehicle OBB vs static AABB solver.
 * Resolves exact chassis rectangle footprint (no nose clipping or side air gaps),
 * computes lever-arm spin impulse (dω), and applies metallic wall-scrape friction.
 */
function resolveVehicleOBBVsAABBs(
  v: VehicleState,
  colliders: StaticColliderSource,
  restitution = 0.2,
): { impact: CollisionImpact; scrapeIntensity: number } {
  const halfW = v.spec.width * 0.48;
  const halfL = v.spec.length * 0.48;
  const broadRadius = Math.hypot(halfW, halfL) + 0.45;
  const mass = v.spec.mass;
  const inertia = (mass * (v.spec.width * v.spec.width + v.spec.length * v.spec.length)) / 12;

  const impact: CollisionImpact = {
    hit: false,
    normalX: 0,
    normalZ: 0,
    impulseSpeed: 0,
    colliderId: '',
  };
  let scrapeIntensity = 0;

  let fx = Math.sin(v.heading);
  let fz = Math.cos(v.heading);
  let lx = Math.cos(v.heading);
  let lz = -Math.sin(v.heading);

  for (let iter = 0; iter < 3; iter++) {
    const candidates = getCandidateColliders(colliders, v.x, v.z, broadRadius);
    let anyPenetration = false;

    for (let i = 0; i < candidates.length; i++) {
      const box = candidates[i];
      const bx = (box.minX + box.maxX) * 0.5;
      const bz = (box.minZ + box.maxZ) * 0.5;
      const bHalfW = (box.maxX - box.minX) * 0.5;
      const bHalfZ = (box.maxZ - box.minZ) * 0.5;

      const dx = v.x - bx;
      const dz = v.z - bz;

      // Quick bounding circle rejection
      const boxRadius = Math.hypot(bHalfW, bHalfZ);
      if (dx * dx + dz * dz > (broadRadius + boxRadius) * (broadRadius + boxRadius)) {
        continue;
      }

      // SAT across 4 axes: (1,0), (0,1), car-left, car-forward
      let minOverlap = Infinity;
      let bestNx = 0;
      let bestNz = 0;

      // Axis 0: World X (1, 0)
      {
        const projCar = halfW * Math.abs(lx) + halfL * Math.abs(fx);
        const overlap = projCar + bHalfW - Math.abs(dx);
        if (overlap <= 0) continue;
        if (overlap < minOverlap) {
          minOverlap = overlap;
          bestNx = dx >= 0 ? 1 : -1;
          bestNz = 0;
        }
      }

      // Axis 1: World Z (0, 1)
      {
        const projCar = halfW * Math.abs(lz) + halfL * Math.abs(fz);
        const overlap = projCar + bHalfZ - Math.abs(dz);
        if (overlap <= 0) continue;
        if (overlap < minOverlap) {
          minOverlap = overlap;
          bestNx = 0;
          bestNz = dz >= 0 ? 1 : -1;
        }
      }

      // Axis 2: Car Left (lx, lz)
      {
        const dist = dx * lx + dz * lz;
        const projBox = bHalfW * Math.abs(lx) + bHalfZ * Math.abs(lz);
        const overlap = halfW + projBox - Math.abs(dist);
        if (overlap <= 0) continue;
        if (overlap < minOverlap) {
          minOverlap = overlap;
          const s = dist >= 0 ? 1 : -1;
          bestNx = lx * s;
          bestNz = lz * s;
        }
      }

      // Axis 3: Car Forward (fx, fz)
      {
        const dist = dx * fx + dz * fz;
        const projBox = bHalfW * Math.abs(fx) + bHalfZ * Math.abs(fz);
        const overlap = halfL + projBox - Math.abs(dist);
        if (overlap <= 0) continue;
        if (overlap < minOverlap) {
          minOverlap = overlap;
          const s = dist >= 0 ? 1 : -1;
          bestNx = fx * s;
          bestNz = fz * s;
        }
      }

      anyPenetration = true;

      // Separate OBB out of AABB
      v.x += bestNx * minOverlap;
      v.z += bestNz * minOverlap;

      // Determine deepest contact corner(s) on the car facing into the box (-bestN)
      writeOBBCorners(v.x, v.z, lx, lz, fx, fz, halfW, halfL, _obbCornersAX, _obbCornersAZ);
      let deepestProj = Infinity;
      for (let c = 0; c < 4; c++) {
        const p = _obbCornersAX[c] * bestNx + _obbCornersAZ[c] * bestNz;
        if (p < deepestProj) deepestProj = p;
      }

      let contactX = 0;
      let contactZ = 0;
      let contactCount = 0;
      for (let c = 0; c < 4; c++) {
        const p = _obbCornersAX[c] * bestNx + _obbCornersAZ[c] * bestNz;
        if (p <= deepestProj + 0.14) {
          contactX += clampNum(_obbCornersAX[c], box.minX, box.maxX);
          contactZ += clampNum(_obbCornersAZ[c], box.minZ, box.maxZ);
          contactCount++;
        }
      }
      if (contactCount > 0) {
        contactX /= contactCount;
        contactZ /= contactCount;
      } else {
        contactX = v.x - bestNx * halfW;
        contactZ = v.z - bestNz * halfW;
      }

      const rx = contactX - v.x;
      const rz = contactZ - v.z;
      // Velocity at contact point: v_pt = (vx + ω * rz, vz - ω * rx)
      const vcpX = v.vx + v.angularVel * rz;
      const vcpZ = v.vz - v.angularVel * rx;
      const vn = vcpX * bestNx + vcpZ * bestNz;

      if (vn < 0) {
        const impulseSpeed = -vn;
        if (impulseSpeed > impact.impulseSpeed) {
          impact.hit = true;
          impact.normalX = bestNx;
          impact.normalZ = bestNz;
          impact.impulseSpeed = impulseSpeed;
          impact.colliderId = box.id;
        }

        const rCrossN = bestNx * rz - bestNz * rx;
        const invEffN = 1 / mass + (rCrossN * rCrossN) / inertia;
        const effRest = impulseSpeed > 3.2 ? restitution : 0.04;
        const jn = (-(1 + effRest) * vn) / invEffN;

        const impNx = jn * bestNx;
        const impNz = jn * bestNz;
        v.vx += impNx / mass;
        v.vz += impNz / mass;
        v.angularVel += (impNx * rz - impNz * rx) / inertia;

        // Tangential scraping friction
        const tx = -bestNz;
        const tz = bestNx;
        const vt = vcpX * tx + vcpZ * tz;
        const rCrossT = tx * rz - tz * rx;
        const invEffT = 1 / mass + (rCrossT * rCrossT) / inertia;
        const muWall = 0.24;
        const jt = clampNum(-vt / invEffT, -muWall * jn, muWall * jn);
        const impTx = jt * tx;
        const impTz = jt * tz;
        v.vx += impTx / mass;
        v.vz += impTz / mass;
        v.angularVel += (impTx * rz - impTz * rx) / inertia;

        if (Math.abs(vt) > 2.2) {
          const sNorm = Math.min(1, (Math.abs(vt) * Math.min(1, impulseSpeed * 0.28 + 0.22)) / 12);
          if (sNorm > scrapeIntensity) scrapeIntensity = sNorm;
        }
      } else if (minOverlap > 0.002) {
        const tx = -bestNz;
        const tz = bestNx;
        const vt = Math.abs(vcpX * tx + vcpZ * tz);
        if (vt > 3.0) {
          const sNorm = Math.min(0.65, (vt * 0.32) / 14);
          if (sNorm > scrapeIntensity) scrapeIntensity = sNorm;
        }
      }
    }

    if (!anyPenetration) break;
  }

  // Soft city boundary containment using true bounding projection
  const spanX = halfW * Math.abs(lx) + halfL * Math.abs(fx);
  const spanZ = halfW * Math.abs(lz) + halfL * Math.abs(fz);
  const limitX = WORLD_HALF_SIZE - spanX;
  const limitZ = WORLD_HALF_SIZE - spanZ;
  if (v.x < -limitX) {
    v.x = -limitX;
    if (v.vx < 0) v.vx = -v.vx * 0.24;
  } else if (v.x > limitX) {
    v.x = limitX;
    if (v.vx > 0) v.vx = -v.vx * 0.24;
  }
  if (v.z < -limitZ) {
    v.z = -limitZ;
    if (v.vz < 0) v.vz = -v.vz * 0.24;
  } else if (v.z > limitZ) {
    v.z = limitZ;
    if (v.vz > 0) v.vz = -v.vz * 0.24;
  }

  return { impact, scrapeIntensity };
}

function evaluateTorqueCurve(rpmNorm: number): number {
  // Realistic automotive torque envelope: punchy off-the-line launch, broad midrange peak, soft redline limiter
  const c = clampNum(rpmNorm, 0.08, 1.04);
  if (c < 0.25) return 0.86 + (c - 0.08) * 0.95;
  if (c < 0.78) return 1.02 + Math.sin(((c - 0.25) / 0.53) * (Math.PI * 0.5)) * 0.08;
  if (c <= 0.985) return 1.1 - ((c - 0.78) / 0.205) * 0.14;
  // Rev limiter soft fuel-cut
  return 0.28;
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
  const mass = spec.mass;
  const inertia = (mass * (spec.width * spec.width + spec.length * spec.length)) / 12;

  // Forward unit vector: heading = 0 -> (0, +1), heading = Math.PI -> (0, -1)
  const fx = Math.sin(v.heading);
  const fz = Math.cos(v.heading);
  // Left unit vector (+heading direction in XZ plane)
  const lx = Math.cos(v.heading);
  const lz = -Math.sin(v.heading);

  let vForward = v.vx * fx + v.vz * fz;
  let vLeft = v.vx * lx + v.vz * lz;
  const prevForward = vForward;
  const prevLeft = vLeft;
  const prevGear = v.gear;

  // 1. Progressive Speed-Sensitive Steering + Active Stability Counter-Steer Assist
  const absSpeed = Math.abs(vForward);
  const maxLatG = spec.tireGripMu * gripMult * GRAVITY * 1.18;
  const kinematicSteerCap =
    absSpeed > 5.0
      ? Math.atan((spec.wheelbase * maxLatG) / (absSpeed * absSpeed))
      : spec.maxSteerAngle;
  const speedBlend = clampNum((absSpeed - 4.0) / 30.0, 0, 1);
  // Keep high-speed steer angle tightly coupled to tire lateral G capacity so digital keyboard
  // steering carves clean high-grip arcs instead of violently saturating the tires into a spin.
  const highSpeedFloor = 0.068 + (1 - speedBlend) * 0.095;
  const effectiveMaxSteer = clampNum(
    Math.max(highSpeedFloor, kinematicSteerCap * (1.16 - 0.12 * speedBlend)),
    0.068,
    spec.maxSteerAngle,
  );

  const steerMag = Math.abs(input.steer);
  const shapedSteer = Math.sign(input.steer) * Math.pow(steerMag, 1.38);
  const targetDriverSteer = shapedSteer * effectiveMaxSteer;
  // Crisp steering turn-in and faster self-centering return when key is released
  const returningToCenter = steerMag < 0.05 || input.steer * v.steerAngle < 0;
  const steerSpeed =
    spec.steerRate * (2.5 - 0.85 * speedBlend) * (returningToCenter ? 1.45 : 1.0);
  v.steerAngle = dampValue(v.steerAngle, targetDriverSteer, steerSpeed, dt);

  // Active Simcade counter-steer assist when tail begins to step out
  const driftSlipAngle =
    absSpeed > 3.8 ? Math.atan2(vLeft, Math.max(3.5, absSpeed)) : 0;
  let counterSteer = 0;
  if (Math.abs(driftSlipAngle) > 0.045 && vForward > 3.2) {
    const assistScale = input.handbrake
      ? spec.assistStrength * 0.65
      : spec.assistStrength * (1.15 + 0.35 * gripMult);
    const desiredCounter = clampNum(
      driftSlipAngle * assistScale,
      -effectiveMaxSteer * 0.92,
      effectiveMaxSteer * 0.92,
    );
    const sameSign = desiredCounter * v.steerAngle >= 0;
    counterSteer = input.handbrake
      ? sameSign
        ? desiredCounter * (1 - 0.35 * steerMag)
        : desiredCounter * (1 - 0.72 * steerMag)
      : sameSign
        ? desiredCounter * (1 - 0.2 * steerMag)
        : desiredCounter * (1 - 0.28 * steerMag);
  }
  const appliedSteer = clampNum(
    v.steerAngle + counterSteer,
    -spec.maxSteerAngle * 1.05,
    spec.maxSteerAngle * 1.05,
  );
  v.visualSteerAngle = dampValue(v.visualSteerAngle, appliedSteer, 16, dt);

  // 2. Nitro Management
  const canNitro = input.nitro && v.nitro > 2 && input.throttle > 0.1;
  v.nitroActive = canNitro;
  if (canNitro) {
    v.nitro = Math.max(0, v.nitro - 26 * dt);
  } else {
    v.nitro = Math.min(100, v.nitro + 5.5 * dt);
  }

  // 3. 6-Speed Powertrain, Torque Curve, Burnout & Clean Brake-Hold-Reverse
  if (v.shiftCutTimer > 0) {
    v.shiftCutTimer = Math.max(0, v.shiftCutTimer - dt);
  }

  const idleRpm = 920;
  const redline = spec.redlineRpm;
  const refGearRatio = spec.gearRatios[2] * spec.finalDrive; // 3rd gear ~1:1 reference
  let driveAccel = 0;
  let brakeAccel = 0;
  let rearDriveAccel = 0;
  let isBurnout = false;
  v.braking = false;
  v.absActive = false;

  const isPlayerControlled = v.driver === 'player';

  // Burnout detection: holding throttle + brake while nearly stopped
  if (input.throttle > 0.45 && input.brake > 0.45 && absSpeed < 4.0) {
    isBurnout = true;
    v.braking = true;
    v.gear = 1;
    v.reverseHoldTimer = 0;
    const burnoutRpmTarget = redline * (0.86 + 0.1 * input.throttle);
    v.rpm = dampValue(v.rpm, burnoutRpmTarget, 11, dt);
    rearDriveAccel = input.throttle * spec.maxEngineForce * 0.45;
    brakeAccel = -Math.sign(vForward) * spec.maxBrakeForce * 0.85;
  } else if (input.brake > 0.04) {
    if (vForward > 0.65 || (isPlayerControlled && vForward > 0.18 && v.gear !== -1)) {
      // Service braking (with ABS modulation)
      v.braking = true;
      v.reverseHoldTimer = 0;
      const rawBrake = input.brake * spec.maxBrakeForce * (0.76 + 0.24 * gripMult);
      const maxTireBrake = spec.tireGripMu * gripMult * GRAVITY * 1.18;
      if (rawBrake > maxTireBrake && vForward > 3.5) {
        v.absActive = true;
        // ABS pulses slightly around peak tire grip instead of full lockup
        const pulse = 0.94 + 0.06 * Math.sin(v.frontWheelSpin * 3.5);
        brakeAccel = -maxTireBrake * pulse;
      } else {
        brakeAccel = -rawBrake;
      }
      // Prevent brake from overshooting past zero in one tick
      if (vForward + brakeAccel * dt < 0) {
        vForward = 0;
        brakeAccel = 0;
      }
    } else {
      // Hold at 0 for 0.16s before engaging Reverse cleanly (AI reverses immediately when needed)
      v.braking = true;
      const holdReq = isPlayerControlled ? 0.16 : 0.0;
      if (v.gear !== -1 && v.reverseHoldTimer < holdReq) {
        v.reverseHoldTimer += dt;
        vForward = dampValue(vForward, 0, 18, dt);
      } else {
        v.gear = -1;
        const revRatio = spec.reverseGearRatio * spec.finalDrive;
        const revScale = clampNum(revRatio / refGearRatio, 1.0, 2.2);
        const speedNormRev = clampNum(Math.abs(vForward) / spec.reverseSpeed, 0, 1);
        driveAccel = -input.brake * spec.maxEngineForce * 0.46 * revScale * (1 - 0.55 * speedNormRev);
      }
    }
  } else {
    v.reverseHoldTimer = 0;
  }

  let gearShiftDir: -1 | 0 | 1 = 0;

  if (!isBurnout && !(input.brake > 0.04 && v.gear === -1)) {
    // Forward gears 1..6
    if (vForward >= -0.35 || input.throttle > 0.05) {
      if (v.gear < 1) v.gear = 1;
      const gIdx = clampNum(v.gear - 1, 0, 5);
      const overallRatio = spec.gearRatios[gIdx] * spec.finalDrive;
      const wheelRpm = (Math.max(0, vForward) / WHEEL_RADIUS_EFF) * (60 / (Math.PI * 2)) * overallRatio;

      // Wheelspin slip rises RPM above pure road speed on high throttle / wet road / RWD launch
      const longGripMult = 0.56 + 0.44 * gripMult;
      const tractionBudget =
        spec.tireGripMu *
        longGripMult *
        GRAVITY *
        (spec.drivetrain === 'AWD' ? 1.85 : 1.42);
      const gearTorqueScale = Math.pow(overallRatio / refGearRatio, 0.72);
      const nitroMult = canNitro ? 1.52 : 1.0;
      const torqueEnv = evaluateTorqueCurve(v.rpm / redline);
      const shiftCutMult = v.shiftCutTimer > 0 ? 0.28 : 1.0;

      const demandedEngineAccel =
        input.throttle * spec.maxEngineForce * gearTorqueScale * nitroMult * torqueEnv * shiftCutMult;

      const launchSpinBoost =
        input.throttle > 0.35 && demandedEngineAccel > tractionBudget
          ? ((demandedEngineAccel - tractionBudget) / Math.max(4, tractionBudget)) * 1850
          : 0;

      const targetRpm = clampNum(
        Math.max(idleRpm + input.throttle * 420, wheelRpm + launchSpinBoost + (canNitro ? 420 : 0)),
        idleRpm,
        redline * 1.03,
      );
      v.rpm = dampValue(v.rpm, targetRpm, input.throttle > 0.05 ? 12.5 : 7.5, dt);

      // Automatic shifting with hysteresis & kickdown
      const shiftUpThreshold = redline * (canNitro ? 0.94 : 0.9);
      const shiftDownThreshold = redline * (input.throttle > 0.8 ? 0.56 : 0.38);

      if (v.shiftCutTimer <= 0) {
        if (v.gear < 6 && v.rpm >= shiftUpThreshold && vForward > 6.5) {
          v.gear++;
          v.shiftCutTimer = 0.055;
          v.shiftKickDir = 1;
          gearShiftDir = 1;
          const nextRatio = spec.gearRatios[v.gear - 1] * spec.finalDrive;
          v.rpm = Math.max(idleRpm + 700, (v.rpm * nextRatio) / overallRatio);
        } else if (v.gear > 1 && wheelRpm * (spec.gearRatios[v.gear - 2] / spec.gearRatios[v.gear - 1]) < redline * 0.84 && v.rpm <= shiftDownThreshold) {
          v.gear--;
          v.shiftCutTimer = 0.045;
          v.shiftKickDir = -1;
          gearShiftDir = -1;
          const prevRatio = spec.gearRatios[v.gear - 1] * spec.finalDrive;
          v.rpm = Math.min(redline * 0.92, (v.rpm * prevRatio) / overallRatio);
        }
      }

      if (input.throttle > 0.02) {
        const cappedAccel = Math.min(demandedEngineAccel, tractionBudget * (canNitro ? 1.24 : 1.08));
        driveAccel += cappedAccel;
        rearDriveAccel = demandedEngineAccel;
      } else if (vForward > 1.2 && !input.handbrake && input.brake <= 0.02) {
        // Gentle engine braking compression off-throttle
        driveAccel -= (0.45 + 0.032 * overallRatio) * clampNum(vForward / 8, 0.2, 1.4);
      }
    } else {
      // Rolling backward in Reverse
      v.gear = -1;
      const revRatio = spec.reverseGearRatio * spec.finalDrive;
      const revRpm = idleRpm + (Math.abs(vForward) / WHEEL_RADIUS_EFF) * (60 / (Math.PI * 2)) * revRatio;
      v.rpm = dampValue(v.rpm, Math.min(redline * 0.85, revRpm), 10, dt);
    }
  } else if (v.gear === -1) {
    const revRatio = spec.reverseGearRatio * spec.finalDrive;
    const revRpm = idleRpm + (Math.abs(vForward) / WHEEL_RADIUS_EFF) * (60 / (Math.PI * 2)) * revRatio + input.brake * 520;
    v.rpm = dampValue(v.rpm, Math.min(redline * 0.88, revRpm), 11, dt);
  }

  // Track shift upshift/downshift pitch impulse decay
  if (v.shiftCutTimer <= 0) v.shiftKickDir = 0;

  // Handbrake deceleration
  if (input.handbrake) {
    v.braking = true;
    const hbDecel = Math.sign(vForward) * spec.maxBrakeForce * 0.38 * gripMult;
    if (Math.abs(vForward) > Math.abs(hbDecel * dt)) {
      brakeAccel -= hbDecel;
    } else {
      vForward = 0;
    }
  }

  // Aerodynamic drag + rolling resistance
  const aeroDrag = -vForward * Math.abs(vForward) * spec.dragCoeff;
  const rollingResist =
    Math.abs(vForward) > 0.08 ? -Math.sign(vForward) * 1.15 : -vForward * 7.5;
  const totalLongAccel = driveAccel + brakeAccel + aeroDrag + rollingResist;

  vForward += totalLongAccel * dt;

  const topSpeed = canNitro ? spec.maxSpeed * 1.24 : spec.maxSpeed;
  if (vForward > topSpeed) vForward = dampValue(vForward, topSpeed, 4.5, dt);
  if (vForward < -spec.reverseSpeed) vForward = -spec.reverseSpeed;

  // Snap dead-stopped car cleanly to avoid creeping
  if (
    input.throttle < 0.02 &&
    input.brake < 0.02 &&
    !input.handbrake &&
    Math.abs(vForward) < 0.06 &&
    Math.abs(vLeft) < 0.06
  ) {
    vForward = 0;
    vLeft = 0;
    v.angularVel = 0;
  }

  // 4. 4-Corner Weight Transfer & Pacejka-Inspired Lateral Tire Solver
  const wheelbase = spec.wheelbase;
  const lf = wheelbase * (1 - spec.frontWeightBias);
  const lr = wheelbase * spec.frontWeightBias;
  const staticFrontShare = spec.frontWeightBias;

  // Normalized dynamic axle loads with anti-dive/anti-squat geometry clamp (sum = 1.0)
  const longLoadTransfer = clampNum((totalLongAccel * spec.cgHeight) / (wheelbase * GRAVITY), -0.14, 0.16);
  const frontLoadShare = clampNum(staticFrontShare - longLoadTransfer, 0.32, 0.68);
  const rearLoadShare = 1.0 - frontLoadShare;

  const moveSign = vForward >= -0.05 ? 1 : -1;
  const denomSpeed = Math.max(2.4, Math.abs(vForward));

  // Front & rear axle lateral velocities (positive = sliding toward +L)
  const vLeftFront = vLeft + v.angularVel * lf;
  const vLeftRear = vLeft - v.angularVel * lr;

  const alphaFront = Math.atan2(vLeftFront, denomSpeed) - appliedSteer * moveSign;
  const alphaRear = Math.atan2(vLeftRear, denomSpeed);

  // Crisp Pacejka cornering stiffness (peak grip around ~9-11 deg slip angle instead of mushy 22 deg)
  const B = spec.cornerStiffness * 1.48 * (0.58 + 0.42 * gripMult);
  const pacejkaFront = Math.sin(1.30 * Math.atan((B / 1.30) * alphaFront));
  const pacejkaRear = Math.sin(1.30 * Math.atan(((B * 1.12) / 1.30) * alphaRear));

  // Friction-circle coupling reduces rear lateral grip subtly under extreme RWD throttle, strongly under handbrake
  const baseMu = spec.tireGripMu * gripMult;
  const rearDriveDemandRatio =
    spec.drivetrain === 'RWD'
      ? clampNum(rearDriveAccel / Math.max(1, baseMu * GRAVITY * 1.65), 0, 0.78)
      : clampNum(rearDriveAccel / Math.max(1, baseMu * GRAVITY * 2.6), 0, 0.42);
  const rearTractionFactor = Math.sqrt(Math.max(0.58, 1 - 0.36 * rearDriveDemandRatio * rearDriveDemandRatio));
  const handbrakeRearMult = input.handbrake ? 0.34 : 1.0;

  const latCapacity = baseMu * GRAVITY * 1.34;
  // Slight rear stability bias (0.98 front vs 1.08 rear) eliminates twitchy liftoff/corner-entry spin-outs
  const latAccelFront = -pacejkaFront * latCapacity * frontLoadShare * 0.98;
  const latAccelRear = -pacejkaRear * latCapacity * rearLoadShare * rearTractionFactor * handbrakeRearMult * 1.08;

  // Effective yaw moment of inertia per unit mass
  const effYawInertiaPerMass = (inertia / mass) * 0.78;
  const rawYawAccel = (latAccelFront * lf - latAccelRear * lr) / effYawInertiaPerMass;

  // Electronic Stability Control (ESC) + progressive yaw damping prevents unprovoked snap-oversteer
  const speedYawScale = clampNum(absSpeed / 4.2, 0, 1);
  const kinematicTargetYaw =
    absSpeed > 0.25 ? (vForward / wheelbase) * Math.tan(appliedSteer) * (1 - 0.22 * speedBlend) : 0;
  const physGripYaw = absSpeed > 3.5 ? (baseMu * GRAVITY * 1.18) / Math.max(4.5, absSpeed) : 2.9;
  const desiredYaw = clampNum(kinematicTargetYaw, -physGripYaw, physGripYaw);
  const escYawAssist =
    !input.handbrake && absSpeed > 4.2
      ? -(v.angularVel - desiredYaw) * (2.6 + 1.8 * gripMult)
      : 0;
  const yawDamping = -v.angularVel * (input.handbrake ? 0.55 : 1.35 + 0.65 * gripMult);

  let nextAngularVel =
    v.angularVel + (rawYawAccel * speedYawScale + yawDamping + escYawAssist * speedYawScale) * dt;
  if (absSpeed <= 4.2) {
    // Smooth blend into crisp low-speed parking/U-turn Ackermann kinematics
    const lowBlend = 1 - speedYawScale;
    nextAngularVel =
      nextAngularVel * speedYawScale +
      dampValue(v.angularVel, kinematicTargetYaw, 12.0, dt) * lowBlend;
  }

  // Cap maximum yaw rate realistically by G-limit so cars never spin uncontrollably
  const physMaxYaw = absSpeed > 3.5 ? (baseMu * GRAVITY * 1.45) / Math.max(4.5, absSpeed) : 2.9;
  v.angularVel = clampNum(nextAngularVel, -physMaxYaw - 0.55, physMaxYaw + 0.55);

  v.heading = normalizeAngle(v.heading + v.angularVel * dt);

  // Recompute forward/left basis after heading update
  const nfx = Math.sin(v.heading);
  const nfz = Math.cos(v.heading);
  const nlx = Math.cos(v.heading);
  const nlz = -Math.sin(v.heading);

  // Apply tire lateral acceleration & subtle centripetal coupling in rotating chassis frame
  const totalLatAccel = latAccelFront + latAccelRear;
  const centripetalCouple = -v.angularVel * vForward;
  vLeft += (totalLatAccel + centripetalCouple) * dt;

  // Low-speed tire scrub prevents microscopic drifting below walking pace; normal grip damps excess slip
  if (absSpeed < 1.2) {
    vLeft *= Math.exp(-14 * dt);
  } else {
    const baseDamp = input.handbrake ? spec.driftGrip * 0.25 : spec.lateralGrip * 0.34;
    vLeft *= Math.exp(-baseDamp * gripMult * dt);
  }

  // Reconstruct world velocity
  v.vx = nfx * vForward + nlx * vLeft;
  v.vz = nfz * vForward + nlz * vLeft;

  // 5. Integrate Position & Resolve True 2D OBB Rigid-Body Collisions
  v.x += v.vx * dt;
  v.z += v.vz * dt;
  const resolved = resolveVehicleOBBVsAABBs(v, colliders, 0.22);

  // Re-project forward & left speed post-collision
  const postFx = Math.sin(v.heading);
  const postFz = Math.cos(v.heading);
  const postLx = Math.cos(v.heading);
  const postLz = -Math.sin(v.heading);
  v.speed = v.vx * postFx + v.vz * postFz;
  v.lateralSpeed = v.vx * postLx + v.vz * postLz;

  v.longAccel = (v.speed - prevForward) / Math.max(0.004, dt);
  v.latAccel = (v.lateralSpeed - prevLeft) / Math.max(0.004, dt) + v.angularVel * v.speed;

  // 6. 4-Corner Suspension Travel & Analytical Road/Curb Elevation Sampling
  const ht = spec.trackWidth * 0.5;
  const g0 = sampleRoadSurfaceHeight(v.x + ht * postLx + lf * postFx, v.z + ht * postLz + lf * postFz); // FL
  const g1 = sampleRoadSurfaceHeight(v.x - ht * postLx + lf * postFx, v.z - ht * postLz + lf * postFz); // FR
  const g2 = sampleRoadSurfaceHeight(v.x + ht * postLx - lr * postFx, v.z + ht * postLz - lr * postFz); // RL
  const g3 = sampleRoadSurfaceHeight(v.x - ht * postLx - lr * postFx, v.z - ht * postLz - lr * postFz); // RR

  const prevG0 = v.wheelGroundY[0];
  const prevG1 = v.wheelGroundY[1];
  const prevG2 = v.wheelGroundY[2];
  const prevG3 = v.wheelGroundY[3];
  v.wheelGroundY[0] = g0;
  v.wheelGroundY[1] = g1;
  v.wheelGroundY[2] = g2;
  v.wheelGroundY[3] = g3;

  const avgGroundY = 0.25 * (g0 + g1 + g2 + g3);
  const omegaN = Math.PI * 2 * spec.suspensionFreq;
  const dampC = 2 * spec.suspensionDamping * omegaN;

  // Chassis heave tracks average wheel ground level via spring-damper
  const heaveAcc = omegaN * omegaN * (avgGroundY - v.y) - dampC * v.chassisHeaveVel;
  v.chassisHeaveVel += heaveAcc * dt;
  v.y += v.chassisHeaveVel * dt;
  v.chassisHeave = clampNum(v.y - avgGroundY, -0.09, 0.11);

  // Per-corner suspension deflection relative to current chassis plane
  const terrainPitch = -((g0 + g1) * 0.5 - (g2 + g3) * 0.5) / wheelbase;
  const terrainRoll = ((g0 + g2) * 0.5 - (g1 + g3) * 0.5) / spec.trackWidth;

  const shiftPitch = v.shiftCutTimer > 0 ? v.shiftKickDir * 0.014 : 0;
  const weightPitch = clampNum(-totalLongAccel * 0.0024 + shiftPitch, -0.075, 0.075);
  const weightRoll = clampNum(v.angularVel * v.speed * 0.0066, -0.11, 0.11);

  v.pitch = dampValue(v.pitch, weightPitch + terrainPitch * 0.72, 10.5, dt);
  v.roll = dampValue(v.roll, weightRoll + terrainRoll * 0.72, 10.0, dt);

  let maxCurbPulse = 0;
  const dg0 = g0 - prevG0;
  const dg1 = g1 - prevG1;
  const dg2 = g2 - prevG2;
  const dg3 = g3 - prevG3;
  if (Math.abs(v.speed) > 2.2) {
    const maxStep = Math.max(dg0, dg1, dg2, dg3);
    if (maxStep > 0.045) {
      maxCurbPulse = clampNum((maxStep / 0.145) * clampNum(Math.abs(v.speed) / 14, 0.25, 1), 0, 1);
    }
  }
  v.curbImpactPulse = maxCurbPulse;

  const cornersG = [g0, g1, g2, g3];
  const cornerSignsFwd = [1, 1, -1, -1];
  const cornerSignsLeft = [1, -1, 1, -1];
  for (let i = 0; i < 4; i++) {
    const bodyCornerOffset =
      -v.pitch * (cornerSignsFwd[i] > 0 ? lf : -lr) + v.roll * cornerSignsLeft[i] * ht;
    const targetComp = clampNum(cornersG[i] - (v.y + bodyCornerOffset), -0.11, 0.14);
    const cAcc =
      omegaN * omegaN * (targetComp - v.wheelCompression[i]) -
      dampC * v.wheelCompressionVel[i];
    v.wheelCompressionVel[i] += cAcc * dt;
    v.wheelCompression[i] = clampNum(
      v.wheelCompression[i] + v.wheelCompressionVel[i] * dt,
      -0.11,
      0.15,
    );
  }

  // 7. Differential Front & Rear Wheel Spin + Tire Slip Ratios (Burnouts & Braking)
  const frontSlip =
    input.handbrake || v.absActive
      ? clampNum(Math.abs(alphaFront) * 1.15 + (v.absActive ? 0.35 : 0), 0, 1)
      : clampNum((Math.abs(alphaFront) - 0.22) * 2.1, 0, 1);
  const rearBurnoutSpin = isBurnout
    ? 22.0 + input.throttle * 26.0
    : input.throttle > 0.45 && Math.abs(vForward) < 6.5 && rearDriveAccel > baseMu * GRAVITY * 1.38
      ? (rearDriveAccel - baseMu * GRAVITY * 1.25) * 1.05
      : 0;
  const frontSpinSpeed = isBurnout ? 0 : input.handbrake ? v.speed : v.speed * (v.absActive ? 0.72 : 1.0);
  const rearSpinSpeed = input.handbrake ? 0 : v.speed + rearBurnoutSpin;

  v.frontWheelSpin += (frontSpinSpeed / WHEEL_RADIUS_EFF) * dt;
  v.rearWheelSpin += (rearSpinSpeed / WHEEL_RADIUS_EFF) * dt;
  v.wheelSpin = v.rearWheelSpin;

  const slipAngleMag = absSpeed > 3.5 ? Math.abs(Math.atan2(v.lateralSpeed, absSpeed)) : 0;
  const latSkid = clampNum((slipAngleMag - 0.19) / 0.34, 0, 1);

  v.frontSlipRatio = frontSlip;
  v.rearSlipRatio = clampNum(
    Math.max(
      rearBurnoutSpin / 22,
      latSkid,
      input.handbrake && absSpeed > 3.8 ? 0.74 : 0,
    ),
    0,
    1,
  );

  const skidIntensity = clampNum(
    Math.max(
      v.rearSlipRatio,
      v.frontSlipRatio * 0.72,
    ),
    0,
    1,
  );
  v.drifting = skidIntensity > 0.25 || isBurnout;

  if (resolved.impact.hit && resolved.impact.impulseSpeed > 6.0) {
    const dmg = Math.min(30, (resolved.impact.impulseSpeed - 5.5) * 1.65);
    v.health = Math.max(0, v.health - dmg);
    v.damageFlash = 0.18;
  }
  if (v.damageFlash > 0) {
    v.damageFlash = Math.max(0, v.damageFlash - dt);
  }

  // Keep gearShiftDir deterministic if gear jumped down/up cleanly
  if (gearShiftDir === 0 && v.gear !== prevGear && prevGear > 0 && v.gear > 0) {
    gearShiftDir = v.gear > prevGear ? 1 : -1;
  }

  return {
    impact: resolved.impact,
    skidIntensity,
    gearShiftDir,
    curbPulse: maxCurbPulse,
    scrapeIntensity: resolved.scrapeIntensity,
  };
}

const NO_VEH_COLLISION = Object.freeze({
  collided: false,
  impactSpeed: 0,
  contactX: 0,
  contactZ: 0,
  scrapeIntensity: 0,
});

export function resolveVehicleVsVehicle(
  a: VehicleState,
  b: VehicleState,
): {
  collided: boolean;
  impactSpeed: number;
  contactX: number;
  contactZ: number;
  scrapeIntensity: number;
} {
  const halfWA = a.spec.width * 0.48;
  const halfLA = a.spec.length * 0.48;
  const halfWB = b.spec.width * 0.48;
  const halfLB = b.spec.length * 0.48;

  const broadDist = Math.hypot(halfWA, halfLA) + Math.hypot(halfWB, halfLB);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const distSq = dx * dx + dz * dz;
  if (distSq >= broadDist * broadDist || distSq < 1e-8) {
    return NO_VEH_COLLISION;
  }

  const fAx = Math.sin(a.heading);
  const fAz = Math.cos(a.heading);
  const lAx = Math.cos(a.heading);
  const lAz = -Math.sin(a.heading);

  const fBx = Math.sin(b.heading);
  const fBz = Math.cos(b.heading);
  const lBx = Math.cos(b.heading);
  const lBz = -Math.sin(b.heading);

  // SAT across the 4 OBB face normals: lA, fA, lB, fB
  let minOverlap = Infinity;
  let nx = 0;
  let nz = 0;

  const testAxis = (ux: number, uz: number): boolean => {
    const projA = halfWA * Math.abs(ux * lAx + uz * lAz) + halfLA * Math.abs(ux * fAx + uz * fAz);
    const projB = halfWB * Math.abs(ux * lBx + uz * lBz) + halfLB * Math.abs(ux * fBx + uz * fBz);
    const dist = dx * ux + dz * uz;
    const overlap = projA + projB - Math.abs(dist);
    if (overlap <= 0) return false;
    if (overlap < minOverlap) {
      minOverlap = overlap;
      const sign = dist >= 0 ? 1 : -1;
      nx = ux * sign; // Points from A toward B
      nz = uz * sign;
    }
    return true;
  };

  if (!testAxis(lAx, lAz)) return NO_VEH_COLLISION;
  if (!testAxis(fAx, fAz)) return NO_VEH_COLLISION;
  if (!testAxis(lBx, lBz)) return NO_VEH_COLLISION;
  if (!testAxis(fBx, fBz)) return NO_VEH_COLLISION;

  const totalMass = a.spec.mass + b.spec.mass;
  const ratioA = b.spec.mass / totalMass;
  const ratioB = a.spec.mass / totalMass;

  // Separate positions proportional to inverse mass
  a.x -= nx * minOverlap * ratioA;
  a.z -= nz * minOverlap * ratioA;
  b.x += nx * minOverlap * ratioB;
  b.z += nz * minOverlap * ratioB;

  // Estimate contact point from deepest opposing OBB corners along collision normal
  writeOBBCorners(a.x, a.z, lAx, lAz, fAx, fAz, halfWA, halfLA, _obbCornersAX, _obbCornersAZ);
  writeOBBCorners(b.x, b.z, lBx, lBz, fBx, fBz, halfWB, halfLB, _obbCornersBX, _obbCornersBZ);

  let maxProjA = -Infinity;
  for (let i = 0; i < 4; i++) {
    const p = _obbCornersAX[i] * nx + _obbCornersAZ[i] * nz;
    if (p > maxProjA) maxProjA = p;
  }
  let cAX = 0;
  let cAZ = 0;
  let cntA = 0;
  for (let i = 0; i < 4; i++) {
    if (_obbCornersAX[i] * nx + _obbCornersAZ[i] * nz >= maxProjA - 0.14) {
      cAX += _obbCornersAX[i];
      cAZ += _obbCornersAZ[i];
      cntA++;
    }
  }
  cAX /= Math.max(1, cntA);
  cAZ /= Math.max(1, cntA);

  let minProjB = Infinity;
  for (let i = 0; i < 4; i++) {
    const p = _obbCornersBX[i] * nx + _obbCornersBZ[i] * nz;
    if (p < minProjB) minProjB = p;
  }
  let cBX = 0;
  let cBZ = 0;
  let cntB = 0;
  for (let i = 0; i < 4; i++) {
    if (_obbCornersBX[i] * nx + _obbCornersBZ[i] * nz <= minProjB + 0.14) {
      cBX += _obbCornersBX[i];
      cBZ += _obbCornersBZ[i];
      cntB++;
    }
  }
  cBX /= Math.max(1, cntB);
  cBZ /= Math.max(1, cntB);

  const contactX = cntA <= cntB ? cAX : cBX;
  const contactZ = cntA <= cntB ? cAZ : cBZ;

  const rAx = contactX - a.x;
  const rAz = contactZ - a.z;
  const rBx = contactX - b.x;
  const rBz = contactZ - b.z;

  const inertiaA = (a.spec.mass * (a.spec.width * a.spec.width + a.spec.length * a.spec.length)) / 12;
  const inertiaB = (b.spec.mass * (b.spec.width * b.spec.width + b.spec.length * b.spec.length)) / 12;

  const vAx = a.vx + a.angularVel * rAz;
  const vAz = a.vz - a.angularVel * rAx;
  const vBx = b.vx + b.angularVel * rBz;
  const vBz = b.vz - b.angularVel * rBx;

  const rvx = vBx - vAx;
  const rvz = vBz - vAz;
  const velAlongNormal = rvx * nx + rvz * nz;

  if (velAlongNormal > 0) {
    return {
      collided: true,
      impactSpeed: 0,
      contactX,
      contactZ,
      scrapeIntensity: 0,
    };
  }

  const rACrossN = nx * rAz - nz * rAx;
  const rBCrossN = nx * rBz - nz * rBx;
  const denomN =
    1 / a.spec.mass +
    1 / b.spec.mass +
    (rACrossN * rACrossN) / inertiaA +
    (rBCrossN * rBCrossN) / inertiaB;

  const restitution = 0.34;
  const j = (-(1 + restitution) * velAlongNormal) / denomN;
  const impX = j * nx;
  const impZ = j * nz;

  a.vx -= impX / a.spec.mass;
  a.vz -= impZ / a.spec.mass;
  a.angularVel -= (impX * rAz - impZ * rAx) / inertiaA;

  b.vx += impX / b.spec.mass;
  b.vz += impZ / b.spec.mass;
  b.angularVel += (impX * rBz - impZ * rBx) / inertiaB;

  // Tangential friction (scraping / PIT maneuver spin)
  const tx = -nz;
  const tz = nx;
  const vt = rvx * tx + rvz * tz;
  const rACrossT = tx * rAz - tz * rAx;
  const rBCrossT = tx * rBz - tz * rBx;
  const denomT =
    1 / a.spec.mass +
    1 / b.spec.mass +
    (rACrossT * rACrossT) / inertiaA +
    (rBCrossT * rBCrossT) / inertiaB;
  const jt = clampNum(-vt / denomT, -0.32 * j, 0.32 * j);
  const impTx = jt * tx;
  const impTz = jt * tz;

  a.vx -= impTx / a.spec.mass;
  a.vz -= impTz / a.spec.mass;
  a.angularVel -= (impTx * rAz - impTz * rAx) / inertiaA;

  b.vx += impTx / b.spec.mass;
  b.vz += impTz / b.spec.mass;
  b.angularVel += (impTx * rBz - impTz * rBx) / inertiaB;

  const impactSpeed = Math.abs(velAlongNormal);
  const scrapeIntensity =
    Math.abs(vt) > 2.2
      ? clampNum((Math.abs(vt) * Math.min(1, impactSpeed * 0.25 + 0.2)) / 14, 0, 1)
      : 0;

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
    contactX,
    contactZ,
    scrapeIntensity,
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

  // Push out of solid parked/moving vehicles using accurate OBB footprint (no oversized circular door bubble)
  const playerBodyRadius = 0.40;
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    const dx = player.x - v.x;
    const dz = player.z - v.z;
    const maxReach = v.spec.length * 0.55 + playerBodyRadius + 0.5;
    if (dx * dx + dz * dz > maxReach * maxReach) continue;

    const cosH = Math.cos(v.heading);
    const sinH = Math.sin(v.heading);
    const localX = dx * cosH - dz * sinH;
    const localZ = dx * sinH + dz * cosH;
    const halfW = v.spec.width * 0.5;
    const halfL = v.spec.length * 0.5;

    const closestX = Math.max(-halfW, Math.min(localX, halfW));
    const closestZ = Math.max(-halfL, Math.min(localZ, halfL));
    const ox = localX - closestX;
    const oz = localZ - closestZ;
    const dSq = ox * ox + oz * oz;

    if (dSq < playerBodyRadius * playerBodyRadius) {
      let pushLocalX = localX;
      let pushLocalZ = localZ;
      if (dSq > 1e-6) {
        const d = Math.sqrt(dSq);
        pushLocalX = closestX + (ox / d) * playerBodyRadius;
        pushLocalZ = closestZ + (oz / d) * playerBodyRadius;
      } else {
        const penX = halfW - Math.abs(localX);
        const penZ = halfL - Math.abs(localZ);
        if (penX < penZ) {
          pushLocalX = (localX >= 0 ? 1 : -1) * (halfW + playerBodyRadius);
        } else {
          pushLocalZ = (localZ >= 0 ? 1 : -1) * (halfL + playerBodyRadius);
        }
      }
      player.x = v.x + pushLocalX * cosH + pushLocalZ * sinH;
      player.z = v.z - pushLocalX * sinH + pushLocalZ * cosH;
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

/**
 * Computes a world-space point relative to a vehicle's local coordinate frame
 * (+Z forward, +X driver left side, -X passenger right side).
 */
export function computeVehicleDoorWorldPoint(
  car: Pick<VehicleState, 'x' | 'z' | 'heading'>,
  side: 1 | -1,
  lateralDist: number,
  forwardOffset = 0,
): { x: number; z: number } {
  const cosH = Math.cos(car.heading);
  const sinH = Math.sin(car.heading);
  return {
    x: car.x + side * lateralDist * cosH + forwardOffset * sinH,
    z: car.z - side * lateralDist * sinH + forwardOffset * cosH,
  };
}

/**
 * Selects the entry/exit door side: strongly prefers the driver side (+1 / local +X),
 * falling back to passenger side (-1 / local -X) only if the driver side is blocked
 * by a static collider (building wall, fence, or palm trunk).
 */
export function chooseVehicleEntrySide(
  car: Pick<VehicleState, 'x' | 'z' | 'heading'>,
  colliders: StaticColliderSource,
): 1 | -1 {
  const driverPt = computeVehicleDoorWorldPoint(car, 1, 1.52, -0.05);
  if (!probePointBlocked(driverPt.x, driverPt.z, 0.48, colliders)) {
    return 1;
  }
  const passPt = computeVehicleDoorWorldPoint(car, -1, 1.52, -0.05);
  if (!probePointBlocked(passPt.x, passPt.z, 0.48, colliders)) {
    return -1;
  }
  return 1;
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

  // Building / Tree Avoidance Whisker Feelers adapted for true OBB footprint
  let avoidSteer = 0;
  let wallAhead = false;
  if (hasAnyColliders(colliders)) {
    const lookDist = Math.max(5.5, Math.min(10.5, Math.abs(v.speed) * 0.65 + 4.0));
    const margin = Math.max(v.spec.radius, v.spec.width * 0.5 + 0.42);
    const hitCenter = probePointBlocked(v.x + fx * lookDist, v.z + fz * lookDist, margin, colliders);
    const hitLeft = probePointBlocked(
      v.x + (fx * 0.92 + leftX * 0.28) * lookDist,
      v.z + (fz * 0.92 + leftZ * 0.28) * lookDist,
      margin,
      colliders,
    );
    const hitRight = probePointBlocked(
      v.x + (fx * 0.92 - leftX * 0.28) * lookDist,
      v.z + (fz * 0.92 - leftZ * 0.28) * lookDist,
      margin,
      colliders,
    );

    if (hitLeft && !hitRight) {
      avoidSteer = -0.82; // Obstacle on left -> steer right (-steer)
    } else if (hitRight && !hitLeft) {
      avoidSteer = 0.82; // Obstacle on right -> steer left (+steer)
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
    if (pFwd > 0 && pFwd < 12.0 && pSide < 3.1) {
      obstacleAhead = true;
    }
    for (let i = 0; i < allVehicles.length; i++) {
      const other = allVehicles[i];
      if (other.id === v.id) continue;
      const odx = other.x - v.x;
      const odz = other.z - v.z;
      const oFwd = odx * fx + odz * fz;
      const oSide = Math.abs(odx * fz - odz * fx);
      if (oFwd > 0 && oFwd < 13.0 && oSide < 3.1) {
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
        ? 6.8
        : 13.5;

  if (obstacleAhead) {
    return { throttle: 0, brake: 0.92, steer, handbrake: false, nitro: false };
  }

  const throttle = v.speed < desiredSpeed ? (isPursuingPolice ? 0.92 : 0.6) : 0.04;
  const brake = v.speed > desiredSpeed + 2.0 ? 0.72 : 0;

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
  const groundY = sampleRoadSurfaceHeight(x, z);
  return {
    id,
    spec: VEHICLE_SPECS[kind],
    x,
    y: groundY,
    z,
    vx: 0,
    vz: 0,
    heading,
    angularVel: 0,
    steerAngle: 0,
    visualSteerAngle: 0,
    speed: 0,
    lateralSpeed: 0,
    longAccel: 0,
    latAccel: 0,
    rpm: 920,
    gear: 1,
    pitch: 0,
    roll: 0,
    chassisHeave: 0,
    chassisHeaveVel: 0,
    wheelCompression: [0, 0, 0, 0],
    wheelCompressionVel: [0, 0, 0, 0],
    wheelGroundY: [groundY, groundY, groundY, groundY],
    wheelSpin: 0,
    frontWheelSpin: 0,
    rearWheelSpin: 0,
    rearSlipRatio: 0,
    frontSlipRatio: 0,
    absActive: false,
    shiftCutTimer: 0,
    shiftKickDir: 0,
    reverseHoldTimer: 0,
    curbImpactPulse: 0,
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
