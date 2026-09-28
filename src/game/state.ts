import type { Element } from '../data/elements';
import type { ItemId, MaterialId, OrbId } from '../data/items';
import type { RelicInstance } from '../data/relics';
import { START_POS, HOMESTEAD } from '../data/zones';
import { GATES } from '../data/layout';
import { DAILY_POOL, questDef } from '../data/quests';
import { rivalFor } from '../data/tamers';
import { emit } from './events';
import { heal, migrateCreature, setRelicResolver, type Creature, type Genes } from './creature';

export interface Egg {
  uid: string;
  species: string;
  genes: Genes;
  inheritSkill?: string;
  parents: [string, string];
  stepsLeft: number;
  stepsTotal: number;
  shinyBoost?: number;
}

export interface Inventory {
  gold: number;
  aether: number;
  tickets: number;
  essence: number;
  orbs: Record<OrbId, number>;
  items: Partial<Record<ItemId, number>>;
  elementum: Record<Element, number>;
  materials: Record<MaterialId, number>;
}

export interface DexEntry { seen: boolean; caught: number; shiny: boolean; zones: string[] }

/** One quest in progress. `progress` counts the current step (v2 name, kept for the legacy UI). */
export interface QuestState {
  id: string;
  progress: number;
  claimed?: boolean;
  /** Current step index (v3). */
  step?: number;
  /** 'ready' = every step done, waiting for turn-in / claim. */
  status?: 'active' | 'ready';
  /** When it was accepted (ms). */
  at?: number;
}
export interface BaseStructure { uid: string; type: string; x: number; z: number; rot: number; level: number; lastCollect: number; assigned: string[] }

/** Where the story stands (v3). Story flags live in `state.flags` (`story:*`, `dungeon_found:*`, `dungeon_clear:*`). */
export interface StoryState {
  /** Onboarding: arrive → starter → rival → done. */
  prologue: 'arrive' | 'starter' | 'rival' | 'done';
  /** Kai's starter species ('' until the prologue picks it). */
  rival: string;
  /** Rival battles fought (drives Kai's arc). */
  kai: number;
  /** Stock-tier floor granted by quests (sigils raise it too). */
  shopTier: number;
  /** Unlocked features: 'board', 'merchant', 'bounties', 'postgame'… */
  features: string[];
  /** Gates opened by quests or save migration, regardless of Guardians. */
  gatesForced: string[];
  /** Gates known to be open (drives `gate_open`). */
  gatesOpen: string[];
  /** Gates whose opening moment has played in the world. */
  gatesSeen: string[];
  /** NPCs the Wayfarer has spoken to. */
  met: string[];
}

export interface ExploreState {
  /** Fog of war: base64 bitset, EXPLORE_RES² cells, row-major z rows. */
  fog: string;
  /** Lands the Wayfarer has set foot in. */
  visited: string[];
  /** Discovered points of interest. */
  pois: string[];
}

export interface ShopState { day: string; bought: Record<string, number> }

export interface GameState {
  version: number;
  started: boolean;
  profile: { name: string; title: string; avatar: string; createdAt: number };
  team: Creature[];
  box: Creature[];
  eggs: Egg[];
  inv: Inventory;
  relics: RelicInstance[];
  dex: Record<string, DexEntry>;
  bosses: string[];
  pos: [number, number];
  respawn: [number, number];
  steps: number;
  flags: Record<string, boolean>;
  time: number;
  day: number;
  waypoints: string[];
  gathered: Record<string, number>;
  quests: { active: QuestState[]; done: string[]; daily: { date: string; list: QuestState[] }; tracked?: string };
  achievements: Record<string, { progress: number; claimed: boolean }>;
  rank: { level: number; xp: number };
  stats: Record<string, number>;
  gacha: { pity: number; pityEpic: number; pulls: number; lastFree: string; history: { at: number; species?: string; relic?: string; rarity: string }[] };
  base: { structures: BaseStructure[] };
  daily: { lastLogin: string; streak: number; claimed: string };
  tamers: Record<string, string>;
  buffs: { lure?: number; shimmer?: number; ward?: number };
  /** Preferred ride (creature uid). */
  mountUid?: string;
  story: StoryState;
  explore: ExploreState;
  shop: ShopState;
}

export const TEAM_MAX = 4;
export const BATTLE_SLOTS = 3;
export const SAVE_VERSION = 3;
const LEGACY_KEY = 'expedition-wilds-save-v1';
let KEY = 'wm-save-guest';

export const freshStory = (): StoryState => ({ prologue: 'arrive', rival: '', kai: 0, shopTier: 0, features: [], gatesForced: [], gatesOpen: [], gatesSeen: [], met: [] });

export function freshState(): GameState {
  return {
    version: SAVE_VERSION,
    started: false,
    profile: { name: 'Wayfarer', title: 'Novice Wayfarer', avatar: 'mage', createdAt: Date.now() },
    team: [], box: [], eggs: [],
    inv: {
      gold: 300, aether: 480, tickets: 1, essence: 0,
      orbs: { mystic: 8, radiant: 2, grand: 0, sovereign: 0, dusk: 0, tide: 0, ember: 0, astral: 0 },
      items: { tonic: 4, elixir: 1, ether: 1, cleanse: 2 },
      elementum: { fire: 0, water: 0, nature: 0, earth: 0, storm: 0, wind: 0, void: 0 },
      materials: { wood: 20, stone: 20, ore: 0, crystal: 0, fiber: 10 },
    },
    relics: [],
    dex: {},
    bosses: [],
    pos: [...START_POS],
    respawn: [...START_POS],
    steps: 0,
    flags: {},
    time: 0.36,
    day: 1,
    waypoints: ['vale-town'],
    gathered: {},
    quests: { active: [], done: [], daily: { date: '', list: [] } },
    achievements: {},
    rank: { level: 1, xp: 0 },
    stats: {},
    gacha: { pity: 0, pityEpic: 0, pulls: 0, lastFree: '', history: [] },
    base: { structures: [] },
    daily: { lastLogin: '', streak: 0, claimed: '' },
    tamers: {},
    buffs: {},
    story: freshStory(),
    explore: { fog: '', visited: [], pois: [] },
    shop: { day: '', bought: {} },
  };
}

export let state: GameState = load();
setRelicResolver((uid) => state.relics.find((r) => r.uid === uid));

/** Switch the active save slot (per account). Loads that slot into `state`. */
export function useSaveSlot(key: string) { KEY = key; state = load(); }
export const saveSlot = () => KEY;

// ── migration ─────────────────────────────────────────────────────────────────
/** The v2 map was a different island; its homestead sat here. */
const V2_HOMESTEAD: [number, number] = [82, 90];
/** v2 Guardian → the v3 chapter quest it completes. */
const CHAPTER_OF: Record<string, string> = {
  vale: 'ch1_first_bond', lakes: 'ch2_lakes', coast: 'ch3_coast', marsh: 'ch4_marsh', scar: 'ch5_scar',
  elder: 'ch6_elder', dunes: 'ch7_dunes', peaks: 'ch8_peaks', hollows: 'ch9_hollows', summit: 'fin_crown',
};

function migrate(s: Partial<GameState> & Record<string, unknown>): GameState {
  const base = freshState();
  const from = typeof s.version === 'number' ? s.version : 1;
  const out = { ...base, ...s } as GameState;
  // v1 → v2 inventory
  const inv = s.inv as unknown as Record<string, unknown> | undefined;
  if (inv && typeof inv.orbs === 'number') {
    out.inv = {
      ...base.inv,
      gold: (inv.gold as number) ?? base.inv.gold,
      orbs: { ...base.inv.orbs, mystic: inv.orbs as number, radiant: (inv.greatOrbs as number) ?? 0 },
      items: { ...base.inv.items, tonic: (inv.potions as number) ?? 0, elixir: (inv.elixirs as number) ?? 0 },
      elementum: { ...base.inv.elementum, ...(inv.elementum as Record<Element, number>) },
    };
  }
  out.inv = { ...base.inv, ...out.inv, orbs: { ...base.inv.orbs, ...out.inv.orbs }, items: { ...base.inv.items, ...out.inv.items }, materials: { ...base.inv.materials, ...out.inv.materials }, elementum: { ...base.inv.elementum, ...out.inv.elementum } };
  // v1 → v2 dex
  const dex: Record<string, DexEntry> = {};
  for (const [k, v] of Object.entries(out.dex ?? {})) {
    if (typeof v === 'string') dex[k] = { seen: true, caught: v === 'caught' ? 1 : 0, shiny: false, zones: [] };
    else dex[k] = v as DexEntry;
  }
  out.dex = dex;
  out.team = (out.team ?? []).map(migrateCreature);
  out.box = (out.box ?? []).map(migrateCreature);
  for (const k of Object.keys(base) as (keyof GameState)[]) if (out[k] === undefined) (out as unknown as Record<string, unknown>)[k] = base[k];
  // v3 blocks (merge so later fields added with defaults survive old v3 saves)
  out.story = { ...base.story, ...(s.story as Partial<StoryState> | undefined) };
  out.explore = { ...base.explore, ...(s.explore as Partial<ExploreState> | undefined) };
  out.shop = { ...base.shop, ...(s.shop as Partial<ShopState> | undefined) };
  out.quests = { ...base.quests, ...out.quests, daily: { ...base.quests.daily, ...(out.quests?.daily ?? {}) } };
  out.flags = { ...(out.flags ?? {}) };
  if (from < 3) migrateV2(out);
  out.version = SAVE_VERSION;
  return out;
}

/**
 * v2 → v3: veterans skip the prologue and keep their team, box and inventory. Every gate that
 * borders a land whose Guardian they already answered opens, so no finished land is walled off
 * in the new layout. Positions reset to Hearthwick (the island was redrawn).
 */
function migrateV2(out: GameState) {
  const veteran = out.started && out.team.length > 0;
  const st = out.story;
  if (veteran) {
    st.prologue = 'done';
    const starter = [...out.team, ...out.box].find((c) => c.caught?.how === 'starter') ?? out.team[0];
    st.rival = rivalFor(starter?.species ?? 'emberling');
    st.kai = Math.min(6, out.bosses.length);
    st.features = [...new Set([...st.features, 'board', 'merchant', ...(out.bosses.length ? ['bounties'] : [])])];
  }
  // quests: finished chapters, dailies kept, retired v2 quest ids dropped
  const done = new Set(out.quests.done.filter((id) => questDef(id)));
  if (veteran) { done.add('pro_empty_handed'); done.add('ch1_first_steps'); }
  for (const b of out.bosses) if (CHAPTER_OF[b]) done.add(CHAPTER_OF[b]);
  out.quests.done = [...done];
  out.quests.active = out.quests.active.filter((a) => questDef(a.id) && !done.has(a.id)).map((a) => ({ ...a, step: a.step ?? 0 }));
  out.quests.daily.list = out.quests.daily.list.filter((a) => DAILY_POOL.some((d) => d.id === a.id));
  out.quests.tracked = undefined;
  // gates
  const beaten = new Set(out.bosses);
  const opens = (g: (typeof GATES)[number]) => g.unlock.any ? g.unlock.bosses.some((b) => beaten.has(b)) : g.unlock.bosses.every((b) => beaten.has(b));
  st.gatesForced = GATES.filter((g) => g.id !== 'g_crown' && g.joins.some((j) => beaten.has(j))).map((g) => g.id);
  const open = GATES.filter((g) => opens(g) || st.gatesForced.includes(g.id)).map((g) => g.id);
  st.gatesOpen = [...open];
  st.gatesSeen = [...open];
  // exploration: lands they obviously know
  const seenZones = new Set<string>(['vale', ...out.bosses]);
  for (const d of Object.values(out.dex)) for (const z of d.zones ?? []) seenZones.add(z);
  out.explore.visited = [...seenZones];
  // homestead moved with the island; structures keep their layout
  const dx = HOMESTEAD.center[0] - V2_HOMESTEAD[0], dz = HOMESTEAD.center[1] - V2_HOMESTEAD[1];
  for (const b of out.base.structures) { b.x += dx; b.z += dz; }
  out.pos = [...START_POS];
  out.respawn = [...START_POS];
}

function load(): GameState {
  try {
    let raw = localStorage.getItem(KEY);
    if (!raw && KEY === 'wm-save-guest') raw = localStorage.getItem(LEGACY_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch { /* storage unavailable */ }
  return freshState();
}

type SaveListener = (json: string) => void;
const saveListeners = new Set<SaveListener>();
export function onSave(l: SaveListener) { saveListeners.add(l); }
type BeforeSave = () => void;
const beforeSave = new Set<BeforeSave>();
/** Systems that keep compact caches (fog of war) flush them into `state` here. */
export function onBeforeSave(f: BeforeSave) { beforeSave.add(f); }

export function save() {
  beforeSave.forEach((f) => { try { f(); } catch { /* keep saving */ } });
  try {
    const json = JSON.stringify(state);
    localStorage.setItem(KEY, json);
    saveListeners.forEach((l) => l(json));
  } catch { /* ignore */ }
}

export function exportSave() { beforeSave.forEach((f) => f()); return JSON.stringify(state); }
export function importSave(json: string) {
  state = migrate(JSON.parse(json));
  save();
}

export function resetSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  state = freshState();
}

export function dexEntry(species: string): DexEntry {
  return (state.dex[species] ??= { seen: false, caught: 0, shiny: false, zones: [] });
}
export function markSeen(species: string, zone?: string) {
  const d = dexEntry(species);
  d.seen = true;
  if (zone && !d.zones.includes(zone)) d.zones.push(zone);
}
export function markCaught(species: string, shiny = false, zone?: string) {
  const d = dexEntry(species);
  d.seen = true;
  d.caught++;
  if (shiny) d.shiny = true;
  if (zone && !d.zones.includes(zone)) d.zones.push(zone);
}
export const isCaught = (species: string) => (state.dex[species]?.caught ?? 0) > 0;
export const dexCount = () => Object.values(state.dex).filter((d) => d.caught > 0).length;

/** Add creature to team if room, otherwise to box. Returns where it went. */
export function addCreature(c: Creature): 'team' | 'box' {
  markCaught(c.species, c.shiny, c.caught?.zone);
  if (state.team.length < TEAM_MAX) { state.team.push(c); return 'team'; }
  state.box.push(c);
  return 'box';
}

export function healAll() { state.team.forEach(heal); state.box.forEach(heal); }
export const teamAlive = () => state.team.some((c) => c.hp > 0);

export function bump(stat: string, n = 1) { state.stats[stat] = (state.stats[stat] ?? 0) + n; }
export const itemCount = (id: ItemId) => state.inv.items[id] ?? 0;
export function addItem(id: ItemId, n = 1) {
  state.inv.items[id] = Math.max(0, (state.inv.items[id] ?? 0) + n);
  if (n > 0) emit('item_get', { item: id, n });
}
