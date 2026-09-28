import type { Element } from './elements';
import type { StatusId } from './traits';

export type SkillKind = 'attack' | 'heal' | 'buff' | 'debuff';
export type SkillTarget = 'enemy' | 'allEnemies' | 'self' | 'ally' | 'allAllies';
export type Vfx = 'slash' | 'projectile' | 'burst' | 'beam' | 'heal' | 'aura' | 'quake';
export type Stat = 'atk' | 'def' | 'spd';

/** One strike in an enemy attack rhythm. `t` = ms after wind-up ends. */
export interface Strike {
  t: number;
  /** Red strike: cannot be parried, only dodged. */
  unblockable?: boolean;
  /** Gold shockwave: must be JUMPED (parry/dodge fail). */
  jump?: boolean;
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
  /** Chance to inflict a status on each target. */
  status?: { id: StatusId; chance: number };
  /** Cures status on targets (heals). */
  cure?: boolean;
  /** Burst ultimate (costs a full Burst gauge, not AP). */
  ultimate?: boolean;
  desc: string;
}

const S = (s: Skill) => s;

export const SKILLS: Record<string, Skill> = {
  // ── Basic ───────────────────────────────────────────────
  strike: S({ id: 'strike', name: 'Strike', element: 'earth', kind: 'attack', target: 'enemy', power: 10, hits: 1, ap: 0, breakPower: 8, vfx: 'slash', desc: 'Basic attack. Grants +1 AP.' }),

  // ── Fire ────────────────────────────────────────────────
  ember_bite: S({ id: 'ember_bite', name: 'Ember Bite', element: 'fire', kind: 'attack', target: 'enemy', power: 16, hits: 2, ap: 2, breakPower: 10, vfx: 'slash', status: { id: 'burn', chance: 0.1 }, desc: 'Two searing bites (10% burn).' }),
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
  spark_jab: S({ id: 'spark_jab', name: 'Spark Jab', element: 'storm', kind: 'attack', target: 'enemy', power: 10, hits: 4, ap: 2, breakPower: 6, vfx: 'slash', status: { id: 'paralyze', chance: 0.06 }, desc: 'Four lightning-fast jabs.' }),
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

  // ── Status & utility moves ──────────────────────────────
  sleep_spore: S({ id: 'sleep_spore', name: 'Sleep Spore', element: 'nature', kind: 'debuff', target: 'enemy', power: 0, hits: 1, ap: 3, breakPower: 6, vfx: 'burst', status: { id: 'sleep', chance: 0.75 }, desc: 'Lulls a foe to sleep (75%).' }),
  toxic_mist: S({ id: 'toxic_mist', name: 'Toxic Mist', element: 'void', kind: 'attack', target: 'allEnemies', power: 8, hits: 1, ap: 3, breakPower: 6, vfx: 'burst', status: { id: 'poison', chance: 0.6 }, desc: 'Poisonous fog over all foes (60% poison).' }),
  scald: S({ id: 'scald', name: 'Scald', element: 'water', kind: 'attack', target: 'enemy', power: 22, hits: 1, ap: 3, breakPower: 12, vfx: 'beam', status: { id: 'burn', chance: 0.3 }, desc: 'Boiling water (30% burn).' }),
  frost_breath: S({ id: 'frost_breath', name: 'Frost Breath', element: 'wind', kind: 'attack', target: 'enemy', power: 14, hits: 2, ap: 3, breakPower: 10, vfx: 'beam', status: { id: 'freeze', chance: 0.15 }, desc: 'Freezing gusts (15% freeze).' }),
  thunder_wave: S({ id: 'thunder_wave', name: 'Thunder Wave', element: 'storm', kind: 'debuff', target: 'enemy', power: 0, hits: 1, ap: 2, breakPower: 8, vfx: 'beam', status: { id: 'paralyze', chance: 0.85 }, desc: 'Paralyses a foe (85%).' }),
  hypno_glow: S({ id: 'hypno_glow', name: 'Hypno Glow', element: 'void', kind: 'debuff', target: 'enemy', power: 0, hits: 1, ap: 2, breakPower: 8, vfx: 'aura', status: { id: 'confuse', chance: 0.75 }, desc: 'Confuses a foe (75%).' }),
  purify: S({ id: 'purify', name: 'Purifying Rain', element: 'water', kind: 'heal', target: 'allAllies', power: 14, hits: 1, ap: 3, breakPower: 0, vfx: 'heal', cure: true, desc: 'Heals the team and cures status.' }),
  flame_wheel: S({ id: 'flame_wheel', name: 'Flame Wheel', element: 'fire', kind: 'attack', target: 'enemy', power: 17, hits: 2, ap: 3, breakPower: 12, vfx: 'slash', status: { id: 'burn', chance: 0.2 }, desc: 'Rolling fire (20% burn).' }),
  venom_fang: S({ id: 'venom_fang', name: 'Venom Fang', element: 'void', kind: 'attack', target: 'enemy', power: 16, hits: 2, ap: 2, breakPower: 10, vfx: 'slash', status: { id: 'poison', chance: 0.3 }, desc: 'Toxic bite (30% poison).' }),
  spark_storm: S({ id: 'spark_storm', name: 'Spark Storm', element: 'storm', kind: 'attack', target: 'allEnemies', power: 14, hits: 2, ap: 4, breakPower: 9, vfx: 'burst', status: { id: 'paralyze', chance: 0.15 }, desc: 'Sparks rain on all foes (15% paralysis).' }),

  // ── Burst ultimates (one per element; unleashed with a full Burst gauge) ──
  ult_fire: S({ id: 'ult_fire', name: 'Supernova Fang', element: 'fire', kind: 'attack', target: 'allEnemies', power: 26, hits: 5, ap: 0, breakPower: 22, vfx: 'burst', ultimate: true, status: { id: 'burn', chance: 0.4 }, desc: 'A sun detonates in the jaws of your Mystic.' }),
  ult_water: S({ id: 'ult_water', name: 'Leviathan Tide', element: 'water', kind: 'attack', target: 'allEnemies', power: 25, hits: 5, ap: 0, breakPower: 22, vfx: 'beam', ultimate: true, desc: 'The sea itself answers the call.' }),
  ult_nature: S({ id: 'ult_nature', name: 'World-Tree Bloom', element: 'nature', kind: 'attack', target: 'allEnemies', power: 23, hits: 5, ap: 0, breakPower: 26, vfx: 'quake', ultimate: true, status: { id: 'sleep', chance: 0.25 }, desc: 'Ancient roots erupt in a storm of petals.' }),
  ult_earth: S({ id: 'ult_earth', name: 'Continental Drift', element: 'earth', kind: 'attack', target: 'allEnemies', power: 27, hits: 5, ap: 0, breakPower: 30, vfx: 'quake', ultimate: true, desc: 'The ground folds like paper.' }),
  ult_storm: S({ id: 'ult_storm', name: 'Heaven’s Verdict', element: 'storm', kind: 'attack', target: 'allEnemies', power: 25, hits: 5, ap: 0, breakPower: 22, vfx: 'beam', ultimate: true, status: { id: 'paralyze', chance: 0.35 }, desc: 'Five bolts, perfectly on the beat.' }),
  ult_wind: S({ id: 'ult_wind', name: 'Thousand Feathers', element: 'wind', kind: 'attack', target: 'allEnemies', power: 22, hits: 6, ap: 0, breakPower: 18, vfx: 'projectile', ultimate: true, desc: 'A hurricane of razor plumes.' }),
  ult_void: S({ id: 'ult_void', name: 'Eclipse Requiem', element: 'void', kind: 'attack', target: 'allEnemies', power: 26, hits: 5, ap: 0, breakPower: 24, vfx: 'beam', ultimate: true, status: { id: 'confuse', chance: 0.35 }, desc: 'Light forgets how to shine.' }),

  // ── Guardian techniques with gold (jump) shockwaves ───────
  earthshaker: S({ id: 'earthshaker', name: 'Earthshaker', element: 'earth', kind: 'attack', target: 'allEnemies', power: 18, hits: 3, ap: 0, breakPower: 0, vfx: 'quake', desc: 'Shockwaves ripple outward — jump them!', pattern: [{ t: 0, jump: true }, { t: 650, jump: true }, { t: 1500 }] }),
  tidal_crash: S({ id: 'tidal_crash', name: 'Tidal Crash', element: 'water', kind: 'attack', target: 'allEnemies', power: 17, hits: 3, ap: 0, breakPower: 0, vfx: 'beam', desc: 'A wave, a feint, a wall of water.', pattern: [{ t: 0 }, { t: 900, jump: true }, { t: 1250, unblockable: true }] }),
  root_quake: S({ id: 'root_quake', name: 'Root Quake', element: 'nature', kind: 'attack', target: 'allEnemies', power: 16, hits: 3, ap: 0, breakPower: 0, vfx: 'quake', desc: 'Roots burst from below.', pattern: [{ t: 0, jump: true }, { t: 480 }, { t: 1200, jump: true }] }),
  sandstorm_fury: S({ id: 'sandstorm_fury', name: 'Sandstorm Fury', element: 'earth', kind: 'attack', target: 'allEnemies', power: 15, hits: 4, ap: 0, breakPower: 0, vfx: 'burst', desc: 'Scouring sand and a crushing stomp.', pattern: [{ t: 0 }, { t: 300 }, { t: 600 }, { t: 1500, jump: true }] }),
  bog_breath: S({ id: 'bog_breath', name: 'Bog Breath', element: 'void', kind: 'attack', target: 'allEnemies', power: 14, hits: 2, ap: 0, breakPower: 0, vfx: 'burst', status: { id: 'poison', chance: 0.35 }, desc: 'A choking cloud of marsh gas.', pattern: [{ t: 0 }, { t: 1100, unblockable: true }] }),

  // ── v3 · new lands (Sapphire Coast, Elderwood, Glimmer Hollows, Aether Crown) ──
  gust_dive: S({ id: 'gust_dive', name: 'Gust Dive', element: 'wind', kind: 'attack', target: 'enemy', power: 17, hits: 2, ap: 2, breakPower: 10, vfx: 'slash', desc: 'Drops out of the sky beak-first, twice.' }),
  shell_guard: S({ id: 'shell_guard', name: 'Shell Guard', element: 'water', kind: 'buff', target: 'allAllies', power: 0, hits: 1, ap: 3, breakPower: 0, vfx: 'aura', effect: { stat: 'def', amount: 0.35, turns: 3 }, desc: 'The whole team tucks in behind a wall of shell.' }),
  brine_lance: S({ id: 'brine_lance', name: 'Brine Lance', element: 'water', kind: 'attack', target: 'enemy', power: 30, hits: 1, ap: 3, breakPower: 24, vfx: 'beam', desc: 'A needle of seawater. Huge Break.' }),
  ink_cloud: S({ id: 'ink_cloud', name: 'Ink Cloud', element: 'void', kind: 'debuff', target: 'allEnemies', power: 6, hits: 1, ap: 3, breakPower: 8, vfx: 'burst', effect: { stat: 'spd', amount: -0.3, turns: 3 }, desc: 'Blots out the fight: every foe slows.' }),
  pounce: S({ id: 'pounce', name: 'Pounce', element: 'nature', kind: 'attack', target: 'enemy', power: 24, hits: 1, ap: 2, breakPower: 18, vfx: 'slash', desc: 'Springs from cover. Strong Break.' }),
  thorn_howl: S({ id: 'thorn_howl', name: 'Thorn Howl', element: 'nature', kind: 'debuff', target: 'allEnemies', power: 0, hits: 1, ap: 2, breakPower: 6, vfx: 'aura', effect: { stat: 'atk', amount: -0.25, turns: 3 }, desc: 'A bristling howl: every foe loses its nerve.' }),
  lantern_flare: S({ id: 'lantern_flare', name: 'Lantern Flare', element: 'fire', kind: 'attack', target: 'enemy', power: 16, hits: 2, ap: 2, breakPower: 10, vfx: 'projectile', status: { id: 'burn', chance: 0.25 }, desc: 'Two wisps of tail-fire (25% burn).' }),
  moon_hoot: S({ id: 'moon_hoot', name: 'Moon Hoot', element: 'wind', kind: 'debuff', target: 'enemy', power: 0, hits: 1, ap: 2, breakPower: 8, vfx: 'aura', status: { id: 'sleep', chance: 0.7 }, desc: 'A low, round hoot. Foes nod off (70%).' }),
  crystal_lance: S({ id: 'crystal_lance', name: 'Crystal Lance', element: 'storm', kind: 'attack', target: 'enemy', power: 28, hits: 1, ap: 3, breakPower: 22, vfx: 'beam', status: { id: 'paralyze', chance: 0.15 }, desc: 'A spear of charged quartz (15% paralysis).' }),
  geode_shell: S({ id: 'geode_shell', name: 'Geode Shell', element: 'earth', kind: 'buff', target: 'self', power: 0, hits: 1, ap: 2, breakPower: 0, vfx: 'aura', effect: { stat: 'def', amount: 0.6, turns: 3 }, desc: 'Crystal grows over its hide.' }),
  prism_ray: S({ id: 'prism_ray', name: 'Prism Ray', element: 'storm', kind: 'attack', target: 'allEnemies', power: 18, hits: 2, ap: 5, breakPower: 12, vfx: 'beam', desc: 'Light splits into seven colours and all of them hurt.' }),
  aether_gale: S({ id: 'aether_gale', name: 'Aether Gale', element: 'wind', kind: 'attack', target: 'allEnemies', power: 20, hits: 2, ap: 5, breakPower: 12, vfx: 'burst', desc: 'Wind from the top of the world.' }),
  warden_edge: S({ id: 'warden_edge', name: 'Warden’s Edge', element: 'void', kind: 'attack', target: 'enemy', power: 22, hits: 2, ap: 3, breakPower: 16, vfx: 'slash', desc: 'The old Sky Warden sword form, remembered in bone.' }),
  // Guardian techniques (patterned rhythms, gold = jump, red = dodge only)
  tide_bell: S({ id: 'tide_bell', name: 'Tolling Tide', element: 'water', kind: 'attack', target: 'allEnemies', power: 16, hits: 3, ap: 0, breakPower: 0, vfx: 'beam', desc: 'Three tolls of a drowned bell; the last one rolls along the ground.', pattern: [{ t: 0 }, { t: 700 }, { t: 1400, jump: true }] }),
  antler_rush: S({ id: 'antler_rush', name: 'Antler Rush', element: 'nature', kind: 'attack', target: 'enemy', power: 15, hits: 4, ap: 0, breakPower: 0, vfx: 'slash', desc: 'Three gores and a charge you cannot parry.', pattern: [{ t: 0 }, { t: 320 }, { t: 640 }, { t: 1500, unblockable: true }] }),
  geode_burst: S({ id: 'geode_burst', name: 'Geode Burst', element: 'earth', kind: 'attack', target: 'allEnemies', power: 17, hits: 3, ap: 0, breakPower: 0, vfx: 'quake', desc: 'The ground cracks open into crystal — jump the shards.', pattern: [{ t: 0, jump: true }, { t: 520 }, { t: 1150, jump: true }] }),
  aether_judgement: S({ id: 'aether_judgement', name: 'Aether Judgement', element: 'storm', kind: 'attack', target: 'allEnemies', power: 16, hits: 5, ap: 0, breakPower: 0, vfx: 'beam', desc: 'Five verdicts from the crown of the storm.', pattern: [{ t: 0 }, { t: 260 }, { t: 900, jump: true }, { t: 1350, unblockable: true }, { t: 1600 }] }),
  void_crown: S({ id: 'void_crown', name: 'Void Crown', element: 'void', kind: 'attack', target: 'allEnemies', power: 21, hits: 2, ap: 0, breakPower: 0, vfx: 'burst', status: { id: 'confuse', chance: 0.25 }, desc: 'A ring of night closes on the field.', pattern: [{ t: 0, unblockable: true }, { t: 1000 }] }),

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
