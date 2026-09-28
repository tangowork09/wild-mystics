import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, HueSaturationEffect, BrightnessContrastEffect,
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

const BASE = {
  low: { pixelRatio: 1, shadow: 1024, ao: false, grass: 14000, grassRadius: 30, trees: 0.42, bloom: false, far: 300, fog: 0.0058, terrainSeg: 200, colorMap: 1024, wildView: 55 },
  medium: { pixelRatio: 1.5, shadow: 1536, ao: false, grass: 36000, grassRadius: 42, trees: 0.6, bloom: true, far: 420, fog: 0.0042, terrainSeg: 280, colorMap: 1536, wildView: 65 },
  high: { pixelRatio: 2, shadow: 2048, ao: true, grass: 90000, grassRadius: 58, trees: 1, bloom: true, far: 2400, fog: 0.0029, terrainSeg: 360, colorMap: 2048, wildView: 80 },
  ultra: { pixelRatio: 2, shadow: 4096, ao: true, grass: 140000, grassRadius: 70, trees: 1.25, bloom: true, far: 2400, fog: 0.0026, terrainSeg: 440, colorMap: 2048, wildView: 95 },
}[tier];

/** Effective quality knobs = tier baseline × user settings. */
export const Q = {
  ...BASE,
  grass: Math.round(BASE.grass * settings.grassDensity),
  trees: BASE.trees * Math.min(1.3, settings.grassDensity * 0.3 + 0.7),
  far: BASE.far === 2400 ? 2400 : Math.round(BASE.far * settings.drawDistance),
  fog: BASE.fog / Math.max(0.5, settings.drawDistance),
  shadow: settings.shadows === 'off' ? 0 : settings.shadows === 'low' ? Math.min(1024, BASE.shadow) : BASE.shadow,
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
renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in the post chain

export interface Pipeline {
  composer: EffectComposer;
  render(dt: number): void;
  setSize(w: number, h: number): void;
  bloom?: BloomEffect;
  vignette: VignetteEffect;
  grade: HueSaturationEffect;
  contrast: BrightnessContrastEffect;
}

export function makePipeline(scene: THREE.Scene, camera: THREE.PerspectiveCamera, opts: { ao?: boolean; bloomStrength?: number } = {}): Pipeline {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));
  if (Q.ao && opts.ao !== false) {
    const ao = new N8AOPostPass(scene, camera, innerWidth, innerHeight);
    ao.configuration.aoRadius = 3.0;
    ao.configuration.distanceFalloff = 1.2;
    ao.configuration.intensity = 2.2;
    ao.configuration.color = new THREE.Color('#1a1020');
    ao.configuration.halfRes = true;
    ao.configuration.depthAwareUpsampling = true;
    ao.setQualityMode(tier === 'ultra' ? 'High' : 'Medium');
    composer.addPass(ao);
  }
  const effects = [];
  let bloom: BloomEffect | undefined;
  if (Q.bloom) {
    // threshold above 1: only HDR highlights (emissives, sun glints, lanterns) bloom — daylit surfaces stay crisp
    bloom = new BloomEffect({ intensity: opts.bloomStrength ?? 0.7, luminanceThreshold: 1.08, luminanceSmoothing: 0.3, mipmapBlur: true, radius: 0.6 });
    effects.push(bloom);
  }
  const grade = new HueSaturationEffect({ saturation: 0.12, hue: 0 });
  const contrast = new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.08 });
  const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.55 });
  effects.push(new ToneMappingEffect({ mode: ToneMappingMode.AGX }), grade, contrast, vignette);
  composer.addPass(new EffectPass(camera, ...effects));
  // SMAA is cheap on desktop; on low tier we rely on the higher pixel density of phones instead
  if (tier !== 'low') composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: tier === 'medium' ? SMAAPreset.MEDIUM : SMAAPreset.HIGH })));

  return {
    composer, bloom, vignette, grade, contrast,
    render(dt) { composer.render(dt); },
    setSize(w, h) { composer.setSize(w, h); },
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
