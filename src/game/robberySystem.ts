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
  // Higher baseBravery lowers cooperation; high intimidation boosts it; excessive rage provokes rebellion
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
  moveX: number; // -1..1 (right positive)
  moveZ: number; // -1..1 (forward toward -Z is negative, toward exit +Z is positive)
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

export interface RobberySession {
  shop: ShopSpec;
  profile: ShopOwnerProfile;
  phase: RobberyPhase;
  outcome: RobberyOutcome;
  phaseTime: number;
  totalTime: number;

  // Intimidation & emotional meters
  intimidation: number; // 0..100
  rage: number; // 0..100
  threatenCooldown: number;
  rushCooldown: number;

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

  // Real-time 3D positions inside interior room
  // Room: x in [-4.2, 4.2], z in [-3.15, 3.95]
  // Counter AABB: x in [-2.55, 2.55], z in [-1.75, -0.75]
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

  // Dialogue & UI feedback
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

// Local room geometry constants shared with robberyScene.ts
export const INTERIOR_BOUNDS = {
  minX: -4.15,
  maxX: 4.15,
  minZ: -3.15,
  maxZ: 3.95,
  counterMinX: -2.6,
  counterMaxX: 2.6,
  counterMinZ: -1.78,
  counterMaxZ: -0.72,
  exitMinX: -1.45,
  exitMaxX: 1.45,
  exitTriggerZ: 3.35,
};

function pickLine(lines: string[], idx: number): string {
  return lines[Math.abs(idx) % lines.length];
}

function pushDialogue(
  s: RobberySession,
  events: RobberyEvent[],
  role: 'cj' | 'clerk',
  text: string,
): void {
  s.dialogueCounter++;
  const line: RobberyDialogueLine = {
    id: s.dialogueCounter,
    speaker: role === 'cj' ? 'CJ' : s.profile.ownerName,
    role,
    text,
    pitch: role === 'cj' ? 0.86 : s.profile.voicePitch,
    rate: role === 'cj' ? 1.03 : s.profile.voiceRate,
  };
  s.currentDialogue = line;
  s.dialogueTimer = Math.max(2.6, Math.min(5.2, text.length * 0.055 + 1.4));
  events.push({ type: 'dialogue', dialogue: line });
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

function resolveInteriorCircle(
  x: number,
  z: number,
  radius: number,
): { x: number; z: number } {
  let nx = Math.max(
    INTERIOR_BOUNDS.minX + radius,
    Math.min(INTERIOR_BOUNDS.maxX - radius, x),
  );
  let nz = Math.max(
    INTERIOR_BOUNDS.minZ + radius,
    Math.min(INTERIOR_BOUNDS.maxZ - radius, z),
  );

  // Resolve against counter AABB
  const closestX = Math.max(
    INTERIOR_BOUNDS.counterMinX,
    Math.min(INTERIOR_BOUNDS.counterMaxX, nx),
  );
  const closestZ = Math.max(
    INTERIOR_BOUNDS.counterMinZ,
    Math.min(INTERIOR_BOUNDS.counterMaxZ, nz),
  );
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
      // Inside AABB: push out along nearest edge
      const penLeft = Math.abs(nx - INTERIOR_BOUNDS.counterMinX);
      const penRight = Math.abs(INTERIOR_BOUNDS.counterMaxX - nx);
      const penBack = Math.abs(nz - INTERIOR_BOUNDS.counterMinZ);
      const penFront = Math.abs(INTERIOR_BOUNDS.counterMaxZ - nz);
      const minPen = Math.min(penLeft, penRight, penBack, penFront);
      if (minPen === penFront) nz = INTERIOR_BOUNDS.counterMaxZ + radius;
      else if (minPen === penBack) nz = INTERIOR_BOUNDS.counterMinZ - radius;
      else if (minPen === penLeft) nx = INTERIOR_BOUNDS.counterMinX - radius;
      else nx = INTERIOR_BOUNDS.counterMaxX + radius;
    }
  }
  return { x: nx, z: nz };
}

export function createRobberySession(
  shop: ShopSpec,
  options: { forcedOutcomeRoll?: number; rng?: () => number } = {},
): { session: RobberySession; events: RobberyEvent[] } {
  const profile = getShopOwnerProfile(shop.id);
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

  const session: RobberySession = {
    shop,
    profile,
    phase: 'entering',
    outcome: 'pending',
    phaseTime: 0,
    totalTime: 0,
    intimidation: 18,
    rage: Math.round(profile.baseBravery * 24),
    threatenCooldown: 0,
    rushCooldown: 0,
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
    qteWindow: 1.8,
    qteElapsed: 0,
    qteResolved: false,
    qteSweetMin: 0.4,
    qteSweetMax: 0.82,

    cjX: 0,
    cjZ: 3.45,
    cjHeading: Math.PI,
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

    clerkX: 0.2,
    clerkZ: -2.25,
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
  pushDialogue(session, events, 'cj', pickLine(profile.dialogues.cjEntry, Math.floor(rng() * 10)));
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
    s.cjZ = 0.08;
    s.cjHeading = Math.PI;
    s.cjGesture = 'point';
    s.bagOnCounter = true;
    s.bagOpenRatio = 0.35;
    pushDialogue(s, events, 'clerk', pickLine(s.profile.dialogues.clerkEntry, s.dialogueCounter));
  } else if (next === 'branch_reveal') {
    const rollFn =
      s.forcedOutcomeRoll !== undefined
        ? () => s.forcedOutcomeRoll!
        : rng;
    s.outcome = rollRobberyOutcome(
      s.profile.baseBravery,
      s.intimidation,
      s.rage,
      rollFn,
    );
    if (s.outcome === 'comply') {
      setFeedback(s, '¡EL DUEÑO SE RINDE!', 'good', 1.6);
      pushDialogue(
        s,
        events,
        'clerk',
        pickLine(s.profile.dialogues.clerkComplyOpen, s.dialogueCounter),
      );
    } else {
      setFeedback(s, '¡CUIDADO! ¡SE REVUELVE!', 'bad', 1.6);
      pushDialogue(
        s,
        events,
        'clerk',
        pickLine(s.profile.dialogues.clerkRebelDraw, s.dialogueCounter),
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
    pushDialogue(s, events, 'cj', pickLine(s.profile.dialogues.cjComplyBag, s.dialogueCounter));
  } else if (next === 'rebel_draw') {
    s.clerkHasBat = true;
    s.clerkAction = 'drawing_bat';
    s.bagOnCounter = false;
    s.bagOpenRatio = 0;
    events.push({ type: 'sfx', sfx: 'bat_whoosh' });
    pushDialogue(s, events, 'cj', pickLine(s.profile.dialogues.cjRebelShock, s.dialogueCounter));
  } else if (next === 'rebel_qte_dodge') {
    s.clerkHasBat = true;
    s.clerkX = 1.35;
    s.clerkZ = -0.05;
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
    // Position both cleanly on the customer side of the counter for immediate 3D action
    if (s.clerkZ < -0.5) {
      s.clerkX = 1.95;
      s.clerkZ = 0.25;
    }
    if (s.cjZ < 0.25) {
      s.cjZ = 0.65;
    }
    setFeedback(s, '¡PELEA EN TIENDA O HUYE POR LA PUERTA!', 'warn', 2.4);
    pushDialogue(
      s,
      events,
      'clerk',
      pickLine(s.profile.dialogues.clerkBrawlTaunt, s.dialogueCounter),
    );
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
    pushDialogue(s, events, 'cj', pickLine(exitPool, s.dialogueCounter));
  }
}

function advanceBagStack(
  s: RobberySession,
  events: RobberyEvent[],
  timingQuality: 'perfect' | 'good' | 'late',
  rng: () => number,
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

  // Clerk pleads midway through bagging
  if (s.stacksCollected === 2 || s.stacksCollected === 4) {
    pushDialogue(
      s,
      events,
      'clerk',
      pickLine(s.profile.dialogues.clerkComplyBag, s.stacksCollected),
    );
  }

  // Move to next stack or finish bagging
  const nextIdx = s.activeStackIndex + 1;
  if (nextIdx >= s.totalStacks) {
    // Brief moment for final stack sweep animation handled in step
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

  // 1. Intimidation phase: player presses buttons to pressure clerk
  if (s.phase === 'intimidate') {
    if (action === 'intimidate') {
      s.intimidation = Math.min(100, s.intimidation + 15);
      s.rage = Math.min(100, s.rage + 4);
      s.cjGesture = 'point';
      s.cjGestureTimer = 0.36;
      setFeedback(s, '¡PRESIÓN +15!', 'good', 0.85);
      if (s.dialogueTimer <= 0.8) {
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
      pushDialogue(s, events, 'cj', pickLine(s.profile.dialogues.cjThreaten, s.dialogueCounter));
      events.push({ type: 'camera_trauma', amount: 0.25 });
    } else if (action === 'rush' && s.rushCooldown <= 0) {
      s.intimidation = Math.min(100, s.intimidation + 20);
      s.rage = Math.min(100, s.rage + 22);
      s.rushCooldown = 1.3;
      s.cjGesture = 'slam';
      s.cjGestureTimer = 0.4;
      setFeedback(s, '¡APRESURAS AL DUEÑO!', 'warn', 1.0);
      pushDialogue(s, events, 'cj', pickLine(s.profile.dialogues.cjRush, s.dialogueCounter));
      events.push({ type: 'camera_trauma', amount: 0.22 });
    }

    // Immediate transition once intimidation meter maxes out
    if (s.intimidation >= 100) {
      transitionToPhase(s, 'branch_reveal', events, rng);
    }
    return events;
  }

  // 2. Branch A: Bagging Cash Stacks QTE
  if (s.phase === 'comply_bag' && action === 'grab_cash') {
    if (s.activeStackIndex < s.totalStacks && !s.qteResolved) {
      const progress = s.qteElapsed / Math.max(0.01, s.qteWindow);
      const quality =
        progress >= s.qteSweetMin && progress <= s.qteSweetMax
          ? 'perfect'
          : 'good';
      advanceBagStack(s, events, quality, rng);
    }
    return events;
  }

  // 3. Branch B: Bat Ambush Dodge QTE
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

  // 4. Branch B: Counter-Strike QTE
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
      pushDialogue(s, events, 'cj', pickLine(s.profile.dialogues.cjBrawlHit, s.dialogueCounter));
      transitionToPhase(s, 'rebel_brawl', events, rng);
    }
    return events;
  }

  // 5. Branch B: Real-Time 3D Brawl Inside Store
  if (s.phase === 'rebel_brawl') {
    if (action === 'punch' && s.cjPunchCooldown <= 0 && s.cjDodgeTimer <= 0) {
      s.cjPunchCooldown = 0.42;
      s.cjPunchCombo = (s.cjPunchCombo + 1) % 2;
      s.cjGesture = s.cjPunchCombo === 0 ? 'punch_r' : 'punch_l';
      s.cjGestureTimer = 0.3;

      // Face clerk if close enough
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

        // Knockback clerk slightly away from CJ
        const inv = 1 / Math.max(0.1, dist);
        const pushed = resolveInteriorCircle(
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
          pushDialogue(s, events, 'clerk', pickLine(s.profile.dialogues.clerkKo, 0));
        } else {
          s.clerkAction = 'stagger';
          s.clerkActionTimer = 0.46;
          setFeedback(s, `¡GOLPE! DUEÑO ${s.clerkHealth}% HP`, 'good', 0.9);
          if (s.dialogueTimer <= 0.6) {
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
      // Strafe laterally away from clerk
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
      const nearCounter = Math.abs(s.cjX) <= 2.4 && s.cjZ <= 0.95;
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
  if (s.dialogueTimer > 0) s.dialogueTimer = Math.max(0, s.dialogueTimer - dt);
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

  // Update active stack bagging animations
  for (const st of s.stacks) {
    if (st.state === 'bagging') {
      st.progress = Math.min(1, st.progress + dt * 2.8);
      if (st.progress >= 1) st.state = 'bagged';
    }
  }

  switch (s.phase) {
    case 'entering': {
      const t = Math.min(1, s.phaseTime / 1.15);
      // Smooth ease-out stride from door (3.45) to counter (0.08)
      const ease = 1 - (1 - t) * (1 - t);
      s.cjZ = 3.45 + (0.08 - 3.45) * ease;
      s.cjX = 0;
      s.cjHeading = Math.PI;
      s.cjWalkCycle += dt * 7.8;
      if (s.phaseTime >= 1.15) {
        transitionToPhase(s, 'intimidate', events, rng);
      }
      break;
    }

    case 'intimidate': {
      // Gentle decay on intimidation if player stalls
      s.intimidation = Math.max(5, s.intimidation - dt * 2.2);
      if (s.phaseTime >= 2.6 && s.dialogueTimer <= 0.15) {
        const scared = computeCooperationProbability(
          s.profile.baseBravery,
          s.intimidation,
          s.rage,
        ) >= 0.5;
        pushDialogue(
          s,
          events,
          'clerk',
          pickLine(
            scared ? s.profile.dialogues.clerkScared : s.profile.dialogues.clerkDefiant,
            s.dialogueCounter,
          ),
        );
      }
      if (s.phaseTime >= 5.6) {
        transitionToPhase(s, 'branch_reveal', events, rng);
      }
      break;
    }

    case 'branch_reveal': {
      if (s.phaseTime >= 0.9) {
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
      if (s.phaseTime >= 0.65) {
        s.drawerOpenRatio = Math.min(1, (s.phaseTime - 0.65) / 0.4);
        if (prevDrawer === 0 && s.drawerOpenRatio > 0) {
          events.push({ type: 'sfx', sfx: 'drawer_pop' });
        }
      }
      if (s.phaseTime >= 1.0 && s.stacks[0]) {
        s.stacks[0].state = 'placing';
        s.stacks[0].progress = Math.min(1, (s.phaseTime - 1.0) / 0.45);
      }
      if (s.phaseTime >= 1.45) {
        transitionToPhase(s, 'comply_bag', events, rng);
      }
      break;
    }

    case 'comply_bag': {
      if (s.activeStackIndex >= s.totalStacks) {
        // Wait briefly for last stack to land inside duffel bag
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
        advanceBagStack(s, events, 'late', rng);
      }
      break;
    }

    case 'rebel_draw': {
      // Clerk steps from behind counter around the east end (x = 2.85) toward customer zone
      const t = Math.min(1, s.phaseTime / 1.1);
      if (t < 0.45) {
        const u = t / 0.45;
        s.clerkX = 0.2 + (2.95 - 0.2) * u;
        s.clerkZ = -2.25 + (-1.5 - -2.25) * u;
        s.clerkHeading = Math.PI * 0.42;
      } else {
        const u = (t - 0.45) / 0.55;
        s.clerkX = 2.95 + (1.45 - 2.95) * u;
        s.clerkZ = -1.5 + (-0.05 - -1.5) * u;
        s.clerkHeading = Math.atan2(s.cjX - s.clerkX, s.cjZ - s.clerkZ);
      }
      s.clerkWalkCycle += dt * 9.5;
      s.cjHeading = Math.atan2(s.clerkX - s.cjX, s.clerkZ - s.cjZ);

      if (s.phaseTime >= 1.1) {
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
      // 1. Player real-time 3D movement inside shop interior
      if (s.cjDodgeTimer > 0) {
        s.cjDodgeTimer = Math.max(0, s.cjDodgeTimer - dt);
        const nextPos = resolveInteriorCircle(
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
          const resolved = resolveInteriorCircle(
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

      // Auto-escape if CJ walks directly into the illuminated exit doorway
      if (
        s.cjZ >= INTERIOR_BOUNDS.exitTriggerZ &&
        s.cjX >= INTERIOR_BOUNDS.exitMinX &&
        s.cjX <= INTERIOR_BOUNDS.exitMaxX
      ) {
        transitionToPhase(s, 'exiting', events, rng);
        break;
      }

      // 2. Clerk real-time AI (chase -> telegraph windup -> bat swing -> recover / KO)
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
        // Chase steering (smart counter avoidance if counter sits between clerk and CJ)
        let targetX = s.cjX;
        let targetZ = s.cjZ;
        const clerkBehind = s.clerkZ < INTERIOR_BOUNDS.counterMinZ;
        const cjFront = s.cjZ > INTERIOR_BOUNDS.counterMaxZ;
        const clerkFront = s.clerkZ > INTERIOR_BOUNDS.counterMaxZ;
        const cjBehind = s.cjZ < INTERIOR_BOUNDS.counterMinZ;
        if ((clerkBehind && cjFront) || (clerkFront && cjBehind)) {
          targetX = s.clerkX >= 0 ? 3.15 : -3.15;
          targetZ = -1.25;
        }

        if (dist <= 1.72) {
          s.clerkAction = 'windup';
          s.clerkActionTimer = 0.56;
          s.clerkHeading = Math.atan2(toCjX, toCjZ);
          if (s.dialogueTimer <= 0.4) {
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
          const nextClerk = resolveInteriorCircle(
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
      // CJ sprints toward front doorway (0, 4.15)
      const dx = 0 - s.cjX;
      const dz = 4.1 - s.cjZ;
      const d = Math.hypot(dx, dz);
      if (d > 0.1) {
        const step = Math.min(d, 4.4 * dt);
        s.cjX += (dx / d) * step;
        s.cjZ += (dz / d) * step;
        s.cjHeading = Math.atan2(dx, dz);
        s.cjWalkCycle += dt * 11.2;
      }
      if (s.phaseTime >= 1.15) {
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

  const nearCounter = Math.abs(s.cjX) <= 2.4 && s.cjZ <= 0.95;
  const canLootRegister =
    s.phase === 'rebel_brawl' && s.clerkHealth <= 0 && !s.registerLooted && nearCounter;
  const canExitDoor = s.phase === 'rebel_brawl';

  const coopPct = Math.round(
    computeCooperationProbability(s.profile.baseBravery, s.intimidation, s.rage) * 100,
  );

  return {
    shopId: s.shop.id,
    shopName: s.shop.name,
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
    dialogue: s.dialogueTimer > 0 ? s.currentDialogue : null,
    feedbackText: s.feedbackTimer > 0 ? s.feedbackText : null,
    feedbackTone: s.feedbackTone,
    cooperationChancePct: coopPct,
  };
}
