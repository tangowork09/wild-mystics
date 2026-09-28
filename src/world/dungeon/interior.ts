import * as THREE from 'three';
import { mulberry32 } from '../../core/noise';
import { Q } from '../../core/renderer';
import type { DungeonDef } from '../../data/layout';
import { THEMES, type ChestDef, type DungeonData, type ThemeStyle } from '../../data/dungeons';
import { CELL, DX, DZ, LEVEL_Y, WALL_H, passable, type Door, type Layout, type Room } from './layout';
import { piece, themedMaterial, type KitId } from './kit';
import { Glows, Motes, Shafts, surfaceMaterial, poolTexture } from './fx';
import { dressRoom, type Dresser } from './dress';

// A built dungeon interior (v3:dungeons): instanced kit geometry + effects for one layout, plus
// the navigation queries the world needs while the player is inside (floor height, collision,
// camera clearance). Everything is placed from a seeded RNG, so a revisit looks identical.

export const WALL_HALF = 0.5;
const POST_HALF = 0.78;
const CAP_Y = LEVEL_Y[0] + WALL_H - 0.04;

export interface Collider { x: number; z: number; r: number }
export interface Box2 { x0: number; z0: number; x1: number; z1: number }

export interface Light { pos: THREE.Vector3; color: THREE.Color; intensity: number; glow: number; phase: number; on: boolean; room: number }

export interface ChestAnchor { pos: THREE.Vector3; yaw: number; def: ChestDef; key: string; room: number }
export interface MysticAnchor { pos: THREE.Vector3; room: number; patrol: THREE.Vector3[] | null; rare: boolean; guard: boolean }
export interface PuzzleAnchor {
  index: number;
  room: Room;
  kind: DungeonData['puzzles'][number];
  gate: Door | null;
  spots: { pos: THREE.Vector3; yaw: number }[];
  hint: { pos: THREE.Vector3; yaw: number } | null;
}
export interface GateAnchor { door: Door; pos: THREE.Vector3; yaw: number; axis: 'x' | 'z'; puzzle: number; boss: boolean; y: number }

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
export const yawFor = (d: number) => Math.atan2(-DX[d], -DZ[d]);

export function mat(x: number, y: number, z: number, yaw = 0, s = 1, sy = s) {
  tmpQ.setFromAxisAngle(UP, yaw);
  tmpS.set(s, sy, s);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), tmpQ, tmpS);
}

/** Collects instance transforms per kit piece, then emits one InstancedMesh per piece part. */
export class Batch {
  private lists = new Map<string, { kit: KitId; name: string; mats: THREE.Matrix4[]; shadow: boolean }>();
  add(kit: KitId, name: string, m: THREE.Matrix4, shadow = true) {
    const k = `${kit}/${name}/${shadow ? 1 : 0}`;
    let l = this.lists.get(k);
    if (!l) { l = { kit, name, mats: [], shadow }; this.lists.set(k, l); }
    l.mats.push(m);
  }
  build(group: THREE.Group, themeKey: string, theme: ThemeStyle) {
    let calls = 0;
    for (const l of this.lists.values()) {
      const p = piece(l.kit, l.name);
      for (const part of p.parts) {
        const inst = new THREE.InstancedMesh(part.geometry, themedMaterial(l.kit, part.material, themeKey, theme), l.mats.length);
        l.mats.forEach((m, i) => inst.setMatrixAt(i, tmpM.multiplyMatrices(m, part.matrix)));
        inst.castShadow = l.shadow;
        inst.receiveShadow = true;
        inst.computeBoundingSphere();
        inst.name = `${l.kit}/${l.name}`;
        group.add(inst);
        calls++;
      }
    }
    return calls;
  }
}

export class Interior {
  group = new THREE.Group();
  glows = new Glows(700);
  motes: Motes;
  shafts: Shafts | null = null;
  theme: ThemeStyle;
  lights: Light[] = [];
  /** Per cell: floor height (solid cells: the nearest floor's). */
  cellY: Float32Array;
  /** Static round colliders, bucketed by cell. */
  private colGrid = new Map<number, Collider[]>();
  /** Static boxes (door posts, big props), bucketed by cell. */
  private boxGrid = new Map<number, Box2[]>();
  /** Dynamic blockers: closed gates, the push block… (few, always checked). */
  dynamic = new Map<string, Box2>();
  /** Wall edges that are blocked while a gate is closed: key cellIndex*4+dir. */
  private gateEdges = new Map<number, string>();
  /** Grid vertices carrying a post (pillar). */
  private posts = new Set<number>();
  anchors = {
    spawn: { pos: new THREE.Vector3(), yaw: 0 },
    exit: { pos: new THREE.Vector3(), yaw: 0 },
    spring: new THREE.Vector3(),
    lore: { pos: new THREE.Vector3(), yaw: 0 },
    chests: [] as ChestAnchor[],
    mystics: [] as MysticAnchor[],
    puzzles: [] as PuzzleAnchor[],
    gates: [] as GateAnchor[],
    boss: { pos: new THREE.Vector3(), yaw: 0, center: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, -1), room: null as Room | null },
    portal: { pos: new THREE.Vector3(), yaw: 0 },
  };
  drawCalls = 0;
  private occ: Uint8Array;
  private occN: number;
  private surfaces: THREE.ShaderMaterial[] = [];

  constructor(public def: DungeonDef, public data: DungeonData, public L: Layout, public origin: THREE.Vector3) {
    this.theme = THEMES[def.theme];
    this.cellY = new Float32Array(L.n * L.n);
    this.occN = L.n * CELL;
    this.occ = new Uint8Array(this.occN * this.occN);
    this.motes = new Motes(this.theme.motes.kind, this.theme.motes.color, Q.grass > 50000 ? 360 : 200);
    this.group.name = `dungeon:${def.id}`;
  }

  // ── Coordinates ─────────────────────────────────────────────────────────────────────────────
  cx(i: number) { return this.origin.x + (i + 0.5) * CELL; }
  cz(j: number) { return this.origin.z + (j + 0.5) * CELL; }
  cellOf(x: number, z: number): [number, number] { return [Math.floor((x - this.origin.x) / CELL), Math.floor((z - this.origin.z) / CELL)]; }
  isFloor(i: number, j: number) { return i >= 0 && j >= 0 && i < this.L.n && j < this.L.n && this.L.floor[j * this.L.n + i] === 1; }
  contains(x: number, z: number) {
    const s = this.L.n * CELL;
    return x >= this.origin.x - 8 && z >= this.origin.z - 8 && x < this.origin.x + s + 8 && z < this.origin.z + s + 8;
  }
  roomAt(x: number, z: number): Room | null {
    const [i, j] = this.cellOf(x, z);
    if (!this.isFloor(i, j)) return null;
    const o = this.L.owner[j * this.L.n + i];
    return o >= 0 ? this.L.rooms[o] : null;
  }
  roomCenter(r: Room, y = true) {
    return new THREE.Vector3(this.origin.x + (r.x + r.w / 2) * CELL, y ? LEVEL_Y[r.level] : 0, this.origin.z + (r.y + r.h / 2) * CELL);
  }
  /** Inner (walkable) bounds of a room in world units. */
  roomBounds(r: Room, inset = WALL_HALF): Box2 {
    return { x0: this.origin.x + r.x * CELL + inset, z0: this.origin.z + r.y * CELL + inset, x1: this.origin.x + (r.x + r.w) * CELL - inset, z1: this.origin.z + (r.y + r.h) * CELL - inset };
  }

  /** Floor height at a world point (stairs ramp; solid cells report their nearest floor). */
  floorY(x: number, z: number) {
    const fi = (x - this.origin.x) / CELL, fj = (z - this.origin.z) / CELL;
    const i = Math.floor(fi), j = Math.floor(fj);
    const n = this.L.n;
    if (i < 0 || j < 0 || i >= n || j >= n) return LEVEL_Y[0];
    const k = j * n + i;
    const sd = this.L.stairDir[k];
    if (sd >= 0) {
      const fx = fi - i, fz = fj - j;
      const t = sd === 0 ? 1 - fz : sd === 2 ? fz : sd === 1 ? fx : 1 - fx;
      return LEVEL_Y[1] + (LEVEL_Y[0] - LEVEL_Y[1]) * THREE.MathUtils.clamp(t, 0, 1);
    }
    return this.cellY[k];
  }

  // ── Collision ───────────────────────────────────────────────────────────────────────────────
  private edgeOpen(i: number, j: number, d: number) {
    if (!passable(this.L, i, j, d)) return false;
    return !this.gateEdges.has((j * this.L.n + i) * 4 + d);
  }

  /** Push (x, z) out of walls, posts, props and closed gates. */
  collide(x: number, z: number, r: number): [number, number] {
    const n = this.L.n;
    let [i, j] = this.cellOf(x, z);
    if (!this.isFloor(i, j)) {
      // outside the floor (shouldn't happen): snap to the nearest floor cell centre
      let best = Infinity, bi = i, bj = j;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        if (!this.isFloor(i + di, j + dj)) continue;
        const d = Math.hypot(this.cx(i + di) - x, this.cz(j + dj) - z);
        if (d < best) { best = d; bi = i + di; bj = j + dj; }
      }
      if (best === Infinity) return [x, z];
      i = bi; j = bj;
      x = THREE.MathUtils.clamp(x, this.origin.x + i * CELL + WALL_HALF + r, this.origin.x + (i + 1) * CELL - WALL_HALF - r);
      z = THREE.MathUtils.clamp(z, this.origin.z + j * CELL + WALL_HALF + r, this.origin.z + (j + 1) * CELL - WALL_HALF - r);
    }
    const x0 = this.origin.x + i * CELL, z0 = this.origin.z + j * CELL;
    const m = WALL_HALF + r;
    if (!this.edgeOpen(i, j, 0)) z = Math.max(z, z0 + m);
    if (!this.edgeOpen(i, j, 2)) z = Math.min(z, z0 + CELL - m);
    if (!this.edgeOpen(i, j, 3)) x = Math.max(x, x0 + m);
    if (!this.edgeOpen(i, j, 1)) x = Math.min(x, x0 + CELL - m);
    // corner posts at the cell's four vertices
    for (const [vi, vj] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) {
      const vk = vj * (n + 1) + vi;
      const wall = this.posts.has(vk) || this.vertexWall(vi, vj);
      if (!wall) continue;
      const vx = this.origin.x + vi * CELL, vz = this.origin.z + vj * CELL;
      const R = (this.posts.has(vk) ? POST_HALF : WALL_HALF) + r;
      const dx = x - vx, dz = z - vz, d = Math.hypot(dx, dz);
      if (d < R && d > 1e-5) { x = vx + (dx / d) * R; z = vz + (dz / d) * R; }
    }
    // props (circles) and boxes in this and neighbouring cells
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const k = (j + dj) * n + (i + di);
      for (const c of this.colGrid.get(k) ?? []) {
        const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz), R = c.r + r;
        if (d < R && d > 1e-5) { x = c.x + (dx / d) * R; z = c.z + (dz / d) * R; }
      }
      for (const b of this.boxGrid.get(k) ?? []) [x, z] = pushBox(x, z, r, b);
    }
    for (const b of this.dynamic.values()) [x, z] = pushBox(x, z, r, b);
    return [x, z];
  }

  /** Any wall edge incident to grid vertex (vi, vj)? */
  private vertexWall(vi: number, vj: number) {
    // cells around the vertex: a=(vi-1,vj-1) b=(vi,vj-1) c=(vi-1,vj) d=(vi,vj)
    const f = (i: number, j: number) => this.isFloor(i, j);
    const a = f(vi - 1, vj - 1), b = f(vi, vj - 1), c = f(vi - 1, vj), d = f(vi, vj);
    return (a !== b) || (c !== d) || (a !== c) || (b !== d);
  }

  addCollider(c: Collider) {
    const [i, j] = this.cellOf(c.x, c.z);
    const k = j * this.L.n + i;
    let l = this.colGrid.get(k);
    if (!l) { l = []; this.colGrid.set(k, l); }
    l.push(c);
  }
  addBox(b: Box2) {
    const [i, j] = this.cellOf((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
    const k = j * this.L.n + i;
    let l = this.boxGrid.get(k);
    if (!l) { l = []; this.boxGrid.set(k, l); }
    l.push(b);
  }

  /** Close/open the gate on a door edge (both sides of the edge). */
  setGate(door: Door, closed: boolean) {
    const n = this.L.n;
    const [ci, cj] = door.cell, [oi, oj] = door.outer;
    const k1 = (cj * n + ci) * 4 + door.dir, k2 = (oj * n + oi) * 4 + ((door.dir + 2) % 4);
    if (closed) { this.gateEdges.set(k1, `gate${door.id}`); this.gateEdges.set(k2, `gate${door.id}`); }
    else { this.gateEdges.delete(k1); this.gateEdges.delete(k2); }
  }

  // ── Camera clearance ───────────────────────────────────────────────────────────────────────
  /** Is a camera at p inside rock or a wall? */
  private blockedAt(p: THREE.Vector3) {
    const [i, j] = this.cellOf(p.x, p.z);
    if (!this.isFloor(i, j)) return p.y < CAP_Y + 0.6;
    const x0 = this.origin.x + i * CELL, z0 = this.origin.z + j * CELL;
    const lx = p.x - x0, lz = p.z - z0, m = WALL_HALF + 0.25;
    const top = CAP_Y + 0.3;
    if (p.y > top) return false;
    if (lz < m && !passable(this.L, i, j, 0)) return true;
    if (lz > CELL - m && !passable(this.L, i, j, 2)) return true;
    if (lx < m && !passable(this.L, i, j, 3)) return true;
    if (lx > CELL - m && !passable(this.L, i, j, 1)) return true;
    return false;
  }

  /**
   * Fraction (0..1) of the segment from `from` (the look target) to `to` (the camera) that is
   * clear of walls/rock. 1 = unobstructed.
   */
  clearance(from: THREE.Vector3, to: THREE.Vector3) {
    const len = from.distanceTo(to);
    const steps = Math.max(2, Math.ceil(len / 0.3));
    const p = new THREE.Vector3();
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      p.lerpVectors(from, to, t);
      if (this.blockedAt(p)) return Math.max(0, (s - 1) / steps);
    }
    return 1;
  }

  // ── Occupancy (1 m grid) for dressing ───────────────────────────────────────────────────────
  private occIdx(x: number, z: number) {
    const ox = Math.floor(x - this.origin.x), oz = Math.floor(z - this.origin.z);
    if (ox < 0 || oz < 0 || ox >= this.occN || oz >= this.occN) return -1;
    return oz * this.occN + ox;
  }
  isFree(x: number, z: number, r: number) {
    for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
      if (dx * dx + dz * dz > (r + 0.5) * (r + 0.5)) continue;
      const k = this.occIdx(x + dx, z + dz);
      if (k < 0 || this.occ[k]) return false;
    }
    return true;
  }
  reserve(x: number, z: number, r: number) {
    for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
      if (dx * dx + dz * dz > (r + 0.5) * (r + 0.5)) continue;
      const k = this.occIdx(x + dx, z + dz);
      if (k >= 0) this.occ[k] = 1;
    }
  }

  // ── Build ──────────────────────────────────────────────────────────────────────────────────
  build() {
    const L = this.L, n = L.n, T = this.theme, key = this.def.theme;
    const rnd = mulberry32(this.data.seed ^ 0x9e3779b9);
    const batch = new Batch();
    const pick = (w: Record<string, number>) => {
      const e = Object.entries(w);
      let r = rnd() * e.reduce((a, [, v]) => a + v, 0);
      for (const [k, v] of e) { r -= v; if (r <= 0) return k; }
      return e[0][0];
    };

    // heights: floor cells know their storey; solid cells borrow their nearest floor's
    for (let k = 0; k < n * n; k++) this.cellY[k] = L.floor[k] ? LEVEL_Y[L.level[k]] : -1;
    for (let pass = 0; pass < 4; pass++) {
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = j * n + i;
        if (this.cellY[k] >= 0) continue;
        for (let d = 0; d < 4; d++) {
          const ni = i + DX[d], nj = j + DZ[d];
          if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
          const v = this.cellY[nj * n + ni];
          if (v >= 0) { this.cellY[k] = v; break; }
        }
      }
    }
    for (let k = 0; k < n * n; k++) if (this.cellY[k] < 0) this.cellY[k] = LEVEL_Y[0];

    // the whole solid mass starts occupied; floors free
    this.occ.fill(1);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      if (!L.floor[j * n + i]) continue;
      for (let z = 1; z < CELL - 1; z++) for (let x = 1; x < CELL - 1; x++) this.occ[(j * CELL + z) * this.occN + i * CELL + x] = 0;
      // open the 1 m border toward passable neighbours so props can sit across cell seams
      for (let d = 0; d < 4; d++) {
        if (!passable(L, i, j, d)) continue;
        for (let t = 1; t < CELL - 1; t++) {
          const x = d === 1 ? CELL - 1 : d === 3 ? 0 : t, z = d === 2 ? CELL - 1 : d === 0 ? 0 : t;
          this.occ[(j * CELL + z) * this.occN + i * CELL + x] = 0;
        }
      }
      for (const [x, z] of [[0, 0], [CELL - 1, 0], [0, CELL - 1], [CELL - 1, CELL - 1]]) {
        const dx = x === 0 ? -1 : 1, dz = z === 0 ? -1 : 1;
        if (this.isFloor(i + dx, j) && this.isFloor(i, j + dz) && this.isFloor(i + dx, j + dz)) this.occ[(j * CELL + z) * this.occN + i * CELL + x] = 0;
      }
    }
    // corridors stay clear
    for (const c of L.corridors) for (const [i, j] of c.cells) this.reserve(this.cx(i), this.cz(j), 2.2);

    // ── floors
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (!L.floor[k]) continue;
      const y = LEVEL_Y[L.level[k]];
      const sd = L.stairDir[k];
      if (sd >= 0) {
        // stairs_walled: high end at local z=0, low end toward +z; origin on the upper edge
        const low = (sd + 2) % 4;
        const ex = this.cx(i) + DX[sd] * CELL / 2, ez = this.cz(j) + DZ[sd] * CELL / 2;
        batch.add('kaykit', 'stairs_walled', mat(ex, LEVEL_Y[1], ez, Math.atan2(DX[low], DZ[low])));
        continue;
      }
      const corridor = L.owner[k] < 0;
      const room = corridor ? null : L.rooms[L.owner[k]];
      const weights = corridor ? T.corridorFloor : room?.role === 'boss' || room?.role === 'hall' ? { floor_tile_large: 3, ...pickKeys(T.floor, 2) } : T.floor;
      const name = pick(weights);
      batch.add('kaykit', name, mat(this.cx(i), y, this.cz(j), Math.floor(rnd() * 4) * Math.PI / 2), false);
      if (name === 'floor_tile_big_grate' && T.dressing.includes('lava')) this.lavaCells.push([i, j]);
    }

    // ── walls (stacked twice on the lower storey so every wall top meets the rock cap)
    const doorEdge = new Set<number>();
    for (const d of L.doors) doorEdge.add((d.cell[1] * n + d.cell[0]) * 4 + d.dir);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (!L.floor[k]) continue;
      const lvl = L.level[k];
      const stair = L.stairDir[k] >= 0;
      for (let d = 0; d < 4; d++) {
        if (passable(L, i, j, d)) continue;
        const ex = this.cx(i) + DX[d] * CELL / 2, ez = this.cz(j) + DZ[d] * CELL / 2;
        const yaw = yawFor(d);
        if (stair) {
          if (d === L.stairDir[k] || d === (L.stairDir[k] + 2) % 4) continue;
          batch.add('kaykit', 'wall', mat(ex, LEVEL_Y[0], ez, yaw));
          continue;
        }
        const base = LEVEL_Y[lvl];
        const room = L.owner[k] >= 0 ? L.rooms[L.owner[k]] : null;
        const name = room ? pick(T.wall) : pick({ wall: 3, wall_cracked: 1 });
        batch.add('kaykit', name, mat(ex, base, ez, yaw));
        if (lvl === 1) batch.add('kaykit', rnd() < 0.3 ? 'wall_window_closed' : 'wall', mat(ex, base + WALL_H, ez, yaw));
      }
    }
    // door frames: open scaffold arches on every door edge (room side)
    for (const d of L.doors) {
      const [i, j] = d.cell;
      const lvl = L.level[j * n + i];
      const ex = this.cx(i) + DX[d.dir] * CELL / 2, ez = this.cz(j) + DZ[d.dir] * CELL / 2;
      batch.add('kaykit', 'wall_open_scaffold', mat(ex, LEVEL_Y[lvl], ez, yawFor(d.dir)));
      if (lvl === 1) batch.add('kaykit', 'wall', mat(ex, LEVEL_Y[1] + WALL_H, ez, yawFor(d.dir)));
    }

    // ── posts at wall corners and wall ends
    for (let vj = 0; vj <= n; vj++) for (let vi = 0; vi <= n; vi++) {
      const f = (i: number, j: number) => this.isFloor(i, j);
      const a = f(vi - 1, vj - 1), b = f(vi, vj - 1), c = f(vi - 1, vj), d = f(vi, vj);
      if (!(a || b || c || d)) continue;
      const north = a !== b, south = c !== d, west = a !== c, east = b !== d;
      const count = +north + +south + +west + +east;
      if (count === 0) continue;
      const straight = count === 2 && ((north && south) || (east && west));
      if (straight) continue;
      // the post stands on the floor of its adjacent cells (lowest storey wins so it reaches the cap)
      let lvl = 0;
      for (const [ci, cj] of [[vi - 1, vj - 1], [vi, vj - 1], [vi - 1, vj], [vi, vj]]) if (f(ci, cj) && L.level[cj * n + ci] === 1 && L.stairDir[cj * n + ci] < 0) lvl = 1;
      const x = this.origin.x + vi * CELL, z = this.origin.z + vj * CELL;
      batch.add('kaykit', 'pillar', mat(x, LEVEL_Y[lvl], z));
      if (lvl === 1) batch.add('kaykit', 'pillar', mat(x, LEVEL_Y[1] + WALL_H, z));
      this.posts.add(vj * (n + 1) + vi);
    }

    // ── rock cap over the solid mass (one merged mesh) and lava/water surfaces
    this.group.add(this.buildCap(rnd));

    // ── anchors, gates, dressing
    this.placeAnchors(rnd);
    const dresser: Dresser = {
      interior: this, batch, rnd, theme: T, themeKey: key,
      light: (pos, color, intensity, glowSize, kind = 'flame') => this.addLight(pos, color, intensity, glowSize, kind),
    };
    for (const room of L.rooms) dressRoom(dresser, room);
    this.dressCorridors(batch, rnd);
    this.exitStair(batch);

    if (this.lavaCells.length) this.buildLava();
    this.drawCalls = batch.build(this.group, key, T);
    this.group.add(this.glows.mesh, this.motes.points);
    if (T.shafts && this.shaftSpots.length) {
      this.shafts = new Shafts(T.shafts, this.shaftSpots);
      this.group.add(this.shafts.mesh);
    }
    this.group.updateMatrixWorld(true);
  }

  private lavaCells: [number, number][] = [];
  shaftSpots: { pos: THREE.Vector3; radius: number; height: number }[] = [];

  addLight(pos: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, glowSize: number, kind: 'flame' | 'halo' | 'orb' = 'flame') {
    const c = new THREE.Color(color);
    const glow = glowSize > 0 ? this.glows.add(pos, c, glowSize, kind, kind === 'flame' ? 2.6 : 1.6) : -1;
    if (glowSize > 0 && kind === 'flame') this.glows.add(pos.clone().add(new THREE.Vector3(0, 0.12, 0)), c, glowSize * 3.2, 'halo', 0.5);
    const room = this.roomAt(pos.x, pos.z);
    const l: Light = { pos: pos.clone(), color: c, intensity, glow, phase: this.lights.length * 1.37, on: true, room: room?.id ?? -1 };
    this.lights.push(l);
    return l;
  }

  private buildCap(rnd: () => number) {
    const L = this.L, n = L.n;
    let i0 = n, j0 = n, i1 = 0, j1 = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (L.floor[j * n + i]) { i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i); j1 = Math.max(j1, j); }
    i0 = Math.max(0, i0 - 3); j0 = Math.max(0, j0 - 3); i1 = Math.min(n - 1, i1 + 3); j1 = Math.min(n - 1, j1 + 3);
    const pos: number[] = [], idx: number[] = [];
    const vH = new Map<number, number>();
    const vid = new Map<number, number>();
    const vert = (vi: number, vj: number) => {
      const key = vj * (n + 1) + vi;
      let id = vid.get(key);
      if (id !== undefined) return id;
      const nearFloor = this.isFloor(vi - 1, vj - 1) || this.isFloor(vi, vj - 1) || this.isFloor(vi - 1, vj) || this.isFloor(vi, vj);
      const h = nearFloor ? 0 : 0.2 + rnd() * 1.4;
      vH.set(key, h);
      id = pos.length / 3;
      pos.push(this.origin.x + vi * CELL + (nearFloor ? 0 : (rnd() - 0.5) * 1.2), CAP_Y + h, this.origin.z + vj * CELL + (nearFloor ? 0 : (rnd() - 0.5) * 1.2));
      vid.set(key, id);
      return id;
    };
    const exitK = this.L.exit.j + 1;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (L.floor[j * n + i]) continue;
      if (i === this.L.exit.i && j === exitK) continue; // the way out stays open to the surface
      const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const col = new THREE.Color().setHSL(this.theme.stone.h, this.theme.stone.s * 0.6, 0.1 * this.theme.stone.l);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col, roughness: 1, flatShading: true }));
    m.receiveShadow = true;
    m.name = 'rock-cap';
    return m;
  }

  private buildLava() {
    const pos: number[] = [];
    for (const [i, j] of this.lavaCells) {
      const y = LEVEL_Y[this.L.level[j * this.L.n + i]] - 0.8;
      const x0 = this.origin.x + i * CELL + 0.3, z0 = this.origin.z + j * CELL + 0.3, x1 = x0 + CELL - 0.6, z1 = z0 + CELL - 0.6;
      pos.push(x0, y, z0, x0, y, z1, x1, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
      this.addLight(new THREE.Vector3((x0 + x1) / 2, y + 0.9, (z0 + z1) / 2), this.theme.glow, this.theme.torchIntensity * 0.6, 0, 'halo');
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = surfaceMaterial('lava', '#ff6a1a', '#2a0a04');
    this.surfaces.push(m);
    this.group.add(new THREE.Mesh(g, m));
  }

  /** Flooded floors (chapel, grotto): one merged translucent sheet over chosen cells. */
  addWater(cells: [number, number][], color = '#2a8aa8', deep = '#06202a') {
    if (!cells.length) return;
    const pos: number[] = [];
    for (const [i, j] of cells) {
      const y = LEVEL_Y[this.L.level[j * this.L.n + i]] + 0.12;
      const x0 = this.origin.x + i * CELL, z0 = this.origin.z + j * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
      pos.push(x0, y, z0, x0, y, z1, x1, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = surfaceMaterial('water', color, deep);
    this.surfaces.push(m);
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = 3;
    this.group.add(mesh);
  }

  /** Glowing rune circle decal on the floor. */
  addDecal(pos: THREE.Vector3, size: number, color: THREE.ColorRepresentation, opacity = 0.6) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: poolTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.copy(pos).add(new THREE.Vector3(0, 0.08, 0));
    m.renderOrder = 2;
    this.group.add(m);
    return m;
  }

  // ── Anchors: where gameplay objects go (reserved before dressing) ──────────────────────────
  private placeAnchors(rnd: () => number) {
    const L = this.L, n = L.n, A = this.anchors;
    const hall = L.rooms[0];
    // spawn: just inside the entrance stair, facing into the hall
    A.spawn.pos.set(this.cx(L.spawn.i), LEVEL_Y[0], this.cz(L.spawn.j) + 1.2);
    A.spawn.yaw = Math.PI; // camera yaw: behind the player looking north
    A.exit.pos.set(this.cx(L.exit.i), LEVEL_Y[0], this.cz(L.exit.j) + 1.2);
    A.exit.yaw = 0;
    this.reserve(A.exit.pos.x, A.exit.pos.z, 2.6);
    this.reserve(A.spawn.pos.x, A.spawn.pos.z - 2, 2.2);
    // spring and lore tablet sit left/right of the hall's centre line
    const hc = this.roomCenter(hall);
    A.spring.set(hc.x - CELL * 1.25, LEVEL_Y[0], hc.z - CELL * 0.4);
    this.reserve(A.spring.x, A.spring.z, 2.2);
    A.lore.pos.set(hc.x + CELL * 1.6, LEVEL_Y[0], hc.z + CELL * 0.6);
    A.lore.yaw = -Math.PI / 2;
    this.reserve(A.lore.pos.x, A.lore.pos.z, 1.4);

    // door approaches stay clear
    for (const d of L.doors) {
      this.reserve(this.cx(d.cell[0]), this.cz(d.cell[1]), 2.2);
      this.reserve(this.cx(d.cell[0]) - DX[d.dir] * CELL * 0.6, this.cz(d.cell[1]) - DZ[d.dir] * CELL * 0.6, 1.6);
    }

    // gates on puzzle-sealed doors
    for (const d of L.doors) {
      if (d.gate < 0) continue;
      const [i, j] = d.cell;
      const ex = this.cx(i) + DX[d.dir] * CELL / 2, ez = this.cz(j) + DZ[d.dir] * CELL / 2;
      const boss = L.rooms[d.to].role === 'boss';
      A.gates.push({ door: d, pos: new THREE.Vector3(ex, LEVEL_Y[L.level[j * n + i]], ez), yaw: yawFor(d.dir), axis: d.dir % 2 === 0 ? 'x' : 'z', puzzle: d.gate, boss, y: LEVEL_Y[L.level[j * n + i]] });
    }

    // puzzles
    for (const rid of L.puzzleRooms) {
      const room = L.rooms[rid];
      const gate = L.doors.find((d) => d.room === rid && d.gate === room.puzzleIndex) ?? null;
      const spots = this.puzzleSpots(room, room.puzzle!, gate, rnd);
      const hint = room.puzzle === 'runes' ? this.wallSpot(room, rnd, gate) : null;
      A.puzzles.push({ index: room.puzzleIndex!, room, kind: room.puzzle!, gate, spots, hint });
    }

    // boss: the dais at the far end of the chamber from its entry door
    const boss = L.rooms.find((r) => r.role === 'boss')!;
    const entry = L.doors.find((d) => d.room === boss.id)!;
    const fwd = new THREE.Vector3(-DX[entry.dir], 0, -DZ[entry.dir]);
    const bc = this.roomCenter(boss);
    A.boss.room = boss;
    A.boss.center.copy(bc).addScaledVector(fwd, -1.5);
    A.boss.forward.copy(fwd);
    A.boss.pos.copy(bc).addScaledVector(fwd, CELL * 2.2);
    A.boss.yaw = Math.atan2(-fwd.x, -fwd.z);
    A.portal.pos.copy(bc).addScaledVector(fwd, CELL * 2.9);
    A.portal.yaw = A.boss.yaw;
    this.reserve(A.boss.pos.x, A.boss.pos.z, 5);
    this.reserve(bc.x, bc.z, 7);

    // chests
    const used = new Set<number>();
    const chestIn = (room: Room | undefined, def: ChestDef, key: string) => {
      if (!room) return false;
      const s = this.wallSpot(room, rnd, null, 1.3, true);
      if (!s) return false;
      A.chests.push({ pos: s.pos, yaw: s.yaw, def, key, room: room.id });
      this.reserve(s.pos.x, s.pos.z, 1.4);
      return true;
    };
    const firstGate = L.doors.filter((d) => d.gate >= 0).sort((a, b) => a.gate - b.gate)[0];
    this.data.chests.forEach((c, ci) => {
      const key = `c${ci}`;
      if (c.room === 'boss') {
        const p = A.boss.pos.clone().addScaledVector(fwd, -3.5);
        A.chests.push({ pos: p, yaw: A.boss.yaw + Math.PI, def: c, key, room: boss.id });
        return;
      }
      let room: Room | undefined;
      if (c.room === 'hall') room = hall;
      else if (c.room === 'treasure') room = L.rooms.find((r) => r.role === 'treasure');
      else if (c.room === 'puzzle') room = firstGate ? L.rooms[firstGate.to] : undefined;
      else room = L.rooms.find((r) => r.role === 'side' && !used.has(r.id));
      if (room) used.add(room.id);
      if (!chestIn(room, c, key)) chestIn(L.rooms.find((r) => r.role === 'combat' && !used.has(r.id)) ?? hall, c, key);
    });

    // mystics: sentries and patrols in combat rooms, guards for treasure and side rooms
    for (const room of L.rooms) {
      if (room.role === 'hall' || room.role === 'boss') continue;
      const c = this.roomCenter(room);
      const b = this.roomBounds(room, 3.2);
      const count = room.role === 'combat' ? (room.w * room.h >= 30 ? 3 : 2) : 1;
      for (let m = 0; m < count; m++) {
        const patrol = room.role === 'combat' && m === 0 && room.w >= 5 && room.h >= 5;
        let pos = c.clone();
        for (let t = 0; t < 20; t++) {
          const x = THREE.MathUtils.lerp(b.x0, b.x1, 0.15 + rnd() * 0.7), z = THREE.MathUtils.lerp(b.z0, b.z1, 0.15 + rnd() * 0.7);
          if (A.mystics.some((q) => q.pos.distanceTo(new THREE.Vector3(x, q.pos.y, z)) < 5)) continue;
          pos = new THREE.Vector3(x, LEVEL_Y[room.level], z);
          break;
        }
        A.mystics.push({
          pos, room: room.id, rare: room.role === 'treasure' || (room.role === 'side' && rnd() < 0.5) || rnd() < 0.12, guard: room.role !== 'combat',
          patrol: patrol ? [new THREE.Vector3(b.x0, 0, b.z0), new THREE.Vector3(b.x1, 0, b.z0), new THREE.Vector3(b.x1, 0, b.z1), new THREE.Vector3(b.x0, 0, b.z1)].map((p) => p.setY(LEVEL_Y[room.level])) : null,
        });
      }
    }
  }

  /** A free spot against one of the room's walls (not beside a door), facing into the room. */
  wallSpot(room: Room, rnd: () => number, avoid: Door | null, clearance = 1.1, farFromDoor = false): { pos: THREE.Vector3; yaw: number; d: number } | null {
    const slots = this.wallSlots(room);
    const doorCells = this.L.doors.filter((d) => d.room === room.id).map((d) => d.cell);
    let best: { pos: THREE.Vector3; yaw: number; d: number } | null = null, bestScore = -Infinity;
    for (let t = 0; t < slots.length; t++) {
      const s = slots[(t + Math.floor(rnd() * slots.length)) % slots.length];
      const p = s.pos.clone().addScaledVector(new THREE.Vector3(-DX[s.d], 0, -DZ[s.d]), clearance);
      if (!this.isFree(p.x, p.z, clearance * 0.8)) continue;
      const doorDist = Math.min(...doorCells.map(([i, j]) => Math.hypot(this.cx(i) - p.x, this.cz(j) - p.z)));
      if (doorDist < CELL * 1.2) continue;
      if (avoid && Math.hypot(this.cx(avoid.cell[0]) - p.x, this.cz(avoid.cell[1]) - p.z) < CELL * 1.5) continue;
      const score = farFromDoor ? doorDist + rnd() : rnd();
      if (score > bestScore) { bestScore = score; best = { pos: p, yaw: yawFor(s.d), d: s.d }; }
    }
    return best;
  }

  /** Wall slots of a room: the inner face midpoint of every wall edge. */
  wallSlots(room: Room) {
    const out: { i: number; j: number; d: number; pos: THREE.Vector3 }[] = [];
    for (let j = room.y; j < room.y + room.h; j++) for (let i = room.x; i < room.x + room.w; i++) {
      for (let d = 0; d < 4; d++) {
        if (passable(this.L, i, j, d)) continue;
        const ni = i + DX[d], nj = j + DZ[d];
        if (this.isFloor(ni, nj)) continue;
        out.push({ i, j, d, pos: new THREE.Vector3(this.cx(i) + DX[d] * (CELL / 2 - WALL_HALF), LEVEL_Y[room.level], this.cz(j) + DZ[d] * (CELL / 2 - WALL_HALF)) });
      }
    }
    return out;
  }

  private puzzleSpots(room: Room, kind: DungeonData['puzzles'][number], gate: Door | null, rnd: () => number) {
    const c = this.roomCenter(room);
    const y = LEVEL_Y[room.level];
    const spots: { pos: THREE.Vector3; yaw: number }[] = [];
    const b = this.roomBounds(room, 0);
    if (kind === 'lever') {
      // on the wall farthest from the gate, so the room has to be crossed
      const s = this.wallSpot(room, rnd, gate, 0.4, true);
      if (s) { spots.push({ pos: s.pos, yaw: s.yaw }); this.reserve(s.pos.x, s.pos.z, 1.6); }
    } else if (kind === 'braziers') {
      const inset = 3.4;
      for (const [fx, fz] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const x = fx ? b.x1 - inset : b.x0 + inset, z = fz ? b.z1 - inset : b.z0 + inset;
        spots.push({ pos: new THREE.Vector3(x, y, z), yaw: Math.atan2(c.x - x, c.z - z) });
        this.reserve(x, z, 1.6);
      }
    } else if (kind === 'runes') {
      const s = 2.6;
      for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        spots.push({ pos: new THREE.Vector3(c.x + ox * s, y, c.z + oz * s), yaw: 0 });
      }
      this.reserve(c.x, c.z, 5);
    } else {
      // push: a block two cells from its plate, on a straight line through the room centre
      const axis = room.w >= room.h ? 0 : 1;
      const dirv = axis === 0 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      const start = c.clone().addScaledVector(dirv, -CELL * 0.5);
      const plate = c.clone().addScaledVector(dirv, CELL * 1.5);
      spots.push({ pos: start, yaw: axis }, { pos: plate, yaw: axis });
      for (let t = -1.5; t <= 2.5; t += 0.5) { const p = c.clone().addScaledVector(dirv, CELL * t); this.reserve(p.x, p.z, 1.8); }
    }
    return spots;
  }

  private dressCorridors(batch: Batch, rnd: () => number) {
    const L = this.L, n = L.n, T = this.theme;
    for (const cor of L.corridors) {
      cor.cells.forEach(([i, j], k) => {
        if (L.stairDir[j * n + i] >= 0) return;
        if (k % 2 === 1 && cor.cells.length > 1) return;
        const side = (cor.dir + (k % 4 === 0 ? 1 : 3)) % 4;
        if (passable(L, i, j, side)) return;
        const lvl = L.level[j * n + i];
        const wx = this.cx(i) + DX[side] * (CELL / 2 - WALL_HALF), wz = this.cz(j) + DZ[side] * (CELL / 2 - WALL_HALF);
        const yaw = yawFor(side);
        batch.add('kaykit', 'torch_mounted', mat(wx, LEVEL_Y[lvl] + 2.25, wz, yaw), false);
        const f = new THREE.Vector3(wx - DX[side] * 0.34, LEVEL_Y[lvl] + 2.88, wz - DZ[side] * 0.34);
        this.addLight(f, T.torch, T.torchIntensity * 0.8, 0.5);
        if (rnd() < 0.25) batch.add('quaternius', 'cobweb', mat(this.cx(i) + DX[side] * 1.4, LEVEL_Y[lvl] + 3.2, this.cz(j) + DZ[side] * 1.4, yaw, 1.4), false);
      });
    }
  }

  /** The hall's way out: a stair climbing south into daylight. */
  private exitStair(batch: Batch) {
    const { i, j } = this.L.exit;
    const x = this.cx(i), z0 = this.cz(j) + CELL / 2;
    batch.add('kaykit', 'stairs', mat(x, LEVEL_Y[0], z0 + CELL, Math.PI));
    const top = new THREE.Vector3(x, LEVEL_Y[0] + WALL_H + 0.6, z0 + CELL * 0.95);
    this.glows.add(top, '#fff2d0', 7, 'halo', 1.1);
    this.shaftSpots.push({ pos: new THREE.Vector3(x, LEVEL_Y[0] - 0.2, z0 + 0.8), radius: 1.7, height: 11 });
    this.addLight(new THREE.Vector3(x, LEVEL_Y[0] + 2.2, z0 + 0.6), '#ffe8c0', 18, 0, 'halo');
  }

  /** Per-frame effect animation. */
  update(t: number, player: THREE.Vector3, fogDensity: number) {
    this.glows.update(t, fogDensity);
    this.motes.update(t, player, this.floorY(player.x, player.z));
    this.shafts?.update(t);
    for (const m of this.surfaces) m.uniforms.uTime.value = t;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh && !(o as THREE.Points).isPoints) return;
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      else if (m.name === 'rock-cap' || !(m.geometry as THREE.BufferGeometry & { _kit?: boolean })._kit) {
        // kit geometries are shared by the cache; only procedural ones are ours
        if (m.name === 'rock-cap') m.geometry.dispose();
      }
    });
    this.glows.dispose();
    this.motes.dispose();
    this.shafts?.dispose();
    for (const m of this.surfaces) m.dispose();
  }
}

function pushBox(x: number, z: number, r: number, b: Box2): [number, number] {
  const x0 = b.x0 - r, x1 = b.x1 + r, z0 = b.z0 - r, z1 = b.z1 + r;
  if (x <= x0 || x >= x1 || z <= z0 || z >= z1) return [x, z];
  const dl = x - x0, dr = x1 - x, dt = z - z0, db = z1 - z;
  const m = Math.min(dl, dr, dt, db);
  if (m === dl) return [x0, z];
  if (m === dr) return [x1, z];
  if (m === dt) return [x, z0];
  return [x, z1];
}

function pickKeys(w: Record<string, number>, scale: number) {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(w)) out[k] = v / scale;
  return out;
}
