// Shared contracts between the v3 workstreams (see docs/v3/PLAN.md → "Contracts").
// The content workstream implements these APIs and registers them; the UI workstream renders them.
// Both sides code against this file only, so they can be built in parallel. Extend by adding
// optional fields — never rename or remove without updating PLAN.md.

import type { Reward } from '../data/progression';

// ── Markers: anything the HUD compass, minimap, world map or a 3D beacon points at ─────────────
export type MarkerKind =
  | 'quest' | 'quest-turnin' | 'quest-available'
  | 'npc' | 'shop' | 'service' | 'town' | 'waystone' | 'camp'
  | 'dungeon' | 'gate' | 'gate-open' | 'boss' | 'poi' | 'chest' | 'homestead';

export interface Marker {
  id: string;
  kind: MarkerKind;
  x: number;
  z: number;
  /** Height for 3D beacons; resolved from terrain when omitted. */
  y?: number;
  label: string;
  /** Draw a floating 3D beacon + distance label (tracked quest objective). */
  beacon?: boolean;
  /** Region id the marker belongs to. */
  region?: string;
}

// ── Quests ──────────────────────────────────────────────────────────────────────────────────
export interface QuestStepView { text: string; done: boolean; progress?: number; count?: number }

export interface QuestView {
  id: string;
  kind: 'main' | 'side' | 'daily' | 'bounty';
  title: string;
  /** e.g. "Chapter 1 · First Bond" (main quests). */
  chapter?: string;
  /** Quest giver's display name. */
  giver?: string;
  /** 1–2 sentences. */
  summary: string;
  /** Finished steps + the current one (future steps stay hidden). */
  steps: QuestStepView[];
  current: QuestStepView | null;
  /** Where to go for the current step. */
  target?: Marker;
  rewards: Reward;
  status: 'available' | 'active' | 'ready' | 'done';
  tracked: boolean;
  /** Recommended level (shown as a chip). */
  level?: number;
}

export interface QuestApi {
  /** Everything for the quest log (active, ready, done, and known available). */
  list(): QuestView[];
  /** The quest shown in the HUD tracker (and whose target gets the beacon/breadcrumbs). */
  tracked(): QuestView | null;
  track(id: string): void;
  /** Quest targets + NPC quest marks for compass/minimap/map. */
  markers(): Marker[];
  /** Claim a finished quest's reward (if the design hands rewards out in the log). */
  claim(id: string): boolean;
  /** Bumps whenever anything a view shows changed (cheap change detection for the HUD). */
  version(): number;
}

// ── Shops ───────────────────────────────────────────────────────────────────────────────────
export interface ShopItemView {
  id: string;
  name: string;
  desc: string;
  /** Icon key for ui/icons (game-icons set) or an image URL. */
  icon: string;
  category: string;
  price: number;
  currency: 'gold' | 'aether';
  /** Remaining stock today (undefined = unlimited). */
  stock?: number;
  owned: number;
  /** Why it can't be bought yet (e.g. "Unlocks after the Lakes Guardian"). */
  locked?: string;
  /** Short tag such as "New", "Rare", "Daily deal". */
  tag?: string;
}

export interface ShopView {
  id: string;
  name: string;
  keeper: string;
  /** Portrait key for the keeper (NPC id or species id). */
  face?: string;
  greeting: string;
  categories: string[];
  items: ShopItemView[];
  /** What the player can sell here (price = sell price). */
  sellable: ShopItemView[];
}

export interface ShopApi {
  view(shopId: string): ShopView;
  buy(shopId: string, itemId: string, qty: number): { ok: boolean; msg: string };
  sell(shopId: string, itemId: string, qty: number): { ok: boolean; msg: string };
}

// ── World progress (map, gates, regions, fog of war) ─────────────────────────────────────────
export interface RegionView {
  id: string;
  name: string;
  levels: [number, number];
  /** Reachable: its gate is open (or it's the start land). */
  unlocked: boolean;
  /** The player has set foot in it. */
  visited: boolean;
  guardianDefeated: boolean;
  /** How to unlock it, when locked. */
  lockHint?: string;
}

export interface WorldProgressApi {
  regions(): RegionView[];
  /** Fog of war: EXPLORE_RES² cells over the world square, 1 = explored. Row-major, z rows. */
  explored(): Uint8Array;
  /** Discovered points of interest / dungeons / gates for the map. */
  markers(): Marker[];
  version(): number;
}
export const EXPLORE_RES = 128;

// ── Dialog ─────────────────────────────────────────────────────────────────────────────────
export interface DialogSpec {
  name: string;
  title?: string;
  /** Portrait: an NPC id (rendered NPC bust), a species id, or an image URL. */
  face?: string;
  lines: string[];
  choices?: string[];
}

// ── Registry ─────────────────────────────────────────────────────────────────────────────────
// Stubs keep the UI working (empty states) until the content workstream registers real APIs.
const emptyQuests: QuestApi = { list: () => [], tracked: () => null, track: () => {}, markers: () => [], claim: () => false, version: () => 0 };
const emptyShops: ShopApi = {
  view: (id) => ({ id, name: 'Shop', keeper: 'Keeper', greeting: '', categories: [], items: [], sellable: [] }),
  buy: () => ({ ok: false, msg: 'Shops are closed.' }),
  sell: () => ({ ok: false, msg: 'Shops are closed.' }),
};
const emptyWorld: WorldProgressApi = { regions: () => [], explored: () => new Uint8Array(EXPLORE_RES * EXPLORE_RES).fill(1), markers: () => [], version: () => 0 };

export const api = { quests: emptyQuests, shops: emptyShops, world: emptyWorld };

export function registerQuestApi(q: QuestApi) { api.quests = q; }
export function registerShopApi(s: ShopApi) { api.shops = s; }
export function registerWorldProgressApi(w: WorldProgressApi) { api.world = w; }
