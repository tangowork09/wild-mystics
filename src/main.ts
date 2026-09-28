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
import { renderer, governor, isNative } from './core/renderer';
import { input } from './core/input';
import { tweens } from './core/tween';
import { sfx, music, preloadSfx, setMusicVolume, setSfxVolume, hasTrack } from './core/audio';
import { settings, onSettings } from './core/settings';
import { haptic, setNativeHaptics } from './core/haptics';
import { pick, randInt, weighted } from './core/noise';
import { loadManifest, preloadTextures, ensureModels, essentialModels, ensureCreatures, streamRemainingCreatures } from './assets/manifest';
import { SPECIES } from './data/species';
import { ELEMENTS } from './data/elements';
import { MATERIALS, type MaterialId, type ItemId } from './data/items';
import { ZONES, START_POS, WATER_LEVEL, HOMESTEAD, spawnsBy, type Zone } from './data/zones';
import { TAMERS } from './data/tamers';
import { createCreature, evolveTo, evolutionFor, displayName, newUid, type Creature } from './game/creature';
import { state, save, resetSave, healAll, addCreature, markCaught, useSaveSlot, saveSlot, onSave, itemCount, exportSave, importSave } from './game/state';
import { emit } from './game/events';
import { initProgress, setNotifier, applyReward, rewardText, syncQuests } from './game/progress';
import { Overworld, type WorldEvent } from './world/world';
import { shinyRoll, type Wild } from './world/wilds';
import { TOWN_SPAWN, type Interactable } from './world/towns';
import { Battle, type BattleSetup } from './battle/battle';
import { Hud } from './ui/hud';
import * as screens from './ui/screens';
import { openJournal, closeJournal, journalOpen, journalTab, type JournalHooks, type JournalTab } from './ui/journal';
import { openService, type ServiceHooks } from './ui/services';
import { BaseBuilder } from './ui/basebuild';
import type { TravelPoint } from './ui/minimap';
import { toast, titleCard, flash, clearFlash, modal, modalOpen, confirmBox, el } from './ui/dom';
import { renderSettings } from './ui/tabs/profile';
import { icon } from './ui/icons';
import { restoreSession, listLocalProfiles, cloudAvailable, logout, playAsGuest, AuthError, type Account } from './net/auth';
import { pullSave, pushSave, saveKeyFor } from './net/cloudsave';
import { runDebug } from './debug';
// v3:content — story director, NPC talk, shops, gates, exploration
import * as story from './game/story';
import { shopForService, setActiveShop, tradeCount, shopById } from './game/shop';
import { setWarpHandler, useBait } from './game/items';
import { zoneAt } from './data/zones';

export const game = {
  world: null as unknown as Overworld,
  hud: null as unknown as Hud,
  builder: null as unknown as BaseBuilder,
  battle: null as Battle | null,
  busy: false,
  started: false,
  account: null as unknown as Account,
};

/** Legendary Guardian Spirit hatched from the egg each Guardian leaves behind. */
// v3:content — the new lands' spirits (bellwyrm/tidesinger, elder_stag/sylvan_hart, geode_colossus/prism_wyrm;
// aether_sovereign is the Crown's final Guardian). Eggs only hatch when SPECIES has the id (checked below).
const SPIRITS: Record<string, string> = { vale: 'verdant_rex', lakes: 'deepcaller', coast: 'tidesinger', scar: 'ember_totem', marsh: 'mire_prince', elder: 'sylvan_hart', dunes: 'dune_titan', peaks: 'storm_seraph', hollows: 'prism_wyrm' };
const today = () => new Date().toISOString().slice(0, 10);
const params = new URLSearchParams(location.search);
const automated = params.has('auto') || params.has('view') || params.has('guest');

// ── Cloud sync (debounced; this device wins conflicts while playing) ────────
const sync = { status: 'Saved on this device', timer: 0, pending: '', lastPush: 0, quiet: false };
const savedAtKey = () => `${saveSlot()}-at`;
onSave((json) => {
  try { localStorage.setItem(savedAtKey(), String(Date.now())); } catch { /* storage full */ }
  if (game.account?.mode !== 'cloud' || sync.quiet) return;
  sync.pending = json;
  clearTimeout(sync.timer);
  sync.timer = window.setTimeout(() => void flushSync(), Math.max(8000, sync.lastPush + 45000 - Date.now()));
});
async function flushSync() {
  if (!sync.pending || game.account?.mode !== 'cloud') return;
  const json = sync.pending;
  sync.pending = '';
  sync.lastPush = Date.now();
  try {
    let r = await pushSave(json);
    if (!r.ok && 'conflict' in r) { await pullSave(); r = await pushSave(json); }
    if (r.ok) sync.status = `Synced at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    else { sync.status = 'Offline — will sync later'; sync.pending ||= json; }
  } catch (e) {
    sync.status = e instanceof AuthError && e.code === 'unauthorized' ? 'Session ended — sign in again to sync' : 'Sync paused';
  }
}
async function reconcileCloud() {
  if (game.account.mode !== 'cloud') { sync.status = game.account.mode === 'guest' ? 'Guest — saved on this device only' : 'Saved on this device'; return; }
  try {
    const remote = await pullSave();
    const localAt = Number(localStorage.getItem(savedAtKey()) ?? 0);
    if (remote && (!state.started || remote.updatedAt > localAt)) {
      sync.quiet = true;
      importSave(remote.data);
      sync.quiet = false;
      sync.status = 'Synced';
    } else if (state.started) {
      const r = await pushSave(exportSave());
      sync.status = r.ok ? 'Synced' : 'Offline — will sync later';
    } else sync.status = 'Synced';
  } catch { sync.status = 'Offline — will sync later'; }
}

// ── Hooks handed to UI modules ──────────────────────────────────────────────
let installEvt: (Event & { prompt(): Promise<void> }) | null = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e as typeof installEvt; });

const journalHooks: JournalHooks = {
  evolve: (c, target, stone) => doEvolve(c, target, stone),
  isNight: () => game.world.isNight,
  ride: (c) => { state.mountUid = c.uid; save(); closeJournal(); toggleMount(true); },
  minimap: () => game.hud.minimap,
  travelBlock: () => (game.battle ? 'You can’t travel during a battle.' : game.builder.active ? 'Leave build mode first.' : null),
  travel: (p) => void fastTravel(p),
  account: () => ({ mode: game.account.mode, name: game.account.username, sync: sync.status }),
  logout: async () => {
    if (!(await confirmBox('Sign out?', game.account.mode === 'guest' ? 'Guest progress stays on this device — sign in as guest again to continue it.' : 'Your journey is saved to your account.', 'Sign out'))) return;
    state.pos = [game.world.playerPos.x, game.world.playerPos.z];
    save();
    await flushSync();
    await logout();
    location.reload();
  },
  upgradeAccount: async () => {
    closeJournal();
    const json = exportSave();
    const acct = await screens.authScreen({ cloud: await cloudAvailable(), profiles: [], mode: 'signup', cancellable: true });
    if (!acct) return;
    const key = saveKeyFor(acct);
    let empty = !localStorage.getItem(key);
    if (empty && acct.mode === 'cloud') { try { empty = !(await pullSave()); } catch { empty = false; } }
    if (empty) localStorage.setItem(key, json);
    toast(empty ? 'Your journey now lives in your new account!' : 'Signed in — loading that account’s journey.', 'good');
    setTimeout(() => location.reload(), 900);
  },
  canInstall: () => !!installEvt,
  install: async () => { await installEvt?.prompt(); installEvt = null; },
  reset: () => { resetSave(); save(); location.reload(); },
};

const serviceHooks: ServiceHooks = {
  openJournal: (tab) => journal(tab),
  isNight: () => game.world.isNight,
  restUntil: (t) => { if (t < state.time) state.day++; state.time = t; },
};

// ── v3:content — the story layer's window into UI, battles and the world ──────
const storyHost: story.StoryHost = {
  dialog: (d) => screens.dialog(d),
  chooseStarter: () => screens.chooseStarter(),
  battleTamer: (b) => storyBattle(b),
  openShop: (id) => openShopById(id),
  toast: (text, kind, ms) => toast(text, kind ?? '', ms),
  titleCard: (title, sub, ms) => titleCard(title, sub, ms),
  setBusy: (b) => { game.busy = b; },
  isFree: () => game.started && !game.busy && !game.battle && !game.builder.active && !journalOpen() && !modalOpen() && !document.querySelector('.dialog-box, .starter-screen, .cine, .fishing, .summon-fx'),
  get cine() { return game.world.content.cine; },
};

/** Story tamer fights (Kai, the Hollow Veil) through the normal tamer battle flow. */
async function storyBattle(b: story.TamerBattle): Promise<story.BattleResult> {
  const w = game.world;
  const prevBusy = game.busy;
  const enemies = b.team.filter((m) => SPECIES[m.species]).map((m) => createCreature(m.species, m.level, m.weak ? { genes: { hp: 0, atk: 0, def: 0, spd: 0 } } : {}));
  if (!enemies.length) return 'win';
  const dir = new THREE.Vector3(-Math.sin(w.camYaw), 0, -Math.cos(w.camYaw));
  if (dir.lengthSq() < 0.01) dir.set(0, 0, -1);
  dir.normalize();
  const gold = state.inv.gold;
  const zone = ZONES.find((z) => z.id === b.zone) ?? w.zone;
  const out = await runBattle({ kind: 'tamer', enemies, zone, center: safeCenter(w.playerPos.clone(), dir, 5), forward: dir, advantage: null, tamer: { name: b.name, title: b.title, intro: b.intro } });
  if (b.forgiving && out === 'lose') state.inv.gold = gold;
  game.busy = prevBusy;
  return out;
}

/** Open a shop by id. Until the UI renders ShopApi, the Outfitter screen stands in (it reads activeShop()). */
async function openShopById(id: string) {
  const shop = shopById(id);
  const zone = ZONES.find((z) => z.id === (shop?.kind === 'merchant' ? game.world.zone.id : shop?.region)) ?? game.world.zone;
  const trades = tradeCount();
  const gold = state.inv.gold;
  setActiveShop(id);
  const prevBusy = game.busy;
  game.busy = true;
  sfx('open');
  await openService('shop', zone, serviceHooks);
  game.busy = prevBusy;
  setActiveShop(null);
  // purchases made through the legacy Outfitter screen still count for quests
  if (tradeCount() === trades && state.inv.gold < gold) emit('buy', { shop: id, item: 'goods', qty: 1, cost: gold - state.inv.gold });
  save();
}

// ── Boot ────────────────────────────────────────────────────────────────────
async function boot() {
  document.getElementById('app')!.appendChild(renderer.domElement);
  document.querySelector('#rotate button')?.addEventListener('click', () => document.getElementById('rotate')!.classList.add('dismissed'));
  input.init(renderer.domElement, document.getElementById('joy')!, document.getElementById('knob')!);
  applyAudio();
  onSettings((s, changed) => {
    applyAudio();
    if (changed.includes('cameraDistance') && game.world) game.world.camDist = s.cameraDistance;
  });
  screens.loading('Waking up…', 0.02);
  const manifestP = loadManifest();

  // account → save slot
  let account = await restoreSession().catch(() => null);
  if (!account) {
    if (automated) account = await playAsGuest();
    else {
      const [cloud] = await Promise.all([cloudAvailable(), manifestP]);
      account = (await screens.authScreen({ cloud, profiles: listLocalProfiles() }))!;
    }
  }
  game.account = account;
  useSaveSlot(saveKeyFor(account));
  screens.loading(`Welcome, ${account.username}…`, 0.05);
  await manifestP;
  await Promise.race([reconcileCloud(), new Promise((r) => setTimeout(r, 6000))]);
  setNotifier((text, kind) => { toast(text, kind ?? 'quest', 3600); if (kind === 'rank') { sfx('levelup'); haptic('success'); } else if (kind === 'quest') sfx('quest'); });
  initProgress();
  story.initContent(storyHost); // v3:content
  setWarpHandler(async () => { // v3:content — Escape Shard: home to the last town you rested in
    if (game.battle || !game.started) return false;
    const [x, z] = state.respawn;
    await fastTravel({ id: 'escape', label: 'Escape Shard', kind: 'town', x, z, zone: zoneAt(x, z).id });
    return true;
  });

  // assets (only what the first frame needs; the rest streams afterwards)
  await ensureModels(essentialModels(), (d, t) => screens.loading('Gathering supplies…', 0.06 + (d / Math.max(1, t)) * 0.46));
  await ensureCreatures([...new Set(state.team.map((c) => c.species))]);
  screens.loading('Unpacking textures…', 0.54);
  await preloadTextures();

  const world = new Overworld();
  game.world = world;
  let stage = 0;
  const seen = new Set<string>();
  await world.build((m, f) => { if (!seen.has(m)) { seen.add(m); stage++; } screens.loading(m, Math.min(0.97, 0.56 + stage * 0.06 + (f ?? 0) * 0.05)); });
  game.hud = new Hud(world);
  game.hud.show(false);
  game.hud.onButton = (b) => {
    if (game.battle || game.busy || !game.started) return;
    if (b === 'mount') return toggleMount();
    if (b === 'menu') return void pauseMenu();
    if (b === 'build') return game.builder.enter();
    void journal(b === 'journal' ? lastTab : b);
  };
  game.builder = new BaseBuilder({ world, openJournal: (tab) => journal(tab), changed: () => save() });
  world.onZoneEnter = (z) => { titleCard(z.name, z.subtitle); updateMusic(); };
  world.onDiscover = (label) => { toast(`${icon('waypoint_obelisk')} ${label}`, 'good', 3200); sfx('levelup'); haptic('light'); save(); };
  world.onDoubleJump = () => { sfx('dodge', 0.5); haptic('light'); };
  world.refreshBosses();
  governor.onChange = onResize;
  addEventListener('resize', onResize);
  onResize();
  screens.loading('Lighting the lanterns…', 0.99);
  world.update(0.016, 0, true);
  world.render(0.016);
  screens.hideLoading();
  requestAnimationFrame(frame);

  if (await runDebug(game, { startBattle: startWildBattle, startBoss: startBossBattle, begin, journal, service: (svc) => openService(svc, game.world.zone, serviceHooks), openShop: (id) => openShopById(id) })) return;

  for (;;) {
    const hasSave = state.started && state.team.length > 0;
    const choice = await screens.mainMenu({ account, hasSave });
    preloadSfx();
    music('town');
    if (choice === 'guide') { await screens.guide(input.isTouch); continue; }
    if (choice === 'settings') { await settingsModal(); continue; }
    if (choice === 'switch') { save(); await flushSync(); await logout(); location.reload(); return; }
    if (choice === 'new' && hasSave && !(await confirmBox('Start a new journey?', 'Your current journey on this account will be erased. This cannot be undone.', 'Start over', true))) continue;
    await begin(choice === 'new');
    break;
  }
}

function applyAudio() {
  setMusicVolume(settings.musicVolume * settings.masterVolume * 0.8);
  setSfxVolume(settings.sfxVolume * settings.masterVolume * 0.8);
}

function settingsModal() {
  return modal('settings-modal', (b) => {
    b.innerHTML = `<h2>${icon('gear_settings')} Settings</h2>`;
    const host = el('div', 'jr-page');
    b.appendChild(host);
    renderSettings(host, journalHooks);
  });
}

async function begin(fresh: boolean, starterOverride?: string) {
  const w = game.world;
  if (fresh && !starterOverride) { // v3:content — a new journey starts empty-handed with the onboarding director
    story.newGameState();
    lastSteps = 0;
    w.refreshBosses();
    w.homestead.sync();
    w.titleMode = false;
    game.started = true;
    updateMusic();
    await story.playPrologue(storyHost);
    lastSteps = state.steps;
    game.hud.show(true);
    if (!automated) { game.busy = true; await screens.dailyLogin(); game.busy = false; }
    streamRemainingCreatures();
    return;
  }
  if (fresh) {
    resetSave();
    lastSteps = 0;
    const pickRes = starterOverride ? { starter: starterOverride, name: 'Wayfarer' } : await screens.chooseStarter();
    const c = createCreature(pickRes.starter, 5, { caught: { how: 'starter', at: Date.now(), zone: 'vale' } });
    state.profile.name = pickRes.name;
    addCreature(c);
    state.started = true;
    story.skipPrologue(pickRes.starter); // v3:content — tests/debug skip the onboarding
    const sp = TOWN_SPAWN.vale;
    state.pos = sp ? [sp.x, sp.z] : [...START_POS];
    state.respawn = [...state.pos];
    syncQuests();
    save();
    w.teleport(state.pos[0], state.pos[1]);
    w.refreshBosses();
    w.homestead.sync();
  } else {
    w.teleport(state.pos[0], state.pos[1]);
    w.homestead.sync();
  }
  lastSteps = state.steps;
  w.titleMode = false;
  w.camYaw = fresh && TOWN_SPAWN.vale ? TOWN_SPAWN.vale.yaw : Math.PI;
  w.snapCamera();
  game.hud.show(true);
  game.started = true;
  titleCard(w.zone.name, w.zone.subtitle);
  updateMusic();
  if (fresh && !starterOverride) {
    game.busy = true;
    await screens.guide(input.isTouch);
    game.busy = false;
    toast(input.isTouch ? 'Tip: walk through <b>tall grass</b> or tap <b>Strike</b> near a wild Mystic.' : 'Tip: walk through <b>tall grass</b> or press <kbd>F</kbd> near a wild Mystic.', '', 5200);
  }
  if (!automated) { game.busy = true; await screens.dailyLogin(); game.busy = false; }
  if (!fresh) await story.resumeStory(storyHost); // v3:content — a save that stopped mid-prologue
  streamRemainingCreatures();
}

function onResize() {
  renderer.setSize(innerWidth, innerHeight);
  game.world?.resize(innerWidth, innerHeight);
}

// ── Main loop ───────────────────────────────────────────────────────────────
let lastSteps = state.steps;
let t = 0;
let lastT = performance.now();
let musicCheck = 0;
let autosave = 0;
let lastTab: JournalTab = 'team';

let frozenFor = 0;
function frame(now: number) {
  requestAnimationFrame(frame);
  const elapsed = now - lastT;
  if (settings.fpsCap && elapsed < 1000 / settings.fpsCap - 1.5) return;
  lastT = now;
  // Full-screen menus hide the world: keep the last frame on screen and skip simulation + rendering (battery/GPU).
  const covered = !game.battle && game.started && (journalOpen() || modalOpen() || !!document.querySelector('.cine, .summon-fx'));
  frozenFor = covered ? frozenFor + 1 : 0;
  if (frozenFor > 2) { input.endFrame(); return; }
  governor.update(elapsed);
  const dt = Math.min(0.05, elapsed / 1000);
  t += dt;
  input.update();
  const w = game.world;
  const overlay = journalOpen() || modalOpen() || !!document.querySelector('.dialog-box, .fishing, .cine, .summon-fx, .auth-screen, .main-menu, .starter-screen');
  const paused = game.busy || overlay || !!game.battle || !game.started;
  if (game.started && !paused && !game.builder.active) hotkeys();

  tweens.update(dt);
  game.battle?.update(dt);
  const ev = w.update(dt, t, paused);
  if (game.builder.active) game.builder.update();
  const hudOn = game.started && !game.battle && !game.builder.active && !story.cinematicActive(); // v3:content
  if (hudOn === game.hud.root.classList.contains('hidden')) game.hud.show(hudOn);
  if (ev && !paused) void handleEvent(ev);

  if (game.started) {
    const delta = state.steps - lastSteps;
    lastSteps = state.steps;
    if (delta > 0 && state.eggs.length) {
      const k = itemCount('hatch_charm') > 0 ? 2 : 1;
      for (const e of state.eggs) e.stepsLeft -= delta * k;
    }
    const ready = state.eggs.find((e) => e.stepsLeft <= 0);
    if (ready && !paused) void hatchEgg(ready.uid);
    if (!game.battle) game.hud.update();
    musicCheck += dt;
    if (musicCheck > 1.5) { musicCheck = 0; updateMusic(); }
    autosave += dt;
    if (autosave > 30 && !game.battle) { autosave = 0; state.pos = [w.playerPos.x, w.playerPos.z]; save(); }
  }
  w.render(dt);
  input.endFrame();
}

function hotkeys() {
  const keys: [string, JournalTab][] = [['j', lastTab], ['t', 'team'], ['c', 'dex'], ['b', 'bag'], ['m', 'map'], ['g', 'summon'], ['q', 'quests']];
  for (const [k, tab] of keys) if (input.hit(k)) { void journal(tab); return; }
  if (input.hit('escape')) { void pauseMenu(); return; }
  if (input.hit('r')) toggleMount();
  if (input.hit('h') && nearHomestead()) game.builder.enter();
}

const nearHomestead = () => Math.hypot(game.world.playerPos.x - HOMESTEAD.center[0], game.world.playerPos.z - HOMESTEAD.center[1]) < HOMESTEAD.radius + 8;

function updateMusic() {
  if (game.battle || !game.started) return;
  const w = game.world;
  const p = w.playerPos;
  const inTown = ZONES.some((z) => Math.hypot(p.x - z.town.pos[0], p.z - z.town.pos[1]) < 48);
  const home = Math.hypot(p.x - HOMESTEAD.center[0], p.z - HOMESTEAD.center[1]) < HOMESTEAD.radius + 20;
  if (journalTab() === 'summon') { music('summon'); return; }
  const cands = inTown ? ['town'] : home ? ['homestead', 'town'] : w.isNight ? ['night', w.zone.music, 'overworld'] : [w.zone.music, 'overworld'];
  music(cands.find(hasTrack) ?? 'overworld');
}

async function journal(tab: JournalTab) {
  if (game.battle) return;
  lastTab = tab;
  emit('ui_open', { tab }); // v3:content
  await openJournal(tab, journalHooks);
  save();
}

function pauseMenu() {
  return modal('pause', (b, close) => {
    b.innerHTML = `<h2>Paused</h2><p class="muted">${state.profile.name} · Rank ${state.rank.level} · Day ${state.day} · ${sync.status}</p>
      <div class="pause-grid">
        <button class="btn primary big" data-a="resume">Resume <kbd>Esc</kbd></button>
        <button class="btn" data-a="journal">${icon('book')} Journal</button>
        <button class="btn" data-a="settings">${icon('gear_settings')} Settings</button>
        <button class="btn" data-a="guide">${icon('compass')} Field guide</button>
        <button class="btn" data-a="profile">${icon('user_profile')} Profile</button>
        <button class="btn ghost" data-a="title">Save &amp; quit to title</button>
      </div>`;
    b.querySelectorAll<HTMLElement>('[data-a]').forEach((x) => x.addEventListener('click', async () => {
      const a = x.dataset.a;
      close();
      if (a === 'journal') await journal(lastTab);
      if (a === 'settings') await journal('settings');
      if (a === 'profile') await journal('profile');
      if (a === 'guide') await screens.guide(input.isTouch);
      if (a === 'title') { state.pos = [game.world.playerPos.x, game.world.playerPos.z]; save(); await flushSync(); location.reload(); }
    }));
  });
}

function toggleMount(force = false) {
  const w = game.world;
  if (w.mount && !force) { w.dismount(); sfx('back'); return; }
  const all = [...state.team, ...state.box];
  const c = all.find((x) => x.uid === state.mountUid && SPECIES[x.species]?.rideable) ?? all.find((x) => SPECIES[x.species]?.rideable);
  if (!c) { toast('None of your Mystics can be ridden yet — look for the saddle mark in the Mystidex.', 'bad', 3600); return; }
  void ensureCreatures([c.species]).then(() => {
    w.mountUp(c.species, c.shiny);
    sfx('select');
    haptic('light');
    toast(`Riding <b>${displayName(c)}</b> — press <kbd>R</kbd> to dismount.`);
  });
}

async function fastTravel(p: TravelPoint) {
  if (game.battle) return;
  game.busy = true;
  sfx('open');
  await flash('fade', 600);
  game.world.dismount();
  const ts = p.kind === 'town' ? TOWN_SPAWN[p.zone] : undefined;
  const [ox, oz] = p.kind === 'homestead' ? [0, 0] : [3, 3];
  if (ts) { game.world.teleport(ts.x, ts.z); game.world.camYaw = ts.yaw; game.world.snapCamera(); }
  else game.world.teleport(p.x + ox, p.z + oz);
  state.pos = [game.world.playerPos.x, game.world.playerPos.z];
  emit('travel', { id: p.id });
  save();
  await new Promise((r) => setTimeout(r, 300));
  clearFlash();
  titleCard(p.label, game.world.zone.name, 2400);
  updateMusic();
  game.busy = false;
}

// ── World events ────────────────────────────────────────────────────────────
async function handleEvent(ev: WorldEvent) {
  if (ev.type === 'wild') {
    if (!story.encountersAllowed(ev.advantage ? 'strike' : 'wild')) return; // v3:content
    const wd = ev.wild;
    await startWildBattle([{ species: wd.species, level: wd.level, shiny: wd.shiny }], ev.advantage ? 'player' : wd.state === 'chase' ? 'enemy' : null, wd);
  } else if (ev.type === 'grass') {
    if (!story.encountersAllowed('grass')) return; // v3:content
    const pool = spawnsBy(ev.zone, game.world.isNight ? ['grass', 'night'] : ['grass']);
    const extra = ev.zone.id !== 'vale' && pool.length && Math.random() < 0.22 ? [{ species: weighted(pool).species, level: randInt(ev.zone.levels[0], ev.zone.levels[1]), shiny: shinyRoll() }] : [];
    toast(`${icon('plant')} Something rustles in the grass…`, '', 1200);
    await startWildBattle([{ species: ev.species, level: ev.level, shiny: ev.shiny }, ...extra], null, null, 'grass');
  } else if (ev.type === 'interact') {
    await interact(ev.target);
  }
}

async function interact(it: Interactable) {
  const w = game.world;
  w.player.play('interact');
  switch (it.kind) {
    case 'service':
      if (!it.service) return;
      emit('use_service', { service: it.service, zone: it.zone.id }); // v3:content
      if (it.service === 'shop') { await openShopById(shopForService(it.zone.id)); return; } // v3:content
      game.busy = true;
      sfx('open');
      await openService(it.service, it.zone, serviceHooks);
      game.busy = false;
      save();
      return;
    case 'camp': {
      game.busy = true;
      await flash('fade', 700);
      healAll();
      state.respawn = [...it.zone.camp];
      const id = `${it.zone.id}-camp`;
      const isNew = !state.waypoints.includes(id);
      if (isNew) state.waypoints.push(id);
      save();
      sfx('heal');
      clearFlash();
      toast(`You rest by the fire. <b>Team restored · progress saved.</b>${isNew ? ' Flag added to your map.' : ''}`, 'good', 3600);
      game.busy = false;
      return;
    }
    case 'boss': {
      const sp = SPECIES[it.zone.boss.species];
      const lead = Math.max(...state.team.map((c) => c.level));
      game.busy = true;
      const ok = await confirmBox(`Challenge ${sp?.name ?? 'the Guardian'}?`, `Guardian of ${it.zone.name} · Lv ${it.zone.boss.level}. ${lead < it.zone.boss.level - 3 ? '<b class="warn">Your team may be under-levelled.</b> ' : ''}Guardian battles can’t be fled.`, 'Challenge');
      game.busy = false;
      if (ok) await startBossBattle(it.zone);
      return;
    }
    case 'search': return search(it);
    case 'waystone': return void journal('map');
    case 'gather': return it.data === 'fish' ? fish(it) : gather(it);
    case 'tamer': return tamer(it);
    case 'homestead':
      game.busy = true;
      if (it.id === 'homestead') await game.builder.openOverview(); else await game.builder.openStructure(it.id);
      game.busy = false;
      return;
    case 'npc':
      if (it.data && (await story.talk(it.data))) return; // v3:content — named NPCs + gate wardens
      game.busy = true;
      await screens.dialog({ name: it.label, lines: [pick(NPC_LINES)] });
      game.busy = false;
  }
}

const NPC_LINES = [
  'They say shiny Mystics shimmer even in daylight. I’ve seen one — once.',
  'The Guardians aren’t evil. They’re just… very, very protective.',
  'Waystones remember everyone who touches them. Handy for getting home!',
  'Some Mystics only come out after dark. Bring a lantern.',
  'My cousin rode a Mystic all the way to the Dunes. Took a day. Walking takes three.',
];

function gather(it: Interactable) {
  const type = it.data as MaterialId;
  if (!MATERIALS[type]) return;
  const n = type === 'crystal' ? randInt(1, 2) : type === 'ore' ? randInt(2, 3) : randInt(3, 5);
  state.inv.materials[type] += n;
  state.gathered[it.id] = Date.now() + 4 * 60_000;
  game.world.player.play('gather');
  emit('gather', { material: type, n });
  sfx('coin');
  haptic('light');
  toast(`+${n} <b>${MATERIALS[type].name}</b>`, 'loot', 1800);
  save();
}

async function search(it: Interactable) {
  const zone = it.zone;
  game.world.landmarks.consumeSearch(it.id);
  emit('search', { zone: zone.id });
  sfx('step');
  const pool = spawnsBy(zone, game.world.isNight ? ['search', 'night'] : ['search']);
  const r = Math.random();
  if (r < 0.5 && pool.length) {
    const sp = weighted(pool).species;
    toast(`A hidden <b>${SPECIES[sp]?.name ?? 'Mystic'}</b> leapt out!`, '', 1600);
    await startWildBattle([{ species: sp, level: Math.min(zone.levels[1] + 1, randInt(zone.levels[0] + 1, zone.levels[1] + 1)), shiny: shinyRoll(2) }], null, null, 'search');
    return;
  }
  if (r < 0.9) {
    const roll = Math.random();
    if (roll < 0.25) { state.inv.orbs.mystic += 2; toast('Found <b>2 Mystic Orbs</b>!', 'loot'); }
    else if (roll < 0.4) { state.inv.orbs.radiant += 1; toast('Found a <b>Radiant Orb</b>!', 'loot'); }
    else if (roll < 0.58) { const it2: ItemId = pick(['tonic', 'ether', 'cleanse', 'mega_tonic']); state.inv.items[it2] = (state.inv.items[it2] ?? 0) + 1; toast(`Found a <b>${it2.replace('_', ' ')}</b>!`, 'loot'); }
    else if (roll < 0.78) { const g = randInt(40, 120); state.inv.gold += g; toast(`Found <b>${g} gold</b>!`, 'loot'); sfx('coin'); }
    else if (roll < 0.95) {
      const e = pick(zone.spawns.map((s) => SPECIES[s.species]?.element).filter(Boolean));
      state.inv.elementum[e] += 2;
      toast(`Found <b>2 ${ELEMENTS[e].name} Elementum</b>!`, 'loot');
    } else { state.inv.aether += 25; toast('Found <b>25 Aether</b>!', 'loot'); }
    sfx('captured');
    save();
    return;
  }
  toast('Only rustling leaves…');
}

async function fish(it: Interactable) {
  const zone = it.zone;
  game.world.landmarks.consumeFishing(it.id);
  game.busy = true;
  const ok = await screens.fishing();
  game.busy = false;
  if (!ok) return;
  const pool = spawnsBy(zone, ['fish']);
  const bait = useBait(); // v3:content — bait + Tide Charm
  if (pool.length && Math.random() < 0.65 + bait) {
    toast('Something big is on the line!', '', 1500);
    await startWildBattle([{ species: weighted(pool).species, level: randInt(zone.levels[0], zone.levels[1] + 1), shiny: shinyRoll() }], 'player', null, 'fish');
    return;
  }
  const roll = Math.random();
  if (roll < 0.4) { const g = randInt(50, 160); state.inv.gold += g; toast(`You fished up a pouch with <b>${g} gold</b>!`, 'loot'); }
  else if (roll < 0.7) { state.inv.items.tonic = (state.inv.items.tonic ?? 0) + 2; toast('You fished up <b>2 Tonics</b>!', 'loot'); }
  else if (roll < 0.9) { state.inv.elementum.water += 3; toast('You fished up <b>3 Water Elementum</b>!', 'loot'); }
  else { state.inv.orbs.tide += 1; toast('You fished up a <b>Tide Orb</b>!', 'loot'); }
  save();
}

async function tamer(it: Interactable) {
  const def = TAMERS.find((x) => x.id === it.data);
  if (!def) return;
  const team = def.team.filter(([sp]) => SPECIES[sp]);
  if (!team.length) return;
  const face = team[0][0];
  const talk = (lines: string[], choices?: string[]) => screens.dialog({ name: def.name, title: def.title, face, lines, choices });
  game.busy = true;
  if (state.tamers[def.id] === today()) {
    await talk(['Good battle today! Come back tomorrow for a rematch.']);
    game.busy = false;
    return;
  }
  const first = !state.tamers[def.id];
  const top = Math.max(...team.map(([, lv]) => lv)) + (first ? 0 : 2);
  const c = await talk([def.intro, `${first ? '' : 'Rematch! '}${team.length} Mystic${team.length > 1 ? 's' : ''} · up to Lv ${top}. Ready?`], ['Battle!', 'Not now']);
  game.busy = false;
  if (c !== 0) return;
  if (!state.team.some((x) => x.hp > 0)) { toast('Your team needs rest first.', 'bad'); return; }
  const w = game.world;
  const dir = new THREE.Vector3(it.pos.x - w.playerPos.x, 0, it.pos.z - w.playerPos.z);
  if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
  dir.normalize();
  const enemies = team.map(([sp, lv]) => createCreature(sp, first ? lv : lv + 2));
  const out = await runBattle({ kind: 'tamer', enemies, zone: it.zone, center: safeCenter(w.playerPos.clone(), dir, 5), forward: dir, advantage: null, tamer: { name: def.name, title: def.title, intro: def.intro } });
  game.busy = true;
  if (out === 'win') {
    state.tamers[def.id] = today();
    const reward = first ? def.reward : { gold: Math.round((def.reward.gold ?? 300) * 0.5), aether: 20 };
    applyReward(reward);
    emit('tamer_win', { id: def.id });
    save();
    await talk([def.win, `Take this — ${rewardText(reward)}.`]);
  } else if (out === 'lose') {
    await talk([def.lose]);
  }
  game.busy = false;
}

// ── Battles ─────────────────────────────────────────────────────────────────
/** Pick the flattest dry spot near the encounter so both sides stand on level ground. */
function safeCenter(from: THREE.Vector3, dir: THREE.Vector3, dist: number) {
  const w = game.world;
  const right = new THREE.Vector3(dir.z, 0, -dir.x);
  let best = from.clone().addScaledVector(dir, dist), bestScore = Infinity;
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

async function startWildBattle(list: { species: string; level: number; shiny: boolean }[], advantage: BattleSetup['advantage'], wild: Wild | null, how = 'wild') {
  const w = game.world;
  w.dismount();
  const p = w.playerPos.clone();
  let dir: THREE.Vector3;
  if (wild) dir = wild.pos.clone().sub(p).setY(0);
  else dir = new THREE.Vector3(-Math.sin(w.camYaw), 0, -Math.cos(w.camYaw));
  if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
  dir.normalize();
  const center = safeCenter(p, dir, 5.5);
  const enemies = list.filter((e) => SPECIES[e.species]).map((e) => createCreature(e.species, e.level, { shiny: e.shiny, caught: { how: how as NonNullable<Creature['caught']>['how'], zone: w.zone.id, at: Date.now() } }));
  if (!enemies.length) return;
  const out = await runBattle({ kind: 'wild', enemies, zone: w.zone, center, forward: dir, advantage, how });
  if (wild) {
    if (out === 'fled') wild.cooldown = 6;
    else w.wilds.remove(wild.id);
  }
}

async function startBossBattle(zone: Zone) {
  const w = game.world;
  w.dismount();
  const [bx, bz] = zone.boss.pos;
  const center = new THREE.Vector3(bx, w.data.heightAt(bx, bz), bz);
  const dir = new THREE.Vector3(bx - zone.camp[0], 0, bz - zone.camp[1]).normalize();
  const boss = createCreature(zone.boss.species, zone.boss.level);
  const adds = zone.boss.adds.filter((a) => SPECIES[a]).map((a) => createCreature(a, Math.max(2, zone.boss.level - 2)));
  const start = center.clone().addScaledVector(dir, -14);
  w.playerPos.set(start.x, w.data.heightAt(start.x, start.z), start.z);
  const out = await runBattle({ kind: 'boss', enemies: [boss, ...adds], zone, center: center.clone().addScaledVector(dir, -3), forward: dir, advantage: null });
  if (out !== 'win' && out !== 'captured') return;
  state.bosses.push(zone.id);
  applyReward({ orbs: { radiant: 3 }, items: { elixir: 1, mega_tonic: 2 }, aether: 300 });
  const spirit = SPIRITS[zone.id];
  if (spirit && SPECIES[spirit]) {
    state.eggs.push({ uid: newUid(), species: spirit, genes: { hp: randInt(10, 15), atk: randInt(10, 15), def: randInt(10, 15), spd: randInt(10, 15) }, parents: ['?', '?'], stepsLeft: 600, stepsTotal: 600, shinyBoost: 2 });
  }
  emit('boss_win', { zone: zone.id });
  w.refreshBosses();
  save();
  titleCard('Guardian Defeated', `${zone.name} is at peace`, 3600);
  toast(`The Guardian left a <b>Spirit Egg</b>! Also received 3 Radiant Orbs, 2 Mega Tonics, an Elixir and 300 Aether.`, 'loot', 5600);
  if (state.bosses.length === ZONES.length) setTimeout(() => titleCard('The Wilds Are Calm', 'Every Guardian has been answered. Your legend continues.', 6000), 3800);
}

async function runBattle(setup: BattleSetup): Promise<'win' | 'lose' | 'fled' | 'captured'> {
  const w = game.world;
  game.busy = true;
  closeJournal();
  sfx('encounter');
  haptic('medium');
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
    const lost = Math.floor(state.inv.gold * 0.1);
    state.inv.gold -= lost;
    healAll();
    w.teleport(state.respawn[0], state.respawn[1]);
    toast(`You wake by a warm hearth${lost ? ` (dropped ${lost} gold)` : ''}. Your team has been restored.`, 'bad', 4200);
  }
  w.player.root.position.copy(w.playerPos);
  w.refreshBosses();
  w.snapCamera();
  game.hud.show(true);
  clearFlash();
  for (const c of out.evolvable) {
    const e = evolutionFor(c, w.isNight);
    if (e) await doEvolve(c, e.id);
  }
  save();
  game.busy = false;
  updateMusic();
  return out.result;
}

async function doEvolve(c: Creature, target: string, stone = false) {
  if (!SPECIES[target]) return;
  const from = c.species;
  const prev = game.busy;
  game.busy = true;
  await ensureCreatures([target]);
  await screens.evolution(c, from, target);
  evolveTo(c, target);
  markCaught(target);
  emit('evolve', { from, to: target });
  save();
  toast(`${displayName(c)} evolved${stone ? ' with the stone’s power' : ''}!`, 'good');
  game.busy = prev;
}

async function hatchEgg(uid: string) {
  const i = state.eggs.findIndex((e) => e.uid === uid);
  if (i < 0) return;
  const egg = state.eggs[i];
  state.eggs.splice(i, 1);
  if (!SPECIES[egg.species]) { save(); return; }
  game.busy = true;
  const legendary = SPECIES[egg.species].rarity === 'legendary';
  const c = createCreature(egg.species, legendary ? 15 : 3, {
    genes: egg.genes, parents: egg.parents[0] === '?' ? undefined : egg.parents, shiny: shinyRoll(egg.shinyBoost ?? 1),
    caught: { how: 'egg', at: Date.now(), zone: game.world.zone.id },
  });
  if (egg.inheritSkill && !c.skills.some((s) => s.id === egg.inheritSkill)) {
    if (c.skills.length < 4) c.skills.push({ id: egg.inheritSkill, rank: 1 });
    else c.skills[c.skills.length - 1] = { id: egg.inheritSkill, rank: 1 };
  }
  await ensureCreatures([c.species]);
  await screens.hatch(c);
  const where = addCreature(c);
  emit('hatch', { species: c.species, shiny: c.shiny });
  toast(`${displayName(c)} ${where === 'team' ? 'joined your team' : 'was sent to storage'}!`, 'good');
  save();
  game.busy = false;
}

// Persist on backgrounding (mobile tab switches, app suspend).
document.addEventListener('visibilitychange', () => {
  if (!document.hidden || !game.started) return;
  state.pos = [game.world.playerPos.x, game.world.playerPos.z];
  save();
  void flushSync();
});

// Native shell (Capacitor): landscape lock, hidden status bar, haptics, Android back button, save on suspend.
async function nativeSetup() {
  if (!isNative) return;
  const [{ StatusBar }, { ScreenOrientation }, { App }, { SplashScreen }, { Haptics, ImpactStyle, NotificationType }] = await Promise.all([
    import('@capacitor/status-bar'), import('@capacitor/screen-orientation'), import('@capacitor/app'), import('@capacitor/splash-screen'), import('@capacitor/haptics'),
  ]);
  setNativeHaptics({
    impact: (o) => Haptics.impact({ style: o.style === 'HEAVY' ? ImpactStyle.Heavy : o.style === 'MEDIUM' ? ImpactStyle.Medium : ImpactStyle.Light }),
    notification: () => Haptics.notification({ type: NotificationType.Success }),
  });
  await StatusBar.hide().catch(() => undefined);
  await ScreenOrientation.lock({ orientation: 'landscape' }).catch(() => undefined);
  // Back = Escape: closes the top modal/journal/build mode, otherwise opens the pause menu.
  void App.addListener('backButton', () => { if (!game.battle) dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  void App.addListener('pause', () => { if (game.started) { state.pos = [game.world.playerPos.x, game.world.playerPos.z]; save(); void flushSync(); } });
  void SplashScreen.hide().catch(() => undefined);
}
void nativeSetup();

// Offline + instant reloads on the web build (native builds serve files locally).
if (import.meta.env.PROD && 'serviceWorker' in navigator && !isNative) {
  addEventListener('load', () => { void navigator.serviceWorker.register('sw.js').catch(() => { /* private mode etc. */ }); });
}

void boot();
