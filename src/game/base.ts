// Homestead: placement rules, production, habitats, training and crafting.
import { STRUCTURES, structureDef, PRODUCTION_CAP_HOURS, type StructureDef } from '../data/structures';
import { HOMESTEAD } from '../data/zones';
import type { MaterialId, OrbId } from '../data/items';
import { newUid, grantXp, type Creature } from './creature';
import { state, save, type BaseStructure } from './state';
import { emit } from './events';

export const builtCount = (id: string) => state.base.structures.filter((s) => s.type === id).length;

export function costOf(def: StructureDef, level = 1): Partial<Record<MaterialId | 'gold', number>> {
  const m = Math.pow(def.upgradeMult, level - 1);
  return Object.fromEntries(Object.entries(def.cost).map(([k, v]) => [k, Math.round((v ?? 0) * m)]));
}

export function canPay(cost: Partial<Record<MaterialId | 'gold', number>>) {
  return Object.entries(cost).every(([k, v]) => (k === 'gold' ? state.inv.gold : state.inv.materials[k as MaterialId]) >= (v ?? 0));
}
function pay(cost: Partial<Record<MaterialId | 'gold', number>>) {
  for (const [k, v] of Object.entries(cost)) {
    if (k === 'gold') state.inv.gold -= v ?? 0;
    else state.inv.materials[k as MaterialId] -= v ?? 0;
  }
}

export function placementValid(type: string, x: number, z: number, ignoreUid?: string): string | null {
  const def = structureDef(type);
  const d = Math.hypot(x - HOMESTEAD.center[0], z - HOMESTEAD.center[1]);
  if (d + def.radius > HOMESTEAD.radius) return 'Outside your homestead';
  for (const s of state.base.structures) {
    if (s.uid === ignoreUid) continue;
    const o = structureDef(s.type);
    if (Math.hypot(s.x - x, s.z - z) < o.radius + def.radius - 0.2) return 'Too close to another structure';
  }
  return null;
}

export function buildReason(def: StructureDef): string | null {
  if (builtCount(def.id) >= def.max) return `Limit reached (${def.max})`;
  if (def.rankReq && state.rank.level < def.rankReq) return `Requires Wayfarer Rank ${def.rankReq}`;
  if (!canPay(costOf(def))) return 'Not enough materials';
  return null;
}

export function build(type: string, x: number, z: number, rot: number): BaseStructure | null {
  const def = structureDef(type);
  if (buildReason(def) || placementValid(type, x, z)) return null;
  pay(costOf(def));
  const s: BaseStructure = { uid: newUid(), type, x, z, rot, level: 1, lastCollect: Date.now(), assigned: [] };
  state.base.structures.push(s);
  emit('build', { type });
  save();
  return s;
}

export function move(uid: string, x: number, z: number, rot: number) {
  const s = state.base.structures.find((b) => b.uid === uid);
  if (!s || placementValid(s.type, x, z, uid)) return false;
  s.x = x; s.z = z; s.rot = rot;
  save();
  return true;
}

export function demolish(uid: string) {
  const i = state.base.structures.findIndex((b) => b.uid === uid);
  if (i < 0) return;
  const s = state.base.structures[i];
  const refund = costOf(structureDef(s.type), 1);
  for (const [k, v] of Object.entries(refund)) {
    const half = Math.floor((v ?? 0) * 0.5);
    if (k === 'gold') state.inv.gold += half; else state.inv.materials[k as MaterialId] += half;
  }
  state.base.structures.splice(i, 1);
  save();
}

export function upgrade(uid: string) {
  const s = state.base.structures.find((b) => b.uid === uid);
  if (!s) return false;
  const def = structureDef(s.type);
  if (s.level >= def.maxLevel) return false;
  const cost = costOf(def, s.level + 1);
  if (!canPay(cost)) return false;
  collect(uid);
  pay(cost);
  s.level++;
  save();
  return true;
}

/** Pending production for a structure (capped). */
export function pending(s: BaseStructure): Partial<Record<MaterialId | 'gold' | 'aether', number>> {
  const def = structureDef(s.type);
  if (!def.produces) return {};
  const hours = Math.min(PRODUCTION_CAP_HOURS, (Date.now() - s.lastCollect) / 3600000);
  const lvl = 1 + (s.level - 1) * 0.6;
  return Object.fromEntries(Object.entries(def.produces).map(([k, v]) => [k, Math.floor((v ?? 0) * hours * lvl)]));
}

export function collect(uid: string) {
  const s = state.base.structures.find((b) => b.uid === uid);
  if (!s) return {};
  const got = pending(s);
  for (const [k, v] of Object.entries(got)) {
    if (!v) continue;
    if (k === 'gold') state.inv.gold += v;
    else if (k === 'aether') state.inv.aether += v;
    else state.inv.materials[k as MaterialId] += v;
  }
  s.lastCollect = Date.now();
  // habitat XP for residents
  if (s.type === 'habitat') tickHabitat(s);
  save();
  return got;
}

export function collectAll() {
  const total: Record<string, number> = {};
  for (const s of state.base.structures) for (const [k, v] of Object.entries(collect(s.uid))) total[k] = (total[k] ?? 0) + (v ?? 0);
  return total;
}

export const habitatSlots = (s: BaseStructure) => (structureDef(s.type).slots ?? 0) * s.level;
export function residents(s: BaseStructure): Creature[] {
  return s.assigned.map((uid) => state.box.find((c) => c.uid === uid)).filter((c): c is Creature => !!c);
}
function tickHabitat(s: BaseStructure) {
  const last = (s as BaseStructure & { lastXp?: number }).lastXp ?? s.lastCollect;
  const hours = Math.min(PRODUCTION_CAP_HOURS, (Date.now() - last) / 3600000);
  for (const c of residents(s)) grantXp(c, Math.floor(80 * hours * s.level));
  (s as BaseStructure & { lastXp?: number }).lastXp = Date.now();
}
export function assign(s: BaseStructure, uid: string) {
  if (s.assigned.includes(uid) || s.assigned.length >= habitatSlots(s)) return false;
  for (const o of state.base.structures) o.assigned = o.assigned.filter((x) => x !== uid);
  s.assigned.push(uid);
  save();
  return true;
}
export function unassign(s: BaseStructure, uid: string) { s.assigned = s.assigned.filter((x) => x !== uid); save(); }

// ── Training hall & forge ──────────────────────────────────────────────────
export const trainCost = (c: Creature) => 40 + c.level * 25;
export function train(c: Creature) {
  const cost = trainCost(c);
  if (state.inv.gold < cost) return null;
  state.inv.gold -= cost;
  const r = grantXp(c, 60 + c.level * 18);
  save();
  return r;
}

export interface Recipe { id: string; name: string; out: { orb?: OrbId; item?: string; n: number }; cost: Partial<Record<MaterialId | 'gold', number>> }
export const RECIPES: Recipe[] = [
  { id: 'r_mystic', name: '5 Mystic Orbs', out: { orb: 'mystic', n: 5 }, cost: { ore: 4, fiber: 6, gold: 120 } },
  { id: 'r_radiant', name: '3 Radiant Orbs', out: { orb: 'radiant', n: 3 }, cost: { ore: 8, crystal: 3, gold: 260 } },
  { id: 'r_dusk', name: '3 Dusk Orbs', out: { orb: 'dusk', n: 3 }, cost: { crystal: 4, fiber: 8, gold: 300 } },
  { id: 'r_tide', name: '3 Tide Orbs', out: { orb: 'tide', n: 3 }, cost: { crystal: 3, stone: 10, gold: 300 } },
  { id: 'r_ember', name: '3 Ember Orbs', out: { orb: 'ember', n: 3 }, cost: { ore: 10, wood: 10, gold: 300 } },
  { id: 'r_tonic', name: '4 Tonics', out: { item: 'tonic', n: 4 }, cost: { fiber: 10, gold: 60 } },
  { id: 'r_elixir', name: 'Elixir', out: { item: 'elixir', n: 1 }, cost: { fiber: 12, crystal: 2, gold: 120 } },
];
export function craft(r: Recipe) {
  if (!canPay(r.cost)) return false;
  pay(r.cost);
  if (r.out.orb) state.inv.orbs[r.out.orb] += r.out.n;
  if (r.out.item) state.inv.items[r.out.item as keyof typeof state.inv.items] = (state.inv.items[r.out.item as keyof typeof state.inv.items] ?? 0) + r.out.n;
  save();
  return true;
}
export const relicUpgradeCost = (level: number) => ({ crystal: 2 * level, ore: 4 * level, gold: 200 * level });
export function upgradeRelic(uid: string) {
  const r = state.relics.find((x) => x.uid === uid);
  if (!r || r.level >= 5) return false;
  const cost = relicUpgradeCost(r.level);
  if (!canPay(cost)) return false;
  pay(cost);
  r.level++;
  save();
  return true;
}
export const SELL_PRICES: Record<MaterialId, number> = { wood: 3, stone: 3, fiber: 3, ore: 9, crystal: 30 };
export function sell(m: MaterialId, n: number) {
  n = Math.min(n, state.inv.materials[m]);
  state.inv.materials[m] -= n;
  state.inv.gold += n * SELL_PRICES[m];
  save();
  return n * SELL_PRICES[m];
}
export { STRUCTURES };
