// Content workstream test: simulates the event stream through the prologue and Chapter 1 and checks
// quest progression, markers, gates, shops, exploration, the v2 save migration and the data.
//   npx tsx tools/test-quests.ts
import { state, importSave, addItem, itemCount } from '../src/game/state';
import { emit, on } from '../src/game/events';
import { api, EXPLORE_RES, type DialogSpec } from '../src/game/contracts';
import { initProgress, questById, availableSide, claimableCount } from '../src/game/progress';
import { initGates, gateOpen, regionUnlocked, lockHint } from '../src/game/gates';
import { initExplore, tick as exploreTick, markDungeonCleared, dungeonFound, chartedPercent } from '../src/game/explore';
import { initShops, shopTier } from '../src/game/shop';
import { tick as questTick, isActive, isDone, talkOptions, npcMark, npcStation, locate, offersFrom } from '../src/game/quests';
import { initStory, newGame, talk, encountersAllowed, type StoryHost, type TamerBattle } from '../src/game/story';
import { useFieldItem, battleItemEffect, useBait } from '../src/game/items';
import { ALL_QUESTS, MAIN_QUESTS, SIDE_QUESTS, BOUNTIES, DAILY_POOL, KAI_ARC, type Beat } from '../src/data/quests';
import { NPCS, npcById } from '../src/data/npcs';
import { SHOPS } from '../src/data/shops';
import { ITEMS } from '../src/data/items';
import { SPECIES } from '../src/data/species';
import { RELICS } from '../src/data/relics';
import { ZONES } from '../src/data/zones';
import { POIS, DUNGEONS, GATES } from '../src/data/layout';
import { TAMERS, STORY_TAMERS } from '../src/data/tamers';

// ── tiny harness ──────────────────────────────────────────────────────────────
let passed = 0;
const failures: string[] = [];
function ok(cond: unknown, msg: string) {
  if (cond) { passed++; return; }
  failures.push(msg);
  console.log(`  ✗ ${msg}`);
}
const section = (s: string) => console.log(`\n▸ ${s}`);
const near = (m: { x: number; z: number } | undefined, x: number, z: number, r = 40) => !!m && Math.hypot(m.x - x, m.z - z) < r;

// ── fake host (no DOM, no three.js) ─────────────────────────────────────────────
const said: string[] = [];
const battles: TamerBattle[] = [];
const toasts: string[] = [];
const titles: string[] = [];
let battleResult: 'win' | 'lose' = 'win';
let playerAt: [number, number] = [0, 612];
const host: StoryHost = {
  dialog: async (d: DialogSpec) => { said.push(`${d.name}: ${d.lines.join(' / ')}`); return 0; },
  chooseStarter: async () => ({ starter: 'emberling', name: 'Tess' }),
  battleTamer: async (b) => { battles.push(b); return battleResult; },
  openShop: async () => {},
  toast: (t) => { toasts.push(t); },
  titleCard: (t) => { titles.push(t); },
  setBusy: () => {},
  isFree: () => true,
  cine: {
    begin() {}, end() {}, placePlayer(x, z) { playerAt = [x, z]; }, playerPos: () => playerAt, stageNear: (x, z) => [x, z], frame() {},
    spawnNpc() {}, walkNpc: async () => {}, faceNpc() {}, gesture() {}, releaseNpc() {},
    showMystic: async () => {}, moveMystic: async () => {}, hideMystic() {}, wait: async () => {},
  },
};
const notes: string[] = [];
const { setNotifier } = await import('../src/game/rewards');
setNotifier((t) => notes.push(t));

const gateEvents: string[] = [];
on('gate_open', (e) => gateEvents.push(e.id));
const buys: string[] = [];
on('buy', (e) => buys.push(e.item));

initProgress();
initGates();
initExplore();
initShops();
initStory(host);

const walkTo = (x: number, z: number) => { exploreTick(x, z, 1); questTick(x, z, 1); };
const step = (id: string) => state.quests.active.find((q) => q.id === id)?.step;

// ═══════════════════════════════════════════════════════════════════════════
section('Prologue — Empty-handed');
ok(!encountersAllowed('grass'), 'no wild encounters before the prologue');
await newGame(host);
ok(state.team.length === 1 && state.team[0].species === 'emberling' && state.team[0].level === 5, 'starter Emberling (Lv 5) joined the team');
ok(state.profile.name === 'Tess', 'name from the starter screen');
ok(state.story.prologue === 'done', 'prologue finished');
ok(state.story.rival === 'finnik', 'Kai took the counter-pick (Finnik beats Emberling)');
ok(battles[0]?.id === 'kai' && battles[0].forgiving && battles[0].team[0].species === 'finnik' && battles[0].team[0].level < 5, 'first rival battle: winnable, forgiving');
ok(said.some((l) => l.includes('No Mystic? The wilds will eat you alive.')), 'Brisa’s opening line played');
ok(isDone('pro_empty_handed'), 'prologue quest done');
ok(isActive('ch1_first_steps'), 'First Steps started');
ok(state.quests.tracked === 'ch1_first_steps', 'main quest tracked by default');
ok(state.inv.orbs.mystic === 5, `Brisa handed over 5 Mystic Orbs (have ${state.inv.orbs.mystic})`);
ok(state.inv.gold === 100 && state.inv.aether === 0 && !itemCount('tonic'), 'empty-handed: 100 gold and nothing else');
ok(encountersAllowed('grass'), 'wild encounters allowed after the starter');
const tr0 = api.quests.tracked();
ok(tr0?.current?.text.includes('Whisperwind Meadow') && near(tr0?.target, 120, 700), 'tracker points at Whisperwind Meadow');
ok(tr0?.target?.beacon === true, 'tracked target has a beacon');

section('Chapter 1 — First Steps (tutorial)');
emit('catch', { species: 'gloop', shiny: false, zone: 'vale', how: 'wild', element: 'nature', night: false });
ok(step('ch1_first_steps') === 1, 'catch → heal step');
ok(api.quests.tracked()?.current?.text.includes('Healer'), 'tracker: rest at the Healer');
ok(near(api.quests.tracked()?.target, 0, 540), 'marker at Hearthwick (healer)');
emit('use_service', { service: 'healer', zone: 'vale' });
ok(step('ch1_first_steps') === 2, 'healer → buy step');
const locked = api.shops.buy('hearthwick_outfitter', 'orb:grand', 1);
ok(!locked.ok && /sigil/i.test(locked.msg), 'Grand Orbs locked until sigils');
const broke = api.shops.buy('hearthwick_outfitter', 'orb:radiant', 1);
ok(!broke.ok && /gold/i.test(broke.msg), 'not enough gold is refused');
const b1 = api.shops.buy('hearthwick_outfitter', 'tonic', 1);
ok(b1.ok && state.inv.gold === 55 && itemCount('tonic') === 1, `bought a Tonic (gold ${state.inv.gold})`);
ok(buys.includes('tonic'), 'buy event emitted');
ok(step('ch1_first_steps') === 3, 'buy → attune step');
emit('discover', { id: 'vale-ws0' });
ok(step('ch1_first_steps') === 4, 'waystone → map step');
emit('ui_open', { tab: 'map' });
ok(step('ch1_first_steps') === 5, 'map → report to Maple');
ok(npcMark('elder_maple') === '?', 'Maple shows a ? mark');
said.length = 0;
await talk('elder_maple', host);
ok(isDone('ch1_first_steps'), 'First Steps complete');
ok(state.inv.gold === 255 && itemCount('tonic') === 4, `First Steps reward (gold ${state.inv.gold}, tonics ${itemCount('tonic')})`);
ok(isActive('ch1_first_bond'), 'First Bond started');
ok(said.some((l) => l.includes('storm grows on the Crown')), 'Maple tells of the storm');
ok(state.story.features.includes('board') && state.story.features.includes('merchant'), 'board + merchant unlocked');

section('Chapter 1 — First Bond');
ok(near(api.quests.tracked()?.target, -170, 770), 'tracker points at the Old Grove');
walkTo(0, 700);
ok(step('ch1_first_bond') === 0, 'not there yet');
walkTo(-165, 765);
ok(step('ch1_first_bond') === 1, 'reached the Old Grove → Veil scout');
const st = npcStation('veil_nettle');
ok(typeof st === 'string' && st.startsWith('poi:p_oldgrove'), 'Nettle staged at the Grove');
ok(talkOptions('veil_nettle')[0]?.kind === 'battle', 'talking to Nettle starts a battle');
await talk('veil_nettle', host);
ok(battles.at(-1)?.id === 'veil_nettle', 'fought Veil Scout Nettle');
ok(step('ch1_first_bond') === 2 && itemCount('veil_mask') === 1, 'won → Veil mask, back to Maple');
ok(npcStation('veil_nettle') === null, 'Nettle leaves the stage');
await talk('elder_maple', host);
ok(step('ch1_first_bond') === 3 && itemCount('rootway_key') === 1 && itemCount('veil_mask') === 0, 'mask handed over, Rootway Key received');
ok(near(api.quests.tracked()?.target, -80, 610, 25), 'tracker points at Kai on Miller’s Rise');
const kaiBefore = state.story.kai;
await talk('rival_kai', host);
ok(state.story.kai === kaiBefore + 1 && battles.at(-1)?.id === 'kai', 'rival battle #2 with Kai');
ok(step('ch1_first_bond') === 4, 'Kai → Rootway Burrow');
ok(near(api.quests.tracked()?.target, -212, 740, 5), 'tracker points at the Burrow');
markDungeonCleared('d_vale');
ok(state.flags['dungeon_clear:d_vale'] === true && dungeonFound('d_vale'), 'dungeon flags set');
ok(step('ch1_first_bond') === 5, 'Burrow cleared → answer Thornjaw');
ok(near(api.quests.tracked()?.target, -150, 790, 5), 'tracker points at the Guardian arena');
ok(!gateOpen('g_vale_lakes') && !regionUnlocked('lakes'), 'Willowmere Pass sealed before the Guardian');
ok(/Thornjaw|Guardian/i.test(lockHint('lakes') ?? ''), `lakes lock hint: ${lockHint('lakes')}`);
state.bosses.push('vale');
emit('battle_win', { kind: 'boss', zone: 'vale' });
emit('boss_win', { zone: 'vale' });
ok(gateOpen('g_vale_lakes') && gateOpen('g_vale_coast'), 'both tier-2 gates open');
ok(gateEvents.includes('g_vale_lakes') && gateEvents.includes('g_vale_coast'), 'gate_open emitted for both');
ok(!gateOpen('g_crown') && !gateOpen('g_lakes_marsh'), 'other gates stay sealed');
ok(itemCount('sigil_vale') === 1, 'Verdant Sigil received');
ok(regionUnlocked('lakes') && regionUnlocked('coast') && !regionUnlocked('marsh'), 'lakes + coast reachable, marsh not');
ok(shopTier() === 1, 'shop tier 1 after the first sigil');
ok(step('ch1_first_bond') === 6, 'Guardian answered → return to Maple');
await talk('elder_maple', host);
ok(isDone('ch1_first_bond'), 'Chapter 1 complete');
ok(state.relics.some((r) => r.id === 'heart_of_oak'), 'relic reward');
ok(isActive('ch2_lakes') && isActive('ch3_coast'), 'Chapters 2 and 3 open (player chooses)');
ok(state.story.features.includes('bounties'), 'bounties unlocked');

section('Markers & quest log');
const qm = api.quests.markers();
ok(qm.some((m) => m.id === 'quest:ch2_lakes') && qm.some((m) => m.id === 'quest:ch3_coast'), 'both chapters have markers');
ok(qm.filter((m) => m.beacon).length === 1, 'exactly one beacon (the tracked quest)');
ok(qm.some((m) => m.kind === 'quest-available'), 'quest-available marks for givers');
api.quests.track('ch3_coast');
ok(api.quests.tracked()?.id === 'ch3_coast', 'track() switches the tracker');
const log = api.quests.list();
ok(log.some((v) => v.id === 'ch1_first_bond' && v.status === 'done'), 'log keeps finished quests');
ok(log.some((v) => v.status === 'available'), 'log shows known available quests');
ok(log.every((v) => v.status !== 'active' || !!v.target), 'every active quest has a target');
const v2 = api.quests.list().find((v) => v.id === 'ch2_lakes');
ok(v2?.chapter?.startsWith('Chapter 2') && (v2?.steps.length ?? 0) === 1, 'future steps hidden in the view');

section('Side quests, bounties, legacy board');
ok(npcMark('farmer_hask') === '!', 'Farmer Hask offers a quest (!)');
said.length = 0;
await talk('farmer_hask', host);
ok(isActive('side_vale_daisy'), 'accepted “Daisy Went Walking”');
ok(said.some((l) => l.includes('Daisy')), 'offer dialog played');
walkTo(-80, 610);
ok(step('side_vale_daisy') === 1, 'reached Miller’s Rise');
for (let i = 0; i < 2; i++) emit('defeat', { species: 'voltcat', zone: 'vale', element: 'storm' });
ok(state.quests.active.find((q) => q.id === 'side_vale_daisy')?.status === 'ready', 'Voltcats chased off → ready');
ok(npcMark('farmer_hask') === '?', 'Hask shows ? for the turn-in');
const goldBefore = state.inv.gold;
await talk('farmer_hask', host);
ok(isDone('side_vale_daisy') && state.inv.gold === goldBefore + 250, 'turned in: reward paid');
ok(availableSide('vale').some((q) => q.id === 'bounty_vale'), 'Vale board lists the Alpha bounty');
ok(questById('ch2_lakes')?.kind === 'story' && typeof questById('ch2_lakes')?.objective.count === 'number', 'legacy questById view');
ok(api.quests.list().some((v) => v.id === 'bounty_vale'), 'bounty is known in the log');
state.quests.active.push({ id: 'bounty_vale', progress: 0, step: 0, status: 'active', at: Date.now() });
emit('alpha_defeat' as never, { species: 'voltcat', zone: 'vale' } as never);
ok(state.quests.active.find((q) => q.id === 'bounty_vale')?.status === 'ready', 'alpha_defeat completes the bounty');
ok(api.quests.claim('bounty_vale') && isDone('bounty_vale'), 'bounty claimed from the log');
ok(claimableCount() >= 0, 'claimable count works');

section('Collect & deliver (Glowcap Soup)');
state.quests.active.push({ id: 'side_marsh_soup', progress: 0, step: 0, status: 'active', at: Date.now() });
for (let i = 0; i < 5; i++) emit('search', { zone: 'marsh' });
ok(itemCount('glowcap') === 5 && step('side_marsh_soup') === 1, 'searching the marsh dropped 5 Glowcaps');
await talk('nana_brine', host);
ok(itemCount('glowcap') === 0 && state.quests.active.find((q) => q.id === 'side_marsh_soup')?.status === 'ready', 'delivered to Nana Brine');

section('Shops');
const hv = api.shops.view('hearthwick_outfitter');
ok(hv.items.length > 15 && hv.categories.includes('Orbs'), 'Outfitter view');
ok(hv.items.find((i) => i.id === 'orb:sovereign')?.locked?.includes('sigil'), 'tier-locked item explains why');
const gold0 = state.inv.gold;
const s1 = api.shops.sell('hearthwick_outfitter', 'tonic', 1);
ok(s1.ok && state.inv.gold === gold0 + 22, `sold a Tonic (+22 gold)`);
ok(!api.shops.sell('hearthwick_outfitter', 'sigil_vale', 1).ok, 'key items can’t be sold');
ok(api.shops.view('hearthwick_outfitter').sellable.some((i) => i.id === 'tonic'), 'sellable list');
const pell = api.shops.view('merchant');
ok(pell.items.length === 4 && pell.items.some((i) => i.tag === 'Daily deal'), 'Pell has 4 rotating wares + a daily deal');
for (const s of SHOPS) ok(api.shops.view(s.id).items.length > 0 || s.kind === 'merchant', `${s.id} has stock`);
const regions = new Set(SHOPS.filter((s) => s.kind === 'outfitter').map((s) => s.region));
ok(regions.size === 9, 'an Outfitter in each of the 9 towns');
ok(SHOPS.filter((s) => s.kind === 'specialty').length === 9, 'a specialty shop per town');

section('Items');
ok(battleItemEffect('super_tonic')?.kind === 'heal' && battleItemEffect('phoenix_ash')?.kind === 'revive' && battleItemEffect('antidote')?.kind === 'cure', 'battle effects use supported kinds');
ok(battleItemEffect('escape_shard') === null, 'field-only items stay out of battle');
addItem('berry_treat', 1);
const lv = state.team[0].level, xp = state.team[0].xp;
const tr = await useFieldItem('berry_treat', state.team[0]);
ok(tr.ok && (state.team[0].xp > xp || state.team[0].level > lv), 'Berry Treat grants XP');
addItem('ward_incense', 1);
await useFieldItem('ward_incense');
ok(!encountersAllowed('grass') && encountersAllowed('strike'), 'Ward Incense blocks grass ambushes only');
state.buffs.ward = 0;
addItem('worm_bait', 1);
ok(useBait() > 0 && itemCount('worm_bait') === 0, 'bait is consumed when fishing');

section('Exploration & world progress');
const fog = api.world.explored();
ok(fog.length === EXPLORE_RES * EXPLORE_RES && fog.some((v) => v === 1), 'fog bitmap has explored cells');
ok(chartedPercent() > 0, `charted ${chartedPercent()}%`);
const rv = api.world.regions();
ok(rv.find((r) => r.id === 'vale')?.visited && rv.find((r) => r.id === 'lakes')?.unlocked && !rv.find((r) => r.id === 'marsh')?.unlocked, 'region views');
ok(!!rv.find((r) => r.id === 'marsh')?.lockHint, 'locked lands explain how to open them');
walkTo(-360, 429);
ok(state.explore.visited.includes('lakes'), 'entered the Lakes');
ok(api.world.markers().some((m) => m.kind === 'gate-open') && api.world.markers().some((m) => m.kind === 'gate'), 'open + sealed gates on the map');
const v0 = api.world.version();
walkTo(-430, 520);
ok(api.world.version() !== v0, 'version bumps as you explore');
ok(state.explore.pois.includes('p_mirror'), 'discovered The Mirror');
state.explore.fog = '';
const { save } = await import('../src/game/state');
save();
ok(state.explore.fog.length > 100, 'fog saved compactly (base64 bitset)');

section('Locations & staging');
for (const q of ALL_QUESTS) for (const s of q.steps) {
  for (const ref of [s.at, ...Object.values(s.stage ?? {})].filter(Boolean) as string[]) ok(!!locate(ref), `${q.id}: location ${ref} resolves`);
}
ok(!!locate('npc:warden_brisa') && !!locate('town:lakes@90:10'), 'NPC + offset refs resolve');

section('v2 save migration');
const v2save = {
  version: 2, started: true,
  profile: { name: 'Vet', title: 'Field Tamer', avatar: 'mage', createdAt: 1 },
  team: [{ uid: 'a', species: 'pyrowyrm', level: 22, xp: 0, hp: 50, genes: { hp: 1, atk: 1, def: 1, spd: 1 }, skills: [{ id: 'ember_bite', rank: 1 }], infusion: 0, shiny: false, nature: 'serene', ability: 'blaze', stars: 0, relics: [], caught: { how: 'starter', at: 1, zone: 'vale' } }],
  box: [], eggs: [],
  inv: { gold: 4321, aether: 99, tickets: 2, essence: 0, orbs: { mystic: 12, radiant: 3, dusk: 1, tide: 0, ember: 0, astral: 0 }, items: { tonic: 7, fire_stone: 1 }, elementum: {}, materials: { wood: 5, stone: 5, ore: 0, crystal: 0, fiber: 0 } },
  relics: [], dex: { gloop: { seen: true, caught: 1, shiny: false, zones: ['vale', 'lakes'] } },
  bosses: ['vale', 'lakes', 'scar'], pos: [10, 10], respawn: [0, 72], steps: 900, flags: { giftEgg: true },
  quests: { active: [{ id: 'story_4', progress: 0 }, { id: 'side_pest', progress: 3 }], done: ['story_1', 'story_2', 'story_3'], daily: { date: '2026-01-01', list: [{ id: 'd_win', progress: 2 }] } },
  base: { structures: [{ uid: 's1', type: 'mill', x: 90, z: 95, rot: 0, level: 1, lastCollect: 0, assigned: [] }] },
};
importSave(JSON.stringify(v2save));
ok(state.version === 3, 'save upgraded to v3');
ok(state.story.prologue === 'done', 'veterans skip the prologue');
ok(state.team.length === 1 && state.team[0].species === 'pyrowyrm' && state.inv.gold === 4321 && itemCount('tonic') === 7, 'team + inventory kept');
ok(state.inv.orbs.grand === 0 && state.inv.orbs.mystic === 12, 'new orb tiers added');
ok(state.story.rival === 'finnik', 'rival derived from the evolved starter');
ok(gateOpen('g_vale_lakes') && gateOpen('g_vale_coast') && gateOpen('g_lakes_marsh') && gateOpen('g_scar_dunes'), 'gates open for beaten Guardians');
ok(gateOpen('g_coast_scar'), 'gate into an already-beaten land opens too');
ok(!gateOpen('g_crown'), 'Crown Gate still needs nine sigils');
ok(regionUnlocked('scar') && regionUnlocked('dunes'), 'beaten lands reachable');
ok(isDone('ch1_first_bond') && isDone('ch2_lakes') && isDone('ch5_scar'), 'chapters done for beaten Guardians');
ok(!state.quests.active.some((q) => q.id === 'story_4' || q.id === 'side_pest'), 'retired v2 quests dropped');
ok(state.pos[1] > 500, 'position reset to Hearthwick');
ok(Math.abs(state.base.structures[0].x - 126) < 0.01 && Math.abs(state.base.structures[0].z - 615) < 0.01, 'homestead moved with the island');
ok(state.story.gatesSeen.includes('g_vale_lakes'), 'no replayed gate moments');

section('Data');
const text = (b: Beat[] | undefined) => (b ?? []).flatMap(([, ...lines]) => lines);
const allBeats: Beat[] = [];
for (const q of ALL_QUESTS) {
  allBeats.push(...(q.offer ?? []), ...(q.complete ?? []));
  for (const s of q.steps) allBeats.push(...(s.start ?? []), ...(s.progress ?? []), ...(s.done ?? []));
}
for (const a of KAI_ARC) allBeats.push(...a.before, ...a.win, ...a.lose);
const npcIds = new Set(NPCS.map((n) => n.id));
for (const [who, ...lines] of allBeats) {
  ok(npcIds.has(who) || who === 'player', `speaker ${who} exists`);
  ok(lines.length >= 1 && lines.length <= 3, `beat by ${who} has 1–3 lines`);
  for (const l of lines) ok(l.length <= 110, `line fits a phone (${l.length}): ${l.slice(0, 40)}…`);
}
ok(text(allBeats).length > 250, `script has ${text(allBeats).length} lines`);
for (const q of ALL_QUESTS) {
  if (q.giver) ok(npcIds.has(q.giver), `${q.id}: giver ${q.giver} exists`);
  for (const s of q.steps) {
    if (s.npc) ok(npcIds.has(s.npc), `${q.id}: step npc ${s.npc}`);
    if (s.item) ok(!!ITEMS[s.item], `${q.id}: item ${s.item}`);
    if (s.species) ok(!!SPECIES[s.species], `${q.id}: species ${s.species}`);
    if (s.type === 'battle' && s.tamer !== 'kai') ok(STORY_TAMERS.some((t) => t.id === s.tamer), `${q.id}: story tamer ${s.tamer}`);
    if ((s.type === 'clear' || s.type === 'dungeon') && s.id) ok(DUNGEONS.some((d) => d.id === s.id), `${q.id}: dungeon ${s.id}`);
    if (s.type === 'reach' && s.id) ok(POIS.some((p) => p.id === s.id), `${q.id}: poi ${s.id}`);
  }
  const r = q.reward;
  for (const k of Object.keys(r.items ?? {})) ok(!!ITEMS[k as keyof typeof ITEMS], `${q.id}: reward item ${k}`);
  if (r.relic) ok(!!RELICS[r.relic], `${q.id}: relic ${r.relic}`);
}
const towns = ZONES.filter((z) => z.id !== 'summit');
for (const z of towns) {
  const n = SIDE_QUESTS.filter((q) => q.region === z.id && q.giver && npcById(q.giver)).length;
  ok(n >= 3, `${z.town.name} has ${n} side quests with named givers`);
}
ok(SIDE_QUESTS.length >= 27, `${SIDE_QUESTS.length} side quests`);
ok(BOUNTIES.length >= 9 && DAILY_POOL.length >= 9, 'bounties + dailies');
ok(MAIN_QUESTS.some((q) => q.id === 'fin_crown') && MAIN_QUESTS.filter((q) => q.chapter?.startsWith('Chapter')).length >= 10, 'prologue, chapters 1–9, finale');
for (const z of ZONES.filter((zz) => zz.id !== 'vale' && zz.id !== 'summit')) ok(MAIN_QUESTS.some((q) => q.region === z.id && q.steps.some((s) => s.tamer === 'kai') && q.steps.some((s) => s.type === 'battle' && s.tamer !== 'kai') && q.steps.some((s) => s.type === 'guardian')), `${z.name}: leader, Veil, Kai and Guardian`);
for (const t of [...TAMERS, ...STORY_TAMERS]) for (const [sp] of t.team) ok(!!SPECIES[sp], `tamer ${t.id}: species ${sp}`);
for (const land of ['coast', 'elder', 'hollows', 'summit']) ok(TAMERS.filter((t) => t.zone === land).length >= 3, `${land} has roadside tamers`);
for (const s of SHOPS) for (const row of s.stock) ok(!!api.shops.view(s.id).items.find((i) => i.id === (row.good.startsWith('item:') ? row.good.slice(5) : row.good)), `${s.id}: ${row.good} resolves`);
ok(GATES.every((g) => g.sealedText.length > 0), 'gate texts');

// ── report ──────────────────────────────────────────────────────────────────
console.log(`\n${failures.length ? '✗' : '✓'} ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.slice(0, 40).map((f) => `  - ${f}`).join('\n')); process.exit(1); }
void toasts; void titles; void notes; void offersFrom;
