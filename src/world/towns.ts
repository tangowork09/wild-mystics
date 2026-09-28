// Towns (v3:towns). Nine designed towns plus Crownfall Camp, the expedition camps and the
// Guardian arenas. Each town is authored in poi/layouts/* in its own local frame and baked into a
// handful of merged meshes (one per material bucket) with a far-LOD silhouette.
//
// Public contract (used by world.ts, main.ts, ui/services.ts, content's NPC actors):
//   SERVICES, Service, Interactable            — unchanged shape (Interactable gained kind 'chest')
//   TOWN_SPAWN[zoneId] = { x, z, yaw }         — fast-travel arrival; yaw is a camera yaw
//   TOWN_ANCHORS[zoneId | townId][name]        — { x, z, yaw } spots for NPCs (see anchor names below)
//   TOWN_RADIUS[zoneId], townRadius(id), inTown(x, z, margin?)
//   Structures: build(), update(), setNight(), setBossDefeated(), setBeamVisible(), deckAt()

import * as THREE from 'three';
import { ZONES, type Zone } from '../data/zones';
import { GATES } from '../data/layout';
import { makeNpcRig } from '../assets/manifest';
import { buildPlayer, type Rig } from '../assets/placeholders';
import { Q } from '../core/renderer';
import type { TerrainData } from './terrain';
import type { Props } from './props';
import { TownCtx } from './poi/town';
import { setNight as kitNight } from './poi/kit';
import { SERVICES, type Anchor, type Deck, type Interactable, type Service } from './poi/types';
import { buildHearthwick } from './poi/layouts/hearthwick';
import { Sites } from './poi/sites';

export { SERVICES };
export type { Service, Interactable, Anchor };

/** Safe arrival point per land (zone id): on the main road facing the plaza; yaw is a camera yaw. */
export const TOWN_SPAWN: Record<string, { x: number; z: number; yaw: number }> = {};

/**
 * Named spots per town, keyed by zone id AND town id (`vale` and `hearthwick` are the same object).
 * Every town has: gate, plaza, spawn, guardPost, questBoard, shopCounter, specialtyCounter, healer,
 * leader, market, bench1…bench5, plus service doors (hatchery, shrine, tutor, storage, summon…)
 * where the town has them. Hearthwick adds elderDoor. yaw = rotation.y of a +Z-facing rig.
 */
export const TOWN_ANCHORS: Record<string, Record<string, Anchor>> = {};

/** Radius (m) around each town centre that counts as "in town" (keyed by zone id and town id). */
export const TOWN_RADIUS: Record<string, number> = {};

export function townRadius(id: string) { return TOWN_RADIUS[id] ?? 0; }

/** True inside any town (plus `margin` metres). Wild battles never start in town. */
export function inTown(x: number, z: number, margin = 0) {
  for (const zn of ZONES) {
    const r = TOWN_RADIUS[zn.id];
    if (r && Math.hypot(x - zn.town.pos[0], z - zn.town.pos[1]) < r + margin) return true;
  }
  return false;
}

// ── town definitions ────────────────────────────────────────────────────────────────────────
const RAD = Math.PI / 180;
const bearingTo = (from: [number, number], to: [number, number]) => (Math.atan2(to[0] - from[0], -(to[1] - from[1])) / RAD + 360) % 360;
/** Gate you arrive through (the previous tier's pass), per land. */
const ARRIVAL_GATE: Record<string, string> = {
  lakes: 'g_vale_lakes', coast: 'g_vale_coast', marsh: 'g_lakes_marsh', scar: 'g_coast_scar', elder: 'g_marsh_elder',
  dunes: 'g_scar_dunes', peaks: 'g_elder_peaks', hollows: 'g_dunes_hollows', summit: 'g_crown',
};
/** Bearing (°) of the main road entrance for a town: south for Hearthwick, else toward its arrival gate. */
export function mainBearing(zone: Zone) {
  if (zone.id === 'vale') return 180;
  const g = GATES.find((gg) => gg.id === ARRIVAL_GATE[zone.id]);
  return g ? bearingTo(zone.town.pos, g.pos) : 180;
}

type Layout = (ctx: TownCtx) => void;
const LAYOUTS: Record<string, { build: Layout; radius: number }> = {
  vale: { build: buildHearthwick, radius: 66 },
};

export interface Villager { rig: Rig; home: THREE.Vector3; target: THREE.Vector3; wait: number; path?: THREE.Vector3[]; step?: number; act?: 'sweep' | 'chat' | 'fish' | 'stroll' | 'work'; gesture?: number }

interface TownRuntime { id: string; zone: Zone; lod: THREE.LOD; ctx: TownCtx; animated: TownCtx['animated']; center: THREE.Vector3 }

export class Structures {
  group = new THREE.Group();
  interactables: Interactable[] = [];
  villagers: Villager[] = [];
  /** World positions of every lantern/lamp (for night point-lights). */
  lampSpots: THREE.Vector3[] = [];
  decks: Deck[] = [];
  towns: TownRuntime[] = [];
  sites: Sites;
  private deckGrid = new Map<string, Deck[]>();

  constructor(private data: TerrainData, private props: Props) {
    this.sites = new Sites(data, props);
  }

  /** Colliders registered before the towns (vegetation scatter) — the only ones clearScatter may retire. */
  private scatterColliders = 0;

  build() {
    this.scatterColliders = this.props.colliders.length;
    for (const zone of ZONES) this.buildTown(zone);
    this.sites.build();
    this.group.add(this.sites.group);
    this.interactables.push(...this.sites.interactables);
    this.lampSpots.push(...this.sites.lampSpots);
    for (const d of this.decks) this.indexDeck(d);
  }

  private buildTown(zone: Zone) {
    const def = LAYOUTS[zone.id];
    const [cx, cz] = zone.town.pos;
    const rot = Math.PI - mainBearing(zone) * RAD;
    const radius = def?.radius ?? (zone.town.kind === 'town' ? 50 : 36);
    TOWN_RADIUS[zone.id] = TOWN_RADIUS[zone.town.id] = radius;
    const ctx = new TownCtx(zone.town.id, zone, this.data, this.props, cx, cz, rot, radius);
    if (def) def.build(ctx);
    // anchors: keyed by zone id and town id
    const anchors = ctx.anchors;
    TOWN_ANCHORS[zone.id] = TOWN_ANCHORS[zone.town.id] = anchors;
    const sp = anchors.spawn ?? anchors.gate;
    if (sp) {
      // camera yaw: camera sits behind the player, who faces along the anchor's yaw
      TOWN_SPAWN[zone.id] = { x: sp.x, z: sp.z, yaw: sp.yaw + Math.PI };
    } else {
      TOWN_SPAWN[zone.id] = { x: cx, z: cz + 6, yaw: 0 };
    }
    this.validateAnchors(ctx);
    // meshes
    const detail = ctx.b.build(`town:${zone.town.id}`);
    detail.add(ctx.extras);
    // extras were authored in world space; re-express them in the LOD's local frame
    const lod = new THREE.LOD();
    lod.name = `town:${zone.town.id}`;
    lod.position.set(cx, ctx.base, cz);
    lod.rotation.y = rot;
    lod.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(lod.matrixWorld).invert();
    for (const o of [...ctx.extras.children]) { o.applyMatrix4(inv); }
    const far = ctx.far.build(`far:${zone.town.id}`, new Set());
    const farDist = Math.min(260, Q.far * 0.55);
    lod.addLevel(detail, 0);
    lod.addLevel(far, farDist);
    this.group.add(lod);
    this.towns.push({ id: zone.town.id, zone, lod, ctx, animated: ctx.animated, center: new THREE.Vector3(cx, ctx.base, cz) });
    this.interactables.push(...ctx.interactables);
    this.lampSpots.push(...ctx.lamps);
    this.decks.push(...ctx.decks);
    this.clearScatter(ctx);
    this.spawnVillagers(ctx);
  }

  /** Nudge anchors off colliders / water so NPCs never spawn inside a wall. */
  private validateAnchors(ctx: TownCtx) {
    for (const [name, a] of Object.entries(ctx.anchors)) {
      let best: [number, number] = [a.x, a.z];
      const blocked = (x: number, z: number) => this.props.nearby(x, z).some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 0.5);
      if (!blocked(a.x, a.z)) continue;
      found: for (let r = 0.5; r <= 4; r += 0.5) {
        for (let k = 0; k < 12; k++) {
          const ang = (k / 12) * Math.PI * 2;
          const x = a.x + Math.cos(ang) * r, z = a.z + Math.sin(ang) * r;
          if (!blocked(x, z)) { best = [x, z]; break found; }
        }
      }
      if (import.meta.env.DEV && best[0] === a.x && best[1] === a.z) console.warn(`[towns] anchor ${ctx.id}.${name} is blocked`);
      a.x = best[0]; a.z = best[1];
    }
  }

  /**
   * Vegetation scatter (props.ts) doesn't know the town footprints: collapse any scattered
   * instance inside a town and retire its collider, so no tree grows through a roof.
   */
  private clearScatter(ctx: TownCtx) {
    const R = ctx.radius - 1;
    const inside = (x: number, z: number) => Math.hypot(x - ctx.cx, z - ctx.cz) < R || ctx.clear.some((f) => Math.hypot(x - f.x, z - f.z) < f.r);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.props.group.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      if (!im.isInstancedMesh) return;
      let dirty = false;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        if (Math.abs(p.x - ctx.cx) > ctx.radius + 40 || Math.abs(p.z - ctx.cz) > ctx.radius + 40) continue;
        if (inside(p.x, p.z)) { im.setMatrixAt(i, zero); dirty = true; }
      }
      if (dirty) im.instanceMatrix.needsUpdate = true;
    });
    for (let i = 0; i < this.scatterColliders; i++) {
      const c = this.props.colliders[i];
      // the grid still lists it, but a collider parked far away never blocks anything
      if (Math.abs(c.x - ctx.cx) < ctx.radius + 40 && Math.abs(c.z - ctx.cz) < ctx.radius + 40 && inside(c.x, c.z)) { c.x = 1e7; c.z = 1e7; }
    }
  }

  private spawnVillagers(ctx: TownCtx) {
    let i = 0;
    for (const v of ctx.villagers) {
      const rig = makeNpcRig(i + ctx.id.length) ?? buildPlayer();
      const [x, z] = v.path[0];
      const y = this.data.heightAt(x, z);
      rig.root.position.set(x, y, z);
      rig.root.rotation.y = v.yaw ?? 0;
      rig.root.scale.setScalar(v.scale ?? 0.96);
      this.group.add(rig.root);
      if (v.act === 'fish') {
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, 2.4, 5).translate(0, 1.2, 0), rodMat);
        rod.position.set(0.25, 0.9, 0.2);
        rod.rotation.x = 0.95;
        rig.root.add(rod);
      }
      if (v.act === 'sweep') {
        const broom = new THREE.Group();
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 5), rodMat);
        stick.position.y = 0.7;
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.35, 6), strawMat);
        head.position.y = 0.05;
        broom.add(stick, head);
        broom.position.set(0.28, 0.1, 0.35);
        broom.rotation.x = 0.5;
        rig.root.add(broom);
      }
      const pts = v.path.map(([px, pz]) => new THREE.Vector3(px, this.data.heightAt(px, pz), pz));
      this.villagers.push({ rig, home: pts[0].clone(), target: (pts[1] ?? pts[0]).clone(), wait: 1 + Math.random() * 2, path: pts, step: 0, act: v.act, gesture: 2 + Math.random() * 4 });
      i++;
    }
  }

  // ── walkable decks ────────────────────────────────────────────────────────────────────────
  private indexDeck(d: Deck) {
    const r = Math.hypot(d.hw, d.hl);
    for (let gx = Math.floor((d.x - r) / 16); gx <= Math.floor((d.x + r) / 16); gx++) {
      for (let gz = Math.floor((d.z - r) / 16); gz <= Math.floor((d.z + r) / 16); gz++) {
        const k = `${gx},${gz}`;
        let l = this.deckGrid.get(k);
        if (!l) { l = []; this.deckGrid.set(k, l); }
        l.push(d);
      }
    }
  }

  /** Height of a walkable deck (pier, boardwalk) at (x, z), or null. */
  deckAt(x: number, z: number): number | null {
    const l = this.deckGrid.get(`${Math.floor(x / 16)},${Math.floor(z / 16)}`);
    if (!l) return null;
    let best: number | null = null;
    for (const d of l) {
      const dx = x - d.x, dz = z - d.z;
      const c = Math.cos(d.rot), s = Math.sin(d.rot);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) > d.hw || Math.abs(lz) > d.hl) continue;
      const h = d.h0 + (d.h1 - d.h0) * ((lz + d.hl) / (2 * d.hl));
      if (best === null || h > best) best = h;
    }
    return best;
  }

  /** Windows and lamps brighten at night. */
  setNight(n: number) { this.night = n; }
  private night = 0;

  update(dt: number, t: number) {
    kitNight(this.night, t);
    const cam = this.lastCam;
    for (const town of this.towns) {
      const near = !cam || cam.distanceToSquared(town.center) < 280 * 280;
      if (!near) continue;
      for (const a of town.animated) a.tick(a.obj, t, dt);
    }
    this.sites.update(dt, t);
    for (const v of this.villagers) this.tickVillager(v, dt);
  }
  /** Camera position (set by the world each frame) for animation culling. */
  lastCam: THREE.Vector3 | null = null;

  private tickVillager(v: Villager, dt: number) {
    const root = v.rig.root;
    const cam = this.lastCam;
    const far = cam ? cam.distanceToSquared(root.position) > 95 * 95 : false;
    root.visible = !far;
    if (far) return;
    let moving = 0;
    const path = v.path ?? [v.home];
    if (v.act === 'chat' || v.act === 'fish' || path.length < 2) {
      v.gesture = (v.gesture ?? 3) - dt;
      if (v.gesture <= 0) { v.rig.play(v.act === 'chat' ? (Math.random() < 0.5 ? 'cast' : 'victory') : 'interact'); v.gesture = 4 + Math.random() * 6; }
      v.rig.update(dt, 0);
      return;
    }
    if (v.wait > 0) {
      v.wait -= dt;
      if (v.act === 'sweep' || v.act === 'work') {
        v.gesture = (v.gesture ?? 2) - dt;
        if (v.gesture <= 0) { v.rig.play('interact'); v.gesture = 2.2 + Math.random() * 1.5; }
      }
    } else {
      const tgt = path[((v.step ?? 0) + 1) % path.length];
      const dx = tgt.x - root.position.x, dz = tgt.z - root.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.25) {
        v.step = ((v.step ?? 0) + 1) % path.length;
        v.wait = v.act === 'stroll' ? 1.5 + Math.random() * 3 : 2.5 + Math.random() * 3;
      } else {
        const sp = (v.act === 'sweep' ? 0.9 : 1.3) * dt;
        root.position.x += (dx / d) * Math.min(sp, d);
        root.position.z += (dz / d) * Math.min(sp, d);
        root.position.y = this.deckAt(root.position.x, root.position.z) ?? this.data.heightAt(root.position.x, root.position.z);
        const want = Math.atan2(dx, dz);
        root.rotation.y += Math.atan2(Math.sin(want - root.rotation.y), Math.cos(want - root.rotation.y)) * Math.min(1, dt * 8);
        moving = v.act === 'sweep' ? 0.3 : 0.45;
      }
    }
    v.rig.update(dt, moving);
  }

  setBossDefeated(zoneId: string, defeated: boolean) { this.sites.setBossDefeated(zoneId, defeated); }

  /** Hide the guardian beacon while fighting inside its arena. */
  setBeamVisible(zoneId: string, on: boolean) { this.sites.setBeamVisible(zoneId, on); }
}

const rodMat = new THREE.MeshStandardMaterial({ color: '#6a4a30', roughness: 0.8 });
const strawMat = new THREE.MeshStandardMaterial({ color: '#d8b85a', roughness: 0.9 });
