import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LOOK, ensureSmooth, type Look } from './stylize';

// Procedural accessories, auras and sparkles for the v3 creature look (creatures workstream).
//
// Accessories are real meshes (toon-shaded, outlined) attached to a bone, so they follow the animation.
// Placement is automatic: an anchor ('headTop', 'back', 'tail', 'chest', 'root') is measured from the
// skinned mesh itself (vertices driven by that bone), then nudged by an optional offset in units of the
// creature's height. Regional forms, Guardians and Alphas are dressed from the same kit.

export type AccKind = 'crown' | 'leafcrown' | 'crystals' | 'flame' | 'horns' | 'shell' | 'coral' | 'bell' | 'halo' | 'shards' | 'antlers' | 'mushrooms' | 'fins' | 'mane' | 'gem';
export type Anchor = 'headTop' | 'head' | 'back' | 'tail' | 'chest' | 'root';

export interface AccSpec {
  k: AccKind;
  /** Where it sits (default per kind). */
  on?: Anchor;
  /** Offset from the anchor, in creature heights: [x right, y up, z forward]. */
  at?: [number, number, number];
  /** Size in creature heights (default per kind). */
  s?: number;
  /** Extra rotation (radians). */
  r?: [number, number, number];
  c?: string;
  c2?: string;
  /** Count (crystals, shards, mushrooms, bells). */
  n?: number;
}

const DEF: Record<AccKind, { on: Anchor; s: number }> = {
  crown: { on: 'headTop', s: 0.22 }, leafcrown: { on: 'headTop', s: 0.26 }, crystals: { on: 'back', s: 0.3 }, flame: { on: 'headTop', s: 0.3 },
  horns: { on: 'headTop', s: 0.3 }, shell: { on: 'back', s: 0.34 }, coral: { on: 'back', s: 0.3 }, bell: { on: 'chest', s: 0.14 },
  halo: { on: 'headTop', s: 0.34 }, shards: { on: 'root', s: 0.18 }, antlers: { on: 'headTop', s: 0.42 }, mushrooms: { on: 'back', s: 0.2 },
  fins: { on: 'back', s: 0.3 }, mane: { on: 'head', s: 0.34 }, gem: { on: 'headTop', s: 0.08 },
};

// ── geometry helpers ──────────────────────────────────────────────────────
function paint(g: THREE.BufferGeometry, c: THREE.ColorRepresentation, glow = 0): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const n = geo.getAttribute('position').count;
  const col = new THREE.Color(c);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  geo.userData.glow = glow;
  return geo;
}
/** Vertical colour gradient (bottom → top) in the geometry's own bounds. */
function gradient(g: THREE.BufferGeometry, a: THREE.ColorRepresentation, b: THREE.ColorRepresentation, glow = 0) {
  const geo = paint(g, a, glow);
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const pos = geo.getAttribute('position');
  const col = geo.getAttribute('color') as THREE.BufferAttribute;
  const ca = new THREE.Color(a), cb = new THREE.Color(b), t = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const k = (pos.getY(i) - bb.min.y) / Math.max(1e-5, bb.max.y - bb.min.y);
    t.copy(ca).lerp(cb, k);
    col.setXYZ(i, t.r, t.g, t.b);
  }
  return geo;
}
function place(g: THREE.BufferGeometry, p: [number, number, number], r: [number, number, number] = [0, 0, 0], s: number | [number, number, number] = 1) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s));
  g.applyMatrix4(m);
  return g;
}
/** Tapered tube along a curve (horns, coral, antlers, tails of shells). */
function taper(curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, segs = 12, radial = 7) {
  const pos: number[] = [];
  const idx: number[] = [];
  const frames = curve.computeFrenetFrames(segs, false);
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const p = curve.getPointAt(u);
    const r = THREE.MathUtils.lerp(r0, r1, u);
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(p.x + (Math.cos(a) * N.x + Math.sin(a) * B.x) * r, p.y + (Math.cos(a) * N.y + Math.sin(a) * B.y) * r, p.z + (Math.cos(a) * N.z + Math.sin(a) * B.z) * r);
    }
  }
  const tip = curve.getPointAt(1);
  pos.push(tip.x, tip.y, tip.z);
  const tipIdx = (segs + 1) * radial;
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = (i + 1) * radial + j, d = (i + 1) * radial + ((j + 1) % radial);
      idx.push(a, c, b, b, c, d);
    }
  }
  for (let j = 0; j < radial; j++) idx.push(segs * radial + j, tipIdx, segs * radial + ((j + 1) % radial));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function crystal(h: number, r: number) {
  const body = new THREE.CylinderGeometry(r, r * 0.92, h * 0.72, 6, 1);
  body.translate(0, h * 0.36, 0);
  const tip = new THREE.ConeGeometry(r, h * 0.28, 6, 1);
  tip.translate(0, h * 0.86, 0);
  return mergeGeometries([body.toNonIndexed(), tip.toNonIndexed()])!;
}
function leaf(len: number, wid: number) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(wid, len * 0.45, 0, len);
  s.quadraticCurveTo(-wid, len * 0.45, 0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: wid * 0.18, bevelEnabled: true, bevelSize: wid * 0.08, bevelThickness: wid * 0.08, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -wid * 0.09);
  return g;
}
const rnd = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

// ── builders: each returns geometry parts in accessory-local space (unit ≈ accessory size) ──
type Parts = THREE.BufferGeometry[];
const B: Record<AccKind, (o: AccSpec) => Parts> = {
  crown(o) {
    const gold = o.c ?? '#ffcf4a', gem = o.c2 ?? '#ff4a6a';
    const band = new THREE.LatheGeometry([new THREE.Vector2(0.88, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1.02, 0.42), new THREE.Vector2(0.9, 0.42)], 22);
    const parts: Parts = [gradient(band, '#b8741e', gold)];
    const n = o.n ?? 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      parts.push(gradient(place(new THREE.ConeGeometry(0.2, 0.62, 5), [Math.cos(a) * 0.95, 0.72, Math.sin(a) * 0.95], [Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18]), gold, '#fff2b0'));
      parts.push(paint(place(new THREE.OctahedronGeometry(0.13), [Math.cos(a) * 1.02, 0.22, Math.sin(a) * 1.02]), gem, 0.9));
      parts.push(paint(place(new THREE.SphereGeometry(0.08, 6, 4), [Math.cos(a) * 0.95, 1.05, Math.sin(a) * 0.95]), '#fff6d0', 0.6));
    }
    return parts;
  },
  leafcrown(o) {
    const green = o.c ?? '#5fbf4a', bloom = o.c2 ?? '#ffd6f0';
    const parts: Parts = [paint(new THREE.TorusGeometry(0.9, 0.09, 6, 20).rotateX(Math.PI / 2), '#6a4a2a')];
    const n = o.n ?? 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      parts.push(gradient(place(leaf(0.85, 0.34), [Math.cos(a) * 0.88, 0.05, Math.sin(a) * 0.88], [0, -a + Math.PI / 2, -0.55 - (i % 2) * 0.35]), '#2f7a2a', green));
      if (i % 3 === 0) {
        for (let p = 0; p < 5; p++) {
          const b = (p / 5) * Math.PI * 2;
          parts.push(paint(place(new THREE.SphereGeometry(0.11, 6, 4), [Math.cos(a) * 0.95 + Math.cos(b) * 0.12, 0.28, Math.sin(a) * 0.95 + Math.sin(b) * 0.12], [0, 0, 0], [1, 0.45, 1]), bloom));
        }
        parts.push(paint(place(new THREE.SphereGeometry(0.08, 6, 4), [Math.cos(a) * 0.95, 0.31, Math.sin(a) * 0.95]), '#ffd84a', 0.5));
      }
    }
    return parts;
  },
  crystals(o) {
    const c = o.c ?? '#8fe8ff', c2 = o.c2 ?? '#f0fcff';
    const r = rnd(7 + (o.n ?? 5));
    const parts: Parts = [];
    const n = o.n ?? 5;
    for (let i = 0; i < n; i++) {
      const h = 0.55 + r() * 0.6;
      const tilt = (r() - 0.5) * 1.1, spin = r() * Math.PI * 2;
      const x = (r() - 0.5) * 0.7, z = (r() - 0.5) * 0.7;
      parts.push(gradient(place(crystal(h, 0.12 + r() * 0.07), [x, -0.05, z], [tilt, spin, (r() - 0.5) * 1.1]), c, c2, 0.55));
    }
    parts.push(paint(place(new THREE.DodecahedronGeometry(0.3, 0), [0, -0.12, 0], [0, 0, 0], [1.2, 0.5, 1.2]), '#5a5470'));
    return parts;
  },
  flame() { return []; }, // FX, see flameFx()
  horns(o) {
    const c = o.c ?? '#efe6d2', c2 = o.c2 ?? '#6a5040';
    const parts: Parts = [];
    for (const s of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(s * 0.3, 0, 0), new THREE.Vector3(s * 0.62, 0.42, -0.12), new THREE.Vector3(s * 0.7, 0.9, -0.42), new THREE.Vector3(s * 0.5, 1.2, -0.62)]);
      parts.push(gradient(taper(curve, 0.16, 0.012, 12, 7), c2, c));
    }
    return parts;
  },
  shell(o) {
    const c = o.c ?? '#ffb8a0', c2 = o.c2 ?? '#fff0e0';
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, a = t * Math.PI * 3.2, r = 0.62 * (1 - t) + 0.05;
      pts.push(new THREE.Vector3(Math.cos(a) * r, t * 0.95, Math.sin(a) * r * 0.8));
    }
    const shell = taper(new THREE.CatmullRomCurve3(pts), 0.46, 0.04, 30, 9);
    const g = gradient(shell, c, c2);
    const col = g.getAttribute('color') as THREE.BufferAttribute;
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) { // spiral bands
      const band = 0.82 + 0.18 * Math.sin(Math.atan2(pos.getZ(i), pos.getX(i)) * 6 + pos.getY(i) * 9);
      col.setXYZ(i, col.getX(i) * band, col.getY(i) * band, col.getZ(i) * band);
    }
    return [g];
  },
  coral(o) {
    const c = o.c ?? '#ff7a8a', c2 = o.c2 ?? '#ffd0b8';
    const r = rnd(31);
    const parts: Parts = [];
    const n = o.n ?? 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r();
      const lean = 0.25 + r() * 0.35;
      const p0 = new THREE.Vector3(Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15);
      const p1 = p0.clone().add(new THREE.Vector3(Math.cos(a) * lean, 0.45, Math.sin(a) * lean));
      const p2 = p1.clone().add(new THREE.Vector3(Math.cos(a + 0.6) * 0.2, 0.4 + r() * 0.3, Math.sin(a + 0.6) * 0.2));
      parts.push(gradient(taper(new THREE.CatmullRomCurve3([p0, p1, p2]), 0.1, 0.035, 8, 6), c, c2));
      const q = p1.clone().add(new THREE.Vector3(Math.cos(a - 0.9) * 0.3, 0.28, Math.sin(a - 0.9) * 0.3));
      parts.push(gradient(taper(new THREE.CatmullRomCurve3([p1, p1.clone().lerp(q, 0.5).add(new THREE.Vector3(0, 0.08, 0)), q]), 0.06, 0.025, 6, 5), c, c2));
      parts.push(paint(place(new THREE.SphereGeometry(0.06, 6, 4), [p2.x, p2.y, p2.z]), '#fff0c0', 0.8));
    }
    return parts;
  },
  bell(o) {
    const c = o.c ?? '#e8b44a', c2 = o.c2 ?? '#7ad8ff';
    const parts: Parts = [];
    const n = o.n ?? 1;
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 0 : (i / (n - 1) - 0.5) * 1.6;
      const prof = [new THREE.Vector2(0.001, 1), new THREE.Vector2(0.22, 0.98), new THREE.Vector2(0.34, 0.8), new THREE.Vector2(0.38, 0.45), new THREE.Vector2(0.5, 0.12), new THREE.Vector2(0.56, 0), new THREE.Vector2(0.48, 0.02)];
      parts.push(gradient(place(new THREE.LatheGeometry(prof, 14), [x, -1.1, 0]), '#9a6a1e', c));
      parts.push(paint(place(new THREE.TorusGeometry(0.12, 0.035, 5, 10), [x, -0.02, 0]), '#b0802a'));
      parts.push(paint(place(new THREE.SphereGeometry(0.13, 8, 6), [x, -1.12, 0]), c2, 1));
    }
    return parts;
  },
  halo(o) {
    const c = o.c ?? '#ffe89a';
    const parts: Parts = [paint(new THREE.TorusGeometry(1, 0.05, 6, 40).rotateX(Math.PI / 2), c, 1)];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      parts.push(paint(place(new THREE.OctahedronGeometry(0.1), [Math.cos(a), 0, Math.sin(a)], [0, a, 0], [0.6, 1.6, 0.6]), o.c2 ?? '#ffffff', 1));
    }
    return parts;
  },
  shards() { return []; }, // FX, see orbitFx()
  antlers(o) {
    const c = o.c ?? '#d8c8a0', c2 = o.c2 ?? '#6fdf8a';
    const parts: Parts = [];
    for (const s of [-1, 1]) {
      const main = new THREE.CatmullRomCurve3([new THREE.Vector3(s * 0.15, 0, 0), new THREE.Vector3(s * 0.45, 0.45, -0.1), new THREE.Vector3(s * 0.62, 0.95, -0.2), new THREE.Vector3(s * 0.55, 1.4, -0.12)]);
      parts.push(gradient(taper(main, 0.09, 0.02, 12, 6), '#7a5a3a', c));
      for (const [u, len, ang] of [[0.3, 0.45, 0.9], [0.55, 0.4, 0.4], [0.78, 0.32, -0.5]] as const) {
        const p = main.getPointAt(u);
        const q = p.clone().add(new THREE.Vector3(s * Math.cos(ang) * len * 0.6, len, Math.sin(ang) * len * 0.5));
        parts.push(gradient(taper(new THREE.CatmullRomCurve3([p, p.clone().lerp(q, 0.5).add(new THREE.Vector3(s * 0.05, 0.04, 0)), q]), 0.05, 0.012, 6, 5), c, c));
        parts.push(paint(place(leaf(0.3, 0.12), [q.x, q.y - 0.05, q.z], [0.3, s * 0.8, s * 0.6]), c2, 0.35));
      }
      parts.push(paint(place(new THREE.SphereGeometry(0.07, 6, 4), [main.getPointAt(1).x, main.getPointAt(1).y + 0.05, main.getPointAt(1).z]), '#fff6a0', 1));
    }
    return parts;
  },
  mushrooms(o) {
    const cap = o.c ?? '#e8503a', dots = o.c2 ?? '#fff4e0';
    const r = rnd(13);
    const parts: Parts = [];
    const n = o.n ?? 3;
    for (let i = 0; i < n; i++) {
      const x = (r() - 0.5) * 0.9, z = (r() - 0.5) * 0.7, h = 0.35 + r() * 0.4, cs = 0.28 + r() * 0.18;
      parts.push(paint(place(new THREE.CylinderGeometry(0.06, 0.09, h, 7), [x, h / 2, z]), '#f2e6cc'));
      parts.push(gradient(place(new THREE.SphereGeometry(cs, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), [x, h - 0.02, z], [0, 0, 0], [1, 0.72, 1]), cap, cap));
      for (let d = 0; d < 4; d++) {
        const a = r() * Math.PI * 2, e = 0.3 + r() * 0.5;
        parts.push(paint(place(new THREE.SphereGeometry(cs * 0.16, 5, 3), [x + Math.cos(a) * Math.sin(e) * cs, h - 0.02 + Math.cos(e) * cs * 0.72, z + Math.sin(a) * Math.sin(e) * cs]), dots, 0.25));
      }
    }
    return parts;
  },
  fins(o) {
    const c = o.c ?? '#5fd0ff', c2 = o.c2 ?? '#dff8ff';
    const s = new THREE.Shape();
    s.moveTo(-0.5, 0);
    s.quadraticCurveTo(-0.35, 0.6, 0.1, 1.0);
    s.quadraticCurveTo(0.2, 0.55, 0.55, 0);
    s.lineTo(-0.5, 0);
    const fin = new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 });
    fin.translate(0, 0, -0.03);
    fin.rotateY(Math.PI / 2);
    return [gradient(fin, c, c2, 0.15)];
  },
  mane(o) {
    const c = o.c ?? '#ffe08a', c2 = o.c2 ?? '#ffffff';
    const parts: Parts = [];
    for (let i = 0; i < 7; i++) {
      const a = ((i / 6) - 0.5) * 2.4;
      parts.push(gradient(place(new THREE.ConeGeometry(0.16, 0.7, 5), [Math.sin(a) * 0.5, 0.2, Math.cos(a) * 0.1 - 0.3], [-0.7, 0, -a * 0.6]), c, c2, 0.3));
    }
    return parts;
  },
  gem(o) {
    return [paint(new THREE.OctahedronGeometry(0.5, 0).scale(0.8, 1.2, 0.8), o.c ?? '#7af0ff', 1)];
  },
};

// ── anchors ───────────────────────────────────────────────────────────────
const ANCHOR_BONES: Record<Anchor, RegExp[]> = {
  headTop: [/^head$/i, /^head\b/i, /head/i, /neck3|neck/i],
  head: [/^head$/i, /head/i, /neck/i],
  back: [/^(torso|chest|spine2|spine3|back)$/i, /torso|chest|spine|back/i, /^body$/i, /body|hips/i],
  chest: [/^neck1$|^neck$/i, /neck/i, /^(torso|chest)$/i, /torso|chest/i],
  tail: [/tail3|tail2|tail$/i, /tail/i],
  root: [],
};

interface Region { bone: THREE.Bone | null; top: THREE.Vector3; center: THREE.Vector3; size: THREE.Vector3 }
const regionCache = new Map<string, Region | null>();

function findBone(root: THREE.Object3D, pats: RegExp[]): THREE.Bone | null {
  const bones: THREE.Bone[] = [];
  root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
  for (const p of pats) { const b = bones.find((x) => p.test(x.name)); if (b) return b; }
  return null;
}

/** Bounding box (rig-root space) of the vertices a bone (and its children) drive, in the rest pose. */
function boneRegion(rig: THREE.Object3D, bone: THREE.Bone): THREE.Box3 | null {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const inv = new THREE.Matrix4().copy(rig.matrixWorld).invert();
  const sub = new Set<THREE.Object3D>();
  bone.traverse((o) => sub.add(o));
  rig.traverse((o) => {
    const s = o as THREE.SkinnedMesh;
    if (!s.isSkinnedMesh || s.userData.wmOutline) return;
    const idx = new Set<number>();
    s.skeleton.bones.forEach((b, i) => { if (sub.has(b)) idx.add(i); });
    if (!idx.size) return;
    const si = s.geometry.getAttribute('skinIndex'), sw = s.geometry.getAttribute('skinWeight');
    const n = s.geometry.getAttribute('position').count;
    for (let i = 0; i < n; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (idx.has(si.getComponent(i, k))) w += sw.getComponent(i, k);
      if (w < 0.5) continue;
      s.getVertexPosition(i, v);
      v.applyMatrix4(s.matrixWorld).applyMatrix4(inv);
      box.expandByPoint(v);
    }
  });
  return box.isEmpty() ? null : box;
}

export function anchorOf(rig: THREE.Object3D, height: number, anchor: Anchor, cacheKey?: string): Region {
  const key = cacheKey ? `${cacheKey}|${anchor}` : '';
  rig.updateMatrixWorld(true);
  const all = new THREE.Box3();
  rig.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !m.userData.wmOutline && !m.userData.wmFx) all.union(new THREE.Box3().setFromObject(m)); });
  const inv = new THREE.Matrix4().copy(rig.matrixWorld).invert();
  all.applyMatrix4(inv);
  const fallback = (): Region => {
    const c = all.getCenter(new THREE.Vector3()), s = all.getSize(new THREE.Vector3());
    const top = anchor === 'root' ? new THREE.Vector3(c.x, 0, c.z) : anchor === 'tail' ? new THREE.Vector3(c.x, c.y, all.min.z) : anchor === 'back' ? new THREE.Vector3(c.x, all.max.y * 0.92, c.z - s.z * 0.1) : new THREE.Vector3(c.x, all.max.y, c.z + s.z * (anchor === 'chest' ? 0.3 : 0.2));
    return { bone: null, top, center: c, size: s };
  };
  if (anchor === 'root') return fallback();
  const cached = key ? regionCache.get(key) : undefined;
  const bone = findBone(rig, ANCHOR_BONES[anchor]);
  if (!bone) return fallback();
  if (cached !== undefined) return cached ? { ...cached, bone } : fallback();
  const box = boneRegion(rig, bone);
  if (!box) { if (key) regionCache.set(key, null); return fallback(); }
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  let top: THREE.Vector3;
  if (anchor === 'headTop' || anchor === 'back') top = new THREE.Vector3(c.x, box.max.y, c.z);
  else if (anchor === 'tail') top = new THREE.Vector3(c.x, c.y, box.min.z);
  else if (anchor === 'chest') top = new THREE.Vector3(c.x, c.y - s.y * 0.25, box.max.z);
  else top = c.clone();
  const reg = { bone, top, center: c, size: s };
  if (key) regionCache.set(key, { ...reg, bone: null });
  void height;
  return reg;
}

// ── FX pieces (additive, not toon) ──────────────────────────────────────────
const FLAME_VERT = /* glsl */`
uniform float uTime; varying vec2 vUv; varying float vH;
void main(){ vUv = uv; vec3 p = position; float h = clamp(p.y, 0.0, 1.0); vH = h;
  p.x += sin(uTime * 9.0 + p.y * 6.0) * 0.08 * h; p.z += cos(uTime * 7.0 + p.y * 5.0) * 0.08 * h;
  p.xz *= 1.0 + sin(uTime * 13.0) * 0.05; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`;
const FLAME_FRAG = /* glsl */`
uniform float uTime; uniform vec3 uA; uniform vec3 uB; varying vec2 vUv; varying float vH;
void main(){ float fl = 0.75 + 0.25 * sin(uTime * 17.0 + vUv.x * 20.0); float a = (1.0 - vH) * fl;
  vec3 c = mix(uB, uA, vH) * (1.6 - vH); gl_FragColor = vec4(c * a * 2.2, a); }`;

function flameFx(o: AccSpec) {
  const g = new THREE.ConeGeometry(0.35, 1, 10, 6, true);
  g.translate(0, 0.5, 0);
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: LOOK.uTime, uA: { value: new THREE.Color(o.c ?? '#ffcf5a') }, uB: { value: new THREE.Color(o.c2 ?? '#ff4a1a') } },
    vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.userData.wmFx = true;
  mesh.renderOrder = 5;
  return mesh;
}

/** Shards orbiting the body (Aether Sovereign, Prism Wyrm). */
function orbitFx(o: AccSpec, look: Look) {
  const grp = new THREE.Group();
  const n = o.n ?? 6;
  const geo = paint(crystal(1, 0.28), o.c ?? '#bfe8ff', 0.8);
  ensureSmooth(geo, 0.8);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true }));
    m.userData.orbit = i / n;
    grp.add(m);
    look.adopt(m);
  }
  grp.userData.wmSpin = true;
  return grp;
}

// ── public API ─────────────────────────────────────────────────────────────
export interface Dressing { spinners: THREE.Object3D[]; objects: THREE.Object3D[] }

/**
 * Attach accessories to a stylised rig. `model` is the inner (scaled) model object, `height` the rig height.
 * Returns animated pieces the rig should tick (halo spin, orbiting shards).
 */
export function dress(model: THREE.Object3D, rigRoot: THREE.Object3D, height: number, look: Look, specs: AccSpec[], cacheKey: string): Dressing {
  const out: Dressing = { spinners: [], objects: [] };
  rigRoot.updateMatrixWorld(true);
  for (const spec of specs) {
    const d = DEF[spec.k];
    const anchor = spec.on ?? d.on;
    const reg = anchorOf(rigRoot, height, anchor, cacheKey);
    const size = (spec.s ?? d.s) * height;
    const at = spec.at ?? [0, 0, 0];
    // world (rig-root) placement
    const posRoot = reg.top.clone().add(new THREE.Vector3(at[0] * height, at[1] * height, at[2] * height));
    let obj: THREE.Object3D;
    if (spec.k === 'flame') obj = flameFx(spec);
    else if (spec.k === 'shards') { obj = orbitFx(spec, look); out.spinners.push(obj); }
    else {
      const parts = B[spec.k](spec);
      const glowAttr: number[] = [];
      for (const p of parts) { const n = p.getAttribute('position').count; for (let i = 0; i < n; i++) glowAttr.push(p.userData.glow ?? 0); }
      const geo = mergeGeometries(parts)!;
      ensureSmooth(geo);
      const sm = geo.getAttribute('aSmooth') as THREE.BufferAttribute;
      for (let i = 0; i < sm.count; i++) sm.setW(i, glowAttr[i] ?? 0);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true }));
      mesh.castShadow = true;
      mesh.userData.wmKeepColor = true;
      obj = mesh;
      if (spec.k === 'halo') { obj.userData.wmSpin = true; out.spinners.push(obj); }
    }
    // root-space transform → parent (bone or model root) space
    const parent: THREE.Object3D = spec.k === 'shards' ? rigRoot : reg.bone ?? model;
    const worldPos = posRoot.clone().applyMatrix4(rigRoot.matrixWorld);
    const wq = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(spec.r ?? [0, 0, 0])));
    wq.premultiply(rigRoot.getWorldQuaternion(new THREE.Quaternion()));
    const pq = parent.getWorldQuaternion(new THREE.Quaternion());
    const ps = parent.getWorldScale(new THREE.Vector3());
    obj.position.copy(parent.worldToLocal(worldPos));
    obj.quaternion.copy(pq.invert().multiply(wq));
    obj.scale.setScalar(size / Math.max(1e-5, ps.x));
    obj.userData.baseQuat = obj.quaternion.clone();
    obj.userData.size = size;
    parent.add(obj);
    if (obj instanceof THREE.Mesh && !obj.userData.wmFx) look.adopt(obj);
    out.objects.push(obj);
  }
  return out;
}

/** Tick animated accessories (called from the rig's update). */
export function tickDressing(d: Dressing, t: number) {
  for (const s of d.spinners) {
    if (s.userData.orbit === undefined && s.children.length && s.children[0].userData.orbit !== undefined) {
      for (const c of s.children) {
        const a = t * 0.7 + (c.userData.orbit as number) * Math.PI * 2;
        const r = 1.0 + 0.12 * Math.sin(t * 1.3 + (c.userData.orbit as number) * 9);
        c.position.set(Math.cos(a) * r * 2.4, 2.2 + Math.sin(t * 1.7 + (c.userData.orbit as number) * 7) * 0.5, Math.sin(a) * r * 2.4);
        c.rotation.set(t * 0.9 + (c.userData.orbit as number), t * 1.3, 0.3);
      }
    } else if (s.userData.baseQuat) {
      s.quaternion.copy(s.userData.baseQuat as THREE.Quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), t * 0.6));
    }
  }
}

// ── Auras & sparkles ────────────────────────────────────────────────────────
const AURA_VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const AURA_FRAG = /* glsl */`
uniform float uTime; uniform vec3 uColor; uniform vec3 uColor2; uniform float uStyle; uniform float uAlpha; varying vec2 vUv;
void main(){
  vec2 p = vUv * 2.0 - 1.0; float r = length(p); float a = atan(p.y, p.x);
  if (r > 1.0) discard;
  float t = uTime;
  float ring = smoothstep(0.035, 0.0, abs(r - 0.86)) + smoothstep(0.02, 0.0, abs(r - 0.7)) * 0.6;
  float runes = step(0.5, fract((a / 6.2832) * 24.0 + t * 0.05 * (uStyle > 0.5 ? 1.0 : -1.0))) * smoothstep(0.02, 0.0, abs(r - 0.78) - 0.03);
  float rays = pow(max(0.0, sin(a * 9.0 + t * 1.5)), 12.0) * smoothstep(1.0, 0.3, r) * smoothstep(0.1, 0.5, r);
  float glow = smoothstep(1.0, 0.0, r) * 0.35;
  float pulse = 0.75 + 0.25 * sin(t * 2.2);
  float v = (ring * 1.2 + runes * 0.8 + rays * 0.6 * uStyle + glow) * pulse;
  vec3 c = mix(uColor2, uColor, smoothstep(0.2, 0.9, r));
  gl_FragColor = vec4(c * v * 1.6, v * uAlpha);
}`;

export function groundAura(color: THREE.ColorRepresentation, radius: number, style: 'boss' | 'alpha' | 'rare', color2?: THREE.ColorRepresentation) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: LOOK.uTime, uColor: { value: new THREE.Color(color) }, uColor2: { value: new THREE.Color(color2 ?? '#ffffff') }, uStyle: { value: style === 'rare' ? 0 : 1 }, uAlpha: { value: style === 'rare' ? 0.55 : 0.9 } },
    vertexShader: AURA_VERT, fragmentShader: AURA_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), m);
  mesh.scale.setScalar(radius);
  mesh.position.y = 0.06;
  mesh.renderOrder = 4;
  mesh.userData.wmFx = true;
  return mesh;
}

const WISP_VERT = /* glsl */`
uniform float uTime; uniform float uH; uniform float uR; uniform float uSize; attribute float aSeed; varying float vA; varying float vS;
void main(){
  float s = aSeed; float life = fract(uTime * (0.18 + s * 0.2) + s * 7.0);
  float ang = s * 60.0 + uTime * (0.4 + s);
  vec3 p = vec3(cos(ang) * uR * (0.5 + 0.5 * fract(s * 13.0)), life * uH, sin(ang) * uR * (0.5 + 0.5 * fract(s * 13.0)));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.6 + fract(s * 31.0)) * (300.0 / -mv.z);
  vA = sin(life * 3.14159) * (0.6 + 0.4 * sin(uTime * 6.0 + s * 50.0)); vS = s;
}`;
const WISP_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uStar; varying float vA; varying float vS;
void main(){
  vec2 q = gl_PointCoord - 0.5; float d = length(q);
  float core = smoothstep(0.5, 0.0, d);
  float star = uStar > 0.5 ? max(smoothstep(0.08, 0.0, abs(q.x)) * smoothstep(0.5, 0.0, abs(q.y)), smoothstep(0.08, 0.0, abs(q.y)) * smoothstep(0.5, 0.0, abs(q.x))) : 0.0;
  float a = (core * core + star) * vA; if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * a * 2.0, a);
}`;

/** Rising motes (bosses, alphas) or twinkling star glints (shiny) around a creature. */
export function wisps(color: THREE.ColorRepresentation, n: number, radius: number, height: number, star = false, size = 0.35) {
  const g = new THREE.BufferGeometry();
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) seed[i] = Math.random();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: LOOK.uTime, uColor: { value: new THREE.Color(color) }, uH: { value: height }, uR: { value: radius }, uSize: { value: size }, uStar: { value: star ? 1 : 0 } },
    vertexShader: WISP_VERT, fragmentShader: WISP_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.userData.wmFx = true;
  pts.renderOrder = 6;
  return pts;
}

const SHELL_FRAG = /* glsl */`
uniform vec3 uColor; uniform float uTime; uniform float uAmt; varying vec3 vN; varying vec3 vV;
void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2); float p = 0.75 + 0.25 * sin(uTime * 2.4);
  gl_FragColor = vec4(uColor * f * p * uAmt, f * p * uAmt); }`;
const SHELL_VERT = /* glsl */`
#include <common>
#include <skinning_pars_vertex>
attribute vec4 aSmooth; uniform float uPush; varying vec3 vN; varying vec3 vV;
void main(){
  vec3 objectNormal = aSmooth.xyz; if (dot(objectNormal, objectNormal) < 0.01) objectNormal = normal;
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  vec3 transformed = vec3(position);
  #include <skinning_vertex>
  vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
  vec3 n = normalize(normalMatrix * objectNormal);
  mv.xyz += n * uPush;
  vN = n; vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

/** Fresnel glow shell around a Guardian's silhouette (shares geometry + skeleton with the body). */
export function glowShell(body: THREE.Mesh, color: THREE.ColorRepresentation, push: number, amt = 1) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: LOOK.uTime, uPush: { value: push }, uAmt: { value: amt } },
    vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
  });
  let s: THREE.Mesh;
  if ((body as THREE.SkinnedMesh).isSkinnedMesh) {
    const sk = body as THREE.SkinnedMesh;
    const x = new THREE.SkinnedMesh(body.geometry, m);
    x.bind(sk.skeleton, sk.bindMatrix);
    s = x;
  } else s = new THREE.Mesh(body.geometry, m);
  s.position.copy(body.position); s.quaternion.copy(body.quaternion); s.scale.copy(body.scale);
  s.userData.wmFx = true;
  s.renderOrder = 3;
  s.frustumCulled = body.frustumCulled;
  if ((body as THREE.SkinnedMesh).boundingSphere) (s as THREE.SkinnedMesh).boundingSphere = (body as THREE.SkinnedMesh).boundingSphere!.clone();
  body.parent?.add(s);
  return s;
}
