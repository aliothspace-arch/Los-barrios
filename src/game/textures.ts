import * as THREE from 'three';
import {
  applyArchitecturalPBRShader,
  applyFoliageBacklightShader,
  applyHyperrealWetSurfaceShader,
  applyInteriorMappingShader,
  createWeatherUniforms,
  type InteriorWindowKind,
  type SharedWeatherUniforms,
} from './rendering/materials/shaderPatches';
import {
  createNormalFromHeight,
  finalizeTexture,
  mulberry32,
  type PBRTextureSet,
} from './rendering/materials/textureGen';

export {
  applyArchitecturalPBRShader,
  applyFoliageBacklightShader,
  applyHyperrealWetSurfaceShader,
  applyInteriorMappingShader,
  createWeatherUniforms,
  type InteriorWindowKind,
  type PBRTextureSet,
  type SharedWeatherUniforms,
};

export class HyperrealMaterialLibrary {
  public readonly anisotropy: number;
  public readonly res: number;
  public readonly uniforms: SharedWeatherUniforms;

  public readonly roadNS: THREE.MeshPhysicalMaterial;
  public readonly roadEW: THREE.MeshPhysicalMaterial;
  public readonly culDeSacAsphalt: THREE.MeshPhysicalMaterial;
  public readonly sidewalk: THREE.MeshPhysicalMaterial;
  public readonly terrain: THREE.MeshStandardMaterial;
  public readonly ocean: THREE.MeshPhysicalMaterial;
  public readonly palmBark: THREE.MeshStandardMaterial;
  public readonly palmFrond: THREE.MeshStandardMaterial;
  public readonly palmDeadFrond: THREE.MeshStandardMaterial;
  public readonly palmDateMat: THREE.MeshStandardMaterial;
  public readonly palmSoilMat: THREE.MeshStandardMaterial;
  public readonly contactShadowMap: THREE.CanvasTexture;

  public readonly stuccoPalettes: THREE.MeshStandardMaterial[];
  public readonly clapboardPalettes: THREE.MeshStandardMaterial[];
  public readonly roofTile: THREE.MeshStandardMaterial;
  public readonly terracottaTile: THREE.MeshStandardMaterial;
  public readonly woodPorch: THREE.MeshStandardMaterial;
  public readonly trimPaintWhite: THREE.MeshStandardMaterial;
  public readonly stoneMasonry: THREE.MeshStandardMaterial;
  public readonly corrugatedMetal: THREE.MeshStandardMaterial;
  public readonly commercialWalls: THREE.MeshStandardMaterial[];
  public readonly skyscraperFacades: THREE.MeshPhysicalMaterial[];
  public readonly mazeBankMarble: THREE.MeshPhysicalMaterial;
  public readonly mazeBankGlass: THREE.MeshPhysicalMaterial;
  public readonly brushedMetal: THREE.MeshPhysicalMaterial;
  public readonly darkChrome: THREE.MeshPhysicalMaterial;
  public readonly brassTrim: THREE.MeshPhysicalMaterial;
  public readonly carbonFiber: THREE.MeshPhysicalMaterial;
  public readonly awningFabric: THREE.MeshStandardMaterial;
  public readonly awningPalettes: THREE.MeshStandardMaterial[];
  public readonly warmLampGlow: THREE.MeshStandardMaterial;
  public readonly helipadMat: THREE.MeshStandardMaterial;
  public readonly licensePlateMat: THREE.MeshStandardMaterial;
  public readonly crosswalkMat: THREE.MeshStandardMaterial;
  public readonly carTire: THREE.MeshStandardMaterial;
  public readonly carGlass: THREE.MeshPhysicalMaterial;
  public readonly streetlampGlow: THREE.MeshStandardMaterial;
  public readonly fabricNormalMap: THREE.CanvasTexture;
  public readonly carFlakeNormalMap: THREE.CanvasTexture;
  public readonly shadeBark: THREE.MeshStandardMaterial;
  public readonly shadeLeafGreen: THREE.MeshStandardMaterial;
  public readonly shadeLeafJacaranda: THREE.MeshStandardMaterial;

  // Pillar 1: Real 3D Interior-Mapped Fresnel Windows
  public readonly interiorWindowStore: THREE.MeshPhysicalMaterial;
  public readonly interiorWindowOffice: THREE.MeshPhysicalMaterial;
  public readonly interiorWindowResidential: THREE.MeshPhysicalMaterial;

  // Pillar 2 & 3: Curbs, Storm Drains & Hero Gas Station Textures
  public readonly curbConcrete: THREE.MeshStandardMaterial;
  public readonly curbRedPaint: THREE.MeshStandardMaterial;
  public readonly stormDrainMat: THREE.MeshStandardMaterial;
  public readonly gasForecourtMat: THREE.MeshPhysicalMaterial;
  public readonly gasFasciaMat: THREE.MeshStandardMaterial;
  public readonly gasPylonMat: THREE.MeshStandardMaterial;
  public readonly gasPumpScreenMat: THREE.MeshStandardMaterial;
  public readonly storePosterMat: THREE.MeshStandardMaterial;

  // Character PBR textures live inside characterModels.ts (single source of truth)

  // Pillar 6: Street Furniture Ads, Signage & Weathered Urban Props
  public readonly busAdMat: THREE.MeshStandardMaterial;
  public readonly stopSignMat: THREE.MeshStandardMaterial;
  public readonly weatheredHydrantMat: THREE.MeshStandardMaterial;
  public readonly weatheredNewsBoxMat: THREE.MeshStandardMaterial;
  public readonly manholeMat: THREE.MeshStandardMaterial;
  public readonly shrubMat: THREE.MeshStandardMaterial;
  public readonly cafeUmbrellaMat: THREE.MeshStandardMaterial;

  private readonly disposables: Array<{ dispose: () => void }> = [];

  constructor(
    renderer: THREE.WebGLRenderer,
    isSoftwareGl: boolean,
    uniforms: SharedWeatherUniforms,
  ) {
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    // High-res procedural PBR maps (1024px on GPU for fast boot + crisp micro-detail GLSL, 512px on SwiftShader)
    this.res = isSoftwareGl ? 512 : 1024;
    this.uniforms = uniforms;

    // 1. Weathered California Asphalt (matte mineral aggregate when dry; dynamic mirror puddles when wet!)
    const asphaltNS = this.createAsphaltSet(true);
    this.roadNS = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: asphaltNS.map,
      normalMap: asphaltNS.normalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughnessMap: asphaltNS.roughnessMap,
      roughness: 0.94,
      metalness: 0.02,
      clearcoat: 0.0,
      clearcoatRoughness: 0.08,
    });
    applyHyperrealWetSurfaceShader(this.roadNS, uniforms, {
      puddleStrength: 1.0,
      microDetailScale: 18.0,
    });

    const asphaltEW = this.createAsphaltSet(true);
    asphaltEW.map.rotation = Math.PI * 0.5;
    asphaltEW.normalMap.rotation = Math.PI * 0.5;
    asphaltEW.roughnessMap.rotation = Math.PI * 0.5;
    this.roadEW = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: asphaltEW.map,
      normalMap: asphaltEW.normalMap,
      normalScale: new THREE.Vector2(0.45, 0.45),
      roughnessMap: asphaltEW.roughnessMap,
      roughness: 0.94,
      metalness: 0.02,
      clearcoat: 0.0,
      clearcoatRoughness: 0.08,
    });
    applyHyperrealWetSurfaceShader(this.roadEW, uniforms, {
      puddleStrength: 1.0,
      microDetailScale: 18.0,
    });

    const asphaltPlain = this.createAsphaltSet(false);
    asphaltPlain.map.repeat.set(3, 3);
    asphaltPlain.normalMap.repeat.set(3, 3);
    asphaltPlain.roughnessMap.repeat.set(3, 3);
    this.culDeSacAsphalt = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: asphaltPlain.map,
      normalMap: asphaltPlain.normalMap,
      normalScale: new THREE.Vector2(0.42, 0.42),
      roughnessMap: asphaltPlain.roughnessMap,
      roughness: 0.95,
      metalness: 0.02,
      clearcoat: 0.0,
      clearcoatRoughness: 0.08,
    });
    applyHyperrealWetSurfaceShader(this.culDeSacAsphalt, uniforms, {
      puddleStrength: 1.0,
      microDetailScale: 18.0,
    });

    // 2. California Concrete Sidewalk with expansion joints & oil weathering
    const sidewalkSet = this.createConcreteSidewalkSet();
    this.sidewalk = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: sidewalkSet.map,
      normalMap: sidewalkSet.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: sidewalkSet.roughnessMap,
      roughness: 0.92,
      metalness: 0.01,
      clearcoat: 0.0,
      clearcoatRoughness: 0.18,
    });
    applyHyperrealWetSurfaceShader(this.sidewalk, uniforms, {
      puddleStrength: 0.65,
      microDetailScale: 12.0,
    });

    // 3. Dry Southern California Grass & Earth Terrain
    const terrainSet = this.createCaliforniaGroundSet();
    this.terrain = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: terrainSet.map,
      normalMap: terrainSet.normalMap,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughnessMap: terrainSet.roughnessMap,
      roughness: 0.96,
      metalness: 0.0,
    });
    applyHyperrealWetSurfaceShader(this.terrain, uniforms, {
      puddleStrength: 0.3,
      microDetailScale: 8.0,
    });

    // 4. Pacific Ocean Coastal Water
    this.ocean = new THREE.MeshPhysicalMaterial({
      color: 0x11364b,
      roughness: 0.14,
      metalness: 0.12,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      ior: 1.333,
      reflectivity: 0.9,
    });

    // 5. Grove Street & Residential Stucco + Painted Craftsman Clapboard Palettes
    const stuccoColors = ['#d8c5a8', '#9eb094', '#c99b6d', '#ccb098', '#b89680'];
    this.stuccoPalettes = stuccoColors.map((hex, i) => {
      const set = this.createStuccoSet(hex, 100 + i * 37);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: set.map,
        normalMap: set.normalMap,
        normalScale: new THREE.Vector2(1.05, 1.05),
        roughnessMap: set.roughnessMap,
        roughness: 0.88,
        metalness: 0.02,
      });
      applyArchitecturalPBRShader(mat, uniforms, { aoHeight: 2.2, microScale: 5.0 });
      return mat;
    });

    const clapboardColors = ['#d5cbb6', '#8ca086', '#7b8e9a', '#caa974'];
    this.clapboardPalettes = clapboardColors.map((hex, i) => {
      const set = this.createClapboardSidingSet(hex, 210 + i * 41);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: set.map,
        normalMap: set.normalMap,
        normalScale: new THREE.Vector2(1.45, 1.45),
        roughnessMap: set.roughnessMap,
        roughness: 0.82,
        metalness: 0.02,
      });
      applyArchitecturalPBRShader(mat, uniforms, { aoHeight: 2.2, microScale: 4.5 });
      return mat;
    });

    // 6. Roof Shingles, Spanish Terracotta Barrel Tiles, Porch Wood, Architectural Trim, Stone & Corrugated Steel
    const roofSet = this.createRoofShingleSet();
    this.roofTile = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: roofSet.map,
      normalMap: roofSet.normalMap,
      normalScale: new THREE.Vector2(1.4, 1.4),
      roughnessMap: roofSet.roughnessMap,
      roughness: 0.84,
      metalness: 0.04,
    });

    const terracottaSet = this.createTerracottaBarrelTileSet();
    this.terracottaTile = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: terracottaSet.map,
      normalMap: terracottaSet.normalMap,
      normalScale: new THREE.Vector2(1.85, 1.85),
      roughnessMap: terracottaSet.roughnessMap,
      roughness: 0.78,
      metalness: 0.04,
    });

    const woodSet = this.createWeatheredWoodSet();
    this.woodPorch = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: woodSet.map,
      normalMap: woodSet.normalMap,
      normalScale: new THREE.Vector2(1.0, 1.0),
      roughnessMap: woodSet.roughnessMap,
      roughness: 0.78,
      metalness: 0.02,
    });

    this.trimPaintWhite = new THREE.MeshStandardMaterial({
      color: 0xded8ca,
      normalMap: woodSet.normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughness: 0.68,
      metalness: 0.03,
      envMapIntensity: 0.35,
    });

    const stoneSet = this.createStoneMasonrySet();
    this.stoneMasonry = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: stoneSet.map,
      normalMap: stoneSet.normalMap,
      normalScale: new THREE.Vector2(1.6, 1.6),
      roughnessMap: stoneSet.roughnessMap,
      roughness: 0.9,
      metalness: 0.02,
    });
    applyArchitecturalPBRShader(this.stoneMasonry, uniforms, { aoHeight: 2.0, microScale: 5.5 });

    const corrSet = this.createCorrugatedMetalSet();
    this.corrugatedMetal = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: corrSet.map,
      normalMap: corrSet.normalMap,
      normalScale: new THREE.Vector2(1.9, 1.9),
      roughnessMap: corrSet.roughnessMap,
      roughness: 0.56,
      metalness: 0.66,
      envMapIntensity: 0.72,
    });
    applyArchitecturalPBRShader(this.corrugatedMetal, uniforms, { aoHeight: 2.4, microScale: 4.0 });

    // 7. Commercial, Motel & Mid-Rise Pure Architectural Masonry & Wall Cladding (6 Distinct Authentic Materials — ZERO fake painted windows!)
    const commPalettes: Array<{ base: string; trim: string; kind: 'brick' | 'concrete' | 'ashlar' | 'loft' | 'coastal' | 'terracotta' }> = [
      { base: '#8e4c3a', trim: '#c9bba4', kind: 'brick' },       // 0: Heritage Los Santos Red Brick
      { base: '#8a857b', trim: '#c2bab0', kind: 'concrete' },    // 1: Mid-Century Board-Formed Concrete
      { base: '#bf996d', trim: '#e2d4be', kind: 'ashlar' },      // 2: California Sandstone Ashlar Blocks
      { base: '#555d66', trim: '#929ba6', kind: 'loft' },        // 3: Industrial Gunmetal Loft Brick
      { base: '#799589', trim: '#d5d3c8', kind: 'coastal' },     // 4: Retro Coastal Mint Fluted Plaster
      { base: '#a97355', trim: '#d9c6ae', kind: 'terracotta' },  // 5: Terracotta Mediterranean Masonry
    ];
    this.commercialWalls = commPalettes.map((p, idx) => {
      const set = this.createBrickFacadeSet(p.base, p.trim, 400 + idx * 53, p.kind);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: set.map,
        normalMap: set.normalMap,
        normalScale: new THREE.Vector2(1.35, 1.35),
        roughnessMap: set.roughnessMap,
        roughness: p.kind === 'concrete' || p.kind === 'ashlar' ? 0.86 : 0.88,
        metalness: p.kind === 'loft' ? 0.08 : 0.03,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0.0,
      });
      applyArchitecturalPBRShader(mat, uniforms, { aoHeight: 2.8, microScale: 4.2 });
      return mat;
    });

    // 8. Downtown Los Santos Reflective Curtain-Wall Skyscraper Facades (5 Distinct High-Rise Systems)
    const skyPalettes = [
      { glass: '#1a3248', mullion: '#88929b', style: 0 }, // 0: Pacific Cobalt Steel-Glass Diagrid
      { glass: '#203634', mullion: '#b4a58c', style: 1 }, // 1: Emerald & Limestone Executive
      { glass: '#262d3c', mullion: '#5a606a', style: 2 }, // 2: Smoked Charcoal Brutalist
      { glass: '#332922', mullion: '#c2a67a', style: 3 }, // 3: Champagne Bronze Art-Deco
      { glass: '#18303e', mullion: '#a6b1bc', style: 4 }, // 4: Silver Mirror Curtain-Wall
    ];
    this.skyscraperFacades = skyPalettes.map((p, idx) => {
      const set = this.createSkyscraperSet(p.glass, p.mullion, 700 + idx * 91, p.style);
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: set.map,
        normalMap: set.normalMap,
        normalScale: new THREE.Vector2(1.05, 1.05),
        roughnessMap: set.roughnessMap,
        roughness: 0.28,
        metalness: 0.72,
        clearcoat: 0.92,
        clearcoatRoughness: 0.09,
        emissive: new THREE.Color(0xffdfa4),
        emissiveMap: set.emissiveMap,
        emissiveIntensity: 0.65,
      });
      applyArchitecturalPBRShader(mat, uniforms, { aoHeight: 3.5, microScale: 2.5 });
      return mat;
    });

    // Maze Bank Travertine Stone + Deep Reflective Glass
    const marbleSet = this.createStuccoSet('#ccc4b8', 999);
    this.mazeBankMarble = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: marbleSet.map,
      normalMap: marbleSet.normalMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughnessMap: marbleSet.roughnessMap,
      roughness: 0.52,
      metalness: 0.08,
      clearcoat: 0.28,
    });
    applyArchitecturalPBRShader(this.mazeBankMarble, uniforms, { aoHeight: 3.2, microScale: 3.5 });

    const mazeGlassSet = this.createSkyscraperSet('#162a3e', '#bdb4a8', 1111, 0);
    this.mazeBankGlass = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: mazeGlassSet.map,
      normalMap: mazeGlassSet.normalMap,
      roughnessMap: mazeGlassSet.roughnessMap,
      roughness: 0.18,
      metalness: 0.82,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      emissive: new THREE.Color(0xffe1ad),
      emissiveMap: mazeGlassSet.emissiveMap,
      emissiveIntensity: 0.72,
    });

    // 9. Vehicle & Architectural Hardware Metals, Carbon Fiber, Brass Trim, Multi-Color Awnings, Helipad, Plates & Crosswalks
    this.brushedMetal = new THREE.MeshPhysicalMaterial({
      color: 0xd9dde2,
      metalness: 0.95,
      roughness: 0.2,
      anisotropy: 0.65,
      clearcoat: 0.65,
      clearcoatRoughness: 0.1,
    });
    this.darkChrome = new THREE.MeshPhysicalMaterial({
      color: 0x22252b,
      metalness: 0.88,
      roughness: 0.3,
      clearcoat: 0.35,
    });
    this.brassTrim = new THREE.MeshPhysicalMaterial({
      color: 0xc9a04e,
      metalness: 0.92,
      roughness: 0.26,
      anisotropy: 0.55,
      clearcoat: 0.45,
      clearcoatRoughness: 0.14,
    });
    this.carbonFiber = this.createCarbonFiberMaterial();
    const awningPairs: Array<[string, string]> = [
      ['#7e2720', '#ddd3c2'], // Burgundy & Cream (24/7 / Pizza)
      ['#1e5938', '#dcd5c6'], // Grove Emerald & Cream (Binco / Sub Urban)
      ['#1f3f66', '#e0dcd2'], // Coastal Navy & White (Imports / Surf)
      ['#a8561c', '#e6d6bc'], // Warm Amber Terracotta & Tan (Diner / Cluckin)
      ['#246b68', '#e2ded2'], // Retro California Teal & Cream (Beach / Boutique)
    ];
    this.awningPalettes = awningPairs.map(([c1, c2]) => this.createAwningFabricMaterial(c1, c2));
    this.awningFabric = this.awningPalettes[0];
    this.warmLampGlow = new THREE.MeshStandardMaterial({
      color: 0xffe8b8,
      emissive: new THREE.Color(0xffbe59),
      emissiveIntensity: 1.35,
      roughness: 0.18,
      metalness: 0.08,
    });
    this.helipadMat = this.createHelipadMaterial();
    this.licensePlateMat = this.createLicensePlateMaterial();
    this.crosswalkMat = this.createCrosswalkMaterial();

    const tireSet = this.createTireTreadSet();
    this.carTire = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: tireSet.map,
      normalMap: tireSet.normalMap,
      normalScale: new THREE.Vector2(1.4, 1.4),
      roughnessMap: tireSet.roughnessMap,
      roughness: 0.88,
      metalness: 0.04,
    });

    this.carGlass = new THREE.MeshPhysicalMaterial({
      color: 0x05090f,
      metalness: 0.42,
      roughness: 0.04,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      envMapIntensity: 2.3,
      transparent: true,
      opacity: isSoftwareGl ? 0.84 : 0.88,
      ior: 1.52,
    });

    // 10. Hyperrealistic California Palm Bark, Sculpted Pinnate Fronds, Shaggy Dead Skirt & Date Clusters
    const barkSet = this.createPalmBarkSet();
    this.palmBark = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      map: barkSet.map,
      normalMap: barkSet.normalMap,
      normalScale: new THREE.Vector2(1.85, 1.85),
      roughnessMap: barkSet.roughnessMap,
      roughness: 0.95,
      metalness: 0.0,
      envMapIntensity: 0.24,
    });

    const frondSet = this.createPalmFrondSet();
    this.palmFrond = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: frondSet.map,
      normalMap: frondSet.normalMap,
      normalScale: new THREE.Vector2(1.25, 1.25),
      roughnessMap: frondSet.roughnessMap,
      alphaTest: 0.38,
      side: THREE.DoubleSide,
      roughness: 0.56,
      metalness: 0.02,
      envMapIntensity: 0.42,
    });

    // Backlit translucent palm fronds with world-space travelling ocean breeze waves
    applyFoliageBacklightShader(this.palmFrond, uniforms, [1.28, 1.22, 0.58], true);

    const deadFrondSet = this.createDeadPalmFrondSet();
    this.palmDeadFrond = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: deadFrondSet.map,
      normalMap: deadFrondSet.normalMap,
      normalScale: new THREE.Vector2(1.4, 1.4),
      roughnessMap: deadFrondSet.roughnessMap,
      alphaTest: 0.34,
      side: THREE.DoubleSide,
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.16,
    });
    applyFoliageBacklightShader(this.palmDeadFrond, uniforms, [0.95, 0.72, 0.42], true);

    this.palmDateMat = new THREE.MeshStandardMaterial({
      color: 0xc27e2a,
      roughness: 0.42,
      metalness: 0.05,
      envMapIntensity: 0.45,
    });

    this.palmSoilMat = new THREE.MeshStandardMaterial({
      color: 0x3a2e23,
      roughness: 0.98,
      metalness: 0.0,
      envMapIntensity: 0.12,
    });

    // 11. Streetlamp Sodium Vapor Emissive + Micro-Detail Fabric & Car-Flake Maps + California Shade Trees
    this.streetlampGlow = new THREE.MeshStandardMaterial({
      color: 0xffe4b5,
      emissive: new THREE.Color(0xffb454),
      emissiveIntensity: 1.4,
      roughness: 0.25,
      metalness: 0.1,
    });

    this.fabricNormalMap = this.createFabricNormalMap();
    this.carFlakeNormalMap = this.createCarFlakeNormalMap();

    this.shadeBark = new THREE.MeshStandardMaterial({
      color: 0x524236,
      normalMap: barkSet.normalMap,
      normalScale: new THREE.Vector2(1.1, 1.1),
      roughness: 0.94,
      metalness: 0.0,
    });
    const greenLeafTex = this.createBotanicalLeafClusterTexture(false);
    const jacarandaLeafTex = this.createBotanicalLeafClusterTexture(true);
    this.shadeLeafGreen = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: greenLeafTex,
      alphaTest: 0.38,
      side: THREE.DoubleSide,
      roughness: 0.78,
      metalness: 0.0,
      envMapIntensity: 0.32,
    });
    applyFoliageBacklightShader(this.shadeLeafGreen, uniforms, [1.18, 1.15, 0.62], false);

    this.shadeLeafJacaranda = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: jacarandaLeafTex,
      alphaTest: 0.38,
      side: THREE.DoubleSide,
      roughness: 0.76,
      metalness: 0.0,
      envMapIntensity: 0.34,
    });
    applyFoliageBacklightShader(this.shadeLeafJacaranda, uniforms, [1.24, 0.92, 1.38], false);

    // 12. Pillar 1: Interior-Mapped 3D Parallax + Schlick Fresnel Glass Materials
    this.interiorWindowStore = this.createInteriorWindowMaterial('store', uniforms);
    this.interiorWindowOffice = this.createInteriorWindowMaterial('office', uniforms);
    this.interiorWindowResidential = this.createInteriorWindowMaterial('residential', uniforms);

    // 13. Pillar 2 & 3: Curbs, Storm Drains & Hero Xoomer Gas Station Materials
    this.curbConcrete = new THREE.MeshStandardMaterial({
      color: 0x8b857b,
      map: sidewalkSet.map,
      normalMap: sidewalkSet.normalMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughness: 0.92,
      metalness: 0.02,
      envMapIntensity: 0.25,
    });
    applyArchitecturalPBRShader(this.curbConcrete, uniforms, { aoHeight: 0.35, microScale: 9.0 });
    this.curbRedPaint = new THREE.MeshStandardMaterial({
      color: 0x822820,
      map: sidewalkSet.map,
      normalMap: sidewalkSet.normalMap,
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughness: 0.84,
      metalness: 0.04,
      envMapIntensity: 0.28,
    });
    applyArchitecturalPBRShader(this.curbRedPaint, uniforms, { aoHeight: 0.35, microScale: 9.0 });
    this.stormDrainMat = this.createStormDrainMaterial();
    this.gasForecourtMat = this.createGasForecourtMaterial(uniforms);
    this.gasFasciaMat = this.createGasFasciaMaterial();
    this.gasPylonMat = this.createGasPylonMaterial();
    this.gasPumpScreenMat = this.createGasPumpScreenMaterial();
    this.storePosterMat = this.createStorePosterMaterial();

    // Character clothing & skin PBR maps are owned by characterModels.ts asset pool

    // 15. Pillar 6: Weathered Urban Street-Furniture Materials (Zero Plastic Monopoly Props!)
    this.busAdMat = this.createBusShelterAdMaterial();
    this.stopSignMat = this.createStopSignMaterial();
    this.weatheredHydrantMat = this.createWeatheredPaintedMetalMaterial('#8f231c', '#4a1814', 4411, uniforms);
    this.weatheredNewsBoxMat = this.createWeatheredPaintedMetalMaterial('#24415e', '#1a2430', 4422, uniforms);
    this.manholeMat = this.createManholeCoverMaterial();
    this.shrubMat = new THREE.MeshStandardMaterial({
      color: 0x3b5830,
      map: greenLeafTex,
      roughness: 0.88,
      metalness: 0.0,
      envMapIntensity: 0.22,
    });
    this.cafeUmbrellaMat = this.awningPalettes[0];

    // 16. Soft Radial Contact Shadow Disc
    this.contactShadowMap = this.createContactShadowTexture();

    this.registerDisposable(
      this.weatheredHydrantMat,
      this.weatheredNewsBoxMat,
      this.manholeMat,
      this.shrubMat,
      this.roadNS,
      this.roadEW,
      this.culDeSacAsphalt,
      this.sidewalk,
      this.terrain,
      this.ocean,
      this.roofTile,
      this.terracottaTile,
      this.woodPorch,
      this.trimPaintWhite,
      this.stoneMasonry,
      this.corrugatedMetal,
      this.mazeBankMarble,
      this.mazeBankGlass,
      this.brushedMetal,
      this.darkChrome,
      this.brassTrim,
      this.carbonFiber,
      this.warmLampGlow,
      this.helipadMat,
      this.licensePlateMat,
      this.crosswalkMat,
      this.carTire,
      this.carGlass,
      this.streetlampGlow,
      this.fabricNormalMap,
      this.carFlakeNormalMap,
      this.shadeBark,
      this.shadeLeafGreen,
      this.shadeLeafJacaranda,
      this.palmBark,
      this.palmFrond,
      this.palmDeadFrond,
      this.palmDateMat,
      this.palmSoilMat,
      this.interiorWindowStore,
      this.interiorWindowOffice,
      this.interiorWindowResidential,
      this.curbConcrete,
      this.curbRedPaint,
      this.stormDrainMat,
      this.gasForecourtMat,
      this.gasFasciaMat,
      this.gasPylonMat,
      this.gasPumpScreenMat,
      this.storePosterMat,
      this.busAdMat,
      this.stopSignMat,
      this.contactShadowMap,
      ...this.stuccoPalettes,
      ...this.clapboardPalettes,
      ...this.awningPalettes,
      ...this.commercialWalls,
      ...this.skyscraperFacades,
    );
  }

  public createCarPaintMaterial(primaryHex: number): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({
      color: primaryHex,
      metalness: 0.74,
      roughness: 0.2,
      clearcoat: 1.0,
      clearcoatRoughness: 0.045,
      clearcoatNormalMap: this.carFlakeNormalMap,
      clearcoatNormalScale: new THREE.Vector2(0.06, 0.06),
      reflectivity: 0.96,
      ior: 1.52,
      envMapIntensity: 1.15,
    });
  }

  public createSignMaterial(text: string, neonHex: string): THREE.MeshStandardMaterial {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#141312';
    ctx.fillRect(0, 0, 512, 128);

    // Metallic weathered frame
    ctx.strokeStyle = '#3f3d39';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, 504, 120);

    // Subtle neon tube backing
    ctx.font = 'bold 54px Oswald, Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = neonHex;
    ctx.shadowBlur = 18;
    ctx.fillStyle = neonHex;
    ctx.fillText(text, 256, 66);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff8ee';
    ctx.fillText(text, 256, 66);

    const tex = finalizeTexture(canvas, true, this.anisotropy);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: tex,
      emissive: new THREE.Color(neonHex),
      emissiveMap: tex,
      emissiveIntensity: 1.35,
      roughness: 0.35,
      metalness: 0.4,
    });
    mat.userData.shared = true;
    this.disposables.push(tex, mat);
    return mat;
  }

  private registerDisposable(...items: Array<{ dispose: () => void }>): void {
    for (const item of items) {
      if (item instanceof THREE.Material) {
        item.userData.shared = true;
      }
      this.disposables.push(item);
    }
  }

  private createAsphaltSet(withLaneMarkings: boolean): PBRTextureSet {
    const size = this.res;
    const rng = mulberry32(withLaneMarkings ? 1024 : 2048);

    const albedoC = document.createElement('canvas');
    albedoC.width = size;
    albedoC.height = size;
    const aCtx = albedoC.getContext('2d')!;

    const heightC = document.createElement('canvas');
    heightC.width = size;
    heightC.height = size;
    const hCtx = heightC.getContext('2d')!;

    const roughC = document.createElement('canvas');
    roughC.width = size;
    roughC.height = size;
    const rCtx = roughC.getContext('2d')!;

    // Base weathered sun-baked California charcoal asphalt (lifted from pitch-black so mineral grain reads cleanly!)
    aCtx.fillStyle = '#3f4145';
    aCtx.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#808080';
    hCtx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#d8d8d8';
    rCtx.fillRect(0, 0, size, size);

    // Multi-scale mineral aggregate grain
    const pebbleCount = Math.floor(size * size * 0.085);
    for (let i = 0; i < pebbleCount; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const rad = 0.7 + rng() * 1.9;
      const v = Math.floor(48 + rng() * 44);
      aCtx.fillStyle = `rgb(${v},${v},${v + 3})`;
      aCtx.fillRect(x, y, rad, rad);

      const hv = Math.floor(105 + rng() * 60);
      hCtx.fillStyle = `rgb(${hv},${hv},${hv})`;
      hCtx.fillRect(x, y, rad, rad);
    }

    // Tire wear tracks (slightly darker & smoother gloss)
    const trackOffsets = [0.22, 0.34, 0.66, 0.78];
    for (const t of trackOffsets) {
      const grad = aCtx.createLinearGradient(
        (t - 0.06) * size,
        0,
        (t + 0.06) * size,
        0,
      );
      grad.addColorStop(0, 'rgba(18,18,20,0)');
      grad.addColorStop(0.5, 'rgba(16,16,18,0.34)');
      grad.addColorStop(1, 'rgba(18,18,20,0)');
      aCtx.fillStyle = grad;
      aCtx.fillRect((t - 0.06) * size, 0, 0.12 * size, size);

      rCtx.fillStyle = 'rgba(130,130,130,0.45)';
      rCtx.fillRect((t - 0.04) * size, 0, 0.08 * size, size);
    }

    // Subtle hairline tar-sealed cracks (flat in heightmap so they never look embossed!)
    for (let c = 0; c < 8; c++) {
      let cx = rng() * size;
      let cy = rng() * size;
      aCtx.strokeStyle = 'rgba(18,18,19,0.52)';
      aCtx.lineWidth = 1.0 + rng() * 1.1;
      hCtx.strokeStyle = 'rgb(112,112,112)';
      hCtx.lineWidth = 1.0;
      rCtx.strokeStyle = 'rgb(155,155,155)';
      rCtx.lineWidth = 1.4;

      aCtx.beginPath();
      hCtx.beginPath();
      rCtx.beginPath();
      aCtx.moveTo(cx, cy);
      hCtx.moveTo(cx, cy);
      rCtx.moveTo(cx, cy);
      for (let s = 0; s < 9; s++) {
        cx += (rng() - 0.5) * size * 0.08;
        cy += (rng() - 0.5) * size * 0.08;
        aCtx.lineTo(cx, cy);
        hCtx.lineTo(cx, cy);
        rCtx.lineTo(cx, cy);
      }
      aCtx.stroke();
      hCtx.stroke();
      rCtx.stroke();
    }

    if (withLaneMarkings) {
      // Iconic faded California double yellow centerline
      const center = size * 0.5;
      const lineW = Math.max(4, size * 0.012);
      const gap = Math.max(5, size * 0.015);
      aCtx.fillStyle = 'rgba(218, 165, 52, 0.86)';
      aCtx.fillRect(center - gap - lineW, 0, lineW, size);
      aCtx.fillRect(center + gap, 0, lineW, size);

      // Subtle edge white shoulder lines
      aCtx.fillStyle = 'rgba(220, 218, 210, 0.65)';
      aCtx.fillRect(size * 0.045, 0, lineW * 0.9, size);
      aCtx.fillRect(size * 0.955 - lineW * 0.9, 0, lineW * 0.9, size);

      // Weather wear flecks on paint so lines never look plastic
      for (let i = 0; i < 400; i++) {
        const y = rng() * size;
        const x = center + (rng() - 0.5) * (gap * 4);
        aCtx.fillStyle = 'rgba(42,42,44,0.55)';
        aCtx.fillRect(x, y, 3, 3);
      }
    }

    const map = finalizeTexture(albedoC, true, this.anisotropy, 1, 6);
    const normalMap = createNormalFromHeight(heightC, 2.2, this.anisotropy);
    normalMap.repeat.set(1, 6);
    const roughnessMap = finalizeTexture(roughC, false, this.anisotropy, 1, 6);
    this.disposables.push(map, normalMap, roughnessMap);
    return { map, normalMap, roughnessMap };
  }

  private createConcreteSidewalkSet(): PBRTextureSet {
    const size = Math.min(512, this.res);
    const rng = mulberry32(3030);

    const albedoC = document.createElement('canvas');
    albedoC.width = size;
    albedoC.height = size;
    const aCtx = albedoC.getContext('2d')!;

    const heightC = document.createElement('canvas');
    heightC.width = size;
    heightC.height = size;
    const hCtx = heightC.getContext('2d')!;

    const roughC = document.createElement('canvas');
    roughC.width = size;
    roughC.height = size;
    const rCtx = roughC.getContext('2d')!;

    aCtx.fillStyle = '#9a958b';
    aCtx.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#888888';
    hCtx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#d4d4d4';
    rCtx.fillRect(0, 0, size, size);

    // Mottled sun-bleached concrete slabs
    for (let i = 0; i < 4500; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const s = 1 + rng() * 3;
      const v = Math.floor(132 + rng() * 38);
      aCtx.fillStyle = `rgba(${v},${v - 3},${v - 9},0.45)`;
      aCtx.fillRect(x, y, s, s);
      const hv = Math.floor(115 + rng() * 45);
      hCtx.fillStyle = `rgb(${hv},${hv},${hv})`;
      hCtx.fillRect(x, y, s, s);
    }

    // Concrete slab expansion joints
    const tiles = 4;
    const step = size / tiles;
    aCtx.strokeStyle = 'rgba(54,51,46,0.68)';
    aCtx.lineWidth = 2.5;
    hCtx.strokeStyle = 'rgb(30,30,30)';
    hCtx.lineWidth = 3;
    for (let i = 0; i <= tiles; i++) {
      const p = i * step;
      aCtx.beginPath();
      aCtx.moveTo(p, 0);
      aCtx.lineTo(p, size);
      aCtx.moveTo(0, p);
      aCtx.lineTo(size, p);
      aCtx.stroke();

      hCtx.beginPath();
      hCtx.moveTo(p, 0);
      hCtx.lineTo(p, size);
      hCtx.moveTo(0, p);
      hCtx.lineTo(size, p);
      hCtx.stroke();
    }

    // Pillar 2: 62x62 repeats with 4x4 slabs = realistic ~1.49m California concrete sidewalk slabs!
    const map = finalizeTexture(albedoC, true, this.anisotropy, 62, 62);
    const normalMap = createNormalFromHeight(heightC, 1.35, this.anisotropy);
    normalMap.repeat.set(62, 62);
    const roughnessMap = finalizeTexture(roughC, false, this.anisotropy, 62, 62);
    this.disposables.push(map, normalMap, roughnessMap);
    return { map, normalMap, roughnessMap };
  }

  private createCaliforniaGroundSet(): PBRTextureSet {
    const size = Math.min(512, this.res);
    const rng = mulberry32(4111);

    const albedoC = document.createElement('canvas');
    albedoC.width = size;
    albedoC.height = size;
    const aCtx = albedoC.getContext('2d')!;

    const heightC = document.createElement('canvas');
    heightC.width = size;
    heightC.height = size;
    const hCtx = heightC.getContext('2d')!;

    const roughC = document.createElement('canvas');
    roughC.width = size;
    roughC.height = size;
    const rCtx = roughC.getContext('2d')!;

    // Sun-baked SoCal olive grass & dusty ochre earth
    aCtx.fillStyle = '#5e6242';
    aCtx.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#808080';
    hCtx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#eaeaea';
    rCtx.fillRect(0, 0, size, size);

    for (let i = 0; i < 7000; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const isDry = rng() > 0.55;
      aCtx.fillStyle = isDry
        ? `rgba(${118 + Math.floor(rng() * 30)},${102 + Math.floor(rng() * 24)},${66 + Math.floor(rng() * 16)},0.5)`
        : `rgba(${68 + Math.floor(rng() * 28)},${86 + Math.floor(rng() * 30)},${44 + Math.floor(rng() * 18)},0.55)`;
      aCtx.fillRect(x, y, 2 + rng() * 4, 2 + rng() * 4);

      const hv = Math.floor(95 + rng() * 75);
      hCtx.fillStyle = `rgb(${hv},${hv},${hv})`;
      hCtx.fillRect(x, y, 2, 3);
    }

    const map = finalizeTexture(albedoC, true, this.anisotropy, 32, 32);
    const normalMap = createNormalFromHeight(heightC, 1.5, this.anisotropy);
    normalMap.repeat.set(32, 32);
    const roughnessMap = finalizeTexture(roughC, false, this.anisotropy, 32, 32);
    this.disposables.push(map, normalMap, roughnessMap);
    return { map, normalMap, roughnessMap };
  }

  private createStuccoSet(baseHex: string, seed: number): PBRTextureSet {
    const size = Math.min(512, this.res);
    const rng = mulberry32(seed);

    const albedoC = document.createElement('canvas');
    albedoC.width = size;
    albedoC.height = size;
    const aCtx = albedoC.getContext('2d')!;

    const heightC = document.createElement('canvas');
    heightC.width = size;
    heightC.height = size;
    const hCtx = heightC.getContext('2d')!;

    const roughC = document.createElement('canvas');
    roughC.width = size;
    roughC.height = size;
    const rCtx = roughC.getContext('2d')!;

    aCtx.fillStyle = baseHex;
    aCtx.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#808080';
    hCtx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#dcdcdc';
    rCtx.fillRect(0, 0, size, size);

    // Plaster trowel strokes & subtle sun weathering streaks
    for (let i = 0; i < 4200; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const shade = rng() > 0.5 ? 'rgba(255,250,242,0.08)' : 'rgba(42,35,28,0.09)';
      aCtx.fillStyle = shade;
      aCtx.fillRect(x, y, 4 + rng() * 8, 2 + rng() * 5);

      const hv = Math.floor(110 + rng() * 44);
      hCtx.fillStyle = `rgb(${hv},${hv},${hv})`;
      hCtx.fillRect(x, y, 4, 3);
    }

    // Bottom grime gradient
    const grime = aCtx.createLinearGradient(0, size * 0.72, 0, size);
    grime.addColorStop(0, 'rgba(30,24,18,0)');
    grime.addColorStop(1, 'rgba(30,24,18,0.28)');
    aCtx.fillStyle = grime;
    aCtx.fillRect(0, size * 0.72, size, size * 0.28);

    const map = finalizeTexture(albedoC, true, this.anisotropy, 2, 1);
    const normalMap = createNormalFromHeight(heightC, 1.4, this.anisotropy);
    normalMap.repeat.set(2, 1);
    const roughnessMap = finalizeTexture(roughC, false, this.anisotropy, 2, 1);
    this.disposables.push(map, normalMap, roughnessMap);
    return { map, normalMap, roughnessMap };
  }

  private createRoofShingleSet(): PBRTextureSet {
    const size = Math.min(512, this.res);
    const rng = mulberry32(5512);

    const albedoC = document.createElement('canvas');
    albedoC.width = size;
    albedoC.height = size;
    const aCtx = albedoC.getContext('2d')!;

    const heightC = document.createElement('canvas');
    heightC.width = size;
    heightC.height = size;
    const hCtx = heightC.getContext('2d')!;

    const roughC = document.createElement('canvas');
    roughC.width = size;
    roughC.height = size;
    const rCtx = roughC.getContext('2d')!;

    aCtx.fillStyle = '#4e3f35';
    aCtx.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#707070';
    hCtx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#dadada';
    rCtx.fillRect(0, 0, size, size);

    const rows = 14;
    const cols = 10;
    const rh = size / rows;
    const cw = size / cols;
    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * (cw * 0.5);
      for (let c = -1; c <= cols; c++) {
        const x = c * cw + offset;
        const y = r * rh;
        const tone = Math.floor(rng() * 28);
        aCtx.fillStyle = `rgb(${78 + tone},${60 + Math.floor(tone * 0.8)},${49 + Math.floor(tone * 0.6)})`;
        aCtx.fillRect(x + 1, y + 1, cw - 2, rh - 2);
        hCtx.fillStyle = `rgb(${130 + tone},${130 + tone},${130 + tone})`;
        hCtx.fillRect(x + 1, y + 2, cw - 2, rh - 3);
      }
    }

    const map = finalizeTexture(albedoC, true, this.anisotropy, 3, 3);
    const normalMap = createNormalFromHeight(heightC, 2.1, this.anisotropy);
    normalMap.repeat.set(3, 3);
    const roughnessMap = finalizeTexture(roughC, false, this.anisotropy, 3, 3);
    this.disposables.push(map, normalMap, roughnessMap);
    return { map, normalMap, roughnessMap };
  }

  private createWeatheredWoodSet(): PBRTextureSet {
    const size = Math.min(512, this.res);
    const rng = mulberry32(6006);

    const albedoC = document.createElement('canvas');
    albedoC.width = size;
    albedoC.height = size;
    const aCtx = albedoC.getContext('2d')!;
    const heightC = document.createElement('canvas');
    heightC.width = size;
    heightC.height = size;
    const hCtx = heightC.getContext('2d')!;
    const roughC = document.createElement('canvas');
    roughC.width = size;
    roughC.height = size;
    const rCtx = roughC.getContext('2d')!;

    aCtx.fillStyle = '#6f553f';
    aCtx.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#808080';
    hCtx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#c8c8c8';
    rCtx.fillRect(0, 0, size, size);

    for (let y = 0; y < size; y += 3) {
      const v = Math.floor((rng() - 0.5) * 24);
      aCtx.fillStyle = `rgb(${108 + v},${82 + Math.floor(v * 0.8)},${60 + Math.floor(v * 0.6)})`;
      aCtx.fillRect(0, y, size, 3);
      hCtx.fillStyle = `rgb(${128 + v},${128 + v},${128 + v})`;
      hCtx.fillRect(0, y, size, 3);
    }

    const map = finalizeTexture(albedoC, true, this.anisotropy, 2, 2);
    const normalMap = createNormalFromHeight(heightC, 1.5, this.anisotropy);
    normalMap.repeat.set(2, 2);
    const roughnessMap = finalizeTexture(roughC, false, this.anisotropy, 2, 2);
    this.disposables.push(map, normalMap, roughnessMap);
    return { map, normalMap, roughnessMap };
  }

  public createBladeSignMaterial(
    text: string,
    accentHex: string,
  ): THREE.MeshStandardMaterial {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 512;
    const ctx = c.getContext('2d')!;

    ctx.fillStyle = '#14171c';
    ctx.fillRect(0, 0, 128, 512);
    ctx.strokeStyle = accentHex;
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, 112, 496);
    ctx.strokeStyle = '#ffeec8';
    ctx.lineWidth = 2;
    ctx.strokeRect(16, 16, 96, 480);

    // Compact vertical stacked letters (classic Hollywood / Los Santos blade sign)
    const clean = text.replace(/\s+/g, '').slice(0, 10).toUpperCase();
    const step = 440 / Math.max(clean.length, 1);
    ctx.fillStyle = '#fff9eb';
    ctx.shadowColor = accentHex;
    ctx.shadowBlur = 12;
    ctx.font = `bold ${Math.min(48, Math.floor(step * 0.82))}px "Bebas Neue", Impact, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < clean.length; i++) {
      ctx.fillText(clean[i], 64, 42 + (i + 0.5) * step);
    }

    const tex = finalizeTexture(c, true, this.anisotropy, 1, 1);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: tex,
      emissive: new THREE.Color(accentHex),
      emissiveMap: tex,
      emissiveIntensity: 0.95,
      roughness: 0.28,
      metalness: 0.18,
    });
    this.disposables.push(tex, mat);
    return mat;
  }

  private createClapboardSidingSet(baseHex: string, seed: number): PBRTextureSet {
    const size = Math.min(512, this.res);
    const rng = mulberry32(seed);
    const albedoC = document.createElement('canvas');
    albedoC.width = size;
    albedoC.height = size;
    const aCtx = albedoC.getContext('2d')!;
    const heightC = document.createElement('canvas');
    heightC.width = size;
    heightC.height = size;
    const hCtx = heightC.getContext('2d')!;
    const roughC = document.createElement('canvas');
    roughC.width = size;
    roughC.height = size;
    const rCtx = roughC.getContext('2d')!;

    aCtx.fillStyle = baseHex;
    aCtx.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#808080';
    hCtx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#d4d4d4';
    rCtx.fillRect(0, 0, size, size);

    // 14 beveled horizontal overlapping wood clapboard courses per tile
    const planks = 14;
    const ph = size / planks;
    for (let p = 0; p < planks; p++) {
      const y = p * ph;
      const tone = (rng() - 0.5) * 16;
      const grad = aCtx.createLinearGradient(0, y, 0, y + ph);
      grad.addColorStop(0.0, 'rgba(255,252,245,0.08)');
      grad.addColorStop(0.72, tone > 0 ? 'rgba(255,255,255,0.03)' : 'rgba(20,18,15,0.05)');
      grad.addColorStop(0.88, 'rgba(18,15,12,0.28)');
      grad.addColorStop(1.0, 'rgba(10,9,8,0.44)');
      aCtx.fillStyle = grad;
      aCtx.fillRect(0, y, size, ph);

      // Fine horizontal wood grain streaks & vertical butt joints
      for (let g = 0; g < 6; g++) {
        aCtx.fillStyle = rng() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(24,20,16,0.045)';
        aCtx.fillRect(0, y + rng() * (ph - 3), size, 1.2);
      }
      const jointX = ((p * 173 + Math.floor(rng() * 80)) % (size - 32)) + 16;
      aCtx.fillStyle = 'rgba(20,16,12,0.28)';
      aCtx.fillRect(jointX, y, 2, ph);

      const hGrad = hCtx.createLinearGradient(0, y, 0, y + ph);
      hGrad.addColorStop(0.0, '#626262');
      hGrad.addColorStop(0.84, '#d8d8d8');
      hGrad.addColorStop(0.92, '#282828');
      hGrad.addColorStop(1.0, '#4a4a4a');
      hCtx.fillStyle = hGrad;
      hCtx.fillRect(0, y, size, ph);
    }

    const map = finalizeTexture(albedoC, true, this.anisotropy, 1, 1);
    const normalMap = createNormalFromHeight(heightC, 2.2, this.anisotropy);
    const roughnessMap = finalizeTexture(roughC, false, this.anisotropy, 1, 1);
    this.disposables.push(map, normalMap, roughnessMap);
    return { map, normalMap, roughnessMap };
  }

  private createTerracottaBarrelTileSet(): PBRTextureSet {
    const size = Math.min(512, this.res);
    const rng = mulberry32(5599);
    const albedoC = document.createElement('canvas');
    albedoC.width = size;
    albedoC.height = size;
    const aCtx = albedoC.getContext('2d')!;
    const heightC = document.createElement('canvas');
    heightC.width = size;
    heightC.height = size;
    const hCtx = heightC.getContext('2d')!;
    const roughC = document.createElement('canvas');
    roughC.width = size;
    roughC.height = size;
    const rCtx = roughC.getContext('2d')!;

    aCtx.fillStyle = '#8b4328';
    aCtx.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#505050';
    hCtx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#cecece';
    rCtx.fillRect(0, 0, size, size);

    const cols = 12;
    const rows = 10;
    const cw = size / cols;
    const rh = size / rows;

    for (let r = 0; r < rows; r++) {
      const y = r * rh;
      for (let c = 0; c < cols; c++) {
        const x = c * cw;
        const v = Math.floor((rng() - 0.5) * 34);
        const rr = Math.max(85, Math.min(198, 152 + v));
        const gg = Math.max(40, Math.min(115, 76 + Math.floor(v * 0.65)));
        const bb = Math.max(24, Math.min(82, 46 + Math.floor(v * 0.45)));

        const barrelG = aCtx.createLinearGradient(x, y, x + cw, y);
        barrelG.addColorStop(0.0, `rgb(${Math.max(30, rr - 48)},${Math.max(18, gg - 30)},${Math.max(12, bb - 20)})`);
        barrelG.addColorStop(0.42, `rgb(${Math.min(230, rr + 24)},${Math.min(145, gg + 16)},${Math.min(105, bb + 10)})`);
        barrelG.addColorStop(0.78, `rgb(${rr},${gg},${bb})`);
        barrelG.addColorStop(1.0, `rgb(${Math.max(25, rr - 56)},${Math.max(14, gg - 34)},${Math.max(10, bb - 22)})`);
        aCtx.fillStyle = barrelG;
        aCtx.fillRect(x, y, cw, rh - 2);

        // Dark overlapped course lip shadow
        aCtx.fillStyle = 'rgba(22,12,8,0.52)';
        aCtx.fillRect(x, y + rh - 4, cw, 4);

        const hG = hCtx.createLinearGradient(x, y, x + cw, y);
        hG.addColorStop(0.0, '#222222');
        hG.addColorStop(0.48, '#f0f0f0');
        hG.addColorStop(1.0, '#1e1e1e');
        hCtx.fillStyle = hG;
        hCtx.fillRect(x, y, cw, rh - 3);
        hCtx.fillStyle = '#141414';
        hCtx.fillRect(x, y + rh - 3, cw, 3);
      }
    }

    const map = finalizeTexture(albedoC, true, this.anisotropy, 1, 1);
    const normalMap = createNormalFromHeight(heightC, 2.5, this.anisotropy);
    const roughnessMap = finalizeTexture(roughC, false, this.anisotropy, 1, 1);
    this.disposables.push(map, normalMap, roughnessMap);
    return { map, normalMap, roughnessMap };
  }

  private createStoneMasonrySet(): PBRTextureSet {
    const size = Math.min(512, this.res);
    const rng = mulberry32(6123);
    const albedoC = document.createElement('canvas');
    albedoC.width = size;
    albedoC.height = size;
    const aCtx = albedoC.getContext('2d')!;
    const heightC = document.createElement('canvas');
    heightC.width = size;
    heightC.height = size;
    const hCtx = heightC.getContext('2d')!;
    const roughC = document.createElement('canvas');
    roughC.width = size;
    roughC.height = size;
    const rCtx = roughC.getContext('2d')!;

    aCtx.fillStyle = '#5c5750';
    aCtx.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#282828';
    hCtx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#e4e4e4';
    rCtx.fillRect(0, 0, size, size);

    const rows = 10;
    const rh = size / rows;
    for (let r = 0; r < rows; r++) {
      let x = (r % 2) * -28;
      const y = r * rh;
      while (x < size) {
        const bw = 46 + rng() * 56;
        const tone = rng();
        const cr = Math.floor(114 + tone * 54 + (rng() - 0.5) * 16);
        const cg = Math.floor(108 + tone * 48 + (rng() - 0.5) * 14);
        const cb = Math.floor(96 + tone * 42 + (rng() - 0.5) * 14);
        aCtx.fillStyle = `rgb(${cr},${cg},${cb})`;
        aCtx.fillRect(x + 3, y + 3, bw - 6, rh - 6);

        // Chiseled stone top bevel highlight & bottom shadow
        aCtx.fillStyle = 'rgba(255,250,242,0.16)';
        aCtx.fillRect(x + 3, y + 3, bw - 6, 4);
        aCtx.fillStyle = 'rgba(20,18,15,0.22)';
        aCtx.fillRect(x + 3, y + rh - 7, bw - 6, 4);

        const hv = Math.floor(145 + tone * 75);
        hCtx.fillStyle = `rgb(${hv},${hv},${hv})`;
        hCtx.fillRect(x + 4, y + 4, bw - 8, rh - 8);
        x += bw;
      }
    }

    const map = finalizeTexture(albedoC, true, this.anisotropy, 1, 1);
    const normalMap = createNormalFromHeight(heightC, 2.4, this.anisotropy);
    const roughnessMap = finalizeTexture(roughC, false, this.anisotropy, 1, 1);
    this.disposables.push(map, normalMap, roughnessMap);
    return { map, normalMap, roughnessMap };
  }

  private createCorrugatedMetalSet(): PBRTextureSet {
    const size = 256;
    const rng = mulberry32(6442);
    const albedoC = document.createElement('canvas');
    albedoC.width = size;
    albedoC.height = size;
    const aCtx = albedoC.getContext('2d')!;
    const heightC = document.createElement('canvas');
    heightC.width = size;
    heightC.height = size;
    const hCtx = heightC.getContext('2d')!;
    const roughC = document.createElement('canvas');
    roughC.width = size;
    roughC.height = size;
    const rCtx = roughC.getContext('2d')!;

    // Horizontal roll-up / corrugated industrial steel slats
    const slats = 16;
    const sh = size / slats;
    for (let s = 0; s < slats; s++) {
      const y = s * sh;
      const g = aCtx.createLinearGradient(0, y, 0, y + sh);
      g.addColorStop(0.0, '#4c5259');
      g.addColorStop(0.32, '#9fa6ae');
      g.addColorStop(0.66, '#7a818a');
      g.addColorStop(1.0, '#363b42');
      aCtx.fillStyle = g;
      aCtx.fillRect(0, y, size, sh);

      const hg = hCtx.createLinearGradient(0, y, 0, y + sh);
      hg.addColorStop(0.0, '#222222');
      hg.addColorStop(0.45, '#f0f0f0');
      hg.addColorStop(1.0, '#1e1e1e');
      hCtx.fillStyle = hg;
      hCtx.fillRect(0, y, size, sh);

      const rv = Math.floor(110 + rng() * 35);
      rCtx.fillStyle = `rgb(${rv},${rv},${rv})`;
      rCtx.fillRect(0, y, size, sh);
    }
    // Subtle industrial grease/weathering streaks
    for (let i = 0; i < 90; i++) {
      aCtx.fillStyle = rng() > 0.4 ? 'rgba(30,26,22,0.12)' : 'rgba(130,82,48,0.09)';
      aCtx.fillRect(rng() * size, rng() * size, 3 + rng() * 14, 10 + rng() * 44);
    }

    const map = finalizeTexture(albedoC, true, this.anisotropy, 1, 1);
    const normalMap = createNormalFromHeight(heightC, 2.4, this.anisotropy);
    const roughnessMap = finalizeTexture(roughC, false, this.anisotropy, 1, 1);
    this.disposables.push(map, normalMap, roughnessMap);
    return { map, normalMap, roughnessMap };
  }

  private createHelipadMaterial(): THREE.MeshStandardMaterial {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    const rng = mulberry32(8831);

    ctx.fillStyle = '#3c4046';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 3200; i++) {
      const v = Math.floor(48 + rng() * 32);
      ctx.fillStyle = `rgba(${v},${v},${v + 3},0.35)`;
      ctx.fillRect(rng() * size, rng() * size, 3, 3);
    }

    // Outer dashed white safety ring
    ctx.strokeStyle = '#d8d4ca';
    ctx.lineWidth = 10;
    ctx.setLineDash([28, 18]);
    ctx.beginPath();
    ctx.arc(256, 256, 224, 0, Math.PI * 2);
    ctx.stroke();

    // Bold golden-yellow FAA touchdown circle
    ctx.setLineDash([]);
    ctx.strokeStyle = '#e8b428';
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.arc(256, 256, 178, 0, Math.PI * 2);
    ctx.stroke();

    // Crisp white 'H' helipad emblem
    ctx.fillStyle = '#f0ece2';
    ctx.fillRect(184, 152, 34, 208);
    ctx.fillRect(294, 152, 34, 208);
    ctx.fillRect(184, 238, 144, 36);

    const map = finalizeTexture(c, true, this.anisotropy, 1, 1);
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    this.disposables.push(map);
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map,
      roughness: 0.86,
      metalness: 0.08,
    });
  }

  private createBrickFacadeSet(
    baseHex: string,
    trimHex: string,
    seed: number,
    kind: 'brick' | 'concrete' | 'ashlar' | 'loft' | 'coastal' | 'terracotta' = 'brick',
  ): PBRTextureSet {
    const size = Math.min(512, this.res);
    const rng = mulberry32(seed);

    const albedoC = document.createElement('canvas');
    albedoC.width = size;
    albedoC.height = size;
    const aCtx = albedoC.getContext('2d')!;

    const heightC = document.createElement('canvas');
    heightC.width = size;
    heightC.height = size;
    const hCtx = heightC.getContext('2d')!;

    const roughC = document.createElement('canvas');
    roughC.width = size;
    roughC.height = size;
    const rCtx = roughC.getContext('2d')!;

    aCtx.fillStyle = baseHex;
    aCtx.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#808080';
    hCtx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#d4d4d4';
    rCtx.fillRect(0, 0, size, size);

    if (kind === 'brick' || kind === 'loft') {
      // Authentic running-bond brick masonry with recessed lime mortar, individual fired clay color variation & weathering
      aCtx.fillStyle = kind === 'loft' ? '#363b42' : '#9c9284';
      aCtx.fillRect(0, 0, size, size);
      hCtx.fillStyle = '#323232';
      hCtx.fillRect(0, 0, size, size);

      const rows = 20;
      const cols = 10;
      const rh = size / rows;
      const cw = size / cols;
      const baseCol = new THREE.Color(baseHex);

      for (let r = 0; r < rows; r++) {
        const y = r * rh;
        const off = (r % 2) * (cw * 0.5);
        for (let c = -1; c <= cols; c++) {
          const x = c * cw + off;
          const jitter = 0.82 + rng() * 0.36;
          const warm = (rng() - 0.5) * 0.08;
          const br = Math.min(255, Math.max(18, Math.round((baseCol.r * jitter + warm) * 255)));
          const bg = Math.min(255, Math.max(18, Math.round((baseCol.g * jitter) * 255)));
          const bb = Math.min(255, Math.max(18, Math.round((baseCol.b * jitter - warm * 0.5) * 255)));
          aCtx.fillStyle = `rgb(${br},${bg},${bb})`;
          aCtx.fillRect(x + 2, y + 2, cw - 4, rh - 4);

          const hv = Math.floor(150 + rng() * 75);
          hCtx.fillStyle = `rgb(${hv},${hv},${hv})`;
          hCtx.fillRect(x + 2.5, y + 2.5, cw - 5, rh - 5);

          const rv = Math.floor(195 + rng() * 48);
          rCtx.fillStyle = `rgb(${rv},${rv},${rv})`;
          rCtx.fillRect(x + 2, y + 2, cw - 4, rh - 4);
        }
      }
      // Subtle rainwater efflorescence & weathered mortar patina
      for (let i = 0; i < 65; i++) {
        aCtx.fillStyle = rng() > 0.5 ? 'rgba(220,214,200,0.06)' : 'rgba(22,18,15,0.09)';
        aCtx.fillRect(rng() * size, rng() * size, 6 + rng() * 24, 18 + rng() * 64);
      }
    } else if (kind === 'concrete') {
      // Mid-Century California Board-Formed Architectural Concrete Panels with seam reveals & tie-rod holes
      const panelRows = 4;
      const panelCols = 2;
      const prh = size / panelRows;
      const pcw = size / panelCols;

      for (let i = 0; i < 3600; i++) {
        aCtx.fillStyle = rng() > 0.5 ? 'rgba(255,252,245,0.055)' : 'rgba(28,26,22,0.065)';
        aCtx.fillRect(rng() * size, rng() * size, 5 + rng() * 14, 2 + rng() * 4);
      }
      aCtx.strokeStyle = 'rgba(34,32,28,0.48)';
      aCtx.lineWidth = 3;
      hCtx.strokeStyle = '#262626';
      hCtx.lineWidth = 4;
      for (let r = 0; r <= panelRows; r++) {
        const y = r * prh;
        aCtx.beginPath();
        aCtx.moveTo(0, y);
        aCtx.lineTo(size, y);
        aCtx.stroke();
        hCtx.beginPath();
        hCtx.moveTo(0, y);
        hCtx.lineTo(size, y);
        hCtx.stroke();
      }
      for (let c = 0; c <= panelCols; c++) {
        const x = c * pcw;
        aCtx.beginPath();
        aCtx.moveTo(x, 0);
        aCtx.lineTo(x, size);
        aCtx.stroke();
        hCtx.beginPath();
        hCtx.moveTo(x, 0);
        hCtx.lineTo(x, size);
        hCtx.stroke();
      }
      // Architectural form tie-rod dimples
      for (let r = 0; r < panelRows; r++) {
        for (let c = 0; c < panelCols; c++) {
          for (const fx of [0.22, 0.78]) {
            const tx = c * pcw + pcw * fx;
            const ty = r * prh + prh * 0.5;
            aCtx.fillStyle = 'rgba(30,28,25,0.45)';
            aCtx.beginPath();
            aCtx.arc(tx, ty, 3.5, 0, Math.PI * 2);
            aCtx.fill();
            hCtx.fillStyle = '#181818';
            hCtx.beginPath();
            hCtx.arc(tx, ty, 4, 0, Math.PI * 2);
            hCtx.fill();
          }
        }
      }
    } else if (kind === 'ashlar') {
      // Honed California Sandstone / Travertine Ashlar Blocks
      const rows = 8;
      const cols = 4;
      const rh = size / rows;
      const cw = size / cols;
      for (let r = 0; r < rows; r++) {
        const off = (r % 2) * (cw * 0.5);
        for (let c = -1; c <= cols; c++) {
          const x = c * cw + off;
          const y = r * rh;
          aCtx.fillStyle = rng() > 0.5 ? 'rgba(255,250,240,0.07)' : 'rgba(55,42,26,0.08)';
          aCtx.fillRect(x + 2, y + 2, cw - 4, rh - 4);
          aCtx.strokeStyle = 'rgba(65,54,40,0.42)';
          aCtx.lineWidth = 2;
          aCtx.strokeRect(x + 1, y + 1, cw - 2, rh - 2);
          hCtx.fillStyle = `rgb(${155 + Math.floor(rng() * 45)},${155 + Math.floor(rng() * 45)},${155 + Math.floor(rng() * 45)})`;
          hCtx.fillRect(x + 3, y + 3, cw - 6, rh - 6);
        }
      }
      // Subtle limestone horizontal veining
      for (let i = 0; i < 420; i++) {
        aCtx.fillStyle = 'rgba(245,236,220,0.08)';
        aCtx.fillRect(rng() * size, rng() * size, 24 + rng() * 68, 1.8);
      }
    } else if (kind === 'coastal') {
      // Retro Coastal Fluted / Ribbed Stucco Plaster with fine sand aggregate
      for (let i = 0; i < 3800; i++) {
        aCtx.fillStyle = rng() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(28,40,36,0.08)';
        aCtx.fillRect(rng() * size, rng() * size, 3 + rng() * 5, 3 + rng() * 5);
        const hv = Math.floor(110 + rng() * 48);
        hCtx.fillStyle = `rgb(${hv},${hv},${hv})`;
        hCtx.fillRect(rng() * size, rng() * size, 3, 3);
      }
      // Crisp horizontal Art-Deco reveal grooves
      for (let y = 0; y < size; y += 64) {
        aCtx.fillStyle = 'rgba(30,42,38,0.22)';
        aCtx.fillRect(0, y, size, 3);
        aCtx.fillStyle = trimHex;
        aCtx.globalAlpha = 0.22;
        aCtx.fillRect(0, y + 3, size, 3);
        aCtx.globalAlpha = 1.0;
        hCtx.fillStyle = '#383838';
        hCtx.fillRect(0, y, size, 4);
      }
    } else {
      // Mediterranean Hand-Troweled Terracotta Plaster with weathered patina
      for (let i = 0; i < 4600; i++) {
        const x = rng() * size;
        const y = rng() * size;
        aCtx.fillStyle = rng() > 0.45 ? 'rgba(248,232,208,0.08)' : 'rgba(56,30,18,0.09)';
        aCtx.fillRect(x, y, 6 + rng() * 14, 4 + rng() * 9);
        const hv = Math.floor(105 + rng() * 65);
        hCtx.fillStyle = `rgb(${hv},${hv},${hv})`;
        hCtx.fillRect(x, y, 5, 4);
      }
    }

    const map = finalizeTexture(albedoC, true, this.anisotropy, 1, 1);
    const normalMap = createNormalFromHeight(heightC, 1.9, this.anisotropy);
    const roughnessMap = finalizeTexture(roughC, false, this.anisotropy, 1, 1);
    this.disposables.push(map, normalMap, roughnessMap);
    return { map, normalMap, roughnessMap };
  }

  private createSkyscraperSet(
    glassHex: string,
    mullionHex: string,
    seed: number,
    style = 0,
  ): PBRTextureSet {
    const size = Math.min(512, this.res);
    const rng = mulberry32(seed);

    const albedoC = document.createElement('canvas');
    albedoC.width = size;
    albedoC.height = size;
    const aCtx = albedoC.getContext('2d')!;

    const heightC = document.createElement('canvas');
    heightC.width = size;
    heightC.height = size;
    const hCtx = heightC.getContext('2d')!;

    const roughC = document.createElement('canvas');
    roughC.width = size;
    roughC.height = size;
    const rCtx = roughC.getContext('2d')!;

    const emissiveC = document.createElement('canvas');
    emissiveC.width = size;
    emissiveC.height = size;
    const eCtx = emissiveC.getContext('2d')!;

    aCtx.fillStyle = mullionHex;
    aCtx.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#d4d4d4';
    hCtx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#848484';
    rCtx.fillRect(0, 0, size, size);
    eCtx.fillStyle = '#000000';
    eCtx.fillRect(0, 0, size, size);

    const floors = style === 1 ? 14 : style === 3 ? 12 : 16;
    const bays = style === 2 ? 6 : style === 3 ? 10 : 8;
    const fh = size / floors;
    const bw = size / bays;

    for (let f = 0; f < floors; f++) {
      const fy = f * fh;
      // Floor-slab spandrel shadow box strip (authentic real-world high-rise floor plate separation!)
      const spandrelH = fh * (style === 1 ? 0.34 : 0.24);
      aCtx.fillStyle = 'rgba(18, 22, 28, 0.42)';
      aCtx.fillRect(0, fy, size, spandrelH * 0.72);
      hCtx.fillStyle = '#e8e8e8';
      hCtx.fillRect(0, fy, size, spandrelH * 0.85);

      // Occasional full-floor executive lights or mechanical louver floor
      const floorActivity = rng();
      const isMechanicalFloor = f === Math.floor(floors * 0.5) && style === 2;

      for (let b = 0; b < bays; b++) {
        const bx = b * bw;
        const padX = bw * (style === 3 ? 0.16 : 0.1);
        const padTop = spandrelH;
        const padBot = fh * 0.08;
        const ww = bw - padX * 2;
        const wh = fh - padTop - padBot;

        if (isMechanicalFloor) {
          // Dark slatted mechanical louver vents
          aCtx.fillStyle = '#181c22';
          aCtx.fillRect(bx + padX, fy + padTop, ww, wh);
          aCtx.fillStyle = 'rgba(160,170,180,0.22)';
          for (let ly = 0; ly < wh; ly += 4) {
            aCtx.fillRect(bx + padX, fy + padTop + ly, ww, 1.5);
          }
          rCtx.fillStyle = '#b4b4b4';
          rCtx.fillRect(bx + padX, fy + padTop, ww, wh);
          continue;
        }

        // Deep architectural glass gradient (sky reflection upper half -> deep interior lower half)
        const gGrad = aCtx.createLinearGradient(bx, fy + padTop, bx, fy + padTop + wh);
        gGrad.addColorStop(0.0, glassHex);
        gGrad.addColorStop(0.45, '#12202d');
        gGrad.addColorStop(1.0, '#0a1017');
        aCtx.fillStyle = gGrad;
        aCtx.fillRect(bx + padX, fy + padTop, ww, wh);

        // Subtle diagonal sky sheen & interior venetian blind drop variation
        aCtx.fillStyle = `rgba(210, 232, 248, ${0.07 + rng() * 0.14})`;
        aCtx.fillRect(bx + padX, fy + padTop, ww, wh * (0.28 + rng() * 0.25));

        if (rng() > 0.45) {
          const blindH = wh * (0.22 + rng() * 0.35);
          aCtx.fillStyle = 'rgba(186, 180, 168, 0.22)';
          aCtx.fillRect(bx + padX + 1, fy + padTop + 1, ww - 2, blindH);
        }

        // Recessed window depth + mirror-like glass roughness
        hCtx.fillStyle = '#363636';
        hCtx.fillRect(bx + padX, fy + padTop, ww, wh);
        rCtx.fillStyle = '#121212';
        rCtx.fillRect(bx + padX, fy + padTop, ww, wh);

        // Coherent corporate floorplate lighting (clusters of adjacent lit offices look way more photorealistic than TV static!)
        const litChance = floorActivity > 0.65 ? 0.32 : 0.64;
        if (rng() > litChance) {
          const isWarm = rng() > 0.35;
          const intensity = 0.42 + rng() * 0.56;
          const eGrad = eCtx.createLinearGradient(bx, fy + padTop, bx, fy + padTop + wh);
          if (isWarm) {
            eGrad.addColorStop(0.0, `rgba(255, 224, 164, ${intensity})`);
            eGrad.addColorStop(0.65, `rgba(235, 182, 112, ${intensity * 0.65})`);
            eGrad.addColorStop(1.0, `rgba(120, 88, 52, ${intensity * 0.25})`);
          } else {
            eGrad.addColorStop(0.0, `rgba(205, 232, 255, ${intensity * 0.92})`);
            eGrad.addColorStop(0.65, `rgba(155, 198, 235, ${intensity * 0.55})`);
            eGrad.addColorStop(1.0, `rgba(75, 102, 130, ${intensity * 0.2})`);
          }
          eCtx.fillStyle = eGrad;
          eCtx.fillRect(bx + padX + 1, fy + padTop + 1, ww - 2, wh - 2);
        }
      }
    }

    const map = finalizeTexture(albedoC, true, this.anisotropy, 1, 2);
    const normalMap = createNormalFromHeight(heightC, 1.85, this.anisotropy);
    normalMap.repeat.set(1, 2);
    const roughnessMap = finalizeTexture(roughC, false, this.anisotropy, 1, 2);
    const emissiveMap = finalizeTexture(emissiveC, true, this.anisotropy, 1, 2);
    this.disposables.push(map, normalMap, roughnessMap, emissiveMap);
    return { map, normalMap, roughnessMap, emissiveMap };
  }

  private createTireTreadSet(): PBRTextureSet {
    const size = 256;
    const albedoC = document.createElement('canvas');
    albedoC.width = size;
    albedoC.height = size;
    const aCtx = albedoC.getContext('2d')!;
    const heightC = document.createElement('canvas');
    heightC.width = size;
    heightC.height = size;
    const hCtx = heightC.getContext('2d')!;
    const roughC = document.createElement('canvas');
    roughC.width = size;
    roughC.height = size;
    const rCtx = roughC.getContext('2d')!;

    aCtx.fillStyle = '#1a1b1c';
    aCtx.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#606060';
    hCtx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#dbdbdb';
    rCtx.fillRect(0, 0, size, size);

    // Chevron tire tread ribs
    aCtx.strokeStyle = '#2a2c2e';
    hCtx.strokeStyle = '#d8d8d8';
    aCtx.lineWidth = 6;
    hCtx.lineWidth = 6;
    for (let y = 0; y < size; y += 18) {
      aCtx.beginPath();
      aCtx.moveTo(0, y);
      aCtx.lineTo(size * 0.5, y + 10);
      aCtx.lineTo(size, y);
      aCtx.stroke();

      hCtx.beginPath();
      hCtx.moveTo(0, y);
      hCtx.lineTo(size * 0.5, y + 10);
      hCtx.lineTo(size, y);
      hCtx.stroke();
    }

    const map = finalizeTexture(albedoC, true, this.anisotropy, 1, 4);
    const normalMap = createNormalFromHeight(heightC, 2.2, this.anisotropy);
    normalMap.repeat.set(1, 4);
    const roughnessMap = finalizeTexture(roughC, false, this.anisotropy, 1, 4);
    this.disposables.push(map, normalMap, roughnessMap);
    return { map, normalMap, roughnessMap };
  }

  private createPalmBarkSet(): PBRTextureSet {
    const size = 512;
    const rng = mulberry32(8080);
    const albedoC = document.createElement('canvas');
    albedoC.width = size;
    albedoC.height = size;
    const aCtx = albedoC.getContext('2d')!;
    const heightC = document.createElement('canvas');
    heightC.width = size;
    heightC.height = size;
    const hCtx = heightC.getContext('2d')!;
    const roughC = document.createElement('canvas');
    roughC.width = size;
    roughC.height = size;
    const rCtx = roughC.getContext('2d')!;

    // Base weathered California palm bark (warm silver-taupe & sun-baked fibrous umber)
    aCtx.fillStyle = '#6c5a4a';
    aCtx.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#787878';
    hCtx.fillRect(0, 0, size, size);
    rCtx.fillStyle = '#e2e2e2';
    rCtx.fillRect(0, 0, size, size);

    // 1. Overlapping woven diamond petiole-boot leaf scars (authentic Washingtonia / Phoenix texture)
    const rows = 26;
    const rowH = size / rows;
    for (let r = 0; r < rows; r++) {
      const baseY = r * rowH;
      const cols = 7;
      const colW = size / cols;
      const xShift = (r % 2) * (colW * 0.5);

      for (let c = -1; c <= cols + 1; c++) {
        const cx = c * colW + xShift;
        const cy = baseY + (rng() - 0.5) * 3.0;
        const w = colW * (0.95 + rng() * 0.16);
        const h = rowH * (1.28 + rng() * 0.22);

        const tone = rng();
        const cr = Math.floor(86 + tone * 44);
        const cg = Math.floor(72 + tone * 38);
        const cb = Math.floor(58 + tone * 32);

        // Diamond-arch scale body
        aCtx.beginPath();
        aCtx.moveTo(cx - w * 0.5, cy + h * 0.35);
        aCtx.quadraticCurveTo(cx, cy - h * 0.52, cx + w * 0.5, cy + h * 0.35);
        aCtx.quadraticCurveTo(cx, cy + h * 0.65, cx - w * 0.5, cy + h * 0.35);
        aCtx.closePath();

        const grad = aCtx.createLinearGradient(cx, cy - h * 0.4, cx, cy + h * 0.55);
        grad.addColorStop(0.0, `rgb(${Math.min(255, cr + 24)},${Math.min(255, cg + 22)},${Math.min(255, cb + 20)})`);
        grad.addColorStop(0.55, `rgb(${cr},${cg},${cb})`);
        grad.addColorStop(1.0, `rgb(${Math.max(18, cr - 44)},${Math.max(14, cg - 38)},${Math.max(12, cb - 32)})`);
        aCtx.fillStyle = grad;
        aCtx.fill();

        // Dark recessed shadow crevice beneath each leaf scar
        aCtx.strokeStyle = 'rgba(26, 20, 15, 0.72)';
        aCtx.lineWidth = 2.4;
        aCtx.stroke();

        // Matching height relief (protruding upper ridge, deep lower undercut)
        hCtx.beginPath();
        hCtx.moveTo(cx - w * 0.5, cy + h * 0.35);
        hCtx.quadraticCurveTo(cx, cy - h * 0.52, cx + w * 0.5, cy + h * 0.35);
        hCtx.quadraticCurveTo(cx, cy + h * 0.65, cx - w * 0.5, cy + h * 0.35);
        hCtx.closePath();
        const hGrad = hCtx.createLinearGradient(cx, cy - h * 0.4, cx, cy + h * 0.55);
        hGrad.addColorStop(0.0, '#e8e8e8');
        hGrad.addColorStop(0.6, '#a0a0a0');
        hGrad.addColorStop(1.0, '#2a2a2a');
        hCtx.fillStyle = hGrad;
        hCtx.fill();
        hCtx.strokeStyle = '#181818';
        hCtx.lineWidth = 2.5;
        hCtx.stroke();
      }
    }

    // 2. Vertical fibrous weathered bark strands & sun-bleached cracks
    for (let i = 0; i < 650; i++) {
      const fx = rng() * size;
      const fy = rng() * size;
      const fl = 14 + rng() * 44;
      const light = rng() > 0.48;
      aCtx.strokeStyle = light
        ? `rgba(178, 162, 144, ${0.14 + rng() * 0.18})`
        : `rgba(38, 28, 20, ${0.22 + rng() * 0.24})`;
      aCtx.lineWidth = 0.8 + rng() * 1.4;
      aCtx.beginPath();
      aCtx.moveTo(fx, fy);
      aCtx.lineTo(fx + (rng() - 0.5) * 3.5, fy + fl);
      aCtx.stroke();

      hCtx.strokeStyle = light ? 'rgba(220,220,220,0.35)' : 'rgba(30,30,30,0.45)';
      hCtx.lineWidth = 1.0;
      hCtx.beginPath();
      hCtx.moveTo(fx, fy);
      hCtx.lineTo(fx + (rng() - 0.5) * 3.5, fy + fl);
      hCtx.stroke();

      rCtx.strokeStyle = light ? 'rgba(248,248,248,0.4)' : 'rgba(185,185,185,0.4)';
      rCtx.beginPath();
      rCtx.moveTo(fx, fy);
      rCtx.lineTo(fx, fy + fl);
      rCtx.stroke();
    }

    const map = finalizeTexture(albedoC, true, this.anisotropy, 1, 5.5);
    const normalMap = createNormalFromHeight(heightC, 2.8, this.anisotropy);
    normalMap.repeat.set(1, 5.5);
    const roughnessMap = finalizeTexture(roughC, false, this.anisotropy, 1, 5.5);
    this.disposables.push(map, normalMap, roughnessMap);
    return { map, normalMap, roughnessMap };
  }

  private createPalmFrondSet(): PBRTextureSet {
    const w = 512;
    const h = 1024;
    const rng = mulberry32(9104);

    const albedoC = document.createElement('canvas');
    albedoC.width = w;
    albedoC.height = h;
    const aCtx = albedoC.getContext('2d')!;

    const heightC = document.createElement('canvas');
    heightC.width = w;
    heightC.height = h;
    const hCtx = heightC.getContext('2d')!;

    const roughC = document.createElement('canvas');
    roughC.width = w;
    roughC.height = h;
    const rCtx = roughC.getContext('2d')!;

    aCtx.clearRect(0, 0, w, h);
    hCtx.fillStyle = '#000000';
    hCtx.fillRect(0, 0, w, h);
    rCtx.fillStyle = '#a0a0a0';
    rCtx.fillRect(0, 0, w, h);

    // 1. Sculpted 92 Lanceolate Pinnate Leaflets (46 pairs) with sharp tapered tips, midrib veins & waxy cuticle
    const pairs = 46;
    for (let i = 0; i < pairs; i++) {
      const t = i / (pairs - 1);
      // Leaflets start above woody basal petiole (y = h * 0.87) and reach tip (y = 24)
      const baseY = h * 0.875 - t * (h * 0.845);

      // Authentic botanical canopy envelope (narrower at petiole base, broad through mid-blade, fine crown tip)
      const env = Math.sin(Math.pow(t, 0.72) * Math.PI * 0.94 + 0.08);
      const baseSpan = env * (w * 0.475);

      for (const side of [-1, 1]) {
        const lenJitter = 0.9 + rng() * 0.18;
        // Occasional natural wind-split shorter leaflet for organic California realism
        const windClip = rng() < 0.07 ? 0.68 : 1.0;
        const span = baseSpan * lenJitter * windClip;
        if (span < 14) continue;

        const rise = 46 + (1.0 - t) * 28 + (rng() - 0.5) * 14;
        const droopTip = -14 + t * 24 + (rng() - 0.5) * 10;
        const bladeHalfW = (7.2 - t * 3.8) * (0.88 + rng() * 0.24);

        const sx = w * 0.5 + side * 4;
        const sy = baseY + (side === 1 ? -4 : 0);
        const cx = sx + side * span * 0.54;
        const cy = sy - rise * 0.68;
        const ex = sx + side * span;
        const ey = sy - rise + droopTip;

        // Upper edge & lower edge of curved lanceolate blade polygon
        const topCx = cx;
        const topCy = cy - bladeHalfW * 1.15;
        const botCx = cx;
        const botCy = cy + bladeHalfW * 1.05;

        // Rich chlorophyll gradient: deep shaded base -> lush California emerald -> sunlit olive/chartreuse tip
        const gGrad = aCtx.createLinearGradient(sx, sy, ex, ey);
        const hueShift = Math.floor((rng() - 0.5) * 18);
        const dryTip = rng() < 0.22;
        gGrad.addColorStop(0.0, `rgb(${44 + hueShift}, ${76 + hueShift}, 26)`);
        gGrad.addColorStop(0.38, `rgb(${64 + hueShift}, ${112 + hueShift}, 36)`);
        gGrad.addColorStop(0.78, `rgb(${84 + hueShift}, ${130 + hueShift}, 44)`);
        gGrad.addColorStop(
          1.0,
          dryTip
            ? `rgb(${136 + hueShift}, ${134 + hueShift}, 58)`
            : `rgb(${98 + hueShift}, ${142 + hueShift}, 48)`,
        );

        aCtx.beginPath();
        aCtx.moveTo(sx, sy - bladeHalfW * 0.55);
        aCtx.quadraticCurveTo(topCx, topCy, ex, ey);
        aCtx.quadraticCurveTo(botCx, botCy, sx, sy + bladeHalfW * 0.55);
        aCtx.closePath();
        aCtx.fillStyle = gGrad;
        aCtx.fill();

        // Subtle dark lower blade shadow along the bottom fold for 3D depth
        aCtx.beginPath();
        aCtx.moveTo(sx, sy);
        aCtx.quadraticCurveTo(cx, cy + bladeHalfW * 0.35, ex, ey);
        aCtx.quadraticCurveTo(botCx, botCy, sx, sy + bladeHalfW * 0.55);
        aCtx.closePath();
        aCtx.fillStyle = 'rgba(20, 38, 12, 0.26)';
        aCtx.fill();

        // Crisp sunlit longitudinal central midrib vein on each leaflet
        aCtx.strokeStyle = `rgba(${132 + hueShift}, ${172 + hueShift}, 68, 0.72)`;
        aCtx.lineWidth = Math.max(1.0, bladeHalfW * 0.22);
        aCtx.beginPath();
        aCtx.moveTo(sx, sy);
        aCtx.quadraticCurveTo(cx, cy, ex, ey);
        aCtx.stroke();

        // Height map: V-folded convex ridge along each leaflet midrib
        hCtx.beginPath();
        hCtx.moveTo(sx, sy - bladeHalfW * 0.55);
        hCtx.quadraticCurveTo(topCx, topCy, ex, ey);
        hCtx.quadraticCurveTo(botCx, botCy, sx, sy + bladeHalfW * 0.55);
        hCtx.closePath();
        hCtx.fillStyle = '#747474';
        hCtx.fill();

        hCtx.strokeStyle = '#dcdcdc';
        hCtx.lineWidth = Math.max(1.5, bladeHalfW * 0.55);
        hCtx.beginPath();
        hCtx.moveTo(sx, sy);
        hCtx.quadraticCurveTo(cx, cy, ex, ey);
        hCtx.stroke();

        // Roughness map: waxy glossy cuticle along upper blade (0.36-0.46), matte at dry tips
        rCtx.beginPath();
        rCtx.moveTo(sx, sy - bladeHalfW * 0.55);
        rCtx.quadraticCurveTo(topCx, topCy, ex, ey);
        rCtx.quadraticCurveTo(botCx, botCy, sx, sy + bladeHalfW * 0.55);
        rCtx.closePath();
        rCtx.fillStyle = dryTip ? '#8e8e8e' : '#646464';
        rCtx.fill();
      }
    }

    // 2. Central Woody Petiole & Tapered Rachis Spine (fibrous olive-tan base -> bright lime-green spine)
    const spineGrad = aCtx.createLinearGradient(0, h, 0, 20);
    spineGrad.addColorStop(0.0, '#6b5c34');
    spineGrad.addColorStop(0.16, '#6e7b32');
    spineGrad.addColorStop(0.55, '#7e9c38');
    spineGrad.addColorStop(1.0, '#96b446');

    aCtx.beginPath();
    aCtx.moveTo(w * 0.5 - 11, h);
    aCtx.lineTo(w * 0.5 - 7.5, h * 0.84);
    aCtx.lineTo(w * 0.5 - 2.0, 22);
    aCtx.lineTo(w * 0.5 + 2.0, 22);
    aCtx.lineTo(w * 0.5 + 7.5, h * 0.84);
    aCtx.lineTo(w * 0.5 + 11, h);
    aCtx.closePath();
    aCtx.fillStyle = spineGrad;
    aCtx.fill();

    // Central highlight groove along rachis
    aCtx.strokeStyle = 'rgba(205, 220, 118, 0.55)';
    aCtx.lineWidth = 2.4;
    aCtx.beginPath();
    aCtx.moveTo(w * 0.5, h - 8);
    aCtx.lineTo(w * 0.5, 28);
    aCtx.stroke();

    // Raised height profile for central rachis
    hCtx.beginPath();
    hCtx.moveTo(w * 0.5 - 11, h);
    hCtx.lineTo(w * 0.5 - 2.2, 22);
    hCtx.lineTo(w * 0.5 + 2.2, 22);
    hCtx.lineTo(w * 0.5 + 11, h);
    hCtx.closePath();
    hCtx.fillStyle = '#f2f2f2';
    hCtx.fill();

    // Woody petiole is rougher/more matte than waxy leaflets
    rCtx.fillStyle = '#c8c8c8';
    rCtx.fillRect(w * 0.5 - 11, h * 0.82, 22, h * 0.18);

    const map = new THREE.CanvasTexture(albedoC);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = this.anisotropy;
    const normalMap = createNormalFromHeight(heightC, 1.8, this.anisotropy);
    const roughnessMap = new THREE.CanvasTexture(roughC);
    roughnessMap.anisotropy = this.anisotropy;

    this.disposables.push(map, normalMap, roughnessMap);
    return { map, normalMap, roughnessMap };
  }

  private createDeadPalmFrondSet(): PBRTextureSet {
    const w = 256;
    const h = 512;
    const rng = mulberry32(9207);

    const albedoC = document.createElement('canvas');
    albedoC.width = w;
    albedoC.height = h;
    const aCtx = albedoC.getContext('2d')!;

    const heightC = document.createElement('canvas');
    heightC.width = w;
    heightC.height = h;
    const hCtx = heightC.getContext('2d')!;

    const roughC = document.createElement('canvas');
    roughC.width = w;
    roughC.height = h;
    const rCtx = roughC.getContext('2d')!;

    aCtx.clearRect(0, 0, w, h);
    hCtx.fillStyle = '#000000';
    hCtx.fillRect(0, 0, w, h);
    rCtx.fillStyle = '#eaeaea';
    rCtx.fillRect(0, 0, w, h);

    // Dense shaggy hanging dried golden-straw & cinnamon fibrous strips (Washingtonia petticoat skirt)
    for (let i = 0; i < 64; i++) {
      const t = i / 63;
      const sx = w * 0.5 + (rng() - 0.5) * (w * 0.42);
      const sy = 10 + t * (h * 0.32);
      const side = sx < w * 0.5 ? -1 : 1;
      const spread = (18 + rng() * 78) * side;
      const len = h * (0.45 + rng() * 0.48);
      const bw = 3.0 + rng() * 5.2;

      const shade = rng();
      const cr = Math.floor(118 + shade * 56);
      const cg = Math.floor(90 + shade * 46);
      const cb = Math.floor(54 + shade * 32);

      const ex = Math.max(8, Math.min(w - 8, sx + spread));
      const ey = Math.min(h - 6, sy + len);
      const cx = sx + spread * 0.48 + (rng() - 0.5) * 18;
      const cy = sy + len * 0.52;

      aCtx.beginPath();
      aCtx.moveTo(sx - bw * 0.6, sy);
      aCtx.quadraticCurveTo(cx - bw * 0.35, cy, ex, ey);
      aCtx.quadraticCurveTo(cx + bw * 0.45, cy, sx + bw * 0.6, sy);
      aCtx.closePath();
      const grad = aCtx.createLinearGradient(sx, sy, ex, ey);
      grad.addColorStop(0.0, `rgb(${Math.max(40, cr - 34)},${Math.max(30, cg - 28)},${Math.max(18, cb - 20)})`);
      grad.addColorStop(0.55, `rgb(${cr},${cg},${cb})`);
      grad.addColorStop(1.0, `rgb(${Math.min(230, cr + 28)},${Math.min(210, cg + 24)},${Math.min(170, cb + 20)})`);
      aCtx.fillStyle = grad;
      aCtx.fill();

      hCtx.beginPath();
      hCtx.moveTo(sx - bw * 0.6, sy);
      hCtx.quadraticCurveTo(cx - bw * 0.35, cy, ex, ey);
      hCtx.quadraticCurveTo(cx + bw * 0.45, cy, sx + bw * 0.6, sy);
      hCtx.closePath();
      hCtx.fillStyle = shade > 0.5 ? '#c8c8c8' : '#7a7a7a';
      hCtx.fill();
    }

    // Dried fibrous woody stem spine
    aCtx.strokeStyle = '#5c442c';
    aCtx.lineWidth = 6;
    aCtx.beginPath();
    aCtx.moveTo(w * 0.5, 6);
    aCtx.lineTo(w * 0.5, h * 0.72);
    aCtx.stroke();

    const map = new THREE.CanvasTexture(albedoC);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = this.anisotropy;
    const normalMap = createNormalFromHeight(heightC, 2.0, this.anisotropy);
    const roughnessMap = new THREE.CanvasTexture(roughC);
    roughnessMap.anisotropy = this.anisotropy;

    this.disposables.push(map, normalMap, roughnessMap);
    return { map, normalMap, roughnessMap };
  }

  private createBotanicalLeafClusterTexture(isJacaranda: boolean): THREE.CanvasTexture {
    const size = 256;
    const rng = mulberry32(isJacaranda ? 7411 : 7422);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, size, size);

    // Subtle dark interior twig web
    ctx.strokeStyle = '#3d3024';
    ctx.lineWidth = 3;
    for (let b = 0; b < 7; b++) {
      const a = (b / 7) * Math.PI * 2 + rng() * 0.4;
      ctx.beginPath();
      ctx.moveTo(size * 0.5, size * 0.5);
      ctx.lineTo(size * 0.5 + Math.cos(a) * 90, size * 0.5 + Math.sin(a) * 90);
      ctx.stroke();
    }

    // Hundreds of overlapping organic leaves / lavender Jacaranda blossoms
    for (let i = 0; i < 240; i++) {
      const r = Math.sqrt(rng()) * (size * 0.43);
      const a = rng() * Math.PI * 2;
      const x = size * 0.5 + Math.cos(a) * r;
      const y = size * 0.5 + Math.sin(a) * r;
      const rx = 5 + rng() * 9;
      const ry = 3 + rng() * 5;
      const rot = rng() * Math.PI;
      const shade = 0.72 + rng() * 0.45;

      if (isJacaranda) {
        const isGreenHint = rng() < 0.2;
        if (isGreenHint) {
          ctx.fillStyle = `rgb(${Math.floor(58 * shade)},${Math.floor(88 * shade)},${Math.floor(46 * shade)})`;
        } else {
          ctx.fillStyle = `rgb(${Math.floor(118 * shade)},${Math.floor(92 * shade)},${Math.floor(168 * shade)})`;
        }
      } else {
        ctx.fillStyle = `rgb(${Math.floor(62 * shade)},${Math.floor(96 * shade)},${Math.floor(46 * shade)})`;
      }

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    this.disposables.push(tex);
    return tex;
  }

  private createFabricNormalMap(): THREE.CanvasTexture {
    const size = 128;
    const hC = document.createElement('canvas');
    hC.width = size;
    hC.height = size;
    const ctx = hC.getContext('2d')!;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 2) {
      for (let x = 0; x < size; x += 2) {
        const weave = ((x + y) % 4 === 0) ? 148 : 108;
        ctx.fillStyle = `rgb(${weave},${weave},${weave})`;
        ctx.fillRect(x, y, 2, 2);
      }
    }
    const n = createNormalFromHeight(hC, 1.35, this.anisotropy);
    n.repeat.set(8, 8);
    return n;
  }

  private createCarFlakeNormalMap(): THREE.CanvasTexture {
    const size = 128;
    const rng = mulberry32(9191);
    const hC = document.createElement('canvas');
    hC.width = size;
    hC.height = size;
    const ctx = hC.getContext('2d')!;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 3200; i++) {
      const v = Math.floor(110 + rng() * 38);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(rng() * size, rng() * size, 1.5, 1.5);
    }
    const n = createNormalFromHeight(hC, 0.8, this.anisotropy);
    n.repeat.set(10, 10);
    return n;
  }

  private createContactShadowTexture(): THREE.CanvasTexture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    grad.addColorStop(0, 'rgba(6, 5, 4, 0.72)');
    grad.addColorStop(0.55, 'rgba(6, 5, 4, 0.34)');
    grad.addColorStop(1, 'rgba(6, 5, 4, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }

  private createCarbonFiberMaterial(): THREE.MeshPhysicalMaterial {
    const size = 128;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#181a1e';
    ctx.fillRect(0, 0, size, size);
    const cell = 8;
    for (let y = 0; y < size; y += cell) {
      for (let x = 0; x < size; x += cell) {
        const alt = ((x + y) / cell) % 2 === 0;
        ctx.fillStyle = alt ? '#282c33' : '#141619';
        ctx.fillRect(x, y, cell - 1, cell - 1);
      }
    }
    const map = finalizeTexture(c, true, this.anisotropy, 6, 6);
    const normalMap = createNormalFromHeight(c, 1.4, this.anisotropy);
    normalMap.repeat.set(6, 6);
    this.disposables.push(map, normalMap);
    return new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map,
      normalMap,
      normalScale: new THREE.Vector2(0.7, 0.7),
      metalness: 0.45,
      roughness: 0.28,
      clearcoat: 0.95,
      clearcoatRoughness: 0.08,
      envMapIntensity: 0.9,
    });
  }

  private createAwningFabricMaterial(
    stripeA = '#7d2820',
    stripeB = '#d8cfc0',
  ): THREE.MeshStandardMaterial {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    const stripes = 8;
    const sw = size / stripes;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? stripeA : stripeB;
      ctx.fillRect(i * sw, 0, sw, size);
    }
    // Subtle sun fade, stitched hem & fabric grain
    ctx.fillStyle = 'rgba(20,16,12,0.16)';
    ctx.fillRect(0, size * 0.84, size, size * 0.16);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, size * 0.84);
    ctx.lineTo(size, size * 0.84);
    ctx.stroke();

    const map = finalizeTexture(c, true, this.anisotropy, 3, 1);
    this.disposables.push(map);
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map,
      roughness: 0.9,
      metalness: 0.02,
      envMapIntensity: 0.25,
    });
  }

  private createLicensePlateMaterial(): THREE.MeshStandardMaterial {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#e8e2d4';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#1f4478';
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, 244, 116);
    ctx.fillStyle = '#b84226';
    ctx.font = 'bold 24px Oswald, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SAN ANDREAS', 128, 36);
    ctx.fillStyle = '#183766';
    ctx.font = 'bold 52px Impact, Oswald, sans-serif';
    ctx.fillText('GROVE 92', 128, 94);
    const tex = finalizeTexture(c, true, this.anisotropy, 1, 1);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    this.disposables.push(tex);
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: tex,
      roughness: 0.42,
      metalness: 0.22,
      envMapIntensity: 0.45,
    });
  }

  private createCrosswalkMaterial(): THREE.MeshStandardMaterial {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 128);
    const rng = mulberry32(4242);
    for (let i = 0; i < 6; i++) {
      const x = 14 + i * 40;
      ctx.fillStyle = 'rgba(222, 217, 205, 0.74)';
      ctx.fillRect(x, 12, 22, 104);
      // Longitudinal tire-track abrasion across crosswalk paint (realistic wheel wear, not dots)
      ctx.fillStyle = 'rgba(54, 55, 59, 0.32)';
      ctx.fillRect(x, 28, 22, 14);
      ctx.fillRect(x, 76, 22, 16);
      for (let s = 0; s < 16; s++) {
        ctx.fillStyle = 'rgba(54, 55, 59, 0.24)';
        ctx.fillRect(x, 12 + rng() * 100, 22, 1.5);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    this.disposables.push(tex);
    return new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      roughness: 0.88,
      metalness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      depthWrite: false,
    });
  }

  private createInteriorWindowMaterial(
    kind: InteriorWindowKind,
    uniforms: SharedWeatherUniforms,
  ): THREE.MeshPhysicalMaterial {
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x16202a,
      roughness: 0.08,
      metalness: 0.14,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      ior: 1.52,
      reflectivity: 0.92,
      envMapIntensity: 0.75,
    });
    applyInteriorMappingShader(mat, uniforms, kind);
    return mat;
  }

  private createStormDrainMaterial(): THREE.MeshStandardMaterial {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#343638';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#4e5054';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 122, 122);
    ctx.fillStyle = '#0d0e10';
    for (let y = 14; y < 114; y += 14) {
      ctx.fillRect(14, y, 42, 7);
      ctx.fillRect(72, y, 42, 7);
    }
    const tex = finalizeTexture(c, true, this.anisotropy, 1, 1);
    this.disposables.push(tex);
    return new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.65,
      metalness: 0.72,
    });
  }

  private createGasForecourtMaterial(
    uniforms: SharedWeatherUniforms,
  ): THREE.MeshPhysicalMaterial {
    const size = 512;
    const rng = mulberry32(9901);
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#8b867d';
    ctx.fillRect(0, 0, size, size);

    // Concrete grain
    for (let i = 0; i < 4000; i++) {
      const v = Math.floor(118 + rng() * 38);
      ctx.fillStyle = `rgba(${v},${v - 3},${v - 7},0.4)`;
      ctx.fillRect(rng() * size, rng() * size, 2 + rng() * 3, 2 + rng() * 3);
    }
    // Expansion joints
    ctx.strokeStyle = 'rgba(46,44,40,0.62)';
    ctx.lineWidth = 2.5;
    for (let i = 0; i <= 4; i++) {
      const p = (i * size) / 4;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
      ctx.stroke();
    }
    // Authentic oil & diesel drip stains near pump bays
    const stains = [
      [140, 190, 38],
      [360, 210, 44],
      [250, 340, 32],
      [155, 360, 28],
    ];
    for (const [sx, sy, sr] of stains) {
      const g = ctx.createRadialGradient(sx, sy, 2, sx, sy, sr);
      g.addColorStop(0, 'rgba(26,24,22,0.52)');
      g.addColorStop(0.55, 'rgba(38,35,30,0.24)');
      g.addColorStop(1, 'rgba(38,35,30,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    }
    const map = finalizeTexture(c, true, this.anisotropy, 3, 2);
    this.disposables.push(map);
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map,
      roughness: 0.88,
      metalness: 0.02,
      clearcoat: 0.05,
    });
    applyHyperrealWetSurfaceShader(mat, uniforms, {
      puddleStrength: 0.55,
      microDetailScale: 14.0,
    });
    return mat;
  }

  private createGasFasciaMaterial(): THREE.MeshStandardMaterial {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    const ctx = c.getContext('2d')!;
    // Deep Crimson California station fascia with crisp white & amber accent stripe
    ctx.fillStyle = '#991d1b';
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = '#e8e2d5';
    ctx.fillRect(0, 72, 512, 10);
    ctx.fillStyle = '#e89d2c';
    ctx.fillRect(0, 82, 512, 14);

    ctx.fillStyle = '#fff9f0';
    ctx.font = 'bold 42px Impact, Oswald, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('XOOMER  ·  24/7 FUEL', 256, 38);

    const tex = finalizeTexture(c, true, this.anisotropy, 1, 1);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    this.disposables.push(tex);
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: tex,
      emissive: new THREE.Color(0xffb080),
      emissiveMap: tex,
      emissiveIntensity: 0.48,
      roughness: 0.32,
      metalness: 0.2,
    });
  }

  private createGasPylonMaterial(): THREE.MeshStandardMaterial {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 512;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#15181c';
    ctx.fillRect(0, 0, 256, 512);
    ctx.strokeStyle = '#484d54';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, 248, 504);

    // Top red brand box
    ctx.fillStyle = '#a8221e';
    ctx.fillRect(10, 12, 236, 98);
    ctx.fillStyle = '#fff6e8';
    ctx.font = 'bold 48px Impact, Oswald, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('XOOMER', 128, 72);
    ctx.fillStyle = '#ffd573';
    ctx.font = 'bold 18px Oswald, sans-serif';
    ctx.fillText('LOS SANTOS · SELF SERVE', 128, 99);

    // Illuminated retro digital gas prices (1992 San Andreas era!)
    const rows = [
      { label: 'UNLEADED', price: '1.29⁹', col: '#ff5244' },
      { label: 'PLUS 89', price: '1.39⁹', col: '#ffb844' },
      { label: 'SUPREME', price: '1.49⁹', col: '#6ce87a' },
      { label: 'DIESEL', price: '1.19⁹', col: '#6ce87a' },
    ];
    rows.forEach((r, idx) => {
      const y = 132 + idx * 82;
      ctx.fillStyle = '#0a0c0e';
      ctx.fillRect(16, y, 224, 68);
      ctx.strokeStyle = '#2d3138';
      ctx.lineWidth = 2;
      ctx.strokeRect(16, y, 224, 68);
      ctx.fillStyle = '#d4cec2';
      ctx.font = 'bold 17px Oswald, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(r.label, 24, y + 42);
      ctx.fillStyle = r.col;
      ctx.font = 'bold 34px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(r.price, 232, y + 46);
    });

    // Bottom 24H strip
    ctx.fillStyle = '#e09e2e';
    ctx.fillRect(16, 468, 224, 30);
    ctx.fillStyle = '#141312';
    ctx.font = 'bold 19px Oswald, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MINI-MART · OPEN 24 HRS', 128, 490);

    const tex = finalizeTexture(c, true, this.anisotropy, 1, 1);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    this.disposables.push(tex);
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: tex,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: tex,
      emissiveIntensity: 0.72,
      roughness: 0.34,
      metalness: 0.22,
    });
  }

  private createGasPumpScreenMaterial(): THREE.MeshStandardMaterial {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#14171a';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#0a2216';
    ctx.fillRect(10, 14, 108, 34);
    ctx.fillRect(10, 56, 108, 28);
    ctx.fillStyle = '#6cf09a';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('$14.80', 112, 39);
    ctx.fillStyle = '#e8d474';
    ctx.font = 'bold 17px monospace';
    ctx.fillText('11.47 GAL', 112, 76);
    // Grade buttons
    const cols = ['#c7322a', '#d48d24', '#268046'];
    cols.forEach((col, i) => {
      ctx.fillStyle = col;
      ctx.fillRect(12 + i * 36, 94, 30, 22);
    });
    const tex = finalizeTexture(c, true, this.anisotropy, 1, 1);
    this.disposables.push(tex);
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: tex,
      emissive: new THREE.Color(0x9effbc),
      emissiveMap: tex,
      emissiveIntensity: 0.65,
      roughness: 0.25,
      metalness: 0.2,
    });
  }

  private createStorePosterMaterial(): THREE.MeshStandardMaterial {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#183d6b';
    ctx.fillRect(0, 0, 124, 128);
    ctx.fillStyle = '#ffd94a';
    ctx.font = 'bold 34px Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ICE', 62, 54);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px Oswald, sans-serif';
    ctx.fillText('$1.99 BAG', 62, 96);

    ctx.fillStyle = '#9e1f1c';
    ctx.fillRect(132, 0, 124, 128);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px Impact, sans-serif';
    ctx.fillText('COLD', 194, 48);
    ctx.fillText('DRINKS', 194, 80);
    ctx.fillStyle = '#ffe082';
    ctx.font = 'bold 18px Oswald, sans-serif';
    ctx.fillText('OPEN 24H', 194, 110);

    const tex = finalizeTexture(c, true, this.anisotropy, 1, 1);
    this.disposables.push(tex);
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: tex,
      roughness: 0.42,
      metalness: 0.05,
    });
  }

  private createBusShelterAdMaterial(): THREE.MeshStandardMaterial {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 384;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 384);
    g.addColorStop(0, '#0f5e34');
    g.addColorStop(0.55, '#1c8a47');
    g.addColorStop(1, '#0b3820');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 384);

    ctx.fillStyle = '#d4ff6b';
    ctx.font = 'bold 54px Impact, Oswald, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SPRUNK', 128, 128);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px Oswald, sans-serif';
    ctx.fillText('THE ESSENCE OF LIFE', 128, 168);

    // Stylized soda can graphic
    ctx.fillStyle = '#c8f060';
    ctx.fillRect(90, 200, 76, 122);
    ctx.fillStyle = '#186335';
    ctx.fillRect(94, 224, 68, 72);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px Oswald, sans-serif';
    ctx.fillText('LOS SANTOS TRANSIT', 128, 360);

    const tex = finalizeTexture(c, true, this.anisotropy, 1, 1);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    this.disposables.push(tex);
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: tex,
      emissive: new THREE.Color(0xc2ffd0),
      emissiveMap: tex,
      emissiveIntensity: 0.45,
      roughness: 0.22,
      metalness: 0.1,
    });
  }

  private createStopSignMaterial(): THREE.MeshStandardMaterial {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#a61c1c';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#f0ece4';
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, 112, 112);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 38px Impact, Oswald, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STOP', 64, 66);

    const tex = finalizeTexture(c, true, this.anisotropy, 1, 1);
    this.disposables.push(tex);
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: tex,
      roughness: 0.42,
      metalness: 0.25,
    });
  }

  private createWeatheredPaintedMetalMaterial(
    baseHex: string,
    grimeHex: string,
    seed: number,
    uniforms: SharedWeatherUniforms,
  ): THREE.MeshStandardMaterial {
    const size = 256;
    const rng = mulberry32(seed);
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    const hCanvas = document.createElement('canvas');
    hCanvas.width = size;
    hCanvas.height = size;
    const hCtx = hCanvas.getContext('2d')!;

    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, size, size);
    hCtx.fillStyle = '#909090';
    hCtx.fillRect(0, 0, size, size);

    // Chipped paint, rust speckles & vertical rain-drip dirt streaks
    for (let i = 0; i < 650; i++) {
      const x = rng() * size;
      const y = rng() * size;
      const w = 1 + rng() * 5;
      const h = 2 + rng() * 14;
      ctx.fillStyle = rng() > 0.35 ? grimeHex : 'rgba(195,180,165,0.22)';
      ctx.globalAlpha = 0.14 + rng() * 0.28;
      ctx.fillRect(x, y, w, h);
      hCtx.fillStyle = rng() > 0.5 ? '#666666' : '#b8b8b8';
      hCtx.fillRect(x, y, w, h * 0.5);
    }
    ctx.globalAlpha = 1.0;
    // Ground-splash grime band near base
    const grad = ctx.createLinearGradient(0, size * 0.65, 0, size);
    grad.addColorStop(0, 'rgba(28,24,20,0)');
    grad.addColorStop(1, 'rgba(28,24,20,0.58)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, size * 0.65, size, size * 0.35);

    const map = finalizeTexture(c, true, this.anisotropy, 1, 1);
    const normalMap = createNormalFromHeight(hCanvas, 1.4, this.anisotropy);
    this.disposables.push(map, normalMap);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map,
      normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.62,
      metalness: 0.42,
      envMapIntensity: 0.48,
    });
    applyArchitecturalPBRShader(mat, uniforms, { aoHeight: 0.7, microScale: 10.0 });
    return mat;
  }

  private createManholeCoverMaterial(): THREE.MeshStandardMaterial {
    const size = 128;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#2d2b2a';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#4a4542';
    ctx.lineWidth = 4;
    for (let r = 16; r <= 58; r += 14) {
      ctx.beginPath();
      ctx.arc(64, 64, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#3c3835';
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      ctx.fillRect(64 + Math.cos(ang) * 34 - 3, 64 + Math.sin(ang) * 34 - 3, 6, 6);
    }
    const map = finalizeTexture(c, true, this.anisotropy, 1, 1);
    this.disposables.push(map);
    return new THREE.MeshStandardMaterial({
      map,
      roughness: 0.72,
      metalness: 0.68,
      envMapIntensity: 0.45,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
  }

  public dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}
