import * as THREE from 'three';
import type { PlayerOutfitId, ShopSpec } from './types';
import type { HyperrealMaterialLibrary } from './textures';
import { buildCharacterRig, disposeCharacterRig, type CharacterRig } from './models';
import { getOutfitPalette } from './data/outfits';
import { dampValue } from './physics';
import type { RobberySession } from './robberySystem';

export const INTERIOR_ORIGIN = new THREE.Vector3(420, 0, 420);

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

// Scratch vectors (zero per-frame GC)
const _camGoal = new THREE.Vector3();
const _lookGoal = new THREE.Vector3();
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

  // Ornate outer green border
  ctx.strokeStyle = '#2c5934';
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, 240, 112);

  ctx.strokeStyle = '#427849';
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, 220, 92);

  // Center portrait medallion
  ctx.fillStyle = '#36663d';
  ctx.beginPath();
  ctx.ellipse(128, 64, 34, 42, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#a9bfa0';
  ctx.beginPath();
  ctx.ellipse(128, 62, 24, 31, 0, 0, Math.PI * 2);
  ctx.fill();

  // Silhouette bust inside oval
  ctx.fillStyle = '#254a2c';
  ctx.beginPath();
  ctx.arc(128, 52, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(128, 78, 16, 12, 0, Math.PI, Math.PI * 2);
  ctx.fill();

  // Corner $100 marks
  ctx.fillStyle = '#1f4526';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('100', 44, 34);
  ctx.fillText('100', 212, 34);
  ctx.fillText('100', 44, 96);
  ctx.fillText('100', 212, 96);

  // Serial band lines
  ctx.fillStyle = '#336b3b';
  ctx.fillRect(168, 58, 54, 6);
  ctx.fillRect(34, 58, 54, 6);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createCheckeredFloorTexture(colorA: string, colorB: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  const cells = 8;
  const step = 512 / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? colorA : colorB;
      ctx.fillRect(x * step, y * step, step, step);
      // Subtle tile grout & wear
      ctx.strokeStyle = 'rgba(0,0,0,0.16)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x * step + 1, y * step + 1, step - 2, step - 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 3.6);
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
  ctx.font = 'bold 48px Oswald, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title.toUpperCase(), 256, 62);

  ctx.fillStyle = '#efe5d4';
  ctx.font = 'bold 22px Oswald, sans-serif';
  ctx.fillText(subtitle.toUpperCase(), 256, 110);

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
  ctx.font = 'bold 44px monospace';
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
  for (let i = 0; i < 42; i++) {
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(92,56,22,0.28)' : 'rgba(235,196,138,0.22)';
    ctx.lineWidth = 1 + (i % 3);
    ctx.beginPath();
    const x = (i / 42) * 128;
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

  // Cool refrigerated dark teal-blue interior cavity
  const grad = ctx.createLinearGradient(0, 0, 0, 384);
  grad.addColorStop(0, '#1e3a47');
  grad.addColorStop(1, '#102029');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 384);

  // 4 lit beverage shelves with colorful Sprunk / eCola / Orang-O-Tang cans & bottles
  const rowColors = ['#d93829', '#38b85c', '#f0a629', '#3282d9'];
  for (let row = 0; row < 4; row++) {
    const shelfY = 78 + row * 82;
    // Soft fluorescent shelf light bar
    ctx.fillStyle = 'rgba(205, 245, 255, 0.24)';
    ctx.fillRect(14, shelfY - 66, 228, 12);

    // Cans / bottles across the shelf
    const primary = rowColors[row % rowColors.length];
    const secondary = rowColors[(row + 2) % rowColors.length];
    for (let i = 0; i < 6; i++) {
      const bx = 22 + i * 36;
      ctx.fillStyle = i < 3 ? primary : secondary;
      // Bottle body + neck
      ctx.fillRect(bx, shelfY - 46, 24, 42);
      ctx.fillRect(bx + 6, shelfY - 56, 12, 10);
      // White label stripe
      ctx.fillStyle = '#f2efe9';
      ctx.fillRect(bx + 2, shelfY - 32, 20, 12);
      // Cap
      ctx.fillStyle = '#181a1c';
      ctx.fillRect(bx + 6, shelfY - 60, 12, 4);
    }

    // Metallic shelf rail & price tag strip
    ctx.fillStyle = '#9aa8b0';
    ctx.fillRect(12, shelfY - 4, 232, 7);
    ctx.fillStyle = '#f0cf52';
    ctx.fillRect(28, shelfY - 3, 44, 5);
    ctx.fillRect(140, shelfY - 3, 44, 5);
  }

  // Vertical glass door mullion & chrome handle bar + subtle glass sheen
  ctx.strokeStyle = '#161b20';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 246, 374);
  ctx.fillStyle = '#1a2026';
  ctx.fillRect(124, 6, 8, 372);
  ctx.fillStyle = '#c8d2db';
  ctx.fillRect(114, 150, 6, 86);
  ctx.fillRect(136, 150, 6, 86);

  ctx.fillStyle = 'rgba(215, 244, 255, 0.11)';
  ctx.beginPath();
  ctx.moveTo(12, 12);
  ctx.lineTo(105, 12);
  ctx.lineTo(42, 372);
  ctx.lineTo(12, 372);
  ctx.closePath();
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class RobberyInteriorStage {
  public readonly scene: THREE.Scene;
  public readonly root: THREE.Group;
  private readonly mats: HyperrealMaterialLibrary;

  // Dedicated studio interior lighting rig inside the isolated interior scene
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly keyLight: THREE.PointLight;
  private readonly fillLight: THREE.PointLight;

  // Dynamic themed surfaces
  private readonly floorMesh: THREE.Mesh;
  private readonly accentStripeMat: THREE.MeshStandardMaterial;
  private readonly backSignMat: THREE.MeshStandardMaterial;
  private readonly categoryGroups: Record<ShopSpec['category'], THREE.Group>;
  private readonly exitMatGlow: THREE.MeshStandardMaterial;

  // Hero Prop 1: Articulated Cash Register
  private readonly registerGroup: THREE.Group;
  private readonly registerDrawer: THREE.Group;
  private readonly registerLedMat: THREE.MeshStandardMaterial;
  private registerLedOpenState = false;

  // Hero Prop 2: Tactical Duffel Bag
  private readonly duffelGroup: THREE.Group;
  private readonly duffelFlapPivot: THREE.Group;
  private readonly duffelInnerCash: THREE.Mesh;
  private duffelAttachedToHand = false;

  // Hero Prop 3: 5 Animated 3D Cash Stacks + 18 Pooled Loose Flying Dollar Bills
  private readonly cashStacks: THREE.Group[] = [];
  private readonly looseBills: LooseBillSlot[] = [];
  private readonly billTexture: THREE.CanvasTexture;
  private readonly coolerTexture: THREE.CanvasTexture;
  private readonly exitSignTex: THREE.CanvasTexture;

  // Hero Prop 4: Turned Baseball Bat (LatheGeometry) + Swing Arc Trail
  private readonly batGroup: THREE.Group;
  private readonly batBarrelMat: THREE.MeshStandardMaterial;
  private readonly batSwingTrailMat: THREE.MeshBasicMaterial;
  private readonly batWoodTex: THREE.CanvasTexture;
  private batAttachedToClerk = false;

  // Character Rigs inside the interior
  private readonly cjRig: CharacterRig;
  private clerkRig: CharacterRig | null = null;
  private clerkShopId = '';
  private clerkTelegraphRing: THREE.Mesh;

  // Smooth camera tracking inside interior
  private readonly camLookCurrent = new THREE.Vector3(
    INTERIOR_ORIGIN.x,
    INTERIOR_ORIGIN.y + 1.35,
    INTERIOR_ORIGIN.z - 1.2,
  );
  private camInitialized = false;

  // Disposable textures created dynamically per theme
  private activeFloorTex: THREE.CanvasTexture | null = null;
  private activeSignTex: THREE.CanvasTexture | null = null;
  private activeLedTex: THREE.CanvasTexture | null = null;
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];

  constructor(mainScene: THREE.Scene, mats: HyperrealMaterialLibrary) {
    this.mats = mats;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x161412);
    this.scene.environment = mainScene.environment;
    this.root = new THREE.Group();
    this.root.position.copy(INTERIOR_ORIGIN);
    this.scene.add(this.root);

    this.billTexture = createDollarBillTexture();
    this.coolerTexture = createBeverageCoolerTexture();
    this.batWoodTex = createWoodGrainTexture();

    // 1. Dedicated Interior Lighting Rig (isolated to robbery scene -> zero impact on exterior city!)
    this.hemiLight = new THREE.HemisphereLight(0xfff4e2, 0x45382e, 1.35);
    this.root.add(this.hemiLight);

    this.keyLight = new THREE.PointLight(0xffe6c0, 32, 18, 1.35);
    this.keyLight.position.set(0.2, 3.15, -0.35);
    this.root.add(this.keyLight);

    this.fillLight = new THREE.PointLight(0xc2dcff, 16, 16, 1.4);
    this.fillLight.position.set(-2.2, 2.85, 2.3);
    this.root.add(this.fillLight);

    // 2. Store Interior Architecture (Floor, Walls, Wainscoting, Ceiling Lights, Front Glass Door + EXIT)
    const wallMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xd9d0c1,
        roughness: 0.88,
        metalness: 0.02,
      }),
    );
    const wainscotMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x3b322b,
        roughness: 0.72,
        metalness: 0.08,
      }),
    );
    const ceilingMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xc2bcb2,
        roughness: 0.92,
      }),
    );
    this.accentStripeMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xff5232,
        roughness: 0.42,
        metalness: 0.15,
      }),
    );

    const floorGeo = this.trackGeo(new THREE.PlaneGeometry(9.4, 8.2));
    floorGeo.rotateX(-Math.PI * 0.5);
    const floorMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.42,
        metalness: 0.06,
      }),
    );
    this.floorMesh = new THREE.Mesh(floorGeo, floorMat);
    this.floorMesh.position.set(0, 0, 0.4);
    this.floorMesh.receiveShadow = true;
    this.root.add(this.floorMesh);

    const ceiling = new THREE.Mesh(floorGeo, ceilingMat);
    ceiling.rotation.x = Math.PI;
    ceiling.position.set(0, 3.65, 0.4);
    this.root.add(ceiling);

    // Back wall (z = -3.65), Left wall (x = -4.65), Right wall (x = 4.65)
    const backWallGeo = this.trackGeo(new THREE.BoxGeometry(9.5, 3.7, 0.25));
    const sideWallGeo = this.trackGeo(new THREE.BoxGeometry(0.25, 3.7, 8.4));
    const backWall = new THREE.Mesh(backWallGeo, wallMat);
    backWall.position.set(0, 1.85, -3.68);
    const leftWall = new THREE.Mesh(sideWallGeo, wallMat);
    leftWall.position.set(-4.68, 1.85, 0.4);
    const rightWall = new THREE.Mesh(sideWallGeo, wallMat);
    rightWall.position.set(4.68, 1.85, 0.4);
    this.root.add(backWall, leftWall, rightWall);

    // Wainscoting + Horizontal Accent Trim Band around interior walls
    const wainBack = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(9.32, 1.15, 0.08)),
      wainscotMat,
    );
    wainBack.position.set(0, 0.58, -3.52);
    const wainLeft = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.08, 1.15, 8.2)),
      wainscotMat,
    );
    wainLeft.position.set(-4.52, 0.58, 0.4);
    const wainRight = wainLeft.clone();
    wainRight.position.x = 4.52;
    this.root.add(wainBack, wainLeft, wainRight);

    const trimBack = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(9.34, 0.14, 0.1)),
      this.accentStripeMat,
    );
    trimBack.position.set(0, 2.38, -3.52);
    const trimLeft = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.1, 0.14, 8.2)),
      this.accentStripeMat,
    );
    trimLeft.position.set(-4.52, 2.38, 0.4);
    const trimRight = trimLeft.clone();
    trimRight.position.x = 4.52;
    this.root.add(trimBack, trimLeft, trimRight);

    // Architectural corner pilasters
    const pilasterGeo = this.trackGeo(new THREE.BoxGeometry(0.32, 3.65, 0.32));
    for (const px of [-4.48, 4.48]) {
      for (const pz of [-3.48, 4.28]) {
        const pil = new THREE.Mesh(pilasterGeo, wainscotMat);
        pil.position.set(px, 1.825, pz);
        this.root.add(pil);
      }
    }

    // Back-wall Glowing Store Brand Sign (matte backlit vinyl -> zero specular glare hotspot!)
    this.backSignMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.58,
        roughness: 0.92,
        metalness: 0.0,
      }),
    );
    const backSign = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(3.8, 0.96, 0.12)),
      this.backSignMat,
    );
    backSign.position.set(0, 2.94, -3.48);
    this.root.add(backSign);

    // Suspended Ceiling Fluorescent Fixtures
    const tubeHousingGeo = this.trackGeo(new THREE.BoxGeometry(2.3, 0.09, 0.28));
    const tubeGlowGeo = this.trackGeo(new THREE.BoxGeometry(2.15, 0.04, 0.16));
    const tubeGlowMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xfff8eb,
        emissive: new THREE.Color(0xfff0d4),
        emissiveIntensity: 1.5,
        roughness: 0.2,
      }),
    );
    for (const lz of [-1.8, 0.4, 2.5]) {
      for (const lx of [-2.0, 2.0]) {
        const hMesh = new THREE.Mesh(tubeHousingGeo, mats.darkChrome);
        hMesh.position.set(lx, 3.55, lz);
        const gMesh = new THREE.Mesh(tubeGlowGeo, tubeGlowMat);
        gMesh.position.set(lx, 3.49, lz);
        this.root.add(hMesh, gMesh);
      }
    }

    // Front Wall (z = +4.45) with Recessed Glass Storefront Windows, Door Jambs & Glowing SALIDA Sign
    const frontSideWallGeo = this.trackGeo(new THREE.BoxGeometry(3.1, 3.7, 0.26));
    const fWallL = new THREE.Mesh(frontSideWallGeo, wallMat);
    fWallL.position.set(-3.1, 1.85, 4.45);
    const fWallR = new THREE.Mesh(frontSideWallGeo, wallMat);
    fWallR.position.set(3.1, 1.85, 4.45);
    const fHeader = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(3.2, 1.15, 0.28)),
      wallMat,
    );
    fHeader.position.set(0, 3.12, 4.45);
    this.root.add(fWallL, fWallR, fHeader);

    // Solid Aluminum Door Frame + Dark Exterior Street Backdrop beyond glass
    const jambGeo = this.trackGeo(new THREE.BoxGeometry(0.14, 2.55, 0.34));
    const jambL = new THREE.Mesh(jambGeo, mats.brushedMetal);
    jambL.position.set(-1.42, 1.275, 4.42);
    const jambR = new THREE.Mesh(jambGeo, mats.brushedMetal);
    jambR.position.set(1.42, 1.275, 4.42);
    const glassPane = new THREE.Mesh(
      this.trackGeo(new THREE.PlaneGeometry(2.72, 2.52)),
      this.trackMat(
        new THREE.MeshPhysicalMaterial({
          color: 0x7aa4bf,
          roughness: 0.14,
          metalness: 0.1,
          transparent: true,
          opacity: 0.34,
        }),
      ),
    );
    glassPane.position.set(0, 1.26, 4.42);
    glassPane.rotation.y = Math.PI;
    // Street glow backdrop behind glass door
    const outsideBackdrop = new THREE.Mesh(
      this.trackGeo(new THREE.PlaneGeometry(6.0, 3.8)),
      this.trackMat(
        new THREE.MeshBasicMaterial({
          color: 0x382820,
        }),
      ),
    );
    outsideBackdrop.position.set(0, 1.8, 5.1);
    outsideBackdrop.rotation.y = Math.PI;
    this.root.add(jambL, jambR, glassPane, outsideBackdrop);

    // Glowing Green SALIDA / EXIT Sign above front doorway + Floor Escape Mat
    this.exitSignTex = createSignCanvasTexture('SALIDA', 'HUIR A LA CALLE', '#54f082', '#0b2112');
    const exitSignMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        map: this.exitSignTex,
        emissive: new THREE.Color(0x45e878),
        emissiveMap: this.exitSignTex,
        emissiveIntensity: 0.95,
        roughness: 0.2,
      }),
    );
    const exitSign = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(1.6, 0.42, 0.1)),
      exitSignMat,
    );
    exitSign.position.set(0, 2.84, 4.26);
    exitSign.rotation.y = Math.PI;
    this.root.add(exitSign);

    this.exitMatGlow = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x1e4d2b,
        emissive: new THREE.Color(0x30c960),
        emissiveIntensity: 0.42,
        roughness: 0.78,
      }),
    );
    const exitFloorMat = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(2.4, 0.03, 0.92)),
      this.exitMatGlow,
    );
    exitFloorMat.position.set(0, 0.015, 3.78);
    this.root.add(exitFloorMat);

    // 3. Multi-Part Front Counter (x in [-2.55, 2.55], z in [-1.75, -0.75], top y = 1.05)
    this.buildCounterAssembly();

    // 4. Category-Specific Store Decor (5 tailored retail environments)
    this.categoryGroups = {
      market: this.buildMarketDecor(),
      clothing: this.buildClothingDecor(),
      food: this.buildFoodDecor(),
      weapons: this.buildWeaponsDecor(),
      customs: this.buildCustomsDecor(),
    };
    for (const grp of Object.values(this.categoryGroups)) {
      grp.visible = false;
      this.root.add(grp);
    }

    // 5. Hero Prop 1: Articulated Cash Register on Counter at (0.58, 1.05, -1.24)
    const reg = this.buildCashRegister();
    this.registerGroup = reg.group;
    this.registerDrawer = reg.drawer;
    this.registerLedMat = reg.ledMat;
    this.registerGroup.position.set(0.58, 1.05, -1.24);
    this.root.add(this.registerGroup);

    // 6. Hero Prop 2: Sculpted Tactical Duffel Bag
    const bag = this.buildDuffelBag();
    this.duffelGroup = bag.group;
    this.duffelFlapPivot = bag.flapPivot;
    this.duffelInnerCash = bag.innerCash;
    this.duffelGroup.position.set(-0.68, 1.05, -1.06);
    this.root.add(this.duffelGroup);

    // 7. Hero Prop 3: 5x 3D Cash Stacks + 18x Pooled Loose Flying Bills
    for (let i = 0; i < 5; i++) {
      const stack = this.buildCashStack();
      stack.visible = false;
      this.root.add(stack);
      this.cashStacks.push(stack);
    }
    const looseGeo = this.trackGeo(new THREE.PlaneGeometry(0.16, 0.075));
    const looseMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        map: this.billTexture,
        side: THREE.DoubleSide,
        roughness: 0.72,
      }),
    );
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

    // 8. Hero Prop 4: Turned LatheGeometry Baseball Bat + Swing Arc Trail
    const bat = this.buildBaseballBat();
    this.batGroup = bat.group;
    this.batBarrelMat = bat.barrelMat;
    this.batSwingTrailMat = bat.trailMat;
    this.batGroup.visible = false;
    this.root.add(this.batGroup);

    // 9. Interior CJ Character Rig
    const classicOutfit = getOutfitPalette('classic_cj');
    this.cjRig = buildCharacterRig(mats, {
      shirtHex: classicOutfit.shirt,
      pantsHex: classicOutfit.pants,
      skinHex: 0x6b4530,
      shoeHex: 0xbab8b0,
      isProtagonist: true,
    });
    this.root.add(this.cjRig.root);

    // Crimson telegraph ring under clerk during brawl bat windups
    const tRingGeo = this.trackGeo(new THREE.RingGeometry(0.45, 0.76, 28));
    tRingGeo.rotateX(-Math.PI * 0.5);
    const tRingMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xff3028,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.clerkTelegraphRing = new THREE.Mesh(tRingGeo, tRingMat);
    this.clerkTelegraphRing.position.y = 0.04;
    this.clerkTelegraphRing.visible = false;
    this.root.add(this.clerkTelegraphRing);
  }

  private trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.ownedGeometries.push(g);
    return g;
  }

  private trackMat<T extends THREE.Material>(m: T): T {
    this.ownedMaterials.push(m);
    return m;
  }

  private buildCounterAssembly(): void {
    const group = new THREE.Group();
    const baseMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x453930,
        roughness: 0.72,
        metalness: 0.08,
      }),
    );
    const topMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xded6c8,
        roughness: 0.34,
        metalness: 0.12,
      }),
    );
    const kickMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x1b1918,
        roughness: 0.52,
        metalness: 0.38,
      }),
    );

    // Recessed dark metallic kickplate
    const kick = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(5.04, 0.14, 0.92)),
      kickMat,
    );
    kick.position.set(0, 0.07, -1.25);
    group.add(kick);

    // Main wood-paneled counter core
    const body = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(5.1, 0.84, 0.98)),
      baseMat,
    );
    body.position.set(0, 0.56, -1.25);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Front recessed decorative panels & vertical brass battens
    for (let i = -2; i <= 2; i++) {
      const batten = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.06, 0.72, 0.04)),
        this.mats.brassTrim,
      );
      batten.position.set(i * 0.98, 0.56, -0.75);
      group.add(batten);
    }

    // Accent trim strip under counter overhang
    const frontAccent = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(5.14, 0.07, 0.04)),
      this.accentStripeMat,
    );
    frontAccent.position.set(0, 0.94, -0.75);
    group.add(frontAccent);

    // Beveled overhanging terrazzo countertop (y top = 1.05)
    const topShape = new THREE.Shape();
    topShape.moveTo(-2.58, -0.52);
    topShape.lineTo(2.58, -0.52);
    topShape.lineTo(2.58, 0.52);
    topShape.lineTo(-2.58, 0.52);
    topShape.closePath();
    const topGeo = this.trackGeo(
      new THREE.ExtrudeGeometry(topShape, {
        depth: 0.055,
        bevelEnabled: true,
        bevelSegments: 3,
        bevelSize: 0.02,
        bevelThickness: 0.015,
      }),
    );
    topGeo.rotateX(Math.PI * 0.5);
    const counterTop = new THREE.Mesh(topGeo, topMat);
    counterTop.position.set(0, 1.035, -1.25);
    counterTop.receiveShadow = true;
    group.add(counterTop);

    // Left glass impulse display showcase on far left of counter
    const glassCase = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.9, 0.42, 0.52)),
      this.trackMat(
        new THREE.MeshPhysicalMaterial({
          color: 0xd8eef5,
          roughness: 0.1,
          transparent: true,
          opacity: 0.34,
        }),
      ),
    );
    glassCase.position.set(-1.95, 1.26, -1.24);
    group.add(glassCase);

    const caseFrame = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.92, 0.04, 0.54)),
      this.mats.brushedMetal,
    );
    caseFrame.position.set(-1.95, 1.48, -1.24);
    group.add(caseFrame);

    // Merchandise boxes inside vitrine
    const itemColors = [0xd94632, 0x3cb35e, 0xe8b532];
    for (let i = 0; i < 3; i++) {
      const box = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.2, 0.16, 0.2)),
        this.trackMat(
          new THREE.MeshStandardMaterial({ color: itemColors[i], roughness: 0.5 }),
        ),
      );
      box.position.set(-2.22 + i * 0.27, 1.14, -1.24);
      group.add(box);
    }

    this.root.add(group);
  }

  private buildCashRegister(): {
    group: THREE.Group;
    drawer: THREE.Group;
    ledMat: THREE.MeshStandardMaterial;
  } {
    const group = new THREE.Group();
    const housingMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x26292e,
        roughness: 0.36,
        metalness: 0.58,
      }),
    );
    const drawerMetalMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x8d959e,
        roughness: 0.28,
        metalness: 0.78,
      }),
    );
    const trayMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x191b1f,
        roughness: 0.65,
        metalness: 0.25,
      }),
    );

    // 1. Base chassis frame around sliding drawer
    const baseHousing = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.56, 0.13, 0.48)),
      housingMat,
    );
    baseHousing.position.set(0, 0.065, 0);
    group.add(baseHousing);

    // 2. Sculpted beveled slanted upper register body (ExtrudeGeometry)
    const wedgeShape = new THREE.Shape();
    wedgeShape.moveTo(-0.22, 0);
    wedgeShape.lineTo(0.22, 0);
    wedgeShape.lineTo(0.22, 0.26);
    wedgeShape.lineTo(-0.08, 0.26);
    wedgeShape.lineTo(-0.22, 0.1);
    wedgeShape.closePath();

    const wedgeGeo = this.trackGeo(
      new THREE.ExtrudeGeometry(wedgeShape, {
        depth: 0.46,
        bevelEnabled: true,
        bevelSegments: 4,
        bevelSize: 0.015,
        bevelThickness: 0.015,
      }),
    );
    wedgeGeo.translate(0, 0, -0.23);
    wedgeGeo.rotateY(Math.PI * 0.5);
    const wedge = new THREE.Mesh(wedgeGeo, housingMat);
    wedge.position.set(0, 0.13, -0.02);
    group.add(wedge);

    // 3. Tactile Keypad Buttons (3x4 grid facing clerk at -Z)
    const keyGeo = this.trackGeo(new THREE.BoxGeometry(0.042, 0.02, 0.036));
    const keyCharcoal = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x4b5058, roughness: 0.55 }),
    );
    const keyGreen = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x32a852, roughness: 0.45 }),
    );
    const keyRed = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xc93028, roughness: 0.45 }),
    );
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        const km =
          r === 0 && c === 3 ? keyGreen : r === 2 && c === 3 ? keyRed : keyCharcoal;
        const k = new THREE.Mesh(keyGeo, km);
        k.position.set(-0.12 + c * 0.065, 0.22 + r * 0.042, -0.18 + r * 0.045);
        k.rotation.x = -0.68;
        group.add(k);
      }
    }

    // 4. Swivel LED Price Display Turret (visible to CJ & camera on +Z side)
    const post = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.022, 0.026, 0.18, 10)),
      this.mats.brushedMetal,
    );
    post.position.set(0.14, 0.42, 0.12);
    group.add(post);

    const screenBox = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.28, 0.11, 0.06)),
      housingMat,
    );
    screenBox.position.set(0.14, 0.53, 0.12);
    group.add(screenBox);

    this.activeLedTex = createRegisterDisplayTexture('$000.00', false);
    const ledMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        map: this.activeLedTex,
        emissive: new THREE.Color(0x4eff7a),
        emissiveMap: this.activeLedTex,
        emissiveIntensity: 0.9,
        roughness: 0.2,
      }),
    );
    const screenFace = new THREE.Mesh(
      this.trackGeo(new THREE.PlaneGeometry(0.24, 0.085)),
      ledMat,
    );
    screenFace.position.set(0.14, 0.53, 0.153);
    group.add(screenFace);

    // 5. Receipt Printer Chute & Paper Roll
    const paperMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.85, side: THREE.DoubleSide }),
    );
    const receipt = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.09, 0.12, 0.008)),
      paperMat,
    );
    receipt.position.set(-0.14, 0.42, 0.04);
    receipt.rotation.x = 0.26;
    group.add(receipt);

    // 6. Articulated Sliding Metal Cash Drawer (slides out toward clerk -Z)
    const drawer = new THREE.Group();
    const drawerPan = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.5, 0.095, 0.42)),
      drawerMetalMat,
    );
    drawerPan.position.set(0, 0.055, 0);
    drawer.add(drawerPan);

    const drawerWell = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.45, 0.06, 0.36)),
      trayMat,
    );
    drawerWell.position.set(0, 0.082, 0);
    drawer.add(drawerWell);

    // 4 bill-compartment dividers + green cash beds inside drawer
    const billBedMat = this.trackMat(
      new THREE.MeshStandardMaterial({ map: this.billTexture, roughness: 0.7 }),
    );
    for (let i = 0; i < 4; i++) {
      const div = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.012, 0.055, 0.34)),
        drawerMetalMat,
      );
      div.position.set(-0.16 + i * 0.105, 0.09, 0);
      drawer.add(div);

      const bed = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.085, 0.025, 0.26)),
        billBedMat,
      );
      bed.position.set(-0.155 + i * 0.105, 0.095, 0);
      drawer.add(bed);
    }

    // Front brushed handle bar on drawer
    const handle = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.18, 0.022, 0.03)),
      this.mats.brushedMetal,
    );
    handle.position.set(0, 0.06, -0.22);
    drawer.add(handle);

    group.add(drawer);
    return { group, drawer, ledMat };
  }

  private buildDuffelBag(): {
    group: THREE.Group;
    flapPivot: THREE.Group;
    innerCash: THREE.Mesh;
  } {
    const group = new THREE.Group();
    const canvasMat = this.trackMat(
      new THREE.MeshPhysicalMaterial({
        color: 0x222923,
        normalMap: this.mats.fabricNormalMap,
        normalScale: new THREE.Vector2(0.75, 0.75),
        roughness: 0.88,
        sheen: 0.35,
        sheenRoughness: 0.85,
      }),
    );
    const strapMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x141514,
        roughness: 0.82,
      }),
    );
    const liningMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x0d100e,
        roughness: 0.95,
      }),
    );

    // Sculpted duffel drum body + rounded canvas end caps
    const drumGeo = this.trackGeo(new THREE.CylinderGeometry(0.175, 0.185, 0.52, 18));
    drumGeo.rotateZ(Math.PI * 0.5);
    const drum = new THREE.Mesh(drumGeo, canvasMat);
    drum.position.y = 0.175;
    drum.scale.set(1, 0.9, 1.05);
    group.add(drum);

    const endCapGeo = this.trackGeo(new THREE.SphereGeometry(0.175, 14, 12));
    for (const sx of [-0.26, 0.26]) {
      const cap = new THREE.Mesh(endCapGeo, canvasMat);
      cap.position.set(sx, 0.175, 0);
      cap.scale.set(0.32, 0.88, 1.02);
      group.add(cap);
    }

    // Side zippered utility pouch
    const pouch = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.28, 0.16, 0.05)),
      canvasMat,
    );
    pouch.position.set(0, 0.15, 0.185);
    group.add(pouch);

    // Dark interior cavity + rising stacked cash inside bag
    const cavity = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.42, 0.04, 0.2)),
      liningMat,
    );
    cavity.position.set(0, 0.31, 0);
    group.add(cavity);

    const innerCash = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.38, 0.09, 0.17)),
      this.trackMat(
        new THREE.MeshStandardMaterial({
          map: this.billTexture,
          roughness: 0.72,
        }),
      ),
    );
    innerCash.position.set(0, 0.25, 0);
    innerCash.visible = false;
    group.add(innerCash);

    // Hinged top flap with metallic zipper rail (flips open during bagging!)
    const flapPivot = new THREE.Group();
    flapPivot.position.set(0, 0.32, -0.1);
    const flapMesh = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.44, 0.032, 0.22)),
      canvasMat,
    );
    flapMesh.position.set(0, 0.015, 0.1);
    const zipRail = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.44, 0.016, 0.022)),
      this.mats.brassTrim,
    );
    zipRail.position.set(0, 0.022, 0.205);
    flapPivot.add(flapMesh, zipRail);
    group.add(flapPivot);

    // Two arched TubeGeometry webbing carry handles + brass D-rings
    for (const sz of [-0.14, 0.14]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.14, 0.27, sz),
        new THREE.Vector3(-0.08, 0.42, sz * 0.8),
        new THREE.Vector3(0.08, 0.42, sz * 0.8),
        new THREE.Vector3(0.14, 0.27, sz),
      ]);
      const strap = new THREE.Mesh(
        this.trackGeo(new THREE.TubeGeometry(curve, 12, 0.014, 6, false)),
        strapMat,
      );
      group.add(strap);
    }

    const dRingGeo = this.trackGeo(new THREE.TorusGeometry(0.024, 0.005, 6, 12));
    for (const sx of [-0.29, 0.29]) {
      const ring = new THREE.Mesh(dRingGeo, this.mats.brassTrim);
      ring.position.set(sx, 0.22, 0);
      ring.rotation.y = Math.PI * 0.5;
      group.add(ring);
    }

    return { group, flapPivot, innerCash };
  }

  private buildCashStack(): THREE.Group {
    const group = new THREE.Group();
    const billMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        map: this.billTexture,
        roughness: 0.72,
        metalness: 0.02,
      }),
    );
    const strapMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xe6b84c,
        roughness: 0.55,
      }),
    );

    const lowerBlock = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.18, 0.044, 0.086)),
      billMat,
    );
    lowerBlock.position.y = 0.022;
    const upperLeaf = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.176, 0.012, 0.084)),
      billMat,
    );
    upperLeaf.position.set(0.004, 0.048, 0.003);
    upperLeaf.rotation.y = 0.06;

    const band = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(0.038, 0.052, 0.09)),
      strapMat,
    );
    band.position.y = 0.026;

    group.add(lowerBlock, upperLeaf, band);
    return group;
  }

  private buildBaseballBat(): {
    group: THREE.Group;
    barrelMat: THREE.MeshStandardMaterial;
    trailMat: THREE.MeshBasicMaterial;
  } {
    const group = new THREE.Group();

    // Contoured lathe profile along +Y (0 = pommel knob, 0.86m = barrel tip)
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
    const latheGeo = this.trackGeo(new THREE.LatheGeometry(pts, 22));
    const barrelMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        map: this.batWoodTex,
        color: 0xd9ad74,
        roughness: 0.34,
        metalness: 0.06,
      }),
    );
    const batMesh = new THREE.Mesh(latheGeo, barrelMat);
    batMesh.castShadow = true;
    group.add(batMesh);

    // Matte black athletic grip tape collar
    const gripMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x161618,
        roughness: 0.92,
      }),
    );
    const grip = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.0175, 0.018, 0.22, 14)),
      gripMat,
    );
    grip.position.y = 0.145;
    group.add(grip);

    // Translucent curved swing-arc trail attached to barrel
    const trailGeo = this.trackGeo(
      new THREE.RingGeometry(0.38, 0.86, 18, 1, -Math.PI * 0.15, Math.PI * 0.65),
    );
    const trailMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xff5a36,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const trail = new THREE.Mesh(trailGeo, trailMat);
    trail.position.y = 0.1;
    trail.rotation.y = Math.PI * 0.5;
    group.add(trail);

    return { group, barrelMat, trailMat };
  }

  private buildMarketDecor(): THREE.Group {
    const g = new THREE.Group();
    const fridgeBodyMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x222830, roughness: 0.48, metalness: 0.35 }),
    );
    const glassGlowMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        map: this.coolerTexture,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: this.coolerTexture,
        emissiveIntensity: 0.42,
        roughness: 0.28,
        metalness: 0.08,
      }),
    );
    // 3 illuminated refrigerated beverage coolers along back wall
    for (const cx of [-2.9, 0, 2.9]) {
      const fridge = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(1.48, 2.15, 0.68)),
        fridgeBodyMat,
      );
      fridge.position.set(cx, 1.075, -3.2);
      const glass = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(1.28, 1.82, 0.06)),
        glassGlowMat,
      );
      glass.position.set(cx, 1.12, -2.85);
      g.add(fridge, glass);
    }
    // Side snack shelving aisles
    const shelfMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xd4cec2, roughness: 0.65 }),
    );
    const packColors = [0xe84a32, 0x38b85c, 0xf2bf30, 0x3b86e0];
    for (const sx of [-4.15, 4.15]) {
      const rack = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(0.62, 1.85, 3.8)),
        shelfMat,
      );
      rack.position.set(sx, 0.925, 0.9);
      g.add(rack);
      for (let r = 0; r < 4; r++) {
        const box = new THREE.Mesh(
          this.trackGeo(new THREE.BoxGeometry(0.32, 0.24, 0.58)),
          this.trackMat(
            new THREE.MeshStandardMaterial({
              color: packColors[r % packColors.length],
              roughness: 0.55,
            }),
          ),
        );
        box.position.set(sx + (sx < 0 ? 0.24 : -0.24), 0.55 + r * 0.38, 0.1 + (r - 1.5) * 0.72);
        g.add(box);
      }
    }
    return g;
  }

  private buildClothingDecor(): THREE.Group {
    const g = new THREE.Group();
    const rackColors = [0x1f5c2d, 0x8f2420, 0x1e222b, 0xc99c3c, 0x315880];
    for (const sx of [-3.95, 3.95]) {
      // Chrome clothing pipe rack
      const bar = new THREE.Mesh(
        this.trackGeo(new THREE.CylinderGeometry(0.025, 0.025, 3.4, 10)),
        this.mats.brushedMetal,
      );
      bar.rotation.x = Math.PI * 0.5;
      bar.position.set(sx, 1.55, 1.0);
      g.add(bar);
      for (const pz of [-0.65, 2.65]) {
        const leg = new THREE.Mesh(
          this.trackGeo(new THREE.CylinderGeometry(0.03, 0.03, 1.55, 8)),
          this.mats.brushedMetal,
        );
        leg.position.set(sx, 0.775, pz);
        g.add(leg);
      }
      // Hanging shirts along rail
      for (let i = 0; i < 6; i++) {
        const shirt = new THREE.Mesh(
          this.trackGeo(new THREE.BoxGeometry(0.42, 0.68, 0.18)),
          this.trackMat(
            new THREE.MeshStandardMaterial({
              color: rackColors[i % rackColors.length],
              roughness: 0.88,
            }),
          ),
        );
        shirt.position.set(sx, 1.15, -0.3 + i * 0.52);
        g.add(shirt);
      }
    }
    // Back-wall folded apparel cubbies
    const cubby = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(5.8, 1.7, 0.55)),
      this.trackMat(new THREE.MeshStandardMaterial({ color: 0x382e26, roughness: 0.7 })),
    );
    cubby.position.set(0, 1.1, -3.28);
    g.add(cubby);
    return g;
  }

  private buildFoodDecor(): THREE.Group {
    const g = new THREE.Group();
    const steelMat = this.mats.brushedMetal;
    const menuTex = createSignCanvasTexture('COMBO GIGANTE $9', 'ALITAS · BURGER · SPRUNK', '#ffcf38', '#29150b');
    const menuMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        map: menuTex,
        emissive: new THREE.Color(0xffc940),
        emissiveMap: menuTex,
        emissiveIntensity: 0.7,
        roughness: 0.25,
      }),
    );
    for (const mx of [-2.2, 2.2]) {
      const board = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(2.1, 0.78, 0.1)),
        menuMat,
      );
      board.position.set(mx, 2.45, -3.45);
      g.add(board);
    }
    // Stainless steel fry & grill hood
    const hood = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(4.4, 0.55, 0.9)),
      steelMat,
    );
    hood.position.set(0, 2.15, -3.15);
    const prep = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(4.6, 0.95, 0.75)),
      steelMat,
    );
    prep.position.set(0, 0.475, -3.15);
    g.add(hood, prep);
    return g;
  }

  private buildWeaponsDecor(): THREE.Group {
    const g = new THREE.Group();
    const pegMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x262924, roughness: 0.75, metalness: 0.3 }),
    );
    const crateMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x3c4532, roughness: 0.85 }),
    );
    // Tactical back pegboard with mounted rifle silhouettes
    const peg = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(6.8, 1.8, 0.12)),
      pegMat,
    );
    peg.position.set(0, 1.45, -3.48);
    g.add(peg);

    for (let r = 0; r < 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const body = new THREE.Mesh(
          this.trackGeo(new THREE.BoxGeometry(0.95, 0.11, 0.08)),
          this.mats.darkChrome,
        );
        body.position.set(c * 1.28, 1.15 + r * 0.56, -3.38);
        const grip = new THREE.Mesh(
          this.trackGeo(new THREE.BoxGeometry(0.08, 0.2, 0.06)),
          this.mats.darkChrome,
        );
        grip.position.set(c * 1.28 - 0.18, 1.03 + r * 0.56, -3.38);
        grip.rotation.z = 0.28;
        g.add(body, grip);
      }
    }

    // Military ammo crates stacked along side walls
    for (const sx of [-4.0, 4.0]) {
      for (let i = 0; i < 3; i++) {
        const crate = new THREE.Mesh(
          this.trackGeo(new THREE.BoxGeometry(0.75, 0.48, 1.05)),
          crateMat,
        );
        crate.position.set(sx, 0.24 + (i === 2 ? 0.48 : 0), 0.2 + (i % 2) * 1.25);
        g.add(crate);
      }
    }
    return g;
  }

  private buildCustomsDecor(): THREE.Group {
    const g = new THREE.Group();
    const cabinetMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0xb0221c, roughness: 0.35, metalness: 0.48 }),
    );
    // Rolling red mechanic tool cabinets
    for (const tx of [-2.8, 2.8]) {
      const cab = new THREE.Mesh(
        this.trackGeo(new THREE.BoxGeometry(1.4, 1.25, 0.65)),
        cabinetMat,
      );
      cab.position.set(tx, 0.625, -3.2);
      g.add(cab);
    }
    // Stacked performance rubber tires along walls
    const tireGeo = this.trackGeo(new THREE.TorusGeometry(0.32, 0.13, 10, 18));
    tireGeo.rotateX(Math.PI * 0.5);
    for (const sx of [-4.05, 4.05]) {
      for (let i = 0; i < 4; i++) {
        const tire = new THREE.Mesh(tireGeo, this.mats.carTire);
        tire.position.set(sx, 0.14 + i * 0.25, 1.4);
        g.add(tire);
      }
    }
    return g;
  }

  public activateForSession(
    session: RobberySession,
    playerOutfit: PlayerOutfitId,
    envMap?: THREE.Texture | null,
  ): void {
    if (envMap !== undefined) {
      this.scene.environment = envMap;
    }
    this.root.visible = true;
    this.camInitialized = false;

    const shop = session.shop;
    const profile = session.profile;

    // 1. Theme floor, accent stripe & back-wall brand sign
    this.accentStripeMat.color.set(shop.accentHex);
    const floorPalettes: Record<ShopSpec['category'], [string, string]> = {
      market: ['#dad3c4', '#404843'],
      clothing: ['#dfd7cb', '#bfb3a1'],
      food: ['#e6dcc8', '#b83c2a'],
      weapons: ['#6e7068', '#52554e'],
      customs: ['#5a5d61', '#484b4f'],
    };
    const [cA, cB] = floorPalettes[shop.category];
    this.activeFloorTex?.dispose();
    this.activeFloorTex = createCheckeredFloorTexture(cA, cB);
    const fMat = this.floorMesh.material as THREE.MeshStandardMaterial;
    fMat.map = this.activeFloorTex;
    fMat.needsUpdate = true;

    this.activeSignTex?.dispose();
    this.activeSignTex = createSignCanvasTexture(shop.name, profile.title, shop.accentHex);
    this.backSignMat.map = this.activeSignTex;
    this.backSignMat.emissiveMap = this.activeSignTex;
    this.backSignMat.needsUpdate = true;

    for (const [cat, grp] of Object.entries(this.categoryGroups)) {
      grp.visible = cat === shop.category;
    }

    // 2. Sync CJ outfit palette
    const outfit = getOutfitPalette(playerOutfit);
    this.cjRig.shirtMat.color.setHex(outfit.shirt);
    this.cjRig.pantsMat.color.setHex(outfit.pants);

    // 3. Build or reuse matching Clerk CharacterRig
    if (!this.clerkRig || this.clerkShopId !== shop.id) {
      if (this.clerkRig) {
        if (this.batAttachedToClerk) {
          this.clerkRig.rightForearm.remove(this.batGroup);
          this.root.add(this.batGroup);
          this.batAttachedToClerk = false;
        }
        disposeCharacterRig(this.clerkRig, false);
      }
      this.clerkRig = buildCharacterRig(this.mats, {
        shirtHex: profile.shirtHex,
        pantsHex: profile.pantsHex,
        skinHex: profile.skinHex,
        hatColor: profile.hatColor,
        hasShades: profile.hasShades,
      });
      this.root.add(this.clerkRig.root);
      this.clerkShopId = shop.id;
    }

    // 4. Configure Baseball Bat style (ash wood vs brushed aluminum)
    if (profile.batStyle === 'aluminum') {
      this.batBarrelMat.map = null;
      this.batBarrelMat.color.setHex(0xc9d2db);
      this.batBarrelMat.metalness = 0.85;
      this.batBarrelMat.roughness = 0.22;
    } else {
      this.batBarrelMat.map = this.batWoodTex;
      this.batBarrelMat.color.setHex(0xdcb078);
      this.batBarrelMat.metalness = 0.05;
      this.batBarrelMat.roughness = 0.34;
    }
    this.batBarrelMat.needsUpdate = true;
    this.detachBatFromClerk();
    this.batGroup.visible = false;

    // 5. Reset Duffel Bag, Register & Loose Bills
    this.detachDuffelFromHand();
    this.duffelGroup.visible = false;
    this.registerDrawer.position.z = 0;
    this.setRegisterLedOpen(false);
    for (const s of this.cashStacks) s.visible = false;
    for (const b of this.looseBills) {
      b.active = false;
      b.mesh.visible = false;
    }
    this.clerkTelegraphRing.visible = false;
  }

  public deactivate(): void {
    this.root.visible = false;
    this.clerkTelegraphRing.visible = false;
  }

  private setRegisterLedOpen(open: boolean): void {
    if (this.registerLedOpenState === open) return;
    this.registerLedOpenState = open;
    this.activeLedTex?.dispose();
    this.activeLedTex = createRegisterDisplayTexture(open ? 'ABIERTO' : '$000.00', open);
    this.registerLedMat.map = this.activeLedTex;
    this.registerLedMat.emissiveMap = this.activeLedTex;
    this.registerLedMat.needsUpdate = true;
  }

  private attachBatToClerk(): void {
    if (!this.clerkRig || this.batAttachedToClerk) return;
    this.root.remove(this.batGroup);
    this.clerkRig.rightForearm.add(this.batGroup);
    // Socket at right hand (y = -0.265) pointing forward/upward from grip
    this.batGroup.position.set(0.0, -0.26, 0.04);
    this.batGroup.rotation.set(Math.PI * 0.45, 0, -0.15);
    this.batGroup.visible = true;
    this.batAttachedToClerk = true;
  }

  private detachBatFromClerk(): void {
    if (!this.batAttachedToClerk || !this.clerkRig) return;
    this.clerkRig.rightForearm.remove(this.batGroup);
    this.root.add(this.batGroup);
    this.batAttachedToClerk = false;
  }

  private attachDuffelToCjHand(): void {
    if (this.duffelAttachedToHand) return;
    this.root.remove(this.duffelGroup);
    this.cjRig.leftForearm.add(this.duffelGroup);
    this.duffelGroup.position.set(-0.08, -0.34, 0.05);
    this.duffelGroup.rotation.set(0.15, Math.PI * 0.5, 0.2);
    this.duffelGroup.scale.setScalar(0.86);
    this.duffelGroup.visible = true;
    this.duffelAttachedToHand = true;
  }

  private detachDuffelFromHand(): void {
    if (!this.duffelAttachedToHand) return;
    this.cjRig.leftForearm.remove(this.duffelGroup);
    this.root.add(this.duffelGroup);
    this.duffelGroup.scale.setScalar(1.0);
    this.duffelAttachedToHand = false;
  }

  public spawnBillBurst(count: number, originX = -0.35, originY = 1.24, originZ = -1.06): void {
    let spawned = 0;
    for (let i = 0; i < this.looseBills.length && spawned < count; i++) {
      const slot = this.looseBills[i];
      if (slot.active) continue;
      slot.active = true;
      slot.age = 0;
      slot.life = 1.1 + Math.random() * 0.7;
      slot.x = originX + (Math.random() - 0.5) * 0.25;
      slot.y = originY + Math.random() * 0.14;
      slot.z = originZ + (Math.random() - 0.5) * 0.25;
      slot.vx = (Math.random() - 0.5) * 1.4;
      slot.vy = 1.0 + Math.random() * 1.2;
      slot.vz = (Math.random() - 0.5) * 1.4;
      slot.rx = Math.random() * Math.PI;
      slot.ry = Math.random() * Math.PI;
      slot.rz = Math.random() * Math.PI;
      slot.vrx = (Math.random() - 0.5) * 7.0;
      slot.vry = (Math.random() - 0.5) * 8.0;
      slot.mesh.visible = true;
      spawned++;
    }
  }

  public updateVisuals(session: RobberySession, dt: number, nowSec: number): void {
    if (!this.root.visible || !this.clerkRig) return;

    // 1. Sliding Cash Register Drawer & LED Display
    this.registerDrawer.position.z = -session.drawerOpenRatio * 0.34;
    this.setRegisterLedOpen(session.drawerOpenRatio > 0.2);

    // 2. Tactical Duffel Bag Placement, Hinged Flap & Volume Swell
    const fillRatio = session.stacksCollected / Math.max(1, session.totalStacks);
    if (session.phase === 'exiting' || (session.phase === 'rebel_brawl' && session.registerLooted)) {
      this.attachDuffelToCjHand();
      this.duffelFlapPivot.rotation.x = dampValue(this.duffelFlapPivot.rotation.x, 0, 12, dt);
    } else if (session.bagOnCounter) {
      this.detachDuffelFromHand();
      this.duffelGroup.visible = true;
      this.duffelGroup.position.set(-0.96, 1.05, -1.04);
      this.duffelGroup.rotation.set(0, 0.32, 0);
      const swell = 1 + fillRatio * 0.18;
      this.duffelGroup.scale.set(1 + fillRatio * 0.07, swell, swell);
      this.duffelFlapPivot.rotation.x = dampValue(
        this.duffelFlapPivot.rotation.x,
        -session.bagOpenRatio * 1.85,
        10,
        dt,
      );
      this.duffelInnerCash.visible = session.stacksCollected > 0;
      this.duffelInnerCash.position.y = 0.21 + fillRatio * 0.09;
    } else {
      this.detachDuffelFromHand();
      this.duffelGroup.visible = false;
    }

    // 3. Animate 5x 3D Cash Stacks along Smooth Bézier Curves (Drawer -> Counter -> Open Bag)
    for (let i = 0; i < this.cashStacks.length; i++) {
      const mesh = this.cashStacks[i];
      const st = session.stacks[i];
      if (!st || st.state === 'drawer' || st.state === 'bagged') {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.scale.setScalar(1.65);
      const counterX = -0.18 + ((i % 3) - 1) * 0.14;
      const counterZ = -0.92 + Math.floor(i / 3) * 0.06;

      if (st.state === 'placing') {
        _p0.set(0.36, 1.32, -1.28); // open drawer lip
        _p1.set(0.06, 1.64, -1.04); // high arc in clerk's hand
        _p2.set(counterX, 1.09, counterZ); // landing spot on counter
        evalQuadBezier(_pOut, _p0, _p1, _p2, st.progress);
        mesh.position.copy(_pOut);
        mesh.rotation.set(0, 0.3 + st.progress * 0.5, Math.sin(st.progress * Math.PI) * 0.25);
      } else if (st.state === 'counter') {
        mesh.position.set(counterX, 1.09 + Math.sin(nowSec * 7 + i) * 0.008, counterZ);
        mesh.rotation.set(0, 0.65 + i * 0.18, 0);
      } else if (st.state === 'bagging') {
        _p0.set(counterX, 1.09, counterZ);
        _p1.set(-0.56, 1.62, -0.92); // swept up in CJ's hand
        _p2.set(-0.96, 1.24, -1.04); // straight into open duffel mouth
        evalQuadBezier(_pOut, _p0, _p1, _p2, st.progress);
        mesh.position.copy(_pOut);
        mesh.rotation.set(st.progress * 1.1, 0.4 + st.progress * 1.6, 0.2);
      }
    }

    // 4. Update Pooled Fluttering Loose Dollar Bills
    for (let i = 0; i < this.looseBills.length; i++) {
      const b = this.looseBills[i];
      if (!b.active) continue;
      b.age += dt;
      if (b.age >= b.life) {
        b.active = false;
        b.mesh.visible = false;
        continue;
      }
      b.vy -= 2.4 * dt; // slow flutter gravity
      b.vx *= Math.exp(-1.8 * dt);
      b.vz *= Math.exp(-1.8 * dt);
      b.x += b.vx * dt + Math.sin(nowSec * 9 + i) * 0.22 * dt;
      b.y = Math.max(0.03, b.y + b.vy * dt);
      b.z += b.vz * dt;
      b.rx += b.vrx * dt;
      b.ry += b.vry * dt;
      b.mesh.position.set(b.x, b.y, b.z);
      b.mesh.rotation.set(b.rx, b.ry, b.rz);
    }

    // 5. Baseball Bat Attachment / Floor Drop + Swing Arc Trail
    if (session.clerkHasBat && session.clerkHealth > 0) {
      this.attachBatToClerk();
      const swinging =
        session.clerkAction === 'swing' ||
        (session.phase === 'rebel_qte_dodge' && session.qteElapsed > session.qteWindow * 0.55);
      this.batSwingTrailMat.opacity = dampValue(
        this.batSwingTrailMat.opacity,
        swinging ? 0.68 : 0.0,
        18,
        dt,
      );
    } else if (session.clerkBatDropped) {
      this.detachBatFromClerk();
      this.batGroup.visible = true;
      this.batGroup.position.set(session.clerkBatDropX, 0.045, session.clerkBatDropZ);
      this.batGroup.rotation.set(Math.PI * 0.5, 0.65, 0.2);
      this.batSwingTrailMat.opacity = 0;
    } else {
      this.detachBatFromClerk();
      this.batGroup.visible = false;
    }

    // 6. Animate CJ Character Rig Poses
    this.animateCjRig(session, dt, nowSec);

    // 7. Animate Shop Owner Rig Poses & Brawl Telegraph Ring
    this.animateClerkRig(session, dt, nowSec);

    // Subtle pulse on green EXIT floor mat during brawl
    this.exitMatGlow.emissiveIntensity =
      session.phase === 'rebel_brawl'
        ? 0.55 + Math.sin(nowSec * 5.5) * 0.3
        : 0.25;
  }

  private animateCjRig(s: RobberySession, dt: number, nowSec: number): void {
    const r = this.cjRig;
    r.root.position.set(s.cjX, 0, s.cjZ);
    r.root.rotation.y = s.cjHeading;

    const breathe = Math.sin(nowSec * 3.1) * 0.025;
    let torsoPitch = breathe;
    let torsoYaw = 0;
    let torsoY = 0.99;
    let lArmX = 0.1;
    let lArmZ = 0.08;
    let lForeX = -0.25;
    let rArmX = 0.1;
    let rArmZ = -0.08;
    let rForeX = -0.25;
    let legSwing = 0;

    if (s.cjGesture === 'walk' || s.cjGesture === 'sprint_exit') {
      const amp = s.cjGesture === 'sprint_exit' ? 0.78 : 0.52;
      legSwing = Math.sin(s.cjWalkCycle) * amp;
      torsoPitch = s.cjGesture === 'sprint_exit' ? 0.16 : 0.06;
      lArmX = -legSwing * 0.7;
      rArmX = legSwing * 0.7;
      lForeX = -0.45;
      rForeX = -0.45;
    } else if (s.cjGesture === 'point' || s.phase === 'intimidate') {
      // Iconic GTA V stickup stance: assertive lean, right arm raised pointing at clerk
      torsoPitch = 0.12;
      torsoYaw = -0.22;
      rArmX = -1.38 + Math.sin(nowSec * 6.5) * 0.08;
      rArmZ = -0.14;
      rForeX = -0.22;
      lArmX = -0.62;
      lArmZ = 0.26;
      lForeX = -0.65;
    } else if (s.cjGesture === 'slam') {
      // Aggressive counter slam / intimidation burst
      const slamWave = Math.sin((s.cjGestureTimer / 0.45) * Math.PI);
      torsoPitch = 0.28 * slamWave + 0.08;
      rArmX = -1.1 - slamWave * 0.45;
      lArmX = -1.05 - slamWave * 0.35;
      rForeX = -0.45;
      lForeX = -0.45;
    } else if (s.cjGesture === 'bag_sweep' || s.phase === 'comply_bag') {
      const sweep = s.cjGestureTimer > 0 ? Math.sin((s.cjGestureTimer / 0.42) * Math.PI) : 0;
      torsoPitch = 0.14 + sweep * 0.1;
      torsoYaw = -0.25 + sweep * 0.58;
      rArmX = -1.08;
      rArmZ = -0.2 + sweep * 0.65;
      rForeX = -0.58;
      // Left hand holds duffel mouth open
      lArmX = -0.92;
      lArmZ = 0.25;
      lForeX = -0.55;
    } else if (s.cjGesture === 'duck_dodge') {
      // Deep boxing slip/duck under incoming baseball bat!
      torsoY = 0.74;
      torsoPitch = 0.52;
      torsoYaw = -0.35;
      lArmX = -1.2;
      lForeX = -1.35;
      rArmX = -1.2;
      rForeX = -1.35;
    } else if (s.cjGesture === 'counter_hook' || s.cjGesture === 'punch_r') {
      torsoPitch = 0.16;
      torsoYaw = 0.55;
      rArmX = -1.52;
      rArmZ = 0.28;
      rForeX = -0.32;
      lArmX = -1.1;
      lForeX = -1.25;
    } else if (s.cjGesture === 'punch_l') {
      torsoPitch = 0.14;
      torsoYaw = -0.48;
      lArmX = -1.5;
      lArmZ = -0.22;
      lForeX = -0.35;
      rArmX = -1.1;
      rForeX = -1.25;
    } else if (s.cjGesture === 'hurt') {
      torsoPitch = -0.28;
      torsoYaw = 0.25;
      lArmX = -0.6;
      rArmX = -0.7;
    } else if (s.phase === 'rebel_brawl' || s.phase === 'rebel_qte_dodge' || s.phase === 'rebel_qte_counter') {
      // Tight boxer guard ready for melee combat
      torsoPitch = 0.1;
      torsoYaw = -0.18;
      lArmX = -1.15;
      lArmZ = 0.2;
      lForeX = -1.25;
      rArmX = -1.22;
      rArmZ = -0.16;
      rForeX = -1.32;
    }

    const lam = 15;
    r.torso.position.y = dampValue(r.torso.position.y, torsoY, lam, dt);
    r.torso.rotation.x = dampValue(r.torso.rotation.x, torsoPitch, lam, dt);
    r.torso.rotation.y = dampValue(r.torso.rotation.y, torsoYaw, lam, dt);
    r.leftArm.rotation.x = dampValue(r.leftArm.rotation.x, lArmX, lam, dt);
    r.leftArm.rotation.z = dampValue(r.leftArm.rotation.z, lArmZ, lam, dt);
    r.leftForearm.rotation.x = dampValue(r.leftForearm.rotation.x, lForeX, lam, dt);
    r.rightArm.rotation.x = dampValue(r.rightArm.rotation.x, rArmX, lam, dt);
    r.rightArm.rotation.z = dampValue(r.rightArm.rotation.z, rArmZ, lam, dt);
    r.rightForearm.rotation.x = dampValue(r.rightForearm.rotation.x, rForeX, lam, dt);
    r.leftLeg.rotation.x = dampValue(r.leftLeg.rotation.x, legSwing, lam, dt);
    r.rightLeg.rotation.x = dampValue(r.rightLeg.rotation.x, -legSwing, lam, dt);
    r.leftShin.rotation.x = dampValue(r.leftShin.rotation.x, Math.max(0, -legSwing * 0.7), lam, dt);
    r.rightShin.rotation.x = dampValue(r.rightShin.rotation.x, Math.max(0, legSwing * 0.7), lam, dt);
  }

  private animateClerkRig(s: RobberySession, dt: number, nowSec: number): void {
    const r = this.clerkRig;
    if (!r) return;

    r.root.position.set(s.clerkX, 0, s.clerkZ);
    r.root.rotation.y = s.clerkHeading;

    // Knocked out collapse onto floor
    if (s.clerkAction === 'ko' || s.clerkHealth <= 0) {
      const k = s.clerkKoFallProgress;
      r.root.rotation.x = dampValue(r.root.rotation.x, -Math.PI * 0.48 * k, 10, dt);
      r.root.position.y = dampValue(r.root.position.y, 0.14 * k, 10, dt);
      r.leftArm.rotation.z = dampValue(r.leftArm.rotation.z, 0.75, 10, dt);
      r.rightArm.rotation.z = dampValue(r.rightArm.rotation.z, -0.82, 10, dt);
      this.clerkTelegraphRing.visible = false;
      return;
    }

    r.root.rotation.x = dampValue(r.root.rotation.x, 0, 12, dt);
    r.root.position.y = 0;

    const tremble = Math.sin(nowSec * 22) * 0.04;
    let torsoPitch = 0;
    let torsoYaw = 0;
    let lArmX = 0;
    let lArmZ = 0.12;
    let lForeX = -0.3;
    let rArmX = 0;
    let rArmZ = -0.12;
    let rForeX = -0.3;
    let legSwing = 0;

    if (s.phase === 'entering' || s.phase === 'intimidate' || s.phase === 'branch_reveal') {
      // Surrendered trembling hands-up posture (arms spread wide so clerk's face is 100% visible!)
      const scaredAmp = s.rage > 65 ? 0.62 : 1.0;
      lArmX = -2.42 * scaredAmp + tremble;
      lArmZ = -0.48;
      lForeX = -0.32;
      rArmX = -2.38 * scaredAmp - tremble;
      rArmZ = 0.48;
      rForeX = -0.32;
      torsoPitch = -0.04;
    } else if (s.phase === 'comply_open') {
      // Leaning over cash register punching keys quickly
      torsoPitch = 0.22;
      torsoYaw = -0.25;
      rArmX = -1.15 + Math.sin(nowSec * 24) * 0.18;
      rForeX = -0.7;
      lArmX = -1.1 + Math.cos(nowSec * 20) * 0.14;
      lForeX = -0.65;
    } else if (s.phase === 'comply_bag') {
      // Pulling stacks out of open drawer & setting them onto counter
      const active = s.stacks[s.activeStackIndex];
      const placeP = active && active.state === 'placing' ? active.progress : 0;
      torsoPitch = 0.18;
      torsoYaw = -0.25 + placeP * 0.52;
      rArmX = -1.05 - Math.sin(placeP * Math.PI) * 0.35;
      rArmZ = -0.15 + placeP * 0.3;
      rForeX = -0.55;
      lArmX = -1.55 + tremble;
      lArmZ = 0.25;
      lForeX = -0.5;
    } else if (s.phase === 'rebel_draw') {
      // Crouching behind counter to draw bat, then raising it menacingly while stepping around!
      legSwing = Math.sin(s.clerkWalkCycle) * 0.55;
      torsoPitch = s.phaseTime < 0.38 ? 0.45 : 0.12;
      rArmX = s.phaseTime < 0.38 ? -0.35 : -2.15;
      rArmZ = -0.35;
      rForeX = -0.65;
      lArmX = -0.9;
    } else if (s.clerkAction === 'windup') {
      // Clear high batter windup telegraph!
      torsoPitch = 0.08;
      torsoYaw = -0.75;
      rArmX = -2.35;
      rArmZ = -0.52;
      rForeX = -0.82;
      lArmX = -1.55;
      lArmZ = 0.4;
      lForeX = -0.9;
    } else if (s.clerkAction === 'swing') {
      // Full high-velocity horizontal baseball bat follow-through!
      torsoPitch = 0.22;
      torsoYaw = 0.92;
      rArmX = -1.35;
      rArmZ = 0.65;
      rForeX = -0.25;
      lArmX = -1.1;
      lArmZ = 0.45;
      lForeX = -0.45;
    } else if (s.clerkAction === 'stagger') {
      // Recoiling backwards from CJ's punch
      torsoPitch = -0.34;
      torsoYaw = 0.32;
      lArmX = -0.5;
      lArmZ = 0.5;
      rArmX = -0.8;
      rArmZ = -0.55;
    } else if (s.clerkAction === 'chase' || s.clerkAction === 'recover') {
      legSwing = s.clerkAction === 'chase' ? Math.sin(s.clerkWalkCycle) * 0.58 : 0;
      torsoPitch = 0.12;
      rArmX = -1.52;
      rArmZ = -0.28;
      rForeX = -0.75;
      lArmX = -0.85;
      lForeX = -0.85;
    }

    const lam = 16;
    r.torso.rotation.x = dampValue(r.torso.rotation.x, torsoPitch, lam, dt);
    r.torso.rotation.y = dampValue(r.torso.rotation.y, torsoYaw, lam, dt);
    r.leftArm.rotation.x = dampValue(r.leftArm.rotation.x, lArmX, lam, dt);
    r.leftArm.rotation.z = dampValue(r.leftArm.rotation.z, lArmZ, lam, dt);
    r.leftForearm.rotation.x = dampValue(r.leftForearm.rotation.x, lForeX, lam, dt);
    r.rightArm.rotation.x = dampValue(r.rightArm.rotation.x, rArmX, lam, dt);
    r.rightArm.rotation.z = dampValue(r.rightArm.rotation.z, rArmZ, lam, dt);
    r.rightForearm.rotation.x = dampValue(r.rightForearm.rotation.x, rForeX, lam, dt);
    r.leftLeg.rotation.x = dampValue(r.leftLeg.rotation.x, legSwing, lam, dt);
    r.rightLeg.rotation.x = dampValue(r.rightLeg.rotation.x, -legSwing, lam, dt);

    // Pulse crimson combat telegraph ring under clerk during bat windup/swing
    const showTelegraph =
      s.phase === 'rebel_qte_dodge' ||
      (s.phase === 'rebel_brawl' && (s.clerkAction === 'windup' || s.clerkAction === 'swing'));
    this.clerkTelegraphRing.visible = showTelegraph;
    if (showTelegraph) {
      this.clerkTelegraphRing.position.set(s.clerkX, 0.04, s.clerkZ);
      const pulse = 1.0 + Math.sin(nowSec * 18) * 0.14;
      this.clerkTelegraphRing.scale.set(pulse, pulse, 1);
    }
  }

  public updateCamera(
    camera: THREE.PerspectiveCamera,
    session: RobberySession,
    dt: number,
    nowSec: number,
    trauma: number,
  ): void {
    const ox = INTERIOR_ORIGIN.x;
    const oy = INTERIOR_ORIGIN.y;
    const oz = INTERIOR_ORIGIN.z;

    let targetFov = 54;
    let posLambda = 6.5;
    let lookLambda = 8.0;

    if (session.phase === 'entering') {
      _camGoal.set(ox + 1.15, oy + 1.62, oz + session.cjZ + 1.1);
      _lookGoal.set(ox + 0.1, oy + 1.4, oz - 1.7);
      targetFov = 56;
    } else if (session.phase === 'intimidate' || session.phase === 'branch_reveal') {
      // Classic GTA V over-the-shoulder standoff framing CJ on left, Clerk + Register on right
      const sway = Math.sin(nowSec * 1.1) * 0.12;
      _camGoal.set(ox - 1.48 + sway, oy + 1.66, oz + 1.55);
      _lookGoal.set(ox + 0.28, oy + 1.38, oz - 1.55);
      targetFov = 50;
    } else if (session.phase === 'comply_open' || session.phase === 'comply_bag') {
      // Crisp 3/4 counter hero angle showing Open Duffel Bag (left) + $100 Cash Stack (center) + Open Register (right)!
      _camGoal.set(ox - 1.58, oy + 2.1, oz + 0.52);
      _lookGoal.set(ox - 0.06, oy + 1.14, oz - 1.08);
      targetFov = 46;
      posLambda = 5.5;
    } else if (session.phase === 'rebel_draw') {
      // Dramatic snap push-in on clerk grabbing the baseball bat and rounding the counter
      _camGoal.set(ox - 0.85, oy + 1.65, oz + 1.65);
      _lookGoal.set(ox + session.clerkX, oy + 1.32, oz + session.clerkZ);
      targetFov = 48;
      posLambda = 7.5;
    } else if (session.phase === 'rebel_qte_dodge' || session.phase === 'rebel_qte_counter') {
      // Tight dynamic action angle framing CJ & bat swing clash
      _camGoal.set(ox - 1.65, oy + 1.58, oz + 1.85);
      _lookGoal.set(
        ox + (session.cjX + session.clerkX) * 0.5,
        oy + 1.28,
        oz + (session.cjZ + session.clerkZ) * 0.5,
      );
      targetFov = 52;
      posLambda = 9.0;
    } else if (session.phase === 'rebel_brawl') {
      // Clear elevated interior combat camera clamped strictly inside room walls
      const midX = (session.cjX * 0.65 + session.clerkX * 0.35);
      const midZ = (session.cjZ * 0.65 + session.clerkZ * 0.35);
      const camX = Math.max(-3.65, Math.min(3.65, session.cjX * 0.55 - 1.25));
      const camZ = Math.max(-2.6, Math.min(3.75, session.cjZ + 2.65));
      _camGoal.set(ox + camX, oy + 2.55, oz + camZ);
      _lookGoal.set(ox + midX, oy + 1.18, oz + Math.min(2.6, midZ - 0.35));
      targetFov = 58;
      posLambda = 6.2;
    } else {
      // Exiting hero tracking shot toward illuminated SALIDA doorway
      _camGoal.set(ox + 1.55, oy + 1.65, oz + 1.4);
      _lookGoal.set(ox + session.cjX, oy + 1.25, oz + session.cjZ + 0.5);
      targetFov = 56;
    }

    if (!this.camInitialized) {
      camera.position.copy(_camGoal);
      this.camLookCurrent.copy(_lookGoal);
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
      this.camInitialized = true;
    } else {
      camera.position.lerp(_camGoal, 1 - Math.exp(-posLambda * dt));
      this.camLookCurrent.lerp(_lookGoal, 1 - Math.exp(-lookLambda * dt));
      const nextFov = dampValue(camera.fov, targetFov, 6.0, dt);
      if (Math.abs(nextFov - camera.fov) > 0.005) {
        camera.fov = nextFov;
        camera.updateProjectionMatrix();
      }
    }

    camera.lookAt(this.camLookCurrent);

    if (trauma > 0) {
      const shake = trauma * trauma;
      camera.rotation.z += Math.sin(nowSec * 54) * shake * 0.055;
      camera.rotation.x += Math.cos(nowSec * 41) * shake * 0.038;
    }
  }

  public dispose(): void {
    this.detachBatFromClerk();
    disposeCharacterRig(this.cjRig, true);
    if (this.clerkRig) {
      disposeCharacterRig(this.clerkRig, false);
      this.clerkRig = null;
    }
    this.scene.remove(this.root);
    this.activeFloorTex?.dispose();
    this.activeSignTex?.dispose();
    this.activeLedTex?.dispose();
    this.exitSignTex.dispose();
    this.billTexture.dispose();
    this.coolerTexture.dispose();
    this.batWoodTex.dispose();
    for (const g of this.ownedGeometries) g.dispose();
    for (const m of this.ownedMaterials) m.dispose();
  }
}
