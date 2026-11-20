import * as THREE from 'three';
import type { HyperrealMaterialLibrary } from '../textures';
import type { RobberySession } from '../robberySystem';
import type { ShopSpec } from '../types';
import {
  BUILDINGS,
  getWalkInShopRoomProfile,
  SHOPS,
  shopLocalToWorld,
} from '../worldLayout';
import { dampValue } from '../physics';
import { fuseStaticGroupByMaterial, mergeGeometryEntries } from '../rendering/geometryFusion';

export interface ShopDoorRig {
  shopId: string;
  doorX: number;
  doorZ: number;
  facingHeading: number;
  leftLeaf: THREE.Mesh;
  rightLeaf: THREE.Mesh;
  openAmount: number; // 0 = closed, 1 = open
  wasOpen: boolean;
}

interface LooseBillSlot {
  mesh: THREE.Mesh;
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  vrx: number;
  vry: number;
  age: number;
  life: number;
}

interface CartSteamPuff {
  mesh: THREE.Mesh;
  phase: number;
  xOff: number;
  zOff: number;
}

export interface ShopWorldVisuals {
  doors: ShopDoorRig[];
  indoorRooms: Array<{ shopId: string; x: number; z: number; group: THREE.Group }>;
  pooledInteriorLight: THREE.PointLight;
  staticRegisterByShopId: Map<string, THREE.Group>;
  steamPuffs: CartSteamPuff[];
  robberyKit: RobberyWorldKit;
}

// Scratch vectors for Bezier cash stacks (zero per-frame GC)
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _pOut = new THREE.Vector3();

function evalQuadBezier(
  out: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  t: number,
): THREE.Vector3 {
  const u = 1 - t;
  out.set(
    u * u * a.x + 2 * u * t * b.x + t * t * c.x,
    u * u * a.y + 2 * u * t * b.y + t * t * c.y,
    u * u * a.z + 2 * u * t * b.z + t * t * c.z,
  );
  return out;
}

function createDollarBillTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#c9d7bd';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#2c5934';
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, 240, 112);
  ctx.strokeStyle = '#427849';
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, 220, 92);
  ctx.fillStyle = '#36663d';
  ctx.beginPath();
  ctx.ellipse(128, 64, 34, 42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#a9bfa0';
  ctx.beginPath();
  ctx.ellipse(128, 62, 24, 31, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1f4526';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('100', 44, 34);
  ctx.fillText('100', 212, 34);
  ctx.fillText('100', 44, 96);
  ctx.fillText('100', 212, 96);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createCheckeredFloorTexture(colorA: string, colorB: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const cells = 8;
  const step = 256 / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? colorA : colorB;
      ctx.fillRect(x * step, y * step, step, step);
      ctx.strokeStyle = 'rgba(0,0,0,0.16)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x * step + 1, y * step + 1, step - 2, step - 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSignCanvasTexture(
  title: string,
  subtitle: string,
  accentHex: string,
  bgHex = '#14110f',
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 144;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 512, 144);
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, 496, 128);
  ctx.fillStyle = accentHex;
  ctx.font = 'bold 46px Oswald, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title.toUpperCase(), 256, 60);
  ctx.fillStyle = '#efe5d4';
  ctx.font = 'bold 22px Oswald, sans-serif';
  ctx.fillText(subtitle.toUpperCase(), 256, 108);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createRegisterDisplayTexture(text: string, open: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = open ? '#0b2914' : '#091f10';
  ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = open ? '#49e073' : '#2a8042';
  ctx.lineWidth = 5;
  ctx.strokeRect(5, 5, 246, 86);
  ctx.fillStyle = open ? '#6eff92' : '#40cc66';
  ctx.font = 'bold 42px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createWoodGrainTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#c4945a';
  ctx.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(92,56,22,0.28)' : 'rgba(235,196,138,0.22)';
    ctx.lineWidth = 1 + (i % 3);
    ctx.beginPath();
    const x = (i / 40) * 128;
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + 8, 85, x - 8, 170, x + 3, 256);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createBeverageCoolerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 384;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 384);
  grad.addColorStop(0, '#1e3a47');
  grad.addColorStop(1, '#102029');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 384);
  const rowColors = ['#d93829', '#38b85c', '#f0a629', '#3282d9'];
  for (let row = 0; row < 4; row++) {
    const shelfY = 78 + row * 82;
    ctx.fillStyle = 'rgba(205, 245, 255, 0.24)';
    ctx.fillRect(14, shelfY - 66, 228, 12);
    const primary = rowColors[row % rowColors.length];
    const secondary = rowColors[(row + 2) % rowColors.length];
    for (let i = 0; i < 6; i++) {
      const bx = 22 + i * 36;
      ctx.fillStyle = i < 3 ? primary : secondary;
      ctx.fillRect(bx, shelfY - 46, 24, 42);
      ctx.fillRect(bx + 6, shelfY - 56, 12, 10);
      ctx.fillStyle = '#f2efe9';
      ctx.fillRect(bx + 2, shelfY - 32, 20, 12);
    }
    ctx.fillStyle = '#9aa8b0';
    ctx.fillRect(12, shelfY - 4, 232, 7);
  }
  ctx.strokeStyle = '#161b20';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 246, 374);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface SharedRegisterAssets {
  housingMat: THREE.MeshStandardMaterial;
  drawerMetalMat: THREE.MeshStandardMaterial;
  trayMat: THREE.MeshStandardMaterial;
  staticLedTex: THREE.CanvasTexture;
  staticLedMat: THREE.MeshStandardMaterial;
  staticHousingGeo: THREE.BufferGeometry;
  staticMetalGeo: THREE.BufferGeometry;
  staticDrawerGeo: THREE.BufferGeometry;
  staticScreenGeo: THREE.BufferGeometry;
}

function createSharedRegisterAssets(): SharedRegisterAssets {
  const housingMat = new THREE.MeshStandardMaterial({
    color: 0x26292e,
    roughness: 0.36,
    metalness: 0.58,
  });
  const drawerMetalMat = new THREE.MeshStandardMaterial({
    color: 0x8d959e,
    roughness: 0.28,
    metalness: 0.78,
  });
  const trayMat = new THREE.MeshStandardMaterial({
    color: 0x191b1f,
    roughness: 0.65,
    metalness: 0.25,
  });
  const staticLedTex = createRegisterDisplayTexture('$000.00', false);
  const staticLedMat = new THREE.MeshStandardMaterial({
    map: staticLedTex,
    emissive: new THREE.Color(0x4eff7a),
    emissiveMap: staticLedTex,
    emissiveIntensity: 0.9,
    roughness: 0.2,
  });

  // Pre-fuse the 7 static cash register sub-meshes into 4 shared geometries reused across all 7 shops
  const baseGeo = new THREE.BoxGeometry(0.56, 0.13, 0.48);
  const wedgeShape = new THREE.Shape();
  wedgeShape.moveTo(-0.22, 0);
  wedgeShape.lineTo(0.22, 0);
  wedgeShape.lineTo(0.22, 0.26);
  wedgeShape.lineTo(-0.08, 0.26);
  wedgeShape.lineTo(-0.22, 0.1);
  wedgeShape.closePath();
  const wedgeGeo = new THREE.ExtrudeGeometry(wedgeShape, {
    depth: 0.46,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.015,
    bevelThickness: 0.015,
  });
  wedgeGeo.translate(0, 0, -0.23);
  wedgeGeo.rotateY(Math.PI * 0.5);
  const screenBoxGeo = new THREE.BoxGeometry(0.28, 0.11, 0.06);

  const staticHousingGeo = mergeGeometryEntries([
    { geo: baseGeo, matrix: new THREE.Matrix4().makeTranslation(0, 0.065, 0) },
    { geo: wedgeGeo, matrix: new THREE.Matrix4().makeTranslation(0, 0.13, -0.02) },
    { geo: screenBoxGeo, matrix: new THREE.Matrix4().makeTranslation(0.14, 0.53, 0.12) },
  ]);
  baseGeo.dispose();
  wedgeGeo.dispose();
  screenBoxGeo.dispose();

  const postGeo = new THREE.CylinderGeometry(0.022, 0.026, 0.18, 8);
  const handleGeo = new THREE.BoxGeometry(0.18, 0.022, 0.03);
  const staticMetalGeo = mergeGeometryEntries([
    { geo: postGeo, matrix: new THREE.Matrix4().makeTranslation(0.14, 0.42, 0.12) },
    { geo: handleGeo, matrix: new THREE.Matrix4().makeTranslation(0, 0.06, -0.22) },
  ]);
  postGeo.dispose();
  handleGeo.dispose();

  const staticDrawerGeo = new THREE.BoxGeometry(0.5, 0.095, 0.42);
  staticDrawerGeo.translate(0, 0.055, 0);

  const staticScreenGeo = new THREE.PlaneGeometry(0.24, 0.085);
  staticScreenGeo.translate(0.14, 0.53, 0.153);

  return {
    housingMat,
    drawerMetalMat,
    trayMat,
    staticLedTex,
    staticLedMat,
    staticHousingGeo,
    staticMetalGeo,
    staticDrawerGeo,
    staticScreenGeo,
  };
}

function buildStaticCashRegisterProp(
  mats: HyperrealMaterialLibrary,
  regAssets: SharedRegisterAssets,
): THREE.Group {
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(regAssets.staticHousingGeo, regAssets.housingMat),
    new THREE.Mesh(regAssets.staticMetalGeo, mats.brushedMetal),
    new THREE.Mesh(regAssets.staticDrawerGeo, regAssets.drawerMetalMat),
    new THREE.Mesh(regAssets.staticScreenGeo, regAssets.staticLedMat),
  );
  return group;
}

function buildCashRegisterProp(
  mats: HyperrealMaterialLibrary,
  billTexture: THREE.CanvasTexture,
  interactive: boolean,
  regAssets?: SharedRegisterAssets,
): {
  group: THREE.Group;
  drawer: THREE.Group;
  ledMat: THREE.MeshStandardMaterial;
  ledTex: THREE.CanvasTexture;
} {
  const group = new THREE.Group();
  const housingMat =
    regAssets?.housingMat ??
    new THREE.MeshStandardMaterial({
      color: 0x26292e,
      roughness: 0.36,
      metalness: 0.58,
    });
  const drawerMetalMat =
    regAssets?.drawerMetalMat ??
    new THREE.MeshStandardMaterial({
      color: 0x8d959e,
      roughness: 0.28,
      metalness: 0.78,
    });
  const trayMat =
    regAssets?.trayMat ??
    new THREE.MeshStandardMaterial({
      color: 0x191b1f,
      roughness: 0.65,
      metalness: 0.25,
    });

  if (regAssets) {
    group.add(new THREE.Mesh(regAssets.staticHousingGeo, housingMat));
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.026, 0.18, 8),
      mats.brushedMetal,
    );
    post.position.set(0.14, 0.42, 0.12);
    group.add(post);
  } else {
    const baseHousing = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 0.13, 0.48),
      housingMat,
    );
    baseHousing.position.set(0, 0.065, 0);
    group.add(baseHousing);

    const wedgeShape = new THREE.Shape();
    wedgeShape.moveTo(-0.22, 0);
    wedgeShape.lineTo(0.22, 0);
    wedgeShape.lineTo(0.22, 0.26);
    wedgeShape.lineTo(-0.08, 0.26);
    wedgeShape.lineTo(-0.22, 0.1);
    wedgeShape.closePath();

    const wedgeGeo = new THREE.ExtrudeGeometry(wedgeShape, {
      depth: 0.46,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.015,
      bevelThickness: 0.015,
    });
    wedgeGeo.translate(0, 0, -0.23);
    wedgeGeo.rotateY(Math.PI * 0.5);
    const wedge = new THREE.Mesh(wedgeGeo, housingMat);
    wedge.position.set(0, 0.13, -0.02);
    group.add(wedge);

    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.026, 0.18, 8),
      mats.brushedMetal,
    );
    post.position.set(0.14, 0.42, 0.12);
    group.add(post);

    const screenBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.11, 0.06),
      housingMat,
    );
    screenBox.position.set(0.14, 0.53, 0.12);
    group.add(screenBox);
  }

  const ledTex = createRegisterDisplayTexture('$000.00', false);
  const ledMat = new THREE.MeshStandardMaterial({
    map: ledTex,
    emissive: new THREE.Color(0x4eff7a),
    emissiveMap: ledTex,
    emissiveIntensity: 0.9,
    roughness: 0.2,
  });
  const screenFace = new THREE.Mesh(
    regAssets?.staticScreenGeo ?? new THREE.PlaneGeometry(0.24, 0.085),
    ledMat,
  );
  if (!regAssets) {
    screenFace.position.set(0.14, 0.53, 0.153);
  }
  group.add(screenFace);

  const drawer = new THREE.Group();
  const drawerPan = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.095, 0.42),
    drawerMetalMat,
  );
  drawerPan.position.set(0, 0.055, 0);
  drawer.add(drawerPan);

  if (interactive) {
    const drawerWell = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.06, 0.36),
      trayMat,
    );
    drawerWell.position.set(0, 0.082, 0);
    drawer.add(drawerWell);

    const billBedMat = new THREE.MeshStandardMaterial({
      map: billTexture,
      roughness: 0.7,
    });
    const divGeo = new THREE.BoxGeometry(0.012, 0.055, 0.34);
    const bedGeo = new THREE.BoxGeometry(0.085, 0.025, 0.26);
    for (let i = 0; i < 4; i++) {
      const div = new THREE.Mesh(divGeo, drawerMetalMat);
      div.position.set(-0.16 + i * 0.105, 0.09, 0);
      drawer.add(div);

      const bed = new THREE.Mesh(bedGeo, billBedMat);
      bed.position.set(-0.155 + i * 0.105, 0.095, 0);
      drawer.add(bed);
    }
  }

  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.022, 0.03),
    mats.brushedMetal,
  );
  handle.position.set(0, 0.06, -0.22);
  drawer.add(handle);

  group.add(drawer);
  return { group, drawer, ledMat, ledTex };
}

/**
 * Unified dynamic robbery prop kit anchored directly inside the active shop's
 * world coordinate frame (works identically inside walk-in buildings AND at the
 * outdoor Cluckin' Bell street cart or LS Customs mechanic counter!).
 */
export class RobberyWorldKit {
  public readonly root = new THREE.Group();
  private readonly mats: HyperrealMaterialLibrary;
  private readonly billTexture: THREE.CanvasTexture;
  private readonly batWoodTex: THREE.CanvasTexture;

  private readonly registerGroup: THREE.Group;
  private readonly registerDrawer: THREE.Group;
  private readonly registerLedMat: THREE.MeshStandardMaterial;
  private activeLedTex: THREE.CanvasTexture;
  private registerLedOpenState = false;

  private readonly duffelGroup: THREE.Group;
  private readonly duffelFlapPivot: THREE.Group;
  private readonly duffelInnerCash: THREE.Mesh;

  private readonly cashStacks: THREE.Group[] = [];
  private readonly looseBills: LooseBillSlot[] = [];

  private readonly batGroup: THREE.Group;
  private readonly batSwingTrailMat: THREE.MeshBasicMaterial;
  public readonly clerkTelegraphRing: THREE.Mesh;

  private activeShop: ShopSpec | null = null;

  constructor(
    scene: THREE.Scene,
    mats: HyperrealMaterialLibrary,
    sharedBillTex?: THREE.CanvasTexture,
    regAssets?: SharedRegisterAssets,
  ) {
    this.mats = mats;
    this.billTexture = sharedBillTex ?? createDollarBillTexture();
    this.batWoodTex = createWoodGrainTexture();

    this.root.visible = false;
    scene.add(this.root);

    const reg = buildCashRegisterProp(mats, this.billTexture, true, regAssets);
    this.registerGroup = reg.group;
    this.registerDrawer = reg.drawer;
    this.registerLedMat = reg.ledMat;
    this.activeLedTex = reg.ledTex;
    this.root.add(this.registerGroup);

    const bag = this.buildDuffelBag();
    this.duffelGroup = bag.group;
    this.duffelFlapPivot = bag.flapPivot;
    this.duffelInnerCash = bag.innerCash;
    this.root.add(this.duffelGroup);

    const stackBillMat = new THREE.MeshStandardMaterial({
      map: this.billTexture,
      roughness: 0.72,
      metalness: 0.02,
    });
    const stackStrapMat = new THREE.MeshStandardMaterial({ color: 0xe6b84c, roughness: 0.55 });
    const stackLowerGeo = new THREE.BoxGeometry(0.18, 0.044, 0.086);
    stackLowerGeo.translate(0, 0.022, 0);
    const stackUpperGeo = new THREE.BoxGeometry(0.176, 0.012, 0.084);
    stackUpperGeo.rotateY(0.06);
    stackUpperGeo.translate(0.004, 0.048, 0.003);
    const stackBillsGeo = mergeGeometryEntries([
      { geo: stackLowerGeo },
      { geo: stackUpperGeo },
    ]);
    stackLowerGeo.dispose();
    stackUpperGeo.dispose();
    const stackBandGeo = new THREE.BoxGeometry(0.038, 0.052, 0.09);
    stackBandGeo.translate(0, 0.026, 0);

    for (let i = 0; i < 5; i++) {
      const stack = new THREE.Group();
      stack.add(
        new THREE.Mesh(stackBillsGeo, stackBillMat),
        new THREE.Mesh(stackBandGeo, stackStrapMat),
      );
      stack.visible = false;
      this.root.add(stack);
      this.cashStacks.push(stack);
    }

    const looseGeo = new THREE.PlaneGeometry(0.16, 0.075);
    const looseMat = new THREE.MeshStandardMaterial({
      map: this.billTexture,
      side: THREE.DoubleSide,
      roughness: 0.72,
    });
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(looseGeo, looseMat);
      m.visible = false;
      this.root.add(m);
      this.looseBills.push({
        mesh: m,
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        vrx: 0,
        vry: 0,
        age: 0,
        life: 1,
      });
    }

    const bat = this.buildBaseballBat();
    this.batGroup = bat.group;
    this.batSwingTrailMat = bat.trailMat;
    this.batGroup.visible = false;
    this.root.add(this.batGroup);

    const tRingGeo = new THREE.RingGeometry(0.45, 0.76, 26);
    tRingGeo.rotateX(-Math.PI * 0.5);
    this.clerkTelegraphRing = new THREE.Mesh(
      tRingGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff3028,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.clerkTelegraphRing.position.y = 0.065;
    this.clerkTelegraphRing.visible = false;
    this.root.add(this.clerkTelegraphRing);
  }

  private buildDuffelBag() {
    const group = new THREE.Group();
    const canvasMat = new THREE.MeshPhysicalMaterial({
      color: 0x222923,
      normalMap: this.mats.fabricNormalMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughness: 0.88,
      sheen: 0.35,
      sheenRoughness: 0.85,
    });
    const strapMat = new THREE.MeshStandardMaterial({ color: 0x141514, roughness: 0.82 });

    const drumGeo = new THREE.CylinderGeometry(0.175, 0.185, 0.52, 16);
    drumGeo.rotateZ(Math.PI * 0.5);
    const drum = new THREE.Mesh(drumGeo, canvasMat);
    drum.position.y = 0.175;
    drum.scale.set(1, 0.9, 1.05);
    group.add(drum);

    const innerCash = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.09, 0.17),
      new THREE.MeshStandardMaterial({ map: this.billTexture, roughness: 0.72 }),
    );
    innerCash.position.set(0, 0.25, 0);
    innerCash.visible = false;
    group.add(innerCash);

    const flapPivot = new THREE.Group();
    flapPivot.position.set(0, 0.32, -0.1);
    const flapMesh = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.032, 0.22), canvasMat);
    flapMesh.position.set(0, 0.015, 0.1);
    const zipRail = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.016, 0.022), this.mats.brassTrim);
    zipRail.position.set(0, 0.022, 0.205);
    flapPivot.add(flapMesh, zipRail);
    group.add(flapPivot);

    for (const sz of [-0.14, 0.14]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.14, 0.27, sz),
        new THREE.Vector3(-0.08, 0.42, sz * 0.8),
        new THREE.Vector3(0.08, 0.42, sz * 0.8),
        new THREE.Vector3(0.14, 0.27, sz),
      ]);
      const strap = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 10, 0.014, 6, false),
        strapMat,
      );
      group.add(strap);
    }

    return { group, flapPivot, innerCash };
  }

  private buildBaseballBat() {
    const group = new THREE.Group();
    const pts: THREE.Vector2[] = [
      new THREE.Vector2(0.001, 0.0),
      new THREE.Vector2(0.026, 0.008),
      new THREE.Vector2(0.028, 0.028),
      new THREE.Vector2(0.016, 0.042),
      new THREE.Vector2(0.015, 0.25),
      new THREE.Vector2(0.021, 0.42),
      new THREE.Vector2(0.032, 0.58),
      new THREE.Vector2(0.038, 0.74),
      new THREE.Vector2(0.036, 0.84),
      new THREE.Vector2(0.02, 0.868),
      new THREE.Vector2(0.001, 0.875),
    ];
    const batMesh = new THREE.Mesh(
      new THREE.LatheGeometry(pts, 18),
      new THREE.MeshStandardMaterial({
        map: this.batWoodTex,
        color: 0xd9ad74,
        roughness: 0.34,
        metalness: 0.06,
      }),
    );
    batMesh.castShadow = true;
    group.add(batMesh);

    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0175, 0.018, 0.22, 10),
      new THREE.MeshStandardMaterial({ color: 0x161618, roughness: 0.92 }),
    );
    grip.position.y = 0.145;
    group.add(grip);

    const trailMat = new THREE.MeshBasicMaterial({
      color: 0xff5a36,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const trail = new THREE.Mesh(
      new THREE.RingGeometry(0.38, 0.86, 16, 1, -Math.PI * 0.15, Math.PI * 0.65),
      trailMat,
    );
    trail.position.y = 0.1;
    trail.rotation.y = Math.PI * 0.5;
    group.add(trail);

    return { group, trailMat };
  }

  public activate(shop: ShopSpec, staticRegisters: Map<string, THREE.Group>): void {
    this.activeShop = shop;
    for (const [id, reg] of staticRegisters.entries()) {
      reg.visible = id !== shop.id;
    }

    this.root.position.set(shop.originX, 0, shop.originZ);
    this.root.rotation.set(0, shop.facingHeading, 0);
    this.root.visible = true;

    const counterY = shop.venueMode === 'street_cart' ? 1.02 : 1.07;
    const regZ = shop.counterLocalZ;
    this.registerGroup.position.set(0.58, counterY, regZ);
    this.duffelGroup.position.set(-0.68, counterY, regZ + 0.15);
    this.duffelGroup.rotation.set(0, 0.18, 0);
    this.duffelFlapPivot.rotation.x = 0;
    this.duffelInnerCash.visible = false;
    this.registerDrawer.position.z = 0;
    this.batGroup.visible = false;
    this.clerkTelegraphRing.visible = false;
    for (const s of this.cashStacks) s.visible = false;
    for (const b of this.looseBills) {
      b.active = false;
      b.mesh.visible = false;
    }

    this.setRegisterOpen(false);
  }

  public deactivate(staticRegisters: Map<string, THREE.Group>): void {
    this.activeShop = null;
    this.root.visible = false;
    for (const reg of staticRegisters.values()) {
      reg.visible = true;
    }
  }

  private setRegisterOpen(open: boolean): void {
    if (open === this.registerLedOpenState) return;
    this.registerLedOpenState = open;
    this.activeLedTex.dispose();
    this.activeLedTex = createRegisterDisplayTexture(open ? 'ABIERTA' : '$000.00', open);
    this.registerLedMat.map = this.activeLedTex;
    this.registerLedMat.emissiveMap = this.activeLedTex;
    this.registerLedMat.needsUpdate = true;
  }

  public triggerBillBurst(count: number, worldCenterX: number, worldCenterZ: number): void {
    if (!this.activeShop) return;
    const dx = worldCenterX - this.activeShop.originX;
    const dz = worldCenterZ - this.activeShop.originZ;
    const c = Math.cos(this.activeShop.facingHeading);
    const s = Math.sin(this.activeShop.facingHeading);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;

    let spawned = 0;
    for (let i = 0; i < this.looseBills.length && spawned < count; i++) {
      const slot = this.looseBills[i];
      if (slot.active) continue;
      slot.active = true;
      slot.age = 0;
      slot.life = 0.85 + Math.random() * 0.5;
      slot.x = lx + (Math.random() - 0.5) * 0.35;
      slot.y = 1.28 + Math.random() * 0.14;
      slot.z = lz + (Math.random() - 0.5) * 0.25;
      const a = Math.random() * Math.PI * 2;
      const spd = 1.1 + Math.random() * 1.9;
      slot.vx = Math.cos(a) * spd;
      slot.vz = Math.sin(a) * spd;
      slot.vy = 2.0 + Math.random() * 1.5;
      slot.rx = Math.random() * Math.PI;
      slot.ry = Math.random() * Math.PI;
      slot.rz = Math.random() * Math.PI;
      slot.vrx = (Math.random() - 0.5) * 14;
      slot.vry = (Math.random() - 0.5) * 12;
      slot.mesh.visible = true;
      spawned++;
    }
  }

  public update(session: RobberySession | null, dt: number, nowSec: number): void {
    if (!session || !this.activeShop) return;

    const shop = this.activeShop;
    const counterY = shop.venueMode === 'street_cart' ? 1.02 : 1.07;
    const regZ = shop.counterLocalZ;

    // 1. Register drawer & LED state
    this.registerDrawer.position.z = -0.32 * session.drawerOpenRatio;
    this.setRegisterOpen(session.drawerOpenRatio > 0.45);

    // 2. Duffel bag placement: on counter while open, on CJ hip/hand when exiting
    const carryBag =
      session.phase === 'exiting' ||
      (session.outcome === 'comply' && session.stacksCollected >= session.totalStacks) ||
      (session.outcome === 'rebel' && session.registerLooted);

    if (carryBag) {
      // Follow CJ's right side smoothly
      const handAngle = session.cjHeading + Math.PI * 0.5;
      this.duffelGroup.position.set(
        session.cjX + Math.sin(handAngle) * 0.36,
        0.58 + Math.abs(Math.sin(session.cjWalkCycle)) * 0.04,
        session.cjZ + Math.cos(handAngle) * 0.36,
      );
      this.duffelGroup.rotation.set(0.12, session.cjHeading, 0);
      this.duffelFlapPivot.rotation.x = 0.05;
    } else {
      this.duffelGroup.position.set(-0.68, counterY, regZ + 0.15);
      this.duffelGroup.rotation.set(0, 0.18, 0);
      const flapOpen =
        session.phase === 'comply_open' || session.phase === 'comply_bag' || session.phase === 'intimidate';
      this.duffelFlapPivot.rotation.x = flapOpen ? -1.45 : 0;
    }

    this.duffelInnerCash.visible = session.stacksCollected > 0 || session.registerLooted;
    const fillRatio = Math.min(1, session.stacksCollected / Math.max(1, session.totalStacks));
    this.duffelInnerCash.position.y = 0.21 + fillRatio * 0.075;

    // 3. 5x 3D Cash stacks flying along parabolic quadratic Bezier arcs into duffel
    for (let i = 0; i < this.cashStacks.length; i++) {
      const stack = this.cashStacks[i];
      if (i < session.stacksCollected) {
        const st = session.stacks[i];
        const fly = st ? (st.state === 'bagged' ? 1 : st.state === 'bagging' ? st.progress : 0) : 1;
        if (fly < 1) {
          stack.visible = true;
          _p0.set(0.54 + (i - 2) * 0.07, counterY + 0.12, regZ - 0.18);
          _p1.set(-0.08, counterY + 0.84, regZ + 0.08);
          _p2.set(-0.68, counterY + 0.26, regZ + 0.15);
          evalQuadBezier(_pOut, _p0, _p1, _p2, fly);
          stack.position.copy(_pOut);
          stack.rotation.set(fly * Math.PI * 2, fly * Math.PI * 1.6, 0);
        } else {
          stack.visible = false;
        }
      } else if (session.phase === 'comply_bag' || session.phase === 'comply_open') {
        stack.visible = true;
        stack.position.set(0.32 + (i % 3) * 0.2, counterY + 0.04 + Math.floor(i / 3) * 0.045, regZ + 0.06);
        stack.rotation.set(0, (i - 2) * 0.14, 0);
      } else {
        stack.visible = false;
      }
    }

    // 4. Pooled loose flying dollar bills
    for (let i = 0; i < this.looseBills.length; i++) {
      const slot = this.looseBills[i];
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age >= slot.life) {
        slot.active = false;
        slot.mesh.visible = false;
        continue;
      }
      slot.vy -= 4.8 * dt;
      slot.vx *= 1 - 1.5 * dt;
      slot.vz *= 1 - 1.5 * dt;
      slot.x += slot.vx * dt;
      slot.y += slot.vy * dt + Math.sin(nowSec * 9 + i) * 0.005;
      slot.z += slot.vz * dt;
      if (slot.y < 0.07) {
        slot.y = 0.07;
        slot.vy = 0;
        slot.vx *= 0.85;
        slot.vz *= 0.85;
      }
      slot.rx += slot.vrx * dt;
      slot.ry += slot.vry * dt;
      slot.mesh.position.set(slot.x, slot.y, slot.z);
      slot.mesh.rotation.set(slot.rx, slot.ry, slot.rz);
    }

    // 5. Baseball bat synced to Clerk's hand or dropped beside KO body
    if (session.clerkBatDropped) {
      this.batGroup.visible = true;
      this.batGroup.position.set(session.clerkBatDropX, 0.095, session.clerkBatDropZ);
      this.batGroup.rotation.set(Math.PI * 0.5, 0, session.clerkHeading + 0.8);
      this.batSwingTrailMat.opacity = 0;
    } else if (session.clerkHasBat) {
      this.batGroup.visible = true;
      const forwardX = Math.sin(session.clerkHeading);
      const forwardZ = Math.cos(session.clerkHeading);
      const rightX = Math.cos(session.clerkHeading);
      const rightZ = -Math.sin(session.clerkHeading);
      this.batGroup.position.set(
        session.clerkX + rightX * 0.34 + forwardX * 0.18,
        1.08,
        session.clerkZ + rightZ * 0.34 + forwardZ * 0.18,
      );
      const actionProg =
        session.clerkAction === 'swing'
          ? Math.max(0, Math.min(1, 1 - session.clerkActionTimer / 0.24))
          : session.clerkAction === 'windup'
            ? Math.max(0, Math.min(1, 1 - session.clerkActionTimer / 0.56))
            : 0;
      const swingAngle =
        session.clerkAction === 'swing'
          ? 1.45 * Math.sin(actionProg * Math.PI)
          : session.clerkAction === 'windup'
            ? -0.75 * actionProg
            : 0.25;
      this.batGroup.rotation.set(0.45 + swingAngle, session.clerkHeading, -0.35);
      this.batSwingTrailMat.opacity =
        session.clerkAction === 'swing'
          ? 0.55 * Math.sin(actionProg * Math.PI)
          : 0;
    } else {
      this.batGroup.visible = false;
      this.batSwingTrailMat.opacity = 0;
    }

    // 6. Crimson bat windup telegraph ring under clerk
    const showTelegraph =
      session.clerkAction === 'windup' ||
      session.clerkAction === 'swing' ||
      session.phase === 'rebel_qte_dodge';
    this.clerkTelegraphRing.visible = showTelegraph;
    if (showTelegraph) {
      this.clerkTelegraphRing.position.set(session.clerkX, 0.075, session.clerkZ);
      const pulse = 1 + Math.sin(nowSec * 14) * 0.12;
      this.clerkTelegraphRing.scale.set(pulse, pulse, 1);
    }
  }
}

function buildCategoryInteriorDecor(
  shop: ShopSpec,
  roomFrontZ: number,
  mats: HyperrealMaterialLibrary,
  billTex: THREE.CanvasTexture,
  coolerTex: THREE.CanvasTexture,
): THREE.Group {
  const g = new THREE.Group();
  const backWallZ = -2.42;

  const signTex = createSignCanvasTexture(shop.name, 'ABIERTO 24 HORAS', shop.accentHex, '#14110f');
  const signMat = new THREE.MeshStandardMaterial({
    map: signTex,
    emissive: new THREE.Color(shop.accentHex),
    emissiveMap: signTex,
    emissiveIntensity: 0.55,
    roughness: 0.65,
  });
  const backSign = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.92, 0.1), signMat);
  backSign.position.set(0, 2.86, backWallZ - 0.12);
  g.add(backSign);

  if (shop.category === 'market') {
    const fridgeBodyMat = new THREE.MeshStandardMaterial({
      color: 0x222830,
      roughness: 0.48,
      metalness: 0.35,
    });
    const glassGlowMat = new THREE.MeshStandardMaterial({
      map: coolerTex,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: coolerTex,
      emissiveIntensity: 0.42,
      roughness: 0.28,
    });
    for (const cx of [-2.8, 0, 2.8]) {
      const fridge = new THREE.Mesh(new THREE.BoxGeometry(1.45, 2.15, 0.56), fridgeBodyMat);
      fridge.position.set(cx, 1.12, backWallZ + 0.15);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(1.26, 1.82, 0.05), glassGlowMat);
      glass.position.set(cx, 1.15, backWallZ + 0.44);
      g.add(fridge, glass);
    }
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0xd4cec2, roughness: 0.65 });
    const packMats = [0xe84a32, 0x38b85c, 0xf2bf30, 0x3b86e0].map(
      (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.55 }),
    );
    for (const sx of [-4.22, 4.22]) {
      const rack = new THREE.Mesh(new THREE.BoxGeometry(0.65, 1.85, Math.max(2.6, roomFrontZ - 1.4)), shelfMat);
      rack.position.set(sx, 0.96, (roomFrontZ - 1.4) * 0.5 - 0.4);
      g.add(rack);
      for (let r = 0; r < 4; r++) {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(0.3, 0.24, 0.54),
          packMats[r % packMats.length],
        );
        box.position.set(sx + (sx < 0 ? 0.24 : -0.24), 0.58 + r * 0.38, 0.4 + (r - 1.5) * 0.72);
        g.add(box);
      }
    }
  } else if (shop.category === 'clothing') {
    const shirtMats = [0x1f5c2d, 0x8f2420, 0x1e222b, 0xc99c3c, 0x315880].map(
      (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.88 }),
    );
    const cubby = new THREE.Mesh(
      new THREE.BoxGeometry(5.6, 1.75, 0.48),
      new THREE.MeshStandardMaterial({ color: 0x382e26, roughness: 0.72 }),
    );
    cubby.position.set(0, 0.92, backWallZ + 0.12);
    g.add(cubby);
    for (const sx of [-4.15, 4.15]) {
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, Math.max(2.8, roomFrontZ - 1.4), 8),
        mats.brushedMetal,
      );
      bar.rotation.x = Math.PI * 0.5;
      bar.position.set(sx, 1.58, (roomFrontZ - 1.4) * 0.5 - 0.3);
      g.add(bar);
      for (let i = 0; i < 5; i++) {
        const shirt = new THREE.Mesh(
          new THREE.BoxGeometry(0.42, 0.68, 0.18),
          shirtMats[i % shirtMats.length],
        );
        shirt.position.set(sx, 1.18, 0.4 + i * 0.62);
        g.add(shirt);
      }
    }
  } else if (shop.category === 'weapons') {
    const peg = new THREE.Mesh(
      new THREE.BoxGeometry(6.4, 1.75, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x262924, roughness: 0.75, metalness: 0.3 }),
    );
    peg.position.set(0, 1.45, backWallZ - 0.1);
    g.add(peg);
    for (let r = 0; r < 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 0.07), mats.darkChrome);
        body.position.set(c * 1.22, 1.16 + r * 0.56, backWallZ);
        g.add(body);
      }
    }
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x3c4532, roughness: 0.85 });
    for (const sx of [-4.15, 4.15]) {
      for (let i = 0; i < 3; i++) {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.48, 1.05), crateMat);
        crate.position.set(sx, 0.28 + (i === 2 ? 0.48 : 0), 0.8 + (i % 2) * 1.25);
        g.add(crate);
      }
    }
  } else if (shop.category === 'food') {
    const menuTex = createSignCanvasTexture('COMBO GIGANTE $9', 'BLEEDER · PAPAS · SPRUNK', '#ff9032', '#29150b');
    const menuMat = new THREE.MeshStandardMaterial({
      map: menuTex,
      emissive: new THREE.Color(0xffaa44),
      emissiveMap: menuTex,
      emissiveIntensity: 0.65,
      roughness: 0.3,
    });
    for (const mx of [-2.2, 2.2]) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.76, 0.08), menuMat);
      board.position.set(mx, 2.38, backWallZ - 0.1);
      g.add(board);
    }
    const hood = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.52, 0.75), mats.brushedMetal);
    hood.position.set(0, 2.08, backWallZ + 0.25);
    const prep = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.92, 0.65), mats.brushedMetal);
    prep.position.set(0, 0.5, backWallZ + 0.2);
    g.add(hood, prep);
  }

  // Subtle floor mat right in front of the checkout counter so player knows where to pay/rob
  const matMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.75, 0.025, 0.92),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(shop.accentHex).multiplyScalar(0.42),
      roughness: 0.88,
    }),
  );
  matMesh.position.set(0, 0.072, 0.85);
  g.add(matMesh);

  void billTex;
  return g;
}

/**
 * Builds the 5 real walk-in store interiors + articulated sliding automatic doors,
 * the outdoor Cluckin' Bell street cart, the open LS Customs mechanic counter,
 * 1 pooled interior ceiling light, and the unified in-world RobberyWorldKit.
 */
export function buildShopWorldExtensions(
  scene: THREE.Scene,
  worldGroup: THREE.Group,
  mats: HyperrealMaterialLibrary,
): ShopWorldVisuals {
  const billTex = createDollarBillTexture();
  const coolerTex = createBeverageCoolerTexture();
  const sharedRegAssets = createSharedRegisterAssets();
  const doors: ShopDoorRig[] = [];
  const indoorRooms: Array<{ shopId: string; x: number; z: number; group: THREE.Group }> = [];
  const staticRegisterByShopId = new Map<string, THREE.Group>();
  const steamPuffs: CartSteamPuff[] = [];

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xd9d0c1, roughness: 0.88, metalness: 0.02 });
  const wainscotMat = new THREE.MeshStandardMaterial({ color: 0x3b322b, roughness: 0.72, metalness: 0.08 });
  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xc8c2b8, roughness: 0.9 });
  const counterTopMat = new THREE.MeshStandardMaterial({ color: 0xded6c8, roughness: 0.34, metalness: 0.1 });
  const storefrontGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0xaad4eb,
    roughness: 0.1,
    metalness: 0.08,
    transparent: true,
    opacity: 0.26,
    side: THREE.DoubleSide,
  });
  const doorGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0xbde4f7,
    roughness: 0.08,
    metalness: 0.1,
    transparent: true,
    opacity: 0.34,
    side: THREE.DoubleSide,
  });
  const tubeGlowMat = new THREE.MeshStandardMaterial({
    color: 0xfff8eb,
    emissive: new THREE.Color(0xfff0d4),
    emissiveIntensity: 1.45,
    roughness: 0.2,
  });

  // Pre-fused shared geometries for all 10 sliding automatic glass door leaves (collapses 60 meshes -> 20!)
  const sharedDoorGlassGeo = new THREE.BoxGeometry(1.66, 2.66, 0.05);
  const doorHorizGeo = new THREE.BoxGeometry(1.68, 0.1, 0.08);
  const doorStileGeo = new THREE.BoxGeometry(0.06, 2.66, 0.08);
  const doorPushGeo = new THREE.BoxGeometry(1.42, 0.055, 0.1);
  const sharedDoorFrameGeo = mergeGeometryEntries([
    { geo: doorHorizGeo, matrix: new THREE.Matrix4().makeTranslation(0, -1.28, 0) },
    { geo: doorHorizGeo, matrix: new THREE.Matrix4().makeTranslation(0, 1.28, 0) },
    { geo: doorStileGeo, matrix: new THREE.Matrix4().makeTranslation(-0.8, 0, 0) },
    { geo: doorStileGeo, matrix: new THREE.Matrix4().makeTranslation(0.8, 0, 0) },
    { geo: doorPushGeo, matrix: new THREE.Matrix4().makeTranslation(0, -0.32, 0) },
  ]);
  doorHorizGeo.dispose();
  doorStileGeo.dispose();
  doorPushGeo.dispose();

  const floorPalettes: Record<ShopSpec['category'], [string, string]> = {
    market: ['#dad3c4', '#404843'],
    clothing: ['#dfd7cb', '#bfb3a1'],
    food: ['#e6dcc8', '#b83c2a'],
    weapons: ['#6e7068', '#52554e'],
    customs: ['#5a5d61', '#484b4f'],
  };

  for (const shop of SHOPS) {
    if (shop.venueMode === 'indoor' && shop.buildingId) {
      const b = BUILDINGS.find((bld) => bld.id === shop.buildingId);
      if (!b) continue;
      const prof = getWalkInShopRoomProfile(b);
      const roomD = prof.roomFrontZ - prof.roomBackZ;
      const roomCenterZ = (prof.roomFrontZ + prof.roomBackZ) * 0.5;
      const roomW = prof.roomHalfW * 2;

      const roomGroup = new THREE.Group();
      roomGroup.position.set(b.x, 0, b.z);
      roomGroup.rotation.y = b.rotY;

      // Floor + Ceiling
      const [cA, cB] = floorPalettes[shop.category];
      const floorTex = createCheckeredFloorTexture(cA, cB);
      const floorGeo = new THREE.PlaneGeometry(roomW, roomD);
      floorGeo.rotateX(-Math.PI * 0.5);
      const floorMesh = new THREE.Mesh(
        floorGeo,
        new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.44, metalness: 0.05 }),
      );
      floorMesh.position.set(0, 0.055, roomCenterZ);
      floorMesh.receiveShadow = true;
      roomGroup.add(floorMesh);

      const ceilMesh = new THREE.Mesh(floorGeo, ceilingMat);
      ceilMesh.rotation.x = Math.PI;
      ceilMesh.position.set(0, 3.6, roomCenterZ);
      roomGroup.add(ceilMesh);

      // Back, Left, Right Interior Walls
      const backWall = new THREE.Mesh(new THREE.BoxGeometry(roomW, 3.6, 0.22), wallMat);
      backWall.position.set(0, 1.8, prof.roomBackZ - 0.1);
      const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.6, roomD), wallMat);
      leftWall.position.set(-prof.roomHalfW + 0.11, 1.8, roomCenterZ);
      const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.6, roomD), wallMat);
      rightWall.position.set(prof.roomHalfW - 0.11, 1.8, roomCenterZ);
      roomGroup.add(backWall, leftWall, rightWall);

      // Wainscot & Accent stripe
      const accentMat = new THREE.MeshStandardMaterial({ color: shop.accentHex, roughness: 0.42 });
      const wainBack = new THREE.Mesh(new THREE.BoxGeometry(roomW - 0.3, 1.05, 0.08), wainscotMat);
      wainBack.position.set(0, 0.54, prof.roomBackZ + 0.04);
      const stripeBack = new THREE.Mesh(new THREE.BoxGeometry(roomW - 0.3, 0.12, 0.09), accentMat);
      stripeBack.position.set(0, 2.28, prof.roomBackZ + 0.04);
      roomGroup.add(wainBack, stripeBack);

      // Ceiling Emissive Light Tubes
      for (const lz of [-0.6, 1.9, 4.2]) {
        if (lz > prof.roomFrontZ - 0.6) continue;
        for (const lx of [-2.0, 2.0]) {
          const tube = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.05, 0.16), tubeGlowMat);
          tube.position.set(lx, 3.54, lz);
          roomGroup.add(tube);
        }
      }

      // Transparent Storefront Display Windows + Aluminum Door Jambs flanking open 3.4m doorway
      const sideGlassW = prof.roomHalfW - prof.doorHalfW;
      for (const side of [-1, 1]) {
        const bulkhead = new THREE.Mesh(new THREE.BoxGeometry(sideGlassW, 0.65, 0.26), wainscotMat);
        bulkhead.position.set(side * (prof.doorHalfW + sideGlassW * 0.5), 0.325, prof.roomFrontZ - 0.1);
        const glassPane = new THREE.Mesh(new THREE.PlaneGeometry(sideGlassW - 0.12, 2.25), storefrontGlassMat);
        glassPane.position.set(side * (prof.doorHalfW + sideGlassW * 0.5), 1.78, prof.roomFrontZ - 0.1);
        const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.5, 0.28), mats.brushedMetal);
        jamb.position.set(side * prof.doorHalfW, 1.75, prof.roomFrontZ - 0.1);
        roomGroup.add(bulkhead, glassPane, jamb);
      }
      const doorTransom = new THREE.Mesh(new THREE.BoxGeometry(prof.doorHalfW * 2 + 0.2, 0.85, 0.28), mats.darkChrome);
      doorTransom.position.set(0, 3.16, prof.roomFrontZ - 0.1);
      const headerGlow = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.12, 0.32), accentMat);
      headerGlow.position.set(0, 2.74, prof.roomFrontZ - 0.1);
      roomGroup.add(doorTransom, headerGlow);

      // Checkout Counter Assembly
      const counterBody = new THREE.Mesh(
        new THREE.BoxGeometry(shop.counterHalfW * 2, 0.92, shop.counterHalfD * 2),
        wainscotMat,
      );
      counterBody.position.set(0, 0.51, shop.counterLocalZ);
      counterBody.castShadow = true;
      counterBody.receiveShadow = true;
      const counterTop = new THREE.Mesh(
        new THREE.BoxGeometry(shop.counterHalfW * 2 + 0.14, 0.08, shop.counterHalfD * 2 + 0.14),
        counterTopMat,
      );
      counterTop.position.set(0, 1.03, shop.counterLocalZ);
      const counterStrip = new THREE.Mesh(
        new THREE.BoxGeometry(shop.counterHalfW * 2 + 0.06, 0.07, 0.04),
        accentMat,
      );
      counterStrip.position.set(0, 0.94, shop.counterLocalZ + shop.counterHalfD + 0.01);
      roomGroup.add(counterBody, counterTop, counterStrip);

      // Category Shelving / Coolers / Weapon Wall / Burger Menu
      roomGroup.add(buildCategoryInteriorDecor(shop, prof.roomFrontZ, mats, billTex, coolerTex));

      // Static Register sitting on Counter (hidden whenever RobberyWorldKit activates on this shop)
      const staticReg = buildStaticCashRegisterProp(mats, sharedRegAssets);
      staticReg.position.set(0.58, 1.07, shop.counterLocalZ);
      roomGroup.add(staticReg);
      staticRegisterByShopId.set(shop.id, staticReg);

      // Lossless material-grouped geometry fusion collapses ~40 indoor shop meshes -> ~8 draw calls!
      fuseStaticGroupByMaterial(roomGroup, { exclude: new Set([staticReg]) });

      worldGroup.add(roomGroup);
      indoorRooms.push({ shopId: shop.id, x: shop.originX, z: shop.originZ, group: roomGroup });

      // Dynamic Sliding Double Glass Doors (added directly to `scene` so matrices update cleanly)
      const doorWorld = shopLocalToWorld(b.x, b.z, b.rotY, 0, prof.roomFrontZ - 0.1);
      const doorGroup = new THREE.Group();
      doorGroup.position.set(doorWorld.x, 0, doorWorld.z);
      doorGroup.rotation.y = b.rotY;
      doorGroup.updateMatrix();
      doorGroup.matrixAutoUpdate = false;

      const makeLeaf = (side: -1 | 1) => {
        const leaf = new THREE.Mesh(sharedDoorGlassGeo, doorGlassMat);
        const frame = new THREE.Mesh(sharedDoorFrameGeo, mats.brushedMetal);
        frame.matrixAutoUpdate = false;
        leaf.add(frame);
        leaf.position.set(side * 0.84, 1.38, 0);
        return leaf;
      };
      const leftLeaf = makeLeaf(-1);
      const rightLeaf = makeLeaf(1);
      doorGroup.add(leftLeaf, rightLeaf);
      scene.add(doorGroup);

      doors.push({
        shopId: shop.id,
        doorX: doorWorld.x,
        doorZ: doorWorld.z,
        facingHeading: b.rotY,
        leftLeaf,
        rightLeaf,
        openAmount: 0,
        wasOpen: false,
      });
    } else if (shop.venueMode === 'street_cart') {
      // === OUTDOOR CLUCKIN' BELL STREET FOOD CART (Real sidewalk prop — zero indoor walls!) ===
      const cartGroup = new THREE.Group();
      cartGroup.position.set(shop.originX, 0, shop.originZ);
      cartGroup.rotation.y = shop.facingHeading;

      const cartYellow = new THREE.MeshStandardMaterial({ color: 0xe6ac22, roughness: 0.42, metalness: 0.2 });
      const cartRed = new THREE.MeshStandardMaterial({ color: 0xb82b1e, roughness: 0.46, metalness: 0.15 });
      const grillGlow = new THREE.MeshStandardMaterial({
        color: 0x261a16,
        emissive: new THREE.Color(0xff5a18),
        emissiveIntensity: 0.72,
        roughness: 0.6,
      });

      // Contact shadow disc
      const shadowDisc = new THREE.Mesh(
        new THREE.PlaneGeometry(3.6, 1.7),
        new THREE.MeshBasicMaterial({ map: mats.contactShadowMap, transparent: true, opacity: 0.68, depthWrite: false }),
      );
      shadowDisc.rotation.x = -Math.PI * 0.5;
      shadowDisc.position.y = 0.055;
      cartGroup.add(shadowDisc);

      // Pneumatic Cart Wheels (Left side axle) + Steel Support Legs (Right side)
      const wheelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.12, 16);
      wheelGeo.rotateZ(Math.PI * 0.5);
      for (const wz of [-0.36, 0.36]) {
        const tire = new THREE.Mesh(wheelGeo, mats.carTire);
        tire.position.set(-1.35, 0.28, wz);
        tire.castShadow = true;
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.14, 10), mats.brushedMetal);
        hub.rotation.z = Math.PI * 0.5;
        hub.position.set(-1.35, 0.28, wz);
        cartGroup.add(tire, hub);
      }
      for (const lx of [1.22]) {
        for (const lz of [-0.36, 0.36]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.36, 8), mats.darkChrome);
          leg.position.set(lx, 0.18, lz);
          cartGroup.add(leg);
        }
      }

      // Main Branded Corrugated Cart Body & Stainless Countertop
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.85, 0.72, 0.94), cartYellow);
      body.position.set(0, 0.64, 0);
      body.castShadow = true;
      body.receiveShadow = true;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.88, 0.16, 0.96), cartRed);
      stripe.position.set(0, 0.78, 0);
      const counterTop = new THREE.Mesh(new THREE.BoxGeometry(3.04, 0.07, 1.04), mats.brushedMetal);
      counterTop.position.set(0, 1.0, 0);
      cartGroup.add(body, stripe, counterTop);

      // Sizzling Flat-Top Griddle + Chrome Condiment Bottles
      const griddle = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.06, 0.58), grillGlow);
      griddle.position.set(-0.72, 1.05, 0);
      cartGroup.add(griddle);

      const bottleColors = [0xd93025, 0xf2c230, 0xf4efe4];
      for (let i = 0; i < 3; i++) {
        const bottle = new THREE.Mesh(
          new THREE.CylinderGeometry(0.036, 0.04, 0.18, 8),
          new THREE.MeshStandardMaterial({ color: bottleColors[i], roughness: 0.45 }),
        );
        bottle.position.set(-0.08 + i * 0.12, 1.12, 0.22);
        cartGroup.add(bottle);
      }

      // 4 Upright Canopy Posts + Striped Sloped Awning Roof + Backlit Menu Header
      for (const px of [-1.36, 1.36]) {
        for (const pz of [-0.42, 0.42]) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.38, 8), mats.brushedMetal);
          post.position.set(px, 1.69, pz);
          cartGroup.add(post);
        }
      }
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(3.26, 0.14, 1.48), mats.awningPalettes[3]);
      canopy.position.set(0, 2.42, 0.08);
      canopy.rotation.x = 0.08;
      canopy.castShadow = true;
      cartGroup.add(canopy);

      const cartSignTex = createSignCanvasTexture("CLUCKIN' BELL", 'TACOS · ALITAS · SPRUNK', '#ffcf38', '#33140b');
      const cartSign = new THREE.Mesh(
        new THREE.BoxGeometry(2.55, 0.42, 0.08),
        new THREE.MeshStandardMaterial({
          map: cartSignTex,
          emissive: new THREE.Color(0xffcf38),
          emissiveMap: cartSignTex,
          emissiveIntensity: 0.72,
          roughness: 0.28,
        }),
      );
      cartSign.position.set(0, 2.26, 0.56);
      cartGroup.add(cartSign);

      // Floor customer ordering mat in front of cart
      const orderMat = new THREE.Mesh(
        new THREE.BoxGeometry(1.65, 0.025, 0.85),
        new THREE.MeshStandardMaterial({ color: 0x735216, roughness: 0.88 }),
      );
      orderMat.position.set(0, 0.055, 1.15);
      cartGroup.add(orderMat);

      // Static Cash Register on right end of street cart counter
      const staticReg = buildStaticCashRegisterProp(mats, sharedRegAssets);
      staticReg.position.set(0.58, 1.035, 0);
      cartGroup.add(staticReg);
      staticRegisterByShopId.set(shop.id, staticReg);

      fuseStaticGroupByMaterial(cartGroup, { exclude: new Set([staticReg]) });

      worldGroup.add(cartGroup);

      // 5 Dynamic Grill Steam Puffs (added directly to `scene` so they animate cleanly!)
      const steamMat = new THREE.MeshBasicMaterial({
        color: 0xf4eee6,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
      });
      const steamGeo = new THREE.SphereGeometry(0.11, 8, 6);
      for (let i = 0; i < 5; i++) {
        const puff = new THREE.Mesh(steamGeo, steamMat);
        const w = shopLocalToWorld(shop.originX, shop.originZ, shop.facingHeading, -0.72 + (i - 2) * 0.14, 0);
        puff.position.set(w.x, 1.18, w.z);
        scene.add(puff);
        steamPuffs.push({
          mesh: puff,
          phase: i * 1.25,
          xOff: w.x,
          zOff: w.z,
        });
      }
    } else if (shop.venueMode === 'outdoor_bay') {
      // === OUTDOOR LS CUSTOMS MECHANIC SERVICE COUNTER & DIAGNOSTIC BAY ===
      const bayGroup = new THREE.Group();
      bayGroup.position.set(shop.originX, 0, shop.originZ);
      bayGroup.rotation.y = shop.facingHeading;

      const benchBody = new THREE.Mesh(
        new THREE.BoxGeometry(shop.counterHalfW * 2, 0.94, shop.counterHalfD * 2),
        new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.45, metalness: 0.6 }),
      );
      benchBody.position.set(0, 0.5, 0);
      benchBody.castShadow = true;
      const benchTop = new THREE.Mesh(
        new THREE.BoxGeometry(shop.counterHalfW * 2 + 0.12, 0.08, shop.counterHalfD * 2 + 0.12),
        mats.brushedMetal,
      );
      benchTop.position.set(0, 1.02, 0);
      const orangeTrim = new THREE.Mesh(
        new THREE.BoxGeometry(shop.counterHalfW * 2 + 0.06, 0.09, 0.04),
        new THREE.MeshStandardMaterial({ color: 0xff7b29, roughness: 0.4 }),
      );
      orangeTrim.position.set(0, 0.92, shop.counterHalfD + 0.01);
      bayGroup.add(benchBody, benchTop, orangeTrim);

      // Rolling red mechanic cabinet beside bay + stacked performance tires
      const toolCab = new THREE.Mesh(
        new THREE.BoxGeometry(1.25, 1.12, 0.58),
        new THREE.MeshStandardMaterial({ color: 0xb0221c, roughness: 0.36, metalness: 0.45 }),
      );
      toolCab.position.set(-2.35, 0.58, -0.95);
      bayGroup.add(toolCab);

      const tireGeo = new THREE.TorusGeometry(0.3, 0.12, 8, 14);
      tireGeo.rotateX(Math.PI * 0.5);
      for (let t = 0; t < 3; t++) {
        const tire = new THREE.Mesh(tireGeo, mats.carTire);
        tire.position.set(2.35, 0.16 + t * 0.24, -0.75);
        bayGroup.add(tire);
      }

      const staticReg = buildStaticCashRegisterProp(mats, sharedRegAssets);
      staticReg.position.set(0.58, 1.06, 0);
      bayGroup.add(staticReg);
      staticRegisterByShopId.set(shop.id, staticReg);

      fuseStaticGroupByMaterial(bayGroup, { exclude: new Set([staticReg]) });

      worldGroup.add(bayGroup);
    }
  }

  // 1 Pooled Interior Ceiling Light (follows whichever walk-in store CJ is near/inside -> zero GPU light bloat!)
  const pooledInteriorLight = new THREE.PointLight(0xffe6c0, 0, 18, 1.4);
  pooledInteriorLight.position.set(0, 3.1, 0);
  scene.add(pooledInteriorLight);

  const robberyKit = new RobberyWorldKit(scene, mats, billTex, sharedRegAssets);

  return {
    doors,
    indoorRooms,
    pooledInteriorLight,
    staticRegisterByShopId,
    steamPuffs,
    robberyKit,
  };
}

/**
 * Animates automatic sliding glass store doors, pooled interior lighting, and Cluckin' Bell cart grill steam.
 * Returns any shop whose doors just slid open so the engine can play the authentic entry bell chime!
 */
export function updateShopWorldVisuals(
  visuals: ShopWorldVisuals,
  playerX: number,
  playerZ: number,
  robberyShopId: string | null,
  dt: number,
  nowSec: number,
): string | null {
  let newlyOpenedShopId: string | null = null;

  // 1. Automatic sliding double glass doors
  for (let i = 0; i < visuals.doors.length; i++) {
    const door = visuals.doors[i];
    const ddx = door.doorX - playerX;
    const ddz = door.doorZ - playerZ;
    const distSq = ddx * ddx + ddz * ddz;
    const shouldOpen = distSq <= 3.85 * 3.85 || robberyShopId === door.shopId;
    if (!shouldOpen && door.openAmount < 0.001) {
      if (door.openAmount !== 0) {
        door.openAmount = 0;
        door.wasOpen = false;
        door.leftLeaf.position.x = -0.84;
        door.rightLeaf.position.x = 0.84;
      }
      continue;
    }
    const target = shouldOpen ? 1 : 0;
    door.openAmount = dampValue(door.openAmount, target, shouldOpen ? 18.0 : 9.0, dt);

    const isOpenNow = door.openAmount > 0.28;
    if (shouldOpen && !door.wasOpen && distSq <= 3.85 * 3.85) {
      newlyOpenedShopId = door.shopId;
    }
    door.wasOpen = isOpenNow || shouldOpen;

    const slide = door.openAmount * 1.52;
    door.leftLeaf.position.x = -0.84 - slide;
    door.rightLeaf.position.x = 0.84 + slide;
  }

  // 1B. Distance-cull far indoor shop interiors (> 76m away) while keeping storefronts & active robbery shop visible
  for (let i = 0; i < visuals.indoorRooms.length; i++) {
    const room = visuals.indoorRooms[i];
    const rdx = room.x - playerX;
    const rdz = room.z - playerZ;
    room.group.visible = rdx * rdx + rdz * rdz < 76 * 76 || room.shopId === robberyShopId;
  }

  // 2. Pooled interior ceiling PointLight follows nearest walk-in store within 22m
  let bestShop: ShopSpec | null = null;
  let bestDistSq = 22.0 * 22.0;
  for (let i = 0; i < SHOPS.length; i++) {
    const s = SHOPS[i];
    if (s.venueMode !== 'indoor') continue;
    const sdx = s.originX - playerX;
    const sdz = s.originZ - playerZ;
    const dSq = sdx * sdx + sdz * sdz;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestShop = s;
    }
  }
  if (bestShop) {
    const bestDist = Math.sqrt(bestDistSq);
    visuals.pooledInteriorLight.position.set(bestShop.originX, 3.1, bestShop.originZ);
    const targetIntensity = Math.max(0, Math.min(26, (1 - Math.max(0, bestDist - 8) / 14) * 26));
    visuals.pooledInteriorLight.intensity = dampValue(
      visuals.pooledInteriorLight.intensity,
      targetIntensity,
      8,
      dt,
    );
  } else if (visuals.pooledInteriorLight.intensity > 0.01) {
    visuals.pooledInteriorLight.intensity = dampValue(
      visuals.pooledInteriorLight.intensity,
      0,
      8,
      dt,
    );
  } else {
    visuals.pooledInteriorLight.intensity = 0;
  }

  // 3. Cluckin' Bell street cart rising grill steam (culled when far from the cart)
  if (visuals.steamPuffs.length > 0) {
    const p0 = visuals.steamPuffs[0];
    const cdx = p0.xOff - playerX;
    const cdz = p0.zOff - playerZ;
    const nearCart = cdx * cdx + cdz * cdz < 70 * 70;
    for (let i = 0; i < visuals.steamPuffs.length; i++) {
      const p = visuals.steamPuffs[i];
      p.mesh.visible = nearCart;
      if (!nearCart) continue;
      const cycle = ((nowSec * 0.65 + p.phase) % 1 + 1) % 1;
      p.mesh.position.set(
        p.xOff + Math.sin(nowSec * 2.2 + i) * 0.08,
        1.1 + cycle * 0.95,
        p.zOff + Math.cos(nowSec * 1.9 + i) * 0.06,
      );
      const s = 0.55 + cycle * 1.35;
      p.mesh.scale.set(s, s * 0.85, s);
    }
  }

  return newlyOpenedShopId;
}
