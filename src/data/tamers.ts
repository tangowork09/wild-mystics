// Tamers: Pokémon-style trainer battles.
//   TAMERS        — roadside tamers placed in their land by landmarks.ts; rematch once per day.
//   STORY_TAMERS  — the Hollow Veil and other story fights; staged by quests as NPC actors
//                   (src/world/npcs.ts) and fought through the quest engine, never placed randomly.
//   kaiTeam()     — the rival's team grows with the story.
import type { Reward } from './progression';
import { SPECIES } from './species';

export interface TamerDef {
  id: string;
  name: string;
  title: string;
  zone: string;
  team: [string, number][]; // [species, level]
  intro: string;
  win: string;   // what they say when you beat them
  lose: string;  // what they say when they beat you
  reward: Reward;
  /** Hollow Veil member (story battles). */
  veil?: boolean;
  /** NPC actor id that stands in for this tamer (story tamers). */
  npc?: string;
}

const T = (t: TamerDef) => t;

export const TAMERS: TamerDef[] = [
  // Verdant Vale
  T({ id: 't_pip', name: 'Pip', title: 'Young Tamer', zone: 'vale', team: [['gloop', 4], ['chirpling', 5]], intro: 'You look new! My Gloop is new too. Let’s be new together!', win: 'Aww. Gloop, we’ll get them next time.', lose: 'We did it, Gloop!', reward: { gold: 180, items: { tonic: 1 } } }),
  T({ id: 't_marigold', name: 'Marigold', title: 'Meadow Botanist', zone: 'vale', team: [['pricklet', 6], ['sporelet', 6], ['spikegloop', 7]], intro: 'Every Mystic in this meadow is a flower that learned to walk.', win: 'Your team blooms beautifully.', lose: 'Prune your strategy, dear.', reward: { gold: 260, items: { leaf_stone: 1 } } }),
  T({ id: 't_rowan', name: 'Rowan', title: 'Hearthwick Guard', zone: 'vale', team: [['hopscotch', 7], ['monkroose', 8], ['voltcat', 8]], intro: 'Before the Grove, you’ll pass me. Standard procedure.', win: 'Procedure satisfied. Go on, then.', lose: 'Train a little more before the Grove.', reward: { gold: 320, aether: 40 } }),
  // Mirror Lakes
  T({ id: 't_nerissa', name: 'Nerissa', title: 'Lake Diver', zone: 'lakes', team: [['glub', 10], ['bubblin', 10], ['croakus', 11]], intro: 'The lakes are deep. So is my team.', win: 'You swam circles around us.', lose: 'Sink or swim, Wayfarer.', reward: { gold: 420, orbs: { tide: 2 } } }),
  T({ id: 't_aldous', name: 'Aldous', title: 'Fog Angler', zone: 'lakes', team: [['whirlie', 11], ['alpuff', 12], ['finnik', 12]], intro: 'Hush. You’ll scare the reflections.', win: 'A fine catch, that battle.', lose: 'Patience beats haste.', reward: { gold: 460, items: { water_stone: 1 } } }),
  T({ id: 't_isolde', name: 'Isolde', title: 'Mirror Knight', zone: 'lakes', team: [['glubbernaut', 13], ['alpaqueen', 13], ['mosslime', 13]], intro: 'Show me your reflection — in battle.', win: 'Your reflection is brighter than mine.', lose: 'Look again, and deeper.', reward: { gold: 520, aether: 60 } }),
  // Sapphire Coast
  T({ id: 't_maris', name: 'Maris', title: 'Tide Pool Scout', zone: 'coast', team: [['clacker', 9], ['glub', 10]], intro: 'Low tide means crab-fighting season. You look crab-shaped.', win: 'Okay, okay, you’re more of a lobster.', lose: 'Pinched!', reward: { gold: 400, items: { sea_glass: 1 } } }),
  T({ id: 't_bosun', name: 'Bosun Gale', title: 'Old Salt', zone: 'coast', team: [['whirlie', 11], ['quillpuff', 11], ['croakus', 12]], intro: 'Forty years at sea and I still get seasick. Battles settle my stomach.', win: 'Har! You’ve got sea legs after all.', lose: 'Back to port, landlubber.', reward: { gold: 460, orbs: { tide: 2 } } }),
  T({ id: 't_coralie', name: 'Coralie', title: 'Reef Dancer', zone: 'coast', team: [['sunbasker', 13], ['skysail', 13], ['glubbernaut', 13]], intro: 'The reef sings on moonlit nights. Let’s give it something to sing about.', win: 'You move like the tide.', lose: 'Out of rhythm, sweetheart.', reward: { gold: 540, aether: 60 } }),
  // Ember Scar
  T({ id: 't_brand', name: 'Brand', title: 'Ash Walker', zone: 'scar', team: [['impling', 10], ['grunt', 11], ['cinderquid', 11]], intro: 'Your boots will melt before my team does.', win: 'Alright, alright. Cool it.', lose: 'Too hot for you!', reward: { gold: 440, orbs: { ember: 2 } } }),
  T({ id: 't_calla', name: 'Calla', title: 'Obsidian Sculptor', zone: 'scar', team: [['emberjaw', 12], ['magmaglub', 12], ['ashwing', 12]], intro: 'I carve Mystics from cooled lava. Well — I carve their battle plans.', win: 'A masterpiece. Yours, sadly.', lose: 'Unrefined.', reward: { gold: 480, items: { fire_stone: 1 } } }),
  T({ id: 't_gorran', name: 'Gorran', title: 'Forge Veteran', zone: 'scar', team: [['warlord', 14], ['hellion', 14], ['magmallow', 14]], intro: 'I’ve hammered steel for forty years. Let’s see your temper.', win: 'Well-tempered, Wayfarer.', lose: 'Back to the anvil with you.', reward: { gold: 560, relic: 'warrior_band' } }),
  // Mistveil Marsh
  T({ id: 't_wren', name: 'Wren', title: 'Lantern Keeper', zone: 'marsh', team: [['mirecroak', 15], ['glowcap', 15], ['wisp', 16]], intro: 'Stay in the lantern light. Or battle me in the dark.', win: 'The lanterns burn brighter for you.', lose: 'The fog wins again.', reward: { gold: 600, orbs: { dusk: 3 } } }),
  T({ id: 't_hollis', name: 'Hollis', title: 'Bog Hermit', zone: 'marsh', team: [['spikegloop', 16], ['gloomling', 16], ['mycobloom', 17]], intro: 'Visitors. Hmph. Fine. One battle, then leave.', win: '…Stay for tea, then.', lose: 'Leave. Now.', reward: { gold: 640, items: { cleanse: 3 } } }),
  T({ id: 't_morgana', name: 'Morgana', title: 'Fog Witch', zone: 'marsh', team: [['gloomlord', 18], ['umbrajelly', 18], ['moonhop', 18]], intro: 'The fog told me your name before you arrived.', win: 'The fog was wrong about you.', lose: 'As foretold.', reward: { gold: 720, relic: 'venom_ring' } }),
  // Elderwood
  T({ id: 't_moss', name: 'Moss', title: 'Grove Tender', zone: 'elder', team: [['honeybuzz', 18], ['truffly', 19], ['thornet', 19]], intro: 'Mind the mushrooms. They’re listening.', win: 'The grove approves of you. Mostly.', lose: 'Rooted to the spot, eh?', reward: { gold: 700, items: { leaf_stone: 1 } } }),
  T({ id: 't_sable', name: 'Sable', title: 'Night Forager', zone: 'elder', team: [['weblin', 20], ['glowcap', 20], ['moonhop', 21]], intro: 'I only come out when the fireflies do. Lucky you.', win: 'You shine brighter than the fireflies.', lose: 'Lights out.', reward: { gold: 760, orbs: { dusk: 3 } } }),
  T({ id: 't_eldric', name: 'Eldric', title: 'Warden of Roots', zone: 'elder', team: [['glenhart', 22], ['mosslime', 22], ['mycobloom', 23]], intro: 'These trees were old when the Crown was young. Show them respect — and a good fight.', win: 'The roots remember you now.', lose: 'Patience, sapling.', reward: { gold: 840, relic: 'bramble_mail' } }),
  // Sunscorch Dunes
  T({ id: 't_sahir', name: 'Sahir', title: 'Caravan Scout', zone: 'dunes', team: [['sandgloop', 15], ['dunecat', 16], ['sunbee', 16]], intro: 'Water’s scarce. Battles aren’t.', win: 'Take some water. You earned it.', lose: 'The desert humbles everyone.', reward: { gold: 620, items: { thunder_stone: 1 } } }),
  T({ id: 't_zarya', name: 'Zarya', title: 'Dune Racer', zone: 'dunes', team: [['dustwhirl', 17], ['zorp', 17], ['voltcat', 18]], intro: 'Try to keep up!', win: 'You’re faster than the sandstorm!', lose: 'Eat my dust!', reward: { gold: 660, relic: 'swift_boots' } }),
  T({ id: 't_khalid', name: 'Khalid', title: 'Tomb Warden', zone: 'dunes', team: [['saguardian', 19], ['warlord', 19], ['xenobolt', 19]], intro: 'The Colossus sleeps. You will not wake it while I stand.', win: 'Then go. Wake the giant.', lose: 'Rest here, beneath the sand.', reward: { gold: 760, aether: 90 } }),
  // Stormreach Peaks
  T({ id: 't_ingrid', name: 'Ingrid', title: 'Summit Guide', zone: 'peaks', team: [['frostpeck', 20], ['frostling', 21], ['zapbee', 21]], intro: 'Thin air, thick skulls. Let’s test yours.', win: 'You’ll make the summit.', lose: 'Turn back while you can.', reward: { gold: 760, items: { wind_stone: 1 } } }),
  T({ id: 't_tesla', name: 'Tessaly', title: 'Storm Chaser', zone: 'peaks', team: [['voltarmor', 22], ['sparkmage', 22], ['zapjelly', 23]], intro: 'I bottle lightning. Want to see?', win: 'Shocking. Genuinely.', lose: 'Grounded!', reward: { gold: 820, relic: 'storm_feather' } }),
  T({ id: 't_ansel', name: 'Ansel', title: 'Crystal Sage', zone: 'peaks', team: [['glaciator', 24], ['shinobi', 24], ['frostwisp', 24], ['xenobolt', 25]], intro: 'The Stormcrown watches every battle on this mountain. Make it a good one.', win: 'It watched. It approves.', lose: 'Not yet, Wayfarer. Not yet.', reward: { gold: 900, aether: 150, relic: 'aegis_locket' } }),
  // Glimmer Hollows
  T({ id: 't_tinka', name: 'Tinka', title: 'Gearhead', zone: 'hollows', team: [['cogling', 23], ['tinkertot', 24], ['whirrbit', 24]], intro: 'I rebuilt these from ruin-scrap. They only beep a little.', win: 'Beep. That means “well done”.', lose: 'Beep beep! That means “ha”.', reward: { gold: 900, items: { thunder_stone: 1 } } }),
  T({ id: 't_brom', name: 'Brom', title: 'Crystal Miner', zone: 'hollows', team: [['boltstripe', 25], ['gearbrute', 25], ['thrumcrest', 26]], intro: 'I dig by crystal-light and fight by lightning. Pick your poison.', win: 'You struck a rich vein there.', lose: 'Cave-in! Better luck.', reward: { gold: 960, orbs: { grand: 2 } } }),
  T({ id: 't_lumen', name: 'Lumen', title: 'Prism Sage', zone: 'hollows', team: [['stiltshot', 27], ['galegunner', 27], ['zapjelly', 27], ['arcannon', 28]], intro: 'Light bends for me. So will you.', win: 'You split my light into a rainbow. Rude, but beautiful.', lose: 'Refracted.', reward: { gold: 1040, relic: 'burst_prism' } }),
  // Aether Crown
  T({ id: 't_aerin', name: 'Aerin', title: 'Sky Pilgrim', zone: 'summit', team: [['alpaqueen', 29], ['skymane', 30], ['shinobi', 30]], intro: 'I walked here from the coast to watch the storm. Walk with me a while — in battle.', win: 'The wind is kind to you.', lose: 'The mountain decides, not us.', reward: { gold: 1100, orbs: { sovereign: 1 } } }),
  T({ id: 't_corvin', name: 'Corvin', title: 'Storm Hermit', zone: 'summit', team: [['voltarmor', 31], ['xenobolt', 32], ['glaciator', 32]], intro: 'I have lived up here for thirty storms. You are the first visitor who wasn’t lost.', win: 'Not lost at all. Good.', lose: 'Now you’re lost.', reward: { gold: 1200, items: { hyper_ether: 2 } } }),
  T({ id: 't_seren', name: 'Seren', title: 'Last Acolyte', zone: 'summit', team: [['umbrajelly', 33], ['magmallow', 33], ['aurorhart', 34], ['hellion', 34]], intro: 'The Wardens trained here once. I still sweep their floors. Let me show you what they taught.', win: 'They would have liked you.', lose: 'Sweep the floor on your way out.', reward: { gold: 1400, aether: 200, relic: 'dawn_bell' } }),
];

// ── Story battles (the Hollow Veil) ───────────────────────────────────────────
export const STORY_TAMERS: TamerDef[] = [
  T({ id: 'veil_nettle', npc: 'veil_nettle', veil: true, name: 'Nettle', title: 'Veil Scout', zone: 'vale', team: [['gloomling', 7], ['wisp', 8]], intro: 'A Wayfarer? Here? The Magister said nobody walks the Grove anymore.', win: 'Fine! Keep your precious Guardian. We have eight more to visit.', lose: 'Run home. The light is spoken for.', reward: { gold: 300, items: { super_tonic: 2 } } }),
  T({ id: 'veil_marlo', npc: 'veil_marlo', veil: true, name: 'Marlo', title: 'Veil Diver', zone: 'lakes', team: [['gloomling', 11], ['whirlie', 12], ['croakus', 12]], intro: 'The Mirror doesn’t need to shine. Nobody looks up anymore.', win: 'Ugh. The lantern’s only half full. The Magister will sulk.', lose: 'Sink quietly, please.', reward: { gold: 480, orbs: { tide: 2 } } }),
  T({ id: 'veil_skerry', npc: 'veil_skerry', veil: true, name: 'Skerry', title: 'Veil Smuggler', zone: 'coast', team: [['squeakwing', 11], ['clacker', 12], ['glubbernaut', 13]], intro: 'That lens? Salvage. Finders keepers — says so in the smuggler’s code.', win: 'Take the shiny rock, then. Code also says “run”.', lose: 'Code says losers walk the plank.', reward: { gold: 520, items: { lens_crystal: 1 } } }),
  T({ id: 'veil_morrow', npc: 'veil_morrow', veil: true, name: 'Morrow', title: 'Veil Lamplighter', zone: 'marsh', team: [['bonelet', 16], ['wisp', 16], ['mirecroak', 17]], intro: 'I put the lanterns out so the fog can rest. Is that so cruel?', win: 'Light them, then. See who comes home to them.', lose: 'Hush now. Let the names sleep.', reward: { gold: 640, orbs: { dusk: 3 } } }),
  T({ id: 'veil_cinder', npc: 'veil_cinder', veil: true, name: 'Cinder', title: 'Veil Forgehand', zone: 'scar', team: [['impling', 16], ['kilnback', 17], ['emberjaw', 17]], intro: 'The Forge makes lanterns now. Lanterns that hold a Guardian’s heart.', win: 'Hot. Too hot. I’m going to go stand in a lake.', lose: 'Into the quench-tank with you.', reward: { gold: 660, items: { forge_brand: 1 } } }),
  T({ id: 'veil_thistle', npc: 'veil_thistle', veil: true, name: 'Thistle', title: 'Veil Pruner', zone: 'elder', team: [['weblin', 20], ['thornet', 21], ['gloomlord', 21]], intro: 'Old trees dream too loudly. A little pruning never hurt anyone.', win: 'The tree is still screaming. Do you hear it? No? Lucky.', lose: 'Snip.', reward: { gold: 780, items: { heartwood_seed: 1 } } }),
  T({ id: 'veil_sirocco', npc: 'veil_sirocco', veil: true, name: 'Sirocco', title: 'Veil Digger', zone: 'dunes', team: [['dustclaw', 20], ['sandclack', 21], ['dunecat', 21]], intro: 'There’s a lantern older than the Crown under all this sand. We just need to dig.', win: 'Keep your oasis. I’ve had enough sand for one life.', lose: 'Buried!', reward: { gold: 800, items: { sun_scarab: 1 } } }),
  T({ id: 'veil_rime', npc: 'veil_rime', veil: true, name: 'Rime', title: 'Veil Climber', zone: 'peaks', team: [['frostpeck', 25], ['shadekin', 25], ['glaciator', 26]], intro: 'The bells called the storm down every year. So we took the clappers. Simple.', win: 'Ring your bells, then. See if anyone answers.', lose: 'Silence suits the mountain.', reward: { gold: 940, items: { bell_clapper: 1 } } }),
  T({ id: 'veil_facet', npc: 'veil_facet', veil: true, name: 'Facet', title: 'Veil Prospector', zone: 'hollows', team: [['cogling', 25], ['gearbrute', 26], ['frostwisp', 26]], intro: 'Every crystal here holds a little Guardian light. We only need a crown’s worth.', win: 'The vein’s yours. It hums at me in my sleep anyway.', lose: 'Cut and polished.', reward: { gold: 980, items: { tuning_shard: 1 } } }),
  T({ id: 'magister_vesper', npc: 'magister_vesper', veil: true, name: 'Vesper', title: 'Magister of the Hollow Veil', zone: 'summit', team: [['gloomlord', 32], ['umbrajelly', 33], ['hexbones', 33], ['aurorhart', 34]], intro: 'Nine lanterns. Nine hearts. Enough light to cage the storm forever. Step aside.', win: 'Then… it keeps raging. And someone else loses a sister to it.', lose: 'Sleep. When you wake, the sky will be quiet.', reward: { gold: 2000, aether: 400 } }),
];

export const tamerById = (id: string) => TAMERS.find((t) => t.id === id) ?? STORY_TAMERS.find((t) => t.id === id);

// ── Kai, the rival ───────────────────────────────────────────────────────────
/** The starter that beats yours: Fire > Nature > Water > Fire. */
export const COUNTER_PICK: Record<string, string> = { emberling: 'finnik', finnik: 'sporelet', sporelet: 'emberling' };

/** Kai's pick for a player whose starter line includes `species` (works after evolution). */
export function rivalFor(species: string): string {
  const line = (s: string) => {
    const out = [s];
    let id = s;
    for (let i = 0; i < 6; i++) {
      const next = SPECIES[id]?.evolves.find((e) => SPECIES[e.id]);
      if (!next) break;
      id = next.id;
      out.push(id);
    }
    return out;
  };
  for (const starter of Object.keys(COUNTER_PICK)) if (line(starter).includes(species)) return COUNTER_PICK[starter];
  return 'finnik';
}

/** Follow a species' level evolutions up to `level`. */
export function evolvedAt(species: string, level: number): string {
  let id = species;
  for (let guard = 0; guard < 6; guard++) {
    const next = SPECIES[id]?.evolves.find((e) => e.level && !e.item && !e.time && e.level <= level && SPECIES[e.id]);
    if (!next) break;
    id = next.id;
  }
  return id;
}

/** Team strength when a Kai battle doesn't name a stage: grows with how often you've met. */
export const KAI_ARC_STAGE = (battles: number) => Math.max(0, Math.min(6, Math.round(battles * 0.7)));

/** Kai's party per rivalry stage (0 = prologue … 7 = post-game rematch). */
export function kaiTeam(stage: number, rivalStarter: string): [string, number][] {
  const ace = (lv: number): [string, number] => [evolvedAt(rivalStarter, lv), lv];
  const rows: [string, number][][] = [
    [ace(4)],
    [ace(8), ['pecklet', 7]],
    [ace(13), ['voltcat', 12], ['alpuff', 12]],
    [ace(18), ['gloomlord', 17], ['alpaqueen', 17]],
    [ace(23), ['glenhart', 22], ['warlord', 22]],
    [ace(28), ['xenobolt', 27], ['glaciator', 27], ['glenhart', 27]],
    [ace(34), ['xenobolt', 32], ['glaciator', 32], ['aurorhart', 33]],
    [ace(42), ['arcannon', 40], ['blizzarf', 40], ['aurorhart', 41]],
  ];
  const row = rows[Math.max(0, Math.min(rows.length - 1, stage))];
  return row.map(([sp, lv]) => [SPECIES[sp] ? sp : 'gloop', lv]);
}
