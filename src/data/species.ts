import { ELEMENTS, type Element } from './elements';

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

export interface Species {
  id: string;
  name: string;
  element: Element;
  base: { hp: number; atk: number; def: number; spd: number };
  /** Skills unlocked by level: [level, skillId]. */
  learnset: [number, string][];
  catchRate: number;
  evolvesTo?: { id: string; level: number };
  boss?: boolean;
  /** World height in metres (models are normalised to this). */
  height: number;
  /** Source model key, see tools/import-assets.mjs. */
  model: string;
  look: Look;
  lore: string;
}

type Row = [id: string, name: string, el: Element, hp: number, atk: number, def: number, spd: number, height: number, model: string, learn: [number, string][], extra?: Partial<Species>];

const BODY: Record<string, BodyType> = { fire: 'quad', water: 'blob', nature: 'blob', earth: 'golem', storm: 'quad', wind: 'bird', void: 'serpent' };

function make([id, name, element, hp, atk, def, spd, height, model, learnset, extra]: Row, lore: string): Species {
  const c = ELEMENTS[element].color;
  return {
    id, name, element, base: { hp, atk, def, spd }, learnset, catchRate: 0.35, height, model, lore,
    look: { body: BODY[element], color: c, accent: '#ffffff', size: Math.max(0.7, height / 1.4), glow: element === 'void' ? c : undefined },
    ...extra,
  };
}

const LIST: [Row, string][] = [
  // ── Starters ────────────────────────────────────────────────────────────
  [['emberling', 'Emberling', 'fire', 50, 16, 10, 15, 1.1, 'Dragon', [[1, 'ember_bite'], [4, 'kindle'], [8, 'flare_burst'], [13, 'cinder_claw'], [18, 'meteor_fang']], { evolvesTo: { id: 'pyrowyrm', level: 16 }, catchRate: 0.2 }], 'A hatchling drake whose sneezes start campfires.'],
  [['pyrowyrm', 'Pyrowyrm', 'fire', 70, 22, 14, 18, 2.2, 'Dragon Evolved', [[1, 'ember_bite'], [1, 'kindle'], [1, 'flare_burst'], [13, 'cinder_claw'], [18, 'meteor_fang']], { catchRate: 0.05 }], 'Its wingbeat leaves trails of falling embers.'],
  [['finnik', 'Finnik', 'water', 56, 14, 12, 14, 1.1, 'Fish:small', [[1, 'tide_lash'], [4, 'bubble_veil'], [8, 'aqua_jet'], [12, 'mend_rain'], [18, 'riptide']], { evolvesTo: { id: 'tidecaller', level: 16 }, catchRate: 0.2 }], 'A curious fish that learned to walk to see the sky.'],
  [['tidecaller', 'Tidecaller', 'water', 78, 18, 17, 16, 2.0, 'Fish:elite', [[1, 'tide_lash'], [1, 'bubble_veil'], [1, 'aqua_jet'], [12, 'mend_rain'], [18, 'riptide']], { catchRate: 0.05 }], 'Commands the currents with a wave of its fins.'],
  [['sporelet', 'Sporelet', 'nature', 60, 13, 13, 12, 1.0, 'Mushnub', [[1, 'thorn_volley'], [4, 'bloom'], [8, 'vine_snare'], [14, 'grove_wrath']], { evolvesTo: { id: 'mycobloom', level: 12 }, catchRate: 0.2 }], 'Naps in sunbeams. Photosynthesises dreams.'],
  [['mycobloom', 'Mycobloom', 'nature', 74, 16, 16, 13, 1.4, 'Mushnub Evolved', [[1, 'thorn_volley'], [1, 'bloom'], [8, 'vine_snare'], [14, 'grove_wrath']], { evolvesTo: { id: 'sporeking', level: 24 }, catchRate: 0.08 }], 'Releases calming spores when its friends are hurt.'],
  [['sporeking', 'Sporeking', 'nature', 92, 20, 20, 14, 2.1, 'Mushroom King', [[1, 'thorn_volley'], [1, 'bloom'], [1, 'vine_snare'], [14, 'grove_wrath']], { catchRate: 0.03 }], 'Crowned by the forest itself. Every mushroom bows.'],

  // ── Verdant Vale ────────────────────────────────────────────────────────
  [['gloop', 'Gloop', 'nature', 58, 12, 12, 11, 0.9, 'Green Blob', [[1, 'thorn_volley'], [5, 'bloom']], { evolvesTo: { id: 'spikegloop', level: 10 }, catchRate: 0.5 }], 'A wobbly blob of moss that hums when happy.'],
  [['spikegloop', 'Spikegloop', 'nature', 70, 16, 16, 11, 1.3, 'Green Spiky Blob', [[1, 'thorn_volley'], [5, 'bloom'], [10, 'vine_snare']], { catchRate: 0.25 }], 'Grew thorns after being sat on one too many times.'],
  [['chirpling', 'Chirpling', 'wind', 48, 13, 9, 18, 0.9, 'Birb', [[1, 'gale_cut'], [5, 'feather_dart'], [10, 'tailwind']], { catchRate: 0.5 }], 'Round, fluffy, and absolutely certain it is a hawk.'],
  [['pecklet', 'Pecklet', 'earth', 54, 14, 12, 12, 0.9, 'Chicken', [[1, 'rock_toss'], [6, 'stone_skin']], { catchRate: 0.5 }], 'Pecks pebbles all day. Swallows the shiny ones.'],
  [['hopscotch', 'Hopscotch', 'wind', 56, 15, 11, 17, 1.4, 'Bunny', [[1, 'gale_cut'], [6, 'tailwind'], [11, 'cyclone']], { catchRate: 0.35 }], 'Leaps so high it naps on clouds.'],
  [['pricklet', 'Pricklet', 'nature', 58, 14, 15, 9, 0.9, 'Cactoro:small', [[1, 'thorn_volley'], [6, 'vine_snare']], { evolvesTo: { id: 'saguardian', level: 15 }, catchRate: 0.45 }], 'Hugs are not recommended.'],
  [['saguardian', 'Saguardian', 'nature', 76, 18, 20, 10, 1.9, 'Cactoro:elite', [[1, 'thorn_volley'], [1, 'vine_snare'], [15, 'grove_wrath']], { catchRate: 0.15 }], 'Stands watch over desert springs for centuries.'],
  [['voltcat', 'Voltcat', 'storm', 50, 15, 10, 20, 0.9, 'Cat', [[1, 'spark_jab'], [5, 'overcharge'], [10, 'thunderclap']], { catchRate: 0.4 }], 'Static fur. Do not pet in dry weather.'],
  [['monkroose', 'Monkroose', 'earth', 64, 17, 14, 15, 1.5, 'Monkroose', [[1, 'rock_toss'], [5, 'boulder_slam'], [10, 'tremor']], { catchRate: 0.3 }], 'Juggles river stones to impress rivals.'],

  // ── Ember Scar ──────────────────────────────────────────────────────────
  [['impling', 'Impling', 'fire', 50, 16, 10, 17, 1.0, 'Demon:small', [[1, 'ember_bite'], [5, 'kindle'], [9, 'flare_burst']], { evolvesTo: { id: 'hellion', level: 14 }, catchRate: 0.4 }], 'Mischief given wings and a tiny pitchfork.'],
  [['hellion', 'Hellion', 'fire', 68, 21, 14, 17, 1.9, 'Demon:elite', [[1, 'ember_bite'], [1, 'kindle'], [9, 'flare_burst'], [14, 'cinder_claw']], { catchRate: 0.12 }], 'Its laugh crackles like a forest fire.'],
  [['gloomling', 'Gloomling', 'void', 52, 16, 11, 17, 1.0, 'Goleling', [[1, 'shadow_claw'], [5, 'soul_siphon'], [10, 'umbral_wave']], { evolvesTo: { id: 'gloomlord', level: 14 }, catchRate: 0.35 }], 'Hangs from cave ceilings, giggling at echoes.'],
  [['gloomlord', 'Gloomlord', 'void', 70, 21, 15, 18, 1.7, 'Goleling Evolved', [[1, 'shadow_claw'], [1, 'soul_siphon'], [10, 'umbral_wave'], [16, 'static_field']], { catchRate: 0.1 }], 'Wears a crown it swears it did not steal.'],
  [['grunt', 'Grunt', 'earth', 62, 16, 14, 11, 1.0, 'Orc Enemy', [[1, 'rock_toss'], [6, 'boulder_slam']], { evolvesTo: { id: 'warlord', level: 15 }, catchRate: 0.4 }], 'Small, loud, and fiercely loyal.'],
  [['warlord', 'Warlord', 'earth', 80, 21, 18, 12, 2.0, 'Orc', [[1, 'rock_toss'], [1, 'boulder_slam'], [15, 'tremor']], { catchRate: 0.12 }], 'Wears the scars of a hundred friendly duels.'],
  [['cinderquid', 'Cinderquid', 'fire', 56, 17, 12, 15, 1.2, 'Squidle', [[1, 'ember_bite'], [6, 'flare_burst'], [11, 'kindle']], { catchRate: 0.3 }], 'Swims through lava as if it were bathwater.'],

  // ── Mirror Lakes ────────────────────────────────────────────────────────
  [['glub', 'Glub', 'water', 58, 13, 13, 12, 1.0, 'Glub', [[1, 'tide_lash'], [5, 'bubble_veil'], [9, 'aqua_jet']], { evolvesTo: { id: 'glubbernaut', level: 12 }, catchRate: 0.45 }], 'Blows bubbles in patterns only it understands.'],
  [['glubbernaut', 'Glubbernaut', 'water', 76, 17, 17, 13, 1.7, 'Glub Evolved', [[1, 'tide_lash'], [1, 'bubble_veil'], [9, 'aqua_jet'], [14, 'riptide']], { catchRate: 0.15 }], 'Patrols the deep lakes in a shell of pressure.'],
  [['croakus', 'Croakus', 'water', 64, 15, 13, 14, 1.4, 'Frog', [[1, 'aqua_jet'], [6, 'mend_rain'], [11, 'riptide']], { catchRate: 0.35 }], 'Its croak can be heard three lakes away.'],
  [['bubblin', 'Bubblin', 'water', 56, 12, 14, 10, 0.8, 'Pink Slime', [[1, 'tide_lash'], [5, 'mend_rain']], { catchRate: 0.5 }], 'Tastes like strawberries. Please do not check.'],
  [['alpuff', 'Alpuff', 'wind', 58, 13, 13, 15, 1.1, 'Alpaking', [[1, 'gale_cut'], [5, 'tailwind'], [9, 'feather_dart']], { evolvesTo: { id: 'alpaqueen', level: 14 }, catchRate: 0.4 }], 'So fluffy the wind carries it like a dandelion.'],
  [['alpaqueen', 'Alpaqueen', 'wind', 76, 17, 16, 17, 1.8, 'Alpaking Evolved', [[1, 'gale_cut'], [1, 'tailwind'], [9, 'feather_dart'], [14, 'cyclone']], { catchRate: 0.12 }], 'Rules the high meadows with a gentle hoof.'],
  [['whirlie', 'Whirlie', 'water', 54, 15, 11, 17, 1.2, 'Hywirl', [[1, 'tide_lash'], [6, 'aqua_jet'], [11, 'riptide']], { catchRate: 0.35 }], 'Spins whirlpools for fun. Boats disagree.'],

  // ── Stormreach Peaks ────────────────────────────────────────────────────
  [['zapbee', 'Zapbee', 'storm', 50, 15, 11, 19, 0.9, 'Armabee', [[1, 'spark_jab'], [5, 'overcharge'], [9, 'static_field']], { evolvesTo: { id: 'voltarmor', level: 14 }, catchRate: 0.4 }], 'Its buzz is literally electric.'],
  [['voltarmor', 'Voltarmor', 'storm', 70, 19, 17, 19, 1.6, 'Armabee Evolved', [[1, 'spark_jab'], [1, 'overcharge'], [9, 'static_field'], [14, 'thunderclap']], { catchRate: 0.12 }], 'Plated in storm-forged chitin.'],
  [['zorp', 'Zorp', 'storm', 52, 16, 10, 17, 1.0, 'Alien:small', [[1, 'spark_jab'], [6, 'static_field']], { evolvesTo: { id: 'xenobolt', level: 16 }, catchRate: 0.35 }], 'Fell from a lightning bolt. Wants to go home.'],
  [['xenobolt', 'Xenobolt', 'storm', 70, 21, 15, 18, 1.9, 'Alien:elite', [[1, 'spark_jab'], [1, 'static_field'], [16, 'thunderclap']], { catchRate: 0.1 }], 'Channels the sky through its antenna.'],
  [['frostling', 'Frostling', 'wind', 60, 15, 14, 13, 1.0, 'Yeti:small', [[1, 'gale_cut'], [6, 'bubble_veil'], [11, 'cyclone']], { evolvesTo: { id: 'glaciator', level: 16 }, catchRate: 0.35 }], 'Builds snow forts and defends them to the end.'],
  [['glaciator', 'Glaciator', 'wind', 84, 20, 19, 12, 2.1, 'Yeti:elite', [[1, 'gale_cut'], [1, 'bubble_veil'], [11, 'cyclone'], [16, 'boulder_slam']], { catchRate: 0.1 }], 'An avalanche with opinions.'],
  [['shadekin', 'Shadekin', 'wind', 50, 17, 9, 21, 1.0, 'Ninja:small', [[1, 'gale_cut'], [5, 'shadow_claw'], [10, 'feather_dart']], { evolvesTo: { id: 'shinobi', level: 15 }, catchRate: 0.35 }], 'You will not see it coming. It is very proud of this.'],
  [['shinobi', 'Shinobi', 'wind', 66, 22, 13, 23, 1.8, 'Ninja:elite', [[1, 'gale_cut'], [1, 'shadow_claw'], [10, 'feather_dart'], [15, 'cyclone']], { catchRate: 0.1 }], 'Strikes between heartbeats.'],
  [['sparkmage', 'Sparkmage', 'storm', 54, 18, 11, 15, 1.0, 'Wizard', [[1, 'spark_jab'], [5, 'static_field'], [10, 'thunderclap']], { catchRate: 0.3 }], 'Studied lightning at a school that no longer exists.'],
  [['wisp', 'Wisp', 'void', 52, 17, 11, 18, 1.1, 'Ghost', [[1, 'shadow_claw'], [6, 'soul_siphon'], [12, 'static_field']], { catchRate: 0.2 }], 'A lantern-light that follows lost travellers home.'],

  // ── Bosses ──────────────────────────────────────────────────────────────
  [['thornjaw', 'Thornjaw Rex', 'nature', 165, 15, 14, 10, 6.5, 'Dino', [[1, 'thorn_volley'], [1, 'void_rend'], [1, 'vine_snare']], { boss: true, catchRate: 0 }], 'Guardian of the Verdant Vale. Its roar shakes pollen from every tree.'],
  [['ashen_totem', 'Ashen Totem', 'fire', 200, 18, 17, 9, 6.8, 'Tribal', [[1, 'cinder_rain'], [1, 'gravemaw'], [1, 'flare_burst']], { boss: true, catchRate: 0 }], 'A mask the size of a house, carved by a people made of ash.'],
  [['abyssal_tyrant', 'Abyssal Tyrant', 'water', 195, 18, 15, 12, 6.8, 'Blue Demon', [[1, 'maelstrom'], [1, 'eclipse_wave'], [1, 'riptide']], { boss: true, catchRate: 0 }], 'The reflection in the lake that does not copy you.'],
  [['stormcrown', 'Stormcrown', 'void', 240, 21, 16, 16, 7.5, 'Ghost Skull', [[1, 'skyfall'], [1, 'gravemaw'], [1, 'eclipse_wave']], { boss: true, catchRate: 0 }], 'The crowned wraith that painted the sky with lightning.'],
];

export const SPECIES: Record<string, Species> = Object.fromEntries(LIST.map(([row, lore]) => [row[0], make(row, lore)]));

export const STARTERS = ['emberling', 'finnik', 'sporelet'];

/** Evolution chain for display (base → … → final). */
export function evolutionLine(id: string): string[] {
  let base = id;
  for (;;) {
    const prev = Object.values(SPECIES).find((s) => s.evolvesTo?.id === base);
    if (!prev) break;
    base = prev.id;
  }
  const line = [base];
  while (SPECIES[line[line.length - 1]].evolvesTo) line.push(SPECIES[line[line.length - 1]].evolvesTo!.id);
  return line;
}
