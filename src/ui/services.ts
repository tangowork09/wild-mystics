import { portrait } from '../assets/manifest';
import { sfx } from '../core/audio';
import { pick } from '../core/noise';
import { ELEMENTS } from '../data/elements';
import { SKILLS } from '../data/skills';
import { SPECIES } from '../data/species';
import { ZONES, type Zone } from '../data/zones';
import {
  baseForm, breedGenes, displayName, geneGrade, newUid, randomGenes, rankedAp, rankedPower, speciesOf, statsOf, type Creature,
} from '../game/creature';
import { state, save, healAll } from '../game/state';
import { SERVICES, type Service } from '../world/towns';
import { bar, modal, toast } from './dom';
import { teamMenu, type MenuHooks } from './menus';

const EGG_MAX = 3;

export function openService(svc: Service, zone: Zone, hooks: MenuHooks): Promise<void> {
  state.respawn = [...zone.town.pos];
  if (svc === 'storage') return teamMenu(hooks, true);
  const info = SERVICES[svc];
  return modal(`service svc-${svc}`, (body) => {
    const head = `<div class="svc-head" style="--c:${info.roof}"><span class="svc-icon">${info.icon}</span><div><h2>${info.name}</h2><small>${zone.town.name} · ${info.desc}</small></div><div class="svc-gold">◉ ${state.inv.gold}</div></div>`;
    const render = () => {
      if (svc === 'healer') healer(body, head, render);
      if (svc === 'shop') shop(body, head, render);
      if (svc === 'hatchery') hatchery(body, head, render);
      if (svc === 'shrine') shrine(body, head, render);
      if (svc === 'tutor') tutor(body, head, render);
    };
    render();
  });
}

// ── Healer ─────────────────────────────────────────────────────────────
function healer(body: HTMLElement, head: string, render: () => void) {
  const hurt = [...state.team, ...state.box].filter((c) => c.hp < statsOf(c).maxHp).length;
  body.innerHTML = `${head}<p class="svc-say">“Rest a while, traveller. Your companions have walked far.”</p>
    <div class="heal-row">${state.team.map((c) => `<div class="hr"><img src="${portrait(c.species, c.shiny)}" alt=""><b>${displayName(c)}</b>${bar(c.hp / statsOf(c).maxHp, 'hp')}<small>${c.hp}/${statsOf(c).maxHp}</small></div>`).join('')}</div>
    <button class="primary big heal-go" ${hurt ? '' : 'disabled'}>${hurt ? 'Restore everyone' : 'Everyone is healthy'}</button>
    <p class="svc-note">Your expedition will return here if it falls.</p>`;
  body.querySelector('.heal-go')?.addEventListener('click', () => {
    healAll();
    sfx('heal');
    save();
    toast('Your team is fully restored.', 'good');
    body.classList.add('healed');
    setTimeout(() => body.classList.remove('healed'), 900);
    render();
  });
}

// ── Shop ───────────────────────────────────────────────────────────────
const WARES = [
  { id: 'orbs', name: 'Crit Orb', icon: '◓', price: 60, desc: 'Captures weakened wild creatures.' },
  { id: 'greatOrbs', name: 'Great Orb', icon: '◈', price: 180, desc: '×1.6 capture chance.' },
  { id: 'potions', name: 'Tonic', icon: '🧪', price: 45, desc: 'Restores 50% HP.' },
  { id: 'elixirs', name: 'Elixir', icon: '✨', price: 150, desc: 'Revives or fully heals.' },
] as const;

function shop(body: HTMLElement, head: string, render: () => void) {
  body.innerHTML = `${head}<div class="wares">${WARES.map((w) => `<div class="ware"><span class="ic">${w.icon}</span><div><b>${w.name}</b><small>${w.desc}</small><em>Owned ×${state.inv[w.id]}</em></div><span class="price">◉ ${w.price}</span>
    <button data-w="${w.id}" data-n="1" ${state.inv.gold >= w.price ? '' : 'disabled'}>Buy</button><button data-w="${w.id}" data-n="5" ${state.inv.gold >= w.price * 5 ? '' : 'disabled'}>×5</button></div>`).join('')}</div>`;
  body.querySelectorAll<HTMLElement>('[data-w]').forEach((b) => b.addEventListener('click', () => {
    const w = WARES.find((x) => x.id === b.dataset.w)!;
    const n = Number(b.dataset.n);
    if (state.inv.gold < w.price * n) { sfx('error'); return; }
    state.inv.gold -= w.price * n;
    state.inv[w.id] += n;
    sfx('coin');
    save();
    render();
  }));
}

// ── Hatchery ───────────────────────────────────────────────────────────
function hatchery(body: HTMLElement, head: string, render: () => void) {
  if (!state.flags.giftEgg) {
    state.flags.giftEgg = true;
    const pool = ZONES.flatMap((z) => z.spawns.map((s) => s.species)).filter((id) => !state.dex[id]);
    const sp = baseForm(pick(pool.length ? pool : Object.keys(SPECIES).filter((k) => !SPECIES[k].boss)));
    const g = randomGenes();
    g.hp = Math.max(g.hp, 10); g.atk = Math.max(g.atk, 10);
    state.eggs.push({ uid: newUid(), species: sp, genes: g, parents: ['?', '?'], stepsLeft: 200, stepsTotal: 200 });
    save();
    toast('The hatchery keeper gifts you a <b>Mystery Egg</b>! Walk to hatch it.', 'good', 4200);
  }
  const all = [...state.team, ...state.box].filter((c) => !speciesOf(c).boss);
  const selA = (body.dataset.a && all.find((c) => c.uid === body.dataset.a)) || null;
  const selB = (body.dataset.b && all.find((c) => c.uid === body.dataset.b)) || null;
  const cost = 120;
  const ready = selA && selB && selA !== selB && selA.level >= 5 && selB.level >= 5 && state.eggs.length < EGG_MAX && state.inv.gold >= cost;
  const eggSp = selA ? SPECIES[baseForm(selA.species)] : null;
  body.innerHTML = `${head}
    <div class="hatch-wrap">
      <div class="eggs"><h3>Eggs <small>${state.eggs.length}/${EGG_MAX} · hatch by walking</small></h3>
        ${state.eggs.map((e) => `<div class="egg-row"><div class="egg-mini" style="--el:${ELEMENTS[SPECIES[e.species].element].color}"></div><div><b>${e.parents[0] === '?' ? 'Mystery Egg' : `${SPECIES[e.species].name} egg`}</b>${bar(1 - e.stepsLeft / e.stepsTotal, 'xp')}<small>${Math.max(0, Math.round(e.stepsLeft))} m to go</small></div></div>`).join('') || '<p class="empty-note">No eggs yet.</p>'}
      </div>
      <div class="breed"><h3>Breed a pair <small>Lv 5+ · ◉ ${cost}</small></h3>
        <div class="breed-slots">
          <div class="bslot ${selA ? 'on' : ''}">${selA ? `<img src="${portrait(selA.species, selA.shiny)}" alt=""><b>${displayName(selA)}</b><small>Egg species</small>` : '<span>Parent A</span>'}</div>
          <div class="heart">❤</div>
          <div class="bslot ${selB ? 'on' : ''}">${selB ? `<img src="${portrait(selB.species, selB.shiny)}" alt=""><b>${displayName(selB)}</b><small>Passes a move</small>` : '<span>Parent B</span>'}</div>
        </div>
        ${eggSp && selB ? `<p class="svc-note">Egg: <b>${eggSp.name}</b> · inherits the best genes of both parents (with a chance to mutate higher) and <b>${SKILLS[selB.skills[selB.skills.length - 1]?.id ?? 'strike'].name}</b>.</p>` : '<p class="svc-note">Choose two companions. The egg takes after Parent A.</p>'}
        <div class="breed-pick">${all.map((c) => `<button class="bp ${c === selA ? 'a' : c === selB ? 'b' : ''} ${c.level < 5 ? 'off' : ''}" data-u="${c.uid}"><img src="${portrait(c.species, c.shiny)}" alt=""><span>${displayName(c)}<small>Lv ${c.level} · ${geneGrade(c.genes)}</small></span></button>`).join('')}</div>
        <button class="primary big breed-go" ${ready ? '' : 'disabled'}>${state.eggs.length >= EGG_MAX ? 'Egg nest is full' : 'Leave them together'}</button>
      </div>
    </div>`;
  body.querySelectorAll<HTMLElement>('.bp').forEach((b) => b.addEventListener('click', () => {
    const c = all.find((x) => x.uid === b.dataset.u)!;
    if (c.level < 5) { sfx('error'); toast('Must be level 5 or higher.', 'bad'); return; }
    if (!selA || (selA && selB)) { body.dataset.a = c.uid; delete body.dataset.b; }
    else if (c !== selA) body.dataset.b = c.uid;
    sfx('select');
    render();
  }));
  body.querySelector('.breed-go')?.addEventListener('click', () => {
    if (!ready || !selA || !selB) return;
    state.inv.gold -= cost;
    const inherit = selB.skills[selB.skills.length - 1]?.id;
    const total = 260 + Math.floor(Math.random() * 140);
    state.eggs.push({ uid: newUid(), species: baseForm(selA.species), genes: breedGenes(selA.genes, selB.genes), inheritSkill: inherit, parents: [selA.species, selB.species], stepsLeft: total, stepsTotal: total });
    delete body.dataset.a; delete body.dataset.b;
    sfx('captured');
    save();
    toast('An egg was found in the nest!', 'good');
    render();
  });
}

// ── Elementum Shrine ───────────────────────────────────────────────────
const infuseCost = (c: Creature) => 3 + c.infusion * 2;

function shrine(body: HTMLElement, head: string, render: () => void) {
  body.innerHTML = `${head}<p class="svc-say">“Elementum is the land's memory. Offer shards of a creature's own element to awaken it.”</p>
    <div class="shrine-list">${state.team.map((c, i) => {
      const el = speciesOf(c).element;
      const e = ELEMENTS[el];
      const cost = infuseCost(c);
      const have = state.inv.elementum[el];
      const maxed = c.infusion >= 10;
      return `<div class="sr" style="--el:${e.color}"><img src="${portrait(c.species, c.shiny)}" alt=""><div class="sr-body"><b>${displayName(c)}</b><div class="pips">${Array.from({ length: 10 }, (_, k) => `<i class="${k < c.infusion ? 'on' : ''}"></i>`).join('')}</div><small>All stats +${c.infusion * 3}% · next +3%</small></div>
        <div class="sr-cost"><span>${e.glyph} ${have} / ${cost}</span><button data-i="${i}" ${!maxed && have >= cost ? '' : 'disabled'}>${maxed ? 'Max' : 'Infuse'}</button></div></div>`;
    }).join('')}</div>
    <p class="svc-note">Shards drop from defeated creatures of each element. Guardians drop many.</p>`;
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
    toast(`${displayName(c)} resonates with ${ELEMENTS[el].name} Elementum!`, 'good');
    save();
    render();
  }));
}

// ── Move Master ────────────────────────────────────────────────────────
function tutor(body: HTMLElement, head: string, render: () => void) {
  const idx = Number(body.dataset.sel ?? 0);
  const c = state.team[Math.min(idx, state.team.length - 1)];
  const known = new Set(c.skills.map((s) => s.id));
  const forgotten = speciesOf(c).learnset.filter(([lv, id]) => lv <= c.level && !known.has(id)).map(([, id]) => id);
  const replacing = body.dataset.learn;
  body.innerHTML = `${head}
    <div class="tutor-tabs">${state.team.map((t, i) => `<button class="${t === c ? 'sel' : ''}" data-t="${i}"><img src="${portrait(t.species, t.shiny)}" alt="">${displayName(t)}</button>`).join('')}</div>
    <div class="tutor-skills">${c.skills.map((s, i) => {
      const sk = SKILLS[s.id];
      const e = ELEMENTS[sk.element];
      const gold = 50 * s.rank, shards = s.rank * 2;
      const ok = s.rank < 5 && state.inv.gold >= gold && state.inv.elementum[sk.element] >= shards;
      return `<div class="ts" style="--el:${e.color}"><span class="g">${e.glyph}</span><div><b>${sk.name} ${s.rank > 1 ? `<i class="rank">+${s.rank - 1}</i>` : ''}</b><small>Power ${Math.round(rankedPower(sk, s.rank))} → ${Math.round(rankedPower(sk, s.rank + 1))} · ${rankedAp(sk, s.rank)} AP${s.rank === 4 ? ' (−1 AP at max)' : ''}</small><div class="pips">${Array.from({ length: 5 }, (_, k) => `<i class="${k < s.rank ? 'on' : ''}"></i>`).join('')}</div></div>
        ${replacing ? `<button class="danger" data-rep="${i}">Replace</button>` : `<div class="ts-cost">◉ ${gold} · ${e.glyph} ${shards}<button data-up="${i}" ${ok ? '' : 'disabled'}>${s.rank >= 5 ? 'Mastered' : 'Enhance'}</button></div>`}</div>`;
    }).join('')}</div>
    ${forgotten.length ? `<h3>Remember moves</h3><div class="tutor-forgot">${forgotten.map((id) => `<button data-learn="${id}" class="${replacing === id ? 'sel' : ''}">${ELEMENTS[SKILLS[id].element].glyph} ${SKILLS[id].name}<small>${SKILLS[id].desc}</small></button>`).join('')}</div>` : ''}
    ${replacing ? '<p class="svc-note">Choose a move to replace with <b>' + SKILLS[replacing].name + '</b>.</p>' : '<p class="svc-note">Enhancing raises power +12% per rank. Rank 5 also reduces AP cost by 1.</p>'}`;
  body.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => b.addEventListener('click', () => { body.dataset.sel = b.dataset.t; delete body.dataset.learn; sfx('select'); render(); }));
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
    if (c.skills.length < 4) { c.skills.push({ id, rank: 1 }); save(); sfx('levelup'); render(); return; }
    body.dataset.learn = id;
    sfx('select');
    render();
  }));
  body.querySelectorAll<HTMLElement>('[data-rep]').forEach((b) => b.addEventListener('click', () => {
    const id = body.dataset.learn!;
    c.skills[Number(b.dataset.rep)] = { id, rank: 1 };
    delete body.dataset.learn;
    sfx('levelup');
    save();
    render();
  }));
}
