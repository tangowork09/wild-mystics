import * as THREE from 'three';
import { mulberry32 } from '../../core/noise';

// One tileable 256² RGBA noise texture shared by the sky (clouds, milky way, aurora), wind gusts,
// grass colour breakup and particles. Built once on the CPU (~15 ms).
//   R: fbm value noise    G: billowy fbm    B: inverted worley (puffy cells)    A: fine value noise

let tex: THREE.DataTexture | null = null;

export function noiseTexture(): THREE.DataTexture {
  if (tex) return tex;
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  const rnd = mulberry32(90210);
  const lattice = (period: number) => {
    const v = new Float32Array(period * period);
    for (let i = 0; i < v.length; i++) v[i] = rnd();
    return (x: number, y: number) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const fx = x - xi, fy = y - yi;
      const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
      const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
      const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
      const a = v[y0 * period + x0], b = v[y0 * period + x1], c = v[y1 * period + x0], d = v[y1 * period + x1];
      return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
    };
  };
  const octR = [4, 8, 16, 32, 64].map(lattice);
  const octG = [4, 8, 16, 32].map(lattice);
  const fine = lattice(64);
  // worley: 8x8 jittered points, tileable
  const WC = 8;
  const pts = new Float32Array(WC * WC * 2);
  for (let i = 0; i < WC * WC; i++) { pts[i * 2] = rnd(); pts[i * 2 + 1] = rnd(); }
  const worley = (u: number, v: number) => {
    const x = u * WC, y = v * WC;
    const cx = Math.floor(x), cy = Math.floor(y);
    let best = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j;
      const wx = ((gx % WC) + WC) % WC, wy = ((gy % WC) + WC) % WC;
      const px = gx + pts[(wy * WC + wx) * 2], py = gy + pts[(wy * WC + wx) * 2 + 1];
      const d = (px - x) * (px - x) + (py - y) * (py - y);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      let r = 0, amp = 0.5, norm = 0;
      for (let o = 0; o < octR.length; o++) { const p = 4 << o; r += octR[o](u * p, v * p) * amp; norm += amp; amp *= 0.5; }
      r /= norm;
      let g = 0; amp = 0.5; norm = 0;
      for (let o = 0; o < octG.length; o++) { const p = 4 << o; g += (1 - Math.abs(octG[o](u * p + 0.5, v * p + 0.5) * 2 - 1)) * amp; norm += amp; amp *= 0.5; }
      g /= norm;
      const w = 1 - Math.min(1, worley(u, v) * 1.25);
      const o4 = (y * S + x) * 4;
      data[o4] = Math.round(THREE.MathUtils.clamp((r - 0.5) * 1.6 + 0.5, 0, 1) * 255);
      data[o4 + 1] = Math.round(THREE.MathUtils.clamp(g, 0, 1) * 255);
      data[o4 + 2] = Math.round(w * 255);
      data[o4 + 3] = Math.round(fine(u * 64, v * 64) * 255);
    }
  }
  tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
