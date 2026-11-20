import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  downsampleParametricGrid,
  freezeStaticHierarchy,
  fuseStaticGroupByMaterial,
  mergeBufferGeometries,
  mergeGeometryEntries,
} from './geometryFusion';
import { buildParametricSurface, mergeMeshTemplatesByMaterial } from './hypercarBuilders';

function triangleCount(geo: THREE.BufferGeometry): number {
  if (geo.index) return geo.index.count / 3;
  const pos = geo.attributes.position;
  return pos ? pos.count / 3 : 0;
}

test('mergeGeometryEntries preserves exact triangle count, finite attributes, and vertex colors', () => {
  const box = new THREE.BoxGeometry(1, 2, 3);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1.5, 10);
  const expectedTris = triangleCount(box) + triangleCount(cyl);

  // Add vertex colors to only the cylinder to ensure mixed colored/uncolored merge fills defaults cleanly
  const cylVerts = cyl.attributes.position.count;
  const colArr = new Float32Array(cylVerts * 3).fill(0.5);
  cyl.setAttribute('color', new THREE.BufferAttribute(colArr, 3));

  const merged = mergeGeometryEntries([
    { geo: box, matrix: new THREE.Matrix4().makeTranslation(1, 2, 3) },
    { geo: cyl, matrix: new THREE.Matrix4().makeTranslation(-2, 0.5, 4) },
  ]);

  assert.equal(triangleCount(merged), expectedTris);
  assert.ok(merged.index, 'merged geometry should remain indexed');
  assert.ok(merged.attributes.position, 'merged geometry should have position');
  assert.ok(merged.attributes.normal, 'merged geometry should have normal');
  assert.ok(merged.attributes.uv, 'merged geometry should have uv');
  assert.ok(merged.attributes.color, 'merged geometry should preserve vertex colors');

  const pos = merged.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    assert.ok(Number.isFinite(pos.getX(i)));
    assert.ok(Number.isFinite(pos.getY(i)));
    assert.ok(Number.isFinite(pos.getZ(i)));
  }

  // First geometry (box) should default to white (1,1,1), second (cyl) should keep 0.5
  const col = merged.attributes.color;
  assert.equal(col.getX(0), 1);
  assert.equal(col.getX(box.attributes.position.count), 0.5);

  box.dispose();
  cyl.dispose();
  merged.dispose();
});

test('mergeGeometryEntries flips triangle winding on negative-determinant mirror transforms', () => {
  const tri = new THREE.BufferGeometry();
  tri.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  tri.setIndex([0, 1, 2]);
  tri.computeVertexNormals();

  const mirrorX = new THREE.Matrix4().makeScale(-1, 1, 1);
  const merged = mergeGeometryEntries([{ geo: tri, matrix: mirrorX }]);
  const idx = merged.index!;
  const pos = merged.attributes.position;

  const a = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(0));
  const b = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(1));
  const c = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(2));
  const faceNormal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));

  // Original triangle faces +Z; mirrored across X with flipped winding must still face +Z
  assert.ok(faceNormal.z > 0, `expected mirrored triangle to retain +Z winding, got ${faceNormal.z}`);

  tri.dispose();
  merged.dispose();
});

test('mergeBufferGeometries combines un-transformed geometries cleanly', () => {
  const a = new THREE.PlaneGeometry(2, 2);
  const b = new THREE.PlaneGeometry(3, 4);
  const merged = mergeBufferGeometries([a, b], { markShared: true });

  assert.equal(triangleCount(merged), triangleCount(a) + triangleCount(b));
  assert.equal(merged.userData.shared, true);

  a.dispose();
  b.dispose();
  merged.dispose();
});

test('fuseStaticGroupByMaterial collapses shared-material meshes while preserving excluded subtrees and world bounds', () => {
  const root = new THREE.Group();
  root.position.set(10, 0, -5);
  root.rotation.y = Math.PI * 0.25;

  const matA = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const matB = new THREE.MeshStandardMaterial({ color: 0x00ff00 });

  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), matA);
    m.position.set(i * 2, 0.5, 0);
    m.castShadow = true;
    root.add(m);
  }
  const nested = new THREE.Group();
  nested.position.set(0, 2, 1);
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), matB);
    m.position.set(i, 0, 0);
    nested.add(m);
  }
  root.add(nested);

  const excludedGroup = new THREE.Group();
  excludedGroup.position.set(0, 1, 2);
  const excludedMesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), matA);
  excludedGroup.add(excludedMesh);
  root.add(excludedGroup);

  root.updateMatrixWorld(true);
  const beforeBounds = new THREE.Box3().setFromObject(root);
  let beforeTris = 0;
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) beforeTris += triangleCount(obj.geometry);
  });

  const stats = fuseStaticGroupByMaterial(root, { exclude: new Set([excludedGroup]) });
  assert.equal(stats.beforeMeshes, 10);
  assert.equal(stats.afterMeshes, 2);
  assert.equal(excludedGroup.parent, root, 'excluded subtree must stay intact');
  assert.equal(excludedGroup.children[0], excludedMesh);

  root.updateMatrixWorld(true);
  const afterBounds = new THREE.Box3().setFromObject(root);
  let afterTris = 0;
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) afterTris += triangleCount(obj.geometry);
  });

  assert.equal(afterTris, beforeTris);
  assert.ok(beforeBounds.min.distanceTo(afterBounds.min) < 1e-4);
  assert.ok(beforeBounds.max.distanceTo(afterBounds.max) < 1e-4);

  freezeStaticHierarchy(root, new Set([excludedGroup]));
  assert.equal(excludedGroup.matrixAutoUpdate, true);
  assert.equal(root.matrixAutoUpdate, false);

  matA.dispose();
  matB.dispose();
});

test('mergeMeshTemplatesByMaterial fuses duplicate material slots and restricts shadows to exterior slots', () => {
  const g1 = new THREE.BoxGeometry(1, 1, 1);
  const g2 = new THREE.BoxGeometry(0.8, 0.6, 0.4);
  const g3 = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const g4 = new THREE.BoxGeometry(0.2, 0.2, 0.2);

  const expectedTris =
    triangleCount(g1) + triangleCount(g2) + triangleCount(g3) + triangleCount(g4);

  const outGeos: THREE.BufferGeometry[] = [];
  const fused = mergeMeshTemplatesByMaterial(
    [
      { geo: g1, mat: 'paint', position: [0, 0, 0], castShadow: true, receiveShadow: true },
      { geo: g2, mat: 'paint', position: [0, 0.5, 0], castShadow: true, receiveShadow: true },
      { geo: g3, mat: 'alcantara', position: [0, 0.2, 0], castShadow: true, receiveShadow: true },
      { geo: g4, mat: 'alcantara', position: [0.3, 0.2, 0], castShadow: true, receiveShadow: true },
    ],
    outGeos,
    true,
  );

  assert.equal(fused.length, 2, '4 templates across 2 slots should fuse into 2 templates');
  const totalFusedTris = fused.reduce((sum, t) => sum + triangleCount(t.geo), 0);
  assert.equal(totalFusedTris, expectedTris);

  const paintSlot = fused.find((t) => t.mat === 'paint');
  const alcantaraSlot = fused.find((t) => t.mat === 'alcantara');
  assert.ok(paintSlot && alcantaraSlot);
  assert.equal(paintSlot.castShadow, true, 'exterior paint slot should keep shadow casting');
  assert.equal(alcantaraSlot.castShadow, false, 'occluded interior alcantara should not cast sun shadows');

  for (const g of outGeos) g.dispose();
});

test('downsampleParametricGrid reduces triangles ~9x while preserving watertight corners and unit normals', () => {
  const high = buildParametricSurface(
    36,
    24,
    (u, v) => [u * 2.0 - 1.0, Math.sin(u * Math.PI) * 0.3 + Math.cos(v * Math.PI) * 0.1, v * 4.0],
    { worldUV: true },
  );
  const low = downsampleParametricGrid(high, 3);

  const highTris = triangleCount(high);
  const lowTris = triangleCount(low);
  assert.equal(highTris, 36 * 24 * 2);
  assert.equal(lowTris, 12 * 8 * 2);
  assert.ok(lowTris * 8 <= highTris, `expected >=8x triangle reduction (${highTris} -> ${lowTris})`);

  // Verify exact bounding box preservation (watertight u=0/1, v=0/1 boundaries)
  high.computeBoundingBox();
  low.computeBoundingBox();
  assert.ok(high.boundingBox!.min.distanceTo(low.boundingBox!.min) < 1e-4);
  assert.ok(high.boundingBox!.max.distanceTo(low.boundingBox!.max) < 1e-4);

  const norm = low.attributes.normal;
  assert.ok(norm, 'downsampled grid must retain normals');
  for (let i = 0; i < norm.count; i++) {
    const len = Math.hypot(norm.getX(i), norm.getY(i), norm.getZ(i));
    assert.ok(Math.abs(len - 1) < 0.02, `expected unit normal at ${i}, got len=${len}`);
  }

  high.dispose();
  low.dispose();
});
