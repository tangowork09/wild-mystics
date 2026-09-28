import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { SPECIES, type Species } from '../data/species';
import { ELEMENTS } from '../data/elements';
import { tier } from '../core/renderer';
import { buildCreature, buildPlayer, type AnimName, type Rig } from './placeholders';
import { prepareModel, Look, LOOK, rimOverride, resetGlobals, type PreparedInfo } from './stylize';
import { dress, tickDressing, groundAura, wisps, glowShell, anchorOf, type AccSpec, type Dressing } from './accessories';

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
      // animated poses can leave the rest-pose bounds: keep frustum culling with a generous sphere
      s.boundingSphere!.radius *= 1.6;
      s.frustumCulled = true;
    }
  });
  const box = new THREE.Box3();
  o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) box.union(new THREE.Box3().setFromObject(m)); });
  return box.isEmpty() ? new THREE.Box3().setFromObject(o) : box;
}

// v3: every GLB is converted once (primitives merged into one vertex-coloured skinned mesh per skeleton)
const prepared = new WeakMap<GLTF, PreparedInfo>();
function prep(g: GLTF) {
  let p = prepared.get(g);
  if (!p) { p = prepareModel(g.scene); prepared.set(g, p); }
  return p;
}
/** Outlines are the expensive part of the look: off on the low tier. */
export const OUTLINES = tier !== 'low';

interface GltfRig { rig: Rig; model: THREE.Object3D; info: PreparedInfo }

function rigFromGltf(entry: ModelEntry, fallbackHeight: number, heightMul = 1): GltfRig | null {
  const g = gltfs.get(entry.model);
  if (!g) return null;
  const info = prep(g);
  const root = new THREE.Group();
  const model = skeletonClone(g.scene);
  const box = measure(model);
  const h = box.max.y - box.min.y || 1;
  const targetH = (entry.height ?? fallbackHeight) * heightMul;
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
    const want = entry.anims?.[name] ?? (name === 'graze' ? undefined : name);
    const clip = want ? findClip(clips, want) : undefined;
    const a = clip ? mixer.clipAction(clip) : null;
    actions.set(name, a);
    return a;
  };
  let current: THREE.AnimationAction | null = get('idle');
  current?.play();
  // desynchronise herds: every clone starts its idle at a different phase
  if (current) current.time = Math.random() * current.getClip().duration;
  let loop: AnimName = 'idle';
  let rest: AnimName = 'idle';
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

  const rig: Rig = {
    root,
    height: targetH,
    has: (name) => !!get(name),
    play(name) {
      if (name === 'faint') { dead = true; fadeTo(get('faint'), true, 0.12); return; }
      if (name === 'idle' || name === 'graze') {
        dead = false;
        rest = name === 'graze' && get('graze') ? 'graze' : 'idle';
        if (!oneShot && loop !== 'run' && loop !== 'walk') { loop = rest; fadeTo(get(rest), false, 0.35); }
        return;
      }
      if (name === 'run' || name === 'walk') {
        dead = false;
        loop = name;
        if (!oneShot) fadeTo(get(name) ?? get('run'), false);
        return;
      }
      if (!fadeTo(get(name), true, 0.1) && name === 'cast') fadeTo(get('attack'), true, 0.1);
    },
    update(dt, moving) {
      if (!dead && !oneShot) {
        const want: AnimName = moving > 0.6 ? 'run' : moving > 0.05 ? (get('walk') ? 'walk' : 'run') : rest;
        if (want !== loop) { loop = want; fadeTo(get(want) ?? get('run') ?? get('idle'), false); }
        const a = actions.get(loop);
        if (a && loop !== 'idle' && loop !== 'graze') a.timeScale = loop === 'run' ? THREE.MathUtils.clamp(moving * 1.15, 0.8, 1.4) : 1;
      }
      mixer.update(dt);
    },
  };
  return { rig, model, info };
}

export interface CreatureRigOptions {
  /** Elite ~1.6× Alpha with a crown and a war-aura. */
  alpha?: boolean;
  /** Skip the ground auras (portraits, UI previews). */
  noAura?: boolean;
}

/** Regional forms, Guardians, Alphas and shinies: accessories, auras, sparkles. Wraps update() to tick them. */
function decorate(r: Rig, model: THREE.Object3D, sp: Species, shiny: boolean, o: CreatureRigOptions, cacheKey: string) {
  const look = r.look!;
  const specs: AccSpec[] = [...(sp.acc ?? [])];
  if (o.alpha) specs.push({ k: 'crown', on: 'headTop', s: 0.2, at: [0, -0.01, 0] });
  let dressing: Dressing | null = null;
  if (specs.length) dressing = dress(model, r.root, r.height, look, specs, cacheKey);
  const el = ELEMENTS[sp.element].color;
  const reg = () => anchorOf(r.root, r.height, 'root');
  if (!o.noAura) {
    if (sp.boss) {
      const size = reg().size;
      const rad = Math.max(size.x, size.z) * 0.62 + r.height * 0.1;
      r.root.add(groundAura(el, rad, 'boss', sp.element2 ? ELEMENTS[sp.element2].color : '#ffffff'));
      r.root.add(wisps(el, 26, rad * 0.8, r.height * 1.1, false, 0.5));
      for (const b of [...look.bodies]) if (!b.userData.wmFx && (b as THREE.SkinnedMesh).isSkinnedMesh) glowShell(b, el, r.height * 0.012, 0.9);
    } else if (o.alpha) {
      const size = reg().size;
      const rad = Math.max(size.x, size.z) * 0.6 + 0.4;
      r.root.add(groundAura('#ff5a3a', rad, 'alpha', '#ffd76a'));
      r.root.add(wisps('#ffb04a', 16, rad * 0.7, r.height * 0.9, false, 0.4));
      for (const b of [...look.bodies]) if ((b as THREE.SkinnedMesh).isSkinnedMesh) glowShell(b, '#ff7a3a', r.height * 0.01, 0.55);
    } else if (sp.rarity === 'legendary') {
      r.root.add(wisps(el, 14, r.height * 0.45, r.height, false, 0.4));
    }
  }
  if (shiny) r.root.add(wisps('#fff4d8', 18, r.height * 0.5, r.height * 1.1, true, 0.55));
  const inner = r.update;
  let t = Math.random() * 10;
  r.update = (dt, moving) => {
    t += dt;
    inner(dt, moving);
    look.update(dt);
    if (dressing) tickDressing(dressing, t);
  };
}

function lookFor(sp: Species, shiny: boolean, info?: PreparedInfo) {
  return { kind: 'creature' as const, element: sp.element, element2: sp.element2, tint: sp.tint, tintGlow: sp.tintGlow, shiny, outline: OUTLINES, gloss: info?.gloss };
}

export function makeCreatureRig(speciesId: string, shiny = false, opts: CreatureRigOptions = {}): Rig {
  const sp = SPECIES[speciesId];
  const entry = manifest.creatures?.[speciesId];
  const mul = opts.alpha ? 1.6 : 1;
  if (entry) {
    const r = rigFromGltf(entry, sp.height, mul);
    if (r) {
      r.rig.look = new Look(r.rig.root, lookFor(sp, shiny, r.info));
      decorate(r.rig, r.model, sp, shiny, opts, `${entry.model}`);
      return r.rig;
    }
    void loadOne(entry.model);
  }
  const rig = buildCreature(sp.look, false);
  if (mul !== 1) { rig.root.scale.multiplyScalar(mul); rig.height *= mul; }
  rig.look = new Look(rig.root, lookFor(sp, shiny));
  decorate(rig, rig.root, sp, shiny, opts, `ph:${speciesId}`);
  return rig;
}

export function makePlayerRig(): Rig {
  if (manifest.player) {
    const r = rigFromGltf(manifest.player, 1.75);
    if (r) {
      r.rig.look = new Look(r.rig.root, { kind: 'human', outline: OUTLINES, gloss: 0.35, ink: '#1c1420' });
      const inner = r.rig.update;
      r.rig.update = (dt, m) => { inner(dt, m); r.rig.look!.update(dt); };
      return r.rig;
    }
  }
  const p = buildPlayer();
  p.look = new Look(p.root, { kind: 'human', outline: OUTLINES });
  return p;
}

export function makeNpcRig(i: number): Rig | null {
  const list = (manifest.npcs ?? []).filter((e) => gltfs.has(e.model));
  if (!list.length) return null;
  const r = rigFromGltf(list[i % list.length], 1.7);
  if (!r) return null;
  r.rig.look = new Look(r.rig.root, { kind: 'human', outline: OUTLINES, gloss: 0.35, ink: '#1c1420' });
  const inner = r.rig.update;
  r.rig.update = (dt, m) => { inner(dt, m); r.rig.look!.update(dt); };
  return r.rig;
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
let pr: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera; kick: THREE.DirectionalLight } | null = null;

export function portrait(speciesId: string, shiny = false): string {
  const e = manifest.creatures?.[speciesId];
  const baked = shiny ? e?.portraitShiny ?? e?.portrait : e?.portrait;
  if (baked) return `assets/${baked}`;
  return renderPortrait(speciesId, shiny);
}

/** Render a portrait from the live rig (used by the bake tool, and as a fallback): stylised, dramatic three-point light. */
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
      renderer.toneMappingExposure = 1.35;
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight('#dfe8ff', '#3a2c48', 1.5));
      const key = new THREE.DirectionalLight('#fff0dc', 3.4); key.position.set(-2.6, 4.2, 4.2); scene.add(key); key.castShadow = true; key.shadow.mapSize.set(8, 8);
      const rim = new THREE.DirectionalLight('#cfe6ff', 3.2); rim.position.set(4, 3.2, -4.5); scene.add(rim);
      const kick = new THREE.DirectionalLight('#ffffff', 1.4); kick.position.set(-3.5, -0.6, -2.5); scene.add(kick);
      const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 400);
      pr = { renderer, scene, cam, kick };
    }
    if (pr.renderer.domElement.width !== size) pr.renderer.setSize(size, size, false);
    const sp = SPECIES[speciesId];
    pr.kick.color.set(ELEMENTS[sp.element].color);
    const rig = makeCreatureRig(speciesId, shiny, { noAura: true });
    rig.update(0.4, 0);
    rig.root.rotation.y = -0.5;
    pr.scene.add(rig.root);
    rig.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    rig.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !m.userData.wmFx && !m.userData.wmOutline) { if ((m as THREE.SkinnedMesh).isSkinnedMesh) (m as THREE.SkinnedMesh).computeBoundingBox(); box.union(new THREE.Box3().setFromObject(m)); } });
    const bsz = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const fov = THREE.MathUtils.degToRad(13);
    const dist = Math.max(bsz.y * 1.02, bsz.x * 0.92, bsz.z * 0.6) / (2 * Math.tan(fov)) * 1.1;
    pr.cam.position.set(center.x + dist * 0.08, center.y - bsz.y * 0.04, center.z + dist);
    pr.cam.lookAt(center.x, center.y + bsz.y * 0.02, center.z);
    pr.cam.updateMatrixWorld(true);
    // rim from the upper right of the frame, cool and bright; outlines a touch heavier than in-world
    rimOverride.dir = new THREE.Vector3(0.75, 0.55, -0.35).normalize();
    rimOverride.color = new THREE.Color('#e6f4ff').multiplyScalar(1.25);
    const k0 = LOOK.uOutlineMin.value;
    LOOK.uOutlineMin.value = Math.max(k0, bsz.y * 0.011);
    resetGlobals();
    pr.renderer.render(pr.scene, pr.cam);
    LOOK.uOutlineMin.value = k0;
    rimOverride.dir = null;
    rimOverride.color = null;
    resetGlobals();
    const url = pr.renderer.domElement.toDataURL('image/png');
    pr.scene.remove(rig.root);
    portraitCache.set(key, url);
    return url;
  } catch (e) {
    console.warn('[portrait]', speciesId, e);
    return '';
  }
}
