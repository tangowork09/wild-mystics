import { portrait } from '../assets/manifest';
import { ELEMENTS } from '../data/elements';
import { ORBS, ITEMS, type OrbId, type ItemId } from '../data/items';
import { STATUS, RARITY } from '../data/traits';
import { SPECIES } from '../data/species';
import type { Skill } from '../data/skills';
import { rankedAp, skillList, xpToNext, displayName, geneGrade, trainReady, type Creature } from '../game/creature';
import { state } from '../game/state';
import { sfx } from '../core/audio';
import { haptic } from '../core/haptics';
import { icon, glyph } from '../ui/icons';
import { mysticFace } from '../ui/kit';
import type { Unit } from './unit';

export type Action =
  | { type: 'skill'; skill: Skill; rank: number }
  | { type: 'burst' }
  | { type: 'capture'; orb: OrbId }
  | { type: 'item'; item: ItemId }
  | { type: 'swap' }
  | { type: 'flee' }
  | { type: 'auto' };

export interface MenuCtx { canCapture: boolean; canFlee: boolean; canSwap: boolean; burstReady: boolean; isNight: boolean; zone: string }

const auto = () => !!(window as unknown as { __autoplay?: boolean }).__autoplay;
const isTouchUI = () => document.documentElement.classList.contains('touch');
const BATTLE_ITEMS: ItemId[] = ['tonic', 'mega_tonic', 'elixir', 'ether', 'cleanse'];
const speciesRarity = (c: Creature) => SPECIES[c.species]?.rarity ?? 'common';

const h = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class BattleUI {
  root = h('div', 'battle-ui');
  private timeline = h('div', 'b-timeline');
  private enemyBox = h('div', 'b-enemies');
  private partyBox = h('div', 'b-party');
  private actions = h('div', 'b-actions');
  private sub = h('div', 'b-sub');
  private hint = h('div', 'b-hint');
  private qteLayer = h('div', 'b-qte');
  private banner = h('div', 'b-banner');
  private skillTag = h('div', 'b-skilltag');
  private floaters = h('div', 'b-floaters');
  private defense = h('div', 'b-defense');
  private markers = h('div', 'b-markers');
  private burstEl = h('div', 'b-burst');
  private toggles = h('div', 'b-toggles');
  private cards = new Map<Unit, HTMLElement>();
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private speedVal = 1;
  private autoOn = false;
  private pendingMenu: ((a: Action) => void) | null = null;
  onDefense?: (kind: 'parry' | 'dodge' | 'jump', t: number) => void;
  onQte?: (t: number) => void;
  onAuto?: (on: boolean) => void;
  onSpeed?: (s: number) => void;
  onTargetChange?: (u: Unit) => void;
  private pickClick?: (u: Unit) => void;

  constructor(private project: (u: Unit, yFrac?: number) => { x: number; y: number; visible: boolean }) {
    this.root.append(this.timeline, this.enemyBox, this.partyBox, this.burstEl, this.markers, this.actions, this.sub, this.hint, this.qteLayer, this.banner, this.skillTag, this.floaters, this.defense, this.toggles);
    this.defense.innerHTML = `
      <button class="def-btn dodge" data-k="dodge">${icon('footprint')}<b>Dodge</b><kbd>Q</kbd></button>
      <button class="def-btn jump" data-k="jump">${glyph('chevU')}<b>Jump</b><kbd>W</kbd></button>
      <button class="def-btn parry" data-k="parry">${icon('shield')}<b>Parry</b><kbd>E</kbd></button>`;
    this.defense.querySelectorAll('button').forEach((b) => b.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      this.onDefense?.((b as HTMLElement).dataset.k as 'parry' | 'dodge' | 'jump', performance.now());
      haptic('light');
      b.classList.add('pressed');
      setTimeout(() => b.classList.remove('pressed'), 120);
    }));
    this.burstEl.innerHTML = `<span class="bb-label">${icon('sparkles')}<span>Burst</span></span><span class="bb-bar"><i></i></span>`;
    this.toggles.innerHTML = `<button class="tg auto" title="Auto battle (A)" aria-pressed="false">${icon('crystal_ball')}<span>Auto</span><kbd>A</kbd></button><button class="tg speed" title="Battle speed (X)">${icon('lightning_speed')}<span>1×</span><kbd>X</kbd></button>`;
    this.toggles.querySelector('.auto')!.addEventListener('click', () => this.toggleAuto());
    this.toggles.querySelector('.speed')!.addEventListener('click', () => this.cycleSpeed());
    addEventListener('keydown', this.globalKeys, true);
    this.qteLayer.addEventListener('pointerdown', (ev) => { ev.preventDefault(); this.onQte?.(performance.now()); });
    document.getElementById('ui')!.appendChild(this.root);
    requestAnimationFrame(() => this.root.classList.add('in'));
  }

  private globalKeys = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === 'x') this.cycleSpeed();
    if (k === 'a' && !this.hint.classList.contains('open')) this.toggleAuto();
  };
  private toggleAuto() {
    this.autoOn = !this.autoOn;
    this.toggles.querySelector('.auto')!.classList.toggle('on', this.autoOn);
    this.toggles.querySelector('.auto')!.setAttribute('aria-pressed', String(this.autoOn));
    this.onAuto?.(this.autoOn);
    sfx('select');
    if (this.autoOn && this.pendingMenu) this.pendingMenu({ type: 'auto' });
  }
  private cycleSpeed() {
    const s = this.speedVal === 1 ? 1.5 : this.speedVal === 1.5 ? 2 : 1;
    this.setSpeed(s);
    this.onSpeed?.(s);
    sfx('select');
  }
  setSpeed(s: number) { this.speedVal = s; (this.toggles.querySelector('.speed span') as HTMLElement).textContent = `${s}×`; }
  setBurst(v: number) {
    (this.burstEl.querySelector('.bb-bar i') as HTMLElement).style.setProperty('--p', String(Math.min(1, v / 100)));
    this.burstEl.classList.toggle('full', v >= 100);
  }

  destroy() {
    this.clearKeys();
    removeEventListener('keydown', this.globalKeys, true);
    this.root.classList.remove('in');
    setTimeout(() => this.root.remove(), 400);
  }

  // ── HUD ────────────────────────────────────────────────────────────
  mount(units: Unit[]) {
    this.enemyBox.innerHTML = '';
    this.partyBox.innerHTML = '';
    this.cards.clear();
    for (const u of units) this.addCard(u);
  }

  addCard(u: Unit) {
    const el = ELEMENTS[u.sp.element];
    const rar = RARITY[u.sp.rarity];
    if (u.side === 'enemy') {
      const c = h('div', `e-card${u.boss ? ' boss' : ''}${u.c.shiny ? ' shiny' : ''}`);
      c.style.setProperty('--el', el.color);
      c.style.setProperty('--rar', rar.color);
      c.innerHTML = `<div class="e-top"><span class="glyph">${icon(u.sp.element)}</span><span class="nm">${u.c.shiny ? `<i class="shiny">${icon('sparkles')}</i>` : ''}${u.name}</span><span class="lv">Lv ${u.c.level}</span></div>
        <div class="bbar hp"><i></i><em></em></div><div class="bbar brk" title="Break"><i></i></div><div class="st"></div>`;
      c.addEventListener('click', () => this.pickClick?.(u));
      this.enemyBox.appendChild(c);
      this.cards.set(u, c);
    } else {
      const c = h('div', 'p-card');
      c.style.setProperty('--el', el.color);
      c.innerHTML = `${mysticFace(u.c.species, u.c.shiny, 50, '', 'p-cap')}<div class="p-body"><div class="p-top"><span class="glyph">${icon(u.sp.element)}</span><span class="nm">${u.name}</span><span class="lv">Lv ${u.c.level}</span></div>
        <div class="bbar hp"><i></i><b class="sh"></b><em></em></div><div class="p-foot"><div class="ap" aria-label="Action points"></div><div class="st"></div></div></div>`;
      c.addEventListener('click', () => this.pickClick?.(u));
      this.partyBox.appendChild(c);
      this.cards.set(u, c);
    }
  }

  replaceCard(old: Unit, next: Unit) {
    const c = this.cards.get(old);
    c?.remove();
    this.cards.delete(old);
    this.addCard(next);
  }

  refresh(units: Unit[], active?: Unit | null) {
    for (const u of units) {
      const c = this.cards.get(u);
      if (!c) continue;
      const hp = Math.max(0, u.c.hp), max = u.maxHp;
      (c.querySelector('.bbar.hp i') as HTMLElement).style.setProperty('--p', String(hp / max));
      (c.querySelector('.bbar.hp em') as HTMLElement).textContent = `${hp}/${max}`;
      c.querySelector('.bbar.hp')!.classList.toggle('mid', hp / max <= 0.5 && hp / max > 0.25);
      const sh = c.querySelector('.bbar.hp .sh') as HTMLElement | null;
      if (sh) sh.style.setProperty('--p', String(Math.min(1, u.shield / max)));
      c.classList.toggle('low', hp / max < 0.3);
      c.classList.toggle('dead', !u.alive);
      c.classList.toggle('active', u === active);
      if (u.side === 'enemy') {
        (c.querySelector('.bbar.brk i') as HTMLElement).style.setProperty('--p', String(u.broken ? 1 : u.brk / u.brkMax));
        c.classList.toggle('broken', u.broken);
        c.style.display = u.gone || u.captured ? 'none' : '';
      } else {
        const ap = c.querySelector('.ap') as HTMLElement;
        ap.innerHTML = Array.from({ length: 9 }, (_, i) => `<i class="${i < u.ap ? 'on' : ''}"></i>`).join('');
      }
      const st = c.querySelector('.st') as HTMLElement;
      st.innerHTML = [
        u.status ? `<b class="tag status" style="--c:${STATUS[u.status.id].color}">${STATUS[u.status.id].short}</b>` : '',
        u.broken ? '<b class="tag brk">Broken</b>' : '',
        u.enraged ? '<b class="tag rage">Enraged</b>' : '',
        ...u.buffs.map((b) => `<b class="tag ${b.amount > 0 ? 'up' : 'down'}">${b.stat.toUpperCase()}${glyph(b.amount > 0 ? 'chevU' : 'chevD')}${b.turns}</b>`),
      ].join('');
    }
  }

  setTimeline(order: Unit[], active: Unit | null) {
    this.timeline.innerHTML = order.map((u, i) => {
      const el = ELEMENTS[u.sp.element];
      return `<div class="tl ${u.side} ${i === 0 && u === active ? 'now' : ''}" style="--el:${el.color}"><img src="${portrait(u.c.species, u.c.shiny)}" alt=""></div>`;
    }).join('');
  }

  // ── Menus ──────────────────────────────────────────────────────────
  private clearKeys() {
    if (this.keyHandler) removeEventListener('keydown', this.keyHandler, true);
    this.keyHandler = null;
  }
  private keys(fn: (k: string, e: KeyboardEvent) => void) {
    this.clearKeys();
    this.keyHandler = (e) => { fn(e.key.toLowerCase(), e); };
    addEventListener('keydown', this.keyHandler, true);
  }

  menu(u: Unit, ctx: MenuCtx): Promise<Action> {
    return new Promise((resolve) => {
      const done = (a: Action) => {
        this.pendingMenu = null;
        this.clearKeys();
        this.actions.classList.remove('open');
        this.sub.classList.remove('open');
        resolve(a);
      };
      this.pendingMenu = done;
      const subHeader = (title: string, extra = '') => `<div class="sub-title"><b>${title}</b>${extra ? `<small>${extra}</small>` : ''}</div>`;
      const backBtn = `<button class="back">${glyph('back')} Back <kbd>Esc</kbd></button>`;
      const showMain = () => {
        this.sub.classList.remove('open');
        this.actions.classList.add('open');
        const strike = skillList(u.c)[0];
        const items = BATTLE_ITEMS.reduce((a, it) => a + (state.inv.items[it] ?? 0), 0);
        const orbs = Object.values(state.inv.orbs).reduce((a, b) => a + b, 0);
        this.actions.innerHTML = `
          <div class="who"><span class="nm">${u.name}</span><span class="who-ap"><b class="tnum">${u.ap}</b> AP</span></div>
          ${ctx.burstReady ? `<button class="act burst" data-a="burst"><kbd>B</kbd>${icon('sparkles')}<b>Burst</b><small>Ultimate</small></button>` : ''}
          <div class="act-grid">
            <button class="act main atk" data-a="attack"><kbd>1</kbd><span class="act-ic">${icon('sword')}</span><b>Attack</b><small>+1 AP</small></button>
            <button class="act main skl" data-a="skills"><kbd>2</kbd><span class="act-ic">${icon('sparkles')}</span><b>Skills</b><small>Spend AP</small></button>
            <button class="act main cap ${ctx.canCapture && orbs ? '' : 'off'}" data-a="capture"><kbd>3</kbd><span class="act-ic">${icon('orb')}</span><b>Capture</b><small class="tnum">${ctx.canCapture ? `${orbs} orbs` : 'Wild only'}</small></button>
            <button class="act main itm ${items ? '' : 'off'}" data-a="items"><kbd>4</kbd><span class="act-ic">${icon('potion')}</span><b>Items</b><small class="tnum">${items} left</small></button>
          </div>
          <div class="act-row">
            <button class="act mini ${ctx.canSwap ? '' : 'off'}" data-a="swap"><kbd>5</kbd>${glyph('swap')}Swap</button>
            <button class="act mini ${ctx.canFlee ? '' : 'off'}" data-a="flee"><kbd>6</kbd>${glyph('back')}Flee</button>
          </div>`;
        const go = (a: string) => {
          sfx('select');
          if (a === 'burst' && ctx.burstReady) done({ type: 'burst' });
          else if (a === 'attack') done({ type: 'skill', skill: strike.skill, rank: 1 });
          else if (a === 'skills') showSkills();
          else if (a === 'capture' && ctx.canCapture && orbs) showOrbs();
          else if (a === 'items' && items) showItems();
          else if (a === 'swap' && ctx.canSwap) done({ type: 'swap' });
          else if (a === 'flee' && ctx.canFlee) done({ type: 'flee' });
        };
        this.actions.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => go((b as HTMLElement).dataset.a!)));
        this.keys((k) => {
          const map: Record<string, string> = { '1': 'attack', '2': 'skills', '3': 'capture', '4': 'items', '5': 'swap', '6': 'flee', f: 'attack', b: 'burst' };
          if (map[k]) go(map[k]);
        });
      };
      const showSkills = () => {
        const list = skillList(u.c).slice(1);
        this.actions.classList.remove('open');
        this.sub.classList.add('open');
        this.sub.innerHTML = subHeader('Skills', `${u.ap} AP available`) + list.map(({ skill, rank }, i) => {
          const cost = rankedAp(skill, rank);
          const el = ELEMENTS[skill.element];
          const ok = u.ap >= cost;
          const tag = skill.status ? `<i class="stag" style="--c:${STATUS[skill.status.id].color}">${STATUS[skill.status.id].short} ${Math.round(skill.status.chance * 100)}%</i>` : '';
          return `<button class="skill ${ok ? '' : 'off'}" data-i="${i}" style="--el:${el.color}"><kbd>${i + 1}</kbd><span class="glyph">${icon(skill.element)}</span><span class="sn">${skill.name}${rank > 1 ? ` <i class="rank">+${rank - 1}</i>` : ''}${tag}</span><span class="sd">${skill.desc}${skill.hits > 1 ? ` · ${skill.hits} hits` : ''}</span><span class="cost tnum">${cost}<small>AP</small></span></button>`;
        }).join('') + backBtn;
        const pickSkill = (i: number) => {
          const it = list[i];
          if (!it) return;
          if (u.ap < rankedAp(it.skill, it.rank)) { sfx('error'); return; }
          sfx('select');
          done({ type: 'skill', skill: it.skill, rank: it.rank });
        };
        this.sub.querySelectorAll('button.skill').forEach((b) => b.addEventListener('click', () => pickSkill(Number((b as HTMLElement).dataset.i))));
        this.sub.querySelector('.back')!.addEventListener('click', () => { sfx('back'); showMain(); });
        this.keys((k) => {
          if (k === 'escape' || k === 'backspace') { sfx('back'); showMain(); }
          const n = Number(k);
          if (n >= 1 && n <= 5) pickSkill(n - 1);
        });
      };
      const showOrbs = () => {
        this.actions.classList.remove('open');
        this.sub.classList.add('open');
        const owned = (Object.keys(ORBS) as OrbId[]).filter((o) => state.inv.orbs[o] > 0);
        this.sub.innerHTML = subHeader('Capture') + owned.map((o, i) => {
          const d = ORBS[o];
          const special = o === 'dusk' && (ctx.isNight || ctx.zone === 'marsh') ? ' · ×2.5 now!' : '';
          return `<button class="skill orb" data-o="${o}" style="--el:${d.color}"><kbd>${i + 1}</kbd><span class="orb-art" style="--c:${d.color};--b:${d.band}"></span><span class="sn">${d.name}</span><span class="sd">${d.desc}${special}</span><span class="cost tnum">${state.inv.orbs[o]}<small>left</small></span></button>`;
        }).join('') + backBtn;
        const pickOrb = (o: OrbId | undefined) => { if (!o) return; sfx('select'); done({ type: 'capture', orb: o }); };
        this.sub.querySelectorAll<HTMLElement>('button.orb').forEach((b) => b.addEventListener('click', () => pickOrb(b.dataset.o as OrbId)));
        this.sub.querySelector('.back')!.addEventListener('click', () => { sfx('back'); showMain(); });
        this.keys((k) => { if (k === 'escape' || k === 'backspace') { sfx('back'); showMain(); } const n = Number(k); if (n >= 1) pickOrb(owned[n - 1]); });
      };
      const showItems = () => {
        this.actions.classList.remove('open');
        this.sub.classList.add('open');
        const owned = BATTLE_ITEMS.filter((it) => (state.inv.items[it] ?? 0) > 0);
        this.sub.innerHTML = subHeader('Items') + owned.map((it, i) => `<button class="skill" data-it="${it}"><kbd>${i + 1}</kbd><span class="glyph">${icon(ITEMS[it].icon)}</span><span class="sn">${ITEMS[it].name}</span><span class="sd">${ITEMS[it].desc}</span><span class="cost tnum">${state.inv.items[it]}<small>left</small></span></button>`).join('') + backBtn;
        const pickItem = (it: ItemId | undefined) => { if (!it) return; sfx('select'); done({ type: 'item', item: it }); };
        this.sub.querySelectorAll<HTMLElement>('button.skill').forEach((b) => b.addEventListener('click', () => pickItem(b.dataset.it as ItemId)));
        this.sub.querySelector('.back')!.addEventListener('click', () => { sfx('back'); showMain(); });
        this.keys((k) => { if (k === 'escape' || k === 'backspace') { sfx('back'); showMain(); } const n = Number(k); if (n >= 1) pickItem(owned[n - 1]); });
      };
      showMain();
      if (auto()) setTimeout(() => {
        if ((window as unknown as { __autoCapture?: boolean }).__autoCapture && ctx.canCapture && state.inv.orbs.mystic > 0) { done({ type: 'capture', orb: 'mystic' }); return; }
        if (ctx.burstReady) { done({ type: 'burst' }); return; }
        const list = skillList(u.c).slice(1).filter((x) => x.skill.kind === 'attack' && u.ap >= rankedAp(x.skill, x.rank));
        const c = list[list.length - 1] ?? skillList(u.c)[0];
        done({ type: 'skill', skill: c.skill, rank: c.rank });
      }, 700);
    });
  }

  /** Choose one unit among candidates (arrow keys / click / tap marker). Resolves null on cancel. */
  pickTarget(cands: Unit[], title: string, detail?: (u: Unit) => string, allowCancel = true): Promise<Unit | null> {
    return new Promise((resolve) => {
      let i = 0;
      let finished = false;
      let raf = 0;
      this.hint.classList.add('open');
      const draw = () => {
        const u = cands[i];
        this.hint.innerHTML = `<span class="h-ic">${glyph('target')}</span><b>${title}</b><span class="h-t">${u.name}${detail ? ` · ${detail(u)}` : ''}</span><small>${isTouchUI() ? 'Tap a marker to choose, tap again to confirm' : `<kbd>${glyph('chevL')}</kbd><kbd>${glyph('chevR')}</kbd> choose · <kbd>Enter</kbd> confirm${allowCancel ? ' · <kbd>Esc</kbd> back' : ''}`}</small>`;
        this.markers.innerHTML = cands.map((_, j) => `<button class="mk ${j === i ? 'sel' : ''}" data-j="${j}" aria-label="Target ${j + 1}">${glyph('caret')}</button>`).join('');
        this.markers.querySelectorAll('.mk').forEach((b) => b.addEventListener('click', () => {
          const j = Number((b as HTMLElement).dataset.j);
          if (j === i) finish(cands[i]); else { i = j; sfx('select'); draw(); this.onTargetChange?.(cands[i]); }
        }));
        this.positionMarkers(cands);
        for (const [unit, card] of this.cards) card.classList.toggle('targeted', unit === u);
      };
      const finish = (u: Unit | null) => {
        if (finished) return;
        finished = true;
        this.clearKeys();
        this.hint.classList.remove('open');
        this.markers.innerHTML = '';
        this.pickClick = undefined;
        for (const card of this.cards.values()) card.classList.remove('targeted');
        cancelAnimationFrame(raf);
        resolve(u);
      };
      this.pickClick = (u) => {
        const j = cands.indexOf(u);
        if (j < 0) return;
        if (j === i) finish(u); else { i = j; sfx('select'); draw(); this.onTargetChange?.(cands[i]); }
      };
      this.keys((k) => {
        if (k === 'arrowleft' || k === 'a' || k === 'arrowup' || k === 'w') { i = (i + cands.length - 1) % cands.length; sfx('select'); draw(); this.onTargetChange?.(cands[i]); }
        if (k === 'arrowright' || k === 'd' || k === 'arrowdown' || k === 's') { i = (i + 1) % cands.length; sfx('select'); draw(); this.onTargetChange?.(cands[i]); }
        if (k === 'enter' || k === ' ' || k === 'f') finish(cands[i]);
        if (allowCancel && (k === 'escape' || k === 'backspace')) { sfx('back'); finish(null); }
      });
      const loop = () => { this.positionMarkers(cands); raf = requestAnimationFrame(loop); };
      draw();
      raf = requestAnimationFrame(loop);
      this.onTargetChange?.(cands[i]);
      if (auto()) setTimeout(() => finish(cands[0]), 600);
    });
  }

  private positionMarkers(cands: Unit[]) {
    const els = this.markers.querySelectorAll('.mk');
    cands.forEach((u, j) => {
      const p = this.project(u, 1.15);
      const el = els[j] as HTMLElement | undefined;
      if (!el) return;
      el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      el.style.display = p.visible ? '' : 'none';
    });
  }

  // ── QTE ring ───────────────────────────────────────────────────────
  ring(kind: 'attack' | 'defend' | 'red' | 'gold' | 'capture') {
    const el = h('div', `ring ${kind}`);
    el.innerHTML = '<div class="outer"></div><div class="inner"></div><div class="lbl"></div>';
    this.qteLayer.appendChild(el);
    this.qteLayer.classList.add('open');
    const outer = el.querySelector('.outer') as HTMLElement;
    return {
      set: (x: number, y: number, progress: number) => {
        el.style.transform = `translate(${x}px, ${y}px)`;
        const s = 1 + (1 - Math.min(1, progress)) * 2.6;
        outer.style.transform = `translate(-50%,-50%) scale(${s})`;
        outer.style.opacity = String(Math.min(1, progress * 3));
      },
      judge: (text: string, cls: string) => {
        el.classList.add('done', cls);
        (el.querySelector('.lbl') as HTMLElement).textContent = text;
        setTimeout(() => { el.remove(); if (!this.qteLayer.children.length) this.qteLayer.classList.remove('open'); }, 520);
      },
      remove: () => { el.remove(); if (!this.qteLayer.children.length) this.qteLayer.classList.remove('open'); },
    };
  }

  showDefense(on: boolean, jump = false) {
    this.defense.classList.toggle('open', on);
    this.defense.classList.toggle('with-jump', jump);
  }

  // ── Text ───────────────────────────────────────────────────────────
  float(x: number, y: number, text: string, cls = '') {
    const e = h('div', `fl ${cls}`, text);
    e.style.left = `${x}px`;
    e.style.top = `${y}px`;
    this.floaters.appendChild(e);
    setTimeout(() => e.remove(), 1300);
  }

  bannerText(text: string, cls = '', ms = 1100) {
    const e = h('div', `bn ${cls}`, text);
    this.banner.appendChild(e);
    setTimeout(() => e.classList.add('out'), ms);
    setTimeout(() => e.remove(), ms + 500);
  }

  skill(name: string, color: string, who: string, ultimate = false) {
    this.skillTag.innerHTML = `<div class="sk ${ultimate ? 'ult' : ''}" style="--el:${color}"><small>${who}</small>${name}</div>`;
    this.skillTag.classList.add('open');
  }
  hideSkill() { this.skillTag.classList.remove('open'); }

  hideHud(hide: boolean) { this.root.classList.toggle('hud-hidden', hide); }

  // ── Results ────────────────────────────────────────────────────────
  results(o: { title: string; sub: string; xp: number; gold: number; shards: [string, number][]; team: { c: Creature; beforeLv: number; beforeXp: number; newSkills: string[] }[]; captured: Creature[]; drops: string[] }): Promise<void> {
    return new Promise((resolve) => {
      const wrap = h('div', 'b-results');
      const shardHtml = o.shards.map(([el, n]) => `<span class="rw"><span class="item-art" style="--c:${ELEMENTS[el as keyof typeof ELEMENTS].color}">${icon(el)}</span><span class="rw-t"><b class="tnum">${n}</b> ${ELEMENTS[el as keyof typeof ELEMENTS].name}</span></span>`).join('');
      const dropHtml = o.drops.map((d) => `<span class="rw"><span class="item-art">${icon(ITEMS[d as ItemId]?.icon ?? 'gift')}</span><span class="rw-t">${ITEMS[d as ItemId]?.name ?? d}</span></span>`).join('');
      wrap.innerHTML = `<div class="r-card stk">
        <header class="r-head"><div class="r-title display">${o.title}</div><div class="r-sub">${o.sub}</div></header>
        <div class="r-cols"><div class="r-left">
          <div class="r-gains"><span class="rw"><span class="item-art" style="--c:var(--xp)">${glyph('star')}</span><span class="rw-t"><b class="tnum">${o.xp}</b> XP</span></span><span class="rw"><span class="item-art" style="--c:var(--coin)">${icon('coin')}</span><span class="rw-t"><b class="tnum">${o.gold}</b> Gold</span></span>${shardHtml}${dropHtml}</div>
          ${o.captured.map((c) => `<div class="r-cap ${c.shiny ? 'shiny' : ''}" style="--rar:${RARITY[speciesRarity(c)].color}">${mysticFace(c.species, c.shiny, 52)}<div><b>${displayName(c)} joined your journey!</b><small>${RARITY[speciesRarity(c)].name} · Lv ${c.level} · Genes ${geneGrade(c.genes)}${c.shiny ? ' · Shiny' : ''}</small></div></div>`).join('')}
        </div>
        <div class="r-team">${o.team.map((t) => {
          const ready = trainReady(t.c); // v3: full XP bar → train it in Team → Train (Miscrits-style)
          return `<div class="r-mon ${ready ? 'up' : ''}">${mysticFace(t.c.species, t.c.shiny, 40)}<div class="r-info"><div class="r-name"><b>${displayName(t.c)}</b><span class="lv tnum">Lv ${t.c.level}</span></div>
            <div class="bar xp"><i style="--p:${t.beforeXp / xpToNext(t.beforeLv)}" data-to="${t.c.xp / xpToNext(t.c.level)}"></i></div>
            </div>${ready ? '<span class="r-up">Ready to train!</span>' : ''}</div>`;
        }).join('')}</div></div>
        <div class="r-foot"><button class="btn primary big r-go">Continue <kbd>Enter</kbd></button></div></div>`;
      this.root.appendChild(wrap);
      requestAnimationFrame(() => {
        wrap.classList.add('in');
        setTimeout(() => wrap.querySelectorAll<HTMLElement>('.bar.xp i').forEach((i) => { i.style.setProperty('--p', i.dataset.to ?? '0'); }), 450);
      });
      const close = () => { this.clearKeys(); sfx('select'); wrap.remove(); resolve(); };
      wrap.querySelector('.r-go')!.addEventListener('click', close);
      setTimeout(() => this.keys((k) => { if (k === 'enter' || k === ' ' || k === 'e') close(); }), 400);
      if (auto() || this.autoOn) setTimeout(close, 3200);
    });
  }
}
