import * as THREE from 'three';
import type { SharedWeatherUniforms } from '../rendering/materials/shaderPatches';

export type ParticleKind = 'smoke' | 'spark' | 'spray';

export interface ParticleBurstOptions {
  vx?: number;
  vy?: number;
  vz?: number;
  intensity?: number;
}

export interface ParticleEnvironmentParams {
  timeSec: number;
  sunColor: THREE.Color;
  fogColor: THREE.Color;
  fogDensity: number;
}

interface ParticleSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  startSize: number;
  endSize: number;
  rot: number;
  rotVel: number;
  seed: number;
  density: number;
  swirlPhase: number;
  swirlAmp: number;
  kind: ParticleKind;
}

const KIND_ID: Record<ParticleKind, number> = {
  smoke: 0,
  spark: 1,
  spray: 2,
};

/**
 * AAA Volumetric GPU-Instanced Particle System:
 * - Curl-domain-warped 3-octave FBM billowing tire smoke with density-slope 3D normal
 *   perturbation, directional solar wrap + Henyey-Greenstein forward scattering,
 *   vertical self-occlusion, red taillight/headlight/streetlamp bounce, soft asphalt
 *   ground-contact feathering, and exponential fog integration.
 * - Incandescent HDR spark streaks & atomized wet-road water spray in the same draw call.
 * - Zero per-frame heap allocations; skips rendering completely when no particles are active.
 */
export class ParticleSystem {
  public readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly particles: ParticleSlot[] = [];
  private readonly capacity: number;
  private cursor = 0;

  private readonly posScaleArray: Float32Array;
  private readonly motionArray: Float32Array;
  private readonly lifeSeedArray: Float32Array;
  private readonly posScaleAttr: THREE.InstancedBufferAttribute;
  private readonly motionAttr: THREE.InstancedBufferAttribute;
  private readonly lifeSeedAttr: THREE.InstancedBufferAttribute;

  private readonly uTime = { value: 0 };
  private readonly uSunColor = { value: new THREE.Color(0xffe4c4) };
  private readonly uFogColor = { value: new THREE.Color(0x544849) };
  private readonly uFogDensity = { value: 0.0019 };

  constructor(
    scene: THREE.Scene,
    sharedUniforms: SharedWeatherUniforms,
    isSoftwareGl = false,
  ) {
    this.capacity = isSoftwareGl ? 76 : 360;

    const baseQuad = new THREE.PlaneGeometry(1, 1, 1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = baseQuad.index!.clone();
    this.geometry.attributes.position = baseQuad.attributes.position.clone();
    this.geometry.attributes.uv = baseQuad.attributes.uv.clone();
    baseQuad.dispose();

    this.posScaleArray = new Float32Array(this.capacity * 4);
    this.motionArray = new Float32Array(this.capacity * 4);
    this.lifeSeedArray = new Float32Array(this.capacity * 4);

    this.posScaleAttr = new THREE.InstancedBufferAttribute(this.posScaleArray, 4);
    this.posScaleAttr.setUsage(THREE.DynamicDrawUsage);
    this.motionAttr = new THREE.InstancedBufferAttribute(this.motionArray, 4);
    this.motionAttr.setUsage(THREE.DynamicDrawUsage);
    this.lifeSeedAttr = new THREE.InstancedBufferAttribute(this.lifeSeedArray, 4);
    this.lifeSeedAttr.setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute('aPosScale', this.posScaleAttr);
    this.geometry.setAttribute('aMotion', this.motionAttr);
    this.geometry.setAttribute('aLifeSeed', this.lifeSeedAttr);
    this.geometry.instanceCount = this.capacity;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.uTime,
        uSunDir: sharedUniforms.uSunDir,
        uSunColor: this.uSunColor,
        uSkyZenith: sharedUniforms.uSkyZenith,
        uSkyHorizon: sharedUniforms.uSkyHorizon,
        uFogColor: this.uFogColor,
        uFogDensity: this.uFogDensity,
        uNightFactor: sharedUniforms.uNightFactor,
        uLightningFlash: sharedUniforms.uLightningFlash,
        uNearLamps: sharedUniforms.uNearLamps,
        uCarHeadlightPos: sharedUniforms.uCarHeadlightPos,
        uCarHeadlightDir: sharedUniforms.uCarHeadlightDir,
        uCarTaillightPos: sharedUniforms.uCarTaillightPos,
        uCarLightActive: sharedUniforms.uCarLightActive,
      },
      vertexShader: /* glsl */ `
        attribute vec4 aPosScale;
        attribute vec4 aMotion;
        attribute vec4 aLifeSeed;

        varying vec2 vUv;
        varying vec2 vLocal;
        varying vec3 vWorldPos;
        varying vec3 vCamRight;
        varying vec3 vCamUp;
        varying vec3 vCamFwd;
        varying float vCamDist;
        varying float vAge;
        varying float vSeed;
        varying float vKind;
        varying float vDensity;
        varying float vRot;

        void main() {
          float scale = aPosScale.w;
          if (scale <= 0.001) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }

          vUv = uv;
          vLocal = position.xy;
          vAge = aLifeSeed.x;
          vSeed = aLifeSeed.y;
          vKind = aLifeSeed.z;
          vDensity = aLifeSeed.w;
          vRot = aMotion.w;

          vec3 center = aPosScale.xyz;
          vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 camFwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);

          vCamRight = camRight;
          vCamUp = camUp;
          vCamFwd = camFwd;

          vec3 toCamVec = cameraPosition - center;
          vCamDist = length(toCamVec);
          vec3 toCamDir = vCamDist > 0.001 ? toCamVec / vCamDist : -camFwd;

          vec3 worldPos;
          if (vKind > 0.5 && vKind < 1.5) {
            // Velocity-stretched spark streak billboard
            vec3 vel = aMotion.xyz;
            float speed = length(vel);
            vec3 dir = speed > 0.1 ? vel / speed : vec3(0.0, 1.0, 0.0);
            vec3 side = cross(toCamDir, dir);
            float sLen = length(side);
            side = sLen > 0.001 ? side / sLen : camRight;
            float streakLen = scale * (1.2 + clamp(speed * 0.22, 0.0, 2.8));
            float streakWid = scale * 0.24;
            worldPos = center + side * (position.x * streakWid) + dir * (position.y * streakLen);
          } else {
            // Rotated volumetric smoke / mist billboard with slight camera pull to avoid chassis clipping
            float cs = cos(vRot);
            float sn = sin(vRot);
            vec2 rotPos = vec2(
              position.x * cs - position.y * sn,
              position.x * sn + position.y * cs
            );
            float pull = vKind < 0.5 ? 0.12 * scale : 0.04 * scale;
            vec3 nudgedCenter = center + toCamDir * pull;
            worldPos = nudgedCenter + camRight * (rotPos.x * scale) + camUp * (rotPos.y * scale);
          }

          vWorldPos = worldPos;
          gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uSkyZenith;
        uniform vec3 uSkyHorizon;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        uniform float uNightFactor;
        uniform float uLightningFlash;
        uniform vec3 uNearLamps[6];
        uniform vec3 uCarHeadlightPos;
        uniform vec3 uCarHeadlightDir;
        uniform vec3 uCarTaillightPos;
        uniform float uCarLightActive;

        varying vec2 vUv;
        varying vec2 vLocal;
        varying vec3 vWorldPos;
        varying vec3 vCamRight;
        varying vec3 vCamUp;
        varying vec3 vCamFwd;
        varying float vCamDist;
        varying float vAge;
        varying float vSeed;
        varying float vKind;
        varying float vDensity;
        varying float vRot;

        float pHash21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }

        float pNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = pHash21(i);
          float b = pHash21(i + vec2(1.0, 0.0));
          float c = pHash21(i + vec2(0.0, 1.0));
          float d = pHash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }

        const mat2 SMOKE_ROT = mat2(0.80, -0.60, 0.60, 0.80);

        float smokeFbm2(vec2 p) {
          float v = 0.56 * pNoise(p);
          p = SMOKE_ROT * p * 2.06 + vec2(13.7, 29.1);
          v += 0.31 * pNoise(p);
          return v;
        }

        float smokeFbm(vec2 p) {
          float v = 0.0;
          float amp = 0.52;
          for (int i = 0; i < 3; i++) {
            v += amp * pNoise(p);
            p = SMOKE_ROT * p * 2.08 + vec2(13.7, 29.1);
            amp *= 0.49;
          }
          return v;
        }

        float hgPhase(float cosTheta, float g) {
          float g2 = g * g;
          return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * cosTheta, 0.02), 1.5) * 0.079577;
        }

        void main() {
          // -------------------------------------------------------------------
          // Kind 1: Incandescent Metallic Sparks (HDR Selective Bloom Streaks)
          // -------------------------------------------------------------------
          if (vKind > 0.5 && vKind < 1.5) {
            vec2 c = vUv - 0.5;
            float along = exp(-pow(c.y * 2.1, 2.0));
            float across = exp(-pow(c.x * 5.2, 2.0));
            float core = along * across;
            if (core < 0.02) discard;

            vec3 hot = mix(vec3(2.8, 2.1, 0.95), vec3(1.65, 0.42, 0.07), smoothstep(0.08, 0.75, vAge));
            float alpha = core * (1.0 - smoothstep(0.35, 1.0, vAge)) * 0.94;
            gl_FragColor = vec4(hot, alpha);
            return;
          }

          // -------------------------------------------------------------------
          // Kind 2: Atomized Wet-Road Tire Spray & Mist
          // -------------------------------------------------------------------
          if (vKind >= 1.5) {
            vec2 c = vUv - 0.5;
            float distR = length(c) * 2.0;
            if (distR > 1.0) discard;

            vec2 seedOff = vec2(vSeed * 29.3, fract(vSeed * 13.7) * 31.1);
            float n = smokeFbm(vLocal * 4.6 + seedOff + vec2(0.0, -vAge * 1.4));
            float droplets = pNoise(vLocal * 16.0 + seedOff * 2.1);
            float mask = (1.0 - smoothstep(0.2, 1.0, distR - (n - 0.5) * 0.45)) * smoothstep(0.28, 0.78, n * 0.7 + droplets * 0.3);
            float lifeFade = smoothstep(0.0, 0.08, vAge) * (1.0 - smoothstep(0.35, 1.0, vAge));
            float groundFade = smoothstep(-0.02, 0.16, vWorldPos.y);
            float alpha = clamp(mask * lifeFade * groundFade * vDensity * 0.34, 0.0, 0.42);
            if (alpha < 0.005) discard;

            vec3 sprayCol = mix(
              mix(uSkyHorizon * 0.85 + vec3(0.45, 0.52, 0.58), vec3(0.74, 0.82, 0.90), 0.5),
              vec3(0.24, 0.30, 0.38),
              uNightFactor * 0.7
            );
            float fogF = exp(-uFogDensity * uFogDensity * vCamDist * vCamDist);
            sprayCol = mix(uFogColor, sprayCol, fogF);
            gl_FragColor = vec4(sprayCol, alpha);
            return;
          }

          // -------------------------------------------------------------------
          // Kind 0: Photorealistic Volumetric Tire Smoke (Billowing Curl FBM)
          // -------------------------------------------------------------------
          vec2 c = vLocal; // -0.5 .. +0.5 in rotated billboard space
          float distR = length(c) * 2.0;
          if (distR > 0.99) discard;

          vec2 seedOff = vec2(vSeed * 43.17, fract(vSeed * 19.31) * 51.73);
          float swirlT = vAge * 1.25 + uTime * 0.12;
          vec2 p = c * 2.85 + seedOff;

          // Curl-like 2-octave domain warping makes smoke lobes billow and turn internally over life
          vec2 warp = vec2(
            smokeFbm2(p + vec2(swirlT, -swirlT * 0.55)),
            smokeFbm2(p + vec2(5.2 - swirlT * 0.45, 1.3 + swirlT * 0.72))
          );
          vec2 wp = p + (warp - 0.5) * (0.95 + vAge * 0.95);

          float fbmBase = smokeFbm(wp * 1.35);
          float billow = 1.0 - abs(fbmBase * 2.0 - 1.0);
          float fbmDetail = pNoise(wp * 4.8 + vec2(swirlT * 1.15, -swirlT * 0.75));
          float cloudTex = mix(fbmBase, billow, 0.34) * 0.76 + fbmDetail * 0.24;

          // Turbulent non-circular silhouette + guaranteed soft quad-margin fade (zero hard quad edges)
          float rWarped = distR - (cloudTex - 0.48) * (0.56 + vAge * 0.32);
          float quadMargin = 1.0 - smoothstep(0.66, 0.98, distR);
          float radialEnv = (1.0 - smoothstep(0.10, 0.96, rWarped)) * quadMargin;
          if (radialEnv <= 0.002) discard;

          float birthFade = smoothstep(0.0, 0.055, vAge);
          float ageErosion = smoothstep(0.20, 1.0, vAge) * 0.72;
          float wispDensity = smoothstep(ageErosion * 0.72, ageErosion * 0.72 + 0.42, cloudTex);
          float lifeFade = birthFade * (1.0 - pow(vAge, 2.05));
          float density = radialEnv * wispDensity * lifeFade;

          float groundFeather = smoothstep(-0.02, 0.22, vWorldPos.y);
          float nearCamFade = smoothstep(0.55, 1.55, vCamDist);
          float finalAlpha = clamp(density * vDensity * groundFeather * nearCamFade * 0.50, 0.0, 0.68);
          if (finalAlpha < 0.005) discard;

          // Pseudo-3D volumetric normal via 2-octave density-slope finite differences
          float d0 = smokeFbm2(wp * 1.35);
          float dX = smokeFbm2((wp + vec2(0.12, 0.0)) * 1.35);
          float dY = smokeFbm2((wp + vec2(0.0, 0.12)) * 1.35);
          float gx = (d0 - dX) * 3.4;
          float gy = (d0 - dY) * 3.4;

          float cs = cos(vRot);
          float sn = sin(vRot);
          vec2 screenC = vec2(c.x * cs + c.y * sn, -c.x * sn + c.y * cs);
          vec2 gradScreen = vec2(gx * cs + gy * sn, -gx * sn + gy * cs);

          vec3 localN = normalize(vec3(screenC.x * 1.25 + gradScreen.x, screenC.y * 1.25 + gradScreen.y, 0.68));
          vec3 worldN = normalize(vCamRight * localN.x + vCamUp * localN.y - vCamFwd * localN.z);

          // Wrapped solar lighting + internal self-shadowing (sunlit cauliflower crests vs cool shaded core pockets)
          vec3 sunDir = normalize(uSunDir);
          float NdotL = dot(worldN, sunDir);
          float wrapLight = clamp((NdotL + 0.55) / 1.55, 0.0, 1.0);
          float pocketShadow = smoothstep(0.24, 0.84, cloudTex);
          float topOcclusion = smoothstep(-0.48, 0.54, screenC.y + (cloudTex - 0.5) * 0.42);
          float lightMix = clamp(wrapLight * 0.54 + topOcclusion * 0.26 + pocketShadow * 0.20, 0.0, 1.0);

          vec3 litSmoke = mix(vec3(0.90, 0.91, 0.93), uSunColor * vec3(1.02, 0.98, 0.94), 0.58);
          vec3 shadowSmoke = mix(
            uSkyHorizon * 0.36 + vec3(0.18, 0.20, 0.24),
            uSkyZenith * 0.36 + vec3(0.09, 0.12, 0.18),
            uNightFactor
          );
          vec3 smokeCol = mix(shadowSmoke, litSmoke, smoothstep(0.08, 0.92, lightMix));

          // Henyey-Greenstein forward scattering rim glow through translucent edges
          vec3 viewRay = normalize(vWorldPos - cameraPosition);
          float sunFwd = max(dot(viewRay, sunDir), 0.0);
          float silverRim = hgPhase(sunFwd, 0.56) * (1.0 - density * 0.55) * 0.65 * (1.0 - uNightFactor * 0.85);
          smokeCol += uSunColor * silverRim;

          // Streetlamp sodium-vapor bounce on smoke plumes
          float lampGlow = 0.0;
          for (int i = 0; i < 6; i++) {
            vec3 dL = vWorldPos - uNearLamps[i];
            lampGlow += exp(-dot(dL, dL) * 0.0085);
          }
          smokeCol += vec3(1.0, 0.70, 0.34) * clamp(lampGlow, 0.0, 1.4) * (0.16 + 0.68 * uNightFactor);

          // Vehicle taillight crimson glow + headlight beam scatter in dusk/night smoke
          if (uCarLightActive > 0.05) {
            vec3 dTail = vWorldPos - uCarTaillightPos;
            float tailGlow = exp(-dot(dTail, dTail) * 0.16) * uCarLightActive;
            smokeCol += vec3(1.0, 0.12, 0.07) * tailGlow * (0.28 + 0.62 * uNightFactor);

            vec3 toSmoke = vWorldPos - uCarHeadlightPos;
            float hDist = length(toSmoke);
            vec3 hDir = toSmoke / max(hDist, 0.01);
            float hCone = smoothstep(0.72, 0.95, dot(hDir, uCarHeadlightDir));
            float hAtten = exp(-hDist * 0.055) * hCone * uCarLightActive;
            smokeCol += vec3(0.98, 0.96, 0.90) * hAtten * (0.25 + 0.75 * uNightFactor);
          }

          smokeCol += vec3(0.78, 0.88, 1.0) * uLightningFlash * 0.72;

          // Blend seamlessly into scene exponential fog at distance
          float fogF = exp(-uFogDensity * uFogDensity * vCamDist * vCamDist);
          smokeCol = mix(uFogColor, smokeCol, fogF);

          gl_FragColor = vec4(smokeCol, finalAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'volumetric_particle_system';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 13;
    // Start visible so boot compileAsync warms the shader cleanly; update() hides when idle
    this.mesh.visible = true;

    for (let i = 0; i < this.capacity; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: -50,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 0,
        life: 1,
        startSize: 0.4,
        endSize: 1.8,
        rot: 0,
        rotVel: 0,
        seed: Math.random(),
        density: 1,
        swirlPhase: 0,
        swirlAmp: 0,
        kind: 'smoke',
      });
    }
    scene.add(this.mesh);
  }

  public spawnBurst(
    x: number,
    y: number,
    z: number,
    count: number,
    kind: ParticleKind,
    opts?: ParticleBurstOptions,
  ): void {
    this.mesh.visible = true;
    const baseVx = opts?.vx ?? 0;
    const baseVy = opts?.vy ?? 0;
    const baseVz = opts?.vz ?? 0;
    const intensity = opts?.intensity ?? 0.75;

    for (let i = 0; i < count; i++) {
      const slot = this.particles[this.cursor];
      this.cursor = (this.cursor + 1) % this.capacity;

      slot.active = true;
      slot.age = 0;
      slot.kind = kind;
      slot.seed = Math.random();

      if (kind === 'spark') {
        const a = Math.random() * Math.PI * 2;
        const spd = 4.2 + Math.random() * 9.5;
        slot.x = x + (Math.random() - 0.5) * 0.25;
        slot.y = y + Math.random() * 0.22;
        slot.z = z + (Math.random() - 0.5) * 0.25;
        slot.vx = baseVx * 0.35 + Math.cos(a) * spd;
        slot.vy = baseVy + 2.4 + Math.random() * 5.6;
        slot.vz = baseVz * 0.35 + Math.sin(a) * spd;
        slot.life = 0.26 + Math.random() * 0.24;
        slot.startSize = 0.16 + Math.random() * 0.18;
        slot.endSize = 0.04;
        slot.rot = 0;
        slot.rotVel = 0;
        slot.density = 1.0;
        slot.swirlPhase = 0;
        slot.swirlAmp = 0;
      } else if (kind === 'spray') {
        slot.x = x + (Math.random() - 0.5) * 0.36;
        slot.y = y + Math.random() * 0.14;
        slot.z = z + (Math.random() - 0.5) * 0.36;
        slot.vx = baseVx + (Math.random() - 0.5) * 1.6;
        slot.vy = baseVy + 0.5 + Math.random() * 1.1;
        slot.vz = baseVz + (Math.random() - 0.5) * 1.6;
        slot.life = 0.32 + Math.random() * 0.24;
        slot.startSize = 0.38 + Math.random() * 0.24;
        slot.endSize = 1.35 + Math.random() * 0.65;
        slot.rot = Math.random() * Math.PI * 2;
        slot.rotVel = (Math.random() - 0.5) * 2.2;
        slot.density = 0.45 + intensity * 0.55;
        slot.swirlPhase = Math.random() * Math.PI * 2;
        slot.swirlAmp = 0.6;
      } else {
        // Multi-scale tire smoke: dense contact-patch core puffs + wider rising billowing wisps
        const isWisp = i % 2 === 1;
        const jitter = 0.18 + intensity * 0.14;
        slot.x = x + (Math.random() - 0.5) * jitter;
        slot.y = y + Math.random() * 0.10;
        slot.z = z + (Math.random() - 0.5) * jitter;

        const randSpread = 0.95 + intensity * 1.25;
        slot.vx = baseVx + (Math.random() - 0.5) * randSpread;
        slot.vy = baseVy + (isWisp ? 0.65 + Math.random() * 0.78 : 0.28 + Math.random() * 0.42);
        slot.vz = baseVz + (Math.random() - 0.5) * randSpread;

        slot.life = (isWisp ? 1.65 : 1.25) + Math.random() * 0.70 + intensity * 0.50;
        slot.startSize = (isWisp ? 0.48 : 0.38) + Math.random() * 0.18;
        slot.endSize = (isWisp ? 2.95 : 2.15) + Math.random() * 1.25 + intensity * 1.15;
        slot.rot = Math.random() * Math.PI * 2;
        slot.rotVel = (Math.random() > 0.5 ? 1 : -1) * (0.45 + Math.random() * 0.95);
        slot.density = (isWisp ? 0.72 : 1.0) * (0.58 + intensity * 0.42);
        slot.swirlPhase = Math.random() * Math.PI * 2;
        slot.swirlAmp = 1.05 + Math.random() * 1.15;
      }
    }
  }

  public update(dt: number, env?: ParticleEnvironmentParams): void {
    if (env) {
      this.uTime.value = env.timeSec;
      this.uSunColor.value.copy(env.sunColor);
      this.uFogColor.value.copy(env.fogColor);
      this.uFogDensity.value = env.fogDensity;
    } else {
      this.uTime.value += dt;
    }

    let activeCount = 0;

    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i];
      if (!p.active) {
        this.posScaleArray[i * 4 + 3] = 0;
        continue;
      }

      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        this.posScaleArray[i * 4 + 3] = 0;
        continue;
      }

      activeCount++;
      const t = p.age / p.life;

      if (p.kind === 'spark') {
        p.vy -= 18.0 * dt;
        p.vx *= Math.exp(-1.4 * dt);
        p.vz *= Math.exp(-1.4 * dt);
      } else if (p.kind === 'spray') {
        p.vx *= Math.exp(-3.4 * dt);
        p.vz *= Math.exp(-3.4 * dt);
        p.vy -= 2.1 * dt;
      } else {
        // Tire smoke aerodynamics: rapid drag from tire ejection into air, gentle thermal buoyancy & curl
        const drag = 2.6 + t * 1.5;
        const damp = Math.exp(-drag * dt);
        p.vx *= damp;
        p.vz *= damp;

        // Ambient cross-breeze & vortex curl spreads wake into wide billowing clouds
        const curlAngle = p.swirlPhase + p.age * 2.4;
        p.vx += (Math.cos(curlAngle) * p.swirlAmp + 0.42) * dt;
        p.vz += Math.sin(curlAngle) * p.swirlAmp * dt;

        // Warm rubber vapor rises gently and slows its ascent as it cools & expands
        const targetBuoyancy = (0.78 - t * 0.40) * p.density;
        p.vy += (targetBuoyancy - p.vy) * (1 - Math.exp(-2.8 * dt));
      }

      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.rot += p.rotVel * dt;

      // Sublinear volumetric expansion: bursts quickly from contact patch then billows wide
      const growth = Math.pow(t, 0.56);
      const scale = p.startSize + (p.endSize - p.startSize) * growth;

      const minGroundY = p.kind === 'smoke' ? 0.06 + scale * 0.24 : 0.05;
      p.y = Math.max(minGroundY, p.y + p.vy * dt);

      const i4 = i * 4;
      this.posScaleArray[i4] = p.x;
      this.posScaleArray[i4 + 1] = p.y;
      this.posScaleArray[i4 + 2] = p.z;
      this.posScaleArray[i4 + 3] = scale;

      this.motionArray[i4] = p.vx;
      this.motionArray[i4 + 1] = p.vy;
      this.motionArray[i4 + 2] = p.vz;
      this.motionArray[i4 + 3] = p.rot;

      this.lifeSeedArray[i4] = t;
      this.lifeSeedArray[i4 + 1] = p.seed;
      this.lifeSeedArray[i4 + 2] = KIND_ID[p.kind];
      this.lifeSeedArray[i4 + 3] = p.density;
    }

    this.mesh.visible = activeCount > 0;
    if (activeCount > 0) {
      this.posScaleAttr.needsUpdate = true;
      this.motionAttr.needsUpdate = true;
      this.lifeSeedAttr.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
