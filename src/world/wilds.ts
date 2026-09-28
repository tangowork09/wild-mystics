import * as THREE from 'three';
import { makeCreatureRig, ensureCreatures, hasCreatureModel, getManifest } from '../assets/manifest';
import type { Rig } from '../assets/placeholders';
import { SPECIES, formForLevel } from '../data/species';
import { ELEMENTS } from '../data/elements';
import { RARITY } from '../data/traits';
import { ZONES, WATER_LEVEL, WORLD_SIZE, type Zone, zoneAt, spawnsBy } from '../data/zones';
import { BEHAVIOR, HERDS, PACKS, type Archetype, type Spawn } from '../data/spawns';
import { POIS, GATES, DUNGEONS } from '../data/layout';
import { Q, tier } from '../core/renderer';
import { randInt, randRange, weighted } from '../core/noise';
import { state } from '../game/state';
import { emit } from '../game/events';
import { icon } from '../ui/icons';
import type { TerrainData } from './terrain';
import type { Props } from './props';
import { tickStageLights, inTown } from '../battle/stage';
import { VFX } from '../battle/vfx';

// Wild Mystics in a 2 km world (creatures workstream).
//
// Instead of populating whole lands, wilds stream in on a ring around the player: the land under the
// spawn point (zoneAt) and the time of day pick the species. Each species has an archetype —
// grazer, skittish, curious, territorial, flyer, swimmer — and some roam as herds or packs. Alphas
// (elite ~1.6× Mystics with a crown) appear by chance and hold dens next to points of interest.
// Wilds never spawn in towns or on roads, and poof in and out with a puff of smoke.

export type WildState = 'idle' | 'wander' | 'chase' | 'flee' | 'graze' | 'approach' | 'watch' | 'circle' | 'swoop' | 'return' | 'leap';

export interface Wild {
  id: number;
  species: string;
  level: number;
  shiny: boolean;
  /** v3: elite Alpha (oversized, crowned, higher level, better spoils). */
  alpha: boolean;
  zone: Zone;
  rig: Rig;
  pos: THREE.Vector3;
  heading: number;
  state: WildState;
  timer: number;
  target: THREE.Vector3;
  /** Territorial (chases the player). */
  aggressive: boolean;
  cooldown: number;
  label: HTMLDivElement;
  radius: number;
  nightOnly: boolean;
  aura?: THREE.Object3D;
  /** 0..1 spawn / despawn fade. */
  fade: number;
  // v3
  arch: Archetype;
  home: THREE.Vector3;
  herd: number;
  alt: number;
  altGoal: number;
  speedMul: number;
  den?: string;
  dying: boolean;
  vy: number;
  animAcc: number;
  lod: number;
  /** Pack mates that joined this Wild's battle (removed with it). */
  joined?: number[];
}

let nextId = 1;
export const SHINY_ODDS = 1 / 300;
/** Chance that a lone roaming spawn is an Alpha. */
export const ALPHA_ODDS = 0.025;

export function shinyRoll(bonus = 1) {
  const incense = (state.buffs.shimmer ?? 0) > Date.now() ? 3 : 1;
  return Math.random() < SHINY_ODDS * incense * bonus;
}

/** Tuning per quality tier: how many wilds live around the player and how far the ring reaches. */
const DENSITY = { low: { count: 12, ring: [34, 72] }, medium: { count: 18, ring: [36, 84] }, high: { count: 24, ring: [38, 96] }, ultra: { count: 28, ring: [40, 108] } }[tier];
const DESPAWN = DENSITY.ring[1] + 45;
const HALF = WORLD_SIZE / 2 - 24;

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };

export function archetypeOf(id: string): Archetype {
  const sp = SPECIES[id];
  if (!sp) return 'grazer';
  if (sp.behavior) return sp.behavior;
  if (sp.swim) return 'swimmer';
  if (BEHAVIOR[id]) return BEHAVIOR[id];
  const rig = (getManifest().creatures?.[id] as { rig?: string } | undefined)?.rig;
  if (rig === 'flyer') return 'flyer';
  if (sp.abilities.includes('intimidate') || sp.abilities.includes('rage')) return 'territorial';
  if (sp.rarity !== 'common' && sp.base.spd >= 17) return 'skittish';
  if (rig === 'quadruped') return 'grazer';
  const h = hash(id);
  return h < 0.3 ? 'curious' : h < 0.55 ? 'territorial' : h < 0.7 ? 'skittish' : 'grazer';
}

// ── Alpha dens next to points of interest ────────────────────────────────
interface Den { id: string; x: number; z: number; zone: Zone; species: string; level: number; clearedUntil: number; live: number | null }
const DEN_KEY = 'wm-alpha-dens';
function loadDenTimes(): Record<string, number> { try { return JSON.parse(localStorage.getItem(DEN_KEY) ?? '{}'); } catch { return {}; } }
function saveDenTimes(d: Record<string, number>) { try { localStorage.setItem(DEN_KEY, JSON.stringify(d)); } catch { /* storage full */ } }
/** How long a den stays empty after its Alpha is beaten or caught (real minutes). */
const DEN_RESPAWN_MIN = 25;

export class Wilds {
  group = new THREE.Group();
  list: Wild[] = [];
  private labelsEl: HTMLElement;
  private fx = new VFX();
  private spawnT = 0;
  private herdSeq = 1;
  private loading = new Set<string>();
  private dens: Den[] = [];
  private primed = new Set<string>();
  private lastNight = 0;

  constructor(private data: TerrainData, private props: Props) {
    this.labelsEl = document.getElementById('labels')!;
    this.group.add(this.fx.group);
    const times = loadDenTimes();
    for (const p of POIS) {
      const zone = ZONES.find((z) => z.id === p.region) ?? zoneAt(p.pos[0], p.pos[1]);
      const pool = spawnsBy(zone, ['roam']).filter((s) => SPECIES[s.species] && !SPECIES[s.species].swim);
      if (!pool.length) continue;
      // deterministic: the same Alpha always holds the same den; favour the land's bigger beasts
      const ranked = [...pool].sort((a, b) => SPECIES[b.species].height - SPECIES[a.species].height);
      const pick = ranked[Math.floor(hash(p.id) * Math.min(4, ranked.length))];
      const a = hash(p.id + 'a') * Math.PI * 2;
      this.dens.push({ id: `den_${p.id}`, x: p.pos[0] + Math.cos(a) * 34, z: p.pos[1] + Math.sin(a) * 34, zone, species: pick.species, level: zone.levels[1] + 3, clearedUntil: times[`den_${p.id}`] ?? 0, live: null });
    }
  }

  /** Preload a land's roaming species so the first streamed spawns never pop in as stand-ins. */
  async populateZone(zone: Zone) {
    if (this.primed.has(zone.id)) return;
    this.primed.add(zone.id);
    const species = spawnsBy(zone, ['roam', 'night']).map((s) => s.species).filter((s) => SPECIES[s]);
    await ensureCreatures([...new Set(species)]);
  }
  zoneReady(zone: Zone) { return this.primed.has(zone.id); }

  /** Alpha dens (for map pins / bounties): position, species, level and whether it is occupied. */
  get alphaDens() { return this.dens.map((d) => ({ id: d.id, x: d.x, z: d.z, zone: d.zone.id, species: d.species, level: d.level, ready: d.clearedUntil < Date.now() })); }

  // ── spawning ──────────────────────────────────────────────────────────
  private okGround(x: number, z: number, water: boolean): number | null {
    if (Math.abs(x) > HALF || Math.abs(z) > HALF) return null;
    if (inTown(x, z, 8)) return null;
    const h = this.data.heightAt(x, z);
    if (water) return h < WATER_LEVEL - 0.7 ? h : null;
    if (h < WATER_LEVEL + 0.35) return null;
    if (this.data.slopeAt(x, z) > 0.85) return null;
    if (this.data.pathAt(x, z) > 0.2 || this.data.plazaAt(x, z) > 0.05) return null;
    // tall grass hides its own Mystics (random encounters); roaming ones stay out in the open where you can see them
    if (this.data.tallAt(x, z) > 0.28) return null;
    for (const g of GATES) if (Math.hypot(x - g.pos[0], z - g.pos[1]) < 16) return null;
    for (const d of DUNGEONS) if (Math.hypot(x - d.entrance[0], z - d.entrance[1]) < 10) return null;
    for (const zn of ZONES) if (Math.hypot(x - zn.boss.pos[0], z - zn.boss.pos[1]) < 26 || Math.hypot(x - zn.camp[0], z - zn.camp[1]) < 12) return null;
    return h;
  }

  private pool(zone: Zone, night: number, water: boolean): Spawn[] {
    if (water) return spawnsBy(zone, ['fish']).filter((s) => SPECIES[s.species]?.swim);
    const day = spawnsBy(zone, ['roam']).filter((s) => SPECIES[s.species] && !SPECIES[s.species].swim && !SPECIES[s.species].boss);
    if (night < 0.55) return day;
    const nightPool = spawnsBy(zone, ['night']).filter((s) => SPECIES[s.species] && !SPECIES[s.species].swim).map((s) => ({ ...s, weight: s.weight * 1.6 }));
    return [...day, ...nightPool];
  }

  private near(x: number, z: number, r: number) { return this.list.some((w) => Math.hypot(w.pos.x - x, w.pos.z - z) < r); }

  /** Try one streamed spawn (a lone Mystic, a herd, or a pack) somewhere on the ring around the player. */
  private trySpawn(player: THREE.Vector3, camera: THREE.Camera, night: number) {
    const [r0, r1] = DENSITY.ring;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const fl = Math.max(1e-3, Math.hypot(fwd.x, fwd.z));
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = Math.random() * Math.PI * 2;
      // close spawns only happen out of view (behind / beside the camera); in view they start further out
      const r = randRange(20, r1);
      const x = player.x + Math.cos(a) * r, z = player.z + Math.sin(a) * r;
      const ahead = (Math.cos(a) * fwd.x + Math.sin(a) * fwd.z) / fl;
      if (ahead > 0.35 && r < r0) continue;
      const water = this.data.heightAt(x, z) < WATER_LEVEL - 0.7;
      if (water && Math.random() < 0.8) continue; // lakes are quieter than meadows
      if (water && this.list.filter((w) => w.arch === 'swimmer').length >= 6) continue;
      const h = this.okGround(x, z, water);
      if (h === null) continue;
      if (this.near(x, z, 9)) continue;
      const zone = zoneAt(x, z);
      const pool = this.pool(zone, night, water);
      if (!pool.length) continue;
      const pick = weighted(pool);
      const sp = pick.species;
      if (!hasCreatureModel(sp)) { this.request(sp); continue; }
      const nightOnly = pick.method === 'night';
      const herdRange = HERDS[sp];
      const alpha = !herdRange && !water && Math.random() < ALPHA_ODDS && SPECIES[sp].rarity !== 'legendary';
      const count = herdRange && !alpha ? randInt(herdRange[0], herdRange[1]) : 1;
      const herd = count > 1 ? this.herdSeq++ : 0;
      for (let i = 0; i < count; i++) {
        const ox = i === 0 ? 0 : randRange(-5, 5), oz = i === 0 ? 0 : randRange(-5, 5);
        const hh = this.okGround(x + ox, z + oz, water);
        if (hh === null) continue;
        const lv = alpha ? zone.levels[1] + randInt(2, 4) : randInt(zone.levels[0], zone.levels[1]);
        this.spawn(sp, zone, new THREE.Vector3(x + ox, hh, z + oz), lv, { alpha, herd, nightOnly, player });
      }
      return;
    }
  }

  private request(sp: string) {
    if (this.loading.has(sp)) return;
    this.loading.add(sp);
    void ensureCreatures([sp]).then(() => this.loading.delete(sp));
  }

  private spawn(sp: string, zone: Zone, pos: THREE.Vector3, level: number, o: { alpha?: boolean; herd?: number; nightOnly?: boolean; den?: string; player?: THREE.Vector3 }) {
    sp = formForLevel(sp, level); // v3: wild Mystics show the form their level has earned (Lv 10/20/30/35)
    const spec = SPECIES[sp];
    if (!spec) return null;
    const shiny = shinyRoll();
    const alpha = !!o.alpha;
    const rig = makeCreatureRig(sp, shiny, { alpha });
    const arch: Archetype = alpha ? 'territorial' : archetypeOf(sp);
    rig.root.position.copy(pos);
    rig.look?.setFade(0);
    this.group.add(rig.root);
    const label = document.createElement('div');
    label.className = 'wild-label';
    const el = ELEMENTS[spec.element];
    const rar = RARITY[spec.rarity];
    label.style.setProperty('--rar', alpha ? '#ff8a4a' : rar.color);
    const tag = alpha ? `<i class="wl-rar wl-alpha" style="color:#ffb04a">Alpha</i>` : spec.rarity !== 'common' ? `<i class="wl-rar">${rar.name}</i>` : '';
    label.innerHTML = `<span class="wl-el" style="color:${el.color}">${icon(spec.element)}</span>${shiny ? `<span class="shiny">${icon('sparkle')}</span>` : ''}<span class="wl-nm">${spec.name}</span><b>Lv ${level}</b>${tag}`;
    if (alpha) label.classList.add('alpha');
    label.style.display = 'none';
    this.labelsEl.appendChild(label);
    const flyer = arch === 'flyer';
    const w: Wild = {
      id: nextId++, species: sp, level, shiny, alpha, zone, rig, pos: pos.clone(), heading: Math.random() * Math.PI * 2,
      state: 'idle', timer: Math.random() * 2, target: pos.clone(), aggressive: arch === 'territorial', cooldown: 0, label,
      radius: Math.max(0.8, rig.height * 0.35), nightOnly: !!o.nightOnly, fade: 0,
      arch, home: pos.clone(), herd: o.herd ?? 0, alt: flyer ? randRange(1.5, 4) : 0, altGoal: flyer ? randRange(2.5, 6) : 0,
      speedMul: randRange(0.85, 1.15) * (alpha ? 0.9 : 1), den: o.den, dying: false, vy: 0, animAcc: 0, lod: 2,
    };
    if (arch === 'grazer' && rig.has?.('graze')) { w.state = 'graze'; w.timer = randRange(2, 8); rig.play('graze'); }
    this.list.push(w);
    // poof in when the player could see it
    if (o.player && Math.hypot(pos.x - o.player.x, pos.z - o.player.z) < 80) this.poof(pos, rig.height, alpha ? '#ffb04a' : shiny ? '#dff8ff' : '#ffffff');
    if (alpha) emit('alpha_spawn', { species: sp, zone: zone.id, level, x: pos.x, z: pos.z, den: o.den });
    return w;
  }

  private poof(pos: THREE.Vector3, h: number, color: string) {
    const c = pos.clone().add(new THREE.Vector3(0, h * 0.4, 0));
    for (let i = 0; i < 5; i++) {
      this.fx.sprite('smoke_07', c.clone().add(new THREE.Vector3(randRange(-0.4, 0.4) * h, randRange(-0.2, 0.3) * h, randRange(-0.4, 0.4) * h)), { color, size: h * 0.5, size1: h * 1.4, life: 0.7 + Math.random() * 0.3, opacity: 0.55, hdr: 1, vel: new THREE.Vector3(0, 0.6, 0) });
    }
    for (let i = 0; i < 6; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.7 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(2.5);
      this.fx.sprite('star_06', c, { color, size: 0.35, size1: 0.05, life: 0.6, vel: v, hdr: 1.6 });
    }
  }

  /** Remove a wild (after battle). Streaming refills the ring; a den's Alpha leaves its den empty for a while. */
  remove(id: number, respawn = true) {
    const i = this.list.findIndex((w) => w.id === id);
    if (i < 0) return;
    const w = this.list[i];
    this.group.remove(w.rig.root);
    w.label.remove();
    this.list.splice(i, 1);
    for (const j of w.joined ?? []) if (j !== id) this.remove(j, false);
    if (w.den) {
      const d = this.dens.find((x) => x.id === w.den);
      if (d) {
        d.live = null;
        if (respawn) {
          d.clearedUntil = Date.now() + DEN_RESPAWN_MIN * 60_000;
          const times = loadDenTimes(); times[d.id] = d.clearedUntil; saveDenTimes(times);
        }
      }
    }
  }

  get(id: number) { return this.list.find((w) => w.id === id); }

  /** The Wild plus any pack mate that runs in to help (the battle's enemy list). */
  party(w: Wild): { species: string; level: number; shiny: boolean; alpha: boolean }[] {
    const out = [{ species: w.species, level: w.level, shiny: w.shiny, alpha: w.alpha }];
    w.joined = [w.id];
    if (PACKS.has(w.species) && w.herd) {
      const mate = this.list.find((m) => m !== w && m.herd === w.herd && !m.dying && Math.hypot(m.pos.x - w.pos.x, m.pos.z - w.pos.z) < 14);
      if (mate) { out.push({ species: mate.species, level: mate.level, shiny: mate.shiny, alpha: false }); w.joined.push(mate.id); }
    }
    return out;
  }

  // ── per frame ─────────────────────────────────────────────────────────
  private blocked(w: Wild, nx: number, nz: number): boolean {
    if (Math.abs(nx) > HALF || Math.abs(nz) > HALF) return true;
    const h = this.data.heightAt(nx, nz);
    if (w.arch === 'swimmer') return h > WATER_LEVEL - 0.5;
    if (w.arch !== 'flyer' && (h < WATER_LEVEL + 0.15 || this.data.slopeAt(nx, nz) > 1.0)) return true;
    if (inTown(nx, nz, 4)) return true;
    if (w.arch === 'flyer' && w.alt > 2.5) return false;
    return this.props.nearby(nx, nz).some((c) => Math.hypot(nx - c.x, nz - c.z) < c.r + w.radius * 0.6);
  }

  private pickWander(w: Wild, range: number) {
    for (let t = 0; t < 6; t++) {
      const a = Math.random() * Math.PI * 2;
      const r = randRange(range * 0.4, range);
      const x = w.home.x + Math.cos(a) * r, z = w.home.z + Math.sin(a) * r;
      const ok = w.arch === 'swimmer' ? this.data.heightAt(x, z) < WATER_LEVEL - 0.6 : w.arch === 'flyer' || this.okGround(x, z, false) !== null;
      if (ok) { w.target.set(x, 0, z); return; }
    }
    w.target.copy(w.home);
  }

  /** Returns a wild that touched the player this frame (encounter), if any. */
  update(dt: number, t: number, player: THREE.Vector3, camera: THREE.Camera, paused: boolean, night: number): Wild | null {
    tickStageLights(false);
    this.fx.update(dt);
    // streaming: dens near the player, then keep the ring populated
    if (!paused) {
      this.spawnT -= dt;
      const now = Date.now();
      for (const d of this.dens) {
        const dd = Math.hypot(d.x - player.x, d.z - player.z);
        if (d.live === null && d.clearedUntil < now && dd < DENSITY.ring[1] + 30 && dd > 30) {
          if (!hasCreatureModel(d.species)) { this.request(d.species); continue; }
          const h = this.okGround(d.x, d.z, false);
          if (h === null) { d.clearedUntil = now + 3600_000; continue; }
          const w = this.spawn(d.species, d.zone, new THREE.Vector3(d.x, h, d.z), d.level, { alpha: true, den: d.id, player });
          d.live = w?.id ?? null;
        }
      }
      if (this.spawnT <= 0) {
        this.spawnT = 0.3;
        const around = this.list.filter((w) => !w.dying && Math.hypot(w.pos.x - player.x, w.pos.z - player.z) < DENSITY.ring[1] + 10).length;
        if (around < DENSITY.count && this.list.length < DENSITY.count * 1.6) this.trySpawn(player, camera, night);
      }
      // dawn: night-only Mystics slip away
      if (night < 0.4 && this.lastNight >= 0.4) for (const w of this.list) if (w.nightOnly) w.dying = true;
      this.lastNight = night;
    }
    let touched: Wild | null = null;
    const v = new THREE.Vector3();
    const VIEW = Q.wildView + 25;
    for (let wi = this.list.length - 1; wi >= 0; wi--) {
      const w = this.list[wi];
      const dx = player.x - w.pos.x, dz = player.z - w.pos.z;
      const dist = Math.hypot(dx, dz);
      // despawn far away (den Alphas come back when you return)
      if (dist > DESPAWN && !paused) {
        if (w.den) { const d = this.dens.find((x) => x.id === w.den); if (d) d.live = null; }
        this.remove(w.id, false);
        continue;
      }
      // fade in / out
      if (w.dying) {
        w.fade = Math.max(0, w.fade - dt * 1.6);
        if (w.fade <= 0) { if (dist < 80) this.poof(w.pos, w.rig.height, '#ffffff'); this.remove(w.id, false); continue; }
      } else w.fade = Math.min(1, w.fade + dt * 1.4);
      w.rig.look?.setFade(w.fade);
      const near = dist < VIEW;
      w.rig.root.visible = near && w.fade > 0.01;
      if (!near) { w.label.style.display = 'none'; continue; }
      w.cooldown = Math.max(0, w.cooldown - dt);
      let speed = 0;
      if (!paused && !w.dying) {
        w.timer -= dt;
        speed = this.think(w, dist, dx, dz, player);
        if (speed > 0) {
          const nx = w.pos.x + Math.sin(w.heading) * speed * dt;
          const nz = w.pos.z + Math.cos(w.heading) * speed * dt;
          if (this.blocked(w, nx, nz)) {
            w.heading += Math.PI * (0.5 + Math.random());
            if (w.state !== 'chase' && w.state !== 'flee' && w.state !== 'leap') { w.state = 'idle'; w.timer = 0.5; }
          } else { w.pos.x = nx; w.pos.z = nz; }
        }
        const low = w.arch !== 'flyer' || w.alt < 2.4;
        if (w.cooldown <= 0 && low && w.fade > 0.9 && dist < w.radius + 0.9 && w.state !== 'watch' && w.state !== 'approach') touched = w;
      }
      // vertical: ground, flying altitude, swimming surface, leaps
      const ground = this.data.heightAt(w.pos.x, w.pos.z);
      if (w.arch === 'flyer') {
        w.alt += (w.altGoal - w.alt) * (1 - Math.exp(-dt * 1.5));
        w.pos.y = Math.max(ground, WATER_LEVEL) + w.alt + Math.sin(t * 2.2 + w.id) * 0.18;
      } else if (w.arch === 'swimmer') {
        if (w.state === 'leap') {
          w.vy -= 16 * dt;
          w.alt += w.vy * dt;
          if (w.alt <= 0 && w.vy < 0) { w.alt = 0; w.state = 'wander'; w.timer = randRange(2, 5); if (dist < 60) this.splash(w.pos); }
        } else w.alt = Math.sin(t * 1.4 + w.id) * 0.08;
        w.pos.y = WATER_LEVEL - 0.25 + w.alt;
      } else w.pos.y = ground;
      w.rig.root.position.copy(w.pos);
      const cur = w.rig.root.rotation.y;
      const diff = Math.atan2(Math.sin(w.heading - cur), Math.cos(w.heading - cur));
      w.rig.root.rotation.y = cur + diff * Math.min(1, dt * 6);
      w.rig.root.rotation.x = w.arch === 'swimmer' && w.state === 'leap' ? -Math.atan2(w.vy, 6) * 0.8 : 0;
      // LOD: outline near, shadows mid, half-rate animation far
      const lod = dist < 28 ? 2 : dist < 58 ? 1 : 0;
      if (lod !== w.lod) { w.lod = lod; w.rig.look?.setDetail(lod as 0 | 1 | 2); }
      w.animAcc += dt;
      if (w.animAcc >= (lod === 0 ? 1 / 20 : 0)) { w.rig.update(w.animAcc, speed > 0 ? Math.min(1, speed / 4.5) : 0); w.animAcc = 0; }
      // label
      if (dist < 26 && w.fade > 0.5) {
        v.copy(w.pos); v.y += w.rig.height + 0.5;
        v.project(camera);
        if (v.z < 1) {
          w.label.style.display = 'flex';
          w.label.style.transform = `translate(-50%,-100%) translate(${(v.x * 0.5 + 0.5) * innerWidth}px,${(-v.y * 0.5 + 0.5) * innerHeight}px)`;
          w.label.style.opacity = String(Math.min(1, (26 - dist) / 6) * w.fade);
          w.label.classList.toggle('hostile', w.state === 'chase');
        } else w.label.style.display = 'none';
      } else w.label.style.display = 'none';
    }
    return touched;
  }

  private splash(p: THREE.Vector3) {
    for (let i = 0; i < 12; i++) {
      const vel = new THREE.Vector3(Math.random() - 0.5, 1.2 + Math.random(), Math.random() - 0.5).normalize().multiplyScalar(3 + Math.random() * 2);
      this.fx.sprite('light_01', new THREE.Vector3(p.x, WATER_LEVEL, p.z), { color: '#cfefff', size: 0.3, size1: 0.1, life: 0.6, vel, gravity: 12, hdr: 1.3 });
    }
    this.fx.groundDecal('circle_02', new THREE.Vector3(p.x, WATER_LEVEL - 0.05, p.z), { color: '#bfe8ff', size: 0.5, size1: 3.5, life: 0.7, opacity: 0.6 });
  }

  /** Archetype brains. Returns movement speed this frame (heading is set on `w`). */
  private think(w: Wild, dist: number, dx: number, dz: number, player: THREE.Vector3): number {
    const toPlayer = Math.atan2(dx, dz);
    const away = Math.atan2(-dx, -dz);
    const wanderSpeed = (w.arch === 'grazer' ? 1.3 : 1.9) * w.speedMul;
    const steer = (tx: number, tz: number) => { w.heading = Math.atan2(tx - w.pos.x, tz - w.pos.z); return Math.hypot(tx - w.pos.x, tz - w.pos.z); };
    // herd members follow their leader loosely and share its mood
    if (w.herd && w.state !== 'flee' && w.state !== 'chase') {
      const lead = this.list.find((m) => m.herd === w.herd && !m.dying);
      if (lead && lead !== w) {
        const d = Math.hypot(lead.pos.x - w.pos.x, lead.pos.z - w.pos.z);
        if (lead.state === 'flee') { w.state = 'flee'; w.timer = lead.timer; }
        else if (lead.state === 'chase') { w.state = 'chase'; w.timer = lead.timer; }
        else if (d > 7) { steer(lead.pos.x, lead.pos.z); w.state = 'wander'; w.timer = 1; return Math.min(4.2, 1.2 + d * 0.3) * w.speedMul; }
      }
    }
    // reactions to the player
    if (w.cooldown <= 0) {
      switch (w.arch) {
        case 'skittish':
          if (dist < 13 && w.state !== 'flee') { w.state = 'flee'; w.timer = randRange(2.5, 4); }
          break;
        case 'grazer':
          if (dist < 5 && w.state !== 'flee') { w.state = 'flee'; w.timer = 1.2; }
          break;
        case 'territorial': {
          const aggro = w.alpha ? 18 : 13;
          if (dist < aggro && w.state !== 'chase' && w.state !== 'return') { w.state = 'chase'; w.timer = w.alpha ? 9 : 6.5; if (w.alpha) w.rig.play('victory'); }
          break;
        }
        case 'curious':
          if (dist < 16 && dist > 5 && (w.state === 'idle' || w.state === 'wander' || w.state === 'graze')) { w.state = 'approach'; w.timer = 6; }
          break;
        case 'flyer':
          if (dist < 12 && w.state !== 'swoop') { w.state = 'swoop'; w.timer = randRange(3.5, 5.5); w.altGoal = 1.1; }
          break;
      }
    }
    switch (w.state) {
      case 'graze':
      case 'idle':
      case 'watch':
        if (w.state === 'watch') { w.heading = toPlayer; if (Math.random() < 0.004) w.rig.play('victory'); }
        if (w.timer <= 0) {
          if (w.arch === 'swimmer' && Math.random() < 0.3) { w.state = 'leap'; w.vy = randRange(6, 8.5); w.alt = 0; w.heading += randRange(-0.6, 0.6); this.splash(w.pos); return 6; }
          if (w.state === 'graze') w.rig.play('idle');
          w.state = w.arch === 'flyer' ? 'circle' : 'wander';
          w.timer = randRange(3, 7);
          if (w.arch === 'flyer') w.altGoal = randRange(2.5, 6.5);
          this.pickWander(w, w.arch === 'grazer' ? 9 : w.arch === 'swimmer' ? 14 : 12);
        }
        return 0;
      case 'wander': {
        const d = steer(w.target.x, w.target.z);
        if (d < 0.8 || w.timer <= 0) {
          const graze = w.arch === 'grazer' && !!w.rig.has?.('graze') && Math.random() < 0.65;
          w.state = graze ? 'graze' : 'idle';
          w.timer = graze ? randRange(4, 9) : randRange(1.5, 5);
          if (graze) w.rig.play('graze');
          return 0;
        }
        return wanderSpeed;
      }
      case 'circle': {
        const a = (performance.now() / 1000) * 0.45 * w.speedMul + w.id;
        const r = 7 + (w.id % 4);
        steer(w.home.x + Math.cos(a) * r, w.home.z + Math.sin(a) * r);
        if (w.timer <= 0) { w.state = 'idle'; w.timer = randRange(1, 3); w.altGoal = randRange(1.2, 3); }
        return 3.4 * w.speedMul;
      }
      case 'swoop': {
        // drop to eye level and hover just in front of the Wayfarer, then climb away
        const hx = player.x - Math.sin(toPlayer) * 4, hz = player.z - Math.cos(toPlayer) * 4;
        const d = steer(hx, hz);
        if (d < 1.2) w.heading = toPlayer;
        if (w.timer <= 0) { w.state = 'circle'; w.timer = randRange(4, 7); w.altGoal = randRange(3, 6.5); w.cooldown = 6; }
        return d < 1.2 ? 0 : 4.2 * w.speedMul;
      }
      case 'approach': {
        w.heading = toPlayer;
        if (dist < 4.6) { w.state = 'watch'; w.timer = randRange(3, 6); w.rig.play('victory'); return 0; }
        if (w.timer <= 0 || dist > 22) { w.state = 'wander'; w.timer = 4; w.cooldown = 12; this.pickWander(w, 12); }
        return 2.6 * w.speedMul;
      }
      case 'chase': {
        w.heading = toPlayer;
        const leash = Math.hypot(w.pos.x - w.home.x, w.pos.z - w.home.z);
        if (w.timer <= 0 || dist > 26 || (w.den && leash > 24)) { w.state = 'return'; w.timer = 8; w.cooldown = 4; }
        return (w.alpha ? 5.8 : 5.3) * w.speedMul;
      }
      case 'return': {
        const d = steer(w.home.x, w.home.z);
        if (d < 1.5 || w.timer <= 0) { w.state = 'idle'; w.timer = randRange(1, 3); }
        return 2.8 * w.speedMul;
      }
      case 'flee':
        w.heading = away + Math.sin(performance.now() / 400 + w.id) * 0.3;
        if (w.timer <= 0) { w.state = 'idle'; w.timer = 2.5; w.home.copy(w.pos); w.cooldown = 3; }
        return (w.arch === 'grazer' ? 4 : 6.2) * w.speedMul;
      case 'leap':
        return 6;
    }
    return 0;
  }

  hideLabels() { for (const w of this.list) w.label.style.display = 'none'; }

  nearestTo(p: THREE.Vector3, maxDist: number): Wild | null {
    let best: Wild | null = null, bd = maxDist;
    for (const w of this.list) {
      if (w.fade < 0.5 || w.dying) continue;
      if (w.arch === 'flyer' && w.alt > 2.6) continue;
      const d = Math.hypot(p.x - w.pos.x, p.z - w.pos.z) - w.radius;
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }
}
