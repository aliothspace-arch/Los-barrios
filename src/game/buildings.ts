import * as THREE from 'three';
import type { BuildingBlueprint } from './types';
import type { HyperrealMaterialLibrary } from './textures';
import {
  BUILDINGS,
  getWalkInShopRoomProfile,
  WALK_IN_BUILDING_IDS,
} from './worldLayout';
import { BuildingMeshBatcher } from './world/buildingBatcher';

// Deterministic string hash for reproducible architectural variation per building ID
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ============================================================================
// CUSTOM PROCEDURAL ARCHITECTURAL GEOMETRY GENERATORS (NO PRIMITIVE CONE HATS!)
// ============================================================================

// True pitched architectural gable roof prism (ExtrudeGeometry) centered at base Y=0
function makeGablePrismGeo(
  spanW: number,
  riseH: number,
  ridgeLenD: number,
  tileMeters = 2.6,
): THREE.BufferGeometry {
  const halfW = spanW * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-halfW, 0);
  shape.lineTo(halfW, 0);
  shape.lineTo(0, riseH);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: ridgeLenD,
    bevelEnabled: false,
    steps: 1,
  });
  geo.translate(0, 0, -ridgeLenD * 0.5);
  // Scale UVs to world meters for realistic shingles/tiles
  const uv = geo.attributes.uv;
  const inv = 1 / tileMeters;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * inv, uv.getY(i) * inv);
  }
  uv.needsUpdate = true;
  return geo;
}

// True 4-slope rectangular architectural hip roof with central ridge beam (zero stretched pyramid cones!)
function makeHipRoofGeo(
  width: number,
  riseH: number,
  depth: number,
  tileMeters = 2.4,
): THREE.BufferGeometry {
  const hw = width * 0.5;
  const hd = depth * 0.5;
  const ridgeAlongX = width >= depth;
  const ridgeHalf = Math.max(0.45, Math.abs(width - depth) * 0.5 + 0.35);

  const rx1 = ridgeAlongX ? -Math.min(hw * 0.72, ridgeHalf) : 0;
  const rx2 = ridgeAlongX ? Math.min(hw * 0.72, ridgeHalf) : 0;
  const rz1 = ridgeAlongX ? 0 : -Math.min(hd * 0.72, ridgeHalf);
  const rz2 = ridgeAlongX ? 0 : Math.min(hd * 0.72, ridgeHalf);

  // 4 eave corners + 2 ridge endpoints
  const cFL = [-hw, 0, hd];
  const cFR = [hw, 0, hd];
  const cBR = [hw, 0, -hd];
  const cBL = [-hw, 0, -hd];
  const rA = [rx1, riseH, rz1];
  const rB = [rx2, riseH, rz2];

  const pos: number[] = [];
  const uvs: number[] = [];
  const inv = 1 / tileMeters;

  const pushTri = (a: number[], b: number[], c: number[]) => {
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    // Planar roof-slope UV projection
    for (const p of [a, b, c]) {
      uvs.push((p[0] + p[2] * 0.35) * inv, (p[1] * 1.4 + p[2] * 0.65) * inv);
    }
  };

  if (ridgeAlongX) {
    // Front slope (+Z): cFL, cFR, rB, rA
    pushTri(cFL, cFR, rB);
    pushTri(cFL, rB, rA);
    // Back slope (-Z): cBR, cBL, rA, rB
    pushTri(cBR, cBL, rA);
    pushTri(cBR, rA, rB);
    // Right hip (+X): cFR, cBR, rB
    pushTri(cFR, cBR, rB);
    // Left hip (-X): cBL, cFL, rA
    pushTri(cBL, cFL, rA);
  } else {
    // Front hip (+Z): cFL, cFR, rB
    pushTri(cFL, cFR, rB);
    // Back hip (-Z): cBR, cBL, rA
    pushTri(cBR, cBL, rA);
    // Right slope (+X): cFR, cBR, rA, rB
    pushTri(cFR, cBR, rA);
    pushTri(cFR, rA, rB);
    // Left slope (-X): cBL, cFL, rB, rA
    pushTri(cBL, cFL, rB);
    pushTri(cBL, rB, rA);
  }

  // Underside soffit closing cap
  pushTri(cFL, cBL, cBR);
  pushTri(cFL, cBR, cFR);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return geo;
}

// Sweeping cantilevered California Googie upswept wing roof (for retro diners & burger joints!)
function makeGoogieWingRoofGeo(
  width: number,
  depth: number,
  frontLift: number,
  thickness = 0.42,
): THREE.BufferGeometry {
  const hd = depth * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-hd, 0);
  shape.lineTo(hd + 2.1, frontLift);
  shape.lineTo(hd + 1.85, frontLift + thickness);
  shape.lineTo(-hd, thickness * 0.85);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: false,
    steps: 1,
  });
  geo.translate(0, 0, -width * 0.5);
  geo.rotateY(-Math.PI * 0.5); // maps shape X -> world +Z (front overhang!)
  return geo;
}

// Sculpted sloped glass-and-steel skyscraper crown sail (Wilshire Grand / modernist icon)
function makeSlopedSailCrownGeo(
  width: number,
  depth: number,
  lowH: number,
  highH: number,
): THREE.BufferGeometry {
  const hw = width * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, 0);
  shape.lineTo(hw, 0);
  shape.lineTo(hw, highH);
  shape.lineTo(-hw, lowH);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    steps: 1,
  });
  geo.translate(0, 0, -depth * 0.5);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * 0.08, uv.getY(i) * 0.08);
  }
  uv.needsUpdate = true;
  return geo;
}

// Spanish Mission Revival curved scalloped parapet pediment
function makeMissionPedimentGeo(width: number, height: number, thickness: number): THREE.BufferGeometry {
  const hw = width * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, 0);
  shape.lineTo(hw, 0);
  shape.lineTo(hw, height * 0.38);
  shape.quadraticCurveTo(hw * 0.65, height * 0.48, hw * 0.42, height * 0.78);
  shape.quadraticCurveTo(0, height * 1.15, -hw * 0.42, height * 0.78);
  shape.quadraticCurveTo(-hw * 0.65, height * 0.48, -hw, height * 0.38);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 8,
  });
  geo.translate(0, 0, -thickness * 0.5);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * 0.25, uv.getY(i) * 0.25);
  }
  uv.needsUpdate = true;
  return geo;
}

// ============================================================================
// SHARED ARCHITECTURAL SUB-COMPONENTS (3D WINDOWS, DOORS, ROOFTOP MECHANICALS)
// ============================================================================

function addFramedWindow(
  batch: BuildingMeshBatcher,
  mats: HyperrealMaterialLibrary,
  opts: {
    x: number;
    y: number;
    z: number;
    rotY?: number;
    w: number;
    h: number;
    glassMat: THREE.Material;
    frameMat: THREE.Material;
    sillMat?: THREE.Material;
    shutterMat?: THREE.Material;
    withGrille?: boolean;
    withKeystone?: boolean;
    withAC?: boolean;
    withAwningHood?: THREE.Material;
  },
): void {
  const rotY = opts.rotY ?? 0;
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);
  // Local offset helper rotated around Y into building coordinates
  const addLocalBox = (
    bw: number,
    bh: number,
    bd: number,
    mat: THREE.Material,
    lx: number,
    ly: number,
    lz: number,
    extraRotX = 0,
  ) => {
    const wx = opts.x + lx * cos + lz * sin;
    const wz = opts.z - lx * sin + lz * cos;
    batch.addBox(bw, bh, bd, mat, wx, opts.y + ly, wz, {
      rotX: extraRotX,
      rotY,
    });
  };

  // Outer casing + recessed parallax glass + cross mullions
  addLocalBox(opts.w + 0.2, opts.h + 0.2, 0.14, opts.frameMat, 0, 0, 0.04);
  addLocalBox(opts.w, opts.h, 0.16, opts.glassMat, 0, 0, 0.06);
  addLocalBox(opts.w + 0.04, 0.07, 0.2, opts.frameMat, 0, 0.04, 0.07);
  addLocalBox(0.07, opts.h + 0.04, 0.2, opts.frameMat, 0, 0, 0.07);

  // Projecting architectural sill & header lintel
  const sillMat = opts.sillMat ?? mats.trimPaintWhite;
  addLocalBox(opts.w + 0.36, 0.13, 0.3, sillMat, 0, -opts.h * 0.5 - 0.12, 0.1);
  addLocalBox(opts.w + 0.32, 0.14, 0.24, sillMat, 0, opts.h * 0.5 + 0.12, 0.08);

  if (opts.withKeystone) {
    addLocalBox(0.28, 0.28, 0.3, sillMat, 0, opts.h * 0.5 + 0.16, 0.11);
  }

  // Louvered wooden side shutters
  if (opts.shutterMat) {
    const sw = Math.min(0.46, opts.w * 0.28);
    addLocalBox(sw, opts.h + 0.14, 0.09, opts.shutterMat, -(opts.w * 0.5 + sw * 0.5 + 0.1), 0, 0.08);
    addLocalBox(sw, opts.h + 0.14, 0.09, opts.shutterMat, opts.w * 0.5 + sw * 0.5 + 0.1, 0, 0.08);
  }

  // Spanish wrought-iron security bars
  if (opts.withGrille) {
    for (const bx of [-opts.w * 0.3, 0, opts.w * 0.3]) {
      addLocalBox(0.035, opts.h + 0.04, 0.04, mats.darkChrome, bx, 0, 0.19);
    }
    addLocalBox(opts.w + 0.08, 0.04, 0.04, mats.darkChrome, 0, -opts.h * 0.26, 0.19);
    addLocalBox(opts.w + 0.08, 0.04, 0.04, mats.darkChrome, 0, opts.h * 0.26, 0.19);
  }

  // Mini terracotta or fabric sun-hood above window
  if (opts.withAwningHood) {
    addLocalBox(opts.w + 0.44, 0.16, 0.65, opts.withAwningHood, 0, opts.h * 0.5 + 0.22, 0.28, 0.34);
  }

  // Window-mounted box AC unit
  if (opts.withAC) {
    addLocalBox(0.66, 0.44, 0.56, mats.brushedMetal, opts.w * 0.22, -opts.h * 0.28, 0.28);
    addLocalBox(0.56, 0.34, 0.06, mats.darkChrome, opts.w * 0.22, -opts.h * 0.28, 0.55);
  }
}

function addRooftopMechanicals(
  batch: BuildingMeshBatcher,
  mats: HyperrealMaterialLibrary,
  roofY: number,
  w: number,
  d: number,
  seed: number,
  includeWaterTower = false,
): void {
  // Primary commercial HVAC chiller + fan shroud + galvanized duct run
  const hx = (seed % 2 === 0 ? -1 : 1) * Math.min(w * 0.24, 4.2);
  const hz = -d * 0.14;
  batch.addBox(2.9, 1.25, 2.2, mats.brushedMetal, hx, roofY + 0.62, hz, { castShadow: true });
  batch.addCylinder(0.68, 0.68, 0.26, 10, mats.darkChrome, hx - 0.6, roofY + 1.35, hz);
  batch.addCylinder(0.68, 0.68, 0.26, 10, mats.darkChrome, hx + 0.6, roofY + 1.35, hz);
  batch.addBox(w * 0.36, 0.38, 0.42, mats.brushedMetal, 0, roofY + 0.28, hz);

  // Secondary condenser box + rooftop stair access bulkhead
  const bx = -hx * 0.85;
  batch.addBox(2.8, 2.25, 2.4, mats.commercialWalls[1], bx, roofY + 1.12, d * 0.14, {
    castShadow: true,
    uvMeters: 3.5,
  });
  batch.addBox(3.05, 0.22, 2.65, mats.darkChrome, bx, roofY + 2.32, d * 0.14);
  batch.addBox(0.95, 1.9, 0.12, mats.darkChrome, bx, roofY + 0.96, d * 0.14 + 1.22);

  // Twin rooftop exhaust pipe stacks
  for (let i = 0; i < 2; i++) {
    const px = -w * 0.3 + i * (w * 0.56);
    batch.addCylinder(0.18, 0.2, 1.15, 8, mats.brushedMetal, px, roofY + 0.58, -d * 0.28);
    batch.addCylinder(0.28, 0.28, 0.12, 8, mats.darkChrome, px, roofY + 1.18, -d * 0.28);
  }

  // Classic Los Angeles wooden stave water tower with iron bands & braced steel trestle
  if (includeWaterTower) {
    const wtX = -w * 0.26;
    const wtZ = -d * 0.22;
    for (const lx of [-0.95, 0.95]) {
      for (const lz of [-0.95, 0.95]) {
        batch.addBox(0.16, 2.35, 0.16, mats.darkChrome, wtX + lx, roofY + 1.18, wtZ + lz);
      }
    }
    // Cross-bracing struts
    batch.addBox(2.0, 0.1, 0.1, mats.darkChrome, wtX, roofY + 1.1, wtZ + 0.95, { rotZ: 0.65 });
    batch.addBox(2.0, 0.1, 0.1, mats.darkChrome, wtX, roofY + 1.1, wtZ - 0.95, { rotZ: -0.65 });
    batch.addBox(2.5, 0.18, 2.5, mats.darkChrome, wtX, roofY + 2.35, wtZ);
    batch.addCylinder(1.42, 1.48, 2.7, 14, mats.woodPorch, wtX, roofY + 3.75, wtZ, {
      castShadow: true,
    });
    // 3 dark iron tension hoops wrapping the cedar staves
    for (const hy of [2.95, 3.75, 4.55]) {
      batch.addCylinder(1.5, 1.5, 0.09, 14, mats.darkChrome, wtX, roofY + hy, wtZ);
    }
    const cone = new THREE.ConeGeometry(1.72, 1.35, 14);
    batch.addGeo(cone, mats.darkChrome, wtX, roofY + 5.75, wtZ, { castShadow: true });
  }
}

// ============================================================================
// 1. GROVE STREET & COASTAL HOUSES — 3 DISTINCT SOCAL RESIDENTIAL ARCHETYPES
// ============================================================================

function buildGroveHouseBatched(
  b: BuildingBlueprint,
  mats: HyperrealMaterialLibrary,
  batch: BuildingMeshBatcher,
): void {
  const h = hashId(b.id);
  // CJ's house is always the iconic 2-story Craftsman; others cycle across all 3 SoCal styles!
  const archetype =
    b.id === 'cj_house'
      ? 0
      : b.id === 'sweet_house' || b.id === 'grove_south_house_1' || b.id === 'beach_bungalow_e'
        ? 1
        : b.id === 'ryder_house' || b.id === 'grove_west_house' || b.id === 'beach_bungalow_w'
          ? 2
          : h % 3;

  const stuccoMat = mats.stuccoPalettes[b.paletteIndex % mats.stuccoPalettes.length];
  const clapMat = mats.clapboardPalettes[(b.paletteIndex + (h % 2)) % mats.clapboardPalettes.length];
  const shutterMat = mats.commercialWalls[(b.paletteIndex + 2) % mats.commercialWalls.length];

  if (archetype === 0) {
    // --- ARCHETYPE 0: Iconic 2-Story California Craftsman House (CJ's House!) ---
    const f1H = Math.max(3.3, b.h * 0.56);
    const f2H = Math.max(2.6, b.h * 0.44);

    // Stacked river-stone foundation plinth
    batch.addBox(b.w + 0.55, 0.58, b.d + 0.55, mats.stoneMasonry, 0, 0.29, 0, {
      uvMeters: 2.2,
    });

    // Lower story main volume (clapboard siding) + corner white Craftsman boards
    batch.addBox(b.w, f1H, b.d, clapMat, 0, 0.58 + f1H * 0.5, 0, {
      castShadow: true,
      uvMeters: 2.4,
    });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        batch.addBox(0.26, f1H + 0.08, 0.26, mats.trimPaintWhite, sx * (b.w * 0.5 - 0.04), 0.58 + f1H * 0.5, sz * (b.d * 0.5 - 0.04));
      }
    }

    // Mid-level horizontal belt fascia board separating 1st and 2nd story
    const f2BaseY = 0.58 + f1H;
    batch.addBox(b.w + 0.72, 0.28, b.d + 0.72, mats.trimPaintWhite, 0, f2BaseY, 0, { castShadow: true });

    // Upper 2nd-story stepped volume (recessed back cleanly to form upper sleeping balcony!)
    const uW = b.w * 0.78;
    const uD = b.d * 0.74;
    const uZ = -b.d * 0.1;
    batch.addBox(uW, f2H, uD, stuccoMat, 0, f2BaseY + f2H * 0.5, uZ, {
      castShadow: true,
      uvMeters: 3.2,
    });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        batch.addBox(0.22, f2H, 0.22, mats.trimPaintWhite, sx * (uW * 0.5 - 0.03), f2BaseY + f2H * 0.5, uZ + sz * (uD * 0.5 - 0.03));
      }
    }

    // Overhanging 2nd-story gable roof + crisp white bargeboards + exposed rafter tails
    const roofBaseY = f2BaseY + f2H;
    const roofRise = 2.35;
    batch.addBox(uW + 1.15, 0.22, uD + 1.15, mats.trimPaintWhite, 0, roofBaseY + 0.06, uZ);
    const mainRoof = makeGablePrismGeo(uW + 1.35, roofRise, uD + 1.35, 2.2);
    batch.addGeo(mainRoof, mats.roofTile, 0, roofBaseY + 0.12, uZ, { castShadow: true });
    // Triangular gable attic vent louver on front gable peak
    batch.addBox(0.95, 0.58, 0.24, mats.woodPorch, 0, roofBaseY + roofRise * 0.48, uZ + uD * 0.5 + 0.62);

    // Lower wraparound hipped porch skirt roof + front gable pediment over entry steps
    const lowerRoofLip = makeHipRoofGeo(b.w + 0.95, 0.95, b.d + 0.95, 2.4);
    batch.addGeo(lowerRoofLip, mats.roofTile, 0, f2BaseY + 0.08, 0, { castShadow: true });

    // Front Craftsman Porch Deck with Stone Piers, Tapered White Columns, Balustrade & Porch Steps
    const porchD = 2.65;
    const porchW = b.w * 0.76;
    const porchZ = b.d * 0.5 + porchD * 0.48;
    batch.addBox(porchW, 0.42, porchD, mats.woodPorch, 0, 0.34, porchZ, { uvMeters: 2.0 });
    batch.addBox(2.5, 0.22, 0.72, mats.sidewalk, 0, 0.11, b.d * 0.5 + porchD + 0.16);
    batch.addBox(2.5, 0.38, 0.42, mats.sidewalk, 0, 0.2, b.d * 0.5 + porchD - 0.2);

    // Porch pitched gable roof projecting forward over columns
    batch.addBox(porchW + 0.65, 0.22, porchD + 0.6, mats.trimPaintWhite, 0, f2BaseY - 0.12, porchZ);
    const porchGable = makeGablePrismGeo(porchW * 0.54, 1.25, porchD + 0.75, 2.0);
    batch.addGeo(porchGable, mats.roofTile, 0, f2BaseY - 0.02, porchZ + 0.06, { castShadow: true });

    const pierXs = [-porchW * 0.45, -porchW * 0.17, porchW * 0.17, porchW * 0.45];
    for (const px of pierXs) {
      // Stacked stone lower pier + tapered white Craftsman upper column
      batch.addBox(0.46, 1.05, 0.46, mats.stoneMasonry, px, 1.05, b.d * 0.5 + porchD * 0.86, { uvMeters: 1.5 });
      batch.addBox(0.52, 0.12, 0.52, mats.sidewalk, px, 1.6, b.d * 0.5 + porchD * 0.86);
      batch.addBox(0.24, f2BaseY - 1.72, 0.24, mats.trimPaintWhite, px, 1.66 + (f2BaseY - 1.72) * 0.5, b.d * 0.5 + porchD * 0.86, { castShadow: true });
    }
    // Porch railings + vertical pickets
    for (const side of [-1, 1]) {
      const rx = side * porchW * 0.31;
      const rw = porchW * 0.24;
      batch.addBox(rw, 0.09, 0.1, mats.trimPaintWhite, rx, 1.38, b.d * 0.5 + porchD * 0.86);
      batch.addBox(rw, 0.08, 0.08, mats.trimPaintWhite, rx, 0.68, b.d * 0.5 + porchD * 0.86);
      for (let p = -2; p <= 2; p++) {
        batch.addBox(0.055, 0.72, 0.055, mats.trimPaintWhite, rx + p * (rw * 0.2), 1.03, b.d * 0.5 + porchD * 0.86);
      }
    }

    // Paneled timber front door, glass transom, brass knob & glowing warm carriage lantern
    batch.addBox(1.58, 2.55, 0.18, mats.trimPaintWhite, 0, 1.82, b.d * 0.5 + 0.05);
    batch.addBox(1.26, 2.26, 0.22, mats.woodPorch, 0, 1.72, b.d * 0.5 + 0.07);
    batch.addBox(1.1, 0.48, 0.24, mats.interiorWindowResidential, 0, 2.48, b.d * 0.5 + 0.08);
    batch.addBox(0.1, 0.1, 0.16, mats.brassTrim, 0.44, 1.58, b.d * 0.5 + 0.19);
    batch.addBox(0.24, 0.38, 0.24, mats.warmLampGlow, 1.12, 2.58, b.d * 0.5 + 0.18);
    batch.addBox(0.3, 0.09, 0.3, mats.darkChrome, 1.12, 2.8, b.d * 0.5 + 0.18);

    // 1st & 2nd floor detailed 3D windows with shutters on front & both sides!
    addFramedWindow(batch, mats, {
      x: -b.w * 0.32, y: 2.25, z: b.d * 0.5, w: 1.75, h: 1.45,
      glassMat: mats.interiorWindowResidential, frameMat: mats.trimPaintWhite, shutterMat,
    });
    addFramedWindow(batch, mats, {
      x: b.w * 0.32, y: 2.25, z: b.d * 0.5, w: 1.75, h: 1.45,
      glassMat: mats.interiorWindowResidential, frameMat: mats.trimPaintWhite, shutterMat,
    });
    // 2nd-story centered Craftsman triple-pane bay window + side windows
    addFramedWindow(batch, mats, {
      x: -uW * 0.24, y: f2BaseY + f2H * 0.54, z: uZ + uD * 0.5, w: 1.45, h: 1.28,
      glassMat: mats.interiorWindowResidential, frameMat: mats.trimPaintWhite, shutterMat,
    });
    addFramedWindow(batch, mats, {
      x: uW * 0.24, y: f2BaseY + f2H * 0.54, z: uZ + uD * 0.5, w: 1.45, h: 1.28,
      glassMat: mats.interiorWindowResidential, frameMat: mats.trimPaintWhite, shutterMat,
    });
    for (const side of [-1, 1]) {
      addFramedWindow(batch, mats, {
        x: side * b.w * 0.5, y: 2.25, z: 0.4, rotY: side * Math.PI * 0.5, w: 1.65, h: 1.38,
        glassMat: mats.interiorWindowResidential, frameMat: mats.trimPaintWhite, shutterMat,
      });
      addFramedWindow(batch, mats, {
        x: side * uW * 0.5, y: f2BaseY + f2H * 0.54, z: uZ, rotY: side * Math.PI * 0.5, w: 1.38, h: 1.2,
        glassMat: mats.interiorWindowResidential, frameMat: mats.trimPaintWhite,
      });
    }

    // Tall exterior brick chimney with corbeled stone cap + exterior AC condenser unit
    const chimH = f1H + f2H + roofRise + 0.65;
    batch.addBox(1.18, chimH, 1.05, mats.commercialWalls[0], b.w * 0.5 - 0.12, 0.58 + chimH * 0.5, -b.d * 0.2, {
      castShadow: true,
      uvMeters: 2.4,
    });
    batch.addBox(1.42, 0.22, 1.28, mats.sidewalk, b.w * 0.5 - 0.12, 0.58 + chimH + 0.1, -b.d * 0.2);
    batch.addBox(0.95, 0.85, 0.85, mats.brushedMetal, -b.w * 0.5 - 0.48, 0.44, -b.d * 0.26);
    batch.addCylinder(0.32, 0.32, 0.08, 10, mats.darkChrome, -b.w * 0.5 - 0.48, 0.89, -b.d * 0.26);
  } else if (archetype === 1) {
    // --- ARCHETYPE 1: Spanish Colonial Revival Stucco Hacienda ---
    const wallH = Math.max(3.8, b.h * 0.74);

    // Stone base skirt + hand-troweled California stucco walls
    batch.addBox(b.w + 0.44, 0.52, b.d + 0.44, mats.stoneMasonry, 0, 0.26, 0, { uvMeters: 2.4 });
    batch.addBox(b.w, wallH, b.d, stuccoMat, 0, 0.52 + wallH * 0.5, 0, {
      castShadow: true,
      uvMeters: 3.4,
    });

    // Iconic scalloped Mission Revival front parapet pediment + terracotta barrel-tile hip roof!
    const roofBaseY = 0.52 + wallH;
    batch.addBox(b.w + 0.85, 0.24, b.d + 0.85, mats.woodPorch, 0, roofBaseY + 0.06, 0);
    const hipRoof = makeHipRoofGeo(b.w + 1.05, b.h * 0.36, b.d + 1.05, 2.2);
    batch.addGeo(hipRoof, mats.terracottaTile, 0, roofBaseY + 0.12, 0, { castShadow: true });

    const missionPed = makeMissionPedimentGeo(b.w * 0.56, 1.85, 0.42);
    batch.addGeo(missionPed, stuccoMat, 0, roofBaseY - 0.06, b.d * 0.5 + 0.04, { castShadow: true });
    // Decorative terracotta coping cap along pediment top & dark wood roof beam ends (vigas)
    for (let v = -3; v <= 3; v++) {
      batch.addBox(0.16, 0.18, 0.65, mats.woodPorch, v * (b.w * 0.13), roofBaseY - 0.28, b.d * 0.5 + 0.22);
    }

    // Covered Spanish Portico Porch with Thick Stucco Columns, Terracotta Shed Roof & Timber Pergola
    const porchD = 2.45;
    const porchW = b.w * 0.68;
    const porchZ = b.d * 0.5 + porchD * 0.48;
    batch.addBox(porchW, 0.36, porchD, mats.terracottaTile, 0, 0.24, porchZ, { uvMeters: 1.6 });
    batch.addBox(2.2, 0.18, 0.65, mats.sidewalk, 0, 0.09, b.d * 0.5 + porchD + 0.12);

    // Sloped terracotta tile portico canopy
    batch.addBox(porchW + 0.55, 0.26, porchD + 0.55, mats.terracottaTile, 0, 3.32, porchZ, {
      rotX: 0.18,
      castShadow: true,
      uvMeters: 1.8,
    });
    for (const px of [-porchW * 0.44, -porchW * 0.18, porchW * 0.18, porchW * 0.44]) {
      batch.addBox(0.38, 2.88, 0.38, stuccoMat, px, 1.82, b.d * 0.5 + porchD * 0.84, { castShadow: true });
      batch.addBox(0.48, 0.16, 0.48, mats.woodPorch, px, 3.16, b.d * 0.5 + porchD * 0.84);
    }
    // Wrought-iron courtyard gate railings
    for (const side of [-1, 1]) {
      batch.addBox(porchW * 0.22, 0.06, 0.06, mats.darkChrome, side * porchW * 0.31, 1.15, b.d * 0.5 + porchD * 0.84);
      batch.addBox(porchW * 0.22, 0.06, 0.06, mats.darkChrome, side * porchW * 0.31, 0.58, b.d * 0.5 + porchD * 0.84);
    }

    // Heavy Spanish Dark-Timber Entry Door + Twin Warm Wall Sconces
    batch.addBox(1.56, 2.48, 0.22, mats.woodPorch, 0, 1.66, b.d * 0.5 + 0.05);
    batch.addBox(0.1, 0.22, 0.14, mats.darkChrome, 0.46, 1.56, b.d * 0.5 + 0.18);
    for (const sx of [-1.05, 1.05]) {
      batch.addBox(0.22, 0.34, 0.22, mats.warmLampGlow, sx, 2.45, b.d * 0.5 + 0.16);
      batch.addBox(0.28, 0.08, 0.28, mats.darkChrome, sx, 2.65, b.d * 0.5 + 0.16);
    }

    // Deep recessed Spanish windows with wrought-iron security grilles & terracotta mini-hoods
    for (const wx of [-b.w * 0.32, b.w * 0.32]) {
      addFramedWindow(batch, mats, {
        x: wx, y: 2.25, z: b.d * 0.5, w: 1.68, h: 1.45,
        glassMat: mats.interiorWindowResidential, frameMat: mats.woodPorch,
        sillMat: mats.terracottaTile, withGrille: true, withAwningHood: mats.terracottaTile,
      });
    }
    for (const side of [-1, 1]) {
      addFramedWindow(batch, mats, {
        x: side * b.w * 0.5, y: 2.25, z: 0.6, rotY: side * Math.PI * 0.5, w: 1.65, h: 1.4,
        glassMat: mats.interiorWindowResidential, frameMat: mats.woodPorch, withGrille: true,
      });
      addFramedWindow(batch, mats, {
        x: side * b.w * 0.5, y: 2.25, z: -2.6, rotY: side * Math.PI * 0.5, w: 1.45, h: 1.32,
        glassMat: mats.interiorWindowResidential, frameMat: mats.woodPorch, withGrille: true,
      });
    }

    // Stucco Chimney with Tiled Bonnet Cap
    batch.addBox(1.15, b.h * 0.55, 1.15, stuccoMat, -b.w * 0.28, roofBaseY + b.h * 0.22, -b.d * 0.16, { castShadow: true });
    batch.addBox(1.45, 0.24, 1.45, mats.terracottaTile, -b.w * 0.28, roofBaseY + b.h * 0.52, -b.d * 0.16);
  } else {
    // --- ARCHETYPE 2: Cross-Gabled SoCal Ranch Craftsman Bungalow (L-Shaped Stepped Footprint!) ---
    const wallH = Math.max(3.6, b.h * 0.72);
    const roofBaseY = 0.52 + wallH;

    // Stacked stone wainscoting base wrapping lower 1.25m of entire house
    batch.addBox(b.w + 0.38, 1.25, b.d + 0.38, mats.stoneMasonry, 0, 0.625, 0, { uvMeters: 2.0 });
    batch.addBox(b.w + 0.48, 0.14, b.d + 0.48, mats.sidewalk, 0, 1.28, 0);

    // Main horizontal wing (clapboard) + protruding front cross-gable wing on left!
    const mainD = b.d * 0.78;
    const mainZ = -b.d * 0.11;
    batch.addBox(b.w, wallH - 0.7, mainD, clapMat, 0, 1.25 + (wallH - 0.7) * 0.5, mainZ, {
      castShadow: true,
      uvMeters: 2.4,
    });

    const wingW = b.w * 0.52;
    const wingX = -b.w * 0.24;
    batch.addBox(wingW, wallH - 0.7, b.d, clapMat, wingX, 1.25 + (wallH - 0.7) * 0.5, 0, {
      castShadow: true,
      uvMeters: 2.4,
    });

    // Main ridge gable roof running Left-Right (rotated 90°) + Intersecting Front Cross-Gable!
    const mainGable = makeGablePrismGeo(mainD + 1.1, 2.25, b.w + 1.15, 2.2);
    batch.addGeo(mainGable, mats.roofTile, 0, roofBaseY + 0.04, mainZ, {
      rotY: Math.PI * 0.5,
      castShadow: true,
    });
    const frontGable = makeGablePrismGeo(wingW + 1.15, 2.15, b.d + 1.1, 2.2);
    batch.addGeo(frontGable, mats.roofTile, wingX, roofBaseY + 0.04, 0.08, {
      castShadow: true,
    });

    // Crisp white fascia trim boards + gable attic vent + decorative Craftsman knee-braces
    batch.addBox(b.w + 1.1, 0.22, mainD + 1.05, mats.trimPaintWhite, 0, roofBaseY, mainZ);
    batch.addBox(0.88, 0.55, 0.22, mats.woodPorch, wingX, roofBaseY + 1.05, b.d * 0.5 + 0.52);

    // Protruding 3-Sided Craftsman Bay Window on front gable wing with crisp white mullions
    const bayZ = b.d * 0.5 + 0.42;
    const bayW = wingW * 0.68;
    const bayGlassW = wingW * 0.58;
    batch.addBox(bayW, 2.15, 0.72, mats.trimPaintWhite, wingX, 2.05, bayZ);
    batch.addBox(bayGlassW, 1.38, 0.78, mats.interiorWindowResidential, wingX, 2.22, bayZ + 0.02);
    // Crisp Craftsman casement mullions & horizontal transom bar on bay window
    for (const mx of [-bayGlassW * 0.22, bayGlassW * 0.22]) {
      batch.addBox(0.09, 1.44, 0.84, mats.trimPaintWhite, wingX + mx, 2.22, bayZ + 0.03);
    }
    batch.addBox(bayGlassW + 0.08, 0.08, 0.84, mats.trimPaintWhite, wingX, 2.52, bayZ + 0.03);
    batch.addBox(wingW * 0.78, 0.26, 0.96, mats.roofTile, wingX, 3.24, bayZ + 0.04, { rotX: 0.22 });

    // Inset Covered Front Entry Porch tucked cleanly into the L-corner on right!
    const porchW = b.w * 0.46;
    const porchX = b.w * 0.26;
    const porchD = b.d * 0.32 + 1.2;
    const porchZ = mainZ + mainD * 0.5 + porchD * 0.48;
    batch.addBox(porchW, 0.4, porchD, mats.woodPorch, porchX, 0.26, porchZ, { uvMeters: 2.0 });
    batch.addBox(porchW + 0.45, 0.22, porchD + 0.45, mats.roofTile, porchX, 3.38, porchZ, { rotX: 0.14, castShadow: true });
    for (const px of [porchX - porchW * 0.42, porchX + porchW * 0.42]) {
      batch.addBox(0.38, 0.92, 0.38, mats.stoneMasonry, px, 0.92, porchZ + porchD * 0.42);
      batch.addBox(0.2, 2.0, 0.2, mats.trimPaintWhite, px, 2.38, porchZ + porchD * 0.42);
    }
    // Entry door + porch lantern
    const entryZ = mainZ + mainD * 0.5;
    batch.addBox(1.42, 2.38, 0.18, mats.woodPorch, porchX, 1.68, entryZ + 0.06);
    batch.addBox(0.22, 0.34, 0.22, mats.warmLampGlow, porchX + 0.92, 2.48, entryZ + 0.16);

    // Side windows + Brick Chimney + AC Unit
    for (const side of [-1, 1]) {
      addFramedWindow(batch, mats, {
        x: side * b.w * 0.5, y: 2.32, z: mainZ, rotY: side * Math.PI * 0.5, w: 1.72, h: 1.38,
        glassMat: mats.interiorWindowResidential, frameMat: mats.trimPaintWhite, shutterMat,
      });
    }
    batch.addBox(1.12, wallH + 2.5, 1.05, mats.commercialWalls[0], -b.w * 0.5 - 0.18, 0.5 + (wallH + 2.5) * 0.5, mainZ - 0.4, {
      castShadow: true,
      uvMeters: 2.4,
    });
    batch.addBox(1.38, 0.2, 1.32, mats.sidewalk, -b.w * 0.5 - 0.18, 0.5 + wallH + 2.6, mainZ - 0.4);
    batch.addBox(0.92, 0.82, 0.82, mats.brushedMetal, b.w * 0.5 + 0.46, 0.42, mainZ - 1.4);
  }
}

// ============================================================================
// 2. COMMERCIAL STOREFRONTS — 4 UNMISTAKABLE LOS SANTOS RETAIL ARCHETYPES
// ============================================================================

function addWalkInGroundShell(
  batch: BuildingMeshBatcher,
  b: BuildingBlueprint,
  wallMat: THREE.Material,
  plinthMat: THREE.Material,
  splitCeilingY = 3.68,
): void {
  const prof = getWalkInShopRoomProfile(b);
  const halfBW = b.w * 0.5;
  const halfBD = b.d * 0.5;
  const roomH = Math.min(b.h, splitCeilingY);

  // Rear solid mass behind walk-in interior (lz in [-halfBD, prof.roomBackZ])
  const rearD = prof.roomBackZ - -halfBD;
  if (rearD > 0.2) {
    batch.addBox(b.w, roomH, rearD, wallMat, 0, roomH * 0.5, -halfBD + rearD * 0.5, {
      castShadow: true,
      uvMeters: 3.4,
    });
    batch.addBox(b.w + 0.28, 0.62, rearD + 0.12, plinthMat, 0, 0.31, -halfBD + rearD * 0.5, {
      uvMeters: 2.2,
    });
  }

  // Left & Right wing walls beside the 9.6m walk-in showroom
  const wingW = Math.max(0.4, halfBW - prof.roomHalfW);
  const sideD = halfBD - prof.roomBackZ;
  const sideCenterZ = prof.roomBackZ + sideD * 0.5;
  for (const side of [-1, 1]) {
    const cx = side * (prof.roomHalfW + wingW * 0.5);
    batch.addBox(wingW, roomH, sideD, wallMat, cx, roomH * 0.5, sideCenterZ, {
      castShadow: true,
      uvMeters: 3.4,
    });
    batch.addBox(wingW + 0.16, 0.62, sideD + 0.14, plinthMat, cx, 0.31, sideCenterZ, {
      uvMeters: 2.2,
    });
  }

  // Full upper-story volume above ceiling height
  const upperH = b.h - roomH;
  if (upperH > 0.2) {
    batch.addBox(b.w, upperH, b.d, wallMat, 0, roomH + upperH * 0.5, 0, {
      castShadow: true,
      uvMeters: 3.4,
    });
  }
}

function buildCommercialBatched(
  b: BuildingBlueprint,
  mats: HyperrealMaterialLibrary,
  batch: BuildingMeshBatcher,
): void {
  const h = hashId(b.id);
  const wallMat = mats.commercialWalls[b.paletteIndex % mats.commercialWalls.length];
  const awningMat = mats.awningPalettes[(b.paletteIndex + (h % 3)) % mats.awningPalettes.length];
  const walkIn = WALK_IN_BUILDING_IDS.has(b.id);
  const walkProf = walkIn ? getWalkInShopRoomProfile(b) : null;

  // Assign purposeful architectural archetype matching each Los Santos business!
  const isDiner =
    b.id === 'cluckin_bell' ||
    b.id === 'west_commerce_2' ||
    b.id === 'beach_diner_east' ||
    b.id === 'idlewood_south_1';
  const isGarage =
    b.id === 'ls_customs_garage' ||
    b.id === 'las_colinas_lofts_2' ||
    b.id === 'ammunation_east';
  const isModernist =
    b.id === 'vinewood_suburban' ||
    b.id === 'beach_pavilion_west';

  if (isDiner) {
    // --- ARCHETYPE A: Mid-Century California Googie Diner / Fast-Food Pavilion ---
    const mainH = Math.min(b.h, 6.2);
    if (walkIn && walkProf) {
      addWalkInGroundShell(batch, { ...b, h: mainH }, wallMat, mats.stoneMasonry, 3.68);
    } else {
      // Ceramic/stone lower bulkhead wall + crisp plaster upper body
      batch.addBox(b.w + 0.24, 1.15, b.d + 0.24, mats.stoneMasonry, 0, 0.575, 0, { uvMeters: 2.2 });
      batch.addBox(b.w, mainH - 1.15, b.d, wallMat, 0, 1.15 + (mainH - 1.15) * 0.5, 0, {
        castShadow: true,
        uvMeters: 3.6,
      });
    }

    // Iconic Sweeping Cantilevered Upswept Googie Wing Roof + Polished Chrome Fascia Edge!
    const wingRoof = makeGoogieWingRoofGeo(b.w + 2.4, b.d + 0.8, 1.55, 0.48);
    batch.addGeo(wingRoof, mats.trimPaintWhite, 0, mainH - 0.12, 0.1, { castShadow: true });
    // Glowing chrome + neon fascia trim band across the cantilevered front eave
    batch.addBox(b.w + 2.52, 0.24, 0.22, mats.brushedMetal, 0, mainH + 1.56, b.d * 0.5 + 2.52);
    batch.addBox(b.w + 2.48, 0.14, 0.16, mats.warmLampGlow, 0, mainH + 1.38, b.d * 0.5 + 2.54);

    // Tapered angled Googie V-strut steel columns supporting the cantilevered front roof!
    for (const sx of [-b.w * 0.44, b.w * 0.44]) {
      batch.addCylinder(0.12, 0.16, mainH + 1.1, 8, mats.brushedMetal, sx, (mainH + 1.1) * 0.5, b.d * 0.5 + 1.95, {
        rotX: 0.12,
        castShadow: true,
      });
    }

    // Wraparound Floor-to-Ceiling Recessed Interior-Mapped Diner Glazing (flank wings when walk-in!)
    if (walkIn && walkProf) {
      const flankSpan = Math.max(1.2, b.w * 0.5 - walkProf.roomHalfW - 0.8);
      const flankX = walkProf.roomHalfW + 0.4 + flankSpan * 0.5;
      for (const side of [-1, 1]) {
        batch.addBox(flankSpan, 2.85, 0.16, mats.interiorWindowStore, side * flankX, 2.25, b.d * 0.5 + 0.04);
        batch.addBox(0.11, 2.96, 0.24, mats.brushedMetal, side * (walkProf.roomHalfW + 0.2), 2.25, b.d * 0.5 + 0.08);
        batch.addBox(0.11, 2.96, 0.24, mats.brushedMetal, side * (b.w * 0.46), 2.25, b.d * 0.5 + 0.08);
      }
      batch.addBox(b.w * 0.9, 0.14, 0.24, mats.brushedMetal, 0, 3.74, b.d * 0.5 + 0.08);
    } else {
      batch.addBox(b.w * 0.86, 2.85, 0.16, mats.interiorWindowStore, 0, 2.52, b.d * 0.5 + 0.04);
      const bays = Math.max(4, Math.round(b.w / 3.4));
      for (let i = 0; i <= bays; i++) {
        const mx = -b.w * 0.43 + (i / bays) * b.w * 0.86;
        batch.addBox(0.11, 2.96, 0.24, mats.brushedMetal, mx, 2.52, b.d * 0.5 + 0.08);
      }
      batch.addBox(b.w * 0.88, 0.14, 0.24, mats.brushedMetal, 0, 3.96, b.d * 0.5 + 0.08);
    }
    for (const side of [-1, 1]) {
      batch.addBox(0.16, 2.85, b.d * 0.46, mats.interiorWindowStore, side * (b.w * 0.5 + 0.04), 2.52, b.d * 0.22);
    }

    // Recessed warm soffit downlights under cantilevered roof overhang
    for (let l = -2; l <= 2; l++) {
      batch.addCylinder(0.24, 0.24, 0.08, 8, mats.warmLampGlow, l * (b.w * 0.19), mainH + 0.92, b.d * 0.5 + 1.45);
    }

    // Commercial Stainless Kitchen Exhaust Hood + Rooftop Steel Sign Truss
    batch.addBox(2.6, 1.4, 2.2, mats.brushedMetal, -b.w * 0.25, mainH + 1.2, -b.d * 0.15);
    batch.addCylinder(0.45, 0.55, 0.95, 10, mats.brushedMetal, b.w * 0.26, mainH + 1.1, -b.d * 0.2);

    if (b.signText) {
      const signW = Math.min(b.w * 0.78, 12.2);
      const signY = mainH + 2.85;
      for (const sx of [-signW * 0.34, signW * 0.34]) {
        batch.addCylinder(0.11, 0.14, 1.9, 8, mats.darkChrome, sx, mainH + 1.6, b.d * 0.5 + 1.35);
      }
      batch.addBox(signW + 0.38, 2.38, 0.42, mats.darkChrome, 0, signY, b.d * 0.5 + 1.35);
      const signMat = mats.createSignMaterial(b.signText, b.signColor ?? '#ffaa22');
      batch.addDirectMesh(new THREE.BoxGeometry(signW, 2.08, 0.46), signMat, 0, signY, b.d * 0.5 + 1.35);
    }
  } else if (isGarage) {
    // --- ARCHETYPE B: Industrial Roll-Up Garage / LS Customs / Ammu-Nation Bunker ---
    if (walkIn && walkProf) {
      addWalkInGroundShell(batch, b, wallMat, mats.darkChrome, 3.68);
    } else {
      batch.addBox(b.w + 0.34, 0.75, b.d + 0.34, mats.darkChrome, 0, 0.375, 0);
      batch.addBox(b.w, b.h, b.d, wallMat, 0, b.h * 0.5, 0, {
        castShadow: true,
        uvMeters: 3.4,
      });
    }

    // Corrugated steel upper mechanical clerestory & heavy steel parapet coping
    batch.addBox(b.w + 0.58, 0.5, b.d + 0.58, mats.darkChrome, 0, b.h + 0.15, 0, { castShadow: true });
    batch.addBox(b.w * 0.88, 1.45, b.d * 0.64, mats.corrugatedMetal, 0, b.h + 0.95, -b.d * 0.08, {
      castShadow: true,
      uvMeters: 2.6,
    });

    if (walkIn && walkProf) {
      // Flank architectural industrial details on the solid side piers outside the central 9.6m doorway
      const wingSpan = Math.max(1.2, b.w * 0.5 - walkProf.roomHalfW - 0.8);
      const leftX = -(walkProf.roomHalfW + 0.4 + wingSpan * 0.5);
      const rightX = walkProf.roomHalfW + 0.4 + wingSpan * 0.5;

      batch.addBox(wingSpan, 3.4, 0.2, mats.corrugatedMetal, leftX, 1.85, b.d * 0.5 + 0.05, { uvMeters: 2.2 });
      batch.addBox(wingSpan + 0.25, 0.28, 0.95, mats.darkChrome, leftX, 3.74, b.d * 0.5 + 0.42, { castShadow: true });

      batch.addBox(wingSpan, 2.85, 0.16, mats.interiorWindowStore, rightX, 1.9, b.d * 0.5 + 0.05);
      batch.addBox(wingSpan + 0.25, 0.24, 1.15, mats.darkChrome, rightX, 3.65, b.d * 0.5 + 0.52, { castShadow: true });

      for (const bx of [-walkProf.roomHalfW - 0.18, walkProf.roomHalfW + 0.18]) {
        batch.addBox(0.36, b.h, 0.34, mats.darkChrome, bx, b.h * 0.5, b.d * 0.5 + 0.09);
        batch.addCylinder(0.11, 0.11, 1.05, 8, mats.brassTrim, bx, 0.54, b.d * 0.5 + 0.72);
      }
    } else {
      // Heavy structural steel I-beam pilasters dividing service bays
      const bayCount = b.w >= 21 ? 3 : 2;
      const serviceSpanW = b.w * 0.62;
      const bayStartX = -b.w * 0.44;
      const bayW = serviceSpanW / bayCount;

      for (let i = 0; i < bayCount; i++) {
        const bx = bayStartX + (i + 0.5) * bayW;
        batch.addBox(bayW - 0.35, 3.65, 0.24, mats.darkChrome, bx, 1.88, b.d * 0.5 + 0.04);
        batch.addBox(bayW - 0.65, 3.38, 0.18, mats.corrugatedMetal, bx, 1.76, b.d * 0.5 + 0.08, {
          uvMeters: 2.2,
        });
        batch.addBox(bayW - 0.2, 0.32, 0.92, mats.darkChrome, bx, 3.88, b.d * 0.5 + 0.38, { castShadow: true });
        batch.addBox(0.65, 0.16, 0.24, mats.warmLampGlow, bx, 3.66, b.d * 0.5 + 0.62);
      }

      for (let i = 0; i <= bayCount; i++) {
        const px = bayStartX + i * bayW;
        batch.addBox(0.42, b.h, 0.34, mats.darkChrome, px, b.h * 0.5, b.d * 0.5 + 0.09);
        batch.addCylinder(0.11, 0.11, 1.05, 8, mats.brassTrim, px, 0.54, b.d * 0.5 + 0.72);
        batch.addCylinder(0.115, 0.115, 0.16, 8, mats.darkChrome, px, 1.05, b.d * 0.5 + 0.72);
      }

      const shopW = b.w * 0.28;
      const shopX = b.w * 0.32;
      batch.addBox(shopW, 2.85, 0.16, mats.interiorWindowStore, shopX, 1.9, b.d * 0.5 + 0.05);
      batch.addBox(shopW + 0.28, 0.24, 1.45, mats.darkChrome, shopX, 3.55, b.d * 0.5 + 0.68, { castShadow: true });
      batch.addBox(0.12, 2.95, 0.24, mats.darkChrome, shopX - shopW * 0.5, 1.9, b.d * 0.5 + 0.09);
      batch.addBox(0.12, 2.95, 0.24, mats.darkChrome, shopX + shopW * 0.5, 1.9, b.d * 0.5 + 0.09);
    }

    // Side industrial clerestory windows + external galvanized conduit pipes
    for (const side of [-1, 1]) {
      for (const sz of [-b.d * 0.25, b.d * 0.2]) {
        addFramedWindow(batch, mats, {
          x: side * b.w * 0.5, y: b.h * 0.64, z: sz, rotY: side * Math.PI * 0.5,
          w: 2.6, h: 1.25, glassMat: mats.interiorWindowOffice, frameMat: mats.darkChrome,
        });
      }
      batch.addCylinder(0.08, 0.08, b.h, 8, mats.brushedMetal, side * (b.w * 0.5 + 0.08), b.h * 0.5, -b.d * 0.36);
    }

    addRooftopMechanicals(batch, mats, b.h + 0.35, b.w, b.d, h, false);

    if (b.signText) {
      const signW = Math.min(b.w * 0.82, 12.6);
      const signY = Math.min(b.h - 1.15, 6.4);
      batch.addBox(signW + 0.42, 2.45, 0.44, mats.darkChrome, 0, signY, b.d * 0.5 + 0.26);
      const signMat = mats.createSignMaterial(b.signText, b.signColor ?? '#ff7b29');
      batch.addDirectMesh(new THREE.BoxGeometry(signW, 2.1, 0.48), signMat, 0, signY, b.d * 0.5 + 0.28);
    }
  } else if (isModernist) {
    // --- ARCHETYPE D: Rodeo / Coastal Modernist Boutique (Timber Brise-Soleil & Glass Showroom) ---
    if (walkIn && walkProf) {
      addWalkInGroundShell(batch, b, wallMat, mats.stoneMasonry, 3.68);
    } else {
      batch.addBox(b.w + 0.28, 0.55, b.d + 0.28, mats.stoneMasonry, 0, 0.275, 0, { uvMeters: 2.6 });
      batch.addBox(b.w, b.h, b.d, wallMat, 0, b.h * 0.5, 0, {
        castShadow: true,
        uvMeters: 3.4,
      });
    }

    // Dramatic travertine stone vertical feature fin framing the entrance asymmetrically (at -6.8m, clear of doorway!)
    const finX = -b.w * 0.34;
    batch.addBox(2.35, b.h + 1.35, 1.25, mats.mazeBankMarble, finX, (b.h + 1.35) * 0.5, b.d * 0.5 + 0.32, {
      castShadow: true,
      uvMeters: 3.0,
    });

    // Cantilevered Architectural Timber-Slat Brise-Soleil Pergola Canopy over double-height showroom!
    const canW = b.w * 0.72;
    const canX = b.w * 0.1;
    const canY = 4.15;
    batch.addBox(canW, 0.24, 2.35, mats.darkChrome, canX, canY, b.d * 0.5 + 1.15, { castShadow: true });
    const slats = 11;
    for (let s = 0; s < slats; s++) {
      const sx = canX - canW * 0.46 + (s / (slats - 1)) * canW * 0.92;
      batch.addBox(0.14, 0.32, 2.42, mats.woodPorch, sx, canY + 0.14, b.d * 0.5 + 1.18);
    }

    if (walkIn && walkProf) {
      // Right-wing showroom glass window clear of the central walk-in glass storefront
      const flankSpan = Math.max(1.2, b.w * 0.5 - walkProf.roomHalfW - 0.8);
      const rightX = walkProf.roomHalfW + 0.4 + flankSpan * 0.5;
      batch.addBox(flankSpan, 3.2, 0.16, mats.interiorWindowStore, rightX, 1.95, b.d * 0.5 + 0.04);
      batch.addBox(0.1, 3.3, 0.24, mats.darkChrome, walkProf.roomHalfW + 0.18, 1.95, b.d * 0.5 + 0.08);
      batch.addBox(0.1, 3.3, 0.24, mats.darkChrome, b.w * 0.46, 1.95, b.d * 0.5 + 0.08);
    } else {
      batch.addBox(b.w * 0.72, 3.45, 0.16, mats.interiorWindowStore, b.w * 0.1, 2.05, b.d * 0.5 + 0.04);
      for (let m = 0; m <= 4; m++) {
        const mx = -b.w * 0.25 + (m / 4) * b.w * 0.7;
        batch.addBox(0.09, 3.55, 0.24, mats.darkChrome, mx, 2.05, b.d * 0.5 + 0.08);
      }
    }
    batch.addBox(0.16, 3.45, b.d * 0.52, mats.interiorWindowStore, b.w * 0.5 + 0.04, 2.05, b.d * 0.18);

    // Upper ribbon window with cantilevered brushed-steel sun-shade louver
    if (b.h >= 7.2) {
      const upY = b.h - 2.05;
      batch.addBox(b.w * 0.66, 1.55, 0.16, mats.interiorWindowOffice, b.w * 0.12, upY, b.d * 0.5 + 0.05);
      batch.addBox(b.w * 0.72, 0.16, 0.92, mats.brushedMetal, b.w * 0.12, upY + 0.92, b.d * 0.5 + 0.44, { castShadow: true });
    }

    // Clean stepped architectural rooftop coping + wood-clad terrace screen
    batch.addBox(b.w + 0.52, 0.42, b.d + 0.52, mats.trimPaintWhite, 0, b.h + 0.16, 0);
    addRooftopMechanicals(batch, mats, b.h + 0.35, b.w, b.d, h, false);

    if (b.signText) {
      const signW = Math.min(b.w * 0.68, 10.8);
      const signY = Math.min(b.h - 0.55, 5.45);
      batch.addBox(signW + 0.26, 1.95, 0.36, mats.darkChrome, b.w * 0.1, signY, b.d * 0.5 + 0.22);
      const signMat = mats.createSignMaterial(b.signText, b.signColor ?? '#58e090');
      batch.addDirectMesh(new THREE.BoxGeometry(signW, 1.72, 0.4), signMat, b.w * 0.1, signY, b.d * 0.5 + 0.24);
    }
  } else {
    // --- ARCHETYPE C: Historic Los Santos Brick Main-Street Corner Block (24/7, Binco, Ganton Gym) ---
    if (walkIn && walkProf) {
      addWalkInGroundShell(batch, b, wallMat, mats.stoneMasonry, 3.68);
    } else {
      batch.addBox(b.w + 0.36, 0.68, b.d + 0.36, mats.stoneMasonry, 0, 0.34, 0, { uvMeters: 2.2 });
      batch.addBox(b.w, b.h, b.d, wallMat, 0, b.h * 0.5, 0, {
        castShadow: true,
        uvMeters: 3.2,
      });
    }

    // Ornamental stepped cornice + dentil molding + raised central historic parapet pediment!
    batch.addBox(b.w + 0.78, 0.44, b.d + 0.78, mats.trimPaintWhite, 0, b.h - 0.08, 0, { castShadow: true });
    batch.addBox(b.w + 0.48, 0.82, b.d + 0.48, wallMat, 0, b.h + 0.46, 0, { castShadow: true, uvMeters: 3.2 });
    batch.addBox(b.w * 0.46, 1.05, 0.52, wallMat, 0, b.h + 1.28, b.d * 0.5 + 0.05, { uvMeters: 3.0 });
    batch.addBox(b.w * 0.5, 0.22, 0.66, mats.trimPaintWhite, 0, b.h + 1.84, b.d * 0.5 + 0.05);

    // Brick pilasters with carved limestone capitals along front facade
    if (walkIn && walkProf) {
      for (const px of [-b.w * 0.46, -walkProf.roomHalfW - 0.22, walkProf.roomHalfW + 0.22, b.w * 0.46]) {
        batch.addBox(0.52, b.h, 0.34, wallMat, px, b.h * 0.5, b.d * 0.5 + 0.1, { uvMeters: 3.0 });
        batch.addBox(0.68, 0.34, 0.46, mats.trimPaintWhite, px, b.h - 0.35, b.d * 0.5 + 0.14);
        batch.addBox(0.62, 0.28, 0.42, mats.trimPaintWhite, px, 3.85, b.d * 0.5 + 0.12);
      }
    } else {
      const pilCount = Math.max(4, Math.round(b.w / 4.8));
      for (let i = 0; i < pilCount; i++) {
        const px = -b.w * 0.48 + (i / (pilCount - 1)) * b.w * 0.96;
        batch.addBox(0.52, b.h, 0.34, wallMat, px, b.h * 0.5, b.d * 0.5 + 0.1, { uvMeters: 3.0 });
        batch.addBox(0.68, 0.34, 0.46, mats.trimPaintWhite, px, b.h - 0.35, b.d * 0.5 + 0.14);
        batch.addBox(0.62, 0.28, 0.42, mats.trimPaintWhite, px, 3.85, b.d * 0.5 + 0.12);
      }
    }

    // Color-matched Sloped Fabric Awning with Side Gussets & Angled Steel Tension Rods
    batch.addBox(b.w * 0.88, 0.22, 2.08, awningMat, 0, 3.68, b.d * 0.5 + 0.96, {
      rotX: 0.22,
      castShadow: true,
    });
    batch.addBox(b.w * 0.88, 0.36, 0.08, awningMat, 0, 3.36, b.d * 0.5 + 1.98);
    for (const rx of [-b.w * 0.38, 0, b.w * 0.38]) {
      batch.addCylinder(0.032, 0.032, 2.15, 6, mats.darkChrome, rx, 4.22, b.d * 0.5 + 0.9, { rotX: 0.95 });
    }

    // Recessed Interior-Mapped Glass Storefront (flank wings only when walk-in!)
    if (walkIn && walkProf) {
      const flankSpan = Math.max(1.2, b.w * 0.5 - walkProf.roomHalfW - 0.85);
      const flankX = walkProf.roomHalfW + 0.45 + flankSpan * 0.5;
      for (const side of [-1, 1]) {
        batch.addBox(flankSpan, 2.68, 0.16, mats.interiorWindowStore, side * flankX, 1.92, b.d * 0.5 + 0.04);
        batch.addBox(flankSpan + 0.1, 0.14, 0.24, mats.darkChrome, side * flankX, 3.28, b.d * 0.5 + 0.08);
      }
    } else {
      batch.addBox(b.w * 0.82, 2.68, 0.16, mats.interiorWindowStore, 0, 1.92, b.d * 0.5 + 0.04);
      const mullCount = Math.max(4, Math.round(b.w / 3.2));
      for (let m = 0; m <= mullCount; m++) {
        const mx = -b.w * 0.41 + (m / mullCount) * b.w * 0.82;
        batch.addBox(0.11, 2.78, 0.24, mats.darkChrome, mx, 1.92, b.d * 0.5 + 0.08);
      }
      batch.addBox(b.w * 0.84, 0.14, 0.24, mats.darkChrome, 0, 3.28, b.d * 0.5 + 0.08);
    }

    // Side display & upper office windows
    for (const side of [-1, 1]) {
      addFramedWindow(batch, mats, {
        x: side * b.w * 0.5, y: 2.15, z: b.d * 0.22, rotY: side * Math.PI * 0.5,
        w: 2.8, h: 2.1, glassMat: mats.interiorWindowStore, frameMat: mats.darkChrome,
      });
      if (b.h >= 7.0) {
        addFramedWindow(batch, mats, {
          x: side * b.w * 0.5, y: b.h - 2.1, z: -b.d * 0.15, rotY: side * Math.PI * 0.5,
          w: 1.85, h: 1.48, glassMat: mats.interiorWindowOffice, frameMat: mats.darkChrome,
          sillMat: mats.trimPaintWhite, withKeystone: true,
        });
      }
      batch.addCylinder(0.075, 0.075, b.h, 8, mats.brushedMetal, side * (b.w * 0.5 + 0.06), b.h * 0.5, -b.d * 0.38);
    }

    // Upper-story 3D recessed office windows with stone keystones & box ACs
    if (b.h >= 7.0) {
      const upperWins = Math.max(2, Math.floor(b.w / 4.2));
      for (let u = 0; u < upperWins; u++) {
        const ux = -b.w * 0.36 + (upperWins > 1 ? (u / (upperWins - 1)) * b.w * 0.72 : 0);
        addFramedWindow(batch, mats, {
          x: ux, y: b.h - 2.05, z: b.d * 0.5, w: 1.95, h: 1.52,
          glassMat: mats.interiorWindowOffice, frameMat: mats.darkChrome,
          sillMat: mats.trimPaintWhite, withKeystone: true, withAC: u % 2 === 0,
        });
      }
    }

    addRooftopMechanicals(batch, mats, b.h + 0.85, b.w, b.d, h, false);

    // Main Facade Illuminated Sign + Projecting Perpendicular Vertical Neon Blade Sign!
    if (b.signText) {
      const signW = Math.min(b.w * 0.76, 11.4);
      const signY = Math.min(b.h - 0.55, 5.45);
      batch.addBox(signW + 0.34, 2.28, 0.4, mats.darkChrome, 0, signY, b.d * 0.5 + 0.24);
      const signMat = mats.createSignMaterial(b.signText, b.signColor ?? '#ff9933');
      batch.addDirectMesh(new THREE.BoxGeometry(signW, 1.98, 0.44), signMat, 0, signY, b.d * 0.5 + 0.26);

      const bladeX = b.w * 0.46;
      const bladeZ = b.d * 0.5 + 0.95;
      const bladeY = Math.min(b.h - 0.4, 5.6);
      batch.addBox(0.14, 0.14, 1.1, mats.darkChrome, bladeX, bladeY + 1.2, b.d * 0.5 + 0.48);
      batch.addBox(0.14, 0.14, 1.1, mats.darkChrome, bladeX, bladeY - 1.2, b.d * 0.5 + 0.48);
      const bladeMat = mats.createBladeSignMaterial(b.signText, b.signColor ?? '#ff9933');
      batch.addDirectMesh(new THREE.BoxGeometry(0.28, 3.6, 0.96), bladeMat, bladeX, bladeY, bladeZ);
    }
  }
}

// ============================================================================
// 3. HERO XOOMER GAS STATION LANDMARK (PRESERVED & REFINED WITH BATCHING)
// ============================================================================

function buildGasStationBatched(
  b: BuildingBlueprint,
  mats: HyperrealMaterialLibrary,
  batch: BuildingMeshBatcher,
): void {
  const wallMat = mats.commercialWalls[1];
  const canopyZ = b.d * 0.5 + 5.1;

  // 1. Oil-stained Concrete Forecourt Apron Slab
  const apronGeo = new THREE.PlaneGeometry(b.w * 1.18, 11.6);
  apronGeo.rotateX(-Math.PI * 0.5);
  batch.addGeo(apronGeo, mats.gasForecourtMat, 0, 0.036, b.d * 0.5 + 5.2);

  // 2. Convenience Mini-Mart Massing + Plinth + Branded Roof Trim
  batch.addBox(b.w, b.h, b.d, wallMat, 0, b.h * 0.5, 0, { castShadow: true, uvMeters: 3.4 });
  batch.addBox(b.w + 0.34, 0.68, b.d + 0.34, mats.darkChrome, 0, 0.34, 0);

  const redTrimMat = mats.curbRedPaint;
  batch.addBox(b.w + 0.52, 0.65, b.d + 0.52, redTrimMat, 0, b.h + 0.15, 0);
  batch.addBox(b.w + 0.56, 0.18, b.d + 0.56, mats.brassTrim, 0, b.h - 0.24, 0);

  // Interior-Mapped 3D Convenience Store Windows (Front + Both Sides)
  batch.addBox(b.w * 0.84, 2.75, 0.16, mats.interiorWindowStore, 0, 1.9, b.d * 0.5 + 0.04);
  for (const sx of [-1, 1]) {
    batch.addBox(0.16, 1.85, b.d * 0.58, mats.interiorWindowStore, sx * (b.w * 0.5 + 0.04), 2.15, 0);
  }
  const mullCount = 5;
  for (let m = 0; m <= mullCount; m++) {
    const mx = -b.w * 0.42 + (m / mullCount) * b.w * 0.84;
    batch.addBox(0.11, 2.86, 0.24, mats.darkChrome, mx, 1.9, b.d * 0.5 + 0.08);
  }
  batch.addBox(b.w * 0.86, 0.14, 0.24, mats.darkChrome, 0, 3.28, b.d * 0.5 + 0.08);

  // Store Posters, Ice Chest, Vending Machine & Air/Water Service Kiosk
  batch.addGeo(new THREE.PlaneGeometry(2.1, 1.05), mats.storePosterMat, -b.w * 0.27, 2.25, b.d * 0.5 + 0.16);
  batch.addGeo(new THREE.PlaneGeometry(2.1, 1.05), mats.storePosterMat, b.w * 0.27, 2.25, b.d * 0.5 + 0.16);

  batch.addBox(1.75, 1.15, 0.88, mats.trimPaintWhite, -b.w * 0.36, 0.62, b.d * 0.5 + 0.58, { castShadow: true });
  batch.addBox(1.8, 0.14, 0.92, mats.darkChrome, -b.w * 0.36, 1.24, b.d * 0.5 + 0.58);

  batch.addBox(1.05, 1.98, 0.82, mats.darkChrome, b.w * 0.38, 1.02, b.d * 0.5 + 0.55, { castShadow: true });
  batch.addGeo(new THREE.PlaneGeometry(0.92, 1.78), mats.busAdMat, b.w * 0.38, 1.04, b.d * 0.5 + 0.97);

  // Air & Water coin-op kiosk on left corner of forecourt
  batch.addBox(0.58, 1.48, 0.44, mats.brushedMetal, -b.w * 0.49, 0.74, b.d * 0.5 + 1.35);

  // Rooftop HVAC + Sign
  batch.addBox(2.8, 1.15, 2.1, mats.brushedMetal, -b.w * 0.2, b.h + 0.85, -b.d * 0.12);
  if (b.signText) {
    const signW = Math.min(b.w * 0.72, 10.6);
    const signMat = mats.createSignMaterial(b.signText, b.signColor ?? '#ff5e4d');
    batch.addDirectMesh(new THREE.BoxGeometry(signW, 1.65, 0.38), signMat, 0, b.h - 1.15, b.d * 0.5 + 0.24);
  }

  // 3. Structural Fuel Canopy with Branded Fascia, Ceiling Ribs & Downlight Boxes
  const canopyW = b.w * 1.08;
  const canopyD = 8.4;
  batch.addBox(canopyW, 0.88, canopyD, mats.brushedMetal, 0, 5.15, canopyZ, { castShadow: true });
  batch.addGeo(new THREE.PlaneGeometry(canopyW + 0.08, 0.92), mats.gasFasciaMat, 0, 5.16, canopyZ + canopyD * 0.5 + 0.04);
  batch.addGeo(new THREE.PlaneGeometry(canopyW + 0.08, 0.92), mats.gasFasciaMat, 0, 5.16, canopyZ - canopyD * 0.5 - 0.04, { rotY: Math.PI });
  batch.addGeo(new THREE.PlaneGeometry(canopyD + 0.08, 0.92), mats.gasFasciaMat, -canopyW * 0.5 - 0.04, 5.16, canopyZ, { rotY: -Math.PI * 0.5 });
  batch.addGeo(new THREE.PlaneGeometry(canopyD + 0.08, 0.92), mats.gasFasciaMat, canopyW * 0.5 + 0.04, 5.16, canopyZ, { rotY: Math.PI * 0.5 });

  const soffitGeo = new THREE.PlaneGeometry(canopyW - 0.3, canopyD - 0.3);
  soffitGeo.rotateX(Math.PI * 0.5);
  batch.addGeo(soffitGeo, mats.trimPaintWhite, 0, 4.7, canopyZ);

  for (const rz of [-2.4, 0, 2.4]) {
    batch.addBox(canopyW - 0.25, 0.12, 0.16, mats.darkChrome, 0, 4.65, canopyZ + rz);
  }
  for (const lx of [-canopyW * 0.3, 0, canopyW * 0.3]) {
    for (const lz of [-1.8, 1.8]) {
      batch.addBox(1.15, 0.1, 0.75, mats.darkChrome, lx, 4.66, canopyZ + lz);
      batch.addBox(1.02, 0.06, 0.62, mats.warmLampGlow, lx, 4.61, canopyZ + lz);
    }
  }

  // 4. Two Pump Islands with 4 Multi-Piece Fuel Dispensers, Curved Rubber Hoses, LCDs & Bollards
  const hoseCurveL = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.38, 1.82, 0.05),
    new THREE.Vector3(-0.62, 1.48, 0.12),
    new THREE.Vector3(-0.56, 0.92, 0.08),
    new THREE.Vector3(-0.39, 1.24, -0.02),
  ]);
  const hoseCurveR = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.38, 1.82, 0.05),
    new THREE.Vector3(0.62, 1.48, 0.12),
    new THREE.Vector3(0.56, 0.92, 0.08),
    new THREE.Vector3(0.39, 1.24, -0.02),
  ]);

  const islandXs = [-b.w * 0.31, b.w * 0.31];
  for (const cx of islandXs) {
    batch.addBox(1.75, 0.24, 6.2, mats.curbConcrete, cx, 0.12, canopyZ);
    batch.addBox(1.8, 0.14, 6.26, mats.darkChrome, cx, 0.09, canopyZ);

    batch.addBox(0.76, 1.15, 0.76, mats.curbConcrete, cx, 0.72, canopyZ);
    batch.addBox(0.56, 4.7, 0.56, mats.trimPaintWhite, cx, 2.45, canopyZ, { castShadow: true });
    batch.addBox(0.6, 0.38, 0.6, redTrimMat, cx, 3.85, canopyZ);

    for (const pz of [-1.65, 1.65]) {
      const py = 0.24;
      const pZ = canopyZ + pz;
      batch.addBox(0.84, 0.72, 0.66, mats.darkChrome, cx, py + 0.36, pZ);
      batch.addBox(0.78, 1.02, 0.6, mats.trimPaintWhite, cx, py + 1.22, pZ, { castShadow: true });
      batch.addBox(0.94, 0.24, 0.72, redTrimMat, cx, py + 1.84, pZ);
      batch.addBox(0.96, 0.06, 0.74, mats.brassTrim, cx, py + 1.71, pZ);

      batch.addGeo(new THREE.PlaneGeometry(0.62, 0.56), mats.gasPumpScreenMat, cx, py + 1.32, pZ + 0.31);
      batch.addGeo(new THREE.PlaneGeometry(0.62, 0.56), mats.gasPumpScreenMat, cx, py + 1.32, pZ - 0.31, { rotY: Math.PI });

      batch.addGeo(new THREE.TubeGeometry(hoseCurveL, 10, 0.026, 6, false), mats.carTire, cx, py, pZ);
      batch.addGeo(new THREE.TubeGeometry(hoseCurveR, 10, 0.026, 6, false), mats.carTire, cx, py, pZ);
      batch.addBox(0.08, 0.22, 0.12, mats.brushedMetal, cx - 0.4, py + 1.22, pZ - 0.02);
      batch.addBox(0.08, 0.22, 0.12, mats.brushedMetal, cx + 0.4, py + 1.22, pZ - 0.02);
    }

    batch.addBox(0.48, 0.88, 0.48, mats.darkChrome, cx, 0.68, canopyZ + 0.75);
    for (const bz of [-2.85, 2.85]) {
      batch.addCylinder(0.1, 0.1, 1.02, 8, mats.brassTrim, cx, 0.62, canopyZ + bz);
      batch.addGeo(new THREE.SphereGeometry(0.1, 8, 6), mats.darkChrome, cx, 1.13, canopyZ + bz);
    }
  }

  // 5. Giant Illuminated XOOMER Price Pylon Totem
  const pylonX = b.w * 0.56;
  const pylonZ = canopyZ + 2.8;
  batch.addCylinder(0.14, 0.17, 7.6, 8, mats.brushedMetal, pylonX - 0.85, 3.8, pylonZ, { castShadow: true });
  batch.addCylinder(0.14, 0.17, 7.6, 8, mats.brushedMetal, pylonX + 0.85, 3.8, pylonZ);
  batch.addBox(2.35, 4.5, 0.42, mats.darkChrome, pylonX, 5.45, pylonZ, { castShadow: true });
  batch.addGeo(new THREE.PlaneGeometry(2.22, 4.36), mats.gasPylonMat, pylonX, 5.45, pylonZ + 0.22);
  batch.addGeo(new THREE.PlaneGeometry(2.22, 4.36), mats.gasPylonMat, pylonX, 5.45, pylonZ - 0.22, { rotY: Math.PI });
  batch.addBox(2.4, 0.6, 0.85, mats.curbConcrete, pylonX, 0.3, pylonZ);
}

// ============================================================================
// 4. CALIFORNIA MOTELS — 2 DISTINCT ARCHETYPES (GOOGIE MOTOR INN & HACIENDA)
// ============================================================================

function buildMotelBatched(
  b: BuildingBlueprint,
  mats: HyperrealMaterialLibrary,
  batch: BuildingMeshBatcher,
): void {
  const h = hashId(b.id);
  const isGoogie = b.id === 'glen_park_motel' || b.id === 'rodeo_motel';
  const wallMat = mats.stuccoPalettes[b.paletteIndex % mats.stuccoPalettes.length];
  const walkY = b.h * 0.49;

  // Main 2-story room block + stone base
  batch.addBox(b.w + 0.25, 0.45, b.d + 0.25, mats.stoneMasonry, 0, 0.225, 0, { uvMeters: 2.4 });
  batch.addBox(b.w, b.h, b.d, wallMat, 0, b.h * 0.5, 0, { castShadow: true, uvMeters: 3.4 });

  if (isGoogie) {
    // Cantilevered angled Googie flat roof canopy + steel fascia trim
    batch.addBox(b.w + 1.4, 0.42, b.d + 3.2, mats.trimPaintWhite, 0, b.h + 0.22, 0.95, {
      rotX: -0.05,
      castShadow: true,
    });
    batch.addBox(b.w + 1.46, 0.16, 0.14, mats.brassTrim, 0, b.h + 0.32, b.d * 0.5 + 2.55);

    // Decorative Mid-Century Perforated Breeze-Block Stair Screen on Left Flank!
    const screenX = -b.w * 0.5 + 0.9;
    const screenZ = b.d * 0.5 + 2.18;
    for (let row = 0; row < 6; row++) {
      const sy = 0.65 + row * 1.18;
      batch.addBox(2.15, 0.16, 0.24, mats.trimPaintWhite, screenX, sy, screenZ);
    }
    for (let col = 0; col < 5; col++) {
      batch.addBox(0.16, b.h - 0.5, 0.24, mats.trimPaintWhite, screenX - 1.0 + col * 0.5, b.h * 0.5, screenZ);
    }
  } else {
    // Spanish Hacienda Sloped Terracotta Barrel-Tile Mansard Overhang
    const mansard = makeHipRoofGeo(b.w + 1.4, 1.55, b.d + 3.0, 2.2);
    batch.addGeo(mansard, mats.terracottaTile, 0, b.h - 0.08, 0.9, { castShadow: true });
    batch.addBox(b.w + 1.25, 0.26, b.d + 2.85, mats.woodPorch, 0, b.h - 0.14, 0.9);
  }

  // Cantilevered 2nd-floor concrete gallery deck + full balustrade with pickets + colonnade columns
  batch.addBox(b.w + 0.45, 0.28, 2.35, mats.sidewalk, 0, walkY, b.d * 0.5 + 1.15, { castShadow: true });
  batch.addBox(b.w + 0.45, 0.08, 0.08, mats.darkChrome, 0, walkY + 1.08, b.d * 0.5 + 2.22);
  batch.addBox(b.w + 0.45, 0.06, 0.06, mats.darkChrome, 0, walkY + 0.56, b.d * 0.5 + 2.22);

  // Vertical iron balusters along the entire 2nd-floor walkway
  const balCount = Math.max(10, Math.floor(b.w * 1.1));
  for (let i = 0; i <= balCount; i++) {
    const bx = -b.w * 0.48 + (i / balCount) * b.w * 0.96;
    batch.addBox(0.045, 0.98, 0.045, mats.darkChrome, bx, walkY + 0.58, b.d * 0.5 + 2.22);
  }

  // Structural gallery columns (slender Googie steel pipes vs. thick Spanish stucco piers)
  const postCount = Math.max(4, Math.round(b.w / 4.2));
  for (let i = 0; i < postCount; i++) {
    const px = -b.w * 0.47 + (i / (postCount - 1)) * b.w * 0.94;
    if (isGoogie) {
      batch.addCylinder(0.11, 0.13, b.h, 8, mats.brushedMetal, px, b.h * 0.5, b.d * 0.5 + 2.15, { castShadow: true });
    } else {
      batch.addBox(0.38, b.h, 0.38, wallMat, px, b.h * 0.5, b.d * 0.5 + 2.12, { castShadow: true });
      batch.addBox(0.5, 0.18, 0.5, mats.trimPaintWhite, px, walkY - 0.14, b.d * 0.5 + 2.12);
    }
  }

  // Room Doors, Interior-Mapped Curtained Windows, Wall AC Sleeves & Glowing Porch Sconces on Both Floors!
  const rooms = Math.max(3, Math.floor(b.w / 4.5));
  for (let floor = 0; floor < 2; floor++) {
    const baseY = floor === 0 ? 0.0 : walkY + 0.14;
    for (let r = 0; r < rooms; r++) {
      const rx = -b.w * 0.4 + ((r + 0.5) / rooms) * b.w * 0.8;
      // Framed motel room door with brass number plate
      batch.addBox(1.28, 2.34, 0.14, mats.trimPaintWhite, rx - 0.88, baseY + 1.18, b.d * 0.5 + 0.04);
      batch.addBox(1.1, 2.2, 0.18, mats.woodPorch, rx - 0.88, baseY + 1.15, b.d * 0.5 + 0.06);
      batch.addBox(0.24, 0.14, 0.05, mats.brassTrim, rx - 0.88, baseY + 1.85, b.d * 0.5 + 0.16);
      // Recessed curtained room window + under-window motel PTAC air-conditioner sleeve!
      addFramedWindow(batch, mats, {
        x: rx + 0.68, y: baseY + 1.68, z: b.d * 0.5, w: 1.5, h: 1.24,
        glassMat: mats.interiorWindowResidential, frameMat: mats.darkChrome,
        sillMat: mats.sidewalk, withAC: true,
      });
      // Glowing warm soffit/wall porch sconce
      batch.addBox(0.26, 0.22, 0.22, mats.warmLampGlow, rx - 0.15, baseY + 2.32, b.d * 0.5 + 0.14);
    }
  }

  // Side windows + Exterior Steel Switchback Staircase with Handrails on Right Flank
  for (const side of [-1, 1]) {
    for (const fy of [2.1, walkY + 1.85]) {
      addFramedWindow(batch, mats, {
        x: side * b.w * 0.5, y: fy, z: -b.d * 0.18, rotY: side * Math.PI * 0.5,
        w: 1.6, h: 1.25, glassMat: mats.interiorWindowResidential, frameMat: mats.darkChrome,
      });
    }
  }
  batch.addBox(1.35, 0.22, 4.6, mats.darkChrome, b.w * 0.5 + 0.72, walkY * 0.5, b.d * 0.16, { rotX: -0.78 });
  batch.addBox(0.08, 0.08, 4.6, mats.darkChrome, b.w * 0.5 + 1.35, walkY * 0.5 + 0.92, b.d * 0.16, { rotX: -0.78 });

  // Ground-floor Ice & Soda Vending Alcove under stairs
  batch.addBox(0.95, 1.85, 0.76, mats.darkChrome, b.w * 0.5 + 0.55, 0.94, -b.d * 0.26);
  batch.addGeo(new THREE.PlaneGeometry(0.84, 1.65), mats.busAdMat, b.w * 0.5 + 0.94, 0.96, -b.d * 0.26, { rotY: Math.PI * 0.5 });

  addRooftopMechanicals(batch, mats, b.h + 0.45, b.w, b.d, h, false);

  // Retro Rooftop Illuminated Motel Sign on Twin Steel Pylons
  if (b.signText) {
    const signW = Math.min(b.w * 0.66, 10.8);
    const signY = b.h + (isGoogie ? 2.15 : 2.65);
    batch.addBox(signW + 0.36, 2.32, 0.44, mats.darkChrome, 0, signY, b.d * 0.5 + 0.85);
    const signMat = mats.createSignMaterial(b.signText, b.signColor ?? '#ff5b9b');
    batch.addDirectMesh(new THREE.BoxGeometry(signW, 2.02, 0.48), signMat, 0, signY, b.d * 0.5 + 0.85);
    for (const sx of [-signW * 0.32, signW * 0.32]) {
      batch.addCylinder(0.09, 0.12, 2.2, 8, mats.brushedMetal, sx, b.h + 1.0, b.d * 0.5 + 0.85);
    }
  }
}

// ============================================================================
// 5. MULTI-STORY APARTMENTS — 3 DISTINCT RESIDENTIAL BLOCK ARCHETYPES
// ============================================================================

function buildApartmentBatched(
  b: BuildingBlueprint,
  mats: HyperrealMaterialLibrary,
  batch: BuildingMeshBatcher,
): void {
  const h = hashId(b.id);
  const archetype = h % 3;
  const floors = Math.max(3, Math.floor(b.h / 3.55));
  const cols = Math.max(3, Math.floor(b.w / 4.4));
  const sideCols = Math.max(2, Math.floor(b.d / 5.2));

  if (archetype === 0) {
    // --- ARCHETYPE 0: Historic 1920s Los Angeles Brick Fire-Escape Tenement ---
    const brickMat = mats.commercialWalls[b.paletteIndex % 2 === 0 ? 0 : 3];
    // Rusticated cut-stone ground floor podium
    batch.addBox(b.w + 0.38, 3.35, b.d + 0.38, mats.stoneMasonry, 0, 1.675, 0, {
      castShadow: true,
      uvMeters: 2.6,
    });
    batch.addBox(b.w + 0.56, 0.28, b.d + 0.56, mats.trimPaintWhite, 0, 3.42, 0);
    batch.addBox(b.w, b.h - 3.35, b.d, brickMat, 0, 3.35 + (b.h - 3.35) * 0.5, 0, {
      castShadow: true,
      uvMeters: 3.2,
    });

    // Projecting classical cornice with carved stone dentil brackets
    batch.addBox(b.w + 0.92, 0.62, b.d + 0.92, mats.trimPaintWhite, 0, b.h + 0.18, 0, { castShadow: true });
    const dentils = Math.max(6, Math.floor(b.w / 1.9));
    for (let d = 0; d < dentils; d++) {
      const dx = -b.w * 0.47 + (d / (dentils - 1)) * b.w * 0.94;
      batch.addBox(0.28, 0.36, 0.44, mats.trimPaintWhite, dx, b.h - 0.28, b.d * 0.5 + 0.28);
    }

    // Covered ground-floor brick-arched lobby entry + fabric awning + twin lanterns
    const awningMat = mats.awningPalettes[b.paletteIndex % mats.awningPalettes.length];
    batch.addBox(3.8, 0.26, 2.15, awningMat, 0, 3.18, b.d * 0.5 + 1.05, { rotX: 0.15, castShadow: true });
    batch.addBox(2.65, 2.75, 0.18, mats.interiorWindowResidential, 0, 1.52, b.d * 0.5 + 0.2);
    for (const lx of [-1.65, 1.65]) {
      batch.addBox(0.22, 0.36, 0.22, mats.warmLampGlow, lx, 2.55, b.d * 0.5 + 0.28);
    }

    // 3D Recessed Windows with Stone Keystones on Front + Both Side Facades + Intricate Fire Escape!
    for (let f = 1; f < floors; f++) {
      const fy = f * 3.45 + 1.75;
      if (fy > b.h - 1.2) break;
      for (let c = 0; c < cols; c++) {
        const cx = -b.w * 0.37 + (cols > 1 ? (c / (cols - 1)) * b.w * 0.74 : 0);
        addFramedWindow(batch, mats, {
          x: cx, y: fy, z: b.d * 0.5, w: 1.72, h: 1.82,
          glassMat: mats.interiorWindowResidential, frameMat: mats.darkChrome,
          sillMat: mats.trimPaintWhite, withKeystone: true, withAC: (c + f) % 3 === 0,
        });
      }
      // Side facade windows
      for (const side of [-1, 1]) {
        for (let sc = 0; sc < sideCols; sc++) {
          const sz = -b.d * 0.32 + (sideCols > 1 ? (sc / (sideCols - 1)) * b.d * 0.64 : 0);
          addFramedWindow(batch, mats, {
            x: side * b.w * 0.5, y: fy, z: sz, rotY: side * Math.PI * 0.5,
            w: 1.55, h: 1.72, glassMat: mats.interiorWindowResidential, frameMat: mats.darkChrome,
            sillMat: mats.trimPaintWhite,
          });
        }
      }

      // Authentic Wrought-Iron Fire Escape Balcony & Zig-Zag Stairway on Front-Center or Side!
      const feX = 0;
      const feZ = b.d * 0.5 + 0.62;
      batch.addBox(3.4, 0.12, 1.15, mats.darkChrome, feX, fy - 0.92, feZ, { castShadow: true });
      batch.addBox(3.4, 0.07, 0.07, mats.darkChrome, feX, fy - 0.08, b.d * 0.5 + 1.16);
      for (let p = -4; p <= 4; p++) {
        batch.addBox(0.045, 0.85, 0.045, mats.darkChrome, feX + p * 0.4, fy - 0.5, b.d * 0.5 + 1.16);
      }
      if (f < floors - 1 && fy + 3.45 <= b.h - 1.2) {
        batch.addBox(0.55, 0.09, 3.7, mats.darkChrome, feX + (f % 2 === 0 ? -0.4 : 0.4), fy + 0.8, feZ, {
          rotZ: f % 2 === 0 ? 0.68 : -0.68,
          rotY: Math.PI * 0.5,
        });
      }
    }

    addRooftopMechanicals(batch, mats, b.h + 0.45, b.w, b.d, h, true);
  } else if (archetype === 1) {
    // --- ARCHETYPE 1: Mid-Century SoCal Stucco "Dingbat" / Palms Modernist Apartments ---
    const stuccoMat = mats.stuccoPalettes[(b.paletteIndex + 1) % mats.stuccoPalettes.length];

    // Recessed ground-floor lobby & cantilevered steel-pillar carport base
    batch.addBox(b.w * 0.88, 3.2, b.d * 0.82, mats.commercialWalls[1], 0, 1.6, -b.d * 0.06, {
      castShadow: true,
      uvMeters: 3.4,
    });
    for (let p = 0; p < 4; p++) {
      const px = -b.w * 0.44 + (p / 3) * b.w * 0.88;
      batch.addCylinder(0.16, 0.18, 3.25, 8, mats.brushedMetal, px, 1.62, b.d * 0.44, { castShadow: true });
    }
    batch.addBox(3.2, 2.7, 0.18, mats.interiorWindowResidential, 0, 1.45, b.d * 0.35 + 0.04);

    // Cantilevered Upper Stucco Volume
    batch.addBox(b.w, b.h - 3.2, b.d, stuccoMat, 0, 3.2 + (b.h - 3.2) * 0.5, 0, {
      castShadow: true,
      uvMeters: 3.6,
    });
    // Flat overhanging SoCal modernist eave slab
    batch.addBox(b.w + 1.15, 0.42, b.d + 1.35, mats.trimPaintWhite, 0, b.h + 0.15, 0.15, { castShadow: true });

    // Continuous Horizontal Cantilevered Concrete Balcony Slabs with Slatted Privacy Screens per Floor!
    for (let f = 1; f < floors; f++) {
      const fy = f * 3.45 + 1.55;
      if (fy > b.h - 1.2) break;
      const slabY = fy - 1.05;
      batch.addBox(b.w * 0.94, 0.22, 1.38, mats.trimPaintWhite, 0, slabY, b.d * 0.5 + 0.65, { castShadow: true });
      batch.addBox(b.w * 0.94, 0.08, 0.08, mats.darkChrome, 0, slabY + 0.96, b.d * 0.5 + 1.3);
      batch.addBox(b.w * 0.94, 0.05, 0.05, mats.darkChrome, 0, slabY + 0.48, b.d * 0.5 + 1.3);

      // Slatted wooden apartment privacy dividers between balcony units + sliding glass doors
      for (let c = 0; c < cols; c++) {
        const cx = -b.w * 0.36 + (cols > 1 ? (c / (cols - 1)) * b.w * 0.72 : 0);
        batch.addBox(2.4, 2.15, 0.16, mats.interiorWindowResidential, cx, fy + 0.05, b.d * 0.5 + 0.04);
        batch.addBox(0.08, 2.2, 0.22, mats.darkChrome, cx, fy + 0.05, b.d * 0.5 + 0.08);
        if (c < cols - 1) {
          const divX = cx + (b.w * 0.72) / (cols - 1) * 0.5;
          batch.addBox(0.14, 2.2, 1.26, mats.woodPorch, divX, slabY + 1.12, b.d * 0.5 + 0.64);
        }
      }

      // Vertical frosted stairwell ribbon windows on side flanks
      for (const side of [-1, 1]) {
        batch.addBox(0.18, 2.1, 1.9, mats.interiorWindowOffice, side * (b.w * 0.5 + 0.04), fy, 0);
      }
    }

    addRooftopMechanicals(batch, mats, b.h + 0.38, b.w, b.d, h, false);
  } else {
    // --- ARCHETYPE 2: Spanish-Mediterranean Terracotta Residence ---
    const plasterMat = mats.commercialWalls[5];
    batch.addBox(b.w + 0.34, 1.1, b.d + 0.34, mats.stoneMasonry, 0, 0.55, 0, { uvMeters: 2.5 });
    batch.addBox(b.w, b.h, b.d, plasterMat, 0, b.h * 0.5, 0, { castShadow: true, uvMeters: 3.6 });

    // Stone belt courses every 2 floors
    for (let f = 1; f < floors; f += 2) {
      batch.addBox(b.w + 0.38, 0.24, b.d + 0.38, mats.trimPaintWhite, 0, f * 3.5 + 0.35, 0);
    }

    // Sloped Spanish Terracotta Barrel-Tile Mansard Perimeter Crown Roof!
    const mansard = makeHipRoofGeo(b.w + 1.2, 2.35, b.d + 1.2, 2.3);
    batch.addGeo(mansard, mats.terracottaTile, 0, b.h - 0.1, 0, { castShadow: true });
    batch.addBox(b.w + 0.9, 0.32, b.d + 0.9, mats.woodPorch, 0, b.h - 0.18, 0);

    // Grand Mediterranean Timber Entry Archway + Twin Brass Lanterns
    batch.addBox(3.4, 3.2, 0.42, mats.trimPaintWhite, 0, 1.65, b.d * 0.5 + 0.16);
    batch.addBox(2.5, 2.65, 0.22, mats.interiorWindowResidential, 0, 1.48, b.d * 0.5 + 0.3);
    for (const sx of [-1.95, 1.95]) {
      batch.addBox(0.24, 0.38, 0.24, mats.warmLampGlow, sx, 2.55, b.d * 0.5 + 0.26);
    }

    // Protruding Wrought-Iron Juliet Balconies + Tiled Window Hoods on Front & Sides
    for (let f = 1; f < floors; f++) {
      const fy = f * 3.5 + 1.7;
      if (fy > b.h - 1.3) break;
      for (let c = 0; c < cols; c++) {
        const cx = -b.w * 0.36 + (cols > 1 ? (c / (cols - 1)) * b.w * 0.72 : 0);
        addFramedWindow(batch, mats, {
          x: cx, y: fy, z: b.d * 0.5, w: 1.78, h: 1.85,
          glassMat: mats.interiorWindowResidential, frameMat: mats.woodPorch,
          sillMat: mats.trimPaintWhite,
          withAwningHood: (c + f) % 2 === 0 ? mats.terracottaTile : undefined,
        });
        if ((c + f) % 2 === 1) {
          batch.addBox(2.45, 0.2, 1.05, mats.trimPaintWhite, cx, fy - 0.95, b.d * 0.5 + 0.52, { castShadow: true });
          batch.addBox(2.45, 0.07, 0.07, mats.darkChrome, cx, fy - 0.1, b.d * 0.5 + 1.0);
          for (let p = -3; p <= 3; p++) {
            batch.addBox(0.045, 0.84, 0.045, mats.darkChrome, cx + p * 0.36, fy - 0.52, b.d * 0.5 + 1.0);
          }
        }
      }
      for (const side of [-1, 1]) {
        for (let sc = 0; sc < sideCols; sc++) {
          const sz = -b.d * 0.3 + (sideCols > 1 ? (sc / (sideCols - 1)) * b.d * 0.6 : 0);
          addFramedWindow(batch, mats, {
            x: side * b.w * 0.5, y: fy, z: sz, rotY: side * Math.PI * 0.5,
            w: 1.58, h: 1.72, glassMat: mats.interiorWindowResidential, frameMat: mats.woodPorch,
            withGrille: true,
          });
        }
      }
    }
  }
}

// ============================================================================
// 6. ART-DECO LANDMARKS — 3 UNMISTAKABLE LOS ANGELES MONUMENT ARCHETYPES
// ============================================================================

function buildArtDecoBatched(
  b: BuildingBlueprint,
  mats: HyperrealMaterialLibrary,
  batch: BuildingMeshBatcher,
): void {
  const isTheatreOrPalace = b.id === 'vinewood_theatre' || b.id === 'vinewood_hotel';
  const isCivic = b.id === 'pershing_plaza_hall' || b.id === 'lspd_hq';

  const stoneMat =
    b.paletteIndex === 3
      ? mats.commercialWalls[2]
      : b.paletteIndex === 4
        ? mats.stuccoPalettes[0]
        : mats.mazeBankMarble;
  const accentMat = mats.brassTrim;

  if (isTheatreOrPalace) {
    // --- ARCHETYPE A: Hollywood Palace Cinema / Rodeo Grand Hotel ---
    const lowerH = b.h * 0.68;
    const upperH = b.h * 0.32;

    batch.addBox(b.w + 0.5, 0.9, b.d + 0.5, mats.stoneMasonry, 0, 0.45, 0, { uvMeters: 2.6 });
    batch.addBox(b.w, lowerH, b.d, stoneMat, 0, lowerH * 0.5, 0, { castShadow: true, uvMeters: 3.6 });
    batch.addBox(b.w * 0.8, upperH, b.d * 0.8, stoneMat, 0, lowerH + upperH * 0.5, 0, {
      castShadow: true,
      uvMeters: 3.6,
    });

    // Stepped Art-Deco Ziggurat Central Facade Fin + Gilded Brass Chevron Friezes!
    batch.addBox(b.w * 0.34, b.h + 4.8, 1.35, stoneMat, 0, (b.h + 4.8) * 0.5, b.d * 0.5 - 0.15, {
      castShadow: true,
      uvMeters: 3.2,
    });
    batch.addBox(b.w * 0.38, 0.42, 1.55, accentMat, 0, b.h + 4.85, b.d * 0.5 - 0.15);
    batch.addCylinder(0.1, 0.38, 6.2, 8, accentMat, 0, b.h + 7.9, b.d * 0.5 - 0.15);

    // Gilded horizontal Art-Deco bands wrapping all 4 sides
    for (const by of [lowerH * 0.45, lowerH, b.h]) {
      const bw = by > lowerH ? b.w * 0.83 : b.w + 0.5;
      const bd = by > lowerH ? b.d * 0.83 : b.d + 0.5;
      batch.addBox(bw, 0.45, bd, accentMat, 0, by, 0);
    }

    // Vertical fluted Art-Deco pilasters & tall recessed bronze-mullioned glazed bays on front & sides
    const bays = Math.max(4, Math.floor(b.w / 3.8));
    for (let i = 0; i <= bays; i++) {
      const px = -b.w * 0.46 + (i / bays) * b.w * 0.92;
      batch.addBox(0.62, lowerH + 0.5, 0.48, stoneMat, px, lowerH * 0.5, b.d * 0.5 + 0.14);
      if (i < bays && Math.abs(px + (b.w * 0.92) / (bays * 2)) > b.w * 0.16) {
        const gx = px + (b.w * 0.92) / (bays * 2);
        const bayW = (b.w * 0.84) / bays - 0.65;
        batch.addBox(bayW, lowerH * 0.62, 0.16, mats.interiorWindowOffice, gx, lowerH * 0.58, b.d * 0.5 + 0.04);
        for (const frac of [0.36, 0.58, 0.78]) {
          batch.addBox(bayW + 0.14, 0.26, 0.28, accentMat, gx, lowerH * frac, b.d * 0.5 + 0.11);
        }
      }
    }
    // Side Art-Deco vertical window slots
    for (const side of [-1, 1]) {
      for (const sz of [-b.d * 0.26, 0, b.d * 0.26]) {
        batch.addBox(0.16, lowerH * 0.62, 2.2, mats.interiorWindowOffice, side * (b.w * 0.5 + 0.04), lowerH * 0.58, sz);
        batch.addBox(0.32, lowerH, 0.48, stoneMat, side * (b.w * 0.5 + 0.12), lowerH * 0.5, sz + 1.35);
      }
    }

    // Ornate Cantilevered Grand Theater Marquee Canopy with Perimeter Glowing Marquee Bulbs + Brass Ticket Booth!
    const marqW = b.w * 0.62;
    batch.addBox(marqW, 1.12, 3.4, mats.darkChrome, 0, 4.28, b.d * 0.5 + 1.65, { castShadow: true });
    batch.addBox(marqW + 0.28, 0.24, 3.55, accentMat, 0, 4.86, b.d * 0.5 + 1.65);
    batch.addBox(marqW + 0.28, 0.2, 3.55, accentMat, 0, 3.74, b.d * 0.5 + 1.65);
    // Warm marquee light bulbs lining front & underside of marquee!
    const bulbCount = 9;
    for (let bl = 0; bl < bulbCount; bl++) {
      const bx = -marqW * 0.45 + (bl / (bulbCount - 1)) * marqW * 0.9;
      batch.addGeo(new THREE.SphereGeometry(0.13, 6, 6), mats.warmLampGlow, bx, 3.68, b.d * 0.5 + 3.25);
      batch.addGeo(new THREE.SphereGeometry(0.13, 6, 6), mats.warmLampGlow, bx, 3.68, b.d * 0.5 + 1.85);
    }
    // Illuminated Glass Lobby Doors + Central Brass Ticket Booth
    batch.addBox(b.w * 0.42, 3.5, 0.2, mats.interiorWindowStore, 0, 1.75, b.d * 0.5 + 0.06);
    batch.addCylinder(0.75, 0.75, 2.55, 8, accentMat, 0, 1.28, b.d * 0.5 + 1.35);
    batch.addCylinder(0.64, 0.64, 1.15, 8, mats.interiorWindowStore, 0, 1.65, b.d * 0.5 + 1.35);

    if (b.signText) {
      // Main Marquee Illuminated Board + Iconic Soaring Vertical Hollywood Blade Tower Sign!
      const signMat = mats.createSignMaterial(b.signText, b.signColor ?? '#ff6644');
      batch.addDirectMesh(new THREE.BoxGeometry(marqW * 0.92, 0.92, 0.24), signMat, 0, 4.3, b.d * 0.5 + 3.38);

      const bladeMat = mats.createBladeSignMaterial(b.signText, b.signColor ?? '#ff6644');
      const bladeH = Math.min(b.h * 0.68, 12.5);
      batch.addDirectMesh(new THREE.BoxGeometry(1.15, bladeH, 0.58), bladeMat, 0, 5.4 + bladeH * 0.5, b.d * 0.5 + 0.85);
    }
  } else if (isCivic) {
    // --- ARCHETYPE B: Civic Neo-Deco Monument (Los Santos City Hall / LSPD Precinct) ---
    const lowerH = b.h * 0.62;
    const midH = b.h * 0.24;
    const topH = b.h * 0.14;

    // Monumental stepped granite plaza plinth & ceremonial entry staircase
    batch.addBox(b.w + 1.0, 1.4, b.d + 1.0, mats.stoneMasonry, 0, 0.7, 0, { castShadow: true, uvMeters: 2.6 });
    for (let st = 0; st < 3; st++) {
      batch.addBox(b.w * 0.58 + st * 0.6, 0.34, 1.15, mats.sidewalk, 0, 0.17 + (2 - st) * 0.34, b.d * 0.5 + 0.85 + st * 0.58);
    }

    // 3-Tier Stepped Civic Massing
    batch.addBox(b.w, lowerH, b.d, stoneMat, 0, 1.4 + lowerH * 0.5, 0, { castShadow: true, uvMeters: 3.8 });
    batch.addBox(b.w * 0.76, midH, b.d * 0.76, stoneMat, 0, 1.4 + lowerH + midH * 0.5, 0, { castShadow: true, uvMeters: 3.8 });
    batch.addBox(b.w * 0.5, topH, b.d * 0.5, stoneMat, 0, 1.4 + lowerH + midH + topH * 0.5, 0, { castShadow: true, uvMeters: 3.4 });

    // Double-Height Fluted Monumental Colonnade Portico across Front!
    const colH = Math.min(8.2, lowerH * 0.62);
    const colCount = 6;
    for (let c = 0; c < colCount; c++) {
      const cx = -b.w * 0.38 + (c / (colCount - 1)) * b.w * 0.76;
      batch.addCylinder(0.42, 0.48, colH, 10, stoneMat, cx, 1.4 + colH * 0.5, b.d * 0.5 + 1.15, { castShadow: true });
      batch.addBox(1.05, 0.38, 1.05, stoneMat, cx, 1.4 + colH + 0.16, b.d * 0.5 + 1.15);
    }
    // Inscribed Stone Entablature Beam over Colonnade
    batch.addBox(b.w * 0.86, 1.25, 2.3, stoneMat, 0, 1.4 + colH + 0.92, b.d * 0.5 + 0.65, { castShadow: true });
    batch.addBox(b.w * 0.89, 0.24, 2.46, accentMat, 0, 1.4 + colH + 1.56, b.d * 0.5 + 0.65);

    // Recessed Bronze-Framed Tall Civic Windows on All 4 Facades!
    const winStartY = 1.4 + colH + 1.9;
    const winSpanH = Math.max(3.2, lowerH - colH - 2.2);
    const bays = Math.max(4, Math.floor(b.w / 3.6));
    for (let i = 0; i < bays; i++) {
      const gx = -b.w * 0.38 + (bays > 1 ? (i / (bays - 1)) * b.w * 0.76 : 0);
      batch.addBox(1.75, winSpanH, 0.16, mats.interiorWindowOffice, gx, winStartY + winSpanH * 0.5, b.d * 0.5 + 0.04);
      batch.addBox(1.88, 0.22, 0.26, accentMat, gx, winStartY + winSpanH * 0.5, b.d * 0.5 + 0.1);
    }
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const sz = -b.d * 0.34 + (i / 3) * b.d * 0.68;
        batch.addBox(0.16, lowerH * 0.72, 1.95, mats.interiorWindowOffice, side * (b.w * 0.5 + 0.04), 1.4 + lowerH * 0.52, sz);
        batch.addBox(0.32, lowerH, 0.44, stoneMat, side * (b.w * 0.5 + 0.12), 1.4 + lowerH * 0.5, sz + 1.25);
      }
    }

    // Mid-Tier & Upper-Tier Art-Deco Recessed Lancet Windows, Fluted Pilasters & Gilded Cornice Bands!
    const midBaseY = 1.4 + lowerH;
    const topBaseY = midBaseY + midH;
    batch.addBox(b.w + 0.45, 0.34, b.d + 0.45, accentMat, 0, midBaseY, 0);
    batch.addBox(b.w * 0.79, 0.3, b.d * 0.79, accentMat, 0, topBaseY, 0);
    batch.addBox(b.w * 0.53, 0.28, b.d * 0.53, accentMat, 0, topBaseY + topH, 0);

    // Mid-tier front/back/side recessed vertical Art-Deco glazed bays
    const midBays = Math.max(3, Math.floor((b.w * 0.76) / 3.2));
    for (let i = 0; i < midBays; i++) {
      const gx = -b.w * 0.28 + (midBays > 1 ? (i / (midBays - 1)) * b.w * 0.56 : 0);
      for (const fz of [-1, 1]) {
        batch.addBox(1.35, midH * 0.72, 0.16, mats.interiorWindowOffice, gx, midBaseY + midH * 0.52, fz * (b.d * 0.38 + 0.04));
        batch.addBox(1.48, 0.2, 0.24, accentMat, gx, midBaseY + midH * 0.52, fz * (b.d * 0.38 + 0.09));
      }
    }
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const gz = -b.d * 0.24 + (i / 2) * b.d * 0.48;
        batch.addBox(0.16, midH * 0.72, 1.35, mats.interiorWindowOffice, side * (b.w * 0.38 + 0.04), midBaseY + midH * 0.52, gz);
      }
    }
    // Upper tower tier arched/vertical clock-tower lantern slots on all 4 sides
    for (const fz of [-1, 1]) {
      for (const gx of [-b.w * 0.12, 0, b.w * 0.12]) {
        batch.addBox(0.95, topH * 0.68, 0.16, mats.interiorWindowOffice, gx, topBaseY + topH * 0.52, fz * (b.d * 0.25 + 0.04));
      }
    }
    for (const side of [-1, 1]) {
      for (const gz of [-b.d * 0.11, 0, b.d * 0.11]) {
        batch.addBox(0.16, topH * 0.68, 0.95, mats.interiorWindowOffice, side * (b.w * 0.25 + 0.04), topBaseY + topH * 0.52, gz);
      }
    }

    // Stepped Civic Ziggurat Pyramid Crown + Illuminated Brass Lantern Cupola!
    const crownBaseY = 1.4 + lowerH + midH + topH;
    const pyr = makeHipRoofGeo(b.w * 0.48, 4.2, b.d * 0.48, 3.0);
    batch.addGeo(pyr, stoneMat, 0, crownBaseY, 0, { castShadow: true });
    batch.addCylinder(1.25, 1.45, 2.2, 8, mats.warmLampGlow, 0, crownBaseY + 4.4, 0);
    batch.addCylinder(0.08, 0.45, 5.2, 8, accentMat, 0, crownBaseY + 7.6, 0);

    // Grand recessed lobby glass doors behind colonnade
    batch.addBox(b.w * 0.48, 4.4, 0.18, mats.interiorWindowOffice, 0, 3.6, b.d * 0.5 + 0.06);

    if (b.signText) {
      const signMat = mats.createSignMaterial(b.signText, b.signColor ?? '#e8c468');
      batch.addDirectMesh(new THREE.BoxGeometry(Math.min(b.w * 0.72, 11.4), 1.55, 0.32), signMat, 0, 1.4 + colH + 0.92, b.d * 0.5 + 1.85);
    }
  } else {
    // --- ARCHETYPE C: Coastal Streamline Moderne Hotel / Plaza (Santa Maria Hotel, Rodeo Plaza, LS Imports) ---
    batch.addBox(b.w, b.h, b.d, stoneMat, 0, b.h * 0.5, 0, { castShadow: true, uvMeters: 3.8 });

    // Iconic Streamline Moderne Rounded Corner Cylindrical Towers integrated seamlessly into front corners!
    const cylR = Math.min(2.6, b.w * 0.14);
    for (const sx of [-1, 1]) {
      batch.addCylinder(cylR, cylR, b.h + 1.2, 14, stoneMat, sx * (b.w * 0.5 - cylR * 0.35), (b.h + 1.2) * 0.5, b.d * 0.5 - cylR * 0.35, {
        castShadow: true,
      });
      // Wraparound curved glass corner ribbon strips on every floor!
      const bandFloors = Math.max(3, Math.floor(b.h / 3.8));
      for (let f = 1; f < bandFloors; f++) {
        const fy = f * 3.7 + 1.4;
        if (fy > b.h - 1.5) break;
        batch.addCylinder(cylR + 0.08, cylR + 0.08, 1.65, 14, mats.interiorWindowOffice, sx * (b.w * 0.5 - cylR * 0.35), fy, b.d * 0.5 - cylR * 0.35);
      }
    }

    // Sweeping Horizontal Concrete "Speed-Line" Eyebrow Ledges wrapping front & sides on every floor!
    const floors = Math.max(3, Math.floor(b.h / 3.8));
    for (let f = 1; f <= floors; f++) {
      const fy = Math.min(b.h, f * 3.7 + 0.35);
      batch.addBox(b.w + 1.15, 0.34, b.d + 1.15, mats.trimPaintWhite, 0, fy, 0, { castShadow: true });
      if (f < floors) {
        // Continuous recessed horizontal ribbon windows between speed-line bands
        batch.addBox(b.w * 0.72, 1.75, 0.16, mats.interiorWindowOffice, 0, fy + 1.6, b.d * 0.5 + 0.05);
        for (const side of [-1, 1]) {
          batch.addBox(0.16, 1.75, b.d * 0.68, mats.interiorWindowOffice, side * (b.w * 0.5 + 0.05), fy + 1.6, 0);
        }
      }
    }

    // Vertical recessed ocean-liner stairwell fin + Nautical Brass Porthole Windows near parapet!
    batch.addBox(2.4, b.h + 2.6, 0.82, mats.trimPaintWhite, 0, (b.h + 2.6) * 0.5, b.d * 0.5 + 0.18, { castShadow: true });
    batch.addBox(1.35, b.h * 0.68, 0.9, mats.interiorWindowOffice, 0, b.h * 0.58, b.d * 0.5 + 0.22);
    for (const px of [-b.w * 0.28, b.w * 0.28]) {
      batch.addCylinder(0.68, 0.68, 0.34, 12, accentMat, px, b.h - 1.1, b.d * 0.5 + 0.08, { rotX: Math.PI * 0.5 });
      batch.addCylinder(0.5, 0.5, 0.38, 12, mats.interiorWindowOffice, px, b.h - 1.1, b.d * 0.5 + 0.1, { rotX: Math.PI * 0.5 });
    }

    // Rounded Chrome-Rimmed Entrance Canopy + Ocean-Liner Penthouse Crown & Flagpole
    batch.addBox(b.w * 0.5, 0.58, 2.8, mats.darkChrome, 0, 3.85, b.d * 0.5 + 1.35, { castShadow: true });
    batch.addBox(b.w * 0.52, 0.16, 2.9, mats.brushedMetal, 0, 4.18, b.d * 0.5 + 1.35);
    batch.addBox(b.w * 0.44, 3.4, 0.18, mats.interiorWindowStore, 0, 1.75, b.d * 0.5 + 0.06);

    batch.addBox(b.w * 0.58, 2.8, b.d * 0.56, mats.trimPaintWhite, 0, b.h + 1.4, -b.d * 0.06, { castShadow: true });
    batch.addCylinder(0.08, 0.14, 6.8, 8, mats.brushedMetal, 0, b.h + 6.0, 0);

    if (b.signText) {
      const signMat = mats.createSignMaterial(b.signText, b.signColor ?? '#3ec6ff');
      batch.addDirectMesh(new THREE.BoxGeometry(Math.min(b.w * 0.6, 10.6), 1.85, 0.36), signMat, 0, 5.15, b.d * 0.5 + 0.68);
    }
  }
}

// ============================================================================
// 7. MAZE BANK & 5 DISTINCT DOWNTOWN LOS SANTOS SKYSCRAPER ARCHETYPES
// ============================================================================

function buildSkyscraperBatched(
  b: BuildingBlueprint,
  mats: HyperrealMaterialLibrary,
  batch: BuildingMeshBatcher,
): void {
  if (b.style === 'maze_bank') {
    // --- CROWN JEWEL: ICONIC MAZE BANK TOWER ---
    // 1. Monumental Circular Travertine Colonnade Plaza Podium (16 fluted columns + curved glass atrium)
    batch.addCylinder(b.w * 0.58, b.w * 0.64, 11.2, 24, mats.mazeBankMarble, 0, 5.6, 0, { castShadow: true });
    batch.addCylinder(b.w * 0.625, b.w * 0.635, 5.4, 24, mats.interiorWindowOffice, 0, 2.9, 0);
    for (let c = 0; c < 16; c++) {
      const a = (c / 16) * Math.PI * 2;
      batch.addCylinder(0.46, 0.54, 11.2, 10, mats.mazeBankMarble, Math.cos(a) * b.w * 0.655, 5.6, Math.sin(a) * b.w * 0.655, { castShadow: true });
    }
    batch.addCylinder(b.w * 0.67, b.w * 0.67, 0.62, 24, mats.brassTrim, 0, 5.8, 0);
    batch.addCylinder(b.w * 0.68, b.w * 0.68, 0.92, 24, mats.darkChrome, 0, 10.9, 0);
    // Grand cantilevered glass-and-brass south entrance portico
    batch.addBox(11.5, 0.65, 4.8, mats.darkChrome, 0, 5.2, b.d * 0.66, { castShadow: true });
    batch.addBox(11.8, 0.18, 4.95, mats.brassTrim, 0, 5.55, b.d * 0.66);

    // 2. Lower & Mid Tapered Cylindrical Curtain-Wall Shaft with 16 Travertine Exoskeleton Ribs
    const lowerShaftH = b.h * 0.44;
    batch.addCylinder(b.w * 0.46, b.w * 0.51, lowerShaftH, 24, mats.mazeBankGlass, 0, 11.2 + lowerShaftH * 0.5, 0, {
      castShadow: true,
      uvScaleU: 2.5,
      uvScaleV: 1.8,
    });
    for (let r = 0; r < 16; r++) {
      const a = (r / 16) * Math.PI * 2;
      batch.addBox(0.95, lowerShaftH + 1.2, 1.38, mats.mazeBankMarble, Math.cos(a) * b.w * 0.485, 11.2 + lowerShaftH * 0.5, Math.sin(a) * b.w * 0.485, {
        rotY: -a,
      });
    }

    // 3. Mid-Tower Recessed Louvered Mechanical Sky-Deck + Glowing Architectural Uplight Ring
    const midY = 11.2 + lowerShaftH;
    batch.addCylinder(b.w * 0.44, b.w * 0.44, 3.2, 24, mats.darkChrome, 0, midY + 1.6, 0);
    batch.addCylinder(b.w * 0.485, b.w * 0.485, 0.72, 24, mats.brassTrim, 0, midY + 0.15, 0);
    batch.addCylinder(b.w * 0.465, b.w * 0.465, 0.48, 24, mats.warmLampGlow, 0, midY + 3.15, 0);

    // 4. Upper Tapered Executive Glass Drum + 8 Stepped Travertine Buttress Fins
    const upperShaftH = b.h * 0.34;
    const upperBaseY = midY + 3.2;
    batch.addCylinder(b.w * 0.36, b.w * 0.42, upperShaftH, 24, mats.mazeBankGlass, 0, upperBaseY + upperShaftH * 0.5, 0, {
      castShadow: true,
      uvScaleU: 2.0,
      uvScaleV: 1.4,
    });
    for (let r = 0; r < 8; r++) {
      const a = (r / 8) * Math.PI * 2 + Math.PI * 0.125;
      batch.addBox(1.15, upperShaftH + 2.4, 1.45, mats.mazeBankMarble, Math.cos(a) * b.w * 0.39, upperBaseY + upperShaftH * 0.5, Math.sin(a) * b.w * 0.39, {
        rotY: -a,
      });
    }

    // 5. Iconic Sculpted 4-Notched Stepped Travertine Crown + Illuminated Crown Frieze Ring
    const crownY = upperBaseY + upperShaftH;
    batch.addCylinder(b.w * 0.41, b.w * 0.37, 5.2, 24, mats.mazeBankMarble, 0, crownY + 2.6, 0, { castShadow: true });
    batch.addCylinder(b.w * 0.425, b.w * 0.425, 0.65, 24, mats.warmLampGlow, 0, crownY + 4.35, 0);
    for (let q = 0; q < 4; q++) {
      const a = (q / 4) * Math.PI * 2;
      batch.addBox(3.4, 3.6, 2.2, mats.mazeBankMarble, Math.cos(a) * b.w * 0.36, crownY + 5.8, Math.sin(a) * b.w * 0.36, {
        rotY: -a,
      });
    }

    // 6. Rooftop Helipad with Painted FAA 'H' Texture + Tapered Aviation Spire & Red Beacon!
    const padY = crownY + 5.35;
    batch.addCylinder(b.w * 0.35, b.w * 0.36, 0.48, 24, mats.darkChrome, 0, padY, 0);
    const padTop = new THREE.CircleGeometry(b.w * 0.33, 24);
    padTop.rotateX(-Math.PI * 0.5);
    batch.addGeo(padTop, mats.helipadMat, 0, padY + 0.26, 0);

    batch.addCylinder(0.16, 0.62, 14.5, 10, mats.brushedMetal, 0, padY + 7.5, 0);
    batch.addGeo(new THREE.SphereGeometry(0.75, 10, 10), mats.curbRedPaint, 0, padY + 14.9, 0);
    return;
  }

  // --- 5 DISTINCT DOWNTOWN LOS SANTOS HIGH-RISE SKYSCRAPER ARCHETYPES ---
  const h = hashId(b.id);
  const archetype = (b.paletteIndex + (h % 2)) % 5;
  const facadeMat = mats.skyscraperFacades[b.paletteIndex % mats.skyscraperFacades.length];

  // Double-height colonnaded street-level lobby podium (customized per archetype)
  const podH = 7.8;
  const podMat = archetype === 1 || archetype === 4 ? mats.mazeBankMarble : mats.darkChrome;
  batch.addBox(b.w + 1.35, podH, b.d + 1.35, podMat, 0, podH * 0.5, 0, { castShadow: true, uvMeters: 3.6 });
  batch.addBox(b.w + 1.52, 4.9, b.d + 1.52, mats.interiorWindowOffice, 0, 3.05, 0);
  // Structural lobby colonnade piers around base perimeter
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      batch.addBox(1.45, podH + 0.2, 1.45, podMat, sx * (b.w * 0.5 + 0.42), podH * 0.5, sz * (b.d * 0.5 + 0.42));
    }
  }
  // Cantilevered glass-and-steel corporate entry marquee on south/front face
  batch.addBox(b.w * 0.56, 0.52, 3.2, mats.darkChrome, 0, 5.2, b.d * 0.5 + 1.85, { castShadow: true });
  batch.addBox(b.w * 0.58, 0.14, 3.3, mats.brushedMetal, 0, 5.5, b.d * 0.5 + 1.85);

  const mainH = b.h * 0.72;

  if (archetype === 0) {
    // ARCHETYPE 0: Tapered Glass & External Steel Diagrid Tech Tower with Sloped Sail Crown
    batch.addBox(b.w, mainH, b.d, facadeMat, 0, podH + mainH * 0.5, 0, { castShadow: true });

    // Vertical mega-columns + X-shaped External Steel Diagrid Bracing Trusses across front & back!
    for (const fx of [-b.w * 0.49, 0, b.w * 0.49]) {
      batch.addBox(0.68, mainH + 1.5, b.d + 0.65, mats.brushedMetal, fx, podH + mainH * 0.5, 0);
    }
    const diagTiers = 4;
    const tierH = mainH / diagTiers;
    const diagLen = Math.hypot(b.w * 0.48, tierH);
    const diagAngle = Math.atan2(b.w * 0.48, tierH);
    for (let t = 0; t < diagTiers; t++) {
      const ty = podH + (t + 0.5) * tierH;
      for (const fz of [-b.d * 0.5 - 0.16, b.d * 0.5 + 0.16]) {
        batch.addBox(0.34, diagLen, 0.34, mats.brushedMetal, -b.w * 0.24, ty, fz, { rotZ: diagAngle });
        batch.addBox(0.34, diagLen, 0.34, mats.brushedMetal, -b.w * 0.24, ty, fz, { rotZ: -diagAngle });
        batch.addBox(0.34, diagLen, 0.34, mats.brushedMetal, b.w * 0.24, ty, fz, { rotZ: diagAngle });
        batch.addBox(0.34, diagLen, 0.34, mats.brushedMetal, b.w * 0.24, ty, fz, { rotZ: -diagAngle });
      }
    }

    // Recessed Mid-Tower Glowing Sky-Terrace Lounge Band
    batch.addBox(b.w + 0.75, 2.1, b.d + 0.75, mats.darkChrome, 0, podH + mainH * 0.55, 0);
    batch.addBox(b.w + 0.82, 0.42, b.d + 0.82, mats.warmLampGlow, 0, podH + mainH * 0.55 + 0.85, 0);

    // Dramatic Sculpted Sloped Glass-and-Steel Sail Crown + Twin Aviation Masts!
    const sailLow = b.h * 0.14;
    const sailHigh = b.h * 0.3;
    const sail = makeSlopedSailCrownGeo(b.w * 0.88, b.d * 0.84, sailLow, sailHigh);
    batch.addGeo(sail, facadeMat, 0, podH + mainH, 0, { castShadow: true });
    // Glowing LED crown edge fin along sloped top ridge
    const ridgeLen = Math.hypot(b.w * 0.88, sailHigh - sailLow);
    const ridgeAngle = Math.atan2(sailHigh - sailLow, b.w * 0.88);
    batch.addBox(ridgeLen + 0.5, 0.55, b.d * 0.88, mats.brushedMetal, 0, podH + mainH + (sailLow + sailHigh) * 0.5 + 0.15, 0, {
      rotZ: ridgeAngle,
    });
    batch.addCylinder(0.1, 0.28, 12.0, 8, mats.brushedMetal, b.w * 0.34, podH + mainH + sailHigh + 5.8, 0);
    batch.addGeo(new THREE.SphereGeometry(0.45, 8, 8), mats.curbRedPaint, b.w * 0.34, podH + mainH + sailHigh + 12.0, 0);
  } else if (archetype === 1) {
    // ARCHETYPE 1: 3-Tier Step-Back Art-Deco Limestone & Bronze Ziggurat Skyscraper
    const t1H = b.h * 0.48;
    const t2H = b.h * 0.26;
    const t3H = b.h * 0.18;

    batch.addBox(b.w, t1H, b.d, facadeMat, 0, podH + t1H * 0.5, 0, { castShadow: true });
    batch.addBox(b.w * 0.76, t2H, b.d * 0.76, facadeMat, 0, podH + t1H + t2H * 0.5, 0, { castShadow: true });
    batch.addBox(b.w * 0.5, t3H, b.d * 0.5, mats.mazeBankMarble, 0, podH + t1H + t2H + t3H * 0.5, 0, {
      castShadow: true,
      uvMeters: 3.4,
    });

    // Vertical Limestone Structural Fins wrapping all 4 faces of lower & mid tiers!
    const finCount = 5;
    for (let f = 0; f < finCount; f++) {
      const fx = -b.w * 0.46 + (f / (finCount - 1)) * b.w * 0.92;
      batch.addBox(0.75, t1H + 0.6, b.d + 0.68, mats.mazeBankMarble, fx, podH + t1H * 0.5, 0);
      const fz = -b.d * 0.46 + (f / (finCount - 1)) * b.d * 0.92;
      batch.addBox(b.w + 0.68, t1H + 0.6, 0.75, mats.mazeBankMarble, 0, podH + t1H * 0.5, fz);
    }

    // Gilded Bronze Cornice Setback Rings + Illuminated Lantern Pinnacle & Tapered Spire!
    batch.addBox(b.w + 0.85, 0.95, b.d + 0.85, mats.brassTrim, 0, podH + t1H, 0);
    batch.addBox(b.w * 0.79, 0.85, b.d * 0.79, mats.brassTrim, 0, podH + t1H + t2H, 0);
    batch.addBox(b.w * 0.54, 0.75, b.d * 0.54, mats.brassTrim, 0, podH + t1H + t2H + t3H, 0);
    const lanternY = podH + t1H + t2H + t3H;
    batch.addBox(b.w * 0.28, 3.4, b.d * 0.28, mats.warmLampGlow, 0, lanternY + 1.7, 0);
    batch.addCylinder(0.12, 0.62, 13.5, 8, mats.brassTrim, 0, lanternY + 10.0, 0);
  } else if (archetype === 2) {
    // ARCHETYPE 2: Interlocked Twin-Slab Cantilevered Modernist Corporate Tower with Concrete Louvers
    const leftH = b.h * 0.94;
    const rightH = b.h * 0.72;
    const slabW = b.w * 0.48;

    // Twin offset glass slabs linked by recessed dark-chrome elevator core
    batch.addBox(slabW, leftH, b.d * 0.96, facadeMat, -b.w * 0.25, podH + leftH * 0.5, -b.d * 0.04, { castShadow: true });
    batch.addBox(slabW, rightH, b.d * 0.92, facadeMat, b.w * 0.25, podH + rightH * 0.5, b.d * 0.06, { castShadow: true });
    batch.addBox(b.w * 0.24, rightH + 2.5, b.d * 0.66, mats.darkChrome, 0, podH + (rightH + 2.5) * 0.5, 0);

    // Crisp horizontal concrete brise-soleil sun-shading louvers wrapping both slabs
    const louvers = 7;
    for (let l = 1; l <= louvers; l++) {
      const ly = podH + (l / (louvers + 1)) * rightH;
      batch.addBox(b.w + 0.68, 0.52, b.d + 0.68, mats.trimPaintWhite, 0, ly, 0);
    }

    // Rooftop Helipad on Lower Right Wing + Cooling Towers & Mast on Tall Left Wing!
    const rTop = podH + rightH;
    const padTop = new THREE.CircleGeometry(Math.min(slabW, b.d) * 0.42, 18);
    padTop.rotateX(-Math.PI * 0.5);
    batch.addGeo(padTop, mats.helipadMat, b.w * 0.25, rTop + 0.14, b.d * 0.06);

    const lTop = podH + leftH;
    batch.addBox(slabW + 0.5, 1.35, b.d * 0.98, mats.darkChrome, -b.w * 0.25, lTop + 0.65, -b.d * 0.04);
    batch.addCylinder(1.85, 2.0, 3.0, 12, mats.brushedMetal, -b.w * 0.25, lTop + 2.5, -b.d * 0.22);
    batch.addCylinder(0.1, 0.28, 10.5, 8, mats.brushedMetal, -b.w * 0.25, lTop + 6.5, b.d * 0.16);
  } else if (archetype === 3) {
    // ARCHETYPE 3: Faceted 8-Sided Octagonal Reflective Mirror-Glass Skyscraper!
    const octR = Math.min(b.w, b.d) * 0.54;
    const lowerOctH = b.h * 0.54;
    const upperOctH = b.h * 0.34;

    batch.addCylinder(octR, octR * 1.04, lowerOctH, 8, facadeMat, 0, podH + lowerOctH * 0.5, 0, {
      rotY: Math.PI / 8,
      castShadow: true,
      uvScaleU: 2.2,
      uvScaleV: 1.6,
    });
    // 8 Brushed-Aluminum Vertical Corner Structural Fins along the octagon edges!
    for (let c = 0; c < 8; c++) {
      const a = (c / 8) * Math.PI * 2 + Math.PI / 8;
      batch.addBox(0.58, lowerOctH + 0.8, 0.95, mats.brushedMetal, Math.cos(a) * octR * 0.99, podH + lowerOctH * 0.5, Math.sin(a) * octR * 0.99, {
        rotY: -a,
      });
    }

    // Recessed Dark Mechanical Louver Waist Ring
    const waistY = podH + lowerOctH;
    batch.addCylinder(octR * 0.88, octR * 0.88, 3.0, 8, mats.darkChrome, 0, waistY + 1.5, 0, { rotY: Math.PI / 8 });
    batch.addCylinder(octR * 1.02, octR * 1.02, 0.55, 8, mats.brushedMetal, 0, waistY + 0.1, 0, { rotY: Math.PI / 8 });

    // Tapered Upper Octagonal Shaft + Cantilevered Glowing Observation Crown!
    const upY = waistY + 3.0;
    batch.addCylinder(octR * 0.84, octR * 0.9, upperOctH, 8, facadeMat, 0, upY + upperOctH * 0.5, 0, {
      rotY: Math.PI / 8,
      castShadow: true,
      uvScaleU: 1.8,
      uvScaleV: 1.2,
    });
    const crY = upY + upperOctH;
    batch.addCylinder(octR * 0.92, octR * 0.84, 3.2, 8, mats.darkChrome, 0, crY + 1.6, 0, { rotY: Math.PI / 8 });
    batch.addCylinder(octR * 0.94, octR * 0.94, 0.52, 8, mats.warmLampGlow, 0, crY + 2.8, 0, { rotY: Math.PI / 8 });

    // Twin Steel Broadcast Masts with Red Obstruction Beacons
    for (const sx of [-octR * 0.35, octR * 0.35]) {
      batch.addCylinder(0.08, 0.2, 9.2, 6, mats.brushedMetal, sx, crY + 7.4, 0);
      batch.addGeo(new THREE.SphereGeometry(0.4, 8, 8), mats.curbRedPaint, sx, crY + 12.1, 0);
    }
  } else {
    // ARCHETYPE 4: Postmodern Granite Corner-Pier Tower with Illuminated Vaulted Glass Atrium Crown
    const stoneMat = mats.commercialWalls[2];
    batch.addBox(b.w * 0.9, mainH, b.d * 0.9, facadeMat, 0, podH + mainH * 0.5, 0, { castShadow: true });

    // 4 Massive Sculpted Granite Corner Structural Piers (creates iconic notched postmodern silhouette!)
    const pierW = b.w * 0.24;
    const pierD = b.d * 0.24;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        batch.addBox(pierW, mainH + 2.4, pierD, stoneMat, sx * (b.w * 0.5 - pierW * 0.48), podH + (mainH + 2.4) * 0.5, sz * (b.d * 0.5 - pierD * 0.48), {
          castShadow: true,
          uvMeters: 3.6,
        });
      }
    }
    // Horizontal stone spandrel bands tying the corner piers together
    for (const frac of [0.33, 0.66, 1.0]) {
      batch.addBox(b.w + 0.4, 1.35, b.d + 0.4, stoneMat, 0, podH + mainH * frac, 0, { uvMeters: 3.6 });
    }

    // Illuminated Pitched Gable Glass-and-Steel Atrium Crown at the Summit!
    const crownBaseY = podH + mainH + 0.7;
    const crownRise = b.h * 0.2;
    const atrium = makeGablePrismGeo(b.w * 0.86, crownRise, b.d * 0.86, 5.5);
    batch.addGeo(atrium, facadeMat, 0, crownBaseY, 0, { castShadow: true });
    // Glowing steel ridge truss crowning the vaulted glass gable
    batch.addBox(0.65, 0.85, b.d * 0.9, mats.warmLampGlow, 0, crownBaseY + crownRise + 0.2, 0);
    batch.addBox(0.95, 0.65, b.d * 0.92, mats.brassTrim, 0, crownBaseY + crownRise + 0.65, 0);
  }
}

// ============================================================================
// PUBLIC WORLD BUILDER ENTRYPOINT FOR ALL 52 LOS SANTOS BUILDINGS
// ============================================================================

export function buildAllLosSantosBuildings(
  worldGroup: THREE.Group,
  mats: HyperrealMaterialLibrary,
): void {
  const batch = new BuildingMeshBatcher();

  for (const b of BUILDINGS) {
    batch.beginBuilding(b);
    if (b.style === 'grove_house') {
      buildGroveHouseBatched(b, mats, batch);
    } else if (b.style === 'gas_station') {
      buildGasStationBatched(b, mats, batch);
    } else if (b.style === 'commercial') {
      buildCommercialBatched(b, mats, batch);
    } else if (b.style === 'motel') {
      buildMotelBatched(b, mats, batch);
    } else if (b.style === 'art_deco') {
      buildArtDecoBatched(b, mats, batch);
    } else if (b.style === 'apartment') {
      buildApartmentBatched(b, mats, batch);
    } else {
      buildSkyscraperBatched(b, mats, batch);
    }
  }

  batch.flush(worldGroup);
}
