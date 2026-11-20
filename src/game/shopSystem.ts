import type { PlayerOutfitId, ShopItem, ShopSpec } from './types';

export interface ShopTransactionContext {
  cash: number;
  health: number;
  armor: number;
  inVehicle: boolean;
  vehicleHealth: number;
  vehicleNitro: number;
  outfitId: PlayerOutfitId;
}

export interface PurchaseResult {
  ok: boolean;
  reason?: string;
  cashDelta: number;
  health?: number;
  armor?: number;
  vehicleHealth?: number;
  vehicleNitro?: number;
  outfitId?: PlayerOutfitId;
  resprayVehicle?: boolean;
  message: string;
}

export function evaluateShopPurchase(
  item: ShopItem,
  ctx: ShopTransactionContext,
): PurchaseResult {
  if (item.requiresVehicle && !ctx.inVehicle) {
    return {
      ok: false,
      reason: 'requires_vehicle',
      cashDelta: 0,
      message: 'Necesitas estar en un vehículo para este servicio',
    };
  }
  if (ctx.cash < item.price) {
    return {
      ok: false,
      reason: 'insufficient_funds',
      cashDelta: 0,
      message: `Fondos insuficientes (necesitas $${item.price})`,
    };
  }

  switch (item.effect) {
    case 'heal_full':
      return {
        ok: true,
        cashDelta: -item.price,
        health: 100,
        message: `${item.name} comprado · Salud al 100%`,
      };
    case 'heal_medium':
      return {
        ok: true,
        cashDelta: -item.price,
        health: Math.min(100, ctx.health + 45),
        message: `${item.name} comprado · +45 Salud`,
      };
    case 'armor_full':
      return {
        ok: true,
        cashDelta: -item.price,
        armor: 100,
        message: `${item.name} equipado · Blindaje al 100%`,
      };
    case 'nitro_refill':
      return {
        ok: true,
        cashDelta: -item.price,
        vehicleNitro: 100,
        message: `${item.name} cargado · Nitro N2O al 100%`,
      };
    case 'repair_vehicle':
      return {
        ok: true,
        cashDelta: -item.price,
        vehicleHealth: 100,
        message: 'Chasis y motor reparados al 100%',
      };
    case 'respray_vehicle':
      return {
        ok: true,
        cashDelta: -item.price,
        vehicleHealth: 100,
        resprayVehicle: true,
        message: 'Pintura metalizada aplicada · Búsqueda reducida',
      };
    case 'outfit_grove':
      return {
        ok: true,
        cashDelta: -item.price,
        outfitId: 'grove_jacket',
        message: 'Chaqueta Grove Street equipada',
      };
    case 'outfit_suit':
      return {
        ok: true,
        cashDelta: -item.price,
        outfitId: 'ls_suit',
        message: 'Traje Ejecutivo Los Santos equipado',
      };
    case 'outfit_red':
      return {
        ok: true,
        cashDelta: -item.price,
        outfitId: 'street_red',
        message: 'Estilo Urbano Carmesí equipado',
      };
    case 'outfit_classic':
      return {
        ok: true,
        cashDelta: -item.price,
        outfitId: 'classic_cj',
        message: 'Estilo Clásico CJ equipado',
      };
  }
}

export function findNearestShop(
  px: number,
  pz: number,
  shops: ShopSpec[],
  maxRange = 6.5,
): ShopSpec | null {
  let best: ShopSpec | null = null;
  let bestDist = maxRange;
  for (let i = 0; i < shops.length; i++) {
    const s = shops[i];
    const d = Math.hypot(s.x - px, s.z - pz);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

/**
 * Converts a world point into shop-local coordinates where +Z faces out the door / street.
 */
export function worldToShopSpace(
  shop: Pick<ShopSpec, 'originX' | 'originZ' | 'facingHeading'>,
  wx: number,
  wz: number,
): { lx: number; lz: number } {
  const dx = wx - shop.originX;
  const dz = wz - shop.originZ;
  const c = Math.cos(shop.facingHeading);
  const s = Math.sin(shop.facingHeading);
  return {
    lx: dx * c - dz * s,
    lz: dx * s + dz * c,
  };
}

/**
 * Strict counter/register interaction detector:
 * - `indoor` stores: ONLY triggers when CJ walks inside near the checkout counter (never from the sidewalk outside!).
 * - `street_cart`: triggers on foot directly in front of the street cart.
 * - `outdoor_bay`: triggers on foot at the mechanic counter OR in a car parked in the open forecourt.
 */
export function findNearestShopRegister(
  px: number,
  pz: number,
  inVehicle: boolean,
  shops: ShopSpec[],
): ShopSpec | null {
  let best: ShopSpec | null = null;
  let bestDist = Infinity;

  for (let i = 0; i < shops.length; i++) {
    const shop = shops[i];
    if (shop.venueMode === 'indoor') {
      if (inVehicle) continue;
      const local = worldToShopSpace(shop, px, pz);
      const dist = Math.hypot(shop.registerX - px, shop.registerZ - pz);
      // Must be inside front glass threshold and right beside the counter
      if (local.lz <= 2.95 && local.lz >= -1.2 && Math.abs(local.lx) <= 2.8 && dist <= 2.75) {
        if (dist < bestDist) {
          bestDist = dist;
          best = shop;
        }
      }
    } else if (shop.venueMode === 'street_cart') {
      if (inVehicle) continue;
      const dist = Math.hypot(shop.registerX - px, shop.registerZ - pz);
      if (dist <= 2.65 && dist < bestDist) {
        bestDist = dist;
        best = shop;
      }
    } else {
      // outdoor_bay (LS Customs)
      const dist = Math.hypot(shop.registerX - px, shop.registerZ - pz);
      const maxRange = inVehicle ? 8.8 : 2.9;
      if (dist <= maxRange && dist < bestDist) {
        bestDist = dist;
        best = shop;
      }
    }
  }

  return best;
}

