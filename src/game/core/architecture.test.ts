import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GameEventBus } from './eventBus';
import { ResourceScope } from './resourceScope';
import { SimulationClock } from './clock';
import { GameHudStore } from './gameStore';
import { SpatialHashGrid } from '../simulation/spatialHash';
import { ActivityRegistry, type ActivityContext } from '../simulation/activities/activityTypes';
import { CheckpointActivity } from '../simulation/activities/checkpointActivity';
import { RobberyActivity } from '../simulation/activities/robberyActivity';
import { resolveCircleVsAABBs, stepPedestrianAI } from '../physics';
import { buildStaticColliders, INITIAL_CHECKPOINTS, SHOPS } from '../worldLayout';
import {
  computeAckermannSteer,
  computeTriCoatColors,
  stepHydraulic,
} from '../rendering/hypercarBuilders';
import {
  resetYieldBudgetClock,
  yieldIfOverBudget,
  yieldToMainThread,
} from './asyncBoot';
import type { ControlInput, HUDState, PedState } from '../types';

function createEmptyInput(): ControlInput {
  return {
    forward: 0,
    backward: 0,
    left: 0,
    right: 0,
    handbrake: false,
    sprintOrNitro: false,
    jumpOrAction: false,
    enterVehiclePressed: false,
    cameraOrbitDeltaX: 0,
    cameraOrbitDeltaY: 0,
  };
}

function createSampleHud(): HUDState {
  return {
    phase: 'playing',
    cash: 350,
    health: 100,
    armor: 50,
    wantedLevel: 0,
    inVehicle: true,
    vehicleName: 'GREENWOOD',
    speedKmh: 0,
    gear: '1',
    rpmRatio: 0.1,
    nitro: 100,
    vehicleHealth: 100,
    district: 'GROVE STREET',
    weather: 'golden',
    timePreset: 'sunset',
    clockText: '17:30',
    cameraMode: 'chase',
    muted: false,
    fps: 60,
    outfitId: 'classic_cj',
    checkpointsCleared: 0,
    totalCheckpoints: 6,
    objectiveLabel: 'CRUCE DE GANTON BLVD',
    bannerText: null,
    nearVehicleName: null,
    nearShop: null,
    activeShop: null,
    activeShopCooldown: 0,
    robbery: null,
    touchControlsVisible: false,
    runSummary: null,
  };
}

test('SpatialHashGrid produces identical collision resolution to brute-force linear AABB scan across Los Santos', () => {
  const colliders = buildStaticColliders();
  const grid = new SpatialHashGrid(colliders, 16);

  assert.equal(grid.colliderCount, colliders.length);
  assert.ok(grid.bucketCount > 20, 'SpatialHashGrid should partition colliders into multiple cells');

  // Probe 120 sample positions across streets, corners, and building edges
  for (let i = 0; i < 120; i++) {
    const x = ((i * 37) % 300) - 150;
    const z = ((i * 53) % 300) - 150;
    const vx = ((i % 7) - 3) * 4;
    const vz = ((i % 5) - 2) * 4;
    const radius = i % 2 === 0 ? 1.85 : 0.45;

    const linear = resolveCircleVsAABBs(x, z, vx, vz, radius, colliders);
    const hashed = resolveCircleVsAABBs(x, z, vx, vz, radius, grid);

    assert.ok(
      Math.abs(linear.x - hashed.x) < 1e-6 && Math.abs(linear.z - hashed.z) < 1e-6,
      `Position mismatch at (${x},${z}): linear=(${linear.x},${linear.z}) vs grid=(${hashed.x},${hashed.z})`,
    );
    assert.equal(linear.impact.hit, hashed.impact.hit, `Hit flag mismatch at (${x},${z})`);
  }
});

test('ResourceScope disposes tracked geometries, materials, child scopes, and cleanups deterministically without double-dispose', () => {
  const parentScope = new ResourceScope();
  const childScope = parentScope.createChildScope();

  let cleanupOrder: string[] = [];
  let customDisposeCount = 0;

  parentScope.track({
    dispose: () => {
      customDisposeCount++;
      cleanupOrder.push('parent_res');
    },
  });
  parentScope.trackCleanup(() => cleanupOrder.push('parent_cleanup'));

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  childScope.trackObjectTree(mesh);
  childScope.trackCleanup(() => cleanupOrder.push('child_cleanup'));

  // Disposing child only frees child resources
  childScope.dispose();
  assert.equal(childScope.isDisposed, true);
  assert.equal(parentScope.isDisposed, false);
  assert.equal(customDisposeCount, 0);

  // Disposing parent frees parent once; repeated dispose is a safe no-op
  parentScope.dispose();
  parentScope.dispose();
  assert.equal(parentScope.isDisposed, true);
  assert.equal(customDisposeCount, 1);
  assert.deepEqual(cleanupOrder, ['child_cleanup', 'parent_cleanup', 'parent_res']);
});

test('GameEventBus delivers typed payloads and unsubscribes cleanly', () => {
  const bus = new GameEventBus();
  let cashSum = 0;
  let traumaMax = 0;

  const unsubCash = bus.on('player:cash', ({ delta }) => {
    cashSum += delta;
  });
  bus.on('camera:trauma', ({ amount }) => {
    traumaMax = Math.max(traumaMax, amount);
  });

  bus.emit('player:cash', { delta: 250 });
  bus.emit('camera:trauma', { amount: 0.45 });
  assert.equal(cashSum, 250);
  assert.equal(traumaMax, 0.45);
  assert.equal(bus.listenerCount(), 2);

  unsubCash();
  bus.emit('player:cash', { delta: 500 });
  assert.equal(cashSum, 250);
  assert.equal(bus.listenerCount('player:cash'), 0);
});

test('SimulationClock advances fixed steps deterministically and stepPedestrianAI is 100% deterministic', () => {
  const clock = new SimulationClock(1 / 60, 0.05, 4);
  let steps = 0;
  clock.advance(1 / 30, () => {
    steps++;
  });
  assert.equal(steps, 2);
  assert.ok(Math.abs(clock.timeSec - 2 / 60) < 1e-9);

  const colliders = new SpatialHashGrid(buildStaticColliders(), 16);
  const makePed = (): PedState => ({
    id: 'det_ped',
    role: 'civilian',
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    heading: 0,
    walkCycle: 0,
    health: 100,
    state: 'walk',
    stateTimer: 0,
    homeX: 0,
    homeZ: 0,
    targetX: 0,
    targetZ: 0,
    shirtColor: 0x334455,
    pantsColor: 0x222222,
    skinTone: 0xb58867,
    koTimer: 0,
    hitFlash: 0,
  });

  const pedA = makePed();
  const pedB = makePed();
  stepPedestrianAI(pedA, 50, 50, false, 0, colliders, 1 / 60, 0, 12.5);
  stepPedestrianAI(pedB, 50, 50, false, 0, colliders, 1 / 60, 0, 12.5);

  assert.equal(pedA.targetX, pedB.targetX);
  assert.equal(pedA.targetZ, pedB.targetZ);
});

test('GameHudStore isolates telemetry updates from player, worldUi, and activity slices', () => {
  const store = new GameHudStore(createSampleHud());
  let telemetryNotifications = 0;
  let playerNotifications = 0;
  let worldUiNotifications = 0;
  let activityNotifications = 0;

  store.subscribeTelemetry(() => telemetryNotifications++);
  store.subscribePlayer(() => playerNotifications++);
  store.subscribeWorldUi(() => worldUiNotifications++);
  store.subscribeActivity(() => activityNotifications++);

  // High-frequency speedometer tick should ONLY notify telemetry subscribers
  store.publish({ ...createSampleHud(), speedKmh: 84, rpmRatio: 0.72, gear: '3' });
  assert.equal(telemetryNotifications, 1);
  assert.equal(playerNotifications, 0);
  assert.equal(worldUiNotifications, 0);
  assert.equal(activityNotifications, 0);

  // Cash change notifies player slice only
  store.publish({ ...createSampleHud(), speedKmh: 84, rpmRatio: 0.72, gear: '3', cash: 850 });
  assert.equal(telemetryNotifications, 1);
  assert.equal(playerNotifications, 1);
  assert.equal(worldUiNotifications, 0);
});

test('ActivityRegistry coordinates ambient CheckpointActivity and exclusive RobberyActivity via EventBus', () => {
  const eventBus = new GameEventBus();
  const registry = new ActivityRegistry();
  const checkpoints = new CheckpointActivity();
  const robbery = new RobberyActivity();

  registry.register(checkpoints);
  registry.register(robbery);

  let playerPos = { x: 0, z: 0, inVehicle: true };
  let cashEarned = 0;
  eventBus.on('player:cash', ({ delta }) => {
    cashEarned += delta;
  });

  const ctx: ActivityContext = {
    eventBus,
    simTimeSec: 0,
    getPlayerPosition: () => playerPos,
    getPlayerHealth: () => 100,
    getPlayerOutfit: () => 'classic_cj',
  };

  registry.startActivity(checkpoints.id, undefined, ctx);
  assert.equal(checkpoints.isActive, true);
  assert.equal(registry.hasExclusiveActive(), false);

  // Drive onto checkpoint #1 -> clears and awards cash
  const cp1 = INITIAL_CHECKPOINTS[0];
  playerPos = { x: cp1.x, z: cp1.z, inVehicle: true };
  registry.updateAll(1 / 60, createEmptyInput(), ctx);
  assert.equal(checkpoints.getHudSlice().cleared, 1);
  assert.equal(cashEarned, cp1.reward);

  // Start exclusive robbery -> pauses ambient checkpoint updates while active
  const market = SHOPS[0];
  registry.startActivity(
    robbery.id,
    { shop: market, forcedOutcomeRoll: 0.05, rng: () => 0.5 },
    ctx,
  );
  assert.equal(registry.hasExclusiveActive(), true);
  assert.equal(robbery.getHudSlice()?.phase, 'entering');

  // Even if player position sits on checkpoint #2, exclusive robbery gates ambient updates
  const cp2 = INITIAL_CHECKPOINTS[1];
  playerPos = { x: cp2.x, z: cp2.z, inVehicle: true };
  registry.updateAll(0.1, createEmptyInput(), ctx);
  assert.equal(checkpoints.getHudSlice().cleared, 1);
});

test('Class-A Hypercar Ackermann steering, hydraulic damping, and tri-coat paint solver satisfy physical invariants', () => {
  // 1. Ackermann steering: inner wheel turns sharper than outer wheel
  const leftTurn = computeAckermannSteer(0.32);
  assert.ok(leftTurn.leftSteer > leftTurn.rightSteer, 'Inner left wheel should turn sharper on left turn');
  assert.ok(leftTurn.rightSteer > 0, 'Outer right wheel should still turn in same direction');

  const rightTurn = computeAckermannSteer(-0.32);
  assert.ok(Math.abs(rightTurn.rightSteer) > Math.abs(rightTurn.leftSteer), 'Inner right wheel should turn sharper on right turn');

  const neutral = computeAckermannSteer(0);
  assert.equal(neutral.leftSteer, 0);
  assert.equal(neutral.rightSteer, 0);

  // 2. Hydraulic damper converges smoothly from 0 to 1 with ease-in-out S-curve
  const state = { value: 0, target: 1, vel: 0 };
  let eased = 0;
  for (let i = 0; i < 240; i++) {
    eased = stepHydraulic(state, 1 / 60, 0.56);
  }
  assert.equal(state.value, 1);
  assert.equal(eased, 1);

  // 3. Tri-coat paint solver preserves Rosso Fuoco #8f0912 and generates brighter sheen for custom colors
  const rosso = computeTriCoatColors(0x8f0912);
  assert.equal(rosso.baseColor.getHexString(), '8f0912');
  assert.equal(rosso.sheenColor.getHexString(), 'ff3b1f');

  const emerald = computeTriCoatColors(0x285a3a);
  const baseHsl = { h: 0, s: 0, l: 0 };
  const sheenHsl = { h: 0, s: 0, l: 0 };
  emerald.baseColor.getHSL(baseHsl);
  emerald.sheenColor.getHSL(sheenHsl);
  assert.ok(sheenHsl.l > baseHsl.l, 'Tri-coat sheen color must be brighter than base metallic pigment');
});

test('Cooperative async boot scheduler yields cleanly across event loop micro-tasks', async () => {
  resetYieldBudgetClock();
  const trace: string[] = [];
  const p = (async () => {
    trace.push('stage-1');
    await yieldToMainThread();
    trace.push('stage-2');
    await yieldIfOverBudget(0);
    trace.push('stage-3');
  })();
  trace.push('main-thread-unblocked');
  await p;
  assert.deepEqual(trace, ['stage-1', 'main-thread-unblocked', 'stage-2', 'stage-3']);
});


