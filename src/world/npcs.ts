// NPC actors and the content layer's world hooks.
//
//  • NpcActors: named NPCs from data/npcs.ts stream in near the player, idle, turn to face you,
//    walk when the story says so and wear floating quest marks ("!" new quest, "?" talk to me).
//    Placement is data-driven: a TOWN_ANCHORS spot from the towns workstream when it exists,
//    otherwise a bearing/distance from the plaza; everyone is nudged clear of colliders.
//  • ContentWorld: the single system world.ts builds and updates for the content workstream —
//    NPCs, Warden Gate barriers, fog-of-war/quest ticks, the prologue leash, the cinematic camera
//    and the quiet-moment dialog queue.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { getManifest, hasModel, makeNpcRig, makeCreatureRig, ensureCreatures } from '../assets/manifest';
import { buildPlayer, type AnimName, type Rig } from '../assets/placeholders';
import { NPCS, anchorFallback, type Anchor, type NpcDef, type NpcRig } from '../data/npcs';
import { ZONES, zoneAt, zoneById, WATER_LEVEL } from '../data/zones';
import { state } from '../game/state';
import { npcMark, npcStation, locate, registerLocator, questVersion, tick as questTick } from '../game/quests';
import { tick as exploreTick, setNightProvider } from '../game/explore';
import { storyUpdate, leashed, LEASH, cinematicActive, setCinematic, type CineHooks } from '../game/story';
import { notify } from '../game/rewards';
import * as Towns from './towns';
import type { Interactable } from './towns';
import { GateBarriers } from './gates';
import { queueBust } from './busts';
import type { Overworld } from './world';

// ── rigs ──────────────────────────────────────────────────────────────────────
interface CharEntry { model: string; height?: number; rotY?: number; anims?: Partial<Record<AnimName, string>> }
const charGltf = new Map<string, GLTF>();
const charLoading = new Map<string, Promise<void>>();
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const charEntry = (key: string) => (getManifest() as { characters?: Record<string, CharEntry> }).characters?.[key];

/** Load a unique named character (manifest.characters) — returns when ready or failed. */
export function loadCharacter(key: string): Promise<void> {
  const e = charEntry(key);
  if (!e || charGltf.has(key)) return Promise.resolve();
  let p = charLoading.get(key);
  if (!p) {
    p = loader.loadAsync(`assets/${e.model}`).then((g) => { charGltf.set(key, g); }).catch((err) => console.warn(`[npcs] ${e.model} failed`, err));
    charLoading.set(key, p);
  }
  return p;
}

function measure(o: THREE.Object3D) {
  o.updateMatrixWorld(true);
  o.traverse((c) => {
    const s = c as THREE.SkinnedMesh;
    if (s.isSkinnedMesh) { s.skeleton.update(); s.computeBoundingBox(); s.computeBoundingSphere(); s.frustumCulled = false; }
  });
  return new THREE.Box3().setFromObject(o);
}

/** Rig for a named character GLB (same contract as the manifest's rigs). */
function characterRig(key: string): Rig | null {
  const g = charGltf.get(key);
  const e = charEntry(key);
  if (!g || !e) return null;
  const root = new THREE.Group();
  const model = skeletonClone(g.scene);
  model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  const box = measure(model);
  const h = box.max.y - box.min.y || 1;
  const target = e.height ?? 1.7;
  model.scale.setScalar(target / h);
  model.position.y = -box.min.y * (target / h);
  model.rotation.y = e.rotY ?? 0;
  root.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const clip = (name: AnimName) => {
    const want = (e.anims?.[name] ?? name).toLowerCase();
    return g.animations.find((c) => (c.name.split('|').pop() ?? '').toLowerCase() === want);
  };
  const actions = new Map<AnimName, THREE.AnimationAction | null>();
  const get = (n: AnimName) => { if (!actions.has(n)) { const c = clip(n); actions.set(n, c ? mixer.clipAction(c) : null); } return actions.get(n)!; };
  let current = get('idle');
  current?.play();
  let loop: AnimName = 'idle';
  let oneShot = false;
  const fadeTo = (a: THREE.AnimationAction | null, once: boolean) => {
    if (!a || (a === current && !once)) return !!a;
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    a.clampWhenFinished = once;
    a.play();
    if (current && current !== a) current.crossFadeTo(a, 0.2, false);
    current = a;
    oneShot = once;
    return true;
  };
  mixer.addEventListener('finished', (ev) => { if (ev.action === current && oneShot) { oneShot = false; fadeTo(get(loop), false); } });
  return {
    root, height: target,
    play(name) {
      if (name === 'idle' || name === 'walk' || name === 'run') { loop = name; if (!oneShot) fadeTo(get(name) ?? get('walk'), false); return; }
      if (!fadeTo(get(name), true) && name === 'cast') fadeTo(get('victory'), true);
    },
    update(dt, moving) {
      if (!oneShot) {
        const want: AnimName = moving > 0.6 ? 'run' : moving > 0.05 ? 'walk' : 'idle';
        if (want !== loop) { loop = want; fadeTo(get(want) ?? get('walk'), false); }
      }
      mixer.update(dt);
    },
  };
}

const POOL_MODEL: Record<string, string> = { barbarian: 'npc_barbarian', knight: 'npc_knight', rogue: 'npc_rogue.', hooded: 'npc_rogue_hooded' };
/** A rig for an NPC look: KayKit pool entries by name, or a unique character. Null while loading. */
export function rigFor(kind: NpcRig): Rig | null {
  if (kind.startsWith('char:')) {
    const key = kind.slice(5);
    if (!charEntry(key)) return makeNpcRig(1) ?? buildPlayer();
    if (!charGltf.has(key)) { void loadCharacter(key); return null; }
    return characterRig(key);
  }
  const want = POOL_MODEL[kind] ?? 'npc_knight';
  const loaded = (getManifest().npcs ?? []).filter((e) => hasModel(e.model));
  const i = loaded.findIndex((e) => (e.model + '.').includes(want) || e.model.includes(want));
  return makeNpcRig(i >= 0 ? i : 0) ?? buildPlayer();
}

function tintRig(root: THREE.Object3D, tint: string) {
  const c = new THREE.Color(tint);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((mt) => {
      const cl = (mt as THREE.MeshStandardMaterial).clone();
      if (cl.color) cl.color.multiply(c);
      return cl;
    });
    m.material = Array.isArray(m.material) ? mats : mats[0];
  });
}

// ── quest marks ───────────────────────────────────────────────────────────────
const markTex = new Map<string, THREE.Texture>();
function markTexture(ch: '!' | '?') {
  let t = markTex.get(ch);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const fill = ch === '!' ? '#ffd76a' : '#9fe6ff';
  const glow = g.createRadialGradient(64, 64, 10, 64, 64, 62);
  glow.addColorStop(0, ch === '!' ? 'rgba(255,215,106,0.55)' : 'rgba(159,230,255,0.55)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow; g.fillRect(0, 0, 128, 128);
  g.fillStyle = fill; g.beginPath(); g.moveTo(64, 14); g.lineTo(106, 64); g.lineTo(64, 114); g.lineTo(22, 64); g.closePath(); g.fill();
  g.lineWidth = 7; g.strokeStyle = '#1a1420'; g.stroke();
  g.fillStyle = '#1a1420'; g.font = 'bold 60px Cinzel, Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 64, 68);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  markTex.set(ch, t);
  return t;
}

// ── placement ─────────────────────────────────────────────────────────────────
type TownAnchor = { x: number; z: number; yaw?: number };
type AnchorSet = Record<string, TownAnchor | TownAnchor[] | undefined>;
/** The towns workstream exports TOWN_ANCHORS[townId]; read it softly so this works before the merge. */
const townAnchors = () => Reflect.get(Towns, 'TOWN_ANCHORS') as Record<string, AnchorSet> | undefined;

function spotOf(zoneId: string, spot: string): TownAnchor | null {
  const all = townAnchors();
  const zone = ZONES.find((z) => z.id === zoneId);
  const set = all && zone ? all[zone.town.id] ?? all[zoneId] : undefined;
  if (!set) return null;
  const direct = set[spot];
  if (direct && !Array.isArray(direct)) return direct;
  const m = /^(\D+?)(\d+)$/.exec(spot);
  if (m) {
    const [, base, n] = m;
    const i = Number(n);
    const alt = set[`${base}_${i}`] ?? set[`${base}${i}`];
    if (alt && !Array.isArray(alt)) return alt;
    const arr = set[`${base}es`] ?? set[`${base}s`];
    if (Array.isArray(arr) && arr[i - 1]) return arr[i - 1];
  }
  return null;
}

// ── actors ────────────────────────────────────────────────────────────────────
interface Actor {
  def: NpcDef;
  holder: THREE.Group;
  rig: Rig | null;
  mark: THREE.Sprite;
  markCh: '!' | '?' | null;
  pos: THREE.Vector3;
  yaw: number;
  home: THREE.Vector3;
  homeYaw: number;
  stationKey: string;
  visible: boolean;
  directed: boolean;
  walk: { to: THREE.Vector3; speed: number; done: () => void; t: number } | null;
  it: Interactable;
}

const STREAM_IN = 150;
const STREAM_OUT = 210;
const ANIM_RANGE = 70;

export class NpcActors {
  group = new THREE.Group();
  private actors = new Map<string, Actor>();
  private acc = 0;
  private lastVer = -1;

  constructor(private world: Overworld) {}

  build() {
    for (const def of NPCS) {
      if (def.actor === false) continue;
      const holder = new THREE.Group();
      holder.visible = false;
      const mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: markTexture('!'), depthWrite: false, transparent: true }));
      mark.scale.setScalar(0.85);
      mark.visible = false;
      holder.add(mark);
      this.group.add(holder);
      const zone = zoneById(def.region) ?? ZONES[0];
      const a: Actor = {
        def, holder, rig: null, mark, markCh: null, pos: new THREE.Vector3(), yaw: 0, home: new THREE.Vector3(), homeYaw: 0,
        stationKey: '', visible: false, directed: false, walk: null,
        it: { pos: new THREE.Vector3(), radius: 3, label: `Talk to ${def.name}`, kind: 'npc', zone, id: `npc:${def.id}`, data: def.id, enabled: () => a.visible && !a.directed && !a.walk },
      };
      this.actors.set(def.id, a);
    }
    // warm the unique rigs so they're ready before anyone walks into town
    for (const key of Object.keys((getManifest() as { characters?: object }).characters ?? {})) void loadCharacter(key);
  }

  get interactables(): Interactable[] {
    const out: Interactable[] = [];
    for (const a of this.actors.values()) if (a.visible && a.rig) out.push(a.it);
    return out;
  }

  /** Live position of an NPC actor (for markers and cutscenes). */
  posOf(id: string): THREE.Vector3 | null {
    const a = this.actors.get(id);
    return a && (a.visible || a.directed) ? a.pos : null;
  }

  // ── placement ──
  private resolve(station: string | Anchor): { x: number; z: number; yaw?: number } | null {
    if (typeof station === 'string') {
      const p = locate(station);
      return p ? { x: p[0], z: p[1] } : null;
    }
    if (station.spot && station.town) {
      const s = spotOf(station.town, station.spot);
      if (s) return { x: s.x + (station.off?.[0] ?? 0), z: s.z + (station.off?.[1] ?? 0), yaw: s.yaw };
    }
    const [x, z] = anchorFallback(station);
    return { x, z, yaw: station.face !== undefined ? Math.PI - (station.face * Math.PI) / 180 : undefined };
  }

  /** Nudge a spot clear of props, buildings, water and other interactables. */
  private clearSpot(x: number, z: number, self: string): [number, number] {
    const w = this.world;
    const blocked = (px: number, pz: number) => {
      if (w.data.heightAt(px, pz) < WATER_LEVEL + 0.3) return true;
      if (w.props.nearby(px, pz).some((c) => c.r > 0 && Math.hypot(c.x - px, c.z - pz) < c.r + 1.1)) return true;
      if (w.structures.interactables.some((it) => Math.hypot(it.pos.x - px, it.pos.z - pz) < Math.max(3.2, it.radius + 0.4))) return true;
      for (const o of this.actors.values()) if (o.def.id !== self && o.visible && Math.hypot(o.home.x - px, o.home.z - pz) < 2.2) return true;
      const sp = Towns.TOWN_SPAWN[zoneAt(px, pz).id];
      return !!sp && Math.hypot(sp.x - px, sp.z - pz) < 2.5;
    };
    if (!blocked(x, z)) return [x, z];
    for (let r = 1.2; r <= 7; r += 1.2) {
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 + r;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!blocked(px, pz)) return [px, pz];
      }
    }
    return [x, z];
  }

  private place(a: Actor) {
    if (a.directed) return;
    const st = npcStation(a.def.id);
    const key = st === null ? '' : typeof st === 'string' ? st : `${st.town ?? ''}:${st.spot ?? ''}:${st.bearing ?? ''}:${st.at ?? ''}`;
    if (key === a.stationKey && (a.visible || st === null)) return;
    a.stationKey = key;
    if (st === null) { this.setVisible(a, false); return; }
    const r = this.resolve(st);
    if (!r) { this.setVisible(a, false); return; }
    const [x, z] = this.clearSpot(r.x, r.z, a.def.id);
    a.home.set(x, this.world.data.heightAt(x, z), z);
    const town = ZONES.find((zz) => zz.id === (typeof st === 'string' ? zoneAt(x, z).id : st.town ?? a.def.region));
    const faceTown = town ? Math.atan2(town.town.pos[0] - x, town.town.pos[1] - z) : 0;
    a.homeYaw = r.yaw ?? faceTown;
    a.pos.copy(a.home);
    a.yaw = a.homeYaw;
    a.it.pos.copy(a.home);
    a.it.zone = zoneAt(x, z);
    this.setVisible(a, true);
  }

  private setVisible(a: Actor, on: boolean) {
    a.visible = on;
    if (!on) { a.holder.visible = false; a.walk?.done(); a.walk = null; }
  }

  private ensureRig(a: Actor) {
    if (a.rig) return true;
    const rig = rigFor(a.def.rig);
    if (!rig) return false;
    if (a.def.tint) tintRig(rig.root, a.def.tint);
    rig.root.scale.multiplyScalar(a.def.scale ?? 1);
    a.rig = rig;
    a.holder.add(rig.root);
    a.mark.position.y = rig.height * (a.def.scale ?? 1) + 0.62;
    const def = a.def;
    queueBust(def.id, () => { const r = rigFor(def.rig); if (r && def.tint) tintRig(r.root, def.tint); return r; }); // dialog portrait
    return true;
  }

  private dropRig(a: Actor) {
    if (!a.rig) return;
    a.holder.remove(a.rig.root);
    a.rig = null;
  }

  // ── director control (cutscenes) ──
  direct(id: string, x: number, z: number, yaw?: number) {
    const a = this.actors.get(id);
    if (!a) return;
    a.directed = true;
    a.visible = true;
    a.walk?.done();
    a.walk = null;
    a.pos.set(x, this.world.data.heightAt(x, z), z);
    if (yaw !== undefined) a.yaw = yaw;
    this.ensureRig(a);
  }
  walkTo(id: string, x: number, z: number, run = false): Promise<void> {
    const a = this.actors.get(id);
    if (!a) return Promise.resolve();
    a.walk?.done();
    return new Promise((done) => { a.walk = { to: new THREE.Vector3(x, 0, z), speed: run ? 5.2 : 2.4, done, t: 0 }; });
  }
  face(id: string, target: THREE.Vector3) {
    const a = this.actors.get(id);
    if (a) a.yaw = Math.atan2(target.x - a.pos.x, target.z - a.pos.z);
  }
  gesture(id: string, anim: AnimName) { this.actors.get(id)?.rig?.play(anim); }
  release(id: string) {
    const a = this.actors.get(id);
    if (!a) return;
    a.directed = false;
    a.stationKey = '#';
    this.place(a);
  }

  update(dt: number, t: number, player: THREE.Vector3, hidden: boolean) {
    this.acc += dt;
    const replace = questVersion() !== this.lastVer || this.acc > 0.5;
    if (replace) { this.lastVer = questVersion(); }
    for (const a of this.actors.values()) {
      if (replace) {
        this.place(a);
        const ch = a.visible ? npcMark(a.def.id) : null;
        if (ch !== a.markCh) {
          a.markCh = ch;
          if (ch) (a.mark.material as THREE.SpriteMaterial).map = markTexture(ch);
          a.mark.visible = !!ch;
          const veil = a.def.role === 'veil' || a.def.role === 'villain';
          a.it.label = a.def.shop && !ch ? `Shop — ${a.def.name}` : veil && ch ? `Confront ${a.def.name}` : `Talk to ${a.def.name}`;
        }
      }
      if (!a.visible) continue;
      const d = Math.hypot(a.pos.x - player.x, a.pos.z - player.z);
      if (!a.directed && d > STREAM_OUT) { this.dropRig(a); a.holder.visible = false; continue; }
      if (!a.rig && (a.directed || d < STREAM_IN)) this.ensureRig(a);
      if (!a.rig) continue;
      a.holder.visible = !hidden;
      // walking (cutscenes)
      let moving = 0;
      if (a.walk) {
        const w = a.walk;
        w.t += dt;
        const dx = w.to.x - a.pos.x, dz = w.to.z - a.pos.z;
        const dist = Math.hypot(dx, dz);
        const stepLen = w.speed * dt;
        if (dist <= stepLen || w.t > 14) {
          a.pos.x = w.to.x; a.pos.z = w.to.z;
          a.walk = null;
          w.done();
        } else {
          a.pos.x += (dx / dist) * stepLen;
          a.pos.z += (dz / dist) * stepLen;
          a.yaw = Math.atan2(dx, dz);
          moving = w.speed > 4 ? 1 : 0.5;
        }
        a.pos.y = this.world.data.heightAt(a.pos.x, a.pos.z);
      } else if (!a.directed) {
        // idle: turn to face a nearby player, otherwise settle back to the home facing
        const want = d < 7 ? Math.atan2(player.x - a.pos.x, player.z - a.pos.z) : a.homeYaw;
        const diff = Math.atan2(Math.sin(want - a.yaw), Math.cos(want - a.yaw));
        a.yaw += diff * Math.min(1, dt * 5);
      }
      a.holder.position.copy(a.pos);
      a.rig.root.rotation.y = a.yaw;
      a.mark.visible = !!a.markCh && !a.directed && !cinematicActive();
      if (a.mark.visible) { a.mark.position.y = a.rig.height * (a.def.scale ?? 1) + 0.62 + Math.sin(t * 2.4 + a.pos.x) * 0.08; }
      if (d < ANIM_RANGE || a.directed) a.rig.update(dt, moving);
    }
    if (this.acc > 0.5) this.acc = 0;
  }
}

// ── the content system world.ts builds ─────────────────────────────────────────
interface CineMystic { rig: Rig; pos: THREE.Vector3; yaw: number; scale: number; target: number; hop: { from: THREE.Vector3; to: THREE.Vector3; t: number; done: () => void } | null }

export class ContentWorld {
  group = new THREE.Group();
  npcs: NpcActors;
  gates: GateBarriers;
  private mystics = new Map<string, CineMystic>();
  private cam = { subjects: [] as string[], side: 0.6, height: 2.6, dist: 9, pos: new THREE.Vector3(), look: new THREE.Vector3(), warm: false };
  /** Cutscene stage: props and tall grass are cleared around it, like a battle arena. */
  private stage: [number, number] | null = null;
  private leashToast = 0;

  constructor(private world: Overworld) {
    this.npcs = new NpcActors(world);
    this.gates = new GateBarriers(world);
  }

  build() {
    this.npcs.build();
    this.gates.build();
    this.group.add(this.npcs.group, this.gates.group);
    setNightProvider(() => this.world.isNight);
    registerLocator((ref) => this.locate(ref));
  }

  get interactables(): Interactable[] { return [...this.npcs.interactables, ...this.gates.interactables]; }

  /** Live positions for quest markers. */
  private locate(ref: string): [number, number] | null {
    const [kind, a, b] = ref.split(':');
    const w = this.world;
    if (kind === 'npc') { const p = this.npcs.posOf(a); return p ? [p.x, p.z] : null; }
    if (kind === 'service') {
      const it = w.structures?.interactables.find((x) => x.id === `${a}-${b}`);
      return it ? [it.pos.x, it.pos.z] : null;
    }
    if (kind === 'waystone') {
      const list = w.landmarks?.waystones.filter((s) => s.zone.id === a) ?? [];
      if (!list.length) return null;
      const p = w.playerPos;
      const todo = list.filter((s) => !state.waypoints.includes(s.id));
      const pool = todo.length ? todo : list;
      pool.sort((s1, s2) => Math.hypot(s1.pos.x - p.x, s1.pos.z - p.z) - Math.hypot(s2.pos.x - p.x, s2.pos.z - p.z));
      return [pool[0].pos.x, pool[0].pos.z];
    }
    if (kind === 'tamer') { const tm = w.landmarks?.tamers.find((x) => x.id === a); return tm ? [tm.pos.x, tm.pos.z] : null; }
    if (kind === 'alpha') {
      const al = w.wilds?.list.find((x) => (x as unknown as { alpha?: boolean }).alpha && x.zone.id === a);
      return al ? [al.pos.x, al.pos.z] : null;
    }
    return null;
  }

  // ── cutscene hooks for the onboarding director ──
  readonly cine: CineHooks = {
    begin: () => { setCinematic(true); this.cam.warm = false; },
    end: () => {
      setCinematic(false);
      for (const k of [...this.mystics.keys()]) this.cine.hideMystic(k);
      if (this.stage) { this.world.props.setClear(0, 0, 0); this.world.grass.setClear(0, 0, 0); this.stage = null; }
      this.world.snapCamera();
    },
    placePlayer: (x, z, bearing) => {
      const w = this.world;
      w.teleport(x, z);
      this.stage = [x, z - 6];
      const yaw = Math.PI - (bearing * Math.PI) / 180;
      (w as unknown as { heading: number }).heading = yaw; // Overworld keeps heading private; the player turns to it
      w.player.root.rotation.y = yaw;
      w.camYaw = (bearing * Math.PI) / 180;
      w.snapCamera();
    },
    playerPos: () => [this.world.playerPos.x, this.world.playerPos.z],
    stageNear: (x, z) => this.stageNear(x, z),
    frame: (subjects, opts = {}) => { Object.assign(this.cam, { subjects, side: opts.side ?? 0.6, height: opts.height ?? 2.6, dist: opts.dist ?? 9 }); },
    spawnNpc: (id, x, z, bearing) => this.npcs.direct(id, x, z, bearing !== undefined ? Math.PI - (bearing * Math.PI) / 180 : undefined),
    walkNpc: (id, x, z, run) => this.npcs.walkTo(id, x, z, run),
    faceNpc: (id, target) => { const p = this.subjectPos(target); if (p) this.npcs.face(id, p); },
    gesture: (id, anim) => this.npcs.gesture(id, anim),
    releaseNpc: (id) => this.npcs.release(id),
    showMystic: async (key, species, x, z, bearing) => {
      await ensureCreatures([species]);
      this.cine.hideMystic(key);
      const rig = makeCreatureRig(species);
      const pos = new THREE.Vector3(x, this.world.data.heightAt(x, z), z);
      rig.root.position.copy(pos);
      rig.root.scale.setScalar(0.001);
      this.group.add(rig.root);
      const m: CineMystic = { rig, pos, yaw: bearing !== undefined ? Math.PI - (bearing * Math.PI) / 180 : 0, scale: 0.001, target: 1, hop: null };
      this.mystics.set(key, m);
      rig.play('victory');
      await new Promise((r) => setTimeout(r, 380));
    },
    moveMystic: (key, x, z) => new Promise<void>((done) => {
      const m = this.mystics.get(key);
      if (!m) { done(); return; }
      m.hop = { from: m.pos.clone(), to: new THREE.Vector3(x, this.world.data.heightAt(x, z), z), t: 0, done };
    }),
    hideMystic: (key) => {
      const m = this.mystics.get(key);
      if (!m) return;
      this.mystics.delete(key);
      this.group.remove(m.rig.root);
      m.hop?.done();
    },
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  };

  /** First dry, gentle, open spot (7 m around) searching outward from (x, z). */
  private stageNear(x: number, z: number): [number, number] {
    const d = this.world.data;
    const good = (px: number, pz: number) => {
      const h0 = d.heightAt(px, pz);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        for (const r of [3.5, 7]) {
          const h = d.heightAt(px + Math.cos(a) * r, pz + Math.sin(a) * r);
          if (h < WATER_LEVEL + 0.35 || Math.abs(h - h0) > 1.6) return false;
        }
      }
      return !this.world.props.nearby(px, pz).some((c) => c.r > 1 && Math.hypot(c.x - px, c.z - pz) < c.r + 4);
    };
    if (good(x, z)) return [x, z];
    for (let r = 4; r <= 60; r += 4) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (good(px, pz)) return [px, pz];
      }
    }
    return [x, z];
  }

  private subjectPos(s: string): THREE.Vector3 | null {
    if (s === 'player') return this.world.playerPos;
    const m = this.mystics.get(s);
    if (m) return m.pos;
    return this.npcs.posOf(s);
  }

  private updateCamera(dt: number) {
    const w = this.world;
    const pts = this.cam.subjects.map((s) => this.subjectPos(s)).filter((p): p is THREE.Vector3 => !!p);
    if (!pts.length) return;
    const c = pts.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
    c.y += 1.15;
    const p = w.playerPos;
    const others = pts.filter((q) => q !== p);
    const o = others.length ? others.reduce((acc, q) => acc.add(q), new THREE.Vector3()).multiplyScalar(1 / others.length) : new THREE.Vector3(p.x, p.y, p.z - 5);
    let fx = o.x - p.x, fz = o.z - p.z;
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl; fz /= fl;
    const s = this.cam.side;
    const bx = -fx * Math.cos(s) + fz * Math.sin(s);
    const bz = -fz * Math.cos(s) - fx * Math.sin(s);
    let spread = 0;
    for (const a of pts) for (const b of pts) spread = Math.max(spread, Math.hypot(a.x - b.x, a.z - b.z));
    const dist = Math.min(20, this.cam.dist + spread * 0.55);
    const want = new THREE.Vector3(c.x + bx * dist, c.y + this.cam.height + (dist - this.cam.dist) * 0.3, c.z + bz * dist);
    // pull in when a building or boulder stands between the lens and the actors
    for (const col of [...w.props.nearby(want.x, want.z), ...w.props.nearby(c.x, c.z)]) {
      if (col.r < 1.2 || (this.stage && Math.hypot(col.x - this.stage[0], col.z - this.stage[1]) < 22)) continue;
      const dx = want.x - c.x, dz = want.z - c.z;
      const len2 = dx * dx + dz * dz || 1;
      const u = Math.max(0, Math.min(1, ((col.x - c.x) * dx + (col.z - c.z) * dz) / len2));
      if (Math.hypot(c.x + dx * u - col.x, c.z + dz * u - col.z) < col.r + 0.6 && u > 0.15) {
        const k = Math.max(0.35, u - 0.12);
        want.set(c.x + dx * k, c.y + (want.y - c.y) * k, c.z + dz * k);
      }
    }
    want.y = Math.max(want.y, w.data.heightAt(want.x, want.z) + 1.2);
    if (!this.cam.warm) { this.cam.pos.copy(w.camera.position); this.cam.look.copy(c); this.cam.warm = true; }
    const k = 1 - Math.exp(-dt * 2.6);
    this.cam.pos.lerp(want, k);
    this.cam.look.lerp(c, k);
    w.camera.position.copy(this.cam.pos);
    w.camera.lookAt(this.cam.look);
  }

  private updateMystics(dt: number) {
    for (const m of this.mystics.values()) {
      m.scale += (m.target - m.scale) * Math.min(1, dt * 9);
      let moving = 0;
      if (m.hop) {
        const h = m.hop;
        h.t = Math.min(1, h.t + dt / 0.7);
        m.pos.lerpVectors(h.from, h.to, h.t);
        m.pos.y += Math.sin(h.t * Math.PI) * 0.9;
        m.yaw = Math.atan2(h.to.x - h.from.x, h.to.z - h.from.z);
        moving = 0.6;
        if (h.t >= 1) { m.hop = null; h.done(); }
      }
      m.rig.root.position.copy(m.pos);
      m.rig.root.rotation.y = m.yaw;
      m.rig.root.scale.setScalar(Math.max(0.001, m.scale * (1 + Math.max(0, m.target - m.scale) * 0.4)));
      m.rig.update(dt, moving);
    }
  }

  update(dt: number, t: number) {
    const w = this.world;
    const p = w.playerPos;
    const live = !w.titleMode;
    if (live && !w.battleMode) {
      // the prologue keeps a new Wayfarer inside Hearthwick
      if (leashed() && !cinematicActive()) {
        const [cx, cz] = LEASH.center;
        const d = Math.hypot(p.x - cx, p.z - cz);
        if (d > LEASH.radius) {
          const k = LEASH.radius / d;
          p.x = cx + (p.x - cx) * k;
          p.z = cz + (p.z - cz) * k;
          p.y = w.data.heightAt(p.x, p.z);
          if (performance.now() - this.leashToast > 5000) { this.leashToast = performance.now(); notify('Warden Brisa: “Not so fast. Not without a Mystic.”', 'info'); }
        }
      }
      exploreTick(p.x, p.z, dt);
      questTick(p.x, p.z, dt);
    }
    this.npcs.update(dt, t, p, w.battleMode);
    this.gates.update(dt, t, p, live && !w.battleMode);
    this.updateMystics(dt);
    if (cinematicActive() && !w.battleMode) {
      if (this.stage) { w.props.setClear(this.stage[0], this.stage[1], 22); w.grass.setClear(this.stage[0], this.stage[1], 20); }
      this.updateCamera(dt);
    }
    if (live && !w.battleMode) storyUpdate();
  }
}
