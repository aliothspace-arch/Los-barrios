import type { WeatherType } from '../types';

/**
 * Full 24-hour day/night cycle duration in real seconds (12 minutes = 720 s).
 */
export const DAY_CYCLE_DURATION_SEC = 720;
export const IN_GAME_HOURS_PER_SEC = 24 / DAY_CYCLE_DURATION_SEC; // 1/30 h/s (30s per in-game hour)
export const INITIAL_TIME_OF_DAY_HOURS = 17.5; // 17:30 golden California late afternoon
export const WEATHER_TRANSITION_DURATION_SEC = 16.0;

export interface RgbColorTuple {
  r: number;
  g: number;
  b: number;
}

export interface PureAtmosphereSample {
  sunElevation: number;
  sunAzimuth: number;
  sunColor: RgbColorTuple;
  sunIntensity: number;
  hemiSky: RgbColorTuple;
  hemiGround: RgbColorTuple;
  hemiIntensity: number;
  fogColor: RgbColorTuple;
  fogDensity: number;
  skyZenith: RgbColorTuple;
  skyMid: RgbColorTuple;
  skyHorizon: RgbColorTuple;
  skyGround: RgbColorTuple;
  antiSunColor: RgbColorTuple;
  sunDiscStrength: number;
  cloudCoverage: number;
  cloudDarkness: number;
  starVisibility: number;
  wetness: number;
  windStrength: number;
  rainDensity: number;
  nightFactor: number;
  exposure: number;
  warmth: number;
  bloomStrength: number;
  envIntensity: number;
  rimIntensity: number;
  lowFillIntensity: number;
}

interface TimeKeyframe {
  hour: number;
  sunElevation: number;
  sunAzimuth: number;
  sunColor: RgbColorTuple;
  sunIntensity: number;
  hemiSky: RgbColorTuple;
  hemiGround: RgbColorTuple;
  hemiIntensity: number;
  fogColor: RgbColorTuple;
  fogDensity: number;
  skyZenith: RgbColorTuple;
  skyMid: RgbColorTuple;
  skyHorizon: RgbColorTuple;
  skyGround: RgbColorTuple;
  antiSunColor: RgbColorTuple;
  sunDiscStrength: number;
  cloudCoverage: number;
  cloudDarkness: number;
  starVisibility: number;
  nightFactor: number;
  exposure: number;
  warmth: number;
  bloomStrength: number;
  envIntensity: number;
}

function rgb(hex: number): RgbColorTuple {
  return {
    r: ((hex >> 16) & 0xff) / 255,
    g: ((hex >> 8) & 0xff) / 255,
    b: (hex & 0xff) / 255,
  };
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(a: RgbColorTuple, b: RgbColorTuple, t: number): RgbColorTuple {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

function smoothCos01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return 0.5 - 0.5 * Math.cos(Math.PI * c);
}

const TIME_KEYFRAMES: readonly TimeKeyframe[] = [
  {
    // 00:00 Midnight Los Santos Neon & Starfield
    hour: 0.0,
    sunElevation: -10,
    sunAzimuth: -110,
    sunColor: rgb(0x8cb4eb),
    sunIntensity: 1.1,
    hemiSky: rgb(0x283652),
    hemiGround: rgb(0x0d0c12),
    hemiIntensity: 0.42,
    fogColor: rgb(0x0a0e18),
    fogDensity: 0.0033,
    skyZenith: rgb(0x04070f),
    skyMid: rgb(0x0a1222),
    skyHorizon: rgb(0x162238),
    skyGround: rgb(0x070910),
    antiSunColor: rgb(0x101a2e),
    sunDiscStrength: 0.0,
    cloudCoverage: 0.30,
    cloudDarkness: 0.72,
    starVisibility: 1.0,
    nightFactor: 1.0,
    exposure: 1.14,
    warmth: 0.08,
    bloomStrength: 0.26,
    envIntensity: 0.96,
  },
  {
    // 05:00 Pre-dawn Blue Hour
    hour: 5.0,
    sunElevation: -2,
    sunAzimuth: 88,
    sunColor: rgb(0xb8c8e8),
    sunIntensity: 1.25,
    hemiSky: rgb(0x314062),
    hemiGround: rgb(0x101018),
    hemiIntensity: 0.44,
    fogColor: rgb(0x20273b),
    fogDensity: 0.0029,
    skyZenith: rgb(0x081024),
    skyMid: rgb(0x1b2b4a),
    skyHorizon: rgb(0x4b4a64),
    skyGround: rgb(0x0d0f18),
    antiSunColor: rgb(0x242c47),
    sunDiscStrength: 0.08,
    cloudCoverage: 0.36,
    cloudDarkness: 0.52,
    starVisibility: 0.58,
    nightFactor: 0.72,
    exposure: 1.10,
    warmth: 0.22,
    bloomStrength: 0.23,
    envIntensity: 1.02,
  },
  {
    // 06:45 California Dawn
    hour: 6.75,
    sunElevation: 16,
    sunAzimuth: 72,
    sunColor: rgb(0xf7cbb4),
    sunIntensity: 2.25,
    hemiSky: rgb(0x58627d),
    hemiGround: rgb(0x18161f),
    hemiIntensity: 0.48,
    fogColor: rgb(0x584d59),
    fogDensity: 0.0023,
    skyZenith: rgb(0x151f3d),
    skyMid: rgb(0x3a4569),
    skyHorizon: rgb(0x8a6975),
    skyGround: rgb(0x1c1822),
    antiSunColor: rgb(0x4d3f5e),
    sunDiscStrength: 0.46,
    cloudCoverage: 0.40,
    cloudDarkness: 0.24,
    starVisibility: 0.14,
    nightFactor: 0.22,
    exposure: 1.06,
    warmth: 0.45,
    bloomStrength: 0.19,
    envIntensity: 1.16,
  },
  {
    // 09:30 Crisp Coastal Morning
    hour: 9.5,
    sunElevation: 40,
    sunAzimuth: 32,
    sunColor: rgb(0xfff1de),
    sunIntensity: 2.48,
    hemiSky: rgb(0x617390),
    hemiGround: rgb(0x1b1a21),
    hemiIntensity: 0.52,
    fogColor: rgb(0x6e8499),
    fogDensity: 0.0018,
    skyZenith: rgb(0x113363),
    skyMid: rgb(0x336399),
    skyHorizon: rgb(0x899fb5),
    skyGround: rgb(0x1e1e25),
    antiSunColor: rgb(0x607c9c),
    sunDiscStrength: 0.44,
    cloudCoverage: 0.35,
    cloudDarkness: 0.14,
    starVisibility: 0.0,
    nightFactor: 0.02,
    exposure: 1.04,
    warmth: 0.25,
    bloomStrength: 0.16,
    envIntensity: 1.22,
  },
  {
    // 13:15 High Solar Noon
    hour: 13.25,
    sunElevation: 58,
    sunAzimuth: -45,
    sunColor: rgb(0xfff6eb),
    sunIntensity: 2.58,
    hemiSky: rgb(0x687894),
    hemiGround: rgb(0x1c1b22),
    hemiIntensity: 0.54,
    fogColor: rgb(0x788da3),
    fogDensity: 0.0016,
    skyZenith: rgb(0x12386b),
    skyMid: rgb(0x366aa3),
    skyHorizon: rgb(0x8da4ba),
    skyGround: rgb(0x201f26),
    antiSunColor: rgb(0x6886a6),
    sunDiscStrength: 0.40,
    cloudCoverage: 0.32,
    cloudDarkness: 0.12,
    starVisibility: 0.0,
    nightFactor: 0.0,
    exposure: 1.04,
    warmth: 0.20,
    bloomStrength: 0.16,
    envIntensity: 1.24,
  },
  {
    // 17:30 AAA Hybrid Golden Late-Afternoon (Boot Start Time!)
    hour: 17.5,
    sunElevation: 26,
    sunAzimuth: -108,
    sunColor: rgb(0xffe4c4),
    sunIntensity: 2.45,
    hemiSky: rgb(0x5a657d),
    hemiGround: rgb(0x18161d),
    hemiIntensity: 0.50,
    fogColor: rgb(0x544849),
    fogDensity: 0.0019,
    skyZenith: rgb(0x0f223d),
    skyMid: rgb(0x2d4a6e),
    skyHorizon: rgb(0x826558),
    skyGround: rgb(0x18161d),
    antiSunColor: rgb(0x4b425c),
    sunDiscStrength: 0.50,
    cloudCoverage: 0.42,
    cloudDarkness: 0.22,
    starVisibility: 0.10,
    nightFactor: 0.14,
    exposure: 1.06,
    warmth: 0.52,
    bloomStrength: 0.18,
    envIntensity: 1.22,
  },
  {
    // 18:50 Golden Sunset & Belt of Venus
    hour: 18.83,
    sunElevation: 10,
    sunAzimuth: -122,
    sunColor: rgb(0xffcfa6),
    sunIntensity: 2.22,
    hemiSky: rgb(0x4e5570),
    hemiGround: rgb(0x151319),
    hemiIntensity: 0.47,
    fogColor: rgb(0x4d3f44),
    fogDensity: 0.0023,
    skyZenith: rgb(0x0d1a33),
    skyMid: rgb(0x293b5e),
    skyHorizon: rgb(0x8c5c4e),
    skyGround: rgb(0x16131a),
    antiSunColor: rgb(0x54405c),
    sunDiscStrength: 0.56,
    cloudCoverage: 0.46,
    cloudDarkness: 0.28,
    starVisibility: 0.28,
    nightFactor: 0.34,
    exposure: 1.08,
    warmth: 0.58,
    bloomStrength: 0.20,
    envIntensity: 1.14,
  },
  {
    // 20:10 Dusk / Twilight
    hour: 20.17,
    sunElevation: -3,
    sunAzimuth: -116,
    sunColor: rgb(0xa3b3de),
    sunIntensity: 1.32,
    hemiSky: rgb(0x2f3b58),
    hemiGround: rgb(0x0f0e15),
    hemiIntensity: 0.43,
    fogColor: rgb(0x181c2b),
    fogDensity: 0.0030,
    skyZenith: rgb(0x060a17),
    skyMid: rgb(0x111a30),
    skyHorizon: rgb(0x2a2b42),
    skyGround: rgb(0x090b12),
    antiSunColor: rgb(0x242038),
    sunDiscStrength: 0.08,
    cloudCoverage: 0.36,
    cloudDarkness: 0.60,
    starVisibility: 0.80,
    nightFactor: 0.86,
    exposure: 1.12,
    warmth: 0.16,
    bloomStrength: 0.24,
    envIntensity: 1.00,
  },
];

export function wrapTimeOfDayHours(hours: number): number {
  const m = hours % 24;
  return m < 0 ? m + 24 : m;
}

export function advanceTimeOfDay(hours: number, dtSec: number): number {
  return wrapTimeOfDayHours(hours + dtSec * IN_GAME_HOURS_PER_SEC);
}

export function formatClockHHMM(hours: number): string {
  const wrapped = wrapTimeOfDayHours(hours);
  const totalMinutes = Math.floor(wrapped * 60 + 1e-6) % (24 * 60);
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function evaluateDayNightBase(timeOfDayHours: number): PureAtmosphereSample {
  const h = wrapTimeOfDayHours(timeOfDayHours);
  const n = TIME_KEYFRAMES.length;
  let k0 = TIME_KEYFRAMES[n - 1];
  let k1 = TIME_KEYFRAMES[0];
  let span = 24 - k0.hour + k1.hour;
  let dist = h >= k0.hour ? h - k0.hour : 24 - k0.hour + h;

  for (let i = 0; i < n - 1; i++) {
    if (h >= TIME_KEYFRAMES[i].hour && h < TIME_KEYFRAMES[i + 1].hour) {
      k0 = TIME_KEYFRAMES[i];
      k1 = TIME_KEYFRAMES[i + 1];
      span = k1.hour - k0.hour;
      dist = h - k0.hour;
      break;
    }
  }

  const t = smoothCos01(dist / Math.max(1e-5, span));
  const nightFactor = lerpNum(k0.nightFactor, k1.nightFactor, t);

  return {
    sunElevation: lerpNum(k0.sunElevation, k1.sunElevation, t),
    sunAzimuth: lerpNum(k0.sunAzimuth, k1.sunAzimuth, t),
    sunColor: lerpRgb(k0.sunColor, k1.sunColor, t),
    sunIntensity: lerpNum(k0.sunIntensity, k1.sunIntensity, t),
    hemiSky: lerpRgb(k0.hemiSky, k1.hemiSky, t),
    hemiGround: lerpRgb(k0.hemiGround, k1.hemiGround, t),
    hemiIntensity: lerpNum(k0.hemiIntensity, k1.hemiIntensity, t),
    fogColor: lerpRgb(k0.fogColor, k1.fogColor, t),
    fogDensity: lerpNum(k0.fogDensity, k1.fogDensity, t),
    skyZenith: lerpRgb(k0.skyZenith, k1.skyZenith, t),
    skyMid: lerpRgb(k0.skyMid, k1.skyMid, t),
    skyHorizon: lerpRgb(k0.skyHorizon, k1.skyHorizon, t),
    skyGround: lerpRgb(k0.skyGround, k1.skyGround, t),
    antiSunColor: lerpRgb(k0.antiSunColor, k1.antiSunColor, t),
    sunDiscStrength: lerpNum(k0.sunDiscStrength, k1.sunDiscStrength, t),
    cloudCoverage: lerpNum(k0.cloudCoverage, k1.cloudCoverage, t),
    cloudDarkness: lerpNum(k0.cloudDarkness, k1.cloudDarkness, t),
    starVisibility: lerpNum(k0.starVisibility, k1.starVisibility, t),
    wetness: 0.0,
    windStrength: 0.20,
    rainDensity: 0.0,
    nightFactor,
    exposure: lerpNum(k0.exposure, k1.exposure, t),
    warmth: lerpNum(k0.warmth, k1.warmth, t),
    bloomStrength: lerpNum(k0.bloomStrength, k1.bloomStrength, t),
    envIntensity: lerpNum(k0.envIntensity, k1.envIntensity, t),
    rimIntensity: lerpNum(0.85, 0.65, nightFactor),
    lowFillIntensity: lerpNum(0.48, 0.36, nightFactor),
  };
}

export function applyWeatherOverlay(
  base: PureAtmosphereSample,
  weather: WeatherType,
): PureAtmosphereSample {
  const n = base.nightFactor;
  const out: PureAtmosphereSample = {
    ...base,
    sunColor: { ...base.sunColor },
    hemiSky: { ...base.hemiSky },
    hemiGround: { ...base.hemiGround },
    fogColor: { ...base.fogColor },
    skyZenith: { ...base.skyZenith },
    skyMid: { ...base.skyMid },
    skyHorizon: { ...base.skyHorizon },
    skyGround: { ...base.skyGround },
    antiSunColor: { ...base.antiSunColor },
  };

  if (weather === 'golden') {
    out.cloudCoverage = Math.max(out.cloudCoverage, 0.43);
    out.windStrength = 0.24;
    return out;
  }

  if (weather === 'clear') {
    out.fogDensity *= 0.66;
    out.cloudCoverage = 0.24;
    out.cloudDarkness *= 0.65;
    out.windStrength = 0.16;
    return out;
  }

  if (weather === 'fog') {
    out.fogDensity = 0.0086;
    out.fogColor = lerpRgb(rgb(0x626e78), rgb(0x131b26), n);
    out.skyZenith = lerpRgb(rgb(0x485560), rgb(0x0e141d), n);
    out.skyMid = lerpRgb(rgb(0x586670), rgb(0x131b26), n);
    out.skyHorizon = lerpRgb(rgb(0x687680), rgb(0x18212d), n);
    out.skyGround = lerpRgb(rgb(0x22262b), rgb(0x0c1017), n);
    out.antiSunColor = { ...out.skyHorizon };
    out.sunColor = lerpRgb(rgb(0xd0d8e0), rgb(0x6c86a6), n);
    out.sunIntensity = lerpNum(1.35, 0.65, n);
    out.hemiSky = lerpRgb(rgb(0x768490), rgb(0x2c3a4d), n);
    out.hemiGround = rgb(0x1c1d22);
    out.hemiIntensity = 0.58;
    out.sunDiscStrength = 0.05;
    out.cloudCoverage = 0.78;
    out.cloudDarkness = 0.52;
    out.starVisibility = 0.0;
    out.wetness = 0.18;
    out.windStrength = 0.18;
    out.exposure = 0.98;
    out.warmth = 0.16;
    out.envIntensity = 1.06;
    return out;
  }

  if (weather === 'rain') {
    out.fogDensity = 0.0068;
    out.fogColor = lerpRgb(rgb(0x34414f), rgb(0x0c121d), n);
    out.skyZenith = lerpRgb(rgb(0x1d2630), rgb(0x080c14), n);
    out.skyMid = lerpRgb(rgb(0x2c3846), rgb(0x0d131f), n);
    out.skyHorizon = lerpRgb(rgb(0x3b4958), rgb(0x111926), n);
    out.skyGround = rgb(0x151920);
    out.antiSunColor = { ...out.skyHorizon };
    out.sunColor = rgb(0xa4bad0);
    out.sunIntensity = lerpNum(1.45, 0.75, n);
    out.hemiSky = rgb(0x55697d);
    out.hemiGround = rgb(0x181b22);
    out.hemiIntensity = 0.64;
    out.sunDiscStrength = 0.0;
    out.cloudCoverage = 0.88;
    out.cloudDarkness = 0.76;
    out.starVisibility = 0.0;
    out.wetness = 0.88;
    out.windStrength = 0.68;
    out.rainDensity = 0.75;
    out.nightFactor = Math.max(out.nightFactor, 0.68);
    out.exposure = 0.98;
    out.warmth = 0.16;
    out.bloomStrength = 0.22;
    out.envIntensity = 1.06;
    return out;
  }

  // storm
  out.fogDensity = 0.0094;
  out.fogColor = rgb(0x141c26);
  out.skyZenith = rgb(0x090d14);
  out.skyMid = rgb(0x101822);
  out.skyHorizon = rgb(0x18222e);
  out.skyGround = rgb(0x0c1017);
  out.antiSunColor = rgb(0x151e2a);
  out.sunColor = rgb(0x7d94ad);
  out.sunIntensity = 0.88;
  out.hemiSky = rgb(0x364659);
  out.hemiGround = rgb(0x12151c);
  out.hemiIntensity = 0.56;
  out.sunDiscStrength = 0.0;
  out.cloudCoverage = 0.95;
  out.cloudDarkness = 0.90;
  out.starVisibility = 0.0;
  out.wetness = 1.0;
  out.windStrength = 1.2;
  out.rainDensity = 1.0;
  out.nightFactor = Math.max(out.nightFactor, 0.88);
  out.exposure = 0.94;
  out.warmth = 0.14;
  out.bloomStrength = 0.23;
  out.envIntensity = 0.94;
  return out;
}

export function blendAtmosphereSamples(
  a: PureAtmosphereSample,
  b: PureAtmosphereSample,
  tRaw: number,
): PureAtmosphereSample {
  const t = smoothCos01(tRaw);
  return {
    sunElevation: lerpNum(a.sunElevation, b.sunElevation, t),
    sunAzimuth: lerpNum(a.sunAzimuth, b.sunAzimuth, t),
    sunColor: lerpRgb(a.sunColor, b.sunColor, t),
    sunIntensity: lerpNum(a.sunIntensity, b.sunIntensity, t),
    hemiSky: lerpRgb(a.hemiSky, b.hemiSky, t),
    hemiGround: lerpRgb(a.hemiGround, b.hemiGround, t),
    hemiIntensity: lerpNum(a.hemiIntensity, b.hemiIntensity, t),
    fogColor: lerpRgb(a.fogColor, b.fogColor, t),
    fogDensity: lerpNum(a.fogDensity, b.fogDensity, t),
    skyZenith: lerpRgb(a.skyZenith, b.skyZenith, t),
    skyMid: lerpRgb(a.skyMid, b.skyMid, t),
    skyHorizon: lerpRgb(a.skyHorizon, b.skyHorizon, t),
    skyGround: lerpRgb(a.skyGround, b.skyGround, t),
    antiSunColor: lerpRgb(a.antiSunColor, b.antiSunColor, t),
    sunDiscStrength: lerpNum(a.sunDiscStrength, b.sunDiscStrength, t),
    cloudCoverage: lerpNum(a.cloudCoverage, b.cloudCoverage, t),
    cloudDarkness: lerpNum(a.cloudDarkness, b.cloudDarkness, t),
    starVisibility: lerpNum(a.starVisibility, b.starVisibility, t),
    wetness: lerpNum(a.wetness, b.wetness, t),
    windStrength: lerpNum(a.windStrength, b.windStrength, t),
    rainDensity: lerpNum(a.rainDensity, b.rainDensity, t),
    nightFactor: lerpNum(a.nightFactor, b.nightFactor, t),
    exposure: lerpNum(a.exposure, b.exposure, t),
    warmth: lerpNum(a.warmth, b.warmth, t),
    bloomStrength: lerpNum(a.bloomStrength, b.bloomStrength, t),
    envIntensity: lerpNum(a.envIntensity, b.envIntensity, t),
    rimIntensity: lerpNum(a.rimIntensity, b.rimIntensity, t),
    lowFillIntensity: lerpNum(a.lowFillIntensity, b.lowFillIntensity, t),
  };
}

const WEATHER_MARKOV_TABLE: Record<
  WeatherType,
  ReadonlyArray<{ next: WeatherType; weight: number }>
> = {
  golden: [
    { next: 'clear', weight: 0.44 },
    { next: 'fog', weight: 0.26 },
    { next: 'rain', weight: 0.22 },
    { next: 'storm', weight: 0.08 },
  ],
  clear: [
    { next: 'golden', weight: 0.45 },
    { next: 'fog', weight: 0.22 },
    { next: 'rain', weight: 0.23 },
    { next: 'storm', weight: 0.10 },
  ],
  fog: [
    { next: 'clear', weight: 0.38 },
    { next: 'golden', weight: 0.32 },
    { next: 'rain', weight: 0.24 },
    { next: 'storm', weight: 0.06 },
  ],
  rain: [
    { next: 'storm', weight: 0.30 },
    { next: 'fog', weight: 0.30 },
    { next: 'clear', weight: 0.25 },
    { next: 'golden', weight: 0.15 },
  ],
  storm: [
    { next: 'rain', weight: 0.56 },
    { next: 'fog', weight: 0.26 },
    { next: 'clear', weight: 0.18 },
  ],
};

export function pickNextMarkovWeather(
  current: WeatherType,
  rand01: number,
): WeatherType {
  const choices = WEATHER_MARKOV_TABLE[current];
  const r = Math.min(0.999999, Math.max(0, rand01));
  let accum = 0;
  for (let i = 0; i < choices.length; i++) {
    accum += choices[i].weight;
    if (r < accum) return choices[i].next;
  }
  return choices[choices.length - 1].next;
}

export interface DynamicAtmosphereState {
  timeOfDayHours: number;
  prevWeather: WeatherType;
  weather: WeatherType;
  weatherBlend: number; // 0..1 (1 = fully transitioned to `weather`)
  dwellTimerSec: number;
}

export function createInitialAtmosphereState(rng = Math.random): DynamicAtmosphereState {
  return {
    timeOfDayHours: INITIAL_TIME_OF_DAY_HOURS,
    prevWeather: 'golden',
    weather: 'golden',
    weatherBlend: 1.0,
    dwellTimerSec: 52 + rng() * 38, // 52..90s before first organic weather shift
  };
}

export function stepAtmosphereState(
  state: DynamicAtmosphereState,
  dtSec: number,
  rng = Math.random,
): { weatherChangedTo: WeatherType | null } {
  state.timeOfDayHours = advanceTimeOfDay(state.timeOfDayHours, dtSec);

  if (state.weatherBlend < 1.0) {
    state.weatherBlend = Math.min(
      1.0,
      state.weatherBlend + dtSec / WEATHER_TRANSITION_DURATION_SEC,
    );
  }

  let weatherChangedTo: WeatherType | null = null;
  state.dwellTimerSec -= dtSec;
  if (state.dwellTimerSec <= 0) {
    const nextW = pickNextMarkovWeather(state.weather, rng());
    state.prevWeather = state.weather;
    state.weather = nextW;
    state.weatherBlend = 0.0;
    state.dwellTimerSec = 45 + rng() * 50; // 45..95 seconds per weather window
    weatherChangedTo = nextW;
  }

  return { weatherChangedTo };
}

export function evaluateDynamicAtmosphere(
  state: DynamicAtmosphereState,
): PureAtmosphereSample {
  const dayBase = evaluateDayNightBase(state.timeOfDayHours);
  if (state.weatherBlend >= 0.9999 || state.prevWeather === state.weather) {
    return applyWeatherOverlay(dayBase, state.weather);
  }
  const fromSample = applyWeatherOverlay(dayBase, state.prevWeather);
  const toSample = applyWeatherOverlay(dayBase, state.weather);
  return blendAtmosphereSamples(fromSample, toSample, state.weatherBlend);
}

/**
 * Pure Rodrigues rotation for verifying dihedral butterfly door kinematics
 * in headless unit tests without DOM or WebGL overhead.
 */
export function rotatePointAroundAxis(
  point: readonly [number, number, number],
  pivot: readonly [number, number, number],
  axis: readonly [number, number, number],
  angleRad: number,
): [number, number, number] {
  const axLen = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const kx = axis[0] / axLen;
  const ky = axis[1] / axLen;
  const kz = axis[2] / axLen;

  const px = point[0] - pivot[0];
  const py = point[1] - pivot[1];
  const pz = point[2] - pivot[2];

  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const dot = kx * px + ky * py + kz * pz;

  // k × p
  const cx = ky * pz - kz * py;
  const cy = kz * px - kx * pz;
  const cz = kx * py - ky * px;

  const rx = px * cosA + cx * sinA + kx * dot * (1 - cosA);
  const ry = py * cosA + cy * sinA + ky * dot * (1 - cosA);
  const rz = pz * cosA + cz * sinA + kz * dot * (1 - cosA);

  return [pivot[0] + rx, pivot[1] + ry, pivot[2] + rz];
}
