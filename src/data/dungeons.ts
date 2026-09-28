// Dungeon content (v3:dungeons). Layout positions, themes and reveal rules live in layout.ts
// (`DUNGEONS`); this file holds everything the interiors need: palettes and lighting per theme,
// the Mystics that haunt each dungeon, its boss, its puzzles and its loot.
//
// Species are referenced by id; ids that don't exist (renamed by another workstream) are skipped
// at runtime, so a dungeon always spawns *something*.

import type { DungeonDef } from './layout';
import type { Reward } from './progression';
import type { OrbId, ItemId } from './items';

export type DungeonTheme = DungeonDef['theme'];
export type PuzzleKind = 'lever' | 'braziers' | 'runes' | 'push';
export type MoteKind = 'dust' | 'embers' | 'snow' | 'spores' | 'sparkle' | 'bubbles' | 'fireflies';

/** HSL colourise applied to the kit atlases: greys become `stone`, browns become `wood`. */
export interface Tone { h: number; s: number; l: number; add?: number }

export interface ThemeStyle {
  label: string;
  stone: Tone;
  wood: Tone;
  /** Hue (0–1) saturated atlas colours (cloth, banners) are pulled toward, with strength 0–1. */
  accent?: [hue: number, strength: number];
  fog: string;
  fogDensity: number;
  /** Hemisphere light (sky / ground) and its intensity. */
  ambient: [sky: string, ground: string, intensity: number];
  /** Dim key light from above: colour and intensity. */
  key: [color: string, intensity: number];
  envIntensity: number;
  /** Flame / light colour of the theme's torches, and point-light intensity. */
  torch: string;
  torchLight: string;
  torchIntensity: number;
  /** Secondary glow (crystals, ghost fire, lava) used by theme dressing. */
  glow: string;
  motes: { kind: MoteKind; color: string };
  /** God-ray shafts falling through the dark (chapel, tomb, sanctum…). */
  shafts?: string;
  /** Floor pieces (kaykit keys) with weights, for rooms and for corridors. */
  floor: Record<string, number>;
  corridorFloor: Record<string, number>;
  wall: Record<string, number>;
  banner?: string;
  /** Wall-mounted light: kaykit torch, halloween lantern, candles or a procedural crystal. */
  lamp: 'torch' | 'lantern' | 'crystal' | 'candles';
  /** Theme dressing sets used by the builder. */
  dressing: DressingKind[];
  music: string;
}

export type DressingKind =
  | 'storage' | 'library' | 'feast' | 'crypt' | 'graves' | 'pews' | 'roots' | 'mushrooms' | 'crystals' | 'lava'
  | 'water' | 'ice' | 'sand' | 'statues' | 'treasure' | 'forge' | 'mine' | 'bones' | 'stars' | 'rubble';

export const THEMES: Record<DungeonTheme, ThemeStyle> = {
  burrow: {
    label: 'Burrow',
    stone: { h: 0.075, s: 0.26, l: 0.82 }, wood: { h: 0.07, s: 0.42, l: 0.72 }, accent: [0.27, 0.5],
    fog: '#0c0906', fogDensity: 0.05, ambient: ['#8a7048', '#140e08', 0.85], key: ['#ffd89a', 0.35], envIntensity: 0.12,
    torch: '#ffb45a', torchLight: '#ff9a4a', torchIntensity: 26, glow: '#c8ff7a',
    motes: { kind: 'fireflies', color: '#e8ff9a' },
    floor: { floor_dirt_large: 5, floor_dirt_large_rocky: 3, floor_tile_large_rocks: 1 },
    corridorFloor: { floor_dirt_large: 4, floor_dirt_large_rocky: 2 },
    wall: { wall_cracked: 4, wall_broken: 2, wall: 2 },
    lamp: 'lantern', dressing: ['roots', 'mushrooms', 'storage', 'rubble'], music: 'night',
  },
  chapel: {
    label: 'Chapel',
    stone: { h: 0.52, s: 0.1, l: 1.05 }, wood: { h: 0.55, s: 0.2, l: 0.6 }, accent: [0.55, 0.6],
    fog: '#061019', fogDensity: 0.042, ambient: ['#5a8a9a', '#081216', 0.85], key: ['#a8e0ff', 0.9], envIntensity: 0.14,
    torch: '#ffd48a', torchLight: '#ffbe6a', torchIntensity: 20, glow: '#7ae8ff',
    motes: { kind: 'bubbles', color: '#aef4ff' }, shafts: '#9fe8ff',
    floor: { floor_tile_large: 5, floor_tile_small_decorated: 2, floor_tile_small_broken_A: 1 },
    corridorFloor: { floor_tile_large: 3, floor_tile_small_broken_B: 1, floor_tile_small_weeds_A: 1 },
    wall: { wall: 3, wall_window_closed: 2, wall_archedwindow_gated: 2, wall_cracked: 1 },
    banner: 'blue', lamp: 'candles', dressing: ['pews', 'water', 'statues', 'library'], music: 'summon',
  },
  grotto: {
    label: 'Grotto',
    stone: { h: 0.57, s: 0.16, l: 0.78 }, wood: { h: 0.06, s: 0.45, l: 0.75 }, accent: [0.02, 0.4],
    fog: '#050e18', fogDensity: 0.045, ambient: ['#3a6a8a', '#060c14', 0.8], key: ['#7ac8ff', 0.5], envIntensity: 0.12,
    torch: '#ffc070', torchLight: '#ffa850', torchIntensity: 24, glow: '#6ae8ff',
    motes: { kind: 'bubbles', color: '#9ae8ff' },
    floor: { floor_dirt_large_rocky: 3, floor_tile_large_rocks: 2, floor_wood_large: 2 },
    corridorFloor: { floor_wood_large: 3, floor_dirt_large_rocky: 2 },
    wall: { wall_broken: 3, wall_cracked: 3, wall: 1 },
    banner: 'red', lamp: 'lantern', dressing: ['storage', 'treasure', 'water', 'rubble'], music: 'night',
  },
  crypt: {
    label: 'Crypt',
    stone: { h: 0.36, s: 0.08, l: 0.66 }, wood: { h: 0.3, s: 0.12, l: 0.5 }, accent: [0.38, 0.6],
    fog: '#050806', fogDensity: 0.052, ambient: ['#3a5a48', '#040605', 0.8], key: ['#8affc8', 0.45], envIntensity: 0.1,
    torch: '#8aff9a', torchLight: '#5aff8a', torchIntensity: 22, glow: '#7affb0',
    motes: { kind: 'spores', color: '#9affc0' },
    floor: { floor_tile_large: 4, floor_tile_small_broken_A: 2, floor_tile_small_broken_B: 2, floor_tile_large_rocks: 1 },
    corridorFloor: { floor_tile_small_broken_A: 2, floor_tile_large: 2 },
    wall: { wall: 3, wall_cracked: 2, wall_shelves: 1, wall_broken: 1 },
    banner: 'green', lamp: 'candles', dressing: ['crypt', 'graves', 'bones', 'library'], music: 'night',
  },
  forge: {
    label: 'Forge',
    stone: { h: 0.03, s: 0.08, l: 0.5 }, wood: { h: 0.03, s: 0.3, l: 0.45 }, accent: [0.03, 0.7],
    fog: '#120503', fogDensity: 0.036, ambient: ['#9a4a22', '#140503', 0.95], key: ['#ff9a5a', 0.55], envIntensity: 0.12,
    torch: '#ff8a2a', torchLight: '#ff6a1a', torchIntensity: 30, glow: '#ff6a1a',
    motes: { kind: 'embers', color: '#ffae5a' },
    floor: { floor_tile_large_rocks: 3, floor_tile_large: 3, floor_tile_big_grate: 1 },
    corridorFloor: { floor_tile_large: 3, floor_tile_big_grate: 1 },
    wall: { wall: 3, wall_scaffold: 1, wall_cracked: 2, wall_gated: 1 },
    banner: 'red', lamp: 'torch', dressing: ['forge', 'lava', 'storage', 'rubble'], music: 'battle',
  },
  heartwood: {
    label: 'Heartwood',
    stone: { h: 0.08, s: 0.34, l: 0.72 }, wood: { h: 0.1, s: 0.45, l: 0.8 }, accent: [0.28, 0.6],
    fog: '#060d07', fogDensity: 0.045, ambient: ['#6a9a4a', '#081006', 0.9], key: ['#d8ffb0', 0.6], envIntensity: 0.14,
    torch: '#ffe89a', torchLight: '#ffd070', torchIntensity: 22, glow: '#aaff7a',
    motes: { kind: 'fireflies', color: '#e8ff8a' }, shafts: '#e8ffb8',
    floor: { floor_wood_large: 4, floor_wood_large_dark: 2, floor_dirt_large: 2 },
    corridorFloor: { floor_wood_large_dark: 3, floor_dirt_large: 2 },
    wall: { wall: 2, wall_cracked: 2, wall_broken: 1, wall_shelves: 1 },
    banner: 'green', lamp: 'lantern', dressing: ['roots', 'mushrooms', 'library', 'statues'], music: 'summon',
  },
  tomb: {
    label: 'Tomb',
    stone: { h: 0.1, s: 0.38, l: 1.08 }, wood: { h: 0.06, s: 0.4, l: 0.55 }, accent: [0.12, 0.6],
    fog: '#120c05', fogDensity: 0.038, ambient: ['#b08a5a', '#150e06', 0.85], key: ['#ffd8a0', 0.75], envIntensity: 0.13,
    torch: '#ffa84a', torchLight: '#ff9030', torchIntensity: 26, glow: '#ffd06a',
    motes: { kind: 'dust', color: '#ffe0a0' }, shafts: '#ffe2a8',
    floor: { floor_tile_large: 4, floor_tile_small_decorated: 2, floor_dirt_large: 1 },
    corridorFloor: { floor_tile_large: 3, floor_tile_small_broken_A: 1 },
    wall: { wall: 3, wall_cracked: 2, wall_pillar: 1 },
    banner: 'yellow', lamp: 'torch', dressing: ['crypt', 'treasure', 'sand', 'statues'], music: 'dunes',
  },
  ice: {
    label: 'Ice',
    stone: { h: 0.56, s: 0.36, l: 1.22 }, wood: { h: 0.58, s: 0.2, l: 0.9 }, accent: [0.56, 0.7],
    fog: '#08121e', fogDensity: 0.036, ambient: ['#8ac8ff', '#0a1420', 1.0], key: ['#c8ecff', 0.9], envIntensity: 0.18,
    torch: '#9ae8ff', torchLight: '#7ad8ff', torchIntensity: 24, glow: '#8ae8ff',
    motes: { kind: 'snow', color: '#e8f8ff' },
    floor: { floor_tile_large: 3, floor_tile_large_rocks: 3, floor_tile_small_broken_B: 1 },
    corridorFloor: { floor_tile_large_rocks: 3, floor_tile_large: 1 },
    wall: { wall_cracked: 3, wall: 2, wall_broken: 1 },
    banner: 'white', lamp: 'crystal', dressing: ['ice', 'crystals', 'storage', 'rubble'], music: 'night',
  },
  geode: {
    label: 'Geode',
    stone: { h: 0.74, s: 0.18, l: 0.7 }, wood: { h: 0.07, s: 0.3, l: 0.6 }, accent: [0.78, 0.6],
    fog: '#080512', fogDensity: 0.04, ambient: ['#6a4aa0', '#07040e', 0.9], key: ['#c8a8ff', 0.55], envIntensity: 0.13,
    torch: '#c89aff', torchLight: '#a87aff', torchIntensity: 24, glow: '#6ae8ff',
    motes: { kind: 'sparkle', color: '#d8c0ff' },
    floor: { floor_tile_large_rocks: 3, floor_dirt_large_rocky: 3, floor_tile_large: 1 },
    corridorFloor: { floor_dirt_large_rocky: 3, floor_wood_large: 1 },
    wall: { wall_broken: 3, wall_cracked: 3, wall_scaffold: 1 },
    banner: 'blue', lamp: 'crystal', dressing: ['crystals', 'mine', 'storage', 'rubble'], music: 'summon',
  },
  sanctum: {
    label: 'Sanctum',
    stone: { h: 0.12, s: 0.08, l: 1.32 }, wood: { h: 0.11, s: 0.55, l: 0.95 }, accent: [0.13, 0.5],
    fog: '#090b16', fogDensity: 0.032, ambient: ['#b8c8ff', '#0e1020', 1.0], key: ['#eef4ff', 1.05], envIntensity: 0.18,
    torch: '#ffe08a', torchLight: '#ffd070', torchIntensity: 26, glow: '#9ad8ff',
    motes: { kind: 'sparkle', color: '#fff4c8' }, shafts: '#eaf2ff',
    floor: { floor_tile_large: 5, floor_tile_small_decorated: 3 },
    corridorFloor: { floor_tile_small_decorated: 2, floor_tile_large: 2 },
    wall: { wall_pillar: 2, wall_arched: 2, wall_archedwindow_open: 1, wall: 2 },
    banner: 'white', lamp: 'torch', dressing: ['statues', 'library', 'treasure', 'feast'], music: 'summon',
  },
  starfall: {
    label: 'Starfall',
    stone: { h: 0.68, s: 0.26, l: 0.55 }, wood: { h: 0.72, s: 0.2, l: 0.5 }, accent: [0.85, 0.6],
    fog: '#04040d', fogDensity: 0.04, ambient: ['#5050b8', '#04040a', 0.9], key: ['#9ab8ff', 0.55], envIntensity: 0.12,
    torch: '#8af0ff', torchLight: '#6ad8ff', torchIntensity: 24, glow: '#ff8af0',
    motes: { kind: 'sparkle', color: '#b8f0ff' }, shafts: '#b8c8ff',
    floor: { floor_dirt_large_rocky: 3, floor_tile_large_rocks: 3 },
    corridorFloor: { floor_dirt_large_rocky: 3, floor_tile_large_rocks: 1 },
    wall: { wall_broken: 3, wall_cracked: 3 },
    banner: 'blue', lamp: 'crystal', dressing: ['stars', 'crystals', 'rubble', 'bones'], music: 'summon',
  },
};

export interface BossDef {
  species: string;
  level: number;
  adds: string[];
  /** Alpha scale applied to the boss rig in the chamber and in battle. */
  scale: number;
  /** Shown instead of the species name. */
  title: string;
  /** Spoken (as a title card) when the chamber wakes. */
  taunt: string;
}

export type ChestReward = Reward & { egg?: string };

export interface ChestDef {
  /** Where the builder puts it. */
  room: 'hall' | 'side' | 'puzzle' | 'treasure' | 'boss';
  reward: ChestReward;
}

export interface DungeonData {
  id: string;
  seed: number;
  /** Rooms between the entrance hall and the boss chamber (5–7). */
  rooms: number;
  /** The boss wing sits one storey down, reached by a stair. */
  stair: boolean;
  /** Puzzles in the order they gate the way forward; the last one seals the boss door. */
  puzzles: PuzzleKind[];
  /** Puzzle flavour text by kind (shown on first sight). */
  puzzleHint: Partial<Record<PuzzleKind, string>>;
  common: string[];
  rare: string[];
  boss: BossDef;
  chests: ChestDef[];
  /** Stone tablet in the entrance hall. */
  lore: string;
}

const orbs = (o: Partial<Record<OrbId, number>>) => o;
const items = (i: Partial<Record<ItemId, number>>) => i;

export const DUNGEON_DATA: Record<string, DungeonData> = {
  d_vale: {
    id: 'd_vale', seed: 1101, rooms: 5, stair: false, puzzles: ['lever', 'braziers'],
    puzzleHint: { lever: 'An old iron lever, green with moss.', braziers: 'Four cold braziers ring a door of roots.' },
    common: ['nibblet', 'hissling', 'squeakwing', 'truffly', 'spikegloop'], rare: ['glowcap', 'monkroose'],
    boss: { species: 'sporeking', level: 10, adds: ['truffly'], scale: 1.75, title: 'Rootcrown Sporeking', taunt: 'The burrow breathes. Something old wakes in the roots.' },
    chests: [
      { room: 'side', reward: { gold: 180, items: items({ tonic: 3 }) } },
      { room: 'puzzle', reward: { orbs: orbs({ mystic: 4 }), items: items({ cleanse: 2 }) } },
      { room: 'treasure', reward: { gold: 320, orbs: orbs({ radiant: 2 }), relic: 'verdant_seed', egg: 'glowcap' } },
      { room: 'boss', reward: { aether: 180, items: items({ mega_tonic: 2, leaf_stone: 1 }), relic: 'heart_of_oak' } },
    ],
    lore: 'Dug by roots, not by hands. The Old Grove drinks from deep below — and something down here drinks back.',
  },
  d_lakes: {
    id: 'd_lakes', seed: 2207, rooms: 6, stair: true, puzzles: ['runes', 'lever', 'braziers'],
    puzzleHint: { runes: 'Four bells are carved into the floor. Ring them as the hymn above the altar says.', lever: 'A rusted chain-lever, still dripping.', braziers: 'Votive bowls, long drowned. Light them all.' },
    common: ['glub', 'croakus', 'clacker', 'quillpuff', 'wisp', 'bubblin'], rare: ['lanterngulp', 'mirecroak'],
    boss: { species: 'bellowdeep', level: 15, adds: ['wisp'], scale: 2.4, title: 'The Chapel Bell', taunt: 'A bell rings under the water. It is not a bell.' },
    chests: [
      { room: 'side', reward: { gold: 260, orbs: orbs({ tide: 2 }) } },
      { room: 'puzzle', reward: { items: items({ ether: 2, tonic: 3 }) } },
      { room: 'hall', reward: { orbs: orbs({ mystic: 5 }) } },
      { room: 'treasure', reward: { gold: 450, items: items({ water_stone: 1 }), relic: 'dawn_bell', egg: 'lanterngulp' } },
      { room: 'boss', reward: { aether: 260, orbs: orbs({ radiant: 3 }), items: items({ elixir: 1 }), relic: 'tide_pearl' } },
    ],
    lore: 'The lake rose in a single night. The sisters kept singing until the water reached the bell rope.',
  },
  d_coast: {
    id: 'd_coast', seed: 3313, rooms: 6, stair: true, puzzles: ['lever', 'push', 'braziers'],
    puzzleHint: { lever: 'The smugglers’ winch still turns.', push: 'A heavy crate sits beside a pressure plate.', braziers: 'Signal lanterns. Light every one and the sea-door opens.' },
    common: ['clacker', 'sandclack', 'chompsy', 'whirlie', 'glub', 'skysail'], rare: ['grinfin', 'hobsnap'],
    boss: { species: 'grinfin', level: 15, adds: ['chompsy', 'chompsy'], scale: 2.2, title: 'Old Grin, Smugglers’ Bane', taunt: 'Something circles in the flooded hold. It is grinning.' },
    chests: [
      { room: 'side', reward: { gold: 380, items: items({ tonic: 2 }) } },
      { room: 'puzzle', reward: { orbs: orbs({ tide: 3, mystic: 2 }) } },
      { room: 'treasure', reward: { gold: 700, orbs: orbs({ radiant: 2 }), relic: 'binders_knot', egg: 'hobsnap' } },
      { room: 'boss', reward: { aether: 260, gold: 300, items: items({ mega_tonic: 2 }), relic: 'keen_monocle' } },
    ],
    lore: 'Tally of the Gull’s Share: forty barrels, nine chests, one lantern that must NEVER go out.',
  },
  d_marsh: {
    id: 'd_marsh', seed: 4421, rooms: 6, stair: true, puzzles: ['braziers', 'runes', 'lever'],
    puzzleHint: { braziers: 'Grave-candles, snuffed. The dead like a little light.', runes: 'Four names on the floor. The epitaph gives their order.', lever: 'A lever shaped like a finger bone.' },
    common: ['bonelet', 'skullbop', 'squeakwing', 'blorp', 'weblin', 'wisp'], rare: ['hexbones', 'rattlecloak'],
    boss: { species: 'bonewarden', level: 20, adds: ['hexbones'], scale: 2.0, title: 'The Hollow Warden', taunt: 'Bones rattle awake. The Warden has not blinked in four hundred years.' },
    chests: [
      { room: 'side', reward: { gold: 420, orbs: orbs({ dusk: 3 }) } },
      { room: 'puzzle', reward: { items: items({ cleanse: 2, ether: 2 }) } },
      { room: 'side', reward: { orbs: orbs({ dusk: 2, radiant: 1 }) } },
      { room: 'treasure', reward: { gold: 800, items: items({ void_stone: 1 }), relic: 'umbral_shard', egg: 'rattlecloak' } },
      { room: 'boss', reward: { aether: 320, orbs: orbs({ radiant: 3 }), items: items({ elixir: 2 }), relic: 'dream_lantern' } },
    ],
    lore: 'Here lie the Lamplighters of Mistveil. They asked to be buried facing the door, so they would see who came.',
  },
  d_scar: {
    id: 'd_scar', seed: 5531, rooms: 6, stair: true, puzzles: ['lever', 'push', 'braziers'],
    puzzleHint: { lever: 'The bellows lever. It still breathes heat.', push: 'An anvil block on rails, and a scorched plate.', braziers: 'The old forge-fires. Wake them and the vault door will follow.' },
    common: ['impling', 'cinderquid', 'grunt', 'scorchclaw', 'magmaglub', 'emberjaw'], rare: ['pyrox', 'hellion'],
    boss: { species: 'kilnback', level: 20, adds: ['impling', 'grunt'], scale: 1.9, title: 'Forgeheart Kilnback', taunt: 'The anvils shake. Something with a furnace for a heart is waking up.' },
    chests: [
      { room: 'side', reward: { gold: 450, orbs: orbs({ ember: 3 }) } },
      { room: 'puzzle', reward: { items: items({ tonic: 3, ether: 1 }), materials: { ore: 12 } } },
      { room: 'treasure', reward: { gold: 900, items: items({ fire_stone: 1 }), relic: 'cinder_brand', egg: 'pyrox' } },
      { room: 'boss', reward: { aether: 320, orbs: orbs({ radiant: 3 }), items: items({ mega_tonic: 3 }), relic: 'hammer_totem' } },
    ],
    lore: 'The smiths of the Scar worked for the Sky Wardens. The last order in the ledger: “Nine sockets. Make them hold.”',
  },
  d_elder: {
    id: 'd_elder', seed: 6607, rooms: 6, stair: true, puzzles: ['runes', 'braziers', 'lever'],
    puzzleHint: { runes: 'Four leaf-glyphs. The carving on the trunk shows the season they turn in.', braziers: 'Seed-lanterns wait for light.', lever: 'A living branch bent like a lever.' },
    common: ['thornet', 'honeybuzz', 'hissling', 'glenhart', 'saguardian', 'truffly'], rare: ['aurorhart', 'mycobloom'],
    boss: { species: 'glenhart', level: 25, adds: ['thornet', 'thornet'], scale: 1.9, title: 'The Heartwood Hart', taunt: 'The Elder Tree’s heart beats. Its keeper lowers its antlers.' },
    chests: [
      { room: 'side', reward: { gold: 600, items: items({ tonic: 4 }) } },
      { room: 'puzzle', reward: { orbs: orbs({ radiant: 2, mystic: 3 }) } },
      { room: 'treasure', reward: { gold: 1000, items: items({ leaf_stone: 1, wisdom_scroll: 1 }), relic: 'bramble_mail', egg: 'aurorhart' } },
      { room: 'boss', reward: { aether: 380, orbs: orbs({ radiant: 4 }), items: items({ elixir: 2 }), relic: 'vampire_fang' } },
    ],
    lore: 'The Elder Tree grew around a room it wanted to keep. Nobody remembers who built the room.',
  },
  d_dunes: {
    id: 'd_dunes', seed: 7717, rooms: 7, stair: true, puzzles: ['runes', 'push', 'lever'],
    puzzleHint: { runes: 'Four sun-glyphs. The mural shows the order the sun visits them.', push: 'A sarcophagus lid slid askew — and a pressure plate beside it.', lever: 'A lever cast as a jackal’s head.' },
    common: ['dustclaw', 'sandgloop', 'dunecat', 'sunbee', 'dustwhirl', 'bonelet'], rare: ['quakemaw', 'scorchclaw'],
    boss: { species: 'quakemaw', level: 25, adds: ['dustclaw', 'dustclaw'], scale: 1.55, title: 'The Tomb-King', taunt: 'Sand pours from the ceiling. The Tomb-King remembers when it ruled the dunes.' },
    chests: [
      { room: 'side', reward: { gold: 700, orbs: orbs({ ember: 2 }) } },
      { room: 'puzzle', reward: { items: items({ ether: 2, mega_tonic: 1 }) } },
      { room: 'side', reward: { gold: 500, materials: { crystal: 6 } } },
      { room: 'treasure', reward: { gold: 1400, items: items({ earth_stone: 1 }), relic: 'stone_idol', egg: 'quakemaw' } },
      { room: 'boss', reward: { aether: 420, orbs: orbs({ radiant: 4 }), items: items({ elixir: 2 }), relic: 'phoenix_plume' } },
    ],
    lore: 'Whoever is buried here was buried with everything. Everything is still here. So is whoever.',
  },
  d_peaks: {
    id: 'd_peaks', seed: 8821, rooms: 6, stair: true, puzzles: ['push', 'braziers', 'runes'],
    puzzleHint: { push: 'A block of ice rests on the glassy floor. The plate beyond is frozen shut.', braziers: 'Frost-lamps. Warm them and the ice-door will melt.', runes: 'Four frozen glyphs. The aurora painted on the wall shows their order.' },
    common: ['frostling', 'frostpeck', 'frostwisp', 'rimehorn', 'zapbee', 'shadekin'], rare: ['glaciator', 'blizzarf'],
    boss: { species: 'glaciator', level: 30, adds: ['frostling', 'frostling'], scale: 1.8, title: 'Frostfang', taunt: 'The cavern exhales. Frostfang has waited under the glacier since the last storm.' },
    chests: [
      { room: 'side', reward: { gold: 900, orbs: orbs({ radiant: 2 }) } },
      { room: 'puzzle', reward: { items: items({ ether: 3, tonic: 3 }) } },
      { room: 'treasure', reward: { gold: 1600, items: items({ wind_stone: 1 }), relic: 'frost_talisman', egg: 'blizzarf' } },
      { room: 'boss', reward: { aether: 480, orbs: orbs({ radiant: 5 }), items: items({ elixir: 3 }), relic: 'wind_step' } },
    ],
    lore: 'Skyhold’s first climbers sheltered here. Their carvings stop mid-sentence: “The ice is listening, so we—”',
  },
  d_hollows: {
    id: 'd_hollows', seed: 9931, rooms: 7, stair: true, puzzles: ['runes', 'lever', 'braziers'],
    puzzleHint: { runes: 'Four crystals set in the floor, each a different note. The vein on the wall hums the tune.', lever: 'A miners’ switch, sparking.', braziers: 'Crystal lamps, dark. Wake every one.' },
    common: ['cogling', 'tinkertot', 'whirrbit', 'voltarmor', 'gearbrute', 'stiltshot'], rare: ['arcannon', 'galegunner'],
    boss: { species: 'arcannon', level: 30, adds: ['cogling', 'cogling'], scale: 1.7, title: 'Heartstone Arcannon', taunt: 'The vein hums like a heart. Something ancient is plugged into it.' },
    chests: [
      { room: 'side', reward: { gold: 900, materials: { crystal: 10 } } },
      { room: 'puzzle', reward: { orbs: orbs({ radiant: 3 }) } },
      { room: 'side', reward: { items: items({ thunder_stone: 1 }) } },
      { room: 'treasure', reward: { gold: 1800, items: items({ wisdom_scroll: 1 }), relic: 'storm_feather', egg: 'galegunner' } },
      { room: 'boss', reward: { aether: 480, orbs: orbs({ radiant: 5 }), items: items({ elixir: 3 }), relic: 'burst_prism' } },
    ],
    lore: 'SHIFT LOG 1: vein sings at night. SHIFT LOG 2: vein sings in the day. SHIFT LOG 3: vein knows our names.',
  },
  d_crown: {
    id: 'd_crown', seed: 10111, rooms: 7, stair: true, puzzles: ['runes', 'braziers', 'lever'],
    puzzleHint: { runes: 'Four Guardian sigils are set in the floor. The Warden fresco shows their order.', braziers: 'Aether braziers. The Wardens lit them before every storm.', lever: 'A Warden’s lever of white gold.' },
    common: ['sparkmage', 'shinobi', 'voltarmor', 'xenobolt', 'hexbones', 'galegunner'], rare: ['thunderneck', 'aurorhart'],
    boss: { species: 'thunderneck', level: 35, adds: ['shinobi', 'voltarmor'], scale: 1.8, title: 'The Sanctum Sentinel', taunt: 'The storm above falls silent. The Sanctum is listening.' },
    chests: [
      { room: 'side', reward: { gold: 1200, orbs: orbs({ radiant: 3 }) } },
      { room: 'puzzle', reward: { items: items({ elixir: 2, ether: 2 }) } },
      { room: 'hall', reward: { items: items({ mega_tonic: 3 }) } },
      { room: 'treasure', reward: { gold: 2400, relic: 'aegis_locket', egg: 'thunderneck' } },
      { room: 'boss', reward: { aether: 800, orbs: orbs({ radiant: 6 }), relic: 'aether_well' } },
    ],
    lore: 'We sealed the storm beneath the Crown and set nine Guardians to keep the lock. If you are reading this, the lock is failing.',
  },
  d_starfall: {
    id: 'd_starfall', seed: 11213, rooms: 7, stair: true, puzzles: ['runes', 'push', 'braziers'],
    puzzleHint: { runes: 'Four star-plates. The constellation on the shard above shows their order.', push: 'A meteor fragment, still warm, beside a crater plate.', braziers: 'Star-shards, dim. Wake them all.' },
    common: ['zorp', 'xenobolt', 'moonhop', 'frostwisp', 'umbrajelly', 'galegunner'], rare: ['hobsnap', 'aurorhart', 'lanterngulp'],
    boss: { species: 'xenobolt', level: 36, adds: ['zorp', 'zorp'], scale: 2.1, title: 'The Starborn', taunt: 'The fallen star opens an eye. It has been trying to call home for a thousand years.' },
    chests: [
      { room: 'side', reward: { gold: 1400, orbs: orbs({ radiant: 3 }) } },
      { room: 'puzzle', reward: { items: items({ elixir: 2 }), materials: { crystal: 12 } } },
      { room: 'side', reward: { tickets: 1, aether: 200 } },
      { room: 'treasure', reward: { gold: 2600, items: items({ shimmer_incense: 1 }), relic: 'crown_of_ages', egg: 'aurorhart' } },
      { room: 'boss', reward: { aether: 1000, tickets: 2, orbs: orbs({ radiant: 6 }), relic: 'aether_well' } },
    ],
    lore: 'The star did not fall. It was thrown. Whatever threw it is still up there, and it is still aiming.',
  },
};
