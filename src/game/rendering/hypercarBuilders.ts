import * as THREE from 'three';
import type { VehicleSpec } from '../types';

/**
 * ============================================================================
 * HYPERCAR MID-ENGINE V12 — CLASS-A PARAMETRIC GEOMETRY & AAA PBR ENGINE
 * ============================================================================
 * Full mathematical port of the Class-A Mid-Engine V12 Hypercar:
 * - Zero simple primitives: C2 parametric surfaces, centripetal Catmull-Rom
 *   spline lofts, variable elliptical Frenet tubes, sculpted NACA airfoils,
 *   and multi-profile lathes.
 * - Master Geometry & Texture Cache: compiles every Class-A BufferGeometry
 *   and procedural PBR map once (`userData.shared = true`) so all 26 vehicles
 *   in Los Santos share the same GPU vertex buffers while maintaining
 *   independent articulated hierarchies (Ackermann steering, forged 10-Y-spoke
 *   wheels, dihedral butterfly doors, 44° frunk with Weekender duffel bag,
 *   4 real-time telescopic hydraulic struts, and synchronized D-steering wheel).
 */

export const clamp = (v: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const safeNum = (v: number, fallback = 0): number => (Number.isFinite(v) ? v : fallback);

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const d = e1 - e0;
  if (Math.abs(d) < 1e-8) return x < e0 ? 0 : 1;
  const t = clamp((x - e0) / d, 0, 1);
  return t * t * (3 - 2 * t);
};

export const smootherstep = (e0: number, e1: number, x: number): number => {
  const d = e1 - e0;
  if (Math.abs(d) < 1e-8) return x < e0 ? 0 : 1;
  const t = clamp((x - e0) / d, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

const gauss = (x: number, mu: number, sigma: number): number => {
  const s = Math.max(Math.abs(sigma), 1e-5);
  return Math.exp(-0.5 * Math.pow((x - mu) / s, 2));
};

// Master dimensions of the V12 Hypercar (~4.58 m x 2.04 m x 1.13 m, wheelbase 2.72 m)
export const HYPERCAR_SPEC = {
  fZ: 1.38,
  fR: 0.345,
  fW: 0.275,
  fOuterX: 0.965,
  fTrack: 0.965 - 0.275 * 0.5,
  fArchR: 0.382,

  rZ: -1.34,
  rR: 0.365,
  rW: 0.345,
  rOuterX: 1.005,
  rTrack: 1.005 - 0.345 * 0.5,
  rArchR: 0.405,
} as const;

export interface ParametricOptions {
  uvScaleU?: number;
  uvScaleV?: number;
  worldUV?: boolean;
  flipWinding?: boolean;
  closedU?: boolean;
  closedV?: boolean;
  forceSymmetrySeamX0?: boolean;
}

export function buildParametricSurface(
  uSegs: number,
  vSegs: number,
  evalFn: (u: number, v: number) => [number, number, number],
  options: ParametricOptions = {},
): THREE.BufferGeometry {
  const {
    uvScaleU = 1.0,
    uvScaleV = 1.0,
    worldUV = false,
    flipWinding = false,
    closedU = false,
    closedV = false,
    forceSymmetrySeamX0 = false,
  } = options;

  const uCount = uSegs + 1;
  const vCount = vSegs + 1;
  const positions = new Float32Array(uCount * vCount * 3);
  const uvs = new Float32Array(uCount * vCount * 2);

  let pIdx = 0;
  let uvIdx = 0;
  for (let iu = 0; iu <= uSegs; iu++) {
    const u = iu / uSegs;
    for (let iv = 0; iv <= vSegs; iv++) {
      const v = iv / vSegs;
      const p = evalFn(u, v);
      const px = safeNum(p[0], 0);
      const py = safeNum(p[1], 0);
      const pz = safeNum(p[2], 0);
      positions[pIdx++] = px;
      positions[pIdx++] = py;
      positions[pIdx++] = pz;

      if (worldUV) {
        uvs[uvIdx++] = (pz * 0.9 + py * 0.42) * uvScaleU;
        uvs[uvIdx++] = (px * 0.9 + py * 0.46) * uvScaleV;
      } else {
        uvs[uvIdx++] = u * uvScaleU;
        uvs[uvIdx++] = v * uvScaleV;
      }
    }
  }

  const indices: number[] = [];
  for (let iu = 0; iu < uSegs; iu++) {
    for (let iv = 0; iv < vSegs; iv++) {
      const a = iu * vCount + iv;
      const b = (iu + 1) * vCount + iv;
      const c = (iu + 1) * vCount + (iv + 1);
      const d = iu * vCount + (iv + 1);
      if (flipWinding) {
        indices.push(a, c, b, a, d, c);
      } else {
        indices.push(a, b, c, a, c, d);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const normals = geo.attributes.normal as THREE.BufferAttribute;
  const pos = geo.attributes.position as THREE.BufferAttribute;

  if (closedV) {
    for (let iu = 0; iu <= uSegs; iu++) {
      const i0 = iu * vCount;
      const i1 = iu * vCount + vSegs;
      const nx = normals.getX(i0) + normals.getX(i1);
      const ny = normals.getY(i0) + normals.getY(i1);
      const nz = normals.getZ(i0) + normals.getZ(i1);
      const l = Math.hypot(nx, ny, nz) || 1;
      normals.setXYZ(i0, nx / l, ny / l, nz / l);
      normals.setXYZ(i1, nx / l, ny / l, nz / l);
    }
  }
  if (closedU) {
    for (let iv = 0; iv <= vSegs; iv++) {
      const i0 = iv;
      const i1 = uSegs * vCount + iv;
      const nx = normals.getX(i0) + normals.getX(i1);
      const ny = normals.getY(i0) + normals.getY(i1);
      const nz = normals.getZ(i0) + normals.getZ(i1);
      const l = Math.hypot(nx, ny, nz) || 1;
      normals.setXYZ(i0, nx / l, ny / l, nz / l);
      normals.setXYZ(i1, nx / l, ny / l, nz / l);
    }
  }
  if (forceSymmetrySeamX0) {
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getX(i)) < 1e-4) {
        const ny = normals.getY(i);
        const nz = normals.getZ(i);
        const l = Math.hypot(ny, nz) || 1;
        normals.setXYZ(i, 0, ny / l, nz / l);
      }
    }
  }
  normals.needsUpdate = true;
  geo.userData.shared = true;
  return geo;
}

type PointInput = [number, number, number] | THREE.Vector3;

function sanitizeCurvePoints(points: PointInput[], closed = false): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const v =
      p instanceof THREE.Vector3
        ? p.clone()
        : new THREE.Vector3(safeNum(p[0]), safeNum(p[1]), safeNum(p[2]));
    if (out.length === 0 || out[out.length - 1].distanceToSquared(v) > 1e-8) {
      out.push(v);
    }
  }
  if (closed && out.length > 2 && out[0].distanceToSquared(out[out.length - 1]) < 1e-8) {
    out.pop();
  }
  if (out.length < 2) {
    const base = out[0] || new THREE.Vector3();
    out.push(base.clone().add(new THREE.Vector3(0, 0, 0.001)));
  }
  return out;
}

function buildSplineLoft(
  stations: PointInput[][],
  uSegs: number,
  vSegs: number,
  options: ParametricOptions = {},
): THREE.BufferGeometry {
  const {
    closedV = false,
    worldUV = true,
    uvScaleU = 1.0,
    uvScaleV = 1.0,
    flipWinding = false,
  } = options;

  const sampled = stations.map((pts) => {
    const vecs = sanitizeCurvePoints(pts, closedV);
    const curve = new THREE.CatmullRomCurve3(vecs, closedV, 'centripetal', 0.5);
    const row: THREE.Vector3[] = [];
    for (let iv = 0; iv <= vSegs; iv++) {
      row.push(curve.getPoint(iv / vSegs));
    }
    return row;
  });

  const longCurves: THREE.CatmullRomCurve3[] = [];
  for (let iv = 0; iv <= vSegs; iv++) {
    const col = sanitizeCurvePoints(
      sampled.map((r) => r[iv]),
      false,
    );
    longCurves.push(new THREE.CatmullRomCurve3(col, false, 'centripetal', 0.5));
  }

  const tmp = new THREE.Vector3();
  return buildParametricSurface(
    uSegs,
    vSegs,
    (u, v) => {
      const iv = clamp(Math.round(v * vSegs), 0, vSegs);
      longCurves[iv].getPoint(clamp(u, 0, 1), tmp);
      return [tmp.x, tmp.y, tmp.z];
    },
    { closedV, worldUV, uvScaleU, uvScaleV, flipWinding },
  );
}

type RadiusSpec = number | [number, number] | ((t: number) => number | [number, number]);

interface VariableTubeOptions {
  closed?: boolean;
  capStart?: boolean;
  capEnd?: boolean;
  aspectY?: number;
  worldUV?: boolean;
  uvScaleU?: number;
  uvScaleV?: number;
}

function buildVariableTube(
  points: PointInput[],
  radiusFn: RadiusSpec,
  tubularSegs = 32,
  radialSegs = 12,
  options: VariableTubeOptions = {},
): THREE.BufferGeometry {
  const {
    closed = false,
    capStart = true,
    capEnd = true,
    aspectY = 1.0,
    worldUV = false,
    uvScaleU = 2.0,
    uvScaleV = 1.0,
  } = options;

  const vecs = sanitizeCurvePoints(points, closed);
  const curve = new THREE.CatmullRomCurve3(vecs, closed, 'centripetal', 0.5);
  const frames = curve.computeFrenetFrames(tubularSegs, closed);

  const extraStart = !closed && capStart ? 2 : 0;
  const extraEnd = !closed && capEnd ? 2 : 0;
  const totalU = tubularSegs + extraStart + extraEnd;

  const pt = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const tangent = new THREE.Vector3();

  return buildParametricSurface(
    totalU,
    radialSegs,
    (uRaw, v) => {
      const idxF = uRaw * totalU;
      let t = 0;
      let capScale = 1.0;
      let capPush = 0.0;

      if (idxF < extraStart) {
        t = 0;
        const ang = (idxF / extraStart) * Math.PI * 0.5;
        capScale = Math.sin(ang);
        capPush = -Math.cos(ang);
      } else if (idxF > extraStart + tubularSegs) {
        t = 1;
        const ang = ((idxF - extraStart - tubularSegs) / extraEnd) * Math.PI * 0.5;
        capScale = Math.cos(ang);
        capPush = Math.sin(ang);
      } else {
        t = (idxF - extraStart) / tubularSegs;
      }

      const fIdx = clamp(Math.round(t * tubularSegs), 0, tubularSegs);
      curve.getPointAt(clamp(t, 0, 1), pt);
      normal.copy(frames.normals[fIdx]);
      binormal.copy(frames.binormals[fIdx]);
      tangent.copy(frames.tangents[fIdx]);

      const radRes = typeof radiusFn === 'function' ? radiusFn(t) : radiusFn;
      const rx = Math.max(1e-5, (Array.isArray(radRes) ? radRes[0] : radRes) * capScale);
      const ry = Math.max(
        1e-5,
        (Array.isArray(radRes) ? radRes[1] : radRes * aspectY) * capScale,
      );
      const pushR = (Array.isArray(radRes) ? Math.min(radRes[0], radRes[1]) : radRes) * 0.6;

      const theta = v * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      return [
        pt.x + (normal.x * cosT * rx + binormal.x * sinT * ry) + tangent.x * capPush * pushR,
        pt.y + (normal.y * cosT * rx + binormal.y * sinT * ry) + tangent.y * capPush * pushR,
        pt.z + (normal.z * cosT * rx + binormal.z * sinT * ry) + tangent.z * capPush * pushR,
      ];
    },
    { closedV: true, closedU: closed, worldUV, uvScaleU, uvScaleV },
  );
}

interface AirfoilSectionSpec {
  x: number;
  y: number;
  z: number;
  chord: number;
  thickness: number;
  camber?: number;
  pitch?: number;
  roll?: number;
}

function buildSculptedAirfoil(
  uSegs: number,
  vSegs: number,
  specFn: (u: number) => AirfoilSectionSpec,
): THREE.BufferGeometry {
  return buildParametricSurface(
    uSegs,
    vSegs,
    (u, v) => {
      const s = specFn(u);
      const theta = v * Math.PI * 2;
      const xc = 0.5 * (1 + Math.cos(theta));
      const sign = Math.sin(theta) >= 0 ? 1 : -1;

      const yt =
        5 *
        s.thickness *
        (0.2969 * Math.sqrt(Math.max(xc, 1e-6)) -
          0.126 * xc -
          0.3516 * xc * xc +
          0.2843 * xc * xc * xc -
          0.1015 * xc * xc * xc * xc);
      const yc = (s.camber || 0) * 4 * xc * (1 - xc);

      const localZ = (0.35 - xc) * s.chord;
      const localY = (yc + sign * yt) * s.chord;

      const cosP = Math.cos(s.pitch || 0);
      const sinP = Math.sin(s.pitch || 0);
      const rotZ = localZ * cosP - localY * sinP;
      const rotY = localZ * sinP + localY * cosP;

      const cosR = Math.cos(s.roll || 0);
      const sinR = Math.sin(s.roll || 0);

      return [s.x - rotY * sinR, s.y + rotY * cosR, s.z + rotZ];
    },
    { closedV: true, worldUV: true, uvScaleU: 1.5, uvScaleV: 1.5 },
  );
}

function mirrorGeometryX(sourceGeo: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = sourceGeo.clone();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, -pos.getX(i));
  }
  pos.needsUpdate = true;

  const idx = geo.index;
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const b = idx.getX(i + 1);
      const c = idx.getX(i + 2);
      idx.setX(i + 1, c);
      idx.setX(i + 2, b);
    }
    idx.needsUpdate = true;
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      const x1 = pos.getX(i + 1),
        y1 = pos.getY(i + 1),
        z1 = pos.getZ(i + 1);
      pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
      pos.setXYZ(i + 2, x1, y1, z1);
    }
    pos.needsUpdate = true;
  }

  const norm = geo.attributes.normal as THREE.BufferAttribute | undefined;
  if (norm) {
    for (let i = 0; i < norm.count; i++) {
      norm.setX(i, -norm.getX(i));
    }
    norm.needsUpdate = true;
  } else {
    geo.computeVertexNormals();
  }
  geo.userData.shared = true;
  return geo;
}

// ============================================================================
// GAUSSIAN SOFTBOX TEXTURE GENERATOR (SHARED WITH LIGHTING SYSTEM)
// ============================================================================

export function createGaussianSoftboxTexture(
  coreHex: string,
  edgeHex: string,
): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);

  const core = new THREE.Color(coreHex);
  const edge = new THREE.Color(edgeHex);

  for (let y = 0; y < h; y++) {
    const ny = (y / (h - 1)) * 2 - 1;
    const fy = Math.exp(-3.2 * ny * ny) * Math.pow(Math.cos(ny * Math.PI * 0.5), 1.2);
    for (let x = 0; x < w; x++) {
      const nx = (x / (w - 1)) * 2 - 1;
      const fx = Math.pow(Math.cos(nx * Math.PI * 0.5), 0.85);
      const f = clamp(fx * fy, 0, 1);

      const r = lerp(edge.r, core.r, f) * f;
      const g = lerp(edge.g, core.g, f) * f;
      const b = lerp(edge.b, core.b, f) * f;

      const p = (y * w + x) * 4;
      img.data[p] = clamp(Math.round(r * 255), 0, 255);
      img.data[p + 1] = clamp(Math.round(g * 255), 0, 255);
      img.data[p + 2] = clamp(Math.round(b * 255), 0, 255);
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ============================================================================
// PROCEDURAL PBR TEXTURES & MATERIALS FOR THE V12 HYPERCAR
// ============================================================================

interface HypercarProceduralTextures {
  flakeNormal: THREE.CanvasTexture;
  flakeRough: THREE.CanvasTexture;
  carbonMap: THREE.CanvasTexture;
  carbonNormal: THREE.CanvasTexture;
  carbonRough: THREE.CanvasTexture;
  titaniumMap: THREE.CanvasTexture;
  hexMap: THREE.CanvasTexture;
  hexBump: THREE.CanvasTexture;
  rotorMap: THREE.CanvasTexture;
  rotorBump: THREE.CanvasTexture;
  tireMap: THREE.CanvasTexture;
  tireBump: THREE.CanvasTexture;
  tireRough: THREE.CanvasTexture;
  crinkleBump: THREE.CanvasTexture;
  goldFoilBump: THREE.CanvasTexture;
  clusterMap: THREE.CanvasTexture;
  shadowMap: THREE.CanvasTexture;
}

interface HypercarSharedMaterials {
  carbon: THREE.MeshPhysicalMaterial;
  matteCarbon: THREE.MeshStandardMaterial;
  voidBlack: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  engineGlass: THREE.MeshPhysicalMaterial;
  headlightLens: THREE.MeshPhysicalMaterial;
  opticGunmetal: THREE.MeshPhysicalMaterial;
  wheelAlloy: THREE.MeshPhysicalMaterial;
  machinedAlu: THREE.MeshPhysicalMaterial;
  caliperGold: THREE.MeshPhysicalMaterial;
  anodizedRed: THREE.MeshPhysicalMaterial;
  crinkleRed: THREE.MeshStandardMaterial;
  titanium: THREE.MeshPhysicalMaterial;
  hexMesh: THREE.MeshStandardMaterial;
  ceramicRotor: THREE.MeshPhysicalMaterial;
  tire: THREE.MeshStandardMaterial;
  alcantara: THREE.MeshStandardMaterial;
  seatTrimRed: THREE.MeshStandardMaterial;
  goldFoil: THREE.MeshPhysicalMaterial;
  mirrorChrome: THREE.MeshPhysicalMaterial;
  rubyLens: THREE.MeshPhysicalMaterial;
  clusterOLED: THREE.MeshStandardMaterial;
  contactShadow: THREE.MeshBasicMaterial;
  doorAmbientMat: THREE.MeshStandardMaterial;
  policeWhitePaint: THREE.MeshPhysicalMaterial;
}

function createHypercarTextures(anisotropy = 8): HypercarProceduralTextures {
  const aniso = Math.min(anisotropy || 4, 8);

  // A. Metallic Micro-Flakes (Normal + Roughness) for Tri-Coat Paint
  const flakeSize = 256;
  const fnC = document.createElement('canvas');
  const frC = document.createElement('canvas');
  fnC.width = fnC.height = frC.width = frC.height = flakeSize;
  const fnCtx = fnC.getContext('2d')!;
  const frCtx = frC.getContext('2d')!;
  const fnImg = fnCtx.createImageData(flakeSize, flakeSize);
  const frImg = frCtx.createImageData(flakeSize, flakeSize);

  let seedA = 48271;
  const randA = () => {
    seedA = (seedA * 16807) % 2147483647;
    return (seedA - 1) / 2147483646;
  };

  for (let i = 0; i < flakeSize * flakeSize; i++) {
    const p = i * 4;
    const isFlake = randA() > 0.62;
    const spark = isFlake ? (randA() * 2 - 1) * 0.22 : (randA() * 2 - 1) * 0.05;
    const ang = randA() * Math.PI * 2;
    const nx = Math.cos(ang) * spark;
    const ny = Math.sin(ang) * spark;
    const nz = Math.sqrt(Math.max(0.2, 1 - nx * nx - ny * ny));
    fnImg.data[p] = Math.round((nx * 0.5 + 0.5) * 255);
    fnImg.data[p + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    fnImg.data[p + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    fnImg.data[p + 3] = 255;

    const rv = isFlake ? Math.round(28 + randA() * 22) : Math.round(42 + randA() * 16);
    frImg.data[p] = frImg.data[p + 1] = frImg.data[p + 2] = rv;
    frImg.data[p + 3] = 255;
  }
  fnCtx.putImageData(fnImg, 0, 0);
  frCtx.putImageData(frImg, 0, 0);

  const flakeNormal = new THREE.CanvasTexture(fnC);
  flakeNormal.wrapS = flakeNormal.wrapT = THREE.RepeatWrapping;
  flakeNormal.repeat.set(18, 18);
  flakeNormal.anisotropy = aniso;

  const flakeRough = new THREE.CanvasTexture(frC);
  flakeRough.wrapS = flakeRough.wrapT = THREE.RepeatWrapping;
  flakeRough.repeat.set(18, 18);
  flakeRough.anisotropy = aniso;

  // B. 2x2 Twill Autoclave Carbon Fiber (512x512)
  const cSize = 512;
  const caC = document.createElement('canvas');
  const cnC = document.createElement('canvas');
  const crC = document.createElement('canvas');
  caC.width = caC.height = cnC.width = cnC.height = crC.width = crC.height = cSize;
  const caCtx = caC.getContext('2d')!;
  const cnCtx = cnC.getContext('2d')!;
  const crCtx = crC.getContext('2d')!;
  const caImg = caCtx.createImageData(cSize, cSize);
  const cnImg = cnCtx.createImageData(cSize, cSize);
  const crImg = crCtx.createImageData(cSize, cSize);

  const cells = 32;
  const cellSize = cSize / cells;

  for (let y = 0; y < cSize; y++) {
    for (let x = 0; x < cSize; x++) {
      const cx = Math.floor(x / cellSize);
      const cy = Math.floor(y / cellSize);
      const lx = (x % cellSize) / cellSize;
      const ly = (y % cellSize) / cellSize;

      const isWarp = (cx + cy) % 4 < 2;
      const u = isWarp ? lx : ly;
      const v = isWarp ? ly : lx;

      const arch = Math.sin(u * Math.PI);
      const along = 0.72 + 0.28 * Math.sin(v * Math.PI);
      const strand = 0.92 + 0.08 * Math.sin(u * Math.PI * 6);

      const base = isWarp ? 28 : 13;
      const val = clamp(
        Math.round((base + arch * along * (isWarp ? 34 : 18)) * strand),
        9,
        72,
      );

      const p = (y * cSize + x) * 4;
      caImg.data[p] = val;
      caImg.data[p + 1] = Math.round(val * 1.02);
      caImg.data[p + 2] = Math.round(val * 1.06);
      caImg.data[p + 3] = 255;

      const sU = Math.cos(u * Math.PI) * 0.34;
      const sV = Math.cos(v * Math.PI) * 0.14;
      const nx = isWarp ? sU : sV;
      const ny = isWarp ? sV : sU;
      const nz = Math.sqrt(Math.max(0.2, 1 - nx * nx - ny * ny));
      cnImg.data[p] = Math.round((nx * 0.5 + 0.5) * 255);
      cnImg.data[p + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      cnImg.data[p + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      cnImg.data[p + 3] = 255;

      const rough = clamp(Math.round((isWarp ? 0.22 : 0.42) * 255 - arch * 18), 38, 150);
      crImg.data[p] = crImg.data[p + 1] = crImg.data[p + 2] = rough;
      crImg.data[p + 3] = 255;
    }
  }
  caCtx.putImageData(caImg, 0, 0);
  cnCtx.putImageData(cnImg, 0, 0);
  crCtx.putImageData(crImg, 0, 0);

  const carbonMap = new THREE.CanvasTexture(caC);
  carbonMap.colorSpace = THREE.SRGBColorSpace;
  carbonMap.wrapS = carbonMap.wrapT = THREE.RepeatWrapping;
  carbonMap.repeat.set(9, 9);
  carbonMap.anisotropy = aniso;

  const carbonNormal = new THREE.CanvasTexture(cnC);
  carbonNormal.wrapS = carbonNormal.wrapT = THREE.RepeatWrapping;
  carbonNormal.repeat.set(9, 9);
  carbonNormal.anisotropy = aniso;

  const carbonRough = new THREE.CanvasTexture(crC);
  carbonRough.wrapS = carbonRough.wrapT = THREE.RepeatWrapping;
  carbonRough.repeat.set(9, 9);
  carbonRough.anisotropy = aniso;

  // C. Heat-Tempered Titanium (256x256)
  const tiC = document.createElement('canvas');
  tiC.width = 256;
  tiC.height = 256;
  const tiCtx = tiC.getContext('2d')!;
  const tiG = tiCtx.createLinearGradient(0, 0, 0, 256);
  tiG.addColorStop(0.0, '#726d66');
  tiG.addColorStop(0.24, '#9b9182');
  tiG.addColorStop(0.44, '#c49854');
  tiG.addColorStop(0.56, '#874c56');
  tiG.addColorStop(0.66, '#4f3b92');
  tiG.addColorStop(0.75, '#1d53b8');
  tiG.addColorStop(0.83, '#22242c');
  tiG.addColorStop(1.0, '#050507');
  tiCtx.fillStyle = tiG;
  tiCtx.fillRect(0, 0, 256, 256);

  const titaniumMap = new THREE.CanvasTexture(tiC);
  titaniumMap.colorSpace = THREE.SRGBColorSpace;
  titaniumMap.wrapS = THREE.RepeatWrapping;
  titaniumMap.wrapT = THREE.ClampToEdgeWrapping;

  // D. Photo-Etched Hexagonal Grille (256x256)
  const hSize = 256;
  const hcC = document.createElement('canvas');
  const hbC = document.createElement('canvas');
  hcC.width = hcC.height = hbC.width = hbC.height = hSize;
  const hcCtx = hcC.getContext('2d')!;
  const hbCtx = hbC.getContext('2d')!;

  hcCtx.fillStyle = '#1e2128';
  hcCtx.fillRect(0, 0, hSize, hSize);
  hbCtx.fillStyle = '#ffffff';
  hbCtx.fillRect(0, 0, hSize, hSize);

  const hexR = 13;
  const hexDx = hexR * 1.5;
  const hexDy = hexR * Math.sqrt(3);
  const hexPath = (ctx: CanvasRenderingContext2D, cx: number, cy: number, rad: number) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const px = cx + Math.cos(a) * rad;
      const py = cy + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  };

  for (let col = -1; col < hSize / hexDx + 2; col++) {
    for (let row = -1; row < hSize / hexDy + 2; row++) {
      const cx = col * hexDx;
      const cy = row * hexDy + (col % 2 === 0 ? 0 : hexDy * 0.5);
      hexPath(hbCtx, cx, cy, hexR * 0.78);
      hbCtx.fillStyle = '#060606';
      hbCtx.fill();

      hexPath(hcCtx, cx, cy, hexR * 0.86);
      hcCtx.strokeStyle = '#383d48';
      hcCtx.lineWidth = 1.6;
      hcCtx.stroke();

      hexPath(hcCtx, cx, cy, hexR * 0.78);
      hcCtx.fillStyle = '#040507';
      hcCtx.fill();
    }
  }

  const hexMap = new THREE.CanvasTexture(hcC);
  hexMap.colorSpace = THREE.SRGBColorSpace;
  hexMap.wrapS = hexMap.wrapT = THREE.RepeatWrapping;
  hexMap.repeat.set(9, 4);
  hexMap.anisotropy = aniso;

  const hexBump = new THREE.CanvasTexture(hbC);
  hexBump.wrapS = hexBump.wrapT = THREE.RepeatWrapping;
  hexBump.repeat.set(9, 4);

  // E. Cross-Drilled Carbon-Ceramic Brake Rotor (512x512)
  const rSize = 512;
  const rcC = document.createElement('canvas');
  const rbC = document.createElement('canvas');
  rcC.width = rcC.height = rbC.width = rbC.height = rSize;
  const rcCtx = rcC.getContext('2d')!;
  const rbCtx = rbC.getContext('2d')!;
  const rHalf = rSize / 2;

  rcCtx.fillStyle = '#52565e';
  rcCtx.fillRect(0, 0, rSize, rSize);
  rbCtx.fillStyle = '#cccccc';
  rbCtx.fillRect(0, 0, rSize, rSize);

  let seedE = 8831;
  const randE = () => {
    seedE = (seedE * 16807) % 2147483647;
    return (seedE - 1) / 2147483646;
  };

  for (let i = 0; i < 7000; i++) {
    const ang = randE() * Math.PI * 2;
    const rad = (0.48 + randE() * 0.5) * rHalf;
    const px = rHalf + Math.cos(ang) * rad;
    const py = rHalf + Math.sin(ang) * rad;
    const s = Math.round(62 + randE() * 64);
    rcCtx.fillStyle = `rgb(${s},${s + 2},${s + 5})`;
    rcCtx.fillRect(px, py, 2, 2);
  }

  for (let r = rHalf * 0.51; r < rHalf * 0.96; r += 2.0) {
    const a = 0.05 + randE() * 0.08;
    rcCtx.beginPath();
    rcCtx.arc(rHalf, rHalf, r, 0, Math.PI * 2);
    rcCtx.strokeStyle =
      randE() > 0.5 ? `rgba(225,230,240,${a})` : `rgba(24,26,30,${a})`;
    rcCtx.lineWidth = 1.0;
    rcCtx.stroke();
  }

  const groups = 12;
  for (let g = 0; g < groups; g++) {
    const baseA = (g / groups) * Math.PI * 2;
    for (let k = 0; k < 4; k++) {
      const rad = rHalf * (0.57 + k * 0.098);
      const ang = baseA + k * 0.075;
      const hx = rHalf + Math.cos(ang) * rad;
      const hy = rHalf + Math.sin(ang) * rad;

      rcCtx.beginPath();
      rcCtx.arc(hx, hy, 4.4, 0, Math.PI * 2);
      rcCtx.fillStyle = '#32363d';
      rcCtx.fill();

      rcCtx.beginPath();
      rcCtx.arc(hx, hy, 3.1, 0, Math.PI * 2);
      rcCtx.fillStyle = '#060709';
      rcCtx.fill();

      rbCtx.beginPath();
      rbCtx.arc(hx, hy, 3.8, 0, Math.PI * 2);
      rbCtx.fillStyle = '#000000';
      rbCtx.fill();
    }

    const sA = baseA + Math.PI / groups;
    rcCtx.beginPath();
    rcCtx.moveTo(rHalf + Math.cos(sA) * rHalf * 0.58, rHalf + Math.sin(sA) * rHalf * 0.58);
    rcCtx.quadraticCurveTo(
      rHalf + Math.cos(sA + 0.06) * rHalf * 0.77,
      rHalf + Math.sin(sA + 0.06) * rHalf * 0.77,
      rHalf + Math.cos(sA + 0.14) * rHalf * 0.92,
      rHalf + Math.sin(sA + 0.14) * rHalf * 0.92,
    );
    rcCtx.strokeStyle = '#111318';
    rcCtx.lineWidth = 2.6;
    rcCtx.lineCap = 'round';
    rcCtx.stroke();

    rbCtx.beginPath();
    rbCtx.moveTo(rHalf + Math.cos(sA) * rHalf * 0.58, rHalf + Math.sin(sA) * rHalf * 0.58);
    rbCtx.quadraticCurveTo(
      rHalf + Math.cos(sA + 0.06) * rHalf * 0.77,
      rHalf + Math.sin(sA + 0.06) * rHalf * 0.77,
      rHalf + Math.cos(sA + 0.14) * rHalf * 0.92,
      rHalf + Math.sin(sA + 0.14) * rHalf * 0.92,
    );
    rbCtx.strokeStyle = '#121212';
    rbCtx.lineWidth = 3.0;
    rbCtx.lineCap = 'round';
    rbCtx.stroke();
  }

  const rotorMap = new THREE.CanvasTexture(rcC);
  rotorMap.colorSpace = THREE.SRGBColorSpace;
  rotorMap.anisotropy = aniso;

  const rotorBump = new THREE.CanvasTexture(rbC);
  rotorBump.anisotropy = aniso;

  // F. Competition Semi-Slick Tire (512x512)
  const tw = 512,
    th = 512;
  const tcC = document.createElement('canvas');
  const tbC = document.createElement('canvas');
  const trC = document.createElement('canvas');
  tcC.width = tbC.width = trC.width = tw;
  tcC.height = tbC.height = trC.height = th;
  const tcCtx = tcC.getContext('2d')!;
  const tbCtx = tbC.getContext('2d')!;
  const trCtx = trC.getContext('2d')!;

  tcCtx.fillStyle = '#202328';
  tcCtx.fillRect(0, 0, tw, th);
  tbCtx.fillStyle = '#888888';
  tbCtx.fillRect(0, 0, tw, th);
  trCtx.fillStyle = '#a4a4a4';
  trCtx.fillRect(0, 0, tw, th);

  let seedF = 3191;
  const randF = () => {
    seedF = (seedF * 16807) % 2147483647;
    return (seedF - 1) / 2147483646;
  };
  for (let i = 0; i < 6000; i++) {
    const v = Math.round(26 + randF() * 14);
    tcCtx.fillStyle = `rgb(${v},${v + 1},${v + 3})`;
    tcCtx.fillRect(randF() * tw, randF() * th, 2, 2);
  }

  const drawSidewall = (y0: number, y1: number) => {
    const ym = (y0 + y1) * 0.5;
    tbCtx.strokeStyle = '#d4d4d4';
    tbCtx.lineWidth = 3.0;
    tbCtx.beginPath();
    tbCtx.moveTo(0, ym - 14);
    tbCtx.lineTo(tw, ym - 14);
    tbCtx.stroke();
    tbCtx.beginPath();
    tbCtx.moveTo(0, ym + 14);
    tbCtx.lineTo(tw, ym + 14);
    tbCtx.stroke();

    for (let i = 0; i < 64; i++) {
      const x = (i / 64) * tw;
      if (i % 16 < 10) {
        tbCtx.fillStyle = '#b4b4b4';
        tbCtx.fillRect(x, ym - 10, tw / 128, 20);
        trCtx.fillStyle = '#7e7e7e';
        trCtx.fillRect(x, ym - 10, tw / 128, 20);
        tcCtx.fillStyle = '#181a1f';
        tcCtx.fillRect(x, ym - 10, tw / 128, 20);
      }
    }
  };
  drawSidewall(th * 0.05, th * 0.24);
  drawSidewall(th * 0.76, th * 0.95);

  tcCtx.fillStyle = '#24272d';
  tcCtx.fillRect(0, th * 0.27, tw, th * 0.46);
  trCtx.fillStyle = '#b4b4b4';
  trCtx.fillRect(0, th * 0.27, tw, th * 0.46);

  [
    [th * 0.39, 8],
    [th * 0.51, 10],
    [th * 0.62, 8],
  ].forEach(([gy, gw]) => {
    tcCtx.fillStyle = '#090a0d';
    tcCtx.fillRect(0, gy - gw / 2, tw, gw);
    tbCtx.fillStyle = '#080808';
    tbCtx.fillRect(0, gy - gw / 2, tw, gw);
    trCtx.fillStyle = '#dedede';
    trCtx.fillRect(0, gy - gw / 2, tw, gw);
  });

  const pitches = 36;
  const step = tw / pitches;
  for (let i = 0; i < pitches; i++) {
    const x0 = i * step;
    [
      [th * 0.27, th * 0.38, 1.35],
      [th * 0.63, th * 0.73, -1.25],
      [th * 0.4, th * 0.5, 0.9],
      [th * 0.52, th * 0.61, -0.85],
    ].forEach(([ya, yb, slant]) => {
      for (let wrap = -1; wrap <= 1; wrap++) {
        const ox = x0 + wrap * tw;
        tcCtx.beginPath();
        tcCtx.moveTo(ox, ya);
        tcCtx.quadraticCurveTo(
          ox + step * slant * 0.5,
          (ya + yb) * 0.5,
          ox + step * slant,
          yb,
        );
        tcCtx.strokeStyle = '#0a0b0e';
        tcCtx.lineWidth = 3.2;
        tcCtx.stroke();

        tbCtx.beginPath();
        tbCtx.moveTo(ox, ya);
        tbCtx.quadraticCurveTo(
          ox + step * slant * 0.5,
          (ya + yb) * 0.5,
          ox + step * slant,
          yb,
        );
        tbCtx.strokeStyle = '#121212';
        tbCtx.lineWidth = 3.8;
        tbCtx.stroke();
      }
    });
  }

  const tireMap = new THREE.CanvasTexture(tcC);
  tireMap.colorSpace = THREE.SRGBColorSpace;
  tireMap.wrapS = THREE.RepeatWrapping;
  tireMap.wrapT = THREE.ClampToEdgeWrapping;
  tireMap.anisotropy = aniso;

  const tireBump = new THREE.CanvasTexture(tbC);
  tireBump.wrapS = THREE.RepeatWrapping;
  tireBump.wrapT = THREE.ClampToEdgeWrapping;
  tireBump.anisotropy = aniso;

  const tireRough = new THREE.CanvasTexture(trC);
  tireRough.wrapS = THREE.RepeatWrapping;
  tireRough.wrapT = THREE.ClampToEdgeWrapping;

  // G. V12 "Rosso Crinkle" & 24K Gold Foil Heatshield (256x256)
  const gSize = 256;
  const crkC = document.createElement('canvas');
  const gfC = document.createElement('canvas');
  crkC.width = crkC.height = gfC.width = gfC.height = gSize;
  const crkCtx = crkC.getContext('2d')!;
  const gfCtx = gfC.getContext('2d')!;

  const crkImg = crkCtx.createImageData(gSize, gSize);
  let seedG = 6619;
  const randG = () => {
    seedG = (seedG * 16807) % 2147483647;
    return (seedG - 1) / 2147483646;
  };
  for (let i = 0; i < gSize * gSize; i++) {
    const v = Math.round(75 + randG() * 140);
    const p = i * 4;
    crkImg.data[p] = crkImg.data[p + 1] = crkImg.data[p + 2] = v;
    crkImg.data[p + 3] = 255;
  }
  crkCtx.putImageData(crkImg, 0, 0);

  gfCtx.fillStyle = '#808080';
  gfCtx.fillRect(0, 0, gSize, gSize);
  for (let i = 0; i < 360; i++) {
    const x = randG() * gSize;
    const y = randG() * gSize;
    const r = 6 + randG() * 16;
    gfCtx.beginPath();
    gfCtx.moveTo(x, y);
    gfCtx.lineTo(x + (randG() - 0.5) * r * 2, y + (randG() - 0.5) * r * 2);
    gfCtx.lineTo(x + (randG() - 0.5) * r * 2, y + (randG() - 0.5) * r * 2);
    gfCtx.closePath();
    const v = Math.round(50 + randG() * 175);
    gfCtx.fillStyle = `rgb(${v},${v},${v})`;
    gfCtx.fill();
  }

  const crinkleBump = new THREE.CanvasTexture(crkC);
  crinkleBump.wrapS = crinkleBump.wrapT = THREE.RepeatWrapping;
  crinkleBump.repeat.set(8, 8);

  const goldFoilBump = new THREE.CanvasTexture(gfC);
  goldFoilBump.wrapS = goldFoilBump.wrapT = THREE.RepeatWrapping;
  goldFoilBump.repeat.set(5, 5);

  // H. Curved OLED Digital Gauge Cluster (512x256)
  const clC = document.createElement('canvas');
  clC.width = 512;
  clC.height = 256;
  const clCtx = clC.getContext('2d')!;
  clCtx.fillStyle = '#050609';
  clCtx.fillRect(0, 0, 512, 256);

  clCtx.beginPath();
  clCtx.arc(256, 256 * 0.64, 82, Math.PI * 1.08, Math.PI * 1.92);
  clCtx.strokeStyle = '#ff2236';
  clCtx.lineWidth = 8;
  clCtx.stroke();

  clCtx.beginPath();
  clCtx.arc(256, 256 * 0.64, 66, Math.PI * 1.15, Math.PI * 1.82);
  clCtx.strokeStyle = '#d8e8ff';
  clCtx.lineWidth = 3.5;
  clCtx.stroke();

  for (let i = 0; i < 6; i++) {
    clCtx.fillStyle = i > 3 ? '#ff2436' : '#36baff';
    clCtx.fillRect(58, 172 - i * 18, 40, 7);
    clCtx.fillRect(512 - 98, 172 - i * 18, 40, 7);
  }

  const clusterMap = new THREE.CanvasTexture(clC);
  clusterMap.colorSpace = THREE.SRGBColorSpace;

  // I. 6-Ellipse Multilayer Radial Contact Shadow (512x512)
  const shC = document.createElement('canvas');
  shC.width = shC.height = 512;
  const shCtx = shC.getContext('2d')!;
  shCtx.clearRect(0, 0, 512, 512);

  const drawEllipse = (cx: number, cy: number, rx: number, ry: number, alpha: number) => {
    shCtx.save();
    shCtx.translate(cx, cy);
    shCtx.scale(rx, ry);
    const g = shCtx.createRadialGradient(0, 0, 0.05, 0, 0, 1.0);
    g.addColorStop(0.0, `rgba(0,0,0,${alpha})`);
    g.addColorStop(0.45, `rgba(0,0,0,${(alpha * 0.7).toFixed(3)})`);
    g.addColorStop(0.76, `rgba(0,0,0,${(alpha * 0.2).toFixed(3)})`);
    g.addColorStop(1.0, 'rgba(0,0,0,0.0)');
    shCtx.fillStyle = g;
    shCtx.beginPath();
    shCtx.arc(0, 0, 1, 0, Math.PI * 2);
    shCtx.fill();
    shCtx.restore();
  };

  drawEllipse(256, 256, 162, 218, 0.88);
  drawEllipse(256, 256, 118, 176, 0.94);
  drawEllipse(256 - 72, 256 + 104, 36, 48, 0.97);
  drawEllipse(256 + 72, 256 + 104, 36, 48, 0.97);
  drawEllipse(256 - 76, 256 - 102, 42, 52, 0.97);
  drawEllipse(256 + 76, 256 - 102, 42, 52, 0.97);

  const shadowMap = new THREE.CanvasTexture(shC);

  return {
    flakeNormal,
    flakeRough,
    carbonMap,
    carbonNormal,
    carbonRough,
    titaniumMap,
    hexMap,
    hexBump,
    rotorMap,
    rotorBump,
    tireMap,
    tireBump,
    tireRough,
    crinkleBump,
    goldFoilBump,
    clusterMap,
    shadowMap,
  };
}

/**
 * Computes a high-chroma pearlescent sheen color for any tri-coat base hex.
 * For Rosso Corsa / Rosso Fuoco reds, returns the exact `#ff3b1f` warm orange-red sheen.
 */
export function computeTriCoatColors(rawHex: number): {
  baseColor: THREE.Color;
  sheenColor: THREE.Color;
} {
  if (rawHex === 0x9c1618 || rawHex === 0x8f0912) {
    return {
      baseColor: new THREE.Color(0x8f0912),
      sheenColor: new THREE.Color(0xff3b1f),
    };
  }
  const baseColor = new THREE.Color(rawHex);
  const hsl = { h: 0, s: 0, l: 0 };
  baseColor.getHSL(hsl);
  const sheenColor = new THREE.Color().setHSL(
    (hsl.h + 0.02) % 1.0,
    Math.min(1.0, hsl.s * 1.35 + 0.15),
    clamp(hsl.l * 1.75 + 0.14, 0.32, 0.72),
  );
  return { baseColor, sheenColor };
}

export function applyTriCoatColor(
  mat: THREE.MeshPhysicalMaterial,
  rawHex: number,
): void {
  const { baseColor, sheenColor } = computeTriCoatColors(rawHex);
  mat.color.copy(baseColor);
  mat.sheenColor.copy(sheenColor);
}

function createSharedHypercarMaterials(
  tex: HypercarProceduralTextures,
): HypercarSharedMaterials {
  const mats: HypercarSharedMaterials = {
    carbon: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#dfe4ec'),
      map: tex.carbonMap,
      normalMap: tex.carbonNormal,
      normalScale: new THREE.Vector2(0.28, 0.28),
      roughnessMap: tex.carbonRough,
      roughness: 0.36,
      metalness: 0.15,
      clearcoat: 1.0,
      clearcoatRoughness: 0.045,
      envMapIntensity: 1.18,
    }),

    matteCarbon: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#101216'),
      roughness: 0.78,
      metalness: 0.14,
      envMapIntensity: 0.55,
    }),

    voidBlack: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#050608'),
      roughness: 0.9,
      metalness: 0.05,
      envMapIntensity: 0.22,
    }),

    glass: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#0a0e14'),
      roughness: 0.03,
      metalness: 0.08,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      envMapIntensity: 1.65,
      side: THREE.DoubleSide,
    }),

    engineGlass: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#10151d'),
      roughness: 0.025,
      metalness: 0.06,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
      envMapIntensity: 1.55,
      side: THREE.DoubleSide,
    }),

    headlightLens: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#e8f2ff'),
      roughness: 0.02,
      metalness: 0.04,
      clearcoat: 1.0,
      clearcoatRoughness: 0.015,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      envMapIntensity: 1.75,
    }),

    opticGunmetal: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#181c22'),
      metalness: 0.72,
      roughness: 0.26,
      clearcoat: 0.4,
      envMapIntensity: 1.0,
    }),

    wheelAlloy: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#5c6370'),
      metalness: 0.9,
      roughness: 0.26,
      clearcoat: 0.28,
      clearcoatRoughness: 0.16,
      envMapIntensity: 1.35,
    }),

    machinedAlu: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#ccd3de'),
      metalness: 0.95,
      roughness: 0.16,
      clearcoat: 0.22,
      envMapIntensity: 1.38,
    }),

    caliperGold: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#e6a80a'),
      metalness: 0.56,
      roughness: 0.22,
      clearcoat: 1.0,
      clearcoatRoughness: 0.045,
      envMapIntensity: 1.3,
    }),

    anodizedRed: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#b8121f'),
      metalness: 0.74,
      roughness: 0.24,
      clearcoat: 0.5,
      envMapIntensity: 1.25,
    }),

    crinkleRed: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#ad121e'),
      bumpMap: tex.crinkleBump,
      bumpScale: 0.008,
      roughness: 0.52,
      metalness: 0.22,
      envMapIntensity: 1.05,
    }),

    titanium: new THREE.MeshPhysicalMaterial({
      map: tex.titaniumMap,
      metalness: 0.88,
      roughness: 0.22,
      clearcoat: 0.22,
      clearcoatRoughness: 0.14,
      envMapIntensity: 1.28,
    }),

    hexMesh: new THREE.MeshStandardMaterial({
      map: tex.hexMap,
      bumpMap: tex.hexBump,
      bumpScale: 0.012,
      metalness: 0.55,
      roughness: 0.46,
      envMapIntensity: 0.8,
      side: THREE.DoubleSide,
    }),

    ceramicRotor: new THREE.MeshPhysicalMaterial({
      map: tex.rotorMap,
      bumpMap: tex.rotorBump,
      bumpScale: 0.008,
      metalness: 0.48,
      roughness: 0.36,
      clearcoat: 0.12,
      envMapIntensity: 1.15,
    }),

    tire: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#d8dce4'),
      map: tex.tireMap,
      bumpMap: tex.tireBump,
      bumpScale: 0.014,
      roughnessMap: tex.tireRough,
      roughness: 0.64,
      metalness: 0.04,
      envMapIntensity: 0.72,
    }),

    alcantara: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#191b20'),
      roughness: 0.84,
      metalness: 0.02,
      envMapIntensity: 0.4,
    }),

    seatTrimRed: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#96111c'),
      roughness: 0.76,
      metalness: 0.05,
      envMapIntensity: 0.45,
    }),

    goldFoil: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#dfb032'),
      bumpMap: tex.goldFoilBump,
      bumpScale: 0.014,
      metalness: 0.92,
      roughness: 0.26,
      envMapIntensity: 1.25,
    }),

    mirrorChrome: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#d5dce6'),
      metalness: 1.0,
      roughness: 0.02,
      envMapIntensity: 1.5,
    }),

    rubyLens: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#4a040b'),
      emissive: new THREE.Color('#380006'),
      emissiveIntensity: 0.3,
      metalness: 0.05,
      roughness: 0.05,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      clearcoat: 1.0,
      envMapIntensity: 1.2,
    }),

    clusterOLED: new THREE.MeshStandardMaterial({
      map: tex.clusterMap,
      emissiveMap: tex.clusterMap,
      emissive: new THREE.Color('#ffffff'),
      emissiveIntensity: 1.55,
      roughness: 0.15,
      toneMapped: false,
    }),

    contactShadow: new THREE.MeshBasicMaterial({
      map: tex.shadowMap,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
    }),

    doorAmbientMat: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#ff182a'),
      emissive: new THREE.Color('#ff1426'),
      emissiveIntensity: 1.65,
      roughness: 0.2,
      toneMapped: false,
    }),

    policeWhitePaint: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#e4eaf2'),
      metalness: 0.45,
      roughness: 0.15,
      roughnessMap: tex.flakeRough,
      normalMap: tex.flakeNormal,
      normalScale: new THREE.Vector2(0.025, 0.025),
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      sheen: 0.35,
      sheenColor: new THREE.Color('#ffffff'),
      sheenRoughness: 0.25,
      ior: 1.52,
      envMapIntensity: 1.32,
    }),
  };

  for (const m of Object.values(mats)) {
    m.userData.shared = true;
  }
  return mats;
}

// ============================================================================
// CONTINUOUS C2 FRONT SURFACE EVALUATOR
// ============================================================================

function createFrontSurfaceEvaluator() {
  const TH_START = Math.PI + 0.5359;
  const TH_END = -0.5419;
  const U_ARCH_0 = 0.17;
  const U_ARCH_1 = 0.73;

  const U_FRUNK_0 = 0.17;
  const U_FRUNK_1 = 0.75;
  const vFrunkSeam = (u: number): number => {
    const t = clamp((u - U_FRUNK_0) / (U_FRUNK_1 - U_FRUNK_0), 0, 1);
    return lerp(0.435, 0.365, smoothstep(0, 1, t));
  };

  const evalHoodCenterY = (z: number): number => {
    const tBack = clamp((2.32 - z) / (2.32 - 0.68), 0, 1);
    return 0.295 + 0.448 * (1.0 - Math.pow(1.0 - tBack, 3.1));
  };

  const headlightMask = (u: number, v: number): number => {
    const du = (u - 0.85) / 0.072;
    const dv = (v - 0.54) / 0.112;
    const rx = du * 0.86 + dv * 0.51;
    const ry = -du * 0.51 + dv * 0.86;
    const d = Math.hypot(rx * 0.88, ry * 1.48);
    return 1.0 - smootherstep(0.58, 1.0, d);
  };

  const evalBase = (
    u: number,
    v: number,
    includeHeadlightPocket = true,
  ): [number, number, number] => {
    const zCenter = lerp(0.68, 2.32, u);

    let zLip: number, yLip: number, xLip: number;
    if (u < U_ARCH_0) {
      const k = u / U_ARCH_0;
      const zBackBot = HYPERCAR_SPEC.fZ + Math.cos(TH_START) * HYPERCAR_SPEC.fArchR;
      zLip = lerp(0.68, zBackBot, k);
      yLip = lerp(0.155, 0.15, k);
      xLip = lerp(0.895, 0.985, smoothstep(0.0, 1.0, k));
    } else if (u <= U_ARCH_1) {
      const k = (u - U_ARCH_0) / (U_ARCH_1 - U_ARCH_0);
      const th = lerp(TH_START, TH_END, k);
      const cosT = Math.cos(th);
      const sinT = Math.sin(th);
      zLip = HYPERCAR_SPEC.fZ + cosT * HYPERCAR_SPEC.fArchR;
      yLip = HYPERCAR_SPEC.fR + sinT * HYPERCAR_SPEC.fArchR;
      xLip =
        1.006 -
        0.024 * Math.pow(Math.abs(cosT), 1.7) -
        0.012 * Math.max(0, -sinT);
    } else {
      const k = (u - U_ARCH_1) / (1.0 - U_ARCH_1);
      const zFrontBot = HYPERCAR_SPEC.fZ + Math.cos(TH_END) * HYPERCAR_SPEC.fArchR;
      const bow = Math.sin(k * Math.PI * 0.5);
      zLip = lerp(zFrontBot, 2.315, Math.pow(k, 0.88));
      xLip = lerp(0.982, 0.0, Math.pow(k, 1.55)) * (1.0 - 0.06 * bow);
      yLip =
        lerp(0.148, 0.256, smoothstep(0.05, 1.0, k)) +
        0.014 * Math.sin(k * Math.PI);
    }

    const vNorm = Math.min(v / 0.9, 1.0);
    const z = lerp(zCenter, zLip, smootherstep(0.32, 0.92, vNorm));
    const yCenter = evalHoodCenterY(z);

    const archInfluence = gauss(z, HYPERCAR_SPEC.fZ, 0.44);
    const noseTaper = 1.0 - Math.pow(smoothstep(1.68, 2.32, z), 1.8);
    const xShoulder = Math.max(
      xLip,
      (0.945 + 0.062 * archInfluence) * (0.04 + 0.96 * noseTaper),
    );

    let x: number, y: number;
    if (v <= 0.72) {
      const s = v / 0.72;
      x = Math.min(xLip, xShoulder) * Math.pow(s, 0.96);
      if (u > U_ARCH_1) {
        const kNose = (u - U_ARCH_1) / (1.0 - U_ARCH_1);
        x = lerp(x, xLip * s, smoothstep(0.55, 1.0, kNose));
      }

      const wheelSwell =
        0.062 *
        gauss(z, HYPERCAR_SPEC.fZ - 0.02, 0.56) *
        smoothstep(2.28, 1.84, z) *
        smoothstep(0.66, 0.98, z);
      const shoulderLead =
        0.014 * smoothstep(0.68, 0.86, z) * smoothstep(1.55, 0.92, z);
      const yFenderBase = yCenter + wheelSwell + shoulderLead;
      const yShoulder = Math.max(yLip + 0.048, yFenderBase);

      const hoodCrown = 0.016 * (1.0 - s * s) * smoothstep(2.3, 1.95, z);
      const centerSpine =
        0.005 *
        gauss(s, 0.0, 0.15) *
        smoothstep(0.75, 1.25, z) *
        smoothstep(2.28, 1.98, z);
      const subtleFenderCrown =
        0.01 *
        Math.sin(smoothstep(0.32, 1.0, s) * Math.PI) *
        gauss(z, HYPERCAR_SPEC.fZ, 0.48) *
        smoothstep(2.24, 1.78, z);

      y =
        lerp(
          yCenter + hoodCrown + centerSpine,
          yShoulder,
          smootherstep(0.18, 0.94, s),
        ) + subtleFenderCrown;

      const sdZ =
        smootherstep(1.38, 1.5, z) * (1.0 - smootherstep(1.74, 1.85, z));
      const sdX = 1.0 - smootherstep(0.14, 0.25, x);
      const sDuctDrop = -0.046 * sdZ * sdX;
      const sDuctRim = 0.006 * sdZ * gauss(x, 0.24, 0.05);
      y += sDuctDrop + sDuctRim;

      const noseRoll = -0.026 * Math.pow(smoothstep(0.91, 1.0, u), 2.0);
      y += noseRoll;
    } else if (v <= 0.9) {
      const st = (v - 0.72) / 0.18;
      const topP = evalBase(u, 0.72, false);
      const bulge = Math.sin(st * Math.PI) * 0.022 * smoothstep(0.98, 0.76, u);
      x = lerp(topP[0], xLip, smootherstep(0.0, 1.0, st)) + bulge;
      y = lerp(topP[1], yLip, Math.pow(st, 1.08));

      if (u < U_ARCH_0) {
        const bk = 1.0 - smoothstep(0.0, U_ARCH_0, u);
        const midV = Math.sin(st * Math.PI);
        x -= 0.052 * bk * midV;
      }
    } else {
      const lt = (v - 0.9) / 0.1;
      const lipP = evalBase(u, 0.9, false);
      const rollIn = 0.036 * smootherstep(0, 1, lt);
      let dzRoll = 0,
        dyRoll = -0.006 * lt;
      if (u >= U_ARCH_0 && u <= U_ARCH_1) {
        const k = (u - U_ARCH_0) / (U_ARCH_1 - U_ARCH_0);
        const th = lerp(TH_START, TH_END, k);
        dzRoll = -Math.cos(th) * 0.005 * lt;
        dyRoll = -Math.sin(th) * 0.005 * lt;
      }
      x = Math.max(0.0, lipP[0] - rollIn);
      y = lipP[1] + dyRoll;
      return [x, y, lipP[2] + dzRoll];
    }

    if (includeHeadlightPocket && v < 0.76 && u > 0.72 && u < 0.96) {
      const hm = headlightMask(u, v);
      if (hm > 0.001) {
        y -= 0.03 * hm;
      }
    }

    return [Math.max(0.0, x), y, z];
  };

  const evalNormal = (
    u: number,
    v: number,
    includeHeadlightPocket = false,
  ): THREE.Vector3 => {
    const eps = 0.003;
    const u0 = clamp(u - eps, 0, 1),
      u1 = clamp(u + eps, 0, 1);
    const v0 = clamp(v - eps, 0, 0.995),
      v1 = clamp(v + eps, 0, 0.995);
    const pu0 = evalBase(u0, v, includeHeadlightPocket);
    const pu1 = evalBase(u1, v, includeHeadlightPocket);
    const pv0 = evalBase(u, v0, includeHeadlightPocket);
    const pv1 = evalBase(u, v1, includeHeadlightPocket);
    const du = new THREE.Vector3(pu1[0] - pu0[0], pu1[1] - pu0[1], pu1[2] - pu0[2]);
    const dv = new THREE.Vector3(pv1[0] - pv0[0], pv1[1] - pv0[1], pv1[2] - pv0[2]);
    const n = du.cross(dv);
    if (n.lengthSq() < 1e-10) return new THREE.Vector3(0, 1, 0);
    n.normalize();
    if (v < 0.002) {
      n.x = 0;
      if (n.lengthSq() > 1e-10) n.normalize();
      else n.set(0, 1, 0);
    }
    return n;
  };

  const evalFlushNormal = (u: number, v: number) => evalNormal(u, v, false);

  return {
    evalBase,
    evalNormal,
    evalFlushNormal,
    evalHoodCenterY,
    headlightMask,
    U_FRUNK_0,
    U_FRUNK_1,
    vFrunkSeam,
  };
}

// ============================================================================
// MASTER GEOMETRY CACHE & BLUEPRINT TEMPLATES
// ============================================================================

type MatSlot =
  | 'paint'
  | 'doorPaint'
  | 'ledWhite'
  | 'ledRed'
  | 'frunkLed'
  | 'sirenRed'
  | 'sirenBlue'
  | keyof HypercarSharedMaterials;

interface MeshTemplate {
  geo: THREE.BufferGeometry;
  mat: MatSlot;
  castShadow?: boolean;
  receiveShadow?: boolean;
  renderOrder?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
}

interface WheelCornerTemplates {
  spinMeshes: MeshTemplate[];
  knuckleMeshes: MeshTemplate[];
}

interface StrutGeometrySet {
  cylGeo: THREE.LatheGeometry;
  collarGeo: THREE.LatheGeometry;
  rodGeo: THREE.LatheGeometry;
}

interface MasterHypercarAssets {
  textures: HypercarProceduralTextures;
  materials: HypercarSharedMaterials;
  staticBodyMeshes: MeshTemplate[];
  policeRoofBarMeshes: MeshTemplate[];
  frunkLidMeshes: MeshTemplate[];
  frunkHingePos: [number, number, number];
  frunkLidAnchorLPos: [number, number, number];
  frunkLidAnchorRPos: [number, number, number];
  frunkChassisAnchorLPos: [number, number, number];
  frunkChassisAnchorRPos: [number, number, number];
  frunkStrutGeos: StrutGeometrySet;
  doorLMeshes: MeshTemplate[];
  doorRMeshes: MeshTemplate[];
  doorLPivotPos: [number, number, number];
  doorRPivotPos: [number, number, number];
  doorLStrutAnchorPos: [number, number, number];
  doorRStrutAnchorPos: [number, number, number];
  chassisStrutAnchorLPos: [number, number, number];
  chassisStrutAnchorRPos: [number, number, number];
  doorStrutGeos: StrutGeometrySet;
  steeringWheelMeshes: MeshTemplate[];
  steeringColumnPos: [number, number, number];
  steeringColumnRotX: number;
  wheels: {
    frontLeft: WheelCornerTemplates;
    frontRight: WheelCornerTemplates;
    rearLeft: WheelCornerTemplates;
    rearRight: WheelCornerTemplates;
  };
  contactShadowGeo: THREE.BufferGeometry;
  headlightBeamGeo: THREE.PlaneGeometry;
  nitroFlameGeo: THREE.ConeGeometry;
  allGeometries: THREE.BufferGeometry[];
}

let masterHypercarCache: MasterHypercarAssets | null = null;

function createStrutGeometrySet(
  cylLen: number,
  rodLen: number,
  cylR: number,
  rodR: number,
  allGeos: THREE.BufferGeometry[],
): StrutGeometrySet {
  const cylGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.0005, 0.0),
      new THREE.Vector2(cylR * 0.85, 0.006),
      new THREE.Vector2(cylR * 0.72, 0.016),
      new THREE.Vector2(cylR, 0.024),
      new THREE.Vector2(cylR, cylLen - 0.014),
      new THREE.Vector2(cylR * 0.82, cylLen - 0.004),
      new THREE.Vector2(rodR * 1.18, cylLen),
      new THREE.Vector2(rodR * 1.05, cylLen - 0.005),
    ],
    14,
  );
  cylGeo.userData.shared = true;

  const collarGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(rodR * 1.08, cylLen - 0.012),
      new THREE.Vector2(cylR * 1.05, cylLen - 0.01),
      new THREE.Vector2(cylR * 1.02, cylLen + 0.003),
      new THREE.Vector2(rodR * 1.12, cylLen + 0.004),
    ],
    14,
  );
  collarGeo.userData.shared = true;

  const rodGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.0005, 0.0),
      new THREE.Vector2(cylR * 0.78, 0.006),
      new THREE.Vector2(rodR * 1.15, 0.016),
      new THREE.Vector2(rodR, 0.024),
      new THREE.Vector2(rodR, rodLen),
      new THREE.Vector2(0.0005, rodLen + 0.003),
    ],
    12,
  );
  rodGeo.userData.shared = true;

  allGeos.push(cylGeo, collarGeo, rodGeo);
  return { cylGeo, collarGeo, rodGeo };
}

function buildMasterHypercarAssets(anisotropy = 8): MasterHypercarAssets {
  if (masterHypercarCache) return masterHypercarCache;

  const textures = createHypercarTextures(anisotropy);
  const materials = createSharedHypercarMaterials(textures);
  const allGeometries: THREE.BufferGeometry[] = [];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    g.userData.shared = true;
    allGeometries.push(g);
    return g;
  };

  const staticBodyMeshes: MeshTemplate[] = [];
  const addStatic = (
    geo: THREE.BufferGeometry,
    mat: MatSlot,
    castShadow = true,
    receiveShadow = true,
    renderOrder = 0,
    position?: [number, number, number],
    rotation?: [number, number, number],
  ) => {
    trackGeo(geo);
    staticBodyMeshes.push({
      geo,
      mat,
      castShadow,
      receiveShadow,
      renderOrder,
      position,
      rotation,
    });
  };

  const addMirroredStatic = (
    geo: THREE.BufferGeometry,
    mat: MatSlot,
    castShadow = true,
    receiveShadow = true,
    renderOrder = 0,
  ) => {
    addStatic(geo, mat, castShadow, receiveShadow, renderOrder);
    addStatic(mirrorGeometryX(geo), mat, castShadow, receiveShadow, renderOrder);
  };

  // ==========================================================================
  // 1. CHASSIS, VENTURI UNDERFLOOR & RECESSED WHEEL WELLS
  // ==========================================================================
  const floorGeo = buildParametricSurface(
    44,
    20,
    (u, v) => {
      const z = lerp(-2.22, 2.24, u);
      const s = (v - 0.5) * 2;
      let halfW = 0.82;
      if (z > 0.86) halfW = lerp(0.82, 0.52, smoothstep(0.86, 2.24, z));
      if (z < -0.82) halfW = lerp(0.82, 0.64, smoothstep(-0.82, -2.22, z));

      const fCut = gauss(z, HYPERCAR_SPEC.fZ, 0.34) * 0.24;
      const rCut = gauss(z, HYPERCAR_SPEC.rZ, 0.38) * 0.22;
      halfW = Math.max(0.52, halfW - fCut - rCut);

      let y = 0.118;
      if (z < -1.46) {
        const rt = smoothstep(-1.46, -2.22, z);
        y = 0.118 + rt * rt * 0.24 * (1 - 0.2 * s * s);
      }
      return [s * halfW, y, z];
    },
    { worldUV: true, uvScaleU: 1.5, uvScaleV: 1.5, flipWinding: true },
  );
  addStatic(floorGeo, 'carbon', false, true);

  const coreGeo = buildParametricSurface(
    38,
    18,
    (u, v) => {
      const z = lerp(-2.06, 2.02, u);
      const ang = v * Math.PI;
      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);

      let rx = 0.58;
      if (z > 0.8) rx = lerp(0.58, 0.38, smoothstep(0.8, 2.02, z));
      else if (z < -0.8) rx = lerp(0.58, 0.54, smoothstep(-0.8, -2.06, z));

      let topY = 0.5;
      if (z > 0.8) topY = lerp(0.52, 0.24, smoothstep(0.8, 2.02, z));
      else if (z < -0.68) topY = lerp(0.68, 0.58, smoothstep(-0.68, -2.06, z));

      const frunkDip =
        smootherstep(0.88, 1.0, z) * (1.0 - smootherstep(1.86, 1.98, z));
      topY = lerp(topY, 0.215, frunkDip);

      return [cosA * rx, lerp(0.13, topY, Math.pow(sinA, 0.85)), z];
    },
    { flipWinding: false },
  );
  addStatic(coreGeo, 'voidBlack', false, true);

  const makeRecessedWheelWell = (
    axleZ: number,
    centerY: number,
    archR: number,
    innerX: number,
    outerX: number,
  ) => {
    const linerR = archR - 0.015;
    const archGeo = buildParametricSurface(
      32,
      8,
      (u, v) => {
        const th = lerp(Math.PI + 0.42, -0.42, u);
        const x = lerp(innerX, outerX, v);
        const r = linerR - 0.004 * v;
        const z = axleZ + Math.cos(th) * r;
        const y = Math.max(0.12, centerY + Math.sin(th) * r);
        return [x, y, z];
      },
      { flipWinding: false },
    );
    addMirroredStatic(archGeo, 'matteCarbon', false, true);

    const backGeo = buildParametricSurface(
      24,
      6,
      (u, v) => {
        const th = lerp(Math.PI + 0.42, -0.42, u);
        const r = lerp(0.04, linerR, v);
        return [
          innerX,
          Math.max(0.12, centerY + Math.sin(th) * r),
          axleZ + Math.cos(th) * r,
        ];
      },
      { flipWinding: true },
    );
    addMirroredStatic(backGeo, 'voidBlack', false, true);
  };
  makeRecessedWheelWell(
    HYPERCAR_SPEC.fZ,
    HYPERCAR_SPEC.fR,
    HYPERCAR_SPEC.fArchR,
    0.59,
    0.958,
  );
  makeRecessedWheelWell(
    HYPERCAR_SPEC.rZ,
    HYPERCAR_SPEC.rR,
    HYPERCAR_SPEC.rArchR,
    0.59,
    0.985,
  );

  // ==========================================================================
  // 2. FRONT CLIP, FRUNK (44° ARTICULATED LID + WEEKENDER BAG), HEADLIGHTS & SPLITTER
  // ==========================================================================
  const frontEval = createFrontSurfaceEvaluator();
  const { U_FRUNK_0, U_FRUNK_1, vFrunkSeam } = frontEval;

  const buildFrontSubPatch = (
    uSegs: number,
    vSegs: number,
    uvMapFn: (u: number, v: number) => [number, number],
    includePocket: boolean,
    forceSeamX0 = false,
  ) => {
    const geo = buildParametricSurface(
      uSegs,
      vSegs,
      (u, v) => {
        const [uu, vv] = uvMapFn(u, v);
        return frontEval.evalBase(uu, vv, includePocket);
      },
      {
        worldUV: true,
        uvScaleU: 1.0,
        uvScaleV: 1.0,
        flipWinding: false,
        forceSymmetrySeamX0: forceSeamX0,
      },
    );

    const norm = geo.attributes.normal as THREE.BufferAttribute;
    const vCount = vSegs + 1;
    for (let iu = 0; iu <= uSegs; iu++) {
      const u = iu / uSegs;
      for (let iv = 0; iv <= vSegs; iv++) {
        const v = iv / vSegs;
        const [uu, vv] = uvMapFn(u, v);
        const n = frontEval.evalNormal(uu, vv, includePocket);
        const idx = iu * vCount + iv;
        norm.setXYZ(idx, n.x, n.y, n.z);
      }
    }
    norm.needsUpdate = true;
    return geo;
  };

  const gapU = 0.0022;
  const gapV = 0.004;

  const cowlStripGeo = buildFrontSubPatch(
    14,
    40,
    (u, v) => [lerp(0.0, U_FRUNK_0 - gapU, u), v],
    false,
    true,
  );
  addMirroredStatic(cowlStripGeo, 'paint', true, true);

  const noseCapGeo = buildFrontSubPatch(
    22,
    42,
    (u, v) => [lerp(U_FRUNK_1 + gapU, 1.0, u), v],
    true,
    true,
  );
  addMirroredStatic(noseCapGeo, 'paint', true, true);

  const outerFenderGeo = buildFrontSubPatch(
    38,
    30,
    (u, v) => {
      const uu = lerp(U_FRUNK_0 - gapU, U_FRUNK_1 + gapU, u);
      const vv = lerp(vFrunkSeam(uu) + gapV, 1.0, v);
      return [uu, vv];
    },
    false,
    false,
  );
  addMirroredStatic(outerFenderGeo, 'paint', true, true);

  const gutterPts: [number, number, number][] = [];
  for (let i = 0; i <= 14; i++) {
    const uu = lerp(U_FRUNK_0, U_FRUNK_1, i / 14);
    const p = frontEval.evalBase(uu, vFrunkSeam(uu), false);
    gutterPts.push([p[0] - 0.004, p[1] - 0.011, p[2]]);
  }
  addMirroredStatic(
    buildVariableTube(gutterPts, [0.01, 0.007], 24, 10),
    'voidBlack',
    false,
    true,
  );

  // Articulated Frunk Lid Meshes
  const zHinge = lerp(0.68, 2.32, U_FRUNK_0);
  const yHinge = frontEval.evalHoodCenterY(zHinge) - 0.014;
  const frunkHingePos: [number, number, number] = [0, yHinge, zHinge];
  const frunkLidMeshes: MeshTemplate[] = [];
  const addFrunkMirrored = (
    geo: THREE.BufferGeometry,
    mat: MatSlot,
    castShadow = true,
    receiveShadow = true,
  ) => {
    trackGeo(geo);
    const gL = trackGeo(mirrorGeometryX(geo));
    frunkLidMeshes.push(
      { geo, mat, castShadow, receiveShadow },
      { geo: gL, mat, castShadow, receiveShadow },
    );
  };

  const frunkOuterGeo = buildFrontSubPatch(
    36,
    22,
    (u, v) => {
      const uu = lerp(U_FRUNK_0 + gapU, U_FRUNK_1 - gapU, u);
      const vv = lerp(0.0, vFrunkSeam(uu) - gapV, v);
      return [uu, vv];
    },
    false,
    true,
  );
  addFrunkMirrored(frunkOuterGeo, 'paint', true, true);

  const frunkInnerGeo = buildParametricSurface(
    24,
    16,
    (u, v) => {
      const uu = lerp(U_FRUNK_0 + gapU + 0.01, U_FRUNK_1 - gapU - 0.01, u);
      const vv = lerp(0.0, vFrunkSeam(uu) - gapV - 0.015, v);
      const p = frontEval.evalBase(uu, vv, false);
      const n = frontEval.evalNormal(uu, vv, false);
      const edgeFade =
        smoothstep(0.0, 0.14, u) *
        smoothstep(1.0, 0.86, u) *
        smoothstep(1.0, 0.84, v);
      const thick = lerp(0.007, 0.018, edgeFade);
      return [p[0] - n.x * thick, p[1] - n.y * thick, p[2] - n.z * thick];
    },
    { worldUV: true, flipWinding: true, forceSymmetrySeamX0: true },
  );
  addFrunkMirrored(frunkInnerGeo, 'carbon', false, true);

  const lidRibPts: [number, number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const uu = lerp(U_FRUNK_0 + 0.04, U_FRUNK_1 - 0.04, t);
    const vv = lerp(0.04, vFrunkSeam(uu) - 0.05, t);
    const p = frontEval.evalBase(uu, vv, false);
    lidRibPts.push([p[0], p[1] - 0.021, p[2]]);
  }
  addFrunkMirrored(
    buildVariableTube(lidRibPts, [0.012, 0.007], 18, 10, { worldUV: true }),
    'carbon',
    false,
    true,
  );

  const frontLatchY = frontEval.evalHoodCenterY(1.86) - 0.018;
  const latchGeo = trackGeo(
    buildVariableTube(
      [
        [-0.022, frontLatchY, 1.855],
        [-0.016, frontLatchY - 0.026, 1.865],
        [0.016, frontLatchY - 0.026, 1.865],
        [0.022, frontLatchY, 1.855],
      ],
      0.0042,
      14,
      8,
    ),
  );
  frunkLidMeshes.push({ geo: latchGeo, mat: 'machinedAlu', castShadow: false, receiveShadow: false });

  const sdFramePts: [number, number, number][] = [
    [0.0, frontEval.evalHoodCenterY(1.83) + 0.003, 1.83],
    [0.13, frontEval.evalHoodCenterY(1.81) + 0.001, 1.81],
    [0.19, frontEval.evalHoodCenterY(1.68) - 0.002, 1.68],
    [0.2, frontEval.evalHoodCenterY(1.48) + 0.002, 1.48],
    [0.13, frontEval.evalHoodCenterY(1.41) + 0.006, 1.41],
    [0.0, frontEval.evalHoodCenterY(1.4) + 0.009, 1.4],
  ];
  addFrunkMirrored(
    buildVariableTube(sdFramePts, [0.009, 0.006], 24, 10, { worldUV: true }),
    'carbon',
    true,
    true,
  );

  const sdVaneY = frontEval.evalHoodCenterY(1.64) - 0.019;
  const sdVaneGeo = trackGeo(
    buildSculptedAirfoil(18, 10, (u) => {
      const s = (u - 0.5) * 2;
      return {
        x: s * 0.17,
        y: sdVaneY + 0.006 * (1 - s * s),
        z: 1.64 - 0.016 * s * s,
        chord: 0.068,
        thickness: 0.13,
        camber: 0.03,
        pitch: 0.16,
        roll: 0,
      };
    }),
  );
  frunkLidMeshes.push({ geo: sdVaneGeo, mat: 'carbon', castShadow: true, receiveShadow: true });

  const frunkLidAnchorLPos: [number, number, number] = [
    0.41,
    frontEval.evalHoodCenterY(1.24) - 0.022,
    1.24,
  ];
  const frunkLidAnchorRPos: [number, number, number] = [
    -0.41,
    frontEval.evalHoodCenterY(1.24) - 0.022,
    1.24,
  ];

  // Frunk Luggage Compartment + Weekender Duffel Bag
  const tubWallGeo = buildParametricSurface(
    24,
    14,
    (u, v) => {
      const a = u * Math.PI * 2;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      const sx = Math.sign(cosA) * Math.pow(Math.abs(cosA), 0.72);
      const sz = Math.sign(sinA) * Math.pow(Math.abs(sinA), 0.72);
      const z = 1.43 + sz * 0.42;
      const topW = lerp(0.47, 0.37, smoothstep(1.0, 1.86, z));
      const botW = topW - 0.08;
      const x = sx * lerp(topW, botW, v);
      const yTop = frontEval.evalHoodCenterY(z) - 0.022;
      const yBot = 0.242;
      const y = lerp(yTop, yBot, Math.pow(v, 0.88));
      return [x, y, z];
    },
    { closedU: true, worldUV: true, flipWinding: true },
  );
  addStatic(tubWallGeo, 'carbon', false, true);

  const bayFloorGeo = buildParametricSurface(
    14,
    14,
    (u, v) => {
      const s = (v - 0.5) * 2;
      const z = lerp(1.07, 1.79, u);
      const halfW = lerp(0.37, 0.28, u);
      const edgeCurve = Math.sin(u * Math.PI);
      return [s * halfW * (0.82 + 0.18 * edgeCurve), 0.245, z];
    },
    { flipWinding: false },
  );
  addStatic(bayFloorGeo, 'alcantara', false, true);

  const stitchPts: [number, number, number][] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const sx = Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), 0.75);
    const sz = Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 0.75);
    const z = 1.43 + sz * 0.34;
    const halfW = lerp(0.34, 0.26, smoothstep(1.08, 1.78, z));
    stitchPts.push([sx * halfW, 0.249, z]);
  }
  addStatic(
    buildVariableTube(stitchPts, 0.0028, 32, 8, { closed: true }),
    'seatTrimRed',
    false,
    false,
  );

  const strutCapGeo = trackGeo(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.001, 0.0),
        new THREE.Vector2(0.056, 0.0),
        new THREE.Vector2(0.056, 0.012),
        new THREE.Vector2(0.044, 0.018),
        new THREE.Vector2(0.022, 0.02),
        new THREE.Vector2(0.018, 0.03),
        new THREE.Vector2(0.001, 0.031),
      ],
      20,
    ),
  );
  const strutNutGeo = trackGeo(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.001, 0.03),
        new THREE.Vector2(0.012, 0.03),
        new THREE.Vector2(0.011, 0.039),
        new THREE.Vector2(0.001, 0.04),
      ],
      12,
    ),
  );
  [-1, 1].forEach((side) => {
    addStatic(strutCapGeo, 'machinedAlu', false, false, 0, [side * 0.42, 0.56, 1.38]);
    addStatic(strutNutGeo, 'anodizedRed', false, false, 0, [side * 0.42, 0.56, 1.38]);
  });

  addStatic(
    buildVariableTube(
      [
        [-0.44, 0.595, 1.05],
        [-0.22, 0.612, 1.03],
        [0.0, 0.618, 1.025],
        [0.22, 0.612, 1.03],
        [0.44, 0.595, 1.05],
      ],
      [0.014, 0.011],
      22,
      10,
      { worldUV: true },
    ),
    'carbon',
    false,
    true,
  );

  // Sculpted Alcantara + Carbon Weekender Duffel Bag inside Frunk
  const duffelStations: [number, number, number][][] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const x = lerp(-0.245, 0.245, t);
    const endRound = Math.max(0.08, Math.pow(Math.sin(t * Math.PI), 0.34));
    const halfZ = 0.145 * endRound;
    const h = 0.165 * endRound;
    const pts: [number, number, number][] = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const cz = Math.cos(a);
      const sy = Math.sin(a);
      const pz = 1.48 + cz * halfZ * (1.0 - 0.14 * Math.max(0, sy));
      const py =
        0.252 +
        (sy * 0.5 + 0.5) * h +
        0.01 * (1 - cz * cz) * Math.max(0, sy);
      pts.push([x, py, pz]);
    }
    duffelStations.push(pts);
  }
  addStatic(
    buildSplineLoft(duffelStations, 24, 18, { closedV: true, worldUV: true }),
    'alcantara',
    true,
    true,
  );

  [-0.13, 0.13].forEach((bx) => {
    const strapPts: [number, number, number][] = [];
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2;
      const cz = Math.cos(a);
      const sy = Math.sin(a);
      strapPts.push([
        bx,
        0.252 + (sy * 0.5 + 0.5) * 0.168,
        1.48 + cz * 0.146 * (1.0 - 0.14 * Math.max(0, sy)),
      ]);
    }
    addStatic(
      buildVariableTube(strapPts, [0.014, 0.0045], 24, 8, {
        closed: true,
        worldUV: true,
      }),
      'carbon',
      false,
      false,
    );
  });

  addStatic(
    buildVariableTube(
      [
        [-0.2, 0.416, 1.48],
        [0, 0.424, 1.48],
        [0.2, 0.416, 1.48],
      ],
      [0.004, 0.003],
      12,
      8,
    ),
    'machinedAlu',
    false,
    false,
  );

  [-1, 1].forEach((side) => {
    addStatic(
      buildVariableTube(
        [
          [-0.1, 0.405, 1.48 + side * 0.055],
          [-0.06, 0.468, 1.48 + side * 0.042],
          [0.0, 0.482, 1.48 + side * 0.036],
          [0.06, 0.468, 1.48 + side * 0.042],
          [0.1, 0.405, 1.48 + side * 0.055],
        ],
        0.0065,
        18,
        8,
      ),
      'seatTrimRed',
      false,
      false,
    );
  });

  addStatic(
    buildVariableTube(
      [
        [-0.22, 0.565, 1.07],
        [0.0, 0.575, 1.06],
        [0.22, 0.565, 1.07],
      ],
      [0.004, 0.003],
      14,
      8,
    ),
    'frunkLed',
    false,
    false,
  );

  const frunkChassisAnchorLPos: [number, number, number] = [0.43, 0.54, 1.44];
  const frunkChassisAnchorRPos: [number, number, number] = [-0.43, 0.54, 1.44];
  const frunkStrutGeos = createStrutGeometrySet(0.215, 0.22, 0.0085, 0.0042, allGeometries);

  // Conformal Almond-Shaped Headlights
  const almondUV = (a: number, r: number): [number, number] => {
    const cx = (Math.cos(a) * r) / 0.88;
    const cy = (Math.sin(a) * r) / 1.48;
    const du = (cx * 0.86 - cy * 0.51) * 0.072;
    const dv = (cx * 0.51 + cy * 0.86) * 0.112;
    return [0.85 + du, 0.54 + dv];
  };

  const bowlGeo = buildParametricSurface(
    28,
    10,
    (ua, vr) => {
      const a = ua * Math.PI * 2;
      const r = lerp(0.02, 0.9, vr);
      const [fu, fv] = almondUV(a, r);
      const p = frontEval.evalBase(fu, fv, false);
      const n = frontEval.evalFlushNormal(fu, fv);
      const depth = 0.029 * (1.0 - 0.55 * vr * vr);
      return [p[0] - n.x * depth, p[1] - n.y * depth, p[2] - n.z * depth];
    },
    { closedU: true, flipWinding: true },
  );
  addMirroredStatic(bowlGeo, 'opticGunmetal', false, true);

  const rimPts: [number, number, number][] = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    const [fu, fv] = almondUV(a, 0.94);
    const p = frontEval.evalBase(fu, fv, false);
    const n = frontEval.evalFlushNormal(fu, fv);
    rimPts.push([p[0] - n.x * 0.002, p[1] - n.y * 0.002, p[2] - n.z * 0.002]);
  }
  addMirroredStatic(
    buildVariableTube(rimPts, [0.0048, 0.0042], 40, 8, {
      closed: true,
      worldUV: true,
    }),
    'carbon',
    false,
    true,
  );

  const shroudGeo = trackGeo(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.019, 0.0),
        new THREE.Vector2(0.024, 0.012),
        new THREE.Vector2(0.022, 0.026),
        new THREE.Vector2(0.017, 0.026),
        new THREE.Vector2(0.015, 0.004),
      ],
      20,
    ),
  );
  shroudGeo.rotateX(Math.PI * 0.5);

  const lensPts: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 0.5;
    lensPts.push(new THREE.Vector2(Math.sin(a) * 0.018, Math.cos(a) * 0.013));
  }
  const projGlassGeo = trackGeo(new THREE.LatheGeometry(lensPts, 18));
  projGlassGeo.rotateX(Math.PI * 0.5);
  projGlassGeo.translate(0, 0, 0.014);

  const projLedCoreGeo = trackGeo(
    buildVariableTube(
      [
        [0, 0, 0.006],
        [0, 0, 0.015],
      ],
      0.007,
      6,
      8,
    ),
  );

  [-1, 1].forEach((side) => {
    [almondUV(0.25, 0.36), almondUV(3.4, 0.36)].forEach(([fu, fv]) => {
      const p = frontEval.evalBase(fu, fv, false);
      const n = frontEval.evalFlushNormal(fu, fv);
      const pos: [number, number, number] = [
        side * (p[0] - n.x * 0.02),
        p[1] - n.y * 0.02,
        p[2] - n.z * 0.02,
      ];
      const rot: [number, number, number] = [0.14, side * 0.16, 0];
      addStatic(shroudGeo, 'machinedAlu', false, false, 0, pos, rot);
      addStatic(projGlassGeo, 'headlightLens', false, false, 3, pos, rot);
      addStatic(projLedCoreGeo, 'ledWhite', false, false, 0, pos, rot);
    });
  });

  const drlPrimaryPts: [number, number, number][] = [];
  for (let i = 0; i <= 16; i++) {
    const a = lerp(0.15, 3.05, i / 16);
    const [fu, fv] = almondUV(a, 0.78);
    const p = frontEval.evalBase(fu, fv, false);
    const n = frontEval.evalFlushNormal(fu, fv);
    drlPrimaryPts.push([p[0] - n.x * 0.01, p[1] - n.y * 0.01, p[2] - n.z * 0.01]);
  }
  addMirroredStatic(
    buildVariableTube(
      drlPrimaryPts,
      (t) => [0.0042, 0.0036 * (0.7 + 0.4 * Math.sin(t * Math.PI))],
      28,
      8,
    ),
    'ledWhite',
    false,
    false,
  );

  const drlAccentPts: [number, number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const a = lerp(-0.35, -2.55, i / 12);
    const [fu, fv] = almondUV(a, 0.74);
    const p = frontEval.evalBase(fu, fv, false);
    const n = frontEval.evalFlushNormal(fu, fv);
    drlAccentPts.push([p[0] - n.x * 0.012, p[1] - n.y * 0.012, p[2] - n.z * 0.012]);
  }
  addMirroredStatic(
    buildVariableTube(drlAccentPts, [0.0032, 0.0028], 20, 8),
    'ledWhite',
    false,
    false,
  );

  const coverGeo = buildParametricSurface(
    28,
    8,
    (ua, vr) => {
      const a = ua * Math.PI * 2;
      const r = lerp(0.01, 0.94, vr);
      const [fu, fv] = almondUV(a, r);
      const p = frontEval.evalBase(fu, fv, false);
      const n = frontEval.evalFlushNormal(fu, fv);
      const lift = 0.0018 * (1.0 - 0.5 * vr * vr);
      return [p[0] + n.x * lift, p[1] + n.y * lift, p[2] + n.z * lift];
    },
    { closedU: true, flipWinding: true },
  );
  addMirroredStatic(coverGeo, 'headlightLens', false, false, 3);

  // Front Hex Grille, Splitter, Canards, Brake Extractors & Emblem
  const frontGrilleGeo = buildParametricSurface(
    24,
    8,
    (u, v) => {
      const s = (u - 0.5) * 2;
      const x = s * 0.8;
      const z = 2.24 - 0.3 * s * s;
      const y = lerp(0.118, 0.258 - 0.032 * s * s, v);
      return [x, y, z];
    },
    { flipWinding: false },
  );
  addStatic(frontGrilleGeo, 'hexMesh', false, true);

  const intakeBladeGeo = buildSculptedAirfoil(18, 10, (u) => ({
    x: lerp(0.18, 0.82, u),
    y: lerp(0.18, 0.215, u),
    z: lerp(2.26, 1.94, u * u),
    chord: lerp(0.095, 0.072, u),
    thickness: 0.13,
    camber: 0.03,
    pitch: 0.05,
    roll: -0.08,
  }));
  addMirroredStatic(intakeBladeGeo, 'carbon', true, true);

  const splitterGeo = buildParametricSurface(
    44,
    16,
    (u, v) => {
      const s = (u - 0.5) * 2;
      const absS = Math.abs(s);
      const x = s * 0.995;

      const leadZ = 2.34 - 0.44 * Math.pow(absS, 1.85);
      const trailZ = Math.max(1.755, leadZ - lerp(0.24, 0.14, absS));

      const theta = v * Math.PI * 2;
      const xc = 0.5 * (1 + Math.cos(theta));
      const sign = Math.sin(theta) >= 0 ? 1 : -1;
      const halfThick = 0.012 * Math.sqrt(Math.max(0.04, Math.sin(xc * Math.PI)));
      const wingletLift = Math.pow(smoothstep(0.84, 1.0, absS), 1.85) * 0.115;

      const z = lerp(leadZ, trailZ, xc);
      const y =
        0.112 +
        wingletLift +
        sign * halfThick +
        0.008 * (1 - absS * absS) * (1 - xc);
      return [x, y, z];
    },
    { closedV: true, worldUV: true, uvScaleU: 1.8, uvScaleV: 1.8 },
  );
  addStatic(splitterGeo, 'carbon', true, true);

  const canardGeo = buildSculptedAirfoil(20, 12, (u) => ({
    x: lerp(0.89, 1.015, u),
    y: lerp(0.215, 0.315, Math.pow(u, 1.3)),
    z: lerp(2.02, 1.78, u),
    chord: lerp(0.088, 0.048, u),
    thickness: 0.12,
    camber: -0.05,
    pitch: -0.18,
    roll: 0.36,
  }));
  addMirroredStatic(canardGeo, 'carbon', true, true);

  const brakeVentBackGeo = buildParametricSurface(
    14,
    12,
    (u, v) => {
      const z = lerp(0.71, 0.98, u);
      const y = lerp(0.62, 0.17, v);
      const cove = Math.sin(v * Math.PI) * 0.045;
      const x = lerp(0.84, 0.89, u) - cove;
      return [x, y, z];
    },
    { flipWinding: false },
  );
  addMirroredStatic(brakeVentBackGeo, 'voidBlack', false, true);

  for (let i = 0; i < 3; i++) {
    const y0 = 0.25 + i * 0.115;
    const louverGeo = buildSculptedAirfoil(14, 10, (u) => ({
      x: lerp(0.835, 0.945, u),
      y: y0 + u * 0.022,
      z: lerp(0.76, 0.93, u),
      chord: 0.055,
      thickness: 0.14,
      camber: 0.02,
      pitch: 0.16,
      roll: -0.24,
    }));
    addMirroredStatic(louverGeo, 'carbon', true, true);
  }

  const crestGeo = buildVariableTube(
    [
      [0, frontEval.evalHoodCenterY(2.265) - 0.004, 2.265],
      [0, frontEval.evalHoodCenterY(2.235) + 0.002, 2.235],
      [0, frontEval.evalHoodCenterY(2.202) + 0.005, 2.202],
    ],
    (t) => [0.017 * (0.45 + 0.55 * Math.sin(t * Math.PI)), 0.0032],
    12,
    8,
  );
  addStatic(crestGeo, 'machinedAlu', false, false);

  // ==========================================================================
  // 3. DIHEDRAL BUTTERFLY DOORS, HYDRAULIC STRUTS, CARBON SILLS & C-INTAKES
  // ==========================================================================
  const sillTubGeo = buildSplineLoft(
    [
      [
        [0.66, 0.18, -0.76],
        [0.85, 0.17, -0.76],
        [0.86, 0.34, -0.76],
        [0.76, 0.42, -0.76],
        [0.66, 0.36, -0.76],
      ],
      [
        [0.66, 0.18, -0.05],
        [0.85, 0.17, -0.05],
        [0.85, 0.34, -0.05],
        [0.75, 0.41, -0.05],
        [0.66, 0.35, -0.05],
      ],
      [
        [0.66, 0.18, 0.67],
        [0.86, 0.17, 0.67],
        [0.86, 0.36, 0.67],
        [0.76, 0.44, 0.67],
        [0.66, 0.38, 0.67],
      ],
    ],
    22,
    16,
    { closedV: true, worldUV: true },
  );
  addMirroredStatic(sillTubGeo, 'carbon', true, true);

  const jambSealGeo = buildVariableTube(
    [
      [0.845, 0.19, 0.66],
      [0.845, 0.68, 0.64],
      [0.72, 0.72, 0.59],
      [0.515, 1.04, -0.04],
      [0.46, 1.02, -0.62],
      [0.86, 0.82, -0.74],
      [0.855, 0.2, -0.74],
    ],
    0.0085,
    36,
    8,
  );
  addMirroredStatic(jambSealGeo, 'voidBlack', false, false);

  const evalDoorOuter = (u: number, v: number): [number, number, number] => {
    const z = lerp(-0.78, 0.676, u);
    const yTop = lerp(0.84, 0.742, smootherstep(0, 1, u));
    const yBot = lerp(0.16, 0.155, u);
    const y = lerp(yTop, yBot, v);

    const shoulderX = lerp(0.965, 0.915, smootherstep(0, 1, u));
    const sillX = lerp(0.88, 0.895, u);
    const topTuck = -0.055 * Math.pow(smoothstep(0.18, 0.0, v), 1.8);
    const upperConvex = 0.044 * Math.sin(clamp(v / 0.65, 0, 1) * Math.PI);
    const rearPull = 1.0 - smootherstep(0.05, 0.88, u);
    const lowerBand =
      smoothstep(0.36, 0.72, v) * (1.0 - 0.55 * smoothstep(0.84, 1.0, v));
    const undercut = -0.105 * rearPull * lowerBand;

    const x = lerp(shoulderX, sillX, v) + topTuck + upperConvex + undercut;
    return [x, y, z];
  };

  const doorOuterGeo = buildParametricSurface(42, 26, evalDoorOuter, {
    worldUV: true,
    flipWinding: false,
  });
  const doorInnerCardGeo = buildParametricSurface(
    24,
    18,
    (u, v) => {
      const p = evalDoorOuter(u, v);
      const edge =
        smoothstep(0.0, 0.14, u) *
        smoothstep(1.0, 0.86, u) *
        smoothstep(0.0, 0.12, v) *
        smoothstep(1.0, 0.88, v);
      const thick = lerp(0.018, 0.058, edge);
      return [p[0] - thick, p[1], p[2]];
    },
    { worldUV: true, flipWinding: true },
  );
  const armrestGeo = buildVariableTube(
    [
      [0.852, 0.565, 0.42],
      [0.842, 0.555, 0.02],
      [0.838, 0.58, -0.46],
    ],
    (t) => [0.026 * (0.7 + 0.35 * Math.sin(t * Math.PI)), 0.032],
    18,
    10,
  );
  const pullStrapGeo = buildVariableTube(
    [
      [0.822, 0.545, 0.18],
      [0.788, 0.515, 0.14],
      [0.785, 0.495, 0.07],
      [0.822, 0.535, 0.05],
    ],
    [0.008, 0.003],
    14,
    8,
  );
  const ambientLedGeo = buildVariableTube(
    [
      [0.842, 0.625, 0.46],
      [0.835, 0.62, 0.0],
      [0.845, 0.65, -0.52],
    ],
    [0.0032, 0.0032],
    18,
    8,
  );
  const doorBladeGeo = buildVariableTube(
    [
      [0.892, 0.42, 0.56],
      [0.858, 0.415, 0.08],
      [0.832, 0.43, -0.4],
      [0.885, 0.465, -0.74],
    ],
    (t) => [0.011, 0.022 * (0.65 + 0.35 * Math.sin(t * Math.PI))],
    28,
    10,
    { worldUV: true },
  );
  const sideGlassGeo = buildParametricSurface(
    28,
    16,
    (u, v) => {
      const zTop = lerp(-0.62, -0.02, u);
      const zBot = lerp(-0.58, 0.6, u);
      const z = lerp(zTop, zBot, v);
      const yTop = lerp(1.025, 1.058, Math.sin(u * Math.PI * 0.65 + 0.35));
      const yBot = lerp(0.835, 0.742, u);
      const y = lerp(yTop, yBot, v);
      const xTop = lerp(0.46, 0.522, u);
      const xBot = lerp(0.895, 0.855, u) - 0.01 * Math.sin(u * Math.PI);
      const bulge = Math.sin(v * Math.PI) * 0.048;
      const x = lerp(xTop, xBot, Math.pow(v, 1.08)) + bulge;
      return [x, y, z];
    },
    { flipWinding: false },
  );
  const bPillarGeo = buildVariableTube(
    [
      [0.862, 0.806, -0.26],
      [0.725, 0.935, -0.3],
      [0.486, 1.046, -0.34],
    ],
    [0.009, 0.015],
    14,
    8,
  );
  const stalkGeo = buildSculptedAirfoil(18, 12, (u) => ({
    x: lerp(0.87, 1.035, u),
    y: lerp(0.755, 0.818, smoothstep(0, 1, u)),
    z: lerp(0.46, 0.4, u),
    chord: lerp(0.082, 0.052, u),
    thickness: 0.22,
    camber: 0.04,
    pitch: 0.08,
    roll: 0.28,
  }));
  const mirrorCapGeo = buildParametricSurface(
    18,
    14,
    (u, v) => {
      const theta = lerp(-0.1, Math.PI + 0.1, v);
      const prof = Math.sin(Math.pow(u, 0.74) * Math.PI);
      return [
        lerp(0.985, 1.14, u),
        0.828 + Math.sin(theta) * 0.036 * prof,
        0.398 + Math.cos(theta) * 0.064 * prof - u * 0.025,
      ];
    },
    { worldUV: true, flipWinding: false },
  );
  const mirrorBaseGeo = buildParametricSurface(
    18,
    12,
    (u, v) => {
      const theta = lerp(Math.PI, Math.PI * 2, v);
      const prof = Math.sin(Math.pow(u, 0.74) * Math.PI);
      return [
        lerp(0.985, 1.14, u),
        0.828 + Math.sin(theta) * 0.024 * prof,
        0.398 + Math.cos(theta) * 0.06 * prof - u * 0.025,
      ];
    },
    { worldUV: true, flipWinding: false },
  );
  const mirrorLedGeo = buildVariableTube(
    [
      [1.045, 0.826, 0.448],
      [1.105, 0.828, 0.422],
    ],
    [0.0022, 0.0022],
    8,
    8,
  );
  const mirrorFaceGeo = buildParametricSurface(
    12,
    8,
    (u, v) => {
      const a = u * Math.PI * 2;
      return [
        1.062 + Math.cos(a) * 0.052 * v,
        0.828 + Math.sin(a) * 0.024 * v,
        0.342 - 0.006 * Math.cos(a) * v,
      ];
    },
    { flipWinding: true },
  );

  const rawDoorParts: Array<{
    geo: THREE.BufferGeometry;
    mat: MatSlot;
    cast: boolean;
    recv: boolean;
    order: number;
  }> = [
    { geo: doorOuterGeo, mat: 'doorPaint', cast: true, recv: true, order: 0 },
    { geo: doorInnerCardGeo, mat: 'carbon', cast: false, recv: true, order: 0 },
    { geo: armrestGeo, mat: 'alcantara', cast: false, recv: true, order: 0 },
    { geo: pullStrapGeo, mat: 'seatTrimRed', cast: false, recv: false, order: 0 },
    { geo: ambientLedGeo, mat: 'doorAmbientMat', cast: false, recv: false, order: 0 },
    { geo: doorBladeGeo, mat: 'carbon', cast: true, recv: true, order: 0 },
    { geo: sideGlassGeo, mat: 'glass', cast: false, recv: false, order: 4 },
    { geo: bPillarGeo, mat: 'voidBlack', cast: false, recv: false, order: 0 },
    { geo: stalkGeo, mat: 'carbon', cast: true, recv: true, order: 0 },
    { geo: mirrorCapGeo, mat: 'paint', cast: true, recv: true, order: 0 },
    { geo: mirrorBaseGeo, mat: 'carbon', cast: true, recv: true, order: 0 },
    { geo: mirrorLedGeo, mat: 'ledWhite', cast: false, recv: false, order: 0 },
    { geo: mirrorFaceGeo, mat: 'mirrorChrome', cast: false, recv: false, order: 0 },
  ];

  const doorLMeshes: MeshTemplate[] = [];
  const doorRMeshes: MeshTemplate[] = [];
  for (const part of rawDoorParts) {
    trackGeo(part.geo);
    const mirGeo = trackGeo(mirrorGeometryX(part.geo));
    doorLMeshes.push({
      geo: part.geo,
      mat: part.mat,
      castShadow: part.cast,
      receiveShadow: part.recv,
      renderOrder: part.order,
    });
    doorRMeshes.push({
      geo: mirGeo,
      mat: part.mat,
      castShadow: part.cast,
      receiveShadow: part.recv,
      renderOrder: part.order,
    });
  }

  const doorLPivotPos: [number, number, number] = [0.82, 0.73, 0.68];
  const doorRPivotPos: [number, number, number] = [-0.82, 0.73, 0.68];
  const doorLStrutAnchorPos: [number, number, number] = [0.84, 0.44, 0.34];
  const doorRStrutAnchorPos: [number, number, number] = [-0.84, 0.44, 0.34];
  const chassisStrutAnchorLPos: [number, number, number] = [0.74, 0.5, 0.62];
  const chassisStrutAnchorRPos: [number, number, number] = [-0.74, 0.5, 0.62];
  const doorStrutGeos = createStrutGeometrySet(0.255, 0.275, 0.0095, 0.0046, allGeometries);

  // Side Skirts & C-Intakes
  const skirtGeo = buildParametricSurface(
    38,
    14,
    (u, v) => {
      const z = lerp(-0.92, 0.96, u);
      const theta = v * Math.PI * 2;
      const xc = 0.5 * (1 + Math.cos(theta));
      const sign = Math.sin(theta) >= 0 ? 1 : -1;

      const outerX = lerp(0.995, 0.945, u) + 0.024 * Math.pow(1 - u, 3);
      const innerX = outerX - 0.14;
      const x = lerp(outerX, innerX, xc);

      const wingletLift =
        Math.pow(smoothstep(0.16, 0.0, u), 1.85) * 0.155 * (1 - xc);
      const yBase = 0.116 + 0.018 * xc + wingletLift;
      const halfThick = 0.012 * Math.sqrt(Math.max(0.05, Math.sin(xc * Math.PI)));
      return [x, yBase + sign * halfThick, z];
    },
    { closedV: true, worldUV: true, uvScaleU: 1.8, uvScaleV: 1.5 },
  );
  addMirroredStatic(skirtGeo, 'carbon', true, true);

  const cFrameGeo = buildVariableTube(
    [
      [0.885, 0.852, -0.52],
      [0.955, 0.818, -0.66],
      [1.002, 0.675, -0.78],
      [0.998, 0.46, -0.8],
      [0.972, 0.275, -0.74],
      [0.935, 0.175, -0.58],
    ],
    (t) => {
      const w = 0.024 + 0.018 * Math.sin(t * Math.PI);
      return [w * 0.68, w * 1.4];
    },
    36,
    12,
    { worldUV: true },
  );
  addMirroredStatic(cFrameGeo, 'carbon', true, true);

  const radGrilleGeo = buildParametricSurface(
    12,
    12,
    (u, v) => {
      const z = lerp(-0.88, -0.72, u);
      const y = lerp(0.78, 0.22, v);
      const arc = Math.sin(v * Math.PI);
      const x = lerp(0.72, 0.86, u) + 0.042 * arc;
      return [x, y, z];
    },
    { flipWinding: false },
  );
  addMirroredStatic(radGrilleGeo, 'hexMesh', false, true);

  const sideVaneGeo = buildSculptedAirfoil(14, 10, (u) => ({
    x: lerp(0.74, 0.965, u),
    y: 0.495,
    z: lerp(-0.84, -0.71, u),
    chord: 0.12,
    thickness: 0.12,
    camber: 0,
    pitch: 0,
    roll: 0,
  }));
  addMirroredStatic(sideVaneGeo, 'carbon', true, true);

  // ==========================================================================
  // 4. REAR HAUNCHES, FLYING BUTTRESSES & KAMM-TAIL BRIDGE
  // ==========================================================================
  const TH_REAR = Math.PI + 0.3928;
  const TH_FRONT = -0.531;
  const R_ARCH_0 = 0.22;
  const R_ARCH_1 = 0.8;

  const evalRear = (u: number, v: number): [number, number, number] => {
    const zInner = lerp(-2.26, -0.68, u);
    const xInner = lerp(0.54, 0.52, u) + 0.04 * Math.sin(u * Math.PI);
    const yInner = lerp(0.835, 0.975, smootherstep(0, 1, u));

    let zLip: number, yLip: number, xLip: number;
    if (u < R_ARCH_0) {
      const k = u / R_ARCH_0;
      const zRearBot = HYPERCAR_SPEC.rZ + Math.cos(TH_REAR) * HYPERCAR_SPEC.rArchR;
      zLip = lerp(-2.24, zRearBot, k);
      yLip = lerp(0.365, 0.21, smootherstep(0, 1, k));
      xLip = lerp(0.915, 1.008, smoothstep(0, 1, k));
    } else if (u <= R_ARCH_1) {
      const k = (u - R_ARCH_0) / (R_ARCH_1 - R_ARCH_0);
      const th = lerp(TH_REAR, TH_FRONT, k);
      const cosT = Math.cos(th);
      const sinT = Math.sin(th);
      zLip = HYPERCAR_SPEC.rZ + cosT * HYPERCAR_SPEC.rArchR;
      yLip = HYPERCAR_SPEC.rR + sinT * HYPERCAR_SPEC.rArchR;
      xLip =
        1.028 -
        0.028 * Math.pow(Math.abs(cosT), 1.65) -
        0.015 * Math.max(0, -sinT);
    } else {
      const k = (u - R_ARCH_1) / (1.0 - R_ARCH_1);
      const zFrontBot = HYPERCAR_SPEC.rZ + Math.cos(TH_FRONT) * HYPERCAR_SPEC.rArchR;
      zLip = lerp(zFrontBot, -0.7, k);
      yLip = lerp(0.16, 0.165, k);
      xLip = lerp(1.005, 0.96, smoothstep(0, 1, k));
    }

    const vNorm = Math.min(v / 0.9, 1.0);
    const z = lerp(zInner, zLip, smootherstep(0.28, 0.9, vNorm));

    if (v <= 0.68) {
      const s = v / 0.68;
      const haunchWave = gauss(z, HYPERCAR_SPEC.rZ + 0.04, 0.5);
      const xShoulder = Math.max(xLip, 0.955 + 0.078 * haunchWave);
      const yShoulder =
        Math.max(yLip + 0.055, lerp(0.825, 0.875, u)) + 0.052 * haunchWave;

      const x = lerp(xInner, xShoulder, Math.pow(s, 0.9));
      const crown = 0.042 * Math.sin(s * Math.PI) * (0.45 + 0.55 * haunchWave);
      const y = lerp(yInner, yShoulder, smootherstep(0, 1, s)) + crown;
      return [x, y, z];
    } else if (v <= 0.9) {
      const st = (v - 0.68) / 0.22;
      const topP = evalRear(u, 0.68);
      const bulge = Math.sin(st * Math.PI) * 0.028;
      const x = lerp(topP[0], xLip, smootherstep(0, 1, st)) + bulge;
      const y = lerp(topP[1], yLip, Math.pow(st, 1.06));
      return [x, y, z];
    } else {
      const lt = (v - 0.9) / 0.1;
      const lipP = evalRear(u, 0.9);
      const rollIn = 0.036 * smootherstep(0, 1, lt);
      let dzRoll = 0,
        dyRoll = -0.005 * lt;
      if (u >= R_ARCH_0 && u <= R_ARCH_1) {
        const k = (u - R_ARCH_0) / (R_ARCH_1 - R_ARCH_0);
        const th = lerp(TH_REAR, TH_FRONT, k);
        dzRoll = -Math.cos(th) * 0.005 * lt;
        dyRoll = -Math.sin(th) * 0.005 * lt;
      }
      return [lipP[0] - rollIn, lipP[1] + dyRoll, lipP[2] + dzRoll];
    }
  };

  const rearHaunchGeo = buildParametricSurface(56, 36, (u, v) => evalRear(u, v), {
    worldUV: true,
    flipWinding: false,
  });
  addMirroredStatic(rearHaunchGeo, 'paint', true, true);

  const buttressGeo = buildSplineLoft(
    [
      [
        [0.44, 1.052, -0.6],
        [0.51, 1.015, -0.6],
        [0.55, 0.96, -0.6],
        [0.48, 0.968, -0.6],
      ],
      [
        [0.52, 0.992, -1.08],
        [0.61, 0.945, -1.08],
        [0.65, 0.895, -1.08],
        [0.56, 0.905, -1.08],
      ],
      [
        [0.62, 0.915, -1.62],
        [0.73, 0.878, -1.62],
        [0.77, 0.838, -1.62],
        [0.66, 0.848, -1.62],
      ],
      [
        [0.68, 0.848, -2.14],
        [0.82, 0.828, -2.14],
        [0.84, 0.805, -2.14],
        [0.72, 0.808, -2.14],
      ],
    ],
    28,
    14,
    { closedV: true, worldUV: true },
  );
  addMirroredStatic(buttressGeo, 'paint', true, true);

  const tailBridgeGeo = buildParametricSurface(
    14,
    32,
    (u, v) => {
      const s = (v - 0.5) * 2;
      const x = s * 0.94;
      const sweep = 0.068 * s * s;
      const z = lerp(-2.28, -2.08, u) + sweep;
      const lipDrop = -0.042 * Math.pow(smoothstep(0.32, 0.0, u), 1.75);
      const y = 0.846 - 0.022 * s * s + lipDrop + 0.012 * Math.sin(u * Math.PI);
      return [x, y, z];
    },
    { worldUV: true, flipWinding: false },
  );
  addStatic(tailBridgeGeo, 'paint', true, true);

  // ==========================================================================
  // 5. TEARDROP CANOPY, CERAMIC FRIT WINDSHIELD & DOUBLE-BUBBLE CARBON ROOF
  // ==========================================================================
  const windshieldGeo = buildParametricSurface(
    32,
    28,
    (u, v) => {
      const s = (v - 0.5) * 2;
      const absS = Math.abs(s);

      const halfW = lerp(0.515, 0.725, smoothstep(0, 1, u));
      const x = s * halfW;

      const wrapBack = lerp(0.11, 0.18, u) * Math.pow(absS, 1.85);
      const z = lerp(0.02, 0.78, u) - wrapBack;

      const dome = (1 - absS * absS) * lerp(0.042, 0.028, u);
      const y = lerp(1.088, 0.724, Math.pow(u, 1.08)) + dome;
      return [x, y, z];
    },
    { flipWinding: false },
  );
  addStatic(windshieldGeo, 'glass', false, false, 4);

  const wsFritBotGeo = buildParametricSurface(
    6,
    24,
    (u, v) => {
      const s = (v - 0.5) * 2;
      const absS = Math.abs(s);
      const uu = lerp(0.92, 1.0, u);
      const x = s * lerp(0.515, 0.725, smoothstep(0, 1, uu));
      const z = lerp(0.02, 0.78, uu) - lerp(0.11, 0.18, uu) * Math.pow(absS, 1.85);
      const y =
        lerp(1.088, 0.724, Math.pow(uu, 1.08)) +
        (1 - absS * absS) * lerp(0.042, 0.028, uu) -
        0.002;
      return [x, y, z];
    },
    { flipWinding: false },
  );
  addStatic(wsFritBotGeo, 'voidBlack', false, false);

  const roofGeo = buildParametricSurface(
    32,
    32,
    (u, v) => {
      const s = (v - 0.5) * 2;
      const absS = Math.abs(s);

      const halfW = lerp(0.455, 0.515, smoothstep(0, 1, u));
      const x = s * halfW;

      const wrap = 0.105 * Math.pow(absS, 1.8) * (0.45 + 0.55 * u);
      const z = lerp(-0.66, 0.02, u) - wrap;

      const longArc = Math.sin(lerp(0.14, 0.86, u) * Math.PI);
      const baseArch = lerp(1.036, 1.088, u) + 0.03 * longArc;
      const latDrop = -0.046 * Math.pow(absS, 2.0);
      const bubble = 0.018 * gauss(absS, 0.48, 0.2) * Math.sin(u * Math.PI);

      return [x, baseArch + latDrop + bubble, z];
    },
    { worldUV: true, uvScaleU: 1.0, uvScaleV: 1.0, flipWinding: false },
  );
  addStatic(roofGeo, 'carbon', true, true);

  const scoopGeo = buildSplineLoft(
    [
      [
        [0, 1.106, -0.1],
        [0.085, 1.108, -0.1],
        [0.072, 1.136, -0.12],
        [0, 1.145, -0.13],
        [-0.072, 1.136, -0.12],
        [-0.085, 1.108, -0.1],
      ],
      [
        [0, 1.092, -0.38],
        [0.095, 1.094, -0.38],
        [0.068, 1.136, -0.38],
        [0, 1.144, -0.38],
        [-0.068, 1.136, -0.38],
        [-0.095, 1.094, -0.38],
      ],
      [
        [0, 1.044, -0.7],
        [0.078, 1.046, -0.7],
        [0.044, 1.088, -0.7],
        [0, 1.096, -0.7],
        [-0.044, 1.088, -0.7],
        [-0.078, 1.046, -0.7],
      ],
      [
        [0, 0.996, -0.96],
        [0.052, 0.998, -0.96],
        [0.026, 1.024, -0.96],
        [0, 1.03, -0.96],
        [-0.026, 1.024, -0.96],
        [-0.052, 0.998, -0.96],
      ],
    ],
    24,
    18,
    { closedV: true, worldUV: true },
  );
  addStatic(scoopGeo, 'carbon', true, true);

  const scoopMouthGeo = buildParametricSurface(
    8,
    10,
    (u, v) => {
      const s = (v - 0.5) * 2;
      return [
        s * 0.068,
        lerp(1.11, 1.138 - 0.01 * s * s, u),
        -0.125 - 0.01 * Math.abs(s),
      ];
    },
    { flipWinding: true },
  );
  addStatic(scoopMouthGeo, 'hexMesh', false, false);

  const pillarGeo = buildVariableTube(
    [
      [0.728, 0.725, 0.6],
      [0.642, 0.9, 0.34],
      [0.52, 1.052, -0.04],
      [0.486, 1.064, -0.32],
      [0.456, 1.026, -0.64],
    ],
    (t) => [0.02, 0.03 * (1 - 0.22 * t)],
    36,
    12,
    { worldUV: true },
  );
  addMirroredStatic(pillarGeo, 'carbon', true, true);

  // ==========================================================================
  // 6. V12 ENGINE BAY (60° V12, TITANIUM HEADERS & 24K GOLD FOIL FIREWALL)
  // ==========================================================================
  const firewallGeo = buildParametricSurface(
    14,
    16,
    (u, v) => {
      const s = (v - 0.5) * 2;
      return [s * 0.48, lerp(0.32, 0.9, u), -0.78 - 0.03 * s * s];
    },
    { flipWinding: true },
  );
  addStatic(firewallGeo, 'goldFoil', false, true);

  const blockGeo = buildSplineLoft(
    [
      [
        [-0.22, 0.4, -0.88],
        [0.22, 0.4, -0.88],
        [0.3, 0.64, -0.88],
        [0, 0.6, -0.88],
        [-0.3, 0.64, -0.88],
      ],
      [
        [-0.22, 0.4, -1.72],
        [0.22, 0.4, -1.72],
        [0.3, 0.64, -1.72],
        [0, 0.6, -1.72],
        [-0.3, 0.64, -1.72],
      ],
    ],
    14,
    14,
    { closedV: true },
  );
  addStatic(blockGeo, 'matteCarbon', false, true);

  [-1, 1].forEach((side) => {
    const vcGeo = buildVariableTube(
      [
        [side * 0.245, 0.675, -0.92],
        [side * 0.255, 0.68, -1.3],
        [side * 0.245, 0.672, -1.68],
      ],
      [0.068, 0.042],
      20,
      12,
    );
    addStatic(vcGeo, 'crinkleRed', false, true);

    const plenumGeo = buildVariableTube(
      [
        [side * 0.145, 0.775, -0.92],
        [side * 0.155, 0.785, -1.3],
        [side * 0.14, 0.768, -1.66],
      ],
      (t) => [0.056 * (0.85 + 0.2 * Math.sin(t * Math.PI)), 0.042],
      20,
      12,
      { worldUV: true },
    );
    addStatic(plenumGeo, 'carbon', false, true);

    for (let c = 0; c < 6; c++) {
      const cz = lerp(-0.98, -1.62, c / 5);
      addStatic(
        buildVariableTube(
          [
            [side * 0.16, 0.74, cz],
            [side * 0.09, 0.71, cz],
            [side * 0.05, 0.65, cz],
          ],
          0.015,
          8,
          8,
        ),
        'machinedAlu',
        false,
        false,
      );

      addStatic(
        buildVariableTube(
          [
            [side * 0.29, 0.64, cz],
            [side * 0.37, 0.59, cz - 0.06],
            [side * 0.34, 0.52, -1.78],
            [side * 0.16, 0.53, -1.96],
          ],
          0.016,
          14,
          8,
        ),
        'titanium',
        false,
        false,
      );
    }
  });

  const xBraceA = buildVariableTube(
    [
      [-0.48, 0.904, -0.82],
      [-0.2, 0.916, -1.06],
      [0.0, 0.91, -1.28],
      [0.2, 0.892, -1.5],
      [0.47, 0.858, -1.76],
    ],
    [0.016, 0.01],
    24,
    10,
    { worldUV: true },
  );
  addMirroredStatic(xBraceA, 'carbon', false, true);

  const xHubGeo = trackGeo(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.0, 0.0),
        new THREE.Vector2(0.034, 0.0),
        new THREE.Vector2(0.04, 0.008),
        new THREE.Vector2(0.032, 0.018),
        new THREE.Vector2(0.0, 0.02),
      ],
      18,
    ),
  );
  addStatic(xHubGeo, 'machinedAlu', false, false, 0, [0, 0.9, -1.28]);

  const engGlassGeo = buildParametricSurface(
    22,
    18,
    (u, v) => {
      const s = (v - 0.5) * 2;
      const z = lerp(-2.1, -0.7, u);
      const halfW = lerp(0.53, 0.46, u);
      const y = lerp(0.842, 1.028, smoothstep(0, 1, u)) - 0.022 * s * s;
      return [s * halfW, y, z];
    },
    { flipWinding: false },
  );
  addStatic(engGlassGeo, 'engineGlass', false, false, 3);

  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const z = lerp(-1.0, -1.9, t);
    const y = lerp(0.988, 0.87, t);
    const wSpan = lerp(0.42, 0.48, t);
    const slatGeo = buildSculptedAirfoil(12, 10, (u) => ({
      x: lerp(0.24, wSpan, u),
      y: y - 0.016 * u * u + 0.008,
      z: z - 0.028 * u,
      chord: 0.056,
      thickness: 0.13,
      camber: 0.02,
      pitch: 0.24,
      roll: -0.05,
    }));
    addMirroredStatic(slatGeo, 'carbon', true, true);
  }

  addStatic(
    buildVariableTube(
      [
        [0, 1.024, -0.82],
        [0, 0.96, -1.36],
        [0, 0.886, -1.9],
        [0, 0.85, -2.12],
      ],
      (t) => [0.024 * (1 - 0.3 * t), 0.016],
      20,
      10,
      { worldUV: true },
    ),
    'carbon',
    true,
    true,
  );

  addStatic(
    buildVariableTube(
      [
        [0, 1.036, -0.86],
        [0, 1.002, -1.1],
      ],
      [0.0055, 0.004],
      10,
      8,
    ),
    'ledRed',
    false,
    false,
  );

  // ==========================================================================
  // 7. KAMM-TAIL REAR FASCIA, 3D RUBY OLED TAILLIGHTS, QUAD TITANIUM EXHAUST,
  //    VENTURI DIFFUSER & SWAN-NECK CARBON WING
  // ==========================================================================
  const rearGrilleGeo = buildParametricSurface(
    12,
    28,
    (u, v) => {
      const s = (v - 0.5) * 2;
      const x = s * 0.9;
      const z = -2.18 + 0.072 * s * s;
      const y = lerp(0.41, 0.8 - 0.022 * s * s, u);
      return [x, y, z];
    },
    { flipWinding: false },
  );
  addStatic(rearGrilleGeo, 'hexMesh', false, true);

  const rearBezelGeo = buildVariableTube(
    [
      [0.0, 0.806, -2.25],
      [0.58, 0.798, -2.22],
      [0.915, 0.762, -2.15],
      [0.925, 0.56, -2.12],
      [0.84, 0.395, -2.16],
      [0.5, 0.386, -2.22],
      [0.0, 0.394, -2.24],
    ],
    [0.016, 0.02],
    40,
    12,
    { worldUV: true },
  );
  addMirroredStatic(rearBezelGeo, 'carbon', true, true);

  const tlUpperPts: [number, number, number][] = [
    [-0.905, 0.678, -2.14],
    [-0.86, 0.746, -2.172],
    [-0.62, 0.752, -2.215],
    [-0.3, 0.746, -2.24],
    [0.0, 0.744, -2.246],
    [0.3, 0.746, -2.24],
    [0.62, 0.752, -2.215],
    [0.86, 0.746, -2.172],
    [0.905, 0.678, -2.14],
  ];
  addStatic(buildVariableTube(tlUpperPts, [0.0058, 0.0085], 56, 10), 'ledRed', false, false);
  addStatic(
    buildVariableTube(tlUpperPts, [0.012, 0.017], 48, 10),
    'rubyLens',
    false,
    false,
    3,
  );

  const tlLowerGeo = buildVariableTube(
    [
      [0.52, 0.692, -2.215],
      [0.82, 0.686, -2.176],
      [0.89, 0.63, -2.148],
    ],
    [0.0048, 0.0068],
    20,
    8,
  );
  addMirroredStatic(tlLowerGeo, 'ledRed', false, false);

  const exhaustTipGeo = trackGeo(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.036, 0.0),
        new THREE.Vector2(0.043, 0.0),
        new THREE.Vector2(0.047, 0.14),
        new THREE.Vector2(0.05, 0.215),
        new THREE.Vector2(0.047, 0.224),
        new THREE.Vector2(0.043, 0.22),
        new THREE.Vector2(0.04, 0.13),
        new THREE.Vector2(0.001, 0.04),
      ],
      32,
    ),
  );
  exhaustTipGeo.rotateX(-Math.PI * 0.5);

  const bezelPts: [number, number, number][] = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    bezelPts.push([Math.cos(a) * 0.252, 0.535 + Math.sin(a) * 0.068, -2.205]);
  }
  addStatic(
    buildVariableTube(bezelPts, [0.014, 0.018], 32, 10, {
      closed: true,
      worldUV: true,
    }),
    'carbon',
    true,
    true,
  );

  (
    [
      [-0.172, 0.531, -2.085],
      [-0.058, 0.537, -2.095],
      [0.058, 0.537, -2.095],
      [0.172, 0.531, -2.085],
    ] as [number, number, number][]
  ).forEach((pos) => {
    addStatic(exhaustTipGeo, 'titanium', true, true, 0, pos, [0.045, 0, 0]);
  });

  const diffuserDeckGeo = buildParametricSurface(
    18,
    30,
    (u, v) => {
      const s = (v - 0.5) * 2;
      const x = s * 0.68;
      const z = lerp(-2.31, -1.56, u) + 0.05 * s * s * (1 - u);
      const ramp = Math.pow(1 - u, 1.55);
      const venturiArch = 0.044 * Math.sin(Math.abs(s) * Math.PI) * (1 - u);
      const y = 0.12 + ramp * 0.248 + venturiArch;
      return [x, y, z];
    },
    { worldUV: true, uvScaleU: 1.8, uvScaleV: 1.8, flipWinding: false },
  );
  addStatic(diffuserDeckGeo, 'carbon', true, true);

  addStatic(
    buildVariableTube(
      [
        [-0.67, 0.36, -2.26],
        [-0.34, 0.378, -2.31],
        [0.0, 0.37, -2.32],
        [0.34, 0.378, -2.31],
        [0.67, 0.36, -2.26],
      ],
      [0.013, 0.015],
      28,
      10,
      { worldUV: true },
    ),
    'carbon',
    true,
    true,
  );

  [0.145, 0.375, 0.605].forEach((sx, idx) => {
    const strakeH = lerp(0.235, 0.185, idx / 2);
    const strakeGeo = buildSculptedAirfoil(16, 12, (u) => ({
      x: sx + idx * 0.014 * (1 - u),
      y: lerp(0.124 + idx * 0.008, 0.124 + strakeH + idx * 0.01, u),
      z: lerp(-1.95, -2.06, u) + idx * 0.022,
      chord: lerp(0.64 - idx * 0.06, 0.42, u),
      thickness: 0.048,
      camber: 0.02,
      pitch: 0,
      roll: Math.PI * 0.5,
    }));
    addMirroredStatic(strakeGeo, 'carbon', true, true);
  });

  addStatic(
    buildVariableTube(
      [
        [0, 0.195, -2.275],
        [0, 0.312, -2.305],
      ],
      [0.006, 0.0048],
      8,
      8,
    ),
    'ledRed',
    false,
    false,
  );

  const wingGeo = buildSculptedAirfoil(48, 22, (u) => {
    const s = (u - 0.5) * 2;
    const absS = Math.abs(s);
    return {
      x: s * 0.92,
      y: 1.062 + 0.032 * Math.pow(absS, 1.7),
      z: -2.15 - 0.105 * Math.pow(absS, 1.8),
      chord: lerp(0.3, 0.24, absS * absS),
      thickness: 0.135,
      camber: -0.075,
      pitch: 0.13 + 0.025 * absS,
      roll: -s * 0.035,
    };
  });
  addStatic(wingGeo, 'carbon', true, true);

  const epShape = new THREE.Shape();
  epShape.moveTo(0.14, 0.048);
  epShape.bezierCurveTo(0.175, 0.018, 0.175, -0.068, 0.088, -0.1);
  epShape.bezierCurveTo(-0.04, -0.12, -0.165, -0.075, -0.18, 0.012);
  epShape.bezierCurveTo(-0.18, 0.078, -0.075, 0.112, 0.042, 0.102);
  epShape.bezierCurveTo(0.1, 0.092, 0.128, 0.068, 0.14, 0.048);

  const epGeo = new THREE.ExtrudeGeometry(epShape, {
    depth: 0.011,
    bevelEnabled: true,
    bevelThickness: 0.0045,
    bevelSize: 0.004,
    bevelSegments: 4,
    curveSegments: 20,
  });
  epGeo.rotateY(Math.PI * 0.5);
  epGeo.translate(0.916, 1.094, -2.26);
  addMirroredStatic(epGeo, 'carbon', true, true);

  addMirroredStatic(
    buildVariableTube(
      [
        [0.93, 1.028, -2.14],
        [0.93, 0.996, -2.26],
        [0.93, 1.018, -2.38],
      ],
      [0.003, 0.0038],
      14,
      8,
    ),
    'anodizedRed',
    false,
    false,
  );

  const swanNeckGeo = buildVariableTube(
    [
      [0.24, 0.842, -1.98],
      [0.25, 0.946, -2.03],
      [0.255, 1.076, -2.01],
      [0.26, 1.122, -2.09],
      [0.26, 1.084, -2.16],
    ],
    (t) => [0.011, 0.034 * (1.15 - 0.35 * t)],
    30,
    12,
  );
  addMirroredStatic(swanNeckGeo, 'machinedAlu', true, true);

  addMirroredStatic(
    buildVariableTube(
      [
        [0.26, 1.082, -2.13],
        [0.26, 1.068, -2.23],
      ],
      [0.014, 0.007],
      8,
      8,
    ),
    'carbon',
    true,
    true,
  );

  // ==========================================================================
  // 8. INTERIOR COCKPIT + SYNCHRONIZED D-SHAPED STEERING WHEEL
  // ==========================================================================
  addStatic(
    buildParametricSurface(16, 12, (u, v) => {
      const s = (v - 0.5) * 2;
      return [
        s * 0.7,
        0.18 + Math.pow(Math.abs(s), 4) * 0.52,
        lerp(-0.68, 0.78, u),
      ];
    }),
    'matteCarbon',
    false,
    true,
  );

  addStatic(
    buildParametricSurface(
      20,
      14,
      (u, v) => {
        const s = (v - 0.5) * 2;
        const x = s * 0.7;
        const z = lerp(0.32, 0.76, u) - 0.09 * s * s;
        const binnacle = 0.08 * gauss(s, 0.44, 0.22) * Math.sin(u * Math.PI);
        const y =
          lerp(0.61, 0.7, u) +
          Math.sin(u * Math.PI) * 0.058 +
          binnacle -
          0.025 * s * s;
        return [x, y, z];
      },
      { flipWinding: false },
    ),
    'alcantara',
    false,
    true,
  );

  addStatic(
    buildParametricSurface(
      8,
      12,
      (u, v) => {
        const s = (v - 0.5) * 2;
        return [
          0.3 + s * 0.13,
          lerp(0.665, 0.752, u),
          0.435 + 0.022 * s * s - 0.02 * u,
        ];
      },
      { flipWinding: false },
    ),
    'clusterOLED',
    false,
    false,
  );

  addStatic(
    buildSplineLoft(
      [
        [
          [-0.075, 0.57, 0.38],
          [0.075, 0.57, 0.38],
          [0.085, 0.49, 0.38],
          [-0.085, 0.49, 0.38],
        ],
        [
          [-0.07, 0.46, 0.04],
          [0.07, 0.46, 0.04],
          [0.09, 0.33, 0.04],
          [-0.09, 0.33, 0.04],
        ],
        [
          [-0.075, 0.43, -0.52],
          [0.075, 0.43, -0.52],
          [0.095, 0.23, -0.52],
          [-0.095, 0.23, -0.52],
        ],
      ],
      16,
      10,
      { closedV: true, worldUV: true },
    ),
    'carbon',
    false,
    true,
  );

  for (let i = 0; i < 4; i++) {
    const swZ = lerp(0.22, 0.02, i / 3);
    const swY = lerp(0.53, 0.47, i / 3);
    addStatic(
      buildVariableTube(
        [
          [0, swY, swZ],
          [0, swY + 0.02, swZ + 0.008],
        ],
        0.005,
        5,
        6,
      ),
      'machinedAlu',
      false,
      false,
    );
  }

  const addBucketSeat = (cx: number) => {
    addStatic(
      buildParametricSurface(
        22,
        16,
        (u, v) => {
          const s = (v - 0.5) * 2;
          const absS = Math.abs(s);
          const halfW =
            0.205 +
            0.042 * gauss(u, 0.72, 0.16) -
            0.09 * smoothstep(0.82, 1.0, u);
          const bolster =
            Math.pow(absS, 2.2) * (0.09 * (1 - 0.55 * smoothstep(0.82, 1.0, u)));
          let y: number, z: number;
          if (u < 0.36) {
            const k = u / 0.36;
            z = lerp(0.22, -0.14, k);
            y = lerp(0.32, 0.24, k) + bolster * 0.85;
          } else {
            const k = (u - 0.36) / 0.64;
            z = lerp(-0.14, -0.5, k) + bolster;
            y = lerp(0.24, 0.94, k);
          }
          return [cx + s * halfW, y, z];
        },
        { flipWinding: false },
      ),
      'alcantara',
      false,
      true,
    );

    addStatic(
      buildParametricSurface(
        18,
        14,
        (u, v) => {
          const s = (v - 0.5) * 2;
          const absS = Math.abs(s);
          const halfW =
            0.215 +
            0.042 * gauss(u, 0.72, 0.16) -
            0.09 * smoothstep(0.82, 1.0, u);
          const bolster =
            Math.pow(absS, 2.2) * (0.09 * (1 - 0.55 * smoothstep(0.82, 1.0, u)));
          return [
            cx + s * halfW,
            lerp(0.23, 0.94, u),
            lerp(-0.15, -0.53, u) + bolster - 0.024,
          ];
        },
        { worldUV: true, flipWinding: true },
      ),
      'carbon',
      false,
      true,
    );

    [-1, 1].forEach((side) => {
      addStatic(
        buildVariableTube(
          [
            [cx + side * 0.19, 0.42, -0.18],
            [cx + side * 0.23, 0.72, -0.32],
            [cx + side * 0.13, 0.93, -0.47],
          ],
          0.0045,
          14,
          8,
        ),
        'seatTrimRed',
        false,
        false,
      );
    });
  };
  addBucketSeat(0.3);
  addBucketSeat(-0.3);

  const steeringColumnPos: [number, number, number] = [0.3, 0.676, 0.215];
  const steeringColumnRotX = 0.26;
  [-1, 1].forEach((side) => {
    const paddleGeo = buildVariableTube(
      [
        [side * 0.054, 0.01, -0.046],
        [side * 0.102, 0.044, -0.04],
        [side * 0.112, 0.092, -0.034],
      ],
      [0.015, 0.004],
      12,
      8,
    );
    addStatic(
      paddleGeo,
      'machinedAlu',
      false,
      false,
      0,
      steeringColumnPos,
      [steeringColumnRotX, 0, 0],
    );
  });

  const steeringWheelMeshes: MeshTemplate[] = [];
  const rimWheelPts: [number, number, number][] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const rx = Math.cos(a) * 0.152;
    let ry = Math.sin(a) * 0.146;
    if (ry < -0.108) ry = -0.108 - (ry + 0.108) * 0.25;
    rimWheelPts.push([rx, ry, 0]);
  }
  steeringWheelMeshes.push({
    geo: trackGeo(
      buildVariableTube(
        rimWheelPts,
        (t) => {
          const grip = 1 + 0.22 * Math.pow(Math.cos(t * Math.PI * 2), 4);
          return [0.0145 * grip, 0.0165 * grip];
        },
        36,
        10,
        { closed: true },
      ),
    ),
    mat: 'alcantara',
    castShadow: false,
    receiveShadow: false,
  });

  steeringWheelMeshes.push({
    geo: trackGeo(
      buildVariableTube(
        [
          [-0.013, 0.146, 0],
          [0, 0.147, 0],
          [0.013, 0.146, 0],
        ],
        0.0168,
        8,
        10,
      ),
    ),
    mat: 'anodizedRed',
    castShadow: false,
    receiveShadow: false,
  });

  (
    [
      [
        [-0.134, 0.01, -0.005],
        [-0.04, 0, -0.02],
        [0, 0, -0.024],
      ],
      [
        [0.134, 0.01, -0.005],
        [0.04, 0, -0.02],
        [0, 0, -0.024],
      ],
      [
        [0, -0.108, -0.005],
        [0, -0.05, -0.02],
        [0, 0, -0.024],
      ],
    ] as [number, number, number][][]
  ).forEach((pts) => {
    steeringWheelMeshes.push({
      geo: trackGeo(buildVariableTube(pts, [0.013, 0.0075], 10, 8, { worldUV: true })),
      mat: 'carbon',
      castShadow: false,
      receiveShadow: false,
    });
  });

  steeringWheelMeshes.push({
    geo: trackGeo(
      buildVariableTube(
        [
          [0, 0, -0.012],
          [0, 0, -0.046],
        ],
        [0.044, 0.04],
        8,
        12,
      ),
    ),
    mat: 'carbon',
    castShadow: false,
    receiveShadow: false,
  });

  // ==========================================================================
  // 9. LSPD AERODYNAMIC LOW-PROFILE POLICE LIGHTBAR (FOR LSPD INTERCEPTOR)
  // ==========================================================================
  const policeRoofBarMeshes: MeshTemplate[] = [];
  const barCenterFrameGeo = trackGeo(
    buildVariableTube(
      [
        [-0.48, 1.12, -0.22],
        [-0.22, 1.145, -0.24],
        [0.0, 1.152, -0.25],
        [0.22, 1.145, -0.24],
        [0.48, 1.12, -0.22],
      ],
      [0.018, 0.012],
      24,
      10,
      { worldUV: true },
    ),
  );
  const sirenPodRedGeo = trackGeo(
    buildVariableTube(
      [
        [-0.46, 1.125, -0.21],
        [-0.25, 1.146, -0.23],
        [-0.06, 1.152, -0.24],
      ],
      [0.024, 0.016],
      16,
      10,
    ),
  );
  const sirenPodBlueGeo = trackGeo(
    buildVariableTube(
      [
        [0.06, 1.152, -0.24],
        [0.25, 1.146, -0.23],
        [0.46, 1.125, -0.21],
      ],
      [0.024, 0.016],
      16,
      10,
    ),
  );
  policeRoofBarMeshes.push(
    { geo: barCenterFrameGeo, mat: 'carbon', castShadow: true, receiveShadow: false },
    { geo: sirenPodRedGeo, mat: 'sirenRed', castShadow: false, receiveShadow: false },
    { geo: sirenPodBlueGeo, mat: 'sirenBlue', castShadow: false, receiveShadow: false },
  );

  // ==========================================================================
  // 10. FORGED CONCAVE 10-SPOKE Y-WHEELS, SEMI-SLICK TIRES & CERAMIC BRAKES
  // ==========================================================================
  const buildWheelCornerTemplates = (
    radius: number,
    width: number,
    isFront: boolean,
    isLeft: boolean,
  ): WheelCornerTemplates => {
    const spinMeshes: MeshTemplate[] = [];
    const knuckleMeshes: MeshTemplate[] = [];
    const sideSign = isLeft ? 1 : -1;
    const rimR = radius * 0.768;
    const halfW = width * 0.5;

    const tireSpline = new THREE.SplineCurve([
      new THREE.Vector2(rimR - 0.005, -halfW * 0.88),
      new THREE.Vector2(rimR + 0.012, -halfW * 0.94),
      new THREE.Vector2(rimR + 0.038, -halfW * 1.01),
      new THREE.Vector2(radius - 0.02, -halfW * 0.99),
      new THREE.Vector2(radius - 0.007, -halfW * 0.9),
      new THREE.Vector2(radius - 0.002, -halfW * 0.75),
      new THREE.Vector2(radius, -halfW * 0.42),
      new THREE.Vector2(radius + 0.002, 0),
      new THREE.Vector2(radius, halfW * 0.42),
      new THREE.Vector2(radius - 0.002, halfW * 0.75),
      new THREE.Vector2(radius - 0.007, halfW * 0.9),
      new THREE.Vector2(radius - 0.02, halfW * 0.99),
      new THREE.Vector2(rimR + 0.038, halfW * 1.01),
      new THREE.Vector2(rimR + 0.012, halfW * 0.95),
      new THREE.Vector2(rimR - 0.005, halfW * 0.88),
    ]);
    const tireGeo = trackGeo(new THREE.LatheGeometry(tireSpline.getPoints(30), 48));
    tireGeo.rotateZ(isLeft ? -Math.PI * 0.5 : Math.PI * 0.5);
    spinMeshes.push({
      geo: tireGeo,
      mat: 'tire',
      castShadow: true,
      receiveShadow: true,
    });

    const barrelGeo = trackGeo(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(rimR - 0.004, -halfW * 0.88),
          new THREE.Vector2(rimR - 0.018, -halfW * 0.8),
          new THREE.Vector2(rimR - 0.024, -halfW * 0.22),
          new THREE.Vector2(rimR - 0.02, halfW * 0.54),
          new THREE.Vector2(rimR - 0.006, halfW * 0.84),
          new THREE.Vector2(rimR + 0.004, halfW * 0.89),
          new THREE.Vector2(rimR - 0.004, halfW * 0.91),
          new THREE.Vector2(rimR - 0.016, halfW * 0.86),
          new THREE.Vector2(rimR - 0.032, halfW * 0.58),
          new THREE.Vector2(rimR - 0.032, -halfW * 0.8),
        ],
        44,
      ),
    );
    barrelGeo.rotateZ(isLeft ? -Math.PI * 0.5 : Math.PI * 0.5);
    spinMeshes.push({
      geo: barrelGeo,
      mat: 'wheelAlloy',
      castShadow: true,
      receiveShadow: false,
    });

    const hubOutX = sideSign * (isFront ? halfW * 0.22 : halfW * 0.1);
    const rimOutX = sideSign * (halfW * 0.78);
    const midDishX = sideSign * (isFront ? halfW * 0.44 : halfW * 0.28);

    // 10 Forged Y-Spokes
    for (let i = 0; i < 5; i++) {
      const baseA = (i / 5) * Math.PI * 2;
      const split = 0.285;

      [-1, 1].forEach((fork) => {
        const a0 = baseA + fork * 0.07;
        const a1 = baseA + fork * 0.138;
        const a2 = baseA + fork * split;
        const r0 = 0.056;
        const r1 = rimR * 0.46;
        const r2 = rimR * 0.955;

        const spokeGeo = trackGeo(
          buildVariableTube(
            [
              [hubOutX, Math.sin(a0) * r0, Math.cos(a0) * r0],
              [midDishX, Math.sin(a1) * r1, Math.cos(a1) * r1],
              [
                lerp(midDishX, rimOutX, 0.65),
                Math.sin(lerp(a1, a2, 0.62)) * (rimR * 0.74),
                Math.cos(lerp(a1, a2, 0.62)) * (rimR * 0.74),
              ],
              [rimOutX, Math.sin(a2) * r2, Math.cos(a2) * r2],
            ],
            (t) => {
              const th = lerp(0.0135, 0.0082, t);
              return [th * 1.42, th * 0.76];
            },
            14,
            8,
          ),
        );
        spinMeshes.push({
          geo: spokeGeo,
          mat: 'wheelAlloy',
          castShadow: true,
          receiveShadow: false,
        });

        const spokeAccentGeo = trackGeo(
          buildVariableTube(
            [
              [
                hubOutX + sideSign * 0.009,
                Math.sin(a0) * (r0 + 0.01),
                Math.cos(a0) * (r0 + 0.01),
              ],
              [midDishX + sideSign * 0.008, Math.sin(a1) * r1, Math.cos(a1) * r1],
              [
                rimOutX + sideSign * 0.005,
                Math.sin(a2) * (r2 - 0.008),
                Math.cos(a2) * (r2 - 0.008),
              ],
            ],
            [0.0036, 0.0024],
            12,
            6,
          ),
        );
        spinMeshes.push({
          geo: spokeAccentGeo,
          mat: 'machinedAlu',
          castShadow: false,
          receiveShadow: false,
        });
      });
    }

    // Air valve
    spinMeshes.push({
      geo: trackGeo(
        buildVariableTube(
          [
            [sideSign * (halfW * 0.72), rimR - 0.02, 0],
            [sideSign * (halfW * 0.74), rimR - 0.042, 0],
          ],
          0.003,
          6,
          6,
        ),
      ),
      mat: 'machinedAlu',
      castShadow: false,
      receiveShadow: false,
    });

    // Hub bell & Anodized Red Center-Lock Nut
    const hubBellGeo = trackGeo(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.0, halfW * 0.02),
          new THREE.Vector2(0.068, halfW * 0.06),
          new THREE.Vector2(0.064, halfW * 0.25),
          new THREE.Vector2(0.048, halfW * 0.3),
          new THREE.Vector2(0.0, halfW * 0.3),
        ],
        24,
      ),
    );
    hubBellGeo.rotateZ(isLeft ? -Math.PI * 0.5 : Math.PI * 0.5);
    spinMeshes.push({
      geo: hubBellGeo,
      mat: 'wheelAlloy',
      castShadow: false,
      receiveShadow: false,
    });

    const nutShape = new THREE.Shape();
    for (let i = 0; i <= 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const r = i % 2 === 0 ? 0.042 : 0.034;
      if (i === 0) nutShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else nutShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const nutGeo = trackGeo(
      new THREE.ExtrudeGeometry(nutShape, {
        depth: 0.019,
        bevelEnabled: true,
        bevelThickness: 0.0045,
        bevelSize: 0.0038,
        bevelSegments: 3,
      }),
    );
    nutGeo.rotateY(isLeft ? Math.PI * 0.5 : -Math.PI * 0.5);
    nutGeo.translate(sideSign * (halfW * 0.26), 0, 0);
    spinMeshes.push({
      geo: nutGeo,
      mat: 'anodizedRed',
      castShadow: false,
      receiveShadow: false,
    });

    const pinGeo = trackGeo(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0, 0),
          new THREE.Vector2(0.018, 0),
          new THREE.Vector2(0.016, 0.011),
          new THREE.Vector2(0.009, 0.016),
          new THREE.Vector2(0, 0.017),
        ],
        16,
      ),
    );
    pinGeo.rotateZ(isLeft ? -Math.PI * 0.5 : Math.PI * 0.5);
    pinGeo.translate(sideSign * (halfW * 0.33), 0, 0);
    spinMeshes.push({
      geo: pinGeo,
      mat: 'machinedAlu',
      castShadow: false,
      receiveShadow: false,
    });

    // Cross-Drilled Carbon-Ceramic Brake Rotor (spins with spinHub)
    const rotorR = isFront ? 0.204 : 0.194;
    const rotorX = 0.0;

    const makeRotorFace = (offsetX: number, flip: boolean) => {
      const g = trackGeo(
        buildParametricSurface(
          36,
          4,
          (u, v) => {
            const a = u * Math.PI * 2;
            const r = lerp(rotorR * 0.5, rotorR, v);
            return [rotorX + offsetX, Math.sin(a) * r, Math.cos(a) * r];
          },
          { flipWinding: flip },
        ),
      );
      const pos = g.attributes.position as THREE.BufferAttribute;
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        uv.setXY(
          i,
          0.5 + pos.getZ(i) / (rotorR * 2),
          0.5 + pos.getY(i) / (rotorR * 2),
        );
      }
      uv.needsUpdate = true;
      return g;
    };
    spinMeshes.push({
      geo: makeRotorFace(sideSign * 0.015, !isLeft),
      mat: 'ceramicRotor',
      castShadow: false,
      receiveShadow: false,
    });
    spinMeshes.push({
      geo: makeRotorFace(-sideSign * 0.015, isLeft),
      mat: 'ceramicRotor',
      castShadow: false,
      receiveShadow: false,
    });
    spinMeshes.push({
      geo: trackGeo(
        buildParametricSurface(
          36,
          4,
          (u, v) => {
            const a = u * Math.PI * 2;
            const r = rotorR - 0.002 * Math.sin(v * Math.PI);
            return [rotorX + lerp(-0.015, 0.015, v), Math.sin(a) * r, Math.cos(a) * r];
          },
          { closedU: true },
        ),
      ),
      mat: 'matteCarbon',
      castShadow: false,
      receiveShadow: false,
    });

    const hatGeo = trackGeo(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.055, -0.02),
          new THREE.Vector2(rotorR * 0.52, -0.016),
          new THREE.Vector2(rotorR * 0.52, 0.016),
          new THREE.Vector2(rotorR * 0.45, 0.025),
          new THREE.Vector2(0.055, 0.025),
        ],
        24,
      ),
    );
    hatGeo.rotateZ(isLeft ? -Math.PI * 0.5 : Math.PI * 0.5);
    hatGeo.translate(rotorX, 0, 0);
    spinMeshes.push({
      geo: hatGeo,
      mat: 'matteCarbon',
      castShadow: false,
      receiveShadow: false,
    });

    for (let b = 0; b < 10; b++) {
      const ba = (b / 10) * Math.PI * 2;
      const br = rotorR * 0.51;
      spinMeshes.push({
        geo: trackGeo(
          buildVariableTube(
            [
              [rotorX + sideSign * 0.009, Math.sin(ba) * br, Math.cos(ba) * br],
              [rotorX + sideSign * 0.022, Math.sin(ba) * br, Math.cos(ba) * br],
            ],
            0.0065,
            5,
            6,
          ),
        ),
        mat: 'machinedAlu',
        castShadow: false,
        receiveShadow: false,
      });
    }

    // Steering Knuckle & 6-Piston Giallo Modena Brake Caliper (steers with knuckleGroup, stationary during roll!)
    const uprightGeo = trackGeo(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.032, -halfW * 0.65),
          new THREE.Vector2(0.06, -halfW * 0.35),
          new THREE.Vector2(0.055, -halfW * 0.12),
          new THREE.Vector2(0.03, -halfW * 0.1),
        ],
        16,
      ),
    );
    uprightGeo.rotateZ(isLeft ? -Math.PI * 0.5 : Math.PI * 0.5);
    knuckleMeshes.push({
      geo: uprightGeo,
      mat: 'matteCarbon',
      castShadow: false,
      receiveShadow: false,
    });

    const calCenterA = isFront ? Math.PI : 0;
    const calSpan = isFront ? 1.08 : 0.9;
    const calInR = rotorR * 0.63;
    const calOutR = rotorR + 0.035;

    const calShape = new THREE.Shape();
    const segs = 16;
    for (let i = 0; i <= segs; i++) {
      const a = calCenterA - calSpan * 0.5 + (i / segs) * calSpan;
      const r = calOutR + 0.006 * Math.sin((i / segs) * Math.PI);
      if (i === 0) calShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else calShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    for (let i = segs; i >= 0; i--) {
      const a = calCenterA - calSpan * 0.5 + (i / segs) * calSpan;
      calShape.lineTo(Math.cos(a) * calInR, Math.sin(a) * calInR);
    }
    calShape.closePath();

    const calGeo = trackGeo(
      new THREE.ExtrudeGeometry(calShape, {
        depth: 0.066,
        bevelEnabled: true,
        bevelThickness: 0.015,
        bevelSize: 0.011,
        bevelSegments: 4,
        curveSegments: 16,
      }),
    );
    calGeo.translate(0, 0, -0.033);
    calGeo.rotateY(Math.PI * 0.5);
    calGeo.translate(rotorX + sideSign * 0.006, 0, 0);
    knuckleMeshes.push({
      geo: calGeo,
      mat: 'caliperGold',
      castShadow: true,
      receiveShadow: false,
    });

    const pistons = isFront ? [-1, 0, 1] : [-0.65, 0.65];
    pistons.forEach((p) => {
      const pa = calCenterA + p * 0.24;
      const pr = (calInR + calOutR) * 0.52;
      knuckleMeshes.push({
        geo: trackGeo(
          buildVariableTube(
            [
              [rotorX + sideSign * 0.042, Math.sin(pa) * pr, Math.cos(pa) * pr],
              [rotorX + sideSign * 0.052, Math.sin(pa) * pr, Math.cos(pa) * pr],
            ],
            0.007,
            5,
            6,
          ),
        ),
        mat: 'machinedAlu',
        castShadow: false,
        receiveShadow: false,
      });
    });

    return { spinMeshes, knuckleMeshes };
  };

  const wheels = {
    frontLeft: buildWheelCornerTemplates(
      HYPERCAR_SPEC.fR,
      HYPERCAR_SPEC.fW,
      true,
      true,
    ),
    frontRight: buildWheelCornerTemplates(
      HYPERCAR_SPEC.fR,
      HYPERCAR_SPEC.fW,
      true,
      false,
    ),
    rearLeft: buildWheelCornerTemplates(
      HYPERCAR_SPEC.rR,
      HYPERCAR_SPEC.rW,
      false,
      true,
    ),
    rearRight: buildWheelCornerTemplates(
      HYPERCAR_SPEC.rR,
      HYPERCAR_SPEC.rW,
      false,
      false,
    ),
  };

  const contactShadowGeo = trackGeo(
    buildParametricSurface(
      2,
      2,
      (u, v) => [lerp(-1.9, 1.9, v), 0.03, lerp(-3.15, 3.15, u)],
      { flipWinding: false },
    ),
  );

  const headlightBeamGeo = trackGeo(new THREE.PlaneGeometry(4.8, 13));
  headlightBeamGeo.rotateX(-Math.PI * 0.5);

  const nitroFlameGeo = trackGeo(new THREE.ConeGeometry(0.085, 0.88, 8));
  nitroFlameGeo.rotateX(-Math.PI * 0.5);

  masterHypercarCache = {
    textures,
    materials,
    staticBodyMeshes,
    policeRoofBarMeshes,
    frunkLidMeshes,
    frunkHingePos,
    frunkLidAnchorLPos,
    frunkLidAnchorRPos,
    frunkChassisAnchorLPos,
    frunkChassisAnchorRPos,
    frunkStrutGeos,
    doorLMeshes,
    doorRMeshes,
    doorLPivotPos,
    doorRPivotPos,
    doorLStrutAnchorPos,
    doorRStrutAnchorPos,
    chassisStrutAnchorLPos,
    chassisStrutAnchorRPos,
    doorStrutGeos,
    steeringWheelMeshes,
    steeringColumnPos,
    steeringColumnRotX,
    wheels,
    contactShadowGeo,
    headlightBeamGeo,
    nitroFlameGeo,
    allGeometries,
  };
  return masterHypercarCache;
}

export function disposeMasterHypercarAssets(): void {
  if (!masterHypercarCache) return;
  for (const geo of masterHypercarCache.allGeometries) {
    geo.dispose();
  }
  for (const tex of Object.values(masterHypercarCache.textures)) {
    tex.dispose();
  }
  for (const mat of Object.values(masterHypercarCache.materials)) {
    mat.dispose();
  }
  masterHypercarCache = null;
}

export function warmMasterHypercarAssets(anisotropy = 8): void {
  buildMasterHypercarAssets(anisotropy);
}

// ============================================================================
// HYDRAULIC ACTUATOR & ARTICULATED HYPERCAR RIG INSTANCE
// ============================================================================

export interface HydraulicActuatorState {
  value: number;
  target: number;
  vel: number;
}

export interface TelescopicStrutInstance {
  cylMesh: THREE.Mesh;
  rodMesh: THREE.Mesh;
  anchorA: THREE.Object3D;
  anchorB: THREE.Object3D;
  update: (spaceParent: THREE.Object3D) => void;
}

export interface HypercarArticulation {
  doorL: HydraulicActuatorState;
  doorR: HydraulicActuatorState;
  frunk: HydraulicActuatorState;
  doorLPivot: THREE.Group;
  doorRPivot: THREE.Group;
  doorLAxis: THREE.Vector3;
  doorRAxis: THREE.Vector3;
  doorMaxAngle: number;
  frunkPivot: THREE.Group;
  frunkLedMat: THREE.MeshStandardMaterial;
  steeringWheelSpin: THREE.Group;
  doorLStrut: TelescopicStrutInstance;
  doorRStrut: TelescopicStrutInstance;
  frunkStrutL: TelescopicStrutInstance;
  frunkStrutR: TelescopicStrutInstance;
  pulseTime: number;
  autoCloseTimer: number;
  frontSpin: number;
  rearSpin: number;
}

export function stepHydraulic(
  state: HydraulicActuatorState,
  dt: number,
  maxSpeed = 0.56,
): number {
  let rem = Math.min(Math.max(dt, 0), 1.5);
  while (rem > 0.0001) {
    const step = Math.min(rem, 1 / 60);
    const diff = state.target - state.value;
    const dist = Math.abs(diff);
    const cushion = smootherstep(0.0, 0.24, dist);
    const rateLimit = lerp(0.1, maxSpeed, cushion);
    const desiredVel = clamp(diff * 2.8, -rateLimit, rateLimit);
    state.vel = lerp(state.vel, desiredVel, clamp(step * 6.5, 0, 1));
    state.value = clamp(state.value + state.vel * step, 0, 1);
    if (dist < 0.0006 && Math.abs(state.vel) < 0.0015) {
      state.value = state.target;
      state.vel = 0;
      break;
    }
    rem -= step;
  }
  return state.value;
}

const _upAxis = new THREE.Vector3(0, 1, 0);
const _xAxis = new THREE.Vector3(1, 0, 0);
const _pA = new THREE.Vector3();
const _pB = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _negDir = new THREE.Vector3();

function instantiateTelescopicStrut(
  parentGroup: THREE.Group,
  geos: StrutGeometrySet,
  mats: HypercarSharedMaterials,
  anchorA: THREE.Object3D,
  anchorB: THREE.Object3D,
): TelescopicStrutInstance {
  const cylMesh = new THREE.Mesh(geos.cylGeo, mats.matteCarbon);
  cylMesh.add(new THREE.Mesh(geos.collarGeo, mats.machinedAlu));
  const rodMesh = new THREE.Mesh(geos.rodGeo, mats.machinedAlu);
  parentGroup.add(cylMesh, rodMesh);

  const safeAlign = (mesh: THREE.Mesh, v: THREE.Vector3) => {
    const dot = clamp(_upAxis.dot(v), -1, 1);
    if (dot < -0.9999) {
      mesh.quaternion.setFromAxisAngle(_xAxis, Math.PI);
    } else {
      mesh.quaternion.setFromUnitVectors(_upAxis, v);
    }
  };

  return {
    cylMesh,
    rodMesh,
    anchorA,
    anchorB,
    update(spaceParent: THREE.Object3D) {
      anchorA.getWorldPosition(_pA);
      anchorB.getWorldPosition(_pB);
      spaceParent.worldToLocal(_pA);
      spaceParent.worldToLocal(_pB);

      _dir.subVectors(_pB, _pA);
      const len = _dir.length();
      if (!Number.isFinite(len) || len < 1e-4) return;
      _dir.divideScalar(len);
      _negDir.copy(_dir).negate();

      cylMesh.position.copy(_pA);
      safeAlign(cylMesh, _dir);

      rodMesh.position.copy(_pB);
      safeAlign(rodMesh, _negDir);
    },
  };
}

/**
 * Computes real Ackermann steering angles for front-left and front-right knuckles.
 */
export function computeAckermannSteer(steerAngle: number): {
  leftSteer: number;
  rightSteer: number;
} {
  const WHEELBASE = HYPERCAR_SPEC.fZ - HYPERCAR_SPEC.rZ;
  const TRACK = HYPERCAR_SPEC.fTrack * 2.0;
  const absSteer = Math.abs(steerAngle);
  if (absSteer <= 1e-4) {
    return { leftSteer: 0, rightSteer: 0 };
  }
  const R = WHEELBASE / Math.tan(absSteer);
  const innerA = Math.min(
    Math.atan(WHEELBASE / Math.max(R - TRACK * 0.5, 0.5)),
    THREE.MathUtils.degToRad(24.0),
  );
  const outerA = Math.atan(WHEELBASE / (R + TRACK * 0.5));
  if (steerAngle > 0) {
    return { leftSteer: innerA, rightSteer: outerA };
  }
  return { leftSteer: -outerA, rightSteer: -innerA };
}

export interface BuiltHypercarRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  frontLeftPivot: THREE.Group;
  frontRightPivot: THREE.Group;
  wheels: THREE.Group[];
  headlightMat: THREE.MeshStandardMaterial;
  taillightMat: THREE.MeshStandardMaterial;
  headlightBeam: THREE.Mesh;
  sirenRedMat?: THREE.MeshStandardMaterial;
  sirenBlueMat?: THREE.MeshStandardMaterial;
  paintMat: THREE.MeshPhysicalMaterial;
  nitroFlameLeft: THREE.Mesh;
  nitroFlameRight: THREE.Mesh;
  hypercar: HypercarArticulation;
}

export function buildHypercarRigInstance(
  spec: VehicleSpec,
  customPaintHex?: number,
  anisotropy = 8,
): BuiltHypercarRig {
  const master = buildMasterHypercarAssets(anisotropy);
  const { textures, materials } = master;

  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  const wheelsGroup = new THREE.Group();
  root.add(bodyGroup, wheelsGroup);

  const rawColor = customPaintHex ?? spec.primaryColor;
  const { baseColor, sheenColor } = computeTriCoatColors(rawColor);

  // Per-vehicle Tri-Coat Paint Material (Rosso Fuoco / Custom Tri-Coat formula)
  const paintMat = new THREE.MeshPhysicalMaterial({
    color: baseColor,
    metalness: 0.84,
    roughness: 0.14,
    roughnessMap: textures.flakeRough,
    normalMap: textures.flakeNormal,
    normalScale: new THREE.Vector2(0.036, 0.036),
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    sheen: 0.55,
    sheenColor,
    sheenRoughness: 0.3,
    iridescence: 0.16,
    iridescenceIOR: 1.45,
    ior: 1.52,
    envMapIntensity: 1.36,
  });

  // Per-vehicle dynamic emissive LEDs (for braking, night headlights & welcome optical pulse)
  const headlightMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#ffffff'),
    emissive: new THREE.Color('#e2f0ff'),
    emissiveIntensity: 2.35,
    roughness: 0.12,
    metalness: 0.0,
    toneMapped: false,
  });

  const taillightMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#ff182a'),
    emissive: new THREE.Color('#ff1426'),
    emissiveIntensity: 2.45,
    roughness: 0.12,
    metalness: 0.0,
    toneMapped: false,
  });

  const frunkLedMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#fff5e6'),
    emissive: new THREE.Color('#ffeed4'),
    emissiveIntensity: 0.0,
    roughness: 0.2,
    toneMapped: false,
  });

  let sirenRedMat: THREE.MeshStandardMaterial | undefined;
  let sirenBlueMat: THREE.MeshStandardMaterial | undefined;
  if (spec.isPolice) {
    sirenRedMat = new THREE.MeshStandardMaterial({
      color: 0xff2222,
      emissive: new THREE.Color(0xff1e1e),
      emissiveIntensity: 0.45,
      roughness: 0.15,
      toneMapped: false,
    });
    sirenBlueMat = new THREE.MeshStandardMaterial({
      color: 0x2277ff,
      emissive: new THREE.Color(0x2288ff),
      emissiveIntensity: 0.45,
      roughness: 0.15,
      toneMapped: false,
    });
  }

  const resolveMat = (slot: MatSlot): THREE.Material => {
    if (slot === 'paint') return paintMat;
    if (slot === 'doorPaint') return spec.isPolice ? materials.policeWhitePaint : paintMat;
    if (slot === 'ledWhite') return headlightMat;
    if (slot === 'ledRed') return taillightMat;
    if (slot === 'frunkLed') return frunkLedMat;
    if (slot === 'sirenRed') return sirenRedMat ?? taillightMat;
    if (slot === 'sirenBlue') return sirenBlueMat ?? headlightMat;
    return materials[slot];
  };

  const spawnTemplateList = (parent: THREE.Object3D, list: MeshTemplate[]) => {
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const m = new THREE.Mesh(t.geo, resolveMat(t.mat));
      m.castShadow = Boolean(t.castShadow);
      m.receiveShadow = Boolean(t.receiveShadow);
      if (t.renderOrder) m.renderOrder = t.renderOrder;
      if (t.position) m.position.set(t.position[0], t.position[1], t.position[2]);
      if (t.rotation) m.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2]);
      parent.add(m);
    }
  };

  // 1. Static Bodywork, Chassis, V12 Engine Bay & Cockpit
  spawnTemplateList(bodyGroup, master.staticBodyMeshes);

  if (spec.isPolice) {
    spawnTemplateList(bodyGroup, master.policeRoofBarMeshes);
  }

  // 2. Articulated Front Trunk (Frunk) + Twin Telescopic Hydraulic Struts
  const [fhX, fhY, fhZ] = master.frunkHingePos;
  const frunkPivot = new THREE.Group();
  frunkPivot.position.set(fhX, fhY, fhZ);
  bodyGroup.add(frunkPivot);

  const frunkContent = new THREE.Group();
  frunkContent.position.set(-fhX, -fhY, -fhZ);
  frunkPivot.add(frunkContent);
  spawnTemplateList(frunkContent, master.frunkLidMeshes);

  const frunkLidAnchorL = new THREE.Object3D();
  frunkLidAnchorL.position.set(...master.frunkLidAnchorLPos);
  frunkContent.add(frunkLidAnchorL);

  const frunkLidAnchorR = new THREE.Object3D();
  frunkLidAnchorR.position.set(...master.frunkLidAnchorRPos);
  frunkContent.add(frunkLidAnchorR);

  const frunkChassisAnchorL = new THREE.Object3D();
  frunkChassisAnchorL.position.set(...master.frunkChassisAnchorLPos);
  bodyGroup.add(frunkChassisAnchorL);

  const frunkChassisAnchorR = new THREE.Object3D();
  frunkChassisAnchorR.position.set(...master.frunkChassisAnchorRPos);
  bodyGroup.add(frunkChassisAnchorR);

  const frunkStrutL = instantiateTelescopicStrut(
    bodyGroup,
    master.frunkStrutGeos,
    materials,
    frunkChassisAnchorL,
    frunkLidAnchorL,
  );
  const frunkStrutR = instantiateTelescopicStrut(
    bodyGroup,
    master.frunkStrutGeos,
    materials,
    frunkChassisAnchorR,
    frunkLidAnchorR,
  );

  // 3. Articulated Dihedral Butterfly Doors (Left & Right) + Telescopic Hydraulic Struts
  const doorLPivot = new THREE.Group();
  doorLPivot.position.set(...master.doorLPivotPos);
  bodyGroup.add(doorLPivot);
  const doorLContent = new THREE.Group();
  doorLContent.position.set(
    -master.doorLPivotPos[0],
    -master.doorLPivotPos[1],
    -master.doorLPivotPos[2],
  );
  doorLPivot.add(doorLContent);
  spawnTemplateList(doorLContent, master.doorLMeshes);

  const doorLStrutAnchor = new THREE.Object3D();
  doorLStrutAnchor.position.set(...master.doorLStrutAnchorPos);
  doorLContent.add(doorLStrutAnchor);
  const chassisStrutAnchorL = new THREE.Object3D();
  chassisStrutAnchorL.position.set(...master.chassisStrutAnchorLPos);
  bodyGroup.add(chassisStrutAnchorL);
  const doorLStrut = instantiateTelescopicStrut(
    bodyGroup,
    master.doorStrutGeos,
    materials,
    chassisStrutAnchorL,
    doorLStrutAnchor,
  );

  const doorRPivot = new THREE.Group();
  doorRPivot.position.set(...master.doorRPivotPos);
  bodyGroup.add(doorRPivot);
  const doorRContent = new THREE.Group();
  doorRContent.position.set(
    -master.doorRPivotPos[0],
    -master.doorRPivotPos[1],
    -master.doorRPivotPos[2],
  );
  doorRPivot.add(doorRContent);
  spawnTemplateList(doorRContent, master.doorRMeshes);

  const doorRStrutAnchor = new THREE.Object3D();
  doorRStrutAnchor.position.set(...master.doorRStrutAnchorPos);
  doorRContent.add(doorRStrutAnchor);
  const chassisStrutAnchorR = new THREE.Object3D();
  chassisStrutAnchorR.position.set(...master.chassisStrutAnchorRPos);
  bodyGroup.add(chassisStrutAnchorR);
  const doorRStrut = instantiateTelescopicStrut(
    bodyGroup,
    master.doorStrutGeos,
    materials,
    chassisStrutAnchorR,
    doorRStrutAnchor,
  );

  // 4. Synchronized D-Steering Wheel in Cockpit
  const steeringColGroup = new THREE.Group();
  steeringColGroup.position.set(...master.steeringColumnPos);
  steeringColGroup.rotation.x = master.steeringColumnRotX;
  const steeringWheelSpin = new THREE.Group();
  steeringColGroup.add(steeringWheelSpin);
  spawnTemplateList(steeringWheelSpin, master.steeringWheelMeshes);
  bodyGroup.add(steeringColGroup);

  // 5. Four Forged Concave Wheel Corners (Knuckle Steer + SpinHub Roll)
  const buildWheelCornerNode = (
    tmpl: WheelCornerTemplates,
    x: number,
    y: number,
    z: number,
  ) => {
    const cornerRoot = new THREE.Group();
    cornerRoot.position.set(x, y, z);
    const knuckleGroup = new THREE.Group();
    const spinHub = new THREE.Group();
    cornerRoot.add(knuckleGroup);
    knuckleGroup.add(spinHub);

    spawnTemplateList(knuckleGroup, tmpl.knuckleMeshes);
    spawnTemplateList(spinHub, tmpl.spinMeshes);
    wheelsGroup.add(cornerRoot);
    return { cornerRoot, knuckleGroup, spinHub };
  };

  const wFL = buildWheelCornerNode(
    master.wheels.frontLeft,
    HYPERCAR_SPEC.fTrack,
    HYPERCAR_SPEC.fR,
    HYPERCAR_SPEC.fZ,
  );
  const wFR = buildWheelCornerNode(
    master.wheels.frontRight,
    -HYPERCAR_SPEC.fTrack,
    HYPERCAR_SPEC.fR,
    HYPERCAR_SPEC.fZ,
  );
  const wRL = buildWheelCornerNode(
    master.wheels.rearLeft,
    HYPERCAR_SPEC.rTrack,
    HYPERCAR_SPEC.rR,
    HYPERCAR_SPEC.rZ,
  );
  const wRR = buildWheelCornerNode(
    master.wheels.rearRight,
    -HYPERCAR_SPEC.rTrack,
    HYPERCAR_SPEC.rR,
    HYPERCAR_SPEC.rZ,
  );

  // 6. Multilayer 6-Ellipse Contact Shadow on Ground
  const contactShadowMesh = new THREE.Mesh(
    master.contactShadowGeo,
    materials.contactShadow,
  );
  contactShadowMesh.renderOrder = -1;
  root.add(contactShadowMesh);

  // 7. Ground-projected Headlight Beam & Quad-Exhaust Nitro Plasma Flames
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffecc2,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const headlightBeam = new THREE.Mesh(master.headlightBeamGeo, beamMat);
  headlightBeam.position.set(0, 0.07, 2.34 + 6.5);
  bodyGroup.add(headlightBeam);

  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x45baff,
    transparent: true,
    opacity: 0.88,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const nitroFlameLeft = new THREE.Mesh(master.nitroFlameGeo, flameMat);
  nitroFlameLeft.position.set(-0.172, 0.531, -2.55);
  nitroFlameLeft.visible = false;
  const nitroFlameRight = new THREE.Mesh(master.nitroFlameGeo, flameMat);
  nitroFlameRight.position.set(0.172, 0.531, -2.55);
  nitroFlameRight.visible = false;
  bodyGroup.add(nitroFlameLeft, nitroFlameRight);

  const hypercar: HypercarArticulation = {
    doorL: { value: 0, target: 0, vel: 0 },
    doorR: { value: 0, target: 0, vel: 0 },
    frunk: { value: 0, target: 0, vel: 0 },
    doorLPivot,
    doorRPivot,
    doorLAxis: new THREE.Vector3(0.62, -0.7, 0.28).normalize(),
    doorRAxis: new THREE.Vector3(0.62, 0.7, -0.28).normalize(),
    doorMaxAngle: 1.06,
    frunkPivot,
    frunkLedMat,
    steeringWheelSpin,
    doorLStrut,
    doorRStrut,
    frunkStrutL,
    frunkStrutR,
    pulseTime: -1,
    autoCloseTimer: 0,
    frontSpin: 0,
    rearSpin: 0,
  };

  // Initialize hydraulic strut transforms
  bodyGroup.updateMatrixWorld(true);
  doorLStrut.update(bodyGroup);
  doorRStrut.update(bodyGroup);
  frunkStrutL.update(bodyGroup);
  frunkStrutR.update(bodyGroup);

  return {
    root,
    bodyGroup,
    frontLeftPivot: wFL.knuckleGroup,
    frontRightPivot: wFR.knuckleGroup,
    wheels: [wFL.spinHub, wFR.spinHub, wRL.spinHub, wRR.spinHub],
    headlightMat,
    taillightMat,
    headlightBeam,
    sirenRedMat,
    sirenBlueMat,
    paintMat,
    nitroFlameLeft,
    nitroFlameRight,
    hypercar,
  };
}
