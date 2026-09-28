// Binary + JSON export of the bake (format in src/world/terrainFormat.ts).

import path from 'node:path';
import fs from 'node:fs';
import { writeGz, writeJson } from './io';
import { HQ_MIN, HQ_STEP, HEIGHT_RES, FIELD_RES, FIELD_PLANES, SPLAT_LAYERS, type WorldMeta } from '../../src/world/terrainFormat';

const q16 = (h: number) => Math.max(0, Math.min(65535, Math.round((h - HQ_MIN) / HQ_STEP)));

export function encodeHeight(h: Float32Array, n = HEIGHT_RES): Uint8Array {
  const q = new Uint16Array(n * n);
  for (let k = 0; k < n * n; k++) q[k] = q16(h[k]);
  const out = new Uint8Array(n * n * 2);
  let worst = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const pred = i > 0 && j > 0 ? q[k - 1] + q[k - n] - q[k - n - 1] : i > 0 ? q[k - 1] : j > 0 ? q[k - n] : 0;
      const r = q[k] - pred;
      const zz = r >= 0 ? r * 2 : -r * 2 - 1;
      if (zz > 65535) throw new Error(`height residual too large at ${i},${j}`);
      worst = Math.max(worst, zz);
      out[k] = zz & 255;
      out[n * n + k] = zz >> 8;
    }
  }
  return out;
}

/** Decode (used by the round-trip self-test; mirrors the runtime decoder). */
export function decodeHeight(b: Uint8Array, n = HEIGHT_RES): Float32Array {
  const q = new Int32Array(n * n);
  const out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const zz = b[k] | (b[n * n + k] << 8);
      const r = zz & 1 ? -((zz + 1) >> 1) : zz >> 1;
      const pred = i > 0 && j > 0 ? q[k - 1] + q[k - n] - q[k - n - 1] : i > 0 ? q[k - 1] : j > 0 ? q[k - n] : 0;
      q[k] = r + pred;
      out[k] = HQ_MIN + q[k] * HQ_STEP;
    }
  }
  return out;
}

export function encodeWater(surf: Float32Array, kind: Uint8Array, n = FIELD_RES): Uint8Array {
  const out = new Uint8Array(n * n * 2);
  for (let k = 0; k < n * n; k++) {
    const v = kind[k] ? Math.max(1, q16(surf[k])) : 0;
    out[k] = v & 255;
    out[n * n + k] = v >> 8;
  }
  return out;
}

export function encodeFields(planes: Record<string, Float32Array | Uint8Array>, splat: Float32Array[], n = FIELD_RES): Uint8Array {
  const count = FIELD_PLANES.length + SPLAT_LAYERS.length;
  const out = new Uint8Array(n * n * count);
  FIELD_PLANES.forEach((name, p) => {
    const src = planes[name];
    if (!src) throw new Error(`missing plane ${name}`);
    const o = p * n * n;
    if (src instanceof Uint8Array) out.set(src, o);
    else for (let k = 0; k < n * n; k++) out[o + k] = Math.max(0, Math.min(255, Math.round(src[k] * 255)));
  });
  // splat: quantise so each texel's weights still sum to 255
  const L = SPLAT_LAYERS.length;
  const base = FIELD_PLANES.length * n * n;
  for (let k = 0; k < n * n; k++) {
    let acc = 0, best = 0, bw = -1;
    for (let l = 0; l < L; l++) {
      const v = Math.round(splat[l][k] * 255);
      out[base + l * n * n + k] = v;
      acc += v;
      if (splat[l][k] > bw) { bw = splat[l][k]; best = l; }
    }
    const fix = out[base + best * n * n + k] + (255 - acc);
    out[base + best * n * n + k] = Math.max(0, Math.min(255, fix));
  }
  return out;
}

export function writeWorld(dir: string, meta: WorldMeta, height: Uint8Array, fields: Uint8Array, water: Uint8Array) {
  fs.mkdirSync(dir, { recursive: true });
  const sizes: Record<string, number> = {};
  sizes.height = writeGz(path.join(dir, meta.files.height), height);
  sizes.fields = writeGz(path.join(dir, meta.files.fields), fields);
  sizes.water = writeGz(path.join(dir, meta.files.water), water);
  sizes.json = writeJson(path.join(dir, 'world.json'), meta);
  return sizes;
}
