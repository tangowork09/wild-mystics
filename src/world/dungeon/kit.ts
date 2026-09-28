import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { getManifest } from '../../assets/manifest';
import type { ThemeStyle, Tone } from '../../data/dungeons';

// Dungeon kits (v3:dungeons): four CC0 kits, each merged into one GLB by tools/import-assets.mjs
// (`manifest.dungeon.<kit>`). A kit loads the first time a dungeon that needs it is entered.
// Every kit piece is a named node; `piece()` flattens it into instanceable parts, and every
// atlas-textured material is recoloured per theme (stone / wood / cloth / flame swatches).

export type KitId = 'kaykit' | 'halloween' | 'kenney' | 'quaternius';

export interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Transform relative to the piece origin. */
  matrix: THREE.Matrix4;
  /** Node name inside the piece (for animated sub-parts such as chest lids). */
  name: string;
}

export interface Piece {
  kit: KitId;
  name: string;
  parts: Part[];
  box: THREE.Box3;
  /** The raw node, for pieces that need a live clone (animated lids, gates). */
  node: THREE.Object3D;
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const kits = new Map<KitId, Promise<THREE.Object3D | null>>();
const loaded = new Map<KitId, THREE.Object3D>();

/** Load one kit (cached). Resolves null when the kit is missing (procedural fallbacks take over). */
export function loadKit(id: KitId): Promise<THREE.Object3D | null> {
  let p = kits.get(id);
  if (!p) {
    const entry = (getManifest() as { dungeon?: Record<string, { model: string }> }).dungeon?.[id];
    p = entry
      ? loader.loadAsync(`assets/${entry.model}`).then((g) => { g.scene.updateMatrixWorld(true); loaded.set(id, g.scene); return g.scene; }).catch((e) => { console.warn(`[dungeon] kit ${id} failed`, e); return null; })
      : Promise.resolve(null);
    kits.set(id, p);
  }
  return p;
}

export const kitReady = (id: KitId) => loaded.has(id);

const pieceCache = new Map<string, Piece | null>();
const inv = new THREE.Matrix4();

// ── Procedural stand-ins (kit missing, e.g. `?placeholders`) ──────────────────────────────────
const fbMat = new THREE.MeshStandardMaterial({ color: '#8a8490', roughness: 0.9, flatShading: true });
fbMat.name = 'fallback';
function box(w: number, h: number, d: number, x = 0, y = h / 2, z = 0) { return new THREE.BoxGeometry(w, h, d).translate(x, y, z); }
const FALLBACK: [RegExp, () => THREE.BufferGeometry][] = [
  [/^wall_half$/, () => box(2, 4, 1, 1)],
  [/^wall/, () => box(4, 4, 1)],
  [/^floor/, () => box(4, 0.15, 4, 0, -0.025)],
  [/^stairs/, () => { const g = new THREE.BufferGeometry(); const parts = Array.from({ length: 8 }, (_, k) => box(4, (k + 1) * 0.5, 0.5, 0, (k + 1) * 0.25, 3.75 - k * 0.5)); return mergeBoxes(g, parts); }],
  [/pillar|column/, () => box(1.4, 4, 1.4)],
  [/barrel|keg/, () => new THREE.CylinderGeometry(0.5, 0.5, 1, 10).translate(0, 0.5, 0)],
  [/torch|candle|lantern/, () => box(0.2, 0.6, 0.2, 0, 0.3, 0.2)],
  [/banner/, () => box(1.2, 2.4, 0.08, 0, 2.2, 0.45)],
  [/rubble|rocks|stones/, () => new THREE.DodecahedronGeometry(0.8, 0).translate(0, 0.4, 0)],
  [/./, () => box(1, 1, 1)],
];
function mergeBoxes(_g: THREE.BufferGeometry, parts: THREE.BufferGeometry[]) {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  let off = 0;
  for (const p of parts) {
    const pa = p.getAttribute('position'), na = p.getAttribute('normal'), ia = p.getIndex()!;
    for (let i = 0; i < pa.count; i++) { pos.push(pa.getX(i), pa.getY(i), pa.getZ(i)); nor.push(na.getX(i), na.getY(i), na.getZ(i)); }
    for (let i = 0; i < ia.count; i++) idx.push(ia.getX(i) + off);
    off += pa.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

function fallbackPiece(kit: KitId, name: string): Piece {
  const geo = (FALLBACK.find(([re]) => re.test(name)) ?? FALLBACK[FALLBACK.length - 1])[1]();
  geo.computeBoundingBox();
  const node = new THREE.Mesh(geo, fbMat);
  node.name = name;
  return { kit, name, parts: [{ geometry: geo, material: fbMat, matrix: new THREE.Matrix4(), name }], box: geo.boundingBox!.clone(), node };
}

/** A kit piece flattened into parts; a procedural stand-in when the kit or piece is missing. */
export function piece(kit: KitId, name: string): Piece {
  const hit = pieceCache.get(`${kit}/${name}`);
  if (hit) return hit;
  const p = realPiece(kit, name) ?? fallbackPiece(kit, name);
  pieceCache.set(`${kit}/${name}`, p);
  return p;
}

/** True when the real model (not a stand-in) is available. */
export const hasPiece = (kit: KitId, name: string) => !!loaded.get(kit)?.children.some((c) => c.name === name);

function realPiece(kit: KitId, name: string): Piece | null {
  const root = loaded.get(kit);
  const node = root?.children.find((c) => c.name === name) ?? null;
  if (!node) return null;
  node.updateMatrixWorld(true);
  inv.copy(node.matrixWorld).invert();
  const parts: Part[] = [];
  const box = new THREE.Box3();
  node.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const matrix = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    box.union(m.geometry.boundingBox!.clone().applyMatrix4(matrix));
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    parts.push({ geometry: m.geometry, material: mats[0], matrix, name: m.name || o.parent?.name || '' });
  });
  return { kit, name, parts, box, node };
}

// ── Theme recolour ─────────────────────────────────────────────────────────────────────────────

function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  const c = new THREE.Color().setHSL(((h % 1) + 1) % 1, THREE.MathUtils.clamp(s, 0, 1), THREE.MathUtils.clamp(l, 0, 1));
  return [c.r, c.g, c.b];
}

const tmpHsl = { h: 0, s: 0, l: 0 };
const tmpCol = new THREE.Color();

/** Recolour one sRGB pixel (0–1) by the theme's stone / wood / accent rules. */
function recolour(r: number, g: number, b: number, theme: ThemeStyle, flame: THREE.Color, zone: 'auto' | 'flame' | 'keep'): [number, number, number] {
  if (zone === 'keep') return [r, g, b];
  tmpCol.setRGB(r, g, b, THREE.SRGBColorSpace);
  tmpCol.getHSL(tmpHsl, THREE.SRGBColorSpace);
  const { h, s, l } = tmpHsl;
  if (zone === 'flame') {
    const f = { h: 0, s: 0, l: 0 };
    flame.getHSL(f, THREE.SRGBColorSpace);
    return hsl2rgb(f.h + (h - 0.07) * 0.3, Math.max(f.s, 0.75), Math.min(0.92, l * 0.7 + 0.3));
  }
  const tone = (t: Tone, sat: number) => hsl2rgb(t.h, t.s * sat, l * t.l + (t.add ?? 0));
  if (s < 0.2) return tone(theme.stone, 0.55 + 0.45 * (1 - Math.abs(l - 0.5) * 2));
  const warm = h < 0.13 || h > 0.97;
  if (warm && s < 0.66 && l < 0.72) {
    const w = theme.wood;
    return hsl2rgb(w.h + (h < 0.5 ? h : h - 1) * 0.35, THREE.MathUtils.lerp(s, w.s, 0.75), l * w.l + (w.add ?? 0));
  }
  if (theme.accent) {
    const [ah, k] = theme.accent;
    let dh = ah - h;
    if (dh > 0.5) dh -= 1; else if (dh < -0.5) dh += 1;
    return hsl2rgb(h + dh * k, s, l);
  }
  return [r, g, b];
}

/**
 * KayKit atlases are an 8×4 grid of gradient swatches; the torch flame is column 6 of row 0.
 * Other atlases fall back to colour-only rules.
 */
function swatchZone(kit: KitId, u: number, v: number): 'auto' | 'flame' | 'keep' {
  if (kit === 'kaykit') {
    const col = Math.floor(u * 8), row = Math.floor(v * 4);
    if (row === 0 && col === 6) return 'flame';
    return 'auto';
  }
  return 'auto';
}

const themed = new Map<string, THREE.Material>();
const flameMasks = new Map<string, THREE.Texture>();

function imageToCanvas(img: CanvasImageSource & { width: number; height: number }, size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, size, size);
  return { c, g };
}

/**
 * The theme's version of a kit material: its atlas recoloured on a canvas, plus an emissive mask so
 * flame swatches glow (bloom picks them up). Plain-colour materials are tinted instead.
 */
export function themedMaterial(kit: KitId, src: THREE.Material, themeKey: string, theme: ThemeStyle): THREE.Material {
  const key = `${kit}:${src.uuid}:${themeKey}`;
  const hit = themed.get(key);
  if (hit) return hit;
  const base = src as THREE.MeshStandardMaterial;
  const m = base.clone();
  m.roughness = Math.max(0.55, base.roughness ?? 0.8);
  m.metalness = Math.min(0.15, base.metalness ?? 0);
  const flame = new THREE.Color(theme.torch);
  const img = base.map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (base.map && img && img.width) {
    const size = Math.min(256, img.width);
    const { c, g } = imageToCanvas(img, size);
    const data = g.getImageData(0, 0, size, size);
    const mask = document.createElement('canvas');
    mask.width = mask.height = size;
    const mg = mask.getContext('2d')!;
    const md = mg.createImageData(size, size);
    let flames = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const o = (y * size + x) * 4;
        const zone = swatchZone(kit, (x + 0.5) / size, (y + 0.5) / size);
        const [r, gg, b] = recolour(data.data[o] / 255, data.data[o + 1] / 255, data.data[o + 2] / 255, theme, flame, zone);
        data.data[o] = r * 255; data.data[o + 1] = gg * 255; data.data[o + 2] = b * 255;
        const glow = zone === 'flame' ? 255 : 0;
        if (glow) flames++;
        md.data[o] = md.data[o + 1] = md.data[o + 2] = glow; md.data[o + 3] = 255;
      }
    }
    g.putImageData(data, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.flipY = base.map.flipY;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = base.map.wrapS; tex.wrapT = base.map.wrapT;
    tex.anisotropy = 4;
    m.map = tex;
    if (flames) {
      mg.putImageData(md, 0, 0);
      const mt = new THREE.CanvasTexture(mask);
      mt.flipY = base.map.flipY;
      flameMasks.set(key, mt);
      m.emissiveMap = mt;
      m.emissive = new THREE.Color(theme.torch);
      m.emissiveIntensity = 2.6;
    }
  } else if (base.color) {
    const [r, gg, b] = recolour(base.color.r, base.color.g, base.color.b, theme, flame, 'auto');
    // plain materials (metal, gold, marble) keep most of their own colour
    m.color.setRGB(THREE.MathUtils.lerp(base.color.r, r, 0.45), THREE.MathUtils.lerp(base.color.g, gg, 0.45), THREE.MathUtils.lerp(base.color.b, b, 0.45));
  }
  m.needsUpdate = true;
  themed.set(key, m);
  return m;
}

/** Drop cached theme materials/textures (called when a dungeon is left, to keep phone memory low). */
export function releaseThemed(themeKey?: string) {
  for (const [k, m] of themed) {
    if (themeKey && !k.endsWith(`:${themeKey}`)) continue;
    const sm = m as THREE.MeshStandardMaterial;
    sm.map?.dispose();
    sm.emissiveMap?.dispose();
    m.dispose();
    themed.delete(k);
    flameMasks.delete(k);
  }
}
