import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  lerpAngleShortest,
  interpolateVehiclePose,
  interpolatePlayerPose,
  RenderPoseHistory,
  shouldRedrawMinimap,
  selectVehicleLodTier,
  createAdaptiveResolutionState,
  stepAdaptiveResolutionScale,
  type VehiclePoseSnapshot,
  type PlayerPoseSnapshot,
} from './renderInterpolation';
import type { PlayerState, VehicleState } from '../types';
import { createVehicleState } from '../physics';

function makeVehicle(id: string, x: number, z: number, heading = 0): VehicleState {
  return createVehicleState(id, 'infernus', x, z, heading, 'none');
}

function makePlayer(x: number, z: number, heading = 0): PlayerState {
  return {
    x,
    y: 0,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    heading,
    grounded: true,
    coyoteTimer: 0.1,
    jumpBufferTimer: 0,
    walkCycle: 0,
    sprinting: false,
    health: 100,
    armor: 60,
    inVehicleId: null,
    vehicleTransition: {
      mode: 'none',
      vehicleId: null,
      side: 1,
      progress: 0,
      duration: 1.38,
      startX: x,
      startZ: z,
      startHeading: heading,
    },
    attackTimer: 0,
    damageFlash: 0,
    outfitId: 'classic_cj',
  };
}

describe('renderInterpolation — pose interpolation', () => {
  it('lerpAngleShortest wraps cleanly across +/- PI', () => {
    const mid = lerpAngleShortest(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
    assert.ok(Math.abs(Math.abs(mid) - Math.PI) < 1e-6, `Expected +/-PI, got ${mid}`);
  });

  it('interpolates vehicle pose smoothly for alpha 0, 0.5, 1 and snaps on >12m teleport', () => {
    const prev: VehiclePoseSnapshot = {
      x: 10,
      y: 0,
      z: 20,
      heading: Math.PI - 0.2,
      pitch: 0.02,
      roll: -0.04,
    };
    const curr = {
      x: 14,
      y: 0.4,
      z: 22,
      heading: -Math.PI + 0.2,
      pitch: 0.06,
      roll: 0.04,
    };
    const out: VehiclePoseSnapshot = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 };

    interpolateVehiclePose(prev, curr, 0, out);
    assert.equal(out.x, 10);
    assert.equal(out.z, 20);

    interpolateVehiclePose(prev, curr, 0.5, out);
    assert.equal(out.x, 12);
    assert.equal(out.y, 0.2);
    assert.equal(out.z, 21);
    assert.ok(Math.abs(out.pitch - 0.04) < 1e-6);
    assert.ok(Math.abs(out.roll - 0) < 1e-6);
    assert.ok(Math.abs(Math.abs(out.heading) - Math.PI) < 1e-6);

    interpolateVehiclePose(prev, curr, 1, out);
    assert.equal(out.x, 14);
    assert.equal(out.z, 22);

    // Teleport guard (>12m jump snaps directly to current pose)
    const teleported = { ...curr, x: 50, z: 20 };
    interpolateVehiclePose(prev, teleported, 0.25, out);
    assert.equal(out.x, 50);
    assert.equal(out.z, 20);
  });

  it('interpolates player pose and snaps on >8m teleport', () => {
    const prev: PlayerPoseSnapshot = { x: 0, y: 0, z: 0, heading: 0 };
    const curr = { x: 2, y: 1, z: 4, heading: 0.8 };
    const out: PlayerPoseSnapshot = { x: 0, y: 0, z: 0, heading: 0 };

    interpolatePlayerPose(prev, curr, 0.5, out);
    assert.equal(out.x, 1);
    assert.equal(out.y, 0.5);
    assert.equal(out.z, 2);
    assert.ok(Math.abs(out.heading - 0.4) < 1e-6);

    // >8m teleport snaps
    interpolatePlayerPose(prev, { x: 20, y: 0, z: 0, heading: 1.5 }, 0.3, out);
    assert.equal(out.x, 20);
    assert.equal(out.heading, 1.5);
  });

  it('RenderPoseHistory captures before step and resets on snapToCurrent', () => {
    const history = new RenderPoseHistory();
    const player = makePlayer(5, 10, 0.2);
    const car = makeVehicle('hero', 15, 25, 1.0);

    assert.equal(history.getPrevPlayer(), undefined);
    history.captureBeforeStep(player, [car]);
    assert.equal(history.getPrevPlayer()?.x, 5);
    assert.equal(history.getPrevVehicle('hero')?.x, 15);

    // Simulate movement after capture
    player.x = 7;
    car.x = 19;
    assert.equal(history.getPrevPlayer()?.x, 5);
    assert.equal(history.getPrevVehicle('hero')?.x, 15);

    // Snap clears stale history and records new pose
    history.snapToCurrent(player, [car]);
    assert.equal(history.getPrevPlayer()?.x, 7);
    assert.equal(history.getPrevVehicle('hero')?.x, 19);
  });
});

describe('renderInterpolation — minimap hard cadence throttle', () => {
  it('draws immediately on first frame when lastDrawMs is -Infinity', () => {
    assert.equal(
      shouldRedrawMinimap({
        nowMs: 100,
        lastDrawMs: -Infinity,
        inVehicle: true,
        movedSq: 0,
        yawDiff: 0,
        headDiff: 0,
        blinkChanged: false,
      }),
      true,
    );
  });

  it('enforces hard 15 Hz (66ms) cap while driving even during high-speed motion', () => {
    // 16ms later at 45 m/s (movedSq = 0.56) -> MUST NOT redraw
    assert.equal(
      shouldRedrawMinimap({
        nowMs: 1016,
        lastDrawMs: 1000,
        inVehicle: true,
        movedSq: 0.56,
        yawDiff: 0.2,
        headDiff: 0.2,
        blinkChanged: true,
      }),
      false,
    );

    // 65ms later -> still below 66ms
    assert.equal(
      shouldRedrawMinimap({
        nowMs: 1065,
        lastDrawMs: 1000,
        inVehicle: true,
        movedSq: 1.2,
        yawDiff: 0.1,
        headDiff: 0.1,
        blinkChanged: false,
      }),
      false,
    );

    // 66ms later with motion -> redraws
    assert.equal(
      shouldRedrawMinimap({
        nowMs: 1066,
        lastDrawMs: 1000,
        inVehicle: true,
        movedSq: 0.5,
        yawDiff: 0,
        headDiff: 0,
        blinkChanged: false,
      }),
      true,
    );
  });

  it('enforces 20 Hz (50ms) cap on foot and 180ms idle heartbeat for AI blips', () => {
    assert.equal(
      shouldRedrawMinimap({
        nowMs: 1049,
        lastDrawMs: 1000,
        inVehicle: false,
        movedSq: 1.0,
        yawDiff: 0,
        headDiff: 0,
        blinkChanged: false,
      }),
      false,
    );

    assert.equal(
      shouldRedrawMinimap({
        nowMs: 1050,
        lastDrawMs: 1000,
        inVehicle: false,
        movedSq: 0.05,
        yawDiff: 0,
        headDiff: 0,
        blinkChanged: false,
      }),
      true,
    );

    // Completely stationary: skips at 120ms, redraws at 180ms heartbeat
    assert.equal(
      shouldRedrawMinimap({
        nowMs: 1120,
        lastDrawMs: 1000,
        inVehicle: true,
        movedSq: 0,
        yawDiff: 0,
        headDiff: 0,
        blinkChanged: false,
      }),
      false,
    );
    assert.equal(
      shouldRedrawMinimap({
        nowMs: 1180,
        lastDrawMs: 1000,
        inVehicle: true,
        movedSq: 0,
        yawDiff: 0,
        headDiff: 0,
        blinkChanged: false,
      }),
      true,
    );
  });
});

describe('renderInterpolation — 3-tier hypercar LOD hysteresis', () => {
  it('forces LOD0 for hero/active/transition vehicles at any distance', () => {
    assert.equal(selectVehicleLodTier(2, 10000, true), 0);
  });

  it('applies hysteresis thresholds 0<->1 (18m/22m) and 1<->2 (48m/56m)', () => {
    // From LOD0: stays 0 at 20m (400), drops to 1 at 23m (529), jumps to 2 at 60m (3600)
    assert.equal(selectVehicleLodTier(0, 20 * 20, false), 0);
    assert.equal(selectVehicleLodTier(0, 23 * 23, false), 1);
    assert.equal(selectVehicleLodTier(0, 60 * 60, false), 2);

    // From LOD1: stays 1 at 20m (hysteresis), promotes to 0 at 17m, drops to 2 at 57m
    assert.equal(selectVehicleLodTier(1, 20 * 20, false), 1);
    assert.equal(selectVehicleLodTier(1, 17 * 17, false), 0);
    assert.equal(selectVehicleLodTier(1, 57 * 57, false), 2);

    // From LOD2: stays 2 at 50m (hysteresis), promotes to 1 at 45m, jumps to 0 at 15m
    assert.equal(selectVehicleLodTier(2, 50 * 50, false), 2);
    assert.equal(selectVehicleLodTier(2, 45 * 45, false), 1);
    assert.equal(selectVehicleLodTier(2, 15 * 15, false), 0);
  });
});

describe('renderInterpolation — adaptive resolution hysteresis', () => {
  it('steps down smoothly under sustained >19.5ms load and recovers below 14.2ms', () => {
    const st = createAdaptiveResolutionState();
    assert.equal(st.scale, 1.0);

    // Feed 30ms frames to push EMA above 19.5ms
    let now = 2000;
    let steppedDown = false;
    for (let i = 0; i < 15; i++) {
      const res = stepAdaptiveResolutionScale(st, 30, now);
      if (res.changed) steppedDown = true;
      now += 100;
    }
    assert.equal(steppedDown, true);
    assert.ok(st.scale < 1.0 && st.scale >= 0.82, `Unexpected scale ${st.scale}`);

    // Keep driving heavy frames across multiple cooldowns — must clamp at floor 0.82
    for (let i = 0; i < 8; i++) {
      now += 1600;
      stepAdaptiveResolutionScale(st, 35, now);
    }
    assert.equal(st.scale, 0.82);

    // Feed fast 10ms frames across recovery cooldowns — must return cleanly to 1.0
    for (let i = 0; i < 60; i++) {
      now += 400;
      stepAdaptiveResolutionScale(st, 10, now);
    }
    assert.equal(st.scale, 1.0);
  });
});
