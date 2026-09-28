#!/usr/bin/env node
// Builds public/assets/** + public/assets/manifest.json from the CC0 packs in .asset-scout/.
// Re-runnable. Your own art: drop GLBs in public/assets/models/... and edit manifest.json
// (or add a mapping here) — anything listed in the manifest replaces the placeholder.
//
//   node tools/import-assets.mjs
//   node tools/import-assets.mjs --only=creatures [--regraze] [--force=<file,...>]
//     v3: creature models only — keeps every other asset and manifest section untouched, writes only
//     models that are new (or forced). --regraze re-imports the animal-pack models with their Eating clip.
//   SCOUT_DIR=/path/to/.asset-scout overrides where the CC0 packs live (worktrees share one scout).
//   node tools/import-assets.mjs --only dungeon   (v3:dungeons — re-import just the dungeon kits, keep the rest of manifest.json)
//   ASSET_SCOUT=~/expedition-wilds/.asset-scout node tools/import-assets.mjs …   (read the packs from another checkout)

import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, resample, weld, quantize, meshopt, mergeDocuments, unpartition } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SCOUT = process.env.SCOUT_DIR ?? (process.env.ASSET_SCOUT ? path.resolve(process.env.ASSET_SCOUT) : path.join(ROOT, '.asset-scout'));
const ARG = (k) => process.argv.find((a) => a.startsWith(`--${k}`));
const ONLY = ARG('only=')?.split('=')[1] ?? (process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null);
const FORCE = new Set((ARG('force=')?.split('=')[1] ?? '').split(',').filter(Boolean));
const REGRAZE = !!ARG('regraze');
const X = path.join(SCOUT, '_x'); // extraction scratch
const OUT = path.join(ROOT, 'public/assets');
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const mk = (p) => fs.mkdirSync(p, { recursive: true });
const log = (...a) => console.log('•', ...a);
const kb = (f) => `${(fs.statSync(f).size / 1024).toFixed(0)} KB`;

function unzipOnce(zip, dir) {
  if (fs.existsSync(dir)) return dir;
  mk(dir);
  execSync(`unzip -q -o "${zip}" -d "${dir}"`);
  return dir;
}

function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = findFile(p, name); if (r) return r; }
    else if (e.name === name) return p;
  }
  return null;
}

async function optimise(doc, { tex = 1024, normalTex = 512, keepAnims = null, dropNodes = [] } = {}) {
  const root = doc.getRoot();
  if (dropNodes.length) {
    for (const n of root.listNodes()) {
      if (dropNodes.some((d) => (typeof d === 'string' ? n.getName() === d : d.test(n.getName())))) n.dispose();
    }
  }
  if (keepAnims) {
    for (const a of root.listAnimations()) {
      const nm = a.getName().split('|').pop();
      if (keepAnims.includes(nm)) continue;
      // dispose samplers/channels too, otherwise their accessors survive prune()
      for (const sm of a.listSamplers()) sm.dispose();
      for (const ch of a.listChannels()) ch.dispose();
      a.dispose();
    }
  }
  await doc.transform(
    dedup(),
    weld(),
    resample(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], slots: /^(?!normal).*$/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [normalTex, normalTex], slots: /^normal/ }),
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  return doc;
}

const manifest = { player: null, npcs: [], creatures: {}, environment: {}, buildings: {}, decor: {}, textures: {}, vfx: {}, music: {} };

// ── Round-2 creature packs (.asset-scout/round2/creatures + creatures.json) ──
// species.ts refers to them as 'R2:<exact file name>' (e.g. 'R2:Koi__d2ba96af.glb') so the several
// "Fish" / "Shark" / "Cow" / "Horse" files stay unambiguous. Every pack names its clips differently, so
// our clip names are matched fuzzily (same idea as tools/add-asset.mjs RULES), most specific rule first.
const R2 = path.join(SCOUT, 'round2');
const R2_RULES = {
  idle: [/^idle$/i, /^[a-z]+_?idle$/i, /^swimming_normal$/i, /^swim\b/i, /flying$/i, /idle/i],
  walk: [/^walk(ing)?(_a)?$/i, /^[a-z]+_walk(ing)?$/i, /^swimming_normal$/i, /^swim\b/i, /flying$/i],
  run: [/^run(ning)?(_a)?$/i, /^[a-z]+_run(ning)?$/i, /^gallop$/i, /^swimming_fast$/i, /^swim\b/i, /flying$/i, /^walk(ing)?(_a)?$/i, /^[a-z]+_walk(ing)?$/i],
  attack: [/^attack$/i, /^(?!block)[a-z]+_attack$/i, /^attack_headbutt$/i, /^bite_front$/i, /bite/i, /(^|_)punch(_a)?$/i, /^1h_melee_attack_chop$/i, /attack/i, /^[a-z]*_?jump$/i],
  hit: [/hit_?react/i, /hit_?rec(ie|ei)ve/i, /rec(ie|ei)ve_?hit/i, /^hit_a$/i, /(^|_)hit$/i, /^swimming_impulse$/i, /(^|_)no$/i],
  faint: [/^death(_a)?$/i, /^[a-z]+_death$/i, /death/i, /(^|_)dead$/i, /die$/i],
  cast: [/^spellcast_shoot$/i, /spell/i, /(^|_)shoot$/i, /^attack_kick$/i, /attack_?2$/i, /(^|_)yes$/i, /^swimming_impulse$/i, /^[a-z]*_?jump$/i, /jump_?to_?idle/i],
  victory: [/cheer/i, /(^|_)dance$/i, /victory/i, /thumbs_?up/i, /(^|_)wave$/i, /(^|_)yes$/i, /jump_?to_?idle/i, /^[a-z]*_?jump$/i, /^out_of_water$/i],
  jump: [/^jump$/i, /^[a-z]+_jump$/i, /^jump_full_short$/i, /jump_?to_?idle/i],
  graze: [/^eating$/i, /^idle_?headlow$/i, /^idle_2_headlow$/i],
};
const HOP = 'Hop'; // looping copy of a jump clip, for farm critters that ship without walk/run clips
/** Models that don't face +Z like the rest (checked with a head-on render of every round-2 species). */
const R2_ROT_Y = { 'Wasp__71cadefd.glb': -Math.PI / 2 };

/**
 * Map our anim names onto a model's clips (base names, file order). One-shot anims never reuse a
 * looping clip: the runtime can't replay the clip it is already looping as a one-shot (it would
 * freeze on the last frame), so e.g. a fish that only has "Swim" simply gets no attack clip.
 */
function mapR2Anims(clips) {
  const pick = (rules, avoid) => {
    for (const r of rules) {
      const hit = clips.find((c) => r.test(c) && !avoid?.has(c));
      if (hit) return hit;
    }
    return undefined;
  };
  const anims = { idle: pick(R2_RULES.idle) ?? clips[0] };
  let hopFrom = null;
  const walk = pick(R2_RULES.walk);
  const run = pick(R2_RULES.run) ?? walk;
  if (walk || run) {
    anims.walk = walk ?? run;
    anims.run = run;
  } else if ((hopFrom = pick(R2_RULES.jump))) {
    anims.walk = anims.run = HOP; // hop around instead of sliding in idle
  }
  const loops = new Set([anims.idle, anims.walk, anims.run].filter(Boolean));
  const graze = pick(R2_RULES.graze, loops);
  if (graze) { anims.graze = graze; loops.add(graze); }
  for (const k of ['attack', 'hit', 'faint', 'cast', 'victory', 'jump']) {
    const c = pick(R2_RULES[k], loops);
    if (c) anims[k] = c;
  }
  return { anims, hopFrom };
}

/** Several packs export every clip twice ('Idle' and 'AnimalArmature|Idle'): keep the first. */
function dedupeClips(doc) {
  const seen = new Set();
  for (const a of doc.getRoot().listAnimations()) {
    const b = a.getName().split('|').pop();
    if (!seen.has(b)) { seen.add(b); continue; }
    for (const sm of a.listSamplers()) sm.dispose();
    for (const ch of a.listChannels()) ch.dispose();
    a.dispose();
  }
}

/** Add a second clip that shares `from`'s keyframes, so it can loop while `from` stays a one-shot. */
function cloneClip(doc, from, name) {
  const src = doc.getRoot().listAnimations().find((a) => a.getName().split('|').pop() === from);
  if (!src) return;
  const anim = doc.createAnimation(name);
  const samplers = new Map();
  for (const s of src.listSamplers()) {
    const ns = doc.createAnimationSampler().setInput(s.getInput()).setOutput(s.getOutput()).setInterpolation(s.getInterpolation());
    anim.addSampler(ns);
    samplers.set(s, ns);
  }
  for (const ch of src.listChannels()) {
    anim.addChannel(doc.createAnimationChannel().setTargetNode(ch.getTargetNode()).setTargetPath(ch.getTargetPath()).setSampler(samplers.get(ch.getSampler())));
  }
}

let r2Meta = null;
function r2Info(file) {
  r2Meta ??= new Map(JSON.parse(fs.readFileSync(path.join(R2, 'creatures.json'), 'utf8')).map((m) => [path.basename(m.file), m]));
  const meta = r2Meta.get(file);
  if (!meta) throw new Error(`round-2 model not found in creatures.json: ${file}`);
  return meta;
}

// v3 sources: the Quaternius Animated Animal Pack leftovers ('A:Deer') and the v3 scout's static creatures ('V3:owl.glb').
const ANIMALS = path.join(SCOUT, 'creatures/glb_animals');
const V3 = path.join(SCOUT, 'v3/creatures');
const SRC = {
  A: (name) => ({ file: path.join(ANIMALS, `${name}.glb`), meta: { pack: 'Quaternius Animated Animal Pack', rig: 'quadruped' } }),
  V3: (name) => ({ file: path.join(V3, name), meta: { pack: 'v3 scout (static)', rig: V3_RIG[name] ?? 'ground' } }),
};
/** Static v3 meshes: how they move (procedural) and which way they face. */
const V3_RIG = { 'jellyfish.glb': 'flyer', 'owl.glb': 'ground', 'golem.glb': 'biped', 'octopus.glb': 'ground', 'turtle_character.glb': 'quadruped' };
const V3_ROT_Y = {};

/** Optimise one round-2 model into public/assets and return its manifest fields. */
async function importR2(file, rel, src = null) {
  const meta = src ? src.meta : r2Info(file);
  const doc = await io.read(src ? src.file : path.join(R2, 'creatures', file));
  // A skinned mesh node's own transform is ignored when rendering (glTF spec; three binds with identity),
  // but the runtime's Box3 height measure still applies it to the skinned bounds. The Triceratops node is
  // tilted, which doubled its measured height and floated it off the ground, so neutralise it everywhere.
  for (const n of doc.getRoot().listNodes()) if (n.getSkin() && n.getMesh()) n.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  dedupeClips(doc);
  const clips = doc.getRoot().listAnimations().map((a) => a.getName().split('|').pop());
  const { anims, hopFrom } = mapR2Anims(clips);
  const keep = [...new Set(Object.values(anims).filter((c) => c !== HOP)), ...(hopFrom ? [hopFrom] : [])];
  // KayKit packs can ship weapons as child nodes (these skeleton files don't); strip any so they fight bare-boned
  await optimise(doc, { keepAnims: keep, dropNodes: file.startsWith('KayKit_') ? KAY_WEAPONS : [] });
  if (hopFrom) cloneClip(doc, hopFrom, HOP); // after optimise: shares the already-resampled keyframes
  await io.write(path.join(OUT, rel), doc);
  const rig = /fish/i.test(meta.pack) ? 'swimmer' : meta.rig;
  const rotY = R2_ROT_Y[file] ?? V3_ROT_Y[file];
  return { rig, anims, ...(rotY ? { rotY } : {}) };
}

// ── 1. Creatures ──────────────────────────────────────────────────────────
async function creatures() {
  mk(path.join(OUT, 'models/creatures'));
  const analysis = JSON.parse(fs.readFileSync(path.join(SCOUT, 'creatures/glb_analysis.json'), 'utf8'));
  const byName = new Map();
  for (const [file, info] of Object.entries(analysis)) {
    const base = path.basename(file).split('__')[0].replace(/_/g, ' ');
    const anims = info.animations.map((a) => a.split('|').pop());
    const rig = anims.includes('Flying_Idle') ? 'flyer' : anims.includes('Punch') && anims.includes('Run') ? 'biped' : 'ground';
    const entry = { file: path.join(SCOUT, 'creatures', file), rig, anims, tris: info.tri_count };
    if (!byName.has(base)) byName.set(base, []);
    byName.get(base).push(entry);
  }
  const pickModel = (key) => {
    const [name, tier] = key.split(':');
    const list = byName.get(name);
    if (!list) throw new Error(`model not found: ${key}`);
    if (!tier) return list[0];
    const sorted = [...list].sort((a, b) => a.tris - b.tris);
    return tier === 'small' ? sorted[0] : sorted[sorted.length - 1];
  };
  const src = fs.readFileSync(path.join(ROOT, 'src/data/species.ts'), 'utf8');
  const re = /\[\['(\w+)', '[^']+', '(\w+)', [\d.]+, [\d.]+, [\d.]+, [\d.]+, ([\d.]+), '([^']+)'/g;
  const ANIMS = {
    ground: { idle: 'Idle', run: 'Walk', attack: 'Bite_Front', hit: 'HitRecieve', faint: 'Death', cast: 'Yes', victory: 'Dance' },
    biped: { idle: 'Idle', run: 'Run', attack: 'Punch', hit: 'HitReact', faint: 'Death', cast: 'Weapon', victory: 'Wave' },
    flyer: { idle: 'Flying_Idle', run: 'Fast_Flying', attack: 'Headbutt', hit: 'HitReact', faint: 'Death', cast: 'Yes', victory: 'Yes' },
  };
  const written = new Map();
  // --only=creatures: reuse what is already on disk (same model → same clips/rig), write only new or forced files
  const prevByModel = new Map(Object.values(PREV.creatures ?? {}).filter((e) => e.model).map((e) => [e.model, e]));
  const GRAZERS = /^(Alpaca|Bull|Cow__382b3d4a|Donkey|Horse__d37dbc87|Husky|Shiba_Inu|Stag|White_Horse)/;
  const reuse = (rel, file) => ONLY && fs.existsSync(path.join(OUT, rel)) && prevByModel.has(rel) && !FORCE.has(file) && !(REGRAZE && GRAZERS.test(file));
  for (const m of src.matchAll(re)) {
    const [, id, , height, model] = m;
    const pre = model.match(/^(R2|A|V3):(.+)$/);
    if (pre) {
      const [, kind, file] = pre;
      const slug = file.replace(/\.glb$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const rel = `models/creatures/${kind === 'R2' ? 'r2' : kind === 'A' ? 'a' : 'v3'}_${slug}.glb`;
      if (!written.has(rel) && reuse(rel, file)) {
        const e = prevByModel.get(rel);
        written.set(rel, { rig: e.rig, anims: e.anims ?? {}, ...(e.rotY ? { rotY: e.rotY } : {}) });
      }
      if (!written.has(rel)) {
        written.set(rel, await importR2(file, rel, kind === 'R2' ? null : SRC[kind](file)));
        const { rig, anims } = written.get(rel);
        log(`creature model ${path.basename(rel, '.glb').padEnd(34)} ${rig.padEnd(9)} ${kb(path.join(OUT, rel)).padStart(7)}  ${Object.entries(anims).map(([k, v]) => `${k}=${v}`).join(' ')}`);
      }
      const { rig, anims, rotY } = written.get(rel);
      manifest.creatures[id] = { model: rel, height: Number(height), ...(rotY ? { rotY } : {}), rig, anims: { ...anims } };
      continue;
    }
    const slug = model.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const rel = `models/creatures/${slug}.glb`;
    if (ONLY && fs.existsSync(path.join(OUT, rel)) && prevByModel.has(rel) && !FORCE.has(model)) {
      const e = prevByModel.get(rel);
      manifest.creatures[id] = { model: rel, height: Number(height), rig: e.rig, anims: e.anims };
      continue;
    }
    const pm = pickModel(model);
    if (!written.has(rel)) {
      const doc = await io.read(pm.file);
      await optimise(doc);
      await io.write(path.join(OUT, rel), doc);
      written.set(rel, true);
      log(`creature model ${slug.padEnd(20)} ${pm.rig.padEnd(6)} ${kb(path.join(OUT, rel))}`);
    }
    manifest.creatures[id] = { model: rel, height: Number(height), rig: pm.rig, anims: ANIMS[pm.rig] };
  }
}

// ── 2. Player + villagers (KayKit Adventurers) ────────────────────────────
const KAY_WEAPONS = [/Sword/, /Shield/, /Axe/, /Crossbow/, /Knife/, /Staff/, /Wand/, /Spellbook/, /Throwable/, /Mug/, /Bow/, /Arrow/, /Quiver/, /Dagger/];
async function characters() {
  mk(path.join(OUT, 'models/characters'));
  const playerAnims = ['Idle', 'Walking_A', 'Running_A', 'Throw', 'Cheer', 'Hit_A', 'Use_Item', 'Interact', 'PickUp', 'Dodge_Left', 'Dodge_Right', 'Jump_Full_Short', 'Jump_Start', 'Jump_Idle', 'Jump_Land', 'Death_A', 'Spellcast_Shoot', 'Block', 'Sit_Floor_Idle'];
  {
    const doc = await io.read(path.join(SCOUT, 'player/Mage.glb'));
    await optimise(doc, { keepAnims: playerAnims, dropNodes: KAY_WEAPONS });
    const out = path.join(OUT, 'models/characters/player.glb');
    await io.write(out, doc);
    manifest.player = { model: 'models/characters/player.glb', height: 1.75, anims: { idle: 'Idle', run: 'Running_A', walk: 'Walking_A', attack: 'Throw', hit: 'Hit_A', cast: 'Spellcast_Shoot', faint: 'Death_A', victory: 'Cheer', interact: 'PickUp', jump: 'Jump_Full_Short', fall: 'Jump_Idle', land: 'Jump_Land', gather: 'Interact' } };
    log(`player ← Mage ${kb(out)}`);
  }
  for (const who of ['Barbarian', 'Knight', 'Rogue', 'Rogue_Hooded']) {
    const doc = await io.read(path.join(SCOUT, `player/${who}.glb`));
    await optimise(doc, { keepAnims: [], dropNodes: KAY_WEAPONS });
    const out = path.join(OUT, `models/characters/npc_${who.toLowerCase()}.glb`);
    await io.write(out, doc);
    // KayKit characters share one skeleton: NPCs borrow the player's clips by bone name
    manifest.npcs.push({ model: `models/characters/npc_${who.toLowerCase()}.glb`, height: 1.7, animSource: 'models/characters/player.glb', anims: { idle: 'Idle', run: 'Walking_A', walk: 'Walking_A', cast: 'Interact', victory: 'Cheer' } });
    log(`npc ${who} ${kb(out)}`);
  }
}

// ── 3. Nature (Quaternius Stylized Nature MegaKit) ────────────────────────
async function nature() {
  const dir = unzipOnce(path.join(SCOUT, 'nature/quaternius_stylized_nature_megakit_standard.zip'), path.join(X, 'nature'));
  const gltfDir = path.dirname(findFile(dir, 'CommonTree_1.gltf'));
  mk(path.join(OUT, 'models/nature'));
  const KINDS = {
    tree_round: { files: ['CommonTree_1', 'CommonTree_3', 'CommonTree_5'], height: 7.5 },
    tree_pine: { files: ['Pine_1', 'Pine_3', 'Pine_5'], height: 10 },
    tree_dead: { files: ['DeadTree_1', 'DeadTree_3', 'DeadTree_5'], height: 6.5 },
    tree_twisted: { files: ['TwistedTree_1', 'TwistedTree_3', 'TwistedTree_5'], height: 7 },
    rock: { files: ['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3'], height: 1.1 },
    boulder: { files: ['Rock_Medium_2', 'Rock_Medium_3'], height: 2.6 },
    bush: { files: ['Bush_Common', 'Bush_Common_Flowers'], height: 1.3 },
    fern: { files: ['Fern_1', 'Plant_1', 'Plant_7'], height: 0.9 },
    mushroom: { files: ['Mushroom_Common', 'Mushroom_Laetiporus'], height: 0.55 },
    flowers: { files: ['Flower_3_Group', 'Flower_4_Group', 'Clover_1'], height: 0.45 },
    pebbles: { files: ['Pebble_Round_1', 'Pebble_Square_2', 'Pebble_Round_4'], height: 0.25 },
    reeds: { files: ['Grass_Wispy_Tall', 'Grass_Common_Tall', 'Plant_7_Big'], height: 1.3 },
    pathstone: { files: ['RockPath_Round_Small_1', 'RockPath_Round_Small_2', 'RockPath_Round_Wide', 'RockPath_Square_Small_1', 'RockPath_Square_Wide'], height: 0.12 },
  };
  const done = new Set();
  for (const [kind, { files, height }] of Object.entries(KINDS)) {
    manifest.environment[kind] = [];
    for (const f of files) {
      const out = path.join(OUT, `models/nature/${f}.glb`);
      if (!done.has(f)) {
        const doc = await io.read(path.join(gltfDir, `${f}.gltf`));
        await optimise(doc, { tex: 1024, normalTex: 512 });
        await io.write(out, doc);
        done.add(f);
        log(`nature ${f.padEnd(20)} ${kb(out)}`);
      }
      manifest.environment[kind].push({ model: `models/nature/${f}.glb`, height });
    }
  }
}

// ── 4. Town (KayKit Medieval Hexagon) ─────────────────────────────────────
async function town() {
  const dir = unzipOnce(path.join(SCOUT, 'buildings/kaykit-medieval-hexagon-pack.zip'), path.join(X, 'kaykit'));
  mk(path.join(OUT, 'models/buildings'));
  const conv = async (name, target) => {
    const src = findFile(dir, `${name}.gltf`);
    if (!src) throw new Error(`missing ${name}`);
    const doc = await io.read(src);
    await optimise(doc, { tex: 1024 });
    const out = path.join(OUT, `models/buildings/${name}.glb`);
    await io.write(out, doc);
    log(`town ${name.padEnd(32)} ${kb(out)}`);
    return { model: `models/buildings/${name}.glb`, height: target };
  };
  manifest.buildings.healer = await conv('building_church_red', 11);
  manifest.buildings.shop = await conv('building_market_blue', 6.5);
  manifest.buildings.hatchery = await conv('building_windmill_yellow', 12);
  manifest.buildings.tutor = await conv('building_barracks_red', 7.5);
  manifest.buildings.storage = await conv('building_tavern_green', 8.5);
  manifest.buildings.house = [
    await conv('building_home_A_blue', 6.5), await conv('building_home_B_red', 6.5),
    await conv('building_home_A_yellow', 6.5), await conv('building_home_B_green', 6.5),
  ];
  manifest.buildings.tower = await conv('building_tower_A_blue', 11);
  manifest.buildings.watermill = await conv('building_watermill_blue', 7.5);
  manifest.decor.well = await conv('building_well_blue', 3.2);
  manifest.decor.barrel = await conv('barrel', 1.0);
  manifest.decor.crate = await conv('crate_A_big', 1.0);
  manifest.decor.sack = await conv('sack', 0.7);
  manifest.decor.fence = await conv('fence_wood_straight', 1.1);
  manifest.decor.flag = await conv('flag_red', 3.2);
  manifest.decor.cart = null;
}

// ── 5. Textures, VFX, audio ───────────────────────────────────────────────
async function misc() {
  mk(path.join(OUT, 'textures'));
  const t = [['grass_ground_diff_1k.jpg', 'ground_detail.webp'], ['dry_ground_rocks_diff_1k.jpg', 'rock_detail.webp']];
  for (const [a, b] of t) {
    await sharp(path.join(SCOUT, 'hdri_textures', a)).resize(1024, 1024).webp({ quality: 82 }).toFile(path.join(OUT, 'textures', b));
    manifest.textures[b.split('.')[0]] = `textures/${b}`;
  }
  log('textures ✓');

  const vdir = unzipOnce(path.join(SCOUT, 'vfx/kenney_particle-pack.zip'), path.join(X, 'vfx'));
  const pngDir = path.dirname(findFile(vdir, 'slash_01.png'));
  mk(path.join(OUT, 'vfx'));
  const sprites = ['slash_01', 'slash_02', 'slash_03', 'slash_04', 'spark_01', 'spark_04', 'spark_05', 'star_04', 'star_06', 'star_07', 'magic_01', 'magic_03', 'magic_05',
    'flare_01', 'light_01', 'light_03', 'smoke_01', 'smoke_04', 'smoke_07', 'twirl_01', 'twirl_02', 'circle_02', 'circle_05', 'symbol_01', 'symbol_02', 'trace_01', 'trace_04', 'scorch_01', 'muzzle_01', 'fire_01', 'dirt_02'];
  for (const s of sprites) {
    await sharp(path.join(pngDir, `${s}.png`)).resize(256, 256).png({ compressionLevel: 9 }).toFile(path.join(OUT, 'vfx', `${s}.png`));
    manifest.vfx[s] = `vfx/${s}.png`;
  }
  log(`vfx sprites ✓ (${sprites.length})`);

  mk(path.join(OUT, 'audio'));
  const adir = path.join(X, 'audio');
  for (const z of ['kenney_rpg-audio', 'kenney_impact-sounds', 'kenney_interface-sounds']) unzipOnce(path.join(SCOUT, `audio/${z}.zip`), path.join(adir, z));
  const SFX = {
    hit: 'impactPunch_medium_001', hit2: 'impactPunch_heavy_002', perfect: 'impactBell_heavy_001', parry: 'impactMetal_heavy_000', dodge: 'cloth3',
    miss: 'impactSoft_medium_001', select: 'select_002', back: 'back_002', capture: 'maximize_004', captured: 'confirmation_003', break: 'impactGlass_heavy_001',
    heal: 'maximize_006', levelup: 'confirmation_004', encounter: 'bong_001', faint: 'impactSoft_heavy_002', coin: 'handleCoins', open: 'open_002',
    error: 'error_004', slash: 'knifeSlice', quake: 'impactMining_002', orb: 'impactGlass_light_002', step: 'footstep_grass_001',
  };
  for (const [name, file] of Object.entries(SFX)) {
    const src = findFile(adir, `${file}.ogg`);
    if (!src) { console.warn('missing sfx', file); continue; }
    execSync(`ffmpeg -y -loglevel error -i "${src}" -ac 1 -b:a 96k "${path.join(OUT, 'audio', name + '.mp3')}"`);
  }
  log('sfx ✓');
  const MUSIC = {
    town: 'town-theme-rpg_cynicmusic.mp3', overworld: 'nostalgic-town-hub_antonioraymond71.mp3', battle: 'battle-theme_wolfgang.mp3', boss: 'determined-pursuit_emma-ma.wav',
  };
  for (const [name, file] of Object.entries(MUSIC)) {
    const out = path.join(OUT, 'audio', `music_${name}.mp3`);
    execSync(`ffmpeg -y -loglevel error -i "${path.join(SCOUT, 'audio', file)}" -ac 2 -b:a 96k "${out}"`);
    manifest.music[name] = `audio/music_${name}.mp3`;
    log(`music ${name} ${kb(out)}`);
  }
  // Round-2 audio: jingles (Kenney Music Jingles), summon card/chip sounds (Casino Audio), UI clicks,
  // plus land/night/summon/homestead themes (OpenGameArt CC0). Jingles picked by rising pitch contour.
  const r2a = path.join(X, 'audio2');
  for (const z of ['kenney_music-jingles', 'kenney_casino-audio', 'kenney_ui-audio']) unzipOnce(path.join(R2, `audio/${z}.zip`), path.join(r2a, z));
  const SFX2 = {
    captured: 'jingles_PIZZI02', levelup: 'jingles_PIZZI10', quest: 'jingles_PIZZI15', evolve: 'jingles_STEEL02', rare: 'jingles_STEEL12', defeat: 'jingles_PIZZI07',
    card: 'card-slide-1', flip: 'card-place-1', chips: 'chips-stack-1', pack: 'cards-pack-open-1', click: 'click3',
  };
  for (const [name, file] of Object.entries(SFX2)) {
    const src = findFile(r2a, `${file}.ogg`);
    if (!src) { console.warn('missing r2 sfx', file); continue; }
    execSync(`ffmpeg -y -loglevel error -i "${src}" -ac 1 -b:a 96k "${path.join(OUT, 'audio', name + '.mp3')}"`);
  }
  execSync(`ffmpeg -y -loglevel error -i "${path.join(R2, 'audio', 'victory-fanfare_aroachifoundonmypillow.mp3')}" -ac 2 -b:a 112k "${path.join(OUT, 'audio', 'fanfare.mp3')}"`);
  log('round-2 sfx ✓');
  const MUSIC2 = {
    dunes: 'desert-theme_yd.ogg', marsh: 'happy-swamp_shggothslave.mp3', night: 'nighttime-solitude_celestialghost8.mp3',
    summon: 'mystical-enigmatic_cleytonkauffman.mp3', homestead: 'magician-village-loop_beardalaxy.ogg',
  };
  for (const [name, file] of Object.entries(MUSIC2)) {
    const out = path.join(OUT, 'audio', `music_${name}.mp3`);
    execSync(`ffmpeg -y -loglevel error -i "${path.join(R2, 'audio', file)}" -ac 2 -b:a 96k "${out}"`);
    manifest.music[name] = `audio/music_${name}.mp3`;
    log(`music ${name} ${kb(out)}`);
  }
}

// ── 6. Dungeon kits (v3:dungeons) ─────────────────────────────────────────
// Four CC0 kits, each merged into ONE GLB (one shared atlas + material per kit) so a whole interior
// instances from a handful of materials. Every piece is a named node under the scene root; animated
// parts (chest lids, gate leaves) keep their child nodes. Loaded on demand when a dungeon is entered.
const DUNGEON_KITS = {
  kaykit: {
    dir: 'v3/dungeon/kaykit-dungeon-remastered', ext: '.gltf.glb', tex: 256,
    pieces: [
      'wall', 'wall_arched', 'wall_cracked', 'wall_broken', 'wall_window_open', 'wall_window_closed', 'wall_archedwindow_gated', 'wall_archedwindow_open',
      'wall_gated', 'wall_shelves', 'wall_pillar', 'wall_corner', 'wall_corner_small', 'wall_half', 'wall_endcap', 'wall_scaffold',
      'wall_doorway_sides', 'wall_doorway_Tsplit', 'wall_half_endcap', 'wall_open_scaffold',
      'floor_tile_large', 'floor_tile_large_rocks', 'floor_tile_small', 'floor_tile_small_broken_A', 'floor_tile_small_broken_B', 'floor_tile_small_decorated',
      'floor_tile_small_weeds_A', 'floor_tile_small_weeds_B', 'floor_tile_big_grate', 'floor_tile_big_grate_open', 'floor_dirt_large', 'floor_dirt_large_rocky',
      'floor_dirt_small_A', 'floor_dirt_small_weeds', 'floor_wood_large', 'floor_wood_large_dark', 'floor_foundation_allsides',
      'stairs', 'stairs_wide', 'stairs_walled', 'pillar', 'pillar_decorated', 'column', 'barrier', 'barrier_column', 'barrier_half',
      'torch', 'torch_lit', 'torch_mounted', 'barrel_large', 'barrel_large_decorated', 'barrel_small', 'barrel_small_stack',
      'box_large', 'box_small', 'box_small_decorated', 'box_stacked', 'crates_stacked', 'trunk_large_A', 'trunk_large_B', 'trunk_large_C', 'trunk_medium_A', 'trunk_small_A',
      'banner_patternA_red', 'banner_patternA_blue', 'banner_patternA_green', 'banner_patternA_yellow', 'banner_patternA_white', 'banner_patternA_brown',
      'banner_shield_red', 'banner_shield_blue', 'banner_shield_green', 'banner_shield_yellow', 'banner_shield_white', 'banner_thin_red', 'banner_thin_blue', 'banner_thin_green',
      'banner_thin_yellow', 'banner_thin_white', 'banner_triple_red', 'banner_triple_blue', 'banner_triple_green', 'banner_triple_yellow',
      'candle', 'candle_lit', 'candle_triple', 'candle_melted', 'candle_thin_lit', 'rubble_large', 'rubble_half',
      'table_long', 'table_long_decorated_A', 'table_long_broken', 'table_medium', 'table_medium_broken', 'table_small', 'chair', 'stool',
      'shelves', 'shelf_large', 'shelf_small_candles', 'coin', 'coin_stack_large', 'coin_stack_medium', 'coin_stack_small', 'keg', 'keg_decorated',
      'sword_shield', 'sword_shield_gold', 'sword_shield_broken', 'key', 'keyring_hanging', 'bottle_A_green', 'bottle_B_brown', 'plate_stack',
    ],
  },
  halloween: {
    dir: 'v3/dungeon/kaykit-halloween-bits', ext: '.gltf', tex: 256,
    pieces: [
      'crypt', 'arch', 'arch_gate', 'coffin', 'coffin_decorated', 'grave_A', 'grave_A_destroyed', 'grave_B', 'gravemarker_A', 'gravemarker_B', 'gravestone',
      'skull', 'skull_candle', 'ribcage', 'bone_A', 'bone_B', 'bone_C', 'shrine', 'shrine_candles', 'lantern_hanging', 'lantern_standing', 'post_lantern', 'post_skull',
      'pillar', 'plaque', 'plaque_candles', 'candle', 'candle_triple', 'candle_melted', 'tree_dead_large', 'tree_dead_medium', 'tree_dead_small',
      'floor_dirt', 'floor_dirt_grave', 'fence', 'fence_gate', 'fence_pillar', 'bench', 'bench_decorated',
    ],
  },
  kenney: {
    dir: 'v3/dungeon/kenney-mini-dungeon/glb', ext: '.glb', tex: 256,
    pieces: ['trap', 'gate', 'chest', 'key', 'rocks', 'stones', 'wood-support', 'wood-structure', 'column', 'pot', 'potion', 'banner', 'coin'],
  },
  quaternius: {
    dir: 'v3/dungeon/quaternius-modular-dungeon', ext: '.glb', tex: 512,
    pieces: ['trap_door', 'arch_door', 'cobweb', 'skull', 'coin_piles', 'coin_bag', 'sword_wall_mount', 'horse_statue', 'chest'],
  },
};

async function dungeonKits() {
  mk(path.join(OUT, 'models/dungeon'));
  manifest.dungeon = {};
  for (const [kit, def] of Object.entries(DUNGEON_KITS)) {
    const doc = new Document();
    doc.createBuffer();
    const scene = doc.createScene(kit);
    doc.getRoot().setDefaultScene(scene);
    for (const piece of def.pieces) {
      const src = await io.read(path.join(SCOUT, def.dir, piece + def.ext));
      const srcScene = src.getRoot().getDefaultScene() ?? src.getRoot().listScenes()[0];
      const map = mergeDocuments(doc, src);
      const holder = doc.createNode(piece);
      const merged = map.get(srcScene);
      for (const child of merged.listChildren()) holder.addChild(child);
      for (const s of doc.getRoot().listScenes()) if (s !== scene) s.dispose();
      scene.addChild(holder);
    }
    await doc.transform(
      unpartition(),
      dedup(),
      weld(),
      prune({ keepLeaves: true }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [def.tex, def.tex] }),
      quantize(),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    const rel = `models/dungeon/${kit}.glb`;
    await io.write(path.join(OUT, rel), doc);
    manifest.dungeon[kit] = { model: rel, pieces: def.pieces.length };
    log(`dungeon kit ${kit.padEnd(11)} ${String(def.pieces.length).padStart(3)} pieces  ${kb(path.join(OUT, rel))}`);
  }
}

const PREV = (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8')); } catch { return {}; } })();
if (ONLY === 'dungeon') {
  // v3:dungeons — refresh just the dungeon kits and merge them into the existing manifest
  Object.assign(manifest, PREV);
  await dungeonKits();
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  log('manifest.json updated (dungeon kits)');
  process.exit(0);
}
await creatures();
if (ONLY === 'creatures') {
  // keep every other section exactly as it was
  for (const k of Object.keys(PREV)) if (k !== 'creatures') manifest[k] = PREV[k];
} else {
  await characters();
  await nature();
  await town();
  await misc();
  await dungeonKits(); // v3:dungeons
}
// keep baked portraits (tools/bake-portraits.mjs) across re-imports
try {
  const prev = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
  for (const [id, e] of Object.entries(prev.creatures ?? {})) {
    if (!manifest.creatures[id]) continue;
    if (e.portrait) manifest.creatures[id].portrait = e.portrait;
    if (e.portraitShiny) manifest.creatures[id].portraitShiny = e.portraitShiny;
  }
} catch { /* first run */ }
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
log('manifest.json written');
