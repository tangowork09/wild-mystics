import * as THREE from 'three';
import { envModel } from '../assets/manifest';
import { LOOK } from '../assets/stylize';
import { ZONES, WATER_LEVEL, HOMESTEAD, type Zone } from '../data/zones';
import { tweens, ease } from '../core/tween';
import type { Overworld } from '../world/world';

// Battle staging (creatures workstream): where a fight happens and what it looks like.
//   • stageCenter() moves a battle out of towns / water / clutter onto flat open ground,
//   • BattleStage builds the arena: a conforming rune-ring decal, a framed backdrop of zone-themed
//     dressing, boss pillars, ambient motes and a key / rim / impact-flash lighting rig.
// The world's own props and grass are faded around the stage with Props.setClear / Grass.setClear.

export interface StageTheme {
  ring: string;
  ring2: string;
  motes: string;
  /** Environment prop keys for the flanks / back arc (GLB from the manifest, procedural fallback). */
  flank: string[];
  back: string[];
  /** Procedural set piece for this land. */
  proc: 'none' | 'crystal' | 'obsidian' | 'ice' | 'coral' | 'ruin' | 'mushroom' | 'reeds';
  key: string;
  rim: string;
}

const THEMES: Record<string, StageTheme> = {
  vale: { ring: '#ffd98a', ring2: '#fff6d8', motes: '#fff3b0', flank: ['tree_round', 'boulder'], back: ['bush', 'flowers', 'rock', 'fern'], proc: 'none', key: '#fff1d8', rim: '#bfe4ff' },
  lakes: { ring: '#8fe8ff', ring2: '#e6fbff', motes: '#bff0ff', flank: ['tree_pine', 'boulder'], back: ['reeds', 'rock', 'fern', 'bush'], proc: 'reeds', key: '#eef6ff', rim: '#9fe0ff' },
  coast: { ring: '#6ff0e8', ring2: '#fff2c8', motes: '#e8fbff', flank: ['boulder', 'tree_round'], back: ['rock', 'pebbles', 'bush', 'flowers'], proc: 'coral', key: '#fff4e0', rim: '#8ff0ff' },
  marsh: { ring: '#b8ff7a', ring2: '#d8b0ff', motes: '#b8ff7a', flank: ['tree_twisted', 'tree_dead'], back: ['reeds', 'mushroom', 'fern', 'log'], proc: 'mushroom', key: '#e0f0d0', rim: '#c89aff' },
  scar: { ring: '#ff9a4a', ring2: '#ffe0a0', motes: '#ff8a3d', flank: ['tree_dead', 'boulder'], back: ['rock', 'pebbles', 'rock'], proc: 'obsidian', key: '#ffe2c8', rim: '#ff9a5a' },
  elder: { ring: '#d8ff8a', ring2: '#fff6a0', motes: '#fff6a0', flank: ['tree_round', 'tree_twisted'], back: ['fern', 'mushroom', 'bush', 'flowers'], proc: 'mushroom', key: '#f4ffe0', rim: '#c8ffb0' },
  dunes: { ring: '#ffd27a', ring2: '#fff0c8', motes: '#ffe0a0', flank: ['boulder', 'rock'], back: ['rock', 'pebbles', 'rock'], proc: 'ruin', key: '#fff0d0', rim: '#ffc890' },
  peaks: { ring: '#bfe8ff', ring2: '#ffffff', motes: '#ffffff', flank: ['tree_pine', 'boulder'], back: ['rock', 'pebbles', 'rock'], proc: 'ice', key: '#eef2ff', rim: '#a8c8ff' },
  hollows: { ring: '#c8a0ff', ring2: '#a0f4ff', motes: '#c8f4ff', flank: ['boulder', 'rock'], back: ['rock', 'pebbles', 'rock'], proc: 'crystal', key: '#f0eaff', rim: '#9ff0ff' },
  summit: { ring: '#fff0b8', ring2: '#b8e8ff', motes: '#e8f4ff', flank: ['boulder', 'tree_pine'], back: ['rock', 'pebbles'], proc: 'ruin', key: '#fffaf0', rim: '#c8e0ff' },
};
export const themeFor = (zone: Zone) => THEMES[zone.id] ?? THEMES.vale;

// ── Stage placement ─────────────────────────────────────────────────────────
/**
 * Town keep-out. The towns workstream will export `inTown(x, z)`; until it lands this uses each
 * land's town position with a ~60 m radius (plus the homestead). Swap the body for towns' inTown().
 */
export function inTown(x: number, z: number, margin = 0) {
  for (const zn of ZONES) if (Math.hypot(x - zn.town.pos[0], z - zn.town.pos[1]) < 60 + margin) return true;
  return Math.hypot(x - HOMESTEAD.center[0], z - HOMESTEAD.center[1]) < HOMESTEAD.radius + 14 + margin;
}

/**
 * Pick the arena centre for a battle near `from`: flat, dry, out of towns, away from big props.
 * Boss fights keep their designed arena.
 */
export function stageCenter(world: Overworld, from: THREE.Vector3, forward: THREE.Vector3, kind: 'wild' | 'boss' | 'tamer'): THREE.Vector3 {
  if (kind === 'boss') return from.clone();
  const data = world.data;
  const F = forward.clone().setY(0).normalize();
  if (F.lengthSq() < 0.01) F.set(0, 0, 1);
  const Rt = new THREE.Vector3(F.z, 0, -F.x);
  const score = (c: THREE.Vector3) => {
    if (inTown(c.x, c.z)) return Infinity;
    let lo = Infinity, hi = -Infinity;
    for (const f of [-9, -5, -2, 0, 3, 6, 9]) {
      for (const l of [-6, 0, 6]) {
        const x = c.x + F.x * f + Rt.x * l, z = c.z + F.z * f + Rt.z * l;
        const h = data.heightAt(x, z);
        if (h < WATER_LEVEL + 0.3) return Infinity;
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
    }
    let clutter = 0;
    for (const col of world.props.nearby(c.x, c.z)) {
      const d = Math.hypot(col.x - c.x, col.z - c.z);
      if (d < 11 && col.r > 0.7) clutter += (11 - d) * col.r * 0.06;
    }
    const road = data.pathAt(c.x, c.z) * 0.6 + data.plazaAt(c.x, c.z) * 2;
    return (hi - lo) * 1.2 + clutter + road;
  };
  const base = from.clone();
  let best = base.clone(), bestS = score(base);
  // widening rings: the nearest decent spot wins, far spots pay a distance tax
  for (let r = 4; r <= 110 && !(bestS < 1.2 && r > 24); r += r < 30 ? 4 : 8) {
    const steps = Math.max(8, Math.round(r * 0.9));
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const c = new THREE.Vector3(base.x + Math.cos(a) * r, 0, base.z + Math.sin(a) * r);
      const s = score(c) + r * 0.035;
      if (s < bestS) { bestS = s; best = c; }
    }
  }
  best.y = data.heightAt(best.x, best.z);
  return best;
}

// ── Lighting rig (installed once so shaders are pre-compiled with it) ──────
interface Rig { key: THREE.DirectionalLight; rim: THREE.DirectionalLight; flash: THREE.PointLight; warm: number }
let rig: Rig | null = null;

/** Add the battle lights to the scene at world build. They render once (dark) so every shader compiles with them, then hide. */
export function installStageLights(scene: THREE.Scene) {
  if (rig) return;
  const key = new THREE.DirectionalLight('#fff2dc', 0);
  const rim = new THREE.DirectionalLight('#bfe4ff', 0);
  const flash = new THREE.PointLight('#ffffff', 0, 18, 1.6);
  for (const l of [key, rim, flash]) { l.userData.wmStage = true; l.castShadow = false; scene.add(l); }
  scene.add(key.target, rim.target);
  rig = { key, rim, flash, warm: 3 };
}
/** Called every overworld frame: hides the rig after the pre-compile frames. */
export function tickStageLights(active: boolean) {
  if (!rig) return;
  if (rig.warm > 0) { rig.warm--; return; }
  if (!active) for (const l of [rig.key, rig.rim, rig.flash]) l.visible = false;
}

// ── Arena decal ─────────────────────────────────────────────────────────────
const DECAL_VERT = /* glsl */`
varying vec2 vP; uniform float uRadius;
#include <common>
#include <fog_pars_vertex>
void main(){ vP = position.xz / uRadius; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`;
const DECAL_FRAG = /* glsl */`
uniform float uTime; uniform vec3 uColor; uniform vec3 uColor2; uniform float uReveal; uniform float uBoss; uniform vec2 uFwd;
varying vec2 vP;
#include <common>
#include <fog_pars_fragment>
void main(){
  float r = length(vP); if (r > 1.0) discard;
  float a = atan(vP.y, vP.x); float af = fract(a / 6.2831853 + 0.5);
  float sweep = smoothstep(uReveal * 1.08 - 0.08, uReveal * 1.08, abs(af - 0.5) * 2.0);
  sweep = 1.0 - sweep;
  // soft stage pool: gently darkens the ground towards the rim so the fighters pop
  float pool = smoothstep(0.3, 1.0, r) * 0.28;
  float outer = smoothstep(0.016, 0.0, abs(r - 0.94)) * 1.1 + smoothstep(0.07, 0.0, abs(r - 0.94)) * 0.3;
  float inner = smoothstep(0.007, 0.0, abs(r - 0.865)) * 0.55;
  float ticks = step(0.7, fract(af * 96.0 - uTime * 0.02)) * smoothstep(0.012, 0.0, abs(r - 0.9) - 0.012) * 0.35;
  float runes = step(0.55, fract(af * 18.0 + uTime * 0.015)) * step(fract(af * 108.0), 0.55) * smoothstep(0.012, 0.0, abs(r - 0.78) - 0.012) * 0.5 * uBoss;
  float inner2 = smoothstep(0.01, 0.0, abs(r - 0.62)) * 0.35 * uBoss;
  vec2 f = normalize(uFwd); float across = abs(dot(vP, f)); float along = abs(dot(vP, vec2(-f.y, f.x)));
  float divider = smoothstep(0.005, 0.0, across) * smoothstep(0.86, 0.2, along) * 0.18;
  float rays = pow(max(0.0, sin(a * 12.0 + uTime * 0.25)), 24.0) * smoothstep(0.95, 0.5, r) * smoothstep(0.1, 0.4, r) * 0.14;
  float glow = (outer + inner + ticks + runes + inner2 + divider + rays) * sweep;
  vec3 col = mix(uColor, uColor2, smoothstep(0.8, 0.98, r) * 0.5) * glow * 2.6;
  float alpha = clamp(pool * sweep * uReveal + glow * 0.75, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}`;

function conformDisc(world: Overworld, C: THREE.Vector3, radius: number, lift = 0.06) {
  // concentric rings so the disc can follow the terrain
  const rings = 18, segs = 96;
  const pos: number[] = [0, 0, 0];
  for (let i = 1; i <= rings; i++) {
    const r = (i / rings) * radius;
    for (let j = 0; j < segs; j++) { const a = (j / segs) * Math.PI * 2; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
  }
  const idx: number[] = [];
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 1; i < rings; i++) {
    const o0 = 1 + (i - 1) * segs, o1 = 1 + i * segs;
    for (let j = 0; j < segs; j++) {
      const a = o0 + j, b = o0 + ((j + 1) % segs), c = o1 + j, d = o1 + ((j + 1) % segs);
      idx.push(a, d, c, a, b, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  const arr = new Float32Array(pos);
  for (let v = 0; v < arr.length; v += 3) arr[v + 1] = Math.max(world.data.heightAt(C.x + arr[v], C.z + arr[v + 2]), WATER_LEVEL + 0.02) - C.y + lift;
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  geo.setIndex(idx);
  return geo;
}

// ── Procedural set pieces (used when a land has no fitting prop, and for Guardians) ──
const setMat = (c: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, flatShading: true, ...o });
function crystalSpire(h: number, c: string, glow: string) {
  const g = new THREE.Group();
  g.userData.ownGeo = true;
  const n = 3 + Math.floor(Math.random() * 3);
  const body = setMat(c, { roughness: 0.25, metalness: 0.1, emissive: new THREE.Color(glow), emissiveIntensity: 0.6 });
  for (let i = 0; i < n; i++) {
    const hh = h * (0.5 + Math.random() * 0.6), r = h * 0.09 * (0.7 + Math.random() * 0.5);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.2, r, hh, 6), body);
    m.position.set((Math.random() - 0.5) * h * 0.3, hh / 2 - 0.2, (Math.random() - 0.5) * h * 0.3);
    m.rotation.set((Math.random() - 0.5) * 0.6, Math.random() * 3, (Math.random() - 0.5) * 0.6);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}
function pillar(h: number, stone: string, rune: string) {
  const g = new THREE.Group();
  g.userData.ownGeo = true;
  const sm = setMat(stone);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.1, 0.6, 8), sm); base.position.y = 0.3;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, h, 8), sm); shaft.position.y = 0.6 + h / 2;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.7, 0.5, 8), sm); cap.position.y = 0.6 + h + 0.25;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.35, 8, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(rune).multiplyScalar(2.6), toneMapped: true }));
  band.position.y = 0.6 + h * 0.62;
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), new THREE.MeshBasicMaterial({ color: new THREE.Color(rune).multiplyScalar(3) }));
  gem.position.y = 0.6 + h + 1.3;
  gem.userData.float = true;
  for (const m of [base, shaft, cap]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  g.add(band, gem);
  return g;
}

export class BattleStage {
  group = new THREE.Group();
  readonly theme: StageTheme;
  readonly radius: number;
  private decal: THREE.Mesh;
  private decalMat: THREE.ShaderMaterial;
  private dressing: { obj: THREE.Object3D; y: number; delay: number }[] = [];
  private floaters: THREE.Object3D[] = [];
  private motes: THREE.Points;
  private shafts: THREE.Mesh[] = [];
  private fog0 = 0;
  private flashK = 0;
  private flashCol = new THREE.Color();

  constructor(private world: Overworld, private kind: 'wild' | 'boss' | 'tamer', zone: Zone, readonly C: THREE.Vector3, readonly F: THREE.Vector3, accent?: string) {
    this.theme = themeFor(zone);
    this.radius = kind === 'boss' ? 19 : 12.5;
    this.group.position.copy(C);
    // arena decal
    this.decalMat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: LOOK.uTime, uColor: { value: new THREE.Color(accent ?? this.theme.ring) }, uColor2: { value: new THREE.Color(this.theme.ring2) }, uReveal: { value: 0 }, uBoss: { value: kind === 'boss' ? 1 : 0.35 }, uRadius: { value: this.radius }, uFwd: { value: new THREE.Vector2(F.x, F.z) } },
      vertexShader: DECAL_VERT, fragmentShader: DECAL_FRAG, transparent: true, depthWrite: false, fog: true,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.decal = new THREE.Mesh(conformDisc(world, C, this.radius), this.decalMat);
    this.decal.renderOrder = 2;
    this.group.add(this.decal);
    this.buildDressing();
    if (kind === 'boss') this.buildBossSet(accent);
    // ambient motes
    const N = kind === 'boss' ? 90 : 46;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) { seed[i] = Math.random(); }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    mg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const moteMat = new THREE.ShaderMaterial({
      uniforms: { uTime: LOOK.uTime, uColor: { value: new THREE.Color(kind === 'boss' ? accent ?? this.theme.motes : this.theme.motes) }, uR: { value: this.radius * 1.15 }, uH: { value: kind === 'boss' ? 14 : 7 } },
      vertexShader: /* glsl */`uniform float uTime; uniform float uR; uniform float uH; attribute float aSeed; varying float vA;
        void main(){ float s = aSeed; float life = fract(uTime * (0.05 + s * 0.08) + s * 13.0);
          float ang = s * 97.0 + uTime * 0.05 * (s - 0.5); float rr = uR * sqrt(fract(s * 7.31));
          vec3 p = vec3(cos(ang) * rr, life * uH, sin(ang) * rr);
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = (2.0 + fract(s * 3.7) * 3.0) * (60.0 / -mv.z); vA = sin(life * 3.14159) * (0.5 + 0.5 * sin(uTime * 3.0 + s * 40.0)); }`,
      fragmentShader: /* glsl */`uniform vec3 uColor; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA; gl_FragColor = vec4(uColor * 1.8 * a, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.motes = new THREE.Points(mg, moteMat);
    this.motes.frustumCulled = false;
    this.group.add(this.motes);
    world.scene.add(this.group);
  }

  private prop(key: string, i: number): THREE.Object3D | null {
    const proc = this.theme.proc;
    if (proc === 'crystal' && (key === 'boulder' || key === 'rock') && i % 2 === 0) return crystalSpire(key === 'boulder' ? 4.2 : 2.2, '#b8a8ff', '#7ad8ff');
    if (proc === 'obsidian' && (key === 'boulder' || key === 'rock') && i % 2 === 0) return crystalSpire(key === 'boulder' ? 3.6 : 1.8, '#2a2030', '#ff5a1a');
    if (proc === 'ice' && (key === 'boulder' || key === 'rock') && i % 2 === 1) return crystalSpire(key === 'boulder' ? 3.4 : 1.8, '#dff4ff', '#8fd8ff');
    const m = envModel('environment', key, i);
    if (m) return m;
    if (key === 'boulder' || key === 'rock') {
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(key === 'boulder' ? 1.6 : 0.8, 0), setMat('#8a8478'));
      r.userData.ownGeo = true;
      r.scale.set(1.2, 0.8, 1);
      r.castShadow = true;
      return r;
    }
    return null;
  }

  /** Framing: tall pieces on the two flanks of the enemy side, low dressing along the back arc. */
  private buildDressing() {
    const R = this.radius;
    const F = this.F, Rt = new THREE.Vector3(F.z, 0, -F.x);
    const put = (obj: THREE.Object3D, ang: number, dist: number, scale: number, delay: number) => {
      const dir = F.clone().multiplyScalar(Math.cos(ang)).addScaledVector(Rt, Math.sin(ang));
      const x = this.C.x + dir.x * dist, z = this.C.z + dir.z * dist;
      const h = this.world.data.heightAt(x, z);
      if (h < WATER_LEVEL + 0.1) return;
      obj.position.set(x - this.C.x, h - this.C.y, z - this.C.z);
      obj.rotation.y = Math.random() * Math.PI * 2;
      obj.scale.multiplyScalar(scale);
      obj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      this.group.add(obj);
      this.dressing.push({ obj, y: obj.position.y, delay });
    };
    let i = 0;
    for (const side of [-1, 1]) {
      // flank: a tall piece + a boulder, just outside the cleared ring, slightly behind the enemies
      const tall = this.prop(this.theme.flank[0], i++);
      if (tall) put(tall, side * (0.95 + Math.random() * 0.15), R + 3 + Math.random() * 2, 1.05 + Math.random() * 0.25, 0.05);
      const big = this.prop(this.theme.flank[1], i++);
      if (big) put(big, side * (0.62 + Math.random() * 0.12), R + 1.5 + Math.random() * 1.5, 1.2 + Math.random() * 0.5, 0.12);
    }
    // low back arc: keeps the horizon behind the enemies readable
    const n = this.kind === 'boss' ? 0 : 7;
    for (let k = 0; k < n; k++) {
      const key = this.theme.back[k % this.theme.back.length];
      const p = this.prop(key, i++);
      if (!p) continue;
      const ang = (k / (n - 1) - 0.5) * 1.2 + (Math.random() - 0.5) * 0.12;
      put(p, ang, R + 1 + Math.random() * 3.5, 0.9 + Math.random() * 0.5, 0.2 + k * 0.03);
    }
  }

  /** Guardians: a ring of rune pillars that rise with the fight, floating gems and god-rays. */
  private buildBossSet(accent?: string) {
    const R = this.radius + 1.5;
    const stone = this.theme.proc === 'obsidian' ? '#3a2e34' : this.theme.proc === 'crystal' ? '#6a6488' : this.theme.proc === 'ice' ? '#aebcd0' : '#8a8274';
    const rune = accent ?? this.theme.ring;
    const n = 8;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.PI / n;
      const x = this.C.x + Math.cos(a) * R, z = this.C.z + Math.sin(a) * R;
      const h = this.world.data.heightAt(x, z);
      // keep the camera side open: skip the two pillars nearest the party's back
      const toP = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).dot(this.F);
      if (toP < -0.8) continue;
      const p = pillar(5 + Math.random() * 2.5, stone, rune);
      p.position.set(x - this.C.x, h - this.C.y, z - this.C.z);
      p.rotation.y = Math.random() * Math.PI;
      this.group.add(p);
      this.dressing.push({ obj: p, y: p.position.y, delay: 0.1 + k * 0.08 });
      p.traverse((o) => { if (o.userData.float) this.floaters.push(o); });
    }
    // god-rays over the Guardian
    const shaftMat = new THREE.ShaderMaterial({
      uniforms: { uTime: LOOK.uTime, uColor: { value: new THREE.Color(rune) } },
      vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`uniform float uTime; uniform vec3 uColor; varying vec2 vUv; void main(){ float a = (1.0 - vUv.y) * 0.16 * (0.6 + 0.4 * sin(uTime * 0.8 + vUv.x * 12.0)) * smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x); gl_FragColor = vec4(uColor * a * 1.5, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    for (let k = 0; k < 3; k++) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(3 + k * 1.5, 1 + k * 0.6, 34, 16, 1, true), shaftMat);
      const off = this.F.clone().multiplyScalar(6 + k * 0.5);
      s.position.set(off.x + (k - 1) * 1.5, 16, off.z);
      s.rotation.z = (k - 1) * 0.12;
      s.userData.wmFx = true;
      s.visible = false;
      this.group.add(s);
      this.shafts.push(s);
    }
  }

  /** Intro: the ring draws itself, set pieces rise, lights come up. */
  async reveal(dur = 0.9) {
    for (const d of this.dressing) d.obj.position.y = d.y - 6;
    this.lightsOn();
    for (const s of this.shafts) s.visible = true;
    await tweens.tween(dur, (k) => {
      this.decalMat.uniforms.uReveal.value = k;
      for (const d of this.dressing) {
        const t = THREE.MathUtils.clamp((k - d.delay) / 0.55, 0, 1);
        d.obj.position.y = d.y - 6 * (1 - ease.back(t));
      }
    }, ease.out);
  }

  private lightsOn() {
    if (!rig) return;
    const { key, rim, flash } = rig;
    key.color.set(this.theme.key);
    rim.color.set(this.theme.rim);
    key.intensity = this.kind === 'boss' ? 0.9 : 1.1;
    rim.intensity = this.kind === 'boss' ? 2.6 : 2.0;
    flash.intensity = 0;
    for (const l of [key, rim, flash]) l.visible = true;
    const fog = this.world.scene.fog as THREE.FogExp2 | null;
    if (fog && 'density' in fog) { this.fog0 = fog.density; fog.density *= this.kind === 'boss' ? 1.1 : 1.2; }
  }

  /** Warm light burst at a point (hits, crits, bursts). */
  flash(pos: THREE.Vector3, color: THREE.ColorRepresentation, k = 1) {
    if (!rig) return;
    rig.flash.position.copy(pos);
    this.flashCol.set(color);
    rig.flash.color.copy(this.flashCol);
    this.flashK = Math.max(this.flashK, k);
  }

  /** Per frame: key light rides with the camera, rim sits behind the enemy line. */
  update(dt: number, camera: THREE.Camera) {
    if (rig) {
      const { key, rim, flash } = rig;
      const camDir = new THREE.Vector3().subVectors(camera.position, this.C).setY(0).normalize();
      const left = new THREE.Vector3(camDir.z, 0, -camDir.x);
      key.position.copy(this.C).addScaledVector(camDir, 8).addScaledVector(left, 6).add(new THREE.Vector3(0, 10, 0));
      key.target.position.copy(this.C);
      rim.position.copy(this.C).addScaledVector(camDir, -12).add(new THREE.Vector3(0, 7, 0));
      rim.target.position.copy(this.C);
      key.target.updateMatrixWorld();
      rim.target.updateMatrixWorld();
      this.flashK = Math.max(0, this.flashK - dt * 5);
      flash.intensity = this.flashK * 60;
    }
    const t = LOOK.uTime.value;
    for (const f of this.floaters) { f.rotation.y = t * 1.2; f.position.y += Math.sin(t * 2 + f.id) * 0.004; }
  }

  dispose() {
    this.world.scene.remove(this.group);
    if (rig) for (const l of [rig.key, rig.rim, rig.flash]) { l.visible = false; l.intensity = 0; }
    const fog = this.world.scene.fog as THREE.FogExp2 | null;
    if (fog && 'density' in fog && this.fog0) fog.density = this.fog0;
    // env props are clones that share GLB geometry: only free what the stage built itself
    const own = (o: THREE.Object3D) => { const g = (o as THREE.Mesh).geometry; if (g) g.dispose(); };
    own(this.decal); own(this.motes); this.decalMat.dispose();
    for (const s of this.shafts) own(s);
    for (const d of this.dressing) if (d.obj.userData.ownGeo) d.obj.traverse(own);
  }
}
