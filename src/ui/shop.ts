// Shops (reads api.shops.view(id)): keeper portrait and greeting, Buy / Sell, categories, a paged
// shelf of wares and a detail card with a quantity stepper, price, owned count and stock. Locked
// wares say why. Until the content workstream registers real shops, an Outfitter built from the
// item tables keeps the town Outfitter working.
import { api, type ShopApi, type ShopItemView, type ShopView } from '../game/contracts';
import { ORBS, ITEMS, MATERIALS, type ItemId, type OrbId, type MaterialId } from '../data/items';
import type { Zone } from '../data/zones';
import { SELL_PRICES } from '../game/base';
import { state, save, addItem, itemCount } from '../game/state';
import { sfx } from '../core/audio';
import { haptic } from '../core/haptics';
import { modal, toast } from './dom';
import { esc, emptyState } from './kit';
import { icon, glyph } from './icons';
import { faceHTML } from './portraits';
import { odometer } from './count';
import { Pager } from './pager';
import { itemArt } from './tabs/bag';

/** Evolution stones sold per land (regional stock) for the fallback Outfitter. */
const ZONE_STONES: Record<string, ItemId[]> = {
  vale: ['leaf_stone'], lakes: ['water_stone'], coast: ['water_stone', 'thunder_stone'], scar: ['fire_stone', 'earth_stone'], marsh: ['void_stone'],
  elder: ['leaf_stone'], dunes: ['earth_stone', 'wind_stone'], peaks: ['thunder_stone', 'wind_stone'], hollows: ['thunder_stone', 'earth_stone'], summit: ['void_stone'],
};

/** The v2 Outfitter as a ShopApi, used when no real shop is registered for an id. */
function legacyOutfitter(zone?: Zone): ShopApi {
  const wares = (): ShopItemView[] => {
    const orb = (id: OrbId): ShopItemView => ({ id, name: ORBS[id].name, desc: ORBS[id].desc, icon: 'orb', category: 'Orbs', price: ORBS[id].price, currency: 'gold', owned: state.inv.orbs[id] });
    const item = (id: ItemId, category: string): ShopItemView => ({ id, name: ITEMS[id].name, desc: ITEMS[id].desc, icon: ITEMS[id].icon, category, price: ITEMS[id].price, currency: 'gold', owned: itemCount(id), stock: id === 'hatch_charm' ? (itemCount(id) ? 0 : 1) : undefined });
    return [
      ...(['mystic', 'radiant', 'dusk', 'tide', 'ember'] as OrbId[]).map(orb),
      ...(['tonic', 'mega_tonic', 'elixir', 'ether', 'cleanse'] as ItemId[]).map((i) => item(i, 'Remedies')),
      ...(['lure_incense', 'wisdom_scroll', 'shimmer_incense', 'hatch_charm'] as ItemId[]).map((i) => item(i, 'Field gear')),
      ...(ZONE_STONES[zone?.id ?? 'vale'] ?? []).map((i) => item(i, 'Stones')),
    ];
  };
  const sellable = (): ShopItemView[] => [
    ...Object.entries(state.inv.items).filter(([, n]) => n).map(([id, n]) => ({ id, name: ITEMS[id as ItemId]?.name ?? id, desc: ITEMS[id as ItemId]?.desc ?? '', icon: ITEMS[id as ItemId]?.icon ?? 'gift', category: 'Items', price: Math.max(1, Math.floor((ITEMS[id as ItemId]?.price ?? 2) / 2)), currency: 'gold' as const, owned: n ?? 0 })),
    ...(Object.keys(MATERIALS) as MaterialId[]).filter((m) => state.inv.materials[m]).map((m) => ({ id: m, name: MATERIALS[m].name, desc: 'Homestead material.', icon: MATERIALS[m].icon, category: 'Materials', price: SELL_PRICES[m], currency: 'gold' as const, owned: state.inv.materials[m] })),
  ];
  return {
    view: (id) => ({ id, name: `${zone?.town.name ?? 'Town'} Outfitter`, keeper: 'Outfitter', face: `${zone?.town.id ?? 'town'}_outfitter`, greeting: 'Orbs, tonics and a few rarer curiosities for the discerning explorer.', categories: ['Orbs', 'Remedies', 'Field gear', 'Stones'], items: wares(), sellable: sellable() }),
    buy(_id, itemId, qty) {
      const it = wares().find((w) => w.id === itemId);
      if (!it) return { ok: false, msg: 'That is not for sale here.' };
      if (it.stock !== undefined && it.stock < qty) return { ok: false, msg: 'Sold out.' };
      if (state.inv.gold < it.price * qty) return { ok: false, msg: 'Not enough gold.' };
      state.inv.gold -= it.price * qty;
      if (itemId in ORBS) state.inv.orbs[itemId as OrbId] += qty; else addItem(itemId as ItemId, qty);
      save();
      return { ok: true, msg: `Bought ${qty} × ${it.name}.` };
    },
    sell(_id, itemId, qty) {
      const it = sellable().find((w) => w.id === itemId);
      if (!it || it.owned < qty) return { ok: false, msg: 'You don’t have that many.' };
      if (itemId in MATERIALS) state.inv.materials[itemId as MaterialId] -= qty; else addItem(itemId as ItemId, -qty);
      state.inv.gold += it.price * qty;
      save();
      return { ok: true, msg: `Sold ${qty} × ${it.name} for ${(it.price * qty).toLocaleString()} gold.` };
    },
  };
}

function resolveShop(shopId: string, zone?: Zone): ShopApi {
  try {
    const v = api.shops.view(shopId);
    if (v.items.length || v.sellable.length || v.categories.length) return api.shops;
  } catch { /* fall through */ }
  return legacyOutfitter(zone);
}

let lastTab: 'buy' | 'sell' = 'buy';

/** Open a shop by id. `zone` stocks the fallback Outfitter when no real shop is registered. */
export function openShop(shopId: string, opts: { zone?: Zone } = {}): Promise<void> {
  const shop = resolveShop(shopId, opts.zone);
  let tab: 'buy' | 'sell' = lastTab;
  let cat = '';
  let focus = '';
  let qty = 1;
  let pager: Pager<ShopItemView> | null = null;
  return modal('shop', (b) => {
    let v: ShopView = shop.view(shopId);
    b.innerHTML = `<header class="sh-head">
        <div class="sh-keeper">${faceHTML(v.face, v.keeper, 64)}</div>
        <div class="sh-id"><h2 class="display">${esc(v.name)}</h2><p class="sh-say"><b>${esc(v.keeper)}</b> ${esc(v.greeting)}</p></div>
        <div class="sh-purse"><span class="cur cur-gold"><span class="cur-ic">${icon('coin')}</span><b data-p="gold"></b></span><span class="cur cur-aether"><span class="cur-ic">${icon('gem')}</span><b data-p="aether"></b></span></div>
      </header>
      <div class="sh-bar"><div class="seg sh-tabs" role="tablist"><button role="tab" data-t="buy">${icon('backpack')} Buy</button><button role="tab" data-t="sell">${icon('coin')} Sell</button></div><div class="sh-cats"></div></div>
      <div class="md sh-md"><div class="md-master sh-grid"></div><div class="md-detail sh-detail"></div></div>`;
    const grid = b.querySelector('.sh-grid') as HTMLElement;
    const detail = b.querySelector('.sh-detail') as HTMLElement;
    const cats = b.querySelector('.sh-cats') as HTMLElement;
    const purse = () => { odometer(b.querySelector('[data-p=gold]')!, state.inv.gold); odometer(b.querySelector('[data-p=aether]')!, state.inv.aether); };
    const all = () => (tab === 'buy' ? v.items : v.sellable);
    const catsOf = () => (tab === 'buy' ? v.categories : [...new Set(v.sellable.map((i) => i.category))]);
    const list = () => all().filter((i) => !cat || i.category === cat);
    const price = (it: ShopItemView, n = 1) => `<span class="price ${it.currency}">${icon(it.currency === 'aether' ? 'gem' : 'coin')}<b class="tnum">${(it.price * n).toLocaleString()}</b></span>`;
    const purseOf = (it: ShopItemView) => (it.currency === 'aether' ? state.inv.aether : state.inv.gold);
    const maxQty = (it: ShopItemView) => {
      if (tab === 'sell') return Math.max(1, it.owned);
      const afford = Math.floor(purseOf(it) / Math.max(1, it.price));
      return Math.max(1, Math.min(99, afford, it.stock ?? 99));
    };
    pager = new Pager<ShopItemView>(grid, {
      items: list(), cell: { w: 158, h: 66 }, gap: 6, primary: true, label: 'Wares',
      selected: (it) => it.id === focus,
      onPick: (it) => { if (it.id === focus) return; focus = it.id; qty = 1; sfx('select'); pager!.refresh(); drawDetail(); },
      render: (it) => `<span class="ware ${it.locked ? 'locked' : ''} ${tab === 'buy' && !it.locked && purseOf(it) < it.price ? 'poor' : ''} ${it.stock === 0 ? 'soldout' : ''}">
        ${itemArt(it.id, it.icon)}<span class="wr-b"><b class="ell">${esc(it.name)}</b>${price(it)}</span>
        ${it.locked ? `<span class="wr-lock">${icon('lock')}</span>` : it.stock === 0 ? '<span class="wr-flag">Sold out</span>' : it.tag ? `<span class="wr-flag ${/rare/i.test(it.tag) ? 'holo' : ''}">${esc(it.tag)}</span>` : ''}
        ${it.owned ? `<span class="wr-own tnum" title="Owned">×${it.owned}</span>` : ''}</span>`,
      empty: () => emptyState(tab === 'buy' ? 'Nothing on the shelf' : 'Nothing to sell', tab === 'buy' ? 'Check back after the next delivery.' : 'Items and materials you carry can be sold here.', tab === 'buy' ? 'backpack' : 'coin'),
    });
    const drawCats = () => {
      const cs = catsOf();
      cats.innerHTML = cs.length > 1 ? `<div class="seg">${['', ...cs].map((c) => `<button data-c="${esc(c)}" class="${c === cat ? 'on' : ''}">${c ? esc(c) : 'All'}</button>`).join('')}</div>` : '';
      cats.querySelectorAll<HTMLElement>('[data-c]').forEach((x) => x.addEventListener('click', () => { cat = x.dataset.c!; sfx('select'); drawAll(); }));
    };
    const drawDetail = () => {
      const it = all().find((i) => i.id === focus);
      if (!it) { detail.innerHTML = `<div class="item-card">${emptyState(tab === 'buy' ? 'Browse the shelf' : 'Pick something to sell', tab === 'buy' ? 'Tap a ware to see it up close.' : 'Tap an item from your pack.', tab === 'buy' ? 'backpack' : 'coin')}</div>`; return; }
      const max = maxQty(it);
      qty = Math.max(1, Math.min(qty, max));
      const can = tab === 'sell' ? it.owned >= qty : !it.locked && it.stock !== 0 && purseOf(it) >= it.price * qty;
      const why = tab === 'buy' ? (it.locked ? it.locked : it.stock === 0 ? 'Sold out for today.' : purseOf(it) < it.price ? (it.currency === 'aether' ? 'Not enough Aether.' : 'Not enough gold.') : '') : '';
      detail.innerHTML = `<div class="item-card sh-card ${it.locked ? 'locked' : ''}">
        <div class="ic-hero">${itemArt(it.id, it.icon, 'big')}<div class="ic-id"><b class="ic-name">${esc(it.name)}</b><span class="ic-tags"><span class="tag tnum">Owned ×${it.owned}</span>${it.stock !== undefined && tab === 'buy' ? `<span class="tag line tnum">${it.stock} left today</span>` : ''}${it.tag ? `<span class="tag ${/rare/i.test(it.tag) ? 'holo' : 'mag'}">${esc(it.tag)}</span>` : ''}</span></div></div>
        <p class="ic-desc">${esc(it.desc)}</p>
        ${why ? `<p class="sh-why">${icon(it.locked ? 'lock' : 'coin')} ${esc(why)}</p>` : ''}
        <div class="sh-buy">
          <div class="stepper" role="group" aria-label="Quantity"><button class="st-b" data-q="-1" aria-label="Fewer" ${qty <= 1 ? 'disabled' : ''}>${glyph('minus')}</button><b class="tnum" aria-live="polite">${qty}</b><button class="st-b" data-q="1" aria-label="More" ${qty >= max ? 'disabled' : ''}>${glyph('plus')}</button><button class="st-max" data-q="max" ${qty >= max ? 'disabled' : ''}>Max</button></div>
          <button class="btn ${tab === 'buy' ? 'primary' : 'gold'} sh-go" ${can ? '' : 'disabled'}>${tab === 'buy' ? 'Buy' : 'Sell'} ${price(it, qty)}</button>
        </div></div>`;
      detail.querySelectorAll<HTMLElement>('[data-q]').forEach((x) => x.addEventListener('click', () => {
        const q = x.dataset.q!;
        qty = q === 'max' ? max : Math.max(1, Math.min(max, qty + Number(q)));
        sfx('select');
        drawDetail();
      }));
      detail.querySelector('.sh-go')?.addEventListener('click', () => {
        const r = tab === 'buy' ? shop.buy(shopId, it.id, qty) : shop.sell(shopId, it.id, qty);
        if (r.ok) { sfx('coin'); haptic('light'); toast(r.msg, 'loot', 2000); } else { sfx('error'); toast(r.msg, 'bad'); }
        v = shop.view(shopId);
        if (tab === 'sell' && !v.sellable.some((i) => i.id === focus)) focus = '';
        qty = 1;
        drawAll();
      });
    };
    const drawAll = () => {
      b.querySelectorAll<HTMLElement>('[data-t]').forEach((x) => { x.classList.toggle('on', x.dataset.t === tab); x.setAttribute('aria-selected', String(x.dataset.t === tab)); });
      if (cat && !catsOf().includes(cat)) cat = '';
      drawCats();
      const l = list();
      if (!l.some((i) => i.id === focus)) focus = l.find((i) => !i.locked)?.id ?? l[0]?.id ?? '';
      pager!.setItems(l, l.findIndex((i) => i.id === focus));
      drawDetail();
      purse();
    };
    b.querySelectorAll<HTMLElement>('[data-t]').forEach((x) => x.addEventListener('click', () => { tab = lastTab = x.dataset.t as 'buy' | 'sell'; cat = ''; focus = ''; qty = 1; sfx('select'); drawAll(); }));
    drawAll();
    sfx('open');
  }, () => pager?.destroy());
}
