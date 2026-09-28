import * as THREE from 'three';
import type { DressingKind, ThemeStyle, DungeonTheme } from '../../data/dungeons';
import { CELL, DX, DZ, LEVEL_Y, WALL_H, type Room } from './layout';
import type { KitId } from './kit';
import type { ProcKind } from './procprops';
import { mat, yawFor, WALL_HALF, type Batch, type Interior, type Light } from './interior';

// Room dressing (v3:dungeons): wall lights, banners, theme clusters along the walls, pillars in
// big rooms, the boss dais and nave. Props hug the walls so the middle of every room stays clear
// for patrols and battles. All choices come from the dungeon's seeded RNG.

export interface Dresser {
  interior: Interior;
  batch: Batch;
  rnd: () => number;
  theme: ThemeStyle;
  themeKey: DungeonTheme;
  light: (pos: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, glowSize: number, kind?: 'flame' | 'halo' | 'orb') => Light;
}

interface Slot { i: number; j: number; d: number; pos: THREE.Vector3 }

export function dressRoom(D: Dresser, room: Room) {
  const I = D.interior, T = D.theme, rnd = D.rnd;
  const y = LEVEL_Y[room.level];
  const slots = shuffle(I.wallSlots(room), rnd);
  const doorCells = I.L.doors.filter((d) => d.room === room.id).map((d) => d.cell);
  const nearDoor = (s: Slot) => doorCells.some(([i, j]) => Math.abs(i - s.i) + Math.abs(j - s.j) <= 1);
  const used = new Set<Slot>();

  // helpers: t = along the wall, n = into the room
  const frame = (s: Slot) => ({ t: new THREE.Vector3(DX[(s.d + 1) % 4], 0, DZ[(s.d + 1) % 4]), n: new THREE.Vector3(-DX[s.d], 0, -DZ[s.d]), yaw: yawFor(s.d) });
  const at = (s: Slot, along: number, inward: number) => { const f = frame(s); return s.pos.clone().addScaledVector(f.t, along).addScaledVector(f.n, inward); };
  const put = (kit: KitId, name: string, p: THREE.Vector3, yaw: number, o: { y?: number; s?: number; col?: number; res?: number; shadow?: boolean; force?: boolean } = {}) => {
    const r = o.res ?? (o.col ? o.col + 0.2 : 0.7);
    if (!o.force && !I.isFree(p.x, p.z, r)) return false;
    D.batch.add(kit, name, mat(p.x, o.y ?? y, p.z, yaw, o.s ?? 1), o.shadow ?? true);
    if (o.col) I.addCollider({ x: p.x, z: p.z, r: o.col });
    I.reserve(p.x, p.z, r);
    return true;
  };
  const proc = (kind: ProcKind, p: THREE.Vector3, yaw: number, o: { s?: number; col?: number; res?: number; force?: boolean; y?: number } = {}) => {
    const r = o.res ?? (o.col ? o.col + 0.2 : 0.7);
    if (!o.force && !I.isFree(p.x, p.z, r)) return false;
    D.batch.proc(kind, mat(p.x, o.y ?? y, p.z, yaw, o.s ?? 1));
    if (o.col) I.addCollider({ x: p.x, z: p.z, r: o.col });
    I.reserve(p.x, p.z, r);
    return true;
  };

  // ── wall lights: every other wall edge (crystal themes grow light from the floor instead)
  const perimeter = slots.length;
  let lights = 0;
  for (const s of slots) {
    if ((s.i + s.j + s.d) % 2 !== 0) continue;
    if (lights >= Math.max(3, Math.round(perimeter * 0.42))) break;
    used.add(s);
    lights++;
    const f = frame(s);
    if (T.lamp === 'crystal' && !nearDoor(s)) {
      const p = at(s, 0, 0.9);
      if (proc(rnd() < 0.3 ? 'crystal_big' : 'crystals', p, rnd() * Math.PI * 2, { col: 0.6, res: 0.9 })) {
        D.light(p.clone().setY(y + 1.4), T.torch, T.torchIntensity, 0.9, 'orb');
        continue;
      }
    }
    D.batch.add('kaykit', 'torch_mounted', mat(s.pos.x, y + 2.25, s.pos.z, f.yaw), false);
    D.light(s.pos.clone().addScaledVector(f.n, 0.34).setY(y + 2.88), T.torch, T.torchIntensity, 0.5);
  }

  // ── banners on two free walls
  if (T.banner && room.role !== 'side') {
    const kinds = ['banner_patternA', 'banner_shield', 'banner_thin', 'banner_triple'];
    let placed = 0;
    for (const s of slots) {
      if (used.has(s) || nearDoor(s) || placed >= (room.role === 'boss' ? 4 : room.role === 'hall' ? 2 : 1)) continue;
      used.add(s);
      const f = frame(s);
      const edge = s.pos.clone().addScaledVector(f.n, -WALL_HALF);
      const kind = kinds[Math.floor(rnd() * kinds.length)];
      const name = `${kind}_${T.banner}`;
      D.batch.add('kaykit', name, mat(edge.x, y, edge.z, f.yaw), false);
      placed++;
    }
  }

  // ── room-type features
  if (room.role === 'hall') dressHall(D, room, put, proc);
  if (room.role === 'boss') dressBoss(D, room, put, proc);
  if (room.role === 'treasure') {
    const c = I.roomCenter(room);
    proc('gold_pile', c.clone().add(new THREE.Vector3(1.2, 0, -1.2)), rnd() * 6, { s: 1.1, col: 1.1 });
    put('kaykit', 'coin_stack_large', c.clone().add(new THREE.Vector3(-1.4, 0, 0.8)), rnd() * 6, { col: 0.7 });
    put('kaykit', 'coin_stack_medium', c.clone().add(new THREE.Vector3(1.6, 0, 1.4)), rnd() * 6, { col: 0.5 });
    D.light(c.clone().setY(y + 1.2), '#ffd27a', T.torchIntensity * 0.7, 0, 'halo');
    I.addDecal(c, 7, '#ffcc66', 0.35);
  }

  // big rooms: four inset pillars
  if (room.role !== 'boss' && room.role !== 'hall' && room.w >= 6 && room.h >= 5 && room.role !== 'puzzle') {
    const b = I.roomBounds(room, 0);
    for (const [fx, fz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const p = new THREE.Vector3(fx ? b.x1 - CELL : b.x0 + CELL, y, fz ? b.z1 - CELL : b.z0 + CELL);
      put('kaykit', 'pillar_decorated', p, fx ? -Math.PI / 2 : Math.PI / 2, { col: 1.0, res: 1.2 });
    }
  }

  // ── theme clusters along the walls
  const kinds = T.dressing.filter((k) => k !== 'water' && k !== 'lava');
  const clusters = room.role === 'combat' ? 4 : room.role === 'puzzle' ? 2 : room.role === 'side' || room.role === 'treasure' ? 3 : room.role === 'hall' ? 2 : 3;
  let made = 0;
  for (const s of slots) {
    if (made >= clusters) break;
    if (used.has(s) || nearDoor(s)) continue;
    used.add(s);
    const kind: DressingKind = room.role === 'treasure' && made === 0 ? 'treasure' : kinds[Math.floor(rnd() * kinds.length)];
    if (cluster(D, kind, s, at, put, proc, y)) made++;
  }

  // corners: rubble, cobwebs, a lantern
  const b = I.roomBounds(room, WALL_HALF + 0.9);
  for (const [fx, fz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const p = new THREE.Vector3(fx ? b.x1 : b.x0, y, fz ? b.z1 : b.z0);
    const r = rnd();
    const yaw = Math.atan2(fx ? -1 : 1, fz ? -1 : 1);
    if (r < 0.3) put('kaykit', 'rubble_half', p.clone().add(new THREE.Vector3(fx ? 0.4 : -0.4, 0, fz ? 0.4 : -0.4)), yaw + Math.PI, { col: 1.0, s: 0.6, res: 1.1 });
    else if (r < 0.5 && T.lamp !== 'crystal') {
      if (put('halloween', 'lantern_standing', p, yaw, { col: 0.35, res: 0.6 })) D.light(p.clone().setY(y + 0.55), T.torch, T.torchIntensity * 0.45, 0.3, 'flame');
    } else if (r < 0.62) put('kenney', 'rocks', p, yaw, { s: 1.8, col: 0.7 });
    if (rnd() < 0.5) D.batch.add('quaternius', 'cobweb', mat(p.x + (fx ? 0.5 : -0.5), y + WALL_H - 0.9, p.z + (fz ? 0.5 : -0.5), yaw + Math.PI, 1.8), false);
  }

  // light shafts in themes that have them
  if (T.shafts && (room.role === 'combat' || room.role === 'treasure') && rnd() < 0.55) {
    const c = I.roomCenter(room);
    I.shaftSpots.push({ pos: c.clone().add(new THREE.Vector3((rnd() - 0.5) * 6, -0.1, (rnd() - 0.5) * 6)), radius: 1.4 + rnd() * 0.8, height: 12 });
  }

  // flooded rooms (chapel, grotto)
  if (T.dressing.includes('water') && (room.role === 'combat' || room.role === 'side') && rnd() < 0.5) {
    const cells: [number, number][] = [];
    for (let j = room.y; j < room.y + room.h; j++) for (let i = room.x; i < room.x + room.w; i++) cells.push([i, j]);
    I.addWater(cells, D.themeKey === 'grotto' ? '#1f7aa0' : '#2aa0a8', '#041820');
  }
}

type Put = (kit: KitId, name: string, p: THREE.Vector3, yaw: number, o?: { y?: number; s?: number; col?: number; res?: number; shadow?: boolean; force?: boolean }) => boolean;
type Proc = (kind: ProcKind, p: THREE.Vector3, yaw: number, o?: { s?: number; col?: number; res?: number; force?: boolean; y?: number }) => boolean;

function cluster(D: Dresser, kind: DressingKind, s: Slot, at: (s: Slot, a: number, n: number) => THREE.Vector3, put: Put, proc: Proc, y: number): boolean {
  const T = D.theme, rnd = D.rnd;
  const yaw = yawFor(s.d);
  const side = rnd() < 0.5 ? -1 : 1;
  switch (kind) {
    case 'storage': {
      const a = put('kaykit', rnd() < 0.5 ? 'barrel_large' : 'crates_stacked', at(s, side * 0.6, 1.1), yaw + rnd() * 0.6, { col: 0.95 });
      put('kaykit', 'barrel_small', at(s, side * -0.9, 0.7), rnd() * 6, { col: 0.5 });
      if (rnd() < 0.6) put('kaykit', 'box_large', at(s, side * 1.7, 1.0), yaw + rnd() * 0.4, { col: 0.8 });
      return a;
    }
    case 'library': {
      const edge = at(s, 0, -WALL_HALF);
      D.batch.add('kaykit', 'shelves', mat(edge.x, y, edge.z, yaw), false);
      const ok = put('kaykit', 'table_medium', at(s, side * 0.2, 1.8), yaw, { col: 1.0 });
      if (ok) {
        const c = at(s, side * 0.2, 1.8);
        D.batch.add('kaykit', 'candle_triple', mat(c.x + 0.3, y + 1.0, c.z, rnd() * 6), false);
        D.light(new THREE.Vector3(c.x + 0.3, y + 1.9, c.z), T.torch, T.torchIntensity * 0.3, 0.22);
        put('kaykit', 'chair', at(s, side * 0.2 + 1.3, 2.3), yaw + Math.PI, { col: 0.35, res: 0.4 });
      }
      return ok;
    }
    case 'feast': return put('kaykit', 'table_long_decorated_A', at(s, 0, 1.8), yaw + Math.PI / 2, { col: 1.2, res: 1.6 });
    case 'crypt': {
      const p = at(s, side * 0.4, 1.8);
      const ok = put('halloween', rnd() < 0.5 ? 'coffin_decorated' : 'coffin', p, yaw, { col: 1.1, res: 1.5 });
      if (ok) {
        const c = at(s, side * -1.3, 0.8);
        if (put('halloween', 'skull_candle', c, yaw, { col: 0.35, res: 0.5 })) D.light(c.clone().setY(y + 1.18), T.torch, T.torchIntensity * 0.35, 0.25);
      }
      return ok;
    }
    case 'graves': {
      const ok = put('halloween', rnd() < 0.5 ? 'grave_A' : 'grave_B', at(s, side * 0.5, 0.9), yaw, { col: 0.8 });
      put('halloween', 'gravestone', at(s, side * -1.3, 0.7), yaw + (rnd() - 0.5) * 0.4, { col: 0.5 });
      return ok;
    }
    case 'pews': {
      const ok = put('halloween', 'bench', at(s, 0, 1.4), yaw, { col: 0.9, res: 1.1 });
      put('halloween', 'bench', at(s, 0, 3.0), yaw, { col: 0.9, res: 1.1 });
      return ok;
    }
    case 'roots': {
      const edge = at(s, 0, -WALL_HALF + 0.05);
      D.batch.proc(rnd() < 0.6 ? 'root_arch' : 'root_hang', mat(edge.x, y, edge.z, yaw, 0.9 + rnd() * 0.3));
      if (rnd() < 0.6) proc('mushrooms', at(s, side * 1.2, 0.8), rnd() * 6, { col: 0.4, s: 1.2 });
      return true;
    }
    case 'mushrooms': {
      const p = at(s, side * 0.5, 0.9);
      const ok = proc('mushrooms', p, rnd() * 6, { col: 0.5, s: 1.3 + rnd() * 0.5 });
      if (ok) D.light(p.clone().setY(y + 0.8), T.glow, T.torchIntensity * 0.35, 0.8, 'orb');
      return ok;
    }
    case 'crystals': {
      const p = at(s, side * 0.4, 1.0);
      const ok = proc(rnd() < 0.4 ? 'crystal_big' : 'crystals', p, rnd() * 6, { col: 0.7, res: 1.0 });
      if (ok) D.light(p.clone().setY(y + 1.2), T.glow, T.torchIntensity * 0.4, 0.9, 'orb');
      return ok;
    }
    case 'forge': {
      const p = at(s, side * 0.3, 1.5);
      const ok = proc('anvil', p, yaw + Math.PI / 2, { col: 0.7 });
      put('kaykit', 'keg', at(s, side * -1.4, 1.0), yaw, { col: 0.9 });
      const w = at(s, 0, 0.1);
      D.batch.add('kaykit', 'sword_shield', mat(w.x, y + 2.3, w.z, yaw), false);
      return ok;
    }
    case 'mine': {
      const edge = at(s, 0, -WALL_HALF + 0.12);
      D.batch.add('kenney', 'wood-support', mat(edge.x, y, edge.z, yaw, 3.6));
      put('kenney', 'rocks', at(s, side * 1.1, 0.9), rnd() * 6, { s: 1.6, col: 0.6 });
      return true;
    }
    case 'bones': {
      const ok = proc('bones_pile', at(s, side * 0.4, 1.0), rnd() * 6, { res: 0.8 });
      put('halloween', rnd() < 0.5 ? 'skull' : 'ribcage', at(s, side * -0.8, 0.8), rnd() * 6, { res: 0.5, s: 0.8 });
      return ok;
    }
    case 'stars': {
      const p = at(s, side * 0.4, 1.3);
      const ok = proc('meteor', p, rnd() * 6, { col: 0.9, s: 0.9 + rnd() * 0.4 });
      if (ok) D.light(p.clone().setY(y + 1.0), T.glow, T.torchIntensity * 0.35, 0.8, 'orb');
      proc('crystals', at(s, side * -1.3, 0.8), rnd() * 6, { col: 0.4 });
      return ok;
    }
    case 'ice': {
      const ok = proc('ice_spike', at(s, side * 0.4, 1.0), rnd() * 6, { col: 0.8, s: 0.8 + rnd() * 0.5 });
      proc('sand', at(s, side * -1.2, 0.9), rnd() * 6, { s: 0.7, res: 0.9 });
      return ok;
    }
    case 'sand': {
      const ok = proc('sand', at(s, side * 0.3, 1.1), rnd() * 6, { s: 0.9 + rnd() * 0.4, res: 1.2 });
      put('kaykit', 'rubble_half', at(s, side * -1.2, 0.9), yaw + Math.PI, { s: 0.5, col: 0.7 });
      return ok;
    }
    case 'statues': {
      const p = at(s, 0, 1.2);
      return put('halloween', 'shrine_candles', p, yaw, { col: 0.6 }) && !!D.light(p.clone().setY(y + 1.55), T.torch, T.torchIntensity * 0.35, 0.25);
    }
    case 'treasure': {
      const ok = put('kaykit', 'trunk_large_A', at(s, side * 0.6, 1.0), yaw, { col: 0.75 });
      put('kaykit', 'coin_stack_small', at(s, side * -0.9, 0.8), rnd() * 6, { col: 0.4 });
      proc('gold_pile', at(s, side * 1.9, 1.1), rnd() * 6, { s: 0.6, res: 0.8 });
      return ok;
    }
    case 'rubble': return put('kaykit', 'rubble_half', at(s, side * 0.4, 1.3), yaw + Math.PI, { s: 0.7, col: 1.0, res: 1.3 });
    default: return false;
  }
}

function dressHall(D: Dresser, room: Room, put: Put, proc: Proc) {
  const I = D.interior, T = D.theme;
  const y = LEVEL_Y[room.level];
  const A = I.anchors;
  // the spring: a basin of glowing water that restores the team
  proc('basin', A.spring, 0, { col: 1.5, force: true });
  D.light(A.spring.clone().setY(y + 1.4), '#6affe0', 14, 0, 'halo');
  I.glows.add(A.spring.clone().setY(y + 0.8), '#7affe8', 3.2, 'halo', 0.8);
  // lore stele
  proc('stele', A.lore.pos, A.lore.yaw, { col: 0.9, force: true });
  // flanking pillars along the entry aisle
  const c = I.roomCenter(room);
  for (const sx of [-1, 1]) {
    put('kaykit', 'pillar_decorated', new THREE.Vector3(c.x + sx * CELL * 1.1, y, c.z - CELL * 1.2), sx > 0 ? -Math.PI / 2 : Math.PI / 2, { col: 1.0, res: 1.2, force: true });
  }
  if (T.shafts) I.shaftSpots.push({ pos: c.clone().add(new THREE.Vector3(0, -0.1, -CELL * 0.4)), radius: 2.2, height: 12 });
}

function dressBoss(D: Dresser, room: Room, put: Put, proc: Proc) {
  const I = D.interior, T = D.theme;
  const y = LEVEL_Y[room.level];
  const A = I.anchors.boss;
  const f = A.forward, r = new THREE.Vector3(f.z, 0, -f.x);
  // the dais the boss waits on, ringed by braziers
  proc('dais', A.pos.clone().setY(y), 0, { col: 0.1, res: 0.1, force: true });
  I.addDecal(A.pos.clone().setY(y + 0.62), 8, T.glow, 0.5);
  for (const s of [-1, 1]) {
    const b = A.pos.clone().addScaledVector(r, s * 5.2).addScaledVector(f, -0.6).setY(y);
    proc('brazier', b, 0, { col: 0.6, force: true, s: 1.3 });
    D.light(b.clone().setY(y + 1.95), T.torch, T.torchIntensity * 1.1, 1.3);
  }
  // the nave: two rows of pillars from the door to the dais
  const c = I.roomCenter(room);
  for (const s of [-1, 1]) for (const k of [-1.1, 0.6]) {
    const p = c.clone().addScaledVector(r, s * CELL * 1.55).addScaledVector(f, k * CELL).setY(y);
    put('kaykit', 'pillar_decorated', p, Math.atan2(-r.x * s, -r.z * s), { col: 1.0, res: 1.2, force: true });
    put('kaykit', 'pillar_decorated', p, Math.atan2(-r.x * s, -r.z * s), { y: y + WALL_H, force: true, shadow: false });
  }
  if (T.shafts) {
    I.shaftSpots.push({ pos: A.pos.clone().setY(y - 0.1), radius: 3.2, height: 14 });
    I.shaftSpots.push({ pos: c.clone().setY(y - 0.1), radius: 2, height: 14 });
  }
  // theme set pieces behind the dais
  const back = A.pos.clone().addScaledVector(f, 4.2).setY(y);
  if (T.dressing.includes('crystals') || T.dressing.includes('stars') || T.dressing.includes('ice')) {
    for (const s of [-1, 1]) {
      const p = back.clone().addScaledVector(r, s * 3.4);
      proc(T.dressing.includes('ice') ? 'ice_spike' : 'crystal_big', p, s, { s: 1.6, col: 1.2, force: true });
      D.light(p.clone().setY(y + 2.2), T.glow, T.torchIntensity * 0.6, 1.4, 'orb');
    }
  } else if (T.dressing.includes('roots')) {
    for (const s of [-1, 0, 1]) {
      const p = back.clone().addScaledVector(r, s * 3).addScaledVector(f, 1.2);
      D.batch.proc('root_arch', mat(p.x, y, p.z, Math.atan2(-f.x, -f.z), 1.5));
    }
  } else if (T.dressing.includes('crypt') || T.dressing.includes('graves')) {
    for (const s of [-1, 1]) put('halloween', 'coffin_decorated', back.clone().addScaledVector(r, s * 3.6), Math.atan2(-f.x, -f.z), { col: 1.1, force: true });
  } else if (T.dressing.includes('statues')) {
    // horse statue origin sits off-centre in the source file: re-centre its pedestal
    for (const s of [-1, 1]) {
      const p = back.clone().addScaledVector(r, s * 4.2);
      const yaw = Math.atan2(-f.x, -f.z);
      const off = new THREE.Vector3(-0.01, 0, -5.45).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      D.batch.add('quaternius', 'horse_statue', mat(p.x + off.x, y, p.z + off.z, yaw, 1.0));
      I.addCollider({ x: p.x, z: p.z, r: 1.1 });
    }
  } else {
    for (const s of [-1, 1]) put('kaykit', 'rubble_large', back.clone().addScaledVector(r, s * 3.8), Math.atan2(-f.x, -f.z), { s: 0.55, col: 1.6, force: true });
  }
}

function shuffle<T>(a: T[], rnd: () => number) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
