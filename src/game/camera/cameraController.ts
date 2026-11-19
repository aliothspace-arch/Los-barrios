import * as THREE from 'three';
import type { CameraMode, GamePhase, PlayerState, VehicleState } from '../types';
import { dampValue, normalizeAngle } from '../physics';
import type { RobberySession } from '../robberySystem';
import type { RobberyInteriorStage } from '../robberyScene';

const CAMERA_ORDER: CameraMode[] = ['chase', 'cinematic', 'hood'];

const _camTargetPos = new THREE.Vector3();
const _camLookAt = new THREE.Vector3();

/**
 * Decoupled 3D camera rig managing title flyover, chase/cinematic/hood driving
 * and on-foot framing, free pointer orbit with smooth auto-return, trauma²
 * shake, and dirty-checked projection matrix updates.
 */
export class CameraController {
  public readonly camera: THREE.PerspectiveCamera;
  private mode: CameraMode = 'chase';
  private yaw = 0;
  private pitch = 0.22;
  private orbitActive = false;
  private returnPending = false;
  private trauma = 0;
  private titleTime = 0;
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
    this.camera.position.set(
      x + Math.sin(this.yaw) * dist,
      y + 3.2,
      z + Math.cos(this.yaw) * dist,
    );
    this.currentLook.set(x, y + 1.5, z - 14);
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

  public update(params: {
    dt: number;
    nowSec: number;
    phase: GamePhase;
    player: PlayerState;
    activeCar: VehicleState | null;
    robberySession: RobberySession | null;
    robberyStage: RobberyInteriorStage;
  }): void {
    const { dt, nowSec, phase, player, activeCar, robberySession, robberyStage } = params;

    if (robberySession) {
      robberyStage.updateCamera(this.camera, robberySession, dt, nowSec, this.trauma);
      if (this.trauma > 0) {
        this.trauma = Math.max(0, this.trauma - dt * 1.9);
      }
      return;
    }

    if (phase === 'title') {
      this.titleTime += dt;
      const orbitA = Math.sin(this.titleTime * 0.16) * 0.42;
      const camX = Math.sin(orbitA) * 26 + 4;
      const camY = 9.5 + Math.sin(this.titleTime * 0.25) * 2.2;
      const camZ = 24 + Math.cos(orbitA) * 8;
      this.camera.position.set(camX, camY, camZ);
      this.camera.lookAt(0, 8.5, -62);
      return;
    }

    if (activeCar) {
      if (!this.orbitActive && (Math.abs(activeCar.speed) > 1.4 || this.returnPending)) {
        const desiredYaw = normalizeAngle(activeCar.heading + Math.PI);
        const diff = normalizeAngle(desiredYaw - this.yaw);
        const yawLambda = this.returnPending ? 5.6 : 3.4;
        this.yaw = normalizeAngle(this.yaw + diff * (1 - Math.exp(-yawLambda * dt)));
        this.pitch = dampValue(this.pitch, 0.22, 4.8, dt);
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
        const fx = Math.sin(activeCar.heading);
        const fz = Math.cos(activeCar.heading);
        _camTargetPos.set(activeCar.x + fx * 0.65, 1.46, activeCar.z + fz * 0.65);
        _camLookAt.set(activeCar.x + fx * 28, 1.3, activeCar.z + fz * 28);
        this.camera.position.lerp(_camTargetPos, 1 - Math.exp(-20 * dt));
      } else {
        const dist = this.mode === 'cinematic' ? 11.2 : 8.6;
        const height = this.mode === 'cinematic' ? 4.4 : 3.2;
        const camX = activeCar.x + Math.sin(this.yaw) * dist;
        const camZ = activeCar.z + Math.cos(this.yaw) * dist;
        _camTargetPos.set(camX, height + this.pitch * 3.5, camZ);
        _camLookAt.set(
          activeCar.x + Math.sin(activeCar.heading) * 3.5,
          1.35,
          activeCar.z + Math.cos(activeCar.heading) * 3.5,
        );
        const followLambda = this.orbitActive ? 16 : 8.2;
        this.camera.position.lerp(_camTargetPos, 1 - Math.exp(-followLambda * dt));
      }

      const speedRatio = Math.min(1, Math.abs(activeCar.speed) / 45);
      const targetFov =
        (this.mode === 'hood' ? 68 : 60) +
        speedRatio * 12 +
        (activeCar.nitroActive ? 7 : 0);
      this.setFovIfChanged(targetFov, 5.5, dt);
    } else {
      if (!this.orbitActive && this.returnPending) {
        const desiredYaw = normalizeAngle(player.heading + Math.PI);
        const diff = normalizeAngle(desiredYaw - this.yaw);
        this.yaw = normalizeAngle(this.yaw + diff * (1 - Math.exp(-5.8 * dt)));
        this.pitch = dampValue(this.pitch, 0.22, 5.2, dt);
        if (Math.abs(diff) < 0.015 && Math.abs(this.pitch - 0.22) < 0.015) {
          this.yaw = desiredYaw;
          this.pitch = 0.22;
          this.returnPending = false;
        }
      }

      const isCloseShoulder = this.mode === 'hood';
      const dist = this.mode === 'cinematic' ? 6.8 : isCloseShoulder ? 2.15 : 4.25;
      const height = isCloseShoulder
        ? 1.56 + this.pitch * 1.15
        : 1.98 + this.pitch * 2.4;
      const shoulderOffset = isCloseShoulder ? 0.36 : 0;
      const rightX = Math.cos(this.yaw) * shoulderOffset;
      const rightZ = -Math.sin(this.yaw) * shoulderOffset;
      _camTargetPos.set(
        player.x + Math.sin(this.yaw) * dist + rightX,
        player.y + height,
        player.z + Math.cos(this.yaw) * dist + rightZ,
      );
      _camLookAt.set(
        player.x + rightX * 0.65,
        player.y + (isCloseShoulder ? 1.52 : 1.48),
        player.z + rightZ * 0.65,
      );
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
