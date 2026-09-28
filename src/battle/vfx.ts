import * as THREE from 'three';
import { manifestTexture } from '../assets/manifest';
import { tweens, ease } from '../core/tween';

// Lightweight particle/sprite effects. Sprites use Kenney CC0 particle textures when present,
// otherwise a generated soft dot. Everything is additive so bloom turns it into light.

interface P {
  obj: THREE.Object3D;
  mat: THREE.Material & { opacity: number };
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
  /** Tumbling mesh debris (rocks). */
  tumble?: THREE.Vector3;
  /** Keep scale fixed (debris shrinks only at the end). */
  keepScale?: boolean;
  /** Owned geometry to free on expiry. */
  ownGeo?: boolean;
  /** Collide with the ground plane at this height. */
  floor?: number;
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
const tex = (k: string) => (k === 'leaf' ? leafTex() : k === 'shard' ? shardTex() : manifestTexture('vfx', k) ?? softDot());

let leaf: THREE.Texture | null = null;
function leafTex() {
  if (leaf) return leaf;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.translate(32, 32);
  g.rotate(0.6);
  const gr = g.createLinearGradient(0, -26, 0, 26);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#b8b8b8');
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(0, -28); g.quadraticCurveTo(20, -4, 0, 28); g.quadraticCurveTo(-20, -4, 0, -28); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -24); g.lineTo(0, 26); g.stroke();
  leaf = new THREE.CanvasTexture(c);
  return leaf;
}
let shard: THREE.Texture | null = null;
function shardTex() {
  if (shard) return shard;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, 'rgba(255,255,255,0.1)');
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(32, 2); g.lineTo(42, 32); g.lineTo(32, 62); g.lineTo(22, 32); g.closePath(); g.fill();
  shard = new THREE.CanvasTexture(c);
  return shard;
}
const rockGeo = new THREE.DodecahedronGeometry(0.16, 0);

export class VFX {
  group = new THREE.Group();
  private ps: P[] = [];

  sprite(key: string, pos: THREE.Vector3, o: { color?: THREE.ColorRepresentation; size?: number; size1?: number; life?: number; vel?: THREE.Vector3; rot?: number; gravity?: number; opacity?: number; fadeIn?: number; hdr?: number } = {}) {
    // HDR tint (>1) so the bloom pass turns impacts into light even on bright daylit ground
    const mat = new THREE.SpriteMaterial({ map: tex(key), color: new THREE.Color(o.color ?? '#ffffff').multiplyScalar(o.hdr ?? (key === 'leaf' || key.startsWith('smoke') || key.startsWith('dirt') ? 1 : 2.2)), transparent: true, depthWrite: false, blending: key === 'leaf' ? THREE.NormalBlending : THREE.AdditiveBlending, rotation: Math.random() * Math.PI * 2 });
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
    const mat = new THREE.MeshBasicMaterial({ map: tex(key), color: new THREE.Color(o.color ?? '#ffffff').multiplyScalar(key.startsWith('scorch') ? 1 : 1.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
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
        if ((p.obj as THREE.Mesh).geometry && (p.ground || p.ownGeo) && !p.tumble) (p.obj as THREE.Mesh).geometry.dispose();
        this.ps.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.obj.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - dt * (p.tumble ? 0.4 : 1.5));
      if (p.floor !== undefined && p.obj.position.y < p.floor) { p.obj.position.y = p.floor; p.vel.y = Math.abs(p.vel.y) * 0.35; p.vel.x *= 0.6; p.vel.z *= 0.6; }
      const s = p.keepScale ? p.s0 * (t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1) : p.s0 + (p.s1 - p.s0) * ease.out(t);
      p.obj.scale.setScalar(Math.max(0.0001, s));
      if (p.tumble) { p.obj.rotation.x += p.tumble.x * dt; p.obj.rotation.y += p.tumble.y * dt; p.obj.rotation.z += p.tumble.z * dt; }
      else if (p.ground) p.obj.rotation.y += p.rot * dt;
      else (p.mat as THREE.SpriteMaterial).rotation += p.rot * dt;
      const fadeIn = Math.min(1, p.age / p.fadeIn);
      p.mat.opacity = p.tumble ? 1 : p.a0 * fadeIn * (1 - Math.pow(t, 1.6));
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

  // ── v3: element impacts, debris, lightning, crits, KO ─────────────────
  /** Tumbling rock chunks that bounce on the ground. */
  debris(pos: THREE.Vector3, color: THREE.ColorRepresentation, n = 10, speed = 6, floor = pos.y - 1) {
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(new THREE.Color('#6a5a48'), 0.5), roughness: 0.9, flatShading: true, transparent: true });
      const m = new THREE.Mesh(rockGeo, mat);
      m.position.copy(pos);
      const sc = 0.6 + Math.random() * 1.1;
      m.scale.setScalar(sc);
      m.castShadow = true;
      this.group.add(m);
      const v = new THREE.Vector3(Math.random() - 0.5, 0.7 + Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random() * 0.7));
      this.ps.push({ obj: m, mat, vel: v, life: 0.9 + Math.random() * 0.5, age: 0, s0: sc, s1: sc, rot: 0, gravity: 18, fadeIn: 0.01, a0: 1, tumble: new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12), keepScale: true, floor });
    }
  }

  /** Jagged bolt from the sky (or from→to), two crossed ribbons so it reads from any angle. */
  lightning(from: THREE.Vector3, to: THREE.Vector3, color: THREE.ColorRepresentation = '#fff6a0', width = 0.28, life = 0.32) {
    const segs = 12;
    const pts: THREE.Vector3[] = [];
    const dir = to.clone().sub(from);
    const side = new THREE.Vector3(1, 0, 0).cross(dir).normalize();
    const side2 = dir.clone().cross(side).normalize();
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const j = i === 0 || i === segs ? 0 : (Math.random() - 0.5) * dir.length() * 0.12;
      const k = i === 0 || i === segs ? 0 : (Math.random() - 0.5) * dir.length() * 0.12;
      pts.push(from.clone().addScaledVector(dir, t).addScaledVector(side, j).addScaledVector(side2, k));
    }
    for (const axis of [side, side2]) {
      const pos: number[] = [];
      for (let i = 0; i < segs; i++) {
        const a = pts[i], b = pts[i + 1];
        const w0 = width * (1 - i / segs * 0.6), w1 = width * (1 - (i + 1) / segs * 0.6);
        const a0 = a.clone().addScaledVector(axis, w0), a1 = a.clone().addScaledVector(axis, -w0), b0 = b.clone().addScaledVector(axis, w1), b1 = b.clone().addScaledVector(axis, -w1);
        pos.push(a0.x, a0.y, a0.z, a1.x, a1.y, a1.z, b0.x, b0.y, b0.z, a1.x, a1.y, a1.z, b1.x, b1.y, b1.z, b0.x, b0.y, b0.z);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 11;
      this.group.add(m);
      this.ps.push({ obj: m, mat, vel: new THREE.Vector3(), life, age: 0, s0: 1, s1: 1, rot: 0, gravity: 0, fadeIn: 0.01, a0: 1, ownGeo: true, ground: true });
    }
    this.sprite('flare_01', to, { color, size: 2.5, size1: 4.5, life: 0.25 });
  }

  /** Expanding ground shockwave. */
  shockwave(pos: THREE.Vector3, color: THREE.ColorRepresentation, size = 8, life = 0.5) {
    this.groundDecal('circle_05', pos, { color, size: 0.6, size1: size, life, opacity: 0.9 });
    this.groundDecal('circle_02', pos, { color: '#ffffff', size: 0.4, size1: size * 0.7, life: life * 0.8, opacity: 0.6 });
  }

  /** Element-specific impact; `big` for heavy / final hits. */
  impact(pos: THREE.Vector3, element: string, color: THREE.ColorRepresentation, big = false, groundY = pos.y - 1) {
    const k = big ? 1.5 : 1;
    this.sprite('flare_01', pos, { color, size: 1.6 * k, size1: 3.2 * k, life: 0.2 });
    this.sprite('star_07', pos, { color: '#ffffff', size: 1.2 * k, size1: 0.2, life: 0.22, rot: 5 });
    switch (element) {
      case 'fire':
        for (let i = 0; i < 8 * k; i++) this.sprite('fire_01', pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8)), { color: i % 2 ? '#ffb03a' : '#ff5a1a', size: 0.9, size1: 1.8, life: 0.45 + Math.random() * 0.3, vel: new THREE.Vector3((Math.random() - 0.5) * 2, 3 + Math.random() * 3, (Math.random() - 0.5) * 2), fadeIn: 0.04 });
        this.sparks(pos, '#ffcf6a', 16 * k, 9);
        break;
      case 'water':
        for (let i = 0; i < 18 * k; i++) {
          const v = new THREE.Vector3(Math.random() - 0.5, 0.6 + Math.random(), Math.random() - 0.5).normalize().multiplyScalar(4 + Math.random() * 4);
          this.sprite('light_01', pos, { color: i % 3 ? '#8fdcff' : '#ffffff', size: 0.35, size1: 0.15, life: 0.6, vel: v, gravity: 14 });
        }
        this.sprite('smoke_04', pos, { color: '#bfe8ff', size: 1.4 * k, size1: 3 * k, life: 0.55, opacity: 0.45 });
        this.groundDecal('circle_02', new THREE.Vector3(pos.x, groundY, pos.z), { color: '#8fdcff', size: 1, size1: 5 * k, life: 0.6 });
        break;
      case 'nature':
        for (let i = 0; i < 14 * k; i++) {
          const v = new THREE.Vector3(Math.random() - 0.5, 0.4 + Math.random(), Math.random() - 0.5).normalize().multiplyScalar(3 + Math.random() * 4);
          this.sprite('leaf', pos, { color: i % 3 ? '#6fd84a' : '#c8ff7a', size: 0.45, size1: 0.35, life: 0.9 + Math.random() * 0.4, vel: v, gravity: 3.5, rot: (Math.random() - 0.5) * 12 });
        }
        this.sprite('magic_03', pos, { color, size: 1, size1: 3 * k, life: 0.4, rot: 3 });
        break;
      case 'earth':
        this.debris(pos, color, big ? 12 : 7, big ? 8 : 6, groundY + 0.1);
        this.sprite('dirt_02', pos, { color: '#c8a070', size: 1.2 * k, size1: 2.6 * k, life: 0.5, opacity: 0.8 });
        this.groundDecal('circle_02', new THREE.Vector3(pos.x, groundY, pos.z), { color, size: 1, size1: 6 * k, life: 0.55 });
        break;
      case 'storm':
        this.lightning(pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 9, (Math.random() - 0.5) * 2)), pos, '#fff3a0', big ? 0.34 : 0.24);
        this.sparks(pos, '#fff6b0', 20 * k, 11);
        break;
      case 'wind':
        this.sprite('twirl_02', pos, { color: '#dffff8', size: 1.2 * k, size1: 3.4 * k, life: 0.45, rot: 9, opacity: 0.8 });
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          this.sprite('trace_04', pos.clone().add(new THREE.Vector3(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6)), { color: '#bff8ff', size: 1.4, size1: 0.6, life: 0.35, vel: new THREE.Vector3(Math.cos(a + 1.4) * 6, 1, Math.sin(a + 1.4) * 6), rot: 4 });
        }
        break;
      case 'void':
        this.sprite('circle_05', pos, { color: '#b36bff', size: 4 * k, size1: 0.2, life: 0.35 });
        this.sprite('magic_05', pos, { color: '#7a3aff', size: 2.8 * k, size1: 0.6, life: 0.45, rot: -6 });
        for (let i = 0; i < 14; i++) {
          const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
          this.sprite('shard', pos.clone().addScaledVector(d, 2.2), { color: '#d0a0ff', size: 0.5, size1: 0.1, life: 0.35, vel: d.multiplyScalar(-6) });
        }
        break;
      default:
        this.sparks(pos, color, 12 * k, 8);
    }
    if (big) this.shockwave(new THREE.Vector3(pos.x, groundY, pos.z), color, 7);
  }

  /** Critical hit: white star burst with radial streaks. */
  crit(pos: THREE.Vector3, color: THREE.ColorRepresentation) {
    this.sprite('star_07', pos, { color: '#fffbe8', size: 1.5, size1: 7, life: 0.32, rot: 2 });
    this.sprite('flare_01', pos, { color: '#ffffff', size: 3, size1: 7, life: 0.2 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this.sprite('trace_01', pos, { color: i % 2 ? color : '#ffffff', size: 1.2, size1: 0.2, life: 0.3, vel: new THREE.Vector3(Math.cos(a) * 14, Math.sin(a) * 6 + 2, Math.sin(a) * 14) });
    }
  }

  /** Motes rising from a dissolving Mystic (KO) or streaming into an orb (capture). */
  motes(pos: THREE.Vector3, color: THREE.ColorRepresentation, height: number, n = 26, to?: THREE.Vector3) {
    for (let i = 0; i < n; i++) {
      const p = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * height * 0.6, Math.random() * height, (Math.random() - 0.5) * height * 0.6));
      const vel = to ? to.clone().sub(p).multiplyScalar(2.2) : new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 0.6);
      this.sprite(i % 3 ? 'light_01' : 'star_04', p, { color, size: 0.35 + Math.random() * 0.3, size1: 0.05, life: 0.6 + Math.random() * 0.6, vel, fadeIn: 0.1 });
    }
  }

  /** Prismatic spiral of star glints for a shiny's entrance. */
  shinyBurst(pos: THREE.Vector3, height: number) {
    const cols = ['#ff8ad8', '#8ad8ff', '#ffe28a', '#a8ff9a', '#d0a8ff', '#ffffff'];
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 4;
      const r = 0.6 + (i / 36) * height * 0.6;
      const p = pos.clone().add(new THREE.Vector3(Math.cos(a) * r, (i / 36) * height * 1.2, Math.sin(a) * r));
      this.sprite('star_06', p, { color: cols[i % cols.length], size: 0.2, size1: 0.9, life: 0.9 + (i / 36) * 0.5, vel: new THREE.Vector3(Math.cos(a) * 0.8, 0.8, Math.sin(a) * 0.8), rot: 3, fadeIn: 0.05 + i * 0.012 });
    }
    this.sprite('flare_01', pos.clone().add(new THREE.Vector3(0, height * 0.6, 0)), { color: '#fff4fa', size: 1, size1: height * 3, life: 0.6 });
    this.groundDecal('circle_05', pos, { color: '#ffd8f8', size: 1, size1: height * 4, life: 0.8 });
  }
}
