// Mystidex: the series lineup card. Numbered capsules (silhouettes until seen), filters in popovers,
// and a detail card with lore, habitats, base stats and the evolution line.
import { SPECIES, evolutionStages, type Species } from '../../data/species';
import { ELEMENTS, type Element } from '../../data/elements';
import { ABILITIES, RARITY, RARITY_ORDER, type Rarity } from '../../data/traits';
import { ZONES, type SpawnMethod } from '../../data/zones';
import { ITEMS } from '../../data/items';
import { state } from '../../game/state';
import { sfx } from '../../core/audio';
import { popover } from '../dom';
import { bar, elementBadge, mysticFace, rarityTag, emptyState } from '../kit';
import { icon, glyph } from '../icons';
import { Pager } from '../pager';
import type { TabCleanup } from '../journal';

const METHOD: Record<SpawnMethod, { label: string; ic: string }> = {
  roam: { label: 'Roaming', ic: 'footprint' }, grass: { label: 'Tall grass', ic: 'plant' }, search: { label: 'Glimmering nests', ic: 'eye' },
  night: { label: 'Night only', ic: 'moon' }, fish: { label: 'Fishing', ic: 'fish' },
};

export function habitatsOf(id: string) {
  return ZONES.flatMap((z) => z.spawns.filter((s) => s.species === id).map((s) => ({ zone: z, method: s.method })));
}

type Sub = 'info' | 'where' | 'stats' | 'evolve';

export function renderDex(root: HTMLElement): TabCleanup {
  const all = Object.values(SPECIES).filter((s) => !s.boss);
  const no = new Map(all.map((s, i) => [s.id, i + 1]));
  let land = '', element: Element | '' = '', rarity: Rarity | '' = '';
  let focus = all.find((s) => state.dex[s.id]?.seen)?.id ?? all[0].id;
  let sub: Sub = 'info';
  const list = () => all.filter((s) => (!element || s.element === element) && (!rarity || s.rarity === rarity) && (!land || habitatsOf(s.id).some((h) => h.zone.id === land)));
  const caught = all.filter((s) => (state.dex[s.id]?.caught ?? 0) > 0).length;
  const seen = all.filter((s) => state.dex[s.id]?.seen).length;
  const shinies = all.filter((s) => state.dex[s.id]?.shiny).length;

  root.innerHTML = `<div class="dex md">
    <div class="md-master">
      <header class="dex-top">
        <div class="dex-count" title="${caught} of ${all.length} caught"><b class="tnum">${caught}<small>/${all.length}</small></b>${bar(caught / all.length, 'mag')}<span class="dex-sub tnum">${seen} seen · ${shinies} shiny</span></div>
        <div class="dex-filters"><button class="chip" data-f="land"></button><button class="chip" data-f="el"></button><button class="chip" data-f="rar"></button></div>
      </header>
      <div class="dex-grid"></div>
    </div>
    <div class="md-detail dex-detail"></div>
  </div>`;
  const detail = root.querySelector('.dex-detail') as HTMLElement;
  const grid = new Pager<Species>(root.querySelector('.dex-grid') as HTMLElement, {
    items: list(), cell: { w: 76, h: 92 }, gap: 6, label: 'Mystidex', primary: true,
    selected: (s) => s.id === focus, onPick: (s) => { if (s.id === focus) return; focus = s.id; sfx('select'); grid.refresh(); drawDetail(); },
    render: (s) => {
      const d = state.dex[s.id];
      const st = d?.caught ? 'caught' : d?.seen ? 'seen' : 'unseen';
      return `<span class="dx ${st}"><span class="dx-no tnum">${String(no.get(s.id)).padStart(3, '0')}</span>${mysticFace(s.id, false, 50, d?.caught ? `<span class="cap-mark" title="Caught">${glyph('check')}</span>` : '', st === 'unseen' ? 'unseen' : st === 'seen' ? 'seen' : '')}<span class="dx-name ell">${d?.seen ? s.name : '???'}</span>${d?.shiny ? `<i class="dx-sh" title="Shiny caught">${icon('sparkles')}</i>` : ''}</span>`;
    },
    empty: emptyState('Nothing matches', 'Clear a filter to see more of the lineup.', 'codex'),
  });

  const drawFilters = () => {
    const lb = (f: string, txt: string, on: boolean) => { const b = root.querySelector(`[data-f=${f}]`) as HTMLElement; b.innerHTML = `${txt}${glyph('chevD', 'chev')}`; b.classList.toggle('on', on); };
    lb('land', land ? ZONES.find((z) => z.id === land)!.name : 'All lands', !!land);
    lb('el', element ? `<span class="el-pip" style="--el:${ELEMENTS[element].color}">${icon(element)}</span>${ELEMENTS[element].name}` : 'Element', !!element);
    lb('rar', rarity ? RARITY[rarity].name : 'Rarity', !!rarity);
  };
  root.querySelectorAll<HTMLElement>('[data-f]').forEach((b) => b.addEventListener('click', async () => {
    const f = b.dataset.f;
    if (f === 'land') {
      const v = await popover(b, [{ value: '', label: 'All lands', on: !land }, ...ZONES.map((z) => ({ value: z.id, label: z.name, on: land === z.id }))], { cols: 2 });
      if (v === null) return;
      land = v;
    } else if (f === 'el') {
      const v = await popover(b, [{ value: '' as const, label: 'All elements', on: !element }, ...(Object.keys(ELEMENTS) as Element[]).map((k) => ({ value: k, label: ELEMENTS[k].name, on: element === k, icon: `<span class="el-pip" style="--el:${ELEMENTS[k].color}">${icon(k)}</span>` }))], { cols: 2 });
      if (v === null) return;
      element = v;
    } else {
      const v = await popover(b, [{ value: '' as const, label: 'All rarities', on: !rarity }, ...RARITY_ORDER.map((r) => ({ value: r, label: RARITY[r].name, on: rarity === r, icon: `<i class="rar-dot" style="--rar:${RARITY[r].color}"></i>` }))]);
      if (v === null) return;
      rarity = v;
    }
    sfx('select');
    drawFilters();
    const l = list();
    if (l.length && !l.some((s) => s.id === focus)) focus = l[0].id;
    grid.setItems(l, l.findIndex((s) => s.id === focus));
    drawDetail();
  }));

  const drawDetail = () => {
    const s = SPECIES[focus];
    const d = state.dex[focus];
    if (!d?.seen) {
      const hab = habitatsOf(focus);
      detail.innerHTML = `<div class="dd unseen"><div class="dd-hero">${mysticFace(focus, false, 96, '', 'unseen')}<div class="dd-id"><span class="dd-no tnum">No. ${String(no.get(focus)).padStart(3, '0')}</span><span class="display">???</span><p class="muted">Not yet encountered.</p></div></div>
        <div class="dd-rumour">${icon('compass')}<p>${hab.length ? `Rumour has it something stirs in <b>${hab[0].zone.name}</b> (${METHOD[hab[0].method].label.toLowerCase()}).` : s.rarity === 'legendary' ? 'Legends say it answers only Guardians and wishes.' : 'Not found in the wild. Evolve, breed or summon it.'}</p></div></div>`;
      return;
    }
    detail.style.setProperty('--el', ELEMENTS[s.element].color);
    const subs: [Sub, string][] = [['info', 'Info'], ['where', 'Habitat'], ['stats', 'Stats'], ['evolve', 'Evolve']];
    detail.innerHTML = `<div class="dd">
      <div class="dd-hero">${mysticFace(focus, false, 96)}<div class="dd-id"><span class="dd-no tnum">No. ${String(no.get(focus)).padStart(3, '0')}</span><span class="display ell">${s.name}</span><div class="cd-tags">${rarityTag(focus)}${elementBadge(s.element, true)}${s.rideable ? `<span class="tag">${icon('paw')} Rideable</span>` : ''}</div>
        <span class="dd-caught">${d.caught ? `${glyph('check')} Caught ${d.caught}×` : 'Seen, not caught'}${d.shiny ? ` · <span class="holo-t">${icon('sparkles')} shiny</span>` : ''}</span></div></div>
      <div class="seg cd-subs" role="tablist">${subs.map(([k, l]) => `<button role="tab" data-sub="${k}" class="${k === sub ? 'on' : ''}" aria-selected="${k === sub}">${l}</button>`).join('')}</div>
      <div class="cd-page">${page(s)}</div></div>`;
    detail.querySelectorAll<HTMLElement>('[data-sub]').forEach((b) => b.addEventListener('click', () => { sub = b.dataset.sub as Sub; sfx('select'); drawDetail(); }));
  };

  const page = (s: Species) => {
    if (sub === 'info') return `<p class="dd-lore">${s.lore}</p><div class="dd-abil">${s.abilities.map((a) => `<div class="abil"><b>${ABILITIES[a].name}</b><small>${ABILITIES[a].desc}</small></div>`).join('')}</div>`;
    if (sub === 'where') {
      const hab = habitatsOf(s.id);
      return hab.length ? `<div class="hab-list">${hab.slice(0, 6).map((h) => `<div class="hab"><span class="hab-ic">${icon(METHOD[h.method].ic)}</span><b class="ell">${h.zone.name}</b><small>${METHOD[h.method].label} · Lv ${h.zone.levels[0]}–${h.zone.levels[1]}</small></div>`).join('')}</div>`
        : `<p class="muted cd-note">${s.rarity === 'legendary' ? 'Only from Guardians and summons.' : 'Not found in the wild. Evolve, breed or summon it.'}</p>`;
    }
    if (sub === 'stats') return `<div class="cd-stats">${(['hp', 'atk', 'def', 'spd'] as const).map((k) => `<div class="stat"><span class="st-k">${k.toUpperCase()}</span>${bar(s.base[k] / (k === 'hp' ? 110 : 30), 'st')}<b class="tnum">${s.base[k]}</b></div>`).join('')}</div>`;
    const stages = evolutionStages(s.id);
    return `<div class="evo-line">${stages.map((col) => `<span class="evo-col">${col.map((x) => `<span class="evo-node ${x === s.id ? 'cur' : ''}">${mysticFace(x, false, 48, '', state.dex[x]?.seen ? '' : 'unseen')}<small class="ell">${state.dex[x]?.seen ? SPECIES[x].name : '???'}</small></span>`).join('')}</span>`).join(`<i class="evo-arrow">${glyph('chevR')}</i>`)}</div>
      ${s.evolves.length ? `<div class="evo-conds">${s.evolves.map((e) => `<span class="tag line">${glyph('chevR')}${state.dex[e.id]?.seen ? SPECIES[e.id].name : '???'} · ${[e.level ? `Lv ${e.level}` : '', e.item ? ITEMS[e.item].name : '', e.time ? `at ${e.time}` : ''].filter(Boolean).join(' · ')}</span>`).join('')}</div>` : ''}`;
  };

  drawFilters();
  drawDetail();
  grid.showIndex(list().findIndex((s) => s.id === focus));
  return () => grid.destroy();
}
