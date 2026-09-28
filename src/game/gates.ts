// Warden Gates: which passes are open, which lands are reachable, and the moment a gate opens.
// Gate state comes from Guardian wins per GATES[].unlock (all, or any), plus gates a quest or the
// v2 save migration forced open. The world barriers live in src/world/gates.ts.
import { GATES, type GateDef } from '../data/layout';
import { ZONES, zoneById } from '../data/zones';
import { SPECIES } from '../data/species';
import { ITEMS, SIGILS } from '../data/items';
import { state, addItem, itemCount, bump } from './state';
import { emit, on } from './events';
import { notify } from './rewards';

export const gateById = (id: string) => GATES.find((g) => g.id === id);
const guardianName = (zone: string) => SPECIES[zoneById(zone)?.boss.species ?? '']?.name ?? 'the Guardian';
const landName = (zone: string) => ZONES.find((z) => z.id === zone)?.name ?? zone;

export function gateOpen(id: string): boolean {
  const g = gateById(id);
  if (!g) return false;
  if (state.story.gatesForced.includes(id)) return true;
  const b = state.bosses;
  return g.unlock.any ? g.unlock.bosses.some((x) => b.includes(x)) : g.unlock.bosses.every((x) => b.includes(x));
}

let cacheKey = '';
let cacheSet = new Set<string>(['vale']);
/** Lands reachable on foot: the Vale, plus everything connected to it through open gates. */
export function reachableRegions(): Set<string> {
  const key = `${state.bosses.join(',')}|${state.story.gatesForced.join(',')}`;
  if (key === cacheKey) return cacheSet;
  const out = new Set<string>(['vale']);
  for (let grew = true; grew;) {
    grew = false;
    for (const g of GATES) {
      if (!gateOpen(g.id)) continue;
      const [a, b] = g.joins;
      if (out.has(a) && !out.has(b)) { out.add(b); grew = true; }
      if (out.has(b) && !out.has(a)) { out.add(a); grew = true; }
    }
  }
  cacheKey = key;
  cacheSet = out;
  return out;
}
export const regionUnlocked = (region: string) => reachableRegions().has(region);

/** What still seals a gate, in words. */
export function sealText(g: GateDef): string {
  const missing = g.unlock.bosses.filter((b) => !state.bosses.includes(b));
  if (g.id === 'g_crown') return `Nine sockets ring the door; ${9 - missing.length} hold a sigil. Answer every Guardian to open the Crown Gate.`;
  if (g.unlock.any) return `Answer ${missing.map(guardianName).join(' or ')} to kindle ${g.name}.`;
  return `Answer ${missing.map(guardianName).join(' and ')} of ${missing.map(landName).join(' and ')} to open ${g.name}.`;
}

/** How to reach a locked land. */
export function lockHint(region: string): string | undefined {
  if (regionUnlocked(region)) return undefined;
  const reach = reachableRegions();
  const doors = GATES.filter((g) => g.joins.includes(region) && g.joins.some((j) => j !== region && reach.has(j)));
  if (doors.length) return doors.map(sealText).join(' Or: ');
  if (region === 'summit') return 'Collect all nine Guardian sigils to open the Crown Gate north of Hearthwick.';
  return `Open the lands next to ${landName(region)} first.`;
}

/** The open (or nearest sealed) gate that leads into `region` from somewhere reachable. */
export function gateInto(region: string): GateDef | undefined {
  const reach = reachableRegions();
  const doors = GATES.filter((g) => g.joins.includes(region) && g.joins.some((j) => j !== region && reach.has(j)));
  return doors.find((g) => gateOpen(g.id)) ?? doors[0];
}

/** Record newly opened gates and announce them. Returns the ids that just opened. */
export function syncGates(): string[] {
  const fresh: string[] = [];
  for (const g of GATES) {
    if (!gateOpen(g.id) || state.story.gatesOpen.includes(g.id)) continue;
    state.story.gatesOpen.push(g.id);
    fresh.push(g.id);
  }
  for (const id of fresh) {
    bump('gates');
    notify(`<b>${gateById(id)!.name}</b> is open — ${landName(gateById(id)!.joins[1])} awaits.`, 'good');
    emit('gate_open', { id });
  }
  return fresh;
}

/** Quests can force a gate (story beats, debugging). */
export function forceGate(id: string) {
  if (!gateById(id) || state.story.gatesForced.includes(id)) return;
  state.story.gatesForced.push(id);
  syncGates();
}

/** The gate-opening moment has been shown in the world. */
export function markGateSeen(id: string) { if (!state.story.gatesSeen.includes(id)) state.story.gatesSeen.push(id); }
export const gateSeen = (id: string) => state.story.gatesSeen.includes(id);

let wired = false;
export function initGates() {
  if (wired) return;
  wired = true;
  on('boss_win', (e) => {
    const sigil = SIGILS[e.zone];
    if (sigil && itemCount(sigil) < 1) {
      addItem(sigil, 1);
      notify(`Received the <b>${ITEMS[sigil].name}</b>.`, 'loot');
    }
    syncGates();
  });
  // Opened gates the save already knows about stay quiet (no replayed announcements).
  for (const g of GATES) if (gateOpen(g.id) && !state.story.gatesOpen.includes(g.id)) state.story.gatesOpen.push(g.id);
}
