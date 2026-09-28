// The six lands of Wild Mystics. Every land has its own terrain recipe, palette, weather, flora,
// music and — most importantly — its own Mystics, split by how you find them:
//   roam   → visible in the open world (you can see and chase them)
//   grass  → only in that land's tall grass (random encounter)
//   search → only by searching glimmering bushes / nests
//   night  → roam or rustle in grass only between dusk and dawn
//   fish   → hooked at that land's fishing spots

export type SpawnMethod = 'roam' | 'grass' | 'search' | 'night' | 'fish';
export interface Spawn { species: string; weight: number; method: SpawnMethod }
export type Weather = 'pollen' | 'mist' | 'embers' | 'snow' | 'spores' | 'sand';
export type FloraKey = 'tree_round' | 'tree_pine' | 'tree_dead' | 'tree_twisted' | 'tree_crystal' | 'rock' | 'boulder' | 'bush' | 'fern' | 'mushroom' | 'flowers' | 'pebbles' | 'log' | 'cactus' | 'reeds';

export interface Zone {
  id: string;
  name: string;
  subtitle: string;
  lore: string;
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
  town: { name: string; pos: [number, number]; kind: 'town' | 'outpost' };
  water: { shallow: string; deep: string; lava?: boolean };
}

export const WORLD_SIZE = 760;
export const WATER_LEVEL = -1.2;

export const ZONES: Zone[] = [
  {
    id: 'vale', name: 'Verdant Vale', subtitle: 'Where every journey begins',
    lore: 'Rolling meadows, sun-dappled groves and the hearth-town of Hearthwick. Young Mystics play in the tall grass here, and Thornjaw Rex guards the old grove.',
    center: [0, 40], levels: [2, 7], wildCount: 18,
    spawns: [
      { species: 'gloop', weight: 3, method: 'roam' }, { species: 'chirpling', weight: 3, method: 'roam' }, { species: 'pecklet', weight: 2, method: 'roam' }, { species: 'hopscotch', weight: 2, method: 'roam' },
      { species: 'trotlet', weight: 2.5, method: 'roam' }, { species: 'moolet', weight: 2.5, method: 'roam' }, { species: 'dozewool', weight: 2, method: 'roam' },
      { species: 'pricklet', weight: 3, method: 'grass' }, { species: 'voltcat', weight: 2, method: 'grass' }, { species: 'sporelet', weight: 0.7, method: 'grass' },
      { species: 'snubbit', weight: 2.5, method: 'grass' }, { species: 'honeybuzz', weight: 2.5, method: 'grass' },
      { species: 'monkroose', weight: 2, method: 'search' }, { species: 'spikegloop', weight: 0.6, method: 'search' },
      { species: 'truffly', weight: 2, method: 'search' }, { species: 'nibblet', weight: 2, method: 'search' }, { species: 'loamstrider', weight: 1, method: 'search' }, { species: 'bullwark', weight: 1, method: 'search' },
      { species: 'wisp', weight: 1, method: 'night' },
      { species: 'gildfin', weight: 3, method: 'fish' }, { species: 'quillpuff', weight: 2, method: 'fish' },
    ],
    ground: ['#6aa546', '#9cc866', '#d6ca78'], fog: '#cfe2d6', sky: { turbidity: 3.5, rayleigh: 1.3, azimuth: 150 },
    terrain: { base: 1, ridges: 0, mesas: 0, lakes: 0.55, dunes: 0, pools: 0 },
    flora: { tree_round: 480, tree_pine: 70, tree_twisted: 60, rock: 140, boulder: 30, bush: 440, fern: 360, mushroom: 130, flowers: 560, pebbles: 150, log: 40 },
    grass: '#7ab84a', tallGrass: '#5f9a3a', particles: '#fff3b0', weather: 'pollen', music: 'overworld',
    boss: { species: 'thornjaw', level: 8, pos: [-85, 128], adds: ['spikegloop'] }, camp: [-62, 108],
    town: { name: 'Hearthwick', pos: [0, 72], kind: 'town' }, water: { shallow: '#5fc8c0', deep: '#1f5a78' },
  },
  {
    id: 'lakes', name: 'Mirror Lakes', subtitle: 'Still waters, restless depths',
    lore: 'A hundred mirror-still lakes under pine and mist. Water Mystics bask on the shores, and the Abyssal Tyrant waits beneath the deepest one.',
    center: [-250, -30], levels: [8, 13], wildCount: 16,
    spawns: [
      { species: 'glub', weight: 3, method: 'roam' }, { species: 'alpuff', weight: 2, method: 'roam' }, { species: 'croakus', weight: 2, method: 'roam' },
      { species: 'clacker', weight: 2.5, method: 'roam' }, { species: 'glenhart', weight: 1.2, method: 'roam' },
      { species: 'bubblin', weight: 3, method: 'grass' }, { species: 'whirlie', weight: 2, method: 'grass' }, { species: 'finnik', weight: 0.7, method: 'grass' },
      { species: 'gustail', weight: 1.2, method: 'grass' },
      { species: 'glubbernaut', weight: 0.5, method: 'search' }, { species: 'alpaqueen', weight: 0.4, method: 'search' },
      { species: 'skymane', weight: 0.5, method: 'search' },
      { species: 'gloomling', weight: 1, method: 'night' },
      { species: 'gildfin', weight: 3, method: 'fish' }, { species: 'quillpuff', weight: 2.5, method: 'fish' }, { species: 'mirrorscale', weight: 1.2, method: 'fish' }, { species: 'sunbasker', weight: 1, method: 'fish' },
      { species: 'grinfin', weight: 1, method: 'fish' }, { species: 'skysail', weight: 1.2, method: 'fish' }, { species: 'bellowdeep', weight: 0.2, method: 'fish' }, { species: 'hobsnap', weight: 0.2, method: 'fish' },
    ],
    ground: ['#5c9a72', '#98c49a', '#e2e8c8'], fog: '#c6dfe8', sky: { turbidity: 3, rayleigh: 1, azimuth: 120 },
    terrain: { base: 0.7, ridges: 0, mesas: 0, lakes: 1.1, dunes: 0, pools: 0 },
    flora: { tree_round: 140, tree_pine: 520, tree_twisted: 40, rock: 160, boulder: 30, bush: 300, fern: 300, mushroom: 130, flowers: 260, pebbles: 150, log: 50, reeds: 320 },
    grass: '#74b87e', tallGrass: '#4f9a6e', particles: '#bff0ff', weather: 'mist', music: 'overworld',
    boss: { species: 'abyssal_tyrant', level: 14, pos: [-315, -78], adds: ['glub', 'croakus'] }, camp: [-292, -58],
    town: { name: 'Stillwater', pos: [-182, -12], kind: 'town' }, water: { shallow: '#6fe0d8', deep: '#123e6a' },
  },
  {
    id: 'scar', name: 'Ember Scar', subtitle: 'Ash, obsidian and old fire',
    lore: 'A wound in the land that never cooled. Lava pools glow between charred mesas, and the Ashen Totem hums in the heat haze.',
    center: [250, -30], levels: [9, 14], wildCount: 16,
    spawns: [
      { species: 'impling', weight: 3, method: 'roam' }, { species: 'grunt', weight: 3, method: 'roam' }, { species: 'cinderquid', weight: 2, method: 'roam' },
      { species: 'kilnback', weight: 1.2, method: 'roam' },
      { species: 'monkroose', weight: 2, method: 'grass' }, { species: 'emberling', weight: 0.7, method: 'grass' }, { species: 'gloomling', weight: 1.5, method: 'grass' },
      { species: 'scorchclaw', weight: 1.2, method: 'grass' },
      { species: 'warlord', weight: 0.4, method: 'search' }, { species: 'hellion', weight: 0.4, method: 'search' },
      { species: 'pyrox', weight: 0.5, method: 'search' },
      { species: 'wisp', weight: 1, method: 'night' }, { species: 'squeakwing', weight: 2.5, method: 'night' }, { species: 'rattlecloak', weight: 0.5, method: 'night' },
      { species: 'emberspine', weight: 1.5, method: 'fish' }, { species: 'magmascale', weight: 0.6, method: 'fish' },
    ],
    ground: ['#7a5444', '#a8785a', '#d8683e'], fog: '#dcae94', sky: { turbidity: 7, rayleigh: 2.4, azimuth: 200 },
    terrain: { base: 1.4, ridges: 0, mesas: 1, lakes: 0.8, dunes: 0, pools: 0 },
    flora: { tree_dead: 300, tree_twisted: 70, tree_crystal: 30, rock: 240, boulder: 90, bush: 60, pebbles: 220, log: 30 },
    grass: '#b8905a', tallGrass: '#9a6a3a', particles: '#ff8a3d', weather: 'embers', music: 'overworld',
    boss: { species: 'ashen_totem', level: 15, pos: [315, -78], adds: ['impling', 'grunt'] }, camp: [292, -58],
    town: { name: 'Cinderrest', pos: [182, -12], kind: 'town' }, water: { shallow: '#ffb03a', deep: '#c2300a', lava: true },
  },
  {
    id: 'marsh', name: 'Mistveil Marsh', subtitle: 'Where the fog remembers names',
    lore: 'Sunken boardwalks, glowing spores and pools that swallow sound. Void Mystics drift here after dark, and the Bog Sovereign rules the reeds.',
    center: [-225, 255], levels: [13, 18], wildCount: 16,
    spawns: [
      { species: 'croakus', weight: 3, method: 'roam' }, { species: 'bubblin', weight: 2, method: 'roam' }, { species: 'gloomling', weight: 2, method: 'roam' },
      { species: 'sporelet', weight: 2, method: 'grass' }, { species: 'gloop', weight: 2, method: 'grass' }, { species: 'spikegloop', weight: 1, method: 'grass' },
      { species: 'hissling', weight: 2.5, method: 'grass' }, { species: 'blorp', weight: 2.5, method: 'grass' },
      { species: 'mycobloom', weight: 0.5, method: 'search' },
      { species: 'bonewarden', weight: 1, method: 'search' }, { species: 'gobblorp', weight: 1, method: 'search' },
      { species: 'wisp', weight: 2, method: 'night' }, { species: 'gloomlord', weight: 0.4, method: 'night' },
      { species: 'bonelet', weight: 3, method: 'night' }, { species: 'skullbop', weight: 2.5, method: 'night' }, { species: 'squeakwing', weight: 2.5, method: 'night' },
      { species: 'weblin', weight: 2, method: 'night' }, { species: 'nibblet', weight: 2, method: 'night' }, { species: 'hexbones', weight: 0.5, method: 'night' },
      { species: 'chompsy', weight: 3, method: 'fish' }, { species: 'barbelmail', weight: 2, method: 'fish' }, { species: 'lanterngulp', weight: 0.25, method: 'fish' },
    ],
    ground: ['#4f6a44', '#7a8a58', '#9aa86a'], fog: '#a8b8a0', sky: { turbidity: 8, rayleigh: 0.8, azimuth: 60 },
    terrain: { base: 0.35, ridges: 0, mesas: 0, lakes: 0.4, dunes: 0, pools: 1 },
    flora: { tree_twisted: 160, tree_dead: 90, tree_round: 60, mushroom: 320, fern: 280, bush: 160, reeds: 520, log: 90, rock: 60 },
    grass: '#6a8a4a', tallGrass: '#4a6a36', particles: '#b8ff7a', weather: 'spores', music: 'marsh',
    boss: { species: 'bog_sovereign', level: 19, pos: [-290, 320], adds: ['croakus', 'gloomling'] }, camp: [-262, 296],
    town: { name: 'Mirehaven', pos: [-160, 200], kind: 'outpost' }, water: { shallow: '#7a9a5a', deep: '#1f3a2a' },
  },
  {
    id: 'dunes', name: 'Sunscorch Dunes', subtitle: 'Gold sand over sleeping giants',
    lore: 'Endless dunes, glassy salt flats and one green oasis. Earth and Storm Mystics weather the sandstorms, and the Sandjaw Colossus sleeps beneath the largest dune.',
    center: [225, 255], levels: [14, 19], wildCount: 16,
    spawns: [
      { species: 'pricklet', weight: 3, method: 'roam' }, { species: 'monkroose', weight: 2, method: 'roam' }, { species: 'grunt', weight: 2, method: 'roam' },
      { species: 'dustclaw', weight: 3, method: 'roam' }, { species: 'hornwall', weight: 2, method: 'roam' }, { species: 'duneplod', weight: 2.5, method: 'roam' },
      { species: 'voltcat', weight: 2, method: 'grass' }, { species: 'zorp', weight: 2, method: 'grass' }, { species: 'saguardian', weight: 0.6, method: 'grass' },
      { species: 'boltstripe', weight: 2, method: 'grass' }, { species: 'thrumcrest', weight: 2, method: 'grass' }, { species: 'thornet', weight: 1.2, method: 'grass' },
      { species: 'impling', weight: 1, method: 'search' }, { species: 'warlord', weight: 0.4, method: 'search' },
      { species: 'sandclack', weight: 1.2, method: 'search' }, { species: 'thunderneck', weight: 0.5, method: 'search' }, { species: 'quakemaw', weight: 0.4, method: 'search' },
      { species: 'shadekin', weight: 1.5, method: 'night' },
    ],
    ground: ['#d8b070', '#ecd29a', '#c88a4a'], fog: '#f0d8b0', sky: { turbidity: 9, rayleigh: 1.6, azimuth: 230 },
    terrain: { base: 0.55, ridges: 0, mesas: 0.3, lakes: 0.18, dunes: 1, pools: 0 },
    flora: { cactus: 260, rock: 180, boulder: 70, tree_dead: 40, pebbles: 200, bush: 40, tree_round: 16 },
    grass: '#c8b070', tallGrass: '#a88a4a', particles: '#ffe0a0', weather: 'sand', music: 'dunes',
    boss: { species: 'sandjaw', level: 20, pos: [290, 320], adds: ['dustclaw', 'dustclaw'] }, camp: [262, 296],
    town: { name: 'Sunreach', pos: [160, 200], kind: 'outpost' }, water: { shallow: '#6fe0c8', deep: '#1a6a7a' },
  },
  {
    id: 'peaks', name: 'Stormreach Peaks', subtitle: 'The sky remembers every storm',
    lore: 'Crystal forests, frozen lakes and summits that scrape the thunderheads. Only seasoned Wayfarers reach Skyhold, and above it the Stormcrown waits.',
    center: [0, -260], levels: [19, 26], wildCount: 16,
    spawns: [
      { species: 'zapbee', weight: 3, method: 'roam' }, { species: 'frostling', weight: 3, method: 'roam' }, { species: 'sparkmage', weight: 2, method: 'roam' },
      { species: 'cogling', weight: 3, method: 'roam' }, { species: 'whirrbit', weight: 2.5, method: 'roam' }, { species: 'tuftumble', weight: 2.5, method: 'roam' }, { species: 'rimehorn', weight: 1.2, method: 'roam' },
      { species: 'zorp', weight: 2, method: 'grass' }, { species: 'shadekin', weight: 2, method: 'grass' },
      { species: 'blizzarf', weight: 0.6, method: 'grass' },
      { species: 'glaciator', weight: 0.4, method: 'search' }, { species: 'voltarmor', weight: 0.4, method: 'search' }, { species: 'xenobolt', weight: 0.3, method: 'search' },
      { species: 'tinkertot', weight: 1.2, method: 'search' }, { species: 'gearbrute', weight: 1, method: 'search' }, { species: 'galegunner', weight: 1, method: 'search' },
      { species: 'peakfleece', weight: 1, method: 'search' }, { species: 'stiltshot', weight: 0.5, method: 'search' }, { species: 'arcannon', weight: 0.4, method: 'search' },
      { species: 'wisp', weight: 1, method: 'night' }, { species: 'gloomling', weight: 1, method: 'night' },
      { species: 'aurorhart', weight: 0.2, method: 'night' },
    ],
    ground: ['#7c7c9c', '#b6b6d0', '#f6f6ff'], fog: '#c0bedc', sky: { turbidity: 6, rayleigh: 0.9, azimuth: 250 },
    terrain: { base: 2.0, ridges: 1, mesas: 0, lakes: 0.35, dunes: 0, pools: 0 },
    flora: { tree_pine: 300, tree_crystal: 260, rock: 300, boulder: 110, bush: 80, pebbles: 200 },
    grass: '#a4a8c8', tallGrass: '#8488b0', particles: '#ffffff', weather: 'snow', music: 'overworld',
    boss: { species: 'stormcrown', level: 27, pos: [0, -318], adds: ['zapbee', 'shadekin'] }, camp: [0, -292],
    town: { name: 'Skyhold', pos: [10, -182], kind: 'town' }, water: { shallow: '#b8e8ff', deep: '#3a5a9a' },
  },
];

export const START_POS: [number, number] = [0, 58];

/** The player's buildable homestead plot (Verdant Vale). */
export const HOMESTEAD = { center: [82, 90] as [number, number], radius: 24 };

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
