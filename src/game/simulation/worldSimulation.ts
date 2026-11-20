import type {
  ControlInput,
  PedState,
  PlayerState,
  VehicleState,
  WeatherType,
} from '../types';
import {
  chooseVehicleEntrySide,
  computeVehicleDoorWorldPoint,
  computeVehicleAIControls,
  findNearestEnterableVehicle,
  resolveCircleVsAABBs,
  resolveVehicleVsVehicle,
  stepPedestrianAI,
  stepPlayerOnFoot,
  stepVehiclePhysics,
} from '../physics';
import { getDistrictName } from '../worldLayout';
import type { SpatialHashGrid } from './spatialHash';
import type { GameEventBus } from '../core/eventBus';
import {
  ENTER_VEHICLE_DURATION_SEC,
  EXIT_VEHICLE_DURATION_SEC,
  evaluateVehicleEntryPose,
  evaluateVehicleExitPose,
} from './vehicleEntryChoreography';

export { ENTER_VEHICLE_DURATION_SEC, EXIT_VEHICLE_DURATION_SEC };

export interface WorldSimulationStepParams {
  dt: number;
  simTimeSec: number;
  tickIndex: number;
  input: ControlInput;
  cameraYaw: number;
  weather: WeatherType;
  player: PlayerState;
  vehicles: VehicleState[];
  peds: PedState[];
  spatialGrid: SpatialHashGrid;
  wantedLevel: number;
  wantedCooldown: number;
  lastDistrict: string;
  eventBus: GameEventBus;
}

export interface WorldSimulationStepResult {
  playerCar: VehicleState | null;
  playerSkid: number;
  stepDistanceMeters: number;
  wantedLevel: number;
  wantedCooldown: number;
  lastDistrict: string;
  hitstopDelta: number;
  sirenProximity: number;
  vehicleEnteredOrExited: boolean;
  transitionDoorPulseVehicleId: string | null;
}

/**
 * Pure headless open-world simulation step (zero Three.js/DOM dependencies).
 * Runs multi-phase AAA vehicle entry/exit state machine, vehicle physics,
 * pairwise collisions, on-foot player locomotion, spatial-hash-accelerated
 * broad-phase queries, and 3-tier NPC simulation LOD.
 */
export function stepOpenWorldSimulation(
  params: WorldSimulationStepParams,
): WorldSimulationStepResult {
  const {
    dt,
    simTimeSec,
    tickIndex,
    input,
    cameraYaw,
    weather,
    player,
    vehicles,
    peds,
    spatialGrid,
    eventBus,
  } = params;

  let wantedLevel = params.wantedLevel;
  let wantedCooldown = params.wantedCooldown;
  let lastDistrict = params.lastDistrict;
  let hitstopDelta = 0;
  let vehicleEnteredOrExited = false;
  let transitionDoorPulseVehicleId: string | null = null;

  const trans = player.vehicleTransition;

  // 1. Handle Enter / Exit Vehicle edge trigger (initiates multi-phase AAA sequence)
  if (input.enterVehiclePressed && trans.mode === 'none') {
    if (player.inVehicleId) {
      const car = vehicles.find((v) => v.id === player.inVehicleId);
      if (car) {
        const side = chooseVehicleEntrySide(car, spatialGrid);
        car.driver = 'none';
        player.inVehicleId = null;
        trans.mode = 'exiting';
        trans.vehicleId = car.id;
        trans.side = side;
        trans.progress = 0;
        trans.duration = EXIT_VEHICLE_DURATION_SEC;
        trans.startX = car.x;
        trans.startZ = car.z;
        trans.startHeading = car.heading;
        transitionDoorPulseVehicleId = car.id;
        vehicleEnteredOrExited = true;
        eventBus.emit('sfx:play', { kind: 'door' });
      }
    } else {
      const near = findNearestEnterableVehicle(player.x, player.z, vehicles, 4.8);
      if (near) {
        if (near.driver === 'police' || near.spec.isPolice) {
          eventBus.emit('crime:wanted', { targetLevel: 2, reason: 'steal_police' });
        } else if (near.driver === 'civilian') {
          eventBus.emit('crime:wanted', { targetLevel: 1, reason: 'carjack' });
        }
        near.driver = 'none';
        const side = chooseVehicleEntrySide(near, spatialGrid);
        trans.mode = 'entering';
        trans.vehicleId = near.id;
        trans.side = side;
        trans.progress = 0;
        trans.duration = ENTER_VEHICLE_DURATION_SEC;
        trans.startX = player.x;
        trans.startZ = player.z;
        trans.startHeading = player.heading;
        player.vx = 0;
        player.vy = 0;
        player.vz = 0;
        player.y = 0;
        player.grounded = true;
        // Pulse dihedral butterfly door open immediately on entry start so it clears the sill before step-in
        transitionDoorPulseVehicleId = near.id;
        vehicleEnteredOrExited = true;
        eventBus.emit('sfx:play', { kind: 'door' });
      }
    }
  }

  const prevX = player.x;
  const prevZ = player.z;

  // 1b. Advance active AAA Vehicle Entry / Exit State Machine
  if (trans.mode !== 'none') {
    const targetCar = vehicles.find((v) => v.id === trans.vehicleId);
    if (!targetCar) {
      trans.mode = 'none';
      trans.vehicleId = null;
      trans.progress = 0;
    } else {
      const prevProgress = trans.progress;
      trans.progress = Math.min(1, trans.progress + dt / Math.max(0.1, trans.duration));

      if (trans.mode === 'entering') {
        if (prevProgress < 0.94 && trans.progress >= 0.94) {
          eventBus.emit('sfx:play', { kind: 'door' });
        }

        // Exact same C1 spatial trajectory as 3D rig so camera & minimap stay 100% locked to CJ
        const pose = evaluateVehicleEntryPose({
          progress: trans.progress,
          side: trans.side,
          startX: trans.startX,
          startZ: trans.startZ,
          startHeading: trans.startHeading,
          car: targetCar,
        });
        player.x = pose.posX;
        player.z = pose.posZ;
        player.heading = pose.rotY;

        if (trans.progress >= 1.0) {
          trans.mode = 'none';
          trans.vehicleId = null;
          trans.progress = 0;
          player.inVehicleId = targetCar.id;
          targetCar.driver = 'player';
          player.x = targetCar.x;
          player.z = targetCar.z;
          player.y = 0;
          player.heading = targetCar.heading;
          vehicleEnteredOrExited = true;
          eventBus.emit('banner:show', { text: targetCar.spec.name, duration: 1.8 });
        }
      } else {
        // exiting
        if (prevProgress < 0.94 && trans.progress >= 0.94) {
          eventBus.emit('sfx:play', { kind: 'door' });
        }

        const exitPt = computeVehicleDoorWorldPoint(targetCar, trans.side, 1.58, -0.26);
        const pose = evaluateVehicleExitPose({
          progress: trans.progress,
          side: trans.side,
          car: targetCar,
        });
        player.x = pose.posX;
        player.z = pose.posZ;
        player.heading = pose.rotY;

        if (trans.progress >= 1.0) {
          const safe = resolveCircleVsAABBs(
            exitPt.x,
            exitPt.z,
            0,
            0,
            0.45,
            spatialGrid,
            0,
          );
          trans.mode = 'none';
          trans.vehicleId = null;
          trans.progress = 0;
          player.x = safe.x;
          player.z = safe.z;
          player.y = 0;
          player.vx = 0;
          player.vz = 0;
          player.grounded = true;
          player.heading = targetCar.heading;
          vehicleEnteredOrExited = true;
        }
      }
    }
  }

  let playerSkid = 0;
  let playerCar: VehicleState | null = null;

  // 2. Vehicles (Player + Civilian Traffic + LSPD Interceptors)
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];

    if (v.id === player.inVehicleId) {
      playerCar = v;
      const steerInput = input.left - input.right;
      const res = stepVehiclePhysics(
        v,
        {
          throttle: input.forward,
          brake: input.backward,
          steer: steerInput,
          handbrake: input.handbrake,
          nitro: input.sprintOrNitro,
        },
        weather,
        spatialGrid,
        dt,
      );
      playerSkid = res.skidIntensity;

      if (res.gearShiftDir !== 0) {
        eventBus.emit('sfx:play', { kind: 'gear_shift', up: res.gearShiftDir > 0 });
      }
      if (res.curbPulse > 0.22) {
        eventBus.emit('sfx:play', { kind: 'curb_bump', intensity: res.curbPulse });
        eventBus.emit('camera:trauma', { amount: res.curbPulse * 0.14 });
      }
      if (res.scrapeIntensity > 0.16) {
        eventBus.emit('sfx:play', { kind: 'scrape', intensity: res.scrapeIntensity });
        if (res.scrapeIntensity > 0.28 && Math.random() < 0.72) {
          eventBus.emit('particle:burst', {
            x: v.x - res.impact.normalX * 0.95,
            y: v.y + 0.45,
            z: v.z - res.impact.normalZ * 0.95,
            count: 3,
            kind: 'spark',
          });
        }
      }

      const isWet = weather === 'rain' || weather === 'storm';
      const rearIntensity = Math.max(v.rearSlipRatio, v.drifting ? res.skidIntensity : res.skidIntensity * 0.65);
      const frontIntensity = v.frontSlipRatio;
      if (rearIntensity > 0.25 || frontIntensity > 0.34) {
        const sinH = Math.sin(v.heading);
        const cosH = Math.cos(v.heading);
        const sideOffset = v.spec.trackWidth * 0.49;
        const leftX = cosH * sideOffset;
        const leftZ = -sinH * sideOffset;

        if (rearIntensity > 0.25) {
          const lr = v.spec.wheelbase * v.spec.frontWeightBias;
          const rearX = v.x - sinH * lr;
          const rearZ = v.z - cosH * lr;

          // Tire contact-patch ejection vector: partial car velocity + backward tire spin jet + wheel-arch wake
          const jetBack = 2.4 + v.rearSlipRatio * 5.6;
          const baseVx = v.vx * 0.32 - sinH * jetBack;
          const baseVz = v.vz * 0.32 - cosH * jetBack;
          const latSpread = 0.78 + rearIntensity * 1.35 + Math.min(1.0, Math.abs(v.speed) * 0.03);
          const upLift = 0.36 + rearIntensity * 0.54;

          const shouldEmit = rearIntensity > 0.42 || (tickIndex & 1) === 0;
          if (shouldEmit) {
            const puffCount = rearIntensity > 0.72 ? 2 : 1;
            eventBus.emit('particle:burst', {
              x: rearX + leftX,
              y: v.wheelGroundY[2] + 0.08,
              z: rearZ + leftZ,
              count: puffCount,
              kind: isWet ? 'spray' : 'smoke',
              vx: baseVx + cosH * latSpread,
              vy: upLift,
              vz: baseVz - sinH * latSpread,
              intensity: rearIntensity,
            });
            eventBus.emit('particle:burst', {
              x: rearX - leftX,
              y: v.wheelGroundY[3] + 0.08,
              z: rearZ - leftZ,
              count: puffCount,
              kind: isWet ? 'spray' : 'smoke',
              vx: baseVx - cosH * latSpread,
              vy: upLift,
              vz: baseVz + sinH * latSpread,
              intensity: rearIntensity,
            });
          }
        }

        // Front tire brake lockup / heavy understeer smoke wisps
        if (!isWet && frontIntensity > 0.34 && (tickIndex & 1) === 0) {
          const lf = v.spec.wheelbase * (1 - v.spec.frontWeightBias);
          const frontX = v.x + sinH * lf;
          const frontZ = v.z + cosH * lf;
          const frontJet = 1.6 + frontIntensity * 2.4;
          const fVx = v.vx * 0.36 - sinH * frontJet;
          const fVz = v.vz * 0.36 - cosH * frontJet;
          const fSpread = 0.65 + frontIntensity * 0.75;
          eventBus.emit('particle:burst', {
            x: frontX + leftX,
            y: v.wheelGroundY[0] + 0.07,
            z: frontZ + leftZ,
            count: 1,
            kind: 'smoke',
            vx: fVx + cosH * fSpread,
            vy: 0.30,
            vz: fVz - sinH * fSpread,
            intensity: Math.min(0.85, frontIntensity * 0.85),
          });
          eventBus.emit('particle:burst', {
            x: frontX - leftX,
            y: v.wheelGroundY[1] + 0.07,
            z: frontZ - leftZ,
            count: 1,
            kind: 'smoke',
            vx: fVx - cosH * fSpread,
            vy: 0.30,
            vz: fVz + sinH * fSpread,
            intensity: Math.min(0.85, frontIntensity * 0.85),
          });
        }
      }

      if (res.impact.hit && res.impact.impulseSpeed > 5.0) {
        const norm = Math.min(1, res.impact.impulseSpeed / 22);
        eventBus.emit('camera:trauma', { amount: norm * 0.72 });
        eventBus.emit('sfx:play', { kind: 'impact', intensity: norm });
        eventBus.emit('particle:burst', {
          x: v.x - res.impact.normalX * 1.2,
          y: v.y + 0.7,
          z: v.z - res.impact.normalZ * 1.2,
          count: Math.round(8 + norm * 16),
          kind: 'spark',
        });
        if (res.impact.impulseSpeed > 12) {
          hitstopDelta = Math.max(hitstopDelta, 0.045);
          eventBus.emit('player:damage', {
            amount: res.impact.impulseSpeed * 0.55,
            source: 'wall_crash',
          });
        }
      }

      player.x = v.x;
      player.z = v.z;
      player.y = v.y;
      player.heading = v.heading;
    } else if (v.driver === 'civilian' || v.driver === 'police') {
      const aiCtrl = computeVehicleAIControls(
        v,
        0,
        0,
        wantedLevel,
        player.x,
        player.z,
        vehicles,
        dt,
        spatialGrid,
      );
      stepVehiclePhysics(v, aiCtrl, weather, spatialGrid, dt);
    } else {
      const isTransitionCar =
        trans.mode !== 'none' && trans.vehicleId === v.id;
      if (isTransitionCar) {
        // Rapidly bring vehicle to gentle halt during entry/exit choreography
        v.vx *= Math.exp(-10 * dt);
        v.vz *= Math.exp(-10 * dt);
        v.speed *= Math.exp(-10 * dt);
        stepVehiclePhysics(
          v,
          { throttle: 0, brake: 1, steer: 0, handbrake: true, nitro: false },
          weather,
          spatialGrid,
          dt,
        );
      } else if (
        Math.abs(v.vx) > 1e-4 ||
        Math.abs(v.vz) > 1e-4 ||
        Math.abs(v.speed) > 1e-4 ||
        Math.abs(v.pitch) > 1e-4 ||
        Math.abs(v.roll) > 1e-4 ||
        Math.abs(v.chassisHeaveVel) > 1e-4
      ) {
        stepVehiclePhysics(
          v,
          { throttle: 0, brake: 0.4, steer: 0, handbrake: true, nitro: false },
          weather,
          spatialGrid,
          dt,
        );
      }
    }
  }

  // 3. Pairwise Vehicle-vs-Vehicle Momentum Collisions
  for (let i = 0; i < vehicles.length; i++) {
    for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i];
      const b = vehicles[j];
      const col = resolveVehicleVsVehicle(a, b);
      if (col.collided) {
        const involvesPlayer =
          a.id === player.inVehicleId || b.id === player.inVehicleId;
        if (involvesPlayer && col.scrapeIntensity > 0.18) {
          eventBus.emit('sfx:play', { kind: 'scrape', intensity: col.scrapeIntensity });
          if (Math.random() < 0.7) {
            eventBus.emit('particle:burst', {
              x: col.contactX,
              y: 0.55,
              z: col.contactZ,
              count: 4,
              kind: 'spark',
            });
          }
        }
        if (col.impactSpeed > 4.2 && involvesPlayer) {
          const norm = Math.min(1, col.impactSpeed / 20);
          eventBus.emit('camera:trauma', { amount: norm * 0.68 });
          eventBus.emit('sfx:play', { kind: 'impact', intensity: norm });
          eventBus.emit('particle:burst', {
            x: col.contactX,
            y: 0.75,
            z: col.contactZ,
            count: 16,
            kind: 'spark',
          });
          if (col.impactSpeed > 10) {
            hitstopDelta = Math.max(hitstopDelta, 0.045);
          }
          if (a.spec.isPolice || b.spec.isPolice) {
            eventBus.emit('crime:wanted', {
              targetLevel: Math.max(2, wantedLevel + 1),
              reason: 'ram_police',
            });
          } else if (col.impactSpeed > 11) {
            eventBus.emit('crime:wanted', { targetLevel: 1, reason: 'reckless_crash' });
          }
        }
      }
    }
  }

  // 4. Player On-Foot Locomotion (disabled while inside vehicle or AAA transition)
  if (!playerCar && trans.mode === 'none') {
    stepPlayerOnFoot(player, input, cameraYaw, spatialGrid, vehicles, dt);
  }

  // 5. Pedestrians & Ballas Gang Rivals (3-Tier Distance Simulation LOD)
  const playerSpeed = playerCar
    ? Math.abs(playerCar.speed)
    : Math.hypot(player.vx, player.vz);
  const tickMod4 = tickIndex & 3;

  for (let i = 0; i < peds.length; i++) {
    const ped = peds[i];
    const dx = ped.x - player.x;
    const dz = ped.z - player.z;
    const distSq = dx * dx + dz * dz;

    let effDt = dt;
    const isActivePolice = ped.role === 'police_foot' && wantedLevel > 0;
    if (!isActivePolice) {
      if (distSq > 14400) {
        continue;
      }
      if (distSq > 4900) {
        if ((i & 3) !== tickMod4) continue;
        effDt = dt * 4;
      }
    }

    const pedRes = stepPedestrianAI(
      ped,
      player.x,
      player.z,
      Boolean(playerCar),
      playerSpeed,
      spatialGrid,
      effDt,
      wantedLevel,
      simTimeSec,
    );
    if (pedRes.dealtDamageToPlayer > 0) {
      eventBus.emit('player:damage', {
        amount: pedRes.dealtDamageToPlayer,
        source: 'npc_melee',
      });
    }

    if (playerCar && playerSpeed > 6.5 && ped.state !== 'ko') {
      const d = Math.hypot(ped.x - playerCar.x, ped.z - playerCar.z);
      if (d < playerCar.spec.radius + 0.55) {
        ped.state = 'ko';
        ped.koTimer = 0;
        ped.vx = playerCar.vx * 1.1;
        ped.vz = playerCar.vz * 1.1;
        ped.hitFlash = 0.2;
        eventBus.emit('sfx:play', { kind: 'impact', intensity: 0.65 });
        eventBus.emit('crime:wanted', {
          targetLevel: Math.max(1, wantedLevel + 1),
          reason: 'vehicular_assault',
        });
      }
    }
  }

  // 6. Distance & District Tracking
  const stepDistanceMeters = Math.hypot(player.x - prevX, player.z - prevZ);
  const district = getDistrictName(player.x, player.z);
  if (district !== lastDistrict) {
    lastDistrict = district;
    eventBus.emit('banner:show', { text: district, duration: 2.2 });
  }

  // 7. Wanted Level Decay & Nearest Police Siren Proximity
  let sirenProximity = 0;
  if (wantedLevel > 0) {
    let nearestCopDist = 999;
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (v.driver === 'police') {
        const d = Math.hypot(v.x - player.x, v.z - player.z);
        if (d < nearestCopDist) nearestCopDist = d;
      }
      if (v.sirenOn) {
        const d = Math.hypot(v.x - player.x, v.z - player.z);
        sirenProximity = Math.max(sirenProximity, Math.max(0, 1 - d / 85));
      }
    }
    if (nearestCopDist > 42) {
      wantedCooldown -= dt;
      if (wantedCooldown <= 0) {
        wantedLevel = Math.max(0, wantedLevel - 1);
        wantedCooldown = 22;
      }
    }
  }

  return {
    playerCar,
    playerSkid,
    stepDistanceMeters,
    wantedLevel,
    wantedCooldown,
    lastDistrict,
    hitstopDelta,
    sirenProximity,
    vehicleEnteredOrExited,
    transitionDoorPulseVehicleId,
  };
}
