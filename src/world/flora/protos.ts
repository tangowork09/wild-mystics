import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { envVariants } from '../../assets/manifest';
import { mulberry32 } from '../../core/noise';
import type { Family } from './species';

// Prototype library: every vegetation model flattened into (geometry, material) parts in model space,
// ready to instance. Sources: the Quaternius MegaKit GLBs from the manifest, extra variants from
// public/assets/flora (tools/import-flora.mjs), and procedural crystals, cacti and logs.
// Materials are shared by name across files (one texture per kind on the GPU), leaves switch to the
// untinted textures so each land can colour its own foliage, and leaf normals are bent outward from
// the canopy centre for soft, volumetric shading.

export interface Part {
  geometry: THREE.BufferGeometry;
  /** Base material name (see MaterialLib). */
  mat: string;
  foliage: boolean;
}

export interface Proto {
  id: number;
  family: Family;
  variant: number;
  parts: Part[];
  box: THREE.Box3;
  /** Horizontal radius from the trunk axis. */
  radius: number;
}

const HEIGHTS: Partial<Record<Family, number>> = { tree_round: 7.5, tree_pine: 10, tree_dead: 6.5, tree_twisted: 7, tuft: 0.7, fern: 0.9 };
const EXTRA: Partial<Record<Family, string[]>> = {
  tree_round: ['CommonTree_2', 'CommonTree_4'],
  tree_pine: ['Pine_2', 'Pine_4'],
  tree_twisted: ['TwistedTree_2', 'TwistedTree_4'],
  tree_dead: ['DeadTree_2', 'DeadTree_4'],
  tuft: ['Grass_Wispy_Short'],
  fern: ['Plant_1_Big'],
};
const MANIFEST_KEY: Partial<Record<Family, string>> = {
  tree_round: 'tree_round', tree_pine: 'tree_pine', tree_dead: 'tree_dead', tree_twisted: 'tree_twisted', rock: 'rock', boulder: 'boulder',
  bush: 'bush', fern: 'fern', mushroom: 'mushroom', flowers: 'flowers', pebbles: 'pebbles', reeds: 'reeds',
};
const WHITE_LEAVES: Record<string, string> = {
  Leaves_NormalTree: 'assets/flora/leaves_round.webp',
  Leaves_TwistedTree: 'assets/flora/leaves_twisted.webp',
  Leaves_Pine: 'assets/flora/leaves_pine.webp',
};
const FOLIAGE_RE = /leaves|leaf|grass|flower|fern|plant|clover|needle/i;
const ALBEDO_GAIN: Record<string, number> = { Rocks: 2.6, PathRocks: 2.4, Bark_DeadTree: 5, Bark_TwistedTree: 2.2, Bark_NormalTree: 1.3 };

const texLoader = new THREE.TextureLoader();
function loadTex(url: string, srgb = true) {
  const t = texLoader.load(url);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  t.flipY = false;
  return t;
}

/** Base materials shared by name. */
export class MaterialLib {
  readonly base = new Map<string, THREE.MeshStandardMaterial>();

  adopt(src: THREE.Material): string {
    const name = src.name || 'Unnamed';
    if (this.base.has(name)) return name;
    const s = src as THREE.MeshStandardMaterial;
    const foliage = FOLIAGE_RE.test(name);
    // glTF texture transforms (meshopt UV quantisation) differ per file: they are baked into each
    // part's UVs in flatten(), so the shared textures must use an identity transform
    const plain = (t: THREE.Texture | null | undefined) => {
      if (!t) return null;
      const c = t.clone();
      c.offset.set(0, 0); c.repeat.set(1, 1); c.rotation = 0; c.center.set(0, 0);
      c.matrixAutoUpdate = true;
      c.updateMatrix();
      return c;
    };
    const m = new THREE.MeshStandardMaterial({
      name,
      map: plain(s.map),
      normalMap: foliage ? null : plain(s.normalMap),
      color: new THREE.Color(1, 1, 1),
      roughness: foliage ? 0.78 : /rock|pebble/i.test(name) ? 0.92 : 0.9,
      metalness: 0,
      vertexColors: !!s.vertexColors,
      side: foliage ? THREE.DoubleSide : THREE.FrontSide,
      alphaTest: foliage || s.alphaTest > 0 || s.transparent ? 0.5 : 0,
      transparent: false,
    });
    if (!s.map && s.color) m.color.copy(s.color);
    // calibrate the kit's (very dark) albedos to the scene lighting: rock ~0.25, bark ~0.17, dead wood ~0.25
    const gain = ALBEDO_GAIN[name];
    if (gain) m.color.multiplyScalar(gain);
    const white = WHITE_LEAVES[name];
    if (white) m.map = loadTex(white);
    if (m.map) m.map.anisotropy = 4;
    this.base.set(name, m);
    return name;
  }

  add(name: string, m: THREE.MeshStandardMaterial) { m.name = name; this.base.set(name, m); return name; }
  get(name: string) { return this.base.get(name)!; }
  isFoliage(name: string) { return FOLIAGE_RE.test(name); }
}

/** Float32 copy of the geometry with `m` baked in (meshopt geometry is quantised). */
function bake(src: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const a = src.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    if (!a) continue;
    const n = a.count, sz = Math.min(a.itemSize, name === 'color' ? 3 : a.itemSize);
    const arr = new Float32Array(n * sz);
    for (let i = 0; i < n; i++) {
      arr[i * sz] = a.getX(i);
      if (sz > 1) arr[i * sz + 1] = a.getY(i);
      if (sz > 2) arr[i * sz + 2] = a.getZ(i);
      if (sz > 3) arr[i * sz + 3] = a.getW(i);
    }
    g.setAttribute(name, new THREE.BufferAttribute(arr, sz));
  }
  if (src.index) g.setIndex(new THREE.BufferAttribute(src.index.array.slice(), 1));
  g.applyMatrix4(m);
  // a mirrored node transform flips the winding once it is baked in: flip it back
  if (m.determinant() < 0) {
    if (g.index) {
      const ix = g.index.array;
      for (let i = 0; i + 2 < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    } else {
      for (const a of Object.values(g.attributes) as THREE.BufferAttribute[]) {
        const s = a.itemSize, arr = a.array;
        for (let v = 0; v + 2 < a.count; v += 3) for (let c = 0; c < s; c++) {
          const t = arr[(v + 1) * s + c]; arr[(v + 1) * s + c] = arr[(v + 2) * s + c]; arr[(v + 2) * s + c] = t;
        }
      }
    }
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  return g;
}

/** Bend leaf normals away from the canopy centre so the crown shades like one soft volume. */
function softenFoliage(g: THREE.BufferGeometry, k = 0.72) {
  g.computeBoundingBox();
  const c = g.boundingBox!.getCenter(new THREE.Vector3());
  c.y -= (g.boundingBox!.max.y - g.boundingBox!.min.y) * 0.12;
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  const v = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).sub(c).normalize();
    nn.fromBufferAttribute(n, i);
    nn.lerp(v, k).normalize();
    n.setXYZ(i, nn.x, nn.y, nn.z);
  }
  n.needsUpdate = true;
}

function flatten(root: THREE.Object3D, lib: MaterialLib, family: Family, targetH?: number): Part[] {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const parts: Part[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const m = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    const g = bake(mesh.geometry, m);
    const map = (mats[0] as THREE.MeshStandardMaterial).map;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
    if (map && uv) {
      map.updateMatrix();
      const t = map.matrix, v = new THREE.Vector3();
      for (let i = 0; i < uv.count; i++) { v.set(uv.getX(i), uv.getY(i), 1).applyMatrix3(t); uv.setXY(i, v.x, v.y); }
    }
    if (mats.length > 1 && g.groups.length) {
      // split multi-material meshes by group
      for (const grp of mesh.geometry.groups) {
        const sub = g.clone();
        const idx = g.index!.array.slice(grp.start, grp.start + grp.count);
        sub.setIndex(new THREE.BufferAttribute(idx, 1));
        const name = lib.adopt(mats[grp.materialIndex ?? 0]);
        parts.push({ geometry: sub, mat: name, foliage: lib.isFoliage(name) });
      }
    } else {
      const name = lib.adopt(mats[0]);
      parts.push({ geometry: g, mat: name, foliage: lib.isFoliage(name) });
    }
  });
  // normalise height for directly-loaded extras, ground the model at y = 0
  const box = new THREE.Box3();
  for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox!); }
  const s = targetH ? targetH / Math.max(1e-3, box.max.y - box.min.y) : 1;
  const lift = -box.min.y * s;
  if (s !== 1 || Math.abs(lift) > 1e-4) for (const p of parts) p.geometry.scale(s, s, s).translate(0, lift, 0);
  for (const p of parts) {
    if (p.foliage && /^tree_/.test(family)) softenFoliage(p.geometry, family === 'tree_pine' ? 0.6 : 0.75);
    else if (p.foliage && family === 'bush') softenFoliage(p.geometry, 0.7);
    p.geometry.computeBoundingSphere();
  }
  return parts;
}

// ── procedural prototypes ────────────────────────────────────────────────
function crystalParts(lib: MaterialLib, variant: number): Part[] {
  if (!lib.base.has('Crystal')) {
    lib.add('Crystal', new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.16, metalness: 0.05, flatShading: true }));
    lib.add('CrystalRock', new THREE.MeshStandardMaterial({ color: '#7c7688', roughness: 0.9, flatShading: true }));
  }
  const rnd = mulberry32(900 + variant * 31);
  const shards: THREE.BufferGeometry[] = [];
  const n = 5 + variant * 2;
  for (let i = 0; i < n; i++) {
    const main = i === 0;
    const h = main ? 3.4 + variant * 0.8 : 0.9 + rnd() * 2.4;
    const r = main ? 0.42 : 0.14 + rnd() * 0.22;
    const body = new THREE.CylinderGeometry(r, r * 1.08, h, 6, 1).translate(0, h / 2, 0);
    const tip = new THREE.ConeGeometry(r, r * 2.2, 6, 1).translate(0, h + r * 1.1, 0);
    const g = mergeGeometries([body.toNonIndexed(), tip.toNonIndexed()])!;
    const a = rnd() * Math.PI * 2, d = main ? 0 : 0.3 + rnd() * 0.5;
    g.rotateX((main ? 0.04 : 0.25 + rnd() * 0.45) * (rnd() < 0.5 ? -1 : 1));
    g.rotateY(a);
    g.translate(Math.cos(a) * d, -0.1, Math.sin(a) * d);
    shards.push(g);
  }
  const crystal = mergeGeometries(shards)!;
  crystal.computeVertexNormals();
  const rock = new THREE.IcosahedronGeometry(0.9, 0).scale(1.3, 0.45, 1.2);
  rock.computeVertexNormals();
  return [{ geometry: crystal, mat: 'Crystal', foliage: false }, { geometry: rock, mat: 'CrystalRock', foliage: false }];
}

function cactusParts(lib: MaterialLib, variant: number): Part[] {
  if (!lib.base.has('Cactus')) {
    lib.add('Cactus', new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.62, vertexColors: true }));
  }
  const rnd = mulberry32(400 + variant * 17);
  const ribbed = (r: number, h: number, seg = 12) => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const rr = r * (t < 0.85 ? 1 - t * 0.08 : Math.sqrt(Math.max(0, 1 - ((t - 0.85) / 0.15) ** 2)) * 0.92);
      pts.push(new THREE.Vector2(Math.max(rr, 0.001), t * h));
    }
    const g = new THREE.LatheGeometry(pts, seg * 2);
    // ribs: push every other column outward, colour the grooves darker
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const cols = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const a = Math.atan2(z, x);
      const rib = Math.cos(a * seg) * 0.5 + 0.5;
      const k = 1 + (rib - 0.5) * 0.14;
      p.setX(i, x * k); p.setZ(i, z * k);
      const c = 0.72 + rib * 0.32;
      cols[i * 3] = c * 0.95; cols[i * 3 + 1] = c; cols[i * 3 + 2] = c * 0.9;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return g.toNonIndexed();
  };
  const parts: THREE.BufferGeometry[] = [];
  const H = 2.6 + variant * 0.7;
  parts.push(ribbed(0.34, H));
  const arms = variant === 0 ? 2 : variant === 1 ? 3 : 1;
  for (let i = 0; i < arms; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const hy = H * (0.35 + rnd() * 0.3);
    const up = 0.7 + rnd() * 0.8;
    const elbow = ribbed(0.2, 0.55, 10).rotateZ(-side * Math.PI / 2).translate(side * 0.25, hy, 0);
    const arm = ribbed(0.2, up, 10).translate(side * 0.78, hy - 0.05, 0);
    const a = rnd() * Math.PI * 2;
    elbow.rotateY(a); arm.rotateY(a);
    parts.push(elbow, arm);
  }
  if (variant !== 2) {
    // a flower crown
    const petal = new THREE.SphereGeometry(0.12, 6, 4).scale(1, 0.5, 1).translate(0, H + 0.02, 0).toNonIndexed();
    const pc = new Float32Array(petal.getAttribute('position').count * 3);
    for (let i = 0; i < pc.length; i += 3) { pc[i] = 1.6; pc[i + 1] = 0.55; pc[i + 2] = 0.8; }
    petal.setAttribute('color', new THREE.BufferAttribute(pc, 3));
    petal.deleteAttribute('uv');
    petal.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(petal.getAttribute('position').count * 2), 2));
    parts.push(petal);
  }
  const g = mergeGeometries(parts.map((p) => { if (!p.getAttribute('uv')) p.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.getAttribute('position').count * 2), 2)); return p; }))!;
  g.computeVertexNormals();
  return [{ geometry: g, mat: 'Cactus', foliage: false }];
}

function logParts(lib: MaterialLib, variant: number): Part[] {
  const barkName = lib.base.has('Bark_NormalTree') ? 'Bark_NormalTree' : 'LogBark';
  if (!lib.base.has(barkName)) lib.add(barkName, new THREE.MeshStandardMaterial({ color: '#6b4a32', roughness: 0.9 }));
  if (!lib.base.has('LogEnd')) lib.add('LogEnd', new THREE.MeshStandardMaterial({ color: '#c8a070', roughness: 0.85 }));
  if (!lib.base.has('Moss')) lib.add('Moss', new THREE.MeshStandardMaterial({ color: '#5a9a3a', roughness: 0.95 }));
  const L = 3 + variant * 0.8;
  const body = new THREE.CylinderGeometry(0.36, 0.42, L, 12, 1, true).rotateZ(Math.PI / 2).translate(0, 0.36, 0);
  const uv = body.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * L * 0.5);
  const ends = mergeGeometries([
    new THREE.CircleGeometry(0.36, 12).rotateY(Math.PI / 2).translate(L / 2, 0.36, 0),
    new THREE.CircleGeometry(0.42, 12).rotateY(-Math.PI / 2).translate(-L / 2, 0.36, 0),
  ])!;
  const moss = new THREE.SphereGeometry(0.4, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(L * 0.42, 0.35, 1.02).translate(0, 0.5, 0);
  return [
    { geometry: body, mat: barkName, foliage: false },
    { geometry: ends, mat: 'LogEnd', foliage: false },
    { geometry: moss, mat: 'Moss', foliage: false },
  ];
}

// ── loading ──────────────────────────────────────────────────────────────
const gltf = new GLTFLoader();
gltf.setMeshoptDecoder(MeshoptDecoder);

export class ProtoLib {
  readonly mats = new MaterialLib();
  readonly byFamily = new Map<Family, Proto[]>();
  readonly all: Proto[] = [];

  async load() {
    const extras = new Map<string, THREE.Object3D>();
    await Promise.all(Object.values(EXTRA).flat().map((name) => gltf.loadAsync(`assets/flora/${name}.glb`)
      .then((g) => { extras.set(name, g.scene); })
      .catch((e) => console.warn(`[flora] ${name} failed`, e))));
    // desert rock material swap (same UVs as the grey rock texture)
    const families: Family[] = ['tree_round', 'tree_pine', 'tree_dead', 'tree_twisted', 'rock', 'boulder', 'bush', 'fern', 'mushroom', 'flowers', 'pebbles', 'reeds', 'tuft', 'crystal', 'cactus', 'log'];
    for (const f of families) {
      const list: Proto[] = [];
      const push = (parts: Part[]) => {
        if (!parts.length) return;
        const box = new THREE.Box3();
        let radius = 0;
        for (const p of parts) {
          p.geometry.computeBoundingBox();
          box.union(p.geometry.boundingBox!);
          const pos = p.geometry.getAttribute('position');
          for (let i = 0; i < pos.count; i++) radius = Math.max(radius, Math.hypot(pos.getX(i), pos.getZ(i)));
        }
        const proto: Proto = { id: this.all.length, family: f, variant: list.length, parts, box, radius };
        list.push(proto);
        this.all.push(proto);
      };
      const key = MANIFEST_KEY[f];
      const variants = key ? envVariants(key) : null;
      if (variants) for (const v of variants) push(flatten(v, this.mats, f));
      for (const name of EXTRA[f] ?? []) {
        const o = extras.get(name);
        if (o) push(flatten(o.clone(true), this.mats, f, HEIGHTS[f]));
      }
      if (f === 'crystal') for (let v = 0; v < 3; v++) push(crystalParts(this.mats, v));
      if (f === 'cactus') for (let v = 0; v < 3; v++) push(cactusParts(this.mats, v));
      if (f === 'log') for (let v = 0; v < 2; v++) push(logParts(this.mats, v));
      for (const p of list) for (const part of p.parts) part.geometry.computeBoundingBox();
      if (list.length) this.byFamily.set(f, list);
    }
    // vertex colours per shared material: on if any geometry has them, white where a geometry lacks them
    // (a shared material expecting colours would otherwise read black); lift the baked AO a little
    const withColor = new Set<string>();
    for (const p of this.all) for (const part of p.parts) if (part.geometry.getAttribute('color')) withColor.add(part.mat);
    for (const [name, m] of this.mats.base) m.vertexColors = withColor.has(name);
    for (const p of this.all) for (const part of p.parts) {
      if (!withColor.has(part.mat)) continue;
      const c = part.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
      if (!c) {
        const n = part.geometry.getAttribute('position').count;
        part.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      } else if (part.foliage) {
        for (let i = 0; i < c.count; i++) c.setXYZ(i, 0.38 + 0.62 * c.getX(i), 0.38 + 0.62 * c.getY(i), 0.38 + 0.62 * c.getZ(i));
      }
    }
    if (this.mats.base.has('Rocks')) {
      const r = this.mats.get('Rocks');
      const d = r.clone();
      d.map = loadTex('assets/flora/rocks_desert.webp');
      this.mats.add('RocksDesert', d);
    }
    return this;
  }

  family(f: Family) { return this.byFamily.get(f) ?? []; }
}
