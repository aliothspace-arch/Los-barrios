import type { PlayerState, VehicleState } from '../types';
import { normalizeAngle } from '../physics';

export interface VehiclePoseSnapshot {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  roll: number;
}

export interface PlayerPoseSnapshot {
  x: number;
  y: number;
  z: number;
  heading: number;
}

export type VehicleLodTier = 0 | 1 | 2;

export function lerpAngleShortest(from: number, to: number, alpha: number): number {
  const diff = normalizeAngle(to - from);
  return normalizeAngle(from + diff * alpha);
}

export function interpolateVehiclePose(
  prev: VehiclePoseSnapshot | undefined,
  curr: Pick<VehicleState, 'x' | 'y' | 'z' | 'heading' | 'pitch' | 'roll'>,
  alpha: number,
  out: VehiclePoseSnapshot,
): VehiclePoseSnapshot {
  if (!prev) {
    out.x = curr.x;
    out.y = curr.y;
    out.z = curr.z;
    out.heading = curr.heading;
    out.pitch = curr.pitch;
    out.roll = curr.roll;
    return out;
  }
  const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  // Teleport guard: if vehicle jumped > 12m in a single tick, snap instead of smearing across the map
  const dx = curr.x - prev.x;
  const dz = curr.z - prev.z;
  if (dx * dx + dz * dz > 144) {
    out.x = curr.x;
    out.y = curr.y;
    out.z = curr.z;
    out.heading = curr.heading;
    out.pitch = curr.pitch;
    out.roll = curr.roll;
    return out;
  }
  out.x = prev.x + dx * t;
  out.y = prev.y + (curr.y - prev.y) * t;
  out.z = prev.z + dz * t;
  out.heading = lerpAngleShortest(prev.heading, curr.heading, t);
  out.pitch = prev.pitch + (curr.pitch - prev.pitch) * t;
  out.roll = prev.roll + (curr.roll - prev.roll) * t;
  return out;
}

export function interpolatePlayerPose(
  prev: PlayerPoseSnapshot | undefined,
  curr: Pick<PlayerState, 'x' | 'y' | 'z' | 'heading'>,
  alpha: number,
  out: PlayerPoseSnapshot,
): PlayerPoseSnapshot {
  if (!prev) {
    out.x = curr.x;
    out.y = curr.y;
    out.z = curr.z;
    out.heading = curr.heading;
    return out;
  }
  const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  const dx = curr.x - prev.x;
  const dz = curr.z - prev.z;
  if (dx * dx + dz * dz > 64) {
    out.x = curr.x;
    out.y = curr.y;
    out.z = curr.z;
    out.heading = curr.heading;
    return out;
  }
  out.x = prev.x + dx * t;
  out.y = prev.y + (curr.y - prev.y) * t;
  out.z = prev.z + dz * t;
  out.heading = lerpAngleShortest(prev.heading, curr.heading, t);
  return out;
}

/**
 * Zero-allocation previous-tick pose snapshot cache used to interpolate
 * fixed-60Hz simulation state onto arbitrary display refresh rates (60/90/120/144 Hz).
 */
export class RenderPoseHistory {
  private readonly prevVehicles = new Map<string, VehiclePoseSnapshot>();
  private readonly prevPlayer: PlayerPoseSnapshot = { x: 0, y: 0, z: 0, heading: 0 };
  private hasPlayerSnapshot = false;

  public captureBeforeStep(player: PlayerState, vehicles: readonly VehicleState[]): void {
    this.prevPlayer.x = player.x;
    this.prevPlayer.y = player.y;
    this.prevPlayer.z = player.z;
    this.prevPlayer.heading = player.heading;
    this.hasPlayerSnapshot = true;

    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      let snap = this.prevVehicles.get(v.id);
      if (!snap) {
        snap = {
          x: v.x,
          y: v.y,
          z: v.z,
          heading: v.heading,
          pitch: v.pitch,
          roll: v.roll,
        };
        this.prevVehicles.set(v.id, snap);
      } else {
        snap.x = v.x;
        snap.y = v.y;
        snap.z = v.z;
        snap.heading = v.heading;
        snap.pitch = v.pitch;
        snap.roll = v.roll;
      }
    }
  }

  public snapToCurrent(player: PlayerState, vehicles: readonly VehicleState[]): void {
    this.prevVehicles.clear();
    this.captureBeforeStep(player, vehicles);
  }

  public getPrevVehicle(id: string): VehiclePoseSnapshot | undefined {
    return this.prevVehicles.get(id);
  }

  public getPrevPlayer(): PlayerPoseSnapshot | undefined {
    return this.hasPlayerSnapshot ? this.prevPlayer : undefined;
  }
}

export interface MinimapThrottleParams {
  nowMs: number;
  lastDrawMs: number;
  inVehicle: boolean;
  movedSq: number;
  yawDiff: number;
  headDiff: number;
  blinkChanged: boolean;
}

/**
 * Hard-capped radar minimap cadence:
 * - Never redraws faster than 15 Hz (66ms) while driving or 20 Hz (50ms) on foot,
 *   preventing high-speed driving from bypassing the throttle and triggering 60 FPS
 *   2D canvas composites over the WebGL canvas.
 * - Once the interval elapses, redraws if the player moved/turned, sirens blinked,
 *   or 180ms elapsed (so nearby AI traffic blips still animate smoothly while parked).
 */
export function shouldRedrawMinimap(params: MinimapThrottleParams): boolean {
  const { nowMs, lastDrawMs, inVehicle, movedSq, yawDiff, headDiff, blinkChanged } = params;
  if (!Number.isFinite(lastDrawMs)) return true;

  const elapsed = nowMs - lastDrawMs;
  const minIntervalMs = inVehicle ? 66 : 50;
  if (elapsed < minIntervalMs) return false;

  return (
    blinkChanged ||
    movedSq >= 0.04 ||
    yawDiff >= 0.015 ||
    headDiff >= 0.025 ||
    elapsed >= 180
  );
}

/**
 * 3-tier hypercar LOD selector with hysteresis to prevent popping:
 * - LOD0 (<18m -> keep until 22m): Full Class-A geometry, articulated doors/frunk/cockpit
 * - LOD1 (22m..56m, hysteresis 18m / 48m): Exterior stride-3 parametric body + spinning wheels
 * - LOD2 (>56m, hysteresis 48m): Ultra-light stride-6 exterior silhouette + fused tires (~3K tris)
 */
export function selectVehicleLodTier(
  prevTier: VehicleLodTier,
  distSq: number,
  forceLod0: boolean,
): VehicleLodTier {
  if (forceLod0) return 0;
  if (prevTier === 0) {
    if (distSq > 3136) return 2; // >56m
    if (distSq > 484) return 1; // >22m
    return 0;
  }
  if (prevTier === 1) {
    if (distSq < 324) return 0; // <18m
    if (distSq > 3136) return 2; // >56m
    return 1;
  }
  // prevTier === 2
  if (distSq < 324) return 0;
  if (distSq < 2304) return 1; // <48m
  return 2;
}

export interface AdaptiveResolutionState {
  emaFrameMs: number;
  scale: number;
  lastAdjustMs: number;
}

export function createAdaptiveResolutionState(): AdaptiveResolutionState {
  return {
    emaFrameMs: 16.0,
    scale: 1.0,
    lastAdjustMs: 0,
  };
}

/**
 * Smooth hysteresis-guarded adaptive render-target scale (0.82..1.0) for hardware GPUs.
 * Steps down when sustained frame time exceeds 19.5ms (<51 FPS) and recovers smoothly
 * once frame time stays below 14.2ms (>70 FPS headroom), rate-limited to avoid resize churn.
 */
export function stepAdaptiveResolutionScale(
  state: AdaptiveResolutionState,
  frameMs: number,
  nowMs: number,
): { scale: number; changed: boolean } {
  const clampedFrame = Math.min(80, Math.max(4, frameMs));
  state.emaFrameMs = state.emaFrameMs * 0.92 + clampedFrame * 0.08;

  if (state.emaFrameMs > 19.5 && state.scale > 0.82 && nowMs - state.lastAdjustMs >= 1500) {
    state.scale = Math.max(0.82, Math.round((state.scale - 0.06) * 100) / 100);
    state.lastAdjustMs = nowMs;
    return { scale: state.scale, changed: true };
  }

  if (state.emaFrameMs < 14.2 && state.scale < 1.0 && nowMs - state.lastAdjustMs >= 2000) {
    state.scale = Math.min(1.0, Math.round((state.scale + 0.06) * 100) / 100);
    state.lastAdjustMs = nowMs;
    return { scale: state.scale, changed: true };
  }

  return { scale: state.scale, changed: false };
}
