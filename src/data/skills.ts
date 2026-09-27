import type { Element } from './elements';

export type SkillKind = 'attack' | 'heal' | 'buff' | 'debuff';
export type SkillTarget = 'enemy' | 'allEnemies' | 'self' | 'ally' | 'allAllies';
export type Vfx = 'slash' | 'projectile' | 'burst' | 'beam' | 'heal' | 'aura' | 'quake';
export type Stat = 'atk' | 'def' | 'spd';

/** One strike in an enemy attack rhythm. `t` = ms after wind-up ends. */
export interface Strike {
  t: number;
  /** Red strike: cannot be parried, only dodged. */
  unblockable?: boolean;
}

export interface Skill {
  id: string;
  name: string;
  element: Element;
  kind: SkillKind;
  target: SkillTarget;
  /** Damage (or heal) power per hit. */
  power: number;
  /** Number of timed hits (player QTE presses). */
  hits: number;
  ap: number;
  /** Break gauge damage per hit. */
  breakPower: number;
  vfx: Vfx;
  effect?: { stat: Stat; amount: number; turns: number };
  /** Enemy-side rhythm. Defaults to evenly spaced strikes, one per hit. */
  pattern?: Strike[];
  desc: string;
}

const S = (s: Skill) => s;

export const SKILLS: Record<string, Skill> = {
  // ── Basic ───────────────────────────────────────────────
  strike: S({ id: 'strike', name: 'Strike', element: 'earth', kind: 'attack', target: 'enemy', power: 10, hits: 1, ap: 0, breakPower: 8, vfx: 'slash', desc: 'Basic attack. Grants +1 AP.' }),

  // ── Fire ────────────────────────────────────────────────
  ember_bite: S({ id: 'ember_bite', name: 'Ember Bite', element: 'fire', kind: 'attack', target: 'enemy', power: 16, hits: 2, ap: 2, breakPower: 10, vfx: 'slash', desc: 'Two searing bites.' }),
  flare_burst: S({ id: 'flare_burst', name: 'Flare Burst', element: 'fire', kind: 'attack', target: 'allEnemies', power: 18, hits: 1, ap: 4, breakPower: 14, vfx: 'burst', desc: 'Explodes, hitting every foe.' }),
  kindle: S({ id: 'kindle', name: 'Kindle', element: 'fire', kind: 'buff', target: 'self', power: 0, hits: 1, ap: 2, breakPower: 0, vfx: 'aura', effect: { stat: 'atk', amount: 0.35, turns: 3 }, desc: 'Raise own ATK for 3 turns.' }),
  meteor_fang: S({ id: 'meteor_fang', name: 'Meteor Fang', element: 'fire', kind: 'attack', target: 'enemy', power: 22, hits: 3, ap: 6, breakPower: 18, vfx: 'projectile', desc: 'Triple meteor strike.' }),

  // ── Water ───────────────────────────────────────────────
  tide_lash: S({ id: 'tide_lash', name: 'Tide Lash', element: 'water', kind: 'attack', target: 'enemy', power: 15, hits: 2, ap: 2, breakPower: 10, vfx: 'slash', desc: 'Whip of pressurised water.' }),
  bubble_veil: S({ id: 'bubble_veil', name: 'Bubble Veil', element: 'water', kind: 'buff', target: 'allAllies', power: 0, hits: 1, ap: 3, breakPower: 0, vfx: 'aura', effect: { stat: 'def', amount: 0.3, turns: 3 }, desc: 'Raise team DEF for 3 turns.' }),
  riptide: S({ id: 'riptide', name: 'Riptide', element: 'water', kind: 'attack', target: 'allEnemies', power: 17, hits: 2, ap: 5, breakPower: 12, vfx: 'beam', desc: 'A crashing wave over all foes.' }),
  mend_rain: S({ id: 'mend_rain', name: 'Mend Rain', element: 'water', kind: 'heal', target: 'allAllies', power: 22, hits: 1, ap: 3, breakPower: 0, vfx: 'heal', desc: 'Heal the whole team.' }),

  // ── Nature ──────────────────────────────────────────────
  thorn_volley: S({ id: 'thorn_volley', name: 'Thorn Volley', element: 'nature', kind: 'attack', target: 'enemy', power: 12, hits: 3, ap: 2, breakPower: 7, vfx: 'projectile', desc: 'Three barbed thorns.' }),
  bloom: S({ id: 'bloom', name: 'Bloom', element: 'nature', kind: 'heal', target: 'ally', power: 34, hits: 1, ap: 2, breakPower: 0, vfx: 'heal', desc: 'Heal one ally.' }),
  vine_snare: S({ id: 'vine_snare', name: 'Vine Snare', element: 'nature', kind: 'debuff', target: 'enemy', power: 8, hits: 1, ap: 2, breakPower: 20, vfx: 'quake', effect: { stat: 'spd', amount: -0.35, turns: 3 }, desc: 'Slow a foe, heavy Break.' }),
  grove_wrath: S({ id: 'grove_wrath', name: 'Grove Wrath', element: 'nature', kind: 'attack', target: 'allEnemies', power: 20, hits: 2, ap: 6, breakPower: 14, vfx: 'quake', desc: 'Roots erupt under every foe.' }),

  // ── Earth ───────────────────────────────────────────────
  boulder_slam: S({ id: 'boulder_slam', name: 'Boulder Slam', element: 'earth', kind: 'attack', target: 'enemy', power: 26, hits: 1, ap: 3, breakPower: 26, vfx: 'quake', desc: 'Crushing blow. Huge Break.' }),
  stone_skin: S({ id: 'stone_skin', name: 'Stone Skin', element: 'earth', kind: 'buff', target: 'self', power: 0, hits: 1, ap: 2, breakPower: 0, vfx: 'aura', effect: { stat: 'def', amount: 0.5, turns: 3 }, desc: 'Greatly raise own DEF.' }),
  tremor: S({ id: 'tremor', name: 'Tremor', element: 'earth', kind: 'attack', target: 'allEnemies', power: 16, hits: 2, ap: 4, breakPower: 16, vfx: 'quake', desc: 'Ground shock hits all foes.' }),

  // ── Storm ───────────────────────────────────────────────
  spark_jab: S({ id: 'spark_jab', name: 'Spark Jab', element: 'storm', kind: 'attack', target: 'enemy', power: 10, hits: 4, ap: 2, breakPower: 6, vfx: 'slash', desc: 'Four lightning-fast jabs.' }),
  thunderclap: S({ id: 'thunderclap', name: 'Thunderclap', element: 'storm', kind: 'attack', target: 'allEnemies', power: 19, hits: 1, ap: 4, breakPower: 12, vfx: 'beam', desc: 'A bolt splits across all foes.' }),
  overcharge: S({ id: 'overcharge', name: 'Overcharge', element: 'storm', kind: 'buff', target: 'self', power: 0, hits: 1, ap: 2, breakPower: 0, vfx: 'aura', effect: { stat: 'spd', amount: 0.5, turns: 3 }, desc: 'Greatly raise own SPD.' }),

  // ── Wind ────────────────────────────────────────────────
  gale_cut: S({ id: 'gale_cut', name: 'Gale Cut', element: 'wind', kind: 'attack', target: 'enemy', power: 14, hits: 2, ap: 2, breakPower: 9, vfx: 'slash', desc: 'Twin razor gusts.' }),
  cyclone: S({ id: 'cyclone', name: 'Cyclone', element: 'wind', kind: 'attack', target: 'allEnemies', power: 15, hits: 3, ap: 5, breakPower: 9, vfx: 'burst', desc: 'Whirlwind hits all foes 3×.' }),
  tailwind: S({ id: 'tailwind', name: 'Tailwind', element: 'wind', kind: 'buff', target: 'allAllies', power: 0, hits: 1, ap: 3, breakPower: 0, vfx: 'aura', effect: { stat: 'spd', amount: 0.3, turns: 3 }, desc: 'Raise team SPD.' }),

  // ── Additional elemental moves ──────────────────────────
  cinder_claw: S({ id: 'cinder_claw', name: 'Cinder Claw', element: 'fire', kind: 'attack', target: 'enemy', power: 30, hits: 1, ap: 3, breakPower: 22, vfx: 'slash', desc: 'One heavy burning rake.' }),
  aqua_jet: S({ id: 'aqua_jet', name: 'Aqua Jet', element: 'water', kind: 'attack', target: 'enemy', power: 20, hits: 1, ap: 2, breakPower: 12, vfx: 'beam', desc: 'A focused jet of water.' }),
  rock_toss: S({ id: 'rock_toss', name: 'Rock Toss', element: 'earth', kind: 'attack', target: 'enemy', power: 13, hits: 2, ap: 2, breakPower: 14, vfx: 'projectile', desc: 'Hurls two stones.' }),
  feather_dart: S({ id: 'feather_dart', name: 'Feather Dart', element: 'wind', kind: 'attack', target: 'enemy', power: 10, hits: 3, ap: 2, breakPower: 7, vfx: 'projectile', desc: 'Three razor feathers.' }),
  static_field: S({ id: 'static_field', name: 'Static Field', element: 'storm', kind: 'debuff', target: 'allEnemies', power: 8, hits: 1, ap: 3, breakPower: 10, vfx: 'burst', effect: { stat: 'def', amount: -0.3, turns: 3 }, desc: 'Lowers every foe\'s DEF.' }),
  shadow_claw: S({ id: 'shadow_claw', name: 'Shadow Claw', element: 'void', kind: 'attack', target: 'enemy', power: 15, hits: 2, ap: 2, breakPower: 11, vfx: 'slash', desc: 'Claws from the unseen.' }),
  umbral_wave: S({ id: 'umbral_wave', name: 'Umbral Wave', element: 'void', kind: 'attack', target: 'allEnemies', power: 15, hits: 2, ap: 4, breakPower: 10, vfx: 'beam', desc: 'A wave of shadow washes over all foes.' }),
  soul_siphon: S({ id: 'soul_siphon', name: 'Soul Siphon', element: 'void', kind: 'heal', target: 'self', power: 30, hits: 1, ap: 3, breakPower: 0, vfx: 'heal', desc: 'Drain the air of life to mend yourself.' }),

  // ── Void / boss ─────────────────────────────────────────
  void_rend: S({ id: 'void_rend', name: 'Void Rend', element: 'void', kind: 'attack', target: 'enemy', power: 16, hits: 3, ap: 0, breakPower: 0, vfx: 'slash', desc: 'A rhythmic triple rend.', pattern: [{ t: 0 }, { t: 380 }, { t: 1000 }] }),
  eclipse_wave: S({ id: 'eclipse_wave', name: 'Eclipse Wave', element: 'void', kind: 'attack', target: 'allEnemies', power: 20, hits: 2, ap: 0, breakPower: 0, vfx: 'beam', desc: 'Two waves; the second cannot be parried.', pattern: [{ t: 0 }, { t: 900, unblockable: true }] }),
  gravemaw: S({ id: 'gravemaw', name: 'Gravemaw', element: 'void', kind: 'attack', target: 'enemy', power: 13, hits: 5, ap: 0, breakPower: 0, vfx: 'slash', desc: 'Five-strike flurry with a delayed finisher.', pattern: [{ t: 0 }, { t: 260 }, { t: 520 }, { t: 780 }, { t: 1650 }] }),
  cinder_rain: S({ id: 'cinder_rain', name: 'Cinder Rain', element: 'fire', kind: 'attack', target: 'allEnemies', power: 15, hits: 3, ap: 0, breakPower: 0, vfx: 'projectile', desc: 'Falling cinders.', pattern: [{ t: 0 }, { t: 700 }, { t: 1100, unblockable: true }] }),
  maelstrom: S({ id: 'maelstrom', name: 'Maelstrom', element: 'water', kind: 'attack', target: 'enemy', power: 18, hits: 4, ap: 0, breakPower: 0, vfx: 'beam', desc: 'Swirling tidal barrage.', pattern: [{ t: 0 }, { t: 520 }, { t: 740 }, { t: 1400 }] }),
  skyfall: S({ id: 'skyfall', name: 'Skyfall', element: 'storm', kind: 'attack', target: 'allEnemies', power: 17, hits: 3, ap: 0, breakPower: 0, vfx: 'beam', desc: 'Lightning from a clear sky.', pattern: [{ t: 0 }, { t: 1200, unblockable: true }, { t: 1440 }] }),
};

/** Enemy rhythm: explicit pattern or evenly spaced default. */
export function strikePattern(skill: Skill): Strike[] {
  if (skill.pattern) return skill.pattern;
  return Array.from({ length: skill.hits }, (_, i) => ({ t: i * 520 }));
}
