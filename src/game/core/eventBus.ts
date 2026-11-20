import type { WeatherType } from '../types';

export type GameSfxEvent =
  | { kind: 'impact'; intensity: number }
  | { kind: 'door' }
  | { kind: 'gear_shift'; up: boolean }
  | { kind: 'curb_bump'; intensity: number }
  | { kind: 'scrape'; intensity: number }
  | { kind: 'checkpoint' }
  | { kind: 'jump' }
  | { kind: 'punch' }
  | { kind: 'hit' }
  | { kind: 'cash' }
  | { kind: 'robbery_alarm' }
  | { kind: 'robbery_sfx'; sfx: string };

export interface GameEventMap {
  'sfx:play': GameSfxEvent;
  'banner:show': { text: string; duration: number };
  'camera:trauma': { amount: number };
  'crime:wanted': { targetLevel: number; reason?: string };
  'player:cash': { delta: number; reason?: string };
  'player:damage': { amount: number; source?: string };
  'particle:burst': {
    x: number;
    y: number;
    z: number;
    count: number;
    kind: 'spark' | 'smoke' | 'spray';
    vx?: number;
    vy?: number;
    vz?: number;
    intensity?: number;
  };
  'weather:changed': { weather: WeatherType };
  'activity:started': { activityId: string };
  'activity:ended': { activityId: string; completed: boolean; reward?: number };
}

export type GameEventKey = keyof GameEventMap;
export type GameEventHandler<K extends GameEventKey> = (payload: GameEventMap[K]) => void;

/**
 * Lightweight typed synchronous event bus decoupling simulation systems,
 * pluggable activities/missions, audio, camera trauma, and visual effects.
 */
export class GameEventBus {
  private listeners = new Map<GameEventKey, Set<GameEventHandler<never>>>();

  public on<K extends GameEventKey>(event: K, handler: GameEventHandler<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as GameEventHandler<never>);
    return () => {
      this.off(event, handler);
    };
  }

  public off<K extends GameEventKey>(event: K, handler: GameEventHandler<K>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(handler as GameEventHandler<never>);
    if (set.size === 0) {
      this.listeners.delete(event);
    }
  }

  public emit<K extends GameEventKey>(event: K, payload: GameEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    for (const handler of set) {
      (handler as GameEventHandler<K>)(payload);
    }
  }

  public listenerCount(event?: GameEventKey): number {
    if (event) {
      return this.listeners.get(event)?.size ?? 0;
    }
    let total = 0;
    for (const set of this.listeners.values()) {
      total += set.size;
    }
    return total;
  }

  public clear(): void {
    this.listeners.clear();
  }
}
