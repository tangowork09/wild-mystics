// Summon banners. Everything is earnable in-game (Aether / tickets); rates are shown to the player.
import { SPECIES } from './species';
import { RELICS } from './relics';
import type { Rarity } from './traits';

export interface Banner { id: string; name: string; kind: 'mystic' | 'relic'; subtitle: string; featured?: string[]; art: string }

export const RATES: Record<Rarity, number> = { common: 0.55, rare: 0.3, epic: 0.114, exotic: 0.03, legendary: 0.006 };
export const PULL_COST = 100;
export const TEN_COST = 900;
export const SOFT_PITY = 62;
export const HARD_PITY = 80;
export const EPIC_PITY = 10;
export const ESSENCE_FOR_DUPE: Record<Rarity, number> = { common: 10, rare: 30, epic: 80, exotic: 200, legendary: 500 };

const LEGENDS = ['verdant_rex', 'ember_totem', 'deepcaller', 'mire_prince', 'dune_titan', 'storm_seraph'];

/** Featured banner rotates every week between the Guardian Spirits. */
export function featuredThisWeek(now = Date.now()): string {
  const week = Math.floor(now / (7 * 86400000));
  return LEGENDS[week % LEGENDS.length];
}

export function banners(now = Date.now()): Banner[] {
  const f = featuredThisWeek(now);
  return [
    { id: 'featured', name: `${SPECIES[f].name} Rising`, kind: 'mystic', subtitle: `Rate-up: ${SPECIES[f].name} is 50% of every Legendary result`, featured: [f], art: f },
    { id: 'standard', name: 'Wish of the Wilds', kind: 'mystic', subtitle: 'Every summonable Mystic. One free wish every day.', art: 'sporeking' },
    { id: 'relic', name: 'Relic Forge', kind: 'relic', subtitle: 'Charms and pictos for your Mystics', art: 'relic' },
  ];
}

export function mysticPool(r: Rarity): string[] {
  return Object.values(SPECIES).filter((s) => !s.boss && s.rarity === r).map((s) => s.id);
}
export function relicPool(r: Rarity): string[] {
  return Object.values(RELICS).filter((x) => x.rarity === r).map((x) => x.id);
}
