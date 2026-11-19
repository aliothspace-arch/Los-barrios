import * as THREE from 'three';
import type { GamePhase, PedState, PlayerState, VehicleState, WeatherType, TimePreset } from '../types';
import type { CharacterRig, VehicleRig, WorldVisuals } from '../models';
import { dampValue } from '../physics';
import {
  computeAckermannSteer,
  HYPERCAR_SPEC,
  lerp,
  smoothstep,
  stepHydraulic,
} from '../rendering/hypercarBuilders';

const _dummy = new THREE.Object3D();
const _wingDummy = new THREE.Object3D();
const _doorAxisL = new THREE.Vector3(-0.3, 0.34, 0.891).normalize();
const _doorAxisR = new THREE.Vector3(0.3, -0.34, 0.891).normalize();
const _qDoor = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _axisY = new THREE.Vector3(0, 1, 0);

export interface EntityAnimatorSyncParams {
  dt: number;
  nowSec: number;
  frameCounter: number;
  phase: GamePhase;
  weather: WeatherType;
  timePreset: TimePreset;
  nightFactor: number;
  player: PlayerState;
  playerRig: CharacterRig;
  vehicles: readonly VehicleState[];
  vehicleRigs: ReadonlyMap<string, VehicleRig>;
  peds: readonly PedState[];
  pedRigs: ReadonlyMap<string, CharacterRig>;
  pedShadowActive: Map<string, boolean>;
  birdFlock: WorldVisuals['birdFlock'];
  dustMotes: THREE.Points;
  shopMarkers: readonly THREE.Group[];
  checkpointGroup: THREE.Group;
  checkpointRing: THREE.Mesh;
}

/**
 * Synchronizes all 3D visual rigs (vehicles, CJ skeletal locomotion, 118 NPCs
 * with distance/shadow culling, soaring birds, sunset dust motes, shop markers
 * and checkpoint beacons) strictly as a read-only presentation layer over
 * simulation state.
 */
export class EntityAnimator {
  private wasTitlePhase = false;

  public sync(params: EntityAnimatorSyncParams): void {
    const {
      dt,
      nowSec,
      frameCounter,
      phase,
      weather,
      timePreset,
      nightFactor,
      player,
      playerRig,
      vehicles,
      vehicleRigs,
      peds,
      pedRigs,
      pedShadowActive,
      birdFlock,
      dustMotes,
      shopMarkers,
      checkpointGroup,
      checkpointRing,
    } = params;

    const night = timePreset === 'night' || weather === 'rain' || weather === 'storm';
    const isTitle = phase === 'title';

    // 1. Vehicles (Class-A V12 Hypercar Ackermann steering, hydraulics, telescopic struts & optical pulse)
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      const rig = vehicleRigs.get(v.id);
      if (!rig) continue;

      rig.root.position.set(v.x, v.y, v.z);
      rig.root.rotation.y = v.heading;
      rig.bodyGroup.rotation.x = v.pitch;
      rig.bodyGroup.rotation.z = v.roll;

      const hc = rig.hypercar;

      // Ackermann Steering & Interior D-Steering Wheel synchronization
      const { leftSteer, rightSteer } = computeAckermannSteer(v.steerAngle);
      rig.frontLeftPivot.rotation.y = leftSteer;
      rig.frontRightPivot.rotation.y = rightSteer;
      hc.steeringWheelSpin.rotation.z = -v.steerAngle * 2.4;

      // Wheel angular spin by front/rear tire radius
      hc.frontSpin += (v.speed * dt) / HYPERCAR_SPEC.fR;
      hc.rearSpin += (v.speed * dt) / HYPERCAR_SPEC.rR;
      rig.wheels[0].rotation.x = hc.frontSpin;
      rig.wheels[1].rotation.x = hc.frontSpin;
      rig.wheels[2].rotation.x = hc.rearSpin;
      rig.wheels[3].rotation.x = hc.rearSpin;

      // Title screen choreographed showcase on Grove Street hero hypercars
      if (isTitle && (v.id === 'parked_grove_infernus' || v.id === 'parked_grove_greenwood')) {
        const cycle = (nowSec + (v.id === 'parked_grove_infernus' ? 1.5 : 8.5)) % 16.0;
        const nextDoorTarget = cycle > 2.2 && cycle < 11.4 ? 1 : 0;
        const nextFrunkTarget = cycle > 4.2 && cycle < 10.2 ? 1 : 0;
        if (
          (nextDoorTarget === 1 && hc.doorL.target === 0) ||
          (nextFrunkTarget === 1 && hc.frunk.target === 0)
        ) {
          hc.pulseTime = 0;
        }
        hc.doorL.target = nextDoorTarget;
        hc.doorR.target = nextDoorTarget;
        hc.frunk.target = nextFrunkTarget;
      } else if (this.wasTitlePhase && !isTitle) {
        // Close showcase panels smoothly when entering gameplay
        hc.doorL.target = 0;
        hc.doorR.target = 0;
        hc.frunk.target = 0;
      }

      // Automatic door closure after vehicle entry/exit or once driving speed exceeds 2.2 m/s
      if (!isTitle) {
        if (hc.autoCloseTimer > 0) {
          hc.autoCloseTimer = Math.max(0, hc.autoCloseTimer - dt);
          if (hc.autoCloseTimer === 0) {
            hc.doorL.target = 0;
            hc.doorR.target = 0;
          }
        }
        if (Math.abs(v.speed) > 2.4 && (hc.doorL.target > 0 || hc.doorR.target > 0)) {
          hc.doorL.target = 0;
          hc.doorR.target = 0;
          hc.autoCloseTimer = 0;
        }
      }

      // Advance hydraulic states
      const dL = stepHydraulic(hc.doorL, dt, 0.56);
      const dR = stepHydraulic(hc.doorR, dt, 0.56);
      const fr = stepHydraulic(hc.frunk, dt, 0.6);

      // Apply dihedral butterfly door quaternions
      const maxDoorRad = THREE.MathUtils.degToRad(68);
      if (dL > 0.0001) {
        _qDoor.setFromAxisAngle(_doorAxisL, dL * maxDoorRad);
        _qYaw.setFromAxisAngle(_axisY, -0.14 * Math.sin(dL * Math.PI));
        hc.doorLPivot.quaternion.copy(_qDoor).multiply(_qYaw);
      } else {
        hc.doorLPivot.quaternion.identity();
      }

      if (dR > 0.0001) {
        _qDoor.setFromAxisAngle(_doorAxisR, -dR * maxDoorRad);
        _qYaw.setFromAxisAngle(_axisY, 0.14 * Math.sin(dR * Math.PI));
        hc.doorRPivot.quaternion.copy(_qDoor).multiply(_qYaw);
      } else {
        hc.doorRPivot.quaternion.identity();
      }

      // Apply 44° front trunk (Frunk) rotation + luggage compartment LED
      hc.frunkPivot.rotation.x = -fr * THREE.MathUtils.degToRad(44);
      hc.frunkLedMat.emissiveIntensity = lerp(0.15, 2.8, smoothstep(0.08, 0.55, fr));

      // Update real-time telescopic hydraulic struts when panels are open or moving
      if (
        dL > 0.0001 ||
        dR > 0.0001 ||
        fr > 0.0001 ||
        hc.doorL.target > 0 ||
        hc.doorR.target > 0 ||
        hc.frunk.target > 0
      ) {
        hc.doorLStrut.update(rig.bodyGroup);
        hc.doorRStrut.update(rig.bodyGroup);
        hc.frunkStrutL.update(rig.bodyGroup);
        hc.frunkStrutR.update(rig.bodyGroup);
      }

      // Double optical welcome pulse on DRLs and rear lightblade
      let pulseBoost = 0;
      if (hc.pulseTime >= 0) {
        hc.pulseTime += dt;
        const p1 = Math.exp(-Math.pow((hc.pulseTime - 0.14) / 0.06, 2));
        const p2 = Math.exp(-Math.pow((hc.pulseTime - 0.36) / 0.08, 2));
        pulseBoost = (p1 + p2 * 0.8) * 1.45;
        if (hc.pulseTime > 1.2) hc.pulseTime = -1;
      }

      const baseTailIntensity = v.braking ? 3.8 : night ? 2.45 : 1.75;
      const baseHeadIntensity = night ? 3.4 : 2.15 + Math.sin(nowSec * 1.6) * 0.1;
      rig.taillightMat.emissiveIntensity = baseTailIntensity + pulseBoost * 0.9;
      rig.headlightMat.emissiveIntensity = baseHeadIntensity + pulseBoost;

      const beamMat = rig.headlightBeam.material as THREE.MeshBasicMaterial;
      beamMat.opacity = night && v.driver !== 'none' ? 0.18 : 0.0;

      const showNitro = v.nitroActive;
      rig.nitroFlameLeft.visible = showNitro;
      rig.nitroFlameRight.visible = showNitro;
      if (showNitro) {
        const flicker = 0.8 + Math.sin(nowSec * 45) * 0.25;
        rig.nitroFlameLeft.scale.set(1, 1, flicker);
        rig.nitroFlameRight.scale.set(1, 1, flicker);
      }

      if (rig.sirenRedMat && rig.sirenBlueMat) {
        if (v.sirenOn) {
          const pulse = Math.sin(nowSec * 18) > 0;
          rig.sirenRedMat.emissiveIntensity = pulse ? 4.8 : 0.25;
          rig.sirenBlueMat.emissiveIntensity = pulse ? 0.25 : 4.8;
        } else {
          rig.sirenRedMat.emissiveIntensity = 0.3;
          rig.sirenBlueMat.emissiveIntensity = 0.3;
        }
      }
    }
    this.wasTitlePhase = isTitle;

    // 2. CJ Protagonist
    if (!player.inVehicleId) {
      playerRig.root.position.set(player.x, player.y, player.z);
      playerRig.root.rotation.y = player.heading;
      const spd = Math.hypot(player.vx, player.vz);
      const isMoving = spd > 0.25;
      const swing = Math.min(1, spd / 5.5) * 0.72;
      const phase = player.walkCycle;

      const sinP = Math.sin(phase);
      const breathe = Math.sin(nowSec * 2.4);
      const idleSway = Math.sin(nowSec * 1.15);

      playerRig.leftLeg.rotation.x = isMoving ? sinP * swing : 0.03;
      playerRig.rightLeg.rotation.x = isMoving ? -sinP * swing : -0.04;
      playerRig.leftLeg.rotation.z = isMoving ? -0.01 : -0.03;
      playerRig.rightLeg.rotation.z = isMoving ? 0.01 : 0.03;
      playerRig.leftShin.rotation.x = isMoving ? Math.max(0, -sinP) * swing * 0.85 : 0.05;
      playerRig.rightShin.rotation.x = isMoving ? Math.max(0, sinP) * swing * 0.85 : 0.05;

      playerRig.leftArm.rotation.x = isMoving ? -sinP * swing * 0.85 : 0.06 + breathe * 0.025;
      playerRig.rightArm.rotation.x = isMoving ? sinP * swing * 0.85 : -0.04 - breathe * 0.02;
      playerRig.leftArm.rotation.z = -0.11 - breathe * 0.015;
      playerRig.rightArm.rotation.z = 0.11 + breathe * 0.015;
      playerRig.leftForearm.rotation.x = isMoving
        ? -0.22 - Math.max(0, sinP) * swing * 0.55
        : -0.24 - breathe * 0.03;
      playerRig.rightForearm.rotation.x = isMoving
        ? -0.22 - Math.max(0, -sinP) * swing * 0.55
        : -0.22 + breathe * 0.02;

      playerRig.torso.position.y = 0.99 + breathe * 0.018 + Math.abs(sinP) * swing * 0.05;
      playerRig.torso.rotation.x = isMoving ? Math.min(0.18, spd * 0.022) : 0.03;
      playerRig.torso.rotation.y = isMoving ? -sinP * swing * 0.09 : idleSway * 0.035;
      playerRig.head.rotation.y = isMoving ? sinP * swing * 0.05 : Math.sin(nowSec * 0.85) * 0.14;
    }

    // 3. Pedestrians (Distance culling + shadow radius culling + social animations)
    const focusX = player.x;
    const focusZ = player.z;
    const frameMod3 = frameCounter % 3;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      const rig = pedRigs.get(p.id);
      if (!rig) continue;

      const dx = p.x - focusX;
      const dz = p.z - focusZ;
      const distSq = dx * dx + dz * dz;

      if (distSq > 9025) {
        if (rig.root.visible) rig.root.visible = false;
        continue;
      }
      if (!rig.root.visible) rig.root.visible = true;

      const shouldCastShadow = distSq < 1156;
      if (pedShadowActive.get(p.id) !== shouldCastShadow) {
        pedShadowActive.set(p.id, shouldCastShadow);
        rig.root.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh && obj.name !== 'contact_shadow') {
            obj.castShadow = shouldCastShadow;
          }
        });
      }

      rig.root.position.set(p.x, 0, p.z);
      rig.root.rotation.y = p.heading;

      if (p.state === 'ko') {
        rig.root.rotation.x = dampValue(rig.root.rotation.x, Math.PI * 0.48, 8, dt);
        rig.root.position.y = 0.2;
      } else if (distSq < 1444 || i % 3 === frameMod3) {
        rig.root.rotation.x = dampValue(rig.root.rotation.x, 0, 8, dt);
        const spd = Math.hypot(p.vx, p.vz);
        if (spd > 0.18) {
          const isJog = p.activity === 'jog' || p.state === 'flee' || p.state === 'chase';
          const sw = Math.min(1, spd / (isJog ? 3.8 : 4.3)) * (isJog ? 0.78 : 0.62);
          const sP = Math.sin(p.walkCycle);
          rig.leftLeg.rotation.x = sP * sw;
          rig.rightLeg.rotation.x = -sP * sw;
          rig.leftShin.rotation.x = Math.max(0, -sP) * sw * 0.82;
          rig.rightShin.rotation.x = Math.max(0, sP) * sw * 0.82;
          rig.leftArm.rotation.x = -sP * sw * 0.85;
          rig.rightArm.rotation.x = p.state === 'windup' ? -1.9 : sP * sw * 0.85;
          rig.leftArm.rotation.z = -0.09;
          rig.rightArm.rotation.z = 0.09;
          rig.leftForearm.rotation.x = isJog ? -1.05 : -0.22 - Math.max(0, sP) * sw * 0.45;
          rig.rightForearm.rotation.x =
            p.state === 'windup' ? -0.5 : isJog ? -1.05 : -0.22 - Math.max(0, -sP) * sw * 0.45;
          rig.torso.rotation.x = isJog ? 0.12 : 0.03;
          rig.torso.rotation.y = -sP * sw * 0.08;
          rig.head.rotation.y = 0;
          rig.head.rotation.x = 0;
        } else if (p.activity === 'chat' && p.state !== 'windup') {
          const talkPhase = nowSec * 2.4 + i * 1.9;
          const isSpeaker = Math.sin(nowSec * 0.45 + i * 2.1) > 0;
          const gesture = isSpeaker ? Math.sin(talkPhase) * 0.28 : 0.04;
          rig.leftLeg.rotation.x = 0.03;
          rig.rightLeg.rotation.x = -0.04;
          rig.leftShin.rotation.x = 0.05;
          rig.rightShin.rotation.x = 0.05;
          rig.leftArm.rotation.x = isSpeaker ? -0.35 + gesture * 0.6 : 0.04;
          rig.rightArm.rotation.x = isSpeaker ? -0.45 - gesture * 0.8 : 0.02;
          rig.leftArm.rotation.z = -0.14;
          rig.rightArm.rotation.z = 0.14;
          rig.leftForearm.rotation.x = isSpeaker ? -0.82 + gesture * 0.5 : -0.28;
          rig.rightForearm.rotation.x = isSpeaker ? -0.92 - gesture * 0.6 : -0.26;
          rig.torso.rotation.x = 0.02;
          rig.torso.rotation.y = Math.sin(talkPhase * 0.4) * 0.07;
          rig.head.rotation.x = isSpeaker
            ? Math.sin(talkPhase * 0.8) * 0.08
            : Math.sin(talkPhase * 1.1) * 0.11;
          rig.head.rotation.y = Math.sin(talkPhase * 0.5) * 0.16;
        } else {
          const idleT = nowSec * 1.3 + i * 1.7;
          rig.leftLeg.rotation.x = 0.02;
          rig.rightLeg.rotation.x = -0.03;
          rig.leftShin.rotation.x = 0.04;
          rig.rightShin.rotation.x = 0.04;
          rig.leftArm.rotation.x = 0.05 + Math.sin(idleT) * 0.03;
          rig.rightArm.rotation.x = p.state === 'windup' ? -1.9 : -0.03 - Math.sin(idleT) * 0.03;
          rig.leftArm.rotation.z = -0.1;
          rig.rightArm.rotation.z = 0.1;
          rig.leftForearm.rotation.x = -0.24;
          rig.rightForearm.rotation.x = p.state === 'windup' ? -0.5 : -0.24;
          rig.torso.rotation.x = 0.02;
          rig.torso.rotation.y = Math.sin(idleT * 0.5) * 0.04;
          rig.head.rotation.x = 0;
          rig.head.rotation.y = Math.sin(idleT * 0.75) * 0.24;
        }
      }

      if (rig.telegraphRing) {
        rig.telegraphRing.visible = p.state === 'windup';
        if (p.state === 'windup') {
          const s = 1 + Math.sin(nowSec * 24) * 0.14;
          rig.telegraphRing.scale.set(s, s, 1);
        }
      }
    }

    // 4. Soaring California Seagulls / Urban Birds
    const { bodies, leftWings, rightWings, count: birdCount } = birdFlock;
    for (let i = 0; i < birdCount; i++) {
      const orbitR = 24 + (i % 6) * 14;
      const centerX = ((i % 4) - 1.5) * 32;
      const centerZ = -22 - Math.floor(i / 4) * 18;
      const speed = 0.24 + (i % 5) * 0.045;
      const angle = nowSec * speed + i * 1.13;
      const bx = centerX + Math.cos(angle) * orbitR;
      const bz = centerZ + Math.sin(angle) * orbitR;
      const by = 18 + (i % 7) * 3.8 + Math.sin(nowSec * 0.9 + i) * 1.6;
      const heading = -angle;
      const flapCycle = Math.sin(nowSec * (6.2 + (i % 3) * 1.1) + i * 2.4);
      const glideGate = Math.sin(nowSec * 0.45 + i * 1.7) > -0.25 ? 1.0 : 0.18;
      const flapAngle = flapCycle * 0.56 * glideGate;
      const birdScale = 0.85 + (i % 3) * 0.18;

      _dummy.position.set(bx, by, bz);
      _dummy.rotation.set(0, heading, Math.sin(angle) * 0.12);
      _dummy.scale.setScalar(birdScale);
      _dummy.updateMatrix();
      bodies.setMatrixAt(i, _dummy.matrix);

      _wingDummy.position.set(bx, by, bz);
      _wingDummy.rotation.set(0, heading, flapAngle);
      _wingDummy.scale.setScalar(birdScale);
      _wingDummy.updateMatrix();
      leftWings.setMatrixAt(i, _wingDummy.matrix);

      _wingDummy.rotation.set(0, heading, -flapAngle);
      _wingDummy.updateMatrix();
      rightWings.setMatrixAt(i, _wingDummy.matrix);
    }
    bodies.instanceMatrix.needsUpdate = true;
    leftWings.instanceMatrix.needsUpdate = true;
    rightWings.instanceMatrix.needsUpdate = true;

    // 5. Golden Hour Dust Motes
    dustMotes.position.set(
      focusX + Math.sin(nowSec * 0.22) * 1.8,
      Math.sin(nowSec * 0.35) * 0.45,
      focusZ + Math.cos(nowSec * 0.18) * 1.8,
    );
    const dustMat = dustMotes.material as THREE.PointsMaterial;
    const isRainy = weather === 'rain' || weather === 'storm';
    const dustAlpha = isRainy ? 0 : (1 - nightFactor) * 0.26;
    dustMat.opacity = dustAlpha;
    dustMotes.visible = dustAlpha > 0.02;

    // 6. Storefront Shop Beacons
    for (let i = 0; i < shopMarkers.length; i++) {
      const m = shopMarkers[i];
      const icon = m.getObjectByName('shop_icon');
      if (icon) {
        icon.rotation.y = nowSec * 1.8 + i;
        icon.position.y = 1.55 + Math.sin(nowSec * 2.8 + i) * 0.14;
      }
    }

    // 7. Active Checkpoint Ring
    if (checkpointGroup.visible) {
      checkpointRing.rotation.z += dt * 1.4;
      const pulse = 1 + Math.sin(nowSec * 4) * 0.08;
      checkpointRing.scale.set(pulse, pulse, 1);
    }
  }
}
