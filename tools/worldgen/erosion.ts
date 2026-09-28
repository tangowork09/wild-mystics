// Particle (droplet) hydraulic erosion, after Hans Theobald Beyer's classic model.
// Operates in place on a Grid; `strength` (0..1 per cell) scales how much a droplet may erode there,
// so meadows stay soft while the massif, spurs and peaks get their gullies and ridges.

import { Grid } from './grid';
import { mulberry32 } from './noise';

export interface ErosionOpts {
  droplets: number;
  seed: number;
  inertia?: number;
  capacity?: number;
  minCapacity?: number;
  erode?: number;
  deposit?: number;
  evaporate?: number;
  gravity?: number;
  maxSteps?: number;
  radius?: number;
  /** Droplets die when they reach this height (the sea). */
  floor?: number;
}

export function erode(h: Grid, strength: Float32Array, o: ErosionOpts, progress?: (f: number) => void) {
  const n = h.n, H = h.data;
  const inertia = o.inertia ?? 0.05;
  const capF = o.capacity ?? 4;
  const minCap = o.minCapacity ?? 0.01;
  const erodeS = o.erode ?? 0.3;
  const depositS = o.deposit ?? 0.3;
  const evap = o.evaporate ?? 0.012;
  const gravity = o.gravity ?? 4;
  const maxSteps = o.maxSteps ?? 64;
  const R = o.radius ?? 3;
  const floor = o.floor ?? -1e9;
  const rand = mulberry32(o.seed);

  // erosion brush: weights for offsets within radius R
  const bx: number[] = [], bz: number[] = [], bw: number[] = [];
  let wsum = 0;
  for (let dz = -R; dz <= R; dz++) {
    for (let dx = -R; dx <= R; dx++) {
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < R) { const w = 1 - d / R; bx.push(dx); bz.push(dz); bw.push(w); wsum += w; }
    }
  }
  for (let k = 0; k < bw.length; k++) bw[k] /= wsum;
  const BN = bw.length;

  const hg = (px: number, pz: number): [number, number, number] => {
    const i = px | 0, j = pz | 0;
    const u = px - i, v = pz - j;
    const k = j * n + i;
    const a = H[k], b = H[k + 1], c = H[k + n], d = H[k + n + 1];
    const gx = (b - a) * (1 - v) + (d - c) * v;
    const gz = (c - a) * (1 - u) + (d - b) * u;
    return [a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v, gx, gz];
  };

  const chunk = Math.max(1, Math.floor(o.droplets / 20));
  for (let it = 0; it < o.droplets; it++) {
    if (progress && it % chunk === 0) progress(it / o.droplets);
    let px = 1 + rand() * (n - 3), pz = 1 + rand() * (n - 3);
    let dx = 0, dz = 0, speed = 1, water = 1, sediment = 0;
    for (let step = 0; step < maxSteps; step++) {
      const ni = px | 0, nj = pz | 0;
      const cu = px - ni, cv = pz - nj;
      const [h0, gx, gz] = hg(px, pz);
      if (h0 < floor) break;
      dx = dx * inertia - gx * (1 - inertia);
      dz = dz * inertia - gz * (1 - inertia);
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 1e-9) break;
      dx /= len; dz /= len;
      px += dx; pz += dz;
      if (px < 1 || px >= n - 2 || pz < 1 || pz >= n - 2) break;
      const [h1] = hg(px, pz);
      const dh = h1 - h0;
      const cap = Math.max(-dh * speed * water * capF, minCap);
      const k0 = nj * n + ni;
      if (sediment > cap || dh > 0) {
        const dep = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * depositS;
        sediment -= dep;
        H[k0] += dep * (1 - cu) * (1 - cv);
        H[k0 + 1] += dep * cu * (1 - cv);
        H[k0 + n] += dep * (1 - cu) * cv;
        H[k0 + n + 1] += dep * cu * cv;
      } else {
        const s = strength[k0];
        const amt = Math.min((cap - sediment) * erodeS, -dh) * s;
        if (amt > 0) {
          for (let b = 0; b < BN; b++) {
            const ii = ni + bx[b], jj = nj + bz[b];
            if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
            const kk = jj * n + ii;
            const w = amt * bw[b];
            const take = H[kk] < w ? H[kk] : w; // never dig below zero-relative? keep simple
            H[kk] -= w;
            void take;
          }
          sediment += amt;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed + dh * gravity));
      water *= 1 - evap;
    }
  }
  progress?.(1);
}

/** Thermal relaxation: moves material downhill where slopes exceed the talus angle (softens noise). */
export function thermal(h: Grid, talus: number, iters: number, rate = 0.25, mask?: Float32Array) {
  const n = h.n, H = h.data, cell = h.cell;
  const lim = talus * cell;
  const delta = new Float32Array(n * n);
  for (let it = 0; it < iters; it++) {
    delta.fill(0);
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        const k = j * n + i;
        const m = mask ? mask[k] : 1;
        if (m <= 0) continue;
        const hk = H[k];
        for (const o of [1, -1, n, -n]) {
          const d = hk - H[k + o];
          if (d > lim) { const mv = (d - lim) * rate * 0.5 * m; delta[k] -= mv; delta[k + o] += mv; }
        }
      }
    }
    for (let k = 0; k < n * n; k++) H[k] += delta[k];
  }
}
