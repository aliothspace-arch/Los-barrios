import React from 'react';
import type { RobberyActionType, RobberyHUDState } from '../game/types';

interface RobberyOverlayProps {
  robbery: RobberyHUDState | null;
  touchControlsVisible: boolean;
  onAction: (action: RobberyActionType) => void;
  onSkipDialogue: () => void;
}

export const RobberyOverlay: React.FC<RobberyOverlayProps> = ({
  robbery,
  touchControlsVisible,
  onAction,
  onSkipDialogue,
}) => {
  if (!robbery) return null;

  const isBrawl = robbery.phase === 'rebel_brawl';
  const showLetterbox = !isBrawl;
  const qte = robbery.qte;
  const inSweetSpot =
    qte !== null && qte.progress >= qte.sweetMin && qte.progress <= qte.sweetMax;

  return (
    <div
      className="fixed inset-0 z-25 pointer-events-none select-none overflow-hidden"
      data-testid="robbery-overlay"
      data-robbery-phase={robbery.phase}
      data-robbery-outcome={robbery.outcome}
    >
      {/* Subtle Cinematic Letterbox Bars (retract automatically during real-time 3D brawl) */}
      <div
        className={`fixed top-0 inset-x-0 bg-[#080706] transition-[height] duration-300 ${
          showLetterbox ? 'h-5 sm:h-7' : 'h-0'
        }`}
      />
      <div
        className={`fixed bottom-0 inset-x-0 bg-[#080706] transition-[height] duration-300 ${
          showLetterbox ? 'h-5 sm:h-7' : 'h-0'
        }`}
      />

      {/* TOP-LEFT: Compact Robbery Header & Live Gauges (leaves Top-Right GTA Cash/HP/Stars clean) */}
      <div className="fixed top-6 sm:top-8 [@media(max-height:500px)]:top-2 left-2.5 sm:left-4 z-20 flex flex-col gap-1.5 max-w-[240px] sm:max-w-[355px] [@media(max-height:500px)]:max-w-[210px]">
        <div className="bg-[#0e0c0a]/86 border border-[#e5a23c]/50 px-3 py-2 [@media(max-height:500px)]:px-2 [@media(max-height:500px)]:py-1.5">
          <div className="flex items-center justify-between gap-2 sm:gap-3">
            <div className="min-w-0">
              <div className="text-[10px] [@media(max-height:500px)]:text-[9px] font-hud tracking-[0.14em] text-[#e5a23c] uppercase truncate">
                ATRACO · {robbery.shopName}
              </div>
              <div className="font-display text-lg sm:text-xl [@media(max-height:500px)]:text-base leading-none tracking-wider text-[#f5ede0] truncate">
                {robbery.ownerName}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[9px] font-hud tracking-widest text-[#b8ab96]">
                EN BOLSA
              </div>
              <div
                className="font-display text-xl sm:text-2xl [@media(max-height:500px)]:text-lg leading-none text-[#5ce07d] tabular-nums"
                data-testid="robbery-bag-cash"
              >
                ${robbery.bagCash}
              </div>
            </div>
          </div>

          {/* Phase-specific live gauge */}
          {(robbery.phase === 'entering' ||
            robbery.phase === 'intimidate' ||
            robbery.phase === 'branch_reveal') && (
            <div className="mt-2 space-y-1.5">
              <div>
                <div className="flex justify-between text-[10px] font-hud tracking-wider text-[#ebe1cf]">
                  <span>INTIMIDACIÓN</span>
                  <span className="tabular-nums text-[#f2c252]">
                    {robbery.intimidation}%
                  </span>
                </div>
                <div className="w-full h-2 bg-[#1e1a16] border border-white/15 mt-0.5 overflow-hidden">
                  <div
                    className="h-full bg-[#e5a23c] transition-[width] duration-100"
                    style={{ width: `${robbery.intimidation}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[10px] font-hud tracking-wider text-[#e0b8b2]">
                  <span>TENSIÓN DEL DUEÑO</span>
                  <span className="tabular-nums text-[#ff6b61]">
                    {robbery.rage}%
                  </span>
                </div>
                <div className="w-full h-1.5 bg-[#1e1615] border border-white/10 mt-0.5 overflow-hidden">
                  <div
                    className="h-full bg-[#d6362d] transition-[width] duration-100"
                    style={{ width: `${robbery.rage}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {(robbery.phase === 'comply_open' || robbery.phase === 'comply_bag') && (
            <div className="mt-2">
              <div className="flex justify-between text-[10px] font-hud tracking-wider text-[#d8ebd9]">
                <span>FAJOS EN BOLSA</span>
                <span className="tabular-nums text-[#5ce07d]">
                  {robbery.stacksCollected} / {robbery.totalStacks}
                </span>
              </div>
              <div className="w-full h-2 bg-[#162118] border border-[#5ce07d]/35 mt-0.5 overflow-hidden">
                <div
                  className="h-full bg-[#45c969] transition-[width] duration-150"
                  style={{
                    width: `${Math.round(
                      (robbery.stacksCollected / Math.max(1, robbery.totalStacks)) * 100,
                    )}%`,
                  }}
                />
              </div>
            </div>
          )}

          {(robbery.phase === 'rebel_draw' ||
            robbery.phase === 'rebel_qte_dodge' ||
            robbery.phase === 'rebel_qte_counter' ||
            robbery.phase === 'rebel_brawl') && (
            <div className="mt-2">
              <div className="flex justify-between text-[10px] font-hud tracking-wider text-[#f0d5d2]">
                <span>{robbery.clerkKo ? 'DUEÑO NOQUEADO' : 'SALUD DEL DUEÑO'}</span>
                <span className="tabular-nums text-[#ff6b61]">
                  {robbery.clerkHealth}%
                </span>
              </div>
              <div className="w-full h-2 bg-[#211312] border border-[#ff6b61]/40 mt-0.5 overflow-hidden">
                <div
                  className="h-full bg-[#d63028] transition-[width] duration-120"
                  style={{ width: `${robbery.clerkHealth}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* UPPER-CENTER FEEDBACK CALLOUT (bounded width so it never overlaps corner panels on mobile landscape) */}
      {robbery.feedbackText && (
        <div
          className="fixed top-7 sm:top-10 [@media(max-height:500px)]:top-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none text-center px-2 max-w-[300px] sm:max-w-[380px] lg:max-w-[560px]"
          data-testid="robbery-feedback"
        >
          <div
            className={`font-display text-xl sm:text-2xl lg:text-3xl [@media(max-height:500px)]:text-base [@media(max-height:500px)]:leading-tight tracking-[0.1em] hud-stroke ${
              robbery.feedbackTone === 'good'
                ? 'text-[#6ee089]'
                : robbery.feedbackTone === 'bad'
                  ? 'text-[#ff6359]'
                  : 'text-[#f2c252]'
            }`}
          >
            {robbery.feedbackText}
          </div>
        </div>
      )}

      {/* INTERACTIVE ACTION / QTE DOCK */}
      <div
        className={`fixed z-30 pointer-events-auto flex flex-col items-center gap-2 ${
          isBrawl && touchControlsVisible
            ? 'right-3 sm:right-5 w-[min(64vw,380px)] [@media(max-height:500px)]:bottom-11 bottom-24 sm:bottom-28'
            : `left-1/2 -translate-x-1/2 w-[min(92vw,520px)] ${
                robbery.dialogue
                  ? 'bottom-24 sm:bottom-28 [@media(max-height:500px)]:bottom-11'
                  : 'bottom-10 sm:bottom-12 [@media(max-height:500px)]:bottom-4'
              }`
        }`}
      >
        {/* Phase: Intimidate interactive button bar */}
        {robbery.phase === 'intimidate' && (
          <div
            className="w-full bg-[#0f0d0b]/90 border border-[#e5a23c]/60 p-2 sm:p-2.5 flex flex-col gap-1.5"
            data-testid="robbery-intimidate-controls"
          >
            <div className="text-[10px] font-hud tracking-[0.16em] text-[#d6c8b2] text-center uppercase">
              PRESIONA AL ENCARGADO PARA ABRIR LA CAJA
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
              <button
                type="button"
                data-testid="robbery-btn-intimidate"
                onPointerDown={(e) => {
                  e.preventDefault();
                  onAction('intimidate');
                }}
                className="min-h-[48px] px-2 py-2 bg-[#294d2e] hover:bg-[#35663c] active:bg-[#498752] border-2 border-[#6ee089] text-[#f2fff5] font-hud text-xs sm:text-sm font-bold tracking-wider cursor-pointer"
              >
                <div>INTIMIDAR</div>
                <div className="text-[10px] text-[#b4f2c3] font-normal">[ESPACIO]</div>
              </button>

              <button
                type="button"
                data-testid="robbery-btn-threaten"
                onPointerDown={(e) => {
                  e.preventDefault();
                  onAction('threaten');
                }}
                className="min-h-[48px] px-2 py-2 bg-[#5c3912] hover:bg-[#784b18] active:bg-[#965f20] border-2 border-[#f2c252] text-[#fff8eb] font-hud text-xs sm:text-sm font-bold tracking-wider cursor-pointer"
              >
                <div>AMENAZAR</div>
                <div className="text-[10px] text-[#fae0a2] font-normal">[Q]</div>
              </button>

              <button
                type="button"
                data-testid="robbery-btn-rush"
                onPointerDown={(e) => {
                  e.preventDefault();
                  onAction('rush');
                }}
                className="min-h-[48px] px-2 py-2 bg-[#5e1b18] hover:bg-[#7d2420] active:bg-[#a12f2a] border-2 border-[#ff756b] text-[#fff2f0] font-hud text-xs sm:text-sm font-bold tracking-wider cursor-pointer"
              >
                <div>APRESURAR</div>
                <div className="text-[10px] text-[#ffc4bf] font-normal">[E]</div>
              </button>
            </div>
          </div>
        )}

        {/* Phase: Active Timed QTE (Bagging Cash / Bat Dodge / Counter-Strike) */}
        {qte && (
          <div
            className={`w-full bg-[#0e0c0a]/92 border-2 p-2.5 sm:p-3 flex flex-col gap-2 ${
              qte.urgent
                ? 'border-[#ff5247]'
                : inSweetSpot
                  ? 'border-[#6ee089]'
                  : 'border-[#e5a23c]'
            }`}
            data-testid="robbery-qte-box"
          >
            {/* Timing progress track with highlighted sweet spot */}
            <div className="relative w-full h-3 bg-[#1f1a16] border border-white/20 overflow-hidden">
              <div
                className={`absolute inset-y-0 ${
                  qte.urgent ? 'bg-[#ff5247]/45' : 'bg-[#49c96b]/55'
                }`}
                style={{
                  left: `${qte.sweetMin * 100}%`,
                  width: `${(qte.sweetMax - qte.sweetMin) * 100}%`,
                }}
              />
              <div
                className="absolute inset-y-0 w-2 bg-white"
                style={{ left: `calc(${Math.min(98, qte.progress * 100)}% - 4px)` }}
              />
            </div>

            <button
              type="button"
              data-testid="robbery-qte-btn"
              onPointerDown={(e) => {
                e.preventDefault();
                onAction(qte.action);
              }}
              className={`w-full min-h-[50px] px-4 py-2.5 font-hud text-sm sm:text-base font-bold tracking-[0.14em] border-2 cursor-pointer transition-colors ${
                qte.urgent
                  ? 'bg-[#a61d17] hover:bg-[#c9261f] border-[#ff8980] text-white'
                  : inSweetSpot
                    ? 'bg-[#226934] hover:bg-[#2c8543] border-[#7df09a] text-white'
                    : 'bg-[#2c241b] hover:bg-[#3d3226] border-[#e5a23c] text-[#f7eedc]'
              }`}
            >
              {qte.label} · [{qte.keyHint}]
            </button>
          </div>
        )}

        {/* Phase: Real-Time 3D Brawl Action Bar */}
        {isBrawl && (
          <div
            className="w-full bg-[#0e0c0a]/88 border border-[#ff6b61]/55 p-2 [@media(max-height:500px)]:p-1.5 flex flex-col gap-1.5 [@media(max-height:500px)]:gap-1"
            data-testid="robbery-brawl-controls"
          >
            <div className="text-[10px] [@media(max-height:500px)]:text-[9px] font-hud tracking-[0.14em] text-[#e6d7c1] text-center uppercase">
              {robbery.clerkKo
                ? robbery.registerLooted
                  ? robbery.venueMode === 'indoor'
                    ? 'CAJA SAQUEADA · SAL POR LA PUERTA VERDE'
                    : 'CAJA SAQUEADA · ¡HUYE CALLE ABAJO!'
                  : 'ACÉRCATE AL MOSTRADOR PARA SAQUEAR LA CAJA O HUYE'
                : 'COMBATE 3D EN TIEMPO REAL · MUÉVETE CON WASD / JOYSTICK'}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
              {!robbery.clerkKo && (
                <button
                  type="button"
                  data-testid="robbery-btn-punch"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    onAction('punch');
                  }}
                  className="min-h-[44px] sm:min-h-[48px] flex-1 min-w-[92px] px-2.5 py-1.5 bg-[#8f241d] hover:bg-[#b52f26] border-2 border-[#ff7c73] text-white font-hud text-xs sm:text-sm font-bold tracking-wider cursor-pointer"
                >
                  GOLPEAR [E]
                </button>
              )}

              {!robbery.clerkKo && (
                <button
                  type="button"
                  data-testid="robbery-btn-dodge"
                  disabled={robbery.dodgeCooldownRatio > 0.05}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    onAction('dodge');
                  }}
                  className={`min-h-[44px] sm:min-h-[48px] flex-1 min-w-[96px] px-2.5 py-1.5 border-2 font-hud text-xs sm:text-sm font-bold tracking-wider ${
                    robbery.dodgeCooldownRatio > 0.05
                      ? 'bg-[#24201c] border-white/15 text-[#7d7368] cursor-not-allowed'
                      : 'bg-[#264663] hover:bg-[#325d82] border-[#78c0ff] text-white cursor-pointer'
                  }`}
                >
                  ESQUIVAR [ESPACIO]
                </button>
              )}

              {robbery.canLootRegister && (
                <button
                  type="button"
                  data-testid="robbery-btn-loot"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    onAction('loot_register');
                  }}
                  className="min-h-[44px] sm:min-h-[48px] flex-1 min-w-[115px] px-2.5 py-1.5 bg-[#1e6331] hover:bg-[#298242] border-2 border-[#6ee089] text-white font-hud text-xs sm:text-sm font-bold tracking-wider cursor-pointer"
                >
                  SAQUEAR CAJA [F]
                </button>
              )}

              {robbery.canExitDoor && (
                <button
                  type="button"
                  data-testid="robbery-btn-exit"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    onAction('exit_door');
                  }}
                  className="min-h-[44px] sm:min-h-[48px] px-3 py-1.5 bg-[#2b261e] hover:bg-[#3d352a] border-2 border-[#e5a23c] text-[#fff2d9] font-hud text-xs sm:text-sm font-bold tracking-wider cursor-pointer"
                >
                  HUIR [F]
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* BOTTOM-CENTER: Authentic GTA V Dialogue Subtitles (click/tap or [Tab] to skip) */}
      {robbery.dialogue && (
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.currentTarget.blur();
            onSkipDialogue();
          }}
          className={`pointer-events-auto fixed bottom-7 sm:bottom-9 [@media(max-height:500px)]:bottom-1.5 z-30 px-3 sm:px-4 py-1.5 sm:py-2 [@media(max-height:500px)]:py-1 bg-[#0a0908]/90 hover:bg-[#171411]/95 border-t border-white/20 text-center cursor-pointer ${
            isBrawl && touchControlsVisible
              ? 'right-3 sm:right-5 w-[min(64vw,520px)]'
              : 'left-1/2 -translate-x-1/2 w-[min(92vw,680px)]'
          }`}
          data-testid="robbery-subtitle"
        >
          <span
            className={`font-hud text-xs sm:text-base [@media(max-height:500px)]:text-xs font-bold tracking-wider uppercase mr-2 ${
              robbery.dialogue.role === 'cj' ? 'text-[#6ee089]' : 'text-[#f2c252]'
            }`}
          >
            {robbery.dialogue.speaker}:
          </span>
          <span className="font-hud text-xs sm:text-base [@media(max-height:500px)]:text-xs text-[#f7f2e8] tracking-wide hud-stroke-sm">
            {robbery.dialogue.text}
          </span>
          <span className="ml-2.5 text-[10px] font-tech tracking-wider text-[#b5a894] uppercase">
            [TAB]
          </span>
        </button>
      )}
    </div>
  );
};
