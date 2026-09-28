// In-world HUD. Corner law: top-left = who (Wayfarer + party) and where to go (tracker), top-centre
// = compass, top-right = minimap + purse, bottom = actions. The centre third stays empty.
import { SPECIES } from '../data/species';
import { rankXpToNext } from '../data/progression';
import { HOMESTEAD, type Weather } from '../data/zones';
import { MATERIALS, type MaterialId } from '../data/items';
import { statsOf, displayName, speciesOf } from '../game/creature';
import { state } from '../game/state';
import { api, type QuestView } from '../game/contracts';
import { claimableCount } from '../game/progress';
import { input } from '../core/input';
import { settings, onSettings } from '../core/settings';
import type { Overworld } from '../world/world';
import type { Interactable } from '../world/towns';
import { Minimap } from './minimap';
import { Compass } from './compass';
import { Beacon } from './beacon';
import { el } from './dom';
import { icon, glyph } from './icons';
import { esc, mysticFace } from './kit';
import { npcAvatar } from './portraits';
import { odometer } from './count';
import { trackedTarget, bearingTo, headingOf, wrap180, distText } from './guidance';
import { applyMocks } from './mock';

export type HudButton = 'journal' | 'team' | 'dex' | 'bag' | 'map' | 'summon' | 'quests' | 'build' | 'menu' | 'mount';

const clock = (t: number) => {
  const mins = Math.floor(t * 24 * 60);
  const hh = Math.floor(mins / 60) % 24, mm = mins % 60;
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
};
const WEATHER: Record<Weather, [string, string]> = {
  pollen: ['plant', 'Pollen'], mist: ['cloud', 'Mist'], embers: ['fire_flame', 'Embers'], snow: ['snowflake', 'Snow'], spores: ['plant', 'Spores'],
  sand: ['wind', 'Sandstorm'], spray: ['water_drop', 'Sea spray'], fireflies: ['sparkles', 'Fireflies'], glimmer: ['crystal_cluster', 'Glimmer'], aether: ['sparkles', 'Aether storm'],
};
const QUEST_IC: Record<QuestView['kind'], string> = { main: 'crown', side: 'quest_scroll', daily: 'sun', bounty: 'skull' };
const SVC_IC: Record<string, string> = { healer: 'heart', shop: 'backpack', hatchery: 'egg', shrine: 'crystal_cluster', tutor: 'sword', storage: 'chest', summon: 'crystal_ball', quests: 'quest_scroll' };
function promptIcon(it: Interactable) {
  switch (it.kind) {
    case 'service': return SVC_IC[it.service ?? ''] ?? 'house_base';
    case 'camp': return 'campfire';
    case 'boss': return 'skull';
    case 'search': return 'eye';
    case 'waystone': return 'waypoint_obelisk';
    case 'gather': return it.data === 'fish' ? 'fish' : MATERIALS[it.data as MaterialId]?.icon ?? 'hammer_build';
    case 'tamer': return 'sword';
    case 'homestead': return 'hammer_build';
    default: return 'user_profile';
  }
}

export class Hud {
  root = el('div', 'hud');
  minimap: Minimap;
  onButton?: (b: HudButton) => void;
  private compass: Compass;
  private beacon: Beacon;
  private badge = el('button', 'hud-badge stk');
  private party = el('div', 'hud-party');
  private track = el('button', 'hud-track stk');
  private mapBox = el('div', 'hud-map');
  private mapChip = el('div', 'hud-mapchip');
  private purse = el('div', 'hud-purse');
  private quick = el('div', 'hud-quick');
  private promptEl = el('button', 'hud-prompt stk');
  private grassEl = el('div', 'hud-grass', `${icon('plant')}<span>Tall grass: hidden Mystics</span>`);
  private ctxEl = el('button', 'hud-ctx stk');
  private touch = el('div', 'hud-touch');
  private joyGhost = el('div', 'hud-joy', '<i></i>');
  private sig = { badge: '', party: '', track: '', chip: '', prompt: '', quick: '' };
  private trackArrow: HTMLElement | null = null;
  private trackDist: HTMLElement | null = null;
  private lastT = performance.now();
  private readyCount = 0;
  private readyVersion = -1;

  constructor(private world: Overworld) {
    applyMocks();
    this.compass = new Compass(world);
    this.beacon = new Beacon(world);
    this.mapBox.innerHTML = '<span class="mm-n">N</span>';
    this.minimap = new Minimap(world, this.mapBox);
    this.mapBox.appendChild(this.mapChip);
    this.mapBox.addEventListener('click', () => this.onButton?.('map'));
    this.mapBox.setAttribute('role', 'button');
    this.mapBox.setAttribute('aria-label', 'Open the map');
    this.purse.innerHTML = `<span class="cur cur-gold"><span class="cur-ic">${icon('coin')}</span><b data-p="gold"></b></span><span class="cur cur-aether"><span class="cur-ic">${icon('gem')}</span><b data-p="aether"></b></span><span class="cur cur-egg hide"><span class="cur-ic">${icon('egg')}</span><b data-p="egg"></b></span>`;
    const qb = (b: HudButton, ic: string, label: string, key: string, cls = '') => `<button class="qb ${cls}" data-b="${b}" aria-label="${label}"><span class="qb-ic">${ic}</span><span class="qb-l">${label}</span><kbd>${key}</kbd><i class="dot-badge"></i></button>`;
    this.quick.innerHTML = qb('map', icon('map'), 'Map', 'M') + qb('team', icon('paw'), 'Team', 'T') + qb('bag', icon('backpack'), 'Bag', 'B') + qb('journal', icon('book'), 'Menu', 'J', 'menu') + `<button class="qb pause" data-b="menu" aria-label="Pause">${glyph('pause')}<kbd>Esc</kbd></button>`;
    this.quick.querySelectorAll<HTMLElement>('[data-b]').forEach((b) => b.addEventListener('click', () => this.onButton?.(b.dataset.b as HudButton)));
    this.touch.innerHTML = `
      <button class="tb tb-strike" data-k="f" aria-label="Strike">${icon('sword')}<small>Strike</small></button>
      <button class="tb tb-jump" data-k=" " aria-label="Jump">${glyph('chevU')}<small>Jump</small></button>
      <button class="tb tb-sprint" data-k="shift" aria-label="Sprint">${icon('lightning_speed')}<small>Sprint</small></button>
      <button class="tb tb-ride" data-k="r" aria-label="Ride">${icon('paw')}<small>Ride</small></button>`;
    this.touch.querySelectorAll<HTMLElement>('.tb').forEach((b) => b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.classList.add('down');
      setTimeout(() => b.classList.remove('down'), 140);
      const k = b.dataset.k!;
      if (k === 'shift') {
        const on = !input.keys.has('shift');
        if (on) input.keys.add('shift'); else input.keys.delete('shift');
        b.classList.toggle('on', on);
      } else if (k === 'r') this.onButton?.('mount');
      else input.press(k === ' ' ? 'jump' : k);
    }));
    this.promptEl.addEventListener('pointerdown', (e) => { e.preventDefault(); input.press('e'); });
    this.badge.addEventListener('click', () => this.onButton?.('journal'));
    this.party.addEventListener('click', () => this.onButton?.('team'));
    this.track.addEventListener('click', () => this.onButton?.('quests'));
    this.ctxEl.addEventListener('click', () => this.onButton?.('build'));
    this.badge.setAttribute('aria-label', 'Profile and journal');
    this.track.setAttribute('aria-label', 'Tracked quest — open the quest log');
    const left = el('div', 'hud-left');
    left.append(this.badge, this.party, this.track);
    const right = el('div', 'hud-right');
    right.append(this.purse, this.mapBox);
    this.root.append(this.beacon.el, left, this.compass.el, right, this.quick, this.promptEl, this.grassEl, this.ctxEl, this.joyGhost, this.touch);
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
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    const w = this.world;
    this.updateBadge();
    this.updateParty();
    this.updateTracker();
    this.updateChip();
    odometer(this.purse.querySelector('[data-p=gold]')!, state.inv.gold);
    odometer(this.purse.querySelector('[data-p=aether]')!, state.inv.aether);
    const egg = this.purse.querySelector('.cur-egg')!;
    egg.classList.toggle('hide', !state.eggs.length);
    if (state.eggs.length) {
      const pct = Math.round(Math.max(...state.eggs.map((e) => 1 - e.stepsLeft / e.stepsTotal)) * 100);
      const t = `${Math.max(0, Math.min(99, pct))}%`;
      const b = egg.querySelector('b')!;
      if (b.textContent !== t) b.textContent = t;
    }
    this.updateQuick();

    // interaction prompt
    const it = w.nearInteract;
    const psig = it ? `${it.id}:${it.label}` : '';
    if (psig !== this.sig.prompt) {
      this.sig.prompt = psig;
      if (it) this.promptEl.innerHTML = `<kbd>E</kbd><span class="pr-ic">${icon(promptIcon(it))}</span><span class="pr-t">${esc(it.label)}</span>`;
      this.promptEl.classList.toggle('on', !!it);
    }
    const near = w.wilds.nearestTo(w.playerPos, 3.4);
    this.touch.querySelector('.tb-strike')!.classList.toggle('ready', !!near);
    this.touch.querySelector('.tb-ride')!.classList.toggle('on', !!w.mount);
    this.grassEl.classList.toggle('on', w.inTallGrass() && settings.hints && !it);
    const home = Math.hypot(w.playerPos.x - HOMESTEAD.center[0], w.playerPos.z - HOMESTEAD.center[1]) < HOMESTEAD.radius + 8;
    if (home && !this.ctxEl.innerHTML) this.ctxEl.innerHTML = `<kbd>H</kbd>${icon('hammer_build')}<span>Build</span>`;
    this.ctxEl.classList.toggle('on', home && !it);
    const joy = document.getElementById('joy');
    this.joyGhost.classList.toggle('away', !!joy && joy.style.display === 'block');

    this.compass.update();
    this.minimap.draw(dt);
    this.beacon.update(dt);
  }

  private updateBadge() {
    const r = state.rank;
    const s = `${state.profile.name}|${state.profile.title}|${r.level}|${r.xp}`;
    if (s === this.sig.badge) return;
    this.sig.badge = s;
    this.badge.innerHTML = `${npcAvatar('player', state.profile.name, 46, 'bd-av')}
      <span class="bd-body"><b class="bd-name ell">${esc(state.profile.name)}</b>
      <span class="bd-rank"><span class="bd-lv">Rank ${r.level}</span><span class="bar thin xp"><i style="--p:${(r.xp / rankXpToNext(r.level)).toFixed(3)}"></i></span></span></span>`;
  }

  private updateParty() {
    const s = state.team.map((c) => `${c.uid}:${c.hp}:${c.level}:${c.species}:${c.shiny}`).join('|');
    if (s === this.sig.party) return;
    this.sig.party = s;
    this.party.innerHTML = state.team.map((c, i) => {
      const max = statsOf(c).maxHp;
      const f = Math.max(0, Math.min(1, c.hp / max));
      const col = f <= 0.25 ? 'var(--hp-low)' : f <= 0.5 ? 'var(--hp-mid)' : 'var(--hp)';
      return `<span class="pt ${c.hp <= 0 ? 'ko' : ''} ${i >= 3 ? 'reserve' : ''}" title="${esc(displayName(c))} · Lv ${c.level} · ${c.hp}/${max} HP">
        <svg class="pt-ring" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21.5" class="pt-track"/><circle cx="24" cy="24" r="21.5" class="pt-hp" pathLength="100" style="stroke:${col};stroke-dasharray:${(f * 100).toFixed(1)} 100"/></svg>
        ${mysticFace(c.species, c.shiny, 38, '', 'pt-cap')}<span class="pt-lv">${c.level}</span></span>`;
    }).join('') || `<span class="pt-empty">${icon('paw')}<span>No Mystics yet</span></span>`;
    this.party.setAttribute('aria-label', `Party: ${state.team.map((c) => `${displayName(c)} level ${c.level}`).join(', ') || 'empty'}`);
  }

  private updateTracker() {
    const tt = trackedTarget();
    const q = tt?.quest ?? null;
    const w = this.world;
    let list: QuestView[] = [];
    if (!q) { try { list = api.quests.list(); } catch { list = []; } }
    const cur = q?.current;
    const s = q ? `${q.id}|${q.status}|${cur?.text}|${cur?.progress}|${cur?.count}|${q.title}` : `none|${list.length}`;
    if (s !== this.sig.track) {
      this.sig.track = s;
      this.track.className = `hud-track stk ${q ? `k-${q.kind} ${q.status}` : 'idle'}`;
      if (q) {
        const ready = q.status === 'ready';
        const obj = ready ? `Return to ${q.giver ?? 'the quest giver'}` : cur?.text ?? q.summary;
        const prog = !ready && cur?.count && cur.count > 1 ? `<span class="tk-prog"><span class="bar thin mag"><i style="--p:${Math.min(1, (cur.progress ?? 0) / cur.count).toFixed(3)}"></i></span><span class="tk-n">${cur.progress ?? 0}/${cur.count}</span></span>` : '';
        this.track.innerHTML = `<span class="tk-ic">${icon(ready ? 'gift' : QUEST_IC[q.kind])}</span>
          <span class="tk-body"><span class="tk-top"><b class="tk-title ell">${esc(q.title)}</b><span class="tk-dir"><span class="tk-arrow">${glyph('arrow')}</span><span class="tk-dist"></span></span></span>
          <span class="tk-obj">${esc(obj)}</span>${prog}</span>`;
        this.trackArrow = this.track.querySelector('.tk-arrow');
        this.trackDist = this.track.querySelector('.tk-dist');
      } else {
        this.track.innerHTML = list.length ? `<span class="tk-ic">${icon('quest_scroll')}</span><span class="tk-body"><b class="tk-title">Track a quest for directions</b></span><kbd>Q</kbd>` : '';
        this.trackArrow = this.trackDist = null;
      }
      this.track.classList.toggle('hide', !q && !list.length);
    }
    if (tt && this.trackArrow && this.trackDist) {
      const m = tt.marker;
      const d = Math.hypot(m.x - w.playerPos.x, m.z - w.playerPos.z);
      const rel = wrap180(bearingTo(w.playerPos.x, w.playerPos.z, m.x, m.z) - headingOf(w.camYaw));
      this.trackArrow.style.transform = `rotate(${rel.toFixed(0)}deg)`;
      const t = distText(d);
      if (this.trackDist.textContent !== t) this.trackDist.textContent = t;
      this.trackArrow.parentElement!.classList.toggle('hide', d < 7);
    } else if (this.trackArrow && !tt) this.trackArrow.parentElement!.classList.add('hide');
  }

  private updateChip() {
    const w = this.world;
    const z = w.zone;
    const night = w.atmo.night > 0.5;
    const [wi, wl] = WEATHER[z.weather] ?? ['cloud', ''];
    const s = `${z.id}|${clock(state.time)}|${night}`;
    if (s === this.sig.chip) return;
    this.sig.chip = s;
    this.mapChip.innerHTML = `<span class="mc-zone ell">${z.name}</span><span class="mc-time">${icon(night ? 'moon' : 'sun')}<span>${clock(state.time)}</span><span class="mc-w" title="${wl}">${icon(wi)}</span></span>`;
  }

  private updateQuick() {
    let v = -1;
    try { v = api.quests.version(); } catch { /* stub */ }
    if (v !== this.readyVersion) {
      this.readyVersion = v;
      try { this.readyCount = api.quests.list().filter((q) => q.status === 'ready').length; } catch { this.readyCount = 0; }
    }
    const n = this.readyCount + claimableCount();
    const canRide = [...state.team, ...state.box].some((c) => SPECIES[c.species]?.rideable);
    const s = `${n}|${canRide}|${state.team.map((c) => speciesOf(c).id).join()}`;
    if (s === this.sig.quick) return;
    this.sig.quick = s;
    const badge = this.quick.querySelector('.menu .dot-badge') as HTMLElement;
    badge.textContent = n ? String(n) : '';
    badge.classList.toggle('on', n > 0);
    this.touch.querySelector('.tb-ride')!.classList.toggle('hide', !canRide);
  }
}
