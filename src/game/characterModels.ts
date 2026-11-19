import * as THREE from 'three';
import type { HyperrealMaterialLibrary, SharedWeatherUniforms } from './textures';

export interface CharacterRig {
  root: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftForearm: THREE.Group;
  rightForearm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftShin: THREE.Group;
  rightShin: THREE.Group;
  shirtMat: THREE.MeshPhysicalMaterial;
  pantsMat: THREE.MeshPhysicalMaterial;
  telegraphRing?: THREE.Mesh;
}

export interface CharacterBuildOptions {
  shirtHex: number;
  pantsHex: number;
  skinHex: number;
  shoeHex?: number;
  hatColor?: number;
  isProtagonist?: boolean;
  isRival?: boolean;
  isPolice?: boolean;
  hasBackpack?: boolean;
  hasShades?: boolean;
  heightScale?: number;
}

// Canonical UV landmarks shared between 3D facial sculpting and 2D procedural skin/face maps
export const FACE_LANDMARKS = {
  CHIN_V: 0.145,
  LOWER_LIP_V: 0.275,
  MOUTH_LINE_V: 0.308,
  UPPER_LIP_V: 0.338,
  NOSE_BASE_V: 0.405,
  NOSE_TIP_V: 0.448,
  CHEEKBONE_V: 0.485,
  EYE_V: 0.558,
  BROW_V: 0.635,
  HAIRLINE_V: 0.775,
  EYE_DU: 0.068,
  HEAD_CENTER_Y: 0.185,
  HEAD_RX: 0.093,
  HEAD_RY: 0.125,
  HEAD_RZ: 0.107,
} as const;

// Deterministic PRNG for photorealistic pores, fabric slub, and micro-details
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function gauss(d: number, sigma: number): number {
  const r = d / sigma;
  return Math.exp(-0.5 * r * r);
}

function gauss2(dx: number, dy: number, sx: number, sy: number): number {
  const rx = dx / sx;
  const ry = dy / sy;
  return Math.exp(-0.5 * (rx * rx + ry * ry));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Evaluate piecewise linear profile table [{ v, val }, ...]
function sampleProfile(table: ReadonlyArray<readonly [number, number]>, v: number): number {
  if (v <= table[0][0]) return table[0][1];
  const last = table.length - 1;
  if (v >= table[last][0]) return table[last][1];
  for (let i = 0; i < last; i++) {
    const [v0, val0] = table[i];
    const [v1, val1] = table[i + 1];
    if (v >= v0 && v <= v1) {
      const t = (v - v0) / Math.max(1e-6, v1 - v0);
      // Smooth Hermite interpolation for organic anatomical curvature
      const s = t * t * (3 - 2 * t);
      return val0 + (val1 - val0) * s;
    }
  }
  return table[last][1];
}

// Zero-dependency BufferGeometry merger supporting position, normal, uv, color & indices
export function mergeSculptedGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  let totalIndices = 0;

  const prepared = geometries.map((raw) => {
    const g = raw.index ? raw : raw;
    const pos = g.attributes.position;
    if (!g.attributes.normal) g.computeVertexNormals();
    const count = pos.count;
    totalVerts += count;
    totalIndices += g.index ? g.index.count : count;
    return g;
  });

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const colors = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIndices);

  let vOffset = 0;
  let iOffset = 0;

  for (const g of prepared) {
    const pos = g.attributes.position;
    const norm = g.attributes.normal;
    const uv = g.attributes.uv;
    const col = g.attributes.color;
    const count = pos.count;

    for (let i = 0; i < count; i++) {
      const dst3 = (vOffset + i) * 3;
      const dst2 = (vOffset + i) * 2;
      positions[dst3] = pos.getX(i);
      positions[dst3 + 1] = pos.getY(i);
      positions[dst3 + 2] = pos.getZ(i);

      normals[dst3] = norm.getX(i);
      normals[dst3 + 1] = norm.getY(i);
      normals[dst3 + 2] = norm.getZ(i);

      if (uv) {
        uvs[dst2] = uv.getX(i);
        uvs[dst2 + 1] = uv.getY(i);
      } else {
        uvs[dst2] = 0.5;
        uvs[dst2 + 1] = 0.5;
      }

      if (col) {
        colors[dst3] = col.getX(i);
        colors[dst3 + 1] = col.getY(i);
        colors[dst3 + 2] = col.getZ(i);
      } else {
        colors[dst3] = 1;
        colors[dst3 + 1] = 1;
        colors[dst3 + 2] = 1;
      }
    }

    if (g.index) {
      const idxArr = g.index.array;
      for (let i = 0; i < idxArr.length; i++) {
        indices[iOffset + i] = idxArr[i] + vOffset;
      }
      iOffset += idxArr.length;
    } else {
      for (let i = 0; i < count; i++) {
        indices[iOffset + i] = vOffset + i;
      }
      iOffset += count;
    }

    vOffset += count;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  out.setIndex(new THREE.BufferAttribute(indices, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

// Add uniform vertex color attribute (AO) to any auxiliary geometry so all character meshes support vertexColors
function withVertexAO(geo: THREE.BufferGeometry, r = 1, g = 1, b = 1): THREE.BufferGeometry {
  const count = geo.attributes.position.count;
  const cols = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    cols[i * 3] = r;
    cols[i * 3 + 1] = g;
    cols[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}

interface LoftSample {
  x: number;
  y: number;
  z: number;
  ao?: number;
  warmTint?: number;
}

/**
 * Parametric anatomical loft builder:
 * u in [0, 1] -> theta = (u - 0.5) * 2*PI so u=0.5 is exact FRONT (+Z) and seam is hidden at BACK (-Z)!
 * v in [0, 1] -> height from bottom (0) to top (1).
 * Winding order is strictly CCW outward-facing.
 */
function buildParametricLoft(
  uSegs: number,
  vSegs: number,
  evalFn: (u: number, v: number, theta: number) => LoftSample,
  capBottom = true,
  capTop = true,
): THREE.BufferGeometry {
  const stride = uSegs + 1;
  const ringVerts = (vSegs + 1) * stride;
  const extraCaps = (capBottom ? 1 : 0) + (capTop ? 1 : 0);
  const totalVerts = ringVerts + extraCaps;

  const positions = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const colors = new Float32Array(totalVerts * 3);

  let bottomCenterY = 0;
  let bottomCenterX = 0;
  let bottomCenterZ = 0;
  let bottomAO = 1;
  let topCenterY = 0;
  let topCenterX = 0;
  let topCenterZ = 0;
  let topAO = 1;

  for (let iv = 0; iv <= vSegs; iv++) {
    const v = iv / vSegs;
    for (let iu = 0; iu <= uSegs; iu++) {
      const u = iu / uSegs;
      // Ensure exact seam closure between iu=0 and iu=uSegs
      const theta = iu === uSegs ? -Math.PI : (u - 0.5) * Math.PI * 2;
      const sample = evalFn(iu === uSegs ? 0 : u, v, theta);
      const idx = iv * stride + iu;
      positions[idx * 3] = sample.x;
      positions[idx * 3 + 1] = sample.y;
      positions[idx * 3 + 2] = sample.z;
      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = v;

      const ao = clamp01(sample.ao ?? 1.0);
      const warm = sample.warmTint ?? 0;
      colors[idx * 3] = clamp01(ao * (1 + warm * 0.06));
      colors[idx * 3 + 1] = clamp01(ao * (1 - warm * 0.03));
      colors[idx * 3 + 2] = clamp01(ao * (1 - warm * 0.08));

      if (iv === 0 && iu < uSegs) {
        bottomCenterX += sample.x;
        bottomCenterY += sample.y;
        bottomCenterZ += sample.z;
        bottomAO += ao;
      }
      if (iv === vSegs && iu < uSegs) {
        topCenterX += sample.x;
        topCenterY += sample.y;
        topCenterZ += sample.z;
        topAO += ao;
      }
    }
  }

  const indices: number[] = [];
  for (let iv = 0; iv < vSegs; iv++) {
    for (let iu = 0; iu < uSegs; iu++) {
      const a = iv * stride + iu;
      const b = iv * stride + iu + 1;
      const c = (iv + 1) * stride + iu + 1;
      const d = (iv + 1) * stride + iu;
      indices.push(a, b, c, a, c, d);
    }
  }

  let capIdx = ringVerts;
  if (capBottom) {
    const cx = bottomCenterX / uSegs;
    const cy = bottomCenterY / uSegs;
    const cz = bottomCenterZ / uSegs;
    const cao = clamp01(bottomAO / uSegs);
    positions[capIdx * 3] = cx;
    positions[capIdx * 3 + 1] = cy;
    positions[capIdx * 3 + 2] = cz;
    uvs[capIdx * 2] = 0.5;
    uvs[capIdx * 2 + 1] = 0;
    colors[capIdx * 3] = cao;
    colors[capIdx * 3 + 1] = cao;
    colors[capIdx * 3 + 2] = cao;
    for (let iu = 0; iu < uSegs; iu++) {
      // Bottom cap faces -Y
      indices.push(capIdx, iu + 1, iu);
    }
    capIdx++;
  }

  if (capTop) {
    const cx = topCenterX / uSegs;
    const cy = topCenterY / uSegs;
    const cz = topCenterZ / uSegs;
    const cao = clamp01(topAO / uSegs);
    positions[capIdx * 3] = cx;
    positions[capIdx * 3 + 1] = cy;
    positions[capIdx * 3 + 2] = cz;
    uvs[capIdx * 2] = 0.5;
    uvs[capIdx * 2 + 1] = 1;
    colors[capIdx * 3] = cao;
    colors[capIdx * 3 + 1] = cao;
    colors[capIdx * 3 + 2] = cao;
    const topStart = vSegs * stride;
    for (let iu = 0; iu < uSegs; iu++) {
      // Top cap faces +Y
      indices.push(capIdx, topStart + iu, topStart + iu + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  // Smooth normals cleanly across the u=0 / u=1 rear seam
  const norm = geo.attributes.normal;
  for (let iv = 0; iv <= vSegs; iv++) {
    const i0 = iv * stride;
    const i1 = iv * stride + uSegs;
    const nx = norm.getX(i0) + norm.getX(i1);
    const ny = norm.getY(i0) + norm.getY(i1);
    const nz = norm.getZ(i0) + norm.getZ(i1);
    const len = Math.hypot(nx, ny, nz) || 1;
    norm.setXYZ(i0, nx / len, ny / len, nz / len);
    norm.setXYZ(i1, nx / len, ny / len, nz / len);
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// ============================================================================
// 1. FLAME-INSPIRED HYPERREALISTIC SCULPTED HUMAN HEAD, EARS & FADE HAIR
// ============================================================================

export function buildSculptedHeadGeometry(): THREE.BufferGeometry {
  const {
    CHIN_V,
    LOWER_LIP_V,
    MOUTH_LINE_V,
    UPPER_LIP_V,
    NOSE_BASE_V,
    NOSE_TIP_V,
    CHEEKBONE_V,
    EYE_V,
    BROW_V,
    EYE_DU,
    HEAD_CENTER_Y,
    HEAD_RX,
    HEAD_RY,
    HEAD_RZ,
  } = FACE_LANDMARKS;

  return buildParametricLoft(
    44,
    34,
    (u, v, theta) => {
      // Map v in [0, 1] to latitude phi in [-PI/2 + eps, PI/2 - eps]
      const phi = (v - 0.5) * Math.PI * 0.985;
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      const du = u - 0.5;
      const absDu = Math.abs(du);

      // Base cranial-facial proportions (tapered masculine jaw, full parietal crown, fuller occiput)
      const jawTaper = lerp(0.76, 1.0, smoothstep(0.08, 0.52, v));
      const templeIndent = -0.045 * gauss2(absDu - 0.175, v - 0.65, 0.045, 0.09);
      const parietalFull = 0.045 * gauss2(absDu - 0.23, v - 0.78, 0.09, 0.14);
      const occiputFull = 0.075 * gauss2(Math.max(0, 0.5 - absDu), v - 0.56, 0.16, 0.22) * smoothstep(-0.1, -0.7, cosT);
      const neckUnder = smoothstep(0.24, 0.02, v) * smoothstep(0.15, -0.65, cosT);

      let rx = HEAD_RX * (jawTaper + templeIndent + parietalFull);
      let rz = HEAD_RZ * (lerp(0.84, 1.0, smoothstep(0.1, 0.48, v)) + occiputFull - neckUnder * 0.22);

      // Subtle masculine jawline gonial angle (side jaw corners)
      const gonialCorner = 0.0085 * gauss2(absDu - 0.155, v - 0.245, 0.042, 0.065);
      // Hollow buccal cheek dip beneath cheekbone
      const buccalHollow = -0.0065 * gauss2(absDu - 0.125, v - 0.355, 0.04, 0.065);
      // Zygomatic cheekbone arch
      const zygomatic = 0.009 * gauss2(absDu - 0.12, v - CHEEKBONE_V, 0.052, 0.055);

      let x = (rx + gonialCorner + buccalHollow + zygomatic) * cosP * sinT;
      let y = HEAD_CENTER_Y + HEAD_RY * sinP;
      let z = rz * cosP * cosT;

      // Forward facial plane sculpting (strictly on front hemisphere cosT > 0)
      const frontMask = smoothstep(-0.08, 0.32, cosT);
      let ao = 1.0;
      let warm = 0.0;

      if (frontMask > 0.001) {
        // 1. Strong sculpted chin & mentolabial cleft
        const chinProm = 0.0145 * gauss2(du, v - CHIN_V, 0.046, 0.048);
        const chinCleft = -0.0055 * gauss2(du, v - 0.225, 0.042, 0.025);

        // 2. Sculpted upper & lower lips + parted mouth recess
        const lipWidth = 0.056;
        const lowerLip = 0.0095 * gauss2(du, v - LOWER_LIP_V, lipWidth * 0.78, 0.022);
        const mouthPart = -0.0075 * gauss2(du, v - MOUTH_LINE_V, lipWidth * 0.92, 0.011);
        const upperLip = 0.0092 * gauss2(du, v - UPPER_LIP_V, lipWidth * 0.82, 0.02)
          * (1 - 0.22 * gauss(du, 0.012)); // Cupid's bow center dip
        const philtrum = -0.0032 * gauss2(du, v - 0.372, 0.014, 0.024);

        // 3. Sculpted realistic nose (nasal bridge, dorsum, rounded tip, alae nostril wings, dark under-nose)
        const noseBridge = 0.0145 * gauss2(du, v - 0.535, 0.017, 0.062);
        const noseTip = 0.0235 * gauss2(du, v - NOSE_TIP_V, 0.021, 0.032);
        const nostrilWings = 0.0095 * gauss2(absDu - 0.024, v - (NOSE_BASE_V + 0.016), 0.014, 0.018);
        const underNoseShadow = gauss2(du, v - (NOSE_BASE_V - 0.014), 0.028, 0.018);

        // 4. Recessed orbital eye sockets + supraorbital brow ridge + eyelid hoods
        const eyeSocketL = gauss2(du + EYE_DU, v - EYE_V, 0.036, 0.032);
        const eyeSocketR = gauss2(du - EYE_DU, v - EYE_V, 0.036, 0.032);
        const eyeSocket = Math.max(eyeSocketL, eyeSocketR);

        const browRidge = 0.0095 * gauss2(absDu - 0.056, v - BROW_V, 0.052, 0.024)
          + 0.005 * gauss2(du, v - (BROW_V - 0.006), 0.026, 0.018);

        // Subtle protruding upper eyelid fold just above socket center
        const eyelidHood = 0.0052 * Math.max(
          gauss2(du + EYE_DU, v - (EYE_V + 0.022), 0.03, 0.012),
          gauss2(du - EYE_DU, v - (EYE_V + 0.022), 0.03, 0.012),
        );

        // Subtle nasolabial fold crease curving from nostril wings toward mouth corners
        const nlCurve = 0.032 + (NOSE_BASE_V - v) * 0.35;
        const nasolabial = v > 0.28 && v < 0.43
          ? -0.0022 * gauss(absDu - nlCurve, 0.012) * smoothstep(0.28, 0.33, v) * smoothstep(0.43, 0.38, v)
          : 0;

        const dz =
          (chinProm +
            chinCleft +
            lowerLip +
            mouthPart +
            upperLip +
            philtrum +
            noseBridge +
            noseTip +
            nostrilWings +
            browRidge +
            eyelidHood +
            nasolabial -
            eyeSocket * 0.0145) *
          frontMask;

        z += dz;
        // Slight nose tip droop and brow lift for authentic profile silhouette
        y -= noseTip * 0.14 * frontMask;
        x += Math.sign(du) * nostrilWings * 0.32 * frontMask;

        // Baked anatomical crevice AO for sculptural depth
        ao -= eyeSocket * 0.24 * frontMask;
        ao -= underNoseShadow * 0.22 * frontMask;
        ao -= clamp01(-mouthPart / 0.0075) * 0.20 * frontMask;
        ao -= clamp01(-chinCleft / 0.0055) * 0.08 * frontMask;
        ao -= smoothstep(0.22, 0.04, v) * 0.22; // Submental under-chin shadow

        // Warm hemoglobin dermis tint on nose tip, cheeks, and lips
        warm = (noseTip / 0.0235) * 0.55 + (zygomatic / 0.009) * 0.45 + ((upperLip + lowerLip) / 0.018) * 0.65;
      } else {
        // Nape / occipital base subtle shadow
        ao -= smoothstep(0.26, 0.04, v) * 0.18;
      }

      return { x, y, z, ao: Math.max(0.62, ao), warmTint: warm };
    },
    true,
    true,
  );
}

// Sculpted 3D anatomical ear (pinna helix + inner concha bowl + lobe)
export function buildSculptedEarGeometry(side: -1 | 1): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.025);
  shape.bezierCurveTo(0.013, -0.027, 0.019, -0.014, 0.021, 0.004);
  shape.bezierCurveTo(0.022, 0.021, 0.012, 0.032, -0.002, 0.029);
  shape.bezierCurveTo(-0.013, 0.026, -0.015, 0.012, -0.012, -0.004);
  shape.bezierCurveTo(-0.01, -0.016, -0.008, -0.023, 0, -0.025);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.008,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.0045,
    bevelThickness: 0.0045,
    curveSegments: 14,
  });
  geo.center();

  // Sculpt inner concha hollow and curl outer helix rim backward
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const radial = Math.hypot(x * 1.1, y * 0.85);
    const conchaDip = gauss(radial, 0.011);
    // Push concha inward toward head while flaring helix rim outward
    z -= conchaDip * 0.0065;
    // Slight backward sweep
    z += x * 0.18;
    if (side < 0) {
      x = -x;
    }
    pos.setXYZ(i, x, y, z);
    const ao = 1 - conchaDip * 0.28;
    cols[i * 3] = ao;
    cols[i * 3 + 1] = ao * 0.96;
    cols[i * 3 + 2] = ao * 0.93;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  // Orient ear laterally on skull (flat plane faces sideways ±X, sweeps slightly back)
  geo.rotateY(side * Math.PI * 0.5);
  geo.rotateY(-side * 0.26);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// Sculpted barber-fade textured hair cap tightly conforming to cranial vault
export function buildSculptedHairGeometry(): THREE.BufferGeometry {
  const { HEAD_CENTER_Y, HEAD_RX, HEAD_RY, HEAD_RZ, HAIRLINE_V } = FACE_LANDMARKS;
  return buildParametricLoft(
    36,
    18,
    (u, v, theta) => {
      const du = u - 0.5;
      const absDu = Math.abs(du);
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      // Authentic barber shape-up hairline: high & crisp across forehead, dips at temples, tapers to nape in back
      const templeDip = -0.14 * gauss(absDu - 0.175, 0.055);
      const backDrop = -0.34 * smoothstep(0.18, 0.36, absDu);
      const hairlineV = clamp01(HAIRLINE_V + templeDip + backDrop);

      const mappedV = lerp(hairlineV, 0.996, v);
      const phi = (mappedV - 0.5) * Math.PI * 0.985;
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);

      // Taper thickness smoothly from 2mm fade edge up to 9mm textured top waves
      const edgeTaper = smoothstep(0.0, 0.28, v);
      const topVolume = lerp(0.0025, 0.0095, edgeTaper) * (0.85 + 0.15 * Math.sin(theta * 11 + v * 14));

      const parietalFull = 0.045 * gauss2(absDu - 0.23, mappedV - 0.78, 0.09, 0.14);
      const occiputFull = 0.075 * gauss2(Math.max(0, 0.5 - absDu), mappedV - 0.56, 0.16, 0.22) * smoothstep(-0.1, -0.7, cosT);

      const rx = HEAD_RX * (1 + parietalFull) + topVolume;
      const ry = HEAD_RY + topVolume * 1.1;
      const rz = HEAD_RZ * (1 + occiputFull) + topVolume;

      const x = rx * cosP * sinT;
      const y = HEAD_CENTER_Y + ry * sinP;
      const z = rz * cosP * cosT;
      const ao = lerp(0.74, 1.0, smoothstep(0.0, 0.32, v));
      return { x, y, z, ao };
    },
    false,
    true,
  );
}

// ============================================================================
// 2. SCULPTED ANATOMICAL NECK, ATHLETIC TORSO & TAILORED PELVIS
// ============================================================================

export function buildSculptedNeckGeometry(): THREE.BufferGeometry {
  const rxTable: ReadonlyArray<readonly [number, number]> = [
    [0.0, 0.088],
    [0.22, 0.068],
    [0.55, 0.058],
    [0.85, 0.057],
    [1.0, 0.060],
  ];
  const rzTable: ReadonlyArray<readonly [number, number]> = [
    [0.0, 0.078],
    [0.25, 0.064],
    [0.55, 0.058],
    [0.85, 0.060],
    [1.0, 0.063],
  ];

  return buildParametricLoft(
    24,
    14,
    (u, v, theta) => {
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      const du = u - 0.5;
      const absDu = Math.abs(du);

      let rx = sampleProfile(rxTable, v);
      let rz = sampleProfile(rzTable, v);

      // Sloping trapezius flare laterally at base of neck
      const trapFlare = 0.032 * smoothstep(0.45, 0.0, v) * Math.abs(sinT);
      // Sternocleidomastoid (SCM) twin V-tendons from ears to sternum hollow
      const scmTargetDu = lerp(0.04, 0.16, v);
      const scmRidge = 0.0042 * gauss(absDu - scmTargetDu, 0.035) * smoothstep(0.0, 0.25, v) * smoothstep(1.0, 0.72, v) * smoothstep(-0.2, 0.4, cosT);
      // Adam's apple (laryngeal prominence)
      const larynx = 0.0038 * gauss2(du, v - 0.62, 0.04, 0.12) * smoothstep(0.3, 0.8, cosT);
      // Suprasternal hollow dip between clavicles
      const notchHollow = -0.005 * gauss2(du, v - 0.10, 0.05, 0.12) * smoothstep(0.3, 0.8, cosT);

      const x = (rx + trapFlare + scmRidge) * sinT;
      const y = lerp(-0.048, 0.092, v);
      const z = (rz + scmRidge + larynx + notchHollow) * cosT - lerp(0.006, 0.002, v);

      // Soft shadow beneath chin at top of neck & inside collar at bottom
      const ao = 1.0 - smoothstep(0.65, 1.0, v) * 0.24 * smoothstep(-0.2, 0.7, cosT) - smoothstep(0.18, 0.0, v) * 0.12;
      return { x, y, z, ao };
    },
    true,
    true,
  );
}

// Sculpted athletic upper chest + trapezius + clavicle bare-skin yoke (for protagonist tank top)
export function buildSculptedUpperYokeSkinGeometry(): THREE.BufferGeometry {
  return buildParametricLoft(
    28,
    14,
    (u, v, theta) => {
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      const du = u - 0.5;
      const absDu = Math.abs(du);

      const rx = lerp(0.195, 0.088, smoothstep(0.0, 1.0, v)) + 0.015 * Math.sin(v * Math.PI);
      const rz = lerp(0.118, 0.072, smoothstep(0.0, 1.0, v));

      // Clavicle collarbone ridges on front
      const clavicle = 0.0055 * gauss2(v - 0.48, absDu - 0.14, 0.11, 0.085) * smoothstep(0.15, 0.75, cosT);
      // Upper pectoral fullness below clavicles
      const upperPec = 0.008 * smoothstep(0.55, 0.0, v) * gauss(absDu - 0.11, 0.08) * smoothstep(0.1, 0.7, cosT);
      // Suprasternal hollow
      const hollow = -0.006 * gauss2(du, v - 0.52, 0.045, 0.16) * smoothstep(0.2, 0.8, cosT);
      // Upper spine furrow on back
      const spineDip = -0.005 * gauss(Math.min(u, 1 - u), 0.04) * smoothstep(-0.2, -0.7, cosT);

      const x = rx * sinT;
      const y = lerp(0.415, 0.552, v);
      const z = (rz + clavicle + upperPec + hollow + spineDip) * cosT;
      const ao = 0.92 + 0.08 * v - smoothstep(0.25, 0.0, v) * 0.08;
      return { x, y, z, ao };
    },
    true,
    true,
  );
}

// Master sculpted athletic torso with pectorals, ribcage taper, latissimus back V, spine furrow & natural cloth folds
export function buildSculptedTorsoGeometry(isTankTop: boolean): THREE.BufferGeometry {
  const rxTable: ReadonlyArray<readonly [number, number]> = [
    [0.0, 0.178], // Hem overhanging belt slightly
    [0.08, 0.172],
    [0.24, 0.167], // Athletic waist taper
    [0.48, 0.184], // Lower ribcage / lats
    [0.72, 0.214], // Broad athletic chest & lats
    [0.86, isTankTop ? 0.186 : 0.222], // Shoulder line (tank top scoops inward for exposed delts!)
    [0.95, isTankTop ? 0.128 : 0.158], // Trapezius slope
    [1.0, isTankTop ? 0.095 : 0.086], // Collar opening
  ];
  const rzTable: ReadonlyArray<readonly [number, number]> = [
    [0.0, 0.122],
    [0.12, 0.116],
    [0.32, 0.114],
    [0.58, 0.126],
    [0.76, 0.132], // Full pectoral chest depth
    [0.90, 0.112],
    [1.0, 0.076],
  ];

  return buildParametricLoft(
    34,
    28,
    (u, v, theta) => {
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      const du = u - 0.5;
      const absDu = Math.abs(du);

      let rx = sampleProfile(rxTable, v);
      let rz = sampleProfile(rzTable, v);

      // Subtle flattened front/back superellipse squaring (human ribcage is NOT a circular tube!)
      const boxiness = 0.045 * Math.cos(4 * theta);
      rx *= 1 - boxiness * 0.4;
      rz *= 1 - boxiness * 0.3;

      // Sculpted pectoral muscles & central sternal valley
      const frontMask = smoothstep(-0.1, 0.45, cosT);
      const backMask = smoothstep(0.1, -0.45, cosT);
      const pecPad = 0.015 * gauss2(absDu - 0.115, v - 0.72, 0.075, 0.115) * frontMask;
      const sternumDip = -0.007 * gauss2(du, v - 0.71, 0.032, 0.13) * frontMask;
      const abSubtle = 0.0045 * gauss2(absDu - 0.055, v - 0.36, 0.05, 0.18) * frontMask;

      // Sculpted back anatomy: scapulae shoulder blades + central spinal furrow + lumbar curve
      const backDu = Math.min(u, 1 - u);
      const scapula = 0.011 * gauss2(backDu - 0.13, v - 0.74, 0.075, 0.12) * backMask;
      const spineFurrow = -0.0095 * gauss(backDu, 0.036) * smoothstep(0.08, 0.35, v) * smoothstep(0.98, 0.78, v) * backMask;
      const lumbarCurve = -0.012 * gauss(v - 0.24, 0.14) * backMask;

      // Realistic 3D cloth drape folds across waist, ribs & diagonal pull lines
      const waistFolds =
        (Math.sin(v * 34 + theta * 2.0) * 0.0028 + Math.sin(v * 21 - theta * 3.0) * 0.002) *
        smoothstep(0.62, 0.08, v) *
        smoothstep(0.0, 0.12, v);
      // Slight flared bottom hem lip overhanging waistband
      const hemLip = 0.0065 * smoothstep(0.08, 0.0, v);

      // Tank top front scoop-neck & deep armhole contour carving
      let y = lerp(-0.024, isTankTop ? 0.515 : 0.545, v);
      if (isTankTop && v > 0.72) {
        const topFrac = (v - 0.72) / 0.28;
        // Front scoop neck lowers slightly at center chest
        const frontScoop = gauss(du, 0.095) * frontMask * 0.052 * topFrac;
        const backScoop = gauss(backDu, 0.11) * backMask * 0.032 * topFrac;
        y -= frontScoop + backScoop;
      }

      const x = (rx + hemLip + waistFolds) * sinT;
      const z = (rz + hemLip + pecPad + sternumDip + abSubtle + scapula + spineFurrow + lumbarCurve + waistFolds) * cosT;

      // Baked garment crevice AO (under-hem shadow, sternum valley, spine groove, armpits, folds)
      let ao = 1.0;
      ao -= smoothstep(0.09, 0.0, v) * 0.22; // Underside of shirt hem
      ao -= clamp01(-spineFurrow / 0.0095) * 0.16;
      ao -= clamp01(-sternumDip / 0.007) * 0.10;
      ao -= gauss2(absDu - 0.25, v - 0.66, 0.06, 0.10) * 0.20; // Underarm armpit AO
      ao += waistFolds * 14; // Subtle crease shading

      return { x, y, z, ao: clamp01(ao) };
    },
    true,
    true,
  );
}

// Sculpted tailored pelvis / denim hips with glute contour, front fly & waist belt fit
export function buildSculptedPelvisGeometry(): THREE.BufferGeometry {
  const rxTable: ReadonlyArray<readonly [number, number]> = [
    [0.0, 0.168],
    [0.25, 0.184],
    [0.58, 0.186],
    [0.85, 0.178],
    [1.0, 0.172],
  ];
  const rzTable: ReadonlyArray<readonly [number, number]> = [
    [0.0, 0.114],
    [0.28, 0.128],
    [0.58, 0.129],
    [0.85, 0.120],
    [1.0, 0.114],
  ];

  return buildParametricLoft(
    28,
    16,
    (u, v, theta) => {
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      const du = u - 0.5;
      const backDu = Math.min(u, 1 - u);
      const backMask = smoothstep(0.1, -0.45, cosT);
      const frontMask = smoothstep(-0.1, 0.45, cosT);

      const rx = sampleProfile(rxTable, v);
      const rz = sampleProfile(rzTable, v);

      // Natural anatomical glute fullness & central gluteal cleft on back
      const gluteLobe = 0.015 * gauss2(backDu - 0.115, v - 0.36, 0.085, 0.26) * backMask;
      const gluteCleft = -0.010 * gauss(backDu, 0.032) * smoothstep(0.05, 0.35, v) * smoothstep(0.88, 0.55, v) * backMask;
      // Front denim fly placket seam ridge
      const flyRidge = 0.004 * gauss(du, 0.018) * smoothstep(0.12, 0.35, v) * smoothstep(0.95, 0.72, v) * frontMask;
      // Subtle denim hip whisker creases
      const whisker = Math.sin(v * 26 + theta * 2) * 0.0022 * smoothstep(0.85, 0.15, v);

      const x = (rx + whisker) * sinT;
      const y = lerp(0.79, 1.015, v);
      const z = (rz + gluteLobe + gluteCleft + flyRidge + whisker) * cosT;

      let ao = 1.0;
      ao -= smoothstep(0.24, 0.0, v) * 0.22; // Crotch/under-pelvis AO
      ao -= smoothstep(0.82, 1.0, v) * 0.18; // Shadow cast by shirt hem & belt
      ao -= clamp01(-gluteCleft / 0.010) * 0.16;

      return { x, y, z, ao: clamp01(ao) };
    },
    true,
    true,
  );
}

// ============================================================================
// 3. SCULPTED MUSCULAR ARMS, FITTED SLEEVES & ARTICULATED 5-FINGERED HANDS
// ============================================================================

export function buildSculptedUpperArmGeometry(side: -1 | 1): THREE.BufferGeometry {
  // Spans y = +0.055 (deltoid cap) down to y = -0.278 (elbow overlap)
  const rxTable: ReadonlyArray<readonly [number, number]> = [
    [0.0, 0.044], // Elbow
    [0.18, 0.050],
    [0.52, 0.058], // Mid-bicep / tricep
    [0.82, 0.068], // Deltoid peak
    [0.95, 0.056],
    [1.0, 0.022], // Shoulder cap pole
  ];
  const rzTable: ReadonlyArray<readonly [number, number]> = [
    [0.0, 0.045],
    [0.18, 0.052],
    [0.52, 0.062],
    [0.82, 0.066],
    [0.95, 0.054],
    [1.0, 0.022],
  ];

  return buildParametricLoft(
    24,
    20,
    (u, v, theta) => {
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      const outerMask = smoothstep(-0.2, 0.65, side * sinT);
      const frontMask = smoothstep(-0.15, 0.6, cosT);
      const backMask = smoothstep(0.15, -0.6, cosT);

      const rx = sampleProfile(rxTable, v);
      const rz = sampleProfile(rzTable, v);

      // Sculpted lateral teardrop deltoid head
      const deltoid = 0.011 * gauss(v - 0.78, 0.14) * outerMask;
      // Sculpted anterior biceps brachii peak
      const bicep = 0.0085 * gauss(v - 0.46, 0.17) * frontMask;
      // Sculpted posterior triceps horseshoe fullness
      const tricep = 0.008 * gauss(v - 0.56, 0.18) * backMask;
      // Natural medial shift at top so deltoid melds seamlessly into torso shoulder
      const shoulderTuckX = -side * 0.016 * smoothstep(0.55, 0.98, v);

      const x = (rx + deltoid) * sinT + shoulderTuckX;
      const y = lerp(-0.278, 0.058, v);
      const z = (rz + bicep + tricep) * cosT;

      // Subtle inner-armpit & bicep-groove AO
      const innerMask = smoothstep(-0.1, 0.7, -side * sinT);
      let ao = 1.0 - innerMask * smoothstep(0.35, 0.85, v) * 0.24;
      ao -= smoothstep(0.14, 0.0, v) * 0.08;
      return { x, y, z, ao: clamp01(ao) };
    },
    true,
    true,
  );
}

// Fitted short sleeve with shoulder cap, natural drape wrinkles & crisp hem cuff (all NPCs)
export function buildSculptedSleeveGeometry(side: -1 | 1): THREE.BufferGeometry {
  const rxTable: ReadonlyArray<readonly [number, number]> = [
    [0.0, 0.067], // Open sleeve cuff slightly proud of bicep
    [0.14, 0.065],
    [0.52, 0.072],
    [0.82, 0.078],
    [0.96, 0.062],
    [1.0, 0.025],
  ];
  const rzTable: ReadonlyArray<readonly [number, number]> = [
    [0.0, 0.069],
    [0.14, 0.068],
    [0.52, 0.074],
    [0.82, 0.076],
    [0.96, 0.060],
    [1.0, 0.025],
  ];

  return buildParametricLoft(
    24,
    14,
    (u, v, theta) => {
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      const rx = sampleProfile(rxTable, v);
      const rz = sampleProfile(rzTable, v);

      // Subtle sleeve fabric crease ripples + cuff hem bead
      const fold = Math.sin(v * 20 + theta * 3) * 0.0022 * smoothstep(0.9, 0.15, v);
      const cuffBead = 0.003 * gauss(v - 0.05, 0.04);
      const shoulderTuckX = -side * 0.018 * smoothstep(0.45, 0.98, v);

      const x = (rx + fold + cuffBead) * sinT + shoulderTuckX;
      // Slight diagonal natural sleeve cut (longer on outer bicep, shorter under armpit)
      const diagTrim = side * sinT * 0.014 * smoothstep(0.65, 0.0, v);
      const y = lerp(-0.158, 0.066, v) - diagTrim;
      const z = (rz + fold + cuffBead) * cosT;

      const innerMask = smoothstep(-0.1, 0.7, -side * sinT);
      let ao = 1.0 - innerMask * smoothstep(0.25, 0.8, v) * 0.22;
      ao -= smoothstep(0.12, 0.0, v) * 0.24; // Dark underside of sleeve cuff!
      return { x, y, z, ao: clamp01(ao) };
    },
    true,
    true,
  );
}

export function buildSculptedForearmGeometry(side: -1 | 1): THREE.BufferGeometry {
  // Pivoted at elbow (0,0,0), extends down to wrist at y = -0.255
  const rxTable: ReadonlyArray<readonly [number, number]> = [
    [0.0, 0.029], // Slender oval wrist
    [0.18, 0.032],
    [0.52, 0.043],
    [0.78, 0.050], // Brachioradialis muscle belly
    [0.94, 0.047], // Elbow olecranon blend
    [1.0, 0.036],
  ];
  const rzTable: ReadonlyArray<readonly [number, number]> = [
    [0.0, 0.036], // Wrist slightly deeper anteroposteriorly than laterally
    [0.18, 0.038],
    [0.52, 0.046],
    [0.78, 0.052],
    [0.94, 0.048],
    [1.0, 0.036],
  ];

  return buildParametricLoft(
    22,
    18,
    (u, v, theta) => {
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      const rx = sampleProfile(rxTable, v);
      const rz = sampleProfile(rzTable, v);

      // Brachioradialis outer-front ridge & olecranon elbow bone at back
      const brachio = 0.0055 * gauss(v - 0.72, 0.16) * smoothstep(-0.1, 0.7, side * sinT + cosT * 0.5);
      const elbowBone = 0.0045 * gauss(v - 0.95, 0.07) * smoothstep(0.1, -0.7, cosT);

      const x = (rx + brachio) * sinT;
      const y = lerp(-0.256, 0.036, v);
      const z = (rz + brachio * 0.6 + elbowBone) * cosT;

      const ao = 1.0 - smoothstep(0.1, 0.0, v) * 0.10 - smoothstep(0.9, 1.0, v) * 0.10;
      return { x, y, z, ao: clamp01(ao) };
    },
    true,
    true,
  );
}

// Sculpted 5-fingered articulated anatomical hand (merged palm + knuckle ridge + 4 curled fingers + opposable thumb!)
export function buildSculptedHandGeometry(side: -1 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // 1. Sculpted Palm with thenar (thumb) pad & metacarpal knuckle ridge
  const palm = buildParametricLoft(
    18,
    10,
    (u, v, theta) => {
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      // Hand hangs naturally: palm faces inward (-side X), thumb is forward (+Z)
      const palmThick = lerp(0.014, 0.022, smoothstep(0.0, 0.85, v));
      const palmWidth = lerp(0.039, 0.034, smoothstep(0.0, 1.0, v)) + 0.005 * Math.sin(v * Math.PI);
      // Thenar muscle bulge on inner-front palm
      const thenar = 0.006 * gauss(v - 0.62, 0.25) * smoothstep(0.0, 0.8, cosT) * smoothstep(0.0, 0.8, -side * sinT);
      // 4 dorsal knuckles near finger base (v ~ 0.08)
      const knuckles = 0.003 * gauss(v - 0.10, 0.09) * smoothstep(0.0, 0.7, side * sinT);

      const x = (palmThick + thenar + knuckles) * sinT;
      const y = lerp(-0.326, -0.246, v);
      const z = (palmWidth + thenar * 0.4) * cosT + 0.004;
      const innerPalm = smoothstep(0.0, 0.7, -side * sinT);
      const ao = 1.0 - innerPalm * 0.14 - smoothstep(0.15, 0.0, v) * 0.14;
      return { x, y, z, ao: clamp01(ao) };
    },
    true,
    true,
  );
  parts.push(palm);

  // 2. Four distinct naturally curled fingers (Index, Middle, Ring, Pinky)
  const fingerSpecs = [
    { zOff: 0.030, len: 0.068, rad: 0.0082, curl: 0.36 }, // Index
    { zOff: 0.011, len: 0.074, rad: 0.0085, curl: 0.42 }, // Middle
    { zOff: -0.009, len: 0.067, rad: 0.0080, curl: 0.48 }, // Ring
    { zOff: -0.027, len: 0.054, rad: 0.0070, curl: 0.54 }, // Pinky
  ];

  for (const f of fingerSpecs) {
    const fGeo = buildParametricLoft(
      10,
      8,
      (_u, v, theta) => {
        const sinT = Math.sin(theta);
        const cosT = Math.cos(theta);
        // Taper finger tip cleanly with subtle knuckle joint bulges
        const tipTaper = lerp(1.0, 0.62, smoothstep(0.2, 0.96, v)) * smoothstep(1.02, 0.92, v);
        const knuckleBump = 1 + 0.09 * gauss(v - 0.48, 0.12);
        const r = f.rad * tipTaper * knuckleBump;

        // Progressive curl inward toward palm (-side X) as v goes from knuckle (0) to fingertip (1)
        const angle = v * f.curl;
        const localY = -v * f.len * Math.cos(angle * 0.55);
        const localCurlX = -side * v * v * f.len * Math.sin(f.curl) * 0.65;

        const x = localCurlX + r * sinT;
        const y = -0.320 + localY;
        const z = f.zOff + 0.004 + r * cosT;
        // Darken crease between adjacent fingers & under curled palm
        const ao = lerp(0.80, 0.98, v) * (1 - smoothstep(0.2, 0.8, -side * sinT) * 0.14);
        return { x, y, z, ao: clamp01(ao) };
      },
      true,
      true,
    );
    parts.push(fGeo);
  }

  // 3. Sculpted Opposable Thumb (angled forward & curving gently inward)
  const thumbGeo = buildParametricLoft(
    10,
    7,
    (_u, v, theta) => {
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      const r = 0.0096 * lerp(1.08, 0.72, v) * smoothstep(1.03, 0.92, v);
      const x = -side * (0.011 + v * 0.018) + r * sinT;
      const y = -0.278 - v * 0.056;
      const z = 0.036 + v * 0.028 - v * v * 0.010 + r * cosT;
      const ao = lerp(0.84, 0.98, v);
      return { x, y, z, ao };
    },
    true,
    true,
  );
  parts.push(thumbGeo);

  return mergeSculptedGeometries(parts);
}

// ============================================================================
// 4. SCULPTED TAILORED JEANS/TROUSER LEGS & PHOTOREALISTIC HIGH-TOP SNEAKERS
// ============================================================================

export function buildSculptedThighGeometry(side: -1 | 1): THREE.BufferGeometry {
  // Pivoted at hip (0,0,0), extends down to knee at y = -0.435
  const rxTable: ReadonlyArray<readonly [number, number]> = [
    [0.0, 0.072], // Knee
    [0.24, 0.078],
    [0.58, 0.088], // Mid-thigh tailored denim
    [0.88, 0.095], // Upper thigh
    [1.0, 0.086],
  ];
  const rzTable: ReadonlyArray<readonly [number, number]> = [
    [0.0, 0.074],
    [0.24, 0.082],
    [0.58, 0.093],
    [0.88, 0.099],
    [1.0, 0.090],
  ];

  return buildParametricLoft(
    24,
    20,
    (u, v, theta) => {
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      const frontMask = smoothstep(-0.1, 0.65, cosT);
      const backMask = smoothstep(0.1, -0.65, cosT);

      const rx = sampleProfile(rxTable, v);
      const rz = sampleProfile(rzTable, v);

      // Quadriceps anterior curve + hamstring sweep + knee-back cloth crease folds
      const quad = 0.0085 * gauss(v - 0.56, 0.24) * frontMask;
      const kneeCrease = Math.sin(v * 38 + theta * 2) * 0.003 * smoothstep(0.32, 0.04, v) * backMask;
      const hipWhisker = Math.sin(v * 28 - theta * 2) * 0.0022 * smoothstep(0.62, 0.92, v) * frontMask;
      // Outer denim double-seam subtle ridge
      const outseam = 0.0024 * gauss(side * sinT - 1.0, 0.18);

      const x = (rx + outseam + hipWhisker) * sinT;
      const y = lerp(-0.435, 0.042, v);
      const z = (rz + quad + kneeCrease + hipWhisker) * cosT;

      // Inner thigh AO + knee-back fold shadow
      const innerMask = smoothstep(-0.1, 0.75, -side * sinT);
      let ao = 1.0 - innerMask * smoothstep(0.3, 0.9, v) * 0.24;
      ao -= smoothstep(0.14, 0.0, v) * 0.08;
      ao += kneeCrease * 14;
      return { x, y, z, ao: clamp01(ao) };
    },
    true,
    true,
  );
}

export function buildSculptedCalfGeometry(side: -1 | 1): THREE.BufferGeometry {
  // Pivoted at knee (0,0,0), extends down to ankle cuff resting over sneaker collar at y = -0.365
  const rxTable: ReadonlyArray<readonly [number, number]> = [
    [0.0, 0.068], // Stacked denim cuff resting on sneaker collar
    [0.08, 0.066],
    [0.24, 0.062],
    [0.62, 0.073], // Calf fullness
    [0.92, 0.075], // Knee overlap
    [1.0, 0.066],
  ];
  const rzTable: ReadonlyArray<readonly [number, number]> = [
    [0.0, 0.075],
    [0.10, 0.072],
    [0.28, 0.066],
    [0.64, 0.078],
    [0.92, 0.077],
    [1.0, 0.068],
  ];

  return buildParametricLoft(
    24,
    20,
    (u, v, theta) => {
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      const backMask = smoothstep(0.1, -0.65, cosT);
      const frontMask = smoothstep(-0.1, 0.65, cosT);

      const rx = sampleProfile(rxTable, v);
      const rz = sampleProfile(rzTable, v);

      // Gastrocnemius calf curve in back + subtle patella contour at top front
      const calfCurve = 0.0085 * gauss(v - 0.64, 0.2) * backMask;
      const patella = 0.005 * gauss(v - 0.94, 0.08) * frontMask;
      // Realistic stacked denim bunching folds right above sneaker top
      const stackFolds = Math.sin(v * 44 + theta * 1.5) * 0.0038 * smoothstep(0.32, 0.03, v);
      const outseam = 0.0022 * gauss(side * sinT - 1.0, 0.18);

      const x = (rx + outseam + stackFolds) * sinT;
      const y = lerp(-0.368, 0.036, v);
      // Slight forward break of hem resting over shoe tongue
      const hemBreakZ = 0.012 * smoothstep(0.24, 0.0, v) * frontMask;
      const z = (rz + calfCurve + patella + stackFolds) * cosT + hemBreakZ;

      let ao = 1.0 - smoothstep(0.10, 0.0, v) * 0.28; // Deep hem shadow right over sneaker
      ao -= smoothstep(0.92, 1.0, v) * 0.08;
      ao += stackFolds * 12;
      return { x, y, z, ao: clamp01(ao) };
    },
    true,
    true,
  );
}

// Sculpted anatomical street sneaker sole & foxing midsole (ground flush at y = -0.460 -> world y = 0.000!)
export function buildSculptedSneakerSoleGeometry(side: -1 | 1): THREE.BufferGeometry {
  // Anatomical curved foot sole outline in XZ (ExtrudeGeometry extruded along Y)
  const s = new THREE.Shape();
  // x = lateral (mirror per side), y = forward (+Z)
  const m = side;
  s.moveTo(0, -0.082); // Rear heel center
  s.bezierCurveTo(m * 0.052, -0.082, m * 0.056, -0.025, m * 0.055, 0.045); // Outer sole curve
  s.bezierCurveTo(m * 0.064, 0.115, m * 0.054, 0.185, m * 0.012, 0.198); // Rounded outer toe box
  s.bezierCurveTo(-m * 0.038, 0.200, -m * 0.058, 0.155, -m * 0.056, 0.095); // Big toe curve
  s.bezierCurveTo(-m * 0.050, 0.035, -m * 0.044, -0.015, -m * 0.048, -0.055); // Medial arch curve
  s.bezierCurveTo(-m * 0.046, -0.078, -m * 0.024, -0.082, 0, -0.082);

  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.024,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.0055,
    bevelThickness: 0.0055,
    curveSegments: 16,
  });
  // Rotate so shape Y -> +Z (forward), extrude depth -> +Y (up)
  geo.rotateX(-Math.PI * 0.5);
  // Compute exact min Y and shift so outsole bottom touches y = -0.460 exactly!
  geo.computeBoundingBox();
  const minY = geo.boundingBox!.min.y;
  geo.translate(0, -0.460 - minY, 0);

  // Subtle AO darkening at bottom tread edge
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const h = clamp01((pos.getY(i) - -0.460) / 0.035);
    const ao = lerp(0.76, 1.0, h);
    cols[i * 3] = ao;
    cols[i * 3 + 1] = ao;
    cols[i * 3 + 2] = ao;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// Sculpted multi-contour leather sneaker upper (vamp, toebox, heel counter, padded ankle collar, tongue)
export function buildSculptedSneakerUpperGeometry(side: -1 | 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // 1. Contoured sneaker upper loft from midsole (y = -0.432) to padded ankle collar (y = -0.342)
  const upper = buildParametricLoft(
    26,
    14,
    (u, v, theta) => {
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      const frontMask = smoothstep(-0.1, 0.45, cosT);
      const backMask = smoothstep(0.1, -0.45, cosT);

      // Shoe length shrinks smoothly from long toebox at bottom (v=0) to snug ankle collar at top (v=1)
      const frontLen = lerp(0.194, 0.068, smoothstep(0.05, 0.88, v));
      const rearLen = lerp(0.080, 0.068, smoothstep(0.0, 0.85, v));
      const width = lerp(0.058, 0.053, smoothstep(0.0, 0.82, v));
      const anklePad = 0.007 * gauss(v - 0.88, 0.12);

      // Sleek toe-box dome & instep lace slope
      const toeDrop = frontMask * smoothstep(0.15, 0.65, v) * 0.018;
      const zRadius = cosT >= 0 ? frontLen : rearLen;

      // Slight anatomical foot curvature (big toe medial side)
      const footCurveX = side * 0.005 * smoothstep(0.2, 0.9, cosT) * smoothstep(0.6, 0.0, v);
      // Raised Achilles heel tab
      const heelTab = 0.012 * gauss(v - 0.96, 0.08) * backMask;

      const x = (width + anklePad) * sinT + footCurveX;
      const y = lerp(-0.432, -0.342, v) - toeDrop + heelTab;
      const z = zRadius * cosT;

      let ao = lerp(0.84, 1.0, smoothstep(0.0, 0.25, v));
      ao -= smoothstep(0.88, 1.0, v) * 0.16; // Recessed ankle collar opening
      return { x, y, z, ao: clamp01(ao) };
    },
    true,
    true,
  );
  parts.push(upper);

  // 2. Sculpted Padded Sneaker Tongue rising up the front instep
  const tongueCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.398, 0.122),
    new THREE.Vector3(0, -0.372, 0.090),
    new THREE.Vector3(0, -0.336, 0.064),
  ]);
  const tongueGeo = new THREE.TubeGeometry(tongueCurve, 8, 0.028, 10, false);
  tongueGeo.scale(1.18, 1.0, 0.42);
  parts.push(withVertexAO(tongueGeo, 0.94, 0.94, 0.94));

  return mergeSculptedGeometries(parts);
}

// Sculpted 3D crisscrossed sneaker shoelaces + side accent stripe
export function buildSneakerLacesGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const y = lerp(-0.392, -0.354, t);
    const z = lerp(0.124, 0.072, t);
    const halfW = lerp(0.032, 0.038, t);
    const laceCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-halfW, y - 0.004, z + 0.004),
      new THREE.Vector3(0, y + 0.003, z + 0.011),
      new THREE.Vector3(halfW, y - 0.004, z + 0.004),
    ]);
    const lace = new THREE.TubeGeometry(laceCurve, 8, 0.0038, 6, false);
    parts.push(withVertexAO(lace, 0.96, 0.96, 0.96));
  }
  return mergeSculptedGeometries(parts);
}

// ============================================================================
// 5. SCULPTED ACCESSORIES: BELT, BUCKLE, COLLAR, SHADES, CAP, CHAIN, WATCH, PACK
// ============================================================================

export function buildSculptedBeltAndLoopsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Sculpted contoured leather belt wrapping exact pelvis waist silhouette
  const belt = buildParametricLoft(
    28,
    6,
    (_u, v, theta) => {
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      const bevel = 1 - 0.018 * Math.pow((v - 0.5) * 2, 2);
      const x = 0.181 * bevel * sinT;
      const y = lerp(0.962, 1.006, v);
      const z = 0.125 * bevel * cosT;
      const ao = lerp(0.84, 1.0, Math.sin(v * Math.PI));
      return { x, y, z, ao };
    },
    true,
    true,
  );
  parts.push(belt);

  // 6 sculpted 3D belt loops around waist
  const loopAngles = [-0.45, 0.45, -1.55, 1.55, -2.55, 2.55];
  for (const ang of loopAngles) {
    const loop = new THREE.BoxGeometry(0.016, 0.056, 0.014);
    loop.rotateY(ang);
    loop.translate(Math.sin(ang) * 0.184, 0.984, Math.cos(ang) * 0.127);
    parts.push(withVertexAO(loop, 0.88, 0.88, 0.88));
  }

  return mergeSculptedGeometries(parts);
}

export function buildSculptedBuckleGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // Hollow rectangular beveled metallic buckle frame
  const outer = new THREE.Shape();
  outer.moveTo(-0.032, -0.025);
  outer.lineTo(0.032, -0.025);
  outer.lineTo(0.032, 0.025);
  outer.lineTo(-0.032, 0.025);
  outer.closePath();

  const hole = new THREE.Path();
  hole.moveTo(-0.021, -0.015);
  hole.lineTo(0.021, -0.015);
  hole.lineTo(0.021, 0.015);
  hole.lineTo(-0.021, 0.015);
  hole.closePath();
  outer.holes.push(hole);

  const frame = new THREE.ExtrudeGeometry(outer, {
    depth: 0.008,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.003,
    bevelThickness: 0.003,
  });
  frame.center();
  frame.translate(0, 0.984, 0.132);
  parts.push(withVertexAO(frame));

  // Buckle prong pin
  const prong = new THREE.CylinderGeometry(0.0025, 0.0025, 0.038, 6);
  prong.rotateZ(Math.PI * 0.5);
  prong.translate(-0.005, 0.984, 0.135);
  parts.push(withVertexAO(prong));

  return mergeSculptedGeometries(parts);
}

export function buildSculptedCollarBandGeometry(isTankTop: boolean): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const segs = 28;
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    const sinT = Math.sin(t);
    const cosT = Math.cos(t);
    if (isTankTop) {
      // Scooped ribbed tank top neckline dipping onto upper chest
      const rx = 0.095;
      const rz = 0.088;
      const dip = cosT > 0 ? cosT * 0.052 : -cosT * 0.024;
      pts.push(new THREE.Vector3(rx * sinT, 0.525 - dip, rz * cosT + 0.008));
    } else {
      // Snug ribbed crewneck collar band
      const rx = 0.084;
      const rz = 0.076;
      const dip = cosT > 0 ? cosT * 0.016 : 0;
      pts.push(new THREE.Vector3(rx * sinT, 0.542 - dip, rz * cosT + 0.004));
    }
  }
  const curve = new THREE.CatmullRomCurve3(pts, true);
  const tube = new THREE.TubeGeometry(curve, 32, isTankTop ? 0.010 : 0.013, 8, true);
  return withVertexAO(tube, 0.95, 0.95, 0.95);
}

export function buildSculptedCubanChainGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const pts: THREE.Vector3[] = [];
  const segs = 28;
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    const sinT = Math.sin(t);
    const cosT = Math.cos(t);
    const frontDrop = cosT > 0 ? Math.pow(cosT, 1.3) * 0.135 : 0;
    const x = (0.088 + (cosT > 0 ? 0.012 * Math.sin(t * 2) : 0)) * sinT;
    const y = 0.535 - frontDrop;
    const z = (cosT > 0 ? 0.128 : 0.082) * cosT + 0.008;
    pts.push(new THREE.Vector3(x, y, z));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true);
  const chain = new THREE.TubeGeometry(curve, 40, 0.0068, 8, true);
  parts.push(withVertexAO(chain));

  // Beveled gold pendant medallion hanging on chest
  const med = new THREE.CylinderGeometry(0.018, 0.018, 0.005, 16);
  med.rotateX(Math.PI * 0.5);
  med.translate(0, 0.382, 0.138);
  parts.push(withVertexAO(med));

  return mergeSculptedGeometries(parts);
}

// Sculpted Aviator/Wayfarer Sunglasses (separate frame + reflective curved lenses!)
export function buildSculptedShadesGeometries(): {
  frameGeo: THREE.BufferGeometry;
  lensGeo: THREE.BufferGeometry;
} {
  const { EYE_V, HEAD_CENTER_Y, HEAD_RY } = FACE_LANDMARKS;
  const eyeY = HEAD_CENTER_Y + HEAD_RY * Math.sin((EYE_V - 0.5) * Math.PI * 0.985);
  const frontZ = 0.114;

  const frameParts: THREE.BufferGeometry[] = [];
  const lensParts: THREE.BufferGeometry[] = [];

  for (const sx of [-1, 1]) {
    // Curved aviator teardrop lens shape
    const lShape = new THREE.Shape();
    lShape.moveTo(-0.025, 0.014);
    lShape.bezierCurveTo(0.0, 0.018, 0.026, 0.014, 0.027, 0.002);
    lShape.bezierCurveTo(0.026, -0.014, 0.010, -0.019, -0.005, -0.017);
    lShape.bezierCurveTo(-0.022, -0.014, -0.028, 0.002, -0.025, 0.014);

    const lens = new THREE.ExtrudeGeometry(lShape, {
      depth: 0.003,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.001,
      bevelThickness: 0.001,
      curveSegments: 14,
    });
    lens.center();
    if (sx < 0) lens.scale(-1, 1, 1);
    lens.rotateY(sx * 0.18);
    lens.translate(sx * 0.039, eyeY - 0.002, frontZ - 0.004);
    lensParts.push(withVertexAO(lens));

    // Rim loop around lens
    const rimPts = lShape.getPoints(16).map((p) => {
      const px = sx < 0 ? -p.x : p.x;
      return new THREE.Vector3(px, p.y, 0);
    });
    const rimCurve = new THREE.CatmullRomCurve3(rimPts, true);
    const rim = new THREE.TubeGeometry(rimCurve, 22, 0.0032, 6, true);
    rim.rotateY(sx * 0.18);
    rim.translate(sx * 0.039, eyeY - 0.002, frontZ - 0.003);
    frameParts.push(withVertexAO(rim));

    // Curved temple arm wrapping cleanly over sculpted ear!
    const armCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sx * 0.068, eyeY + 0.005, frontZ - 0.014),
      new THREE.Vector3(sx * 0.094, eyeY + 0.007, 0.055),
      new THREE.Vector3(sx * 0.097, eyeY + 0.003, 0.002),
      new THREE.Vector3(sx * 0.094, eyeY - 0.016, -0.022),
    ]);
    const arm = new THREE.TubeGeometry(armCurve, 12, 0.003, 6, false);
    frameParts.push(withVertexAO(arm));
  }

  // Twin aviator brow bar + nose bridge
  const browBar = new THREE.CylinderGeometry(0.0028, 0.0028, 0.088, 6);
  browBar.rotateZ(Math.PI * 0.5);
  browBar.translate(0, eyeY + 0.012, frontZ + 0.001);
  frameParts.push(withVertexAO(browBar));

  const noseBridge = new THREE.CylinderGeometry(0.0026, 0.0026, 0.028, 6);
  noseBridge.rotateZ(Math.PI * 0.5);
  noseBridge.translate(0, eyeY + 0.004, frontZ + 0.002);
  frameParts.push(withVertexAO(noseBridge));

  return {
    frameGeo: mergeSculptedGeometries(frameParts),
    lensGeo: mergeSculptedGeometries(lensParts),
  };
}

// Sculpted 6-panel Baseball Cap with stitched crown, curved beveled bill & top button
export function buildSculptedCapGeometry(): THREE.BufferGeometry {
  const { HEAD_CENTER_Y, HEAD_RX, HEAD_RY, HEAD_RZ } = FACE_LANDMARKS;
  const parts: THREE.BufferGeometry[] = [];

  // 1. 6-panel contoured dome
  const crown = buildParametricLoft(
    30,
    14,
    (u, v, theta) => {
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      const mappedV = lerp(0.66, 0.996, v);
      const phi = (mappedV - 0.5) * Math.PI * 0.985;
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);
      // 6 subtle panel ribs
      const panelSeam = 0.002 * Math.abs(Math.sin(theta * 3));
      const rx = HEAD_RX * 1.12 + panelSeam;
      const ry = HEAD_RY * 1.07 + panelSeam;
      const rz = HEAD_RZ * 1.11 + panelSeam;
      const x = rx * cosP * sinT;
      const y = HEAD_CENTER_Y + 0.008 + ry * sinP;
      const z = rz * cosP * cosT - 0.004;
      const ao = lerp(0.84, 1.0, smoothstep(0.0, 0.25, v));
      return { x, y, z, ao };
    },
    false,
    true,
  );
  parts.push(crown);

  // 2. Curved beveled front visor bill
  const billShape = new THREE.Shape();
  billShape.moveTo(-0.088, 0.0);
  billShape.bezierCurveTo(-0.082, 0.068, -0.044, 0.105, 0, 0.108);
  billShape.bezierCurveTo(0.044, 0.105, 0.082, 0.068, 0.088, 0.0);
  billShape.bezierCurveTo(0.048, -0.018, -0.048, -0.018, -0.088, 0.0);

  const bill = new THREE.ExtrudeGeometry(billShape, {
    depth: 0.0055,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.002,
    bevelThickness: 0.002,
    curveSegments: 16,
  });
  bill.rotateX(Math.PI * 0.5);
  // Apply realistic baseball cap curvature (arched down laterally and pitched gently forward)
  const bPos = bill.attributes.position;
  for (let i = 0; i < bPos.count; i++) {
    const bx = bPos.getX(i);
    const by = bPos.getY(i);
    const bz = bPos.getZ(i);
    const archDrop = (bx * bx) * 2.2;
    const tipDrop = bz * 0.14;
    bPos.setXYZ(i, bx, by - archDrop - tipDrop, bz);
  }
  bill.translate(0, HEAD_CENTER_Y + 0.068, 0.078);
  bill.computeVertexNormals();
  parts.push(withVertexAO(bill, 0.92, 0.92, 0.92));

  // 3. Crown squatchee button
  const btn = new THREE.SphereGeometry(0.0085, 10, 8);
  btn.scale(1, 0.45, 1);
  btn.translate(0, HEAD_CENTER_Y + HEAD_RY * 1.09 + 0.008, -0.004);
  parts.push(withVertexAO(btn));

  return mergeSculptedGeometries(parts);
}

// Sculpted Ergonomic Street Backpack with shoulder straps, front pocket & zipper
export function buildSculptedBackpackGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const mainBody = buildParametricLoft(
    20,
    14,
    (_u, v, theta) => {
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      const rx = lerp(0.145, 0.122, smoothstep(0.35, 1.0, v)) * (0.92 + 0.08 * Math.sin(v * Math.PI));
      const rz = lerp(0.072, 0.056, smoothstep(0.4, 1.0, v));
      const box = 1 - 0.14 * Math.pow(Math.sin(2 * theta), 2);
      const x = rx * box * sinT;
      const y = lerp(0.11, 0.49, v);
      const z = -0.185 + rz * box * cosT;
      const ao = lerp(0.80, 1.0, smoothstep(0.0, 0.25, v));
      return { x, y, z, ao };
    },
    true,
    true,
  );
  parts.push(mainBody);

  // Sculpted front zippered compartment
  const pocket = new THREE.BoxGeometry(0.21, 0.16, 0.055, 2, 2, 2);
  pocket.translate(0, 0.21, -0.255);
  parts.push(withVertexAO(pocket, 0.88, 0.88, 0.88));

  // Contoured padded shoulder straps wrapping cleanly over shoulders
  for (const sx of [-1, 1]) {
    const strapCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sx * 0.105, 0.45, -0.14),
      new THREE.Vector3(sx * 0.145, 0.51, -0.02),
      new THREE.Vector3(sx * 0.155, 0.41, 0.125),
      new THREE.Vector3(sx * 0.168, 0.22, 0.112),
      new THREE.Vector3(sx * 0.155, 0.14, -0.11),
    ]);
    const strap = new THREE.TubeGeometry(strapCurve, 18, 0.015, 6, false);
    parts.push(withVertexAO(strap, 0.86, 0.86, 0.86));
  }

  return mergeSculptedGeometries(parts);
}

// ============================================================================
// 6. HIGH-RESOLUTION PHOTOREALISTIC PROCEDURAL PBR TEXTURE GENERATORS
// ============================================================================

function createNormalMapFromHeight(
  heightCanvas: HTMLCanvasElement,
  strength: number,
  anisotropy: number,
  wrap = true,
): THREE.CanvasTexture {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const src = heightCanvas.getContext('2d')!.getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const outCtx = out.getContext('2d')!;
  const img = outCtx.createImageData(w, h);
  const dst = img.data;

  const sample = (x: number, y: number): number => {
    const wx = wrap ? ((x % w) + w) % w : Math.max(0, Math.min(w - 1, x));
    const wy = wrap ? ((y % h) + h) % h : Math.max(0, Math.min(h - 1, y));
    return src[(wy * w + wx) * 4] / 255;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dX = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dY = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      const invLen = 1 / Math.sqrt(dX * dX + dY * dY + 1);
      const idx = (y * w + x) * 4;
      dst[idx] = Math.round((-dX * invLen * 0.5 + 0.5) * 255);
      dst[idx + 1] = Math.round((-dY * invLen * 0.5 + 0.5) * 255);
      dst[idx + 2] = Math.round((invLen * 0.5 + 0.5) * 255);
      dst[idx + 3] = 255;
    }
  }
  outCtx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.wrapS = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

interface CharacterTextureSuite {
  faceMap: THREE.CanvasTexture;
  faceNormalMap: THREE.CanvasTexture;
  faceRoughnessMap: THREE.CanvasTexture;
  bodySkinMap: THREE.CanvasTexture;
  bodySkinNormalMap: THREE.CanvasTexture;
  bodySkinRoughnessMap: THREE.CanvasTexture;
  eyeIrisMap: THREE.CanvasTexture;
  hairNormalMap: THREE.CanvasTexture;
  shirtMap: THREE.CanvasTexture;
  shirtNormalMap: THREE.CanvasTexture;
  shirtRoughnessMap: THREE.CanvasTexture;
  denimMap: THREE.CanvasTexture;
  denimNormalMap: THREE.CanvasTexture;
  denimRoughnessMap: THREE.CanvasTexture;
  leatherNormalMap: THREE.CanvasTexture;
}

function generateFacePBRMaps(anisotropy: number): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const S = 512;
  const rng = mulberry32(8801);
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;

  const hC = document.createElement('canvas');
  hC.width = S;
  hC.height = S;
  const hCtx = hC.getContext('2d')!;

  const rC = document.createElement('canvas');
  rC.width = S;
  rC.height = S;
  const rCtx = rC.getContext('2d')!;

  const uToX = (u: number) => u * S;
  const vToY = (v: number) => (1 - v) * S;

  // Neutral-bright skin base so multiplying by ANY skinHex tint produces natural photorealistic ethnicity tones!
  ctx.fillStyle = '#ece6e1';
  ctx.fillRect(0, 0, S, S);
  hCtx.fillStyle = '#808080';
  hCtx.fillRect(0, 0, S, S);
  // Default cheek/jaw satin skin roughness (~0.58)
  rCtx.fillStyle = 'rgb(148,148,148)';
  rCtx.fillRect(0, 0, S, S);

  // 1. Subdermal Hemoglobin Warmth Zones (cheeks, nose tip, brow bone, ears) & Melanin Tonal Variation
  const paintBlush = (u: number, v: number, rx: number, ry: number, color: string) => {
    const cx = uToX(u);
    const cy = vToY(v);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * S);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(236,230,225,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-rx * S, -rx * S, rx * S * 2, rx * S * 2);
    ctx.restore();
  };

  paintBlush(0.5, FACE_LANDMARKS.NOSE_TIP_V, 0.045, 0.05, 'rgba(218,146,126,0.22)');
  paintBlush(0.5 - 0.11, FACE_LANDMARKS.CHEEKBONE_V, 0.075, 0.065, 'rgba(214,142,124,0.18)');
  paintBlush(0.5 + 0.11, FACE_LANDMARKS.CHEEKBONE_V, 0.075, 0.065, 'rgba(214,142,124,0.18)');
  paintBlush(0.5, 0.70, 0.13, 0.07, 'rgba(244,232,216,0.16)'); // Forehead warm highlight
  // Subtle orbital under-eye depth shadow
  for (const sx of [-1, 1]) {
    paintBlush(0.5 + sx * FACE_LANDMARKS.EYE_DU, FACE_LANDMARKS.EYE_V - 0.015, 0.048, 0.042, 'rgba(116,96,92,0.24)');
  }

  // 2. Sebaceous T-Zone Glossiness in Roughness Map (forehead, nose bridge/tip, cheekbones)
  const paintRoughZone = (u: number, v: number, r: number, val: number, alpha: number) => {
    const cx = uToX(u);
    const cy = vToY(v);
    const g = rCtx.createRadialGradient(cx, cy, 0, cx, cy, r * S);
    g.addColorStop(0, `rgba(${val},${val},${val},${alpha})`);
    g.addColorStop(1, `rgba(${val},${val},${val},0)`);
    rCtx.fillStyle = g;
    rCtx.fillRect(cx - r * S, cy - r * S, r * S * 2, r * S * 2);
  };
  paintRoughZone(0.5, 0.70, 0.11, 108, 0.85); // Forehead sheen
  paintRoughZone(0.5, FACE_LANDMARKS.NOSE_TIP_V + 0.03, 0.045, 98, 0.9); // Nose bridge/tip sheen
  paintRoughZone(0.5 - 0.10, FACE_LANDMARKS.CHEEKBONE_V + 0.01, 0.06, 118, 0.7);
  paintRoughZone(0.5 + 0.10, FACE_LANDMARKS.CHEEKBONE_V + 0.01, 0.06, 118, 0.7);

  // 3. Realistic Micro-Pores & Subtle Freckling Across Entire Skin Canvas
  for (let i = 0; i < 6500; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const rad = 0.6 + rng() * 1.1;
    const dark = rng() > 0.35;
    ctx.fillStyle = dark ? 'rgba(95,72,62,0.055)' : 'rgba(255,248,240,0.045)';
    ctx.fillRect(x, y, rad, rad);
    hCtx.fillStyle = dark ? 'rgba(84,84,84,0.34)' : 'rgba(164,164,164,0.22)';
    hCtx.fillRect(x, y, rad, rad);
  }

  // 4. Subtle Masculine Beard Stubble Shadow along Mandible, Chin & Upper Lip
  const stubbleGrad = ctx.createRadialGradient(
    uToX(0.5),
    vToY(0.24),
    S * 0.02,
    uToX(0.5),
    vToY(0.25),
    S * 0.16,
  );
  stubbleGrad.addColorStop(0, 'rgba(42,38,36,0.22)');
  stubbleGrad.addColorStop(0.65, 'rgba(46,42,40,0.14)');
  stubbleGrad.addColorStop(1, 'rgba(46,42,40,0)');
  ctx.fillStyle = stubbleGrad;
  ctx.fillRect(uToX(0.30), vToY(0.40), S * 0.40, S * 0.34);

  // Fine directional stubble follicles around chin & jawline
  for (let i = 0; i < 1600; i++) {
    const su = 0.5 + (rng() - 0.5) * 0.28;
    const sv = 0.12 + rng() * 0.24;
    const dCenter = Math.hypot((su - 0.5) / 0.14, (sv - 0.23) / 0.12);
    // Keep cheeks and mouth lip zone clean of stubble
    const inLip = Math.hypot((su - 0.5) / 0.058, (sv - FACE_LANDMARKS.MOUTH_LINE_V) / 0.036) < 1;
    if (dCenter < 1.0 && !inLip) {
      const fx = uToX(su);
      const fy = vToY(sv);
      ctx.fillStyle = 'rgba(28,24,22,0.24)';
      ctx.fillRect(fx, fy, 1.1, 1.8);
      hCtx.fillStyle = 'rgba(195,195,195,0.28)';
      hCtx.fillRect(fx, fy, 1.1, 1.8);
      rCtx.fillStyle = 'rgba(218,218,218,0.28)';
      rCtx.fillRect(fx, fy, 1.5, 1.5);
    }
  }

  // 5. Realistic Lips (Upper Vermilion, Parting Shadow Line, Fuller Lower Lip + Vertical Micro-Lines)
  const mouthCx = uToX(0.5);
  const mouthY = vToY(FACE_LANDMARKS.MOUTH_LINE_V);
  const lipW = S * 0.056;
  const lipH = S * 0.028;

  // Lower lip soft warm tone
  const lowerLipGrad = ctx.createRadialGradient(mouthCx, mouthY + lipH * 0.45, 2, mouthCx, mouthY + lipH * 0.45, lipW);
  lowerLipGrad.addColorStop(0, 'rgba(164,96,90,0.68)');
  lowerLipGrad.addColorStop(0.7, 'rgba(154,92,86,0.44)');
  lowerLipGrad.addColorStop(1, 'rgba(154,92,86,0)');
  ctx.fillStyle = lowerLipGrad;
  ctx.beginPath();
  ctx.ellipse(mouthCx, mouthY + lipH * 0.45, lipW * 0.92, lipH * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();

  // Upper lip slightly deeper shaded vermilion with Cupid's bow
  ctx.fillStyle = 'rgba(126,72,68,0.62)';
  ctx.beginPath();
  ctx.moveTo(mouthCx - lipW * 0.96, mouthY);
  ctx.quadraticCurveTo(mouthCx - lipW * 0.35, mouthY - lipH * 0.85, mouthCx, mouthY - lipH * 0.45);
  ctx.quadraticCurveTo(mouthCx + lipW * 0.35, mouthY - lipH * 0.85, mouthCx + lipW * 0.96, mouthY);
  ctx.quadraticCurveTo(mouthCx, mouthY + lipH * 0.14, mouthCx - lipW * 0.96, mouthY);
  ctx.fill();

  // Subtle moist lip sheen in roughness map
  paintRoughZone(0.5, FACE_LANDMARKS.LOWER_LIP_V + 0.01, 0.045, 92, 0.85);

  // Crisp dark mouth parting crease + soft corner dimples
  ctx.strokeStyle = 'rgba(42,22,20,0.72)';
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  ctx.moveTo(mouthCx - lipW * 0.95, mouthY + 1);
  ctx.quadraticCurveTo(mouthCx, mouthY - 1.5, mouthCx + lipW * 0.95, mouthY + 1);
  ctx.stroke();

  // Lip vertical micro-creases in height map
  hCtx.strokeStyle = 'rgba(65,65,65,0.45)';
  hCtx.lineWidth = 1;
  for (let i = -8; i <= 8; i++) {
    const lx = mouthCx + i * (lipW / 9);
    hCtx.beginPath();
    hCtx.moveTo(lx, mouthY - lipH * 0.45);
    hCtx.lineTo(lx, mouthY + lipH * 0.72);
    hCtx.stroke();
  }

  // 6. Sculpted Nostril Openings & Alar Crease Shading
  const noseBaseY = vToY(FACE_LANDMARKS.NOSE_BASE_V);
  for (const sx of [-1, 1]) {
    ctx.fillStyle = 'rgba(32,18,16,0.72)';
    ctx.beginPath();
    ctx.ellipse(mouthCx + sx * S * 0.0155, noseBaseY + 2, S * 0.0085, S * 0.0052, sx * -0.28, 0, Math.PI * 2);
    ctx.fill();
    // Subtle alar nostril crease
    ctx.strokeStyle = 'rgba(72,48,42,0.34)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mouthCx + sx * S * 0.022, noseBaseY - 3, S * 0.012, sx > 0 ? -0.6 : Math.PI - 0.8, sx > 0 ? 1.1 : Math.PI + 0.6);
    ctx.stroke();
  }

  // 7. Eyelid Creases, Upper Lash Lines & Natural Multi-Stroke Arched Eyebrows
  const eyeY = vToY(FACE_LANDMARKS.EYE_V);
  const browY = vToY(FACE_LANDMARKS.BROW_V);

  for (const sx of [-1, 1]) {
    const ex = uToX(0.5 + sx * FACE_LANDMARKS.EYE_DU);
    // Upper eyelid crease & dark upper lash margin
    ctx.strokeStyle = 'rgba(48,32,26,0.55)';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY - 2, S * 0.026, S * 0.014, sx * -0.08, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(18,14,12,0.86)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY + 1, S * 0.023, S * 0.010, sx * -0.06, Math.PI * 1.06, Math.PI * 1.94);
    ctx.stroke();

    // Subtle lower lash rim
    ctx.strokeStyle = 'rgba(54,38,34,0.42)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY + 2, S * 0.021, S * 0.009, 0, Math.PI * 0.12, Math.PI * 0.88);
    ctx.stroke();

    // Layered multi-stroke photorealistic eyebrows (120 individual angled hairs per brow!)
    for (let h = 0; h < 120; h++) {
      const t = h / 119; // 0 = inner brow near glabella, 1 = outer tail
      const bu = 0.5 + sx * (0.022 + t * 0.082);
      const arch = Math.sin(t * Math.PI * 0.88) * 0.014 - t * 0.004;
      const spread = (rng() - 0.5) * lerp(0.016, 0.007, t);
      const bx = uToX(bu);
      const by = browY - (arch + spread) * S;
      ctx.strokeStyle = `rgba(22,18,16,${0.48 + rng() * 0.36})`;
      ctx.lineWidth = 1.1 + rng() * 0.6;
      ctx.beginPath();
      ctx.moveTo(bx, by + 2.5);
      ctx.lineTo(bx + sx * 4.5, by - 2.2);
      ctx.stroke();

      hCtx.strokeStyle = 'rgba(202,202,202,0.5)';
      hCtx.lineWidth = 1.2;
      hCtx.beginPath();
      hCtx.moveTo(bx, by + 2.5);
      hCtx.lineTo(bx + sx * 4.5, by - 2.2);
      hCtx.stroke();

      rCtx.fillStyle = 'rgba(232,232,232,0.55)';
      rCtx.fillRect(bx - 1, by - 2, 4, 4);
    }
  }

  // 8. Subtle Forehead Expression Lines in Height/Normal Map
  hCtx.strokeStyle = 'rgba(102,102,102,0.28)';
  hCtx.lineWidth = 1.6;
  for (let l = 0; l < 3; l++) {
    const ly = vToY(0.685 + l * 0.024);
    hCtx.beginPath();
    hCtx.moveTo(uToX(0.39), ly);
    hCtx.quadraticCurveTo(uToX(0.5), ly - 3, uToX(0.61), ly);
    hCtx.stroke();
  }

  // 9. Crisp Barber Taper-Fade Hairline & Sideburns seamlessly matching 3D Hair Cap!
  for (let ix = 0; ix < S; ix++) {
    const u = ix / S;
    const absDu = Math.abs(u - 0.5);
    const templeDip = -0.14 * gauss(absDu - 0.175, 0.055);
    const backDrop = -0.34 * smoothstep(0.18, 0.36, absDu);
    const edgeV = clamp01(FACE_LANDMARKS.HAIRLINE_V + templeDip + backDrop);
    const edgeY = vToY(edgeV);

    // Smooth low-fade shadow gradient down 32px below hairline
    const fadeG = ctx.createLinearGradient(0, edgeY - 12, 0, edgeY + 34);
    fadeG.addColorStop(0, 'rgba(24,20,18,0.88)');
    fadeG.addColorStop(0.45, 'rgba(28,24,22,0.34)');
    fadeG.addColorStop(1, 'rgba(28,24,22,0)');
    ctx.fillStyle = fadeG;
    ctx.fillRect(ix, 0, 1.5, edgeY + 34);
  }

  const map = new THREE.CanvasTexture(c);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = anisotropy;
  map.needsUpdate = true;

  const normalMap = createNormalMapFromHeight(hC, 1.25, anisotropy, false);
  const roughnessMap = new THREE.CanvasTexture(rC);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.ClampToEdgeWrapping;
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.anisotropy = anisotropy;
  roughnessMap.needsUpdate = true;

  return { map, normalMap, roughnessMap };
}

function generateBodySkinPBRMaps(anisotropy: number): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const S = 256;
  const rng = mulberry32(8802);
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const hC = document.createElement('canvas');
  hC.width = S;
  hC.height = S;
  const hCtx = hC.getContext('2d')!;
  const rC = document.createElement('canvas');
  rC.width = S;
  rC.height = S;
  const rCtx = rC.getContext('2d')!;

  ctx.fillStyle = '#ece6e1';
  ctx.fillRect(0, 0, S, S);
  hCtx.fillStyle = '#808080';
  hCtx.fillRect(0, 0, S, S);
  rCtx.fillStyle = 'rgb(142,142,142)';
  rCtx.fillRect(0, 0, S, S);

  // Subtle organic skin tone mottling, micro-pores & fine tendon/vascular warmth
  for (let i = 0; i < 3600; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const sz = 1 + rng() * 2;
    ctx.fillStyle = rng() > 0.45 ? 'rgba(130,90,74,0.045)' : 'rgba(255,246,238,0.04)';
    ctx.fillRect(x, y, sz, sz);
    hCtx.fillStyle = rng() > 0.5 ? 'rgba(92,92,92,0.34)' : 'rgba(164,164,164,0.28)';
    hCtx.fillRect(x, y, 1.3, 1.3);
    rCtx.fillStyle = rng() > 0.5 ? 'rgba(128,128,128,0.25)' : 'rgba(162,162,162,0.25)';
    rCtx.fillRect(x, y, 2, 2);
  }
  // Faint longitudinal muscular/tendon micro-lines
  for (let i = 0; i < 14; i++) {
    const vx = rng() * S;
    ctx.strokeStyle = 'rgba(120,88,82,0.05)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(vx, 0);
    ctx.bezierCurveTo(vx + 8, S * 0.33, vx - 8, S * 0.66, vx + 3, S);
    ctx.stroke();
  }

  const map = new THREE.CanvasTexture(c);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = anisotropy;
  const normalMap = createNormalMapFromHeight(hC, 0.9, anisotropy, true);
  const roughnessMap = new THREE.CanvasTexture(rC);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.anisotropy = anisotropy;
  return { map, normalMap, roughnessMap };
}

function generatePhotorealEyeIrisMap(anisotropy: number): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const rng = mulberry32(8803);

  // Spherical UV: center of iris faces +Z which on SphereGeometry with rotateY(-PI/2) sits at u=0.5, v=0.5!
  // Warm realistic sclera (NOT sterile pure white!) with soft corner vascular tint
  const scleraGrad = ctx.createRadialGradient(S * 0.5, S * 0.5, S * 0.08, S * 0.5, S * 0.5, S * 0.48);
  scleraGrad.addColorStop(0, '#efeae4');
  scleraGrad.addColorStop(0.45, '#e6dcd4');
  scleraGrad.addColorStop(1, '#c9a69d');
  ctx.fillStyle = scleraGrad;
  ctx.fillRect(0, 0, S, S);

  // Subtle top eyelid occlusion shadow
  const topAO = ctx.createLinearGradient(0, S * 0.30, 0, S * 0.46);
  topAO.addColorStop(0, 'rgba(32,20,18,0.45)');
  topAO.addColorStop(1, 'rgba(32,20,18,0)');
  ctx.fillStyle = topAO;
  ctx.fillRect(0, 0, S, S * 0.46);

  const cx = S * 0.5;
  const cy = S * 0.5;
  const irisR = S * 0.125;

  // Dark limbal ring framing the iris
  ctx.fillStyle = '#1d140f';
  ctx.beginPath();
  ctx.arc(cx, cy, irisR * 1.08, 0, Math.PI * 2);
  ctx.fill();

  // Rich chestnut-amber-brown fibrous iris stroma
  const irisGrad = ctx.createRadialGradient(cx, cy, irisR * 0.25, cx, cy, irisR);
  irisGrad.addColorStop(0, '#5a3a1e');
  irisGrad.addColorStop(0.55, '#422814');
  irisGrad.addColorStop(0.88, '#26170d');
  irisGrad.addColorStop(1, '#160d08');
  ctx.fillStyle = irisGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, irisR, 0, Math.PI * 2);
  ctx.fill();

  // Radial iris stroma fibers
  for (let i = 0; i < 64; i++) {
    const ang = (i / 64) * Math.PI * 2 + rng() * 0.05;
    ctx.strokeStyle = i % 3 === 0 ? 'rgba(176,124,68,0.42)' : 'rgba(24,14,8,0.35)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * irisR * 0.34, cy + Math.sin(ang) * irisR * 0.34);
    ctx.lineTo(cx + Math.cos(ang) * irisR * 0.94, cy + Math.sin(ang) * irisR * 0.94);
    ctx.stroke();
  }

  // Deep black pupil
  ctx.fillStyle = '#070606';
  ctx.beginPath();
  ctx.arc(cx, cy, irisR * 0.42, 0, Math.PI * 2);
  ctx.fill();

  // Crisp subtle corneal catchlight
  ctx.fillStyle = 'rgba(255,250,242,0.78)';
  ctx.beginPath();
  ctx.arc(cx - irisR * 0.34, cy - irisR * 0.34, irisR * 0.16, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

function generateHairNormalMap(anisotropy: number): THREE.CanvasTexture {
  const S = 256;
  const rng = mulberry32(8804);
  const hC = document.createElement('canvas');
  hC.width = S;
  hC.height = S;
  const ctx = hC.getContext('2d')!;
  ctx.fillStyle = '#7c7c7c';
  ctx.fillRect(0, 0, S, S);

  // Tight organic short wave / textured hair curls
  for (let i = 0; i < 2400; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 1.5 + rng() * 2.8;
    ctx.strokeStyle = rng() > 0.45 ? 'rgba(215,215,215,0.45)' : 'rgba(42,42,42,0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, r, rng() * Math.PI, rng() * Math.PI + Math.PI * 1.1);
    ctx.stroke();
  }
  const tex = createNormalMapFromHeight(hC, 1.9, anisotropy, true);
  tex.repeat.set(3, 2);
  return tex;
}

function generateHeavyCottonPBRMaps(anisotropy: number): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const S = 512;
  const rng = mulberry32(8805);
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const hC = document.createElement('canvas');
  hC.width = S;
  hC.height = S;
  const hCtx = hC.getContext('2d')!;
  const rC = document.createElement('canvas');
  rC.width = S;
  rC.height = S;
  const rCtx = rC.getContext('2d')!;

  // Clean bright neutral cotton base so shirtHex multiplies faithfully!
  ctx.fillStyle = '#ecebe8';
  ctx.fillRect(0, 0, S, S);
  hCtx.fillStyle = '#808080';
  hCtx.fillRect(0, 0, S, S);
  rCtx.fillStyle = 'rgb(226,226,226)';
  rCtx.fillRect(0, 0, S, S);

  // Ultra-fine vertical ribbed jersey knit (subtle & organic, NEVER a coarse grid!)
  for (let x = 0; x < S; x += 2) {
    const alt = x % 4 === 0;
    ctx.fillStyle = alt ? 'rgba(30,28,26,0.032)' : 'rgba(255,255,255,0.03)';
    ctx.fillRect(x, 0, 1, S);
    hCtx.fillStyle = alt ? 'rgba(104,104,104,0.38)' : 'rgba(154,154,154,0.34)';
    hCtx.fillRect(x, 0, 1, S);
  }
  // Fine horizontal cotton slub yarn variation
  for (let i = 0; i < 5200; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const w = 2 + rng() * 8;
    ctx.fillStyle = rng() > 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(24,22,20,0.045)';
    ctx.fillRect(x, y, w, 1);
    hCtx.fillStyle = rng() > 0.5 ? 'rgba(148,148,148,0.22)' : 'rgba(108,108,108,0.22)';
    hCtx.fillRect(x, y, w, 1);
  }

  // Organic diagonal garment tension folds (radiating from chest & waist)
  for (let f = 0; f < 10; f++) {
    const fy = S * (0.28 + f * 0.068) + (rng() - 0.5) * 16;
    const tilt = (rng() - 0.5) * 32;
    const grad = ctx.createLinearGradient(0, fy - 12, 0, fy + 14);
    grad.addColorStop(0, 'rgba(25,22,20,0)');
    grad.addColorStop(0.42, 'rgba(25,22,20,0.095)');
    grad.addColorStop(0.68, 'rgba(255,255,255,0.075)');
    grad.addColorStop(1, 'rgba(25,22,20,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, fy - 12);
    ctx.lineTo(S, fy - 12 + tilt);
    ctx.lineTo(S, fy + 14 + tilt);
    ctx.lineTo(0, fy + 14);
    ctx.closePath();
    ctx.fill();

    const hGrad = hCtx.createLinearGradient(0, fy - 10, 0, fy + 12);
    hGrad.addColorStop(0, 'rgba(128,128,128,0)');
    hGrad.addColorStop(0.4, 'rgba(72,72,72,0.55)');
    hGrad.addColorStop(0.7, 'rgba(182,182,182,0.45)');
    hGrad.addColorStop(1, 'rgba(128,128,128,0)');
    hCtx.fillStyle = hGrad;
    hCtx.fillRect(0, fy - 10, S, 22);
  }

  // Double-needle coverstitch bottom hem & subtle side torso seams (u = 0.25 and u = 0.75)
  const drawDoubleStitch = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.strokeStyle = 'rgba(35,32,30,0.22)';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    hCtx.strokeStyle = 'rgba(72,72,72,0.6)';
    hCtx.setLineDash([4, 3]);
    hCtx.lineWidth = 1.6;
    hCtx.beginPath();
    hCtx.moveTo(x0, y0);
    hCtx.lineTo(x1, y1);
    hCtx.stroke();
    ctx.setLineDash([]);
    hCtx.setLineDash([]);
  };

  drawDoubleStitch(0, S - 14, S, S - 14);
  drawDoubleStitch(0, S - 19, S, S - 19);
  drawDoubleStitch(S * 0.25, 0, S * 0.25, S);
  drawDoubleStitch(S * 0.75, 0, S * 0.75, S);

  // Subtle tonal roughness breakup
  for (let i = 0; i < 1200; i++) {
    const v = 208 + Math.floor(rng() * 38);
    rCtx.fillStyle = `rgba(${v},${v},${v},0.35)`;
    rCtx.fillRect(rng() * S, rng() * S, 6, 4);
  }

  const map = new THREE.CanvasTexture(c);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = anisotropy;
  const normalMap = createNormalMapFromHeight(hC, 1.55, anisotropy, true);
  const roughnessMap = new THREE.CanvasTexture(rC);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.anisotropy = anisotropy;
  return { map, normalMap, roughnessMap };
}

function generateSelvedgeDenimPBRMaps(anisotropy: number): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const S = 512;
  const rng = mulberry32(8806);
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  const hC = document.createElement('canvas');
  hC.width = S;
  hC.height = S;
  const hCtx = hC.getContext('2d')!;
  const rC = document.createElement('canvas');
  rC.width = S;
  rC.height = S;
  const rCtx = rC.getContext('2d')!;

  ctx.fillStyle = '#dde2ea';
  ctx.fillRect(0, 0, S, S);
  hCtx.fillStyle = '#808080';
  hCtx.fillRect(0, 0, S, S);
  rCtx.fillStyle = 'rgb(228,228,228)';
  rCtx.fillRect(0, 0, S, S);

  // Authentic 3x1 diagonal twill denim weave
  ctx.strokeStyle = 'rgba(255,255,255,0.085)';
  ctx.lineWidth = 1.1;
  hCtx.strokeStyle = 'rgba(164,164,164,0.42)';
  hCtx.lineWidth = 1.2;
  for (let i = -S; i < S * 2; i += 4) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + S, S);
    ctx.stroke();
    hCtx.beginPath();
    hCtx.moveTo(i, 0);
    hCtx.lineTo(i + S, S);
    hCtx.stroke();
  }

  // Natural warp yarn slub streaks & gentle thigh/knee fade wash
  for (let i = 0; i < 4200; i++) {
    const x = rng() * S;
    const y = rng() * S;
    ctx.fillStyle = rng() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(18,22,30,0.075)';
    ctx.fillRect(x, y, 1.5, 4 + rng() * 12);
    hCtx.fillStyle = rng() > 0.5 ? 'rgba(154,154,154,0.22)' : 'rgba(98,98,98,0.24)';
    hCtx.fillRect(x, y, 1.5, 5);
  }

  // Subtle lighter wash highlight down front thigh/shin center (u = 0.5)
  const washGrad = ctx.createLinearGradient(S * 0.25, 0, S * 0.75, 0);
  washGrad.addColorStop(0, 'rgba(255,255,255,0)');
  washGrad.addColorStop(0.5, 'rgba(255,255,255,0.11)');
  washGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = washGrad;
  ctx.fillRect(S * 0.25, 0, S * 0.5, S);

  // Double-stitched ochre/copper denim side outseams (u = 0.25 and u = 0.75) + bottom cuff chainstitch
  ctx.strokeStyle = 'rgba(196,144,72,0.46)';
  ctx.setLineDash([5, 3]);
  ctx.lineWidth = 2;
  for (const sx of [S * 0.25, S * 0.75]) {
    ctx.beginPath();
    ctx.moveTo(sx - 2, 0);
    ctx.lineTo(sx - 2, S);
    ctx.moveTo(sx + 2, 0);
    ctx.lineTo(sx + 2, S);
    ctx.stroke();

    hCtx.strokeStyle = 'rgba(200,200,200,0.55)';
    hCtx.lineWidth = 3;
    hCtx.beginPath();
    hCtx.moveTo(sx, 0);
    hCtx.lineTo(sx, S);
    hCtx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, S - 12);
  ctx.lineTo(S, S - 12);
  ctx.stroke();
  ctx.setLineDash([]);

  for (let i = 0; i < 1200; i++) {
    const v = 205 + Math.floor(rng() * 42);
    rCtx.fillStyle = `rgba(${v},${v},${v},0.36)`;
    rCtx.fillRect(rng() * S, rng() * S, 6, 6);
  }

  const map = new THREE.CanvasTexture(c);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = anisotropy;
  const normalMap = createNormalMapFromHeight(hC, 1.5, anisotropy, true);
  const roughnessMap = new THREE.CanvasTexture(rC);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.anisotropy = anisotropy;
  return { map, normalMap, roughnessMap };
}

function generatePebbledLeatherNormalMap(anisotropy: number): THREE.CanvasTexture {
  const S = 256;
  const rng = mulberry32(8807);
  const hC = document.createElement('canvas');
  hC.width = S;
  hC.height = S;
  const ctx = hC.getContext('2d')!;
  ctx.fillStyle = '#7c7c7c';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 1800; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 1.4 + rng() * 2.2;
    ctx.fillStyle = rng() > 0.35 ? 'rgba(182,182,182,0.42)' : 'rgba(64,64,64,0.42)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = createNormalMapFromHeight(hC, 1.35, anisotropy, true);
  tex.repeat.set(3, 3);
  return tex;
}

// ============================================================================
// 7. BIOPHYSICAL SKIN SUBSURFACE SCATTERING & DUAL-LOBE LIPID SHADER
// ============================================================================

export function applyPhotorealSkinShader(
  material: THREE.MeshPhysicalMaterial,
  uniforms: SharedWeatherUniforms,
  cacheTag: string,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDir = uniforms.uSunDir;
    shader.uniforms.uNightFactor = uniforms.uNightFactor;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vBioWorldPos;
        varying vec3 vBioWorldNormal;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vBioWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vBioWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uSunDir;
        uniform float uNightFactor;
        varying vec3 vBioWorldPos;
        varying vec3 vBioWorldNormal;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 bN = normalize(vBioWorldNormal);
        vec3 bV = normalize(cameraPosition - vBioWorldPos);
        vec3 bL = normalize(uSunDir);
        float NdotV = clamp(dot(bN, bV), 0.0, 1.0);
        float NdotL = dot(bN, bL);
        // Christensen-Burley / Donner-Jensen inspired hemoglobin wrap-diffuse across light-shadow terminator
        float wrapBand = smoothstep(-0.45, 0.35, NdotL) * (1.0 - smoothstep(0.05, 0.72, NdotL));
        float backScatter = pow(clamp(dot(-bV, bL) * 0.5 + 0.5, 0.0, 1.0), 3.0) * (1.0 - NdotV);
        float upBounce = clamp(bN.y * 0.5 + 0.5, 0.0, 1.0);
        float fresnelFuzz = pow(1.0 - NdotV, 3.2);
        float dayScale = 1.0 - uNightFactor * 0.55;
        vec3 dermisTint = diffuseColor.rgb * vec3(1.24, 0.76, 0.58);
        vec3 sssTerm = dermisTint * (0.095 + 0.065 * upBounce + wrapBand * 0.24 * dayScale + backScatter * 0.16 * dayScale);
        vec3 peachFuzzRim = mix(vec3(0.46, 0.56, 0.72), vec3(0.98, 0.76, 0.56), upBounce) * fresnelFuzz * 0.16 * dayScale;
        totalEmissiveRadiance += sssTerm + peachFuzzRim;`,
      );
  };
  material.customProgramCacheKey = () => `photoreal_skin_sss_v2_${cacheTag}`;
}

// ============================================================================
// 8. SHARED MASTER CHARACTER ASSET CACHE (BUILT ONCE FOR ALL 120 CHARACTERS!)
// ============================================================================

interface MasterCharacterAssets {
  // Sculpted Anatomical Geometries (100% shared across protagonist + all 118+ NPCs!)
  headGeo: THREE.BufferGeometry;
  leftEarGeo: THREE.BufferGeometry;
  rightEarGeo: THREE.BufferGeometry;
  hairGeo: THREE.BufferGeometry;
  eyeGeo: THREE.BufferGeometry;
  neckGeo: THREE.BufferGeometry;
  upperYokeSkinGeo: THREE.BufferGeometry;
  tankTorsoGeo: THREE.BufferGeometry;
  teeTorsoGeo: THREE.BufferGeometry;
  tankCollarGeo: THREE.BufferGeometry;
  teeCollarGeo: THREE.BufferGeometry;
  pelvisGeo: THREE.BufferGeometry;
  beltAndLoopsGeo: THREE.BufferGeometry;
  buckleGeo: THREE.BufferGeometry;
  leftUpperArmGeo: THREE.BufferGeometry;
  rightUpperArmGeo: THREE.BufferGeometry;
  leftSleeveGeo: THREE.BufferGeometry;
  rightSleeveGeo: THREE.BufferGeometry;
  leftForearmGeo: THREE.BufferGeometry;
  rightForearmGeo: THREE.BufferGeometry;
  leftHandGeo: THREE.BufferGeometry;
  rightHandGeo: THREE.BufferGeometry;
  leftThighGeo: THREE.BufferGeometry;
  rightThighGeo: THREE.BufferGeometry;
  leftCalfGeo: THREE.BufferGeometry;
  rightCalfGeo: THREE.BufferGeometry;
  leftSoleGeo: THREE.BufferGeometry;
  rightSoleGeo: THREE.BufferGeometry;
  leftShoeUpperGeo: THREE.BufferGeometry;
  rightShoeUpperGeo: THREE.BufferGeometry;
  lacesGeo: THREE.BufferGeometry;
  shadesFrameGeo: THREE.BufferGeometry;
  shadesLensGeo: THREE.BufferGeometry;
  capGeo: THREE.BufferGeometry;
  chainGeo: THREE.BufferGeometry;
  watchGeo: THREE.BufferGeometry;
  badgeGeo: THREE.BufferGeometry;
  backpackGeo: THREE.BufferGeometry;
  cShadowGeo: THREE.CircleGeometry;

  // Shared High-Res PBR Texture Suite
  textures: CharacterTextureSuite;

  // Shared Base Materials
  eyeMat: THREE.MeshPhysicalMaterial;
  hairMat: THREE.MeshPhysicalMaterial;
  beltMat: THREE.MeshPhysicalMaterial;
  goldMat: THREE.MeshPhysicalMaterial;
  shadesFrameMat: THREE.MeshPhysicalMaterial;
  shadesLensMat: THREE.MeshPhysicalMaterial;
  shoeSoleMat: THREE.MeshStandardMaterial;
  lacesMat: THREE.MeshStandardMaterial;
  backpackMat: THREE.MeshPhysicalMaterial;
  cShadowMat: THREE.MeshBasicMaterial;

  // Per-Palette Material Pools (tiny memory footprint, maximum batching!)
  faceSkinMats: Map<number, THREE.MeshPhysicalMaterial>;
  bodySkinMats: Map<number, THREE.MeshPhysicalMaterial>;
  shirtMats: Map<number, THREE.MeshPhysicalMaterial>;
  pantsMats: Map<number, THREE.MeshPhysicalMaterial>;
  shoeUpperMats: Map<number, THREE.MeshPhysicalMaterial>;
  hatMats: Map<number, THREE.MeshPhysicalMaterial>;
}

let cachedMasterAssets: MasterCharacterAssets | null = null;
let cachedLibraryRef: HyperrealMaterialLibrary | null = null;

export function disposeMasterCharacterAssets(): void {
  const assets = cachedMasterAssets;
  if (!assets) return;
  cachedMasterAssets = null;
  cachedLibraryRef = null;

  const geos: THREE.BufferGeometry[] = [
    assets.headGeo,
    assets.leftEarGeo,
    assets.rightEarGeo,
    assets.hairGeo,
    assets.eyeGeo,
    assets.neckGeo,
    assets.upperYokeSkinGeo,
    assets.tankTorsoGeo,
    assets.teeTorsoGeo,
    assets.tankCollarGeo,
    assets.teeCollarGeo,
    assets.pelvisGeo,
    assets.beltAndLoopsGeo,
    assets.buckleGeo,
    assets.leftUpperArmGeo,
    assets.rightUpperArmGeo,
    assets.leftSleeveGeo,
    assets.rightSleeveGeo,
    assets.leftForearmGeo,
    assets.rightForearmGeo,
    assets.leftHandGeo,
    assets.rightHandGeo,
    assets.leftThighGeo,
    assets.rightThighGeo,
    assets.leftCalfGeo,
    assets.rightCalfGeo,
    assets.leftSoleGeo,
    assets.rightSoleGeo,
    assets.leftShoeUpperGeo,
    assets.rightShoeUpperGeo,
    assets.lacesGeo,
    assets.shadesFrameGeo,
    assets.shadesLensGeo,
    assets.capGeo,
    assets.chainGeo,
    assets.watchGeo,
    assets.badgeGeo,
    assets.backpackGeo,
    assets.cShadowGeo,
  ];
  for (const g of geos) g.dispose();

  for (const tex of Object.values(assets.textures)) {
    tex.dispose();
  }

  const fixedMats: THREE.Material[] = [
    assets.eyeMat,
    assets.hairMat,
    assets.beltMat,
    assets.goldMat,
    assets.shadesFrameMat,
    assets.shadesLensMat,
    assets.shoeSoleMat,
    assets.lacesMat,
    assets.backpackMat,
    assets.cShadowMat,
  ];
  for (const m of fixedMats) m.dispose();

  for (const m of assets.faceSkinMats.values()) m.dispose();
  for (const m of assets.bodySkinMats.values()) m.dispose();
  for (const m of assets.shirtMats.values()) m.dispose();
  for (const m of assets.pantsMats.values()) m.dispose();
  for (const m of assets.shoeUpperMats.values()) m.dispose();
  for (const m of assets.hatMats.values()) m.dispose();
  assets.faceSkinMats.clear();
  assets.bodySkinMats.clear();
  assets.shirtMats.clear();
  assets.pantsMats.clear();
  assets.shoeUpperMats.clear();
  assets.hatMats.clear();
}

export function warmMasterCharacterAssets(mats: HyperrealMaterialLibrary): void {
  getMasterCharacterAssets(mats);
}

function getMasterCharacterAssets(mats: HyperrealMaterialLibrary): MasterCharacterAssets {
  if (cachedMasterAssets && cachedLibraryRef === mats) {
    return cachedMasterAssets;
  }
  if (cachedMasterAssets) {
    disposeMasterCharacterAssets();
  }

  const aniso = mats.anisotropy;
  const faceMaps = generateFacePBRMaps(aniso);
  const bodyMaps = generateBodySkinPBRMaps(aniso);
  const eyeIrisMap = generatePhotorealEyeIrisMap(aniso);
  const hairNormalMap = generateHairNormalMap(aniso);
  const shirtMaps = generateHeavyCottonPBRMaps(aniso);
  const denimMaps = generateSelvedgeDenimPBRMaps(aniso);
  const leatherNormalMap = generatePebbledLeatherNormalMap(aniso);

  const textures: CharacterTextureSuite = {
    faceMap: faceMaps.map,
    faceNormalMap: faceMaps.normalMap,
    faceRoughnessMap: faceMaps.roughnessMap,
    bodySkinMap: bodyMaps.map,
    bodySkinNormalMap: bodyMaps.normalMap,
    bodySkinRoughnessMap: bodyMaps.roughnessMap,
    eyeIrisMap,
    hairNormalMap,
    shirtMap: shirtMaps.map,
    shirtNormalMap: shirtMaps.normalMap,
    shirtRoughnessMap: shirtMaps.roughnessMap,
    denimMap: denimMaps.map,
    denimNormalMap: denimMaps.normalMap,
    denimRoughnessMap: denimMaps.roughnessMap,
    leatherNormalMap,
  };

  // Orient sphere eyeball so u=0.5, v=0.5 (iris center) faces strictly +Z forward
  const eyeGeo = new THREE.SphereGeometry(0.0148, 16, 12);
  eyeGeo.rotateY(-Math.PI * 0.5);

  const shades = buildSculptedShadesGeometries();

  // Luxury chronograph watch (bezel + dial + metallic band)
  const watchBand = new THREE.CylinderGeometry(0.036, 0.035, 0.024, 16);
  const watchBezel = new THREE.CylinderGeometry(0.017, 0.017, 0.010, 14);
  watchBezel.rotateZ(Math.PI * 0.5);
  watchBezel.translate(-0.033, 0, 0.004);
  const watchGeo = mergeSculptedGeometries([withVertexAO(watchBand), withVertexAO(watchBezel)]);

  // Sculpted 7-point LSPD shield badge
  const badgeShape = new THREE.Shape();
  badgeShape.moveTo(0, 0.026);
  badgeShape.lineTo(0.021, 0.016);
  badgeShape.lineTo(0.018, -0.012);
  badgeShape.lineTo(0, -0.028);
  badgeShape.lineTo(-0.018, -0.012);
  badgeShape.lineTo(-0.021, 0.016);
  badgeShape.closePath();
  const badgeGeo = withVertexAO(
    new THREE.ExtrudeGeometry(badgeShape, {
      depth: 0.006,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.002,
      bevelThickness: 0.002,
    }),
  );
  badgeGeo.center();

  cachedMasterAssets = {
    headGeo: buildSculptedHeadGeometry(),
    leftEarGeo: buildSculptedEarGeometry(-1),
    rightEarGeo: buildSculptedEarGeometry(1),
    hairGeo: buildSculptedHairGeometry(),
    eyeGeo,
    neckGeo: buildSculptedNeckGeometry(),
    upperYokeSkinGeo: buildSculptedUpperYokeSkinGeometry(),
    tankTorsoGeo: buildSculptedTorsoGeometry(true),
    teeTorsoGeo: buildSculptedTorsoGeometry(false),
    tankCollarGeo: buildSculptedCollarBandGeometry(true),
    teeCollarGeo: buildSculptedCollarBandGeometry(false),
    pelvisGeo: buildSculptedPelvisGeometry(),
    beltAndLoopsGeo: buildSculptedBeltAndLoopsGeometry(),
    buckleGeo: buildSculptedBuckleGeometry(),
    leftUpperArmGeo: buildSculptedUpperArmGeometry(-1),
    rightUpperArmGeo: buildSculptedUpperArmGeometry(1),
    leftSleeveGeo: buildSculptedSleeveGeometry(-1),
    rightSleeveGeo: buildSculptedSleeveGeometry(1),
    leftForearmGeo: buildSculptedForearmGeometry(-1),
    rightForearmGeo: buildSculptedForearmGeometry(1),
    leftHandGeo: buildSculptedHandGeometry(-1),
    rightHandGeo: buildSculptedHandGeometry(1),
    leftThighGeo: buildSculptedThighGeometry(-1),
    rightThighGeo: buildSculptedThighGeometry(1),
    leftCalfGeo: buildSculptedCalfGeometry(-1),
    rightCalfGeo: buildSculptedCalfGeometry(1),
    leftSoleGeo: buildSculptedSneakerSoleGeometry(-1),
    rightSoleGeo: buildSculptedSneakerSoleGeometry(1),
    leftShoeUpperGeo: buildSculptedSneakerUpperGeometry(-1),
    rightShoeUpperGeo: buildSculptedSneakerUpperGeometry(1),
    lacesGeo: buildSneakerLacesGeometry(),
    shadesFrameGeo: shades.frameGeo,
    shadesLensGeo: shades.lensGeo,
    capGeo: buildSculptedCapGeometry(),
    chainGeo: buildSculptedCubanChainGeometry(),
    watchGeo,
    badgeGeo,
    backpackGeo: buildSculptedBackpackGeometry(),
    cShadowGeo: new THREE.CircleGeometry(0.60, 22),

    textures,

    // Physical wet corneal eye material (IOR 1.376 + clearcoat catchlight!)
    eyeMat: new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: eyeIrisMap,
      roughness: 0.12,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      ior: 1.376,
      envMapIntensity: 0.85,
    }),

    // Anisotropic matte textured hair material
    hairMat: new THREE.MeshPhysicalMaterial({
      color: 0x1a1512,
      vertexColors: true,
      normalMap: hairNormalMap,
      normalScale: new THREE.Vector2(1.15, 1.15),
      roughness: 0.84,
      metalness: 0.0,
      sheen: 0.35,
      sheenRoughness: 0.65,
      sheenColor: new THREE.Color(0x3a2e26),
      envMapIntensity: 0.25,
    }),

    // Full-grain pebbled leather belt
    beltMat: new THREE.MeshPhysicalMaterial({
      color: 0x221914,
      vertexColors: true,
      normalMap: leatherNormalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.56,
      metalness: 0.04,
      clearcoat: 0.18,
      clearcoatRoughness: 0.45,
      envMapIntensity: 0.36,
    }),

    goldMat: new THREE.MeshPhysicalMaterial({
      color: 0xe2b444,
      vertexColors: true,
      metalness: 0.94,
      roughness: 0.18,
      clearcoat: 0.45,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.15,
    }),

    shadesFrameMat: new THREE.MeshPhysicalMaterial({
      color: 0x1b1d21,
      vertexColors: true,
      metalness: 0.88,
      roughness: 0.24,
      clearcoat: 0.5,
      envMapIntensity: 0.95,
    }),

    shadesLensMat: new THREE.MeshPhysicalMaterial({
      color: 0x090b0f,
      vertexColors: true,
      metalness: 0.52,
      roughness: 0.05,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      ior: 1.54,
      envMapIntensity: 1.85,
    }),

    shoeSoleMat: new THREE.MeshStandardMaterial({
      color: 0xd8d5cc,
      vertexColors: true,
      normalMap: leatherNormalMap,
      normalScale: new THREE.Vector2(0.32, 0.32),
      roughness: 0.86,
      metalness: 0.0,
      envMapIntensity: 0.18,
    }),

    lacesMat: new THREE.MeshStandardMaterial({
      color: 0xeae7e0,
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.15,
    }),

    backpackMat: new THREE.MeshPhysicalMaterial({
      color: 0x26292e,
      vertexColors: true,
      normalMap: shirtMaps.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.84,
      sheen: 0.35,
      sheenRoughness: 0.82,
      envMapIntensity: 0.22,
    }),

    cShadowMat: new THREE.MeshBasicMaterial({
      map: mats.contactShadowMap,
      transparent: true,
      opacity: 0.80,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),

    faceSkinMats: new Map(),
    bodySkinMats: new Map(),
    shirtMats: new Map(),
    pantsMats: new Map(),
    shoeUpperMats: new Map(),
    hatMats: new Map(),
  };

  cachedLibraryRef = mats;
  return cachedMasterAssets;
}

// ============================================================================
// 9. UNIFIED MASTER HYPERREALISTIC CHARACTER BUILDER (PROTAGONIST + ALL NPCS)
// ============================================================================

export function buildHyperrealCharacterRig(
  mats: HyperrealMaterialLibrary,
  opts: CharacterBuildOptions,
): CharacterRig {
  const root = new THREE.Group();
  const ca = getMasterCharacterAssets(mats);

  if (opts.heightScale && Math.abs(opts.heightScale - 1) > 0.005) {
    root.scale.set(
      0.96 + (opts.heightScale - 0.96) * 0.65,
      opts.heightScale,
      0.96 + (opts.heightScale - 0.96) * 0.65,
    );
  }

  // 1. Biophysical Photorealistic Face & Body Skin Materials (cached per skinHex)
  let faceSkinMat = ca.faceSkinMats.get(opts.skinHex);
  if (!faceSkinMat) {
    faceSkinMat = new THREE.MeshPhysicalMaterial({
      color: opts.skinHex,
      vertexColors: true,
      map: ca.textures.faceMap,
      normalMap: ca.textures.faceNormalMap,
      normalScale: new THREE.Vector2(0.68, 0.68),
      roughnessMap: ca.textures.faceRoughnessMap,
      roughness: 0.88,
      metalness: 0.0,
      clearcoat: 0.16,
      clearcoatRoughness: 0.36,
      sheen: 0.20,
      sheenRoughness: 0.76,
      envMapIntensity: 0.34,
    });
    applyPhotorealSkinShader(faceSkinMat, mats.uniforms, 'face');
    ca.faceSkinMats.set(opts.skinHex, faceSkinMat);
  }

  let bodySkinMat = ca.bodySkinMats.get(opts.skinHex);
  if (!bodySkinMat) {
    bodySkinMat = new THREE.MeshPhysicalMaterial({
      color: opts.skinHex,
      vertexColors: true,
      map: ca.textures.bodySkinMap,
      normalMap: ca.textures.bodySkinNormalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: ca.textures.bodySkinRoughnessMap,
      roughness: 0.88,
      metalness: 0.0,
      clearcoat: 0.14,
      clearcoatRoughness: 0.38,
      sheen: 0.18,
      sheenRoughness: 0.78,
      envMapIntensity: 0.32,
    });
    applyPhotorealSkinShader(bodySkinMat, mats.uniforms, 'body');
    ca.bodySkinMats.set(opts.skinHex, bodySkinMat);
  }

  // 2. Heavyweight Cotton Shirt & Selvedge Denim Trousers Materials (Charlie Sheen BRDF + Micro-Weave Normals!)
  let shirtMat: THREE.MeshPhysicalMaterial;
  let pantsMat: THREE.MeshPhysicalMaterial;
  if (opts.isProtagonist) {
    shirtMat = new THREE.MeshPhysicalMaterial({
      color: opts.shirtHex,
      vertexColors: true,
      map: ca.textures.shirtMap,
      normalMap: ca.textures.shirtNormalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughnessMap: ca.textures.shirtRoughnessMap,
      roughness: 0.94,
      metalness: 0.0,
      sheen: 0.52,
      sheenRoughness: 0.78,
      envMapIntensity: 0.24,
    });
    pantsMat = new THREE.MeshPhysicalMaterial({
      color: opts.pantsHex,
      vertexColors: true,
      map: ca.textures.denimMap,
      normalMap: ca.textures.denimNormalMap,
      normalScale: new THREE.Vector2(0.88, 0.88),
      roughnessMap: ca.textures.denimRoughnessMap,
      roughness: 0.94,
      metalness: 0.0,
      sheen: 0.36,
      sheenRoughness: 0.84,
      envMapIntensity: 0.22,
    });
  } else {
    let cachedShirt = ca.shirtMats.get(opts.shirtHex);
    if (!cachedShirt) {
      cachedShirt = new THREE.MeshPhysicalMaterial({
        color: opts.shirtHex,
        vertexColors: true,
        map: ca.textures.shirtMap,
        normalMap: ca.textures.shirtNormalMap,
        normalScale: new THREE.Vector2(0.82, 0.82),
        roughnessMap: ca.textures.shirtRoughnessMap,
        roughness: 0.94,
        metalness: 0.0,
        sheen: 0.48,
        sheenRoughness: 0.80,
        envMapIntensity: 0.24,
      });
      ca.shirtMats.set(opts.shirtHex, cachedShirt);
    }
    shirtMat = cachedShirt;

    let cachedPants = ca.pantsMats.get(opts.pantsHex);
    if (!cachedPants) {
      cachedPants = new THREE.MeshPhysicalMaterial({
        color: opts.pantsHex,
        vertexColors: true,
        map: ca.textures.denimMap,
        normalMap: ca.textures.denimNormalMap,
        normalScale: new THREE.Vector2(0.82, 0.82),
        roughnessMap: ca.textures.denimRoughnessMap,
        roughness: 0.94,
        metalness: 0.0,
        sheen: 0.34,
        sheenRoughness: 0.85,
        envMapIntensity: 0.22,
      });
      ca.pantsMats.set(opts.pantsHex, cachedPants);
    }
    pantsMat = cachedPants;
  }

  // Pebbled satin leather sneaker upper (cached per shoe color; derives subtle palette tint from shirt if unspecified)
  const defaultShoeHex = opts.isPolice
    ? 0x1a1c20
    : opts.isRival
      ? 0x26212c
      : opts.shoeHex ?? 0x282b30;
  let shoeUpperMat = ca.shoeUpperMats.get(defaultShoeHex);
  if (!shoeUpperMat) {
    shoeUpperMat = new THREE.MeshPhysicalMaterial({
      color: defaultShoeHex,
      vertexColors: true,
      normalMap: ca.textures.leatherNormalMap,
      normalScale: new THREE.Vector2(0.72, 0.72),
      roughness: 0.48,
      metalness: 0.04,
      clearcoat: 0.22,
      clearcoatRoughness: 0.42,
      envMapIntensity: 0.36,
    });
    ca.shoeUpperMats.set(defaultShoeHex, shoeUpperMat);
  }

  // 3. Sculpted Pelvis, Full-Grain Leather Belt with 6 Loops & Metallic Buckle
  const pelvis = new THREE.Mesh(ca.pelvisGeo, pantsMat);
  pelvis.castShadow = true;
  pelvis.receiveShadow = true;
  root.add(pelvis);

  const belt = new THREE.Mesh(ca.beltAndLoopsGeo, ca.beltMat);
  belt.castShadow = true;
  root.add(belt);

  const buckle = new THREE.Mesh(
    ca.buckleGeo,
    opts.isProtagonist || opts.isPolice ? ca.goldMat : mats.brushedMetal,
  );
  root.add(buckle);

  // 4. Sculpted Athletic Torso (pivoted at waist y = 0.99 for natural breathing & gait twist)
  const torso = new THREE.Group();
  torso.position.y = 0.99;
  root.add(torso);

  const torsoMesh = new THREE.Mesh(
    opts.isProtagonist ? ca.tankTorsoGeo : ca.teeTorsoGeo,
    shirtMat,
  );
  torsoMesh.castShadow = true;
  torsoMesh.receiveShadow = true;
  torso.add(torsoMesh);

  // Ribbed neckline collar trim
  const collarMesh = new THREE.Mesh(
    opts.isProtagonist ? ca.tankCollarGeo : ca.teeCollarGeo,
    shirtMat,
  );
  torso.add(collarMesh);

  // Exposed clavicles, upper pectorals & muscular trapezius yoke for CJ's iconic tank top
  if (opts.isProtagonist) {
    const yokeSkin = new THREE.Mesh(ca.upperYokeSkinGeo, bodySkinMat);
    yokeSkin.castShadow = true;
    torso.add(yokeSkin);

    const chain = new THREE.Mesh(ca.chainGeo, ca.goldMat);
    torso.add(chain);
  }

  if (opts.isPolice) {
    const badge = new THREE.Mesh(ca.badgeGeo, ca.goldMat);
    badge.position.set(-0.088, 0.385, 0.136);
    badge.rotation.y = -0.22;
    torso.add(badge);
  }

  if (opts.hasBackpack) {
    const pack = new THREE.Mesh(ca.backpackGeo, ca.backpackMat);
    pack.castShadow = true;
    torso.add(pack);
  }

  // 5. Sculpted Anatomical Neck, FLAME-Inspired Head, Recessed Physical Eyes, 3D Ears & Fade Hair
  const head = new THREE.Group();
  head.position.y = 0.56;
  torso.add(head);

  const neck = new THREE.Mesh(ca.neckGeo, bodySkinMat);
  neck.castShadow = true;
  head.add(neck);

  const cranium = new THREE.Mesh(ca.headGeo, faceSkinMat);
  cranium.castShadow = true;
  cranium.receiveShadow = true;
  head.add(cranium);

  // Sculpted 3D Ears positioned accurately on skull temples
  const earY = FACE_LANDMARKS.HEAD_CENTER_Y - 0.008;
  const leftEar = new THREE.Mesh(ca.leftEarGeo, bodySkinMat);
  leftEar.position.set(-FACE_LANDMARKS.HEAD_RX * 0.99, earY, -0.006);
  const rightEar = new THREE.Mesh(ca.rightEarGeo, bodySkinMat);
  rightEar.position.set(FACE_LANDMARKS.HEAD_RX * 0.99, earY, -0.006);
  head.add(leftEar, rightEar);

  // Recessed Physical Corneal Eyeballs nestled inside the sculpted orbital sockets
  const eyePhi = (FACE_LANDMARKS.EYE_V - 0.5) * Math.PI * 0.985;
  const eyeY = FACE_LANDMARKS.HEAD_CENTER_Y + FACE_LANDMARKS.HEAD_RY * Math.sin(eyePhi);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(ca.eyeGeo, ca.eyeMat);
    eye.position.set(sx * 0.0365, eyeY, 0.0885);
    head.add(eye);
  }

  // Sculpted Textured Barber-Fade Hair Cap
  const hairCap = new THREE.Mesh(ca.hairGeo, ca.hairMat);
  hairCap.castShadow = true;
  head.add(hairCap);

  // Optional 6-Panel Baseball Cap
  if (opts.hatColor !== undefined) {
    let hatMat = ca.hatMats.get(opts.hatColor);
    if (!hatMat) {
      hatMat = new THREE.MeshPhysicalMaterial({
        color: opts.hatColor,
        vertexColors: true,
        normalMap: ca.textures.shirtNormalMap,
        normalScale: new THREE.Vector2(0.58, 0.58),
        roughness: 0.88,
        sheen: 0.35,
        sheenRoughness: 0.85,
        envMapIntensity: 0.22,
      });
      ca.hatMats.set(opts.hatColor, hatMat);
    }
    const cap = new THREE.Mesh(ca.capGeo, hatMat);
    cap.castShadow = true;
    head.add(cap);
  }

  // Optional Sculpted Aviator/Wayfarer Sunglasses (with real wireframe bridge, ear temples & dark mirrored lenses!)
  if (opts.isRival || opts.isPolice || opts.hasShades) {
    const frame = new THREE.Mesh(ca.shadesFrameGeo, ca.shadesFrameMat);
    const lenses = new THREE.Mesh(ca.shadesLensGeo, ca.shadesLensMat);
    head.add(frame, lenses);
  }

  // 6. Sculpted Muscular Arms & Articulated 5-Fingered Hands
  const makeArm = (side: -1 | 1): { arm: THREE.Group; forearm: THREE.Group } => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.222, 0.452, 0);

    const upper = new THREE.Mesh(
      side < 0 ? ca.leftUpperArmGeo : ca.rightUpperArmGeo,
      bodySkinMat,
    );
    upper.castShadow = true;
    arm.add(upper);

    if (!opts.isProtagonist) {
      const sleeve = new THREE.Mesh(
        side < 0 ? ca.leftSleeveGeo : ca.rightSleeveGeo,
        shirtMat,
      );
      sleeve.castShadow = true;
      arm.add(sleeve);
    }

    const forearm = new THREE.Group();
    forearm.position.set(0, -0.265, 0);
    arm.add(forearm);

    const lower = new THREE.Mesh(
      side < 0 ? ca.leftForearmGeo : ca.rightForearmGeo,
      bodySkinMat,
    );
    lower.castShadow = true;
    forearm.add(lower);

    if (opts.isProtagonist && side === -1) {
      const watch = new THREE.Mesh(ca.watchGeo, ca.goldMat);
      watch.position.y = -0.222;
      forearm.add(watch);
    }

    const hand = new THREE.Mesh(
      side < 0 ? ca.leftHandGeo : ca.rightHandGeo,
      bodySkinMat,
    );
    hand.castShadow = true;
    forearm.add(hand);

    return { arm, forearm };
  };

  const leftA = makeArm(-1);
  const rightA = makeArm(1);
  torso.add(leftA.arm, rightA.arm);

  // 7. Sculpted Tailored Trousers Legs & Multi-Part High-Top Sneakers (grounded flush at y = 0.000!)
  const makeLeg = (side: -1 | 1): { leg: THREE.Group; shin: THREE.Group } => {
    const leg = new THREE.Group();
    leg.position.set(side * 0.104, 0.88, 0);

    const thigh = new THREE.Mesh(
      side < 0 ? ca.leftThighGeo : ca.rightThighGeo,
      pantsMat,
    );
    thigh.castShadow = true;
    thigh.receiveShadow = true;
    leg.add(thigh);

    const shin = new THREE.Group();
    shin.position.set(0, -0.42, 0);
    leg.add(shin);

    const calf = new THREE.Mesh(
      side < 0 ? ca.leftCalfGeo : ca.rightCalfGeo,
      pantsMat,
    );
    calf.castShadow = true;
    calf.receiveShadow = true;
    shin.add(calf);

    const sole = new THREE.Mesh(
      side < 0 ? ca.leftSoleGeo : ca.rightSoleGeo,
      ca.shoeSoleMat,
    );
    sole.castShadow = true;
    shin.add(sole);

    const shoeUpper = new THREE.Mesh(
      side < 0 ? ca.leftShoeUpperGeo : ca.rightShoeUpperGeo,
      shoeUpperMat,
    );
    shoeUpper.castShadow = true;
    shin.add(shoeUpper);

    const laces = new THREE.Mesh(ca.lacesGeo, ca.lacesMat);
    shin.add(laces);

    return { leg, shin };
  };

  const leftL = makeLeg(-1);
  const rightL = makeLeg(1);
  root.add(leftL.leg, rightL.leg);

  // 8. Grounded Soft Radial Contact Shadow Disc (explicitly named 'contact_shadow' so shadow toggle preserves it!)
  const cShadow = new THREE.Mesh(ca.cShadowGeo, ca.cShadowMat);
  cShadow.name = 'contact_shadow';
  cShadow.rotation.x = -Math.PI * 0.5;
  cShadow.position.y = 0.056;
  root.add(cShadow);

  // 9. Hostile Combat Windup Telegraph Ring (Ballas / LSPD)
  let telegraphRing: THREE.Mesh | undefined;
  if (opts.isRival || opts.isPolice) {
    telegraphRing = new THREE.Mesh(
      new THREE.RingGeometry(0.65, 0.92, 24),
      new THREE.MeshBasicMaterial({
        color: opts.isPolice ? 0x3b9eff : 0xff3030,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    telegraphRing.name = 'contact_shadow';
    telegraphRing.rotation.x = -Math.PI * 0.5;
    telegraphRing.position.y = 0.06;
    telegraphRing.visible = false;
    root.add(telegraphRing);
  }

  return {
    root,
    torso,
    head,
    leftArm: leftA.arm,
    rightArm: rightA.arm,
    leftForearm: leftA.forearm,
    rightForearm: rightA.forearm,
    leftLeg: leftL.leg,
    rightLeg: rightL.leg,
    leftShin: leftL.shin,
    rightShin: rightL.shin,
    shirtMat,
    pantsMat,
    telegraphRing,
  };
}

export function disposeCharacterRig(rig: CharacterRig, isProtagonist = false): void {
  rig.root.removeFromParent();
  if (rig.telegraphRing) {
    rig.telegraphRing.geometry.dispose();
    const ringMat = rig.telegraphRing.material;
    if (Array.isArray(ringMat)) {
      for (const m of ringMat) m.dispose();
    } else {
      ringMat.dispose();
    }
  }
  if (isProtagonist) {
    rig.shirtMat.dispose();
    rig.pantsMat.dispose();
  }
}
