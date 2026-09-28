import * as THREE from 'three';
import { Q } from '../core/renderer';
import type { TerrainData } from './terrain';
import { Ecology } from './flora/ecology';
import { ProtoLib, type Proto } from './flora/protos';
import { scatterTrees, scatterCover, type VegInst } from './flora/scatter';
import { Impostors } from './flora/impostors';
import { hookVegMaterial, vegDepthMaterial, type GlowMode } from './flora/material';
import { LOOK } from './flora/shared';

// Vegetation across the whole island, streamed around the camera.
//  • Trees and rocky outcrops are placed once for the island (colliders + impostor far-field).
//  • Near the camera they are full instanced meshes, rebuilt per prototype when the camera crosses a
//    chunk; beyond `Q.treeMeshR` a single impostor draw takes over (dithered hand-over).
//  • Ground cover (bushes, ferns, flowers, rocks, reeds, logs…) is generated per chunk on demand.
// Public API used by the rest of the game is unchanged: group, build, nearby, addCollider, setClear, update.

export interface Collider { x: number; z: number; r: number }

const CHUNK = 48;
const TREE_FADE = 7;
/** Parts that keep their own colour (never take the instance tint). */
const NO_TINT = new Set(['CrystalRock', 'LogEnd', 'Moss', 'Flowers', 'Leaves', 'Grass', 'Mushrooms', 'PathRocks']);
const WHITE = new THREE.Color(1, 1, 1);
const ckey = (x: number, z: number) => (x + 512) * 4096 + (z + 512);

class Pool {
  mesh: THREE.InstancedMesh;
  private veg: THREE.InstancedBufferAttribute;
  private cap: number;
  n = 0;

  constructor(private part: { geometry: THREE.BufferGeometry }, mat: THREE.Material, depth: THREE.Material, cap: number, cast: boolean) {
    this.cap = cap;
    const g = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(part.geometry.attributes)) g.setAttribute(name, a);
    g.setIndex(part.geometry.index);
    this.veg = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    g.setAttribute('aVeg', this.veg);
    this.mesh = new THREE.InstancedMesh(g, mat, cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = cast;
    this.mesh.receiveShadow = true;
    this.mesh.customDepthMaterial = depth;
  }

  begin() { this.n = 0; }

  push(m: THREE.Matrix4, c: THREE.Color, snow: number, glow: number, wind: number, seed: number) {
    if (this.n >= this.cap) this.grow();
    const i = this.n++;
    this.mesh.setMatrixAt(i, m);
    this.mesh.instanceColor!.setXYZ(i, c.r, c.g, c.b);
    this.veg.setXYZW(i, snow, glow, wind, seed);
  }

  end() {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (!this.n) return;
    const im = this.mesh.instanceMatrix, ic = this.mesh.instanceColor!;
    im.clearUpdateRanges(); im.addUpdateRange(0, this.n * 16); im.needsUpdate = true;
    ic.clearUpdateRanges(); ic.addUpdateRange(0, this.n * 3); ic.needsUpdate = true;
    this.veg.clearUpdateRanges(); this.veg.addUpdateRange(0, this.n * 4); this.veg.needsUpdate = true;
  }

  private grow() {
    const cap = this.cap * 2;
    const im = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16);
    im.array.set(this.mesh.instanceMatrix.array);
    const ic = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    ic.array.set(this.mesh.instanceColor!.array);
    const vg = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    vg.array.set(this.veg.array);
    this.mesh.instanceMatrix = im;
    this.mesh.instanceColor = ic;
    this.mesh.geometry.setAttribute('aVeg', vg);
    this.veg = vg;
    this.cap = cap;
    void this.part;
  }
}

export class Props {
  group = new THREE.Group();
  colliders: Collider[] = [];
  private grid = new Map<string, Collider[]>();
  private eco!: Ecology;
  private lib!: ProtoLib;
  private impostors: Impostors | null = null;
  private trees = new Map<number, VegInst[]>();
  private cover = new Map<number, VegInst[]>();
  private queue: number[] = [];
  private pools = new Map<string, Pool>();
  private mats = new Map<string, { mat: THREE.MeshStandardMaterial; depth: THREE.Material }>();
  private fadeTree = new THREE.Vector2();
  private fadeCover = new THREE.Vector2();
  private lastKey = '';
  private dirty = false;
  private built = false;
  private cam = new THREE.Vector3();
  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private _e = new THREE.Euler();
  private _p = new THREE.Vector3();
  private _s = new THREE.Vector3();

  constructor(private data: TerrainData) {}

  async build(progress?: (f: number) => void) {
    this.eco = new Ecology(this.data);
    this.lib = await new ProtoLib().load();
    const trees = await scatterTrees(this.eco, this.lib, Q.flora, progress);
    for (const t of trees) {
      const k = ckey(Math.floor(t.x / CHUNK), Math.floor(t.z / CHUNK));
      let l = this.trees.get(k);
      if (!l) { l = []; this.trees.set(k, l); }
      l.push(t);
      if (t.def.collider > 0) this.addCollider({ x: t.x, z: t.z, r: t.def.collider * t.scale });
    }
    // far field: one impostor draw for every tree on the island
    const protos = [...new Set(trees.map((t) => t.proto))];
    const tintClass = (p: { mat: string; foliage: boolean }) => (NO_TINT.has(p.mat) ? 0 : p.foliage ? 1 : 0.5);
    this.impostors = new Impostors(protos, this.lib.mats, tintClass, Q.impostorPx);
    this.impostors.setInstances(trees.map((t) => ({
      proto: t.proto, x: t.x, y: t.y, z: t.z, rot: t.rot, scale: t.scale, stretch: t.stretch,
      leaf: t.leaf, body: t.body, snow: t.snow, glow: t.def.glowMode === 'tint' ? t.glow : 0,
    })));
    this.group.add(this.impostors.mesh);
    this.fadeTree.set(Q.treeMeshR - TREE_FADE, Q.treeMeshR);
    this.fadeCover.set(Q.propR * 0.8, Q.propR);
    this.built = true;
    (window as unknown as { __flora?: unknown }).__flora = { trees: trees.length, impostors: this.impostors.count, protos: protos.length };
  }

  /** Battle clearing: instances within `r` of (x, z) are collapsed so they don't block the camera. */
  setClear(x: number, z: number, r: number) { LOOK.uClear.value.set(x, z, r); }

  addCollider(c: Collider) {
    this.colliders.push(c);
    const k = `${Math.floor(c.x / 8)},${Math.floor(c.z / 8)}`;
    let list = this.grid.get(k);
    if (!list) { list = []; this.grid.set(k, list); }
    list.push(c);
  }

  nearby(x: number, z: number): Collider[] {
    const out: Collider[] = [];
    const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = this.grid.get(`${cx + i},${cz + j}`);
      if (l) out.push(...l);
    }
    return out;
  }

  update(_t: number, camera?: THREE.Camera) {
    if (!this.built) return;
    if (camera) this.cam.copy(camera.position);
    const cp = this.cam;
    const kx = Math.floor(cp.x / CHUNK), kz = Math.floor(cp.z / CHUNK);
    const key = `${kx},${kz}`;
    const first = this.lastKey === '';
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.enqueue(kx, kz);
      this.dirty = true;
    }
    // generate a few cover chunks per frame (all of them on the first frame)
    let budget = first ? 256 : 2;
    while (budget-- > 0 && this.queue.length) {
      const k = this.queue.shift()!;
      if (this.cover.has(k)) continue;
      const cx = Math.floor(k / 4096) - 512, cz = (k % 4096) - 512;
      const list = scatterCover(this.eco, this.lib, cx, cz, CHUNK, Q.flora);
      for (const c of list) if (c.def.collider > 0) this.addCollider({ x: c.x, z: c.z, r: c.def.collider * c.scale });
      this.cover.set(k, list);
      this.dirty = true;
    }
    if (this.dirty) { this.dirty = false; this.rebuild(cp); }
    this.impostors?.update(cp, Q.treeMeshR - TREE_FADE, Q.treeMeshR, Q.impostorR);
  }

  private enqueue(kx: number, kz: number) {
    const R = Math.ceil((Q.propR + CHUNK) / CHUNK);
    const want: [number, number][] = [];
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
      const k = ckey(kx + i, kz + j);
      if (!this.cover.has(k)) want.push([k, i * i + j * j]);
    }
    want.sort((a, b) => a[1] - b[1]);
    this.queue = want.map((w) => w[0]);
    // forget cover far behind us (it regenerates deterministically)
    if (this.cover.size > 400) {
      for (const k of this.cover.keys()) {
        const cx = Math.floor(k / 4096) - 512, cz = (k % 4096) - 512;
        if (Math.abs(cx - kx) > R + 3 || Math.abs(cz - kz) > R + 3) this.cover.delete(k);
      }
    }
  }

  private rebuild(cp: THREE.Vector3) {
    for (const p of this.pools.values()) p.begin();
    const emitIn = (map: Map<number, VegInst[]>, radius: number) => {
      const R = Math.ceil(radius / CHUNK);
      const kx = Math.floor(cp.x / CHUNK), kz = Math.floor(cp.z / CHUNK);
      const r2 = (radius + CHUNK) * (radius + CHUNK);
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
        const list = map.get(ckey(kx + i, kz + j));
        if (!list) continue;
        for (const it of list) {
          const dx = it.x - cp.x, dz = it.z - cp.z;
          if (dx * dx + dz * dz < r2) this.emit(it);
        }
      }
    };
    emitIn(this.trees, Q.treeMeshR);
    emitIn(this.cover, Q.propR);
    for (const p of this.pools.values()) p.end();
  }

  private emit(it: VegInst) {
    this._p.set(it.x, it.y, it.z);
    this._q.setFromEuler(this._e.set(it.tiltX, it.rot, it.tiltZ));
    this._s.set(it.scale, it.scale * it.stretch, it.scale);
    this._m.compose(this._p, this._q, this._s);
    const proto = it.proto;
    for (let pi = 0; pi < proto.parts.length; pi++) {
      const part = proto.parts[pi];
      const pool = this.pool(it, proto, pi);
      const tint = NO_TINT.has(part.mat) ? WHITE : part.foliage ? it.leaf : it.body;
      pool.push(this._m, tint, it.snow, it.glow, it.def.sway > 0 ? 1 : 0, it.seed);
    }
  }

  private pool(it: VegInst, proto: Proto, pi: number): Pool {
    const part = proto.parts[pi];
    const matName = it.def.swap?.[part.mat] ?? part.mat;
    const layer = it.def.layer;
    const glow: GlowMode = it.def.glowMode ?? 'none';
    const sway = part.foliage ? it.def.sway : it.def.sway * 0.25;
    const mkey = `${matName}|${layer}|${glow}|${sway.toFixed(2)}`;
    const key = `${proto.id}:${pi}:${mkey}`;
    let pool = this.pools.get(key);
    if (pool) return pool;
    let m = this.mats.get(mkey);
    if (!m) {
      const base = this.lib.mats.get(matName);
      const mat = base.clone();
      const opts = { fade: layer === 'tree' ? this.fadeTree : this.fadeCover, sway, foliage: part.foliage, glow };
      hookVegMaterial(mat, opts);
      m = { mat, depth: vegDepthMaterial(mat, opts) };
      this.mats.set(mkey, m);
    }
    const fam = it.def.family;
    const cast = it.def.shadow !== false && (layer === 'tree' || fam === 'boulder' || fam === 'log' || fam === 'bush' || fam === 'rock' || fam === 'mushroom');
    pool = new Pool(part, m.mat, m.depth, layer === 'tree' ? 128 : 256, cast && Q.shadow > 0);
    this.pools.set(key, pool);
    this.group.add(pool.mesh);
    return pool;
  }
}
