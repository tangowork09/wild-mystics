// Quest engine (v3): multi-step main/side/bounty/daily quests driven by the event bus.
//
//  • Each active quest sits on one step. Steps advance on matching events (catch, talk, reach…),
//    on state checks (items held, Guardians answered, gates open) and on position (reach).
//  • Steps carry dialog for their start, progress and completion. Beats raised while talking go to
//    the open conversation; beats raised by gameplay queue up and play at the next quiet moment.
//  • Every active quest has a target Marker for its current step, so the tracker, compass,
//    minimap and beacon always point somewhere.
//  • The main quest is tracked by default. Registers QuestApi (src/game/contracts.ts).
import {
  ALL_QUESTS, DAILY_POOL, MAIN_QUESTS, questDef,
  type Beat, type Effect, type LocRef, type Match, type QuestDef, type StepDef,
} from '../data/quests';
import { npcById, anchorFallback, bearingOffset, type Anchor } from '../data/npcs';
import { ZONES, HOMESTEAD } from '../data/zones';
import { DUNGEONS, GATES, POIS } from '../data/layout';
import { SPECIES } from '../data/species';
import { ITEMS } from '../data/items';
import { TAMERS } from '../data/tamers';
import { SHOPS } from '../data/shops';
import { state, save, addItem, itemCount, dexCount, bump, type QuestState } from './state';
import { emit, on, onAny } from './events';
import { applyReward, notify, rewardText } from './rewards';
import { forceGate, gateInto, gateOpen, regionUnlocked } from './gates';
import { currentRegion, discoverDungeon, dungeonCleared, dungeonEntered, isNight, playerPos } from './explore';
import { registerQuestApi, type Marker, type QuestApi, type QuestStepView, type QuestView } from './contracts';

// ── runtime (not saved) ───────────────────────────────────────────────────────
let ver = 1;
const touch = () => { ver++; };
export const questVersion = () => ver;

type Locator = (ref: string) => [number, number] | null;
const locators: Locator[] = [];
/** The world layer registers live positions (NPC actors, service doors, waystones, tamers, alphas). */
export function registerLocator(l: Locator) { locators.unshift(l); }

/** Beats raised outside a conversation wait here until the story layer finds a quiet moment. */
const pending: Beat[][] = [];
let convo: Beat[][] | null = null;
function say(beats?: Beat[]) {
  if (!beats?.length) return;
  (convo ?? pending).push(beats);
}
export function beginConversation() { convo = []; }
export function endConversation(): Beat[] { const out = (convo ?? []).flat(); convo = null; return out; }
export const hasPendingBeats = () => pending.length > 0;
export function takePendingBeats(): Beat[] { const out = pending.flat(); pending.length = 0; return out; }

// ── tokens ──────────────────────────────────────────────────────────────────
const landName = (id: string) => ZONES.find((z) => z.id === id)?.name ?? id;
const townName = (id: string) => ZONES.find((z) => z.id === id)?.town.name ?? id;
export const guardianName = (id: string) => SPECIES[ZONES.find((z) => z.id === id)?.boss.species ?? '']?.name ?? 'the Guardian';
export const npcName = (id?: string) => (id ? npcById(id)?.name ?? id : '');
function starterName() {
  const c = [...state.team, ...state.box].find((x) => x.caught?.how === 'starter') ?? state.team[0];
  return c ? c.nickname || SPECIES[c.species]?.name || 'your Mystic' : 'your Mystic';
}
export function fill(text: string): string {
  return text.replace(/\{(\w+)(?::(\w+))?\}/g, (m, k: string, a?: string) => {
    if (k === 'player') return state.profile.name || 'Wayfarer';
    if (k === 'starter') return starterName();
    if (k === 'rival') return SPECIES[state.story.rival]?.name ?? 'a Mystic';
    if (k === 'guardian' && a) return guardianName(a);
    if (k === 'land' && a) return landName(a);
    if (k === 'town' && a) return townName(a);
    return m;
  });
}
export const fillBeats = (beats: Beat[]): Beat[] => beats.map(([who, ...lines]) => [who, ...lines.map(fill)] as Beat);

// ── lookups ─────────────────────────────────────────────────────────────────
export const activeState = (id: string) => state.quests.active.find((a) => a.id === id) ?? state.quests.daily.list.find((a) => a.id === id);
export const isDone = (id: string) => state.quests.done.includes(id);
export const isActive = (id: string) => state.quests.active.some((a) => a.id === id);
const stepOf = (q: QuestState, d: QuestDef): StepDef | undefined => d.steps[q.step ?? 0];
const countOf = (s: StepDef) => Math.max(1, s.count ?? 1);
export const turnInOf = (d: QuestDef): string | null => (d.turnIn !== undefined ? d.turnIn : d.kind === 'side' || d.kind === 'bounty' ? d.giver ?? null : null);
const isDaily = (d: QuestDef) => d.kind === 'daily';
const sideLike = (d: QuestDef) => d.kind === 'side' || d.kind === 'bounty';
export const SIDE_LIMIT = 8;

export function requirementsMet(d: QuestDef): boolean {
  if (state.story.prologue !== 'done' && d.id !== 'pro_empty_handed') return false;
  const r = d.requires ?? {};
  if (r.quests && !r.quests.every(isDone)) return false;
  if (r.bosses && !r.bosses.every((b) => state.bosses.includes(b))) return false;
  if (r.region && !regionUnlocked(r.region)) return false;
  if (r.flags && !r.flags.every((f) => state.flags[`story:${f}`])) return false;
  if (r.features && !r.features.every((f) => state.story.features.includes(f))) return false;
  if (sideLike(d)) {
    if (!regionUnlocked(d.region)) return false;
    const g = d.giver ? npcById(d.giver) : undefined;
    if (g?.goneAfter && isDone(g.goneAfter) && g.goneAfter !== d.id) return false;
  }
  return true;
}

/** Side quests and bounties you could pick up right now (not started, not done). */
export function availableQuests(): QuestDef[] {
  return ALL_QUESTS.filter((d) => sideLike(d) && !isActive(d.id) && !isDone(d.id) && requirementsMet(d));
}
export const offersFrom = (npc: string) => availableQuests().filter((d) => d.giver === npc);

// ── locations ───────────────────────────────────────────────────────────────
const zoneOf = (id: string) => ZONES.find((z) => z.id === id);
function dataLocate(ref: string): [number, number] | null {
  const [kind, a] = ref.split(':');
  switch (kind) {
    case 'npc': {
      const st = npcStation(a);
      if (st === null) return null;
      return typeof st === 'string' ? locate(st) : anchorFallback(st);
    }
    case 'poi': { const p = POIS.find((x) => x.id === a); return p ? [...p.pos] : null; }
    case 'gate': { const g = GATES.find((x) => x.id === a); return g ? [...g.pos] : null; }
    case 'dungeon': { const d = DUNGEONS.find((x) => x.id === a); return d ? [...d.entrance] : null; }
    case 'town': case 'service': case 'waystone': { const z = zoneOf(a); return z ? [...z.town.pos] : null; }
    case 'boss': { const z = zoneOf(a); return z ? [...z.boss.pos] : null; }
    case 'camp': { const z = zoneOf(a); return z ? [...z.camp] : null; }
    case 'region': case 'alpha': { const z = zoneOf(a); return z ? [...z.center] : null; }
    case 'tamer': { const t = TAMERS.find((x) => x.id === a); const z = t && zoneOf(t.zone); return z ? [...z.center] : null; }
    case 'homestead': return [...HOMESTEAD.center];
    case 'pos': { const [x, z] = (a ?? '').split(',').map(Number); return Number.isFinite(x) && Number.isFinite(z) ? [x, z] : null; }
  }
  return null;
}
/** Resolve a LocRef (with optional `@bearing:dist`) to world XZ. */
export function locate(ref: LocRef): [number, number] | null {
  let off: [number, number] = [0, 0];
  const at = ref.indexOf('@');
  if (at >= 0) {
    const [bearing, dist] = ref.slice(at + 1).split(':').map(Number);
    off = bearingOffset(bearing || 0, dist || 0);
    ref = ref.slice(0, at);
  }
  for (const l of locators) {
    const p = l(ref);
    if (p) return [p[0] + off[0], p[1] + off[1]];
  }
  const p = dataLocate(ref);
  return p ? [p[0] + off[0], p[1] + off[1]] : null;
}

/** Where an NPC should stand right now: a stage LocRef, its home anchor, or null (not in the world). */
export function npcStation(id: string): LocRef | Anchor | null {
  const n = npcById(id);
  if (!n) return null;
  for (const q of orderedActive()) {
    const d = questDef(q.id);
    if (!d || q.status === 'ready') continue;
    const s = stepOf(q, d);
    const st = s?.stage?.[id];
    if (st) return st;
  }
  if (n.staged) return null;
  if (n.goneAfter && isDone(n.goneAfter)) return null;
  if (id === 'rival_kai' && state.story.prologue !== 'done') return null;
  if (n.role === 'merchant') {
    if (!state.story.features.includes('merchant')) return null;
    return { ...n.anchor, town: merchantTown() };
  }
  return n.anchor;
}

/** Pell sets up in a different reachable town every day. */
export function merchantTown(): string {
  const today = new Date().toISOString().slice(0, 10);
  const towns = ZONES.filter((z) => z.id !== 'summit' && regionUnlocked(z.id)).map((z) => z.id);
  let h = 7;
  for (const ch of today) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return towns.length ? towns[h % towns.length] : 'vale';
}

function stepTarget(q: QuestState, d: QuestDef): LocRef | null {
  if (q.status === 'ready') { const t = turnInOf(d); return t ? `npc:${t}` : d.giver ? `npc:${d.giver}` : null; }
  const s = stepOf(q, d);
  if (!s) return null;
  if (s.at) return s.at;
  switch (s.type) {
    case 'talk': case 'deliver': case 'battle': return s.npc ? `npc:${s.npc}` : null;
    case 'reach': return s.id ? `poi:${s.id}` : null;
    case 'service': return `service:${s.zone ?? d.region}:${s.service ?? 'healer'}`;
    case 'buy': return `service:${s.zone ?? d.region}:shop`;
    case 'attune': return `waystone:${s.zone ?? d.region}`;
    case 'region': { const r = s.zone ?? s.id ?? d.region; const g = regionUnlocked(r) ? null : gateInto(r); return g ? `gate:${g.id}` : `town:${r}`; }
    case 'dungeon': case 'clear': return s.id ? `dungeon:${s.id}` : null;
    case 'guardian': return `boss:${s.zone ?? d.region}`;
    case 'gate': return s.id ? `gate:${s.id}` : null;
    case 'hatch': return `service:${d.region}:hatchery`;
    case 'tamer': return s.tamer ? `tamer:${s.tamer}` : `region:${s.zone ?? d.region}`;
    case 'alpha': return `alpha:${s.zone ?? d.region}`;
    case 'catch': case 'defeat': case 'win': case 'count': case 'collect': return `region:${s.zone ?? d.region}`;
  }
  return d.giver ? `npc:${d.giver}` : `town:${d.region}`;
}

// ── step matching ─────────────────────────────────────────────────────────────
type Ev = Record<string, unknown>;
const tamerZone = (id: string) => TAMERS.find((t) => t.id === id)?.zone;
const shopRegion = (id: string) => SHOPS.find((s) => s.id === id)?.region;

function matches(m: Match, name: string, e: Ev): boolean {
  const zoneOk = (z?: unknown) => !m.zone || z === m.zone;
  switch (m.type) {
    case 'talk': return name === 'talk' && e.npc === m.npc;
    case 'reach': return name === 'reach' && !!m.id && e.id === m.id;
    case 'catch': return name === 'catch' && (!m.species || e.species === m.species) && (!m.element || e.element === m.element) && zoneOk(e.zone)
      && (m.night === undefined || !!e.night === m.night) && (!m.shiny || !!e.shiny) && (!m.how || e.how === m.how);
    case 'defeat': return name === 'defeat' && (!m.species || e.species === m.species) && (!m.element || e.element === m.element) && zoneOk(e.zone);
    case 'win': return name === 'battle_win' && (!m.kind || e.kind === m.kind) && zoneOk(e.zone);
    case 'service': return name === 'use_service' && e.service === m.service && zoneOk(e.zone);
    case 'buy': return name === 'buy' && (!m.item || e.item === m.item) && (!m.zone || shopRegion(String(e.shop)) === m.zone);
    case 'attune': return name === 'discover' && (!m.zone || String(e.id ?? '').startsWith(`${m.zone}-`));
    case 'region': return name === 'enter_region' && e.region === (m.zone ?? m.id);
    case 'dungeon': return name === 'enter_dungeon' && e.id === m.id;
    case 'clear': return name === 'dungeon_clear' && e.id === m.id;
    case 'guardian': return name === 'boss_win' && e.zone === m.zone;
    case 'gate': return name === 'gate_open' && e.id === m.id;
    case 'hatch': return name === 'hatch' && (!m.species || e.species === m.species);
    case 'evolve': return name === 'evolve' && (!m.species || e.to === m.species);
    case 'tamer': return name === 'tamer_win' && (!m.tamer || e.id === m.tamer) && (!m.zone || tamerZone(String(e.id)) === m.zone);
    case 'alpha': {
      const mode = m.mode ?? 'either';
      const ok = (name === 'alpha_defeat' && mode !== 'catch') || (name === 'alpha_catch' && mode !== 'defeat');
      return ok && zoneOk(e.zone) && (!m.species || e.species === m.species);
    }
    case 'open': return name === 'ui_open' && e.tab === m.id;
    case 'battle': return name === 'story_battle' && e.id === m.tamer && (m.result === 'any' ? e.result !== 'fled' : e.result === 'win');
    case 'count': return name === m.event && zoneOk(e.zone) && (!m.material || e.material === m.material) && (!m.element || e.element === m.element) && (!m.species || e.species === m.species);
    default: return false;
  }
}

/** State-based completion (already true when the step starts, or after a reload). */
function satisfied(m: Match & { count?: number; at?: string; radius?: number; night?: boolean }): boolean {
  switch (m.type) {
    case 'guardian': return !!m.zone && state.bosses.includes(m.zone);
    case 'gate': return !!m.id && gateOpen(m.id);
    case 'clear': return !!m.id && dungeonCleared(m.id);
    case 'dungeon': return !!m.id && dungeonEntered(m.id);
    case 'collect': return !!m.item && itemCount(m.item) >= (m.count ?? 1);
    case 'dex': return dexCount() >= (m.count ?? 1);
    case 'region': return currentRegion() === (m.zone ?? m.id);
    case 'reach': {
      const ref = m.at ?? (m.id ? `poi:${m.id}` : null);
      if (!ref) return false;
      const p = locate(ref);
      if (!p) return false;
      const [x, z] = playerPos();
      return Math.hypot(p[0] - x, p[1] - z) < (m.radius ?? 30) && (!m.night || isNight());
    }
    default: return false;
  }
}

const stepDone = (s: StepDef) => satisfied(s) || (s.alt ?? []).some((a) => satisfied(a));

function amountFor(name: string, e: Ev) {
  if (name === 'step') return Number(e.meters) || 0;
  if (name === 'gather') return Number(e.n) || 1;
  return 1;
}

// ── effects ─────────────────────────────────────────────────────────────────
function runEffects(list?: Effect[]) {
  for (const fx of list ?? []) {
    if ('give' in fx) { applyReward(fx.give); notify(`Received ${rewardText(fx.give)}`, 'loot'); }
    else if ('take' in fx) addItem(fx.take.item, -Math.min(fx.take.n, itemCount(fx.take.item)));
    else if ('flag' in fx) state.flags[`story:${fx.flag}`] = true;
    else if ('feature' in fx) { if (!state.story.features.includes(fx.feature)) state.story.features.push(fx.feature); }
    else if ('shopTier' in fx) state.story.shopTier = Math.max(state.story.shopTier, fx.shopTier);
    else if ('openGate' in fx) forceGate(fx.openGate);
    else if ('reveal' in fx) discoverDungeon(fx.reveal, 'quest');
    else if ('start' in fx) startQuest(fx.start);
  }
}

// ── lifecycle ─────────────────────────────────────────────────────────────────
function initialProgress(s: StepDef) {
  if (s.type === 'collect' && s.item) return Math.min(countOf(s), itemCount(s.item));
  if (s.type === 'dex') return Math.min(countOf(s), dexCount());
  return 0;
}

export function startQuest(id: string, opts: { silent?: boolean } = {}): boolean {
  const d = questDef(id);
  if (!d || isDaily(d) || isActive(id) || isDone(id) || !requirementsMet(d)) return false;
  const q: QuestState = { id, progress: 0, step: 0, status: 'active', at: Date.now() };
  state.quests.active.push(q);
  if (!opts.silent) notify(`${d.kind === 'main' ? 'New story quest' : d.kind === 'bounty' ? 'Bounty accepted' : 'New quest'}: <b>${d.title}</b>`, 'quest');
  emit('quest_start', { id });
  autoTrack(d);
  touch();
  enterStep(q, d, 0);
  return true;
}

function enterStep(q: QuestState, d: QuestDef, idx: number, depth = 0) {
  q.step = idx;
  const s = d.steps[idx];
  q.progress = s ? initialProgress(s) : 0;
  touch();
  if (!s) { stepsFinished(q, d); return; }
  runEffects(s.onStart);
  say(s.start);
  emit('quest_step', { id: d.id, step: idx });
  if (depth < d.steps.length && stepDone(s)) completeStep(q, d, depth + 1);
}

function completeStep(q: QuestState, d: QuestDef, depth = 0) {
  const s = stepOf(q, d);
  if (!s) return;
  q.progress = countOf(s);
  runEffects(s.onDone);
  say(s.done);
  const next = (q.step ?? 0) + 1;
  if (next < d.steps.length) {
    if (!isDaily(d) && d.id !== 'pro_empty_handed') notify(`${d.title}: <b>${fill(d.steps[next].text)}</b>`, 'quest');
    enterStep(q, d, next, depth);
  } else stepsFinished(q, d);
}

function stepsFinished(q: QuestState, d: QuestDef) {
  q.status = 'ready';
  touch();
  const turnIn = turnInOf(d);
  if (isDaily(d)) { notify(`Daily complete: <b>${d.title.replace(/^Daily: /, '')}</b> — claim it in your journal`, 'quest'); return; }
  if (turnIn) { notify(`${d.title}: <b>return to ${npcName(turnIn)}</b>`, 'quest'); return; }
  claim(d.id);
}

/** Hand out the reward for a finished quest. Works from the log or at the turn-in NPC. */
export function claim(id: string): boolean {
  const daily = state.quests.daily.list.find((a) => a.id === id);
  const d = questDef(id);
  if (!d) return false;
  if (daily) {
    if (daily.claimed || daily.progress < countOf(d.steps[0])) return false;
    daily.claimed = true;
    applyReward(d.reward);
    notify(`Reward: <b>${rewardText(d.reward)}</b>`, 'loot');
    touch();
    save();
    return true;
  }
  const q = state.quests.active.find((a) => a.id === id);
  if (!q || q.status !== 'ready') return false;
  state.quests.active = state.quests.active.filter((a) => a !== q);
  state.quests.done.push(id);
  applyReward(d.reward);
  runEffects(d.unlocks);
  say(d.complete);
  if (d.kind === 'side') bump('sidequests');
  if (d.kind === 'bounty') bump('bounties');
  notify(`Quest complete: <b>${d.title}</b>${rewardText(d.reward) ? ` — ${rewardText(d.reward)}` : ''}`, 'quest');
  emit('quest_done', { id, kind: d.kind });
  if (state.quests.tracked === id) state.quests.tracked = undefined;
  touch();
  syncQuests();
  save();
  return true;
}

// ── events ────────────────────────────────────────────────────────────────────
function orderedActive(): QuestState[] {
  const rank = (q: QuestState) => { const k = questDef(q.id)?.kind; return k === 'main' ? 0 : k === 'bounty' ? 2 : 1; };
  return [...state.quests.active].sort((a, b) => rank(a) - rank(b) || (a.at ?? 0) - (b.at ?? 0));
}

function onEvent(name: string, e: Ev) {
  if (name === 'quest_step' || name === 'quest_start' || name === 'item_get' && !state.quests.active.length) return;
  let changed = false;
  const lists: QuestState[][] = [orderedActive(), state.quests.daily.list];
  for (const list of lists) {
    for (const q of list) {
      if (q.claimed || q.status === 'ready') continue;
      const d = questDef(q.id);
      if (!d) continue;
      const s = stepOf(q, d);
      if (!s) continue;
      // quest-only item drops
      const at = q.step;
      if (s.type === 'collect' && s.drop && s.item && name === s.drop.event) {
        const dr = s.drop;
        if ((!dr.zone || e.zone === dr.zone) && (!dr.element || e.element === dr.element) && (!dr.species || e.species === dr.species) && Math.random() < (dr.chance ?? 1)) {
          notify(`+1 <b>${ITEMS[s.item].name}</b> (${Math.min(countOf(s), itemCount(s.item) + 1)}/${countOf(s)})`, 'loot');
          addItem(s.item, 1); // may complete this step through the nested item_get
          changed = true;
        }
        continue;
      }
      if (q.step !== at || (q.status as string) === 'ready') continue; // a nested event moved this quest on
      // deliveries happen while talking
      if (s.type === 'deliver' && name === 'talk' && e.npc === s.npc && s.item) {
        if (itemCount(s.item) >= countOf(s)) { addItem(s.item, -countOf(s)); completeStep(q, d); changed = true; }
        else say([[s.npc!, `Bring me ${countOf(s) - itemCount(s.item)} more ${ITEMS[s.item].name}${countOf(s) - itemCount(s.item) > 1 ? 's' : ''} when you can.`]]);
        continue;
      }
      if ((s.alt ?? []).some((a) => matches(a, name, e) || satisfied(a))) { completeStep(q, d); changed = true; continue; }
      if (matches(s, name, e)) {
        q.progress = Math.min(countOf(s), q.progress + amountFor(name, e));
        changed = true;
        touch();
        if (q.progress >= countOf(s)) completeStep(q, d);
        continue;
      }
      // state-based steps re-check on anything that could flip them
      if (s.type === 'collect' && s.item) {
        const p = Math.min(countOf(s), itemCount(s.item));
        if (p !== q.progress) { q.progress = p; touch(); changed = true; }
        if (p >= countOf(s)) { completeStep(q, d); changed = true; }
      } else if (s.type === 'dex') {
        const p = Math.min(countOf(s), dexCount());
        if (p !== q.progress) { q.progress = p; touch(); }
        if (p >= countOf(s)) { completeStep(q, d); changed = true; }
      } else if ((name === 'boss_win' || name === 'gate_open' || name === 'dungeon_clear' || name === 'enter_dungeon') && stepDone(s)) {
        completeStep(q, d);
        changed = true;
      }
    }
  }
  if (name === 'boss_win' || name === 'gate_open' || name === 'story_battle' || name === 'quest_done' || name === 'dungeon_clear') syncQuests();
  if (changed) save();
}

let posAcc = 0;
/** Position-driven checks (reach steps, quest-guided discovery). Called by the world layer. */
export function tick(x: number, z: number, dt = 0.016) {
  posAcc += dt;
  if (posAcc < 0.25) return;
  posAcc = 0;
  for (const q of orderedActive()) {
    const d = questDef(q.id);
    if (!d || q.status === 'ready') continue;
    const s = stepOf(q, d);
    if (!s) continue;
    // Arriving where the quest points reveals the hidden entrance it's about.
    if ((s.type === 'dungeon' || s.type === 'clear') && s.id) {
      const p = locate(`dungeon:${s.id}`);
      if (p && Math.hypot(p[0] - x, p[1] - z) < 25) discoverDungeon(s.id, 'quest');
    }
    if (s.type === 'reach' || s.type === 'region' || (s.alt ?? []).some((a) => a.type === 'reach')) {
      if (stepDone(s)) { completeStep(q, d); save(); }
    }
  }
}

// ── dailies ───────────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().slice(0, 10);
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
}
function syncDailies() {
  const q = state.quests;
  if (q.daily.date === today()) return;
  const r = seeded(today());
  const pool = [...DAILY_POOL];
  const list: QuestState[] = [];
  for (let i = 0; i < 3 && pool.length; i++) list.push({ id: pool.splice(Math.floor(r() * pool.length), 1)[0].id, progress: 0, step: 0 });
  q.daily = { date: today(), list };
  touch();
}

/** Start whatever the story is ready for, refresh dailies, settle state-based steps. */
export function syncQuests() {
  syncDailies();
  if (state.story.prologue !== 'done') return;
  for (const d of MAIN_QUESTS) if (d.auto && !isActive(d.id) && !isDone(d.id) && requirementsMet(d)) startQuest(d.id);
  for (const q of [...state.quests.active]) {
    const d = questDef(q.id);
    const s = d && stepOf(q, d);
    if (d && s && q.status !== 'ready' && stepDone(s)) completeStep(q, d);
  }
  if (!state.quests.tracked || !isActive(state.quests.tracked)) retrack();
}

// ── tracking ──────────────────────────────────────────────────────────────────
function autoTrack(d: QuestDef) {
  const cur = state.quests.tracked ? questDef(state.quests.tracked) : undefined;
  if (!cur || !isActive(cur.id) || (d.kind === 'main' && cur.kind !== 'main')) state.quests.tracked = d.id;
}
function retrack() {
  const act = orderedActive();
  const here = currentRegion();
  const main = act.filter((q) => questDef(q.id)?.kind === 'main');
  const pick = main.find((q) => questDef(q.id)?.region === here) ?? main[0] ?? [...act].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0];
  state.quests.tracked = pick?.id;
  touch();
}
export function track(id: string) {
  if (!isActive(id)) return;
  state.quests.tracked = id;
  touch();
  save();
}

// ── views (QuestApi) ──────────────────────────────────────────────────────────
function stepView(s: StepDef, done: boolean, progress?: number): QuestStepView {
  const c = countOf(s);
  return { text: fill(s.text), done, ...(c > 1 ? { progress: done ? c : Math.min(c, Math.round(progress ?? 0)), count: c } : {}) };
}

function markerFor(q: QuestState, d: QuestDef, tracked: boolean): Marker | undefined {
  const ref = stepTarget(q, d);
  const p = ref ? locate(ref) : null;
  if (!p) return undefined;
  const s = stepOf(q, d);
  const label = q.status === 'ready' ? `Return to ${npcName(turnInOf(d) ?? d.giver)}` : s ? fill(s.text) : d.title;
  return { id: `quest:${d.id}`, kind: q.status === 'ready' ? 'quest-turnin' : 'quest', x: p[0], z: p[1], label, beacon: tracked, region: d.region };
}

export function viewOf(d: QuestDef): QuestView {
  const tracked = state.quests.tracked === d.id;
  const q = activeState(d.id);
  const giver = d.giver ? npcName(d.giver) : undefined;
  const base = { id: d.id, kind: d.kind, title: fill(d.title), chapter: d.chapter, giver, summary: fill(d.summary), rewards: d.reward, level: d.level, tracked };
  if (isDone(d.id) || (q && q.claimed)) {
    return { ...base, steps: d.steps.map((s) => stepView(s, true)), current: null, status: 'done', tracked: false };
  }
  if (!q) {
    const first = d.steps[0];
    return { ...base, steps: [], current: first ? stepView(first, false, 0) : null, status: 'available', target: d.giver ? markerOrUndefined(`npc:${d.giver}`, `${d.title}`, 'quest-available', d.region) : undefined, tracked: false };
  }
  const idx = q.step ?? 0;
  if (q.status === 'ready' || idx >= d.steps.length) {
    const who = turnInOf(d);
    const steps = d.steps.map((s) => stepView(s, true));
    const current: QuestStepView = { text: who ? `Return to ${npcName(who)}` : isDaily(d) ? 'Claim your reward' : 'Complete', done: false };
    return { ...base, steps: [...steps, current], current, status: 'ready', target: markerFor(q, d, tracked) };
  }
  const steps = d.steps.slice(0, idx).map((s) => stepView(s, true));
  const current = stepView(d.steps[idx], false, q.progress);
  return { ...base, steps: [...steps, current], current, status: 'active', target: markerFor(q, d, tracked) };
}

function markerOrUndefined(ref: string, label: string, kind: Marker['kind'], region: string): Marker | undefined {
  const p = locate(ref);
  return p ? { id: `${kind}:${ref}`, kind, x: p[0], z: p[1], label, region } : undefined;
}

/** Everything for the quest log. */
export function listViews(): QuestView[] {
  const out: QuestView[] = [];
  for (const q of orderedActive()) { const d = questDef(q.id); if (d) out.push(viewOf(d)); }
  for (const q of state.quests.daily.list) { const d = questDef(q.id); if (d) out.push(viewOf(d)); }
  // known offers: givers you've met, or in lands you've walked
  for (const d of availableQuests()) {
    const known = (d.giver && state.story.met.includes(d.giver)) || state.explore.visited.includes(d.region);
    if (known) out.push(viewOf(d));
  }
  for (const id of [...state.quests.done].reverse().slice(0, 40)) { const d = questDef(id); if (d && !isDaily(d)) out.push(viewOf(d)); }
  return out;
}

export function trackedView(): QuestView | null {
  if (!state.quests.tracked || !isActive(state.quests.tracked)) {
    if (state.quests.active.length) retrack();
  }
  const d = state.quests.tracked ? questDef(state.quests.tracked) : undefined;
  return d ? viewOf(d) : null;
}

/** What an NPC shows over their head: '!' new quest, '?' something to do with you now. */
export function npcMark(npc: string): '!' | '?' | null {
  for (const q of state.quests.active) {
    const d = questDef(q.id);
    if (!d) continue;
    if (q.status === 'ready' && turnInOf(d) === npc) return '?';
    const s = stepOf(q, d);
    if (q.status !== 'ready' && s && (s.type === 'talk' || s.type === 'deliver' || s.type === 'battle') && s.npc === npc) return '?';
  }
  return offersFrom(npc).length ? '!' : null;
}

let markerCache: { v: number; t: number; list: Marker[] } = { v: -1, t: 0, list: [] };
export function questMarkers(): Marker[] {
  const now = Date.now();
  if (markerCache.v === ver && now - markerCache.t < 500) return markerCache.list;
  const list: Marker[] = [];
  for (const q of orderedActive()) {
    const d = questDef(q.id);
    const m = d && markerFor(q, d, state.quests.tracked === d.id);
    if (m) list.push(m);
  }
  // quest-available marks for givers in lands you can reach
  const seen = new Set<string>();
  for (const d of availableQuests()) {
    if (!d.giver || seen.has(d.giver)) continue;
    seen.add(d.giver);
    const m = markerOrUndefined(`npc:${d.giver}`, `${npcName(d.giver)} has a request`, 'quest-available', d.region);
    if (m) list.push(m);
  }
  markerCache = { v: ver, t: now, list };
  return list;
}

const questApi: QuestApi = {
  list: () => listViews(),
  tracked: () => trackedView(),
  track: (id) => track(id),
  markers: () => questMarkers(),
  claim: (id) => claim(id),
  version: () => ver,
};

// ── talking (used by the story layer) ────────────────────────────────────────
export type TalkOption =
  | { kind: 'battle'; quest: string; step: StepDef }
  | { kind: 'step'; quest: string }
  | { kind: 'turnin'; quest: string }
  | { kind: 'offer'; quest: string }
  | { kind: 'nudge'; quest: string; beats: Beat[] };

/** What this NPC can do for the player right now, most important first. */
export function talkOptions(npc: string): TalkOption[] {
  const out: TalkOption[] = [];
  for (const q of orderedActive()) {
    const d = questDef(q.id);
    if (!d) continue;
    if (q.status === 'ready') { if (turnInOf(d) === npc) out.push({ kind: 'turnin', quest: d.id }); continue; }
    const s = stepOf(q, d);
    if (!s) continue;
    if (s.type === 'battle' && s.npc === npc) out.push({ kind: 'battle', quest: d.id, step: s });
    else if ((s.type === 'talk' || s.type === 'deliver') && s.npc === npc) out.push({ kind: 'step', quest: d.id });
  }
  for (const d of offersFrom(npc)) out.push({ kind: 'offer', quest: d.id });
  for (const q of orderedActive()) {
    const d = questDef(q.id);
    if (!d || d.giver !== npc || q.status === 'ready') continue;
    const s = stepOf(q, d);
    const beats: Beat[] = s?.progress ?? [[npc, `${fill(s?.text ?? d.title)}${s && countOf(s) > 1 ? ` — ${Math.min(q.progress, countOf(s))} of ${countOf(s)} so far.` : '.'}`]];
    out.push({ kind: 'nudge', quest: d.id, beats });
  }
  return out;
}

/** Accept a side quest or bounty from its giver or the board. */
export function accept(id: string): boolean {
  const d = questDef(id);
  if (!d || !sideLike(d)) return false;
  if (state.quests.active.filter((a) => sideLike(questDef(a.id)!)).length >= SIDE_LIMIT) return false;
  const ok = startQuest(id);
  if (ok) save();
  return ok;
}

// ── legacy view for the v2 UI (hud tracker, quest tab, quest board) ─────────────
export interface LegacyQuest { id: string; kind: 'story' | 'side' | 'daily'; title: string; desc: string; giver?: string; objective: { event: string; count: number }; reward: QuestDef['reward'] }
export function legacyQuest(id: string): LegacyQuest | undefined {
  const d = questDef(id);
  if (!d) return undefined;
  const q = activeState(id);
  const s = q ? stepOf(q, d) : d.steps[0];
  const ready = q?.status === 'ready';
  const who = turnInOf(d);
  return {
    id, kind: d.kind === 'main' ? 'story' : d.kind === 'daily' ? 'daily' : 'side',
    title: fill(d.title),
    desc: ready ? (who ? `Return to ${npcName(who)}` : 'Complete') : s ? fill(s.text) : fill(d.summary),
    giver: d.region,
    objective: { event: s?.type ?? 'talk', count: ready ? Math.max(1, q?.progress ?? 1) : s ? countOf(s) : 1 },
    reward: d.reward,
  };
}

// ── wiring ────────────────────────────────────────────────────────────────────
let wired = false;
export function initQuests() {
  if (wired) return;
  wired = true;
  registerQuestApi(questApi);
  onAny((k, e) => onEvent(String(k), (e ?? {}) as Ev));
  on('talk', (e) => { if (!state.story.met.includes(e.npc)) { state.story.met.push(e.npc); touch(); } });
  syncQuests();
}

/** Test helper: a fresh engine view after the save object was replaced. */
export function resetQuestRuntime() { pending.length = 0; convo = null; markerCache = { v: -1, t: 0, list: [] }; touch(); }
