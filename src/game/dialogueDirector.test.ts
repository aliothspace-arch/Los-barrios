import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcNaturalDialogueDuration,
  clampNaturalSpeechRate,
  DialogueDirector,
} from './dialogueDirector';

test('calcNaturalDialogueDuration scales naturally with word count and clamps speech rate', () => {
  const shortDur = calcNaturalDialogueDuration('¡Quietos!');
  const longDur = calcNaturalDialogueDuration(
    '¡Esto es un atraco, abre la caja ahora mismo o se va a liar muy gorda en esta tienda!',
  );
  assert.ok(shortDur >= 2.6, 'Short exclamation still meets 2.6s readability floor');
  assert.ok(longDur > shortDur && longDur <= 6.4);
  assert.equal(clampNaturalSpeechRate(1.35), 1.04);
  assert.equal(clampNaturalSpeechRate(0.72), 0.9);
});

test('DialogueDirector plays FIFO queue without cutting off lines prematurely and supports TTS onEnd handshake', () => {
  const spoken: Array<{ text: string; interrupt: boolean }> = [];
  const ttsControl: { onEnd: (() => void) | null } = { onEnd: null };

  const director = new DialogueDirector((line, opts) => {
    spoken.push({ text: line.text, interrupt: opts.interrupt });
    ttsControl.onEnd = opts.onEnd;
    return true;
  });

  director.enqueue({
    speaker: 'CJ',
    role: 'cj',
    text: '¡Manos arriba! ¡Vacía esa caja ya mismo!',
    beatTag: 'cj_entry',
    pauseAfterSec: 0.3,
  });
  director.enqueue({
    speaker: 'Encargado',
    role: 'clerk',
    text: '¡Tranquilo amigo, no hace falta ponerse nervioso!',
    beatTag: 'clerk_entry',
    pauseAfterSec: 0.3,
  });

  assert.equal(spoken.length, 1, 'Second line must wait in FIFO queue while first speaks');
  assert.equal(director.getCurrentLine()?.speaker, 'CJ');

  // Step past minDurationSec (3.93s) while TTS hasn't called onEnd yet -> line stays active until onEnd or maxDuration
  for (let i = 0; i < 42; i++) {
    director.update(0.1);
  }
  assert.equal(director.getCurrentLine()?.speaker, 'CJ');

  // Fire TTS onEnd -> enters 0.3s natural pause, then advances to Encargado
  ttsControl.onEnd?.();
  for (let i = 0; i < 6; i++) {
    director.update(0.1);
  }
  assert.equal(spoken.length, 2);
  assert.equal(director.getCurrentLine()?.speaker, 'Encargado');
  assert.equal(director.hasCompletedBeat('cj_entry'), true);
});

test('ambient greetings yield to robbery dialogue, get overridden cleanly, and skipCurrent advances immediately', () => {
  const director = new DialogueDirector();

  const ambId = director.enqueue({
    speaker: 'Empleado',
    role: 'clerk',
    text: '¡Buenas! Pasa y mira lo que necesites.',
    priority: 'ambient',
  });
  assert.ok(ambId > 0);
  assert.equal(director.getCurrentLine()?.speaker, 'Empleado');

  // Normal robbery dialogue overrides ambient immediately
  director.enqueue({
    speaker: 'CJ',
    role: 'cj',
    text: '¡Esto es un atraco!',
    priority: 'normal',
    beatTag: 'rob_start',
  });
  assert.equal(director.getCurrentLine()?.speaker, 'CJ');

  // Ambient greeting submitted while busy is cleanly rejected (-1)
  const rejectedAmb = director.enqueue({
    speaker: 'Otro',
    role: 'clerk',
    text: 'Hola',
    priority: 'ambient',
  });
  assert.equal(rejectedAmb, -1);

  // Enqueue second normal line then skipCurrent -> jumps right to second line & marks beat complete
  director.enqueue({
    speaker: 'Dueño',
    role: 'clerk',
    text: '¡Vale, vale, abro la registradora!',
    priority: 'normal',
    beatTag: 'comply',
  });
  assert.equal(director.skipCurrent(), true);
  assert.equal(director.hasCompletedBeat('rob_start'), true);
  assert.equal(director.getCurrentLine()?.speaker, 'Dueño');

  // Urgent KO interrupt clears active queue and plays immediately
  director.enqueue({
    speaker: 'Dueño',
    role: 'clerk',
    text: '¡Agh... me dejaste seco!',
    priority: 'urgent',
  });
  assert.equal(director.getQueueLength(), 1);
  assert.equal(director.getCurrentLine()?.text, '¡Agh... me dejaste seco!');
});
