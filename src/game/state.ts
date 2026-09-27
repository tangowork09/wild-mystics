import type { Element } from '../data/elements';
import { START_POS } from '../data/zones';
import type { Creature, Genes } from './creature';
import { heal } from './creature';

export interface Egg {
  uid: string;
  species: string;
  genes: Genes;
  inheritSkill?: string;
  parents: [string, string];
  stepsLeft: number;
  stepsTotal: number;
}

export interface Inventory {
  gold: number;
  orbs: number;
  greatOrbs: number;
  potions: number;
  elixirs: number;
  elementum: Record<Element, number>;
}

export interface GameState {
  version: number;
  started: boolean;
  team: Creature[];
  box: Creature[];
  eggs: Egg[];
  inv: Inventory;
  dex: Record<string, 'seen' | 'caught'>;
  bosses: string[];
  pos: [number, number];
  respawn: [number, number];
  steps: number;
  flags: Record<string, boolean>;
}

export const TEAM_MAX = 4;
export const BATTLE_SLOTS = 3;
const KEY = 'expedition-wilds-save-v1';

export function freshState(): GameState {
  return {
    version: 1,
    started: false,
    team: [],
    box: [],
    eggs: [],
    inv: {
      gold: 200, orbs: 5, greatOrbs: 1, potions: 3, elixirs: 0,
      elementum: { fire: 0, water: 0, nature: 0, earth: 0, storm: 0, wind: 0, void: 0 },
    },
    dex: {},
    bosses: [],
    pos: [...START_POS],
    respawn: [...START_POS],
    steps: 0,
    flags: {},
  };
}

export let state: GameState = load();

function load(): GameState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as GameState;
      if (s.version === 1) return { ...freshState(), ...s };
    }
  } catch { /* storage unavailable */ }
  return freshState();
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export function resetSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  state = freshState();
}

export function markSeen(species: string) { if (!state.dex[species]) state.dex[species] = 'seen'; }
export function markCaught(species: string) { state.dex[species] = 'caught'; }

/** Add creature to team if room, otherwise to box. Returns where it went. */
export function addCreature(c: Creature): 'team' | 'box' {
  markCaught(c.species);
  if (state.team.length < TEAM_MAX) { state.team.push(c); return 'team'; }
  state.box.push(c);
  return 'box';
}

export function healAll() { state.team.forEach(heal); state.box.forEach(heal); }

export const teamAlive = () => state.team.some((c) => c.hp > 0);
