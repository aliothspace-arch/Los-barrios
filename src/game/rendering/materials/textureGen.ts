import * as THREE from 'three';

export interface PBRTextureSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  emissiveMap?: THREE.CanvasTexture;
}

/**
 * Fast deterministic Mulberry32 PRNG for reproducible procedural texture synthesis.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates a tangent-space normal map from a grayscale height canvas using
 * a 3x3 Sobel gradient operator with seamless periodic wrapping and fast
 * bit-masked power-of-two indexing.
 */
export function createNormalFromHeight(
  heightCanvas: HTMLCanvasElement,
  strength: number,
  anisotropy: number,
): THREE.CanvasTexture {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const srcCtx = heightCanvas.getContext('2d')!;
  const src = srcCtx.getImageData(0, 0, w, h).data;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;
  const outCtx = outCanvas.getContext('2d')!;
  const outImg = outCtx.createImageData(w, h);
  const dst = outImg.data;

  const inv255 = 1 / 255;
  const isPow2W = (w & (w - 1)) === 0;
  const isPow2H = (h & (h - 1)) === 0;
  const maskW = w - 1;
  const maskH = h - 1;

  for (let y = 0; y < h; y++) {
    const yUp = isPow2H ? (y - 1) & maskH : (y - 1 + h) % h;
    const yDn = isPow2H ? (y + 1) & maskH : (y + 1) % h;
    const rowUp = yUp * w;
    const rowMid = y * w;
    const rowDn = yDn * w;

    for (let x = 0; x < w; x++) {
      const xLt = isPow2W ? (x - 1) & maskW : (x - 1 + w) % w;
      const xRt = isPow2W ? (x + 1) & maskW : (x + 1) % w;

      const tl = src[(rowUp + xLt) << 2] * inv255;
      const t = src[(rowUp + x) << 2] * inv255;
      const tr = src[(rowUp + xRt) << 2] * inv255;
      const l = src[(rowMid + xLt) << 2] * inv255;
      const r = src[(rowMid + xRt) << 2] * inv255;
      const bl = src[(rowDn + xLt) << 2] * inv255;
      const b = src[(rowDn + x) << 2] * inv255;
      const br = src[(rowDn + xRt) << 2] * inv255;

      const dX = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dY = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      const invLen = 1 / Math.sqrt(dX * dX + dY * dY + 1.0);

      const idx = (rowMid + x) << 2;
      dst[idx] = Math.round((-dX * invLen * 0.5 + 0.5) * 255);
      dst[idx + 1] = Math.round((-dY * invLen * 0.5 + 0.5) * 255);
      dst[idx + 2] = Math.round((invLen * 0.5 + 0.5) * 255);
      dst[idx + 3] = 255;
    }
  }

  outCtx.putImageData(outImg, 0, 0);
  const tex = new THREE.CanvasTexture(outCanvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

export function finalizeTexture(
  canvas: HTMLCanvasElement,
  isColor: boolean,
  anisotropy: number,
  repeatX = 1,
  repeatY = 1,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}
