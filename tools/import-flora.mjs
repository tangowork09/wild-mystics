#!/usr/bin/env node
// Extra vegetation assets for the look workstream (v3), from the CC0 Quaternius Stylized Nature MegaKit
// already unpacked by tools/import-assets.mjs into .asset-scout/_x/nature.
//
//   node tools/import-flora.mjs [scoutDir]
//
// Writes public/assets/flora/*: untinted (white) leaf textures so foliage can be coloured per land at
// runtime, the desert rock texture, and a few more tree variants (meshopt + WebP, same pipeline as the
// main importer). Runtime code loads these by path (src/world/flora/protos.ts), no manifest entry needed.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, weld, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SCOUT = process.argv[2] ?? process.env.SCOUT ?? path.join(ROOT, '.asset-scout');
const NATURE = path.join(SCOUT, '_x/nature');
const OUT = path.join(ROOT, 'public/assets/flora');
fs.mkdirSync(OUT, { recursive: true });
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const kb = (f) => `${(fs.statSync(f).size / 1024).toFixed(0)} KB`;

// ── textures ──────────────────────────────────────────────────────────────
const TEX = [
  ['Leaves_NormalTree.png', 'leaves_round.webp', 1024],
  ['Leaves_TwistedTree.png', 'leaves_twisted.webp', 1024],
  ['Leaf_Pine.png', 'leaves_pine.webp', 1024],
  ['Rocks_Desert_Diffuse.png', 'rocks_desert.webp', 1024],
];
for (const [src, dst, size] of TEX) {
  const out = path.join(OUT, dst);
  await sharp(path.join(NATURE, 'Textures', src)).resize(size, size).webp({ quality: 86, alphaQuality: 90 }).toFile(out);
  console.log('• tex', dst.padEnd(22), kb(out));
}

// ── extra tree variants ──────────────────────────────────────────────────
const MODELS = ['CommonTree_2', 'CommonTree_4', 'Pine_2', 'Pine_4', 'TwistedTree_2', 'TwistedTree_4', 'DeadTree_2', 'DeadTree_4', 'Grass_Wispy_Short', 'Plant_1_Big'];
for (const name of MODELS) {
  const doc = await io.read(path.join(NATURE, 'glTF', `${name}.gltf`));
  await doc.transform(
    dedup(), weld(), prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], slots: /^(?!normal).*$/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [256, 256], slots: /^normal/ }),
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const out = path.join(OUT, `${name}.glb`);
  await io.write(out, doc);
  console.log('• glb', name.padEnd(22), kb(out));
}
