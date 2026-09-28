// Painterly atlas page (public/world/map.webp): hill-shade, watercolour region washes, coast ripple
// lines, hachured mountains and cliffs, forest glyphs, inked rivers and lakes, dashed roads, paper.
// No text — the UI adds labels and markers.

import { Grid, blur } from './grid';
import { simplex, fbm, seedOf, clamp, lerp, smooth, hash2 } from './noise';
import { SEA, ZONES, MC, type Pad } from './design';
import { writeImage } from './io';
import { WK, type LakeOut, type RiverGeom } from './hydro';
import type { Road } from './roads';
import type { Fields } from './fields';

const S = 2048;
type RGB = [number, number, number];
const hex = (h: string): RGB => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

class Canvas {
  px = new Float32Array(S * S * 3);
  set(i: number, c: RGB) { const o = i * 3; this.px[o] = c[0]; this.px[o + 1] = c[1]; this.px[o + 2] = c[2]; }
  get(i: number): RGB { const o = i * 3; return [this.px[o], this.px[o + 1], this.px[o + 2]]; }
  blend(x: number, y: number, c: RGB, a: number) {
    if (a <= 0 || x < 0 || y < 0 || x >= S || y >= S) return;
    const o = (y * S + x) * 3;
    this.px[o] += (c[0] - this.px[o]) * a; this.px[o + 1] += (c[1] - this.px[o + 1]) * a; this.px[o + 2] += (c[2] - this.px[o + 2]) * a;
  }
  disc(cx: number, cy: number, r: number, c: RGB, a = 1) {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      this.blend(x, y, c, clamp(r + 0.5 - d, 0, 1) * a);
    }
  }
  seg(ax: number, ay: number, bx: number, by: number, w: number, c: RGB, a = 1) {
    const x0 = Math.floor(Math.min(ax, bx) - w - 1), x1 = Math.ceil(Math.max(ax, bx) + w + 1);
    const y0 = Math.floor(Math.min(ay, by) - w - 1), y1 = Math.ceil(Math.max(ay, by) + w + 1);
    const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const t = clamp(((px - ax) * vx + (py - ay) * vy) / L2, 0, 1);
      const d = Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
      this.blend(x, y, c, clamp(w / 2 + 0.5 - d, 0, 1) * a);
    }
  }
  poly(pts: [number, number][], w: number, c: RGB, a = 1, dash?: [number, number]) {
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const L = Math.hypot(bx - ax, by - ay);
      if (dash) {
        const period = dash[0] + dash[1];
        const on = ((acc % period) + period) % period < dash[0];
        acc += L;
        if (!on) continue;
      }
      this.seg(ax, ay, bx, by, w, c, a);
    }
  }
}

const P = (x: number) => x + 1024; // world → pixel (1 px = 1 m)

export async function paintMap(file: string, ctx: { H: Grid; F: Fields; water: { surf: Grid; kind: Uint8Array }; roads: Road[]; rivers: RiverGeom[]; lakes: LakeOut[]; pads: Pad[] }) {
  const { H, F, water, roads, rivers, lakes } = ctx;
  const cv = new Canvas();
  const nPaper = simplex(seedOf('paper')), nWash = simplex(seedOf('wash'));
  const paper = hex('#ecdfc2'), paperDark = hex('#d9c7a0');
  const seaShallow = hex('#9ecfc6'), seaDeep = hex('#4a7f96'), ink = hex('#3c2f25'), inkBlue = hex('#2f5a78');
  const FNn = 1024;
  const fAt = (arr: ArrayLike<number>, x: number, z: number) => arr[Math.min(FNn - 1, Math.max(0, Math.round((z + 1024) / 2))) * FNn + Math.min(FNn - 1, Math.max(0, Math.round((x + 1024) / 2)))];
  // soft relief for washes
  const hb = blur(H, 2);
  const zoneCols = ZONES.map((z) => [hex(z.ground[0]), hex(z.ground[1]), hex(z.ground[2])]);

  // ── base: sea + land washes + hill-shade ──
  for (let y = 0; y < S; y++) {
    const z = y - 1024;
    for (let x = 0; x < S; x++) {
      const wx = x - 1024, i = y * S + x;
      const h = H.data[i];
      const grain = 0.94 + 0.06 * (fbm(nPaper, x / 3, y / 3, 2) * 0.5 + 0.5) + 0.03 * fbm(nPaper, x / 90, y / 90, 3);
      const kind = fAt(water.kind, wx, z);
      const ws = fAt(water.surf.data, wx, z);
      let c: RGB;
      if (kind === WK.ocean && h < SEA + 0.05) {
        const d = clamp((SEA - h) / 22, 0, 1);
        c = mix(seaShallow, seaDeep, Math.pow(d, 0.7));
        c = mix(c, paper, 0.18);
      } else {
        const zi = fAt(F.region, wx, z);
        const [lo, hi, acc] = zoneCols[zi];
        const t = clamp((fAt(F.macro, wx, z) - 0.2) * 1.2, 0, 1);
        let land = mix(lo, hi, t * 0.6);
        land = mix(land, acc, fAt(F.accent, wx, z) * 0.25);
        // hypsometric: highlands ochre-grey, snow white
        const alt = clamp((h - 60) / 150, 0, 1);
        land = mix(land, hex('#b9a88a'), alt * 0.55);
        land = mix(land, hex('#f4f1ea'), smooth(165, 200, h));
        // forest darkening, sand, rock
        land = mix(land, hex('#5f7f48'), fAt(F.forest, wx, z) * 0.35);
        const spl = (name: number) => fAt(F.splat[name], wx, z);
        land = mix(land, hex('#e7d6a4'), spl(6) * 0.8);   // sand
        land = mix(land, hex('#9c9285'), spl(5) * 0.6);   // rock
        land = mix(land, hex('#f6f4ee'), spl(7) * 0.85);  // snow
        land = mix(land, hex('#6b5a55'), spl(8) * 0.55);  // ash
        // watercolour: pale, paper showing through
        c = mix(paper, land, 0.62 + 0.1 * fbm(nWash, x / 70, y / 70, 3));
        // hill-shade (light from the north-west)
        const gx = (hb.data[i + (x < S - 1 ? 1 : 0)] - hb.data[i - (x > 0 ? 1 : 0)]) / 2;
        const gz = (hb.data[i + (y < S - 1 ? S : 0)] - hb.data[i - (y > 0 ? S : 0)]) / 2;
        const shade = clamp(0.5 + (-gx * 0.707 - gz * 0.707) * 0.9, 0, 1);
        const k = lerp(0.72, 1.12, shade);
        c = [c[0] * k, c[1] * k, c[2] * k];
        if (kind && kind !== WK.ocean && ws > h + 0.02) {
          const lakeC = kind === WK.lava ? hex('#e0582a') : kind === WK.frozen ? hex('#dfeef4') : kind === WK.marsh ? hex('#7f9a7c') : hex('#7fb9c4');
          c = mix(c, lakeC, 0.85);
        }
      }
      cv.set(i, [c[0] * grain, c[1] * grain, c[2] * grain]);
    }
  }

  // ── coast ink + ripple lines (offset contours in the sea) ──
  {
    const land = new Uint8Array(S * S);
    for (let i = 0; i < S * S; i++) land[i] = H.data[i] >= SEA ? 1 : 0;
    // distance (in px) from land into the sea, BFS up to 60
    const dist = new Float32Array(S * S).fill(1e9);
    const q: number[] = [];
    for (let i = 0; i < S * S; i++) if (land[i]) { dist[i] = 0; q.push(i); }
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi], d0 = dist[c];
      if (d0 >= 60) continue;
      const x = c % S;
      for (const o of [c - 1, c + 1, c - S, c + S]) {
        if (o < 0 || o >= S * S || Math.abs((o % S) - x) > 1) continue;
        if (dist[o] > d0 + 1) { dist[o] = d0 + 1; q.push(o); }
      }
    }
    const blurD = blur(new Grid(S, dist.map((v) => Math.min(v, 60))), 1.5).data;
    for (let i = 0; i < S * S; i++) {
      if (land[i]) continue;
      const d = blurD[i];
      if (d < 1.6) cv.blend(i % S, (i / S) | 0, inkBlue, 0.85 * clamp(1.6 - d, 0, 1));
      for (const [r, a] of [[7, 0.35], [15, 0.24], [25, 0.15], [37, 0.08]] as [number, number][]) {
        const e = Math.abs(d - r);
        if (e < 0.9) cv.blend(i % S, (i / S) | 0, inkBlue, a * (1 - e / 0.9));
      }
    }
  }

  // ── hachures on steep ground (short strokes down the fall line) ──
  {
    const step = 5;
    for (let y = 2; y < S - 2; y += step) for (let x = 2; x < S - 2; x += step) {
      const jx = x + (hash2(x, y, 1) - 0.5) * step, jy = y + (hash2(x, y, 2) - 0.5) * step;
      const i = Math.round(jy) * S + Math.round(jx);
      const h = H.data[i];
      if (h < SEA + 1) continue;
      const gx = (H.data[i + 1] - H.data[i - 1]) / 2, gz = (H.data[i + S] - H.data[i - S]) / 2;
      const s = Math.hypot(gx, gz);
      if (s < 0.55) continue;
      const len = clamp(s * 2.4, 2, 7);
      const dx = -gx / s, dy = -gz / s; // downhill
      const a = clamp((s - 0.55) * 0.9, 0, 0.55) * (h > 170 ? 0.5 : 1);
      cv.seg(jx, jy, jx + dx * len, jy + dy * len, 0.9, ink, a);
    }
  }

  // ── forest glyphs ──
  {
    const step = 7;
    for (let y = 0; y < S; y += step) for (let x = 0; x < S; x += step) {
      const jx = x + (hash2(x, y, 11) - 0.5) * step * 0.9, jy = y + (hash2(x, y, 12) - 0.5) * step * 0.9;
      const wx = jx - 1024, wz = jy - 1024;
      const f = fAt(F.forest, wx, wz);
      if (f < 0.35 || hash2(x, y, 13) > f * 1.1) continue;
      const zi = fAt(F.region, wx, wz);
      const id = ZONES[zi].id;
      const conifer = id === 'peaks' || id === 'lakes' || id === 'hollows' || (id === 'elder' && hash2(x, y, 14) < 0.3);
      const dark = id === 'marsh' ? hex('#3d5438') : id === 'scar' ? hex('#4b3a30') : hex('#2f5a2c');
      const light = mix(dark, hex('#9cc47a'), 0.45);
      const r = 2.2 + hash2(x, y, 15) * 1.2;
      if (conifer) {
        for (let k = 0; k < 3; k++) cv.seg(jx, jy - r * 1.6, jx - r * (0.5 + k * 0.25), jy + k * 0.6, 1.1, dark, 0.8);
        cv.seg(jx, jy - r * 1.6, jx + r * 0.9, jy + 1.2, 1.1, dark, 0.8);
      } else {
        cv.disc(jx + 0.6, jy + 0.8, r, hex('#2a2418'), 0.25);
        cv.disc(jx, jy, r, dark, 0.85);
        cv.disc(jx - r * 0.3, jy - r * 0.3, r * 0.45, light, 0.6);
      }
    }
  }

  // ── lakes: ink outline + inner ripple ──
  for (const L of lakes) {
    const R = Math.max(L.rx, L.rz) * 1.5;
    for (let y = Math.floor(P(L.z) - R); y <= P(L.z) + R; y++) for (let x = Math.floor(P(L.x) - R); x <= P(L.x) + R; x++) {
      const i = y * S + x;
      if (i < 0 || i >= S * S) continue;
      const wet = H.data[i] < L.level;
      const nb = [i - 1, i + 1, i - S, i + S].some((o) => (H.data[o] < L.level) !== wet);
      if (nb && Math.hypot(x - P(L.x), y - P(L.z)) < R) cv.blend(x, y, L.kind === 'lava' ? hex('#7a2410') : inkBlue, 0.75);
    }
  }
  // ── rivers ──
  for (const r of rivers) {
    const pts = r.pts.map(([x, z]) => [P(x), P(z)] as [number, number]);
    for (let i = 0; i < pts.length - 1; i++) {
      const w = lerp(r.def.w0, r.def.w1, i / pts.length) * 0.7 + 1.2;
      cv.seg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, r.def.lava ? hex('#e0582a') : hex('#6fa9bf'), 0.95);
      cv.seg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 0.9, r.def.lava ? hex('#7a2410') : inkBlue, 0.55);
    }
  }
  // ── roads ──
  for (const r of roads) {
    const pts = r.pts.map(([x, z]) => [P(x), P(z)] as [number, number]);
    if (r.kind === 'ring') { cv.poly(pts, 3.2, hex('#f3e6c6'), 0.8); cv.poly(pts, 2.0, hex('#7a4b2a'), 0.85, [9, 5]); }
    else if (r.kind === 'trail') cv.poly(pts, 1.4, hex('#7a4b2a'), 0.7, [4, 4]);
    else { cv.poly(pts, 2.4, hex('#f3e6c6'), 0.6); cv.poly(pts, 1.5, hex('#7a4b2a'), 0.8, [7, 4]); }
  }

  // ── vignette + deckled paper edge ──
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S - 0.5, v = y / S - 0.5;
    const e = Math.max(Math.abs(u), Math.abs(v));
    const edge = smooth(0.43, 0.5, e + 0.012 * fbm(nPaper, x / 40, y / 40, 3));
    const vig = 1 - 0.22 * smooth(0.25, 0.75, Math.hypot(u, v) * 1.3);
    const i = y * S + x;
    const c = cv.get(i);
    const k = vig;
    cv.set(i, mix([c[0] * k, c[1] * k, c[2] * k], paperDark, edge * 0.8));
  }
  void MC;

  const out = new Uint8Array(S * S * 3);
  for (let i = 0; i < S * S * 3; i++) out[i] = clamp(Math.round(cv.px[i]), 0, 255);
  return writeImage(file, out, S, S, 3, { quality: 82 });
}
