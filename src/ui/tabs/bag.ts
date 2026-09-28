import { ITEMS, ORBS, MATERIALS, type ItemId, type OrbId, type MaterialId } from '../../data/items';
import { ELEMENTS, type Element } from '../../data/elements';
import { RELICS, RELIC_MAX_LEVEL } from '../../data/relics';
import { RARITY } from '../../data/traits';
import { displayName, statsOf, grantXp, stoneEvolution, xpToNext, type Creature } from '../../game/creature';
import { state, save, addItem } from '../../game/state';
import { relicUpgradeCost, upgradeRelic, canPay } from '../../game/base';
import { sfx } from '../../core/audio';
import { toast } from '../dom';
import { costList, currency, esc } from '../kit';
import { icon } from '../icons';
import { pickCreature } from '../pickers';
import type { JournalHooks } from '../journal';

export function renderBag(root: HTMLElement, hooks: JournalHooks) {
  const draw = () => {
    const inv = state.inv;
    const orbs = (Object.keys(ORBS) as OrbId[]).filter((o) => inv.orbs[o] > 0);
    const items = (Object.keys(ITEMS) as ItemId[]).filter((i) => (inv.items[i] ?? 0) > 0);
    root.innerHTML = `
      <div class="cur-row">${currency('gold')}${currency('aether')}${currency('tickets')}${currency('essence')}</div>
      <div class="sec-h">${icon('orb')}<span>Binding Orbs</span></div>
      <div class="bag-grid">${orbs.map((o) => `<div class="item"><span class="orbdot big" style="background:radial-gradient(circle at 35% 30%, #fff, ${ORBS[o].color} 45%, #1a1020)"></span><b>${ORBS[o].name}</b><em>×${inv.orbs[o]}</em><small>${ORBS[o].desc}</small></div>`).join('') || '<p class="muted">No orbs — visit an Outfitter.</p>'}</div>
      <div class="sec-h">${icon('potion')}<span>Items</span></div>
      <div class="bag-grid">${items.map((i) => {
        const d = ITEMS[i];
        const usable = d.use === 'field' || d.use === 'both' || d.use === 'evolve';
        return `<div class="item"><span class="ic">${icon(d.icon)}</span><b>${d.name}</b><em>×${inv.items[i]}</em><small>${d.desc}</small>${usable ? `<button class="btn tiny" data-use="${i}">Use</button>` : ''}</div>`;
      }).join('') || '<p class="muted">Your pack is light.</p>'}</div>
      <div class="sec-h">${icon('log_wood')}<span>Materials</span></div>
      <div class="mat-row">${(Object.keys(MATERIALS) as MaterialId[]).map((m) => `<div class="mat" style="--c:${MATERIALS[m].color}">${icon(MATERIALS[m].icon)}<b>${inv.materials[m]}</b><small>${MATERIALS[m].name}</small></div>`).join('')}</div>
      <div class="sec-h">${icon('crystal_cluster')}<span>Elementum Shards</span></div>
      <div class="mat-row">${(Object.keys(ELEMENTS) as Element[]).map((e) => `<div class="mat" style="--c:${ELEMENTS[e].color}">${icon(e)}<b>${inv.elementum[e]}</b><small>${ELEMENTS[e].name}</small></div>`).join('')}</div>`;
    root.querySelectorAll<HTMLElement>('[data-use]').forEach((b) => b.addEventListener('click', () => void use(b.dataset.use as ItemId)));
  };
  const use = async (id: ItemId) => {
    const d = ITEMS[id];
    if (id === 'lure_incense') { state.buffs.lure = Date.now() + 180000; addItem(id, -1); toast('Lure Incense lit — encounters doubled for 3 minutes.', 'good'); save(); draw(); return; }
    if (id === 'shimmer_incense') { state.buffs.shimmer = Date.now() + 300000; addItem(id, -1); toast('Shimmer Incense lit — shiny odds tripled for 5 minutes!', 'good'); save(); draw(); return; }
    if (d.use === 'evolve') {
      const c = await pickCreature(`Use ${d.name} on…`, (x) => !!stoneEvolution(x, id, hooks.isNight()), () => 'Can evolve');
      if (!c) return;
      const evo = stoneEvolution(c, id, hooks.isNight());
      if (!evo) return;
      addItem(id, -1);
      await hooks.evolve(c, evo.id, true);
      draw();
      return;
    }
    const filter = (c: Creature) => {
      const max = statsOf(c).maxHp;
      if (id === 'tonic' || id === 'mega_tonic') return c.hp > 0 && c.hp < max;
      if (id === 'elixir') return c.hp < max;
      if (id === 'wisdom_scroll') return c.level < 60;
      return true;
    };
    const c = await pickCreature(`Use ${d.name} on…`, filter, (x) => `${x.hp}/${statsOf(x).maxHp} HP`);
    if (!c) return;
    const max = statsOf(c).maxHp;
    if (id === 'tonic') c.hp = Math.min(max, c.hp + Math.round(max * 0.5));
    else if (id === 'mega_tonic') c.hp = max;
    else if (id === 'elixir') c.hp = c.hp <= 0 ? Math.round(max * 0.5) : max;
    else if (id === 'wisdom_scroll') { const r = grantXp(c, xpToNext(c.level) - c.xp); toast(`${esc(displayName(c))} reached level ${c.level}!${r.newSkills.length ? ' New move learned!' : ''}`, 'good'); }
    else if (id === 'cleanse') toast('Status effects only linger in battle — nothing to cure.', '');
    addItem(id, -1);
    sfx('heal');
    save();
    draw();
  };
  draw();
}

export function renderRelics(root: HTMLElement, hooks: JournalHooks) {
  const draw = () => {
    const forge = state.base.structures.some((s) => s.type === 'forge');
    const owner = (uid: string) => [...state.team, ...state.box].find((c) => c.relics.includes(uid));
    const sorted = [...state.relics].sort((a, b) => RARITY[RELICS[b.id].rarity].order - RARITY[RELICS[a.id].rarity].order || b.level - a.level);
    root.innerHTML = `<p class="lead-p">Relics are charms your Mystics wear into battle — two slots each, a third at 3★. ${forge ? 'Your Relic Forge can upgrade them.' : 'Build a <b>Relic Forge</b> at your Homestead to upgrade them.'}</p>
      <div class="relic-grid">${sorted.map((r) => {
        const d = RELICS[r.id];
        const o = owner(r.uid);
        const cost = relicUpgradeCost(r.level);
        return `<div class="relic-card" style="--rar:${RARITY[d.rarity].color}"><div class="rc-top"><span class="rc-ic">${icon(d.effect === 'element' ? d.element ?? 'gem' : 'crown')}</span><div><b>${d.name}</b><small>${RARITY[d.rarity].name} · Lv ${r.level}/${RELIC_MAX_LEVEL}</small></div></div>
          <p>${d.desc}</p><div class="rc-stats">${Object.entries(d.stats).map(([k, v]) => `<span>${k.toUpperCase()} +${Math.round((v ?? 0) * (1 + (r.level - 1) * 0.25) * 100)}%</span>`).join('')}</div>
          <div class="rc-foot">${o ? `<em>${icon('paw')} ${esc(displayName(o))}</em>` : '<em class="muted">Unequipped</em>'}
          ${forge && r.level < RELIC_MAX_LEVEL ? `<button class="btn tiny ${canPay(cost) ? 'gold' : ''}" data-up="${r.uid}">Upgrade ${costList(cost)}</button>` : ''}</div></div>`;
      }).join('') || '<p class="muted">No relics yet. Complete quests, defeat Guardians and Tamers, or try the Relic Forge summon.</p>'}</div>`;
    root.querySelectorAll<HTMLElement>('[data-up]').forEach((b) => b.addEventListener('click', () => {
      if (upgradeRelic(b.dataset.up!)) { sfx('levelup'); toast('Relic upgraded!', 'good'); } else { sfx('error'); toast('Not enough materials.', 'bad'); }
      draw();
    }));
    void hooks;
  };
  draw();
}
