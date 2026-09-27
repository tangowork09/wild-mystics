import { portrait } from '../assets/manifest';
import { sfx } from '../core/audio';
import { ELEMENTS } from '../data/elements';
import { SPECIES, STARTERS } from '../data/species';
import { displayName, geneGrade, statsOf, type Creature } from '../game/creature';
import { el, uiRoot } from './dom';

export function loading(msg: string, frac?: number) {
  let l = document.getElementById('loading');
  if (!l) {
    l = el('div', '', `<div class="ld-title">Expedition <em>Wilds</em></div><div class="ld-bar"><i></i></div><div class="ld-msg"></div>`);
    l.id = 'loading';
    document.body.appendChild(l);
  }
  (l.querySelector('.ld-msg') as HTMLElement).textContent = msg;
  if (frac !== undefined) (l.querySelector('.ld-bar i') as HTMLElement).style.width = `${Math.round(frac * 100)}%`;
}
export function hideLoading() {
  const l = document.getElementById('loading');
  if (!l) return;
  l.classList.add('out');
  setTimeout(() => l.remove(), 900);
}

export function title(hasSave: boolean): Promise<'new' | 'continue'> {
  return new Promise((resolve) => {
    const t = el('div', 'title-screen', `
      <div class="ts-mark">
        <div class="ts-kicker">A creature-collecting expedition</div>
        <h1>Expedition <em>Wilds</em></h1>
        <div class="ts-rule"><span></span>✦<span></span></div>
        <p class="ts-tag">Every creature has a story. Go and find them.</p>
      </div>
      <div class="ts-menu">
        ${hasSave ? '<button data-a="continue" class="primary">Continue Expedition</button>' : ''}
        <button data-a="new" class="${hasSave ? '' : 'primary'}">New Expedition</button>
      </div>
      <div class="ts-foot">Prototype build · CC0 art: Quaternius · KayKit · Kenney · Poly Haven</div>`);
    uiRoot().appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    const go = (a: 'new' | 'continue') => {
      sfx('select');
      removeEventListener('keydown', key);
      t.classList.remove('in');
      setTimeout(() => t.remove(), 600);
      resolve(a);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Enter') go(hasSave ? 'continue' : 'new'); };
    addEventListener('keydown', key);
    t.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => go((b as HTMLElement).dataset.a as 'new' | 'continue')));
  });
}

export function chooseStarter(): Promise<string> {
  return new Promise((resolve) => {
    const roles: Record<string, string> = { emberling: 'Striker · high attack', finnik: 'Support · heals & shields', sporelet: 'Guardian · sturdy & breaks guards' };
    const s = el('div', 'starter-screen', `<div class="st-head"><div class="st-kicker">Chapter I</div><h2>Choose your first companion</h2><p>They will walk every road beside you.</p></div><div class="st-cards"></div>`);
    const cards = s.querySelector('.st-cards')!;
    STARTERS.forEach((id, i) => {
      const sp = SPECIES[id];
      const e = ELEMENTS[sp.element];
      const b = sp.base;
      const max = { hp: 80, atk: 22, def: 22, spd: 22 };
      const c = el('button', 'st-card', `
        <div class="st-glow" style="--el:${e.color}"></div>
        <img src="${portrait(id)}" alt="">
        <div class="st-el" style="color:${e.color}">${e.glyph} ${e.name}</div>
        <div class="st-name">${sp.name}</div>
        <div class="st-role">${roles[id]}</div>
        <div class="st-stats">${(['hp', 'atk', 'def', 'spd'] as const).map((k) => `<div><span>${k.toUpperCase()}</span><i style="--w:${Math.min(100, (b[k] / max[k]) * 100)}%;--el:${e.color}"></i></div>`).join('')}</div>
        <p class="st-lore">${sp.lore}</p>
        <div class="st-key"><kbd>${i + 1}</kbd></div>`);
      c.style.setProperty('--el', e.color);
      c.addEventListener('click', () => pick(id));
      cards.appendChild(c);
    });
    uiRoot().appendChild(s);
    requestAnimationFrame(() => s.classList.add('in'));
    const key = (e: KeyboardEvent) => { const n = Number(e.key); if (n >= 1 && n <= 3) pick(STARTERS[n - 1]); };
    addEventListener('keydown', key);
    const pick = (id: string) => {
      removeEventListener('keydown', key);
      sfx('captured');
      s.classList.add('chosen');
      s.querySelectorAll('.st-card').forEach((c, i) => c.classList.toggle('picked', STARTERS[i] === id));
      setTimeout(() => { s.classList.remove('in'); setTimeout(() => s.remove(), 600); resolve(id); }, 900);
    };
  });
}

export function evolution(c: Creature, fromId: string, toId: string): Promise<void> {
  return new Promise((resolve) => {
    const a = portrait(fromId, c.shiny), b = portrait(toId, c.shiny);
    const o = el('div', 'cine evo', `
      <div class="cine-rays"></div>
      <div class="cine-text">What? <b>${SPECIES[fromId].name}</b> is evolving!</div>
      <div class="evo-stage"><img class="from" src="${a}" alt=""><img class="to" src="${b}" alt=""></div>
      <div class="cine-sub"></div>`);
    uiRoot().appendChild(o);
    requestAnimationFrame(() => o.classList.add('in'));
    sfx('capture');
    setTimeout(() => o.classList.add('morph'), 900);
    setTimeout(() => { o.classList.add('done'); sfx('levelup'); sfx('captured');
      (o.querySelector('.cine-text') as HTMLElement).innerHTML = `Congratulations! It became <b>${SPECIES[toId].name}</b>!`;
      (o.querySelector('.cine-sub') as HTMLElement).innerHTML = `<button>Continue</button>`;
      o.querySelector('button')!.addEventListener('click', close);
      addEventListener('keydown', key);
    }, 4200);
    const key = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') close(); };
    const close = () => { removeEventListener('keydown', key); o.classList.remove('in'); setTimeout(() => o.remove(), 500); resolve(); };
  });
}

export function hatch(c: Creature): Promise<void> {
  return new Promise((resolve) => {
    const sp = SPECIES[c.species];
    const e = ELEMENTS[sp.element];
    const o = el('div', 'cine hatch', `
      <div class="cine-rays" style="--el:${e.color}"></div>
      <div class="cine-text">Oh? Your egg is hatching!</div>
      <div class="egg-stage"><div class="egg" style="--el:${e.color}"><i></i><i></i><i></i></div><img class="born" src="${portrait(c.species, c.shiny)}" alt=""></div>
      <div class="cine-sub"></div>`);
    uiRoot().appendChild(o);
    requestAnimationFrame(() => o.classList.add('in'));
    setTimeout(() => { o.classList.add('crack'); sfx('orb'); }, 1400);
    setTimeout(() => { sfx('orb'); }, 2000);
    setTimeout(() => {
      o.classList.add('done');
      sfx('captured');
      (o.querySelector('.cine-text') as HTMLElement).innerHTML = `${c.shiny ? '✧ A shimmering ' : ''}<b>${displayName(c)}</b> hatched!`;
      (o.querySelector('.cine-sub') as HTMLElement).innerHTML = `<div class="hatch-info"><span style="color:${e.color}">${e.glyph} ${e.name}</span> · Genes <b>${geneGrade(c.genes)}</b> · ${statsOf(c).maxHp} HP</div><button>Welcome!</button>`;
      o.querySelector('button')!.addEventListener('click', close);
      addEventListener('keydown', key);
    }, 2900);
    const key = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') close(); };
    const close = () => { removeEventListener('keydown', key); o.classList.remove('in'); setTimeout(() => o.remove(), 500); resolve(); };
  });
}

export function guide(touch: boolean): Promise<void> {
  return new Promise((resolve) => {
    const o = el('div', 'modal guide in', `<div class="panel"><div class="body">
      <h2>Field Guide</h2>
      <div class="guide-grid">
        <section><h3>Exploring</h3>
          ${touch ? '<p><b>Left thumb</b> move · <b>right thumb</b> look</p><p><b>⚔ Strike</b> near a creature to start with the advantage</p><p><b>Tap the prompt</b> to talk, rest, search</p>'
          : '<p><kbd>W A S D</kbd> move · <kbd>Shift</kbd> sprint · <b>drag</b> look · <b>wheel</b> zoom</p><p><kbd>F</kbd> strike a wild creature first — it starts <b>staggered</b></p><p><kbd>E</kbd> interact · <kbd>T</kbd> team · <kbd>C</kbd> dex · <kbd>M</kbd> map</p>'}
          <p>Walk through <b>tall grass</b> or search <b>glimmering bushes</b> to find hidden creatures.</p></section>
        <section><h3>Battle</h3>
          <p>Turn order follows <b>speed</b>. Attacks earn <b>AP</b>; skills spend it.</p>
          <p>Hit ${touch ? '<b>tap</b>' : '<kbd>Space</kbd>'} as the ring closes for <b>Perfect</b> damage.</p>
          <p>When foes attack: ${touch ? '<b>PARRY</b> / <b>DODGE</b> buttons' : '<kbd>E</kbd>/<kbd>Space</kbd> parry · <kbd>Q</kbd>/<kbd>Shift</kbd> dodge'}. Parry every strike to <b>counter</b>. <span class="red">Red rings</span> can only be dodged.</p>
          <p>Fill the gold <b>Break</b> bar to stun. Weaken, then <b>Capture</b>.</p></section>
        <section><h3>Towns</h3>
          <p><b>Healer</b> restores · <b>Outfitter</b> sells orbs · <b>Hatchery</b> breeds eggs · <b>Elementum Shrine</b> infuses power · <b>Move Master</b> enhances skills · <b>Keeper</b> stores creatures.</p>
          <p>Defeat each zone's <b>Guardian</b> to calm the land.</p></section>
      </div>
      <button class="primary guide-go">Begin <kbd>Enter</kbd></button></div></div>`);
    uiRoot().appendChild(o);
    const close = () => { removeEventListener('keydown', key); o.classList.remove('in'); setTimeout(() => o.remove(), 300); resolve(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === 'Escape') close(); };
    addEventListener('keydown', key);
    o.querySelector('.guide-go')!.addEventListener('click', close);
  });
}
