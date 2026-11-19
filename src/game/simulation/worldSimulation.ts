import type {
  ControlInput,
  PedState,
  PlayerState,
  VehicleState,
  WeatherType,
} from '../types';
import {
  computeVehicleAIControls,
  findNearestEnterableVehicle,
  resolveVehicleVsVehicle,
  stepPedestrianAI,
  stepPlayerOnFoot,
  stepVehiclePhysics,
} from '../physics';
import { getDistrictName } from '../worldLayout';
import type { SpatialHashGrid } from './spatialHash';
import type { GameEventBus } from '../core/eventBus';

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
}

/**
 * Pure headless open-world simulation step (zero Three.js/DOM dependencies).
 * Runs vehicle physics, pairwise collisions, on-foot player locomotion,
 * spatial-hash-accelerated broad-phase collision queries, and 3-tier NPC
 * simulation LOD (< 70m full rate, 70-120m 1/4 rate, > 120m hibernate except
 * active chasing LSPD).
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

  // 1. Handle Enter / Exit Vehicle edge trigger
  if (input.enterVehiclePressed) {
    if (player.inVehicleId) {
      const car = vehicles.find((v) => v.id === player.inVehicleId);
      if (car) {
        car.driver = 'none';
        const sideX = Math.cos(car.heading) * (car.spec.width * 0.5 + 1.0);
        const sideZ = -Math.sin(car.heading) * (car.spec.width * 0.5 + 1.0);
        player.x = car.x - sideX;
        player.z = car.z - sideZ;
        player.y = 0;
        player.vx = car.vx * 0.25;
        player.vz = car.vz * 0.25;
        player.heading = car.heading;
      }
      player.inVehicleId = null;
      vehicleEnteredOrExited = true;
      eventBus.emit('sfx:play', { kind: 'door' });
    } else {
      const near = findNearestEnterableVehicle(player.x, player.z, vehicles);
      if (near) {
        if (near.driver === 'police' || near.spec.isPolice) {
          eventBus.emit('crime:wanted', { targetLevel: 2, reason: 'steal_police' });
        } else if (near.driver === 'civilian') {
          eventBus.emit('crime:wanted', { targetLevel: 1, reason: 'carjack' });
        }
        near.driver = 'player';
        player.inVehicleId = near.id;
        vehicleEnteredOrExited = true;
        eventBus.emit('sfx:play', { kind: 'door' });
        eventBus.emit('banner:show', { text: near.spec.name, duration: 1.8 });
      }
    }
  }

  const prevX = player.x;
  const prevZ = player.z;

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

      if (res.skidIntensity > 0.3 && Math.random() < 0.65) {
        const isWet = weather === 'rain' || weather === 'storm';
        const rearX = v.x - Math.sin(v.heading) * (v.spec.length * 0.36);
        const rearZ = v.z - Math.cos(v.heading) * (v.spec.length * 0.36);
        eventBus.emit('particle:burst', {
          x: rearX,
          y: 0.2,
          z: rearZ,
          count: 2,
          kind: isWet ? 'spray' : 'smoke',
        });
      }

      if (res.impact.hit && res.impact.impulseSpeed > 5.0) {
        const norm = Math.min(1, res.impact.impulseSpeed / 22);
        eventBus.emit('camera:trauma', { amount: norm * 0.72 });
        eventBus.emit('sfx:play', { kind: 'impact', intensity: norm });
        eventBus.emit('particle:burst', {
          x: v.x - res.impact.normalX * 1.2,
          y: 0.7,
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
      player.y = 0;
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
      if (
        Math.abs(v.vx) > 1e-4 ||
        Math.abs(v.vz) > 1e-4 ||
        Math.abs(v.speed) > 1e-4 ||
        Math.abs(v.pitch) > 1e-4 ||
        Math.abs(v.roll) > 1e-4
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
      if (col.collided && col.impactSpeed > 4.2) {
        const involvesPlayer =
          a.id === player.inVehicleId || b.id === player.inVehicleId;
        if (involvesPlayer) {
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

  // 4. Player On-Foot Locomotion
  if (!playerCar) {
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
        // > 120m: hibernate distant off-screen NPCs
        continue;
      }
      if (distSq > 4900) {
        // 70m-120m: run at 1/4 simulation frequency with compensated dt
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
  };
}
