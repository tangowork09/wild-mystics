// Items: capture orbs, consumables, evolution stones, materials. Relics live in relics.ts.
import type { Element } from './elements';

export type OrbId = 'mystic' | 'radiant' | 'dusk' | 'tide' | 'ember' | 'astral';
export const ORBS: Record<OrbId, { name: string; mult: number; desc: string; price: number; color: string; band: string }> = {
  mystic: { name: 'Mystic Orb', mult: 1, desc: 'Standard binding orb.', price: 60, color: '#ff5a6a', band: '#ffe8a8' },
  radiant: { name: 'Radiant Orb', mult: 1.6, desc: '×1.6 capture chance.', price: 180, color: '#5ab4ff', band: '#ffe8a8' },
  dusk: { name: 'Dusk Orb', mult: 1, desc: '×2.5 at night and in Mistveil Marsh.', price: 200, color: '#5a3a8a', band: '#b89aff' },
  tide: { name: 'Tide Orb', mult: 1, desc: '×2.2 on Water and Storm Mystics.', price: 200, color: '#2aa8c8', band: '#bff0ff' },
  ember: { name: 'Ember Orb', mult: 1, desc: '×2.2 on Fire and Earth Mystics.', price: 200, color: '#e8542a', band: '#ffd08a' },
  astral: { name: 'Astral Orb', mult: 100, desc: 'Never fails. Summon-only.', price: 0, color: '#ffd76a', band: '#ffffff' },
};

export type ItemId =
  | 'tonic' | 'mega_tonic' | 'elixir' | 'ether' | 'cleanse' | 'wisdom_scroll' | 'lure_incense' | 'shimmer_incense' | 'hatch_charm'
  | 'fire_stone' | 'water_stone' | 'leaf_stone' | 'earth_stone' | 'thunder_stone' | 'wind_stone' | 'void_stone';

export interface ItemDef { name: string; desc: string; price: number; use: 'battle' | 'field' | 'both' | 'evolve' | 'passive'; icon: string }
export const ITEMS: Record<ItemId, ItemDef> = {
  tonic: { name: 'Tonic', desc: 'Restores 50% HP.', price: 45, use: 'both', icon: 'potion' },
  mega_tonic: { name: 'Mega Tonic', desc: 'Fully restores HP.', price: 140, use: 'both', icon: 'potion' },
  elixir: { name: 'Elixir', desc: 'Revives a fainted Mystic at 50% HP.', price: 150, use: 'both', icon: 'elixir' },
  ether: { name: 'Ether', desc: 'Restores 3 AP in battle.', price: 90, use: 'battle', icon: 'ether' },
  cleanse: { name: 'Cleansing Salt', desc: 'Cures any status effect.', price: 60, use: 'both', icon: 'salt' },
  wisdom_scroll: { name: 'Wisdom Scroll', desc: 'Raises a Mystic by one level.', price: 600, use: 'field', icon: 'scroll' },
  lure_incense: { name: 'Lure Incense', desc: 'Doubles encounter rate for 3 minutes.', price: 120, use: 'field', icon: 'incense' },
  shimmer_incense: { name: 'Shimmer Incense', desc: 'Triples shiny odds for 5 minutes.', price: 900, use: 'field', icon: 'incense' },
  hatch_charm: { name: 'Hatch Charm', desc: 'Eggs hatch twice as fast (passive).', price: 1500, use: 'passive', icon: 'egg' },
  fire_stone: { name: 'Fire Stone', desc: 'Evolves certain Mystics.', price: 800, use: 'evolve', icon: 'gem' },
  water_stone: { name: 'Water Stone', desc: 'Evolves certain Mystics.', price: 800, use: 'evolve', icon: 'gem' },
  leaf_stone: { name: 'Leaf Stone', desc: 'Evolves certain Mystics.', price: 800, use: 'evolve', icon: 'gem' },
  earth_stone: { name: 'Earth Stone', desc: 'Evolves certain Mystics.', price: 800, use: 'evolve', icon: 'gem' },
  thunder_stone: { name: 'Thunder Stone', desc: 'Evolves certain Mystics.', price: 800, use: 'evolve', icon: 'gem' },
  wind_stone: { name: 'Wind Stone', desc: 'Evolves certain Mystics.', price: 800, use: 'evolve', icon: 'gem' },
  void_stone: { name: 'Void Stone', desc: 'Evolves certain Mystics.', price: 1200, use: 'evolve', icon: 'gem' },
};

export const STONE_ELEMENT: Partial<Record<ItemId, Element>> = {
  fire_stone: 'fire', water_stone: 'water', leaf_stone: 'nature', earth_stone: 'earth', thunder_stone: 'storm', wind_stone: 'wind', void_stone: 'void',
};

export type MaterialId = 'wood' | 'stone' | 'ore' | 'crystal' | 'fiber';
export const MATERIALS: Record<MaterialId, { name: string; color: string; icon: string }> = {
  wood: { name: 'Timber', color: '#b07a4a', icon: 'wood' },
  stone: { name: 'Stone', color: '#a8a4a0', icon: 'stone' },
  ore: { name: 'Ore', color: '#c8964e', icon: 'ore' },
  crystal: { name: 'Crystal', color: '#b57aff', icon: 'crystal' },
  fiber: { name: 'Fiber', color: '#8ac45a', icon: 'fiber' },
};
