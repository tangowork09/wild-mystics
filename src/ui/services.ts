// Town services: Sanctuary (healer), Outfitter (shop), Hatchery (eggs + breeding), Elementum Shrine,
// Move Master (tutor) and Quest Board. Keeper/Wishing Spire route to Journal tabs.
import { sfx } from '../core/audio';
import { pick } from '../core/noise';
import { ELEMENTS } from '../data/elements';
import { ITEMS, ORBS, type ItemId, type OrbId } from '../data/items';
import { SKILLS } from '../data/skills';
import { SPECIES } from '../data/species';
import { ABILITIES, RARITY } from '../data/traits';
import { ZONES, type Zone } from '../data/zones';
import {
  baseForm, breedGenes, displayName, geneGrade, newUid, randomGenes, rankedAp, rankedPower, speciesOf, statsOf, type Creature,
} from '../game/creature';
import { state, save, healAll, itemCount, addItem } from '../game/state';
import { availableSide, acceptQuest, claimQuest, questById, rewardText } from '../game/progress';
import { SERVICES, TOWN_SPAWN, type Service } from '../world/towns';
import { modal, toast } from './dom';
import { bar, costList, currency, esc, mysticFace, emptyState } from './kit';
import { icon } from './icons';
import { pickCreature } from './pickers';
import type { JournalTab } from './journal';

export interface ServiceHooks {
  openJournal(tab: JournalTab): Promise<void>;
  isNight(): boolean;
  /** Advance the clock to a time of day (0..1). */
  restUntil(t: number): void;
}

const EGG_MAX = 3;
const BREED_COST = 150;
const SVC_ICON: Record<Service, string> = { healer: 'heart', shop: 'backpack', hatchery: 'egg', shrine: 'crystal_cluster', tutor: 'sword', storage: 'chest', summon: 'crystal_ball', quests: 'quest_scroll' };
const SAY: Partial<Record<Service, string>> = {
  healer: 'Rest a while, Wayfarer. Your companions have walked far.',
  shop: 'Orbs, tonics, incense — and a few rarer curiosities for the discerning explorer.',
  hatchery: 'Eggs love warmth and footsteps. The farther you walk, the sooner they hatch.',
  shrine: 'Elementum is the land’s memory. Offer shards of a Mystic’s own element to awaken it.',
  tutor: 'A move is a promise. Keep it sharp and it will never fail you.',
  quests: 'Townsfolk pin their troubles here. Help them and they pay well.',
};
/** Evolution stones sold per land (Pokémon-style regional stock). */
const ZONE_STONES: Record<string, ItemId[]> = {
  vale: ['leaf_stone'], lakes: ['water_stone'], scar: ['fire_stone', 'earth_stone'], marsh: ['void_stone'], dunes: ['earth_stone', 'wind_stone'], peaks: ['thunder_stone', 'wind_stone'],
};

export function openService(svc: Service, zone: Zone, hooks: ServiceHooks): Promise<void> {
  const sp = TOWN_SPAWN[zone.id];
  state.respawn = sp ? [sp.x, sp.z] : [...zone.town.pos];
  if (svc === 'storage') return hooks.openJournal('team');
  if (svc === 'summon') return hooks.openJournal('summon');
  const info = SERVICES[svc];
  return modal(`service svc-${svc}`, (body) => {
    const render = () => {
      const head = `<div class="svc-head" style="--c:${info.roof}"><span class="svc-icon">${icon(SVC_ICON[svc])}</span><div class="svc-t"><h2>${info.name}</h2><small>${zone.town.name} · ${info.desc}</small></div><div class="svc-cur">${currency('gold')}</div></div>
        ${SAY[svc] ? `<p class="svc-say">“${SAY[svc]}”</p>` : ''}`;
      const page = document.createElement('div');
      page.className = 'svc-page';
      body.innerHTML = head;
      body.appendChild(page);
      if (svc === 'healer') healer(page, render, hooks);
      if (svc === 'shop') shop(page, render, zone);
      if (svc === 'hatchery') hatchery(page, render);
      if (svc === 'shrine') shrine(page, render);
      if (svc === 'tutor') tutor(page, render);
      if (svc === 'quests') board(page, render, zone);
    };
    render();
  });
}

// ── Sanctuary ───────────────────────────────────────────────────────────────
function healer(body: HTMLElement, render: () => void, hooks: ServiceHooks) {
  const all = [...state.team, ...state.box];
  const hurt = all.filter((c) => c.hp < statsOf(c).maxHp).length;
  const night = hooks.isNight();
  body.innerHTML = `<div class="heal-row">${state.team.map((c) => {
      const max = statsOf(c).maxHp;
      return `<div class="hr ${c.hp <= 0 ? 'ko' : ''}">${mysticFace(c.species, c.shiny, 64)}<b>${esc(displayName(c))}</b>${bar(c.hp / max, 'hp')}<small>${c.hp}/${max}</small></div>`;
    }).join('') || emptyState('No companions', 'Your team is empty.', 'paw')}</div>
    <div class="row-center"><button class="btn primary big heal-go" ${hurt ? '' : 'disabled'}>${icon('heart')} ${hurt ? `Restore everyone (${hurt})` : 'Everyone is healthy'}</button></div>
    <div class="rest-row"><div><b>${icon(night ? 'moon' : 'sun')} Rest at the inn</b><small>Some Mystics only appear — or evolve — ${night ? 'by day' : 'after dark'}.</small></div>
      <button class="btn small" data-rest="${night ? 0.27 : 0.84}">${night ? 'Rest until dawn' : 'Rest until nightfall'}</button></div>
    <p class="svc-note">${icon('flag')} Your expedition will return here if it falls.</p>`;
  body.querySelector('.heal-go')?.addEventListener('click', () => {
    healAll();
    sfx('heal');
    save();
    toast('Your whole expedition is fully restored.', 'good');
    render();
  });
  body.querySelector<HTMLElement>('[data-rest]')?.addEventListener('click', (e) => {
    const t = Number((e.currentTarget as HTMLElement).dataset.rest);
    healAll();
    hooks.restUntil(t);
    sfx('heal');
    save();
    toast(t > 0.5 ? 'You rest until the stars come out…' : 'You wake to birdsong at dawn.', 'good');
    render();
  });
}

// ── Outfitter ───────────────────────────────────────────────────────────────
type Ware = { kind: 'orb'; id: OrbId } | { kind: 'item'; id: ItemId };
let shopCat: 'orbs' | 'supplies' | 'special' = 'orbs';

function shop(body: HTMLElement, render: () => void, zone: Zone) {
  const cats: Record<typeof shopCat, Ware[]> = {
    orbs: (['mystic', 'radiant', 'dusk', 'tide', 'ember'] as OrbId[]).map((id) => ({ kind: 'orb', id })),
    supplies: (['tonic', 'mega_tonic', 'elixir', 'ether', 'cleanse', 'lure_incense'] as ItemId[]).map((id) => ({ kind: 'item', id })),
    special: (['wisdom_scroll', 'shimmer_incense', 'hatch_charm', ...(ZONE_STONES[zone.id] ?? [])] as ItemId[]).map((id) => ({ kind: 'item', id })),
  };
  const info = (w: Ware) => (w.kind === 'orb'
    ? { name: ORBS[w.id].name, desc: ORBS[w.id].desc, price: ORBS[w.id].price, owned: state.inv.orbs[w.id], art: `<span class="orbdot big" style="background:radial-gradient(circle at 35% 30%, #fff, ${ORBS[w.id].color} 45%, #1a1020)"></span>` }
    : { name: ITEMS[w.id].name, desc: ITEMS[w.id].desc, price: ITEMS[w.id].price, owned: itemCount(w.id), art: `<span class="ic">${icon(ITEMS[w.id].icon)}</span>` });
  const unique = (w: Ware) => w.kind === 'item' && w.id === 'hatch_charm';
  body.innerHTML = `<div class="chips">${(['orbs', 'supplies', 'special'] as const).map((c) => `<button class="chip ${shopCat === c ? 'on' : ''}" data-cat="${c}">${c === 'orbs' ? `${icon('orb')} Orbs` : c === 'supplies' ? `${icon('potion')} Supplies` : `${icon('gem')} Rare goods`}</button>`).join('')}</div>
    <div class="wares">${cats[shopCat].map((w, i) => {
      const d = info(w);
      const owned1 = unique(w) && d.owned > 0;
      const q = (n: number) => `<button class="btn tiny ${state.inv.gold >= d.price * n ? '' : 'off'}" data-i="${i}" data-n="${n}" ${state.inv.gold >= d.price * n && !owned1 ? '' : 'disabled'}>×${n}</button>`;
      return `<div class="ware">${d.art}<div class="w-b"><b>${d.name}</b><small>${d.desc}</small><em>Owned ×${d.owned}</em></div>
        <div class="w-buy"><span class="price">${icon('coin')}${d.price.toLocaleString()}</span><div class="w-q">${owned1 ? '<em class="muted">Owned</em>' : q(1) + (unique(w) || d.price >= 800 ? '' : q(5) + q(10))}</div></div></div>`;
    }).join('')}</div>
    ${shopCat === 'special' ? `<p class="svc-note">${icon('compass')} Each land’s Outfitter stocks different evolution stones.</p>` : ''}`;
  body.querySelectorAll<HTMLElement>('[data-cat]').forEach((b) => b.addEventListener('click', () => { shopCat = b.dataset.cat as typeof shopCat; sfx('select'); render(); }));
  body.querySelectorAll<HTMLElement>('[data-i]').forEach((b) => b.addEventListener('click', () => {
    const w = cats[shopCat][Number(b.dataset.i)];
    const n = Number(b.dataset.n);
    const d = info(w);
    if (state.inv.gold < d.price * n) { sfx('error'); return; }
    state.inv.gold -= d.price * n;
    if (w.kind === 'orb') state.inv.orbs[w.id] += n; else addItem(w.id, n);
    sfx('coin');
    toast(`Bought ${n} × ${d.name}.`);
    save();
    render();
  }));
}

// ── Hatchery ────────────────────────────────────────────────────────────────
let parentA: string | null = null;
let parentB: string | null = null;

function hatchery(body: HTMLElement, render: () => void) {
  if (!state.flags.giftEgg) {
    state.flags.giftEgg = true;
    const pool = ZONES.flatMap((z) => z.spawns.map((s) => s.species)).filter((id) => SPECIES[id] && !state.dex[id]?.caught);
    const sp = baseForm(pick(pool.length ? pool : ZONES[0].spawns.map((s) => s.species)));
    const g = randomGenes();
    g.hp = Math.max(g.hp, 10); g.atk = Math.max(g.atk, 10);
    state.eggs.push({ uid: newUid(), species: sp, genes: g, parents: ['?', '?'], stepsLeft: 220, stepsTotal: 220 });
    save();
    toast('The keeper gifts you a <b>Mystery Egg</b>! Walk to hatch it.', 'loot', 4200);
  }
  const all = [...state.team, ...state.box];
  const A = all.find((c) => c.uid === parentA) ?? null;
  const B = all.find((c) => c.uid === parentB) ?? null;
  const charm = itemCount('hatch_charm') > 0;
  const full = state.eggs.length >= EGG_MAX;
  const ready = !!A && !!B && !full && state.inv.gold >= BREED_COST;
  const eggSp = A ? SPECIES[baseForm(A.species)] : null;
  const inherit = B ? B.skills[B.skills.length - 1]?.id : undefined;
  const slot = (c: Creature | null, k: 'a' | 'b', label: string, sub: string) => `<button class="bslot ${c ? 'on' : ''}" data-slot="${k}">${c ? `${mysticFace(c.species, c.shiny, 72)}<b>${esc(displayName(c))}</b><small>${sub} · Genes ${geneGrade(c.genes)}</small>` : `<span class="plus">+</span><b>${label}</b><small>${sub}</small>`}</button>`;
  body.innerHTML = `<div class="hatch-wrap">
    <div class="eggs"><div class="sec-h">${icon('egg')}<span>Nest</span><small>${state.eggs.length}/${EGG_MAX}${charm ? ' · Hatch Charm ×2 speed' : ''}</small></div>
      ${state.eggs.map((e) => {
        const sp = SPECIES[e.species];
        const mystery = e.parents[0] === '?';
        return `<div class="egg-row"><div class="egg-mini" style="--el:${ELEMENTS[sp.element].color}">${e.shinyBoost ? `<i>${icon('sparkle')}</i>` : ''}</div><div class="egg-b"><b>${mystery ? 'Mystery Egg' : `${sp.name} Egg`}</b>${bar(1 - e.stepsLeft / e.stepsTotal, 'xp')}<small>${Math.max(0, Math.round(e.stepsLeft))} m to hatch${mystery ? '' : ` · ${SPECIES[e.parents[0]]?.name ?? '?'} × ${SPECIES[e.parents[1]]?.name ?? '?'}`}</small></div></div>`;
      }).join('') || '<p class="muted small">No eggs yet. Breed a pair below.</p>'}
    </div>
    <div class="breed"><div class="sec-h">${icon('heart')}<span>Breeding</span><small>Level 5+ · ${icon('coin')} ${BREED_COST}</small></div>
      <div class="breed-slots">${slot(A, 'a', 'Parent A', 'Egg species')}<div class="heart">${icon('heart')}</div>${slot(B, 'b', 'Parent B', 'Passes a move')}</div>
      ${eggSp && B ? `<p class="svc-note">Egg: <b>${eggSp.name}</b> (${RARITY[eggSp.rarity].name}) · best genes of both parents with a chance to mutate higher · learns <b>${inherit ? SKILLS[inherit]?.name : '—'}</b>${A?.shiny || B?.shiny ? ` · ${icon('sparkle')} <b>shimmer bloodline</b>: 4× shiny odds` : ''}.</p>` : '<p class="svc-note">Pick two companions. The egg hatches as Parent A’s first form; Parent B teaches it a move.</p>'}
      <div class="row-center"><button class="btn primary big breed-go" ${ready ? '' : 'disabled'}>${full ? 'The nest is full' : state.inv.gold < BREED_COST ? 'Not enough gold' : 'Leave them together'}</button></div>
    </div></div>`;
  const eligible = (c: Creature) => c.level >= 5 && !speciesOf(c).boss && speciesOf(c).rarity !== 'legendary';
  body.querySelectorAll<HTMLElement>('[data-slot]').forEach((b) => b.addEventListener('click', async () => {
    const k = b.dataset.slot;
    const other = k === 'a' ? parentB : parentA;
    const c = await pickCreature(k === 'a' ? 'Choose Parent A (egg species)' : 'Choose Parent B (passes a move)', (x) => eligible(x) && x.uid !== other, (x) => `Genes ${geneGrade(x.genes)}`);
    if (!c) return;
    if (k === 'a') parentA = c.uid; else parentB = c.uid;
    sfx('select');
    render();
  }));
  body.querySelector('.breed-go')?.addEventListener('click', () => {
    if (!ready || !A || !B) return;
    state.inv.gold -= BREED_COST;
    const total = 300 + Math.floor(Math.random() * 160);
    state.eggs.push({
      uid: newUid(), species: baseForm(A.species), genes: breedGenes(A.genes, B.genes), inheritSkill: inherit,
      parents: [A.species, B.species], stepsLeft: total, stepsTotal: total, shinyBoost: A.shiny || B.shiny ? 4 : undefined,
    });
    parentA = parentB = null;
    sfx('captured');
    save();
    toast('An egg appeared in the nest!', 'good');
    render();
  });
}

// ── Elementum Shrine ────────────────────────────────────────────────────────
const infuseCost = (c: Creature) => 3 + c.infusion * 2;
const ATTUNE_SHARDS = 8, ATTUNE_GOLD = 300;

function shrine(body: HTMLElement, render: () => void) {
  body.innerHTML = `<div class="shrine-list">${state.team.map((c, i) => {
      const sp = speciesOf(c);
      const el = sp.element;
      const e = ELEMENTS[el];
      const cost = infuseCost(c);
      const have = state.inv.elementum[el];
      const maxed = c.infusion >= 10;
      const alt = sp.abilities.find((a) => a !== c.ability);
      const canAttune = !!alt && have >= ATTUNE_SHARDS && state.inv.gold >= ATTUNE_GOLD;
      return `<div class="sr" style="--el:${e.color}">${mysticFace(c.species, c.shiny, 64)}<div class="sr-body"><b>${esc(displayName(c))}</b>
          <div class="pips">${Array.from({ length: 10 }, (_, k) => `<i class="${k < c.infusion ? 'on' : ''}"></i>`).join('')}</div><small>All stats +${c.infusion * 3}%${maxed ? ' · fully resonant' : ' · next +3%'}</small>
          <small class="sr-ab">Ability: <b>${ABILITIES[c.ability].name}</b>${alt ? ` ↔ ${ABILITIES[alt].name}` : ''}</small></div>
        <div class="sr-cost"><span class="shard" style="--el:${e.color}">${icon(el)} ${have}${maxed ? '' : ` / ${cost}`}</span>
          <button class="btn tiny ${!maxed && have >= cost ? 'primary' : ''}" data-i="${i}" ${!maxed && have >= cost ? '' : 'disabled'}>${maxed ? 'Max' : 'Infuse'}</button>
          ${alt ? `<button class="btn tiny" data-att="${i}" ${canAttune ? '' : 'disabled'} title="Swap to ${ABILITIES[alt].name}: ${ABILITIES[alt].desc}">Attune ${icon(el)}${ATTUNE_SHARDS} ${icon('coin')}${ATTUNE_GOLD}</button>` : ''}</div></div>`;
    }).join('') || emptyState('No companions', 'Your team is empty.', 'paw')}</div>
    <div class="mat-row">${Object.entries(ELEMENTS).map(([k, e]) => `<div class="mat" style="--c:${e.color}">${icon(k)}<b>${state.inv.elementum[k as keyof typeof ELEMENTS]}</b><small>${e.name}</small></div>`).join('')}</div>
    <p class="svc-note">Shards drop from defeated Mystics of each element — Guardians and Tamers drop many. Attuning swaps a Mystic’s ability to its other natural ability.</p>`;
  body.querySelectorAll<HTMLElement>('[data-i]').forEach((b) => b.addEventListener('click', () => {
    const c = state.team[Number(b.dataset.i)];
    const el = speciesOf(c).element;
    const cost = infuseCost(c);
    if (state.inv.elementum[el] < cost || c.infusion >= 10) { sfx('error'); return; }
    const before = statsOf(c).maxHp;
    state.inv.elementum[el] -= cost;
    c.infusion++;
    c.hp += statsOf(c).maxHp - before;
    sfx('levelup');
    toast(`${esc(displayName(c))} resonates with ${ELEMENTS[el].name} Elementum!`, 'good');
    save();
    render();
  }));
  body.querySelectorAll<HTMLElement>('[data-att]').forEach((b) => b.addEventListener('click', () => {
    const c = state.team[Number(b.dataset.att)];
    const sp = speciesOf(c);
    const alt = sp.abilities.find((a) => a !== c.ability);
    if (!alt || state.inv.elementum[sp.element] < ATTUNE_SHARDS || state.inv.gold < ATTUNE_GOLD) { sfx('error'); return; }
    state.inv.elementum[sp.element] -= ATTUNE_SHARDS;
    state.inv.gold -= ATTUNE_GOLD;
    c.ability = alt;
    sfx('levelup');
    toast(`${esc(displayName(c))} now has <b>${ABILITIES[alt].name}</b>.`, 'good');
    save();
    render();
  }));
}

// ── Move Master ─────────────────────────────────────────────────────────────
let tutorSel = 0;
let learning: string | null = null;

function tutor(body: HTMLElement, render: () => void) {
  if (!state.team.length) { body.innerHTML = emptyState('No companions', 'Your team is empty.', 'paw'); return; }
  const c = state.team[Math.min(tutorSel, state.team.length - 1)];
  const known = new Set(c.skills.map((s) => s.id));
  const forgotten = [...new Set(speciesOf(c).learnset.filter(([lv, id]) => lv <= c.level && !known.has(id) && SKILLS[id]).map(([, id]) => id))];
  body.innerHTML = `<div class="tutor-tabs">${state.team.map((t, i) => `<button class="${t === c ? 'sel' : ''}" data-t="${i}">${mysticFace(t.species, t.shiny, 34)}<span>${esc(displayName(t))}</span></button>`).join('')}</div>
    <div class="tutor-skills">${c.skills.map((s, i) => {
      const sk = SKILLS[s.id];
      const e = ELEMENTS[sk.element];
      const gold = 50 * s.rank, shards = s.rank * 2;
      const ok = s.rank < 5 && state.inv.gold >= gold && state.inv.elementum[sk.element] >= shards;
      return `<div class="ts" style="--el:${e.color}"><span class="g">${icon(sk.element)}</span><div class="ts-b"><b>${sk.name}${s.rank > 1 ? ` <i class="rank">+${s.rank - 1}</i>` : ''}</b><small>${sk.desc}</small>
          <small>${sk.power ? `Power ${Math.round(rankedPower(sk, s.rank))}${s.rank < 5 ? ` → ${Math.round(rankedPower(sk, s.rank + 1))}` : ''}` : sk.kind === 'heal' ? 'Healing move' : 'Support move'} · ${rankedAp(sk, s.rank)} AP${s.rank === 4 ? ' (−1 AP at max)' : ''}</small><div class="pips">${Array.from({ length: 5 }, (_, k) => `<i class="${k < s.rank ? 'on' : ''}"></i>`).join('')}</div></div>
        ${learning ? `<button class="btn tiny danger" data-rep="${i}">Replace</button>` : `<div class="ts-cost">${s.rank >= 5 ? '<em>Mastered</em>' : `${costList({ gold })}<span class="shard" style="--el:${e.color}">${icon(sk.element)}${shards}</span><button class="btn tiny ${ok ? 'primary' : ''}" data-up="${i}" ${ok ? '' : 'disabled'}>Enhance</button>`}</div>`}</div>`;
    }).join('')}</div>
    ${forgotten.length ? `<div class="sec-h">${icon('book')}<span>Remember moves</span><small>Free</small></div><div class="tutor-forgot">${forgotten.map((id) => `<button class="${learning === id ? 'sel' : ''}" data-learn="${id}" style="--el:${ELEMENTS[SKILLS[id].element].color}">${icon(SKILLS[id].element)}<b>${SKILLS[id].name}</b><small>${SKILLS[id].desc}</small></button>`).join('')}</div>` : ''}
    <p class="svc-note">${learning ? `Choose a move to replace with <b>${SKILLS[learning].name}</b>. <button class="btn tiny ghost" data-cancel>Cancel</button>` : 'Enhancing raises power +12% per rank; rank 5 also lowers AP cost by 1.'}</p>`;
  body.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => b.addEventListener('click', () => { tutorSel = Number(b.dataset.t); learning = null; sfx('select'); render(); }));
  body.querySelector('[data-cancel]')?.addEventListener('click', () => { learning = null; render(); });
  body.querySelectorAll<HTMLElement>('[data-up]').forEach((b) => b.addEventListener('click', () => {
    const s = c.skills[Number(b.dataset.up)];
    const sk = SKILLS[s.id];
    const gold = 50 * s.rank, shards = s.rank * 2;
    if (s.rank >= 5 || state.inv.gold < gold || state.inv.elementum[sk.element] < shards) { sfx('error'); return; }
    state.inv.gold -= gold;
    state.inv.elementum[sk.element] -= shards;
    s.rank++;
    sfx('levelup');
    toast(`${sk.name} enhanced to rank ${s.rank}!`, 'good');
    save();
    render();
  }));
  body.querySelectorAll<HTMLElement>('[data-learn]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.learn!;
    if (c.skills.length < 4) { c.skills.push({ id, rank: 1 }); save(); sfx('levelup'); toast(`${esc(displayName(c))} remembered ${SKILLS[id].name}!`, 'good'); render(); return; }
    learning = id;
    sfx('select');
    render();
  }));
  body.querySelectorAll<HTMLElement>('[data-rep]').forEach((b) => b.addEventListener('click', () => {
    if (!learning) return;
    c.skills[Number(b.dataset.rep)] = { id: learning, rank: 1 };
    toast(`${esc(displayName(c))} learned ${SKILLS[learning].name}!`, 'good');
    learning = null;
    sfx('levelup');
    save();
    render();
  }));
}

// ── Quest Board ─────────────────────────────────────────────────────────────
function board(body: HTMLElement, render: () => void, zone: Zone) {
  const offers = availableSide(zone.id);
  const mine = state.quests.active.filter((a) => questById(a.id)?.giver === zone.id);
  const sideCount = state.quests.active.filter((a) => questById(a.id)?.kind === 'side').length;
  body.innerHTML = `${mine.length ? `<div class="sec-h">${icon('quest_scroll')}<span>In progress</span></div>${mine.map((a) => {
      const d = questById(a.id)!;
      const done = a.progress >= d.objective.count;
      return `<div class="quest side ${done ? 'done' : ''}"><div class="q-ic">${icon('quest_scroll')}</div><div class="q-b"><b>${d.title}</b><p>${d.desc}</p>${bar(a.progress / d.objective.count, 'xp')}<small>${Math.min(a.progress, d.objective.count)} / ${d.objective.count} · ${rewardText(d.reward)}</small></div>${done ? `<button class="btn gold" data-claim="${d.id}">Claim</button>` : ''}</div>`;
    }).join('')}` : ''}
    <div class="sec-h">${icon('scroll')}<span>Posted requests</span><small>${sideCount}/6 side quests active</small></div>
    ${offers.map((d) => `<div class="quest side offer"><div class="q-ic">${icon('scroll')}</div><div class="q-b"><b>${d.title}</b><p>${d.desc}</p><small>Reward: ${rewardText(d.reward)}</small></div><button class="btn primary" data-accept="${d.id}" ${sideCount >= 6 ? 'disabled' : ''}>Accept</button></div>`).join('') || `<p class="muted">No new requests in ${zone.town.name}. Try another town’s board.</p>`}`;
  body.querySelectorAll<HTMLElement>('[data-accept]').forEach((b) => b.addEventListener('click', () => {
    if (acceptQuest(b.dataset.accept!)) { sfx('open'); toast(`Quest accepted: <b>${questById(b.dataset.accept!)?.title}</b>`, 'quest'); } else { sfx('error'); toast('You can carry six side quests at once.', 'bad'); }
    render();
  }));
  body.querySelectorAll<HTMLElement>('[data-claim]').forEach((b) => b.addEventListener('click', () => {
    const d = questById(b.dataset.claim!);
    if (claimQuest(b.dataset.claim!)) { sfx('captured'); toast(`Reward: <b>${d ? rewardText(d.reward) : ''}</b>`, 'loot', 3600); }
    render();
  }));
}
