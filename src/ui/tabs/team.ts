import { SKILLS } from '../../data/skills';
import { SPECIES, evolutionStages } from '../../data/species';
import { ELEMENTS } from '../../data/elements';
import { ABILITIES, natureById, RARITY, STATUS } from '../../data/traits';
import { RELICS } from '../../data/relics';
import { ITEMS } from '../../data/items';
import {
  displayName, geneGrade, rankedAp, speciesOf, statsOf, xpToNext, evolutionFor, relicSlots, power, type Creature,
} from '../../game/creature';
import { state, save, TEAM_MAX } from '../../game/state';
import { awaken, awakenCost } from '../../game/gacha';
import { sfx } from '../../core/audio';
import { toast, confirmBox } from '../dom';
import { bar, creatureCard, elementBadge, esc, mysticFace, rarityTag, stars } from '../kit';
import { icon } from '../icons';
import { pickRelic } from '../pickers';
import type { JournalHooks } from '../journal';

const STAT_MAX = { hp: 520, atk: 120, def: 120, spd: 100 };

function evoRoutes(c: Creature, night: boolean) {
  const sp = speciesOf(c);
  return sp.evolves.map((e) => {
    const t = SPECIES[e.id];
    const cond = [e.level ? `Lv ${e.level}` : '', e.item ? ITEMS[e.item].name : '', e.time ? (e.time === 'night' ? 'at night' : 'by day') : ''].filter(Boolean).join(' · ');
    const lvOk = !e.level || c.level >= e.level;
    const itemOk = !e.item || (state.inv.items[e.item] ?? 0) > 0;
    const timeOk = !e.time || (e.time === 'night') === night;
    return { e, t, cond, ready: lvOk && itemOk && timeOk };
  });
}

export function renderTeam(root: HTMLElement, hooks: JournalHooks) {
  let sel: Creature | null = state.team[0] ?? state.box[0] ?? null;
  let boxFilter = '';
  const draw = () => {
    const box = state.box.filter((c) => !boxFilter || displayName(c).toLowerCase().includes(boxFilter) || speciesOf(c).element === boxFilter);
    root.innerHTML = `<div class="team-wrap">
      <div class="team-col">
        <div class="sec-h">${icon('paw')}<span>Team</span><small>${state.team.length}/${TEAM_MAX} · first three battle</small></div>
        <div class="team-list">${state.team.map((c, i) => creatureCard(c, { key: `t${i}`, selected: sel === c, note: i === 0 ? 'Lead' : i >= 3 ? 'Reserve' : '' })).join('')}
          ${Array.from({ length: TEAM_MAX - state.team.length }, () => '<div class="ccard empty">Empty slot</div>').join('')}</div>
        <div class="sec-h">${icon('chest')}<span>Storage</span><small>${state.box.length}</small></div>
        <div class="box-tools"><input class="search" placeholder="Search storage…" value="${esc(boxFilter)}"></div>
        <div class="box-grid">${box.map((c) => creatureCard(c, { key: `b${state.box.indexOf(c)}`, selected: sel === c, small: true })).join('') || '<p class="muted">Captured Mystics beyond your team rest here.</p>'}</div>
      </div>
      <div class="detail-col">${sel ? detail(sel) : ''}</div></div>`;
    root.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => n.addEventListener('click', () => {
      const k = n.dataset.k!;
      sel = k.startsWith('t') ? state.team[Number(k.slice(1))] : state.box[Number(k.slice(1))];
      sfx('select');
      draw();
    }));
    const search = root.querySelector<HTMLInputElement>('.search');
    search?.addEventListener('input', () => { boxFilter = search.value.toLowerCase(); const pos = search.selectionStart; draw(); const s2 = root.querySelector<HTMLInputElement>('.search'); s2?.focus(); s2?.setSelectionRange(pos, pos); });
    root.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => b.addEventListener('click', () => void act(b.dataset.act!, b)));
  };

  const act = async (a: string, b: HTMLElement) => {
    if (!sel) return;
    const c = sel;
    const ti = state.team.indexOf(c), bi = state.box.indexOf(c);
    if (a === 'lead' && ti > 0) { state.team.splice(ti, 1); state.team.unshift(c); }
    if (a === 'up' && ti > 0) [state.team[ti - 1], state.team[ti]] = [state.team[ti], state.team[ti - 1]];
    if (a === 'down' && ti >= 0 && ti < state.team.length - 1) [state.team[ti + 1], state.team[ti]] = [state.team[ti], state.team[ti + 1]];
    if (a === 'tobox' && ti >= 0) {
      if (state.team.length <= 1) { toast('You need at least one companion.', 'bad'); sfx('error'); return; }
      state.team.splice(ti, 1); state.box.push(c);
    }
    if (a === 'toteam' && bi >= 0) {
      if (state.team.length >= TEAM_MAX) { toast('Team is full — move someone to storage first.', 'bad'); sfx('error'); return; }
      state.box.splice(bi, 1); state.team.push(c);
    }
    if (a === 'fav') c.favorite = !c.favorite;
    if (a === 'release' && bi >= 0) {
      if (c.favorite) { toast('Unfavourite it first.', 'bad'); return; }
      if (!(await confirmBox('Release?', `${esc(displayName(c))} will return to the wild. This can't be undone.`, 'Release', true))) return;
      state.box.splice(bi, 1);
      state.inv.essence += 5;
      sel = state.team[0];
      toast('Released. You received 5 Mystic Essence.');
    }
    if (a === 'awaken') {
      if (awaken(c)) { sfx('levelup'); toast(`${esc(displayName(c))} awakened to ${c.stars}★!`, 'good'); } else { sfx('error'); toast('Not enough Mystic Essence.', 'bad'); }
    }
    if (a === 'rename') {
      const name = prompt('Nickname (blank to reset):', c.nickname ?? '')?.trim();
      if (name !== undefined) c.nickname = name ? name.slice(0, 16) : undefined;
    }
    if (a.startsWith('evo:')) { await hooks.evolve(c, a.slice(4)); }
    if (a.startsWith('relic:')) {
      const slot = Number(a.slice(6));
      if (c.relics[slot]) { c.relics.splice(slot, 1); sfx('back'); }
      else {
        const uid = await pickRelic(`Equip a relic on ${esc(displayName(c))}`, c);
        if (uid) {
          for (const o of [...state.team, ...state.box]) o.relics = o.relics.filter((x) => x !== uid);
          c.relics.push(uid);
          sfx('select');
        }
      }
    }
    if (a === 'ride') { hooks.ride(c); return; }
    void b;
    save();
    draw();
  };

  const detail = (c: Creature) => {
    const sp = speciesOf(c);
    const e = ELEMENTS[sp.element];
    const st = statsOf(c);
    const nat = natureById(c.nature);
    const ab = ABILITIES[c.ability];
    const inTeam = state.team.includes(c);
    const stages = evolutionStages(c.species);
    const routes = evoRoutes(c, hooks.isNight());
    const stat = (k: 'hp' | 'atk' | 'def' | 'spd', v: number) => `<div class="stat ${nat.up === k ? 'up' : nat.down === k ? 'down' : ''}"><span>${k.toUpperCase()}${nat.up === k ? '▲' : nat.down === k ? '▼' : ''}</span>${bar(v / STAT_MAX[k], 'st')}<b>${v}</b><em title="Gene">${c.genes[k]}</em></div>`;
    const slots = relicSlots(c);
    return `<div class="cd" style="--el:${e.color};--rar:${RARITY[sp.rarity].color}">
      <div class="cd-hero">
        <div class="cd-art">${mysticFace(c.species, c.shiny, 190)}</div>
        <div class="cd-id">
          <div class="cd-tags">${rarityTag(c.species)}${elementBadge(sp.element, true)}${c.shiny ? `<span class="shiny-tag">${icon('sparkle')} Shiny</span>` : ''}${c.favorite ? `<span class="fav-tag">${icon('heart')}</span>` : ''}</div>
          <div class="cd-name">${esc(displayName(c))}${c.nickname ? `<small>${sp.name}</small>` : ''}</div>
          ${stars(c.stars)}
          <div class="cd-lv">Level ${c.level} ${bar(c.xp / xpToNext(c.level), 'xp')}<small>${c.xp} / ${xpToNext(c.level)} XP · Power ${power(c)}</small></div>
          <div class="cd-hp">HP ${c.hp} / ${st.maxHp} ${bar(c.hp / st.maxHp, 'hp')}</div>
        </div>
      </div>
      <div class="cd-grid">
        <section class="cd-card"><h4>Stats</h4><div class="cd-stats">${stat('hp', st.maxHp)}${stat('atk', st.atk)}${stat('def', st.def)}${stat('spd', st.spd)}</div>
          <div class="cd-meta"><span>Genes <b class="grade g${geneGrade(c.genes)}">${geneGrade(c.genes)}</b></span><span>Nature <b>${nat.name}</b> <i>${nat.flavor}</i></span>${c.infusion ? `<span>Infusion <b>✦ ${c.infusion}</b></span>` : ''}</div></section>
        <section class="cd-card"><h4>Ability</h4><div class="ability"><b>${ab.name}</b><p>${ab.desc}</p></div>
          <h4>Relics <small>${c.relics.length}/${slots}</small></h4><div class="relic-slots">${Array.from({ length: slots }, (_, i) => {
            const inst = state.relics.find((r) => r.uid === c.relics[i]);
            const d = inst ? RELICS[inst.id] : null;
            return `<button class="rslot ${d ? 'on' : ''}" data-act="relic:${i}" ${d ? `style="--rar:${RARITY[d.rarity].color}"` : ''}>${d ? `${icon('crown')}<b>${d.name}</b><small>Lv ${inst!.level} · ${d.desc}</small>` : `${icon('lock')}<small>Empty slot — tap to equip</small>`}</button>`;
          }).join('')}${c.stars < 3 ? '<p class="muted small">A third slot unlocks at 3★.</p>' : ''}</div></section>
        <section class="cd-card wide"><h4>Moves</h4><div class="cd-skills">${c.skills.map((s) => {
          const sk = SKILLS[s.id];
          if (!sk) return '';
          const se = ELEMENTS[sk.element];
          return `<div class="cs" style="--el:${se.color}"><span class="g">${icon(sk.element)}</span><b>${sk.name}${s.rank > 1 ? ` <i class="rank">+${s.rank - 1}</i>` : ''}${sk.status ? ` <i class="stag" style="--c:${STATUS[sk.status.id].color}">${STATUS[sk.status.id].short}</i>` : ''}</b><small>${sk.desc}</small><em>${rankedAp(sk, s.rank)} AP</em></div>`;
        }).join('')}</div></section>
        <section class="cd-card wide"><h4>Evolution</h4><div class="evo-line">${stages.map((st) => `<span class="evo-col">${st.map((id) => `<span class="evo-node ${id === c.species ? 'cur' : ''}">${mysticFace(id, c.shiny, 44)}<small>${state.dex[id]?.seen || id === c.species ? SPECIES[id].name : '???'}</small></span>`).join('')}</span>`).join('<i class="evo-arrow">›</i>')}</div>
          ${routes.length ? `<div class="evo-routes">${routes.map((r) => `<button class="btn ${r.ready ? 'primary' : 'ghost'}" data-act="evo:${r.e.id}" ${r.ready ? '' : 'disabled'}>${icon('sparkles')} ${r.t.name}<small>${r.cond}</small></button>`).join('')}</div>` : '<p class="muted small">Final form.</p>'}</section>
      </div>
      <p class="cd-lore">${sp.lore}</p>
      <div class="cd-actions">
        ${inTeam ? `<button class="btn" data-act="lead">${icon('crown')} Lead</button><button class="btn" data-act="up">▲</button><button class="btn" data-act="down">▼</button><button class="btn" data-act="tobox">${icon('chest')} To storage</button>` : `<button class="btn primary" data-act="toteam">${icon('paw')} To team</button><button class="btn danger" data-act="release">Release</button>`}
        <button class="btn" data-act="fav">${icon('heart')} ${c.favorite ? 'Unfavourite' : 'Favourite'}</button>
        <button class="btn" data-act="rename">Rename</button>
        ${c.stars < 5 ? `<button class="btn gold" data-act="awaken">${icon('sparkles')} Awaken ${c.stars + 1}★ <small>${awakenCost(c.stars)} essence</small></button>` : ''}
        ${sp.rideable ? `<button class="btn" data-act="ride">${icon('paw')} Ride</button>` : ''}
      </div></div>`;
  };
  void evolutionFor;
  draw();
}
