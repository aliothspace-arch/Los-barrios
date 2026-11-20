import type { WeatherType } from '../types';

export interface StreetlampSeed {
  x: number;
  z: number;
  rotY: number;
}

export interface BulbWorldPos {
  x: number;
  y: number;
  z: number;
}

export interface WetRoadPhysicsMetrics {
  puddleCoverage: number;
  rippleAmplitude: number;
  roadClearcoat: number;
  roadEnvIntensity: number;
  tireSprayRate: number;
  mistAlpha: number;
}

export interface RainLayerSpec {
  id: 'near' | 'mid' | 'far';
  fraction: number;
  boxWidth: number;
  boxHeight: number;
  fallSpeedMin: number;
  fallSpeedMax: number;
  streakWidth: number;
  streakLengthMin: number;
  streakLengthMax: number;
  alpha: number;
  windFactor: number;
}

export const RAIN_LAYER_SPECS: readonly RainLayerSpec[] = [
  {
    id: 'near',
    fraction: 0.36,
    boxWidth: 16,
    boxHeight: 15,
    fallSpeedMin: 21.0,
    fallSpeedMax: 27.0,
    streakWidth: 0.013,
    streakLengthMin: 1.35,
    streakLengthMax: 2.25,
    alpha: 0.56,
    windFactor: 1.0,
  },
  {
    id: 'mid',
    fraction: 0.40,
    boxWidth: 28,
    boxHeight: 20,
    fallSpeedMin: 22.0,
    fallSpeedMax: 28.0,
    streakWidth: 0.017,
    streakLengthMin: 1.65,
    streakLengthMax: 2.65,
    alpha: 0.44,
    windFactor: 0.94,
  },
  {
    id: 'far',
    fraction: 0.24,
    boxWidth: 46,
    boxHeight: 24,
    fallSpeedMin: 20.0,
    fallSpeedMax: 26.0,
    streakWidth: 0.024,
    streakLengthMin: 1.95,
    streakLengthMax: 3.15,
    alpha: 0.32,
    windFactor: 0.85,
  },
];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Computes physically grounded surface wetness metrics for road clearcoat,
 * standing puddle ripple amplitude, mist density, and high-speed tire spray.
 */
export function computeWetRoadMetrics(
  wetness: number,
  rainDensity: number,
  windStrength: number,
): WetRoadPhysicsMetrics {
  const w = clamp01(wetness);
  const r = clamp01(rainDensity);
  const wind = Math.max(0, windStrength);

  const puddleCoverage = Math.pow(w, 1.35) * 0.88;
  const rippleAmplitude = w * (0.25 + 0.75 * r);
  const roadClearcoat = w > 0.08 ? Math.min(0.95, Math.pow(w, 1.1) * 0.94) : 0.06;
  const roadEnvIntensity = 0.45 + w * 0.95;
  const tireSprayRate = w > 0.25 ? clamp01((w - 0.25) * 1.35) * (0.65 + 0.35 * r) : 0;
  const mistAlpha = r > 0.2 ? clamp01((r - 0.2) * 1.25) * Math.min(1, 0.55 + wind * 0.45) : 0;

  return {
    puddleCoverage,
    rippleAmplitude,
    roadClearcoat,
    roadEnvIntensity,
    tireSprayRate,
    mistAlpha,
  };
}

/**
 * Projects each gooseneck streetlamp pole base into the actual illuminated sodium-vapor
 * bulb world coordinate (y = 7.3m, gooseneck reach = 2.3m along rotY).
 */
export function computeStreetlampBulbPosition(lamp: StreetlampSeed): BulbWorldPos {
  // Matches THREE.Vector3(0, 7.3, 2.3).applyAxisAngle((0,1,0), rotY)
  const sinY = Math.sin(lamp.rotY);
  const cosY = Math.cos(lamp.rotY);
  return {
    x: lamp.x + 2.3 * sinY,
    y: 7.3,
    z: lamp.z + 2.3 * cosY,
  };
}

/**
 * Returns the `maxCount` nearest streetlamp bulb world coordinates relative to
 * `(focusX, focusZ)` in ascending distance order so the wet-road shader can render
 * physically anchored sodium-vapor reflections and light columns with fixed uniforms.
 */
export function computeNearestLampBulbs(
  focusX: number,
  focusZ: number,
  lamps: readonly StreetlampSeed[],
  maxCount = 6,
): BulbWorldPos[] {
  const scored: Array<{ distSq: number; bulb: BulbWorldPos }> = [];
  for (let i = 0; i < lamps.length; i++) {
    const bulb = computeStreetlampBulbPosition(lamps[i]);
    const dx = bulb.x - focusX;
    const dz = bulb.z - focusZ;
    scored.push({ distSq: dx * dx + dz * dz, bulb });
  }
  scored.sort((a, b) => a.distSq - b.distSq);
  return scored.slice(0, maxCount).map((entry) => entry.bulb);
}

/**
 * Returns a realistic rain & wind angle vector (horizontal wind drift vs vertical fall speed).
 */
export function computeRainTiltRadians(windStrength: number, baseFallSpeed = 26): number {
  const windX = Math.max(0, windStrength) * 5.6;
  return Math.atan2(windX, Math.max(8, baseFallSpeed));
}

export function isRainyWeather(weather: WeatherType): boolean {
  return weather === 'rain' || weather === 'storm';
}
