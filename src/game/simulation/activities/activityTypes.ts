import type { ControlInput } from '../../types';
import type { GameEventBus } from '../../core/eventBus';

export interface ActivityContext {
  readonly eventBus: GameEventBus;
  readonly simTimeSec: number;
  getPlayerPosition: () => { x: number; z: number; inVehicle: boolean };
  getPlayerHealth: () => number;
  getPlayerOutfit: () => string;
}

/**
 * Pluggable mission / side-activity contract.
 *
 * Adding a new mission (street race, armored truck heist, gang turf war,
 * delivery gig, or new interior encounter) only requires implementing this
 * interface and registering it with `ActivityRegistry`—no edits to the core
 * simulation loop or engine God Object.
 */
export interface ActivityController<
  TStartParams = void,
  TAction = string,
  THudSlice = unknown,
> {
  readonly id: string;
  /** When true, open-world traffic/peds pause while this activity owns the camera & input. */
  readonly exclusive: boolean;
  readonly isActive: boolean;

  start(params: TStartParams, ctx: ActivityContext): void;
  update(dt: number, input: ControlInput, ctx: ActivityContext): void;
  handleAction(action: TAction, ctx: ActivityContext): void;
  cancel(ctx: ActivityContext): void;
  getHudSlice(): THudSlice;
}

/**
 * Manages registered ambient and exclusive game activities/missions.
 * Supports multiple concurrent ambient activities (e.g., checkpoint circuit,
 * free-roam challenges) plus at most one exclusive foreground activity
 * (e.g., interactive 3D store robbery or scripted mission interior).
 */
export class ActivityRegistry {
  private readonly activities = new Map<string, ActivityController<unknown, unknown, unknown>>();
  private exclusiveActivityId: string | null = null;

  public register<TStart, TAction, THud>(
    activity: ActivityController<TStart, TAction, THud>,
  ): void {
    if (this.activities.has(activity.id)) {
      throw new Error(`Activity "${activity.id}" is already registered`);
    }
    this.activities.set(
      activity.id,
      activity as ActivityController<unknown, unknown, unknown>,
    );
  }

  public get<T extends ActivityController<unknown, unknown, unknown>>(id: string): T | undefined {
    return this.activities.get(id) as T | undefined;
  }

  public getActiveExclusive(): ActivityController<unknown, unknown, unknown> | null {
    if (!this.exclusiveActivityId) return null;
    const act = this.activities.get(this.exclusiveActivityId) ?? null;
    if (!act || !act.isActive) {
      this.exclusiveActivityId = null;
      return null;
    }
    return act;
  }

  public hasExclusiveActive(): boolean {
    return this.getActiveExclusive() !== null;
  }

  public startActivity<TStart>(
    id: string,
    params: TStart,
    ctx: ActivityContext,
  ): boolean {
    const act = this.activities.get(id);
    if (!act) return false;
    if (act.exclusive && this.hasExclusiveActive() && this.exclusiveActivityId !== id) {
      return false;
    }
    act.start(params, ctx);
    if (act.exclusive && act.isActive) {
      this.exclusiveActivityId = id;
    }
    ctx.eventBus.emit('activity:started', { activityId: id });
    return true;
  }

  public updateAll(dt: number, input: ControlInput, ctx: ActivityContext): void {
    const exclusive = this.getActiveExclusive();
    if (exclusive) {
      exclusive.update(dt, input, ctx);
      if (!exclusive.isActive) {
        this.exclusiveActivityId = null;
      }
      return;
    }

    for (const act of this.activities.values()) {
      if (!act.exclusive && act.isActive) {
        act.update(dt, input, ctx);
      }
    }
  }

  public dispatchAction(activityId: string, action: unknown, ctx: ActivityContext): boolean {
    const act = this.activities.get(activityId);
    if (!act || !act.isActive) return false;
    act.handleAction(action, ctx);
    if (act.exclusive && !act.isActive && this.exclusiveActivityId === activityId) {
      this.exclusiveActivityId = null;
    }
    return true;
  }

  public cancelAll(ctx: ActivityContext): void {
    for (const act of this.activities.values()) {
      if (act.isActive) {
        act.cancel(ctx);
      }
    }
    this.exclusiveActivityId = null;
  }
}
