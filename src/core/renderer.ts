import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset, VignetteEffect, DepthOfFieldEffect, Effect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { settings, onSettings } from './settings';

export type QualityTier = 'low' | 'medium' | 'high' | 'ultra';

import { isTouch } from './device';
export { isTouch };
export const isNative = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

function detectTier(): QualityTier {
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'low' || q === 'medium' || q === 'high' || q === 'ultra') return q;
  if (settings.quality !== 'auto') return settings.quality;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  if (isTouch) {
    // phones/tablets: high-end devices (8 GB / 8 cores) get medium, others low
    return mem >= 8 && cores >= 8 ? 'medium' : 'low';
  }
  return 'high';
}

export const tier: QualityTier = detectTier();

// Tier table for the 2 km island. The camera always sees Mount Aether (far ≥ 1.5 km); what scales is
// how much of the world is drawn at full detail before impostors / fog take over.
const BASE = {
  low: {
    pixelRatio: 1, shadow: 1024, cascades: 1, shadowFar: 38, ao: false, bloom: false, dof: false, smaa: false, far: 1500, fog: 1,
    grassNear: 4200, grassNearR: 10, grassFar: 4600, grassFarR: 22, flowers: 1600,
    treeMeshR: 24, propR: 30, impostorR: 900, impostorPx: 128, flora: 0.7,
    clouds: 0 as 0 | 1 | 2, env: 64, motes: 220, lamps: 0,
    grass: 8800, grassRadius: 22, trees: 0.7, terrainSeg: 200, colorMap: 1024, wildView: 55,
  },
  medium: {
    pixelRatio: 1.5, shadow: 2048, cascades: 1, shadowFar: 50, ao: false, bloom: true, dof: true, smaa: true, far: 1900, fog: 1,
    grassNear: 8500, grassNearR: 14, grassFar: 8500, grassFarR: 32, flowers: 3600,
    treeMeshR: 32, propR: 42, impostorR: 1300, impostorPx: 128, flora: 0.85,
    clouds: 1 as 0 | 1 | 2, env: 128, motes: 380, lamps: 2,
    grass: 17000, grassRadius: 32, trees: 0.85, terrainSeg: 280, colorMap: 1536, wildView: 65,
  },
  high: {
    pixelRatio: 2, shadow: 2048, cascades: 2, shadowFar: 150, ao: true, bloom: true, dof: true, smaa: true, far: 2800, fog: 1,
    grassNear: 22000, grassNearR: 20, grassFar: 19000, grassFarR: 52, flowers: 9000,
    treeMeshR: 46, propR: 66, impostorR: 2200, impostorPx: 256, flora: 1,
    clouds: 2 as 0 | 1 | 2, env: 256, motes: 700, lamps: 4,
    grass: 41000, grassRadius: 52, trees: 1, terrainSeg: 360, colorMap: 2048, wildView: 80,
  },
  ultra: {
    pixelRatio: 2, shadow: 3072, cascades: 2, shadowFar: 210, ao: true, bloom: true, dof: true, smaa: true, far: 2800, fog: 1,
    grassNear: 36000, grassNearR: 26, grassFar: 30000, grassFarR: 68, flowers: 15000,
    treeMeshR: 66, propR: 92, impostorR: 2600, impostorPx: 256, flora: 1.15,
    clouds: 2 as 0 | 1 | 2, env: 256, motes: 900, lamps: 6,
    grass: 66000, grassRadius: 68, trees: 1.15, terrainSeg: 440, colorMap: 2048, wildView: 95,
  },
}[tier];

const dens = settings.grassDensity;
const draw = THREE.MathUtils.clamp(settings.drawDistance, 0.5, 1.5);

/** Effective quality knobs = tier baseline × user settings. */
export const Q = {
  ...BASE,
  grassNear: Math.round(BASE.grassNear * dens),
  grassFar: Math.round(BASE.grassFar * dens),
  flowers: Math.round(BASE.flowers * dens),
  grass: Math.round(BASE.grass * dens),
  flora: BASE.flora * Math.min(1.3, dens * 0.3 + 0.7),
  trees: BASE.trees * Math.min(1.3, dens * 0.3 + 0.7),
  treeMeshR: BASE.treeMeshR * (0.75 + 0.25 * draw),
  propR: BASE.propR * (0.75 + 0.25 * draw),
  impostorR: BASE.impostorR * draw,
  far: Math.max(1400, BASE.far * (0.8 + 0.2 * draw)),
  fog: BASE.fog / Math.max(0.5, draw),
  shadow: settings.shadows === 'off' ? 0 : settings.shadows === 'low' ? Math.min(1024, BASE.shadow) : BASE.shadow,
  cascades: (settings.shadows === 'low' ? 1 : BASE.cascades) as 1 | 2,
  ao: BASE.ao && settings.ambientOcclusion,
  bloom: BASE.bloom && settings.bloom,
};

const maxPR = () => Math.min(devicePixelRatio, BASE.pixelRatio) * settings.renderScale;

export const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, preserveDrawingBuffer: new URLSearchParams(location.search).has('shot') });
renderer.setPixelRatio(maxPR());
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = Q.shadow > 0;
renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft was removed in r18x
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in the grade effect
// counters cover the whole frame (every composer pass + shadow maps), reset in Pipeline.render
renderer.info.autoReset = false;

// ── Colour grade + filmic tone curve ─────────────────────────────────────
// Exposure → white balance → saturation/vibrance → split toning (cool shadows, warm highlights), all in
// scene-linear HDR, then AgX with a punchy look, then contrast/lift/gain in display space. Everything
// the palette drives lives in `GradeEffect.set()`.
const GRADE_FRAG = /* glsl */ `
  uniform float exposure;
  uniform vec3 wb;
  uniform float saturation;
  uniform float vibrance;
  uniform vec3 shadowTint;
  uniform vec3 highTint;
  uniform float lookPower;
  uniform float lookSat;
  uniform float contrast;
  uniform vec3 lift;
  uniform vec3 gain;

  vec3 agxContrast(vec3 x) {
    vec3 x2 = x * x;
    vec3 x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  }
  vec3 agx(vec3 c) {
    const mat3 toRec2020 = mat3(0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.0880, 0.0433, 0.0113, 0.8956);
    const mat3 fromRec2020 = mat3(1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187);
    const mat3 inset = mat3(0.856627153315983, 0.137318972929847, 0.11189821299995, 0.0951212405381588, 0.761241990602591, 0.0767994186031903, 0.0482516061458583, 0.101439036467562, 0.811302368396859);
    const mat3 outset = mat3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826, -0.11060664309660323, 1.157823702216272, -0.11060664309660294, -0.016493938717834573, -0.016493938717834257, 1.2519364065950405);
    const float minEv = -12.47393;
    const float maxEv = 4.026069;
    c = toRec2020 * c;
    c = inset * c;
    c = max(c, 1e-10);
    c = clamp((log2(c) - minEv) / (maxEv - minEv), 0.0, 1.0);
    c = agxContrast(c);
    // look: punch (power) + saturation, applied in AgX log space like Blender's looks
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = pow(max(c, 0.0), vec3(lookPower));
    l = pow(max(l, 0.0), lookPower);
    c = l + lookSat * (c - l);
    c = outset * c;
    c = pow(max(vec3(0.0), c), vec3(2.2));
    c = fromRec2020 * c;
    return clamp(c, 0.0, 1.0);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = max(inputColor.rgb, 0.0) * exposure * wb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float s = (mx - mn) / max(mx, 1e-5);
    c = max(mix(vec3(l), c, saturation + vibrance * (1.0 - s)), 0.0);
    float zone = smoothstep(-5.0, 1.0, log2(l + 1e-5));
    c *= mix(shadowTint, highTint, zone);
    c = agx(c);
    vec3 d = pow(c, vec3(1.0 / 2.2));
    d = (d - 0.5) * contrast + 0.5;
    d = d * gain + lift * (1.0 - d);
    outputColor = vec4(pow(clamp(d, 0.0, 1.0), vec3(2.2)), inputColor.a);
  }
`;

export interface GradeParams {
  exposure: number; wb: THREE.Color; saturation: number; vibrance: number; shadowTint: THREE.Color; highTint: THREE.Color;
  lookPower: number; lookSat: number; contrast: number; lift: THREE.Color; gain: THREE.Color;
}

export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', GRADE_FRAG, {
      uniforms: new Map<string, THREE.Uniform>([
        ['exposure', new THREE.Uniform(1)], ['wb', new THREE.Uniform(new THREE.Color(1, 1, 1))],
        ['saturation', new THREE.Uniform(1.1)], ['vibrance', new THREE.Uniform(0.2)],
        ['shadowTint', new THREE.Uniform(new THREE.Color(1, 1, 1))], ['highTint', new THREE.Uniform(new THREE.Color(1, 1, 1))],
        ['lookPower', new THREE.Uniform(1.2)], ['lookSat', new THREE.Uniform(1.15)], ['contrast', new THREE.Uniform(1.05)],
        ['lift', new THREE.Uniform(new THREE.Color(0, 0, 0))], ['gain', new THREE.Uniform(new THREE.Color(1, 1, 1))],
      ]),
    });
  }
  set(p: Partial<GradeParams>) {
    for (const [k, v] of Object.entries(p)) {
      const u = this.uniforms.get(k);
      if (!u) continue;
      if (v instanceof THREE.Color) (u.value as THREE.Color).copy(v);
      else u.value = v;
    }
  }
}

export interface FocusOptions {
  /** Depth (m) around the focus point that stays sharp. */
  range?: number;
  /** Blur strength (bokeh scale), 0–4. */
  strength?: number;
}

export interface Pipeline {
  composer: EffectComposer;
  render(dt: number): void;
  setSize(w: number, h: number): void;
  bloom?: BloomEffect;
  vignette: VignetteEffect;
  grade: GradeEffect;
  /**
   * Depth of field for dialogs and battles: keep `target` sharp and soften the rest.
   * `null` fades the blur out. No-op on tiers without DOF (low).
   */
  setFocus(target: THREE.Vector3 | null, opts?: FocusOptions): void;
}

/** Last frame's renderer totals (all passes), for budgets and debugging. */
export const frameStats = { calls: 0, triangles: 0, points: 0, lines: 0 };

export function makePipeline(scene: THREE.Scene, camera: THREE.PerspectiveCamera, opts: { ao?: boolean; bloomStrength?: number } = {}): Pipeline {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));
  if (Q.ao && opts.ao !== false) {
    const ao = new N8AOPostPass(scene, camera, innerWidth, innerHeight);
    ao.configuration.aoRadius = 2.4;
    ao.configuration.distanceFalloff = 1.0;
    ao.configuration.intensity = 1.9;
    ao.configuration.color = new THREE.Color('#1c1430');
    ao.configuration.halfRes = true;
    ao.configuration.depthAwareUpsampling = true;
    ao.setQualityMode(tier === 'ultra' ? 'High' : 'Medium');
    composer.addPass(ao);
  }

  // depth of field runs on the HDR image before bloom and grading; its pass is off unless focusing
  let dof: DepthOfFieldEffect | null = null;
  let dofPass: EffectPass | null = null;
  if (BASE.dof) {
    dof = new DepthOfFieldEffect(camera, { focusDistance: 8, focusRange: 5, bokehScale: 0, resolutionScale: tier === 'medium' ? 0.35 : 0.5 });
    dofPass = new EffectPass(camera, dof);
    dofPass.enabled = false;
    composer.addPass(dofPass);
  }

  const effects: Effect[] = [];
  let bloom: BloomEffect | undefined;
  if (Q.bloom) {
    // threshold above 1: only HDR highlights (sun, emissives, lanterns, lava) bloom — daylit surfaces stay crisp
    bloom = new BloomEffect({ intensity: opts.bloomStrength ?? 0.8, luminanceThreshold: 1.05, luminanceSmoothing: 0.35, mipmapBlur: true, radius: 0.72 });
    effects.push(bloom);
  }
  const grade = new GradeEffect();
  const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.42 });
  effects.push(grade, vignette);
  composer.addPass(new EffectPass(camera, ...effects));
  // SMAA is cheap on desktop; on low tier we rely on the higher pixel density of phones instead
  if (BASE.smaa) composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: tier === 'medium' ? SMAAPreset.MEDIUM : SMAAPreset.HIGH })));

  const focus = { target: new THREE.Vector3(), active: false, amount: 0, strength: 2.4, range: 6 };

  return {
    composer, bloom, vignette, grade,
    render(dt) {
      if (dof && dofPass) {
        const want = focus.active ? 1 : 0;
        focus.amount += (want - focus.amount) * Math.min(1, dt * 5);
        if (!focus.active && focus.amount < 0.01) focus.amount = 0;
        dofPass.enabled = focus.amount > 0;
        if (dofPass.enabled) {
          dof.bokehScale = focus.strength * focus.amount;
          dof.cocMaterial.focusRange = focus.range;
        }
      }
      renderer.info.reset();
      composer.render(dt);
      frameStats.calls = renderer.info.render.calls;
      frameStats.triangles = renderer.info.render.triangles;
      frameStats.points = renderer.info.render.points;
      frameStats.lines = renderer.info.render.lines;
    },
    setSize(w, h) { composer.setSize(w, h); },
    setFocus(target, o = {}) {
      if (!dof) return;
      if (!target) { focus.active = false; return; }
      focus.target.copy(target);
      dof.target = focus.target;
      focus.range = o.range ?? 6;
      focus.strength = o.strength ?? 2.4;
      focus.active = true;
    },
  };
}

// ── Adaptive resolution ──────────────────────────────────────────────────
// Keeps frame time near the target by scaling the pixel ratio between 55% and 100% of max.
class ResolutionGovernor {
  private ema = 16;
  private scale = 1;
  private cool = 0;
  onChange?: () => void;

  update(frameMs: number) {
    if (!settings.adaptiveResolution) {
      if (this.scale !== 1) { this.scale = 1; this.apply(); }
      return;
    }
    this.ema = this.ema * 0.95 + Math.min(frameMs, 100) * 0.05;
    this.cool -= frameMs;
    if (this.cool > 0) return;
    const target = settings.fpsCap === 30 ? 33.3 : 16.9;
    if (this.ema > target * 1.18 && this.scale > 0.55) { this.scale = Math.max(0.55, this.scale - 0.08); this.apply(); this.cool = 1500; }
    else if (this.ema < target * 0.82 && this.scale < 1) { this.scale = Math.min(1, this.scale + 0.05); this.apply(); this.cool = 4000; }
  }
  apply() {
    renderer.setPixelRatio(Math.max(0.5, maxPR() * this.scale));
    this.onChange?.();
  }
  get current() { return this.scale; }
}
export const governor = new ResolutionGovernor();

onSettings((_s, changed) => {
  if (changed.includes('renderScale') || changed.includes('adaptiveResolution')) governor.apply();
});
