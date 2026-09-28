// Town building context (v3:towns). Each town is authored in its own local frame: origin at the
// plaza centre, +Z pointing out through the main gate (the road you arrive on), +X to the right
// of someone walking in. `TownCtx` maps that frame onto the terrain, collects the merged geometry
// (detail + far silhouette), colliders, anchors, interactables, lamps and walkable decks.

import * as THREE from 'three';
import type { Zone } from '../../data/zones';
import type { TerrainData } from '../terrain';
import type { Props } from '../props';
import { Builder, type Col, C, shade, rng, type Rng } from './kit';
import type { Anchor, Deck, Interactable, Service } from './types';

export type P2 = [number, number];

export interface Footprint { x: number; z: number; r: number }

export class TownCtx {
  readonly b = new Builder();
  readonly far = new Builder();
  readonly anchors: Record<string, Anchor> = {};
  readonly interactables: Interactable[] = [];
  readonly lamps: THREE.Vector3[] = [];
  readonly decks: Deck[] = [];
  /** Circles (world) that scatter/vegetation must keep clear of. */
  readonly clear: Footprint[] = [];
  readonly animated: { obj: THREE.Object3D; tick: (o: THREE.Object3D, t: number, dt: number) => void }[] = [];
  readonly extras = new THREE.Group();
  /** Ambient townsfolk: behaviour + a world-space path (first point = start). */
  readonly villagers: { act: 'sweep' | 'chat' | 'fish' | 'stroll' | 'work'; path: P2[]; yaw?: number; scale?: number }[] = [];
  readonly rnd: Rng;
  /** Terrain height at the plaza centre (the local frame's y = 0). */
  readonly base: number;
  private cos: number;
  private sin: number;
  private streetLift = 0.05;

  constructor(
    readonly id: string,
    readonly zone: Zone,
    readonly data: TerrainData,
    readonly props: Props,
    readonly cx: number,
    readonly cz: number,
    /** Rotation of the local frame (radians): local +Z maps to world (sin rot, cos rot). */
    readonly rot: number,
    readonly radius: number,
  ) {
    this.cos = Math.cos(rot);
    this.sin = Math.sin(rot);
    this.base = data.heightAt(cx, cz);
    this.rnd = rng(id);
  }

  // ── frames ──────────────────────────────────────────────────────────────────────────────
  /** Local → world XZ. */
  w(lx: number, lz: number): P2 { return [this.cx + lx * this.cos + lz * this.sin, this.cz - lx * this.sin + lz * this.cos]; }
  /** World → local XZ. */
  l(wx: number, wz: number): P2 { const dx = wx - this.cx, dz = wz - this.cz; return [dx * this.cos - dz * this.sin, dx * this.sin + dz * this.cos]; }
  /** Terrain height at a local point, relative to the frame (local y). */
  y(lx: number, lz: number) { const [x, z] = this.w(lx, lz); return this.data.heightAt(x, z) - this.base; }
  /** Local rotation → world rotation.y. */
  yaw(localRot: number) { return localRot + this.rot; }
  /** Rotation that makes a +Z-facing object at (x,z) face (tx,tz) (all local). */
  face(x: number, z: number, tx: number, tz: number) { return Math.atan2(tx - x, tz - z); }

  /** Floor level for a w×d footprint (local), plus the lowest terrain under it. */
  floor(x: number, z: number, w: number, d: number, rot: number, lift = 0.1) {
    const c = Math.cos(rot), s = Math.sin(rot);
    let hi = -1e9, lo = 1e9;
    for (const [px, pz] of [[0, 0], [-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, d / 2], [0, -d / 2], [w / 2, 0], [-w / 2, 0]]) {
      const h = this.y(x + px * c + pz * s, z - px * s + pz * c);
      hi = Math.max(hi, h); lo = Math.min(lo, h);
    }
    return { floor: hi + lift, low: lo - 0.35 };
  }

  /** Run `fn` with the builder placed at a local point on the ground (y = terrain + lift). */
  on(x: number, z: number, rot: number, fn: (y: number) => void, lift = 0) {
    const y = this.y(x, z) + lift;
    this.b.push().translate(x, y, z).rotY(rot);
    fn(y);
    this.b.pop();
    return y;
  }

  // ── registration ────────────────────────────────────────────────────────────────────────
  collide(lx: number, lz: number, r: number) {
    const [x, z] = this.w(lx, lz);
    this.props.addCollider({ x, z, r });
  }
  /** Rectangle collider approximated by circles along the long axis. */
  collideRect(lx: number, lz: number, w: number, d: number, rot: number, inset = 0.1) {
    const long = Math.max(w, d), short = Math.min(w, d);
    const r = short / 2 - inset;
    const n = Math.max(1, Math.ceil((long - short) / (r * 1.1)) + 1);
    const c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : -((long - short) / 2) + (i / (n - 1)) * (long - short);
      const px = w >= d ? t : 0, pz = w >= d ? 0 : t;
      this.collide(lx + px * c + pz * s, lz - px * s + pz * c, r);
    }
    this.keepClear(lx, lz, Math.hypot(w, d) / 2 + 1);
  }
  keepClear(lx: number, lz: number, r: number) { const [x, z] = this.w(lx, lz); this.clear.push({ x, z, r }); }

  anchor(name: string, lx: number, lz: number, localYaw: number) {
    const [x, z] = this.w(lx, lz);
    this.anchors[name] = { x, z, yaw: this.yaw(localYaw) };
  }

  service(svc: Service, lx: number, lz: number, label: string, data?: string, radius = 3.2, idSuffix?: string) {
    const [x, z] = this.w(lx, lz);
    this.interactables.push({
      pos: new THREE.Vector3(x, this.data.heightAt(x, z), z), radius, label, kind: 'service', service: svc, zone: this.zone,
      id: `${this.zone.id}-${idSuffix ?? svc}`, data, enabled: () => true,
    });
  }

  /** Add an ambient villager walking a local path (or standing at its first point). */
  villager(act: 'sweep' | 'chat' | 'fish' | 'stroll' | 'work', pts: P2[], localYaw = 0, scale?: number) {
    this.villagers.push({ act, path: pts.map(([x, z]) => this.w(x, z)), yaw: this.yaw(localYaw), scale });
  }

  /** Register a lamp (for the look workstream's night point-lights). Local coords, y local. */
  lamp(lx: number, ly: number, lz: number) {
    const [x, z] = this.w(lx, lz);
    this.lamps.push(new THREE.Vector3(x, ly + this.base, z));
  }

  // ── ground: streets, plazas, decks ──────────────────────────────────────────────────────

  /** Terrain-following ribbon along a local polyline. */
  street(pts: P2[], width: number, color: Col, o: { bucket?: string; step?: number; across?: number; curb?: Col | null; lift?: number; planar?: number; edgeDark?: number } = {}) {
    const lift = o.lift ?? (this.streetLift += 0.006);
    const res = resample(pts, o.step ?? 1.4);
    const across = o.across ?? Math.max(2, Math.round(width / 1.6));
    const pos: number[] = [];
    const idx: number[] = [];
    const cols: THREE.Color[] = [];
    const base = typeof color === 'string' ? C(color) : color;
    const edges: [P2[], P2[]] = [[], []];
    for (let i = 0; i < res.length; i++) {
      const a = res[Math.max(0, i - 1)], bb = res[Math.min(res.length - 1, i + 1)];
      let tx = bb[0] - a[0], tz = bb[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const nx = -tz, nz = tx;
      for (let k = 0; k <= across; k++) {
        const f = k / across - 0.5;
        const x = res[i][0] + nx * f * width, z = res[i][1] + nz * f * width;
        pos.push(x, this.y(x, z) + lift, z);
        const edge = Math.abs(f) * 2;
        cols.push(base.clone().multiplyScalar(1 - (o.edgeDark ?? 0.12) * edge * edge));
        if (k === 0) edges[0].push([x, z]);
        if (k === across) edges[1].push([x, z]);
      }
    }
    const row = across + 1;
    for (let i = 0; i < res.length - 1; i++) for (let k = 0; k < across; k++) {
      const a = i * row + k, bb = a + 1, c = a + row, d = c + 1;
      idx.push(a, bb, c, bb, d, c);
    }
    let vi = 0;
    this.b.raw(o.bucket ?? 'pave', pos, idx, () => cols[vi++], { planar: o.planar ?? 0.25 });
    if (o.curb) for (const e of edges) this.curb(e, o.curb, lift);
    for (let i = 0; i < res.length; i += 3) this.keepClear(res[i][0], res[i][1], width / 2 + 0.5);
  }

  /** Low stone curb along a local polyline. */
  curb(pts: P2[], color: Col, lift = 0.05, w = 0.26, h = 0.12) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const y = Math.max(this.y(ax, az), this.y(bx, bz)) + lift + h / 2 - 0.03;
      this.b.box('solid', mx, y, mz, w, h, len + 0.04, shade(color, 0.92 + ((i * 13) % 5) * 0.03), { ry: Math.atan2(bx - ax, bz - az) });
    }
  }

  /** Terrain-following convex fill (plazas, yards). */
  fill(poly: P2[], color: Col | ((x: number, z: number) => THREE.Color), o: { bucket?: string; cell?: number; lift?: number; planar?: number; curb?: Col | null } = {}) {
    const cell = o.cell ?? 1.6;
    const lift = o.lift ?? 0.09;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const pos: number[] = [];
    const idx: number[] = [];
    const keyMap = new Map<string, number>();
    const vid = (x: number, z: number) => {
      const k = `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
      let i = keyMap.get(k);
      if (i === undefined) { i = pos.length / 3; keyMap.set(k, i); pos.push(x, this.y(x, z) + lift, z); }
      return i;
    };
    for (let gx = Math.floor(x0 / cell) * cell; gx < x1; gx += cell) {
      for (let gz = Math.floor(z0 / cell) * cell; gz < z1; gz += cell) {
        let clip: P2[] = [[gx, gz], [gx + cell, gz], [gx + cell, gz + cell], [gx, gz + cell]];
        for (let e = 0; e < poly.length && clip.length; e++) clip = clipEdge(clip, poly[e], poly[(e + 1) % poly.length]);
        if (clip.length < 3) continue;
        const ids = clip.map(([x, z]) => vid(x, z));
        for (let t = 1; t < ids.length - 1; t++) idx.push(ids[0], ids[t + 1], ids[t]);
      }
    }
    const colorFn = typeof color === 'function' ? color : null;
    const base = typeof color === 'string' ? C(color) : (color as THREE.Color);
    this.b.raw(o.bucket ?? 'pave', pos, idx, (x, _y, z) => (colorFn ? colorFn(x, z) : base), { planar: o.planar ?? 0.25 });
    if (o.curb) this.curb([...poly, poly[0]], o.curb, lift);
    const cxm = (x0 + x1) / 2, czm = (z0 + z1) / 2;
    this.keepClear(cxm, czm, Math.hypot(x1 - x0, z1 - z0) / 2);
  }

  /**
   * Walkable plank deck: centre (x,z) local, `w` across, `len` along its local Z, rotation `rot`.
   * Heights h0/h1 are local y at the −len/2 / +len/2 ends. Posts drop to the terrain (or water).
   */
  deck(x: number, z: number, w: number, len: number, rot: number, h0: number, h1: number, o: { color?: Col; posts?: Col | null; rails?: Col | null; railSides?: [boolean, boolean]; postStep?: number; thick?: number } = {}) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const col = o.color ?? '#b08a62';
    const th = o.thick ?? 0.14;
    // plank surface as a raw quad with explicit UVs (boards run across the deck)
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const segs = Math.max(1, Math.round(len / 2));
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, lz = -len / 2 + t * len, hy = h0 + (h1 - h0) * t;
      for (const f of [-0.5, 0.5]) {
        const lx = f * w;
        pos.push(x + lx * c + lz * s, hy, z - lx * s + lz * c);
        uv.push(lz / 3.2, (f + 0.5) * w / 3.2);
      }
    }
    for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    this.b.raw('plank', pos, idx, col, { uv });
    // edge beams (give the deck thickness)
    this.b.push().translate(x, 0, z).rotY(rot);
    for (const f of [-1, 1]) this.b.beam('solid', [f * (w / 2 - 0.05), h0 - th / 2, -len / 2], [f * (w / 2 - 0.05), h1 - th / 2, len / 2], th, shade(col, 0.6));
    const step = o.postStep ?? 2.2;
    if (o.posts !== null) {
      const pc = o.posts ?? shade(col, 0.55);
      for (let lz = -len / 2 + 0.2; lz <= len / 2 - 0.1; lz += step) {
        const t = (lz + len / 2) / len, hy = h0 + (h1 - h0) * t;
        for (const f of [-1, 1]) {
          const lx = f * (w / 2 - 0.1);
          const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
          const ground = Math.min(this.y(wx, wz), hy - 0.3) - 0.6;
          this.b.cyl('solid', lx, ground, lz, 0.13, hy - ground - 0.02, pc, { sides: 7 });
        }
      }
    }
    if (o.rails) {
      const sides = o.railSides ?? [true, true];
      [-1, 1].forEach((f, si) => {
        if (!sides[si]) return;
        const lx = f * (w / 2 - 0.08);
        for (let lz = -len / 2 + 0.1; lz <= len / 2; lz += step) {
          const t = (lz + len / 2) / len, hy = h0 + (h1 - h0) * t;
          this.b.box('solid', lx, hy + 0.5, lz, 0.1, 1.0, 0.1, o.rails!);
        }
        this.b.beam('solid', [lx, h0 + 0.98, -len / 2 + 0.1], [lx, h1 + 0.98, len / 2], 0.09, o.rails!);
        this.b.beam('solid', [lx, h0 + 0.55, -len / 2 + 0.1], [lx, h1 + 0.55, len / 2], 0.06, shade(o.rails!, 0.9));
      });
    }
    this.b.pop();
    // walkable
    const [wx, wz] = this.w(x, z);
    this.decks.push({ x: wx, z: wz, hw: w / 2 + 0.05, hl: len / 2 + 0.05, rot: this.yaw(rot), h0: h0 + this.base, h1: h1 + this.base });
    this.keepClear(x, z, Math.hypot(w, len) / 2);
  }

  // ── silhouettes (far LOD) ───────────────────────────────────────────────────────────────
  /** Far-LOD block: a box body with a simple roof, in local frame at (x,z) rot. */
  silhouette(x: number, z: number, rot: number, w: number, d: number, y0: number, h: number, wall: Col, roof: Col, roofKind: 'gable' | 'flat' | 'dome' | 'cone' | 'hip' = 'gable', rise = 2.5, glow = 0) {
    const f = this.far;
    f.push().translate(x, y0, z).rotY(rot);
    f.box('solid', 0, h / 2, 0, w, h, d, wall);
    if (roofKind === 'gable') f.prism('solid', 0, h, 0, d + 0.6, rise, w + 0.6, roof, { ry: Math.PI / 2 });
    else if (roofKind === 'hip') f.cone('solid', 0, h, 0, Math.max(w, d) * 0.72, rise, roof, { sides: 4, ry: Math.PI / 4 });
    else if (roofKind === 'cone') f.cone('solid', 0, h, 0, Math.max(w, d) * 0.6, rise, roof, { sides: 8 });
    else if (roofKind === 'dome') f.dome('solid', 0, h, 0, Math.max(w, d) * 0.5, rise, roof, { w: 10, h: 4, flat: true });
    else f.box('solid', 0, h + 0.2, 0, w + 0.3, 0.4, d + 0.3, roof);
    if (glow > 0) for (let i = 0; i < glow; i++) f.quad('glow', -w / 2 + (i + 0.5) * (w / glow), h * 0.45, d / 2 + 0.02, 0.7, 0.9, '#ffc27a');
    f.pop();
  }
}

// ── geometry helpers ────────────────────────────────────────────────────────────────────────

/** Resample a polyline every `step` metres (keeps the endpoints). */
export function resample(pts: P2[], step: number): P2[] {
  const out: P2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(L / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

/** Sutherland–Hodgman: keep the part of `poly` on the left of edge a→b (CCW polygons). */
function clipEdge(poly: P2[], a: P2, b: P2): P2[] {
  const out: P2[] = [];
  const side = (p: P2) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const sp = side(p), sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

/** Polygon helpers (all CCW in the x–z plane as seen from above with +z down the screen). */
export function circle(cx: number, cz: number, r: number, n = 36, rz = r): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < n; i++) { const a = -(i / n) * Math.PI * 2; out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * rz]); }
  return orient(out);
}
export function rect(cx: number, cz: number, w: number, d: number, rot = 0): P2[] {
  const c = Math.cos(rot), s = Math.sin(rot);
  return orient(([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as P2[]).map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c] as P2));
}
/** Rounded rectangle / octagon-ish (corner cut `k`). */
export function octo(cx: number, cz: number, w: number, d: number, k: number, rot = 0): P2[] {
  const c = Math.cos(rot), s = Math.sin(rot);
  const hw = w / 2, hd = d / 2;
  const pts: P2[] = [[-hw + k, -hd], [hw - k, -hd], [hw, -hd + k], [hw, hd - k], [hw - k, hd], [-hw + k, hd], [-hw, hd - k], [-hw, -hd + k]];
  return orient(pts.map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c] as P2));
}
/** Make a polygon's winding match what `clipEdge` expects. */
function orient(p: P2[]): P2[] {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x0, z0] = p[i], [x1, z1] = p[(i + 1) % p.length]; a += x0 * z1 - x1 * z0; }
  return a < 0 ? p.reverse() : p;
}

export const lerp2 = (a: P2, b: P2, t: number): P2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const rnd01 = (r: Rng) => r();
export const colorOf = (c: Col) => (typeof c === 'string' ? C(c) : c);
