import '@fontsource/cinzel/500.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource/cormorant-garamond/600-italic.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './ui/styles.css';
import * as THREE from 'three';
import { renderer } from './core/renderer';
import { input } from './core/input';
import { tweens } from './core/tween';
import { sfx, music, preloadSfx } from './core/audio';
import { pick, randInt, weighted } from './core/noise';
import { loadManifest, preloadTextures } from './assets/manifest';
import { SPECIES } from './data/species';
import { ELEMENTS } from './data/elements';
import { ZONES, START_POS, WATER_LEVEL, type Zone } from './data/zones';
import { createCreature, evolve, speciesOf, displayName, type Creature } from './game/creature';
import { state, save, resetSave, healAll, addCreature, markCaught } from './game/state';
import { Overworld, type WorldEvent } from './world/world';
import type { Wild } from './world/wilds';
import { Battle, type BattleSetup } from './battle/battle';
import { Hud } from './ui/hud';
import * as screens from './ui/screens';
import { teamMenu, dexMenu, bagMenu, mapMenu, pauseMenu, type MenuHooks } from './ui/menus';
import { openService } from './ui/services';
import { toast, titleCard, flash, clearFlash } from './ui/dom';
import { runDebug } from './debug';

document.getElementById('app')!.appendChild(renderer.domElement);

export const game = {
  world: null as unknown as Overworld,
  hud: null as unknown as Hud,
  battle: null as Battle | null,
  busy: false,
  started: false,
};

let lastSteps = state.steps;
let t = 0;
let last = performance.now();
let musicCheck = 0;

const hooks: MenuHooks = { evolve: doEvolve };

async function boot() {
  screens.loading('Gathering supplies…', 0.02);
  input.init(renderer.domElement, document.getElementById('joy')!, document.getElementById('knob')!);
  await loadManifest((m, f) => screens.loading(m, 0.04 + f * 0.56));
  screens.loading('Unpacking textures…', 0.62);
  await preloadTextures();
  const world = new Overworld();
  game.world = world;
  const steps = ['Shaping the land…', 'Painting terrain…', 'Growing meadows…', 'Raising towns…', 'Releasing wild creatures…'];
  await world.build((m) => screens.loading(m, 0.64 + (steps.indexOf(m) + 1) * 0.06));
  game.hud = new Hud(world);
  game.hud.show(false);
  game.hud.onButton = (b) => void openMenu(b);
  world.onZoneEnter = (z) => {
    titleCard(z.name, z.subtitle);
    updateMusic(true);
  };
  world.refreshBosses();
  addEventListener('resize', onResize);
  onResize();
  screens.loading('Lighting the lanterns…', 0.98);
  world.update(0.016, 0, true);
  world.render(0.016);
  screens.hideLoading();
  requestAnimationFrame(frame);

  if (await runDebug(game, { startBattle: startWildBattle, startBoss: startBossBattle, begin })) return;

  const choice = await screens.title(state.started && state.team.length > 0);
  preloadSfx();
  music('overworld');
  await begin(choice === 'new');
}

async function begin(fresh: boolean, starterOverride?: string) {
  const w = game.world;
  if (fresh) {
    resetSave();
    lastSteps = 0;
    const starter = starterOverride ?? (await screens.chooseStarter());
    const c = createCreature(starter, 5);
    state.team.push(c);
    markCaught(starter);
    state.started = true;
    state.pos = [...START_POS];
    save();
    w.teleport(START_POS[0], START_POS[1]);
    w.refreshBosses();
  } else {
    w.teleport(state.pos[0], state.pos[1]);
  }
  w.titleMode = false;
  w.camYaw = Math.PI;
  w.snapCamera();
  game.hud.show(true);
  game.started = true;
  titleCard(w.zone.name, w.zone.subtitle);
  updateMusic(true);
  if (fresh && !starterOverride) {
    game.busy = true;
    await screens.guide(input.isTouch);
    game.busy = false;
    toast('Tip: walk through <b>tall grass</b> or press <kbd>F</kbd> near a wild creature.', '', 5000);
  }
}

function onResize() {
  renderer.setSize(innerWidth, innerHeight);
  game.world?.resize(innerWidth, innerHeight);
}

// ── Main loop ────────────────────────────────────────────────────────────
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;
  input.update();
  const w = game.world;

  if (game.started && !game.busy && !game.battle) {
    if (input.hit('t')) void openMenu('team');
    else if (input.hit('c')) void openMenu('dex');
    else if (input.hit('b')) void openMenu('bag');
    else if (input.hit('m')) void openMenu('map');
    else if (input.hit('escape')) void openMenu('menu');
  }

  tweens.update(dt);
  game.battle?.update(dt);
  const ev = w.update(dt, t, game.busy || !!game.battle || !game.started);
  if (ev && !game.busy && !game.battle) void handleEvent(ev);

  if (game.started) {
    const delta = state.steps - lastSteps;
    lastSteps = state.steps;
    if (delta > 0) for (const e of state.eggs) e.stepsLeft -= delta;
    const ready = state.eggs.find((e) => e.stepsLeft <= 0);
    if (ready && !game.busy && !game.battle) void hatchEgg(ready.uid);
    if (!game.battle) game.hud.update();
    musicCheck += dt;
    if (musicCheck > 1) { musicCheck = 0; updateMusic(); state.pos = [w.playerPos.x, w.playerPos.z]; }
  }
  w.render(dt);
  input.endFrame();
  requestAnimationFrame(frame);
}

function updateMusic(force = false) {
  if (game.battle || !game.started) return;
  const p = game.world.playerPos;
  const inTown = ZONES.some((z) => Math.hypot(p.x - z.town.pos[0], p.z - z.town.pos[1]) < 48);
  void force;
  music(inTown ? 'town' : 'overworld');
}

// ── Menus ────────────────────────────────────────────────────────────────
async function openMenu(which: 'team' | 'dex' | 'bag' | 'map' | 'menu') {
  if (game.busy || game.battle) return;
  game.busy = true;
  sfx('open');
  if (which === 'team') await teamMenu(hooks);
  if (which === 'dex') await dexMenu();
  if (which === 'bag') await bagMenu();
  if (which === 'map') await mapMenu(game.hud.minimap);
  if (which === 'menu') await pauseMenu(() => screens.guide(input.isTouch), () => { resetSave(); location.reload(); });
  game.busy = false;
}

// ── World events ─────────────────────────────────────────────────────────
async function handleEvent(ev: WorldEvent) {
  if (ev.type === 'wild') {
    const w = ev.wild;
    await startWildBattle([{ species: w.species, level: w.level, shiny: w.shiny }], ev.advantage ? 'player' : w.state === 'chase' ? 'enemy' : null, w);
  } else if (ev.type === 'grass') {
    const extra = ev.zone.id !== 'vale' && Math.random() < 0.25 ? [{ species: weighted(ev.zone.spawns).species, level: randInt(ev.zone.levels[0], ev.zone.levels[1]), shiny: false }] : [];
    toast('Something rustles in the grass…', '', 1200);
    await startWildBattle([{ species: ev.species, level: ev.level, shiny: ev.shiny }, ...extra], null, null);
  } else if (ev.type === 'interact') {
    const it = ev.target;
    game.world.player.play('interact');
    if (it.kind === 'service' && it.service) {
      game.busy = true;
      sfx('open');
      await openService(it.service, it.zone, hooks);
      game.busy = false;
      save();
    } else if (it.kind === 'camp') {
      game.busy = true;
      await flash('fade', 700);
      healAll();
      state.respawn = [...it.zone.camp];
      save();
      sfx('heal');
      clearFlash();
      toast('You rest by the fire. <b>Team restored · progress saved.</b>', 'good', 3200);
      game.busy = false;
    } else if (it.kind === 'boss') {
      await startBossBattle(it.zone);
    } else if (it.kind === 'search') {
      await search(it.zone, it.pos);
    }
  }
}

async function search(zone: Zone, pos: THREE.Vector3) {
  game.world.consumeSearch(pos);
  sfx('step');
  const r = Math.random();
  if (r < 0.42) {
    // rarer creatures favoured in bushes
    const inv = zone.spawns.map((s) => ({ ...s, weight: 1 / s.weight }));
    const sp = weighted(inv).species;
    toast(`A hidden <b>${SPECIES[sp].name}</b> leapt out!`, '', 1600);
    await startWildBattle([{ species: sp, level: Math.min(zone.levels[1] + 1, randInt(zone.levels[0] + 1, zone.levels[1] + 1)), shiny: Math.random() < 1 / 60 }], 'enemy', null);
  } else if (r < 0.82) {
    const roll = Math.random();
    if (roll < 0.35) { state.inv.orbs++; toast('Found a <b>Crit Orb</b>!', 'good'); }
    else if (roll < 0.6) { state.inv.potions++; toast('Found a <b>Tonic</b>!', 'good'); }
    else if (roll < 0.85) { const g = randInt(30, 90); state.inv.gold += g; toast(`Found <b>${g} gold</b>!`, 'good'); sfx('coin'); }
    else {
      const el = pick(zone.spawns.map((s) => SPECIES[s.species].element));
      state.inv.elementum[el] += 2;
      toast(`Found <b>2 ${ELEMENTS[el].name} Elementum</b>!`, 'good');
    }
    sfx('captured');
    save();
  } else {
    toast('Only rustling leaves…');
  }
}

// ── Battles ──────────────────────────────────────────────────────────────
/** Pick the flattest dry spot near the encounter so both sides stand on level ground. */
function safeCenter(from: THREE.Vector3, dir: THREE.Vector3, dist: number) {
  const w = game.world;
  const right = new THREE.Vector3(dir.z, 0, -dir.x);
  let best = from.clone(), bestScore = Infinity;
  for (let a = 0; a < 3; a++) {
    for (let r = 0; r <= 14; r += 3.5) {
      for (let k = 0; k < (r === 0 ? 1 : 8); k++) {
        const ang = (k / 8) * Math.PI * 2 + a * 0.3;
        const c = from.clone().addScaledVector(dir, dist).add(new THREE.Vector3(Math.cos(ang) * r, 0, Math.sin(ang) * r));
        const pts = [-6, -3, 0, 3, 6].flatMap((f) => [-3.5, 0, 3.5].map((l) => c.clone().addScaledVector(dir, f).addScaledVector(right, l)));
        const hs = pts.map((p) => w.data.heightAt(p.x, p.z));
        if (Math.min(...hs) < WATER_LEVEL + 0.25) continue;
        const blocked = w.props.nearby(c.x, c.z).some((col) => col.r > 2 && Math.hypot(col.x - c.x, col.z - c.z) < col.r + 8);
        const score = Math.max(...hs) - Math.min(...hs) + r * 0.05 + (blocked ? 5 : 0);
        if (score < bestScore) { bestScore = score; best = c; }
      }
    }
  }
  best.y = w.data.heightAt(best.x, best.z);
  return best;
}

async function startWildBattle(list: { species: string; level: number; shiny: boolean }[], advantage: BattleSetup['advantage'], wild: Wild | null) {
  const w = game.world;
  const p = w.playerPos.clone();
  let dir: THREE.Vector3;
  if (wild) dir = wild.pos.clone().sub(p).setY(0);
  else dir = new THREE.Vector3(-Math.sin(w.camYaw), 0, -Math.cos(w.camYaw));
  if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
  dir.normalize();
  const center = safeCenter(p, dir, 5.5);
  const enemies = list.map((e) => createCreature(e.species, e.level, { shiny: e.shiny }));
  const out = await runBattle({ kind: 'wild', enemies, zone: w.zone, center, forward: dir, advantage });
  if (wild) {
    if (out === 'fled') { wild.cooldown = 6; }
    else w.wilds.remove(wild.id);
  }
}

async function startBossBattle(zone: Zone) {
  const w = game.world;
  const [bx, bz] = zone.boss.pos;
  const center = new THREE.Vector3(bx, w.data.heightAt(bx, bz), bz);
  const dir = new THREE.Vector3(bx - zone.camp[0], 0, bz - zone.camp[1]).normalize();
  const boss = createCreature(zone.boss.species, zone.boss.level);
  const adds = zone.boss.adds.map((a) => createCreature(a, Math.max(2, zone.boss.level - 2)));
  // put the explorer on the camp side of the arena
  const start = center.clone().addScaledVector(dir, -14);
  w.playerPos.set(start.x, w.data.heightAt(start.x, start.z), start.z);
  const out = await runBattle({ kind: 'boss', enemies: [boss, ...adds], zone, center: center.clone().addScaledVector(dir, -3), forward: dir, advantage: null });
  if (out === 'win') {
    state.bosses.push(zone.id);
    state.inv.greatOrbs += 2;
    state.inv.elixirs += 1;
    w.refreshBosses();
    save();
    titleCard('Guardian Defeated', `${zone.name} is at peace`, 3600);
    toast('Received <b>2 Great Orbs</b> and an <b>Elixir</b>.', 'good', 4000);
    if (state.bosses.length === ZONES.length) setTimeout(() => titleCard('The Wilds Are Calm', 'Every Guardian has been answered. Thank you for playing this prototype.', 6000), 3800);
  }
}

async function runBattle(setup: BattleSetup): Promise<'win' | 'lose' | 'fled' | 'captured'> {
  const w = game.world;
  game.busy = true;
  sfx('encounter');
  await flash('shatter', 480);
  w.battleMode = true;
  document.getElementById('titlecard')!.classList.remove('in');
  w.props.setClear(setup.center.x, setup.center.z, setup.kind === 'boss' ? 20 : 13);
  w.grass.setClear(setup.center.x, setup.center.z, setup.kind === 'boss' ? 20 : 12);
  w.wilds.group.visible = false;
  w.wilds.hideLabels();
  const bossRig = setup.kind === 'boss' ? w.bossRigs.get(setup.zone.id) : undefined;
  if (bossRig) bossRig.root.visible = false;
  w.structures.setBeamVisible(setup.zone.id, setup.kind !== 'boss');
  game.hud.show(false);
  const battle = new Battle(w, setup);
  game.battle = battle;
  clearFlash();
  const out = await battle.run();
  game.battle = null;
  await flash('fade', 450);
  w.battleMode = false;
  w.props.setClear(0, 0, 0);
  w.grass.setClear(0, 0, 0);
  w.wilds.group.visible = true;
  w.structures.setBeamVisible(setup.zone.id, true);
  w.player.play('idle');
  if (out.result === 'lose') {
    state.inv.gold = Math.floor(state.inv.gold * 0.9);
    healAll();
    w.teleport(state.respawn[0], state.respawn[1]);
    toast('You wake by a warm hearth. Your team has been restored.', 'bad', 4200);
  }
  w.player.root.position.copy(w.playerPos);
  w.refreshBosses();
  w.snapCamera();
  game.hud.show(true);
  clearFlash();
  for (const c of out.evolvable) await doEvolve(c);
  save();
  game.busy = false;
  updateMusic(true);
  return out.result;
}

async function doEvolve(c: Creature) {
  const ev = speciesOf(c).evolvesTo;
  if (!ev || c.level < ev.level) return;
  const from = c.species;
  const prev = game.busy;
  game.busy = true;
  await screens.evolution(c, from, ev.id);
  evolve(c);
  markCaught(ev.id);
  save();
  toast(`${displayName(c)} evolved!`, 'good');
  game.busy = prev;
}

async function hatchEgg(uid: string) {
  const i = state.eggs.findIndex((e) => e.uid === uid);
  if (i < 0) return;
  const egg = state.eggs[i];
  state.eggs.splice(i, 1);
  game.busy = true;
  const c = createCreature(egg.species, 3, { genes: egg.genes, parents: egg.parents[0] === '?' ? undefined : egg.parents, shiny: Math.random() < 1 / 48 });
  if (egg.inheritSkill && !c.skills.some((s) => s.id === egg.inheritSkill)) {
    if (c.skills.length < 4) c.skills.push({ id: egg.inheritSkill, rank: 1 });
    else c.skills[c.skills.length - 1] = { id: egg.inheritSkill, rank: 1 };
  }
  await screens.hatch(c);
  const where = addCreature(c);
  toast(`${displayName(c)} ${where === 'team' ? 'joined your team' : 'was sent to storage'}!`, 'good');
  save();
  game.busy = false;
}

void boot();
