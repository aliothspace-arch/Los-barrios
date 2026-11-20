import React from 'react';
import type { GamePhase, RunSummary } from '../game/types';

interface StatusModalProps {
  phase: GamePhase;
  cash: number;
  checkpointsCleared: number;
  totalCheckpoints: number;
  runSummary: RunSummary | null;
  onResume: () => void;
  onRestart: () => void;
}

export const StatusModal: React.FC<StatusModalProps> = ({
  phase,
  cash,
  checkpointsCleared,
  totalCheckpoints,
  runSummary,
  onResume,
  onRestart,
}) => {
  if (phase !== 'paused' && phase !== 'gameover') return null;

  const isGameOver = phase === 'gameover';
  const isVictory = isGameOver && runSummary?.outcome === 'victory';

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#090807]/78 p-4">
      <div className="w-full max-w-md bg-[#14110e] border-2 border-[#e5a23c] shadow-[0_14px_40px_rgba(0,0,0,0.85)] p-6 flex flex-col gap-5">
        {/* Header */}
        <div className="border-b border-[#e5a23c]/30 pb-3">
          <div className="text-[11px] font-hud tracking-[0.22em] text-[#e5a23c] uppercase">
            LOS SANTOS · SAN ANDREAS
          </div>
          <h2
            className={`font-display text-5xl tracking-[0.08em] leading-none mt-1 ${
              isGameOver
                ? isVictory
                  ? 'text-[#5cd678]'
                  : 'text-[#d9382c]'
                : 'text-[#f5ede0]'
            }`}
          >
            {isGameOver
              ? isVictory
                ? 'MISIÓN SUPERADA'
                : 'ELIMINADO'
              : 'PAUSA'}
          </h2>
        </div>

        {/* Tabular Stats */}
        <div className="grid grid-cols-3 gap-2.5 text-center">
          <div className="bg-[#1c1814] border border-[#f5ede0]/12 p-2.5">
            <div className="text-[10px] font-hud tracking-widest text-[#b5aa96]">
              DINERO
            </div>
            <div className="font-display text-2xl text-[#49b864] mt-0.5">
              ${runSummary ? runSummary.cash : cash}
            </div>
          </div>

          <div className="bg-[#1c1814] border border-[#f5ede0]/12 p-2.5">
            <div className="text-[10px] font-hud tracking-widest text-[#b5aa96]">
              OBJETIVOS
            </div>
            <div className="font-display text-2xl text-[#f5ede0] mt-0.5">
              {runSummary ? runSummary.checkpointsCleared : checkpointsCleared}/
              {runSummary ? runSummary.totalCheckpoints : totalCheckpoints}
            </div>
          </div>

          <div className="bg-[#1c1814] border border-[#f5ede0]/12 p-2.5">
            <div className="text-[10px] font-hud tracking-widest text-[#b5aa96]">
              {runSummary ? 'DISTANCIA' : 'BÚSQUEDA'}
            </div>
            <div className="font-display text-2xl text-[#e5a23c] mt-0.5">
              {runSummary ? `${runSummary.distanceKm} KM` : 'ACTIVA'}
            </div>
          </div>
        </div>

        {/* Primary Action CTAs */}
        <div className="flex flex-col gap-2.5">
          {!isGameOver && (
            <button
              type="button"
              onClick={onResume}
              className="w-full py-2.5 bg-[#e5a23c] hover:bg-[#f2b350] text-[#110d09] font-display text-2xl tracking-[0.12em] border-2 border-[#0a0806] cursor-pointer"
            >
              REANUDAR
            </button>
          )}

          <button
            type="button"
            data-start={isGameOver ? 'true' : undefined}
            onClick={onRestart}
            className={`w-full py-2.5 font-display text-2xl tracking-[0.12em] border cursor-pointer ${
              isGameOver
                ? 'bg-[#e5a23c] hover:bg-[#f2b350] text-[#110d09] border-[#0a0806]'
                : 'bg-[#211c17] hover:bg-[#2c251f] text-[#f5ede0] border-[#f5ede0]/25'
            }`}
          >
            {isGameOver ? 'VOLVER A JUGAR' : 'REINICIAR EN GROVE ST'}
          </button>
        </div>
      </div>
    </div>
  );
};
