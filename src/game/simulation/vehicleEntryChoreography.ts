import { computeVehicleDoorWorldPoint, normalizeAngle } from '../physics';
import type { VehicleState } from '../types';

/**
 * Single source of truth for AAA vehicle entry/exit choreography timing,
 * butterfly door hydraulic synchronization, and C1-continuous character poses.
 * Pure TypeScript (zero Three.js/DOM dependencies) so it can be unit-tested
 * exhaustively for door clearance and zero-pop joint continuity.
 */

export const ENTER_VEHICLE_DURATION_SEC = 1.62;
export const EXIT_VEHICLE_DURATION_SEC = 1.44;

/** Electro-hydraulic butterfly door speeds (units/sec for 0..1 actuator travel). */
export const DOOR_HYDRAULIC_OPEN_SPEED = 2.65;
export const DOOR_HYDRAULIC_CLOSE_SPEED = 2.15;

/** Normalized progress thresholds (0..1) synchronized with hydraulic door travel. */
export const ENTRY_STEP_IN_START_PROGRESS = 0.36;
export const ENTRY_SILL_CLEAR_PROGRESS = 0.64;
export const ENTRY_SEATED_SETTLE_PROGRESS = 0.80;
export const ENTRY_DOOR_CLOSE_PROGRESS = 0.76;

export const EXIT_STEP_OUT_START_PROGRESS = 0.36;
export const EXIT_OUTSIDE_ARRIVE_PROGRESS = 0.74;
export const EXIT_DOOR_CLOSE_PROGRESS = 0.74;

/** Seated cockpit constants shared between transition handoff and driving rig. */
export const SEATED_RIG_SCALE = 0.8;
export const SEATED_HIP_WORLD_Y = 0.27;
export const SEATED_ROOT_LOCAL_Y = SEATED_HIP_WORLD_Y - 0.88 * SEATED_RIG_SCALE; // -0.434m
export const SEATED_LOCAL_X = 0.3;
export const SEATED_LOCAL_Z = -0.15;

export interface CharacterPoseSnapshot {
  posX: number;
  posY: number;
  posZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  scale: number;
  torsoPosY: number;
  torsoRotX: number;
  torsoRotY: number;
  torsoRotZ: number;
  headRotX: number;
  headRotY: number;
  headRotZ: number;
  leftArmRotX: number;
  leftArmRotY: number;
  leftArmRotZ: number;
  rightArmRotX: number;
  rightArmRotY: number;
  rightArmRotZ: number;
  leftForearmRotX: number;
  rightForearmRotX: number;
  leftLegRotX: number;
  leftLegRotZ: number;
  rightLegRotX: number;
  rightLegRotZ: number;
  leftShinRotX: number;
  rightShinRotX: number;
  shadowScale: number;
}

function clamp01(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Quintic C2-continuous smoothstep (zero 1st & 2nd derivatives at endpoints). */
export function smootherstep01(e0: number, e1: number, x: number): number {
  if (e1 <= e0) return x >= e1 ? 1 : 0;
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerpAngle(a: number, b: number, t: number): number {
  return normalizeAngle(a + normalizeAngle(b - a) * t);
}

function quadBezier(p0: number, p1: number, p2: number, t: number): number {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
}

/**
 * Returns the desired butterfly door target (0 = closed, 1 = open) at a given
 * transition mode & normalized progress. Triggers opening immediately at p=0
 * so the dihedral wing is >92% open before CJ crosses the doorway sill.
 */
export function getVehicleTransitionDoorTarget(
  mode: 'entering' | 'exiting',
  progress: number,
): 0 | 1 {
  if (mode === 'entering') {
    return progress < ENTRY_DOOR_CLOSE_PROGRESS ? 1 : 0;
  }
  return progress < EXIT_DOOR_CLOSE_PROGRESS ? 1 : 0;
}

/**
 * Exact seated cockpit pose (matches driving pose at steerAngle = 0)
 * so handoff between entering->driving and driving->exiting has 0.0 discontinuity.
 */
export function evaluateCanonicalSeatedPose(
  car: Pick<VehicleState, 'x' | 'y' | 'z' | 'heading' | 'pitch' | 'roll'>,
): CharacterPoseSnapshot {
  const seatPt = computeVehicleDoorWorldPoint(car, 1, SEATED_LOCAL_X, SEATED_LOCAL_Z);
  return {
    posX: seatPt.x,
    posY: car.y + SEATED_ROOT_LOCAL_Y,
    posZ: seatPt.z,
    rotX: car.pitch,
    rotY: car.heading,
    rotZ: car.roll,
    scale: SEATED_RIG_SCALE,
    torsoPosY: 0.99,
    torsoRotX: -0.34 - car.pitch * 0.7,
    torsoRotY: 0,
    torsoRotZ: -car.roll * 1.25,
    headRotX: 0.05,
    headRotY: 0,
    headRotZ: -car.roll * 0.5,
    leftArmRotX: -1.04,
    leftArmRotY: 0.08,
    leftArmRotZ: -0.14,
    rightArmRotX: -1.04,
    rightArmRotY: -0.08,
    rightArmRotZ: 0.14,
    leftForearmRotX: -0.48,
    rightForearmRotX: -0.48,
    leftLegRotX: -1.32,
    leftLegRotZ: -0.05,
    rightLegRotX: -1.32,
    rightLegRotZ: 0.05,
    leftShinRotX: 1.35,
    rightShinRotX: 1.35,
    shadowScale: 0,
  };
}

/** Exact neutral on-foot standing pose for clean handoff at exit completion. */
export function evaluateCanonicalStandingPose(
  x: number,
  z: number,
  heading: number,
): CharacterPoseSnapshot {
  return {
    posX: x,
    posY: 0,
    posZ: z,
    rotX: 0,
    rotY: normalizeAngle(heading),
    rotZ: 0,
    scale: 1,
    torsoPosY: 0.99,
    torsoRotX: 0.03,
    torsoRotY: 0,
    torsoRotZ: 0,
    headRotX: 0,
    headRotY: 0,
    headRotZ: 0,
    leftArmRotX: 0.06,
    leftArmRotY: 0,
    leftArmRotZ: -0.11,
    rightArmRotX: -0.04,
    rightArmRotY: 0,
    rightArmRotZ: 0.11,
    leftForearmRotX: -0.24,
    rightForearmRotX: -0.22,
    leftLegRotX: 0.03,
    leftLegRotZ: -0.03,
    rightLegRotX: -0.04,
    rightLegRotZ: 0.03,
    leftShinRotX: 0.05,
    rightShinRotX: 0.05,
    shadowScale: 1,
  };
}

/**
 * Smoothly blends every channel of two CharacterPoseSnapshots (angle-aware for rotY).
 */
export function blendCharacterPose(
  from: CharacterPoseSnapshot,
  to: CharacterPoseSnapshot,
  alpha: number,
  out: CharacterPoseSnapshot = { ...from },
): CharacterPoseSnapshot {
  const t = clamp01(alpha);
  out.posX = lerp(from.posX, to.posX, t);
  out.posY = lerp(from.posY, to.posY, t);
  out.posZ = lerp(from.posZ, to.posZ, t);
  out.rotX = lerp(from.rotX, to.rotX, t);
  out.rotY = lerpAngle(from.rotY, to.rotY, t);
  out.rotZ = lerp(from.rotZ, to.rotZ, t);
  out.scale = lerp(from.scale, to.scale, t);
  out.torsoPosY = lerp(from.torsoPosY, to.torsoPosY, t);
  out.torsoRotX = lerp(from.torsoRotX, to.torsoRotX, t);
  out.torsoRotY = lerp(from.torsoRotY, to.torsoRotY, t);
  out.torsoRotZ = lerp(from.torsoRotZ, to.torsoRotZ, t);
  out.headRotX = lerp(from.headRotX, to.headRotX, t);
  out.headRotY = lerp(from.headRotY, to.headRotY, t);
  out.headRotZ = lerp(from.headRotZ, to.headRotZ, t);
  out.leftArmRotX = lerp(from.leftArmRotX, to.leftArmRotX, t);
  out.leftArmRotY = lerp(from.leftArmRotY, to.leftArmRotY, t);
  out.leftArmRotZ = lerp(from.leftArmRotZ, to.leftArmRotZ, t);
  out.rightArmRotX = lerp(from.rightArmRotX, to.rightArmRotX, t);
  out.rightArmRotY = lerp(from.rightArmRotY, to.rightArmRotY, t);
  out.rightArmRotZ = lerp(from.rightArmRotZ, to.rightArmRotZ, t);
  out.leftForearmRotX = lerp(from.leftForearmRotX, to.leftForearmRotX, t);
  out.rightForearmRotX = lerp(from.rightForearmRotX, to.rightForearmRotX, t);
  out.leftLegRotX = lerp(from.leftLegRotX, to.leftLegRotX, t);
  out.leftLegRotZ = lerp(from.leftLegRotZ, to.leftLegRotZ, t);
  out.rightLegRotX = lerp(from.rightLegRotX, to.rightLegRotX, t);
  out.rightLegRotZ = lerp(from.rightLegRotZ, to.rightLegRotZ, t);
  out.leftShinRotX = lerp(from.leftShinRotX, to.leftShinRotX, t);
  out.rightShinRotX = lerp(from.rightShinRotX, to.rightShinRotX, t);
  out.shadowScale = lerp(from.shadowScale, to.shadowScale, t);
  return out;
}

export interface EntryPoseParams {
  progress: number;
  side: 1 | -1;
  startX: number;
  startZ: number;
  startHeading: number;
  car: Pick<VehicleState, 'x' | 'y' | 'z' | 'heading' | 'pitch' | 'roll'>;
}

/**
 * Evaluates a C1-continuous full-body pose across the entire vehicle entry
 * sequence (0..1):
 *   Phase 1 (0.00..0.36): Walk to exterior doorway staging point & reach for handle
 *                         while dihedral butterfly door opens rapidly to >94%.
 *   Phase 2 (0.36..0.64): Duck smoothly under open wing & step over wide carbon sill.
 *   Phase 3 (0.64..0.80): Pivot & settle cleanly into bucket seat.
 *   Phase 4 (0.80..1.00): Pull butterfly door shut & return hand to steering wheel.
 */
export function evaluateVehicleEntryPose(params: EntryPoseParams): CharacterPoseSnapshot {
  const { side, startX, startZ, startHeading, car } = params;
  const p = clamp01(params.progress);

  const standPt = computeVehicleDoorWorldPoint(car, side, 1.56, -0.28);
  const sillPt = computeVehicleDoorWorldPoint(car, side, 0.72, -0.22);
  const seated = evaluateCanonicalSeatedPose(car);
  const faceDoorYaw = normalizeAngle(car.heading - side * Math.PI * 0.48);
  const midYaw = lerpAngle(faceDoorYaw, car.heading, 0.72);

  // Shared exact boundary pose at P1 (p = 0.36): outside doorway, reaching for open wing
  const p1LeftArmX = side === 1 ? -0.14 : -0.92;
  const p1LeftArmZ = side === 1 ? -0.12 : -0.22;
  const p1LeftForearmX = side === 1 ? -0.28 : -0.48;
  const p1RightArmX = side === 1 ? -0.92 : -0.14;
  const p1RightArmZ = side === 1 ? 0.22 : 0.12;
  const p1RightForearmX = side === 1 ? -0.48 : -0.28;

  // Shared exact boundary pose at P2 (p = 0.64): crouched inside carbon sill
  const p2PosY = car.y - 0.15;
  const p2Scale = 0.89;
  const p2TorsoX = -0.12;
  const p2HeadX = 0.08;
  const p2LeftArmX = -0.54;
  const p2LeftArmY = 0.04;
  const p2LeftArmZ = -0.13;
  const p2RightArmX = -0.54;
  const p2RightArmY = -0.04;
  const p2RightArmZ = 0.13;
  const p2ForearmX = -0.56;
  const p2LeftLegX = side === 1 ? -0.68 : -0.54;
  const p2RightLegX = side === 1 ? -0.54 : -0.68;
  const p2LeftShinX = side === 1 ? 0.72 : 0.62;
  const p2RightShinX = side === 1 ? 0.62 : 0.72;

  if (p < ENTRY_STEP_IN_START_PROGRESS) {
    // Phase 1 (0.00 -> 0.36): Approach outside doorway while butterfly door swings open
    const t = smootherstep01(0, ENTRY_STEP_IN_START_PROGRESS, p);
    const reach = smootherstep01(0.08, ENTRY_STEP_IN_START_PROGRESS, p);
    // Exact 2 full half-waves (sin(2*PI*t) === 0 at t=0 and t=1 -> zero boundary pop)
    const stride = Math.sin(t * Math.PI * 2.0) * (1 - reach * 0.6);

    return {
      posX: lerp(startX, standPt.x, t),
      posY: 0,
      posZ: lerp(startZ, standPt.z, t),
      rotX: 0,
      rotY: lerpAngle(startHeading, faceDoorYaw, t),
      rotZ: 0,
      scale: 1,
      torsoPosY: 0.99 + Math.abs(stride) * 0.025,
      torsoRotX: lerp(0.03, 0.12, t),
      torsoRotY: -stride * 0.07,
      torsoRotZ: 0,
      headRotX: lerp(0, 0.04, t),
      headRotY: 0,
      headRotZ: 0,
      leftArmRotX:
        side === 1
          ? lerp(0.06, p1LeftArmX, t) - stride * 0.42
          : lerp(0.06, p1LeftArmX, reach) + stride * 0.32 * (1 - reach),
      leftArmRotY: 0,
      leftArmRotZ: lerp(-0.11, p1LeftArmZ, reach),
      rightArmRotX:
        side === 1
          ? lerp(-0.04, p1RightArmX, reach) - stride * 0.32 * (1 - reach)
          : lerp(-0.04, p1RightArmX, t) + stride * 0.42,
      rightArmRotY: 0,
      rightArmRotZ: lerp(0.11, p1RightArmZ, reach),
      leftForearmRotX: lerp(-0.24, p1LeftForearmX, reach),
      rightForearmRotX: lerp(-0.22, p1RightForearmX, reach),
      leftLegRotX: lerp(0.03, 0, t) + stride * 0.52,
      leftLegRotZ: -0.03,
      rightLegRotX: lerp(-0.04, 0, t) - stride * 0.52,
      rightLegRotZ: 0.03,
      leftShinRotX: lerp(0.05, 0.08, t) + Math.max(0, -stride) * 0.62,
      rightShinRotX: lerp(0.05, 0.08, t) + Math.max(0, stride) * 0.62,
      shadowScale: 1,
    };
  }

  if (p < ENTRY_SILL_CLEAR_PROGRESS) {
    // Phase 2 (0.36 -> 0.64): Duck under raised butterfly wing & step over wide carbon sill
    const t = smootherstep01(ENTRY_STEP_IN_START_PROGRESS, ENTRY_SILL_CLEAR_PROGRESS, p);
    const arc = Math.sin(t * Math.PI); // 0 at t=0 and t=1
    const stepSwing = Math.sin(t * Math.PI); // 0 at t=0 and t=1

    return {
      posX: lerp(standPt.x, sillPt.x, t),
      posY: lerp(0, p2PosY, t) + arc * 0.18,
      posZ: lerp(standPt.z, sillPt.z, t),
      rotX: lerp(0, car.pitch * 0.45, t),
      rotY: lerpAngle(faceDoorYaw, midYaw, t),
      rotZ: lerp(0, car.roll * 0.45, t),
      scale: lerp(1, p2Scale, t),
      torsoPosY: 0.99,
      torsoRotX: lerp(0.12, p2TorsoX, t) + 0.44 * arc,
      torsoRotY: (side === 1 ? -0.12 : 0.12) * arc,
      torsoRotZ: lerp(0, -car.roll * 0.5, t),
      headRotX: lerp(0.04, p2HeadX, t) + 0.2 * arc,
      headRotY: 0,
      headRotZ: lerp(0, -car.roll * 0.2, t),
      leftArmRotX: lerp(p1LeftArmX, p2LeftArmX, t) - 0.35 * arc,
      leftArmRotY: lerp(0, p2LeftArmY, t),
      leftArmRotZ: lerp(p1LeftArmZ, p2LeftArmZ, t),
      rightArmRotX: lerp(p1RightArmX, p2RightArmX, t) - 0.35 * arc,
      rightArmRotY: lerp(0, p2RightArmY, t),
      rightArmRotZ: lerp(p1RightArmZ, p2RightArmZ, t),
      leftForearmRotX: lerp(p1LeftForearmX, p2ForearmX, t) - 0.14 * arc,
      rightForearmRotX: lerp(p1RightForearmX, p2ForearmX, t) - 0.14 * arc,
      leftLegRotX:
        side === 1
          ? lerp(0, p2LeftLegX, t) - 1.1 * stepSwing
          : lerp(0, p2LeftLegX, t) - 0.25 * stepSwing,
      leftLegRotZ: lerp(-0.03, -0.04, t),
      rightLegRotX:
        side === 1
          ? lerp(0, p2RightLegX, t) - 0.25 * stepSwing
          : lerp(0, p2RightLegX, t) - 1.1 * stepSwing,
      rightLegRotZ: lerp(0.03, 0.04, t),
      leftShinRotX:
        side === 1
          ? lerp(0.08, p2LeftShinX, t) + 1.25 * stepSwing
          : lerp(0.08, p2LeftShinX, t) + 0.35 * stepSwing,
      rightShinRotX:
        side === 1
          ? lerp(0.08, p2RightShinX, t) + 0.35 * stepSwing
          : lerp(0.08, p2RightShinX, t) + 1.25 * stepSwing,
      shadowScale: 1 - smootherstep01(0.0, 0.55, t),
    };
  }

  if (p < ENTRY_SEATED_SETTLE_PROGRESS) {
    // Phase 3 (0.64 -> 0.80): Pivot & settle smoothly into bucket seat
    const t = smootherstep01(ENTRY_SILL_CLEAR_PROGRESS, ENTRY_SEATED_SETTLE_PROGRESS, p);
    return {
      posX: lerp(sillPt.x, seated.posX, t),
      posY: lerp(p2PosY, seated.posY, t),
      posZ: lerp(sillPt.z, seated.posZ, t),
      rotX: lerp(car.pitch * 0.45, seated.rotX, t),
      rotY: lerpAngle(midYaw, seated.rotY, t),
      rotZ: lerp(car.roll * 0.45, seated.rotZ, t),
      scale: lerp(p2Scale, seated.scale, t),
      torsoPosY: 0.99,
      torsoRotX: lerp(p2TorsoX, seated.torsoRotX, t),
      torsoRotY: 0,
      torsoRotZ: lerp(-car.roll * 0.5, seated.torsoRotZ, t),
      headRotX: lerp(p2HeadX, seated.headRotX, t),
      headRotY: 0,
      headRotZ: lerp(-car.roll * 0.2, seated.headRotZ, t),
      leftArmRotX: lerp(p2LeftArmX, seated.leftArmRotX, t),
      leftArmRotY: lerp(p2LeftArmY, seated.leftArmRotY, t),
      leftArmRotZ: lerp(p2LeftArmZ, seated.leftArmRotZ, t),
      rightArmRotX: lerp(p2RightArmX, seated.rightArmRotX, t),
      rightArmRotY: lerp(p2RightArmY, seated.rightArmRotY, t),
      rightArmRotZ: lerp(p2RightArmZ, seated.rightArmRotZ, t),
      leftForearmRotX: lerp(p2ForearmX, seated.leftForearmRotX, t),
      rightForearmRotX: lerp(p2ForearmX, seated.rightForearmRotX, t),
      leftLegRotX: lerp(p2LeftLegX, seated.leftLegRotX, t),
      leftLegRotZ: lerp(-0.04, seated.leftLegRotZ, t),
      rightLegRotX: lerp(p2RightLegX, seated.rightLegRotX, t),
      rightLegRotZ: lerp(0.04, seated.rightLegRotZ, t),
      leftShinRotX: lerp(p2LeftShinX, seated.leftShinRotX, t),
      rightShinRotX: lerp(p2RightShinX, seated.rightShinRotX, t),
      shadowScale: 0,
    };
  }

  // Phase 4 (0.80 -> 1.00): Pull butterfly door shut & return hand to steering wheel
  const t = smootherstep01(ENTRY_SEATED_SETTLE_PROGRESS, 1.0, p);
  const pullArc = Math.sin(t * Math.PI); // 0 at t=0 and t=1 -> exact match with seated pose!
  return {
    ...seated,
    torsoRotY: (side === 1 ? -0.14 : 0.14) * pullArc,
    headRotY: (side === 1 ? -0.18 : 0.18) * pullArc,
    leftArmRotX: seated.leftArmRotX - (side === 1 ? 0.52 * pullArc : 0),
    leftArmRotZ: seated.leftArmRotZ - (side === 1 ? 0.34 * pullArc : 0),
    leftForearmRotX: seated.leftForearmRotX - (side === 1 ? 0.48 * pullArc : 0),
    rightArmRotX: seated.rightArmRotX - (side === -1 ? 0.52 * pullArc : 0),
    rightArmRotZ: seated.rightArmRotZ + (side === -1 ? 0.34 * pullArc : 0),
    rightForearmRotX: seated.rightForearmRotX - (side === -1 ? 0.48 * pullArc : 0),
  };
}

export interface ExitPoseParams {
  progress: number;
  side: 1 | -1;
  car: Pick<VehicleState, 'x' | 'y' | 'z' | 'heading' | 'pitch' | 'roll'>;
}

/**
 * Evaluates a C1-continuous full-body pose across the entire vehicle exit
 * sequence (0..1):
 *   Phase 1 (0.00..0.36): Twist toward door & push butterfly release upward while
 *                         dihedral wing opens rapidly to >92% clearance.
 *   Phase 2 (0.36..0.74): Swing smoothly out across sill along a C2 quadratic Bezier
 *                         onto the asphalt outside the door arc.
 *   Phase 3 (0.74..1.00): Straighten up & turn forward while door closes behind CJ.
 */
export function evaluateVehicleExitPose(params: ExitPoseParams): CharacterPoseSnapshot {
  const { side, car } = params;
  const p = clamp01(params.progress);

  const seated = evaluateCanonicalSeatedPose(car);
  const sillControlPt = computeVehicleDoorWorldPoint(car, side, 0.92, -0.22);
  const exitPt = computeVehicleDoorWorldPoint(car, side, 1.58, -0.26);
  const standing = evaluateCanonicalStandingPose(exitPt.x, exitPt.z, car.heading);

  const faceOutYaw = normalizeAngle(car.heading + side * Math.PI * 0.42);
  const midYaw = lerpAngle(car.heading, faceOutYaw, 0.45);

  // Shared exact boundary pose at Q1 (p = 0.36): seated, pivoted toward open doorway
  const q1TorsoX = 0.04;
  const q1HeadX = 0.04;
  const q1LeftArmX = -0.56;
  const q1LeftArmY = 0.03;
  const q1LeftArmZ = -0.12;
  const q1RightArmX = -0.56;
  const q1RightArmY = -0.03;
  const q1RightArmZ = 0.12;
  const q1ForearmX = -0.44;
  const q1LegX = -0.96;
  const q1ShinX = 1.14;

  // Shared exact boundary pose at Q2 (p = 0.74): planted outside on asphalt, facing out
  const q2TorsoX = 0.08;
  const q2HeadX = 0.02;
  const q2LeftArmX = -0.06;
  const q2RightArmX = -0.06;
  const q2ForearmX = -0.24;
  const q2LeftLegX = side === 1 ? 0.08 : -0.08;
  const q2RightLegX = side === 1 ? -0.08 : 0.08;
  const q2ShinX = 0.06;

  if (p < EXIT_STEP_OUT_START_PROGRESS) {
    // Phase 1 (0.00 -> 0.36): Turn in seat & push dihedral door open while waiting for clearance
    const t = smootherstep01(0, EXIT_STEP_OUT_START_PROGRESS, p);
    const pushArc = Math.sin(t * Math.PI); // 0 at t=0 and t=1

    return {
      posX: seated.posX,
      posY: seated.posY,
      posZ: seated.posZ,
      rotX: seated.rotX,
      rotY: lerpAngle(seated.rotY, midYaw, t),
      rotZ: seated.rotZ,
      scale: SEATED_RIG_SCALE,
      torsoPosY: 0.99,
      torsoRotX: lerp(seated.torsoRotX, q1TorsoX, t),
      torsoRotY: (side === 1 ? -0.16 : 0.16) * pushArc,
      torsoRotZ: seated.torsoRotZ,
      headRotX: lerp(seated.headRotX, q1HeadX, t),
      headRotY: (side === 1 ? -0.22 : 0.22) * pushArc,
      headRotZ: seated.headRotZ,
      leftArmRotX: lerp(seated.leftArmRotX, q1LeftArmX, t) - (side === 1 ? 0.56 : 0.2) * pushArc,
      leftArmRotY: lerp(seated.leftArmRotY, q1LeftArmY, t),
      leftArmRotZ: lerp(seated.leftArmRotZ, q1LeftArmZ, t) - (side === 1 ? 0.28 * pushArc : 0),
      rightArmRotX: lerp(seated.rightArmRotX, q1RightArmX, t) - (side === -1 ? 0.56 : 0.2) * pushArc,
      rightArmRotY: lerp(seated.rightArmRotY, q1RightArmY, t),
      rightArmRotZ: lerp(seated.rightArmRotZ, q1RightArmZ, t) + (side === -1 ? 0.28 * pushArc : 0),
      leftForearmRotX: lerp(seated.leftForearmRotX, q1ForearmX, t) - 0.18 * pushArc,
      rightForearmRotX: lerp(seated.rightForearmRotX, q1ForearmX, t) - 0.18 * pushArc,
      leftLegRotX: lerp(seated.leftLegRotX, q1LegX, t),
      leftLegRotZ: lerp(seated.leftLegRotZ, -0.04, t),
      rightLegRotX: lerp(seated.rightLegRotX, q1LegX, t),
      rightLegRotZ: lerp(seated.rightLegRotZ, 0.04, t),
      leftShinRotX: lerp(seated.leftShinRotX, q1ShinX, t),
      rightShinRotX: lerp(seated.rightShinRotX, q1ShinX, t),
      shadowScale: 0,
    };
  }

  if (p < EXIT_OUTSIDE_ARRIVE_PROGRESS) {
    // Phase 2 (0.36 -> 0.74): Smooth quadratic Bezier swing out across open doorway
    const t = smootherstep01(EXIT_STEP_OUT_START_PROGRESS, EXIT_OUTSIDE_ARRIVE_PROGRESS, p);
    const arc = Math.sin(t * Math.PI); // 0 at t=0 and t=1

    return {
      posX: quadBezier(seated.posX, sillControlPt.x, exitPt.x, t),
      posY: lerp(seated.posY, 0, t) + arc * 0.18,
      posZ: quadBezier(seated.posZ, sillControlPt.z, exitPt.z, t),
      rotX: lerp(seated.rotX, 0, t),
      rotY: lerpAngle(midYaw, faceOutYaw, t),
      rotZ: lerp(seated.rotZ, 0, t),
      scale: lerp(SEATED_RIG_SCALE, 1, t),
      torsoPosY: 0.99,
      torsoRotX: lerp(q1TorsoX, q2TorsoX, t) + 0.36 * arc,
      torsoRotY: (side === 1 ? -0.1 : 0.1) * arc,
      torsoRotZ: lerp(seated.torsoRotZ, 0, t),
      headRotX: lerp(q1HeadX, q2HeadX, t) + 0.15 * arc,
      headRotY: 0,
      headRotZ: lerp(seated.headRotZ, 0, t),
      leftArmRotX: lerp(q1LeftArmX, q2LeftArmX, t) - 0.18 * arc,
      leftArmRotY: lerp(q1LeftArmY, 0, t),
      leftArmRotZ: lerp(q1LeftArmZ, -0.11, t),
      rightArmRotX: lerp(q1RightArmX, q2RightArmX, t) - 0.18 * arc,
      rightArmRotY: lerp(q1RightArmY, 0, t),
      rightArmRotZ: lerp(q1RightArmZ, 0.11, t),
      leftForearmRotX: lerp(q1ForearmX, q2ForearmX, t) - 0.12 * arc,
      rightForearmRotX: lerp(q1ForearmX, q2ForearmX, t) - 0.12 * arc,
      leftLegRotX:
        side === 1
          ? lerp(q1LegX, q2LeftLegX, t) - 0.62 * arc
          : lerp(q1LegX, q2LeftLegX, t) - 0.38 * arc,
      leftLegRotZ: lerp(-0.04, -0.03, t),
      rightLegRotX:
        side === 1
          ? lerp(q1LegX, q2RightLegX, t) - 0.38 * arc
          : lerp(q1LegX, q2RightLegX, t) - 0.62 * arc,
      rightLegRotZ: lerp(0.04, 0.03, t),
      leftShinRotX: lerp(q1ShinX, q2ShinX, t) + (side === 1 ? 0.52 : 0.4) * arc,
      rightShinRotX: lerp(q1ShinX, q2ShinX, t) + (side === 1 ? 0.4 : 0.52) * arc,
      shadowScale: smootherstep01(0.45, 1.0, t),
    };
  }

  // Phase 3 (0.74 -> 1.00): Straighten up & turn forward into exact standing idle pose
  const t = smootherstep01(EXIT_OUTSIDE_ARRIVE_PROGRESS, 1.0, p);
  return {
    posX: exitPt.x,
    posY: 0,
    posZ: exitPt.z,
    rotX: 0,
    rotY: lerpAngle(faceOutYaw, standing.rotY, t),
    rotZ: 0,
    scale: 1,
    torsoPosY: 0.99,
    torsoRotX: lerp(q2TorsoX, standing.torsoRotX, t),
    torsoRotY: 0,
    torsoRotZ: 0,
    headRotX: lerp(q2HeadX, standing.headRotX, t),
    headRotY: 0,
    headRotZ: 0,
    leftArmRotX: lerp(q2LeftArmX, standing.leftArmRotX, t),
    leftArmRotY: 0,
    leftArmRotZ: -0.11,
    rightArmRotX: lerp(q2RightArmX, standing.rightArmRotX, t),
    rightArmRotY: 0,
    rightArmRotZ: 0.11,
    leftForearmRotX: lerp(q2ForearmX, standing.leftForearmRotX, t),
    rightForearmRotX: lerp(q2ForearmX, standing.rightForearmRotX, t),
    leftLegRotX: lerp(q2LeftLegX, standing.leftLegRotX, t),
    leftLegRotZ: -0.03,
    rightLegRotX: lerp(q2RightLegX, standing.rightLegRotX, t),
    rightLegRotZ: 0.03,
    leftShinRotX: lerp(q2ShinX, standing.leftShinRotX, t),
    rightShinRotX: lerp(q2ShinX, standing.rightShinRotX, t),
    shadowScale: 1,
  };
}
