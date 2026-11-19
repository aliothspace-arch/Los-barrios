import React, { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { WeatherType } from '../game/types';
import type { TouchControlState } from '../game/engine';
import type { GameHudStore } from '../game/core/gameStore';

interface GameHUDProps {
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
}

const WEATHER_SHORT: Record<WeatherType, string> = {
  golden: 'DORADO',
  clear: 'SOL',
  rain: 'LLUVIA',
  storm: 'TORMENTA',
  fog: 'NIEBLA',
};

/**
 * Isolated high-frequency telemetry speedometer (mobile touch mode).
 * Subscribes ONLY to `hudStore.subscribeTelemetry` so 30Hz speed/RPM ticks
 * never re-render the parent HUD, touch pads, or modals.
 */
const MobileSpeedometer = memo(function MobileSpeedometer({
  hudStore,
}: {
  hudStore: GameHudStore;
}) {
  const telemetry = useSyncExternalStore(
    hudStore.subscribeTelemetry,
    hudStore.getTelemetry,
  );
  return (
    <div
      className="fixed bottom-2 left-1/2 -translate-x-1/2 z-10 px-2.5 py-1 bg-[#0d0b09]/42 border-b border-[#e5a23c]/75 flex items-center gap-2 pointer-events-none"
      data-testid="mobile-speedometer"
    >
      <div className="flex items-baseline gap-1">
        <span
          className="font-display text-xl leading-none text-[#f6efe3]"
          data-testid="speed-readout"
        >
          {telemetry.speedKmh}
        </span>
        <span className="text-[8px] font-tech text-[#c9bda8]/85">KM/H</span>
      </div>
      <div className="flex flex-col min-w-[66px]">
        <div className="flex items-center justify-between text-[8px] font-hud tracking-wider">
          <span className="text-[#e5a23c] font-bold">M{telemetry.gear}</span>
          <span className="text-[#7bc9ff]">N2O {telemetry.nitro}%</span>
        </div>
        <div className="w-full h-[3px] bg-[#25211d]/70 mt-0.5 overflow-hidden">
          <div
            className="h-full transition-[width] duration-75"
            style={{
              width: `${Math.round(telemetry.rpmRatio * 100)}%`,
              backgroundColor: telemetry.rpmRatio > 0.85 ? '#e03e2d' : '#e5a23c',
            }}
          />
        </div>
      </div>
    </div>
  );
});

/**
 * Isolated high-frequency telemetry speedometer (desktop mode).
 */
const DesktopSpeedometer = memo(function DesktopSpeedometer({
  hudStore,
  vehicleName,
}: {
  hudStore: GameHudStore;
  vehicleName: string;
}) {
  const telemetry = useSyncExternalStore(
    hudStore.subscribeTelemetry,
    hudStore.getTelemetry,
  );
  return (
    <div className="px-2.5 py-1.5 bg-[#0d0b09]/46 border-r-2 border-[#e5a23c]/85 flex flex-col items-end min-w-[114px]">
      <div className="text-[9px] font-hud tracking-[0.14em] text-[#e5a23c]/95">
        {vehicleName}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          className="font-display text-3xl leading-none text-[#f6efe3]"
          data-testid="speed-readout"
        >
          {telemetry.speedKmh}
        </span>
        <div className="flex flex-col items-start">
          <span className="text-[8px] font-tech text-[#c9bda8]/90">KM/H</span>
          <span className="text-[10px] font-hud font-bold text-[#e5a23c]">
            M{telemetry.gear}
          </span>
        </div>
      </div>
      <div className="w-full h-1 bg-[#25211d]/70 mt-0.5 overflow-hidden">
        <div
          className="h-full transition-[width] duration-75"
          style={{
            width: `${Math.round(telemetry.rpmRatio * 100)}%`,
            backgroundColor: telemetry.rpmRatio > 0.85 ? '#e03e2d' : '#e5a23c',
          }}
        />
      </div>
      <div className="w-full flex items-center justify-between text-[9px] font-tech text-[#c9bda8]/85 mt-0.5 gap-2">
        <span>N2O {telemetry.nitro}%</span>
        <span>{telemetry.vehicleHealth}%</span>
      </div>
    </div>
  );
});

export const GameHUD: React.FC<GameHUDProps> = memo(function GameHUD({
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
}) {
  const player = useSyncExternalStore(hudStore.subscribePlayer, hudStore.getPlayer);
  const worldUi = useSyncExternalStore(hudStore.subscribeWorldUi, hudStore.getWorldUi);
  const activity = useSyncExternalStore(hudStore.subscribeActivity, hudStore.getActivity);

  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const [ghostHealth, setGhostHealth] = useState(player.health);
  const [stickKnob, setStickKnob] = useState({ x: 0, y: 0 });
  const [isPortraitMobile, setIsPortraitMobile] = useState(false);
  const [portraitDismissed, setPortraitDismissed] = useState(false);

  const stickPointerId = useRef<number | null>(null);
  const stickCenter = useRef({ x: 0, y: 0 });
  const orbitPointerId = useRef<number | null>(null);
  const orbitLast = useRef({ x: 0, y: 0 });

  useEffect(() => {
    onMinimapMount(minimapRef.current);
    return () => onMinimapMount(null);
  }, [onMinimapMount]);

  // Delayed trailing damage ghost bar
  useEffect(() => {
    if (player.health < ghostHealth) {
      const id = window.setTimeout(() => setGhostHealth(player.health), 420);
      return () => clearTimeout(id);
    }
    setGhostHealth(player.health);
  }, [player.health, ghostHealth]);

  // Detect narrow portrait mobile orientation for non-blocking landscape suggestion
  useEffect(() => {
    const check = () => {
      setIsPortraitMobile(window.innerWidth < 640 && window.innerHeight > window.innerWidth);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const cashFormatted = `$${String(Math.max(0, player.cash)).padStart(7, '0')}`;

  // Touch Virtual Joystick Handlers (On-Foot)
  const handleStickDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    stickPointerId.current = e.pointerId;
    const rect = e.currentTarget.getBoundingClientRect();
    stickCenter.current = {
      x: rect.left + rect.width * 0.5,
      y: rect.top + rect.height * 0.5,
    };
    updateStick(e.clientX, e.clientY);
  };

  const updateStick = (clientX: number, clientY: number) => {
    const maxR = 42;
    let dx = clientX - stickCenter.current.x;
    let dy = clientY - stickCenter.current.y;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    setStickKnob({ x: dx, y: dy });
    onTouchState({
      stickX: dx / maxR,
      stickY: -dy / maxR,
    });
  };

  const handleStickMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stickPointerId.current !== e.pointerId) return;
    e.stopPropagation();
    updateStick(e.clientX, e.clientY);
  };

  const handleStickUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stickPointerId.current !== e.pointerId) return;
    e.stopPropagation();
    stickPointerId.current = null;
    setStickKnob({ x: 0, y: 0 });
    onTouchState({ stickX: 0, stickY: 0 });
  };

  // Full-Screen Free Camera Orbit Drag Surface (releases smoothly back behind CJ / vehicle!)
  const handleOrbitDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (orbitPointerId.current !== null) return;
    orbitPointerId.current = e.pointerId;
    orbitLast.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    onCameraOrbitActive(true);
  };

  const handleOrbitMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (orbitPointerId.current !== e.pointerId) return;
    const dx = e.clientX - orbitLast.current.x;
    const dy = e.clientY - orbitLast.current.y;
    orbitLast.current = { x: e.clientX, y: e.clientY };
    onCameraOrbit(dx * 1.15, dy * 0.9);
  };

  const handleOrbitUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (orbitPointerId.current !== e.pointerId) return;
    orbitPointerId.current = null;
    onCameraOrbitActive(false);
  };

  const inRobbery = activity.robbery !== null;
  const inRobberyBrawl = activity.robbery?.phase === 'rebel_brawl';
  const showLetterboxOffset = inRobbery && !inRobberyBrawl;

  return (
    <div className="fixed inset-0 z-10 pointer-events-none select-none overflow-hidden">
      {/* Full-Screen Touch/Mouse Camera Orbit Surface (disabled during store robbery) */}
      {!inRobbery && (
        <div
          data-testid="camera-orbit-surface"
          className="pointer-events-auto fixed inset-0 z-0 touch-none"
          onPointerDown={handleOrbitDown}
          onPointerMove={handleOrbitMove}
          onPointerUp={handleOrbitUp}
          onPointerCancel={handleOrbitUp}
        />
      )}

      {/* Low HP Subtle Crimson Vignette */}
      {player.health <= 30 && (
        <div
          className="fixed inset-0 z-10 pointer-events-none"
          style={{
            boxShadow: 'inset 0 0 90px rgba(190, 24, 18, 0.58)',
          }}
        />
      )}

      {/* Non-blocking Portrait Orientation Suggestion on Mobile (below top HUD bar) */}
      {!inRobbery && isPortraitMobile && !portraitDismissed && (
        <div className="pointer-events-auto fixed top-14 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 py-1.5 bg-[#120f0c]/95 border border-[#e2a54a]/70 text-xs font-hud text-[#f5ede0] whitespace-nowrap">
          <span>Gira el móvil en horizontal para jugar mejor</span>
          <button
            type="button"
            onClick={() => setPortraitDismissed(true)}
            className="px-1.5 py-0.5 bg-[#e2a54a] text-[#110d09] font-bold"
          >
            OK
          </button>
        </div>
      )}

      {/* TOP-LEFT: Compact Translucent Objective Badge (hidden during store robbery) */}
      {!inRobbery && (
        <div className="fixed top-2.5 left-2.5 sm:top-3.5 sm:left-3.5 z-20 flex flex-col items-start gap-1">
          <div className="px-2 py-0.5 bg-[#0e0c0a]/42 border-l-2 border-[#e5a23c]/85 text-[10px] sm:text-[11px] font-hud tracking-wider text-[#f3eadb]/95">
            <span className="text-[#e5a23c] font-bold mr-1.5">
              OBJ {player.checkpointsCleared}/{player.totalCheckpoints}
            </span>
            <span>{player.objectiveLabel}</span>
          </div>
        </div>
      )}

      {/* TOP-RIGHT: Authentic GTA San Andreas Status Cluster + Sleek Translucent Utility Buttons */}
      <div
        className={`fixed right-2.5 sm:right-3.5 z-20 flex flex-col items-end gap-1 transition-[top] duration-200 ${
          showLetterboxOffset ? 'top-6 sm:top-8' : 'top-2.5 sm:top-3.5'
        }`}
      >
        {/* Compact Translucent Utility Icon Row */}
        <div className="pointer-events-auto flex items-center gap-1">
          {!inRobbery && (
            <>
              <button
                type="button"
                tabIndex={-1}
                aria-label="Cambiar clima"
                title="Clima [V]"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onCycleWeather();
                }}
                className="px-1.5 h-7 bg-[#0e0c0a]/38 hover:bg-[#1e1a15]/70 border border-[#e5a23c]/30 text-[10px] font-hud tracking-wider text-[#f4ead8]/90 cursor-pointer"
              >
                {WEATHER_SHORT[worldUi.weather]}
              </button>

              <button
                type="button"
                tabIndex={-1}
                aria-label="Cambiar hora del día"
                title="Hora [T]"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onCycleTime();
                }}
                className="px-1.5 h-7 bg-[#0e0c0a]/38 hover:bg-[#1e1a15]/70 border border-[#f4ead8]/18 text-[10px] font-hud tracking-wider text-[#f4ead8]/90 cursor-pointer"
              >
                {worldUi.clockText}
              </button>

              <button
                type="button"
                tabIndex={-1}
                aria-label="Cambiar cámara"
                title="Cámara [C]"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onCycleCamera();
                }}
                className="w-7 h-7 flex items-center justify-center bg-[#0e0c0a]/38 hover:bg-[#1e1a15]/70 border border-[#f4ead8]/18 text-[#f4ead8]/90 cursor-pointer"
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 8h3l2-2h6l2 2h3v10H4z" />
                  <circle cx="12" cy="13" r="3" />
                </svg>
              </button>
            </>
          )}

          <button
            type="button"
            tabIndex={-1}
            aria-label={worldUi.touchControlsVisible ? 'Ocultar controles táctiles' : 'Mostrar controles táctiles'}
            title="Controles Táctiles"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleTouchControls();
            }}
            className={`w-7 h-7 flex items-center justify-center border cursor-pointer ${
              worldUi.touchControlsVisible
                ? 'bg-[#e5a23c]/52 border-[#e5a23c]/60 text-[#110d09]'
                : 'bg-[#0e0c0a]/38 border-[#f4ead8]/18 text-[#f4ead8]/90'
            }`}
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="7" width="18" height="10" rx="3" />
              <path d="M7 12h4M9 10v4M15.5 11h.01M17.5 13h.01" strokeLinecap="round" />
            </svg>
          </button>

          <button
            type="button"
            tabIndex={-1}
            aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            title="Pantalla Completa"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleFullscreen();
            }}
            className="w-7 h-7 flex items-center justify-center bg-[#0e0c0a]/38 hover:bg-[#1e1a15]/70 border border-[#f4ead8]/18 text-[#f4ead8]/90 cursor-pointer"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              {isFullscreen ? (
                <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" strokeLinecap="round" />
              ) : (
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" strokeLinecap="round" />
              )}
            </svg>
          </button>

          <button
            type="button"
            tabIndex={-1}
            aria-label={worldUi.muted ? 'Activar sonido' : 'Silenciar sonido'}
            title="Sonido [M]"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            className="w-7 h-7 flex items-center justify-center bg-[#0e0c0a]/38 hover:bg-[#1e1a15]/70 border border-[#f4ead8]/18 text-[#f4ead8]/90 cursor-pointer"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 5L6 9H3v6h3l5 4V5z" />
              {worldUi.muted ? (
                <path d="M22 9l-6 6M16 9l6 6" strokeLinecap="round" />
              ) : (
                <path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13" strokeLinecap="round" />
              )}
            </svg>
          </button>

          <button
            type="button"
            tabIndex={-1}
            aria-label="Pausar juego"
            title="Pausa [P]"
            onClick={(e) => {
              e.currentTarget.blur();
              onTogglePause();
            }}
            className="w-7 h-7 flex items-center justify-center bg-[#0e0c0a]/38 hover:bg-[#1e1a15]/70 border border-[#f4ead8]/18 text-[#f4ead8]/90 cursor-pointer"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" />
              <rect x="14" y="5" width="4" height="14" />
            </svg>
          </button>
        </div>

        {/* Classic San Andreas Banknote Cash Readout */}
        <div
          className="font-display text-2xl sm:text-3xl leading-none tracking-wider text-[#49b864] hud-stroke"
          aria-label={`Dinero ${cashFormatted}`}
        >
          {cashFormatted}
        </div>

        {/* Health Bar (with trailing damage ghost) & Armor Bar */}
        <div className="flex flex-col items-end gap-1 w-32 sm:w-40">
          <div className="w-full h-3 bg-[#100e0d] border-2 border-[#080706] relative overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-[#f0c050] transition-[width] duration-300"
              style={{ width: `${Math.max(0, Math.min(100, ghostHealth))}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 bg-[#c92a22]"
              style={{ width: `${Math.max(0, Math.min(100, player.health))}%` }}
            />
          </div>
          {player.armor > 0 && (
            <div className="w-full h-2 bg-[#100e0d] border border-[#080706] relative overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-[#d5dce3]"
                style={{ width: `${Math.max(0, Math.min(100, player.armor))}%` }}
              />
            </div>
          )}
        </div>

        {/* Wanted Level Stars (Custom inline SVG stars) */}
        <div className="flex items-center gap-0.5 mt-0.5" aria-label={`Nivel de búsqueda ${player.wantedLevel} de 5`}>
          {[1, 2, 3, 4, 5].map((star) => {
            const active = star <= player.wantedLevel;
            return (
              <svg key={star} viewBox="0 0 24 24" className="w-4 h-4 sm:w-5 sm:h-5">
                <path
                  d="M12 2.4l2.85 5.8 6.4.93-4.62 4.5 1.1 6.37L12 17l-5.73 3 1.1-6.37-4.62-4.5 6.4-.93z"
                  fill={active ? '#f5b83d' : 'rgba(18,16,14,0.68)'}
                  stroke="#080706"
                  strokeWidth="1.8"
                />
              </svg>
            );
          })}
        </div>
      </div>

      {/* CENTER-UPPER DISTRICT / EVENT BANNER (Transient, hidden during store robbery) */}
      {!inRobbery && worldUi.bannerText && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 pointer-events-none text-center">
          <div className="font-display text-2xl sm:text-3xl tracking-[0.14em] text-[#f5e7ce] hud-stroke">
            {worldUi.bannerText}
          </div>
        </div>
      )}

      {/* BOTTOM-LEFT: Authentic Circular San Andreas Radar Minimap (hidden indoors during robbery) */}
      {!inRobbery && (
        <div
          className={`fixed bottom-2.5 left-2.5 sm:bottom-3.5 sm:left-3.5 flex items-end gap-2.5 transition-transform ${
            worldUi.touchControlsVisible ? 'mb-[86px] sm:mb-24' : ''
          }`}
        >
          <div className="flex flex-col items-center gap-0.5">
            <div
              className={`relative rounded-full border-2 border-[#0e0c0a]/85 shadow-[0_0_0_1.5px_rgba(226,165,74,0.55),0_4px_12px_rgba(0,0,0,0.6)] overflow-hidden bg-[#1b201c]/90 ${
                worldUi.touchControlsVisible
                  ? 'w-[70px] h-[70px] sm:w-[84px] sm:h-[84px]'
                  : 'w-[92px] h-[92px] sm:w-[116px] sm:h-[116px]'
              }`}
            >
              <canvas
                ref={minimapRef}
                width={132}
                height={132}
                className="w-full h-full block"
                data-testid="radar-minimap"
              />
            </div>
            <span className="text-[9px] sm:text-[10px] font-hud tracking-[0.14em] text-[#f2e8d6] hud-stroke-sm">
              {player.district}
            </span>
          </div>
        </div>
      )}

      {/* BOTTOM-CENTER: Isolated Mobile Speedometer */}
      {!inRobbery && player.inVehicle && worldUi.touchControlsVisible && (
        <MobileSpeedometer hudStore={hudStore} />
      )}

      {/* CONTEXTUAL PROMPTS & ISOLATED DESKTOP SPEEDOMETER */}
      {!inRobbery && (
        <div
          className={`fixed right-2.5 sm:right-3.5 z-20 flex flex-col items-end gap-1.5 ${
            worldUi.touchControlsVisible ? 'bottom-28' : 'bottom-2.5 sm:bottom-3.5'
          }`}
        >
          {worldUi.nearShop && !worldUi.activeShop && (
            <button
              type="button"
              tabIndex={-1}
              data-testid="enter-shop-prompt"
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenShop();
              }}
              className="pointer-events-auto px-3 py-1.5 bg-[#102416]/52 hover:bg-[#193822]/80 border border-[#49d478]/65 text-[#eefcf2] font-hud text-[11px] sm:text-xs tracking-wider cursor-pointer"
            >
              [F] {worldUi.nearShop.name}
            </button>
          )}

          {!player.inVehicle && player.nearVehicleName && !worldUi.touchControlsVisible && (
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.currentTarget.blur();
                onEnterExitVehicle();
              }}
              className="pointer-events-auto px-3 py-1.5 bg-[#12100d]/52 hover:bg-[#241e18]/80 border border-[#e5a23c]/65 text-[#f5ecd9] font-hud text-[11px] sm:text-xs tracking-wider cursor-pointer"
            >
              [E] {player.nearVehicleName}
            </button>
          )}

          {(player.inVehicle || player.nearVehicleName) && !worldUi.touchControlsVisible && (
            <div className="pointer-events-auto flex items-center gap-1">
              <button
                type="button"
                tabIndex={-1}
                data-testid="toggle-doors-btn"
                title="Puertas de Mariposa [O]"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onToggleDoors();
                }}
                className="px-2 py-1 bg-[#12100d]/52 hover:bg-[#241e18]/80 border border-[#e5a23c]/45 text-[#f5ecd9] font-hud text-[10px] tracking-wider cursor-pointer"
              >
                [O] PUERTAS
              </button>
              <button
                type="button"
                tabIndex={-1}
                data-testid="toggle-frunk-btn"
                title="Maletero Frunk 44° [U]"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onToggleFrunk();
                }}
                className="px-2 py-1 bg-[#12100d]/52 hover:bg-[#241e18]/80 border border-[#f5ecd9]/28 text-[#f5ecd9] font-hud text-[10px] tracking-wider cursor-pointer"
              >
                [U] CAPÓ
              </button>
            </div>
          )}

          {player.inVehicle && !worldUi.touchControlsVisible && (
            <DesktopSpeedometer hudStore={hudStore} vehicleName={player.vehicleName} />
          )}
        </div>
      )}

      {/* ERGONOMIC, TRANSLUCENT NON-INTRUSIVE LANDSCAPE TOUCH CONTROLS */}
      {worldUi.touchControlsVisible && (!inRobbery || inRobberyBrawl) && (
        <>
          {/* LEFT THUMB ZONE: Translucent Virtual Stick (On-Foot & Robbery Brawl) or Slim Steering Pads (Driving) */}
          <div className="pointer-events-auto fixed bottom-2.5 left-2.5 sm:bottom-3.5 sm:left-3.5 z-20">
            {player.inVehicle && !inRobbery ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Girar izquierda"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    onTouchState({ steerLeft: true });
                  }}
                  onPointerUp={() => onTouchState({ steerLeft: false })}
                  onPointerLeave={() => onTouchState({ steerLeft: false })}
                  onPointerCancel={() => onTouchState({ steerLeft: false })}
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-[#100e0c]/26 active:bg-[#e5a23c]/70 active:text-[#110d09] border border-[#f2e8d6]/28 text-[#f5ede0]/85 flex items-center justify-center font-display text-xl"
                >
                  ◀
                </button>
                <button
                  type="button"
                  aria-label="Girar derecha"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    onTouchState({ steerRight: true });
                  }}
                  onPointerUp={() => onTouchState({ steerRight: false })}
                  onPointerLeave={() => onTouchState({ steerRight: false })}
                  onPointerCancel={() => onTouchState({ steerRight: false })}
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-[#100e0c]/26 active:bg-[#e5a23c]/70 active:text-[#110d09] border border-[#f2e8d6]/28 text-[#f5ede0]/85 flex items-center justify-center font-display text-xl"
                >
                  ▶
                </button>
              </div>
            ) : (
              <div
                onPointerDown={handleStickDown}
                onPointerMove={handleStickMove}
                onPointerUp={handleStickUp}
                onPointerCancel={handleStickUp}
                aria-label="Joystick de movimiento"
                className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-[#100e0c]/24 border border-[#f2e8d6]/28 flex items-center justify-center"
              >
                <div
                  className="w-9 h-9 rounded-full bg-[#e5a23c]/52 border border-[#110d09]/55"
                  style={{
                    transform: `translate3d(${stickKnob.x}px, ${stickKnob.y}px, 0)`,
                  }}
                />
              </div>
            )}
          </div>

          {/* RIGHT THUMB ZONE: Translucent Pedals (Driving) or Slim Action/Jump/Sprint (On-Foot) */}
          {!inRobbery && (
            <div className="pointer-events-auto fixed bottom-2.5 right-2.5 sm:bottom-3.5 sm:right-3.5 z-20 flex items-end gap-1.5">
              {worldUi.nearShop && !worldUi.activeShop && (
                <button
                  type="button"
                  aria-label={`Entrar a ${worldUi.nearShop.name}`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    onOpenShop();
                  }}
                  className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-[#143d22]/36 active:bg-[#2ca358]/75 border border-[#49d478]/55 text-[#eefcf2]/90 font-hud text-[10px] font-bold tracking-wider flex items-center justify-center"
                >
                  TIENDA
                </button>
              )}

              {(player.inVehicle || player.nearVehicleName) && (
                <>
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      aria-label="Abrir puertas de mariposa"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        onToggleDoors();
                      }}
                      className="w-11 h-7 rounded-lg bg-[#12100d]/42 active:bg-[#e5a23c]/75 border border-[#e5a23c]/50 text-[#f5ede0]/90 font-hud text-[9px] font-bold"
                    >
                      PUERTA
                    </button>
                    <button
                      type="button"
                      aria-label="Abrir capó delantero"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        onToggleFrunk();
                      }}
                      className="w-11 h-7 rounded-lg bg-[#12100d]/42 active:bg-[#e5a23c]/75 border border-[#f5ede0]/32 text-[#f5ede0]/90 font-hud text-[9px] font-bold"
                    >
                      CAPÓ
                    </button>
                  </div>
                  <button
                    type="button"
                    aria-label={player.inVehicle ? 'Salir del vehículo' : 'Subir al vehículo'}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      onEnterExitVehicle();
                    }}
                    className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-[#1e4226]/36 active:bg-[#3a7a48]/75 border border-[#75d988]/50 text-[#f5efe6]/90 font-hud text-[10px] font-bold tracking-wider flex items-center justify-center"
                  >
                    {player.inVehicle ? 'SALIR' : 'COCHE'}
                  </button>
                </>
              )}

              {player.inVehicle ? (
                <div className="flex items-end gap-1.5">
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      aria-label="Nitro"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        onTouchState({ nitroOrSprint: true });
                      }}
                      onPointerUp={() => onTouchState({ nitroOrSprint: false })}
                      onPointerLeave={() => onTouchState({ nitroOrSprint: false })}
                      onPointerCancel={() => onTouchState({ nitroOrSprint: false })}
                      className="w-12 h-9 rounded-lg bg-[#143047]/34 active:bg-[#39a9ff]/75 border border-[#5cc0ff]/48 text-[#eaf6ff]/90 font-hud text-[10px] font-bold"
                    >
                      N2O
                    </button>
                    <button
                      type="button"
                      aria-label="Freno de mano y derrape"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        onTouchState({ handbrake: true });
                      }}
                      onPointerUp={() => onTouchState({ handbrake: false })}
                      onPointerLeave={() => onTouchState({ handbrake: false })}
                      onPointerCancel={() => onTouchState({ handbrake: false })}
                      className="w-12 h-9 rounded-lg bg-[#3a1f16]/34 active:bg-[#e5a23c]/75 border border-[#e5a23c]/48 text-[#f5ede0]/90 font-hud text-[10px] font-bold"
                    >
                      DRIFT
                    </button>
                  </div>

                  <button
                    type="button"
                    aria-label="Freno y reversa"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      onTouchState({ brake: true });
                    }}
                    onPointerUp={() => onTouchState({ brake: false })}
                    onPointerLeave={() => onTouchState({ brake: false })}
                    onPointerCancel={() => onTouchState({ brake: false })}
                    className="w-12 h-[72px] sm:w-14 sm:h-20 rounded-xl bg-[#4a1815]/34 active:bg-[#c92a22]/75 border border-[#e0665e]/50 text-[#fff0ee]/90 font-hud text-[11px] font-bold"
                  >
                    FRENO
                  </button>

                  <button
                    type="button"
                    aria-label="Acelerar"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      onTouchState({ gas: true });
                    }}
                    onPointerUp={() => onTouchState({ gas: false })}
                    onPointerLeave={() => onTouchState({ gas: false })}
                    onPointerCancel={() => onTouchState({ gas: false })}
                    className="w-14 h-[84px] sm:w-16 sm:h-24 rounded-xl bg-[#193821]/34 active:bg-[#3ca856]/75 border border-[#6ee089]/52 text-[#f2fff5]/90 font-hud text-[11px] font-bold"
                  >
                    GAS
                  </button>
                </div>
              ) : (
                <div className="flex items-end gap-1.5">
                  <button
                    type="button"
                    aria-label="Correr"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      onTouchState({ nitroOrSprint: true });
                    }}
                    onPointerUp={() => onTouchState({ nitroOrSprint: false })}
                    onPointerLeave={() => onTouchState({ nitroOrSprint: false })}
                    onPointerCancel={() => onTouchState({ nitroOrSprint: false })}
                    className="w-13 h-13 sm:w-14 sm:h-14 rounded-full bg-[#100e0c]/28 active:bg-[#e5a23c]/70 active:text-[#110d09] border border-[#e5a23c]/45 text-[#f5ede0]/88 font-hud text-[10px] font-bold"
                  >
                    CORRER
                  </button>
                  <button
                    type="button"
                    aria-label="Saltar"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      onJumpOrAction();
                    }}
                    className="w-13 h-13 sm:w-14 sm:h-14 rounded-full bg-[#100e0c]/28 active:bg-[#f2e8d6]/70 active:text-[#110d09] border border-[#f2e8d6]/40 text-[#f5ede0]/88 font-hud text-[10px] font-bold"
                  >
                    SALTAR
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
});
