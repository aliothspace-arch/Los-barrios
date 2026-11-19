import * as THREE from 'three';
import type { VehicleSpec } from './types';
import type { HyperrealMaterialLibrary } from './textures';
import { buildAllLosSantosBuildings } from './buildings';
import {
  buildHyperrealCharacterRig,
  disposeCharacterRig,
  disposeMasterCharacterAssets,
  warmMasterCharacterAssets,
  type CharacterBuildOptions,
  type CharacterRig,
} from './characterModels';
import {
  applyTriCoatColor,
  buildHypercarRigInstance,
  disposeMasterHypercarAssets,
  warmMasterHypercarAssets,
  type HypercarArticulation,
} from './rendering/hypercarBuilders';
import {
  CUL_DE_SAC,
  INTERSECTION_CENTERS,
  PALM_POSITIONS,
  ROAD_SEGMENTS,
  SHADE_TREE_POSITIONS,
  SHOPS,
  STREETLAMP_POSITIONS,
  WORLD_HALF_SIZE,
} from './worldLayout';

export {
  applyTriCoatColor,
  disposeCharacterRig,
  disposeMasterCharacterAssets,
  disposeMasterHypercarAssets,
  warmMasterCharacterAssets,
  warmMasterHypercarAssets,
};
export type { CharacterRig, CharacterBuildOptions, HypercarArticulation };

export interface VehicleRig {
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

export function buildVehicleRig(
  spec: VehicleSpec,
  mats: HyperrealMaterialLibrary,
  customPaintHex?: number,
): VehicleRig {
  return buildHypercarRigInstance(spec, customPaintHex, mats.anisotropy);
}

export function disposeVehicleRig(rig: VehicleRig): void {
  rig.root.removeFromParent();
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();

  rig.root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry && !mesh.geometry.userData?.shared) {
      geos.add(mesh.geometry);
    }
    const mat = mesh.material;
    if (Array.isArray(mat)) {
      for (const m of mat) {
        if (m && !m.userData?.shared) mats.add(m);
      }
    } else if (mat && !mat.userData?.shared) {
      mats.add(mat);
    }
  });

  for (const g of geos) g.dispose();
  for (const m of mats) m.dispose();
}

export function disposeVehicleCaches(): void {
  disposeMasterHypercarAssets();
}

// Unified hyperrealistic sculpted character rig shared by protagonist and all NPCs
export function buildCharacterRig(
  mats: HyperrealMaterialLibrary,
  opts: CharacterBuildOptions,
): CharacterRig {
  return buildHyperrealCharacterRig(mats, opts);
}


export interface WorldVisuals {
  worldGroup: THREE.Group;
  checkpointGroup: THREE.Group;
  checkpointRing: THREE.Mesh;
  checkpointColumn: THREE.Mesh;
  shopMarkers: THREE.Group[];
  birdFlock: {
    leftWings: THREE.InstancedMesh;
    rightWings: THREE.InstancedMesh;
    bodies: THREE.InstancedMesh;
    count: number;
  };
  dustMotes: THREE.Points;
}

export function buildLosSantosWorld(
  scene: THREE.Scene,
  mats: HyperrealMaterialLibrary,
): WorldVisuals {
  const worldGroup = new THREE.Group();
  scene.add(worldGroup);

  // 1. Expanded California Terrain & Pacific Coastline (fits WORLD_HALF_SIZE = 185)
  const terrainGeo = new THREE.PlaneGeometry(920, 920, 1, 1);
  terrainGeo.rotateX(-Math.PI * 0.5);
  const terrainMesh = new THREE.Mesh(terrainGeo, mats.terrain);
  terrainMesh.position.y = -0.14;
  terrainMesh.receiveShadow = true;
  worldGroup.add(terrainMesh);

  const oceanGeo = new THREE.PlaneGeometry(1100, 360);
  oceanGeo.rotateX(-Math.PI * 0.5);
  const oceanMesh = new THREE.Mesh(oceanGeo, mats.ocean);
  oceanMesh.position.set(0, -0.35, 330);
  worldGroup.add(oceanMesh);

  // Rolling Vinewood Hills mountain backdrop in the North
  const hillsGeo = new THREE.PlaneGeometry(680, 170, 56, 18);
  hillsGeo.rotateX(-Math.PI * 0.5);
  const posAttr = hillsGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const hx = posAttr.getX(i);
    const hz = posAttr.getZ(i);
    const northFade = Math.max(0, Math.min(1, (-hz + 85) / 120));
    const ridge =
      (Math.sin(hx * 0.019) * 16 +
        Math.cos(hx * 0.043 + 1.2) * 10 +
        28 +
        Math.sin(hz * 0.036) * 7) *
      northFade *
      northFade;
    posAttr.setY(i, Math.max(-0.2, ridge));
  }
  hillsGeo.computeVertexNormals();
  const hillsMesh = new THREE.Mesh(hillsGeo, mats.terrain);
  hillsMesh.position.set(0, -0.2, -255);
  worldGroup.add(hillsMesh);

  // Iconic Illuminated "VINEWOOD" Hillside Sign overlooking Vinewood Blvd
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 1024;
  signCanvas.height = 160;
  const sCtx = signCanvas.getContext('2d')!;
  sCtx.clearRect(0, 0, 1024, 160);
  sCtx.font = 'bold 124px "Bebas Neue", Impact, sans-serif';
  sCtx.textAlign = 'center';
  sCtx.textBaseline = 'middle';
  sCtx.fillStyle = '#e8e2d5';
  sCtx.fillText('V I N E W O O D', 512, 86);
  const vwTex = new THREE.CanvasTexture(signCanvas);
  vwTex.colorSpace = THREE.SRGBColorSpace;
  const vwSign = new THREE.Mesh(
    new THREE.PlaneGeometry(108, 17),
    new THREE.MeshStandardMaterial({
      map: vwTex,
      transparent: true,
      alphaTest: 0.35,
      emissive: new THREE.Color(0xffecc8),
      emissiveMap: vwTex,
      emissiveIntensity: 0.52,
      roughness: 0.72,
    }),
  );
  vwSign.position.set(-54, 40, -222);
  vwSign.rotation.y = 0.14;
  worldGroup.add(vwSign);

  // 2. Concrete City Sidewalk Slab Foundation
  const sidewalkBase = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_HALF_SIZE * 2, WORLD_HALF_SIZE * 2),
    mats.sidewalk,
  );
  sidewalkBase.rotation.x = -Math.PI * 0.5;
  sidewalkBase.position.y = -0.02;
  sidewalkBase.receiveShadow = true;
  worldGroup.add(sidewalkBase);

  // 3. Paved Los Santos Avenues + Grove Street Cul-de-Sac + Weathered Zebra Crosswalks + 4-Way Traffic Light Gantries
  for (let i = 0; i < ROAD_SEGMENTS.length; i++) {
    const r = ROAD_SEGMENTS[i];
    const geo = new THREE.PlaneGeometry(r.w, r.d);
    geo.rotateX(-Math.PI * 0.5);
    const mat = r.orientation === 'ns' ? mats.roadNS : mats.roadEW;
    const road = new THREE.Mesh(geo, mat);
    road.position.set(r.x, r.orientation === 'ns' ? 0.02 : 0.035, r.z);
    road.receiveShadow = true;
    worldGroup.add(road);
  }

  const culGeo = new THREE.CircleGeometry(CUL_DE_SAC.radius, 40);
  culGeo.rotateX(-Math.PI * 0.5);
  const culMesh = new THREE.Mesh(culGeo, mats.culDeSacAsphalt);
  culMesh.position.set(CUL_DE_SAC.x, 0.028, CUL_DE_SAC.z);
  culMesh.receiveShadow = true;
  worldGroup.add(culMesh);

  // Open-Mouth Beveled Concrete Cul-de-Sac Curb Arc (leaves Grove Street -Z road entrance 100% flush & unobstructed!)
  const culCurbSegments = 34;
  const culCurbGeo = new THREE.BoxGeometry(2.65, 0.16, 0.42);
  const culCurbInst = new THREE.InstancedMesh(culCurbGeo, mats.curbConcrete, culCurbSegments);
  culCurbInst.receiveShadow = true;
  culCurbInst.castShadow = true;
  const culDummy = new THREE.Object3D();
  let culIdx = 0;
  for (let i = 0; i < 42; i++) {
    const ang = (i / 42) * Math.PI * 2;
    const cx = CUL_DE_SAC.x + Math.cos(ang) * (CUL_DE_SAC.radius + 0.16);
    const cz = CUL_DE_SAC.z + Math.sin(ang) * (CUL_DE_SAC.radius + 0.16);
    // Skip the Grove Street northern road throat (x within road width & north of cul-de-sac center)
    if (cz < CUL_DE_SAC.z && Math.abs(cx - CUL_DE_SAC.x) < 8.1) continue;
    if (culIdx >= culCurbSegments) break;
    culDummy.position.set(cx, 0.075, cz);
    culDummy.rotation.set(0, -ang + Math.PI * 0.5, 0);
    culDummy.scale.set(1, 1, 1);
    culDummy.updateMatrix();
    culCurbInst.setMatrixAt(culIdx++, culDummy.matrix);
  }
  culCurbInst.count = culIdx;
  culCurbInst.instanceMatrix.needsUpdate = true;
  culCurbInst.computeBoundingSphere();
  worldGroup.add(culCurbInst);

  // Pillar 2: Instanced 3D Beveled Road Curbs, Red Fire-Zone Corner Curbs & Gutter Storm Drains
  const curbBlocks: Array<{ x: number; z: number; sx: number; sz: number; isRed: boolean }> = [];
  const drainPos: Array<{ x: number; z: number; rotY: number }> = [];
  const isNearIntersectionOrCul = (x: number, z: number): boolean => {
    if (Math.hypot(x - CUL_DE_SAC.x, z - CUL_DE_SAC.z) < CUL_DE_SAC.radius + 1.8) return true;
    for (const ic of INTERSECTION_CENTERS) {
      if (Math.abs(x - ic.x) < 8.4 && Math.abs(z - ic.z) < 8.4) return true;
    }
    return false;
  };
  const isNearCornerRedZone = (x: number, z: number): boolean => {
    for (const ic of INTERSECTION_CENTERS) {
      const dx = Math.abs(x - ic.x);
      const dz = Math.abs(z - ic.z);
      if (dx < 13.0 && dz < 13.0 && (dx >= 8.4 || dz >= 8.4)) return true;
    }
    return false;
  };

  for (const r of ROAD_SEGMENTS) {
    if (r.orientation === 'ns') {
      const zMin = r.z - r.d * 0.5;
      const zMax = r.z + r.d * 0.5;
      for (const side of [-1, 1]) {
        const cx = r.x + side * (r.w * 0.5 + 0.18);
        for (let z = zMin + 2.5; z < zMax - 2.0; z += 5.0) {
          if (isNearIntersectionOrCul(cx, z)) continue;
          const isRed = isNearCornerRedZone(cx, z);
          curbBlocks.push({ x: cx, z, sx: 0.36, sz: 4.92, isRed });
          if (isRed && Math.abs(z % 15) < 5) {
            drainPos.push({ x: r.x + side * (r.w * 0.5 - 0.48), z, rotY: 0 });
          }
        }
      }
    } else {
      const xMin = r.x - r.w * 0.5;
      const xMax = r.x + r.w * 0.5;
      for (const side of [-1, 1]) {
        const cz = r.z + side * (r.d * 0.5 + 0.18);
        for (let x = xMin + 2.5; x < xMax - 2.0; x += 5.0) {
          if (isNearIntersectionOrCul(x, cz)) continue;
          const isRed = isNearCornerRedZone(x, cz);
          curbBlocks.push({ x, z: cz, sx: 4.92, sz: 0.36, isRed });
          if (isRed && Math.abs(x % 15) < 5) {
            drainPos.push({ x, z: r.z + side * (r.d * 0.5 - 0.48), rotY: Math.PI * 0.5 });
          }
        }
      }
    }
  }

  const curbGeo = new THREE.BoxGeometry(1, 0.15, 1);
  const concreteCurbs = curbBlocks.filter((c) => !c.isRed);
  const redCurbs = curbBlocks.filter((c) => c.isRed);
  const curbDummy = new THREE.Object3D();

  const curbInst = new THREE.InstancedMesh(curbGeo, mats.curbConcrete, concreteCurbs.length);
  curbInst.receiveShadow = true;
  for (let i = 0; i < concreteCurbs.length; i++) {
    const c = concreteCurbs[i];
    curbDummy.position.set(c.x, 0.075, c.z);
    curbDummy.rotation.set(0, 0, 0);
    curbDummy.scale.set(c.sx, 1, c.sz);
    curbDummy.updateMatrix();
    curbInst.setMatrixAt(i, curbDummy.matrix);
  }
  curbInst.instanceMatrix.needsUpdate = true;
  curbInst.computeBoundingSphere();

  const redCurbInst = new THREE.InstancedMesh(curbGeo, mats.curbRedPaint, redCurbs.length);
  redCurbInst.receiveShadow = true;
  for (let i = 0; i < redCurbs.length; i++) {
    const c = redCurbs[i];
    curbDummy.position.set(c.x, 0.075, c.z);
    curbDummy.rotation.set(0, 0, 0);
    curbDummy.scale.set(c.sx, 1, c.sz);
    curbDummy.updateMatrix();
    redCurbInst.setMatrixAt(i, curbDummy.matrix);
  }
  redCurbInst.instanceMatrix.needsUpdate = true;
  redCurbInst.computeBoundingSphere();

  const drainGeo = new THREE.PlaneGeometry(0.68, 1.15);
  drainGeo.rotateX(-Math.PI * 0.5);
  const drainInst = new THREE.InstancedMesh(drainGeo, mats.stormDrainMat, drainPos.length);
  for (let i = 0; i < drainPos.length; i++) {
    const d = drainPos[i];
    curbDummy.position.set(d.x, 0.042, d.z);
    curbDummy.rotation.set(0, d.rotY, 0);
    curbDummy.scale.set(1, 1, 1);
    curbDummy.updateMatrix();
    drainInst.setMatrixAt(i, curbDummy.matrix);
  }
  drainInst.instanceMatrix.needsUpdate = true;
  drainInst.computeBoundingSphere();
  worldGroup.add(curbInst, redCurbInst, drainInst);

  // Pillar 6: Upgraded Authentic Los Angeles Traffic Light Gantries (Galvanized Mast, Yellow-Border Backplates,
  // Hanging Green Street-Name Plaques, Pedestrian Signal Boxes & Sidewalk Controller Cabinets) + Zebra Crosswalks
  const cwGeo = new THREE.PlaneGeometry(12.2, 2.7);
  cwGeo.rotateX(-Math.PI * 0.5);
  const cwInst = new THREE.InstancedMesh(
    cwGeo,
    mats.crosswalkMat,
    INTERSECTION_CENTERS.length * 4,
  );
  const cwDummy = new THREE.Object3D();
  let cwIdx = 0;

  const tlPoleGeo = new THREE.CylinderGeometry(0.15, 0.22, 6.7, 10);
  tlPoleGeo.translate(0, 3.35, 0);
  const tlBaseGeo = new THREE.CylinderGeometry(0.32, 0.36, 0.42, 10);
  tlBaseGeo.translate(0, 0.21, 0);
  const tlArmGeo = new THREE.CylinderGeometry(0.09, 0.14, 5.2, 8);
  tlArmGeo.rotateZ(Math.PI * 0.5);
  tlArmGeo.translate(2.6, 6.3, 0);
  const tlBackplateGeo = new THREE.BoxGeometry(0.68, 1.38, 0.12);
  const tlBoxGeo = new THREE.BoxGeometry(0.46, 1.16, 0.38);
  const tlStreetSignGeo = new THREE.BoxGeometry(1.85, 0.38, 0.08);
  const tlCabinetGeo = new THREE.BoxGeometry(0.76, 1.35, 0.56);
  tlCabinetGeo.translate(0, 0.68, 0);

  const tlBackplateMat = new THREE.MeshStandardMaterial({
    color: 0x181a1d,
    roughness: 0.6,
    metalness: 0.3,
  });
  const tlStreetSignMat = new THREE.MeshStandardMaterial({
    color: 0x165e3a,
    emissive: new THREE.Color(0x1f7a4c),
    emissiveIntensity: 0.45,
    roughness: 0.35,
  });
  const tlGreenMat = new THREE.MeshStandardMaterial({
    color: 0x35e06d,
    emissive: new THREE.Color(0x2be066),
    emissiveIntensity: 1.4,
    roughness: 0.2,
  });
  const tlRedMat = new THREE.MeshStandardMaterial({
    color: 0xf0382b,
    emissive: new THREE.Color(0xff2a1e),
    emissiveIntensity: 1.4,
    roughness: 0.2,
  });

  const tlCount = INTERSECTION_CENTERS.length * 2;
  const tlPoleInst = new THREE.InstancedMesh(tlPoleGeo, mats.brushedMetal, tlCount);
  const tlBaseInst = new THREE.InstancedMesh(tlBaseGeo, mats.curbConcrete, tlCount);
  const tlArmInst = new THREE.InstancedMesh(tlArmGeo, mats.brushedMetal, tlCount);
  const tlBackplateInst = new THREE.InstancedMesh(tlBackplateGeo, tlBackplateMat, tlCount);
  const tlBoxInst = new THREE.InstancedMesh(tlBoxGeo, mats.darkChrome, tlCount);
  const tlSignInst = new THREE.InstancedMesh(tlStreetSignGeo, tlStreetSignMat, tlCount);
  const tlCabinetInst = new THREE.InstancedMesh(
    tlCabinetGeo,
    mats.brushedMetal,
    INTERSECTION_CENTERS.length,
  );
  const tlBulbGreenInst = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.12, 8, 8),
    tlGreenMat,
    INTERSECTION_CENTERS.length,
  );
  const tlBulbRedInst = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.12, 8, 8),
    tlRedMat,
    INTERSECTION_CENTERS.length,
  );

  for (let i = 0; i < INTERSECTION_CENTERS.length; i++) {
    const ic = INTERSECTION_CENTERS[i];
    // 4 Zebra Crosswalks around intersection perimeter (offset ±9.2m)
    const dirs = [
      { dx: 0, dz: -9.2, rot: 0 },
      { dx: 0, dz: 9.2, rot: 0 },
      { dx: -9.2, dz: 0, rot: Math.PI * 0.5 },
      { dx: 9.2, dz: 0, rot: Math.PI * 0.5 },
    ];
    for (const d of dirs) {
      cwDummy.position.set(ic.x + d.dx, 0.045, ic.z + d.dz);
      cwDummy.rotation.set(0, d.rot, 0);
      cwDummy.scale.set(1, 1, 1);
      cwDummy.updateMatrix();
      cwInst.setMatrixAt(cwIdx++, cwDummy.matrix);
    }

    // 2 Diagonal Sidewalk-Corner Traffic Light Gantries (placed at ±8.6m, well outside ±7m road lanes!)
    const corners = [
      { x: ic.x - 8.6, z: ic.z - 8.6, rot: 0, isGreen: true },
      { x: ic.x + 8.6, z: ic.z + 8.6, rot: Math.PI, isGreen: false },
    ];
    for (let c = 0; c < 2; c++) {
      const cn = corners[c];
      const idx = i * 2 + c;
      cwDummy.position.set(cn.x, 0, cn.z);
      cwDummy.rotation.set(0, cn.rot, 0);
      cwDummy.scale.set(1, 1, 1);
      cwDummy.updateMatrix();
      tlPoleInst.setMatrixAt(idx, cwDummy.matrix);
      tlBaseInst.setMatrixAt(idx, cwDummy.matrix);
      tlArmInst.setMatrixAt(idx, cwDummy.matrix);

      // Galvanized Traffic Signal Controller Cabinet tucked behind corner pole
      if (c === 0) {
        cwDummy.position.set(cn.x - 1.15, 0, cn.z - 0.85);
        cwDummy.rotation.set(0, 0, 0);
        cwDummy.updateMatrix();
        tlCabinetInst.setMatrixAt(i, cwDummy.matrix);
      }

      // Hanging green LA street-name sign midway along mast arm
      const sx = cn.x + Math.cos(cn.rot) * 1.95;
      const sz = cn.z - Math.sin(cn.rot) * 1.95;
      cwDummy.position.set(sx, 6.08, sz);
      cwDummy.rotation.set(0, cn.rot, 0);
      cwDummy.updateMatrix();
      tlSignInst.setMatrixAt(idx, cwDummy.matrix);

      // Signal housing + dark contrast backplate
      const bx = cn.x + Math.cos(cn.rot) * 4.1;
      const bz = cn.z - Math.sin(cn.rot) * 4.1;
      cwDummy.position.set(bx, 5.82, bz);
      cwDummy.rotation.set(0, cn.rot, 0);
      cwDummy.updateMatrix();
      tlBoxInst.setMatrixAt(idx, cwDummy.matrix);
      tlBackplateInst.setMatrixAt(idx, cwDummy.matrix);

      cwDummy.position.set(bx, cn.isGreen ? 5.48 : 6.14, bz + (cn.isGreen ? 0.21 : -0.21));
      cwDummy.updateMatrix();
      if (cn.isGreen) {
        tlBulbGreenInst.setMatrixAt(i, cwDummy.matrix);
      } else {
        tlBulbRedInst.setMatrixAt(i, cwDummy.matrix);
      }
    }
  }
  cwInst.instanceMatrix.needsUpdate = true;
  cwInst.computeBoundingSphere();
  tlPoleInst.instanceMatrix.needsUpdate = true;
  tlPoleInst.computeBoundingSphere();
  tlBaseInst.instanceMatrix.needsUpdate = true;
  tlBaseInst.computeBoundingSphere();
  tlArmInst.instanceMatrix.needsUpdate = true;
  tlArmInst.computeBoundingSphere();
  tlBackplateInst.instanceMatrix.needsUpdate = true;
  tlBackplateInst.computeBoundingSphere();
  tlBoxInst.instanceMatrix.needsUpdate = true;
  tlBoxInst.computeBoundingSphere();
  tlSignInst.instanceMatrix.needsUpdate = true;
  tlSignInst.computeBoundingSphere();
  tlCabinetInst.instanceMatrix.needsUpdate = true;
  tlCabinetInst.computeBoundingSphere();
  tlBulbGreenInst.instanceMatrix.needsUpdate = true;
  tlBulbGreenInst.computeBoundingSphere();
  tlBulbRedInst.instanceMatrix.needsUpdate = true;
  tlBulbRedInst.computeBoundingSphere();
  worldGroup.add(
    cwInst,
    tlPoleInst,
    tlBaseInst,
    tlArmInst,
    tlBackplateInst,
    tlBoxInst,
    tlSignInst,
    tlCabinetInst,
    tlBulbGreenInst,
    tlBulbRedInst,
  );

  // 4. All 52 Hyperrealistic Los Santos Buildings across 19+ Distinct Procedural Architectural Archetypes
  //    (4-Quadrant GPU-Batched Geometry, World-Scale Seamless Cladding UVs, Recessed 3D Interior-Mapped Windows)
  buildAllLosSantosBuildings(worldGroup, mats);

  // 5. Hyperrealistic Botanical California Fan Palms (2 Sculpted 3D Annulated Trunk Archetypes +
  //    Grounded Root Soil Collars + Shaggy Layered Dead-Frond Petticoats + Hanging Date Panicles +
  //    22 True 3D V-Folded Double-Arched Pinnate Fronds per Palm across 4 Phyllotactic Tiers — 100% GPU-Instanced!)
  const buildSculptedPalmTrunkGeometry = (
    curve: THREE.CatmullRomCurve3,
    tubularSegments: number,
    radialSegments: number,
  ): THREE.BufferGeometry => {
    const frames = curve.computeFrenetFrames(tubularSegments, false);
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const v = new THREE.Vector3();

    for (let i = 0; i <= tubularSegments; i++) {
      const t = i / tubularSegments;
      curve.getPointAt(t, p);
      const N = frames.normals[i];
      const B = frames.binormals[i];

      // Anatomical palm trunk radius profile:
      // 1) Flared basal root buttress (t: 0 -> 0.09)
      // 2) Gradual slender California taper (0.31m -> 0.195m)
      // 3) 3D annulated horizontal leaf-scar rings along shaft
      // 4) Persistent fibrous diamond petiole-boot crown swell (t: 0.87 -> 1.0)
      const rootFlare = Math.exp(-t * 22.0) * 0.175;
      const baseTaper = 0.315 - t * 0.118;
      const ringWave = Math.pow(0.5 + 0.5 * Math.sin(t * Math.PI * 30.0), 1.7);
      const ringRelief = t > 0.05 && t < 0.9 ? ringWave * 0.022 : 0.0;
      const crownSwell =
        t > 0.84
          ? Math.sin(((t - 0.84) / 0.16) * Math.PI * 0.82) * 0.145
          : 0.0;
      const baseRadius = baseTaper + rootFlare + ringRelief + crownSwell;

      // Baked vertex AO: darkens soil contact line & deep shadow directly beneath dense frond canopy
      const rootAO = 0.64 + 0.36 * Math.min(1, t / 0.08);
      const canopyAO = t > 0.82 ? 1.0 - ((t - 0.82) / 0.18) * 0.44 : 1.0;
      const ringAO = 0.91 + 0.09 * ringWave;
      const ao = rootAO * canopyAO * ringAO;
      // Subtle weathered silver-gray sun-bleaching mid-trunk vs warmer fibrous crown
      const rCol = ao * (0.98 + (1 - t) * 0.04);
      const gCol = ao * (0.96 + (1 - t) * 0.02);
      const bCol = ao * (0.94 + Math.sin(t * Math.PI) * 0.06);

      for (let j = 0; j <= radialSegments; j++) {
        const u = j / radialSegments;
        const theta = u * Math.PI * 2;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);

        // 5-lobed organic root fluting near ground + subtle trunk organic asymmetry
        const flute = Math.exp(-t * 18.0) * Math.cos(theta * 5.0) * 0.036;
        const oval = 1.0 + Math.sin(theta * 2.0 + t * 5.0) * 0.035;
        const rad = (baseRadius + flute) * oval;

        n.set(
          cosT * N.x + sinT * B.x,
          cosT * N.y + sinT * B.y,
          cosT * N.z + sinT * B.z,
        ).normalize();

        v.copy(p).addScaledVector(n, rad);
        positions.push(v.x, v.y, v.z);
        normals.push(n.x, n.y, n.z);
        uvs.push(u, t);
        colors.push(rCol, gCol, bCol);
      }
    }

    const stride = radialSegments + 1;
    for (let i = 0; i < tubularSegments; i++) {
      for (let j = 0; j < radialSegments; j++) {
        const a = i * stride + j;
        const b = (i + 1) * stride + j;
        const c = (i + 1) * stride + (j + 1);
        const d = i * stride + (j + 1);
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  };

  // True 3D Sculpted V-Folded & Double-Arched Pinnate Frond Geometry (zero paper-thin flat strip look!)
  const buildSculptedPalmFrondGeometry = (): THREE.BufferGeometry => {
    const geo = new THREE.PlaneGeometry(2.35, 5.25, 6, 14);
    geo.translate(0, 2.625, 0);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const rawX = pos.getX(i);
      const rawY = pos.getY(i);
      const t = rawY / 5.25; // 0 = woody petiole attachment at crown, 1 = weeping outer tip
      const uNorm = rawX / 1.175; // -1..+1 across leaflet wings
      const absU = Math.abs(uNorm);

      // Graceful parabolic longitudinal arch: rises strongly out of crownshaft, then weeps downward
      const archLift = Math.sin(Math.pow(t, 0.75) * Math.PI * 0.84) * 1.12;
      const gravityDroop = -Math.pow(t, 2.15) * 2.38;
      const outZ = t * 4.48;

      // Transverse 3D botanical V-keel at rachis + gravity-drooping outer leaflet tips!
      const canopyEnv = Math.sin(t * Math.PI * 0.94 + 0.06);
      const vKeelRise = (1.0 - Math.abs(absU - 0.34) * 2.1) * 0.14 * canopyEnv;
      const wingDroop = -Math.pow(absU, 1.75) * 0.56 * canopyEnv;
      // Subtle forward sweep of leaflets along the rachis
      const leafletSweepZ = absU * 0.24 * canopyEnv;
      // Slight organic axial roll toward outer tip so sunlight catches facets asymmetrically
      const twist = Math.sin(t * Math.PI * 0.85) * 0.16 * uNorm * canopyEnv;

      // Narrow slightly at very base petiole so stems merge cleanly into the crown heart
      const widthPinch = t < 0.14 ? 0.45 + (t / 0.14) * 0.55 : 1.0;

      pos.setXYZ(
        i,
        rawX * widthPinch,
        archLift + gravityDroop + Math.max(0, vKeelRise) + wingDroop + twist,
        outZ + leafletSweepZ,
      );
    }
    geo.computeVertexNormals();
    return geo;
  };

  // Shaggy Layered Dried-Frond Skirt Geometry (replaces the old smooth geometric ConeGeometry!)
  const buildDeadSkirtFrondGeometry = (): THREE.BufferGeometry => {
    const geo = new THREE.PlaneGeometry(1.12, 2.35, 4, 7);
    // PlaneGeometry has uv.y=1 at y=+1.175 (attachment) and uv.y=0 at y=-1.175 (hanging ragged tips)
    geo.translate(0, -1.175, 0);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const t = Math.max(0, Math.min(1, -y / 2.35)); // 0 at top attachment, 1 at bottom frayed tip
      const absU = Math.abs(x / 0.56);
      // Drapes outward over the crownshaft bulge, then hangs close & ragged around upper trunk
      const outwardZ = 0.24 + Math.sin(t * Math.PI * 0.72) * 0.42 - t * 0.16;
      const cupCurve = -absU * absU * 0.16;
      pos.setXYZ(i, x * (0.72 + t * 0.42), y, outwardZ + cupCurve);
    }
    geo.computeVertexNormals();
    return geo;
  };

  // Sculpted Hanging Golden Date/Fruit Panicle Cluster Geometry
  const buildDateClusterGeometry = (): THREE.BufferGeometry => {
    const geo = new THREE.SphereGeometry(0.18, 8, 7);
    geo.scale(0.82, 1.85, 0.78);
    geo.translate(0, -0.32, 0.28);
    return geo;
  };

  const palmCount = PALM_POSITIONS.length;

  // 2 Distinct Curved California Trunk Archetypes for authentic organic street variation
  const trunkCurveA = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.32, 3.8, 0.14),
    new THREE.Vector3(0.12, 7.8, -0.14),
    new THREE.Vector3(-0.24, 11.7, 0.22),
  ]);
  const trunkCurveB = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-0.26, 4.1, 0.24),
    new THREE.Vector3(-0.08, 8.4, 0.42),
    new THREE.Vector3(0.34, 12.5, 0.18),
  ]);

  const trunkGeoA = buildSculptedPalmTrunkGeometry(trunkCurveA, 40, 14);
  const trunkGeoB = buildSculptedPalmTrunkGeometry(trunkCurveB, 40, 14);
  const countA = Math.ceil(palmCount / 2);
  const countB = palmCount - countA;

  const trunkInstA = new THREE.InstancedMesh(trunkGeoA, mats.palmBark, countA);
  trunkInstA.castShadow = true;
  trunkInstA.receiveShadow = true;
  const trunkInstB = new THREE.InstancedMesh(trunkGeoB, mats.palmBark, countB);
  trunkInstB.castShadow = true;
  trunkInstB.receiveShadow = true;

  // Grounded dark planter soil/mulch collar anchoring every flared root base cleanly to the sidewalk/grass
  const rootSoilGeo = new THREE.CylinderGeometry(0.46, 0.64, 0.08, 12);
  rootSoilGeo.translate(0, 0.04, 0);
  const rootSoilInst = new THREE.InstancedMesh(rootSoilGeo, mats.palmSoilMat, palmCount);
  rootSoilInst.receiveShadow = true;

  const deadSkirtPerPalm = 9;
  const deadSkirtGeo = buildDeadSkirtFrondGeometry();
  const deadSkirtInst = new THREE.InstancedMesh(
    deadSkirtGeo,
    mats.palmDeadFrond,
    palmCount * deadSkirtPerPalm,
  );
  deadSkirtInst.castShadow = true;

  const dateClustersPerPalm = 3;
  const dateGeo = buildDateClusterGeometry();
  const dateInst = new THREE.InstancedMesh(
    dateGeo,
    mats.palmDateMat,
    palmCount * dateClustersPerPalm,
  );

  const frondsPerPalm = 22;
  const frondGeo = buildSculptedPalmFrondGeometry();
  const frondInst = new THREE.InstancedMesh(
    frondGeo,
    mats.palmFrond,
    palmCount * frondsPerPalm,
  );
  frondInst.castShadow = true;

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  const upAxis = new THREE.Vector3(0, 1, 0);
  const topLocalA = trunkCurveA.getPointAt(0.985);
  const topLocalB = trunkCurveB.getPointAt(0.985);
  const crownPos = new THREE.Vector3();

  let idxA = 0;
  let idxB = 0;
  let deadIdx = 0;
  let dateIdx = 0;
  let frondIdx = 0;

  for (let i = 0; i < palmCount; i++) {
    const p = PALM_POSITIONS[i];
    const isB = i % 2 === 1;
    const scale = 0.86 + ((i * 37) % 100) * 0.0032;
    const girthScale = scale * (0.94 + ((i * 19) % 13) * 0.01);
    const rotY = (i * 2.399963) % (Math.PI * 2);

    dummy.position.set(p.x, 0, p.z);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(girthScale, scale, girthScale);
    dummy.updateMatrix();
    if (isB) {
      trunkInstB.setMatrixAt(idxB++, dummy.matrix);
    } else {
      trunkInstA.setMatrixAt(idxA++, dummy.matrix);
    }

    // Grounded root-soil collar
    dummy.position.set(p.x, 0, p.z);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(girthScale, 1, girthScale);
    dummy.updateMatrix();
    rootSoilInst.setMatrixAt(i, dummy.matrix);

    // Exact world-space crown heart position matching the curved trunk tip
    crownPos.copy(isB ? topLocalB : topLocalA);
    crownPos.set(crownPos.x * girthScale, crownPos.y * scale, crownPos.z * girthScale);
    crownPos.applyAxisAngle(upAxis, rotY);
    const cx = p.x + crownPos.x;
    const cy = crownPos.y;
    const cz = p.z + crownPos.z;

    // Shaggy Layered Dried-Frond Petticoat Skirt (9 organic drooping ragged dried fronds per palm)
    for (let d = 0; d < deadSkirtPerPalm; d++) {
      const da = rotY + (d / deadSkirtPerPalm) * Math.PI * 2 + ((i + d) % 3) * 0.14;
      const dScaleY = scale * (0.82 + ((i * 7 + d * 13) % 10) * 0.042);
      const dScaleX = scale * (0.86 + (d % 3) * 0.12);
      const flarePitch = -0.06 - (d % 3) * 0.09;
      dummy.position.set(cx, cy - 0.14 * scale - (d % 2) * 0.18 * scale, cz);
      dummy.rotation.set(flarePitch, da, ((d % 3) - 1) * 0.08);
      dummy.scale.set(dScaleX, dScaleY, dScaleX);
      dummy.updateMatrix();
      deadSkirtInst.setMatrixAt(deadIdx, dummy.matrix);
      tint.setHSL(
        0.09 + ((i + d) % 4) * 0.01,
        0.34 + (d % 2) * 0.08,
        0.42 + ((i + d) % 3) * 0.065,
      );
      deadSkirtInst.setColorAt(deadIdx, tint);
      deadIdx++;
    }

    // Hanging Golden Date Panicles tucked below the lower green petioles
    for (let dc = 0; dc < dateClustersPerPalm; dc++) {
      const dca = rotY + (dc / dateClustersPerPalm) * Math.PI * 2 + 0.5;
      dummy.position.set(cx, cy - 0.18 * scale, cz);
      dummy.rotation.set(0.28, dca, 0);
      dummy.scale.setScalar(scale * (0.85 + (dc % 2) * 0.2));
      dummy.updateMatrix();
      dateInst.setMatrixAt(dateIdx++, dummy.matrix);
    }

    // 22 Lush 3D Sculpted Fronds arranged in 4 Botanical Phyllotactic Fibonacci Tiers
    for (let f = 0; f < frondsPerPalm; f++) {
      let tier: number;
      let pitch: number;
      let fScale: number;
      let yOff: number;
      let hue: number;
      let sat: number;
      let light: number;

      if (f < 4) {
        // Tier 0: 4 Young Central Erect Spear Fronds (bright fresh chartreuse-emerald)
        tier = 0;
        pitch = -0.94 + (f / 4) * 0.28;
        fScale = scale * (0.68 + (f % 2) * 0.09);
        yOff = 0.28 * scale;
        hue = 0.235 + ((i + f) % 3) * 0.012;
        sat = 0.44;
        light = 0.46 + (f % 2) * 0.04;
      } else if (f < 10) {
        // Tier 1: 6 Upper Crown Sweeping Fronds (rich sunlit California green)
        tier = 1;
        pitch = -0.46 + ((f - 4) / 6) * 0.26;
        fScale = scale * (0.88 + (f % 3) * 0.06);
        yOff = 0.14 * scale;
        hue = 0.255 + ((i + f) % 4) * 0.011;
        sat = 0.38;
        light = 0.40 + (f % 3) * 0.035;
      } else if (f < 17) {
        // Tier 2: 7 Full Mid Canopy Arching Fronds (broad iconic Los Santos silhouette)
        tier = 2;
        pitch = -0.06 + ((f - 10) / 7) * 0.24;
        fScale = scale * (1.02 + (f % 3) * 0.065);
        yOff = 0.0;
        hue = 0.265 + ((i + f) % 5) * 0.01;
        sat = 0.34;
        light = 0.35 + (f % 3) * 0.03;
      } else {
        // Tier 3: 5 Mature Lower Weeping Outer Fronds (sun-kissed warm olive-emerald)
        tier = 3;
        pitch = 0.26 + ((f - 17) / 5) * 0.26;
        fScale = scale * (0.96 + (f % 2) * 0.09);
        yOff = -0.14 * scale;
        hue = 0.215 + ((i + f) % 4) * 0.012;
        sat = 0.32;
        light = 0.33 + (f % 3) * 0.03;
      }

      // True Fibonacci golden-angle phyllotaxis so fronds fan naturally in 3D with zero artificial symmetry
      const fa = rotY + f * 2.399963 + tier * 0.22;
      const roll = (((i * 13 + f * 7) % 11) - 5) * 0.032;

      dummy.position.set(cx, cy + yOff, cz);
      dummy.rotation.set(pitch, fa, roll);
      dummy.scale.set(fScale, fScale, fScale);
      dummy.updateMatrix();
      frondInst.setMatrixAt(frondIdx, dummy.matrix);
      tint.setHSL(hue, sat, light);
      frondInst.setColorAt(frondIdx, tint);
      frondIdx++;
    }
  }

  trunkInstA.instanceMatrix.needsUpdate = true;
  trunkInstA.computeBoundingSphere();
  trunkInstB.instanceMatrix.needsUpdate = true;
  trunkInstB.computeBoundingSphere();
  rootSoilInst.instanceMatrix.needsUpdate = true;
  rootSoilInst.computeBoundingSphere();
  deadSkirtInst.instanceMatrix.needsUpdate = true;
  if (deadSkirtInst.instanceColor) deadSkirtInst.instanceColor.needsUpdate = true;
  deadSkirtInst.computeBoundingSphere();
  dateInst.instanceMatrix.needsUpdate = true;
  dateInst.computeBoundingSphere();
  frondInst.instanceMatrix.needsUpdate = true;
  if (frondInst.instanceColor) frondInst.instanceColor.needsUpdate = true;
  frondInst.computeBoundingSphere();

  worldGroup.add(
    trunkInstA,
    trunkInstB,
    rootSoilInst,
    deadSkirtInst,
    dateInst,
    frondInst,
  );

  // 6. Lush Branching California Shade & Jacaranda Street Trees (Instanced Multi-Card Botanical Foliage Canopies)
  // Batches 420 individual tree meshes into 4 high-speed InstancedMeshes with 100% identical geometry & transforms!
  const shadeTrunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 3.4, 8);
  shadeTrunkGeo.translate(0, 1.7, 0);
  const shadeBranchGeo = new THREE.CylinderGeometry(0.06, 0.14, 2.3, 7);
  shadeBranchGeo.translate(0, 1.15, 0);
  const leafCardGeo = new THREE.PlaneGeometry(3.2, 3.2);

  const shadeCount = SHADE_TREE_POSITIONS.length;
  const jacarandaCount = SHADE_TREE_POSITIONS.filter((s) => s.isJacaranda).length;
  const greenShadeCount = shadeCount - jacarandaCount;

  const shadeTrunkInst = new THREE.InstancedMesh(shadeTrunkGeo, mats.shadeBark, shadeCount);
  shadeTrunkInst.castShadow = true;
  shadeTrunkInst.receiveShadow = true;

  const shadeBranchInst = new THREE.InstancedMesh(shadeBranchGeo, mats.shadeBark, shadeCount * 4);
  const shadeLeafGreenInst = new THREE.InstancedMesh(leafCardGeo, mats.shadeLeafGreen, greenShadeCount * 15);
  const shadeLeafJacarandaInst = new THREE.InstancedMesh(leafCardGeo, mats.shadeLeafJacaranda, jacarandaCount * 15);

  const cardClusters = [
    { x: 0, y: 5.0, z: 0, s: 1.2 },
    { x: 1.35, y: 4.35, z: 0.65, s: 0.96 },
    { x: -1.3, y: 4.45, z: 0.85, s: 0.98 },
    { x: 0.65, y: 4.25, z: -1.3, s: 0.95 },
    { x: -0.95, y: 4.55, z: -1.0, s: 0.92 },
  ];

  let branchIdx = 0;
  let greenCardIdx = 0;
  let jacCardIdx = 0;

  for (let i = 0; i < shadeCount; i++) {
    const st = SHADE_TREE_POSITIONS[i];
    const sc = 0.88 + ((i * 29) % 100) * 0.003;

    dummy.position.set(st.x, 0, st.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(sc);
    dummy.updateMatrix();
    shadeTrunkInst.setMatrixAt(i, dummy.matrix);

    for (let b = 0; b < 4; b++) {
      const ba = (b / 4) * Math.PI * 2 + i * 0.7;
      dummy.position.set(st.x, 2.5 * sc, st.z);
      dummy.rotation.set(0.54, ba, 0);
      dummy.scale.setScalar(sc);
      dummy.updateMatrix();
      shadeBranchInst.setMatrixAt(branchIdx++, dummy.matrix);
    }

    for (let c = 0; c < cardClusters.length; c++) {
      const cl = cardClusters[c];
      for (let k = 0; k < 3; k++) {
        dummy.position.set(st.x + cl.x * sc, cl.y * sc, st.z + cl.z * sc);
        dummy.rotation.set(
          k === 2 ? Math.PI * 0.38 : 0.14 * (k - 0.5),
          (k / 3) * Math.PI + c * 0.7 + i,
          0.12 * (c % 2 === 0 ? 1 : -1),
        );
        dummy.scale.setScalar(sc * cl.s);
        dummy.updateMatrix();
        if (st.isJacaranda) {
          shadeLeafJacarandaInst.setMatrixAt(jacCardIdx++, dummy.matrix);
        } else {
          shadeLeafGreenInst.setMatrixAt(greenCardIdx++, dummy.matrix);
        }
      }
    }
  }

  shadeTrunkInst.instanceMatrix.needsUpdate = true;
  shadeTrunkInst.computeBoundingSphere();
  shadeBranchInst.instanceMatrix.needsUpdate = true;
  shadeBranchInst.computeBoundingSphere();
  shadeLeafGreenInst.instanceMatrix.needsUpdate = true;
  shadeLeafGreenInst.computeBoundingSphere();
  shadeLeafJacarandaInst.instanceMatrix.needsUpdate = true;
  shadeLeafJacarandaInst.computeBoundingSphere();
  worldGroup.add(shadeTrunkInst, shadeBranchInst, shadeLeafGreenInst, shadeLeafJacarandaInst);

  // 7. Instanced Los Santos Gooseneck Streetlamps + Urban Street Props (Fire Hydrants & Benches)
  const lampCount = STREETLAMP_POSITIONS.length;
  const lampCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 6.2, 0),
    new THREE.Vector3(0, 7.6, 0.9),
    new THREE.Vector3(0, 7.4, 2.3),
  ]);
  const poleGeo = new THREE.TubeGeometry(lampCurve, 12, 0.11, 8, false);
  const poleInst = new THREE.InstancedMesh(poleGeo, mats.darkChrome, lampCount);
  const bulbGeo = new THREE.BoxGeometry(0.45, 0.16, 0.65);
  const bulbInst = new THREE.InstancedMesh(bulbGeo, mats.streetlampGlow, lampCount);

  // Multi-Part Weathered Cast-Iron Fire Hydrants near sidewalk curbs (flanged barrel, bonnet dome, side nozzles + contact shadow!)
  const hydrantPositions = [
    { x: -8.6, z: -18 },
    { x: 8.6, z: -31 },
    { x: -24, z: -34.2 },
    { x: 24, z: -34.2 },
    { x: -10, z: -87.5 },
    { x: 10, z: -87.5 },
    { x: 58.6, z: -8 },
    { x: -58.6, z: 8 },
    { x: -8.6, z: -60 },
    { x: 8.6, z: -74 },
  ];
  const hydrantBarrelGeo = new THREE.CylinderGeometry(0.125, 0.165, 0.72, 10);
  hydrantBarrelGeo.translate(0, 0.36, 0);
  const hydrantCapGeo = new THREE.SphereGeometry(0.145, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
  hydrantCapGeo.translate(0, 0.70, 0);
  const hydrantNozzleGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.38, 8);
  hydrantNozzleGeo.rotateZ(Math.PI * 0.5);
  hydrantNozzleGeo.translate(0, 0.52, 0);

  const hydrantBarrelInst = new THREE.InstancedMesh(hydrantBarrelGeo, mats.weatheredHydrantMat, hydrantPositions.length);
  const hydrantCapInst = new THREE.InstancedMesh(hydrantCapGeo, mats.darkChrome, hydrantPositions.length);
  const hydrantNozzleInst = new THREE.InstancedMesh(hydrantNozzleGeo, mats.brushedMetal, hydrantPositions.length);
  hydrantBarrelInst.castShadow = true;
  hydrantBarrelInst.receiveShadow = true;

  for (let i = 0; i < hydrantPositions.length; i++) {
    dummy.position.set(hydrantPositions[i].x, 0, hydrantPositions[i].z);
    dummy.rotation.set(0, (i * 0.7) % Math.PI, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    hydrantBarrelInst.setMatrixAt(i, dummy.matrix);
    hydrantCapInst.setMatrixAt(i, dummy.matrix);
    hydrantNozzleInst.setMatrixAt(i, dummy.matrix);
  }
  hydrantBarrelInst.instanceMatrix.needsUpdate = true;
  hydrantBarrelInst.computeBoundingSphere();
  hydrantCapInst.instanceMatrix.needsUpdate = true;
  hydrantCapInst.computeBoundingSphere();
  hydrantNozzleInst.instanceMatrix.needsUpdate = true;
  hydrantNozzleInst.computeBoundingSphere();

  for (let i = 0; i < lampCount; i++) {
    const l = STREETLAMP_POSITIONS[i];
    dummy.position.set(l.x, 0, l.z);
    dummy.rotation.set(0, l.rotY, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    poleInst.setMatrixAt(i, dummy.matrix);

    const bulbOff = new THREE.Vector3(0, 7.3, 2.3).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      l.rotY,
    );
    dummy.position.set(l.x + bulbOff.x, bulbOff.y, l.z + bulbOff.z);
    dummy.updateMatrix();
    bulbInst.setMatrixAt(i, dummy.matrix);
  }
  poleInst.castShadow = true;
  poleInst.instanceMatrix.needsUpdate = true;
  poleInst.computeBoundingSphere();
  bulbInst.instanceMatrix.needsUpdate = true;
  bulbInst.computeBoundingSphere();
  worldGroup.add(poleInst, bulbInst, hydrantBarrelInst, hydrantCapInst, hydrantNozzleInst);

  // Pillar 6: California Sidewalk Urban Street Furniture (Glass Bus Shelters, Multi-Part Slatted Benches,
  // Weathered Newspaper Boxes, Municipal Trash Cans, Café Umbrellas, Concrete Planters, Manholes & Ground Contact Shadows!)
  const propShadowSpots: Array<{ x: number; z: number; sx: number; sz: number }> = [];
  for (const h of hydrantPositions) {
    propShadowSpots.push({ x: h.x, z: h.z, sx: 0.72, sz: 0.72 });
  }
  for (const l of STREETLAMP_POSITIONS) {
    propShadowSpots.push({ x: l.x, z: l.z, sx: 0.75, sz: 0.75 });
  }

  const busShelters = [
    { x: 9.2, z: -26, rotY: -Math.PI * 0.5 },
    { x: -18, z: -51.4, rotY: 0 },
    { x: 24, z: -51.4, rotY: 0 },
    { x: 9.2, z: -72, rotY: -Math.PI * 0.5 },
    { x: -24, z: -105.4, rotY: 0 },
    { x: -56.6, z: -22, rotY: Math.PI * 0.5 },
  ];
  for (const bs of busShelters) {
    const sg = new THREE.Group();
    sg.position.set(bs.x, 0, bs.z);
    sg.rotation.y = bs.rotY;

    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.14, 1.45), mats.darkChrome);
    roof.position.set(0, 2.48, 0);
    roof.rotation.x = 0.06;
    roof.castShadow = true;
    const glassBack = new THREE.Mesh(new THREE.BoxGeometry(3.15, 2.15, 0.06), mats.carGlass);
    glassBack.position.set(0, 1.25, -0.62);
    const adBox = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.15, 1.32), mats.darkChrome);
    adBox.position.set(1.62, 1.25, 0);
    adBox.castShadow = true;
    const adF = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 1.92), mats.busAdMat);
    adF.position.set(1.71, 1.25, 0);
    adF.rotation.y = Math.PI * 0.5;
    const adB = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 1.92), mats.busAdMat);
    adB.position.set(1.53, 1.25, 0);
    adB.rotation.y = -Math.PI * 0.5;
    for (const px of [-1.58, 0, 1.58]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 2.46, 8), mats.darkChrome);
      post.position.set(px, 1.23, -0.62);
      sg.add(post);
    }
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.1, 0.48), mats.woodPorch);
    seat.position.set(-0.22, 0.52, -0.26);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.52, 0.44), mats.darkChrome);
    legL.position.set(-1.12, 0.26, -0.26);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.52, 0.44), mats.darkChrome);
    legR.position.set(0.68, 0.26, -0.26);
    sg.add(roof, glassBack, adBox, adF, adB, seat, legL, legR);
    worldGroup.add(sg);
    propShadowSpots.push({ x: bs.x, z: bs.z, sx: 3.9, sz: 2.1 });
  }

  // Instanced Multi-Part Sidewalk Benches (with real iron legs & armrests), Weathered Trash Cans & Newspaper Racks
  const streetPropSpots = [
    { x: -8.9, z: -22, rotY: Math.PI * 0.5 },
    { x: 8.9, z: -16, rotY: -Math.PI * 0.5 },
    { x: -8.9, z: -31, rotY: Math.PI * 0.5 },
    { x: 8.9, z: -55, rotY: -Math.PI * 0.5 },
    { x: -8.9, z: -64, rotY: Math.PI * 0.5 },
    { x: -16, z: -33.2, rotY: Math.PI },
    { x: 18, z: -33.2, rotY: Math.PI },
    { x: -34, z: -51.0, rotY: 0 },
    { x: 34, z: -51.0, rotY: 0 },
    { x: -57.2, z: -30, rotY: Math.PI * 0.5 },
    { x: 57.2, z: -30, rotY: -Math.PI * 0.5 },
    { x: -16, z: -87.2, rotY: Math.PI },
    { x: 16, z: -87.2, rotY: Math.PI },
  ];

  const trashGeo = new THREE.CylinderGeometry(0.24, 0.20, 0.86, 12);
  trashGeo.translate(0, 0.43, 0);
  const trashRimGeo = new THREE.TorusGeometry(0.24, 0.032, 6, 12);
  trashRimGeo.rotateX(Math.PI * 0.5);
  trashRimGeo.translate(0, 0.86, 0);
  const trashInst = new THREE.InstancedMesh(trashGeo, mats.darkChrome, streetPropSpots.length);
  const trashRimInst = new THREE.InstancedMesh(trashRimGeo, mats.brushedMetal, streetPropSpots.length);
  trashInst.castShadow = true;

  const benchSeatGeo = new THREE.BoxGeometry(1.78, 0.09, 0.52);
  benchSeatGeo.translate(0, 0.46, 0);
  const benchBackGeo = new THREE.BoxGeometry(1.78, 0.40, 0.07);
  benchBackGeo.translate(0, 0.84, -0.23);
  const benchLegGeo = new THREE.BoxGeometry(0.08, 0.64, 0.50);
  benchLegGeo.translate(0, 0.32, 0);

  const benchSeatInst = new THREE.InstancedMesh(benchSeatGeo, mats.woodPorch, streetPropSpots.length);
  const benchBackInst = new THREE.InstancedMesh(benchBackGeo, mats.woodPorch, streetPropSpots.length);
  const benchLegInst = new THREE.InstancedMesh(benchLegGeo, mats.darkChrome, streetPropSpots.length * 2);
  benchSeatInst.castShadow = true;
  benchBackInst.castShadow = true;

  const newsGeo = new THREE.BoxGeometry(0.46, 1.04, 0.42);
  newsGeo.translate(0, 0.52, 0);
  const newsGlassGeo = new THREE.BoxGeometry(0.34, 0.38, 0.04);
  newsGlassGeo.translate(0, 0.76, 0.21);
  const newsInst = new THREE.InstancedMesh(newsGeo, mats.weatheredNewsBoxMat, streetPropSpots.length);
  const newsGlassInst = new THREE.InstancedMesh(newsGlassGeo, mats.carGlass, streetPropSpots.length);
  newsInst.castShadow = true;

  for (let i = 0; i < streetPropSpots.length; i++) {
    const sp = streetPropSpots[i];
    dummy.position.set(sp.x, 0, sp.z);
    dummy.rotation.set(0, sp.rotY, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    benchSeatInst.setMatrixAt(i, dummy.matrix);
    benchBackInst.setMatrixAt(i, dummy.matrix);
    propShadowSpots.push({ x: sp.x, z: sp.z, sx: 2.05, sz: 0.92 });

    // Real iron bench leg frames on both ends
    for (let li = 0; li < 2; li++) {
      const legOff = new THREE.Vector3(li === 0 ? -0.76 : 0.76, 0, 0).applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        sp.rotY,
      );
      dummy.position.set(sp.x + legOff.x, 0, sp.z + legOff.z);
      dummy.updateMatrix();
      benchLegInst.setMatrixAt(i * 2 + li, dummy.matrix);
    }

    const sideOff = new THREE.Vector3(1.28, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), sp.rotY);
    dummy.position.set(sp.x + sideOff.x, 0, sp.z + sideOff.z);
    dummy.updateMatrix();
    trashInst.setMatrixAt(i, dummy.matrix);
    trashRimInst.setMatrixAt(i, dummy.matrix);
    propShadowSpots.push({ x: sp.x + sideOff.x, z: sp.z + sideOff.z, sx: 0.78, sz: 0.78 });

    const newsOff = new THREE.Vector3(-1.28, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), sp.rotY);
    dummy.position.set(sp.x + newsOff.x, 0, sp.z + newsOff.z);
    dummy.updateMatrix();
    newsInst.setMatrixAt(i, dummy.matrix);
    newsGlassInst.setMatrixAt(i, dummy.matrix);
    propShadowSpots.push({ x: sp.x + newsOff.x, z: sp.z + newsOff.z, sx: 0.86, sz: 0.82 });
  }
  trashInst.instanceMatrix.needsUpdate = true;
  trashInst.computeBoundingSphere();
  trashRimInst.instanceMatrix.needsUpdate = true;
  trashRimInst.computeBoundingSphere();
  benchSeatInst.instanceMatrix.needsUpdate = true;
  benchSeatInst.computeBoundingSphere();
  benchBackInst.instanceMatrix.needsUpdate = true;
  benchBackInst.computeBoundingSphere();
  benchLegInst.instanceMatrix.needsUpdate = true;
  benchLegInst.computeBoundingSphere();
  newsInst.instanceMatrix.needsUpdate = true;
  newsInst.computeBoundingSphere();
  newsGlassInst.instanceMatrix.needsUpdate = true;
  newsGlassInst.computeBoundingSphere();

  // Concrete Sidewalk Planter Boxes with Lush Green Shrubs (grounds plazas & storefronts!)
  const planterSpots = [
    { x: -11.4, z: -32.8 },
    { x: 11.4, z: -32.8 },
    { x: -11.4, z: -51.2 },
    { x: 11.4, z: -51.2 },
    { x: -13.5, z: -87.0 },
    { x: 13.5, z: -87.0 },
    { x: -24.5, z: -51.2 },
    { x: 24.5, z: -32.8 },
    { x: -10.5, z: -140.0 },
    { x: 10.5, z: -140.0 },
  ];
  const planterBoxGeo = new THREE.BoxGeometry(1.55, 0.56, 1.55);
  planterBoxGeo.translate(0, 0.28, 0);
  const shrubGeo = new THREE.DodecahedronGeometry(0.68, 1);
  shrubGeo.scale(1.1, 0.72, 1.1);
  shrubGeo.translate(0, 0.78, 0);
  const planterInst = new THREE.InstancedMesh(planterBoxGeo, mats.curbConcrete, planterSpots.length);
  const shrubInst = new THREE.InstancedMesh(shrubGeo, mats.shrubMat, planterSpots.length);
  planterInst.castShadow = true;
  planterInst.receiveShadow = true;
  shrubInst.castShadow = true;
  for (let i = 0; i < planterSpots.length; i++) {
    const ps = planterSpots[i];
    dummy.position.set(ps.x, 0, ps.z);
    dummy.rotation.set(0, (i * 0.9) % Math.PI, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    planterInst.setMatrixAt(i, dummy.matrix);
    shrubInst.setMatrixAt(i, dummy.matrix);
    propShadowSpots.push({ x: ps.x, z: ps.z, sx: 2.15, sz: 2.15 });
  }
  planterInst.instanceMatrix.needsUpdate = true;
  planterInst.computeBoundingSphere();
  shrubInst.instanceMatrix.needsUpdate = true;
  shrubInst.computeBoundingSphere();

  // Sidewalk Outdoor Café Tables with Striped California Umbrellas (Cluckin' Bell, Burger Shot, Vinewood, Rodeo)
  const cafeSpots = [
    { x: 29.0, z: -51.8 },
    { x: 38.0, z: -51.8 },
    { x: -27.0, z: -51.8 },
    { x: -79.2, z: 18.0 },
    { x: -79.2, z: 26.0 },
    { x: -24.0, z: -154.0 },
    { x: 24.0, z: -154.0 },
  ];
  const cafePoleGeo = new THREE.CylinderGeometry(0.038, 0.045, 2.38, 8);
  cafePoleGeo.translate(0, 1.19, 0);
  const cafeTableGeo = new THREE.CylinderGeometry(0.58, 0.58, 0.06, 12);
  cafeTableGeo.translate(0, 0.76, 0);
  const cafeUmbrellaGeo = new THREE.ConeGeometry(1.38, 0.52, 8);
  cafeUmbrellaGeo.translate(0, 2.38, 0);
  const cafePoleInst = new THREE.InstancedMesh(cafePoleGeo, mats.darkChrome, cafeSpots.length);
  const cafeTableInst = new THREE.InstancedMesh(cafeTableGeo, mats.trimPaintWhite, cafeSpots.length);
  const cafeUmbrellaInst = new THREE.InstancedMesh(cafeUmbrellaGeo, mats.cafeUmbrellaMat, cafeSpots.length);
  cafeUmbrellaInst.castShadow = true;
  for (let i = 0; i < cafeSpots.length; i++) {
    const cs = cafeSpots[i];
    dummy.position.set(cs.x, 0, cs.z);
    dummy.rotation.set(0, i * 0.6, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    cafePoleInst.setMatrixAt(i, dummy.matrix);
    cafeTableInst.setMatrixAt(i, dummy.matrix);
    cafeUmbrellaInst.setMatrixAt(i, dummy.matrix);
    propShadowSpots.push({ x: cs.x, z: cs.z, sx: 2.4, sz: 2.4 });
  }
  cafePoleInst.instanceMatrix.needsUpdate = true;
  cafePoleInst.computeBoundingSphere();
  cafeTableInst.instanceMatrix.needsUpdate = true;
  cafeTableInst.computeBoundingSphere();
  cafeUmbrellaInst.instanceMatrix.needsUpdate = true;
  cafeUmbrellaInst.computeBoundingSphere();

  // Cast-Iron Street Manhole Covers along Los Santos Boulevards (breaks up road uniformity!)
  const manholeSpots = [
    { x: 1.8, z: -12 },
    { x: -1.8, z: -26 },
    { x: 1.8, z: -58 },
    { x: -1.8, z: -76 },
    { x: -24, z: -42 },
    { x: 24, z: -42 },
    { x: -24, z: -96 },
    { x: 24, z: -96 },
    { x: -66, z: -10 },
    { x: 66, z: 10 },
  ];
  const manholeGeo = new THREE.CircleGeometry(0.52, 14);
  manholeGeo.rotateX(-Math.PI * 0.5);
  const manholeInst = new THREE.InstancedMesh(manholeGeo, mats.manholeMat, manholeSpots.length);
  manholeInst.receiveShadow = true;
  for (let i = 0; i < manholeSpots.length; i++) {
    dummy.position.set(manholeSpots[i].x, 0.044, manholeSpots[i].z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    manholeInst.setMatrixAt(i, dummy.matrix);
  }
  manholeInst.instanceMatrix.needsUpdate = true;
  manholeInst.computeBoundingSphere();

  // Baked Ground Contact Shadow Decals under EVERY street prop (anchors every bench, hydrant, trash can & planter!)
  const propShadowGeo = new THREE.PlaneGeometry(1, 1);
  propShadowGeo.rotateX(-Math.PI * 0.5);
  const propShadowMat = new THREE.MeshBasicMaterial({
    map: mats.contactShadowMap,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const propShadowInst = new THREE.InstancedMesh(propShadowGeo, propShadowMat, propShadowSpots.length);
  for (let i = 0; i < propShadowSpots.length; i++) {
    const ps = propShadowSpots[i];
    dummy.position.set(ps.x, 0.052, ps.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(ps.sx, 1, ps.sz);
    dummy.updateMatrix();
    propShadowInst.setMatrixAt(i, dummy.matrix);
  }
  propShadowInst.instanceMatrix.needsUpdate = true;
  propShadowInst.computeBoundingSphere();

  // California Octagonal STOP Signs at secondary sidewalk corners
  const stopSpots = [
    { x: -8.3, z: -13.5, rotY: 0 },
    { x: 8.3, z: -13.5, rotY: Math.PI },
    { x: -8.3, z: 45.2, rotY: 0 },
    { x: 8.3, z: 62.8, rotY: Math.PI },
  ];
  for (const ss of stopSpots) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 2.55, 6), mats.brushedMetal);
    pole.position.set(ss.x, 1.28, ss.z);
    pole.castShadow = true;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.66, 0.05), mats.stopSignMat);
    plate.position.set(ss.x, 2.42, ss.z);
    plate.rotation.y = ss.rotY;
    plate.castShadow = true;
    worldGroup.add(pole, plate);
  }

  worldGroup.add(
    trashInst,
    trashRimInst,
    benchSeatInst,
    benchBackInst,
    benchLegInst,
    newsInst,
    newsGlassInst,
    planterInst,
    shrubInst,
    cafePoleInst,
    cafeTableInst,
    cafeUmbrellaInst,
    manholeInst,
    propShadowInst,
  );

  // 7B. Living Atmospheric Wildlife: 24 Soaring California Seagulls / Urban Birds + 180 Golden Sunset Dust Motes
  const birdCount = 24;
  const birdMat = new THREE.MeshStandardMaterial({
    color: 0xd8d5ce,
    roughness: 0.82,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const birdBodyGeo = new THREE.ConeGeometry(0.09, 0.48, 5);
  birdBodyGeo.rotateX(Math.PI * 0.5);
  const birdWingLGeo = new THREE.BoxGeometry(0.55, 0.025, 0.18);
  birdWingLGeo.translate(-0.275, 0, 0);
  const birdWingRGeo = new THREE.BoxGeometry(0.55, 0.025, 0.18);
  birdWingRGeo.translate(0.275, 0, 0);
  const birdBodies = new THREE.InstancedMesh(birdBodyGeo, birdMat, birdCount);
  const birdLeftWings = new THREE.InstancedMesh(birdWingLGeo, birdMat, birdCount);
  const birdRightWings = new THREE.InstancedMesh(birdWingRGeo, birdMat, birdCount);
  birdBodies.frustumCulled = false;
  birdLeftWings.frustumCulled = false;
  birdRightWings.frustumCulled = false;
  scene.add(birdBodies, birdLeftWings, birdRightWings);

  const dustCount = 160;
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 48;
    dustPos[i * 3 + 1] = 0.7 + Math.random() * 11;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 48;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustTexCanvas = document.createElement('canvas');
  dustTexCanvas.width = 32;
  dustTexCanvas.height = 32;
  const dctx = dustTexCanvas.getContext('2d')!;
  const dGrad = dctx.createRadialGradient(16, 16, 1, 16, 16, 15);
  dGrad.addColorStop(0, 'rgba(255, 232, 185, 1.0)');
  dGrad.addColorStop(0.45, 'rgba(255, 200, 128, 0.45)');
  dGrad.addColorStop(1, 'rgba(255, 180, 96, 0.0)');
  dctx.fillStyle = dGrad;
  dctx.fillRect(0, 0, 32, 32);
  const dustTex = new THREE.CanvasTexture(dustTexCanvas);
  const dustMat = new THREE.PointsMaterial({
    color: 0xffcf88,
    map: dustTex,
    size: 0.24,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const dustMotes = new THREE.Points(dustGeo, dustMat);
  dustMotes.frustumCulled = false;
  scene.add(dustMotes);

  // 8. Interactive Shop Entrance Markers (Glowing GTA Storefront Entry Halos)
  const shopMarkers: THREE.Group[] = [];
  for (const shop of SHOPS) {
    const marker = new THREE.Group();
    marker.position.set(shop.x, 0.08, shop.z);
    const accent = new THREE.Color(shop.accentHex);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.05, 1.38, 28),
      new THREE.MeshBasicMaterial({
        color: accent,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI * 0.5;
    marker.add(ring);

    const innerGlow = new THREE.Mesh(
      new THREE.CylinderGeometry(1.0, 1.15, 1.45, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.09,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    innerGlow.position.y = 0.72;
    marker.add(innerGlow);

    // Floating spinning diamond token at eye level
    const icon = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.32, 0),
      new THREE.MeshStandardMaterial({
        color: accent,
        emissive: accent,
        emissiveIntensity: 0.9,
        roughness: 0.25,
        metalness: 0.5,
      }),
    );
    icon.position.y = 1.55;
    icon.name = 'shop_icon';
    marker.add(icon);

    worldGroup.add(marker);
    shopMarkers.push(marker);
  }

  // 9. Pillar 4: Refined Ground-Hugging Street Checkpoint Objective Beacon (sleek, never obtrusive!)
  const checkpointGroup = new THREE.Group();
  const checkpointRing = new THREE.Mesh(
    new THREE.RingGeometry(2.55, 2.95, 36),
    new THREE.MeshBasicMaterial({
      color: 0xffc040,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    }),
  );
  checkpointRing.rotation.x = -Math.PI * 0.5;
  checkpointRing.position.y = 0.065;
  checkpointGroup.add(checkpointRing);

  const checkpointColumn = new THREE.Mesh(
    new THREE.CylinderGeometry(2.55, 2.75, 1.55, 28, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffa826,
      transparent: true,
      opacity: 0.045,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  checkpointColumn.position.y = 0.78;
  checkpointGroup.add(checkpointColumn);
  scene.add(checkpointGroup);

  // Freeze static world matrices once so Three.js never recomputes 1,200+ static building/road/prop transforms every frame!
  worldGroup.updateMatrixWorld(true);
  worldGroup.traverse((obj) => {
    if (obj.name === 'shop_icon') return;
    obj.matrixAutoUpdate = false;
  });

  return {
    worldGroup,
    checkpointGroup,
    checkpointRing,
    checkpointColumn,
    shopMarkers,
    birdFlock: {
      leftWings: birdLeftWings,
      rightWings: birdRightWings,
      bodies: birdBodies,
      count: birdCount,
    },
    dustMotes,
  };
}
