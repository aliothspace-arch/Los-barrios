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
import { mergeGeometryEntries, type GeometryMergeEntry } from './rendering/geometryFusion';
import {
  CUL_DE_SAC,
  INTERSECTION_CENTERS,
  PALM_POSITIONS,
  ROAD_SEGMENTS,
  SHADE_TREE_POSITIONS,
  STREETLAMP_POSITIONS,
  WORLD_HALF_SIZE,
} from './worldLayout';
import {
  buildShopWorldExtensions,
  type ShopWorldVisuals,
} from './world/shopWorldBuilder';

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
  frunkBayGroup: THREE.Group;
  wheelsGroup: THREE.Group;
  lod1Group: THREE.Group;
  lod1BodyGroup: THREE.Group;
  lod1Wheels: THREE.Group[];
  lod2Group: THREE.Group;
  setLodMode: (useLod1: boolean) => void;
  setLodLevel: (level: 0 | 1 | 2) => void;
  frontLeftPivot: THREE.Group;
  frontRightPivot: THREE.Group;
  wheelCornerRoots: [THREE.Group, THREE.Group, THREE.Group, THREE.Group];
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
  shadowCastMeshes: THREE.Mesh[];
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
  shopVisuals: ShopWorldVisuals;
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

  // 3. Paved Los Santos Avenues (fused into 2 orientation batches: NS + EW -> 11 draw calls collapsed to 2!)
  const roadEntriesNS: GeometryMergeEntry[] = [];
  const roadEntriesEW: GeometryMergeEntry[] = [];
  const roadTempGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < ROAD_SEGMENTS.length; i++) {
    const r = ROAD_SEGMENTS[i];
    const geo = new THREE.PlaneGeometry(r.w, r.d);
    geo.rotateX(-Math.PI * 0.5);
    roadTempGeos.push(geo);
    const mat4 = new THREE.Matrix4().makeTranslation(
      r.x,
      r.orientation === 'ns' ? 0.02 : 0.035,
      r.z,
    );
    if (r.orientation === 'ns') {
      roadEntriesNS.push({ geo, matrix: mat4 });
    } else {
      roadEntriesEW.push({ geo, matrix: mat4 });
    }
  }
  if (roadEntriesNS.length > 0) {
    const roadNS = new THREE.Mesh(mergeGeometryEntries(roadEntriesNS), mats.roadNS);
    roadNS.receiveShadow = true;
    worldGroup.add(roadNS);
  }
  if (roadEntriesEW.length > 0) {
    const roadEW = new THREE.Mesh(mergeGeometryEntries(roadEntriesEW), mats.roadEW);
    roadEW.receiveShadow = true;
    worldGroup.add(roadEW);
  }
  for (const g of roadTempGeos) g.dispose();

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

  // Pillar 6: Hyperrealistic Caltrans / LADOT Traffic Signal Gantries (Tapered Mast Pole, Bolted Elbow Saddle,
  // Curved Parabolic Cantilever Arm, Dual 3-Aspect Signal Heads + Side-Mount Head, 3D Tunnel Visors, Louvered
  // Retroreflective Yellow-Border Backplates, Illuminated Street-Name Blades, Pedestrian Countdown Signals & NEMA Cabinets)
  const cwGeo = new THREE.PlaneGeometry(12.2, 2.7);
  cwGeo.rotateX(-Math.PI * 0.5);
  const cwInst = new THREE.InstancedMesh(
    cwGeo,
    mats.crosswalkMat,
    INTERSECTION_CENTERS.length * 4,
  );
  const cwDummy = new THREE.Object3D();
  let cwIdx = 0;

  // 1) Galvanized Steel Gantry Structure (fused into 1 InstancedMesh)
  const tlPartsGalv: Array<{ geo: THREE.BufferGeometry }> = [];
  const pushGalv = (geo: THREE.BufferGeometry): void => {
    tlPartsGalv.push({ geo });
  };

  // Vertical tapered pole + top finial dome + base flange plate + 6 anchor bolts + maintenance hatch
  const tlMainMast = new THREE.CylinderGeometry(0.135, 0.21, 6.75, 14);
  tlMainMast.translate(0, 3.375, 0);
  pushGalv(tlMainMast);
  const tlMastTopCap = new THREE.SphereGeometry(0.145, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
  tlMastTopCap.translate(0, 6.74, 0);
  pushGalv(tlMastTopCap);
  const tlFlangeRing = new THREE.CylinderGeometry(0.28, 0.30, 0.08, 12);
  tlFlangeRing.translate(0, 0.44, 0);
  pushGalv(tlFlangeRing);
  for (let b = 0; b < 6; b++) {
    const ang = (b / 6) * Math.PI * 2;
    const bolt = new THREE.CylinderGeometry(0.024, 0.024, 0.09, 6);
    bolt.translate(Math.cos(ang) * 0.24, 0.48, Math.sin(ang) * 0.24);
    pushGalv(bolt);
  }
  const tlAccessDoor = new THREE.BoxGeometry(0.14, 0.46, 0.04);
  tlAccessDoor.translate(0, 1.35, 0.195);
  pushGalv(tlAccessDoor);

  // Heavy gusseted mast-arm knuckle saddle at Y=5.85..6.35m
  const tlSaddleCollar = new THREE.CylinderGeometry(0.185, 0.195, 0.52, 12);
  tlSaddleCollar.translate(0, 6.08, 0);
  pushGalv(tlSaddleCollar);
  const tlSaddlePlate = new THREE.BoxGeometry(0.32, 0.54, 0.28);
  tlSaddlePlate.translate(0.16, 6.08, 0);
  pushGalv(tlSaddlePlate);
  const tlUnderGusset = new THREE.BoxGeometry(0.65, 0.09, 0.14);
  tlUnderGusset.rotateZ(0.46);
  tlUnderGusset.translate(0.38, 5.84, 0);
  pushGalv(tlUnderGusset);

  // Graceful parabolic LADOT cantilever mast arm reaching X = 5.45m over traffic lanes
  const tlArmCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.12, 6.05, 0),
    new THREE.Vector3(1.55, 6.26, 0),
    new THREE.Vector3(3.45, 6.38, 0),
    new THREE.Vector3(5.45, 6.34, 0),
  ]);
  const tlArmTube = new THREE.TubeGeometry(tlArmCurve, 14, 0.095, 10, false);
  pushGalv(tlArmTube);
  const tlArmTipCap = new THREE.SphereGeometry(0.10, 8, 6);
  tlArmTipCap.translate(5.45, 6.34, 0);
  pushGalv(tlArmTipCap);

  // Structural reinforcement tie-rod cable from upper mast peak (0.14, 6.66) to mid-arm (2.85, 6.36)
  const tlTieCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.13, 6.66, 0),
    new THREE.Vector3(2.85, 6.37, 0),
  ]);
  pushGalv(new THREE.TubeGeometry(tlTieCurve, 4, 0.022, 6, false));

  // Street-name sign suspension clamps & drop hangers at X = 1.50m and X = 2.40m
  for (const sx of [1.50, 2.40]) {
    const clampRing = new THREE.CylinderGeometry(0.115, 0.115, 0.08, 10);
    clampRing.rotateZ(Math.PI * 0.5);
    clampRing.translate(sx, 6.30, 0);
    pushGalv(clampRing);
    const dropRod = new THREE.CylinderGeometry(0.022, 0.022, 0.24, 6);
    dropRod.translate(sx, 6.16, 0);
    pushGalv(dropRod);
  }

  // Dual overhead signal head drop-pipe elevator brackets at X = 3.55m and X = 5.20m
  const headPositionsX = [3.55, 5.20];
  const headCenterY = 5.66;
  for (const hx of headPositionsX) {
    const collar = new THREE.CylinderGeometry(0.115, 0.115, 0.12, 10);
    collar.rotateZ(Math.PI * 0.5);
    collar.translate(hx, 6.36, 0);
    pushGalv(collar);
    const dropPipe = new THREE.CylinderGeometry(0.036, 0.036, 0.42, 8);
    dropPipe.translate(hx, 6.18, 0);
    pushGalv(dropPipe);
  }

  // Side-mount secondary pole signal pipe brackets (upper & lower elbows on pole at X = -0.26m)
  for (const by of [4.26, 3.10]) {
    const sideArm = new THREE.CylinderGeometry(0.032, 0.032, 0.36, 8);
    sideArm.rotateZ(Math.PI * 0.5);
    sideArm.translate(-0.18, by, 0);
    pushGalv(sideArm);
  }

  // Traffic optical enforcement camera & radar detector pod mounted at X = 2.75m
  const camStem = new THREE.CylinderGeometry(0.024, 0.024, 0.34, 6);
  camStem.translate(2.75, 6.54, 0);
  pushGalv(camStem);
  const camBody = new THREE.BoxGeometry(0.18, 0.14, 0.32);
  camBody.rotateX(0.24);
  camBody.translate(2.75, 6.72, 0.06);
  pushGalv(camBody);

  // Pedestrian push-button stations on vertical pole at Y = 1.15m
  const pushBtnBox = new THREE.BoxGeometry(0.14, 0.24, 0.12);
  pushBtnBox.translate(0, 1.18, 0.20);
  pushGalv(pushBtnBox);

  const tlPoleArmGeo = mergeGeometryEntries(tlPartsGalv);
  for (const p of tlPartsGalv) p.geo.dispose();

  // 2) Molded Concrete Pier Foundation Pedestal
  const tlBaseLower = new THREE.CylinderGeometry(0.33, 0.37, 0.34, 12);
  tlBaseLower.translate(0, 0.17, 0);
  const tlBaseChamfer = new THREE.CylinderGeometry(0.27, 0.33, 0.10, 12);
  tlBaseChamfer.translate(0, 0.39, 0);
  const tlBaseGeo = mergeGeometryEntries([{ geo: tlBaseLower }, { geo: tlBaseChamfer }]);
  tlBaseLower.dispose();
  tlBaseChamfer.dispose();

  // 3) Dual Overhead Louvered Backplates (with yellow safety border texture)
  const tlBackplateParts: Array<{ geo: THREE.BufferGeometry }> = [];
  for (const hx of headPositionsX) {
    const bp = new THREE.BoxGeometry(0.76, 1.48, 0.048);
    bp.translate(hx, headCenterY, -0.01);
    tlBackplateParts.push({ geo: bp });
  }
  const tlBackplateGeo = mergeGeometryEntries(tlBackplateParts);
  for (const p of tlBackplateParts) p.geo.dispose();

  // 4) Polycarbonate Signal Housings + 3D Cutaway Tunnel Sun Visors + Pedestrian Walk/Don't-Walk Heads
  const tlHousingParts: Array<{ geo: THREE.BufferGeometry }> = [];
  const pushHousing = (geo: THREE.BufferGeometry): void => {
    tlHousingParts.push({ geo });
  };
  const lensOffsetsY = [0.36, 0.0, -0.36]; // Red (top), Amber (mid), Green (bottom)

  // Overhead 2x 3-aspect heads + side-mount pole 3-aspect head at (-0.28, 3.68, 0)
  const allSignalHeads = [
    { x: headPositionsX[0], y: headCenterY, scale: 1.0 },
    { x: headPositionsX[1], y: headCenterY, scale: 1.0 },
    { x: -0.28, y: 3.68, scale: 0.86 },
  ];
  for (const sh of allSignalHeads) {
    const s = sh.scale;
    // Vertical rear structural mounting spine
    const spine = new THREE.BoxGeometry(0.14 * s, 1.18 * s, 0.36 * s);
    spine.translate(sh.x, sh.y, 0.02 * s);
    pushHousing(spine);

    // 3 modular stacked die-cast signal sections with front bezel frames
    for (const ly of lensOffsetsY) {
      const cellY = sh.y + ly * s;
      const cellBox = new THREE.BoxGeometry(0.42 * s, 0.34 * s, 0.32 * s);
      cellBox.translate(sh.x, cellY, 0.04 * s);
      pushHousing(cellBox);

      // Front and rear 3D cutaway tunnel sun visors (top-arch hood shielding each lens along ±Z)
      for (const zSign of [1, -1]) {
        const visor = new THREE.CylinderGeometry(
          0.146 * s,
          0.156 * s,
          0.26 * s,
          12,
          1,
          true,
          -Math.PI * 0.65,
          Math.PI * 1.30,
        );
        // Rotate cylinder axis to Z, with arch crest at +Y (top of lens)
        visor.rotateY(Math.PI * 0.5);
        visor.rotateZ(Math.PI * 0.5);
        visor.rotateX(Math.PI * 0.5);
        visor.translate(sh.x, cellY + 0.015 * s, (0.04 + zSign * 0.27) * s);
        pushHousing(visor);
      }
    }
    // Top & bottom weatherproofing end caps
    const topCap = new THREE.BoxGeometry(0.46 * s, 0.055 * s, 0.36 * s);
    topCap.translate(sh.x, sh.y + 0.545 * s, 0.04 * s);
    pushHousing(topCap);
    const botCap = new THREE.BoxGeometry(0.46 * s, 0.055 * s, 0.36 * s);
    botCap.translate(sh.x, sh.y - 0.545 * s, 0.04 * s);
    pushHousing(botCap);
  }

  // Dual Pedestrian Countdown Signal Clamshell Boxes at Y = 2.55m on pole (facing both crosswalk axes)
  const pedHeadA = new THREE.BoxGeometry(0.36, 0.48, 0.28);
  pedHeadA.translate(0.24, 2.55, 0.14);
  pushHousing(pedHeadA);
  const pedVisorA = new THREE.BoxGeometry(0.38, 0.06, 0.16);
  pedVisorA.translate(0.24, 2.77, 0.28);
  pushHousing(pedVisorA);
  const pedHeadB = new THREE.BoxGeometry(0.28, 0.48, 0.36);
  pedHeadB.translate(-0.14, 2.55, 0.24);
  pushHousing(pedHeadB);

  const tlBoxGeo = mergeGeometryEntries(tlHousingParts);
  for (const p of tlHousingParts) p.geo.dispose();

  // 5) Illuminated Hanging Street-Name Sign Blade at X = 1.95m, Y = 5.98m
  const tlStreetSignGeo = new THREE.BoxGeometry(1.92, 0.42, 0.075);
  tlStreetSignGeo.translate(1.95, 5.98, 0);

  // 6) Detailed Sidewalk NEMA Traffic Signal Controller Cabinet (sloped rain roof, louvers, door handle, concrete pad)
  const cabPad = new THREE.BoxGeometry(0.92, 0.12, 0.68);
  cabPad.translate(0, 0.06, 0);
  const cabBody = new THREE.BoxGeometry(0.78, 1.32, 0.54);
  cabBody.translate(0, 0.78, 0);
  const cabRoof = new THREE.CylinderGeometry(0.40, 0.46, 0.12, 4);
  cabRoof.rotateY(Math.PI * 0.25);
  cabRoof.scale(1.25, 1.0, 0.88);
  cabRoof.translate(0, 1.49, 0);
  const cabDoorSeam = new THREE.BoxGeometry(0.66, 1.14, 0.565);
  cabDoorSeam.translate(0, 0.78, 0);
  const cabHandle = new THREE.BoxGeometry(0.05, 0.18, 0.61);
  cabHandle.translate(0.24, 0.78, 0);
  const tlCabinetGeo = mergeGeometryEntries([
    { geo: cabPad },
    { geo: cabBody },
    { geo: cabRoof },
    { geo: cabDoorSeam },
    { geo: cabHandle },
  ]);
  cabPad.dispose();
  cabBody.dispose();
  cabRoof.dispose();
  cabDoorSeam.dispose();
  cabHandle.dispose();

  // 7) 3-Aspect Signal Lenses (Front & Rear discs on all 3 signal heads + Pedestrian Countdown Symbol)
  const buildSignalLensCluster = (offsetYRatio: number, includePedLens: boolean): THREE.BufferGeometry => {
    const parts: Array<{ geo: THREE.BufferGeometry }> = [];
    for (const sh of allSignalHeads) {
      const s = sh.scale;
      const ly = sh.y + offsetYRatio * s;
      const discF = new THREE.CylinderGeometry(0.132 * s, 0.132 * s, 0.04 * s, 14);
      discF.rotateX(Math.PI * 0.5);
      discF.translate(sh.x, ly, 0.215 * s);
      parts.push({ geo: discF });

      const discB = new THREE.CylinderGeometry(0.132 * s, 0.132 * s, 0.04 * s, 14);
      discB.rotateX(Math.PI * 0.5);
      discB.translate(sh.x, ly, -0.115 * s);
      parts.push({ geo: discB });
    }
    if (includePedLens) {
      const pedLens = new THREE.BoxGeometry(0.26, 0.34, 0.03);
      pedLens.translate(0.24, 2.55, 0.28);
      parts.push({ geo: pedLens });
    }
    const merged = mergeGeometryEntries(parts);
    for (const p of parts) p.geo.dispose();
    return merged;
  };

  // Active Green / Active Red / Dark Standby Amber lens geometries in gantry-local space
  const tlGreenActiveLensGeo = buildSignalLensCluster(-0.36, true);
  const tlRedActiveLensGeo = buildSignalLensCluster(0.36, true);
  const tlAmberStandbyGeo = buildSignalLensCluster(0.0, false);
  const tlTopDarkGeo = buildSignalLensCluster(0.36, false);
  const tlBotDarkGeo = buildSignalLensCluster(-0.36, false);
  const tlAmberForGreenGantryGeo = mergeGeometryEntries([
    { geo: tlAmberStandbyGeo },
    { geo: tlTopDarkGeo },
  ]);
  const tlAmberForRedGantryGeo = mergeGeometryEntries([
    { geo: tlAmberStandbyGeo },
    { geo: tlBotDarkGeo },
  ]);
  tlAmberStandbyGeo.dispose();
  tlTopDarkGeo.dispose();
  tlBotDarkGeo.dispose();

  const tlCount = INTERSECTION_CENTERS.length * 2;
  const tlPoleInst = new THREE.InstancedMesh(tlPoleArmGeo, mats.brushedMetal, tlCount);
  const tlBaseInst = new THREE.InstancedMesh(tlBaseGeo, mats.curbConcrete, tlCount);
  const tlBackplateInst = new THREE.InstancedMesh(tlBackplateGeo, mats.trafficBackplateMat, tlCount);
  const tlBoxInst = new THREE.InstancedMesh(tlBoxGeo, mats.trafficHousingMat, tlCount);
  const tlSignInst = new THREE.InstancedMesh(tlStreetSignGeo, mats.trafficStreetSignMat, tlCount);
  const tlCabinetInst = new THREE.InstancedMesh(
    tlCabinetGeo,
    mats.brushedMetal,
    INTERSECTION_CENTERS.length,
  );
  const tlBulbGreenInst = new THREE.InstancedMesh(
    tlGreenActiveLensGeo,
    mats.trafficLensGreenMat,
    INTERSECTION_CENTERS.length,
  );
  const tlBulbRedInst = new THREE.InstancedMesh(
    tlRedActiveLensGeo,
    mats.trafficLensRedMat,
    INTERSECTION_CENTERS.length,
  );
  const tlBulbOffGreenGantryInst = new THREE.InstancedMesh(
    tlAmberForGreenGantryGeo,
    mats.trafficLensAmberOffMat,
    INTERSECTION_CENTERS.length,
  );
  const tlBulbOffRedGantryInst = new THREE.InstancedMesh(
    tlAmberForRedGantryGeo,
    mats.trafficLensAmberOffMat,
    INTERSECTION_CENTERS.length,
  );
  tlPoleInst.castShadow = true;
  tlBoxInst.castShadow = true;
  tlCabinetInst.castShadow = true;

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

    // 2 Diagonal Sidewalk-Corner Traffic Light Gantries (placed at ±8.6m, clear of ±7m road lanes)
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
      tlBackplateInst.setMatrixAt(idx, cwDummy.matrix);
      tlBoxInst.setMatrixAt(idx, cwDummy.matrix);
      tlSignInst.setMatrixAt(idx, cwDummy.matrix);

      if (cn.isGreen) {
        tlBulbGreenInst.setMatrixAt(i, cwDummy.matrix);
        tlBulbOffGreenGantryInst.setMatrixAt(i, cwDummy.matrix);
      } else {
        tlBulbRedInst.setMatrixAt(i, cwDummy.matrix);
        tlBulbOffRedGantryInst.setMatrixAt(i, cwDummy.matrix);
      }

      // Galvanized Traffic Signal NEMA Controller Cabinet tucked behind corner pole
      if (c === 0) {
        cwDummy.position.set(cn.x - 1.15, 0, cn.z - 0.85);
        cwDummy.rotation.set(0, 0, 0);
        cwDummy.updateMatrix();
        tlCabinetInst.setMatrixAt(i, cwDummy.matrix);
      }
    }
  }
  for (const inst of [
    cwInst,
    tlPoleInst,
    tlBaseInst,
    tlBackplateInst,
    tlBoxInst,
    tlSignInst,
    tlCabinetInst,
    tlBulbGreenInst,
    tlBulbRedInst,
    tlBulbOffGreenGantryInst,
    tlBulbOffRedGantryInst,
  ]) {
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
  }
  worldGroup.add(
    cwInst,
    tlPoleInst,
    tlBaseInst,
    tlBackplateInst,
    tlBoxInst,
    tlSignInst,
    tlCabinetInst,
    tlBulbGreenInst,
    tlBulbRedInst,
    tlBulbOffGreenGantryInst,
    tlBulbOffRedGantryInst,
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
  const rootSoilGeo = new THREE.CylinderGeometry(0.46, 0.64, 0.08, 12);
  rootSoilGeo.translate(0, 0.04, 0);
  const deadSkirtPerPalm = 9;
  const deadSkirtGeo = buildDeadSkirtFrondGeometry();
  const dateClustersPerPalm = 3;
  const dateGeo = buildDateClusterGeometry();
  const frondsPerPalm = 22;
  const frondGeo = buildSculptedPalmFrondGeometry();

  // Compute balanced city centroid to partition palms into 4 spatial quadrants (NW, NE, SW, SE).
  // Tight per-quadrant bounding spheres allow Three.js to frustum-cull ~65-75% of all 330K palm
  // triangles outside the camera and sun shadow frustums with 100% identical botanical geometry.
  let sumPalmX = 0;
  let sumPalmZ = 0;
  for (let i = 0; i < palmCount; i++) {
    sumPalmX += PALM_POSITIONS[i].x;
    sumPalmZ += PALM_POSITIONS[i].z;
  }
  const splitX = palmCount > 0 ? sumPalmX / palmCount : 0;
  const splitZ = palmCount > 0 ? sumPalmZ / palmCount : 0;

  const quadrants: number[][] = [[], [], [], []];
  for (let i = 0; i < palmCount; i++) {
    const p = PALM_POSITIONS[i];
    const qIdx = (p.x >= splitX ? 1 : 0) + (p.z >= splitZ ? 2 : 0);
    quadrants[qIdx].push(i);
  }

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  const upAxis = new THREE.Vector3(0, 1, 0);
  const topLocalA = trunkCurveA.getPointAt(0.985);
  const topLocalB = trunkCurveB.getPointAt(0.985);
  const crownPos = new THREE.Vector3();

  for (let q = 0; q < quadrants.length; q++) {
    const indices = quadrants[q];
    const qCount = indices.length;
    if (qCount === 0) continue;

    let qCountA = 0;
    let qCountB = 0;
    for (let k = 0; k < qCount; k++) {
      if (indices[k] % 2 === 1) qCountB++;
      else qCountA++;
    }

    const trunkInstA =
      qCountA > 0 ? new THREE.InstancedMesh(trunkGeoA, mats.palmBark, qCountA) : null;
    if (trunkInstA) {
      trunkInstA.castShadow = true;
      trunkInstA.receiveShadow = true;
    }
    const trunkInstB =
      qCountB > 0 ? new THREE.InstancedMesh(trunkGeoB, mats.palmBark, qCountB) : null;
    if (trunkInstB) {
      trunkInstB.castShadow = true;
      trunkInstB.receiveShadow = true;
    }

    const rootSoilInst = new THREE.InstancedMesh(rootSoilGeo, mats.palmSoilMat, qCount);
    rootSoilInst.receiveShadow = true;

    const deadSkirtInst = new THREE.InstancedMesh(
      deadSkirtGeo,
      mats.palmDeadFrond,
      qCount * deadSkirtPerPalm,
    );
    deadSkirtInst.castShadow = false;

    const dateInst = new THREE.InstancedMesh(
      dateGeo,
      mats.palmDateMat,
      qCount * dateClustersPerPalm,
    );

    const frondInst = new THREE.InstancedMesh(
      frondGeo,
      mats.palmFrond,
      qCount * frondsPerPalm,
    );
    frondInst.castShadow = true;

    let idxA = 0;
    let idxB = 0;
    let deadIdx = 0;
    let dateIdx = 0;
    let frondIdx = 0;

    for (let k = 0; k < qCount; k++) {
      const i = indices[k];
      const p = PALM_POSITIONS[i];
      const isB = i % 2 === 1;
      const scale = 0.86 + ((i * 37) % 100) * 0.0032;
      const girthScale = scale * (0.94 + ((i * 19) % 13) * 0.01);
      const rotY = (i * 2.399963) % (Math.PI * 2);

      dummy.position.set(p.x, 0, p.z);
      dummy.rotation.set(0, rotY, 0);
      dummy.scale.set(girthScale, scale, girthScale);
      dummy.updateMatrix();
      if (isB && trunkInstB) {
        trunkInstB.setMatrixAt(idxB++, dummy.matrix);
      } else if (trunkInstA) {
        trunkInstA.setMatrixAt(idxA++, dummy.matrix);
      }

      // Grounded root-soil collar
      dummy.position.set(p.x, 0, p.z);
      dummy.rotation.set(0, rotY, 0);
      dummy.scale.set(girthScale, 1, girthScale);
      dummy.updateMatrix();
      rootSoilInst.setMatrixAt(k, dummy.matrix);

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
          tier = 0;
          pitch = -0.94 + (f / 4) * 0.28;
          fScale = scale * (0.68 + (f % 2) * 0.09);
          yOff = 0.28 * scale;
          hue = 0.235 + ((i + f) % 3) * 0.012;
          sat = 0.44;
          light = 0.46 + (f % 2) * 0.04;
        } else if (f < 10) {
          tier = 1;
          pitch = -0.46 + ((f - 4) / 6) * 0.26;
          fScale = scale * (0.88 + (f % 3) * 0.06);
          yOff = 0.14 * scale;
          hue = 0.255 + ((i + f) % 4) * 0.011;
          sat = 0.38;
          light = 0.40 + (f % 3) * 0.035;
        } else if (f < 17) {
          tier = 2;
          pitch = -0.06 + ((f - 10) / 7) * 0.24;
          fScale = scale * (1.02 + (f % 3) * 0.065);
          yOff = 0.0;
          hue = 0.265 + ((i + f) % 5) * 0.01;
          sat = 0.34;
          light = 0.35 + (f % 3) * 0.03;
        } else {
          tier = 3;
          pitch = 0.26 + ((f - 17) / 5) * 0.26;
          fScale = scale * (0.96 + (f % 2) * 0.09);
          yOff = -0.14 * scale;
          hue = 0.215 + ((i + f) % 4) * 0.012;
          sat = 0.32;
          light = 0.33 + (f % 3) * 0.03;
        }

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

    if (trunkInstA) {
      trunkInstA.instanceMatrix.needsUpdate = true;
      trunkInstA.computeBoundingSphere();
      worldGroup.add(trunkInstA);
    }
    if (trunkInstB) {
      trunkInstB.instanceMatrix.needsUpdate = true;
      trunkInstB.computeBoundingSphere();
      worldGroup.add(trunkInstB);
    }
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

    worldGroup.add(rootSoilInst, deadSkirtInst, dateInst, frondInst);
  }

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

  // 7. Hyperrealistic LADWP / California Cobra-Head Gooseneck Streetlamps (Octagonal Flanged Base,
  //    Anchor Bolts, Tapered Mast, Gusseted Under-Brace Strut, Die-Cast Finned Cobra-Head Luminaire,
  //    Top NEMA Twist-Lock Photocell Sensor & Prismatic Multi-Cell LED Refractor Lens) + Fire Hydrants
  const lampCount = STREETLAMP_POSITIONS.length;

  // A) Brushed Galvanized Mast, Fluted Pedestal Base, Anchor Bolts & Cantilever Arm
  const lampPoleParts: Array<{ geo: THREE.BufferGeometry }> = [];
  const pushLampPole = (geo: THREE.BufferGeometry): void => {
    lampPoleParts.push({ geo });
  };

  // Octagonal concrete/steel foundation plinth + anchor bolt flange + 4 anchor nuts
  const lampBasePlinth = new THREE.CylinderGeometry(0.24, 0.29, 0.34, 8);
  lampBasePlinth.translate(0, 0.17, 0);
  pushLampPole(lampBasePlinth);
  const lampFlangePlate = new THREE.CylinderGeometry(0.22, 0.24, 0.06, 8);
  lampFlangePlate.translate(0, 0.37, 0);
  pushLampPole(lampFlangePlate);
  for (let b = 0; b < 4; b++) {
    const ang = (b + 0.5) * Math.PI * 0.5;
    const nut = new THREE.CylinderGeometry(0.024, 0.024, 0.07, 6);
    nut.translate(Math.cos(ang) * 0.175, 0.41, Math.sin(ang) * 0.175);
    pushLampPole(nut);
  }

  // Sculpted decorative cast transition skirt (0.38m -> 1.15m) + electrical service access hatch
  const lampSkirt = new THREE.CylinderGeometry(0.115, 0.195, 0.78, 10);
  lampSkirt.translate(0, 0.77, 0);
  pushLampPole(lampSkirt);
  const lampNeckCollar = new THREE.CylinderGeometry(0.135, 0.135, 0.09, 10);
  lampNeckCollar.translate(0, 1.16, 0);
  pushLampPole(lampNeckCollar);
  const lampAccessDoor = new THREE.BoxGeometry(0.10, 0.34, 0.035);
  lampAccessDoor.translate(0, 0.78, -0.155);
  pushLampPole(lampAccessDoor);

  // Tapered vertical steel column up to Y = 6.55m + top pole finial cap
  const lampShaft = new THREE.CylinderGeometry(0.076, 0.112, 5.42, 12);
  lampShaft.translate(0, 3.86, 0);
  pushLampPole(lampShaft);
  const lampPoleCap = new THREE.SphereGeometry(0.084, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
  lampPoleCap.translate(0, 6.57, 0);
  pushLampPole(lampPoleCap);

  // Double clamp collar at Y = 6.15m & Y = 5.42m where arm & gusset brace bolt onto the mast
  for (const cy of [6.15, 5.42]) {
    const clamp = new THREE.CylinderGeometry(0.105, 0.105, 0.12, 10);
    clamp.translate(0, cy, 0);
    pushLampPole(clamp);
  }

  // Sweeping architectural gooseneck davit arm curving out to (0, 7.42, 1.98)
  const lampArmCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 6.14, 0.04),
    new THREE.Vector3(0, 6.86, 0.45),
    new THREE.Vector3(0, 7.36, 1.18),
    new THREE.Vector3(0, 7.42, 1.98),
  ]);
  pushLampPole(new THREE.TubeGeometry(lampArmCurve, 14, 0.052, 8, false));

  // Diagonal under-brace scroll strut + twin truss web rings for authentic Los Angeles municipal tensile support
  const lampBraceCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 5.42, 0.05),
    new THREE.Vector3(0, 6.18, 0.46),
    new THREE.Vector3(0, 7.08, 1.05),
  ]);
  pushLampPole(new THREE.TubeGeometry(lampBraceCurve, 8, 0.028, 6, false));
  const trussRingA = new THREE.TorusGeometry(0.16, 0.018, 6, 12);
  trussRingA.rotateY(Math.PI * 0.5);
  trussRingA.translate(0, 6.32, 0.26);
  pushLampPole(trussRingA);
  const trussRingB = new THREE.TorusGeometry(0.11, 0.016, 6, 12);
  trussRingB.rotateY(Math.PI * 0.5);
  trussRingB.translate(0, 6.84, 0.66);
  pushLampPole(trussRingB);

  const poleGeo = mergeGeometryEntries(lampPoleParts);
  for (const p of lampPoleParts) p.geo.dispose();
  const poleInst = new THREE.InstancedMesh(poleGeo, mats.brushedMetal, lampCount);

  // B) Die-Cast Dark-Anodized Aerodynamic Cobra-Head Luminaire Housing, Heat-Sink Fins & Photocell
  const lampHeadParts: Array<{ geo: THREE.BufferGeometry }> = [];
  const pushLampHead = (geo: THREE.BufferGeometry): void => {
    lampHeadParts.push({ geo });
  };

  // Slip-fitter tenon coupling sleeve at Z = 1.98m
  const slipFitter = new THREE.CylinderGeometry(0.068, 0.072, 0.22, 8);
  slipFitter.rotateX(Math.PI * 0.5);
  slipFitter.translate(0, 7.41, 1.96);
  pushLampHead(slipFitter);

  // Rear driver electronics compartment & tapered aerodynamic cobra upper shell
  const driverDeck = new THREE.BoxGeometry(0.32, 0.13, 0.30);
  driverDeck.translate(0, 7.42, 2.08);
  pushLampHead(driverDeck);
  const cobraShell = new THREE.BoxGeometry(0.38, 0.11, 0.54);
  cobraShell.rotateX(0.03);
  cobraShell.translate(0, 7.41, 2.34);
  pushLampHead(cobraShell);
  const cobraNose = new THREE.CylinderGeometry(0.17, 0.19, 0.11, 10);
  cobraNose.scale(1.0, 1.0, 0.75);
  cobraNose.translate(0, 7.40, 2.61);
  pushLampHead(cobraNose);

  // 5 dorsal thermal dissipation heat-sink fins along upper luminaire back
  for (let f = -2; f <= 2; f++) {
    const fin = new THREE.BoxGeometry(0.022, 0.045, 0.42);
    fin.translate(f * 0.068, 7.48, 2.34);
    pushLampHead(fin);
  }

  // NEMA twist-lock daylight photocell sensor dome on top of driver housing
  const photocellBase = new THREE.CylinderGeometry(0.042, 0.046, 0.055, 8);
  photocellBase.translate(0, 7.51, 2.08);
  pushLampHead(photocellBase);
  const photocellCap = new THREE.SphereGeometry(0.042, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55);
  photocellCap.translate(0, 7.535, 2.08);
  pushLampHead(photocellCap);

  // Deep glare-cutoff bezel skirt framing the recessed LED refractor lens at (0, 7.31, 2.34)
  const bezelFrame = new THREE.BoxGeometry(0.36, 0.06, 0.52);
  bezelFrame.translate(0, 7.34, 2.34);
  pushLampHead(bezelFrame);

  const lampHeadGeo = mergeGeometryEntries(lampHeadParts);
  for (const p of lampHeadParts) p.geo.dispose();
  const lampHeadInst = new THREE.InstancedMesh(lampHeadGeo, mats.darkChrome, lampCount);

  // C) Prismatic Multi-Cell LED Refractor Drop-Lens & Internal Reflector Cavity (centered at 0, 7.30, 2.30)
  const lensPrism = new THREE.BoxGeometry(0.31, 0.055, 0.46);
  lensPrism.translate(0, 7.31, 2.32);
  const lensDropDome = new THREE.SphereGeometry(0.15, 12, 8);
  lensDropDome.scale(0.92, 0.36, 1.38);
  lensDropDome.translate(0, 7.285, 2.32);
  const bulbGeo = mergeGeometryEntries([{ geo: lensPrism }, { geo: lensDropDome }]);
  lensPrism.dispose();
  lensDropDome.dispose();
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
    lampHeadInst.setMatrixAt(i, dummy.matrix);
    bulbInst.setMatrixAt(i, dummy.matrix);
  }
  poleInst.castShadow = true;
  lampHeadInst.castShadow = true;
  poleInst.instanceMatrix.needsUpdate = true;
  poleInst.computeBoundingSphere();
  lampHeadInst.instanceMatrix.needsUpdate = true;
  lampHeadInst.computeBoundingSphere();
  bulbInst.instanceMatrix.needsUpdate = true;
  bulbInst.computeBoundingSphere();
  worldGroup.add(
    poleInst,
    lampHeadInst,
    bulbInst,
    hydrantBarrelInst,
    hydrantCapInst,
    hydrantNozzleInst,
  );

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

  // GPU-Instanced Bus Shelters (collapses 66 meshes & 66 geometries -> 4 InstancedMeshes!)
  const bsRoofGeo = new THREE.BoxGeometry(3.4, 0.14, 1.45);
  const bsRoofMat4 = new THREE.Matrix4()
    .makeTranslation(0, 2.48, 0)
    .multiply(new THREE.Matrix4().makeRotationX(0.06));
  const bsAdBoxGeo = new THREE.BoxGeometry(0.16, 2.15, 1.32);
  const bsPostGeo = new THREE.CylinderGeometry(0.055, 0.06, 2.46, 8);
  const bsLegGeo = new THREE.BoxGeometry(0.08, 0.52, 0.44);
  const bsFrameGeo = mergeGeometryEntries([
    { geo: bsRoofGeo, matrix: bsRoofMat4 },
    { geo: bsAdBoxGeo, matrix: new THREE.Matrix4().makeTranslation(1.62, 1.25, 0) },
    { geo: bsPostGeo, matrix: new THREE.Matrix4().makeTranslation(-1.58, 1.23, -0.62) },
    { geo: bsPostGeo, matrix: new THREE.Matrix4().makeTranslation(0, 1.23, -0.62) },
    { geo: bsPostGeo, matrix: new THREE.Matrix4().makeTranslation(1.58, 1.23, -0.62) },
    { geo: bsLegGeo, matrix: new THREE.Matrix4().makeTranslation(-1.12, 0.26, -0.26) },
    { geo: bsLegGeo, matrix: new THREE.Matrix4().makeTranslation(0.68, 0.26, -0.26) },
  ]);
  bsRoofGeo.dispose();
  bsAdBoxGeo.dispose();
  bsPostGeo.dispose();
  bsLegGeo.dispose();

  const bsGlassGeo = new THREE.BoxGeometry(3.15, 2.15, 0.06);
  bsGlassGeo.translate(0, 1.25, -0.62);

  const bsAdPlaneGeo = new THREE.PlaneGeometry(1.18, 1.92);
  const bsAdGeo = mergeGeometryEntries([
    {
      geo: bsAdPlaneGeo,
      matrix: new THREE.Matrix4()
        .makeTranslation(1.71, 1.25, 0)
        .multiply(new THREE.Matrix4().makeRotationY(Math.PI * 0.5)),
    },
    {
      geo: bsAdPlaneGeo,
      matrix: new THREE.Matrix4()
        .makeTranslation(1.53, 1.25, 0)
        .multiply(new THREE.Matrix4().makeRotationY(-Math.PI * 0.5)),
    },
  ]);
  bsAdPlaneGeo.dispose();

  const bsSeatGeo = new THREE.BoxGeometry(2.15, 0.1, 0.48);
  bsSeatGeo.translate(-0.22, 0.52, -0.26);

  const bsFrameInst = new THREE.InstancedMesh(bsFrameGeo, mats.darkChrome, busShelters.length);
  bsFrameInst.castShadow = true;
  const bsGlassInst = new THREE.InstancedMesh(bsGlassGeo, mats.carGlass, busShelters.length);
  const bsAdInst = new THREE.InstancedMesh(bsAdGeo, mats.busAdMat, busShelters.length);
  const bsSeatInst = new THREE.InstancedMesh(bsSeatGeo, mats.woodPorch, busShelters.length);

  for (let i = 0; i < busShelters.length; i++) {
    const bs = busShelters[i];
    dummy.position.set(bs.x, 0, bs.z);
    dummy.rotation.set(0, bs.rotY, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    bsFrameInst.setMatrixAt(i, dummy.matrix);
    bsGlassInst.setMatrixAt(i, dummy.matrix);
    bsAdInst.setMatrixAt(i, dummy.matrix);
    bsSeatInst.setMatrixAt(i, dummy.matrix);
    propShadowSpots.push({ x: bs.x, z: bs.z, sx: 3.9, sz: 2.1 });
  }
  bsFrameInst.instanceMatrix.needsUpdate = true;
  bsFrameInst.computeBoundingSphere();
  bsGlassInst.instanceMatrix.needsUpdate = true;
  bsGlassInst.computeBoundingSphere();
  bsAdInst.instanceMatrix.needsUpdate = true;
  bsAdInst.computeBoundingSphere();
  bsSeatInst.instanceMatrix.needsUpdate = true;
  bsSeatInst.computeBoundingSphere();
  worldGroup.add(bsFrameInst, bsGlassInst, bsAdInst, bsSeatInst);

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
    { x: 43, z: -51.0, rotY: 0 },
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

  const benchSeatRawGeo = new THREE.BoxGeometry(1.78, 0.09, 0.52);
  benchSeatRawGeo.translate(0, 0.46, 0);
  const benchBackRawGeo = new THREE.BoxGeometry(1.78, 0.40, 0.07);
  benchBackRawGeo.translate(0, 0.84, -0.23);
  const benchWoodGeo = mergeGeometryEntries([
    { geo: benchSeatRawGeo },
    { geo: benchBackRawGeo },
  ]);
  benchSeatRawGeo.dispose();
  benchBackRawGeo.dispose();

  const benchLegGeo = new THREE.BoxGeometry(0.08, 0.64, 0.50);
  benchLegGeo.translate(0, 0.32, 0);

  const benchWoodInst = new THREE.InstancedMesh(benchWoodGeo, mats.woodPorch, streetPropSpots.length);
  const benchLegInst = new THREE.InstancedMesh(benchLegGeo, mats.darkChrome, streetPropSpots.length * 2);
  benchWoodInst.castShadow = true;

  const newsGeo = new THREE.BoxGeometry(0.46, 1.04, 0.42);
  newsGeo.translate(0, 0.52, 0);
  const newsGlassGeo = new THREE.BoxGeometry(0.34, 0.38, 0.04);
  newsGlassGeo.translate(0, 0.76, 0.21);
  const newsInst = new THREE.InstancedMesh(newsGeo, mats.weatheredNewsBoxMat, streetPropSpots.length);
  const newsGlassInst = new THREE.InstancedMesh(newsGlassGeo, mats.carGlass, streetPropSpots.length);
  newsInst.castShadow = true;

  const propOffsetVec = new THREE.Vector3();
  for (let i = 0; i < streetPropSpots.length; i++) {
    const sp = streetPropSpots[i];
    dummy.position.set(sp.x, 0, sp.z);
    dummy.rotation.set(0, sp.rotY, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    benchWoodInst.setMatrixAt(i, dummy.matrix);
    propShadowSpots.push({ x: sp.x, z: sp.z, sx: 2.05, sz: 0.92 });

    // Real iron bench leg frames on both ends
    for (let li = 0; li < 2; li++) {
      propOffsetVec.set(li === 0 ? -0.76 : 0.76, 0, 0).applyAxisAngle(upAxis, sp.rotY);
      dummy.position.set(sp.x + propOffsetVec.x, 0, sp.z + propOffsetVec.z);
      dummy.updateMatrix();
      benchLegInst.setMatrixAt(i * 2 + li, dummy.matrix);
    }

    propOffsetVec.set(1.28, 0, 0).applyAxisAngle(upAxis, sp.rotY);
    dummy.position.set(sp.x + propOffsetVec.x, 0, sp.z + propOffsetVec.z);
    dummy.updateMatrix();
    trashInst.setMatrixAt(i, dummy.matrix);
    trashRimInst.setMatrixAt(i, dummy.matrix);
    propShadowSpots.push({ x: sp.x + propOffsetVec.x, z: sp.z + propOffsetVec.z, sx: 0.78, sz: 0.78 });

    propOffsetVec.set(-1.28, 0, 0).applyAxisAngle(upAxis, sp.rotY);
    dummy.position.set(sp.x + propOffsetVec.x, 0, sp.z + propOffsetVec.z);
    dummy.updateMatrix();
    newsInst.setMatrixAt(i, dummy.matrix);
    newsGlassInst.setMatrixAt(i, dummy.matrix);
    propShadowSpots.push({ x: sp.x + propOffsetVec.x, z: sp.z + propOffsetVec.z, sx: 0.86, sz: 0.82 });
  }
  trashInst.instanceMatrix.needsUpdate = true;
  trashInst.computeBoundingSphere();
  trashRimInst.instanceMatrix.needsUpdate = true;
  trashRimInst.computeBoundingSphere();
  benchWoodInst.instanceMatrix.needsUpdate = true;
  benchWoodInst.computeBoundingSphere();
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

  // California Octagonal STOP Signs at secondary sidewalk corners (GPU-Instanced!)
  const stopSpots = [
    { x: -8.3, z: -13.5, rotY: 0 },
    { x: 8.3, z: -13.5, rotY: Math.PI },
    { x: -8.3, z: 45.2, rotY: 0 },
    { x: 8.3, z: 62.8, rotY: Math.PI },
  ];
  const stopPoleGeo = new THREE.CylinderGeometry(0.04, 0.045, 2.55, 6);
  stopPoleGeo.translate(0, 1.28, 0);
  const stopPlateGeo = new THREE.BoxGeometry(0.66, 0.66, 0.05);
  stopPlateGeo.translate(0, 2.42, 0);
  const stopPoleInst = new THREE.InstancedMesh(stopPoleGeo, mats.brushedMetal, stopSpots.length);
  stopPoleInst.castShadow = true;
  const stopPlateInst = new THREE.InstancedMesh(stopPlateGeo, mats.stopSignMat, stopSpots.length);
  stopPlateInst.castShadow = true;
  for (let i = 0; i < stopSpots.length; i++) {
    const ss = stopSpots[i];
    dummy.position.set(ss.x, 0, ss.z);
    dummy.rotation.set(0, ss.rotY, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    stopPoleInst.setMatrixAt(i, dummy.matrix);
    stopPlateInst.setMatrixAt(i, dummy.matrix);
  }
  stopPoleInst.instanceMatrix.needsUpdate = true;
  stopPoleInst.computeBoundingSphere();
  stopPlateInst.instanceMatrix.needsUpdate = true;
  stopPlateInst.computeBoundingSphere();

  worldGroup.add(
    trashInst,
    trashRimInst,
    benchWoodInst,
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
    stopPoleInst,
    stopPlateInst,
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

  // 8. Real Walk-In Retail Interiors, Automatic Sliding Doors, Street Cart, & Unified Robbery Kit
  const shopMarkers: THREE.Group[] = [];
  const shopVisuals = buildShopWorldExtensions(scene, worldGroup, mats);

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
    obj.matrixAutoUpdate = false;
  });

  return {
    worldGroup,
    checkpointGroup,
    checkpointRing,
    checkpointColumn,
    shopMarkers,
    shopVisuals,
    birdFlock: {
      leftWings: birdLeftWings,
      rightWings: birdRightWings,
      bodies: birdBodies,
      count: birdCount,
    },
    dustMotes,
  };
}
