import { SPECIES, type Species } from '../data/species';
import { SKILLS, type Skill } from '../data/skills';
import { randInt } from '../core/noise';

export interface Genes { hp: number; atk: number; def: number; spd: number } // 0..15 each

export interface OwnedSkill { id: string; rank: number } // rank 1..5

export interface Creature {
  uid: string;
  species: string;
  nickname?: string;
  level: number;
  xp: number;
  hp: number;
  genes: Genes;
  skills: OwnedSkill[];
  /** Elementum infusion level 0..10 — permanent stat boost. */
  infusion: number;
  shiny: boolean;
  /** Parents' species (for breeding lineage display). */
  parents?: [string, string];
}

export interface Stats { maxHp: number; atk: number; def: number; spd: number }

let uidCounter = 0;
export const newUid = () => `${Date.now().toString(36)}${(uidCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const randomGenes = (): Genes => ({ hp: randInt(0, 15), atk: randInt(0, 15), def: randInt(0, 15), spd: randInt(0, 15) });

export function speciesOf(c: Creature): Species { return SPECIES[c.species]; }
export function displayName(c: Creature) { return c.nickname || speciesOf(c).name; }

export function statsOf(c: Creature): Stats {
  const b = speciesOf(c).base;
  const L = c.level;
  const inf = 1 + c.infusion * 0.03;
  const g = c.genes;
  return {
    maxHp: Math.round((b.hp * (1 + L * 0.13) + g.hp * 0.8 + L * 2) * inf),
    atk: Math.round((b.atk * (1 + L * 0.09) + g.atk * 0.25) * inf),
    def: Math.round((b.def * (1 + L * 0.09) + g.def * 0.25) * inf),
    spd: Math.round((b.spd * (1 + L * 0.07) + g.spd * 0.25) * inf),
  };
}

export const xpToNext = (level: number) => Math.round(20 + level * level * 6);

export function learnedSkills(speciesId: string, level: number): OwnedSkill[] {
  const sp = SPECIES[speciesId];
  const ids = sp.learnset.filter(([lv]) => lv <= level).map(([, id]) => id);
  const uniq = [...new Set(ids)].slice(-4);
  return uniq.map((id) => ({ id, rank: 1 }));
}

export function createCreature(speciesId: string, level: number, opts: Partial<Creature> = {}): Creature {
  const c: Creature = {
    uid: newUid(),
    species: speciesId,
    level,
    xp: 0,
    hp: 1,
    genes: randomGenes(),
    skills: learnedSkills(speciesId, level),
    infusion: 0,
    shiny: Math.random() < 1 / 150,
    ...opts,
  };
  c.hp = statsOf(c).maxHp;
  return c;
}

export function skillList(c: Creature): { skill: Skill; rank: number }[] {
  return [{ skill: SKILLS.strike, rank: 1 }, ...c.skills.map((s) => ({ skill: SKILLS[s.id], rank: s.rank }))];
}

/** Rank bonus: +12% power per rank above 1, AP −1 at rank 5 (min 1 for non-basics). */
export function rankedPower(skill: Skill, rank: number) { return skill.power * (1 + (rank - 1) * 0.12); }
export function rankedAp(skill: Skill, rank: number) { return skill.ap === 0 ? 0 : Math.max(1, skill.ap - (rank >= 5 ? 1 : 0)); }

export interface LevelUpResult { levels: number; newSkills: string[]; canEvolve: boolean }

export function grantXp(c: Creature, amount: number): LevelUpResult {
  const before = c.level;
  const known = new Set(c.skills.map((s) => s.id));
  const newSkills: string[] = [];
  c.xp += amount;
  while (c.xp >= xpToNext(c.level) && c.level < 50) {
    const oldMax = statsOf(c).maxHp;
    c.xp -= xpToNext(c.level);
    c.level++;
    c.hp += statsOf(c).maxHp - oldMax;
    for (const [lv, id] of speciesOf(c).learnset) {
      if (lv === c.level && !known.has(id)) {
        known.add(id);
        newSkills.push(id);
        if (c.skills.length < 4) c.skills.push({ id, rank: 1 });
        else c.skills[0] = { id, rank: 1 }; // replace oldest
      }
    }
  }
  return { levels: c.level - before, newSkills, canEvolve: canEvolve(c) };
}

export function canEvolve(c: Creature) {
  const ev = speciesOf(c).evolvesTo;
  return !!ev && c.level >= ev.level;
}

export function evolve(c: Creature): string | null {
  const ev = speciesOf(c).evolvesTo;
  if (!ev || c.level < ev.level) return null;
  const hpRatio = c.hp / statsOf(c).maxHp;
  c.species = ev.id;
  // keep ranks for skills that survive, add any learnset skills the evolved form has by now
  const ranks = new Map(c.skills.map((s) => [s.id, s.rank]));
  c.skills = learnedSkills(ev.id, c.level).map((s) => ({ id: s.id, rank: ranks.get(s.id) ?? 1 }));
  c.hp = Math.max(1, Math.round(statsOf(c).maxHp * hpRatio));
  return ev.id;
}

export function heal(c: Creature) { c.hp = statsOf(c).maxHp; }

/** Base species of an evolution line (for eggs). */
export function baseForm(speciesId: string): string {
  for (const sp of Object.values(SPECIES)) if (sp.evolvesTo?.id === speciesId) return baseForm(sp.id);
  return speciesId;
}

/** Breed: egg species = mother's base form; genes = best-of-parents mix + mutation; inherits one skill. */
export function breedGenes(a: Genes, b: Genes): Genes {
  const mix = (x: number, y: number) => Math.min(15, Math.max(x, y) - randInt(0, 2) + (Math.random() < 0.2 ? randInt(1, 3) : 0));
  return { hp: mix(a.hp, b.hp), atk: mix(a.atk, b.atk), def: mix(a.def, b.def), spd: mix(a.spd, b.spd) };
}

export const geneTotal = (g: Genes) => g.hp + g.atk + g.def + g.spd;
export function geneGrade(g: Genes) {
  const t = geneTotal(g);
  return t >= 54 ? 'S' : t >= 44 ? 'A' : t >= 32 ? 'B' : t >= 20 ? 'C' : 'D';
}
