// Post-erosion sculpting at full resolution: detail, walls (guaranteed cliff bands), special land
// features, flattened pads (with rock faces behind cave mouths) and the Warden Gate passes.

import { Grid } from './grid';
import type { LineField } from './lines';
import { simplex, fbm, ridged, worley, seedOf, clamp, lerp, smooth, smoother } from './noise';
import {
  SEA, MC, PLATEAU_R, SUMMIT_H, GATES, bearingOf, angDiff, dirOf, RAD,
  SALT_FLAT, ELDER_HOLLOW, GLACIER, CALDERA_DEF, type Pad,
} from './design';
import { SPUR_LINES, armParams, armLateral, skirtRadius, landBlend, crownHalf } from './shape';

/** Sample a 1024 line field at world (x,z) (nearest id, bilinear lat/s within the same id). */
export function sampleLine(f: LineField, x: number, z: number): { id: number; lat: number; s: number } {
  const n = f.n, cell = 2048 / n;
  const fx = clamp((x + 1024) / cell, 0, n - 1.001), fz = clamp((z + 1024) / cell, 0, n - 1.001);
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
  const k = j * n + i;
  const ids = [f.id[k], f.id[k + 1], f.id[k + n], f.id[k + n + 1]];
  const w = [(1 - tx) * (1 - tz), tx * (1 - tz), (1 - tx) * tz, tx * tz];
  // dominant id
  let best = -1, bw = -1;
  for (let a = 0; a < 4; a++) { if (ids[a] < 0) continue; let s = 0; for (let b = 0; b < 4; b++) if (ids[b] === ids[a]) s += w[b]; if (s > bw) { bw = s; best = ids[a]; } }
  if (best < 0) return { id: -1, lat: 1e9, s: 0 };
  let lat = 0, s = 0, ws = 0;
  const ks = [k, k + 1, k + n, k + n + 1];
  for (let a = 0; a < 4; a++) if (ids[a] === best) { lat += f.lat[ks[a]] * w[a]; s += f.s[ks[a]] * w[a]; ws += w[a]; }
  return { id: best, lat: lat / ws, s: s / ws };
}

// ── detail ───────────────────────────────────────────────────────────────────────────────────
const nD = simplex(seedOf('detail'));
const nD2 = simplex(seedOf('detail2'));
export function addDetail(h: Grid, rock: Grid) {
  const n = h.n;
  for (let j = 0; j < n; j++) {
    const z = h.xOf(j);
    for (let i = 0; i < n; i++) {
      const x = h.xOf(i), k = j * n + i;
      const r = rock.sample(x, z);
      const v = h.data[k];
      if (v < SEA - 2) { h.data[k] += 0.4 * fbm(nD, x / 9, z / 9, 2); continue; }
      const crag = (ridged(nD, x / 11, z / 11, 3) - 0.5) * 2.2 + fbm(nD2, x / 4, z / 4, 2) * 0.5;
      const soft = fbm(nD2, x / 7, z / 7, 2) * 0.22;
      h.data[k] = v + lerp(soft, crag, r);
    }
  }
}

// ── walls: guarantee the cliff bands that make spurs and the rampart impassable ─────────────────
/**
 * For every arm: in the cliff band the height is at least the designed cliff profile, and just
 * below it at most the foothill top, so a ≥13 m, >60° wall always separates foothills from crest.
 * The massif rampart gets the same treatment except inside the Crown valley.
 */
export function enforceWalls(h: Grid, spur: LineField, lowland: Grid) {
  const n = h.n;
  for (let j = 0; j < n; j++) {
    const z = h.xOf(j);
    for (let i = 0; i < n; i++) {
      const x = h.xOf(i), k = j * n + i;
      const low = lowland.sample(x, z);
      if (low < SEA - 0.5) continue; // sea: arms stand as sea cliffs already
      const base = Math.max(low, SEA);
      // arm band / foot
      let armRaise = -1e9, armCap = 1e9, armCore = false;
      const L = sampleLine(spur, x, z);
      if (L.id >= 0) {
        const Ls = SPUR_LINES[L.id];
        if (L.s > 0 && L.s < Ls.length - 20) {
          const P = armParams(L.id, L.s);
          const q = armLateral(L.lat, x, z);
          const T = P.F + P.B;
          const cliffEnd = P.Wtop + P.B / P.k;
          armCore = q < cliffEnd + 2;
          if (q < cliffEnd && q > P.Wtop - 6) armRaise = base + Math.min(T, T - (q - P.Wtop) * P.k);
          else if (q >= cliffEnd && q < cliffEnd + P.Wf + 4) {
            const t = clamp((q - cliffEnd) / P.Wf, 0, 1);
            armCap = base + P.F * (1 - t * t * (3 - 2 * t)) + 0.6;
          }
        }
      }
      // rampart band / apron (not inside the Crown valley)
      let rampRaise = -1e9, rampCap = 1e9, rampCore = false;
      const dx = x - MC[0], dz = z - MC[1];
      const d = Math.hypot(dx, dz);
      if (d > 200 && d < 440 && !(Math.abs(x) < 70 && z > 100)) {
        const dFoot = skirtRadius(bearingOf(dx, dz));
        const aprTop = dFoot - 42; // APRON_W
        const S = 10 + 22; // APRON_F + min rampart height
        const inner = aprTop - (S - 10) / 2.4;
        rampCore = d < aprTop + 2;
        if (d < aprTop && d > inner - 6) rampRaise = base + Math.min(S, S - (d - inner) * 2.4);
        else if (d >= aprTop && d < aprTop + 46) {
          const t = clamp((d - aprTop) / 42, 0, 1);
          rampCap = base + 10 * (1 - t * t * (3 - 2 * t)) + 0.6;
        }
      }
      // caps first (each skipped where the other structure owns the cell), then raises
      let v = h.data[k];
      if (!rampCore && armCap < v) v = armCap;
      if (!armCore && rampCap < v) v = rampCap;
      v = Math.max(v, armRaise, rampRaise);
      h.data[k] = v;
    }
  }
}

// ── special land features (after erosion, before water) ───────────────────────────────────────
const nF = simplex(seedOf('features'));
function ellipseSDF(x: number, z: number, cx: number, cz: number, rx: number, rz: number, rot: number) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const u = (x - cx) * c + (z - cz) * s, v = -(x - cx) * s + (z - cz) * c;
  const q = Math.hypot(u / rx, v / rz);
  return (q - 1) * Math.min(rx, rz);
}

export function carveFeatures(h: Grid) {
  const n = h.n;
  const C = CALDERA_DEF;
  const gl = GLACIER.pts;
  for (let j = 0; j < n; j++) {
    const z = h.xOf(j);
    for (let i = 0; i < n; i++) {
      const x = h.xOf(i), k = j * n + i;
      let v = h.data[k];
      // Sunscorch salt flat: dead-flat crust with a soft rim
      {
        const sd = ellipseSDF(x, z, SALT_FLAT.x, SALT_FLAT.z, SALT_FLAT.rx, SALT_FLAT.rz, SALT_FLAT.rot) + 8 * fbm(nF, x / 60, z / 60, 3);
        if (sd < 30) v = lerp(SALT_FLAT.level + 0.03 * fbm(nF, x / 3, z / 3, 2), v, smooth(-2, 30, sd));
      }
      // Elder Tree hollow: a bowl in the forest
      {
        const d = Math.hypot(x - ELDER_HOLLOW.x, z - ELDER_HOLLOW.z) * (1 + 0.12 * fbm(nF, x / 30, z / 30, 2));
        if (d < ELDER_HOLLOW.r * 1.6) v -= ELDER_HOLLOW.depth * (1 - smooth(ELDER_HOLLOW.r * 0.35, ELDER_HOLLOW.r * 1.5, d)) ** 1.3;
      }
      // Ember caldera: a ring rim with steep inner walls, a flat floor and two gaps
      {
        const dx = x - C.x, dz = z - C.z;
        const d = Math.hypot(dx, dz);
        if (d < C.rimR * 2.2) {
          const b = bearingOf(dx, dz);
          const wob = 1 + 0.08 * fbm(nF, Math.cos(b * RAD) * 2, Math.sin(b * RAD) * 2, 3);
          const rimR = C.rimR * wob;
          const outer = C.rimH * (1 - smooth(rimR, rimR * 2.1, d)) ** 1.4;
          const inner = C.rimH * smooth(C.floorR * wob, rimR, d) ** 1.8;
          let rim = d < rimR ? inner : outer;
          rim += 3 * (ridged(nF, x / 16, z / 16, 3) - 0.5) * smooth(C.floorR, rimR, d);
          // gaps: the road gap (west) and the lava breach (east)
          const gapRoad = Math.exp(-((angDiff(b, C.gap) / 9) ** 2));
          const gapLava = Math.exp(-((angDiff(b, C.lavaGap) / 11) ** 2));
          rim *= 1 - Math.max(gapRoad * 0.96, gapLava * 0.9);
          const floor = C.floorR * wob;
          const floorH = 26;
          const base = d < floor ? lerp(floorH, v, 0) : v;
          v = d < floor ? floorH + 0.6 * fbm(nF, x / 20, z / 20, 2) : lerp(floorH, base, smooth(floor, rimR * 1.1, d));
          v += rim;
        }
      }
      // Glacier valley: U-shaped trough from the rampart to the snout, filled with a smooth ice sheet
      {
        let best = 1e9, bt = 0;
        for (let q = 0; q < gl.length - 1; q++) {
          const [ax, az] = gl[q], [bx, bz] = gl[q + 1];
          const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
          const t = clamp(((x - ax) * vx + (z - az) * vz) / L2, 0, 1);
          const dd = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
          if (dd < best) { best = dd; bt = (q + t) / (gl.length - 1); }
        }
        const W = GLACIER.width * (1 - 0.35 * bt);
        if (best < W * 1.8) {
          const iceH = lerp(118, 74, Math.pow(bt, 0.9));
          const trough = iceH + 0.8 * fbm(nF, x / 25, z / 25, 2) + (best / W) ** 2 * 6;
          const k2 = 1 - smooth(W * 0.9, W * 1.8, best);
          v = lerp(v, Math.min(v, trough), k2 * smooth(1.04, 0.96, bt));
        }
      }
      h.data[k] = v;
    }
  }
}

/** Wind dunes, marsh hummocks and meadow swells: shaped after erosion so they stay crisp. */
export function addLandforms(h: Grid, region: (x: number, z: number) => { a: string; b: string; wb: number }) {
  const n = h.n;
  const nd = simplex(seedOf('dunes')), nh = simplex(seedOf('hummock'));
  for (let j = 0; j < n; j++) {
    const z = h.xOf(j);
    for (let i = 0; i < n; i++) {
      const x = h.xOf(i), k = j * n + i;
      const v = h.data[k];
      if (v < SEA + 0.3) continue;
      const { a, b, wb } = region(x, z);
      const wd = (a === 'dunes' ? 1 - wb : 0) + (b === 'dunes' ? wb : 0);
      const wm = (a === 'marsh' ? 1 - wb : 0) + (b === 'marsh' ? wb : 0);
      let add = 0;
      if (wd > 0.01) {
        // transverse dunes: asymmetric (gentle windward, steep lee), crest lines warped by noise
        const sx = SALT_FLAT;
        const flat = smooth(0, 40, Math.hypot((x - sx.x) / sx.rx, (z - sx.z) / sx.rz) * 60 - 60);
        const warp = 30 * fbm(nd, x / 180, z / 180, 3);
        const u = (x * 0.8 + z * 0.6 + warp) / 70;
        const f = u - Math.floor(u);
        const prof = f < 0.72 ? smooth(0, 0.72, f) : 1 - smooth(0.72, 1, f);
        const amp = 7 * (0.5 + 0.5 * fbm(nd, x / 260 + 5, z / 260, 3)) * smooth(0.1, 0.5, fbm(nd, x / 400 - 3, z / 400, 2) * 0.5 + 0.5 + 0.2);
        const big = 16 * Math.exp(-(((x - 660) ** 2 + (z + 505) ** 2) / (2 * 55 * 55))); // the Sandjaw's great dune
        add += wd * flat * (prof * amp + big);
      }
      if (wm > 0.01) {
        const [f1, , id] = worley(x / 14, z / 14, seedOf('hum'));
        const hum = smooth(0.45, 0.1, f1) * (0.6 + 0.9 * id);
        add += wm * (hum * smooth(-0.2, 0.4, fbm(nh, x / 80, z / 80, 2)) + 0.25 * fbm(nh, x / 10, z / 10, 2));
      }
      h.data[k] = v + add;
    }
  }
}

// ── pads ───────────────────────────────────────────────────────────────────────────────────────
export interface PadGroup { pads: Pad[]; level: number }

/** Group pads whose skirts overlap; each group shares one level. */
export function groupPads(pads: Pad[]): Pad[][] {
  const parent = pads.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let a = 0; a < pads.length; a++) {
    for (let b = a + 1; b < pads.length; b++) {
      const A = pads[a], B = pads[b];
      if (A.kind === 'plateau' || B.kind === 'plateau') continue;
      const joined = (A.group && A.group === B.group) || Math.hypot(A.x - B.x, A.z - B.z) < A.r + B.r + (A.blend + B.blend) * 0.8;
      if (joined) parent[find(a)] = find(b);
    }
  }
  const groups = new Map<number, Pad[]>();
  pads.forEach((p, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(p); });
  return [...groups.values()];
}

/** Choose a level for a group: area-weighted median of the ground in the cores, kept dry. */
export function padLevel(h: Grid, group: Pad[], water?: (x: number, z: number) => number | null): number {
  const forced = group.find((p) => p.level !== undefined);
  if (forced) return forced.level!;
  const vals: number[] = [];
  let minLevel = SEA + 1.6;
  for (const p of group) {
    for (let dz = -p.r; dz <= p.r; dz += 2) {
      for (let dx = -p.r; dx <= p.r; dx += 2) {
        if (dx * dx + dz * dz > p.r * p.r) continue;
        const x = p.x + dx, z = p.z + dz;
        vals.push(h.sample(x, z));
        const w = water?.(x, z);
        if (w != null) minLevel = Math.max(minLevel, w + 1.0);
      }
    }
  }
  vals.sort((a, b) => a - b);
  return Math.max(minLevel, vals[Math.floor(vals.length * 0.5)]);
}

const nP = simplex(seedOf('pads'));
/** Flatten one pad group into the terrain with a natural, noisy skirt. */
export function flattenGroup(h: Grid, group: Pad[], level: number) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const p of group) { const R = p.r + p.blend + 6; x0 = Math.min(x0, p.x - R); x1 = Math.max(x1, p.x + R); z0 = Math.min(z0, p.z - R); z1 = Math.max(z1, p.z + R); }
  const i0 = Math.max(0, Math.floor(h.iOf(x0))), i1 = Math.min(h.n - 1, Math.ceil(h.iOf(x1)));
  const j0 = Math.max(0, Math.floor(h.iOf(z0))), j1 = Math.min(h.n - 1, Math.ceil(h.iOf(z1)));
  for (let j = j0; j <= j1; j++) {
    const z = h.xOf(j);
    for (let i = i0; i <= i1; i++) {
      const x = h.xOf(i), k = j * h.n + i;
      let w = 0;
      for (const p of group) {
        const d = Math.hypot(x - p.x, z - p.z);
        const ang = Math.atan2(z - p.z, x - p.x);
        const wob = p.kind === 'plateau' ? 0 : 0.18 * fbm(nP, Math.cos(ang) * 2 + p.x * 0.01, Math.sin(ang) * 2 + p.z * 0.01, 3);
        const e = (d - p.r) / (p.blend * (1 + wob));
        w = Math.max(w, 1 - smoother(0, 1, e));
      }
      if (w <= 0) continue;
      const v = h.data[k];
      // don't raise the sea floor into land (towns by the harbour keep their water)
      if (v < SEA - 0.3 && w < 0.999) continue;
      h.data[k] = lerp(v, level, w);
    }
  }
}

/**
 * Raise a craggy outcrop behind a cave-type entrance (the pad's `face` is the bearing it opens to):
 * a lumpy half-dome whose front is a near-vertical rock face at the back edge of the pad.
 */
export function rockFace(h: Grid, p: Pad, level: number) {
  if (p.face === undefined) return;
  const [fx, fz] = dirOf(p.face);
  const R = p.r + 34;
  const i0 = Math.max(0, Math.floor(h.iOf(p.x - R))), i1 = Math.min(h.n - 1, Math.ceil(h.iOf(p.x + R)));
  const j0 = Math.max(0, Math.floor(h.iOf(p.z - R))), j1 = Math.min(h.n - 1, Math.ceil(h.iOf(p.z + R)));
  const H = 12 + 4 * (fbm(nP, p.x * 0.1, p.z * 0.1, 2) * 0.5 + 0.5);
  const ru = 17, rv = 21; // outcrop radii (depth, width)
  const cu = -(p.r * 0.6 + ru * 0.7); // outcrop centre, behind the entrance
  for (let j = j0; j <= j1; j++) {
    const z = h.xOf(j);
    for (let i = i0; i <= i1; i++) {
      const x = h.xOf(i), k = j * h.n + i;
      const u = (x - p.x) * fx + (z - p.z) * fz; // + towards the approach
      const v = (x - p.x) * -fz + (z - p.z) * fx;
      const ang = Math.atan2(v, u - cu);
      const wob = 1 + 0.22 * fbm(nP, Math.cos(ang) * 1.7 + p.x, Math.sin(ang) * 1.7 + p.z, 3);
      const q = Math.hypot((u - cu) / ru, v / rv) / wob;
      if (q > 1.6) continue;
      let dome = Math.pow(Math.max(0, 1 - q * q), 0.45);
      // front: cut into a steep face at the back edge of the pad
      const front = u - (-p.r * 0.55);
      if (front > 0) dome *= 1 - smooth(0, 2.5, front);
      const crag = 0.75 + 0.5 * ridged(nP, x / 6, z / 6, 3);
      const skirt = (1 - smooth(1.0, 1.6, q)) * 2.5 * (front > 0 ? 0 : 1);
      const face = level + H * dome * crag + skirt;
      if (h.data[k] < face) h.data[k] = face;
    }
  }
}

// ── Warden Gate passes ─────────────────────────────────────────────────────────────────────────
export interface Pass { id: string; x: number; z: number; tx: number; tz: number; halfLen: number; halfW: number; levelA: number; levelB: number }

/**
 * Cut an 18–24 m pass through the arm at each gate: a flat-floored corridor along the ring road's
 * tangent, with near-vertical walls up to the crest on both sides. Returns the pass geometry so
 * roads can thread it exactly.
 */
export function cutPasses(h: Grid, spur: LineField): Pass[] {
  const out: Pass[] = [];
  for (const g of GATES) {
    if (g.id === 'g_crown') continue;
    const [gx, gz] = g.pos;
    const L = sampleLine(spur, gx, gz);
    const P = armParams(L.id, L.s);
    const halfLen = P.Wtop + P.B / P.k + 16;
    // pass direction: perpendicular to the spur line at the gate
    const pts = SPUR_LINES[L.id].pts;
    let bi = 0, bd = 1e9;
    pts.forEach((p, q) => { const d = Math.hypot(p[0] - gx, p[1] - gz); if (d < bd) { bd = d; bi = q; } });
    const a = pts[Math.max(0, bi - 3)], b = pts[Math.min(pts.length - 1, bi + 3)];
    let sx = b[0] - a[0], sz = b[1] - a[1];
    const sl = Math.hypot(sx, sz); sx /= sl; sz /= sl;
    const tx = -sz, tz = sx;
    const halfW = 11;
    const levelA = h.sample(gx + tx * (halfLen + 6), gz + tz * (halfLen + 6));
    const levelB = h.sample(gx - tx * (halfLen + 6), gz - tz * (halfLen + 6));
    const mid = (levelA + levelB) / 2;
    const R = halfLen + 30;
    const i0 = Math.max(0, Math.floor(h.iOf(gx - R))), i1 = Math.min(h.n - 1, Math.ceil(h.iOf(gx + R)));
    const j0 = Math.max(0, Math.floor(h.iOf(gz - R))), j1 = Math.min(h.n - 1, Math.ceil(h.iOf(gz + R)));
    for (let j = j0; j <= j1; j++) {
      const z = h.xOf(j);
      for (let i = i0; i <= i1; i++) {
        const x = h.xOf(i), k = j * h.n + i;
        const u = (x - gx) * tx + (z - gz) * tz;
        const v = (x - gx) * sx + (z - gz) * sz;
        if (Math.abs(u) > halfLen + 20) continue;
        // floor: flat core at the mean level, easing to each side's ground
        const t = clamp(u / halfLen, -1, 1);
        const sideH = t >= 0 ? lerp(mid, levelA, smooth(0.25, 1, t)) : lerp(mid, levelB, smooth(0.25, 1, -t));
        const wob = 1.2 * fbm(nP, u / 18 + g.pos[0], 3.3, 2);
        const e = Math.abs(v) - (halfW + wob);
        const wallH = sideH + (e > 0 ? e * 3.2 + e * e * 0.05 : 0);
        const endFade = 1 - smooth(halfLen, halfLen + 18, Math.abs(u));
        const cur = h.data[k];
        if (wallH < cur) h.data[k] = lerp(cur, wallH, endFade);
        else if (e < 0 && endFade > 0.5) h.data[k] = lerp(cur, sideH, endFade); // fill any hollow in the floor
      }
    }
    out.push({ id: g.id, x: gx, z: gz, tx, tz, halfLen, halfW, levelA, levelB });
  }
  return out;
}

export { landBlend, crownHalf, SUMMIT_H, PLATEAU_R };
