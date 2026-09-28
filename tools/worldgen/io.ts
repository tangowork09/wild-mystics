// Output helpers: gzip binaries, JSON, PNG/WebP via sharp, and debug previews.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import sharp from 'sharp';
import { Grid } from './grid';
import { clamp } from './noise';

export function writeGz(file: string, bytes: Uint8Array) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const gz = zlib.gzipSync(bytes, { level: 9, memLevel: 9 });
  fs.writeFileSync(file, gz);
  return gz.length;
}

export function writeJson(file: string, obj: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const s = JSON.stringify(obj);
  fs.writeFileSync(file, s);
  return s.length;
}

export async function writeImage(file: string, rgb: Uint8Array | Uint8ClampedArray, w: number, h: number, channels: 3 | 4 = 3, opts: { quality?: number; lossless?: boolean } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const img = sharp(Buffer.from(rgb.buffer, rgb.byteOffset, rgb.byteLength), { raw: { width: w, height: h, channels } });
  if (file.endsWith('.webp')) await img.webp({ quality: opts.quality ?? 88, lossless: opts.lossless ?? false, effort: 6, smartSubsample: true }).toFile(file);
  else if (file.endsWith('.jpg')) await img.jpeg({ quality: opts.quality ?? 90, mozjpeg: true }).toFile(file);
  else await img.png({ compressionLevel: 9 }).toFile(file);
  return fs.statSync(file).size;
}

/** Quick shaded relief (debug preview): hypsometric tint × hillshade, water in blue. */
export async function previewHeight(file: string, h: Grid, size = 1024, water?: Grid, extra?: (x: number, z: number, c: [number, number, number]) => void) {
  const out = new Uint8Array(size * size * 3);
  const step = 2048 / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = -1024 + px * step, z = -1024 + py * step;
      const v = h.sample(x, z);
      const gx = (h.sample(x + step, z) - h.sample(x - step, z)) / (2 * step);
      const gz = (h.sample(x, z + step) - h.sample(x, z - step)) / (2 * step);
      const nl = Math.hypot(gx, 1, gz);
      const shade = clamp((-gx * -0.6 + 1 * 0.62 + -gz * -0.5) / nl, 0, 1);
      let c: [number, number, number];
      const ws = water ? water.sample(x, z) : -1.2;
      if (v < ws) {
        const d = clamp((ws - v) / 12, 0, 1);
        c = [60 - 40 * d, 150 - 80 * d, 190 - 60 * d];
      } else {
        const t = clamp(v / 230, 0, 1);
        const lo: [number, number, number] = [96, 150, 70], mid: [number, number, number] = [170, 150, 100], hi: [number, number, number] = [240, 240, 245];
        c = t < 0.35 ? lerp3(lo, mid, t / 0.35) : lerp3(mid, hi, (t - 0.35) / 0.65);
        if (v < 1.5) c = lerp3(c, [220, 205, 150], clamp((1.5 - v) / 2.5, 0, 1));
        const k = 0.35 + shade * 0.85;
        c = [c[0] * k, c[1] * k, c[2] * k];
      }
      extra?.(x, z, c);
      const o = (py * size + px) * 3;
      out[o] = clamp(c[0], 0, 255); out[o + 1] = clamp(c[1], 0, 255); out[o + 2] = clamp(c[2], 0, 255);
    }
  }
  await writeImage(file, out, size, size, 3);
}

const lerp3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Overlay: filled discs and polylines on an RGB preview buffer (world coords). */
export class Overlay {
  constructor(public buf: Uint8Array, public size: number) {}
  private px(x: number) { return ((x + 1024) / 2048) * this.size; }
  disc(x: number, z: number, r: number, col: [number, number, number], alpha = 1) {
    const cx = this.px(x), cz = this.px(z), rr = Math.max(1, (r / 2048) * this.size);
    for (let py = Math.floor(cz - rr - 1); py <= cz + rr + 1; py++) {
      for (let px = Math.floor(cx - rr - 1); px <= cx + rr + 1; px++) {
        if (px < 0 || py < 0 || px >= this.size || py >= this.size) continue;
        const d = Math.hypot(px - cx, py - cz);
        const a = Math.max(0, Math.min(1, rr + 0.5 - d)) * alpha;
        if (a <= 0) continue;
        const o = (py * this.size + px) * 3;
        for (let c = 0; c < 3; c++) this.buf[o + c] = this.buf[o + c] * (1 - a) + col[c] * a;
      }
    }
  }
  ring(x: number, z: number, r: number, col: [number, number, number]) {
    const cx = this.px(x), cz = this.px(z), rr = (r / 2048) * this.size;
    for (let py = Math.floor(cz - rr - 2); py <= cz + rr + 2; py++) {
      for (let px = Math.floor(cx - rr - 2); px <= cx + rr + 2; px++) {
        if (px < 0 || py < 0 || px >= this.size || py >= this.size) continue;
        const a = Math.max(0, 1 - Math.abs(Math.hypot(px - cx, py - cz) - rr));
        const o = (py * this.size + px) * 3;
        for (let c = 0; c < 3; c++) this.buf[o + c] = this.buf[o + c] * (1 - a) + col[c] * a;
      }
    }
  }
  line(pts: [number, number][], w: number, col: [number, number, number], alpha = 1) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil((L / 2048) * this.size * 2));
      for (let k = 0; k <= n; k++) this.disc(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n, w / 2, col, alpha * 0.5);
    }
  }
}

export async function previewWithOverlay(file: string, h: Grid, size: number, water: Grid | undefined, draw: (o: Overlay) => void) {
  const out = new Uint8Array(size * size * 3);
  const step = 2048 / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = -1024 + px * step, z = -1024 + py * step;
      const v = h.sample(x, z);
      const gx = (h.sample(x + step, z) - h.sample(x - step, z)) / (2 * step);
      const gz = (h.sample(x, z + step) - h.sample(x, z - step)) / (2 * step);
      const nl = Math.hypot(gx, 1, gz);
      const shade = clamp((gx * 0.6 + 0.62 + gz * 0.5) / nl, 0, 1);
      const ws = water ? water.sample(x, z) : -1.2;
      let c: [number, number, number];
      if (v < ws) { const d = clamp((ws - v) / 12, 0, 1); c = [60 - 40 * d, 150 - 80 * d, 190 - 60 * d]; }
      else {
        const t = clamp(v / 230, 0, 1);
        c = t < 0.35 ? lerp3([96, 150, 70], [170, 150, 100], t / 0.35) : lerp3([170, 150, 100], [240, 240, 245], (t - 0.35) / 0.65);
        const k = 0.35 + shade * 0.85;
        c = [c[0] * k, c[1] * k, c[2] * k];
      }
      const o = (py * size + px) * 3;
      out[o] = clamp(c[0], 0, 255); out[o + 1] = clamp(c[1], 0, 255); out[o + 2] = clamp(c[2], 0, 255);
    }
  }
  draw(new Overlay(out, size));
  await writeImage(file, out, size, size, 3);
}
