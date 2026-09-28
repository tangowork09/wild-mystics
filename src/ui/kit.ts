// Shared UI building blocks (HTML strings) so every screen speaks the same capsule-station language.
import { portrait } from '../assets/manifest';
import { ELEMENTS, type Element } from '../data/elements';
import { RARITY } from '../data/traits';
import { SPECIES } from '../data/species';
import { displayName, statsOf, speciesOf, type Creature } from '../game/creature';
import { state } from '../game/state';
import { icon, glyph } from './icons';

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function bar(frac: number, cls = '') {
  return `<div class="bar ${cls}"><i style="--p:${clamp01(frac).toFixed(4)}"></i></div>`;
}
/** HP bar that turns amber under 50% and red under 25%. */
export function hpBar(frac: number, cls = '') {
  const f = clamp01(frac);
  return bar(f, `hp ${f <= 0.25 ? 'low' : f <= 0.5 ? 'mid' : ''} ${cls}`);
}

export function stars(n: number, max = 5) {
  return `<span class="stars" aria-label="${n} of ${max} stars">${Array.from({ length: max }, (_, i) => glyph('star', i < n ? 'on' : '')).join('')}</span>`;
}

export const elColor = (e: Element) => ELEMENTS[e].color;

export function elementBadge(e: Element, withName = false) {
  const d = ELEMENTS[e];
  return `<span class="el-pip" style="--el:${d.color}" title="${d.name}">${icon(e)}${withName ? `<span>${d.name}</span>` : ''}</span>`;
}

export function rarityTag(speciesId: string) {
  const key = SPECIES[speciesId]?.rarity ?? 'common';
  const r = RARITY[key];
  return `<span class="rar ${key}" style="--rar:${r.color}">${r.name}</span>`;
}

/** Capsule portrait: element-tinted dome over an ink base. */
export function mysticFace(speciesId: string, shiny = false, size = 64, extra = '', cls = '') {
  const sp = SPECIES[speciesId];
  const col = sp ? ELEMENTS[sp.element].color : 'var(--ink-5)';
  return `<div class="cap ${shiny ? 'shiny' : ''} ${cls}" style="--el:${col};--sz:${size}px"><img src="${portrait(speciesId, shiny)}" alt="" loading="lazy" decoding="async">${shiny ? `<span class="cap-mark holo">${icon('sparkles')}</span>` : ''}${extra}</div>`;
}

/** Compact creature card used in pickers and service rows. */
export function creatureCard(c: Creature, opts: { key?: string; selected?: boolean; small?: boolean; note?: string } = {}) {
  const sp = speciesOf(c);
  const st = statsOf(c);
  return `<button class="ccard ${opts.selected ? 'sel' : ''} ${opts.small ? 'small' : ''} ${c.hp <= 0 ? 'ko' : ''}" ${opts.key ? `data-k="${opts.key}"` : ''} style="--el:${ELEMENTS[sp.element].color}">
    ${mysticFace(c.species, c.shiny, opts.small ? 40 : 48)}
    <span class="cc-body"><span class="cc-top"><b class="ell">${esc(displayName(c))}</b><span class="cc-lv">Lv ${c.level}</span></span>
    ${hpBar(c.hp / st.maxHp, 'thin')}${opts.note ? `<em class="cc-note ell">${opts.note}</em>` : ''}</span></button>`;
}

export type CurrencyKind = 'gold' | 'aether' | 'tickets' | 'essence';
export const CURRENCY_ICON: Record<CurrencyKind, string> = { gold: 'coin', aether: 'gem', tickets: 'scroll', essence: 'sparkles' };
export const currencyAmount = (kind: CurrencyKind) => (kind === 'gold' ? state.inv.gold : kind === 'aether' ? state.inv.aether : kind === 'tickets' ? state.inv.tickets : state.inv.essence);

export function currency(kind: CurrencyKind, n = currencyAmount(kind)) {
  const label = kind === 'gold' ? 'Gold' : kind === 'aether' ? 'Aether' : kind === 'tickets' ? 'Summon tickets' : 'Mystic Essence';
  return `<span class="cur cur-${kind}" title="${label}"><span class="cur-ic">${icon(CURRENCY_ICON[kind])}</span><b data-cur="${kind}">${n.toLocaleString()}</b></span>`;
}

const RES_IC: Record<string, string> = { gold: 'coin', aether: 'gem', wood: 'log_wood', stone: 'stone', ore: 'ore', crystal: 'crystal_cluster', fiber: 'fiber' };
export function costList(cost: Partial<Record<string, number>>) {
  const has = (k: string) => (k === 'gold' ? state.inv.gold : k === 'aether' ? state.inv.aether : state.inv.materials[k as keyof typeof state.inv.materials] ?? 0);
  return `<span class="cost">${Object.entries(cost).map(([k, v]) => `<span class="cost-i ${has(k) >= (v ?? 0) ? '' : 'short'}">${icon(RES_IC[k] ?? 'gem')}${v}</span>`).join('')}</span>`;
}

export function emptyState(title: string, body: string, ic = 'compass') {
  return `<div class="empty"><span class="empty-ic">${icon(ic)}</span><b>${title}</b><p>${body}</p></div>`;
}
