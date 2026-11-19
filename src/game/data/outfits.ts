import type { PlayerOutfitId } from '../types';

export interface OutfitColorScheme {
  readonly shirt: number;
  readonly pants: number;
}

/**
 * Single source of truth for CJ's wearable outfit palettes across both
 * open-world gameplay and interior scenes (shops / robberies / cutscenes).
 */
export const OUTFIT_PALETTES: Record<PlayerOutfitId, OutfitColorScheme> = {
  classic_cj: { shirt: 0xd0cbc0, pants: 0x263f59 },
  grove_jacket: { shirt: 0x1f5c2d, pants: 0x232528 },
  ls_suit: { shirt: 0x1b1e24, pants: 0x16181d },
  street_red: { shirt: 0x8f2420, pants: 0x22262e },
};

export function getOutfitPalette(outfitId: PlayerOutfitId): OutfitColorScheme {
  return OUTFIT_PALETTES[outfitId] ?? OUTFIT_PALETTES.classic_cj;
}

export const RESPRAY_PALETTE: readonly number[] = [
  0x1d4d2c, // Grove Metallic Green
  0x1c3d7a, // Pacific Midnight Blue
  0x8c1e1b, // Crimson Cherry
  0xc88a1e, // Sunset California Gold
  0x23252a, // Obsidian Black
  0x6b2c82, // Vinewood Violet
];
