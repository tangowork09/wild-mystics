// Towns & POIs geometry kit (v3:towns).
//
// Everything a town is made of is written into a `Builder`: a transform stack plus one growing
// vertex buffer per material bucket. Parts carry their colour in vertex colours, so a whole town
// collapses into ~10 merged meshes (one per bucket) no matter how many houses, fences and lamps it
// has. GLB props (KayKit / Kenney kits) are baked into the same kind of buckets, keyed by their
// shared texture atlas, so they merge too.

import * as THREE from 'three';

// ── Colours ──────────────────────────────────────────────────────────────────────────────────
const colorCache = new Map<string, THREE.Color>();
/** Linear-space colour from an sRGB hex (cached, treat as immutable). */
export function C(hex: string): THREE.Color {
  let c = colorCache.get(hex);
  if (!c) { c = new THREE.Color(hex); colorCache.set(hex, c); }
  return c;
}
/** Multiply a colour's brightness (new instance). */
export const shade = (c: THREE.Color | string, k: number) => (typeof c === 'string' ? C(c) : c).clone().multiplyScalar(k);
/** Mix two colours (new instance). */
export const mixC = (a: THREE.Color | string, b: THREE.Color | string, t: number) => (typeof a === 'string' ? C(a) : a).clone().lerp(typeof b === 'string' ? C(b) : b, t);
export type Col = THREE.Color | string;
const col = (c: Col) => (typeof c === 'string' ? C(c) : c);

// ── Seeded random ───────────────────────────────────────────────────────────────────────────
export function rng(seed: number | string) {
  let a = typeof seed === 'number' ? seed >>> 0 : [...seed].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Object.assign(f, {
    range: (lo: number, hi: number) => lo + f() * (hi - lo),
    int: (lo: number, hi: number) => Math.floor(lo + f() * (hi - lo + 1)),
    pick: <T>(arr: readonly T[]) => arr[Math.floor(f() * arr.length)],
    chance: (p: number) => f() < p,
  });
}
export type Rng = ReturnType<typeof rng>;

// ── Primitive templates (unit space) ─────────────────────────────────────────────────────────
export interface Tmpl { pos: Float32Array; nor: Float32Array; uv: Float32Array; idx: Uint32Array; y0: number; y1: number }

function fromGeometry(g: THREE.BufferGeometry, flat = false): Tmpl {
  let geo = g;
  if (flat) { geo = g.index ? g.toNonIndexed() : g; geo.computeVertexNormals(); }
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const n = geo.getAttribute('normal') as THREE.BufferAttribute;
  const u = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const count = p.count;
  const idx = geo.index ? new Uint32Array(geo.index.array) : Uint32Array.from({ length: count }, (_, i) => i);
  geo.computeBoundingBox();
  return {
    pos: new Float32Array(p.array), nor: new Float32Array(n.array),
    uv: u ? new Float32Array(u.array) : new Float32Array(count * 2), idx,
    y0: geo.boundingBox!.min.y, y1: geo.boundingBox!.max.y,
  };
}

const tmplCache = new Map<string, Tmpl>();
function cached(key: string, make: () => Tmpl) {
  let t = tmplCache.get(key);
  if (!t) { t = make(); tmplCache.set(key, t); }
  return t;
}

/** Gable prism: triangle (−0.5,0)→(0,1)→(0.5,0) in XY, extruded along Z from −0.5 to 0.5. */
function prismGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0, 1); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return g;
}
/** Wedge (ramp): right triangle in YZ, rises from z=+0.5 (h 0) to z=−0.5 (h 1), extruded along X. */
function wedgeGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0.5, 0); s.lineTo(-0.5, 0); s.lineTo(-0.5, 1); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  g.rotateY(-Math.PI / 2);
  return g;
}

export const T = {
  box: () => cached('box', () => fromGeometry(new THREE.BoxGeometry(1, 1, 1))),
  /** Cylinder, radius 1 (top radius `top`), height 1 centred on y. */
  cyl: (sides = 10, top = 1, flat = false) => cached(`cyl${sides}:${top}:${flat}`, () => fromGeometry(new THREE.CylinderGeometry(top, 1, 1, sides, 1), flat)),
  /** Open tube (no caps). */
  tube: (sides = 10, top = 1) => cached(`tube${sides}:${top}`, () => fromGeometry(new THREE.CylinderGeometry(top, 1, 1, sides, 1, true))),
  cone: (sides = 10, flat = false) => cached(`cone${sides}:${flat}`, () => fromGeometry(new THREE.ConeGeometry(1, 1, sides, 1), flat)),
  sphere: (w = 12, h = 8, flat = false) => cached(`sph${w}:${h}:${flat}`, () => fromGeometry(new THREE.SphereGeometry(1, w, h), flat)),
  /** Upper hemisphere, radius 1, base at y=0. */
  dome: (w = 16, h = 6, flat = false) => cached(`dome${w}:${h}:${flat}`, () => fromGeometry(new THREE.SphereGeometry(1, w, h, 0, Math.PI * 2, 0, Math.PI / 2), flat)),
  ico: (detail = 0) => cached(`ico${detail}`, () => fromGeometry(new THREE.IcosahedronGeometry(1, detail), true)),
  dodeca: () => cached('dodeca', () => fromGeometry(new THREE.DodecahedronGeometry(1, 0), true)),
  octa: () => cached('octa', () => fromGeometry(new THREE.OctahedronGeometry(1, 0), true)),
  torus: (tube = 0.1, radial = 6, tubular = 24) => cached(`tor${tube}:${radial}:${tubular}`, () => fromGeometry(new THREE.TorusGeometry(1, tube, radial, tubular))),
  prism: () => cached('prism', () => fromGeometry(prismGeometry(), true)),
  wedge: () => cached('wedge', () => fromGeometry(wedgeGeometry(), true)),
  /** 1×1 quad facing +Z. */
  quad: () => cached('quad', () => fromGeometry(new THREE.PlaneGeometry(1, 1))),
  /** Disc radius 1 facing +Y. */
  disc: (sides = 24) => cached(`disc${sides}`, () => fromGeometry(new THREE.CircleGeometry(1, sides).rotateX(-Math.PI / 2))),
  ring: (inner = 0.8, sides = 32) => cached(`ring${inner}:${sides}`, () => fromGeometry(new THREE.RingGeometry(inner, 1, sides).rotateX(-Math.PI / 2))),
};

// ── Buckets & materials ─────────────────────────────────────────────────────────────────────
/**
 * solid: vertex-coloured opaque · metal: shiny accents · glow: lit at night (windows, lanterns) ·
 * shine: always glowing (crystals, runes) · cloth: double-sided fabric · leaf: foliage ·
 * water / lava: animated surfaces · pave / plank: textured ground · sign: text atlas ·
 * kay / ken: GLB kit props baked by their shared atlas texture.
 */
export type BucketId = 'solid' | 'metal' | 'glow' | 'shine' | 'cloth' | 'leaf' | 'water' | 'lava' | 'pave' | 'plank' | 'sign' | 'kay' | 'ken' | 'glb';

export const night = { value: 0 };
export const time = { value: 0 };

let mats: Partial<Record<BucketId, THREE.Material>> = {};
const glbMats = new Map<string, THREE.Material>();

function glowPatch(mat: THREE.MeshStandardMaterial, darken: number) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb *= ${darken.toFixed(3)};`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= vColor.rgb;');
  };
  mat.customProgramCacheKey = () => `towns-glow-${darken}`;
}

export function material(id: BucketId): THREE.Material {
  const m = mats[id];
  if (m) return m;
  let out: THREE.Material;
  switch (id) {
    case 'solid': out = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 }); break;
    case 'metal': out = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.65 }); break;
    case 'glow': {
      const g = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0.35 });
      glowPatch(g, 0.18);
      out = g;
      break;
    }
    case 'shine': {
      const g = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, emissive: '#ffffff', emissiveIntensity: 1.1 });
      glowPatch(g, 0.6);
      out = g;
      break;
    }
    case 'cloth': out = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }); break;
    case 'leaf': out = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 }); break;
    case 'water': out = waterMaterial(); break;
    case 'lava': out = lavaMaterial(); break;
    case 'pave': out = groundMaterial(paveTextures()); break;
    case 'plank': out = groundMaterial(plankTextures(), -1); break;
    case 'sign': {
      const t = signAtlas().tex;
      out = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.12, roughness: 0.85 });
      break;
    }
    default: out = new THREE.MeshStandardMaterial({ color: '#ff00ff' });
  }
  out.name = `towns-${id}`;
  mats[id] = out;
  return out;
}

/** Called once per frame by the town system: windows/lanterns warm up at night. */
export function setNight(n: number, t: number) {
  night.value = n;
  time.value = t;
  const g = mats.glow as THREE.MeshStandardMaterial | undefined;
  if (g) g.emissiveIntensity = 0.28 + n * 2.9;
  const s = mats.shine as THREE.MeshStandardMaterial | undefined;
  if (s) s.emissiveIntensity = 1.0 + n * 1.2;
  const sg = mats.sign as THREE.MeshStandardMaterial | undefined;
  if (sg) sg.emissiveIntensity = 0.1 + n * 0.25;
}

function waterMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.06, metalness: 0.15, transparent: true, opacity: 0.86, depthWrite: false });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vWp;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 q = vWp.xz * 1.7;
        float wa = sin(q.x * 1.3 + uTime * 1.6) * 0.5 + sin(q.y * 1.7 - uTime * 1.3) * 0.5 + sin((q.x + q.y) * 2.3 + uTime * 2.1) * 0.35;
        float wb = cos(q.x * 1.1 - uTime * 1.2) * 0.5 + cos(q.y * 1.9 + uTime * 1.5) * 0.5;
        normal = normalize(normal + vec3(wa, 0.0, wb) * 0.09);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sparkle = pow(max(0.0, sin(vWp.x * 7.0 + uTime * 2.0) * sin(vWp.z * 6.3 - uTime * 1.7)), 12.0);
        diffuseColor.rgb += sparkle * 0.35;`);
  };
  m.customProgramCacheKey = () => 'towns-water';
  return m;
}

function lavaMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: '#ff5a14', emissiveIntensity: 1.6 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; varying vec3 vWp;
        float lh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float ln(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(lh(i), lh(i + vec2(1, 0)), f.x), mix(lh(i + vec2(0, 1)), lh(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec2 lp = vWp.xz * 0.9;
        float n = ln(lp + vec2(uTime * 0.35, uTime * 0.12)) * 0.6 + ln(lp * 2.3 - vec2(uTime * 0.2, 0.0)) * 0.4;
        float crust = smoothstep(0.62, 0.8, n);
        totalEmissiveRadiance *= mix(1.35, 0.25, crust) * (0.85 + 0.15 * sin(uTime * 2.0 + vWp.x));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.03, 0.03), crust);`);
  };
  m.customProgramCacheKey = () => 'towns-lava';
  return m;
}

function groundMaterial(tex: { map: THREE.Texture; normal: THREE.Texture }, off = -2) {
  return new THREE.MeshStandardMaterial({
    vertexColors: true, map: tex.map, normalMap: tex.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.93,
    polygonOffset: true, polygonOffsetFactor: off, polygonOffsetUnits: off * 2,
  });
}

// ── Procedural ground textures (stylised cobbles + planks) ──────────────────────────────────
let paveTex: { map: THREE.Texture; normal: THREE.Texture } | null = null;
let plankTex: { map: THREE.Texture; normal: THREE.Texture } | null = null;

function heightToNormal(h: Float32Array, S: number, strength: number) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const l = h[y * S + ((x - 1 + S) % S)], r = h[y * S + ((x + 1) % S)];
    const u = h[((y - 1 + S) % S) * S + x], d = h[((y + 1) % S) * S + x];
    let nx = (l - r) * strength, ny = (u - d) * strength;
    const nz = 1;
    const len = Math.hypot(nx, ny, nz);
    nx /= len; ny /= len;
    const o = (y * S + x) * 4;
    img.data[o] = (nx * 0.5 + 0.5) * 255; img.data[o + 1] = (ny * 0.5 + 0.5) * 255; img.data[o + 2] = (nz / len * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function finishTex(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Rounded cobbles (jittered-grid Voronoi), light grey so vertex colours tint them per town. */
export function paveTextures() {
  if (paveTex) return paveTex;
  const S = 512, N = 11; // N×N cells per tile → one tile covers 4 m, stones ~36 cm
  const r = rng(91);
  const pts: [number, number, number][] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const row = j % 2 ? 0.5 : 0;
    pts.push([(i + row + 0.2 + r() * 0.6) / N, (j + 0.2 + r() * 0.6) / N, 0.82 + r() * 0.3]);
  }
  const h = new Float32Array(S * S);
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const ci = Math.floor(u * N), cj = Math.floor(v * N);
    let d1 = 9, d2 = 9, tone = 1;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = (ci + di + N) % N, jj = (cj + dj + N) % N;
      const p = pts[jj * N + ii];
      // wrap-aware position of the neighbour's point (the tile repeats seamlessly)
      const wx = p[0] + Math.floor((ci + di) / N), wy = p[1] + Math.floor((cj + dj) / N);
      const d = Math.hypot(u - wx, (v - wy) * 1.15);
      if (d < d1) { d2 = d1; d1 = d; tone = p[2]; } else if (d < d2) d2 = d;
    }
    const edge = (d2 - d1) * N; // 0 at the grout line
    const stone = THREE.MathUtils.smoothstep(edge, 0.04, 0.2);
    const dome = Math.sqrt(Math.max(0, 1 - (d1 * N * 1.25) ** 2));
    const grain = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
    const height = stone * (0.55 + dome * 0.45) + grain * 0.02;
    h[y * S + x] = height;
    const base = 150 + 70 * tone * (0.75 + 0.25 * dome);
    const lum = THREE.MathUtils.lerp(78, base, stone) + grain * 10;
    const o = (y * S + x) * 4;
    img.data[o] = lum; img.data[o + 1] = lum * 0.98; img.data[o + 2] = lum * 0.95; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  paveTex = { map: finishTex(c), normal: heightToNormal(h, S, 3.2) };
  return paveTex;
}

/** Weathered planks (5 boards per tile, nail heads, grain), light so vertex colours tint them. */
export function plankTextures() {
  if (plankTex) return plankTex;
  const S = 512, BOARDS = 5;
  const r = rng(77);
  const tones = Array.from({ length: BOARDS * 3 }, () => 0.82 + r() * 0.26);
  const breaks = Array.from({ length: BOARDS }, () => r());
  const h = new Float32Array(S * S);
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const bw = S / BOARDS;
    const b = Math.floor(x / bw);
    const fx = (x % bw) / bw;
    const seg = (y / S + breaks[b]) % 1 < 0.5 ? 0 : 1;
    const tone = tones[b * 3 + seg];
    const gap = Math.min(fx, 1 - fx) < 0.035 ? 0 : 1;
    const endGap = Math.abs(((y / S + breaks[b]) % 0.5) - 0.0) < 0.006 ? 0 : 1;
    const grain = Math.sin((y / S) * 90 + Math.sin(fx * 9 + b) * 2.2 + b * 7) * 0.5 + 0.5;
    const nail = (Math.hypot(fx - 0.5, (((y / S + breaks[b]) % 0.5) - 0.035) * 2.5) < 0.05) ? 1 : 0;
    const k = gap * endGap;
    h[y * S + x] = k * (0.8 + grain * 0.12) - nail * 0.2;
    const lum = k ? (150 + 55 * tone + grain * 18 - nail * 60) : 60;
    const o = (y * S + x) * 4;
    img.data[o] = lum; img.data[o + 1] = lum * 0.93; img.data[o + 2] = lum * 0.85; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  plankTex = { map: finishTex(c), normal: heightToNormal(h, S, 2.4) };
  return plankTex;
}

// ── Sign atlas: every shop board and town sign in one texture ──────────────────────────────
interface SignReq { text: string; sub?: string; icon?: string; bg: string; fg: string; accent: string; w: number; h: number; x: number; y: number }
let atlas: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; reqs: SignReq[]; cx: number; cy: number; rowH: number } | null = null;
const ATLAS_W = 2048, ATLAS_H = 2048;

export function signAtlas() {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W; canvas.height = ATLAS_H;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  atlas = { canvas, tex, reqs: [], cx: 0, cy: 0, rowH: 0 };
  // redraw once the display fonts are in (canvas text falls back to a system serif until then)
  void document.fonts?.ready.then(() => { drawAtlas(); });
  return atlas;
}

function drawSign(g: CanvasRenderingContext2D, s: SignReq) {
  const { x, y, w, h } = s;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = s.bg; g.fillRect(x, y, w, h);
  // wood grain / weathering
  g.globalAlpha = 0.12;
  for (let i = 0; i < 9; i++) { g.fillStyle = i % 2 ? '#000' : '#fff'; g.fillRect(x, y + (h / 9) * i, w, 2); }
  g.globalAlpha = 1;
  g.strokeStyle = s.accent; g.lineWidth = Math.max(4, h * 0.06);
  g.strokeRect(x + h * 0.08, y + h * 0.08, w - h * 0.16, h - h * 0.16);
  let tx = x + w / 2;
  const iconSize = h * 0.56;
  if (s.icon) {
    const ix = x + h * 0.52;
    g.fillStyle = s.accent;
    g.beginPath(); g.arc(ix, y + h / 2, iconSize * 0.62, 0, Math.PI * 2); g.fill();
    g.fillStyle = s.bg;
    g.font = `700 ${Math.round(iconSize * 0.78)}px "Segoe UI Symbol", "Apple Symbols", serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(s.icon, ix, y + h / 2 + iconSize * 0.04);
    tx = x + h * 0.95 + (w - h * 1.05) / 2;
  }
  g.fillStyle = s.fg;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const maxW = s.icon ? w - h * 1.2 : w - h * 0.4;
  let size = Math.round(h * (s.sub ? 0.36 : 0.46));
  g.font = `700 ${size}px Cinzel, Georgia, serif`;
  while (g.measureText(s.text).width > maxW && size > 10) { size -= 2; g.font = `700 ${size}px Cinzel, Georgia, serif`; }
  g.fillText(s.text, tx, y + h * (s.sub ? 0.4 : 0.52));
  if (s.sub) {
    let ss = Math.round(h * 0.2);
    g.font = `italic 500 ${ss}px "Cormorant Garamond", Georgia, serif`;
    while (g.measureText(s.sub).width > maxW && ss > 8) { ss -= 1; g.font = `italic 500 ${ss}px "Cormorant Garamond", Georgia, serif`; }
    g.globalAlpha = 0.85;
    g.fillText(s.sub, tx, y + h * 0.74);
    g.globalAlpha = 1;
  }
  g.restore();
}

function drawAtlas() {
  if (!atlas) return;
  const g = atlas.canvas.getContext('2d')!;
  g.clearRect(0, 0, ATLAS_W, ATLAS_H);
  for (const s of atlas.reqs) drawSign(g, s);
  atlas.tex.needsUpdate = true;
}

/** Reserve a sign in the atlas; returns its UV rectangle [u0, v0, u1, v1]. */
export function signRect(text: string, opts: { sub?: string; icon?: string; bg?: string; fg?: string; accent?: string; aspect?: number } = {}): [number, number, number, number] {
  const a = signAtlas();
  const h = 96;
  const w = Math.round(h * (opts.aspect ?? 3.4));
  if (a.cx + w > ATLAS_W) { a.cx = 0; a.cy += a.rowH + 4; a.rowH = 0; }
  if (a.cy + h > ATLAS_H) return [0, 0, 0.01, 0.01];
  const req: SignReq = { text, sub: opts.sub, icon: opts.icon, bg: opts.bg ?? '#3a2618', fg: opts.fg ?? '#f6e7c4', accent: opts.accent ?? '#d9b25f', w, h, x: a.cx, y: a.cy };
  a.reqs.push(req);
  a.cx += w + 4;
  a.rowH = Math.max(a.rowH, h);
  drawSign(a.canvas.getContext('2d')!, req);
  a.tex.needsUpdate = true;
  return [req.x / ATLAS_W, 1 - (req.y + h) / ATLAS_H, (req.x + w) / ATLAS_W, 1 - req.y / ATLAS_H];
}

// ── Builder ─────────────────────────────────────────────────────────────────────────────────
class Geo {
  p: number[] = []; n: number[] = []; c: number[] = []; u: number[] = []; i: number[] = [];
  get count() { return this.p.length / 3; }
}

export interface AddOpts {
  /** Brightness multiplier at the template's bottom / top (fake ambient occlusion). */
  shade?: [number, number];
  /** UV rectangle to remap the template's 0..1 UVs into (atlas lookups). */
  uvRect?: [number, number, number, number];
  /** Planar world UVs (x/z × scale) instead of template UVs (ground buckets). */
  planar?: number;
}

const _m = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export class Builder {
  geos = new Map<string, Geo>();
  /** Material override per bucket key (GLB atlas buckets). */
  bucketMats = new Map<string, THREE.Material>();
  m = new THREE.Matrix4();
  private stack: THREE.Matrix4[] = [];

  push() { this.stack.push(this.m.clone()); return this; }
  pop() { this.m.copy(this.stack.pop()!); return this; }
  translate(x: number, y: number, z: number) { this.m.multiply(_m.makeTranslation(x, y, z)); return this; }
  rotY(a: number) { if (a) this.m.multiply(_m.makeRotationY(a)); return this; }
  rotX(a: number) { if (a) this.m.multiply(_m.makeRotationX(a)); return this; }
  rotZ(a: number) { if (a) this.m.multiply(_m.makeRotationZ(a)); return this; }
  scale(x: number, y = x, z = x) { this.m.multiply(_m.makeScale(x, y, z)); return this; }
  /** Run `fn` inside a pushed transform. */
  at(x: number, y: number, z: number, rotY: number, fn: () => void) { this.push().translate(x, y, z).rotY(rotY); fn(); this.pop(); return this; }

  private geo(key: string) {
    let g = this.geos.get(key);
    if (!g) { g = new Geo(); this.geos.set(key, g); }
    return g;
  }

  /** Append a template with local transform L (applied after the current matrix). */
  add(bucket: string, t: Tmpl, L: THREE.Matrix4, color: Col, o: AddOpts = {}) {
    const g = this.geo(bucket);
    const M = _m.multiplyMatrices(this.m, L);
    _nm.getNormalMatrix(M);
    const base = g.count;
    const cl = col(color);
    const [sb, st] = o.shade ?? [1, 1];
    const span = t.y1 - t.y0 || 1;
    const e = M.elements;
    for (let k = 0; k < t.pos.length; k += 3) {
      const x = t.pos[k], y = t.pos[k + 1], z = t.pos[k + 2];
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      g.p.push(wx, wy, wz);
      _v.set(t.nor[k], t.nor[k + 1], t.nor[k + 2]).applyMatrix3(_nm).normalize();
      g.n.push(_v.x, _v.y, _v.z);
      const f = sb + (st - sb) * ((y - t.y0) / span);
      g.c.push(cl.r * f, cl.g * f, cl.b * f);
      const vi = (k / 3) * 2;
      if (o.planar) g.u.push(wx * o.planar, wz * o.planar);
      else if (o.uvRect) { const [u0, v0, u1, v1] = o.uvRect; g.u.push(u0 + t.uv[vi] * (u1 - u0), v0 + t.uv[vi + 1] * (v1 - v0)); }
      else g.u.push(t.uv[vi], t.uv[vi + 1]);
    }
    for (let k = 0; k < t.idx.length; k++) g.i.push(base + t.idx[k]);
    return this;
  }

  /** Box centred at (x, y, z) with size (w, h, d), optional Euler rotation. */
  box(bucket: string, x: number, y: number, z: number, w: number, h: number, d: number, color: Col, o: AddOpts & { rx?: number; ry?: number; rz?: number } = {}) {
    return this.add(bucket, T.box(), mat(x, y, z, w, h, d, o.rx, o.ry, o.rz), color, o);
  }
  /** Box standing on y0 (bottom face at y0). */
  block(bucket: string, x: number, y0: number, z: number, w: number, h: number, d: number, color: Col, o: AddOpts & { ry?: number } = {}) {
    return this.box(bucket, x, y0 + h / 2, z, w, h, d, color, { shade: [0.8, 1], ...o });
  }
  /** Vertical cylinder standing on y0. */
  cyl(bucket: string, x: number, y0: number, z: number, r: number, h: number, color: Col, o: AddOpts & { sides?: number; top?: number; flat?: boolean; rx?: number; rz?: number; ry?: number } = {}) {
    const t = T.cyl(o.sides ?? 10, o.top ?? 1, o.flat ?? false);
    return this.add(bucket, t, mat(x, y0 + h / 2, z, r, h, r, o.rx, o.ry, o.rz), color, o);
  }
  cone(bucket: string, x: number, y0: number, z: number, r: number, h: number, color: Col, o: AddOpts & { sides?: number; flat?: boolean; ry?: number } = {}) {
    return this.add(bucket, T.cone(o.sides ?? 10, o.flat ?? true), mat(x, y0 + h / 2, z, r, h, r, 0, o.ry ?? 0, 0), color, o);
  }
  sphere(bucket: string, x: number, y: number, z: number, rx: number, ry: number, rz: number, color: Col, o: AddOpts & { w?: number; h?: number; flat?: boolean; rot?: number } = {}) {
    return this.add(bucket, T.sphere(o.w ?? 10, o.h ?? 7, o.flat ?? false), mat(x, y, z, rx, ry, rz, 0, o.rot ?? 0, 0), color, o);
  }
  dome(bucket: string, x: number, y0: number, z: number, r: number, h: number, color: Col, o: AddOpts & { w?: number; h?: number; flat?: boolean } = {}) {
    return this.add(bucket, T.dome(o.w ?? 16, o.h ?? 6, o.flat ?? false), mat(x, y0, z, r, h, r), color, o);
  }
  /** Gable prism: base w (x) × length d (z), apex height h, standing on y0. */
  prism(bucket: string, x: number, y0: number, z: number, w: number, h: number, d: number, color: Col, o: AddOpts & { ry?: number } = {}) {
    return this.add(bucket, T.prism(), mat(x, y0, z, w, h, d, 0, o.ry ?? 0, 0), color, o);
  }
  /** Quad of size w×h centred at (x,y,z) facing +Z (rotate with ry). */
  quad(bucket: string, x: number, y: number, z: number, w: number, h: number, color: Col, o: AddOpts & { rx?: number; ry?: number; rz?: number } = {}) {
    return this.add(bucket, T.quad(), mat(x, y, z, w, h, 1, o.rx, o.ry, o.rz), color, o);
  }
  /** Generic template with position/scale/rotation. */
  shape(bucket: string, t: Tmpl, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: Col, o: AddOpts & { rx?: number; ry?: number; rz?: number } = {}) {
    return this.add(bucket, t, mat(x, y, z, sx, sy, sz, o.rx, o.ry, o.rz), color, o);
  }
  /** Beam between two points (square section). */
  beam(bucket: string, a: [number, number, number], b: [number, number, number], thick: number, color: Col, o: AddOpts & { round?: number } = {}) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return this;
    _v.set(dx / len, dy / len, dz / len);
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v);
    const L = new THREE.Matrix4().compose(_p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(thick, len, thick));
    const t = o.round ? T.cyl(o.round, 1, false) : T.box();
    return this.add(bucket, t, L, color, o);
  }
  /** Lathe (surface of revolution) from [radius, y] profile points. */
  lathe(bucket: string, x: number, y0: number, z: number, profile: [number, number][], color: Col, o: AddOpts & { sides?: number; flat?: boolean } = {}) {
    const key = `lathe:${o.sides ?? 16}:${o.flat ? 1 : 0}:${profile.map((p) => p.join(',')).join(';')}`;
    const t = cached(key, () => fromGeometry(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), o.sides ?? 16), o.flat));
    return this.add(bucket, t, mat(x, y0, z, 1, 1, 1), color, o);
  }
  /** Tube along a Catmull-Rom curve through points. */
  tubeAlong(bucket: string, pts: [number, number, number][], radius: number, color: Col, o: AddOpts & { sides?: number; segs?: number; taper?: number } = {}) {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    const g = new THREE.TubeGeometry(curve, o.segs ?? Math.max(4, pts.length * 4), radius, o.sides ?? 6, false);
    if (o.taper !== undefined) {
      // shrink toward the end
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      const segs = o.segs ?? Math.max(4, pts.length * 4);
      const ring = (o.sides ?? 6) + 1;
      for (let s = 0; s <= segs; s++) {
        const k = 1 - (s / segs) * (1 - o.taper);
        const c = curve.getPointAt(s / segs);
        for (let r = 0; r < ring; r++) {
          const vi = s * ring + r;
          pos.setXYZ(vi, c.x + (pos.getX(vi) - c.x) * k, c.y + (pos.getY(vi) - c.y) * k, c.z + (pos.getZ(vi) - c.z) * k);
        }
      }
      g.computeVertexNormals();
    }
    return this.add(bucket, fromGeometry(g), new THREE.Matrix4(), color, o);
  }
  /** Extruded 2D shape (XY) with depth along Z, centred on z. */
  extrude(bucket: string, shape: THREE.Shape, depth: number, color: Col, o: AddOpts & { x?: number; y?: number; z?: number; ry?: number; bevel?: number; curveSegs?: number } = {}) {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: !!o.bevel, bevelSize: o.bevel ?? 0, bevelThickness: o.bevel ?? 0, bevelSegments: 1, curveSegments: o.curveSegs ?? 8 });
    g.translate(0, 0, -depth / 2);
    return this.add(bucket, fromGeometry(g), mat(o.x ?? 0, o.y ?? 0, o.z ?? 0, 1, 1, 1, 0, o.ry ?? 0, 0), color, o);
  }

  /** Raw triangles already in the current frame (ground ribbons). pos: xyz triples, idx: triangles. */
  raw(bucket: string, pos: number[], idx: number[], color: Col | ((x: number, y: number, z: number) => THREE.Color), o: { planar?: number; nor?: number[]; uv?: number[] } = {}) {
    const g = this.geo(bucket);
    const base = g.count;
    const e = this.m.elements;
    _nm.getNormalMatrix(this.m);
    for (let k = 0; k < pos.length; k += 3) {
      const x = pos[k], y = pos[k + 1], z = pos[k + 2];
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      g.p.push(wx, wy, wz);
      const c = typeof color === 'function' ? color(x, y, z) : col(color);
      g.c.push(c.r, c.g, c.b);
      if (o.uv) g.u.push(o.uv[(k / 3) * 2], o.uv[(k / 3) * 2 + 1]);
      else g.u.push(wx * (o.planar ?? 0.25), wz * (o.planar ?? 0.25));
      if (o.nor) { _v.set(o.nor[k], o.nor[k + 1], o.nor[k + 2]).applyMatrix3(_nm).normalize(); g.n.push(_v.x, _v.y, _v.z); }
      else g.n.push(0, 1, 0);
    }
    for (const i of idx) g.i.push(base + i);
    if (!o.nor) this.recomputeNormals(g, base, g.i.length - idx.length);
    return this;
  }

  private recomputeNormals(g: Geo, vStart: number, iStart: number) {
    const acc = new Float32Array((g.count - vStart) * 3);
    for (let k = iStart; k < g.i.length; k += 3) {
      const a = g.i[k], b = g.i[k + 1], c = g.i[k + 2];
      const ax = g.p[a * 3], ay = g.p[a * 3 + 1], az = g.p[a * 3 + 2];
      const bx = g.p[b * 3] - ax, by = g.p[b * 3 + 1] - ay, bz = g.p[b * 3 + 2] - az;
      const cx = g.p[c * 3] - ax, cy = g.p[c * 3 + 1] - ay, cz = g.p[c * 3 + 2] - az;
      const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
      for (const v of [a, b, c]) { const o = (v - vStart) * 3; acc[o] += nx; acc[o + 1] += ny; acc[o + 2] += nz; }
    }
    for (let v = 0; v < acc.length; v += 3) {
      let nx = acc[v], ny = acc[v + 1], nz = acc[v + 2];
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const o = (vStart * 3) + v;
      g.n[o] = nx; g.n[o + 1] = ny; g.n[o + 2] = nz;
    }
  }

  /** Bake a (cloned) GLB object into atlas buckets. Meshes sharing a texture image share a bucket. */
  glb(obj: THREE.Object3D, x: number, y: number, z: number, rotY = 0, s = 1) {
    obj.updateMatrixWorld(true);
    const L = new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(0, rotY, 0)), _s.set(s, s, s));
    const W = new THREE.Matrix4().multiplyMatrices(this.m, L);
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mt = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
      const bucketKey = mt.map ? `glb:${atlasKey(mt)}` : `glbc:${mt.color.getHexString()}`;
      if (!this.bucketMats.has(bucketKey)) this.bucketMats.set(bucketKey, glbMaterial(bucketKey, mt));
      const M = new THREE.Matrix4().multiplyMatrices(W, mesh.matrixWorld);
      appendGeometry(this.geo(bucketKey), mesh.geometry, M);
    });
    return this;
  }

  /** Merge every bucket into meshes. `shadows` lists buckets that cast shadows. */
  build(name: string, shadows = new Set<string>(['solid', 'metal', 'cloth', 'leaf', 'kay', 'ken'])): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    for (const [key, g] of this.geos) {
      if (!g.i.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.n, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(g.c, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.u, 2));
      geo.setIndex(g.count > 65535 ? new THREE.Uint32BufferAttribute(g.i, 1) : new THREE.Uint16BufferAttribute(g.i, 1));
      geo.computeBoundingSphere();
      const material = this.bucketMats.get(key) ?? materialFor(key);
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = `${name}:${key}`;
      const glbShadow = key.startsWith('glb') && !key.includes('water');
      mesh.castShadow = shadows.has(key) || glbShadow;
      mesh.receiveShadow = true;
      if (key === 'water') mesh.renderOrder = 2;
      group.add(mesh);
    }
    return group;
  }

  /** Vertex count so far (all buckets). */
  get vertexCount() { let n = 0; for (const g of this.geos.values()) n += g.count; return n; }
}

function materialFor(key: string): THREE.Material {
  return material(key as BucketId);
}

function atlasKey(mt: THREE.MeshStandardMaterial) {
  const img = mt.map?.image as { width?: number; height?: number; src?: string } | undefined;
  // KayKit props share hexagons_medieval, Kenney props share colormap: identify by material name + size
  return `${mt.name || 'mat'}:${img?.width ?? 0}x${img?.height ?? 0}`;
}

function glbMaterial(key: string, src: THREE.MeshStandardMaterial) {
  const cached = glbMats.get(key);
  if (cached) return cached;
  const m = new THREE.MeshStandardMaterial({ map: src.map ?? null, color: src.map ? '#ffffff' : src.color, roughness: 0.82, metalness: 0, vertexColors: true });
  if (m.map) { m.map.anisotropy = 4; }
  m.name = `towns-${key}`;
  glbMats.set(key, m);
  return m;
}

function appendGeometry(g: Geo, geo: THREE.BufferGeometry, M: THREE.Matrix4) {
  const p = geo.getAttribute('position');
  const n = geo.getAttribute('normal');
  const u = geo.getAttribute('uv');
  const vc = geo.getAttribute('color');
  _nm.getNormalMatrix(M);
  const base = g.count;
  for (let i = 0; i < p.count; i++) {
    _v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(M);
    g.p.push(_v.x, _v.y, _v.z);
    if (n) { _v.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(_nm).normalize(); g.n.push(_v.x, _v.y, _v.z); } else g.n.push(0, 1, 0);
    if (u) g.u.push(u.getX(i), u.getY(i)); else g.u.push(0, 0);
    if (vc) g.c.push(vc.getX(i), vc.getY(i), vc.getZ(i)); else g.c.push(1, 1, 1);
  }
  if (geo.index) for (let i = 0; i < geo.index.count; i++) g.i.push(base + geo.index.getX(i));
  else for (let i = 0; i < p.count; i++) g.i.push(base + i);
}

function mat(x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ');
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz));
}

/** Materials created so far (for disposal/debug). */
export function allMaterials() { return [...Object.values(mats), ...glbMats.values()]; }
export function resetMaterials() { mats = {}; glbMats.clear(); }
