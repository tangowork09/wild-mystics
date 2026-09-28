// Square scalar fields over the 2048 m world. Samples sit on cell corners: sample i is at
// x = -1024 + i * cell, so a 1024² grid and a 2048² grid share every other sample exactly.

export const WORLD = 2048;
export const HALF = WORLD / 2;

export class Grid {
  readonly n: number;
  readonly cell: number;
  data: Float32Array;

  constructor(n: number, data?: Float32Array) {
    this.n = n;
    this.cell = WORLD / n;
    this.data = data ?? new Float32Array(n * n);
  }

  xOf(i: number) { return -HALF + i * this.cell; }
  iOf(x: number) { return (x + HALF) / this.cell; }

  get(i: number, j: number) {
    const n = this.n;
    i = i < 0 ? 0 : i >= n ? n - 1 : i;
    j = j < 0 ? 0 : j >= n ? n - 1 : j;
    return this.data[j * n + i];
  }

  /** Bilinear sample at world (x, z), clamped at the borders. */
  sample(x: number, z: number) {
    const n = this.n;
    let fx = (x + HALF) / this.cell, fz = (z + HALF) / this.cell;
    if (fx < 0) fx = 0; else if (fx > n - 1.0001) fx = n - 1.0001;
    if (fz < 0) fz = 0; else if (fz > n - 1.0001) fz = n - 1.0001;
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
    const d = this.data, k = j * n + i;
    const a = d[k], b = d[k + 1], c = d[k + n], e = d[k + n + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + e) * tx * tz;
  }

  fill(fn: (x: number, z: number, i: number, j: number) => number) {
    const n = this.n, d = this.data;
    for (let j = 0; j < n; j++) {
      const z = this.xOf(j);
      for (let i = 0; i < n; i++) d[j * n + i] = fn(this.xOf(i), z, i, j);
    }
    return this;
  }

  map(fn: (v: number, x: number, z: number, k: number) => number) {
    const n = this.n, d = this.data;
    for (let j = 0; j < n; j++) {
      const z = this.xOf(j);
      for (let i = 0; i < n; i++) { const k = j * n + i; d[k] = fn(d[k], this.xOf(i), z, k); }
    }
    return this;
  }

  clone() { return new Grid(this.n, this.data.slice()); }

  minMax(): [number, number] {
    let lo = Infinity, hi = -Infinity;
    for (const v of this.data) { if (v < lo) lo = v; if (v > hi) hi = v; }
    return [lo, hi];
  }
}

/** Catmull-Rom (bicubic) resample to a new resolution. */
export function resample(src: Grid, n: number): Grid {
  const out = new Grid(n);
  const s = src.n, d = src.data;
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const at = (i: number, j: number) => d[(j < 0 ? 0 : j >= s ? s - 1 : j) * s + (i < 0 ? 0 : i >= s ? s - 1 : i)];
  const ratio = src.cell / out.cell;
  for (let j = 0; j < n; j++) {
    const fz = j / ratio, j1 = Math.floor(fz), tz = fz - j1;
    for (let i = 0; i < n; i++) {
      const fx = i / ratio, i1 = Math.floor(fx), tx = fx - i1;
      const r = [0, 0, 0, 0];
      for (let m = -1; m <= 2; m++) r[m + 1] = cr(at(i1 - 1, j1 + m), at(i1, j1 + m), at(i1 + 1, j1 + m), at(i1 + 2, j1 + m), tx);
      out.data[j * n + i] = cr(r[0], r[1], r[2], r[3], tz);
    }
  }
  return out;
}

/** Box-downsample by an integer factor (sample-aligned: takes the mean of the covered samples). */
export function downsample(src: Grid, n: number): Grid {
  const f = src.n / n;
  const out = new Grid(n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let b = 0; b < f; b++) for (let a = 0; a < f; a++) { s += src.get(i * f + a, j * f + b); c++; }
      out.data[j * n + i] = s / c;
    }
  }
  return out;
}

/** Separable box blur, `passes` times (3 passes ≈ gaussian). Radius in cells. */
export function blur(src: Grid, radius: number, passes = 3): Grid {
  const n = src.n;
  let a = src.data.slice();
  let b = new Float32Array(n * n);
  const r = Math.max(1, Math.round(radius));
  const w = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < n; j++) {
      const row = j * n;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += a[row + Math.min(n - 1, Math.max(0, k))];
      for (let i = 0; i < n; i++) {
        b[row + i] = acc / w;
        acc += a[row + Math.min(n - 1, i + r + 1)] - a[row + Math.max(0, i - r)];
      }
    }
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += b[Math.min(n - 1, Math.max(0, k)) * n + i];
      for (let j = 0; j < n; j++) {
        a[j * n + i] = acc / w;
        acc += b[Math.min(n - 1, j + r + 1) * n + i] - b[Math.max(0, j - r) * n + i];
      }
    }
  }
  return new Grid(n, a);
}

/** Slope magnitude (rise / run) with central differences over ±`span` cells. */
export function slopeGrid(h: Grid, span = 1): Grid {
  const n = h.n, out = new Grid(n);
  const d = h.data, run = 2 * span * h.cell;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const gx = (h.get(i + span, j) - h.get(i - span, j)) / run;
      const gz = (h.get(i, j + span) - h.get(i, j - span)) / run;
      out.data[j * n + i] = Math.hypot(gx, gz);
    }
  }
  void d;
  return out;
}

export function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): [number, number] {
  const vx = bx - ax, vz = bz - az;
  const L2 = vx * vx + vz * vz;
  let t = L2 > 0 ? ((px - ax) * vx + (pz - az) * vz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + vx * t), dz = pz - (az + vz * t);
  return [Math.sqrt(dx * dx + dz * dz), t];
}
