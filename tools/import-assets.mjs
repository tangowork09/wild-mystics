#!/usr/bin/env node
// Builds public/assets/** + public/assets/manifest.json from the CC0 packs in .asset-scout/.
// Re-runnable. Your own art: drop GLBs in public/assets/models/... and edit manifest.json
// (or add a mapping here) — anything listed in the manifest replaces the placeholder.
//
//   node tools/import-assets.mjs

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, textureCompress, resample, weld } from '@gltf-transform/functions';
import sharp from 'sharp';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SCOUT = path.join(ROOT, '.asset-scout');
const X = path.join(SCOUT, '_x'); // extraction scratch
const OUT = path.join(ROOT, 'public/assets');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

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
      if (!keepAnims.includes(nm)) a.dispose();
    }
  }
  await doc.transform(
    dedup(),
    weld(),
    resample(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], slots: /^(?!normal).*$/ }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [normalTex, normalTex], slots: /^normal/ }),
  );
  return doc;
}

const manifest = { player: null, npcs: [], creatures: {}, environment: {}, buildings: {}, decor: {}, textures: {}, vfx: {}, music: {} };

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
  for (const m of src.matchAll(re)) {
    const [, id, , height, model] = m;
    const pm = pickModel(model);
    const doc = await io.read(pm.file);
    await optimise(doc);
    const out = path.join(OUT, `models/creatures/${id}.glb`);
    await io.write(out, doc);
    manifest.creatures[id] = { model: `models/creatures/${id}.glb`, height: Number(height), rig: pm.rig, anims: ANIMS[pm.rig] };
    log(`creature ${id.padEnd(13)} ← ${model.padEnd(18)} ${pm.rig.padEnd(6)} ${kb(out)}`);
  }
}

// ── 2. Player + villagers (KayKit Adventurers) ────────────────────────────
const KAY_WEAPONS = [/Sword/, /Shield/, /Axe/, /Crossbow/, /Knife/, /Staff/, /Wand/, /Spellbook/, /Throwable/, /Mug/, /Bow/, /Arrow/, /Quiver/, /Dagger/];
async function characters() {
  mk(path.join(OUT, 'models/characters'));
  const playerAnims = ['Idle', 'Walking_A', 'Running_A', 'Throw', 'Cheer', 'Hit_A', 'Use_Item', 'Interact', 'PickUp', 'Dodge_Left', 'Dodge_Right', 'Jump_Full_Short', 'Death_A', 'Spellcast_Shoot', 'Block'];
  {
    const doc = await io.read(path.join(SCOUT, 'player/Mage.glb'));
    await optimise(doc, { keepAnims: playerAnims, dropNodes: KAY_WEAPONS });
    const out = path.join(OUT, 'models/characters/player.glb');
    await io.write(out, doc);
    manifest.player = { model: 'models/characters/player.glb', height: 1.75, anims: { idle: 'Idle', run: 'Running_A', walk: 'Walking_A', attack: 'Throw', hit: 'Hit_A', cast: 'Spellcast_Shoot', faint: 'Death_A', victory: 'Cheer', interact: 'Interact' } };
    log(`player ← Mage ${kb(out)}`);
  }
  for (const who of ['Barbarian', 'Knight', 'Rogue', 'Rogue_Hooded']) {
    const doc = await io.read(path.join(SCOUT, `player/${who}.glb`));
    await optimise(doc, { keepAnims: ['Idle', 'Walking_A', 'Cheer', 'Interact'], dropNodes: KAY_WEAPONS });
    const out = path.join(OUT, `models/characters/npc_${who.toLowerCase()}.glb`);
    await io.write(out, doc);
    manifest.npcs.push({ model: `models/characters/npc_${who.toLowerCase()}.glb`, height: 1.7, anims: { idle: 'Idle', run: 'Walking_A', cast: 'Interact', victory: 'Cheer' } });
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
    execSync(`ffmpeg -y -loglevel error -i "${path.join(SCOUT, 'audio', file)}" -ac 2 -b:a 128k "${out}"`);
    manifest.music[name] = `audio/music_${name}.mp3`;
    log(`music ${name} ${kb(out)}`);
  }
}

await creatures();
await characters();
await nature();
await town();
await misc();
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
log('manifest.json written');
