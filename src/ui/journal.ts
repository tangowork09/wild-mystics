// The Journal: one full-screen collector's case with ten tabs. Every tab lays itself out inside the
// body box it is given and pages instead of scrolling.
import { ACHIEVEMENTS } from '../data/progression';
import type { Creature } from '../game/creature';
import { state } from '../game/state';
import { api } from '../game/contracts';
import { achievementTier, pendingLogin } from '../game/progress';
import { freeWishAvailable } from '../game/gacha';
import type { AccountMode } from '../net/auth';
import { sfx } from '../core/audio';
import { el, uiRoot } from './dom';
import { icon, glyph } from './icons';
import { odometer } from './count';
import type { Minimap, TravelPoint } from './minimap';
import { renderTeam } from './tabs/team';
import { renderDex } from './tabs/dex';
import { renderBag, renderRelics } from './tabs/bag';
import { renderQuests, renderAchievements } from './tabs/quests';
import { renderMap } from './tabs/map';
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

export const TABS: { id: JournalTab; label: string; ic: string; key: string }[] = [
  { id: 'team', label: 'Team', ic: 'paw', key: 't' },
  { id: 'dex', label: 'Mystidex', ic: 'codex', key: 'c' },
  { id: 'bag', label: 'Bag', ic: 'backpack', key: 'b' },
  { id: 'relics', label: 'Relics', ic: 'crown', key: 'r' },
  { id: 'quests', label: 'Quests', ic: 'quest_scroll', key: 'q' },
  { id: 'achievements', label: 'Feats', ic: 'trophy', key: 'f' },
  { id: 'map', label: 'Map', ic: 'map', key: 'm' },
  { id: 'summon', label: 'Summon', ic: 'crystal_ball', key: 'g' },
  { id: 'profile', label: 'Profile', ic: 'user_profile', key: 'p' },
  { id: 'settings', label: 'Settings', ic: 'gear_settings', key: 'o' },
];

/** A tab renderer may return a cleanup function (called when the tab is left or the journal closes). */
export type TabCleanup = void | (() => void);

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
    wrap.innerHTML = `<div class="jr-shell" role="dialog" aria-modal="true" aria-label="Journal">
      <header class="jr-top">
        <nav class="jr-tabs" role="tablist" aria-label="Journal sections">${TABS.map((t) => `<button class="jt" role="tab" data-tab="${t.id}" aria-label="${t.label}" title="${t.label} (${t.key.toUpperCase()})"><span class="jt-ic">${icon(t.ic)}</span><span class="jt-l">${t.label}</span><i class="dot-badge"></i></button>`).join('')}</nav>
        <div class="jr-purse"><span class="cur cur-gold"><span class="cur-ic">${icon('coin')}</span><b data-p="gold"></b></span><span class="cur cur-aether"><span class="cur-ic">${icon('gem')}</span><b data-p="aether"></b></span></div>
        <button class="jr-x" aria-label="Close journal">${glyph('close')}<kbd>Esc</kbd></button>
      </header>
      <main class="jr-body"></main></div>`;
    uiRoot().appendChild(wrap);
    const body = wrap.querySelector('.jr-body') as HTMLElement;
    const purse = wrap.querySelector('.jr-purse') as HTMLElement;

    const badges = () => {
      const ach = ACHIEVEMENTS.filter((a) => achievementTier(a.id).claimable).length;
      let ready = 0;
      try { ready = api.quests.list().filter((q) => q.status === 'ready').length; } catch { /* stub */ }
      const n: Partial<Record<JournalTab, number | string>> = {
        quests: ready, achievements: ach, summon: freeWishAvailable() ? '!' : 0, profile: pendingLogin() !== null ? '!' : 0, team: state.team.length === 0 ? '!' : 0,
      };
      wrap.querySelectorAll<HTMLElement>('.jt').forEach((b) => {
        const v = n[b.dataset.tab as JournalTab] ?? 0;
        const i = b.querySelector('.dot-badge') as HTMLElement;
        i.textContent = v ? String(v) : '';
        i.classList.toggle('on', !!v);
      });
      odometer(purse.querySelector('[data-p=gold]')!, state.inv.gold);
      odometer(purse.querySelector('[data-p=aether]')!, state.inv.aether);
    };

    let tab = initial;
    let cleanup: TabCleanup;
    const render = (dir = 0) => {
      if (typeof cleanup === 'function') cleanup();
      cleanup = undefined;
      wrap.querySelectorAll<HTMLElement>('.jt').forEach((b) => {
        const on = b.dataset.tab === tab;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
      });
      body.innerHTML = '';
      const page = el('section', `jr-page tab-${tab}`);
      page.setAttribute('role', 'tabpanel');
      if (dir) page.classList.add(dir > 0 ? 'from-r' : 'from-l');
      body.appendChild(page);
      switch (tab) {
        case 'team': cleanup = renderTeam(page, hooks); break;
        case 'dex': cleanup = renderDex(page); break;
        case 'bag': cleanup = renderBag(page, hooks); break;
        case 'relics': cleanup = renderRelics(page, hooks); break;
        case 'quests': cleanup = renderQuests(page, { showOnMap: () => setTab('map'), playerPos: () => { try { return hooks.minimap().world.playerPos; } catch { return null; } } }); break;
        case 'achievements': cleanup = renderAchievements(page); break;
        case 'map': cleanup = renderMap(page, hooks, close); break;
        case 'summon': cleanup = renderSummon(page); break;
        case 'profile': cleanup = renderProfile(page, hooks); break;
        case 'settings': cleanup = renderSettings(page, hooks); break;
      }
      badges();
    };
    const setTab = (t: JournalTab) => {
      if (t === tab) return;
      const dir = TABS.findIndex((x) => x.id === t) - TABS.findIndex((x) => x.id === tab);
      tab = t;
      sfx('select');
      render(dir);
    };
    // Tabs re-render themselves on their own clicks; refresh the badges + purse after any interaction.
    const refresh = () => requestAnimationFrame(badges);
    body.addEventListener('click', refresh);

    const busy = () => !!document.querySelector('.modal.in, .summon-fx, .dialog-box, .pop');
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) { if (e.key === 'Escape') t.blur(); return; }
      if (busy() || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      let handled = true;
      if (k === 'escape' || k === 'j') close();
      else {
        const hit = TABS.find((x) => x.key === k);
        if (hit) { if (hit.id === tab) close(); else setTab(hit.id); } else handled = false;
      }
      if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    addEventListener('keydown', key, true);
    // Arrow keys move between tabs while the tab strip has focus.
    wrap.querySelector('.jr-tabs')!.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key !== 'ArrowLeft' && ke.key !== 'ArrowRight') return;
      const i = TABS.findIndex((x) => x.id === tab);
      const n = TABS[(i + (ke.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id;
      setTab(n);
      (wrap.querySelector(`.jt[data-tab=${n}]`) as HTMLElement).focus();
      ke.preventDefault();
      ke.stopPropagation();
    });

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      current = null;
      if (typeof cleanup === 'function') cleanup();
      removeEventListener('keydown', key, true);
      sfx('back');
      wrap.classList.remove('in');
      setTimeout(() => wrap.remove(), 240);
      resolve();
    }
    wrap.querySelector('.jr-x')!.addEventListener('click', close);
    wrap.querySelectorAll<HTMLElement>('.jt').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab as JournalTab)));
    current = { get tab() { return tab; }, setTab, close };
    render();
    sfx('open');
    requestAnimationFrame(() => wrap.classList.add('in'));
  });
}
