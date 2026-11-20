import * as THREE from 'three';
import type { GamePhase, PedState, PlayerState, VehicleState, WeatherType } from '../types';
import type { CharacterRig, VehicleRig, WorldVisuals } from '../models';
import { computeVehicleDoorWorldPoint, dampValue, normalizeAngle } from '../physics';
import {
  computeAckermannSteer,
  HYPERCAR_SPEC,
  lerp,
  smoothstep,
  stepHydraulic,
} from '../rendering/hypercarBuilders';
import {
  getRobberyCjWorldTransform,
  getRobberyClerkWorldTransform,
  type RobberySession,
} from '../robberySystem';
import { updateShopWorldVisuals, type ShopWorldVisuals } from '../world/shopWorldBuilder';
import type { InstancedPedestrianCrowd } from './instancedPedestrians';

import {
  blendCharacterPose,
  DOOR_HYDRAULIC_CLOSE_SPEED,
  DOOR_HYDRAULIC_OPEN_SPEED,
  evaluateVehicleEntryPose,
  evaluateVehicleExitPose,
  getVehicleTransitionDoorTarget,
  SEATED_LOCAL_X,
  SEATED_LOCAL_Z,
  SEATED_RIG_SCALE,
  SEATED_ROOT_LOCAL_Y,
  smootherstep01,
  type CharacterPoseSnapshot,
} from '../simulation/vehicleEntryChoreography';
import {
  interpolatePlayerPose,
  interpolateVehiclePose,
  selectVehicleLodTier,
  type PlayerPoseSnapshot,
  type RenderPoseHistory,
  type VehicleLodTier,
  type VehiclePoseSnapshot,
} from '../simulation/renderInterpolation';

const _dummy = new THREE.Object3D();
const _wingDummy = new THREE.Object3D();
const _qDoor = new THREE.Quaternion();
const _interpVehicle: VehiclePoseSnapshot = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 };
const _interpActiveCar: VehiclePoseSnapshot = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 };
const _interpPlayer: PlayerPoseSnapshot = { x: 0, y: 0, z: 0, heading: 0 };

export const CLERK_PED_ID_BY_SHOP: Record<string, string> = {
  shop_247: 'clerk_247',
  shop_binco: 'clerk_binco',
  shop_cluckin: 'clerk_cluckin',
  shop_ammunation: 'clerk_ammu',
  shop_lscustoms: 'clerk_customs',
  shop_burgershot: 'clerk_burger',
  shop_suburban: 'clerk_suburban',
};

const SHOP_ID_BY_CLERK_PED: Record<string, string> = Object.fromEntries(
  Object.entries(CLERK_PED_ID_BY_SHOP).map(([shopId, pedId]) => [pedId, shopId]),
);

export interface EntityAnimatorSyncParams {
  dt: number;
  nowSec: number;
  frameCounter: number;
  phase: GamePhase;
  weather: WeatherType;
  nightFactor: number;
  player: PlayerState;
  playerRig: CharacterRig;
  vehicles: readonly VehicleState[];
  vehicleRigs: ReadonlyMap<string, VehicleRig>;
  peds: readonly PedState[];
  pedCrowd: InstancedPedestrianCrowd;
  birdFlock: WorldVisuals['birdFlock'];
  dustMotes: THREE.Points;
  shopMarkers: readonly THREE.Group[];
  shopVisuals: ShopWorldVisuals;
  robberySession: RobberySession | null;
  shopCooldowns?: ReadonlyMap<string, number>;
  onDoorOpened?: (shopId: string) => void;
  checkpointGroup: THREE.Group;
  checkpointRing: THREE.Mesh;
  /** Sub-tick interpolated vehicle transition progress (0..1) for jitter-free high-Hz rendering. */
  transitionProgressOverride?: number;
  /** Previous-tick pose cache + simulation alpha (0..1) for jitter-free fixed-step interpolation. */
  poseHistory?: RenderPoseHistory;
  simAlpha?: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Synchronizes all 3D visual rigs (vehicles, dihedral butterfly doors & struts,
 * CJ AAA entry/exit/cockpit/on-foot/in-world robbery locomotion, 118 NPCs & live clerks
 * with distance/shadow culling, automatic sliding store doors, unified RobberyWorldKit,
 * soaring birds, dust motes, and checkpoint beacons).
 */
export class EntityAnimator {
  private playerShadowMesh: THREE.Object3D | null | undefined = undefined;
  private readonly vehicleShadowActive = new Map<string, boolean>();
  private readonly vehicleLodTier = new Map<string, VehicleLodTier>();
  private lastTransitionMode: 'none' | 'entering' | 'exiting' = 'none';
  private transitionStartPose: CharacterPoseSnapshot | null = null;
  private postTransitionPose: CharacterPoseSnapshot | null = null;
  private postTransitionBlendTimer = 0;
  private readonly scratchPoseA: CharacterPoseSnapshot = {
    posX: 0,
    posY: 0,
    posZ: 0,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    scale: 1,
    torsoPosY: 0.99,
    torsoRotX: 0,
    torsoRotY: 0,
    torsoRotZ: 0,
    headRotX: 0,
    headRotY: 0,
    headRotZ: 0,
    leftArmRotX: 0,
    leftArmRotY: 0,
    leftArmRotZ: -0.11,
    rightArmRotX: 0,
    rightArmRotY: 0,
    rightArmRotZ: 0.11,
    leftForearmRotX: -0.22,
    rightForearmRotX: -0.22,
    leftLegRotX: 0,
    leftLegRotZ: -0.03,
    rightLegRotX: 0,
    rightLegRotZ: 0.03,
    leftShinRotX: 0.05,
    rightShinRotX: 0.05,
    shadowScale: 1,
  };
  private readonly scratchPoseB: CharacterPoseSnapshot = { ...this.scratchPoseA };

  private setPlayerShadowScale(playerRig: CharacterRig, scale: number): void {
    if (this.playerShadowMesh === undefined) {
      this.playerShadowMesh = playerRig.root.getObjectByName('contact_shadow') ?? null;
    }
    if (this.playerShadowMesh) {
      const clamped = clamp01(scale);
      const visible = clamped > 0.01;
      this.playerShadowMesh.visible = visible;
      if (visible) {
        this.playerShadowMesh.scale.setScalar(clamped);
      }
    }
  }

  private setPlayerShadowVisible(playerRig: CharacterRig, visible: boolean): void {
    this.setPlayerShadowScale(playerRig, visible ? 1 : 0);
  }

  private captureRigPose(playerRig: CharacterRig, out: CharacterPoseSnapshot): CharacterPoseSnapshot {
    if (this.playerShadowMesh === undefined) {
      this.playerShadowMesh = playerRig.root.getObjectByName('contact_shadow') ?? null;
    }
    out.posX = playerRig.root.position.x;
    out.posY = playerRig.root.position.y;
    out.posZ = playerRig.root.position.z;
    out.rotX = playerRig.root.rotation.x;
    out.rotY = playerRig.root.rotation.y;
    out.rotZ = playerRig.root.rotation.z;
    out.scale = playerRig.root.scale.x;
    out.torsoPosY = playerRig.torso.position.y;
    out.torsoRotX = playerRig.torso.rotation.x;
    out.torsoRotY = playerRig.torso.rotation.y;
    out.torsoRotZ = playerRig.torso.rotation.z;
    out.headRotX = playerRig.head.rotation.x;
    out.headRotY = playerRig.head.rotation.y;
    out.headRotZ = playerRig.head.rotation.z;
    out.leftArmRotX = playerRig.leftArm.rotation.x;
    out.leftArmRotY = playerRig.leftArm.rotation.y;
    out.leftArmRotZ = playerRig.leftArm.rotation.z;
    out.rightArmRotX = playerRig.rightArm.rotation.x;
    out.rightArmRotY = playerRig.rightArm.rotation.y;
    out.rightArmRotZ = playerRig.rightArm.rotation.z;
    out.leftForearmRotX = playerRig.leftForearm.rotation.x;
    out.rightForearmRotX = playerRig.rightForearm.rotation.x;
    out.leftLegRotX = playerRig.leftLeg.rotation.x;
    out.leftLegRotZ = playerRig.leftLeg.rotation.z;
    out.rightLegRotX = playerRig.rightLeg.rotation.x;
    out.rightLegRotZ = playerRig.rightLeg.rotation.z;
    out.leftShinRotX = playerRig.leftShin.rotation.x;
    out.rightShinRotX = playerRig.rightShin.rotation.x;
    out.shadowScale =
      this.playerShadowMesh && this.playerShadowMesh.visible ? this.playerShadowMesh.scale.x : 0;
    return out;
  }

  private applyRigPose(playerRig: CharacterRig, pose: CharacterPoseSnapshot): void {
    this.setPlayerShadowScale(playerRig, pose.shadowScale);
    playerRig.root.scale.setScalar(pose.scale);
    playerRig.root.position.set(pose.posX, pose.posY, pose.posZ);
    playerRig.root.rotation.set(pose.rotX, pose.rotY, pose.rotZ);
    playerRig.torso.position.set(0, pose.torsoPosY, 0);
    playerRig.torso.rotation.set(pose.torsoRotX, pose.torsoRotY, pose.torsoRotZ);
    playerRig.head.rotation.set(pose.headRotX, pose.headRotY, pose.headRotZ);
    playerRig.leftArm.rotation.set(pose.leftArmRotX, pose.leftArmRotY, pose.leftArmRotZ);
    playerRig.rightArm.rotation.set(pose.rightArmRotX, pose.rightArmRotY, pose.rightArmRotZ);
    playerRig.leftForearm.rotation.set(pose.leftForearmRotX, 0, 0);
    playerRig.rightForearm.rotation.set(pose.rightForearmRotX, 0, 0);
    playerRig.leftLeg.rotation.set(pose.leftLegRotX, 0, pose.leftLegRotZ);
    playerRig.rightLeg.rotation.set(pose.rightLegRotX, 0, pose.rightLegRotZ);
    playerRig.leftShin.rotation.set(pose.leftShinRotX, 0, 0);
    playerRig.rightShin.rotation.set(pose.rightShinRotX, 0, 0);
  }

  private findVehicle(vehicles: readonly VehicleState[], id: string | null): VehicleState | null {
    if (!id) return null;
    for (let i = 0; i < vehicles.length; i++) {
      if (vehicles[i].id === id) return vehicles[i];
    }
    return null;
  }

  private animateRobberyCj(
    playerRig: CharacterRig,
    s: RobberySession,
    dt: number,
    nowSec: number,
  ): void {
    const worldPose = getRobberyCjWorldTransform(s);
    this.setPlayerShadowVisible(playerRig, true);
    playerRig.root.scale.setScalar(1);
    playerRig.root.rotation.x = 0;
    playerRig.root.rotation.z = 0;
    playerRig.root.position.set(worldPose.x, 0, worldPose.z);
    playerRig.root.rotation.y = worldPose.heading;

    let torsoY = 0.99;
    let torsoPitch = 0;
    let torsoYaw = 0;
    let lArmX = 0.1;
    let lArmZ = -0.08;
    let lForeX = -0.25;
    let rArmX = 0.1;
    let rArmZ = 0.08;
    let rForeX = -0.25;
    let legSwing = 0;

    if (s.cjGesture === 'walk' || s.cjGesture === 'sprint_exit') {
      const amp = s.cjGesture === 'sprint_exit' ? 0.78 : 0.52;
      legSwing = Math.sin(s.cjWalkCycle) * amp;
      torsoPitch = s.cjGesture === 'sprint_exit' ? 0.16 : 0.06;
      lArmX = -legSwing * 0.7;
      rArmX = legSwing * 0.7;
      lForeX = -0.45;
      rForeX = -0.45;
    } else if (s.cjGesture === 'point' || s.phase === 'intimidate') {
      torsoPitch = 0.12;
      torsoYaw = -0.22;
      rArmX = -1.38 + Math.sin(nowSec * 6.5) * 0.08;
      rArmZ = 0.14;
      rForeX = -0.22;
      lArmX = -0.62;
      lArmZ = -0.26;
      lForeX = -0.65;
    } else if (s.cjGesture === 'slam') {
      const slamWave = Math.sin((s.cjGestureTimer / 0.45) * Math.PI);
      torsoPitch = 0.28 * slamWave + 0.08;
      rArmX = -1.1 - slamWave * 0.45;
      lArmX = -1.05 - slamWave * 0.35;
      rForeX = -0.45;
      lForeX = -0.45;
    } else if (s.cjGesture === 'bag_sweep' || s.phase === 'comply_bag') {
      const sweep = s.cjGestureTimer > 0 ? Math.sin((s.cjGestureTimer / 0.42) * Math.PI) : 0;
      torsoPitch = 0.14 + sweep * 0.1;
      torsoYaw = -0.25 + sweep * 0.58;
      rArmX = -1.08;
      rArmZ = 0.2 - sweep * 0.65;
      rForeX = -0.58;
      lArmX = -0.92;
      lArmZ = -0.25;
      lForeX = -0.55;
    } else if (s.cjGesture === 'duck_dodge') {
      torsoY = 0.74;
      torsoPitch = 0.52;
      torsoYaw = -0.35;
      lArmX = -1.2;
      lForeX = -1.35;
      rArmX = -1.2;
      rForeX = -1.35;
    } else if (s.cjGesture === 'counter_hook' || s.cjGesture === 'punch_r') {
      torsoPitch = 0.16;
      torsoYaw = 0.55;
      rArmX = -1.52;
      rArmZ = -0.28;
      rForeX = -0.32;
      lArmX = -1.1;
      lForeX = -1.25;
    } else if (s.cjGesture === 'punch_l') {
      torsoPitch = 0.14;
      torsoYaw = -0.48;
      lArmX = -1.5;
      lArmZ = 0.22;
      lForeX = -0.35;
      rArmX = -1.1;
      rForeX = -1.25;
    } else if (s.cjGesture === 'hurt') {
      torsoPitch = -0.28;
      torsoYaw = 0.25;
      lArmX = -0.6;
      rArmX = -0.7;
    } else if (
      s.phase === 'rebel_brawl' ||
      s.phase === 'rebel_qte_dodge' ||
      s.phase === 'rebel_qte_counter'
    ) {
      torsoPitch = 0.1;
      torsoYaw = -0.18;
      lArmX = -1.15;
      lArmZ = -0.2;
      lForeX = -1.25;
      rArmX = -1.22;
      rArmZ = 0.16;
      rForeX = -1.32;
    }

    const lam = 15;
    playerRig.torso.position.y = dampValue(playerRig.torso.position.y, torsoY, lam, dt);
    playerRig.torso.rotation.x = dampValue(playerRig.torso.rotation.x, torsoPitch, lam, dt);
    playerRig.torso.rotation.y = dampValue(playerRig.torso.rotation.y, torsoYaw, lam, dt);
    playerRig.torso.rotation.z = dampValue(playerRig.torso.rotation.z, 0, lam, dt);
    playerRig.head.rotation.set(0, 0, 0);
    playerRig.leftArm.rotation.x = dampValue(playerRig.leftArm.rotation.x, lArmX, lam, dt);
    playerRig.leftArm.rotation.z = dampValue(playerRig.leftArm.rotation.z, lArmZ, lam, dt);
    playerRig.leftForearm.rotation.x = dampValue(playerRig.leftForearm.rotation.x, lForeX, lam, dt);
    playerRig.rightArm.rotation.x = dampValue(playerRig.rightArm.rotation.x, rArmX, lam, dt);
    playerRig.rightArm.rotation.z = dampValue(playerRig.rightArm.rotation.z, rArmZ, lam, dt);
    playerRig.rightForearm.rotation.x = dampValue(playerRig.rightForearm.rotation.x, rForeX, lam, dt);
    playerRig.leftLeg.rotation.x = dampValue(playerRig.leftLeg.rotation.x, legSwing, lam, dt);
    playerRig.rightLeg.rotation.x = dampValue(playerRig.rightLeg.rotation.x, -legSwing, lam, dt);
    playerRig.leftShin.rotation.x = dampValue(
      playerRig.leftShin.rotation.x,
      Math.max(0, -legSwing * 0.7) + 0.05,
      lam,
      dt,
    );
    playerRig.rightShin.rotation.x = dampValue(
      playerRig.rightShin.rotation.x,
      Math.max(0, legSwing * 0.7) + 0.05,
      lam,
      dt,
    );
  }

  public sync(params: EntityAnimatorSyncParams): void {
    const {
      dt,
      nowSec,
      frameCounter,
      weather,
      nightFactor,
      player,
      playerRig,
      vehicles,
      vehicleRigs,
      peds,
      pedCrowd,
      birdFlock,
      dustMotes,
      shopMarkers,
      shopVisuals,
      robberySession,
      shopCooldowns,
      onDoorOpened,
      checkpointGroup,
      checkpointRing,
    } = params;

    const night = nightFactor > 0.45 || weather === 'rain' || weather === 'storm';
    const trans = player.vehicleTransition;

    // 0. Automatic Walk-In Store Doors, Pooled Interior Light, Street Cart Steam & Unified RobberyWorldKit
    const doorPlayerPos = robberySession ? getRobberyCjWorldTransform(robberySession) : player;
    const focusX = doorPlayerPos.x;
    const focusZ = doorPlayerPos.z;
    const newlyOpenedShopId = updateShopWorldVisuals(
      shopVisuals,
      focusX,
      focusZ,
      robberySession?.shop.id ?? null,
      dt,
      nowSec,
    );
    if (newlyOpenedShopId && onDoorOpened) {
      onDoorOpened(newlyOpenedShopId);
    }
    if (robberySession) {
      shopVisuals.robberyKit.update(robberySession, dt, nowSec);
    }

    // 1. Vehicles (Fused Class-A V12 Hypercars with physics interpolation, 3-tier LOD & top-2 shadow budget)
    const headShimmer = 2.15 + Math.sin(nowSec * 1.6) * 0.1;
    const sirenPulse = Math.sin(nowSec * 18) > 0;
    const nitroFlicker = 0.8 + Math.sin(nowSec * 45) * 0.25;
    const poseHistory = params.poseHistory;
    const simAlpha = params.simAlpha ?? 1;

    // Identify up to 2 nearest non-player vehicles within 28m (784m^2) eligible for sun shadow casting
    let nearShadowId1: string | null = null;
    let nearShadowDist1 = 784;
    let nearShadowId2: string | null = null;
    let nearShadowDist2 = 784;
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (player.inVehicleId === v.id || (trans.mode !== 'none' && trans.vehicleId === v.id)) {
        continue;
      }
      const dx = v.x - focusX;
      const dz = v.z - focusZ;
      const dSq = dx * dx + dz * dz;
      if (dSq < nearShadowDist1) {
        nearShadowId2 = nearShadowId1;
        nearShadowDist2 = nearShadowDist1;
        nearShadowId1 = v.id;
        nearShadowDist1 = dSq;
      } else if (dSq < nearShadowDist2) {
        nearShadowId2 = v.id;
        nearShadowDist2 = dSq;
      }
    }

    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      const rig = vehicleRigs.get(v.id);
      if (!rig) continue;

      const isPlayerCar = player.inVehicleId === v.id;
      const isTransVehicle = trans.mode !== 'none' && trans.vehicleId === v.id;

      const vPose = poseHistory
        ? interpolateVehiclePose(poseHistory.getPrevVehicle(v.id), v, simAlpha, _interpVehicle)
        : v;

      const vdx = vPose.x - focusX;
      const vdz = vPose.z - focusZ;
      const distSq = vdx * vdx + vdz * vdz;

      // Far-horizon culling (>165m, behind buildings/distance haze): 0 draw calls & 0 triangles
      if (!isPlayerCar && !isTransVehicle && distSq > 27225) {
        if (rig.root.visible) rig.root.visible = false;
        continue;
      }
      if (!rig.root.visible) rig.root.visible = true;

      rig.root.position.set(vPose.x, vPose.y, vPose.z);
      rig.root.rotation.y = vPose.heading;

      // Shadow budget: hero/transition car + at most 2 nearest other cars within 28m
      const shouldCastShadow =
        isPlayerCar || isTransVehicle || v.id === nearShadowId1 || v.id === nearShadowId2;
      if (this.vehicleShadowActive.get(v.id) !== shouldCastShadow) {
        this.vehicleShadowActive.set(v.id, shouldCastShadow);
        const casters = rig.shadowCastMeshes;
        for (let c = 0; c < casters.length; c++) {
          casters[c].castShadow = shouldCastShadow;
        }
      }

      const hc = rig.hypercar;

      if (isTransVehicle) {
        const doorObj = trans.side === 1 ? hc.doorL : hc.doorR;
        const otherDoor = trans.side === 1 ? hc.doorR : hc.doorL;
        otherDoor.target = 0;
        hc.autoCloseTimer = 0;

        const transProgress = params.transitionProgressOverride ?? trans.progress;
        const desiredTarget = getVehicleTransitionDoorTarget(
          trans.mode as 'entering' | 'exiting',
          transProgress,
        );
        if (desiredTarget === 1 && doorObj.target === 0) {
          hc.pulseTime = 0;
        }
        doorObj.target = desiredTarget;
      } else {
        if (hc.autoCloseTimer > 0) {
          hc.autoCloseTimer = Math.max(0, hc.autoCloseTimer - dt);
          if (hc.autoCloseTimer === 0) {
            hc.doorL.target = 0;
            hc.doorR.target = 0;
          }
        }
        if (Math.abs(v.speed) > 2.2 && (hc.doorL.target > 0 || hc.doorR.target > 0)) {
          hc.doorL.target = 0;
          hc.doorR.target = 0;
          hc.autoCloseTimer = 0;
        }
      }

      const hydraulicsActive =
        isTransVehicle ||
        hc.doorL.value > 0 ||
        hc.doorL.target > 0 ||
        hc.doorR.value > 0 ||
        hc.doorR.target > 0 ||
        hc.frunk.value > 0 ||
        hc.frunk.target > 0;

      // Seamless 3-tier Class-A LOD switching with hysteresis:
      // LOD0 (<18-22m) | LOD1 (22-56m) | LOD2 (>56m ultra-light ~3K tris)
      const prevTier = this.vehicleLodTier.get(v.id) ?? 0;
      const forceLod0 = isPlayerCar || isTransVehicle || hydraulicsActive;
      const nextTier = selectVehicleLodTier(prevTier, distSq, forceLod0);
      if (nextTier !== prevTier) {
        this.vehicleLodTier.set(v.id, nextTier);
        rig.setLodLevel(nextTier);
      }

      if (nextTier === 2) {
        // LOD2 (>56m): zero wheel-spin or hydraulic overhead
      } else if (nextTier === 1) {
        rig.lod1BodyGroup.rotation.x = vPose.pitch;
        rig.lod1BodyGroup.rotation.z = vPose.roll;
        rig.lod1Wheels[0].rotation.x = v.frontWheelSpin;
        rig.lod1Wheels[1].rotation.x = v.frontWheelSpin;
        rig.lod1Wheels[2].rotation.x = v.rearWheelSpin;
        rig.lod1Wheels[3].rotation.x = v.rearWheelSpin;
      } else {
        rig.bodyGroup.rotation.x = vPose.pitch;
        rig.bodyGroup.rotation.z = vPose.roll;

        // Cull opaque-occluded frunk bay + Weekender bag whenever the frunk lid is sealed shut
        const frunkBayOpen = hc.frunk.value > 0.002 || hc.frunk.target > 0;
        if (rig.frunkBayGroup.visible !== frunkBayOpen) {
          rig.frunkBayGroup.visible = frunkBayOpen;
        }

        // 4-Corner independent wheel suspension travel over 0.145m road curbs
        const fWheelY = HYPERCAR_SPEC.fR + Math.max(-0.09, Math.min(0.14, v.wheelGroundY[0] - vPose.y));
        const frWheelY = HYPERCAR_SPEC.fR + Math.max(-0.09, Math.min(0.14, v.wheelGroundY[1] - vPose.y));
        const rlWheelY = HYPERCAR_SPEC.rR + Math.max(-0.09, Math.min(0.14, v.wheelGroundY[2] - vPose.y));
        const rrWheelY = HYPERCAR_SPEC.rR + Math.max(-0.09, Math.min(0.14, v.wheelGroundY[3] - vPose.y));
        const cr0 = rig.wheelCornerRoots[0];
        if (Math.abs(cr0.position.y - fWheelY) > 1e-4) {
          cr0.position.y = fWheelY;
          cr0.updateMatrix();
        }
        const cr1 = rig.wheelCornerRoots[1];
        if (Math.abs(cr1.position.y - frWheelY) > 1e-4) {
          cr1.position.y = frWheelY;
          cr1.updateMatrix();
        }
        const cr2 = rig.wheelCornerRoots[2];
        if (Math.abs(cr2.position.y - rlWheelY) > 1e-4) {
          cr2.position.y = rlWheelY;
          cr2.updateMatrix();
        }
        const cr3 = rig.wheelCornerRoots[3];
        if (Math.abs(cr3.position.y - rrWheelY) > 1e-4) {
          cr3.position.y = rrWheelY;
          cr3.updateMatrix();
        }

        const steerVis = v.visualSteerAngle;
        if (Math.abs(steerVis) > 1e-4 || rig.frontLeftPivot.rotation.y !== 0) {
          const { leftSteer, rightSteer } = computeAckermannSteer(steerVis);
          rig.frontLeftPivot.rotation.y = leftSteer;
          rig.frontRightPivot.rotation.y = rightSteer;
          hc.steeringWheelSpin.rotation.z = -steerVis * 2.4;
        }

        rig.wheels[0].rotation.x = v.frontWheelSpin;
        rig.wheels[1].rotation.x = v.frontWheelSpin;
        rig.wheels[2].rotation.x = v.rearWheelSpin;
        rig.wheels[3].rotation.x = v.rearWheelSpin;

        if (hydraulicsActive) {
          const dLSpeed =
            hc.doorL.target > hc.doorL.value
              ? DOOR_HYDRAULIC_OPEN_SPEED
              : DOOR_HYDRAULIC_CLOSE_SPEED;
          const dRSpeed =
            hc.doorR.target > hc.doorR.value
              ? DOOR_HYDRAULIC_OPEN_SPEED
              : DOOR_HYDRAULIC_CLOSE_SPEED;
          const dL = stepHydraulic(hc.doorL, dt, dLSpeed);
          const dR = stepHydraulic(hc.doorR, dt, dRSpeed);
          const fr = stepHydraulic(hc.frunk, dt, 0.85);

          if (dL > 0.0001) {
            _qDoor.setFromAxisAngle(hc.doorLAxis, dL * hc.doorMaxAngle);
            hc.doorLPivot.quaternion.copy(_qDoor);
          } else {
            hc.doorLPivot.quaternion.identity();
          }

          if (dR > 0.0001) {
            _qDoor.setFromAxisAngle(hc.doorRAxis, dR * hc.doorMaxAngle);
            hc.doorRPivot.quaternion.copy(_qDoor);
          } else {
            hc.doorRPivot.quaternion.identity();
          }

          hc.frunkPivot.rotation.x = -fr * THREE.MathUtils.degToRad(44);
          hc.frunkLedMat.emissiveIntensity = lerp(0.15, 2.8, smoothstep(0.08, 0.55, fr));

          const showL = dL > 0.002;
          const showR = dR > 0.002;
          const showFr = fr > 0.002;
          hc.doorLStrut.setVisible(showL);
          hc.doorRStrut.setVisible(showR);
          hc.frunkStrutL.setVisible(showFr);
          hc.frunkStrutR.setVisible(showFr);

          // Targeted parent-chain matrix update (4 nodes vs 120+ hypercar children)
          if (showL || showR || showFr) {
            if (showL) {
              hc.doorLStrut.anchorA.updateWorldMatrix(true, false);
              hc.doorLStrut.anchorB.updateWorldMatrix(true, false);
              hc.doorLStrut.update(rig.bodyGroup);
            }
            if (showR) {
              hc.doorRStrut.anchorA.updateWorldMatrix(true, false);
              hc.doorRStrut.anchorB.updateWorldMatrix(true, false);
              hc.doorRStrut.update(rig.bodyGroup);
            }
            if (showFr) {
              hc.frunkStrutL.anchorA.updateWorldMatrix(true, false);
              hc.frunkStrutL.anchorB.updateWorldMatrix(true, false);
              hc.frunkStrutR.anchorA.updateWorldMatrix(true, false);
              hc.frunkStrutR.anchorB.updateWorldMatrix(true, false);
              hc.frunkStrutL.update(rig.bodyGroup);
              hc.frunkStrutR.update(rig.bodyGroup);
            }
          }
        }
      }

      let pulseBoost = 0;
      if (hc.pulseTime >= 0) {
        hc.pulseTime += dt;
        const p1 = Math.exp(-Math.pow((hc.pulseTime - 0.14) / 0.06, 2));
        const p2 = Math.exp(-Math.pow((hc.pulseTime - 0.36) / 0.08, 2));
        pulseBoost = (p1 + p2 * 0.8) * 1.45;
        if (hc.pulseTime > 1.2) hc.pulseTime = -1;
      }

      const baseTailIntensity = v.braking ? 3.8 : night ? 2.45 : 1.75;
      const baseHeadIntensity = night ? 3.4 : headShimmer;
      rig.taillightMat.emissiveIntensity = baseTailIntensity + pulseBoost * 0.9;
      rig.headlightMat.emissiveIntensity = baseHeadIntensity + pulseBoost;

      const beamOpacity = night && v.driver !== 'none' ? 0.18 : 0.0;
      const showBeam = beamOpacity > 0.002;
      rig.headlightBeam.visible = showBeam;
      if (showBeam) {
        (rig.headlightBeam.material as THREE.MeshBasicMaterial).opacity = beamOpacity;
      }

      const showNitro = nextTier === 0 && v.nitroActive;
      rig.nitroFlameLeft.visible = showNitro;
      rig.nitroFlameRight.visible = showNitro;
      if (showNitro) {
        rig.nitroFlameLeft.scale.set(1, 1, nitroFlicker);
        rig.nitroFlameRight.scale.set(1, 1, nitroFlicker);
      }

      if (rig.sirenRedMat && rig.sirenBlueMat) {
        if (v.sirenOn) {
          rig.sirenRedMat.emissiveIntensity = sirenPulse ? 4.8 : 0.25;
          rig.sirenBlueMat.emissiveIntensity = sirenPulse ? 0.25 : 4.8;
        } else {
          rig.sirenRedMat.emissiveIntensity = 0.3;
          rig.sirenBlueMat.emissiveIntensity = 0.3;
        }
      }
    }

    // 2. CJ Protagonist (In-World Robbery, AAA Entry/Exit Choreography, Seated Cockpit, or On-Foot)
    playerRig.root.visible = true;
    const activeCar = this.findVehicle(vehicles, player.inVehicleId);
    const transCar =
      trans.mode !== 'none' ? this.findVehicle(vehicles, trans.vehicleId) : null;

    if (trans.mode !== this.lastTransitionMode) {
      if (trans.mode !== 'none') {
        this.transitionStartPose = this.captureRigPose(playerRig, { ...this.scratchPoseA });
        this.postTransitionPose = null;
        this.postTransitionBlendTimer = 0;
      } else {
        this.postTransitionPose = this.captureRigPose(playerRig, { ...this.scratchPoseA });
        this.postTransitionBlendTimer = 0.16;
        this.transitionStartPose = null;
      }
      this.lastTransitionMode = trans.mode;
    }

    const transProgress = params.transitionProgressOverride ?? trans.progress;

    if (robberySession) {
      this.postTransitionBlendTimer = 0;
      this.animateRobberyCj(playerRig, robberySession, dt, nowSec);
    } else if (transCar && trans.mode === 'entering') {
      const targetPose = evaluateVehicleEntryPose({
        progress: transProgress,
        side: trans.side,
        startX: trans.startX,
        startZ: trans.startZ,
        startHeading: trans.startHeading,
        car: transCar,
      });
      if (this.transitionStartPose && transProgress < 0.12) {
        const blendIn = smootherstep01(0, 0.12, transProgress);
        blendCharacterPose(this.transitionStartPose, targetPose, blendIn, this.scratchPoseB);
        this.applyRigPose(playerRig, this.scratchPoseB);
      } else {
        this.applyRigPose(playerRig, targetPose);
      }
    } else if (transCar && trans.mode === 'exiting') {
      const targetPose = evaluateVehicleExitPose({
        progress: transProgress,
        side: trans.side,
        car: transCar,
      });
      if (this.transitionStartPose && transProgress < 0.10) {
        const blendIn = smootherstep01(0, 0.10, transProgress);
        blendCharacterPose(this.transitionStartPose, targetPose, blendIn, this.scratchPoseB);
        this.applyRigPose(playerRig, this.scratchPoseB);
      } else {
        this.applyRigPose(playerRig, targetPose);
      }
    } else if (activeCar) {
      const carPose = poseHistory
        ? interpolateVehiclePose(
            poseHistory.getPrevVehicle(activeCar.id),
            activeCar,
            simAlpha,
            _interpActiveCar,
          )
        : activeCar;
      const seatPt = computeVehicleDoorWorldPoint(carPose, 1, SEATED_LOCAL_X, SEATED_LOCAL_Z);
      const steerTurn = activeCar.visualSteerAngle;
      const wheelTurn = -steerTurn * 1.1;

      const target = this.scratchPoseA;
      target.posX = seatPt.x;
      target.posY = carPose.y + SEATED_ROOT_LOCAL_Y;
      target.posZ = seatPt.z;
      target.rotX = carPose.pitch;
      target.rotY = carPose.heading;
      target.rotZ = carPose.roll;
      target.scale = SEATED_RIG_SCALE;
      target.torsoPosY = 0.99;
      target.torsoRotX = -0.34 - carPose.pitch * 0.7;
      target.torsoRotY = wheelTurn * 0.12;
      target.torsoRotZ = -carPose.roll * 1.25;
      target.headRotX = 0.05;
      target.headRotY = steerTurn * 0.48;
      target.headRotZ = -carPose.roll * 0.5;
      target.leftArmRotX = -1.04 + wheelTurn * 0.22;
      target.leftArmRotY = 0.08;
      target.leftArmRotZ = -0.14;
      target.rightArmRotX = -1.04 - wheelTurn * 0.22;
      target.rightArmRotY = -0.08;
      target.rightArmRotZ = 0.14;
      target.leftForearmRotX = -0.48 + wheelTurn * 0.12;
      target.rightForearmRotX = -0.48 - wheelTurn * 0.12;
      target.leftLegRotX = -1.32;
      target.leftLegRotZ = -0.05;
      target.rightLegRotX = -1.32;
      target.rightLegRotZ = 0.05;
      target.leftShinRotX = 1.35;
      target.rightShinRotX = 1.35;
      target.shadowScale = 0;

      if (this.postTransitionBlendTimer > 0 && this.postTransitionPose) {
        this.postTransitionBlendTimer = Math.max(0, this.postTransitionBlendTimer - dt);
        const alpha = smootherstep01(0, 1, 1 - this.postTransitionBlendTimer / 0.16);
        blendCharacterPose(this.postTransitionPose, target, alpha, this.scratchPoseB);
        this.applyRigPose(playerRig, this.scratchPoseB);
        if (this.postTransitionBlendTimer <= 0) this.postTransitionPose = null;
      } else {
        this.applyRigPose(playerRig, target);
      }
    } else {
      const pPose = poseHistory
        ? interpolatePlayerPose(poseHistory.getPrevPlayer(), player, simAlpha, _interpPlayer)
        : player;
      const spd = Math.hypot(player.vx, player.vz);
      const isMoving = spd > 0.25;
      const swing = Math.min(1, spd / 5.5) * 0.72;
      const phase = player.walkCycle;

      const sinP = Math.sin(phase);
      const breathe = Math.sin(nowSec * 2.4);
      const idleSway = Math.sin(nowSec * 1.15);

      const target = this.scratchPoseA;
      target.posX = pPose.x;
      target.posY = pPose.y;
      target.posZ = pPose.z;
      target.rotX = 0;
      target.rotY = pPose.heading;
      target.rotZ = 0;
      target.scale = 1;
      target.torsoPosY = 0.99 + breathe * 0.018 + Math.abs(sinP) * swing * 0.05;
      target.torsoRotX = isMoving ? Math.min(0.18, spd * 0.022) : 0.03;
      target.torsoRotY = isMoving ? -sinP * swing * 0.09 : idleSway * 0.035;
      target.torsoRotZ = 0;
      target.headRotX = 0;
      target.headRotY = isMoving ? sinP * swing * 0.05 : Math.sin(nowSec * 0.85) * 0.14;
      target.headRotZ = 0;
      target.leftArmRotX = isMoving ? -sinP * swing * 0.85 : 0.06 + breathe * 0.025;
      target.leftArmRotY = 0;
      target.leftArmRotZ = -0.11 - breathe * 0.015;
      target.rightArmRotX = isMoving ? sinP * swing * 0.85 : -0.04 - breathe * 0.02;
      target.rightArmRotY = 0;
      target.rightArmRotZ = 0.11 + breathe * 0.015;
      target.leftForearmRotX = isMoving
        ? -0.22 - Math.max(0, sinP) * swing * 0.55
        : -0.24 - breathe * 0.03;
      target.rightForearmRotX = isMoving
        ? -0.22 - Math.max(0, -sinP) * swing * 0.55
        : -0.22 + breathe * 0.02;
      target.leftLegRotX = isMoving ? sinP * swing : 0.03;
      target.leftLegRotZ = isMoving ? -0.01 : -0.03;
      target.rightLegRotX = isMoving ? -sinP * swing : -0.04;
      target.rightLegRotZ = isMoving ? 0.01 : 0.03;
      target.leftShinRotX = isMoving ? Math.max(0, -sinP) * swing * 0.85 : 0.05;
      target.rightShinRotX = isMoving ? Math.max(0, sinP) * swing * 0.85 : 0.05;
      target.shadowScale = 1;

      if (this.postTransitionBlendTimer > 0 && this.postTransitionPose) {
        this.postTransitionBlendTimer = Math.max(0, this.postTransitionBlendTimer - dt);
        const alpha = smootherstep01(0, 1, 1 - this.postTransitionBlendTimer / 0.16);
        blendCharacterPose(this.postTransitionPose, target, alpha, this.scratchPoseB);
        this.applyRigPose(playerRig, this.scratchPoseB);
        if (this.postTransitionBlendTimer <= 0) this.postTransitionPose = null;
      } else {
        this.applyRigPose(playerRig, target);
      }
    }

    // 3. GPU-Instanced Pedestrians & Live Clerks (118 NPCs in ~30 shared draw calls)
    const activeRobberyClerkId = robberySession
      ? CLERK_PED_ID_BY_SHOP[robberySession.shop.id]
      : null;

    pedCrowd.sync({
      peds,
      focusX,
      focusZ,
      dt,
      nowSec,
      frameCounter,
      robberySession,
      activeRobberyClerkId,
      shopIdByClerkPed: SHOP_ID_BY_CLERK_PED,
      shopCooldowns,
    });

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

    // 6. Storefront Shop Beacons (empty in walk-in world; kept for compatibility)
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
