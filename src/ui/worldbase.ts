// Shared map imagery for the minimap and the world map: the painted map from the terrain workstream
// (public/world/map.webp) when it exists, otherwise a relief built from world.data.colorMap; and the
// fog-of-war layer (a soft cloud bank cut away wherever api.world.explored() says you have been).
import { api, EXPLORE_RES } from '../game/contracts';
import { WORLD_SIZE, WATER_LEVEL } from '../data/zones';
import type { Overworld } from '../world/world';

const BASE = 1024;
let base: HTMLCanvasElement | null = null;
let painted = false;
const listeners = new Set<() => void>();

/** One canvas for the whole session; its pixels are replaced in place when the painted map arrives. */
export function worldBase(world: Overworld): HTMLCanvasElement {
  if (base) return base;
  base = document.createElement('canvas');
  base.width = base.height = BASE;
  drawRelief(world, base);
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    if (!img.naturalWidth || !base) return;
    const g = base.getContext('2d')!;
    g.clearRect(0, 0, BASE, BASE);
    g.drawImage(img, 0, 0, BASE, BASE);
    painted = true;
    listeners.forEach((f) => f());
  };
  img.src = 'world/map.webp';
  return base;
}
export const basePainted = () => painted;
export function onBaseChange(f: () => void) { listeners.add(f); return () => listeners.delete(f); }

/** Colour map × hillshade, with water and lava recoloured (fallback until the painted map ships). */
function drawRelief(world: Overworld, cv: HTMLCanvasElement) {
  const g = cv.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(world.data.colorMap, 0, 0, BASE, BASE);
  const S = 512;
  const shade = document.createElement('canvas');
  shade.width = shade.height = S;
  const sg = shade.getContext('2d')!;
  const img = sg.createImageData(S, S);
  const H = WORLD_SIZE / 2;
  const step = WORLD_SIZE / S;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const wx = -H + (x + 0.5) * step, wz = -H + (y + 0.5) * step;
      const h = world.data.heightAt(wx, wz);
      const o = (y * S + x) * 4;
      if (h < WATER_LEVEL) {
        const lava = world.data.lavaAt(wx, wz) > 0.5;
        const d = Math.min(1, (WATER_LEVEL - h) / 5);
        if (lava) { img.data[o] = 246 - d * 40; img.data[o + 1] = 104 - d * 40; img.data[o + 2] = 44; }
        else { img.data[o] = 58 - d * 30; img.data[o + 1] = 150 - d * 50; img.data[o + 2] = 198 - d * 40; }
        img.data[o + 3] = 235;
        continue;
      }
      const hx = world.data.heightAt(wx + step, wz) - h;
      const hz = world.data.heightAt(wx, wz + step) - h;
      const lit = Math.max(-1, Math.min(1, ((hx * 0.8 + hz * 0.6) / step) * 1.6));
      const v = lit > 0 ? 255 : 0;
      img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v;
      img.data[o + 3] = Math.min(150, Math.abs(lit) * 190);
    }
  }
  sg.putImageData(img, 0, 0);
  g.globalCompositeOperation = 'soft-light';
  g.drawImage(shade, 0, 0, BASE, BASE);
  g.globalCompositeOperation = 'source-over';
  // water pixels were written opaque-ish in the shade layer's colour channels: lay them down plainly
  const water = document.createElement('canvas');
  water.width = water.height = S;
  const wg = water.getContext('2d')!;
  const wimg = wg.createImageData(S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 235) { wimg.data[i] = img.data[i]; wimg.data[i + 1] = img.data[i + 1]; wimg.data[i + 2] = img.data[i + 2]; wimg.data[i + 3] = 255; }
  }
  wg.putImageData(wimg, 0, 0);
  g.drawImage(water, 0, 0, BASE, BASE);
}

// ── Fog of war ─────────────────────────────────────────────────────────────
const FOG = 512;
let fog: HTMLCanvasElement | null = null;
let fogVersion = -1;
let fogAll = false;
let cloud: HTMLCanvasElement | null = null;

/** The fog layer (null when everything is explored). Rebuilt only when the world version changes. */
export function fogLayer(): HTMLCanvasElement | null {
  let v = 0;
  let bits: Uint8Array;
  try { v = api.world.version(); bits = api.world.explored(); } catch { return null; }
  if (fog && v === fogVersion) return fogAll ? null : fog;
  fogVersion = v;
  let any = false;
  for (let i = 0; i < bits.length; i++) if (!bits[i]) { any = true; break; }
  fogAll = !any;
  if (!any) return null;
  fog ??= document.createElement('canvas');
  fog.width = fog.height = FOG;
  const g = fog.getContext('2d')!;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, FOG, FOG);
  g.drawImage(cloudTexture(), 0, 0);
  // explored cells punch through the cloud bank with soft, blurred edges
  const m = document.createElement('canvas');
  m.width = m.height = EXPLORE_RES;
  const mg = m.getContext('2d')!;
  const mi = mg.createImageData(EXPLORE_RES, EXPLORE_RES);
  for (let i = 0; i < bits.length; i++) if (bits[i]) { mi.data[i * 4 + 3] = 255; }
  mg.putImageData(mi, 0, 0);
  g.globalCompositeOperation = 'destination-out';
  g.imageSmoothingEnabled = true;
  if ('filter' in g) g.filter = 'blur(7px)';
  g.drawImage(m, 0, 0, FOG, FOG);
  if ('filter' in g) g.filter = 'none';
  g.globalCompositeOperation = 'source-over';
  return fog;
}

/** Painterly cloud bank: layered value noise in cool cabinet greys with pale crests. */
function cloudTexture(): HTMLCanvasElement {
  if (cloud) return cloud;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  const rnd = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = rnd(xi, yi), b = rnd(xi + 1, yi), cc = rnd(xi, yi + 1), d = rnd(xi + 1, yi + 1);
    return a + (b - a) * u + (cc - a) * v + (a - b - cc + d) * u * v;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let n = 0, amp = 0.55, f = 1 / 32;
      for (let o = 0; o < 4; o++) { n += noise(x * f, y * f) * amp; amp *= 0.5; f *= 2; }
      const t = Math.max(0, Math.min(1, (n - 0.25) / 0.6));
      const crest = Math.max(0, t - 0.72) * 3.2;
      const o = (y * S + x) * 4;
      img.data[o] = 26 + t * 52 + crest * 90;
      img.data[o + 1] = 31 + t * 56 + crest * 88;
      img.data[o + 2] = 43 + t * 66 + crest * 80;
      img.data[o + 3] = 246;
    }
  }
  g.putImageData(img, 0, 0);
  cloud = document.createElement('canvas');
  cloud.width = cloud.height = FOG;
  const cg = cloud.getContext('2d')!;
  cg.imageSmoothingQuality = 'high';
  cg.drawImage(c, 0, 0, FOG, FOG);
  return cloud;
}

/** World (x,z) → fraction of the map square (0..1). */
export const mapFrac = (v: number) => (v + WORLD_SIZE / 2) / WORLD_SIZE;
