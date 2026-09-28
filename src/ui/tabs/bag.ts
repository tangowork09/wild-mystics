// Bag (orbs, items, materials, Elementum) and Relics: category seg + paged tiles + detail card.
import { ITEMS, ORBS, MATERIALS, STONE_ELEMENT, type ItemId, type OrbId, type MaterialId } from '../../data/items';
import { ELEMENTS, type Element } from '../../data/elements';
import { RELICS, RELIC_MAX_LEVEL } from '../../data/relics';
import { RARITY } from '../../data/traits';
import { displayName, statsOf, grantXp, stoneEvolution, xpToNext, type Creature } from '../../game/creature';
import { state, save, addItem } from '../../game/state';
import { relicUpgradeCost, upgradeRelic, canPay } from '../../game/base';
import { sfx } from '../../core/audio';
import { toast } from '../dom';
import { costList, currency, esc, mysticFace, emptyState } from '../kit';
import { icon, glyph } from '../icons';
import { pickCreature } from '../pickers';
import { Pager } from '../pager';
import type { JournalHooks, TabCleanup } from '../journal';

type Cat = 'orbs' | 'items' | 'materials' | 'elementum';
interface Entry { cat: Cat; id: string; name: string; n: number; desc: string; art: string; usable?: boolean; note?: string }

/** Coloured art for any item id: orbs get their capsule, stones their element, the rest an icon. */
export function itemArt(id: string, iconKey?: string, cls = '') {
  if (id in ORBS) {
    const o = ORBS[id as OrbId];
    return `<span class="orb-art ${cls}" style="--c:${o.color};--b:${o.band}"></span>`;
  }
  const el = STONE_ELEMENT[id as ItemId];
  if (el) return `<span class="item-art stone ${cls}" style="--c:${ELEMENTS[el].color}">${icon(el)}</span>`;
  if (id in MATERIALS) return `<span class="item-art ${cls}" style="--c:${MATERIALS[id as MaterialId].color}">${icon(MATERIALS[id as MaterialId].icon)}</span>`;
  if (id in ELEMENTS) return `<span class="item-art ${cls}" style="--c:${ELEMENTS[id as Element].color}">${icon(id)}</span>`;
  const key = iconKey ?? ITEMS[id as ItemId]?.icon ?? 'gift';
  if (/[./]/.test(key)) return `<span class="item-art img ${cls}"><img src="${esc(key)}" alt=""></span>`;
  return `<span class="item-art ${cls}">${icon(key)}</span>`;
}

let bagCat: Cat = 'orbs';

export function renderBag(root: HTMLElement, hooks: JournalHooks): TabCleanup {
  let focus = '';
  const entries = (): Entry[] => {
    const inv = state.inv;
    if (bagCat === 'orbs') return (Object.keys(ORBS) as OrbId[]).filter((o) => inv.orbs[o] > 0).map((o) => ({ cat: 'orbs', id: o, name: ORBS[o].name, n: inv.orbs[o], desc: ORBS[o].desc, art: '', note: `×${ORBS[o].mult} capture power` }));
    if (bagCat === 'items') return (Object.keys(ITEMS) as ItemId[]).filter((i) => (inv.items[i] ?? 0) > 0).map((i) => {
      const d = ITEMS[i];
      return { cat: 'items', id: i, name: d.name, n: inv.items[i] ?? 0, desc: d.desc, art: '', usable: d.use === 'field' || d.use === 'both' || d.use === 'evolve', note: d.use === 'battle' ? 'Use in battle' : d.use === 'passive' ? 'Works from your bag' : d.use === 'evolve' ? 'Evolution stone' : 'Use anywhere' };
    });
    if (bagCat === 'materials') return (Object.keys(MATERIALS) as MaterialId[]).map((m) => ({ cat: 'materials', id: m, name: MATERIALS[m].name, n: inv.materials[m], desc: 'Homestead building material. Gather it in the wild or produce it at your Homestead.', art: '' }));
    return (Object.keys(ELEMENTS) as Element[]).map((e) => ({ cat: 'elementum', id: e, name: `${ELEMENTS[e].name} Elementum`, n: inv.elementum[e], desc: `Shards of ${ELEMENTS[e].name.toLowerCase()} memory. Offer them at an Elementum Shrine to infuse ${ELEMENTS[e].name} Mystics, or at the Move Master to sharpen ${ELEMENTS[e].name} moves.`, art: '' }));
  };
  root.innerHTML = `<div class="bag md">
    <div class="md-master">
      <header class="bag-top"><div class="seg" role="tablist">${(['orbs', 'items', 'materials', 'elementum'] as Cat[]).map((c) => `<button role="tab" data-cat="${c}">${{ orbs: 'Orbs', items: 'Items', materials: 'Materials', elementum: 'Elementum' }[c]}</button>`).join('')}</div></header>
      <div class="bag-grid"></div>
    </div>
    <div class="md-detail bag-detail"></div>
  </div>`;
  const detail = root.querySelector('.bag-detail') as HTMLElement;
  const pager = new Pager<Entry>(root.querySelector('.bag-grid') as HTMLElement, {
    items: [], cell: { w: 150, h: 58 }, gap: 6, primary: true, label: 'Bag',
    selected: (e) => e.id === focus, onPick: (e) => { focus = e.id; sfx('select'); pager.refresh(); drawDetail(); },
    render: (e) => `<span class="tile ${e.n ? '' : 'zero'}">${itemArt(e.id)}<span class="tl-b"><b class="ell">${e.name}</b><span class="tl-n tnum">×${e.n}</span></span></span>`,
    empty: () => emptyState(bagCat === 'orbs' ? 'No orbs' : 'Your pack is light', bagCat === 'orbs' ? 'Buy binding orbs at any Outfitter.' : 'Items you buy, find and win appear here.', bagCat === 'orbs' ? 'orb' : 'backpack'),
  });
  const purse = () => `<div class="bag-purse">${currency('gold')}${currency('aether')}${currency('tickets')}${currency('essence')}</div>`;
  const draw = () => {
    root.querySelectorAll<HTMLElement>('[data-cat]').forEach((b) => { b.classList.toggle('on', b.dataset.cat === bagCat); b.setAttribute('aria-selected', String(b.dataset.cat === bagCat)); });
    const list = entries();
    if (!list.some((e) => e.id === focus)) focus = list[0]?.id ?? '';
    pager.setItems(list, list.findIndex((e) => e.id === focus));
    drawDetail();
  };
  const drawDetail = () => {
    const e = entries().find((x) => x.id === focus);
    if (!e) {
      detail.innerHTML = `<div class="item-card">${emptyState('Nothing selected', 'Pick something from your bag to see what it does.', 'backpack')}</div>${purse()}`;
      return;
    }
    detail.innerHTML = `<div class="item-card">
      <div class="ic-hero">${itemArt(e.id, undefined, 'big')}<div class="ic-id"><b class="ic-name">${e.name}</b><span class="ic-tags"><span class="tag tnum">Owned ×${e.n}</span>${e.note ? `<span class="tag line">${e.note}</span>` : ''}</span></div></div>
      <p class="ic-desc">${e.desc}</p>
      ${e.usable ? `<div class="ic-act"><button class="btn primary" data-use="${e.id}">${glyph('play')} Use</button></div>` : ''}
    </div>${purse()}`;
    detail.querySelector('[data-use]')?.addEventListener('click', () => void use(e.id as ItemId));
  };
  const use = async (id: ItemId) => {
    const d = ITEMS[id];
    if (id === 'lure_incense') { state.buffs.lure = Date.now() + 180000; addItem(id, -1); toast('Lure Incense lit: encounters doubled for 3 minutes.', 'good'); save(); draw(); return; }
    if (id === 'shimmer_incense') { state.buffs.shimmer = Date.now() + 300000; addItem(id, -1); toast('Shimmer Incense lit: shiny odds tripled for 5 minutes!', 'good'); save(); draw(); return; }
    if (d.use === 'evolve') {
      const c = await pickCreature(`Use ${d.name} on…`, (x) => !!stoneEvolution(x, id, hooks.isNight()), () => 'Can evolve');
      if (!c) return;
      const evo = stoneEvolution(c, id, hooks.isNight());
      if (!evo) return;
      addItem(id, -1);
      await hooks.evolve(c, evo.id, true);
      draw();
      return;
    }
    const filter = (c: Creature) => {
      const max = statsOf(c).maxHp;
      if (id === 'tonic' || id === 'mega_tonic') return c.hp > 0 && c.hp < max;
      if (id === 'elixir') return c.hp < max;
      if (id === 'wisdom_scroll') return c.level < 60;
      return true;
    };
    const c = await pickCreature(`Use ${d.name} on…`, filter, (x) => `${x.hp}/${statsOf(x).maxHp} HP`);
    if (!c) return;
    const max = statsOf(c).maxHp;
    if (id === 'tonic') c.hp = Math.min(max, c.hp + Math.round(max * 0.5));
    else if (id === 'mega_tonic') c.hp = max;
    else if (id === 'elixir') c.hp = c.hp <= 0 ? Math.round(max * 0.5) : max;
    else if (id === 'wisdom_scroll') { grantXp(c, xpToNext(c.level) - c.xp); toast(`${esc(displayName(c))}’s XP bar is full: train it in Team → Train!`, 'good'); }
    else if (id === 'cleanse') toast('Status effects only linger in battle. Nothing to cure.', '');
    addItem(id, -1);
    sfx('heal');
    save();
    draw();
  };
  root.querySelectorAll<HTMLElement>('[data-cat]').forEach((b) => b.addEventListener('click', () => { bagCat = b.dataset.cat as Cat; focus = ''; sfx('select'); draw(); }));
  draw();
  return () => pager.destroy();
}

export function renderRelics(root: HTMLElement, hooks: JournalHooks): TabCleanup {
  void hooks;
  const owner = (uid: string) => [...state.team, ...state.box].find((c) => c.relics.includes(uid));
  const sorted = () => [...state.relics].sort((a, b) => RARITY[RELICS[b.id].rarity].order - RARITY[RELICS[a.id].rarity].order || b.level - a.level);
  let focus = sorted()[0]?.uid ?? '';
  root.innerHTML = `<div class="relics md"><div class="md-master"><header class="bag-top"><p class="muted rl-lead">Charms your Mystics wear into battle: two slots each, a third at 3★.</p></header><div class="rl-grid"></div></div><div class="md-detail rl-detail"></div></div>`;
  const detail = root.querySelector('.rl-detail') as HTMLElement;
  type R = (typeof state.relics)[number];
  const relicIc = (id: string) => { const d = RELICS[id]; return icon(d.effect === 'element' ? d.element ?? 'gem' : 'crown'); };
  const pager = new Pager<R>(root.querySelector('.rl-grid') as HTMLElement, {
    items: sorted(), cell: { w: 150, h: 62 }, gap: 6, primary: true, label: 'Relics',
    selected: (r) => r.uid === focus, onPick: (r) => { focus = r.uid; sfx('select'); pager.refresh(); drawDetail(); },
    render: (r) => {
      const d = RELICS[r.id];
      const o = owner(r.uid);
      return `<span class="tile relic" style="--rar:${RARITY[d.rarity].color}"><span class="item-art rl">${relicIc(r.id)}</span><span class="tl-b"><b class="ell">${d.name}</b><span class="tl-n tnum ell">Lv ${r.level}${o ? ` · ${esc(displayName(o))}` : ''}</span></span></span>`;
    },
    empty: emptyState('No relics yet', 'Earn them from quests, Guardians and Tamers, or wish at the Relic Forge.', 'crown'),
  });
  const drawDetail = () => {
    const r = state.relics.find((x) => x.uid === focus);
    if (!r) { detail.innerHTML = `<div class="item-card">${emptyState('Nothing selected', 'Pick a relic to see its bonuses.', 'crown')}</div>`; return; }
    const d = RELICS[r.id];
    const o = owner(r.uid);
    const forge = state.base.structures.some((s) => s.type === 'forge');
    const cost = relicUpgradeCost(r.level);
    detail.innerHTML = `<div class="item-card" style="--rar:${RARITY[d.rarity].color}">
      <div class="ic-hero"><span class="item-art rl big">${relicIc(r.id)}</span><div class="ic-id"><b class="ic-name">${d.name}</b><span class="ic-tags"><span class="rar ${d.rarity}" style="--rar:${RARITY[d.rarity].color}">${RARITY[d.rarity].name}</span><span class="tag tnum">Lv ${r.level}/${RELIC_MAX_LEVEL}</span></span></div></div>
      <p class="ic-desc">${d.desc}</p>
      <div class="rl-stats">${Object.entries(d.stats).map(([k, v]) => `<span class="tag line tnum">${k.toUpperCase()} +${Math.round((v ?? 0) * (1 + (r.level - 1) * 0.25) * 100)}%</span>`).join('') || '<span class="muted">No stat bonus</span>'}</div>
      <div class="rl-owner">${o ? `${mysticFace(o.species, o.shiny, 34)}<span>Worn by <b>${esc(displayName(o))}</b></span>` : '<span class="muted">Not equipped. Equip it from the Team tab.</span>'}</div>
      <div class="ic-act">${r.level < RELIC_MAX_LEVEL ? (forge ? `<button class="btn ${canPay(cost) ? 'gold' : ''}" data-up ${canPay(cost) ? '' : 'disabled'}>${icon('anvil')} Upgrade ${costList(cost)}</button>` : '<p class="muted cd-note">Build a Relic Forge at your Homestead to upgrade relics.</p>') : '<span class="tag gold">Max level</span>'}</div>
    </div>`;
    detail.querySelector('[data-up]')?.addEventListener('click', () => {
      if (upgradeRelic(r.uid)) { sfx('levelup'); toast('Relic upgraded!', 'good'); } else { sfx('error'); toast('Not enough materials.', 'bad'); }
      pager.setItems(sorted());
      drawDetail();
    });
  };
  drawDetail();
  return () => pager.destroy();
}
