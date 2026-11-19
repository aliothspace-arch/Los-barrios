import React from 'react';
import type { WeatherType } from '../game/types';

interface TitleOverlayProps {
  weather: WeatherType;
  isFullscreen: boolean;
  onStart: () => void;
  onCycleWeather: () => void;
  onToggleFullscreen: () => void;
}

const WEATHER_LABEL: Record<WeatherType, string> = {
  golden: 'Atardecer Dorado',
  clear: 'Sol California',
  rain: 'Lluvia Real',
  storm: 'Tormenta',
  fog: 'Niebla Costera',
};

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  weather,
  isFullscreen,
  onStart,
  onCycleWeather,
  onToggleFullscreen,
}) => {
  return (
    <div
      className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-5 sm:p-8"
      style={{
        background:
          'linear-gradient(105deg, rgba(10,8,6,0.78) 0%, rgba(10,8,6,0.34) 44%, rgba(10,8,6,0.06) 72%, rgba(10,8,6,0.22) 100%)',
      }}
    >
      {/* Upper Left: Bespoke San Andreas SVG Emblem Lockup anchored in negative space */}
      <div className="max-w-[440px] flex flex-col items-start gap-4 mt-2 sm:mt-4">
        <svg
          viewBox="0 0 460 156"
          className="w-[290px] sm:w-[410px] h-auto drop-shadow-[0_6px_18px_rgba(0,0,0,0.85)]"
          role="img"
          aria-label="San Andreas Los Santos"
        >
          <defs>
            <linearGradient id="saGold" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fff3d6" />
              <stop offset="55%" stopColor="#f0b65a" />
              <stop offset="100%" stopColor="#c47528" />
            </linearGradient>
          </defs>
          {/* Palm silhouette accent behind banner */}
          <path
            d="M398 112 C395 82 396 58 403 34 M403 34 C382 28 366 36 355 48 M403 34 C385 18 368 18 354 24 M403 34 C418 18 436 20 448 30 M403 34 C422 32 438 42 446 56 M403 34 C409 48 416 62 418 76"
            stroke="#e09d46"
            strokeWidth="3.2"
            strokeLinecap="round"
            fill="none"
            opacity="0.82"
          />
          {/* Top framing bar */}
          <rect x="6" y="8" width="176" height="4" fill="#49b864" />
          <text
            x="6"
            y="30"
            fill="#e8dfd0"
            fontFamily="Oswald, sans-serif"
            fontSize="16"
            fontWeight="700"
            letterSpacing="5.5"
          >
            GROVE STREET · 1992
          </text>
          {/* Main Display Title */}
          <text
            x="4"
            y="96"
            fill="url(#saGold)"
            stroke="#0d0a08"
            strokeWidth="7"
            paintOrder="stroke fill"
            fontFamily="'Bebas Neue', Impact, sans-serif"
            fontSize="82"
            letterSpacing="3"
          >
            SAN ANDREAS
          </text>
          {/* Subtitle Plaque */}
          <rect x="6" y="110" width="234" height="32" fill="#0d0b09" stroke="#e2a54a" strokeWidth="1.6" />
          <text
            x="18"
            y="132"
            fill="#f5ede0"
            fontFamily="Oswald, sans-serif"
            fontSize="19"
            fontWeight="700"
            letterSpacing="4.5"
          >
            LOS SANTOS 3D
          </text>
        </svg>

        {/* Primary CTA + Secondary Weather & Fullscreen Controls (<= 3 actions) */}
        <div className="pointer-events-auto flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            data-start="true"
            onClick={(e) => {
              e.currentTarget.blur();
              onStart();
            }}
            className="px-7 py-3 bg-[#e29b38] hover:bg-[#f0ac48] active:scale-[0.98] text-[#110d09] font-display text-2xl sm:text-3xl tracking-[0.12em] border-2 border-[#14100c] shadow-[0_6px_0_#14100c] transition-transform cursor-pointer"
          >
            JUGAR AHORA
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onCycleWeather();
            }}
            aria-label="Cambiar clima de vista previa"
            className="px-3.5 py-2 bg-[#12100d]/55 hover:bg-[#221d18]/80 text-[#f2e8d8] font-hud text-xs sm:text-sm uppercase tracking-wider border border-[#e2a54a]/45 cursor-pointer"
          >
            Clima: {WEATHER_LABEL[weather]}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleFullscreen();
            }}
            aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            className="px-3 py-2 bg-[#12100d]/55 hover:bg-[#221d18]/80 text-[#f2e8d8] font-hud text-xs sm:text-sm uppercase tracking-wider border border-[#f5efe6]/25 cursor-pointer"
          >
            {isFullscreen ? 'Salir Fullscreen' : 'Pantalla Completa'}
          </button>
        </div>
      </div>
    </div>
  );
};
