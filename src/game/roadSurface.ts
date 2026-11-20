import { CUL_DE_SAC, INTERSECTION_CENTERS, ROAD_SEGMENTS } from './worldLayout';

const CURB_HEIGHT = 0.145;
const CURB_WIDTH = 0.42;

function smoothBevelProfile(distFromInnerEdge: number, width: number): number {
  if (distFromInnerEdge <= 0 || distFromInnerEdge >= width) return 0;
  const u = distFromInnerEdge / width;
  // Crisp beveled concrete ramp up (0..0.22), flat crown (0.22..0.78), bevel down (0.78..1.0)
  if (u < 0.22) {
    const t = u / 0.22;
    return t * t * (3 - 2 * t);
  }
  if (u > 0.78) {
    const t = (1 - u) / 0.22;
    return t * t * (3 - 2 * t);
  }
  return 1.0;
}

function isNearIntersectionOrCul(x: number, z: number): boolean {
  const dxCul = x - CUL_DE_SAC.x;
  const dzCul = z - CUL_DE_SAC.z;
  if (dxCul * dxCul + dzCul * dzCul < (CUL_DE_SAC.radius + 1.8) * (CUL_DE_SAC.radius + 1.8)) {
    return true;
  }
  for (let i = 0; i < INTERSECTION_CENTERS.length; i++) {
    const ic = INTERSECTION_CENTERS[i];
    if (Math.abs(x - ic.x) < 8.4 && Math.abs(z - ic.z) < 8.4) {
      return true;
    }
  }
  return false;
}

/**
 * Pure analytical terrain & curb height sampler at world (x, z).
 * Matches the rendered asphalt avenues, intersections, cul-de-sac ring,
 * and 0.145m raised concrete curbs without Three.js raycasting overhead.
 */
export function sampleRoadSurfaceHeight(x: number, z: number): number {
  let height = 0;
  let onAsphalt = false;

  const dxCul = x - CUL_DE_SAC.x;
  const dzCul = z - CUL_DE_SAC.z;
  const distCul = Math.hypot(dxCul, dzCul);
  if (distCul <= CUL_DE_SAC.radius) {
    onAsphalt = true;
    height = 0.015;
  } else if (
    distCul > CUL_DE_SAC.radius - 0.04 &&
    distCul < CUL_DE_SAC.radius + 0.44 &&
    !(z < CUL_DE_SAC.z && Math.abs(x - CUL_DE_SAC.x) < 7.8)
  ) {
    const profile = smoothBevelProfile(distCul - (CUL_DE_SAC.radius - 0.04), 0.48);
    if (profile > 0) {
      return Math.max(height, profile * CURB_HEIGHT);
    }
  }

  for (let i = 0; i < ROAD_SEGMENTS.length; i++) {
    const r = ROAD_SEGMENTS[i];
    const halfW = r.w * 0.5;
    const halfD = r.d * 0.5;
    const adx = Math.abs(x - r.x);
    const adz = Math.abs(z - r.z);

    if (adx <= halfW && adz <= halfD) {
      onAsphalt = true;
      height = Math.max(height, r.orientation === 'ns' ? 0.015 : 0.025);
    } else if (r.orientation === 'ns' && adz <= halfD - 0.5) {
      const curbOffset = adx - halfW;
      if (curbOffset > 0 && curbOffset < CURB_WIDTH && !isNearIntersectionOrCul(x, z)) {
        const p = smoothBevelProfile(curbOffset, CURB_WIDTH);
        height = Math.max(height, p * CURB_HEIGHT);
      }
    } else if (r.orientation === 'ew' && adx <= halfW - 0.5) {
      const curbOffset = adz - halfD;
      if (curbOffset > 0 && curbOffset < CURB_WIDTH && !isNearIntersectionOrCul(x, z)) {
        const p = smoothBevelProfile(curbOffset, CURB_WIDTH);
        height = Math.max(height, p * CURB_HEIGHT);
      }
    }
  }

  // Subtle expansion-joint ripple at intersection crosswalks (gives tactile hood/suspension life)
  if (onAsphalt) {
    for (let i = 0; i < INTERSECTION_CENTERS.length; i++) {
      const ic = INTERSECTION_CENTERS[i];
      const dx = Math.abs(x - ic.x);
      const dz = Math.abs(z - ic.z);
      if (dx < 11.0 && dz < 11.0) {
        const cwDist = Math.min(Math.abs(dx - 9.2), Math.abs(dz - 9.2));
        if (cwDist < 0.9) {
          height += (1 - cwDist / 0.9) * 0.012;
        }
      }
    }
    return height;
  }

  // Sidewalk slab outside road edges sits cleanly near 0 with gentle aggregate micro-texture
  const micro = Math.sin(x * 0.85) * Math.cos(z * 0.85) * 0.008;
  return Math.max(0, height + micro);
}
