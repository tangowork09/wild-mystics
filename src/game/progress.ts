// Achievements, rank, daily login and stat tracking — all driven by the event bus.
// Quests moved to the v3 engine (src/game/quests.ts); the v2 helpers below stay as thin wrappers
// so the existing HUD tracker, quest tab and quest board keep working until the UI adopts QuestApi.
import { ACHIEVEMENTS, LOGIN_REWARDS } from '../data/progression';
import { questDef } from '../data/quests';
import { state, save, bump, dexCount } from './state';
import { on } from './events';
import { applyReward, addRankXp, rewardText, setNotifier, notify } from './rewards';
import { accept, availableQuests, claim, initQuests, legacyQuest, syncQuests as syncV3, type LegacyQuest } from './quests';
import { chartedPercent } from './explore';

export { applyReward, addRankXp, rewardText, setNotifier, notify };
export type { LegacyQuest };

// ── legacy quest helpers (v2 UI) ──────────────────────────────────────────────
/** v2-shaped view of any quest: `objective.count` is the current step's count. */
export const questById = (id: string) => legacyQuest(id);
/** Side quests and bounties posted in a land (the town Quest Board). */
export function availableSide(zoneId: string): LegacyQuest[] {
  return availableQuests().filter((d) => d.region === zoneId).map((d) => legacyQuest(d.id)!).filter(Boolean);
}
export const acceptQuest = (id: string) => accept(id);
export const claimQuest = (id: string) => claim(id);
export const syncQuests = () => syncV3();

// ── achievements ──────────────────────────────────────────────────────────────
export function achievementTier(id: string) {
  const def = ACHIEVEMENTS.find((a) => a.id === id)!;
  const cur = achievementValue(def.stat);
  const claimed = state.achievements[id]?.progress ?? 0; // tiers claimed
  const reached = def.tiers.filter((t) => cur >= t).length;
  return { def, cur, claimed, reached, claimable: reached > claimed };
}
export function achievementValue(stat: string) {
  if (stat === 'dex') return dexCount();
  if (stat === 'km') return Math.floor(state.steps / 1000);
  if (stat === 'rank') return state.rank.level;
  if (stat === 'regions') return state.explore.visited.length;
  if (stat === 'charted') return state.stats.charted ?? chartedPercent();
  if (stat === 'dungeons') return Object.keys(state.flags).filter((k) => k.startsWith('dungeon_clear:') && state.flags[k]).length;
  if (stat === 'bosses') return state.bosses.length;
  return state.stats[stat] ?? 0;
}
export function claimAchievement(id: string) {
  const t = achievementTier(id);
  if (!t.claimable) return 0;
  const aether = t.def.reward[t.claimed] ?? 0;
  state.inv.aether += aether;
  state.achievements[id] = { progress: t.claimed + 1, claimed: true };
  save();
  return aether;
}

/** Badge count: finished quests waiting for a claim (in the log) + claimable achievements. */
export const claimableCount = () => ACHIEVEMENTS.filter((a) => achievementTier(a.id).claimable).length
  + state.quests.active.filter((a) => a.status === 'ready').length
  + state.quests.daily.list.filter((a) => { const d = questDef(a.id); return d && !a.claimed && a.progress >= Math.max(1, d.steps[0]?.count ?? 1); }).length;

// ── daily login ───────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().slice(0, 10);

/** Daily login calendar: returns today's reward index if unclaimed. */
export function pendingLogin(): number | null {
  const d = state.daily;
  const t = today();
  if (d.claimed === t) return null;
  if (d.lastLogin !== t) {
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    d.streak = d.lastLogin === y ? d.streak + 1 : 1;
    d.lastLogin = t;
  }
  return (d.streak - 1) % LOGIN_REWARDS.length;
}
export function claimLogin() {
  const idx = pendingLogin();
  if (idx === null) return null;
  applyReward(LOGIN_REWARDS[idx].reward);
  state.daily.claimed = today();
  save();
  return LOGIN_REWARDS[idx];
}

// ── wiring ────────────────────────────────────────────────────────────────────
let wired = false;
export function initProgress() {
  if (wired) return;
  wired = true;
  on('battle_win', (e) => { bump('wins'); addRankXp(e.kind === 'boss' ? 300 : e.kind === 'tamer' ? 80 : 18); });
  on('catch', (e) => { bump('catches'); if (e.shiny) bump('shinies'); addRankXp(30); });
  on('perfect', () => bump('perfects'));
  on('parry', () => bump('parries'));
  on('break', () => bump('breaks'));
  on('burst', () => bump('bursts'));
  on('jump_dodge', () => bump('jumps'));
  on('gather', (e) => bump('gathered', e.n));
  on('search', () => bump('searches'));
  on('hatch', () => { bump('hatches'); addRankXp(40); });
  on('evolve', () => { bump('evolves'); addRankXp(50); });
  on('discover', () => { bump('waystones'); addRankXp(25); });
  on('summon', (e) => { bump('pulls', e.count); });
  on('build', () => { bump('builds'); addRankXp(20); });
  on('boss_win', () => bump('bosses'));
  on('tamer_win', () => bump('tamers'));
  on('quest_done', (e) => { if (e.kind === 'side' || e.kind === 'bounty') addRankXp(20); });
  initQuests();
}
