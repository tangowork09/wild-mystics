// Homestead catalogue. Production is per real hour and stockpiles up to 8 hours.
import type { MaterialId } from './items';

export type StructureCategory = 'production' | 'mystics' | 'crafting' | 'decor';
export interface StructureDef {
  id: string;
  name: string;
  category: StructureCategory;
  desc: string;
  cost: Partial<Record<MaterialId | 'gold', number>>;
  radius: number;           // footprint for placement checks (m)
  model: string;            // manifest.buildings key (procedural fallback exists)
  height: number;
  max: number;              // how many you may build
  produces?: Partial<Record<MaterialId | 'gold' | 'aether', number>>; // per hour at level 1
  slots?: number;           // habitat: Mystics that can live here (per level)
  upgradeMult: number;      // cost multiplier per level
  maxLevel: number;
  rankReq?: number;
}

export const STRUCTURES: StructureDef[] = [
  { id: 'habitat', name: 'Mystic Habitat', category: 'mystics', desc: 'Stored Mystics live here, roam your homestead and earn XP over time.', cost: { wood: 40, stone: 20, gold: 200 }, radius: 4, model: 'base_habitat', height: 6.5, max: 4, slots: 2, upgradeMult: 1.8, maxLevel: 3 },
  { id: 'lumber_mill', name: 'Lumber Mill', category: 'production', desc: 'Produces Timber.', cost: { wood: 20, stone: 30, gold: 150 }, radius: 4, model: 'base_lumbermill', height: 6.5, max: 2, produces: { wood: 14 }, upgradeMult: 1.7, maxLevel: 3 },
  { id: 'quarry', name: 'Quarry', category: 'production', desc: 'Produces Stone and Ore.', cost: { wood: 40, stone: 10, gold: 200 }, radius: 4, model: 'base_mine', height: 6, max: 2, produces: { stone: 12, ore: 3 }, upgradeMult: 1.7, maxLevel: 3 },
  { id: 'crystal_spire', name: 'Crystal Spire', category: 'production', desc: 'Condenses Crystal and a trickle of Aether.', cost: { stone: 60, ore: 20, gold: 600 }, radius: 2.5, model: 'base_crystal', height: 7, max: 1, produces: { crystal: 3, aether: 6 }, upgradeMult: 2, maxLevel: 3, rankReq: 5 },
  { id: 'garden', name: 'Herb Garden', category: 'production', desc: 'Grows Fiber.', cost: { wood: 20, fiber: 10, gold: 80 }, radius: 3, model: 'base_garden', height: 1.2, max: 3, produces: { fiber: 12 }, upgradeMult: 1.6, maxLevel: 3 },
  { id: 'windmill', name: 'Windmill', category: 'production', desc: 'Mills grain into Gold.', cost: { wood: 60, stone: 40, gold: 300 }, radius: 4, model: 'base_windmill', height: 11, max: 1, produces: { gold: 60 }, upgradeMult: 1.8, maxLevel: 3 },
  { id: 'forge', name: 'Relic Forge', category: 'crafting', desc: 'Craft orbs and upgrade relics with materials.', cost: { stone: 60, ore: 20, gold: 400 }, radius: 4, model: 'base_forge', height: 6.5, max: 1, upgradeMult: 2, maxLevel: 1 },
  { id: 'training_hall', name: 'Training Hall', category: 'mystics', desc: 'Spend Gold to train Mystics instantly.', cost: { wood: 50, stone: 50, gold: 500 }, radius: 4, model: 'base_training', height: 6, max: 1, upgradeMult: 2, maxLevel: 1, rankReq: 3 },
  { id: 'healing_well', name: 'Healing Well', category: 'mystics', desc: 'Rest here to heal your whole team.', cost: { stone: 30, gold: 120 }, radius: 2, model: 'well', height: 3.2, max: 1, upgradeMult: 1, maxLevel: 1 },
  { id: 'watchtower', name: 'Watchtower', category: 'crafting', desc: 'Reveals wild Mystics much farther on your minimap.', cost: { wood: 80, stone: 40, gold: 350 }, radius: 3, model: 'tower', height: 11, max: 1, upgradeMult: 1, maxLevel: 1, rankReq: 4 },
  { id: 'market', name: 'Trading Post', category: 'crafting', desc: 'Sell surplus materials for Gold.', cost: { wood: 40, stone: 30, gold: 250 }, radius: 3.5, model: 'shop', height: 6.5, max: 1, upgradeMult: 1, maxLevel: 1 },
  { id: 'lamp', name: 'Lantern Post', category: 'decor', desc: 'Warm light for dark nights.', cost: { wood: 4, ore: 1 }, radius: 0.6, model: 'lamp', height: 3.5, max: 20, upgradeMult: 1, maxLevel: 1 },
  { id: 'fence', name: 'Fence', category: 'decor', desc: 'A wooden fence segment.', cost: { wood: 3 }, radius: 1, model: 'fence', height: 1.1, max: 40, upgradeMult: 1, maxLevel: 1 },
  { id: 'banner', name: 'Banner', category: 'decor', desc: 'Show your colours.', cost: { wood: 4, fiber: 4 }, radius: 0.6, model: 'flag', height: 3.2, max: 10, upgradeMult: 1, maxLevel: 1 },
  { id: 'barrels', name: 'Barrel Stack', category: 'decor', desc: 'Very important barrels.', cost: { wood: 6 }, radius: 0.9, model: 'barrel', height: 1, max: 12, upgradeMult: 1, maxLevel: 1 },
  { id: 'statue', name: 'Mystic Statue', category: 'decor', desc: 'A statue of your lead Mystic.', cost: { stone: 40, gold: 300 }, radius: 1.2, model: 'statue', height: 3, max: 3, upgradeMult: 1, maxLevel: 1 },
];

export const structureDef = (id: string) => STRUCTURES.find((s) => s.id === id)!;
export const PRODUCTION_CAP_HOURS = 8;
