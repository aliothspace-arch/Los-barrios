import * as THREE from 'three';
import type { WeatherType } from './types';
import type { HyperrealMaterialLibrary, SharedWeatherUniforms } from './textures';
import { createGaussianSoftboxTexture } from './rendering/hypercarBuilders';
import { HyperrealRainSystem } from './rendering/rainSystem';
import { STREETLAMP_POSITIONS } from './worldLayout';
import {
  computeNearestLampBulbs,
  computeWetRoadMetrics,
} from './simulation/rainMath';
import {
  createInitialAtmosphereState,
  evaluateDynamicAtmosphere,
  formatClockHHMM,
  stepAtmosphereState,
  type DynamicAtmosphereState,
  type PureAtmosphereSample,
} from './simulation/atmosphereModel';

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

      float fbmCirrus(vec2 p) {
        float n1 = noise2(p * vec2(1.6, 4.2));
        vec2 q = CLOUD_ROT * p * vec2(2.4, 5.8) + vec2(n1 * 0.85, -n1 * 0.45);
        float n2 = noise2(q);
        return n1 * 0.58 + n2 * 0.42;
      }

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

        vec3 col;
        if (h >= 0.0) {
          float lowT = smoothstep(0.0, 0.34, pow(h, 0.72));
          float highT = smoothstep(0.20, 0.96, pow(h, 0.82));
          col = mix(uHorizonColor, uMidSkyColor, lowT);
          col = mix(col, uZenithColor, highT);

          float antiSunAzimuth = smoothstep(-0.15, 0.85, -sunCos);
          float beltBand = exp(-pow((h - 0.11) / 0.13, 2.0)) * smoothstep(0.0, 0.04, h);
          col = mix(col, uAntiSunColor, antiSunAzimuth * beltBand * 0.42);

          float horizonMieBand = exp(-h * 5.6) * pow(sunForward, 2.8) * uSunStrength;
          col += uSunColor * horizonMieBand * 0.24;
        } else {
          float t = clamp(-h * 4.5, 0.0, 1.0);
          col = mix(uHorizonColor, uGroundColor, t);
        }

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

        if (h > -0.02 && uSunStrength > 0.01) {
          float mieWide = hgPhase(sunForward, 0.72) * 0.09 * uSunStrength;
          float mieTight = pow(sunForward, 16.0) * 0.22 * uSunStrength;
          float solarDisc = smoothstep(0.9968, 0.9994, sunForward) * 0.58 * uSunStrength;
          col += uSunColor * (mieWide + mieTight + solarDisc);
        }

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
  private readonly rainSystem: HyperrealRainSystem;
  private readonly sunVec = new THREE.Vector3();

  private atmosphereState: DynamicAtmosphereState;
  private currentSample: PureAtmosphereSample;

  private lightningTimer = 5.0;
  private lightningFlash = 0;
  private lastSyncedWetness = -1;
  private lastSyncedNight = -1;
  private lastLampFocusX = Number.NaN;
  private lastLampFocusZ = Number.NaN;
  private envMapTex: THREE.Texture | null = null;
  private pmrem: THREE.PMREMGenerator;

  constructor(
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    private readonly uniforms: SharedWeatherUniforms,
    private readonly materials: HyperrealMaterialLibrary,
    private readonly isSoftwareGl: boolean,
  ) {
    // 1. Hybrid AAA Automotive Gaussian-Softbox + Outdoor PMREM Environment Map
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

    // 2. Non-Glare Procedural California Atmospheric Sky Dome (render after opaque world for Early-Z culling)
    const dome = createNonGlareSkyDome();
    this.skyDome = dome.mesh;
    this.skyDome.renderOrder = 10;
    this.skyUniforms = dome.uniforms;
    scene.add(this.skyDome);

    // 3. AAA 4-Point Automotive & Open-World Lighting Rig
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

    this.fillLight = new THREE.DirectionalLight(0xcfe2ff, 0.85);
    this.fillLight.position.set(68, 46, -64);
    scene.add(this.fillLight);

    this.lowFillLight = new THREE.DirectionalLight(0xdce6f5, 0.48);
    this.lowFillLight.position.set(16, 14, 78);
    scene.add(this.lowFillLight);

    this.hemiLight = new THREE.HemisphereLight(0x5a657d, 0x18161d, 0.50);
    scene.add(this.hemiLight);

    this.fog = new THREE.FogExp2(0x4e484b, 0.0022);
    scene.fog = this.fog;
    scene.background = this.fog.color.clone();

    // 4. AAA Multi-Layer Volumetric Rain Streaks, Ground Crown Splashes & Wind Mist
    this.rainSystem = new HyperrealRainSystem(scene, uniforms, isSoftwareGl);

    this.atmosphereState = createInitialAtmosphereState();
    this.currentSample = evaluateDynamicAtmosphere(this.atmosphereState);
    this.applySampleToScene(renderer, scene, 0, 0, 0, true);
  }

  public resetCycle(): void {
    this.atmosphereState = createInitialAtmosphereState();
    this.currentSample = evaluateDynamicAtmosphere(this.atmosphereState);
    this.lightningFlash = 0;
  }

  public advanceTimeSeconds(seconds: number): void {
    stepAtmosphereState(this.atmosphereState, seconds);
    this.currentSample = evaluateDynamicAtmosphere(this.atmosphereState);
  }

  public setAtmosphereForTest(weather: WeatherType, timeOfDayHours?: number): void {
    this.atmosphereState.prevWeather = weather;
    this.atmosphereState.weather = weather;
    this.atmosphereState.weatherBlend = 1.0;
    this.atmosphereState.dwellTimerSec = 90;
    if (typeof timeOfDayHours === 'number' && Number.isFinite(timeOfDayHours)) {
      this.atmosphereState.timeOfDayHours = ((timeOfDayHours % 24) + 24) % 24;
    }
    this.lightningFlash = weather === 'storm' ? 0.35 : 0;
    this.currentSample = evaluateDynamicAtmosphere(this.atmosphereState);
  }

  public syncToScene(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    focusX: number,
    focusZ: number,
  ): void {
    this.applySampleToScene(renderer, scene, focusX, focusZ, 0.04, true);
  }

  public updateVehicleLightReflection(
    carX: number,
    carZ: number,
    heading: number,
    active: boolean,
  ): void {
    if (!active) {
      this.uniforms.uCarLightActive.value = 0;
      return;
    }
    const sinH = Math.sin(heading);
    const cosH = Math.cos(heading);
    this.uniforms.uCarHeadlightDir.value.set(sinH, -0.08, cosH).normalize();
    this.uniforms.uCarHeadlightPos.value.set(carX + sinH * 2.15, 0.58, carZ + cosH * 2.15);
    this.uniforms.uCarTaillightPos.value.set(carX - sinH * 2.12, 0.72, carZ - cosH * 2.12);
    this.uniforms.uCarLightActive.value = 1.0;
  }

  public setCarSpeedNorm(speedNorm: number): void {
    this.uniforms.uCarSpeedNorm.value = Math.max(0, Math.min(1, speedNorm));
  }

  /**
   * Temporarily reveals the GPU rain system during boot compileAsync so rain streaks,
   * splashes, and mist shaders compile up front instead of stalling mid-drive.
   */
  public setRainWarmupVisible(visible: boolean): void {
    this.rainSystem.group.visible = visible;
  }

  private syncNearestLamps(focusX: number, focusZ: number, force = false): void {
    if (
      !force &&
      Number.isFinite(this.lastLampFocusX) &&
      Math.hypot(focusX - this.lastLampFocusX, focusZ - this.lastLampFocusZ) < 4.5
    ) {
      return;
    }
    this.lastLampFocusX = focusX;
    this.lastLampFocusZ = focusZ;
    const nearest = computeNearestLampBulbs(focusX, focusZ, STREETLAMP_POSITIONS, 6);
    const arr = this.uniforms.uNearLamps.value;
    for (let i = 0; i < nearest.length && i < arr.length; i++) {
      arr[i].set(nearest[i].x, nearest[i].y, nearest[i].z);
    }
  }

  private syncRoadWetClearcoat(force = false): void {
    const wet = this.uniforms.uWetness.value;
    const rain = this.uniforms.uRainDensity.value;
    if (!force && Math.abs(wet - this.lastSyncedWetness) < 0.0005) return;
    this.lastSyncedWetness = wet;
    const metrics = computeWetRoadMetrics(wet, rain, this.uniforms.uWindStrength.value);
    const cc = metrics.roadClearcoat;
    const envI = metrics.roadEnvIntensity;
    this.materials.roadNS.clearcoat = cc;
    this.materials.roadEW.clearcoat = cc;
    this.materials.culDeSacAsphalt.clearcoat = cc;
    this.materials.roadNS.clearcoatRoughness = wet > 0.3 ? 0.04 : 0.12;
    this.materials.roadEW.clearcoatRoughness = wet > 0.3 ? 0.04 : 0.12;
    this.materials.culDeSacAsphalt.clearcoatRoughness = wet > 0.3 ? 0.04 : 0.12;
    this.materials.roadNS.envMapIntensity = envI;
    this.materials.roadEW.envMapIntensity = envI;
    this.materials.culDeSacAsphalt.envMapIntensity = envI;
    this.materials.sidewalk.clearcoat = cc * 0.48;
    this.materials.sidewalk.envMapIntensity = 0.28 + wet * 0.52;
  }

  private syncNightEmissives(force = false): void {
    const night = this.uniforms.uNightFactor.value;
    if (!force && Math.abs(night - this.lastSyncedNight) < 0.0005) return;
    this.lastSyncedNight = night;
    this.materials.streetlampGlow.emissiveIntensity = 0.35 + night * 2.55;
    this.materials.trafficStreetSignMat.emissiveIntensity = 0.28 + night * 0.95;
    this.materials.trafficLensGreenMat.emissiveIntensity = 1.45 + night * 1.35;
    this.materials.trafficLensRedMat.emissiveIntensity = 1.45 + night * 1.35;
    const skyEmissive = 0.12 + night * 1.05;
    for (let i = 0; i < this.materials.skyscraperFacades.length; i++) {
      this.materials.skyscraperFacades[i].emissiveIntensity = skyEmissive;
    }
    const commEmissive = 0.12 + night * 0.88;
    for (let i = 0; i < this.materials.commercialWalls.length; i++) {
      this.materials.commercialWalls[i].emissiveIntensity = commEmissive;
    }
    this.materials.mazeBankGlass.emissiveIntensity = 0.14 + night * 1.15;
  }

  public getWeather(): WeatherType {
    return this.atmosphereState.weather;
  }

  public getClockText(): string {
    return formatClockHHMM(this.atmosphereState.timeOfDayHours);
  }

  public getTimeOfDayHours(): number {
    return this.atmosphereState.timeOfDayHours;
  }

  public getSunDirection(): THREE.Vector3 {
    return this.sunVec;
  }

  public getCurrentExposure(): number {
    return this.currentSample.exposure;
  }

  public getNightFactor(): number {
    return this.uniforms.uNightFactor.value;
  }

  public getRainDensity(): number {
    return this.uniforms.uRainDensity.value;
  }

  public getWetness(): number {
    return this.uniforms.uWetness.value;
  }

  public getWarmthFactor(): number {
    return this.currentSample.warmth;
  }

  public getBloomStrength(): number {
    return this.currentSample.bloomStrength;
  }

  private updateSunDirection(s: PureAtmosphereSample): void {
    const phi = THREE.MathUtils.degToRad(90 - Math.max(-12, s.sunElevation));
    const theta = THREE.MathUtils.degToRad(s.sunAzimuth);
    this.sunVec.setFromSphericalCoords(1, phi, theta);
    this.skyUniforms.uSunDir.value.copy(this.sunVec);
    this.uniforms.uSunDir.value.copy(this.sunVec);
  }

  private applySampleToScene(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    focusX: number,
    focusZ: number,
    dt: number,
    forceImmediate = false,
  ): void {
    const s = this.currentSample;

    this.sunLight.color.setRGB(s.sunColor.r, s.sunColor.g, s.sunColor.b);
    this.hemiLight.color.setRGB(s.hemiSky.r, s.hemiSky.g, s.hemiSky.b);
    this.hemiLight.groundColor.setRGB(s.hemiGround.r, s.hemiGround.g, s.hemiGround.b);
    this.hemiLight.intensity = s.hemiIntensity;

    this.fog.color.setRGB(s.fogColor.r, s.fogColor.g, s.fogColor.b);
    this.fog.density = s.fogDensity;
    if (scene.background instanceof THREE.Color) {
      scene.background.copy(this.fog.color);
    }

    this.skyUniforms.uZenithColor.value.setRGB(s.skyZenith.r, s.skyZenith.g, s.skyZenith.b);
    this.skyUniforms.uMidSkyColor.value.setRGB(s.skyMid.r, s.skyMid.g, s.skyMid.b);
    this.skyUniforms.uHorizonColor.value.setRGB(s.skyHorizon.r, s.skyHorizon.g, s.skyHorizon.b);
    this.skyUniforms.uGroundColor.value.setRGB(s.skyGround.r, s.skyGround.g, s.skyGround.b);
    this.skyUniforms.uAntiSunColor.value.setRGB(s.antiSunColor.r, s.antiSunColor.g, s.antiSunColor.b);
    this.skyUniforms.uSunColor.value.setRGB(s.sunColor.r, s.sunColor.g, s.sunColor.b);
    this.skyUniforms.uSunStrength.value = s.sunDiscStrength;
    this.skyUniforms.uCloudCoverage.value = s.cloudCoverage;
    this.skyUniforms.uCloudDarkness.value = s.cloudDarkness;
    this.skyUniforms.uStarVisibility.value = s.starVisibility;
    this.skyUniforms.uLightningFlash.value = this.lightningFlash;
    this.skyUniforms.uTime.value += dt;
    this.skyDome.position.set(focusX, 0, focusZ);

    this.uniforms.uWetness.value = s.wetness;
    this.uniforms.uRainDensity.value = s.rainDensity;
    this.uniforms.uWindStrength.value = s.windStrength;
    this.uniforms.uNightFactor.value = s.nightFactor;
    this.uniforms.uLightningFlash.value = this.lightningFlash;
    this.uniforms.uSkyZenith.value.setRGB(s.skyZenith.r, s.skyZenith.g, s.skyZenith.b);
    this.uniforms.uSkyHorizon.value.setRGB(s.skyHorizon.r, s.skyHorizon.g, s.skyHorizon.b);
    this.uniforms.uRainTime.value += dt;
    this.uniforms.uWindTime.value += dt;

    scene.environmentIntensity = s.envIntensity;
    renderer.toneMappingExposure = s.exposure;

    this.sunLight.intensity = s.sunIntensity + this.lightningFlash * 3.8;
    this.fillLight.intensity = s.rimIntensity + this.lightningFlash * 1.1;
    this.lowFillLight.intensity = s.lowFillIntensity;

    this.updateSunDirection(s);
    const sunElevPos = Math.max(0.32, Math.abs(this.sunVec.y));
    const snapX = Math.round(focusX * 2) * 0.5;
    const snapZ = Math.round(focusZ * 2) * 0.5;
    this.sunLight.position.set(
      snapX + this.sunVec.x * 84,
      sunElevPos * 88,
      snapZ + this.sunVec.z * 84,
    );
    this.sunLight.target.position.set(snapX, 0, snapZ);
    this.sunLight.target.updateMatrixWorld();

    this.syncNearestLamps(focusX, focusZ, forceImmediate);
    this.syncRoadWetClearcoat(forceImmediate);
    this.syncNightEmissives(forceImmediate);
    this.rainSystem.update(focusX, focusZ, s.rainDensity);
  }

  public update(
    dt: number,
    focusX: number,
    focusZ: number,
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    onLightningStrike?: () => void,
    onWeatherTransition?: (weather: WeatherType) => void,
  ): void {
    const { weatherChangedTo } = stepAtmosphereState(this.atmosphereState, dt);
    if (weatherChangedTo) {
      onWeatherTransition?.(weatherChangedTo);
    }
    this.currentSample = evaluateDynamicAtmosphere(this.atmosphereState);
    const s = this.currentSample;

    if (this.atmosphereState.weather === 'storm' && s.rainDensity > 0.65) {
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

    this.applySampleToScene(renderer, scene, focusX, focusZ, dt, false);
  }

  public dispose(): void {
    this.rainSystem.dispose();
    this.skyDome.geometry.dispose();
    (this.skyDome.material as THREE.Material).dispose();
    this.envMapTex?.dispose();
    this.pmrem.dispose();
  }
}
