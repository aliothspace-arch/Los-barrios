import type { CheckpointObjective, ControlInput } from '../../types';
import { INITIAL_CHECKPOINTS } from '../../worldLayout';
import type { ActivityContext, ActivityController } from './activityTypes';

export interface CheckpointHudSlice {
  activeCheckpoint: CheckpointObjective | null;
  cleared: number;
  total: number;
  objectiveLabel: string;
  allCleared: boolean;
}

/**
 * Ambient open-world checkpoint circuit implemented as a pluggable ActivityController.
 * Emits typed events on GameEventBus when checkpoints are reached or the tour completes.
 */
export class CheckpointActivity
  implements ActivityController<void, never, CheckpointHudSlice>
{
  public readonly id = 'los_santos_checkpoints';
  public readonly exclusive = false;

  private checkpoints: CheckpointObjective[] = [];
  private active = false;

  public get isActive(): boolean {
    return this.active;
  }

  public get items(): readonly CheckpointObjective[] {
    return this.checkpoints;
  }

  public start(_params: void, _ctx: ActivityContext): void {
    this.checkpoints = INITIAL_CHECKPOINTS.map((c) => ({ ...c, collected: false }));
    this.active = true;
  }

  public getCurrentCheckpoint(): CheckpointObjective | null {
    for (let i = 0; i < this.checkpoints.length; i++) {
      if (!this.checkpoints[i].collected) return this.checkpoints[i];
    }
    return null;
  }

  public update(_dt: number, _input: ControlInput, ctx: ActivityContext): void {
    if (!this.active) return;
    const current = this.getCurrentCheckpoint();
    if (!current) return;

    const pos = ctx.getPlayerPosition();
    const triggerRadius = pos.inVehicle ? 5.2 : 3.4;
    if (Math.hypot(pos.x - current.x, pos.z - current.z) < triggerRadius) {
      current.collected = true;
      ctx.eventBus.emit('player:cash', {
        delta: current.reward,
        reason: `checkpoint:${current.id}`,
      });
      ctx.eventBus.emit('sfx:play', { kind: 'checkpoint' });
      ctx.eventBus.emit('banner:show', {
        text: `${current.label} · +$${current.reward}`,
        duration: 2.6,
      });

      const remaining = this.getCurrentCheckpoint();
      if (!remaining) {
        this.active = false;
        ctx.eventBus.emit('activity:ended', {
          activityId: this.id,
          completed: true,
          reward: current.reward,
        });
      }
    }
  }

  public handleAction(_action: never, _ctx: ActivityContext): void {
    // Ambient proximity activity has no discrete button actions
  }

  public cancel(_ctx: ActivityContext): void {
    this.active = false;
  }

  public getHudSlice(): CheckpointHudSlice {
    let cleared = 0;
    let activeCheckpoint: CheckpointObjective | null = null;
    for (let i = 0; i < this.checkpoints.length; i++) {
      if (this.checkpoints[i].collected) {
        cleared++;
      } else if (!activeCheckpoint) {
        activeCheckpoint = this.checkpoints[i];
      }
    }
    const total = this.checkpoints.length;
    return {
      activeCheckpoint,
      cleared,
      total,
      objectiveLabel: activeCheckpoint
        ? activeCheckpoint.label
        : 'RUTA COMPLETADA · LIBRE',
      allCleared: total > 0 && cleared >= total,
    };
  }
}
