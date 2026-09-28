import { portrait } from '../assets/manifest';
import { ELEMENTS } from '../data/elements';
import { SPECIES } from '../data/species';
import { rankXpToNext } from '../data/progression';
import { statsOf, displayName, speciesOf } from '../game/creature';
import { state } from '../game/state';
import { questById, claimableCount } from '../game/progress';
import { input } from '../core/input';
import { settings, onSettings } from '../core/settings';
import type { Overworld } from '../world/world';
import { Minimap } from './minimap';
import { el } from './dom';
import { icon } from './icons';

export type HudButton = 'journal' | 'team' | 'dex' | 'bag' | 'map' | 'summon' | 'quests' | 'build' | 'menu' | 'mount';

function clock(t: number) {
  const mins = Math.floor(t * 24 * 60);
  const hh = Math.floor(mins / 60), mm = mins % 60;
  const h12 = ((hh + 11) % 12) + 1;
  return `${h12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}

export class Hud {
  root = el('div', 'hud');
  private plate = el('div', 'hud-plate');
  private tracker = el('div', 'hud-tracker');
  private zoneEl = el('div', 'hud-zone');
  private teamEl = el('div', 'hud-team');
  private resEl = el('div', 'hud-res');
  private promptEl = el('button', 'hud-prompt');
  private grassEl = el('div', 'hud-grass', `${icon('plant')}<span>Tall grass — hidden Mystics lurk</span>`);
  private mapHost = el('div', 'hud-map');
  private buttons = el('div', 'hud-buttons');
  private touch = el('div', 'hud-touch');
  minimap: Minimap;
  private lastSig = '';
  onButton?: (b: HudButton) => void;

  constructor(private world: Overworld) {
    this.minimap = new Minimap(world, this.mapHost);
    this.mapHost.insertAdjacentHTML('beforeend', '<div class="map-ring"></div><div class="map-n">N</div><div class="map-clock"></div>');
    const btn = (b: HudButton, ic: string, label: string, key: string) => `<button data-b="${b}" title="${label} (${key})"><span class="bi">${icon(ic)}</span><small>${label}</small><kbd>${key}</kbd><i class="badge"></i></button>`;
    this.buttons.innerHTML = [
      btn('journal', 'book', 'Journal', 'J'), btn('team', 'paw', 'Team', 'T'), btn('dex', 'codex', 'Dex', 'C'), btn('bag', 'backpack', 'Bag', 'B'),
      btn('map', 'map', 'Map', 'M'), btn('summon', 'crystal_ball', 'Summon', 'G'), btn('quests', 'quest_scroll', 'Quests', 'Q'), btn('menu', 'gear_settings', 'Menu', 'Esc'),
    ].join('');
    this.buttons.querySelectorAll<HTMLElement>('button').forEach((b) => b.addEventListener('click', () => this.onButton?.(b.dataset.b as HudButton)));
    this.touch.innerHTML = `
      <button class="t-btn t-jump" data-k=" ">${icon('lightning_speed')}<small>Jump</small></button>
      <button class="t-btn t-strike" data-k="f">${icon('sword')}<small>Strike</small></button>
      <button class="t-btn t-sprint" data-k="shift">${icon('footprint')}<small>Sprint</small></button>
      <button class="t-btn t-mount" data-k="r">${icon('paw')}<small>Ride</small></button>`;
    this.touch.querySelectorAll<HTMLElement>('.t-btn').forEach((b) => b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const k = b.dataset.k!;
      if (k === 'shift') {
        if (input.keys.has('shift')) { input.keys.delete('shift'); b.classList.remove('on'); } else { input.keys.add('shift'); b.classList.add('on'); }
      } else if (k === 'r') this.onButton?.('mount');
      else input.press(k === ' ' ? 'jump' : k);
    }));
    this.promptEl.addEventListener('pointerdown', (e) => { e.preventDefault(); input.press('e'); });
    this.plate.addEventListener('click', () => this.onButton?.('journal'));
    this.tracker.addEventListener('click', () => this.onButton?.('quests'));
    this.root.append(this.plate, this.tracker, this.zoneEl, this.teamEl, this.mapHost, this.resEl, this.buttons, this.promptEl, this.grassEl, this.touch);
    document.getElementById('ui')!.appendChild(this.root);
    this.applyTouchSettings();
    onSettings(() => this.applyTouchSettings());
  }

  private applyTouchSettings() {
    this.root.style.setProperty('--touch-scale', String(settings.touchScale));
    this.root.style.setProperty('--touch-opacity', String(settings.touchOpacity));
    this.root.classList.toggle('lefty', settings.leftHanded);
  }

  show(on: boolean) { this.root.classList.toggle('hidden', !on); }

  update() {
    const w = this.world;
    const z = w.zone;
    // zone + clock
    const night = w.atmo.night > 0.5;
    const zhtml = `<b>${z.name}</b><small>${z.subtitle}</small><span class="zone-meta"><i>Lv ${z.levels[0]}–${z.levels[1]}</i>${state.bosses.includes(z.id) ? `<i class="cleared">${icon('trophy')} Guardian defeated</i>` : ''}</span>`;
    if (this.zoneEl.innerHTML !== zhtml) this.zoneEl.innerHTML = zhtml;
    const ck = `${icon(night ? 'moon' : 'sun')}<span>${clock(state.time)}</span>`;
    const clockEl = this.mapHost.querySelector('.map-clock') as HTMLElement;
    if (clockEl.innerHTML !== ck) clockEl.innerHTML = ck;

    // player plate + tracker + team + resources (rebuilt only when something changed)
    const active = state.quests.active.slice(0, 3);
    const sig = [state.rank.level, state.rank.xp, state.profile.name, state.inv.gold, state.inv.aether, state.eggs.map((e) => Math.round(e.stepsLeft)).join(','),
      state.team.map((c) => `${c.uid}:${c.hp}:${c.level}:${c.species}`).join('|'), active.map((a) => `${a.id}:${a.progress}`).join(','), claimableCount()].join('#');
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      const lead = state.team[0];
      this.plate.innerHTML = `<div class="pl-av">${lead ? `<img src="${portrait(lead.species, lead.shiny)}" alt="">` : icon('user_profile')}</div>
        <div class="pl-body"><b>${state.profile.name}</b><small>${state.profile.title}</small><div class="pl-rank"><span>Rank ${state.rank.level}</span><div class="bar xp"><i style="--p:${(state.rank.xp / rankXpToNext(state.rank.level))}"></i></div></div></div>`;
      this.tracker.innerHTML = active.length ? `<div class="trk-h">${icon('quest_scroll')}<span>Quests</span></div>` + active.map((a) => {
        const d = questById(a.id);
        if (!d) return '';
        const done = a.progress >= d.objective.count;
        return `<div class="trk ${d.kind} ${done ? 'done' : ''}"><b>${d.title}</b><span>${done ? 'Complete — claim in Journal' : d.desc}</span>${d.objective.count > 1 ? `<em>${Math.min(a.progress, d.objective.count)}/${d.objective.count}</em>` : ''}</div>`;
      }).join('') : '';
      this.teamEl.innerHTML = state.team.map((c) => {
        const max = statsOf(c).maxHp;
        const elc = ELEMENTS[speciesOf(c).element].color;
        return `<div class="ht ${c.hp <= 0 ? 'ko' : ''}" style="--el:${elc}"><img src="${portrait(c.species, c.shiny)}" alt=""><div><b>${displayName(c)}</b><span>Lv ${c.level}</span><div class="bar hp"><i style="--p:${(c.hp / max)}"></i></div></div></div>`;
      }).join('');
      const eggs = state.eggs.length ? `<span class="res-egg">${icon('egg')}${state.eggs.map((e) => `${Math.round((1 - e.stepsLeft / e.stepsTotal) * 100)}%`).join(' ')}</span>` : '';
      this.resEl.innerHTML = `<span class="cur cur-gold">${icon('coin')}<b>${state.inv.gold.toLocaleString()}</b></span><span class="cur cur-aether">${icon('gem')}<b>${state.inv.aether.toLocaleString()}</b></span>${eggs}`;
      const n = claimableCount();
      for (const b of ['journal', 'quests']) {
        const badge = this.buttons.querySelector(`[data-b=${b}] .badge`) as HTMLElement;
        badge.textContent = n ? String(n) : '';
        badge.classList.toggle('on', n > 0);
      }
      const canRide = state.team.some((c) => SPECIES[c.species]?.rideable) || state.box.some((c) => SPECIES[c.species]?.rideable);
      this.touch.querySelector('.t-mount')!.classList.toggle('hide', !canRide);
    }

    const it = w.nearInteract;
    if (it) {
      const txt = `<kbd>E</kbd><span>${it.label}</span>`;
      if (this.promptEl.innerHTML !== txt) this.promptEl.innerHTML = txt;
      this.promptEl.classList.add('on');
    } else this.promptEl.classList.remove('on');
    const near = w.wilds.nearestTo(w.playerPos, 3.4);
    this.touch.querySelector('.t-strike')!.classList.toggle('ready', !!near);
    this.grassEl.classList.toggle('on', w.inTallGrass() && settings.hints);
    this.minimap.draw();
  }
}
