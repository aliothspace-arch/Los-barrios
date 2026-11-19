import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  SanAndreasEngine,
  type BootProgressState,
  type TouchControlState,
} from './game/engine';
import type { GameHudStore } from './game/core/gameStore';
import type { RobberyActionType } from './game/types';
import { LoadingScreen } from './components/LoadingScreen';
import { TitleOverlay } from './components/TitleOverlay';
import { GameHUD } from './components/GameHUD';
import { StatusModal } from './components/StatusModal';
import { ShopModal } from './components/ShopModal';
import { RobberyOverlay } from './components/RobberyOverlay';

const INITIAL_BOOT_STATE: BootProgressState = {
  ready: false,
  progress: 4,
  stageIndex: 1,
  totalStages: 6,
  stageTitle: 'ETAPA 1/6 · INICIANDO MOTOR 3D ASÍNCRONO',
  stageDetail: 'Preparando pipeline HDR AgX y activos de Los Santos...',
};

const TitleOverlaySlot = memo(function TitleOverlaySlot({
  hudStore,
  isFullscreen,
  onStart,
  onCycleWeather,
  onToggleFullscreen,
}: {
  hudStore: GameHudStore;
  isFullscreen: boolean;
  onStart: () => void;
  onCycleWeather: () => void;
  onToggleFullscreen: () => void;
}) {
  const worldUi = useSyncExternalStore(hudStore.subscribeWorldUi, hudStore.getWorldUi);
  if (worldUi.phase !== 'title') return null;
  return (
    <TitleOverlay
      weather={worldUi.weather}
      isFullscreen={isFullscreen}
      onStart={onStart}
      onCycleWeather={onCycleWeather}
      onToggleFullscreen={onToggleFullscreen}
    />
  );
});

const GameHUDSlot = memo(function GameHUDSlot({
  hudStore,
  isFullscreen,
  onMinimapMount,
  onCycleWeather,
  onCycleTime,
  onCycleCamera,
  onToggleMute,
  onTogglePause,
  onToggleFullscreen,
  onToggleTouchControls,
  onTouchState,
  onEnterExitVehicle,
  onToggleDoors,
  onToggleFrunk,
  onOpenShop,
  onJumpOrAction,
  onCameraOrbit,
  onCameraOrbitActive,
}: {
  hudStore: GameHudStore;
  isFullscreen: boolean;
  onMinimapMount: (canvas: HTMLCanvasElement | null) => void;
  onCycleWeather: () => void;
  onCycleTime: () => void;
  onCycleCamera: () => void;
  onToggleMute: () => void;
  onTogglePause: () => void;
  onToggleFullscreen: () => void;
  onToggleTouchControls: () => void;
  onTouchState: (partial: Partial<TouchControlState>) => void;
  onEnterExitVehicle: () => void;
  onToggleDoors: () => void;
  onToggleFrunk: () => void;
  onOpenShop: () => void;
  onJumpOrAction: () => void;
  onCameraOrbit: (dx: number, dy: number) => void;
  onCameraOrbitActive: (active: boolean) => void;
}) {
  const worldUi = useSyncExternalStore(hudStore.subscribeWorldUi, hudStore.getWorldUi);
  if (worldUi.phase === 'title') return null;
  return (
    <GameHUD
      hudStore={hudStore}
      isFullscreen={isFullscreen}
      onMinimapMount={onMinimapMount}
      onCycleWeather={onCycleWeather}
      onCycleTime={onCycleTime}
      onCycleCamera={onCycleCamera}
      onToggleMute={onToggleMute}
      onTogglePause={onTogglePause}
      onToggleFullscreen={onToggleFullscreen}
      onToggleTouchControls={onToggleTouchControls}
      onTouchState={onTouchState}
      onEnterExitVehicle={onEnterExitVehicle}
      onToggleDoors={onToggleDoors}
      onToggleFrunk={onToggleFrunk}
      onOpenShop={onOpenShop}
      onJumpOrAction={onJumpOrAction}
      onCameraOrbit={onCameraOrbit}
      onCameraOrbitActive={onCameraOrbitActive}
    />
  );
});

const RobberyOverlaySlot = memo(function RobberyOverlaySlot({
  hudStore,
  onAction,
}: {
  hudStore: GameHudStore;
  onAction: (action: RobberyActionType) => void;
}) {
  const worldUi = useSyncExternalStore(hudStore.subscribeWorldUi, hudStore.getWorldUi);
  const activity = useSyncExternalStore(hudStore.subscribeActivity, hudStore.getActivity);
  if (worldUi.phase !== 'playing') return null;
  return (
    <RobberyOverlay
      robbery={activity.robbery}
      touchControlsVisible={worldUi.touchControlsVisible}
      onAction={onAction}
    />
  );
});

const ShopModalSlot = memo(function ShopModalSlot({
  hudStore,
  onBuyItem,
  onRobShop,
  onClose,
}: {
  hudStore: GameHudStore;
  onBuyItem: (itemId: string) => void;
  onRobShop: () => void;
  onClose: () => void;
}) {
  const worldUi = useSyncExternalStore(hudStore.subscribeWorldUi, hudStore.getWorldUi);
  const player = useSyncExternalStore(hudStore.subscribePlayer, hudStore.getPlayer);
  return (
    <ShopModal
      shop={worldUi.activeShop}
      cash={player.cash}
      inVehicle={player.inVehicle}
      robCooldownSeconds={worldUi.activeShopCooldown}
      onBuyItem={onBuyItem}
      onRobShop={onRobShop}
      onClose={onClose}
    />
  );
});

const StatusModalSlot = memo(function StatusModalSlot({
  hudStore,
  onResume,
  onRestart,
  onReturnTitle,
}: {
  hudStore: GameHudStore;
  onResume: () => void;
  onRestart: () => void;
  onReturnTitle: () => void;
}) {
  const worldUi = useSyncExternalStore(hudStore.subscribeWorldUi, hudStore.getWorldUi);
  const player = useSyncExternalStore(hudStore.subscribePlayer, hudStore.getPlayer);
  return (
    <StatusModal
      phase={worldUi.phase}
      cash={player.cash}
      checkpointsCleared={player.checkpointsCleared}
      totalCheckpoints={player.totalCheckpoints}
      runSummary={worldUi.runSummary}
      onResume={onResume}
      onRestart={onRestart}
      onReturnTitle={onReturnTitle}
    />
  );
});

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SanAndreasEngine | null>(null);
  const [hudStore, setHudStore] = useState<GameHudStore | null>(null);
  const [bootState, setBootState] = useState<BootProgressState>(INITIAL_BOOT_STATE);
  const [showLoader, setShowLoader] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Mount Three.js engine strictly once outside React HUD re-renders and run non-blocking async boot
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let cancelled = false;
    let hideTimer = 0;

    const params = new URLSearchParams(window.location.search);
    const autostart = params.get('autostart') === '1';
    const pauseLoader = params.get('pauseLoader') === '1';
    const rollParam = params.get('robberyRoll');
    const forcedRobberyRoll =
      rollParam !== null && !Number.isNaN(Number(rollParam))
        ? Number(rollParam)
        : undefined;
    const spawnShopId = params.get('spawnShop') ?? undefined;

    if (pauseLoader) {
      setBootState({
        ready: false,
        progress: 64,
        stageIndex: 4,
        totalStages: 6,
        stageTitle: 'ETAPA 4/6 · INGENIERÍA PARAMÉTRICA HYPERCAR V12 CLASS-A',
        stageDetail:
          'Evaluando superficies continuas C2, motor V12, puertas diédricas de mariposa y pintura Tri-Coat...',
      });
      return;
    }

    const engine = new SanAndreasEngine(container, undefined, {
      autostart,
      forcedRobberyRoll,
      spawnShopId,
      onBootProgress: (nextBoot) => {
        if (cancelled) return;
        setBootState(nextBoot);
        if (nextBoot.ready) {
          hideTimer = window.setTimeout(() => {
            if (!cancelled) setShowLoader(false);
          }, 380);
        }
      },
    });
    engineRef.current = engine;
    setHudStore(engine.hudStore);
    void engine.bootAsync();

    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);

    return () => {
      cancelled = true;
      window.clearTimeout(hideTimer);
      document.removeEventListener('fullscreenchange', handleFsChange);
      engine.dispose();
      engineRef.current = null;
      setHudStore(null);
    };
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void>;
    };
    const rootEl = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };

    if (!document.fullscreenElement) {
      const req =
        rootEl.requestFullscreen?.() ?? rootEl.webkitRequestFullscreen?.();
      if (req && typeof req.catch === 'function') {
        req.catch(() => {
          // Graceful fallback if embedded iframe blocks fullscreen
        });
      }
      const orient = screen.orientation as ScreenOrientation & {
        lock?: (mode: string) => Promise<void>;
      };
      orient?.lock?.('landscape').catch(() => {});
    } else {
      const exit = doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.();
      if (exit && typeof exit.catch === 'function') {
        exit.catch(() => {});
      }
    }
  }, []);

  const handleMinimapMount = useCallback((canvas: HTMLCanvasElement | null) => {
    engineRef.current?.setMinimapCanvas(canvas);
  }, []);

  const handleStart = useCallback(() => {
    engineRef.current?.startGame();
  }, []);

  const handleCycleWeather = useCallback(() => {
    engineRef.current?.cycleWeather();
  }, []);

  const handleCycleTime = useCallback(() => {
    engineRef.current?.cycleTimePreset();
  }, []);

  const handleCycleCamera = useCallback(() => {
    engineRef.current?.cycleCameraMode();
  }, []);

  const handleToggleMute = useCallback(() => {
    engineRef.current?.toggleMute();
  }, []);

  const handleTogglePause = useCallback(() => {
    engineRef.current?.togglePause();
  }, []);

  const handleToggleTouchControls = useCallback(() => {
    engineRef.current?.toggleTouchControls();
  }, []);

  const handleRestart = useCallback(() => {
    engineRef.current?.resetWorld();
  }, []);

  const handleReturnTitle = useCallback(() => {
    engineRef.current?.returnToTitle();
  }, []);

  const handleTouchState = useCallback((partial: Partial<TouchControlState>) => {
    engineRef.current?.setTouchState(partial);
  }, []);

  const handleEnterExitVehicle = useCallback(() => {
    engineRef.current?.triggerEnterOrExitVehicle();
  }, []);

  const handleToggleDoors = useCallback(() => {
    engineRef.current?.toggleVehicleDoors();
  }, []);

  const handleToggleFrunk = useCallback(() => {
    engineRef.current?.toggleVehicleFrunk();
  }, []);

  const handleOpenShop = useCallback(() => {
    engineRef.current?.openNearestShop();
  }, []);

  const handleCloseShop = useCallback(() => {
    engineRef.current?.closeShop();
  }, []);

  const handleBuyShopItem = useCallback((itemId: string) => {
    engineRef.current?.buyShopItem(itemId);
  }, []);

  const handleRobShop = useCallback(() => {
    engineRef.current?.robActiveShop();
  }, []);

  const handleRobberyAction = useCallback((action: RobberyActionType) => {
    engineRef.current?.triggerRobberyAction(action);
  }, []);

  const handleJumpOrAction = useCallback(() => {
    engineRef.current?.triggerJumpOrAction();
  }, []);

  const handleCameraOrbit = useCallback((dx: number, dy: number) => {
    engineRef.current?.addCameraOrbit(dx, dy);
  }, []);

  const handleCameraOrbitActive = useCallback((active: boolean) => {
    engineRef.current?.setCameraOrbitActive(active);
  }, []);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#0d0a08]">
      {/* Isolated WebGL Canvas Container */}
      <div
        ref={mountRef}
        data-testid="three-viewport"
        className="fixed inset-0 w-full h-full"
      />

      {showLoader && <LoadingScreen bootState={bootState} />}

      {hudStore && bootState.ready && (
        <>
          <TitleOverlaySlot
            hudStore={hudStore}
            isFullscreen={isFullscreen}
            onStart={handleStart}
            onCycleWeather={handleCycleWeather}
            onToggleFullscreen={handleToggleFullscreen}
          />

          <GameHUDSlot
            hudStore={hudStore}
            isFullscreen={isFullscreen}
            onMinimapMount={handleMinimapMount}
            onCycleWeather={handleCycleWeather}
            onCycleTime={handleCycleTime}
            onCycleCamera={handleCycleCamera}
            onToggleMute={handleToggleMute}
            onTogglePause={handleTogglePause}
            onToggleFullscreen={handleToggleFullscreen}
            onToggleTouchControls={handleToggleTouchControls}
            onTouchState={handleTouchState}
            onEnterExitVehicle={handleEnterExitVehicle}
            onToggleDoors={handleToggleDoors}
            onToggleFrunk={handleToggleFrunk}
            onOpenShop={handleOpenShop}
            onJumpOrAction={handleJumpOrAction}
            onCameraOrbit={handleCameraOrbit}
            onCameraOrbitActive={handleCameraOrbitActive}
          />

          <RobberyOverlaySlot
            hudStore={hudStore}
            onAction={handleRobberyAction}
          />

          <ShopModalSlot
            hudStore={hudStore}
            onBuyItem={handleBuyShopItem}
            onRobShop={handleRobShop}
            onClose={handleCloseShop}
          />

          <StatusModalSlot
            hudStore={hudStore}
            onResume={handleTogglePause}
            onRestart={handleRestart}
            onReturnTitle={handleReturnTitle}
          />
        </>
      )}
    </main>
  );
}
