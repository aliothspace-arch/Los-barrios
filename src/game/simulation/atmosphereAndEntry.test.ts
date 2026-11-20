import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_CYCLE_DURATION_SEC,
  INITIAL_TIME_OF_DAY_HOURS,
  WEATHER_TRANSITION_DURATION_SEC,
  advanceTimeOfDay,
  createInitialAtmosphereState,
  evaluateDayNightBase,
  evaluateDynamicAtmosphere,
  formatClockHHMM,
  pickNextMarkovWeather,
  rotatePointAroundAxis,
  stepAtmosphereState,
} from './atmosphereModel';
import {
  ENTER_VEHICLE_DURATION_SEC,
  EXIT_VEHICLE_DURATION_SEC,
  stepOpenWorldSimulation,
} from './worldSimulation';
import {
  chooseVehicleEntrySide,
  computeVehicleDoorWorldPoint,
  createVehicleState,
} from '../physics';
import { SpatialHashGrid } from './spatialHash';
import { GameEventBus } from '../core/eventBus';
import { SimulationClock } from '../core/clock';
import { buildStaticColliders, PLAYER_SPAWN, STREETLAMP_POSITIONS } from '../worldLayout';
import {
  RAIN_LAYER_SPECS,
  computeNearestLampBulbs,
  computeRainTiltRadians,
  computeStreetlampBulbPosition,
  computeWetRoadMetrics,
} from './rainMath';
import {
  DOOR_HYDRAULIC_CLOSE_SPEED,
  DOOR_HYDRAULIC_OPEN_SPEED,
  ENTRY_STEP_IN_START_PROGRESS,
  EXIT_STEP_OUT_START_PROGRESS,
  evaluateCanonicalSeatedPose,
  evaluateCanonicalStandingPose,
  evaluateVehicleEntryPose,
  evaluateVehicleExitPose,
  getVehicleTransitionDoorTarget,
} from './vehicleEntryChoreography';
import { stepHydraulic } from '../rendering/hypercarBuilders';
import type { ControlInput, PlayerState, WeatherType } from '../types';

function emptyControlInput(): ControlInput {
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

function createTestPlayer(): PlayerState {
  return {
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
    vehicleTransition: {
      mode: 'none',
      vehicleId: null,
      side: 1,
      progress: 0,
      duration: ENTER_VEHICLE_DURATION_SEC,
      startX: PLAYER_SPAWN.x,
      startZ: PLAYER_SPAWN.z,
      startHeading: PLAYER_SPAWN.heading,
    },
  };
}

test('12-minute 24h continuous clock advances, formats, and varies solar elevation & nightFactor smoothly', () => {
  assert.equal(DAY_CYCLE_DURATION_SEC, 720);
  assert.equal(INITIAL_TIME_OF_DAY_HOURS, 17.5);
  assert.equal(formatClockHHMM(INITIAL_TIME_OF_DAY_HOURS), '17:30');

  // Half cycle (360s) = +12 hours -> 05:30
  const halfDay = advanceTimeOfDay(INITIAL_TIME_OF_DAY_HOURS, 360);
  assert.ok(Math.abs(halfDay - 5.5) < 1e-6);
  assert.equal(formatClockHHMM(halfDay), '05:30');

  // Full 720s wraps cleanly back to 17:30
  const fullDay = advanceTimeOfDay(INITIAL_TIME_OF_DAY_HOURS, DAY_CYCLE_DURATION_SEC);
  assert.ok(Math.abs(fullDay - INITIAL_TIME_OF_DAY_HOURS) < 1e-6);
  assert.equal(formatClockHHMM(fullDay), '17:30');

  const noon = evaluateDayNightBase(13.25);
  const midnight = evaluateDayNightBase(0.0);
  assert.ok(noon.sunElevation > 50, 'Noon sun elevation should be high');
  assert.equal(noon.nightFactor, 0);
  assert.ok(midnight.sunElevation < 0, 'Midnight sun elevation should be below horizon');
  assert.equal(midnight.nightFactor, 1);
  assert.ok(midnight.starVisibility > noon.starVisibility);
});

test('Markov weather state machine picks valid distinct transitions and blends smoothly over 16s', () => {
  const allWeathers: WeatherType[] = ['golden', 'clear', 'fog', 'rain', 'storm'];
  for (const w of allWeathers) {
    for (const r of [0.0, 0.25, 0.5, 0.75, 0.99]) {
      const next = pickNextMarkovWeather(w, r);
      assert.ok(allWeathers.includes(next));
      assert.notEqual(next, w, `Markov transition from ${w} must advance to a distinct weather`);
    }
  }

  const state = createInitialAtmosphereState(() => 0.5);
  assert.equal(state.weather, 'golden');
  assert.equal(state.weatherBlend, 1.0);

  // Force dwell timer to expire -> should transition to a new weather and begin smooth blend
  state.dwellTimerSec = 0.05;
  const res = stepAtmosphereState(state, 0.1, () => 0.85); // 0.85 from golden -> rain
  assert.equal(res.weatherChangedTo, 'rain');
  assert.equal(state.prevWeather, 'golden');
  assert.equal(state.weather, 'rain');
  assert.equal(state.weatherBlend, 0);

  const sampleStart = evaluateDynamicAtmosphere(state);
  assert.equal(sampleStart.rainDensity, 0, 'Rain density at t=0 of blend must start smoothly at 0');

  // Step halfway through 16s transition
  stepAtmosphereState(state, WEATHER_TRANSITION_DURATION_SEC * 0.5, () => 0.5);
  const sampleMid = evaluateDynamicAtmosphere(state);
  assert.ok(
    sampleMid.rainDensity > 0.1 && sampleMid.rainDensity < 0.75,
    `Mid-transition rain density (${sampleMid.rainDensity}) should interpolate smoothly`,
  );
  assert.ok(sampleMid.wetness > 0.1 && sampleMid.wetness < 0.88);
});

test('Hypercar dihedral butterfly doors swing strictly UPWARD (+Y) and OUTWARD (±X) on both sides', () => {
  const doorMaxAngle = 1.06;

  // Left door (+X driver side): pivot (0.82, 0.73, 0.68), axis (0.62, -0.7, 0.28)
  const leftPivot: [number, number, number] = [0.82, 0.73, 0.68];
  const leftAxis: [number, number, number] = [0.62, -0.7, 0.28];
  const leftRearEdge: [number, number, number] = [0.89, 0.16, -0.78];
  const leftOpen = rotatePointAroundAxis(leftRearEdge, leftPivot, leftAxis, doorMaxAngle);

  assert.ok(
    leftOpen[1] > leftPivot[1] + 0.2,
    `Left butterfly door rear edge must lift strictly upward above hinge (${leftOpen[1].toFixed(2)} > ${leftPivot[1]})`,
  );
  assert.ok(
    leftOpen[0] > leftPivot[0] + 0.35,
    `Left butterfly door must also swing outward (+X): ${leftOpen[0].toFixed(2)}`,
  );

  // Right door (-X passenger side): pivot (-0.82, 0.73, 0.68), axis (0.62, 0.7, -0.28)
  const rightPivot: [number, number, number] = [-0.82, 0.73, 0.68];
  const rightAxis: [number, number, number] = [0.62, 0.7, -0.28];
  const rightRearEdge: [number, number, number] = [-0.89, 0.16, -0.78];
  const rightOpen = rotatePointAroundAxis(rightRearEdge, rightPivot, rightAxis, doorMaxAngle);

  assert.ok(
    rightOpen[1] > rightPivot[1] + 0.2,
    `Right butterfly door rear edge must lift strictly upward above hinge (${rightOpen[1].toFixed(2)} > ${rightPivot[1]})`,
  );
  assert.ok(
    rightOpen[0] < rightPivot[0] - 0.35,
    `Right butterfly door must also swing outward (-X): ${rightOpen[0].toFixed(2)}`,
  );
});

test('AAA vehicle entry/exit state machine opens door automatically, seats CJ inside, and exits on true driver side', () => {
  const colliders = buildStaticColliders();
  const spatialGrid = new SpatialHashGrid(colliders, 16);
  const eventBus = new GameEventBus();
  const doorSounds: number[] = [];
  eventBus.on('sfx:play', ({ kind }) => {
    if (kind === 'door') doorSounds.push(1);
  });

  const car = createVehicleState('hero_hypercar', 'infernus', 0, -20, Math.PI, 'none');
  const player = createTestPlayer();
  const driverStand = computeVehicleDoorWorldPoint(car, 1, 1.8, 0);
  player.x = driverStand.x;
  player.z = driverStand.z;

  // 1. Trigger Enter [E]
  const enterInput = emptyControlInput();
  enterInput.enterVehiclePressed = true;
  const enterStart = stepOpenWorldSimulation({
    dt: 1 / 60,
    simTimeSec: 0,
    tickIndex: 0,
    input: enterInput,
    cameraYaw: Math.PI,
    weather: 'golden',
    player,
    vehicles: [car],
    peds: [],
    spatialGrid,
    wantedLevel: 0,
    wantedCooldown: 20,
    lastDistrict: 'GROVE STREET',
    eventBus,
  });

  assert.equal(player.vehicleTransition.mode, 'entering');
  assert.equal(player.vehicleTransition.vehicleId, car.id);
  assert.equal(player.vehicleTransition.side, 1, 'Should choose +X driver side when unobstructed');
  assert.equal(player.inVehicleId, null);
  assert.equal(
    enterStart.transitionDoorPulseVehicleId,
    car.id,
    'Automatic entry sequence must pulse butterfly door open immediately on trigger',
  );

  // Advance across full entry choreography
  const idle = emptyControlInput();
  const enterSteps = Math.ceil((ENTER_VEHICLE_DURATION_SEC + 0.05) * 60);
  for (let i = 1; i <= enterSteps; i++) {
    stepOpenWorldSimulation({
      dt: 1 / 60,
      simTimeSec: i / 60,
      tickIndex: i,
      input: idle,
      cameraYaw: Math.PI,
      weather: 'golden',
      player,
      vehicles: [car],
      peds: [],
      spatialGrid,
      wantedLevel: 0,
      wantedCooldown: 20,
      lastDistrict: 'GROVE STREET',
      eventBus,
    });
  }

  assert.equal(player.vehicleTransition.mode, 'none');
  assert.equal(player.inVehicleId, car.id);
  assert.equal(car.driver, 'player');
  assert.ok(doorSounds.length >= 2, 'Should trigger door open and close SFX cues');

  // 2. Trigger Exit [E]
  const exitInput = emptyControlInput();
  exitInput.enterVehiclePressed = true;
  const exitStart = stepOpenWorldSimulation({
    dt: 1 / 60,
    simTimeSec: 3.0,
    tickIndex: 200,
    input: exitInput,
    cameraYaw: Math.PI,
    weather: 'golden',
    player,
    vehicles: [car],
    peds: [],
    spatialGrid,
    wantedLevel: 0,
    wantedCooldown: 20,
    lastDistrict: 'GROVE STREET',
    eventBus,
  });

  assert.equal(player.vehicleTransition.mode, 'exiting');
  assert.equal(exitStart.transitionDoorPulseVehicleId, car.id);
  assert.equal(player.inVehicleId, null);

  const exitSteps = Math.ceil((EXIT_VEHICLE_DURATION_SEC + 0.05) * 60);
  for (let i = 1; i <= exitSteps; i++) {
    stepOpenWorldSimulation({
      dt: 1 / 60,
      simTimeSec: 3.0 + i / 60,
      tickIndex: 200 + i,
      input: idle,
      cameraYaw: Math.PI,
      weather: 'golden',
      player,
      vehicles: [car],
      peds: [],
      spatialGrid,
      wantedLevel: 0,
      wantedCooldown: 20,
      lastDistrict: 'GROVE STREET',
      eventBus,
    });
  }

  assert.equal(player.vehicleTransition.mode, 'none');
  assert.equal(player.inVehicleId, null);
  const expectedDriverExit = computeVehicleDoorWorldPoint(car, 1, 1.58, -0.26);
  assert.ok(
    Math.hypot(player.x - expectedDriverExit.x, player.z - expectedDriverExit.z) < 0.25,
    'CJ should exit cleanly onto the true +X driver side',
  );
});

test('chooseVehicleEntrySide falls back to passenger side (-1) when driver side (+1) is blocked by a wall', () => {
  const parked = createVehicleState('wall_car', 'infernus', 10, -20, 0, 'none');
  const wallBlockingDriverSide = new SpatialHashGrid(
    [
      {
        id: 'wall_driver_side',
        minX: 11.0,
        maxX: 13.5,
        minZ: -22.5,
        maxZ: -17.5,
        height: 5,
        category: 'building',
      },
    ],
    16,
  );
  assert.equal(chooseVehicleEntrySide(parked, wallBlockingDriverSide), -1);
});

test('AAA multi-tier rain specs sum cleanly and wet road metrics scale monotonically with wetness & rain', () => {
  const fracSum = RAIN_LAYER_SPECS.reduce((acc, s) => acc + s.fraction, 0);
  assert.ok(Math.abs(fracSum - 1.0) < 1e-6, 'Rain depth tier fractions must sum to 1.0');
  assert.ok(RAIN_LAYER_SPECS[2].boxWidth > RAIN_LAYER_SPECS[0].boxWidth);
  assert.ok(RAIN_LAYER_SPECS[2].streakLengthMax > RAIN_LAYER_SPECS[0].streakLengthMax);

  const dry = computeWetRoadMetrics(0, 0, 0.2);
  const rain = computeWetRoadMetrics(0.88, 0.75, 0.68);
  const storm = computeWetRoadMetrics(1.0, 1.0, 1.2);

  assert.equal(dry.puddleCoverage, 0);
  assert.equal(dry.rippleAmplitude, 0);
  assert.equal(dry.tireSprayRate, 0);
  assert.equal(dry.mistAlpha, 0);

  assert.ok(rain.puddleCoverage > 0.6 && rain.puddleCoverage < storm.puddleCoverage);
  assert.ok(rain.rippleAmplitude > 0.5 && storm.rippleAmplitude === 1.0);
  assert.ok(storm.roadClearcoat > rain.roadClearcoat);
  assert.ok(storm.tireSprayRate > rain.tireSprayRate);
  assert.ok(storm.mistAlpha > rain.mistAlpha);

  assert.ok(computeRainTiltRadians(1.2) > computeRainTiltRadians(0.2));
});

test('computeNearestLampBulbs projects gooseneck streetlamp arms accurately and sorts by proximity', () => {
  const lamp = { x: -8.2, z: -14, rotY: Math.PI * 0.5 };
  const bulb = computeStreetlampBulbPosition(lamp);
  assert.ok(Math.abs(bulb.x - (-8.2 + 2.3)) < 1e-4);
  assert.equal(bulb.y, 7.3);
  assert.ok(Math.abs(bulb.z - -14) < 1e-4);

  const nearest = computeNearestLampBulbs(0, -18, STREETLAMP_POSITIONS, 6);
  assert.equal(nearest.length, 6);
  for (let i = 1; i < nearest.length; i++) {
    const dPrev = Math.hypot(nearest[i - 1].x - 0, nearest[i - 1].z - -18);
    const dCurr = Math.hypot(nearest[i].x - 0, nearest[i].z - -18);
    assert.ok(dCurr >= dPrev, 'Nearest streetlamp bulbs must be sorted by ascending distance');
  }
});

test('Butterfly door hydraulic clears >= 90% open BEFORE CJ steps across sill on both entry and exit', () => {
  const dt = 1 / 60;

  // 1. Entering synchronization check
  const enterDoor = { value: 0, target: 0, vel: 0 };
  let doorAtEntryStepIn = 0;
  let minDoorDuringEntrySillCross = 1;
  const enterTicks = Math.ceil(ENTER_VEHICLE_DURATION_SEC / dt);
  for (let i = 0; i <= enterTicks; i++) {
    const p = Math.min(1, (i * dt) / ENTER_VEHICLE_DURATION_SEC);
    enterDoor.target = getVehicleTransitionDoorTarget('entering', p);
    const speed =
      enterDoor.target > enterDoor.value ? DOOR_HYDRAULIC_OPEN_SPEED : DOOR_HYDRAULIC_CLOSE_SPEED;
    const val = stepHydraulic(enterDoor, dt, speed);
    if (Math.abs(p - ENTRY_STEP_IN_START_PROGRESS) < dt / ENTER_VEHICLE_DURATION_SEC) {
      doorAtEntryStepIn = val;
    }
    if (p >= ENTRY_STEP_IN_START_PROGRESS && p <= 0.64) {
      minDoorDuringEntrySillCross = Math.min(minDoorDuringEntrySillCross, val);
    }
  }
  assert.ok(
    doorAtEntryStepIn >= 0.9,
    `Door must be >=90% open when CJ begins stepping over sill on entry (got ${(doorAtEntryStepIn * 100).toFixed(1)}%)`,
  );
  assert.ok(
    minDoorDuringEntrySillCross >= 0.9,
    `Door must stay >=90% open throughout sill crossing on entry (min ${(minDoorDuringEntrySillCross * 100).toFixed(1)}%)`,
  );
  // Allow short latch settle after p=1.0
  for (let i = 0; i < 20; i++) {
    enterDoor.target = 0;
    stepHydraulic(enterDoor, dt, DOOR_HYDRAULIC_CLOSE_SPEED);
  }
  assert.ok(enterDoor.value <= 0.04, `Door must finish closing cleanly (got ${enterDoor.value.toFixed(3)})`);

  // 2. Exiting synchronization check
  const exitDoor = { value: 0, target: 0, vel: 0 };
  let doorAtExitStepOut = 0;
  let minDoorDuringExitSillCross = 1;
  const exitTicks = Math.ceil(EXIT_VEHICLE_DURATION_SEC / dt);
  for (let i = 0; i <= exitTicks; i++) {
    const p = Math.min(1, (i * dt) / EXIT_VEHICLE_DURATION_SEC);
    exitDoor.target = getVehicleTransitionDoorTarget('exiting', p);
    const speed =
      exitDoor.target > exitDoor.value ? DOOR_HYDRAULIC_OPEN_SPEED : DOOR_HYDRAULIC_CLOSE_SPEED;
    const val = stepHydraulic(exitDoor, dt, speed);
    if (Math.abs(p - EXIT_STEP_OUT_START_PROGRESS) < dt / EXIT_VEHICLE_DURATION_SEC) {
      doorAtExitStepOut = val;
    }
    if (p >= EXIT_STEP_OUT_START_PROGRESS && p <= 0.72) {
      minDoorDuringExitSillCross = Math.min(minDoorDuringExitSillCross, val);
    }
  }
  assert.ok(
    doorAtExitStepOut >= 0.9,
    `Door must be >=90% open when CJ begins swinging out on exit (got ${(doorAtExitStepOut * 100).toFixed(1)}%)`,
  );
  assert.ok(
    minDoorDuringExitSillCross >= 0.9,
    `Door must stay >=90% open while CJ crosses doorway on exit (min ${(minDoorDuringExitSillCross * 100).toFixed(1)}%)`,
  );
});

test('Vehicle entry & exit choreography poses are C0/C1 continuous across all 28 channels with exact endpoint handoffs', () => {
  const car = createVehicleState('hero_hypercar', 'infernus', 0, -20, Math.PI, 'none');
  car.pitch = 0.02;
  car.roll = -0.015;
  const seated = evaluateCanonicalSeatedPose(car);

  const angleDiff = (a: number, b: number) => {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d);
  };

  for (const side of [1, -1] as const) {
    const startPt = computeVehicleDoorWorldPoint(car, side, 2.2, 0.2);
    const exitPt = computeVehicleDoorWorldPoint(car, side, 1.58, -0.26);
    const standing = evaluateCanonicalStandingPose(exitPt.x, exitPt.z, car.heading);

    // Dense 400-step sweep across entering (0..1)
    const steps = 400;
    let prevEntry = evaluateVehicleEntryPose({
      progress: 0,
      side,
      startX: startPt.x,
      startZ: startPt.z,
      startHeading: car.heading,
      car,
    });
    for (let i = 1; i <= steps; i++) {
      const p = i / steps;
      const cur = evaluateVehicleEntryPose({
        progress: p,
        side,
        startX: startPt.x,
        startZ: startPt.z,
        startHeading: car.heading,
        car,
      });
      const posStep = Math.hypot(cur.posX - prevEntry.posX, cur.posY - prevEntry.posY, cur.posZ - prevEntry.posZ);
      assert.ok(posStep < 0.035, `Entry pos discontinuity at p=${p.toFixed(4)}: ${posStep.toFixed(4)}`);
      assert.ok(angleDiff(cur.rotY, prevEntry.rotY) < 0.04, `Entry rotY pop at p=${p.toFixed(4)}`);
      for (const key of Object.keys(cur) as Array<keyof typeof cur>) {
        if (key === 'posX' || key === 'posY' || key === 'posZ' || key === 'rotY') continue;
        const delta = Math.abs(cur[key] - prevEntry[key]);
        assert.ok(delta < 0.065, `Entry channel ${key} popped by ${delta.toFixed(4)} at p=${p.toFixed(4)} (side=${side})`);
      }
      prevEntry = cur;
    }
    // Exact handoff to canonical seated pose at p=1.0
    for (const key of Object.keys(seated) as Array<keyof typeof seated>) {
      const err = key === 'rotY' ? angleDiff(prevEntry[key], seated[key]) : Math.abs(prevEntry[key] - seated[key]);
      assert.ok(err < 1e-5, `Entry end pose mismatch on ${key}: ${err}`);
    }

    // Dense 400-step sweep across exiting (0..1)
    let prevExit = evaluateVehicleExitPose({ progress: 0, side, car });
    // Exact handoff from canonical seated pose at p=0.0
    for (const key of Object.keys(seated) as Array<keyof typeof seated>) {
      const err = key === 'rotY' ? angleDiff(prevExit[key], seated[key]) : Math.abs(prevExit[key] - seated[key]);
      assert.ok(err < 1e-5, `Exit start pose mismatch on ${key}: ${err}`);
    }
    for (let i = 1; i <= steps; i++) {
      const p = i / steps;
      const cur = evaluateVehicleExitPose({ progress: p, side, car });
      const posStep = Math.hypot(cur.posX - prevExit.posX, cur.posY - prevExit.posY, cur.posZ - prevExit.posZ);
      assert.ok(posStep < 0.035, `Exit pos discontinuity at p=${p.toFixed(4)}: ${posStep.toFixed(4)}`);
      assert.ok(angleDiff(cur.rotY, prevExit.rotY) < 0.04, `Exit rotY pop at p=${p.toFixed(4)}`);
      for (const key of Object.keys(cur) as Array<keyof typeof cur>) {
        if (key === 'posX' || key === 'posY' || key === 'posZ' || key === 'rotY') continue;
        const delta = Math.abs(cur[key] - prevExit[key]);
        assert.ok(delta < 0.065, `Exit channel ${key} popped by ${delta.toFixed(4)} at p=${p.toFixed(4)} (side=${side})`);
      }
      prevExit = cur;
    }
    // Exact handoff to canonical standing pose at p=1.0
    for (const key of Object.keys(standing) as Array<keyof typeof standing>) {
      const err = key === 'rotY' ? angleDiff(prevExit[key], standing[key]) : Math.abs(prevExit[key] - standing[key]);
      assert.ok(err < 1e-5, `Exit end pose mismatch on ${key}: ${err}`);
    }
  }
});

test('SimulationClock sub-tick alpha keeps interpolated transition progress strictly monotonic at 120Hz', () => {
  const clock = new SimulationClock(1 / 60, 0.05, 4);
  let simProgress = 0;
  const duration = ENTER_VEHICLE_DURATION_SEC;
  let lastRenderProgress = -1;
  // Simulate 120Hz frames (8.33ms each -> alternating 0-step and 1-step frames)
  for (let f = 0; f < 100; f++) {
    clock.advance(1 / 120, (fixedDt) => {
      simProgress = Math.min(1, simProgress + fixedDt / duration);
    });
    const renderProgress = Math.min(1, simProgress + (clock.alpha * clock.fixedDt) / duration);
    assert.ok(
      renderProgress > lastRenderProgress + 1e-4 || renderProgress >= 1,
      `Interpolated progress stalled on 120Hz frame ${f}: ${lastRenderProgress} -> ${renderProgress}`,
    );
    lastRenderProgress = renderProgress;
  }
});
