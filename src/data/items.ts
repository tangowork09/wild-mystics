// Items: capture orbs, consumables, evolution stones, incense, travel, bait, treats, gifts, gear,
// key items and materials. Relics live in relics.ts; shop stock lives in shops.ts.
//
// Every item carries an `effect` descriptor. Battle and field code should apply items through it
// (see src/game/items.ts → `battleItemEffect` / `useFieldItem`) instead of switching on ids.
// Battle effects only use the kinds battle.ts already supports: heal, revive, ap, cure.
import type { Element } from './elements';
import type { StatusId } from './traits';

// ── Binding orbs ────────────────────────────────────────────────────────────
// `mult` is the plain capture multiplier; dusk/tide/ember get their situational bonus in battle.ts.
export type OrbId = 'mystic' | 'radiant' | 'grand' | 'sovereign' | 'dusk' | 'tide' | 'ember' | 'astral';
export const ORBS: Record<OrbId, { name: string; mult: number; desc: string; price: number; color: string; band: string }> = {
  mystic: { name: 'Mystic Orb', mult: 1, desc: 'Standard binding orb.', price: 60, color: '#ff5a6a', band: '#ffe8a8' },
  radiant: { name: 'Radiant Orb', mult: 1.6, desc: '×1.6 capture chance.', price: 180, color: '#5ab4ff', band: '#ffe8a8' },
  grand: { name: 'Grand Orb', mult: 2.2, desc: '×2.2 capture chance. Wayfarers’ favourite.', price: 420, color: '#3ad0a0', band: '#fff4c8' },
  sovereign: { name: 'Sovereign Orb', mult: 3, desc: '×3 capture chance. Forged with Guardian light.', price: 1100, color: '#c89aff', band: '#ffd76a' },
  dusk: { name: 'Dusk Orb', mult: 1, desc: '×2.5 at night and in Mistveil Marsh.', price: 200, color: '#5a3a8a', band: '#b89aff' },
  tide: { name: 'Tide Orb', mult: 1, desc: '×2.2 on Water and Storm Mystics.', price: 200, color: '#2aa8c8', band: '#bff0ff' },
  ember: { name: 'Ember Orb', mult: 1, desc: '×2.2 on Fire and Earth Mystics.', price: 200, color: '#e8542a', band: '#ffd08a' },
  astral: { name: 'Astral Orb', mult: 100, desc: 'Never fails. Summon-only.', price: 0, color: '#ffd76a', band: '#ffffff' },
};
export const ORB_IDS = Object.keys(ORBS) as OrbId[];

// ── Items ───────────────────────────────────────────────────────────────────
export type ItemId =
  // restoratives (battle + field)
  | 'tonic' | 'super_tonic' | 'mega_tonic' | 'elixir' | 'phoenix_ash' | 'ether' | 'hyper_ether'
  // cures
  | 'cleanse' | 'antidote' | 'burn_salve' | 'wake_bell' | 'thaw_drop' | 'spark_balm' | 'clarity_mint'
  // growth
  | 'wisdom_scroll' | 'berry_treat' | 'star_candy'
  // incense
  | 'lure_incense' | 'shimmer_incense' | 'ward_incense'
  // travel & field
  | 'escape_shard' | 'oasis_water'
  // bait
  | 'worm_bait' | 'glow_bait'
  // gifts (NPC deliveries & favours)
  | 'honey_cake' | 'meadow_posy' | 'sea_glass' | 'marsh_tea' | 'ember_pepper' | 'moon_lily' | 'desert_rose' | 'snow_bloom' | 'geode_candy'
  // charms & gear (passive while carried)
  | 'hatch_charm' | 'tide_charm' | 'explorer_lantern' | 'dowsing_rod' | 'nomad_cloak'
  // evolution stones
  | 'fire_stone' | 'water_stone' | 'leaf_stone' | 'earth_stone' | 'thunder_stone' | 'wind_stone' | 'void_stone'
  // key items: Guardian sigils
  | 'sigil_vale' | 'sigil_lakes' | 'sigil_coast' | 'sigil_marsh' | 'sigil_scar' | 'sigil_elder' | 'sigil_dunes' | 'sigil_peaks' | 'sigil_hollows'
  // key items: dungeon keys
  | 'rootway_key' | 'chapel_bell' | 'smuggler_map' | 'moon_lantern' | 'forge_brand' | 'heartwood_seed' | 'sun_scarab' | 'glacier_key' | 'tuning_shard' | 'warden_key' | 'star_chart'
  // quest items
  | 'veil_mask' | 'lens_crystal' | 'glowcap' | 'letter_bundle' | 'lost_locket' | 'reed_bundle' | 'bell_clapper' | 'oasis_seed' | 'crown_shard';

export type ItemUse = 'battle' | 'field' | 'both' | 'evolve' | 'passive' | 'key' | 'gift';
export type ItemCategory = 'restore' | 'cure' | 'growth' | 'incense' | 'travel' | 'bait' | 'gift' | 'gear' | 'stone' | 'sigil' | 'key' | 'quest';
export type BuffId = 'lure' | 'shimmer' | 'ward';

export type ItemEffect =
  | { kind: 'heal'; pct: number; all?: boolean }
  | { kind: 'revive'; pct: number }
  | { kind: 'ap'; n: number }
  | { kind: 'cure'; status?: StatusId }
  | { kind: 'level'; n: number }
  | { kind: 'xp'; n: number }
  | { kind: 'buff'; buff: BuffId; ms: number }
  | { kind: 'warp' }
  | { kind: 'bait'; bonus: number }
  | { kind: 'evolve'; element: Element }
  | { kind: 'passive'; id: string }
  | { kind: 'none' };

export interface ItemDef {
  name: string;
  desc: string;
  /** Buy price in gold (0 = never sold). Sell price is half unless `sell` says otherwise. */
  price: number;
  use: ItemUse;
  icon: string;
  category: ItemCategory;
  effect: ItemEffect;
  /** Override sell price; false = can't be sold (key items). */
  sell?: number | false;
  /** Only one can be owned (charms, gear, keys). */
  unique?: boolean;
}

const I = (d: ItemDef) => d;
const KEY = (name: string, desc: string, icon = 'key'): ItemDef => ({ name, desc, price: 0, use: 'key', icon, category: 'key', effect: { kind: 'none' }, sell: false, unique: true });
const SIGIL = (land: string, desc: string): ItemDef => ({ name: `${land} Sigil`, desc, price: 0, use: 'key', icon: 'crown', category: 'sigil', effect: { kind: 'none' }, sell: false, unique: true });
const QUEST = (name: string, desc: string, icon = 'scroll'): ItemDef => ({ name, desc, price: 0, use: 'key', icon, category: 'quest', effect: { kind: 'none' }, sell: false });
const GIFT = (name: string, desc: string, price: number, icon = 'gift'): ItemDef => ({ name, desc, price, use: 'gift', icon, category: 'gift', effect: { kind: 'none' } });
const STONE = (el: Element, name: string, price = 800): ItemDef => ({ name, desc: 'Evolves certain Mystics.', price, use: 'evolve', icon: 'gem', category: 'stone', effect: { kind: 'evolve', element: el } });

export const ITEMS: Record<ItemId, ItemDef> = {
  // restoratives
  tonic: I({ name: 'Tonic', desc: 'Restores 50% HP.', price: 45, use: 'both', icon: 'potion', category: 'restore', effect: { kind: 'heal', pct: 0.5 } }),
  super_tonic: I({ name: 'Super Tonic', desc: 'Restores 75% HP.', price: 95, use: 'both', icon: 'potion', category: 'restore', effect: { kind: 'heal', pct: 0.75 } }),
  mega_tonic: I({ name: 'Mega Tonic', desc: 'Fully restores HP.', price: 140, use: 'both', icon: 'potion', category: 'restore', effect: { kind: 'heal', pct: 1 } }),
  elixir: I({ name: 'Elixir', desc: 'Revives a fainted Mystic at 50% HP.', price: 150, use: 'both', icon: 'elixir', category: 'restore', effect: { kind: 'revive', pct: 0.5 } }),
  phoenix_ash: I({ name: 'Phoenix Ash', desc: 'Revives a fainted Mystic at full HP.', price: 520, use: 'both', icon: 'elixir', category: 'restore', effect: { kind: 'revive', pct: 1 } }),
  ether: I({ name: 'Ether', desc: 'Restores 3 AP in battle.', price: 90, use: 'battle', icon: 'ether', category: 'restore', effect: { kind: 'ap', n: 3 } }),
  hyper_ether: I({ name: 'Hyper Ether', desc: 'Restores 6 AP in battle.', price: 240, use: 'battle', icon: 'ether', category: 'restore', effect: { kind: 'ap', n: 6 } }),
  // cures
  cleanse: I({ name: 'Cleansing Salt', desc: 'Cures any status effect.', price: 60, use: 'both', icon: 'salt', category: 'cure', effect: { kind: 'cure' } }),
  antidote: I({ name: 'Antidote', desc: 'Cures poison.', price: 25, use: 'battle', icon: 'herb', category: 'cure', effect: { kind: 'cure', status: 'poison' } }),
  burn_salve: I({ name: 'Burn Salve', desc: 'Cures burns.', price: 25, use: 'battle', icon: 'herb', category: 'cure', effect: { kind: 'cure', status: 'burn' } }),
  wake_bell: I({ name: 'Wake Bell', desc: 'Wakes a sleeping Mystic.', price: 25, use: 'battle', icon: 'music_note', category: 'cure', effect: { kind: 'cure', status: 'sleep' } }),
  thaw_drop: I({ name: 'Thaw Drop', desc: 'Thaws a frozen Mystic.', price: 25, use: 'battle', icon: 'water_drop', category: 'cure', effect: { kind: 'cure', status: 'freeze' } }),
  spark_balm: I({ name: 'Spark Balm', desc: 'Cures paralysis.', price: 30, use: 'battle', icon: 'herb', category: 'cure', effect: { kind: 'cure', status: 'paralyze' } }),
  clarity_mint: I({ name: 'Clarity Mint', desc: 'Snaps a Mystic out of confusion.', price: 30, use: 'battle', icon: 'leaf', category: 'cure', effect: { kind: 'cure', status: 'confuse' } }),
  // growth
  wisdom_scroll: I({ name: 'Wisdom Scroll', desc: 'Raises a Mystic by one level.', price: 600, use: 'field', icon: 'scroll', category: 'growth', effect: { kind: 'level', n: 1 } }),
  berry_treat: I({ name: 'Berry Treat', desc: 'A snack Mystics adore. Grants 60 XP.', price: 40, use: 'field', icon: 'herb', category: 'growth', effect: { kind: 'xp', n: 60 } }),
  star_candy: I({ name: 'Star Candy', desc: 'Tastes like a shooting star. Grants 400 XP.', price: 380, use: 'field', icon: 'star', category: 'growth', effect: { kind: 'xp', n: 400 } }),
  // incense
  lure_incense: I({ name: 'Lure Incense', desc: 'Doubles encounter rate for 3 minutes.', price: 120, use: 'field', icon: 'incense', category: 'incense', effect: { kind: 'buff', buff: 'lure', ms: 180_000 } }),
  shimmer_incense: I({ name: 'Shimmer Incense', desc: 'Triples shiny odds for 5 minutes.', price: 900, use: 'field', icon: 'incense', category: 'incense', effect: { kind: 'buff', buff: 'shimmer', ms: 300_000 } }),
  ward_incense: I({ name: 'Ward Incense', desc: 'Keeps tall-grass ambushes away for 3 minutes.', price: 80, use: 'field', icon: 'incense', category: 'incense', effect: { kind: 'buff', buff: 'ward', ms: 180_000 } }),
  // travel & field
  escape_shard: I({ name: 'Escape Shard', desc: 'Crush it to warp back to the last town you rested in.', price: 150, use: 'field', icon: 'portal', category: 'travel', effect: { kind: 'warp' } }),
  oasis_water: I({ name: 'Oasis Water', desc: 'Restores 30% HP to your whole team.', price: 160, use: 'field', icon: 'water_drop', category: 'restore', effect: { kind: 'heal', pct: 0.3, all: true } }),
  // bait (used automatically when you cast a line)
  worm_bait: I({ name: 'Worm Bait', desc: 'Used when fishing: Mystics bite more often.', price: 20, use: 'passive', icon: 'fish', category: 'bait', effect: { kind: 'bait', bonus: 0.15 } }),
  glow_bait: I({ name: 'Glow Bait', desc: 'Used when fishing: Mystics almost always bite.', price: 70, use: 'passive', icon: 'fish', category: 'bait', effect: { kind: 'bait', bonus: 0.3 } }),
  // gifts
  honey_cake: GIFT('Honey Cake', 'Bramble’s best. Everyone in Hearthwick has an opinion on it.', 35),
  meadow_posy: GIFT('Meadow Posy', 'Wildflowers from the Vale, tied with grass.', 20, 'plant'),
  sea_glass: GIFT('Sea Glass', 'Smooth green glass the tide polished for a hundred years.', 40, 'gem'),
  marsh_tea: GIFT('Marsh Tea', 'Smells of rain and peat. Tastes better than it smells.', 30, 'herb'),
  ember_pepper: GIFT('Ember Pepper', 'So hot it glows faintly in the dark.', 30, 'fire_flame'),
  moon_lily: GIFT('Moon Lily', 'Only opens at night. Keeps its glow for a week.', 55, 'plant'),
  desert_rose: GIFT('Desert Rose', 'A flower of crystal sand. It never wilts.', 60, 'crystal'),
  snow_bloom: GIFT('Snow Bloom', 'A frost-white flower from the high passes.', 60, 'snowflake'),
  geode_candy: GIFT('Geode Candy', 'Glimmerhold’s sugar crystals. Rock-hard, very sweet.', 45, 'crystal'),
  // charms & gear
  hatch_charm: I({ name: 'Hatch Charm', desc: 'Eggs hatch twice as fast while carried.', price: 1500, use: 'passive', icon: 'egg', category: 'gear', effect: { kind: 'passive', id: 'hatch' }, unique: true }),
  tide_charm: I({ name: 'Tide Charm', desc: 'While carried, Mystics bite 10% more often when fishing.', price: 900, use: 'passive', icon: 'water_drop', category: 'gear', effect: { kind: 'passive', id: 'tide' }, unique: true }),
  explorer_lantern: I({ name: 'Explorer’s Lantern', desc: 'While carried, you chart the map in a wider circle.', price: 1200, use: 'passive', icon: 'sun', category: 'gear', effect: { kind: 'passive', id: 'lantern' }, unique: true }),
  dowsing_rod: I({ name: 'Dowsing Rod', desc: 'While carried, hidden entrances reveal themselves when you draw near.', price: 2400, use: 'passive', icon: 'compass', category: 'gear', effect: { kind: 'passive', id: 'dowsing' }, unique: true }),
  nomad_cloak: I({ name: 'Nomad Cloak', desc: 'While worn, roaming Mystics can’t ambush you — only you start the fight.', price: 2800, use: 'passive', icon: 'shield', category: 'gear', effect: { kind: 'passive', id: 'cloak' }, unique: true }),
  // evolution stones
  fire_stone: STONE('fire', 'Fire Stone'),
  water_stone: STONE('water', 'Water Stone'),
  leaf_stone: STONE('nature', 'Leaf Stone'),
  earth_stone: STONE('earth', 'Earth Stone'),
  thunder_stone: STONE('storm', 'Thunder Stone'),
  wind_stone: STONE('wind', 'Wind Stone'),
  void_stone: STONE('void', 'Void Stone', 1200),
  // Guardian sigils
  sigil_vale: SIGIL('Verdant', 'Given by Thornjaw Rex. Smells of cut grass and thunder.'),
  sigil_lakes: SIGIL('Mirror', 'Given by the Guardian of the Mirror Lakes. Cold as deep water.'),
  sigil_coast: SIGIL('Tide', 'Given by the Guardian of the Sapphire Coast. It hums like a sunken bell.'),
  sigil_marsh: SIGIL('Lantern', 'Given by the Bog Sovereign. A tiny flame lives inside.'),
  sigil_scar: SIGIL('Cinder', 'Given by the Ashen Totem. Warm to the touch, always.'),
  sigil_elder: SIGIL('Heartwood', 'Given by the Guardian of the Elderwood. Rings of age circle its face.'),
  sigil_dunes: SIGIL('Sunstone', 'Given by the Sandjaw Colossus. Sand runs through it like an hourglass.'),
  sigil_peaks: SIGIL('Storm', 'Given by the Stormcrown. Sparks crawl over it on cloudy days.'),
  sigil_hollows: SIGIL('Glimmer', 'Given by the Guardian of the Hollows. It glows in the dark.'),
  // dungeon keys
  rootway_key: KEY('Rootway Key', 'A key grown, not forged. It opens Rootway Burrow’s inner door.'),
  chapel_bell: KEY('Chapel Bell', 'A little bell from the Drowned Chapel. It rings underwater.', 'music_note'),
  smuggler_map: KEY('Smuggler’s Map', 'Marks a cove no honest sailor uses.', 'map'),
  moon_lantern: KEY('Moon Lantern', 'Shows doors that only exist by moonlight.', 'moon'),
  forge_brand: KEY('Forge Brand', 'The mark of the old smiths. The Magma Forge obeys it.', 'anvil'),
  heartwood_seed: KEY('Heartwood Seed', 'The Elder Tree’s own seed. The forest trusts whoever carries it.', 'leaf'),
  sun_scarab: KEY('Sun Scarab', 'A golden beetle that fits a lock in the Tomb of Sands.', 'sun'),
  glacier_key: KEY('Glacier Key', 'Ice that never melts, cut in the shape of a key.', 'snowflake'),
  tuning_shard: KEY('Tuning Shard', 'Sings the same note as the Geode Heart.', 'crystal'),
  warden_key: KEY('Sky Warden’s Key', 'The last Warden’s key to the Aether Sanctum.', 'crown'),
  star_chart: KEY('Star Chart', 'Plots where a star fell into the sea off the Sapphire Coast.', 'star'),
  // quest items
  veil_mask: QUEST('Veil Mask', 'A porcelain mask of the Hollow Veil. Cold, and too light.', 'void_eye'),
  lens_crystal: QUEST('Lens Crystal', 'The heart of Tidewatch Light. It wants to shine.', 'crystal'),
  glowcap: QUEST('Glowcap', 'A marsh mushroom that glows when it dreams.', 'plant'),
  letter_bundle: QUEST('Bundle of Letters', 'Postmistress Ada’s letters, tied with blue ribbon.', 'scroll'),
  lost_locket: QUEST('Silver Locket', 'Engraved: “Come home when the lanterns are lit.”', 'gem'),
  reed_bundle: QUEST('Reed Bundle', 'Supple lake reeds, perfect for boat-weaving.', 'fiber'),
  bell_clapper: QUEST('Bell Clapper', 'The iron tongue of Skyhold’s great bell.', 'music_note'),
  oasis_seed: QUEST('Oasis Seed', 'A palm seed that remembers rain.', 'leaf'),
  crown_shard: QUEST('Crown Shard', 'A splinter of the Stormcrown’s halo, still crackling.', 'lightning_bolt'),
};
export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

export const STONE_ELEMENT: Partial<Record<ItemId, Element>> = {
  fire_stone: 'fire', water_stone: 'water', leaf_stone: 'nature', earth_stone: 'earth', thunder_stone: 'storm', wind_stone: 'wind', void_stone: 'void',
};

/** The sigil each Guardian leaves behind (region id → key item). */
export const SIGILS: Record<string, ItemId> = {
  vale: 'sigil_vale', lakes: 'sigil_lakes', coast: 'sigil_coast', marsh: 'sigil_marsh', scar: 'sigil_scar',
  elder: 'sigil_elder', dunes: 'sigil_dunes', peaks: 'sigil_peaks', hollows: 'sigil_hollows',
};

export type MaterialId = 'wood' | 'stone' | 'ore' | 'crystal' | 'fiber';
export const MATERIALS: Record<MaterialId, { name: string; color: string; icon: string }> = {
  wood: { name: 'Timber', color: '#b07a4a', icon: 'wood' },
  stone: { name: 'Stone', color: '#a8a4a0', icon: 'stone' },
  ore: { name: 'Ore', color: '#c8964e', icon: 'ore' },
  crystal: { name: 'Crystal', color: '#b57aff', icon: 'crystal' },
  fiber: { name: 'Fiber', color: '#8ac45a', icon: 'fiber' },
};

export const isItemId = (id: string): id is ItemId => id in ITEMS;
export const isOrbId = (id: string): id is OrbId => id in ORBS;
