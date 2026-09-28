// Road network: A* routing over a slope/water cost field (roads merge onto existing ones), gate
// passes threaded straight, the Crown switchback, then smooth profiles carved into the terrain and
// rasterised into a path field.

import { Grid, slopeGrid } from './grid';
import { chaikin, resamplePolyline, type P2 } from './lines';
import { clamp, lerp, smooth } from './noise';
import { SEA, ZONES, GATES, MC, PLATEAU_R, SUMMIT_H, type Pad } from './design';
import type { Pass } from './carve';
import { WK } from './hydro';
import { crownFloor } from './shape';

export type RoadKind = 'ring' | 'road' | 'trail' | 'switchback';
export const ROAD_W: Record<RoadKind, number> = { ring: 7, road: 5, trail: 3.4, switchback: 5 };

export interface Road { id: string; kind: RoadKind; from: string; to: string; pts: P2[]; y: number[]; width: number; cobble?: boolean; fords?: number[] }

interface Stop { id: string; x: number; z: number; pad?: Pad }

// ── A* ─────────────────────────────────────────────────────────────────────────────────────────
class Heap {
  k: number[] = []; v: number[] = [];
  push(key: number, val: number) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop(): number {
    const k = this.k, v = this.v; const top = v[0]; const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
  get size() { return this.k.length; }
}

export class Router {
  n = 1024; cost: Float32Array; h: Grid; slope: Grid; roadMask: Uint8Array;
  constructor(h2048: Grid, water: { kind: Uint8Array }, pads: Pad[]) {
    const n = this.n;
    const h = new Grid(n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h.data[j * n + i] = h2048.data[j * 2 * 2048 + i * 2];
    this.h = h;
    this.slope = slopeGrid(h, 1);
    this.cost = new Float32Array(n * n);
    this.roadMask = new Uint8Array(n * n);
    for (let k = 0; k < n * n; k++) {
      const s = this.slope.data[k];
      let c = 1 + 30 * Math.max(0, s - 0.06) ** 2;
      if (s > 0.3) c += 20 + (s - 0.3) * 120;
      if (s > 1.1) c = Infinity; // cliffs
      const wk = water.kind[k];
      if (wk === WK.ocean && h.data[k] < SEA + 0.4) c = Infinity;
      else if (wk === WK.lake || wk === WK.lava || wk === WK.marsh || wk === WK.oasis || wk === WK.frozen) c = Infinity;
      else if (wk === WK.river) c += 60;
      this.cost[k] = c;
    }
    for (const p of pads) this.stamp(p.x, p.z, p.r * 0.9, 18);
  }
  stamp(x: number, z: number, r: number, add: number) {
    const n = this.n;
    const i0 = Math.max(0, Math.floor((x - r + 1024) / 2)), i1 = Math.min(n - 1, Math.ceil((x + r + 1024) / 2));
    const j0 = Math.max(0, Math.floor((z - r + 1024) / 2)), j1 = Math.min(n - 1, Math.ceil((z + r + 1024) / 2));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (Math.hypot(-1024 + i * 2 - x, -1024 + j * 2 - z) <= r) this.cost[j * n + i] += add;
    }
  }
  /** Temporarily make an area cheap (a pad the road starts/ends in); returns an undo fn. */
  open(x: number, z: number, r: number) {
    const n = this.n, saved: [number, number][] = [];
    const i0 = Math.max(0, Math.floor((x - r + 1024) / 2)), i1 = Math.min(n - 1, Math.ceil((x + r + 1024) / 2));
    const j0 = Math.max(0, Math.floor((z - r + 1024) / 2)), j1 = Math.min(n - 1, Math.ceil((z + r + 1024) / 2));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * n + i;
      if (Math.hypot(-1024 + i * 2 - x, -1024 + j * 2 - z) <= r) { saved.push([k, this.cost[k]]); this.cost[k] = 1; }
    }
    return () => { for (const [k, c] of saved) this.cost[k] = c; };
  }
  route(a: P2, b: P2): P2[] | null {
    const n = this.n, cost = this.cost, H = this.h.data;
    const toI = (x: number) => clamp(Math.round((x + 1024) / 2), 0, n - 1);
    const s = toI(a[1]) * n + toI(a[0]), t = toI(b[1]) * n + toI(b[0]);
    const tx = t % n, tz = (t / n) | 0;
    const g = new Float32Array(n * n).fill(Infinity);
    const from = new Int32Array(n * n).fill(-1);
    const closed = new Uint8Array(n * n);
    const heap = new Heap();
    g[s] = 0; heap.push(0, s);
    const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
    let iter = 0;
    while (heap.size) {
      const c = heap.pop();
      if (closed[c]) continue;
      closed[c] = 1;
      if (c === t) break;
      if (++iter > 3_000_000) return null;
      const ci = c % n, cj = (c / n) | 0;
      for (let d = 0; d < 8; d++) {
        const ni = ci + DI[d], nj = cj + DJ[d];
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const nb = nj * n + ni;
        if (closed[nb]) continue;
        const cc = cost[nb];
        if (cc === Infinity) continue;
        const len = d < 4 ? 1 : 1.4142;
        const dh = Math.abs(H[nb] - H[c]);
        const road = this.roadMask[nb] ? 0.35 : 1;
        const ng = g[c] + len * cc * road + dh * dh * 6;
        if (ng < g[nb]) {
          g[nb] = ng; from[nb] = c;
          const hx = ni - tx, hz = nj - tz;
          heap.push(ng + Math.sqrt(hx * hx + hz * hz) * 0.9, nb);
        }
      }
    }
    if (from[t] < 0 && t !== s) return null;
    const out: P2[] = [];
    for (let c = t; c >= 0; c = from[c]) { out.push([-1024 + (c % n) * 2, -1024 + ((c / n) | 0) * 2]); if (c === s) break; }
    out.reverse();
    out[0] = [a[0], a[1]]; out[out.length - 1] = [b[0], b[1]];
    return out;
  }
  mark(pts: P2[], w: number) {
    const n = this.n;
    const r = Math.ceil(w / 4);
    for (const [x, z] of pts) {
      const ci = Math.round((x + 1024) / 2), cj = Math.round((z + 1024) / 2);
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        const i = ci + di, j = cj + dj;
        if (i >= 0 && j >= 0 && i < n && j < n) this.roadMask[j * n + i] = 1;
      }
    }
  }
}

/** Ramer–Douglas–Peucker. */
function rdp(pts: P2[], eps: number): P2[] {
  if (pts.length < 3) return pts;
  const [ax, az] = pts[0], [bx, bz] = pts[pts.length - 1];
  const vx = bx - ax, vz = bz - az, L = Math.hypot(vx, vz) || 1;
  let bi = 0, bd = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - ax) * vz - (pts[i][1] - az) * vx) / L;
    if (d > bd) { bd = d; bi = i; }
  }
  if (bd <= eps) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, bi + 1), eps).slice(0, -1), ...rdp(pts.slice(bi), eps)];
}

export function smoothPath(raw: P2[]): P2[] {
  return resamplePolyline(chaikin(rdp(raw, 2.2), 3), 2);
}

// ── Crown switchback ───────────────────────────────────────────────────────────────────────────
/** Zig-zag legs up the south face from the summit camp (0,150) to the plateau rim. */
export function switchbackPath(): P2[] {
  const legs = 7;
  const z0 = 150, z1 = MC[1] + PLATEAU_R - 2;
  const pts: P2[] = [[0, z0]];
  const xs = 62;
  for (let l = 0; l < legs; l++) {
    const zA = lerp(z0 - 6, z1 + 6, l / legs), zB = lerp(z0 - 6, z1 + 6, (l + 1) / legs);
    const side = l % 2 === 0 ? 1 : -1;
    pts.push([side * xs * 0.25, zA - 2]);
    pts.push([side * xs, lerp(zA, zB, 0.45)]);
    pts.push([side * (xs + 7), lerp(zA, zB, 0.62)]);
    pts.push([side * xs * 0.65, lerp(zA, zB, 0.84)]);
  }
  pts.push([0, z1]);
  return resamplePolyline(chaikin(pts, 3), 2);
}

// ── Network definition ─────────────────────────────────────────────────────────────────────────
const zone = (id: string) => ZONES.find((z) => z.id === id)!;

interface Seg { id: string; kind: RoadKind; a: string; b: string; cobble?: boolean; straight?: boolean }

export function networkPlan(): Seg[] {
  const segs: Seg[] = [];
  const ring = ['vale', 'lakes', 'marsh', 'elder', 'peaks', 'hollows', 'dunes', 'scar', 'coast'];
  const gateBetween = (a: string, b: string) => GATES.find((g) => g.joins.includes(a) && g.joins.includes(b) && g.id !== 'g_crown')!;
  for (let i = 0; i < ring.length; i++) {
    const A = ring[i], B = ring[(i + 1) % ring.length];
    const g = gateBetween(A, B);
    segs.push({ id: `ring_${A}_${g.id}`, kind: 'ring', a: zone(A).town.id, b: `${g.id}@${A}` });
    segs.push({ id: `ring_${g.id}`, kind: 'ring', a: `${g.id}@${A}`, b: `${g.id}@${B}`, straight: true });
    segs.push({ id: `ring_${g.id}_${B}`, kind: 'ring', a: `${g.id}@${B}`, b: zone(B).town.id });
  }
  for (const z of ZONES) {
    if (z.id === 'summit') continue;
    segs.push({ id: `${z.id}_to_camp`, kind: 'road', a: z.town.id, b: `${z.id}_camp` });
    segs.push({ id: `${z.id}_to_arena`, kind: 'road', a: `${z.id}_camp`, b: `${z.id}_arena` });
  }
  const T = (id: string, a: string, b: string, kind: RoadKind = 'trail', cobble = false) => segs.push({ id, kind, a, b, cobble });
  T('vale_south_gate', 'hearthwick', 'start', 'road', true);
  T('vale_homestead', 'hearthwick', 'homestead', 'road');
  T('vale_mill', 'hearthwick', 'p_windmill');
  T('vale_meadow', 'start', 'p_meadow');
  T('vale_beacon', 'p_meadow', 'p_beacon');
  T('vale_grove', 'vale_camp', 'p_oldgrove');
  T('vale_burrow', 'p_oldgrove', 'd_vale');
  T('crown_road', 'hearthwick', 'g_crown', 'road', true);
  T('crown_valley', 'g_crown', 'crowncamp', 'road');
  T('crown_camp', 'crowncamp', 'summit_camp', 'road');
  T('lakes_mirror', 'stillwater', 'p_mirror');
  T('lakes_falls', 'p_mirror', 'p_falls');
  T('coast_light', 'tidewatch', 'p_lighthouse', 'road');
  T('coast_reef', 'coast_camp', 'p_reef');
  T('marsh_boardwalk', 'mirehaven', 'p_boardwalk');
  T('scar_forge', 'cinderrest', 'd_scar', 'road');
  T('scar_rim', 'scar_camp', 'p_caldera');
  T('elder_tree', 'elderhollow', 'p_eldertree');
  T('dunes_oasis', 'sunreach', 'p_oasis');
  T('dunes_tomb', 'sunreach', 'd_dunes', 'road');
  T('peaks_glacier', 'skyhold', 'p_glacier');
  T('peaks_caves', 'p_glacier', 'd_peaks');
  T('hollows_mine', 'glimmerhold', 'p_mine', 'road');
  return segs;
}

/** Route, smooth and profile the whole network. */
export function buildRoads(h: Grid, water: { kind: Uint8Array; surf: Grid }, pads: Pad[], passes: Pass[], padLevels: Map<string, number>): Road[] {
  const router = new Router(h, water, pads);
  const stops = new Map<string, Stop>();
  for (const p of pads) stops.set(p.id, { id: p.id, x: p.x, z: p.z, pad: p });
  for (const ps of passes) {
    const g = GATES.find((gg) => gg.id === ps.id)!;
    const e = ps.halfLen + 10;
    const A: P2 = [ps.x + ps.tx * e, ps.z + ps.tz * e], B: P2 = [ps.x - ps.tx * e, ps.z - ps.tz * e];
    const tA = zone(g.joins[0]).town.pos, tB = zone(g.joins[1]).town.pos;
    const d0 = Math.hypot(A[0] - tA[0], A[1] - tA[1]) + Math.hypot(B[0] - tB[0], B[1] - tB[1]);
    const d1 = Math.hypot(B[0] - tA[0], B[1] - tA[1]) + Math.hypot(A[0] - tB[0], A[1] - tB[1]);
    const [pA, pB] = d0 < d1 ? [A, B] : [B, A];
    stops.set(`${g.id}@${g.joins[0]}`, { id: `${g.id}@${g.joins[0]}`, x: pA[0], z: pA[1] });
    stops.set(`${g.id}@${g.joins[1]}`, { id: `${g.id}@${g.joins[1]}`, x: pB[0], z: pB[1] });
  }
  const roads: Road[] = [];
  for (const seg of networkPlan()) {
    const a = stops.get(seg.a), b = stops.get(seg.b);
    if (!a || !b) { console.warn(`road ${seg.id}: missing stop ${!a ? seg.a : seg.b}`); continue; }
    let pts: P2[] | null;
    if (seg.straight) {
      pts = resamplePolyline([[a.x, a.z], [b.x, b.z]], 2);
    } else {
      const undo = [a.pad ? router.open(a.x, a.z, a.pad.r + 4) : () => {}, b.pad ? router.open(b.x, b.z, b.pad.r + 4) : () => {}];
      const raw = router.route([a.x, a.z], [b.x, b.z]);
      undo.forEach((u) => u());
      if (!raw) {
        const probe = (x: number, z: number) => { const k = Math.round((z + 1024) / 2) * 1024 + Math.round((x + 1024) / 2); return `${router.cost[k].toFixed(1)}/s${router.slope.data[k].toFixed(2)}/w${water.kind[k]}`; };
        const line: string[] = [];
        for (let t = 0; t <= 1; t += 0.1) line.push(probe(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t));
        console.warn(`road ${seg.id}: no route (${a.x.toFixed(0)},${a.z.toFixed(0)})→(${b.x.toFixed(0)},${b.z.toFixed(0)}) ${line.join(' ')}`);
        continue;
      }
      pts = smoothPath(raw);
    }
    router.mark(pts, ROAD_W[seg.kind]);
    roads.push({ id: seg.id, kind: seg.kind, from: seg.a, to: seg.b, pts, y: [], width: ROAD_W[seg.kind], cobble: seg.cobble });
  }
  roads.push({ id: 'crown_switchback', kind: 'switchback', from: 'summit_camp', to: 'summit_plateau', pts: switchbackPath(), y: [], width: ROAD_W.switchback });
  roads.push({ id: 'crown_plateau', kind: 'road', from: 'summit_plateau', to: 'summit_arena', pts: resamplePolyline([[0, MC[1] + PLATEAU_R - 2], [0, -12], [0, -40], [0, -60]], 2), y: [], width: 5, cobble: true });
  for (const r of roads) profileRoad(r, h, water, pads, padLevels);
  return roads;
}

function profileRoad(r: Road, h: Grid, water: { kind: Uint8Array; surf: Grid }, pads: Pad[], padLevels: Map<string, number>) {
  const n = r.pts.length;
  let y = r.pts.map(([x, z]) => h.sample(x, z));
  if (r.kind === 'switchback') {
    const s: number[] = [0];
    for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
    const y0 = padLevels.get('summit_camp') ?? crownFloor(150);
    y = s.map((si) => lerp(y0, SUMMIT_H, si / s[n - 1]));
  } else {
    const win = 6;
    y = y.map((_, i) => { let a = 0, c = 0; for (let k = -win; k <= win; k++) { a += y[clamp(i + k, 0, n - 1)]; c++; } return a / c; });
    for (const p of pads) {
      const lv = padLevels.get(p.id);
      if (lv === undefined) continue;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(r.pts[i][0] - p.x, r.pts[i][1] - p.z);
        const w = 1 - smooth(p.r * 0.8, p.r + p.blend * 0.9, d);
        if (w > 0) y[i] = lerp(y[i], lv, w);
      }
    }
  }
  const fords: number[] = [];
  for (let i = 0; i < n; i++) {
    const [x, z] = r.pts[i];
    const k = clamp(Math.round((z + 1024) / 2), 0, 1023) * 1024 + clamp(Math.round((x + 1024) / 2), 0, 1023);
    if (water.kind[k] === WK.river) {
      const sv = water.surf.data[k];
      if (y[i] > sv - 0.3) { y[i] = sv - 0.3; if (!fords.length || i - fords[fords.length - 1] > 10) fords.push(i); }
    }
  }
  for (let i = 0; i < n; i++) y[i] = Math.max(y[i], SEA + 0.5);
  r.y = y;
  r.fords = fords;
}

/** Carve every road into the terrain: level across, following its profile, soft shoulders. */
export function carveRoads(h: Grid, roads: Road[]) {
  for (const r of roads) {
    const hw = r.width / 2;
    const shoulder = r.kind === 'switchback' ? 7 : r.kind === 'trail' ? 3.5 : 5;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const R = hw + shoulder + 2;
      const i0 = Math.max(0, Math.floor(h.iOf(Math.min(ax, bx) - R))), i1 = Math.min(h.n - 1, Math.ceil(h.iOf(Math.max(ax, bx) + R)));
      const j0 = Math.max(0, Math.floor(h.iOf(Math.min(az, bz) - R))), j1 = Math.min(h.n - 1, Math.ceil(h.iOf(Math.max(az, bz) + R)));
      const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
      for (let j = j0; j <= j1; j++) {
        const z = h.xOf(j);
        for (let ii = i0; ii <= i1; ii++) {
          const x = h.xOf(ii), k = j * h.n + ii;
          const t = clamp(((x - ax) * vx + (z - az) * vz) / L2, 0, 1);
          const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
          if (d > hw + shoulder) continue;
          const ty = lerp(r.y[i], r.y[i + 1], t);
          const w = d <= hw + 0.5 ? 1 : 1 - smooth(hw + 0.5, hw + shoulder, d);
          h.data[k] = lerp(h.data[k], ty, w);
        }
      }
    }
  }
}

/** Rasterise roads into a 0..1 path field (and a cobble mask) at resolution n. */
export function rasterRoads(roads: Road[], n: number): { path: Float32Array; cobble: Float32Array } {
  const path = new Float32Array(n * n), cobble = new Float32Array(n * n);
  const cell = 2048 / n;
  for (const r of roads) {
    const hw = r.width / 2;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const R = hw + 2;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R + 1024) / cell)), i1 = Math.min(n - 1, Math.ceil((Math.max(ax, bx) + R + 1024) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R + 1024) / cell)), j1 = Math.min(n - 1, Math.ceil((Math.max(az, bz) + R + 1024) / cell));
      const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
      for (let j = j0; j <= j1; j++) {
        const z = -1024 + j * cell;
        for (let ii = i0; ii <= i1; ii++) {
          const x = -1024 + ii * cell, k = j * n + ii;
          const t = clamp(((x - ax) * vx + (z - az) * vz) / L2, 0, 1);
          const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
          const v = 1 - smooth(hw - 0.9, hw + 0.9, d);
          if (v > path[k]) path[k] = v;
          if (r.cobble && v > cobble[k]) cobble[k] = v;
        }
      }
    }
  }
  return { path, cobble };
}
