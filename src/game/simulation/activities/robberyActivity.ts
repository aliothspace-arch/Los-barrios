import type {
  ControlInput,
  RobberyActionType,
  RobberyHUDState,
  ShopSpec,
} from '../../types';
import {
  buildRobberyHudState,
  createRobberySession,
  handleRobberyAction,
  stepRobberySession,
  type RobberyEvent,
  type RobberySession,
} from '../../robberySystem';
import type { ActivityContext, ActivityController } from './activityTypes';

export interface RobberyStartParams {
  shop: ShopSpec;
  forcedOutcomeRoll?: number;
  rng?: () => number;
}

export interface RobberyActivityCallbacks {
  onEvents?: (events: RobberyEvent[], session: RobberySession) => void;
}

/**
 * Interactive 3D store robbery wrapped as an exclusive pluggable ActivityController.
 * Bridges the pure headless `robberySystem` state machine with `GameEventBus`
 * without coupling directly to `SanAndreasEngine`.
 */
export class RobberyActivity
  implements ActivityController<RobberyStartParams, RobberyActionType, RobberyHUDState | null>
{
  public readonly id = 'interactive_store_robbery';
  public readonly exclusive = true;

  private session: RobberySession | null = null;
  private rng: () => number = Math.random;
  private readonly callbacks: RobberyActivityCallbacks;

  constructor(callbacks: RobberyActivityCallbacks = {}) {
    this.callbacks = callbacks;
  }

  public get isActive(): boolean {
    return this.session !== null && !this.session.completed;
  }

  public get currentSession(): RobberySession | null {
    return this.session;
  }

  public start(params: RobberyStartParams, ctx: ActivityContext): void {
    this.rng = params.rng ?? Math.random;
    const { session, events } = createRobberySession(params.shop, {
      forcedOutcomeRoll: params.forcedOutcomeRoll,
      rng: this.rng,
    });
    this.session = session;
    this.dispatchEvents(events, ctx);
  }

  public update(dt: number, input: ControlInput, ctx: ActivityContext): void {
    if (!this.session) return;
    const events = stepRobberySession(
      this.session,
      dt,
      {
        moveX: input.right - input.left,
        moveZ: input.backward - input.forward,
        sprint: input.sprintOrNitro,
      },
      this.rng,
    );
    this.dispatchEvents(events, ctx);
    if (this.session?.completed) {
      this.session = null;
    }
  }

  public handleAction(action: RobberyActionType, ctx: ActivityContext): void {
    if (!this.session) return;
    const events = handleRobberyAction(this.session, action, this.rng);
    this.dispatchEvents(events, ctx);
    if (this.session?.completed) {
      this.session = null;
    }
  }

  public cancel(ctx: ActivityContext): void {
    if (!this.session) return;
    this.session = null;
    ctx.eventBus.emit('activity:ended', {
      activityId: this.id,
      completed: false,
    });
  }

  public getHudSlice(): RobberyHUDState | null {
    return this.session ? buildRobberyHudState(this.session) : null;
  }

  private dispatchEvents(events: RobberyEvent[], ctx: ActivityContext): void {
    if (!this.session || events.length === 0) return;
    this.callbacks.onEvents?.(events, this.session);

    for (const ev of events) {
      if (ev.type === 'sfx' && ev.sfx) {
        ctx.eventBus.emit('sfx:play', { kind: 'robbery_sfx', sfx: ev.sfx });
      } else if (ev.type === 'camera_trauma' && ev.amount) {
        ctx.eventBus.emit('camera:trauma', { amount: ev.amount });
      } else if (ev.type === 'damage_player' && ev.amount) {
        ctx.eventBus.emit('player:damage', { amount: ev.amount, source: 'robbery_bat' });
      } else if (ev.type === 'completed') {
        ctx.eventBus.emit('activity:ended', {
          activityId: this.id,
          completed: true,
          reward: ev.payout ?? 0,
        });
      }
    }
  }
}
