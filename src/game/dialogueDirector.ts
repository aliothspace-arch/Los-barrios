import type { RobberyDialogueLine } from './types';

export type DialoguePriority = 'ambient' | 'normal' | 'urgent';

export interface DialogueQueueRequest {
  speaker: string;
  role: 'cj' | 'clerk';
  text: string;
  pitch?: number;
  rate?: number;
  priority?: DialoguePriority;
  beatTag?: string;
  minDurationSec?: number;
  pauseAfterSec?: number;
}

export interface ActiveDialogueEntry extends RobberyDialogueLine {
  priority: DialoguePriority;
  beatTag?: string;
  elapsed: number;
  minDurationSec: number;
  maxDurationSec: number;
  pauseAfterSec: number;
  ttsDone: boolean;
  finished: boolean;
  pauseRemaining: number;
}

export type SpeechTriggerCallback = (
  line: RobberyDialogueLine,
  opts: { interrupt: boolean; onEnd: () => void },
) => boolean;

/**
 * Computes natural Spanish reading & speech pacing so lines never clip or vanish too fast.
 */
export function calcNaturalDialogueDuration(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2.6, Math.min(6.4, words * 0.44 + 0.85));
}

export function clampNaturalSpeechRate(rate: number): number {
  return Math.max(0.9, Math.min(1.04, rate));
}

/**
 * FIFO synchronized dialogue & TTS director with natural turn pauses,
 * ambient yield, urgent KO interrupts, and [Tab]/tap skip.
 */
export class DialogueDirector {
  private nextId = 1;
  private active: ActiveDialogueEntry | null = null;
  private queue: ActiveDialogueEntry[] = [];
  private cooldownAfterClear = 0;
  private onSpeak: SpeechTriggerCallback | null = null;
  private readonly completedBeats = new Set<string>();

  constructor(onSpeak?: SpeechTriggerCallback) {
    this.onSpeak = onSpeak ?? null;
  }

  public setSpeechHandler(handler: SpeechTriggerCallback | null): void {
    this.onSpeak = handler;
  }

  public clear(cancelAudio = true): void {
    this.active = null;
    this.queue.length = 0;
    this.cooldownAfterClear = 0;
    this.completedBeats.clear();
    if (cancelAudio && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore restricted browser environments
      }
    }
  }

  public enqueue(req: DialogueQueueRequest): number {
    const priority: DialoguePriority = req.priority ?? 'normal';

    // Ambient greetings immediately yield if active dialogue or robbery queue is already running
    if (priority === 'ambient' && (this.active !== null || this.queue.length > 0)) {
      return -1;
    }

    const baseRate = clampNaturalSpeechRate(req.rate ?? 0.98);
    const estDuration = calcNaturalDialogueDuration(req.text);
    const minDurationSec = req.minDurationSec ?? estDuration;
    const maxDurationSec = Math.max(minDurationSec + 1.15, estDuration * 1.45 + 0.8);
    const pauseAfterSec = req.pauseAfterSec ?? (priority === 'ambient' ? 0.15 : 0.36);

    const entry: ActiveDialogueEntry = {
      id: this.nextId++,
      speaker: req.speaker,
      role: req.role,
      text: req.text,
      pitch: req.pitch ?? (req.role === 'cj' ? 0.92 : 1.04),
      rate: baseRate,
      priority,
      beatTag: req.beatTag,
      elapsed: 0,
      minDurationSec,
      maxDurationSec,
      pauseAfterSec,
      ttsDone: false,
      finished: false,
      pauseRemaining: 0,
    };

    if (priority === 'urgent') {
      if (this.active?.beatTag) {
        this.completedBeats.add(this.active.beatTag);
      }
      this.queue.length = 0;
      this.active = null;
      this.cooldownAfterClear = 0;
      this.startEntry(entry, true);
      return entry.id;
    }

    if (this.active && this.active.priority === 'ambient' && priority === 'normal') {
      // Non-ambient robbery/story dialogue overrides idle clerk greeting cleanly
      this.active = null;
      this.cooldownAfterClear = 0;
      this.startEntry(entry, true);
      return entry.id;
    }

    if (!this.active && this.cooldownAfterClear <= 0) {
      this.startEntry(entry, false);
    } else {
      // Prevent duplicate identical lines stacking consecutively
      const tail = this.queue[this.queue.length - 1] ?? this.active;
      if (tail && tail.text === entry.text && tail.role === entry.role) {
        return tail.id;
      }
      if (this.queue.length >= 6 && priority === 'normal') {
        // Keep queue responsive without lagging behind action
        return -1;
      }
      this.queue.push(entry);
    }
    return entry.id;
  }

  private startEntry(entry: ActiveDialogueEntry, interruptAudio: boolean): void {
    this.active = entry;
    const handled = this.onSpeak
      ? this.onSpeak(
          {
            id: entry.id,
            speaker: entry.speaker,
            role: entry.role,
            text: entry.text,
            pitch: entry.pitch,
            rate: entry.rate,
          },
          {
            interrupt: interruptAudio,
            onEnd: () => {
              if (this.active && this.active.id === entry.id) {
                this.active.ttsDone = true;
              }
            },
          },
        )
      : false;

    if (!handled) {
      // No active TTS backend (or muted): rely strictly on minDurationSec
      entry.ttsDone = true;
    }
  }

  public skipCurrent(): boolean {
    if (!this.active) return false;
    if (this.active.beatTag) {
      this.completedBeats.add(this.active.beatTag);
    }
    this.active = null;
    this.cooldownAfterClear = 0.08;
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.cooldownAfterClear = 0;
      this.startEntry(next, true);
    } else if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
    }
    return true;
  }

  public update(dt: number): void {
    const safeDt = Math.max(0, Math.min(0.1, dt));
    if (this.active) {
      this.active.elapsed += safeDt;
      const reachedMin = this.active.elapsed >= this.active.minDurationSec;
      const reachedMax = this.active.elapsed >= this.active.maxDurationSec;

      if (!this.active.finished && ((reachedMin && this.active.ttsDone) || reachedMax)) {
        this.active.finished = true;
        if (this.active.beatTag) {
          this.completedBeats.add(this.active.beatTag);
        }
        this.active.pauseRemaining = this.active.pauseAfterSec;
      }

      if (this.active.finished) {
        this.active.pauseRemaining -= safeDt;
        if (this.active.pauseRemaining <= 0) {
          this.active = null;
          if (this.queue.length > 0) {
            const next = this.queue.shift()!;
            this.startEntry(next, false);
          }
        }
      }
      return;
    }

    if (this.cooldownAfterClear > 0) {
      this.cooldownAfterClear = Math.max(0, this.cooldownAfterClear - safeDt);
      if (this.cooldownAfterClear <= 0 && this.queue.length > 0) {
        const next = this.queue.shift()!;
        this.startEntry(next, false);
      }
    } else if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.startEntry(next, false);
    }
  }

  public getCurrentLine(): RobberyDialogueLine | null {
    if (!this.active || this.active.finished) return null;
    return {
      id: this.active.id,
      speaker: this.active.speaker,
      role: this.active.role,
      text: this.active.text,
      pitch: this.active.pitch,
      rate: this.active.rate,
    };
  }

  public isBusy(): boolean {
    return this.active !== null || this.queue.length > 0;
  }

  public hasCompletedBeat(tag: string): boolean {
    return this.completedBeats.has(tag);
  }

  public isBeatPlayingOrQueued(tag: string): boolean {
    if (this.active?.beatTag === tag && !this.active.finished) return true;
    return this.queue.some((q) => q.beatTag === tag);
  }

  public getQueueLength(): number {
    return (this.active ? 1 : 0) + this.queue.length;
  }
}
