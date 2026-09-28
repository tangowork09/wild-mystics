import { SPECIES, type Species, type Evo } from '../data/species';
import { SKILLS, type Skill } from '../data/skills';
import { NATURES, RARITY, natureMult, type StatKey, type AbilityId } from '../data/traits';
import { RELICS, relicScale, type RelicInstance } from '../data/relics';
import type { ItemId } from '../data/items';
import { randInt, pick } from '../core/noise';

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
  nature: string;
  ability: AbilityId;
  /** Awakening stars 0..5 (duplicates / Mystic Essence). */
  stars: number;
  /** Equipped relic uids (2 slots, 3 at 3★). */
  relics: string[];
  caught?: { zone?: string; orb?: string; at: number; how?: 'wild' | 'grass' | 'search' | 'egg' | 'summon' | 'starter' | 'gift' };
  /** Parents' species (for breeding lineage display). */
  parents?: [string, string];
  favorite?: boolean;
  /** v3:creatures — caught (or fought) as an Alpha: elite, oversized, crowned. Optional, save-compatible. */
  alpha?: boolean;
  /** v3 Miscrits-style training: stat points gained each time the Mystic is trained up a level. */
  trained?: TrainedStats;
}

export interface Stats { maxHp: number; atk: number; def: number; spd: number }
export type { StatKey };
export type TrainedStats = Record<StatKey, number>;

let uidCounter = 0;
export const newUid = () => `${Date.now().toString(36)}${(uidCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const randomGenes = (): Genes => ({ hp: randInt(0, 15), atk: randInt(0, 15), def: randInt(0, 15), spd: randInt(0, 15) });

export function speciesOf(c: Creature): Species { return SPECIES[c.species]; }
export function displayName(c: Creature) { return c.nickname || speciesOf(c).name; }

// Relics are owned by the save state; creature math looks them up through this resolver.
let relicResolver: (uid: string) => RelicInstance | undefined = () => undefined;
export function setRelicResolver(fn: (uid: string) => RelicInstance | undefined) { relicResolver = fn; }
export function equippedRelics(c: Creature) {
  return (c.relics ?? []).map(relicResolver).filter((r): r is RelicInstance => !!r && !!RELICS[r.id]);
}
export const relicSlots = (c: Creature) => (c.stars >= 3 ? 3 : 2);

export function relicBonus(c: Creature, stat: StatKey) {
  let b = 0;
  for (const r of equippedRelics(c)) b += (RELICS[r.id].stats[stat] ?? 0) * relicScale(r.level);
  return b;
}
export function hasRelicEffect(c: Creature, effect: string) {
  return equippedRelics(c).some((r) => RELICS[r.id].effect === effect);
}

export function statsOf(c: Creature): Stats {
  const sp = speciesOf(c);
  const b = sp.base;
  const L = c.level;
  const mult = (1 + c.infusion * 0.03) * RARITY[sp.rarity].statMult * (1 + (c.stars ?? 0) * 0.05);
  const g = c.genes;
  const t = c.trained ?? NO_TRAINING;
  const n = c.nature ?? 'serene';
  return {
    maxHp: Math.round((b.hp * (1 + L * 0.13) + g.hp * 0.8 + L * 2 + t.hp * TRAIN_WEIGHT.hp) * mult * natureMult(n, 'hp') * (1 + relicBonus(c, 'hp'))),
    atk: Math.round((b.atk * (1 + L * 0.09) + g.atk * 0.25 + t.atk * TRAIN_WEIGHT.atk) * mult * natureMult(n, 'atk') * (1 + relicBonus(c, 'atk'))),
    def: Math.round((b.def * (1 + L * 0.09) + g.def * 0.25 + t.def * TRAIN_WEIGHT.def) * mult * natureMult(n, 'def') * (1 + relicBonus(c, 'def'))),
    spd: Math.round((b.spd * (1 + L * 0.07) + g.spd * 0.25 + t.spd * TRAIN_WEIGHT.spd) * mult * natureMult(n, 'spd') * (1 + relicBonus(c, 'spd'))),
  };
}

export const xpToNext = (level: number) => Math.round(20 + level * level * 6);
export const LEVEL_CAP = 60;

export function learnedSkills(speciesId: string, level: number): OwnedSkill[] {
  const sp = SPECIES[speciesId];
  const ids = sp.learnset.filter(([lv]) => lv <= level).map(([, id]) => id).filter((id) => SKILLS[id]);
  const uniq = [...new Set(ids)].slice(-4);
  return uniq.map((id) => ({ id, rank: 1 }));
}

export function createCreature(speciesId: string, level: number, opts: Partial<Creature> = {}): Creature {
  const sp = SPECIES[speciesId];
  const c: Creature = {
    uid: newUid(),
    species: speciesId,
    level,
    xp: 0,
    hp: 1,
    genes: randomGenes(),
    skills: learnedSkills(speciesId, level),
    infusion: 0,
    shiny: false,
    nature: pick(NATURES).id,
    ability: pick(sp.abilities),
    stars: 0,
    relics: [],
    ...opts,
  };
  c.hp = statsOf(c).maxHp;
  return c;
}

/** Bring older saves up to the current creature shape. */
export function migrateCreature(c: Creature): Creature {
  const sp = SPECIES[c.species];
  if (!sp) return c;
  c.nature ??= pick(NATURES).id;
  c.ability ??= sp.abilities[0];
  c.stars ??= 0;
  c.relics ??= [];
  c.skills = (c.skills ?? []).filter((s) => SKILLS[s.id]);
  if (!c.skills.length) c.skills = learnedSkills(c.species, c.level);
  return c;
}

export function skillList(c: Creature): { skill: Skill; rank: number }[] {
  return [{ skill: SKILLS.strike, rank: 1 }, ...c.skills.map((s) => ({ skill: SKILLS[s.id], rank: s.rank })).filter((x) => x.skill)];
}

/** Rank bonus: +12% power per rank above 1, AP −1 at rank 5 (min 1 for non-basics). */
export function rankedPower(skill: Skill, rank: number) { return skill.power * (1 + (rank - 1) * 0.12); }
export function rankedAp(skill: Skill, rank: number) { return skill.ap === 0 ? 0 : Math.max(1, skill.ap - (rank >= 5 ? 1 : 0)); }

export interface LevelUpResult { levels: number; newSkills: string[]; canEvolve: boolean; ready?: boolean }

/** v3 (Miscrits): battle XP fills the bar but never levels a Mystic by itself. A full bar means it
 *  is ready to Train (Team → Train), which raises the level with rolled stat gains. */
export function grantXp(c: Creature, amount: number): LevelUpResult {
  if (c.level < LEVEL_CAP) c.xp = Math.min(xpToNext(c.level), c.xp + Math.max(0, amount));
  else c.xp = 0;
  return { levels: 0, newSkills: [], canEvolve: false, ready: trainReady(c) };
}

export const trainReady = (c: Creature) => c.level < LEVEL_CAP && c.xp >= xpToNext(c.level);

/** Gems (Aether) for a Max Train at this level: every stat rolls its best result. */
export const maxTrainCost = (c: Creature) => 10 + c.level * 4;

/** Training points → stat: one point is worth this much raw stat (≈ +10% at Lv 35 for a maxed Mystic). */
export const TRAIN_WEIGHT: Record<StatKey, number> = { hp: 1, atk: 0.15, def: 0.15, spd: 0.12 };
const NO_TRAINING: TrainedStats = { hp: 0, atk: 0, def: 0, spd: 0 };
export type TrainQuality = 'weak' | 'good' | 'great' | 'max';
export interface TrainResult {
  gains: TrainedStats;
  quality: Record<StatKey, TrainQuality>;
  before: Stats;
  after: Stats;
  newSkills: string[];
  /** Species this Mystic can evolve into now that it reached 10/20/30/35. */
  evolveTo: string | null;
}

/** Train one level: +1 level, each stat rolls weak/good/great (Max Train: all max). */
export function train(c: Creature, max = false, isNight = false): TrainResult | null {
  if (!trainReady(c)) return null;
  const before = statsOf(c);
  const known = new Set(c.skills.map((s) => s.id));
  const newSkills: string[] = [];
  const roll = (): [number, TrainQuality] => {
    if (max) return [3, 'max'];
    const r = Math.random();
    return r < 0.35 ? [1, 'weak'] : r < 0.8 ? [2, 'good'] : [3, 'great'];
  };
  const gains = { ...NO_TRAINING };
  const quality = {} as Record<StatKey, TrainQuality>;
  for (const k of ['hp', 'atk', 'def', 'spd'] as StatKey[]) { const [v, q] = roll(); gains[k] = v; quality[k] = q; }
  const tr = (c.trained ??= { ...NO_TRAINING });
  for (const k of Object.keys(gains) as StatKey[]) tr[k] += gains[k];
  c.xp = 0;
  c.level++;
  const after = statsOf(c);
  c.hp = Math.min(after.maxHp, c.hp + (after.maxHp - before.maxHp));
  for (const [lv, id] of speciesOf(c).learnset) {
    if (lv === c.level && !known.has(id) && SKILLS[id]) {
      known.add(id);
      newSkills.push(id);
      if (c.skills.length < 4) c.skills.push({ id, rank: 1 });
      else c.skills[0] = { id, rank: 1 };
    }
  }
  const evo = evolutionFor(c, isNight);
  return { gains, quality, before, after, newSkills, evolveTo: evo?.id ?? null };
}

/** Moves enhancement (Miscrits-style): gold + the move's Elementum; rank 5 max. */
export const enhanceCost = (rank: number) => ({ gold: 50 * rank, shards: rank * 2 });

/** Level-based evolution available now (respecting time-of-day conditions). */
export function evolutionFor(c: Creature, isNight = false): Evo | null {
  for (const e of speciesOf(c).evolves) {
    if (e.item) continue;
    if (e.level && c.level < e.level) continue;
    if (e.time === 'night' && !isNight) continue;
    if (e.time === 'day' && isNight) continue;
    if (e.level) return e;
  }
  return null;
}
export const canEvolve = (c: Creature, isNight = false) => !!evolutionFor(c, isNight);
export function stoneEvolution(c: Creature, item: ItemId, isNight = false): Evo | null {
  return speciesOf(c).evolves.find((e) => e.item === item && (!e.time || (e.time === 'night') === isNight) && (!e.level || c.level >= e.level)) ?? null;
}

export function evolveTo(c: Creature, target: string): string | null {
  if (!SPECIES[target]) return null;
  const hpRatio = c.hp / statsOf(c).maxHp;
  c.species = target;
  const ranks = new Map(c.skills.map((s) => [s.id, s.rank]));
  const learned = learnedSkills(target, c.level);
  // keep previously known moves the new form can't learn if there's room
  const merged = [...learned.map((s) => ({ id: s.id, rank: ranks.get(s.id) ?? 1 }))];
  for (const s of c.skills) if (merged.length < 4 && !merged.some((m) => m.id === s.id)) merged.push(s);
  c.skills = merged.slice(0, 4);
  const sp = SPECIES[target];
  if (!sp.abilities.includes(c.ability)) c.ability = sp.abilities[0];
  c.hp = Math.max(1, Math.round(statsOf(c).maxHp * hpRatio));
  return target;
}

export function evolve(c: Creature, isNight = false): string | null {
  const e = evolutionFor(c, isNight);
  return e ? evolveTo(c, e.id) : null;
}

export function heal(c: Creature) { c.hp = statsOf(c).maxHp; }

/** Base species of an evolution line (for eggs). */
export function baseForm(speciesId: string): string {
  for (const sp of Object.values(SPECIES)) if (sp.evolves.some((e) => e.id === speciesId)) return baseForm(sp.id);
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

/** Battle power estimate for sorting and team-strength readouts. */
export function power(c: Creature) {
  const s = statsOf(c);
  return Math.round(s.maxHp * 0.35 + s.atk * 2.2 + s.def * 1.8 + s.spd * 1.6 + c.level * 3);
}
