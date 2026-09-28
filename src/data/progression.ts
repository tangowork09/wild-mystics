// Quests (story, side, daily), achievements, daily-login calendar and rank rewards.
import type { GameEvents } from '../game/events';
import type { ItemId, OrbId } from './items';

export interface Reward { gold?: number; aether?: number; tickets?: number; essence?: number; rankXp?: number; items?: Partial<Record<ItemId, number>>; orbs?: Partial<Record<OrbId, number>>; relic?: string; materials?: Partial<Record<'wood' | 'stone' | 'ore' | 'crystal' | 'fiber', number>> }

/** A counter that advances when an event matches. */
export interface Objective<K extends keyof GameEvents = keyof GameEvents> { event: K; count: number; match?: (e: GameEvents[K]) => boolean }

export interface QuestDef {
  id: string;
  kind: 'story' | 'side' | 'daily';
  title: string;
  desc: string;
  giver?: string;          // town board where it's posted (side quests)
  requires?: string;       // previous quest id
  objective: Objective;
  reward: Reward;
}

const Q = <K extends keyof GameEvents>(q: Omit<QuestDef, 'objective'> & { objective: Objective<K> }) => q as unknown as QuestDef;

export const QUESTS: QuestDef[] = [
  // ── Main story: The Six Guardians ─────────────────────────────────────────
  Q({ id: 'story_1', kind: 'story', title: 'First Bond', desc: 'Catch your first wild Mystic.', objective: { event: 'catch', count: 1 }, reward: { aether: 160, orbs: { mystic: 5 }, rankXp: 60 } }),
  Q({ id: 'story_2', kind: 'story', requires: 'story_1', title: 'Tall Grass Tales', desc: 'Win 3 battles in Verdant Vale.', objective: { event: 'battle_win', count: 3, match: (e) => e.zone === 'vale' }, reward: { gold: 300, items: { tonic: 3 }, rankXp: 80 } }),
  Q({ id: 'story_3', kind: 'story', requires: 'story_2', title: 'The Old Grove', desc: 'Defeat Thornjaw Rex, Guardian of the Vale.', objective: { event: 'boss_win', count: 1, match: (e) => e.zone === 'vale' }, reward: { aether: 400, relic: 'heart_of_oak', rankXp: 250 } }),
  Q({ id: 'story_4', kind: 'story', requires: 'story_3', title: 'Still Waters', desc: 'Defeat the Abyssal Tyrant in Mirror Lakes.', objective: { event: 'boss_win', count: 1, match: (e) => e.zone === 'lakes' }, reward: { aether: 500, relic: 'tide_pearl', rankXp: 300 } }),
  Q({ id: 'story_5', kind: 'story', requires: 'story_4', title: 'Ash and Embers', desc: 'Defeat the Ashen Totem in Ember Scar.', objective: { event: 'boss_win', count: 1, match: (e) => e.zone === 'scar' }, reward: { aether: 500, relic: 'ember_charm', rankXp: 300 } }),
  Q({ id: 'story_6', kind: 'story', requires: 'story_5', title: 'Beyond the Fog', desc: 'Defeat the Bog Sovereign in Mistveil Marsh.', objective: { event: 'boss_win', count: 1, match: (e) => e.zone === 'marsh' }, reward: { aether: 600, relic: 'dream_lantern', rankXp: 400 } }),
  Q({ id: 'story_7', kind: 'story', requires: 'story_6', title: 'Sands of Time', desc: 'Defeat the Sandjaw Colossus in Sunscorch Dunes.', objective: { event: 'boss_win', count: 1, match: (e) => e.zone === 'dunes' }, reward: { aether: 600, relic: 'hourglass', rankXp: 400 } }),
  Q({ id: 'story_8', kind: 'story', requires: 'story_7', title: 'The Crowned Storm', desc: 'Climb Stormreach and defeat the Stormcrown.', objective: { event: 'boss_win', count: 1, match: (e) => e.zone === 'peaks' }, reward: { aether: 1200, tickets: 5, relic: 'crown_of_ages', rankXp: 800 } }),
  Q({ id: 'story_9', kind: 'story', requires: 'story_8', title: 'A Wayfarer’s Legend', desc: 'Register 60 Mystics in the Mysticodex.', objective: { event: 'catch', count: 60 }, reward: { aether: 2000, orbs: { astral: 1 }, rankXp: 1000 } }),

  // ── Side quests (town boards) ─────────────────────────────────────────────
  Q({ id: 'side_pest', kind: 'side', giver: 'vale', title: 'Pest Control', desc: 'Defeat 6 wild Mystics in the Vale.', objective: { event: 'defeat', count: 6, match: (e) => e.zone === 'vale' }, reward: { gold: 400, items: { tonic: 2 } } }),
  Q({ id: 'side_timber', kind: 'side', giver: 'vale', title: 'Lumberjack', desc: 'Gather 20 Timber.', objective: { event: 'gather', count: 20, match: (e) => e.material === 'wood' }, reward: { gold: 250, materials: { stone: 20 } } }),
  Q({ id: 'side_home', kind: 'side', giver: 'vale', title: 'Homesteader', desc: 'Build 3 structures at your Homestead.', objective: { event: 'build', count: 3 }, reward: { aether: 200, materials: { wood: 30, stone: 30 } } }),
  Q({ id: 'side_eggs', kind: 'side', giver: 'vale', title: 'Egg Hunt', desc: 'Hatch 2 eggs.', objective: { event: 'hatch', count: 2 }, reward: { aether: 160, items: { hatch_charm: 1 } } }),
  Q({ id: 'side_way', kind: 'side', giver: 'vale', title: 'Wayfinder', desc: 'Attune 8 waystones.', objective: { event: 'discover', count: 8 }, reward: { aether: 250, orbs: { radiant: 3 } } }),
  Q({ id: 'side_grass', kind: 'side', giver: 'lakes', title: 'Rustling Reeds', desc: 'Find 8 Mystics hiding in tall grass.', objective: { event: 'grass', count: 8 }, reward: { gold: 500, orbs: { tide: 3 } } }),
  Q({ id: 'side_water', kind: 'side', giver: 'lakes', title: 'Deep Diver', desc: 'Catch 5 Water Mystics.', objective: { event: 'catch', count: 5, match: (e) => e.element === 'water' }, reward: { aether: 220, items: { water_stone: 1 } } }),
  Q({ id: 'side_perfect', kind: 'side', giver: 'lakes', title: 'Perfect Rhythm', desc: 'Land 40 Perfect hits.', objective: { event: 'perfect', count: 40 }, reward: { relic: 'maestro_baton', rankXp: 150 } }),
  Q({ id: 'side_ember', kind: 'side', giver: 'scar', title: 'Ember Walker', desc: 'Win 6 battles in Ember Scar.', objective: { event: 'battle_win', count: 6, match: (e) => e.zone === 'scar' }, reward: { gold: 700, orbs: { ember: 3 } } }),
  Q({ id: 'side_parry', kind: 'side', giver: 'scar', title: 'Iron Wall', desc: 'Parry 30 strikes.', objective: { event: 'parry', count: 30 }, reward: { relic: 'parry_sigil', rankXp: 150 } }),
  Q({ id: 'side_ore', kind: 'side', giver: 'scar', title: 'Deep Veins', desc: 'Gather 15 Ore.', objective: { event: 'gather', count: 15, match: (e) => e.material === 'ore' }, reward: { gold: 600, items: { fire_stone: 1 } } }),
  Q({ id: 'side_tamers', kind: 'side', giver: 'scar', title: "Tamer's Path", desc: 'Defeat 5 wandering Tamers.', objective: { event: 'tamer_win', count: 5 }, reward: { aether: 350, relic: 'duelist_glove' } }),
  Q({ id: 'side_night', kind: 'side', giver: 'marsh', title: 'Night Owl', desc: 'Catch 3 Mystics after dark.', objective: { event: 'catch', count: 3, match: (e) => e.night }, reward: { orbs: { dusk: 5 }, items: { void_stone: 1 } } }),
  Q({ id: 'side_search', kind: 'side', giver: 'marsh', title: 'Glimmer Seeker', desc: 'Search 10 glimmering bushes.', objective: { event: 'search', count: 10 }, reward: { gold: 600, items: { lure_incense: 2 } } }),
  Q({ id: 'side_evolve', kind: 'side', giver: 'dunes', title: 'Evolutionist', desc: 'Evolve 3 Mystics.', objective: { event: 'evolve', count: 3 }, reward: { aether: 300, items: { thunder_stone: 1, leaf_stone: 1 } } }),
  Q({ id: 'side_crystal', kind: 'side', giver: 'dunes', title: 'Shard Hunter', desc: 'Gather 12 Crystal.', objective: { event: 'gather', count: 12, match: (e) => e.material === 'crystal' }, reward: { gold: 800, relic: 'burst_prism' } }),
  Q({ id: 'side_break', kind: 'side', giver: 'dunes', title: 'Shatterpoint', desc: 'Break 15 foes.', objective: { event: 'break', count: 15 }, reward: { relic: 'hammer_totem', rankXp: 150 } }),
  Q({ id: 'side_shiny', kind: 'side', giver: 'peaks', title: 'Shimmering', desc: 'Catch a shiny Mystic.', objective: { event: 'catch', count: 1, match: (e) => e.shiny }, reward: { aether: 800, items: { shimmer_incense: 1 } } }),
  Q({ id: 'side_burst', kind: 'side', giver: 'peaks', title: 'Unleashed', desc: 'Use 5 Burst ultimates.', objective: { event: 'burst', count: 5 }, reward: { aether: 400, relic: 'aether_well' } }),
  Q({ id: 'side_jump', kind: 'side', giver: 'peaks', title: 'Light on Your Feet', desc: 'Jump over 20 shockwaves in battle.', objective: { event: 'jump_dodge', count: 20 }, reward: { relic: 'dancer_anklet', rankXp: 150 } }),
];

export const DAILY_POOL: QuestDef[] = [
  Q({ id: 'd_win', kind: 'daily', title: 'Daily: Victor', desc: 'Win 5 battles.', objective: { event: 'battle_win', count: 5 }, reward: { aether: 60, gold: 200 } }),
  Q({ id: 'd_catch', kind: 'daily', title: 'Daily: Collector', desc: 'Catch 3 Mystics.', objective: { event: 'catch', count: 3 }, reward: { aether: 60, orbs: { mystic: 3 } } }),
  Q({ id: 'd_perfect', kind: 'daily', title: 'Daily: On the Beat', desc: 'Land 12 Perfect hits.', objective: { event: 'perfect', count: 12 }, reward: { aether: 50, gold: 150 } }),
  Q({ id: 'd_parry', kind: 'daily', title: 'Daily: Deflector', desc: 'Parry 8 strikes.', objective: { event: 'parry', count: 8 }, reward: { aether: 50, items: { tonic: 2 } } }),
  Q({ id: 'd_gather', kind: 'daily', title: 'Daily: Forager', desc: 'Gather 15 materials.', objective: { event: 'gather', count: 15 }, reward: { aether: 40, materials: { wood: 15, stone: 15 } } }),
  Q({ id: 'd_grass', kind: 'daily', title: 'Daily: Grass Walker', desc: 'Find 3 Mystics in tall grass.', objective: { event: 'grass', count: 3 }, reward: { aether: 40, gold: 150 } }),
  Q({ id: 'd_search', kind: 'daily', title: 'Daily: Snoop', desc: 'Search 3 glimmering bushes.', objective: { event: 'search', count: 3 }, reward: { aether: 40, items: { ether: 1 } } }),
  Q({ id: 'd_break', kind: 'daily', title: 'Daily: Breaker', desc: 'Break 4 foes.', objective: { event: 'break', count: 4 }, reward: { aether: 50, gold: 200 } }),
  Q({ id: 'd_travel', kind: 'daily', title: 'Daily: Road Runner', desc: 'Travel 1,500 metres on foot.', objective: { event: 'step', count: 1500 }, reward: { aether: 40, gold: 150 } }),
];

export interface AchievementDef { id: string; title: string; desc: string; stat: string; tiers: number[]; reward: number[] }
export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'a_catch', title: 'Mystic Binder', desc: 'Catch Mystics', stat: 'catches', tiers: [10, 50, 150, 400], reward: [150, 300, 600, 1200] },
  { id: 'a_shiny', title: 'Shimmer Seeker', desc: 'Catch shiny Mystics', stat: 'shinies', tiers: [1, 5, 15], reward: [400, 800, 1600] },
  { id: 'a_dex', title: 'Mysticologist', desc: 'Species registered', stat: 'dex', tiers: [20, 50, 80, 110], reward: [200, 500, 900, 2000] },
  { id: 'a_battles', title: 'Battle-Hardened', desc: 'Win battles', stat: 'wins', tiers: [25, 100, 400, 1000], reward: [150, 300, 600, 1200] },
  { id: 'a_perfect', title: 'Metronome', desc: 'Perfect hits', stat: 'perfects', tiers: [50, 250, 1000], reward: [150, 400, 900] },
  { id: 'a_parry', title: 'Untouchable', desc: 'Parries', stat: 'parries', tiers: [50, 250, 1000], reward: [150, 400, 900] },
  { id: 'a_bosses', title: 'Guardian Breaker', desc: 'Guardians defeated', stat: 'bosses', tiers: [1, 3, 6], reward: [300, 700, 1500] },
  { id: 'a_steps', title: 'Long Road', desc: 'Kilometres travelled', stat: 'km', tiers: [5, 25, 100], reward: [150, 400, 900] },
  { id: 'a_summon', title: 'Starcaller', desc: 'Summons performed', stat: 'pulls', tiers: [10, 50, 200], reward: [150, 400, 900] },
  { id: 'a_hatch', title: 'Nest Keeper', desc: 'Eggs hatched', stat: 'hatches', tiers: [3, 15, 50], reward: [150, 400, 900] },
  { id: 'a_evolve', title: 'Metamorphosis', desc: 'Evolutions', stat: 'evolves', tiers: [3, 15, 40], reward: [150, 400, 900] },
  { id: 'a_build', title: 'Master Builder', desc: 'Structures built', stat: 'builds', tiers: [3, 10, 25], reward: [150, 400, 900] },
  { id: 'a_tamer', title: 'Rival of Many', desc: 'Tamers defeated', stat: 'tamers', tiers: [5, 20, 60], reward: [200, 500, 1000] },
  { id: 'a_rank', title: 'Legend in the Making', desc: 'Wayfarer rank', stat: 'rank', tiers: [5, 15, 30], reward: [200, 600, 1500] },
];

/** 7-day login calendar (repeats). */
export const LOGIN_REWARDS: { label: string; reward: Reward }[] = [
  { label: '120 Aether', reward: { aether: 120 } },
  { label: '500 Gold', reward: { gold: 500 } },
  { label: '5 Mystic Orbs', reward: { orbs: { mystic: 5 } } },
  { label: '160 Aether', reward: { aether: 160 } },
  { label: '3 Radiant Orbs', reward: { orbs: { radiant: 3 } } },
  { label: 'Summon Ticket', reward: { tickets: 1 } },
  { label: '400 Aether', reward: { aether: 400, items: { wisdom_scroll: 1 } } },
];

export const rankXpToNext = (level: number) => 120 + level * 70;
export const RANK_TITLES = ['Novice Wayfarer', 'Trail Scout', 'Field Tamer', 'Grove Warden', 'Expedition Lead', 'Mystic Sage', 'Guardian Friend', 'Legend of the Wilds'];
export const rankTitle = (level: number) => RANK_TITLES[Math.min(RANK_TITLES.length - 1, Math.floor((level - 1) / 5))];
