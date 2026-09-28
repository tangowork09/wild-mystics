// Shops: prices, story-tier stock, daily stock limits, Pell's rotating wagon, buying and selling.
// Registers ShopApi (src/game/contracts.ts); the UI renders ShopView.
import { ITEMS, ORBS, MATERIALS, isItemId, isOrbId, type ItemId, type MaterialId, type OrbId } from '../data/items';
import { RELICS } from '../data/relics';
import { RARITY } from '../data/traits';
import { ZONES } from '../data/zones';
import { MERCHANT_POOL, RELIC_PRICE, SHOPS, TIER_LOCK_TEXT, TIER_SIGILS, shopById, outfitterFor, specialtyFor, type ShopDef, type StockRow } from '../data/shops';
import { npcById } from '../data/npcs';
import { newUid } from './creature';
import { state, save, addItem, itemCount } from './state';
import { emit } from './events';
import { SELL_PRICES } from './base';
import { merchantTown } from './quests';
import { registerShopApi, type ShopApi, type ShopItemView, type ShopView } from './contracts';

// ── goods ─────────────────────────────────────────────────────────────────────
export interface Good {
  id: string;
  kind: 'item' | 'orb' | 'relic' | 'material';
  key: string;
  name: string;
  desc: string;
  icon: string;
  category: string;
  price: number;
  /** What a shop pays for one (0 = won't buy it). */
  sell: number;
  unique: boolean;
}

const CATEGORY: Record<string, string> = {
  restore: 'Supplies', cure: 'Supplies', growth: 'Growth', incense: 'Supplies', travel: 'Supplies', bait: 'Bait',
  gift: 'Gifts', gear: 'Gear', stone: 'Stones', sigil: 'Key items', key: 'Key items', quest: 'Key items',
};

export function good(id: string): Good | null {
  const [pre, rest] = id.includes(':') ? id.split(':') : ['item', id];
  if (pre === 'orb' && isOrbId(rest)) {
    const o = ORBS[rest];
    return { id, kind: 'orb', key: rest, name: o.name, desc: o.desc, icon: 'orb', category: 'Orbs', price: o.price, sell: Math.floor(o.price / 2), unique: false };
  }
  if (pre === 'relic' && RELICS[rest]) {
    const r = RELICS[rest];
    const price = RELIC_PRICE[r.rarity] ?? 0;
    return { id, kind: 'relic', key: rest, name: r.name, desc: `${RARITY[r.rarity].name} relic. ${r.desc}`, icon: 'relic', category: 'Relics', price, sell: Math.floor(price / 4), unique: false };
  }
  if (pre === 'mat' && rest in MATERIALS) {
    const m = MATERIALS[rest as MaterialId];
    return { id, kind: 'material', key: rest, name: m.name, desc: 'Homestead building material.', icon: m.icon, category: 'Materials', price: 0, sell: SELL_PRICES[rest as MaterialId] ?? 0, unique: false };
  }
  if (pre === 'item' && isItemId(rest)) {
    const it = ITEMS[rest];
    const sell = it.sell === false ? 0 : typeof it.sell === 'number' ? it.sell : Math.floor(it.price / 2);
    return { id: rest, kind: 'item', key: rest, name: it.name, desc: it.desc, icon: it.icon, category: CATEGORY[it.category] ?? 'Supplies', price: it.price, sell, unique: !!it.unique };
  }
  return null;
}

export function owned(g: Good): number {
  if (g.kind === 'orb') return state.inv.orbs[g.key as OrbId] ?? 0;
  if (g.kind === 'item') return itemCount(g.key as ItemId);
  if (g.kind === 'relic') return state.relics.filter((r) => r.id === g.key).length;
  return state.inv.materials[g.key as MaterialId] ?? 0;
}

function grant(g: Good, n: number) {
  if (g.kind === 'orb') state.inv.orbs[g.key as OrbId] = (state.inv.orbs[g.key as OrbId] ?? 0) + n;
  else if (g.kind === 'item') addItem(g.key as ItemId, n);
  else if (g.kind === 'relic') for (let i = 0; i < n; i++) state.relics.push({ uid: newUid(), id: g.key, level: 1 });
  else state.inv.materials[g.key as MaterialId] += n;
}

// ── tiers & daily stock ───────────────────────────────────────────────────────
/** Current stock tier: sigils earned, or higher if a quest granted it. */
export function shopTier(): number {
  const sigils = state.bosses.filter((b) => b !== 'summit').length;
  let t = 0;
  for (let i = 0; i < TIER_SIGILS.length; i++) if (sigils >= TIER_SIGILS[i]) t = i;
  if (state.bosses.includes('summit')) t = 5;
  return Math.max(t, state.story.shopTier);
}

const today = () => new Date().toISOString().slice(0, 10);
function rollDay() {
  if (state.shop.day === today()) return;
  state.shop = { day: today(), bought: {} };
}
const boughtKey = (shop: string, good: string) => `${shop}|${good}`;

function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
}

/** Pell's four wares for today (tier-gated) — one is the daily deal. */
export function merchantStock(): StockRow[] {
  const r = seeded(`pell:${today()}`);
  const pool = MERCHANT_POOL.filter((s) => (s.tier ?? 0) <= shopTier());
  const out: StockRow[] = [];
  while (out.length < 4 && pool.length) out.push({ ...pool.splice(Math.floor(r() * pool.length), 1)[0] });
  if (out.length) {
    const deal = Math.floor(r() * out.length);
    out.forEach((s, i) => {
      const base = good(s.good)?.price ?? 0;
      s.price = Math.round(base * (i === deal ? 0.85 : 1.1));
      s.tag = i === deal ? 'Daily deal' : 'Rare';
    });
  }
  return out;
}

function rowsOf(shop: ShopDef): StockRow[] { return shop.kind === 'merchant' ? merchantStock() : shop.stock; }

/** Which shop an Outfitter service building (or a keeper NPC) opens in a land. */
export const shopForService = (zoneId: string) => outfitterFor(zoneId)?.id ?? 'hearthwick_outfitter';
export { outfitterFor, specialtyFor, shopById };

/** The town the merchant is visiting today. */
export const merchantRegion = () => merchantTown();

// ── views ─────────────────────────────────────────────────────────────────────
function itemView(shop: ShopDef, row: StockRow): ShopItemView | null {
  const g = good(row.good);
  if (!g) return null;
  const tier = row.tier ?? 0;
  const price = row.price ?? g.price;
  const left = row.stock !== undefined ? Math.max(0, row.stock - (state.shop.bought[boughtKey(shop.id, row.good)] ?? 0)) : undefined;
  const have = owned(g);
  return {
    id: g.id, name: g.name, desc: g.desc, icon: g.icon, category: g.category, price, currency: 'gold',
    ...(left !== undefined ? { stock: left } : {}),
    owned: have,
    ...(tier > shopTier() ? { locked: TIER_LOCK_TEXT[tier] ?? 'Unlocks later in your journey' } : g.unique && have > 0 ? { locked: 'Already owned' } : {}),
    ...(row.tag ? { tag: row.tag } : tier > 0 && tier === shopTier() ? { tag: 'New' } : {}),
  };
}

function sellables(): ShopItemView[] {
  const out: ShopItemView[] = [];
  const add = (id: string) => {
    const g = good(id);
    if (!g || g.sell <= 0) return;
    const have = owned(g);
    if (have <= 0) return;
    out.push({ id: g.id, name: g.name, desc: g.desc, icon: g.icon, category: g.category, price: g.sell, currency: 'gold', owned: have });
  };
  for (const o of Object.keys(ORBS)) if (o !== 'astral') add(`orb:${o}`);
  for (const i of Object.keys(ITEMS)) add(i);
  for (const m of Object.keys(MATERIALS)) add(`mat:${m}`);
  // relics: only spare copies that nobody is wearing
  const worn = new Set([...state.team, ...state.box].flatMap((c) => c.relics ?? []));
  const spare = new Set(state.relics.filter((r) => !worn.has(r.uid)).map((r) => r.id));
  for (const r of spare) add(`relic:${r}`);
  return out;
}

export function view(shopId: string): ShopView {
  rollDay();
  const shop = shopById(shopId) ?? SHOPS[0];
  const keeper = npcById(shop.keeper);
  const items = rowsOf(shop).map((r) => itemView(shop, r)).filter((x): x is ShopItemView => !!x);
  const cats = [...new Set(items.map((i) => i.category))];
  const town = ZONES.find((z) => z.id === (shop.kind === 'merchant' ? merchantTown() : shop.region))?.town.name;
  return {
    id: shop.id, name: shop.name, keeper: keeper?.name ?? 'Keeper', face: shop.keeper,
    greeting: shop.greeting + (shop.kind === 'merchant' && town ? ` (In ${town} today.)` : ''),
    categories: cats, items, sellable: sellables(),
  };
}

// ── buy / sell ────────────────────────────────────────────────────────────────
let lastTrade = 0;
/** Bumps on every successful trade (lets main.ts tell ShopApi purchases from legacy-UI ones). */
export const tradeCount = () => lastTrade;

export function buy(shopId: string, goodId: string, qty: number): { ok: boolean; msg: string } {
  rollDay();
  const shop = shopById(shopId);
  if (!shop) return { ok: false, msg: 'That shop is closed.' };
  const row = rowsOf(shop).find((r) => r.good === goodId || good(r.good)?.id === goodId);
  const g = row ? good(row.good) : null;
  if (!row || !g) return { ok: false, msg: 'They don’t sell that here.' };
  const n = Math.max(1, Math.floor(qty));
  if ((row.tier ?? 0) > shopTier()) return { ok: false, msg: TIER_LOCK_TEXT[row.tier ?? 0] ?? 'Not yet.' };
  if (g.unique && (owned(g) > 0 || n > 1)) return { ok: false, msg: `You already carry a ${g.name}.` };
  const key = boughtKey(shop.id, row.good);
  if (row.stock !== undefined && (state.shop.bought[key] ?? 0) + n > row.stock) return { ok: false, msg: 'Sold out for today.' };
  const price = (row.price ?? g.price) * n;
  if (price <= 0) return { ok: false, msg: 'That isn’t for sale.' };
  if (state.inv.gold < price) return { ok: false, msg: `Not enough gold — ${price.toLocaleString()} needed.` };
  state.inv.gold -= price;
  grant(g, n);
  if (row.stock !== undefined) state.shop.bought[key] = (state.shop.bought[key] ?? 0) + n;
  lastTrade++;
  emit('buy', { shop: shop.id, item: g.id, qty: n, cost: price });
  save();
  return { ok: true, msg: `Bought ${n} × ${g.name}.` };
}

export function sell(shopId: string, goodId: string, qty: number): { ok: boolean; msg: string } {
  const shop = shopById(shopId);
  if (!shop) return { ok: false, msg: 'That shop is closed.' };
  const g = good(goodId);
  if (!g || g.sell <= 0) return { ok: false, msg: 'They won’t buy that.' };
  const n = Math.max(1, Math.floor(qty));
  if (g.kind === 'relic') {
    const worn = new Set([...state.team, ...state.box].flatMap((c) => c.relics ?? []));
    const spare = state.relics.filter((r) => r.id === g.key && !worn.has(r.uid)).sort((a, b) => a.level - b.level);
    if (spare.length < n) return { ok: false, msg: 'Take it off your Mystic first.' };
    const drop = new Set(spare.slice(0, n).map((r) => r.uid));
    state.relics = state.relics.filter((r) => !drop.has(r.uid));
  } else {
    if (owned(g) < n) return { ok: false, msg: `You only have ${owned(g)}.` };
    if (g.kind === 'orb') state.inv.orbs[g.key as OrbId] -= n;
    else if (g.kind === 'item') addItem(g.key as ItemId, -n);
    else state.inv.materials[g.key as MaterialId] -= n;
  }
  const gain = g.sell * n;
  state.inv.gold += gain;
  lastTrade++;
  emit('sell', { shop: shop.id, item: g.id, qty: n, gain });
  save();
  return { ok: true, msg: `Sold ${n} × ${g.name} for ${gain.toLocaleString()} gold.` };
}

const shopApi: ShopApi = { view, buy, sell };

let wired = false;
export function initShops() {
  if (wired) return;
  wired = true;
  registerShopApi(shopApi);
}

// UI helper: the shop a UI surface should render when opened from the world.
let active: string | null = null;
/** Remember which shop the player just opened (the Outfitter service, a keeper NPC, Pell). */
export function setActiveShop(id: string | null) { active = id; }
export const activeShop = () => active;
