import React from 'react';
import type { BootProgressState } from '../game/core/asyncBoot';

const LOADING_BG_URL =
  '/assets/aistudio/file_0000000075ac821098d9fab3182dfb8d_18dd5f7e.png';

const LOADING_TIPS = [
  'Pulsa [O] y [U] cerca o dentro de tu Hypercar V12 para accionar las puertas diédricas de mariposa y el maletero delantero (Frunk) con amortiguadores hidráulicos.',
  'Visita Los Santos Customs para aplicar acabados Tri-Coat metalizados (Rosso Fuoco, Emerald Grove, Pacific Navy y Copper Bronze) o recargar el óxido nitroso N2O.',
  'En los atracos interactivos 3D a tiendas 24/7, vigila la tensión del encargado: puede cooperar abriendo la registradora o rebelarse con un bate.',
];

interface LoadingScreenProps {
  bootState: BootProgressState;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ bootState }) => {
  const clampedPct = Math.min(100, Math.max(0, Math.round(bootState.progress)));
  const tipIndex = Math.min(
    LOADING_TIPS.length - 1,
    Math.floor((clampedPct / 101) * LOADING_TIPS.length),
  );

  return (
    <div
      data-testid="loading-screen"
      className={`fixed inset-0 z-50 select-none overflow-hidden bg-[#08060a] ${
        bootState.ready ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Full-viewport User Key Art */}
      <img
        src={LOADING_BG_URL}
        alt="Ciudad Rota - Los Santos Loading Artwork"
        className="absolute inset-0 w-full h-full object-cover object-[60%_center]"
      />

      {/* Atmospheric bottom & edge vignette preserving 100% of characters and "Ciudad Rota" emblem */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(180deg, rgba(7,5,10,0.22) 0%, rgba(7,5,10,0.04) 48%, rgba(7,5,10,0.68) 78%, rgba(7,5,10,0.95) 100%)',
        }}
      />

      {/* Top Status Bar */}
      <div className="relative z-10 flex items-center justify-between px-5 sm:px-9 pt-4 sm:pt-6">
        <div className="flex items-center gap-2.5 bg-[#0b0910]/75 border border-[#d946ef]/40 px-3.5 py-1.5 backdrop-blur-sm">
          <span className="inline-block w-2 h-2 bg-[#e879f9]" />
          <span className="font-hud text-[11px] sm:text-xs tracking-[0.22em] uppercase text-[#f5ebff]">
            MOTOR 3D ASÍNCRONO · {bootState.stageIndex}/{bootState.totalStages}
          </span>
        </div>

        <div className="hidden sm:flex items-center gap-3 bg-[#0b0910]/75 border border-[#f59e0b]/35 px-3.5 py-1.5 backdrop-blur-sm">
          <span className="font-hud text-xs tracking-[0.18em] uppercase text-[#fde68a]">
            LOS SANTOS · GROVE STREET
          </span>
        </div>
      </div>

      {/* Bottom Cinematic Progress Dock */}
      <div className="absolute inset-x-0 bottom-0 z-10 px-5 sm:px-9 pb-5 sm:pb-8 flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="font-hud text-[11px] sm:text-xs uppercase tracking-[0.24em] text-[#e879f9]">
              {bootState.stageTitle}
            </span>
            <p className="font-sans text-xs sm:text-sm text-[#e9e2f2]/90 max-w-2xl">
              {bootState.stageDetail}
            </p>
          </div>

          <div className="flex items-baseline gap-2 self-end sm:self-auto">
            <span
              data-testid="loading-percentage"
              className="font-display text-4xl sm:text-5xl tracking-wider text-[#fdf4ff] drop-shadow-[0_3px_12px_rgba(217,70,239,0.55)]"
            >
              {clampedPct}%
            </span>
          </div>
        </div>

        {/* High-Contrast Segmented GTA / Neon Magenta-Gold Progress Track */}
        <div className="w-full h-3 sm:h-3.5 bg-[#120e18]/90 border border-[#e879f9]/45 p-0.5 shadow-[0_0_24px_rgba(0,0,0,0.85)]">
          <div
            className="h-full transition-all duration-200 ease-out"
            style={{
              width: `${clampedPct}%`,
              background:
                'linear-gradient(90deg, #c026d3 0%, #e879f9 55%, #f59e0b 100%)',
              boxShadow: '0 0 14px rgba(232, 121, 249, 0.7)',
            }}
          />
        </div>

        {/* Street Tip Footer */}
        <div className="flex items-center justify-between gap-4 pt-0.5 text-[11px] sm:text-xs text-[#cdc2db]/85 font-hud tracking-wider">
          <span className="truncate">
            CONSEJO: {LOADING_TIPS[tipIndex]}
          </span>
          <span className="shrink-0 uppercase text-[#f59e0b]/90 hidden md:inline">
            CLASS-A V12 · PBR STUDIO
          </span>
        </div>
      </div>
    </div>
  );
};
