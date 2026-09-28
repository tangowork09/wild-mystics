// The story layer: the onboarding director (prologue), NPC conversations, story battles, gift
// giving, queued quest dialog, gate-opening moments and the rules that keep a new player safe
// (no wild encounters before the first Mystic, no leaving town mid-prologue).
//
// Pure game logic: every UI, world or battle call goes through the StoryHost that main.ts
// implements, so this module (and its tests) never touch the DOM or three.js.
import { STARTERS, SPECIES } from '../data/species';
import { START_POS } from '../data/zones';
import { ITEMS, type ItemId } from '../data/items';
import { npcById } from '../data/npcs';
import { COUNTER_PICK, KAI_ARC_STAGE, kaiTeam, tamerById } from '../data/tamers';
import { KAI_ARC, KAI_FINAL, questDef, type Beat, type StepDef } from '../data/quests';
import type { DialogSpec } from './contracts';
import { createCreature } from './creature';
import { state, save, resetSave, addCreature, addItem, itemCount, teamAlive } from './state';
import { emit, on } from './events';
import { applyReward, notify, rewardText } from './rewards';
import {
  accept, beginConversation, claim, endConversation, fillBeats, hasPendingBeats, isDone,
  startQuest, syncQuests, takePendingBeats, talkOptions, fill,
} from './quests';
import { gateById, gateOpen, sealText, initGates } from './gates';
import { initExplore } from './explore';
import { initShops } from './shop';
import { cloakWorn, wardActive } from './items';

// ── host ──────────────────────────────────────────────────────────────────────
export type BattleResult = 'win' | 'lose' | 'fled' | 'captured';
export interface TamerBattle {
  id: string;
  name: string;
  title: string;
  intro: string;
  team: { species: string; level: number; weak?: boolean }[];
  zone: string;
  /** No gold lost and no trip back to the healer when you lose (prologue). */
  forgiving?: boolean;
}

/** World staging for cutscenes (src/world/npcs.ts). All positions are world XZ. */
export interface CineHooks {
  begin(): void;
  end(): void;
  placePlayer(x: number, z: number, faceBearing: number): void;
  playerPos(): [number, number];
  /** A dry, open spot near (x, z) big enough for a small scene (the south gate in the v3 map). */
  stageNear(x: number, z: number): [number, number];
  /** Camera: frame these actors ('player', an NPC id or a mystic key), eased. */
  frame(subjects: string[], opts?: { side?: number; height?: number; dist?: number }): void;
  spawnNpc(id: string, x: number, z: number, faceBearing?: number): void;
  walkNpc(id: string, x: number, z: number, run?: boolean): Promise<void>;
  faceNpc(id: string, target: string): void;
  gesture(id: string, anim: 'victory' | 'cast'): void;
  releaseNpc(id: string): void;
  showMystic(key: string, species: string, x: number, z: number, faceBearing?: number): Promise<void>;
  moveMystic(key: string, x: number, z: number): Promise<void>;
  hideMystic(key: string): void;
  wait(ms: number): Promise<void>;
}

export interface StoryHost {
  dialog(spec: DialogSpec): Promise<number>;
  chooseStarter(): Promise<{ starter: string; name: string }>;
  battleTamer(b: TamerBattle): Promise<BattleResult>;
  openShop(shopId: string): Promise<void>;
  toast(text: string, kind?: string, ms?: number): void;
  titleCard(title: string, sub?: string, ms?: number): void;
  setBusy(b: boolean): void;
  /** True when no battle, menu or dialog is up and the game has started. */
  isFree(): boolean;
  cine: CineHooks;
}

let host: StoryHost | null = null;
export function setStoryHost(h: StoryHost) { host = h; }

// ── speakers & dialog ─────────────────────────────────────────────────────────
export function speaker(who: string): Pick<DialogSpec, 'name' | 'title' | 'face'> {
  if (who.startsWith('gate:')) {
    const g = gateById(who.slice(5));
    return { name: 'Gate Warden', title: g?.name, face: 'gate_warden' };
  }
  if (who === 'player') return { name: state.profile.name || 'Wayfarer' };
  const n = npcById(who);
  if (n) return { name: n.name, title: n.title, face: n.id };
  if (SPECIES[who]) return { name: SPECIES[who].name, face: who };
  return { name: who };
}

/** Play beats as dialog boxes. The last one may carry choices; returns the choice index. */
export async function play(h: StoryHost, beats: Beat[], choices?: string[]): Promise<number> {
  const list = fillBeats(beats);
  let pick = 0;
  for (let i = 0; i < list.length; i++) {
    const [who, ...lines] = list[i];
    if (!lines.length) continue;
    pick = await h.dialog({ ...speaker(who), lines, ...(i === list.length - 1 && choices ? { choices } : {}) });
  }
  return pick;
}

// ── the prologue script ───────────────────────────────────────────────────────
const PRO = {
  meet: [
    ['warden_brisa', 'Halt, traveller. Hearthwick’s south gate — state your business.', 'No pack. No Mystic. Not even a hat.'],
    ['warden_brisa', 'No Mystic? The wilds will eat you alive.', 'Lucky for you, I carry spares.'],
  ] as Beat[],
  starters: [
    ['warden_brisa', 'Three young ones from Elder Maple’s nursery. They’ve been waiting for someone.', 'Pick the one that looks back at you.'],
  ] as Beat[],
  picked: [
    ['warden_brisa', '{starter}. Good choice — that one bites.', 'Keep it close. It’ll keep you closer.'],
  ] as Beat[],
  kaiArrives: [
    ['rival_kai', 'Brisa! Brisa! Grandma said I could pick first!', '…Oh. Hi. Who are you?'],
    ['warden_brisa', 'This is Kai. Elder Maple’s grandson. He was supposed to be here at dawn.'],
    ['rival_kai', 'I was busy! Reading the type chart. Twice.'],
  ] as Beat[],
  kaiPicks: [
    ['rival_kai', 'You picked {starter}? Then I pick {rival}. Obviously.', 'Type advantage, new kid. It’s all in the chart.'],
    ['rival_kai', 'I’m Kai. Future greatest Wayfarer on the island.', 'Let’s see what you’ve got!'],
  ] as Beat[],
  win: [
    ['rival_kai', 'Wait — what? We met our Mystics five minutes ago!', 'Fine. FINE. Next time I’ll read the chart three times.'],
  ] as Beat[],
  lose: [
    ['rival_kai', 'Ha! Told you. The chart never lies.', 'You weren’t bad, though. For a new kid.'],
  ] as Beat[],
  kaiLeaves: [
    ['rival_kai', 'I’m telling Grandma I won! Or — that I battled. Bye!'],
  ] as Beat[],
  sendOff: [
    ['warden_brisa', 'That boy. His heart’s bigger than his head, and his head is enormous.', 'Now. One friend is a start. A Wayfarer needs more.'],
    ['warden_brisa', 'Take these five Mystic Orbs. Whisperwind Meadow is just east of the road.', 'Tire a wild Mystic out, then throw. Come back with a new friend.'],
  ] as Beat[],
};

/** Where things happen at the south gate. The player stands on the stage facing north. */
let stage: [number, number] = [...START_POS];
const at = (dx: number, dz: number): [number, number] => [stage[0] + dx, stage[1] + dz];

// ── new game / resume ─────────────────────────────────────────────────────────
/** A new journey: empty-handed at Hearthwick's south gate with 100 gold. */
export function newGameState() {
  resetSave();
  const inv = state.inv;
  inv.gold = 100; inv.aether = 0; inv.tickets = 0; inv.essence = 0;
  for (const k of Object.keys(inv.orbs) as (keyof typeof inv.orbs)[]) inv.orbs[k] = 0;
  inv.items = {};
  for (const k of Object.keys(inv.materials) as (keyof typeof inv.materials)[]) inv.materials[k] = 0;
  for (const k of Object.keys(inv.elementum) as (keyof typeof inv.elementum)[]) inv.elementum[k] = 0;
  state.started = true;
  state.story.prologue = 'arrive';
  state.pos = [...START_POS];
  state.respawn = [...START_POS];
  syncQuests();
  startQuest('pro_empty_handed', { silent: true });
  save();
}

export async function newGame(h: StoryHost) {
  newGameState();
  await runPrologue(h);
}
/** The prologue cutscenes on their own (after `newGameState()`). */
export const playPrologue = (h: StoryHost) => runPrologue(h);

/** Continue a save that stopped mid-prologue (after the starter pick). */
export async function resumeStory(h: StoryHost) {
  if (state.story.prologue === 'rival' && state.team.length) await runPrologue(h);
}

/** Debug / test path (`?auto=world&fresh`): the prologue happened off-screen. */
export function skipPrologue(starter = 'emberling') {
  state.story.prologue = 'done';
  state.story.rival = COUNTER_PICK[starter] ?? 'finnik';
  state.story.kai = Math.max(1, state.story.kai);
  state.quests.active = state.quests.active.filter((q) => q.id !== 'pro_empty_handed');
  if (!isDone('pro_empty_handed')) state.quests.done.push('pro_empty_handed');
  syncQuests();
  save();
}

async function runPrologue(h: StoryHost) {
  const c = h.cine;
  h.setBusy(true);
  c.begin();
  try {
    stage = state.story.prologue === 'arrive' ? c.stageNear(START_POS[0], START_POS[1]) : c.playerPos();
    if (state.story.prologue === 'arrive') {
      c.placePlayer(stage[0], stage[1], 0);
      c.spawnNpc('warden_brisa', ...at(-1.5, -19), 180);
      c.frame(['player', 'warden_brisa'], { side: 0.3, height: 2.2, dist: 6 });
      h.titleCard('Hearthwick', 'Where every journey begins', 3000);
      await c.wait(1200);
      const walk = c.walkNpc('warden_brisa', ...at(0.4, -3.2));
      await c.wait(2600);
      c.frame(['player', 'warden_brisa'], { side: 1.05, height: 1.9, dist: 5.8 });
      await walk;
      c.faceNpc('warden_brisa', 'player');
      await c.wait(250);
      await play(h, PRO.meet);
      emit('talk', { npc: 'warden_brisa' });
      state.story.prologue = 'starter';
      save();
    }
    if (state.story.prologue === 'starter') {
      c.faceNpc('warden_brisa', 'player');
      const spots: [number, number][] = [at(1.9, -3.3), at(3.2, -3.05), at(4.5, -2.8)];
      c.frame(['player', 'warden_brisa', ...STARTERS], { side: -0.75, height: 1.9, dist: 6.5 });
      for (let i = 0; i < STARTERS.length; i++) {
        await c.showMystic(STARTERS[i], STARTERS[i], spots[i][0], spots[i][1], 190);
        await c.wait(160);
      }
      c.gesture('warden_brisa', 'cast');
      await play(h, PRO.starters);
      const pick = await h.chooseStarter();
      const species = SPECIES[pick.starter] ? pick.starter : 'emberling';
      const mystic = createCreature(species, 5, { caught: { how: 'starter', at: Date.now(), zone: 'vale' } });
      addCreature(mystic);
      state.profile.name = pick.name || 'Wayfarer';
      state.story.rival = COUNTER_PICK[species] ?? 'finnik';
      emit('starter', { species });
      await c.moveMystic(species, ...at(1, -0.9));
      for (const s of STARTERS) if (s !== species && s !== state.story.rival) c.hideMystic(s);
      c.frame(['player', 'warden_brisa', species], { side: 0.9, height: 1.9, dist: 6 });
      await play(h, PRO.picked);
      state.story.prologue = 'rival';
      save();
    }
    if (state.story.prologue === 'rival') await rivalScene(h);
  } finally {
    c.end();
    h.setBusy(false);
  }
}

async function rivalScene(h: StoryHost) {
  const c = h.cine;
  const [px, pz] = c.playerPos();
  const rival = state.story.rival || 'finnik';
  const mine = state.team[0]?.species ?? 'emberling';
  // resuming after a reload: put the cast back on stage
  c.spawnNpc('warden_brisa', px + 0.4, pz - 3.2, 180);
  c.faceNpc('warden_brisa', 'player');
  await c.showMystic(mine, mine, px + 1, pz - 0.9, 200);
  await c.showMystic(rival, rival, px + 3.5, pz - 3.1, 200);
  c.spawnNpc('rival_kai', px + 6, pz - 22, 180);
  c.frame(['player', 'rival_kai'], { side: -0.5, height: 2.2, dist: 6 });
  const run = c.walkNpc('rival_kai', px + 2.6, pz - 2.4, true);
  await c.wait(900);
  c.frame(['player', 'warden_brisa', 'rival_kai'], { side: -0.9, height: 2.3, dist: 8 });
  await run;
  c.faceNpc('rival_kai', 'player');
  await play(h, PRO.kaiArrives);
  await c.moveMystic(rival, px + 3.2, pz - 1.6);
  c.faceNpc('rival_kai', 'player');
  await play(h, PRO.kaiPicks, ['Battle!']);
  c.hideMystic(rival);
  c.hideMystic(mine);
  const result = await h.battleTamer({
    id: 'kai', name: 'Kai', title: 'Rival', intro: 'Let’s see what the new kid’s got!', zone: 'vale', forgiving: true,
    team: kaiTeam(0, rival).map(([species, level]) => ({ species, level, weak: true })),
  });
  state.story.kai = Math.max(state.story.kai, 1);
  emit('story_battle', { id: 'kai', result });
  c.spawnNpc('warden_brisa', px + 0.4, pz - 3.2, 180);
  c.spawnNpc('rival_kai', px + 2.6, pz - 2.4, 200);
  c.faceNpc('rival_kai', 'player');
  c.faceNpc('warden_brisa', 'player');
  c.frame(['player', 'rival_kai', 'warden_brisa'], { side: 0.9, height: 2.3, dist: 8 });
  if (result === 'win') { c.gesture('rival_kai', 'cast'); await play(h, PRO.win); } else { c.gesture('rival_kai', 'victory'); await play(h, PRO.lose); }
  await play(h, PRO.kaiLeaves);
  const leave = c.walkNpc('rival_kai', px + 6, pz - 40, true);
  c.frame(['player', 'warden_brisa'], { side: 1, height: 2.2, dist: 7 });
  await play(h, PRO.sendOff);
  await leave;
  c.releaseNpc('rival_kai');
  c.releaseNpc('warden_brisa');
  state.story.prologue = 'done';
  syncQuests();
  h.titleCard('Chapter I', 'First Bond', 3600);
  save();
}

// ── talking to NPCs ───────────────────────────────────────────────────────────
const idleIndex = new Map<string, number>();
const todayStr = () => new Date().toISOString().slice(0, 10);

/** Talk to an NPC (or a gate warden `gate:<id>`). Returns false if nobody answered. */
export async function talk(npcId: string, h: StoryHost | null = host): Promise<boolean> {
  if (!h) return false;
  if (npcId.startsWith('gate:')) return gateWarden(h, npcId.slice(5));
  const npc = npcById(npcId);
  if (!npc) return false;
  h.setBusy(true);
  try {
    const opts = talkOptions(npcId);
    beginConversation();
    emit('talk', { npc: npcId });
    const beats = endConversation();
    if (beats.length) { await play(h, beats); return true; }
    const first = opts.find((o) => o.kind !== 'step');
    if (first?.kind === 'battle') { await storyBattle(h, npcId, first.quest, first.step); return true; }
    if (first?.kind === 'turnin') { beginConversation(); claim(first.quest); await play(h, endConversation()); return true; }
    if (first?.kind === 'offer') { await offer(h, first.quest); return true; }
    if (first?.kind === 'nudge') {
      await play(h, first.beats);
      if (npc.shop) await h.openShop(npc.shop);
      return true;
    }
    if (npc.shop) {
      const d = npc.lines[(idleIndex.get(npcId) ?? 0) % npc.lines.length];
      idleIndex.set(npcId, (idleIndex.get(npcId) ?? 0) + 1);
      if (d) await play(h, [[npcId, d]]);
      await h.openShop(npc.shop);
      return true;
    }
    await idle(h, npcId);
    return true;
  } finally {
    h.setBusy(false);
  }
}

async function idle(h: StoryHost, npcId: string) {
  const npc = npcById(npcId)!;
  const i = idleIndex.get(npcId) ?? 0;
  idleIndex.set(npcId, i + 1);
  const line = npc.lines[i % Math.max(1, npc.lines.length)] ?? '…';
  const gift = (npc.likes ?? []).find((g) => itemCount(g) > 0);
  const gifted = state.flags[`gift:${npcId}:${todayStr()}`];
  if (gift && !gifted) {
    const pick = await play(h, [[npcId, line]], [`Give ${ITEMS[gift].name}`, 'Goodbye']);
    if (pick === 0) await giveGift(h, npcId, gift);
    return;
  }
  await play(h, [[npcId, line]]);
}

const THANKS = [
  'For me? You remembered! Oh, you’re a treasure.',
  'Now this — this is the good stuff. Thank you, truly.',
  'You didn’t have to. I’m very glad you did.',
];
const GIFT_BACK: ItemId[] = ['super_tonic', 'berry_treat', 'escape_shard', 'ward_incense', 'ether'];

async function giveGift(h: StoryHost, npcId: string, gift: ItemId) {
  addItem(gift, -1);
  for (const k of Object.keys(state.flags)) if (k.startsWith(`gift:${npcId}:`)) delete state.flags[k];
  state.flags[`gift:${npcId}:${todayStr()}`] = true;
  const back = GIFT_BACK[(npcId.length + state.day) % GIFT_BACK.length];
  const reward = { items: { [back]: back === 'berry_treat' ? 2 : 1 }, rankXp: 20 };
  applyReward(reward);
  await play(h, [[npcId, THANKS[(npcId.charCodeAt(0) + state.day) % THANKS.length], `Here — take this for the road.`]]);
  notify(`${npcById(npcId)?.name ?? 'They'} gave you ${rewardText(reward)}`, 'loot');
  save();
}

async function offer(h: StoryHost, questId: string) {
  const d = questDef(questId);
  if (!d) return;
  const beats = d.offer?.length ? d.offer : [[d.giver ?? 'player', fill(d.summary)] as Beat];
  const pick = await play(h, beats, ['Accept', 'Not now']);
  if (pick !== 0) {
    if (d.giver) await play(h, [[d.giver, 'No rush. I’ll be right here.']]);
    return;
  }
  beginConversation();
  const ok = accept(questId);
  const more = endConversation();
  if (!ok) { h.toast('You’re carrying as many requests as you can manage.', 'bad'); return; }
  if (more.length) await play(h, more);
}

/** Pre-battle talk → tamer battle → story_battle → quest dialog. */
async function storyBattle(h: StoryHost, npcId: string, questId: string, step: StepDef) {
  const isKai = step.tamer === 'kai';
  const final = questId === 'post_kai';
  const arc = final ? KAI_FINAL : KAI_ARC[Math.min(KAI_ARC.length - 1, Math.max(1, state.story.kai))];
  const def = isKai ? undefined : tamerById(step.tamer ?? '');
  if (!isKai && !def) return;
  const intro: Beat[] = isKai ? arc.before : [[npcId, def!.intro]];
  const pick = await play(h, intro, ['Battle!', 'Not now']);
  if (pick !== 0) return;
  if (!teamAlive()) { h.toast('Your team needs rest first — visit a Healer.', 'bad'); return; }
  const stage = step.rivalStage ?? KAI_ARC_STAGE(state.story.kai);
  const team = isKai
    ? kaiTeam(stage, state.story.rival || 'finnik').map(([species, level]) => ({ species, level }))
    : def!.team.filter(([sp]) => SPECIES[sp]).map(([species, level]) => ({ species, level }));
  const npc = npcById(npcId);
  const result = await h.battleTamer({ id: isKai ? 'kai' : def!.id, name: npc?.name ?? def?.name ?? 'Kai', title: npc?.title ?? def?.title ?? 'Rival', intro: isKai ? 'Kai wants a battle!' : def!.intro, zone: questDef(questId)?.region ?? 'vale', team });
  if (result === 'fled') return;
  if (isKai) state.story.kai++;
  const post: Beat[] = isKai ? (result === 'win' ? arc.win : arc.lose) : result === 'win' ? [[npcId, def!.win]] : [[npcId, def!.lose], ['player', 'Not yet. Heal up and try again.']];
  if (result === 'win') {
    const reward = isKai ? { gold: 150 + stage * 120, aether: 20 + stage * 10 } : def!.reward;
    applyReward(reward);
    notify(`Won ${rewardText(reward)}`, 'loot');
    emit('tamer_win', { id: isKai ? 'kai' : def!.id });
  }
  beginConversation();
  emit('story_battle', { id: step.tamer!, result });
  const after = endConversation();
  await play(h, [...post, ...after]);
  save();
}

async function gateWarden(h: StoryHost, gateId: string): Promise<boolean> {
  const g = gateById(gateId);
  if (!g) return false;
  h.setBusy(true);
  try {
    const who = `gate:${gateId}`;
    if (gateOpen(gateId)) await play(h, [[who, `${g.name} stands open. The seal remembers you, Wayfarer.`, 'Walk safe.']]);
    else await play(h, [[who, g.sealedText, sealText(g)]]);
    emit('talk', { npc: who });
    return true;
  } finally {
    h.setBusy(false);
  }
}

// ── the quiet-moment loop (called every frame by the world layer) ───────────────
const moments: { title: string; sub: string }[] = [];
let flushing = false;
export function storyUpdate() {
  const h = host;
  if (!h || flushing || !h.isFree()) return;
  if (moments.length) {
    const m = moments.shift()!;
    h.titleCard(m.title, m.sub, 3600);
    return;
  }
  if (!hasPendingBeats()) return;
  flushing = true;
  h.setBusy(true);
  void play(h, takePendingBeats()).finally(() => { h.setBusy(false); flushing = false; });
}

// ── rules for the world ────────────────────────────────────────────────────────
/** Wild battles only once you have a Mystic (and not while Ward Incense burns / the cloak is worn). */
export function encountersAllowed(kind: 'wild' | 'grass' | 'strike'): boolean {
  if (state.story.prologue !== 'done' || !state.team.length) return false;
  if (kind === 'grass' && wardActive()) return false;
  if (kind === 'wild' && cloakWorn()) return false;
  return true;
}
/** During the prologue the town is the whole world. */
export const leashed = () => state.story.prologue !== 'done';
export const LEASH = { center: [START_POS[0], START_POS[1] - 36] as [number, number], radius: 70 };
export const cinematicActive = () => cineOn;
let cineOn = false;
export function setCinematic(on: boolean) { cineOn = on; }

/** Features a UI can use to hide surfaces until the story introduces them. */
export const featureUnlocked = (id: string) => state.story.features.includes(id);

// ── debug: jump the story forward for screenshots and testing (`?story=`) ──────
/** tutorial | ch1 | tier2 | tier3 | crown — applied to the current save after the prologue. */
export function debugStory(stage: string) {
  if (state.story.prologue !== 'done') skipPrologue(state.team[0]?.species ?? 'emberling');
  const finish = (id: string) => {
    state.quests.active = state.quests.active.filter((q) => q.id !== id);
    if (!isDone(id)) state.quests.done.push(id);
  };
  const beat = (...zones: string[]) => { for (const z of zones) if (!state.bosses.includes(z)) { state.bosses.push(z); emit('boss_win', { zone: z }); } };
  if (stage === 'tutorial') { syncQuests(); save(); return; }
  finish('ch1_first_steps');
  for (const f of ['board', 'merchant']) if (!state.story.features.includes(f)) state.story.features.push(f);
  if (stage === 'ch1') { syncQuests(); save(); return; }
  finish('ch1_first_bond');
  if (!state.story.features.includes('bounties')) state.story.features.push('bounties');
  beat('vale');
  if (stage === 'tier3' || stage === 'crown') { finish('ch2_lakes'); finish('ch3_coast'); beat('lakes', 'coast'); }
  if (stage === 'crown') {
    for (const id of ['ch4_marsh', 'ch5_scar', 'ch6_elder', 'ch7_dunes', 'ch8_peaks', 'ch9_hollows']) finish(id);
    beat('marsh', 'scar', 'elder', 'dunes', 'peaks', 'hollows');
  }
  syncQuests();
  save();
}

// ── wiring ────────────────────────────────────────────────────────────────────
/** Registers every content system (quests are registered by initProgress). */
export function initContent(h: StoryHost) {
  initGates();
  initExplore();
  initShops();
  initStory(h);
}

let wired = false;
export function initStory(h: StoryHost) {
  setStoryHost(h);
  if (wired) return;
  wired = true;
  on('gate_open', (e) => {
    const g = gateById(e.id);
    if (g) moments.push({ title: g.name, sub: g.id === 'g_crown' ? 'The Crown Gate opens' : 'The Warden seal is broken' });
  });
  on('boss_win', (e) => {
    const sigil = ITEMS[`sigil_${e.zone}` as ItemId];
    if (sigil) moments.push({ title: sigil.name, sub: 'A Guardian’s sigil is yours' });
  });
}
