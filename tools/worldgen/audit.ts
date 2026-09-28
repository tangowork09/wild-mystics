// Reachability audit on the final bake (2 m grid, same rules as the runtime walker):
//   a move a→b is blocked if b is deep water or lava, or if b is steep (slope > T) and higher than a.
// Checks: (1) with every gate sealed, no land can reach another land; (2) with gates open, every
// pad is reachable from the start; (3) no soft-lock pits (reachable cells you can't walk back from).

import { SEA, ZONES, GATES, START_POS, ZI, type Pad } from './design';
import { WK } from './hydro';

export interface AuditInput { h: Float32Array; slope: Float32Array; region: Uint8Array; waterSurf: Float32Array; waterKind: Uint8Array; pads: Pad[] }

const N = 1024;
const idx = (x: number, z: number) => Math.min(N - 1, Math.max(0, Math.round((z + 1024) / 2))) * N + Math.min(N - 1, Math.max(0, Math.round((x + 1024) / 2)));

function blockedCells(a: AuditInput, sealed: boolean): Uint8Array {
  const b = new Uint8Array(N * N);
  for (let c = 0; c < N * N; c++) {
    const k = a.waterKind[c];
    if (k === WK.lava && a.waterSurf[c] > a.h[c] - 0.05) b[c] = 1;
    else if (k && k !== WK.frozen && a.waterSurf[c] - a.h[c] > 0.7) b[c] = 1;
  }
  if (sealed) {
    for (const g of GATES) {
      const r = 13;
      for (let dz = -r; dz <= r; dz += 2) for (let dx = -r; dx <= r; dx += 2) if (dx * dx + dz * dz <= r * r) b[idx(g.pos[0] + dx, g.pos[1] + dz)] = 1;
    }
  }
  return b;
}

/** Forward flood (where can I walk to?) or reverse flood (from where can I walk here?). */
function flood(a: AuditInput, blocked: Uint8Array, T: number, seeds: number[], reverse = false): Uint8Array {
  const seen = new Uint8Array(N * N);
  const q: number[] = [];
  for (const s of seeds) if (!blocked[s]) { seen[s] = 1; q.push(s); }
  const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
  const H = a.h, S = a.slope;
  const canMove = (from: number, to: number) => !blocked[to] && !(S[to] > T && H[to] > H[from] + 0.02);
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi], i = c % N, j = (c / N) | 0;
    for (let d = 0; d < 8; d++) {
      const ni = i + DI[d], nj = j + DJ[d];
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nb = nj * N + ni;
      if (seen[nb]) continue;
      if (reverse ? canMove(nb, c) : canMove(c, nb)) { seen[nb] = 1; q.push(nb); }
    }
  }
  return seen;
}

export interface AuditReport { ok: boolean; lines: string[]; leaks: { from: string; to: string; at: [number, number] }[]; unreachable: string[]; traps: number; trapSpots: [number, number][] }

export function audit(a: AuditInput): AuditReport {
  const lines: string[] = [];
  const leaks: AuditReport['leaks'] = [];
  const unreachable: string[] = [];
  // (1) sealed: flood each land from its town with exactly the runtime's slope rule
  const sealed = blockedCells(a, true);
  for (const z of ZONES) {
    if (z.id === 'summit') continue;
    const reach = flood(a, sealed, 1.35, [idx(z.town.pos[0], z.town.pos[1])]);
    const zi = ZI[z.id];
    let count = 0, foreign: Record<string, number> = {}, where: Record<string, [number, number]> = {};
    for (let c = 0; c < N * N; c++) {
      if (!reach[c]) continue;
      count++;
      const r = a.region[c];
      if (r !== zi && a.h[c] > SEA - 0.5) {
        const id = ZONES[r].id;
        foreign[id] = (foreign[id] ?? 0) + 1;
        if (!where[id]) where[id] = [-1024 + (c % N) * 2, -1024 + ((c / N) | 0) * 2];
      }
    }
    // tolerate a sliver along the crest boundary (region split is by the crest line)
    for (const [id, cnt] of Object.entries(foreign)) {
      // is the foreign land's town reachable? that is the real leak test
      const t = ZONES.find((zz) => zz.id === id)!.town.pos;
      const leaked = reach[idx(t[0], t[1])] || cnt > 400;
      if (leaked) leaks.push({ from: z.id, to: id, at: where[id] });
      lines.push(`sealed ${z.id}: ${count} cells, ${cnt} in ${id}${leaked ? '  ← LEAK' : ''}`);
    }
    if (!Object.keys(foreign).length) lines.push(`sealed ${z.id}: ${count} cells, contained`);
  }
  // (2) open: everything reachable from the start with a strict slope limit (subset of the runtime)
  const open = blockedCells(a, false);
  const s0 = idx(START_POS[0], START_POS[1]);
  const reach = flood(a, open, 1.2, [s0]);
  for (const p of a.pads) {
    if (p.id === 'd_starfall') continue;
    let ok = false;
    for (let dz = -Math.min(6, p.r); dz <= Math.min(6, p.r) && !ok; dz += 2) for (let dx = -Math.min(6, p.r); dx <= Math.min(6, p.r) && !ok; dx += 2) if (reach[idx(p.x + dx, p.z + dz)]) ok = true;
    if (!ok) unreachable.push(p.id);
  }
  lines.push(`open: ${unreachable.length ? 'UNREACHABLE ' + unreachable.join(', ') : 'all pads reachable from the start'}`);
  // (3) traps: reachable (lenient) but can't walk back to the start (strict, reversed)
  const reachL = flood(a, open, 1.35, [s0]);
  const back = flood(a, open, 1.35, [s0], true);
  let traps = 0;
  const trapSpots: [number, number][] = [];
  for (let c = 0; c < N * N; c++) if (reachL[c] && !back[c]) {
    traps++;
    if (trapSpots.length < 40 && traps % 25 === 1) trapSpots.push([-1024 + (c % N) * 2, -1024 + ((c / N) | 0) * 2]);
  }
  lines.push(`traps: ${traps} cells (${(traps * 4 / 1e4).toFixed(2)} ha) you can reach but not leave`);
  return { ok: !leaks.length && !unreachable.length, lines, leaks, unreachable, traps, trapSpots };
}

/** Debug: shortest walk from a to b (sealed gates, lenient), sampled every ~20 cells. */
export function tracePath(a: AuditInput, from: [number, number], to: [number, number], T = 1.35): string[] {
  const blocked = blockedCells(a, true);
  const prev = new Int32Array(N * N).fill(-1);
  const s = idx(from[0], from[1]), t = idx(to[0], to[1]);
  const q = [s]; prev[s] = s;
  const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
  for (let qi = 0; qi < q.length && prev[t] < 0; qi++) {
    const c = q[qi], i = c % N, j = (c / N) | 0;
    for (let d = 0; d < 8; d++) {
      const ni = i + DI[d], nj = j + DJ[d];
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nb = nj * N + ni;
      if (prev[nb] >= 0 || blocked[nb]) continue;
      if (a.slope[nb] > T && a.h[nb] > a.h[c] + 0.02) continue;
      prev[nb] = c; q.push(nb);
    }
  }
  if (prev[t] < 0) return ['no path'];
  const path: number[] = [];
  for (let c = t; c !== s; c = prev[c]) path.push(c);
  path.reverse();
  const out: string[] = [];
  let lastR = -1;
  path.forEach((c, k) => {
    const r = a.region[c];
    if (k % (process.env.WG_TRACE_ALL ? 1 : 25) === 0 || r !== lastR) out.push(`(${-1024 + (c % N) * 2},${-1024 + ((c / N) | 0) * 2}) h${a.h[c].toFixed(1)} s${a.slope[c].toFixed(2)} r${r} w${a.waterKind[c]}:${(a.waterSurf[c] - a.h[c]).toFixed(1)}`);
    lastR = r;
  });
  return out;
}
