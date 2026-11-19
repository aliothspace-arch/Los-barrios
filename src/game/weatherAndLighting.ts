import * as THREE from 'three';
import type { TimePreset, WeatherType } from './types';
import type { HyperrealMaterialLibrary, SharedWeatherUniforms } from './textures';
import { createGaussianSoftboxTexture } from './rendering/hypercarBuilders';

interface AtmosphereTarget {
  sunElevation: number;
  sunAzimuth: number;
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  fogColor: THREE.Color;
  fogDensity: number;
  skyZenith: THREE.Color;
  skyMid: THREE.Color;
  skyHorizon: THREE.Color;
  skyGround: THREE.Color;
  antiSunColor: THREE.Color;
  sunDiscStrength: number;
  cloudCoverage: number;
  cloudDarkness: number;
  starVisibility: number;
  wetness: number;
  windStrength: number;
  rainDensity: number;
  nightFactor: number;
  exposure: number;
}

const TIME_CLOCK_HOURS: Record<TimePreset, string> = {
  sunset: '18:20',
  noon: '13:15',
  night: '23:40',
  dawn: '06:35',
};

/**
 * Hybrid AAA Automotive Studio + Open-World California Environment Scene for PMREM IBL.
 * Combines a dark obsidian-slate outdoor enclosure with the exact 3D parametric Gaussian
 * Softbox light ribbons from the Class-A Hypercar reference so every tri-coat body panel,
 * dihedral door, concave forged wheel, and glass facade displays continuous, razor-sharp
 * specular reflection ribbons.
 */
function buildHybridAutomotiveEnvironmentScene(): {
  scene: THREE.Scene;
  textures: THREE.Texture[];
} {
  const envScene = new THREE.Scene();
  const textures: THREE.Texture[] = [];

  // Dark obsidian-slate atmospheric enclosure with subtle horizon gradient
  const domeCanvas = document.createElement('canvas');
  domeCanvas.width = 512;
  domeCanvas.height = 256;
  const ctx = domeCanvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, '#090d16');
  grad.addColorStop(0.32, '#141c2b');
  grad.addColorStop(0.48, '#28252c');
  grad.addColorStop(0.54, '#141218');
  grad.addColorStop(1.0, '#08070a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  const domeTex = new THREE.CanvasTexture(domeCanvas);
  domeTex.colorSpace = THREE.SRGBColorSpace;
  textures.push(domeTex);

  const envBox = new THREE.Mesh(
    new THREE.SphereGeometry(42, 32, 16),
    new THREE.MeshBasicMaterial({ map: domeTex, side: THREE.BackSide }),
  );
  envScene.add(envBox);

  // 3D Parametric Gaussian Softboxes (zero hard edges on clearcoat reflections)
  const softboxWarmTex = createGaussianSoftboxTexture('#fff8f0', '#3c3632');
  const softboxNeutralTex = createGaussianSoftboxTexture('#f7faff', '#303642');
  const softboxCoolTex = createGaussianSoftboxTexture('#d4e6ff', '#25344b');
  textures.push(softboxWarmTex, softboxNeutralTex, softboxCoolTex);

  // 1. Main overhead longitudinal softbox (continuous hood-roof-tail reflection ribbon)
  const topBox = new THREE.Mesh(
    new THREE.PlaneGeometry(8.5, 22),
    new THREE.MeshBasicMaterial({ map: softboxNeutralTex, side: THREE.DoubleSide }),
  );
  topBox.position.set(0, 10.5, 0);
  topBox.rotation.x = Math.PI / 2;
  envScene.add(topBox);

  // 2. Lateral waistline strips (warm left + cool right for dihedral door & haunch sculpting)
  const sideStripL = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 3.0),
    new THREE.MeshBasicMaterial({ map: softboxWarmTex, side: THREE.DoubleSide }),
  );
  sideStripL.position.set(-11.5, 3.4, 0);
  sideStripL.rotation.y = Math.PI / 2;
  sideStripL.rotation.x = 0.14;
  envScene.add(sideStripL);

  const sideStripR = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 3.0),
    new THREE.MeshBasicMaterial({ map: softboxCoolTex, side: THREE.DoubleSide }),
  );
  sideStripR.position.set(11.5, 3.4, 0);
  sideStripR.rotation.y = -Math.PI / 2;
  sideStripR.rotation.x = -0.14;
  envScene.add(sideStripR);

  // 3. 45-degree shoulder softbox arcs
  const arcStripL = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 1.4),
    new THREE.MeshBasicMaterial({ map: softboxWarmTex, side: THREE.DoubleSide }),
  );
  arcStripL.position.set(-7.8, 7.6, 0);
  arcStripL.lookAt(0, 0.7, 0);
  envScene.add(arcStripL);

  const arcStripR = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 1.4),
    new THREE.MeshBasicMaterial({ map: softboxCoolTex, side: THREE.DoubleSide }),
  );
  arcStripR.position.set(7.8, 7.6, 0);
  arcStripR.lookAt(0, 0.7, 0);
  envScene.add(arcStripR);

  // 4. Front & Rear fill softboxes (sculpt nose splitter & rear diffuser / V12 deck)
  const frontBox = new THREE.Mesh(
    new THREE.PlaneGeometry(11, 3.8),
    new THREE.MeshBasicMaterial({ map: softboxWarmTex, side: THREE.DoubleSide }),
  );
  frontBox.position.set(0, 4.6, 13.5);
  frontBox.lookAt(0, 0.6, 0);
  envScene.add(frontBox);

  const backBox = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 4.2),
    new THREE.MeshBasicMaterial({ map: softboxCoolTex, side: THREE.DoubleSide }),
  );
  backBox.position.set(0, 5.2, -13.5);
  backBox.lookAt(0, 0.6, 0);
  envScene.add(backBox);

  // 5. Horizon grazing ring for low-angle Fresnel sheen on forged rims & carbon rockers
  const horizonRing = new THREE.Mesh(
    new THREE.CylinderGeometry(24, 24, 0.45, 64, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x3b4458, side: THREE.BackSide }),
  );
  horizonRing.position.y = 0.85;
  envScene.add(horizonRing);

  return { scene: envScene, textures };
}

// Physically-Inspired California Atmospheric Sky Dome:
// - Rayleigh/Mie multi-band atmospheric gradient + Belt of Venus anti-solar twilight glow
// - Dual-lobe Henyey-Greenstein solar aureole & limb-darkened sun disc
// - Multi-layer procedural clouds: high-altitude wispy cirrus + self-shadowed volumetric cumulus with silver-lining transmittance
// - Twinkling night starfield + lunar sky glow
// - Strictly non-blinding AgX photographic luminance ceiling
function createNonGlareSkyDome(): {
  mesh: THREE.Mesh;
  uniforms: {
    uZenithColor: { value: THREE.Color };
    uMidSkyColor: { value: THREE.Color };
    uHorizonColor: { value: THREE.Color };
    uGroundColor: { value: THREE.Color };
    uAntiSunColor: { value: THREE.Color };
    uSunColor: { value: THREE.Color };
    uSunDir: { value: THREE.Vector3 };
    uSunStrength: { value: number };
    uCloudCoverage: { value: number };
    uCloudDarkness: { value: number };
    uStarVisibility: { value: number };
    uLightningFlash: { value: number };
    uTime: { value: number };
  };
} {
  const uniforms = {
    uZenithColor: { value: new THREE.Color(0x0f223d) },
    uMidSkyColor: { value: new THREE.Color(0x2d4a6e) },
    uHorizonColor: { value: new THREE.Color(0x7c6258) },
    uGroundColor: { value: new THREE.Color(0x18161d) },
    uAntiSunColor: { value: new THREE.Color(0x4b425c) },
    uSunColor: { value: new THREE.Color(0xffe4c4) },
    uSunDir: { value: new THREE.Vector3(-0.6, 0.35, -0.7).normalize() },
    uSunStrength: { value: 0.48 },
    uCloudCoverage: { value: 0.42 },
    uCloudDarkness: { value: 0.24 },
    uStarVisibility: { value: 0.0 },
    uLightningFlash: { value: 0.0 },
    uTime: { value: 0 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      void main() {
        vWorldDir = normalize(position);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenithColor;
      uniform vec3 uMidSkyColor;
      uniform vec3 uHorizonColor;
      uniform vec3 uGroundColor;
      uniform vec3 uAntiSunColor;
      uniform vec3 uSunColor;
      uniform vec3 uSunDir;
      uniform float uSunStrength;
      uniform float uCloudCoverage;
      uniform float uCloudDarkness;
      uniform float uStarVisibility;
      uniform float uLightningFlash;
      uniform float uTime;
      varying vec3 vWorldDir;

      // Fast 2D value noise with domain rotation for organic multi-octave FBM
      float hash21(vec2 p) {
        p = fract(p * vec2(127.1, 311.7));
        p += dot(p, p + 34.17);
        return fract(p.x * p.y);
      }

      float hash31(vec3 p) {
        p = fract(p * vec3(443.897, 441.423, 437.195));
        p += dot(p, p.yzx + 19.19);
        return fract((p.x + p.y) * p.z);
      }

      float noise2(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      const mat2 CLOUD_ROT = mat2(0.80, -0.60, 0.60, 0.80);

      // 4-octave rotated FBM for realistic billowy cumulus cloud structure
      float fbmClouds(vec2 p) {
        float v = 0.0;
        float amp = 0.52;
        for (int i = 0; i < 4; i++) {
          v += amp * noise2(p);
          p = CLOUD_ROT * p * 2.07 + vec2(13.7, 29.3);
          amp *= 0.49;
        }
        return v;
      }

      // Anisotropic wispy FBM for high-altitude California cirrus streaks
      float fbmCirrus(vec2 p) {
        float n1 = noise2(p * vec2(1.6, 4.2));
        vec2 q = CLOUD_ROT * p * vec2(2.4, 5.8) + vec2(n1 * 0.85, -n1 * 0.45);
        float n2 = noise2(q);
        return n1 * 0.58 + n2 * 0.42;
      }

      // Henyey-Greenstein phase function for forward-scattered Mie solar aureole & silver-lining
      float hgPhase(float cosTheta, float g) {
        float g2 = g * g;
        return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * cosTheta, 0.001), 1.5) * 0.079577;
      }

      void main() {
        vec3 dir = normalize(vWorldDir);
        vec3 sunDir = normalize(uSunDir);
        float h = dir.y;
        float sunCos = dot(dir, sunDir);
        float sunForward = max(sunCos, 0.0);

        // 1. Multi-Band Physical Rayleigh & Mie Atmospheric Gradient
        vec3 col;
        if (h >= 0.0) {
          float lowT = smoothstep(0.0, 0.34, pow(h, 0.72));
          float highT = smoothstep(0.20, 0.96, pow(h, 0.82));
          col = mix(uHorizonColor, uMidSkyColor, lowT);
          col = mix(col, uZenithColor, highT);

          // Anti-solar Belt of Venus
          float antiSunAzimuth = smoothstep(-0.15, 0.85, -sunCos);
          float beltBand = exp(-pow((h - 0.11) / 0.13, 2.0)) * smoothstep(0.0, 0.04, h);
          col = mix(col, uAntiSunColor, antiSunAzimuth * beltBand * 0.42);

          // Restrained warm solar horizon glow
          float horizonMieBand = exp(-h * 5.6) * pow(sunForward, 2.8) * uSunStrength;
          col += uSunColor * horizonMieBand * 0.24;
        } else {
          float t = clamp(-h * 4.5, 0.0, 1.0);
          col = mix(uHorizonColor, uGroundColor, t);
        }

        // 2. Crisp Night Starfield & Subtle Lunar Glow
        if (h > 0.04 && uStarVisibility > 0.02) {
          vec3 starGrid1 = dir * 195.0;
          vec3 starCell1 = floor(starGrid1);
          vec3 starFrac1 = fract(starGrid1) - 0.5;
          float sHash1 = hash31(starCell1);
          float star1 = 0.0;
          if (sHash1 > 0.972) {
            vec3 jitter = vec3(
              hash31(starCell1 + 11.3),
              hash31(starCell1 + 27.1),
              hash31(starCell1 + 43.7)
            ) - 0.5;
            float d = length(starFrac1 - jitter * 0.45);
            float twinkle = 0.72 + 0.28 * sin(uTime * (2.5 + fract(sHash1 * 97.0) * 4.5) + sHash1 * 62.8);
            star1 = smoothstep(0.18, 0.015, d) * twinkle * smoothstep(0.972, 0.999, sHash1);
          }

          vec3 starGrid2 = dir * 340.0 + 19.4;
          vec3 starCell2 = floor(starGrid2);
          vec3 starFrac2 = fract(starGrid2) - 0.5;
          float sHash2 = hash31(starCell2);
          float star2 = 0.0;
          if (sHash2 > 0.982) {
            float d2 = length(starFrac2);
            star2 = smoothstep(0.15, 0.02, d2) * 0.55;
          }

          vec3 starTint = mix(vec3(0.76, 0.86, 1.0), vec3(1.0, 0.92, 0.80), fract(sHash1 * 53.0));
          float horizonFade = smoothstep(0.04, 0.28, h);
          col += starTint * (star1 * 0.85 + star2 * 0.42) * horizonFade * uStarVisibility;

          vec3 moonDir = normalize(vec3(0.48, 0.56, 0.67));
          float moonCos = max(dot(dir, moonDir), 0.0);
          float moonDisc = smoothstep(0.9986, 0.9995, moonCos) * 0.68;
          float moonHalo = pow(moonCos, 22.0) * 0.14;
          col += vec3(0.74, 0.85, 0.98) * (moonDisc + moonHalo) * uStarVisibility * horizonFade;
        }

        // 3. Solar Aureole & Limb-Darkened Sun Disc
        if (h > -0.02 && uSunStrength > 0.01) {
          float mieWide = hgPhase(sunForward, 0.72) * 0.09 * uSunStrength;
          float mieTight = pow(sunForward, 16.0) * 0.22 * uSunStrength;
          float solarDisc = smoothstep(0.9968, 0.9994, sunForward) * 0.58 * uSunStrength;
          col += uSunColor * (mieWide + mieTight + solarDisc);
        }

        // 4. Multi-Layer Volumetric-Style Procedural Clouds
        if (h > 0.015) {
          float shellDist = 1.0 / (h + 0.13);
          vec2 skyPlane = dir.xz * shellDist;
          vec2 sunStep = normalize(sunDir.xz + vec2(0.0001)) * 0.09;

          vec2 cirrusUv = skyPlane * 0.62 + vec2(uTime * 0.0045, uTime * 0.0018);
          float cirrusNoise = fbmCirrus(cirrusUv);
          float cirrusMask = smoothstep(0.56, 0.85, cirrusNoise) * smoothstep(0.04, 0.26, h) * (1.0 - uCloudDarkness * 0.5);
          vec3 cirrusColor = mix(uHorizonColor * 1.12, uSunColor * 1.04, 0.35 + 0.35 * pow(sunForward, 2.0));
          col = mix(col, cirrusColor, cirrusMask * 0.25);

          vec2 cumUv = skyPlane * 0.78 + vec2(uTime * 0.009, -uTime * 0.0035);
          float baseDensity = fbmClouds(cumUv);
          float detailNoise = noise2(cumUv * 5.4 - vec2(uTime * 0.014, 0.0));
          float rawCloud = baseDensity * 0.80 + detailNoise * 0.20;

          float covThreshold = mix(0.72, 0.32, clamp(uCloudCoverage, 0.0, 1.0));
          float cloudDensity = smoothstep(covThreshold, covThreshold + 0.26, rawCloud);
          float cloudAlpha = smoothstep(covThreshold, covThreshold + 0.15, rawCloud) * smoothstep(0.015, 0.16, h);

          if (cloudAlpha > 0.005) {
            float sunSideDensity = fbmClouds(cumUv + sunStep);
            float thicknessToSun = clamp((sunSideDensity - baseDensity) * 2.8 + cloudDensity * 0.55, 0.0, 1.0);
            float directLight = exp(-thicknessToSun * 2.65);

            vec3 cloudShadowCol = mix(
              mix(uZenithColor * 0.72, uHorizonColor * 0.68, 0.45),
              vec3(0.10, 0.13, 0.18),
              uCloudDarkness
            );
            vec3 cloudLitCol = mix(
              mix(uHorizonColor * 1.14, vec3(0.96, 0.96, 0.97), 0.42 * (1.0 - uCloudDarkness)),
              uSunColor * 1.08,
              0.38 * clamp(uSunStrength + 0.25, 0.0, 1.0)
            );

            float edgeTransmittance = (1.0 - cloudDensity * 0.75) * exp(-thicknessToSun * 1.4);
            float silverLining = pow(sunForward, 6.0) * edgeTransmittance * 0.48 * uSunStrength;
            float bottomBounce = (1.0 - cloudDensity) * 0.18;

            vec3 cloudFinal = mix(cloudShadowCol, cloudLitCol, directLight);
            cloudFinal += uSunColor * silverLining;
            cloudFinal += uHorizonColor * bottomBounce * (1.0 - uCloudDarkness * 0.6);
            cloudFinal += vec3(0.65, 0.78, 0.98) * uLightningFlash * (1.0 - cloudDensity * 0.5) * 0.55;

            float horizonAerial = smoothstep(0.015, 0.22, h);
            cloudFinal = mix(uHorizonColor, cloudFinal, horizonAerial);

            col = mix(col, cloudFinal, cloudAlpha * 0.86);
          }
        }

        // 5. Seamless Horizon Aerial Perspective Lock
        float horizonFogLock = exp(-abs(h) * 14.5);
        col = mix(col, uHorizonColor, horizonFogLock * 0.36);

        col = min(col, vec3(1.10));

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(780, 32, 20), mat);
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

export class DynamicWeatherAndLighting {
  public readonly skyDome: THREE.Mesh;
  public readonly sunLight: THREE.DirectionalLight;
  public readonly fillLight: THREE.DirectionalLight;
  public readonly lowFillLight: THREE.DirectionalLight;
  public readonly hemiLight: THREE.HemisphereLight;
  public readonly fog: THREE.FogExp2;

  private readonly skyUniforms: ReturnType<typeof createNonGlareSkyDome>['uniforms'];
  private readonly rainMesh: THREE.InstancedMesh;
  private readonly rainPositions: Float32Array;
  private readonly rainSpeeds: Float32Array;
  private readonly rainCount: number;
  private readonly dummy = new THREE.Object3D();
  private readonly sunVec = new THREE.Vector3();

  private readonly currentTarget: AtmosphereTarget;
  private weather: WeatherType = 'golden';
  private timePreset: TimePreset = 'sunset';

  private lightningTimer = 5.0;
  private lightningFlash = 0;
  private lastSyncedWetness = -1;
  private lastSyncedNight = -1;
  private envMapTex: THREE.Texture | null = null;
  private pmrem: THREE.PMREMGenerator;

  constructor(
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    private readonly uniforms: SharedWeatherUniforms,
    private readonly materials: HyperrealMaterialLibrary,
    private readonly isSoftwareGl: boolean,
  ) {
    // 1. Hybrid AAA Automotive Gaussian-Softbox + Outdoor PMREM Environment Map (blur sigma 0.032)
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
    const { scene: hybridEnv, textures: envTextures } = buildHybridAutomotiveEnvironmentScene();
    this.envMapTex = this.pmrem.fromScene(hybridEnv, 0.032).texture;
    scene.environment = this.envMapTex;
    scene.environmentIntensity = 1.18;
    hybridEnv.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const m = obj.material as THREE.MeshBasicMaterial;
        m.dispose();
      }
    });
    for (const tex of envTextures) {
      tex.dispose();
    }

    // 2. Non-Glare Procedural California Atmospheric Sky Dome
    const dome = createNonGlareSkyDome();
    this.skyDome = dome.mesh;
    this.skyUniforms = dome.uniforms;
    scene.add(this.skyDome);

    // 3. AAA 4-Point Automotive & Open-World Lighting Rig
    // Point 1: Clean High-Contrast Key Light + 2048x2048 Texel-Snapped Shadows
    this.sunLight = new THREE.DirectionalLight(0xfff0dc, 2.45);
    this.sunLight.position.set(-64, 48, -52);
    this.sunLight.castShadow = !isSoftwareGl;
    const shadowRes = isSoftwareGl ? 1024 : 2048;
    this.sunLight.shadow.mapSize.set(shadowRes, shadowRes);
    this.sunLight.shadow.camera.near = 6;
    this.sunLight.shadow.camera.far = 200;
    const d = 44;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.00025;
    this.sunLight.shadow.normalBias = 0.014;
    this.sunLight.shadow.radius = 2.1;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    // Point 2: Cool Counter-Silhouette Rim Light (0xcfe2ff, carves carbon aero & roof scoop silhouettes)
    this.fillLight = new THREE.DirectionalLight(0xcfe2ff, 0.85);
    this.fillLight.position.set(68, 46, -64);
    scene.add(this.fillLight);

    // Point 3: Low-Angle Waistline Fill Light (0xdce6f5, illuminates forged concave rims, ceramic rotors & yellow calipers)
    this.lowFillLight = new THREE.DirectionalLight(0xdce6f5, 0.48);
    this.lowFillLight.position.set(16, 14, 78);
    scene.add(this.lowFillLight);

    // Point 4: Deep Obsidian-Slate Hemisphere Light (eliminates toy-like flat orange ambient washout)
    this.hemiLight = new THREE.HemisphereLight(0x5a657d, 0x18161d, 0.50);
    scene.add(this.hemiLight);

    // Refined low-density atmospheric haze (preserves deep obsidian blacks on vehicles and architecture)
    this.fog = new THREE.FogExp2(0x4e484b, 0.0022);
    scene.fog = this.fog;
    scene.background = this.fog.color.clone();

    // 4. Instanced Volumetric Rain Streaks
    this.rainCount = isSoftwareGl ? 220 : 680;
    const rainGeo = new THREE.CylinderGeometry(0.011, 0.011, 1.35, 4, 1, true);
    const rainMat = new THREE.MeshBasicMaterial({
      color: 0xb9cde0,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
    });
    this.rainMesh = new THREE.InstancedMesh(rainGeo, rainMat, this.rainCount);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;
    scene.add(this.rainMesh);

    this.rainPositions = new Float32Array(this.rainCount * 3);
    this.rainSpeeds = new Float32Array(this.rainCount);
    for (let i = 0; i < this.rainCount; i++) {
      this.rainPositions[i * 3] = (Math.random() - 0.5) * 62;
      this.rainPositions[i * 3 + 1] = Math.random() * 28;
      this.rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 62;
      this.rainSpeeds[i] = 24 + Math.random() * 14;
    }

    this.currentTarget = this.computeTarget(this.weather, this.timePreset);
    this.applyImmediate(renderer, scene);
  }

  public setWeather(w: WeatherType): void {
    this.weather = w;
    Object.assign(this.currentTarget, this.computeTarget(this.weather, this.timePreset));
    this.snapBlend(0.78);
  }

  public setTimePreset(t: TimePreset): void {
    this.timePreset = t;
    Object.assign(this.currentTarget, this.computeTarget(this.weather, this.timePreset));
    this.snapBlend(0.82);
  }

  private snapBlend(factor: number): void {
    const t = this.currentTarget;
    this.sunLight.color.lerp(t.sunColor, factor);
    this.sunLight.intensity = THREE.MathUtils.lerp(this.sunLight.intensity, t.sunIntensity, factor);
    this.hemiLight.color.lerp(t.hemiSky, factor);
    this.hemiLight.groundColor.lerp(t.hemiGround, factor);
    this.hemiLight.intensity = THREE.MathUtils.lerp(this.hemiLight.intensity, t.hemiIntensity, factor);
    this.fog.color.lerp(t.fogColor, factor);
    this.fog.density = THREE.MathUtils.lerp(this.fog.density, t.fogDensity, factor);
    this.skyUniforms.uZenithColor.value.lerp(t.skyZenith, factor);
    this.skyUniforms.uMidSkyColor.value.lerp(t.skyMid, factor);
    this.skyUniforms.uHorizonColor.value.lerp(t.skyHorizon, factor);
    this.skyUniforms.uGroundColor.value.lerp(t.skyGround, factor);
    this.skyUniforms.uAntiSunColor.value.lerp(t.antiSunColor, factor);
    this.skyUniforms.uSunColor.value.lerp(t.sunColor, factor);
    this.skyUniforms.uSunStrength.value = THREE.MathUtils.lerp(
      this.skyUniforms.uSunStrength.value,
      t.sunDiscStrength,
      factor,
    );
    this.skyUniforms.uCloudCoverage.value = THREE.MathUtils.lerp(
      this.skyUniforms.uCloudCoverage.value,
      t.cloudCoverage,
      factor,
    );
    this.skyUniforms.uCloudDarkness.value = THREE.MathUtils.lerp(
      this.skyUniforms.uCloudDarkness.value,
      t.cloudDarkness,
      factor,
    );
    this.skyUniforms.uStarVisibility.value = THREE.MathUtils.lerp(
      this.skyUniforms.uStarVisibility.value,
      t.starVisibility,
      factor,
    );
    this.uniforms.uWetness.value = THREE.MathUtils.lerp(this.uniforms.uWetness.value, t.wetness, factor);
    this.uniforms.uWindStrength.value = THREE.MathUtils.lerp(this.uniforms.uWindStrength.value, t.windStrength, factor);
    this.uniforms.uNightFactor.value = THREE.MathUtils.lerp(this.uniforms.uNightFactor.value, t.nightFactor, factor);
    this.syncRoadWetClearcoat(true);
    this.syncNightEmissives(true);
  }

  private syncRoadWetClearcoat(force = false): void {
    const wet = this.uniforms.uWetness.value;
    if (!force && Math.abs(wet - this.lastSyncedWetness) < 0.0005) return;
    this.lastSyncedWetness = wet;
    const cc = wet > 0.35 ? Math.min(0.84, (wet - 0.35) * 1.25) : 0.14;
    const envI = 0.42 + cc * 0.58;
    this.materials.roadNS.clearcoat = cc;
    this.materials.roadEW.clearcoat = cc;
    this.materials.culDeSacAsphalt.clearcoat = cc;
    this.materials.roadNS.envMapIntensity = envI;
    this.materials.roadEW.envMapIntensity = envI;
    this.materials.culDeSacAsphalt.envMapIntensity = envI;
    this.materials.sidewalk.clearcoat = cc * 0.42;
    this.materials.sidewalk.envMapIntensity = 0.28 + cc * 0.35;
  }

  private syncNightEmissives(force = false): void {
    const night = this.uniforms.uNightFactor.value;
    if (!force && Math.abs(night - this.lastSyncedNight) < 0.0005) return;
    this.lastSyncedNight = night;
    this.materials.streetlampGlow.emissiveIntensity = 0.25 + night * 2.2;
    const skyEmissive = 0.12 + night * 1.0;
    for (let i = 0; i < this.materials.skyscraperFacades.length; i++) {
      this.materials.skyscraperFacades[i].emissiveIntensity = skyEmissive;
    }
    const commEmissive = 0.12 + night * 0.85;
    for (let i = 0; i < this.materials.commercialWalls.length; i++) {
      this.materials.commercialWalls[i].emissiveIntensity = commEmissive;
    }
    this.materials.mazeBankGlass.emissiveIntensity = 0.14 + night * 1.1;
  }

  public getWeather(): WeatherType {
    return this.weather;
  }

  public getTimePreset(): TimePreset {
    return this.timePreset;
  }

  public getClockText(): string {
    return TIME_CLOCK_HOURS[this.timePreset];
  }

  public getSunDirection(): THREE.Vector3 {
    return this.sunVec;
  }

  public getCurrentExposure(): number {
    return this.currentTarget.exposure;
  }

  public getNightFactor(): number {
    return this.uniforms.uNightFactor.value;
  }

  public getWarmthFactor(): number {
    if (this.timePreset === 'night') return 0.08;
    if (this.weather === 'rain' || this.weather === 'storm' || this.weather === 'fog') return 0.18;
    if (this.timePreset === 'sunset') return 0.55;
    if (this.timePreset === 'dawn') return 0.45;
    return 0.22;
  }

  public getBloomStrength(): number {
    if (this.timePreset === 'night') return 0.26;
    if (this.weather === 'rain' || this.weather === 'storm') return 0.22;
    if (this.timePreset === 'sunset' || this.timePreset === 'dawn') return 0.19;
    return 0.16;
  }

  private computeTarget(weather: WeatherType, time: TimePreset): AtmosphereTarget {
    // AAA Hybrid Automotive Photorealistic Golden Hour (clean highlights, deep slate-obsidian shadows)
    let sunElevation = 24.0;
    let sunAzimuth = -118;
    let sunColor = new THREE.Color(0xffe4c4);
    let sunIntensity = 2.45;
    let hemiSky = new THREE.Color(0x5a657d);
    let hemiGround = new THREE.Color(0x18161d);
    let hemiIntensity = 0.50;
    let fogColor = new THREE.Color(0x52484a);
    let fogDensity = 0.0020;
    let skyZenith = new THREE.Color(0x0f223d);
    let skyMid = new THREE.Color(0x2d4a6e);
    let skyHorizon = new THREE.Color(0x826558);
    let skyGround = new THREE.Color(0x18161d);
    let antiSunColor = new THREE.Color(0x4b425c);
    let sunDiscStrength = 0.52;
    let cloudCoverage = 0.42;
    let cloudDarkness = 0.24;
    let starVisibility = 0.16;
    let nightFactor = 0.20;
    let exposure = 1.06;

    if (time === 'noon') {
      sunElevation = 56;
      sunAzimuth = -112;
      sunColor = new THREE.Color(0xfff6eb);
      sunIntensity = 2.55;
      hemiSky = new THREE.Color(0x687894);
      hemiGround = new THREE.Color(0x1c1b22);
      hemiIntensity = 0.54;
      fogColor = new THREE.Color(0x788da3);
      fogDensity = 0.0017;
      skyZenith = new THREE.Color(0x12386b);
      skyMid = new THREE.Color(0x366aa3);
      skyHorizon = new THREE.Color(0x8da4ba);
      skyGround = new THREE.Color(0x201f26);
      antiSunColor = new THREE.Color(0x6886a6);
      sunDiscStrength = 0.40;
      cloudCoverage = 0.34;
      cloudDarkness = 0.12;
      starVisibility = 0.0;
      nightFactor = 0.0;
      exposure = 1.04;
    } else if (time === 'dawn') {
      sunElevation = 18.0;
      sunAzimuth = 72;
      sunColor = new THREE.Color(0xf7cbb4);
      sunIntensity = 2.25;
      hemiSky = new THREE.Color(0x58627d);
      hemiGround = new THREE.Color(0x18161f);
      hemiIntensity = 0.48;
      fogColor = new THREE.Color(0x584d59);
      fogDensity = 0.0024;
      skyZenith = new THREE.Color(0x151f3d);
      skyMid = new THREE.Color(0x3a4569);
      skyHorizon = new THREE.Color(0x8a6975);
      skyGround = new THREE.Color(0x1c1822);
      antiSunColor = new THREE.Color(0x4d3f5e);
      sunDiscStrength = 0.46;
      cloudCoverage = 0.42;
      cloudDarkness = 0.26;
      starVisibility = 0.28;
      nightFactor = 0.30;
      exposure = 1.06;
    } else if (time === 'night') {
      sunElevation = -4;
      sunAzimuth = -110;
      sunColor = new THREE.Color(0x8cb4eb);
      sunIntensity = 1.15;
      hemiSky = new THREE.Color(0x283652);
      hemiGround = new THREE.Color(0x0d0c12);
      hemiIntensity = 0.42;
      fogColor = new THREE.Color(0x0a0e18);
      fogDensity = 0.0034;
      skyZenith = new THREE.Color(0x04070f);
      skyMid = new THREE.Color(0x0a1222);
      skyHorizon = new THREE.Color(0x162238);
      skyGround = new THREE.Color(0x070910);
      antiSunColor = new THREE.Color(0x101a2e);
      sunDiscStrength = 0.0;
      cloudCoverage = 0.30;
      cloudDarkness = 0.72;
      starVisibility = 1.0;
      nightFactor = 1.0;
      exposure = 1.14;
    }

    let wetness = 0.0;
    let windStrength = 0.22;
    let rainDensity = 0.0;

    if (weather === 'golden') {
      if (time === 'sunset') {
        fogColor.set(0x544849);
        sunColor.set(0xffdfc0);
        fogDensity = 0.0018;
      }
      cloudCoverage = Math.max(cloudCoverage, 0.44);
      windStrength = 0.24;
    } else if (weather === 'clear') {
      fogDensity *= 0.65;
      cloudCoverage = 0.26;
      cloudDarkness *= 0.65;
      windStrength = 0.16;
    } else if (weather === 'fog') {
      fogDensity = 0.0088;
      fogColor.set(time === 'night' ? 0x131b26 : 0x626e78);
      skyZenith.set(time === 'night' ? 0x0e141d : 0x485560);
      skyMid.set(time === 'night' ? 0x131b26 : 0x586670);
      skyHorizon.set(time === 'night' ? 0x18212d : 0x687680);
      skyGround.set(time === 'night' ? 0x0c1017 : 0x22262b);
      antiSunColor.copy(skyHorizon);
      sunColor.set(time === 'night' ? 0x6c86a6 : 0xd0d8e0);
      sunIntensity = time === 'night' ? 0.65 : 1.35;
      hemiSky.set(time === 'night' ? 0x2c3a4d : 0x768490);
      hemiGround.set(0x1c1d22);
      hemiIntensity = 0.58;
      sunDiscStrength = 0.05;
      cloudCoverage = 0.78;
      cloudDarkness = 0.52;
      starVisibility = 0.0;
      wetness = 0.16;
      windStrength = 0.18;
      exposure = 0.98;
    } else if (weather === 'rain') {
      fogDensity = 0.0068;
      fogColor.set(time === 'night' ? 0x0c121d : 0x34414f);
      skyZenith.set(time === 'night' ? 0x080c14 : 0x1d2630);
      skyMid.set(time === 'night' ? 0x0d131f : 0x2c3846);
      skyHorizon.set(time === 'night' ? 0x111926 : 0x3b4958);
      skyGround.set(0x151920);
      antiSunColor.copy(skyHorizon);
      sunColor.set(0xa4bad0);
      sunIntensity = time === 'night' ? 0.75 : 1.45;
      hemiSky.set(0x55697d);
      hemiGround.set(0x181b22);
      hemiIntensity = 0.64;
      sunDiscStrength = 0.0;
      cloudCoverage = 0.88;
      cloudDarkness = 0.76;
      starVisibility = 0.0;
      wetness = 0.88;
      windStrength = 0.68;
      rainDensity = 0.75;
      nightFactor = Math.max(nightFactor, 0.72);
      exposure = 0.98;
    } else if (weather === 'storm') {
      fogDensity = 0.0094;
      fogColor.set(0x141c26);
      skyZenith.set(0x090d14);
      skyMid.set(0x101822);
      skyHorizon.set(0x18222e);
      skyGround.set(0x0c1017);
      antiSunColor.set(0x151e2a);
      sunColor.set(0x7d94ad);
      sunIntensity = 0.85;
      hemiSky.set(0x364659);
      hemiGround.set(0x12151c);
      hemiIntensity = 0.56;
      sunDiscStrength = 0.0;
      cloudCoverage = 0.95;
      cloudDarkness = 0.90;
      starVisibility = 0.0;
      wetness = 1.0;
      windStrength = 1.2;
      rainDensity = 1.0;
      nightFactor = Math.max(nightFactor, 0.9);
      exposure = 0.94;
    }

    return {
      sunElevation,
      sunAzimuth,
      sunColor,
      sunIntensity,
      hemiSky,
      hemiGround,
      hemiIntensity,
      fogColor,
      fogDensity,
      skyZenith,
      skyMid,
      skyHorizon,
      skyGround,
      antiSunColor,
      sunDiscStrength,
      cloudCoverage,
      cloudDarkness,
      starVisibility,
      wetness,
      windStrength,
      rainDensity,
      nightFactor,
      exposure,
    };
  }

  private applyImmediate(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    const t = this.currentTarget;
    this.sunLight.color.copy(t.sunColor);
    this.sunLight.intensity = t.sunIntensity;
    this.hemiLight.color.copy(t.hemiSky);
    this.hemiLight.groundColor.copy(t.hemiGround);
    this.hemiLight.intensity = t.hemiIntensity;
    this.fog.color.copy(t.fogColor);
    this.fog.density = t.fogDensity;
    if (scene.background instanceof THREE.Color) {
      scene.background.copy(t.fogColor);
    }
    this.skyUniforms.uZenithColor.value.copy(t.skyZenith);
    this.skyUniforms.uMidSkyColor.value.copy(t.skyMid);
    this.skyUniforms.uHorizonColor.value.copy(t.skyHorizon);
    this.skyUniforms.uGroundColor.value.copy(t.skyGround);
    this.skyUniforms.uAntiSunColor.value.copy(t.antiSunColor);
    this.skyUniforms.uSunColor.value.copy(t.sunColor);
    this.skyUniforms.uSunStrength.value = t.sunDiscStrength;
    this.skyUniforms.uCloudCoverage.value = t.cloudCoverage;
    this.skyUniforms.uCloudDarkness.value = t.cloudDarkness;
    this.skyUniforms.uStarVisibility.value = t.starVisibility;
    this.uniforms.uWetness.value = t.wetness;
    this.uniforms.uWindStrength.value = t.windStrength;
    this.uniforms.uNightFactor.value = t.nightFactor;
    renderer.toneMappingExposure = t.exposure;
    this.syncRoadWetClearcoat(true);
    this.syncNightEmissives(true);
    this.updateSunDirection(t);
  }

  private updateSunDirection(t: AtmosphereTarget): void {
    const phi = THREE.MathUtils.degToRad(90 - Math.max(-12, t.sunElevation));
    const theta = THREE.MathUtils.degToRad(t.sunAzimuth);
    this.sunVec.setFromSphericalCoords(1, phi, theta);
    this.skyUniforms.uSunDir.value.copy(this.sunVec);
    this.uniforms.uSunDir.value.copy(this.sunVec);
  }

  public update(
    dt: number,
    focusX: number,
    focusZ: number,
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    onLightningStrike?: () => void,
  ): void {
    const t = this.currentTarget;
    const blend = 1 - Math.exp(-3.4 * dt);

    this.sunLight.color.lerp(t.sunColor, blend);
    this.hemiLight.color.lerp(t.hemiSky, blend);
    this.hemiLight.groundColor.lerp(t.hemiGround, blend);
    this.hemiLight.intensity = THREE.MathUtils.lerp(
      this.hemiLight.intensity,
      t.hemiIntensity,
      blend,
    );
    this.fog.color.lerp(t.fogColor, blend);
    this.fog.density = THREE.MathUtils.lerp(this.fog.density, t.fogDensity, blend);
    if (scene.background instanceof THREE.Color) {
      scene.background.copy(this.fog.color);
    }

    // Smoothly blend procedural non-glare sky dome colors & cloud states
    this.skyUniforms.uZenithColor.value.lerp(t.skyZenith, blend);
    this.skyUniforms.uMidSkyColor.value.lerp(t.skyMid, blend);
    this.skyUniforms.uHorizonColor.value.lerp(t.skyHorizon, blend);
    this.skyUniforms.uGroundColor.value.lerp(t.skyGround, blend);
    this.skyUniforms.uAntiSunColor.value.lerp(t.antiSunColor, blend);
    this.skyUniforms.uSunColor.value.lerp(t.sunColor, blend);
    this.skyUniforms.uSunStrength.value = THREE.MathUtils.lerp(
      this.skyUniforms.uSunStrength.value,
      t.sunDiscStrength,
      blend,
    );
    this.skyUniforms.uCloudCoverage.value = THREE.MathUtils.lerp(
      this.skyUniforms.uCloudCoverage.value,
      t.cloudCoverage,
      blend,
    );
    this.skyUniforms.uCloudDarkness.value = THREE.MathUtils.lerp(
      this.skyUniforms.uCloudDarkness.value,
      t.cloudDarkness,
      blend,
    );
    this.skyUniforms.uStarVisibility.value = THREE.MathUtils.lerp(
      this.skyUniforms.uStarVisibility.value,
      t.starVisibility,
      blend,
    );
    this.skyUniforms.uTime.value += dt;
    this.skyDome.position.set(focusX, 0, focusZ);

    this.uniforms.uWetness.value = THREE.MathUtils.lerp(
      this.uniforms.uWetness.value,
      t.wetness,
      blend,
    );
    this.syncRoadWetClearcoat();

    // High-energy studio-grade PMREM reflection intensity across all presets
    const targetEnv =
      this.timePreset === 'night'
        ? 0.96
        : this.weather === 'storm'
          ? 0.94
          : this.weather === 'rain' || this.weather === 'fog'
            ? 1.06
            : 1.22;
    scene.environmentIntensity = THREE.MathUtils.lerp(
      scene.environmentIntensity,
      targetEnv,
      blend,
    );

    this.uniforms.uWindStrength.value = THREE.MathUtils.lerp(
      this.uniforms.uWindStrength.value,
      t.windStrength,
      blend,
    );
    this.uniforms.uNightFactor.value = THREE.MathUtils.lerp(
      this.uniforms.uNightFactor.value,
      t.nightFactor,
      blend,
    );
    this.uniforms.uRainTime.value += dt;
    this.uniforms.uWindTime.value += dt;

    renderer.toneMappingExposure = THREE.MathUtils.lerp(
      renderer.toneMappingExposure,
      t.exposure,
      blend,
    );

    if (this.weather === 'storm') {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningFlash = 1.0;
        this.lightningTimer = 4.2 + Math.random() * 6.5;
        onLightningStrike?.();
      }
    }
    if (this.lightningFlash > 0) {
      this.lightningFlash = Math.max(0, this.lightningFlash - dt * 3.8);
    }
    this.skyUniforms.uLightningFlash.value = this.lightningFlash;

    const baseSun = THREE.MathUtils.lerp(this.sunLight.intensity, t.sunIntensity, blend);
    this.sunLight.intensity = baseSun + this.lightningFlash * 3.8;
    const baseRim = this.timePreset === 'night' ? 0.65 : 0.85;
    this.fillLight.intensity = baseRim + this.lightningFlash * 1.1;
    this.lowFillLight.intensity = this.timePreset === 'night' ? 0.36 : 0.48;

    this.updateSunDirection(t);
    const sunElevPos = Math.max(0.32, Math.abs(this.sunVec.y));
    // Snap shadow camera target to 0.5m world grid increments to eliminate shadow-edge crawling shimmer!
    const snapX = Math.round(focusX * 2) * 0.5;
    const snapZ = Math.round(focusZ * 2) * 0.5;
    this.sunLight.position.set(
      snapX + this.sunVec.x * 84,
      sunElevPos * 88,
      snapZ + this.sunVec.z * 84,
    );
    this.sunLight.target.position.set(snapX, 0, snapZ);
    this.sunLight.target.updateMatrixWorld();

    this.syncNightEmissives();

    if (t.rainDensity > 0.05) {
      this.rainMesh.visible = true;
      const activeCount = Math.floor(this.rainCount * t.rainDensity);
      this.rainMesh.count = activeCount;
      const windX = this.uniforms.uWindStrength.value * 5.2;
      const tilt = Math.atan2(windX, 26);

      this.dummy.rotation.set(0, 0, tilt);
      this.dummy.scale.set(1, 1, 1);

      for (let i = 0; i < activeCount; i++) {
        let rx = this.rainPositions[i * 3];
        let ry = this.rainPositions[i * 3 + 1];
        let rz = this.rainPositions[i * 3 + 2];

        ry -= this.rainSpeeds[i] * dt;
        rx += windX * dt;

        if (ry < 0) {
          ry = 24 + Math.random() * 8;
          rx = (Math.random() - 0.5) * 62;
          rz = (Math.random() - 0.5) * 62;
        }

        this.rainPositions[i * 3] = rx;
        this.rainPositions[i * 3 + 1] = ry;
        this.rainPositions[i * 3 + 2] = rz;

        this.dummy.position.set(focusX + rx, ry, focusZ + rz);
        this.dummy.updateMatrix();
        this.rainMesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.rainMesh.instanceMatrix.needsUpdate = true;
    } else {
      this.rainMesh.visible = false;
    }
  }

  public dispose(): void {
    this.rainMesh.geometry.dispose();
    (this.rainMesh.material as THREE.Material).dispose();
    this.skyDome.geometry.dispose();
    (this.skyDome.material as THREE.Material).dispose();
    this.envMapTex?.dispose();
    this.pmrem.dispose();
  }
}
