// Tiny typed event bus. Gameplay emits; quests, achievements, stats and UI listen.
import type { Element } from '../data/elements';

export interface GameEvents {
  battle_win: { kind: 'wild' | 'boss' | 'tamer'; zone: string };
  battle_lose: { zone: string };
  catch: { species: string; shiny: boolean; zone: string; how: string; element: Element; night: boolean };
  defeat: { species: string; zone: string; element: Element };
  perfect: Record<string, never>;
  parry: Record<string, never>;
  dodge: Record<string, never>;
  jump_dodge: Record<string, never>;
  break: Record<string, never>;
  burst: Record<string, never>;
  gather: { material: string; n: number };
  search: { zone: string };
  grass: { zone: string };
  hatch: { species: string; shiny: boolean };
  evolve: { from: string; to: string };
  breed: Record<string, never>;
  infuse: Record<string, never>;
  enhance: Record<string, never>;
  discover: { id: string };
  travel: { id: string };
  summon: { rarity: string; count: number };
  build: { type: string };
  boss_win: { zone: string };
  tamer_win: { id: string };
  rank_up: { level: number };
  step: { meters: number };
  // v3:content — quests, NPCs, shops, gates and exploration. (The towns workstream adds
  // `open_chest`; the creatures workstream adds `alpha_defeat` / `alpha_catch`.)
  talk: { npc: string };
  starter: { species: string };
  story_battle: { id: string; result: 'win' | 'lose' | 'fled' | 'captured' };
  enter_region: { region: string };
  reach: { id: string };
  enter_dungeon: { id: string };
  dungeon_clear: { id: string };
  dungeon_found: { id: string; how: string };
  gate_open: { id: string };
  buy: { shop: string; item: string; qty: number; cost: number };
  sell: { shop: string; item: string; qty: number; gain: number };
  item_get: { item: string; n: number };
  use_service: { service: string; zone: string };
  ui_open: { tab: string };
  quest_start: { id: string };
  quest_step: { id: string; step: number };
  quest_done: { id: string; kind: string };
}

type Handler<K extends keyof GameEvents> = (e: GameEvents[K]) => void;
const handlers = new Map<keyof GameEvents, Set<Handler<keyof GameEvents>>>();

export function on<K extends keyof GameEvents>(k: K, h: Handler<K>) {
  let set = handlers.get(k);
  if (!set) { set = new Set(); handlers.set(k, set); }
  set.add(h as Handler<keyof GameEvents>);
  return () => set!.delete(h as Handler<keyof GameEvents>);
}

export function emit<K extends keyof GameEvents>(k: K, e: GameEvents[K]) {
  handlers.get(k)?.forEach((h) => { try { (h as Handler<K>)(e); } catch (err) { console.error(err); } });
  anyHandlers.forEach((h) => h(k, e));
}

type AnyHandler = (k: keyof GameEvents, e: unknown) => void;
const anyHandlers = new Set<AnyHandler>();
export function onAny(h: AnyHandler) { anyHandlers.add(h); return () => anyHandlers.delete(h); }

/** Emit an event another workstream defines (e.g. `alpha_defeat`) without a compile-time dependency. */
export function emitLoose(k: string, e: unknown) { emit(k as keyof GameEvents, e as never); }
