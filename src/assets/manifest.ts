import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SPECIES } from '../data/species';
import { buildCreature, buildPlayer, type AnimName, type Rig } from './placeholders';

/**
 * Asset contract (see ASSETS.md). Every entry is optional — a missing or broken file
 * falls back to the procedural placeholder, so art can be dropped in one piece at a time.
 */
export interface ModelEntry {
  model: string;
  /** Target height in metres. Model is uniformly scaled to fit. Omit to use raw scale. */
  height?: number;
  /** Extra Y rotation (radians) if the model doesn't face +Z. */
  rotY?: number;
  /** Map our animation names to clip names in the GLB (prefixes like "Armature|" are ignored). */
  anims?: Partial<Record<AnimName, string>>;
  /** Borrow animation clips from another GLB with the same skeleton (bone names must match). */
  animSource?: string;
}

type Many = ModelEntry | ModelEntry[];

export interface Manifest {
  player?: ModelEntry;
  npcs?: ModelEntry[];
  creatures?: Record<string, ModelEntry & { portrait?: string; portraitShiny?: string; tint?: string }>;
  /** Each key may list several variants; props pick randomly between them. */
  environment?: Record<string, Many>;
  buildings?: Record<string, Many>;
  decor?: Record<string, Many | null>;
  textures?: Record<string, string>;
  vfx?: Record<string, string>;
  music?: Record<string, string>;
}

let manifest: Manifest = {};
const gltfs = new Map<string, GLTF>();
const pending = new Map<string, Promise<void>>();
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const asList = (e: Many | null | undefined) => (e ? (Array.isArray(e) ? e : [e]) : []);

/** Fetch the manifest only. Models stream in on demand via ensureModels(). */
export async function loadManifest() {
  try {
    const res = await fetch('assets/manifest.json', { cache: 'no-cache' });
    if (res.ok) manifest = await res.json();
  } catch { manifest = {}; }
  if (new URLSearchParams(location.search).has('placeholders')) manifest = {};
}

function loadOne(model: string): Promise<void> {
  if (gltfs.has(model)) return Promise.resolve();
  let p = pending.get(model);
  if (p) return p;
  p = loader.loadAsync(`assets/${model}`).then((g) => {
    g.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });
    gltfs.set(model, g);
  }).catch((err) => { console.warn(`[assets] ${model} failed, using placeholder`, err); });
  pending.set(model, p);
  return p;
}

/** Load a set of model paths with bounded concurrency. */
export async function ensureModels(models: string[], onProgress?: (done: number, total: number) => void, concurrency = 6) {
  const todo = [...new Set(models.filter((m) => m && !gltfs.has(m)))];
  let done = 0;
  const queue = [...todo];
  const worker = async () => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      await loadOne(m);
      done++;
      onProgress?.(done, todo.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
}

export const creatureModel = (id: string) => manifest.creatures?.[id]?.model ?? '';
export const hasCreatureModel = (id: string) => gltfs.has(creatureModel(id));
export async function ensureCreatures(ids: string[]) { await ensureModels(ids.map(creatureModel)); }

/** Everything the overworld needs before the first frame (environment, town, people). */
export function essentialModels(): string[] {
  return [
    ...asList(manifest.player),
    ...(manifest.npcs ?? []),
    ...(manifest.npcs ?? []).filter((n) => n.animSource).map((n) => ({ model: n.animSource! })),
    ...Object.values(manifest.environment ?? {}).flatMap(asList),
    ...Object.values(manifest.buildings ?? {}).flatMap(asList),
    ...Object.values(manifest.decor ?? {}).flatMap(asList),
  ].filter((e) => e && e.model).map((e) => e.model);
}

/** Stream every remaining creature model at low priority after boot. */
export function streamRemainingCreatures() {
  const all = Object.values(manifest.creatures ?? {}).map((e) => e.model).filter((m) => m && !gltfs.has(m));
  void ensureModels(all, undefined, 2);
}

export function getManifest() { return manifest; }
export const hasModel = (m?: string) => !!m && gltfs.has(m);

function findClip(clips: THREE.AnimationClip[], want: string): THREE.AnimationClip | undefined {
  const lw = want.toLowerCase();
  return clips.find((c) => c.name === want)
    ?? clips.find((c) => c.name.split('|').pop() === want)
    ?? clips.find((c) => (c.name.split('|').pop() ?? '').toLowerCase() === lw);
}

/** Bounding box that respects skinning (bone matrices must be current before measuring). */
function measure(o: THREE.Object3D) {
  o.updateMatrixWorld(true);
  o.traverse((c) => {
    const s = c as THREE.SkinnedMesh;
    if (s.isSkinnedMesh) {
      s.skeleton.update();
      s.computeBoundingBox();
      s.computeBoundingSphere();
      s.frustumCulled = false; // animated poses can leave the bind-pose bounds
    }
  });
  return new THREE.Box3().setFromObject(o);
}

function rigFromGltf(entry: ModelEntry, fallbackHeight: number): Rig | null {
  const g = gltfs.get(entry.model);
  if (!g) return null;
  const root = new THREE.Group();
  const model = skeletonClone(g.scene);
  const box = measure(model);
  const h = box.max.y - box.min.y || 1;
  const targetH = entry.height ?? fallbackHeight;
  const s = targetH / h;
  model.scale.setScalar(s);
  model.position.y = -box.min.y * s;
  model.rotation.y = entry.rotY ?? 0;
  root.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map<AnimName, THREE.AnimationAction | null>();
  const clips = entry.animSource ? gltfs.get(entry.animSource)?.animations ?? g.animations : g.animations;
  const get = (name: AnimName): THREE.AnimationAction | null => {
    if (actions.has(name)) return actions.get(name)!;
    const clip = findClip(clips, entry.anims?.[name] ?? name);
    const a = clip ? mixer.clipAction(clip) : null;
    actions.set(name, a);
    return a;
  };
  let current: THREE.AnimationAction | null = get('idle');
  current?.play();
  let loop: AnimName = 'idle';
  let oneShot = false;
  let dead = false;

  const fadeTo = (a: THREE.AnimationAction | null, once: boolean, fade = 0.18) => {
    if (!a) return false;
    if (a === current && !once) return true;
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    a.clampWhenFinished = once;
    a.enabled = true;
    a.setEffectiveWeight(1);
    a.play();
    if (current && current !== a) current.crossFadeTo(a, fade, false);
    current = a;
    oneShot = once;
    return true;
  };
  mixer.addEventListener('finished', (e) => {
    if (dead) return;
    if (e.action === current && oneShot) { oneShot = false; fadeTo(get(loop), false, 0.25); }
  });

  return {
    root,
    height: targetH,
    play(name) {
      if (name === 'faint') { dead = true; fadeTo(get('faint'), true, 0.12); return; }
      if (name === 'idle' || name === 'run' || name === 'walk') {
        dead = false;
        loop = name;
        if (!oneShot) fadeTo(get(name) ?? get('run'), false);
        return;
      }
      if (!fadeTo(get(name), true, 0.1) && name === 'cast') fadeTo(get('attack'), true, 0.1);
    },
    update(dt, moving) {
      if (!dead && !oneShot) {
        const want: AnimName = moving > 0.6 ? 'run' : moving > 0.05 ? (get('walk') ? 'walk' : 'run') : 'idle';
        if (want !== loop) { loop = want; fadeTo(get(want) ?? get('run'), false); }
        const a = actions.get(loop);
        if (a && loop !== 'idle') a.timeScale = loop === 'run' ? THREE.MathUtils.clamp(moving * 1.15, 0.8, 1.4) : 1;
      }
      mixer.update(dt);
    },
  };
}

function tintShiny(r: Rig) {
  r.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((mt) => {
      const c = (mt as THREE.MeshStandardMaterial).clone();
      if (c.color) c.color.offsetHSL(0.42, 0.08, 0.02);
      return c;
    });
    m.material = Array.isArray(m.material) ? mats : mats[0];
  });
}

export function makeCreatureRig(speciesId: string, shiny = false): Rig {
  const sp = SPECIES[speciesId];
  const entry = manifest.creatures?.[speciesId];
  if (entry) {
    const r = rigFromGltf(entry, sp.height);
    if (r) {
      if (sp.tint) tintVariant(r, sp.tint, sp.tintGlow);
      if (shiny) tintShiny(r);
      return r;
    }
    void loadOne(entry.model);
  }
  return buildCreature(sp.look, shiny);
}

/** Regional/elemental variant: hue-shift toward `tint`, optional emissive glow. */
function tintVariant(r: Rig, tint: string, glow?: string) {
  const target = new THREE.Color(tint);
  const hsl = { h: 0, s: 0, l: 0 };
  target.getHSL(hsl);
  r.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((mt) => {
      const c = (mt as THREE.MeshStandardMaterial).clone();
      if (c.color) {
        const own = { h: 0, s: 0, l: 0 };
        c.color.getHSL(own);
        // keep very dark/light details (eyes, teeth) but pull saturated body colours to the tint hue
        if (own.s > 0.12 && own.l > 0.08 && own.l < 0.92) c.color.setHSL(hsl.h, Math.min(1, (own.s + hsl.s) / 2 + 0.05), own.l * 0.85 + hsl.l * 0.15);
      }
      if (glow && 'emissive' in c) { c.emissive = new THREE.Color(glow); c.emissiveIntensity = 0.18; }
      return c;
    });
    m.material = Array.isArray(m.material) ? mats : mats[0];
  });
}

export function makePlayerRig(): Rig {
  if (manifest.player) {
    const r = rigFromGltf(manifest.player, 1.75);
    if (r) return r;
  }
  return buildPlayer();
}

export function makeNpcRig(i: number): Rig | null {
  const list = (manifest.npcs ?? []).filter((e) => gltfs.has(e.model));
  if (!list.length) return null;
  return rigFromGltf(list[i % list.length], 1.7);
}

function instantiate(entry: ModelEntry): THREE.Object3D | null {
  const g = gltfs.get(entry.model);
  if (!g) return null;
  const m = g.scene.clone(true);
  if (entry.height) {
    const box = new THREE.Box3().setFromObject(m);
    const s = entry.height / (box.max.y - box.min.y || 1);
    m.scale.setScalar(s);
    m.position.y = -box.min.y * s;
  }
  m.rotation.y = entry.rotY ?? 0;
  const wrap = new THREE.Group();
  wrap.add(m);
  return wrap;
}

/** Returns a cloned GLB for a building/decor key (random or indexed variant), or null to use a placeholder. */
export function envModel(kind: 'environment' | 'buildings' | 'decor', key: string, variant?: number): THREE.Object3D | null {
  const list = asList(manifest[kind]?.[key]).filter((e) => gltfs.has(e.model));
  if (!list.length) return null;
  return instantiate(list[variant !== undefined ? variant % list.length : Math.floor(Math.random() * list.length)]);
}

/** All loaded variants for an environment key, or null if none are available. */
export function envVariants(key: string): THREE.Object3D[] | null {
  const list = asList(manifest.environment?.[key]).map(instantiate).filter((o): o is THREE.Object3D => !!o);
  return list.length ? list : null;
}

// ── Textures ──────────────────────────────────────────────────────────────
const texLoader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture | null>();
export function manifestTexture(group: 'textures' | 'vfx', key: string, srgb = true): THREE.Texture | null {
  const url = manifest[group]?.[key];
  if (!url) return null;
  const ck = `${group}:${key}`;
  if (texCache.has(ck)) return texCache.get(ck)!;
  const t = texLoader.load(`assets/${url}`);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (group === 'textures') { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  texCache.set(ck, t);
  return t;
}

export async function preloadTextures() {
  const all: Promise<unknown>[] = [];
  for (const group of ['textures', 'vfx'] as const) {
    for (const key of Object.keys(manifest[group] ?? {})) {
      const url = manifest[group]![key];
      all.push(texLoader.loadAsync(`assets/${url}`).then((t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        if (group === 'textures') { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
        texCache.set(`${group}:${key}`, t);
      }).catch(() => texCache.set(`${group}:${key}`, null)));
    }
  }
  await Promise.all(all);
}

// ── Portraits: rendered from the actual rig (GLB or placeholder) ──────────
const portraitCache = new Map<string, string>();
let pr: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera } | null = null;

export function portrait(speciesId: string, shiny = false): string {
  const e = manifest.creatures?.[speciesId];
  const baked = shiny ? e?.portraitShiny ?? e?.portrait : e?.portrait;
  if (baked) return `assets/${baked}`;
  return renderPortrait(speciesId, shiny);
}

/** Render a portrait from the live rig (used by the bake tool, and as a fallback). */
export function renderPortrait(speciesId: string, shiny = false, size = 192): string {
  const key = speciesId + (shiny ? '*' : '') + size;
  const hit = portraitCache.get(key);
  if (hit) return hit;
  try {
    if (!pr) {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setSize(size, size, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.AgXToneMapping;
      renderer.toneMappingExposure = 1.25;
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight('#ffffff', '#6a5a7a', 2.4));
      const d = new THREE.DirectionalLight('#fff4e0', 3); d.position.set(2, 4, 5); scene.add(d);
      const rim = new THREE.DirectionalLight('#9ad8ff', 2); rim.position.set(-4, 2, -3); scene.add(rim);
      const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
      pr = { renderer, scene, cam };
    }
    const rig = makeCreatureRig(speciesId, shiny);
    rig.update(0.4, 0);
    rig.root.rotation.y = -0.45;
    pr.scene.add(rig.root);
    const box = measure(rig.root);
    const bsz = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const dist = Math.max(bsz.y, bsz.x * 0.9) / (2 * Math.tan(THREE.MathUtils.degToRad(14))) * 1.08;
    pr.cam.position.set(center.x, center.y + bsz.y * 0.05, center.z + dist);
    pr.cam.lookAt(center);
    pr.renderer.render(pr.scene, pr.cam);
    const url = pr.renderer.domElement.toDataURL('image/png');
    pr.scene.remove(rig.root);
    portraitCache.set(key, url);
    return url;
  } catch {
    return '';
  }
}
