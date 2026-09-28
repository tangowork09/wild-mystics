// Gameplay + material fields at 1024² (2 m): region, meadow grass, tall-grass encounter patches,
// forests, splat weights, macro colour variation, ambient occlusion and lava.

import { Grid, blur, slopeGrid, downsample } from './grid';
import type { LineField } from './lines';
import { simplex, fbm, ridged, seedOf, clamp, lerp, smooth, hash2 } from './noise';
import { SEA, ZI, ZONES, SPURS, GATES, MC, bearingOf, type Pad, SALT_FLAT, GLACIER, CALDERA_DEF } from './design';
import { landAtBearing, skirtRadius, crownHalf, SPUR_LINES } from './shape';
import { sampleLine } from './carve';
import { WK } from './hydro';

export const FN = 1024;
export const LAYERS = ['grass', 'drygrass', 'forest', 'dirt', 'cobble', 'rock', 'sand', 'snow', 'ash', 'mud'] as const;
export type Layer = typeof LAYERS[number];

export interface Fields {
  region: Uint8Array;
  grass: Float32Array; tall: Float32Array; forest: Float32Array;
  path: Float32Array; cobble: Float32Array; plaza: Float32Array; lava: Float32Array;
  splat: Float32Array[]; // LAYERS order
  macro: Float32Array; accent: Float32Array; ao: Float32Array; wet: Float32Array;
  slope: Float32Array;
}

const LUSH: Record<string, number> = { vale: 1, lakes: 0.95, coast: 0.85, marsh: 0.8, elder: 0.85, scar: 0.3, dunes: 0.12, peaks: 0.6, hollows: 0.5, summit: 0.4 };
const TALL: Record<string, number> = { vale: 0.3, lakes: 0.26, coast: 0.26, marsh: 0.3, scar: 0.18, elder: 0.24, dunes: 0.14, peaks: 0.2, hollows: 0.2, summit: 0.1 };
const FOREST: Record<string, number> = { vale: 0.2, lakes: 0.42, coast: 0.16, marsh: 0.3, scar: 0.08, elder: 0.62, dunes: 0.03, peaks: 0.34, hollows: 0.13, summit: 0.05 };

/** Region (zone index) per texel: massif + Crown valley = summit; spur crests split the lands. */
export function regionField(spur: LineField): Uint8Array {
  const out = new Uint8Array(FN * FN);
  // which side of each spur line belongs to which land
  const sideA: number[] = SPUR_LINES.map((L, i) => {
    const [a] = SPURS[i].between;
    const zA = ZONES.find((z) => z.id === a)!.town.pos;
    const k = Math.min(L.pts.length - 2, Math.round(L.sGate / 2));
    const [ax, az] = L.pts[k], [bx, bz] = L.pts[k + 1];
    const vx = bx - ax, vz = bz - az;
    return Math.sign(vx * (zA[1] - az) - vz * (zA[0] - ax)) || 1;
  });
  for (let j = 0; j < FN; j++) {
    const z = -1024 + j * 2;
    for (let i = 0; i < FN; i++) {
      const x = -1024 + i * 2, c = j * FN + i;
      const dx = x - MC[0], dz = z - MC[1];
      const d = Math.hypot(dx, dz);
      let id: string;
      const inCrown = z > 100 && z < 300 && Math.abs(x) < crownHalf(z) + 6;
      if (d < skirtRadius(bearingOf(dx, dz)) - 44 || inCrown) id = 'summit';
      else {
        const L = sampleLine(spur, x, z);
        if (L.id >= 0 && L.lat < 1e8) { const [a, b] = SPURS[L.id].between; id = Math.sign(L.lat) === sideA[L.id] ? a : b; }
        else id = landAtBearing(bearingOf(x, z)).id;
      }
      out[c] = ZI[id];
    }
  }
  return out;
}

/** Horizon-based ambient occlusion (sky visibility) at FN². */
export function aoField(h: Grid): Float32Array {
  const hs = downsample(h, FN);
  const n = FN, H = hs.data, cell = 2;
  const out = new Float32Array(n * n);
  const dirs = 10, steps = 12;
  const DX: number[] = [], DZ: number[] = [];
  for (let d = 0; d < dirs; d++) { const a = (d / dirs) * Math.PI * 2 + 0.3; DX.push(Math.cos(a)); DZ.push(Math.sin(a)); }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const h0 = H[j * n + i];
      let occ = 0;
      for (let d = 0; d < dirs; d++) {
        let maxT = 0;
        let dist = 1.5;
        for (let s = 0; s < steps; s++) {
          dist *= 1.32;
          const ii = Math.round(i + DX[d] * dist), jj = Math.round(j + DZ[d] * dist);
          if (ii < 0 || jj < 0 || ii >= n || jj >= n) break;
          const t = (H[jj * n + ii] - h0) / (dist * cell);
          if (t > maxT) maxT = t;
        }
        occ += Math.atan(maxT) / (Math.PI / 2);
      }
      out[j * n + i] = clamp(1 - (occ / dirs) * 1.25, 0, 1);
    }
  }
  return out;
}

const nG = simplex(seedOf('grassf'));
const nT = simplex(seedOf('tallf'));
const nFo = simplex(seedOf('forestf'));
const nSp = simplex(seedOf('splat'));

export function buildFields(
  H: Grid, spur: LineField, ridge: Grid,
  water: { surf: Grid; kind: Uint8Array },
  roads: { path: Float32Array; cobble: Float32Array },
  pads: Pad[], padLevels: Map<string, number>,
): Fields {
  const n = FN, N = n * n;
  const hs = downsample(H, n);
  const slope = slopeGrid(hs, 1).data; // 4 m baseline (matches the runtime slopeAt)
  const region = regionField(spur);
  const ao = aoField(H);
  const rockC = blur(ridge, 2).data;
  const relief = blur(hs, 20);
  const pathNear = blur(new Grid(n, roads.path.slice()), 4).data;
  const regionOf = (c: number) => ZONES[region[c]].id;

  // distance to the ocean (for beaches), in texels, via a multi-source BFS
  const oceanDist = new Float32Array(N).fill(1e9);
  const q: number[] = [];
  for (let c = 0; c < N; c++) if (water.kind[c] === WK.ocean && hs.data[c] < SEA) { oceanDist[c] = 0; q.push(c); }
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi], i = c % n, j = (c / n) | 0, d0 = oceanDist[c];
    if (d0 > 40) continue;
    for (const o of [c - 1, c + 1, c - n, c + n]) {
      if (o < 0 || o >= N || Math.abs((o % n) - i) > 1) continue;
      if (oceanDist[o] > d0 + 1) { oceanDist[o] = d0 + 1; q.push(o); }
    }
    void j;
  }
  // wetness: near any water surface (lakes, rivers, marsh), for mud / wet sand / reeds
  const wetSrc = new Grid(n);
  for (let c = 0; c < N; c++) wetSrc.data[c] = water.kind[c] && water.kind[c] !== WK.lava && water.surf.data[c] > hs.data[c] - 0.2 ? 1 : 0;
  const wet = blur(wetSrc, 3).data;

  // pad masks
  const padCore = new Float32Array(N), plaza = new Float32Array(N), padNear = new Float32Array(N);
  for (const p of pads) {
    const R = p.r + p.blend + 10;
    const i0 = Math.max(0, Math.floor((p.x - R + 1024) / 2)), i1 = Math.min(n - 1, Math.ceil((p.x + R + 1024) / 2));
    const j0 = Math.max(0, Math.floor((p.z - R + 1024) / 2)), j1 = Math.min(n - 1, Math.ceil((p.z + R + 1024) / 2));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * n + i, d = Math.hypot(-1024 + i * 2 - p.x, -1024 + j * 2 - p.z);
      padCore[c] = Math.max(padCore[c], 1 - smooth(p.r - 2, p.r + 2, d));
      padNear[c] = Math.max(padNear[c], 1 - smooth(p.r + 4, p.r + 10, d));
      if (p.plaza) plaza[c] = Math.max(plaza[c], 1 - smooth(p.plaza - 1.5, p.plaza + 1.5, d));
      if (p.kind === 'homestead') plaza[c] = Math.max(plaza[c], (1 - smooth(p.r - 6, p.r - 3, d)) * 0.3);
      if (p.kind === 'plateau') plaza[c] = Math.max(plaza[c], (1 - smooth(20, 24, d)) * 0.8);
    }
  }
  void padLevels;

  // ── forest: large clustered blobs, thresholded per land to hit its coverage target ──
  const fNoise = new Float32Array(N);
  const allowF = new Float32Array(N);
  for (let j = 0; j < n; j++) {
    const z = -1024 + j * 2;
    for (let i = 0; i < n; i++) {
      const x = -1024 + i * 2, c = j * n + i;
      const wx = x + 40 * fbm(nFo, x / 300, z / 300, 2), wz = z + 40 * fbm(nFo, x / 300 + 7, z / 300, 2);
      fNoise[c] = fbm(nFo, wx / 150, wz / 150, 4) + 0.3 * fbm(nFo, x / 38 + 3, z / 38, 2);
      const h = hs.data[c];
      const dry = !water.kind[c] || water.surf.data[c] < h - 0.3 || water.kind[c] === WK.ocean && h > SEA + 0.3;
      let a = dry ? 1 : 0;
      a *= 1 - smooth(0.75, 1.0, slope[c]);
      a *= 1 - smooth(0.0, 0.15, pathNear[c]);
      a *= 1 - padNear[c];
      a *= smooth(3, 8, oceanDist[c]);
      a *= 1 - smooth(0.3, 0.6, wet[c]) * 0.7;
      const id = regionOf(c);
      const tree = id === 'peaks' || id === 'summit' ? 150 : 170;
      a *= 1 - smooth(tree - 15, tree, h);
      allowF[c] = a;
    }
  }
  const forest = new Float32Array(N);
  for (const z of ZONES) {
    const zi = ZI[z.id];
    const vals: number[] = [];
    for (let c = 0; c < N; c += 3) if (region[c] === zi && allowF[c] > 0.5) vals.push(fNoise[c]);
    vals.sort((a, b) => a - b);
    const thr = vals.length ? vals[Math.floor(vals.length * (1 - FOREST[z.id]))] ?? 1 : 1;
    for (let c = 0; c < N; c++) if (region[c] === zi) forest[c] = smooth(thr - 0.06, thr + 0.1, fNoise[c]) * allowF[c];
  }
  // designed groves
  const grove = (x: number, z: number, r: number, v: number) => {
    const i0 = Math.max(0, Math.floor((x - r * 1.5 + 1024) / 2)), i1 = Math.min(n - 1, Math.ceil((x + r * 1.5 + 1024) / 2));
    const j0 = Math.max(0, Math.floor((z - r * 1.5 + 1024) / 2)), j1 = Math.min(n - 1, Math.ceil((z + r * 1.5 + 1024) / 2));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * n + i, d = Math.hypot(-1024 + i * 2 - x, -1024 + j * 2 - z);
      forest[c] = Math.max(forest[c], v * (1 - smooth(r * 0.7, r * 1.5, d)) * allowF[c]);
    }
  };
  grove(-196, 778, 48, 1); grove(-600, -338, 62, 1); grove(40, 740, 26, 0.7); grove(-40, 450, 30, 0.6);

  // ── grass & tall grass ──
  const grass = new Float32Array(N), tall = new Float32Array(N);
  for (let j = 0; j < n; j++) {
    const z = -1024 + j * 2;
    for (let i = 0; i < n; i++) {
      const x = -1024 + i * 2, c = j * n + i;
      const h = hs.data[c];
      const id = regionOf(c);
      const dry = !water.kind[c] || water.surf.data[c] < h - 0.05;
      if (!dry || h < SEA + 0.3) continue;
      let g = LUSH[id] ?? 0.7;
      g *= 1 - smooth(0.55, 0.95, slope[c]);
      g *= 1 - smooth(0.2, 0.7, roads.path[c]);
      g *= 1 - plaza[c];
      g *= smooth(2, 7, oceanDist[c]);
      g *= 1 - smooth(0.4, 0.9, rockC[c]) * smooth(0.3, 0.6, slope[c]);
      g *= 1 - forest[c] * 0.45;
      g *= 1 - smooth(165, 185, h);
      g *= 0.72 + 0.28 * (fbm(nG, x / 26, z / 26, 3) * 0.5 + 0.5);
      if (id === 'dunes') g *= smooth(0.2, 0.6, fbm(nG, x / 90 + 4, z / 90, 3) * 0.5 + 0.5) * 0.6;
      grass[c] = clamp(g, 0, 1);
      // tall grass: clumped patches in open meadow, never on roads, pads or shores
      let t = fbm(nT, x / 52, z / 52, 3) + 0.35 * fbm(nT, x / 17 + 5, z / 17, 2);
      const want = TALL[id] ?? 0.2;
      t = smooth(0.55 - want * 1.3, 0.62 - want * 1.3, t);
      if (Math.hypot(x - 120, z - 700) < 58) t = Math.max(t, 1 - smooth(40, 58, Math.hypot(x - 120, z - 700))); // Whisperwind Meadow
      t *= 1 - smooth(0.0, 0.06, pathNear[c]);
      t *= 1 - padNear[c];
      t *= 1 - smooth(0.05, 0.3, wet[c]);
      t *= smooth(0.35, 0.6, g);
      t *= 1 - smooth(0.45, 0.7, forest[c]);
      tall[c] = clamp(t, 0, 1);
    }
  }

  // ── lava ──
  const lava = new Float32Array(N);
  for (let c = 0; c < N; c++) if (water.kind[c] === WK.lava && water.surf.data[c] > hs.data[c] - 0.05) lava[c] = 1;

  // ── splat ──
  const L = LAYERS.length;
  const splat: Float32Array[] = LAYERS.map(() => new Float32Array(N));
  const macro = new Float32Array(N), accent = new Float32Array(N);
  const w = new Float32Array(L);
  const LI = Object.fromEntries(LAYERS.map((l, i) => [l, i])) as Record<Layer, number>;
  for (let j = 0; j < n; j++) {
    const z = -1024 + j * 2;
    for (let i = 0; i < n; i++) {
      const x = -1024 + i * 2, c = j * n + i;
      const h = hs.data[c], s = slope[c], id = regionOf(c);
      const n1 = fbm(nSp, x / 40, z / 40, 3), n2 = fbm(nSp, x / 13 + 7, z / 13, 2);
      w.fill(0);
      // base ground by land
      const lush = LUSH[id] ?? 0.7;
      const dryMix = clamp(smooth(0.1, 0.9, 1 - lush) + 0.25 * n1, 0, 1);
      if (id === 'scar') { w[LI.ash] = 0.7 + 0.3 * n1; w[LI.drygrass] = 0.35 * smooth(-0.2, 0.4, n1); }
      else if (id === 'dunes') { w[LI.sand] = 1; w[LI.drygrass] = 0.35 * smooth(0.1, 0.5, fbm(nG, x / 90 + 4, z / 90, 3)); }
      else if (id === 'marsh') { w[LI.grass] = 0.6; w[LI.mud] = 0.35 + 0.4 * smooth(-0.1, 0.5, n1); }
      else { w[LI.grass] = 1 - dryMix; w[LI.drygrass] = dryMix; }
      // relief: drier on knolls, lusher in hollows
      const rel = h - relief.data[c];
      if (id !== 'dunes' && id !== 'scar') { w[LI.drygrass] += smooth(1.5, 5, rel) * 0.5; w[LI.grass] += smooth(-1, -4, rel) * 0.3; }
      // forest floor under trees
      const fo = forest[c];
      if (fo > 0) { const k = smooth(0.25, 0.7, fo); for (let q2 = 0; q2 < L; q2++) w[q2] *= 1 - k * 0.85; w[LI.forest] += k; }
      // wet margins
      const wt = wet[c];
      if (wt > 0.05 && id !== 'dunes') { w[LI.mud] += smooth(0.1, 0.6, wt) * (id === 'marsh' ? 1.2 : 0.55); }
      // beaches: sand by the sea (dunes behind them on the Coast)
      const od = oceanDist[c];
      const beach = (1 - smooth(4, id === 'coast' || id === 'dunes' ? 16 : 9, od)) * (1 - smooth(0.35, 0.6, s)) * (1 - smooth(SEA + 2.4, SEA + 4.2, h));
      if (beach > 0) { for (let q2 = 0; q2 < L; q2++) w[q2] *= 1 - beach; w[LI.sand] += beach; }
      // underwater: sand in the sea, mud in lakes
      if (water.kind[c] && water.surf.data[c] > h + 0.1) {
        const uw = water.kind[c] === WK.ocean ? LI.sand : water.kind[c] === WK.lava ? LI.ash : water.kind[c] === WK.frozen ? LI.snow : LI.mud;
        for (let q2 = 0; q2 < L; q2++) w[q2] *= 0.2; w[uw] += 1;
      }
      // special lands
      {
        const sd = Math.hypot((x - SALT_FLAT.x) / SALT_FLAT.rx, (z - SALT_FLAT.z) / SALT_FLAT.rz);
        const salt = 1 - smooth(0.85, 1.1, sd);
        if (salt > 0) { for (let q2 = 0; q2 < L; q2++) w[q2] *= 1 - salt; w[LI.snow] += salt * 0.55; w[LI.sand] += salt * 0.45; }
        const cd = Math.hypot(x - CALDERA_DEF.x, z - CALDERA_DEF.z);
        const cal = 1 - smooth(CALDERA_DEF.rimR * 0.9, CALDERA_DEF.rimR * 1.6, cd);
        if (cal > 0) { w[LI.ash] += cal * 1.5; w[LI.drygrass] *= 1 - cal; w[LI.grass] *= 1 - cal; }
      }
      // glacier ice
      {
        let best = 1e9;
        const gl = GLACIER.pts;
        for (let q2 = 0; q2 < gl.length - 1; q2++) {
          const [ax, az] = gl[q2], [bx, bz] = gl[q2 + 1];
          const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
          const t = clamp(((x - ax) * vx + (z - az) * vz) / L2, 0, 1);
          best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t)));
        }
        const ice = 1 - smooth(GLACIER.width * 0.55, GLACIER.width * 0.85, best + 6 * n1);
        if (ice > 0) { for (let q2 = 0; q2 < L; q2++) w[q2] *= 1 - ice; w[LI.snow] += ice; }
      }
      // rock on steep ground and crags; scree at cliff feet
      const cragK = smooth(0.35, 0.75, rockC[c]) * smooth(0.25, 0.55, s);
      const rk = Math.max(smooth(0.72, 1.1, s + 0.12 * n2), cragK);
      if (rk > 0) {
        for (let q2 = 0; q2 < L; q2++) w[q2] *= 1 - rk;
        if (id === 'scar') w[LI.ash] += rk * 0.35;
        w[LI.rock] += rk;
      }
      // snowline on the mountain and the high peaks
      const snowLine = (id === 'peaks' ? 118 : 172) + 14 * fbm(nSp, x / 60, z / 60, 3) + 20 * smooth(0.4, 1.2, s);
      const sn = smooth(snowLine - 6, snowLine + 6, h);
      if (sn > 0) { for (let q2 = 0; q2 < L; q2++) w[q2] *= 1 - sn * (q2 === LI.rock ? 0.4 : 1); w[LI.snow] += sn; }
      // roads & plazas: crisp dirt / cobble
      const pth = roads.path[c], cob = roads.cobble[c];
      if (pth > 0.01) {
        const k = smooth(0.15, 0.7, pth);
        for (let q2 = 0; q2 < L; q2++) w[q2] *= 1 - k;
        const cobK = smooth(0.3, 0.8, cob);
        w[LI.cobble] += k * cobK;
        w[LI.dirt] += k * (1 - cobK);
      }
      const pz = plaza[c];
      if (pz > 0.01) { for (let q2 = 0; q2 < L; q2++) w[q2] *= 1 - pz; w[LI.cobble] += pz; }
      // bare patches
      const bare = smooth(0.55, 0.75, n2 * 0.6 + n1 * 0.5) * 0.35 * (id === 'vale' ? 0.5 : 1);
      if (bare > 0 && !pth) w[LI.dirt] += bare * (1 - forest[c]);
      // normalise
      let sum = 0;
      for (let q2 = 0; q2 < L; q2++) sum += w[q2];
      for (let q2 = 0; q2 < L; q2++) splat[q2][c] = sum > 0 ? w[q2] / sum : q2 === LI.grass ? 1 : 0;
      // macro colour variation: relative elevation + slow noise; accents in patches
      macro[c] = clamp(0.5 + rel * 0.06 + 0.35 * fbm(nSp, x / 180 + 3, z / 180, 3), 0, 1);
      accent[c] = clamp(smooth(0.25, 0.55, fbm(nSp, x / 70 - 9, z / 70, 3)) * 0.9 + 0.1 * hash2(i, j, 5), 0, 1);
    }
  }

  return { region, grass, tall, forest, path: roads.path, cobble: roads.cobble, plaza, lava, splat, macro, accent, ao, wet, slope };
}

export const _u = { GATES, ridged, lerp };
