// Building grammar (v3:towns): walls, frames, windows, doors and roofs shared by every town style.
// All functions draw in the builder's current frame: origin at the footprint centre on the floor,
// front facing +Z, width along X.

import * as THREE from 'three';
import { type Builder, type Col, C, shade, mixC, T, type Rng } from './kit';

export type RoofKind = 'gable' | 'gableSide' | 'hip' | 'pyramid' | 'flat' | 'dome' | 'cone' | 'shed' | 'onion' | 'none';

export interface Palette {
  wall: Col; wall2?: Col; base: Col; trim: Col; timber?: Col; roof: Col; roof2?: Col;
  door: Col; shutter?: Col; glass?: Col; flowers?: Col[];
}

export interface WinOpts { w?: number; h?: number; shutters?: boolean; flowers?: boolean; arch?: boolean; cross?: boolean; round?: boolean; deep?: number }

const WARM = '#ffc27a';

/** Window centred at (x, y) on a wall facing +Z at depth z (the wall surface). */
export function windowAt(b: Builder, x: number, y: number, z: number, pal: Palette, o: WinOpts = {}) {
  const w = o.w ?? 0.8, h = o.h ?? 1.05;
  const trim = pal.trim;
  const glass = pal.glass ?? WARM;
  if (o.round) {
    // round window: a trim ring (short cylinder with its axis along Z) and a glowing disc
    b.shape('solid', T.cyl(16), x, y, z + 0.03, w * 0.62, 0.12, w * 0.62, trim, { rx: Math.PI / 2 });
    b.shape('glow', T.disc(16), x, y, z + 0.1, w * 0.5, 1, w * 0.5, glass, { rx: Math.PI / 2 });
    b.box('solid', x, y, z + 0.11, 0.05, w, 0.03, trim);
    b.box('solid', x, y, z + 0.11, w, 0.05, 0.03, trim);
    return;
  }
  // frame + sill
  b.box('solid', x, y, z + 0.04, w + 0.16, h + 0.16, 0.1, trim);
  b.box('solid', x, y - h / 2 - 0.1, z + 0.1, w + 0.34, 0.09, 0.22, shade(trim, 0.9));
  if (o.arch) b.add('solid', T.cyl(12, 1, false), new THREE.Matrix4().compose(new THREE.Vector3(x, y + h / 2, z + 0.04), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new THREE.Vector3((w + 0.16) / 2, 0.1, (w + 0.16) / 2)), trim);
  // glass (inset a touch)
  b.quad('glow', x, y, z + 0.1, w, h, glass);
  if (o.arch) b.add('glow', T.disc(12), new THREE.Matrix4().compose(new THREE.Vector3(x, y + h / 2, z + 0.1), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new THREE.Vector3(w / 2, 1, w / 2)), glass);
  // mullions
  if (o.cross !== false) {
    b.box('solid', x, y, z + 0.12, 0.06, h, 0.04, trim);
    b.box('solid', x, y + h * 0.12, z + 0.12, w, 0.06, 0.04, trim);
  }
  if (o.shutters && pal.shutter) {
    for (const s of [-1, 1]) {
      b.box('solid', x + s * (w / 2 + 0.26), y, z + 0.07, 0.42, h + 0.05, 0.06, pal.shutter);
      b.box('solid', x + s * (w / 2 + 0.26), y, z + 0.1, 0.36, 0.05, 0.02, shade(pal.shutter, 0.8));
    }
  }
  if (o.flowers) flowerBox(b, x, y - h / 2 - 0.3, z + 0.22, w + 0.2, pal.flowers ?? ['#e2476a', '#f08aa8', '#ffd24a']);
}

export function flowerBox(b: Builder, x: number, y: number, z: number, w: number, colors: Col[]) {
  b.box('solid', x, y, z, w, 0.24, 0.26, '#6b4a30', { shade: [0.75, 1] });
  const n = Math.max(3, Math.round(w / 0.22));
  for (let i = 0; i < n; i++) {
    const fx = x - w / 2 + 0.12 + (i / (n - 1)) * (w - 0.24);
    b.sphere('leaf', fx, y + 0.16, z + ((i % 2) * 0.06 - 0.03), 0.14, 0.12, 0.13, '#4f8a38', { w: 6, h: 4, flat: true });
    b.sphere('leaf', fx + 0.03, y + 0.24, z + 0.05, 0.075, 0.07, 0.075, colors[i % colors.length], { w: 5, h: 4, flat: true });
  }
}

export interface DoorOpts { w?: number; h?: number; arch?: boolean; double?: boolean; canopy?: Col | null; lamp?: boolean; step?: Col; color?: Col }

/** Door centred at x on a wall facing +Z at depth z. Returns the world-local point in front of it. */
export function doorAt(b: Builder, x: number, z: number, pal: Palette, o: DoorOpts = {}) {
  const w = o.w ?? (o.double ? 1.7 : 1.1), h = o.h ?? 2.2;
  const dc = o.color ?? pal.door;
  b.box('solid', x, h / 2 + 0.04, z + 0.05, w + 0.3, h + 0.2, 0.12, pal.trim);
  b.box('solid', x, h / 2, z + 0.1, w, h, 0.08, dc, { shade: [0.85, 1.05] });
  if (o.arch) b.add('solid', T.cyl(12, 1, false), new THREE.Matrix4().compose(new THREE.Vector3(x, h, z + 0.08), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new THREE.Vector3(w / 2, 0.1, w / 2)), dc);
  // planks + iron straps
  for (let i = 1; i < (o.double ? 6 : 4); i++) b.box('solid', x - w / 2 + (i * w) / (o.double ? 6 : 4), h / 2, z + 0.145, 0.025, h * 0.96, 0.01, shade(dc, 0.72));
  for (const yy of [0.45, h - 0.45]) b.box('metal', x, yy, z + 0.155, w * 0.9, 0.07, 0.02, '#2c2a2a');
  b.sphere('metal', x + (o.double ? 0.12 : w * 0.32), 1.05, z + 0.18, 0.05, 0.05, 0.05, '#c9a24a', { w: 6, h: 4 });
  if (o.double) b.box('solid', x, h / 2, z + 0.15, 0.05, h, 0.02, shade(dc, 0.6));
  // step
  b.box('solid', x, -0.06, z + 0.42, w + 0.7, 0.18, 0.7, o.step ?? pal.base, { shade: [0.85, 1] });
  if (o.canopy) {
    const cw = w + 0.9;
    b.box('solid', x, h + 0.42, z + 0.52, cw, 0.08, 1.05, o.canopy, { rx: 0.35 });
    for (const s of [-1, 1]) b.beam('solid', [x + s * (cw / 2 - 0.1), h - 0.05, z + 0.1], [x + s * (cw / 2 - 0.1), h + 0.3, z + 0.85], 0.07, pal.timber ?? pal.trim);
  }
  if (o.lamp) wallLantern(b, x + w / 2 + 0.45, h + 0.1, z);
  return { x, z: z + 1.1 };
}

/** Iron wall bracket with a small glowing lantern. */
export function wallLantern(b: Builder, x: number, y: number, z: number) {
  b.box('metal', x, y + 0.2, z + 0.2, 0.05, 0.05, 0.42, '#2a2624');
  b.box('metal', x, y + 0.02, z + 0.4, 0.2, 0.05, 0.2, '#2a2624');
  b.box('glow', x, y - 0.14, z + 0.4, 0.16, 0.26, 0.16, WARM);
  b.cone('metal', x, y + 0.02, z + 0.4, 0.15, 0.14, '#2a2624', { sides: 4, ry: Math.PI / 4 });
}

// ── Roofs ───────────────────────────────────────────────────────────────────────────────────

export interface RoofOpts {
  overhang?: number; thick?: number; rows?: number; ridge?: Col | null; edge?: Col | null; jitter?: Rng; snow?: number;
}

/**
 * Gable roof over a w×d box whose top is at y0. Ridge runs along X (slopes face ±Z) unless
 * `alongZ`. `rise` = ridge height above y0. Returns the gable triangle so walls can fill it.
 */
export function gableRoof(b: Builder, y0: number, w: number, d: number, rise: number, color: Col, o: RoofOpts & { alongZ?: boolean; gableFill?: Col | null } = {}) {
  const ov = o.overhang ?? 0.45;
  const th = o.thick ?? 0.2;
  b.push();
  if (o.alongZ) { b.rotY(Math.PI / 2); [w, d] = [d, w]; }
  const half = d / 2;
  const slope = Math.hypot(half, rise);
  const ang = Math.atan2(rise, half);
  const len = w + ov * 2;
  const rows = o.rows ?? Math.max(3, Math.round((slope + ov) / 0.6));
  const rowW = (slope + ov) / rows;
  const base = typeof color === 'string' ? C(color) : color;
  for (const s of [-1, 1]) {
    for (let r = 0; r < rows; r++) {
      // distance along the slope from the ridge (0) down to the eave (slope + ov)
      const t0 = r * rowW, tc = t0 + rowW / 2;
      const zc = s * Math.cos(ang) * tc;
      const yc = y0 + rise - Math.sin(ang) * tc;
      const k = 0.9 + ((r * 7 + (s > 0 ? 3 : 0)) % 5) * 0.035 + (o.jitter ? (o.jitter() - 0.5) * 0.05 : 0);
      const c = base.clone().multiplyScalar(k * (0.94 + 0.06 * (r / rows)));
      b.box('solid', 0, yc + th / 2 * Math.cos(ang), zc + s * th / 2 * Math.sin(ang), len, th, rowW + 0.06, c, { rx: s * ang + s * 0.035 });
    }
    if (o.snow) {
      b.box('solid', 0, y0 + rise - Math.sin(ang) * (slope * 0.45) + th + 0.05, s * Math.cos(ang) * slope * 0.45, len + 0.05, 0.14, slope * 0.95, '#f4f7ff', { rx: s * ang });
    }
  }
  if (o.ridge !== null) b.box('solid', 0, y0 + rise + th * 0.9, 0, len + 0.1, 0.2, 0.32, o.ridge ?? shade(base, 0.7));
  // gable-end triangles (the wall material fills them)
  if (o.gableFill !== null) {
    for (const sx of [-1, 1]) b.prism('solid', sx * (w / 2 - 0.05), y0 - 0.001, 0, d, rise, 0.1, o.gableFill ?? '#e8dcc2', { ry: Math.PI / 2 });
  }
  // barge boards
  if (o.edge !== null) {
    const ec = o.edge ?? '#4a3222';
    for (const sx of [-1, 1]) for (const s of [-1, 1]) {
      const x = sx * (w / 2 + ov - 0.02);
      b.beam('solid', [x, y0 + rise + th, 0], [x, y0 - Math.sin(ang) * ov + th * 0.5, s * (half + Math.cos(ang) * ov)], 0.14, ec);
    }
  }
  b.pop();
  return { ang, slope };
}

/** Hip roof (pyramid when w == d): four slopes meeting in a ridge of length max(0, w-d). */
export function hipRoof(b: Builder, y0: number, w: number, d: number, rise: number, color: Col, o: RoofOpts = {}): { top: number } {
  if (d > w) { b.push().rotY(Math.PI / 2); const r = hipRoof(b, y0, d, w, rise, color, o); b.pop(); return r; }
  const ov = o.overhang ?? 0.45;
  const W = w / 2 + ov, D = d / 2 + ov;
  const ridge = Math.max(0, W - D);
  const top = y0 + rise + (ov * rise) / Math.max(0.01, Math.min(w, d) / 2);
  const y = y0 - 0.02;
  const r0: [number, number, number] = [-ridge, top, 0], r1: [number, number, number] = [ridge, top, 0];
  const e = [[-W, y, -D], [W, y, -D], [W, y, D], [-W, y, D]] as [number, number, number][];
  const pos: number[] = [];
  const idx: number[] = [];
  const quad = (a: number[], bb: number[], c: number[], dd: number[]) => {
    const i = pos.length / 3;
    pos.push(...a, ...bb, ...c, ...dd);
    idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  const tri = (a: number[], bb: number[], c: number[]) => { const i = pos.length / 3; pos.push(...a, ...bb, ...c); idx.push(i, i + 1, i + 2); };
  quad(e[3], e[2], r1, r0); // front (+z)
  quad(e[1], e[0], r0, r1); // back
  tri(e[2], e[1], r1); // right
  tri(e[0], e[3], r0); // left
  // thickness: underside skirt
  const base = typeof color === 'string' ? C(color) : color;
  flatRaw(b, 'solid', pos, idx, base);
  // hip + ridge caps
  const cap = o.ridge === null ? null : o.ridge ?? shade(base, 0.7);
  if (cap) {
    if (ridge > 0.01) b.beam('solid', r0, r1, 0.2, cap);
    b.beam('solid', r1, e[2], 0.14, cap); b.beam('solid', r1, e[1], 0.14, cap);
    b.beam('solid', r0, e[3], 0.14, cap); b.beam('solid', r0, e[0], 0.14, cap);
  }
  b.box('solid', 0, y0 - 0.08, 0, W * 2, 0.16, D * 2, shade(base, 0.6));
  if (o.snow) {
    const s = 0.75;
    const sp: number[] = [];
    const si: number[] = [];
    const lift = 0.1;
    const E = e.map(([x, yy, z]) => [x * s, yy + (top - yy) * (1 - s) + lift, z * s]);
    const R0 = [r0[0] * s, top + lift, 0], R1 = [r1[0] * s, top + lift, 0];
    const q2 = (a: number[], bb: number[], c: number[], dd: number[]) => { const i = sp.length / 3; sp.push(...a, ...bb, ...c, ...dd); si.push(i, i + 1, i + 2, i, i + 2, i + 3); };
    const t2 = (a: number[], bb: number[], c: number[]) => { const i = sp.length / 3; sp.push(...a, ...bb, ...c); si.push(i, i + 1, i + 2); };
    q2(E[3], E[2], R1, R0); q2(E[1], E[0], R0, R1); t2(E[2], E[1], R1); t2(E[0], E[3], R0);
    flatRaw(b, 'solid', sp, si, C('#f2f6ff'));
  }
  return { top };
}

/** Faceted triangles with flat normals, in the builder's current frame. */
export function flatRaw(b: Builder, bucket: string, pos: number[], idx: number[], color: THREE.Color) {
  const p: number[] = [];
  const n: number[] = [];
  const out: number[] = [];
  const A = new THREE.Vector3(), B = new THREE.Vector3(), Cc = new THREE.Vector3();
  for (let k = 0; k < idx.length; k += 3) {
    A.fromArray(pos, idx[k] * 3); B.fromArray(pos, idx[k + 1] * 3); Cc.fromArray(pos, idx[k + 2] * 3);
    const nn = new THREE.Vector3().subVectors(Cc, B).cross(new THREE.Vector3().subVectors(A, B)).normalize();
    const i = p.length / 3;
    p.push(A.x, A.y, A.z, B.x, B.y, B.z, Cc.x, Cc.y, Cc.z);
    for (let v = 0; v < 3; v++) n.push(nn.x, nn.y, nn.z);
    out.push(i, i + 1, i + 2);
  }
  b.raw(bucket, p, out, color, { nor: n });
}

// ── Walls ───────────────────────────────────────────────────────────────────────────────────

/** Half-timber frame on the four faces of a w×d box between y0 and y1. */
export function timberFrame(b: Builder, w: number, d: number, y0: number, y1: number, color: Col, o: { braces?: boolean; studs?: number; skipFront?: [number, number][] } = {}) {
  const t = 0.16, out = 0.05;
  const h = y1 - y0;
  const faces: [number, number, number, number][] = [ // [cx, cz, length, rotY]
    [0, d / 2 + out, w, 0], [0, -d / 2 - out, w, Math.PI], [w / 2 + out, 0, d, Math.PI / 2], [-w / 2 - out, 0, d, -Math.PI / 2],
  ];
  for (const [cx, cz, len, ry] of faces) {
    b.push().translate(cx, 0, cz).rotY(ry);
    b.box('solid', 0, y0 + t / 2, 0, len + t, t, t, color);
    b.box('solid', 0, y1 - t / 2, 0, len + t, t, t, color);
    const studs = o.studs ?? Math.max(2, Math.round(len / 1.3));
    for (let i = 0; i <= studs; i++) {
      const x = -len / 2 + (i / studs) * len;
      b.box('solid', x, (y0 + y1) / 2, 0, t, h, t, color);
    }
    if (o.braces !== false && len > 2.4) {
      const step = len / studs;
      for (const s of [-1, 1]) {
        const xa = s * (len / 2), xb = s * (len / 2 - step);
        b.beam('solid', [xa, y0 + 0.1, 0], [xb, y1 - 0.1, 0], 0.13, color);
      }
    }
    b.pop();
  }
}

/** Stone quoins (alternating corner blocks). */
export function quoins(b: Builder, w: number, d: number, y0: number, y1: number, color: Col) {
  const n = Math.floor((y1 - y0) / 0.42);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let i = 0; i < n; i++) {
    const long = i % 2 === 0;
    b.box('solid', sx * (w / 2 - (long ? 0.2 : 0.12)), y0 + 0.21 + i * 0.42, sz * (d / 2 - (long ? 0.12 : 0.2)), long ? 0.5 : 0.34, 0.38, long ? 0.34 : 0.5, color, { shade: [0.92, 1.04] });
  }
}

/** Horizontal plank courses on a wall face (+Z facing at depth z). */
export function plankCourses(b: Builder, w: number, y0: number, y1: number, z: number, color: Col, gap = 0.34) {
  const base = typeof color === 'string' ? C(color) : color;
  let i = 0;
  for (let y = y0 + gap / 2; y < y1; y += gap, i++) b.box('solid', 0, y, z, w, gap * 0.9, 0.06, base.clone().multiplyScalar(0.9 + ((i * 37) % 5) * 0.04), { rx: -0.06 });
}

/** Vertical board-and-batten boards (+Z facing at depth z). */
export function boards(b: Builder, w: number, y0: number, y1: number, z: number, color: Col, bw = 0.28) {
  const base = typeof color === 'string' ? C(color) : color;
  const n = Math.round(w / bw);
  for (let i = 0; i < n; i++) b.box('solid', -w / 2 + (i + 0.5) * (w / n), (y0 + y1) / 2, z, 0.05, y1 - y0, 0.04, shade(base, 0.75));
}

/** Chimney on a roof, base at y0 (inside the roof), top at y1. */
export function chimney(b: Builder, x: number, z: number, y0: number, y1: number, color: Col, smokeGlow = false) {
  b.box('solid', x, (y0 + y1) / 2, z, 0.75, y1 - y0, 0.75, color, { shade: [0.85, 1] });
  b.box('solid', x, y1 + 0.06, z, 0.92, 0.14, 0.92, shade(color, 0.85));
  b.box('solid', x, y1 + 0.2, z, 0.5, 0.18, 0.5, shade(color, 0.55));
  if (smokeGlow) b.box('shine', x, y1 + 0.3, z, 0.36, 0.04, 0.36, '#ff8a2a');
}

/** Stone plinth under a footprint: from yLow (below terrain) up to the floor (y=0). */
export function plinth(b: Builder, w: number, d: number, yLow: number, color: Col, lip = 0.12) {
  const h = -yLow + 0.02;
  b.box('solid', 0, yLow + h / 2 - 0.02, 0, w + lip * 2, h, d + lip * 2, color, { shade: [0.7, 1] });
}

export const tint = (c: Col, rnd: Rng, k = 0.06) => shade(c, 1 - k / 2 + rnd() * k);
export const blend = mixC;
