// Summon: the Wishing Spire as a capsule machine. Pick a banner, twist the knob, and capsules drop
// and pop open to reveal what you wished for.
import { banners, summon, freeWishAvailable, type PullResult } from '../../game/gacha';
import { RATES, HARD_PITY, SOFT_PITY, EPIC_PITY, type Banner } from '../../data/gacha';
import { SPECIES } from '../../data/species';
import { RELICS } from '../../data/relics';
import { RARITY, RARITY_ORDER } from '../../data/traits';
import { ELEMENTS } from '../../data/elements';
import { state } from '../../game/state';
import { sfx } from '../../core/audio';
import { haptic } from '../../core/haptics';
import { modal, toast, el, uiRoot, reducedMotion } from '../dom';
import { bar, currency, esc, mysticFace } from '../kit';
import { icon, glyph } from '../icons';
import type { TabCleanup } from '../journal';

let pick = 'featured';

const DOME_BALLS = [
  [22, 64, '#ff6f3c'], [40, 70, '#3aa8ff'], [58, 66, '#5ed66b'], [74, 58, '#ffd23f'], [30, 48, '#a983ff'], [50, 52, '#6febd8'],
  [66, 42, '#ff3d8b'], [36, 34, '#e0a45a'], [56, 30, '#3aa8ff'], [18, 40, '#ffd23f'], [78, 36, '#5ed66b'],
] as const;

export function machineHTML(color: string, featured?: string) {
  return `<div class="machine" style="--mc:${color}">
    <div class="mc-dome"><div class="mc-glass">${DOME_BALLS.map(([x, y, c], i) => `<i class="mc-ball" style="left:${x}%;top:${y}%;--c:${c};--d:${i * 0.13}s"></i>`).join('')}</div>${featured ? `<div class="mc-feature">${mysticFace(featured, false, 86)}</div>` : ''}</div>
    <div class="mc-body"><div class="mc-plate"><span class="display">Wish</span></div><div class="mc-knob"><i></i></div><div class="mc-slot"><i></i></div><div class="mc-chute"></div></div>
  </div>`;
}

export function renderSummon(root: HTMLElement): TabCleanup {
  const draw = () => {
    const list = banners();
    const b = list.find((x) => x.id === pick) ?? list[0];
    pick = b.id;
    const g = state.gacha;
    const col = b.kind === 'relic' ? '#a983ff' : RARITY[SPECIES[b.art]?.rarity ?? 'legendary'].color;
    const free = b.id === 'standard' && freeWishAvailable();
    const one = state.inv.tickets > 0 ? { pay: 'ticket', label: `${icon('scroll')} 1` } : { pay: 'aether', label: `${icon('gem')} 100` };
    const ten = state.inv.tickets >= 10 ? { pay: 'ticket', label: `${icon('scroll')} 10` } : { pay: 'aether', label: `${icon('gem')} 900` };
    root.innerHTML = `<div class="summon">
      <div class="sm-machine">${machineHTML(col, b.kind === 'relic' ? undefined : b.art)}</div>
      <div class="sm-panel">
        <div class="sm-top"><div class="seg" role="tablist">${list.map((x) => `<button role="tab" data-b="${x.id}" class="${x.id === b.id ? 'on' : ''}" aria-selected="${x.id === b.id}">${x.kind === 'relic' ? 'Relic Forge' : x.id === 'featured' ? 'Featured' : 'Standard'}${x.id === 'standard' && freeWishAvailable() ? '<span class="n hot">1</span>' : ''}</button>`).join('')}</div>
          <button class="btn ghost small" data-rates>${glyph('query')} Rates</button></div>
        <div class="sm-banner" style="--bc:${col}">
          <h3 class="display sm-name">${b.name}</h3>
          <p class="sm-sub">${b.subtitle}</p>
          ${b.kind !== 'relic' && SPECIES[b.art] ? `<div class="sm-feat"><span class="rar ${SPECIES[b.art].rarity}" style="--rar:${RARITY[SPECIES[b.art].rarity].color}">${RARITY[SPECIES[b.art].rarity].name}</span><span class="el-pip" style="--el:${ELEMENTS[SPECIES[b.art].element].color}">${icon(SPECIES[b.art].element)}<span>${SPECIES[b.art].name}</span></span>${b.id === 'featured' ? '<span class="tag">This week</span>' : ''}</div>` : ''}
        </div>
        <div class="sm-pity">
          <div class="pity"><span>Legendary</span>${bar(g.pity / HARD_PITY, 'gold')}<b class="tnum">${g.pity}/${HARD_PITY}</b></div>
          <div class="pity"><span>Epic in</span>${bar(1 - (EPIC_PITY - g.pityEpic) / EPIC_PITY, 'mag')}<b class="tnum">${EPIC_PITY - g.pityEpic}</b></div>
        </div>
        <div class="sm-cta">
          ${free ? `<button class="btn gold" data-pull="1" data-pay="free">${icon('gift')} Free daily wish</button>` : ''}
          <button class="btn light" data-pull="1" data-pay="${one.pay}">Wish ×1 <small>${one.label}</small></button>
          <button class="btn primary big" data-pull="10" data-pay="${ten.pay}">Wish ×10 <small>${ten.label}</small></button>
        </div>
        <div class="sm-foot"><span class="sm-purse">${currency('aether')}${currency('tickets')}${currency('essence')}</span>
          ${g.history.length ? `<span class="sm-hist" aria-label="Recent wishes">${g.history.slice(0, 8).map((h) => `<i class="hist ${h.rarity}" style="--rar:${RARITY[h.rarity as keyof typeof RARITY].color}" title="${h.species ? SPECIES[h.species]?.name : RELICS[h.relic!]?.name}"></i>`).join('')}</span>` : ''}</div>
      </div></div>`;
    root.querySelectorAll<HTMLElement>('[data-b]').forEach((x) => x.addEventListener('click', () => { pick = x.dataset.b!; sfx('select'); draw(); }));
    root.querySelectorAll<HTMLElement>('[data-pull]').forEach((x) => x.addEventListener('click', () => void pull(b, Number(x.dataset.pull) as 1 | 10, x.dataset.pay as 'aether' | 'ticket' | 'free')));
    root.querySelector('[data-rates]')?.addEventListener('click', () => void showRates());
  };
  const pull = async (b: Banner, n: 1 | 10, pay: 'aether' | 'ticket' | 'free') => {
    const res = summon(b, n, pay);
    if (!res) { sfx('error'); toast(pay === 'ticket' ? 'Not enough summon tickets.' : 'Not enough Aether. Earn more from quests, feats and daily rewards.', 'bad'); return; }
    sfx('chips');
    root.querySelector('.machine')?.classList.add('twist');
    await new Promise((r) => setTimeout(r, reducedMotion() ? 0 : 420));
    await reveal(res);
    draw();
  };
  draw();
}

async function showRates() {
  await modal('rates', (b) => {
    b.innerHTML = `<h2>${glyph('query')} Rates &amp; pity</h2>
      <div class="rates">${RARITY_ORDER.slice().reverse().map((r) => `<div class="rate"><span class="rar ${r}" style="--rar:${RARITY[r].color}">${RARITY[r].name}</span>${bar(RATES[r] / 0.6, r === 'legendary' || r === 'exotic' ? 'gold' : '')}<b class="tnum">${(RATES[r] * 100).toFixed(1)}%</b></div>`).join('')}</div>
      <p class="lead">Soft pity starts after ${SOFT_PITY} wishes without a Legendary (each wish adds 6% Legendary chance), and a Legendary is guaranteed by wish ${HARD_PITY}. An Epic or better arrives at least every ${EPIC_PITY} wishes, and every 10-wish holds at least one Rare.</p>
      <p class="lead">Featured banner: half of Legendary results are the featured Guardian Spirit. Duplicates become Mystic Essence for Awakening.</p>
      <p class="muted">No real-money purchases in this build. Aether and tickets are earned by playing.</p>`;
  });
}

/** Reveal: capsules drop from the machine and pop open, in order; rarer ones glow first. */
export function reveal(res: PullResult[]): Promise<void> {
  return new Promise((resolve) => {
    const best = res.reduce((a, r) => (RARITY_ORDER.indexOf(r.rarity) > RARITY_ORDER.indexOf(a) ? r.rarity : a), 'common' as keyof typeof RARITY);
    const o = el('div', `summon-fx r-${best} ${res.length > 1 ? 'multi' : 'single'}`);
    o.style.setProperty('--best', RARITY[best].color);
    o.innerHTML = `<div class="sf-bg"></div><div class="sf-cards"></div><div class="sf-foot"><button class="btn ghost" data-skip>${glyph('skip')} Skip</button></div>`;
    uiRoot().appendChild(o);
    requestAnimationFrame(() => o.classList.add('in'));
    sfx('pack');
    haptic('medium');
    const cards = o.querySelector('.sf-cards') as HTMLElement;
    let i = 0;
    let skipping = reducedMotion();
    const showCard = (r: PullResult) => {
      const c = el('div', `sf-card r-${r.rarity}`);
      c.style.setProperty('--rar', RARITY[r.rarity].color);
      let front = '';
      if (r.creature) {
        const sp = SPECIES[r.creature.species];
        front = `${mysticFace(sp.id, r.creature.shiny, 84)}<b class="ell">${sp.name}</b><small>${RARITY[r.rarity].name}${r.creature.shiny ? ' · Shiny' : ''}</small>${r.isNew ? '<i class="sf-new">New</i>' : `<i class="sf-dup">+${r.essence} essence</i>`}`;
      } else {
        const d = RELICS[r.relic!];
        front = `<span class="item-art rl big">${icon('crown')}</span><b class="ell">${esc(d.name)}</b><small>${RARITY[r.rarity].name} relic</small>`;
      }
      c.innerHTML = `<div class="sf-inner"><div class="sf-back"><span class="sf-cap" style="--c:${RARITY[r.rarity].color}"></span></div><div class="sf-front">${front}</div></div>`;
      cards.appendChild(c);
      requestAnimationFrame(() => c.classList.add('flip'));
      if (RARITY_ORDER.indexOf(r.rarity) >= 3) { sfx('rare'); haptic('success'); } else sfx('flip');
    };
    const next = () => {
      if (i >= res.length) {
        const foot = o.querySelector('.sf-foot')!;
        foot.innerHTML = `<button class="btn primary big" data-done>Continue <kbd>Enter</kbd></button>`;
        foot.querySelector('[data-done]')!.addEventListener('click', finish);
        (foot.querySelector('[data-done]') as HTMLElement).focus({ preventScroll: true });
        return;
      }
      showCard(res[i++]);
      setTimeout(next, skipping ? 50 : res.length > 1 ? 330 : 650);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (i >= res.length) finish(); else skipping = true;
      }
    };
    addEventListener('keydown', key, true);
    const finish = () => { removeEventListener('keydown', key, true); o.classList.remove('in'); setTimeout(() => o.remove(), 300); resolve(); };
    o.querySelector('[data-skip]')!.addEventListener('click', () => { skipping = true; });
    setTimeout(next, skipping ? 0 : best === 'legendary' || best === 'exotic' ? 1300 : 800);
  });
}
