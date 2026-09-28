// Named NPCs: story characters, town leaders, shopkeepers, quest givers, flavour townsfolk and the
// Hollow Veil. Actors are spawned by src/world/npcs.ts; talking goes through src/game/story.ts.
//
// Placement is data-driven. Town NPCs name a TOWN_ANCHORS spot from the towns workstream
// (`gate`, `plaza`, `guardPost`, `elderDoor`, `questBoard`, `shopCounter`, `specialtyCounter`,
// `healer`, `leader`, `bench1`…) and fall back to a compass bearing + distance from the plaza
// centre until those anchors exist. The actor layer nudges everyone clear of colliders.
import { ZONES } from './zones';
import type { ItemId } from './items';

/** KayKit adventurers share the villager pool; `char:*` are unique rigs from manifest.characters. */
export type NpcRig = 'knight' | 'barbarian' | 'rogue' | 'hooded' | 'char:maple' | 'char:vesper' | 'char:farmer' | 'char:steve';

export interface Anchor {
  /** Land whose town this NPC lives in (zone id). */
  town?: string;
  /** Named TOWN_ANCHORS spot; wins once the towns workstream exports it. */
  spot?: string;
  /** World-space nudge applied after the spot resolves. */
  off?: [number, number];
  /** Fallback: compass bearing (° from north, clockwise) and distance from the plaza centre. */
  bearing?: number;
  dist?: number;
  /** Absolute world position (NPCs outside towns). */
  at?: [number, number];
  /** Facing (compass °). Default: face the plaza centre / the player. */
  face?: number;
}

export type NpcRole = 'guard' | 'scholar' | 'rival' | 'villain' | 'veil' | 'leader' | 'shop' | 'giver' | 'flavor' | 'merchant';

export interface NpcDef {
  id: string;
  name: string;
  title: string;
  region: string;
  role: NpcRole;
  rig: NpcRig;
  scale?: number;
  /** Multiply tint for the rig's materials (Veil uniforms, variety). */
  tint?: string;
  anchor: Anchor;
  /** Rotating small-talk when there is no quest business. */
  lines: string[];
  /** Specialty/merchant shop opened by talking. */
  shop?: string;
  /** No world actor (e.g. the Outfitter keeper stands inside the service building). */
  actor?: false;
  /** Only appears while a quest step stages them. */
  staged?: boolean;
  /** Leaves the world once this quest is done. */
  goneAfter?: string;
  /** Gifts that make their day. */
  likes?: ItemId[];
}

const N = (d: NpcDef) => d;
const town = (z: string, spot: string, bearing: number, dist: number, off?: [number, number]): Anchor => ({ town: z, spot, bearing, dist, off });

export const NPCS: NpcDef[] = [
  // ── Hearthwick (Verdant Vale) ────────────────────────────────────────────
  N({ id: 'warden_brisa', name: 'Warden Brisa', title: 'Hearthwick Guard', region: 'vale', role: 'guard', rig: 'knight', anchor: { town: 'vale', spot: 'guardPost', at: [4.5, 603], face: 180 },
    lines: ['Twenty years on this gate. The gate has aged better than me.', 'If Kai asks, I did not cheer when you won. I cleared my throat. Loudly.', 'Rest at the Healer if your team looks tired. You look tired too, but I can’t fix that.'],
    likes: ['honey_cake'] }),
  N({ id: 'elder_maple', name: 'Elder Maple', title: 'Mystic Scholar', region: 'vale', role: 'scholar', rig: 'char:maple', anchor: town('vale', 'elderDoor', 285, 11),
    lines: ['Every Mystic is a question the island is asking. Isn’t that lovely?', 'I knew Aurel when she was younger than you. She had the same look — like the road owed her something.', 'Kai is a good boy. Loud, but good. Loud things usually are.'],
    likes: ['moon_lily', 'marsh_tea'] }),
  N({ id: 'rival_kai', name: 'Kai', title: 'Rival', region: 'vale', role: 'rival', rig: 'rogue', scale: 0.86, anchor: town('vale', 'elderDoor', 262, 12, [2.4, 1.6]),
    lines: ['I read the type chart again. Twice. Ask me anything.', 'One day they’ll put up a statue of me. Grandma says “don’t hold your breath”.', 'Want to battle? No? Okay. I’ll be here. Training. Intensely.'],
    likes: ['honey_cake', 'geode_candy'] }),
  N({ id: 'tobias_outfitter', name: 'Tobias', title: 'Hearthwick Outfitter', region: 'vale', role: 'shop', rig: 'barbarian', actor: false, shop: 'hearthwick_outfitter', anchor: town('vale', 'shopCounter', 0, 12), lines: ['Orbs, tonics, and a hat that would really suit you.'] }),
  N({ id: 'bramble_baker', name: 'Bramble', title: 'Baker', region: 'vale', role: 'shop', rig: 'char:farmer', shop: 'hearthwick_bakery', anchor: town('vale', 'specialtyCounter', 75, 11),
    lines: ['Honey cakes! Fresh this morning. Well — this week.', 'Mystics love a berry treat. So do I. That’s why the stock is low.'] }),
  N({ id: 'farmer_hask', name: 'Farmer Hask', title: 'Moolet Farmer', region: 'vale', role: 'giver', rig: 'char:farmer', scale: 1.02, anchor: town('vale', 'bench1', 140, 11),
    lines: ['Milk’s best at dawn. So are Moolets. Grumpy after lunch.', 'My Elsie named every Moolet we ever had. I still use her names.'], likes: ['meadow_posy'] }),
  N({ id: 'postmistress_ada', name: 'Postmistress Ada', title: 'Hearthwick Post', region: 'vale', role: 'giver', rig: 'hooded', anchor: town('vale', 'bench2', 200, 10),
    lines: ['Neither rain nor snow nor Guardian shall stay these letters. Well — Guardians did, for a year.', 'Write to your family, dear. Someone is always waiting for a letter.'] }),
  N({ id: 'lamplighter_jory', name: 'Old Jory', title: 'Lamplighter', region: 'vale', role: 'giver', rig: 'char:steve', anchor: town('vale', 'bench3', 235, 12),
    lines: ['Dusk is the best part of the day. Everything’s a little softer.', 'My father lit the Beacon. His father too. My daughter won’t. That’s alright.'] }),
  N({ id: 'nan_rosehip', name: 'Nan Rosehip', title: 'Hatchery Keeper', region: 'vale', role: 'giver', rig: 'hooded', scale: 0.94, anchor: town('vale', 'bench4', 20, 11),
    lines: ['Keep your eggs warm and your boots moving, dearie.', 'Fifty years, and every hatching still makes me cry. Good tears.'] }),
  N({ id: 'carpenter_edda', name: 'Edda', title: 'Carpenter', region: 'vale', role: 'giver', rig: 'barbarian', anchor: { at: [93, 604], face: 90 },
    lines: ['Measure twice, cut once, apologise to the tree.', 'That plot’s got good bones. Well — good dirt.'] }),
  N({ id: 'townsfolk_marta', name: 'Marta', title: 'Hearthwick Local', region: 'vale', role: 'flavor', rig: 'char:steve', scale: 0.97, anchor: town('vale', 'bench5', 165, 7),
    lines: ['They say the Crown storm is worse every year. They also say my pies are dry. They’re wrong about the pies.', 'Kai asked me to call him “Champion”. I call him “Kai”.'] }),

  // ── Stillwater (Mirror Lakes) ────────────────────────────────────────────
  N({ id: 'ferrywoman_ysolde', name: 'Ysolde', title: 'Stillwater Ferrywoman', region: 'lakes', role: 'leader', rig: 'hooded', anchor: town('lakes', 'leader', 0, 10),
    lines: ['Every ferry I’ve rowed, I’ve counted the stars in the water. Hundreds of thousands, now.', 'The lakes remember everyone who crosses them. Be someone worth remembering.'], likes: ['sea_glass'] }),
  N({ id: 'sten_outfitter', name: 'Sten', title: 'Stillwater Outfitter', region: 'lakes', role: 'shop', rig: 'barbarian', actor: false, shop: 'stillwater_outfitter', anchor: town('lakes', 'shopCounter', 0, 12), lines: ['Tide Orbs for the lake folk. Everything else for everyone.'] }),
  N({ id: 'angler_bo', name: 'Old Bo', title: 'Bait & Stones', region: 'lakes', role: 'shop', rig: 'char:farmer', shop: 'stillwater_bait', anchor: town('lakes', 'specialtyCounter', 60, 11),
    lines: ['Worms for the patient, glow bait for the impatient.', 'Caught a Bellowdeep once. It caught me back.'] }),
  N({ id: 'poet_linnea', name: 'Linnea', title: 'Poet', region: 'lakes', role: 'giver', rig: 'hooded', scale: 0.95, anchor: town('lakes', 'bench1', 120, 11),
    lines: ['“The lake is a sky that learned to lie down.” Too much? Too much.', 'Every poem is a letter to someone who can’t answer.'] }),
  N({ id: 'boatwright_oren', name: 'Oren', title: 'Boatwright', region: 'lakes', role: 'giver', rig: 'barbarian', anchor: town('lakes', 'bench2', 180, 11),
    lines: ['A boat is just a very brave plank.', 'Rowed across the Mirror blindfold once. Don’t recommend it.'] }),
  N({ id: 'twins_mira', name: 'Mira & Milo', title: 'Stillwater Twins', region: 'lakes', role: 'giver', rig: 'rogue', scale: 0.78, anchor: town('lakes', 'bench3', 270, 10),
    lines: ['Milo is ten minutes older and never lets me forget it.', 'We’re going to be Wayfarers. Both of us. On the same Mystic.'] }),
  N({ id: 'fisher_wendel', name: 'Wendel', title: 'Stillwater Local', region: 'lakes', role: 'flavor', rig: 'char:steve', anchor: town('lakes', 'bench4', 330, 9),
    lines: ['Fog rolls in at dusk. Fog rolls out at dawn. Fog has a better routine than me.'] }),

  // ── Tidewatch (Sapphire Coast) ───────────────────────────────────────────
  N({ id: 'captain_marlow', name: 'Captain Marlow', title: 'Keeper of Tidewatch Light', region: 'coast', role: 'leader', rig: 'knight', anchor: town('coast', 'leader', 0, 10),
    lines: ['A light is a promise: someone is awake, and someone is watching for you.', 'Gulls. Never trust a gull. They unionised in ’72.'], likes: ['sea_glass'] }),
  N({ id: 'nell_outfitter', name: 'Nell', title: 'Tidewatch Outfitter', region: 'coast', role: 'shop', rig: 'hooded', actor: false, shop: 'tidewatch_outfitter', anchor: town('coast', 'shopCounter', 0, 12), lines: ['Salt gets into everything. Even the prices.'] }),
  N({ id: 'charm_coral', name: 'Coral', title: 'Tide Charms', region: 'coast', role: 'shop', rig: 'hooded', scale: 0.96, shop: 'tidewatch_charms', anchor: town('coast', 'specialtyCounter', 60, 11),
    lines: ['Every charm has a little sea inside. Hold it to your ear.', 'Sea glass is just glass that’s been patient for a century.'] }),
  N({ id: 'diver_saoirse', name: 'Saoirse', title: 'Reef Diver', region: 'coast', role: 'giver', rig: 'rogue', anchor: town('coast', 'bench1', 120, 11),
    lines: ['Hold your breath, count to sixty, then count to sixty again. That’s diving.', 'The drowned village still has curtains in the windows.'] }),
  N({ id: 'fisher_tam', name: 'Tam', title: 'Young Fisher', region: 'coast', role: 'giver', rig: 'rogue', scale: 0.8, anchor: town('coast', 'bench2', 180, 10),
    lines: ['I’m going to catch a Bellowdeep. Mum says “in your dreams”. It happens in my dreams a LOT.'] }),
  N({ id: 'widow_rosalind', name: 'Rosalind', title: 'Keeper’s Widow', region: 'coast', role: 'giver', rig: 'char:steve', scale: 0.95, anchor: town('coast', 'bench3', 270, 10),
    lines: ['I still set two cups out. Habit. Or hope. They look the same after a while.'] }),
  N({ id: 'townsfolk_gil', name: 'Gil', title: 'Net Mender', region: 'coast', role: 'flavor', rig: 'char:farmer', anchor: town('coast', 'bench4', 330, 9),
    lines: ['A net is mostly holes. Same as a good story.'] }),

  // ── Mirehaven (Mistveil Marsh) ───────────────────────────────────────────
  N({ id: 'mother_sedge', name: 'Mother Sedge', title: 'Marsh Herbalist', region: 'marsh', role: 'leader', rig: 'hooded', scale: 0.93, anchor: town('marsh', 'leader', 0, 9),
    lines: ['Mind the fog, child. It’s older than all of us and twice as nosy.', 'Tea? It’s peat. It’s always peat.'], likes: ['marsh_tea', 'moon_lily'] }),
  N({ id: 'grell_outfitter', name: 'Grell', title: 'Mirehaven Outfitter', region: 'marsh', role: 'shop', rig: 'barbarian', actor: false, shop: 'mirehaven_outfitter', anchor: town('marsh', 'shopCounter', 0, 10), lines: ['Dry socks cost extra.'] }),
  N({ id: 'apothecary_moth', name: 'Moth', title: 'Apothecary', region: 'marsh', role: 'shop', rig: 'hooded', shop: 'mirehaven_apothecary', anchor: town('marsh', 'specialtyCounter', 60, 9),
    lines: ['Dusk Orbs and cures. The marsh gives, the marsh takes, I sell the difference.'] }),
  N({ id: 'lantern_fen', name: 'Fen', title: 'Young Lamplighter', region: 'marsh', role: 'giver', rig: 'rogue', scale: 0.8, anchor: town('marsh', 'bench1', 120, 9),
    lines: ['I’ve written forty-one names on my lantern. The fog can’t touch any of them.'] }),
  N({ id: 'nana_brine', name: 'Nana Brine', title: 'Soup Witch', region: 'marsh', role: 'giver', rig: 'char:steve', scale: 0.92, anchor: town('marsh', 'bench2', 180, 9),
    lines: ['Soup fixes everything except more soup.'] }),
  N({ id: 'ghost_ivy', name: 'Ivy', title: 'Pale Girl by the Water', region: 'marsh', role: 'giver', rig: 'rogue', scale: 0.74, tint: '#b8c8ff', goneAfter: 'side_marsh_ivy', anchor: town('marsh', 'bench3', 250, 11),
    lines: ['The lanterns were brighter when I was little. I think. I’m still little, aren’t I?'] }),
  N({ id: 'townsfolk_reed', name: 'Reed', title: 'Boardwalk Warden', region: 'marsh', role: 'flavor', rig: 'knight', anchor: town('marsh', 'bench4', 310, 8),
    lines: ['Keep to the planks. The mud keeps boots. Sometimes it keeps the rest of you.'] }),

  // ── Cinderrest (Ember Scar) ──────────────────────────────────────────────
  N({ id: 'forgemother_ashka', name: 'Forgemother Ashka', title: 'Mistress of the Forge', region: 'scar', role: 'leader', rig: 'barbarian', anchor: town('scar', 'leader', 0, 10),
    lines: ['Steel remembers every hammer blow. So do I. So be polite.', 'Cinderrest was built on a volcano on purpose. We like a challenge.'], likes: ['ember_pepper'] }),
  N({ id: 'brann_outfitter', name: 'Brann', title: 'Cinderrest Outfitter', region: 'scar', role: 'shop', rig: 'barbarian', actor: false, shop: 'cinderrest_outfitter', anchor: town('scar', 'shopCounter', 0, 12), lines: ['Everything’s fireproof. Probably.'] }),
  N({ id: 'relicsmith_oskar', name: 'Oskar', title: 'Relicsmith', region: 'scar', role: 'shop', rig: 'knight', shop: 'cinderrest_forge', anchor: town('scar', 'specialtyCounter', 60, 11),
    lines: ['A relic is a memory with a clasp on it.', 'Fire Stones, forge relics. No refunds. No refunds on fire.'] }),
  N({ id: 'apprentice_cole', name: 'Cole', title: 'Forge Apprentice', region: 'scar', role: 'giver', rig: 'rogue', scale: 0.88, anchor: town('scar', 'bench1', 120, 11),
    lines: ['I’ve burned my eyebrows off twice this week. Forgemother says that’s “progress”.'] }),
  N({ id: 'miner_dagny', name: 'Dagny', title: 'Seam Boss', region: 'scar', role: 'giver', rig: 'barbarian', anchor: town('scar', 'bench2', 180, 11),
    lines: ['Ore’s like people. The good stuff is always deeper down.'] }),
  N({ id: 'cook_pepper', name: 'Pepper', title: 'Cinderrest Cook', region: 'scar', role: 'giver', rig: 'char:farmer', anchor: town('scar', 'bench3', 270, 10),
    lines: ['If it doesn’t make you cry, it’s not stew. It’s soup.'] }),
  N({ id: 'townsfolk_ember', name: 'Emberly', title: 'Glassblower', region: 'scar', role: 'flavor', rig: 'hooded', anchor: town('scar', 'bench4', 330, 9),
    lines: ['I blow glass from sand the volcano cooks. The volcano doesn’t charge. Yet.'] }),

  // ── Elderhollow (Elderwood) ──────────────────────────────────────────────
  N({ id: 'oakspeaker_fenn', name: 'Oakspeaker Fenn', title: 'Voice of the Elderwood', region: 'elder', role: 'leader', rig: 'hooded', anchor: town('elder', 'leader', 0, 9),
    lines: ['Speak softly. The trees are light sleepers.', 'An old tree is a library that forgot how to talk.'], likes: ['meadow_posy'] }),
  N({ id: 'lark_outfitter', name: 'Lark', title: 'Elderhollow Outfitter', region: 'elder', role: 'shop', rig: 'rogue', actor: false, shop: 'elderhollow_outfitter', anchor: town('elder', 'shopCounter', 0, 10), lines: ['Everything here is sustainably foraged. Mostly by Mystics.'] }),
  N({ id: 'florist_briar', name: 'Briar', title: 'Florist', region: 'elder', role: 'shop', rig: 'char:farmer', scale: 0.96, shop: 'elderhollow_florist', anchor: town('elder', 'specialtyCounter', 60, 9),
    lines: ['Leaf Stones, hatch charms, and flowers that remember your name.'] }),
  N({ id: 'storyteller_wynn', name: 'Grandmother Wynn', title: 'Storyteller', region: 'elder', role: 'giver', rig: 'char:maple', scale: 0.9, tint: '#b8d0a8', anchor: town('elder', 'bench1', 120, 9),
    lines: ['Every story starts with “once”. Most of them end with “and then they had tea”.'] }),
  N({ id: 'ranger_holt', name: 'Ranger Holt', title: 'Forest Ranger', region: 'elder', role: 'giver', rig: 'knight', anchor: town('elder', 'bench2', 180, 10),
    lines: ['Thirty years walking these paths and they still move when I’m not looking.'] }),
  N({ id: 'girl_poppy', name: 'Poppy', title: 'Firefly Catcher', region: 'elder', role: 'giver', rig: 'rogue', scale: 0.74, anchor: town('elder', 'bench3', 250, 9),
    lines: ['I caught a firefly once! Then I let it go. It looked sad in the jar.'] }),
  N({ id: 'townsfolk_birch', name: 'Birch', title: 'Mushroom Farmer', region: 'elder', role: 'flavor', rig: 'char:steve', anchor: town('elder', 'bench4', 310, 8),
    lines: ['Mushrooms grow best in the dark with a little manure. Same as ambition.'] }),

  // ── Sunreach (Sunscorch Dunes) ───────────────────────────────────────────
  N({ id: 'caravan_queen_samira', name: 'Samira', title: 'Caravan Queen of Sunreach', region: 'dunes', role: 'leader', rig: 'hooded', anchor: town('dunes', 'leader', 0, 9),
    lines: ['A caravan is a town that refuses to sit still.', 'In the desert, water is money and shade is love.'], likes: ['desert_rose'] }),
  N({ id: 'omar_outfitter', name: 'Omar', title: 'Sunreach Outfitter', region: 'dunes', role: 'shop', rig: 'barbarian', actor: false, shop: 'sunreach_outfitter', anchor: town('dunes', 'shopCounter', 0, 10), lines: ['Sand in the orbs is free of charge.'] }),
  N({ id: 'gearsmith_zaid', name: 'Zaid', title: 'Desert Outfitter', region: 'dunes', role: 'shop', rig: 'char:farmer', shop: 'sunreach_gear', anchor: town('dunes', 'specialtyCounter', 60, 9),
    lines: ['Thunder Stones and desert gear. The dowsing rod twitches near secrets. So do I.'] }),
  N({ id: 'water_ines', name: 'Ines', title: 'Water Carrier', region: 'dunes', role: 'giver', rig: 'rogue', anchor: town('dunes', 'bench1', 120, 9),
    lines: ['Two jugs, eight miles, every morning. My shoulders have shoulders.'] }),
  N({ id: 'scholar_ptah', name: 'Scholar Ptah', title: 'Sand Scholar', region: 'dunes', role: 'giver', rig: 'hooded', scale: 0.97, anchor: town('dunes', 'bench2', 180, 10),
    lines: ['The desert is a book. Every dune is a page the wind keeps turning.'] }),
  N({ id: 'racer_kip', name: 'Kip', title: 'Dune Racer', region: 'dunes', role: 'giver', rig: 'rogue', scale: 0.9, anchor: town('dunes', 'bench3', 270, 9),
    lines: ['Fastest racer in Sunreach. Second fastest. Top five. I’m in the top five.'] }),
  N({ id: 'townsfolk_hadi', name: 'Hadi', title: 'Camel Whisperer', region: 'dunes', role: 'flavor', rig: 'char:steve', anchor: town('dunes', 'bench4', 320, 8),
    lines: ['The camels don’t like me. The camels don’t like anyone. That’s why we get along.'] }),

  // ── Skyhold (Stormreach Peaks) ───────────────────────────────────────────
  N({ id: 'abbot_halvard', name: 'Abbot Halvard', title: 'Abbot of Skyhold', region: 'peaks', role: 'leader', rig: 'char:maple', tint: '#c8c8e8', anchor: town('peaks', 'leader', 0, 10),
    lines: ['Up here the sky is close enough to argue with.', 'We ring the bells not to stop the storm, but to tell it we are listening.'], likes: ['snow_bloom'] }),
  N({ id: 'sigrid_outfitter', name: 'Sigrid', title: 'Skyhold Outfitter', region: 'peaks', role: 'shop', rig: 'knight', actor: false, shop: 'skyhold_outfitter', anchor: town('peaks', 'shopCounter', 0, 12), lines: ['Everything’s cold-rated. Except me. I’m cold.'] }),
  N({ id: 'quartermaster_eira', name: 'Eira', title: 'Quartermaster', region: 'peaks', role: 'shop', rig: 'knight', scale: 0.97, shop: 'skyhold_quarter', anchor: town('peaks', 'specialtyCounter', 60, 11),
    lines: ['Best gear on the island, for Wayfarers who’ve earned it.'] }),
  N({ id: 'bellringer_tomas', name: 'Brother Tomas', title: 'Bellringer', region: 'peaks', role: 'giver', rig: 'hooded', anchor: town('peaks', 'bench1', 120, 11),
    lines: ['A bell is only a stone that decided to sing.'] }),
  N({ id: 'mountaineer_greta', name: 'Greta', title: 'Mountaineer', region: 'peaks', role: 'giver', rig: 'barbarian', anchor: town('peaks', 'bench2', 180, 11),
    lines: ['Forty summits! I’ve left a sock on every one. Tradition.'] }),
  N({ id: 'novice_lio', name: 'Novice Lio', title: 'Monk in Training', region: 'peaks', role: 'giver', rig: 'rogue', scale: 0.84, anchor: town('peaks', 'bench3', 270, 10),
    lines: ['I meditated for an hour today! Well — I fell asleep. Deep meditation.'] }),
  N({ id: 'townsfolk_ulla', name: 'Ulla', title: 'Yak Herder', region: 'peaks', role: 'flavor', rig: 'char:farmer', anchor: town('peaks', 'bench4', 330, 9),
    lines: ['Up here you learn to love soup, wool and silence. In that order.'] }),

  // ── Glimmerhold (Glimmer Hollows) ────────────────────────────────────────
  N({ id: 'forewoman_brigid', name: 'Forewoman Brigid', title: 'Boss of the Mines', region: 'hollows', role: 'leader', rig: 'barbarian', anchor: town('hollows', 'leader', 0, 10),
    lines: ['Helmets on, heads down, hearts up. That’s the miner’s way.', 'The mountain gives us light. We try to deserve it.'], likes: ['geode_candy'] }),
  N({ id: 'dex_outfitter', name: 'Dex', title: 'Glimmerhold Outfitter', region: 'hollows', role: 'shop', rig: 'rogue', actor: false, shop: 'glimmerhold_outfitter', anchor: town('hollows', 'shopCounter', 0, 12), lines: ['Crystal-lit and fairly priced. Mostly crystal-lit.'] }),
  N({ id: 'jeweler_opal', name: 'Opal', title: 'Jeweller', region: 'hollows', role: 'shop', rig: 'hooded', shop: 'glimmerhold_jeweler', anchor: town('hollows', 'specialtyCounter', 60, 11),
    lines: ['Every gem is a little piece of the mountain’s patience.'] }),
  N({ id: 'miner_pim', name: 'Pim', title: 'Miner', region: 'hollows', role: 'giver', rig: 'char:steve', anchor: town('hollows', 'bench1', 120, 11),
    lines: ['Deepglow Mine hums at night. Don’t tell Brigid I sing along.'] }),
  N({ id: 'tinker_quill', name: 'Quill', title: 'Tinker', region: 'hollows', role: 'giver', rig: 'rogue', anchor: town('hollows', 'bench2', 180, 10),
    lines: ['I rebuilt a Cogling’s left foot. It walks in circles now. Proud circles.'] }),
  N({ id: 'widower_hal', name: 'Hal', title: 'Retired Miner', region: 'hollows', role: 'giver', rig: 'char:farmer', scale: 0.98, anchor: town('hollows', 'bench3', 270, 10),
    lines: ['Forty years under the mountain. She waited at the top every evening.'] }),
  N({ id: 'townsfolk_dot', name: 'Dot', title: 'Lamp Keeper', region: 'hollows', role: 'flavor', rig: 'hooded', scale: 0.9, anchor: town('hollows', 'bench4', 330, 9),
    lines: ['I keep six hundred crystal lamps lit. I have names for all of them.'] }),

  // ── Crownfall Camp (Aether Crown) ────────────────────────────────────────
  N({ id: 'scout_ren', name: 'Scout Ren', title: 'Crownfall Quartermaster', region: 'summit', role: 'giver', rig: 'knight', anchor: town('summit', 'leader', 30, 8),
    lines: ['Up here the air is thin and so are the jokes. Got any?', 'I’ve seen six sunrises from this camp. Every one better than the last.'] }),

  // ── Traveling merchant (a different town each day) ───────────────────────
  N({ id: 'merchant_pell', name: 'Pell', title: 'Traveling Merchant', region: 'vale', role: 'merchant', rig: 'char:farmer', scale: 1.04, tint: '#e8d0a8', shop: 'merchant', anchor: town('vale', 'market', 110, 13),
    lines: ['Rare goods for rare folk! Today only! Tomorrow, somewhere else!', 'I’ve walked every road on this island twice. The third time is for profit.'] }),

  // ── The Hollow Veil (staged by quests) ───────────────────────────────────
  N({ id: 'veil_nettle', name: 'Nettle', title: 'Veil Scout', region: 'vale', role: 'veil', rig: 'hooded', tint: '#7a6a9a', staged: true, anchor: { at: [-160, 760] }, lines: ['The Grove is closed. Very closed.'] }),
  N({ id: 'veil_marlo', name: 'Marlo', title: 'Veil Diver', region: 'lakes', role: 'veil', rig: 'hooded', tint: '#6a7aa8', staged: true, anchor: { at: [-424, 512] }, lines: ['Shh. Bottling a lake.'] }),
  N({ id: 'veil_skerry', name: 'Skerry', title: 'Veil Smuggler', region: 'coast', role: 'veil', rig: 'rogue', tint: '#6a7a9a', staged: true, anchor: { at: [462, 552] }, lines: ['Nothing to see here.'] }),
  N({ id: 'veil_morrow', name: 'Morrow', title: 'Veil Lamplighter', region: 'marsh', role: 'veil', rig: 'hooded', tint: '#6a8a7a', staged: true, anchor: { at: [-642, 124] }, lines: ['Let the fog sleep.'] }),
  N({ id: 'veil_cinder', name: 'Cinder', title: 'Veil Forgehand', region: 'scar', role: 'veil', rig: 'barbarian', tint: '#8a6a7a', staged: true, anchor: { at: [690, 192] }, lines: ['Mind the lantern.'] }),
  N({ id: 'veil_thistle', name: 'Thistle', title: 'Veil Pruner', region: 'elder', role: 'veil', rig: 'hooded', tint: '#7a8a6a', staged: true, anchor: { at: [-590, -332] }, lines: ['Snip, snip.'] }),
  N({ id: 'veil_sirocco', name: 'Sirocco', title: 'Veil Digger', region: 'dunes', role: 'veil', rig: 'barbarian', tint: '#9a8a6a', staged: true, anchor: { at: [512, -244] }, lines: ['Dig, dig.'] }),
  N({ id: 'veil_rime', name: 'Rime', title: 'Veil Climber', region: 'peaks', role: 'veil', rig: 'rogue', tint: '#8a9ab8', staged: true, anchor: { at: [-272, -652] }, lines: ['Hear that? Nothing. Lovely.'] }),
  N({ id: 'veil_facet', name: 'Facet', title: 'Veil Prospector', region: 'hollows', role: 'veil', rig: 'hooded', tint: '#8a7ab8', staged: true, anchor: { at: [252, -612] }, lines: ['Every crystal is a little lantern.'] }),
  N({ id: 'magister_vesper', name: 'Magister Vesper', title: 'Magister of the Hollow Veil', region: 'summit', role: 'villain', rig: 'char:vesper', staged: true, anchor: { at: [6, -4] },
    lines: ['Once, I lit lanterns so the Wardens could find their way home. Only one didn’t come back.'] }),
];

const BY_ID = new Map(NPCS.map((n) => [n.id, n]));
export const npcById = (id: string) => BY_ID.get(id);

/** Plaza centre of a land's town. */
export function townCentre(zoneId: string): [number, number] {
  const z = ZONES.find((zz) => zz.id === zoneId);
  return z ? [...z.town.pos] : [0, 0];
}

/** Compass bearing (° from north, clockwise) + distance → world XZ offset. North is −z. */
export const bearingOffset = (bearing: number, dist: number): [number, number] => {
  const r = (bearing * Math.PI) / 180;
  return [Math.sin(r) * dist, -Math.cos(r) * dist];
};

/** Data-only fallback position for an anchor (the actor layer may snap it to TOWN_ANCHORS). */
export function anchorFallback(a: Anchor): [number, number] {
  if (a.at) return [...a.at];
  const [cx, cz] = townCentre(a.town ?? 'vale');
  const [dx, dz] = bearingOffset(a.bearing ?? 0, a.dist ?? 10);
  return [cx + dx + (a.off?.[0] ?? 0), cz + dz + (a.off?.[1] ?? 0)];
}
