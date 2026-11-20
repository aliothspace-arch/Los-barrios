import type {
  CameraMode,
  GamePhase,
  HUDState,
  PlayerOutfitId,
  RobberyDialogueLine,
  RobberyHUDState,
  RunSummary,
  ShopSpec,
  WeatherType,
} from '../types';

export interface TelemetrySlice {
  speedKmh: number;
  gear: string;
  rpmRatio: number;
  nitro: number;
  vehicleHealth: number;
  tractionSlip: boolean;
  absActive: boolean;
  shiftFlash: boolean;
  fps: number;
}

export interface PlayerHudSlice {
  cash: number;
  health: number;
  armor: number;
  wantedLevel: number;
  inVehicle: boolean;
  vehicleName: string;
  nearVehicleName: string | null;
  district: string;
  outfitId: PlayerOutfitId;
  checkpointsCleared: number;
  totalCheckpoints: number;
  objectiveLabel: string;
}

export interface WorldUiSlice {
  phase: GamePhase;
  weather: WeatherType;
  clockText: string;
  cameraMode: CameraMode;
  muted: boolean;
  bannerText: string | null;
  nearShop: ShopSpec | null;
  nearShopCooldown: number;
  activeShop: ShopSpec | null;
  activeShopCooldown: number;
  ambientDialogue: RobberyDialogueLine | null;
  touchControlsVisible: boolean;
  runSummary: RunSummary | null;
}

export interface ActivityHudSlice {
  robbery: RobberyHUDState | null;
}

type Listener = () => void;

function shallowEqualObject<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as Array<keyof T>;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (!Object.is(a[k], b[k])) return false;
  }
  return true;
}

function extractTelemetry(hud: HUDState): TelemetrySlice {
  return {
    speedKmh: hud.speedKmh,
    gear: hud.gear,
    rpmRatio: hud.rpmRatio,
    nitro: hud.nitro,
    vehicleHealth: hud.vehicleHealth,
    tractionSlip: hud.tractionSlip,
    absActive: hud.absActive,
    shiftFlash: hud.shiftFlash,
    fps: hud.fps,
  };
}

function extractPlayer(hud: HUDState): PlayerHudSlice {
  return {
    cash: hud.cash,
    health: hud.health,
    armor: hud.armor,
    wantedLevel: hud.wantedLevel,
    inVehicle: hud.inVehicle,
    vehicleName: hud.vehicleName,
    nearVehicleName: hud.nearVehicleName,
    district: hud.district,
    outfitId: hud.outfitId,
    checkpointsCleared: hud.checkpointsCleared,
    totalCheckpoints: hud.totalCheckpoints,
    objectiveLabel: hud.objectiveLabel,
  };
}

function extractWorldUi(hud: HUDState): WorldUiSlice {
  return {
    phase: hud.phase,
    weather: hud.weather,
    clockText: hud.clockText,
    cameraMode: hud.cameraMode,
    muted: hud.muted,
    bannerText: hud.bannerText,
    nearShop: hud.nearShop,
    nearShopCooldown: hud.nearShopCooldown,
    activeShop: hud.activeShop,
    activeShopCooldown: hud.activeShopCooldown,
    ambientDialogue: hud.ambientDialogue,
    touchControlsVisible: hud.touchControlsVisible,
    runSummary: hud.runSummary,
  };
}

function extractActivity(hud: HUDState): ActivityHudSlice {
  return {
    robbery: hud.robbery,
  };
}

/**
 * Selective external store compatible with React's `useSyncExternalStore`.
 * Isolates high-frequency vehicle telemetry (speed/RPM/nitro) from low-frequency
 * UI state (shops, pause modal, robbery overlay) so driving at 60 FPS never
 * triggers wasted React tree reconciliation in modals.
 */
export class GameHudStore {
  private fullHud: HUDState;
  private telemetry: TelemetrySlice;
  private player: PlayerHudSlice;
  private worldUi: WorldUiSlice;
  private activity: ActivityHudSlice;

  private readonly telemetryListeners = new Set<Listener>();
  private readonly playerListeners = new Set<Listener>();
  private readonly worldUiListeners = new Set<Listener>();
  private readonly activityListeners = new Set<Listener>();
  private readonly fullListeners = new Set<Listener>();

  constructor(initial: HUDState) {
    this.fullHud = initial;
    this.telemetry = extractTelemetry(initial);
    this.player = extractPlayer(initial);
    this.worldUi = extractWorldUi(initial);
    this.activity = extractActivity(initial);
  }

  public publish(next: HUDState): void {
    this.fullHud = next;

    const nextTelemetry = extractTelemetry(next);
    const nextPlayer = extractPlayer(next);
    const nextWorldUi = extractWorldUi(next);
    const nextActivity = extractActivity(next);

    let anyChanged = false;

    if (!shallowEqualObject(this.telemetry, nextTelemetry)) {
      this.telemetry = nextTelemetry;
      anyChanged = true;
      for (const l of this.telemetryListeners) l();
    }

    if (!shallowEqualObject(this.player, nextPlayer)) {
      this.player = nextPlayer;
      anyChanged = true;
      for (const l of this.playerListeners) l();
    }

    if (!shallowEqualObject(this.worldUi, nextWorldUi)) {
      this.worldUi = nextWorldUi;
      anyChanged = true;
      for (const l of this.worldUiListeners) l();
    }

    if (this.activity.robbery !== nextActivity.robbery) {
      this.activity = nextActivity;
      anyChanged = true;
      for (const l of this.activityListeners) l();
    }

    if (anyChanged) {
      for (const l of this.fullListeners) l();
    }
  }

  public getFullHud = (): HUDState => this.fullHud;
  public getTelemetry = (): TelemetrySlice => this.telemetry;
  public getPlayer = (): PlayerHudSlice => this.player;
  public getWorldUi = (): WorldUiSlice => this.worldUi;
  public getActivity = (): ActivityHudSlice => this.activity;

  public subscribeFull = (listener: Listener): (() => void) => {
    this.fullListeners.add(listener);
    return () => this.fullListeners.delete(listener);
  };

  public subscribeTelemetry = (listener: Listener): (() => void) => {
    this.telemetryListeners.add(listener);
    return () => this.telemetryListeners.delete(listener);
  };

  public subscribePlayer = (listener: Listener): (() => void) => {
    this.playerListeners.add(listener);
    return () => this.playerListeners.delete(listener);
  };

  public subscribeWorldUi = (listener: Listener): (() => void) => {
    this.worldUiListeners.add(listener);
    return () => this.worldUiListeners.delete(listener);
  };

  public subscribeActivity = (listener: Listener): (() => void) => {
    this.activityListeners.add(listener);
    return () => this.activityListeners.delete(listener);
  };
}
