import * as THREE from 'three';
import type { Rig } from '../assets/placeholders';
import { statsOf, speciesOf, displayName, type Creature } from '../game/creature';
import type { Stat } from '../data/skills';

export interface Buff { stat: Stat; amount: number; turns: number }

export class Unit {
  ap = 2;
  brk = 0;
  brkMax: number;
  broken = false;
  av = 0;
  buffs: Buff[] = [];
  enraged = false;
  participated = true;
  captured = false;
  gone = false;
  bossPatternIdx = 0;
  home = new THREE.Vector3();
  face = 0;

  constructor(public side: 'party' | 'enemy', public c: Creature, public rig: Rig, public slot: number, public boss = false) {
    this.brkMax = boss ? 260 : 100;
  }

  get alive() { return this.c.hp > 0 && !this.captured && !this.gone; }
  get name() { return displayName(this.c); }
  get sp() { return speciesOf(this.c); }
  get maxHp() { return statsOf(this.c).maxHp; }
  get height() { return this.rig.height; }
  get radius() { return Math.max(0.6, this.rig.height * 0.35); }

  stat(s: Stat): number {
    const base = statsOf(this.c)[s];
    let m = 0;
    for (const b of this.buffs) if (b.stat === s) m += b.amount;
    if (this.enraged && s === 'atk') m += 0.3;
    return base * THREE.MathUtils.clamp(1 + m, 0.4, 2.2);
  }

  /** Base action-value increment: lower = acts more often. */
  get avStep() { return 1000 / Math.max(1, this.stat('spd')); }

  /** Centre-of-mass point for effects and cameras. */
  chest(v = new THREE.Vector3()) { return v.copy(this.rig.root.position).add(new THREE.Vector3(0, this.height * 0.55, 0)); }
}
