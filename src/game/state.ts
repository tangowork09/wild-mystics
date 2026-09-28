import type { Element } from '../data/elements';
import type { ItemId, MaterialId, OrbId } from '../data/items';
import type { RelicInstance } from '../data/relics';
import { START_POS } from '../data/zones';
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

export interface QuestState { id: string; progress: number; claimed?: boolean }
export interface BaseStructure { uid: string; type: string; x: number; z: number; rot: number; level: number; lastCollect: number; assigned: string[] }

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
  quests: { active: QuestState[]; done: string[]; daily: { date: string; list: QuestState[] } };
  achievements: Record<string, { progress: number; claimed: boolean }>;
  rank: { level: number; xp: number };
  stats: Record<string, number>;
  gacha: { pity: number; pityEpic: number; pulls: number; lastFree: string; history: { at: number; species?: string; relic?: string; rarity: string }[] };
  base: { structures: BaseStructure[] };
  daily: { lastLogin: string; streak: number; claimed: string };
  tamers: Record<string, string>;
  buffs: { lure?: number; shimmer?: number };
  /** Preferred ride (creature uid). */
  mountUid?: string;
}

export const TEAM_MAX = 4;
export const BATTLE_SLOTS = 3;
export const SAVE_VERSION = 2;
const LEGACY_KEY = 'expedition-wilds-save-v1';
let KEY = 'wm-save-guest';

export function freshState(): GameState {
  return {
    version: SAVE_VERSION,
    started: false,
    profile: { name: 'Wayfarer', title: 'Novice Wayfarer', avatar: 'mage', createdAt: Date.now() },
    team: [], box: [], eggs: [],
    inv: {
      gold: 300, aether: 480, tickets: 1, essence: 0,
      orbs: { mystic: 8, radiant: 2, dusk: 0, tide: 0, ember: 0, astral: 0 },
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
  };
}

export let state: GameState = load();
setRelicResolver((uid) => state.relics.find((r) => r.uid === uid));

/** Switch the active save slot (per account). Loads that slot into `state`. */
export function useSaveSlot(key: string) { KEY = key; state = load(); }
export const saveSlot = () => KEY;

function migrate(s: Partial<GameState> & Record<string, unknown>): GameState {
  const base = freshState();
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
  out.version = SAVE_VERSION;
  return out;
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

export function save() {
  try {
    const json = JSON.stringify(state);
    localStorage.setItem(KEY, json);
    saveListeners.forEach((l) => l(json));
  } catch { /* ignore */ }
}

export function exportSave() { return JSON.stringify(state); }
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
export function addItem(id: ItemId, n = 1) { state.inv.items[id] = Math.max(0, (state.inv.items[id] ?? 0) + n); }
