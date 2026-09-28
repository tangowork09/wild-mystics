#!/usr/bin/env node
// v3 towns: imports the town-dressing props (KayKit Medieval Hexagon decoration, Kenney Fantasy Town
// Kit, the CC-BY lighthouse) from .asset-scout/v3/town into public/assets/models/town and registers
// them under manifest.decor as `town_<key>`. Same optimisation as tools/import-assets.mjs (dedup,
// weld, prune, WebP, quantize, meshopt). Re-runnable; only touches `decor.town_*` in the manifest.
//
//   node tools/import-town-kit.mjs            (also run at the end of tools/import-assets.mjs)

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, weld, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SCOUT = process.env.ASSET_SCOUT ?? path.join(ROOT, '.asset-scout');
const SRC = path.join(SCOUT, 'v3/town');
// The Kenney GLBs reference an external Textures/colormap.png that only ships in the pack zip, so
// the Kenney files are read from an extraction of that zip (same scratch convention as import-assets).
const X = process.env.TOWN_KIT_X ?? path.join(SCOUT, '_x', 'kenney-town');
if (!fs.existsSync(path.join(X, 'Models/GLB format/Textures/colormap.png'))) {
  fs.mkdirSync(X, { recursive: true });
  execSync(`unzip -q -o "${path.join(SCOUT, 'buildings/kenney_fantasy-town-kit_2.0.zip')}" 'Models/GLB format/*' -d "${X}"`);
}
const OUT = path.join(ROOT, 'public/assets');
const MANIFEST = path.join(OUT, 'manifest.json');
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const KAY = 'kaykit-hexagon-decoration';
const KEN = 'kenney-fantasy-town-kit';
/** key → [pack, file, target height (m)]. Heights are real-world sizes for a 1.75 m Wayfarer. */
const KIT = {
  barrel: [KAY, 'barrel.gltf', 0.95],
  bucket: [KAY, 'bucket_water.gltf', 0.42],
  bucket_empty: [KAY, 'bucket_empty.gltf', 0.42],
  crate: [KAY, 'crate_A_big.gltf', 0.9],
  crate_small: [KAY, 'crate_A_small.gltf', 0.55],
  crate_b: [KAY, 'crate_B_big.gltf', 0.9],
  crate_long: [KAY, 'crate_long_A.gltf', 0.62],
  crate_long_b: [KAY, 'crate_long_B.gltf', 0.62],
  crate_open: [KAY, 'crate_open.gltf', 0.62],
  sack: [KAY, 'sack.gltf', 0.62],
  ladder: [KAY, 'ladder.gltf', 3.0],
  pallet: [KAY, 'pallet.gltf', 0.22],
  lumber: [KAY, 'resource_lumber.gltf', 0.9],
  stonepile: [KAY, 'resource_stone.gltf', 0.8],
  target: [KAY, 'target.gltf', 1.7],
  weaponrack: [KAY, 'weaponrack.gltf', 1.6],
  wheelbarrow: [KAY, 'wheelbarrow.gltf', 0.75],
  lily: [KAY, 'waterlily_A.gltf', 0.12],
  lily_b: [KAY, 'waterlily_B.gltf', 0.12],
  waterplant: [KAY, 'waterplant_A.gltf', 0.9],
  waterplant_b: [KAY, 'waterplant_B.gltf', 0.9],
  tent: [KAY, 'tent.gltf', 2.3],
  cart: [KEN, 'cart.glb', 1.25],
  cart_high: [KEN, 'cart-high.glb', 1.95],
  stall: [KEN, 'stall.glb', 0.95],
  stall_red: [KEN, 'stall-red.glb', 2.55],
  stall_green: [KEN, 'stall-green.glb', 2.55],
  stool: [KEN, 'stall-stool.glb', 0.48],
  stall_bench: [KEN, 'stall-bench.glb', 0.48],
  lighthouse: ['.', 'lighthouse.glb', 17],
};

async function optimise(doc) {
  await doc.transform(
    dedup(), weld(), prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512] }),
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
}

fs.mkdirSync(path.join(OUT, 'models/town'), { recursive: true });
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
manifest.decor ??= {};
for (const k of Object.keys(manifest.decor)) if (k.startsWith('town_')) delete manifest.decor[k];
for (const [key, [pack, file, height]] of Object.entries(KIT)) {
  const src = pack === KEN ? path.join(X, 'Models/GLB format', file) : path.join(SRC, pack, file);
  if (!fs.existsSync(src)) { console.warn('missing', src); continue; }
  const doc = await io.read(src);
  await optimise(doc);
  const rel = `models/town/${key}.glb`;
  await io.write(path.join(OUT, rel), doc);
  manifest.decor[`town_${key}`] = { model: rel, height };
  console.log('•', `town_${key}`.padEnd(20), `${(fs.statSync(path.join(OUT, rel)).size / 1024).toFixed(0)} KB`);
}
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log('• manifest.decor town_* updated');
