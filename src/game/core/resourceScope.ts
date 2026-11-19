import * as THREE from 'three';

export interface DisposableResource {
  dispose: () => void;
}

/**
 * Hierarchical deterministic resource tracker ensuring zero GPU/VRAM leaks
 * across world resets, activity lifecycles, and engine unmount.
 *
 * Separate persistent engine-level caches (`engineScope`) from per-session
 * entity instances (`entityScope = engineScope.createChildScope()`).
 */
export class ResourceScope implements DisposableResource {
  private readonly disposables = new Set<DisposableResource>();
  private readonly cleanups: Array<() => void> = [];
  private readonly children = new Set<ResourceScope>();
  private readonly parent: ResourceScope | null;
  private disposed = false;

  constructor(parent: ResourceScope | null = null) {
    this.parent = parent;
  }

  public get isDisposed(): boolean {
    return this.disposed;
  }

  public get trackedCount(): number {
    let count = this.disposables.size + this.cleanups.length;
    for (const child of this.children) {
      count += child.trackedCount;
    }
    return count;
  }

  public track<T extends DisposableResource>(resource: T): T {
    if (this.disposed) {
      resource.dispose();
      return resource;
    }
    this.disposables.add(resource);
    return resource;
  }

  public trackCleanup(fn: () => void): void {
    if (this.disposed) {
      fn();
      return;
    }
    this.cleanups.push(fn);
  }

  /**
   * Registers all geometries and materials inside a Three.js scene subtree,
   * optionally skipping resources that belong to an external shared pool.
   */
  public trackObjectTree(
    root: THREE.Object3D,
    opts?: {
      skipGeometries?: ReadonlySet<THREE.BufferGeometry>;
      skipMaterials?: ReadonlySet<THREE.Material>;
      disposeMaps?: boolean;
    },
  ): void {
    const skipGeo = opts?.skipGeometries;
    const skipMat = opts?.skipMaterials;
    const disposeMaps = opts?.disposeMaps ?? false;

    root.traverse((obj) => {
      const meshLike = obj as {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      };

      if (meshLike.geometry && !skipGeo?.has(meshLike.geometry)) {
        this.track(meshLike.geometry);
      }

      if (meshLike.material) {
        const mats = Array.isArray(meshLike.material) ? meshLike.material : [meshLike.material];
        for (const m of mats) {
          if (skipMat?.has(m)) continue;
          if (disposeMaps) {
            const matRecord = m as unknown as Record<string, unknown>;
            for (const key of [
              'map',
              'normalMap',
              'roughnessMap',
              'metalnessMap',
              'emissiveMap',
              'bumpMap',
              'aoMap',
              'alphaMap',
            ]) {
              const tex = matRecord[key];
              if (tex && typeof (tex as DisposableResource).dispose === 'function') {
                this.track(tex as DisposableResource);
              }
            }
          }
          this.track(m);
        }
      }
    });
  }

  public createChildScope(): ResourceScope {
    const child = new ResourceScope(this);
    if (this.disposed) {
      child.dispose();
    } else {
      this.children.add(child);
    }
    return child;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const child of Array.from(this.children)) {
      child.dispose();
    }
    this.children.clear();

    for (let i = this.cleanups.length - 1; i >= 0; i--) {
      this.cleanups[i]();
    }
    this.cleanups.length = 0;

    for (const res of this.disposables) {
      res.dispose();
    }
    this.disposables.clear();

    if (this.parent) {
      this.parent.children.delete(this);
    }
  }
}

/**
 * Utility to dispose an arbitrary Three.js Object3D subtree directly when
 * tearing down transient groups (e.g. vehicles/peds on world reset).
 */
export function disposeObjectTree(
  root: THREE.Object3D,
  opts?: {
    skipGeometries?: ReadonlySet<THREE.BufferGeometry>;
    skipMaterials?: ReadonlySet<THREE.Material>;
    disposeMaps?: boolean;
  },
): void {
  const scope = new ResourceScope();
  scope.trackObjectTree(root, opts);
  scope.dispose();
}
