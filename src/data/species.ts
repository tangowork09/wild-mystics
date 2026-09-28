import { ELEMENTS, type Element } from './elements';
import { PINCH, type AbilityId, type Rarity } from './traits';
import type { ItemId } from './items';
import type { AccSpec } from '../assets/accessories';

export type BodyType = 'quad' | 'blob' | 'bird' | 'serpent' | 'golem';

/** Procedural placeholder description, used only when a species has no GLB in the manifest. */
export interface Look {
  body: BodyType;
  color: string;
  accent: string;
  size: number;
  horns?: number;
  spikes?: boolean;
  wings?: boolean;
  tail?: boolean;
  leaves?: boolean;
  glow?: string;
}

/** Evolution route: by level, by using a stone, and/or only at a time of day. */
export interface Evo { id: string; level?: number; item?: ItemId; time?: 'day' | 'night' }

export interface Species {
  id: string;
  name: string;
  element: Element;
  base: { hp: number; atk: number; def: number; spd: number };
  /** Skills unlocked by level: [level, skillId]. */
  learnset: [number, string][];
  catchRate: number;
  rarity: Rarity;
  /** Two possible abilities; each Mystic rolls one. */
  abilities: AbilityId[];
  evolves: Evo[];
  boss?: boolean;
  /** Regional/elemental variant of another species (shown in the dex beside it). */
  variantOf?: string;
  /** Can be ridden in the overworld once caught (large, sturdy Mystics). */
  rideable?: boolean;
  /** Aquatic: hovers/swims in the air in battle, only appears via fishing or water. */
  swim?: boolean;
  /** World height in metres (models are normalised to this). */
  height: number;
  /** Source model key, see tools/import-assets.mjs. */
  model: string;
  /** Variant recolour applied to the source model (regional / elemental forms). */
  tint?: string;
  tintGlow?: string;
  /** v3: recolour greys too (stone / bone / white fur) and lightness pull toward the tint (0.15 default). */
  tintAll?: boolean;
  tintL?: number;
  look: Look;
  lore: string;
  /** v3: secondary element (dual-type Guardians). Damage multiplies both matchups. */
  element2?: Element;
  /** v3: procedural accessories attached to bones (crystals, leaf crowns, horns, shells, bells…). */
  acc?: AccSpec[];
  /** v3: overworld behaviour override (see wilds.ts archetypes). */
  behavior?: 'grazer' | 'skittish' | 'curious' | 'territorial' | 'flyer' | 'swimmer';
  /** v3: moves in herds / packs of this many (min–max). */
  herd?: [number, number];
  /** @deprecated use `evolves` — kept so data rows stay terse. */
  evolvesTo?: { id: string; level: number };
}

type Extra = Partial<Omit<Species, 'abilities'>> & { abilities?: AbilityId[] };
type Row = [id: string, name: string, el: Element, hp: number, atk: number, def: number, spd: number, height: number, model: string, learn: [number, string][], extra?: Extra];

const BODY: Record<string, BodyType> = { fire: 'quad', water: 'blob', nature: 'blob', earth: 'golem', storm: 'quad', wind: 'bird', void: 'serpent' };
const SECOND: Record<Element, AbilityId> = { fire: 'flame_body', water: 'regenerator', nature: 'sleep_spores', earth: 'sturdy', storm: 'static', wind: 'swift', void: 'opportunist' };

function make([id, name, element, hp, atk, def, spd, height, model, learnset, extra]: Row, lore: string): Species {
  const c = ELEMENTS[element].color;
  const evolves: Evo[] = extra?.evolves ?? (extra?.evolvesTo ? [{ id: extra.evolvesTo.id, level: extra.evolvesTo.level }] : []);
  return {
    id, name, element, base: { hp, atk, def, spd }, learnset, catchRate: 0.35, height, model, lore,
    rarity: 'common', abilities: [PINCH[element], SECOND[element]],
    look: { body: BODY[element], color: c, accent: '#ffffff', size: Math.max(0.7, height / 1.4), glow: element === 'void' ? c : undefined },
    ...extra,
    evolves,
  } as Species;
}

const LIST: [Row, string][] = [
  // ── Starters ────────────────────────────────────────────────────────────
  [['emberling', 'Emberling', 'fire', 50, 16, 10, 15, 1.1, 'Dragon', [[1, 'ember_bite'], [4, 'kindle'], [8, 'flame_wheel'], [11, 'flare_burst'], [13, 'cinder_claw'], [18, 'meteor_fang']], { evolvesTo: { id: 'pyrowyrm', level: 16 }, catchRate: 0.2, rarity: 'rare', abilities: ['blaze', 'momentum'] }], 'A hatchling drake whose sneezes start campfires.'],
  [['pyrowyrm', 'Pyrowyrm', 'fire', 70, 22, 14, 18, 2.2, 'Dragon Evolved', [[1, 'ember_bite'], [1, 'kindle'], [1, 'flare_burst'], [13, 'cinder_claw'], [18, 'meteor_fang']], { catchRate: 0.05, rarity: 'epic', abilities: ['blaze', 'momentum'] }], 'Its wingbeat leaves trails of falling embers.'],
  [['finnik', 'Finnik', 'water', 56, 14, 12, 14, 1.1, 'Fish:small', [[1, 'tide_lash'], [4, 'bubble_veil'], [8, 'aqua_jet'], [11, 'scald'], [12, 'mend_rain'], [18, 'riptide']], { evolvesTo: { id: 'tidecaller', level: 16 }, catchRate: 0.2, rarity: 'rare', abilities: ['torrent', 'keen_eye'] }], 'A curious fish that learned to walk to see the sky.'],
  [['tidecaller', 'Tidecaller', 'water', 78, 18, 17, 16, 2.0, 'Fish:elite', [[1, 'tide_lash'], [1, 'bubble_veil'], [1, 'aqua_jet'], [12, 'mend_rain'], [18, 'riptide']], { catchRate: 0.05, rarity: 'epic', abilities: ['torrent', 'keen_eye'] }], 'Commands the currents with a wave of its fins.'],
  [['sporelet', 'Sporelet', 'nature', 60, 13, 13, 12, 1.0, 'Mushnub', [[1, 'thorn_volley'], [4, 'bloom'], [7, 'sleep_spore'], [8, 'vine_snare'], [14, 'grove_wrath']], { evolvesTo: { id: 'mycobloom', level: 12 }, catchRate: 0.2, rarity: 'rare', abilities: ['overgrow', 'regenerator'] }], 'Naps in sunbeams. Photosynthesises dreams.'],
  [['mycobloom', 'Mycobloom', 'nature', 74, 16, 16, 13, 1.4, 'Mushnub Evolved', [[1, 'thorn_volley'], [1, 'bloom'], [8, 'vine_snare'], [14, 'grove_wrath']], { evolvesTo: { id: 'sporeking', level: 24 }, catchRate: 0.08, rarity: 'epic', abilities: ['overgrow', 'regenerator'] }], 'Releases calming spores when its friends are hurt.'],
  [['sporeking', 'Sporeking', 'nature', 92, 20, 20, 14, 2.1, 'Mushroom King', [[1, 'thorn_volley'], [1, 'bloom'], [1, 'vine_snare'], [14, 'grove_wrath']], { catchRate: 0.03, rarity: 'exotic', abilities: ['overgrow', 'guardian_aura'], rideable: true }], 'Crowned by the forest itself. Every mushroom bows.'],

  // ── Verdant Vale ────────────────────────────────────────────────────────
  [['gloop', 'Gloop', 'nature', 58, 12, 12, 11, 0.9, 'Green Blob', [[1, 'thorn_volley'], [5, 'bloom']], { evolvesTo: { id: 'spikegloop', level: 10 }, catchRate: 0.5 }], 'A wobbly blob of moss that hums when happy.'],
  [['spikegloop', 'Spikegloop', 'nature', 70, 16, 16, 11, 1.3, 'Green Spiky Blob', [[1, 'thorn_volley'], [5, 'bloom'], [10, 'vine_snare']], { catchRate: 0.25 }], 'Grew thorns after being sat on one too many times.'],
  [['chirpling', 'Chirpling', 'wind', 48, 13, 9, 18, 0.9, 'Birb', [[1, 'gale_cut'], [5, 'feather_dart'], [10, 'tailwind']], { catchRate: 0.5 }], 'Round, fluffy, and absolutely certain it is a hawk.'],
  [['pecklet', 'Pecklet', 'earth', 54, 14, 12, 12, 0.9, 'Chicken', [[1, 'rock_toss'], [6, 'stone_skin']], { catchRate: 0.5 }], 'Pecks pebbles all day. Swallows the shiny ones.'],
  [['hopscotch', 'Hopscotch', 'wind', 56, 15, 11, 17, 1.4, 'Bunny', [[1, 'gale_cut'], [6, 'tailwind'], [11, 'cyclone']], { catchRate: 0.35 }], 'Leaps so high it naps on clouds.'],
  [['pricklet', 'Pricklet', 'nature', 58, 14, 15, 9, 0.9, 'Cactoro:small', [[1, 'thorn_volley'], [6, 'vine_snare']], { evolvesTo: { id: 'saguardian', level: 15 }, catchRate: 0.45 }], 'Hugs are not recommended.'],
  [['saguardian', 'Saguardian', 'nature', 76, 18, 20, 10, 1.9, 'Cactoro:elite', [[1, 'thorn_volley'], [1, 'vine_snare'], [15, 'grove_wrath']], { catchRate: 0.15 }], 'Stands watch over desert springs for centuries.'],
  [['voltcat', 'Voltcat', 'storm', 50, 15, 10, 20, 0.9, 'Cat', [[1, 'spark_jab'], [5, 'thunder_wave'], [8, 'overcharge'], [10, 'thunderclap']], { catchRate: 0.4 }], 'Static fur. Do not pet in dry weather.'],
  [['monkroose', 'Monkroose', 'earth', 64, 17, 14, 15, 1.5, 'Monkroose', [[1, 'rock_toss'], [5, 'boulder_slam'], [10, 'tremor']], { catchRate: 0.3 }], 'Juggles river stones to impress rivals.'],

  // ── Ember Scar ──────────────────────────────────────────────────────────
  [['impling', 'Impling', 'fire', 50, 16, 10, 17, 1.0, 'Demon:small', [[1, 'ember_bite'], [5, 'kindle'], [7, 'flame_wheel'], [9, 'flare_burst']], { evolvesTo: { id: 'hellion', level: 14 }, catchRate: 0.4 }], 'Mischief given wings and a tiny pitchfork.'],
  [['hellion', 'Hellion', 'fire', 68, 21, 14, 17, 1.9, 'Demon:elite', [[1, 'ember_bite'], [1, 'kindle'], [9, 'flare_burst'], [14, 'cinder_claw']], { catchRate: 0.12 }], 'Its laugh crackles like a forest fire.'],
  [['gloomling', 'Gloomling', 'void', 52, 16, 11, 17, 1.0, 'Goleling', [[1, 'shadow_claw'], [4, 'venom_fang'], [7, 'hypno_glow'], [10, 'umbral_wave']], { evolvesTo: { id: 'gloomlord', level: 14 }, catchRate: 0.35 }], 'Hangs from cave ceilings, giggling at echoes.'],
  [['gloomlord', 'Gloomlord', 'void', 70, 21, 15, 18, 1.7, 'Goleling Evolved', [[1, 'shadow_claw'], [1, 'soul_siphon'], [10, 'umbral_wave'], [16, 'static_field']], { catchRate: 0.1 }], 'Wears a crown it swears it did not steal.'],
  [['grunt', 'Grunt', 'earth', 62, 16, 14, 11, 1.0, 'Orc Enemy', [[1, 'rock_toss'], [6, 'boulder_slam']], { evolvesTo: { id: 'warlord', level: 15 }, catchRate: 0.4 }], 'Small, loud, and fiercely loyal.'],
  [['warlord', 'Warlord', 'earth', 80, 21, 18, 12, 2.0, 'Orc', [[1, 'rock_toss'], [1, 'boulder_slam'], [15, 'tremor']], { catchRate: 0.12 }], 'Wears the scars of a hundred friendly duels.'],
  [['cinderquid', 'Cinderquid', 'fire', 56, 17, 12, 15, 1.2, 'Squidle', [[1, 'ember_bite'], [6, 'flare_burst'], [11, 'kindle']], { catchRate: 0.3 }], 'Swims through lava as if it were bathwater.'],

  // ── Mirror Lakes ────────────────────────────────────────────────────────
  [['glub', 'Glub', 'water', 58, 13, 13, 12, 1.0, 'Glub', [[1, 'tide_lash'], [5, 'bubble_veil'], [9, 'aqua_jet']], { evolvesTo: { id: 'glubbernaut', level: 12 }, catchRate: 0.45 }], 'Blows bubbles in patterns only it understands.'],
  [['glubbernaut', 'Glubbernaut', 'water', 76, 17, 17, 13, 1.7, 'Glub Evolved', [[1, 'tide_lash'], [1, 'bubble_veil'], [9, 'aqua_jet'], [14, 'riptide']], { catchRate: 0.15 }], 'Patrols the deep lakes in a shell of pressure.'],
  [['croakus', 'Croakus', 'water', 64, 15, 13, 14, 1.4, 'Frog', [[1, 'aqua_jet'], [6, 'mend_rain'], [11, 'riptide']], { catchRate: 0.35 }], 'Its croak can be heard three lakes away.'],
  [['bubblin', 'Bubblin', 'water', 56, 12, 14, 10, 0.8, 'Pink Slime', [[1, 'tide_lash'], [5, 'mend_rain'], [9, 'bubble_veil'], [12, 'purify']], { catchRate: 0.5, evolves: [{ id: 'magmallow', item: 'fire_stone' }, { id: 'mosslime', item: 'leaf_stone' }, { id: 'zapjelly', item: 'thunder_stone' }, { id: 'umbrajelly', item: 'void_stone', time: 'night' }] }], 'Tastes like strawberries. Please do not check.'],
  [['alpuff', 'Alpuff', 'wind', 58, 13, 13, 15, 1.1, 'Alpaking', [[1, 'gale_cut'], [5, 'tailwind'], [9, 'feather_dart']], { evolvesTo: { id: 'alpaqueen', level: 14 }, catchRate: 0.4 }], 'So fluffy the wind carries it like a dandelion.'],
  [['alpaqueen', 'Alpaqueen', 'wind', 76, 17, 16, 17, 1.8, 'Alpaking Evolved', [[1, 'gale_cut'], [1, 'tailwind'], [9, 'feather_dart'], [14, 'cyclone']], { catchRate: 0.12 }], 'Rules the high meadows with a gentle hoof.'],
  [['whirlie', 'Whirlie', 'water', 54, 15, 11, 17, 1.2, 'Hywirl', [[1, 'tide_lash'], [6, 'aqua_jet'], [11, 'riptide']], { catchRate: 0.35 }], 'Spins whirlpools for fun. Boats disagree.'],

  // ── Stormreach Peaks ────────────────────────────────────────────────────
  [['zapbee', 'Zapbee', 'storm', 50, 15, 11, 19, 0.9, 'Armabee', [[1, 'spark_jab'], [5, 'thunder_wave'], [9, 'static_field'], [12, 'spark_storm']], { evolvesTo: { id: 'voltarmor', level: 14 }, catchRate: 0.4 }], 'Its buzz is literally electric.'],
  [['voltarmor', 'Voltarmor', 'storm', 70, 19, 17, 19, 1.6, 'Armabee Evolved', [[1, 'spark_jab'], [1, 'overcharge'], [9, 'static_field'], [14, 'thunderclap']], { catchRate: 0.12 }], 'Plated in storm-forged chitin.'],
  [['zorp', 'Zorp', 'storm', 52, 16, 10, 17, 1.0, 'Alien:small', [[1, 'spark_jab'], [6, 'static_field']], { evolvesTo: { id: 'xenobolt', level: 16 }, catchRate: 0.35 }], 'Fell from a lightning bolt. Wants to go home.'],
  [['xenobolt', 'Xenobolt', 'storm', 70, 21, 15, 18, 1.9, 'Alien:elite', [[1, 'spark_jab'], [1, 'static_field'], [16, 'thunderclap']], { catchRate: 0.1 }], 'Channels the sky through its antenna.'],
  [['frostling', 'Frostling', 'wind', 60, 15, 14, 13, 1.0, 'Yeti:small', [[1, 'gale_cut'], [6, 'frost_breath'], [9, 'bubble_veil'], [11, 'cyclone']], { evolvesTo: { id: 'glaciator', level: 16 }, catchRate: 0.35 }], 'Builds snow forts and defends them to the end.'],
  [['glaciator', 'Glaciator', 'wind', 84, 20, 19, 12, 2.1, 'Yeti:elite', [[1, 'gale_cut'], [1, 'bubble_veil'], [11, 'cyclone'], [16, 'boulder_slam']], { catchRate: 0.1 }], 'An avalanche with opinions.'],
  [['shadekin', 'Shadekin', 'wind', 50, 17, 9, 21, 1.0, 'Ninja:small', [[1, 'gale_cut'], [5, 'shadow_claw'], [10, 'feather_dart']], { evolvesTo: { id: 'shinobi', level: 15 }, catchRate: 0.35 }], 'You will not see it coming. It is very proud of this.'],
  [['shinobi', 'Shinobi', 'wind', 66, 22, 13, 23, 1.8, 'Ninja:elite', [[1, 'gale_cut'], [1, 'shadow_claw'], [10, 'feather_dart'], [15, 'cyclone']], { catchRate: 0.1 }], 'Strikes between heartbeats.'],
  [['sparkmage', 'Sparkmage', 'storm', 54, 18, 11, 15, 1.0, 'Wizard', [[1, 'spark_jab'], [4, 'thunder_wave'], [7, 'static_field'], [10, 'spark_storm'], [14, 'thunderclap']], { catchRate: 0.3 }], 'Studied lightning at a school that no longer exists.'],
  [['wisp', 'Wisp', 'void', 52, 17, 11, 18, 1.1, 'Ghost', [[1, 'shadow_claw'], [5, 'hypno_glow'], [8, 'soul_siphon'], [12, 'toxic_mist']], { catchRate: 0.2 }], 'A lantern-light that follows lost travellers home.'],

  // ── Bubblin's branching family (evolves by stone) ───────────────────────
  [['magmallow', 'Magmallow', 'fire', 66, 18, 14, 13, 1.1, 'Pink Slime', [[1, 'ember_bite'], [1, 'mend_rain'], [10, 'flare_burst'], [18, 'meteor_fang']], { rarity: 'epic', catchRate: 0.1, tint: '#ff6a2a', tintGlow: '#ff4a0a', abilities: ['flame_body', 'blaze'], variantOf: 'bubblin' }], 'Bubblin touched by a Fire Stone. Its core simmers like syrup.'],
  [['mosslime', 'Mosslime', 'nature', 72, 14, 17, 12, 1.1, 'Pink Slime', [[1, 'thorn_volley'], [1, 'bloom'], [10, 'vine_snare'], [18, 'grove_wrath']], { rarity: 'epic', catchRate: 0.1, tint: '#5ab84a', abilities: ['regenerator', 'sleep_spores'], variantOf: 'bubblin' }], 'Bubblin touched by a Leaf Stone. Flowers grow inside it.'],
  [['zapjelly', 'Zapjelly', 'storm', 60, 17, 12, 17, 1.1, 'Pink Slime', [[1, 'spark_jab'], [1, 'mend_rain'], [10, 'static_field'], [18, 'thunderclap']], { rarity: 'epic', catchRate: 0.1, tint: '#ffd84a', tintGlow: '#fff17a', abilities: ['static', 'surge'], variantOf: 'bubblin' }], 'Bubblin touched by a Thunder Stone. It hums at 60 hertz.'],
  [['umbrajelly', 'Umbrajelly', 'void', 62, 17, 13, 15, 1.1, 'Pink Slime', [[1, 'shadow_claw'], [1, 'soul_siphon'], [10, 'umbral_wave'], [18, 'static_field']], { rarity: 'exotic', catchRate: 0.06, tint: '#4a2a7a', tintGlow: '#b36bff', abilities: ['opportunist', 'umbra'], variantOf: 'bubblin' }], 'Bubblin exposed to a Void Stone under a new moon.'],

  // ── Regional forms: the same families, reshaped by each land ──────────────
  [['sandgloop', 'Sandgloop', 'earth', 64, 13, 16, 9, 0.9, 'Green Blob', [[1, 'rock_toss'], [5, 'stone_skin'], [10, 'tremor']], { rarity: 'rare', tint: '#c8a060', variantOf: 'gloop', abilities: ['bedrock', 'thick_hide'] }], 'Gloop that rolled into the Dunes and never rolled out.'],
  [['frostpeck', 'Frostpeck', 'wind', 58, 15, 14, 14, 0.9, 'Chicken', [[1, 'gale_cut'], [6, 'feather_dart'], [11, 'cyclone']], { rarity: 'rare', tint: '#9fd8ff', variantOf: 'pecklet', abilities: ['frostbite', 'keen_eye'] }], 'Pecklets of Stormreach grow down so thick they look like snowballs.'],
  [['ashwing', 'Ashwing', 'fire', 50, 16, 9, 19, 0.9, 'Birb', [[1, 'ember_bite'], [5, 'feather_dart'], [10, 'flare_burst']], { rarity: 'rare', tint: '#6a3a3a', tintGlow: '#ff6a1a', variantOf: 'chirpling', abilities: ['flame_body', 'swift'] }], 'Chirplings that nest in the Scar sing in crackles.'],
  [['moonhop', 'Moonhop', 'void', 58, 16, 11, 18, 1.4, 'Bunny', [[1, 'shadow_claw'], [6, 'soul_siphon'], [12, 'umbral_wave']], { rarity: 'epic', catchRate: 0.18, tint: '#4a3a8a', tintGlow: '#b89aff', variantOf: 'hopscotch', abilities: ['umbra', 'swift'], evolves: [] }], 'Only seen on moonlit nights in Mistveil Marsh.'],
  [['mirecroak', 'Mirecroak', 'void', 68, 16, 15, 12, 1.4, 'Frog', [[1, 'shadow_claw'], [6, 'soul_siphon'], [12, 'riptide']], { rarity: 'rare', tint: '#3a5a2a', tintGlow: '#9a5aff', variantOf: 'croakus', abilities: ['poison_touch', 'umbra'] }], 'Its croak is a whisper that makes lanterns flicker.'],
  [['dunecat', 'Dunecat', 'earth', 54, 16, 12, 19, 0.9, 'Cat', [[1, 'rock_toss'], [5, 'overcharge'], [10, 'tremor']], { rarity: 'rare', tint: '#d8a860', variantOf: 'voltcat', abilities: ['bedrock', 'lucky'] }], 'A sand-coloured Voltcat that naps in the shade of dunes.'],
  [['magmaglub', 'Magmaglub', 'fire', 60, 15, 14, 12, 1.0, 'Glub', [[1, 'ember_bite'], [5, 'kindle'], [10, 'flare_burst']], { rarity: 'rare', tint: '#ff6a2a', tintGlow: '#ff4a0a', variantOf: 'glub', abilities: ['flame_body', 'blaze'] }], 'Glubs that drifted into lava learned to like it.'],
  [['sunbee', 'Sunbee', 'fire', 52, 16, 11, 19, 0.9, 'Armabee', [[1, 'ember_bite'], [5, 'overcharge'], [9, 'flare_burst']], { rarity: 'rare', tint: '#ffb03a', tintGlow: '#ffd08a', variantOf: 'zapbee', abilities: ['blaze', 'swift'] }], 'Its hive is a hollow in the hottest dune.'],
  [['dustwhirl', 'Dustwhirl', 'wind', 54, 15, 11, 19, 1.2, 'Hywirl', [[1, 'gale_cut'], [6, 'cyclone'], [11, 'rock_toss']], { rarity: 'rare', tint: '#d8b070', variantOf: 'whirlie', abilities: ['tailwind_soul', 'swift'] }], 'A spinning column of sand with opinions.'],
  [['frostwisp', 'Frostwisp', 'wind', 52, 17, 11, 18, 1.1, 'Ghost', [[1, 'gale_cut'], [6, 'soul_siphon'], [12, 'cyclone']], { rarity: 'epic', catchRate: 0.16, tint: '#bff0ff', tintGlow: '#9fe8ff', variantOf: 'wisp', abilities: ['frostbite', 'keen_eye'] }], 'A lantern-light that froze over one very long night.'],
  [['glowcap', 'Glowcap', 'void', 60, 14, 14, 12, 1.0, 'Mushnub', [[1, 'shadow_claw'], [4, 'bloom'], [9, 'sleep_spore']], { rarity: 'epic', catchRate: 0.16, tint: '#6a4aff', tintGlow: '#9a7aff', variantOf: 'sporelet', abilities: ['sleep_spores', 'umbra'] }], 'Sporelets of the Marsh glow violet when they dream.'],
  [['emberjaw', 'Emberjaw', 'fire', 66, 19, 15, 13, 1.5, 'Monkroose', [[1, 'ember_bite'], [5, 'cinder_claw'], [11, 'flare_burst']], { rarity: 'rare', tint: '#8a3a2a', tintGlow: '#ff6a1a', variantOf: 'monkroose', abilities: ['flame_body', 'rage'] }], 'Juggles hot coals instead of river stones.'],

  // ── Round 2 · Verdant Vale farmsteads & fields ───────────────────────────
  // Branching families list every route in `evolves`; `evolvesTo` mirrors the level route so evolutionLine() can draw it.
  [['trotlet', 'Trotlet', 'earth', 56, 14, 12, 16, 1.2, 'R2:Horse__30b503df.glb', [[1, 'rock_toss'], [4, 'tailwind'], [8, 'stone_skin'], [12, 'boulder_slam']], { catchRate: 0.45, abilities: ['bedrock', 'swift'], evolvesTo: { id: 'loamstrider', level: 16 }, evolves: [{ id: 'loamstrider', level: 16 }, { id: 'skymane', item: 'wind_stone' }] }], 'Trots in circles until it is dizzy, then trots the other way.'],
  [['loamstrider', 'Loamstrider', 'earth', 76, 19, 17, 18, 2.0, 'R2:Horse__d37dbc87.glb', [[1, 'rock_toss'], [1, 'tailwind'], [12, 'boulder_slam'], [16, 'tremor'], [22, 'stone_skin']], { rarity: 'rare', catchRate: 0.2, rideable: true, abilities: ['bedrock', 'sturdy'] }], 'Ploughs a whole field before breakfast and still wants a gallop.'],
  [['skymane', 'Skymane', 'wind', 72, 18, 14, 22, 2.1, 'R2:White_Horse__3edc2bd9.glb', [[1, 'gale_cut'], [1, 'tailwind'], [10, 'feather_dart'], [16, 'cyclone'], [22, 'frost_breath']], { rarity: 'epic', catchRate: 0.1, rideable: true, tint: '#e6f4ff', tintGlow: '#bfe6ff', abilities: ['tailwind_soul', 'swift'] }], 'A Trotlet that nuzzled a Wind Stone and grew a mane of cloud.'],
  [['moolet', 'Moolet', 'earth', 62, 13, 15, 10, 1.1, 'R2:Cow__48c5f4af.glb', [[1, 'rock_toss'], [4, 'bloom'], [8, 'stone_skin'], [12, 'boulder_slam']], { catchRate: 0.45, abilities: ['thick_hide', 'sturdy'], evolvesTo: { id: 'bullwark', level: 18 }, evolves: [{ id: 'bullwark', level: 18 }, { id: 'pyrox', item: 'fire_stone' }] }], 'Gives the warmest milk in the Vale and the firmest headbutts.'],
  [['bullwark', 'Bullwark', 'earth', 84, 20, 21, 10, 1.9, 'R2:Bull__5704ef69.glb', [[1, 'rock_toss'], [1, 'stone_skin'], [12, 'boulder_slam'], [18, 'tremor'], [24, 'kindle']], { rarity: 'rare', catchRate: 0.18, rideable: true, abilities: ['rage', 'intimidate'] }], 'Plants its hooves and becomes a wall; moving it is a group project.'],
  [['pyrox', 'Pyrox', 'fire', 78, 23, 17, 13, 2.0, 'R2:Bull__5704ef69.glb', [[1, 'ember_bite'], [1, 'kindle'], [10, 'flame_wheel'], [16, 'cinder_claw'], [24, 'flare_burst']], { rarity: 'epic', catchRate: 0.1, rideable: true, variantOf: 'bullwark', tint: '#c8401e', tintGlow: '#ff5a1a', abilities: ['blaze', 'rage'] }], 'A Moolet that licked a Fire Stone; now every snort leaves a scorch mark.'],
  [['truffly', 'Truffly', 'nature', 60, 13, 14, 11, 0.8, 'R2:Pig__665ee586.glb', [[1, 'thorn_volley'], [4, 'bloom'], [8, 'vine_snare'], [12, 'sleep_spore']], { catchRate: 0.45, abilities: ['pickup', 'overgrow'] }], 'Sniffs out buried treasure, then eats it if it is a mushroom.'],
  [['dozewool', 'Dozewool', 'nature', 60, 12, 15, 10, 1.0, 'R2:Sheep__a4bd2c4e.glb', [[1, 'thorn_volley'], [3, 'sleep_spore'], [7, 'bloom'], [11, 'hypno_glow']], { catchRate: 0.45, abilities: ['sleep_spores', 'thick_hide'] }], 'Count its curls and you will be asleep before twelve.'],
  [['snubbit', 'Snubbit', 'wind', 52, 14, 10, 17, 0.8, 'R2:Pug__094335c0.glb', [[1, 'gale_cut'], [4, 'tailwind'], [8, 'rock_toss'], [11, 'cyclone']], { catchRate: 0.45, abilities: ['swift', 'lucky'], evolvesTo: { id: 'gustail', level: 14 } }], 'Snores louder than it barks, and it barks a lot.'],
  [['gustail', 'Gustail', 'wind', 66, 18, 13, 21, 1.2, 'R2:Shiba_Inu__ba6d0ee3.glb', [[1, 'gale_cut'], [1, 'tailwind'], [10, 'feather_dart'], [14, 'cyclone'], [18, 'frost_breath']], { rarity: 'rare', catchRate: 0.25, abilities: ['swift', 'keen_eye'], evolvesTo: { id: 'blizzarf', level: 28 } }], 'Chases its own tail so fast it leaves little whirlwinds behind.'],
  [['blizzarf', 'Blizzarf', 'wind', 86, 23, 18, 21, 1.7, 'R2:Husky__611d25c7.glb', [[1, 'gale_cut'], [1, 'frost_breath'], [14, 'cyclone'], [20, 'tailwind'], [28, 'boulder_slam']], { rarity: 'epic', catchRate: 0.1, rideable: true, abilities: ['frostbite', 'intimidate'] }], 'Howls up a blizzard, then happily pulls your sled through it.'],
  [['honeybuzz', 'Honeybuzz', 'nature', 50, 13, 10, 18, 0.9, 'R2:Bee_Enemy__19203489.glb', [[1, 'thorn_volley'], [4, 'bloom'], [7, 'sleep_spore'], [10, 'venom_fang']], { catchRate: 0.45, abilities: ['swift', 'regenerator'], evolvesTo: { id: 'thornet', level: 14 } }], 'Makes honey so sweet that wild Mystics forget to fight.'],
  [['thornet', 'Thornet', 'nature', 66, 19, 13, 21, 1.3, 'R2:Wasp__71cadefd.glb', [[1, 'thorn_volley'], [1, 'venom_fang'], [10, 'vine_snare'], [14, 'toxic_mist'], [20, 'grove_wrath']], { rarity: 'rare', catchRate: 0.2, abilities: ['poison_touch', 'swift'] }], 'Its stinger is a rose thorn, and it has never once said sorry.'],
  [['nibblet', 'Nibblet', 'earth', 52, 14, 11, 18, 0.7, 'R2:Rat__64cb7150.glb', [[1, 'rock_toss'], [4, 'venom_fang'], [8, 'stone_skin'], [12, 'tremor']], { catchRate: 0.5, abilities: ['pickup', 'lucky'] }], 'Hoards shiny pebbles, lost buttons and, once, a crown.'],

  // ── Round 2 · Stormreach Peaks: mountain beasts & ruin automatons ────────
  [['tuftumble', 'Tuftumble', 'earth', 60, 14, 15, 12, 1.3, 'R2:Llama__73641d10.glb', [[1, 'rock_toss'], [4, 'aqua_jet'], [8, 'stone_skin'], [12, 'boulder_slam']], { catchRate: 0.4, abilities: ['sturdy', 'thick_hide'], evolvesTo: { id: 'peakfleece', level: 25 } }], 'Tumbles down cliffs on purpose, bounces, and spits at the view.'],
  [['peakfleece', 'Peakfleece', 'earth', 82, 19, 21, 13, 2.0, 'R2:Alpaca__444228bb.glb', [[1, 'rock_toss'], [1, 'aqua_jet'], [12, 'boulder_slam'], [18, 'tremor'], [25, 'bubble_veil']], { rarity: 'rare', catchRate: 0.2, rideable: true, abilities: ['sturdy', 'guardian_aura'] }], 'Carries travellers up cliffs that even goats refuse to climb.'],
  [['rimehorn', 'Rimehorn', 'wind', 78, 18, 19, 12, 1.9, 'R2:Cow__382b3d4a.glb', [[1, 'gale_cut'], [5, 'frost_breath'], [10, 'stone_skin'], [15, 'boulder_slam'], [20, 'cyclone']], { rarity: 'rare', catchRate: 0.25, rideable: true, tint: '#cfe8ff', tintGlow: '#bff0ff', abilities: ['frostbite', 'thick_hide'] }], 'Its shaggy coat is mostly icicles, and its moo is mostly fog.'],
  [['tinkertot', 'Tinkertot', 'storm', 58, 15, 14, 16, 1.2, 'R2:Animated_Robot__7d95dbce.glb', [[1, 'spark_jab'], [4, 'overcharge'], [8, 'thunder_wave'], [12, 'static_field'], [16, 'spark_storm']], { rarity: 'rare', catchRate: 0.25, abilities: ['static', 'focus'] }], 'A tiny automaton from the ruins that dances when it thinks no one is watching.'],
  [['cogling', 'Cogling', 'storm', 56, 15, 15, 12, 1.0, 'R2:Robot_Enemy__9c45ab2b.glb', [[1, 'spark_jab'], [5, 'stone_skin'], [9, 'static_field'], [13, 'thunder_wave']], { catchRate: 0.4, abilities: ['static', 'sturdy'], evolvesTo: { id: 'gearbrute', level: 24 }, evolves: [{ id: 'gearbrute', level: 24 }, { id: 'stiltshot', item: 'thunder_stone' }] }], 'Wakes in the old ruins, beeps twice, and follows the first friendly face it sees.'],
  [['gearbrute', 'Gearbrute', 'storm', 76, 20, 20, 11, 1.7, 'R2:Robot_Enemy_Large__86da7c34.glb', [[1, 'spark_jab'], [1, 'stone_skin'], [13, 'thunder_wave'], [18, 'boulder_slam'], [24, 'thunderclap']], { rarity: 'rare', catchRate: 0.18, abilities: ['sturdy', 'breaker'], evolvesTo: { id: 'arcannon', level: 34 } }], 'Its punches are slow, polite and absolutely final.'],
  [['arcannon', 'Arcannon', 'storm', 92, 24, 23, 12, 2.2, 'R2:Robot_Enemy_Large_Gun__78e23275.glb', [[1, 'spark_jab'], [1, 'thunder_wave'], [20, 'thunderclap'], [28, 'spark_storm'], [34, 'static_field']], { rarity: 'epic', catchRate: 0.08, abilities: ['surge', 'breaker'] }], 'Charges its arm-cannon from passing storms and fires on the thunder.'],
  [['stiltshot', 'Stiltshot', 'storm', 70, 21, 16, 19, 1.6, 'R2:Robot_Enemy_Legs_Gun__c320ce4a.glb', [[1, 'spark_jab'], [1, 'overcharge'], [12, 'spark_storm'], [18, 'thunderclap'], [24, 'static_field']], { rarity: 'epic', catchRate: 0.1, abilities: ['surge', 'keen_eye'] }], 'A Cogling rebuilt by a Thunder Stone into a long-legged sharpshooter.'],
  [['whirrbit', 'Whirrbit', 'wind', 50, 14, 11, 19, 1.0, 'R2:Robot_Enemy_Flying__abb31ff6.glb', [[1, 'gale_cut'], [4, 'spark_jab'], [8, 'tailwind'], [12, 'feather_dart']], { catchRate: 0.4, abilities: ['swift', 'keen_eye'], evolvesTo: { id: 'galegunner', level: 26 } }], 'A scout drone still filing reports to a kingdom that fell centuries ago.'],
  [['galegunner', 'Galegunner', 'wind', 68, 20, 14, 22, 1.5, 'R2:Robot_Enemy_Flying_Gun__6d0889f1.glb', [[1, 'gale_cut'], [1, 'feather_dart'], [14, 'spark_storm'], [20, 'cyclone'], [26, 'overcharge']], { rarity: 'rare', catchRate: 0.15, abilities: ['swift', 'focus'] }], 'Hovers on its own hurricane and never, ever misses a pinecone.'],

  // ── Round 2 · Sunscorch Dunes & Ember Scar: fossil beasts and desert mounts ──
  [['dustclaw', 'Dustclaw', 'earth', 54, 17, 11, 18, 1.3, 'R2:Velociraptor__c1f0c4cb.glb', [[1, 'rock_toss'], [4, 'shadow_claw'], [8, 'kindle'], [12, 'boulder_slam'], [16, 'tremor']], { catchRate: 0.4, abilities: ['bedrock', 'momentum'], evolvesTo: { id: 'quakemaw', level: 28 } }], 'Hunts in giggling packs, mostly chasing tumbleweeds.'],
  [['quakemaw', 'Quakemaw', 'earth', 84, 23, 19, 14, 2.5, 'R2:T_Rex__34eed102.glb', [[1, 'rock_toss'], [1, 'boulder_slam'], [16, 'shadow_claw'], [22, 'tremor'], [30, 'kindle']], { rarity: 'epic', catchRate: 0.08, rideable: true, abilities: ['intimidate', 'bedrock'] }], 'Every step is a small earthquake; every yawn is a big one.'],
  [['scorchclaw', 'Scorchclaw', 'fire', 54, 18, 11, 18, 1.3, 'R2:Velociraptor__c1f0c4cb.glb', [[1, 'ember_bite'], [4, 'kindle'], [8, 'flame_wheel'], [12, 'cinder_claw']], { rarity: 'rare', catchRate: 0.25, variantOf: 'dustclaw', tint: '#c8502a', tintGlow: '#ff6a1a', abilities: ['flame_body', 'momentum'] }], 'Dustclaws of the Scar run so hot their footprints glow for an hour.'],
  [['hornwall', 'Hornwall', 'earth', 68, 16, 21, 9, 1.8, 'R2:Triceratops__6aa1f3ff.glb', [[1, 'rock_toss'], [5, 'stone_skin'], [10, 'boulder_slam'], [15, 'vine_snare'], [20, 'tremor']], { rideable: true, abilities: ['thick_hide', 'guardian_aura'] }], 'Nothing gets past its frill, and nothing has ever tried twice.'],
  [['kilnback', 'Kilnback', 'fire', 70, 18, 20, 10, 2.0, 'R2:Stegosaurus__6f8f4ac6.glb', [[1, 'ember_bite'], [5, 'stone_skin'], [9, 'flame_wheel'], [14, 'flare_burst'], [19, 'kindle']], { rarity: 'rare', catchRate: 0.25, rideable: true, tint: '#b8603a', tintGlow: '#ff7a2a', abilities: ['flame_body', 'thick_hide'] }], 'Vents lava heat through its back plates; travellers bake bread on it.'],
  [['thrumcrest', 'Thrumcrest', 'storm', 62, 15, 15, 14, 1.8, 'R2:Parasaurolophus__47b9d0bd.glb', [[1, 'spark_jab'], [5, 'thunder_wave'], [9, 'overcharge'], [13, 'static_field'], [17, 'thunderclap']], { catchRate: 0.4, rideable: true, abilities: ['static', 'keen_eye'], evolvesTo: { id: 'thunderneck', level: 30 } }], 'Its hollow crest hums before every storm, so the whole desert knows to bring in the washing.'],
  [['thunderneck', 'Thunderneck', 'storm', 90, 21, 21, 11, 2.0, 'R2:Apatosaurus__7b873860.glb', [[1, 'spark_jab'], [1, 'thunder_wave'], [16, 'thunderclap'], [24, 'boulder_slam'], [30, 'spark_storm']], { rarity: 'epic', catchRate: 0.08, rideable: true, abilities: ['surge', 'thick_hide'] }], 'When it stomps, the sky answers, and nobody is sure which one started it.'],
  [['duneplod', 'Duneplod', 'earth', 66, 15, 17, 11, 1.7, 'R2:Donkey__ca29f94e.glb', [[1, 'rock_toss'], [5, 'stone_skin'], [10, 'boulder_slam'], [15, 'tremor']], { catchRate: 0.4, rideable: true, abilities: ['sturdy', 'pickup'] }], 'Plods across the dunes, never lost and never, ever hurried.'],
  [['boltstripe', 'Boltstripe', 'storm', 58, 16, 12, 21, 1.9, 'R2:Zebra__ff99ce31.glb', [[1, 'spark_jab'], [4, 'overcharge'], [8, 'thunder_wave'], [13, 'spark_storm'], [18, 'thunderclap']], { rideable: true, abilities: ['static', 'swift'] }], 'Every stripe is a lightning bolt it caught and decided to keep.'],

  // ── Round 2 · Mistveil Marsh after dark ──────────────────────────────────
  [['bonelet', 'Bonelet', 'void', 52, 15, 12, 15, 1.1, 'R2:KayKit_Skeleton_Minion.glb', [[1, 'shadow_claw'], [4, 'rock_toss'], [8, 'hypno_glow'], [12, 'soul_siphon']], { catchRate: 0.4, abilities: ['sturdy', 'umbra'], evolvesTo: { id: 'bonewarden', level: 20 }, evolves: [{ id: 'bonewarden', level: 20 }, { id: 'hexbones', item: 'void_stone', time: 'night' }, { id: 'rattlecloak', item: 'wind_stone' }] }], 'Rattles when it laughs, which is almost always.'],
  [['bonewarden', 'Bonewarden', 'void', 74, 20, 20, 12, 1.8, 'R2:KayKit_Skeleton_Warrior.glb', [[1, 'shadow_claw'], [1, 'rock_toss'], [12, 'soul_siphon'], [16, 'boulder_slam'], [20, 'umbral_wave']], { rarity: 'rare', catchRate: 0.15, abilities: ['sturdy', 'guardian_aura'] }], 'Swore to guard the marsh forever and has not blinked since (it has no eyelids).'],
  [['hexbones', 'Hexbones', 'void', 68, 23, 13, 17, 1.7, 'R2:KayKit_Skeleton_Mage.glb', [[1, 'shadow_claw'], [1, 'hypno_glow'], [10, 'toxic_mist'], [16, 'umbral_wave'], [22, 'soul_siphon']], { rarity: 'epic', catchRate: 0.1, abilities: ['umbra', 'focus'] }], 'A Bonelet that read a Void Stone by moonlight and now speaks only in riddles.'],
  [['rattlecloak', 'Rattlecloak', 'wind', 62, 21, 12, 22, 1.6, 'R2:KayKit_Skeleton_Rogue.glb', [[1, 'gale_cut'], [1, 'shadow_claw'], [10, 'feather_dart'], [16, 'venom_fang'], [22, 'cyclone']], { rarity: 'epic', catchRate: 0.1, abilities: ['opportunist', 'swift'] }], 'Its cape makes no sound, which is impressive for a bag of bones.'],
  [['squeakwing', 'Squeakwing', 'void', 48, 15, 9, 20, 1.0, 'R2:Bat__4ae13ae9.glb', [[1, 'shadow_claw'], [4, 'feather_dart'], [8, 'hypno_glow'], [12, 'soul_siphon']], { catchRate: 0.45, abilities: ['keen_eye', 'opportunist'] }], 'Navigates by squeaking and apologises to every tree it bumps into.'],
  [['hissling', 'Hissling', 'nature', 54, 16, 11, 16, 0.9, 'R2:Snake__0f3a551e.glb', [[1, 'venom_fang'], [4, 'vine_snare'], [8, 'hypno_glow'], [12, 'thorn_volley'], [16, 'toxic_mist']], { catchRate: 0.4, abilities: ['poison_touch', 'overgrow'] }], 'Hisses politely before it bites, which it considers good manners.'],
  [['weblin', 'Weblin', 'void', 54, 15, 13, 14, 0.7, 'R2:Spider__4259fbdb.glb', [[1, 'shadow_claw'], [4, 'vine_snare'], [8, 'venom_fang'], [12, 'sleep_spore'], [16, 'toxic_mist']], { catchRate: 0.4, abilities: ['poison_touch', 'opportunist'] }], 'Weaves webs between the reeds that catch dewdrops, moths and bad dreams.'],
  [['skullbop', 'Skullbop', 'void', 50, 16, 12, 15, 0.8, 'R2:Skull_Enemy__9d87fc71.glb', [[1, 'shadow_claw'], [4, 'rock_toss'], [8, 'hypno_glow'], [12, 'umbral_wave']], { catchRate: 0.45, abilities: ['sturdy', 'rage'] }], 'Bounces through the graveyard, chattering its teeth to a tune only it knows.'],
  [['blorp', 'Blorp', 'void', 58, 13, 14, 10, 0.8, 'R2:Slime__195565b4.glb', [[1, 'shadow_claw'], [4, 'toxic_mist'], [8, 'soul_siphon'], [12, 'hypno_glow']], { catchRate: 0.5, tint: '#7a4ab8', abilities: ['absorb', 'regenerator'], evolvesTo: { id: 'gobblorp', level: 18 }, evolves: [{ id: 'gobblorp', level: 18, time: 'night' }] }], 'A bubble of bog-gas that decided to stick around.'],
  [['gobblorp', 'Gobblorp', 'void', 76, 18, 18, 11, 1.4, 'R2:Slime_Enemy__93e6c3e3.glb', [[1, 'shadow_claw'], [1, 'toxic_mist'], [12, 'venom_fang'], [18, 'umbral_wave'], [24, 'soul_siphon']], { rarity: 'rare', catchRate: 0.18, tint: '#6a3a9a', tintGlow: '#b36bff', abilities: ['absorb', 'poison_touch'] }], 'Blorps that bathe in moonlight grow horns and an appetite for lanterns.'],

  // ── Round 2 · Mirror Lakes shores ────────────────────────────────────────
  [['glenhart', 'Glenhart', 'nature', 68, 17, 16, 17, 2.2, 'R2:Stag__a9c69fbc.glb', [[1, 'thorn_volley'], [5, 'bloom'], [9, 'vine_snare'], [14, 'grove_wrath'], [18, 'tailwind']], { rarity: 'rare', catchRate: 0.25, rideable: true, abilities: ['overgrow', 'keen_eye'], evolves: [{ id: 'aurorhart', item: 'wind_stone', time: 'night' }] }], 'Its antlers sprout moss in spring and hold fireflies all summer.'],
  [['aurorhart', 'Aurorhart', 'wind', 84, 21, 18, 20, 2.4, 'R2:Stag__a9c69fbc.glb', [[1, 'gale_cut'], [1, 'bloom'], [14, 'frost_breath'], [20, 'cyclone'], [26, 'purify']], { rarity: 'exotic', catchRate: 0.05, rideable: true, variantOf: 'glenhart', tint: '#9fe8ff', tintGlow: '#7affd8', abilities: ['tailwind_soul', 'guardian_aura'] }], 'A stag spirit that walks the peaks on aurora nights; its hoofprints ring like bells.'],
  [['clacker', 'Clacker', 'water', 58, 15, 17, 10, 0.9, 'R2:Crab_Enemy__b9bbf6bd.glb', [[1, 'tide_lash'], [4, 'stone_skin'], [8, 'aqua_jet'], [12, 'bubble_veil']], { catchRate: 0.45, abilities: ['thick_hide', 'torrent'] }], 'Clacks its claws in applause whenever anything splashes.'],
  [['sandclack', 'Sandclack', 'earth', 60, 15, 18, 9, 0.9, 'R2:Crab_Enemy__b9bbf6bd.glb', [[1, 'rock_toss'], [4, 'stone_skin'], [8, 'tremor'], [12, 'boulder_slam']], { rarity: 'rare', catchRate: 0.3, variantOf: 'clacker', tint: '#d8b070', abilities: ['bedrock', 'thick_hide'] }], 'Clackers that scuttled to the oasis grew shells as pale and hard as old bone.'],

  // ── Round 2 · Fishing: lakes, marsh pools, Vale ponds and Ember Scar lava ──
  [['gildfin', 'Gildfin', 'water', 52, 12, 12, 15, 0.8, 'R2:Goldfish__221c59b8.glb', [[1, 'tide_lash'], [4, 'bubble_veil'], [8, 'aqua_jet'], [12, 'mend_rain']], { catchRate: 0.5, swim: true, abilities: ['torrent', 'lucky'], evolvesTo: { id: 'mirrorscale', level: 18 }, evolves: [{ id: 'mirrorscale', level: 18 }, { id: 'magmascale', item: 'fire_stone' }] }], 'Remembers everything for three seconds, and all of it fondly.'],
  [['mirrorscale', 'Mirrorscale', 'water', 72, 17, 16, 16, 1.4, 'R2:Koi__d2ba96af.glb', [[1, 'tide_lash'], [1, 'bubble_veil'], [12, 'aqua_jet'], [18, 'riptide'], [24, 'purify']], { rarity: 'rare', catchRate: 0.18, swim: true, abilities: ['torrent', 'regenerator'] }], 'Its scales still show the sky from the morning it hatched.'],
  [['magmascale', 'Magmascale', 'fire', 72, 20, 15, 16, 1.4, 'R2:Koi__d2ba96af.glb', [[1, 'ember_bite'], [1, 'scald'], [12, 'flame_wheel'], [18, 'flare_burst'], [24, 'meteor_fang']], { rarity: 'epic', catchRate: 0.1, swim: true, variantOf: 'mirrorscale', tint: '#ff6a2a', tintGlow: '#ff4a0a', abilities: ['flame_body', 'blaze'] }], 'A Gildfin kissed by a Fire Stone; it swims through lava like a lily pond.'],
  [['quillpuff', 'Quillpuff', 'water', 56, 13, 15, 11, 0.8, 'R2:Puffer__2b8ee3e9.glb', [[1, 'tide_lash'], [4, 'venom_fang'], [8, 'bubble_veil'], [12, 'toxic_mist']], { catchRate: 0.45, swim: true, abilities: ['poison_touch', 'thick_hide'], evolvesTo: { id: 'sunbasker', level: 20 } }], 'Puffs up when nervous, which is whenever anything looks at it.'],
  [['sunbasker', 'Sunbasker', 'water', 84, 16, 19, 9, 1.8, 'R2:Sunfish__b8176c6b.glb', [[1, 'tide_lash'], [1, 'bubble_veil'], [14, 'mend_rain'], [20, 'riptide'], [26, 'purify']], { rarity: 'rare', catchRate: 0.18, swim: true, abilities: ['regenerator', 'thick_hide'] }], 'Sunbathes on its side for so long that gulls build nests on it.'],
  [['chompsy', 'Chompsy', 'water', 50, 17, 10, 18, 0.7, 'R2:Piranha__400a5d85.glb', [[1, 'aqua_jet'], [4, 'shadow_claw'], [8, 'tide_lash'], [12, 'venom_fang']], { catchRate: 0.45, swim: true, abilities: ['opportunist', 'torrent'], evolvesTo: { id: 'grinfin', level: 24 } }], 'All teeth and no table manners, but fiercely loyal.'],
  [['grinfin', 'Grinfin', 'water', 72, 22, 15, 18, 1.6, 'R2:Shark__fdcb48e0.glb', [[1, 'aqua_jet'], [1, 'shadow_claw'], [16, 'kindle'], [20, 'riptide'], [28, 'scald']], { rarity: 'rare', catchRate: 0.15, swim: true, abilities: ['intimidate', 'opportunist'] }], 'Circles the deep lakes grinning; it cannot stop grinning.'],
  [['lanterngulp', 'Lanterngulp', 'void', 82, 22, 17, 13, 1.3, 'R2:Anglerfish__0c4802f0.glb', [[1, 'shadow_claw'], [1, 'hypno_glow'], [12, 'soul_siphon'], [18, 'umbral_wave'], [24, 'toxic_mist']], { rarity: 'exotic', catchRate: 0.06, swim: true, abilities: ['umbra', 'opportunist'] }], 'Dangles a tiny moon over its mouth and waits, very patiently, for the curious.'],
  [['hobsnap', 'Hobsnap', 'void', 78, 24, 16, 17, 1.2, 'R2:Goblin_Shark__35cd5001.glb', [[1, 'shadow_claw'], [1, 'aqua_jet'], [14, 'venom_fang'], [20, 'umbral_wave'], [26, 'soul_siphon']], { rarity: 'exotic', catchRate: 0.05, swim: true, abilities: ['opportunist', 'intimidate'] }], 'Its jaw shoots out like a stuck drawer, then slams shut.'],
  [['bellowdeep', 'Bellowdeep', 'water', 95, 20, 21, 12, 1.5, 'R2:Whale__7300e697.glb', [[1, 'tide_lash'], [1, 'bubble_veil'], [16, 'mend_rain'], [22, 'riptide'], [28, 'purify']], { rarity: 'exotic', catchRate: 0.05, swim: true, abilities: ['guardian_aura', 'thick_hide'] }], 'Sings so deep that the lakes ripple on windless nights.'],
  [['barbelmail', 'Barbelmail', 'earth', 64, 15, 21, 8, 0.9, 'R2:Armored_Catfish__d42c2675.glb', [[1, 'rock_toss'], [4, 'stone_skin'], [8, 'aqua_jet'], [12, 'tremor']], { catchRate: 0.4, swim: true, abilities: ['thick_hide', 'sturdy'] }], 'Wears its own armour and refuses to take it off, even to sleep.'],
  [['emberspine', 'Emberspine', 'fire', 58, 18, 12, 15, 1.2, 'R2:Lionfish__1d592042.glb', [[1, 'ember_bite'], [4, 'venom_fang'], [8, 'flame_wheel'], [12, 'flare_burst']], { rarity: 'rare', catchRate: 0.25, swim: true, tint: '#ff7a2a', tintGlow: '#ff4a0a', abilities: ['flame_body', 'poison_touch'] }], 'Its spines glow like coals in the lava pools, and sting like them too.'],
  [['skysail', 'Skysail', 'wind', 64, 16, 14, 20, 0.6, 'R2:Manta_ray__32b4e08e.glb', [[1, 'gale_cut'], [4, 'tide_lash'], [8, 'tailwind'], [12, 'cyclone'], [16, 'feather_dart']], { rarity: 'rare', catchRate: 0.25, swim: true, abilities: ['tailwind_soul', 'swift'] }], 'Skims the lake so fast it sometimes forgets to come back down.'],

  // ── v3 · Sapphire Coast: tide pools, gulls and the singing reef ───────────
  [['skimgull', 'Skimgull', 'wind', 54, 15, 11, 18, 0.9, 'Pigeon', [[1, 'gale_cut'], [4, 'gust_dive'], [8, 'tailwind'], [12, 'feather_dart'], [16, 'cyclone']], { catchRate: 0.45, tint: '#e6eef8', abilities: ['keen_eye', 'swift'], evolvesTo: { id: 'galeherald', level: 26 } }], 'Steals chips from the Tidewatch docks, then apologises with a very nice shell.'],
  [['saltfox', 'Saltfox', 'water', 58, 16, 12, 19, 1.0, 'A:Fox', [[1, 'tide_lash'], [4, 'pounce'], [8, 'aqua_jet'], [12, 'brine_lance'], [16, 'riptide']], { rarity: 'rare', catchRate: 0.28, tint: '#9fd8f0', abilities: ['torrent', 'swift'] }], 'Dips its tail in tide pools and flicks crabs onto the sand for later.'],
  [['shellback', 'Shellback', 'water', 66, 13, 19, 9, 0.9, 'R2:Frog__08416495.glb', [[1, 'tide_lash'], [4, 'shell_guard'], [8, 'aqua_jet'], [12, 'stone_skin'], [15, 'bubble_veil']], { catchRate: 0.4, tint: '#4ab8a0', abilities: ['thick_hide', 'sturdy'], evolvesTo: { id: 'reefwarden', level: 18 }, acc: [{ k: 'shell', on: 'back', s: 0.62, at: [0, -0.08, -0.06], c: '#ffc8a8', c2: '#fff4e8' }] }], 'A hermit toad that borrows the biggest shell on the beach, then naps in it for a week.'],
  [['reefwarden', 'Reefwarden', 'water', 86, 18, 24, 9, 1.8, 'R2:Frog__08416495.glb', [[1, 'tide_lash'], [1, 'shell_guard'], [12, 'brine_lance'], [18, 'riptide'], [24, 'purify']], { rarity: 'rare', catchRate: 0.15, rideable: true, tint: '#2a8a9a', tintGlow: '#7af0e0', abilities: ['guardian_aura', 'thick_hide'], acc: [{ k: 'shell', on: 'back', s: 0.66, at: [0, -0.1, -0.06], c: '#f0a890', c2: '#fff0e0' }, { k: 'coral', on: 'back', s: 0.3, at: [0, 0.34, -0.1] }] }], 'A whole reef lives on its shell, and it would never dream of shaking them off.'],
  [['coralclack', 'Coralclack', 'water', 62, 17, 18, 11, 1.0, 'R2:Crab_Enemy__b9bbf6bd.glb', [[1, 'tide_lash'], [4, 'stone_skin'], [8, 'brine_lance'], [12, 'bubble_veil'], [16, 'riptide']], { rarity: 'rare', catchRate: 0.3, variantOf: 'clacker', tint: '#ff7a8a', tintGlow: '#ffb0c0', abilities: ['thick_hide', 'regenerator'], acc: [{ k: 'coral', on: 'back', s: 0.85, at: [0, -0.06, -0.04] }] }], 'Coast Clackers wear a living coral garden and defend it with great ceremony.'],
  [['jestfin', 'Jestfin', 'water', 52, 14, 12, 17, 0.7, 'R2:Clownfish__f28280ed.glb', [[1, 'tide_lash'], [4, 'bubble_veil'], [8, 'aqua_jet'], [12, 'mend_rain']], { catchRate: 0.5, swim: true, abilities: ['lucky', 'regenerator'] }], 'Tells the same joke to every anemone. The anemones love it every time.'],
  [['lancefin', 'Lancefin', 'water', 64, 21, 13, 20, 1.5, 'R2:Swordfish__4400228c.glb', [[1, 'aqua_jet'], [4, 'brine_lance'], [10, 'tide_lash'], [14, 'riptide'], [18, 'scald']], { rarity: 'rare', catchRate: 0.2, swim: true, tint: '#3a78d0', abilities: ['focus', 'torrent'] }], 'Duels sailfish at dawn and has never once lost its temper, or a duel.'],
  [['inkwhirl', 'Inkwhirl', 'void', 70, 17, 16, 14, 1.3, 'V3:octopus.glb', [[1, 'shadow_claw'], [4, 'ink_cloud'], [8, 'tide_lash'], [12, 'hypno_glow'], [16, 'umbral_wave']], { rarity: 'rare', catchRate: 0.2, abilities: ['opportunist', 'absorb'] }], 'Crawls up the beach on moonless nights to arrange the shells into little poems.'],

  // ── v3 · Elderwood: the forest that dreams ───────────────────────────────
  [['fawnlet', 'Fawnlet', 'nature', 60, 16, 14, 18, 1.1, 'A:Deer', [[1, 'thorn_volley'], [4, 'bloom'], [8, 'pounce'], [12, 'vine_snare'], [16, 'tailwind']], { catchRate: 0.4, abilities: ['overgrow', 'swift'], evolvesTo: { id: 'mossbuck', level: 22 } }], 'Its spots are dapples of sunlight it forgot to give back.'],
  [['mossbuck', 'Mossbuck', 'nature', 80, 21, 18, 18, 2.1, 'A:Deer', [[1, 'thorn_volley'], [1, 'pounce'], [16, 'vine_snare'], [22, 'grove_wrath'], [28, 'bloom']], { rarity: 'rare', catchRate: 0.15, rideable: true, tint: '#7a8a4a', abilities: ['overgrow', 'guardian_aura'], acc: [{ k: 'antlers', s: 0.4, c: '#b8a878', c2: '#7fdf6a' }, { k: 'mushrooms', on: 'back', s: 0.14, n: 3 }] }], 'Moss grows on its antlers faster than it can rub it off, so it has stopped trying.'],
  [['bramblewolf', 'Bramblewolf', 'nature', 66, 20, 15, 19, 1.3, 'A:Wolf', [[1, 'pounce'], [4, 'thorn_volley'], [8, 'thorn_howl'], [12, 'venom_fang'], [16, 'vine_snare'], [22, 'grove_wrath']], { catchRate: 0.3, tint: '#5a7a3a', abilities: ['overgrow', 'intimidate'], evolvesTo: { id: 'thornfang', level: 26 }, acc: [{ k: 'mane', on: 'back', s: 0.28, c: '#4a6a2a', c2: '#c8e07a' }] }], 'Hunts in threes and howls in harmony. The harmony is the frightening part.'],
  [['thornfang', 'Thornfang', 'nature', 84, 25, 18, 20, 1.9, 'A:Wolf', [[1, 'pounce'], [1, 'thorn_howl'], [18, 'venom_fang'], [24, 'grove_wrath'], [30, 'shadow_claw']], { rarity: 'rare', catchRate: 0.12, rideable: true, tint: '#34502c', tintGlow: '#9aff6a', abilities: ['intimidate', 'opportunist'], acc: [{ k: 'mane', on: 'back', s: 0.34, c: '#3a5a1a', c2: '#d8ff8a' }, { k: 'horns', s: 0.24, c: '#efe6d2', c2: '#4a3a2a' }] }], 'Its thorns only come out when it is protecting something smaller.'],
  [['lanternfox', 'Lanternfox', 'fire', 58, 19, 12, 20, 1.0, 'A:Fox', [[1, 'ember_bite'], [4, 'lantern_flare'], [8, 'hypno_glow'], [12, 'pounce'], [16, 'flare_burst'], [20, 'kindle']], { rarity: 'rare', catchRate: 0.2, tint: '#6a4a8a', tintGlow: '#ffb04a', abilities: ['flame_body', 'keen_eye'], acc: [{ k: 'flame', on: 'tail', s: 0.34, c: '#ffe08a', c2: '#ff7a2a' }] }], 'Leads lost Wayfarers home through the Elderwood, then back in again for fun.'],
  [['hootsage', 'Hootsage', 'wind', 68, 17, 16, 15, 1.1, 'V3:owl.glb', [[1, 'gale_cut'], [4, 'moon_hoot'], [8, 'feather_dart'], [12, 'hypno_glow'], [16, 'cyclone'], [22, 'tailwind']], { rarity: 'rare', catchRate: 0.2, abilities: ['keen_eye', 'focus'] }], 'Has read every book in Elderhollow twice and disagrees with most of them.'],
  [['mosshulk', 'Mosshulk', 'nature', 88, 20, 24, 8, 2.0, 'V3:golem.glb', [[1, 'rock_toss'], [4, 'stone_skin'], [8, 'vine_snare'], [14, 'boulder_slam'], [20, 'grove_wrath']], { rarity: 'rare', catchRate: 0.15, tint: '#5f7a4a', abilities: ['sturdy', 'thick_hide'], tintAll: true, tintL: 0.2, acc: [{ k: 'mushrooms', on: 'back', n: 4, s: 0.18, at: [0, -0.16, -0.1] }, { k: 'leafcrown', s: 0.26, at: [0, -0.06, 0] }] }], 'An old boundary stone that grew tired of standing still.'],

  // ── v3 · Glimmer Hollows: crystal canyons humming with trapped lightning ──
  [['geodgloop', 'Geodgloop', 'earth', 70, 16, 22, 9, 1.0, 'Green Blob', [[1, 'rock_toss'], [4, 'geode_shell'], [10, 'crystal_lance'], [16, 'tremor']], { rarity: 'rare', catchRate: 0.3, variantOf: 'gloop', tint: '#8a6ac8', tintGlow: '#bfe8ff', abilities: ['bedrock', 'absorb'], acc: [{ k: 'crystals', on: 'headTop', s: 0.55, n: 6, at: [0, -0.08, -0.12] }] }], 'A Gloop that napped in a crystal vein for a hundred years and woke up sparkly.'],
  [['glimfox', 'Glimfox', 'storm', 60, 19, 13, 22, 1.0, 'A:Fox', [[1, 'spark_jab'], [4, 'pounce'], [8, 'thunder_wave'], [12, 'crystal_lance'], [18, 'spark_storm'], [24, 'overcharge']], { rarity: 'rare', catchRate: 0.2, tint: '#4a4a9a', tintGlow: '#9ff0ff', abilities: ['static', 'swift'], acc: [{ k: 'crystals', on: 'back', s: 0.38, n: 5, c: '#9fe8ff' }] }], 'Grows a new crystal every time it outruns a thunderclap.'],
  [['shardmaw', 'Shardmaw', 'earth', 80, 23, 21, 15, 1.5, 'A:Wolf', [[1, 'rock_toss'], [4, 'pounce'], [10, 'geode_shell'], [16, 'crystal_lance'], [22, 'tremor'], [28, 'boulder_slam']], { rarity: 'rare', catchRate: 0.15, tint: '#5a5470', tintGlow: '#c8a0ff', abilities: ['bedrock', 'breaker'], acc: [{ k: 'crystals', on: 'back', s: 0.34, n: 6, c: '#c8a0ff', c2: '#f4e8ff' }] }], 'Chews raw geodes to keep its teeth sharp and its breath sparkling.'],
  [['prismbat', 'Prismbat', 'storm', 56, 18, 12, 21, 1.0, 'R2:Bat__4ae13ae9.glb', [[1, 'spark_jab'], [4, 'feather_dart'], [8, 'hypno_glow'], [12, 'prism_ray'], [18, 'static_field']], { rarity: 'rare', catchRate: 0.25, variantOf: 'squeakwing', tint: '#6a5aff', tintGlow: '#9ff0ff', abilities: ['keen_eye', 'static'], acc: [{ k: 'gem', s: 0.1 }] }], 'Hangs in the crystal caves and hums in chords only other Prismbats can hear.'],
  [['quartzback', 'Quartzback', 'earth', 84, 19, 25, 10, 2.1, 'R2:Stegosaurus__6f8f4ac6.glb', [[1, 'rock_toss'], [4, 'geode_shell'], [10, 'crystal_lance'], [16, 'boulder_slam'], [22, 'tremor']], { rarity: 'rare', catchRate: 0.18, rideable: true, variantOf: 'kilnback', tint: '#9a8ac8', tintGlow: '#c8f0ff', abilities: ['sturdy', 'thick_hide'], acc: [{ k: 'crystals', on: 'back', s: 0.3, n: 7, c: '#d0b8ff' }] }], 'Its back plates are geodes; miners follow it hoping one falls off.'],

  // ── v3 · Aether Crown: the summit ruins of the Sky Wardens ────────────────
  [['galeherald', 'Galeherald', 'wind', 78, 22, 16, 24, 1.6, 'Pigeon', [[1, 'gale_cut'], [1, 'gust_dive'], [20, 'feather_dart'], [26, 'cyclone'], [32, 'aether_gale']], { rarity: 'rare', catchRate: 0.12, tint: '#ffe7b0', tintGlow: '#ffe8a0', tintAll: true, tintL: 0.4, abilities: ['tailwind_soul', 'keen_eye'], acc: [{ k: 'mane', on: 'headTop', s: 0.42, at: [0, -0.06, -0.05], c: '#ffb84a', c2: '#fff6d0' }] }], 'A Skimgull that rode the updraft to the Crown and came back gilded.'],
  [['stormhowl', 'Stormhowl', 'storm', 82, 24, 18, 22, 1.6, 'A:Wolf', [[1, 'spark_jab'], [1, 'pounce'], [20, 'thunder_wave'], [26, 'crystal_lance'], [30, 'thunderclap'], [34, 'overcharge']], { rarity: 'epic', catchRate: 0.1, rideable: true, tint: '#dfe6ff', tintGlow: '#fff17a', abilities: ['surge', 'intimidate'], acc: [{ k: 'mane', on: 'head', s: 0.34, c: '#fff6a0', c2: '#ffffff' }] }], 'Runs along the lightning to the summit and howls the thunder back down.'],
  [['stormray', 'Stormray', 'storm', 76, 22, 17, 23, 0.8, 'R2:Manta_ray__32b4e08e.glb', [[1, 'spark_jab'], [1, 'gale_cut'], [20, 'static_field'], [26, 'thunderclap'], [32, 'aether_gale']], { rarity: 'epic', catchRate: 0.1, behavior: 'flyer', variantOf: 'skysail', tint: '#3a3a8a', tintGlow: '#fff17a', abilities: ['surge', 'swift'] }], 'Swims through storm clouds the way Skysails swim through lakes.'],
  [['haloling', 'Haloling', 'void', 66, 21, 15, 21, 1.1, 'Ghost', [[1, 'shadow_claw'], [1, 'hypno_glow'], [20, 'soul_siphon'], [26, 'aether_gale'], [32, 'umbral_wave']], { rarity: 'epic', catchRate: 0.12, variantOf: 'wisp', tint: '#fff0c8', tintGlow: '#ffe89a', tintAll: true, tintL: 0.72, abilities: ['umbra', 'regenerator'], acc: [{ k: 'halo', s: 0.34 }] }], 'A Wisp that climbed the whole mountain and was given a halo for its trouble.'],
  [['wardenshade', 'Wardenshade', 'void', 84, 25, 21, 16, 1.8, 'R2:KayKit_Skeleton_Warrior.glb', [[1, 'warden_edge'], [1, 'shadow_claw'], [20, 'stone_skin'], [26, 'umbral_wave'], [32, 'soul_siphon']], { rarity: 'epic', catchRate: 0.1, variantOf: 'bonewarden', tint: '#d8e0f0', tintGlow: '#8ff0ff', abilities: ['guardian_aura', 'sturdy'] }], 'An echo of a Sky Warden, still walking its rounds among the summit ruins.'],

  // ── Guardian Spirits (Legendary — summon & guardian rewards only) ─────────
  [['tidesinger', 'Tidesinger', 'water', 86, 22, 19, 18, 1.9, 'V3:jellyfish.glb', [[1, 'tide_lash'], [1, 'mend_rain'], [20, 'brine_lance'], [30, 'maelstrom']], { rarity: 'legendary', catchRate: 0, tint: '#9ff0ff', tintGlow: '#7affe8', abilities: ['regenerator', 'torrent'], acc: [{ k: 'halo', s: 0.34, at: [0, 0.04, 0] }] }], 'A choir of one. When it sings, the drowned bells under the reef answer.'],
  [['sylvan_hart', 'Sylvan Hart', 'nature', 86, 23, 19, 20, 2.2, 'A:Deer', [[1, 'thorn_volley'], [1, 'bloom'], [20, 'grove_wrath'], [30, 'root_quake']], { rarity: 'legendary', catchRate: 0, rideable: true, tint: '#dff4e0', tintGlow: '#9affc8', abilities: ['overgrow', 'regenerator'], acc: [{ k: 'antlers', s: 0.44, c: '#fff6d8', c2: '#9affc8' }] }], 'The Elder Stag’s kindness, given legs of its own.'],
  [['prism_wyrm', 'Prism Wyrm', 'storm', 80, 25, 17, 21, 2.0, 'Dragon', [[1, 'spark_jab'], [1, 'crystal_lance'], [20, 'prism_ray'], [30, 'skyfall']], { rarity: 'legendary', catchRate: 0, tint: '#8a7aff', tintGlow: '#bff8ff', abilities: ['surge', 'focus'], acc: [{ k: 'crystals', on: 'headTop', s: 0.34, n: 5, at: [0, -0.04, -0.06], c: '#dff4ff' }, { k: 'shards', n: 5, s: 0.16 }] }], 'A sliver of the Geode Colossus’s heart that learned to fly.'],
  [['verdant_rex', 'Verdant Rex', 'nature', 84, 23, 19, 15, 2.3, 'Dino', [[1, 'thorn_volley'], [1, 'root_quake'], [20, 'grove_wrath'], [30, 'sleep_spore']], { rarity: 'legendary', catchRate: 0, abilities: ['overgrow', 'intimidate'], rideable: true }], 'The spirit of the old grove, small enough to follow you home.'],
  [['ember_totem', 'Ember Totem', 'fire', 76, 25, 17, 17, 1.9, 'Tribal', [[1, 'ember_bite'], [1, 'flame_wheel'], [20, 'meteor_fang'], [30, 'cinder_rain']], { rarity: 'legendary', catchRate: 0, abilities: ['blaze', 'focus'], tint: '#ff8a3a', tintGlow: '#ff5a1a' }], 'A living mask that remembers every fire it has ever seen.'],
  [['deepcaller', 'Deepcaller', 'water', 90, 22, 20, 14, 2.2, 'Blue Demon', [[1, 'tide_lash'], [1, 'scald'], [20, 'riptide'], [30, 'maelstrom']], { rarity: 'legendary', catchRate: 0, abilities: ['torrent', 'thick_hide'], tint: '#2a8ac8', tintGlow: '#5affe0', rideable: true }], 'It hums to the lakes, and the lakes hum back.'],
  [['mire_prince', 'Mire Prince', 'void', 78, 23, 18, 17, 1.8, 'Frog', [[1, 'shadow_claw'], [1, 'venom_fang'], [20, 'toxic_mist'], [30, 'hypno_glow']], { rarity: 'legendary', catchRate: 0, abilities: ['umbra', 'poison_touch'], tint: '#2a3a5a', tintGlow: '#b36bff' }], 'Heir to the drowned lanterns of Mistveil.'],
  [['dune_titan', 'Dune Titan', 'earth', 92, 24, 23, 11, 2.3, 'Orc', [[1, 'rock_toss'], [1, 'boulder_slam'], [20, 'earthshaker'], [30, 'tremor']], { rarity: 'legendary', catchRate: 0, abilities: ['bedrock', 'sturdy'], tint: '#d8a860', rideable: true }], 'Where it walks, the dunes rearrange themselves politely.'],
  [['storm_seraph', 'Storm Seraph', 'storm', 76, 25, 16, 21, 2.2, 'Ghost Skull', [[1, 'spark_jab'], [1, 'thunder_wave'], [20, 'thunderclap'], [30, 'skyfall']], { rarity: 'legendary', catchRate: 0, abilities: ['surge', 'swift'], tint: '#ffd84a', tintGlow: '#fff17a' }], 'A shard of the Stormcrown that chose kindness.'],

  // ── Bosses ──────────────────────────────────────────────────────────────
  [['thornjaw', 'Thornjaw Rex', 'nature', 165, 15, 14, 10, 6.5, 'Dino', [[1, 'thorn_volley'], [1, 'root_quake'], [1, 'void_rend'], [1, 'vine_snare']], { boss: true, catchRate: 0, rarity: 'legendary' }], 'Guardian of the Verdant Vale. Its roar shakes pollen from every tree.'],
  [['ashen_totem', 'Ashen Totem', 'fire', 200, 18, 17, 9, 6.8, 'Tribal', [[1, 'cinder_rain'], [1, 'gravemaw'], [1, 'flare_burst']], { boss: true, catchRate: 0, rarity: 'legendary' }], 'A mask the size of a house, carved by a people made of ash.'],
  [['abyssal_tyrant', 'Abyssal Tyrant', 'water', 195, 18, 15, 12, 6.8, 'Blue Demon', [[1, 'maelstrom'], [1, 'tidal_crash'], [1, 'eclipse_wave'], [1, 'scald']], { boss: true, catchRate: 0, rarity: 'legendary' }], 'The reflection in the lake that does not copy you.'],
  [['bog_sovereign', 'Bog Sovereign', 'void', 215, 19, 17, 11, 6.6, 'Frog', [[1, 'bog_breath'], [1, 'gravemaw'], [1, 'hypno_glow'], [1, 'soul_siphon']], { boss: true, catchRate: 0, rarity: 'legendary', tint: '#3f5a2e', tintGlow: '#9a5aff' }], 'A frog king as old as the marsh, crowned in drowned lanterns.'],
  [['sandjaw', 'Sandjaw Colossus', 'earth', 225, 20, 20, 10, 7.0, 'R2:T_Rex__34eed102.glb', [[1, 'sandstorm_fury'], [1, 'earthshaker'], [1, 'gravemaw'], [1, 'boulder_slam']], { boss: true, catchRate: 0, rarity: 'legendary', tint: '#c8964e', tintGlow: '#c8964e' }], 'It sleeps beneath the tallest dune. When it wakes, the desert moves.'],
  [['stormcrown', 'Stormcrown', 'storm', 240, 21, 16, 16, 7.5, 'Ghost Skull', [[1, 'skyfall'], [1, 'gravemaw'], [1, 'eclipse_wave'], [1, 'thunder_wave']], { boss: true, catchRate: 0, rarity: 'legendary' }], 'The crowned wraith that painted the sky with lightning.'],
  // v3 Guardians of the new lands
  [['bellwyrm', 'Bellwyrm', 'water', 195, 18, 17, 12, 5.2, 'R2:Snake__0f3a551e.glb', [[1, 'tide_bell'], [1, 'tidal_crash'], [1, 'maelstrom'], [1, 'scald']], { boss: true, catchRate: 0, rarity: 'legendary', tint: '#1f5fb8', tintGlow: '#6ff0e8', tintAll: true, tintL: 0.25, acc: [{ k: 'bell', on: 'chest', n: 3, s: 0.16 }, { k: 'coral', on: 'headTop', s: 0.34 }, { k: 'fins', on: 'back', s: 0.42 }] }], 'Guardian of the Sapphire Coast. Bronze bells grew from its barnacles, and it rings them to call the tide home.'],
  [['elder_stag', 'Elder Stag', 'nature', 215, 20, 18, 13, 6.8, 'A:Deer', [[1, 'antler_rush'], [1, 'root_quake'], [1, 'vine_snare'], [1, 'sleep_spore']], { boss: true, catchRate: 0, rarity: 'legendary', tint: '#8a6a4a', tintGlow: '#b8ff7a', acc: [{ k: 'antlers', s: 0.55, c: '#e8dcb8', c2: '#8aff8a' }, { k: 'mushrooms', on: 'back', n: 5, s: 0.14 }] }], 'Guardian of the Elderwood. Its antlers hold up the canopy of the deepest glade.'],
  [['geode_colossus', 'Geode Colossus', 'earth', 245, 21, 22, 9, 7.4, 'V3:golem.glb', [[1, 'geode_burst'], [1, 'crystal_lance'], [1, 'earthshaker'], [1, 'spark_storm']], { boss: true, catchRate: 0, rarity: 'legendary', element2: 'storm', tint: '#6a6490', tintGlow: '#9ff0ff', tintAll: true, tintL: 0.35, acc: [{ k: 'crystals', on: 'back', s: 0.4, n: 9, at: [0, -0.12, -0.14], c: '#a8f0ff', c2: '#ffffff' }, { k: 'crystals', on: 'headTop', s: 0.2, n: 5, at: [0.18, -0.14, 0], c: '#ffd84a' }, { k: 'crystals', on: 'headTop', s: 0.2, n: 5, at: [-0.18, -0.14, 0], c: '#c8a0ff' }] }], 'Guardian of Glimmer Hollows. It sleeps in the brightest vein, and the vein is its heart.'],
  [['aether_sovereign', 'Aether Sovereign', 'storm', 300, 23, 19, 17, 9.5, 'Dragon Evolved', [[1, 'aether_judgement'], [1, 'skyfall'], [1, 'void_crown'], [1, 'eclipse_wave']], { boss: true, catchRate: 0, rarity: 'legendary', element2: 'void', tint: '#2a2a6a', tintGlow: '#ffe07a', acc: [{ k: 'halo', s: 0.3, at: [0, 0.08, -0.05] }, { k: 'horns', s: 0.26, c: '#fff2c8', c2: '#6a5aa8' }, { k: 'crystals', on: 'back', n: 8, s: 0.2, c: '#ffe8a0' }, { k: 'shards', n: 7, s: 0.07 }] }], 'The storm at the top of the world, given a crown and a will. The Guardians’ restlessness begins in its dreams.'],
];

export const SPECIES: Record<string, Species> = Object.fromEntries(LIST.map(([row, lore]) => [row[0], make(row, lore)]));

// Evolved forms default one tier above their base form unless set explicitly.
for (const sp of Object.values(SPECIES)) {
  for (const e of sp.evolves) {
    const t = SPECIES[e.id];
    if (t && t.rarity === 'common') t.rarity = sp.rarity === 'common' ? 'rare' : sp.rarity === 'rare' ? 'epic' : 'exotic';
  }
}

export const STARTERS = ['emberling', 'finnik', 'sporelet'];

/** Evolution chain for display (base → … → final). */
/** Every stage of a family following all branches in `evolves`: [[base], [stage-2 forms…], …]. */
export function evolutionStages(id: string): string[][] {
  const parentOf = (x: string) => Object.values(SPECIES).find((s) => s.evolves.some((e) => e.id === x))?.id;
  let base = id;
  for (let p = parentOf(base), guard = 0; p && guard < 8; p = parentOf(base), guard++) base = p;
  const stages: string[][] = [[base]];
  while (stages.length < 6) {
    const next = [...new Set(stages[stages.length - 1].flatMap((s) => SPECIES[s]?.evolves.map((e) => e.id) ?? []))].filter((x) => SPECIES[x]);
    if (!next.length) break;
    stages.push(next);
  }
  return stages;
}

/** Flat list of a family's species (all branches), base form first. */
export function evolutionLine(id: string): string[] {
  return evolutionStages(id).flat();
}
