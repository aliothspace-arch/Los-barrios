import type { ColliderAABB } from '../types';

/**
 * Uniform 2D Spatial Hash Grid for static world AABB colliders.
 *
 * Cuts per-frame collision checks from O(N * M) (~280+ colliders per entity)
 * down to O(N * k) where k is typically 2-6 nearby colliders in 16m cells,
 * using stamp deduplication and a reusable scratch buffer for zero GC pressure.
 */
export class SpatialHashGrid {
  public readonly cellSize: number;
  private readonly invCellSize: number;
  private readonly cells = new Map<number, ColliderAABB[]>();
  private readonly allColliders: readonly ColliderAABB[];
  private readonly indexByCollider = new Map<ColliderAABB, number>();
  private readonly seenStamp: Uint32Array;
  private currentStamp = 0;

  constructor(colliders: readonly ColliderAABB[], cellSize = 16) {
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    this.allColliders = colliders;
    this.seenStamp = new Uint32Array(colliders.length);

    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      this.indexByCollider.set(c, i);
      const minCX = Math.floor(c.minX * this.invCellSize);
      const maxCX = Math.floor(c.maxX * this.invCellSize);
      const minCZ = Math.floor(c.minZ * this.invCellSize);
      const maxCZ = Math.floor(c.maxZ * this.invCellSize);

      for (let cx = minCX; cx <= maxCX; cx++) {
        for (let cz = minCZ; cz <= maxCZ; cz++) {
          const key = SpatialHashGrid.cellKey(cx, cz);
          let bucket = this.cells.get(key);
          if (!bucket) {
            bucket = [];
            this.cells.set(key, bucket);
          }
          bucket.push(c);
        }
      }
    }
  }

  private static cellKey(cx: number, cz: number): number {
    // Supports coordinates up to +/- 32,767 cells (>500 km world at 16m cell size)
    return ((cx + 32768) << 16) | ((cz + 32768) & 0xffff);
  }

  public get colliderCount(): number {
    return this.allColliders.length;
  }

  public get bucketCount(): number {
    return this.cells.size;
  }

  /**
   * Populates `out` with all unique colliders intersecting the AABB query window
   * [minX, maxX] x [minZ, maxZ]. Zero allocations when caller reuses `out`.
   */
  public queryAABB(
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    out: ColliderAABB[],
  ): ColliderAABB[] {
    out.length = 0;
    this.currentStamp = (this.currentStamp + 1) >>> 0;
    if (this.currentStamp === 0) {
      this.seenStamp.fill(0);
      this.currentStamp = 1;
    }
    const stamp = this.currentStamp;

    const minCX = Math.floor(minX * this.invCellSize);
    const maxCX = Math.floor(maxX * this.invCellSize);
    const minCZ = Math.floor(minZ * this.invCellSize);
    const maxCZ = Math.floor(maxZ * this.invCellSize);

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        const bucket = this.cells.get(SpatialHashGrid.cellKey(cx, cz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const c = bucket[i];
          const idx = this.indexByCollider.get(c);
          if (idx === undefined) continue;
          if (this.seenStamp[idx] === stamp) continue;
          this.seenStamp[idx] = stamp;
          out.push(c);
        }
      }
    }
    return out;
  }

  /**
   * Convenience wrapper querying a circle's bounding box around (x, z).
   */
  public queryCircle(
    x: number,
    z: number,
    radius: number,
    out: ColliderAABB[],
  ): ColliderAABB[] {
    return this.queryAABB(x - radius, x + radius, z - radius, z + radius, out);
  }
}

export type StaticColliderSource = readonly ColliderAABB[] | SpatialHashGrid;
