import React from 'react';
import type { BootProgressState } from '../game/core/asyncBoot';

const LOADING_BG_URL =
  '/assets/aistudio/file_0000000075ac821098d9fab3182dfb8d_18dd5f7e.png';

interface LoadingScreenProps {
  bootState: BootProgressState;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ bootState }) => {
  const clampedPct = Math.min(100, Math.max(0, Math.round(bootState.progress)));

  return (
    <div
      data-testid="loading-screen"
      className={`fixed inset-0 z-50 select-none overflow-hidden bg-[#08060a] transition-opacity duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
        bootState.ready ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Blurred ambient backdrop for tall portrait screens where full cover art uses object-contain */}
      <img
        src={LOADING_BG_URL}
        alt=""
        aria-hidden="true"
        className="sm:hidden absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-45"
      />

      {/* Full-viewport Cover Artwork (contains the main "Ciudad ROTA" emblem) */}
      <img
        src={LOADING_BG_URL}
        alt="Ciudad Rota"
        className="absolute inset-0 w-full h-full object-contain sm:object-cover sm:object-[82%_45%]"
      />

      {/* Subtle bottom vignette solely to frame the loading bar cleanly */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(180deg, rgba(7,5,10,0) 68%, rgba(7,5,10,0.78) 100%)',
        }}
      />

      {/* Minimal Animated Loading Bar */}
      <div className="absolute inset-x-0 bottom-0 z-10 px-6 sm:px-12 pb-6 sm:pb-9 flex justify-center">
        <div
          role="progressbar"
          aria-label="Cargando"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={clampedPct}
          data-testid="loading-progressbar"
          className="w-full max-w-2xl h-2.5 sm:h-3 bg-[#0e0a14]/85 border border-[#e879f9]/50 p-0.5 shadow-[0_6px_28px_rgba(0,0,0,0.9)] overflow-hidden"
        >
          <div
            className="relative h-full overflow-hidden transition-[width] duration-200 ease-out"
            style={{
              width: `${clampedPct}%`,
              background:
                'linear-gradient(90deg, #c026d3 0%, #e879f9 55%, #f59e0b 100%)',
              boxShadow: '0 0 14px rgba(232, 121, 249, 0.75)',
            }}
          >
            <div
              className="loading-bar-sweep absolute inset-y-0 left-0 w-1/2"
              style={{
                background:
                  'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0) 100%)',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
