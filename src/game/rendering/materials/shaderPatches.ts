import * as THREE from 'three';

export interface SharedWeatherUniforms {
  uWetness: { value: number };
  uRainTime: { value: number };
  uWindTime: { value: number };
  uWindStrength: { value: number };
  uNightFactor: { value: number };
  uSunDir: { value: THREE.Vector3 };
}

export function createWeatherUniforms(): SharedWeatherUniforms {
  return {
    uWetness: { value: 0.0 },
    uRainTime: { value: 0.0 },
    uWindTime: { value: 0.0 },
    uWindStrength: { value: 0.25 },
    uNightFactor: { value: 0.15 },
    uSunDir: { value: new THREE.Vector3(-0.78, 0.32, -0.54).normalize() },
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
    shader.uniforms.uRainTime = uniforms.uRainTime;
    shader.uniforms.uPuddleStrength = { value: options.puddleStrength };
    shader.uniforms.uMicroScale = { value: options.microDetailScale };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vHyperWorldPos;
        varying vec3 vHyperWorldNormal;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vHyperWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vHyperWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uWetness;
        uniform float uRainTime;
        uniform float uPuddleStrength;
        uniform float uMicroScale;
        varying vec3 vHyperWorldPos;
        varying vec3 vHyperWorldNormal;

        float hrHash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
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
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float macroWeather = hrFbm(vHyperWorldPos.xz * 0.068) * 0.28 - 0.14;
        float midPatch = hrValueNoise(vHyperWorldPos.xz * 0.34) * 0.12 - 0.06;
        float microGrain = hrValueNoise(vHyperWorldPos.xz * uMicroScale) * 0.14 - 0.07;
        float oilSpot = smoothstep(0.68, 0.86, hrFbm(vHyperWorldPos.xz * 0.22 + vec2(4.3, 9.1)));
        diffuseColor.rgb *= (1.0 + macroWeather + midPatch + microGrain) * mix(1.0, 0.74, oilSpot * uPuddleStrength);
        float upFacing = clamp(vHyperWorldNormal.y, 0.0, 1.0);
        float puddleNoise = hrFbm(vHyperWorldPos.xz * 0.14);
        float puddleMask = smoothstep(0.42, 0.72, puddleNoise) * uWetness * upFacing * uPuddleStrength;
        diffuseColor.rgb *= mix(1.0, 0.52, uWetness * (0.45 + 0.55 * upFacing));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.68, puddleMask);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float hrUp = clamp(vHyperWorldNormal.y, 0.0, 1.0);
        float hrPuddleN = hrFbm(vHyperWorldPos.xz * 0.14);
        float hrPuddle = smoothstep(0.42, 0.72, hrPuddleN) * uWetness * hrUp * uPuddleStrength;
        float dryGlossPatch = smoothstep(0.45, 0.78, hrFbm(vHyperWorldPos.xz * 0.18 + vec2(11.2, 5.7)));
        float fineSparkle = hrValueNoise(vHyperWorldPos.xz * uMicroScale * 1.4);
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.62, dryGlossPatch * 0.55 * uPuddleStrength * hrUp);
        roughnessFactor = clamp(roughnessFactor + (fineSparkle - 0.5) * 0.16, 0.04, 0.98);
        float ripple = sin(length(fract(vHyperWorldPos.xz * 1.45) - 0.5) * 34.0 - uRainTime * 9.0) * 0.5 + 0.5;
        roughnessFactor = mix(roughnessFactor, max(0.06, roughnessFactor * 0.34), uWetness * hrUp);
        roughnessFactor = mix(roughnessFactor, 0.03 + ripple * 0.04 * uWetness, hrPuddle);`,
      );
  };
  material.customProgramCacheKey = () =>
    `hyperreal_wet_${options.puddleStrength}_${options.microDetailScale}`;
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
  material.customProgramCacheKey = () => `arch_pbr_v2_${aoHeight}_${microScale}`;
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
  material.customProgramCacheKey = () => `interior_map_v2_${kind}`;
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
  material.customProgramCacheKey = () =>
    `foliage_sss_v2_${withWind ? 'wind' : 'still'}_${tintHex.join('_')}`;
}
