#!/usr/bin/env node
// Drop one of your own models into the game.
//
//   node tools/add-asset.mjs creature emberling ~/Downloads/emberling.glb [--height 1.1]
//   node tools/add-asset.mjs player    -          ~/Downloads/hero.glb
//   node tools/add-asset.mjs npc       -          ~/Downloads/villager.glb
//   node tools/add-asset.mjs building  healer     ~/Downloads/healer_hut.glb [--height 9]
//   node tools/add-asset.mjs env       tree_round ~/Downloads/oak.glb   (adds a variant)
//   node tools/add-asset.mjs decor     barrel     ~/Downloads/barrel.glb
//   node tools/add-asset.mjs portrait  emberling  ~/Downloads/emberling.png
//
// Accepts .glb / .gltf (+ .fbx if you convert first). Optimises (dedup, weld, WebP textures ≤2k),
// auto-maps animation clips to the game's names, and updates public/assets/manifest.json.
// Refresh the browser — no code changes needed.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, weld, resample } from '@gltf-transform/functions';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'public/assets');
const MANIFEST = path.join(OUT, 'manifest.json');

const [kind, key, src, ...rest] = process.argv.slice(2);
if (!kind || !src) {
  console.log('usage: node tools/add-asset.mjs <creature|player|npc|building|env|decor|portrait> <key|-> <file> [--height N] [--rot DEG]');
  process.exit(1);
}
const flag = (n) => { const i = rest.indexOf(n); return i >= 0 ? Number(rest[i + 1]) : undefined; };
const height = flag('--height');
const rotDeg = flag('--rot');
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};

if (kind === 'portrait') {
  fs.mkdirSync(path.join(OUT, 'portraits'), { recursive: true });
  const out = path.join(OUT, 'portraits', `${key}.webp`);
  await sharp(src).resize(384, 384, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 90 }).toFile(out);
  manifest.creatures ??= {};
  manifest.creatures[key] = { ...(manifest.creatures[key] ?? {}), portrait: `portraits/${key}.webp` };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(`✓ portrait for ${key} → ${out}`);
  process.exit(0);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
await doc.transform(dedup(), weld(), resample(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048] }));

// ── animation auto-mapping ─────────────────────────────────────────────────
const clips = doc.getRoot().listAnimations().map((a) => a.getName());
const base = (n) => n.split('|').pop();
const RULES = {
  idle: [/^idle$/i, /flying_?idle/i, /idle/i, /breath/i, /stand/i],
  run: [/^run/i, /running/i, /fast_?fly/i, /gallop/i, /sprint/i, /^walk/i, /fly/i],
  walk: [/^walk/i, /walking/i],
  attack: [/attack/i, /bite/i, /punch/i, /slash/i, /headbutt/i, /strike/i, /throw/i, /hit_?a$/i],
  hit: [/hit_?react/i, /hitrecieve/i, /hit_?receive/i, /hurt/i, /damage/i, /^hit/i],
  faint: [/death/i, /die/i, /dead/i, /faint/i, /knock/i],
  cast: [/cast/i, /spell/i, /skill/i, /roar/i, /yes/i, /jump/i],
  victory: [/victory/i, /cheer/i, /dance/i, /celebrat/i, /wave/i, /yes/i],
};
const anims = {};
for (const [ours, pats] of Object.entries(RULES)) {
  for (const p of pats) {
    const hit = clips.find((c) => p.test(base(c)));
    if (hit) { anims[ours] = base(hit); break; }
  }
}

const dirs = { creature: 'models/creatures', player: 'models/characters', npc: 'models/characters', building: 'models/buildings', env: 'models/nature', decor: 'models/buildings' };
if (!dirs[kind]) { console.error(`unknown kind ${kind}`); process.exit(1); }
const name = kind === 'player' ? 'player' : kind === 'npc' ? `npc_${path.basename(src).replace(/\.\w+$/, '')}` : `${key}${kind === 'env' ? '_' + Date.now().toString(36) : ''}`;
const rel = `${dirs[kind]}/${name}.glb`;
fs.mkdirSync(path.join(OUT, dirs[kind]), { recursive: true });
await io.write(path.join(OUT, rel), doc);

const entry = { model: rel, ...(height ? { height } : {}), ...(rotDeg ? { rotY: (rotDeg * Math.PI) / 180 } : {}), ...(Object.keys(anims).length ? { anims } : {}) };
if (kind === 'creature') { manifest.creatures ??= {}; manifest.creatures[key] = { ...(manifest.creatures[key] ?? {}), ...entry, height: height ?? manifest.creatures[key]?.height }; }
if (kind === 'player') manifest.player = { height: 1.75, ...entry };
if (kind === 'npc') { manifest.npcs ??= []; manifest.npcs.push({ height: 1.7, ...entry }); }
if (kind === 'building') { manifest.buildings ??= {}; manifest.buildings[key] = entry; }
if (kind === 'decor') { manifest.decor ??= {}; manifest.decor[key] = entry; }
if (kind === 'env') {
  manifest.environment ??= {};
  const cur = manifest.environment[key];
  const list = Array.isArray(cur) ? cur : cur ? [cur] : [];
  if (rest.includes('--replace')) list.length = 0;
  list.push(entry);
  manifest.environment[key] = list;
}
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`✓ ${kind} ${key} → public/assets/${rel} (${(fs.statSync(path.join(OUT, rel)).size / 1024).toFixed(0)} KB)`);
console.log(`  clips found: ${clips.map(base).join(', ') || 'none'}`);
console.log(`  mapped: ${JSON.stringify(anims)}`);
const missing = kind === 'creature' || kind === 'player' ? ['idle', 'run', 'attack', 'hit', 'faint'].filter((k) => !anims[k]) : [];
if (missing.length) console.log(`  ⚠ no clip for: ${missing.join(', ')} — game will fall back gracefully, but add these for best results.`);
