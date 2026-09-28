// Water: lakes with their own levels, rivers as sloped surfaces carved into beds, waterfalls where a
// river leaves the mountain's rampart or drops a terrace, and the ocean. Produces the water-surface
// field (1024²: surface height + kind) that gameplay samples and the rendering data for the runtime.

import { Grid } from './grid';
import { catmull, type P2 } from './lines';
import { simplex, fbm, seedOf, clamp, lerp, smooth } from './noise';
import { SEA, LAKES, RIVERS, RAMPART_FALLS, type LakeDef, type RiverDef } from './design';

export const WK = { none: 0, ocean: 1, lake: 2, river: 3, lava: 4, marsh: 5, frozen: 6, oasis: 7 } as const;
const KIND_OF: Record<LakeDef['kind'], number> = { lake: WK.lake, pool: WK.lake, frozen: WK.frozen, lava: WK.lava, oasis: WK.oasis, marsh: WK.marsh };

export interface LakeOut { id: string; name: string; kind: string; level: number; x: number; z: number; rx: number; rz: number; rot: number; region: string }
export interface RiverOut { id: string; name: string; region: string; lava: boolean; pts: [number, number, number, number][] } // x, surfaceY, z, width
export interface FallOut { id: string; river: string; x: number; z: number; top: number; bottom: number; dx: number; dz: number; width: number }

const nL = simplex(seedOf('lakes'));

export function lakeSDF(L: { x: number; z: number; rx: number; rz: number; rot: number }, x: number, z: number) {
  const c = Math.cos(L.rot), s = Math.sin(L.rot);
  const u = (x - L.x) * c + (z - L.z) * s, v = -(x - L.x) * s + (z - L.z) * c;
  const ang = Math.atan2(v, u);
  const wob = 1 + 0.16 * fbm(nL, Math.cos(ang) * 1.3 + L.x * 0.01, Math.sin(ang) * 1.3 + L.z * 0.01, 3);
  const q = Math.hypot(u / L.rx, v / L.rz) / wob;
  return (q - 1) * Math.min(L.rx, L.rz);
}

function boxOf(x: number, z: number, R: number, h: Grid) {
  return {
    i0: Math.max(0, Math.floor(h.iOf(x - R))), i1: Math.min(h.n - 1, Math.ceil(h.iOf(x + R))),
    j0: Math.max(0, Math.floor(h.iOf(z - R))), j1: Math.min(h.n - 1, Math.ceil(h.iOf(z + R))),
  };
}

/** Carve lake basins; levels come from the lowest point of each rim (so no lake ever spills). */
export function carveLakes(h: Grid): LakeOut[] {
  const out: LakeOut[] = [];
  for (const L of LAKES) {
    // rim ring 4–10 m outside the shore
    const rim: number[] = [];
    for (let a = 0; a < 96; a++) {
      const ang = (a / 96) * Math.PI * 2;
      for (const f of [1.12, 1.25]) {
        const c = Math.cos(L.rot), s = Math.sin(L.rot);
        const u = Math.cos(ang) * L.rx * f, v = Math.sin(ang) * L.rz * f;
        rim.push(h.sample(L.x + u * c - v * s, L.z + u * s + v * c));
      }
    }
    rim.sort((a, b) => a - b);
    const frozen = L.kind === 'frozen';
    let level = L.level ?? rim[Math.floor(rim.length * 0.12)] - (frozen ? 0.3 : 0.7);
    level = Math.max(level, SEA + 0.4);
    const R = Math.max(L.rx, L.rz) * 1.6 + 16;
    const { i0, i1, j0, j1 } = boxOf(L.x, L.z, R, h);
    for (let j = j0; j <= j1; j++) {
      const z = h.xOf(j);
      for (let i = i0; i <= i1; i++) {
        const x = h.xOf(i), k = j * h.n + i;
        const sd = lakeSDF(L, x, z);
        const cur = h.data[k];
        if (sd < 0) {
          // basin: deepest in the middle; frozen lakes are a flat ice sheet over shallow ground
          const t = clamp(-sd / (Math.min(L.rx, L.rz) * 0.8), 0, 1);
          const depth = frozen ? 0.25 : 0.6 + (L.depth - 0.6) * Math.pow(t, 0.8);
          const bed = level - depth + 0.3 * fbm(nL, x / 8, z / 8, 2);
          h.data[k] = Math.min(cur, bed);
          if (frozen) h.data[k] = bed; // perfectly level under the ice
        } else {
          // shore: dip gently to the waterline; raise any rim that would let the lake spill
          const shore = level + sd * (L.kind === 'marsh' ? 0.05 : 0.14) + 0.02;
          if (sd < 14 && cur > shore) h.data[k] = lerp(shore, cur, smooth(3, 14, sd));
          if (sd < 6 && h.data[k] < level + 0.25) h.data[k] = level + 0.25 + sd * 0.05;
        }
      }
    }
    out.push({ id: L.id, name: L.name, kind: L.kind, level, x: L.x, z: L.z, rx: L.rx, rz: L.rz, rot: L.rot, region: L.region });
  }
  return out;
}

const nR = simplex(seedOf('rivers'));

export interface RiverGeom { def: RiverDef; pts: P2[]; surf: number[]; width: number[]; s: number[] }

/** River courses with meander and resolved surface profiles. */
export function planRivers(h: Grid, lakes: LakeOut[]): RiverGeom[] {
  const res: RiverGeom[] = [];
  for (const def of RIVERS) {
    // densify the designed course, then jitter the new mid-points so the river wanders
    const dense: P2[] = [];
    for (let i = 0; i < def.pts.length - 1; i++) {
      const [ax, az] = def.pts[i], [bx, bz] = def.pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      const k = Math.max(1, Math.round(L / 40));
      for (let q = 0; q < k; q++) {
        const t = q / k;
        let x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        if (q > 0 || (i > 0 && i < def.pts.length - 1)) {
          const nx = -(bz - az) / L, nz = (bx - ax) / L;
          const m = 16 * fbm(nR, x / 70 + def.id.length * 3, z / 70, 2) * (def.lava ? 0.3 : 1);
          x += nx * m; z += nz * m;
        }
        dense.push([x, z]);
      }
    }
    dense.push(def.pts[def.pts.length - 1]);
    const ctrl = dense;
    let pts = catmull(ctrl, 2);
    // gentle meander (keeps the ends fixed)
    const n = pts.length;
    pts = pts.map(([x, z], i) => {
      if (i < 3 || i > n - 4) return [x, z] as P2;
      const [px, pz] = pts[Math.max(0, i - 2)], [qx, qz] = pts[Math.min(n - 1, i + 2)];
      let tx = qx - px, tz = qz - pz; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const m = 5 * fbm(nR, i * 0.05 + def.id.length, 3.3, 3) * smooth(0, 20, i) * smooth(n, n - 20, i);
      return [x - tz * m, z + tx * m] as P2;
    });
    const s: number[] = [0];
    for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = s[s.length - 1];
    const width = s.map((si) => lerp(def.w0, def.w1, si / total));
    // valley-bottom ground along the course (min across the channel)
    const ground = pts.map(([x, z], i) => {
      let m = 1e9;
      const w = width[i] * 0.5 + 2;
      const [px, pz] = pts[Math.max(0, i - 1)], [qx, qz] = pts[Math.min(pts.length - 1, i + 1)];
      let tx = qx - px, tz = qz - pz; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      for (let o = -w; o <= w; o += 1) m = Math.min(m, h.sample(x - tz * o, z + tx * o));
      return m;
    });
    // lake ends
    const endLake = def.toLake ? lakes.find((l) => l.id === def.toLake) : undefined;
    const startLake = lakes.find((l) => Math.hypot(l.x - pts[0][0], l.z - pts[0][1]) < Math.max(l.rx, l.rz) + 12);
    const endLevel = endLake ? endLake.level : SEA;
    // surface: follow the ground 0.9 m down, never rising, at least 0.2% grade; falls allowed at `falls`
    const fallIdx = new Set((def.falls ?? []).map((ci) => {
      const [cx, cz] = def.pts[ci];
      let bi = 0, bd = 1e9;
      pts.forEach(([x, z], i) => { const d = Math.hypot(x - cx, z - cz); if (d < bd) { bd = d; bi = i; } });
      return bi;
    }));
    const surf: number[] = new Array(pts.length);
    const minDrop = 0.002;
    surf[0] = startLake ? startLake.level : ground[0] - 0.4;
    for (let i = 1; i < pts.length; i++) {
      const ds = s[i] - s[i - 1];
      const target = ground[i] - 0.9;
      let v = Math.min(surf[i - 1] - minDrop * ds, target + (fallIdx.has(i) ? 0 : 0));
      // without a designated fall, don't let the surface plunge more than 10% grade (carve instead)
      if (!fallIdx.has(i) && surf[i - 1] - v > 0.1 * ds) v = surf[i - 1] - 0.1 * ds;
      surf[i] = v;
    }
    // must reach the end level: rescale the tail so it lands on the lake/sea surface
    const lastIdx = pts.length - 1;
    if (surf[lastIdx] > endLevel + 0.05) {
      // pull the whole profile down proportionally from the last designated fall (or start)
      const from = Math.max(0, ...[...fallIdx].filter((f) => f < lastIdx));
      const a = surf[from], b = surf[lastIdx];
      for (let i = from + 1; i <= lastIdx; i++) {
        const t = (s[i] - s[from]) / (s[lastIdx] - s[from]);
        surf[i] = Math.min(surf[i], lerp(a, endLevel + 0.02, t) + (surf[i] - lerp(a, b, t)) * 0);
      }
    }
    surf[lastIdx] = Math.max(Math.min(surf[lastIdx], endLevel + 0.02), endLevel);
    // smooth (monotone preserving): average then re-enforce descent except at falls
    for (let pass = 0; pass < 3; pass++) {
      const cp = surf.slice();
      for (let i = 2; i < pts.length - 2; i++) {
        if (fallIdx.has(i) || fallIdx.has(i + 1) || fallIdx.has(i - 1)) continue;
        surf[i] = (cp[i - 2] + cp[i - 1] + cp[i] + cp[i + 1] + cp[i + 2]) / 5;
      }
      for (let i = 1; i < pts.length; i++) if (!fallIdx.has(i) && surf[i] > surf[i - 1] - 0.0005) surf[i] = surf[i - 1] - 0.0005;
    }
    res.push({ def, pts, surf, width, s });
  }
  return res;
}

/** Carve river beds into the terrain along the planned courses. */
export function carveRivers(h: Grid, rivers: RiverGeom[]) {
  for (const r of rivers) {
    const { pts, surf, width } = r;
    const lava = !!r.def.lava;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const W = Math.max(width[i], width[i + 1]);
      const R = W * 0.5 + 16;
      const box = boxOf((ax + bx) / 2, (az + bz) / 2, R + 2, h);
      const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
      for (let j = box.j0; j <= box.j1; j++) {
        const z = h.xOf(j);
        for (let ii = box.i0; ii <= box.i1; ii++) {
          const x = h.xOf(ii), k = j * h.n + ii;
          const t = clamp(((x - ax) * vx + (z - az) * vz) / L2, 0, 1);
          const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
          const halfW = lerp(width[i], width[i + 1], t) * 0.5 * (1 + 0.12 * fbm(nR, x / 14, z / 14, 2));
          if (d > halfW + 16) continue;
          const sv = lerp(surf[i], surf[i + 1], t);
          // channel: 0.55 m deep at the banks' foot, up to ~1.1 m mid-channel for wide rivers
          const maxDepth = lava ? 0.9 : Math.min(1.25, 0.45 + halfW * 0.09);
          const q = d / halfW;
          const bed = sv - maxDepth * (1 - q * q) - 0.12;
          const cur = h.data[k];
          if (q < 1) { h.data[k] = Math.min(cur, bed); continue; }
          // banks: dip to just above the water near the channel, natural levee where ground is too low
          const bank = sv + 0.15 + (d - halfW) * 0.45;
          if (cur > bank) h.data[k] = lerp(bank, cur, smooth(0, 16, d - halfW));
          else if (d - halfW < 3) h.data[k] = Math.max(cur, sv + 0.2);
        }
      }
    }
  }
}

/** Waterfalls: rampart falls at each mountain-born river, plus designated terrace falls. */
export function findFalls(h: Grid, rivers: RiverGeom[]): FallOut[] {
  const falls: FallOut[] = [];
  for (const r of rivers) {
    const { pts, surf, width, def } = r;
    if (RAMPART_FALLS.includes(def.id)) {
      // walk upstream (away from the river's first direction) to the rampart lip
      const [x0, z0] = pts[0];
      let dx = pts[0][0] - pts[4][0], dz = pts[0][1] - pts[4][1];
      const dl = Math.hypot(dx, dz); dx /= dl; dz /= dl;
      let lipX = x0, lipZ = z0, top = surf[0];
      for (let step = 1; step < 60; step++) {
        const x = x0 + dx * step, z = z0 + dz * step;
        const v = h.sample(x, z);
        if (v > top) { top = v; lipX = x; lipZ = z; }
        if (v < top - 2 && top > surf[0] + 12) break;
      }
      falls.push({ id: `${def.id}_fall`, river: def.id, x: lipX, z: lipZ, top: top - 0.6, bottom: surf[0], dx: -dx, dz: -dz, width: width[0] * 0.9 });
      // notch the lip so the water appears to spill from a cleft
      notch(h, lipX, lipZ, -dx, -dz, width[0] * 0.8, top - 1.4);
    }
    for (const ci of def.falls ?? []) {
      const [cx, cz] = def.pts[ci];
      let bi = 1, bd = 1e9;
      pts.forEach(([x, z], i) => { const d = Math.hypot(x - cx, z - cz); if (d < bd) { bd = d; bi = Math.max(1, i); } });
      const [ax, az] = pts[bi - 1], [bx, bz] = pts[bi];
      const L = Math.hypot(bx - ax, bz - az) || 1;
      falls.push({ id: `${def.id}_fall${ci}`, river: def.id, x: bx, z: bz, top: surf[bi - 1], bottom: surf[bi], dx: (bx - ax) / L, dz: (bz - az) / L, width: width[bi] * 1.1 });
    }
  }
  return falls;
}

/** Cut a small cleft through a cliff lip (for waterfalls), down to `floor`. */
function notch(h: Grid, x: number, z: number, dx: number, dz: number, w: number, floor: number) {
  const box = boxOf(x, z, 12, h);
  for (let j = box.j0; j <= box.j1; j++) {
    const zz = h.xOf(j);
    for (let i = box.i0; i <= box.i1; i++) {
      const xx = h.xOf(i), k = j * h.n + i;
      const u = (xx - x) * dx + (zz - z) * dz;
      const v = (xx - x) * -dz + (zz - z) * dx;
      if (u > 2 || u < -10) continue;
      const e = Math.abs(v) - w * 0.5;
      const cleft = floor + (e > 0 ? e * 2.5 : 0) + Math.max(0, -u - 3) * 0.4;
      if (h.data[k] > cleft) h.data[k] = cleft;
    }
  }
}

/** Water-surface field at 1024²: surface height and kind per texel (0 kind = dry). */
export function waterField(h: Grid, lakes: LakeOut[], rivers: RiverGeom[], n = 1024) {
  const surf = new Grid(n);
  const kind = new Uint8Array(n * n);
  const cell = 2048 / n;
  // ocean: flood fill from the world border through cells below sea level
  const below = (i: number, j: number) => h.sample(-1024 + i * cell, -1024 + j * cell) < SEA + 0.02;
  const seen = new Uint8Array(n * n);
  const stack: number[] = [];
  for (let i = 0; i < n; i++) { stack.push(i, (n - 1) * n + i, i * n, i * n + n - 1); }
  while (stack.length) {
    const c = stack.pop()!;
    if (seen[c]) continue;
    seen[c] = 1;
    const i = c % n, j = (c / n) | 0;
    if (!below(i, j)) {
      // shoreline texel: keep a water value so bilinear sampling reaches the waterline
      kind[c] = WK.ocean; surf.data[c] = SEA; continue;
    }
    kind[c] = WK.ocean; surf.data[c] = SEA;
    if (i > 0) stack.push(c - 1);
    if (i < n - 1) stack.push(c + 1);
    if (j > 0) stack.push(c - n);
    if (j < n - 1) stack.push(c + n);
  }
  // lakes
  for (const L of lakes) {
    const R = Math.max(L.rx, L.rz) * 1.4 + 8;
    const i0 = Math.max(0, Math.floor((L.x - R + 1024) / cell)), i1 = Math.min(n - 1, Math.ceil((L.x + R + 1024) / cell));
    const j0 = Math.max(0, Math.floor((L.z - R + 1024) / cell)), j1 = Math.min(n - 1, Math.ceil((L.z + R + 1024) / cell));
    const kd = KIND_OF[L.kind as LakeDef['kind']] ?? WK.lake;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -1024 + i * cell, z = -1024 + j * cell;
      if (lakeSDF(L, x, z) < 4 && h.sample(x, z) < L.level + 1.5) { const c = j * n + i; kind[c] = kd; surf.data[c] = L.level; }
    }
  }
  // rivers
  for (const r of rivers) {
    const kd = r.def.lava ? WK.lava : WK.river;
    for (let q = 0; q < r.pts.length - 1; q++) {
      const [ax, az] = r.pts[q], [bx, bz] = r.pts[q + 1];
      const W = Math.max(r.width[q], r.width[q + 1]) * 0.5 + 4;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - W + 1024) / cell)), i1 = Math.min(n - 1, Math.ceil((Math.max(ax, bx) + W + 1024) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - W + 1024) / cell)), j1 = Math.min(n - 1, Math.ceil((Math.max(az, bz) + W + 1024) / cell));
      const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = -1024 + i * cell, z = -1024 + j * cell;
        const t = clamp(((x - ax) * vx + (z - az) * vz) / L2, 0, 1);
        const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
        if (d > W) continue;
        const sv = lerp(r.surf[q], r.surf[q + 1], t);
        const c = j * n + i;
        if (kind[c] === WK.ocean || kind[c] === WK.lake) { if (sv > surf.data[c] + 0.05) { kind[c] = kd; surf.data[c] = sv; } continue; }
        if (!kind[c] || sv > surf.data[c]) { kind[c] = kd; surf.data[c] = sv; }
      }
    }
  }
  return { surf, kind };
}

export function riversOut(rivers: RiverGeom[]): RiverOut[] {
  return rivers.map((r) => {
    const idx: number[] = [];
    for (let i = 0; i < r.pts.length; i += 2) idx.push(i);
    if (idx[idx.length - 1] !== r.pts.length - 1) idx.push(r.pts.length - 1);
    return {
      id: r.def.id, name: r.def.name, region: r.def.region, lava: !!r.def.lava,
      pts: idx.map((i) => [+r.pts[i][0].toFixed(2), +r.surf[i].toFixed(3), +r.pts[i][1].toFixed(2), +r.width[i].toFixed(2)] as [number, number, number, number]),
    };
  });
}

export { KIND_OF };
