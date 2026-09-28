// Quests, achievements, rank and daily login — all driven by the event bus.
import { ACHIEVEMENTS, DAILY_POOL, LOGIN_REWARDS, QUESTS, rankTitle, rankXpToNext, type QuestDef, type Reward } from '../data/progression';
import { RELICS } from '../data/relics';
import { ITEMS, MATERIALS, type ItemId, type MaterialId } from '../data/items';
import { newUid } from './creature';
import { emit, on, type GameEvents } from './events';
import { state, bump, addItem, save } from './state';

type Notify = (text: string, kind?: 'good' | 'info' | 'quest' | 'rank') => void;
let notify: Notify = () => {};
export function setNotifier(n: Notify) { notify = n; }

export const questById = (id: string) => QUESTS.find((q) => q.id === id) ?? DAILY_POOL.find((q) => q.id === id);
const today = () => new Date().toISOString().slice(0, 10);

function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
}

/** Ensure story quest chain + today's dailies are present. */
export function syncQuests() {
  const q = state.quests;
  const story = QUESTS.filter((x) => x.kind === 'story');
  for (const s of story) {
    if (q.done.includes(s.id) || q.active.some((a) => a.id === s.id)) continue;
    if (!s.requires || q.done.includes(s.requires)) { q.active.push({ id: s.id, progress: 0 }); break; }
  }
  if (q.daily.date !== today()) {
    const r = seeded(today());
    const pool = [...DAILY_POOL];
    const list = [];
    for (let i = 0; i < 3 && pool.length; i++) list.push({ id: pool.splice(Math.floor(r() * pool.length), 1)[0].id, progress: 0 });
    q.daily = { date: today(), list };
  }
}

export function availableSide(zoneId: string): QuestDef[] {
  const q = state.quests;
  return QUESTS.filter((x) => x.kind === 'side' && x.giver === zoneId && !q.done.includes(x.id) && !q.active.some((a) => a.id === x.id));
}

export function acceptQuest(id: string) {
  if (state.quests.active.filter((a) => questById(a.id)?.kind === 'side').length >= 6) return false;
  state.quests.active.push({ id, progress: 0 });
  save();
  return true;
}

export function applyReward(r: Reward) {
  const inv = state.inv;
  if (r.gold) inv.gold += r.gold;
  if (r.aether) inv.aether += r.aether;
  if (r.tickets) inv.tickets += r.tickets;
  if (r.essence) inv.essence += r.essence;
  if (r.items) for (const [k, v] of Object.entries(r.items)) addItem(k as never, v ?? 0);
  if (r.orbs) for (const [k, v] of Object.entries(r.orbs)) inv.orbs[k as keyof typeof inv.orbs] += v ?? 0;
  if (r.materials) for (const [k, v] of Object.entries(r.materials)) inv.materials[k as keyof typeof inv.materials] += v ?? 0;
  if (r.relic && RELICS[r.relic]) state.relics.push({ uid: newUid(), id: r.relic, level: 1 });
  if (r.rankXp) addRankXp(r.rankXp);
}

export function rewardText(r: Reward) {
  const parts: string[] = [];
  if (r.aether) parts.push(`${r.aether} Aether`);
  if (r.gold) parts.push(`${r.gold} Gold`);
  if (r.tickets) parts.push(`${r.tickets} Summon Ticket${r.tickets > 1 ? 's' : ''}`);
  if (r.orbs) for (const [k, v] of Object.entries(r.orbs)) parts.push(`${v} ${k[0].toUpperCase()}${k.slice(1)} Orb${v! > 1 ? 's' : ''}`);
  if (r.items) for (const [k, v] of Object.entries(r.items)) parts.push(`${v}× ${ITEMS[k as ItemId]?.name ?? k.replace(/_/g, ' ')}`);
  if (r.materials) for (const [k, v] of Object.entries(r.materials)) parts.push(`${v} ${MATERIALS[k as MaterialId]?.name ?? k}`);
  if (r.relic) parts.push(`Relic: ${RELICS[r.relic]?.name}`);
  return parts.join(' · ');
}

export function claimQuest(id: string) {
  const qs = state.quests;
  const a = qs.active.find((x) => x.id === id) ?? qs.daily.list.find((x) => x.id === id);
  const def = questById(id);
  if (!a || !def || a.progress < def.objective.count || a.claimed) return false;
  a.claimed = true;
  applyReward(def.reward);
  if (def.kind !== 'daily') { qs.active = qs.active.filter((x) => x.id !== id); qs.done.push(id); }
  syncQuests();
  save();
  return true;
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

export function achievementTier(id: string) {
  const def = ACHIEVEMENTS.find((a) => a.id === id)!;
  const cur = achievementValue(def.stat);
  const claimed = state.achievements[id]?.progress ?? 0; // tiers claimed
  const reached = def.tiers.filter((t) => cur >= t).length;
  return { def, cur, claimed, reached, claimable: reached > claimed };
}
export function achievementValue(stat: string) {
  if (stat === 'dex') return Object.values(state.dex).filter((d) => d.caught > 0).length;
  if (stat === 'km') return Math.floor(state.steps / 1000);
  if (stat === 'rank') return state.rank.level;
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
export const claimableCount = () => ACHIEVEMENTS.filter((a) => achievementTier(a.id).claimable).length
  + [...state.quests.active, ...state.quests.daily.list].filter((a) => { const d = questById(a.id); return d && !a.claimed && a.progress >= d.objective.count; }).length;

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

// ── wiring ─────────────────────────────────────────────────────────────────
function advance<K extends keyof GameEvents>(k: K, e: GameEvents[K], amount = 1) {
  const lists = [state.quests.active, state.quests.daily.list];
  for (const list of lists) {
    for (const a of list) {
      const def = questById(a.id);
      if (!def || a.claimed || def.objective.event !== k) continue;
      const m = def.objective.match as ((x: GameEvents[K]) => boolean) | undefined;
      if (m && !m(e)) continue;
      const before = a.progress;
      a.progress = Math.min(def.objective.count, a.progress + amount);
      if (before < def.objective.count && a.progress >= def.objective.count) notify(`Quest complete: <b>${def.title}</b> — claim your reward`, 'quest');
    }
  }
}

let wired = false;
export function initProgress() {
  if (wired) return;
  wired = true;
  on('battle_win', (e) => { bump('wins'); advance('battle_win', e); addRankXp(e.kind === 'boss' ? 300 : e.kind === 'tamer' ? 80 : 18); });
  on('catch', (e) => { bump('catches'); if (e.shiny) bump('shinies'); advance('catch', e); addRankXp(30); });
  on('defeat', (e) => advance('defeat', e));
  on('perfect', (e) => { bump('perfects'); advance('perfect', e); });
  on('parry', (e) => { bump('parries'); advance('parry', e); });
  on('break', (e) => { bump('breaks'); advance('break', e); });
  on('burst', (e) => { bump('bursts'); advance('burst', e); });
  on('jump_dodge', (e) => { bump('jumps'); advance('jump_dodge', e); });
  on('gather', (e) => { bump('gathered', e.n); advance('gather', e, e.n); });
  on('search', (e) => { bump('searches'); advance('search', e); });
  on('grass', (e) => advance('grass', e));
  on('hatch', (e) => { bump('hatches'); advance('hatch', e); addRankXp(40); });
  on('evolve', (e) => { bump('evolves'); advance('evolve', e); addRankXp(50); });
  on('discover', (e) => { bump('waystones'); advance('discover', e); addRankXp(25); });
  on('summon', (e) => { bump('pulls', e.count); });
  on('build', (e) => { bump('builds'); advance('build', e); addRankXp(20); });
  on('boss_win', (e) => { bump('bosses'); advance('boss_win', e); });
  on('tamer_win', (e) => { bump('tamers'); advance('tamer_win', e); });
  on('step', (e) => advance('step', e, e.meters));
  syncQuests();
}
