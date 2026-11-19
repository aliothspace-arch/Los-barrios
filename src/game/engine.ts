import * as THREE from 'three';
import type {
  CameraMode,
  GamePhase,
  HUDState,
  PedState,
  PlayerOutfitId,
  PlayerState,
  RobberyActionType,
  RunSummary,
  ShopSpec,
  TimePreset,
  VehicleState,
  WeatherType,
} from './types';
import {
  buildStaticColliders,
  getDistrictName,
  INITIAL_PEDS,
  INITIAL_VEHICLES,
  PLAYER_SPAWN,
  SHOPS,
} from './worldLayout';
import { createVehicleState, findNearestEnterableVehicle } from './physics';
import { evaluateShopPurchase, findNearestShop } from './shopSystem';
import type { RobberyEvent, RobberySession } from './robberySystem';
import { RobberyInteriorStage } from './robberyScene';
import { createWeatherUniforms, HyperrealMaterialLibrary } from './textures';
import { DynamicWeatherAndLighting } from './weatherAndLighting';
import {
  applyTriCoatColor,
  buildCharacterRig,
  buildLosSantosWorld,
  buildVehicleRig,
  disposeCharacterRig,
  disposeMasterCharacterAssets,
  disposeVehicleCaches,
  disposeVehicleRig,
  warmMasterCharacterAssets,
  warmMasterHypercarAssets,
  type CharacterRig,
  type VehicleRig,
  type WorldVisuals,
} from './models';
import { ProceduralAudioEngine } from './audio';
import {
  resetYieldBudgetClock,
  yieldIfOverBudget,
  yieldToMainThread,
  type BootProgressListener,
  type BootProgressState,
} from './core/asyncBoot';
import { GameEventBus } from './core/eventBus';
import { ResourceScope } from './core/resourceScope';
import { SimulationClock } from './core/clock';
import { GameHudStore } from './core/gameStore';
import { getOutfitPalette, RESPRAY_PALETTE } from './data/outfits';
import { SpatialHashGrid } from './simulation/spatialHash';
import { stepOpenWorldSimulation } from './simulation/worldSimulation';
import {
  ActivityRegistry,
  type ActivityContext,
} from './simulation/activities/activityTypes';
import { CheckpointActivity } from './simulation/activities/checkpointActivity';
import { RobberyActivity } from './simulation/activities/robberyActivity';
import {
  InputController,
  type TouchControlState,
} from './input/inputController';
import { CameraController } from './camera/cameraController';
import { MinimapRenderer } from './hud/minimapRenderer';
import { ParticleSystem } from './entities/particleSystem';
import { EntityAnimator } from './entities/entityAnimator';
import { WebGLRenderContext } from './rendering/renderContext';

export type { TouchControlState, BootProgressState, BootProgressListener };

const WEATHER_ORDER: WeatherType[] = ['golden', 'clear', 'rain', 'storm', 'fog'];
const TIME_ORDER: TimePreset[] = ['sunset', 'noon', 'night', 'dawn'];

const WEATHER_LABELS: Record<WeatherType, string> = {
  golden: 'HORA DORADA CALIFORNIA',
  clear: 'DESPEJADO LOS SANTOS',
  rain: 'LLUVIA URBANA',
  storm: 'TORMENTA ELÉCTRICA',
  fog: 'NIEBLA COSTERA',
};

const TIME_LABELS: Record<TimePreset, string> = {
  sunset: 'ATARDECER DORADO',
  noon: 'MEDIODÍA SOLAR',
  night: 'NOCHE DE NEÓN',
  dawn: 'AMANECER CALIFORNIANO',
};

const CAMERA_LABELS: Record<CameraMode, string> = {
  chase: 'CÁMARA PERSECUCIÓN',
  cinematic: 'CÁMARA CINEMÁTICA',
  hood: 'CÁMARA CAPÓ / PRIMERA PERSONA',
};

function disposeUnsharedSubtree(root: THREE.Object3D): void {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  root.traverse((obj) => {
    const meshLike = obj as {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    if (meshLike.geometry && !meshLike.geometry.userData?.shared) {
      geos.add(meshLike.geometry);
    }
    if (meshLike.material) {
      const list = Array.isArray(meshLike.material)
        ? meshLike.material
        : [meshLike.material];
      for (const m of list) {
        if (m && !m.userData?.shared) {
          mats.add(m);
        }
      }
    }
  });
  for (const g of geos) g.dispose();
  for (const m of mats) m.dispose();
}

export interface EngineOptions {
  autostart?: boolean;
  forcedRobberyRoll?: number;
  spawnShopId?: string;
  onBootProgress?: BootProgressListener;
}

/**
 * Lean orchestration shell for San Andreas: Los Santos 3D.
 * Coordinates decoupled subsystems (WebGLRenderContext, CameraController,
 * InputController, WorldSimulation + SpatialHashGrid, ActivityRegistry,
 * EntityAnimator, ParticleSystem, MinimapRenderer, ResourceScope, GameHudStore)
 * with a non-blocking Progressive Async Boot Pipeline.
 */
export class SanAndreasEngine {
  public readonly hudStore: GameHudStore;

  private readonly container: HTMLElement;
  private readonly onHudUpdate?: (hud: HUDState) => void;
  private readonly onBootProgress?: BootProgressListener;
  private readonly options: EngineOptions;
  private readonly forcedRobberyRoll?: number;

  // Core Infrastructure
  private readonly eventBus = new GameEventBus();
  private readonly engineScope = new ResourceScope();
  private entityScope: ResourceScope;
  private readonly simClock = new SimulationClock(1 / 60, 0.05, 4);

  // Rendering & Presentation Subsystems (populated progressively during async boot)
  private readonly renderContext: WebGLRenderContext;
  private readonly scene: THREE.Scene;
  private readonly cameraController: CameraController;
  private materials!: HyperrealMaterialLibrary;
  private weatherSystem!: DynamicWeatherAndLighting;
  private readonly audio: ProceduralAudioEngine;
  private robberyStage!: RobberyInteriorStage;
  private particleSystem!: ParticleSystem;
  private readonly entityAnimator = new EntityAnimator();
  private readonly minimapRenderer = new MinimapRenderer();
  private inputController!: InputController;

  // World Static Visuals & Spatial Broad-Phase Grid
  private worldVisuals!: WorldVisuals;
  private readonly spatialGrid: SpatialHashGrid;

  // Pluggable Activities & Missions
  private readonly activityRegistry = new ActivityRegistry();
  private readonly checkpointActivity = new CheckpointActivity();
  private readonly robberyActivity: RobberyActivity;

  // Dynamic World Entities
  private player: PlayerState;
  private playerRig!: CharacterRig;
  private readonly vehicles: VehicleState[] = [];
  private readonly vehicleRigs = new Map<string, VehicleRig>();
  private readonly peds: PedState[] = [];
  private readonly pedRigs = new Map<string, CharacterRig>();
  private readonly pedShadowActive = new Map<string, boolean>();

  // Gameplay Session State
  private phase: GamePhase = 'title';
  private cash = 1250;
  private wantedLevel = 0;
  private peakWanted = 0;
  private wantedCooldown = 0;
  private distanceMeters = 0;
  private elapsedPlayTime = 0;
  private lastDistrict = 'GROVE STREET';
  private bannerText: string | null = null;
  private bannerTimer = 0;
  private runSummary: RunSummary | null = null;
  private activeShop: ShopSpec | null = null;
  private readonly shopCooldowns = new Map<string, number>();
  private resprayIndex = 0;
  private hitstopTimer = 0;

  // Loop, Boot & Responsive UI State
  private bootReady = false;
  private bootPromise: Promise<void> | null = null;
  private touchControlsVisible = false;
  private touchControlsManualOverride = false;
  private disposed = false;
  private frameHandle = 0;
  private lastFrameMs = 0;
  private hudEmitAccum = 0;
  private fpsSmoothed = 60;
  private frameCounter = 0;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    container: HTMLElement,
    onHudUpdate?: (hud: HUDState) => void,
    options: EngineOptions = {},
  ) {
    this.container = container;
    this.onHudUpdate = onHudUpdate;
    this.onBootProgress = options.onBootProgress;
    this.options = options;
    this.forcedRobberyRoll = options.forcedRobberyRoll;
    this.entityScope = this.engineScope.createChildScope();
    this.touchControlsVisible =
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth <= 960);

    // Lightweight immediate setup (< 8ms) so React can paint the Ciudad Rota loading screen on Frame 1
    this.renderContext = new WebGLRenderContext(container);
    this.scene = new THREE.Scene();
    const w = Math.max(1, container.clientWidth || window.innerWidth);
    const h = Math.max(1, container.clientHeight || window.innerHeight);
    this.cameraController = new CameraController(w / h);
    this.audio = new ProceduralAudioEngine();

    const colliders = buildStaticColliders();
    this.spatialGrid = new SpatialHashGrid(colliders, 16);

    this.robberyActivity = new RobberyActivity({
      onEvents: (events, session) => this.handleRobberySpecialEvents(events, session),
    });
    this.activityRegistry.register(this.checkpointActivity);
    this.activityRegistry.register(this.robberyActivity);

    this.player = this.createInitialPlayer();
    if (options.spawnShopId) {
      const targetShop = SHOPS.find((s) => s.id === options.spawnShopId);
      if (targetShop) {
        this.player.x = targetShop.x;
        this.player.z = targetShop.z;
      }
    }

    // Initialize HUD store immediately with safe initial snapshot
    this.hudStore = new GameHudStore({
      phase: 'title',
      cash: Math.round(this.cash),
      health: Math.round(this.player.health),
      armor: Math.round(this.player.armor),
      wantedLevel: 0,
      district: this.lastDistrict,
      weather: 'golden',
      timePreset: 'sunset',
      clockText: '18:20',
      cameraMode: this.cameraController.getMode(),
      inVehicle: false,
      vehicleName: '',
      speedKmh: 0,
      gear: '1',
      rpmRatio: 0,
      nitro: 100,
      vehicleHealth: 100,
      nearVehicleName: null,
      nearShop: null,
      activeShop: null,
      activeShopCooldown: 0,
      outfitId: this.player.outfitId,
      checkpointsCleared: 0,
      totalCheckpoints: 6,
      objectiveLabel: 'CRUCE DE GANTON BLVD',
      muted: this.audio.isMuted(),
      fps: 60,
      touchControlsVisible: this.touchControlsVisible,
      runSummary: null,
      bannerText: null,
      robbery: null,
    });
  }

  public isBootReady(): boolean {
    return this.bootReady;
  }

  private emitBootProgress(
    progress: number,
    stageIndex: number,
    stageTitle: string,
    stageDetail: string,
    ready = false,
  ): void {
    this.onBootProgress?.({
      ready,
      progress,
      stageIndex,
      totalStages: 6,
      stageTitle,
      stageDetail,
    });
  }

  /**
   * Executes the 6-stage non-blocking async boot sequence, yielding to the browser
   * main thread between every heavy procedural generation step so the LoadingScreen
   * renders smoothly with real-time progress.
   */
  public bootAsync(): Promise<void> {
    if (this.bootPromise) return this.bootPromise;
    this.bootPromise = this.runBootSequence();
    return this.bootPromise;
  }

  private async runBootSequence(): Promise<void> {
    const TOTAL_STAGES = 6;
    resetYieldBudgetClock();

    // Let React commit and paint the Ciudad Rota loading screen before any heavy CPU work
    this.emitBootProgress(
      8,
      1,
      'ETAPA 1/6 · CONTEXTO GRÁFICO HDR & POST-PROCESADO AGX',
      'Inicializando buffers Half-Float HDR, curva cinematográfica AgX y cámara orbital...',
      false,
    );
    await yieldToMainThread();
    if (this.disposed) return;

    // Stage 2: Procedural PBR Material Library & Hybrid 4-Point Automotive Studio PMREM
    this.emitBootProgress(
      22,
      2,
      'ETAPA 2/6 · TEXTURAS PBR PROCEDURALES & DOMO PMREM',
      'Sintetizando materiales de asfalto, arquitectura californiana y softboxes Gaussianos 3D...',
      false,
    );
    await yieldToMainThread();
    if (this.disposed) return;

    const uniforms = createWeatherUniforms();
    this.materials = new HyperrealMaterialLibrary(
      this.renderContext.renderer,
      this.renderContext.isSoftwareGl,
      uniforms,
    );
    await yieldToMainThread();
    if (this.disposed) return;

    this.weatherSystem = new DynamicWeatherAndLighting(
      this.scene,
      this.renderContext.renderer,
      uniforms,
      this.materials,
      this.renderContext.isSoftwareGl,
    );

    // Stage 3: Los Santos Districts, Botanical Palms & Interior-Mapped Architecture
    this.emitBootProgress(
      42,
      3,
      'ETAPA 3/6 · ARQUITECTURA DE LOS SANTOS & GROVE STREET',
      'Construyendo 52 edificios con interior-mapping 3D, palmeras californianas y mobiliario urbano...',
      false,
    );
    await yieldToMainThread();
    if (this.disposed) return;

    this.worldVisuals = buildLosSantosWorld(this.scene, this.materials);

    // Stage 4: Class-A Mid-Engine V12 Hypercar Parametric Surface Cache
    this.emitBootProgress(
      62,
      4,
      'ETAPA 4/6 · INGENIERÍA PARAMÉTRICA HYPERCAR V12 CLASS-A',
      'Evaluando superficies continuas C2, motor V12, puertas diédricas de mariposa y pintura Tri-Coat...',
      false,
    );
    await yieldToMainThread();
    if (this.disposed) return;

    warmMasterHypercarAssets(this.materials.anisotropy);
    await yieldToMainThread();
    if (this.disposed) return;

    // Stage 5: SMPL/FLAME Character Anatomy, CJ Protagonist, 26 Hypercars & 118 Pedestrians
    this.emitBootProgress(
      78,
      5,
      'ETAPA 5/6 · ANATOMÍA SMPL/FLAME, FLOTA V12 & TRÁFICO IA',
      'Esculpiendo morfología facial FLAME, protagonista CJ, 26 Hypercars y 118 ciudadanos...',
      false,
    );
    await yieldToMainThread();
    if (this.disposed) return;

    warmMasterCharacterAssets(this.materials);
    await yieldToMainThread();
    if (this.disposed) return;

    const classicOutfit = getOutfitPalette('classic_cj');
    this.playerRig = buildCharacterRig(this.materials, {
      shirtHex: classicOutfit.shirt,
      pantsHex: classicOutfit.pants,
      skinHex: 0x6b4530,
      shoeHex: 0xbab8b0,
      isProtagonist: true,
    });
    this.scene.add(this.playerRig.root);
    this.robberyStage = new RobberyInteriorStage(this.scene, this.materials);
    this.particleSystem = new ParticleSystem(this.scene, 160);
    this.bindEventBus();

    await this.initEntitiesAsync((entityRatio) => {
      const pct = Math.round(80 + entityRatio * 12);
      this.emitBootProgress(
        pct,
        5,
        'ETAPA 5/6 · DESPLEGANDO FLOTA V12 & CIUDADANOS EN LOS SANTOS',
        `Instanciando vehículos articulados y peatones con IA (${Math.round(entityRatio * 100)}%)...`,
        false,
      );
    });
    if (this.disposed) return;

    this.activityRegistry.startActivity(
      this.checkpointActivity.id,
      undefined,
      this.buildActivityContext(),
    );
    this.syncCheckpointVisual();

    // Stage 6: Input Controllers, Async GPU Shader Pre-Compilation & First Frame Render
    this.emitBootProgress(
      95,
      TOTAL_STAGES,
      'ETAPA 6/6 · COMPILACIÓN ASÍNCRONA DE SHADERS GPU',
      'Pre-compilando programas GLSL PBR y sincronizando iluminación de estudio 4 puntos...',
      false,
    );
    await yieldToMainThread();
    if (this.disposed) return;

    this.inputController = new InputController({
      getPhase: () => this.phase,
      hasActiveShop: () => this.activeShop !== null,
      getRobberySession: () => this.robberyActivity.currentSession,
      hasNearShop: () => this.findNearbyShop() !== null,
      unlockAudio: () => this.audio.unlock(),
      startGame: () => this.startGame(),
      closeShop: () => this.closeShop(),
      togglePause: () => this.togglePause(),
      toggleMute: () => this.toggleMute(),
      openNearestShop: () => this.openNearestShop(),
      cycleWeather: () => this.cycleWeather(),
      cycleTimePreset: () => this.cycleTimePreset(),
      cycleCameraMode: () => this.cycleCameraMode(),
      resetWorld: () => this.resetWorld(),
      toggleVehicleDoors: () => this.toggleVehicleDoors(),
      toggleVehicleFrunk: () => this.toggleVehicleFrunk(),
      triggerRobberyAction: (action) => this.triggerRobberyAction(action),
    });

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    this.registerEngineDisposables();

    // Use non-blocking compileAsync when running on hardware GPU
    if (!this.renderContext.isSoftwareGl) {
      const rendererWithAsync = this.renderContext.renderer as THREE.WebGLRenderer & {
        compileAsync?: (scene: THREE.Object3D, camera: THREE.Camera) => Promise<unknown>;
      };
      if (typeof rendererWithAsync.compileAsync === 'function') {
        await rendererWithAsync.compileAsync(this.scene, this.cameraController.camera);
      } else {
        this.renderContext.renderer.compile(this.scene, this.cameraController.camera);
      }
    }
    if (this.disposed) return;

    this.installTestHook();

    if (this.options.autostart) {
      this.startGame();
    } else {
      this.setPhase('title');
    }

    this.bootReady = true;
    this.lastFrameMs = performance.now();
    this.emitHud();
    this.emitBootProgress(
      100,
      TOTAL_STAGES,
      'LOS SANTOS 3D · LISTO',
      'Motor gráfico 3D inicializado.',
      true,
    );

    this.frameHandle = this.renderContext.isSoftwareGl
      ? window.setTimeout(this.tick, 16)
      : requestAnimationFrame(this.tick);
  }

  private installTestHook(): void {
    if (typeof window === 'undefined') return;
    (window as unknown as Record<string, unknown>).__SA_ENGINE_TEST__ = {
      isBootReady: () => this.bootReady,
      getMemory: () => this.getMemorySnapshot(),
      resetWorld: () => this.resetWorld(),
      getPhase: () => this.phase,
      getVehicleCount: () => this.vehicles.length,
      getPedCount: () => this.peds.length,
      getPlayerState: () => ({
        x: this.player.x,
        z: this.player.z,
        inVehicleId: this.player.inVehicleId,
        cash: this.cash,
      }),
      enterNearestVehicle: () => {
        const near = findNearestEnterableVehicle(this.player.x, this.player.z, this.vehicles, 12);
        if (!near) return null;
        near.driver = 'player';
        this.player.inVehicleId = near.id;
        this.playerRig.root.visible = false;
        near.speed = 24;
        near.vz = -24;
        near.gear = 3;
        near.rpm = 4800;
        this.emitHud();
        return near.id;
      },
      openShopById: (shopId: string) => {
        const shop = SHOPS.find((s) => s.id === shopId);
        if (!shop) return false;
        this.player.x = shop.x;
        this.player.z = shop.z;
        this.activeShop = shop;
        this.emitHud();
        return true;
      },
      robActiveShop: () => {
        this.robActiveShop();
        const nowSec = performance.now() * 0.001;
        const robberySession = this.robberyActivity.currentSession;
        if (robberySession) {
          this.robberyStage.updateVisuals(robberySession, 0.016, nowSec);
          this.cameraController.update({
            dt: 0.016,
            nowSec,
            phase: this.phase,
            player: this.player,
            activeCar: this.getActivePlayerVehicle(),
            robberySession,
            robberyStage: this.robberyStage,
          });
          this.renderCurrentFrame(nowSec);
        }
        return Boolean(robberySession);
      },
      toggleVehicleDoors: () => this.toggleVehicleDoors(),
      toggleVehicleFrunk: () => this.toggleVehicleFrunk(),
    };
  }

  private registerEngineDisposables(): void {
    this.engineScope.trackCleanup(() => {
      if (typeof window !== 'undefined') {
        delete (window as unknown as Record<string, unknown>).__SA_ENGINE_TEST__;
      }
    });
    this.engineScope.trackCleanup(() => {
      this.resizeObserver?.disconnect();
    });
    if (this.inputController) this.engineScope.track(this.inputController);
    this.engineScope.track(this.minimapRenderer);
    this.engineScope.track(this.audio);
    if (this.robberyStage) this.engineScope.track(this.robberyStage);
    if (this.particleSystem) this.engineScope.track(this.particleSystem);
    if (this.playerRig) {
      this.engineScope.trackCleanup(() => {
        disposeCharacterRig(this.playerRig, true);
      });
    }
    if (this.worldVisuals) {
      this.engineScope.trackCleanup(() => {
        const dustMat = this.worldVisuals.dustMotes.material as THREE.PointsMaterial;
        dustMat.map?.dispose();
        disposeUnsharedSubtree(this.worldVisuals.worldGroup);
        this.worldVisuals.worldGroup.removeFromParent();
      });
    }
    if (this.weatherSystem) this.engineScope.track(this.weatherSystem);
    this.engineScope.trackCleanup(() => {
      disposeMasterCharacterAssets();
      disposeVehicleCaches();
    });
    if (this.materials) this.engineScope.track(this.materials);
    this.engineScope.track(this.renderContext);
  }

  private bindEventBus(): void {
    this.eventBus.on('banner:show', ({ text, duration }) => {
      this.showBanner(text, duration);
    });

    this.eventBus.on('camera:trauma', ({ amount }) => {
      this.cameraController.addTrauma(amount);
    });

    this.eventBus.on('crime:wanted', ({ targetLevel }) => {
      this.raiseWantedLevel(targetLevel);
    });

    this.eventBus.on('player:damage', ({ amount }) => {
      this.applyPlayerDamage(amount);
    });

    this.eventBus.on('particle:burst', ({ x, y, z, count, kind }) => {
      this.particleSystem.spawnBurst(x, y, z, count, kind);
    });

    this.eventBus.on('player:cash', ({ delta, reason }) => {
      this.cash = Math.max(0, this.cash + delta);
      if (reason && reason.startsWith('checkpoint:')) {
        this.player.health = Math.min(100, this.player.health + 15);
        const activeCar = this.getActivePlayerVehicle();
        if (activeCar) {
          activeCar.nitro = 100;
          activeCar.health = Math.min(100, activeCar.health + 25);
        }
        this.particleSystem.spawnBurst(this.player.x, 1.5, this.player.z, 22, 'spark');
        this.syncCheckpointVisual();
        const nextCp = this.checkpointActivity.getCurrentCheckpoint();
        if (nextCp) {
          this.showBanner(`+$${delta} · SIGUIENTE: ${nextCp.label}`, 2.6);
        }
        this.emitHud();
      }
    });

    this.eventBus.on('activity:ended', ({ activityId, completed }) => {
      if (activityId === this.checkpointActivity.id && completed) {
        this.cash += 2500;
        this.showBanner('¡MISIÓN COMPLETADA! +$2500', 3.0);
        this.syncCheckpointVisual();
        this.triggerGameOver('victory');
      }
    });

    this.eventBus.on('sfx:play', (ev) => {
      switch (ev.kind) {
        case 'impact':
          this.audio.playImpact(ev.intensity);
          break;
        case 'door':
          this.audio.playDoorThud();
          break;
        case 'checkpoint':
          this.audio.playCheckpoint();
          break;
        case 'cash':
          this.audio.playCashRegister();
          break;
        case 'robbery_alarm':
          this.audio.playRobberyAlarm();
          break;
        case 'robbery_sfx':
          this.playRobberySfx(ev.sfx);
          break;
        default:
          break;
      }
    });
  }

  private playRobberySfx(sfx: string): void {
    switch (sfx) {
      case 'door_chime':
        this.audio.playDoorChime();
        break;
      case 'register_keys':
        this.audio.playRegisterKeys();
        break;
      case 'drawer_pop':
        this.audio.playDrawerPop();
        break;
      case 'cash_rustle':
        this.audio.playCashRustle();
        break;
      case 'bag_zip':
        this.audio.playBagZip();
        break;
      case 'bat_whoosh':
        this.audio.playBatWhoosh();
        break;
      case 'bat_crack':
        this.audio.playBatCrack();
        break;
      case 'punch_impact':
        this.audio.playPunchImpact();
        break;
      case 'dodge_whoosh':
        this.audio.playDodgeWhoosh();
        break;
      case 'qte_success':
        this.audio.playQteSuccess();
        break;
      case 'qte_fail':
        this.audio.playQteFail();
        break;
      case 'alarm':
        this.audio.playRobberyAlarm();
        break;
    }
  }

  private buildActivityContext(): ActivityContext {
    return {
      eventBus: this.eventBus,
      simTimeSec: this.simClock.timeSec,
      getPlayerPosition: () => ({
        x: this.player.x,
        z: this.player.z,
        inVehicle: this.player.inVehicleId !== null,
      }),
      getPlayerHealth: () => this.player.health,
      getPlayerOutfit: () => this.player.outfitId,
    };
  }

  private createInitialPlayer(): PlayerState {
    return {
      x: PLAYER_SPAWN.x,
      y: 0,
      z: PLAYER_SPAWN.z,
      vx: 0,
      vy: 0,
      vz: 0,
      heading: PLAYER_SPAWN.heading,
      grounded: true,
      coyoteTimer: 0.1,
      jumpBufferTimer: 0,
      walkCycle: 0,
      sprinting: false,
      health: 100,
      armor: 60,
      inVehicleId: null,
      attackTimer: 0,
      damageFlash: 0,
      outfitId: 'classic_cj',
    };
  }

  private applyPlayerOutfit(outfitId: PlayerOutfitId): void {
    this.player.outfitId = outfitId;
    const palette = getOutfitPalette(outfitId);
    this.playerRig.shirtMat.color.setHex(palette.shirt);
    this.playerRig.pantsMat.color.setHex(palette.pants);
  }

  private initEntities(): void {
    this.clearEntityContainers();
    for (const spawn of INITIAL_VEHICLES) {
      this.spawnSingleVehicle(spawn);
    }
    for (let idx = 0; idx < INITIAL_PEDS.length; idx++) {
      this.spawnSinglePed(INITIAL_PEDS[idx], idx);
    }
  }

  private async initEntitiesAsync(onProgress?: (ratio: number) => void): Promise<void> {
    this.clearEntityContainers();
    const totalCount = INITIAL_VEHICLES.length + INITIAL_PEDS.length;
    let completed = 0;

    for (let i = 0; i < INITIAL_VEHICLES.length; i++) {
      if (this.disposed) return;
      this.spawnSingleVehicle(INITIAL_VEHICLES[i]);
      completed++;
      if (i % 6 === 5) {
        onProgress?.(completed / totalCount);
        await yieldIfOverBudget(10);
      }
    }

    for (let idx = 0; idx < INITIAL_PEDS.length; idx++) {
      if (this.disposed) return;
      this.spawnSinglePed(INITIAL_PEDS[idx], idx);
      completed++;
      if (idx % 24 === 23) {
        onProgress?.(completed / totalCount);
        await yieldIfOverBudget(10);
      }
    }
    onProgress?.(1);
  }

  private clearEntityContainers(): void {
    this.entityScope.dispose();
    this.entityScope = this.engineScope.createChildScope();
    this.vehicleRigs.clear();
    this.vehicles.length = 0;
    this.pedRigs.clear();
    this.pedShadowActive.clear();
    this.peds.length = 0;
  }

  private spawnSingleVehicle(spawn: (typeof INITIAL_VEHICLES)[number]): void {
    const st = createVehicleState(
      spawn.id,
      spawn.kind,
      spawn.x,
      spawn.z,
      spawn.heading,
      spawn.driver,
      spawn.waypointIndex ?? 0,
      spawn.customPaintHex,
      spawn.routeLoop ?? 0,
    );
    this.vehicles.push(st);
    const rig = buildVehicleRig(st.spec, this.materials, spawn.customPaintHex);
    rig.root.position.set(st.x, 0, st.z);
    rig.root.rotation.y = st.heading;
    this.scene.add(rig.root);
    this.vehicleRigs.set(st.id, rig);
    this.entityScope.trackCleanup(() => disposeVehicleRig(rig));
  }

  private spawnSinglePed(p: (typeof INITIAL_PEDS)[number], idx: number): void {
    const span = p.walkSpan ?? 9.5;
    const initDir = idx % 2 === 0 ? 1 : -1;
    const initialTargetX =
      p.walkAxis === 'x' ? p.x + initDir * span : p.walkAxis === 'z' ? p.x : p.x + 3.5;
    const initialTargetZ =
      p.walkAxis === 'z' ? p.z + initDir * span : p.walkAxis === 'x' ? p.z : p.z + 2;
    const initialHeading =
      p.faceAngle !== undefined
        ? p.faceAngle
        : p.walkAxis === 'x'
          ? initDir > 0
            ? Math.PI * 0.5
            : -Math.PI * 0.5
          : p.walkAxis === 'z'
            ? initDir > 0
              ? 0
              : Math.PI
            : 0;

    const state: PedState = {
      id: p.id,
      role: p.role,
      x: p.x,
      z: p.z,
      vx: 0,
      vz: 0,
      heading: initialHeading,
      walkCycle: (idx * 1.37) % (Math.PI * 2),
      health: 100,
      state: 'walk',
      stateTimer: 0,
      homeX: p.x,
      homeZ: p.z,
      targetX: initialTargetX,
      targetZ: initialTargetZ,
      shirtColor: p.shirt,
      pantsColor: p.pants,
      skinTone: p.skin,
      hatColor: p.hatColor,
      koTimer: 0,
      hitFlash: 0,
      activity: p.activity,
      walkAxis: p.walkAxis,
      walkSpan: p.walkSpan,
      faceAngle: p.faceAngle,
    };
    this.peds.push(state);

    const rig = buildCharacterRig(this.materials, {
      shirtHex: p.shirt,
      pantsHex: p.pants,
      skinHex: p.skin,
      hatColor: p.hatColor,
      isRival: p.role === 'ballas',
      isPolice: p.role === 'police_foot',
      hasBackpack: p.hasBackpack,
      hasShades: p.hasShades,
      heightScale: p.heightScale,
    });
    rig.root.position.set(p.x, 0, p.z);
    rig.root.rotation.y = initialHeading;

    const startDistSq = (p.x - PLAYER_SPAWN.x) ** 2 + (p.z - PLAYER_SPAWN.z) ** 2;
    const castNow = startDistSq < 1156;
    rig.root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh && obj.name !== 'contact_shadow') {
        obj.castShadow = castNow;
      }
    });
    this.pedShadowActive.set(p.id, castNow);
    this.scene.add(rig.root);
    this.pedRigs.set(p.id, rig);
    this.entityScope.trackCleanup(() => disposeCharacterRig(rig, false));
  }

  public getMemorySnapshot(): { geometries: number; textures: number; programs: number } {
    return this.renderContext.getMemorySnapshot();
  }

  public setMinimapCanvas(canvas: HTMLCanvasElement | null): void {
    this.minimapRenderer.setCanvas(canvas);
  }

  public setPhase(next: GamePhase): void {
    this.phase = next;
    document.body.dataset.state = next;
    if (next === 'paused' || next === 'gameover' || next === 'title') {
      this.inputController?.clearTransientInput();
      this.audio.silenceLoops();
      if (document.pointerLockElement) {
        document.exitPointerLock?.();
      }
    }
    this.emitHud();
  }

  public startGame(): void {
    if (!this.bootReady && this.bootPromise) {
      this.options.autostart = true;
      return;
    }
    this.audio.unlock();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    this.inputController?.clearTransientInput();

    if (this.phase === 'gameover') {
      this.resetWorld();
    }

    this.cameraController.snapBehind(
      this.player.heading,
      this.player.x,
      this.player.y,
      this.player.z,
      7.5,
    );
    this.showBanner('GROVE STREET · LOS SANTOS', 2.8);
    this.setPhase('playing');
  }

  public resetWorld(): void {
    if (!this.bootReady) return;
    this.abortRobberyIfActive();
    this.simClock.reset();
    this.player = this.createInitialPlayer();
    this.applyPlayerOutfit('classic_cj');
    this.cash = 1250;
    this.wantedLevel = 0;
    this.peakWanted = 0;
    this.wantedCooldown = 0;
    this.distanceMeters = 0;
    this.elapsedPlayTime = 0;
    this.hitstopTimer = 0;
    this.lastDistrict = 'GROVE STREET';
    this.runSummary = null;
    this.activeShop = null;
    this.shopCooldowns.clear();

    this.initEntities();
    this.activityRegistry.cancelAll(this.buildActivityContext());
    this.activityRegistry.startActivity(
      this.checkpointActivity.id,
      undefined,
      this.buildActivityContext(),
    );
    this.syncCheckpointVisual();

    this.cameraController.resetTrauma();
    this.cameraController.snapBehind(
      this.player.heading,
      this.player.x,
      this.player.y,
      this.player.z,
      7.5,
    );
    this.playerRig.root.visible = true;
    this.playerRig.root.position.set(this.player.x, 0, this.player.z);
    this.playerRig.root.rotation.y = this.player.heading;
    this.showBanner('GROVE STREET · LOS SANTOS', 2.4);
    this.setPhase('playing');
  }

  public togglePause(): void {
    if (!this.bootReady) return;
    if (this.phase === 'playing') {
      this.setPhase('paused');
    } else if (this.phase === 'paused') {
      this.audio.unlock();
      this.setPhase('playing');
    }
  }

  public returnToTitle(): void {
    if (!this.bootReady) return;
    this.resetWorld();
    this.setPhase('title');
  }

  public cycleWeather(): void {
    if (!this.bootReady || !this.weatherSystem) return;
    const idx = WEATHER_ORDER.indexOf(this.weatherSystem.getWeather());
    this.setWeather(WEATHER_ORDER[(idx + 1) % WEATHER_ORDER.length]);
  }

  public setWeather(w: WeatherType): void {
    if (!this.bootReady || !this.weatherSystem) return;
    this.weatherSystem.setWeather(w);
    this.eventBus.emit('weather:changed', { weather: w });
    this.showBanner(`CLIMA: ${WEATHER_LABELS[w]}`, 2.2);
    this.emitHud();
  }

  public cycleTimePreset(): void {
    if (!this.bootReady || !this.weatherSystem) return;
    const idx = TIME_ORDER.indexOf(this.weatherSystem.getTimePreset());
    const next = TIME_ORDER[(idx + 1) % TIME_ORDER.length];
    this.weatherSystem.setTimePreset(next);
    this.showBanner(`HORA: ${TIME_LABELS[next]}`, 2.2);
    this.emitHud();
  }

  public cycleCameraMode(): void {
    const next = this.cameraController.cycleMode();
    this.showBanner(CAMERA_LABELS[next], 1.8);
    this.emitHud();
  }

  public toggleMute(): void {
    this.audio.unlock();
    this.audio.setMuted(!this.audio.isMuted());
    this.emitHud();
  }

  public toggleTouchControls(): void {
    this.touchControlsManualOverride = true;
    this.touchControlsVisible = !this.touchControlsVisible;
    this.emitHud();
  }

  public setTouchState(partial: Partial<TouchControlState>): void {
    this.audio.unlock();
    this.inputController.setTouchState(partial);
  }

  public triggerEnterOrExitVehicle(): void {
    this.audio.unlock();
    this.inputController.queueEnterOrExitVehicle();
  }

  public triggerJumpOrAction(): void {
    this.audio.unlock();
    this.inputController.queueJumpOrAction();
  }

  private getTargetHypercarForArticulation(): VehicleState | null {
    return (
      this.getActivePlayerVehicle() ??
      findNearestEnterableVehicle(this.player.x, this.player.z, this.vehicles, 7.5)
    );
  }

  public toggleVehicleDoors(): void {
    if (this.phase !== 'playing') return;
    this.audio.unlock();
    const targetCar = this.getTargetHypercarForArticulation();
    if (!targetCar) {
      this.showBanner('ACÉRCATE A UN HYPERCAR PARA ABRIR LAS PUERTAS [O]', 1.8);
      this.emitHud();
      return;
    }
    const rig = this.vehicleRigs.get(targetCar.id);
    if (!rig) return;
    const hc = rig.hypercar;
    const nextOpen = hc.doorL.target < 0.5 || hc.doorR.target < 0.5 ? 1 : 0;
    hc.doorL.target = nextOpen;
    hc.doorR.target = nextOpen;
    hc.autoCloseTimer = 0;
    hc.pulseTime = 0;
    this.audio.playDoorThud();
    this.showBanner(
      nextOpen
        ? `${targetCar.spec.name.toUpperCase()} · PUERTAS DIÉDRICAS ABIERTAS`
        : `${targetCar.spec.name.toUpperCase()} · PUERTAS DIÉDRICAS CERRADAS`,
      2.0,
    );
    this.emitHud();
  }

  public toggleVehicleFrunk(): void {
    if (this.phase !== 'playing') return;
    this.audio.unlock();
    const targetCar = this.getTargetHypercarForArticulation();
    if (!targetCar) {
      this.showBanner('ACÉRCATE A UN HYPERCAR PARA ABRIR EL CAPÓ FRUNK [U]', 1.8);
      this.emitHud();
      return;
    }
    const rig = this.vehicleRigs.get(targetCar.id);
    if (!rig) return;
    const hc = rig.hypercar;
    const nextOpen = hc.frunk.target < 0.5 ? 1 : 0;
    hc.frunk.target = nextOpen;
    hc.pulseTime = 0;
    this.audio.playDoorThud();
    this.showBanner(
      nextOpen
        ? `${targetCar.spec.name.toUpperCase()} · MALETERO FRUNK ABIERTO (44°)`
        : `${targetCar.spec.name.toUpperCase()} · MALETERO FRUNK CERRADO`,
      2.0,
    );
    this.emitHud();
  }

  public addCameraOrbit(dx: number, dy: number): void {
    this.inputController.addOrbitDelta(dx, dy);
  }

  public setCameraOrbitActive(active: boolean): void {
    this.cameraController.setOrbitActive(active);
  }

  private findNearbyShop(): ShopSpec | null {
    const range = this.player.inVehicleId ? 9.5 : 7.0;
    return findNearestShop(this.player.x, this.player.z, SHOPS, range);
  }

  public openNearestShop(): void {
    if (this.phase !== 'playing') return;
    this.audio.unlock();
    const near = this.findNearbyShop();
    if (!near) return;
    this.activeShop = near;
    this.inputController.clearTransientInput();
    this.audio.silenceLoops();
    this.emitHud();
  }

  public closeShop(): void {
    if (!this.activeShop) return;
    this.activeShop = null;
    this.emitHud();
  }

  public buyShopItem(itemId: string): void {
    if (!this.activeShop) return;
    this.audio.unlock();
    const item = this.activeShop.items.find((i) => i.id === itemId);
    if (!item) return;

    const activeCar = this.getActivePlayerVehicle();
    const result = evaluateShopPurchase(item, {
      cash: Math.round(this.cash),
      health: this.player.health,
      armor: this.player.armor,
      inVehicle: Boolean(activeCar),
      vehicleHealth: activeCar ? activeCar.health : 100,
      vehicleNitro: activeCar ? activeCar.nitro : 100,
      outfitId: this.player.outfitId,
    });

    if (!result.ok) {
      this.showBanner(result.message, 2.2);
      this.emitHud();
      return;
    }

    this.cash = Math.max(0, this.cash + result.cashDelta);
    if (result.health !== undefined) this.player.health = result.health;
    if (result.armor !== undefined) this.player.armor = result.armor;
    if (result.outfitId !== undefined) this.applyPlayerOutfit(result.outfitId);
    if (activeCar) {
      if (result.vehicleHealth !== undefined) activeCar.health = result.vehicleHealth;
      if (result.vehicleNitro !== undefined) activeCar.nitro = result.vehicleNitro;
      if (result.resprayVehicle) {
        const nextHex = RESPRAY_PALETTE[this.resprayIndex % RESPRAY_PALETTE.length];
        this.resprayIndex++;
        activeCar.customPaintHex = nextHex;
        const activeRig = this.vehicleRigs.get(activeCar.id);
        if (activeRig) {
          applyTriCoatColor(activeRig.paintMat, nextHex);
        }
        this.wantedLevel = Math.max(0, this.wantedLevel - 2);
      }
    }

    this.audio.playCashRegister();
    this.showBanner(result.message, 2.6);
    this.emitHud();
  }

  private abortRobberyIfActive(): void {
    if (!this.robberyActivity.isActive) return;
    this.robberyActivity.cancel(this.buildActivityContext());
    this.robberyStage.deactivate();
    this.audio.cancelSpeech();
  }

  public robActiveShop(): void {
    if (!this.activeShop || this.robberyActivity.isActive) return;
    this.audio.unlock();
    const shop = this.activeShop;
    const cd = this.shopCooldowns.get(shop.id) ?? 0;
    if (cd > 0) {
      this.showBanner(`Caja vacía · Espera ${Math.ceil(cd)}s`, 2.2);
      this.emitHud();
      return;
    }

    // Park player car outside cleanly before entering interior robbery stage
    if (this.player.inVehicleId) {
      const car = this.getActivePlayerVehicle();
      if (car) {
        car.driver = 'none';
        car.speed = 0;
        car.vx = 0;
        car.vz = 0;
      }
      this.player.inVehicleId = null;
      this.playerRig.root.visible = true;
      this.player.x = shop.x;
      this.player.z = shop.z;
    }

    this.activeShop = null;
    this.inputController.clearTransientInput();
    this.audio.silenceLoops();

    const started = this.activityRegistry.startActivity(
      this.robberyActivity.id,
      { shop, forcedOutcomeRoll: this.forcedRobberyRoll },
      this.buildActivityContext(),
    );
    if (started && this.robberyActivity.currentSession) {
      const session = this.robberyActivity.currentSession;
      const nowSec = performance.now() * 0.001;
      this.robberyStage.activateForSession(
        session,
        this.player.outfitId,
        this.scene.environment,
      );
      this.robberyStage.updateVisuals(session, 0.016, nowSec);
      this.cameraController.update({
        dt: 0.016,
        nowSec,
        phase: this.phase,
        player: this.player,
        activeCar: null,
        robberySession: session,
        robberyStage: this.robberyStage,
      });
    }
    this.emitHud();
  }

  public triggerRobberyAction(action: RobberyActionType): void {
    if (!this.robberyActivity.isActive || this.phase !== 'playing') return;
    this.audio.unlock();
    this.activityRegistry.dispatchAction(
      this.robberyActivity.id,
      action,
      this.buildActivityContext(),
    );
    this.emitHud();
  }

  private handleRobberySpecialEvents(
    events: RobberyEvent[],
    session: RobberySession,
  ): void {
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'dialogue' && ev.dialogue) {
        this.audio.speakDialogue(ev.dialogue.text, ev.dialogue.pitch, ev.dialogue.rate);
      } else if (ev.type === 'hitstop' && ev.amount) {
        this.hitstopTimer = Math.max(this.hitstopTimer, ev.amount);
      } else if (ev.type === 'bill_burst' && ev.amount) {
        this.robberyStage.spawnBillBurst(ev.amount);
      } else if (ev.type === 'completed') {
        this.completeRobberySession(ev, session);
      }
    }
  }

  private completeRobberySession(ev: RobberyEvent, session: RobberySession): void {
    const shop = session.shop;
    const payout = Math.max(0, Math.round(ev.payout ?? session.bagCash));
    const stars = Math.min(5, Math.max(1, ev.wantedStars ?? shop.robWantedStars));

    this.robberyStage.deactivate();
    this.audio.cancelSpeech();

    this.cash += payout;
    this.shopCooldowns.set(shop.id, 45);
    this.raiseWantedLevel(Math.max(this.wantedLevel + 1, stars));

    this.player.x = shop.x;
    this.player.z = shop.z;
    this.player.y = 0;
    this.player.vx = 0;
    this.player.vz = 0;
    this.playerRig.root.visible = true;
    this.playerRig.root.position.set(this.player.x, 0, this.player.z);
    this.cameraController.snapBehind(
      this.player.heading,
      this.player.x,
      this.player.y,
      this.player.z,
      5.6,
    );

    this.particleSystem.spawnBurst(shop.x, 1.4, shop.z, 18, 'spark');
    if (payout > 0) {
      this.showBanner(`¡BOTÍN EN ${shop.name}! +$${payout} · ¡HUYE DE LA LSPD!`, 3.4);
    } else {
      this.showBanner(`¡ESCAPASTE DE ${shop.name}! · ¡LA LSPD VIENE!`, 3.2);
    }

    for (const ped of this.peds) {
      if (ped.role === 'clerk' && Math.hypot(ped.x - shop.x, ped.z - shop.z) < 12) {
        ped.state = ev.clerkKo ? 'ko' : 'flee';
        ped.stateTimer = 7.0;
      }
    }
    this.emitHud();
  }

  private showBanner(text: string, duration = 2.4): void {
    this.bannerText = text;
    this.bannerTimer = duration;
  }

  private syncCheckpointVisual(): void {
    const active = this.checkpointActivity.getCurrentCheckpoint();
    if (active) {
      this.worldVisuals.checkpointGroup.visible = true;
      this.worldVisuals.checkpointGroup.position.set(active.x, 0, active.z);
    } else {
      this.worldVisuals.checkpointGroup.visible = false;
    }
  }

  private raiseWantedLevel(targetLevel: number): void {
    const clamped = Math.min(5, Math.max(this.wantedLevel, targetLevel));
    if (clamped > this.wantedLevel) {
      this.wantedLevel = clamped;
      this.peakWanted = Math.max(this.peakWanted, clamped);
      this.showBanner(`NIVEL DE BÚSQUEDA ★ ${clamped}`, 2.0);
    }
    this.wantedCooldown = 28;
  }

  private applyPlayerDamage(amount: number): void {
    if (this.phase !== 'playing') return;
    let remaining = amount;
    if (this.player.armor > 0) {
      const absorbed = Math.min(this.player.armor, remaining * 0.7);
      this.player.armor -= absorbed;
      remaining -= absorbed;
    }
    this.player.health = Math.max(0, this.player.health - remaining);
    this.player.damageFlash = 0.25;
    this.cameraController.addTrauma(0.45);
    this.audio.playImpact(0.8);

    if (this.player.health <= 0) {
      this.triggerGameOver('wasted');
    }
  }

  private triggerGameOver(outcome: 'wasted' | 'victory'): void {
    this.abortRobberyIfActive();
    const cpHud = this.checkpointActivity.getHudSlice();
    this.runSummary = {
      outcome,
      cash: Math.round(this.cash),
      checkpointsCleared: cpHud.cleared,
      totalCheckpoints: cpHud.total,
      distanceKm: Number((this.distanceMeters / 1000).toFixed(2)),
      peakWanted: this.peakWanted,
      timeSeconds: Math.round(this.elapsedPlayTime),
    };
    if (outcome === 'wasted') {
      this.audio.playWastedSting();
    } else {
      this.audio.playCheckpoint();
    }
    this.setPhase('gameover');
  }

  private getActivePlayerVehicle(): VehicleState | null {
    if (!this.player.inVehicleId) return null;
    for (let i = 0; i < this.vehicles.length; i++) {
      if (this.vehicles[i].id === this.player.inVehicleId) {
        return this.vehicles[i];
      }
    }
    return null;
  }

  private stepSimulation(dt: number): void {
    // Tick down shop robbery cooldowns
    for (const [id, secs] of this.shopCooldowns.entries()) {
      if (secs > dt) {
        this.shopCooldowns.set(id, secs - dt);
      } else {
        this.shopCooldowns.delete(id);
      }
    }

    const input = this.inputController.sampleInput();
    this.elapsedPlayTime += dt;

    // Exclusive Activity Branch (e.g. Interactive 3D Store Robbery)
    if (this.activityRegistry.hasExclusiveActive()) {
      this.activityRegistry.updateAll(dt, input, this.buildActivityContext());
      this.audio.updateContinuous({
        inVehicle: false,
        rpm: 900,
        throttle: 0,
        nitroActive: false,
        skidIntensity: 0,
        weather: 'clear',
        sirenIntensity: this.wantedLevel > 0 ? 0.2 : 0,
        dt,
      });
      return;
    }

    // Apply pointer camera orbit delta
    this.cameraController.applyOrbitDelta(input.cameraOrbitDeltaX, input.cameraOrbitDeltaY);

    // Headless Open-World Simulation Step (SpatialHashGrid + 3-Tier NPC LOD)
    const prevVehicleId = this.player.inVehicleId;
    const weather = this.weatherSystem.getWeather();
    const simResult = stepOpenWorldSimulation({
      dt,
      simTimeSec: this.simClock.timeSec,
      tickIndex: this.simClock.ticks,
      input,
      cameraYaw: this.cameraController.getYaw(),
      weather,
      player: this.player,
      vehicles: this.vehicles,
      peds: this.peds,
      spatialGrid: this.spatialGrid,
      wantedLevel: this.wantedLevel,
      wantedCooldown: this.wantedCooldown,
      lastDistrict: this.lastDistrict,
      eventBus: this.eventBus,
    });

    this.distanceMeters += simResult.stepDistanceMeters;
    this.wantedLevel = simResult.wantedLevel;
    this.wantedCooldown = simResult.wantedCooldown;
    this.lastDistrict = simResult.lastDistrict;
    if (simResult.hitstopDelta > 0) {
      this.hitstopTimer = Math.max(this.hitstopTimer, simResult.hitstopDelta);
    }
    if (simResult.vehicleEnteredOrExited) {
      this.playerRig.root.visible = this.player.inVehicleId === null;
      const interactedVehicleId = this.player.inVehicleId ?? prevVehicleId;
      if (interactedVehicleId) {
        const interactedRig = this.vehicleRigs.get(interactedVehicleId);
        if (interactedRig) {
          interactedRig.hypercar.doorL.target = 1;
          interactedRig.hypercar.autoCloseTimer = 1.65;
          interactedRig.hypercar.pulseTime = 0;
        }
      }
      this.cameraController.requestAutoReturn();
      this.emitHud();
    }

    // Ambient Pluggable Activities (Checkpoints, Future Free-Roam Missions)
    this.activityRegistry.updateAll(dt, input, this.buildActivityContext());

    // Continuous Procedural Web Audio
    const playerCar = simResult.playerCar;
    this.audio.updateContinuous({
      inVehicle: Boolean(playerCar),
      rpm: playerCar ? playerCar.rpm : 900,
      throttle: input.forward,
      nitroActive: playerCar ? playerCar.nitroActive : false,
      skidIntensity: simResult.playerSkid,
      weather,
      sirenIntensity: simResult.sirenProximity,
      dt,
    });
  }

  private handleResize(): void {
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.cameraController.setAspect(w / h);
    this.renderContext.resize(w, h);

    if (!this.touchControlsManualOverride) {
      const shouldShowTouch =
        'ontouchstart' in window || navigator.maxTouchPoints > 0 || w <= 960;
      if (shouldShowTouch !== this.touchControlsVisible) {
        this.touchControlsVisible = shouldShowTouch;
        this.emitHud();
      }
    }
    if (this.frameCounter > 0) {
      this.renderCurrentFrame(performance.now() * 0.001);
    }
  }

  private buildHudSnapshot(): HUDState {
    const activeCar = this.getActivePlayerVehicle();
    const nearCar = activeCar
      ? null
      : findNearestEnterableVehicle(this.player.x, this.player.z, this.vehicles);
    const nearShop = this.activeShop ? null : this.findNearbyShop();
    const activeShopCooldown = this.activeShop
      ? Math.ceil(this.shopCooldowns.get(this.activeShop.id) ?? 0)
      : 0;
    const cpHud = this.checkpointActivity.getHudSlice();

    return {
      phase: this.phase,
      cash: Math.round(this.cash),
      health: Math.round(this.player.health),
      armor: Math.round(this.player.armor),
      wantedLevel: this.wantedLevel,
      district: this.lastDistrict,
      weather: this.weatherSystem ? this.weatherSystem.getWeather() : 'golden',
      timePreset: this.weatherSystem ? this.weatherSystem.getTimePreset() : 'sunset',
      clockText: this.weatherSystem ? this.weatherSystem.getClockText() : '18:20',
      cameraMode: this.cameraController.getMode(),
      inVehicle: Boolean(activeCar),
      vehicleName: activeCar ? activeCar.spec.name : '',
      speedKmh: activeCar ? Math.round(Math.abs(activeCar.speed) * 3.6) : 0,
      gear: activeCar ? (activeCar.gear === -1 ? 'R' : String(activeCar.gear)) : '1',
      rpmRatio: activeCar ? Math.min(1, Math.max(0, (activeCar.rpm - 900) / 6600)) : 0,
      nitro: activeCar ? Math.round(activeCar.nitro) : 100,
      vehicleHealth: activeCar ? Math.round(activeCar.health) : 100,
      nearVehicleName: nearCar ? nearCar.spec.name : null,
      nearShop,
      activeShop: this.activeShop,
      activeShopCooldown,
      outfitId: this.player.outfitId,
      checkpointsCleared: cpHud.cleared,
      totalCheckpoints: cpHud.total,
      objectiveLabel: cpHud.objectiveLabel,
      muted: this.audio.isMuted(),
      fps: Math.round(this.fpsSmoothed),
      touchControlsVisible: this.touchControlsVisible,
      runSummary: this.runSummary,
      bannerText: this.bannerTimer > 0 ? this.bannerText : null,
      robbery: this.robberyActivity.getHudSlice(),
    };
  }

  private emitHud(): void {
    const snap = this.buildHudSnapshot();
    this.hudStore.publish(snap);
    this.onHudUpdate?.(snap);
  }

  private renderCurrentFrame(nowSec: number): void {
    const inRobbery = this.robberyActivity.isActive;
    const activeScene = inRobbery ? this.robberyStage.scene : this.scene;
    this.renderContext.renderFrame({
      scene: activeScene,
      camera: this.cameraController.camera,
      nowSec,
      inInterior: inRobbery,
      sunDirection: this.weatherSystem.getSunDirection(),
      weather: this.weatherSystem.getWeather(),
      exposure: this.weatherSystem.getCurrentExposure(),
      bloomStrength: this.weatherSystem.getBloomStrength(),
      nightFactor: this.weatherSystem.getNightFactor(),
      warmth: this.weatherSystem.getWarmthFactor(),
    });
  }

  private tick = (): void => {
    if (this.disposed) return;

    const nowMs = performance.now();
    const rawDt = (nowMs - this.lastFrameMs) * 0.001;
    this.lastFrameMs = nowMs;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
    const nowSec = nowMs * 0.001;
    this.frameCounter++;

    if (rawDt > 0.001) {
      this.fpsSmoothed = this.fpsSmoothed * 0.9 + Math.min(120, 1 / rawDt) * 0.1;
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer = Math.max(0, this.bannerTimer - dt);
    }

    // 1. Advance Deterministic Simulation
    if (this.phase === 'playing' && !this.activeShop) {
      if (this.hitstopTimer > 0) {
        this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      } else if (this.robberyActivity.isActive && this.renderContext.isSoftwareGl) {
        let rem = Math.min(Math.max(rawDt, 0.001), 0.16);
        while (rem > 0.0001 && this.robberyActivity.isActive) {
          const step = Math.min(rem, 0.05);
          this.stepSimulation(step);
          rem -= step;
        }
      } else {
        this.simClock.advance(dt, (fixedDt) => {
          if (this.phase === 'playing' && !this.activeShop && this.hitstopTimer <= 0) {
            this.stepSimulation(fixedDt);
          }
        });
      }
      this.particleSystem.update(dt);
    }

    // 2. Sync 3D Presentation Layer & Camera
    const robberySession = this.robberyActivity.currentSession;
    if (this.phase !== 'paused') {
      if (robberySession) {
        const visDt = this.renderContext.isSoftwareGl
          ? Math.min(Math.max(rawDt, 0.001), 0.16)
          : dt;
        this.robberyStage.updateVisuals(robberySession, visDt, nowSec);
      } else {
        const visualDt = this.renderContext.isSoftwareGl
          ? Math.min(Math.max(rawDt, 0.001), 1.0)
          : dt;
        this.weatherSystem.update(
          visualDt,
          this.player.x,
          this.player.z,
          this.renderContext.renderer,
          this.scene,
          () => this.audio.playThunder(),
        );
        this.entityAnimator.sync({
          dt: visualDt,
          nowSec,
          frameCounter: this.frameCounter,
          phase: this.phase,
          weather: this.weatherSystem.getWeather(),
          timePreset: this.weatherSystem.getTimePreset(),
          nightFactor: this.weatherSystem.getNightFactor(),
          player: this.player,
          playerRig: this.playerRig,
          vehicles: this.vehicles,
          vehicleRigs: this.vehicleRigs,
          peds: this.peds,
          pedRigs: this.pedRigs,
          pedShadowActive: this.pedShadowActive,
          birdFlock: this.worldVisuals.birdFlock,
          dustMotes: this.worldVisuals.dustMotes,
          shopMarkers: this.worldVisuals.shopMarkers,
          checkpointGroup: this.worldVisuals.checkpointGroup,
          checkpointRing: this.worldVisuals.checkpointRing,
        });
      }

      this.cameraController.update({
        dt,
        nowSec,
        phase: this.phase,
        player: this.player,
        activeCar: this.getActivePlayerVehicle(),
        robberySession,
        robberyStage: this.robberyStage,
      });
    }

    // 3. Render Frame via IRenderBackend (AgX Filmic HDR Pipeline)
    this.renderCurrentFrame(nowSec);

    // 4. Radar Minimap & Throttled Selective HUD Store Publish
    if (!robberySession) {
      this.minimapRenderer.draw({
        phase: this.phase,
        player: this.player,
        cameraYaw: this.cameraController.getYaw(),
        vehicles: this.vehicles,
        activeCheckpoint: this.checkpointActivity.getCurrentCheckpoint(),
        nowMs,
      });
    }

    this.hudEmitAccum += dt;
    const hudInterval = robberySession ? 0.033 : 0.1;
    if (this.hudEmitAccum >= hudInterval) {
      this.hudEmitAccum = 0;
      this.emitHud();
    }

    this.frameHandle = this.renderContext.scheduleNextFrame(
      () => this.disposed,
      this.tick,
    );
  };

  public dispose(): void {
    this.disposed = true;
    this.abortRobberyIfActive();
    this.renderContext.cancelScheduledFrame(this.frameHandle);
    this.eventBus.clear();
    this.engineScope.dispose();
  }
}
