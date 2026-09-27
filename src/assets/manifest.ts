import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
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
}

type Many = ModelEntry | ModelEntry[];

export interface Manifest {
  player?: ModelEntry;
  npcs?: ModelEntry[];
  creatures?: Record<string, ModelEntry & { portrait?: string }>;
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
const loader = new GLTFLoader();
const asList = (e: Many | null | undefined) => (e ? (Array.isArray(e) ? e : [e]) : []);

export async function loadManifest(onProgress?: (msg: string, frac: number) => void) {
  try {
    const res = await fetch('assets/manifest.json', { cache: 'no-cache' });
    if (res.ok) manifest = await res.json();
  } catch { manifest = {}; }
  if (new URLSearchParams(location.search).has('placeholders')) manifest = {};

  const entries: ModelEntry[] = [
    ...asList(manifest.player),
    ...(manifest.npcs ?? []),
    ...Object.values(manifest.creatures ?? {}),
    ...Object.values(manifest.environment ?? {}).flatMap(asList),
    ...Object.values(manifest.buildings ?? {}).flatMap(asList),
    ...Object.values(manifest.decor ?? {}).flatMap(asList),
  ].filter((e) => e && e.model);
  const unique = [...new Map(entries.map((e) => [e.model, e])).values()];

  let done = 0;
  const queue = [...unique];
  const worker = async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      try {
        const g = await loader.loadAsync(`assets/${e.model}`);
        g.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
        });
        gltfs.set(e.model, g);
      } catch (err) {
        console.warn(`[assets] ${e.model} failed, using placeholder`, err);
      }
      done++;
      onProgress?.(`Loading models ${done}/${unique.length}`, done / Math.max(1, unique.length));
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

export function getManifest() { return manifest; }
export const hasModel = (m?: string) => !!m && gltfs.has(m);

function findClip(g: GLTF, want: string): THREE.AnimationClip | undefined {
  const lw = want.toLowerCase();
  return g.animations.find((c) => c.name === want)
    ?? g.animations.find((c) => c.name.split('|').pop() === want)
    ?? g.animations.find((c) => (c.name.split('|').pop() ?? '').toLowerCase() === lw);
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
  const get = (name: AnimName): THREE.AnimationAction | null => {
    if (actions.has(name)) return actions.get(name)!;
    const clip = findClip(g, entry.anims?.[name] ?? name);
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
    if (r) { if (shiny) tintShiny(r); return r; }
  }
  return buildCreature(sp.look, shiny);
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
  const custom = manifest.creatures?.[speciesId]?.portrait;
  if (custom) return `assets/${custom}`;
  const key = speciesId + (shiny ? '*' : '');
  const hit = portraitCache.get(key);
  if (hit) return hit;
  try {
    if (!pr) {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setSize(192, 192, false);
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
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const dist = Math.max(size.y, size.x * 0.9) / (2 * Math.tan(THREE.MathUtils.degToRad(14))) * 1.08;
    pr.cam.position.set(center.x, center.y + size.y * 0.05, center.z + dist);
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
