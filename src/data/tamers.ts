// Wandering Tamers: Pokémon-style trainer battles. Rematch once per day for smaller rewards.
import type { Reward } from './progression';

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
  // Ember Scar
  T({ id: 't_brand', name: 'Brand', title: 'Ash Walker', zone: 'scar', team: [['impling', 10], ['grunt', 11], ['cinderquid', 11]], intro: 'Your boots will melt before my team does.', win: 'Alright, alright. Cool it.', lose: 'Too hot for you!', reward: { gold: 440, orbs: { ember: 2 } } }),
  T({ id: 't_calla', name: 'Calla', title: 'Obsidian Sculptor', zone: 'scar', team: [['emberjaw', 12], ['magmaglub', 12], ['ashwing', 12]], intro: 'I carve Mystics from cooled lava. Well — I carve their battle plans.', win: 'A masterpiece. Yours, sadly.', lose: 'Unrefined.', reward: { gold: 480, items: { fire_stone: 1 } } }),
  T({ id: 't_gorran', name: 'Gorran', title: 'Forge Veteran', zone: 'scar', team: [['warlord', 14], ['hellion', 14], ['magmallow', 14]], intro: 'I’ve hammered steel for forty years. Let’s see your temper.', win: 'Well-tempered, Wayfarer.', lose: 'Back to the anvil with you.', reward: { gold: 560, relic: 'warrior_band' } }),
  // Mistveil Marsh
  T({ id: 't_wren', name: 'Wren', title: 'Lantern Keeper', zone: 'marsh', team: [['mirecroak', 15], ['glowcap', 15], ['wisp', 16]], intro: 'Stay in the lantern light. Or battle me in the dark.', win: 'The lanterns burn brighter for you.', lose: 'The fog wins again.', reward: { gold: 600, orbs: { dusk: 3 } } }),
  T({ id: 't_hollis', name: 'Hollis', title: 'Bog Hermit', zone: 'marsh', team: [['spikegloop', 16], ['gloomling', 16], ['mycobloom', 17]], intro: 'Visitors. Hmph. Fine. One battle, then leave.', win: '…Stay for tea, then.', lose: 'Leave. Now.', reward: { gold: 640, items: { cleanse: 3 } } }),
  T({ id: 't_morgana', name: 'Morgana', title: 'Veil Witch', zone: 'marsh', team: [['gloomlord', 18], ['umbrajelly', 18], ['moonhop', 18]], intro: 'The fog told me your name before you arrived.', win: 'The fog was wrong about you.', lose: 'As foretold.', reward: { gold: 720, relic: 'venom_ring' } }),
  // Sunscorch Dunes
  T({ id: 't_sahir', name: 'Sahir', title: 'Caravan Scout', zone: 'dunes', team: [['sandgloop', 15], ['dunecat', 16], ['sunbee', 16]], intro: 'Water’s scarce. Battles aren’t.', win: 'Take some water. You earned it.', lose: 'The desert humbles everyone.', reward: { gold: 620, items: { thunder_stone: 1 } } }),
  T({ id: 't_zarya', name: 'Zarya', title: 'Dune Racer', zone: 'dunes', team: [['dustwhirl', 17], ['zorp', 17], ['voltcat', 18]], intro: 'Try to keep up!', win: 'You’re faster than the sandstorm!', lose: 'Eat my dust!', reward: { gold: 660, relic: 'swift_boots' } }),
  T({ id: 't_khalid', name: 'Khalid', title: 'Tomb Warden', zone: 'dunes', team: [['saguardian', 19], ['warlord', 19], ['xenobolt', 19]], intro: 'The Colossus sleeps. You will not wake it while I stand.', win: 'Then go. Wake the giant.', lose: 'Rest here, beneath the sand.', reward: { gold: 760, aether: 90 } }),
  // Stormreach Peaks
  T({ id: 't_ingrid', name: 'Ingrid', title: 'Summit Guide', zone: 'peaks', team: [['frostpeck', 20], ['frostling', 21], ['zapbee', 21]], intro: 'Thin air, thick skulls. Let’s test yours.', win: 'You’ll make the summit.', lose: 'Turn back while you can.', reward: { gold: 760, items: { wind_stone: 1 } } }),
  T({ id: 't_tesla', name: 'Tessaly', title: 'Storm Chaser', zone: 'peaks', team: [['voltarmor', 22], ['sparkmage', 22], ['zapjelly', 23]], intro: 'I bottle lightning. Want to see?', win: 'Shocking. Genuinely.', lose: 'Grounded!', reward: { gold: 820, relic: 'storm_feather' } }),
  T({ id: 't_ansel', name: 'Ansel', title: 'Crystal Sage', zone: 'peaks', team: [['glaciator', 24], ['shinobi', 24], ['frostwisp', 24], ['xenobolt', 25]], intro: 'The Stormcrown watches every battle on this mountain. Make it a good one.', win: 'It watched. It approves.', lose: 'Not yet, Wayfarer. Not yet.', reward: { gold: 900, aether: 150, relic: 'aegis_locket' } }),
];
