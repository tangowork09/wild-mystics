import * as THREE from 'three';
import { makeCreatureRig } from '../assets/manifest';
import { sfx, music } from '../core/audio';
import { tweens, ease, wait, nextFrame } from '../core/tween';
import { clamp } from '../core/noise';
import { ELEMENTS, effectiveness, type Element } from '../data/elements';
import { SKILLS, strikePattern, type Skill } from '../data/skills';
import { WATER_LEVEL, type Zone } from '../data/zones';
import {
  canEvolve, grantXp, rankedAp, rankedPower, skillList, statsOf, displayName, type Creature,
} from '../game/creature';
import { state, addCreature, markSeen, BATTLE_SLOTS } from '../game/state';
import type { Overworld } from '../world/world';
import { BattleUI, type Action } from './battleUI';
import { Unit } from './unit';
import { VFX } from './vfx';

export interface BattleSetup {
  kind: 'wild' | 'boss';
  enemies: Creature[];
  zone: Zone;
  center: THREE.Vector3;
  forward: THREE.Vector3;
  advantage: 'player' | 'enemy' | null;
}

export interface BattleOutcome {
  result: 'win' | 'lose' | 'fled' | 'captured';
  captured: Creature[];
  evolvable: Creature[];
}

const UP = new THREE.Vector3(0, 1, 0);
const PARRY_EARLY = 150, PARRY_LATE = 60, DODGE_EARLY = 270, DODGE_LATE = 80, WHIFF_LOCK = 450;
const auto = () => !!(window as unknown as { __autoplay?: boolean }).__autoplay;

type Press = { kind: 'parry' | 'dodge' | 'qte'; t: number; used?: boolean };

export class Battle {
  units: Unit[] = [];
  vfx = new VFX();
  ui: BattleUI;
  private C: THREE.Vector3;
  private F: THREE.Vector3;
  private R: THREE.Vector3;
  private reserves: Creature[] = [];
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

  constructor(private world: Overworld, private setup: BattleSetup) {
    this.C = setup.center.clone();
    this.F = setup.forward.clone().setY(0).normalize();
    this.R = new THREE.Vector3().crossVectors(this.F, UP).normalize();
    this.ui = new BattleUI((u, y) => this.project(u, y));
    this.ui.onDefense = (k, t) => this.press(k, t);
    this.ui.onQte = (t) => this.press('qte', t);
    this.keyListener = (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === 'e' || k === ' ') this.press('parry', performance.now());
      if (k === 'q' || k === 'shift') this.press('dodge', performance.now());
      if (k === ' ' || k === 'enter' || k === 'f') this.press('qte', performance.now());
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
    return this.ground(this.C.clone().addScaledVector(this.F, -3.6 - Math.abs(i - (n - 1) / 2) * 0.9).addScaledVector(this.R, lat));
  }

  private enemySlot(j: number, n: number, boss: boolean, isBoss: boolean) {
    if (boss) {
      if (isBoss) return this.ground(this.C.clone().addScaledVector(this.F, 7));
      const side = j % 2 === 0 ? -1 : 1;
      return this.ground(this.C.clone().addScaledVector(this.F, 4.2).addScaledVector(this.R, side * 5.8));
    }
    const lat = (j - (n - 1) / 2) * 3.4;
    return this.ground(this.C.clone().addScaledVector(this.F, 3.8 + Math.abs(j - (n - 1) / 2) * 0.8).addScaledVector(this.R, lat));
  }

  private place(u: Unit, pos: THREE.Vector3) {
    u.home.copy(pos);
    u.rig.root.position.copy(pos);
    const target = u.side === 'party' ? this.C.clone().addScaledVector(this.F, 5) : this.C.clone().addScaledVector(this.F, -5);
    u.face = Math.atan2(target.x - pos.x, target.z - pos.z);
    u.rig.root.rotation.y = u.face;
  }

  private build() {
    const alive = state.team.filter((c) => c.hp > 0);
    const field = alive.slice(0, BATTLE_SLOTS);
    this.reserves = alive.slice(BATTLE_SLOTS);
    field.forEach((c, i) => {
      const u = new Unit('party', c, makeCreatureRig(c.species, c.shiny), i);
      this.place(u, this.partySlot(i, field.length));
      u.rig.root.scale.setScalar(0.001);
      this.world.scene.add(u.rig.root);
      this.units.push(u);
      this.participants.add(c);
    });
    const isBossFight = this.setup.kind === 'boss';
    this.setup.enemies.forEach((c, j) => {
      const u = new Unit('enemy', c, makeCreatureRig(c.species, c.shiny), j, isBossFight && j === 0);
      this.place(u, this.enemySlot(j, this.setup.enemies.length, isBossFight, j === 0));
      this.world.scene.add(u.rig.root);
      this.units.push(u);
      markSeen(c.species);
    });
    for (const u of this.units) u.av = u.avStep * (0.3 + Math.random() * 0.25);
    if (this.setup.advantage === 'player') {
      for (const u of this.enemies) { u.av += u.avStep * 1.2; u.brk = u.brkMax * 0.35; }
      for (const u of this.party) u.av *= 0.2;
    } else if (this.setup.advantage === 'enemy') {
      for (const u of this.party) u.av += u.avStep;
      for (const u of this.enemies) u.av *= 0.2;
    }
    this.ui.mount(this.units);
    this.ui.refresh(this.units);
    // explorer stands behind the party
    const ex = this.world.player.root;
    ex.position.copy(this.ground(this.C.clone().addScaledVector(this.F, -9.5).addScaledVector(this.R, 2.2)));
    ex.rotation.y = Math.atan2(this.F.x, this.F.z);
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
    this.shot(this.C.clone().addScaledVector(this.F, -13 * boss).addScaledVector(this.R, 7 * boss).addScaledVector(UP, 6.5 * boss), this.C.clone().addScaledVector(this.F, 1.5).addScaledVector(UP, 1.6 * boss), speed);
  }
  /** Over-the-shoulder framing: `u` large on the left third, the focus point centre-right. */
  private shoulder(u: Unit, focus: THREE.Vector3, focusH: number) {
    const dir = focus.clone().sub(u.home).setY(0);
    if (dir.lengthSq() < 0.01) dir.copy(this.F);
    dir.normalize();
    const right = new THREE.Vector3().crossVectors(dir, UP).normalize();
    const h = u.height;
    const big = Math.max(1, focusH / 2.2);
    const back = 2.4 + h * 1.35 + (big - 1) * 1.6;
    const side = 1.15 + h * 0.75;
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
  private shotSide() {
    const boss = this.setup.kind === 'boss' ? 1.45 : 1;
    this.shot(this.C.clone().addScaledVector(this.R, -12.5 * boss).addScaledVector(this.F, -2.5).addScaledVector(UP, 4.2 * boss), this.C.clone().addScaledVector(this.F, 0.5).addScaledVector(UP, 1.4 * boss), 3);
  }
  shake(a: number) { this.shakeAmt = Math.max(this.shakeAmt, a); }

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
    const gdt = dt * tweens.timeScale;
    for (const u of this.units) u.rig.update(gdt, this.moving.get(u) ?? 0);
    this.world.player.update(gdt, 0);
    this.vfx.update(gdt);
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
    const p = this.project(u, 1.0);
    this.ui.float(p.x + (Math.random() - 0.5) * 30, p.y, text, cls);
  }

  // ── Main flow ──────────────────────────────────────────────────────
  async run(): Promise<BattleOutcome> {
    this.build();
    music(this.setup.kind === 'boss' ? 'boss' : 'battle');
    await this.intro();
    const outcome = await this.loop();
    await this.finish(outcome);
    return outcome;
  }

  private async intro() {
    this.ui.hideHud(true);
    const wc = this.world.camera;
    this.camPos.copy(wc.position);
    this.camLook.copy(wc.position.clone().add(wc.getWorldDirection(new THREE.Vector3()).multiplyScalar(10)));
    const ec = this.center('enemy');
    if (this.setup.kind === 'boss') {
      const b = this.enemies[0];
      this.shot(b.home.clone().addScaledVector(this.F, -9).addScaledVector(this.R, -4).addScaledVector(UP, 2.5), b.home.clone().addScaledVector(UP, b.height * 0.6), 1.6);
      b.rig.play('victory');
      await wait(500);
      this.ui.bannerText(`<small>${this.setup.zone.name} Guardian</small>${b.name}`, 'boss', 2200);
      this.shake(0.4);
      await wait(2000);
    } else {
      this.shot(ec.clone().addScaledVector(this.F, -7).addScaledVector(this.R, -3).addScaledVector(UP, 2.2), ec.clone().addScaledVector(UP, 0.9), 2.4);
      const names = this.enemies.map((u) => u.name).join(' & ');
      this.ui.bannerText(`${this.enemies.some((u) => u.c.shiny) ? '<small>✧ A shimmering ✧</small>' : ''}Wild ${names} appeared!`, 'wild', 1400);
      this.enemies.forEach((u) => u.rig.play('victory'));
      await wait(1300);
    }
    if (this.setup.advantage === 'player') this.ui.bannerText('First Strike!', 'good', 1000);
    if (this.setup.advantage === 'enemy') this.ui.bannerText('Ambushed!', 'bad', 1000);
    // summon party
    this.shotOverview(2.4);
    for (const u of this.party) {
      sfx('orb');
      this.vfx.sprite('flare_01', u.chest(), { color: ELEMENTS[u.sp.element].color, size: 1, size1: 4, life: 0.4 });
      this.vfx.groundDecal('symbol_01', u.home, { color: ELEMENTS[u.sp.element].color, size: 1, size1: 3.5, life: 0.9, rot: 3 });
      void tweens.tween(0.35, (t) => u.rig.root.scale.setScalar(Math.max(0.001, ease.back(t))), ease.linear);
      await wait(180);
    }
    await wait(500);
    this.ui.hideHud(false);
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
    if (!this.alive('enemy').length) return this.enemies.every((u) => u.captured) ? 'captured' : 'win';
    if (!this.alive('party').length && !this.reserves.some((c) => c.hp > 0)) return 'lose';
    return null;
  }

  private async loop(): Promise<BattleOutcome> {
    for (let guard = 0; guard < 400; guard++) {
      const end = this.checkEnd();
      if (end) return { result: end, captured: this.captured, evolvable: [] };
      const u = this.nextActor();
      this.ui.setTimeline(this.predictOrder(), u);
      this.ui.refresh(this.units, u);
      if (u.broken) {
        u.broken = false;
        u.brk = 0;
        this.floatAt(u, 'Recovered', 'info');
        this.ui.refresh(this.units);
        await wait(500);
        continue;
      }
      u.buffs = u.buffs.map((b) => ({ ...b, turns: b.turns - 1 })).filter((b) => b.turns > 0);
      if (u.side === 'party') {
        const r = await this.partyTurn(u);
        if (r) return { result: r, captured: this.captured, evolvable: [] };
      } else {
        await this.enemyTurn(u);
      }
      this.ui.hideSkill();
      await this.resolveFaints();
      this.ui.refresh(this.units);
    }
    return { result: 'fled', captured: this.captured, evolvable: [] };
  }

  // ── Party turn ─────────────────────────────────────────────────────
  private async partyTurn(u: Unit): Promise<BattleOutcome['result'] | null> {
    for (;;) {
      this.shotCommand(u);
      this.selectRing.visible = true;
      this.selectRing.position.copy(u.home).add(new THREE.Vector3(0, 0.1, 0));
      this.selectRing.scale.setScalar(u.radius * 1.6);
      const canSwap = this.reserves.some((c) => c.hp > 0);
      const act: Action = await this.ui.menu(u, { canCapture: this.setup.kind === 'wild', canFlee: this.setup.kind === 'wild', canSwap });
      this.selectRing.visible = false;

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
        const cost = rankedAp(skill, rank);
        u.ap -= cost;
        if (skill.id === 'strike') u.ap = Math.min(9, u.ap + 1);
        this.ui.refresh(this.units, u);
        await this.playerSkill(u, skill, rank, targets);
        return null;
      }

      if (act.type === 'capture') {
        const cands = this.alive('enemy');
        const t = await this.ui.pickTarget(cands, act.great ? 'Great Orb' : 'Crit Orb', (x) => `${Math.round(this.captureChance(x, act.great, 0) * 100)}% chance`);
        if (!t) continue;
        if (act.great) state.inv.greatOrbs--; else state.inv.orbs--;
        await this.capture(t, act.great);
        return null;
      }

      if (act.type === 'item') {
        const cands = act.item === 'potion' ? this.alive('party') : this.party.filter((x) => !x.captured);
        const t = await this.ui.pickTarget(cands, act.item === 'potion' ? 'Tonic' : 'Elixir', (x) => `${x.c.hp}/${x.maxHp} HP`);
        if (!t) continue;
        const pp = this.world.player;
        pp.play('interact');
        await wait(400);
        if (act.item === 'potion') { state.inv.potions--; this.healUnit(t, Math.round(t.maxHp * 0.5)); }
        else {
          state.inv.elixirs--;
          if (!t.alive) { t.gone = false; t.c.hp = Math.round(t.maxHp * 0.5); t.rig.play('idle'); t.rig.root.rotation.set(0, t.face, 0); }
          this.healUnit(t, t.maxHp);
        }
        await wait(700);
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

  /** Timed-hit QTE. Returns multiplier label per hit. */
  private async qteHit(anchor: () => { x: number; y: number }, leadMs: number): Promise<'perfect' | 'good' | 'miss'> {
    const ring = this.ui.ring('attack');
    const t0 = performance.now();
    const impact = t0 + leadMs;
    this.presses = this.presses.filter((p) => p.kind !== 'qte');
    let autoPressed = false;
    for (;;) {
      await nextFrame();
      const now = performance.now();
      const a = anchor();
      ring.set(a.x, a.y, (now - t0) / leadMs);
      if (auto() && !autoPressed && now >= impact - 12) { autoPressed = true; this.press('qte', now); }
      const early = this.presses.find((pp) => pp.kind === 'qte' && !pp.used && pp.t >= t0 && pp.t < impact - 260);
      if (early) { early.used = true; ring.judge('TOO EARLY', 'miss'); sfx('miss'); return 'miss'; }
      const p = this.presses.find((pp) => pp.kind === 'qte' && !pp.used && pp.t >= impact - 260);
      if (p) {
        p.used = true;
        const d = Math.abs(p.t - impact);
        const res = d <= 70 ? 'perfect' : d <= 170 ? 'good' : 'miss';
        ring.judge(res === 'perfect' ? 'PERFECT' : res === 'good' ? 'GOOD' : 'MISS', res);
        if (res === 'perfect') sfx('perfect');
        return res;
      }
      if (now > impact + 170) { ring.judge('MISS', 'miss'); return 'miss'; }
    }
  }

  private async playerSkill(u: Unit, skill: Skill, rank: number, targets: Unit[]) {
    const el = skill.id === 'strike' ? u.sp.element : skill.element;
    const color = ELEMENTS[el].color;
    this.ui.skill(skill.name, color, u.name);
    const primary = targets[0];

    if (skill.kind === 'heal' || skill.kind === 'buff') {
      this.shotTarget(u, primary);
      u.rig.play('cast');
      this.vfx.aura(u.home, color);
      const res = await this.qteHit(() => this.project(u, 0.7), 800);
      const mult = res === 'perfect' ? 1.3 : res === 'good' ? 1 : 0.75;
      for (const t of targets) {
        if (skill.kind === 'heal') this.healUnit(t, Math.round(rankedPower(skill, rank) * (1 + u.c.level * 0.12) * 1.2 * mult));
        else if (skill.effect) { this.addBuff(t, skill.effect.stat, skill.effect.amount * (res === 'perfect' ? 1.25 : 1), skill.effect.turns); this.vfx.aura(t.home, color); sfx('heal'); }
      }
      await wait(700);
      return;
    }

    const melee = skill.vfx === 'slash' || skill.vfx === 'quake';
    const single = targets.length === 1;
    if (melee && single) {
      this.shotTarget(u, primary);
      await this.dash(u, primary);
    } else {
      this.shotTarget(u, primary);
      u.rig.play('cast');
      this.vfx.aura(u.home, color);
      await wait(350);
    }
    let anyPerfect = 0;
    for (let h = 0; h < skill.hits; h++) {
      const lead = h === 0 ? 700 : 480;
      setTimeout(() => u.rig.play('attack'), Math.max(0, lead - 260));
      if (!melee) {
        const from = u.chest();
        for (const t of targets) void this.vfx.projectile(from, t.chest(), color, Math.min(0.42, lead / 1000 - 0.05), skill.vfx === 'beam' ? 0.2 : 1.4);
        if (skill.vfx === 'beam') setTimeout(() => targets.forEach((t) => this.vfx.beam(u.chest(), t.chest(), color, 0.35)), lead - 120);
      }
      const res = await this.qteHit(() => this.project(primary, 0.55), lead);
      if (res === 'perfect') anyPerfect++;
      const mult = res === 'perfect' ? 1.3 : res === 'good' ? 1 : 0.7;
      for (const t of targets) {
        if (!t.alive) continue;
        this.impactFx(skill, t, color, h);
        const r = this.damage(u, t, skill, rank, mult);
        this.applyDamage(t, r.amount, r.eff, r.crit, false);
        if (skill.kind === 'debuff' && skill.effect && h === skill.hits - 1) this.addBuff(t, skill.effect.stat, skill.effect.amount, skill.effect.turns);
        this.addBreak(t, skill.breakPower * (res === 'perfect' ? 1.5 : res === 'good' ? 1 : 0.5));
      }
      this.shake(res === 'perfect' ? 0.35 : 0.18);
      if (!targets.some((t) => t.alive)) break;
    }
    if (anyPerfect === skill.hits && skill.hits > 1) this.ui.bannerText('Flawless!', 'good', 700);
    await wait(350);
    if (melee && single) await this.dashBack(u);
    else await wait(250);
  }

  private impactFx(skill: Skill, t: Unit, color: string, h: number) {
    const p = t.chest();
    switch (skill.vfx) {
      case 'slash': this.vfx.slash(p, color, h); sfx(h % 2 ? 'hit2' : 'slash'); break;
      case 'quake': this.vfx.quake(t.home.clone(), color); sfx('quake'); break;
      case 'burst': this.vfx.burst(p, color); sfx('hit'); break;
      case 'beam': this.vfx.hit(p, color, true); sfx('hit'); break;
      default: this.vfx.hit(p, color); sfx('hit');
    }
  }

  private async dash(u: Unit, t: Unit) {
    const dir = t.home.clone().sub(u.home).setY(0).normalize();
    const dest = this.ground(t.home.clone().addScaledVector(dir, -(t.radius + u.radius + 0.6)));
    this.moving.set(u, 1);
    const start = u.rig.root.position.clone();
    u.rig.root.rotation.y = Math.atan2(dir.x, dir.z);
    await tweens.tween(0.32, (k) => { u.rig.root.position.lerpVectors(start, dest, k); }, ease.inOut);
    this.moving.set(u, 0);
  }

  private async dashBack(u: Unit) {
    const start = u.rig.root.position.clone();
    this.moving.set(u, 1);
    await tweens.tween(0.35, (k) => { u.rig.root.position.lerpVectors(start, u.home, k); }, ease.inOut);
    this.moving.set(u, 0);
    u.rig.root.rotation.y = u.face;
  }

  // ── Damage model ───────────────────────────────────────────────────
  private damage(att: Unit, def: Unit, skill: Skill, rank: number, mult: number) {
    const el: Element = skill.id === 'strike' ? att.sp.element : skill.element;
    const stab = el === att.sp.element ? 1.15 : 1;
    const eff = effectiveness(el, def.sp.element);
    const crit = Math.random() < 0.06;
    const base = rankedPower(skill, rank) * (att.stat('atk') / Math.max(1, def.stat('def'))) * (1 + att.c.level * 0.13) * 0.9;
    const side = att.side === 'enemy' ? 0.82 : 1;
    const amount = Math.max(1, Math.round(base * eff * stab * (def.broken ? 1.4 : 1) * (crit ? 1.5 : 1) * (0.92 + Math.random() * 0.16) * mult * side));
    return { amount, eff, crit };
  }

  private applyDamage(t: Unit, amount: number, eff: number, crit: boolean, party: boolean) {
    t.c.hp = Math.max(0, t.c.hp - amount);
    t.rig.play('hit');
    const cls = `dmg ${party ? 'taken' : ''} ${crit ? 'crit' : ''} ${eff > 1.2 ? 'weak' : eff < 0.9 ? 'resist' : ''}`;
    this.floatAt(t, `${amount}${crit ? '!' : ''}`, cls);
    if (eff > 1.2 && !party) this.floatAt(t, 'WEAK', 'tag-weak');
    this.ui.refresh(this.units);
    if (t.boss && !t.enraged && t.c.hp > 0 && t.c.hp < t.maxHp * 0.5) {
      t.enraged = true;
      setTimeout(() => { this.ui.bannerText(`${t.name} is enraged!`, 'bad', 1300); this.shake(0.5); this.vfx.aura(t.home, '#ff3a3a'); }, 300);
    }
  }

  private addBreak(t: Unit, amount: number) {
    if (t.broken || !t.alive) return;
    t.brk += amount;
    if (t.brk >= t.brkMax) {
      t.brk = t.brkMax;
      t.broken = true;
      sfx('break');
      this.vfx.breakShatter(t.chest(), '#ffd76a');
      this.ui.bannerText('BREAK!', 'break', 900);
      this.shake(0.5);
      t.av += t.avStep; // loses its next turn
    }
  }

  private healUnit(t: Unit, amount: number) {
    const before = t.c.hp;
    t.c.hp = Math.min(t.maxHp, t.c.hp + amount);
    this.vfx.heal(t.home.clone());
    sfx('heal');
    this.floatAt(t, `+${t.c.hp - before}`, 'heal');
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
    let pick = list[0];
    if (u.boss) {
      const patterned = list.filter((s) => s.skill.id !== 'strike');
      pick = patterned[u.bossPatternIdx++ % patterned.length];
      if (u.enraged && Math.random() < 0.4) pick = patterned.reduce((a, b) => (strikePattern(b.skill).length > strikePattern(a.skill).length ? b : a));
    } else {
      const heal = list.find((s) => s.skill.kind === 'heal');
      const buff = list.find((s) => s.skill.kind === 'buff' || s.skill.kind === 'debuff');
      const attacks = list.filter((s) => s.skill.kind === 'attack');
      if (heal && u.c.hp < u.maxHp * 0.35 && Math.random() < 0.6) pick = heal;
      else if (buff && Math.random() < 0.18) pick = buff;
      else pick = attacks[Math.floor(Math.random() * attacks.length)] ?? list[0];
    }
    const s = pick.skill;
    let targets: Unit[];
    if (s.target === 'allEnemies') targets = party;
    else if (s.target === 'self' || s.target === 'ally') targets = [u];
    else if (s.target === 'allAllies') targets = this.alive('enemy');
    else {
      const weights = party.map((p) => 1 + (1 - p.c.hp / p.maxHp));
      let r = Math.random() * weights.reduce((a, b) => a + b, 0);
      targets = [party[party.length - 1]];
      for (let i = 0; i < party.length; i++) { r -= weights[i]; if (r <= 0) { targets = [party[i]]; break; } }
    }
    return { skill: s, rank: 1, targets };
  }

  private async enemyTurn(u: Unit) {
    const { skill, rank, targets } = this.ai(u);
    const color = ELEMENTS[skill.id === 'strike' ? u.sp.element : skill.element].color;
    this.ui.skill(skill.name, color, u.name);
    if (skill.kind !== 'attack') {
      this.shotSide();
      u.rig.play('cast');
      this.vfx.aura(u.home, color);
      await wait(600);
      for (const t of targets) {
        if (skill.kind === 'heal') this.healUnit(t, Math.round(rankedPower(skill, rank) * (1 + u.c.level * 0.12)));
        else if (skill.effect) {
          const tgts = skill.kind === 'debuff' ? this.alive('party') : [t];
          for (const x of tgts) this.addBuff(x, skill.effect.stat, skill.effect.amount, skill.effect.turns);
        }
      }
      await wait(700);
      return;
    }
    await this.enemyAttack(u, skill, rank, targets, color);
  }

  private async enemyAttack(u: Unit, skill: Skill, rank: number, targets: Unit[], color: string) {
    const aoe = targets.length > 1;
    const primary = targets[0];
    const melee = (skill.vfx === 'slash' || skill.vfx === 'quake') && !aoe;
    const speed = u.enraged ? 0.82 : 1;
    const pattern = strikePattern(skill);
    this.shotSide();
    // telegraph
    u.rig.play('cast');
    this.vfx.groundDecal('symbol_02', u.home, { color, size: u.radius * 3, size1: u.radius * 4, life: 1.0, rot: 2 });
    this.vfx.sprite('flare_01', u.chest(), { color, size: 1, size1: u.height * 1.2, life: 0.6, opacity: 0.8 });
    if (melee) { await wait(250); await this.dash(u, primary); }
    else await wait(420);

    this.ui.showDefense(true);
    this.presses = this.presses.filter((p) => p.kind === 'qte');
    this.whiffs = [];
    const lead = 850;
    const t0 = performance.now() + lead;
    const impacts = pattern.map((s) => ({ at: t0 + s.t * speed, red: !!s.unblockable }));
    let hits = 0, parries = 0, blockable = 0;
    for (let i = 0; i < impacts.length; i++) {
      const imp = impacts[i];
      if (!imp.red) blockable++;
      const ring = this.ui.ring(imp.red ? 'red' : 'defend');
      const ringStart = imp.at - 800;
      // attack animation timed to land on impact
      let animFired = false;
      let shotFired = false;
      let autoDef = false;
      for (;;) {
        await nextFrame();
        const now = performance.now();
        if (auto() && !autoDef && !(window as unknown as { __noDefend?: boolean }).__noDefend && now >= imp.at - 60) { autoDef = true; this.press(imp.red ? 'dodge' : 'parry', now); }
        const anchor = aoe ? this.projectPoint(this.center('party').add(new THREE.Vector3(0, 1.2, 0))) : this.project(primary, 0.6);
        ring.set(anchor.x, anchor.y, (now - ringStart) / 800);
        if (!animFired && now >= imp.at - 280) { animFired = true; u.rig.play('attack'); }
        if (!shotFired && !melee && now >= imp.at - 360) {
          shotFired = true;
          const dest = aoe ? this.center('party').add(new THREE.Vector3(0, 1, 0)) : primary.chest();
          if (skill.vfx === 'beam') setTimeout(() => this.vfx.beam(u.chest(), dest, color, 0.45), 240);
          else void this.vfx.projectile(u.chest(), dest, color, 0.34, 1.2);
        }
        if (now >= imp.at + DODGE_LATE) break;
      }
      const res = this.judgeDefense(imp.at, imp.red);
      const anchorUnits = aoe ? this.alive('party') : [primary];
      if (res === 'parry') {
        parries++;
        ring.judge('PARRY', 'perfect');
        sfx('parry');
        for (const t of anchorUnits) { this.vfx.parry(t.chest()); t.ap = Math.min(9, t.ap + 1); t.rig.play('attack'); }
        this.shake(0.25);
        tweens.timeScale = 0.35;
        setTimeout(() => (tweens.timeScale = 1), 140);
      } else if (res === 'dodge') {
        ring.judge('DODGE', 'good');
        sfx('dodge');
        for (const t of anchorUnits) { this.vfx.dodge(t.chest()); void this.hop(t); }
      } else {
        hits++;
        ring.judge(imp.red ? 'HIT' : 'HIT', 'miss');
        for (const t of targets) {
          if (!t.alive) continue;
          this.impactFx(skill, t, color, i);
          const r = this.damage(u, t, skill, rank, 1);
          this.applyDamage(t, r.amount, r.eff, r.crit, true);
        }
        this.shake(0.3);
      }
      this.ui.refresh(this.units);
    }
    this.ui.showDefense(false);
    await wait(250);
    // counter-attack: every blockable strike parried and nothing landed
    if (hits === 0 && parries > 0 && parries === blockable && u.alive) {
      const counterer = aoe ? this.alive('party')[0] : primary;
      if (counterer?.alive) await this.counter(counterer, u);
    }
    if (melee) await this.dashBack(u);
    await wait(200);
  }

  private judgeDefense(at: number, red: boolean): 'parry' | 'dodge' | 'hit' {
    // presses before this strike's window are whiffs: they lock defence briefly (anti-mash)
    for (const pp of this.presses) {
      if (pp.kind !== 'qte' && !pp.used && pp.t < at - DODGE_EARLY) { pp.used = true; this.whiffs.push(pp.t); }
    }
    const locked = (t: number) => this.whiffs.some((w) => t > w && t - w < WHIFF_LOCK);
    const p = this.presses.find((pp) => pp.kind !== 'qte' && !pp.used && pp.t >= at - DODGE_EARLY && pp.t <= at + DODGE_LATE && !locked(pp.t));
    if (!p) return 'hit';
    p.used = true;
    if (p.kind === 'parry') {
      if (!red && p.t >= at - PARRY_EARLY && p.t <= at + PARRY_LATE) return 'parry';
      return 'hit';
    }
    return 'dodge';
  }

  private async hop(t: Unit) {
    const side = this.R.clone().multiplyScalar(Math.random() < 0.5 ? 1.4 : -1.4);
    const start = t.rig.root.position.clone();
    await tweens.tween(0.14, (k) => { t.rig.root.position.copy(start).addScaledVector(side, k); t.rig.root.position.y = start.y + Math.sin(k * Math.PI) * 0.5; }, ease.out);
    await tweens.tween(0.22, (k) => { t.rig.root.position.copy(start).addScaledVector(side, 1 - k); }, ease.inOut);
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
    sfx('hit2');
    const r = this.damage(u, target, SKILLS.strike, 1, 2.2);
    this.applyDamage(target, r.amount, r.eff, r.crit, false);
    this.addBreak(target, 34);
    this.shake(0.5);
    await wait(220);
    tweens.timeScale = 1;
    await this.dashBack(u);
  }

  // ── Capture ────────────────────────────────────────────────────────
  private captureChance(t: Unit, great: boolean, perfects: number) {
    const hpR = t.c.hp / t.maxHp;
    const lead = Math.max(...this.party.map((p) => p.c.level));
    const lvPen = 1 - Math.max(0, t.c.level - lead) * 0.06;
    const base = t.sp.catchRate * (1.35 - hpR) * (t.broken ? 1.7 : 1) * (great ? 1.6 : 1) * lvPen * (1 + perfects * 0.12);
    return clamp(base, 0.03, 0.96);
  }

  private async capture(t: Unit, great: boolean) {
    const ex = this.world.player;
    this.shot(this.C.clone().addScaledVector(this.F, -6).addScaledVector(this.R, -5).addScaledVector(UP, 3.2), t.home.clone().addScaledVector(UP, t.height * 0.4), 2.5);
    ex.play('attack');
    this.ui.skill(great ? 'Great Orb' : 'Crit Orb', '#ffe8a8', 'Explorer');
    await wait(420);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 16), new THREE.MeshPhysicalMaterial({ color: great ? '#6ab8ff' : '#ff5a6a', emissive: great ? '#3a8aff' : '#ff3a4a', emissiveIntensity: 1.2, roughness: 0.15, clearcoat: 1, metalness: 0.3 }));
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.285, 0.035, 8, 32), new THREE.MeshStandardMaterial({ color: '#ffe8a8', emissive: '#ffd76a', emissiveIntensity: 1.6 }));
    band.rotation.x = Math.PI / 2;
    orb.add(band);
    this.orbMesh = orb;
    this.world.scene.add(orb);
    const from = ex.root.position.clone().add(new THREE.Vector3(0, 1.6, 0));
    const to = t.chest();
    sfx('capture');
    await tweens.tween(0.55, (k) => { orb.position.lerpVectors(from, to, k); orb.position.y += Math.sin(k * Math.PI) * 3; }, ease.inOut);
    this.vfx.sprite('flare_01', to, { color: '#ffffff', size: 2, size1: 6, life: 0.35 });
    this.vfx.burst(to, great ? '#6ab8ff' : '#ff8a9a');
    const s0 = t.rig.root.scale.x;
    await tweens.tween(0.3, (k) => t.rig.root.scale.setScalar(Math.max(0.001, s0 * (1 - k))), ease.in);
    t.rig.root.visible = false;
    const groundP = t.home.clone().add(new THREE.Vector3(0, 0.28, 0));
    await tweens.tween(0.35, (k) => { orb.position.lerpVectors(to, groundP, k); }, ease.in);
    sfx('orb');
    // steady-the-orb QTE: 3 beats
    this.ui.bannerText('Steady the orb!', 'info', 800);
    let perfects = 0;
    for (let i = 0; i < 3; i++) {
      const res = await this.qteHit(() => this.projectPoint(orb.position), 650);
      if (res === 'perfect') perfects++;
      await tweens.tween(0.25, (k) => { orb.rotation.z = Math.sin(k * Math.PI * 2) * 0.5; }, ease.linear);
    }
    const chance = this.captureChance(t, great, perfects);
    const ok = Math.random() < chance;
    const shakes = ok ? 3 : Math.floor(Math.random() * 3);
    for (let i = 0; i < shakes; i++) {
      await wait(250);
      sfx('orb');
      await tweens.tween(0.35, (k) => { orb.rotation.z = Math.sin(k * Math.PI * 2) * 0.6; orb.position.y = groundP.y + Math.abs(Math.sin(k * Math.PI)) * 0.15; }, ease.linear);
    }
    await wait(300);
    if (ok) {
      sfx('captured');
      this.vfx.sparks(orb.position, '#ffe8a8', 40, 8);
      this.vfx.sprite('star_07', orb.position, { color: '#fff6c8', size: 1, size1: 4, life: 0.6, rot: 2 });
      this.ui.bannerText(`Captured ${t.name}!`, 'good', 1400);
      t.captured = true;
      t.c.hp = Math.max(1, t.c.hp);
      this.captured.push(t.c);
      ex.play('victory');
      await wait(1400);
    } else {
      sfx('break');
      this.vfx.burst(orb.position, '#ff8a6a');
      this.ui.bannerText('It broke free!', 'bad', 900);
      t.rig.root.visible = true;
      await tweens.tween(0.25, (k) => t.rig.root.scale.setScalar(Math.max(0.001, s0 * k)), ease.back);
      await wait(600);
    }
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
      u.rig.play('faint');
      this.floatAt(u, `${u.name} fainted`, 'info');
      await wait(900);
      if (u.side === 'enemy') {
        const s0 = u.rig.root.scale.x;
        this.vfx.sprite('smoke_07', u.chest(), { color: '#ffffff', size: u.height, size1: u.height * 1.8, life: 0.7, opacity: 0.5 });
        await tweens.tween(0.4, (k) => u.rig.root.scale.setScalar(Math.max(0.001, s0 * (1 - k))), ease.in);
        u.rig.root.visible = false;
      } else {
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
    const u = new Unit('party', next, makeCreatureRig(next.species, next.shiny), out.slot);
    u.av = out.av;
    this.place(u, out.home.clone());
    u.rig.root.scale.setScalar(0.001);
    this.world.scene.add(u.rig.root);
    this.units[this.units.indexOf(out)] = u;
    this.participants.add(next);
    this.ui.replaceCard(out, u);
    this.ui.bannerText(`Go, ${u.name}!`, 'info', 800);
    sfx('orb');
    this.vfx.groundDecal('symbol_01', u.home, { color: ELEMENTS[u.sp.element].color, size: 1, size1: 3.5, life: 0.9, rot: 3 });
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
      // rewards
      const defeated = this.enemies.filter((u) => !u.captured);
      let xp = 0, gold = 0;
      const shards: Partial<Record<Element, number>> = {};
      for (const e of defeated) {
        const boss = e.boss ? 4 : 1;
        xp += Math.round((14 + e.c.level * 7) * boss);
        gold += (6 + e.c.level * 3) * (e.boss ? 6 : 1);
        shards[e.sp.element] = (shards[e.sp.element] ?? 0) + (e.boss ? 6 : 1 + (Math.random() < 0.35 ? 1 : 0));
      }
      for (const e of this.enemies.filter((u) => u.captured)) xp += Math.round((14 + e.c.level * 7) * 0.5);
      state.inv.gold += gold;
      for (const [el, n] of Object.entries(shards)) state.inv.elementum[el as Element] += n ?? 0;
      const team = state.team.map((c) => ({ c, beforeLv: c.level, beforeXp: c.xp, newSkills: [] as string[] }));
      for (const t of team) {
        const share = this.participants.has(t.c) ? xp : Math.round(xp * 0.5);
        const r = grantXp(t.c, share);
        t.newSkills = r.newSkills.map((id) => SKILLS[id].name);
        if (r.levels > 0) sfx('levelup');
      }
      for (const c of this.captured) addCreature(c);
      o.evolvable = state.team.filter((c) => canEvolve(c));
      await this.ui.results({
        title: o.result === 'captured' ? 'Captured!' : this.setup.kind === 'boss' ? 'Guardian Defeated' : 'Victory',
        sub: this.setup.kind === 'boss' ? `${this.setup.zone.name} is at peace.` : this.captured.length ? `${this.captured.map(displayName).join(', ')} joined the expedition` : 'The wilds grow quiet.',
        xp, gold, shards: Object.entries(shards) as [string, number][], team, captured: this.captured,
      });
    } else if (o.result === 'lose') {
      this.ui.bannerText('Your expedition falls…', 'bad', 2000);
      await wait(2200);
    }
    this.cleanup();
  }

  private cleanup() {
    removeEventListener('keydown', this.keyListener);
    for (const u of this.units) this.world.scene.remove(u.rig.root);
    this.vfx.clear();
    this.world.scene.remove(this.vfx.group);
    this.world.scene.remove(this.selectRing);
    if (this.orbMesh) this.world.scene.remove(this.orbMesh);
    tweens.timeScale = 1;
    this.ui.destroy();
    // keep party HP state (persisted on creature objects)
    for (const c of state.team) c.hp = Math.min(c.hp, statsOf(c).maxHp);
  }
}
