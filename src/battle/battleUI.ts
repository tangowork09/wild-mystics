import { portrait } from '../assets/manifest';
import { ELEMENTS } from '../data/elements';
import type { Skill } from '../data/skills';
import { rankedAp, skillList, statsOf, xpToNext, displayName, type Creature } from '../game/creature';
import { state } from '../game/state';
import { sfx } from '../core/audio';
import type { Unit } from './unit';

export type Action =
  | { type: 'skill'; skill: Skill; rank: number }
  | { type: 'capture'; great: boolean }
  | { type: 'item'; item: 'potion' | 'elixir' }
  | { type: 'swap' }
  | { type: 'flee' };

export interface MenuCtx { canCapture: boolean; canFlee: boolean; canSwap: boolean; }

const auto = () => !!(window as unknown as { __autoplay?: boolean }).__autoplay;

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
  private cards = new Map<Unit, HTMLElement>();
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  onDefense?: (kind: 'parry' | 'dodge', t: number) => void;
  onQte?: (t: number) => void;

  constructor(private project: (u: Unit, yFrac?: number) => { x: number; y: number; visible: boolean }) {
    this.root.append(this.timeline, this.enemyBox, this.partyBox, this.markers, this.actions, this.sub, this.hint, this.qteLayer, this.banner, this.skillTag, this.floaters, this.defense);
    this.defense.innerHTML = '<button class="def-btn dodge" data-k="dodge"><b>DODGE</b><small>Q / Shift</small></button><button class="def-btn parry" data-k="parry"><b>PARRY</b><small>E / Space</small></button>';
    this.defense.querySelectorAll('button').forEach((b) => b.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      this.onDefense?.((b as HTMLElement).dataset.k as 'parry' | 'dodge', performance.now());
      b.classList.add('pressed');
      setTimeout(() => b.classList.remove('pressed'), 120);
    }));
    this.qteLayer.addEventListener('pointerdown', (ev) => { ev.preventDefault(); this.onQte?.(performance.now()); });
    document.getElementById('ui')!.appendChild(this.root);
    requestAnimationFrame(() => this.root.classList.add('in'));
  }

  destroy() {
    this.clearKeys();
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
    if (u.side === 'enemy') {
      const c = h('div', `e-card${u.boss ? ' boss' : ''}`);
      c.innerHTML = `<div class="e-top"><span class="glyph" style="color:${el.color}">${el.glyph}</span><span class="nm">${u.c.shiny ? '<i class="shiny">✧</i>' : ''}${u.name}</span><span class="lv">Lv ${u.c.level}</span></div>
        <div class="bar hp"><i></i><em></em></div><div class="bar brk"><i></i></div><div class="st"></div>`;
      c.addEventListener('click', () => this.pickClick?.(u));
      this.enemyBox.appendChild(c);
      this.cards.set(u, c);
    } else {
      const c = h('div', 'p-card');
      c.innerHTML = `<img class="pt" src="${portrait(u.c.species, u.c.shiny)}" alt=""><div class="p-body"><div class="p-top"><span class="glyph" style="color:${el.color}">${el.glyph}</span><span class="nm">${u.name}</span><span class="lv">Lv ${u.c.level}</span></div>
        <div class="bar hp"><i></i><em></em></div><div class="ap"></div><div class="st"></div></div>`;
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
      (c.querySelector('.bar.hp i') as HTMLElement).style.width = `${(hp / max) * 100}%`;
      (c.querySelector('.bar.hp em') as HTMLElement).textContent = `${hp} / ${max}`;
      c.classList.toggle('low', hp / max < 0.3);
      c.classList.toggle('dead', !u.alive);
      c.classList.toggle('active', u === active);
      if (u.side === 'enemy') {
        (c.querySelector('.bar.brk i') as HTMLElement).style.width = `${u.broken ? 100 : (u.brk / u.brkMax) * 100}%`;
        c.classList.toggle('broken', u.broken);
        c.style.display = u.gone || u.captured ? 'none' : '';
      } else {
        const ap = c.querySelector('.ap') as HTMLElement;
        ap.innerHTML = Array.from({ length: 9 }, (_, i) => `<i class="${i < u.ap ? 'on' : ''}"></i>`).join('');
      }
      const st = c.querySelector('.st') as HTMLElement;
      st.innerHTML = [
        u.broken ? '<b class="tag brk">BROKEN</b>' : '',
        u.enraged ? '<b class="tag rage">ENRAGED</b>' : '',
        ...u.buffs.map((b) => `<b class="tag ${b.amount > 0 ? 'up' : 'down'}">${b.stat.toUpperCase()} ${b.amount > 0 ? '▲' : '▼'}${b.turns}</b>`),
      ].join('');
    }
  }

  setTimeline(order: Unit[], active: Unit | null) {
    this.timeline.innerHTML = '<div class="tl-label">TURN ORDER</div>' + order.map((u, i) => {
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
      const showMain = () => {
        this.sub.classList.remove('open');
        this.actions.classList.add('open');
        const strike = skillList(u.c)[0];
        const items = state.inv.potions + state.inv.elixirs;
        const orbs = state.inv.orbs + state.inv.greatOrbs;
        this.actions.innerHTML = `
          <div class="who">${u.name}<small>${u.ap} AP</small></div>
          <button class="act main atk" data-a="attack"><kbd>1</kbd><b>Attack</b><small>+1 AP</small></button>
          <button class="act main skl" data-a="skills"><kbd>2</kbd><b>Skills</b><small>Spend AP</small></button>
          <button class="act main cap ${ctx.canCapture && orbs ? '' : 'off'}" data-a="capture"><kbd>3</kbd><b>Capture</b><small>${orbs} orbs</small></button>
          <button class="act main itm ${items ? '' : 'off'}" data-a="items"><kbd>4</kbd><b>Items</b><small>${items} left</small></button>
          <div class="act-row">
            <button class="act mini ${ctx.canSwap ? '' : 'off'}" data-a="swap"><kbd>5</kbd>Swap</button>
            <button class="act mini ${ctx.canFlee ? '' : 'off'}" data-a="flee"><kbd>6</kbd>Flee</button>
          </div>`;
        const go = (a: string) => {
          sfx('select');
          if (a === 'attack') { done({ type: 'skill', skill: strike.skill, rank: 1 }); }
          else if (a === 'skills') showSkills();
          else if (a === 'capture' && ctx.canCapture && orbs) showOrbs();
          else if (a === 'items' && items) showItems();
          else if (a === 'swap' && ctx.canSwap) done({ type: 'swap' });
          else if (a === 'flee' && ctx.canFlee) done({ type: 'flee' });
        };
        this.actions.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => go((b as HTMLElement).dataset.a!)));
        this.keys((k) => {
          const map: Record<string, string> = { '1': 'attack', '2': 'skills', '3': 'capture', '4': 'items', '5': 'swap', '6': 'flee', f: 'attack', ' ': 'attack' };
          if (map[k]) go(map[k]);
        });
      };
      const showSkills = () => {
        const list = skillList(u.c).slice(1);
        this.actions.classList.remove('open');
        this.sub.classList.add('open');
        this.sub.innerHTML = `<div class="sub-title">Skills <small>${u.ap} AP available</small></div>` + list.map(({ skill, rank }, i) => {
          const cost = rankedAp(skill, rank);
          const el = ELEMENTS[skill.element];
          const ok = u.ap >= cost;
          return `<button class="skill ${ok ? '' : 'off'}" data-i="${i}" style="--el:${el.color}"><kbd>${i + 1}</kbd><span class="glyph">${el.glyph}</span><span class="sn">${skill.name}${rank > 1 ? ` <i class="rank">+${rank - 1}</i>` : ''}</span><span class="sd">${skill.desc}${skill.hits > 1 ? ` · ${skill.hits} hits` : ''}</span><span class="cost">${cost}<small>AP</small></span></button>`;
        }).join('') + '<button class="back">Esc · Back</button>';
        const pick = (i: number) => {
          const it = list[i];
          if (!it) return;
          if (u.ap < rankedAp(it.skill, it.rank)) { sfx('error'); return; }
          sfx('select');
          done({ type: 'skill', skill: it.skill, rank: it.rank });
        };
        this.sub.querySelectorAll('button.skill').forEach((b) => b.addEventListener('click', () => pick(Number((b as HTMLElement).dataset.i))));
        this.sub.querySelector('.back')!.addEventListener('click', () => { sfx('back'); showMain(); });
        this.keys((k) => {
          if (k === 'escape' || k === 'backspace') { sfx('back'); showMain(); }
          const n = Number(k);
          if (n >= 1 && n <= 5) pick(n - 1);
        });
      };
      const showOrbs = () => {
        this.actions.classList.remove('open');
        this.sub.classList.add('open');
        this.sub.innerHTML = `<div class="sub-title">Capture</div>
          <button class="skill ${state.inv.orbs ? '' : 'off'}" data-g="0"><kbd>1</kbd><span class="glyph">◓</span><span class="sn">Crit Orb</span><span class="sd">Standard capture orb</span><span class="cost">${state.inv.orbs}<small>left</small></span></button>
          <button class="skill ${state.inv.greatOrbs ? '' : 'off'}" data-g="1"><kbd>2</kbd><span class="glyph">◈</span><span class="sn">Great Orb</span><span class="sd">×1.6 capture chance</span><span class="cost">${state.inv.greatOrbs}<small>left</small></span></button>
          <button class="back">Esc · Back</button>`;
        const pick = (g: boolean) => {
          if ((g ? state.inv.greatOrbs : state.inv.orbs) <= 0) { sfx('error'); return; }
          sfx('select');
          done({ type: 'capture', great: g });
        };
        this.sub.querySelectorAll('button.skill').forEach((b) => b.addEventListener('click', () => pick((b as HTMLElement).dataset.g === '1')));
        this.sub.querySelector('.back')!.addEventListener('click', () => { sfx('back'); showMain(); });
        this.keys((k) => { if (k === 'escape' || k === 'backspace') { sfx('back'); showMain(); } if (k === '1') pick(false); if (k === '2') pick(true); });
      };
      const showItems = () => {
        this.actions.classList.remove('open');
        this.sub.classList.add('open');
        this.sub.innerHTML = `<div class="sub-title">Items</div>
          <button class="skill ${state.inv.potions ? '' : 'off'}" data-it="potion"><kbd>1</kbd><span class="glyph">🧪</span><span class="sn">Tonic</span><span class="sd">Restore 50% HP to an ally</span><span class="cost">${state.inv.potions}<small>left</small></span></button>
          <button class="skill ${state.inv.elixirs ? '' : 'off'}" data-it="elixir"><kbd>2</kbd><span class="glyph">✨</span><span class="sn">Elixir</span><span class="sd">Revive or fully heal an ally</span><span class="cost">${state.inv.elixirs}<small>left</small></span></button>
          <button class="back">Esc · Back</button>`;
        const pick = (it: 'potion' | 'elixir') => {
          if ((it === 'potion' ? state.inv.potions : state.inv.elixirs) <= 0) { sfx('error'); return; }
          sfx('select');
          done({ type: 'item', item: it });
        };
        this.sub.querySelectorAll('button.skill').forEach((b) => b.addEventListener('click', () => pick((b as HTMLElement).dataset.it as 'potion' | 'elixir')));
        this.sub.querySelector('.back')!.addEventListener('click', () => { sfx('back'); showMain(); });
        this.keys((k) => { if (k === 'escape' || k === 'backspace') { sfx('back'); showMain(); } if (k === '1') pick('potion'); if (k === '2') pick('elixir'); });
      };
      const done = (a: Action) => {
        this.clearKeys();
        this.actions.classList.remove('open');
        this.sub.classList.remove('open');
        resolve(a);
      };
      showMain();
      if (auto()) setTimeout(() => {
        if ((window as unknown as { __autoCapture?: boolean }).__autoCapture && ctx.canCapture && state.inv.orbs > 0) { done({ type: 'capture', great: false }); return; }
        const list = skillList(u.c).slice(1).filter((x) => x.skill.kind === 'attack' && u.ap >= rankedAp(x.skill, x.rank));
        const c = list[list.length - 1] ?? skillList(u.c)[0];
        done({ type: 'skill', skill: c.skill, rank: c.rank });
      }, 700);
    });
  }

  private pickClick?: (u: Unit) => void;

  /** Choose one unit among candidates (arrow keys / click / tap marker). Resolves null on cancel. */
  pickTarget(cands: Unit[], title: string, detail?: (u: Unit) => string, allowCancel = true): Promise<Unit | null> {
    return new Promise((resolve) => {
      let i = 0;
      this.hint.classList.add('open');
      const draw = () => {
        const u = cands[i];
        this.hint.innerHTML = `<b>${title}</b> <span>${u.name}${detail ? ` · ${detail(u)}` : ''}</span><small>← → choose · Enter confirm${allowCancel ? ' · Esc back' : ''}</small>`;
        this.markers.innerHTML = cands.map((c, j) => `<button class="mk ${j === i ? 'sel' : ''}" data-j="${j}"></button>`).join('');
        this.markers.querySelectorAll('.mk').forEach((b) => b.addEventListener('click', () => {
          const j = Number((b as HTMLElement).dataset.j);
          if (j === i) finish(cands[i]); else { i = j; sfx('select'); draw(); }
        }));
        this.positionMarkers(cands);
        for (const [unit, card] of this.cards) card.classList.toggle('targeted', unit === u);
      };
      const finish = (u: Unit | null) => {
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
        if (j === i) finish(u); else { i = j; sfx('select'); draw(); }
      };
      this.keys((k) => {
        if (k === 'arrowleft' || k === 'a' || k === 'arrowup' || k === 'w') { i = (i + cands.length - 1) % cands.length; sfx('select'); draw(); }
        if (k === 'arrowright' || k === 'd' || k === 'arrowdown' || k === 's') { i = (i + 1) % cands.length; sfx('select'); draw(); }
        if (k === 'enter' || k === ' ' || k === 'f') finish(cands[i]);
        if (allowCancel && (k === 'escape' || k === 'backspace')) { sfx('back'); finish(null); }
      });
      let raf = 0;
      const loop = () => { this.positionMarkers(cands); raf = requestAnimationFrame(loop); };
      draw();
      raf = requestAnimationFrame(loop);
      this.onTargetChange?.(cands[i]);
      if (auto()) setTimeout(() => finish(cands[0]), 600);
    });
  }
  onTargetChange?: (u: Unit) => void;

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
  ring(kind: 'attack' | 'defend' | 'red' | 'capture') {
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

  showDefense(on: boolean) { this.defense.classList.toggle('open', on); }

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

  skill(name: string, color: string, who: string) {
    this.skillTag.innerHTML = `<div class="sk" style="--el:${color}"><small>${who}</small>${name}</div>`;
    this.skillTag.classList.add('open');
  }
  hideSkill() { this.skillTag.classList.remove('open'); }

  hideHud(hide: boolean) { this.root.classList.toggle('hud-hidden', hide); }

  // ── Results ────────────────────────────────────────────────────────
  results(o: { title: string; sub: string; xp: number; gold: number; shards: [string, number][]; team: { c: Creature; beforeLv: number; beforeXp: number; newSkills: string[] }[]; captured: Creature[] }): Promise<void> {
    return new Promise((resolve) => {
      const wrap = h('div', 'b-results');
      const shardHtml = o.shards.map(([el, n]) => `<span class="shard" style="color:${ELEMENTS[el as keyof typeof ELEMENTS].color}">${ELEMENTS[el as keyof typeof ELEMENTS].glyph} ×${n}</span>`).join('');
      wrap.innerHTML = `<div class="r-card"><div class="r-title">${o.title}</div><div class="r-sub">${o.sub}</div>
        <div class="r-gains"><span>✦ ${o.xp} XP</span><span>◉ ${o.gold} gold</span>${shardHtml}</div>
        ${o.captured.map((c) => `<div class="r-cap"><img src="${portrait(c.species, c.shiny)}" alt=""><div><b>${displayName(c)}</b> joined your expedition!<small>Lv ${c.level} · genes ${gradeStr(c)}</small></div></div>`).join('')}
        <div class="r-team">${o.team.map((t) => {
          const lvUp = t.c.level > t.beforeLv;
          return `<div class="r-mon ${lvUp ? 'up' : ''}"><img src="${portrait(t.c.species, t.c.shiny)}" alt=""><div class="r-info"><b>${displayName(t.c)}</b><span class="lv">Lv ${t.beforeLv}${lvUp ? ` → <em>${t.c.level}</em>` : ''}</span>
            <div class="bar xp"><i style="width:${(t.beforeXp / xpToNext(t.beforeLv)) * 100}%" data-to="${(t.c.xp / xpToNext(t.c.level)) * 100}"></i></div>
            ${t.newSkills.map((s) => `<div class="learn">Learned <b>${s}</b>!</div>`).join('')}</div></div>`;
        }).join('')}</div>
        <button class="r-go">Continue <kbd>Enter</kbd></button></div>`;
      this.root.appendChild(wrap);
      requestAnimationFrame(() => {
        wrap.classList.add('in');
        setTimeout(() => wrap.querySelectorAll<HTMLElement>('.bar.xp i').forEach((i) => { i.style.width = `${i.dataset.to}%`; }), 450);
      });
      const close = () => { this.clearKeys(); sfx('select'); wrap.remove(); resolve(); };
      wrap.querySelector('.r-go')!.addEventListener('click', close);
      setTimeout(() => this.keys((k) => { if (k === 'enter' || k === ' ' || k === 'e') close(); }), 400);
      if (auto()) setTimeout(close, 3000);
    });
  }
}

function gradeStr(c: Creature) {
  const t = c.genes.hp + c.genes.atk + c.genes.def + c.genes.spd;
  return t >= 54 ? 'S' : t >= 44 ? 'A' : t >= 32 ? 'B' : t >= 20 ? 'C' : 'D';
}

export const hpText = (c: Creature) => `${c.hp}/${statsOf(c).maxHp}`;
