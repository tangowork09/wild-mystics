import * as THREE from 'three';
import { WORLD_SIZE, WATER_LEVEL } from '../../data/zones';
import { mulberry32, clamp } from '../../core/noise';
import { Ecology, LAND_ECO } from './ecology';
import type { ProtoLib, Proto } from './protos';
import { speciesDef, type SpeciesDef, type SpeciesKey, type Habitat } from './species';

// Deterministic placement. Trees (and big outcrops) are placed once for the whole island so the
// impostor far-field and colliders are complete; ground cover is generated per chunk on demand.

export interface VegInst {
  sp: SpeciesKey; def: SpeciesDef; proto: Proto;
  x: number; y: number; z: number; rot: number; tiltX: number; tiltZ: number; scale: number; stretch: number;
  leaf: THREE.Color; body: THREE.Color; snow: number; glow: number; seed: number;
}

const HALF = WORLD_SIZE / 2;
const WHITE = '#ffffff';
const tick = () => new Promise((r) => setTimeout(r, 0));
const sstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function pick<T extends string>(mix: [T, number][], r: number): T {
  let total = 0;
  for (const [, w] of mix) total += w;
  let x = r * total;
  for (const [k, w] of mix) { x -= w; if (x <= 0) return k; }
  return mix[mix.length - 1][0];
}

const _hsl = { h: 0, s: 0, l: 0 };
function tintFrom(palette: string[] | undefined, rng: () => number): THREE.Color {
  const c = new THREE.Color(palette?.length ? palette[Math.floor(rng() * palette.length)] : WHITE);
  if (palette?.length) {
    c.getHSL(_hsl);
    c.setHSL(_hsl.h + (rng() - 0.5) * 0.025, clamp(_hsl.s * (0.9 + rng() * 0.2), 0, 1), clamp(_hsl.l * (0.92 + rng() * 0.16), 0, 1));
  }
  return c;
}

export function makeInst(lib: ProtoLib, eco: Ecology, sp: SpeciesKey, x: number, z: number, rng: () => number, scaleK = 1): VegInst | null {
  const def = speciesDef(sp);
  let protos = lib.family(def.family);
  if (def.variants) protos = def.variants.map((v) => protos[v]).filter(Boolean);
  if (!protos.length) return null;
  const proto = protos[Math.floor(rng() * protos.length)];
  const scale = (def.scale[0] + rng() * (def.scale[1] - def.scale[0])) * scaleK;
  const h = eco.data.heightAt(x, z);
  const tilt = def.tilt ?? 0;
  const leaf = tintFrom(def.leaf ?? def.body, rng);
  const body = def.body ? tintFrom(def.body, rng) : new THREE.Color(1, 1, 1);
  // the high mountain dusts everything with snow
  const alpine = sstep(150, 200, h) * 0.9;
  return {
    sp, def, proto, x, z, y: h - (def.sink ?? 0.06) * scale,
    rot: rng() * Math.PI * 2, tiltX: (rng() - 0.5) * tilt, tiltZ: (rng() - 0.5) * tilt,
    scale, stretch: def.stretch ?? (0.92 + rng() * 0.18),
    leaf, body, snow: Math.max(def.snow ?? 0, alpine), glow: def.glow ?? 0, seed: rng(),
  };
}

/** Whole-island tree layer: clustered forests, groves in the open, lone trees and rocky outcrops. */
export async function scatterTrees(eco: Ecology, lib: ProtoLib, density: number, onProgress?: (f: number) => void): Promise<VegInst[]> {
  const out: VegInst[] = [];
  const rng = mulberry32(20260928);
  const CELL = 5;
  const occ = new Map<number, number>(); // 2.5 m occupancy, holds the trunk radius
  const O = 2.5;
  const okey = (i: number, j: number) => (i + 2048) * 8192 + (j + 2048);
  const free = (x: number, z: number, r: number) => {
    const i0 = Math.floor((x - r) / O), i1 = Math.floor((x + r) / O), j0 = Math.floor((z - r) / O), j1 = Math.floor((z + r) / O);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (occ.has(okey(i, j))) return false;
    return true;
  };
  const mark = (x: number, z: number, r: number) => {
    const i0 = Math.floor((x - r) / O), i1 = Math.floor((x + r) / O), j0 = Math.floor((z - r) / O), j1 = Math.floor((z + r) / O);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) occ.set(okey(i, j), r);
  };
  const d = eco.data;
  const rows = Math.ceil(WORLD_SIZE / CELL);
  for (let row = 0; row < rows; row++) {
    const gz = -HALF + row * CELL;
    for (let gx = -HALF; gx < HALF; gx += CELL) {
      const x = gx + rng() * CELL, z = gz + rng() * CELL;
      const r1 = rng(), r2 = rng(), r3 = rng();
      if (Math.abs(x) > HALF - 20 || Math.abs(z) > HALF - 20) continue;
      const h = d.heightAt(x, z);
      if (!eco.dry(h, 0.9)) continue;
      const land = eco.land(x, z);
      const L = LAND_ECO[land];
      const slope = d.slopeAt(x, z);
      // rocky outcrops on steep ground
      const steep = sstep(0.55, 1.1, slope);
      if (steep > 0 && r1 < L.outcrops[1] * steep * (CELL * CELL / 100)) {
        if (!eco.blocked(x, z, 4) && !eco.onRoad(x, z, 5)) {
          const inst = makeInst(lib, eco, L.outcrops[0], x, z, rng);
          if (inst && free(x, z, inst.def.collider * inst.scale * 0.8)) { mark(x, z, inst.def.collider * inst.scale * 0.8); out.push(inst); }
        }
        continue;
      }
      const f = eco.forest(x, z, land);
      const p = (f * L.density + L.lone) * density;
      if (r2 > p) continue;
      if (eco.blocked(x, z, 3) || eco.onRoad(x, z, 5)) continue;
      const mix = f > 0.35 ? L.trees : (L.open ?? L.trees);
      const sp = pick(mix, r3);
      const def = speciesDef(sp);
      if (slope > def.maxSlope) continue;
      const inst = makeInst(lib, eco, sp, x, z, rng, f > 0.35 ? 1 : 0.95 + rng() * 0.15);
      if (!inst) continue;
      const rad = (def.spacing ?? 2.5) * inst.scale * 0.5;
      if (!free(x, z, rad)) continue;
      mark(x, z, rad);
      out.push(inst);
    }
    if (row % 24 === 0) { onProgress?.(row / rows); await tick(); }
  }
  return out;
}

/** Ground cover for one chunk: bushes, ferns, flowers, mushrooms, rocks, reeds, logs, tufts. */
export function scatterCover(eco: Ecology, lib: ProtoLib, cx: number, cz: number, size: number, density: number): VegInst[] {
  const out: VegInst[] = [];
  const rng = mulberry32((((cx + 1000) * 73856093) ^ ((cz + 1000) * 19349663)) >>> 0);
  const CELL = 2.4;
  const n = Math.round(size / CELL);
  const d = eco.data;
  const area = CELL * CELL / 100;
  const hab: Record<Habitat, number> = { forest: 0, edge: 0, meadow: 0, slope: 0, shore: 0, any: 1, open: 0 };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = cx * size + (i + rng()) * CELL, z = cz * size + (j + rng()) * CELL;
      const r = rng();
      const h = d.heightAt(x, z);
      if (h < WATER_LEVEL - 0.3) continue;
      const land = eco.land(x, z);
      const L = LAND_ECO[land];
      const slope = d.slopeAt(x, z);
      const f = eco.forest(x, z, land);
      hab.forest = f;
      hab.edge = 4 * f * (1 - f) + (f > 0.2 && f < 0.9 ? 0.2 : 0);
      hab.meadow = d.grassAt(x, z) * (1 - f);
      hab.slope = sstep(0.4, 1.0, slope);
      hab.shore = clamp(1 - Math.abs(h - (WATER_LEVEL + 0.15)) / 0.75, 0, 1) * (slope < 0.5 ? 1 : 0.3);
      hab.open = 1 - f;
      let x0 = r;
      for (const [sp, dens, habitat] of L.cover) {
        let hv = hab[habitat];
        if (sp === 'flowers') hv *= eco.patch(x, z, 0.028, 3) * 1.8;
        const p = dens * area * hv * density;
        if (x0 >= p) { x0 -= p; continue; }
        const def = speciesDef(sp);
        if (slope > def.maxSlope) break;
        const wet = sp === 'reeds';
        if (!wet && !eco.dry(h, 0.35)) break;
        if (wet && h > WATER_LEVEL + 0.9) break;
        if (eco.blocked(x, z, 1) || eco.onRoad(x, z, def.collider > 0 ? 2.5 : 1.2)) break;
        const inst = makeInst(lib, eco, sp, x, z, rng);
        if (inst) out.push(inst);
        break;
      }
    }
  }
  return out;
}
