// The designed island: everything the generator must honour, derived from src/data/layout.ts and
// src/data/zones.ts plus the hand-authored terrain intent (land profiles, coastline, rivers, lakes).
// Coordinates: metres, x east, z south; bearing = compass degrees from north (−z), clockwise.

import { ZONES, WATER_LEVEL, HOMESTEAD, START_POS } from '../../src/data/zones';
import { ISLAND, SPURS, GATES, DUNGEONS, POIS } from '../../src/data/layout';
import { clamp, smooth } from './noise';

export { ZONES, WATER_LEVEL, HOMESTEAD, START_POS, ISLAND, SPURS, GATES, DUNGEONS, POIS };

export const SEA = WATER_LEVEL;
export const MC = ISLAND.mountain.center; // Mount Aether centre
export const PLATEAU_R = ISLAND.mountain.plateauRadius;
export const SUMMIT_H = ISLAND.mountain.summitHeight;

export const RAD = Math.PI / 180;
export const bearingOf = (x: number, z: number) => ((Math.atan2(x, -z) / RAD) + 360) % 360;
/** Signed angular difference a − b in (−180, 180]. */
export const angDiff = (a: number, b: number) => { let d = (a - b) % 360; if (d > 180) d -= 360; if (d <= -180) d += 360; return d; };
export const dirOf = (b: number): [number, number] => [Math.sin(b * RAD), -Math.cos(b * RAD)];

/** Zone index by id (the region id stored in the baked fields). */
export const ZI: Record<string, number> = Object.fromEntries(ZONES.map((z, i) => [z.id, i]));
export const SEA_REGION = 255;

/** The nine ring lands, by wedge bearing. */
export const RING = ZONES.filter((z) => z.bearing >= 0).sort((a, b) => a.bearing - b.bearing);

// ── Land elevation profiles (metres): at the coast shelf, at the ring road (r = 560) and at the
// mountain foot. Character noise is added on top in shape.ts.
export interface LandProfile { coast: number; ring: number; foot: number; cliff: number; cliffH: number }
export const PROFILE: Record<string, LandProfile> = {
  hollows: { coast: 26, ring: 52, foot: 74, cliff: 0.85, cliffH: 26 },
  dunes: { coast: 2.2, ring: 15, foot: 26, cliff: 0.08, cliffH: 8 },
  scar: { coast: 11, ring: 24, foot: 36, cliff: 0.7, cliffH: 12 },
  coast: { coast: 3, ring: 17, foot: 28, cliff: 0.35, cliffH: 16 },
  vale: { coast: 2.4, ring: 19, foot: 31, cliff: 0.12, cliffH: 10 },
  lakes: { coast: 4, ring: 21, foot: 34, cliff: 0.45, cliffH: 9 },
  marsh: { coast: 0.2, ring: 2.2, foot: 12, cliff: 0, cliffH: 3 },
  elder: { coast: 8, ring: 30, foot: 42, cliff: 0.5, cliffH: 12 },
  peaks: { coast: 34, ring: 70, foot: 96, cliff: 1, cliffH: 34 },
  summit: { coast: 0, ring: 0, foot: 0, cliff: 0, cliffH: 0 },
};

// ── Coastline: mean radius + noise + designed coves/headlands (evaluated per bearing) ─────────
export interface CoastBump { bearing: number; width: number; delta: number }
/** Negative delta = bay, positive = headland (metres of radius at the bump centre). */
export const COAST_BUMPS: CoastBump[] = [
  { bearing: 178, width: 7, delta: 48 },   // Vale Beacon headland
  { bearing: 190, width: 9, delta: -34 },  // Old Grove cove
  { bearing: 137, width: 6, delta: 42 },   // Sapphire peninsula tip (Bellreef, grotto)
  { bearing: 151, width: 4.2, delta: -215 }, // Tidewatch harbour bay
  { bearing: 123.5, width: 3.2, delta: -62 }, // Smuggler's cove (east of the peninsula)
  { bearing: 98, width: 8, delta: 36 },    // Ember caldera headland
  { bearing: 64, width: 10, delta: -40 },  // Sunscorch bay
  { bearing: 250, width: 12, delta: -46 }, // Mistveil mudflat bight
  { bearing: 232, width: 7, delta: 30 },   // Lakes point
  { bearing: 20, width: 7, delta: 34 },    // Hollows cape
  { bearing: 330, width: 9, delta: -30 },  // Peaks fjord mouth
  { bearing: 300, width: 8, delta: 26 },   // Elder bluff
];

/** Harbour basins carved out of the land (circle + channel to the open sea). */
export const HARBOURS: { id: string; x: number; z: number; r: number; channelTo: [number, number]; channelW: number; depth: number }[] = [
  { id: 'tidewatch_harbour', x: 364, z: 562, r: 40, channelTo: [318, 660], channelW: 46, depth: 6 },
];

// ── Features that need flat pads ────────────────────────────────────────────────────────────
export type PadKind = 'town' | 'outpost' | 'camp' | 'arena' | 'homestead' | 'poi' | 'dungeon' | 'gate' | 'plateau' | 'start';
export interface Pad {
  id: string; kind: PadKind; x: number; z: number;
  /** Flat core radius (m). */
  r: number;
  /** Blend skirt width (m). */
  blend: number;
  /** Plaza radius (towns/outposts). */
  plaza?: number;
  /** Cave-type entrances get a rock face behind them, facing this bearing (the approach). */
  face?: number;
  region: string;
  /** Forced level (m); otherwise chosen from the terrain. */
  level?: number;
  /** Pads sharing a group key are levelled together. */
  group?: string;
}

const zoneOfId = (id: string) => ZONES.find((z) => z.id === id)!;

export function buildPads(): Pad[] {
  const pads: Pad[] = [];
  for (const z of ZONES) {
    const t = z.town;
    const isTown = t.kind === 'town';
    const r = z.id === 'vale' ? 58 : isTown ? 50 : 35;
    pads.push({ id: t.id, kind: isTown ? 'town' : 'outpost', x: t.pos[0], z: t.pos[1], r, blend: isTown ? 30 : 24, plaza: isTown ? (z.id === 'vale' ? 20 : 17) : 12, region: z.id, group: z.id === 'summit' ? 'crown' : undefined });
    pads.push({ id: `${z.id}_camp`, kind: 'camp', x: z.camp[0], z: z.camp[1], r: 12, blend: 14, region: z.id, group: z.id === 'summit' ? 'crown' : undefined });
    pads.push({ id: `${z.id}_arena`, kind: 'arena', x: z.boss.pos[0], z: z.boss.pos[1], r: z.id === 'summit' ? 30 : 26, blend: 18, region: z.id });
  }
  pads.push({ id: 'homestead', kind: 'homestead', x: HOMESTEAD.center[0], z: HOMESTEAD.center[1], r: HOMESTEAD.radius + 3, blend: 18, region: 'vale' });
  for (const p of POIS) {
    const r = p.kind === 'ruin' ? 18 : p.kind === 'lighthouse' ? 14 : p.kind === 'grove' ? 16 : p.kind === 'oasis' ? 10 : p.kind === 'mine' ? 12 : 10;
    if (p.id === 'p_ruins') continue; // the summit plateau is its own pad
    pads.push({ id: p.id, kind: 'poi', x: p.pos[0], z: p.pos[1], r, blend: 14, region: p.region });
  }
  const CAVE = new Set(['burrow', 'grotto', 'crypt', 'forge', 'ice', 'geode', 'starfall', 'chapel']);
  for (const d of DUNGEONS) {
    if (d.id === 'd_crown') continue; // under the summit ruins (plateau pad)
    // approach bearing: towards the nearest town of its land
    const zn = zoneOfId(d.region);
    const face = (Math.atan2(zn.town.pos[0] - d.entrance[0], -(zn.town.pos[1] - d.entrance[1])) / RAD + 360) % 360;
    pads.push({ id: d.id, kind: 'dungeon', x: d.entrance[0], z: d.entrance[1], r: 9, blend: 12, face: CAVE.has(d.theme) ? face : undefined, region: d.region });
  }
  for (const g of GATES) {
    if (g.id === 'g_crown') { pads.push({ id: g.id, kind: 'gate', x: g.pos[0], z: g.pos[1], r: 13, blend: 10, region: 'vale' }); continue; }
    pads.push({ id: g.id, kind: 'gate', x: g.pos[0], z: g.pos[1], r: 11, blend: 8, region: g.joins[0] });
  }
  pads.push({ id: 'summit_plateau', kind: 'plateau', x: MC[0], z: MC[1], r: PLATEAU_R, blend: 14, region: 'summit', level: SUMMIT_H });
  pads.push({ id: 'start', kind: 'start', x: START_POS[0], z: START_POS[1], r: 8, blend: 10, region: 'vale' });
  return pads;
}

// ── Rivers (designed courses; the generator carves beds and computes surfaces) ────────────────
export interface RiverDef {
  id: string; name: string; region: string;
  /** Control points from source to mouth. */
  pts: [number, number][];
  /** Width at source and mouth (m). */
  w0: number; w1: number;
  /** Indices of control points where a waterfall drops (surface discontinuity). */
  falls?: number[];
  /** Ends in a lake (id) instead of the sea. */
  toLake?: string;
  lava?: boolean;
}

// ── Lakes (designed basins; levels are resolved from the terrain unless given) ────────────────
export interface LakeDef {
  id: string; name: string; region: string; x: number; z: number; rx: number; rz: number; rot: number;
  depth: number; level?: number; kind: 'lake' | 'pool' | 'frozen' | 'lava' | 'oasis' | 'marsh';
}

export const sm = smooth;
export const cl = clamp;

/**
 * Rivers: control points from the plunge pool at the foot of the mountain's rampart (or a lake)
 * to the sea / a lake. `fallFrom` marks rivers born as a waterfall off the rampart.
 */
export const RIVERS: RiverDef[] = [
  { id: 'brightwater', name: 'Brightwater', region: 'vale', w0: 5, w1: 10,
    pts: [[70, 268], [76, 340], [86, 420], [96, 482], [90, 535], [74, 586], [68, 640], [80, 700], [74, 760], [88, 800], [104, 850], [112, 896]] },
  { id: 'willowbrook', name: 'Willowbrook', region: 'vale', w0: 4, w1: 7,
    pts: [[-56, 274], [-66, 348], [-84, 430], [-104, 515], [-116, 596], [-104, 676], [-84, 740], [-70, 820], [-62, 890]] },
  { id: 'stillrun', name: 'Stillwater Run', region: 'lakes', w0: 5, w1: 8, toLake: 'mirror',
    pts: [[-212, 238], [-246, 290], [-300, 332], [-392, 344], [-446, 398], [-468, 452], [-470, 478]] },
  { id: 'silverrun', name: 'Silver Run', region: 'lakes', w0: 7, w1: 10, falls: [2],
    pts: [[-486, 536], [-492, 566], [-497, 590], [-500, 612], [-512, 648], [-538, 688], [-560, 726]] },
  { id: 'saltbrook', name: 'Saltbrook', region: 'coast', w0: 5, w1: 9,
    pts: [[182, 214], [214, 264], [250, 330], [284, 400], [300, 468], [318, 522], [346, 560]] },
  { id: 'mistwind', name: 'Mistwind', region: 'marsh', w0: 6, w1: 14,
    pts: [[-292, 24], [-352, 44], [-420, 60], [-478, 96], [-506, 152], [-560, 190], [-630, 206], [-690, 246], [-760, 256], [-830, 236], [-905, 222]] },
  { id: 'rootwater', name: 'Rootwater', region: 'elder', w0: 5, w1: 10,
    pts: [[-270, -168], [-330, -188], [-396, -190], [-462, -200], [-540, -214], [-618, -236], [-700, -262], [-780, -290], [-866, -312]] },
  { id: 'frostmelt', name: 'Frostmelt', region: 'peaks', w0: 5, w1: 9,
    pts: [[-278, -694], [-300, -732], [-326, -776], [-348, -826], [-364, -878]] },
  { id: 'emberflow', name: 'Emberflow', region: 'scar', w0: 5, w1: 7, lava: true,
    pts: [[838, 104], [872, 104], [904, 114], [944, 128]] },
];

export const LAKES: LakeDef[] = [
  // Mirror Lakes
  { id: 'mirror', name: 'The Mirror', region: 'lakes', x: -476, z: 504, rx: 50, rz: 38, rot: 0.3, depth: 5, kind: 'lake' },
  { id: 'silverpool', name: 'Silverfall Pool', region: 'lakes', x: -502, z: 626, rx: 24, rz: 20, rot: 0, depth: 4, kind: 'lake' },
  { id: 'tarn', name: 'Highwater Tarn', region: 'lakes', x: -250, z: 300, rx: 30, rz: 24, rot: 0.8, depth: 3, kind: 'lake' },
  { id: 'pinelake', name: 'Pinewater', region: 'lakes', x: -300, z: 560, rx: 34, rz: 26, rot: -0.4, depth: 3.5, kind: 'lake' },
  { id: 'reedmere', name: 'Reedmere', region: 'lakes', x: -560, z: 404, rx: 36, rz: 26, rot: 0.9, depth: 2.5, kind: 'lake' },
  { id: 'abyss', name: 'The Abyss', region: 'lakes', x: -636, z: 596, rx: 40, rz: 34, rot: 0.2, depth: 9, kind: 'lake' },
  { id: 'glasstarn', name: 'Glass Tarn', region: 'lakes', x: -410, z: 610, rx: 20, rz: 16, rot: 0, depth: 2.5, kind: 'lake' },
  { id: 'hilltarn', name: 'Hill Tarn', region: 'lakes', x: -380, z: 700, rx: 22, rz: 18, rot: 1.1, depth: 2.5, kind: 'lake' },
  // Verdant Vale
  { id: 'millpond', name: 'Millpond', region: 'vale', x: -40, z: 700, rx: 20, rz: 15, rot: 0.5, depth: 2, kind: 'lake' },
  // Mistveil Marsh pools (shallow, murky)
  { id: 'mire1', name: 'Blackwater', region: 'marsh', x: -700, z: 90, rx: 34, rz: 24, rot: 0.4, depth: 1.6, kind: 'marsh' },
  { id: 'mire2', name: 'Glowmire', region: 'marsh', x: -620, z: 30, rx: 28, rz: 20, rot: -0.6, depth: 1.4, kind: 'marsh' },
  { id: 'mire3', name: 'Sunken Pool', region: 'marsh', x: -760, z: 190, rx: 26, rz: 22, rot: 0.2, depth: 1.4, kind: 'marsh' },
  { id: 'mire4', name: 'Hushwater', region: 'marsh', x: -500, z: 20, rx: 22, rz: 16, rot: 1.2, depth: 1.2, kind: 'marsh' },
  { id: 'mire5', name: 'Lanternpool', region: 'marsh', x: -610, z: 230, rx: 24, rz: 18, rot: -0.3, depth: 1.3, kind: 'marsh' },
  // Ember Scar lava
  { id: 'caldera_lava', name: 'The Crucible', region: 'scar', x: 824, z: 104, rx: 22, rz: 18, rot: 0.4, depth: 2, kind: 'lava' },
  { id: 'lava2', name: 'Cinder Pool', region: 'scar', x: 640, z: 176, rx: 14, rz: 11, rot: 0.3, depth: 1.5, kind: 'lava' },
  { id: 'lava3', name: 'Slag Pool', region: 'scar', x: 612, z: 10, rx: 12, rz: 10, rot: 0, depth: 1.5, kind: 'lava' },
  { id: 'lava4', name: 'Emberwell', region: 'scar', x: 820, z: 250, rx: 15, rz: 12, rot: -0.7, depth: 1.5, kind: 'lava' },
  // Elderwood
  { id: 'elderspring', name: 'Rootspring', region: 'elder', x: -560, z: -372, rx: 16, rz: 13, rot: 0.3, depth: 2, kind: 'lake' },
  { id: 'fernmere', name: 'Fernmere', region: 'elder', x: -398, z: -252, rx: 26, rz: 20, rot: -0.2, depth: 2.5, kind: 'lake' },
  // Sunscorch Dunes
  { id: 'oasis', name: 'Last Oasis', region: 'dunes', x: 546, z: -238, rx: 20, rz: 16, rot: 0.6, depth: 2.2, kind: 'oasis' },
  // Stormreach Peaks: frozen lakes
  { id: 'frost1', name: 'Frostglass', region: 'peaks', x: -108, z: -664, rx: 28, rz: 20, rot: 0.3, depth: 3, kind: 'frozen' },
  { id: 'frost2', name: 'Stormeye', region: 'peaks', x: -262, z: -770, rx: 22, rz: 17, rot: -0.5, depth: 3, kind: 'frozen' },
  { id: 'frost3', name: 'Rimewater', region: 'peaks', x: -130, z: -470, rx: 18, rz: 14, rot: 1, depth: 2.5, kind: 'frozen' },
  // Glimmer Hollows
  { id: 'glimtarn', name: 'Glimmer Tarn', region: 'hollows', x: 128, z: -650, rx: 20, rz: 15, rot: 0.2, depth: 3, kind: 'lake' },
];

/** Where each river is born as a waterfall off Mount Aether's rampart. */
export const RAMPART_FALLS = ['brightwater', 'willowbrook', 'stillrun', 'saltbrook', 'mistwind', 'rootwater'];

/** Special terrain features (carved after erosion). */
export const SALT_FLAT = { x: 700, z: -196, rx: 78, rz: 50, rot: 0.5, level: 7.5 };
export const ELDER_HOLLOW = { x: -600, z: -338, r: 58, depth: 9 };
export const GLACIER = { pts: [[-214, -312], [-256, -420], [-290, -520], [-300, -600], [-298, -650]] as [number, number][], width: 64, snout: [-298, -660] as [number, number] };
export const CALDERA_DEF = { x: 800, z: 76, rimR: 90, floorR: 66, rimH: 34, gap: 272, lavaGap: 100 };
