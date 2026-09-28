import * as THREE from 'three';
import { ZONES, type SkyMood } from '../../data/zones';
import { clamp, lerp } from '../../core/noise';

// Time-of-day keyframes × per-land mood → one SkyState that drives the sky dome, fog, lights, clouds,
// env map and colour grade. Colours are authored in sRGB hex (THREE.Color converts to linear) and
// scaled into HDR by the intensities next to them.
//
// Time: 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset.

export interface SkyState {
  zenith: THREE.Color; horizon: THREE.Color; ground: THREE.Color;
  hazeSun: THREE.Color; hazeAway: THREE.Color;
  sunCol: THREE.Color; sunI: number; disc: THREE.Color;
  hemiSky: THREE.Color; hemiGround: THREE.Color; hemiI: number;
  aerial: THREE.Color; aerialD: number; aerialMax: number;
  mist: THREE.Color; mistD: number;
  cloudLit: THREE.Color; cloudShade: THREE.Color; cloudCover: number;
  stars: number; aurora: number; glow: number; glowPow: number;
  exposure: number; sat: number; vibrance: number; contrast: number; lookPower: number; lookSat: number;
  wb: THREE.Color; shadowTint: THREE.Color; highTint: THREE.Color;
  env: number; bloom: number; leaves: number;
}

interface Key {
  t: number;
  zenith: [string, number]; horizon: [string, number]; ground: [string, number];
  hazeSun: [string, number]; hazeAway: [string, number];
  sun: [string, number]; disc: [string, number];
  hemiSky: string; hemiGround: string; hemiI: number;
  aerial: [string, number]; aerialD: number;
  mist: [string, number];
  cloudLit: [string, number]; cloudShade: [string, number];
  stars: number; glow: number; glowPow: number;
  exposure: number; sat: number; contrast: number; warm: number;
  shadow: string; high: string; env: number; bloom: number;
}

// Colour script. Day skies stay saturated blue down to a cyan horizon (never white); the horizon haze
// on the sun side carries the warmth, the side away from the sun stays cool.
const KEYS: Key[] = [
  { t: 0.0, zenith: ['#07102e', 0.32], horizon: ['#1b2a58', 0.42], ground: ['#0c1226', 0.3], hazeSun: ['#2c3a70', 0.5], hazeAway: ['#1b2a58', 0.42],
    sun: ['#8fa8ff', 0.62], disc: ['#dfe8ff', 6], hemiSky: '#4a5ea8', hemiGround: '#1a2036', hemiI: 0.62,
    aerial: ['#1e2c5c', 0.5], aerialD: 1.0, mist: ['#24325e', 0.45], cloudLit: ['#3c4a7c', 0.42], cloudShade: ['#10162e', 0.4],
    stars: 1, glow: 0.2, glowPow: 6, exposure: 1.35, sat: 1.0, contrast: 1.04, warm: -0.35, shadow: '#b8c4ff', high: '#e8ecff', env: 0.35, bloom: 1.25 },
  { t: 0.205, zenith: ['#16245a', 0.45], horizon: ['#6a5a98', 0.62], ground: ['#1a1c34', 0.35], hazeSun: ['#e0908a', 0.9], hazeAway: ['#46487e', 0.55],
    sun: ['#a4b2ff', 0.42], disc: ['#ffd0b0', 6], hemiSky: '#6a74b0', hemiGround: '#2a2638', hemiI: 0.62,
    aerial: ['#4a4a8a', 0.6], aerialD: 1.1, mist: ['#7a70a8', 0.6], cloudLit: ['#c07a8a', 0.7], cloudShade: ['#2c2a52', 0.5],
    stars: 0.45, glow: 0.5, glowPow: 5, exposure: 1.3, sat: 1.08, contrast: 1.04, warm: -0.1, shadow: '#b8b8ff', high: '#ffe0d8', env: 0.4, bloom: 1.1 },
  { t: 0.255, zenith: ['#3560ac', 0.75], horizon: ['#ffb08a', 1.05], ground: ['#3a3a58', 0.45], hazeSun: ['#ffc48a', 1.6], hazeAway: ['#8a90c8', 0.8],
    sun: ['#ffa468', 1.9], disc: ['#fff0d8', 22], hemiSky: '#8ea8dc', hemiGround: '#6a5a50', hemiI: 0.78,
    aerial: ['#9088cc', 1.1], aerialD: 1.05, mist: ['#ffc8b0', 0.9], cloudLit: ['#ffc09a', 1.45], cloudShade: ['#6a5e98', 0.7],
    stars: 0, glow: 1.1, glowPow: 4, exposure: 1.12, sat: 1.18, contrast: 1.06, warm: 0.35, shadow: '#b4b8ff', high: '#ffe8d0', env: 0.5, bloom: 1.0 },
  { t: 0.32, zenith: ['#2d6fd6', 1.0], horizon: ['#9fd0f6', 1.15], ground: ['#4a5a78', 0.6], hazeSun: ['#fff0d4', 1.5], hazeAway: ['#a4c8ee', 1.05],
    sun: ['#ffdcae', 3.2], disc: ['#fffaf0', 40], hemiSky: '#a6c6f2', hemiGround: '#8a7a54', hemiI: 1.0,
    aerial: ['#7f98e0', 1.45], aerialD: 1.0, mist: ['#d8e8ff', 1.0], cloudLit: ['#ffffff', 1.5], cloudShade: ['#8e9ec8', 0.95],
    stars: 0, glow: 0.8, glowPow: 5, exposure: 1.06, sat: 1.12, contrast: 1.06, warm: 0.2, shadow: '#c6cbee', high: '#fff0da', env: 0.55, bloom: 0.9 },
  { t: 0.5, zenith: ['#1c5fd2', 1.05], horizon: ['#94c8f4', 1.25], ground: ['#4a5a78', 0.65], hazeSun: ['#e8f4ff', 1.45], hazeAway: ['#9cc8f0', 1.15],
    sun: ['#ffeed6', 3.6], disc: ['#ffffff', 50], hemiSky: '#aecef4', hemiGround: '#8a7a54', hemiI: 1.02,
    aerial: ['#7a94e2', 1.5], aerialD: 1.0, mist: ['#dcecff', 1.05], cloudLit: ['#ffffff', 1.6], cloudShade: ['#94a6cc', 1.0],
    stars: 0, glow: 0.6, glowPow: 6, exposure: 1.02, sat: 1.1, contrast: 1.07, warm: 0.12, shadow: '#c6cbee', high: '#fff2e0', env: 0.55, bloom: 0.85 },
  { t: 0.62, zenith: ['#2465cc', 1.0], horizon: ['#a8ccf0', 1.2], ground: ['#4a5a78', 0.62], hazeSun: ['#fff0d0', 1.55], hazeAway: ['#a0c4ec', 1.1],
    sun: ['#ffe2b8', 3.4], disc: ['#fff8e8', 45], hemiSky: '#a6c4ee', hemiGround: '#8a7852', hemiI: 1.0,
    aerial: ['#7c94e0', 1.45], aerialD: 1.0, mist: ['#dde8ff', 1.0], cloudLit: ['#fffaf0', 1.55], cloudShade: ['#909ecc', 0.95],
    stars: 0, glow: 0.75, glowPow: 5, exposure: 1.04, sat: 1.12, contrast: 1.07, warm: 0.25, shadow: '#c4c8ec', high: '#ffeed4', env: 0.55, bloom: 0.9 },
  { t: 0.7, zenith: ['#2a58a8', 0.9], horizon: ['#ffc88c', 1.25], ground: ['#4a4a68', 0.55], hazeSun: ['#ffcc84', 1.9], hazeAway: ['#9aa4d8', 0.95],
    sun: ['#ffbe6a', 2.9], disc: ['#fff0c8', 38], hemiSky: '#98acd8', hemiGround: '#7a5e48', hemiI: 0.82,
    aerial: ['#9282cc', 1.35], aerialD: 1.0, mist: ['#ffd8b0', 1.0], cloudLit: ['#ffd29c', 1.65], cloudShade: ['#7a6c9e', 0.85],
    stars: 0, glow: 1.3, glowPow: 4, exposure: 1.02, sat: 1.22, contrast: 1.08, warm: 0.5, shadow: '#a8b0ff', high: '#ffe2bc', env: 0.5, bloom: 1.0 },
  { t: 0.752, zenith: ['#283a80', 0.72], horizon: ['#ff8a58', 1.15], ground: ['#3a3050', 0.45], hazeSun: ['#ffa864', 2.0], hazeAway: ['#8a78b4', 0.72],
    sun: ['#ff7a38', 1.5], disc: ['#ffd8a0', 24], hemiSky: '#7a80b8', hemiGround: '#5a4448', hemiI: 0.72,
    aerial: ['#7e62aa', 1.0], aerialD: 1.05, mist: ['#f0a0a0', 0.9], cloudLit: ['#ff946a', 1.5], cloudShade: ['#5a4a84', 0.7],
    stars: 0.05, glow: 1.5, glowPow: 3.5, exposure: 1.12, sat: 1.22, contrast: 1.08, warm: 0.55, shadow: '#a4a4ff', high: '#ffd4b0', env: 0.45, bloom: 1.1 },
  { t: 0.795, zenith: ['#18225a', 0.5], horizon: ['#8a5a8e', 0.7], ground: ['#1c1a30', 0.35], hazeSun: ['#d46a74', 0.95], hazeAway: ['#44427a', 0.5],
    sun: ['#a8b4ff', 0.42], disc: ['#ffc8a0', 8], hemiSky: '#5a62a0', hemiGround: '#2a2434', hemiI: 0.62,
    aerial: ['#4a3e84', 0.6], aerialD: 1.1, mist: ['#6a5494', 0.55], cloudLit: ['#b86a86', 0.75], cloudShade: ['#2a2450', 0.5],
    stars: 0.4, glow: 0.7, glowPow: 4, exposure: 1.28, sat: 1.1, contrast: 1.05, warm: -0.05, shadow: '#b0b0ff', high: '#ffd8e0', env: 0.4, bloom: 1.15 },
  { t: 0.86, zenith: ['#0a1434', 0.34], horizon: ['#1e2c5e', 0.44], ground: ['#0c1226', 0.3], hazeSun: ['#2e3c74', 0.52], hazeAway: ['#1e2c5e', 0.44],
    sun: ['#90a8ff', 0.6], disc: ['#dfe8ff', 6], hemiSky: '#4a5ea8', hemiGround: '#1a2036', hemiI: 0.62,
    aerial: ['#1e2c5c', 0.5], aerialD: 1.0, mist: ['#24325e', 0.45], cloudLit: ['#3c4a7c', 0.42], cloudShade: ['#10162e', 0.4],
    stars: 1, glow: 0.2, glowPow: 6, exposure: 1.35, sat: 1.0, contrast: 1.04, warm: -0.35, shadow: '#b8c4ff', high: '#e8ecff', env: 0.35, bloom: 1.25 },
];

const _c = new THREE.Color();
const col = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);

interface LinKey {
  t: number;
  c: Record<string, THREE.Color>;
  n: Record<string, number>;
}
const LIN: LinKey[] = KEYS.map((k) => ({
  t: k.t,
  c: {
    zenith: col(...k.zenith), horizon: col(...k.horizon), ground: col(...k.ground), hazeSun: col(...k.hazeSun), hazeAway: col(...k.hazeAway),
    sunCol: col(k.sun[0]), disc: col(...k.disc), hemiSky: col(k.hemiSky), hemiGround: col(k.hemiGround), aerial: col(...k.aerial), mist: col(...k.mist),
    cloudLit: col(...k.cloudLit), cloudShade: col(...k.cloudShade), shadowTint: col(k.shadow), highTint: col(k.high),
  },
  n: { sunI: k.sun[1], hemiI: k.hemiI, aerialD: k.aerialD, stars: k.stars, glow: k.glow, glowPow: k.glowPow, exposure: k.exposure, sat: k.sat, contrast: k.contrast, warm: k.warm, env: k.env, bloom: k.bloom },
}));

export function newSkyState(): SkyState {
  const C = () => new THREE.Color();
  return {
    zenith: C(), horizon: C(), ground: C(), hazeSun: C(), hazeAway: C(), sunCol: C(), sunI: 0, disc: C(),
    hemiSky: C(), hemiGround: C(), hemiI: 0, aerial: C(), aerialD: 0, aerialMax: 0.8, mist: C(), mistD: 0,
    cloudLit: C(), cloudShade: C(), cloudCover: 0.4, stars: 0, aurora: 0, glow: 0, glowPow: 5,
    exposure: 1, sat: 1, vibrance: 0.2, contrast: 1, lookPower: 1.2, lookSat: 1.2, wb: new THREE.Color(1, 1, 1),
    shadowTint: new THREE.Color(1, 1, 1), highTint: new THREE.Color(1, 1, 1), env: 0.5, bloom: 1, leaves: 0,
  };
}

/** Blend of every land's mood by weight (zone order). */
export interface MoodMix {
  zenith: THREE.Color; horizon: THREE.Color; aerial: THREE.Color; night: THREE.Color;
  haze: number; mist: number; sat: number; contrast: number; warmth: number; cloud: number; aurora: number; leaves: number;
}

export function newMood(): MoodMix {
  return { zenith: new THREE.Color(1, 1, 1), horizon: new THREE.Color(1, 1, 1), aerial: new THREE.Color(0.4, 0.5, 0.8), night: new THREE.Color(1, 1, 1), haze: 1, mist: 0.5, sat: 1, contrast: 1, warmth: 0, cloud: 0.4, aurora: 0, leaves: 0 };
}

const MOODS: { m: SkyMood; zenith: THREE.Color; horizon: THREE.Color; aerial: THREE.Color; night: THREE.Color }[] = ZONES.map((z) => ({
  m: z.sky, zenith: new THREE.Color(z.sky.zenith), horizon: new THREE.Color(z.sky.horizon), aerial: new THREE.Color(z.sky.aerial), night: new THREE.Color(z.sky.night),
}));

export function moodFor(w: number[], out = newMood()): MoodMix {
  out.zenith.setRGB(0, 0, 0); out.horizon.setRGB(0, 0, 0); out.aerial.setRGB(0, 0, 0); out.night.setRGB(0, 0, 0);
  out.haze = out.mist = out.sat = out.contrast = out.warmth = out.cloud = out.aurora = out.leaves = 0;
  let sum = 0;
  MOODS.forEach((md, i) => {
    const k = w[i] ?? 0;
    if (k < 1e-4) return;
    sum += k;
    out.zenith.add(_c.copy(md.zenith).multiplyScalar(k));
    out.horizon.add(_c.copy(md.horizon).multiplyScalar(k));
    out.aerial.add(_c.copy(md.aerial).multiplyScalar(k));
    out.night.add(_c.copy(md.night).multiplyScalar(k));
    out.haze += md.m.haze * k; out.mist += md.m.mist * k; out.sat += md.m.sat * k; out.contrast += md.m.contrast * k;
    out.warmth += md.m.warmth * k; out.cloud += md.m.cloud * k; out.aurora += md.m.aurora * k; out.leaves += md.m.leaves * k;
  });
  if (sum > 0 && Math.abs(sum - 1) > 1e-3) {
    const s = 1 / sum;
    out.zenith.multiplyScalar(s); out.horizon.multiplyScalar(s); out.aerial.multiplyScalar(s); out.night.multiplyScalar(s);
    out.haze *= s; out.mist *= s; out.sat *= s; out.contrast *= s; out.warmth *= s; out.cloud *= s; out.aurora *= s; out.leaves *= s;
  }
  return out;
}

export function lerpMood(a: MoodMix, b: MoodMix, k: number) {
  a.zenith.lerp(b.zenith, k); a.horizon.lerp(b.horizon, k); a.aerial.lerp(b.aerial, k); a.night.lerp(b.night, k);
  a.haze = lerp(a.haze, b.haze, k); a.mist = lerp(a.mist, b.mist, k); a.sat = lerp(a.sat, b.sat, k); a.contrast = lerp(a.contrast, b.contrast, k);
  a.warmth = lerp(a.warmth, b.warmth, k); a.cloud = lerp(a.cloud, b.cloud, k); a.aurora = lerp(a.aurora, b.aurora, k); a.leaves = lerp(a.leaves, b.leaves, k);
}

/** Sun elevation in degrees for a time of day (0 = midnight). */
export const sunElevation = (t: number) => Math.sin((t - 0.25) * Math.PI * 2) * 60;

const smooth = (x: number) => x * x * (3 - 2 * x);

/** Evaluate the time-of-day palette and apply the land mood. */
export function evalSky(t: number, mood: MoodMix, night: number, out: SkyState): SkyState {
  t = ((t % 1) + 1) % 1;
  let i = 0;
  while (i < LIN.length - 1 && LIN[i + 1].t <= t) i++;
  const a = LIN[i], b = LIN[(i + 1) % LIN.length];
  const tb = b.t <= a.t ? b.t + 1 : b.t;
  const k = smooth(clamp((t - a.t) / Math.max(1e-4, tb - a.t), 0, 1));
  const C = (name: string, dst: THREE.Color) => dst.copy(a.c[name]).lerp(b.c[name], k);
  const N = (name: string) => lerp(a.n[name], b.n[name], k);

  C('zenith', out.zenith); C('horizon', out.horizon); C('ground', out.ground); C('hazeSun', out.hazeSun); C('hazeAway', out.hazeAway);
  C('sunCol', out.sunCol); C('disc', out.disc); C('hemiSky', out.hemiSky); C('hemiGround', out.hemiGround);
  C('aerial', out.aerial); C('mist', out.mist); C('cloudLit', out.cloudLit); C('cloudShade', out.cloudShade);
  C('shadowTint', out.shadowTint); C('highTint', out.highTint);
  out.sunI = N('sunI'); out.hemiI = N('hemiI'); out.aerialD = N('aerialD'); out.stars = N('stars'); out.glow = N('glow'); out.glowPow = N('glowPow');
  out.exposure = N('exposure'); out.sat = N('sat'); out.contrast = N('contrast'); out.env = N('env'); out.bloom = N('bloom');
  const warm = N('warm') + mood.warmth * (1 - night * 0.7);

  // land mood: tints scale the sky, the aerial hue leans toward the land's own colour (by day)
  const day = 1 - night;
  out.zenith.multiply(mood.zenith);
  out.horizon.multiply(mood.horizon);
  out.hazeAway.multiply(mood.horizon);
  out.hazeSun.multiply(_c.copy(mood.horizon).lerp(new THREE.Color(1, 1, 1), 0.5));
  const aerialLum = out.aerial.r * 0.2126 + out.aerial.g * 0.7152 + out.aerial.b * 0.0722;
  const moodLum = mood.aerial.r * 0.2126 + mood.aerial.g * 0.7152 + mood.aerial.b * 0.0722;
  _c.copy(mood.aerial).multiplyScalar(aerialLum / Math.max(1e-4, moodLum));
  out.aerial.lerp(_c, 0.65 * day + 0.25 * night);
  out.mist.lerp(_c, 0.25);
  const nt = _c.copy(mood.night).lerp(new THREE.Color(1, 1, 1), 1 - night);
  out.hemiSky.multiply(nt); out.hazeAway.multiply(nt); out.zenith.multiply(nt); out.aerial.multiply(nt); out.mist.multiply(nt);
  out.aerialD *= mood.haze;
  out.mistD = mood.mist;
  out.cloudCover = mood.cloud;
  out.aurora = mood.aurora * night;
  out.leaves = mood.leaves;
  out.sat *= mood.sat;
  out.contrast *= mood.contrast;
  out.vibrance = 0.18 + 0.1 * day;
  out.lookPower = 1.12 + 0.06 * out.contrast;
  out.lookSat = 1.12;
  // white balance from warmth (−1 cool … +1 warm), roughly a Kelvin slide around D65
  const w = clamp(warm, -1, 1) * 0.09;
  out.wb.setRGB(1 + w, 1 + w * 0.12, 1 - w * 1.1);
  return out;
}
