import type { ControlInput, GamePhase, RobberyActionType } from '../types';
import type { RobberySession } from '../robberySystem';
import { buildRobberyHudState } from '../robberySystem';

export interface TouchControlState {
  stickX: number; // -1..1
  stickY: number; // -1..1 (positive = forward)
  gas: boolean;
  brake: boolean;
  steerLeft: boolean;
  steerRight: boolean;
  handbrake: boolean;
  nitroOrSprint: boolean;
}

export interface InputActionHooks {
  getPhase: () => GamePhase;
  hasActiveShop: () => boolean;
  getRobberySession: () => RobberySession | null;
  hasNearShop: () => boolean;
  unlockAudio: () => void;
  startGame: () => void;
  closeShop: () => void;
  togglePause: () => void;
  toggleMute: () => void;
  openNearestShop: () => void;
  cycleWeather: () => void;
  cycleTimePreset: () => void;
  cycleCameraMode: () => void;
  resetWorld: () => void;
  toggleVehicleDoors: () => void;
  toggleVehicleFrunk: () => void;
  triggerRobberyAction: (action: RobberyActionType) => void;
}

/**
 * Decoupled keyboard + mobile touch input controller.
 * Manages key bindings by active gameplay context (title, shop modal,
 * interactive robbery, or open world) and produces normalized `ControlInput`.
 */
export class InputController {
  private readonly hooks: InputActionHooks;
  private readonly keysHeld = new Set<string>();
  private enterVehicleQueued = false;
  private jumpQueued = false;
  private orbitDeltaX = 0;
  private orbitDeltaY = 0;
  private readonly touchState: TouchControlState = {
    stickX: 0,
    stickY: 0,
    gas: false,
    brake: false,
    steerLeft: false,
    steerRight: false,
    handbrake: false,
    nitroOrSprint: false,
  };

  constructor(hooks: InputActionHooks) {
    this.hooks = hooks;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  public setTouchState(partial: Partial<TouchControlState>): void {
    Object.assign(this.touchState, partial);
  }

  public queueEnterOrExitVehicle(): void {
    this.enterVehicleQueued = true;
  }

  public queueJumpOrAction(): void {
    this.jumpQueued = true;
  }

  public addOrbitDelta(dx: number, dy: number): void {
    this.orbitDeltaX += dx;
    this.orbitDeltaY += dy;
  }

  public clearTransientInput(): void {
    this.keysHeld.clear();
    this.enterVehicleQueued = false;
    this.jumpQueued = false;
    this.orbitDeltaX = 0;
    this.orbitDeltaY = 0;
    this.touchState.gas = false;
    this.touchState.brake = false;
    this.touchState.steerLeft = false;
    this.touchState.steerRight = false;
    this.touchState.handbrake = false;
    this.touchState.nitroOrSprint = false;
    this.touchState.stickX = 0;
    this.touchState.stickY = 0;
  }

  public sampleInput(): ControlInput {
    const k = this.keysHeld;
    const t = this.touchState;

    const fwdKey = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    const backKey = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    const leftKey = k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0;
    const rightKey = k.has('KeyD') || k.has('ArrowRight') ? 1 : 0;

    const forward = Math.max(fwdKey, t.gas ? 1 : 0, Math.max(0, t.stickY));
    const backward = Math.max(backKey, t.brake ? 1 : 0, Math.max(0, -t.stickY));
    const left = Math.max(leftKey, t.steerLeft ? 1 : 0, Math.max(0, -t.stickX));
    const right = Math.max(rightKey, t.steerRight ? 1 : 0, Math.max(0, t.stickX));

    const input: ControlInput = {
      forward: Math.min(1, forward),
      backward: Math.min(1, backward),
      left: Math.min(1, left),
      right: Math.min(1, right),
      handbrake: k.has('Space') || t.handbrake,
      sprintOrNitro: k.has('ShiftLeft') || k.has('ShiftRight') || t.nitroOrSprint,
      jumpOrAction: this.jumpQueued,
      enterVehiclePressed: this.enterVehicleQueued,
      cameraOrbitDeltaX: this.orbitDeltaX,
      cameraOrbitDeltaY: this.orbitDeltaY,
    };

    this.enterVehicleQueued = false;
    this.jumpQueued = false;
    this.orbitDeltaX = 0;
    this.orbitDeltaY = 0;
    return input;
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;
    const phase = this.hooks.getPhase();

    if (phase === 'title') {
      if (code === 'Enter' || code === 'Space') {
        e.preventDefault();
        this.hooks.startGame();
      }
      return;
    }

    if (code === 'Escape' || code === 'KeyP') {
      e.preventDefault();
      if (this.hooks.hasActiveShop()) {
        this.hooks.closeShop();
        return;
      }
      if (phase === 'playing' || phase === 'paused') {
        this.hooks.togglePause();
      }
      return;
    }

    if (phase !== 'playing' || this.hooks.hasActiveShop()) return;

    this.hooks.unlockAudio();

    const robbery = this.hooks.getRobberySession();
    if (robbery) {
      if (
        code === 'ArrowUp' ||
        code === 'ArrowDown' ||
        code === 'ArrowLeft' ||
        code === 'ArrowRight' ||
        code === 'Space'
      ) {
        e.preventDefault();
      }
      if (!this.keysHeld.has(code)) {
        const rp = robbery.phase;
        if (code === 'KeyM') {
          this.hooks.toggleMute();
        } else if (rp === 'intimidate') {
          if (code === 'Space') this.hooks.triggerRobberyAction('intimidate');
          else if (code === 'KeyQ') this.hooks.triggerRobberyAction('threaten');
          else if (code === 'KeyE') this.hooks.triggerRobberyAction('rush');
        } else if (rp === 'comply_bag') {
          if (code === 'Space' || code === 'KeyE') this.hooks.triggerRobberyAction('grab_cash');
        } else if (rp === 'rebel_qte_dodge') {
          if (
            code === 'Space' ||
            code === 'KeyA' ||
            code === 'KeyD' ||
            code === 'ArrowLeft' ||
            code === 'ArrowRight'
          ) {
            this.hooks.triggerRobberyAction('dodge');
          }
        } else if (rp === 'rebel_qte_counter') {
          if (code === 'KeyE' || code === 'Space') this.hooks.triggerRobberyAction('counter');
        } else if (rp === 'rebel_brawl') {
          if (code === 'KeyE') {
            this.hooks.triggerRobberyAction('punch');
          } else if (code === 'Space') {
            this.hooks.triggerRobberyAction('dodge');
          } else if (code === 'KeyF') {
            const hudSnap = buildRobberyHudState(robbery);
            this.hooks.triggerRobberyAction(
              hudSnap.canLootRegister ? 'loot_register' : 'exit_door',
            );
          }
        }
      }
      this.keysHeld.add(code);
      return;
    }

    if (!this.keysHeld.has(code)) {
      if (code === 'KeyF') {
        if (this.hooks.hasNearShop()) {
          this.hooks.openNearestShop();
        } else {
          this.enterVehicleQueued = true;
        }
      } else if (code === 'KeyE') {
        this.enterVehicleQueued = true;
      } else if (code === 'Space') {
        this.jumpQueued = true;
      } else if (code === 'KeyO') {
        this.hooks.toggleVehicleDoors();
      } else if (code === 'KeyU') {
        this.hooks.toggleVehicleFrunk();
      } else if (code === 'KeyV') {
        this.hooks.cycleWeather();
      } else if (code === 'KeyT') {
        this.hooks.cycleTimePreset();
      } else if (code === 'KeyC') {
        this.hooks.cycleCameraMode();
      } else if (code === 'KeyM') {
        this.hooks.toggleMute();
      } else if (code === 'KeyR') {
        this.hooks.resetWorld();
      }
    }

    if (
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'Space'
    ) {
      e.preventDefault();
    }

    this.keysHeld.add(code);
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keysHeld.delete(e.code);
  };

  private handleWindowBlur = (): void => {
    this.clearTransientInput();
  };

  private handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.handleWindowBlur();
    }
  };

  public dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }
}
