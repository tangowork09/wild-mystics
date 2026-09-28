// Town services: Sanctuary (healer), Outfitter (→ openShop), Hatchery (eggs + breeding), Elementum
// Shrine, Move Master (tutor) and Quest Board. Keeper / Wishing Spire route to Journal tabs.
import { sfx } from '../core/audio';
import { haptic } from '../core/haptics';
import { pick } from '../core/noise';
import { ELEMENTS } from '../data/elements';
import { SKILLS } from '../data/skills';
import { SPECIES } from '../data/species';
import { ABILITIES, RARITY } from '../data/traits';
import { ZONES, type Zone } from '../data/zones';
import {
  baseForm, breedGenes, displayName, geneGrade, newUid, randomGenes, rankedAp, rankedPower, speciesOf, statsOf, type Creature,
} from '../game/creature';
import { state, save, healAll, itemCount } from '../game/state';
import { api, type QuestView } from '../game/contracts';
import { SERVICES, TOWN_SPAWN, type Service } from '../world/towns';
import { modal, toast } from './dom';
import { bar, hpBar, costList, esc, mysticFace, emptyState } from './kit';
import { icon, glyph } from './icons';
import { pickCreature } from './pickers';
import { Pager } from './pager';
import { odometer } from './count';
import { openShop } from './shop';
import { rewardChips } from './tabs/quests';
import type { JournalTab } from './journal';

export { openShop };

export interface ServiceHooks {
  openJournal(tab: JournalTab): Promise<void>;
  isNight(): boolean;
  /** Advance the clock to a time of day (0..1). */
  restUntil(t: number): void;
}

const EGG_MAX = 3;
const BREED_COST = 150;
const SVC_ICON: Record<Service, string> = { healer: 'heart', shop: 'backpack', hatchery: 'egg', shrine: 'crystal_cluster', tutor: 'sword', storage: 'chest', summon: 'crystal_ball', quests: 'quest_scroll' };
const SVC_COLOR: Partial<Record<Service, string>> = { healer: 'var(--magenta-hi)', hatchery: 'var(--coin)', shrine: 'var(--el-void)', tutor: 'var(--el-fire)', quests: 'var(--el-earth)' };
const SAY: Partial<Record<Service, string>> = {
  healer: 'Rest a while, Wayfarer. Your companions have walked far.',
  hatchery: 'Eggs love warmth and footsteps. The farther you walk, the sooner they hatch.',
  shrine: 'Elementum is the land’s memory. Offer shards of a Mystic’s own element to awaken it.',
  tutor: 'A move is a promise. Keep it sharp and it will never fail you.',
  quests: 'Townsfolk pin their troubles here. Help them and they pay well.',
};

export function openService(svc: Service, zone: Zone, hooks: ServiceHooks): Promise<void> {
  const sp = TOWN_SPAWN[zone.id];
  state.respawn = sp ? [sp.x, sp.z] : [...zone.town.pos];
  if (svc === 'storage') return hooks.openJournal('team');
  if (svc === 'summon') return hooks.openJournal('summon');
  if (svc === 'shop') return openShop(`${zone.town.id}_outfitter`, { zone }); // v3:ui — the Outfitter is a real shop now
  const info = SERVICES[svc];
  const cleanups: (() => void)[] = [];
  return modal(`service svc-${svc}`, (body) => {
    const render = () => {
      cleanups.splice(0).forEach((f) => f());
      body.innerHTML = `<header class="svc-head" style="--c:${SVC_COLOR[svc] ?? 'var(--paper)'}"><span class="svc-icon">${icon(SVC_ICON[svc])}</span><div class="svc-t"><h2 class="display">${info.name}</h2><small>${zone.town.name} · ${info.desc}</small></div><span class="cur cur-gold"><span class="cur-ic">${icon('coin')}</span><b data-p="gold"></b></span></header>
        ${SAY[svc] ? `<p class="svc-say">${SAY[svc]}</p>` : ''}<div class="svc-page"></div>`;
      odometer(body.querySelector('[data-p=gold]')!, state.inv.gold);
      const page = body.querySelector('.svc-page') as HTMLElement;
      if (svc === 'healer') healer(page, render, hooks);
      if (svc === 'hatchery') hatchery(page, render);
      if (svc === 'shrine') cleanups.push(shrine(page, render));
      if (svc === 'tutor') cleanups.push(tutor(page, render));
      if (svc === 'quests') cleanups.push(board(page, render, zone));
    };
    render();
  }, () => cleanups.splice(0).forEach((f) => f()));
}

// ── Sanctuary ───────────────────────────────────────────────────────────────
function healer(body: HTMLElement, render: () => void, hooks: ServiceHooks) {
  const all = [...state.team, ...state.box];
  const hurt = all.filter((c) => c.hp < statsOf(c).maxHp).length;
  const night = hooks.isNight();
  body.innerHTML = `<div class="heal-row">${state.team.map((c) => {
      const max = statsOf(c).maxHp;
      return `<div class="hr ${c.hp <= 0 ? 'ko' : ''}">${mysticFace(c.species, c.shiny, 60)}<b class="ell">${esc(displayName(c))}</b>${hpBar(c.hp / max)}<small class="tnum">${c.hp}/${max} HP</small></div>`;
    }).join('') || emptyState('No companions', 'Your team is empty.', 'paw')}</div>
    <div class="heal-go"><button class="btn primary big" data-heal ${hurt ? '' : 'disabled'}>${icon('heart')} ${hurt ? `Restore everyone (${hurt})` : 'Everyone is healthy'}</button></div>
    <div class="rest-row"><span class="rest-ic">${icon(night ? 'moon' : 'sun')}</span><div><b>Rest at the inn</b><small>Some Mystics only appear, or evolve, ${night ? 'by day' : 'after dark'}.</small></div>
      <button class="btn small" data-rest="${night ? 0.27 : 0.84}">${icon(night ? 'sun' : 'moon')} ${night ? 'Rest until dawn' : 'Rest until nightfall'}</button></div>
    <p class="svc-note">${icon('flag')} If your team falls, you’ll wake here.</p>`;
  body.querySelector('[data-heal]')?.addEventListener('click', () => {
    healAll();
    sfx('heal');
    haptic('success');
    save();
    toast('Your whole team is fully restored.', 'good');
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
  const slot = (c: Creature | null, k: 'a' | 'b', label: string, sub: string) => `<button class="bslot ${c ? 'on' : ''}" data-slot="${k}">${c ? `${mysticFace(c.species, c.shiny, 64)}<b class="ell">${esc(displayName(c))}</b><small>${sub} · Genes ${geneGrade(c.genes)}</small>` : `<span class="bs-plus">${glyph('plus')}</span><b>${label}</b><small>${sub}</small>`}</button>`;
  body.innerHTML = `<div class="hatch-wrap">
    <section class="sec"><header class="sec-h"><b>Nest</b><span class="sec-n">${state.eggs.length}/${EGG_MAX}</span>${charm ? '<small>Hatch Charm: twice as fast</small>' : ''}</header>
      <div class="nest">${Array.from({ length: EGG_MAX }, (_, i) => {
        const e = state.eggs[i];
        if (!e) return '<div class="egg-row empty"><span class="egg-mini"></span><small>Empty nest</small></div>';
        const sp = SPECIES[e.species];
        const mystery = e.parents[0] === '?';
        return `<div class="egg-row"><span class="egg-mini" style="--el:${ELEMENTS[sp.element].color}">${e.shinyBoost ? `<i>${icon('sparkles')}</i>` : ''}</span><span class="egg-b"><b class="ell">${mystery ? 'Mystery Egg' : `${sp.name} Egg`}</b>${bar(1 - e.stepsLeft / e.stepsTotal, 'gold thin')}<small class="tnum">${Math.max(0, Math.round(e.stepsLeft))} m to hatch</small></span></div>`;
      }).join('')}</div></section>
    <section class="sec breed"><header class="sec-h"><b>Breeding</b><small>Level 5+ · ${icon('coin')} ${BREED_COST}</small></header>
      <div class="breed-slots">${slot(A, 'a', 'Parent A', 'Egg species')}<span class="heart">${glyph('heart')}</span>${slot(B, 'b', 'Parent B', 'Passes a move')}</div>
      <p class="svc-note">${eggSp && B ? `Egg: <b>${eggSp.name}</b> (${RARITY[eggSp.rarity].name}) · the best genes of both parents · learns <b>${inherit ? SKILLS[inherit]?.name : 'nothing new'}</b>${A?.shiny || B?.shiny ? ' · shimmer bloodline: 4× shiny odds' : ''}.` : 'Pick two companions. The egg hatches as Parent A’s first form; Parent B teaches it a move.'}</p>
      <button class="btn primary" data-breed ${ready ? '' : 'disabled'}>${icon('egg')} ${full ? 'The nest is full' : state.inv.gold < BREED_COST ? 'Not enough gold' : 'Leave them together'}</button>
    </section></div>`;
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
  body.querySelector('[data-breed]')?.addEventListener('click', () => {
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
  body.innerHTML = `<div class="shrine-list"></div><div class="mat-row">${Object.entries(ELEMENTS).map(([k, e]) => `<span class="mat" style="--c:${e.color}" title="${e.name} Elementum">${icon(k)}<b class="tnum">${state.inv.elementum[k as keyof typeof ELEMENTS]}</b></span>`).join('')}</div>`;
  const pager = new Pager<Creature>(body.querySelector('.shrine-list') as HTMLElement, {
    items: state.team, cell: { w: 330, h: 70 }, gap: 6, maxCols: 2, primary: true, label: 'Team',
    render: (c) => {
      const sp = speciesOf(c);
      const e = ELEMENTS[sp.element];
      const cost = infuseCost(c);
      const have = state.inv.elementum[sp.element];
      const maxed = c.infusion >= 10;
      const alt = sp.abilities.find((a) => a !== c.ability);
      const canAttune = !!alt && have >= ATTUNE_SHARDS && state.inv.gold >= ATTUNE_GOLD;
      const i = state.team.indexOf(c);
      return `<div class="sr" style="--el:${e.color}">${mysticFace(c.species, c.shiny, 48)}<div class="sr-b"><b class="ell">${esc(displayName(c))}</b>
          <span class="pips" title="Infusion ${c.infusion}/10">${Array.from({ length: 10 }, (_, k) => `<i class="${k < c.infusion ? 'on' : ''}"></i>`).join('')}</span><small>All stats +${c.infusion * 3}%${maxed ? ' · fully resonant' : ''}</small></div>
        <div class="sr-act"><button class="btn tiny ${!maxed && have >= cost ? 'primary' : ''}" data-i="${i}" ${!maxed && have >= cost ? '' : 'disabled'}>${maxed ? 'Max' : `Infuse <span class="shard">${icon(sp.element)}${cost}</span>`}</button>
          ${alt ? `<button class="btn tiny" data-att="${i}" ${canAttune ? '' : 'disabled'} title="Swap to ${ABILITIES[alt].name}: ${ABILITIES[alt].desc}">Attune ${icon(sp.element)}${ATTUNE_SHARDS}</button>` : ''}</div></div>`;
    },
    empty: emptyState('No companions', 'Your team is empty.', 'paw'),
  });
  body.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-i], [data-att]');
    if (!b) return;
    if (b.dataset.i !== undefined) {
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
    } else {
      const c = state.team[Number(b.dataset.att)];
      const sp = speciesOf(c);
      const alt = sp.abilities.find((a) => a !== c.ability);
      if (!alt || state.inv.elementum[sp.element] < ATTUNE_SHARDS || state.inv.gold < ATTUNE_GOLD) { sfx('error'); return; }
      state.inv.elementum[sp.element] -= ATTUNE_SHARDS;
      state.inv.gold -= ATTUNE_GOLD;
      c.ability = alt;
      sfx('levelup');
      toast(`${esc(displayName(c))} now has <b>${ABILITIES[alt].name}</b>.`, 'good');
    }
    save();
    render();
  });
  return () => pager.destroy();
}

// ── Move Master ─────────────────────────────────────────────────────────────
let tutorSel = 0;
let learning: string | null = null;

function tutor(body: HTMLElement, render: () => void) {
  if (!state.team.length) { body.innerHTML = emptyState('No companions', 'Your team is empty.', 'paw'); return () => undefined; }
  const c = state.team[Math.min(tutorSel, state.team.length - 1)];
  const known = new Set(c.skills.map((s) => s.id));
  const forgotten = [...new Set(speciesOf(c).learnset.filter(([lv, id]) => lv <= c.level && !known.has(id) && SKILLS[id]).map(([, id]) => id))];
  body.innerHTML = `<div class="tutor">
    <div class="seg tutor-who">${state.team.map((t, i) => `<button class="${t === c ? 'on' : ''}" data-t="${i}">${mysticFace(t.species, t.shiny, 26)}<span class="ell">${esc(displayName(t))}</span></button>`).join('')}</div>
    <div class="tutor-skills">${c.skills.map((s, i) => {
      const sk = SKILLS[s.id];
      const e = ELEMENTS[sk.element];
      const gold = 50 * s.rank, shards = s.rank * 2;
      const ok = s.rank < 5 && state.inv.gold >= gold && state.inv.elementum[sk.element] >= shards;
      return `<div class="move ts" style="--el:${e.color}"><span class="mv-el">${icon(sk.element)}</span><span class="mv-b"><b class="ell">${sk.name}${s.rank > 1 ? ` <i class="rank">+${s.rank - 1}</i>` : ''}</b>
          <small>${sk.power ? `Power ${Math.round(rankedPower(sk, s.rank))}${s.rank < 5 ? ` → ${Math.round(rankedPower(sk, s.rank + 1))}` : ''}` : sk.kind === 'heal' ? 'Healing move' : 'Support move'} · ${rankedAp(sk, s.rank)} AP</small>
          <span class="pips five">${Array.from({ length: 5 }, (_, k) => `<i class="${k < s.rank ? 'on' : ''}"></i>`).join('')}</span></span>
        ${learning ? `<button class="btn tiny danger" data-rep="${i}">Replace</button>` : s.rank >= 5 ? '<span class="tag gold">Mastered</span>' : `<button class="btn tiny ${ok ? 'primary' : ''}" data-up="${i}" ${ok ? '' : 'disabled'}>Enhance ${costList({ gold })}<span class="shard">${icon(sk.element)}${shards}</span></button>`}</div>`;
    }).join('')}</div>
    ${forgotten.length ? `<section class="sec grow"><header class="sec-h"><b>Remember moves</b><small>Free</small></header><div class="tutor-forgot"></div></section>` : ''}
    <p class="svc-note">${learning ? `Choose a move to replace with <b>${SKILLS[learning].name}</b>. <button class="btn tiny ghost" data-cancel>Cancel</button>` : 'Enhancing raises power by 12% per rank; rank 5 also costs 1 less AP.'}</p></div>`;
  let pager: Pager<string> | null = null;
  const host = body.querySelector('.tutor-forgot') as HTMLElement | null;
  if (host) pager = new Pager<string>(host, {
    items: forgotten, cell: { w: 200, h: 48 }, gap: 6, primary: true, label: 'Forgotten moves',
    selected: (id) => id === learning,
    onPick: (id) => {
      if (c.skills.length < 4) { c.skills.push({ id, rank: 1 }); save(); sfx('levelup'); toast(`${esc(displayName(c))} remembered ${SKILLS[id].name}!`, 'good'); render(); return; }
      learning = id;
      sfx('select');
      render();
    },
    render: (id) => `<span class="forgot" style="--el:${ELEMENTS[SKILLS[id].element].color}">${icon(SKILLS[id].element)}<b class="ell">${SKILLS[id].name}</b></span>`,
  });
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
  body.querySelectorAll<HTMLElement>('[data-rep]').forEach((b) => b.addEventListener('click', () => {
    if (!learning) return;
    c.skills[Number(b.dataset.rep)] = { id: learning, rank: 1 };
    toast(`${esc(displayName(c))} learned ${SKILLS[learning].name}!`, 'good');
    learning = null;
    sfx('levelup');
    save();
    render();
  }));
  return () => pager?.destroy();
}

// ── Quest Board (reads api.quests: requests for this land) ──────────────────
function board(body: HTMLElement, render: () => void, zone: Zone) {
  let all: QuestView[] = [];
  try { all = api.quests.list(); } catch { all = []; }
  const posted = all.filter((q) => (q.kind === 'side' || q.kind === 'bounty') && q.status !== 'done' && (!q.target?.region || q.target.region === zone.id));
  let focus = posted[0]?.id ?? '';
  body.innerHTML = `<div class="md board"><div class="md-master board-list"></div><div class="md-detail board-detail"></div></div>`;
  const detail = body.querySelector('.board-detail') as HTMLElement;
  const drawDetail = () => {
    const q = posted.find((x) => x.id === focus);
    if (!q) { detail.innerHTML = `<div class="item-card">${emptyState('Pick a request', 'Choose a note on the board to read it.', 'quest_scroll')}</div>`; return; }
    detail.innerHTML = `<div class="item-card note">
      <b class="ic-name">${esc(q.title)}</b><span class="ic-tags">${q.kind === 'bounty' ? '<span class="tag bad">Bounty</span>' : '<span class="tag">Side quest</span>'}${q.level ? `<span class="tag line tnum">Lv ${q.level}</span>` : ''}${q.giver ? `<span class="tag line">${esc(q.giver)}</span>` : ''}</span>
      <p class="ic-desc">${esc(q.summary)}</p>
      <div class="rw-row">${rewardChips(q.rewards)}</div>
      <div class="ic-act">${q.status === 'ready' ? `<button class="btn gold" data-claim>${icon('gift')} Claim reward</button>` : q.target ? (q.tracked ? `<button class="btn" disabled>${glyph('diamond')} Tracking</button>` : `<button class="btn primary" data-track>${glyph('diamond')} Track</button>`) : ''}</div></div>`;
    detail.querySelector('[data-track]')?.addEventListener('click', () => { api.quests.track(q.id); sfx('open'); toast(`Tracking <b>${esc(q.title)}</b>`, 'quest', 1800); render(); });
    detail.querySelector('[data-claim]')?.addEventListener('click', () => { if (api.quests.claim(q.id)) { sfx('captured'); toast(`Quest complete: <b>${esc(q.title)}</b>`, 'loot', 3000); } render(); });
  };
  const pager = new Pager<QuestView>(body.querySelector('.board-list') as HTMLElement, {
    items: posted, cell: { w: 220, h: 54 }, gap: 6, maxCols: 1, primary: true, label: 'Requests',
    selected: (q) => q.id === focus, onPick: (q) => { focus = q.id; sfx('select'); pager.refresh(); drawDetail(); },
    render: (q) => `<span class="qrow ${q.status} ${q.tracked ? 'tracked' : ''}"><span class="q-ic">${q.status === 'ready' ? icon('gift') : q.status === 'available' ? glyph('bang') : q.kind === 'bounty' ? icon('skull') : icon('quest_scroll')}</span><span class="q-b"><b class="ell">${esc(q.title)}</b><small class="ell">${q.status === 'ready' ? 'Ready to turn in' : q.giver ?? ''}</small></span></span>`,
    empty: emptyState(`No requests in ${zone.town.name}`, 'Nothing is pinned to the board right now. Check other towns’ boards too.', 'quest_scroll'),
  });
  drawDetail();
  return () => pager.destroy();
}
