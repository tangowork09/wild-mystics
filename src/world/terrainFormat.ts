// Baked-world file format shared by tools/worldgen (writer) and src/world/terrain.ts (reader).
// public/world/:
//   world.json      metadata, water bodies, rivers, falls, roads, pads, gates
//   height.bin.gz   HEIGHT_RES² uint16 heights: planar-predicted residuals, zigzag, split into a low-byte
//                   plane then a high-byte plane (gzip loves the near-empty high plane)
//   fields.bin.gz   FIELD_RES² uint8 planes, in FIELD_PLANES order, then the SPLAT_LAYERS planes
//   water.bin.gz    FIELD_RES² uint16 water-surface heights (same quantisation; 0 = no water), low plane + high plane
//   map.webp        painterly atlas page (no labels), 2048², north up

import { ZONES, HOMESTEAD, START_POS } from '../data/zones';
import { ISLAND, SPURS, GATES, DUNGEONS, POIS } from '../data/layout';

export const WORLD_FORMAT = 1;
export const HEIGHT_RES = 2048;
export const FIELD_RES = 1024;
/** Height quantisation: h = HQ_MIN + q * HQ_STEP (5 mm). */
export const HQ_MIN = -64;
export const HQ_STEP = 0.005;

export const FIELD_PLANES = ['region', 'grass', 'tall', 'forest', 'path', 'cobble', 'plaza', 'lava', 'waterKind', 'macro', 'accent', 'ao', 'wet'] as const;
export type FieldPlane = typeof FIELD_PLANES[number];
export const SPLAT_LAYERS = ['grass', 'drygrass', 'forest', 'dirt', 'cobble', 'rock', 'sand', 'snow', 'ash', 'mud'] as const;
export type SplatLayer = typeof SPLAT_LAYERS[number];

/** Water kinds stored in the waterKind plane. */
export const WATER_KIND = { none: 0, ocean: 1, lake: 2, river: 3, lava: 4, marsh: 5, frozen: 6, oasis: 7 } as const;
export type WaterKindName = keyof typeof WATER_KIND;

export interface WorldLake { id: string; name: string; kind: 'lake' | 'pool' | 'frozen' | 'lava' | 'oasis' | 'marsh'; level: number; x: number; z: number; rx: number; rz: number; rot: number; region: string }
/** River course: [x, surfaceY, z, width] every ~4 m, source → mouth. */
export interface WorldRiver { id: string; name: string; region: string; lava: boolean; pts: [number, number, number, number][] }
export interface WorldFall { id: string; river: string; x: number; z: number; top: number; bottom: number; dx: number; dz: number; width: number }
export type RoadKind = 'ring' | 'road' | 'trail' | 'switchback';
/** Road spline: [x, y, z] every ~4 m (y = the carved road surface). */
export interface WorldRoad { id: string; kind: RoadKind; from: string; to: string; width: number; cobble: boolean; pts: [number, number, number][]; fords: [number, number][] }
export interface WorldPad { id: string; kind: string; x: number; z: number; r: number; level: number; plaza?: number; face?: number; region: string }
export interface WorldGate { id: string; x: number; z: number; tx: number; tz: number; halfLen: number; halfW: number; level: number }

export interface WorldMeta {
  format: number;
  seed: number;
  world: number;
  heightRes: number;
  fieldRes: number;
  hq: { min: number; step: number };
  seaLevel: number;
  planes: string[];
  splat: string[];
  files: { height: string; fields: string; water: string; map: string };
  layoutHash: string;
  lakes: WorldLake[];
  rivers: WorldRiver[];
  falls: WorldFall[];
  roads: WorldRoad[];
  pads: WorldPad[];
  gates: WorldGate[];
  islets: { id: string; x: number; z: number; r: number }[];
  stats: Record<string, number | string>;
}

/** Stable hash of every layout position the bake depends on (stale-bake detection). */
export function layoutHash(parts: unknown): string {
  const s = JSON.stringify(parts);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}


/** The layout inputs the bake depends on (hash them to detect a stale bake). */
export function layoutParts() {
  return {
    z: ZONES.map((z) => [z.id, z.town.pos, z.town.kind, z.camp, z.boss.pos]),
    g: GATES.map((g) => [g.id, g.pos]),
    d: DUNGEONS.map((d) => [d.id, d.entrance, d.theme]),
    p: POIS.map((p) => [p.id, p.pos, p.kind]),
    h: [HOMESTEAD.center, HOMESTEAD.radius],
    s: START_POS,
    i: [ISLAND.mountain.center, ISLAND.mountain.summitHeight, ISLAND.mountain.plateauRadius],
    sp: SPURS.map((s) => s.bearing),
  };
}
