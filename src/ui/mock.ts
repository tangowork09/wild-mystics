// Mock mode: `?mock=quests,shops,world` (or `?mock=all`) registers realistic fake view-model APIs
// (src/game/contracts.ts) so the UI can be designed against real shapes before the content
// workstream lands. Buying and selling in mock shops really moves gold and items in the save.
import {
  api, registerQuestApi, registerShopApi, registerWorldProgressApi, EXPLORE_RES,
  type Marker, type QuestApi, type QuestView, type RegionView, type ShopApi, type ShopItemView, type ShopView, type WorldProgressApi,
} from '../game/contracts';
import { ZONES, WORLD_SIZE, HOMESTEAD } from '../data/zones';
import { GATES, POIS, DUNGEONS } from '../data/layout';
import { ORBS, ITEMS, MATERIALS, type ItemId, type OrbId, type MaterialId } from '../data/items';
import { state, addItem, save } from '../game/state';

const wanted = () => {
  const m = new URLSearchParams(location.search).get('mock');
  if (m === null) return new Set<string>();
  const list = m === '' || m === 'all' ? ['quests', 'shops', 'world'] : m.split(',');
  return new Set(list.map((s) => s.trim()));
};

// ── Quests ──────────────────────────────────────────────────────────────────
function mockQuests(): QuestApi {
  let version = 1;
  const quests: QuestView[] = [
    {
      id: 'mq_first_bond', kind: 'main', title: 'First Bond', chapter: 'Chapter 1 · First Bond', giver: 'Elder Maple', level: 3,
      summary: 'Maple wants to see you and your new partner work together. Wild Mystics nest in the tall grass of Whisperwind Meadow, just east of Hearthwick.',
      steps: [
        { text: 'Meet Elder Maple in Hearthwick', done: true },
        { text: 'Choose your first companion', done: true },
        { text: 'Win your first battle against Kai', done: true },
        { text: 'Catch a wild Mystic in Whisperwind Meadow', done: false, progress: 0, count: 1 },
      ],
      current: null, rewards: { gold: 200, orbs: { mystic: 5 }, rankXp: 60 }, status: 'active', tracked: true,
      target: { id: 'mq_first_bond', kind: 'quest', x: 120, z: 700, label: 'Whisperwind Meadow', beacon: true, region: 'vale' },
    },
    {
      id: 'sq_millers_cat', kind: 'side', title: 'The Miller’s Cat', giver: 'Rowan the Miller', level: 4,
      summary: 'Biscuit chased a Pecklet up Miller’s Rise and refuses to come down. Rowan swears the cat is plotting something.',
      steps: [{ text: 'Search Miller’s Rise for Biscuit', done: false }], current: null,
      rewards: { gold: 120, items: { tonic: 3 } }, status: 'active', tracked: false,
      target: { id: 'sq_millers_cat', kind: 'quest', x: -80, z: 610, label: 'Miller’s Rise', region: 'vale' },
    },
    {
      id: 'sq_vale_beacon', kind: 'side', title: 'Light the Vale Beacon', giver: 'Warden Brisa', level: 5,
      summary: 'The old signal fire on the southern cliffs has gone cold. Brisa wants it lit before the storm season.',
      steps: [{ text: 'Gather 5 Timber', done: true, progress: 5, count: 5 }, { text: 'Carry the timber to the Vale Beacon', done: false }], current: null,
      rewards: { aether: 30, materials: { stone: 10 } }, status: 'active', tracked: false,
      target: { id: 'sq_vale_beacon', kind: 'quest', x: 60, z: 840, label: 'Vale Beacon', region: 'vale' },
    },
    {
      id: 'sq_healer_herbs', kind: 'side', title: 'Herbs for the Healer', giver: 'Sister Fennel', level: 3,
      summary: 'Fennel’s poultices need fresh dewleaf from the meadow edge. You have plenty.',
      steps: [{ text: 'Pick 6 dewleaf', done: true, progress: 6, count: 6 }, { text: 'Return to Sister Fennel', done: true }], current: null,
      rewards: { gold: 150, items: { mega_tonic: 1 } }, status: 'ready', tracked: false,
      target: { id: 'sq_healer_herbs', kind: 'quest-turnin', x: 14, z: 548, label: 'Hearthwick Sanctuary', region: 'vale' },
    },
    {
      id: 'sq_rival_request', kind: 'side', title: 'A Rival’s Request', giver: 'Kai', level: 6,
      summary: 'Kai is pacing by the fountain. Something about a bet and a very large Thornback.',
      steps: [], current: null, rewards: { gold: 100, rankXp: 40 }, status: 'available', tracked: false,
      target: { id: 'sq_rival_request', kind: 'quest-available', x: -16, z: 556, label: 'Kai', region: 'vale' },
    },
    {
      id: 'sq_first_steps', kind: 'side', title: 'Empty-handed', giver: 'Warden Brisa', level: 1,
      summary: 'You walked into Hearthwick with nothing. Brisa made sure that did not last.',
      steps: [{ text: 'Talk to Warden Brisa at the south gate', done: true }, { text: 'Follow Brisa to Elder Maple', done: true }], current: null,
      rewards: { gold: 50 }, status: 'done', tracked: false,
    },
    {
      id: 'dq_warmup', kind: 'daily', title: 'Warm-up Rounds', level: 2, summary: 'Win three battles today. Any Mystic, any land.',
      steps: [{ text: 'Win battles', done: false, progress: 1, count: 3 }], current: null, rewards: { aether: 20, gold: 100 }, status: 'active', tracked: false,
    },
    {
      id: 'dq_field_notes', kind: 'daily', title: 'Field Notes', level: 2, summary: 'Catch two Nature Mystics for Maple’s records.',
      steps: [{ text: 'Catch Nature Mystics', done: true, progress: 2, count: 2 }], current: null, rewards: { aether: 25, orbs: { radiant: 1 } }, status: 'ready', tracked: false,
    },
    {
      id: 'dq_long_walk', kind: 'daily', title: 'Stretch Your Legs', level: 1, summary: 'Walk a kilometre. Your eggs will thank you.',
      steps: [{ text: 'Walk 1,000 m', done: false, progress: 420, count: 1000 }], current: null, rewards: { gold: 80, tickets: 1 }, status: 'active', tracked: false,
    },
    {
      id: 'bq_alpha_thornback', kind: 'bounty', title: 'Alpha Thornback', giver: 'Hunters’ Lodge', level: 12,
      summary: 'An oversized Thornback wearing a crown of light is trampling the Old Grove paths. Alphas hit hard and never flee.',
      steps: [{ text: 'Defeat the Alpha Thornback near the Old Grove', done: false }], current: null,
      rewards: { gold: 600, aether: 50, relic: 'ember_charm' }, status: 'active', tracked: false,
      target: { id: 'bq_alpha_thornback', kind: 'boss', x: -176, z: 752, label: 'Alpha Thornback', region: 'vale' },
    },
  ];
  for (const q of quests) q.current = q.steps.find((s) => !s.done) ?? null;
  const npcMarks: Marker[] = [
    { id: 'npc_maple', kind: 'npc', x: -10, z: 528, label: 'Elder Maple', region: 'vale' },
    { id: 'npc_board', kind: 'quest-available', x: 22, z: 566, label: 'Quest board', region: 'vale' },
  ];
  return {
    list: () => quests,
    tracked: () => quests.find((q) => q.tracked) ?? null,
    track: (id) => { for (const q of quests) q.tracked = q.id === id && q.status !== 'done'; version++; },
    markers: () => [...quests.filter((q) => q.target && q.status !== 'done').map((q) => ({ ...q.target!, beacon: q.tracked })), ...npcMarks],
    claim: (id) => {
      const q = quests.find((x) => x.id === id);
      if (!q || q.status !== 'ready') return false;
      q.status = 'done';
      q.tracked = false;
      const r = q.rewards;
      state.inv.gold += r.gold ?? 0;
      state.inv.aether += r.aether ?? 0;
      state.inv.tickets += r.tickets ?? 0;
      for (const [k, v] of Object.entries(r.items ?? {})) addItem(k as ItemId, v ?? 0);
      for (const [k, v] of Object.entries(r.orbs ?? {})) state.inv.orbs[k as OrbId] += v ?? 0;
      save();
      version++;
      return true;
    },
    version: () => version,
  };
}

// ── World progress ──────────────────────────────────────────────────────────
function mockWorld(): WorldProgressApi {
  const open = new Set(['vale', 'lakes', 'coast']);
  const regions: RegionView[] = ZONES.map((z) => {
    const gate = GATES.find((g) => g.joins.includes(z.id) && !g.unlock.bosses.every((b) => b === 'vale'));
    return {
      id: z.id, name: z.name, levels: z.levels, unlocked: open.has(z.id), visited: z.id === 'vale', guardianDefeated: false,
      lockHint: open.has(z.id) ? undefined : z.id === 'summit' ? 'Bring all nine Guardian sigils to the Crown Gate.' : gate?.sealedText,
    };
  });
  const grid = new Uint8Array(EXPLORE_RES * EXPLORE_RES);
  const cell = WORLD_SIZE / EXPLORE_RES;
  const path: [number, number][] = [[0, 612], [0, 540], [120, 700], [60, 840], [-170, 770], [-80, 610], [0, 540], [118, 610]];
  const segDist = (px: number, pz: number, a: [number, number], b: [number, number]) => {
    const vx = b[0] - a[0], vz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (pz - a[1]) * vz) / (vx * vx + vz * vz || 1)));
    return Math.hypot(px - (a[0] + vx * t), pz - (a[1] + vz * t));
  };
  for (let j = 0; j < EXPLORE_RES; j++) {
    for (let i = 0; i < EXPLORE_RES; i++) {
      const x = -WORLD_SIZE / 2 + (i + 0.5) * cell, z = -WORLD_SIZE / 2 + (j + 0.5) * cell;
      let d = Infinity;
      for (let k = 0; k < path.length - 1; k++) d = Math.min(d, segDist(x, z, path[k], path[k + 1]));
      const wobble = Math.sin(i * 0.9) * 14 + Math.cos(j * 0.7) * 12;
      if (d < 92 + wobble) grid[j * EXPLORE_RES + i] = 1;
    }
  }
  const markers: Marker[] = [
    ...ZONES.filter((z) => open.has(z.id)).map((z) => ({ id: `town_${z.town.id}`, kind: 'town' as const, x: z.town.pos[0], z: z.town.pos[1], label: z.town.name, region: z.id })),
    ...POIS.filter((p) => p.region === 'vale').map((p) => ({ id: p.id, kind: 'poi' as const, x: p.pos[0], z: p.pos[1], label: p.name, region: p.region })),
    ...DUNGEONS.filter((d) => d.region === 'vale' && !d.hidden).map((d) => ({ id: d.id, kind: 'dungeon' as const, x: d.entrance[0], z: d.entrance[1], label: d.name, region: d.region })),
    ...GATES.filter((g) => g.joins.includes('vale')).map((g) => ({ id: g.id, kind: 'gate' as const, x: g.pos[0], z: g.pos[1], label: g.name, region: 'vale' })),
    { id: 'shop_hearthwick', kind: 'shop', x: 26, z: 530, label: 'Outfitter', region: 'vale' },
    { id: 'svc_healer', kind: 'service', x: 14, z: 548, label: 'Sanctuary', region: 'vale' },
    { id: 'camp_vale', kind: 'camp', x: ZONES[0].camp[0], z: ZONES[0].camp[1], label: 'Grove camp', region: 'vale' },
    { id: 'homestead', kind: 'homestead', x: HOMESTEAD.center[0], z: HOMESTEAD.center[1], label: 'Your Homestead', region: 'vale' },
    { id: 'chest_beacon', kind: 'chest', x: 72, z: 828, label: 'Weathered chest', region: 'vale' },
  ];
  return { regions: () => regions, explored: () => grid, markers: () => markers, version: () => 1 };
}

// ── Shops ───────────────────────────────────────────────────────────────────
type Ware = { id: string; category: string; price?: number; stock?: number; locked?: string; tag?: string; currency?: 'gold' | 'aether' };
const orbView = (id: OrbId, w: Ware): ShopItemView => ({
  id, name: ORBS[id].name, desc: ORBS[id].desc, icon: 'orb', category: w.category, price: w.price ?? ORBS[id].price, currency: w.currency ?? 'gold',
  stock: w.stock, owned: state.inv.orbs[id], locked: w.locked, tag: w.tag,
});
const itemView = (id: ItemId, w: Ware): ShopItemView => ({
  id, name: ITEMS[id].name, desc: ITEMS[id].desc, icon: ITEMS[id].icon, category: w.category, price: w.price ?? ITEMS[id].price, currency: w.currency ?? 'gold',
  stock: w.stock, owned: state.inv.items[id] ?? 0, locked: w.locked, tag: w.tag,
});
const wareView = (w: Ware) => (w.id in ORBS ? orbView(w.id as OrbId, w) : itemView(w.id as ItemId, w));

const SHOPS: Record<string, { name: string; keeper: string; face: string; greeting: string; wares: Ware[] }> = {
  outfitter: {
    name: 'Hearthwick Outfitter', keeper: 'Tamsin', face: 'tamsin_outfitter', greeting: 'Orbs, tonics and good boots. Everything a Wayfarer forgets to pack.',
    wares: [
      { id: 'mystic', category: 'Orbs' }, { id: 'radiant', category: 'Orbs', tag: 'New' }, { id: 'dusk', category: 'Orbs' }, { id: 'tide', category: 'Orbs' }, { id: 'ember', category: 'Orbs' },
      { id: 'tonic', category: 'Remedies' }, { id: 'mega_tonic', category: 'Remedies', price: 112, tag: 'Daily deal' }, { id: 'elixir', category: 'Remedies' }, { id: 'ether', category: 'Remedies' }, { id: 'cleanse', category: 'Remedies' },
      { id: 'lure_incense', category: 'Field gear' }, { id: 'wisdom_scroll', category: 'Field gear' }, { id: 'hatch_charm', category: 'Field gear', stock: 1 },
      { id: 'leaf_stone', category: 'Stones' }, { id: 'water_stone', category: 'Stones', locked: 'Stocked once Willowmere Pass opens' }, { id: 'fire_stone', category: 'Stones', locked: 'Unlocks after the Coast Guardian' },
    ],
  },
  curios: {
    name: 'Maple’s Curios', keeper: 'Elder Maple', face: 'elder_maple', greeting: 'Curiosities, mostly. A few of them even work.',
    wares: [
      { id: 'shimmer_incense', category: 'Incense', tag: 'Rare' }, { id: 'lure_incense', category: 'Incense' },
      { id: 'hatch_charm', category: 'Charms', stock: 1 }, { id: 'wisdom_scroll', category: 'Scrolls', stock: 3 }, { id: 'void_stone', category: 'Charms', locked: 'Maple will part with it after the Crown Gate opens' },
    ],
  },
  merchant: {
    name: 'Wandering Merchant', keeper: 'Oru', face: 'oru_merchant', greeting: 'Here today, two lands over tomorrow. Buy now or wonder forever.',
    wares: [
      { id: 'radiant', category: 'Rare finds', price: 140, stock: 5, tag: 'Daily deal' }, { id: 'shimmer_incense', category: 'Rare finds', price: 60, currency: 'aether', stock: 2, tag: 'Rare' },
      { id: 'thunder_stone', category: 'Rare finds', price: 90, currency: 'aether', stock: 1 }, { id: 'wind_stone', category: 'Rare finds', price: 90, currency: 'aether', stock: 1 },
      { id: 'elixir', category: 'Daily deals', price: 110, stock: 3, tag: 'Daily deal' }, { id: 'ether', category: 'Daily deals', price: 60, stock: 4 },
    ],
  },
};
const shopKey = (id: string) => (id.includes('merchant') ? 'merchant' : id.includes('curio') || id.includes('special') ? 'curios' : 'outfitter');

function sellables(): ShopItemView[] {
  const out: ShopItemView[] = [];
  for (const [id, n] of Object.entries(state.inv.items)) {
    if (!n) continue;
    const d = ITEMS[id as ItemId];
    if (!d) continue;
    out.push({ id, name: d.name, desc: d.desc, icon: d.icon, category: 'Items', price: Math.max(1, Math.floor(d.price / 2)), currency: 'gold', owned: n });
  }
  for (const [id, n] of Object.entries(state.inv.materials)) {
    if (!n) continue;
    const m = MATERIALS[id as MaterialId];
    out.push({ id, name: m.name, desc: `Homestead material. Sells for ${id === 'crystal' ? 30 : id === 'ore' ? 9 : 3} gold.`, icon: m.icon, category: 'Materials', price: id === 'crystal' ? 30 : id === 'ore' ? 9 : 3, currency: 'gold', owned: n });
  }
  return out;
}

function mockShops(): ShopApi {
  const bought = new Map<string, number>();
  const view = (shopId: string): ShopView => {
    const s = SHOPS[shopKey(shopId)];
    const items = s.wares.map((w) => {
      const v = wareView(w);
      if (v.stock !== undefined) v.stock = Math.max(0, v.stock - (bought.get(`${shopId}:${w.id}`) ?? 0));
      return v;
    });
    return { id: shopId, name: s.name, keeper: s.keeper, face: s.face, greeting: s.greeting, categories: [...new Set(s.wares.map((w) => w.category))], items, sellable: sellables() };
  };
  return {
    view,
    buy(shopId, itemId, qty) {
      const it = view(shopId).items.find((i) => i.id === itemId);
      if (!it) return { ok: false, msg: 'That is not for sale here.' };
      if (it.locked) return { ok: false, msg: it.locked };
      if (it.stock !== undefined && it.stock < qty) return { ok: false, msg: 'Not enough stock left today.' };
      const cost = it.price * qty;
      const purse = it.currency === 'aether' ? state.inv.aether : state.inv.gold;
      if (purse < cost) return { ok: false, msg: it.currency === 'aether' ? 'Not enough Aether.' : 'Not enough gold.' };
      if (it.currency === 'aether') state.inv.aether -= cost; else state.inv.gold -= cost;
      if (itemId in ORBS) state.inv.orbs[itemId as OrbId] += qty; else addItem(itemId as ItemId, qty);
      if (it.stock !== undefined) bought.set(`${shopId}:${itemId}`, (bought.get(`${shopId}:${itemId}`) ?? 0) + qty);
      save();
      return { ok: true, msg: `Bought ${qty} × ${it.name}.` };
    },
    sell(_shopId, itemId, qty) {
      const it = sellables().find((i) => i.id === itemId);
      if (!it || it.owned < qty) return { ok: false, msg: 'You don’t have that many.' };
      if (itemId in MATERIALS) state.inv.materials[itemId as MaterialId] -= qty; else addItem(itemId as ItemId, -qty);
      state.inv.gold += it.price * qty;
      save();
      return { ok: true, msg: `Sold ${qty} × ${it.name} for ${it.price * qty} gold.` };
    },
  };
}

let mocks: { quests?: QuestApi; shops?: ShopApi; world?: WorldProgressApi } | null = null;
/** Register the mocks the URL asks for. Called at import and again once the HUD exists, so the
 *  mocks win over real APIs registered during boot when a designer explicitly asks for them. */
export function applyMocks() {
  const w = wanted();
  if (!w.size) return;
  mocks ??= { quests: w.has('quests') ? mockQuests() : undefined, shops: w.has('shops') ? mockShops() : undefined, world: w.has('world') ? mockWorld() : undefined };
  if (mocks.quests && api.quests !== mocks.quests) registerQuestApi(mocks.quests);
  if (mocks.shops && api.shops !== mocks.shops) registerShopApi(mocks.shops);
  if (mocks.world && api.world !== mocks.world) registerWorldProgressApi(mocks.world);
}
export const mockShopIds = ['hearthwick_outfitter', 'hearthwick_curios', 'merchant'];
applyMocks();
