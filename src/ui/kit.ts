// Shared UI building blocks (HTML strings) so every screen speaks the same visual language.
import { portrait } from '../assets/manifest';
import { ELEMENTS } from '../data/elements';
import { RARITY } from '../data/traits';
import { SPECIES } from '../data/species';
import { displayName, statsOf, speciesOf, type Creature } from '../game/creature';
import { state } from '../game/state';
import { icon } from './icons';

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function bar(frac: number, cls = '') {
  return `<div class="bar ${cls}"><i style="--p:${Math.max(0, Math.min(1, frac)).toFixed(4)}"></i></div>`;
}

export function stars(n: number, max = 5) {
  return `<span class="stars">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}">★</i>`).join('')}</span>`;
}

export function elementBadge(el: keyof typeof ELEMENTS, withName = false) {
  const e = ELEMENTS[el];
  return `<span class="el-badge" style="--el:${e.color}">${icon(el)}${withName ? `<span>${e.name}</span>` : ''}</span>`;
}

export function rarityTag(speciesId: string) {
  const r = RARITY[SPECIES[speciesId].rarity];
  return `<span class="rar-tag" style="--rar:${r.color}">${r.name}</span>`;
}

/** Framed portrait with rarity glow, element badge, shiny sparkle. */
export function mysticFace(speciesId: string, shiny = false, size = 64, extra = '') {
  const sp = SPECIES[speciesId];
  const r = RARITY[sp.rarity];
  return `<div class="face ${shiny ? 'shiny' : ''}" style="--rar:${r.color};--el:${ELEMENTS[sp.element].color};--sz:${size}px">
    <img src="${portrait(speciesId, shiny)}" alt="" loading="lazy">${shiny ? `<span class="face-shiny">${icon('sparkle')}</span>` : ''}${extra}</div>`;
}

/** Compact creature card used in team lists, boxes and pickers. */
export function creatureCard(c: Creature, opts: { key?: string; selected?: boolean; small?: boolean; note?: string } = {}) {
  const sp = speciesOf(c);
  const st = statsOf(c);
  return `<button class="ccard ${opts.selected ? 'sel' : ''} ${opts.small ? 'small' : ''} ${c.hp <= 0 ? 'ko' : ''}" ${opts.key ? `data-k="${opts.key}"` : ''} style="--el:${ELEMENTS[sp.element].color};--rar:${RARITY[sp.rarity].color}">
    ${mysticFace(c.species, c.shiny, opts.small ? 42 : 54)}
    <div class="cc-body"><div class="cc-top"><b>${esc(displayName(c))}</b>${c.stars ? stars(c.stars) : ''}</div>
    <div class="cc-sub">${elementBadge(sp.element)}<span>Lv ${c.level}</span>${opts.note ? `<em>${opts.note}</em>` : ''}</div>${bar(c.hp / st.maxHp, 'hp')}</div></button>`;
}

export function currency(kind: 'gold' | 'aether' | 'tickets' | 'essence', n = kind === 'gold' ? state.inv.gold : kind === 'aether' ? state.inv.aether : kind === 'tickets' ? state.inv.tickets : state.inv.essence) {
  const ic = kind === 'gold' ? 'coin' : kind === 'aether' ? 'gem' : kind === 'tickets' ? 'scroll' : 'sparkles';
  return `<span class="cur cur-${kind}">${icon(ic)}<b>${n.toLocaleString()}</b></span>`;
}

export function costList(cost: Partial<Record<string, number>>) {
  const has = (k: string) => (k === 'gold' ? state.inv.gold : k === 'aether' ? state.inv.aether : state.inv.materials[k as keyof typeof state.inv.materials] ?? 0);
  const ic: Record<string, string> = { gold: 'coin', aether: 'gem', wood: 'log_wood', stone: 'stone', ore: 'ore', crystal: 'crystal_cluster', fiber: 'fiber' };
  return `<span class="costs">${Object.entries(cost).map(([k, v]) => `<span class="cost-i ${has(k) >= (v ?? 0) ? '' : 'short'}">${icon(ic[k] ?? 'gem')}${v}</span>`).join('')}</span>`;
}

export function emptyState(title: string, body: string, ic = 'compass') {
  return `<div class="empty">${icon(ic)}<b>${title}</b><p>${body}</p></div>`;
}
