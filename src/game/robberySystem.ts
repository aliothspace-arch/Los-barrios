import type {
  RobberyActionType,
  RobberyDialogueLine,
  RobberyHUDState,
  RobberyOutcome,
  RobberyPhase,
  RobberyQTEPrompt,
  ShopSpec,
} from './types';

import {
  getShopOwnerProfile,
  SHOP_OWNER_PROFILES,
  type ShopOwnerProfile,
} from './data/robberyDialogues';
import { DialogueDirector, type DialoguePriority } from './dialogueDirector';
import { worldToShopSpace } from './shopSystem';
import { shopLocalToWorld } from './worldLayout';

export { getShopOwnerProfile, SHOP_OWNER_PROFILES, type ShopOwnerProfile };

/**
 * Pure weighted randomness calculator for whether the shop owner cooperates or fights back.
 * Strictly clamped to [0.18, 0.82] so every robbery stays genuinely unpredictable!
 */
export function computeCooperationProbability(
  baseBravery: number,
  intimidation: number,
  rage: number,
): number {
  const clampedIntim = Math.max(0, Math.min(100, intimidation));
  const clampedRage = Math.max(0, Math.min(100, rage));
  const baseCoop = 0.72 - baseBravery * 0.58;
  const intimBoost = (clampedIntim / 100) * 0.34;
  const ragePenalty = Math.max(0, (clampedRage - 32) / 68) * 0.36;
  const raw = baseCoop + intimBoost - ragePenalty;
  return Math.max(0.18, Math.min(0.82, raw));
}

export function rollRobberyOutcome(
  baseBravery: number,
  intimidation: number,
  rage: number,
  rng: () => number = Math.random,
): RobberyOutcome {
  const coopProb = computeCooperationProbability(baseBravery, intimidation, rage);
  return rng() < coopProb ? 'comply' : 'rebel';
}

export interface RobberyEvent {
  type:
    | 'dialogue'
    | 'sfx'
    | 'damage_player'
    | 'camera_trauma'
    | 'hitstop'
    | 'bill_burst'
    | 'completed';
  dialogue?: RobberyDialogueLine;
  sfx?:
    | 'door_chime'
    | 'register_keys'
    | 'drawer_pop'
    | 'cash_rustle'
    | 'bag_zip'
    | 'bat_whoosh'
    | 'bat_crack'
    | 'punch_impact'
    | 'dodge_whoosh'
    | 'qte_success'
    | 'qte_fail'
    | 'alarm';
  amount?: number;
  payout?: number;
  wantedStars?: number;
  outcome?: RobberyOutcome;
  clerkKo?: boolean;
}

export interface RobberyMoveInput {
  moveX: number; // -1..1 (right in shop-local space)
  moveZ: number; // -1..1 (+1 toward door / street)
  sprint: boolean;
}

export interface CashStackAnimState {
  index: number;
  state: 'drawer' | 'placing' | 'counter' | 'bagging' | 'bagged';
  progress: number; // 0..1 within current state
  value: number;
}

export type ClerkBrawlAction =
  | 'behind_counter'
  | 'drawing_bat'
  | 'chase'
  | 'windup'
  | 'swing'
  | 'recover'
  | 'stagger'
  | 'ko';

export interface RobberySpatialBounds {
  isOutdoor: boolean;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  counterMinX: number;
  counterMaxX: number;
  counterMinZ: number;
  counterMaxZ: number;
  standoffZ: number;
  clerkHomeZ: number;
  exitMinX: number;
  exitMaxX: number;
  exitTriggerZ: number;
  exitRadius: number;
}

export interface RobberySession {
  shop: ShopSpec;
  profile: ShopOwnerProfile;
  bounds: RobberySpatialBounds;
  phase: RobberyPhase;
  outcome: RobberyOutcome;
  phaseTime: number;
  totalTime: number;

  // Intimidation & emotional meters
  intimidation: number; // 0..100
  rage: number; // 0..100
  threatenCooldown: number;
  rushCooldown: number;
  clerkReactQueued: boolean;

  // Cash & bag state
  bagCash: number;
  totalStacks: number;
  stacksCollected: number;
  activeStackIndex: number;
  stacks: CashStackAnimState[];
  drawerOpenRatio: number; // 0..1
  bagOpenRatio: number; // 0..1
  bagOnCounter: boolean;
  registerLooted: boolean;
  lootingTimer: number;

  // Interactive QTE state
  qteWindow: number;
  qteElapsed: number;
  qteResolved: boolean;
  qteSweetMin: number;
  qteSweetMax: number;

  // Entry lerp starting coordinates (shop-local)
  startCjX: number;
  startCjZ: number;
  startCjHeading: number;

  // Real-time 3D positions in shop-local space (+Z faces out the door / street)
  cjX: number;
  cjZ: number;
  cjHeading: number;
  cjWalkCycle: number;
  cjGesture:
    | 'idle'
    | 'walk'
    | 'point'
    | 'slam'
    | 'bag_sweep'
    | 'duck_dodge'
    | 'counter_hook'
    | 'punch_l'
    | 'punch_r'
    | 'hurt'
    | 'sprint_exit';
  cjGestureTimer: number;
  cjDodgeTimer: number;
  cjDodgeCooldown: number;
  cjDodgeDirX: number;
  cjDodgeDirZ: number;
  cjPunchCooldown: number;
  cjPunchCombo: number;
  cjHitFlash: number;

  clerkX: number;
  clerkZ: number;
  clerkHeading: number;
  clerkWalkCycle: number;
  clerkHealth: number;
  clerkHasBat: boolean;
  clerkBatDropped: boolean;
  clerkBatDropX: number;
  clerkBatDropZ: number;
  clerkAction: ClerkBrawlAction;
  clerkActionTimer: number;
  clerkSwingHitApplied: boolean;
  clerkHitFlash: number;
  clerkKoFallProgress: number; // 0..1

  // Synchronized FIFO Dialogue Director & UI feedback
  dialogueDirector: DialogueDirector;
  dialogueCounter: number;
  currentDialogue: RobberyDialogueLine | null;
  dialogueTimer: number;
  feedbackText: string | null;
  feedbackTone: 'good' | 'warn' | 'bad';
  feedbackTimer: number;

  // Completion
  completed: boolean;
  forcedOutcomeRoll?: number;
}

// Baseline interior bounds preserved for compatibility & unit tests
export const INTERIOR_BOUNDS = {
  minX: -3.65,
  maxX: 3.65,
  minZ: -2.4,
  maxZ: 6.8,
  counterMinX: -2.15,
  counterMaxX: 2.15,
  counterMinZ: -1.55,
  counterMaxZ: -0.65,
  exitMinX: -1.65,
  exitMaxX: 1.65,
  exitTriggerZ: 5.95,
};

export function computeRobberySpatialBounds(shop: ShopSpec): RobberySpatialBounds {
  const isOutdoor = shop.venueMode !== 'indoor';
  const counterPad = 0.08;
  const counterMinX = -shop.counterHalfW - counterPad;
  const counterMaxX = shop.counterHalfW + counterPad;
  const counterMinZ = shop.counterLocalZ - shop.counterHalfD - counterPad;
  const counterMaxZ = shop.counterLocalZ + shop.counterHalfD + counterPad;

  const clerkHomeZ = shop.counterLocalZ - shop.counterHalfD - 0.55;
  const standoffZ = counterMaxZ + 0.72;

  if (isOutdoor) {
    return {
      isOutdoor: true,
      minX: -8.5,
      maxX: 8.5,
      minZ: -5.5,
      maxZ: standoffZ + 7.2,
      counterMinX,
      counterMaxX,
      counterMinZ,
      counterMaxZ,
      standoffZ,
      clerkHomeZ,
      exitMinX: -8.5,
      exitMaxX: 8.5,
      exitTriggerZ: standoffZ + 5.8,
      exitRadius: 5.8,
    };
  }

  const doorLocalZ =
    shop.doorX !== undefined && shop.doorZ !== undefined
      ? worldToShopSpace(shop, shop.doorX, shop.doorZ).lz
      : 6.5;

  return {
    isOutdoor: false,
    minX: -3.6,
    maxX: 3.6,
    minZ: -2.38,
    maxZ: doorLocalZ + 0.65,
    counterMinX,
    counterMaxX,
    counterMinZ,
    counterMaxZ,
    standoffZ,
    clerkHomeZ,
    exitMinX: -1.65,
    exitMaxX: 1.65,
    exitTriggerZ: Math.max(2.6, doorLocalZ - 0.55),
    exitRadius: 99,
  };
}

export function getRobberyCjWorldTransform(
  s: RobberySession,
): { x: number; z: number; heading: number } {
  const w = shopLocalToWorld(s.shop.originX, s.shop.originZ, s.shop.facingHeading, s.cjX, s.cjZ);
  return { x: w.x, z: w.z, heading: s.cjHeading + s.shop.facingHeading };
}

export function getRobberyClerkWorldTransform(
  s: RobberySession,
): { x: number; z: number; heading: number } {
  const w = shopLocalToWorld(s.shop.originX, s.shop.originZ, s.shop.facingHeading, s.clerkX, s.clerkZ);
  return { x: w.x, z: w.z, heading: s.clerkHeading + s.shop.facingHeading };
}

export function getRobberyBatWorldPos(s: RobberySession): { x: number; z: number } {
  return shopLocalToWorld(
    s.shop.originX,
    s.shop.originZ,
    s.shop.facingHeading,
    s.clerkBatDropX,
    s.clerkBatDropZ,
  );
}

export function skipRobberyDialogue(s: RobberySession): boolean {
  const skipped = s.dialogueDirector.skipCurrent();
  s.currentDialogue = s.dialogueDirector.getCurrentLine();
  return skipped;
}

function pickLine(lines: string[], idx: number): string {
  return lines[Math.abs(idx) % lines.length];
}

function pushDialogue(
  s: RobberySession,
  events: RobberyEvent[],
  role: 'cj' | 'clerk',
  text: string,
  opts: { priority?: DialoguePriority; beatTag?: string; pauseAfterSec?: number } = {},
): void {
  s.dialogueCounter++;
  const id = s.dialogueDirector.enqueue({
    speaker: role === 'cj' ? 'CJ' : s.profile.ownerName,
    role,
    text,
    pitch: role === 'cj' ? 0.86 : s.profile.voicePitch,
    rate: role === 'cj' ? 0.99 : s.profile.voiceRate,
    priority: opts.priority ?? 'normal',
    beatTag: opts.beatTag,
    pauseAfterSec: opts.pauseAfterSec,
  });

  const active = s.dialogueDirector.getCurrentLine();
  s.currentDialogue = active;
  s.dialogueTimer = active ? Math.max(2.6, s.dialogueTimer) : 0;

  if (id > 0 && active && active.id === id) {
    events.push({ type: 'dialogue', dialogue: active });
  }
}

function setFeedback(
  s: RobberySession,
  text: string,
  tone: 'good' | 'warn' | 'bad',
  duration = 1.4,
): void {
  s.feedbackText = text;
  s.feedbackTone = tone;
  s.feedbackTimer = duration;
}

function resolveShopCircle(
  bounds: RobberySpatialBounds,
  x: number,
  z: number,
  radius: number,
): { x: number; z: number } {
  let nx = Math.max(bounds.minX + radius, Math.min(bounds.maxX - radius, x));
  let nz = Math.max(bounds.minZ + radius, Math.min(bounds.maxZ - radius, z));

  const closestX = Math.max(bounds.counterMinX, Math.min(bounds.counterMaxX, nx));
  const closestZ = Math.max(bounds.counterMinZ, Math.min(bounds.counterMaxZ, nz));
  const dx = nx - closestX;
  const dz = nz - closestZ;
  const distSq = dx * dx + dz * dz;
  if (distSq < radius * radius) {
    if (distSq > 1e-6) {
      const dist = Math.sqrt(distSq);
      const push = radius - dist;
      nx += (dx / dist) * push;
      nz += (dz / dist) * push;
    } else {
      const penLeft = Math.abs(nx - bounds.counterMinX);
      const penRight = Math.abs(bounds.counterMaxX - nx);
      const penBack = Math.abs(nz - bounds.counterMinZ);
      const penFront = Math.abs(bounds.counterMaxZ - nz);
      const minPen = Math.min(penLeft, penRight, penBack, penFront);
      if (minPen === penFront) nz = bounds.counterMaxZ + radius;
      else if (minPen === penBack) nz = bounds.counterMinZ - radius;
      else if (minPen === penLeft) nx = bounds.counterMinX - radius;
      else nx = bounds.counterMaxX + radius;
    }
  }
  return { x: nx, z: nz };
}

export function createRobberySession(
  shop: ShopSpec,
  options: {
    forcedOutcomeRoll?: number;
    rng?: () => number;
    startWorldX?: number;
    startWorldZ?: number;
    startHeading?: number;
    dialogueDirector?: DialogueDirector;
  } = {},
): { session: RobberySession; events: RobberyEvent[] } {
  const profile = getShopOwnerProfile(shop.id);
  const bounds = computeRobberySpatialBounds(shop);
  const rng = options.rng ?? Math.random;
  const totalStacks = 5;
  const basePayout = Math.round(shop.robMin + (shop.robMax - shop.robMin) * (0.45 + rng() * 0.45));
  const perStack = Math.max(40, Math.round(basePayout / totalStacks));

  const stacks: CashStackAnimState[] = [];
  for (let i = 0; i < totalStacks; i++) {
    stacks.push({
      index: i,
      state: 'drawer',
      progress: 0,
      value: perStack,
    });
  }

  let startCjX = 0;
  let startCjZ = bounds.standoffZ + 0.65;
  let startCjHeading = Math.PI;
  if (options.startWorldX !== undefined && options.startWorldZ !== undefined) {
    const localStart = worldToShopSpace(shop, options.startWorldX, options.startWorldZ);
    const resolved = resolveShopCircle(bounds, localStart.lx, localStart.lz, 0.42);
    startCjX = resolved.x;
    startCjZ = Math.max(bounds.counterMaxZ + 0.48, resolved.z);
    if (options.startHeading !== undefined) {
      startCjHeading = options.startHeading - shop.facingHeading;
    }
  }

  const director = options.dialogueDirector ?? new DialogueDirector();
  director.clear(false);

  const session: RobberySession = {
    shop,
    profile,
    bounds,
    phase: 'entering',
    outcome: 'pending',
    phaseTime: 0,
    totalTime: 0,
    intimidation: 18,
    rage: Math.round(profile.baseBravery * 24),
    threatenCooldown: 0,
    rushCooldown: 0,
    clerkReactQueued: false,
    bagCash: 0,
    totalStacks,
    stacksCollected: 0,
    activeStackIndex: 0,
    stacks,
    drawerOpenRatio: 0,
    bagOpenRatio: 0,
    bagOnCounter: false,
    registerLooted: false,
    lootingTimer: 0,
    qteWindow: 1.85,
    qteElapsed: 0,
    qteResolved: false,
    qteSweetMin: 0.4,
    qteSweetMax: 0.82,

    startCjX,
    startCjZ,
    startCjHeading,
    cjX: startCjX,
    cjZ: startCjZ,
    cjHeading: startCjHeading,
    cjWalkCycle: 0,
    cjGesture: 'walk',
    cjGestureTimer: 0,
    cjDodgeTimer: 0,
    cjDodgeCooldown: 0,
    cjDodgeDirX: 0,
    cjDodgeDirZ: 0,
    cjPunchCooldown: 0,
    cjPunchCombo: 0,
    cjHitFlash: 0,

    clerkX: 0.12,
    clerkZ: bounds.clerkHomeZ,
    clerkHeading: 0,
    clerkWalkCycle: 0,
    clerkHealth: 100,
    clerkHasBat: false,
    clerkBatDropped: false,
    clerkBatDropX: 0,
    clerkBatDropZ: 0,
    clerkAction: 'behind_counter',
    clerkActionTimer: 0,
    clerkSwingHitApplied: false,
    clerkHitFlash: 0,
    clerkKoFallProgress: 0,

    dialogueDirector: director,
    dialogueCounter: 0,
    currentDialogue: null,
    dialogueTimer: 0,
    feedbackText: null,
    feedbackTone: 'good',
    feedbackTimer: 0,

    completed: false,
    forcedOutcomeRoll: options.forcedOutcomeRoll,
  };

  const events: RobberyEvent[] = [{ type: 'sfx', sfx: 'door_chime' }];
  pushDialogue(
    session,
    events,
    'cj',
    pickLine(profile.dialogues.cjEntry, Math.floor(rng() * 10)),
    { beatTag: 'cj_entry' },
  );
  return { session, events };
}

function transitionToPhase(
  s: RobberySession,
  next: RobberyPhase,
  events: RobberyEvent[],
  rng: () => number,
): void {
  s.phase = next;
  s.phaseTime = 0;

  if (next === 'intimidate') {
    s.cjX = 0;
    s.cjZ = s.bounds.standoffZ;
    s.cjHeading = Math.PI;
    s.cjGesture = 'point';
    s.bagOnCounter = true;
    s.bagOpenRatio = 0.35;
    s.clerkReactQueued = false;
    pushDialogue(
      s,
      events,
      'clerk',
      pickLine(s.profile.dialogues.clerkEntry, s.dialogueCounter),
      { beatTag: 'clerk_entry' },
    );
  } else if (next === 'branch_reveal') {
    const rollFn = s.forcedOutcomeRoll !== undefined ? () => s.forcedOutcomeRoll! : rng;
    s.outcome = rollRobberyOutcome(s.profile.baseBravery, s.intimidation, s.rage, rollFn);
    if (s.outcome === 'comply') {
      setFeedback(s, '¡EL DUEÑO SE RINDE!', 'good', 1.8);
      pushDialogue(
        s,
        events,
        'clerk',
        pickLine(s.profile.dialogues.clerkComplyOpen, s.dialogueCounter),
        { beatTag: 'branch_reveal' },
      );
    } else {
      setFeedback(s, '¡CUIDADO! ¡SE REVUELVE!', 'bad', 1.8);
      pushDialogue(
        s,
        events,
        'clerk',
        pickLine(s.profile.dialogues.clerkRebelDraw, s.dialogueCounter),
        { priority: 'urgent', beatTag: 'branch_reveal' },
      );
      events.push({ type: 'camera_trauma', amount: 0.35 });
    }
  } else if (next === 'comply_open') {
    events.push({ type: 'sfx', sfx: 'register_keys' });
    s.bagOnCounter = true;
    s.bagOpenRatio = 1.0;
  } else if (next === 'comply_bag') {
    s.drawerOpenRatio = 1.0;
    s.bagOnCounter = true;
    s.bagOpenRatio = 1.0;
    s.activeStackIndex = 0;
    s.qteWindow = 2.05;
    s.qteElapsed = 0;
    s.qteResolved = false;
    s.qteSweetMin = 0.36;
    s.qteSweetMax = 0.8;
    if (s.stacks[0]) {
      s.stacks[0].state = 'counter';
      s.stacks[0].progress = 1;
    }
    pushDialogue(
      s,
      events,
      'cj',
      pickLine(s.profile.dialogues.cjComplyBag, s.dialogueCounter),
      { beatTag: 'comply_bag_start' },
    );
  } else if (next === 'rebel_draw') {
    s.clerkHasBat = true;
    s.clerkAction = 'drawing_bat';
    s.bagOnCounter = false;
    s.bagOpenRatio = 0;
    events.push({ type: 'sfx', sfx: 'bat_whoosh' });
    pushDialogue(
      s,
      events,
      'cj',
      pickLine(s.profile.dialogues.cjRebelShock, s.dialogueCounter),
      { beatTag: 'rebel_shock' },
    );
  } else if (next === 'rebel_qte_dodge') {
    s.clerkHasBat = true;
    s.clerkX = Math.min(s.bounds.maxX - 0.8, 1.35);
    s.clerkZ = s.bounds.standoffZ - 0.25;
    s.clerkHeading = Math.atan2(s.cjX - s.clerkX, s.cjZ - s.clerkZ);
    s.cjHeading = Math.atan2(s.clerkX - s.cjX, s.clerkZ - s.cjZ);
    s.clerkAction = 'windup';
    s.qteWindow = 1.75;
    s.qteElapsed = 0;
    s.qteResolved = false;
    s.qteSweetMin = 0.12;
    s.qteSweetMax = 0.92;
    events.push({ type: 'sfx', sfx: 'bat_whoosh' });
  } else if (next === 'rebel_qte_counter') {
    s.qteWindow = 1.65;
    s.qteElapsed = 0;
    s.qteResolved = false;
    s.qteSweetMin = 0.1;
    s.qteSweetMax = 0.92;
  } else if (next === 'rebel_brawl') {
    s.clerkHasBat = s.clerkHealth > 0;
    s.clerkAction = s.clerkHealth > 0 ? 'chase' : 'ko';
    s.clerkActionTimer = 0.45;
    s.cjGesture = 'idle';
    if (s.clerkZ < s.bounds.counterMaxZ + 0.15) {
      s.clerkX = Math.min(s.bounds.maxX - 0.8, 1.75);
      s.clerkZ = s.bounds.standoffZ + 0.1;
    }
    if (s.cjZ < s.bounds.standoffZ + 0.25) {
      s.cjZ = s.bounds.standoffZ + 0.5;
    }
    const escapeHint = s.bounds.isOutdoor
      ? '¡PELEA O ESCAPA POR LA CALLE!'
      : '¡PELEA EN TIENDA O HUYE POR LA PUERTA!';
    setFeedback(s, escapeHint, 'warn', 2.4);
    if (!s.dialogueDirector.isBusy()) {
      pushDialogue(
        s,
        events,
        'clerk',
        pickLine(s.profile.dialogues.clerkBrawlTaunt, s.dialogueCounter),
      );
    }
  } else if (next === 'exiting') {
    s.bagOnCounter = false;
    s.bagOpenRatio = 0;
    s.cjGesture = 'sprint_exit';
    events.push({ type: 'sfx', sfx: 'bag_zip' });
    events.push({ type: 'sfx', sfx: 'alarm' });
    const exitPool =
      s.outcome === 'comply' || s.clerkHealth <= 0
        ? s.profile.dialogues.cjExitComply
        : s.profile.dialogues.cjExitFlee;
    pushDialogue(
      s,
      events,
      'cj',
      pickLine(exitPool, s.dialogueCounter),
      { beatTag: 'exit_line', pauseAfterSec: 0.25 },
    );
  }
}

function advanceBagStack(
  s: RobberySession,
  events: RobberyEvent[],
  timingQuality: 'perfect' | 'good' | 'late',
): void {
  const stack = s.stacks[s.activeStackIndex];
  if (!stack) return;

  const mult = timingQuality === 'perfect' ? 1.25 : timingQuality === 'good' ? 1.0 : 0.65;
  const gained = Math.round(stack.value * mult);
  s.bagCash += gained;
  s.stacksCollected++;
  stack.state = 'bagging';
  stack.progress = 0;
  s.cjGesture = 'bag_sweep';
  s.cjGestureTimer = 0.42;
  s.qteResolved = true;

  events.push({ type: 'sfx', sfx: 'cash_rustle' });
  events.push({ type: 'bill_burst', amount: timingQuality === 'perfect' ? 10 : 5 });

  if (timingQuality === 'perfect') {
    events.push({ type: 'sfx', sfx: 'qte_success' });
    setFeedback(s, `¡PERFECTO! +$${gained}`, 'good', 1.1);
  } else if (timingQuality === 'good') {
    setFeedback(s, `¡EN LA BOLSA! +$${gained}`, 'good', 1.0);
  } else {
    setFeedback(s, `LENTO · +$${gained}`, 'warn', 1.0);
  }

  // Clerk pleads midway ONLY when queue is quiet so dialogue never clips
  if ((s.stacksCollected === 2 || s.stacksCollected === 4) && !s.dialogueDirector.isBusy()) {
    pushDialogue(
      s,
      events,
      'clerk',
      pickLine(s.profile.dialogues.clerkComplyBag, s.stacksCollected),
    );
  }

  const nextIdx = s.activeStackIndex + 1;
  if (nextIdx >= s.totalStacks) {
    s.activeStackIndex = s.totalStacks;
  } else {
    s.activeStackIndex = nextIdx;
    s.qteElapsed = 0;
    s.qteResolved = false;
    s.qteWindow = Math.max(1.55, 2.05 - nextIdx * 0.08);
    s.stacks[nextIdx].state = 'placing';
    s.stacks[nextIdx].progress = 0;
  }
}

export function handleRobberyAction(
  s: RobberySession,
  action: RobberyActionType,
  rng: () => number = Math.random,
): RobberyEvent[] {
  const events: RobberyEvent[] = [];
  if (s.completed) return events;

  if (s.phase === 'intimidate') {
    if (action === 'intimidate') {
      s.intimidation = Math.min(100, s.intimidation + 15);
      s.rage = Math.min(100, s.rage + 4);
      s.cjGesture = 'point';
      s.cjGestureTimer = 0.36;
      setFeedback(s, '¡PRESIÓN +15!', 'good', 0.85);
      if (s.dialogueDirector.getQueueLength() < 2) {
        pushDialogue(
          s,
          events,
          'cj',
          pickLine(s.profile.dialogues.cjIntimidate, s.dialogueCounter),
        );
      }
      events.push({ type: 'camera_trauma', amount: 0.12 });
    } else if (action === 'threaten' && s.threatenCooldown <= 0) {
      s.intimidation = Math.min(100, s.intimidation + 26);
      s.rage = Math.min(100, s.rage + 14);
      s.threatenCooldown = 1.45;
      s.cjGesture = 'slam';
      s.cjGestureTimer = 0.45;
      setFeedback(s, '¡AMENAZA FUERTE!', 'warn', 1.0);
      if (s.dialogueDirector.getQueueLength() < 2) {
        pushDialogue(s, events, 'cj', pickLine(s.profile.dialogues.cjThreaten, s.dialogueCounter));
      }
      events.push({ type: 'camera_trauma', amount: 0.25 });
    } else if (action === 'rush' && s.rushCooldown <= 0) {
      s.intimidation = Math.min(100, s.intimidation + 20);
      s.rage = Math.min(100, s.rage + 22);
      s.rushCooldown = 1.3;
      s.cjGesture = 'slam';
      s.cjGestureTimer = 0.4;
      setFeedback(s, '¡APRESURAS AL DUEÑO!', 'warn', 1.0);
      if (s.dialogueDirector.getQueueLength() < 2) {
        pushDialogue(s, events, 'cj', pickLine(s.profile.dialogues.cjRush, s.dialogueCounter));
      }
      events.push({ type: 'camera_trauma', amount: 0.22 });
    }

    if (s.intimidation >= 100) {
      transitionToPhase(s, 'branch_reveal', events, rng);
    }
    return events;
  }

  if (s.phase === 'comply_bag' && action === 'grab_cash') {
    if (s.activeStackIndex < s.totalStacks && !s.qteResolved) {
      const progress = s.qteElapsed / Math.max(0.01, s.qteWindow);
      const quality =
        progress >= s.qteSweetMin && progress <= s.qteSweetMax ? 'perfect' : 'good';
      advanceBagStack(s, events, quality);
    }
    return events;
  }

  if (s.phase === 'rebel_qte_dodge' && action === 'dodge') {
    if (!s.qteResolved) {
      s.qteResolved = true;
      s.cjGesture = 'duck_dodge';
      s.cjGestureTimer = 0.55;
      s.clerkAction = 'swing';
      events.push({ type: 'sfx', sfx: 'dodge_whoosh' });
      events.push({ type: 'sfx', sfx: 'qte_success' });
      events.push({ type: 'hitstop', amount: 0.05 });
      setFeedback(s, '¡ESQUIVE PERFECTO!', 'good', 1.2);
      transitionToPhase(s, 'rebel_qte_counter', events, rng);
    }
    return events;
  }

  if (s.phase === 'rebel_qte_counter' && (action === 'counter' || action === 'punch')) {
    if (!s.qteResolved) {
      s.qteResolved = true;
      s.cjGesture = 'counter_hook';
      s.cjGestureTimer = 0.48;
      s.clerkHealth = Math.max(0, s.clerkHealth - 28);
      s.clerkHitFlash = 0.28;
      s.clerkAction = 'stagger';
      const bonusCash = 95;
      s.bagCash += bonusCash;
      events.push({ type: 'sfx', sfx: 'punch_impact' });
      events.push({ type: 'sfx', sfx: 'qte_success' });
      events.push({ type: 'hitstop', amount: 0.055 });
      events.push({ type: 'camera_trauma', amount: 0.36 });
      events.push({ type: 'bill_burst', amount: 6 });
      setFeedback(s, `¡CONTRAATAQUE! +$${bonusCash}`, 'good', 1.3);
      pushDialogue(
        s,
        events,
        'cj',
        pickLine(s.profile.dialogues.cjBrawlHit, s.dialogueCounter),
        { priority: 'urgent' },
      );
      transitionToPhase(s, 'rebel_brawl', events, rng);
    }
    return events;
  }

  if (s.phase === 'rebel_brawl') {
    if (action === 'punch' && s.cjPunchCooldown <= 0 && s.cjDodgeTimer <= 0) {
      s.cjPunchCooldown = 0.42;
      s.cjPunchCombo = (s.cjPunchCombo + 1) % 2;
      s.cjGesture = s.cjPunchCombo === 0 ? 'punch_r' : 'punch_l';
      s.cjGestureTimer = 0.3;

      const dx = s.clerkX - s.cjX;
      const dz = s.clerkZ - s.cjZ;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.05) {
        s.cjHeading = Math.atan2(dx, dz);
      }

      if (s.clerkHealth > 0 && dist <= 2.15) {
        const dmg = s.clerkAction === 'windup' ? 30 : 24;
        s.clerkHealth = Math.max(0, s.clerkHealth - dmg);
        s.clerkHitFlash = 0.22;
        events.push({ type: 'sfx', sfx: 'punch_impact' });
        events.push({ type: 'hitstop', amount: 0.04 });
        events.push({ type: 'camera_trauma', amount: 0.28 });

        const inv = 1 / Math.max(0.1, dist);
        const pushed = resolveShopCircle(
          s.bounds,
          s.clerkX + dx * inv * 0.48,
          s.clerkZ + dz * inv * 0.48,
          0.42,
        );
        s.clerkX = pushed.x;
        s.clerkZ = pushed.z;

        if (s.clerkHealth <= 0) {
          s.clerkAction = 'ko';
          s.clerkActionTimer = 0;
          s.clerkHasBat = false;
          s.clerkBatDropped = true;
          s.clerkBatDropX = s.clerkX + 0.4;
          s.clerkBatDropZ = s.clerkZ + 0.25;
          setFeedback(s, '¡DUEÑO NOQUEADO! SAQUEA LA CAJA [F]', 'good', 2.6);
          pushDialogue(s, events, 'clerk', pickLine(s.profile.dialogues.clerkKo, 0), {
            priority: 'urgent',
          });
        } else {
          s.clerkAction = 'stagger';
          s.clerkActionTimer = 0.46;
          setFeedback(s, `¡GOLPE! DUEÑO ${s.clerkHealth}% HP`, 'good', 0.9);
          if (!s.dialogueDirector.isBusy()) {
            pushDialogue(
              s,
              events,
              'cj',
              pickLine(s.profile.dialogues.cjBrawlHit, s.dialogueCounter),
            );
          }
        }
      } else {
        events.push({ type: 'sfx', sfx: 'dodge_whoosh' });
      }
      return events;
    }

    if (action === 'dodge' && s.cjDodgeCooldown <= 0) {
      s.cjDodgeTimer = 0.36;
      s.cjDodgeCooldown = 0.78;
      s.cjGesture = 'duck_dodge';
      s.cjGestureTimer = 0.38;
      const dx = s.cjX - s.clerkX;
      const dz = s.cjZ - s.clerkZ;
      const dist = Math.max(0.1, Math.hypot(dx, dz));
      s.cjDodgeDirX = (-dz / dist) * 0.75 + (dx / dist) * 0.65;
      s.cjDodgeDirZ = (dx / dist) * 0.75 + (dz / dist) * 0.65;
      events.push({ type: 'sfx', sfx: 'dodge_whoosh' });
      setFeedback(s, '¡ESQUIVE!', 'good', 0.7);
      return events;
    }

    if (action === 'loot_register') {
      const nearCounter =
        Math.abs(s.cjX) <= s.bounds.counterMaxX + 0.55 &&
        s.cjZ <= s.bounds.counterMaxZ + 1.85;
      if (s.clerkHealth <= 0 && !s.registerLooted && nearCounter) {
        s.registerLooted = true;
        s.drawerOpenRatio = 1.0;
        const loot = Math.round(
          s.shop.robMin + (s.shop.robMax - s.shop.robMin) * (0.65 + rng() * 0.35),
        );
        s.bagCash += loot;
        s.stacksCollected = s.totalStacks;
        for (const st of s.stacks) {
          st.state = 'bagged';
          st.progress = 1;
        }
        s.cjGesture = 'bag_sweep';
        s.cjGestureTimer = 0.55;
        events.push({ type: 'sfx', sfx: 'drawer_pop' });
        events.push({ type: 'sfx', sfx: 'cash_rustle' });
        events.push({ type: 'bill_burst', amount: 14 });
        setFeedback(s, `¡CAJA SAQUEADA! +$${loot} · ¡HUYE [F]!`, 'good', 2.4);
        pushDialogue(
          s,
          events,
          'cj',
          pickLine(s.profile.dialogues.cjLootRegister, 0),
          { priority: 'urgent' },
        );
      }
      return events;
    }

    if (action === 'exit_door') {
      transitionToPhase(s, 'exiting', events, rng);
      return events;
    }
  }

  return events;
}

export function stepRobberySession(
  s: RobberySession,
  dt: number,
  move: RobberyMoveInput,
  rng: () => number = Math.random,
): RobberyEvent[] {
  const events: RobberyEvent[] = [];
  if (s.completed) return events;

  s.phaseTime += dt;
  s.totalTime += dt;
  s.dialogueDirector.update(dt);
  s.currentDialogue = s.dialogueDirector.getCurrentLine();
  s.dialogueTimer = s.currentDialogue ? 1.5 : 0;

  if (s.feedbackTimer > 0) {
    s.feedbackTimer = Math.max(0, s.feedbackTimer - dt);
    if (s.feedbackTimer <= 0) s.feedbackText = null;
  }
  if (s.threatenCooldown > 0) s.threatenCooldown = Math.max(0, s.threatenCooldown - dt);
  if (s.rushCooldown > 0) s.rushCooldown = Math.max(0, s.rushCooldown - dt);
  if (s.cjGestureTimer > 0) s.cjGestureTimer = Math.max(0, s.cjGestureTimer - dt);
  if (s.cjPunchCooldown > 0) s.cjPunchCooldown = Math.max(0, s.cjPunchCooldown - dt);
  if (s.cjDodgeCooldown > 0) s.cjDodgeCooldown = Math.max(0, s.cjDodgeCooldown - dt);
  if (s.cjHitFlash > 0) s.cjHitFlash = Math.max(0, s.cjHitFlash - dt);
  if (s.clerkHitFlash > 0) s.clerkHitFlash = Math.max(0, s.clerkHitFlash - dt);

  for (const st of s.stacks) {
    if (st.state === 'bagging') {
      st.progress = Math.min(1, st.progress + dt * 2.8);
      if (st.progress >= 1) st.state = 'bagged';
    }
  }

  switch (s.phase) {
    case 'entering': {
      const dur = 0.65;
      const t = Math.min(1, s.phaseTime / dur);
      const ease = 1 - (1 - t) * (1 - t);
      s.cjX = s.startCjX * (1 - ease);
      s.cjZ = s.startCjZ + (s.bounds.standoffZ - s.startCjZ) * ease;
      s.cjHeading = Math.PI;
      s.cjWalkCycle += dt * 7.8;
      if (s.phaseTime >= dur) {
        transitionToPhase(s, 'intimidate', events, rng);
      }
      break;
    }

    case 'intimidate': {
      s.intimidation = Math.max(5, s.intimidation - dt * 2.0);
      if (!s.clerkReactQueued && s.phaseTime >= 1.5 && !s.dialogueDirector.isBusy()) {
        s.clerkReactQueued = true;
        const scared =
          computeCooperationProbability(s.profile.baseBravery, s.intimidation, s.rage) >= 0.5;
        pushDialogue(
          s,
          events,
          'clerk',
          pickLine(
            scared ? s.profile.dialogues.clerkScared : s.profile.dialogues.clerkDefiant,
            s.dialogueCounter,
          ),
          { beatTag: 'clerk_react' },
        );
      }
      if (
        (s.phaseTime >= 7.2 && !s.dialogueDirector.isBusy()) ||
        s.phaseTime >= 11.5
      ) {
        transitionToPhase(s, 'branch_reveal', events, rng);
      }
      break;
    }

    case 'branch_reveal': {
      const revealDone =
        s.dialogueDirector.hasCompletedBeat('branch_reveal') ||
        (!s.dialogueDirector.isBeatPlayingOrQueued('branch_reveal') &&
          !s.dialogueDirector.isBusy());
      if (s.phaseTime >= 0.9 && (revealDone || s.phaseTime >= 6.2)) {
        if (s.outcome === 'comply') {
          transitionToPhase(s, 'comply_open', events, rng);
        } else {
          transitionToPhase(s, 'rebel_draw', events, rng);
        }
      }
      break;
    }

    case 'comply_open': {
      const prevDrawer = s.drawerOpenRatio;
      if (s.phaseTime >= 0.45) {
        s.drawerOpenRatio = Math.min(1, (s.phaseTime - 0.45) / 0.4);
        if (prevDrawer === 0 && s.drawerOpenRatio > 0) {
          events.push({ type: 'sfx', sfx: 'drawer_pop' });
        }
      }
      if (s.phaseTime >= 0.85 && s.stacks[0]) {
        s.stacks[0].state = 'placing';
        s.stacks[0].progress = Math.min(1, (s.phaseTime - 0.85) / 0.42);
      }
      if (s.phaseTime >= 1.3) {
        transitionToPhase(s, 'comply_bag', events, rng);
      }
      break;
    }

    case 'comply_bag': {
      if (s.activeStackIndex >= s.totalStacks) {
        const lastStack = s.stacks[s.totalStacks - 1];
        if (!lastStack || lastStack.state === 'bagged') {
          transitionToPhase(s, 'exiting', events, rng);
        }
        break;
      }

      const activeStack = s.stacks[s.activeStackIndex];
      s.qteElapsed += dt;
      if (activeStack.state === 'placing') {
        activeStack.progress = Math.min(1, s.qteElapsed / 0.45);
        if (activeStack.progress >= 1) {
          activeStack.state = 'counter';
        }
      }

      if (s.qteElapsed >= s.qteWindow && !s.qteResolved) {
        advanceBagStack(s, events, 'late');
      }
      break;
    }

    case 'rebel_draw': {
      // Clerk steps smoothly around east end of counter or street cart
      const t = Math.min(1, s.phaseTime / 1.15);
      const sideX = s.bounds.counterMaxX + 0.48;
      const startX = 0.12;
      const startZ = s.bounds.clerkHomeZ;
      const endX = Math.min(s.bounds.maxX - 0.8, 1.35);
      const endZ = s.bounds.standoffZ - 0.25;
      if (t < 0.45) {
        const u = t / 0.45;
        s.clerkX = startX + (sideX - startX) * u;
        s.clerkZ = startZ + (s.shop.counterLocalZ - startZ) * u;
        s.clerkHeading = Math.PI * 0.42;
      } else {
        const u = (t - 0.45) / 0.55;
        s.clerkX = sideX + (endX - sideX) * u;
        s.clerkZ = s.shop.counterLocalZ + (endZ - s.shop.counterLocalZ) * u;
        s.clerkHeading = Math.atan2(s.cjX - s.clerkX, s.cjZ - s.clerkZ);
      }
      s.clerkWalkCycle += dt * 9.5;
      s.cjHeading = Math.atan2(s.clerkX - s.cjX, s.clerkZ - s.cjZ);

      if (s.phaseTime >= 1.15) {
        transitionToPhase(s, 'rebel_qte_dodge', events, rng);
      }
      break;
    }

    case 'rebel_qte_dodge': {
      s.qteElapsed += dt;
      if (s.qteElapsed >= s.qteWindow && !s.qteResolved) {
        s.qteResolved = true;
        s.clerkAction = 'swing';
        s.cjGesture = 'hurt';
        s.cjGestureTimer = 0.45;
        s.cjHitFlash = 0.3;
        events.push({ type: 'sfx', sfx: 'bat_crack' });
        events.push({ type: 'sfx', sfx: 'qte_fail' });
        events.push({ type: 'damage_player', amount: 18 });
        events.push({ type: 'camera_trauma', amount: 0.58 });
        events.push({ type: 'hitstop', amount: 0.055 });
        setFeedback(s, '¡BATAZO ENCAJADO! -18 HP', 'bad', 1.3);
        transitionToPhase(s, 'rebel_qte_counter', events, rng);
      }
      break;
    }

    case 'rebel_qte_counter': {
      s.qteElapsed += dt;
      if (s.qteElapsed >= s.qteWindow && !s.qteResolved) {
        s.qteResolved = true;
        s.cjGesture = 'hurt';
        s.cjGestureTimer = 0.4;
        s.cjHitFlash = 0.25;
        events.push({ type: 'sfx', sfx: 'bat_crack' });
        events.push({ type: 'sfx', sfx: 'qte_fail' });
        events.push({ type: 'damage_player', amount: 12 });
        events.push({ type: 'camera_trauma', amount: 0.42 });
        setFeedback(s, '¡TE GOLPEA AL REPONERSE!', 'bad', 1.2);
        transitionToPhase(s, 'rebel_brawl', events, rng);
      }
      break;
    }

    case 'rebel_brawl': {
      if (s.cjDodgeTimer > 0) {
        s.cjDodgeTimer = Math.max(0, s.cjDodgeTimer - dt);
        const nextPos = resolveShopCircle(
          s.bounds,
          s.cjX + s.cjDodgeDirX * 5.6 * dt,
          s.cjZ + s.cjDodgeDirZ * 5.6 * dt,
          0.42,
        );
        s.cjX = nextPos.x;
        s.cjZ = nextPos.z;
      } else {
        const mag = Math.hypot(move.moveX, move.moveZ);
        if (mag > 0.08) {
          const speed = move.sprint ? 4.6 : 3.4;
          const nx = move.moveX / Math.max(1, mag);
          const nz = move.moveZ / Math.max(1, mag);
          const resolved = resolveShopCircle(
            s.bounds,
            s.cjX + nx * speed * dt,
            s.cjZ + nz * speed * dt,
            0.42,
          );
          s.cjX = resolved.x;
          s.cjZ = resolved.z;
          s.cjHeading = Math.atan2(nx, nz);
          s.cjWalkCycle += dt * (move.sprint ? 11.5 : 8.2);
          if (s.cjGestureTimer <= 0) {
            s.cjGesture = 'walk';
          }
        } else if (s.cjGestureTimer <= 0) {
          s.cjGesture = 'idle';
        }
      }

      // Auto-escape: doorway for indoor shops, wide street flee radius for outdoor cart/bay
      const escapedIndoor =
        !s.bounds.isOutdoor &&
        s.cjZ >= s.bounds.exitTriggerZ &&
        s.cjX >= s.bounds.exitMinX &&
        s.cjX <= s.bounds.exitMaxX;
      const escapedOutdoor =
        s.bounds.isOutdoor &&
        Math.hypot(s.cjX, s.cjZ - s.bounds.standoffZ) >= s.bounds.exitRadius;

      if (escapedIndoor || escapedOutdoor) {
        transitionToPhase(s, 'exiting', events, rng);
        break;
      }

      if (s.clerkHealth <= 0 || s.clerkAction === 'ko') {
        s.clerkAction = 'ko';
        s.clerkKoFallProgress = Math.min(1, s.clerkKoFallProgress + dt * 2.6);
        break;
      }

      const toCjX = s.cjX - s.clerkX;
      const toCjZ = s.cjZ - s.clerkZ;
      const dist = Math.hypot(toCjX, toCjZ);

      if (s.clerkAction === 'stagger') {
        s.clerkActionTimer -= dt;
        if (s.clerkActionTimer <= 0) {
          s.clerkAction = 'chase';
        }
      } else if (s.clerkAction === 'windup') {
        s.clerkHeading = Math.atan2(toCjX, toCjZ);
        s.clerkActionTimer -= dt;
        if (s.clerkActionTimer <= 0) {
          s.clerkAction = 'swing';
          s.clerkActionTimer = 0.24;
          s.clerkSwingHitApplied = false;
          events.push({ type: 'sfx', sfx: 'bat_whoosh' });
        }
      } else if (s.clerkAction === 'swing') {
        s.clerkActionTimer -= dt;
        if (!s.clerkSwingHitApplied && s.clerkActionTimer <= 0.14) {
          s.clerkSwingHitApplied = true;
          if (dist <= 2.15 && s.cjDodgeTimer <= 0) {
            s.cjGesture = 'hurt';
            s.cjGestureTimer = 0.35;
            s.cjHitFlash = 0.26;
            events.push({ type: 'sfx', sfx: 'bat_crack' });
            events.push({ type: 'damage_player', amount: 16 });
            events.push({ type: 'camera_trauma', amount: 0.48 });
            events.push({ type: 'hitstop', amount: 0.045 });
            setFeedback(s, '¡BATAZO! -16 HP · USA [ESPACIO] PARA ESQUIVAR', 'bad', 1.35);
          } else if (dist <= 2.35 && s.cjDodgeTimer > 0) {
            events.push({ type: 'sfx', sfx: 'qte_success' });
            setFeedback(s, '¡ESQUIVADO! ¡CONTRAATACA [E]!', 'good', 1.0);
          }
        }
        if (s.clerkActionTimer <= 0) {
          s.clerkAction = 'recover';
          s.clerkActionTimer = 0.62;
        }
      } else if (s.clerkAction === 'recover') {
        s.clerkActionTimer -= dt;
        if (s.clerkActionTimer <= 0) {
          s.clerkAction = 'chase';
        }
      } else {
        let targetX = s.cjX;
        let targetZ = s.cjZ;
        const clerkBehind = s.clerkZ < s.bounds.counterMinZ;
        const cjFront = s.cjZ > s.bounds.counterMaxZ;
        const clerkFront = s.clerkZ > s.bounds.counterMaxZ;
        const cjBehind = s.cjZ < s.bounds.counterMinZ;
        if ((clerkBehind && cjFront) || (clerkFront && cjBehind)) {
          targetX = s.clerkX >= 0 ? s.bounds.counterMaxX + 0.55 : s.bounds.counterMinX - 0.55;
          targetZ = s.shop.counterLocalZ;
        }

        if (dist <= 1.72) {
          s.clerkAction = 'windup';
          s.clerkActionTimer = 0.56;
          s.clerkHeading = Math.atan2(toCjX, toCjZ);
          if (!s.dialogueDirector.isBusy()) {
            pushDialogue(
              s,
              events,
              'clerk',
              pickLine(s.profile.dialogues.clerkBrawlTaunt, s.dialogueCounter),
            );
          }
        } else {
          const sx = targetX - s.clerkX;
          const sz = targetZ - s.clerkZ;
          const sDist = Math.max(0.05, Math.hypot(sx, sz));
          const chaseSpeed = 2.65;
          const nextClerk = resolveShopCircle(
            s.bounds,
            s.clerkX + (sx / sDist) * chaseSpeed * dt,
            s.clerkZ + (sz / sDist) * chaseSpeed * dt,
            0.42,
          );
          s.clerkX = nextClerk.x;
          s.clerkZ = nextClerk.z;
          s.clerkHeading = Math.atan2(sx, sz);
          s.clerkWalkCycle += dt * 8.6;
        }
      }
      break;
    }

    case 'exiting': {
      const targetExitZ = s.bounds.isOutdoor ? s.bounds.standoffZ + 2.8 : s.bounds.exitTriggerZ + 0.7;
      const dx = 0 - s.cjX;
      const dz = targetExitZ - s.cjZ;
      const d = Math.hypot(dx, dz);
      if (d > 0.1) {
        const step = Math.min(d, 4.4 * dt);
        s.cjX += (dx / d) * step;
        s.cjZ += (dz / d) * step;
        s.cjHeading = Math.atan2(dx, dz);
        s.cjWalkCycle += dt * 11.2;
      }

      const exitDone =
        s.dialogueDirector.hasCompletedBeat('exit_line') ||
        !s.dialogueDirector.isBusy();
      if (s.phaseTime >= 1.1 && (exitDone || s.phaseTime >= 4.4)) {
        s.completed = true;
        events.push({
          type: 'completed',
          payout: s.bagCash,
          wantedStars: s.shop.robWantedStars + (s.clerkHealth <= 0 ? 1 : 0),
          outcome: s.outcome,
          clerkKo: s.clerkHealth <= 0,
        });
      }
      break;
    }
  }

  return events;
}

export function buildRobberyHudState(s: RobberySession): RobberyHUDState {
  let qte: RobberyQTEPrompt | null = null;
  if (s.phase === 'comply_bag' && s.activeStackIndex < s.totalStacks) {
    qte = {
      id: `bag_${s.activeStackIndex}`,
      action: 'grab_cash',
      label: `GUARDAR FAJO ${s.activeStackIndex + 1}/${s.totalStacks}`,
      keyHint: 'ESPACIO / E',
      progress: Math.min(1, s.qteElapsed / Math.max(0.01, s.qteWindow)),
      sweetMin: s.qteSweetMin,
      sweetMax: s.qteSweetMax,
    };
  } else if (s.phase === 'rebel_qte_dodge') {
    qte = {
      id: 'rebel_dodge',
      action: 'dodge',
      label: '¡ESQUIVA EL BATE!',
      keyHint: 'A / D / ESPACIO',
      progress: Math.min(1, s.qteElapsed / Math.max(0.01, s.qteWindow)),
      sweetMin: s.qteSweetMin,
      sweetMax: s.qteSweetMax,
      urgent: true,
    };
  } else if (s.phase === 'rebel_qte_counter') {
    qte = {
      id: 'rebel_counter',
      action: 'counter',
      label: '¡CONTRAATACA!',
      keyHint: 'E / ESPACIO',
      progress: Math.min(1, s.qteElapsed / Math.max(0.01, s.qteWindow)),
      sweetMin: s.qteSweetMin,
      sweetMax: s.qteSweetMax,
      urgent: true,
    };
  }

  const nearCounter =
    Math.abs(s.cjX) <= s.bounds.counterMaxX + 0.55 &&
    s.cjZ <= s.bounds.counterMaxZ + 1.85;
  const canLootRegister =
    s.phase === 'rebel_brawl' && s.clerkHealth <= 0 && !s.registerLooted && nearCounter;
  const canExitDoor = s.phase === 'rebel_brawl';

  const coopPct = Math.round(
    computeCooperationProbability(s.profile.baseBravery, s.intimidation, s.rage) * 100,
  );

  return {
    shopId: s.shop.id,
    shopName: s.shop.name,
    venueMode: s.shop.venueMode,
    ownerName: s.profile.ownerName,
    phase: s.phase,
    outcome: s.outcome,
    intimidation: Math.round(s.intimidation),
    rage: Math.round(s.rage),
    bagCash: Math.round(s.bagCash),
    stacksCollected: s.stacksCollected,
    totalStacks: s.totalStacks,
    clerkHealth: Math.round(s.clerkHealth),
    clerkKo: s.clerkHealth <= 0,
    registerLooted: s.registerLooted,
    canLootRegister,
    canExitDoor,
    dodgeCooldownRatio: Math.min(1, s.cjDodgeCooldown / 0.78),
    qte,
    dialogue: s.dialogueDirector.getCurrentLine(),
    feedbackText: s.feedbackTimer > 0 ? s.feedbackText : null,
    feedbackTone: s.feedbackTone,
    cooperationChancePct: coopPct,
  };
}
