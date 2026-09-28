// Street furniture & props (v3:towns): lamps, benches, fences, walls, gates, wells, fountains,
// stalls, trees, planters, signs, banners, boards. Everything is built into a TownCtx in its local
// frame and sits on the terrain. Human scale: lamp posts ≈ 2.6 m, doors ≈ 2.2 m, benches 0.45 m.

import * as THREE from 'three';
import { envModel } from '../../assets/manifest';
import { type Col, C, shade, T, signRect, type Rng } from './kit';
import { type TownCtx, type P2, resample } from './town';

const WARM = '#ffc27a';
const IRON = '#2b2826';

// ── GLB kit props ───────────────────────────────────────────────────────────────────────────
/** Bake a manifest decor prop (`town_barrel`, …) at a local point on the ground. */
export function kit(ctx: TownCtx, key: string, x: number, z: number, rot = 0, s = 1, yOff = 0, variant?: number) {
  const o = envModel('decor', key, variant);
  if (!o) return false;
  ctx.b.glb(o, x, ctx.y(x, z) + yOff, z, rot, s);
  return true;
}

/** A tidy cluster of barrels / crates / sacks. */
export function goods(ctx: TownCtx, x: number, z: number, rot: number, r: Rng, n = 3, set: string[] = ['town_barrel', 'town_crate', 'town_sack', 'town_crate_small']) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const spots: [number, number, number][] = [[0, 0, 0], [0.95, 0.15, 0.4], [-0.9, 0.2, -0.3], [0.2, -0.85, 1.1], [0.95, -0.8, 0.2], [-0.8, -0.75, 0.8]];
  for (let i = 0; i < Math.min(n, spots.length); i++) {
    const [px, pz, pr] = spots[i];
    const key = set[(i + Math.floor(r() * set.length)) % set.length];
    kit(ctx, key, x + px * c + pz * s, z - px * s + pz * c, rot + pr + r() * 0.3);
  }
  if (n >= 4 && r() < 0.6) kit(ctx, 'town_crate_small', x + 0.1 * c, z - 0.1 * s, rot + 0.3, 1, 0.9);
  ctx.collide(x, z, 0.9);
}

// ── lamps ───────────────────────────────────────────────────────────────────────────────────
export type LampStyle = 'iron' | 'hanging' | 'brazier' | 'crystal' | 'moss' | 'brass' | 'torch' | 'rope';

export function lamp(ctx: TownCtx, x: number, z: number, style: LampStyle, rot = 0, tintCol?: Col) {
  const b = ctx.b;
  const y = ctx.y(x, z);
  b.push().translate(x, y, z).rotY(rot);
  let ly = 2.35;
  switch (style) {
    case 'iron': {
      b.cyl('solid', 0, -0.2, 0, 0.2, 0.42, '#8f877c', { sides: 8, top: 0.8, flat: true });
      b.cyl('metal', 0, 0.2, 0, 0.065, 1.9, IRON, { sides: 8, top: 0.75 });
      b.cyl('metal', 0, 0.2, 0, 0.11, 0.3, IRON, { sides: 8 });
      b.box('metal', 0, 2.12, 0, 0.3, 0.05, 0.3, IRON);
      b.box('glow', 0, 2.3, 0, 0.22, 0.32, 0.22, tintCol ?? WARM);
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box('metal', sx * 0.12, 2.3, sz * 0.12, 0.035, 0.34, 0.035, IRON);
      b.cone('metal', 0, 2.46, 0, 0.22, 0.16, IRON, { sides: 4, ry: Math.PI / 4 });
      b.sphere('metal', 0, 2.62, 0, 0.04, 0.04, 0.04, '#b89040', { w: 6, h: 4 });
      ly = 2.3;
      break;
    }
    case 'hanging':
    case 'rope': {
      const wood = style === 'rope' ? '#7d6a52' : '#5a4330';
      b.box('solid', 0, 1.3, 0, 0.16, 2.6, 0.16, wood, { shade: [0.7, 1] });
      b.box('solid', 0.36, 2.48, 0, 0.8, 0.12, 0.12, wood);
      b.beam('solid', [0, 2.1, 0], [0.4, 2.46, 0], 0.08, wood);
      b.box('metal', 0.66, 2.3, 0, 0.02, 0.3, 0.02, IRON);
      b.box('glow', 0.66, 1.98, 0, 0.2, 0.3, 0.2, tintCol ?? WARM);
      b.cone('metal', 0.66, 2.12, 0, 0.19, 0.14, IRON, { sides: 4, ry: Math.PI / 4 });
      b.box('metal', 0.66, 1.82, 0, 0.22, 0.03, 0.22, IRON);
      if (style === 'rope') b.tubeAlong('solid', [[0.1, 2.5, 0], [0.4, 2.42, 0.05], [0.66, 2.46, 0]], 0.02, '#c8b48a', { sides: 4, segs: 6 });
      ly = 1.98;
      b.pop();
      ctx.lamp(x + Math.cos(rot) * 0.66, y + ly, z - Math.sin(rot) * 0.66);
      ctx.collide(x, z, 0.3);
      return;
    }
    case 'brazier': {
      b.cyl('solid', 0, 0, 0, 0.34, 1.0, tintCol ? '#3a3431' : '#6f6a66', { sides: 6, top: 0.8, flat: true });
      b.cyl('metal', 0, 1.0, 0, 0.42, 0.28, IRON, { sides: 8, top: 1.2 });
      b.cyl('shine', 0, 1.18, 0, 0.36, 0.12, '#ff9a3a', { sides: 8 });
      b.cone('glow', 0, 1.24, 0, 0.28, 0.5, '#ffb04a', { sides: 6 });
      ly = 1.6;
      break;
    }
    case 'crystal': {
      b.cyl('solid', 0, 0, 0, 0.24, 0.3, '#4a4658', { sides: 6, flat: true });
      b.cyl('metal', 0, 0.3, 0, 0.06, 1.75, '#3a3444', { sides: 6 });
      b.cyl('metal', 0, 2.0, 0, 0.18, 0.08, '#3a3444', { sides: 6 });
      const c = tintCol ?? '#7fe8ff';
      b.shape('shine', T.octa(), 0, 2.42, 0, 0.16, 0.42, 0.16, c, { ry: 0.3 });
      b.shape('shine', T.octa(), 0.12, 2.24, 0.05, 0.08, 0.22, 0.08, c, { rz: -0.5 });
      b.shape('shine', T.octa(), -0.1, 2.22, -0.06, 0.07, 0.2, 0.07, c, { rz: 0.5 });
      ly = 2.35;
      break;
    }
    case 'moss': {
      b.tubeAlong('solid', [[0, 0, 0], [0.05, 1.2, 0], [0.18, 2.2, 0], [0.55, 2.65, 0], [0.8, 2.55, 0]], 0.09, '#5b4632', { sides: 6, taper: 0.5 });
      b.box('solid', 0.8, 2.3, 0, 0.015, 0.45, 0.015, '#c8b48a');
      b.sphere('shine', 0.8, 2.02, 0, 0.2, 0.22, 0.2, tintCol ?? '#9dffb0', { w: 8, h: 6 });
      b.sphere('leaf', 0.8, 2.16, 0, 0.23, 0.12, 0.23, '#3f6a3a', { w: 8, h: 4, flat: true });
      b.pop();
      ctx.lamp(x + Math.cos(rot) * 0.8, y + 2.02, z - Math.sin(rot) * 0.8);
      ctx.collide(x, z, 0.25);
      return;
    }
    case 'brass': {
      b.cyl('solid', 0, 0, 0, 0.18, 0.2, '#c9a878', { sides: 8 });
      b.cyl('metal', 0, 0.2, 0, 0.045, 1.95, '#a97d3a', { sides: 8 });
      b.sphere('metal', 0, 2.2, 0, 0.09, 0.09, 0.09, '#a97d3a', { w: 8, h: 6 });
      b.cyl('glow', 0, 2.25, 0, 0.17, 0.3, tintCol ?? '#ffb869', { sides: 8, top: 0.7 });
      b.cone('metal', 0, 2.55, 0, 0.14, 0.2, '#a97d3a', { sides: 8 });
      ly = 2.4;
      break;
    }
    case 'torch': {
      b.cyl('solid', 0, 0, 0, 0.07, 2.1, '#5b4330', { sides: 6, top: 0.8 });
      b.cyl('solid', 0, 2.0, 0, 0.1, 0.2, '#3a2a1e', { sides: 6 });
      b.cone('glow', 0, 2.2, 0, 0.12, 0.4, '#ffb04a', { sides: 6 });
      ly = 2.35;
      break;
    }
  }
  b.pop();
  ctx.lamp(x, y + ly, z);
  ctx.collide(x, z, 0.28);
}

// ── seating ─────────────────────────────────────────────────────────────────────────────────
export function bench(ctx: TownCtx, x: number, z: number, rot: number, o: { wood?: Col; iron?: Col; stone?: boolean; len?: number } = {}) {
  const b = ctx.b;
  const len = o.len ?? 1.7;
  ctx.on(x, z, rot, () => {
    if (o.stone) {
      for (const s of [-1, 1]) b.block('solid', s * (len / 2 - 0.2), 0, 0, 0.3, 0.42, 0.45, '#8c8479');
      b.block('solid', 0, 0.42, 0, len, 0.1, 0.52, '#a39a8c');
      return;
    }
    const wood = o.wood ?? '#8a5c38';
    const iron = o.iron ?? IRON;
    for (const s of [-1, 1]) {
      b.box('metal', s * (len / 2 - 0.15), 0.22, 0.02, 0.06, 0.44, 0.42, iron);
      b.beam('metal', [s * (len / 2 - 0.15), 0.44, -0.18], [s * (len / 2 - 0.15), 0.9, -0.26], 0.06, iron);
    }
    for (let i = 0; i < 3; i++) b.box('solid', 0, 0.45, 0.14 - i * 0.14, len, 0.05, 0.12, shade(wood, 0.95 + i * 0.04));
    for (let i = 0; i < 2; i++) b.box('solid', 0, 0.62 + i * 0.18, -0.22 - i * 0.03, len, 0.12, 0.04, wood, { rx: -0.18 });
  });
  ctx.collide(x, z, 0.55);
}

// ── fences, hedges, walls ───────────────────────────────────────────────────────────────────
export type FenceStyle = 'picket' | 'rail' | 'stone' | 'hedge' | 'palisade' | 'adobe' | 'rope' | 'iron' | 'basalt' | 'rampart';

/** Fence along a local polyline (terrain-following). Registers colliders unless `walkable`. */
export function fence(ctx: TownCtx, pts: P2[], style: FenceStyle, o: { color?: Col; cap?: Col; h?: number; walkable?: boolean; r?: Rng } = {}) {
  const b = ctx.b;
  const step = style === 'picket' ? 0.24 : style === 'palisade' ? 0.42 : style === 'hedge' ? 0.9 : 2.0;
  const res = resample(pts, style === 'picket' || style === 'palisade' ? 2.0 : 2.0);
  const r = o.r ?? ctx.rnd;
  for (let i = 0; i < res.length - 1; i++) {
    const [ax, az] = res[i], [bx, bz] = res[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const ya = ctx.y(ax, az), yb = ctx.y(bx, bz);
    const ry = Math.atan2(bx - ax, bz - az);
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, my = (ya + yb) / 2;
    const tilt = Math.atan2(ya - yb, len);
    switch (style) {
      case 'picket': {
        const col = o.color ?? '#efe6d2';
        b.push().translate(ax, ya, az).rotY(ry);
        for (let t = 0.12; t < len; t += step) {
          const yy = (yb - ya) * (t / len);
          b.box('solid', 0, yy + 0.45, t, 0.09, 0.9, 0.045, col, { shade: [0.8, 1] });
          b.cone('solid', 0, yy + 0.9, t, 0.064, 0.12, col, { sides: 4, ry: Math.PI / 4 });
        }
        for (const hh of [0.28, 0.68]) b.beam('solid', [0, hh, 0], [0, yb - ya + hh, len], 0.06, shade(col, 0.85));
        b.pop();
        break;
      }
      case 'rail': {
        const col = o.color ?? '#8a6a48';
        b.push().translate(ax, ya, az).rotY(ry);
        b.box('solid', 0, 0.55, 0, 0.14, 1.1, 0.14, shade(col, 0.85), { shade: [0.7, 1] });
        for (const hh of [0.45, 0.9]) b.beam('solid', [0, hh, 0], [0.02, yb - ya + hh, len], 0.09, col, { round: 5 });
        b.pop();
        if (i === res.length - 2) ctx.on(bx, bz, ry, () => b.box('solid', 0, 0.55, 0, 0.14, 1.1, 0.14, shade(col, 0.85)));
        break;
      }
      case 'stone':
      case 'basalt': {
        const col = o.color ?? (style === 'basalt' ? '#3d3a3c' : '#9a9083');
        const h = o.h ?? 0.8;
        b.box('solid', mx, my + h / 2 - 0.05, mz, 0.6, h + 0.1, len + 0.08, shade(col, 0.9 + r() * 0.15), { ry, rx: tilt, shade: [0.7, 1.05] });
        b.box('solid', mx, my + h + 0.05, mz, 0.72, 0.14, len + 0.1, o.cap ?? shade(col, 1.12), { ry, rx: tilt });
        // a few proud stones for texture
        for (let k = 0; k < 2; k++) {
          const t = r() - 0.5;
          b.box('solid', mx + Math.sin(ry) * t * len, my + 0.2 + r() * (h - 0.4), mz + Math.cos(ry) * t * len, 0.64, 0.22, 0.4, shade(col, 0.82 + r() * 0.2), { ry });
        }
        break;
      }
      case 'hedge': {
        const col = o.color ?? '#3f7a34';
        const h = o.h ?? 1.15;
        b.box('leaf', mx, my + h / 2, mz, 0.9, h, len + 0.3, shade(col, 0.92 + r() * 0.12), { ry, rx: tilt, shade: [0.65, 1.05] });
        for (let k = 0; k < 3; k++) {
          const t = (k / 2 - 0.5) * len;
          b.sphere('leaf', mx + Math.sin(ry) * t, my + h - 0.05 + r() * 0.1, mz + Math.cos(ry) * t, 0.5, 0.26, 0.5 + len * 0.2, shade(col, 1.0 + r() * 0.15), { w: 7, h: 4, flat: true, rot: ry });
        }
        break;
      }
      case 'palisade': {
        const col = o.color ?? '#7a5a3c';
        b.push().translate(ax, ya, az).rotY(ry);
        for (let t = 0.2; t < len; t += step) {
          const yy = (yb - ya) * (t / len);
          const hh = (o.h ?? 2.4) + (r() - 0.5) * 0.3;
          b.cyl('solid', 0, yy - 0.3, t, 0.2, hh + 0.3, shade(col, 0.85 + r() * 0.25), { sides: 6, flat: true });
          b.cone('solid', 0, yy + hh, t, 0.2, 0.45, shade(col, 1.05), { sides: 6 });
        }
        b.beam('solid', [0.22, 1.5, 0], [0.22, yb - ya + 1.5, len], 0.12, shade(col, 0.7));
        b.pop();
        break;
      }
      case 'adobe': {
        const col = o.color ?? '#d9b384';
        const h = o.h ?? 1.5;
        b.box('solid', mx, my + h / 2 - 0.1, mz, 0.5, h + 0.2, len + 0.06, shade(col, 0.95 + r() * 0.08), { ry, rx: tilt, shade: [0.75, 1.02] });
        b.add('solid', T.cyl(8, 1, false), matRot(mx, my + h + 0.1, mz, 0.25, len + 0.06, 0.25, ry), shade(col, 1.05));
        break;
      }
      case 'rope': {
        const col = o.color ?? '#6d5a44';
        b.push().translate(ax, ya, az).rotY(ry);
        b.cyl('solid', 0, -0.2, 0, 0.1, 1.2, col, { sides: 6 });
        b.tubeAlong('solid', [[0, 0.9, 0], [0, (yb - ya) / 2 + 0.72, len / 2], [0, yb - ya + 0.9, len]], 0.025, '#cdb88f', { sides: 4, segs: 6 });
        b.pop();
        break;
      }
      case 'iron': {
        const col = o.color ?? IRON;
        b.push().translate(ax, ya, az).rotY(ry);
        b.box('solid', 0, 0.2, len / 2, 0.3, 0.4, len, '#8f877c');
        for (let t = 0.1; t < len; t += 0.18) b.box('metal', 0, 0.8, t, 0.03, 0.8, 0.03, col);
        b.beam('metal', [0, 1.15, 0], [0, 1.15 + (yb - ya), len], 0.04, col);
        b.pop();
        break;
      }
      case 'rampart': {
        const col = o.color ?? '#8d8e96';
        const h = o.h ?? 4.2;
        b.box('solid', mx, my + h / 2 - 0.3, mz, 1.4, h + 0.6, len + 0.1, shade(col, 0.92 + r() * 0.1), { ry, rx: tilt, shade: [0.65, 1.02] });
        // crenellations
        const n = Math.max(1, Math.round(len / 1.1));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n - 0.5;
          if (k % 2) continue;
          b.box('solid', mx + Math.sin(ry) * t * len, my + h + 0.35, mz + Math.cos(ry) * t * len, 1.5, 0.7, len / n * 0.9, shade(col, 1.04), { ry });
        }
        break;
      }
    }
    if (!o.walkable) {
      const n = Math.max(1, Math.round(len / 1.2));
      const cr = style === 'rampart' ? 0.9 : style === 'hedge' ? 0.55 : 0.35;
      for (let k = 0; k <= n; k++) ctx.collide(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, cr);
    }
  }
}

function matRot(x: number, y: number, z: number, sx: number, len: number, sz: number, ry: number) {
  // cylinder lying along the local Z axis of a segment with yaw ry
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, ry, 0, 'YXZ')), new THREE.Vector3(sx, len, sz));
}

// ── gates & signs ───────────────────────────────────────────────────────────────────────────

/** A board with atlas text, centred at (x, y, z) local, facing rot, both faces printed. */
export function signBoard(ctx: TownCtx, x: number, y: number, z: number, rot: number, w: number, h: number, text: string, o: { sub?: string; icon?: string; bg?: string; fg?: string; accent?: string; frame?: Col; back?: boolean } = {}) {
  const rectUV = signRect(text, { sub: o.sub, icon: o.icon, bg: o.bg, fg: o.fg, accent: o.accent, aspect: w / h });
  const b = ctx.b;
  b.push().translate(x, y, z).rotY(rot);
  b.box('solid', 0, 0, 0, w + 0.12, h + 0.12, 0.08, o.frame ?? '#3a2618');
  b.quad('sign', 0, 0, 0.045, w, h, '#ffffff', { uvRect: rectUV });
  if (o.back !== false) b.quad('sign', 0, 0, -0.045, w, h, '#ffffff', { uvRect: rectUV, ry: Math.PI });
  b.pop();
}

/** Signpost: a post with a board on top (e.g. at a gate or a crossroads). */
export function signpost(ctx: TownCtx, x: number, z: number, rot: number, text: string, o: { sub?: string; icon?: string; wood?: Col; bg?: string; accent?: string } = {}) {
  const wood = o.wood ?? '#5a4330';
  ctx.on(x, z, rot, () => {
    ctx.b.box('solid', 0, 1.1, 0, 0.14, 2.2, 0.14, wood, { shade: [0.7, 1] });
    ctx.b.cone('solid', 0, 2.2, 0, 0.12, 0.14, wood, { sides: 4, ry: Math.PI / 4 });
  });
  const y = ctx.y(x, z);
  signBoard(ctx, x + Math.sin(rot) * 0.1, y + 1.75, z + Math.cos(rot) * 0.1, rot, 1.35, 0.42, text, { sub: o.sub, icon: o.icon, frame: wood, bg: o.bg, accent: o.accent });
  ctx.collide(x, z, 0.25);
}

/** Projecting bracket sign with an icon disc (hangs off a wall at height y, sticking out along +X). */
export function bracketSign(ctx: TownCtx, x: number, y: number, z: number, rot: number, icon: string, bg: string, text?: string) {
  const b = ctx.b;
  b.push().translate(x, y, z).rotY(rot);
  b.box('metal', 0.35, 0.36, 0, 0.7, 0.05, 0.05, IRON);
  b.beam('metal', [0.02, 0.0, 0], [0.5, 0.35, 0], 0.035, IRON);
  b.box('metal', 0.62, 0.22, 0, 0.02, 0.26, 0.02, IRON);
  b.pop();
  const c = Math.cos(rot), s = Math.sin(rot);
  const ox = x + 0.62 * c, oz = z - 0.62 * s;
  const uv = signRect(text ?? icon, { icon: text ? icon : undefined, bg, aspect: text ? 1.0 : 1.0 });
  // disc sign in the plane of the bracket, so people walking along the wall see its face
  b.push().translate(ox, y - 0.2, oz).rotY(rot);
  b.shape('solid', T.cyl(18), 0, 0, 0, 0.36, 0.06, 0.36, '#3a2618', { rx: Math.PI / 2 });
  b.add('sign', T.disc(18), new THREE.Matrix4().compose(new THREE.Vector3(0, 0, 0.035), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new THREE.Vector3(0.31, 1, 0.31)), '#ffffff', { uvRect: uv });
  b.add('sign', T.disc(18), new THREE.Matrix4().compose(new THREE.Vector3(0, 0, -0.035), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), new THREE.Vector3(0.31, 1, 0.31)), '#ffffff', { uvRect: uv });
  b.pop();
}

// ── plaza furniture ─────────────────────────────────────────────────────────────────────────

/** Tiered stone fountain with animated water. */
export function fountain(ctx: TownCtx, x: number, z: number, o: { stone?: Col; water?: Col; r?: number; tiers?: number } = {}) {
  const b = ctx.b;
  const stone = o.stone ?? '#b7ad9c';
  const water = o.water ?? '#4fb6cf';
  const R = o.r ?? 3.4;
  const y = ctx.y(x, z);
  b.push().translate(x, y, z);
  // basin: outer wall + rim + inner floor
  b.lathe('solid', 0, -0.3, 0, [[R - 0.35, 0], [R + 0.05, 0], [R + 0.12, 0.08], [R + 0.05, 0.55], [R + 0.22, 0.62], [R + 0.22, 0.72], [R - 0.3, 0.72], [R - 0.35, 0.3], [0, 0.3]], stone, { sides: 32 });
  b.add('water', T.disc(32), new THREE.Matrix4().compose(new THREE.Vector3(0, 0.32, 0), new THREE.Quaternion(), new THREE.Vector3(R - 0.32, 1, R - 0.32)), water);
  // column + upper bowl
  b.lathe('solid', 0, 0.2, 0, [[0.62, 0], [0.62, 0.16], [0.42, 0.3], [0.34, 1.2], [0.46, 1.34], [1.35, 1.46], [1.45, 1.62], [1.3, 1.64], [0.4, 1.56], [0.22, 1.9], [0.3, 2.3], [0.16, 2.45], [0, 2.46]], stone, { sides: 20 });
  b.add('water', T.disc(20), new THREE.Matrix4().compose(new THREE.Vector3(0, 1.8, 0), new THREE.Quaternion(), new THREE.Vector3(1.28, 1, 1.28)), water);
  // falling sheet from the upper bowl
  b.add('water', T.tube(20, 1.02), new THREE.Matrix4().compose(new THREE.Vector3(0, 1.05, 0), new THREE.Quaternion(), new THREE.Vector3(1.42, 1.25, 1.42)), shade(water, 1.25));
  // finial orb
  b.sphere('shine', 0, 2.62, 0, 0.2, 0.2, 0.2, '#bff4ff', { w: 10, h: 8 });
  b.pop();
  ctx.collide(x, z, R + 0.3);
  ctx.keepClear(x, z, R + 1);
}

/** Round stone well with a little shingled roof, crank and bucket. */
export function well(ctx: TownCtx, x: number, z: number, rot: number, o: { stone?: Col; roof?: Col; wood?: Col } = {}) {
  const b = ctx.b;
  const stone = o.stone ?? '#a39a8c', wood = o.wood ?? '#6a4a32', roof = o.roof ?? '#8a4a34';
  ctx.on(x, z, rot, () => {
    b.lathe('solid', 0, -0.2, 0, [[0.95, 0], [1.0, 0.1], [1.0, 0.85], [1.1, 0.9], [1.1, 1.02], [0.8, 1.02], [0.8, 0.3], [0, 0.3]], stone, { sides: 14, flat: true });
    b.add('water', T.disc(12), new THREE.Matrix4().makeTranslation(0, 0.35, 0).multiply(new THREE.Matrix4().makeScale(0.8, 1, 0.8)), '#2f6f86');
    for (const s of [-1, 1]) b.box('solid', s * 0.9, 1.6, 0, 0.14, 1.9, 0.14, wood, { shade: [0.75, 1] });
    b.box('solid', 0, 2.1, 0, 2.0, 0.09, 0.09, wood);
    b.cyl('solid', 0, 1.62, 0, 0.1, 1.5, shade(wood, 0.8), { sides: 8, rz: Math.PI / 2 });
    b.box('metal', 0.85, 1.62, 0.15, 0.05, 0.05, 0.3, IRON);
    b.box('solid', 0, 1.25, 0, 0.3, 0.3, 0.3, '#7a5a3a', { shade: [0.8, 1] });
    b.box('solid', 0, 1.9, 0, 0.02, 0.6, 0.02, '#c8b48a');
    for (const s of [-1, 1]) b.box('solid', 0, 2.4, s * 0.38, 2.4, 0.08, 1.0, shade(roof, 0.95 + s * 0.05), { rx: s * 0.72 });
    b.box('solid', 0, 2.62, 0, 2.45, 0.1, 0.12, shade(roof, 0.7));
  });
  ctx.collide(x, z, 1.25);
}

/** Covered quest notice board with pinned papers and a lantern. Front faces +Z of rot. */
export function questBoard(ctx: TownCtx, x: number, z: number, rot: number, o: { wood?: Col; roof?: Col } = {}) {
  const b = ctx.b;
  const wood = o.wood ?? '#5c3f2a', roof = o.roof ?? '#7a3f2c';
  ctx.on(x, z, rot, () => {
    for (const s of [-1, 1]) b.box('solid', s * 1.15, 1.3, 0, 0.16, 2.6, 0.16, wood, { shade: [0.7, 1] });
    b.box('solid', 0, 1.55, 0, 2.2, 1.35, 0.1, '#9a7650');
    b.box('solid', 0, 0.86, 0, 2.3, 0.08, 0.14, wood);
    b.box('solid', 0, 2.24, 0, 2.3, 0.08, 0.14, wood);
    const papers = ['#f4ead2', '#efe0c0', '#f8f0dc', '#e8d8b8', '#f4e2c8', '#efe8d8'];
    const r = ctx.rnd;
    for (let i = 0; i < 7; i++) {
      const px = -0.82 + (i % 4) * 0.55 + (r() - 0.5) * 0.1, py = 1.85 - Math.floor(i / 4) * 0.55 + (r() - 0.5) * 0.08;
      b.quad('solid', px, py, 0.056, 0.36, 0.44, papers[i % papers.length], { rz: (r() - 0.5) * 0.18 });
      b.box('solid', px, py + 0.19, 0.06, 0.05, 0.05, 0.02, ['#c83a3a', '#3a6ac8', '#e0b030'][i % 3]);
    }
    for (const s of [-1, 1]) b.box('solid', 0, 2.55, s * 0.28, 2.8, 0.08, 0.72, shade(roof, 0.95 + s * 0.05), { rx: s * 0.6 });
    b.box('solid', 0, 2.78, 0, 2.85, 0.1, 0.1, shade(roof, 0.7));
  });
  const c = Math.cos(rot), s = Math.sin(rot);
  ctx.collide(x - 0.9 * c, z + 0.9 * s, 0.4);
  ctx.collide(x + 0.9 * c, z - 0.9 * s, 0.4);
  // a small lantern on the right post
  const lx = x + 1.15 * c + 0.1 * s, lz = z - 1.15 * s + 0.1 * c;
  ctx.b.push().translate(lx, ctx.y(x, z), lz).rotY(rot);
  ctx.b.box('glow', 0, 2.0, 0.12, 0.16, 0.22, 0.16, WARM);
  ctx.b.cone('metal', 0, 2.1, 0.12, 0.14, 0.1, IRON, { sides: 4, ry: Math.PI / 4 });
  ctx.b.pop();
  ctx.lamp(lx, ctx.y(x, z) + 2.0, lz);
}

/** Market stall: counter, posts and a striped cloth awning; goods on top. Front = +Z of rot. */
export function stall(ctx: TownCtx, x: number, z: number, rot: number, stripes: [Col, Col], goodsKind: 'fruit' | 'bread' | 'fish' | 'cloth' | 'pots' | 'gems' | 'herbs' = 'fruit', o: { wood?: Col; w?: number } = {}) {
  const b = ctx.b;
  const wood = o.wood ?? '#7a5436';
  const w = o.w ?? 2.4;
  const r = ctx.rnd;
  ctx.on(x, z, rot, () => {
    b.block('solid', 0, 0, 0.1, w, 0.95, 0.9, shade(wood, 0.9));
    b.box('solid', 0, 0.99, 0.12, w + 0.1, 0.08, 1.02, wood);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('solid', sx * (w / 2 - 0.06), 1.15, sz * 0.5 - 0.05, 0.1, 2.3, 0.1, shade(wood, 0.8));
    // awning: striped slats sloping to the front
    const n = 6;
    for (let i = 0; i < n; i++) {
      const sx = -w / 2 - 0.1 + ((i + 0.5) / n) * (w + 0.2);
      b.box('cloth', sx, 2.35, 0.2, (w + 0.2) / n + 0.005, 0.04, 1.6, i % 2 ? stripes[0] : stripes[1], { rx: 0.32 });
      b.box('cloth', sx, 2.02, 1.0, (w + 0.2) / n + 0.005, 0.3, 0.03, i % 2 ? stripes[0] : stripes[1]);
    }
    // goods
    for (let i = 0; i < 7; i++) {
      const gx = -w / 2 + 0.3 + (i / 6) * (w - 0.6), gz = 0.25 + (i % 2) * 0.22;
      switch (goodsKind) {
        case 'fruit': for (let k = 0; k < 3; k++) b.sphere('solid', gx + (k - 1) * 0.1, 1.1 + (k === 1 ? 0.07 : 0), gz, 0.07, 0.07, 0.07, ['#d8382a', '#f0a024', '#8cc43c', '#f4d23c'][(i + k) % 4], { w: 6, h: 5 }); break;
        case 'bread': b.sphere('solid', gx, 1.1, gz, 0.16, 0.08, 0.1, ['#c98a42', '#b8763a', '#d9a05a'][i % 3], { w: 8, h: 5, rot: r() }); break;
        case 'fish': b.sphere('solid', gx, 1.07, gz, 0.2, 0.05, 0.07, ['#9fb8c8', '#c8a888', '#88a8c0'][i % 3], { w: 8, h: 4, rot: r() * 0.4 }); break;
        case 'cloth': b.box('cloth', gx, 1.08, gz, 0.28, 0.1, 0.34, ['#b43a4a', '#3a6ab4', '#e0b040', '#4a9a5a'][i % 4]); break;
        case 'pots': b.cyl('solid', gx, 1.03, gz, 0.1, 0.2, ['#b8683a', '#9a5a3a', '#d0a060'][i % 3], { sides: 8, top: 0.7 }); break;
        case 'gems': b.shape('shine', T.octa(), gx, 1.12, gz, 0.06, 0.1, 0.06, ['#7fe8ff', '#c58bff', '#ff8ad0'][i % 3]); break;
        case 'herbs': b.sphere('leaf', gx, 1.09, gz, 0.12, 0.09, 0.12, ['#5a9a3a', '#7ab84a', '#9a6ac0'][i % 3], { w: 6, h: 4, flat: true }); break;
      }
    }
  });
  const c = Math.cos(rot), s = Math.sin(rot);
  ctx.collide(x + 0.1 * s, z + 0.1 * c, 0.9);
  if (w > 2) { ctx.collide(x + (w / 3) * c, z - (w / 3) * s, 0.6); ctx.collide(x - (w / 3) * c, z + (w / 3) * s, 0.6); }
}

// ── nature ──────────────────────────────────────────────────────────────────────────────────
export type TreeStyle = 'round' | 'blossom' | 'pine' | 'palm' | 'birch' | 'willow' | 'dead' | 'autumn';

export function tree(ctx: TownCtx, x: number, z: number, style: TreeStyle, size = 1, o: { leaf?: Col; bark?: Col; collider?: boolean } = {}) {
  const b = ctx.b;
  const r = ctx.rnd;
  const y = ctx.y(x, z) - 0.1;
  b.push().translate(x, y, z).rotY(r() * Math.PI * 2).scale(size);
  const bark = o.bark ?? (style === 'birch' ? '#e8e2d6' : style === 'palm' ? '#9a7a54' : '#5e4330');
  switch (style) {
    case 'round':
    case 'blossom':
    case 'autumn': {
      const leaf = o.leaf ?? (style === 'blossom' ? '#f2a6c0' : style === 'autumn' ? '#d9822e' : '#4f9a3c');
      b.cyl('solid', 0, 0, 0, 0.3, 3.0, bark, { sides: 7, top: 0.62, flat: true });
      b.beam('solid', [0, 2.2, 0], [0.9, 3.4, 0.2], 0.16, bark);
      b.beam('solid', [0, 2.4, 0], [-0.8, 3.5, -0.3], 0.15, bark);
      const blobs: [number, number, number, number][] = [[0, 4.1, 0, 1.75], [1.1, 3.6, 0.3, 1.2], [-1.0, 3.7, -0.35, 1.25], [0.2, 3.4, 1.0, 1.1], [-0.2, 4.9, 0.1, 1.15], [0.3, 3.5, -1.0, 1.05]];
      for (const [bx, by, bz, br] of blobs) b.shape('leaf', T.ico(1), bx, by, bz, br, br * 0.88, br, shade(leaf, 0.86 + r() * 0.24), { ry: r() * 3 });
      if (style === 'blossom') for (let i = 0; i < 10; i++) b.shape('leaf', T.ico(0), (r() - 0.5) * 3, 3.4 + r() * 1.8, (r() - 0.5) * 3, 0.22, 0.2, 0.22, '#fff2f6');
      ctx.far.push().translate(x, y, z).scale(size);
      ctx.far.shape('leaf', T.ico(0), 0, 4.0, 0, 2.2, 1.9, 2.2, leaf);
      ctx.far.pop();
      break;
    }
    case 'pine': {
      const leaf = o.leaf ?? '#2f6a48';
      b.cyl('solid', 0, 0, 0, 0.22, 1.6, bark, { sides: 6, top: 0.7 });
      for (let i = 0; i < 4; i++) b.cone('leaf', 0, 1.2 + i * 1.05, 0, 1.7 - i * 0.34, 1.8, shade(leaf, 0.9 + i * 0.05), { sides: 8, ry: i * 0.4 });
      ctx.far.push().translate(x, y, z).scale(size);
      ctx.far.cone('leaf', 0, 1, 0, 1.7, 5, leaf, { sides: 6 });
      ctx.far.pop();
      break;
    }
    case 'palm': {
      const leaf = o.leaf ?? '#5a9a3a';
      const lean = 0.25 + r() * 0.2;
      const pts: [number, number, number][] = [[0, 0, 0], [lean * 0.6, 2, 0], [lean * 1.6, 4, 0], [lean * 2.8, 5.8, 0]];
      b.tubeAlong('solid', pts, 0.22, bark, { sides: 7, taper: 0.6, segs: 10 });
      const top = pts[3];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + r() * 0.3;
        const tip: [number, number, number] = [top[0] + Math.cos(a) * 2.6, top[1] - 1.0 - r() * 0.5, top[2] + Math.sin(a) * 2.6];
        const mid: [number, number, number] = [top[0] + Math.cos(a) * 1.4, top[1] + 0.35, top[2] + Math.sin(a) * 1.4];
        b.tubeAlong('leaf', [top, mid, tip], 0.28, shade(leaf, 0.85 + r() * 0.25), { sides: 3, taper: 0.1, segs: 6 });
      }
      for (let i = 0; i < 3; i++) b.sphere('solid', top[0] + Math.cos(i * 2) * 0.25, top[1] - 0.25, top[2] + Math.sin(i * 2) * 0.25, 0.16, 0.16, 0.16, '#6b4a2a', { w: 6, h: 5 });
      ctx.far.push().translate(x, y, z).scale(size);
      ctx.far.sphere('leaf', lean * 2.8, 5.6, 0, 2.2, 0.8, 2.2, leaf, { w: 6, h: 3, flat: true });
      ctx.far.pop();
      break;
    }
    case 'birch': {
      const leaf = o.leaf ?? '#8cbf4a';
      b.cyl('solid', 0, 0, 0, 0.16, 4.6, bark, { sides: 6, top: 0.6 });
      for (let i = 0; i < 5; i++) b.box('solid', 0, 0.6 + i * 0.8, 0.13, 0.18, 0.06, 0.05, '#3a3632', { ry: i });
      for (const [bx, by, bz, br] of [[0, 4.4, 0, 1.1], [0.5, 3.6, 0.3, 0.85], [-0.5, 3.8, -0.2, 0.9], [0.1, 5.1, 0, 0.8]] as [number, number, number, number][]) b.shape('leaf', T.ico(1), bx, by, bz, br * 0.9, br * 1.2, br * 0.9, shade(leaf, 0.88 + r() * 0.2));
      break;
    }
    case 'willow': {
      const leaf = o.leaf ?? '#7aa84a';
      b.cyl('solid', 0, 0, 0, 0.4, 2.8, bark, { sides: 7, top: 0.7, flat: true });
      b.shape('leaf', T.ico(1), 0, 3.6, 0, 2.3, 1.2, 2.3, leaf);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        b.box('leaf', Math.cos(a) * 1.9, 2.4, Math.sin(a) * 1.9, 0.5, 2.2, 0.18, shade(leaf, 0.9 + r() * 0.2), { ry: -a });
      }
      break;
    }
    case 'dead': {
      b.cyl('solid', 0, 0, 0, 0.26, 3.4, '#3a302c', { sides: 6, top: 0.4, flat: true });
      b.beam('solid', [0, 2.0, 0], [1.1, 3.0, 0.3], 0.1, '#3a302c');
      b.beam('solid', [0, 2.5, 0], [-0.8, 3.4, -0.2], 0.08, '#3a302c');
      break;
    }
  }
  b.pop();
  if (o.collider !== false) ctx.collide(x, z, 0.45 * size);
}

/** Loose flower clump on the ground. */
export function flowers(ctx: TownCtx, x: number, z: number, r: number, colors: Col[], n = 10) {
  const b = ctx.b;
  const rr = ctx.rnd;
  for (let i = 0; i < n; i++) {
    const a = rr() * Math.PI * 2, d = Math.sqrt(rr()) * r;
    const fx = x + Math.cos(a) * d, fz = z + Math.sin(a) * d;
    const y = ctx.y(fx, fz);
    b.sphere('leaf', fx, y + 0.12, fz, 0.18, 0.14, 0.18, '#4a8a36', { w: 6, h: 4, flat: true });
    b.shape('leaf', T.ico(0), fx + 0.04, y + 0.28, fz, 0.08, 0.07, 0.08, colors[i % colors.length]);
  }
}

/** Raised timber planter with flowers or vegetables. */
export function planter(ctx: TownCtx, x: number, z: number, rot: number, w: number, d: number, o: { wood?: Col; colors?: Col[]; veg?: boolean; stone?: Col } = {}) {
  const b = ctx.b;
  const r = ctx.rnd;
  ctx.on(x, z, rot, () => {
    const wall = o.stone ?? o.wood ?? '#6b4a30';
    b.block('solid', 0, -0.1, 0, w, 0.5, d, wall, { shade: [0.7, 1] });
    b.block('solid', 0, 0.36, 0, w - 0.16, 0.06, d - 0.16, '#4a3626');
    const nx = Math.max(2, Math.round(w / 0.45)), nz = Math.max(1, Math.round(d / 0.45));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const px = -w / 2 + 0.3 + (i / Math.max(1, nx - 1)) * (w - 0.6), pz = nz === 1 ? 0 : -d / 2 + 0.3 + (j / (nz - 1)) * (d - 0.6);
      if (o.veg) {
        b.sphere('leaf', px, 0.5, pz, 0.2, 0.16, 0.2, shade('#4f9a3a', 0.85 + r() * 0.3), { w: 6, h: 4, flat: true });
        if ((i + j) % 3 === 0) b.sphere('solid', px + 0.05, 0.56, pz, 0.08, 0.08, 0.08, ['#e0602a', '#d83a3a', '#f0c030'][(i + j) % 3], { w: 6, h: 4 });
      } else {
        b.sphere('leaf', px, 0.52, pz, 0.24, 0.2, 0.24, shade('#4a8a36', 0.9 + r() * 0.2), { w: 6, h: 4, flat: true });
        b.shape('leaf', T.ico(0), px, 0.72, pz, 0.1, 0.08, 0.1, (o.colors ?? ['#e2476a', '#ffd24a', '#f08aa8', '#b58aff'])[(i + j * 3) % (o.colors?.length ?? 4)]);
      }
    }
  });
  ctx.collideRect(x, z, w, d, rot, 0.05);
}

/** Pole with a hanging banner (cloth) — sways gently via the animated list. */
export function banner(ctx: TownCtx, x: number, z: number, rot: number, color: Col, o: { h?: number; trim?: Col; pole?: Col; emblem?: Col } = {}) {
  const h = o.h ?? 4.2;
  ctx.on(x, z, rot, () => {
    ctx.b.cyl('solid', 0, 0, 0, 0.07, h, o.pole ?? '#4a3626', { sides: 6 });
    ctx.b.sphere('metal', 0, h + 0.05, 0, 0.1, 0.1, 0.1, '#c9a24a', { w: 6, h: 5 });
    ctx.b.box('solid', 0.5, h - 0.25, 0, 1.15, 0.06, 0.06, o.pole ?? '#4a3626');
  });
  // the cloth itself is a separate little mesh so it can sway
  const g = new THREE.Group();
  const [wx, wz] = ctx.w(x, z);
  g.position.set(wx, ctx.y(x, z) + ctx.base + h - 0.28, wz);
  g.rotation.y = ctx.yaw(rot);
  const clothGeo = new THREE.PlaneGeometry(0.95, 1.9, 2, 6).translate(0.55, -0.95, 0);
  const pos = clothGeo.getAttribute('position') as THREE.BufferAttribute;
  // swallow-tail cut at the bottom
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < -1.85 && Math.abs(pos.getX(i) - 0.55) < 0.1) pos.setY(i, -1.55);
  const cloth = new THREE.Mesh(clothGeo, clothMat(color));
  cloth.castShadow = true;
  g.add(cloth);
  if (o.emblem) {
    const em = new THREE.Mesh(new THREE.CircleGeometry(0.2, 12).translate(0.55, -0.75, 0.01), clothMat(o.emblem));
    g.add(em);
  }
  ctx.extras.add(g);
  const phase = ctx.rnd() * 6;
  ctx.animated.push({ obj: g, tick: (o2, t) => { o2.children.forEach((c) => { c.rotation.y = Math.sin(t * 1.3 + phase) * 0.18; }); } });
  ctx.collide(x, z, 0.2);
}

const clothMats = new Map<string, THREE.Material>();
export function clothMat(color: Col) {
  const k = typeof color === 'string' ? color : `#${color.getHexString()}`;
  let m = clothMats.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: typeof color === 'string' ? C(color) : color, roughness: 0.95, side: THREE.DoubleSide }); clothMats.set(k, m); }
  return m;
}

/** Stack of firewood logs. */
export function woodpile(ctx: TownCtx, x: number, z: number, rot: number) {
  ctx.on(x, z, rot, () => {
    for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - row; i++) {
      ctx.b.cyl('solid', -0.45 + i * 0.3 + row * 0.15, 0.13 + row * 0.24, 0, 0.13, 1.2, '#7a5a3a', { sides: 7, rx: Math.PI / 2 });
      ctx.b.shape('solid', T.disc(7), -0.45 + i * 0.3 + row * 0.15, 0.13 + row * 0.24 + 0.13, 0.605, 0.12, 1, 0.12, '#d8b080', { rx: Math.PI / 2 });
    }
  });
  ctx.collide(x, z, 0.7);
}

/** Hay bale. */
export function hay(ctx: TownCtx, x: number, z: number, rot: number) {
  ctx.on(x, z, rot, () => {
    ctx.b.block('solid', 0, 0, 0, 1.1, 0.6, 0.6, '#d8b85a', { shade: [0.8, 1.05] });
    for (const s of [-0.3, 0.3]) ctx.b.box('solid', s, 0.3, 0, 0.04, 0.62, 0.62, '#a8883a');
  });
  ctx.collide(x, z, 0.6);
}
