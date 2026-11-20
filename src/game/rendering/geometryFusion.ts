import * as THREE from 'three';

export interface GeometryMergeEntry {
  geo: THREE.BufferGeometry;
  matrix?: THREE.Matrix4;
}

const _vPos = new THREE.Vector3();
const _vNorm = new THREE.Vector3();
const _normMat = new THREE.Matrix3();
const _groupInv = new THREE.Matrix4();
const _relMat = new THREE.Matrix4();

/**
 * Pure, indexed-preserving BufferGeometry merger.
 * Combines multiple geometries (with optional per-entry transform matrices) into a single
 * compact indexed BufferGeometry while preserving vertex sharing, normals, UVs, and optional
 * vertex colors (AO). Automatically flips triangle winding for negative-determinant mirrors.
 */
export function mergeGeometryEntries(
  entries: readonly GeometryMergeEntry[],
  options: { includeColor?: boolean; markShared?: boolean } = {},
): THREE.BufferGeometry {
  if (entries.length === 0) {
    return new THREE.BufferGeometry();
  }

  let totalVerts = 0;
  let totalIndices = 0;
  let hasColor = Boolean(options.includeColor);

  for (let i = 0; i < entries.length; i++) {
    const g = entries[i].geo;
    const pos = g.attributes.position;
    if (!pos || pos.count === 0) continue;
    totalVerts += pos.count;
    totalIndices += g.index ? g.index.count : pos.count;
    if (g.attributes.color) hasColor = true;
  }

  if (totalVerts === 0 || totalIndices === 0) {
    return new THREE.BufferGeometry();
  }

  const posOut = new Float32Array(totalVerts * 3);
  const normOut = new Float32Array(totalVerts * 3);
  const uvOut = new Float32Array(totalVerts * 2);
  const colOut = hasColor ? new Float32Array(totalVerts * 3) : null;
  const idxOut =
    totalVerts > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);

  let vOffset = 0;
  let iOffset = 0;

  for (let e = 0; e < entries.length; e++) {
    const entry = entries[e];
    const g = entry.geo;
    const pos = g.attributes.position;
    if (!pos || pos.count === 0) continue;

    let norm = g.attributes.normal;
    if (!norm) {
      g.computeVertexNormals();
      norm = g.attributes.normal;
    }
    const uv = g.attributes.uv;
    const col = g.attributes.color;
    const count = pos.count;
    const mat = entry.matrix;

    let flipWinding = false;
    if (mat) {
      _normMat.getNormalMatrix(mat);
      flipWinding = mat.determinant() < 0;
      for (let i = 0; i < count; i++) {
        _vPos.fromBufferAttribute(pos, i).applyMatrix4(mat);
        const o3 = (vOffset + i) * 3;
        posOut[o3] = _vPos.x;
        posOut[o3 + 1] = _vPos.y;
        posOut[o3 + 2] = _vPos.z;

        if (norm) {
          _vNorm.fromBufferAttribute(norm, i).applyMatrix3(_normMat).normalize();
          normOut[o3] = _vNorm.x;
          normOut[o3 + 1] = _vNorm.y;
          normOut[o3 + 2] = _vNorm.z;
        } else {
          normOut[o3] = 0;
          normOut[o3 + 1] = 1;
          normOut[o3 + 2] = 0;
        }
      }
    } else {
      for (let i = 0; i < count; i++) {
        const o3 = (vOffset + i) * 3;
        posOut[o3] = pos.getX(i);
        posOut[o3 + 1] = pos.getY(i);
        posOut[o3 + 2] = pos.getZ(i);

        if (norm) {
          normOut[o3] = norm.getX(i);
          normOut[o3 + 1] = norm.getY(i);
          normOut[o3 + 2] = norm.getZ(i);
        } else {
          normOut[o3] = 0;
          normOut[o3 + 1] = 1;
          normOut[o3 + 2] = 0;
        }
      }
    }

    if (uv) {
      for (let i = 0; i < count; i++) {
        const o2 = (vOffset + i) * 2;
        uvOut[o2] = uv.getX(i);
        uvOut[o2 + 1] = uv.getY(i);
      }
    }

    if (colOut) {
      if (col) {
        for (let i = 0; i < count; i++) {
          const o3 = (vOffset + i) * 3;
          colOut[o3] = col.getX(i);
          colOut[o3 + 1] = col.getY(i);
          colOut[o3 + 2] = col.getZ(i);
        }
      } else {
        const start3 = vOffset * 3;
        colOut.fill(1.0, start3, start3 + count * 3);
      }
    }

    if (g.index) {
      const idx = g.index;
      const ic = idx.count;
      if (flipWinding) {
        for (let i = 0; i + 2 < ic; i += 3) {
          idxOut[iOffset++] = idx.getX(i) + vOffset;
          idxOut[iOffset++] = idx.getX(i + 2) + vOffset;
          idxOut[iOffset++] = idx.getX(i + 1) + vOffset;
        }
      } else {
        for (let i = 0; i < ic; i++) {
          idxOut[iOffset++] = idx.getX(i) + vOffset;
        }
      }
    } else if (flipWinding) {
      for (let i = 0; i + 2 < count; i += 3) {
        idxOut[iOffset++] = vOffset + i;
        idxOut[iOffset++] = vOffset + i + 2;
        idxOut[iOffset++] = vOffset + i + 1;
      }
    } else {
      for (let i = 0; i < count; i++) {
        idxOut[iOffset++] = vOffset + i;
      }
    }

    vOffset += count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(posOut, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normOut, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvOut, 2));
  if (colOut) {
    merged.setAttribute('color', new THREE.BufferAttribute(colOut, 3));
  }
  merged.setIndex(new THREE.BufferAttribute(idxOut, 1));
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  if (options.markShared) {
    merged.userData.shared = true;
  }
  return merged;
}

/**
 * Convenience wrapper for merging geometries that are already in the same local space.
 */
export function mergeBufferGeometries(
  geometries: readonly THREE.BufferGeometry[],
  options: { includeColor?: boolean; markShared?: boolean } = {},
): THREE.BufferGeometry {
  const entries: GeometryMergeEntry[] = new Array(geometries.length);
  for (let i = 0; i < geometries.length; i++) {
    entries[i] = { geo: geometries[i] };
  }
  return mergeGeometryEntries(entries, options);
}

/**
 * Fuses static child meshes inside a Group by `(material, castShadow, receiveShadow, renderOrder)`
 * into minimal merged meshes with frozen transforms (`matrixAutoUpdate = false`).
 * Preserves any objects in `exclude` (and their descendants) untouched.
 */
export function fuseStaticGroupByMaterial(
  group: THREE.Group,
  options: { exclude?: Set<THREE.Object3D>; markShared?: boolean } = {},
): { beforeMeshes: number; afterMeshes: number } {
  group.updateMatrixWorld(true);
  _groupInv.copy(group.matrixWorld).invert();

  const exclude = options.exclude;
  const isExcluded = (obj: THREE.Object3D): boolean => {
    if (!exclude || exclude.size === 0) return false;
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (exclude.has(cur)) return true;
      if (cur === group) break;
      cur = cur.parent;
    }
    return false;
  };

  interface Bucket {
    material: THREE.Material;
    castShadow: boolean;
    receiveShadow: boolean;
    renderOrder: number;
    meshes: THREE.Mesh[];
    entries: GeometryMergeEntry[];
  }

  const buckets = new Map<string, Bucket>();
  let beforeMeshes = 0;

  const candidates: THREE.Mesh[] = [];
  group.traverse((obj) => {
    if (obj === group) return;
    if (!(obj instanceof THREE.Mesh)) return;
    if (obj instanceof THREE.InstancedMesh || obj instanceof THREE.SkinnedMesh) return;
    if (Array.isArray(obj.material)) return;
    if (!obj.visible) return;
    if (isExcluded(obj)) return;
    candidates.push(obj);
  });

  beforeMeshes = candidates.length;

  for (let i = 0; i < candidates.length; i++) {
    const mesh = candidates[i];
    const mat = mesh.material as THREE.Material;
    const key = `${mat.uuid}|${mesh.castShadow ? 1 : 0}|${mesh.receiveShadow ? 1 : 0}|${mesh.renderOrder}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        material: mat,
        castShadow: mesh.castShadow,
        receiveShadow: mesh.receiveShadow,
        renderOrder: mesh.renderOrder,
        meshes: [],
        entries: [],
      };
      buckets.set(key, bucket);
    }
    const rel = _relMat.multiplyMatrices(_groupInv, mesh.matrixWorld).clone();
    bucket.meshes.push(mesh);
    bucket.entries.push({ geo: mesh.geometry, matrix: rel });
  }

  let afterMeshes = 0;
  for (const bucket of buckets.values()) {
    if (bucket.meshes.length === 1) {
      const m = bucket.meshes[0];
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      afterMeshes += 1;
      continue;
    }
    const mergedGeo = mergeGeometryEntries(bucket.entries, {
      markShared: options.markShared,
    });
    const mergedMesh = new THREE.Mesh(mergedGeo, bucket.material);
    mergedMesh.castShadow = bucket.castShadow;
    mergedMesh.receiveShadow = bucket.receiveShadow;
    mergedMesh.renderOrder = bucket.renderOrder;
    mergedMesh.matrixAutoUpdate = false;
    mergedMesh.updateMatrix();
    group.add(mergedMesh);
    afterMeshes += 1;

    for (let i = 0; i < bucket.meshes.length; i++) {
      const m = bucket.meshes[i];
      m.parent?.remove(m);
      if (!m.geometry.userData?.shared) {
        m.geometry.dispose();
      }
    }
  }

  // Prune now-empty child groups (excluding anything in exclude)
  const pruneEmptyGroups = (parent: THREE.Object3D): void => {
    for (let i = parent.children.length - 1; i >= 0; i--) {
      const child = parent.children[i];
      if (child instanceof THREE.Group && !isExcluded(child)) {
        pruneEmptyGroups(child);
        if (child.children.length === 0) {
          parent.remove(child);
        }
      }
    }
  };
  pruneEmptyGroups(group);

  return { beforeMeshes, afterMeshes };
}

/**
 * Freezes `matrixAutoUpdate = false` on all meshes/groups under `root` except those in `exclude`.
 */
export function freezeStaticHierarchy(
  root: THREE.Object3D,
  exclude?: Set<THREE.Object3D>,
): void {
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (exclude?.has(obj)) return;
    obj.matrixAutoUpdate = false;
    obj.updateMatrix();
  });
}

export interface ParametricGridMeta {
  uSegs: number;
  vSegs: number;
  flipWinding: boolean;
}

/**
 * Exact boundary-preserving grid subsampler for regular `(uSegs + 1) x (vSegs + 1)`
 * parametric surfaces (such as Class-A hypercar body panels, tubes, and airfoils).
 * Always preserves u=0, u=uSegs, v=0, and v=vSegs so panel seams stay 100% watertight
 * while reducing triangle count by ~stride^2 for distant LOD1 rendering.
 */
export function downsampleParametricGrid(
  geo: THREE.BufferGeometry,
  stride = 3,
): THREE.BufferGeometry {
  const meta = geo.userData?.grid as ParametricGridMeta | undefined;
  if (!meta || stride <= 1) {
    return geo.clone();
  }
  const { uSegs, vSegs, flipWinding } = meta;
  const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos || pos.count !== (uSegs + 1) * (vSegs + 1)) {
    return geo.clone();
  }
  if (uSegs <= 3 && vSegs <= 3) {
    return geo.clone();
  }

  const buildSamples = (segs: number): number[] => {
    if (segs <= 2) {
      const all: number[] = [];
      for (let i = 0; i <= segs; i++) all.push(i);
      return all;
    }
    const step = Math.min(stride, Math.max(1, Math.floor(segs / 2)));
    const out: number[] = [];
    for (let i = 0; i < segs; i += step) {
      out.push(i);
    }
    if (out[out.length - 1] !== segs) {
      out.push(segs);
    }
    return out;
  };

  const uSamples = buildSamples(uSegs);
  const vSamples = buildSamples(vSegs);
  const nu = uSamples.length;
  const nv = vSamples.length;
  const newVertCount = nu * nv;

  const norm = geo.attributes.normal as THREE.BufferAttribute | undefined;
  const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;

  const posOut = new Float32Array(newVertCount * 3);
  const normOut = norm ? new Float32Array(newVertCount * 3) : null;
  const uvOut = uv ? new Float32Array(newVertCount * 2) : null;

  const srcVCount = vSegs + 1;
  let dst = 0;
  for (let iu = 0; iu < nu; iu++) {
    const srcU = uSamples[iu];
    for (let iv = 0; iv < nv; iv++) {
      const srcIdx = srcU * srcVCount + vSamples[iv];
      const o3 = dst * 3;
      posOut[o3] = pos.getX(srcIdx);
      posOut[o3 + 1] = pos.getY(srcIdx);
      posOut[o3 + 2] = pos.getZ(srcIdx);
      if (norm && normOut) {
        normOut[o3] = norm.getX(srcIdx);
        normOut[o3 + 1] = norm.getY(srcIdx);
        normOut[o3 + 2] = norm.getZ(srcIdx);
      }
      if (uv && uvOut) {
        const o2 = dst * 2;
        uvOut[o2] = uv.getX(srcIdx);
        uvOut[o2 + 1] = uv.getY(srcIdx);
      }
      dst++;
    }
  }

  const newUSegs = nu - 1;
  const newVSegs = nv - 1;
  const idxCount = newUSegs * newVSegs * 6;
  const idxOut = newVertCount > 65535 ? new Uint32Array(idxCount) : new Uint16Array(idxCount);
  let k = 0;
  for (let iu = 0; iu < newUSegs; iu++) {
    for (let iv = 0; iv < newVSegs; iv++) {
      const a = iu * nv + iv;
      const b = (iu + 1) * nv + iv;
      const c = (iu + 1) * nv + (iv + 1);
      const d = iu * nv + (iv + 1);
      if (flipWinding) {
        idxOut[k++] = a;
        idxOut[k++] = c;
        idxOut[k++] = b;
        idxOut[k++] = a;
        idxOut[k++] = d;
        idxOut[k++] = c;
      } else {
        idxOut[k++] = a;
        idxOut[k++] = b;
        idxOut[k++] = c;
        idxOut[k++] = a;
        idxOut[k++] = c;
        idxOut[k++] = d;
      }
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(posOut, 3));
  if (normOut) {
    out.setAttribute('normal', new THREE.BufferAttribute(normOut, 3));
  } else {
    out.computeVertexNormals();
  }
  if (uvOut) {
    out.setAttribute('uv', new THREE.BufferAttribute(uvOut, 2));
  }
  out.setIndex(new THREE.BufferAttribute(idxOut, 1));
  out.computeBoundingSphere();
  out.userData.shared = true;
  return out;
}
