// Small reusable pickers (creature, relic) shown as modals. Paged, never scrolled.
import { RELICS } from '../data/relics';
import { RARITY } from '../data/traits';
import { displayName, type Creature } from '../game/creature';
import { state } from '../game/state';
import { modal } from './dom';
import { creatureCard, esc, emptyState } from './kit';
import { icon } from './icons';
import { Pager } from './pager';

export function pickCreature(title: string, filter: (c: Creature) => boolean = () => true, note?: (c: Creature) => string): Promise<Creature | null> {
  return new Promise((resolve) => {
    let picked: Creature | null = null;
    let pager: Pager<Creature> | null = null;
    void modal('picker', (body, close) => {
      const list = [...state.team, ...state.box].filter(filter);
      body.innerHTML = `<h2>${title}</h2><div class="pick-host"></div>`;
      pager = new Pager<Creature>(body.querySelector('.pick-host') as HTMLElement, {
        items: list, cell: { w: 210, h: 64 }, gap: 8, primary: true, label: title,
        render: (c) => creatureCard(c, { small: true, note: note?.(c) }).replace(/^<button/, '<span').replace(/<\/button>$/, '</span>'),
        onPick: (c) => { picked = c; close(); },
        empty: emptyState('No eligible Mystics', 'None of your Mystics can do this right now.', 'paw'),
      });
    }, () => { pager?.destroy(); resolve(picked); });
  });
}

export function pickRelic(title: string, forCreature?: Creature): Promise<string | null> {
  return new Promise((resolve) => {
    let picked: string | null = null;
    let pager: Pager<(typeof state.relics)[number]> | null = null;
    void modal('picker', (body, close) => {
      const equippedBy = (uid: string) => [...state.team, ...state.box].find((c) => c.relics.includes(uid));
      const list = state.relics.filter((r) => !forCreature || !forCreature.relics.includes(r.uid));
      body.innerHTML = `<h2>${title}</h2><div class="pick-host"></div>`;
      pager = new Pager(body.querySelector('.pick-host') as HTMLElement, {
        items: list, cell: { w: 250, h: 66 }, gap: 8, primary: true, label: title,
        render: (r) => {
          const d = RELICS[r.id];
          const on = equippedBy(r.uid);
          return `<span class="tile relic" style="--rar:${RARITY[d.rarity].color}"><span class="item-art rl">${icon(d.effect === 'element' ? d.element ?? 'gem' : 'crown')}</span><span class="tl-b"><b class="ell">${d.name} <i class="tnum">Lv ${r.level}</i></b><span class="tl-n ell">${on ? `On ${esc(displayName(on))} · ` : ''}${d.desc}</span></span></span>`;
        },
        onPick: (r) => { picked = r.uid; close(); },
        empty: emptyState('No relics yet', 'Earn them from quests, Guardians and Tamers, or wish at the Relic Forge.', 'crown'),
      });
    }, () => { pager?.destroy(); resolve(picked); });
  });
}
