// Rewards, rank XP and player-facing notifications. Shared by the quest engine, shops and the
// legacy progress module (which re-exports these so existing imports keep working).
import { rankTitle, rankXpToNext, type Reward } from '../data/progression';
import { RELICS } from '../data/relics';
import { ITEMS, MATERIALS, ORBS, type ItemId, type MaterialId, type OrbId } from '../data/items';
import { newUid } from './creature';
import { emit } from './events';
import { state, addItem } from './state';

export type NotifyKind = 'good' | 'info' | 'quest' | 'rank' | 'loot' | 'bad';
type Notify = (text: string, kind?: NotifyKind) => void;
let notifier: Notify = () => {};
export function setNotifier(n: Notify) { notifier = n; }
export function notify(text: string, kind: NotifyKind = 'quest') { notifier(text, kind); }

export function applyReward(r: Reward) {
  const inv = state.inv;
  if (r.gold) inv.gold += r.gold;
  if (r.aether) inv.aether += r.aether;
  if (r.tickets) inv.tickets += r.tickets;
  if (r.essence) inv.essence += r.essence;
  if (r.items) for (const [k, v] of Object.entries(r.items)) addItem(k as ItemId, v ?? 0);
  if (r.orbs) for (const [k, v] of Object.entries(r.orbs)) inv.orbs[k as OrbId] = (inv.orbs[k as OrbId] ?? 0) + (v ?? 0);
  if (r.materials) for (const [k, v] of Object.entries(r.materials)) inv.materials[k as MaterialId] += v ?? 0;
  if (r.relic && RELICS[r.relic]) state.relics.push({ uid: newUid(), id: r.relic, level: 1 });
  if (r.rankXp) addRankXp(r.rankXp);
}

export function rewardText(r: Reward) {
  const parts: string[] = [];
  if (r.aether) parts.push(`${r.aether} Aether`);
  if (r.gold) parts.push(`${r.gold} Gold`);
  if (r.tickets) parts.push(`${r.tickets} Summon Ticket${r.tickets > 1 ? 's' : ''}`);
  if (r.orbs) for (const [k, v] of Object.entries(r.orbs)) parts.push(`${v} ${ORBS[k as OrbId]?.name ?? k}${v! > 1 ? 's' : ''}`);
  if (r.items) for (const [k, v] of Object.entries(r.items)) parts.push(`${v}× ${ITEMS[k as ItemId]?.name ?? k.replace(/_/g, ' ')}`);
  if (r.materials) for (const [k, v] of Object.entries(r.materials)) parts.push(`${v} ${MATERIALS[k as MaterialId]?.name ?? k}`);
  if (r.relic) parts.push(`Relic: ${RELICS[r.relic]?.name ?? r.relic}`);
  return parts.join(' · ');
}

export function addRankXp(n: number) {
  const r = state.rank;
  r.xp += n;
  while (r.xp >= rankXpToNext(r.level)) {
    r.xp -= rankXpToNext(r.level);
    r.level++;
    state.inv.aether += 100;
    if (r.level % 5 === 0) state.inv.tickets += 1;
    state.profile.title = rankTitle(r.level);
    state.stats.rank = r.level;
    notify(`Wayfarer Rank ${r.level}! <b>+100 Aether</b>${r.level % 5 === 0 ? ' · <b>+1 Summon Ticket</b>' : ''}`, 'rank');
    emit('rank_up', { level: r.level });
  }
}
