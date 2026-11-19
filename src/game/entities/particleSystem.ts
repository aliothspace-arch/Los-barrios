import * as THREE from 'three';

export type ParticleKind = 'smoke' | 'spark' | 'spray';

interface ParticleSlot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  kind: ParticleKind;
}

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

/**
 * Pooled GPU-instanced particle system (tire drift smoke, collision sparks,
 * wet-road water spray) with zero per-frame allocations and deterministic disposal.
 */
export class ParticleSystem {
  public readonly mesh: THREE.InstancedMesh;
  private readonly particles: ParticleSlot[] = [];
  private cursor = 0;

  constructor(scene: THREE.Scene, count = 240) {
    const geo = new THREE.DodecahedronGeometry(0.22, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;

    _dummy.scale.set(0, 0, 0);
    _dummy.updateMatrix();
    for (let i = 0; i < count; i++) {
      this.mesh.setMatrixAt(i, _dummy.matrix);
      this.mesh.setColorAt(i, _color.setHex(0xffffff));
      this.particles.push({
        active: false,
        x: 0,
        y: -50,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 0,
        life: 1,
        size: 1,
        kind: 'smoke',
      });
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);
  }

  public spawnBurst(
    x: number,
    y: number,
    z: number,
    count: number,
    kind: ParticleKind,
  ): void {
    for (let i = 0; i < count; i++) {
      const slot = this.particles[this.cursor];
      this.cursor = (this.cursor + 1) % this.particles.length;
      slot.active = true;
      slot.x = x + (Math.random() - 0.5) * 0.6;
      slot.y = y + Math.random() * 0.4;
      slot.z = z + (Math.random() - 0.5) * 0.6;
      slot.age = 0;
      slot.kind = kind;

      if (kind === 'spark') {
        const a = Math.random() * Math.PI * 2;
        const spd = 4 + Math.random() * 9;
        slot.vx = Math.cos(a) * spd;
        slot.vy = 2.5 + Math.random() * 5.5;
        slot.vz = Math.sin(a) * spd;
        slot.life = 0.28 + Math.random() * 0.25;
        slot.size = 0.42 + Math.random() * 0.45;
      } else if (kind === 'spray') {
        slot.vx = (Math.random() - 0.5) * 2.4;
        slot.vy = 1.2 + Math.random() * 2.2;
        slot.vz = (Math.random() - 0.5) * 2.4;
        slot.life = 0.4 + Math.random() * 0.35;
        slot.size = 0.9 + Math.random() * 0.9;
      } else {
        slot.vx = (Math.random() - 0.5) * 1.8;
        slot.vy = 0.8 + Math.random() * 1.4;
        slot.vz = (Math.random() - 0.5) * 1.8;
        slot.life = 0.55 + Math.random() * 0.45;
        slot.size = 1.2 + Math.random() * 1.2;
      }
    }
  }

  public update(dt: number): void {
    let dirty = false;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      dirty = true;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        _dummy.position.set(0, -100, 0);
        _dummy.scale.set(0, 0, 0);
        _dummy.updateMatrix();
        this.mesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }

      const t = p.age / p.life;
      if (p.kind === 'spark') {
        p.vy -= 18 * dt;
      } else {
        p.vx *= Math.exp(-2.5 * dt);
        p.vz *= Math.exp(-2.5 * dt);
      }
      p.x += p.vx * dt;
      p.y = Math.max(0.08, p.y + p.vy * dt);
      p.z += p.vz * dt;

      const s =
        p.kind === 'spark'
          ? p.size * (1 - t)
          : p.size * (0.4 + t * 1.4) * (1 - t * 0.7);
      _dummy.position.set(p.x, p.y, p.z);
      _dummy.rotation.set(p.age * 4, p.age * 3, 0);
      _dummy.scale.set(s, s, s);
      _dummy.updateMatrix();
      this.mesh.setMatrixAt(i, _dummy.matrix);

      if (p.kind === 'spark') {
        _color.setHex(t < 0.4 ? 0xfff0a0 : 0xff7b24);
      } else if (p.kind === 'spray') {
        _color.setHex(0x9fb8c9);
      } else {
        _color.setHex(0xd2cfc8);
      }
      this.mesh.setColorAt(i, _color);
    }

    if (dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) {
        this.mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  public dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
