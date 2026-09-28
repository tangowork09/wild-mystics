import { mulberry32 } from '../../core/noise';
import type { DungeonData, PuzzleKind } from '../../data/dungeons';

// Deterministic dungeon layouts (v3:dungeons). A dungeon is a room graph grown on a grid of 4 m
// cells (the KayKit module): an entrance hall, a spine of rooms joined by straight corridors, the
// boss chamber at the end of the spine, and branch rooms (treasure, side rooms). Every room and
// corridor keeps at least one solid cell between itself and anything else, so walls always
// separate them and puzzle gates can't be bypassed. The same seed always gives the same layout.

export const CELL = 4;
export const GRID = 44;
/** Floor height of storey 0 (upper) and storey 1 (lower, reached by a stair). */
export const LEVEL_Y = [6, 2] as const;
export const WALL_H = 4;
/** N E S W — north is −z. */
export const DX = [0, 1, 0, -1];
export const DZ = [-1, 0, 1, 0];

export type RoomRole = 'hall' | 'combat' | 'puzzle' | 'treasure' | 'side' | 'boss';

export interface Room {
  id: number;
  x: number; y: number; w: number; h: number;
  role: RoomRole;
  level: 0 | 1;
  /** Index along the spine (hall 0 … boss), −1 for branch rooms. */
  spine: number;
  parent: number;
  puzzle?: PuzzleKind;
  puzzleIndex?: number;
  doors: number[];
}

export interface Door {
  id: number;
  /** Room this door opens from. */
  room: number;
  /** Room at the other end of the corridor. */
  to: number;
  /** Room edge cell and the corridor cell beside it. */
  cell: [number, number];
  outer: [number, number];
  /** Direction from `cell` to `outer`. */
  dir: number;
  /** Puzzle index that seals this door, or −1. */
  gate: number;
  corridor: number;
}

export interface Corridor { id: number; cells: [number, number][]; dir: number; from: number; to: number; stair: number }

export interface Layout {
  id: string;
  n: number;
  floor: Uint8Array;
  level: Uint8Array;
  /** Room id, or −(corridor id + 1) for corridor cells, or −32768 for solid. */
  owner: Int16Array;
  /** Stair cells: direction toward the upper end, else −1. */
  stairDir: Int8Array;
  rooms: Room[];
  doors: Door[];
  corridors: Corridor[];
  /** Spawn cell in the hall (just inside the entrance stair) and the facing direction. */
  spawn: { i: number; j: number; dir: number };
  /** The hall's entrance stair: edge cell and the direction of the wall it's set in. */
  exit: { i: number; j: number; dir: number };
  puzzleRooms: number[];
}

const SOLID = -32768;

interface Rect { x: number; y: number; w: number; h: number }

class Grower {
  floor = new Uint8Array(GRID * GRID);
  level = new Uint8Array(GRID * GRID);
  owner = new Int16Array(GRID * GRID).fill(SOLID);
  stairDir = new Int8Array(GRID * GRID).fill(-1);
  rooms: Room[] = [];
  doors: Door[] = [];
  corridors: Corridor[] = [];

  constructor(private rnd: () => number) {}

  idx(i: number, j: number) { return j * GRID + i; }
  inside(i: number, j: number) { return i >= 1 && j >= 1 && i < GRID - 1 && j < GRID - 1; }
  isFloor(i: number, j: number) { return i >= 0 && j >= 0 && i < GRID && j < GRID && this.floor[this.idx(i, j)] === 1; }

  /** A rect is free if it and a one-cell margin around it hold no floor. */
  free(r: Rect) {
    if (!this.inside(r.x, r.y) || !this.inside(r.x + r.w - 1, r.y + r.h - 1)) return false;
    for (let j = r.y - 1; j <= r.y + r.h; j++) for (let i = r.x - 1; i <= r.x + r.w; i++) if (this.isFloor(i, j)) return false;
    return true;
  }

  addRoom(r: Rect, role: RoomRole, level: 0 | 1, spine: number, parent: number): Room {
    const room: Room = { id: this.rooms.length, ...r, role, level, spine, parent, doors: [] };
    this.rooms.push(room);
    for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) {
      const k = this.idx(i, j);
      this.floor[k] = 1; this.level[k] = level; this.owner[k] = room.id;
    }
    return room;
  }

  /**
   * Grow a new w×h room off `parent` in `dir`, joined by a straight corridor of `len` cells.
   * Returns null when it doesn't fit.
   */
  tryAttach(parent: Room, w: number, h: number, dir: number, len: number): { rect: Rect; corr: [number, number][]; door: [number, number]; entry: [number, number] } | null {
    const edge = dir % 2 === 0 ? parent.w : parent.h;
    if (edge < 3) return null;
    const o = 1 + Math.floor(this.rnd() * (edge - 2));
    let di: number, dj: number;
    if (dir === 0) { di = parent.x + o; dj = parent.y; }
    else if (dir === 2) { di = parent.x + o; dj = parent.y + parent.h - 1; }
    else if (dir === 1) { di = parent.x + parent.w - 1; dj = parent.y + o; }
    else { di = parent.x; dj = parent.y + o; }
    const corr: [number, number][] = [];
    for (let k = 1; k <= len; k++) corr.push([di + DX[dir] * k, dj + DZ[dir] * k]);
    const ei = di + DX[dir] * (len + 1), ej = dj + DZ[dir] * (len + 1);
    const nEdge = dir % 2 === 0 ? w : h;
    const q = 1 + Math.floor(this.rnd() * (nEdge - 2));
    let x: number, y: number;
    if (dir === 0) { x = ei - q; y = ej - (h - 1); }
    else if (dir === 2) { x = ei - q; y = ej; }
    else if (dir === 1) { x = ei; y = ej - q; }
    else { x = ei - (w - 1); y = ej - q; }
    const rect = { x, y, w, h };
    if (!this.free(rect)) return null;
    // corridor cells must be solid now and flanked by solid cells (no accidental side openings)
    const px = DX[(dir + 1) % 4], pz = DZ[(dir + 1) % 4];
    for (const [ci, cj] of corr) {
      if (!this.inside(ci, cj) || this.isFloor(ci, cj)) return null;
      if (this.isFloor(ci + px, cj + pz) || this.isFloor(ci - px, cj - pz)) return null;
      if (inRect(ci + px, cj + pz, rect) || inRect(ci - px, cj - pz, rect)) return null;
    }
    // the corridor may only touch its own two rooms
    const [li, lj] = corr[corr.length - 1];
    const beyond = [li + DX[dir], lj + DZ[dir]];
    if (!inRect(beyond[0], beyond[1], rect)) return null;
    return { rect, corr, door: [di, dj], entry: [ei, ej] };
  }

  link(parent: Room, child: Room, p: { corr: [number, number][]; door: [number, number]; entry: [number, number] }, dir: number, stair: boolean) {
    const cid = this.corridors.length;
    const corr: Corridor = { id: cid, cells: p.corr, dir, from: parent.id, to: child.id, stair: stair ? 0 : -1 };
    this.corridors.push(corr);
    p.corr.forEach(([i, j], k) => {
      const x = this.idx(i, j);
      this.floor[x] = 1;
      this.owner[x] = -(cid + 1);
      // before the stair the corridor keeps the parent's storey, after it the child's
      this.level[x] = stair ? 1 : parent.level;
      if (stair && k === 0) this.stairDir[x] = (dir + 2) % 4;
    });
    const a: Door = { id: this.doors.length, room: parent.id, to: child.id, cell: p.door, outer: p.corr[0], dir, gate: -1, corridor: cid };
    this.doors.push(a);
    parent.doors.push(a.id);
    const b: Door = { id: this.doors.length, room: child.id, to: parent.id, cell: p.entry, outer: p.corr[p.corr.length - 1], dir: (dir + 2) % 4, gate: -1, corridor: cid };
    this.doors.push(b);
    child.doors.push(b.id);
    return a;
  }
}

const inRect = (i: number, j: number, r: Rect) => i >= r.x && j >= r.y && i < r.x + r.w && j < r.y + r.h;

function weightedDir(rnd: () => number, weights: number[]) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (let d = 0; d < 4; d++) { r -= weights[d]; if (r <= 0) return d; }
  return 0;
}

/** Build the layout for a dungeon. Deterministic: the same data always yields the same layout. */
export function generateLayout(data: DungeonData): Layout {
  for (let attempt = 0; attempt < 60; attempt++) {
    const out = tryGenerate(data, attempt);
    if (out) return out;
  }
  // should never happen with a 44-cell grid; fall back to a straight line of rooms
  return tryGenerate({ ...data, rooms: 4 }, 999, true)!;
}

function tryGenerate(data: DungeonData, attempt: number, straight = false): Layout | null {
  const rnd = mulberry32((data.seed * 7919 + attempt * 104729) >>> 0);
  const g = new Grower(rnd);
  const R = Math.max(3, Math.min(7, data.rooms));
  const hall = g.addRoom({ x: Math.floor(GRID / 2) - 2, y: GRID - 7, w: 5, h: 5 }, 'hall', 0, 0, -1);
  const spine: Room[] = [hall];
  const stairAt = data.stair ? R : -1; // the corridor into spine[stairAt] descends
  let lastDir = 0;
  for (let k = 1; k <= R + 1; k++) {
    const boss = k === R + 1;
    const parent = spine[k - 1];
    const level: 0 | 1 = data.stair && k >= stairAt ? 1 : 0;
    const stair = k === stairAt;
    let placed = false;
    for (let t = 0; t < 70 && !placed; t++) {
      const w = boss ? 7 : 5 + Math.floor(rnd() * 2);
      const h = boss ? 7 : 5 + Math.floor(rnd() * 2);
      // mostly north (away from the entrance), turning east/west; never straight back south
      const weights = straight ? [1, 0, 0, 0] : [3, 1.4, 0, 1.4];
      if (lastDir === 1) weights[3] = 0.2; else if (lastDir === 3) weights[1] = 0.2;
      const dir = weightedDir(rnd, weights);
      const len = stair ? 2 + Math.floor(rnd() * 2) : 1 + Math.floor(rnd() * 3);
      const p = g.tryAttach(parent, w, h, dir, len);
      if (!p) continue;
      const room = g.addRoom(p.rect, boss ? 'boss' : 'combat', level, k, parent.id);
      g.link(parent, room, p, dir, stair);
      spine.push(room);
      lastDir = dir;
      placed = true;
    }
    if (!placed) return null;
  }

  // puzzles: the last one seals the boss door, the rest spread along the spine
  const P = data.puzzles.length;
  const puzzleRooms: number[] = [];
  data.puzzles.forEach((kind, i) => {
    const k = i === P - 1 ? R : Math.min(R - 1, 1 + Math.floor(((i + 1) * (R - 1)) / P));
    const host = spine[k];
    if (host.puzzle) return;
    host.role = 'puzzle';
    host.puzzle = kind;
    host.puzzleIndex = i;
    puzzleRooms.push(host.id);
    const next = spine[k + 1];
    const door = g.doors.find((d) => d.room === host.id && d.to === next.id);
    if (door) door.gate = i;
  });

  // branches: the treasure room, then side rooms for the side chests (+1 optional den)
  const sideCount = data.chests.filter((c) => c.room === 'side').length + 1;
  const branchRoles: RoomRole[] = ['treasure', ...Array<RoomRole>(sideCount).fill('side')];
  branchRoles.forEach((role, bi) => {
    const hosts = spine.slice(0, R + 1).filter((r) => (role === 'treasure' ? r.spine >= 2 : true));
    for (let t = 0; t < 120; t++) {
      const host = hosts[Math.floor(rnd() * hosts.length)];
      if (host.doors.length >= 4) continue;
      const w = role === 'treasure' ? 4 : 3 + Math.floor(rnd() * 2);
      const h = role === 'treasure' ? 4 : 3 + Math.floor(rnd() * 2);
      const dir = Math.floor(rnd() * 4);
      if (host.role === 'hall' && dir === 2) continue;
      const p = g.tryAttach(host, w, h, dir, 1 + Math.floor(rnd() * 2));
      if (!p) continue;
      const room = g.addRoom(p.rect, role, host.level, -1, host.id);
      g.link(host, room, p, dir, false);
      if (bi === branchRoles.length - 1 && role === 'side') room.role = 'combat';
      return;
    }
  });

  // entrance stair: middle of the hall's south wall
  const exit = { i: hall.x + 2, j: hall.y + hall.h - 1, dir: 2 };
  const spawn = { i: exit.i, j: exit.j - 1, dir: 0 };
  return {
    id: data.id, n: GRID, floor: g.floor, level: g.level, owner: g.owner, stairDir: g.stairDir,
    rooms: g.rooms, doors: g.doors, corridors: g.corridors, spawn, exit, puzzleRooms,
  };
}

/** Can you walk from floor cell a to its neighbour in direction d? (storeys, stairs) */
export function passable(L: Layout, i: number, j: number, d: number): boolean {
  const ni = i + DX[d], nj = j + DZ[d];
  if (ni < 0 || nj < 0 || ni >= L.n || nj >= L.n) return false;
  const a = j * L.n + i, b = nj * L.n + ni;
  if (!L.floor[a] || !L.floor[b]) return false;
  const sa = L.stairDir[a], sb = L.stairDir[b];
  if (sa >= 0) {
    if (d === sa) return L.level[b] === 0 && L.stairDir[b] < 0;
    if (d === (sa + 2) % 4) return L.level[b] === 1 || L.stairDir[b] >= 0;
    return false;
  }
  if (sb >= 0) {
    if ((d + 2) % 4 === sb) return L.level[a] === 0;
    if (d === sb) return L.level[a] === 1;
    return false;
  }
  return L.level[a] === L.level[b];
}
