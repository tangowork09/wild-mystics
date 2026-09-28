// Expedition camps and Guardian arenas (v3:towns). Camps: tent, campfire, bedrolls, supplies and
// the expedition flag (rest + save + fast travel). Arenas: a clear, flat battle floor ~26 m across
// ringed by standing stones or ruins themed per land, with the rune ring and the Guardian beacon.

import * as THREE from 'three';
import { ZONES, type Zone } from '../../data/zones';
import { Q } from '../../core/renderer';
import type { TerrainData } from '../terrain';
import type { Props } from '../props';
import { TownCtx, circle } from './town';
import { shade, T, C, type Col } from './kit';
import { kit, clothMat } from './parts';
import type { Interactable } from './types';

const FLOOR_R = 13;

interface ArenaTheme { stone: Col; accent: Col; kind: 'menhir' | 'pillar' | 'coral' | 'totem' | 'obsidian' | 'root' | 'obelisk' | 'ice' | 'crystal' | 'column'; floor: Col }
const ARENA: Record<string, ArenaTheme> = {
  vale: { stone: '#8f8a80', accent: '#6f9a44', kind: 'menhir', floor: '#b8ad90' },
  lakes: { stone: '#7c8894', accent: '#8fd8e8', kind: 'pillar', floor: '#a9b3a6' },
  coast: { stone: '#d8ccb0', accent: '#4fc6c8', kind: 'coral', floor: '#e2d6b2' },
  marsh: { stone: '#4f4a3f', accent: '#b8ff7a', kind: 'totem', floor: '#7a7a5a' },
  scar: { stone: '#27232a', accent: '#ff7a2a', kind: 'obsidian', floor: '#5a4038' },
  elder: { stone: '#5a4230', accent: '#9dffb0', kind: 'root', floor: '#7a8a52' },
  dunes: { stone: '#d9b27a', accent: '#3aa0a8', kind: 'obelisk', floor: '#e0c690' },
  peaks: { stone: '#9aa2b8', accent: '#bfe6ff', kind: 'ice', floor: '#dfe6f2' },
  hollows: { stone: '#5a5478', accent: '#8ff0ff', kind: 'crystal', floor: '#8a86a6' },
  summit: { stone: '#e6e2da', accent: '#ffe7a8', kind: 'column', floor: '#d8d4ca' },
};

const CAMP_TINT: Record<string, { tent: Col; flag: Col; cloth: Col }> = {
  vale: { tent: '#d8c9a4', flag: '#d64a3a', cloth: '#6a8a4a' },
  lakes: { tent: '#c9d2cf', flag: '#3a7ab0', cloth: '#4a7a8a' },
  coast: { tent: '#efe6d0', flag: '#2a9ab0', cloth: '#d86a4a' },
  marsh: { tent: '#8a9a78', flag: '#7ac04a', cloth: '#5a4a6a' },
  scar: { tent: '#9a7a62', flag: '#e0602a', cloth: '#3a3432' },
  elder: { tent: '#a8b48a', flag: '#4aa060', cloth: '#8a5a3a' },
  dunes: { tent: '#ead6b0', flag: '#d8402a', cloth: '#2a7a8a' },
  peaks: { tent: '#b8bccc', flag: '#3a5ac0', cloth: '#8a3a3a' },
  hollows: { tent: '#9a94b0', flag: '#8a5ad0', cloth: '#3a6a7a' },
  summit: { tent: '#e8e4da', flag: '#d9b25f', cloth: '#5a4ad0' },
};

export class Sites {
  group = new THREE.Group();
  interactables: Interactable[] = [];
  lampSpots: THREE.Vector3[] = [];
  private beams = new Map<string, THREE.Mesh>();
  private rings: THREE.Mesh[] = [];
  private animated: TownCtx['animated'] = [];

  constructor(private data: TerrainData, private props: Props) {}

  build() {
    for (const z of ZONES) {
      this.camp(z);
      this.arena(z);
    }
  }

  private finish(ctx: TownCtx, lodDist = 240) {
    const lod = new THREE.LOD();
    lod.position.set(ctx.cx, ctx.base, ctx.cz);
    lod.rotation.y = ctx.rot;
    lod.updateMatrixWorld(true);
    const detail = ctx.b.build(`site:${ctx.id}`);
    const inv = new THREE.Matrix4().copy(lod.matrixWorld).invert();
    for (const o of [...ctx.extras.children]) o.applyMatrix4(inv);
    detail.add(ctx.extras);
    lod.addLevel(detail, 0);
    lod.addLevel(ctx.far.build(`site-far:${ctx.id}`, new Set()), Math.min(lodDist, Q.far * 0.6));
    this.group.add(lod);
    this.interactables.push(...ctx.interactables);
    this.lampSpots.push(...ctx.lamps);
    this.animated.push(...ctx.animated);
    return lod;
  }

  // ── camps ───────────────────────────────────────────────────────────────────────────────
  private camp(zone: Zone) {
    const [x, z] = zone.camp;
    // face the camp toward the arena (the reason you camp here)
    const rot = Math.atan2(zone.boss.pos[0] - x, zone.boss.pos[1] - z) + Math.PI;
    const ctx = new TownCtx(`${zone.id}-camp`, zone, this.data, this.props, x, z, rot, 9);
    const tint = CAMP_TINT[zone.id] ?? CAMP_TINT.vale;
    const b = ctx.b;
    // packed-earth ground
    ctx.fill(circle(0, 0, 5.2, 24), shade('#b59a74', 0.95), { bucket: 'pave', lift: 0.05, cell: 1.4 });
    // A-frame tent (behind the fire)
    ctx.on(0, -3.4, 0, () => {
      for (const s of [-1, 1]) b.box('cloth', s * 0.78, 0.95, 0, 0.06, 2.2, 3.0, shade(tint.tent, s > 0 ? 1 : 0.9), { rz: s * 0.62 });
      b.box('solid', 0, 1.82, 0, 0.1, 0.1, 3.3, '#5a4330');
      for (const sz of [-1.55, 1.55]) {
        b.box('solid', 0, 0.92, sz, 0.08, 1.9, 0.08, '#5a4330');
        b.prism('cloth', 0, 0.0, sz * 1.0, 2.2, 1.8, 0.04, shade(tint.tent, 0.8), { ry: 0 });
      }
      b.box('cloth', 0, 0.02, 0, 2.4, 0.04, 3.4, shade(tint.cloth, 0.8));
    });
    ctx.collide(0, -3.4, 1.6);
    // campfire ring + logs
    ctx.on(0, 0.8, 0, () => {
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; b.shape('solid', T.dodeca(), Math.cos(a) * 0.72, 0.1, Math.sin(a) * 0.72, 0.2, 0.16, 0.18, shade('#8a847a', 0.85 + (i % 3) * 0.08), { ry: a }); }
      for (let i = 0; i < 4; i++) b.cyl('solid', 0, 0.14, 0, 0.08, 0.9, '#4a3222', { sides: 6, rx: Math.PI / 2 - 0.35, ry: (i / 4) * Math.PI * 2 });
      b.cyl('shine', 0, 0.02, 0, 0.42, 0.06, '#ff7a24', { sides: 10 });
    });
    this.flames(ctx, 0, 0.8);
    ctx.collide(0, 0.8, 0.8);
    // bedrolls, log seats, supplies
    for (const [bx, bz, br] of [[-2.3, 0.2, 0.3], [2.3, 0.4, -0.3]] as [number, number, number][]) {
      ctx.on(bx, bz, br, () => {
        b.block('cloth', 0, 0, 0, 0.8, 0.1, 1.9, tint.cloth);
        b.cyl('cloth', 0, 0.16, -0.78, 0.17, 0.8, shade(tint.cloth, 1.2), { sides: 8, rz: Math.PI / 2 });
      });
    }
    ctx.on(0, 3.1, Math.PI / 2, () => b.cyl('solid', 0, 0.24, 0, 0.24, 1.8, '#6b4a32', { sides: 7, rx: Math.PI / 2 }));
    kit(ctx, 'town_crate', 2.6, -2.6, 0.4); kit(ctx, 'town_sack', 3.3, -1.7, -0.3); kit(ctx, 'town_barrel', -2.8, -2.6, 0.2);
    kit(ctx, 'town_crate_small', 2.7, -2.5, 0.9, 1, 0.9);
    ctx.collide(2.8, -2.3, 0.9); ctx.collide(-2.8, -2.6, 0.6);
    // lantern pole + expedition flag
    ctx.on(-1.6, 3.4, 0, () => {
      b.cyl('solid', 0, 0, 0, 0.06, 2.2, '#5a4330', { sides: 6 });
      b.box('solid', 0.25, 2.12, 0, 0.5, 0.06, 0.06, '#5a4330');
      b.box('glow', 0.46, 1.86, 0, 0.18, 0.26, 0.18, '#ffc27a');
    });
    ctx.lamp(-1.6 + 0.46, ctx.y(-1.6, 3.4) + 1.86, 3.4);
    this.flag(ctx, 3.2, 1.8, tint.flag);
    ctx.far.cone('cloth', 0, ctx.y(0, -3.4), -3.4, 1.4, 1.9, tint.tent, { sides: 4 });
    ctx.interactables.push({ pos: new THREE.Vector3(x, this.data.heightAt(x, z), z), radius: 4.2, label: 'Rest at Expedition Flag', kind: 'camp', zone, id: `${zone.id}-camp`, enabled: () => true });
    this.finish(ctx, 200);
  }

  private flames(ctx: TownCtx, x: number, z: number) {
    const [wx, wz] = ctx.w(x, z);
    const g = new THREE.Group();
    g.position.set(wx, ctx.y(x, z) + ctx.base, wz);
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.28 - i * 0.06, 0.95 - i * 0.18, 7), flameMat);
      f.position.set(Math.cos(i * 2.1) * 0.1, 0.5, Math.sin(i * 2.1) * 0.1);
      g.add(f);
    }
    ctx.extras.add(g);
    ctx.animated.push({ obj: g, tick: (o, t) => o.children.forEach((c, i) => c.scale.set(1 + Math.sin(t * 17 + i * 3) * 0.12, 1 + Math.sin(t * 13 + i) * 0.25, 1 + Math.sin(t * 11 + i * 5) * 0.12)) });
    ctx.lamp(x, ctx.y(x, z) + 0.8, z);
  }

  private flag(ctx: TownCtx, x: number, z: number, color: Col) {
    ctx.on(x, z, 0, () => {
      ctx.b.cyl('metal', 0, 0, 0, 0.06, 4.8, '#d8c8a0', { sides: 8 });
      ctx.b.sphere('metal', 0, 4.85, 0, 0.1, 0.1, 0.1, '#d9b25f', { w: 8, h: 6 });
    });
    const [wx, wz] = ctx.w(x, z);
    const g = new THREE.Group();
    g.position.set(wx, ctx.y(x, z) + ctx.base + 4.25, wz);
    const geo = new THREE.PlaneGeometry(1.7, 1.05, 8, 3).translate(0.85, 0, 0);
    const m = new THREE.Mesh(geo, clothMat(color));
    m.castShadow = true;
    g.add(m);
    ctx.extras.add(g);
    const base = geo.getAttribute('position').array.slice() as Float32Array;
    ctx.animated.push({ obj: m, tick: (o, t) => {
      const pos = (o as THREE.Mesh).geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const px = base[i * 3];
        pos.setZ(i, Math.sin(t * 4 - px * 3.2) * 0.12 * px);
      }
      pos.needsUpdate = true;
    } });
    ctx.collide(x, z, 0.25);
  }

  // ── arenas ──────────────────────────────────────────────────────────────────────────────
  private arena(zone: Zone) {
    const [x, z] = zone.boss.pos;
    const th = ARENA[zone.id] ?? ARENA.vale;
    const rot = Math.atan2(zone.camp[0] - x, zone.camp[1] - z); // entrance faces the camp
    const ctx = new TownCtx(`${zone.id}-arena`, zone, this.data, this.props, x, z, rot, FLOOR_R + 5);
    const b = ctx.b;
    const r = ctx.rnd;
    // battle floor: a worn disc with an inlaid border ring
    ctx.fill(circle(0, 0, FLOOR_R, 40), (px, pz) => shade(th.floor, 0.92 + 0.08 * Math.sin(px * 0.7) * Math.cos(pz * 0.6)), { lift: 0.04, cell: 2 });
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const px = Math.cos(a) * (FLOOR_R + 0.2), pz = Math.sin(a) * (FLOOR_R + 0.2);
      b.box('solid', px, ctx.y(px, pz) + 0.05, pz, 0.5, 0.16, 1.75, shade(th.stone, 0.9 + (i % 3) * 0.06), { ry: -a });
    }
    // ring of standing elements, leaving the entrance (local +Z, toward the camp) open
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 + ((i + 1) / (n + 1)) * Math.PI * 2;
      const R = FLOOR_R + 2.6 + (i % 2) * 0.6;
      const px = Math.cos(a) * R, pz = Math.sin(a) * R;
      const face = Math.atan2(-px, -pz);
      const h = 3.6 + r() * 2.2;
      ctx.on(px, pz, face, (y) => this.arenaPiece(ctx, th, h, i, y));
      ctx.collide(px, pz, 1.0);
      ctx.far.box('solid', px, ctx.y(px, pz) + h / 2, pz, 1.2, h, 1.0, th.stone);
    }
    // entrance markers flanking the gap
    for (const s of [-1, 1]) {
      const px = s * 3.4, pz = FLOOR_R + 2.2;
      ctx.on(px, pz, 0, () => {
        b.block('solid', 0, -0.2, 0, 1.0, 0.5, 1.0, shade(th.stone, 0.9));
        b.cyl('solid', 0, 0.3, 0, 0.3, 1.6, th.stone, { sides: 8, flat: true });
        b.cyl('metal', 0, 1.9, 0, 0.42, 0.25, '#2b2826', { sides: 8, top: 1.25 });
        b.cyl('shine', 0, 2.05, 0, 0.34, 0.1, th.accent, { sides: 8 });
      });
      ctx.lamp(px, ctx.y(px, pz) + 2.2, pz);
      ctx.collide(px, pz, 0.6);
    }
    const lod = this.finish(ctx, 320);
    void lod;
    // rune ring + beacon (always visible, own meshes)
    const col = new THREE.Color(th.accent).lerp(new THREE.Color('#b36bff'), 0.35).getStyle();
    const y = this.data.heightAt(x, z);
    const ring = runeRing(col);
    ring.position.set(x, y + 0.12, z);
    this.group.add(ring);
    this.rings.push(ring);
    const beamM = beam(col);
    beamM.position.set(x, y, z);
    this.group.add(beamM);
    this.beams.set(zone.id, beamM);
  }

  private arenaPiece(ctx: TownCtx, th: ArenaTheme, h: number, i: number, _y: number) {
    const b = ctx.b;
    const st = th.stone;
    switch (th.kind) {
      case 'menhir':
        b.shape('solid', T.cyl(6, 0.7, true), 0, h / 2 - 0.3, 0, 0.75, h, 0.55, shade(st, 0.9 + (i % 3) * 0.07), { rz: (i % 2 ? 1 : -1) * 0.05 });
        b.shape('leaf', T.ico(0), 0.05, h - 0.35, 0, 0.55, 0.22, 0.45, '#6f9a44');
        b.quad('shine', 0, h * 0.55, 0.3, 0.3, 0.8, th.accent);
        break;
      case 'pillar':
        b.cyl('solid', 0, -0.2, 0, 0.55, 0.5, shade(st, 0.85), { sides: 8, flat: true });
        b.cyl('solid', 0, 0.3, 0, 0.42, h - 0.6, st, { sides: 8, flat: true, top: 0.9 });
        b.cyl('solid', 0, h - 0.3, 0, 0.6, 0.3, shade(st, 1.1), { sides: 8, flat: true });
        b.quad('shine', 0, h * 0.5, 0.41, 0.24, 0.9, th.accent);
        break;
      case 'coral':
        b.shape('solid', T.cyl(7, 0.55, true), 0, h / 2 - 0.3, 0, 0.8, h, 0.7, st);
        for (let k = 0; k < 4; k++) b.shape('solid', T.ico(0), Math.cos(k * 1.7) * 0.5, 0.8 + k * (h / 5), Math.sin(k * 1.7) * 0.5, 0.28, 0.22, 0.28, k % 2 ? '#e0826a' : th.accent);
        break;
      case 'totem':
        b.cyl('solid', 0, -0.3, 0, 0.35, h + 0.3, st, { sides: 6, flat: true, top: 0.7 });
        b.beam('solid', [0, h * 0.7, 0], [0.9, h * 0.8, 0.1], 0.14, st);
        b.box('metal', 0.85, h * 0.8 - 0.25, 0.1, 0.02, 0.4, 0.02, '#2b2826');
        b.sphere('shine', 0.85, h * 0.8 - 0.55, 0.1, 0.18, 0.2, 0.18, th.accent, { w: 8, h: 6 });
        break;
      case 'obsidian':
        b.shape('solid', T.octa(), 0, h * 0.45, 0, 0.7, h * 0.6, 0.55, st, { rz: (i % 2 ? 1 : -1) * 0.12 });
        b.shape('shine', T.octa(), 0, h * 0.45, 0.02, 0.1, h * 0.45, 0.58, th.accent, { rz: (i % 2 ? 1 : -1) * 0.12 });
        break;
      case 'root':
        b.tubeAlong('solid', [[-1.2, -0.3, 0], [-0.8, h * 0.6, 0.1], [0, h, 0], [0.9, h * 0.55, -0.1], [1.3, -0.3, 0]], 0.32, st, { sides: 7, segs: 14 });
        b.sphere('shine', 0, h - 0.5, 0, 0.2, 0.22, 0.2, th.accent, { w: 8, h: 6 });
        break;
      case 'obelisk':
        b.cyl('solid', 0, -0.4, 0, 0.62, h + 0.4, st, { sides: 4, top: 0.55, flat: true, ry: Math.PI / 4 });
        b.cone('metal', 0, h, 0, 0.36, 0.6, '#c9a24a', { sides: 4, ry: Math.PI / 4 });
        b.quad('shine', 0, h * 0.5, 0.42, 0.18, h * 0.5, th.accent);
        break;
      case 'ice':
        b.shape('solid', T.cyl(6, 0.6, true), 0, h / 2 - 0.3, 0, 0.7, h, 0.62, st);
        b.shape('shine', T.octa(), 0.2, h + 0.2, 0, 0.35, 0.9, 0.3, th.accent, { rz: 0.3 });
        b.cone('solid', 0, h - 0.35, 0, 0.62, 0.5, '#f4f8ff', { sides: 6 });
        break;
      case 'crystal':
        b.shape('shine', T.octa(), 0, h * 0.5, 0, 0.55, h * 0.55, 0.5, th.accent, { rz: (i % 2 ? 1 : -1) * 0.15 });
        b.shape('shine', T.octa(), 0.6, h * 0.25, 0.2, 0.25, h * 0.28, 0.25, shade(th.accent, 0.8), { rz: -0.4 });
        b.shape('solid', T.dodeca(), 0, 0.2, 0, 0.9, 0.5, 0.9, st);
        break;
      case 'column':
        b.cyl('solid', 0, -0.2, 0, 0.7, 0.4, shade(st, 0.95), { sides: 10 });
        b.cyl('solid', 0, 0.2, 0, 0.5, h * (i % 3 === 0 ? 0.55 : 1), st, { sides: 12, top: 0.9 });
        if (i % 3 !== 0) b.box('solid', 0, h + 0.3, 0, 1.3, 0.35, 1.3, shade(st, 1.05));
        break;
    }
  }

  setBossDefeated(zoneId: string, defeated: boolean) {
    const b = this.beams.get(zoneId);
    if (b) (b.material as THREE.ShaderMaterial).uniforms.uFade.value = defeated ? 0.12 : 1;
  }
  setBeamVisible(zoneId: string, on: boolean) {
    const b = this.beams.get(zoneId);
    if (b) b.visible = on;
  }

  update(dt: number, t: number) {
    for (const a of this.animated) a.tick(a.obj, t, dt);
    for (const r of this.rings) (r.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    for (const b of this.beams.values()) (b.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
  }
}

const flameMat = new THREE.MeshStandardMaterial({ color: '#ffb03a', emissive: '#ff7a1a', emissiveIntensity: 4, transparent: true, opacity: 0.9, depthWrite: false });

function beam(color: string): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(2.2, 3.2, 160, 24, 1, true).translate(0, 80, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uFade: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uTime; uniform float uFade; varying vec2 vUv;
      void main(){ float edge = pow(sin(vUv.x * 3.14159), 2.0); float a = (1.0 - vUv.y) * 0.55 * (0.7 + 0.3 * sin(uTime * 2.0 + vUv.y * 20.0));
      gl_FragColor = vec4(uColor * 1.6, a * (0.35 + edge * 0.4) * uFade); }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}

function runeRing(color: string): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
      void main(){ vec2 p = vUv - 0.5; float r = length(p) * 2.0; float a = atan(p.y, p.x);
      float ring = smoothstep(0.012, 0.0, abs(r - 0.93)) + smoothstep(0.008, 0.0, abs(r - 0.8)) * 0.7;
      float seg = step(0.55, fract(a * 12.0 / 3.14159 + uTime * 0.04));
      float runes = seg * smoothstep(0.03, 0.0, abs(r - 0.865)) * 0.55;
      float glow = smoothstep(1.0, 0.0, r) * 0.05;
      gl_FragColor = vec4(uColor * 1.4, (ring + runes + glow) * step(r, 1.0) * 0.75); }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_R * 2.1, FLOOR_R * 2.1).rotateX(-Math.PI / 2), mat);
  m.renderOrder = 3;
  return m;
}

export { C };
