// Shared contracts for towns, landmarks and POIs (v3:towns). `towns.ts` re-exports these, so the
// rest of the game keeps importing them from './world/towns'.
import type * as THREE from 'three';
import type { Zone } from '../../data/zones';

export type Service = 'healer' | 'shop' | 'hatchery' | 'shrine' | 'tutor' | 'storage' | 'summon' | 'quests';

export const SERVICES: Record<Service, { name: string; icon: string; roof: string; desc: string }> = {
  healer: { name: 'Healer', icon: '✚', roof: '#d0506a', desc: 'Restore your whole team' },
  shop: { name: 'Outfitter', icon: '◈', roof: '#3a6ac0', desc: 'Capture orbs & tonics' },
  hatchery: { name: 'Hatchery', icon: '◉', roof: '#e0a830', desc: 'Breed creatures, hatch eggs' },
  shrine: { name: 'Elementum Shrine', icon: '✦', roof: '#8a4ad0', desc: 'Infuse elemental power' },
  tutor: { name: 'Move Master', icon: '⚔', roof: '#c03a2a', desc: 'Enhance skills' },
  storage: { name: 'Keeper', icon: '▣', roof: '#6a5a3a', desc: 'Swap team & storage' },
  summon: { name: 'Wishing Spire', icon: '✧', roof: '#5a4ad0', desc: 'Summon Mystics & relics with Aether' },
  quests: { name: 'Quest Board', icon: '❖', roof: '#a0702a', desc: 'Requests from the townsfolk' },
};

export interface Interactable {
  pos: THREE.Vector3;
  radius: number;
  label: string;
  kind: 'service' | 'camp' | 'boss' | 'search' | 'waystone' | 'gather' | 'tamer' | 'homestead' | 'npc' | 'chest';
  service?: Service;
  zone: Zone;
  id: string;
  enabled: () => boolean;
  /**
   * Extra payload for the handler (tamer id, node type, …). Shop services carry their shop id
   * (`hearthwick_outfitter`, `hearthwick_bakery`, …) so a ShopApi-based UI can open the right one.
   */
  data?: string;
}

/**
 * A named spot in a town for NPCs, cameras and quests. World metres; `yaw` is the facing as a
 * three.js `rotation.y` for a rig that faces +Z (i.e. facing direction = (sin yaw, cos yaw)).
 */
export interface Anchor { x: number; z: number; yaw: number }

/** Walkable deck (pier, boardwalk): oriented rectangle, height ramps from h0 (−len/2) to h1. */
export interface Deck { x: number; z: number; hw: number; hl: number; rot: number; h0: number; h1: number }
