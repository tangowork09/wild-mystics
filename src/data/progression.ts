// Rewards, achievements, the daily-login calendar and Wayfarer rank.
// Quests (story, side, bounties, dailies) live in src/data/quests.ts.
import type { ItemId, OrbId } from './items';

export interface Reward { gold?: number; aether?: number; tickets?: number; essence?: number; rankXp?: number; items?: Partial<Record<ItemId, number>>; orbs?: Partial<Record<OrbId, number>>; relic?: string; materials?: Partial<Record<'wood' | 'stone' | 'ore' | 'crystal' | 'fiber', number>> }

export interface AchievementDef { id: string; title: string; desc: string; stat: string; tiers: number[]; reward: number[] }
export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'a_catch', title: 'Mystic Binder', desc: 'Catch Mystics', stat: 'catches', tiers: [10, 50, 150, 400], reward: [150, 300, 600, 1200] },
  { id: 'a_shiny', title: 'Shimmer Seeker', desc: 'Catch shiny Mystics', stat: 'shinies', tiers: [1, 5, 15], reward: [400, 800, 1600] },
  { id: 'a_dex', title: 'Mysticologist', desc: 'Species registered', stat: 'dex', tiers: [20, 50, 80, 110], reward: [200, 500, 900, 2000] },
  { id: 'a_battles', title: 'Battle-Hardened', desc: 'Win battles', stat: 'wins', tiers: [25, 100, 400, 1000], reward: [150, 300, 600, 1200] },
  { id: 'a_perfect', title: 'Metronome', desc: 'Perfect hits', stat: 'perfects', tiers: [50, 250, 1000], reward: [150, 400, 900] },
  { id: 'a_parry', title: 'Untouchable', desc: 'Parries', stat: 'parries', tiers: [50, 250, 1000], reward: [150, 400, 900] },
  { id: 'a_bosses', title: 'Guardian Friend', desc: 'Guardians answered', stat: 'bosses', tiers: [1, 5, 10], reward: [300, 900, 2500] },
  { id: 'a_steps', title: 'Long Road', desc: 'Kilometres travelled', stat: 'km', tiers: [5, 25, 100], reward: [150, 400, 900] },
  { id: 'a_summon', title: 'Starcaller', desc: 'Summons performed', stat: 'pulls', tiers: [10, 50, 200], reward: [150, 400, 900] },
  { id: 'a_hatch', title: 'Nest Keeper', desc: 'Eggs hatched', stat: 'hatches', tiers: [3, 15, 50], reward: [150, 400, 900] },
  { id: 'a_evolve', title: 'Metamorphosis', desc: 'Evolutions', stat: 'evolves', tiers: [3, 15, 40], reward: [150, 400, 900] },
  { id: 'a_build', title: 'Master Builder', desc: 'Structures built', stat: 'builds', tiers: [3, 10, 25], reward: [150, 400, 900] },
  { id: 'a_tamer', title: 'Rival of Many', desc: 'Tamers defeated', stat: 'tamers', tiers: [5, 20, 60], reward: [200, 500, 1000] },
  { id: 'a_rank', title: 'Legend in the Making', desc: 'Wayfarer rank', stat: 'rank', tiers: [5, 15, 30], reward: [200, 600, 1500] },
  // v3: exploring the island
  { id: 'a_regions', title: 'Cartographer', desc: 'Lands visited', stat: 'regions', tiers: [3, 6, 10], reward: [200, 500, 1200] },
  { id: 'a_charted', title: 'Fog Lifter', desc: 'Percent of the map charted', stat: 'charted', tiers: [10, 35, 70], reward: [200, 500, 1200] },
  { id: 'a_side', title: 'Good Neighbour', desc: 'Side quests finished', stat: 'sidequests', tiers: [5, 15, 30], reward: [200, 500, 1200] },
  { id: 'a_bounty', title: 'Alpha Hunter', desc: 'Bounties completed', stat: 'bounties', tiers: [1, 5, 10], reward: [250, 700, 1600] },
  { id: 'a_dungeon', title: 'Delver', desc: 'Dungeons cleared', stat: 'dungeons', tiers: [1, 5, 11], reward: [250, 700, 1600] },
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
