import test from 'node:test';
import assert from 'node:assert/strict';
import { SHOPS } from './worldLayout';
import {
  buildRobberyHudState,
  computeCooperationProbability,
  createRobberySession,
  handleRobberyAction,
  INTERIOR_BOUNDS,
  rollRobberyOutcome,
  stepRobberySession,
} from './robberySystem';

const SHOP_247 = SHOPS.find((s) => s.id === 'shop_247')!;
const SHOP_AMMU = SHOPS.find((s) => s.id === 'shop_ammunation')!;

const NO_MOVE = { moveX: 0, moveZ: 0, sprint: false };

test('weighted cooperation probability respects shop bravery, intimidation, excess rage and [0.18, 0.82] bounds', () => {
  const timidShop = computeCooperationProbability(0.28, 70, 20);
  const braveShop = computeCooperationProbability(0.72, 70, 20);
  assert.ok(timidShop > braveShop, 'Timid store should cooperate more often than Ammu-Nation');

  const lowIntim = computeCooperationProbability(0.4, 15, 20);
  const highIntim = computeCooperationProbability(0.4, 95, 20);
  assert.ok(highIntim > lowIntim, 'Higher intimidation should increase cooperation chance');

  const calm = computeCooperationProbability(0.4, 70, 15);
  const enraged = computeCooperationProbability(0.4, 70, 95);
  assert.ok(enraged < calm, 'Excessive rage should provoke rebellion');

  // Strict [0.18, 0.82] clamping guarantees genuine unpredictability even at extremes
  assert.equal(computeCooperationProbability(0.0, 100, 0), 0.82);
  assert.equal(computeCooperationProbability(1.0, 0, 100), 0.18);

  // Roll determinism with injectable rng
  assert.equal(rollRobberyOutcome(0.5, 50, 20, () => 0.05), 'comply');
  assert.equal(rollRobberyOutcome(0.5, 50, 20, () => 0.95), 'rebel');
});

test('Branch A (Cooperation): full interactive flow opens register, bags 5 cash stacks with perfect bonus, and completes', () => {
  const { session, events: initEvents } = createRobberySession(SHOP_247, {
    forcedOutcomeRoll: 0.05, // guaranteed comply
    rng: () => 0.5,
  });

  assert.equal(session.phase, 'entering');
  assert.ok(initEvents.some((e) => e.type === 'dialogue' && e.dialogue?.role === 'cj'));
  assert.ok(initEvents.some((e) => e.type === 'sfx' && e.sfx === 'door_chime'));

  // Advance through entering -> intimidate
  stepRobberySession(session, 1.2, NO_MOVE, () => 0.5);
  assert.equal(session.phase, 'intimidate');

  // Mash intimidate until meter reaches 100 -> branch_reveal
  for (let i = 0; i < 8 && session.phase === 'intimidate'; i++) {
    handleRobberyAction(session, 'intimidate', () => 0.5);
  }
  assert.equal(session.phase, 'branch_reveal');
  assert.equal(session.outcome, 'comply');

  // Advance branch_reveal -> comply_open -> comply_bag
  stepRobberySession(session, 0.95, NO_MOVE, () => 0.5);
  assert.equal(session.phase, 'comply_open');

  let sawDrawerPop = false;
  for (let i = 0; i < 20 && session.phase === 'comply_open'; i++) {
    const evs = stepRobberySession(session, 0.1, NO_MOVE, () => 0.5);
    if (evs.some((e) => e.type === 'sfx' && e.sfx === 'drawer_pop')) sawDrawerPop = true;
  }
  assert.ok(sawDrawerPop, 'Cash register drawer pop SFX should fire');
  assert.equal(session.phase, 'comply_bag');
  assert.equal(session.drawerOpenRatio, 1.0);

  // Bag all 5 stacks inside sweet spot
  let sawBillBurst = false;
  for (let stack = 0; stack < session.totalStacks; stack++) {
    // Advance into sweet spot (~55% of window)
    stepRobberySession(session, session.qteWindow * 0.55, NO_MOVE, () => 0.5);
    const evs = handleRobberyAction(session, 'grab_cash', () => 0.5);
    if (evs.some((e) => e.type === 'bill_burst')) sawBillBurst = true;
  }
  assert.ok(sawBillBurst, 'Bagging cash should emit bill_burst visual events');
  assert.equal(session.stacksCollected, session.totalStacks);
  assert.ok(session.bagCash >= SHOP_247.robMin, 'Perfect bagging should yield full payout');

  // Advance final stack animation -> exiting -> completed
  let completedEvent = null as ReturnType<typeof stepRobberySession>[number] | null;
  for (let i = 0; i < 40 && !session.completed; i++) {
    const evs = stepRobberySession(session, 0.1, NO_MOVE, () => 0.5);
    const found = evs.find((e) => e.type === 'completed');
    if (found) completedEvent = found;
  }
  assert.equal(session.completed, true);
  assert.ok(completedEvent && (completedEvent.payout ?? 0) === session.bagCash);
});

test('Branch B (Bat Rebellion): QTE dodge/counter + real-time 3D brawl knockout + register loot + exit door', () => {
  const { session } = createRobberySession(SHOP_AMMU, {
    forcedOutcomeRoll: 0.95, // guaranteed rebel
    rng: () => 0.5,
  });

  // Entering -> intimidate -> threaten/rush to trigger branch_reveal
  stepRobberySession(session, 1.2, NO_MOVE, () => 0.5);
  for (let i = 0; i < 6 && session.phase === 'intimidate'; i++) {
    handleRobberyAction(session, 'intimidate', () => 0.5);
  }
  assert.equal(session.phase, 'branch_reveal');
  assert.equal(session.outcome, 'rebel');

  // branch_reveal -> rebel_draw -> rebel_qte_dodge
  stepRobberySession(session, 0.95, NO_MOVE, () => 0.5);
  assert.equal(session.phase, 'rebel_draw');
  assert.equal(session.clerkHasBat, true);

  stepRobberySession(session, 1.15, NO_MOVE, () => 0.5);
  assert.equal(session.phase, 'rebel_qte_dodge');

  // Successful QTE dodge deals zero player damage & moves to rebel_qte_counter
  const dodgeEvs = handleRobberyAction(session, 'dodge', () => 0.5);
  assert.ok(!dodgeEvs.some((e) => e.type === 'damage_player'));
  assert.equal(session.phase, 'rebel_qte_counter');

  // Successful QTE counter damages clerk & drops bonus cash -> rebel_brawl
  const counterEvs = handleRobberyAction(session, 'counter', () => 0.5);
  assert.ok(counterEvs.some((e) => e.type === 'sfx' && e.sfx === 'punch_impact'));
  assert.equal(session.phase, 'rebel_brawl');
  assert.ok(session.clerkHealth < 100);
  assert.ok(session.bagCash > 0);

  // Move CJ close to clerk and punch until clerk is KO'd
  for (let round = 0; round < 10 && session.clerkHealth > 0; round++) {
    session.cjX = session.clerkX - 0.9;
    session.cjZ = session.clerkZ + 0.5;
    session.cjPunchCooldown = 0;
    handleRobberyAction(session, 'punch', () => 0.5);
  }
  assert.equal(session.clerkHealth, 0);
  assert.equal(session.clerkAction, 'ko');
  assert.equal(session.clerkBatDropped, true);

  // Move CJ near counter to loot the register after KO
  session.cjX = 0;
  session.cjZ = 0.2;
  const hudNear = buildRobberyHudState(session);
  assert.equal(hudNear.canLootRegister, true);

  const cashBeforeLoot = session.bagCash;
  handleRobberyAction(session, 'loot_register', () => 0.5);
  assert.equal(session.registerLooted, true);
  assert.ok(session.bagCash > cashBeforeLoot);

  // Walk straight toward exit door (+Z) to trigger escape automatically
  for (let i = 0; i < 40 && session.phase === 'rebel_brawl'; i++) {
    stepRobberySession(session, 0.1, { moveX: 0, moveZ: 1, sprint: true }, () => 0.5);
  }
  assert.equal(session.phase, 'exiting');
  assert.ok(session.cjZ >= INTERIOR_BOUNDS.exitTriggerZ - 0.2);

  // Finish exiting
  for (let i = 0; i < 20 && !session.completed; i++) {
    stepRobberySession(session, 0.1, NO_MOVE, () => 0.5);
  }
  assert.equal(session.completed, true);
});

test('Branch B missed dodge QTE deals real bat damage to player and still transitions smoothly', () => {
  const { session } = createRobberySession(SHOP_247, {
    forcedOutcomeRoll: 0.99,
    rng: () => 0.5,
  });

  stepRobberySession(session, 1.2, NO_MOVE, () => 0.5);
  for (let i = 0; i < 8 && session.phase === 'intimidate'; i++) {
    handleRobberyAction(session, 'intimidate', () => 0.5);
  }
  stepRobberySession(session, 0.95, NO_MOVE, () => 0.5); // -> rebel_draw
  stepRobberySession(session, 1.15, NO_MOVE, () => 0.5); // -> rebel_qte_dodge
  assert.equal(session.phase, 'rebel_qte_dodge');

  // Let dodge timer expire without pressing button
  const evs = stepRobberySession(session, 2.0, NO_MOVE, () => 0.5);
  const dmg = evs.find((e) => e.type === 'damage_player');
  assert.ok(dmg && (dmg.amount ?? 0) > 0, 'Missed dodge QTE must deal bat damage');
  assert.equal(session.phase, 'rebel_qte_counter');
});
