// Debug crops: height shading + slope classes + water, around a point.  (dev only)
import path from 'node:path';
import { Grid } from './grid';
import { writeImage } from './io';
import { clamp } from './noise';

export async function slopeCrop(file: string, h: Grid, slope: Float32Array, cx: number, cz: number, half = 128, scale = 4, marks: [number, number][] = []) {
  const W = half * 2 * scale / 2; // 2 m texels → scale px each
  const out = new Uint8Array(W * W * 3);
  for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
    const x = cx - half + (px / scale) * 2, z = cz - half + (py / scale) * 2;
    const i = Math.min(1023, Math.max(0, Math.round((x + 1024) / 2))), j = Math.min(1023, Math.max(0, Math.round((z + 1024) / 2)));
    const s = slope[j * 1024 + i];
    const v = h.sample(x, z);
    const gx = h.sample(x + 1, z) - h.sample(x - 1, z), gz = h.sample(x, z + 1) - h.sample(x, z - 1);
    const shade = clamp(0.6 + (gx + gz) * -0.25, 0.2, 1);
    let c: [number, number, number] = s > 1.35 ? [220, 40, 40] : s > 1.0 ? [230, 200, 40] : [80, 170, 80];
    const band = (Math.floor(v / 5) % 2) ? 1 : 0.9;
    c = [c[0] * shade * band, c[1] * shade * band, c[2] * shade * band];
    const o = (py * W + px) * 3;
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
  }
  for (const [mx, mz] of marks) {
    const px = Math.round((mx - (cx - half)) / 2 * scale), py = Math.round((mz - (cz - half)) / 2 * scale);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const X = px + dx, Y = py + dy;
      if (X < 0 || Y < 0 || X >= W || Y >= W) continue;
      const o = (Y * W + X) * 3; out[o] = 30; out[o + 1] = 30; out[o + 2] = 255;
    }
  }
  await writeImage(path.resolve(file), out, W, W, 3);
}
