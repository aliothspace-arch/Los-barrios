import * as THREE from 'three';
import type { CameraMode, ColliderAABB, PlayerState, VehicleState } from '../types';
import { dampValue, normalizeAngle } from '../physics';
import type { RobberySession } from '../robberySystem';
import type { SpatialHashGrid } from '../simulation/spatialHash';
import { getShopRoofCeilingClampY, shopLocalToWorld } from '../worldLayout';
import {
  interpolatePlayerPose,
  interpolateVehiclePose,
  type PlayerPoseSnapshot,
  type RenderPoseHistory,
  type VehiclePoseSnapshot,
} from '../simulation/renderInterpolation';

const CAMERA_ORDER: CameraMode[] = ['chase', 'cinematic', 'hood'];

const _camTargetPos = new THREE.Vector3();
const _camLookAt = new THREE.Vector3();
const _colliderScratch: ColliderAABB[] = [];
const _interpCamCar: VehiclePoseSnapshot = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 };
const _interpCamPlayer: PlayerPoseSnapshot = { x: 0, y: 0, z: 0, heading: 0 };

function smoothstep01(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function clampVal(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Decoupled 3D camera rig managing chase/cinematic/hood driving & on-foot
 * framing, cinematic 3/4-to-behind-car transition during AAA vehicle entry/exit,
 * seamless in-world robbery framing (both indoor retail & outdoor street carts),
 * anti-clip building & ceiling clamp probes, free pointer orbit with smooth
 * auto-return, and trauma² shake.
 */
export class CameraController {
  public readonly camera: THREE.PerspectiveCamera;
  private mode: CameraMode = 'chase';
  private yaw = 0;
  private pitch = 0.22;
  private orbitActive = false;
  private returnPending = false;
  private trauma = 0;
  private robberyBlend = 0;
  private wasInRobbery = false;
  private readonly currentLook = new THREE.Vector3(0, 2, -20);

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.25, 950);
    this.camera.position.set(16, 12, 26);
  }

  public getMode(): CameraMode {
    return this.mode;
  }

  public getYaw(): number {
    return this.yaw;
  }

  public getTrauma(): number {
    return this.trauma;
  }

  public addTrauma(amount: number): void {
    this.trauma = Math.min(1.0, this.trauma + amount);
  }

  public resetTrauma(): void {
    this.trauma = 0;
  }

  public setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  public cycleMode(): CameraMode {
    const idx = (CAMERA_ORDER.indexOf(this.mode) + 1) % CAMERA_ORDER.length;
    this.mode = CAMERA_ORDER[idx];
    return this.mode;
  }

  public snapBehind(heading: number, x: number, y: number, z: number, dist = 7.5): void {
    this.yaw = normalizeAngle(heading + Math.PI);
    this.pitch = 0.22;
    this.orbitActive = false;
    this.returnPending = false;
    this.robberyBlend = 0;
    this.wasInRobbery = false;
    this.camera.position.set(
      x + Math.sin(this.yaw) * dist,
      y + 2.2,
      z + Math.cos(this.yaw) * dist,
    );
    this.currentLook.set(
      x + Math.sin(heading) * 4.5,
      y + 1.45,
      z + Math.cos(heading) * 4.5,
    );
    this.camera.lookAt(this.currentLook);
  }

  public alignBehindHeading(heading: number): void {
    this.yaw = normalizeAngle(heading + Math.PI);
    this.pitch = 0.22;
    this.returnPending = false;
  }

  public requestAutoReturn(): void {
    this.returnPending = true;
  }

  public applyOrbitDelta(dx: number, dy: number): void {
    if (Math.abs(dx) <= 0.001 && Math.abs(dy) <= 0.001) return;
    this.yaw = normalizeAngle(this.yaw - dx * 0.0075);
    this.pitch = Math.max(0.06, Math.min(0.68, this.pitch + dy * 0.0055));
    if (!this.orbitActive) {
      this.returnPending = true;
    }
  }

  public setOrbitActive(active: boolean): void {
    if (this.orbitActive && !active) {
      this.returnPending = true;
    }
    this.orbitActive = active;
  }

  private setFovIfChanged(targetFov: number, lambda: number, dt: number): void {
    const nextFov = dampValue(this.camera.fov, targetFov, lambda, dt);
    if (Math.abs(nextFov - this.camera.fov) > 0.005) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Prevents the 3D camera from ever penetrating store walls, pillars, or store roofs
   * when CJ walks freely inside or exits through automatic sliding doors.
   */
  private applyAntiClipAndCeilingClamp(
    focus: THREE.Vector3,
    camPos: THREE.Vector3,
    spatialGrid?: SpatialHashGrid,
  ): void {
    if (spatialGrid) {
      const minX = Math.min(focus.x, camPos.x) - 0.35;
      const maxX = Math.max(focus.x, camPos.x) + 0.35;
      const minZ = Math.min(focus.z, camPos.z) - 0.35;
      const maxZ = Math.max(focus.z, camPos.z) + 0.35;
      spatialGrid.queryAABB(minX, maxX, minZ, maxZ, _colliderScratch);

      if (_colliderScratch.length > 0) {
        const steps = 14;
        let bestT = 1.0;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const px = focus.x + (camPos.x - focus.x) * t;
          const py = focus.y + (camPos.y - focus.y) * t;
          const pz = focus.z + (camPos.z - focus.z) * t;

          let blocked = false;
          for (let i = 0; i < _colliderScratch.length; i++) {
            const c = _colliderScratch[i];
            if (c.category !== 'building') continue;
            if (py > c.height + 0.15) continue;
            if (
              px >= c.minX - 0.28 &&
              px <= c.maxX + 0.28 &&
              pz >= c.minZ - 0.28 &&
              pz <= c.maxZ + 0.28
            ) {
              blocked = true;
              break;
            }
          }
          if (blocked) {
            bestT = Math.max(0.24, (s - 1) / steps);
            break;
          }
        }
        if (bestT < 1.0) {
          camPos.set(
            focus.x + (camPos.x - focus.x) * bestT,
            focus.y + (camPos.y - focus.y) * bestT,
            focus.z + (camPos.z - focus.z) * bestT,
          );
        }
      }
    }

    const focusCeil = getShopRoofCeilingClampY(focus.x, focus.z);
    const camCeil = getShopRoofCeilingClampY(camPos.x, camPos.z);
    const ceilY = camCeil ?? focusCeil;
    if (ceilY !== null) {
      camPos.y = Math.min(camPos.y, ceilY - 0.28);
    }
  }

  private computeInWorldRobberyTargets(
    session: RobberySession,
    nowSec: number,
  ): { targetFov: number; posLambda: number; lookLambda: number } {
    const shop = session.shop;
    const b = session.bounds;
    const sz = b.standoffZ;
    const cz = shop.counterLocalZ;
    const clz = b.clerkHomeZ;

    let camLx = -1.45;
    let camLy = 1.64;
    let camLz = sz + 1.25;
    let lookLx = 0.25;
    let lookLy = 1.38;
    let lookLz = clz - 0.1;
    let targetFov = 50;
    let posLambda = 6.8;
    let lookLambda = 8.4;

    if (session.phase === 'entering') {
      camLx = -1.62;
      camLy = 1.62;
      camLz = Math.min(b.maxZ - 0.85, sz + 1.38);
      lookLx = 0.22;
      lookLy = 1.36;
      lookLz = cz - 0.25;
      targetFov = 54;
    } else if (session.phase === 'intimidate' || session.phase === 'branch_reveal') {
      const sway = Math.sin(nowSec * 1.1) * 0.08;
      camLx = -1.78 + sway;
      camLy = 1.64;
      camLz = b.isOutdoor ? sz + 1.55 : Math.min(b.maxZ - 0.8, sz + 1.18);
      lookLx = 0.28;
      lookLy = 1.38;
      lookLz = clz - 0.05;
      targetFov = b.isOutdoor ? 52 : 50;
    } else if (session.phase === 'comply_open' || session.phase === 'comply_bag') {
      camLx = -1.68;
      camLy = 1.96;
      camLz = cz + 1.36;
      lookLx = 0.04;
      lookLy = 1.14;
      lookLz = cz;
      targetFov = 46;
      posLambda = 5.6;
    } else if (session.phase === 'rebel_draw') {
      camLx = -0.9;
      camLy = 1.64;
      camLz = sz + 1.45;
      lookLx = session.clerkX;
      lookLy = 1.32;
      lookLz = session.clerkZ;
      targetFov = 48;
      posLambda = 7.6;
    } else if (session.phase === 'rebel_qte_dodge' || session.phase === 'rebel_qte_counter') {
      camLx = -1.6;
      camLy = 1.58;
      camLz = sz + 1.65;
      lookLx = (session.cjX + session.clerkX) * 0.5;
      lookLy = 1.28;
      lookLz = (session.cjZ + session.clerkZ) * 0.5;
      targetFov = 52;
      posLambda = 9.0;
    } else if (session.phase === 'rebel_brawl') {
      const midX = session.cjX * 0.65 + session.clerkX * 0.35;
      const midZ = session.cjZ * 0.65 + session.clerkZ * 0.35;
      camLx = clampVal(session.cjX * 0.55 - 1.25, b.minX + 0.4, b.maxX - 0.4);
      camLz = clampVal(session.cjZ + 2.5, b.minZ + 0.5, b.maxZ - 0.45);
      camLy = b.isOutdoor ? 2.45 : 2.38;
      lookLx = midX;
      lookLy = 1.18;
      lookLz = Math.min(b.maxZ - 0.8, midZ - 0.25);
      targetFov = 58;
      posLambda = 6.2;
    } else {
      // Exiting hero tracking toward door / street
      camLx = 1.45;
      camLy = 1.65;
      camLz = b.isOutdoor ? sz + 1.55 : Math.min(b.maxZ - 0.45, sz + 1.35);
      lookLx = session.cjX;
      lookLy = 1.25;
      lookLz = session.cjZ + 0.6;
      targetFov = 56;
    }

    const camW = shopLocalToWorld(shop.originX, shop.originZ, shop.facingHeading, camLx, camLz);
    const lookW = shopLocalToWorld(shop.originX, shop.originZ, shop.facingHeading, lookLx, lookLz);

    _camTargetPos.set(camW.x, camLy, camW.z);
    _camLookAt.set(lookW.x, lookLy, lookW.z);

    return { targetFov, posLambda, lookLambda };
  }

  public update(params: {
    dt: number;
    nowSec: number;
    player: PlayerState;
    activeCar: VehicleState | null;
    transitionCar: VehicleState | null;
    robberySession: RobberySession | null;
    spatialGrid?: SpatialHashGrid;
    transitionProgressOverride?: number;
    poseHistory?: RenderPoseHistory;
    simAlpha?: number;
  }): void {
    const {
      dt,
      nowSec,
      player,
      activeCar,
      transitionCar,
      robberySession,
      spatialGrid,
      transitionProgressOverride,
      poseHistory,
      simAlpha = 1,
    } = params;

    if (robberySession) {
      this.wasInRobbery = true;
      this.robberyBlend = Math.min(1, this.robberyBlend + dt / 0.45);
      const { targetFov, posLambda, lookLambda } = this.computeInWorldRobberyTargets(
        robberySession,
        nowSec,
      );
      this.applyAntiClipAndCeilingClamp(_camLookAt, _camTargetPos, spatialGrid);

      const blendRate = this.robberyBlend < 1 ? 5.8 : posLambda;
      this.camera.position.lerp(_camTargetPos, 1 - Math.exp(-blendRate * dt));
      this.currentLook.lerp(_camLookAt, 1 - Math.exp(-lookLambda * dt));
      this.setFovIfChanged(targetFov, 6.0, dt);
      this.camera.lookAt(this.currentLook);

      if (this.trauma > 0) {
        const shake = this.trauma * this.trauma;
        this.camera.rotation.z += Math.sin(nowSec * 54) * shake * 0.055;
        this.camera.rotation.x += Math.cos(nowSec * 41) * shake * 0.038;
        this.trauma = Math.max(0, this.trauma - dt * 1.9);
      }
      return;
    }

    if (this.wasInRobbery) {
      this.wasInRobbery = false;
      this.robberyBlend = 0;
      this.alignBehindHeading(player.heading);
    }

    const trans = player.vehicleTransition;

    if (trans.mode !== 'none' && transitionCar) {
      const transP = transitionProgressOverride ?? trans.progress;
      const behindYaw = normalizeAngle(transitionCar.heading + Math.PI);
      const side34Yaw = normalizeAngle(behindYaw + trans.side * 0.72);
      const chaseDist = this.mode === 'cinematic' ? 11.2 : 8.6;
      const chaseHeight = this.mode === 'cinematic' ? 4.4 : 3.2;
      const footHeight = 1.98 + this.pitch * 2.4;

      if (trans.mode === 'entering') {
        const toDoor = smoothstep01(0.0, 0.34, transP);
        const toChase = smoothstep01(0.56, 0.98, transP);
        const desiredYaw = normalizeAngle(
          side34Yaw + normalizeAngle(behindYaw - side34Yaw) * toChase,
        );
        const diff = normalizeAngle(desiredYaw - this.yaw);
        this.yaw = normalizeAngle(this.yaw + diff * (1 - Math.exp(-5.4 * dt)));
        this.pitch = dampValue(this.pitch, 0.22, 5.2, dt);

        if (this.mode === 'hood' && toChase > 0.01) {
          const fx = Math.sin(transitionCar.heading);
          const fz = Math.cos(transitionCar.heading);
          const orbitDist = 4.25 + (4.95 - 4.25) * toDoor;
          const orbitH = footHeight + (2.1 - footHeight) * toDoor;
          const orbitX = transitionCar.x + Math.sin(this.yaw) * orbitDist;
          const orbitZ = transitionCar.z + Math.cos(this.yaw) * orbitDist;
          const hoodX = transitionCar.x + fx * 0.65;
          const hoodZ = transitionCar.z + fz * 0.65;
          _camTargetPos.set(
            orbitX + (hoodX - orbitX) * toChase,
            orbitH + (1.46 - orbitH) * toChase,
            orbitZ + (hoodZ - orbitZ) * toChase,
          );
          const focusStartX = player.x + (transitionCar.x + fx * 1.2 - player.x) * toDoor;
          const focusStartZ = player.z + (transitionCar.z + fz * 1.2 - player.z) * toDoor;
          _camLookAt.set(
            focusStartX + (transitionCar.x + fx * 28 - focusStartX) * toChase,
            1.48 + (1.3 - 1.48) * toChase,
            focusStartZ + (transitionCar.z + fz * 28 - focusStartZ) * toChase,
          );
          this.setFovIfChanged(56 + 12 * toChase, 5.5, dt);
        } else {
          const midDist = 4.25 + (5.05 - 4.25) * toDoor;
          const dist = midDist + (chaseDist - midDist) * toChase;
          const midHeight = footHeight + (2.15 - footHeight) * toDoor;
          const targetChaseH = chaseHeight + this.pitch * 3.5;
          const height = midHeight + (targetChaseH - midHeight) * toChase;
          const focusX = player.x + (transitionCar.x - player.x) * toDoor;
          const focusZ = player.z + (transitionCar.z - player.z) * toDoor;
          _camTargetPos.set(
            focusX + Math.sin(this.yaw) * dist,
            height,
            focusZ + Math.cos(this.yaw) * dist,
          );
          const lookLead = 1.2 * toDoor + 2.3 * toChase;
          _camLookAt.set(
            focusX + Math.sin(transitionCar.heading) * lookLead,
            1.48 + (1.18 - 1.48) * toDoor + (1.35 - 1.18) * toChase,
            focusZ + Math.cos(transitionCar.heading) * lookLead,
          );
          this.applyAntiClipAndCeilingClamp(_camLookAt, _camTargetPos, spatialGrid);
          this.setFovIfChanged(56 + 4 * toChase, 5.5, dt);
        }
        this.camera.position.lerp(_camTargetPos, 1 - Math.exp(-7.8 * dt));
      } else {
        const toFoot = smoothstep01(0.14, 0.96, transP);
        const sideSwing = Math.sin(toFoot * Math.PI) * 0.62;
        const desiredYaw = normalizeAngle(
          behindYaw + normalizeAngle(side34Yaw - behindYaw) * sideSwing,
        );
        const diff = normalizeAngle(desiredYaw - this.yaw);
        this.yaw = normalizeAngle(this.yaw + diff * (1 - Math.exp(-5.4 * dt)));
        this.pitch = dampValue(this.pitch, 0.22, 5.2, dt);

        const isCloseShoulder = this.mode === 'hood';
        const endDist = this.mode === 'cinematic' ? 6.8 : isCloseShoulder ? 2.15 : 4.25;
        const endHeight = isCloseShoulder ? 1.56 + this.pitch * 1.15 : 1.98 + this.pitch * 2.4;
        const startHeight = chaseHeight + this.pitch * 3.5;

        const dist = chaseDist + (endDist - chaseDist) * toFoot;
        const height = startHeight + (endHeight - startHeight) * toFoot;
        const focusX = transitionCar.x + (player.x - transitionCar.x) * toFoot;
        const focusZ = transitionCar.z + (player.z - transitionCar.z) * toFoot;
        const lookLead = 3.5 * (1 - toFoot);

        _camTargetPos.set(
          focusX + Math.sin(this.yaw) * dist,
          height,
          focusZ + Math.cos(this.yaw) * dist,
        );
        _camLookAt.set(
          focusX + Math.sin(transitionCar.heading) * lookLead,
          1.35 + ((isCloseShoulder ? 1.52 : 1.48) - 1.35) * toFoot,
          focusZ + Math.cos(transitionCar.heading) * lookLead,
        );
        this.applyAntiClipAndCeilingClamp(_camLookAt, _camTargetPos, spatialGrid);
        this.camera.position.lerp(_camTargetPos, 1 - Math.exp(-7.8 * dt));
        this.setFovIfChanged(60 + ((isCloseShoulder ? 48 : 56) - 60) * toFoot, 5.5, dt);
      }
    } else if (activeCar) {
      const carPose = poseHistory
        ? interpolateVehiclePose(
            poseHistory.getPrevVehicle(activeCar.id),
            activeCar,
            simAlpha,
            _interpCamCar,
          )
        : activeCar;

      const speedMag = Math.hypot(activeCar.vx, activeCar.vz);
      const speedRatio = Math.min(1, Math.abs(activeCar.speed) / 48);

      if (!this.orbitActive && (Math.abs(activeCar.speed) > 1.2 || this.returnPending)) {
        const headingBehindYaw = normalizeAngle(carPose.heading + Math.PI);
        let desiredYaw = headingBehindYaw;
        if (activeCar.speed > 3.2 && speedMag > 3.2) {
          // Track velocity vector smoothly during drifts/oversteer so the player always sees the apex
          const velBehindYaw = normalizeAngle(Math.atan2(activeCar.vx, activeCar.vz) + Math.PI);
          const slipDiff = normalizeAngle(velBehindYaw - headingBehindYaw);
          const velBlend = clampVal((speedMag - 3.2) / 14.0, 0, 0.56);
          desiredYaw = normalizeAngle(headingBehindYaw + slipDiff * velBlend);
        }
        const diff = normalizeAngle(desiredYaw - this.yaw);
        const yawLambda = this.returnPending
          ? 5.8
          : activeCar.speed < -1.0
            ? 2.2
            : 4.4 + speedRatio * 2.2;
        this.yaw = normalizeAngle(this.yaw + diff * (1 - Math.exp(-yawLambda * dt)));
        this.pitch = dampValue(this.pitch, 0.21 + speedRatio * 0.03, 4.8, dt);
        if (
          this.returnPending &&
          Math.abs(diff) < 0.015 &&
          Math.abs(this.pitch - 0.22) < 0.015
        ) {
          this.yaw = desiredYaw;
          this.pitch = 0.22;
          this.returnPending = false;
        }
      }

      if (this.mode === 'hood') {
        const fx = Math.sin(carPose.heading);
        const fz = Math.cos(carPose.heading);
        const camY = carPose.y + 1.44 - carPose.pitch * 0.45;
        const lookY = camY - 0.16 - Math.sin(carPose.pitch) * 14.0;
        _camTargetPos.set(carPose.x + fx * 0.65, camY, carPose.z + fz * 0.65);
        _camLookAt.set(carPose.x + fx * 28, lookY, carPose.z + fz * 28);
        this.camera.position.lerp(_camTargetPos, 1 - Math.exp(-24 * dt));
      } else {
        const baseDist = this.mode === 'cinematic' ? 11.2 : 8.4;
        const dist = baseDist + speedRatio * 1.1 + (activeCar.nitroActive ? 0.55 : 0);
        const height = (this.mode === 'cinematic' ? 4.35 : 3.05) + carPose.y;
        const camX = carPose.x + Math.sin(this.yaw) * dist;
        const camZ = carPose.z + Math.cos(this.yaw) * dist;
        _camTargetPos.set(camX, height + this.pitch * 3.4, camZ);
        const lookLead = activeCar.speed < -1.5 ? 1.2 : 3.6 + speedRatio * 1.8;
        _camLookAt.set(
          carPose.x + Math.sin(carPose.heading) * lookLead,
          carPose.y + 1.32,
          carPose.z + Math.cos(carPose.heading) * lookLead,
        );
        this.applyAntiClipAndCeilingClamp(_camLookAt, _camTargetPos, spatialGrid);
        const followLambda = this.orbitActive ? 18 : 10.5 + speedRatio * 3.5;
        this.camera.position.lerp(_camTargetPos, 1 - Math.exp(-followLambda * dt));
      }

      const targetFov =
        (this.mode === 'hood' ? 68 : 59) +
        speedRatio * 13 +
        (activeCar.nitroActive ? 7.5 : 0);
      this.setFovIfChanged(targetFov, 5.5, dt);
    } else {
      const pPose = poseHistory
        ? interpolatePlayerPose(poseHistory.getPrevPlayer(), player, simAlpha, _interpCamPlayer)
        : player;

      if (!this.orbitActive && this.returnPending) {
        const desiredYaw = normalizeAngle(pPose.heading + Math.PI);
        const diff = normalizeAngle(desiredYaw - this.yaw);
        this.yaw = normalizeAngle(this.yaw + diff * (1 - Math.exp(-5.8 * dt)));
        this.pitch = dampValue(this.pitch, 0.22, 5.2, dt);
        if (Math.abs(diff) < 0.015 && Math.abs(this.pitch - 0.22) < 0.015) {
          this.yaw = desiredYaw;
          this.pitch = 0.22;
          this.returnPending = false;
        }
      }

      const insideShop = getShopRoofCeilingClampY(pPose.x, pPose.z) !== null;
      const isCloseShoulder = this.mode === 'hood';
      const baseDist = this.mode === 'cinematic' ? 6.8 : isCloseShoulder ? 2.15 : 4.25;
      const dist = insideShop ? Math.min(baseDist, 2.55) : baseDist;
      const height = isCloseShoulder
        ? 1.56 + this.pitch * 1.15
        : insideShop
          ? 1.68 + this.pitch * 0.85
          : 1.98 + this.pitch * 2.4;
      const shoulderOffset = isCloseShoulder ? 0.36 : 0;
      const rightX = Math.cos(this.yaw) * shoulderOffset;
      const rightZ = -Math.sin(this.yaw) * shoulderOffset;
      _camTargetPos.set(
        pPose.x + Math.sin(this.yaw) * dist + rightX,
        pPose.y + height,
        pPose.z + Math.cos(this.yaw) * dist + rightZ,
      );
      _camLookAt.set(
        pPose.x + rightX * 0.65,
        pPose.y + (isCloseShoulder ? 1.52 : 1.48),
        pPose.z + rightZ * 0.65,
      );

      this.applyAntiClipAndCeilingClamp(_camLookAt, _camTargetPos, spatialGrid);

      const followLambda = this.orbitActive ? 18 : 10.5;
      this.camera.position.lerp(_camTargetPos, 1 - Math.exp(-followLambda * dt));
      this.setFovIfChanged(isCloseShoulder ? 48 : 56, 6, dt);
    }

    this.currentLook.lerp(_camLookAt, 1 - Math.exp(-12 * dt));
    this.camera.lookAt(this.currentLook);

    if (this.trauma > 0) {
      const shake = this.trauma * this.trauma;
      this.camera.rotation.z += Math.sin(nowSec * 52) * shake * 0.05;
      this.camera.rotation.x += Math.cos(nowSec * 43) * shake * 0.035;
      this.trauma = Math.max(0, this.trauma - dt * 1.9);
    }
  }
}
