import { portrait } from '../assets/manifest';
import { ELEMENTS } from '../data/elements';
import { statsOf, displayName, speciesOf } from '../game/creature';
import { state } from '../game/state';
import { input } from '../core/input';
import type { Overworld } from '../world/world';
import { Minimap } from './minimap';
import { el } from './dom';

export class Hud {
  root = el('div', 'hud');
  private zoneEl = el('div', 'hud-zone');
  private teamEl = el('div', 'hud-team');
  private resEl = el('div', 'hud-res');
  private promptEl = el('button', 'hud-prompt');
  private grassEl = el('div', 'hud-grass', '<i></i>Tall grass — wild creatures lurk');
  private mapHost = el('div', 'hud-map');
  private buttons = el('div', 'hud-buttons');
  private touch = el('div', 'hud-touch');
  minimap: Minimap;
  private lastTeamSig = '';
  onButton?: (b: 'team' | 'dex' | 'bag' | 'map' | 'menu') => void;

  constructor(private world: Overworld) {
    this.minimap = new Minimap(world, this.mapHost);
    this.mapHost.insertAdjacentHTML('beforeend', '<div class="map-ring"></div><div class="map-n">N</div>');
    this.buttons.innerHTML = `
      <button data-b="team" title="Team (T)"><span>◈</span><small>Team</small><kbd>T</kbd></button>
      <button data-b="dex" title="Crittdex (C)"><span>❖</span><small>Dex</small><kbd>C</kbd></button>
      <button data-b="bag" title="Bag (B)"><span>✉</span><small>Bag</small><kbd>B</kbd></button>
      <button data-b="map" title="Map (M)"><span>✧</span><small>Map</small><kbd>M</kbd></button>
      <button data-b="menu" title="Menu (Esc)"><span>≡</span><small>Menu</small><kbd>Esc</kbd></button>`;
    this.buttons.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => this.onButton?.((b as HTMLElement).dataset.b as never)));
    this.touch.innerHTML = `<button class="t-strike" data-k="f"><b>⚔</b><small>Strike</small></button><button class="t-sprint" data-k="shift"><b>»</b><small>Sprint</small></button>`;
    this.touch.querySelector('.t-strike')!.addEventListener('pointerdown', (e) => { e.preventDefault(); input.press('f'); });
    const sprint = this.touch.querySelector('.t-sprint') as HTMLElement;
    sprint.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (input.keys.has('shift')) { input.keys.delete('shift'); sprint.classList.remove('on'); } else { input.keys.add('shift'); sprint.classList.add('on'); }
    });
    this.promptEl.addEventListener('pointerdown', (e) => { e.preventDefault(); input.press('e'); });
    this.root.append(this.zoneEl, this.teamEl, this.resEl, this.mapHost, this.buttons, this.promptEl, this.grassEl, this.touch);
    document.getElementById('ui')!.appendChild(this.root);
  }

  show(on: boolean) { this.root.classList.toggle('hidden', !on); }

  update() {
    const w = this.world;
    const z = w.zone;
    const zhtml = `<b>${z.name}</b><small>Wilds Lv ${z.levels[0]}–${z.levels[1]}${state.bosses.includes(z.id) ? ' · Guardian defeated' : ''}</small>`;
    if (this.zoneEl.innerHTML !== zhtml) this.zoneEl.innerHTML = zhtml;

    const sig = state.team.map((c) => `${c.uid}:${c.hp}:${c.level}:${c.species}`).join('|');
    if (sig !== this.lastTeamSig) {
      this.lastTeamSig = sig;
      this.teamEl.innerHTML = state.team.map((c) => {
        const max = statsOf(c).maxHp;
        const elc = ELEMENTS[speciesOf(c).element].color;
        return `<div class="ht ${c.hp <= 0 ? 'ko' : ''}" style="--el:${elc}"><img src="${portrait(c.species, c.shiny)}" alt=""><div><b>${displayName(c)}</b><span>Lv ${c.level}</span><div class="bar hp"><i style="width:${(c.hp / max) * 100}%"></i></div></div></div>`;
      }).join('');
    }
    const eggs = state.eggs.length ? `<span class="egg">◉ ${state.eggs.map((e) => `${Math.round((1 - e.stepsLeft / e.stepsTotal) * 100)}%`).join(' ')}</span>` : '';
    const res = `<span class="gold">◉ ${state.inv.gold}</span><span class="orbs">◓ ${state.inv.orbs}${state.inv.greatOrbs ? ` · ◈ ${state.inv.greatOrbs}` : ''}</span><span class="tonic">🧪 ${state.inv.potions}</span>${eggs}`;
    if (this.resEl.innerHTML !== res) this.resEl.innerHTML = res;

    const it = w.nearInteract;
    if (it) {
      const txt = `<kbd>E</kbd>${it.label}`;
      if (this.promptEl.innerHTML !== txt) this.promptEl.innerHTML = txt;
      this.promptEl.classList.add('on');
    } else this.promptEl.classList.remove('on');
    const near = w.wilds.nearestTo(w.playerPos, 3.2);
    this.touch.querySelector('.t-strike')!.classList.toggle('ready', !!near);
    this.grassEl.classList.toggle('on', w.inTallGrass());
    this.minimap.draw();
  }
}
