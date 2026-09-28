import { SPECIES, evolutionStages } from '../../data/species';
import { ELEMENTS, type Element } from '../../data/elements';
import { ABILITIES, RARITY, RARITY_ORDER, type Rarity } from '../../data/traits';
import { ZONES, type SpawnMethod } from '../../data/zones';
import { ITEMS } from '../../data/items';
import { state } from '../../game/state';
import { sfx } from '../../core/audio';
import { bar, elementBadge, mysticFace, rarityTag } from '../kit';
import { icon } from '../icons';

const METHOD: Record<SpawnMethod, { label: string; ic: string }> = {
  roam: { label: 'Roaming', ic: 'footprint' }, grass: { label: 'Tall grass', ic: 'plant' }, search: { label: 'Glimmering nests', ic: 'eye' },
  night: { label: 'Night only', ic: 'moon' }, fish: { label: 'Fishing', ic: 'fish' },
};

export function habitatsOf(id: string) {
  return ZONES.flatMap((z) => z.spawns.filter((s) => s.species === id).map((s) => ({ zone: z, method: s.method })));
}

export function renderDex(root: HTMLElement) {
  const all = Object.values(SPECIES).filter((s) => !s.boss);
  let land = '', element = '', rarity = '', focus = all.find((s) => state.dex[s.id]?.seen)?.id ?? all[0].id;
  const draw = () => {
    const caught = all.filter((s) => (state.dex[s.id]?.caught ?? 0) > 0).length;
    const seen = all.filter((s) => state.dex[s.id]?.seen).length;
    const shinies = all.filter((s) => state.dex[s.id]?.shiny).length;
    const list = all.filter((s) => (!element || s.element === element) && (!rarity || s.rarity === rarity) && (!land || habitatsOf(s.id).some((h) => h.zone.id === land)));
    root.innerHTML = `<div class="dex-head"><div class="dex-count"><b>${caught}</b><small>caught</small></div><div class="dex-count"><b>${seen}</b><small>seen</small></div><div class="dex-count"><b>${shinies}</b><small>shiny</small></div><div class="dex-count"><b>${all.length}</b><small>species</small></div>${bar(caught / all.length, 'xp dexbar')}</div>
      <div class="chips">
        <button class="chip ${!land ? 'on' : ''}" data-land="">All lands</button>${ZONES.map((z) => `<button class="chip ${land === z.id ? 'on' : ''}" data-land="${z.id}">${z.name}</button>`).join('')}
      </div>
      <div class="chips">
        <button class="chip ${!element ? 'on' : ''}" data-el="">All</button>${(Object.keys(ELEMENTS) as Element[]).map((e) => `<button class="chip el ${element === e ? 'on' : ''}" data-el="${e}" style="--el:${ELEMENTS[e].color}">${icon(e)}${ELEMENTS[e].name}</button>`).join('')}
        <span class="chip-sep"></span>${RARITY_ORDER.map((r) => `<button class="chip ${rarity === r ? 'on' : ''}" data-rar="${r}" style="--rar:${RARITY[r].color}">${RARITY[r].name}</button>`).join('')}
      </div>
      <div class="dex-wrap"><div class="dex-grid">${list.map((s) => {
        const d = state.dex[s.id];
        const n = all.indexOf(s) + 1;
        return `<button class="dx ${d?.caught ? 'caught' : d?.seen ? 'seen' : 'unseen'} ${focus === s.id ? 'sel' : ''}" data-id="${s.id}" style="--el:${ELEMENTS[s.element].color};--rar:${RARITY[s.rarity].color}"><span class="no">${String(n).padStart(3, '0')}</span>${mysticFace(s.id, false, 62)}<b>${d?.seen ? s.name : '???'}</b>${d?.shiny ? `<i class="dx-sh">${icon('sparkle')}</i>` : ''}</button>`;
      }).join('')}</div>
      <div class="dex-detail">${detail(focus)}</div></div>`;
    root.querySelectorAll<HTMLElement>('[data-land]').forEach((b) => b.addEventListener('click', () => { land = b.dataset.land!; sfx('select'); draw(); }));
    root.querySelectorAll<HTMLElement>('[data-el]').forEach((b) => b.addEventListener('click', () => { element = b.dataset.el!; sfx('select'); draw(); }));
    root.querySelectorAll<HTMLElement>('[data-rar]').forEach((b) => b.addEventListener('click', () => { rarity = rarity === b.dataset.rar ? '' : (b.dataset.rar as Rarity); sfx('select'); draw(); }));
    root.querySelectorAll<HTMLElement>('.dx').forEach((b) => b.addEventListener('click', () => { focus = b.dataset.id!; sfx('select'); draw(); }));
  };
  const detail = (id: string) => {
    const s = SPECIES[id];
    const d = state.dex[id];
    if (!d?.seen) return `<div class="dd unseen"><div class="q">?</div><p>Not yet encountered.</p>${hint(id)}</div>`;
    const stages = evolutionStages(id);
    const hab = habitatsOf(id);
    return `<div class="dd" style="--el:${ELEMENTS[s.element].color};--rar:${RARITY[s.rarity].color}">
      ${mysticFace(id, false, 170)}
      <div class="dd-tags">${rarityTag(id)}${elementBadge(s.element, true)}</div>
      <h3>${s.name}</h3><p class="cd-lore">${s.lore}</p>
      <div class="dd-sec"><h4>Where to find</h4>${hab.length ? hab.map((h) => `<div class="hab"><span>${icon(METHOD[h.method].ic)}</span><b>${h.zone.name}</b><small>${METHOD[h.method].label}</small></div>`).join('') : `<p class="muted small">${s.rarity === 'legendary' ? 'Summon or Guardian reward only.' : 'Evolve, breed or summon.'}</p>`}</div>
      <div class="dd-sec"><h4>Evolution</h4><div class="evo-line small">${stages.map((st) => `<span class="evo-col">${st.map((x) => `<span class="evo-node ${x === id ? 'cur' : ''}">${mysticFace(x, false, 36)}<small>${state.dex[x]?.seen ? SPECIES[x].name : '???'}</small></span>`).join('')}</span>`).join('<i class="evo-arrow">›</i>')}</div>
        ${s.evolves.map((e) => `<p class="small muted">→ ${state.dex[e.id]?.seen ? SPECIES[e.id].name : '???'}: ${[e.level ? `Lv ${e.level}` : '', e.item ? ITEMS[e.item].name : '', e.time ? `at ${e.time}` : ''].filter(Boolean).join(' · ')}</p>`).join('')}</div>
      <div class="dd-sec"><h4>Abilities</h4>${s.abilities.map((a) => `<div class="hab"><b>${ABILITIES[a].name}</b><small>${ABILITIES[a].desc}</small></div>`).join('')}</div>
      <div class="dd-sec"><h4>Base stats</h4><div class="cd-stats">${(['hp', 'atk', 'def', 'spd'] as const).map((k) => `<div class="stat"><span>${k.toUpperCase()}</span>${bar(s.base[k] / (k === 'hp' ? 110 : 30), 'st')}<b>${s.base[k]}</b></div>`).join('')}</div></div>
      <div class="dd-row"><span>Caught</span><b>${d.caught}${d.shiny ? ' · ✧ shiny caught' : ''}</b></div></div>`;
  };
  const hint = (id: string) => {
    const hab = habitatsOf(id);
    if (!hab.length) return '<p class="muted small">This Mystic is not found in the wild.</p>';
    const h = hab[0];
    return `<p class="muted small">Rumour: something stirs in ${h.zone.name} (${METHOD[h.method].label.toLowerCase()}).</p>`;
  };
  draw();
}
