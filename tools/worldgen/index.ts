// Wild Mystics world generator.   npx tsx tools/worldgen/index.ts [--stage macro|erode|sculpt|full]
// Deterministic and seeded: bakes the designed 2048 m island into public/world/.

import path from 'node:path';
import { Grid, resample, blur } from './grid';
import { buildMacro, landBlend } from './shape';
import { erode } from './erosion';
import { previewHeight, previewWithOverlay } from './io';
import { SEA, buildPads, type Pad } from './design';
import { sampleLine } from './carve';
import { armParams } from './shape';
import { addDetail, enforceWalls, carveFeatures, addLandforms, groupPads, padLevel, flattenGroup, rockFace, cutPasses } from './carve';
import { carveLakes, planRivers, carveRivers, findFalls, waterField, WK, type RiverGeom } from './hydro';
import { buildRoads, carveRoads, rasterRoads } from './roads';
import { buildFields, FN } from './fields';
import { audit, tracePath } from './audit';
import { encodeHeight, decodeHeight, encodeFields, encodeWater, writeWorld } from './export';
import { riversOut } from './hydro';
import { downsample } from './grid';
import { ISLETS } from './shape';
import { paintMap } from './paint';
import { WORLD_FORMAT, HEIGHT_RES, FIELD_RES, HQ_MIN, HQ_STEP, FIELD_PLANES, SPLAT_LAYERS, layoutHash, layoutParts, type WorldMeta } from '../../src/world/terrainFormat';
import fs from 'node:fs';
import { ZONES } from './design';
const ZONES_BY: Record<string, [number, number]> = Object.fromEntries(ZONES.map((z) => [z.id, z.town.pos]));

const args = process.argv.slice(2);
const stage = args.includes('--stage') ? args[args.indexOf('--stage') + 1] : 'full';
const PREVIEW_DIR = process.env.WG_PREVIEW ?? path.resolve('.shots/worldgen');

const T0 = Date.now();
const log = (m: string) => console.log(`[worldgen ${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}`);

const ERODE: Record<string, number> = { peaks: 0.85, hollows: 0.6, elder: 0.6, lakes: 0.45, scar: 0.5, coast: 0.35, vale: 0.3, dunes: 0.06, marsh: 0.04, summit: 1 };

function checkRivers(rivers: RiverGeom[], pads: Pad[]) {
  for (const r of rivers) {
    let worst = 1e9, at: [number, number] = [0, 0];
    for (const [x, z] of r.pts) {
      const L = sampleLine(SPUR_FIELD!, x, z);
      if (L.id < 0) continue;
      const P = armParams(L.id, L.s);
      const clear = Math.abs(L.lat) - (P.Wtop + P.B / P.k + 6);
      if (clear < worst) { worst = clear; at = [x, z]; }
    }
    if (worst < 0) console.warn(`river ${r.def.id} climbs onto spur flank at (${at[0].toFixed(0)},${at[1].toFixed(0)}) by ${(-worst).toFixed(0)} m`);
  }
  for (const r of rivers) for (const p of pads) {
    let best = 1e9;
    for (const [x, z] of r.pts) best = Math.min(best, Math.hypot(x - p.x, z - p.z));
    const need = p.r + 8;
    if (best < need) console.warn(`river ${r.def.id} passes ${best.toFixed(0)} m from ${p.id} (core ${p.r})`);
  }
}

let SPUR_FIELD: import('./lines').LineField | null = null;

export async function generate() {
  log('macro shape @1024²');
  const M = buildMacro(1024);
  SPUR_FIELD = M.spur;
  carveFeatures(M.h);
  await previewHeight(path.join(PREVIEW_DIR, 'macro.png'), M.h, 1024);
  if (stage === 'macro') return;

  log('hydraulic erosion @1024²');
  const n = M.h.n;
  const strength = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const { a, b, wb } = landBlend(M.h.xOf(i), M.h.xOf(j));
      let s = (ERODE[a] ?? 0.4) * (1 - wb) + (ERODE[b] ?? 0.4) * wb;
      if (M.ridge.data[k] > 0.5) s = 1;
      if (M.h.data[k] < SEA + 0.5) s *= 0.2;
      strength[k] = s;
    }
  }
  erode(M.h, strength, { droplets: 900_000, seed: 20260928, floor: SEA - 0.5, erode: 0.35, deposit: 0.25, capacity: 5, maxSteps: 80, radius: 3 });
  await previewHeight(path.join(PREVIEW_DIR, 'eroded.png'), M.h, 1024);
  if (stage === 'erode') return;

  log('upsample → 2048² + detail');
  const H = resample(M.h, 2048);
  const low = resample(M.lowland, 2048);
  const rock = blur(M.ridge, 3);
  addDetail(H, rock);
  addLandforms(H, landBlend);
  log('walls');
  enforceWalls(H, M.spur, low);
  const afterWalls = H.clone();
  log('lakes & rivers');
  const lakes = carveLakes(H);
  const rivers = planRivers(H, lakes);
  log('pads');
  const pads = buildPads();
  const padLevels = new Map<string, number>();
  let water = waterField(H, lakes, rivers);
  checkRivers(rivers, pads);
  const wAt = (x: number, z: number) => { const i = Math.round((x + 1024) / 2), j = Math.round((z + 1024) / 2); const k = j * 1024 + i; return water.kind[k] && water.kind[k] !== WK.ocean ? water.surf.data[k] : null; };
  for (const g of groupPads(pads)) {
    const lv = padLevel(H, g, wAt);
    flattenGroup(H, g, lv);
    for (const p of g) { padLevels.set(p.id, lv); rockFace(H, p, lv); }
  }
  carveRivers(H, rivers);
  const falls = findFalls(H, rivers);
  log('gate passes');
  const passes = cutPasses(H, M.spur);
  water = waterField(H, lakes, rivers);
  log('roads');
  const roads = buildRoads(H, water, pads, passes, padLevels);
  carveRoads(H, roads);
  for (const g of groupPads(pads)) flattenGroup(H, g.map((p) => ({ ...p, blend: 4 })), padLevels.get(g[0].id)!);
  water = waterField(H, lakes, rivers);

  const wv = water.surf.clone().map((v, _x, _z, k) => (water.kind[k] ? v : -99));
  await previewWithOverlay(path.join(PREVIEW_DIR, 'sculpt.png'), H, 2048, wv, (o) => {
    for (const r of roads) o.line(r.pts, r.width * 0.9, r.kind === 'ring' ? [150, 90, 40] : [190, 140, 80], 1);
    for (const f of falls) o.disc(f.x, f.z, 6, [255, 255, 255]);
    for (const p of pads as Pad[]) o.ring(p.x, p.z, p.r, [255, 60, 60]);
  });
  log(`roads ${roads.length}, lakes ${lakes.length}, rivers ${rivers.length}, falls ${falls.length}`);
  if (stage === 'sculpt') return { H, M, lakes, rivers, falls, pads, padLevels, passes, roads, water, low, afterWalls };

  log('fields');
  const roadR = rasterRoads(roads, FN);
  const F = buildFields(H, M.spur, M.ridge, water, roadR, pads, padLevels);
  log('audit');
  const hs = downsample(H, FN);
  const rep = audit({ h: hs.data, slope: F.slope, region: F.region, waterSurf: water.surf.data, waterKind: water.kind, pads });
  for (const l of rep.lines) log('  ' + l);
  if (process.env.WG_TRACE) {
    const [fa, fb] = process.env.WG_TRACE.split(':');
    const za = ZONES_BY[fa], zb = ZONES_BY[fb];
    const tp = tracePath({ h: hs.data, slope: F.slope, region: F.region, waterSurf: water.surf.data, waterKind: water.kind, pads }, za, zb);
    for (const l of tp) log('    ' + l);
    if (process.env.WG_CROP) {
      const [cx, cz] = process.env.WG_CROP.split(',').map(Number);
      const marks = tp.map((l) => l.match(/\((-?\d+),(-?\d+)\)/)).filter(Boolean).map((m) => [Number(m![1]), Number(m![2])] as [number, number]);
      const { slopeCrop } = await import('./debugview');
      await slopeCrop(path.join(PREVIEW_DIR, `crop_${cx}_${cz}.png`), H, F.slope, cx, cz, 128, 4, marks);
    }
  }
  if (rep.trapSpots.length) log('  trap samples: ' + rep.trapSpots.slice(0, 12).map(([x, z]) => `(${x},${z})`).join(' '));

  log('export');
  const OUT = path.resolve('public/world');
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const meta: WorldMeta = {
    format: WORLD_FORMAT, seed: 20260928, world: 2048, heightRes: HEIGHT_RES, fieldRes: FIELD_RES,
    hq: { min: HQ_MIN, step: HQ_STEP }, seaLevel: SEA,
    planes: [...FIELD_PLANES], splat: [...SPLAT_LAYERS],
    files: { height: 'height.bin.gz', fields: 'fields.bin.gz', water: 'water.bin.gz', map: 'map.webp' },
    layoutHash: layoutHash(layoutParts()),
    lakes: lakes.map((l) => ({ ...l, kind: l.kind as WorldMeta['lakes'][number]['kind'], level: r2(l.level) })),
    rivers: riversOut(rivers),
    falls: falls.map((f) => ({ ...f, x: r2(f.x), z: r2(f.z), top: r2(f.top), bottom: r2(f.bottom), dx: r2(f.dx), dz: r2(f.dz), width: r2(f.width) })),
    roads: roads.map((r) => ({
      id: r.id, kind: r.kind, from: r.from, to: r.to, width: r.width, cobble: !!r.cobble,
      pts: r.pts.map((p, i) => [r2(p[0]), r2(r.y[i]), r2(p[1])] as [number, number, number]).filter((_, i, a) => i % 2 === 0 || i === a.length - 1),
      fords: (r.fords ?? []).map((i) => [r2(r.pts[i][0]), r2(r.pts[i][1])] as [number, number]),
    })),
    pads: pads.map((p) => ({ id: p.id, kind: p.kind, x: p.x, z: p.z, r: p.r, level: r2(padLevels.get(p.id) ?? 0), plaza: p.plaza, face: p.face, region: p.region })),
    gates: passes.map((g) => ({ id: g.id, x: g.x, z: g.z, tx: r2(g.tx), tz: r2(g.tz), halfLen: r2(g.halfLen), halfW: g.halfW, level: r2(H.sample(g.x, g.z)) })),
    islets: ISLETS.map((i) => ({ id: i.id, x: i.x, z: i.z, r: i.r })),
    stats: { audit: rep.ok ? 'ok' : 'FAIL', traps: rep.traps, roads: roads.length },
  };
  const hb = encodeHeight(H.data);
  const dec = decodeHeight(hb);
  let maxErr = 0;
  for (let k = 0; k < dec.length; k++) maxErr = Math.max(maxErr, Math.abs(dec[k] - H.data[k]));
  log(`height round-trip max error ${(maxErr * 1000).toFixed(2)} mm`);
  const planes: Record<string, Float32Array | Uint8Array> = {
    region: F.region, grass: F.grass, tall: F.tall, forest: F.forest, path: F.path, cobble: F.cobble, plaza: F.plaza,
    lava: F.lava, waterKind: water.kind, macro: F.macro, accent: F.accent, ao: F.ao, wet: F.wet,
  };
  const sizes = writeWorld(OUT, meta, hb, encodeFields(planes, F.splat), encodeWater(water.surf.data, water.kind));
  log('painting map');
  sizes.map = await paintMap(path.join(OUT, 'map.webp'), { H, F, water, roads, rivers, lakes, pads });
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  log(`sizes: ${Object.entries(sizes).map(([k, v]) => `${k} ${(v / 1e6).toFixed(2)} MB`).join(', ')} — total ${(total / 1e6).toFixed(2)} MB`);
  fs.writeFileSync(path.join(PREVIEW_DIR, 'audit.txt'), rep.lines.join('\n'));
  if (!rep.ok) log('AUDIT FAILED: ' + JSON.stringify({ leaks: rep.leaks, unreachable: rep.unreachable }));
  return { H, M, lakes, rivers, falls, pads, padLevels, passes, roads, water, F, rep };
}

if (process.argv[1]?.endsWith('index.ts')) generate().then(() => log('done')).catch((e) => { console.error(e); process.exit(1); });

export type { Grid };
