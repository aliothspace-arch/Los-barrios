import * as THREE from 'three';

export interface SharedWeatherUniforms {
  uWetness: { value: number };
  uRainDensity: { value: number };
  uRainTime: { value: number };
  uWindTime: { value: number };
  uWindStrength: { value: number };
  uNightFactor: { value: number };
  uLightningFlash: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uSkyZenith: { value: THREE.Color };
  uSkyHorizon: { value: THREE.Color };
  uNearLamps: { value: THREE.Vector3[] };
  uCarHeadlightPos: { value: THREE.Vector3 };
  uCarHeadlightDir: { value: THREE.Vector3 };
  uCarTaillightPos: { value: THREE.Vector3 };
  uCarLightActive: { value: number };
  uCarSpeedNorm: { value: number };
}

export function createWeatherUniforms(): SharedWeatherUniforms {
  const defaultLamps: THREE.Vector3[] = [];
  for (let i = 0; i < 6; i++) {
    defaultLamps.push(new THREE.Vector3(0, 7.3, -14 - i * 16));
  }
  return {
    uWetness: { value: 0.0 },
    uRainDensity: { value: 0.0 },
    uRainTime: { value: 0.0 },
    uWindTime: { value: 0.0 },
    uWindStrength: { value: 0.25 },
    uNightFactor: { value: 0.15 },
    uLightningFlash: { value: 0.0 },
    uSunDir: { value: new THREE.Vector3(-0.78, 0.32, -0.54).normalize() },
    uSkyZenith: { value: new THREE.Color(0x0f223d) },
    uSkyHorizon: { value: new THREE.Color(0x826558) },
    uNearLamps: { value: defaultLamps },
    uCarHeadlightPos: { value: new THREE.Vector3(0, 0.65, 0) },
    uCarHeadlightDir: { value: new THREE.Vector3(0, 0, -1) },
    uCarTaillightPos: { value: new THREE.Vector3(0, 0.72, 2.2) },
    uCarLightActive: { value: 0.0 },
    uCarSpeedNorm: { value: 0.0 },
  };
}

export type InteriorWindowKind = 'store' | 'office' | 'residential';

/**
 * Isolated WebGL2 `onBeforeCompile` GLSL shader patches.
 * Centralizing all custom shader hooks in this module freezes a clean seam
 * so a future Phase 4 migration to Three.js r187+ WebGPU + TSL NodeMaterials
 * replaces only this file without touching world, entity, or simulation code.
 */
export function applyHyperrealWetSurfaceShader(
  material: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial,
  uniforms: SharedWeatherUniforms,
  options: { puddleStrength: number; microDetailScale: number } = {
    puddleStrength: 1.0,
    microDetailScale: 18.0,
  },
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWetness = uniforms.uWetness;
    shader.uniforms.uRainDensity = uniforms.uRainDensity;
    shader.uniforms.uRainTime = uniforms.uRainTime;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.uniforms.uNightFactor = uniforms.uNightFactor;
    shader.uniforms.uLightningFlash = uniforms.uLightningFlash;
    shader.uniforms.uSkyZenith = uniforms.uSkyZenith;
    shader.uniforms.uSkyHorizon = uniforms.uSkyHorizon;
    shader.uniforms.uNearLamps = uniforms.uNearLamps;
    shader.uniforms.uCarHeadlightPos = uniforms.uCarHeadlightPos;
    shader.uniforms.uCarHeadlightDir = uniforms.uCarHeadlightDir;
    shader.uniforms.uCarTaillightPos = uniforms.uCarTaillightPos;
    shader.uniforms.uCarLightActive = uniforms.uCarLightActive;
    shader.uniforms.uCarSpeedNorm = uniforms.uCarSpeedNorm;
    shader.uniforms.uPuddleStrength = { value: options.puddleStrength };
    shader.uniforms.uMicroScale = { value: options.microDetailScale };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vHyperWorldPos;
        varying vec3 vHyperWorldNormal;
        varying vec3 vViewWorldX;
        varying vec3 vViewWorldY;
        varying vec3 vViewWorldZ;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vHyperWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vHyperWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
        vViewWorldX = normalize((viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        vViewWorldY = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        vViewWorldZ = normalize((viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uWetness;
        uniform float uRainDensity;
        uniform float uRainTime;
        uniform float uWindStrength;
        uniform float uNightFactor;
        uniform float uLightningFlash;
        uniform vec3 uSkyZenith;
        uniform vec3 uSkyHorizon;
        uniform vec3 uNearLamps[6];
        uniform vec3 uCarHeadlightPos;
        uniform vec3 uCarHeadlightDir;
        uniform vec3 uCarTaillightPos;
        uniform float uCarLightActive;
        uniform float uCarSpeedNorm;
        uniform float uPuddleStrength;
        uniform float uMicroScale;

        varying vec3 vHyperWorldPos;
        varying vec3 vHyperWorldNormal;
        varying vec3 vViewWorldX;
        varying vec3 vViewWorldY;
        varying vec3 vViewWorldZ;

        float hrHash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        vec2 hrHash22(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.xx + p3.yz) * p3.zy);
        }

        float hrValueNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hrHash21(i);
          float b = hrHash21(i + vec2(1.0, 0.0));
          float c = hrHash21(i + vec2(0.0, 1.0));
          float d = hrHash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float hrFbm(vec2 p) {
          float v = 0.0;
          float amp = 0.5;
          for (int i = 0; i < 3; i++) {
            v += amp * hrValueNoise(p);
            p = p * 2.07 + vec2(17.1, 31.7);
            amp *= 0.5;
          }
          return v;
        }

        // Domain-warped organic road depression puddles + subtle tire-rut water retention
        float hrPuddleDepth(vec2 wp) {
          vec2 warp = vec2(
            hrValueNoise(wp * 0.095 + vec2(3.1, 8.7)),
            hrValueNoise(wp * 0.095 + vec2(19.4, 2.3))
          ) * 2.4;
          float macroPool = hrFbm(wp * 0.115 + warp * 0.35);
          float detailBreak = hrValueNoise(wp * 0.42 - warp * 0.25) * 0.22;
          float rutBias = 0.06 * (sin(wp.x * 1.15) * sin(wp.x * 1.15) + sin(wp.y * 1.15) * sin(wp.y * 1.15));
          return clamp(macroPool + detailBreak + rutBias - 0.10, 0.0, 1.0);
        }

        // Single stochastic cellular raindrop ripple layer returning xy surface slope (dH/dx, dH/dz)
        vec2 hrRippleLayer(vec2 wp, float scale, float speed, float timeVal, float rainAmt, float seedOff) {
          vec2 p = wp * scale;
          vec2 cell = floor(p);
          vec2 f = fract(p);
          vec2 grad = vec2(0.0);

          // Sample 3x3 neighborhood so circular wave rings cross cell boundaries seamlessly
          for (int j = -1; j <= 1; j++) {
            for (int i = -1; i <= 1; i++) {
              vec2 nb = cell + vec2(float(i), float(j));
              vec2 rnd = hrHash22(nb + seedOff);
              float spawnGate = smoothstep(rnd.x * 0.78, rnd.x * 0.78 + 0.18, rainAmt);
              if (spawnGate <= 0.01) continue;

              float cycleT = timeVal * (speed + rnd.y * 0.65) + rnd.x * 19.37 + rnd.y * 7.13;
              float cyc = floor(cycleT);
              float age = fract(cycleT);

              vec2 dropRnd = hrHash22(nb + cyc * 0.37 + seedOff);
              vec2 center = vec2(float(i), float(j)) + 0.22 + dropRnd * 0.56;
              vec2 diff = f - center;
              float dist = length(diff);

              float waveRadius = age * 0.56;
              float dr = dist - waveRadius;
              float envelope = exp(-dr * dr * 92.0) * (1.0 - age) * smoothstep(0.0, 0.07, age);
              float slope = cos(dr * 48.0) * envelope * spawnGate;
              grad += (diff / max(dist, 0.002)) * slope;
            }
          }
          return grad;
        }

        // Combined 3-layer fine raindrop ripple + wind micro-wave gradient in world XZ
        // Speed-adaptive LOD skips fine cellular layers beyond near field when driving fast.
        vec2 hrTotalRippleSlope(vec2 wp, float t, float rainAmt, float windAmt, float camDist, float speedNorm) {
          if (rainAmt < 0.03) return vec2(0.0);
          vec2 g1 = hrRippleLayer(wp, 4.8, 1.95, t, rainAmt, 1.7) * 0.068;
          float layer2MaxDist = mix(22.0, 9.5, speedNorm);
          vec2 g2 = camDist < layer2MaxDist
            ? hrRippleLayer(wp * mat2(0.8, -0.6, 0.6, 0.8), 8.2, 2.45, t, rainAmt, 11.3) * 0.045
            : vec2(0.0);
          float layer3MaxDist = mix(10.0, 4.5, speedNorm);
          vec2 g3 = camDist < layer3MaxDist
            ? hrRippleLayer(wp * mat2(0.6, 0.8, -0.8, 0.6), 13.5, 3.05, t, rainAmt, 29.1) * 0.026
            : vec2(0.0);
          // Subtle wind-blown capillary wavelets across standing puddles
          float wPhase = wp.x * 12.5 + wp.y * 4.8 - t * (5.2 + windAmt * 3.8);
          vec2 windSlope = vec2(cos(wPhase), 0.35 * sin(wPhase * 1.3)) * 0.014 * windAmt * (0.35 + 0.65 * rainAmt);
          return g1 + g2 + g3 + windSlope;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float hrUpFace = clamp(vHyperWorldNormal.y, 0.0, 1.0);
        float macroWeather = hrFbm(vHyperWorldPos.xz * 0.068) * 0.28 - 0.14;
        float midPatch = hrValueNoise(vHyperWorldPos.xz * 0.34) * 0.12 - 0.06;
        float microGrain = hrValueNoise(vHyperWorldPos.xz * uMicroScale) * 0.16 - 0.08;
        float oilSpot = smoothstep(0.68, 0.86, hrFbm(vHyperWorldPos.xz * 0.22 + vec2(4.3, 9.1)));
        diffuseColor.rgb *= (1.0 + macroWeather + midPatch + microGrain) * mix(1.0, 0.72, oilSpot * uPuddleStrength);

        float hrPuddleMask = 0.0;
        if (uWetness > 0.01 && hrUpFace > 0.05) {
          float hrDepth = hrPuddleDepth(vHyperWorldPos.xz);
          float puddleThresh = mix(0.92, 0.34, clamp(uWetness * 1.12, 0.0, 1.0));
          hrPuddleMask = smoothstep(puddleThresh - 0.08, puddleThresh + 0.14, hrDepth) * uWetness * hrUpFace * uPuddleStrength;
          float hrShoreRing = 4.0 * hrPuddleMask * (1.0 - hrPuddleMask);

          // Wet porous asphalt darkens significantly via internal water-film scattering traps
          float wetDarken = mix(1.0, 0.36, uWetness * (0.42 + 0.58 * hrUpFace));
          diffuseColor.rgb *= wetDarken;
          // Capillary soaked shoreline rim + deep puddle depth absorption
          diffuseColor.rgb *= 1.0 - hrShoreRing * 0.24 * uWetness;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.56, 0.62, 0.70), hrPuddleMask * 0.74);
        } else if (uWetness > 0.01) {
          diffuseColor.rgb *= mix(1.0, 0.36, uWetness * 0.42);
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float dryGlossPatch = smoothstep(0.45, 0.78, hrFbm(vHyperWorldPos.xz * 0.18 + vec2(11.2, 5.7)));
        float fineSparkle = hrValueNoise(vHyperWorldPos.xz * uMicroScale * 1.65);

        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.64, dryGlossPatch * 0.55 * uPuddleStrength * hrUpFace);
        roughnessFactor = clamp(roughnessFactor + (fineSparkle - 0.5) * 0.18, 0.03, 0.98);

        if (uWetness > 0.01 && hrUpFace > 0.05) {
          // Exposed damp asphalt aggregate sparkles (0.16..0.38), while deep puddles act like mirror glass (0.012..0.022)
          float dampRough = mix(0.18, 0.38, smoothstep(0.30, 0.85, fineSparkle));
          roughnessFactor = mix(roughnessFactor, dampRough, uWetness * hrUpFace * 0.88);
          roughnessFactor = mix(roughnessFactor, 0.012 + fineSparkle * 0.010, hrPuddleMask);
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        vec2 hrRippleGrad = vec2(0.0);
        if (uWetness > 0.05 && hrUpFace > 0.55) {
          float camDistR = distance(cameraPosition, vHyperWorldPos);
          float rippleMaxDist = mix(24.0, 14.5, uCarSpeedNorm);
          float rippleDistFade = smoothstep(rippleMaxDist, 5.5, camDistR);
          float rippleActivity = clamp(uWetness * (0.15 + 0.85 * uRainDensity), 0.0, 1.0) * rippleDistFade;
          hrRippleGrad = hrTotalRippleSlope(vHyperWorldPos.xz, uRainTime, rippleActivity, uWindStrength, camDistR, uCarSpeedNorm) * (0.20 + 0.88 * hrPuddleMask);

          // Self-leveling standing water flattens asphalt pebble bump and applies delicate raindrop ripple slopes
          vec3 waterWorldN = normalize(vec3(-hrRippleGrad.x, 1.0, -hrRippleGrad.y));
          vec3 waterViewN = normalize(
            vViewWorldX * waterWorldN.x +
            vViewWorldY * waterWorldN.y +
            vViewWorldZ * waterWorldN.z
          );
          normal = normalize(mix(normal, waterViewN, clamp(hrPuddleMask * 0.97 + rippleActivity * 0.08, 0.0, 0.98)));
        }`,
      )
      .replace(
        '#include <clearcoat_normal_fragment_maps>',
        `#include <clearcoat_normal_fragment_maps>
        #ifdef USE_CLEARCOAT
          if (uWetness > 0.05 && hrUpFace > 0.55) {
            vec3 ccWaterWorldN = normalize(vec3(-hrRippleGrad.x * 1.15, 1.0, -hrRippleGrad.y * 1.15));
            vec3 ccWaterViewN = normalize(
              vViewWorldX * ccWaterWorldN.x +
              vViewWorldY * ccWaterWorldN.y +
              vViewWorldZ * ccWaterWorldN.z
            );
            clearcoatNormal = normalize(mix(clearcoatNormal, ccWaterViewN, clamp(0.45 * uWetness + 0.55 * hrPuddleMask, 0.0, 0.98)));
          }
        #endif`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        if (uWetness > 0.04 && hrUpFace > 0.55) {
          // Perturbed world-space water & damp-asphalt normal
          float microPebbleTilt = (hrValueNoise(vHyperWorldPos.xz * uMicroScale * 1.1) - 0.5) * 0.24 * (1.0 - hrPuddleMask);
          float microPebbleTiltZ = (hrValueNoise(vHyperWorldPos.xz * uMicroScale * 1.1 + vec2(7.3, 13.1)) - 0.5) * 0.24 * (1.0 - hrPuddleMask);
          vec3 wetWorldN = normalize(vec3(
            -hrRippleGrad.x * 1.15 + microPebbleTilt,
            1.0,
            -hrRippleGrad.y * 1.15 + microPebbleTiltZ
          ));

          vec3 viewW = normalize(cameraPosition - vHyperWorldPos);
          float NdotV = clamp(dot(wetWorldN, viewW), 0.02, 1.0);
          // Physical Water IOR 1.333 Schlick Fresnel
          float fresnel = 0.024 + 0.976 * pow(1.0 - NdotV, 4.6);

          // 1. Live Sky, Storm Cloud & Lightning Mirror Reflection in Puddles + Wet Film
          vec3 reflDir = reflect(-viewW, wetWorldN);
          float skyH = clamp(reflDir.y, 0.0, 1.0);
          vec3 skyRefl = mix(uSkyHorizon * 1.18, uSkyZenith * 1.35, pow(skyH, 0.62));
          vec2 cloudReflUv = reflDir.xz / (skyH + 0.16) * 0.55 + vec2(uRainTime * 0.015, -uRainTime * 0.006);
          float cloudBand = smoothstep(0.32, 0.78, hrFbm(cloudReflUv));
          skyRefl = mix(skyRefl, mix(uSkyZenith * 0.65, uSkyHorizon * 1.25, 0.35), cloudBand * 0.55);
          skyRefl += vec3(0.75, 0.86, 1.0) * uLightningFlash * (0.85 + 0.65 * hrPuddleMask);

          float filmMask = clamp(uWetness * (0.34 + 0.66 * hrPuddleMask), 0.0, 1.0);
          float clarity = mix(0.28, 1.05, hrPuddleMask) * filmMask * uPuddleStrength;
          reflectedLight.indirectSpecular += skyRefl * fresnel * clarity * 0.88;

          // 2. Real-Time Sodium-Vapor Streetlamp Reflections & Elongated Wet-Road Columns
          vec3 lampAccum = vec3(0.0);
          vec3 lampDiffuseAccum = vec3(0.0);
          float lampNightBoost = 0.30 + 0.95 * uNightFactor;
          float shininessPuddle = mix(34.0, 220.0, hrPuddleMask);
          for (int i = 0; i < 6; i++) {
            vec3 toLamp = uNearLamps[i] - vHyperWorldPos;
            float distSq = dot(toLamp, toLamp);
            float dist = sqrt(distSq);
            vec3 L = toLamp / max(dist, 0.01);
            float atten = 1.0 / (1.0 + 0.0075 * distSq);

            // Warm pool illumination on wet aggregate beneath lamp
            float ndotl = max(dot(wetWorldN, L), 0.0);
            lampDiffuseAccum += vec3(1.0, 0.68, 0.32) * ndotl * atten * 0.36;

            // Anisotropic wet-asphalt reflection column (sharp mirror in puddles, vertical streak on damp film)
            vec3 H = normalize(L + viewW);
            float NdotH = max(dot(wetWorldN, H), 0.0);
            float specPuddle = pow(NdotH, shininessPuddle) * (0.45 + 1.85 * hrPuddleMask);
            // Elongated grazing sheen streak along camera-to-lamp corridor
            vec2 dirLampXZ = normalize(toLamp.xz + vec2(0.0001));
            vec2 dirCamXZ = normalize(cameraPosition.xz - vHyperWorldPos.xz + vec2(0.0001));
            float align = pow(max(dot(-dirCamXZ, dirLampXZ), 0.0), 14.0);
            float streak = align * exp(-abs(dot(wetWorldN.xz, vec2(-dirCamXZ.y, dirCamXZ.x))) * 9.0) * 0.42 * (1.0 - hrPuddleMask * 0.35);

            lampAccum += vec3(1.0, 0.72, 0.34) * (specPuddle + streak) * atten * (0.45 + 0.55 * fresnel);
          }

          // 3. Player Car Live Dual LED Headlights & Ruby Taillight Reflections on Wet Road
          if (uCarLightActive > 0.05) {
            vec3 carFwd = normalize(uCarHeadlightDir);
            vec3 carRight = normalize(cross(carFwd, vec3(0.0, 1.0, 0.0)));
            for (int side = -1; side <= 1; side += 2) {
              vec3 hPos = uCarHeadlightPos + carRight * (float(side) * 0.68);
              vec3 toRoad = vHyperWorldPos - hPos;
              float d = length(toRoad);
              vec3 dirToFrag = toRoad / max(d, 0.01);
              float cone = smoothstep(0.62, 0.96, dot(dirToFrag, carFwd));
              float hAtten = exp(-d * 0.048) * cone * uCarLightActive;

              vec3 Lh = normalize(hPos - vHyperWorldPos);
              vec3 Hh = normalize(Lh + viewW);
              float hSpec = pow(max(dot(wetWorldN, Hh), 0.0), mix(24.0, 160.0, hrPuddleMask));
              lampAccum += vec3(0.92, 0.97, 1.0) * (hSpec * 1.45 + 0.16 * fresnel) * hAtten;
              lampDiffuseAccum += vec3(0.90, 0.95, 1.0) * 0.42 * hAtten;

              // Ruby-red taillight puddle & asphalt reflection behind vehicle
              vec3 tPos = uCarTaillightPos + carRight * (float(side) * 0.64);
              vec3 toTail = tPos - vHyperWorldPos;
              float dtDist = length(toTail);
              float tAtten = exp(-dtDist * 0.16) * uCarLightActive;
              vec3 Lt = toTail / max(dtDist, 0.01);
              vec3 Ht = normalize(Lt + viewW);
              float tSpec = pow(max(dot(wetWorldN, Ht), 0.0), mix(18.0, 120.0, hrPuddleMask));
              lampAccum += vec3(1.0, 0.14, 0.10) * tSpec * 1.25 * tAtten;
            }
          }

          reflectedLight.directDiffuse += diffuseColor.rgb * lampDiffuseAccum * lampNightBoost * uWetness;
          reflectedLight.indirectSpecular += lampAccum * lampNightBoost * uWetness * (0.52 + 0.48 * uPuddleStrength);
        }`,
      );
  };
  material.customProgramCacheKey = () => 'hyperreal_wet_v4';
}

export function applyArchitecturalPBRShader(
  material: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial,
  uniforms: SharedWeatherUniforms,
  options: { aoHeight?: number; microScale?: number } = {},
): void {
  const aoHeight = options.aoHeight ?? 2.6;
  const microScale = options.microScale ?? 4.5;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWetness = uniforms.uWetness;
    shader.uniforms.uAoHeight = { value: aoHeight };
    shader.uniforms.uMicroScale = { value: microScale };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vArchWorldPos;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vArchWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uWetness;
        uniform float uAoHeight;
        uniform float uMicroScale;
        varying vec3 vArchWorldPos;

        float archHash(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.5);
          return fract(p.x * p.y);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float groundAo = mix(0.46, 1.0, smoothstep(0.0, uAoHeight, max(0.0, vArchWorldPos.y)));
        float baseSplashGrime = mix(0.76, 1.0, smoothstep(0.0, 0.65, max(0.0, vArchWorldPos.y)));
        float rainStreak = 0.92 + 0.08 * sin(vArchWorldPos.x * 1.9 + vArchWorldPos.z * 2.3) * sin(vArchWorldPos.y * 0.35);
        float macroDirt = 0.90 + 0.16 * archHash(floor(vArchWorldPos.xz * 0.25 + floor(vArchWorldPos.y * 0.18) * 7.3));
        float grain = archHash(floor((vArchWorldPos.xz + vArchWorldPos.y * 0.7) * uMicroScale)) * 0.10 - 0.05;
        diffuseColor.rgb *= groundAo * baseSplashGrime * rainStreak * (0.94 + macroDirt * 0.06 + grain);
        diffuseColor.rgb *= mix(1.0, 0.70, uWetness * 0.68);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, max(0.16, roughnessFactor * 0.52), uWetness * 0.65);`,
      );
  };
  material.customProgramCacheKey = () => 'arch_pbr_v3';
}

export function applyInteriorMappingShader(
  material: THREE.MeshPhysicalMaterial,
  uniforms: SharedWeatherUniforms,
  kind: InteriorWindowKind,
): void {
  const kindId = kind === 'store' ? 0 : kind === 'office' ? 1 : 2;
  const roomW = kind === 'store' ? 3.4 : kind === 'office' ? 3.1 : 2.5;
  const roomH = kind === 'store' ? 3.1 : kind === 'office' ? 3.4 : 2.7;
  const roomD = kind === 'store' ? 1.4 : kind === 'office' ? 1.15 : 1.0;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNightFactor = uniforms.uNightFactor;
    shader.uniforms.uSunDir = uniforms.uSunDir;
    shader.uniforms.uRoomScale = { value: new THREE.Vector3(roomW, roomH, roomD) };
    shader.uniforms.uKindId = { value: kindId };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vIntWorldPos;
        varying vec3 vIntWorldNormal;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vIntWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vIntWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uNightFactor;
        uniform vec3 uSunDir;
        uniform vec3 uRoomScale;
        uniform float uKindId;
        varying vec3 vIntWorldPos;
        varying vec3 vIntWorldNormal;

        float intHash21(vec2 p) {
          p = fract(p * vec2(234.34, 435.345));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 N = normalize(vIntWorldNormal);
        vec3 upRef = abs(N.y) < 0.98 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 T = normalize(cross(upRef, N));
        vec3 B = normalize(cross(N, T));

        vec3 V = normalize(vIntWorldPos - cameraPosition);
        vec2 planeCoord = vec2(dot(vIntWorldPos, T) / uRoomScale.x, dot(vIntWorldPos, B) / uRoomScale.y);
        vec2 cell = floor(planeCoord);
        vec2 localUV = fract(planeCoord);

        vec2 roomSeed = cell + floor(vIntWorldPos.xz * 0.06) * 13.7;
        float rnd1 = intHash21(roomSeed);
        float rnd2 = intHash21(roomSeed + 19.3);
        float rnd3 = intHash21(roomSeed + 47.1);

        float depth = uRoomScale.z;
        vec3 ray = vec3(dot(V, T), dot(V, B), max(0.08, -dot(V, N)));
        float rx = abs(ray.x) < 0.0005 ? 0.0005 : ray.x;
        float ry = abs(ray.y) < 0.0005 ? 0.0005 : ray.y;
        float tx = (step(0.0, ray.x) - localUV.x) / rx;
        float ty = (step(0.0, ray.y) - localUV.y) / ry;
        float tz = depth / ray.z;
        float tHit = min(min(tx, ty), tz);
        vec3 hit = vec3(localUV, 0.0) + ray * tHit;
        float depthShade = mix(1.0, 0.42, clamp(hit.z / depth, 0.0, 1.0));

        float litThresh = uKindId < 0.5 ? 0.16 : (uKindId < 1.5 ? 0.42 : 0.48);
        float isLit = step(litThresh - uNightFactor * 0.22, rnd1);
        vec3 warmTone = mix(vec3(1.0, 0.80, 0.54), vec3(0.84, 0.92, 1.0), step(0.68, rnd2));
        vec3 roomBase = vec3(0.05, 0.06, 0.08);

        if (hit.y > 0.96) {
          float panel = step(0.22, hit.x) * step(hit.x, 0.78) * step(0.18, hit.z / depth) * step(hit.z / depth, 0.82);
          roomBase = mix(vec3(0.16, 0.15, 0.14), warmTone * 1.45, panel * isLit);
        } else if (hit.y < 0.04) {
          float tileCheck = mod(floor(hit.x * 6.0) + floor((hit.z / depth) * 6.0), 2.0);
          vec3 floorCol = uKindId < 0.5 ? mix(vec3(0.28, 0.27, 0.25), vec3(0.20, 0.19, 0.18), tileCheck) : vec3(0.18, 0.14, 0.11);
          roomBase = floorCol * mix(0.28, 0.95, isLit);
        } else if (hit.z > depth - 0.04) {
          if (uKindId < 0.5) {
            float shelfRow = step(0.14, fract(hit.y * 5.2));
            float coolerZone = step(0.62, hit.x);
            vec3 shelfCol = mix(vec3(0.28, 0.16, 0.12), vec3(0.68, 0.54, 0.34), fract(hit.x * 7.0 + floor(hit.y * 5.2) * 0.37));
            vec3 coolerCol = mix(vec3(0.55, 0.82, 0.98), vec3(0.85, 0.95, 1.0), shelfRow);
            vec3 wallCol = mix(shelfCol * shelfRow, coolerCol, coolerZone);
            wallCol = mix(vec3(0.14, 0.12, 0.11), wallCol, smoothstep(0.22, 0.26, hit.y));
            roomBase = wallCol * mix(0.25, 1.05, isLit);
          } else if (uKindId < 1.5) {
            vec3 wallCol = mix(vec3(0.42, 0.39, 0.35), vec3(0.32, 0.36, 0.40), rnd3);
            float desk = step(hit.y, 0.30);
            float monitor = step(0.38, hit.x) * step(hit.x, 0.62) * step(0.30, hit.y) * step(hit.y, 0.48);
            wallCol = mix(wallCol, vec3(0.14, 0.13, 0.12), desk);
            wallCol = mix(wallCol, vec3(0.45, 0.72, 0.95) * 1.15, monitor * isLit);
            roomBase = wallCol * warmTone * mix(0.18, 0.78, isLit);
          } else {
            float lampGlow = exp(-length((hit.xy - vec2(0.5, 0.58)) * vec2(1.4, 1.8)));
            vec3 wallCol = mix(vec3(0.36, 0.31, 0.26), vec3(0.46, 0.40, 0.33), rnd3);
            float sofa = step(hit.y, 0.28) * step(0.15, hit.x) * step(hit.x, 0.85);
            wallCol = mix(wallCol, vec3(0.12, 0.10, 0.09), sofa);
            roomBase = wallCol * (0.14 + isLit * (0.35 + lampGlow * 0.72)) * warmTone;
          }
        } else {
          vec3 sideCol = mix(vec3(0.26, 0.24, 0.22), vec3(0.34, 0.32, 0.30), rnd2);
          roomBase = sideCol * warmTone * mix(0.16, 0.65, isLit);
        }

        vec3 interiorCol = roomBase * depthShade;

        if (uKindId > 0.5) {
          float blindDrop = 0.58 + rnd3 * 0.34;
          if (localUV.y > blindDrop) {
            float slats = 0.68 + 0.32 * sin(localUV.y * 120.0);
            interiorCol = mix(interiorCol * 0.35, vec3(0.34, 0.31, 0.28) * slats * mix(0.45, 0.9, isLit), 0.78);
          }
        }

        float NdotV = clamp(dot(N, -V), 0.0, 1.0);
        float fresnel = 0.09 + 0.91 * pow(1.0 - NdotV, 3.6);
        vec3 R = reflect(V, N);
        vec3 sunD = normalize(uSunDir);
        vec3 skyZen = mix(vec3(0.10, 0.24, 0.46), vec3(0.02, 0.04, 0.09), uNightFactor);
        vec3 skyHor = mix(vec3(0.92, 0.54, 0.28), vec3(0.09, 0.13, 0.22), uNightFactor);
        vec3 gndRef = mix(vec3(0.07, 0.06, 0.05), vec3(0.03, 0.03, 0.05), uNightFactor);
        vec3 envRefl = R.y >= 0.0
          ? mix(skyHor, skyZen, pow(clamp(R.y, 0.0, 1.0), 0.52))
          : mix(skyHor * 0.36, gndRef, clamp(-R.y * 3.8, 0.0, 1.0));
        float sunGlint = pow(max(dot(R, sunD), 0.0), 42.0) * (1.0 - uNightFactor * 0.9);
        envRefl += vec3(1.45, 0.92, 0.52) * sunGlint;

        float dayInteriorDim = uKindId < 0.5 ? mix(0.48, 1.18, uNightFactor) : mix(0.22, 1.12, uNightFactor);
        vec2 edgeD = min(localUV, 1.0 - localUV);
        float frameAO = smoothstep(0.0, 0.08, min(edgeD.x, edgeD.y));
        float glassWeight = clamp(fresnel * mix(1.32, 0.72, uNightFactor), 0.22, 0.90);
        vec3 litRoom = interiorCol * dayInteriorDim;
        vec3 finalPane = mix(litRoom, envRefl * 0.96, glassWeight) * mix(0.38, 1.0, frameAO);

        diffuseColor.rgb = finalPane * 0.14;
        totalEmissiveRadiance += finalPane * mix(0.76, 1.05, uNightFactor);`,
      );
  };
  material.customProgramCacheKey = () => 'interior_map_v3';
}

export function applyFoliageBacklightShader(
  material: THREE.MeshStandardMaterial,
  uniforms: SharedWeatherUniforms,
  tintHex: [number, number, number],
  withWind = false,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = uniforms.uWindTime;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.uniforms.uNightFactor = uniforms.uNightFactor;
    shader.uniforms.uBacklightTint = { value: new THREE.Vector3(...tintHex) };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uWindTime;
        uniform float uWindStrength;
        varying vec3 vLeafWorldPos;
        varying float vLeafTipFactor;`,
      )
      .replace(
        '#include <begin_vertex>',
        withWind
          ? `#include <begin_vertex>
            float tipFactor = clamp(1.0 - uv.y, 0.0, 1.0);
            float radialTip = clamp(length(position.yz) / 4.8, 0.0, 1.0);
            vLeafTipFactor = radialTip;
            vec3 instWorldOrigin = vec3(0.0);
            #ifdef USE_INSTANCING
              instWorldOrigin = instanceMatrix[3].xyz;
            #endif
            float gustPhase = uWindTime * 1.9 + instWorldOrigin.x * 0.13 + instWorldOrigin.z * 0.09 + position.x * 0.55;
            float primarySway = sin(gustPhase) * (0.55 + 0.45 * sin(uWindTime * 0.65 + instWorldOrigin.z * 0.07));
            float tipFlutter = sin(uWindTime * 5.4 + instWorldOrigin.x * 0.7 + position.z * 2.2 + abs(position.x) * 3.1) * 0.16;
            float bend = (primarySway + tipFlutter) * uWindStrength * radialTip * radialTip;
            transformed.x += bend * 0.72;
            transformed.y -= abs(bend) * 0.28 - tipFlutter * uWindStrength * radialTip * 0.22;
            transformed.z += primarySway * uWindStrength * radialTip * 0.18;`
          : `#include <begin_vertex>
            vLeafTipFactor = clamp(uv.y, 0.0, 1.0);`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        #ifdef USE_INSTANCING
          vLeafWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vLeafWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uNightFactor;
        uniform vec3 uBacklightTint;
        varying vec3 vLeafWorldPos;
        varying float vLeafTipFactor;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 leafV = normalize(vLeafWorldPos - cameraPosition);
        vec3 approxSun = normalize(vec3(-0.78, 0.38, -0.49));
        float backScatter = pow(clamp(dot(leafV, approxSun), 0.0, 1.0), 2.4);
        float tipThinness = 0.55 + 0.45 * vLeafTipFactor;
        float dayWeight = 1.0 - uNightFactor * 0.86;
        totalEmissiveRadiance += diffuseColor.rgb * uBacklightTint * (0.11 + backScatter * 0.72 * tipThinness) * dayWeight;`,
      );
  };
  material.customProgramCacheKey = () => `foliage_sss_v3_${withWind ? 'wind' : 'still'}`;
}
