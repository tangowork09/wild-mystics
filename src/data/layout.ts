// World layout v3 — the designed skeleton every workstream builds on (see docs/v3/PLAN.md).
// Terrain generation must honour these positions (flatten/carve around them); quests, NPCs and
// the map reference them by id. Positions may be nudged by the world workstream for terrain
// fit, but ids are stable contracts.

/** Island & mountain macro shape. North is −z. */
export const ISLAND = {
  /** Mean coastline radius (m); the real coast wobbles ± `coastJitter` with bays and headlands. */
  coastRadius: 915,
  coastJitter: 70,
  /** Mount Aether: the central massif every land circles. */
  mountain: { center: [0, -40] as [number, number], footRadius: 330, summitHeight: 230, plateauRadius: 48 },
  /** Ring road radius through the eight towns. */
  ringRoadRadius: 560,
};

/** Spurs radiate from Mount Aether to the sea between neighbouring lands (bearings, degrees). */
export const SPURS: { between: [string, string]; bearing: number }[] = [
  { between: ['vale', 'lakes'], bearing: 200 },
  { between: ['lakes', 'marsh'], bearing: 240 },
  { between: ['marsh', 'elder'], bearing: 280 },
  { between: ['elder', 'peaks'], bearing: 320 },
  { between: ['peaks', 'hollows'], bearing: 0 },
  { between: ['hollows', 'dunes'], bearing: 40 },
  { between: ['dunes', 'scar'], bearing: 80 },
  { between: ['scar', 'coast'], bearing: 120 },
  { between: ['coast', 'vale'], bearing: 160 },
];

export type GateUnlock = { bosses: string[]; any?: boolean };

export interface GateDef {
  id: string;
  name: string;
  /** The two lands this pass joins. */
  joins: [string, string];
  pos: [number, number];
  /** Opens when these Guardians are answered (all, or any when `any`). */
  unlock: GateUnlock;
  /** Shown by the gate warden while sealed. */
  sealedText: string;
}

export const GATES: GateDef[] = [
  { id: 'g_vale_lakes', name: 'Willowmere Pass', joins: ['vale', 'lakes'], pos: [-192, 526], unlock: { bosses: ['vale'] }, sealedText: 'The Warden seal holds fast. Answer the Guardian of the Vale and the pass will open.' },
  { id: 'g_vale_coast', name: 'Saltwind Gate', joins: ['vale', 'coast'], pos: [192, 526], unlock: { bosses: ['vale'] }, sealedText: 'Sea-wind howls through the sealed gate. It opens for those the Vale Guardian has tested.' },
  { id: 'g_lakes_marsh', name: 'Fogfen Crossing', joins: ['lakes', 'marsh'], pos: [-485, 280], unlock: { bosses: ['lakes'] }, sealedText: 'Mist pours through the seal like water. The Abyssal Tyrant still keeps this crossing.' },
  { id: 'g_coast_scar', name: 'Cinder Stair', joins: ['coast', 'scar'], pos: [485, 280], unlock: { bosses: ['coast'] }, sealedText: 'The stair is sealed with sea-glass wards. Calm the Coast’s Guardian first.' },
  { id: 'g_marsh_elder', name: 'Rootgate', joins: ['marsh', 'elder'], pos: [-551, -97], unlock: { bosses: ['marsh'] }, sealedText: 'Roots knot across the path. The Bog Sovereign must be answered before the forest lets you pass.' },
  { id: 'g_scar_dunes', name: 'Obsidian Arch', joins: ['scar', 'dunes'], pos: [551, -97], unlock: { bosses: ['scar'] }, sealedText: 'Heat shimmers across a wall of black glass. The Ashen Totem holds the key.' },
  { id: 'g_elder_peaks', name: 'Frostbark Gate', joins: ['elder', 'peaks'], pos: [-360, -429], unlock: { bosses: ['elder'] }, sealedText: 'Frost and bark lock the gate. The Elderwood’s Guardian decides who climbs.' },
  { id: 'g_dunes_hollows', name: 'Glassway', joins: ['dunes', 'hollows'], pos: [360, -429], unlock: { bosses: ['dunes'] }, sealedText: 'Sand drifts over a sealed glass door. The Sandjaw Colossus must wake and yield.' },
  { id: 'g_peaks_hollows', name: 'Skybridge', joins: ['peaks', 'hollows'], pos: [0, -560], unlock: { bosses: ['peaks', 'hollows'], any: true }, sealedText: 'The bridge of light is dark. Answer either northern Guardian to kindle it.' },
  { id: 'g_crown', name: 'The Crown Gate', joins: ['vale', 'summit'], pos: [0, 292], unlock: { bosses: ['vale', 'lakes', 'coast', 'marsh', 'scar', 'elder', 'dunes', 'peaks', 'hollows'] }, sealedText: 'Nine empty sockets ring the great door. Every Guardian’s sigil is needed to climb the Crown.' },
];

export interface DungeonDef {
  id: string;
  name: string;
  region: string;
  /** Overworld entrance (a cave mouth, ruin stair or hollow tree). */
  entrance: [number, number];
  levels: [number, number];
  /** Hidden entrances only show on the map once found; `reveal` says how. */
  hidden: boolean;
  reveal?: 'night' | 'search' | 'quest' | 'item';
  theme: 'burrow' | 'chapel' | 'grotto' | 'crypt' | 'forge' | 'heartwood' | 'tomb' | 'ice' | 'geode' | 'sanctum' | 'starfall';
  hint: string;
}

export const DUNGEONS: DungeonDef[] = [
  { id: 'd_vale', name: 'Rootway Burrow', region: 'vale', entrance: [-212, 740], levels: [6, 9], hidden: false, theme: 'burrow', hint: 'Under the Old Grove, roots have dug a burrow bigger than any Mystic.' },
  { id: 'd_lakes', name: 'Drowned Chapel', region: 'lakes', entrance: [-470, 600], levels: [11, 14], hidden: true, reveal: 'search', theme: 'chapel', hint: 'Bells ring behind the tallest waterfall at dusk.' },
  { id: 'd_coast', name: 'Smuggler’s Grotto', region: 'coast', entrance: [560, 690], levels: [11, 14], hidden: true, reveal: 'search', theme: 'grotto', hint: 'A lantern glows in the sea cliffs where no path goes.' },
  { id: 'd_marsh', name: 'Hollow Crypt', region: 'marsh', entrance: [-700, 200], levels: [16, 19], hidden: true, reveal: 'night', theme: 'crypt', hint: 'The crypt door only shows itself under the moon.' },
  { id: 'd_scar', name: 'Magma Forge', region: 'scar', entrance: [700, 200], levels: [16, 19], hidden: false, theme: 'forge', hint: 'The old smiths worked in the belly of the caldera.' },
  { id: 'd_elder', name: 'Heartwood Hollow', region: 'elder', entrance: [-600, -330], levels: [21, 24], hidden: true, reveal: 'quest', theme: 'heartwood', hint: 'The Elder Tree opens for those the forest trusts.' },
  { id: 'd_dunes', name: 'Tomb of Sands', region: 'dunes', entrance: [610, -330], levels: [21, 24], hidden: false, theme: 'tomb', hint: 'A half-buried pyramid in the deep dunes.' },
  { id: 'd_peaks', name: 'Frostfang Caverns', region: 'peaks', entrance: [-300, -680], levels: [26, 29], hidden: false, theme: 'ice', hint: 'Blue ice caves under the glacier.' },
  { id: 'd_hollows', name: 'Geode Heart', region: 'hollows', entrance: [300, -680], levels: [26, 29], hidden: true, reveal: 'search', theme: 'geode', hint: 'Miners whisper of a vein that hums like a heart.' },
  { id: 'd_crown', name: 'Aether Sanctum', region: 'summit', entrance: [0, -12], levels: [32, 35], hidden: false, theme: 'sanctum', hint: 'The Sky Wardens sealed their sanctum under the summit ruins.' },
  { id: 'd_starfall', name: 'Starfall Grotto', region: 'coast', entrance: [700, 760], levels: [30, 35], hidden: true, reveal: 'item', theme: 'starfall', hint: 'A fallen star lies on an islet off the Sapphire Coast. The sandbar shows at low tide.' },
];

/** Named points of interest used by quests, the map and discovery (region-scoped). */
export interface PoiDef { id: string; name: string; region: string; pos: [number, number]; kind: 'vista' | 'ruin' | 'shrine' | 'grove' | 'lighthouse' | 'mine' | 'oasis' | 'camp' | 'landmark' }

export const POIS: PoiDef[] = [
  { id: 'p_meadow', name: 'Whisperwind Meadow', region: 'vale', pos: [120, 700], kind: 'grove' },
  { id: 'p_oldgrove', name: 'The Old Grove', region: 'vale', pos: [-170, 770], kind: 'grove' },
  { id: 'p_windmill', name: 'Miller’s Rise', region: 'vale', pos: [-80, 610], kind: 'vista' },
  { id: 'p_beacon', name: 'Vale Beacon', region: 'vale', pos: [60, 840], kind: 'landmark' },
  { id: 'p_mirror', name: 'The Mirror', region: 'lakes', pos: [-430, 520], kind: 'vista' },
  { id: 'p_falls', name: 'Silverfall', region: 'lakes', pos: [-470, 590], kind: 'landmark' },
  { id: 'p_lighthouse', name: 'Tidewatch Light', region: 'coast', pos: [470, 560], kind: 'lighthouse' },
  { id: 'p_reef', name: 'Bellreef Shallows', region: 'coast', pos: [600, 640], kind: 'vista' },
  { id: 'p_boardwalk', name: 'Lantern Boardwalk', region: 'marsh', pos: [-650, 130], kind: 'ruin' },
  { id: 'p_caldera', name: 'Caldera Rim', region: 'scar', pos: [720, 110], kind: 'vista' },
  { id: 'p_eldertree', name: 'The Elder Tree', region: 'elder', pos: [-600, -340], kind: 'grove' },
  { id: 'p_oasis', name: 'Last Oasis', region: 'dunes', pos: [520, -250], kind: 'oasis' },
  { id: 'p_glacier', name: 'Skyhold Glacier', region: 'peaks', pos: [-280, -660], kind: 'vista' },
  { id: 'p_mine', name: 'Deepglow Mine', region: 'hollows', pos: [260, -620], kind: 'mine' },
  { id: 'p_ruins', name: 'Sky Warden Ruins', region: 'summit', pos: [0, -40], kind: 'ruin' },
];
