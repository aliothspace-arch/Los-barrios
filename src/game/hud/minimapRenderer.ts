import type { CheckpointObjective, GamePhase, PlayerState, VehicleState } from '../types';
import { BUILDINGS, CUL_DE_SAC, ROAD_SEGMENTS, SHOPS } from '../worldLayout';
import { shouldRedrawMinimap } from '../simulation/renderInterpolation';

/**
 * Decoupled 2D Canvas radar minimap renderer with a pre-baked static city map
 * layer so every frame only performs a single drawImage blit + dynamic blips.
 */
export class MinimapRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private staticLayer: HTMLCanvasElement | null = null;
  private lastDrawMs = -Infinity;
  private lastPx = NaN;
  private lastPz = NaN;
  private lastYaw = NaN;
  private lastHeading = NaN;
  private lastBlink = false;

  public setCanvas(canvas: HTMLCanvasElement | null): void {
    if (this.canvas !== canvas) {
      this.canvas = canvas;
      this.lastDrawMs = -Infinity;
    }
  }

  private getStaticLayer(scale: number): HTMLCanvasElement {
    if (this.staticLayer) return this.staticLayer;
    const mapRadiusMeters = 280;
    const size = Math.ceil(mapRadiusMeters * 2 * scale);
    const half = size * 0.5;
    const off = document.createElement('canvas');
    off.width = size;
    off.height = size;
    const octx = off.getContext('2d')!;

    octx.fillStyle = '#4e5256';
    for (let i = 0; i < ROAD_SEGMENTS.length; i++) {
      const r = ROAD_SEGMENTS[i];
      octx.fillRect(
        half + (r.x - r.w * 0.5) * scale,
        half + (r.z - r.d * 0.5) * scale,
        r.w * scale,
        r.d * scale,
      );
    }

    octx.beginPath();
    octx.arc(
      half + CUL_DE_SAC.x * scale,
      half + CUL_DE_SAC.z * scale,
      CUL_DE_SAC.radius * scale,
      0,
      Math.PI * 2,
    );
    octx.fill();

    octx.fillStyle = '#2d332e';
    for (let i = 0; i < BUILDINGS.length; i++) {
      const b = BUILDINGS[i];
      octx.fillRect(
        half + (b.x - b.w * 0.5) * scale,
        half + (b.z - b.d * 0.5) * scale,
        b.w * scale,
        b.d * scale,
      );
    }

    this.staticLayer = off;
    return off;
  }

  public draw(params: {
    phase: GamePhase;
    player: PlayerState;
    cameraYaw: number;
    vehicles: readonly VehicleState[];
    activeCheckpoint: CheckpointObjective | null;
    nowMs: number;
  }): void {
    const canvas = this.canvas;
    if (!canvas) return;

    const { player, cameraYaw, vehicles, activeCheckpoint, nowMs } = params;
    const blink = Math.floor(nowMs / 180) % 2 === 0;
    const movedSq =
      (player.x - this.lastPx) * (player.x - this.lastPx) +
      (player.z - this.lastPz) * (player.z - this.lastPz);
    const yawDiff = Math.abs(cameraYaw - this.lastYaw);
    const headDiff = Math.abs(player.heading - this.lastHeading);

    if (
      !shouldRedrawMinimap({
        nowMs,
        lastDrawMs: this.lastDrawMs,
        inVehicle: player.inVehicleId !== null,
        movedSq,
        yawDiff,
        headDiff,
        blinkChanged: blink !== this.lastBlink,
      })
    ) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    this.lastDrawMs = nowMs;
    this.lastPx = player.x;
    this.lastPz = player.z;
    this.lastYaw = cameraYaw;
    this.lastHeading = player.heading;
    this.lastBlink = blink;

    const w = canvas.width;
    const h = canvas.height;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const scale = 1.08;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, cx - 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = '#1b201c';
    ctx.fillRect(0, 0, w, h);

    ctx.translate(cx, cy);
    ctx.rotate(cameraYaw);

    const px = player.x;
    const pz = player.z;

    const staticMap = this.getStaticLayer(scale);
    const halfStatic = staticMap.width * 0.5;
    ctx.drawImage(staticMap, -halfStatic - px * scale, -halfStatic - pz * scale);

    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (v.id === player.inVehicleId) continue;
      const vx = (v.x - px) * scale;
      const vz = (v.z - pz) * scale;
      if (v.driver === 'police') {
        ctx.fillStyle = v.sirenOn ? (blink ? '#ff3b30' : '#3296ff') : '#5ea6ff';
        ctx.beginPath();
        ctx.arc(vx, vz, 3.6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = v.driver === 'none' ? '#82d98a' : '#b8b6ad';
        ctx.fillRect(vx - 2.2, vz - 2.2, 4.4, 4.4);
      }
    }

    for (let i = 0; i < SHOPS.length; i++) {
      const s = SHOPS[i];
      const sx = (s.x - px) * scale;
      const sz = (s.z - pz) * scale;
      ctx.fillStyle = '#38d16a';
      ctx.strokeStyle = '#0c120d';
      ctx.lineWidth = 1.4;
      ctx.fillRect(sx - 4, sz - 4, 8, 8);
      ctx.strokeRect(sx - 4, sz - 4, 8, 8);
    }

    if (activeCheckpoint) {
      let bx = (activeCheckpoint.x - px) * scale;
      let bz = (activeCheckpoint.z - pz) * scale;
      const maxR = cx - 9;
      const d = Math.hypot(bx, bz);
      if (d > maxR) {
        bx = (bx / d) * maxR;
        bz = (bz / d) * maxR;
      }
      ctx.fillStyle = '#ffbe30';
      ctx.strokeStyle = '#120f0b';
      ctx.lineWidth = 2;
      ctx.fillRect(bx - 4.5, bz - 4.5, 9, 9);
      ctx.strokeRect(bx - 4.5, bz - 4.5, 9, 9);
    }

    ctx.restore();

    // Player heading arrow
    ctx.save();
    ctx.translate(cx, cy);
    const relHeading = Math.PI - player.heading + cameraYaw;
    ctx.rotate(relHeading);
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.fillStyle = '#f5f2eb';
    ctx.strokeStyle = '#090909';
    ctx.lineWidth = 1.6;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // North 'N' compass badge
    const nx = cx + Math.sin(cameraYaw) * (cx - 10);
    const ny = cy - Math.cos(cameraYaw) * (cy - 10);
    ctx.fillStyle = '#0d0c0a';
    ctx.beginPath();
    ctx.arc(nx, ny, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f2ede2';
    ctx.font = 'bold 10px Oswald, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny + 0.5);
  }

  public dispose(): void {
    this.canvas = null;
    this.staticLayer = null;
  }
}
