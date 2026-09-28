// Relics: equippable charms (Miscrits relics × Expedition 33 pictos). Two slots per Mystic,
// a third unlocks at 3★. Each relic gives stat bonuses and may carry a passive effect.
import type { Element } from './elements';
import type { Rarity, StatKey } from './traits';

export type RelicEffect =
  | 'first_ap' | 'parry_ap' | 'lifesteal' | 'second_wind' | 'crit' | 'break' | 'perfect' | 'dodge_heal' | 'counter'
  | 'ap_regen' | 'burst' | 'status_immune' | 'xp' | 'capture' | 'thorns' | 'shield' | 'first_speed'
  | 'inflict_burn' | 'inflict_poison' | 'inflict_freeze' | 'inflict_sleep' | 'element';

export interface RelicDef {
  id: string;
  name: string;
  rarity: Rarity;
  stats: Partial<Record<StatKey, number>>; // fractional bonus at level 1 (e.g. 0.08 = +8%)
  effect?: RelicEffect;
  element?: Element;
  desc: string;
}

const R = (r: RelicDef) => r;

export const RELICS: Record<string, RelicDef> = Object.fromEntries([
  R({ id: 'warrior_band', name: 'Warrior Band', rarity: 'common', stats: { atk: 0.08 }, desc: '+8% ATK.' }),
  R({ id: 'iron_carapace', name: 'Iron Carapace', rarity: 'common', stats: { def: 0.08 }, desc: '+8% DEF.' }),
  R({ id: 'heart_of_oak', name: 'Heart of Oak', rarity: 'common', stats: { hp: 0.1 }, desc: '+10% HP.' }),
  R({ id: 'swift_boots', name: 'Swift Boots', rarity: 'common', stats: { spd: 0.08 }, desc: '+8% SPD.' }),
  R({ id: 'scholar_lens', name: "Scholar's Lens", rarity: 'common', stats: {}, effect: 'xp', desc: '+25% XP from battles.' }),
  R({ id: 'binders_knot', name: "Binder's Knot", rarity: 'rare', stats: { spd: 0.03 }, effect: 'capture', desc: '+20% capture chance while this Mystic leads.' }),
  R({ id: 'ember_charm', name: 'Ember Charm', rarity: 'rare', stats: { atk: 0.03 }, effect: 'element', element: 'fire', desc: 'Fire skills +15% damage.' }),
  R({ id: 'tide_pearl', name: 'Tide Pearl', rarity: 'rare', stats: { hp: 0.04 }, effect: 'element', element: 'water', desc: 'Water skills +15% damage.' }),
  R({ id: 'verdant_seed', name: 'Verdant Seed', rarity: 'rare', stats: { def: 0.03 }, effect: 'element', element: 'nature', desc: 'Nature skills +15% damage.' }),
  R({ id: 'stone_idol', name: 'Stone Idol', rarity: 'rare', stats: { def: 0.04 }, effect: 'element', element: 'earth', desc: 'Earth skills +15% damage.' }),
  R({ id: 'storm_feather', name: 'Storm Feather', rarity: 'rare', stats: { spd: 0.04 }, effect: 'element', element: 'storm', desc: 'Storm skills +15% damage.' }),
  R({ id: 'zephyr_plume', name: 'Zephyr Plume', rarity: 'rare', stats: { spd: 0.04 }, effect: 'element', element: 'wind', desc: 'Wind skills +15% damage.' }),
  R({ id: 'umbral_shard', name: 'Umbral Shard', rarity: 'epic', stats: { atk: 0.05 }, effect: 'element', element: 'void', desc: 'Void skills +15% damage.' }),
  R({ id: 'parry_sigil', name: 'Parry Sigil', rarity: 'rare', stats: { def: 0.03 }, effect: 'parry_ap', desc: 'Parries grant +1 extra AP.' }),
  R({ id: 'duelist_glove', name: "Duelist's Glove", rarity: 'epic', stats: { atk: 0.04 }, effect: 'counter', desc: 'Counterattacks deal +60% damage.' }),
  R({ id: 'vampire_fang', name: 'Vampire Fang', rarity: 'epic', stats: { atk: 0.03 }, effect: 'lifesteal', desc: 'Heals 12% of damage dealt.' }),
  R({ id: 'phoenix_plume', name: 'Phoenix Plume', rarity: 'exotic', stats: { hp: 0.05 }, effect: 'second_wind', desc: 'Once per battle, revives at 30% HP.' }),
  R({ id: 'keen_monocle', name: 'Keen Monocle', rarity: 'rare', stats: { atk: 0.03 }, effect: 'crit', desc: 'Critical chance +12%.' }),
  R({ id: 'hammer_totem', name: 'Hammer Totem', rarity: 'rare', stats: { atk: 0.03 }, effect: 'break', desc: 'Break damage +35%.' }),
  R({ id: 'maestro_baton', name: "Maestro's Baton", rarity: 'epic', stats: { spd: 0.03 }, effect: 'perfect', desc: 'Perfect hits deal +20% more.' }),
  R({ id: 'dancer_anklet', name: "Dancer's Anklet", rarity: 'rare', stats: { spd: 0.05 }, effect: 'dodge_heal', desc: 'Dodging restores 5% HP.' }),
  R({ id: 'hourglass', name: 'Sandglass of Dawn', rarity: 'epic', stats: { spd: 0.04 }, effect: 'first_ap', desc: 'Starts battle with +2 AP.' }),
  R({ id: 'burst_prism', name: 'Burst Prism', rarity: 'epic', stats: {}, effect: 'burst', desc: 'Burst gauge fills 30% faster.' }),
  R({ id: 'aegis_locket', name: 'Aegis Locket', rarity: 'exotic', stats: { def: 0.05 }, effect: 'status_immune', desc: 'Immune to status effects.' }),
  R({ id: 'bramble_mail', name: 'Bramble Mail', rarity: 'rare', stats: { def: 0.05 }, effect: 'thorns', desc: 'Reflects 12% of damage taken.' }),
  R({ id: 'dawn_bell', name: 'Dawn Bell', rarity: 'epic', stats: { hp: 0.04 }, effect: 'shield', desc: 'Begins battle with a 15% HP shield.' }),
  R({ id: 'wind_step', name: 'Wind-Step Charm', rarity: 'rare', stats: { spd: 0.05 }, effect: 'first_speed', desc: 'Acts first on the opening turn more often.' }),
  R({ id: 'aether_well', name: 'Aether Wellspring', rarity: 'legendary', stats: { atk: 0.06, spd: 0.04 }, effect: 'ap_regen', desc: '30% chance each turn to gain +1 AP.' }),
  R({ id: 'cinder_brand', name: 'Cinder Brand', rarity: 'epic', stats: { atk: 0.03 }, effect: 'inflict_burn', desc: 'Hits may burn (12%).' }),
  R({ id: 'venom_ring', name: 'Venom Ring', rarity: 'epic', stats: { atk: 0.03 }, effect: 'inflict_poison', desc: 'Hits may poison (12%).' }),
  R({ id: 'frost_talisman', name: 'Frost Talisman', rarity: 'exotic', stats: { spd: 0.03 }, effect: 'inflict_freeze', desc: 'Hits may freeze (8%).' }),
  R({ id: 'dream_lantern', name: 'Dream Lantern', rarity: 'exotic', stats: { hp: 0.03 }, effect: 'inflict_sleep', desc: 'Hits may cause sleep (8%).' }),
  R({ id: 'crown_of_ages', name: 'Crown of Ages', rarity: 'legendary', stats: { hp: 0.08, atk: 0.08, def: 0.08, spd: 0.08 }, desc: '+8% to every stat.' }),
].map((r) => [r.id, r]));

export interface RelicInstance { uid: string; id: string; level: number }
export const relicScale = (level: number) => 1 + (level - 1) * 0.25;
export const RELIC_MAX_LEVEL = 5;
