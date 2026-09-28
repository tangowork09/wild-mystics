import { banners, summon, freeWishAvailable, type PullResult } from '../../game/gacha';
import { RATES, HARD_PITY, SOFT_PITY, EPIC_PITY, type Banner } from '../../data/gacha';
import { SPECIES } from '../../data/species';
import { RELICS } from '../../data/relics';
import { RARITY, RARITY_ORDER } from '../../data/traits';
import { ELEMENTS } from '../../data/elements';
import { state } from '../../game/state';
import { sfx } from '../../core/audio';
import { haptic } from '../../core/haptics';
import { modal, toast, el, uiRoot } from '../dom';
import { currency, mysticFace } from '../kit';
import { icon } from '../icons';

export function renderSummon(root: HTMLElement) {
  const draw = () => {
    const list = banners();
    const g = state.gacha;
    root.innerHTML = `<div class="cur-row">${currency('aether')}${currency('tickets')}${currency('essence')}<button class="btn ghost small" data-rates>Rates & pity</button></div>
      <div class="banners">${list.map((b) => bannerCard(b)).join('')}</div>
      <p class="pity-line">${icon('star')} Legendary pity: <b>${g.pity}/${HARD_PITY}</b> · Epic guaranteed within <b>${EPIC_PITY - g.pityEpic}</b> wishes · ${g.pulls} total wishes</p>
      ${g.history.length ? `<div class="sec-h">${icon('scroll')}<span>Recent wishes</span></div><div class="history">${g.history.slice(0, 24).map((h) => `<span class="hist" style="--rar:${RARITY[h.rarity as keyof typeof RARITY].color}">${h.species ? SPECIES[h.species]?.name : RELICS[h.relic!]?.name}</span>`).join('')}</div>` : ''}`;
    root.querySelectorAll<HTMLElement>('[data-pull]').forEach((b) => b.addEventListener('click', () => void pull(list.find((x) => x.id === b.dataset.banner)!, Number(b.dataset.pull) as 1 | 10, b.dataset.pay as 'aether' | 'ticket' | 'free')));
    root.querySelector('[data-rates]')?.addEventListener('click', () => void showRates());
  };
  const bannerCard = (b: Banner) => {
    const art = b.kind === 'relic' ? `<div class="bn-relic">${icon('crown')}${icon('gem')}${icon('shield')}</div>` : mysticFace(b.art, false, 150);
    const free = b.id === 'standard' && freeWishAvailable();
    const col = b.kind === 'relic' ? '#b57aff' : RARITY[SPECIES[b.art]?.rarity ?? 'legendary'].color;
    return `<div class="banner-card ${b.id}" style="--bc:${col}${b.art && SPECIES[b.art] ? `;--el:${ELEMENTS[SPECIES[b.art].element].color}` : ''}">
      <div class="bc-art">${art}</div>
      <div class="bc-body"><small>${b.kind === 'relic' ? 'Relic Summon' : b.id === 'featured' ? 'Featured Summon · this week' : 'Standard Summon'}</small><h3>${b.name}</h3><p>${b.subtitle}</p>
      <div class="bc-btns">
        ${free ? `<button class="btn gold" data-banner="${b.id}" data-pull="1" data-pay="free">${icon('gift')} Free daily wish</button>` : ''}
        <button class="btn primary" data-banner="${b.id}" data-pull="1" data-pay="${state.inv.tickets > 0 ? 'ticket' : 'aether'}">Wish ×1 <small>${state.inv.tickets > 0 ? `${icon('scroll')} 1 ticket` : `${icon('gem')} 100`}</small></button>
        <button class="btn primary" data-banner="${b.id}" data-pull="10" data-pay="${state.inv.tickets >= 10 ? 'ticket' : 'aether'}">Wish ×10 <small>${state.inv.tickets >= 10 ? `${icon('scroll')} 10 tickets` : `${icon('gem')} 900`}</small></button>
      </div></div></div>`;
  };
  const pull = async (b: Banner, n: 1 | 10, pay: 'aether' | 'ticket' | 'free') => {
    const res = summon(b, n, pay);
    if (res) sfx('chips');
    if (!res) { sfx('error'); toast(pay === 'ticket' ? 'Not enough summon tickets.' : 'Not enough Aether — earn more from quests, achievements and daily rewards.', 'bad'); return; }
    await reveal(res);
    draw();
  };
  draw();
}

async function showRates() {
  await modal('rates', (b) => {
    b.innerHTML = `<h2>Summon rates</h2><table class="rates">${RARITY_ORDER.slice().reverse().map((r) => `<tr><td style="color:${RARITY[r].color}">${RARITY[r].name}</td><td>${(RATES[r] * 100).toFixed(1)}%</td></tr>`).join('')}</table>
      <p>Soft pity starts after ${SOFT_PITY} wishes without a Legendary (each wish adds +6% Legendary chance). A Legendary is guaranteed by wish ${HARD_PITY}. An Epic-or-better is guaranteed every ${EPIC_PITY} wishes, and every 10-wish includes at least one Rare-or-better.</p>
      <p>Featured banner: 50% of Legendary results are the featured Guardian Spirit. Duplicates grant Mystic Essence for Awakening (★).</p>
      <p class="muted small">Wild Mystics has no real-money purchases in this build — Aether and tickets are earned by playing.</p>`;
  });
}

/** Cinematic reveal: sky portal → beam coloured by best rarity → cards flip in order. */
export function reveal(res: PullResult[]): Promise<void> {
  return new Promise((resolve) => {
    const best = res.reduce((a, r) => (RARITY_ORDER.indexOf(r.rarity) > RARITY_ORDER.indexOf(a) ? r.rarity : a), 'common' as keyof typeof RARITY);
    const o = el('div', `summon-fx r-${best}`);
    o.innerHTML = `<div class="sf-stars"></div><div class="sf-portal"></div><div class="sf-beam"></div><div class="sf-cards"></div><div class="sf-foot"><button class="btn ghost" data-skip>Skip</button></div>`;
    uiRoot().appendChild(o);
    requestAnimationFrame(() => o.classList.add('in'));
    sfx('pack');
    haptic('medium');
    const cards = o.querySelector('.sf-cards') as HTMLElement;
    let i = 0;
    let skipping = false;
    const showCard = (r: PullResult) => {
      const col = RARITY[r.rarity].color;
      const c = el('div', `sf-card r-${r.rarity}`);
      c.style.setProperty('--rar', col);
      if (r.creature) {
        const sp = SPECIES[r.creature.species];
        c.innerHTML = `<div class="sf-inner"><div class="sf-back"></div><div class="sf-front">${mysticFace(sp.id, r.creature.shiny, 110)}<b>${sp.name}</b><small>${RARITY[r.rarity].name}${r.creature.shiny ? ' · ✧ Shiny' : ''}</small>${r.isNew ? '<i class="sf-new">NEW</i>' : `<i class="sf-dup">+${r.essence} essence</i>`}</div></div>`;
      } else {
        const d = RELICS[r.relic!];
        c.innerHTML = `<div class="sf-inner"><div class="sf-back"></div><div class="sf-front"><div class="sf-relic">${icon('crown')}</div><b>${d.name}</b><small>${RARITY[r.rarity].name} relic</small></div></div>`;
      }
      cards.appendChild(c);
      requestAnimationFrame(() => c.classList.add('flip'));
      if (RARITY_ORDER.indexOf(r.rarity) >= 3) { sfx('rare'); haptic('success'); } else sfx('flip');
    };
    const next = () => {
      if (i >= res.length) { o.querySelector('.sf-foot')!.innerHTML = '<button class="btn primary" data-done>Continue</button>'; o.querySelector('[data-done]')!.addEventListener('click', finish); return; }
      showCard(res[i++]);
      setTimeout(next, skipping ? 60 : res.length > 1 ? 380 : 700);
    };
    const finish = () => { o.classList.remove('in'); setTimeout(() => o.remove(), 400); resolve(); };
    o.querySelector('[data-skip]')!.addEventListener('click', () => { skipping = true; });
    setTimeout(() => o.classList.add('beam'), 700);
    setTimeout(next, best === 'legendary' || best === 'exotic' ? 2200 : 1500);
  });
}
