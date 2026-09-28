// Parametric buildings (v3:towns). One `house()` grammar covers every town's vernacular by
// switching wall treatment (plaster, half-timber, stone, planks, adobe, basalt…), roof kind,
// jetties, stilts, porches and shopfronts. Doors always face the building's +Z (the street).

import * as THREE from 'three';
import { type Col, C, shade, T, type Builder } from './kit';
import {
  type Palette, type RoofKind, type WinOpts, type DoorOpts, windowAt, doorAt, gableRoof, hipRoof, timberFrame, quoins, plankCourses, boards,
  chimney, plinth, wallLantern, flowerBox,
} from './arch';
import { type TownCtx, type P2 } from './town';
import { signBoard, bracketSign } from './parts';

export type WallKind = 'plaster' | 'timber' | 'stone' | 'planks' | 'boards' | 'adobe' | 'basalt' | 'brick' | 'log';

export interface HouseSpec {
  w: number; d: number;
  floors?: number;
  /** Ground floor height (upper floors use `fh`). */
  gh?: number; fh?: number;
  ground?: WallKind; upper?: WallKind;
  pal: Palette;
  roof?: RoofKind; rise?: number; overhang?: number;
  /** Ridge runs front-to-back, so the gable end faces the street. */
  gableFront?: boolean;
  jetty?: number;
  door?: (DoorOpts & { x?: number }) | false;
  win?: WinOpts;
  /** Windows on the side walls too (default true). */
  sideWindows?: boolean;
  chimney?: -1 | 1 | 0;
  stilts?: number;
  porch?: { depth: number; roof?: boolean; rail?: boolean; posts?: Col };
  sign?: { text: string; sub?: string; icon?: string; bg?: string; accent?: string; fg?: string };
  bracket?: { icon: string; bg: string };
  shopfront?: { awning: [Col, Col] };
  snow?: number;
  parapet?: boolean;
  /** Beam ends poking out under a flat roof (adobe vigas). */
  vigas?: boolean;
  /** Glowing forge/hearth mouth beside the door. */
  forge?: boolean;
  far?: boolean;
}

export interface HouseMeta {
  /** Town-local point in front of the door (where the player stands to interact). */
  door: P2;
  /** Town-local yaw that faces out of the door. */
  yaw: number;
  /** Floor height (local y). */
  floorY: number;
  /** Top of the walls (local y). */
  wallTop: number;
  /** Converts a building-local point to town-local. */
  to: (px: number, pz: number) => P2;
}

export function toTown(x: number, z: number, rot: number, px: number, pz: number): P2 {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [x + px * c + pz * s, z - px * s + pz * c];
}

/** Window slots along a wall of length `len`, skipping a door gap. */
function slots(len: number, spacing: number, avoid?: number, gap = 1.25): number[] {
  const n = Math.max(1, Math.floor((len - 0.6) / spacing));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (len / n) * (i + 0.5);
    if (avoid !== undefined && Math.abs(x - avoid) < gap) continue;
    out.push(x);
  }
  return out;
}

function wallBox(b: Builder, kind: WallKind, w: number, d: number, y0: number, h: number, pal: Palette, upper: boolean) {
  const wall = upper ? pal.wall2 ?? pal.wall : pal.wall;
  const col = kind === 'stone' ? pal.base : wall;
  b.box('solid', 0, y0 + h / 2, 0, w, h, d, col, { shade: upper ? [0.94, 1.02] : [0.78, 1.02] });
  switch (kind) {
    case 'timber':
      timberFrame(b, w, d, y0, y0 + h, pal.timber ?? '#4b3527', { braces: true });
      break;
    case 'stone':
      quoins(b, w + 0.04, d + 0.04, y0, y0 + h, shade(pal.base, 1.12));
      break;
    case 'brick':
      for (let y = y0 + 0.35; y < y0 + h; y += 0.35) b.box('solid', 0, y, 0, w + 0.02, 0.025, d + 0.02, shade(wall, 0.82));
      quoins(b, w + 0.04, d + 0.04, y0, y0 + h, shade(wall, 1.1));
      break;
    case 'planks':
      for (const [ry, len, off] of [[0, w, d / 2], [Math.PI, w, d / 2], [Math.PI / 2, d, w / 2], [-Math.PI / 2, d, w / 2]] as [number, number, number][]) {
        b.push().rotY(ry);
        plankCourses(b, len + 0.08, y0, y0 + h, off + 0.02, wall);
        b.pop();
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('solid', sx * (w / 2 + 0.02), y0 + h / 2, sz * (d / 2 + 0.02), 0.16, h, 0.16, pal.trim);
      break;
    case 'boards':
      for (const [ry, len, off] of [[0, w, d / 2], [Math.PI, w, d / 2], [Math.PI / 2, d, w / 2], [-Math.PI / 2, d, w / 2]] as [number, number, number][]) {
        b.push().rotY(ry);
        boards(b, len, y0, y0 + h, off + 0.03, wall);
        b.pop();
      }
      break;
    case 'log':
      for (let y = y0 + 0.16, i = 0; y < y0 + h; y += 0.3, i++) {
        for (const sz of [-1, 1]) b.shape('solid', T.cyl(7), 0, y, sz * (d / 2 - 0.02), 0.16, w + 0.5, 0.16, shade(wall, 0.9 + (i % 3) * 0.06), { rz: Math.PI / 2 });
        for (const sx of [-1, 1]) b.shape('solid', T.cyl(7), sx * (w / 2 - 0.02), y + 0.15, 0, 0.16, d + 0.5, 0.16, shade(wall, 0.86 + (i % 4) * 0.05), { rx: Math.PI / 2 });
      }
      break;
    case 'basalt':
      for (let y = y0 + 0.45; y < y0 + h - 0.1; y += 0.45) b.box('solid', 0, y, 0, w + 0.03, 0.04, d + 0.03, shade(wall, 0.7));
      quoins(b, w + 0.05, d + 0.05, y0, y0 + h, shade(pal.base, 1.0));
      break;
    case 'adobe':
      b.box('solid', 0, y0 + 0.2, 0, w + 0.08, 0.4, d + 0.08, shade(wall, 0.86));
      break;
    default:
      break;
  }
}

/** Build a house at town-local (x, z) facing `rot`. */
export function house(ctx: TownCtx, x: number, z: number, rot: number, s: HouseSpec): HouseMeta {
  const b = ctx.b;
  const pal = s.pal;
  const floors = s.floors ?? 2;
  const gh = s.gh ?? 3.0, fh = s.fh ?? 2.7;
  const jetty = s.jetty ?? 0;
  const stilts = s.stilts ?? 0;
  const porchD = s.porch?.depth ?? 0;
  const { floor, low } = ctx.floor(x, z, s.w + 0.6, s.d + 0.6 + porchD * 2, rot);
  const y0 = floor + stilts;
  const wallTop = gh + (floors - 1) * fh;
  const doorX = s.door === false ? 0 : s.door?.x ?? (s.w >= 6 ? -s.w * 0.18 : 0);
  const roof: RoofKind = s.roof ?? 'gable';

  b.push().translate(x, y0, z).rotY(rot);
  // ── foundation / stilts
  if (stilts > 0) {
    const post = pal.timber ?? shade(pal.wall, 0.6);
    for (const px of [-s.w / 2 + 0.2, 0, s.w / 2 - 0.2]) for (const pz of [-s.d / 2 + 0.2, s.d / 2 - 0.2 + porchD]) {
      b.cyl('solid', px, low - y0 - 0.4, pz, 0.16, -(low - y0 - 0.4) + 0.05, post, { sides: 7 });
    }
    b.box('solid', 0, -0.12, porchD / 2, s.w + 0.3, 0.24, s.d + 0.3 + porchD, shade(post, 0.9));
    // stair down from the porch/door
    const stairZ = s.d / 2 + porchD + 0.1;
    const n = Math.max(2, Math.ceil(stilts / 0.26));
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / n;
      b.box('solid', doorX, -stilts * t + 0.02, stairZ + t * (stilts * 1.05), 1.1, 0.08, 0.34, shade(post, 1.1));
    }
    for (const sx of [-0.58, 0.58]) b.beam('solid', [doorX + sx, 0, stairZ], [doorX + sx, -stilts, stairZ + stilts * 1.05 + 0.2], 0.08, post);
  } else {
    plinth(b, s.w, s.d, low - y0, pal.base);
  }

  // ── walls
  const ground = s.ground ?? 'plaster';
  const upper = s.upper ?? ground;
  wallBox(b, ground, s.w, s.d, 0, gh, pal, false);
  for (let f = 1; f < floors; f++) {
    const yy = gh + (f - 1) * fh;
    b.push().translate(0, 0, 0);
    if (jetty) {
      b.box('solid', 0, yy + 0.08, 0, s.w + 0.1, 0.16, s.d + jetty * 2, pal.timber ?? pal.trim);
      for (let i = 0; i < Math.round(s.w / 0.9); i++) b.box('solid', -s.w / 2 + 0.45 + i * 0.9, yy - 0.05, s.d / 2 + jetty / 2, 0.12, 0.12, jetty + 0.1, pal.timber ?? pal.trim);
    }
    wallBox(b, upper, s.w, s.d + jetty * 2, yy, fh, pal, true);
    b.pop();
  }

  // ── windows
  const win: WinOpts = { shutters: !!pal.shutter, ...s.win };
  const faces: [number, number, number, number][] = [[0, s.w, s.d / 2, 0], [Math.PI, s.w, s.d / 2, 1], [Math.PI / 2, s.d, s.w / 2, 2], [-Math.PI / 2, s.d, s.w / 2, 3]];
  for (const [ry, len, off, fi] of faces) {
    if (fi >= 2 && s.sideWindows === false) continue;
    if (fi === 1 && s.shopfront) continue;
    b.push().rotY(ry);
    for (let f = 0; f < floors; f++) {
      const isGround = f === 0;
      if (isGround && s.shopfront && fi === 0) continue;
      const yC = isGround ? gh * 0.52 : gh + (f - 1) * fh + fh * 0.5;
      const depth = off + (isGround ? 0 : jetty * (fi < 2 ? 1 : 0));
      const spacing = len < 4 ? len : 1.9;
      for (const wx of slots(len, spacing, isGround && fi === 0 ? doorX : undefined, 1.35)) {
        windowAt(b, wx, yC, depth, pal, { ...win, flowers: win.flowers && !isGround ? true : win.flowers && isGround && fi === 0 });
      }
    }
    b.pop();
  }

  // ── shopfront (big display windows + awning)
  if (s.shopfront) {
    const [a1, a2] = s.shopfront.awning;
    for (const side of [-1, 1]) {
      const cx = side > 0 ? (doorX + s.w / 2) / 2 + 0.2 : (doorX - s.w / 2) / 2 - 0.2;
      const ww = Math.max(0.9, (side > 0 ? s.w / 2 - doorX : doorX + s.w / 2) - 1.3);
      if (ww < 0.8) continue;
      b.box('solid', cx, 1.35, s.d / 2 + 0.05, ww + 0.2, 1.7, 0.1, pal.trim);
      b.quad('glow', cx, 1.4, s.d / 2 + 0.11, ww, 1.45, '#ffd29a');
      for (let k = 1; k < 3; k++) b.box('solid', cx - ww / 2 + (ww * k) / 3, 1.4, s.d / 2 + 0.13, 0.05, 1.45, 0.03, pal.trim);
      b.box('solid', cx, 0.42, s.d / 2 + 0.14, ww + 0.3, 0.12, 0.3, shade(pal.trim, 0.9));
    }
    // striped awning across the front
    const n = Math.max(6, Math.round(s.w / 0.55));
    for (let i = 0; i < n; i++) {
      const ax = -s.w / 2 + ((i + 0.5) / n) * s.w;
      b.box('cloth', ax, gh - 0.15, s.d / 2 + 0.75, s.w / n + 0.004, 0.04, 1.6, i % 2 ? a1 : a2, { rx: 0.42 });
      b.box('cloth', ax, gh - 0.62, s.d / 2 + 1.48, s.w / n + 0.004, 0.28, 0.03, i % 2 ? a1 : a2);
    }
    for (const sx of [-1, 1]) b.beam('metal', [sx * (s.w / 2 - 0.1), gh - 0.9, s.d / 2 + 0.05], [sx * (s.w / 2 - 0.1), gh - 0.5, s.d / 2 + 1.45], 0.04, '#2b2826');
  }

  // ── porch
  if (s.porch) {
    const pd = s.porch.depth;
    if (!stilts) b.box('solid', 0, -0.06, s.d / 2 + pd / 2, s.w + 0.2, 0.2, pd, shade(pal.base, 1.05));
    else b.box('solid', 0, -0.06, s.d / 2 + pd / 2, s.w + 0.2, 0.14, pd, shade(pal.timber ?? pal.trim, 1.15));
    if (s.porch.roof !== false) {
      const pc = s.porch.posts ?? pal.timber ?? pal.trim;
      for (const px of [-s.w / 2 + 0.2, s.w / 2 - 0.2, ...(s.w > 7 ? [doorX - 1.1, doorX + 1.1] : [])]) b.box('solid', px, gh / 2 + 0.02, s.d / 2 + pd - 0.15, 0.18, gh - 0.1, 0.18, pc);
      b.box('solid', 0, gh - 0.05, s.d / 2 + pd - 0.15, s.w + 0.1, 0.18, 0.2, pc);
      b.box('solid', 0, gh + 0.25, s.d / 2 + pd / 2, s.w + 0.4, 0.1, pd + 0.4, shade(pal.roof, 0.95), { rx: 0.22 });
    }
    if (s.porch.rail) {
      for (const sx of [-1, 1]) {
        const rx = sx * (s.w / 2 + 0.05);
        b.beam('solid', [rx, 0.9, s.d / 2 + 0.1], [rx, 0.9, s.d / 2 + pd - 0.1], 0.07, pal.trim);
        for (let t = 0.3; t < pd; t += 0.45) b.box('solid', rx, 0.45, s.d / 2 + t, 0.05, 0.9, 0.05, pal.trim);
      }
    }
  }

  // ── door
  let door: P2 = toTown(x, z, rot, doorX, s.d / 2 + porchD + 1.2 + (stilts ? stilts * 1.05 : 0));
  if (s.door !== false) {
    doorAt(b, doorX, s.d / 2, pal, { lamp: true, ...s.door });
    if (s.forge) {
      const fx = doorX + (doorX > 0 ? -2.0 : 2.0);
      b.box('solid', fx, 0.9, s.d / 2 + 0.06, 1.7, 1.8, 0.14, shade(pal.base, 0.6));
      b.quad('shine', fx, 0.75, s.d / 2 + 0.14, 1.3, 1.1, '#ff7a24');
      b.box('solid', fx, 1.65, s.d / 2 + 0.2, 1.9, 0.22, 0.34, shade(pal.base, 0.9));
    }
  } else door = toTown(x, z, rot, 0, s.d / 2 + 1.2);

  // ── roof
  const rise = s.rise ?? Math.min(s.w, s.d) * 0.45;
  const roofW = s.w, roofD = s.d + jetty * 2;
  let top = wallTop;
  switch (roof) {
    case 'gable':
      gableRoof(b, wallTop, roofW, roofD, rise, pal.roof, { overhang: s.overhang ?? 0.5, alongZ: s.gableFront, gableFill: upper === 'timber' ? pal.wall2 ?? pal.wall : upper === 'stone' ? pal.base : pal.wall2 ?? pal.wall, edge: pal.timber ?? pal.trim, jitter: ctx.rnd, snow: s.snow });
      top = wallTop + rise;
      if (upper === 'timber') {
        // timber detail in the gable ends
        const tc = pal.timber ?? '#4b3527';
        if (s.gableFront) {
          for (const sz of [-1, 1]) b.box('solid', 0, wallTop + rise * 0.45, sz * (roofD / 2 + 0.06), 0.14, rise * 0.9, 0.12, tc);
        } else for (const sx of [-1, 1]) b.box('solid', sx * (roofW / 2 + 0.06), wallTop + rise * 0.45, 0, 0.12, rise * 0.9, 0.14, tc);
      }
      break;
    case 'hip':
    case 'pyramid':
      top = hipRoof(b, wallTop, roofW, roofD, rise, pal.roof, { overhang: s.overhang ?? 0.45, snow: s.snow }).top;
      break;
    case 'flat': {
      b.box('solid', 0, wallTop + 0.1, 0, roofW + 0.2, 0.2, roofD + 0.2, shade(pal.roof, 0.9));
      if (s.parapet !== false) {
        for (const [px, pz, pw, pd] of [[0, roofD / 2, roofW + 0.2, 0.25], [0, -roofD / 2, roofW + 0.2, 0.25], [roofW / 2, 0, 0.25, roofD], [-roofW / 2, 0, 0.25, roofD]] as [number, number, number, number][]) b.box('solid', px, wallTop + 0.45, pz, pw, 0.6, pd, shade(pal.wall2 ?? pal.wall, 0.97));
      }
      top = wallTop + 0.75;
      break;
    }
    case 'dome': {
      const r = Math.min(roofW, roofD) * 0.42;
      b.cyl('solid', 0, wallTop, 0, r * 1.02, 0.5, shade(pal.wall2 ?? pal.wall, 0.95), { sides: 16 });
      b.dome('solid', 0, wallTop + 0.45, 0, r, r * 0.95, pal.roof, { w: 18, h: 7 });
      b.cyl('metal', 0, wallTop + 0.4 + r * 0.95, 0, 0.06, 0.6, '#c9a24a', { sides: 6 });
      b.sphere('metal', 0, wallTop + 0.95 + r * 0.95, 0, 0.12, 0.12, 0.12, '#c9a24a', { w: 8, h: 6 });
      if (s.parapet !== false) b.box('solid', 0, wallTop + 0.12, 0, roofW + 0.2, 0.24, roofD + 0.2, shade(pal.wall, 0.95));
      top = wallTop + r + 1.2;
      break;
    }
    case 'cone': {
      const r = Math.max(roofW, roofD) * 0.62;
      b.cone('solid', 0, wallTop, 0, r, rise, pal.roof, { sides: 10 });
      top = wallTop + rise;
      break;
    }
    case 'shed': {
      const ang = Math.atan2(rise, roofD);
      b.box('solid', 0, wallTop + rise / 2 + 0.1, 0, roofW + 0.6, 0.16, Math.hypot(roofD + 0.6, rise), pal.roof, { rx: -ang });
      for (const sx of [-1, 1]) b.add('solid', T.wedge(), new THREE.Matrix4().compose(new THREE.Vector3(sx * (roofW / 2 - 0.05), wallTop, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0)), new THREE.Vector3(0.1, rise, roofD)), pal.wall);
      top = wallTop + rise;
      break;
    }
    case 'onion': {
      const r = Math.min(roofW, roofD) * 0.4;
      b.lathe('solid', 0, wallTop, 0, [[r, 0], [r * 1.12, r * 0.4], [r * 0.95, r * 0.95], [r * 0.45, r * 1.45], [0.08, r * 1.9], [0, r * 2.0]], pal.roof, { sides: 14 });
      top = wallTop + r * 2;
      break;
    }
    default:
      break;
  }
  if (s.vigas) for (const sz of [-1, 1]) for (let i = 0; i < Math.round(s.w / 1.1); i++) b.cyl('solid', -s.w / 2 + 0.55 + i * 1.1, wallTop - 0.35, sz * (roofD / 2 + 0.2), 0.1, 0.5, '#6a4a30', { sides: 6, rx: Math.PI / 2 });
  if (s.chimney) chimney(b, s.chimney * (roofW / 2 - 0.7), -roofD * 0.18, wallTop - 0.5, top + 0.7, pal.base, s.forge);

  b.pop();

  // ── signage (a name board over the door; above the awning on shopfronts)
  const highSign = !!s.shopfront && floors > 1;
  if (s.sign) {
    const [sx, sz] = toTown(x, z, rot, highSign ? 0 : doorX, s.d / 2 + 0.16 + (highSign ? jetty : 0) + (s.porch ? porchD : 0));
    const sy = y0 + (highSign ? gh + 0.55 : s.porch ? gh + 0.62 : Math.min(wallTop - 0.25, 2.78));
    const sw = Math.min(highSign ? 3.4 : 2.6, Math.max(1.7, s.sign.text.length * 0.2));
    signBoard(ctx, sx, sy, sz, rot, sw, highSign ? 0.62 : 0.55, s.sign.text, { sub: s.sign.sub, icon: s.sign.icon, bg: s.sign.bg, accent: s.sign.accent, fg: s.sign.fg, back: false });
  }
  if (s.bracket) {
    const side = doorX > 0 ? -1 : 1;
    const bx0 = s.shopfront ? side * (s.w / 2 - 0.35) : doorX + side * 1.3;
    const [bx, bz] = toTown(x, z, rot, bx0, s.d / 2 + (s.shopfront && floors > 1 ? jetty : 0) + 0.05);
    bracketSign(ctx, bx, y0 + (s.shopfront ? gh + 1.15 : 2.8), bz, rot - Math.PI / 2, s.bracket.icon, s.bracket.bg);
  }

  // ── colliders + far LOD
  ctx.collideRect(x, z, s.w + 0.3, s.d + 0.3, rot);
  if (s.porch && stilts === 0) {
    // porch edge blocks walking into the posts but leaves the step free
    const [px1, pz1] = toTown(x, z, rot, -s.w / 2 + 0.2, s.d / 2 + porchD - 0.15);
    const [px2, pz2] = toTown(x, z, rot, s.w / 2 - 0.2, s.d / 2 + porchD - 0.15);
    ctx.collide(px1, pz1, 0.25); ctx.collide(px2, pz2, 0.25);
  }
  if (s.far !== false) {
    const kind = roof === 'gable' ? 'gable' : roof === 'flat' ? 'flat' : roof === 'dome' || roof === 'onion' ? 'dome' : roof === 'cone' ? 'cone' : 'hip';
    if (roof === 'gable' && s.gableFront) ctx.silhouette(x, z, rot + Math.PI / 2, roofD, roofW, y0, wallTop, pal.wall2 ?? pal.wall, pal.roof, kind, rise, 0);
    else ctx.silhouette(x, z, rot, roofW, roofD, y0, wallTop, pal.wall2 ?? pal.wall, pal.roof, kind, rise, Math.max(1, Math.round(s.w / 2.5)));
  }

  return { door, yaw: rot, floorY: y0, wallTop: y0 + wallTop, to: (px, pz) => toTown(x, z, rot, px, pz) };
}

/** Round tower (watchtower, observatory, lighthouse-ish, mill). */
export function roundTower(ctx: TownCtx, x: number, z: number, r: number, h: number, pal: Palette, o: { roof?: 'cone' | 'dome' | 'crenel' | 'none'; rise?: number; windows?: number; door?: boolean; rot?: number; snow?: boolean; bands?: Col } = {}) {
  const b = ctx.b;
  const rot = o.rot ?? 0;
  const { floor, low } = ctx.floor(x, z, r * 2, r * 2, 0);
  b.push().translate(x, floor, z).rotY(rot);
  b.cyl('solid', 0, low - floor, 0, r + 0.15, -(low - floor) + 0.3, pal.base, { sides: 16 });
  b.cyl('solid', 0, 0.3, 0, r, h - 0.3, pal.wall, { sides: 16, top: 0.94, shade: [0.8, 1.02] });
  if (o.bands) for (let yy = 1.2; yy < h - 0.5; yy += 2.4) b.cyl('solid', 0, yy, 0, r * (1 - (yy / h) * 0.06) + 0.04, 0.16, o.bands, { sides: 16 });
  const nw = o.windows ?? 3;
  for (let i = 0; i < nw; i++) {
    const a = (i / nw) * Math.PI * 2 + 0.5;
    const yy = 2.2 + i * ((h - 3.2) / Math.max(1, nw));
    b.push().rotY(a);
    windowAt(b, 0, yy, r * (1 - (yy / h) * 0.06) - 0.02, pal, { w: 0.55, h: 0.95, arch: true, cross: false, shutters: false });
    b.pop();
  }
  if (o.door !== false) doorAt(b, 0, r - 0.05, pal, { arch: true, w: 1.05, h: 2.15, lamp: true });
  const topR = r * 0.94;
  let top = h;
  switch (o.roof ?? 'cone') {
    case 'cone':
      b.cyl('solid', 0, h, 0, topR + 0.35, 0.22, shade(pal.roof, 0.7), { sides: 16 });
      b.cone('solid', 0, h + 0.1, 0, topR + 0.45, o.rise ?? r * 1.9, pal.roof, { sides: 16, flat: false });
      if (o.snow) b.cone('solid', 0, h + 0.1 + (o.rise ?? r * 1.9) * 0.45, 0, (topR + 0.45) * 0.56, (o.rise ?? r * 1.9) * 0.57, '#f2f6ff', { sides: 16 });
      b.cyl('metal', 0, h + (o.rise ?? r * 1.9), 0, 0.05, 0.9, '#2b2826', { sides: 6 });
      top = h + (o.rise ?? r * 1.9);
      break;
    case 'dome':
      b.dome('solid', 0, h, 0, topR + 0.15, topR * 0.9, pal.roof, { w: 18, h: 7 });
      top = h + topR;
      break;
    case 'crenel':
      b.cyl('solid', 0, h, 0, topR + 0.35, 0.3, shade(pal.wall, 0.95), { sides: 16 });
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; b.box('solid', Math.cos(a) * (topR + 0.18), h + 0.6, Math.sin(a) * (topR + 0.18), 0.6, 0.6, 0.45, shade(pal.wall, 1.02), { ry: -a }); }
      top = h + 0.9;
      break;
    default: break;
  }
  b.pop();
  ctx.collide(x, z, r + 0.2);
  ctx.keepClear(x, z, r + 1.5);
  ctx.silhouette(x, z, 0, r * 1.8, r * 1.8, floor, h, pal.wall, pal.roof, o.roof === 'dome' ? 'dome' : o.roof === 'crenel' ? 'flat' : 'cone', o.rise ?? r * 1.9, 1);
  return { top: floor + top, door: toTown(x, z, rot, 0, r + 1.2) as P2 };
}

/** Flower boxes / wall lanterns etc. exported for layouts that decorate by hand. */
export { flowerBox, wallLantern };
export const colorOf = (c: Col) => (typeof c === 'string' ? C(c) : c);
