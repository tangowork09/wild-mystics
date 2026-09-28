// Macro terrain: the designed island before erosion.
//
// Geology in one sentence: Mount Aether rises from a high tableland whose nine arms (the spurs)
// reach the sea; the tableland is bounded everywhere by escarpments, and the nine lands are the
// lowland valleys eroded between the arms. Walls = escarpments, the only breaks are the Warden Gate
// passes (cut later in carve.ts) and the Crown valley.

import { simplex, fbm, ridged, billow, worley, seedOf, clamp, lerp, smooth, smax, type Noise2 } from './noise';
import { Grid } from './grid';
import { catmull, lineField, type P2, type LineField } from './lines';
import {
  PROFILE, RING, COAST_BUMPS, HARBOURS, MC, PLATEAU_R, SUMMIT_H, SEA, SPURS, GATES, RAD,
  bearingOf, angDiff, dirOf,
} from './design';

// ── per-bearing tables (0.25° steps) ─────────────────────────────────────────────────────────
const TB = 1440;
const nCoast = simplex(seedOf('coast'));
const nCliff = simplex(seedOf('cliff'));
const coastTab = new Float32Array(TB);
const cliffTab = new Float32Array(TB);
const cliffHTab = new Float32Array(TB);

export function landAtBearing(b: number) {
  const k = Math.floor((((b % 360) + 360) % 360) / 40);
  return RING[k]; // RING is sorted by bearing: 20, 60, 100, …, 340
}

for (let t = 0; t < TB; t++) {
  const b = (t / TB) * 360;
  const ca = Math.cos(b * RAD), sa = Math.sin(b * RAD);
  let R = 900 + 42 * fbm(nCoast, ca * 2.2 + 7, sa * 2.2 - 3, 4) + 22 * fbm(nCoast, ca * 8 + 1, sa * 8, 3) + 7 * fbm(nCoast, ca * 30, sa * 30 + 5, 2);
  for (const bump of COAST_BUMPS) {
    const d = angDiff(b, bump.bearing) / bump.width;
    R += bump.delta * Math.exp(-d * d);
  }
  // every land's valley mouth opens as a broad bay; spur arms end in headlands
  const land = landAtBearing(b);
  const off = angDiff(b, land.bearing);
  R -= 26 * Math.exp(-((off / 11) ** 2));
  for (const s of SPURS) {
    const d = angDiff(b, s.bearing);
    R += 40 * Math.exp(-((d / 3.2) ** 2));
  }
  coastTab[t] = R;
  const nb = RING[(RING.indexOf(land) + (off > 0 ? 1 : RING.length - 1)) % RING.length];
  const w = smooth(14, 20, Math.abs(off)) * 0.5;
  const P = PROFILE[land.id], Q = PROFILE[nb.id];
  let c = lerp(P.cliff, Q.cliff, w) + 0.4 * fbm(nCliff, ca * 6, sa * 6, 3);
  for (const s of SPURS) c = Math.max(c, Math.exp(-((angDiff(b, s.bearing) / 4.5) ** 2)));
  cliffTab[t] = clamp(c, 0, 1);
  cliffHTab[t] = lerp(P.cliffH, Q.cliffH, w) * (0.8 + 0.4 * (fbm(nCliff, ca * 4 + 9, sa * 4, 2) * 0.5 + 0.5));
}
const tab = (arr: Float32Array, b: number) => {
  const f = ((((b % 360) + 360) % 360) / 360) * TB;
  const i = Math.floor(f), t = f - i;
  return arr[i % TB] * (1 - t) + arr[(i + 1) % TB] * t;
};
export const coastRadius = (b: number) => tab(coastTab, b);
export const cliffiness = (b: number) => tab(cliffTab, b);
export const cliffHeight = (b: number) => tab(cliffHTab, b);

/** Distance from the origin to a circle of radius R around the mountain, along bearing b. */
export function footRadius(b: number, footR = 330) {
  const cz = -Math.cos(b * RAD);
  const dot = cz * MC[1];
  return dot + Math.sqrt(dot * dot - (MC[0] ** 2 + MC[1] ** 2) + footR * footR);
}

const nHarb = simplex(seedOf('harbour'));
/** Signed distance to the coastline (m): positive inland. Includes harbour basins. */
export function coastSDF(x: number, z: number) {
  const r = Math.hypot(x, z);
  const b = bearingOf(x, z);
  let s = coastRadius(b) - r;
  for (const h of HARBOURS) {
    const ang = Math.atan2(z - h.z, x - h.x);
    const rr = h.r * (1 + 0.16 * fbm(nHarb, Math.cos(ang) * 1.6, Math.sin(ang) * 1.6, 3));
    const dB = Math.hypot(x - h.x, z - h.z) - rr;
    const [ax, az] = [h.x, h.z], [bx, bz] = h.channelTo;
    const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
    const t = clamp(((x - ax) * vx + (z - az) * vz) / L2, 0, 1);
    const wC = (h.channelW / 2) * (0.8 + 0.4 * t) * (1 + 0.2 * fbm(nHarb, t * 3, 7.1, 2));
    const dC = Math.hypot(x - (ax + vx * t), z - (az + vz * t)) - wC;
    s = Math.min(s, Math.min(dB, dC));
  }
  return s;
}

// ── land weights across spurs ──────────────────────────────────────────────────────────────────
export function landBlend(x: number, z: number): { a: string; b: string; wb: number } {
  const b = bearingOf(x, z);
  const land = landAtBearing(b);
  const off = angDiff(b, land.bearing);
  const nb = RING[(RING.indexOf(land) + (off > 0 ? 1 : RING.length - 1)) % RING.length];
  const r = Math.max(60, Math.hypot(x, z));
  const toSpur = (20 - Math.abs(off)) * RAD * r;
  const wb = 0.5 * (1 - smooth(0, 30, toSpur));
  return { a: land.id, b: nb.id, wb };
}

export function profileAt(id: string, x: number, z: number, b: number, sInland: number) {
  const P = PROFILE[id];
  const R = coastRadius(b);
  const rf = footRadius(b);
  const r = Math.hypot(x, z);
  const cl = cliffiness(b);
  const eCoast = lerp(Math.min(P.coast, 3), Math.max(P.coast, cliffHeight(b)), cl);
  const u = clamp((R - r) / Math.max(40, R - rf), 0, 1.3);
  const uRing = clamp((R - 560) / Math.max(40, R - rf), 0.05, 0.95);
  const gRing = clamp((P.ring - eCoast) / Math.max(1, P.foot - eCoast), 0.05, 0.95);
  const p = Math.log(gRing) / Math.log(uRing);
  let e = eCoast + (P.foot - eCoast) * Math.pow(Math.min(u, 1), p) + (u > 1 ? (u - 1) * 30 : 0);
  const wDrop = lerp(46, 4.5, cl);
  if (sInland < wDrop * 1.2) {
    const k = smooth(0, wDrop, sInland);
    e = SEA + (e - SEA) * (cl > 0.5 ? Math.pow(k, 0.6) : k);
  }
  return e;
}

// ── land character ─────────────────────────────────────────────────────────────────────────────
const N: Record<string, Noise2[]> = {};
for (const z of RING) N[z.id] = [simplex(seedOf(z.id + 'a')), simplex(seedOf(z.id + 'b')), simplex(seedOf(z.id + 'c'))];
const g2 = (x: number, z: number, cx: number, cz: number, s: number) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * s * s));
const nWarp = simplex(seedOf('charwarp'));

export const CALDERA = { x: 790, z: 80, rim: 96, floor: 62, rimH: 38, breach: 290 };

function mesaField(x: number, z: number, scale: number, seed: number, lo: number, hi: number): number {
  // domain-warped Worley cells → irregular flat-topped mesas with a second terrace
  const wx = x + 38 * fbm(nWarp, x / 160, z / 160, 3), wz = z + 38 * fbm(nWarp, x / 160 + 9, z / 160 - 4, 3);
  const [f1, , id] = worley(wx / scale, wz / scale, seed);
  const top = smooth(0.43, 0.33, f1);
  const terrace = smooth(0.5, 0.44, f1) * 0.35;
  return Math.max(top, terrace) * lerp(lo, hi, id) * (id > 0.28 ? 1 : 0);
}

function character(id: string, x: number, z: number): number {
  const [a, b, c] = N[id];
  switch (id) {
    case 'vale':
      return 5 * fbm(a, x / 300, z / 300, 4) + 2 * fbm(b, x / 85, z / 85, 3)
        + 13 * g2(x, z, -84, 614, 38) + 7 * g2(x, z, 60, 836, 32) + 8 * g2(x, z, -205, 668, 55) + 6 * g2(x, z, 210, 740, 60) + 5 * g2(x, z, -60, 430, 50);
    case 'lakes':
      return 14 * (billow(a, x / 200, z / 200, 3) - 0.3) + 4 * fbm(b, x / 70, z / 70, 3);
    case 'coast':
      return 5 * fbm(a, x / 260, z / 260, 4) + 2 * fbm(b, x / 80, z / 80, 3) + 11 * g2(x, z, 474, 566, 36);
    case 'marsh':
      return 0.8 * fbm(a, x / 90, z / 90, 3) + 0.5 * fbm(b, x / 30, z / 30, 2);
    case 'scar':
      return 4 * fbm(a, x / 200, z / 200, 4) + 1.5 * fbm(b, x / 60, z / 60, 3) + mesaField(x, z, 125, seedOf('mesa'), 9, 20) * smooth(0.25, 0.5, fbm(c, x / 380, z / 380, 2) * 0.5 + 0.5);
    case 'elder':
      return 13 * fbm(a, x / 220, z / 220, 5) + 7 * (ridged(b, x / 150, z / 150, 4) - 0.45);
    case 'dunes':
      return 2.5 * fbm(a, x / 320, z / 320, 3);
    case 'peaks':
      return 44 * (ridged(a, x / 290, z / 290, 6, 2.1, 0.5) - 0.42) + 5 * fbm(b, x / 90, z / 90, 3);
    case 'hollows': {
      const wx = x + 30 * fbm(nWarp, x / 120 + 3, z / 120, 3), wz = z + 30 * fbm(nWarp, x / 120, z / 120 + 7, 3);
      const [f1, f2] = worley(wx / 170 + 11, wz / 170 + 4, seedOf('canyon'));
      const mask = smooth(-0.15, 0.3, fbm(c, x / 260, z / 260, 3));
      const canyon = smooth(0.2, 0.07, f2 - f1) * 20 * mask;
      return 5 * fbm(a, x / 220, z / 220, 4) + mesaField(x, z, 105, seedOf('hmesa'), 8, 17) - canyon;
    }
  }
  return 0;
}

// ── Spur arms (curved splines through their gates) ────────────────────────────────────────────
const nS = simplex(seedOf('spurs'));
const nS2 = simplex(seedOf('spurs2'));
const nEdge = simplex(seedOf('edge'));

export interface SpurLine { i: number; bearing: number; pts: P2[]; length: number; sGate: number; sCoast: number }

/** Hand-tuned angular offsets (deg) of each spur's control points: foot, mid-in, mid-out, tip. */
const SPUR_BEND: Record<number, [number, number, number, number]> = {
  200: [3, -2.5, 2.5, 4],
  240: [-4, 3, -3, -2],
  280: [2, -3, 2.5, 3],
  320: [-3, 2, -2.5, -4],
  0: [3, -2, 3, 2],
  40: [-3, 2.5, -2, -3],
  80: [4, -2, 3, 3],
  120: [-3, 3, -2.5, -3],
  160: [-2, 2.5, -2, -3.5],
};

export const SPUR_LINES: SpurLine[] = SPURS.map((s, i) => {
  const b = s.bearing;
  const bend = SPUR_BEND[b] ?? [0, 0, 0, 0];
  const rf = footRadius(b + bend[0]);
  // the arm must outreach the coast on BOTH sides, or a beach could wade round its tip
  let rc = 0;
  for (let db = -9; db <= 9; db += 0.5) rc = Math.max(rc, coastRadius(b + bend[3] + db));
  const at = (bb: number, r: number): P2 => { const [dx, dz] = dirOf(bb); return [dx * r, dz * r]; };
  const gate = GATES.find((g) => g.id !== 'g_crown' && Math.abs(angDiff(bearingOf(g.pos[0], g.pos[1]), b)) < 2)!;
  const ctrl: P2[] = [
    at(b + bend[0], rf - 80),
    at(b + bend[0], rf - 10),
    at(b + bend[1], (rf + 560) / 2),
    [gate.pos[0], gate.pos[1]],
    at(b + bend[2], (560 + rc) / 2),
    at(b + bend[3], rc - 10),
    at(b + bend[3] * 1.1, rc + 46),
  ];
  const pts = catmull(ctrl, 2);
  let length = 0, sGate = 0, sCoast = 0, best = 1e9;
  for (let k = 1; k < pts.length; k++) {
    length += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    const dg = Math.hypot(pts[k][0] - gate.pos[0], pts[k][1] - gate.pos[1]);
    if (dg < best) { best = dg; sGate = length; }
    if (!sCoast && Math.hypot(pts[k][0], pts[k][1]) > rc - 4) sCoast = length;
  }
  return { i, bearing: b, pts, length, sGate, sCoast: sCoast || length - 60 };
});

/**
 * Arm (spur ridge) cross-section at arc length s. From the lowland outward-in: a foothill ramp
 * (walkable, F high over Wf), a cliff band (B high, slope k: this is the wall), then the rugged
 * upper ridge rising to the crest (Hc above the lowland) over Wtop.
 */
export interface ArmP { Hc: number; Wtop: number; B: number; k: number; F: number; Wf: number }
export function armParams(i: number, s: number): ArmP {
  const L = SPUR_LINES[i];
  const f = clamp(s / L.sCoast, 0, 1);
  const nA = (sc: number, o: number) => fbm(nS, s / sc + i * 7.3 + o, o * 1.7, 3);
  let Hc = lerp(66, 32, Math.pow(f, 0.75)) + 12 * nA(90, 0);
  Hc += 20 * Math.exp(-(((s - L.sCoast * (0.2 + 0.05 * (i % 3))) / 50) ** 2))
    + 15 * Math.exp(-(((s - L.sCoast * (0.58 + 0.05 * (i % 4))) / 42) ** 2))
    - 8 * Math.exp(-(((s - L.sCoast * 0.4) / 32) ** 2))
    + 10 * Math.exp(-(((s - (L.sCoast - 30)) / 45) ** 2));
  // narrow near the mountain (the lands are pinched there), broadest mid-way, a headland at the sea
  const mid = Math.exp(-(((s - L.sCoast * (0.45 + 0.06 * (i % 3))) / (L.sCoast * 0.28)) ** 2));
  const Wtop = Math.max(7, 12 + 14 * mid + 7 * nA(120, 3) + 8 * smooth(L.sCoast - 80, L.sCoast, s));
  const F = 5 + 8 * (nA(80, 5) * 0.5 + 0.5);
  const B = 14 + 8 * (nA(60, 8) * 0.5 + 0.5);
  const k = 2.5 + 0.6 * (nA(50, 11) * 0.5 + 0.5);
  const Wf = lerp(14, 34, smooth(0, L.sCoast * 0.5, s)) * (0.7 + 0.6 * (nA(100, 13) * 0.5 + 0.5));
  Hc = Math.max(Hc, F + B + 10);
  return { Hc, Wtop, B, k, F, Wf };
}
/** Relative height of an arm above the lowland at lateral distance q (≥ 0). */
export function armProfile(q: number, P: ArmP) {
  const T = P.F + P.B;
  if (q <= P.Wtop) { const u = q / P.Wtop; return T + (P.Hc - T) * (1 - Math.pow(u, 1.7)); }
  const cliffEnd = P.Wtop + P.B / P.k;
  if (q <= cliffEnd) return T - (q - P.Wtop) * P.k;
  const t = (q - cliffEnd) / P.Wf;
  if (t >= 1) return 0;
  return P.F * (1 - t * t * (3 - 2 * t));
}
export const armHalfWidth = (P: ArmP) => P.Wtop + P.B / P.k + P.Wf;
/** Lateral distance used for the arm profile (the crest line's |lat| plus edge noise). */
export function armLateral(lat: number, x: number, z: number) {
  // low-frequency only: |∇q| stays within ~0.75..1.25, so the cliff band keeps its designed steepness
  return Math.abs(lat) + 6 * fbm(nEdge, x / 60, z / 60, 2);
}

// ── Mount Aether ───────────────────────────────────────────────────────────────────────────────
const nM = simplex(seedOf('mountain'));
const nM2 = simplex(seedOf('mountain2'));
const nW = simplex(seedOf('mountainWarp'));
export const SKIRT_R = 316;
/** Foothill apron round the massif: height and width (m). */
const APRON_F = 10, APRON_W = 42;

/** Bearings (from the mountain centre) of the arêtes: where each spur's crest meets the massif. */
export const ARETES = SPUR_LINES.map((L) => bearingOf(L.pts[0][0] - MC[0], L.pts[0][1] - MC[1]));

/** Crown valley: the only way up. Floor profile + half width along z (x = centre line). */
export const CROWN = {
  floor: [[340, 28], [292, 30], [250, 35], [210, 41], [172, 49], [150, 55], [128, 63]] as [number, number][],
  half: [[340, 11], [284, 11], [266, 16], [246, 36], [210, 50], [180, 44], [158, 36], [140, 26], [118, 14]] as [number, number][],
};
const pw = (tabl: [number, number][], z: number) => {
  if (z >= tabl[0][0]) return tabl[0][1];
  for (let i = 1; i < tabl.length; i++) {
    if (z >= tabl[i][0]) { const t = (tabl[i - 1][0] - z) / (tabl[i - 1][0] - tabl[i][0]); return lerp(tabl[i - 1][1], tabl[i][1], smooth(0, 1, t)); }
  }
  return tabl[tabl.length - 1][1];
};
export const crownFloor = (z: number) => pw(CROWN.floor, z);
export const crownHalf = (z: number) => pw(CROWN.half, z);

/** South face above the Crown valley that the switchback climbs (smooth, no crags). */
export const FACE = { z0: 146, z1: 6, halfW: 118 };

/** Mountain skirt (escarpment) radius from the mountain centre at mountain-bearing bm. */
export function skirtRadius(bm: number) {
  const ca = Math.cos(bm * RAD), sa = Math.sin(bm * RAD);
  let r = SKIRT_R + 34 + 12 * fbm(nM, ca * 3 + 4, sa * 3, 3) + 5 * fbm(nM, ca * 11, sa * 11 - 2, 2);
  for (const ab of ARETES) r += 16 * Math.exp(-((angDiff(bm, ab) / 5) ** 2));
  return r;
}

/**
 * Mount Aether at (x,z) over the lowland height `low`: a steep basal band (the rampart, ~24 m of
 * cliff all round) with a scree apron, then the cone with arêtes, cirques and crags up to the
 * summit plateau. The Crown valley is carved into its south side.
 */
export function massif(x: number, z: number, low: number): number {
  const dx = x - MC[0], dz = z - MC[1];
  const d = Math.hypot(dx, dz);
  const bm = bearingOf(dx, dz);
  const dFoot = skirtRadius(bm);
  if (d > dFoot + 30) return -1e9;
  const ca = Math.cos(bm * RAD), sa = Math.sin(bm * RAD);
  const S = APRON_F + 22 + 8 * fbm(nM2, ca * 5, sa * 5, 2);
  const kS = 2.4;
  const inner = dFoot - APRON_W - (S - APRON_F) / kS;
  const t = clamp(1 - (d - PLATEAU_R) / (inner - PLATEAU_R), 0, 1);
  const base = low + S;
  let h = base + (SUMMIT_H - base) * Math.pow(t, 1.3);
  let ar = 0;
  for (const ab of ARETES) { const a = Math.abs(angDiff(bm, ab)); ar = Math.max(ar, Math.exp(-((a / (6 + 7 * (1 - t))) ** 2))); }
  const bell = smooth(0.0, 0.25, t) * (1 - smooth(0.8, 1.0, t));
  h += bell * (26 * ar - 18 * (1 - ar));
  const arc = bm * RAD * 150;
  const wu = arc + 44 * fbm(nW, dx / 110, dz / 110, 3);
  const rn = ridged(nM, wu / 55, d / 140, 5, 2.0, 0.5, 1.0, 2.0);
  const r2 = ridged(nM2, dx / 70, dz / 70, 4);
  h += 38 * bell * (rn * 0.75 + r2 * 0.35 - 0.5);
  const faceW = smooth(FACE.halfW, FACE.halfW - 44, Math.abs(x)) * smooth(FACE.z0 + 34, FACE.z0 - 8, z) * smooth(FACE.z1 - 10, FACE.z1 + 12, z);
  if (faceW > 0) {
    const ft = clamp((FACE.z0 - z) / (FACE.z0 - FACE.z1), 0, 1);
    const face = lerp(56, SUMMIT_H, Math.pow(ft, 0.95)) + 2.5 * fbm(nM2, x / 40, z / 40, 2);
    h = lerp(h, face, faceW);
  }
  if (d < PLATEAU_R + 16) h = lerp(SUMMIT_H + 0.4 * fbm(nM2, x / 20, z / 20, 2), h, smooth(PLATEAU_R - 3, PLATEAU_R + 16, d));
  // basal rampart (cliff band) standing on a foothill apron
  if (d > inner) h = Math.min(h, base - (d - inner) * kS);
  const aprT = clamp((d - (dFoot - APRON_W)) / APRON_W, 0, 1);
  h = Math.max(h, low + APRON_F * (1 - aprT * aprT * (3 - 2 * aprT)));
  // Crown valley: carve the gorge + valley floor
  if (z > 110 && z < 350 && Math.abs(x) < 100) {
    const hw = crownHalf(z) + 3 * fbm(nM2, z / 30, 3.3, 2);
    const e = Math.abs(x) - hw;
    const floor = crownFloor(z);
    const v = floor + (e > 0 ? e * 2.6 + e * e * 0.015 : 0);
    const k = smooth(350, 334, z) * smooth(110, 128, z);
    h = lerp(h, Math.min(h, v), k);
  }
  return h;
}

// ── Escarpment profile ────────────────────────────────────────────────────────────────────────
/**
 * Height of a tableland (surface `top`) seen from the lowland (`low`) at signed edge distance e
 * (e < 0 on top, e > 0 below the cliff). Rounded lip, near-vertical cliff, talus apron.
 */
export function escarp(top: number, low: number, e: number, cliffW = 6, talusW = 16, talusH = 6) {
  if (top <= low) return low;
  if (e <= -4) return top;
  const lip = e < 0 ? top - (1 - -e / 4) ** 2 * 1.2 : top - 1.2;
  if (e <= 0) return lip;
  const drop = top - 1.2 - low;
  const cliff = lip - drop * smooth(0, cliffW, e);
  const tal = low + talusH * smooth(talusW, 0, e - cliffW * 0.5);
  return Math.max(cliff, tal);
}

// ── Islets & sea stacks ───────────────────────────────────────────────────────────────────────
export const ISLETS = [
  { id: 'starfall', x: 706, z: 772, r: 44, h: 13, rock: true },
  { id: 'gullrock', x: -330, z: 930, r: 26, h: 9, rock: true },
  { id: 'mistisle', x: -958, z: 170, r: 34, h: 5, rock: false },
  { id: 'duneskey', x: 850, z: -560, r: 30, h: 4, rock: false },
  { id: 'frostholm', x: -520, z: -850, r: 32, h: 16, rock: true },
  { id: 'embercone', x: 950, z: 250, r: 22, h: 14, rock: true },
];
const nI = simplex(seedOf('islets'));
export function isletHeight(x: number, z: number): number {
  let h = -1e9;
  for (const s of ISLETS) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (d > s.r * 1.9) continue;
    const w = s.r * (1 + 0.25 * fbm(nI, (x - s.x) / 30, (z - s.z) / 30, 3));
    const q = d / w;
    const top = s.h * (s.rock ? 1 : 0.6);
    const prof = s.rock ? (1 - smooth(0.55, 1.0, q)) * top + (1 - smooth(0.9, 1.5, q)) * 2 : (1 - smooth(0.2, 1.1, q)) * top;
    h = Math.max(h, SEA - 8 + (prof + 8) * (1 - smooth(1.0, 1.8, q)) + 1.5 * fbm(nI, x / 12, z / 12, 2));
  }
  // starfall sandbar: submerged (top ~1.1 m under the sea) between the peninsula tip and the islet
  {
    const ax = 612, az = 686, bx = 700, bz = 765;
    const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
    const t = clamp(((x - ax) * vx + (z - az) * vz) / L2, 0, 1);
    const d = Math.hypot(x - (ax + vx * t), z - (az + vz * t));
    if (d < 30) h = Math.max(h, SEA - 1.15 - d * d * 0.012 - 0.4 * Math.sin(t * Math.PI * 3) ** 2);
  }
  return h;
}

const STACKS: [number, number, number, number][] = [];
{
  const addNear = (b: number, off: number, rr: number, hh: number) => {
    const R = coastRadius(b) + off;
    const [dx, dz] = dirOf(b);
    STACKS.push([dx * R, dz * R, rr, hh]);
  };
  for (const L of SPUR_LINES) {
    const tip = L.pts[L.pts.length - 1];
    const tb = bearingOf(tip[0], tip[1]);
    addNear(tb + 2.6, 62, 7, 22); addNear(tb - 3.1, 52, 5, 15);
  }
  for (const b of [128, 131, 146, 143.5, 336, 342, 12, 4, 96, 104, 286, 296, 222, 305]) addNear(b, 22 + (b % 7) * 5, 5 + (b % 5), 12 + (b % 11) * 1.6);
}
export function stackHeight(x: number, z: number): number {
  let h = -1e9;
  for (const [sx, sz, r, hh] of STACKS) {
    const d = Math.hypot(x - sx, z - sz);
    if (d > r * 2.2) continue;
    const q = d / (r * (1 + 0.2 * fbm(nI, (x + sz) / 9, (z - sx) / 9, 2)));
    h = Math.max(h, SEA - 6 + (hh + 6) * (1 - smooth(0.7, 1.05, q)) + 3 * (1 - smooth(1, 2, q)));
  }
  return h;
}

// ── Assemble ──────────────────────────────────────────────────────────────────────────────────
const nSea = simplex(seedOf('seabed'));
export function seabed(x: number, z: number, s: number) {
  const b = bearingOf(x, z);
  const cl = cliffiness(b);
  const off = -s;
  let depth = 2.6 * smooth(0, 16, off) + off * lerp(0.035, 0.11, cl) + 1.2 * fbm(nSea, x / 60, z / 60, 3) * smooth(0, 30, off);
  for (const h of HARBOURS) {
    const d = Math.hypot(x - h.x, z - h.z);
    depth = Math.max(depth, h.depth * smooth(h.r, h.r * 0.4, d) * smooth(0, 20, off));
  }
  return SEA - Math.min(38, depth);
}

export function lowlandAt(x: number, z: number) {
  const b = bearingOf(x, z);
  const s = coastSDF(x, z);
  const { a, b: nb, wb } = landBlend(x, z);
  if (s < 0) return { h: seabed(x, z, s), land: SEA, a, nb, wb, s };
  const pa = profileAt(a, x, z, b, s), pb = profileAt(nb, x, z, b, s);
  let h = pa * (1 - wb) + pb * wb;
  const rf = footRadius(b);
  const r = Math.hypot(x, z);
  const inland = smooth(0, 70, s) * (1 - 0.85 * smooth(rf + 40, rf - 20, r));
  h += inland * (character(a, x, z) * (1 - wb) + character(nb, x, z) * wb);
  return { h, land: h, a, nb, wb, s };
}

export interface MacroFields { h: Grid; spur: LineField; ridge: Grid; lowland: Grid }

/** Build the macro height at resolution n (2048/n m cells). */
export function buildMacro(n: number): MacroFields {
  const hGrid = new Grid(n);
  const ridge = new Grid(n); // 1 on the massif and arms (rock country), 0 in the lowlands
  const lowG = new Grid(n);
  const spur = lineField(n, SPUR_LINES.map((L) => L.pts), 190);
  for (let j = 0; j < n; j++) {
    const z = hGrid.xOf(j);
    for (let i = 0; i < n; i++) {
      const x = hGrid.xOf(i);
      const c = j * n + i;
      const L = lowlandAt(x, z);
      const low = Math.max(L.h, SEA - 30);
      let h = L.h;
      const landTop = Math.max(L.land, SEA);
      const mh = massif(x, z, landTop);
      if (mh > h) h = mh;
      const si = spur.id[c];
      if (si >= 0) {
        const Ls = SPUR_LINES[si];
        const s = spur.s[c];
        const lat = armLateral(spur.lat[c], x, z);
        const P = armParams(si, Math.min(s, Ls.length));
        // round the headland at the end of the arm
        const capR = P.Wtop + P.B / P.k;
        const over = Math.max(0, s - (Ls.length - capR));
        const q = Math.hypot(Math.max(0, lat), over);
        let rel = armProfile(Math.max(0, q), P);
        // rugged upper ridge (unreachable): crags and pinnacles
        const up = 1 - smooth(P.Wtop * 0.7, P.Wtop, q);
        rel += up * (14 * (ridged(nS2, s / 34, spur.lat[c] / 16 + si * 9, 5) - 0.45) + 5 * fbm(nS, x / 20, z / 20, 3));
        // absolute crest: over the lowland, joined into the massif near the mountain
        let ah = landTop + rel;
        if (L.s < 4) {
          // in the sea the foothill shelf drowns and the crest stands as a sea cliff over deep water
          const sea = rel > 0 ? Math.max(low, SEA - 2.5 + (rel - P.F) * 1.2) : low;
          ah = lerp(sea, ah, smooth(-10, 4, L.s));
        }
        if (mh > -1e8 && s < 150) ah = Math.max(ah, Math.min(mh - 2, landTop + rel + (mh - landTop) * smooth(150, 0, s) * clamp(rel / P.Hc, 0, 1)));
        if (ah > h) h = ah;
        if (rel > P.F + 1) ridge.data[c] = 1;
      }
      if (mh > landTop + 8) ridge.data[c] = 1;
      const ih = isletHeight(x, z);
      if (ih > h) h = ih;
      const st = stackHeight(x, z);
      if (st > h) h = st;
      hGrid.data[c] = h;
      lowG.data[c] = L.h;
    }
  }
  return { h: hGrid, spur, ridge, lowland: lowG };
}

export { GATES, smax };
