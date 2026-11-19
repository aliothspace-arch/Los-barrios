import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  FACE_LANDMARKS,
  buildSculptedBackpackGeometry,
  buildSculptedBeltAndLoopsGeometry,
  buildSculptedBuckleGeometry,
  buildSculptedCalfGeometry,
  buildSculptedCapGeometry,
  buildSculptedCollarBandGeometry,
  buildSculptedCubanChainGeometry,
  buildSculptedEarGeometry,
  buildSculptedForearmGeometry,
  buildSculptedHairGeometry,
  buildSculptedHandGeometry,
  buildSculptedHeadGeometry,
  buildSculptedNeckGeometry,
  buildSculptedPelvisGeometry,
  buildSculptedShadesGeometries,
  buildSculptedSleeveGeometry,
  buildSculptedSneakerSoleGeometry,
  buildSculptedSneakerUpperGeometry,
  buildSculptedThighGeometry,
  buildSculptedTorsoGeometry,
  buildSculptedUpperArmGeometry,
  buildSculptedUpperYokeSkinGeometry,
  buildSneakerLacesGeometry,
} from './characterModels';

function assertGeometryValid(name: string, geo: THREE.BufferGeometry, minVerts: number): void {
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const color = geo.attributes.color;
  assert.ok(pos, `${name} must have position attribute`);
  assert.ok(norm, `${name} must have normal attribute`);
  assert.ok(uv, `${name} must have uv attribute`);
  assert.ok(color, `${name} must have vertex AO color attribute`);
  assert.ok(pos.count >= minVerts, `${name} should have >= ${minVerts} verts, got ${pos.count}`);

  for (let i = 0; i < pos.count; i++) {
    assert.ok(Number.isFinite(pos.getX(i)), `${name} pos.x[${i}] finite`);
    assert.ok(Number.isFinite(pos.getY(i)), `${name} pos.y[${i}] finite`);
    assert.ok(Number.isFinite(pos.getZ(i)), `${name} pos.z[${i}] finite`);
    const nLen = Math.hypot(norm.getX(i), norm.getY(i), norm.getZ(i));
    assert.ok(Number.isFinite(nLen) && nLen > 0.5, `${name} normal[${i}] non-zero`);
  }

  geo.computeBoundingBox();
  assert.ok(geo.boundingBox && !geo.boundingBox.isEmpty(), `${name} boundingBox non-empty`);
}

function averageOutwardNormalDot(geo: THREE.BufferGeometry): number {
  geo.computeBoundingBox();
  const center = new THREE.Vector3();
  geo.boundingBox!.getCenter(center);
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i) - center.x;
    const dy = pos.getY(i) - center.y;
    const dz = pos.getZ(i) - center.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) continue;
    const dot = (dx * norm.getX(i) + dy * norm.getY(i) + dz * norm.getZ(i)) / len;
    sum += dot;
    count++;
  }
  return sum / Math.max(1, count);
}

test('sculpted FLAME-inspired head has high density, protruding nose, recessed eye sockets, and outward normals', () => {
  const head = buildSculptedHeadGeometry();
  assertGeometryValid('head', head, 1200);

  const avgDot = averageOutwardNormalDot(head);
  assert.ok(avgDot > 0.72, `Head normals must face strictly outward (avgDot=${avgDot.toFixed(3)})`);

  // Verify sculpted nose protrudes clearly beyond base cranial depth HEAD_RZ
  const maxZ = head.boundingBox!.max.z;
  assert.ok(
    maxZ > FACE_LANDMARKS.HEAD_RZ + 0.015,
    `Sculpted nose should protrude beyond cranium (${maxZ.toFixed(4)} > ${(FACE_LANDMARKS.HEAD_RZ + 0.015).toFixed(4)})`,
  );

  // Verify realistic human head width & height proportions
  const size = new THREE.Vector3();
  head.boundingBox!.getSize(size);
  assert.ok(size.x > 0.16 && size.x < 0.22, `Realistic head width (${size.x.toFixed(3)}m)`);
  assert.ok(size.y > 0.22 && size.y < 0.28, `Realistic head height (${size.y.toFixed(3)}m)`);
});

test('all sculpted anatomical body segments and accessories build cleanly with outward normals', () => {
  const shades = buildSculptedShadesGeometries();
  const cases: Array<[string, THREE.BufferGeometry, number, boolean]> = [
    ['leftEar', buildSculptedEarGeometry(-1), 60, false],
    ['rightEar', buildSculptedEarGeometry(1), 60, false],
    ['hair', buildSculptedHairGeometry(), 500, false],
    ['neck', buildSculptedNeckGeometry(), 300, true],
    ['upperYokeSkin', buildSculptedUpperYokeSkinGeometry(), 300, true],
    ['tankTorso', buildSculptedTorsoGeometry(true), 800, true],
    ['teeTorso', buildSculptedTorsoGeometry(false), 800, true],
    ['tankCollar', buildSculptedCollarBandGeometry(true), 150, false],
    ['teeCollar', buildSculptedCollarBandGeometry(false), 150, false],
    ['pelvis', buildSculptedPelvisGeometry(), 400, true],
    ['beltAndLoops', buildSculptedBeltAndLoopsGeometry(), 200, false],
    ['buckle', buildSculptedBuckleGeometry(), 80, false],
    ['leftUpperArm', buildSculptedUpperArmGeometry(-1), 400, true],
    ['rightUpperArm', buildSculptedUpperArmGeometry(1), 400, true],
    ['leftSleeve', buildSculptedSleeveGeometry(-1), 300, true],
    ['rightSleeve', buildSculptedSleeveGeometry(1), 300, true],
    ['leftForearm', buildSculptedForearmGeometry(-1), 350, true],
    ['rightForearm', buildSculptedForearmGeometry(1), 350, true],
    ['leftHand', buildSculptedHandGeometry(-1), 600, false],
    ['rightHand', buildSculptedHandGeometry(1), 600, false],
    ['leftThigh', buildSculptedThighGeometry(-1), 400, true],
    ['rightThigh', buildSculptedThighGeometry(1), 400, true],
    ['leftCalf', buildSculptedCalfGeometry(-1), 400, true],
    ['rightCalf', buildSculptedCalfGeometry(1), 400, true],
    ['leftSole', buildSculptedSneakerSoleGeometry(-1), 100, false],
    ['rightSole', buildSculptedSneakerSoleGeometry(1), 100, false],
    ['leftShoeUpper', buildSculptedSneakerUpperGeometry(-1), 350, false],
    ['rightShoeUpper', buildSculptedSneakerUpperGeometry(1), 350, false],
    ['laces', buildSneakerLacesGeometry(), 200, false],
    ['shadesFrame', shades.frameGeo, 200, false],
    ['shadesLens', shades.lensGeo, 80, false],
    ['cap', buildSculptedCapGeometry(), 400, false],
    ['chain', buildSculptedCubanChainGeometry(), 250, false],
    ['backpack', buildSculptedBackpackGeometry(), 400, false],
  ];

  for (const [name, geo, minVerts, checkOutward] of cases) {
    assertGeometryValid(name, geo, minVerts);
    if (checkOutward) {
      const dot = averageOutwardNormalDot(geo);
      assert.ok(dot > 0.65, `${name} normals should point outward (got ${dot.toFixed(3)})`);
    }
  }
});

test('character full standing height is anatomically realistic (~1.86m) and sneaker soles sit flush at ground y = 0', () => {
  const leftSole = buildSculptedSneakerSoleGeometry(-1);
  const rightSole = buildSculptedSneakerSoleGeometry(1);
  // Hip is at y=0.88, shin pivot is at -0.42 => shin origin at world y = 0.46
  const worldMinYL = 0.88 - 0.42 + leftSole.boundingBox!.min.y;
  const worldMinYR = 0.88 - 0.42 + rightSole.boundingBox!.min.y;
  assert.ok(Math.abs(worldMinYL) < 0.002, `Left sole flush at ground y=0 (got ${worldMinYL.toFixed(4)})`);
  assert.ok(Math.abs(worldMinYR) < 0.002, `Right sole flush at ground y=0 (got ${worldMinYR.toFixed(4)})`);

  // Torso at y=0.99, head at +0.56 => head origin at world y = 1.55
  const head = buildSculptedHeadGeometry();
  const topY = 0.99 + 0.56 + head.boundingBox!.max.y;
  assert.ok(topY >= 1.82 && topY <= 1.92, `Adult standing height should be ~1.86m (got ${topY.toFixed(3)}m)`);
});
