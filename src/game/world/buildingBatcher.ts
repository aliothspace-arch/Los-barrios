import * as THREE from 'three';
import type { BuildingBlueprint } from '../types';

const _tmpMat = new THREE.Matrix4();
const _tmpQuat = new THREE.Quaternion();
const _tmpPos = new THREE.Vector3();
const _tmpScale = new THREE.Vector3();
const _tmpEuler = new THREE.Euler();

function prepareGeometryForMerge(rawGeo: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = rawGeo.index ? rawGeo.toNonIndexed() : rawGeo.clone();
  if (!geo.attributes.normal) {
    geo.computeVertexNormals();
  }
  const count = geo.attributes.position.count;
  if (!geo.attributes.uv) {
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  for (const key of Object.keys(geo.attributes)) {
    if (key !== 'position' && key !== 'normal' && key !== 'uv') {
      geo.deleteAttribute(key);
    }
  }
  geo.clearGroups();
  return geo;
}

export function applyWorldScaleBoxUVs(
  geo: THREE.BoxGeometry,
  w: number,
  h: number,
  d: number,
  tileMeters: number,
): void {
  if (tileMeters <= 0) return;
  const inv = 1 / tileMeters;
  const uv = geo.attributes.uv;
  const faceScales: Array<[number, number]> = [
    [d * inv, h * inv],
    [d * inv, h * inv],
    [w * inv, d * inv],
    [w * inv, d * inv],
    [w * inv, h * inv],
    [w * inv, h * inv],
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = faceScales[f];
    const base = f * 4;
    for (let v = 0; v < 4; v++) {
      const idx = base + v;
      uv.setXY(idx, uv.getX(idx) * su, uv.getY(idx) * sv);
    }
  }
  uv.needsUpdate = true;
}

interface BatchBucket {
  material: THREE.Material;
  castShadow: boolean;
  geometries: THREE.BufferGeometry[];
}

/**
 * Spatial 4-Quadrant Architectural Geometry Batcher.
 * Merges thousands of architectural sub-components across Los Santos buildings
 * into static GPU-friendly draw calls while preserving 4-quadrant frustum culling.
 */
export class BuildingMeshBatcher {
  private readonly buckets = new Map<string, BatchBucket>();
  private readonly directMeshes: THREE.Mesh[] = [];
  private buildingMatrix = new THREE.Matrix4();
  private quadrantKey = 'q0';

  public beginBuilding(b: BuildingBlueprint): void {
    _tmpPos.set(b.x, 0, b.z);
    _tmpEuler.set(0, b.rotY, 0);
    _tmpQuat.setFromEuler(_tmpEuler);
    _tmpScale.set(1, 1, 1);
    this.buildingMatrix.compose(_tmpPos, _tmpQuat, _tmpScale);
    const qx = b.x < 0 ? 0 : 1;
    const qz = b.z < 0 ? 0 : 2;
    this.quadrantKey = `q${qx + qz}`;
  }

  public addGeo(
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    opts: {
      rotX?: number;
      rotY?: number;
      rotZ?: number;
      scaleX?: number;
      scaleY?: number;
      scaleZ?: number;
      castShadow?: boolean;
      disposeInput?: boolean;
    } = {},
  ): void {
    const clean = prepareGeometryForMerge(geo);
    if (opts.disposeInput !== false) {
      geo.dispose();
    }

    _tmpPos.set(x, y, z);
    _tmpEuler.set(opts.rotX ?? 0, opts.rotY ?? 0, opts.rotZ ?? 0);
    _tmpQuat.setFromEuler(_tmpEuler);
    _tmpScale.set(opts.scaleX ?? 1, opts.scaleY ?? 1, opts.scaleZ ?? 1);
    _tmpMat.compose(_tmpPos, _tmpQuat, _tmpScale);
    _tmpMat.premultiply(this.buildingMatrix);
    clean.applyMatrix4(_tmpMat);

    const castShadow = opts.castShadow ?? false;
    const key = `${this.quadrantKey}_${material.uuid}_${castShadow ? '1' : '0'}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { material, castShadow, geometries: [] };
      this.buckets.set(key, bucket);
    }
    bucket.geometries.push(clean);
  }

  public addBox(
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    opts: {
      rotX?: number;
      rotY?: number;
      rotZ?: number;
      castShadow?: boolean;
      uvMeters?: number;
    } = {},
  ): void {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (opts.uvMeters && opts.uvMeters > 0) {
      applyWorldScaleBoxUVs(geo, w, h, d, opts.uvMeters);
    }
    this.addGeo(geo, material, x, y, z, {
      rotX: opts.rotX,
      rotY: opts.rotY,
      rotZ: opts.rotZ,
      castShadow: opts.castShadow,
      disposeInput: true,
    });
  }

  public addCylinder(
    rTop: number,
    rBot: number,
    h: number,
    seg: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    opts: {
      rotX?: number;
      rotY?: number;
      rotZ?: number;
      castShadow?: boolean;
      uvScaleU?: number;
      uvScaleV?: number;
    } = {},
  ): void {
    const geo = new THREE.CylinderGeometry(rTop, rBot, h, seg);
    if (opts.uvScaleU || opts.uvScaleV) {
      const su = opts.uvScaleU ?? 1;
      const sv = opts.uvScaleV ?? 1;
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
      }
      uv.needsUpdate = true;
    }
    this.addGeo(geo, material, x, y, z, {
      rotX: opts.rotX,
      rotY: opts.rotY,
      rotZ: opts.rotZ,
      castShadow: opts.castShadow,
      disposeInput: true,
    });
  }

  public addDirectMesh(
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    rotX = 0,
    rotY = 0,
    rotZ = 0,
  ): void {
    const mesh = new THREE.Mesh(geo, material);
    _tmpPos.set(x, y, z);
    _tmpEuler.set(rotX, rotY, rotZ);
    _tmpQuat.setFromEuler(_tmpEuler);
    _tmpScale.set(1, 1, 1);
    _tmpMat.compose(_tmpPos, _tmpQuat, _tmpScale);
    _tmpMat.premultiply(this.buildingMatrix);
    mesh.position.setFromMatrixPosition(_tmpMat);
    mesh.quaternion.setFromRotationMatrix(_tmpMat);
    mesh.scale.setFromMatrixScale(_tmpMat);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.directMeshes.push(mesh);
  }

  private static mergeNormalizedGeometries(
    geos: THREE.BufferGeometry[],
  ): THREE.BufferGeometry | null {
    let totalVerts = 0;
    for (const g of geos) {
      totalVerts += g.attributes.position.count;
    }
    if (totalVerts === 0) return null;

    const posArr = new Float32Array(totalVerts * 3);
    const normArr = new Float32Array(totalVerts * 3);
    const uvArr = new Float32Array(totalVerts * 2);

    let vOffset = 0;
    for (const g of geos) {
      const pos = g.attributes.position;
      const norm = g.attributes.normal;
      const uv = g.attributes.uv;
      const count = pos.count;
      posArr.set(pos.array as Float32Array, vOffset * 3);
      normArr.set(norm.array as Float32Array, vOffset * 3);
      uvArr.set(uv.array as Float32Array, vOffset * 2);
      vOffset += count;
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
    return merged;
  }

  public flush(worldGroup: THREE.Group): void {
    for (const bucket of this.buckets.values()) {
      if (bucket.geometries.length === 0) continue;
      const merged = BuildingMeshBatcher.mergeNormalizedGeometries(bucket.geometries);
      for (const g of bucket.geometries) {
        g.dispose();
      }
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, bucket.material);
      mesh.castShadow = bucket.castShadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      worldGroup.add(mesh);
    }
    this.buckets.clear();

    for (const m of this.directMeshes) {
      worldGroup.add(m);
    }
    this.directMeshes.length = 0;
  }
}
