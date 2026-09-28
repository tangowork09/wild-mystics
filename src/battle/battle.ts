import * as THREE from 'three';
import { makeCreatureRig, ensureCreatures } from '../assets/manifest';
import { LOOK } from '../assets/stylize';
import { sfx, music } from '../core/audio';
import { haptic } from '../core/haptics';
import { settings } from '../core/settings';
import { tweens, ease, wait, nextFrame } from '../core/tween';
import { clamp, pick } from '../core/noise';
import { ELEMENTS, effectiveness, type Element } from '../data/elements';
import { SKILLS, strikePattern, type Skill } from '../data/skills';
import { ORBS, STONE_ELEMENT, type OrbId, type ItemId } from '../data/items';
import { RELICS } from '../data/relics';
import { STATUS, PINCH, type StatusId } from '../data/traits';
import { WATER_LEVEL, type Zone } from '../data/zones';
import {
  grantXp, xpToNext, rankedAp, rankedPower, skillList, statsOf, displayName, speciesOf, type Creature,
} from '../game/creature';
import { state, addCreature, markSeen, BATTLE_SLOTS, addItem } from '../game/state';
import { emit } from '../game/events';
import type { Overworld } from '../world/world';
import { BattleUI, type Action } from './battleUI';
import { Unit } from './unit';
import { VFX } from './vfx';
import { BattleStage, stageCenter } from './stage';

export interface BattleSetup {
  kind: 'wild' | 'boss' | 'tamer';
  enemies: Creature[];
  zone: Zone;
  center: THREE.Vector3;
  forward: THREE.Vector3;
  advantage: 'player' | 'enemy' | null;
  tamer?: { name: string; title: string; intro: string };
  how?: string;
}

export interface BattleOutcome {
  result: 'win' | 'lose' | 'fled' | 'captured';
  captured: Creature[];
  evolvable: Creature[];
  drops: string[];
}

const UP = new THREE.Vector3(0, 1, 0);
const SPECIES_EL = (c: Creature) => speciesOf(c).element;
const PARRY_EARLY = 150, PARRY_LATE = 60, DODGE_EARLY = 270, DODGE_LATE = 80, WHIFF_LOCK = 450;
const auto = () => !!(window as unknown as { __autoplay?: boolean }).__autoplay;

/** Stand-in for a QTE ring when classic (non-parry) battles hide the timing prompts. */
const NO_RING = { set(_x: number, _y: number, _p: number) {}, judge(_t: string, _k: string) {} };

type Press = { kind: 'parry' | 'dodge' | 'jump' | 'qte'; t: number; used?: boolean };

export class Battle {
  units: Unit[] = [];
  vfx = new VFX();
  ui: BattleUI;
  burst = 0;
  autoBattle = false;
  speed: number = settings.battleSpeed;
  private C: THREE.Vector3;
  private F: THREE.Vector3;
  private R: THREE.Vector3;
  private reserves: Creature[] = [];
  /** v3 1v1: foes waiting their turn (trainer teams, pack mates, a second rustle in the grass). */
  private foeQueue: Creature[] = [];
  private presses: Press[] = [];
  private whiffs: number[] = [];
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private goalPos = new THREE.Vector3();
  private goalLook = new THREE.Vector3();
  private camLerp = 3;
  private shakeAmt = 0;
  private moving = new Map<Unit, number>();
  private captured: Creature[] = [];
  private participants = new Set<Creature>();
  private keyListener: (e: KeyboardEvent) => void;
  private orbMesh: THREE.Mesh | null = null;
  private selectRing: THREE.Mesh;
  private drops: string[] = [];
  // v3:creatures — staging, lens and hit-stop
  stage!: BattleStage;
  private fov = 55;
  private fovGoal = 55;
  private fovKick = 0;
  private baseFov = 55;
  private hitStop = 0;
  private stopScale = 1;

  constructor(private world: Overworld, private setup: BattleSetup) {
    this.F = setup.forward.clone().setY(0).normalize();
    if (this.F.lengthSq() < 0.01) this.F.set(0, 0, 1);
    // never fight among houses, barrels or in the lake: move to the nearest clean, flat stage
    this.C = stageCenter(world, setup.center, this.F, setup.kind);
    this.R = new THREE.Vector3().crossVectors(this.F, UP).normalize();
    this.ui = new BattleUI((u, y) => this.project(u, y));
    this.ui.onDefense = (k, t) => this.press(k, t);
    this.ui.onQte = (t) => this.press('qte', t);
    this.ui.onAuto = (on) => { this.autoBattle = on; };
    this.ui.onSpeed = (s) => { this.speed = s; };
    this.keyListener = (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      const now = performance.now();
      if (k === 'e' || k === ' ') this.press('parry', now);
      if (k === 'q' || k === 'shift') this.press('dodge', now);
      if (k === 'w' || k === 'arrowup') this.press('jump', now);
      if (k === ' ' || k === 'enter' || k === 'f') this.press('qte', now);
    };
    addEventListener('keydown', this.keyListener);
    this.world.scene.add(this.vfx.group);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffe8a8', transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    this.selectRing = new THREE.Mesh(new THREE.RingGeometry(1, 1.12, 48).rotateX(-Math.PI / 2), ringMat);
    this.selectRing.visible = false;
    this.world.scene.add(this.selectRing);
  }

  private press(kind: Press['kind'], t: number) {
    this.presses.push({ kind, t });
    if (this.presses.length > 40) this.presses.shift();
  }

  // ── Layout ─────────────────────────────────────────────────────────
  private ground(p: THREE.Vector3) {
    p.y = Math.max(this.world.data.heightAt(p.x, p.z), WATER_LEVEL + 0.05);
    return p;
  }
  private partySlot(i: number, n: number) {
    const lat = (i - (n - 1) / 2) * 2.8;
    return this.ground(this.C.clone().addScaledVector(this.F, (n === 1 ? -2.1 : -3.6) - Math.abs(i - (n - 1) / 2) * 0.9).addScaledVector(this.R, lat));
  }
  private enemySlot(j: number, n: number, boss: boolean, isBoss: boolean) {
    if (boss) {
      if (isBoss) return this.ground(this.C.clone().addScaledVector(this.F, 7));
      const side = j % 2 === 0 ? -1 : 1;
      return this.ground(this.C.clone().addScaledVector(this.F, 4.2).addScaledVector(this.R, side * 5.8));
    }
    const lat = (j - (n - 1) / 2) * 3.4;
    return this.ground(this.C.clone().addScaledVector(this.F, (n === 1 ? 2.3 : 3.8) + Math.abs(j - (n - 1) / 2) * 0.8).addScaledVector(this.R, lat));
  }
  private place(u: Unit, pos: THREE.Vector3) {
    u.home.copy(pos).add(new THREE.Vector3(0, u.hover, 0));
    u.rig.root.position.copy(u.home);
    const target = u.side === 'party' ? this.C.clone().addScaledVector(this.F, 5) : this.C.clone().addScaledVector(this.F, -5);
    u.face = Math.atan2(target.x - pos.x, target.z - pos.z);
    u.rig.root.rotation.y = u.face;
  }

  private async build() {
    const alive = state.team.filter((c) => c.hp > 0);
    const field = alive.slice(0, BATTLE_SLOTS);
    this.reserves = alive.slice(BATTLE_SLOTS);
    await ensureCreatures([...state.team.map((c) => c.species), ...this.setup.enemies.map((c) => c.species)]);
    field.forEach((c, i) => {
      const u = new Unit('party', c, makeCreatureRig(c.species, c.shiny), i);
      this.place(u, this.partySlot(i, field.length));
      u.rig.root.scale.setScalar(0.001);
      this.world.scene.add(u.rig.root);
      this.units.push(u);
      this.participants.add(c);
    });
    const isBossFight = this.setup.kind === 'boss';
    // v3: 1v1 — one Mystic per side. Guardians fight alone; trainers and packs send theirs one at a time.
    const foes = isBossFight ? this.setup.enemies.slice(0, 1) : this.setup.enemies;
    this.foeQueue = foes.slice(1);
    for (const c of foes) markSeen(c.species, this.setup.zone.id);
    foes.slice(0, 1).forEach((c, j) => {
      const u = this.makeFoe(c, j, isBossFight && j === 0);
      this.place(u, this.enemySlot(j, 1, isBossFight, j === 0));
      u.rig.look?.setFade(0);
      this.world.scene.add(u.rig.root);
      this.units.push(u);
    });
    // v3:creatures — the arena: cleared ring, rune decal, framed backdrop, stage lights
    const lead = this.setup.enemies[0];
    const accent = isBossFight && lead ? ELEMENTS[SPECIES_EL(lead)].color : this.setup.enemies.some((c) => c.alpha) ? '#ff8a4a' : undefined;
    this.stage = new BattleStage(this.world, this.setup.kind, this.setup.zone, this.C, this.F, accent);
    this.world.props.setClear(this.C.x, this.C.z, this.stage.radius + 1.5);
    this.world.grass.setClear(this.C.x, this.C.z, this.stage.radius + 0.5);
    LOOK.uRimBoost.value = 1.3;
    for (const u of this.units) {
      u.av = u.avStep * (0.3 + Math.random() * 0.25);
      if (u.relic('first_speed')) u.av *= 0.35;
      if (u.ability === 'swift') u.ap += 1;
      if (u.relic('first_ap')) u.ap += 2;
      if (u.relic('shield')) u.shield = Math.round(u.maxHp * 0.15);
    }
    for (const u of this.units) {
      if (u.ability !== 'intimidate') continue;
      for (const f of this.units.filter((x) => x.side !== u.side)) f.buffs.push({ stat: 'atk', amount: -0.15, turns: 4 });
    }
    if (this.setup.advantage === 'player') {
      for (const u of this.enemies) { u.av += u.avStep * 1.2; u.brk = u.brkMax * 0.35; }
      for (const u of this.party) u.av *= 0.2;
    } else if (this.setup.advantage === 'enemy') {
      for (const u of this.party) u.av += u.avStep;
      for (const u of this.enemies) u.av *= 0.2;
    }
    this.ui.mount(this.units);
    this.ui.refresh(this.units);
    this.ui.setBurst(this.burst);
    this.ui.setSpeed(this.speed);
    const ex = this.world.player.root;
    ex.position.copy(this.ground(this.C.clone().addScaledVector(this.F, -9.5).addScaledVector(this.R, 2.2)));
    ex.rotation.y = Math.atan2(this.F.x, this.F.z);
  }

  private makeFoe(c: Creature, slot: number, boss: boolean) {
    if (c.alpha) {
      // Alphas: elite genes, full health, a sturdier Break gauge
      c.genes = { hp: Math.max(c.genes.hp, 11), atk: Math.max(c.genes.atk, 11), def: Math.max(c.genes.def, 11), spd: Math.max(c.genes.spd, 10) };
      c.hp = statsOf(c).maxHp;
    }
    const u = new Unit('enemy', c, makeCreatureRig(c.species, c.shiny, { alpha: !!c.alpha }), slot, boss);
    if (c.alpha) u.brkMax = 170;
    return u;
  }

  /** 1v1: when the foe on the field falls or is caught, the next one steps in. */
  private async sendNextFoe() {
    if (this.alive('enemy').length || !this.foeQueue.length) return;
    const out = [...this.enemies].reverse().find((u) => u.gone || u.captured);
    const c = this.foeQueue.shift()!;
    await ensureCreatures([c.species]);
    const u = this.makeFoe(c, 0, false);
    this.place(u, this.enemySlot(0, 1, false, false));
    u.rig.look?.setFade(0);
    u.av = u.avStep * 0.6;
    this.world.scene.add(u.rig.root);
    this.units.push(u);
    if (out) this.ui.replaceCard(out, u); else this.ui.mount(this.units);
    const who = this.setup.kind === 'tamer' && this.setup.tamer ? `${this.setup.tamer.name} sends out ${u.name}!` : `A wild ${u.name} jumps in!`;
    this.ui.bannerText(who, 'info', 1100);
    sfx('encounter');
    const col = ELEMENTS[u.sp.element].color;
    this.vfx.groundDecal('symbol_01', u.home, { color: col, size: 1, size1: 3.5, life: 0.9, rot: 3 });
    this.shot(u.home.clone().addScaledVector(this.F, -(4 + u.height * 1.6)).addScaledVector(this.R, 1.6 + u.height * 0.4).addScaledVector(UP, 1 + u.height * 0.5), u.chest(), 2.4);
    await this.fadeIn(u, 0.5);
    u.rig.play('cast');
    await this.sleep(700);
    this.ui.refresh(this.units);
  }

  get party() { return this.units.filter((u) => u.side === 'party'); }
  get enemies() { return this.units.filter((u) => u.side === 'enemy'); }
  private alive(side: 'party' | 'enemy') { return this.units.filter((u) => u.side === side && u.alive); }
  private center(side: 'party' | 'enemy') {
    const list = this.alive(side);
    const c = new THREE.Vector3();
    if (!list.length) return side === 'party' ? this.C.clone().addScaledVector(this.F, -5) : this.C.clone().addScaledVector(this.F, 5);
    for (const u of list) c.add(u.home);
    return c.divideScalar(list.length);
  }

  // ── Camera ─────────────────────────────────────────────────────────
  private shot(pos: THREE.Vector3, look: THREE.Vector3, speed = 3, cut = false) {
    this.goalPos.copy(pos);
    this.goalLook.copy(look);
    this.camLerp = speed;
    if (cut) { this.camPos.copy(pos); this.camLook.copy(look); }
  }
  private shotOverview(speed = 2.2) {
    const boss = this.setup.kind === 'boss' ? 1.35 : 1;
    if (boss === 1) {
      // v3 1v1 duel framing: over the partner's shoulder, both Mystics large in frame
      const h = Math.max(1, ...this.units.filter((u) => u.alive).map((u) => u.height));
      const k = 0.75 + h * 0.25;
      this.shot(this.C.clone().addScaledVector(this.F, -8.2 * k).addScaledVector(this.R, 4.6 * k).addScaledVector(UP, 2.6 + 1.3 * k), this.C.clone().addScaledVector(this.F, 0.9).addScaledVector(UP, 0.9 + h * 0.3), speed);
      return;
    }
    this.shot(this.C.clone().addScaledVector(this.F, -13 * boss).addScaledVector(this.R, 7 * boss).addScaledVector(UP, 6.5 * boss), this.C.clone().addScaledVector(this.F, 1.5).addScaledVector(UP, 1.6 * boss), speed);
  }
  private shoulder(u: Unit, focus: THREE.Vector3, focusH: number) {
    const dir = focus.clone().sub(u.home).setY(0);
    if (dir.lengthSq() < 0.01) dir.copy(this.F);
    dir.normalize();
    const right = new THREE.Vector3().crossVectors(dir, UP).normalize();
    const h = u.height;
    const big = Math.max(1, focusH / 2.2);
    const duel = this.setup.kind !== 'boss' ? 0.78 : 1; // v3 1v1: sit closer so both duelists read large
    const back = (2.4 + h * 1.35) * duel + (big - 1) * 1.6;
    const side = (1.15 + h * 0.75) * duel;
    const up = 0.55 + h * 0.8 + (big - 1) * 0.9;
    const pos = u.home.clone().addScaledVector(dir, -back).addScaledVector(right, side).addScaledVector(UP, up);
    const look = u.home.clone().lerp(focus, 0.72).addScaledVector(UP, Math.min(focusH * 0.55, 3.2) + 0.2);
    return { pos, look };
  }
  private shotCommand(u: Unit) {
    const ec = this.center('enemy');
    const eh = Math.max(...this.alive('enemy').map((e) => e.height), 1);
    const { pos, look } = this.shoulder(u, ec, eh);
    this.shot(pos, look, 3.2);
  }
  private shotTarget(u: Unit, t: Unit) {
    const { pos, look } = this.shoulder(u, t.home, t.height);
    this.shot(pos, look, 4);
  }
  private sideSign = 1;
  private shotSide() {
    const boss = this.setup.kind === 'boss' ? 1.45 : 1;
    this.shot(this.C.clone().addScaledVector(this.R, 12.5 * boss).addScaledVector(this.F, -2.5).addScaledVector(UP, 3.4 * boss), this.C.clone().addScaledVector(this.F, 0.5).addScaledVector(UP, 1.4 * boss), 3);
  }
  /** Side-on action two-shot of an exchange (keeps to the overview's side of the line). */
  private shotAction(from: THREE.Vector3, fromH: number, t: Unit, speed = 4) {
    const dir = t.home.clone().sub(from).setY(0);
    if (dir.lengthSq() < 0.01) dir.copy(this.F);
    dir.normalize();
    let side = new THREE.Vector3().crossVectors(dir, UP).normalize();
    if (side.dot(this.R) < 0) side.negate();
    const hh = Math.max(t.height, fromH);
    const gap = from.distanceTo(t.home);
    // ranged shots frame the receiving end; melee frames both fighters
    const focus = gap > 5 ? t.home.clone().addScaledVector(dir, -Math.min(3.2, gap * 0.3)) : from.clone().lerp(t.home, 0.55);
    const span = Math.min(gap, 6) + hh;
    const dist = Math.max(4, span * 0.9 + 2);
    const cam = (sd: THREE.Vector3) => focus.clone().addScaledVector(sd, dist).addScaledVector(dir, -dist * 0.32).addScaledVector(UP, 0.9 + hh * 0.45);
    // stay on the overview's side unless another Mystic would block the lens
    const clear = (p: THREE.Vector3) => Math.min(...this.units.filter((u) => u.alive && u !== t).map((u) => Math.hypot(u.home.x - p.x, u.home.z - p.z) - u.radius));
    let pos = cam(side);
    if (clear(pos) < 2.2) { const alt = cam(side.clone().negate()); if (clear(alt) > clear(pos)) pos = alt; }
    this.shot(pos, focus.clone().addScaledVector(UP, hh * 0.45), speed);
  }
  /** Wide three-quarter view of one side (area attacks). */
  private shotGroup(side: 'party' | 'enemy', speed = 3) {
    const c = this.center(side);
    const hh = Math.max(1, ...this.alive(side).map((u) => u.height));
    const toward = side === 'enemy' ? this.F.clone().negate() : this.F.clone();
    this.shot(c.clone().addScaledVector(toward, 6.5 + hh * 1.6).addScaledVector(this.R, 4.5 + hh * 0.8).addScaledVector(UP, 2 + hh * 0.6), c.clone().addScaledVector(UP, hh * 0.45), speed);
  }
  /** Defender's-eye view of an incoming attack: behind the target's shoulder, the attacker framed. */
  private shotDefend(target: Unit, attacker: Unit) {
    const dir = attacker.home.clone().sub(target.home).setY(0);
    if (dir.lengthSq() < 0.01) dir.copy(this.F);
    dir.normalize();
    const right = new THREE.Vector3().crossVectors(dir, UP).normalize();
    const h = target.height, ah = attacker.height, big = Math.max(0, ah - 2);
    const pos = target.home.clone().addScaledVector(dir, -(2.8 + h * 1.25 + big * 0.8)).addScaledVector(right, -(1.2 + h * 0.6)).addScaledVector(UP, 0.9 + h * 0.75 + big * 0.35);
    const look = target.home.clone().lerp(attacker.home, 0.68).addScaledVector(UP, Math.min(ah * 0.5, 3.6) + 0.25);
    this.shot(pos, look, 3.4);
  }
  shake(a: number) { this.shakeAmt = Math.max(this.shakeAmt, a * settings.screenShake); }
  /** Zoom punch: the lens narrows for a moment (crits, parries, roars). */
  private kick(deg: number) { this.fovKick = Math.min(this.fovKick + deg, 16); }
  /** Hit-stop: freeze the picture (rigs + particles) for a few frames; the game clock keeps running. */
  private freeze(ms: number, scale = 0.04) { this.hitStop = Math.max(this.hitStop, ms / 1000); this.stopScale = scale; }

  update(dt: number) {
    const k = 1 - Math.exp(-dt * this.camLerp);
    this.camPos.lerp(this.goalPos, k);
    this.camLook.lerp(this.goalLook, k);
    const cam = this.world.camera;
    const ground = this.world.data.heightAt(this.camPos.x, this.camPos.z) + 0.7;
    if (this.camPos.y < ground) this.camPos.y = ground;
    cam.position.copy(this.camPos);
    if (this.shakeAmt > 0.001) {
      cam.position.add(new THREE.Vector3((Math.random() - 0.5) * this.shakeAmt, (Math.random() - 0.5) * this.shakeAmt, (Math.random() - 0.5) * this.shakeAmt));
      this.shakeAmt *= Math.exp(-dt * 9);
    }
    cam.lookAt(this.camLook);
    // lens: slow FOV moves + decaying zoom punches
    this.fovKick *= Math.exp(-dt * 7);
    this.fov += (this.fovGoal - this.fov) * (1 - Math.exp(-dt * 3.5));
    const fv = this.fov - this.fovKick;
    if (Math.abs(cam.fov - fv) > 0.01) { cam.fov = fv; cam.updateProjectionMatrix(); }
    const stop = this.hitStop > 0 ? this.stopScale : 1;
    this.hitStop = Math.max(0, this.hitStop - dt);
    const gdt = dt * tweens.timeScale * this.speed * stop;
    const t = performance.now() / 1000;
    for (const u of this.units) {
      if (u.hover > 0 && !this.moving.get(u)) u.rig.root.position.y = u.home.y + Math.sin(t * 2 + u.slot) * 0.12;
      u.rig.update(gdt, this.moving.get(u) ?? 0);
    }
    this.world.player.update(gdt, 0);
    this.vfx.update(gdt);
    this.stage?.update(dt, cam);
    if (this.orbMesh) this.orbMesh.rotation.y += dt * 4;
    if (this.selectRing.visible) (this.selectRing.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.sin(performance.now() / 150) * 0.3;
  }

  private project(u: Unit, yFrac = 0.6) {
    const v = u.rig.root.position.clone().addScaledVector(UP, u.height * yFrac).project(this.world.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, visible: v.z < 1 };
  }
  private projectPoint(p: THREE.Vector3) {
    const v = p.clone().project(this.world.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
  }
  private floatAt(u: Unit, text: string, cls: string) {
    if (!settings.damageNumbers && cls.startsWith('dmg')) return;
    const p = this.project(u, 1.0);
    this.ui.float(p.x + (Math.random() - 0.5) * 30, p.y, text, cls);
  }
  private addBurst(n: number, u?: Unit) {
    const mult = u?.relic('burst') ? 1.3 : 1;
    const before = this.burst;
    this.burst = Math.min(100, this.burst + n * mult);
    if (before < 100 && this.burst >= 100) { this.ui.bannerText('BURST READY', 'good', 900); sfx('levelup'); haptic('success'); }
    this.ui.setBurst(this.burst);
  }
  private async sleep(ms: number) { await wait(ms / this.speed); }

  // ── Main flow ──────────────────────────────────────────────────────
  async run(): Promise<BattleOutcome> {
    await this.build();
    music(this.setup.kind === 'boss' ? 'boss' : 'battle');
    await this.intro();
    const outcome = await this.loop();
    await this.finish(outcome);
    return outcome;
  }

  private async fadeIn(u: Unit, dur: number) {
    await tweens.tween(dur, (k) => u.rig.look?.setFade(k), ease.out);
    u.rig.look?.setFade(1);
  }

  private async intro() {
    this.ui.hideHud(true);
    const wc = this.world.camera;
    this.baseFov = wc.fov;
    this.fov = wc.fov;
    this.fovGoal = wc.fov;
    this.camPos.copy(wc.position);
    this.camLook.copy(wc.position.clone().add(wc.getWorldDirection(new THREE.Vector3()).multiplyScalar(10)));
    const boss = this.setup.kind === 'boss';
    void this.stage.reveal(boss ? 1.7 : 1.0);
    for (const u of this.enemies) {
      void this.fadeIn(u, boss ? 0.6 : 0.45);
      this.vfx.sprite('smoke_07', u.chest(), { color: '#ffffff', size: u.height * 0.8, size1: u.height * 1.8, life: 0.7, opacity: 0.35 });
    }
    if (boss) await this.introBoss();
    else await this.introWild();
    if (this.setup.advantage === 'player') this.ui.bannerText('First Strike!', 'good', 1000);
    if (this.setup.advantage === 'enemy') this.ui.bannerText('Ambushed!', 'bad', 1000);
    await this.partyEntrance();
    this.fovGoal = this.baseFov;
    this.ui.hideHud(false);
  }

  /** Low establishing sweep toward the foes; Alphas roar, shinies get a prismatic reveal. */
  private async introWild() {
    const ec = this.center('enemy');
    const eh = Math.max(1, ...this.enemies.map((e) => e.height));
    const side = Math.random() < 0.5 ? -1 : 1;
    const lookAt = ec.clone().addScaledVector(UP, eh * 0.55);
    this.shot(this.C.clone().addScaledVector(this.F, -10.5).addScaledVector(this.R, side * 8.5).addScaledVector(UP, 1.3 + eh * 0.25), lookAt, 99, true);
    this.fov = this.baseFov + 6;
    this.fovGoal = this.baseFov - 5;
    this.shot(ec.clone().addScaledVector(this.F, -5.2 - eh * 1.25).addScaledVector(this.R, side * (2.4 + eh * 0.55)).addScaledVector(UP, 0.9 + eh * 0.5), lookAt, 1.5);
    await wait(420);
    const alpha = this.enemies.find((u) => u.c.alpha);
    const shinies = this.enemies.filter((u) => u.c.shiny);
    const names = this.enemies.map((u) => u.name).join(' & ');
    if (this.setup.kind === 'tamer' && this.setup.tamer) {
      this.ui.bannerText(`<small>${this.setup.tamer.title}</small>${this.setup.tamer.name} wants to battle!`, 'wild', 1600);
      this.enemies.forEach((u) => u.rig.play('victory'));
      await wait(1500);
      return;
    }
    if (alpha) {
      // the Alpha rears up: low camera, roar, shockwave
      this.shot(alpha.home.clone().addScaledVector(this.F, -(alpha.height * 1.3 + 3.2)).addScaledVector(this.R, side * 1.6).addScaledVector(UP, 0.5), alpha.home.clone().addScaledVector(UP, alpha.height * 0.7), 2.2);
      alpha.rig.play('victory');
      await wait(380);
      sfx('quake');
      haptic('heavy');
      this.shake(0.5);
      this.kick(9);
      this.vfx.shockwave(alpha.home.clone(), '#ff8a4a', alpha.height * 4, 0.8);
      this.vfx.sparks(alpha.chest(), '#ffb04a', 30, 9);
      this.stage.flash(alpha.chest(), '#ff8a3a', 1.4);
      this.ui.bannerText(`<small>An Alpha blocks your path</small>Alpha ${alpha.name}`, 'boss', 2000);
      await wait(1500);
    }
    if (shinies.length) {
      const u = shinies[0];
      sfx('rare');
      haptic('success');
      for (const x of shinies) { this.vfx.shinyBurst(x.home.clone(), x.height); x.rig.look?.flash('#fff6ff', 0.85, 0.6); }
      this.ui.bannerText(`<small>✧ A shimmering ✧</small>${alpha ? '' : `Wild ${names} appeared!`}`, 'shiny', 1900);
      const c = u.chest();
      const r = 2.2 + u.height * 1.5;
      const a0 = Math.atan2(-this.F.x, -this.F.z) - 0.9 * side;
      await tweens.tween(1.6, (k) => {
        const a = a0 + k * 1.3 * side;
        this.shot(c.clone().add(new THREE.Vector3(Math.sin(a) * r, 0.4 + u.height * 0.3 + k * 0.4, Math.cos(a) * r)), c, 30, true);
      }, ease.inOut);
      u.rig.play('victory');
      await wait(300);
      return;
    }
    if (!alpha) this.ui.bannerText(`Wild ${names} appeared!`, 'wild', 1400);
    this.enemies.forEach((u) => u.rig.play('victory'));
    await wait(1200);
  }

  /** Guardians: from the dust at its feet, looking up, as the arena's pillars rise. */
  private async introBoss() {
    const b = this.enemies[0];
    const side = Math.random() < 0.5 ? -1 : 1;
    const col = ELEMENTS[b.sp.element].color;
    const look = b.home.clone().addScaledVector(UP, b.height * 0.72);
    this.shot(b.home.clone().addScaledVector(this.F, -(b.height * 1.5 + 5)).addScaledVector(this.R, side * 3).addScaledVector(UP, 0.7), look, 99, true);
    this.fov = this.baseFov + 10;
    this.fovGoal = this.baseFov - 4;
    this.shot(b.home.clone().addScaledVector(this.F, -(b.height * 1.05 + 4)).addScaledVector(this.R, side * 1.6).addScaledVector(UP, 1.1), look, 0.75);
    await wait(900);
    b.rig.play('victory');
    await wait(380);
    sfx('quake');
    haptic('heavy');
    this.shake(0.7);
    this.kick(11);
    this.stage.flash(b.chest(), col, 2);
    this.vfx.shockwave(b.home.clone().sub(new THREE.Vector3(0, b.hover, 0)), col, 18, 1.0);
    this.vfx.sparks(b.chest(), col, 40, 12);
    this.ui.bannerText(`<small>${this.setup.zone.name} Guardian</small>${b.name}`, 'boss', 2600);
    await wait(1700);
    this.shot(this.C.clone().addScaledVector(this.F, -17).addScaledVector(this.R, side * 11).addScaledVector(UP, 8.5), this.C.clone().addScaledVector(this.F, 4).addScaledVector(UP, 3.2), 1.5);
    this.fovGoal = this.baseFov;
    await wait(900);
  }

  /** The Wayfarer throws an orb to each slot; each Mystic materialises in its element's light. */
  private async partyEntrance() {
    this.shotOverview(2.4);
    const ex = this.world.player;
    ex.play('attack');
    await wait(260);
    const from = ex.root.position.clone().add(new THREE.Vector3(0, 1.5, 0));
    for (const u of this.party) {
      const to = u.home.clone().add(new THREE.Vector3(0, 0.6, 0));
      const col = ELEMENTS[u.sp.element].color;
      sfx('orb');
      void this.vfx.projectile(from, to, '#ffe8a8', 0.3, 1.8).then(() => {
        this.vfx.sprite('flare_01', u.chest(), { color: col, size: 1, size1: 4.5, life: 0.4 });
        this.vfx.groundDecal('symbol_01', u.home, { color: col, size: 1, size1: 3.5, life: 0.9, rot: 3 });
        this.stage.flash(u.chest(), col, 0.6);
        u.rig.look?.setDissolve(0.98, col);
        void tweens.tween(0.35, (t) => u.rig.root.scale.setScalar(Math.max(0.001, ease.back(t))), ease.linear);
        void tweens.tween(0.7, (t) => u.rig.look?.setDissolve(0.98 * (1 - t), col), ease.out).then(() => u.rig.look?.setDissolve(0));
      });
      await wait(170);
    }
    await wait(700);
  }

  private predictOrder(n = 9): Unit[] {
    const sim = this.units.filter((u) => u.alive).map((u) => ({ u, av: u.av }));
    const out: Unit[] = [];
    if (!sim.length) return out;
    for (let i = 0; i < n; i++) {
      sim.sort((a, b) => a.av - b.av);
      const f = sim[0];
      out.push(f.u);
      const m = f.av;
      for (const s of sim) s.av -= m;
      f.av = f.u.avStep * (f.u.broken && i === 0 ? 2 : 1);
    }
    return out;
  }

  private nextActor(): Unit {
    const alive = this.units.filter((u) => u.alive).sort((a, b) => a.av - b.av);
    const u = alive[0];
    const m = u.av;
    for (const o of alive) o.av -= m;
    u.av = u.avStep;
    return u;
  }

  private checkEnd(): BattleOutcome['result'] | null {
    if (!this.alive('enemy').length && !this.foeQueue.length) return this.enemies.every((u) => u.captured) ? 'captured' : 'win';
    if (!this.alive('party').length && !this.reserves.some((c) => c.hp > 0)) return 'lose';
    return null;
  }

  /** Start-of-turn effects. Returns false if the unit loses its turn. */
  private async startTurn(u: Unit): Promise<boolean> {
    u.turnsTaken++;
    u.momentumUsed = false;
    u.buffs = u.buffs.map((b) => ({ ...b, turns: b.turns - 1 })).filter((b) => b.turns > 0);
    if (u.ability === 'regenerator' && u.c.hp < u.maxHp) this.healUnit(u, Math.round(u.maxHp * 0.06), true);
    if (u.relic('ap_regen') && Math.random() < 0.3 && u.side === 'party') { u.ap = Math.min(9, u.ap + 1); this.floatAt(u, '+1 AP', 'buff'); }
    const st = u.status;
    if (!st) return true;
    const info = STATUS[st.id];
    if (st.id === 'burn' || st.id === 'poison') {
      const pct = st.id === 'burn' ? 0.06 : 0.06 + st.stack * 0.02;
      const dmg = Math.max(1, Math.round(u.maxHp * pct));
      u.c.hp = Math.max(0, u.c.hp - dmg);
      this.floatAt(u, `${dmg}`, 'dmg taken');
      this.vfx.sprite(st.id === 'burn' ? 'fire_01' : 'smoke_04', u.chest(), { color: info.color, size: 1.2, size1: 2, life: 0.5 });
      st.stack++;
      this.ui.refresh(this.units);
      await this.sleep(350);
      if (u.c.hp <= 0) return false;
    }
    st.turns--;
    if (st.id === 'sleep' || st.id === 'freeze') {
      const thaw = st.id === 'freeze' ? Math.random() < 0.3 : false;
      if (st.turns <= 0 || thaw) { u.status = null; this.floatAt(u, st.id === 'sleep' ? 'Woke up!' : 'Thawed!', 'info'); this.ui.refresh(this.units); return true; }
      this.floatAt(u, st.id === 'sleep' ? 'Zzz…' : 'Frozen solid', 'info');
      await this.sleep(500);
      return false;
    }
    if (st.id === 'paralyze' && Math.random() < 0.25) { this.floatAt(u, 'Paralysed!', 'info'); await this.sleep(450); if (st.turns <= 0) u.status = null; return false; }
    if (st.turns <= 0) { u.status = null; this.floatAt(u, `${info.name} faded`, 'info'); }
    this.ui.refresh(this.units);
    return true;
  }

  private async loop(): Promise<BattleOutcome> {
    for (let guard = 0; guard < 500; guard++) {
      const end = this.checkEnd();
      if (end) return { result: end, captured: this.captured, evolvable: [], drops: this.drops };
      const u = this.nextActor();
      this.ui.setTimeline(this.predictOrder(), u);
      this.ui.refresh(this.units, u);
      if (u.broken) {
        u.broken = false;
        u.brk = 0;
        this.floatAt(u, 'Recovered', 'info');
        this.ui.refresh(this.units);
        await this.sleep(500);
        continue;
      }
      const canAct = await this.startTurn(u);
      if (canAct && u.alive) {
        if (u.side === 'party') {
          const r = await this.partyTurn(u);
          if (r) return { result: r, captured: this.captured, evolvable: [], drops: this.drops };
        } else {
          await this.enemyTurn(u);
        }
      }
      this.ui.hideSkill();
      await this.resolveFaints();
      await this.sendNextFoe();
      this.ui.refresh(this.units);
    }
    return { result: 'fled', captured: this.captured, evolvable: [], drops: this.drops };
  }

  // ── Party turn ─────────────────────────────────────────────────────
  private autoAction(u: Unit): { skill: Skill; rank: number; targets: Unit[] } {
    const foes = this.alive('enemy');
    const target = foes.reduce((a, b) => (a.c.hp / a.maxHp < b.c.hp / b.maxHp ? a : b));
    const hurt = this.alive('party').find((p) => p.c.hp < p.maxHp * 0.4);
    const list = skillList(u.c).filter((s) => u.ap >= rankedAp(s.skill, s.rank));
    const heal = list.find((s) => s.skill.kind === 'heal');
    if (hurt && heal) return { skill: heal.skill, rank: heal.rank, targets: heal.skill.target === 'allAllies' ? this.alive('party') : heal.skill.target === 'self' ? [u] : [hurt] };
    const attacks = list.filter((s) => s.skill.kind === 'attack');
    const score = (x: { skill: Skill; rank: number }) => effectiveness(x.skill.id === 'strike' ? u.sp.element : x.skill.element, target.sp.element) * rankedPower(x.skill, x.rank) * x.skill.hits;
    const best = attacks.reduce((a, b) => (score(b) > score(a) ? b : a), attacks[0] ?? { skill: SKILLS.strike, rank: 1 });
    return { skill: best.skill, rank: best.rank, targets: best.skill.target === 'allEnemies' ? foes : [target] };
  }

  private async partyTurn(u: Unit): Promise<BattleOutcome['result'] | null> {
    for (;;) {
      this.shotCommand(u);
      this.selectRing.visible = true;
      this.selectRing.position.copy(u.home).add(new THREE.Vector3(0, 0.1 - u.hover, 0));
      this.selectRing.scale.setScalar(u.radius * 1.6);
      if (this.autoBattle) {
        await this.sleep(350);
        this.selectRing.visible = false;
        if (this.burst >= 100) { await this.useBurst(u); return null; }
        const a = this.autoAction(u);
        u.ap -= rankedAp(a.skill, a.rank);
        if (a.skill.id === 'strike') u.ap = Math.min(9, u.ap + 1);
        await this.playerSkill(u, a.skill, a.rank, a.targets);
        return null;
      }
      const canSwap = this.reserves.some((c) => c.hp > 0);
      const act: Action = await this.ui.menu(u, { canCapture: this.setup.kind === 'wild', canFlee: this.setup.kind === 'wild', canSwap, burstReady: this.burst >= 100, isNight: this.world.isNight, zone: this.setup.zone.id });
      this.selectRing.visible = false;
      if (this.autoBattle && act.type === 'auto') continue;

      if (act.type === 'burst') { await this.useBurst(u); return null; }

      if (act.type === 'skill') {
        const { skill, rank } = act;
        let targets: Unit[] = [];
        if (skill.target === 'enemy') {
          const t = await this.pickEnemy(u, skill);
          if (!t) continue;
          targets = [t];
        } else if (skill.target === 'allEnemies') targets = this.alive('enemy');
        else if (skill.target === 'self') targets = [u];
        else if (skill.target === 'ally') {
          const t = await this.ui.pickTarget(this.alive('party'), skill.name, (x) => `${x.c.hp}/${x.maxHp} HP`);
          if (!t) continue;
          targets = [t];
        } else targets = this.alive('party');
        u.ap -= rankedAp(skill, rank);
        if (skill.id === 'strike') u.ap = Math.min(9, u.ap + 1);
        this.ui.refresh(this.units, u);
        await this.playerSkill(u, skill, rank, targets);
        return null;
      }

      if (act.type === 'capture') {
        const cands = this.alive('enemy');
        const t = await this.ui.pickTarget(cands, ORBS[act.orb].name, (x) => `${Math.round(this.captureChance(x, act.orb, 0) * 100)}% chance`);
        if (!t) continue;
        state.inv.orbs[act.orb]--;
        await this.capture(t, act.orb);
        return null;
      }

      if (act.type === 'item') {
        const it = act.item;
        const cands = it === 'elixir' ? this.party.filter((x) => !x.captured) : this.alive('party');
        const t = await this.ui.pickTarget(cands, it.replace('_', ' '), (x) => `${x.c.hp}/${x.maxHp} HP${x.status ? ' · ' + STATUS[x.status.id].name : ''}`);
        if (!t) continue;
        this.world.player.play('interact');
        await this.sleep(400);
        addItem(it, -1);
        if (it === 'tonic') this.healUnit(t, Math.round(t.maxHp * 0.5));
        else if (it === 'mega_tonic') this.healUnit(t, t.maxHp);
        else if (it === 'ether') { t.ap = Math.min(9, t.ap + 3); this.floatAt(t, '+3 AP', 'buff'); sfx('heal'); }
        else if (it === 'cleanse') { t.status = null; this.floatAt(t, 'Cured', 'buff'); sfx('heal'); this.vfx.heal(t.home.clone(), '#bff0ff'); }
        else if (it === 'elixir') {
          if (!t.alive) { t.gone = false; t.c.hp = Math.round(t.maxHp * 0.5); t.rig.play('idle'); t.rig.root.rotation.set(0, t.face, 0); this.floatAt(t, 'Revived!', 'heal'); }
          else this.healUnit(t, t.maxHp);
        }
        this.ui.refresh(this.units);
        await this.sleep(600);
        return null;
      }

      if (act.type === 'swap') {
        const next = this.reserves.find((c) => c.hp > 0);
        if (!next) continue;
        await this.swapIn(u, next);
        return null;
      }

      if (act.type === 'flee') {
        const pSpd = Math.max(...this.alive('party').map((x) => x.stat('spd')));
        const eSpd = Math.max(...this.alive('enemy').map((x) => x.stat('spd')));
        const chance = clamp(0.62 + (pSpd - eSpd) * 0.02, 0.35, 0.95);
        if (Math.random() < chance) {
          sfx('dodge');
          this.ui.bannerText('Got away safely!', 'info', 900);
          await wait(900);
          return 'fled';
        }
        sfx('error');
        this.ui.bannerText("Couldn't escape!", 'bad', 900);
        await wait(900);
        return null;
      }
    }
  }

  private async pickEnemy(u: Unit, skill: Skill): Promise<Unit | null> {
    const cands = this.alive('enemy');
    const el = skill.id === 'strike' ? u.sp.element : skill.element;
    this.ui.onTargetChange = (t) => this.shotTarget(u, t);
    const t = await this.ui.pickTarget(cands, skill.name, (x) => {
      const e = effectiveness(el, x.sp.element);
      const tag = e > 1.2 ? '<b class="eff up">Super effective</b>' : e < 0.9 ? '<b class="eff down">Resisted</b>' : '';
      return `${Math.round((x.c.hp / x.maxHp) * 100)}% HP ${tag}`;
    });
    this.ui.onTargetChange = undefined;
    return t;
  }

  private window(ms: number, target?: Unit) {
    let k = settings.qteAssist ? 1.5 : 1;
    if (target?.ability === 'keen_eye') k *= 1.4;
    return ms * k;
  }

  /** Timed-hit QTE. */
  private async qteHit(anchor: () => { x: number; y: number }, leadMs: number): Promise<'perfect' | 'good' | 'miss'> {
    leadMs = leadMs / Math.max(1, this.speed * 0.85);
    if (!settings.parryMode) { await wait(leadMs * 0.7); return 'good'; } // v3 classic: no timing
    const ring = this.ui.ring('attack');
    const t0 = performance.now();
    const impact = t0 + leadMs;
    this.presses = this.presses.filter((p) => p.kind !== 'qte');
    let autoPressed = false;
    const perfectW = this.window(70), goodW = this.window(170);
    for (;;) {
      await nextFrame();
      const now = performance.now();
      const a = anchor();
      ring.set(a.x, a.y, (now - t0) / leadMs);
      if ((auto() || this.autoBattle) && !autoPressed && now >= impact - (this.autoBattle && !auto() ? (Math.random() < 0.3 ? 20 : 120) : 12)) { autoPressed = true; this.press('qte', now); }
      const early = this.presses.find((pp) => pp.kind === 'qte' && !pp.used && pp.t >= t0 && pp.t < impact - 260);
      if (early) { early.used = true; ring.judge('TOO EARLY', 'miss'); sfx('miss'); return 'miss'; }
      const p = this.presses.find((pp) => pp.kind === 'qte' && !pp.used && pp.t >= impact - 260);
      if (p) {
        p.used = true;
        const d = Math.abs(p.t - impact);
        const res = d <= perfectW ? 'perfect' : d <= goodW ? 'good' : 'miss';
        ring.judge(res === 'perfect' ? 'PERFECT' : res === 'good' ? 'GOOD' : 'MISS', res);
        if (res === 'perfect') { sfx('perfect'); haptic('light'); emit('perfect', {}); }
        return res;
      }
      if (now > impact + goodW) { ring.judge('MISS', 'miss'); return 'miss'; }
    }
  }

  private async playerSkill(u: Unit, skill: Skill, rank: number, targets: Unit[]) {
    const el = skill.id === 'strike' ? u.sp.element : skill.element;
    const color = ELEMENTS[el].color;
    this.ui.skill(skill.name, color, u.name, !!skill.ultimate);
    const primary = targets[0];

    if (skill.kind === 'heal' || skill.kind === 'buff' || (skill.kind === 'debuff' && skill.power === 0)) {
      this.shotTarget(u, primary);
      u.rig.play('cast');
      this.vfx.aura(u.home, color);
      const res = await this.qteHit(() => this.project(primary.side === 'enemy' ? primary : u, 0.7), 800);
      const mult = res === 'perfect' ? 1.3 : res === 'good' ? 1 : 0.75;
      for (const t of targets) {
        if (skill.kind === 'heal') {
          this.healUnit(t, Math.round(rankedPower(skill, rank) * (1 + u.c.level * 0.12) * 1.2 * mult));
          if (skill.cure && t.status) { t.status = null; this.floatAt(t, 'Cured', 'buff'); }
        } else if (skill.effect) { this.addBuff(t, skill.effect.stat, skill.effect.amount * (res === 'perfect' ? 1.25 : 1), skill.effect.turns); this.vfx.aura(t.home, color); sfx('heal'); }
        if (skill.status) this.tryStatus(t, skill.status.id, skill.status.chance * (res === 'perfect' ? 1.2 : res === 'miss' ? 0.6 : 1));
        if (skill.breakPower && t.side === 'enemy') this.addBreak(t, skill.breakPower, u);
      }
      await this.sleep(700);
      return;
    }

    const melee = skill.vfx === 'slash' || skill.vfx === 'quake';
    const single = targets.length === 1;
    if (melee && single) {
      this.shotTarget(u, primary);
      const dir = primary.home.clone().sub(u.home).setY(0).normalize();
      const dest = primary.home.clone().addScaledVector(dir, -(primary.radius + u.radius + 0.6));
      const go = this.dash(u, primary);
      await wait(90);
      this.shotAction(dest, u.height, primary, 5);
      await go;
    } else {
      this.shotTarget(u, primary);
      u.rig.play('cast');
      this.vfx.aura(u.home, color);
      await this.sleep(350);
    }
    let perfects = 0;
    for (let h = 0; h < skill.hits; h++) {
      const lead = h === 0 ? 700 : skill.ultimate ? 380 : 480;
      setTimeout(() => u.rig.play('attack'), Math.max(0, lead / this.speed - 260));
      if (!melee) {
        const from = u.chest();
        // follow the shot to where it lands
        if (h === 0) setTimeout(() => (single ? this.shotAction(u.home, u.height, primary, 3.4) : this.shotGroup('enemy', 3.2)), Math.max(0, (lead * 0.35) / this.speed));
        for (const t of targets) void this.vfx.projectile(from, t.chest(), color, Math.min(0.42, lead / 1000 - 0.05), skill.vfx === 'beam' ? 0.2 : 1.4);
        if (skill.vfx === 'beam') setTimeout(() => targets.forEach((t) => this.vfx.beam(u.chest(), t.chest(), color, 0.35)), lead / this.speed - 120);
      }
      const res = await this.qteHit(() => this.project(primary, 0.55), lead);
      if (res === 'perfect') {
        perfects++;
        this.addBurst(skill.ultimate ? 0 : 8, u);
        if (u.ability === 'momentum' && !u.momentumUsed) { u.momentumUsed = true; u.ap = Math.min(9, u.ap + 1); this.floatAt(u, '+1 AP', 'buff'); }
      }
      const perfectMult = (u.ability === 'focus' ? 1.45 : 1.3) + (u.relic('perfect') ? 0.2 : 0);
      const mult = res === 'perfect' ? perfectMult : res === 'good' ? 1 : 0.7;
      const heavy = res === 'perfect' || h === skill.hits - 1 || !!skill.ultimate || skill.breakPower >= 20;
      for (const t of targets) {
        if (!t.alive) continue;
        this.impactFx(skill, t, color, h, el, heavy);
        const r = this.damage(u, t, skill, rank, mult);
        this.applyDamage(t, r.amount, r.eff, r.crit, false, u, skill);
        if (skill.kind === 'debuff' && skill.effect && h === skill.hits - 1) this.addBuff(t, skill.effect.stat, skill.effect.amount, skill.effect.turns);
        this.addBreak(t, skill.breakPower * (res === 'perfect' ? 1.5 : res === 'good' ? 1 : 0.5), u);
        this.onHitEffects(u, t, skill, melee);
      }
      this.shake(res === 'perfect' ? 0.35 : 0.18);
      if (res === 'perfect') haptic('medium');
      if (!targets.some((t) => t.alive)) break;
    }
    if (perfects === skill.hits && skill.hits > 1) this.ui.bannerText('Flawless!', 'good', 700);
    await this.sleep(350);
    if (melee && single) await this.dashBack(u);
    else await this.sleep(250);
  }

  private async useBurst(u: Unit) {
    const ult = SKILLS[`ult_${u.sp.element}`] ?? SKILLS.ult_fire;
    this.burst = 0;
    this.ui.setBurst(0);
    emit('burst', {});
    haptic('heavy');
    const c = u.chest();
    this.ui.hideHud(true);
    this.ui.bannerText(`<small>${u.name} unleashes</small>${ult.name}`, 'boss', 1500);
    const phase = Math.random() * Math.PI * 2;
    await tweens.tween(1.3, (k) => {
      const a = phase + k * Math.PI * 0.9;
      this.shot(c.clone().add(new THREE.Vector3(Math.cos(a) * 4.2, 1.4 + k * 1.2, Math.sin(a) * 4.2)), c, 20, true);
    }, ease.inOut, true);
    this.vfx.aura(u.home, ELEMENTS[ult.element].color);
    this.vfx.burst(c, ELEMENTS[ult.element].color);
    this.stage.flash(c, ELEMENTS[ult.element].color, 2.2);
    u.rig.look?.flash(ELEMENTS[ult.element].color, 0.8, 0.5);
    this.kick(8);
    this.ui.hideHud(false);
    await this.playerSkill(u, ult, 1, this.alive('enemy'));
  }

  private impactFx(skill: Skill, t: Unit, color: string, h: number, el: Element = skill.element, big = false) {
    const p = t.chest();
    const groundY = t.home.y - t.hover;
    switch (skill.vfx) {
      case 'slash': this.vfx.slash(p, color, h); sfx(h % 2 ? 'hit2' : 'slash'); break;
      case 'quake': this.vfx.quake(t.home.clone().sub(new THREE.Vector3(0, t.hover, 0)), color); sfx('quake'); break;
      case 'burst': this.vfx.burst(p, color); sfx('hit'); break;
      case 'beam': sfx('hit'); break;
      default: sfx('hit');
    }
    this.vfx.impact(p, el, color, big, groundY);
    t.rig.look?.flash('#ffffff', big ? 0.85 : 0.6, big ? 0.16 : 0.1);
    this.stage.flash(p, color, big ? 1.1 : 0.55);
    if (big) { this.freeze(70, 0.06); this.kick(2.5); }
  }

  private async dash(u: Unit, t: Unit) {
    const dir = t.home.clone().sub(u.home).setY(0).normalize();
    const dest = this.ground(t.home.clone().addScaledVector(dir, -(t.radius + u.radius + 0.6)));
    dest.y += u.hover;
    this.moving.set(u, 1);
    const start = u.rig.root.position.clone();
    u.rig.root.rotation.y = Math.atan2(dir.x, dir.z);
    await tweens.tween(0.32 / this.speed, (k) => { u.rig.root.position.lerpVectors(start, dest, k); }, ease.inOut);
    this.moving.set(u, 0);
  }

  private async dashBack(u: Unit) {
    const start = u.rig.root.position.clone();
    this.moving.set(u, 1);
    await tweens.tween(0.35 / this.speed, (k) => { u.rig.root.position.lerpVectors(start, u.home, k); }, ease.inOut);
    this.moving.set(u, 0);
    u.rig.root.rotation.y = u.face;
  }

  // ── Damage model ───────────────────────────────────────────────────
  private elementRelicBonus(u: Unit, el: Element) {
    let b = 0;
    for (const uid of u.c.relics) {
      const inst = state.relics.find((r) => r.uid === uid);
      if (inst && RELICS[inst.id]?.effect === 'element' && RELICS[inst.id].element === el) b += 0.15;
    }
    return b;
  }

  private damage(att: Unit, def: Unit, skill: Skill, rank: number, mult: number) {
    const el: Element = skill.id === 'strike' ? att.sp.element : skill.element;
    const stab = el === att.sp.element ? 1.15 : 1;
    const eff = effectiveness(el, def.sp.element);
    const critChance = 0.06 + (att.ability === 'lucky' ? 0.12 : 0) + (att.relic('crit') ? 0.12 : 0);
    const crit = Math.random() < critChance;
    let m = 1 + this.elementRelicBonus(att, el);
    if (att.ability === PINCH[el] && att.c.hp < att.maxHp * 0.35) m *= 1.35;
    if (att.ability === 'opportunist' && (def.broken || def.status)) m *= 1.25;
    if (def.ability === 'thick_hide') m *= 0.85;
    if (this.units.some((a) => a.side === def.side && a.alive && a.ability === 'guardian_aura')) m *= 0.9;
    const base = rankedPower(skill, rank) * (att.stat('atk') / Math.max(1, def.stat('def'))) * (1 + att.c.level * 0.13) * 0.9;
    const side = att.side === 'enemy' ? 0.82 : 1;
    const amount = Math.max(1, Math.round(base * eff * stab * (def.broken ? 1.4 : 1) * (crit ? 1.5 : 1) * (0.92 + Math.random() * 0.16) * mult * side * m));
    return { amount, eff, crit, el };
  }

  private applyDamage(t: Unit, amount: number, eff: number, crit: boolean, party: boolean, attacker?: Unit, skill?: Skill) {
    const el = skill ? (skill.id === 'strike' && attacker ? attacker.sp.element : skill.element) : undefined;
    if (t.ability === 'absorb' && el === t.sp.element) { this.healUnit(t, Math.round(amount * 0.5)); this.floatAt(t, 'Absorbed', 'buff'); return; }
    if (t.shield > 0) {
      const take = Math.min(t.shield, amount);
      t.shield -= take;
      amount -= take;
      this.floatAt(t, `Shield −${take}`, 'info');
      if (amount <= 0) { this.ui.refresh(this.units); return; }
    }
    const lethal = amount >= t.c.hp;
    if (lethal && t.ability === 'sturdy' && !t.sturdyUsed && t.c.hp >= t.maxHp) { t.sturdyUsed = true; amount = t.c.hp - 1; this.floatAt(t, 'Sturdy!', 'buff'); }
    t.c.hp = Math.max(0, t.c.hp - amount);
    t.rig.play('hit');
    if (crit) {
      const cc = el ? ELEMENTS[el].color : '#ffffff';
      this.vfx.crit(t.chest(), cc);
      this.kick(6);
      this.freeze(110, 0.03);
      this.shake(0.35);
      this.stage.flash(t.chest(), '#ffffff', 1.6);
      haptic('heavy');
    }
    const cls = `dmg ${party ? 'taken' : ''} ${crit ? 'crit' : ''} ${eff > 1.2 ? 'weak' : eff < 0.9 ? 'resist' : ''}`;
    this.floatAt(t, `${amount}${crit ? '!' : ''}`, cls);
    if (eff > 1.2 && !party) this.floatAt(t, 'WEAK', 'tag-weak');
    if (party) this.addBurst(3, t);
    if (t.ability === 'rage' && t.c.hp > 0 && t.rage < 5) { t.rage++; this.floatAt(t, 'Rage ▲', 'buff'); }
    if (t.status?.id === 'sleep' && Math.random() < 0.5) { t.status = null; this.floatAt(t, 'Woke up!', 'info'); }
    if (t.status?.id === 'freeze' && el === 'fire') { t.status = null; this.floatAt(t, 'Thawed!', 'info'); }
    if (attacker && attacker.alive) {
      if (attacker.relic('lifesteal')) this.healUnit(attacker, Math.max(1, Math.round(amount * 0.12)), true);
      if (t.relic('thorns')) { const back = Math.max(1, Math.round(amount * 0.12)); attacker.c.hp = Math.max(0, attacker.c.hp - back); this.floatAt(attacker, `${back}`, 'dmg'); }
    }
    if (t.c.hp <= 0 && t.relic('second_wind') && !t.secondWindUsed) {
      t.secondWindUsed = true;
      t.c.hp = Math.round(t.maxHp * 0.3);
      this.floatAt(t, 'Second Wind!', 'heal');
      this.vfx.heal(t.home.clone(), '#ffd76a');
    }
    this.ui.refresh(this.units);
    if (t.boss && !t.enraged && t.c.hp > 0 && t.c.hp < t.maxHp * 0.5) {
      t.enraged = true;
      setTimeout(() => { this.ui.bannerText(`${t.name} is enraged!`, 'bad', 1300); this.shake(0.5); this.kick(6); this.vfx.aura(t.home, '#ff3a3a'); t.rig.look?.flash('#ff3a2a', 0.7, 0.6); this.stage.flash(t.chest(), '#ff3a2a', 1.6); }, 300);
    }
  }

  private onHitEffects(att: Unit, def: Unit, skill: Skill, contact: boolean) {
    if (!def.alive) return;
    if (skill.status) this.tryStatus(def, skill.status.id, skill.status.chance);
    const inflict: [boolean, StatusId, number][] = [
      [att.ability === 'poison_touch', 'poison', 0.2], [att.ability === 'frostbite', 'freeze', 0.12], [att.ability === 'sleep_spores', 'sleep', 0.12],
      [att.relic('inflict_burn'), 'burn', 0.12], [att.relic('inflict_poison'), 'poison', 0.12], [att.relic('inflict_freeze'), 'freeze', 0.08], [att.relic('inflict_sleep'), 'sleep', 0.08],
    ];
    for (const [on, id, ch] of inflict) if (on) this.tryStatus(def, id, ch);
    if (contact) {
      if (def.ability === 'static') this.tryStatus(att, 'paralyze', 0.25);
      if (def.ability === 'flame_body') this.tryStatus(att, 'burn', 0.25);
    }
  }

  private tryStatus(t: Unit, id: StatusId, chance: number) {
    if (!t.alive || t.status || t.statusImmune || Math.random() > chance) return;
    const turns = id === 'sleep' ? 1 + Math.floor(Math.random() * 3) : id === 'freeze' ? 3 : id === 'confuse' ? 2 + Math.floor(Math.random() * 3) : id === 'paralyze' ? 4 : 5;
    t.status = { id, turns, stack: 0 };
    const info = STATUS[id];
    this.floatAt(t, info.name, 'status');
    this.vfx.sprite('magic_03', t.chest(), { color: info.color, size: 1, size1: 3, life: 0.6 });
    this.ui.refresh(this.units);
  }

  private addBreak(t: Unit, amount: number, by?: Unit) {
    if (t.broken || !t.alive) return;
    if (by?.ability === 'breaker') amount *= 1.5;
    if (by?.relic('break')) amount *= 1.35;
    t.brk += amount;
    if (t.brk >= t.brkMax) {
      t.brk = t.brkMax;
      t.broken = true;
      sfx('break');
      haptic('heavy');
      this.vfx.breakShatter(t.chest(), '#ffd76a');
      this.ui.bannerText('BREAK!', 'break', 900);
      this.shake(0.5);
      this.kick(8);
      this.freeze(140, 0.03);
      t.rig.look?.flash('#ffe8a0', 1, 0.3);
      this.stage.flash(t.chest(), '#ffd76a', 2);
      t.av += t.avStep;
      this.addBurst(20, by);
      emit('break', {});
    }
  }

  private healUnit(t: Unit, amount: number, quiet = false) {
    const before = t.c.hp;
    t.c.hp = Math.min(t.maxHp, t.c.hp + amount);
    if (!quiet) { this.vfx.heal(t.home.clone()); sfx('heal'); }
    if (t.c.hp > before) this.floatAt(t, `+${t.c.hp - before}`, 'heal');
    this.ui.refresh(this.units);
  }

  private addBuff(t: Unit, stat: 'atk' | 'def' | 'spd', amount: number, turns: number) {
    t.buffs = t.buffs.filter((b) => b.stat !== stat || Math.sign(b.amount) !== Math.sign(amount));
    t.buffs.push({ stat, amount, turns: turns + 1 });
    this.floatAt(t, `${stat.toUpperCase()} ${amount > 0 ? '▲' : '▼'}`, amount > 0 ? 'buff' : 'debuff');
    this.ui.refresh(this.units);
  }

  // ── Enemy turn ─────────────────────────────────────────────────────
  private ai(u: Unit): { skill: Skill; rank: number; targets: Unit[] } {
    const list = skillList(u.c);
    const party = this.alive('party');
    let choice = list[0];
    if (u.boss) {
      const patterned = list.filter((s) => s.skill.id !== 'strike');
      choice = patterned[u.bossPatternIdx++ % patterned.length];
      if (u.enraged && Math.random() < 0.4) choice = patterned.reduce((a, b) => (strikePattern(b.skill).length > strikePattern(a.skill).length ? b : a));
    } else {
      const heal = list.find((s) => s.skill.kind === 'heal');
      const statusMove = list.find((s) => s.skill.status && s.skill.power === 0);
      const buff = list.find((s) => s.skill.kind === 'buff');
      const attacks = list.filter((s) => s.skill.kind === 'attack');
      if (heal && u.c.hp < u.maxHp * 0.35 && Math.random() < 0.6) choice = heal;
      else if (statusMove && party.some((p) => !p.status) && Math.random() < 0.3) choice = statusMove;
      else if (buff && Math.random() < 0.15) choice = buff;
      else choice = attacks[Math.floor(Math.random() * attacks.length)] ?? list[0];
    }
    const s = choice.skill;
    let targets: Unit[];
    if (s.target === 'allEnemies') targets = party;
    else if (s.target === 'self' || s.target === 'ally') targets = [u];
    else if (s.target === 'allAllies') targets = this.alive('enemy');
    else {
      const cands = s.status && s.power === 0 ? party.filter((p) => !p.status) : party;
      const pool = cands.length ? cands : party;
      const weights = pool.map((p) => 1 + (1 - p.c.hp / p.maxHp) + (effectiveness(s.element, p.sp.element) > 1.2 ? 0.8 : 0));
      let r = Math.random() * weights.reduce((a, b) => a + b, 0);
      targets = [pool[pool.length - 1]];
      for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) { targets = [pool[i]]; break; } }
    }
    return { skill: s, rank: 1, targets };
  }

  private async enemyTurn(u: Unit) {
    if (u.status?.id === 'confuse' && Math.random() < 0.33) {
      this.floatAt(u, 'Confused!', 'info');
      u.rig.play('hit');
      const dmg = Math.max(1, Math.round(u.maxHp * 0.08));
      u.c.hp = Math.max(0, u.c.hp - dmg);
      this.floatAt(u, `${dmg}`, 'dmg');
      await this.sleep(600);
      return;
    }
    const { skill, rank, targets } = this.ai(u);
    const color = ELEMENTS[skill.id === 'strike' ? u.sp.element : skill.element].color;
    this.ui.skill(skill.name, color, u.name);
    if (skill.kind !== 'attack') {
      this.shotSide();
      u.rig.play('cast');
      this.vfx.aura(u.home, color);
      await this.sleep(600);
      if (skill.kind === 'heal') for (const t of targets) this.healUnit(t, Math.round(rankedPower(skill, rank) * (1 + u.c.level * 0.12)));
      else if (skill.effect) {
        const tgts = skill.kind === 'debuff' ? (skill.target === 'allEnemies' ? this.alive('party') : targets) : targets;
        for (const x of tgts) this.addBuff(x, skill.effect.stat, skill.effect.amount, skill.effect.turns);
      }
      if (skill.status && skill.kind === 'debuff') for (const x of targets) this.tryStatus(x, skill.status.id, skill.status.chance);
      await this.sleep(700);
      return;
    }
    await this.enemyAttack(u, skill, rank, targets, color);
  }

  private async enemyAttack(u: Unit, skill: Skill, rank: number, targets: Unit[], color: string) {
    const aoe = targets.length > 1;
    const primary = targets[0];
    const melee = (skill.vfx === 'slash' || skill.vfx === 'quake') && !aoe;
    const speed = (u.enraged ? 0.82 : 1) / Math.max(1, this.speed * 0.8);
    const pattern = strikePattern(skill);
    if (aoe || u.boss) this.shotSide(); else this.shotDefend(primary, u);
    u.rig.play('cast');
    this.vfx.groundDecal('symbol_02', u.home, { color, size: u.radius * 3, size1: u.radius * 4, life: 1.0, rot: 2 });
    this.vfx.sprite('flare_01', u.chest(), { color, size: 1, size1: u.height * 1.2, life: 0.6, opacity: 0.8 });
    if (melee) { await this.sleep(250); await this.dash(u, primary); }
    else await this.sleep(420);

    const classic = !settings.parryMode; // v3: classic turn-based — no defence prompts, softer hits
    const defendAuto = this.autoBattle || settings.autoParry;
    if (!classic) this.ui.showDefense(true, pattern.some((s) => s.jump));
    this.presses = this.presses.filter((p) => p.kind === 'qte');
    this.whiffs = [];
    const lead = 850;
    const t0 = performance.now() + lead;
    const impacts = pattern.map((s) => ({ at: t0 + s.t * speed, red: !!s.unblockable, jump: !!s.jump }));
    let hits = 0, parries = 0, blockable = 0;
    for (let i = 0; i < impacts.length; i++) {
      const imp = impacts[i];
      if (!imp.red && !imp.jump) blockable++;
      const ring = classic ? NO_RING : this.ui.ring(imp.jump ? 'gold' : imp.red ? 'red' : 'defend');
      const ringStart = imp.at - 800;
      let animFired = false, shotFired = false, autoDef = false;
      for (;;) {
        await nextFrame();
        const now = performance.now();
        if (!classic && (auto() || defendAuto) && !autoDef && now >= imp.at - 60 && !(window as unknown as { __noDefend?: boolean }).__noDefend) {
          autoDef = true;
          const success = auto() || Math.random() < (settings.autoParry ? 0.8 : 0.65);
          if (success) this.press(imp.jump ? 'jump' : imp.red ? 'dodge' : settings.autoParry || Math.random() < 0.6 ? 'parry' : 'dodge', now);
        }
        const anchor = aoe ? this.projectPoint(this.center('party').add(new THREE.Vector3(0, 1.2, 0))) : this.project(primary, 0.6);
        ring.set(anchor.x, anchor.y, (now - ringStart) / 800);
        if (!animFired && now >= imp.at - 280) { animFired = true; u.rig.play('attack'); }
        if (!shotFired && !melee && now >= imp.at - 360) {
          shotFired = true;
          const dest = aoe ? this.center('party').add(new THREE.Vector3(0, 1, 0)) : primary.chest();
          if (imp.jump) this.vfx.groundDecal('circle_02', this.center('party'), { color: '#ffd76a', size: 1, size1: 14, life: 0.45 });
          else if (skill.vfx === 'beam') setTimeout(() => this.vfx.beam(u.chest(), dest, color, 0.45), 240);
          else void this.vfx.projectile(u.chest(), dest, color, 0.34, 1.2);
        }
        if (now >= imp.at + this.window(DODGE_LATE, primary)) break;
      }
      const res = classic ? 'hit' : this.judgeDefense(imp.at, imp.red, imp.jump, primary);
      const anchorUnits = aoe ? this.alive('party') : [primary];
      if (res === 'parry') {
        parries++;
        ring.judge('PARRY', 'perfect');
        sfx('parry');
        haptic('medium');
        emit('parry', {});
        for (const t of anchorUnits) { this.vfx.parry(t.chest()); t.ap = Math.min(9, t.ap + 1 + (t.relic('parry_ap') ? 1 : 0)); t.rig.play('attack'); t.rig.look?.flash('#fff2b0', 0.7, 0.18); }
        this.addBurst(12);
        this.shake(0.25);
        this.kick(3.5);
        this.stage.flash(primary.chest(), '#ffd76a', 1.2);
        tweens.timeScale = 0.35;
        setTimeout(() => (tweens.timeScale = 1), 140);
      } else if (res === 'dodge' || res === 'jump') {
        ring.judge(res === 'jump' ? 'JUMP' : 'DODGE', 'good');
        sfx('dodge');
        emit(res === 'jump' ? 'jump_dodge' : 'dodge', {});
        this.addBurst(6);
        for (const t of anchorUnits) {
          this.vfx.dodge(t.chest());
          if (t.relic('dodge_heal')) this.healUnit(t, Math.round(t.maxHp * 0.05), true);
          void (res === 'jump' ? this.jumpHop(t) : this.hop(t));
        }
      } else {
        hits++;
        ring.judge('HIT', 'miss');
        for (const t of targets) {
          if (!t.alive) continue;
          this.impactFx(skill, t, color, i, skill.id === 'strike' ? u.sp.element : skill.element, i === impacts.length - 1);
          const r = this.damage(u, t, skill, rank, classic ? 0.82 : 1);
          this.applyDamage(t, r.amount, r.eff, r.crit, true, u, skill);
          this.onHitEffects(u, t, skill, melee);
        }
        this.shake(0.3);
        haptic('light');
      }
      this.ui.refresh(this.units);
    }
    this.ui.showDefense(false);
    await this.sleep(250);
    if (hits === 0 && parries > 0 && parries === blockable && u.alive && !settings.autoParry) {
      const counterer = aoe ? this.alive('party')[0] : primary;
      if (counterer?.alive) await this.counter(counterer, u);
    }
    if (melee) await this.dashBack(u);
    await this.sleep(200);
  }

  private judgeDefense(at: number, red: boolean, jump: boolean, target: Unit): 'parry' | 'dodge' | 'jump' | 'hit' {
    const dE = this.window(DODGE_EARLY, target), dL = this.window(DODGE_LATE, target);
    const pE = this.window(PARRY_EARLY, target), pL = this.window(PARRY_LATE, target);
    for (const pp of this.presses) {
      if (pp.kind !== 'qte' && !pp.used && pp.t < at - dE) { pp.used = true; this.whiffs.push(pp.t); }
    }
    const locked = (t: number) => this.whiffs.some((w) => t > w && t - w < WHIFF_LOCK);
    const p = this.presses.find((pp) => pp.kind !== 'qte' && !pp.used && pp.t >= at - dE && pp.t <= at + dL && !locked(pp.t));
    if (!p) return 'hit';
    p.used = true;
    if (jump) return p.kind === 'jump' ? 'jump' : 'hit';
    if (p.kind === 'jump') return 'hit';
    if (p.kind === 'parry') return !red && p.t >= at - pE && p.t <= at + pL ? 'parry' : 'hit';
    return 'dodge';
  }

  private async hop(t: Unit) {
    const side = this.R.clone().multiplyScalar(Math.random() < 0.5 ? 1.4 : -1.4);
    const start = t.rig.root.position.clone();
    await tweens.tween(0.14, (k) => { t.rig.root.position.copy(start).addScaledVector(side, k); t.rig.root.position.y = start.y + Math.sin(k * Math.PI) * 0.5; }, ease.out);
    await tweens.tween(0.22, (k) => { t.rig.root.position.copy(start).addScaledVector(side, 1 - k); }, ease.inOut);
    t.rig.root.position.copy(t.home);
  }
  private async jumpHop(t: Unit) {
    const start = t.rig.root.position.clone();
    await tweens.tween(0.42, (k) => { t.rig.root.position.copy(start); t.rig.root.position.y = start.y + Math.sin(k * Math.PI) * 2.2; }, ease.linear);
    t.rig.root.position.copy(t.home);
  }

  private async counter(u: Unit, target: Unit) {
    this.ui.bannerText('COUNTER!', 'good', 800);
    this.shotTarget(u, target);
    await this.dash(u, target);
    tweens.timeScale = 0.45;
    u.rig.play('attack');
    await wait(160);
    const color = ELEMENTS[u.sp.element].color;
    this.vfx.slash(target.chest(), color, 2);
    this.vfx.impact(target.chest(), u.sp.element, color, true, target.home.y - target.hover);
    target.rig.look?.flash('#ffffff', 0.9, 0.2);
    this.kick(7);
    this.freeze(120, 0.03);
    sfx('hit2');
    haptic('heavy');
    const r = this.damage(u, target, SKILLS.strike, 1, 2.2 * (u.relic('counter') ? 1.6 : 1));
    this.applyDamage(target, r.amount, r.eff, r.crit, false, u, SKILLS.strike);
    this.addBreak(target, 34, u);
    this.addBurst(10, u);
    this.shake(0.5);
    await wait(220);
    tweens.timeScale = 1;
    await this.dashBack(u);
  }

  // ── Capture ────────────────────────────────────────────────────────
  captureChance(t: Unit, orb: OrbId, perfects: number) {
    if (orb === 'astral') return 1;
    const hpR = t.c.hp / t.maxHp;
    const lead = Math.max(...this.party.map((p) => p.c.level));
    const lvPen = 1 - Math.max(0, t.c.level - lead) * 0.06;
    let orbM = ORBS[orb].mult;
    const el = t.sp.element;
    if (orb === 'dusk' && (this.world.isNight || this.setup.zone.id === 'marsh')) orbM = 2.5;
    if (orb === 'tide' && (el === 'water' || el === 'storm')) orbM = 2.2;
    if (orb === 'ember' && (el === 'fire' || el === 'earth')) orbM = 2.2;
    const statusM = t.status ? (t.status.id === 'sleep' || t.status.id === 'freeze' ? 2 : 1.5) : 1;
    const leadRelic = this.party[0]?.relic('capture') ? 1.2 : 1;
    const base = t.sp.catchRate * (1.35 - hpR) * (t.broken ? 1.7 : 1) * orbM * statusM * leadRelic * lvPen * (1 + perfects * 0.12);
    return clamp(base, 0.03, 0.97);
  }

  private async capture(t: Unit, orbId: OrbId) {
    const ex = this.world.player;
    const orbDef = ORBS[orbId];
    // over the Wayfarer's shoulder
    const toT = t.home.clone().sub(ex.root.position).setY(0).normalize();
    const exR = new THREE.Vector3().crossVectors(toT, UP).normalize();
    this.shot(ex.root.position.clone().addScaledVector(toT, -3.2).addScaledVector(exR, 1.3).addScaledVector(UP, 2.3), t.home.clone().addScaledVector(UP, t.height * 0.45), 3.2);
    this.fovGoal = this.baseFov - 4;
    ex.play('attack');
    this.ui.skill(orbDef.name, orbDef.color, 'Wayfarer');
    await wait(420);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 16), new THREE.MeshPhysicalMaterial({ color: orbDef.color, emissive: orbDef.color, emissiveIntensity: 0.9, roughness: 0.15, clearcoat: 1, metalness: 0.3 }));
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.285, 0.035, 8, 32), new THREE.MeshStandardMaterial({ color: orbDef.band, emissive: orbDef.band, emissiveIntensity: 1.6 }));
    band.rotation.x = Math.PI / 2;
    orb.add(band);
    this.orbMesh = orb;
    this.world.scene.add(orb);
    const from = ex.root.position.clone().add(new THREE.Vector3(0, 1.6, 0));
    const to = t.chest();
    sfx('capture');
    await tweens.tween(0.55, (k) => {
      orb.position.lerpVectors(from, to, k);
      orb.position.y += Math.sin(k * Math.PI) * 3;
      this.goalLook.lerp(orb.position, 0.25); // the camera follows the throw
    }, ease.inOut);
    this.vfx.sprite('flare_01', to, { color: '#ffffff', size: 2, size1: 6, life: 0.35 });
    this.vfx.burst(to, orbDef.color);
    this.stage.flash(to, orbDef.color, 1.2);
    // the Mystic turns to light and streams into the orb
    this.vfx.motes(t.home.clone().sub(new THREE.Vector3(0, t.hover, 0)), '#fff6e0', t.height, 34, to);
    await tweens.tween(0.5, (k) => t.rig.look?.setDissolve(k, orbDef.band), ease.in);
    t.rig.root.visible = false;
    const groundP = this.ground(t.home.clone()).add(new THREE.Vector3(0, 0.28, 0));
    await tweens.tween(0.35, (k) => { orb.position.lerpVectors(to, groundP, k); }, ease.in);
    // close on the orb as it rocks in the grass
    const side = this.R.clone().multiplyScalar(this.sideSign);
    this.shot(groundP.clone().addScaledVector(this.F, -2.6).addScaledVector(side, 1.1).addScaledVector(UP, 0.75), groundP.clone().addScaledVector(UP, 0.12), 3);
    this.fovGoal = this.baseFov - 12;
    sfx('orb');
    let perfects = 0;
    if (orbId !== 'astral') {
      this.ui.bannerText('Steady the orb!', 'info', 800);
      for (let i = 0; i < 3; i++) {
        const res = await this.qteHit(() => this.projectPoint(orb.position), 650);
        if (res === 'perfect') perfects++;
        await tweens.tween(0.25, (k) => { orb.rotation.z = Math.sin(k * Math.PI * 2) * 0.5; }, ease.linear);
      }
    }
    const chance = this.captureChance(t, orbId, perfects);
    const ok = Math.random() < chance;
    const shakes = ok ? 3 : Math.floor(Math.random() * 3);
    for (let i = 0; i < shakes; i++) {
      await wait(250);
      sfx('orb');
      haptic('light');
      await tweens.tween(0.35, (k) => { orb.rotation.z = Math.sin(k * Math.PI * 2) * 0.6; orb.position.y = groundP.y + Math.abs(Math.sin(k * Math.PI)) * 0.15; }, ease.linear);
    }
    await wait(300);
    if (ok) {
      sfx('captured');
      haptic('success');
      this.vfx.sparks(orb.position, '#ffe8a8', 40, 8);
      this.vfx.sprite('star_07', orb.position, { color: '#fff6c8', size: 1, size1: 4, life: 0.6, rot: 2 });
      this.vfx.shockwave(groundP.clone(), orbDef.band, 5, 0.6);
      if (t.c.shiny) this.vfx.shinyBurst(groundP.clone(), 1.2);
      this.stage.flash(orb.position, '#fff2c0', 1.4);
      this.kick(5);
      this.fovGoal = this.baseFov - 6;
      this.ui.bannerText(`Captured ${t.name}!`, t.c.shiny ? 'shiny' : 'good', 1400);
      t.captured = true;
      t.c.hp = Math.max(1, t.c.hp);
      t.c.caught = { zone: this.setup.zone.id, orb: orbId, at: Date.now(), how: (this.setup.how ?? 'wild') as 'wild' };
      this.captured.push(t.c);
      ex.play('victory');
      emit('catch', { species: t.c.species, shiny: t.c.shiny, zone: this.setup.zone.id, how: this.setup.how ?? 'wild', element: t.sp.element, night: this.world.isNight });
      if (t.c.alpha) emit('alpha_catch', { species: t.c.species, zone: this.setup.zone.id, level: t.c.level, shiny: t.c.shiny });
      await wait(1400);
    } else {
      sfx('break');
      this.vfx.burst(orb.position, '#ff8a6a');
      this.stage.flash(orb.position, '#ff8a6a', 1.2);
      this.shake(0.3);
      this.ui.bannerText('It broke free!', 'bad', 900);
      t.rig.root.visible = true;
      this.shot(t.home.clone().addScaledVector(this.F, -(t.height * 1.4 + 4)).addScaledVector(this.R, this.sideSign * 2.5).addScaledVector(UP, 1.2 + t.height * 0.4), t.chest(), 3);
      this.fovGoal = this.baseFov;
      t.rig.play('victory');
      await tweens.tween(0.45, (k) => t.rig.look?.setDissolve(1 - k, '#ff8a6a'), ease.out);
      t.rig.look?.setDissolve(0);
      await wait(600);
    }
    this.fovGoal = this.baseFov;
    this.world.scene.remove(orb);
    this.orbMesh = null;
    this.ui.refresh(this.units);
  }

  // ── Faint / swap ───────────────────────────────────────────────────
  private async resolveFaints() {
    for (const u of [...this.units]) {
      if (u.c.hp > 0 || u.gone) continue;
      u.gone = true;
      sfx('faint');
      this.floatAt(u, `${u.name} fainted`, 'info');
      const col = ELEMENTS[u.sp.element].color;
      if (u.side === 'enemy') {
        emit('defeat', { species: u.c.species, zone: this.setup.zone.id, element: u.sp.element });
        if (u.c.alpha) emit('alpha_defeat', { species: u.c.species, zone: this.setup.zone.id, level: u.c.level });
        const last = !this.units.some((x) => x.side === 'enemy' && x.alive) && !this.foeQueue.length;
        if (last) {
          // final blow: slow motion, the camera settles on the fallen
          const side = this.R.clone().multiplyScalar(this.sideSign);
          this.shot(u.home.clone().addScaledVector(this.F, -(u.height * 1.5 + 3.5)).addScaledVector(side, 2.2 + u.height * 0.5).addScaledVector(UP, 0.9 + u.height * 0.45), u.chest(), 2.6);
          this.fovGoal = this.baseFov - 6;
          this.kick(4);
          tweens.timeScale = 0.35;
          u.rig.play('faint');
          await tweens.wait(850, true);
          tweens.timeScale = 1;
        } else {
          u.rig.play('faint');
          await this.sleep(700);
        }
        // dissolve into drifting motes of its element
        this.vfx.motes(u.home.clone().sub(new THREE.Vector3(0, u.hover, 0)), col, u.height, u.boss ? 60 : 28);
        await tweens.tween(u.boss ? 1.6 : 0.9, (k) => u.rig.look?.setDissolve(k, col), ease.in);
        u.rig.root.visible = false;
        if (last) this.fovGoal = this.baseFov;
      } else {
        u.rig.play('faint');
        await this.sleep(900);
        await tweens.tween(0.6, (k) => u.rig.look?.setDissolve(k * 0.98, '#9aa8c8'), ease.in);
        const next = this.reserves.find((c) => c.hp > 0);
        if (next) await this.swapIn(u, next, true);
      }
      this.ui.refresh(this.units);
    }
  }

  private async swapIn(out: Unit, next: Creature, forced = false) {
    this.reserves = this.reserves.filter((c) => c !== next);
    if (!forced || out.c.hp > 0) this.reserves.push(out.c);
    const s0 = out.rig.root.scale.x;
    await tweens.tween(0.25, (k) => out.rig.root.scale.setScalar(Math.max(0.001, s0 * (1 - k))), ease.in);
    this.world.scene.remove(out.rig.root);
    await ensureCreatures([next.species]);
    const u = new Unit('party', next, makeCreatureRig(next.species, next.shiny), out.slot);
    u.av = out.av;
    this.place(u, out.home.clone().sub(new THREE.Vector3(0, out.hover, 0)));
    u.rig.root.scale.setScalar(0.001);
    this.world.scene.add(u.rig.root);
    this.units[this.units.indexOf(out)] = u;
    this.participants.add(next);
    this.ui.replaceCard(out, u);
    this.ui.bannerText(`Go, ${u.name}!`, 'info', 800);
    sfx('orb');
    const col = ELEMENTS[u.sp.element].color;
    this.vfx.groundDecal('symbol_01', u.home, { color: col, size: 1, size1: 3.5, life: 0.9, rot: 3 });
    this.vfx.sprite('flare_01', u.chest(), { color: col, size: 1, size1: 4, life: 0.4 });
    this.stage.flash(u.chest(), col, 0.6);
    u.rig.look?.setDissolve(0.98, col);
    void tweens.tween(0.7, (k) => u.rig.look?.setDissolve(0.98 * (1 - k), col), ease.out).then(() => u.rig.look?.setDissolve(0));
    await tweens.tween(0.35, (k) => u.rig.root.scale.setScalar(Math.max(0.001, ease.back(k))), ease.linear);
    this.ui.refresh(this.units);
  }

  // ── End ────────────────────────────────────────────────────────────
  private async finish(o: BattleOutcome) {
    this.ui.hideSkill();
    this.ui.showDefense(false);
    if (o.result === 'win' || o.result === 'captured') {
      music('victory');
      const pc = this.center('party');
      this.shot(pc.clone().addScaledVector(this.F, 7.5).addScaledVector(this.R, 2.5).addScaledVector(UP, 2.4), pc.clone().addScaledVector(UP, 1.1), 2);
      for (const u of this.alive('party')) { u.rig.root.rotation.y = u.face + Math.PI; u.rig.play('victory'); }
      this.world.player.play('victory');
      await wait(900);
      const defeated = this.enemies.filter((u) => !u.captured);
      let xp = 0, gold = 0;
      const shards: Partial<Record<Element, number>> = {};
      const mult = this.setup.kind === 'tamer' ? 1.5 : 1;
      for (const e of defeated) {
        const boss = e.boss ? 4 : e.c.alpha ? 2.5 : 1;
        xp += Math.round((14 + e.c.level * 7) * boss * mult);
        gold += Math.round((6 + e.c.level * 3) * (e.boss ? 6 : e.c.alpha ? 3 : 1) * mult);
        shards[e.sp.element] = (shards[e.sp.element] ?? 0) + (e.boss ? 6 : e.c.alpha ? 4 : 1 + (Math.random() < 0.35 ? 1 : 0));
      }
      // Alpha spoils: a Mega Tonic, a Radiant Orb and a chance at its element's evolution stone
      for (const e of this.enemies.filter((x) => x.c.alpha)) {
        addItem('mega_tonic', 1);
        this.drops.push('mega_tonic');
        state.inv.orbs.radiant += 1;
        this.drops.push('Radiant Orb');
        if (Math.random() < 0.3) {
          const stone = (Object.keys(STONE_ELEMENT) as ItemId[]).find((k) => STONE_ELEMENT[k] === e.sp.element);
          if (stone) { addItem(stone, 1); this.drops.push(stone); }
        }
      }
      for (const e of this.enemies.filter((u) => u.captured)) xp += Math.round((14 + e.c.level * 7) * (e.c.alpha ? 1.5 : 0.5));
      state.inv.gold += gold;
      for (const [el, n] of Object.entries(shards)) state.inv.elementum[el as Element] += n ?? 0;
      for (const u of this.alive('party')) {
        if (u.ability === 'pickup' && Math.random() < 0.35) {
          const it: ItemId = pick<ItemId>(['tonic', 'ether', 'cleanse', 'tonic', 'mega_tonic']);
          addItem(it, 1);
          this.drops.push(it);
        }
      }
      const team = state.team.map((c) => ({ c, beforeLv: c.level, beforeXp: c.xp, newSkills: [] as string[] }));
      for (const t of team) {
        let share = this.participants.has(t.c) ? xp : Math.round(xp * 0.5);
        if (t.c.relics.some((uid) => state.relics.find((r) => r.uid === uid)?.id === 'scholar_lens')) share = Math.round(share * 1.25);
        const r = grantXp(t.c, share);
        t.newSkills = r.newSkills.map((id) => SKILLS[id]?.name ?? id);
        if (r.ready && t.beforeXp < xpToNext(t.beforeLv)) sfx('levelup');
      }
      for (const c of this.captured) addCreature(c);
      o.evolvable = []; // v3: evolution happens when a Mystic is trained to Lv 10/20/30/35 (Team → Train)
      emit('battle_win', { kind: this.setup.kind, zone: this.setup.zone.id });
      await this.ui.results({
        title: o.result === 'captured' ? 'Captured!' : this.setup.kind === 'boss' ? 'Guardian Defeated' : this.setup.kind === 'tamer' ? 'Tamer Defeated' : 'Victory',
        sub: this.setup.kind === 'boss' ? `${this.setup.zone.name} is at peace.` : this.captured.length ? `${this.captured.map(displayName).join(', ')} joined the journey` : this.setup.kind === 'tamer' ? `${this.setup.tamer?.name} tips their hat.` : 'The wilds grow quiet.',
        xp, gold, shards: Object.entries(shards) as [string, number][], team, captured: this.captured, drops: this.drops,
      });
    } else if (o.result === 'lose') {
      emit('battle_lose', { zone: this.setup.zone.id });
      music(null);
      sfx('defeat');
      this.ui.bannerText('Your journey falters…', 'bad', 2000);
      await wait(2200);
    }
    this.cleanup();
  }

  private cleanup() {
    removeEventListener('keydown', this.keyListener);
    this.stage?.dispose();
    LOOK.uRimBoost.value = 1;
    const cam = this.world.camera;
    cam.fov = this.baseFov;
    cam.updateProjectionMatrix();
    for (const u of this.units) this.world.scene.remove(u.rig.root);
    this.vfx.clear();
    this.world.scene.remove(this.vfx.group);
    this.world.scene.remove(this.selectRing);
    if (this.orbMesh) this.world.scene.remove(this.orbMesh);
    tweens.timeScale = 1;
    this.ui.destroy();
    for (const c of state.team) c.hp = Math.min(c.hp, statsOf(c).maxHp);
  }
}
