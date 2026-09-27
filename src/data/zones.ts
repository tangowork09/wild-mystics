export type TreeKind = 'round' | 'pine' | 'dead' | 'crystal';

export interface Zone {
  id: string;
  name: string;
  subtitle: string;
  /** Voronoi center in world XZ. */
  center: [number, number];
  levels: [number, number];
  spawns: { species: string; weight: number }[];
  wildCount: number;
  /** Terrain colors: low ground, high ground, accent patches. */
  ground: [string, string, string];
  fog: string;
  sky: { turbidity: number; rayleigh: number; elevation: number; azimuth: number };
  heightScale: number;
  trees: TreeKind;
  treeDensity: number;
  grass: string;
  particles: string;
  boss: { species: string; level: number; pos: [number, number]; adds: string[] };
  /** Expedition flag: rest + save point next to the boss arena. */
  camp: [number, number];
  town: { name: string; pos: [number, number] };
  water: { shallow: string; deep: string; lava?: boolean };
}

export const WORLD_SIZE = 520;
export const WATER_LEVEL = -1.2;

export const ZONES: Zone[] = [
  {
    id: 'vale', name: 'Verdant Vale', subtitle: 'Where every expedition begins',
    center: [0, 90], levels: [2, 5], wildCount: 16,
    spawns: [{ species: 'gloop', weight: 3 }, { species: 'chirpling', weight: 3 }, { species: 'pecklet', weight: 2 }, { species: 'hopscotch', weight: 2 }, { species: 'pricklet', weight: 2 }, { species: 'voltcat', weight: 1 }, { species: 'monkroose', weight: 1 }, { species: 'sporelet', weight: 0.5 }],
    ground: ['#6aa546', '#9cc866', '#d6ca78'], fog: '#cfe2d6', sky: { turbidity: 3.5, rayleigh: 1.3, elevation: 16, azimuth: 150 },
    heightScale: 1, trees: 'round', treeDensity: 1, grass: '#7ab84a', particles: '#fff3b0',
    boss: { species: 'thornjaw', level: 7, pos: [-40, 150], adds: ['spikegloop'] }, camp: [-30, 128], town: { name: 'Hearthwick', pos: [0, 112] }, water: { shallow: '#5fc8c0', deep: '#1f5a78' },
  },
  {
    id: 'scar', name: 'Ember Scar', subtitle: 'Ash, obsidian and old fire',
    center: [165, -10], levels: [6, 10], wildCount: 14,
    spawns: [{ species: 'impling', weight: 3 }, { species: 'grunt', weight: 3 }, { species: 'cinderquid', weight: 2 }, { species: 'gloomling', weight: 2 }, { species: 'monkroose', weight: 1 }, { species: 'emberling', weight: 0.5 }],
    ground: ['#7a5444', '#a8785a', '#d8683e'], fog: '#dcae94', sky: { turbidity: 7, rayleigh: 2.4, elevation: 9, azimuth: 200 },
    heightScale: 1.5, trees: 'dead', treeDensity: 0.5, grass: '#b8905a', particles: '#ff8a3d',
    boss: { species: 'ashen_totem', level: 12, pos: [200, -40], adds: ['impling', 'grunt'] }, camp: [182, -22], town: { name: 'Cinderrest', pos: [118, 8] }, water: { shallow: '#ffb03a', deep: '#c2300a', lava: true },
  },
  {
    id: 'lakes', name: 'Mirror Lakes', subtitle: 'Still waters, restless depths',
    center: [-165, -10], levels: [6, 10], wildCount: 14,
    spawns: [{ species: 'glub', weight: 3 }, { species: 'bubblin', weight: 3 }, { species: 'croakus', weight: 2 }, { species: 'alpuff', weight: 2 }, { species: 'whirlie', weight: 2 }, { species: 'finnik', weight: 0.5 }],
    ground: ['#5c9a72', '#98c49a', '#e2e8c8'], fog: '#c6dfe8', sky: { turbidity: 3, rayleigh: 1, elevation: 22, azimuth: 120 },
    heightScale: 0.7, trees: 'pine', treeDensity: 0.8, grass: '#74b87e', particles: '#bff0ff',
    boss: { species: 'abyssal_tyrant', level: 12, pos: [-205, -45], adds: ['glub', 'croakus'] }, camp: [-186, -26], town: { name: 'Stillwater', pos: [-118, 8] }, water: { shallow: '#6fe0d8', deep: '#123e6a' },
  },
  {
    id: 'peaks', name: 'Stormreach Peaks', subtitle: 'The sky remembers every storm',
    center: [0, -170], levels: [11, 16], wildCount: 14,
    spawns: [{ species: 'zapbee', weight: 3 }, { species: 'frostling', weight: 3 }, { species: 'zorp', weight: 2 }, { species: 'shadekin', weight: 2 }, { species: 'sparkmage', weight: 2 }, { species: 'wisp', weight: 1 }, { species: 'gloomling', weight: 1 }],
    ground: ['#7c7c9c', '#b6b6d0', '#f6f6ff'], fog: '#c0bedc', sky: { turbidity: 6, rayleigh: 0.9, elevation: 17, azimuth: 250 },
    heightScale: 2.1, trees: 'crystal', treeDensity: 0.5, grass: '#a4a8c8', particles: '#d8b8ff',
    boss: { species: 'stormcrown', level: 18, pos: [0, -225], adds: ['zapbee', 'shadekin'] }, camp: [0, -200], town: { name: 'Skyhold', pos: [8, -122] }, water: { shallow: '#b8e8ff', deep: '#3a5a9a' },
  },
];

export const START_POS: [number, number] = [0, 100];

/** Voronoi weights: returns each zone's blend weight at a point (sums to 1). */
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
