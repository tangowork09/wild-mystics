import * as THREE from 'three';
import { manifestTexture } from '../assets/manifest';
import { tweens, ease } from '../core/tween';

// Lightweight particle/sprite effects. Sprites use Kenney CC0 particle textures when present,
// otherwise a generated soft dot. Everything is additive so bloom turns it into light.

interface P {
  obj: THREE.Object3D;
  mat: THREE.SpriteMaterial | THREE.MeshBasicMaterial;
  vel: THREE.Vector3;
  life: number;
  age: number;
  s0: number;
  s1: number;
  rot: number;
  gravity: number;
  fadeIn: number;
  ground?: boolean;
  a0: number;
}

let dot: THREE.Texture | null = null;
function softDot() {
  if (dot) return dot;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  dot = new THREE.CanvasTexture(c);
  return dot;
}
const tex = (k: string) => manifestTexture('vfx', k) ?? softDot();

export class VFX {
  group = new THREE.Group();
  private ps: P[] = [];

  sprite(key: string, pos: THREE.Vector3, o: { color?: THREE.ColorRepresentation; size?: number; size1?: number; life?: number; vel?: THREE.Vector3; rot?: number; gravity?: number; opacity?: number; fadeIn?: number } = {}) {
    const mat = new THREE.SpriteMaterial({ map: tex(key), color: new THREE.Color(o.color ?? '#ffffff'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, rotation: Math.random() * Math.PI * 2 });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    const size = o.size ?? 1;
    s.scale.setScalar(size);
    s.renderOrder = 10;
    this.group.add(s);
    this.ps.push({ obj: s, mat, vel: o.vel ?? new THREE.Vector3(), life: o.life ?? 0.5, age: 0, s0: size, s1: o.size1 ?? size, rot: o.rot ?? 0, gravity: o.gravity ?? 0, fadeIn: o.fadeIn ?? 0.05, a0: o.opacity ?? 1 });
    return s;
  }

  groundDecal(key: string, pos: THREE.Vector3, o: { color?: THREE.ColorRepresentation; size?: number; size1?: number; life?: number; rot?: number; opacity?: number } = {}) {
    const mat = new THREE.MeshBasicMaterial({ map: tex(key), color: new THREE.Color(o.color ?? '#ffffff'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
    m.position.copy(pos).add(new THREE.Vector3(0, 0.08, 0));
    const size = o.size ?? 2;
    m.scale.setScalar(size);
    m.renderOrder = 9;
    this.group.add(m);
    this.ps.push({ obj: m, mat, vel: new THREE.Vector3(), life: o.life ?? 0.8, age: 0, s0: size, s1: o.size1 ?? size, rot: o.rot ?? 0, gravity: 0, fadeIn: 0.08, ground: true, a0: o.opacity ?? 1 });
    return m;
  }

  update(dt: number) {
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        this.group.remove(p.obj);
        p.mat.dispose();
        if ((p.obj as THREE.Mesh).geometry && p.ground) (p.obj as THREE.Mesh).geometry.dispose();
        this.ps.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.obj.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - dt * 1.5);
      const s = p.s0 + (p.s1 - p.s0) * ease.out(t);
      p.obj.scale.setScalar(s);
      if (p.ground) p.obj.rotation.y += p.rot * dt;
      else (p.mat as THREE.SpriteMaterial).rotation += p.rot * dt;
      const fadeIn = Math.min(1, p.age / p.fadeIn);
      p.mat.opacity = p.a0 * fadeIn * (1 - Math.pow(t, 1.6));
    }
  }

  clear() {
    for (const p of this.ps) { this.group.remove(p.obj); p.mat.dispose(); }
    this.ps = [];
  }

  // ── Composite effects ────────────────────────────────────────────────
  sparks(pos: THREE.Vector3, color: THREE.ColorRepresentation, n = 14, speed = 7) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.1, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      this.sprite(i % 3 ? 'spark_05' : 'star_06', pos, { color, size: 0.35 + Math.random() * 0.35, size1: 0.05, life: 0.35 + Math.random() * 0.35, vel: v, gravity: 9 });
    }
  }

  hit(pos: THREE.Vector3, color: THREE.ColorRepresentation, big = false) {
    this.sprite('flare_01', pos, { color, size: big ? 2.8 : 1.8, size1: big ? 4.5 : 2.6, life: 0.22 });
    this.sprite('star_07', pos, { color: '#ffffff', size: big ? 2.2 : 1.3, size1: 0.2, life: 0.25, rot: 4 });
    this.sparks(pos, color, big ? 22 : 12, big ? 10 : 7);
  }

  slash(pos: THREE.Vector3, color: THREE.ColorRepresentation, variant = 0) {
    const keys = ['slash_01', 'slash_02', 'slash_03', 'slash_04'];
    this.sprite(keys[variant % 4], pos, { color, size: 2.2, size1: 3.4, life: 0.28, rot: variant % 2 ? 3 : -3 });
    this.sprite(keys[(variant + 2) % 4], pos, { color: '#ffffff', size: 1.6, size1: 2.6, life: 0.2, opacity: 0.7 });
    this.hit(pos, color);
  }

  burst(pos: THREE.Vector3, color: THREE.ColorRepresentation) {
    this.sprite('circle_05', pos, { color, size: 0.5, size1: 6, life: 0.45 });
    this.sprite('magic_03', pos, { color, size: 1, size1: 4.5, life: 0.55, rot: 2 });
    this.groundDecal('circle_02', pos, { color, size: 1, size1: 8, life: 0.6 });
    this.sparks(pos, color, 24, 11);
  }

  quake(pos: THREE.Vector3, color: THREE.ColorRepresentation) {
    this.groundDecal('circle_02', pos, { color, size: 1, size1: 9, life: 0.55 });
    this.groundDecal('scorch_01', pos, { color: '#ffffff', size: 3, size1: 4, life: 1.2, opacity: 0.5 });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.sprite('dirt_02', pos.clone().add(new THREE.Vector3(Math.cos(a) * 0.8, 0.2, Math.sin(a) * 0.8)), { color, size: 0.7, size1: 0.2, life: 0.7, vel: new THREE.Vector3(Math.cos(a) * 3, 6 + Math.random() * 3, Math.sin(a) * 3), gravity: 18 });
    }
    this.hit(pos.clone().add(new THREE.Vector3(0, 0.8, 0)), color);
  }

  heal(pos: THREE.Vector3, color: THREE.ColorRepresentation = '#7dffb0') {
    this.groundDecal('circle_05', pos, { color, size: 1, size1: 3.5, life: 0.8 });
    for (let i = 0; i < 18; i++) {
      const p = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.6, Math.random() * 0.5, (Math.random() - 0.5) * 1.6));
      this.sprite(i % 2 ? 'star_04' : 'light_01', p, { color, size: 0.4, size1: 0.1, life: 0.9 + Math.random() * 0.5, vel: new THREE.Vector3(0, 2 + Math.random() * 2, 0), fadeIn: 0.2 });
    }
  }

  aura(pos: THREE.Vector3, color: THREE.ColorRepresentation) {
    this.groundDecal('twirl_02', pos, { color, size: 2, size1: 4.5, life: 0.9, rot: 5 });
    this.groundDecal('symbol_01', pos, { color, size: 3.2, size1: 3.6, life: 1.0, rot: -2, opacity: 0.8 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this.sprite('light_03', pos.clone().add(new THREE.Vector3(Math.cos(a) * 1.2, 0.2, Math.sin(a) * 1.2)), { color, size: 0.5, size1: 0.15, life: 0.9, vel: new THREE.Vector3(0, 3.5, 0), fadeIn: 0.15 });
    }
  }

  parry(pos: THREE.Vector3) {
    this.sprite('star_07', pos, { color: '#fff6c8', size: 1, size1: 5.5, life: 0.35, rot: 3 });
    this.sprite('flare_01', pos, { color: '#ffd76a', size: 3, size1: 6, life: 0.25 });
    this.sprite('circle_05', pos, { color: '#ffffff', size: 0.4, size1: 4, life: 0.3 });
    this.sparks(pos, '#ffe28a', 26, 12);
  }

  dodge(pos: THREE.Vector3) {
    this.sprite('smoke_04', pos, { color: '#cfe6ff', size: 1.2, size1: 2.6, life: 0.45, opacity: 0.5 });
    this.sprite('trace_04', pos, { color: '#bfe0ff', size: 1.6, size1: 2.6, life: 0.25, opacity: 0.8 });
  }

  breakShatter(pos: THREE.Vector3, color: THREE.ColorRepresentation) {
    this.sprite('flare_01', pos, { color: '#ffffff', size: 4, size1: 9, life: 0.35 });
    for (let i = 0; i < 20; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize().multiplyScalar(9 + Math.random() * 6);
      this.sprite('trace_01', pos, { color, size: 0.9, size1: 0.2, life: 0.55, vel: v, gravity: 6 });
    }
    this.sprite('circle_05', pos, { color, size: 1, size1: 8, life: 0.5 });
  }

  /** Glowing projectile along an arc; resolves on impact. */
  async projectile(from: THREE.Vector3, to: THREE.Vector3, color: THREE.ColorRepresentation, dur = 0.38, arc = 1.5) {
    const core = this.sprite('light_01', from, { color, size: 1.1, life: dur + 0.05 });
    const glow = this.sprite('flare_01', from, { color, size: 1.6, life: dur + 0.05, opacity: 0.8 });
    const p = new THREE.Vector3();
    let lastTrail = 0;
    await tweens.tween(dur, (t) => {
      p.lerpVectors(from, to, t);
      p.y += Math.sin(t * Math.PI) * arc;
      core.position.copy(p);
      glow.position.copy(p);
      if (t - lastTrail > 0.06) { lastTrail = t; this.sprite('magic_01', p, { color, size: 0.7, size1: 0.1, life: 0.3, opacity: 0.7 }); }
    }, ease.in);
  }

  /** Beam from→to (stretched additive cylinder) that flashes and fades. */
  beam(from: THREE.Vector3, to: THREE.Vector3, color: THREE.ColorRepresentation, width = 0.5, life = 0.45) {
    const len = from.distanceTo(to);
    const mat = new THREE.MeshBasicMaterial({ map: tex('trace_04'), color: new THREE.Color(color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const geo = new THREE.CylinderGeometry(width, width * 0.6, len, 12, 1, true).rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.lerpVectors(from, to, 0.5);
    m.lookAt(to);
    this.group.add(m);
    this.ps.push({ obj: m, mat, vel: new THREE.Vector3(), life, age: 0, s0: 1, s1: 1, rot: 0, gravity: 0, fadeIn: 0.03, ground: true, a0: 1 });
    this.sprite('flare_01', from, { color, size: 2, size1: 3, life: 0.3 });
  }
}
