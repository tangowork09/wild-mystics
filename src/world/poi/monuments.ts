// Animated civic monuments (v3:towns): the Wishing Spire, the Elementum Shrine rotunda, gate
// arches with name boards. Moving parts are small separate meshes registered in ctx.animated.

import * as THREE from 'three';
import { type Col, C, shade, T } from './kit';
import { type TownCtx } from './town';
import { signBoard } from './parts';
import { windowAt, type Palette } from './arch';
import { toTown } from './houses';

const spireMats: Record<string, THREE.Material> = {};
function sm(key: string, make: () => THREE.Material) { return (spireMats[key] ??= make()); }

/** The Wishing Spire (gacha summon): stepped plinth, slender column, orbiting rings, floating crystal. */
export function wishingSpire(ctx: TownCtx, x: number, z: number, rot: number) {
  const b = ctx.b;
  const y = ctx.y(x, z);
  b.push().translate(x, y, z).rotY(rot);
  // three-step octagonal plinth
  for (let i = 0; i < 3; i++) b.cyl('solid', 0, -0.2 + i * 0.28, 0, 3.0 - i * 0.7, 0.3 + (i === 0 ? 0.2 : 0), shade('#cfc6b6', 1 - i * 0.04), { sides: 8, flat: true });
  // column with gilded bands
  b.cyl('solid', 0, 0.64, 0, 0.55, 4.6, '#ece6f4', { sides: 8, top: 0.62, flat: true });
  for (const yy of [0.64, 2.2, 3.7]) b.cyl('metal', 0, yy, 0, 0.6 - yy * 0.035, 0.14, '#d9b25f', { sides: 8 });
  b.cyl('metal', 0, 5.2, 0, 0.55, 0.18, '#d9b25f', { sides: 8, top: 1.4 });
  // four gilded fins cradling the crystal
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.beam('metal', [Math.cos(a) * 0.5, 5.3, Math.sin(a) * 0.5], [Math.cos(a) * 0.95, 6.3, Math.sin(a) * 0.95], 0.08, '#d9b25f');
  }
  b.pop();
  // floating crystal + rings (animated)
  const [wx, wz] = ctx.w(x, z);
  const g = new THREE.Group();
  g.position.set(wx, y + ctx.base + 7.0, wz);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.85, 0).scale(0.75, 1.75, 0.75), sm('crystal', () => new THREE.MeshPhysicalMaterial({ color: '#9a86ff', emissive: '#6a4aff', emissiveIntensity: 1.5, roughness: 0.08, clearcoat: 1, flatShading: true })));
  g.add(crystal);
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25 + i * 0.32, 0.035, 6, 56), sm('ring', () => new THREE.MeshStandardMaterial({ color: '#ffe8a8', emissive: '#ffd76a', emissiveIntensity: 1.4 })));
    ring.rotation.x = Math.PI / 2 + i * 0.55;
    ring.userData.speed = 0.35 + i * 0.18;
    g.add(ring);
  }
  ctx.extras.add(g);
  ctx.animated.push({ obj: g, tick: (o, t) => {
    const c = o.children[0];
    c.rotation.y = t * 0.6;
    c.position.y = Math.sin(t * 1.2) * 0.22;
    for (let i = 1; i < o.children.length; i++) o.children[i].rotation.z = t * (o.children[i].userData.speed as number);
  } });
  ctx.collide(x, z, 2.4);
  ctx.keepClear(x, z, 4);
  ctx.far.cyl('solid', x, y, z, 0.6, 5.5, '#ece6f4', { sides: 6 });
  ctx.far.shape('shine', T.octa(), x, y + 7, z, 0.6, 1.3, 0.6, '#9a86ff');
  ctx.lamp(x, y + 6.5, z);
}

/** Elementum Shrine: stepped round platform, a ring of columns and a dome over a hovering crystal. */
export function rotunda(ctx: TownCtx, x: number, z: number, rot: number, o: { stone?: Col; dome?: Col; crystal?: Col; r?: number } = {}) {
  const b = ctx.b;
  const stone = o.stone ?? '#d9d0c0';
  const R = o.r ?? 3.6;
  const { floor, low } = ctx.floor(x, z, R * 2 + 2, R * 2 + 2, 0);
  b.push().translate(x, floor, z).rotY(rot);
  b.cyl('solid', 0, low - floor, 0, R + 1.1, -(low - floor) + 0.02, shade(stone, 0.8), { sides: 20 });
  for (let i = 0; i < 3; i++) b.cyl('solid', 0, -0.36 + i * 0.18, 0, R + 1.0 - i * 0.45, 0.2, shade(stone, 0.92 + i * 0.04), { sides: 20 });
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    const cx = Math.cos(a) * (R - 0.3), cz = Math.sin(a) * (R - 0.3);
    b.cyl('solid', cx, 0.18, cz, 0.3, 0.25, shade(stone, 0.95), { sides: 8 });
    b.cyl('solid', cx, 0.4, cz, 0.22, 3.3, stone, { sides: 10, top: 0.88 });
    b.box('solid', cx, 3.8, cz, 0.6, 0.2, 0.6, shade(stone, 1.02), { ry: -a });
  }
  b.cyl('solid', 0, 3.9, 0, R + 0.1, 0.45, shade(stone, 0.97), { sides: 20 });
  b.cyl('metal', 0, 4.32, 0, R + 0.2, 0.1, '#c9a24a', { sides: 20 });
  b.dome('solid', 0, 4.35, 0, R - 0.1, R * 0.82, o.dome ?? '#7a5aa8', { w: 20, h: 7 });
  b.cyl('metal', 0, 4.3 + R * 0.82, 0, 0.1, 0.8, '#c9a24a', { sides: 6 });
  b.sphere('shine', 0, 5.25 + R * 0.82, 0, 0.18, 0.18, 0.18, o.crystal ?? '#c68bff', { w: 8, h: 6 });
  // altar
  b.cyl('solid', 0, 0, 0, 0.7, 0.9, shade(stone, 0.9), { sides: 8, top: 0.8, flat: true });
  b.cyl('shine', 0, 0.9, 0, 0.55, 0.06, o.crystal ?? '#c68bff', { sides: 8 });
  b.pop();
  const [wx, wz] = ctx.w(x, z);
  const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0).scale(1, 1.9, 1), sm(`shrine${o.crystal ?? ''}`, () => new THREE.MeshPhysicalMaterial({ color: C(o.crystal ?? '#c68bff'), emissive: C(o.crystal ?? '#9a4aff'), emissiveIntensity: 1.3, roughness: 0.1, clearcoat: 1, flatShading: true })));
  cr.position.set(wx, floor + ctx.base + 2.2, wz);
  ctx.extras.add(cr);
  ctx.animated.push({ obj: cr, tick: (m, t) => { m.rotation.y = t * 0.8; m.position.y = floor + ctx.base + 2.2 + Math.sin(t * 1.5) * 0.18; } });
  // columns block, the altar blocks; the gaps between columns stay walkable
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + Math.PI / n; const [px, pz] = toTown(x, z, rot, Math.cos(a) * (R - 0.3), Math.sin(a) * (R - 0.3)); ctx.collide(px, pz, 0.35); }
  ctx.collide(x, z, 0.8);
  ctx.keepClear(x, z, R + 1.5);
  ctx.silhouette(x, z, 0, R * 1.8, R * 1.8, floor, 4.3, stone, o.dome ?? '#7a5aa8', 'dome', R * 0.8, 0);
  ctx.lamp(x, floor + 2.2, z);
}

export type ArchStyle = 'timber' | 'stone' | 'wood' | 'fortress' | 'adobe' | 'root' | 'basalt' | 'mine' | 'camp';

/**
 * Gate arch spanning `width` across a road at (x,z), with the road running along the arch's local Z.
 * Hangs a name board under the lintel (both faces).
 */
export function gateArch(ctx: TownCtx, x: number, z: number, rot: number, width: number, style: ArchStyle, pal: { stone?: Col; wood?: Col; roof?: Col; accent?: Col }, label?: { text: string; sub?: string; bg?: string; accent?: string }) {
  const b = ctx.b;
  const stone = pal.stone ?? '#a39a8c', wood = pal.wood ?? '#5a3f2a', roof = pal.roof ?? '#8e4a36';
  const y = Math.max(ctx.y(x, z), ctx.y(x + Math.cos(rot) * width / 2, z - Math.sin(rot) * width / 2), ctx.y(x - Math.cos(rot) * width / 2, z + Math.sin(rot) * width / 2));
  const hw = width / 2;
  let beamY = 3.6;
  b.push().translate(x, y, z).rotY(rot);
  switch (style) {
    case 'timber': {
      for (const s of [-1, 1]) {
        b.box('solid', s * (hw + 0.55), 0.3, 0, 1.3, 1.0, 1.3, shade(stone, 0.9), { shade: [0.7, 1] });
        b.box('solid', s * (hw + 0.55), 1.9, 0, 1.05, 2.4, 1.05, stone, { shade: [0.85, 1.05] });
        b.box('solid', s * (hw + 0.55), 3.15, 0, 1.2, 0.18, 1.2, shade(stone, 1.1));
        b.box('solid', s * (hw + 0.2), 3.55, 0, 0.26, 0.8, 0.26, wood);
      }
      b.box('solid', 0, 3.95, 0, width + 2.6, 0.32, 0.4, wood);
      for (const s of [-1, 1]) b.beam('solid', [s * (hw - 0.4), 3.8, 0], [s * (hw - 1.4), 3.25, 0], 0.16, wood);
      // little shingled roof
      for (const s of [-1, 1]) b.box('solid', 0, 4.55, s * 0.45, width + 3.1, 0.12, 1.25, shade(roof, 0.95 + s * 0.05), { rx: s * 0.62 });
      b.box('solid', 0, 4.93, 0, width + 3.2, 0.16, 0.2, shade(roof, 0.7));
      for (const s of [-1, 1]) b.prism('solid', s * (hw + 1.2), 4.1, 0, 1.5, 0.75, 0.1, shade(stone, 1.05), { ry: Math.PI / 2 });
      beamY = 3.8;
      break;
    }
    case 'stone':
    case 'fortress':
    case 'basalt': {
      const st = style === 'basalt' ? '#3f3b3d' : stone;
      const pierW = style === 'fortress' ? 2.2 : 1.2;
      for (const s of [-1, 1]) b.box('solid', s * (hw + pierW / 2), style === 'fortress' ? 3.0 : 2.1, 0, pierW, style === 'fortress' ? 6 : 4.2, style === 'fortress' ? 3.0 : 1.2, st, { shade: [0.7, 1.04] });
      const shape = new THREE.Shape();
      const top = style === 'fortress' ? 6 : 4.4, spring = style === 'fortress' ? 3.6 : 2.9;
      shape.moveTo(-hw - 0.05, spring - 0.3); shape.lineTo(-hw - 0.05, top); shape.lineTo(hw + 0.05, top); shape.lineTo(hw + 0.05, spring - 0.3);
      shape.absarc(0, spring - 0.3, hw + 0.05, 0, Math.PI, false);
      b.extrude('solid', shape, style === 'fortress' ? 3.0 : 1.2, shade(st, 1.02), { curveSegs: 12 });
      b.box('solid', 0, top + 0.1, 0, width + pierW * 2 + 0.3, 0.2, (style === 'fortress' ? 3.0 : 1.2) + 0.2, shade(st, 1.1));
      if (style === 'fortress') for (let i = 0; i < 5; i++) b.box('solid', -hw - 1.6 + i * ((width + 3.2) / 4), top + 0.6, 0, 0.9, 0.8, 3.1, shade(st, 1.05));
      beamY = spring - 0.2;
      break;
    }
    case 'wood':
    case 'mine':
    case 'camp': {
      const wc = style === 'mine' ? '#6a4a30' : wood;
      for (const s of [-1, 1]) {
        b.cyl('solid', s * (hw + 0.2), -0.3, 0, 0.2, 4.3, wc, { sides: 7 });
        b.beam('solid', [s * (hw + 0.2), 3.0, 0], [s * (hw - 0.6), 3.8, 0], 0.13, wc);
      }
      b.box('solid', 0, 3.9, 0, width + 1.4, 0.3, 0.32, wc);
      if (style === 'camp') for (const s of [-1, 1]) b.cone('glow', s * (hw + 0.2), 4.0, 0, 0.12, 0.35, '#ffb04a', { sides: 6 });
      beamY = 3.75;
      break;
    }
    case 'adobe': {
      for (const s of [-1, 1]) b.box('solid', s * (hw + 0.8), 2.2, 0, 1.6, 4.4, 1.4, stone, { shade: [0.8, 1.02] });
      const shape = new THREE.Shape();
      shape.moveTo(-hw, 2.8); shape.lineTo(-hw, 5.0); shape.lineTo(hw, 5.0); shape.lineTo(hw, 2.8);
      shape.absarc(0, 2.8, hw, 0, Math.PI, false);
      b.extrude('solid', shape, 1.4, stone, { curveSegs: 12 });
      b.box('solid', 0, 5.15, 0, width + 3.4, 0.3, 1.6, shade(stone, 1.06));
      for (let i = 0; i < 3; i++) b.box('solid', -hw + i * hw, 5.55, 0, 0.7, 0.5, 1.3, shade(stone, 1.03));
      b.dome('solid', 0, 5.3, 0, 0.8, 0.8, pal.accent ?? '#3aa0a8', { w: 12, h: 5 });
      beamY = 2.6;
      break;
    }
    case 'root': {
      const bark = wood;
      for (const s of [-1, 1]) {
        b.tubeAlong('solid', [[s * (hw + 1.2), -0.3, 0.6], [s * (hw + 0.6), 1.8, 0.2], [s * (hw * 0.4), 4.2, 0], [0, 4.9, 0]], 0.55, shade(bark, 0.95), { sides: 8, taper: 0.45, segs: 12 });
        b.tubeAlong('solid', [[s * (hw + 1.8), -0.3, -0.8], [s * (hw + 0.9), 1.6, -0.4], [s * hw * 0.6, 3.8, -0.3], [s * 0.3, 4.7, 0]], 0.36, shade(bark, 0.85), { sides: 7, taper: 0.4, segs: 10 });
      }
      for (let i = 0; i < 6; i++) b.sphere('leaf', (i - 2.5) * (width / 5), 4.6 + Math.sin(i) * 0.3, 0, 0.7, 0.45, 0.7, shade('#3f6a3a', 0.9 + (i % 3) * 0.08), { w: 7, h: 4, flat: true });
      beamY = 3.9;
      break;
    }
  }
  b.pop();
  if (label) {
    const bw = Math.min(width - 0.4, Math.max(2.2, label.text.length * 0.3));
    // hang the board from the beam on two short chains
    ctx.b.push().translate(x, y, z).rotY(rot);
    for (const s of [-1, 1]) ctx.b.box('metal', s * (bw / 2 - 0.2), beamY - 0.18, 0, 0.03, 0.36, 0.03, '#2b2826');
    ctx.b.pop();
    signBoard(ctx, x, y + beamY - 0.62, z, rot, bw, 0.62, label.text, { sub: label.sub, bg: label.bg, accent: label.accent });
  }
  const c = Math.cos(rot), s = Math.sin(rot);
  const pierR = style === 'fortress' ? 1.6 : 0.85;
  const off = hw + (style === 'fortress' ? 1.1 : 0.6);
  ctx.collide(x + off * c, z - off * s, pierR);
  ctx.collide(x - off * c, z + off * s, pierR);
  ctx.keepClear(x, z, width);
  if (style === 'timber' || style === 'stone' || style === 'fortress' || style === 'basalt') {
    ctx.lamp(x + (hw + 0.55) * c, y + 3.0, z - (hw + 0.55) * s);
  }
  return { y, beamY };
}

/** Observatory tower with a copper dome and a telescope (Elder Maple's study). */
export function observatory(ctx: TownCtx, x: number, z: number, rot: number, pal: Palette) {
  const b = ctx.b;
  const r = 2.3, h = 8.5;
  const { floor, low } = ctx.floor(x, z, r * 2, r * 2, 0);
  b.push().translate(x, floor, z).rotY(rot);
  b.cyl('solid', 0, low - floor, 0, r + 0.2, -(low - floor) + 0.3, pal.base, { sides: 14, flat: true });
  b.cyl('solid', 0, 0.3, 0, r, h - 0.3, pal.base, { sides: 14, top: 0.93, flat: true, shade: [0.8, 1.02] });
  for (const yy of [3.0, 5.9]) b.cyl('solid', 0, yy, 0, r * (1 - yy * 0.008) + 0.08, 0.2, shade(pal.base, 1.15), { sides: 14 });
  for (let i = 0; i < 3; i++) {
    b.push().rotY(0.9 + i * 2.1);
    windowAt(b, 0, 2.0 + i * 2.2, r * 0.95, pal, { w: 0.5, h: 0.9, arch: true, cross: false, shutters: false });
    b.pop();
  }
  b.cyl('solid', 0, h, 0, r * 0.93 + 0.3, 0.25, shade(pal.base, 1.1), { sides: 14 });
  b.dome('metal', 0, h + 0.2, 0, r * 0.93 + 0.1, r * 0.9, '#5a9a86', { w: 16, h: 7 });
  // slot + telescope
  b.box('solid', 0, h + 1.0, r * 0.4, 0.5, 1.6, r * 1.2, '#2a3a40', { rx: -0.5 });
  b.cyl('metal', 0, h + 1.2, r * 0.9, 0.16, 2.2, '#c9a24a', { sides: 10, rx: 1.0 });
  b.pop();
  ctx.collide(x, z, r + 0.3);
  ctx.keepClear(x, z, r + 1.5);
  ctx.silhouette(x, z, 0, r * 1.8, r * 1.8, floor, h, pal.base, '#5a9a86', 'dome', r * 0.9, 2);
}

export { C };
