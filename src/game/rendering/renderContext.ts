import * as THREE from 'three';
import { CinematicPostProcessor } from '../postprocess';
import {
  createAdaptiveResolutionState,
  stepAdaptiveResolutionScale,
  type AdaptiveResolutionState,
} from '../simulation/renderInterpolation';
import type { WeatherType } from '../types';

/**
 * Clean rendering boundary abstracting renderer initialization, resize,
 * post-processing, and software-WebGL pacing.
 *
 * Freezing this contract keeps all simulation, world, entity, and UI modules
 * completely agnostic of WebGL2 vs. a future Phase 4 migration to
 * `THREE.WebGPURenderer` + TSL + `THREE.RenderPipeline`.
 */
export interface IRenderFrameParams {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  nowSec: number;
  inInterior: boolean;
  sunDirection: THREE.Vector3;
  weather: WeatherType;
  exposure: number;
  bloomStrength: number;
  nightFactor: number;
  warmth: number;
  rainIntensity?: number;
}

export interface IRenderBackend {
  readonly isSoftwareGl: boolean;
  readonly renderer: THREE.WebGLRenderer;
  readonly domElement: HTMLCanvasElement;
  resize(width: number, height: number): void;
  renderFrame(params: IRenderFrameParams): void;
  getMemorySnapshot(): { geometries: number; textures: number; programs: number };
  getRenderStats(): {
    calls: number;
    triangles: number;
    mainCalls: number;
    mainTriangles: number;
    geometries: number;
    textures: number;
    programs: number;
  };
  scheduleNextFrame(disposed: () => boolean, cb: () => void): number;
  cancelScheduledFrame(handle: number): void;
  dispose(): void;
}

const _sunWorldPos = new THREE.Vector3();
const _camFwd = new THREE.Vector3();

export function detectSoftwareWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export class WebGLRenderContext implements IRenderBackend {
  public readonly isSoftwareGl: boolean;
  public readonly renderer: THREE.WebGLRenderer;
  public readonly postProcessor: CinematicPostProcessor;
  private readonly container: HTMLElement;
  private readonly adaptiveRes: AdaptiveResolutionState = createAdaptiveResolutionState();
  private lastWidth = 1;
  private lastHeight = 1;
  private lastRenderNowMs = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.isSoftwareGl = detectSoftwareWebGL();

    const width = Math.max(1, container.clientWidth || window.innerWidth);
    const height = Math.max(1, container.clientHeight || window.innerHeight);
    this.lastWidth = width;
    this.lastHeight = height;

    // Scene renders into postProcessor.sceneTarget with MSAA; backbuffer only draws a fullscreen quad.
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    const maxDpr = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(maxDpr);
    this.renderer.setSize(width, height);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

    container.innerHTML = '';
    container.appendChild(this.renderer.domElement);

    this.postProcessor = new CinematicPostProcessor(
      this.renderer,
      width,
      height,
      this.isSoftwareGl,
    );
  }

  private activeFrameHandle = 0;

  public get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  public getMaxAnisotropy(): number {
    return this.isSoftwareGl ? 1 : Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
  }

  public resize(width: number, height: number): void {
    this.lastWidth = Math.max(1, width);
    this.lastHeight = Math.max(1, height);
    this.renderer.setSize(this.lastWidth, this.lastHeight);
    this.postProcessor.resize(
      this.renderer,
      this.lastWidth,
      this.lastHeight,
      this.isSoftwareGl ? 1.0 : this.adaptiveRes.scale,
    );
  }

  public renderFrame(params: IRenderFrameParams): void {
    const {
      scene,
      camera,
      nowSec,
      inInterior,
      sunDirection,
      weather,
      exposure,
      bloomStrength,
      nightFactor,
      warmth,
      rainIntensity,
    } = params;

    camera.getWorldDirection(_camFwd);
    const sunDot = _camFwd.dot(sunDirection);
    let sunScreenX = 0.5;
    let sunScreenY = 0.7;
    let sunVisibility = 0;

    if (!inInterior && sunDot > 0.15 && sunDirection.y > 0.03) {
      _sunWorldPos.copy(camera.position).addScaledVector(sunDirection, 220);
      _sunWorldPos.project(camera);
      sunScreenX = _sunWorldPos.x * 0.5 + 0.5;
      sunScreenY = _sunWorldPos.y * 0.5 + 0.5;
      const isRainy = weather === 'rain' || weather === 'storm';
      sunVisibility = isRainy
        ? 0
        : Math.max(0, Math.min(1, (sunDot - 0.15) * 1.45)) * (1 - nightFactor);
    }

    if (!this.isSoftwareGl) {
      const nowMs = nowSec * 1000;
      if (this.lastRenderNowMs > 0) {
        const frameMs = nowMs - this.lastRenderNowMs;
        if (frameMs > 2 && frameMs < 150) {
          const { scale, changed } = stepAdaptiveResolutionScale(this.adaptiveRes, frameMs, nowMs);
          if (changed) {
            this.postProcessor.resize(this.renderer, this.lastWidth, this.lastHeight, scale);
          }
        }
      }
      this.lastRenderNowMs = nowMs;
    }

    this.postProcessor.render(this.renderer, scene, camera, {
      timeSec: nowSec,
      exposure: inInterior ? 1.08 : exposure,
      bloomStrength: inInterior ? 0.22 : bloomStrength,
      nightFactor: inInterior ? 0.12 : nightFactor,
      sunScreenX,
      sunScreenY,
      sunVisibility,
      warmth: inInterior ? 0.22 : warmth,
      sharpenStrength: this.isSoftwareGl ? 0.18 : 0.30,
      rainIntensity: inInterior ? 0 : (rainIntensity ?? 0),
    });
  }

  public getMemorySnapshot(): { geometries: number; textures: number; programs: number } {
    return {
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      programs: this.renderer.info.programs?.length ?? 0,
    };
  }

  public getRenderStats(): {
    calls: number;
    triangles: number;
    mainCalls: number;
    mainTriangles: number;
    geometries: number;
    textures: number;
    programs: number;
  } {
    const main = this.postProcessor.getLastMainRenderStats();
    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      mainCalls: main.calls,
      mainTriangles: main.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      programs: this.renderer.info.programs?.length ?? 0,
    };
  }

  public scheduleNextFrame(isDisposed: () => boolean, cb: () => void): number {
    if (!this.isSoftwareGl) {
      this.activeFrameHandle = requestAnimationFrame(cb);
      return this.activeFrameHandle;
    }
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (gl && typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const startedAt = performance.now();
      const poll = (): void => {
        if (isDisposed()) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const status = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (status === gl.UNSIGNALED && performance.now() - startedAt < 1200) {
          this.activeFrameHandle = window.setTimeout(poll, 10);
        } else {
          if (sync) gl.deleteSync(sync);
          this.activeFrameHandle = window.setTimeout(cb, 80);
        }
      };
      this.activeFrameHandle = window.setTimeout(poll, 10);
      return this.activeFrameHandle;
    }
    this.activeFrameHandle = window.setTimeout(cb, 90);
    return this.activeFrameHandle;
  }

  public cancelScheduledFrame(handle: number): void {
    const h = handle || this.activeFrameHandle;
    if (this.isSoftwareGl) {
      clearTimeout(h);
      clearTimeout(this.activeFrameHandle);
    } else {
      cancelAnimationFrame(h);
      cancelAnimationFrame(this.activeFrameHandle);
    }
  }

  public dispose(): void {
    this.postProcessor.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
