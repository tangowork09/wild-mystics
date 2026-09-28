// Seeded noise toolkit for the offline world generator. Everything here is deterministic: the same
// seed always yields the same world, bit for bit, on the same machine.

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash → [0,1). Used for per-cell jitter (Worley points, stipple). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x2545f491);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export const seedOf = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
// 12 gradient directions on the unit circle (less axis bias than the 8-direction set)
const GX = new Float64Array(12), GY = new Float64Array(12);
for (let i = 0; i < 12; i++) { GX[i] = Math.cos((i / 12) * Math.PI * 2 + 0.13); GY[i] = Math.sin((i / 12) * Math.PI * 2 + 0.13); }

export type Noise2 = (x: number, y: number) => number;

/** 2D simplex noise in roughly [-1, 1]. */
export function simplex(seed: number): Noise2 {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512), pm12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }
  return (xin: number, yin: number) => {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    let i1 = 0, j1 = 1;
    if (x0 > y0) { i1 = 1; j1 = 0; }
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = pm12[ii + perm[jj]]; t0 *= t0; n += t0 * t0 * (GX[g] * x0 + GY[g] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = pm12[ii + i1 + perm[jj + j1]]; t1 *= t1; n += t1 * t1 * (GX[g] * x1 + GY[g] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = pm12[ii + 1 + perm[jj + 1]]; t2 *= t2; n += t2 * t2 * (GX[g] * x2 + GY[g] * y2); }
    return 70 * n;
  };
}

/** Fractal Brownian motion, normalised to roughly [-1, 1]. */
export function fbm(n: Noise2, x: number, y: number, oct = 5, lac = 2.0, gain = 0.5) {
  let a = 1, f = 1, s = 0, norm = 0;
  for (let o = 0; o < oct; o++) {
    s += a * n(x * f + o * 17.31, y * f - o * 9.73);
    norm += a; a *= gain; f *= lac;
  }
  return s / norm;
}

/** Ridged multifractal (Musgrave), in [0, ~1]. Sharp crests, eroded-looking valleys. */
export function ridged(n: Noise2, x: number, y: number, oct = 6, lac = 2.0, gain = 0.5, offset = 1.0, sharp = 2.0) {
  let sum = 0, freq = 1, amp = 0.5, weight = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    let sig = offset - Math.abs(n(x * freq + o * 31.7, y * freq - o * 11.3));
    sig = Math.pow(Math.max(0, sig), sharp);
    sig *= weight;
    weight = Math.min(1, Math.max(0, sig * 2));
    sum += sig * amp;
    norm += amp;
    freq *= lac;
    amp *= gain;
  }
  return sum / norm;
}

/** Billowy noise (|n|), in [0, 1]: rounded hills / dunes. */
export function billow(n: Noise2, x: number, y: number, oct = 4, lac = 2, gain = 0.5) {
  let a = 1, f = 1, s = 0, norm = 0;
  for (let o = 0; o < oct; o++) {
    s += a * Math.abs(n(x * f + o * 7.1, y * f + o * 3.3));
    norm += a; a *= gain; f *= lac;
  }
  return s / norm;
}

/** Worley F1/F2 distances (cell units) with jittered feature points. */
export function worley(x: number, y: number, seed: number, jitter = 0.9): [number, number, number] {
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 1e9, f2 = 1e9, id = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy;
      const px = cx + 0.5 + (hash2(cx, cy, seed) - 0.5) * jitter;
      const py = cy + 0.5 + (hash2(cx, cy, seed + 101) - 0.5) * jitter;
      const d = Math.hypot(px - x, py - y);
      if (d < f1) { f2 = f1; f1 = d; id = hash2(cx, cy, seed + 7); } else if (d < f2) f2 = d;
    }
  }
  return [f1, f2, id];
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const smoother = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
/** Polynomial smooth max / min (k = blend width). */
export const smax = (a: number, b: number, k: number) => { const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1); return lerp(a, b, h) + k * h * (1 - h); };
export const smin = (a: number, b: number, k: number) => -smax(-a, -b, k);
