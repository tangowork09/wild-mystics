// Item effects. Field use (bag), battle effect lookup, bait and gear passives.
//
// Integration: the bag UI should call `useFieldItem(id, creature)` for every usable item, and
// battle code can apply `battleItemEffect(id)` generically (kinds: heal / revive / ap / cure — the
// same kinds battle.ts already implements for tonic, mega_tonic, elixir, ether and cleanse).
import { ITEMS, type ItemEffect, type ItemId } from '../data/items';
import { statsOf, grantXp, xpToNext, displayName, type Creature } from './creature';
import { state, save, addItem, itemCount } from './state';

export const BATTLE_KINDS = new Set<ItemEffect['kind']>(['heal', 'revive', 'ap', 'cure']);

/** The effect an item has when used in battle, or null if it can't be used there. */
export function battleItemEffect(id: ItemId): ItemEffect | null {
  const d = ITEMS[id];
  if (!d || (d.use !== 'battle' && d.use !== 'both')) return null;
  if (d.effect.kind === 'heal' && d.effect.all) return null;
  return BATTLE_KINDS.has(d.effect.kind) ? d.effect : null;
}
export const battleItems = () => (Object.keys(ITEMS) as ItemId[]).filter((id) => battleItemEffect(id) && itemCount(id) > 0);

/** Can the bag use this item right now (and does it need a target Mystic)? */
export function fieldUse(id: ItemId): { usable: boolean; needsTarget: boolean } {
  const d = ITEMS[id];
  if (!d || !(d.use === 'field' || d.use === 'both')) return { usable: false, needsTarget: false };
  const k = d.effect.kind;
  if (k === 'buff' || k === 'warp' || (k === 'heal' && d.effect.all)) return { usable: true, needsTarget: false };
  if (k === 'heal' || k === 'revive' || k === 'level' || k === 'xp') return { usable: true, needsTarget: true };
  return { usable: false, needsTarget: false };
}

/** Is `c` a sensible target for this item (for pickers)? */
export function canUseOn(id: ItemId, c: Creature): boolean {
  const e = ITEMS[id]?.effect;
  if (!e) return false;
  const max = statsOf(c).maxHp;
  if (e.kind === 'heal') return c.hp > 0 && c.hp < max;
  if (e.kind === 'revive') return c.hp < max;
  if (e.kind === 'level' || e.kind === 'xp') return c.level < 60;
  return false;
}

type Warp = () => Promise<boolean> | boolean;
let warp: Warp = () => false;
/** main.ts registers how an Escape Shard gets you home. */
export function setWarpHandler(w: Warp) { warp = w; }

/** Use an item outside battle. Consumes it only when it worked. */
export async function useFieldItem(id: ItemId, target?: Creature): Promise<{ ok: boolean; msg: string }> {
  const d = ITEMS[id];
  if (!d || itemCount(id) <= 0) return { ok: false, msg: 'You don’t have one.' };
  const e = d.effect;
  const done = (msg: string) => { addItem(id, -1); save(); return { ok: true, msg }; };
  switch (e.kind) {
    case 'buff': {
      state.buffs[e.buff] = Date.now() + e.ms;
      const mins = Math.round(e.ms / 60000);
      return done(e.buff === 'lure' ? `Lure Incense lit — encounters doubled for ${mins} minutes.` : e.buff === 'shimmer' ? `Shimmer Incense lit — shiny odds tripled for ${mins} minutes!` : `Ward Incense lit — tall grass stays quiet for ${mins} minutes.`);
    }
    case 'warp': {
      const ok = await warp();
      return ok ? done('The shard crumbles to light, and you are home.') : { ok: false, msg: 'The shard won’t work here.' };
    }
    case 'heal': {
      if (e.all) {
        let healed = 0;
        for (const c of state.team) { const max = statsOf(c).maxHp; if (c.hp > 0 && c.hp < max) { c.hp = Math.min(max, c.hp + Math.round(max * e.pct)); healed++; } }
        return healed ? done(`Your team feels refreshed (${healed} healed).`) : { ok: false, msg: 'Everyone is already healthy.' };
      }
      if (!target || !canUseOn(id, target)) return { ok: false, msg: 'Choose a hurt Mystic.' };
      const max = statsOf(target).maxHp;
      target.hp = Math.min(max, target.hp + Math.round(max * e.pct));
      return done(`${displayName(target)} recovered.`);
    }
    case 'revive': {
      if (!target || !canUseOn(id, target)) return { ok: false, msg: 'Choose a Mystic.' };
      const max = statsOf(target).maxHp;
      target.hp = target.hp <= 0 ? Math.round(max * e.pct) : max;
      return done(`${displayName(target)} is back on their feet.`);
    }
    case 'level': {
      if (!target || !canUseOn(id, target)) return { ok: false, msg: 'Choose a Mystic.' };
      for (let i = 0; i < e.n; i++) grantXp(target, xpToNext(target.level) - target.xp);
      return done(`${displayName(target)}’s XP bar is full: train it in Team → Train!`);
    }
    case 'xp': {
      if (!target || !canUseOn(id, target)) return { ok: false, msg: 'Choose a Mystic.' };
      const before = target.level;
      grantXp(target, e.n);
      return done(target.level > before ? `${displayName(target)} gobbled it up and grew to level ${target.level}!` : `${displayName(target)} gobbled it up. +${e.n} XP.`);
    }
    default:
      return { ok: false, msg: 'That can’t be used here.' };
  }
}

/** Fishing: burn the best bait you carry. Returns the extra bite chance (bait + Tide Charm). */
export function useBait(): number {
  let bonus = itemCount('tide_charm') > 0 ? 0.1 : 0;
  for (const b of ['glow_bait', 'worm_bait'] as ItemId[]) {
    if (itemCount(b) > 0) {
      const e = ITEMS[b].effect;
      addItem(b, -1);
      bonus += e.kind === 'bait' ? e.bonus : 0;
      break;
    }
  }
  return bonus;
}

/** Ward Incense: tall-grass ambushes stay away while it burns. */
export const wardActive = () => (state.buffs.ward ?? 0) > Date.now();
/** Nomad Cloak: roaming Mystics can't start battles by touching you. */
export const cloakWorn = () => itemCount('nomad_cloak') > 0;
