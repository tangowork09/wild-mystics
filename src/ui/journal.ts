import { ZONES } from '../data/zones';
import { ACHIEVEMENTS } from '../data/progression';
import type { Creature } from '../game/creature';
import { state } from '../game/state';
import { achievementTier, claimableCount, pendingLogin } from '../game/progress';
import { freeWishAvailable } from '../game/gacha';
import type { AccountMode } from '../net/auth';
import { sfx } from '../core/audio';
import { el, uiRoot } from './dom';
import { currency } from './kit';
import { icon } from './icons';
import type { Minimap, TravelPoint } from './minimap';
import { renderTeam } from './tabs/team';
import { renderDex } from './tabs/dex';
import { renderBag, renderRelics } from './tabs/bag';
import { renderQuests, renderAchievements } from './tabs/quests';
import { renderSummon } from './tabs/summon';
import { renderProfile, renderSettings } from './tabs/profile';

export type JournalTab = 'team' | 'dex' | 'bag' | 'relics' | 'quests' | 'achievements' | 'map' | 'summon' | 'profile' | 'settings';

/** Everything the Journal needs from the running game (kept as callbacks so tabs never import main). */
export interface JournalHooks {
  evolve(c: Creature, target: string, stone?: boolean): Promise<void>;
  isNight(): boolean;
  ride(c: Creature): void;
  minimap(): Minimap;
  /** null when fast travel is allowed, otherwise the reason it is not. */
  travelBlock(): string | null;
  travel(p: TravelPoint): void;
  account(): { mode: AccountMode; name: string; sync: string };
  logout(): Promise<void>;
  upgradeAccount(): Promise<void>;
  canInstall(): boolean;
  install(): Promise<void>;
  reset(): void;
}

const TABS: { id: JournalTab; label: string; ic: string; key?: string; sub: string }[] = [
  { id: 'team', label: 'Team', ic: 'paw', key: 't', sub: 'Your Mystics, storage, relics and evolutions' },
  { id: 'dex', label: 'Mystidex', ic: 'codex', key: 'c', sub: 'Every Mystic of the Wilds — and where to find it' },
  { id: 'bag', label: 'Bag', ic: 'backpack', key: 'b', sub: 'Orbs, items, materials and Elementum' },
  { id: 'relics', label: 'Relics', ic: 'crown', key: 'r', sub: 'Charms your Mystics wear into battle' },
  { id: 'quests', label: 'Quests', ic: 'quest_scroll', key: 'q', sub: 'Story, side and daily quests' },
  { id: 'achievements', label: 'Feats', ic: 'trophy', key: 'f', sub: 'Lifetime achievements — each tier pays Aether' },
  { id: 'map', label: 'Map', ic: 'map', key: 'm', sub: 'Fast travel between attuned waypoints' },
  { id: 'summon', label: 'Summon', ic: 'crystal_ball', key: 'g', sub: 'Wish upon the Spire for Mystics and relics' },
  { id: 'profile', label: 'Profile', ic: 'user_profile', key: 'p', sub: 'Account, rank, daily login and journey stats' },
  { id: 'settings', label: 'Settings', ic: 'gear_settings', key: 'o', sub: 'Graphics, audio, controls and accessibility' },
];

let current: { tab: JournalTab; setTab(t: JournalTab): void; close(): void } | null = null;
export const journalOpen = () => current !== null;
export const journalTab = (): JournalTab | null => current?.tab ?? null;
export const closeJournal = () => current?.close();

/** Open the Journal on a tab. Calling again with the open tab closes it (hotkey toggle). Resolves on close. */
export function openJournal(initial: JournalTab, hooks: JournalHooks): Promise<void> {
  if (current) {
    if (current.tab === initial) current.close();
    else current.setTab(initial);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const wrap = el('div', 'journal');
    wrap.innerHTML = `<div class="jr-shell">
      <nav class="jr-rail" aria-label="Journal sections">${TABS.map((t) => `<button data-tab="${t.id}" title="${t.label}${t.key ? ` (${t.key.toUpperCase()})` : ''}"><span class="ji">${icon(t.ic)}</span><small>${t.label}</small><i class="badge"></i></button>`).join('')}</nav>
      <section class="jr-main"><header class="jr-head"><div class="jr-title"><h2></h2><small></small></div><div class="jr-cur"></div><button class="jr-x" aria-label="Close journal"><span>✕</span><kbd>Esc</kbd></button></header>
      <div class="jr-body"></div></section></div>`;
    uiRoot().appendChild(wrap);
    const body = wrap.querySelector('.jr-body') as HTMLElement;
    const title = wrap.querySelector('.jr-title h2') as HTMLElement;
    const sub = wrap.querySelector('.jr-title small') as HTMLElement;
    const cur = wrap.querySelector('.jr-cur') as HTMLElement;

    const badges = () => {
      const ach = ACHIEVEMENTS.filter((a) => achievementTier(a.id).claimable).length;
      const n: Partial<Record<JournalTab, number | string>> = {
        quests: claimableCount() - ach, achievements: ach,
        summon: freeWishAvailable() ? '!' : 0, profile: pendingLogin() !== null ? '!' : 0,
        team: state.team.length === 0 ? '!' : 0,
      };
      wrap.querySelectorAll<HTMLElement>('.jr-rail button').forEach((b) => {
        const v = n[b.dataset.tab as JournalTab] ?? 0;
        const i = b.querySelector('.badge') as HTMLElement;
        i.textContent = v ? String(v) : '';
        i.classList.toggle('on', !!v);
      });
      cur.innerHTML = currency('gold') + currency('aether');
    };

    let tab = initial;
    const render = () => {
      const def = TABS.find((t) => t.id === tab)!;
      title.textContent = def.label;
      sub.textContent = def.sub;
      wrap.querySelectorAll<HTMLElement>('.jr-rail button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
      wrap.querySelector<HTMLElement>(`.jr-rail [data-tab=${tab}]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
      body.className = `jr-body tab-${tab}`;
      body.innerHTML = '';
      body.scrollTop = 0;
      const host = el('div', 'jr-page');
      body.appendChild(host);
      switch (tab) {
        case 'team': renderTeam(host, hooks); break;
        case 'dex': renderDex(host); break;
        case 'bag': renderBag(host, hooks); break;
        case 'relics': renderRelics(host, hooks); break;
        case 'quests': renderQuests(host); break;
        case 'achievements': renderAchievements(host); break;
        case 'map': renderMap(host, hooks, close); break;
        case 'summon': renderSummon(host); break;
        case 'profile': renderProfile(host, hooks); break;
        case 'settings': renderSettings(host, hooks); break;
      }
      badges();
    };
    const setTab = (t: JournalTab) => {
      if (t === tab) return;
      tab = t;
      sfx('select');
      render();
    };
    // Tabs re-render themselves on their own clicks; refresh the rail badges + currency after any interaction.
    const refresh = () => requestAnimationFrame(badges);
    body.addEventListener('click', refresh);

    const busy = () => !!document.querySelector('.modal.in, .summon-fx, .dialog-box');
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) { if (e.key === 'Escape') t.blur(); return; }
      if (busy()) return;
      const k = e.key.toLowerCase();
      let handled = true;
      if (k === 'escape' || k === 'j') close();
      else if (k === '[' || k === ']') {
        const i = TABS.findIndex((x) => x.id === tab);
        setTab(TABS[(i + (k === ']' ? 1 : TABS.length - 1)) % TABS.length].id);
      } else {
        const hit = TABS.find((x) => x.key === k);
        if (hit) { if (hit.id === tab) close(); else setTab(hit.id); } else handled = false;
      }
      if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    addEventListener('keydown', key, true);

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      current = null;
      removeEventListener('keydown', key, true);
      sfx('back');
      wrap.classList.remove('in');
      setTimeout(() => wrap.remove(), 260);
      resolve();
    }
    wrap.querySelector('.jr-x')!.addEventListener('click', close);
    wrap.querySelectorAll<HTMLElement>('.jr-rail button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab as JournalTab)));
    current = { get tab() { return tab; }, setTab, close };
    render();
    sfx('open');
    requestAnimationFrame(() => wrap.classList.add('in'));
  });
}

function renderMap(root: HTMLElement, hooks: JournalHooks, close: () => void) {
  const mm = hooks.minimap();
  const pts = mm.travelPoints();
  const block = hooks.travelBlock();
  const go = (p: TravelPoint) => {
    if (block) { sfx('error'); return; }
    close();
    hooks.travel(p);
  };
  const kindIc = (k: TravelPoint['kind']) => (k === 'town' ? 'house_base' : k === 'camp' ? 'flag' : k === 'homestead' ? 'hammer_build' : 'waypoint_obelisk');
  const zoneRows = ZONES.map((z) => {
    const zp = pts.filter((p) => p.zone === z.id && p.kind !== 'homestead');
    const total = 2 + mm.world.landmarks.waystones.filter((w) => w.zone.id === z.id).length;
    const known = zp.length > 0;
    const boss = state.bosses.includes(z.id);
    return `<div class="mz ${known ? '' : 'locked'}" style="--zc:${z.grass}">
      <div class="mz-h"><b>${known ? z.name : '???'}</b><small>Lv ${z.levels[0]}–${z.levels[1]} · ${zp.length}/${total} attuned${boss ? ` · ${icon('trophy')} Guardian down` : ''}</small></div>
      ${known ? `<div class="mz-pts">${zp.map((p) => `<button class="btn small mz-go" data-tp="${p.id}" ${block ? 'disabled' : ''}>${icon(kindIc(p.kind))}<span>${p.label.replace(` · ${z.name}`, '')}</span></button>`).join('')}</div>` : `<p class="muted small">${z.lore.split('. ')[0]}.</p>`}
    </div>`;
  }).join('');
  const home = pts.find((p) => p.kind === 'homestead');
  root.innerHTML = `<div class="map-wrap"><div class="map-host"></div>
    <aside class="map-side">
      <p class="lead-p">${block ? `<span class="warn">${icon('lock')} ${block}</span>` : `Tap a waypoint to fast travel. Walk up to a ${icon('waypoint_obelisk')} Waystone to attune it — Guardian camps unlock their ${icon('flag')} flag.`}</p>
      ${home ? `<button class="btn primary wide" data-tp="homestead" ${block ? 'disabled' : ''}>${icon('hammer_build')} Travel home</button>` : ''}
      <div class="mz-list">${zoneRows}</div>
      <div class="map-legend"><span>${icon('house_base')} Town</span><span>${icon('waypoint_obelisk')} Waystone</span><span>${icon('flag')} Camp</span><span class="lg-boss">♛ Guardian</span></div>
    </aside></div>`;
  mm.fullMap(root.querySelector('.map-host') as HTMLElement, block ? undefined : go);
  root.querySelectorAll<HTMLElement>('[data-tp]').forEach((b) => b.addEventListener('click', () => { const p = pts.find((x) => x.id === b.dataset.tp); if (p) go(p); }));
}
