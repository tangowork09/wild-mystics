import { portrait } from '../assets/manifest';
import { sfx, isMuted, setMuted } from '../core/audio';
import { ELEMENTS } from '../data/elements';
import { SKILLS } from '../data/skills';
import { SPECIES, evolutionLine } from '../data/species';
import { ZONES } from '../data/zones';
import {
  canEvolve, displayName, geneGrade, rankedAp, speciesOf, statsOf, xpToNext, type Creature,
} from '../game/creature';
import { state, save, TEAM_MAX } from '../game/state';
import { bar, el, modal, toast } from './dom';
import type { Minimap } from './minimap';

export interface MenuHooks {
  evolve: (c: Creature) => Promise<void>;
}

export function creatureDetail(c: Creature, hooks?: MenuHooks, extra = ''): string {
  const sp = speciesOf(c);
  const e = ELEMENTS[sp.element];
  const st = statsOf(c);
  const line = evolutionLine(c.species);
  const ev = sp.evolvesTo;
  const statRow = (k: 'hp' | 'atk' | 'def' | 'spd', v: number, max: number) => `<div class="stat"><span>${k.toUpperCase()}</span>${bar(v / max, 'st')}<b>${v}</b><em title="gene">${c.genes[k]}</em></div>`;
  return `<div class="cd" style="--el:${e.color}">
    <div class="cd-art"><div class="cd-glow"></div><img src="${portrait(c.species, c.shiny)}" alt="">${c.shiny ? '<div class="shiny-tag">✧ Shimmering</div>' : ''}</div>
    <div class="cd-info">
      <div class="cd-el">${e.glyph} ${e.name}${c.infusion ? ` · <span class="inf">✦ Infused ${c.infusion}</span>` : ''}</div>
      <div class="cd-name">${displayName(c)}</div>
      <div class="cd-lv">Level ${c.level} ${bar(c.xp / xpToNext(c.level), 'xp')}<small>${c.xp} / ${xpToNext(c.level)} XP</small></div>
      <div class="cd-hp">HP ${c.hp} / ${st.maxHp} ${bar(c.hp / st.maxHp, 'hp')}</div>
      <div class="cd-stats">${statRow('hp', st.maxHp, 400)}${statRow('atk', st.atk, 90)}${statRow('def', st.def, 90)}${statRow('spd', st.spd, 80)}<div class="genes">Genes <b class="grade g${geneGrade(c.genes)}">${geneGrade(c.genes)}</b></div></div>
      <div class="cd-skills">${c.skills.map((s) => {
        const sk = SKILLS[s.id];
        const se = ELEMENTS[sk.element];
        return `<div class="cs" style="--el:${se.color}"><span class="g">${se.glyph}</span><b>${sk.name}${s.rank > 1 ? ` <i class="rank">+${s.rank - 1}</i>` : ''}</b><small>${sk.desc}</small><em>${rankedAp(sk, s.rank)} AP</em></div>`;
      }).join('')}</div>
      <div class="cd-evo">${line.map((id) => `<span class="${id === c.species ? 'cur' : ''}">${SPECIES[id].name}</span>`).join('<i>›</i>')}
        ${ev ? `<small>${canEvolve(c) ? 'Ready to evolve!' : `Evolves at Lv ${ev.level}`}</small>` : ''}
        ${hooks && canEvolve(c) ? '<button class="primary evo-btn">Evolve</button>' : ''}</div>
      <p class="cd-lore">${sp.lore}</p>
      ${extra}
    </div></div>`;
}

export function teamMenu(hooks: MenuHooks, withBox = false): Promise<void> {
  return modal(`team ${withBox ? 'with-box' : ''}`, (body) => {
    let sel: Creature | null = state.team[0] ?? null;
    const render = () => {
      body.innerHTML = `<h2>${withBox ? 'Keeper · Team & Storage' : 'Your Team'}</h2>
        <div class="team-wrap"><div class="team-list">${state.team.map((c, i) => card(c, `t${i}`, sel === c)).join('')}
          ${Array.from({ length: TEAM_MAX - state.team.length }, () => '<div class="tcard empty">Empty slot</div>').join('')}
          ${withBox ? '' : `<div class="box-note">${state.box.length} in storage — visit a <b>Keeper</b> to swap.</div>`}</div>
        <div class="team-detail">${sel ? creatureDetail(sel, hooks, actions(sel)) : ''}</div></div>
        ${withBox ? `<h3>Storage <small>${state.box.length}</small></h3><div class="box-grid">${state.box.map((c, i) => card(c, `b${i}`, sel === c, true)).join('') || '<div class="empty-note">Captured creatures beyond your team of four rest here.</div>'}</div>` : ''}`;
      body.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => n.addEventListener('click', () => {
        const k = n.dataset.k!;
        sel = k.startsWith('t') ? state.team[Number(k.slice(1))] : state.box[Number(k.slice(1))];
        sfx('select');
        render();
      }));
      body.querySelector('.evo-btn')?.addEventListener('click', async () => { if (sel) { await hooks.evolve(sel); render(); } });
      body.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => b.addEventListener('click', () => {
        if (!sel) return;
        const a = b.dataset.act;
        const ti = state.team.indexOf(sel), bi = state.box.indexOf(sel);
        if (a === 'lead' && ti > 0) { state.team.splice(ti, 1); state.team.unshift(sel); }
        if (a === 'up' && ti > 0) { [state.team[ti - 1], state.team[ti]] = [state.team[ti], state.team[ti - 1]]; }
        if (a === 'down' && ti >= 0 && ti < state.team.length - 1) { [state.team[ti + 1], state.team[ti]] = [state.team[ti], state.team[ti + 1]]; }
        if (a === 'tobox' && ti >= 0) {
          if (state.team.length <= 1) { toast('You need at least one companion.', 'bad'); sfx('error'); return; }
          state.team.splice(ti, 1); state.box.push(sel);
        }
        if (a === 'toteam' && bi >= 0) {
          if (state.team.length >= TEAM_MAX) { toast('Team is full — send someone to storage first.', 'bad'); sfx('error'); return; }
          state.box.splice(bi, 1); state.team.push(sel);
        }
        if (a === 'release' && bi >= 0) {
          if (!confirmInline(b)) return;
          state.box.splice(bi, 1); sel = state.team[0]; toast('Released back into the wild. Farewell!');
        }
        sfx('select');
        save();
        render();
      }));
    };
    const actions = (c: Creature) => {
      const inTeam = state.team.includes(c);
      if (inTeam) return `<div class="cd-actions"><button data-act="lead">Make lead</button><button data-act="up">▲</button><button data-act="down">▼</button>${withBox ? '<button data-act="tobox">Send to storage</button>' : ''}</div>`;
      return `<div class="cd-actions"><button class="primary" data-act="toteam">Add to team</button><button class="danger" data-act="release">Release</button></div>`;
    };
    render();
  });
}

function confirmInline(b: HTMLElement) {
  if (b.dataset.armed) return true;
  b.dataset.armed = '1';
  b.textContent = 'Tap again to confirm';
  setTimeout(() => { delete b.dataset.armed; b.textContent = 'Release'; }, 2500);
  return false;
}

function card(c: Creature, key: string, selected: boolean, small = false) {
  const e = ELEMENTS[speciesOf(c).element];
  const st = statsOf(c);
  return `<button class="tcard ${selected ? 'sel' : ''} ${small ? 'small' : ''} ${c.hp <= 0 ? 'ko' : ''}" data-k="${key}" style="--el:${e.color}">
    <img src="${portrait(c.species, c.shiny)}" alt=""><div class="tc-body"><b>${displayName(c)}${c.shiny ? ' <i class="shiny">✧</i>' : ''}</b><span>${e.glyph} Lv ${c.level}${canEvolve(c) ? ' · <em>Evolve!</em>' : ''}</span>${bar(c.hp / st.maxHp, 'hp')}</div></button>`;
}

export function dexMenu(): Promise<void> {
  return modal('dex', (body) => {
    const all = Object.values(SPECIES).filter((s) => !s.boss);
    const caught = all.filter((s) => state.dex[s.id] === 'caught').length;
    const seen = all.filter((s) => state.dex[s.id]).length;
    const render = (focus?: string) => {
      const f = focus ? SPECIES[focus] : null;
      body.innerHTML = `<h2>Crittdex <small>${caught} caught · ${seen} seen · ${all.length} total</small></h2>
        <div class="dex-wrap"><div class="dex-grid">${all.map((s, i) => {
          const d = state.dex[s.id];
          return `<button class="dx ${d ?? 'unseen'} ${focus === s.id ? 'sel' : ''}" data-id="${s.id}" style="--el:${ELEMENTS[s.element].color}"><span class="no">${String(i + 1).padStart(3, '0')}</span><img src="${portrait(s.id)}" alt=""><b>${d ? s.name : '???'}</b></button>`;
        }).join('')}</div>
        <div class="dex-detail">${f ? dexDetail(f.id) : '<p class="empty-note">Select a creature.</p>'}</div></div>`;
      body.querySelectorAll<HTMLElement>('.dx').forEach((b) => b.addEventListener('click', () => { sfx('select'); render(b.dataset.id); }));
    };
    render(all.find((s) => state.dex[s.id])?.id);
  });
}

function dexDetail(id: string) {
  const s = SPECIES[id];
  const d = state.dex[id];
  if (!d) return '<div class="dd unseen"><div class="q">?</div><p>Not yet encountered. Explore every zone — some only appear in tall grass or glimmering bushes.</p></div>';
  const e = ELEMENTS[s.element];
  const zones = ZONES.filter((z) => z.spawns.some((sp) => sp.species === id)).map((z) => z.name);
  const line = evolutionLine(id);
  return `<div class="dd" style="--el:${e.color}"><img src="${portrait(id)}" alt=""><div class="dd-el">${e.glyph} ${e.name}</div><h3>${s.name}</h3>
    <p class="cd-lore">${s.lore}</p>
    <div class="dd-row"><span>Habitat</span><b>${zones.join(', ') || 'Bred or evolved only'}</b></div>
    <div class="dd-row"><span>Evolution</span><b>${line.map((x) => SPECIES[x].name).join(' › ')}</b></div>
    <div class="dd-row"><span>Status</span><b>${d === 'caught' ? '✓ Caught' : 'Seen'}</b></div>
    <div class="dd-row"><span>Base stats</span><b>HP ${s.base.hp} · ATK ${s.base.atk} · DEF ${s.base.def} · SPD ${s.base.spd}</b></div></div>`;
}

export function bagMenu(): Promise<void> {
  return modal('bag', (body) => {
    const render = () => {
      const inv = state.inv;
      const shards = Object.entries(inv.elementum).filter(([k]) => k !== 'void' || inv.elementum.void > 0);
      body.innerHTML = `<h2>Bag <small>◉ ${inv.gold} gold</small></h2>
        <div class="bag-grid">
          <div class="item"><span class="ic">◓</span><b>Crit Orb</b><em>×${inv.orbs}</em><small>Capture weakened wild creatures.</small></div>
          <div class="item"><span class="ic">◈</span><b>Great Orb</b><em>×${inv.greatOrbs}</em><small>×1.6 capture chance.</small></div>
          <div class="item"><span class="ic">🧪</span><b>Tonic</b><em>×${inv.potions}</em><small>Restore 50% HP.</small><button data-use="potion" ${inv.potions ? '' : 'disabled'}>Use</button></div>
          <div class="item"><span class="ic">✨</span><b>Elixir</b><em>×${inv.elixirs}</em><small>Revive or fully heal.</small><button data-use="elixir" ${inv.elixirs ? '' : 'disabled'}>Use</button></div>
        </div>
        <h3>Elementum Shards</h3><div class="shards">${shards.map(([k, v]) => `<div class="shard" style="--el:${ELEMENTS[k as keyof typeof ELEMENTS].color}"><span>${ELEMENTS[k as keyof typeof ELEMENTS].glyph}</span><b>${v}</b><small>${ELEMENTS[k as keyof typeof ELEMENTS].name}</small></div>`).join('')}</div>
        <div class="use-pick"></div>`;
      body.querySelectorAll<HTMLElement>('[data-use]').forEach((b) => b.addEventListener('click', () => {
        const item = b.dataset.use as 'potion' | 'elixir';
        const pick = body.querySelector('.use-pick') as HTMLElement;
        pick.innerHTML = `<h3>Use ${item === 'potion' ? 'Tonic' : 'Elixir'} on…</h3><div class="pick-row">${state.team.map((c, i) => `<button data-i="${i}"><img src="${portrait(c.species, c.shiny)}" alt="">${displayName(c)}<small>${c.hp}/${statsOf(c).maxHp}</small></button>`).join('')}</div>`;
        pick.querySelectorAll<HTMLElement>('button').forEach((pb) => pb.addEventListener('click', () => {
          const c = state.team[Number(pb.dataset.i)];
          const max = statsOf(c).maxHp;
          if (item === 'potion') { if (c.hp <= 0 || c.hp >= max) { sfx('error'); return; } c.hp = Math.min(max, c.hp + Math.round(max * 0.5)); state.inv.potions--; }
          else { if (c.hp >= max) { sfx('error'); return; } c.hp = max; state.inv.elixirs--; }
          sfx('heal');
          save();
          render();
        }));
      }));
    };
    render();
  });
}

export function mapMenu(minimap: Minimap): Promise<void> {
  return modal('map', (body) => {
    body.innerHTML = '<h2>World Map</h2><div class="map-host"></div><div class="map-legend"><span>⌂ Town</span><span>⚑ Expedition Flag</span><span>♛ Guardian</span><span>✓ Defeated</span></div>';
    minimap.fullMap(body.querySelector('.map-host')!);
  });
}

export function pauseMenu(openGuide: () => Promise<void>, reset: () => void): Promise<void> {
  return modal('pause', (body, close) => {
    body.innerHTML = `<h2>Expedition Log</h2>
      <div class="pause-stats"><div><b>${Object.values(state.dex).filter((d) => d === 'caught').length}</b><small>Caught</small></div><div><b>${state.bosses.length}/4</b><small>Guardians</small></div><div><b>${Math.round(state.steps / 1000 * 10) / 10} km</b><small>Travelled</small></div></div>
      <div class="pause-menu">
        <button class="primary" data-a="resume">Resume</button>
        <button data-a="guide">Field Guide</button>
        <button data-a="sound">${isMuted() ? 'Sound: Off' : 'Sound: On'}</button>
        <button data-a="save">Save now</button>
        <button class="danger" data-a="reset">Start a new expedition</button>
      </div>`;
    body.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => b.addEventListener('click', async () => {
      const a = b.dataset.a;
      if (a === 'resume') close();
      if (a === 'guide') { close(); await openGuide(); }
      if (a === 'sound') { setMuted(!isMuted()); b.textContent = isMuted() ? 'Sound: Off' : 'Sound: On'; }
      if (a === 'save') { save(); toast('Progress saved.'); sfx('select'); }
      if (a === 'reset') {
        if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'This erases your save — click again'; return; }
        reset();
      }
    }));
  });
}

export const menuEl = el;
