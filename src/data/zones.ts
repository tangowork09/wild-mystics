// The ten lands of Wild Mystics (v3). The island is a ring of eight lands around Mount Aether;
// its spurs divide the lands and each pass is sealed by a Warden Gate (see layout.ts) until the
// neighbouring Guardian is answered. The Aether Crown on the summit is the final land.
//
// Coordinates: metres, x → east, z → south (north is −z, the top of the map). Bearing = compass
// degrees from north, clockwise. See docs/v3/PLAN.md for the full layout and ownership rules.
//
// Every land has its own terrain recipe, palette, weather, flora, music and its own Mystics
// (spawn tables live in spawns.ts).

import { SPAWNS, WILD_COUNT, type Spawn, type SpawnMethod } from './spawns';

export type { Spawn, SpawnMethod };
export type Weather = 'pollen' | 'mist' | 'embers' | 'snow' | 'spores' | 'sand' | 'spray' | 'fireflies' | 'glimmer' | 'aether';
export type FloraKey = 'tree_round' | 'tree_pine' | 'tree_dead' | 'tree_twisted' | 'tree_crystal' | 'rock' | 'boulder' | 'bush' | 'fern' | 'mushroom' | 'flowers' | 'pebbles' | 'log' | 'cactus' | 'reeds';

export interface Zone {
  id: string;
  name: string;
  subtitle: string;
  lore: string;
  /** Compass bearing of the land's wedge around Mount Aether (summit: -1). */
  bearing: number;
  /** Progression tier: 1 start, 2–5 ring lands, 6 the Crown. */
  tier: number;
  /** Voronoi center in world XZ. */
  center: [number, number];
  levels: [number, number];
  spawns: Spawn[];
  wildCount: number;
  /** Terrain colours: low ground, high ground, accent patches. */
  ground: [string, string, string];
  fog: string;
  sky: { turbidity: number; rayleigh: number; azimuth: number };
  terrain: { base: number; ridges: number; mesas: number; lakes: number; dunes: number; pools: number };
  flora: Partial<Record<FloraKey, number>>;
  grass: string;
  tallGrass: string;
  particles: string;
  weather: Weather;
  music: string;
  boss: { species: string; level: number; pos: [number, number]; adds: string[] };
  /** Expedition flag: rest + save + fast-travel point next to the guardian arena. */
  camp: [number, number];
  town: { id: string; name: string; pos: [number, number]; kind: 'town' | 'outpost' };
  water: { shallow: string; deep: string; lava?: boolean };
}

export const WORLD_SIZE = 2048;
export const WATER_LEVEL = -1.2;

type ZoneDef = Omit<Zone, 'spawns' | 'wildCount'>;

const DEFS: ZoneDef[] = [
  {
    id: 'vale', name: 'Verdant Vale', subtitle: 'Where every journey begins', bearing: 180, tier: 1,
    lore: 'Rolling meadows, sun-dappled groves and the hearth-town of Hearthwick at the foot of Mount Aether. Young Mystics play in the tall grass here, and Thornjaw Rex guards the Old Grove by the sea.',
    center: [0, 640], levels: [2, 8],
    ground: ['#6aa546', '#9cc866', '#d6ca78'], fog: '#cfe2d6', sky: { turbidity: 3.5, rayleigh: 1.3, azimuth: 150 },
    terrain: { base: 1, ridges: 0, mesas: 0, lakes: 0.45, dunes: 0, pools: 0 },
    flora: { tree_round: 1200, tree_pine: 180, tree_twisted: 150, rock: 350, boulder: 80, bush: 1100, fern: 900, mushroom: 320, flowers: 1400, pebbles: 380, log: 100 },
    grass: '#7ab84a', tallGrass: '#5f9a3a', particles: '#fff3b0', weather: 'pollen', music: 'overworld',
    boss: { species: 'thornjaw', level: 9, pos: [-150, 790], adds: ['spikegloop'] }, camp: [-122, 762],
    town: { id: 'hearthwick', name: 'Hearthwick', pos: [0, 540], kind: 'town' }, water: { shallow: '#5fc8c0', deep: '#1f5a78' },
  },
  {
    id: 'lakes', name: 'Mirror Lakes', subtitle: 'Still waters, restless depths', bearing: 220, tier: 2,
    lore: 'A hundred mirror-still lakes under pine and mist. Water Mystics bask on the shores, and the Abyssal Tyrant waits beneath the deepest one.',
    center: [-386, 460], levels: [8, 13],
    ground: ['#5c9a72', '#98c49a', '#e2e8c8'], fog: '#c6dfe8', sky: { turbidity: 3, rayleigh: 1, azimuth: 120 },
    terrain: { base: 0.7, ridges: 0, mesas: 0, lakes: 1.1, dunes: 0, pools: 0 },
    flora: { tree_round: 350, tree_pine: 1300, tree_twisted: 100, rock: 400, boulder: 80, bush: 750, fern: 750, mushroom: 320, flowers: 650, pebbles: 380, log: 120, reeds: 800 },
    grass: '#74b87e', tallGrass: '#4f9a6e', particles: '#bff0ff', weather: 'mist', music: 'overworld',
    boss: { species: 'abyssal_tyrant', level: 14, pos: [-594, 535], adds: ['glub', 'croakus'] }, camp: [-560, 518],
    town: { id: 'stillwater', name: 'Stillwater', pos: [-360, 429], kind: 'town' }, water: { shallow: '#6fe0d8', deep: '#123e6a' },
  },
  {
    id: 'coast', name: 'Sapphire Coast', subtitle: 'Salt wind and sunken bells', bearing: 140, tier: 2,
    lore: 'White sand coves, sea stacks and tide pools below the lighthouse port of Tidewatch. Shell-backed Mystics scuttle at low tide, and something vast sings beneath the reef.',
    center: [386, 460], levels: [8, 13],
    ground: ['#79b46a', '#b8d890', '#efe2b0'], fog: '#cfeaf0', sky: { turbidity: 2.6, rayleigh: 1.2, azimuth: 110 },
    terrain: { base: 0.65, ridges: 0, mesas: 0.2, lakes: 0.25, dunes: 0.3, pools: 0 },
    flora: { tree_round: 300, tree_pine: 250, rock: 600, boulder: 160, bush: 600, fern: 300, flowers: 700, pebbles: 500, log: 120, reeds: 200 },
    grass: '#86c25a', tallGrass: '#62a044', particles: '#e8fbff', weather: 'spray', music: 'overworld',
    boss: { species: 'deepcaller', level: 14, pos: [617, 555], adds: ['clacker', 'whirlie'] }, camp: [585, 538],
    town: { id: 'tidewatch', name: 'Tidewatch', pos: [386, 460], kind: 'town' }, water: { shallow: '#5fe0e8', deep: '#0f4f86' },
  },
  {
    id: 'marsh', name: 'Mistveil Marsh', subtitle: 'Where the fog remembers names', bearing: 260, tier: 3,
    lore: 'Sunken boardwalks, glowing spores and pools that swallow sound. Void Mystics drift here after dark, and the Bog Sovereign rules the reeds.',
    center: [-591, 104], levels: [13, 18],
    ground: ['#4f6a44', '#7a8a58', '#9aa86a'], fog: '#a8b8a0', sky: { turbidity: 8, rayleigh: 0.8, azimuth: 60 },
    terrain: { base: 0.35, ridges: 0, mesas: 0, lakes: 0.4, dunes: 0, pools: 1 },
    flora: { tree_twisted: 400, tree_dead: 220, tree_round: 150, mushroom: 800, fern: 700, bush: 400, reeds: 1300, log: 220, rock: 150 },
    grass: '#6a8a4a', tallGrass: '#4a6a36', particles: '#b8ff7a', weather: 'spores', music: 'marsh',
    boss: { species: 'bog_sovereign', level: 19, pos: [-798, 56], adds: ['croakus', 'gloomling'] }, camp: [-760, 62],
    town: { id: 'mirehaven', name: 'Mirehaven', pos: [-551, 97], kind: 'outpost' }, water: { shallow: '#7a9a5a', deep: '#1f3a2a' },
  },
  {
    id: 'scar', name: 'Ember Scar', subtitle: 'Ash, obsidian and old fire', bearing: 100, tier: 3,
    lore: 'A wound in the land that never cooled. Lava pools glow between charred mesas, and the Ashen Totem hums in the heat haze of the caldera.',
    center: [591, 104], levels: [13, 18],
    ground: ['#7a5444', '#a8785a', '#d8683e'], fog: '#dcae94', sky: { turbidity: 7, rayleigh: 2.4, azimuth: 200 },
    terrain: { base: 1.4, ridges: 0, mesas: 1, lakes: 0.8, dunes: 0, pools: 0 },
    flora: { tree_dead: 750, tree_twisted: 170, tree_crystal: 80, rock: 600, boulder: 220, bush: 150, pebbles: 550, log: 80 },
    grass: '#b8905a', tallGrass: '#9a6a3a', particles: '#ff8a3d', weather: 'embers', music: 'overworld',
    boss: { species: 'ashen_totem', level: 19, pos: [788, 55], adds: ['impling', 'grunt'] }, camp: [750, 62],
    town: { id: 'cinderrest', name: 'Cinderrest', pos: [551, 97], kind: 'town' }, water: { shallow: '#ffb03a', deep: '#c2300a', lava: true },
  },
  {
    id: 'elder', name: 'Elderwood', subtitle: 'The forest that dreams', bearing: 300, tier: 4,
    lore: 'Trees older than the Crown, lantern-moss and glades where the light falls in coins. Elderhollow is built into the roots, and the Elder Stag walks the deepest glade.',
    center: [-520, -300], levels: [18, 23],
    ground: ['#3f7a44', '#6fa860', '#b4d27a'], fog: '#b6d6b8', sky: { turbidity: 4, rayleigh: 1.1, azimuth: 300 },
    terrain: { base: 1.1, ridges: 0.2, mesas: 0, lakes: 0.2, dunes: 0, pools: 0.2 },
    flora: { tree_round: 1500, tree_twisted: 600, tree_pine: 300, mushroom: 900, fern: 1400, bush: 900, flowers: 600, log: 300, rock: 250 },
    grass: '#5ea84a', tallGrass: '#3f8a3a', particles: '#fff6a0', weather: 'fireflies', music: 'overworld',
    boss: { species: 'verdant_rex', level: 24, pos: [-639, -464], adds: ['glenhart', 'thornet'] }, camp: [-610, -440],
    town: { id: 'elderhollow', name: 'Elderhollow', pos: [-485, -280], kind: 'outpost' }, water: { shallow: '#62c8a8', deep: '#16504a' },
  },
  {
    id: 'dunes', name: 'Sunscorch Dunes', subtitle: 'Gold sand over sleeping giants', bearing: 60, tier: 4,
    lore: 'Endless dunes, glassy salt flats and one green oasis. Earth and Storm Mystics weather the sandstorms, and the Sandjaw Colossus sleeps beneath the largest dune.',
    center: [520, -300], levels: [18, 23],
    ground: ['#d8b070', '#ecd29a', '#c88a4a'], fog: '#f0d8b0', sky: { turbidity: 9, rayleigh: 1.6, azimuth: 230 },
    terrain: { base: 0.55, ridges: 0, mesas: 0.3, lakes: 0.18, dunes: 1, pools: 0 },
    flora: { cactus: 650, rock: 450, boulder: 180, tree_dead: 100, pebbles: 500, bush: 100, tree_round: 40 },
    grass: '#c8b070', tallGrass: '#a88a4a', particles: '#ffe0a0', weather: 'sand', music: 'dunes',
    boss: { species: 'sandjaw', level: 24, pos: [647, -470], adds: ['dustclaw', 'dustclaw'] }, camp: [615, -450],
    town: { id: 'sunreach', name: 'Sunreach', pos: [485, -280], kind: 'outpost' }, water: { shallow: '#6fe0c8', deep: '#1a6a7a' },
  },
  {
    id: 'peaks', name: 'Stormreach Peaks', subtitle: 'The sky remembers every storm', bearing: 340, tier: 5,
    lore: 'Frozen lakes, pine ridges and summits that scrape the thunderheads. Only seasoned Wayfarers reach Skyhold, and above it the Stormcrown waits.',
    center: [-205, -564], levels: [23, 28],
    ground: ['#7c7c9c', '#b6b6d0', '#f6f6ff'], fog: '#c0bedc', sky: { turbidity: 6, rayleigh: 0.9, azimuth: 250 },
    terrain: { base: 2.0, ridges: 1, mesas: 0, lakes: 0.35, dunes: 0, pools: 0 },
    flora: { tree_pine: 900, tree_crystal: 200, rock: 750, boulder: 280, bush: 200, pebbles: 500 },
    grass: '#a4a8c8', tallGrass: '#8488b0', particles: '#ffffff', weather: 'snow', music: 'overworld',
    boss: { species: 'stormcrown', level: 29, pos: [-194, -776], adds: ['zapbee', 'shadekin'] }, camp: [-185, -745],
    town: { id: 'skyhold', name: 'Skyhold', pos: [-195, -536], kind: 'town' }, water: { shallow: '#b8e8ff', deep: '#3a5a9a' },
  },
  {
    id: 'hollows', name: 'Glimmer Hollows', subtitle: 'Where the mountain keeps its light', bearing: 20, tier: 5,
    lore: 'Crystal canyons split the northern slopes, humming with trapped lightning. Miners in Glimmerhold dig by crystal-light, and the Geode Colossus sleeps in the brightest vein.',
    center: [205, -564], levels: [23, 28],
    ground: ['#6a6488', '#9a90c0', '#c8f0ff'], fog: '#c8c4e8', sky: { turbidity: 4.5, rayleigh: 1.4, azimuth: 20 },
    terrain: { base: 1.7, ridges: 0.6, mesas: 0.6, lakes: 0.15, dunes: 0, pools: 0 },
    flora: { tree_crystal: 700, tree_pine: 250, rock: 800, boulder: 300, pebbles: 600, bush: 120 },
    grass: '#9ab0c8', tallGrass: '#7a88b8', particles: '#c8f4ff', weather: 'glimmer', music: 'overworld',
    boss: { species: 'dune_titan', level: 29, pos: [194, -776], adds: ['cogling', 'gearbrute'] }, camp: [185, -745],
    town: { id: 'glimmerhold', name: 'Glimmerhold', pos: [195, -536], kind: 'town' }, water: { shallow: '#9ff0ff', deep: '#2a3a8a' },
  },
  {
    id: 'summit', name: 'Aether Crown', subtitle: 'The storm at the top of the world', bearing: -1, tier: 6,
    lore: 'Mount Aether rises from the heart of the island, its summit ringed by the ruins of the Sky Wardens. The storm that wakes the Guardians is born here.',
    center: [0, -40], levels: [28, 35],
    ground: ['#6c7488', '#a8b0c8', '#e8f0ff'], fog: '#c8d0e8', sky: { turbidity: 2.2, rayleigh: 0.7, azimuth: 0 },
    terrain: { base: 2.6, ridges: 1.2, mesas: 0, lakes: 0, dunes: 0, pools: 0 },
    flora: { tree_pine: 500, tree_crystal: 250, rock: 800, boulder: 300, pebbles: 400 },
    grass: '#98a8b8', tallGrass: '#7888a0', particles: '#e8f4ff', weather: 'aether', music: 'overworld',
    boss: { species: 'storm_seraph', level: 35, pos: [0, -60], adds: ['shinobi', 'voltarmor'] }, camp: [0, 150],
    town: { id: 'crowncamp', name: 'Crownfall Camp', pos: [0, 210], kind: 'outpost' }, water: { shallow: '#b8e8ff', deep: '#3a5a9a' },
  },
];

export const ZONES: Zone[] = DEFS.map((d) => ({ ...d, spawns: SPAWNS[d.id] ?? [], wildCount: WILD_COUNT[d.id] ?? 16 }));

/** New journeys begin at Hearthwick's south gate, empty-handed (see PLAN.md → Prologue). */
export const START_POS: [number, number] = [0, 612];

/** The player's buildable homestead plot (Verdant Vale, east of Hearthwick). */
export const HOMESTEAD = { center: [118, 610] as [number, number], radius: 24 };

/** Voronoi weights: each zone's blend weight at a point (sums to 1). */
export function zoneWeights(x: number, z: number): number[] {
  const d = ZONES.map((zn) => Math.hypot(x - zn.center[0], z - zn.center[1]));
  const min = Math.min(...d);
  const w = d.map((di) => Math.exp(-(di - min) / 18));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((wi) => wi / sum);
}

export function zoneAt(x: number, z: number): Zone {
  let best = ZONES[0];
  let bd = Infinity;
  for (const zn of ZONES) {
    const d = Math.hypot(x - zn.center[0], z - zn.center[1]);
    if (d < bd) { bd = d; best = zn; }
  }
  return best;
}

export const zoneById = (id: string) => ZONES.find((z) => z.id === id)!;
export const spawnsBy = (z: Zone, methods: SpawnMethod[]) => z.spawns.filter((s) => methods.includes(s.method));
