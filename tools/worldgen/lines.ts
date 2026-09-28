// Splines and polyline distance fields (spurs, rivers, roads).

import { Grid } from './grid';

export type P2 = [number, number];

/** Centripetal-ish Catmull-Rom through control points, resampled every `step` metres. */
export function catmull(ctrl: P2[], step = 2): P2[] {
  if (ctrl.length < 2) return ctrl.slice();
  const pts: P2[] = [];
  const P = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  pts.push(ctrl[ctrl.length - 1]);
  return resamplePolyline(pts, step);
}

export function polyLength(pts: P2[]) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

/** Evenly resample a polyline by arc length. */
export function resamplePolyline(pts: P2[], step: number): P2[] {
  const out: P2[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const L = Math.hypot(bx - ax, bz - az);
    let t = step - carry;
    while (t <= L) {
      out.push([ax + ((bx - ax) * t) / L, az + ((bz - az) * t) / L]);
      t += step;
    }
    carry = L - (t - step);
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.3) out.push(last);
  else out[out.length - 1] = last;
  return out;
}

/** Chaikin corner cutting (keeps endpoints). */
export function chaikin(pts: P2[], iters = 2): P2[] {
  let p = pts;
  for (let k = 0; k < iters; k++) {
    const q: P2[] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i], [bx, bz] = p[i + 1];
      q.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

/**
 * Nearest-polyline field over a grid: for every cell within `maxDist` of any line, the nearest
 * line id, the unsigned distance, the signed lateral offset (+ = right of travel) and arc length.
 */
export interface LineField { n: number; id: Int16Array; dist: Float32Array; lat: Float32Array; s: Float32Array }

export function lineField(n: number, lines: P2[][], maxDist: number): LineField {
  const g = new Grid(n);
  const N = n * n;
  const f: LineField = { n, id: new Int16Array(N).fill(-1), dist: new Float32Array(N).fill(1e9), lat: new Float32Array(N), s: new Float32Array(N) };
  lines.forEach((pts, li) => {
    let acc = 0;
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz, L = Math.sqrt(L2);
      if (L2 === 0) continue;
      const i0 = Math.max(0, Math.floor(g.iOf(Math.min(ax, bx) - maxDist))), i1 = Math.min(n - 1, Math.ceil(g.iOf(Math.max(ax, bx) + maxDist)));
      const j0 = Math.max(0, Math.floor(g.iOf(Math.min(az, bz) - maxDist))), j1 = Math.min(n - 1, Math.ceil(g.iOf(Math.max(az, bz) + maxDist)));
      for (let j = j0; j <= j1; j++) {
        const z = g.xOf(j);
        for (let i = i0; i <= i1; i++) {
          const x = g.xOf(i);
          let t = ((x - ax) * vx + (z - az) * vz) / L2;
          const first = k === 0, last = k === pts.length - 2;
          if (t < 0 && !first) continue; // interior joints are covered by the neighbour segment
          if (t > 1 && !last) continue;
          const tc = t < 0 ? 0 : t > 1 ? 1 : t;
          const dx = x - (ax + vx * tc), dz = z - (az + vz * tc);
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d > maxDist) continue;
          const c = j * n + i;
          if (d < f.dist[c]) {
            f.dist[c] = d;
            f.id[c] = li;
            f.lat[c] = (vx * (z - az) - vz * (x - ax)) / L; // cross: + to the right (x east, z south)
            f.s[c] = acc + t * L;
          }
        }
      }
      acc += L;
    }
  });
  // corner gaps at joints (t outside [0,1] on interior segments): fill from the joint vertex
  lines.forEach((pts, li) => {
    let acc = 0;
    for (let k = 1; k < pts.length - 1; k++) {
      acc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      const [px, pz] = pts[k];
      const r = maxDist;
      const i0 = Math.max(0, Math.floor(g.iOf(px - r))), i1 = Math.min(n - 1, Math.ceil(g.iOf(px + r)));
      const j0 = Math.max(0, Math.floor(g.iOf(pz - r))), j1 = Math.min(n - 1, Math.ceil(g.iOf(pz + r)));
      const [nx, nz] = pts[k + 1];
      const vx = nx - px, vz = nz - pz, L = Math.hypot(vx, vz) || 1;
      for (let j = j0; j <= j1; j++) {
        const z = g.xOf(j);
        for (let i = i0; i <= i1; i++) {
          const x = g.xOf(i);
          const d = Math.hypot(x - px, z - pz);
          const c = j * n + i;
          if (d <= r && d < f.dist[c] - 1e-6) {
            f.dist[c] = d; f.id[c] = li;
            f.lat[c] = (vx * (z - pz) - vz * (x - px)) / L;
            f.s[c] = acc;
          }
        }
      }
    }
  });
  return f;
}

/** Point → nearest point on a polyline: [dist, arcLength, lateral]. */
export function nearestOnPolyline(pts: P2[], x: number, z: number): [number, number, number] {
  let best = 1e9, bs = 0, bl = 0, acc = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
    const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz, L = Math.sqrt(L2);
    if (L2 === 0) continue;
    let t = ((x - ax) * vx + (z - az) * vz) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (ax + vx * t), dz = z - (az + vz * t);
    const d = Math.hypot(dx, dz);
    if (d < best) { best = d; bs = acc + t * L; bl = (vx * (z - az) - vz * (x - ax)) / L; }
    acc += L;
  }
  return [best, bs, bl];
}
