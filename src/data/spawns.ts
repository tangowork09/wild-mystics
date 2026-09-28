// Where each Mystic lives, per land, split by how you find it:
//   roam   → visible in the open world (you can see and chase them)
//   grass  → only in that land's tall grass (random encounter)
//   search → only by searching glimmering bushes / nests
//   night  → roam or rustle in grass only between dusk and dawn
//   fish   → hooked at that land's fishing spots
// Owned by the creatures workstream (see docs/v3/PLAN.md). Keys are region ids from zones.ts.

export type SpawnMethod = 'roam' | 'grass' | 'search' | 'night' | 'fish';
export interface Spawn { species: string; weight: number; method: SpawnMethod }

const S = (species: string, weight: number, method: SpawnMethod): Spawn => ({ species, weight, method });

export const SPAWNS: Record<string, Spawn[]> = {
  vale: [
    S('gloop', 3, 'roam'), S('chirpling', 3, 'roam'), S('pecklet', 2, 'roam'), S('hopscotch', 2, 'roam'),
    S('trotlet', 2.5, 'roam'), S('moolet', 2.5, 'roam'), S('dozewool', 2, 'roam'),
    S('pricklet', 3, 'grass'), S('voltcat', 2, 'grass'), S('sporelet', 0.7, 'grass'),
    S('snubbit', 2.5, 'grass'), S('honeybuzz', 2.5, 'grass'),
    S('monkroose', 2, 'search'), S('spikegloop', 0.6, 'search'),
    S('truffly', 2, 'search'), S('nibblet', 2, 'search'), S('loamstrider', 1, 'search'), S('bullwark', 1, 'search'),
    S('wisp', 1, 'night'),
    S('gildfin', 3, 'fish'), S('quillpuff', 2, 'fish'),
  ],
  lakes: [
    S('glub', 3, 'roam'), S('alpuff', 2, 'roam'), S('croakus', 2, 'roam'),
    S('clacker', 2.5, 'roam'), S('glenhart', 1.2, 'roam'),
    S('bubblin', 3, 'grass'), S('whirlie', 2, 'grass'), S('finnik', 0.7, 'grass'),
    S('gustail', 1.2, 'grass'),
    S('glubbernaut', 0.5, 'search'), S('alpaqueen', 0.4, 'search'),
    S('skymane', 0.5, 'search'),
    S('gloomling', 1, 'night'),
    S('gildfin', 3, 'fish'), S('quillpuff', 2.5, 'fish'), S('mirrorscale', 1.2, 'fish'), S('sunbasker', 1, 'fish'),
    S('grinfin', 1, 'fish'), S('skysail', 1.2, 'fish'), S('bellowdeep', 0.2, 'fish'), S('hobsnap', 0.2, 'fish'),
  ],
  coast: [
    S('clacker', 2.5, 'roam'), S('skimgull', 3, 'roam'), S('shellback', 2.5, 'roam'), S('saltfox', 1.2, 'roam'), S('coralclack', 1.2, 'roam'), S('hopscotch', 1, 'roam'), S('glub', 1.5, 'roam'),
    S('whirlie', 2.5, 'grass'), S('sandclack', 1.5, 'grass'), S('snubbit', 2, 'grass'), S('finnik', 0.6, 'grass'), S('chirpling', 1.5, 'grass'),
    S('sandgloop', 1, 'search'), S('magmaglub', 0.6, 'search'), S('glubbernaut', 0.4, 'search'), S('reefwarden', 0.4, 'search'), S('coralclack', 0.8, 'search'),
    S('squeakwing', 2, 'night'), S('moonhop', 0.4, 'night'), S('inkwhirl', 1.4, 'night'),
    S('jestfin', 3, 'fish'), S('quillpuff', 2.5, 'fish'), S('sunbasker', 1.5, 'fish'), S('lancefin', 1.2, 'fish'), S('grinfin', 1.2, 'fish'), S('skysail', 1.5, 'fish'), S('bellowdeep', 0.3, 'fish'),
  ],
  scar: [
    S('impling', 3, 'roam'), S('grunt', 3, 'roam'), S('cinderquid', 2, 'roam'),
    S('kilnback', 1.2, 'roam'),
    S('monkroose', 2, 'grass'), S('emberling', 0.7, 'grass'), S('gloomling', 1.5, 'grass'),
    S('scorchclaw', 1.2, 'grass'), S('ashwing', 1, 'grass'),
    S('warlord', 0.4, 'search'), S('hellion', 0.4, 'search'),
    S('pyrox', 0.5, 'search'), S('emberjaw', 0.8, 'search'),
    S('wisp', 1, 'night'), S('squeakwing', 2.5, 'night'), S('rattlecloak', 0.5, 'night'),
    S('emberspine', 1.5, 'fish'), S('magmascale', 0.6, 'fish'),
  ],
  marsh: [
    S('croakus', 3, 'roam'), S('bubblin', 2, 'roam'), S('gloomling', 2, 'roam'),
    S('sporelet', 2, 'grass'), S('gloop', 2, 'grass'), S('spikegloop', 1, 'grass'),
    S('hissling', 2.5, 'grass'), S('blorp', 2.5, 'grass'), S('mirecroak', 1, 'grass'),
    S('mycobloom', 0.5, 'search'),
    S('bonewarden', 1, 'search'), S('gobblorp', 1, 'search'),
    S('wisp', 2, 'night'), S('gloomlord', 0.4, 'night'),
    S('bonelet', 3, 'night'), S('skullbop', 2.5, 'night'), S('squeakwing', 2.5, 'night'),
    S('weblin', 2, 'night'), S('nibblet', 2, 'night'), S('hexbones', 0.5, 'night'),
    S('chompsy', 3, 'fish'), S('barbelmail', 2, 'fish'), S('lanterngulp', 0.25, 'fish'),
  ],
  elder: [
    S('fawnlet', 3, 'roam'), S('bramblewolf', 1.6, 'roam'), S('mosshulk', 1, 'roam'), S('glenhart', 1.5, 'roam'), S('truffly', 2, 'roam'), S('honeybuzz', 1.5, 'roam'), S('mossbuck', 0.6, 'roam'),
    S('sporelet', 2, 'grass'), S('thornet', 2, 'grass'), S('hissling', 2, 'grass'), S('gustail', 1.5, 'grass'), S('dozewool', 1.5, 'grass'),
    S('mycobloom', 0.8, 'search'), S('mosslime', 0.4, 'search'), S('sporeking', 0.15, 'search'), S('thornfang', 0.4, 'search'), S('mossbuck', 0.6, 'search'),
    S('lanternfox', 1.6, 'night'), S('hootsage', 1.4, 'night'), S('glowcap', 1.5, 'night'), S('weblin', 1.5, 'night'), S('wisp', 1.5, 'night'), S('moonhop', 0.6, 'night'),
    S('chompsy', 2, 'fish'), S('mirrorscale', 1, 'fish'),
  ],
  dunes: [
    S('pricklet', 3, 'roam'), S('monkroose', 2, 'roam'), S('grunt', 2, 'roam'),
    S('dustclaw', 3, 'roam'), S('hornwall', 2, 'roam'), S('duneplod', 2.5, 'roam'),
    S('voltcat', 2, 'grass'), S('zorp', 2, 'grass'), S('saguardian', 0.6, 'grass'),
    S('boltstripe', 2, 'grass'), S('thrumcrest', 2, 'grass'), S('thornet', 1.2, 'grass'), S('dunecat', 1.2, 'grass'),
    S('impling', 1, 'search'), S('warlord', 0.4, 'search'),
    S('sandclack', 1.2, 'search'), S('thunderneck', 0.5, 'search'), S('quakemaw', 0.4, 'search'), S('dustwhirl', 1, 'search'), S('sunbee', 0.8, 'search'),
    S('shadekin', 1.5, 'night'),
  ],
  peaks: [
    S('zapbee', 3, 'roam'), S('frostling', 3, 'roam'), S('sparkmage', 2, 'roam'),
    S('tuftumble', 2.5, 'roam'), S('rimehorn', 1.2, 'roam'), S('frostpeck', 1.5, 'roam'),
    S('zorp', 2, 'grass'), S('shadekin', 2, 'grass'),
    S('blizzarf', 0.6, 'grass'),
    S('glaciator', 0.4, 'search'), S('voltarmor', 0.4, 'search'),
    S('peakfleece', 1, 'search'), S('shinobi', 0.3, 'search'),
    S('wisp', 1, 'night'), S('gloomling', 1, 'night'), S('frostwisp', 0.5, 'night'),
    S('aurorhart', 0.2, 'night'),
  ],
  hollows: [
    S('geodgloop', 2.5, 'roam'), S('glimfox', 1.6, 'roam'), S('shardmaw', 1.4, 'roam'), S('quartzback', 1.4, 'roam'), S('cogling', 2.5, 'roam'), S('whirrbit', 2, 'roam'), S('thrumcrest', 1.2, 'roam'),
    S('voltcat', 2, 'grass'), S('zorp', 2, 'grass'), S('sparkmage', 1.5, 'grass'), S('boltstripe', 1.5, 'grass'),
    S('tinkertot', 1.2, 'search'), S('gearbrute', 1, 'search'), S('galegunner', 1, 'search'),
    S('stiltshot', 0.5, 'search'), S('arcannon', 0.4, 'search'), S('xenobolt', 0.3, 'search'), S('zapjelly', 0.4, 'search'),
    S('prismbat', 2.2, 'night'), S('frostwisp', 0.8, 'night'), S('glowcap', 1, 'night'),
  ],
  summit: [
    S('stormhowl', 1.4, 'roam'), S('galeherald', 1.6, 'roam'), S('wardenshade', 1.2, 'roam'), S('stormray', 1, 'roam'), S('haloling', 1, 'roam'),
    S('shinobi', 1.2, 'roam'), S('glaciator', 1, 'roam'), S('voltarmor', 1, 'roam'), S('alpaqueen', 1, 'roam'), S('skymane', 0.8, 'roam'),
    S('hellion', 1.2, 'grass'), S('gloomlord', 1.2, 'grass'), S('xenobolt', 1, 'grass'),
    S('umbrajelly', 0.4, 'search'), S('magmallow', 0.4, 'search'), S('zapjelly', 0.4, 'search'), S('mosslime', 0.4, 'search'),
    S('haloling', 1.4, 'night'), S('aurorhart', 0.4, 'night'), S('frostwisp', 1, 'night'),
  ],
};

/** How many roaming Mystics are kept alive around the player in each land. */
export const WILD_COUNT: Record<string, number> = { vale: 18, lakes: 16, coast: 16, scar: 16, marsh: 16, elder: 16, dunes: 16, peaks: 16, hollows: 16, summit: 14 };

// ── v3: overworld behaviour ────────────────────────────────────────────────
// Wild Mystics stream in around the player (see world/wilds.ts). Each species gets an archetype;
// unlisted species fall back to rig / rarity heuristics there.
export type Archetype = 'grazer' | 'skittish' | 'curious' | 'territorial' | 'flyer' | 'swimmer';

export const BEHAVIOR: Record<string, Archetype> = {
  // curious little ones: come over, stare, hop, wander off
  gloop: 'curious', sporelet: 'curious', bubblin: 'curious', blorp: 'curious', pecklet: 'curious', cogling: 'curious', tinkertot: 'curious',
  truffly: 'curious', snubbit: 'curious', zorp: 'curious', skullbop: 'curious', clacker: 'curious', frostling: 'curious', nibblet: 'curious',
  coralclack: 'curious', inkwhirl: 'curious', hootsage: 'curious', geodgloop: 'curious', skimgull: 'curious',
  // skittish: bolt when you get close
  hopscotch: 'skittish', voltcat: 'skittish', dunecat: 'skittish', gustail: 'skittish', moonhop: 'skittish', shadekin: 'skittish', glenhart: 'skittish',
  aurorhart: 'skittish', pricklet: 'skittish', weblin: 'skittish', hissling: 'skittish', monkroose: 'skittish', fawnlet: 'skittish', saltfox: 'skittish',
  glimfox: 'skittish', lanternfox: 'skittish', galeherald: 'skittish',
  // territorial: chase you down
  grunt: 'territorial', warlord: 'territorial', hellion: 'territorial', dustclaw: 'territorial', scorchclaw: 'territorial', quakemaw: 'territorial', bullwark: 'territorial',
  pyrox: 'territorial', gearbrute: 'territorial', arcannon: 'territorial', stiltshot: 'territorial', bonewarden: 'territorial', hexbones: 'territorial', rattlecloak: 'territorial',
  gobblorp: 'territorial', emberjaw: 'territorial', kilnback: 'territorial', glaciator: 'territorial', blizzarf: 'territorial', xenobolt: 'territorial',
  bramblewolf: 'territorial', thornfang: 'territorial', stormhowl: 'territorial', shardmaw: 'territorial', mosshulk: 'territorial', wardenshade: 'territorial',
  // grazers: wander, graze, keep their distance
  moolet: 'grazer', trotlet: 'grazer', loamstrider: 'grazer', skymane: 'grazer', dozewool: 'grazer', tuftumble: 'grazer', peakfleece: 'grazer', rimehorn: 'grazer',
  duneplod: 'grazer', boltstripe: 'grazer', hornwall: 'grazer', thrumcrest: 'grazer', thunderneck: 'grazer', mossbuck: 'grazer', shellback: 'grazer',
  reefwarden: 'grazer', quartzback: 'grazer',
  // flyers: circle overhead, swoop down to look at you
  prismbat: 'flyer', squeakwing: 'flyer', haloling: 'flyer',
};

/** Species that roam in groups: [min, max] members (herds graze together, packs hunt together). */
export const HERDS: Record<string, [number, number]> = {
  moolet: [2, 4], bullwark: [2, 3], trotlet: [2, 3], loamstrider: [2, 3], dozewool: [3, 5], tuftumble: [2, 4], peakfleece: [2, 3], duneplod: [2, 3],
  boltstripe: [3, 4], glenhart: [2, 3], rimehorn: [2, 3], hornwall: [2, 3], thrumcrest: [2, 3], dustclaw: [3, 4], scorchclaw: [2, 3],
  chirpling: [2, 4], squeakwing: [3, 5], honeybuzz: [2, 4], zapbee: [2, 4], fawnlet: [2, 4], mossbuck: [2, 3], bramblewolf: [3, 4], stormhowl: [2, 3],
  gildfin: [2, 3], chompsy: [2, 4], jestfin: [2, 4], skimgull: [3, 5], shellback: [2, 3], geodgloop: [2, 3], quartzback: [2, 3], galeherald: [2, 3],
};
/** Packs join a fight when one of them is attacked (one extra member, if close). */
export const PACKS = new Set(['dustclaw', 'scorchclaw', 'bramblewolf', 'stormhowl', 'chompsy']);
