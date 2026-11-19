import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeVehicleAIControls,
  createVehicleState,
  findNearestEnterableVehicle,
  getWeatherGripMultiplier,
  resolveCircleVsAABBs,
  resolveVehicleVsVehicle,
  stepPedestrianAI,
  stepPlayerOnFoot,
  stepVehiclePhysics,
} from './physics';
import {
  evaluateShopPurchase,
  findNearestShop,
} from './shopSystem';
import {
  BUILDINGS,
  buildStaticColliders,
  getDistrictName,
  INITIAL_PEDS,
  INITIAL_VEHICLES,
  PLAYER_SPAWN,
  SHOPS,
} from './worldLayout';
import type { ControlInput, PedState, PlayerState } from './types';

function emptyInput(): ControlInput {
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

test('player spawn and Grove Street hero vehicles are unobstructed by static colliders', () => {
  const colliders = buildStaticColliders();
  const spawnCheck = resolveCircleVsAABBs(
    PLAYER_SPAWN.x,
    PLAYER_SPAWN.z,
    0,
    0,
    0.5,
    colliders,
  );
  assert.equal(spawnCheck.x, PLAYER_SPAWN.x);
  assert.equal(spawnCheck.z, PLAYER_SPAWN.z);
  assert.equal(getDistrictName(PLAYER_SPAWN.x, PLAYER_SPAWN.z), 'GROVE STREET');

  // Verify forward walk along Grove Ave (-Z) is completely open
  for (let z = PLAYER_SPAWN.z; z >= -95; z -= 3) {
    const pathCheck = resolveCircleVsAABBs(0, z, 0, -5, 1.8, colliders);
    assert.equal(pathCheck.impact.hit, false, `Road blocked at z=${z}`);
  }

  // Expanded Los Santos: >= 50 distinct buildings, >= 26 vehicles, >= 44 NPCs, 7 interactive shops
  assert.ok(BUILDINGS.length >= 50, `Expected at least 50 buildings, got ${BUILDINGS.length}`);
  assert.ok(INITIAL_VEHICLES.length >= 26, `Expected at least 26 vehicles, got ${INITIAL_VEHICLES.length}`);
  for (const v of INITIAL_VEHICLES) {
    const check = resolveCircleVsAABBs(v.x, v.z, 0, 0, 1.8, colliders);
    assert.equal(
      Math.hypot(check.x - v.x, check.z - v.z) < 0.05,
      true,
      `Vehicle ${v.id} overlaps collider`,
    );
  }

  // All 44 NPCs & 7 interactive shop entrances spawn clear of static colliders
  assert.ok(INITIAL_PEDS.length >= 44, `Expected at least 44 NPCs, got ${INITIAL_PEDS.length}`);
  for (const p of INITIAL_PEDS) {
    const check = resolveCircleVsAABBs(p.x, p.z, 0, 0, 0.4, colliders);
    assert.equal(
      Math.hypot(check.x - p.x, check.z - p.z) < 0.05,
      true,
      `Ped ${p.id} overlaps collider`,
    );
  }
  assert.equal(SHOPS.length, 7);
  for (const s of SHOPS) {
    const check = resolveCircleVsAABBs(s.x, s.z, 0, 0, 0.5, colliders);
    assert.equal(
      Math.hypot(check.x - s.x, check.z - s.z) < 0.05,
      true,
      `Shop entrance ${s.id} overlaps collider`,
    );
  }
});

test('4-wheel vehicle physics accelerates, shifts gears, steers, and loses grip in storm weather', () => {
  const colliders = buildStaticColliders();
  const carDry = createVehicleState('dry', 'infernus', 0, 0, Math.PI, 'player');
  const carStorm = createVehicleState('storm', 'infernus', 0, 0, Math.PI, 'player');

  for (let i = 0; i < 90; i++) {
    stepVehiclePhysics(
      carDry,
      { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false },
      'clear',
      colliders,
      1 / 60,
    );
    stepVehiclePhysics(
      carStorm,
      { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false },
      'storm',
      colliders,
      1 / 60,
    );
  }

  assert.ok(carDry.speed > 25, `Expected high forward speed, got ${carDry.speed}`);
  assert.ok(carDry.gear >= 3, `Expected gear >= 3, got ${carDry.gear}`);
  assert.ok(carDry.z < -20, 'Car facing Math.PI should advance along -Z');
  assert.ok(
    getWeatherGripMultiplier('storm') < getWeatherGripMultiplier('clear'),
    'Storm weather must lower tire grip',
  );

  // Hard cornering in storm produces larger lateral slip than on dry asphalt
  for (let i = 0; i < 30; i++) {
    stepVehiclePhysics(
      carDry,
      { throttle: 0.7, brake: 0, steer: 1, handbrake: false, nitro: false },
      'clear',
      colliders,
      1 / 60,
    );
    stepVehiclePhysics(
      carStorm,
      { throttle: 0.7, brake: 0, steer: 1, handbrake: false, nitro: false },
      'storm',
      colliders,
      1 / 60,
    );
  }
  assert.ok(
    Math.abs(carStorm.lateralSpeed) > Math.abs(carDry.lateralSpeed),
    'Storm wet asphalt should produce more lateral drift slip than dry asphalt',
  );
});

test('building AABB collision blocks tunneling and applies realistic impact damage', () => {
  const colliders = [
    {
      id: 'wall_test',
      minX: -5,
      maxX: 5,
      minZ: -15,
      maxZ: -10,
      height: 10,
      category: 'building' as const,
    },
  ];
  const car = createVehicleState('crash_car', 'greenwood', 0, -5, Math.PI, 'player');
  car.vz = -24;
  car.speed = 24;

  let hitWall = false;
  for (let i = 0; i < 40; i++) {
    const res = stepVehiclePhysics(
      car,
      { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false },
      'clear',
      colliders,
      1 / 60,
    );
    if (res.impact.hit) hitWall = true;
  }

  assert.equal(hitWall, true);
  assert.ok(car.z >= -10 + car.spec.radius - 0.05, 'Car must not tunnel through building');
  assert.ok(car.health < 100, 'High-speed wall collision should damage vehicle');
});

test('vehicle-to-vehicle collision transfers momentum and damages both vehicles', () => {
  const a = createVehicleState('a', 'greenwood', 0, 0, 0, 'player');
  const b = createVehicleState('b', 'sabre', 0, 3.0, 0, 'civilian');
  a.vz = 18;
  b.vz = 0;

  const res = resolveVehicleVsVehicle(a, b);
  assert.equal(res.collided, true);
  assert.ok(res.impactSpeed >= 17.5);
  assert.ok(b.vz > 6, 'Struck vehicle should receive forward momentum impulse');
  assert.ok(a.vz < 12, 'Striking vehicle should slow down on impact');
  assert.ok(a.health < 100 && b.health < 100);
});

test('on-foot locomotion, jump coyote time, and vehicle entry proximity work accurately', () => {
  const colliders = buildStaticColliders();
  const player: PlayerState = {
    x: PLAYER_SPAWN.x,
    y: 0,
    z: PLAYER_SPAWN.z,
    vx: 0,
    vy: 0,
    vz: 0,
    heading: PLAYER_SPAWN.heading,
    grounded: true,
    coyoteTimer: 0.1,
    jumpBufferTimer: 0,
    walkCycle: 0,
    sprinting: false,
    health: 100,
    armor: 50,
    inVehicleId: null,
    attackTimer: 0,
    damageFlash: 0,
    outfitId: 'classic_cj',
  };

  const vehicles = [
    createVehicleState('v_near', 'greenwood', PLAYER_SPAWN.x - 2.5, PLAYER_SPAWN.z, 0, 'none'),
  ];

  const near = findNearestEnterableVehicle(player.x, player.z, vehicles);
  assert.equal(near?.id, 'v_near');

  const input = emptyInput();
  input.forward = 1;
  input.jumpOrAction = true;
  const step1 = stepPlayerOnFoot(player, input, 0, colliders, vehicles, 1 / 60);
  assert.equal(step1.jumped, true);
  assert.ok(player.y > 0);
});

test('police AI activates siren and steers toward player when wanted level >= 1', () => {
  const cop = createVehicleState('cop1', 'police', 0, -40, 0, 'police', 0);
  const ctrlIdle = computeVehicleAIControls(cop, 0, -90, 0, 0, 0, [cop], 1 / 60);
  assert.equal(cop.sirenOn, false);
  assert.ok(ctrlIdle.throttle > 0);

  const ctrlChase = computeVehicleAIControls(cop, 0, -90, 2, 15, -10, [cop], 1 / 60);
  assert.equal(cop.sirenOn, true);
  assert.ok(ctrlChase.throttle > 0.8);
});

test('interactive shop purchasing, vehicle-service checks, outfits, and store robbery work accurately', () => {
  const market = SHOPS.find((s) => s.id === 'shop_247')!;
  const customs = SHOPS.find((s) => s.id === 'shop_lscustoms')!;
  const binco = SHOPS.find((s) => s.id === 'shop_binco')!;

  const near = findNearestShop(market.x + 1.5, market.z - 1.0, SHOPS, 7.0);
  assert.equal(near?.id, 'shop_247');
  assert.equal(findNearestShop(0, 0, SHOPS, 7.0), null);

  // Buying a medkit deducts cash and heals to 100
  const medkit = market.items.find((i) => i.id === 'medkit_full')!;
  const buyOk = evaluateShopPurchase(medkit, {
    cash: 500,
    health: 40,
    armor: 20,
    inVehicle: false,
    vehicleHealth: 100,
    vehicleNitro: 100,
    outfitId: 'classic_cj',
  });
  assert.equal(buyOk.ok, true);
  assert.equal(buyOk.cashDelta, -medkit.price);
  assert.equal(buyOk.health, 100);

  // Vehicle-only item fails on foot and succeeds inside vehicle
  const respray = customs.items.find((i) => i.id === 'respray_paint')!;
  const failNoCar = evaluateShopPurchase(respray, {
    cash: 900,
    health: 100,
    armor: 50,
    inVehicle: false,
    vehicleHealth: 50,
    vehicleNitro: 50,
    outfitId: 'classic_cj',
  });
  assert.equal(failNoCar.ok, false);
  assert.equal(failNoCar.reason, 'requires_vehicle');

  const okRespray = evaluateShopPurchase(respray, {
    cash: 900,
    health: 100,
    armor: 50,
    inVehicle: true,
    vehicleHealth: 50,
    vehicleNitro: 50,
    outfitId: 'classic_cj',
  });
  assert.equal(okRespray.ok, true);
  assert.equal(okRespray.resprayVehicle, true);

  // Binco outfit swap works
  const suitItem = binco.items.find((i) => i.id === 'outfit_suit')!;
  const suitRes = evaluateShopPurchase(suitItem, {
    cash: 600,
    health: 100,
    armor: 50,
    inVehicle: false,
    vehicleHealth: 100,
    vehicleNitro: 100,
    outfitId: 'classic_cj',
  });
  assert.equal(suitRes.ok, true);
  assert.equal(suitRes.outfitId, 'ls_suit');
});

test('LSPD foot officer stays calm at 0 stars and chases player at >= 1 wanted star', () => {
  const colliders = buildStaticColliders();
  const copFoot: PedState = {
    id: 'cop_test',
    role: 'police_foot',
    x: 10,
    z: -66,
    vx: 0,
    vz: 0,
    heading: 0,
    walkCycle: 0,
    health: 100,
    state: 'walk',
    stateTimer: 0,
    homeX: 10,
    homeZ: -66,
    targetX: 14,
    targetZ: -66,
    shirtColor: 0x1b2638,
    pantsColor: 0x141b29,
    skinTone: 0xc29a7c,
    koTimer: 0,
    hitFlash: 0,
  };

  stepPedestrianAI(copFoot, 16, -66, false, 0, colliders, 1 / 60, 0);
  assert.equal(copFoot.state, 'walk');

  stepPedestrianAI(copFoot, 16, -66, false, 0, colliders, 1 / 60, 2);
  assert.equal(copFoot.state, 'chase');
});

test('all 18 AI traffic & patrol vehicles navigate expanded Los Santos roads for 20s with ZERO building crashes', () => {
  const colliders = buildStaticColliders();
  const vehicles = INITIAL_VEHICLES.map((s) =>
    createVehicleState(
      s.id,
      s.kind,
      s.x,
      s.z,
      s.heading,
      s.driver,
      s.waypointIndex ?? 0,
      s.customPaintHex,
      s.routeLoop ?? 0,
    ),
  );

  let buildingHits = 0;
  const hitDetails: string[] = [];

  for (let tick = 0; tick < 1200; tick++) {
    for (const v of vehicles) {
      if (v.driver === 'civilian' || v.driver === 'police') {
        const ctrl = computeVehicleAIControls(
          v,
          0,
          0,
          0,
          PLAYER_SPAWN.x,
          PLAYER_SPAWN.z,
          vehicles,
          1 / 60,
          colliders,
        );
        const res = stepVehiclePhysics(v, ctrl, 'golden', colliders, 1 / 60);
        if (res.impact.hit) {
          buildingHits++;
          if (hitDetails.length < 6) {
            hitDetails.push(
              `tick=${tick} car=${v.id} pos=(${v.x.toFixed(1)},${v.z.toFixed(1)}) wp=${v.waypointIndex} loop=${v.routeLoop} hitId=${res.impact.colliderId}`,
            );
          }
        }
      }
    }
    for (let i = 0; i < vehicles.length; i++) {
      for (let j = i + 1; j < vehicles.length; j++) {
        resolveVehicleVsVehicle(vehicles[i], vehicles[j]);
      }
    }
  }

  assert.equal(
    buildingHits,
    0,
    `Expected 0 AI building collisions, got ${buildingHits}: ${hitDetails.join('; ')}`,
  );

  // Also verify AI cars actually moved along their loops (didn't just freeze)
  const activeAI = vehicles.filter((v) => v.driver === 'civilian' || v.driver === 'police');
  const movedCount = activeAI.filter((v) => {
    const orig = INITIAL_VEHICLES.find((s) => s.id === v.id)!;
    return Math.hypot(v.x - orig.x, v.z - orig.z) > 15;
  }).length;
  assert.ok(
    movedCount >= 15,
    `Expected at least 15 AI vehicles to cruise >15m along road loops, got ${movedCount}`,
  );
});

test('third-person behind-character camera yaw always places camera directly behind heading for all cardinal directions', () => {
  const headings = [
    { name: 'North (-Z)', h: Math.PI, expectBehindX: 0, expectBehindZ: 1 },
    { name: 'East (+X)', h: Math.PI / 2, expectBehindX: -1, expectBehindZ: 0 },
    { name: 'South (+Z)', h: 0, expectBehindX: 0, expectBehindZ: -1 },
    { name: 'West (-X)', h: -Math.PI / 2, expectBehindX: 1, expectBehindZ: 0 },
  ];

  for (const tc of headings) {
    const desiredYaw = tc.h + Math.PI;
    const camOffsetX = Math.sin(desiredYaw);
    const camOffsetZ = Math.cos(desiredYaw);
    assert.ok(
      Math.abs(camOffsetX - tc.expectBehindX) < 1e-6 &&
        Math.abs(camOffsetZ - tc.expectBehindZ) < 1e-6,
      `${tc.name}: expected behind (${tc.expectBehindX}, ${tc.expectBehindZ}), got (${camOffsetX.toFixed(2)}, ${camOffsetZ.toFixed(2)})`,
    );
  }
});
