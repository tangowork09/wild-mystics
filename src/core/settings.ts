// Persistent player settings with a tiny change-event bus. Everything that can apply live does;
// options that need a world rebuild (grass/tree density, draw distance) are flagged `restart`.

export type QualityPreset = 'auto' | 'low' | 'medium' | 'high' | 'ultra';

export interface Settings {
  quality: QualityPreset;
  renderScale: number;        // 0.5 – 1 (multiplies device pixel ratio)
  adaptiveResolution: boolean;
  fpsCap: 30 | 60 | 0;        // 0 = uncapped (vsync)
  shadows: 'off' | 'low' | 'high';
  ambientOcclusion: boolean;
  bloom: boolean;
  grassDensity: number;       // 0.25 – 1.5  (restart)
  drawDistance: number;       // 0.5 – 1.5   (restart)
  masterVolume: number;       // 0 – 1
  musicVolume: number;
  sfxVolume: number;
  ambientVolume: number;
  cameraSensitivity: number;  // 0.3 – 2
  invertY: boolean;
  cameraDistance: number;     // 5 – 18
  qteAssist: boolean;         // wider timing windows
  autoParry: boolean;         // accessibility: defence happens automatically (reduced rewards)
  parryMode: boolean;         // v3: real-time parry/dodge/jump + timed hits (Expedition-style); off = classic turn-based
  battleSpeed: 1 | 1.5 | 2;
  damageNumbers: boolean;
  screenShake: number;        // 0 – 1
  hints: boolean;
  haptics: boolean;
  touchScale: number;         // 0.8 – 1.3
  touchOpacity: number;       // 0.4 – 1
  leftHanded: boolean;
  dayLength: number;          // real minutes per in-game day
}

export const DEFAULTS: Settings = {
  quality: 'auto', renderScale: 1, adaptiveResolution: true, fpsCap: 60, shadows: 'high', ambientOcclusion: true, bloom: true,
  grassDensity: 1, drawDistance: 1, masterVolume: 0.9, musicVolume: 0.55, sfxVolume: 0.85, ambientVolume: 0.6,
  cameraSensitivity: 1, invertY: false, cameraDistance: 10, qteAssist: false, autoParry: false, parryMode: false, battleSpeed: 1,
  damageNumbers: true, screenShake: 1, hints: true, haptics: true, touchScale: 1, touchOpacity: 0.85, leftHanded: false, dayLength: 24,
};

const KEY = 'wm-settings';
type Listener = (s: Settings, changed: (keyof Settings)[]) => void;
const listeners = new Set<Listener>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

export const settings: Settings = load();

export function setSettings(patch: Partial<Settings>) {
  const changed = (Object.keys(patch) as (keyof Settings)[]).filter((k) => settings[k] !== patch[k]);
  if (!changed.length) return;
  Object.assign(settings, patch);
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  listeners.forEach((l) => l(settings, changed));
}

export function onSettings(l: Listener) { listeners.add(l); return () => listeners.delete(l); }

export const RESTART_KEYS: (keyof Settings)[] = ['quality', 'grassDensity', 'drawDistance'];
