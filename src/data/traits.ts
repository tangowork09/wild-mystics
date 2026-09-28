// Natures, abilities, status effects and rarity — the per-Mystic identity layer.
import type { Element } from './elements';

// ── Rarity (Miscrits-style tiers) ──────────────────────────────────────────
export type Rarity = 'common' | 'rare' | 'epic' | 'exotic' | 'legendary';
export const RARITY: Record<Rarity, { name: string; color: string; statMult: number; glow: string; order: number }> = {
  common: { name: 'Common', color: '#b8c0c8', statMult: 1, glow: 'rgba(184,192,200,0.35)', order: 0 },
  rare: { name: 'Rare', color: '#5ab4ff', statMult: 1.04, glow: 'rgba(90,180,255,0.45)', order: 1 },
  epic: { name: 'Epic', color: '#b57aff', statMult: 1.08, glow: 'rgba(181,122,255,0.5)', order: 2 },
  exotic: { name: 'Exotic', color: '#ff9a3a', statMult: 1.12, glow: 'rgba(255,154,58,0.55)', order: 3 },
  legendary: { name: 'Legendary', color: '#ffd76a', statMult: 1.2, glow: 'rgba(255,215,106,0.65)', order: 4 },
};
export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'exotic', 'legendary'];

// ── Natures (Pokémon-style ±10%) ───────────────────────────────────────────
export type StatKey = 'hp' | 'atk' | 'def' | 'spd';
export interface Nature { id: string; name: string; up?: StatKey; down?: StatKey; flavor: string }
export const NATURES: Nature[] = [
  { id: 'brave', name: 'Brave', up: 'atk', down: 'spd', flavor: 'Charges in without looking.' },
  { id: 'adamant', name: 'Adamant', up: 'atk', down: 'def', flavor: 'Never backs down.' },
  { id: 'fierce', name: 'Fierce', up: 'atk', down: 'hp', flavor: 'All claws, no patience.' },
  { id: 'bold', name: 'Bold', up: 'def', down: 'atk', flavor: 'Stands its ground.' },
  { id: 'relaxed', name: 'Relaxed', up: 'def', down: 'spd', flavor: 'Nothing ruffles it.' },
  { id: 'stalwart', name: 'Stalwart', up: 'def', down: 'hp', flavor: 'Built like a wall.' },
  { id: 'timid', name: 'Timid', up: 'spd', down: 'atk', flavor: 'Quick to flee, quicker to dodge.' },
  { id: 'jolly', name: 'Jolly', up: 'spd', down: 'def', flavor: 'Bounces everywhere.' },
  { id: 'hasty', name: 'Hasty', up: 'spd', down: 'hp', flavor: 'Always in a hurry.' },
  { id: 'hardy', name: 'Hardy', up: 'hp', down: 'spd', flavor: 'Tough as old roots.' },
  { id: 'gentle', name: 'Gentle', up: 'hp', down: 'atk', flavor: 'Kind to a fault.' },
  { id: 'calm', name: 'Calm', up: 'hp', down: 'def', flavor: 'Breathes slowly, heals quickly.' },
  { id: 'serene', name: 'Serene', flavor: 'Perfectly balanced.' },
];
export const natureById = (id: string) => NATURES.find((n) => n.id === id) ?? NATURES[NATURES.length - 1];
export function natureMult(id: string, stat: StatKey) {
  const n = natureById(id);
  return n.up === stat ? 1.1 : n.down === stat ? 0.9 : 1;
}

// ── Status effects ─────────────────────────────────────────────────────────
export type StatusId = 'burn' | 'poison' | 'paralyze' | 'sleep' | 'freeze' | 'confuse';
export const STATUS: Record<StatusId, { name: string; color: string; short: string; desc: string }> = {
  burn: { name: 'Burn', color: '#ff7a3a', short: 'BRN', desc: 'Loses 6% HP each turn, ATK −20%.' },
  poison: { name: 'Poison', color: '#b86aff', short: 'PSN', desc: 'Loses 8% HP each turn, worsening.' },
  paralyze: { name: 'Paralysis', color: '#ffd84a', short: 'PAR', desc: '25% chance to lose the turn, SPD −30%.' },
  sleep: { name: 'Sleep', color: '#8ab4ff', short: 'SLP', desc: 'Skips turns; may wake when hit.' },
  freeze: { name: 'Freeze', color: '#9fe8ff', short: 'FRZ', desc: 'Frozen solid; thaws over time or from fire.' },
  confuse: { name: 'Confusion', color: '#ff8ad8', short: 'CNF', desc: '33% chance to hit itself.' },
};

// ── Abilities (passive traits) ─────────────────────────────────────────────
export type AbilityId =
  | 'blaze' | 'torrent' | 'overgrow' | 'bedrock' | 'surge' | 'tailwind_soul' | 'umbra'
  | 'thick_hide' | 'swift' | 'regenerator' | 'static' | 'flame_body' | 'poison_touch' | 'sturdy'
  | 'intimidate' | 'keen_eye' | 'breaker' | 'lucky' | 'opportunist' | 'guardian_aura' | 'rage' | 'pickup'
  | 'absorb' | 'frostbite' | 'sleep_spores' | 'momentum' | 'focus' | 'aegis';

export const ABILITIES: Record<AbilityId, { name: string; desc: string }> = {
  blaze: { name: 'Blaze', desc: 'Fire skills deal +35% damage while below 35% HP.' },
  torrent: { name: 'Torrent', desc: 'Water skills deal +35% damage while below 35% HP.' },
  overgrow: { name: 'Overgrow', desc: 'Nature skills deal +35% damage while below 35% HP.' },
  bedrock: { name: 'Bedrock', desc: 'Earth skills deal +35% damage while below 35% HP.' },
  surge: { name: 'Surge', desc: 'Storm skills deal +35% damage while below 35% HP.' },
  tailwind_soul: { name: 'Tailwind Soul', desc: 'Wind skills deal +35% damage while below 35% HP.' },
  umbra: { name: 'Umbra', desc: 'Void skills deal +35% damage while below 35% HP.' },
  thick_hide: { name: 'Thick Hide', desc: 'Takes 15% less damage.' },
  swift: { name: 'Swift', desc: 'Starts battle with +1 AP and 10% more speed.' },
  regenerator: { name: 'Regenerator', desc: 'Recovers 6% HP at the start of each turn.' },
  static: { name: 'Static', desc: 'Foes that strike it may be paralysed (25%).' },
  flame_body: { name: 'Flame Body', desc: 'Foes that strike it may be burned (25%).' },
  poison_touch: { name: 'Poison Touch', desc: 'Its hits may poison (20%).' },
  sturdy: { name: 'Sturdy', desc: 'Survives one lethal hit at full HP with 1 HP.' },
  intimidate: { name: 'Intimidate', desc: 'Lowers every foe’s ATK when battle begins.' },
  keen_eye: { name: 'Keen Eye', desc: 'Parry and dodge windows are 40% wider when it is targeted.' },
  breaker: { name: 'Breaker', desc: 'Deals 50% more Break damage.' },
  lucky: { name: 'Lucky', desc: 'Critical hit chance +12%.' },
  opportunist: { name: 'Opportunist', desc: '+25% damage to Broken or afflicted foes.' },
  guardian_aura: { name: 'Guardian Aura', desc: 'Allies take 10% less damage.' },
  rage: { name: 'Rage', desc: 'ATK rises each time it is hit.' },
  pickup: { name: 'Pickup', desc: 'Sometimes finds an item after battle.' },
  absorb: { name: 'Absorb', desc: 'Heals instead of taking damage from its own element.' },
  frostbite: { name: 'Frostbite', desc: 'Its hits may freeze (12%).' },
  sleep_spores: { name: 'Sleep Spores', desc: 'Its hits may put foes to sleep (12%).' },
  momentum: { name: 'Momentum', desc: 'Each Perfect hit adds +1 AP (once per turn).' },
  focus: { name: 'Focus', desc: 'Perfect hits deal 45% bonus damage instead of 30%.' },
  aegis: { name: 'Aegis', desc: 'Immune to status effects.' },
};

export const PINCH: Record<Element, AbilityId> = { fire: 'blaze', water: 'torrent', nature: 'overgrow', earth: 'bedrock', storm: 'surge', wind: 'tailwind_soul', void: 'umbra' };
