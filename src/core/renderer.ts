import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, HueSaturationEffect, BrightnessContrastEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export type QualityTier = 'high' | 'medium' | 'low';

function detectTier(): QualityTier {
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'high' || q === 'medium' || q === 'low') return q;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  if (coarse) return mem >= 6 ? 'medium' : 'low';
  return 'high';
}

export const tier: QualityTier = detectTier();
export const Q = {
  high: { pixelRatio: Math.min(devicePixelRatio, 2), shadow: 2048, ao: true, grass: 90000, grassRadius: 58, trees: 1, bloom: true, far: 2400, fog: 0.0031 },
  medium: { pixelRatio: Math.min(devicePixelRatio, 1.5), shadow: 1536, ao: false, grass: 36000, grassRadius: 42, trees: 0.6, bloom: true, far: 420, fog: 0.0042 },
  low: { pixelRatio: 1, shadow: 1024, ao: false, grass: 14000, grassRadius: 30, trees: 0.42, bloom: false, far: 300, fog: 0.0058 },
}[tier];

export const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, preserveDrawingBuffer: new URLSearchParams(location.search).has('shot') });
renderer.setPixelRatio(Q.pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    ao.setQualityMode('Medium');
    composer.addPass(ao);
  }
  const effects = [];
  let bloom: BloomEffect | undefined;
  if (Q.bloom) {
    bloom = new BloomEffect({ intensity: opts.bloomStrength ?? 0.85, luminanceThreshold: 0.92, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.65 });
    effects.push(bloom);
  }
  const grade = new HueSaturationEffect({ saturation: 0.12, hue: 0 });
  const contrast = new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.08 });
  const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.55 });
  effects.push(new ToneMappingEffect({ mode: ToneMappingMode.AGX }), grade, contrast, vignette);
  composer.addPass(new EffectPass(camera, ...effects));
  composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: tier === 'high' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM })));

  return {
    composer, bloom, vignette, grade, contrast,
    render(dt) { composer.render(dt); },
    setSize(w, h) { composer.setSize(w, h); },
  };
}
