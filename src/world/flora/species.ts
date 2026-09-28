import type { GlowMode } from './material';

// What grows where. Species = a prototype family + scale, tint palette and behaviour. Each land lists
// its forest cover, tree mix and ground cover (per habitat), which the scatter turns into clustered
// forests, groves, meadows, rocky slopes and reedy shores.

export type Family =
  | 'tree_round' | 'tree_pine' | 'tree_dead' | 'tree_twisted'
  | 'rock' | 'boulder' | 'bush' | 'fern' | 'mushroom' | 'flowers' | 'pebbles' | 'reeds'
  | 'crystal' | 'cactus' | 'log' | 'tuft';

export type Layer = 'tree' | 'cover';

export interface SpeciesDef {
  family: Family;
  layer: Layer;
  scale: [number, number];
  /** Collider radius per unit scale (0 = walk-through). */
  collider: number;
  /** Sway multiplier for foliage (0 = rigid). */
  sway: number;
  /** Foliage tint palette (sRGB); applied to untinted leaf textures. */
  leaf?: string[];
  /** Tint for everything else (bark, rock, crystal, cactus skin). */
  body?: string[];
  snow?: number;
  glow?: number;
  glowMode?: GlowMode;
  /** Push into the ground (m per unit scale) and random tilt (rad). */
  sink?: number;
  tilt?: number;
  /** Min spacing between trees (m per unit scale). */
  spacing?: number;
  maxSlope: number;
  shadow?: boolean;
  /** Use only these variants of the family. */
  variants?: number[];
  /** Material swaps by source material name. */
  swap?: Record<string, string>;
  /** Stretch Y. */
  stretch?: number;
}

const GREEN = ['#5fb23d', '#72c046', '#54a63a', '#86c84c', '#4d9d3b', '#68b642'];
export const SPECIES = {
  oak: { family: 'tree_round', layer: 'tree', scale: [0.95, 1.5], collider: 0.42, sway: 1, leaf: GREEN, spacing: 3.2, maxSlope: 0.8 },
  oak_deep: { family: 'tree_round', layer: 'tree', scale: [1.0, 1.55], collider: 0.42, sway: 1, leaf: ['#3f9240', '#2f8046', '#4b9f45', '#5aa84a', '#36884a'], spacing: 3.2, maxSlope: 0.8 },
  oak_sea: { family: 'tree_round', layer: 'tree', scale: [0.85, 1.25], collider: 0.42, sway: 1.3, leaf: ['#6cbb52', '#7cc65a', '#5cae4c'], spacing: 3.5, maxSlope: 0.8 },
  giant: { family: 'tree_round', layer: 'tree', scale: [2.3, 3.2], collider: 0.42, sway: 0.5, leaf: ['#3f9c4c', '#4caa4a', '#378e46', '#5cae4c', '#6ab84a'], body: ['#c8b8a4'], spacing: 4.2, maxSlope: 0.6 },
  blossom: { family: 'tree_twisted', layer: 'tree', scale: [0.85, 1.25], collider: 0.4, sway: 1, leaf: ['#f4a6cb', '#f7bcd9', '#e98cbe', '#f9c9df', '#e7a2d6'], spacing: 3.2, maxSlope: 0.8 },
  lilac: { family: 'tree_twisted', layer: 'tree', scale: [0.85, 1.3], collider: 0.4, sway: 1, leaf: ['#b99cf2', '#a78ae8', '#c9adf8', '#9f8ef0'], spacing: 3.2, maxSlope: 0.9 },
  autumn: { family: 'tree_twisted', layer: 'tree', scale: [0.85, 1.3], collider: 0.4, sway: 1, leaf: ['#f5982c', '#f2b93a', '#e8702a', '#f4c64e', '#ea5c2c'], spacing: 3.2, maxSlope: 0.8 },
  swamp: { family: 'tree_twisted', layer: 'tree', scale: [0.95, 1.45], collider: 0.42, sway: 0.8, leaf: ['#6c9a3c', '#7fa844', '#5a8a3a', '#8aa84a'], body: ['#8a8070'], spacing: 3.4, maxSlope: 0.8 },
  pine: { family: 'tree_pine', layer: 'tree', scale: [0.85, 1.45], collider: 0.36, sway: 0.5, leaf: ['#2f7f5a', '#3b8e60', '#2a7054', '#47955e', '#35845c'], spacing: 2.8, maxSlope: 1.0 },
  pine_dark: { family: 'tree_pine', layer: 'tree', scale: [0.9, 1.55], collider: 0.36, sway: 0.5, leaf: ['#1f6a56', '#276f5c', '#2f7a5e', '#1c5f52'], spacing: 2.8, maxSlope: 1.0 },
  pine_snow: { family: 'tree_pine', layer: 'tree', scale: [0.85, 1.5], collider: 0.36, sway: 0.35, leaf: ['#3a6e6c', '#467b73', '#34636a', '#4f8278'], snow: 0.95, spacing: 2.8, maxSlope: 1.1 },
  dead: { family: 'tree_dead', layer: 'tree', scale: [0.8, 1.3], collider: 0.34, sway: 0, body: ['#d8cfc2', '#c9bda9', '#e2d8c8'], spacing: 3, maxSlope: 1.0 },
  charred: { family: 'tree_dead', layer: 'tree', scale: [0.85, 1.35], collider: 0.34, sway: 0, body: ['#5a4a42', '#4a3c36', '#66534a'], glow: 1, glowMode: 'ember', spacing: 3, maxSlope: 1.0 },
  crystal: { family: 'crystal', layer: 'tree', scale: [0.9, 1.8], collider: 0.5, sway: 0, body: ['#7fe8ff', '#b48cff', '#8cb4ff', '#ff9ad8', '#7fffe0'], glow: 0.7, glowMode: 'tint', tilt: 0.2, sink: 0.15, spacing: 2.4, maxSlope: 1.4 },
  crystal_fire: { family: 'crystal', layer: 'tree', scale: [0.8, 1.5], collider: 0.5, sway: 0, body: ['#ff7a3a', '#ffae3a', '#ff5a4a'], glow: 1, glowMode: 'tint', tilt: 0.25, sink: 0.15, spacing: 2.4, maxSlope: 1.4 },
  crystal_ice: { family: 'crystal', layer: 'tree', scale: [0.9, 1.7], collider: 0.5, sway: 0, body: ['#bfe8ff', '#d8f0ff', '#a8d8ff'], glow: 0.35, glowMode: 'tint', tilt: 0.2, sink: 0.15, spacing: 2.4, maxSlope: 1.4 },
  cactus: { family: 'cactus', layer: 'tree', scale: [0.8, 1.5], collider: 0.36, sway: 0, body: ['#6a9e4a', '#5e9448', '#78a856', '#5c8f52'], spacing: 3.5, maxSlope: 0.7 },
  toadstool: { family: 'mushroom', layer: 'tree', scale: [9, 15], collider: 0.05, sway: 0, variants: [0], body: ['#ffffff', '#ffe0f0', '#e0f0ff'], glow: 0.55, glowMode: 'tint', spacing: 0.35, maxSlope: 0.6 },
  outcrop: { family: 'boulder', layer: 'tree', scale: [2.4, 4.6], collider: 0.8, sway: 0, body: ['#ece8e0', '#e0dcd6', '#f4efe6'], sink: 0.25, tilt: 0.25, spacing: 1.2, maxSlope: 3 },
  outcrop_desert: { family: 'boulder', layer: 'tree', scale: [2.4, 5], collider: 0.8, sway: 0, body: ['#f0d0a0', '#e8c090', '#dcb488'], swap: { Rocks: 'RocksDesert' }, sink: 0.25, tilt: 0.2, spacing: 1.2, maxSlope: 3 },
  outcrop_dark: { family: 'boulder', layer: 'tree', scale: [2.2, 4.2], collider: 0.8, sway: 0, body: ['#8a7c88', '#7a7084', '#948088'], sink: 0.25, tilt: 0.3, spacing: 1.2, maxSlope: 3 },
  outcrop_snow: { family: 'boulder', layer: 'tree', scale: [2.4, 4.6], collider: 0.8, sway: 0, body: ['#d8dcec', '#c8ccdc'], snow: 0.9, sink: 0.25, tilt: 0.25, spacing: 1.2, maxSlope: 3 },

  bush: { family: 'bush', layer: 'cover', scale: [0.8, 1.5], collider: 0, sway: 1, leaf: ['#5aa83a', '#6ab842', '#4e9a3a', '#78bc48'], maxSlope: 0.9 },
  bush_deep: { family: 'bush', layer: 'cover', scale: [0.9, 1.7], collider: 0, sway: 1, leaf: ['#3f8a3c', '#4a9a42', '#357a3e'], maxSlope: 0.9 },
  bush_gold: { family: 'bush', layer: 'cover', scale: [0.8, 1.4], collider: 0, sway: 1, leaf: ['#e8a83a', '#d89a34', '#c8b048'], maxSlope: 0.9 },
  bush_dry: { family: 'bush', layer: 'cover', scale: [0.6, 1.1], collider: 0, sway: 0.6, leaf: ['#b8a45a', '#a89452', '#c2ae6a'], maxSlope: 0.9 },
  bush_frost: { family: 'bush', layer: 'cover', scale: [0.7, 1.2], collider: 0, sway: 0.5, leaf: ['#5e8a86', '#6a948c'], snow: 0.7, maxSlope: 1 },
  fern: { family: 'fern', layer: 'cover', scale: [0.9, 1.6], collider: 0, sway: 1.2, maxSlope: 0.9 },
  flowers: { family: 'flowers', layer: 'cover', scale: [0.55, 0.95], collider: 0, sway: 1.4, maxSlope: 0.7 },
  mushroom: { family: 'mushroom', layer: 'cover', scale: [0.8, 1.8], collider: 0, sway: 0, maxSlope: 0.8, glow: 0.35, glowMode: 'tint', body: ['#ffffff'] },
  rock: { family: 'rock', layer: 'cover', scale: [0.6, 1.9], collider: 0, sway: 0, body: ['#ece8e0', '#e0dcd6', '#f4efe6'], sink: 0.15, tilt: 0.4, maxSlope: 3 },
  rock_desert: { family: 'rock', layer: 'cover', scale: [0.6, 2.0], collider: 0, sway: 0, body: ['#f0d0a0', '#e8c090'], swap: { Rocks: 'RocksDesert' }, sink: 0.15, tilt: 0.4, maxSlope: 3 },
  rock_dark: { family: 'rock', layer: 'cover', scale: [0.6, 1.8], collider: 0, sway: 0, body: ['#8a7c88', '#7a7084'], sink: 0.15, tilt: 0.4, maxSlope: 3 },
  rock_snow: { family: 'rock', layer: 'cover', scale: [0.6, 1.9], collider: 0, sway: 0, body: ['#d8dcec', '#c8ccdc'], snow: 0.85, sink: 0.15, tilt: 0.4, maxSlope: 3 },
  boulder: { family: 'boulder', layer: 'cover', scale: [0.9, 2.1], collider: 0.95, sway: 0, body: ['#ece8e0', '#e0dcd6'], sink: 0.2, tilt: 0.3, maxSlope: 3 },
  boulder_desert: { family: 'boulder', layer: 'cover', scale: [0.9, 2.2], collider: 0.95, sway: 0, body: ['#f0d0a0', '#e8c090'], swap: { Rocks: 'RocksDesert' }, sink: 0.2, tilt: 0.3, maxSlope: 3 },
  pebbles: { family: 'pebbles', layer: 'cover', scale: [0.8, 1.8], collider: 0, sway: 0, maxSlope: 1.5, shadow: false },
  reeds: { family: 'reeds', layer: 'cover', scale: [0.9, 1.6], collider: 0, sway: 1.6, maxSlope: 0.6, shadow: false },
  tuft: { family: 'tuft', layer: 'cover', scale: [0.9, 1.6], collider: 0, sway: 1.4, maxSlope: 1.2, shadow: false },
  tuft_dry: { family: 'tuft', layer: 'cover', scale: [0.8, 1.4], collider: 0, sway: 1.2, body: ['#d8c080', '#c8b070'], maxSlope: 1.2, shadow: false },
  log: { family: 'log', layer: 'cover', scale: [0.8, 1.3], collider: 0.55, sway: 0, maxSlope: 0.5 },
} satisfies Record<string, SpeciesDef>;

export type SpeciesKey = keyof typeof SPECIES;
export const SPECIES_KEYS = Object.keys(SPECIES) as SpeciesKey[];
export const speciesDef = (k: SpeciesKey): SpeciesDef => SPECIES[k] as SpeciesDef;

export type Habitat = 'forest' | 'edge' | 'meadow' | 'slope' | 'shore' | 'any' | 'open';

export interface LandEco {
  /** Fraction of the land under forest, trees per 25 m² at full forest, grove amount, lone-tree chance. */
  forest: number; density: number; groves: number; lone: number;
  /** Altitude (m) where trees thin out. */
  treeLine: number;
  trees: [SpeciesKey, number][];
  /** Tree mix for groves and lone trees in the open (defaults to `trees`). */
  open?: [SpeciesKey, number][];
  /** Rocky outcrops on slopes (per 100 m² of steep ground). */
  outcrops: [SpeciesKey, number];
  /** Ground cover: species, density per 100 m² of full habitat, habitat. */
  cover: [SpeciesKey, number, Habitat][];
}

export const LANDS: Record<string, LandEco> = {
  vale: {
    forest: 0.3, density: 0.6, groves: 0.55, lone: 0.01, treeLine: 150,
    trees: [['oak', 72], ['pine', 10], ['blossom', 12], ['autumn', 6]],
    open: [['oak', 60], ['blossom', 28], ['autumn', 12]],
    outcrops: ['outcrop', 0.05],
    cover: [['bush', 1.6, 'edge'], ['bush', 0.18, 'meadow'], ['fern', 3, 'forest'], ['flowers', 1.3, 'meadow'], ['mushroom', 0.6, 'forest'],
      ['rock', 0.6, 'slope'], ['rock', 0.06, 'any'], ['boulder', 0.14, 'slope'], ['pebbles', 1.2, 'shore'], ['reeds', 7, 'shore'], ['log', 0.15, 'forest'], ['tuft', 0.5, 'slope']],
  },
  lakes: {
    forest: 0.52, density: 0.72, groves: 0.4, lone: 0.012, treeLine: 150,
    trees: [['pine', 58], ['pine_dark', 22], ['oak', 14], ['autumn', 6]],
    open: [['pine', 50], ['oak', 30], ['autumn', 20]],
    outcrops: ['outcrop', 0.07],
    cover: [['bush', 1.0, 'edge'], ['fern', 3.2, 'forest'], ['flowers', 0.6, 'meadow'], ['mushroom', 0.8, 'forest'], ['rock', 0.9, 'slope'], ['boulder', 0.2, 'slope'],
      ['pebbles', 2, 'shore'], ['reeds', 11, 'shore'], ['log', 0.22, 'forest'], ['rock', 0.8, 'shore']],
  },
  coast: {
    forest: 0.16, density: 0.5, groves: 0.45, lone: 0.012, treeLine: 150,
    trees: [['oak_sea', 55], ['pine', 35], ['autumn', 10]],
    outcrops: ['outcrop', 0.12],
    cover: [['bush', 0.9, 'edge'], ['bush', 0.2, 'meadow'], ['fern', 1.2, 'forest'], ['flowers', 1.2, 'meadow'], ['rock', 1.2, 'slope'], ['rock', 1.4, 'shore'],
      ['boulder', 0.35, 'slope'], ['boulder', 0.15, 'shore'], ['pebbles', 2.4, 'shore'], ['reeds', 3, 'shore'], ['tuft', 1.4, 'open']],
  },
  marsh: {
    forest: 0.36, density: 0.6, groves: 0.5, lone: 0.02, treeLine: 150,
    trees: [['swamp', 52], ['dead', 26], ['oak_deep', 22]],
    outcrops: ['outcrop_dark', 0.03],
    cover: [['bush_deep', 1.2, 'edge'], ['fern', 3.6, 'forest'], ['mushroom', 2.2, 'forest'], ['mushroom', 0.4, 'meadow'], ['reeds', 16, 'shore'], ['reeds', 0.8, 'meadow'],
      ['log', 0.35, 'any'], ['rock', 0.3, 'slope'], ['tuft', 0.8, 'open']],
  },
  scar: {
    forest: 0.22, density: 0.42, groves: 0.4, lone: 0.02, treeLine: 150,
    trees: [['charred', 78], ['crystal_fire', 12], ['dead', 10]],
    outcrops: ['outcrop_dark', 0.14],
    cover: [['rock_dark', 1.6, 'slope'], ['rock_dark', 0.35, 'any'], ['boulder', 0.2, 'slope'], ['pebbles', 1.4, 'any'], ['tuft_dry', 0.8, 'open'], ['bush_dry', 0.25, 'edge']],
  },
  elder: {
    forest: 0.78, density: 0.62, groves: 0.3, lone: 0.02, treeLine: 150,
    trees: [['oak_deep', 44], ['giant', 16], ['autumn', 10], ['blossom', 6], ['pine_dark', 10], ['toadstool', 7], ['oak', 7]],
    outcrops: ['outcrop', 0.04],
    cover: [['bush_deep', 1.8, 'edge'], ['bush_gold', 0.3, 'edge'], ['fern', 5, 'forest'], ['mushroom', 2.6, 'forest'], ['flowers', 0.8, 'meadow'], ['log', 0.4, 'forest'],
      ['rock', 0.5, 'slope'], ['reeds', 5, 'shore']],
  },
  dunes: {
    forest: 0.03, density: 0.5, groves: 0.2, lone: 0.006, treeLine: 150,
    trees: [['cactus', 70], ['dead', 22], ['oak_sea', 8]],
    open: [['cactus', 78], ['dead', 22]],
    outcrops: ['outcrop_desert', 0.12],
    cover: [['rock_desert', 1.0, 'slope'], ['rock_desert', 0.25, 'any'], ['boulder_desert', 0.2, 'slope'], ['tuft_dry', 1.0, 'open'], ['bush_dry', 0.35, 'open'], ['pebbles', 0.5, 'any'],
      ['reeds', 6, 'shore']],
  },
  peaks: {
    forest: 0.42, density: 0.62, groves: 0.4, lone: 0.015, treeLine: 120,
    trees: [['pine_snow', 82], ['pine_dark', 12], ['crystal_ice', 6]],
    outcrops: ['outcrop_snow', 0.16],
    cover: [['rock_snow', 1.6, 'slope'], ['rock_snow', 0.3, 'any'], ['boulder', 0.25, 'slope'], ['bush_frost', 0.5, 'edge'], ['tuft', 0.6, 'open'], ['pebbles', 0.8, 'shore']],
  },
  hollows: {
    forest: 0.2, density: 0.55, groves: 0.5, lone: 0.02, treeLine: 140,
    trees: [['crystal', 48], ['pine_dark', 30], ['lilac', 16], ['dead', 6]],
    outcrops: ['outcrop_dark', 0.14],
    cover: [['rock_dark', 1.3, 'slope'], ['rock', 0.3, 'any'], ['boulder', 0.25, 'slope'], ['bush', 0.4, 'edge'], ['mushroom', 0.6, 'forest'], ['tuft', 0.6, 'open'], ['pebbles', 1, 'any']],
  },
  summit: {
    forest: 0.12, density: 0.5, groves: 0.4, lone: 0.012, treeLine: 110,
    trees: [['pine_snow', 60], ['crystal_ice', 25], ['dead', 15]],
    outcrops: ['outcrop_snow', 0.2],
    cover: [['rock_snow', 1.4, 'slope'], ['rock', 0.3, 'any'], ['boulder', 0.25, 'slope'], ['tuft', 0.5, 'open'], ['pebbles', 0.8, 'any']],
  },
};
