// SFX: files in public/assets/audio/<name>.mp3 (Kenney CC0 via tools/import-assets.mjs),
// with a WebAudio synth fallback so every cue still sounds if a file is missing.
// Music: looping tracks listed in manifest.music, crossfaded.

import { getManifest } from '../assets/manifest';

export type Sfx =
  | 'hit' | 'hit2' | 'slash' | 'quake' | 'perfect' | 'parry' | 'dodge' | 'miss' | 'select' | 'back' | 'open' | 'error'
  | 'capture' | 'captured' | 'orb' | 'break' | 'heal' | 'levelup' | 'encounter' | 'faint' | 'coin' | 'step';

let ctx: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer | null>();
let sfxGain: GainNode | null = null;

function ac() {
  if (!ctx) {
    ctx = new AudioContext();
    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.7;
    sfxGain.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

async function loadBuf(name: string): Promise<AudioBuffer | null> {
  if (buffers.has(name)) return buffers.get(name)!;
  buffers.set(name, null);
  try {
    const res = await fetch(`assets/audio/${name}.mp3`);
    if (!res.ok) return null;
    const buf = await ac().decodeAudioData(await res.arrayBuffer());
    buffers.set(name, buf);
    return buf;
  } catch { return null; }
}

/** Warm the SFX cache after the first user gesture. */
export function preloadSfx() {
  const names: Sfx[] = ['hit', 'hit2', 'slash', 'quake', 'perfect', 'parry', 'dodge', 'miss', 'select', 'back', 'open', 'error', 'capture', 'captured', 'orb', 'break', 'heal', 'levelup', 'encounter', 'faint', 'coin'];
  names.forEach((n) => void loadBuf(n));
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.15, slide = 0, delay = 0) {
  const a = ac();
  const t0 = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(sfxGain!);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur: number, vol = 0.2, delay = 0) {
  const a = ac();
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = a.createBufferSource();
  const g = a.createGain();
  g.gain.value = vol;
  s.buffer = buf;
  s.connect(g).connect(sfxGain!);
  s.start(a.currentTime + delay);
}

let muted = false;
export function setMuted(m: boolean) {
  muted = m;
  if (current) current.el.muted = m;
}
export const isMuted = () => muted;

export function sfx(name: Sfx, vol = 1) {
  if (muted) return;
  try {
    const a = ac();
    const buf = buffers.get(name);
    if (buf) {
      const s = a.createBufferSource();
      const g = a.createGain();
      g.gain.value = vol;
      s.buffer = buf;
      s.playbackRate.value = 0.94 + Math.random() * 0.12;
      s.connect(g).connect(sfxGain!);
      s.start();
      if (name === 'perfect') tone(1320, 0.18, 'triangle', 0.06, 0, 0.02);
      return;
    }
    if (!buffers.has(name)) void loadBuf(name);
    switch (name) {
      case 'hit': case 'hit2': case 'slash': noise(0.12, 0.25); tone(140, 0.12, 'square', 0.08, -60); break;
      case 'quake': noise(0.4, 0.3); tone(70, 0.4, 'sawtooth', 0.1, -30); break;
      case 'perfect': tone(880, 0.1, 'triangle', 0.14); tone(1320, 0.18, 'triangle', 0.12, 0, 0.05); noise(0.1, 0.2); break;
      case 'parry': tone(1400, 0.25, 'square', 0.08, -400); tone(2100, 0.2, 'triangle', 0.1); noise(0.06, 0.3); break;
      case 'dodge': tone(500, 0.15, 'sine', 0.1, 400); break;
      case 'miss': tone(200, 0.2, 'sawtooth', 0.06, -80); break;
      case 'select': case 'open': tone(660, 0.06, 'triangle', 0.08); break;
      case 'back': tone(440, 0.06, 'triangle', 0.08); break;
      case 'error': tone(160, 0.18, 'square', 0.08); break;
      case 'capture': case 'orb': tone(300, 0.35, 'sine', 0.12, 500); break;
      case 'captured': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, 0, i * 0.1)); break;
      case 'break': noise(0.35, 0.3); tone(90, 0.4, 'square', 0.12, -40); break;
      case 'heal': [440, 554, 659].forEach((f, i) => tone(f, 0.3, 'sine', 0.08, 0, i * 0.08)); break;
      case 'levelup': [392, 523, 659, 784, 1046].forEach((f, i) => tone(f, 0.2, 'square', 0.06, 0, i * 0.07)); break;
      case 'encounter': tone(220, 0.15, 'sawtooth', 0.1); tone(330, 0.15, 'sawtooth', 0.1, 0, 0.12); tone(440, 0.3, 'sawtooth', 0.1, 0, 0.24); break;
      case 'faint': tone(300, 0.6, 'triangle', 0.1, -250); break;
      case 'coin': tone(988, 0.08, 'square', 0.06); tone(1318, 0.2, 'square', 0.06, 0, 0.08); break;
      case 'step': noise(0.05, 0.05); break;
    }
  } catch { /* audio unavailable */ }
}

// ── Music ────────────────────────────────────────────────────────────────
type Track = { name: string; el: HTMLAudioElement };
let current: Track | null = null;
let musicVol = 0.42;

function fade(el: HTMLAudioElement, to: number, ms: number, done?: () => void) {
  const from = el.volume;
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) requestAnimationFrame(step); else done?.();
  };
  requestAnimationFrame(step);
}

/** Crossfade to a track from manifest.music ('town' | 'overworld' | 'battle' | 'boss'), 'victory' jingle, or null to stop. */
export function music(name: string | null) {
  if (name === 'victory') {
    if (current) { const old = current; fade(old.el, 0, 500, () => old.el.pause()); current = null; }
    if (!muted) sfx('captured');
    return;
  }
  if (current?.name === name) return;
  if (current) { const old = current; fade(old.el, 0, 900, () => old.el.pause()); current = null; }
  if (!name) return;
  const url = getManifest().music?.[name];
  if (!url) return;
  const el = new Audio(`assets/${url}`);
  el.loop = true;
  el.volume = 0;
  el.muted = muted;
  current = { name, el };
  el.play().then(() => fade(el, musicVol, 1200)).catch(() => { /* needs a user gesture; retried on next call */ current = null; });
}

export function setMusicVolume(v: number) { musicVol = v; if (current) current.el.volume = v; }
