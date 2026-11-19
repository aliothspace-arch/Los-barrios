import React from 'react';
import type { ShopSpec } from '../game/types';

interface ShopModalProps {
  shop: ShopSpec | null;
  cash: number;
  inVehicle: boolean;
  robCooldownSeconds: number;
  onBuyItem: (itemId: string) => void;
  onRobShop: () => void;
  onClose: () => void;
}

export const ShopModal: React.FC<ShopModalProps> = ({
  shop,
  cash,
  inVehicle,
  robCooldownSeconds,
  onBuyItem,
  onRobShop,
  onClose,
}) => {
  if (!shop) return null;

  const canRob = robCooldownSeconds <= 0;

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/72 p-3 sm:p-4 select-none"
      data-testid="shop-modal"
    >
      <div
        className="w-full max-w-xl bg-[#14110e] border-2 text-[#f4ead8] shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        style={{ borderColor: shop.accentHex }}
      >
        {/* Header Bar */}
        <div
          className="px-4 py-3 flex items-center justify-between border-b border-white/10 bg-[#1b1612]"
          style={{ borderTop: `4px solid ${shop.accentHex}` }}
        >
          <div>
            <div className="text-[10px] font-hud tracking-[0.2em] uppercase text-[#c7b8a0]">
              COMERCIO DE LOS SANTOS
            </div>
            <h2 className="font-display text-2xl sm:text-3xl tracking-wider leading-tight">
              {shop.name}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[10px] font-hud tracking-widest text-[#9f9585]">
                EFECTIVO
              </div>
              <div
                className="font-display text-2xl leading-none text-[#49b864]"
                data-testid="shop-cash-balance"
              >
                ${cash}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              data-testid="shop-close-btn"
              className="px-3 py-1.5 bg-[#29231d] hover:bg-[#3a3128] border border-white/20 font-hud text-xs tracking-wider cursor-pointer"
            >
              SALIR [ESC]
            </button>
          </div>
        </div>

        {/* Buyable Articles List */}
        <div className="p-3 sm:p-4 overflow-y-auto flex-1 space-y-2">
          {shop.items.map((item) => {
            const needsCar = Boolean(item.requiresVehicle) && !inVehicle;
            const cantAfford = cash < item.price;
            const disabled = needsCar || cantAfford;

            return (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5 bg-[#1d1814] border border-white/10"
              >
                <div className="min-w-0">
                  <div className="font-hud text-sm sm:text-base font-bold tracking-wide text-[#f6eee0]">
                    {item.name}
                  </div>
                  <div className="text-xs text-[#b5a894]">{item.description}</div>
                  {needsCar && (
                    <div className="text-[10px] font-hud tracking-wider text-[#e5a23c] mt-0.5">
                      REQUIERE ENTRAR EN COCHE
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  disabled={disabled}
                  data-testid={`buy-item-${item.id}`}
                  onClick={() => onBuyItem(item.id)}
                  className={`shrink-0 px-3.5 py-2 font-hud text-xs sm:text-sm font-bold tracking-wider border transition-colors ${
                    disabled
                      ? 'bg-[#25211d] border-white/10 text-[#6e665c] cursor-not-allowed'
                      : 'bg-[#215930] hover:bg-[#2c7540] border-[#6ee089] text-[#f2fff5] cursor-pointer'
                  }`}
                >
                  COMPRAR · ${item.price}
                </button>
              </div>
            );
          })}
        </div>

        {/* High-Stakes Interactive 3D Store Robbery Bar */}
        <div className="px-4 py-3 bg-[#1e100f] border-t border-[#c92a22]/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div>
            <div className="font-hud text-xs tracking-[0.16em] text-[#ff6b61] font-bold">
              ATRACO INTERACTIVO 3D · RIESGO LSPD {'★'.repeat(shop.robWantedStars)}
            </div>
            <div className="text-xs text-[#d6b7b2]">
              {canRob
                ? `Botín estimado: $${shop.robMin}–$${shop.robMax} · El dueño puede entregar la caja o atacarte con bate`
                : `La caja registradora está vacía · Disponible en ${Math.ceil(robCooldownSeconds)}s`}
            </div>
          </div>

          <button
            type="button"
            disabled={!canRob}
            data-testid="shop-rob-btn"
            onClick={onRobShop}
            className={`px-4 py-2 font-hud text-xs sm:text-sm font-bold tracking-widest border-2 transition-colors ${
              canRob
                ? 'bg-[#991b15] hover:bg-[#bd241c] border-[#ff756b] text-white cursor-pointer'
                : 'bg-[#2b1a19] border-white/10 text-[#7d615e] cursor-not-allowed'
            }`}
          >
            {canRob ? 'ATRACAR TIENDA' : `ENFRIANDO (${Math.ceil(robCooldownSeconds)}s)`}
          </button>
        </div>
      </div>
    </div>
  );
};
