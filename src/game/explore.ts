// Exploration: fog of war, land visits, points of interest, hidden-dungeon discovery and the
// WorldProgressApi the map / minimap render.
//
// Dungeon flags (shared with the dungeons workstream — single source of truth):
//   state.flags['dungeon_found:<id>']   hidden entrance discovered
//   state.flags['dungeon_clear:<id>']   dungeon cleared (emit `dungeon_clear` { id })
import { EXPLORE_RES, registerWorldProgressApi, type Marker, type RegionView, type WorldProgressApi } from './contracts';
import { ZONES, WORLD_SIZE, HOMESTEAD, zoneAt } from '../data/zones';
import { DUNGEONS, GATES, POIS, ISLAND } from '../data/layout';
import type { ItemId } from '../data/items';
import { state, onBeforeSave, itemCount, bump } from './state';
import { emit, on } from './events';
import { notify } from './rewards';
import { gateOpen, lockHint, reachableRegions, regionUnlocked } from './gates';

const RES = EXPLORE_RES;
const CELL = WORLD_SIZE / RES;
const HALF = WORLD_SIZE / 2;
/** Radius revealed around the player (the Explorer's Lantern widens it). */
export const REVEAL_RADIUS = 60;
const POI_RADIUS = 45;
const NIGHT_REVEAL = 35;
const DOWSING_RADIUS = 45;
const SEARCH_REVEAL = 60;
const PLAIN_DUNGEON_SEEN = 110;
/** Hidden dungeons revealed by carrying an item. */
const REVEAL_ITEM: Record<string, ItemId> = { d_starfall: 'star_chart' };

let fog = new Uint8Array(RES * RES);
let fogOwner: unknown = null;
let dirty = false;
let ver = 1;
let lastReveal: [number, number] | null = null;
let lastPos: [number, number] = [0, 0];
let region = '';
let nightFn: () => boolean = () => false;
let tickAcc = 0;

export const bumpWorld = () => { ver++; };
export function setNightProvider(f: () => boolean) { nightFn = f; }
export const isNight = () => nightFn();
export const currentRegion = () => region || zoneAt(lastPos[0], lastPos[1]).id;
export const playerPos = (): [number, number] => [...lastPos];

// ── fog (base64 bitset in state.explore.fog) ────────────────────────────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function encode(bits: Uint8Array): string {
  const bytes = new Uint8Array(bits.length >> 3);
  for (let i = 0; i < bits.length; i++) if (bits[i]) bytes[i >> 3] |= 1 << (i & 7);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}
function decode(s: string, into: Uint8Array) {
  into.fill(0);
  if (!s) return;
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) => (s[i + k] === '=' || s[i + k] === undefined ? 0 : B64.indexOf(s[i + k])));
    const n = (c[0] << 18) | (c[1] << 12) | (c[2] << 6) | c[3];
    bytes.push((n >> 16) & 255);
    if (s[i + 2] !== '=') bytes.push((n >> 8) & 255);
    if (s[i + 3] !== '=') bytes.push(n & 255);
  }
  for (let i = 0; i < into.length; i++) into[i] = (bytes[i >> 3] >> (i & 7)) & 1;
}

/** Re-read the fog when the save object changes (new game, account switch, cloud import). */
function ensureFog() {
  if (fogOwner === state.explore) return;
  fogOwner = state.explore;
  decode(state.explore.fog, fog);
  // Veterans (v2 saves) and fresh saves: chart the towns of lands already visited.
  if (!state.explore.fog && state.explore.visited.length) {
    for (const z of ZONES) if (state.explore.visited.includes(z.id)) revealCircle(z.town.pos[0], z.town.pos[1], 110);
  }
  lastReveal = null;
  ver++;
}

function flushFog() {
  ensureFog();
  if (!dirty) return;
  state.explore.fog = encode(fog);
  dirty = false;
}

export function revealCircle(x: number, z: number, r: number): boolean {
  let changed = false;
  const c0 = Math.max(0, Math.floor((x - r + HALF) / CELL)), c1 = Math.min(RES - 1, Math.floor((x + r + HALF) / CELL));
  const r0 = Math.max(0, Math.floor((z - r + HALF) / CELL)), r1 = Math.min(RES - 1, Math.floor((z + r + HALF) / CELL));
  for (let row = r0; row <= r1; row++) {
    const cz = -HALF + (row + 0.5) * CELL;
    for (let col = c0; col <= c1; col++) {
      const cx = -HALF + (col + 0.5) * CELL;
      if ((cx - x) ** 2 + (cz - z) ** 2 > (r + CELL * 0.5) ** 2) continue;
      const k = row * RES + col;
      if (!fog[k]) { fog[k] = 1; changed = true; }
    }
  }
  if (changed) { dirty = true; ver++; }
  return changed;
}

export const isExplored = (x: number, z: number) => {
  ensureFog();
  const col = Math.floor((x + HALF) / CELL), row = Math.floor((z + HALF) / CELL);
  return col >= 0 && row >= 0 && col < RES && row < RES && fog[row * RES + col] === 1;
};

/** Percent of the island (not the sea) charted. */
export function chartedPercent(): number {
  ensureFog();
  const R = ISLAND.coastRadius + ISLAND.coastJitter * 0.5;
  let land = 0, seen = 0;
  for (let row = 0; row < RES; row++) {
    const cz = -HALF + (row + 0.5) * CELL;
    for (let col = 0; col < RES; col++) {
      const cx = -HALF + (col + 0.5) * CELL;
      if (cx * cx + cz * cz > R * R) continue;
      land++;
      if (fog[row * RES + col]) seen++;
    }
  }
  return land ? Math.round((seen / land) * 100) : 0;
}

// ── dungeons ────────────────────────────────────────────────────────────────
export const dungeonFound = (id: string) => !!state.flags[`dungeon_found:${id}`];
export const dungeonCleared = (id: string) => !!state.flags[`dungeon_clear:${id}`];
export const dungeonEntered = (id: string) => !!state.flags[`dungeon_entered:${id}`] || dungeonCleared(id);
/** Shown on the map: hidden ones once found; plain ones once found or their land is visited. */
export function dungeonKnown(id: string) {
  const d = DUNGEONS.find((x) => x.id === id);
  if (!d) return false;
  return dungeonFound(id) || (!d.hidden && state.explore.visited.includes(d.region));
}

export function discoverDungeon(id: string, how: string, quiet = false): boolean {
  const d = DUNGEONS.find((x) => x.id === id);
  if (!d || dungeonFound(id)) return false;
  state.flags[`dungeon_found:${id}`] = true;
  ver++;
  if (!quiet && d.hidden) notify(`Hidden place discovered: <b>${d.name}</b>`, 'good');
  emit('dungeon_found', { id, how });
  return true;
}

/** For the dungeons workstream (and tests): mark a dungeon cleared and tell everyone. */
export function markDungeonCleared(id: string) { emit('dungeon_clear', { id }); }

function checkDungeons(x: number, z: number) {
  const night = nightFn();
  const dowsing = itemCount('dowsing_rod') > 0;
  for (const d of DUNGEONS) {
    if (dungeonFound(d.id)) continue;
    const dist = Math.hypot(d.entrance[0] - x, d.entrance[1] - z);
    if (!d.hidden) { if (dist < PLAIN_DUNGEON_SEEN) discoverDungeon(d.id, 'seen', true); continue; }
    if (d.reveal === 'night' && night && dist < NIGHT_REVEAL) discoverDungeon(d.id, 'night');
    else if (dowsing && (d.reveal === 'search' || d.reveal === 'night') && dist < DOWSING_RADIUS) discoverDungeon(d.id, 'dowsing');
    const key = REVEAL_ITEM[d.id];
    if (d.reveal === 'item' && key && itemCount(key) > 0) discoverDungeon(d.id, 'item');
  }
}

// ── the per-frame hook (called by the world layer) ────────────────────────────
/** Feed the player's position. Cheap: real work happens a few times a second or after moving. */
export function tick(x: number, z: number, dt = 0.016) {
  ensureFog();
  lastPos = [x, z];
  // land visits
  const zone = zoneAt(x, z).id;
  if (zone !== region) {
    region = zone;
    if (!state.explore.visited.includes(zone)) {
      state.explore.visited.push(zone);
      bump('regions');
      ver++;
    }
    emit('enter_region', { region: zone });
  }
  // fog
  const lantern = itemCount('explorer_lantern') > 0;
  if (!lastReveal || Math.hypot(x - lastReveal[0], z - lastReveal[1]) > 4) {
    lastReveal = [x, z];
    revealCircle(x, z, REVEAL_RADIUS * (lantern ? 1.6 : 1));
  }
  tickAcc += dt;
  if (tickAcc < 0.25) return;
  tickAcc = 0;
  // points of interest
  for (const p of POIS) {
    if (state.explore.pois.includes(p.id)) continue;
    if (Math.hypot(p.pos[0] - x, p.pos[1] - z) < POI_RADIUS) {
      state.explore.pois.push(p.id);
      ver++;
      notify(`Discovered <b>${p.name}</b>`, 'good');
      emit('reach', { id: p.id });
    }
  }
  checkDungeons(x, z);
}

// ── WorldProgressApi ──────────────────────────────────────────────────────────
function regionViews(): RegionView[] {
  return ZONES.map((z) => ({
    id: z.id, name: z.name, levels: z.levels,
    unlocked: regionUnlocked(z.id),
    visited: state.explore.visited.includes(z.id),
    guardianDefeated: state.bosses.includes(z.id),
    lockHint: lockHint(z.id),
  }));
}

function worldMarkers(): Marker[] {
  const out: Marker[] = [];
  const reach = reachableRegions();
  for (const z of ZONES) {
    const known = state.explore.visited.includes(z.id) || state.waypoints.includes(`${z.id}-town`);
    if (known) out.push({ id: `town:${z.id}`, kind: 'town', x: z.town.pos[0], z: z.town.pos[1], label: z.town.name, region: z.id });
    if (state.waypoints.includes(`${z.id}-camp`)) out.push({ id: `camp:${z.id}`, kind: 'camp', x: z.camp[0], z: z.camp[1], label: `${z.name} Flag`, region: z.id });
    if (reach.has(z.id) && !state.bosses.includes(z.id) && state.explore.visited.includes(z.id)) out.push({ id: `boss:${z.id}`, kind: 'boss', x: z.boss.pos[0], z: z.boss.pos[1], label: `${z.name} Guardian`, region: z.id });
  }
  for (const p of POIS) if (state.explore.pois.includes(p.id)) out.push({ id: `poi:${p.id}`, kind: 'poi', x: p.pos[0], z: p.pos[1], label: p.name, region: p.region });
  for (const d of DUNGEONS) if (dungeonKnown(d.id)) out.push({ id: `dungeon:${d.id}`, kind: 'dungeon', x: d.entrance[0], z: d.entrance[1], label: d.name, region: d.region });
  // Gates bordering a land you can reach are always on the map — they're where the story goes next.
  for (const g of GATES) {
    if (!g.joins.some((j) => reach.has(j))) continue;
    out.push({ id: `gate:${g.id}`, kind: gateOpen(g.id) ? 'gate-open' : 'gate', x: g.pos[0], z: g.pos[1], label: g.name, region: g.joins[0] });
  }
  out.push({ id: 'homestead', kind: 'homestead', x: HOMESTEAD.center[0], z: HOMESTEAD.center[1], label: 'Your Homestead', region: 'vale' });
  return out;
}

let markerCache: { v: number; list: Marker[] } = { v: -1, list: [] };
const worldApi: WorldProgressApi = {
  regions: () => regionViews(),
  explored: () => { ensureFog(); return fog; },
  markers: () => {
    const v = ver + state.bosses.length * 1000 + state.waypoints.length * 7;
    if (markerCache.v !== v) markerCache = { v, list: worldMarkers() };
    return markerCache.list;
  },
  version: () => ver + state.bosses.length * 100000 + state.explore.visited.length * 1000 + state.waypoints.length,
};

let wired = false;
export function initExplore() {
  if (wired) return;
  wired = true;
  registerWorldProgressApi(worldApi);
  onBeforeSave(() => { flushFog(); state.stats.charted = chartedPercent(); });
  on('enter_dungeon', (e) => {
    discoverDungeon(e.id, 'enter', true);
    state.flags[`dungeon_entered:${e.id}`] = true;
    ver++;
  });
  on('dungeon_clear', (e) => {
    discoverDungeon(e.id, 'clear', true);
    state.flags[`dungeon_clear:${e.id}`] = true;
    ver++;
  });
  on('search', () => {
    const [x, z] = lastPos;
    for (const d of DUNGEONS) {
      if (d.hidden && d.reveal === 'search' && !dungeonFound(d.id) && Math.hypot(d.entrance[0] - x, d.entrance[1] - z) < SEARCH_REVEAL) discoverDungeon(d.id, 'search');
    }
  });
  on('item_get', (e) => { for (const [id, item] of Object.entries(REVEAL_ITEM)) if (e.item === item) discoverDungeon(id, 'item'); });
  on('gate_open', () => { ver++; });
  on('boss_win', () => { ver++; });
}
