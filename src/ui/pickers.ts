// Small reusable pickers (creature, relic) shown as modals.
import { RELICS } from '../data/relics';
import { RARITY } from '../data/traits';
import { displayName, type Creature } from '../game/creature';
import { state } from '../game/state';
import { modal } from './dom';
import { creatureCard, esc } from './kit';
import { icon } from './icons';

export function pickCreature(title: string, filter: (c: Creature) => boolean = () => true, note?: (c: Creature) => string): Promise<Creature | null> {
  return new Promise((resolve) => {
    let picked: Creature | null = null;
    void modal('picker', (body, close) => {
      const list = [...state.team, ...state.box].filter(filter);
      body.innerHTML = `<h2>${title}</h2>${list.length ? `<div class="pick-grid">${list.map((c, i) => creatureCard(c, { key: String(i), small: true, note: note?.(c) })).join('')}</div>` : '<p class="muted">No eligible Mystics.</p>'}`;
      body.querySelectorAll<HTMLElement>('[data-k]').forEach((b) => b.addEventListener('click', () => { picked = list[Number(b.dataset.k)]; close(); }));
    }, () => resolve(picked));
  });
}

export function pickRelic(title: string, forCreature?: Creature): Promise<string | null> {
  return new Promise((resolve) => {
    let picked: string | null = null;
    void modal('picker', (body, close) => {
      const equippedBy = (uid: string) => [...state.team, ...state.box].find((c) => c.relics.includes(uid));
      const list = state.relics.filter((r) => !forCreature || !forCreature.relics.includes(r.uid));
      body.innerHTML = `<h2>${title}</h2>${list.length ? `<div class="relic-list">${list.map((r) => {
        const d = RELICS[r.id];
        const on = equippedBy(r.uid);
        return `<button class="relic-row" data-u="${r.uid}" style="--rar:${RARITY[d.rarity].color}"><span class="rl-ic">${icon(d.effect === 'element' ? d.element ?? 'gem' : 'crown')}</span><span class="rl-b"><b>${d.name} <i>Lv ${r.level}</i></b><small>${d.desc}</small></span>${on ? `<em>on ${esc(displayName(on))}</em>` : ''}</button>`;
      }).join('')}</div>` : '<p class="muted">You have no relics yet. Earn them from quests, Guardians, Tamers and the Relic Forge summon.</p>'}`;
      body.querySelectorAll<HTMLElement>('[data-u]').forEach((b) => b.addEventListener('click', () => { picked = b.dataset.u!; close(); }));
    }, () => resolve(picked));
  });
}
