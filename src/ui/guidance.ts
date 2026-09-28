// Guidance data shared by the tracker, compass, minimap, world map and 3D beacon: where the tracked
// objective is, every marker the content and world systems publish, and bearing/distance maths.
import { api, type Marker, type MarkerKind, type QuestView } from '../game/contracts';

/** Compass bearing in degrees (0 = north = −z, clockwise) from (px,pz) to (x,z). */
export const bearingTo = (px: number, pz: number, x: number, z: number) => ((Math.atan2(x - px, -(z - pz)) * 180) / Math.PI + 360) % 360;
/** Camera heading in compass degrees (the camera looks along (−sin yaw, −cos yaw)). */
export const headingOf = (camYaw: number) => ((((-camYaw * 180) / Math.PI) % 360) + 360) % 360;
export const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
export const distText = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.max(1, Math.round(m))} m`);
export const cardinal = (deg: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];

export interface MarkerStyle { icon: string; glyph?: boolean; color: string; ink: string; label: string; compass: number; prio: number }
/** Visual language per marker kind. `compass` = max distance (m) at which the compass shows it. */
export const MARKER_STYLE: Record<MarkerKind, MarkerStyle> = {
  quest: { icon: 'diamond', glyph: true, color: '#ff3d8b', ink: '#06080c', label: 'Quest objective', compass: 3000, prio: 10 },
  'quest-turnin': { icon: 'check', glyph: true, color: '#ffc83d', ink: '#06080c', label: 'Turn in', compass: 3000, prio: 9 },
  'quest-available': { icon: 'bang', glyph: true, color: '#ffc83d', ink: '#06080c', label: 'New quest', compass: 500, prio: 8 },
  boss: { icon: 'skull', color: '#ff5b4f', ink: '#06080c', label: 'Guardian / Alpha', compass: 700, prio: 7 },
  dungeon: { icon: 'portal', color: '#a983ff', ink: '#06080c', label: 'Dungeon', compass: 500, prio: 6 },
  gate: { icon: 'lock', color: '#ffb03a', ink: '#06080c', label: 'Warden Gate (sealed)', compass: 600, prio: 5 },
  'gate-open': { icon: 'key', color: '#58e08a', ink: '#06080c', label: 'Warden Gate (open)', compass: 600, prio: 5 },
  town: { icon: 'house_base', color: '#f7f3ea', ink: '#06080c', label: 'Town', compass: 1200, prio: 4 },
  waystone: { icon: 'waypoint_obelisk', color: '#6febd8', ink: '#06080c', label: 'Waystone', compass: 450, prio: 4 },
  camp: { icon: 'campfire', color: '#ff9a5c', ink: '#06080c', label: 'Expedition camp', compass: 400, prio: 3 },
  homestead: { icon: 'hammer_build', color: '#58e08a', ink: '#06080c', label: 'Homestead', compass: 400, prio: 3 },
  poi: { icon: 'star', glyph: true, color: '#dcd6cb', ink: '#06080c', label: 'Point of interest', compass: 300, prio: 2 },
  chest: { icon: 'chest', color: '#ffc83d', ink: '#06080c', label: 'Chest', compass: 90, prio: 2 },
  shop: { icon: 'backpack', color: '#6cc6ff', ink: '#06080c', label: 'Shop', compass: 110, prio: 1 },
  service: { icon: 'heart', color: '#ff79ae', ink: '#06080c', label: 'Town service', compass: 110, prio: 1 },
  npc: { icon: 'user_profile', color: '#dcd6cb', ink: '#06080c', label: 'Villager', compass: 70, prio: 0 },
};

let cache: { qv: number; wv: number; markers: Marker[] } = { qv: -1, wv: -1, markers: [] };
/** Every marker from the quest and world APIs (cheap: rebuilt only when either version bumps). */
export function allMarkers(): Marker[] {
  const qv = safe(() => api.quests.version(), 0), wv = safe(() => api.world.version(), 0);
  if (qv !== cache.qv || wv !== cache.wv) {
    const q = safe(() => api.quests.markers(), [] as Marker[]);
    const w = safe(() => api.world.markers(), [] as Marker[]);
    const seen = new Set<string>();
    const out: Marker[] = [];
    for (const m of [...q, ...w]) {
      const key = `${m.kind}:${m.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
    out.sort((a, b) => MARKER_STYLE[a.kind].prio - MARKER_STYLE[b.kind].prio);
    cache = { qv, wv, markers: out };
  }
  return cache.markers;
}

/** The tracked quest and the marker it points at (its `target`, else a beacon marker). */
export function trackedTarget(): { quest: QuestView | null; marker: Marker } | null {
  const q = safe(() => api.quests.tracked(), null);
  if (q?.target) return { quest: q, marker: q.target };
  const b = allMarkers().find((m) => m.beacon);
  return b ? { quest: q, marker: b } : null;
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn() ?? fallback; } catch { return fallback; }
}
