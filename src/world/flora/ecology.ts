import { ZONES, WORLD_SIZE, WATER_LEVEL } from '../../data/zones';
import { GATES, DUNGEONS, POIS } from '../../data/layout';
import { makeNoise2D, fbm, clamp } from '../../core/noise';
import { FEATURES, type TerrainData } from '../terrain';
import { LANDS, type LandEco } from './species';

// Samples the world for the scatter: which land a point belongs to (organic borders), how forested
// it is, and whether anything built-up (roads, plazas, towns, gates, dungeon mouths, POIs) or water
// is in the way. Uses only the TerrainData sampling API, plus `forestAt` / `regionAt` when the baked
// terrain provides them.

type Sampler = TerrainData & {
  forestAt?: (x: number, z: number) => number;
  regionAt?: (x: number, z: number) => string | number | null | undefined;
};

interface Blocker { x: number; z: number; r: number }

export const HALF = WORLD_SIZE / 2;
const ZONE_IDX = new Map(ZONES.map((z, i) => [z.id, i]));
export const LAND_ECO: LandEco[] = ZONES.map((z) => LANDS[z.id] ?? LANDS.vale);

/** Standard normal quantile (Acklam), used to turn forest cover into a noise threshold. */
function probit(p: number) {
  p = clamp(p, 1e-4, 1 - 1e-4);
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export class Ecology {
  readonly lands = ZONES.length;
  private cx = new Float32Array(ZONES.map((z) => z.center[0]));
  private cz = new Float32Array(ZONES.map((z) => z.center[1]));
  private warp = makeNoise2D(3141);
  private nForest = makeNoise2D(4711);
  private nGrove = makeNoise2D(1913);
  private nPatch = makeNoise2D(8231);
  private thr: Float32Array;
  private blockGrid = new Map<number, Blocker[]>();

  constructor(readonly data: Sampler) {
    // fbm of simplex noise is roughly N(0, 0.22): the threshold that leaves `forest` of the land wooded
    this.thr = new Float32Array(LAND_ECO.map((l) => probit(1 - l.forest) * 0.284));
    const add = (x: number, z: number, r: number) => {
      const b = { x, z, r };
      for (let gx = Math.floor((x - r) / 64); gx <= Math.floor((x + r) / 64); gx++) {
        for (let gz = Math.floor((z - r) / 64); gz <= Math.floor((z + r) / 64); gz++) {
          const k = gx * 4096 + gz;
          let l = this.blockGrid.get(k);
          if (!l) { l = []; this.blockGrid.set(k, l); }
          l.push(b);
        }
      }
    };
    for (const f of FEATURES) add(f.x, f.z, f.r + (f.kind === 'town' || f.kind === 'outpost' ? 6 : 3));
    for (const g of GATES) add(g.pos[0], g.pos[1], 16);
    for (const d of DUNGEONS) add(d.entrance[0], d.entrance[1], 10);
    for (const p of POIS) add(p.pos[0], p.pos[1], p.kind === 'grove' ? 5 : 9);
  }

  /** Nearest land by centre, with the border warped by noise so lands interleave organically. */
  land(x: number, z: number, warp = true): number {
    const r = this.data.regionAt?.(x, z);
    if (r !== undefined && r !== null) {
      const i = typeof r === 'number' ? r : ZONE_IDX.get(r);
      if (i !== undefined && i >= 0 && i < this.lands) return i;
    }
    let wx = x, wz = z;
    if (warp) {
      wx += fbm(this.warp, x * 0.009, z * 0.009, 2) * 70;
      wz += fbm(this.warp, x * 0.009 + 71.3, z * 0.009 - 17.9, 2) * 70;
    }
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.lands; i++) {
      const dx = wx - this.cx[i], dz = wz - this.cz[i];
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** Smooth land weights (sum 1), for colours. */
  weights(x: number, z: number, out: Float32Array, soft = 26): Float32Array {
    let min = Infinity;
    for (let i = 0; i < this.lands; i++) { const d = Math.hypot(x - this.cx[i], z - this.cz[i]); out[i] = d; if (d < min) min = d; }
    let sum = 0;
    for (let i = 0; i < this.lands; i++) { out[i] = Math.exp(-(out[i] - min) / soft); sum += out[i]; }
    for (let i = 0; i < this.lands; i++) out[i] /= sum;
    return out;
  }

  /** 0..1 forest density: large forests with clearings, plus small groves in the open. */
  forest(x: number, z: number, land: number): number {
    const eco = LAND_ECO[land];
    const f = this.data.forestAt?.(x, z);
    let big: number;
    if (f !== undefined && f !== null && !Number.isNaN(f)) big = clamp(f, 0, 1);
    else {
      const n = fbm(this.nForest, x * 0.0042, z * 0.0042, 4);
      big = clamp((n - this.thr[land]) / 0.07 + 0.5, 0, 1);
    }
    const g = fbm(this.nGrove, x * 0.018, z * 0.018, 3);
    const grove = clamp((g - 0.42) / 0.05, 0, 1) * eco.groves * (1 - big);
    // thin out towards the tree line
    const h = this.data.heightAt(x, z);
    const alt = clamp(1 - (h - eco.treeLine) / 40, 0, 1);
    return Math.max(big, grove) * alt;
  }

  /** Low-frequency patches (flower meadows, dry spots), 0..1. */
  patch(x: number, z: number, scale = 0.03, seed = 0): number {
    return clamp(fbm(this.nPatch, x * scale + seed * 17.3, z * scale - seed * 9.1, 3) * 1.6 + 0.5, 0, 1);
  }

  /** Towns, camps, arenas, gates, dungeon mouths, POIs. */
  blocked(x: number, z: number, pad = 0): boolean {
    const l = this.blockGrid.get(Math.floor(x / 64) * 4096 + Math.floor(z / 64));
    if (!l) return false;
    for (const b of l) { const dx = x - b.x, dz = z - b.z, r = b.r + pad; if (dx * dx + dz * dz < r * r) return true; }
    return false;
  }

  /** Roads and plazas within `r` metres (centre + 4 probes). */
  onRoad(x: number, z: number, r: number): boolean {
    const d = this.data;
    if (d.pathAt(x, z) > 0.04 || d.plazaAt(x, z) > 0.02) return true;
    if (r <= 0) return false;
    for (const [ox, oz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
      if (d.pathAt(x + ox, z + oz) > 0.08 || d.plazaAt(x + ox, z + oz) > 0.05) return true;
    }
    return false;
  }

  /** Dry land at least `above` metres over the water line. */
  dry(h: number, above = 0.6) { return h > WATER_LEVEL + above; }
}
