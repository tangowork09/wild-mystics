// Team & storage: the four-slot team shelf and a paged storage box on the left, the selected
// Mystic's card on the right (stats, moves, relics, evolution) with its actions pinned below.
import { SKILLS } from '../../data/skills';
import { SPECIES, evolutionStages } from '../../data/species';
import { ELEMENTS, type Element } from '../../data/elements';
import { ABILITIES, natureById, RARITY, STATUS } from '../../data/traits';
import { RELICS } from '../../data/relics';
import { ITEMS } from '../../data/items';
import { displayName, geneGrade, rankedAp, rankedPower, speciesOf, statsOf, xpToNext, relicSlots, power, train, trainReady, maxTrainCost, enhanceCost, type Creature, type TrainResult, type StatKey } from '../../game/creature';
import { EVO_LEVELS } from '../../data/lines';
import { state, save, TEAM_MAX } from '../../game/state';
import { awaken, awakenCost } from '../../game/gacha';
import { sfx } from '../../core/audio';
import { toast, modal, popover } from '../dom';
import { confirmRelease } from '../confirm';
import { bar, hpBar, elementBadge, esc, mysticFace, rarityTag, stars, emptyState } from '../kit';
import { icon, glyph } from '../icons';
import { pickRelic } from '../pickers';
import { Pager } from '../pager';
import type { JournalHooks, TabCleanup } from '../journal';

const STAT_MAX = { hp: 520, atk: 120, def: 120, spd: 100 };
type Sub = 'train' | 'stats' | 'moves' | 'relics' | 'evolve';
/** The last training roll per Mystic, shown until another Mystic is trained (Miscrits-style results). */
const lastTrain = new WeakMap<Creature, TrainResult>();
const Q_LABEL = { weak: 'Weak', good: 'Good', great: 'Great', max: 'Max' } as const;

function evoRoutes(c: Creature, night: boolean) {
  return speciesOf(c).evolves.map((e) => {
    const t = SPECIES[e.id];
    const cond = [e.level ? `Lv ${e.level}` : '', e.item ? ITEMS[e.item].name : '', e.time ? (e.time === 'night' ? 'at night' : 'by day') : ''].filter(Boolean).join(' · ');
    const ready = (!e.level || c.level >= e.level) && (!e.item || (state.inv.items[e.item] ?? 0) > 0) && (!e.time || (e.time === 'night') === night);
    return { e, t, cond, ready };
  });
}

export function askText(title: string, value: string, placeholder: string, max = 16): Promise<string | null> {
  return new Promise((resolve) => {
    let out: string | null = null;
    void modal('ask', (b, close) => {
      b.innerHTML = `<h2>${title}</h2><label class="fld"><input maxlength="${max}" value="${esc(value)}" placeholder="${esc(placeholder)}" aria-label="${esc(title)}"></label>
        <div class="row-end"><button class="btn ghost" data-a="no">Cancel</button><button class="btn primary" data-a="ok">Save</button></div>`;
      const inp = b.querySelector('input')!;
      const ok = () => { out = inp.value.trim(); close(); };
      b.querySelector('[data-a=ok]')!.addEventListener('click', ok);
      b.querySelector('[data-a=no]')!.addEventListener('click', () => close());
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
      requestAnimationFrame(() => { inp.focus(); inp.select(); });
    }, () => resolve(out));
  });
}

export function renderTeam(root: HTMLElement, hooks: JournalHooks): TabCleanup {
  let sel: Creature | null = state.team[0] ?? state.box[0] ?? null;
  let filter: Element | '' = '';
  let sub: Sub = 'train';
  root.innerHTML = `<div class="team md">
    <div class="md-master">
      <section class="sec"><header class="sec-h"><b>Team</b><span class="sec-n tm-n"></span><small>Lead battles · others swap in</small></header><div class="tm-slots"></div></section>
      <section class="sec grow"><header class="sec-h"><b>Storage</b><span class="sec-n box-n"></span><button class="chip tm-filter" aria-label="Filter storage by element"></button></header><div class="tm-box"></div></section>
    </div>
    <div class="md-detail tm-detail"></div>
  </div>`;
  const slots = root.querySelector('.tm-slots') as HTMLElement;
  const detail = root.querySelector('.tm-detail') as HTMLElement;
  const filterBtn = root.querySelector('.tm-filter') as HTMLButtonElement;
  const boxList = () => state.box.filter((c) => !filter || speciesOf(c).element === filter);
  const box = new Pager<Creature>(root.querySelector('.tm-box') as HTMLElement, {
    items: boxList(), cell: { w: 66, h: 84 }, gap: 6, label: 'Storage',
    render: (c) => cellHTML(c), selected: (c) => c === sel, onPick: (c) => select(c),
    empty: () => emptyState(filter ? `No ${ELEMENTS[filter].name} Mystics stored` : 'Storage is empty', filter ? 'Try another element filter.' : 'Mystics you catch beyond a full team rest here.', 'chest'),
  });

  const cellHTML = (c: Creature) => `<span class="mcell ${c.hp <= 0 ? 'ko' : ''} ${c.favorite ? 'fav' : ''} ${trainReady(c) ? 'ready' : ''}">${trainReady(c) ? `<i class="mc-train" title="Ready to train">${glyph('chevU')}</i>` : ''}${mysticFace(c.species, c.shiny, 46, `<span class="cap-lv">${c.level}</span>`)}<span class="mc-name ell">${esc(displayName(c))}</span></span>`;

  const drawSlots = () => {
    (root.querySelector('.tm-n') as HTMLElement).textContent = `${state.team.length}/${TEAM_MAX}`;
    (root.querySelector('.box-n') as HTMLElement).textContent = String(state.box.length);
    filterBtn.innerHTML = filter ? `<span class="el-pip" style="--el:${ELEMENTS[filter].color}">${icon(filter)}</span>${ELEMENTS[filter].name}` : `${glyph('filter')}All`;
    slots.innerHTML = Array.from({ length: TEAM_MAX }, (_, i) => {
      const c = state.team[i];
      if (!c) return `<div class="slot empty"><span class="slot-plus">${glyph('plus')}</span><small>Empty</small></div>`;
      const st = statsOf(c);
      return `<button class="slot ${c === sel ? 'sel' : ''} ${c.hp <= 0 ? 'ko' : ''} ${i >= 3 ? 'reserve' : ''}" data-t="${i}" aria-label="${esc(displayName(c))}, level ${c.level}">
        ${i === 0 ? `<span class="slot-lead" title="Lead">${icon('crown')}</span>` : ''}${mysticFace(c.species, c.shiny, 48)}
        <span class="slot-name ell">${esc(displayName(c))}</span><span class="slot-lv">Lv ${c.level}</span>${hpBar(c.hp / st.maxHp, 'thin')}</button>`;
    }).join('');
    slots.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => b.addEventListener('click', () => select(state.team[Number(b.dataset.t)])));
  };

  const select = (c: Creature) => {
    if (c === sel) return;
    sel = c;
    sfx('select');
    drawSlots();
    box.refresh();
    drawDetail();
  };

  const drawDetail = () => {
    const c = sel;
    if (!c) { detail.innerHTML = emptyState('No Mystics yet', 'Your first companion joins you in Hearthwick.', 'paw'); return; }
    const sp = speciesOf(c);
    const e = ELEMENTS[sp.element];
    const st = statsOf(c);
    const inTeam = state.team.includes(c);
    const ti = state.team.indexOf(c);
    detail.style.setProperty('--el', e.color);
    detail.innerHTML = `<div class="cd">
      <div class="cd-hero">
        ${mysticFace(c.species, c.shiny, 104, '', 'cd-cap')}
        <div class="cd-id">
          <div class="cd-name"><span class="display ell">${esc(displayName(c))}</span>${c.favorite ? `<span class="cd-fav" title="Favourite">${glyph('heart')}</span>` : ''}</div>
          <div class="cd-tags">${rarityTag(c.species)}${elementBadge(sp.element, true)}${c.nickname ? `<span class="tag line">${sp.name}</span>` : ''}${c.shiny ? `<span class="tag holo">${icon('sparkles')} Shiny</span>` : ''}${stars(c.stars)}</div>
          <div class="cd-meter"><span class="cd-ml">Lv ${c.level}</span>${bar(c.xp / xpToNext(c.level), 'xp')}<span class="cd-mv tnum">${c.xp}/${xpToNext(c.level)} XP</span></div>
          <div class="cd-meter"><span class="cd-ml">HP</span>${hpBar(c.hp / st.maxHp)}<span class="cd-mv tnum">${c.hp}/${st.maxHp}</span></div>
        </div>
        <div class="cd-power"><small>Power</small><b class="tnum">${power(c)}</b></div>
      </div>
      <div class="seg cd-subs" role="tablist">${(['train', 'stats', 'moves', 'relics', 'evolve'] as Sub[]).map((s) => `<button role="tab" data-sub="${s}" class="${s === sub ? 'on' : ''} ${s === 'train' && trainReady(c) ? 'glow' : ''}" aria-selected="${s === sub}">${{ train: 'Train', stats: 'Stats', moves: 'Moves', relics: 'Relics', evolve: 'Evolve' }[s]}</button>`).join('')}</div>
      <div class="cd-page">${subPage(c)}</div>
      <div class="cd-actions">${inTeam ? `
        ${ti > 0 ? `<button class="btn small" data-act="lead" title="Make lead">${icon('crown')}<span class="lb">Lead</span></button>` : ''}
        <button class="btn small round" data-act="up" ${ti <= 0 ? 'disabled' : ''} aria-label="Move left">${glyph('chevL')}</button>
        <button class="btn small round" data-act="down" ${ti >= state.team.length - 1 ? 'disabled' : ''} aria-label="Move right">${glyph('chevR')}</button>
        <button class="btn small" data-act="tobox" title="Send to storage">${icon('chest')}<span class="lb">Store</span></button>`
        : `<button class="btn small primary" data-act="toteam">${icon('paw')}<span class="lb">To team</span></button>`}
        ${c.stars < 5 ? `<button class="btn small gold" data-act="awaken" title="Awaken with Mystic Essence">${icon('sparkles')}<span class="lb">Awaken ${c.stars + 1}★</span><small>${awakenCost(c.stars)}</small></button>` : ''}
        ${sp.rideable ? `<button class="btn small" data-act="ride">${icon('paw')}<span class="lb">Ride</span></button>` : ''}
        <button class="btn small round cd-more" data-act="more" aria-label="More actions">${glyph('more')}</button>
      </div></div>`;
    detail.querySelectorAll<HTMLElement>('[data-sub]').forEach((b) => b.addEventListener('click', () => { sub = b.dataset.sub as Sub; sfx('select'); drawDetail(); }));
    detail.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => b.addEventListener('click', () => void act(b.dataset.act!, b)));
  };

  const subPage = (c: Creature) => {
    const sp = speciesOf(c);
    const st = statsOf(c);
    const nat = natureById(c.nature);
    if (sub === 'train') {
      const ready = trainReady(c);
      const need = xpToNext(c.level);
      const cost = maxTrainCost(c);
      const last = lastTrain.get(c);
      const nextEvo = EVO_LEVELS.find((l) => l > c.level);
      const evoTarget = sp.evolves.find((e) => e.level && !e.item)?.id;
      const val = (k: StatKey) => (k === 'hp' ? st.maxHp : st[k]);
      const row = (k: StatKey) => {
        const q = last?.quality[k];
        const d = last ? (k === 'hp' ? last.after.maxHp - last.before.maxHp : last.after[k] - last.before[k]) : 0;
        return `<div class="tr-row"><span class="st-k">${k.toUpperCase()}</span><b class="tnum">${val(k)}</b>${q ? `<span class="tr-gain q-${q}">+${d} <small>${Q_LABEL[q]}</small></span>` : '<span class="tr-gain none">—</span>'}</div>`;
      };
      return `<div class="train">
        <div class="tr-head">
          <div class="tr-lv"><small>Level</small><b class="display tnum">${c.level}</b></div>
          <div class="tr-xp">${bar(Math.min(1, c.xp / need), 'xp big')}<span class="tnum">${ready ? 'XP bar full: ready to train!' : `${c.xp} / ${need} XP · win battles to fill the bar`}</span></div>
        </div>
        <div class="tr-rows">${(['hp', 'atk', 'def', 'spd'] as StatKey[]).map(row).join('')}</div>
        <div class="tr-btns">
          <button class="btn primary big" data-act="train" ${ready ? '' : 'disabled'}>${glyph('chevU')} Train <small>Free</small></button>
          <button class="btn gold big" data-act="maxtrain" ${ready ? '' : 'disabled'}>${icon('sparkles')} Max Train <small>${icon('gem')} ${cost}</small></button>
        </div>
        <p class="tr-note">${nextEvo && evoTarget && SPECIES[evoTarget] ? `Evolves at <b>Lv ${nextEvo}</b> into <b>${state.dex[evoTarget]?.seen ? SPECIES[evoTarget].name : '???'}</b>. ` : ''}Train rolls each stat Weak, Good or Great; Max Train makes every roll Max.</p>
      </div>`;
    }
    if (sub === 'stats') {
      const stat = (k: 'hp' | 'atk' | 'def' | 'spd', v: number) => `<div class="stat ${nat.up === k ? 'up' : nat.down === k ? 'down' : ''}"><span class="st-k">${k.toUpperCase()}${nat.up === k ? glyph('chevU') : nat.down === k ? glyph('chevD') : ''}</span>${bar(v / STAT_MAX[k], 'st')}<b class="tnum">${v}</b><em title="Gene ${c.genes[k]}/15">${c.genes[k]}</em></div>`;
      const ab = ABILITIES[c.ability];
      return `<div class="cd-stats">${stat('hp', st.maxHp)}${stat('atk', st.atk)}${stat('def', st.def)}${stat('spd', st.spd)}</div>
        <div class="cd-facts"><span class="fact"><small>Genes</small><b class="grade g${geneGrade(c.genes)}">${geneGrade(c.genes)}</b></span><span class="fact"><small>Nature</small><b>${nat.name}</b></span>${c.infusion ? `<span class="fact"><small>Infusion</small><b>+${c.infusion * 3}%</b></span>` : ''}</div>
        <div class="cd-ability"><b>${ab.name}</b><p>${ab.desc}</p></div>`;
    }
    if (sub === 'moves') {
      return `<div class="cd-moves">${c.skills.map((s) => {
        const sk = SKILLS[s.id];
        if (!sk) return '';
        const cost = enhanceCost(s.rank);
        const can = s.rank < 5 && state.inv.gold >= cost.gold && state.inv.elementum[sk.element] >= cost.shards;
        return `<div class="move" style="--el:${ELEMENTS[sk.element].color}"><span class="mv-el">${icon(sk.element)}</span><span class="mv-b"><b class="ell">${sk.name}${s.rank > 1 ? ` <i class="rank">+${s.rank - 1}</i>` : ''}</b><small>${sk.power ? `Power ${Math.round(rankedPower(sk, s.rank))}${s.rank < 5 ? ` → ${Math.round(rankedPower(sk, s.rank + 1))}` : ''}` : sk.desc}</small></span><span class="mv-ap tnum">${rankedAp(sk, s.rank)}<small>AP</small></span>${sk.status ? `<i class="mv-st" style="--c:${STATUS[sk.status.id].color}">${STATUS[sk.status.id].short}</i>` : ''}${s.rank >= 5 ? '<span class="tag gold">Max</span>' : `<button class="btn tiny ${can ? 'primary' : ''}" data-act="enh:${s.id}" ${can ? '' : 'disabled'} title="Enhance: ${cost.gold} gold + ${cost.shards} ${ELEMENTS[sk.element].name} Elementum">${glyph('chevU')}<small class="tnum">${cost.gold}</small></button>`}</div>`;
      }).join('')}</div>`;
    }
    if (sub === 'relics') {
      const slotsN = relicSlots(c);
      return `<div class="cd-relics">${Array.from({ length: 3 }, (_, i) => {
        if (i >= slotsN) return `<div class="rslot locked">${icon('lock')}<span><b>Locked</b><small>Opens at 3★</small></span></div>`;
        const inst = state.relics.find((r) => r.uid === c.relics[i]);
        const d = inst ? RELICS[inst.id] : null;
        return `<button class="rslot ${d ? 'on' : ''}" data-act="relic:${i}" ${d ? `style="--rar:${RARITY[d.rarity].color}"` : ''}>${d ? `<span class="rs-ic">${icon(d.effect === 'element' ? d.element ?? 'gem' : 'crown')}</span><span><b>${d.name} <i class="tnum">Lv ${inst!.level}</i></b><small>${d.desc}</small></span>` : `<span class="rs-ic">${glyph('plus')}</span><span><b>Empty slot</b><small>Equip a relic</small></span>`}</button>`;
      }).join('')}</div>`;
    }
    const stages = evolutionStages(c.species);
    const routes = evoRoutes(c, hooks.isNight());
    return `<div class="evo-line">${stages.map((col) => `<span class="evo-col">${col.map((id) => `<span class="evo-node ${id === c.species ? 'cur' : ''}">${mysticFace(id, c.shiny, 50, '', state.dex[id]?.seen || id === c.species ? '' : 'unseen')}<small class="ell">${state.dex[id]?.seen || id === c.species ? SPECIES[id].name : '???'}</small></span>`).join('')}</span>`).join(`<i class="evo-arrow">${glyph('chevR')}</i>`)}</div>
      ${routes.length ? `<div class="evo-routes">${routes.map((r) => `<button class="btn small ${r.ready ? 'primary' : ''}" data-act="evo:${r.e.id}" ${r.ready ? '' : 'disabled'}>${icon('sparkles')}${r.t.name}<small>${r.cond}</small></button>`).join('')}</div>` : `<p class="muted cd-note">${sp.name} is a final form.</p>`}`;
  };

  const act = async (a: string, anchor: HTMLElement) => {
    if (!sel) return;
    const c = sel;
    const ti = state.team.indexOf(c), bi = state.box.indexOf(c);
    if (a === 'more') {
      const pick = await popover(anchor, [
        { value: 'fav', label: c.favorite ? 'Unfavourite' : 'Favourite', icon: glyph('heart') },
        { value: 'rename', label: 'Rename', icon: icon('scroll') },
        ...(bi >= 0 ? [{ value: 'release', label: 'Release to the wild', icon: glyph('close'), danger: true }] : []),
      ]);
      if (!pick) return;
      a = pick;
    }
    if (a === 'lead' && ti > 0) { state.team.splice(ti, 1); state.team.unshift(c); }
    if (a === 'up' && ti > 0) [state.team[ti - 1], state.team[ti]] = [state.team[ti], state.team[ti - 1]];
    if (a === 'down' && ti >= 0 && ti < state.team.length - 1) [state.team[ti + 1], state.team[ti]] = [state.team[ti], state.team[ti + 1]];
    if (a === 'tobox' && ti >= 0) {
      if (state.team.length <= 1) { toast('You need at least one companion.', 'bad'); sfx('error'); return; }
      state.team.splice(ti, 1); state.box.push(c);
    }
    if (a === 'toteam' && bi >= 0) {
      if (state.team.length >= TEAM_MAX) { toast('Your team is full. Send someone to storage first.', 'bad'); sfx('error'); return; }
      state.box.splice(bi, 1); state.team.push(c);
    }
    if (a === 'fav') c.favorite = !c.favorite;
    if (a === 'release' && bi >= 0) {
      if (c.favorite) { toast('Unfavourite it first.', 'bad'); return; }
      if (!(await confirmRelease(displayName(c), c.species, c.shiny))) return;
      state.box.splice(bi, 1);
      state.inv.essence += 5;
      sel = state.team[0] ?? state.box[0] ?? null;
      toast('Released. You received 5 Mystic Essence.');
    }
    if (a === 'awaken') {
      if (awaken(c)) { sfx('levelup'); toast(`${esc(displayName(c))} awakened to ${c.stars}★!`, 'good'); } else { sfx('error'); toast(`Awakening needs ${awakenCost(c.stars)} Mystic Essence.`, 'bad'); }
    }
    if (a === 'rename') {
      const name = await askText('Rename', c.nickname ?? '', speciesOf(c).name);
      if (name !== null) c.nickname = name ? name.slice(0, 16) : undefined;
    }
    if (a === 'train' || a === 'maxtrain') {
      const max = a === 'maxtrain';
      if (max && state.inv.aether < maxTrainCost(c)) { sfx('error'); toast(`Max Train needs ${maxTrainCost(c)} Aether.`, 'bad'); return; }
      if (max) state.inv.aether -= maxTrainCost(c);
      const r = train(c, max, hooks.isNight());
      if (!r) { sfx('error'); return; }
      lastTrain.set(c, r);
      sfx('levelup');
      toast(`${esc(displayName(c))} trained to <b>Lv ${c.level}</b>${max ? ' · Max Train!' : ''}${r.newSkills.length ? ` · learned <b>${r.newSkills.map((id) => SKILLS[id]?.name ?? id).join(', ')}</b>` : ''}`, 'good');
      save();
      drawSlots();
      box.refresh();
      drawDetail();
      if (r.evolveTo) { await hooks.evolve(c, r.evolveTo); lastTrain.delete(c); }
    }
    if (a.startsWith('enh:')) {
      const s = c.skills.find((x) => x.id === a.slice(4));
      const sk = s && SKILLS[s.id];
      if (s && sk) {
        const cost = enhanceCost(s.rank);
        if (s.rank >= 5 || state.inv.gold < cost.gold || state.inv.elementum[sk.element] < cost.shards) { sfx('error'); toast(`Enhancing needs ${cost.gold} gold and ${cost.shards} ${ELEMENTS[sk.element].name} Elementum.`, 'bad'); return; }
        state.inv.gold -= cost.gold;
        state.inv.elementum[sk.element] -= cost.shards;
        s.rank++;
        sfx('levelup');
        toast(`${sk.name} enhanced to rank ${s.rank}!`, 'good');
      }
    }
    if (a.startsWith('evo:')) await hooks.evolve(c, a.slice(4));
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
    save();
    drawSlots();
    box.setItems(boxList(), sel && state.box.includes(sel) ? boxList().indexOf(sel) : undefined);
    drawDetail();
  };

  filterBtn.addEventListener('click', async () => {
    const pick = await popover(filterBtn, [{ value: '' as const, label: 'All elements', icon: glyph('grid'), on: !filter }, ...(Object.keys(ELEMENTS) as Element[]).map((k) => ({ value: k, label: ELEMENTS[k].name, icon: `<span class="el-pip" style="--el:${ELEMENTS[k].color}">${icon(k)}</span>`, on: filter === k }))], { cols: 2 });
    if (pick === null) return;
    filter = pick;
    sfx('select');
    drawSlots();
    box.setItems(boxList(), 0);
  });

  drawSlots();
  drawDetail();
  return () => box.destroy();
}
