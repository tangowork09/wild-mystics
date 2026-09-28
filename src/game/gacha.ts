// Summoning logic with soft/hard pity and a guaranteed Epic every 10 pulls.
import { RATES, SOFT_PITY, HARD_PITY, EPIC_PITY, ESSENCE_FOR_DUPE, mysticPool, relicPool, banners, type Banner } from '../data/gacha';
import { RARITY_ORDER, type Rarity } from '../data/traits';
import { SPECIES } from '../data/species';
import { createCreature, newUid, type Creature } from './creature';
import { state, addCreature, save, isCaught } from './state';
import { emit } from './events';
import { pick } from '../core/noise';

export interface PullResult { rarity: Rarity; creature?: Creature; relic?: string; dupe?: boolean; essence?: number; isNew?: boolean }

function rollRarity(): Rarity {
  const g = state.gacha;
  if (g.pity + 1 >= HARD_PITY) return 'legendary';
  let legendRate = RATES.legendary;
  if (g.pity + 1 > SOFT_PITY) legendRate += (g.pity + 1 - SOFT_PITY) * 0.06;
  const r = Math.random();
  if (r < legendRate) return 'legendary';
  let acc = legendRate;
  for (const tier of ['exotic', 'epic', 'rare'] as Rarity[]) {
    acc += RATES[tier];
    if (r < acc) return tier;
  }
  return g.pityEpic + 1 >= EPIC_PITY ? 'epic' : 'common';
}

function levelForSummon() {
  const lv = state.team.length ? Math.round(state.team.reduce((a, c) => a + c.level, 0) / state.team.length) : 5;
  return Math.max(5, lv - 2);
}

export function canAfford(count: 1 | 10, useTickets: boolean) {
  if (useTickets) return state.inv.tickets >= count;
  return state.inv.aether >= (count === 1 ? 100 : 900);
}
export const freeWishAvailable = () => state.gacha.lastFree !== new Date().toISOString().slice(0, 10);

export function summon(banner: Banner, count: 1 | 10, pay: 'aether' | 'ticket' | 'free'): PullResult[] | null {
  if (pay === 'free') {
    if (!freeWishAvailable() || count !== 1) return null;
    state.gacha.lastFree = new Date().toISOString().slice(0, 10);
  } else if (pay === 'ticket') {
    if (state.inv.tickets < count) return null;
    state.inv.tickets -= count;
  } else {
    const cost = count === 1 ? 100 : 900;
    if (state.inv.aether < cost) return null;
    state.inv.aether -= cost;
  }
  const out: PullResult[] = [];
  let sawRarePlus = false;
  for (let i = 0; i < count; i++) {
    let rarity = rollRarity();
    if (count === 10 && i === 9 && !sawRarePlus && rarity === 'common') rarity = 'rare';
    if (rarity !== 'common') sawRarePlus = true;
    const g = state.gacha;
    g.pulls++;
    g.pity = rarity === 'legendary' ? 0 : g.pity + 1;
    g.pityEpic = RARITY_ORDER.indexOf(rarity) >= 2 ? 0 : g.pityEpic + 1;
    if (banner.kind === 'relic') {
      const id = pick(relicPool(rarity).length ? relicPool(rarity) : relicPool('rare'));
      state.relics.push({ uid: newUid(), id, level: 1 });
      out.push({ rarity, relic: id });
      g.history.unshift({ at: Date.now(), relic: id, rarity });
    } else {
      let pool = mysticPool(rarity);
      if (rarity === 'legendary' && banner.featured?.length && Math.random() < 0.5) pool = banner.featured;
      if (!pool.length) pool = mysticPool('rare');
      const species = pick(pool);
      const wasCaught = isCaught(species);
      const c = createCreature(species, levelForSummon(), { shiny: Math.random() < 1 / 64, caught: { at: Date.now(), how: 'summon' } });
      addCreature(c);
      const essence = wasCaught ? ESSENCE_FOR_DUPE[SPECIES[species].rarity] : 0;
      state.inv.essence += essence;
      out.push({ rarity, creature: c, dupe: wasCaught, essence, isNew: !wasCaught });
      g.history.unshift({ at: Date.now(), species, rarity });
    }
    if (g.history.length > 100) g.history.length = 100;
  }
  emit('summon', { rarity: out.reduce((best, r) => (RARITY_ORDER.indexOf(r.rarity) > RARITY_ORDER.indexOf(best) ? r.rarity : best), 'common' as Rarity), count });
  save();
  return out;
}

export { banners };

/** Awakening: raise stars with Mystic Essence (duplicates convert to essence automatically). */
export const awakenCost = (stars: number) => 60 * (stars + 1) * (stars + 1);
export function awaken(c: Creature) {
  const cost = awakenCost(c.stars);
  if (c.stars >= 5 || state.inv.essence < cost) return false;
  state.inv.essence -= cost;
  c.stars++;
  save();
  return true;
}
