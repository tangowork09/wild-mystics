// Pure, DOM-free world bake. Runs inside a Web Worker (bake.worker.ts) and the result is cached in
// IndexedDB, so a phone only pays for it once. Everything is deterministic from the zone data.

import { makeNoise2D, fbm, clamp, lerp } from '../core/noise';
import { ZONES, WORLD_SIZE, WATER_LEVEL, HOMESTEAD, zoneWeights } from '../data/zones';

export const RES = 512;
export const CRES = 128; // colour-field resolution (zones blend smoothly, so this can be coarse)
const HALF = WORLD_SIZE / 2;
const CELL = WORLD_SIZE / (RES - 1);
export const BAKE_VERSION = 4;

const n1 = makeNoise2D(1337);
const n2 = makeNoise2D(4242);
const n3 = makeNoise2D(99);

export interface Feature { x: number; z: number; r: number; kind: 'town' | 'outpost' | 'camp' | 'arena' | 'homestead' | 'waystone' }

export const FEATURES: Feature[] = [
  ...ZONES.flatMap((z) => [
    { x: z.town.pos[0], z: z.town.pos[1], r: z.town.kind === 'town' ? 34 : 24, kind: z.town.kind === 'town' ? 'town' as const : 'outpost' as const },
    { x: z.camp[0], z: z.camp[1], r: 9, kind: 'camp' as const },
    { x: z.boss.pos[0], z: z.boss.pos[1], r: 22, kind: 'arena' as const },
  ]),
  { x: HOMESTEAD.center[0], z: HOMESTEAD.center[1], r: HOMESTEAD.radius, kind: 'homestead' },
];

/** Road network: hub town → every other town, hub → homestead, each town → its camp → arena. */
export const PATHS: [number, number][][] = (() => {
  const hub = ZONES[0].town.pos;
  const out: [number, number][][] = [];
  const curve = (a: [number, number], b: [number, number], bend: number): [number, number][] => {
    const pts: [number, number][] = [];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const nx = -dz, nz = dx;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(8, Math.round(len / 7));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const off = Math.sin(t * Math.PI) * bend + n3(t * 3 + a[0] * 0.01, a[1] * 0.01) * 6 * Math.sin(t * Math.PI);
      pts.push([a[0] + dx * t + (nx / len) * off, a[1] + dz * t + (nz / len) * off]);
    }
    return pts;
  };
  for (const z of ZONES.slice(1)) out.push(curve(hub, z.town.pos, 22));
  out.push(curve(hub, HOMESTEAD.center, 4));
  for (const z of ZONES) {
    out.push(curve(z.town.pos, z.camp, 10));
    out.push(curve(z.camp, z.boss.pos, 3));
  }
  return out;
})();

const SEGS: number[] = [];
for (const p of PATHS) for (let i = 0; i < p.length - 1; i++) SEGS.push(p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]);

export function distToPaths(x: number, z: number): number {
  let best = 1e9;
  for (let s = 0; s < SEGS.length; s += 4) {
    const ax = SEGS[s], az = SEGS[s + 1], bx = SEGS[s + 2], bz = SEGS[s + 3];
    if (x < Math.min(ax, bx) - best || x > Math.max(ax, bx) + best || z < Math.min(az, bz) - best || z > Math.max(az, bz) + best) continue;
    const vx = bx - ax, vz = bz - az;
    const t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
    const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
    if (d < best) best = d;
  }
  return best;
}

export const smooth = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

function blend(w: number[], f: (i: number) => number) {
  let s = 0;
  for (let i = 0; i < w.length; i++) if (w[i] > 0.001) s += w[i] * f(i);
  return s;
}

/** Raw analytic height before feature flattening; each land contributes its own terrain recipe. */
function rawHeight(x: number, z: number, w: number[], oct = 5): number {
  const T = (i: number) => ZONES[i].terrain;
  const base = blend(w, (i) => T(i).base);
  const ridges = blend(w, (i) => T(i).ridges);
  const mesas = blend(w, (i) => T(i).mesas);
  const dunes = blend(w, (i) => T(i).dunes);
  const lakes = blend(w, (i) => T(i).lakes);
  const pools = blend(w, (i) => T(i).pools);
  let h = fbm(n1, x * 0.0075, z * 0.0075, oct) * 11 * base + 2.5;
  if (ridges > 0.01) h += Math.pow(1 - Math.abs(fbm(n2, x * 0.011, z * 0.011, Math.min(4, oct))), 3) * 30 * ridges;
  if (mesas > 0.01) h += smooth(0.1, 0.25, fbm(n2, x * 0.02 + 40, z * 0.02, 3)) * 7 * mesas;
  if (dunes > 0.01) {
    const warp = fbm(n3, x * 0.008, z * 0.008, 2) * 5;
    const wave = Math.sin(x * 0.05 + z * 0.018 + warp) * 0.5 + 0.5;
    h += (wave * wave * 7 + fbm(n1, x * 0.025, z * 0.025, 2) * 2.5) * dunes;
  }
  if (lakes > 0.01) h -= smooth(0.05, 0.3, fbm(n3, x * 0.018, z * 0.018, 3)) * 9 * lakes;
  if (pools > 0.01) h -= smooth(0.02, 0.24, fbm(n3, x * 0.045 + 7, z * 0.045 - 3, 2)) * 3.2 * pools;
  const edge = Math.max(Math.abs(x), Math.abs(z)) / HALF;
  h += Math.pow(smooth(0.82, 1.0, edge), 1.5) * 55 + smooth(0.88, 1, edge) * fbm(n1, x * 0.05, z * 0.05, 3) * 12;
  return h;
}

const featureHeights = FEATURES.map((f) => Math.max(rawHeight(f.x, f.z, zoneWeights(f.x, f.z)), WATER_LEVEL + 1.6));

export function analyticHeight(x: number, z: number, pathDist?: number): number {
  const w = zoneWeights(x, z);
  let h = rawHeight(x, z, w);
  FEATURES.forEach((f, i) => {
    const d = Math.hypot(x - f.x, z - f.z);
    const k = smooth(f.r + 22, f.r, d);
    if (k > 0) h = lerp(h, featureHeights[i], k);
  });
  const pd = pathDist ?? distToPaths(x, z);
  const pk = smooth(8, 2.5, pd);
  if (pk > 0) {
    let hs = rawHeight(x, z, w, 2);
    FEATURES.forEach((f, i) => { const k = smooth(f.r + 22, f.r, Math.hypot(x - f.x, z - f.z)); if (k > 0) hs = lerp(hs, featureHeights[i], k); });
    h = lerp(h, Math.max(hs, WATER_LEVEL + 0.9), pk * 0.85);
  }
  return h;
}

// ── colour helpers (no THREE in the worker) ───────────────────────────────
const hex = (h: string): [number, number, number] => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
// The ground colour map stores linearised palette values in an sRGB texture (as v1 did via THREE.Color):
// the palette was art-directed against that deeper, more saturated look, so keep it.
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const hexLin = (h: string) => hex(h).map(lin) as [number, number, number];
const ZG = ZONES.map((z) => z.ground.map(hexLin));
const LUSH: Record<string, number> = { vale: 1, lakes: 0.92, scar: 0.35, peaks: 0.55, marsh: 0.95, dunes: 0.22 };

export interface Fields {
  version: number;
  height: Float32Array; grass: Float32Array; tall: Float32Array; path: Float32Array; slope: Float32Array; plaza: Float32Array;
  zoneIdx: Uint8Array;
  grassCol: Uint8Array; tallCol: Uint8Array; waterShallow: Uint8Array; waterDeep: Uint8Array; // CRES² RGBA
  colorMap: Uint8ClampedArray; cmSize: number;
}

export function bakeFields(cmSize: number, progress?: (f: number) => void): Fields {
  const N = RES * RES;
  const f: Fields = {
    version: BAKE_VERSION,
    height: new Float32Array(N), grass: new Float32Array(N), tall: new Float32Array(N), path: new Float32Array(N), slope: new Float32Array(N), plaza: new Float32Array(N),
    zoneIdx: new Uint8Array(N),
    grassCol: new Uint8Array(CRES * CRES * 4), tallCol: new Uint8Array(CRES * CRES * 4), waterShallow: new Uint8Array(CRES * CRES * 4), waterDeep: new Uint8Array(CRES * CRES * 4),
    colorMap: new Uint8ClampedArray(cmSize * cmSize * 4), cmSize,
  };
  const weights: number[][] = new Array(N);
  for (let j = 0; j < RES; j++) {
    for (let i = 0; i < RES; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL;
      const k = j * RES + i;
      const pd = distToPaths(x, z);
      f.height[k] = analyticHeight(x, z, pd);
      const w = zoneWeights(x, z);
      weights[k] = w;
      let bi = 0;
      for (let q = 1; q < w.length; q++) if (w[q] > w[bi]) bi = q;
      f.zoneIdx[k] = bi;
      f.path[k] = smooth(4.2, 1.6, pd);
    }
    if (j % 64 === 0) progress?.(0.45 * (j / RES));
  }
  for (let j = 0; j < RES; j++) {
    for (let i = 0; i < RES; i++) {
      const k = j * RES + i;
      const hx = f.height[j * RES + Math.min(RES - 1, i + 1)] - f.height[j * RES + Math.max(0, i - 1)];
      const hz = f.height[Math.min(RES - 1, j + 1) * RES + i] - f.height[Math.max(0, j - 1) * RES + i];
      const slope = Math.hypot(hx, hz) / (2 * CELL);
      f.slope[k] = slope;
      const x = -HALF + i * CELL, z = -HALF + j * CELL;
      const h = f.height[k];
      let town = 0, plaza = 0;
      for (const ft of FEATURES) {
        const d = Math.hypot(x - ft.x, z - ft.z);
        town = Math.max(town, smooth(ft.r + 4, ft.r - 6, d));
        if (ft.kind === 'town' || ft.kind === 'outpost') plaza = Math.max(plaza, smooth(ft.r - 6, ft.r - 12, d));
        if (ft.kind === 'homestead') plaza = Math.max(plaza, smooth(ft.r - 2, ft.r - 6, d) * 0.35);
      }
      f.plaza[k] = plaza;
      const wet = smooth(WATER_LEVEL + 0.2, WATER_LEVEL + 1.0, h);
      const flat = smooth(0.9, 0.45, slope);
      const w = weights[k];
      const lush = blend(w, (q) => LUSH[ZONES[q].id] ?? 0.8);
      const g = wet * flat * (1 - f.path[k]) * (1 - town * 0.6) * (1 - plaza) * clamp(lush + fbm(n2, x * 0.05, z * 0.05, 2) * 0.4, 0, 1);
      f.grass[k] = g;
      const patch = fbm(n3, x * 0.03 + 11, z * 0.03 - 7, 3);
      f.tall[k] = smooth(0.2, 0.3, patch) * g * (1 - town) * (1 - f.path[k]);
    }
    if (j % 64 === 0) progress?.(0.45 + 0.1 * (j / RES));
  }
  // coarse colour fields
  for (let j = 0; j < CRES; j++) {
    for (let i = 0; i < CRES; i++) {
      const x = -HALF + (i / (CRES - 1)) * WORLD_SIZE, z = -HALF + (j / (CRES - 1)) * WORLD_SIZE;
      const w = zoneWeights(x, z);
      const o = (j * CRES + i) * 4;
      const put = (arr: Uint8Array, key: (zi: number) => string, a = 255) => {
        let r = 0, g = 0, b = 0;
        for (let q = 0; q < w.length; q++) { if (w[q] < 0.001) continue; const c = hex(key(q)); r += c[0] * w[q]; g += c[1] * w[q]; b += c[2] * w[q]; }
        arr[o] = r * 255; arr[o + 1] = g * 255; arr[o + 2] = b * 255; arr[o + 3] = a;
      };
      put(f.grassCol, (q) => ZONES[q].grass);
      put(f.tallCol, (q) => ZONES[q].tallGrass);
      const lava = blend(w, (q) => (ZONES[q].water.lava ? 1 : 0));
      put(f.waterShallow, (q) => ZONES[q].water.shallow, Math.round(lava * 255));
      put(f.waterDeep, (q) => ZONES[q].water.deep);
    }
  }
  bakeColorMap(f, weights, progress);
  progress?.(1);
  return f;
}

function sample(arr: Float32Array, x: number, z: number) {
  const fx = clamp((x + HALF) / CELL, 0, RES - 1.001), fz = clamp((z + HALF) / CELL, 0, RES - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  return lerp(lerp(arr[j * RES + i], arr[j * RES + i + 1], tx), lerp(arr[(j + 1) * RES + i], arr[(j + 1) * RES + i + 1], tx), tz);
}

function bakeColorMap(f: Fields, weights: number[][], progress?: (f: number) => void) {
  const S = f.cmSize;
  const dirt = hexLin('#c9a06a'), cobble = hexLin('#d6c7ae'), sand = hexLin('#d8c89a'), rock = hexLin('#6a6470'), snow = hexLin('#f4f6ff');
  const dunesIdx = ZONES.findIndex((z) => z.id === 'dunes');
  const marshIdx = ZONES.findIndex((z) => z.id === 'marsh');
  const peaksIdx = ZONES.findIndex((z) => z.id === 'peaks');
  const acc = [0, 0, 0];
  const mix = (c: number[], t: number[], k: number) => { c[0] += (t[0] - c[0]) * k; c[1] += (t[1] - c[1]) * k; c[2] += (t[2] - c[2]) * k; };
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const x = -HALF + (px / (S - 1)) * WORLD_SIZE;
      const z = -HALF + (py / (S - 1)) * WORLD_SIZE;
      const h = sample(f.height, x, z), slope = sample(f.slope, x, z), path = sample(f.path, x, z), tall = sample(f.tall, x, z), plaza = sample(f.plaza, x, z);
      const i = Math.round(((x + HALF) / WORLD_SIZE) * (RES - 1)), j = Math.round(((z + HALF) / WORLD_SIZE) * (RES - 1));
      const w = weights[clamp(j, 0, RES - 1) * RES + clamp(i, 0, RES - 1)];
      acc[0] = acc[1] = acc[2] = 0;
      const nA = fbm(n2, x * 0.04, z * 0.04, 3), nB = fbm(n1, x * 0.15, z * 0.15, 2);
      for (let q = 0; q < w.length; q++) {
        const wq = w[q];
        if (wq < 0.01) continue;
        const [low, high, accent] = ZG[q];
        const t = clamp((h - 1) / 14 + nA * 0.5, 0, 1);
        const a = smooth(0.35, 0.6, nB) * 0.35;
        for (let c = 0; c < 3; c++) {
          let v = low[c] + (high[c] - low[c]) * t;
          v += (accent[c] - v) * a;
          acc[c] += v * wq;
        }
      }
      // land-specific surface detail
      if (w[dunesIdx] > 0.05) { const rip = Math.sin(x * 0.9 + z * 0.35 + nA * 6) * 0.5 + 0.5; const k = w[dunesIdx] * 0.08 * rip; acc[0] *= 1 + k; acc[1] *= 1 + k; acc[2] *= 1 + k * 0.6; }
      if (w[marshIdx] > 0.05) { const wet = smooth(WATER_LEVEL + 1.6, WATER_LEVEL + 0.2, h) * w[marshIdx]; mix(acc, [0.027, 0.047, 0.022], wet * 0.55); }
      mix(acc, snow, smooth(26, 36, h + nA * 6) * (w[peaksIdx] ?? 0));
      mix(acc, rock, smooth(0.7, 1.4, slope) * 0.85);
      mix(acc, sand, smooth(WATER_LEVEL + 1.4, WATER_LEVEL + 0.3, h) * 0.8);
      const td = 1 - tall * 0.22;
      acc[0] *= td; acc[1] *= td; acc[2] *= td;
      mix(acc, dirt.map((c) => c * (0.9 + nB * 0.2)), path * 0.92);
      mix(acc, cobble.map((c) => c * (0.85 + nB * 0.3)), plaza * 0.9);
      const o = (py * S + px) * 4;
      f.colorMap[o] = acc[0] * 255; f.colorMap[o + 1] = acc[1] * 255; f.colorMap[o + 2] = acc[2] * 255; f.colorMap[o + 3] = 255;
    }
    if (py % 128 === 0) progress?.(0.55 + 0.44 * (py / S));
  }
}

/** Stable cache key for the baked world (changes whenever zone data or the bake code version changes). */
export function bakeKey(cmSize: number) {
  const s = JSON.stringify(ZONES.map((z) => [z.id, z.center, z.terrain, z.ground, z.grass, z.tallGrass, z.water, z.town, z.camp, z.boss.pos])) + BAKE_VERSION + cmSize + JSON.stringify(HOMESTEAD);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `world-${(h >>> 0).toString(36)}`;
}
