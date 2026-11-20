import * as THREE from 'three';
import { RAIN_LAYER_SPECS } from '../simulation/rainMath';
import type { SharedWeatherUniforms } from './materials/shaderPatches';

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * AAA Multi-Layer Volumetric Rain, Ground Impact Crown Splashes & Wind-Driven Street Mist.
 *
 * 100% GPU-driven via InstancedBufferGeometry + analytical shaders:
 * - Zero per-frame CPU particle iteration or GC allocations.
 * - Velocity-aligned cylindrical billboard rain streaks across Near / Mid / Far depth tiers
 *   with feathered optical refraction tails, Fresnel core glints, and streetlamp/lightning bounce.
 * - Hundreds of rapid ground-impact crown splashes & expanding puddle rings synchronized with rain density.
 * - Low-altitude drifting rain mist sheets for humid atmospheric storm volume.
 */
export class HyperrealRainSystem {
  public readonly group: THREE.Group;

  private readonly streakGeo: THREE.InstancedBufferGeometry;
  private readonly streakMat: THREE.ShaderMaterial;
  private readonly streakMesh: THREE.Mesh;
  private readonly totalStreaks: number;

  private readonly splashGeo: THREE.InstancedBufferGeometry;
  private readonly splashMat: THREE.ShaderMaterial;
  private readonly splashMesh: THREE.Mesh;
  private readonly totalSplashes: number;

  private readonly mistGeo: THREE.InstancedBufferGeometry;
  private readonly mistMat: THREE.ShaderMaterial;
  private readonly mistMesh: THREE.Mesh;
  private readonly totalMist: number;

  private readonly focusUniform = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly sharedUniforms: SharedWeatherUniforms,
    isSoftwareGl: boolean,
  ) {
    this.group = new THREE.Group();
    this.group.name = 'hyperreal_rain_system';
    this.group.visible = false;
    scene.add(this.group);

    this.totalStreaks = isSoftwareGl ? 1350 : 2800;
    this.totalSplashes = isSoftwareGl ? 420 : 880;
    this.totalMist = isSoftwareGl ? 28 : 64;

    // -------------------------------------------------------------------------
    // 1. Multi-Tier Motion-Blurred Rain Streaks (Cylindrical Camera-Facing Quads)
    // -------------------------------------------------------------------------
    const baseQuad = new THREE.PlaneGeometry(1, 1, 1, 1);
    this.streakGeo = new THREE.InstancedBufferGeometry();
    this.streakGeo.index = baseQuad.index;
    this.streakGeo.attributes.position = baseQuad.attributes.position;
    this.streakGeo.attributes.uv = baseQuad.attributes.uv;

    const aSeedPos = new Float32Array(this.totalStreaks * 3);
    // aDropParams: [speed, width, length, layerId (0=near,1=mid,2=far)]
    const aDropParams = new Float32Array(this.totalStreaks * 4);
    // aDropExtra: [boxWidth, boxHeight, alphaScale, phase]
    const aDropExtra = new Float32Array(this.totalStreaks * 4);

    const rng = seededRand(90210);
    let idx = 0;
    for (let l = 0; l < RAIN_LAYER_SPECS.length; l++) {
      const spec = RAIN_LAYER_SPECS[l];
      const count =
        l === RAIN_LAYER_SPECS.length - 1
          ? this.totalStreaks - idx
          : Math.floor(this.totalStreaks * spec.fraction);

      for (let k = 0; k < count && idx < this.totalStreaks; k++) {
        aSeedPos[idx * 3] = (rng() - 0.5) * spec.boxWidth;
        aSeedPos[idx * 3 + 1] = rng() * spec.boxHeight;
        aSeedPos[idx * 3 + 2] = (rng() - 0.5) * spec.boxWidth;

        const spd = spec.fallSpeedMin + rng() * (spec.fallSpeedMax - spec.fallSpeedMin);
        const len = spec.streakLengthMin + rng() * (spec.streakLengthMax - spec.streakLengthMin);
        const wid = spec.streakWidth * (0.82 + rng() * 0.42);

        aDropParams[idx * 4] = spd;
        aDropParams[idx * 4 + 1] = wid;
        aDropParams[idx * 4 + 2] = len;
        aDropParams[idx * 4 + 3] = l;

        aDropExtra[idx * 4] = spec.boxWidth;
        aDropExtra[idx * 4 + 1] = spec.boxHeight;
        aDropExtra[idx * 4 + 2] = spec.alpha * (0.78 + rng() * 0.44);
        aDropExtra[idx * 4 + 3] = rng();
        idx++;
      }
    }

    this.streakGeo.setAttribute('aSeedPos', new THREE.InstancedBufferAttribute(aSeedPos, 3));
    this.streakGeo.setAttribute('aDropParams', new THREE.InstancedBufferAttribute(aDropParams, 4));
    this.streakGeo.setAttribute('aDropExtra', new THREE.InstancedBufferAttribute(aDropExtra, 4));
    this.streakGeo.instanceCount = this.totalStreaks;

    this.streakMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: sharedUniforms.uRainTime,
        uRainDensity: sharedUniforms.uRainDensity,
        uWindStrength: sharedUniforms.uWindStrength,
        uNightFactor: sharedUniforms.uNightFactor,
        uLightningFlash: sharedUniforms.uLightningFlash,
        uSkyHorizon: sharedUniforms.uSkyHorizon,
        uSkyZenith: sharedUniforms.uSkyZenith,
        uNearLamps: sharedUniforms.uNearLamps,
        uFocusPos: { value: this.focusUniform },
        uCarHeadlightPos: sharedUniforms.uCarHeadlightPos,
        uCarHeadlightDir: sharedUniforms.uCarHeadlightDir,
        uCarLightActive: sharedUniforms.uCarLightActive,
      },
      vertexShader: /* glsl */ `
        attribute vec3 aSeedPos;
        attribute vec4 aDropParams;
        attribute vec4 aDropExtra;

        uniform float uTime;
        uniform float uRainDensity;
        uniform float uWindStrength;
        uniform vec3 uFocusPos;

        varying vec2 vUv;
        varying float vAlpha;
        varying float vLayer;
        varying float vPhase;
        varying vec3 vWorldPos;

        void main() {
          vUv = uv;
          float idNorm = float(gl_InstanceID) / ${this.totalStreaks.toFixed(1)};
          float activeMask = step(idNorm, clamp(uRainDensity * 1.04, 0.0, 1.0));

          float fallSpeed = aDropParams.x;
          float streakW = aDropParams.y;
          float streakL = aDropParams.z * (0.85 + 0.25 * uRainDensity);
          vLayer = aDropParams.w;

          float boxW = aDropExtra.x;
          float boxH = aDropExtra.y;
          float baseAlpha = aDropExtra.z;
          vPhase = aDropExtra.w;

          // Wind shear with gust modulation
          float gust = 1.0 + 0.25 * sin(uTime * 1.3 + aSeedPos.z * 0.14);
          float windX = uWindStrength * 5.8 * gust * mix(1.0, 0.85, vLayer * 0.5);
          float windZ = uWindStrength * 1.4 * sin(uTime * 0.7 + aSeedPos.x * 0.1);
          vec3 vel = vec3(windX, -fallSpeed, windZ);
          vec3 velDir = normalize(vel);

          // Infinite toroidal wrap around focus position (zero CPU updates!)
          vec3 moved = aSeedPos + vel * uTime;
          vec3 rel;
          rel.x = mod(moved.x - uFocusPos.x + boxW * 0.5, boxW) - boxW * 0.5;
          rel.z = mod(moved.z - uFocusPos.z + boxW * 0.5, boxW) - boxW * 0.5;
          rel.y = mod(moved.y, boxH);

          vec3 worldCenter = vec3(uFocusPos.x + rel.x, rel.y, uFocusPos.z + rel.z);

          float camDist = distance(worldCenter, cameraPosition);
          float radialFrac = length(rel.xz) / (boxW * 0.5);
          float edgeFade = 1.0 - smoothstep(0.68, 1.0, radialFrac);
          float nearCamFade = smoothstep(0.55, 1.45, camDist);
          float groundFade = smoothstep(0.05, 0.55, worldCenter.y);
          float topFade = 1.0 - smoothstep(boxH * 0.78, boxH, worldCenter.y);

          vAlpha = baseAlpha * activeMask * edgeFade * nearCamFade * groundFade * topFade;

          // Cylindrical velocity-aligned billboard tangent facing camera (+Z toward viewer)
          vec3 toCam = normalize(cameraPosition - worldCenter);
          vec3 rightVec = cross(toCam, velDir);
          float rLen = length(rightVec);
          rightVec = rLen > 0.001 ? rightVec / rLen : vec3(1.0, 0.0, 0.0);

          float optWidth = max(streakW, camDist * 0.00115);
          vec3 upAxis = -velDir;
          vec3 worldVertex = worldCenter
            + rightVec * (position.x * optWidth)
            + upAxis * (position.y * streakL);

          vWorldPos = worldVertex;
          gl_Position = projectionMatrix * viewMatrix * vec4(worldVertex, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uNightFactor;
        uniform float uLightningFlash;
        uniform vec3 uSkyHorizon;
        uniform vec3 uSkyZenith;
        uniform vec3 uNearLamps[6];
        uniform vec3 uCarHeadlightPos;
        uniform vec3 uCarHeadlightDir;
        uniform float uCarLightActive;

        varying vec2 vUv;
        varying float vAlpha;
        varying float vLayer;
        varying float vPhase;
        varying vec3 vWorldPos;

        void main() {
          if (vAlpha < 0.004) discard;

          // Soft cylindrical lateral Gaussian falloff with bright optical filament core
          float xDist = abs(vUv.x - 0.5) * 2.0;
          float coreProfile = exp(-xDist * xDist * 3.6);
          float rimSpec = exp(-pow(abs(xDist - 0.18) * 4.0, 2.0)) * 0.55;

          // Asymmetric teardrop motion-blur envelope: bright leading tip near bottom, long trailing wake
          float headGlow = exp(-pow((vUv.y - 0.12) / 0.11, 2.0)) * 1.10;
          float tailFade = smoothstep(0.0, 0.08, vUv.y) * pow(1.0 - vUv.y, 1.15);
          float streakShape = (coreProfile + rimSpec * (1.0 - vLayer * 0.3)) * (tailFade * 0.92 + headGlow * 0.72);

          float shimmer = 0.86 + 0.14 * sin(vUv.y * 22.0 + vPhase * 42.0 + uTime * 24.0);

          vec3 coolWater = mix(uSkyHorizon * 1.15 + vec3(0.55, 0.62, 0.70), vec3(0.76, 0.84, 0.94), 0.55);
          vec3 nightWater = mix(vec3(0.32, 0.42, 0.56), uSkyZenith * 1.5 + vec3(0.30, 0.38, 0.52), 0.55);
          vec3 dropCol = mix(coolWater, nightWater, uNightFactor * 0.68);

          // Warm sodium-vapor streetlamp illumination on nearby raindrops
          float lampGlow = 0.0;
          for (int i = 0; i < 6; i++) {
            vec3 dL = vWorldPos - uNearLamps[i];
            float distSq = dot(dL, dL);
            lampGlow += exp(-distSq * 0.009);
          }
          float lampWeight = clamp(lampGlow, 0.0, 1.5) * (0.35 + 0.65 * uNightFactor);
          dropCol += vec3(1.0, 0.76, 0.42) * lampWeight * 1.05;

          if (uCarLightActive > 0.05) {
            vec3 toDrop = vWorldPos - uCarHeadlightPos;
            float dist = length(toDrop);
            vec3 dir = toDrop / max(dist, 0.01);
            float cone = smoothstep(0.74, 0.96, dot(dir, uCarHeadlightDir));
            float atten = exp(-dist * 0.058) * cone * uCarLightActive;
            dropCol += vec3(1.0, 0.98, 0.94) * atten * 1.45;
          }

          dropCol += vec3(0.86, 0.92, 1.0) * uLightningFlash * 1.25;

          float finalAlpha = clamp(vAlpha * streakShape * shimmer, 0.0, 0.85);
          if (finalAlpha < 0.006) discard;

          gl_FragColor = vec4(dropCol, finalAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });

    this.streakMesh = new THREE.Mesh(this.streakGeo, this.streakMat);
    this.streakMesh.frustumCulled = false;
    this.streakMesh.renderOrder = 14;
    this.group.add(this.streakMesh);

    // -------------------------------------------------------------------------
    // 2. Ground Impact Crown Splashes & Expanding Puddle Ripple Bursts
    // -------------------------------------------------------------------------
    // Crossed horizontal ring + upward crown geometry per instance (single draw call!)
    const ringGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
    ringGeo.rotateX(-Math.PI * 0.5);
    const crownGeoA = new THREE.PlaneGeometry(0.82, 0.38, 1, 1);
    crownGeoA.translate(0, 0.16, 0);
    const crownGeoB = new THREE.PlaneGeometry(0.82, 0.38, 1, 1);
    crownGeoB.rotateY(Math.PI * 0.5);
    crownGeoB.translate(0, 0.16, 0);

    this.splashGeo = this.mergeStaticPartsToInstanced([ringGeo, crownGeoA, crownGeoB]);
    ringGeo.dispose();
    crownGeoA.dispose();
    crownGeoB.dispose();

    const aSplashSeed = new Float32Array(this.totalSplashes * 4);
    for (let i = 0; i < this.totalSplashes; i++) {
      aSplashSeed[i * 4] = (rng() - 0.5) * 32;
      aSplashSeed[i * 4 + 1] = (rng() - 0.5) * 32;
      aSplashSeed[i * 4 + 2] = rng();
      aSplashSeed[i * 4 + 3] = 0.15 + rng() * 0.11;
    }
    this.splashGeo.setAttribute('aSplashSeed', new THREE.InstancedBufferAttribute(aSplashSeed, 4));
    this.splashGeo.instanceCount = this.totalSplashes;

    this.splashMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: sharedUniforms.uRainTime,
        uRainDensity: sharedUniforms.uRainDensity,
        uNightFactor: sharedUniforms.uNightFactor,
        uLightningFlash: sharedUniforms.uLightningFlash,
        uNearLamps: sharedUniforms.uNearLamps,
        uFocusPos: { value: this.focusUniform },
      },
      vertexShader: /* glsl */ `
        attribute float aPartKind;
        attribute vec4 aSplashSeed;

        uniform float uTime;
        uniform float uRainDensity;
        uniform vec3 uFocusPos;

        varying vec2 vUv;
        varying float vAge;
        varying float vAlpha;
        varying float vPartKind;
        varying float vSplashRand;
        varying vec3 vWorldPos;

        float spHash(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 41.3);
          return fract(p.x * p.y);
        }

        void main() {
          vUv = uv;
          vPartKind = aPartKind;

          float idNorm = float(gl_InstanceID) / ${this.totalSplashes.toFixed(1)};
          float isActive = step(idNorm, clamp(uRainDensity * 1.02, 0.0, 1.0));

          float dur = aSplashSeed.w;
          float tCycle = uTime / dur + aSplashSeed.z;
          float cycleIdx = floor(tCycle);
          vAge = fract(tCycle);

          float jx = (spHash(vec2(cycleIdx, float(gl_InstanceID) * 0.37)) - 0.5) * 30.0;
          float jz = (spHash(vec2(float(gl_InstanceID) * 0.71, cycleIdx)) - 0.5) * 30.0;
          vSplashRand = spHash(vec2(cycleIdx * 1.3, float(gl_InstanceID) * 0.19));

          float scale = 0.095 + vSplashRand * 0.085;
          vec3 localPos = position * scale;
          if (aPartKind < 0.5) {
            localPos *= (0.45 + vAge * 1.15);
          } else {
            float burstY = sin(min(1.0, vAge * 1.45) * 3.14159);
            localPos.x *= (0.55 + vAge * 0.85);
            localPos.z *= (0.55 + vAge * 0.85);
            localPos.y *= (0.38 + burstY * 0.85);
          }

          vec3 anchor = vec3(uFocusPos.x + jx, 0.056, uFocusPos.z + jz);
          vec3 worldPos = anchor + localPos;

          float distCam = distance(anchor, cameraPosition);
          float distFade = (1.0 - smoothstep(10.0, 20.0, distCam)) * smoothstep(0.6, 1.5, distCam);
          vAlpha = isActive * distFade * (1.0 - smoothstep(0.48, 1.0, vAge));

          vWorldPos = worldPos;
          gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uNightFactor;
        uniform float uLightningFlash;
        uniform vec3 uNearLamps[6];

        varying vec2 vUv;
        varying float vAge;
        varying float vAlpha;
        varying float vPartKind;
        varying float vSplashRand;
        varying vec3 vWorldPos;

        void main() {
          if (vAlpha < 0.005) discard;

          float shape = 0.0;
          if (vPartKind < 0.5) {
            // Crisp hairline puddle splash ring
            float d = length(vUv - 0.5) * 2.0;
            float ringR = 0.25 + vAge * 0.65;
            float ring = exp(-pow((d - ringR) / 0.055, 2.0));
            shape = ring * (1.0 - smoothstep(0.75, 1.0, d)) * 0.72;
          } else {
            // Sharp tiny water-crown micro-droplets snapping upward
            float x = (vUv.x - 0.5) * 2.0;
            float y = vUv.y;
            float peak = sin(min(1.0, vAge * 1.35) * 3.14159);
            float d1 = exp(-pow((x + 0.34 + vAge * 0.28) * 7.2, 2.0) - pow((y - peak * 0.68) * 6.5, 2.0));
            float d2 = exp(-pow((x + 0.05) * 7.5, 2.0) - pow((y - peak * 0.88) * 5.8, 2.0));
            float d3 = exp(-pow((x - 0.36 - vAge * 0.28) * 7.2, 2.0) - pow((y - peak * 0.62) * 6.5, 2.0));
            float stem = exp(-pow(x * 6.0, 2.0)) * exp(-y * 7.5) * 0.45 * (1.0 - vAge);
            shape = (d1 + d2 + d3 + stem) * (1.0 - vAge * 0.65);
          }

          vec3 col = mix(vec3(0.84, 0.90, 0.96), vec3(0.54, 0.66, 0.80), uNightFactor * 0.60);

          float lampGlow = 0.0;
          for (int i = 0; i < 6; i++) {
            vec3 dL = vWorldPos - uNearLamps[i];
            lampGlow += exp(-dot(dL, dL) * 0.014);
          }
          col += vec3(1.0, 0.74, 0.40) * clamp(lampGlow, 0.0, 1.3) * (0.35 + 0.65 * uNightFactor);
          col += vec3(0.85, 0.92, 1.0) * uLightningFlash * 0.9;

          float alpha = clamp(vAlpha * shape * 0.42, 0.0, 0.48);
          if (alpha < 0.005) discard;
          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.splashMesh = new THREE.Mesh(this.splashGeo, this.splashMat);
    this.splashMesh.frustumCulled = false;
    this.splashMesh.renderOrder = 12;
    this.group.add(this.splashMesh);

    // -------------------------------------------------------------------------
    // 3. Low-Altitude Wind-Driven Rain Mist / Street-Level Aerosol Haze
    // -------------------------------------------------------------------------
    const mistBase = new THREE.PlaneGeometry(1, 1, 1, 1);
    this.mistGeo = new THREE.InstancedBufferGeometry();
    this.mistGeo.index = mistBase.index;
    this.mistGeo.attributes.position = mistBase.attributes.position;
    this.mistGeo.attributes.uv = mistBase.attributes.uv;

    const aMistSeed = new Float32Array(this.totalMist * 4);
    for (let i = 0; i < this.totalMist; i++) {
      aMistSeed[i * 4] = (rng() - 0.5) * 48;
      aMistSeed[i * 4 + 1] = 0.55 + rng() * 2.6;
      aMistSeed[i * 4 + 2] = (rng() - 0.5) * 48;
      aMistSeed[i * 4 + 3] = rng();
    }
    this.mistGeo.setAttribute('aMistSeed', new THREE.InstancedBufferAttribute(aMistSeed, 4));
    this.mistGeo.instanceCount = this.totalMist;

    this.mistMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: sharedUniforms.uRainTime,
        uRainDensity: sharedUniforms.uRainDensity,
        uWindStrength: sharedUniforms.uWindStrength,
        uNightFactor: sharedUniforms.uNightFactor,
        uLightningFlash: sharedUniforms.uLightningFlash,
        uSkyHorizon: sharedUniforms.uSkyHorizon,
        uNearLamps: sharedUniforms.uNearLamps,
        uFocusPos: { value: this.focusUniform },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aMistSeed;

        uniform float uTime;
        uniform float uRainDensity;
        uniform float uWindStrength;
        uniform vec3 uFocusPos;

        varying vec2 vUv;
        varying float vAlpha;
        varying float vSeed;
        varying vec3 vWorldPos;

        void main() {
          vUv = uv;
          vSeed = aMistSeed.w;

          float mistDensity = clamp((uRainDensity - 0.22) * 1.28, 0.0, 1.0);
          float driftX = uTime * (1.8 + uWindStrength * 4.4);
          float driftZ = uTime * (0.4 + sin(aMistSeed.w * 6.28) * 0.7);
          float box = 48.0;

          float rx = mod(aMistSeed.x + driftX - uFocusPos.x + box * 0.5, box) - box * 0.5;
          float rz = mod(aMistSeed.z + driftZ - uFocusPos.z + box * 0.5, box) - box * 0.5;
          vec3 center = vec3(uFocusPos.x + rx, aMistSeed.y, uFocusPos.z + rz);

          // Soft horizontal camera-facing billboard sheet
          vec3 toCam = cameraPosition - center;
          toCam.y = 0.0;
          vec3 fwd = length(toCam) > 0.01 ? normalize(toCam) : vec3(0.0, 0.0, 1.0);
          vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));

          float w = 5.4 + aMistSeed.w * 3.4;
          float h = 2.1 + aMistSeed.w * 1.1;
          vec3 worldPos = center + right * (position.x * w) + vec3(0.0, position.y * h, 0.0);

          float edgeFade = 1.0 - smoothstep(14.0, 24.0, length(vec2(rx, rz)));
          float nearCam = smoothstep(3.0, 7.5, distance(center, cameraPosition));
          vAlpha = mistDensity * edgeFade * nearCam * 0.14;
          vWorldPos = worldPos;

          gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uNightFactor;
        uniform float uLightningFlash;
        uniform vec3 uSkyHorizon;
        uniform vec3 uNearLamps[6];

        varying vec2 vUv;
        varying float vAlpha;
        varying float vSeed;
        varying vec3 vWorldPos;

        float mHash(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.5);
          return fract(p.x * p.y);
        }

        float mNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mHash(i), mHash(i + vec2(1.0, 0.0)), f.x),
            mix(mHash(i + vec2(0.0, 1.0)), mHash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }

        void main() {
          if (vAlpha < 0.002) discard;

          vec2 centered = vUv - 0.5;
          float ellipse = 1.0 - smoothstep(0.18, 0.5, length(centered * vec2(1.0, 1.25)));
          float fbm = mNoise(vUv * 3.2 + vec2(uTime * 0.35 + vSeed * 9.0, vSeed * 4.0)) * 0.65
                    + mNoise(vUv * 6.8 - vec2(uTime * 0.55, 0.0)) * 0.35;

          float a = vAlpha * ellipse * smoothstep(0.28, 0.82, fbm);
          if (a < 0.003) discard;

          vec3 mistCol = mix(uSkyHorizon * 0.85 + vec3(0.20, 0.25, 0.30), vec3(0.14, 0.19, 0.26), uNightFactor);

          float lampGlow = 0.0;
          for (int i = 0; i < 6; i++) {
            vec3 dL = vWorldPos - uNearLamps[i];
            lampGlow += exp(-dot(dL, dL) * 0.0085);
          }
          mistCol += vec3(1.0, 0.68, 0.32) * clamp(lampGlow, 0.0, 1.2) * (0.25 + 0.75 * uNightFactor);
          mistCol += vec3(0.75, 0.85, 1.0) * uLightningFlash * 0.75;

          gl_FragColor = vec4(mistCol, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mistMesh = new THREE.Mesh(this.mistGeo, this.mistMat);
    this.mistMesh.frustumCulled = false;
    this.mistMesh.renderOrder = 11;
    this.group.add(this.mistMesh);
  }

  private mergeStaticPartsToInstanced(parts: THREE.BufferGeometry[]): THREE.InstancedBufferGeometry {
    const positions: number[] = [];
    const uvs: number[] = [];
    const partKind: number[] = [];
    const indices: number[] = [];

    let vertexOffset = 0;
    for (let k = 0; k < parts.length; k++) {
      const g = parts[k];
      const pos = g.attributes.position;
      const uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        uvs.push(uv.getX(i), uv.getY(i));
        partKind.push(k);
      }
      if (g.index) {
        const idx = g.index;
        for (let i = 0; i < idx.count; i++) {
          indices.push(idx.getX(i) + vertexOffset);
        }
      }
      vertexOffset += pos.count;
    }

    const out = new THREE.InstancedBufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    out.setAttribute('aPartKind', new THREE.Float32BufferAttribute(partKind, 1));
    out.setIndex(indices);
    return out;
  }

  public update(focusX: number, focusZ: number, rainDensity: number): void {
    const active = rainDensity > 0.025;
    this.group.visible = active;
    if (!active) return;

    this.focusUniform.set(focusX, 0, focusZ);
    this.streakGeo.instanceCount = Math.max(
      1,
      Math.floor(this.totalStreaks * Math.min(1, rainDensity * 1.04)),
    );
    this.splashGeo.instanceCount = Math.max(
      1,
      Math.floor(this.totalSplashes * Math.min(1, rainDensity * 1.02)),
    );
    this.mistMesh.visible = rainDensity > 0.22;
  }

  public dispose(): void {
    this.group.removeFromParent();
    this.streakGeo.dispose();
    this.streakMat.dispose();
    this.splashGeo.dispose();
    this.splashMat.dispose();
    this.mistGeo.dispose();
    this.mistMat.dispose();
  }
}
