// Wild Mystics v3 — the quest script: prologue, nine chapters, the Crown finale, the epilogue,
// town side quests, Alpha bounties and dailies. The engine lives in src/game/quests.ts.
//
// Tone: warm, witty, a little melancholy. A beat is one speaker and at most three short lines,
// so every page fits a phone in landscape. Tokens: {player} {starter} {rival} {guardian:<land>}
// {land:<land>} {town:<land>}.
//
// Locations (LocRef): npc:<id> · poi:<id> · town:<land> · gate:<id> · dungeon:<id> · boss:<land>
// · camp:<land> · region:<land> · service:<land>:<svc> · waystone:<land> · tamer:<id> · alpha:<land>
// · homestead · pos:<x>,<z>. Any ref takes an offset suffix `@<bearing>:<metres>`.
import type { Element } from './elements';
import type { ItemId } from './items';
import type { Reward } from './progression';

export type Beat = [speaker: string, ...lines: string[]];
export type LocRef = string;

export type StepType =
  | 'talk' | 'reach' | 'catch' | 'defeat' | 'win' | 'collect' | 'deliver' | 'service' | 'buy' | 'attune'
  | 'region' | 'dungeon' | 'clear' | 'guardian' | 'gate' | 'hatch' | 'evolve' | 'tamer' | 'alpha' | 'open'
  | 'battle' | 'dex' | 'count';

export interface Match {
  type: StepType;
  npc?: string;
  tamer?: string;
  species?: string;
  element?: Element;
  zone?: string;
  kind?: 'wild' | 'boss' | 'tamer';
  night?: boolean;
  shiny?: boolean;
  how?: string;
  item?: ItemId;
  service?: string;
  /** Dungeon / gate / POI / UI-tab id, depending on the type. */
  id?: string;
  /** `count` steps: the GameEvents key to count. */
  event?: string;
  material?: string;
  /** Alpha steps: which alpha event counts. */
  mode?: 'defeat' | 'catch' | 'either';
  /** Battle steps: what counts as done. */
  result?: 'win' | 'any';
}

export type Effect =
  | { give: Reward }
  | { take: { item: ItemId; n: number } }
  | { flag: string }
  | { feature: string }
  | { shopTier: number }
  | { openGate: string }
  | { reveal: string }
  | { start: string };

export interface StepDef extends Match {
  /** Tracker text — imperative, short. */
  text: string;
  count?: number;
  /** Where the tracker, compass and beacon point (derived from the step when omitted). */
  at?: LocRef;
  radius?: number;
  /** Rival stage for Kai battles (team strength). */
  rivalStage?: number;
  /** Collect steps: matching events hand out the item while the step is active. */
  drop?: { event: string; zone?: string; element?: Element; species?: string; chance?: number };
  /** Other ways to satisfy the step (e.g. a Guardian win also clears the path to it). */
  alt?: Match[];
  /** NPCs that stand somewhere special while this step is current. */
  stage?: Record<string, LocRef>;
  start?: Beat[];
  progress?: Beat[];
  done?: Beat[];
  onStart?: Effect[];
  onDone?: Effect[];
}

export type QuestKind = 'main' | 'side' | 'daily' | 'bounty';

export interface Requires {
  quests?: string[];
  bosses?: string[];
  /** Land must be reachable (its gate open). */
  region?: string;
  flags?: string[];
  features?: string[];
}

export interface QuestDef {
  id: string;
  kind: QuestKind;
  title: string;
  chapter?: string;
  /** NPC who offers the quest (and takes the turn-in for side quests). */
  giver?: string;
  /** Home land (quest board + map filtering). */
  region: string;
  summary: string;
  level?: number;
  requires?: Requires;
  /** Starts by itself once the requirements are met (main quests). */
  auto?: boolean;
  /** The giver's pitch (side quests / bounties): talk → Accept. */
  offer?: Beat[];
  steps: StepDef[];
  /** Who to return to once the steps are done. Side quests default to the giver; null = none. */
  turnIn?: string | null;
  complete?: Beat[];
  reward: Reward;
  unlocks?: Effect[];
  /** Posted on the land's Quest Board too. */
  board?: boolean;
}

// ── helpers ─────────────────────────────────────────────────────────────────
type O = Partial<StepDef>;
const talk = (npc: string, text: string, o: O = {}): StepDef => ({ type: 'talk', npc, text, ...o });
const reach = (at: LocRef, text: string, o: O = {}): StepDef => ({ type: 'reach', at, text, ...o });
const veil = (tamer: string, at: LocRef, text: string, o: O = {}): StepDef => ({ type: 'battle', npc: tamer, tamer, result: 'win', text, stage: { [tamer]: at }, ...o });
const kai = (rivalStage: number, at: LocRef, text: string, o: O = {}): StepDef => ({ type: 'battle', npc: 'rival_kai', tamer: 'kai', rivalStage, result: 'any', text, stage: { rival_kai: at }, ...o });
const guardian = (zone: string, text: string, o: O = {}): StepDef => ({ type: 'guardian', zone, text, at: `boss:${zone}`, ...o });
/** Dungeon steps also resolve when the land's Guardian is answered, so no chapter can dead-end. */
const clear = (id: string, zone: string, text: string, o: O = {}): StepDef => ({ type: 'clear', id, text, at: `dungeon:${id}`, alt: [{ type: 'guardian', zone }], ...o });
const enter = (id: string, zone: string, text: string, o: O = {}): StepDef => ({ type: 'dungeon', id, text, at: `dungeon:${id}`, alt: [{ type: 'clear', id }, { type: 'guardian', zone }], ...o });
const count = (event: string, n: number, text: string, o: O = {}): StepDef => ({ type: 'count', event, count: n, text, ...o });

// ═══════════════════════════════════════════════════════════════════════════
// MAIN STORY
// ═══════════════════════════════════════════════════════════════════════════
export const MAIN_QUESTS: QuestDef[] = [
  // ── Prologue — "Empty-handed" (driven by the onboarding director, src/game/story.ts) ──
  {
    id: 'pro_empty_handed', kind: 'main', title: 'Empty-handed', chapter: 'Prologue', giver: 'warden_brisa', region: 'vale', level: 1,
    summary: 'You reached Hearthwick’s south gate with nothing but your boots. The town guard has opinions about that.',
    steps: [
      talk('warden_brisa', 'Speak with the town guard'),
      count('starter', 1, 'Choose your first Mystic', { at: 'npc:warden_brisa' }),
      { type: 'battle', npc: 'rival_kai', tamer: 'kai', rivalStage: 0, result: 'any', text: 'Face your rival, Kai' },
    ],
    turnIn: null,
    reward: { rankXp: 40 },
  },

  // ── Chapter 1 — "First Bond" (Verdant Vale) ──
  {
    id: 'ch1_first_steps', kind: 'main', title: 'First Steps', chapter: 'Chapter 1 · First Bond', giver: 'warden_brisa', region: 'vale', level: 3,
    summary: 'Warden Brisa won’t let you wander the Vale until you can look after a Mystic — and yourself.',
    requires: { quests: ['pro_empty_handed'] }, auto: true,
    steps: [
      { type: 'catch', zone: 'vale', count: 1, at: 'poi:p_meadow', text: 'Catch a wild Mystic in Whisperwind Meadow',
        onStart: [{ give: { orbs: { mystic: 5 } } }],
        progress: [['warden_brisa', 'Whisperwind Meadow is east of the road. Weaken a wild Mystic first — then throw.', 'A tired Mystic listens better. So do tired guards.']],
        done: [['warden_brisa', 'I saw the flash from the gate! Your first catch. Don’t tell Kai I cheered.']] },
      { type: 'service', service: 'healer', zone: 'vale', text: 'Rest your team at the Hearthwick Healer',
        start: [['warden_brisa', 'Mystics tire just like we do. The Healer in the plaza patches them up for free.', 'Look for the red roof and the heart on the sign.']],
        progress: [['warden_brisa', 'The Healer. Red roof. Heart sign. I’d walk you there, but I’m on duty.']] },
      { type: 'buy', zone: 'vale', text: 'Buy something at the Outfitter',
        start: [['warden_brisa', 'You’ve still got a little gold. Spend some at the Outfitter — orbs, tonics, whatever calls to you.']],
        progress: [['warden_brisa', 'The Outfitter’s the blue roof. Tobias will try to sell you a hat. Resist.']] },
      { type: 'attune', zone: 'vale', text: 'Attune a Waystone in the Vale',
        start: [['warden_brisa', 'See the stone pillars with a crystal on top? Waystones. Touch one and it remembers you.', 'Later you can travel back to any Waystone you’ve attuned.']],
        progress: [['warden_brisa', 'Waystones hum when you’re close. Follow the hum.']] },
      { type: 'open', id: 'map', at: 'npc:warden_brisa', text: 'Open your Map',
        start: [['warden_brisa', 'Last lesson: your Map. It fills in wherever you walk — the fog lifts as you explore.']] },
      talk('elder_maple', 'Report to Elder Maple in the plaza', {
        start: [['warden_brisa', 'That’s everything I can teach with a straight face.', 'Elder Maple wants to meet you. She’s in the plaza, probably talking to a mushroom.']],
        done: [
          ['elder_maple', 'Ah! The Wayfarer Brisa keeps grumbling about. Welcome, welcome.', 'I’m Maple. I study Mystics — and the old stories about them.'],
          ['elder_maple', 'You’ve met my grandson, I hear. He’s been practising his victory speech since dawn.'],
        ] }),
    ],
    turnIn: null,
    reward: { gold: 200, items: { tonic: 3, escape_shard: 1 }, rankXp: 80 },
    unlocks: [{ feature: 'board' }, { feature: 'merchant' }],
  },
  {
    id: 'ch1_first_bond', kind: 'main', title: 'First Bond', chapter: 'Chapter 1 · First Bond', giver: 'elder_maple', region: 'vale', level: 6,
    summary: 'A storm grows on the Crown each year, and the Guardians wake restless. Elder Maple asks you to look in on Thornjaw Rex at the Old Grove.',
    requires: { quests: ['ch1_first_steps'] }, auto: true,
    steps: [
      reach('poi:p_oldgrove', 'Look in on the Old Grove', {
        radius: 45,
        start: [
          ['elder_maple', 'Every year a storm grows on the Crown — up there, on Mount Aether.', 'And every year the Guardians of the eight lands wake a little more restless.'],
          ['elder_maple', 'The Sky Wardens used to answer them. Battle them — gently — until they slept again.', 'The last Warden vanished twenty years ago. Nobody has answered since.'],
          ['elder_maple', '{guardian:vale} guards the Old Grove, southwest by the sea. It’s been roaring all week.', 'Would you look in on it? Carefully. Bring tonics. Bring two.'],
        ],
        progress: [['elder_maple', 'The Old Grove is southwest, down by the sea. Follow the roaring.']] }),
      veil('veil_nettle', 'poi:p_oldgrove@60:10', 'Confront the masked stranger at the Grove', {
        start: [['veil_nettle', 'Hm? A Wayfarer? Go away — the Grove is closed.', 'Official Hollow Veil business. Very secret. Please leave.']],
        onDone: [{ give: { items: { veil_mask: 1 } } }] }),
      talk('elder_maple', 'Show Elder Maple the Veil mask', {
        progress: [['elder_maple', 'A mask? Bring it here, quickly. Please.']],
        done: [
          ['elder_maple', 'The Hollow Veil… I hoped I’d never see that mask again.', 'They siphon a Guardian’s light into lanterns. A drained Guardian turns wild.'],
          ['elder_maple', 'Thornjaw will only calm if someone answers it. Properly.', 'Rootway Burrow runs beneath the Grove. The roots will lead you to its heart.'],
        ],
        onDone: [{ take: { item: 'veil_mask', n: 1 } }, { give: { items: { rootway_key: 1 } } }] }),
      kai(1, 'poi:p_windmill@90:8', 'Kai is waiting for you at Miller’s Rise', {
        start: [['rival_kai', 'Grandma told me everything! You? Answering a Guardian?', 'Miller’s Rise. Now. Bring your A-game. And your B-game.']] }),
      clear('d_vale', 'vale', 'Find the way through Rootway Burrow', {
        start: [['elder_maple', 'The Burrow’s mouth is near the Grove. Use the Rootway Key — the roots will know it.']] }),
      guardian('vale', 'Answer {guardian:vale} at the Old Grove', {
        start: [['elder_maple', 'Remember: answering isn’t hunting. Show it your bond. It will know the difference.']] }),
      talk('elder_maple', 'Return to Elder Maple', {
        done: [
          ['elder_maple', 'The Verdant Sigil! Thornjaw gave it to you? It only did that for Wardens.', 'Hm. Hm! Don’t let it go to your head.'],
          ['elder_maple', 'Both passes out of the Vale are open — west to the Mirror Lakes, east to the Sapphire Coast.', 'The Veil said “eight more”. We need to be there first.'],
        ] }),
    ],
    turnIn: null,
    reward: { gold: 500, aether: 300, relic: 'heart_of_oak', rankXp: 250 },
    unlocks: [{ feature: 'bounties' }],
  },

  // ── Chapter 2 — "Still Waters" (Mirror Lakes) ──
  {
    id: 'ch2_lakes', kind: 'main', title: 'Still Waters', chapter: 'Chapter 2 · Still Waters', giver: 'ferrywoman_ysolde', region: 'lakes', level: 10,
    summary: 'The Mirror Lakes have stopped reflecting the sky. Ferrywoman Ysolde says the Mirror went dark the night the masked strangers came.',
    requires: { region: 'lakes', quests: ['ch1_first_bond'] }, auto: true,
    steps: [
      talk('ferrywoman_ysolde', 'Meet Ferrywoman Ysolde in Stillwater', {
        start: [['elder_maple', 'A letter came from Stillwater, west through Willowmere Pass. Their lakes have gone dark.']],
        done: [
          ['ferrywoman_ysolde', 'A Wayfarer! Thank the tides. Sit — no, not there, that bench is wet.', 'They’re called the Mirror Lakes because they reflect everything. Stars. Faces. Secrets.'],
          ['ferrywoman_ysolde', 'Three nights ago the biggest one — the Mirror — went dark.', 'Masked folk in a boat. Lanterns. Singing. Then nothing at all.'],
        ] }),
      reach('poi:p_mirror', 'Investigate The Mirror', { progress: [['ferrywoman_ysolde', 'The Mirror is the big lake west of town. You can’t miss it. Well — you can now. It’s dark.']] }),
      veil('veil_marlo', 'poi:p_mirror@120:12', 'Stop the Veil diver draining the Mirror', {
        start: [['veil_marlo', 'Shh. I’m bottling a lake. It takes concentration.']] }),
      kai(2, 'poi:p_falls@60:10', 'Kai is at Silverfall', {
        start: [['rival_kai', 'I heard bells behind the waterfall! Silverfall! Race you there!']] }),
      enter('d_lakes', 'lakes', 'Find the chapel hidden behind Silverfall', {
        start: [['rival_kai', 'Bells mean a chapel. A chapel. Underwater. Behind a waterfall.', 'Search around the falls. This island is ridiculous.']] }),
      clear('d_lakes', 'lakes', 'Ring the bells of the Drowned Chapel'),
      guardian('lakes', 'Answer {guardian:lakes} beneath the Mirror'),
      talk('ferrywoman_ysolde', 'Return to Ysolde in Stillwater', {
        done: [
          ['ferrywoman_ysolde', 'Look at the water. Stars again — real ones. I could cry. I am crying. It’s fine.', 'The Mirror Sigil is yours. The Fogfen Crossing to the north should open for you.'],
        ] }),
    ],
    turnIn: null,
    reward: { gold: 800, aether: 350, relic: 'tide_pearl', items: { water_stone: 1 }, rankXp: 300 },
    unlocks: [{ shopTier: 1 }],
  },

  // ── Chapter 3 — "Sunken Bells" (Sapphire Coast) ──
  {
    id: 'ch3_coast', kind: 'main', title: 'Sunken Bells', chapter: 'Chapter 3 · Sunken Bells', giver: 'captain_marlow', region: 'coast', level: 11,
    summary: 'Tidewatch Light has gone dark and boats are running aground. Captain Marlow swears the lens was stolen, not broken.',
    requires: { region: 'coast', quests: ['ch1_first_bond'] }, auto: true,
    steps: [
      talk('captain_marlow', 'Meet Captain Marlow in Tidewatch', {
        start: [['elder_maple', 'Tidewatch, east through Saltwind Gate, has lost its light. Captain Marlow could use a friend.']],
        done: [
          ['captain_marlow', 'Forty years I’ve kept that light. Never missed a night. Not one.', 'Then a smuggler in a porcelain mask walked off with the lens. The LENS.'],
          ['captain_marlow', 'Without it the reef eats boats. And something under the reef has started to sing.'],
        ] }),
      reach('poi:p_lighthouse', 'Climb to Tidewatch Light', { progress: [['captain_marlow', 'The Light’s on the point, south of town. Mind the gulls. They’re organised.']] }),
      veil('veil_skerry', 'poi:p_lighthouse@200:10', 'Catch the Veil smuggler at the Light', {
        start: [['veil_skerry', 'Evening! Lovely view. Nothing stolen up here. Move along.']] }),
      { type: 'deliver', npc: 'captain_marlow', item: 'lens_crystal', count: 1, text: 'Bring the lens back to Captain Marlow',
        done: [['captain_marlow', 'Ha! Look at it shine, like it never left.', 'The smuggler dropped a map, too. Marks a cove below the cliffs.']],
        onDone: [{ give: { items: { smuggler_map: 1 } } }, { reveal: 'd_coast' }] },
      kai(2, 'poi:p_reef@300:10', 'Kai is at Bellreef Shallows', {
        start: [['rival_kai', 'The reef is SINGING. Actual notes. I wrote them down!', 'Come to Bellreef. Battle first, concert after.']] }),
      clear('d_coast', 'coast', 'Clear the Smuggler’s Grotto'),
      guardian('coast', 'Answer {guardian:coast} beneath the reef'),
      talk('captain_marlow', 'Return to Captain Marlow', {
        done: [['captain_marlow', 'The sea’s gone quiet. Good quiet. The kind you can sleep to.', 'Take the Tide Sigil. The Cinder Stair east of here won’t stop you now.']] }),
    ],
    turnIn: null,
    reward: { gold: 800, aether: 350, relic: 'dawn_bell', orbs: { tide: 3 }, rankXp: 300 },
    unlocks: [{ shopTier: 1 }],
  },

  // ── Chapter 4 — "Names in the Fog" (Mistveil Marsh) ──
  {
    id: 'ch4_marsh', kind: 'main', title: 'Names in the Fog', chapter: 'Chapter 4 · Names in the Fog', giver: 'mother_sedge', region: 'marsh', level: 16,
    summary: 'In Mistveil Marsh the lanterns are going out, and the fog has started taking names. Mother Sedge can’t remember her own sister’s.',
    requires: { region: 'marsh' }, auto: true,
    steps: [
      talk('mother_sedge', 'Meet Mother Sedge in Mirehaven', {
        start: [['ferrywoman_ysolde', 'Mirehaven’s lanterns went out last night. Fogfen Crossing, north. Mother Sedge will know why.']],
        done: [
          ['mother_sedge', 'In out of the fog, child. Quickly. It listens.', 'The marsh keeps names. Say one near a lantern and it stays safe.'],
          ['mother_sedge', 'Someone is putting the lanterns out. This morning I couldn’t remember my sister’s name.', 'Seventy years I’ve known her. Gone, like breath on glass.'],
        ] }),
      reach('poi:p_boardwalk', 'Walk the Lantern Boardwalk', { progress: [['mother_sedge', 'The Lantern Boardwalk runs west into the reeds. Keep to the planks.']] }),
      veil('veil_morrow', 'poi:p_boardwalk@90:10', 'Stop the lantern-snuffer', {
        start: [['veil_morrow', 'Shh. The fog is sleeping. Every lantern I put out, it sleeps deeper.']] }),
      kai(3, 'town:marsh@90:18', 'Kai is waiting in Mirehaven', {
        start: [['rival_kai', 'You relit the boardwalk? Show-off. Come back to Mirehaven — I need a battle.']] }),
      enter('d_marsh', 'marsh', 'Find the Hollow Crypt by moonlight', {
        start: [['mother_sedge', 'The crypt door only shows itself under the moon. Go at night, child. Take a lantern.']] }),
      clear('d_marsh', 'marsh', 'Relight the lanterns of the Hollow Crypt'),
      guardian('marsh', 'Answer {guardian:marsh} in the reeds'),
      talk('mother_sedge', 'Return to Mother Sedge', {
        done: [
          ['mother_sedge', 'Rosemary. Her name is Rosemary. I can say it again!', 'Rosemary, Rosemary, Rosemary.'],
          ['mother_sedge', 'Take the Lantern Sigil, child. And never walk the marsh without a light.'],
        ] }),
    ],
    turnIn: null,
    reward: { gold: 1100, aether: 400, relic: 'dream_lantern', orbs: { dusk: 5 }, rankXp: 400 },
    unlocks: [{ shopTier: 2 }],
  },

  // ── Chapter 5 — "Ash and Embers" (Ember Scar) ──
  {
    id: 'ch5_scar', kind: 'main', title: 'Ash and Embers', chapter: 'Chapter 5 · Ash and Embers', giver: 'forgemother_ashka', region: 'scar', level: 16,
    summary: 'The Hollow Veil has seized the Magma Forge. Forgemother Ashka wants it back before they finish whatever they’re making.',
    requires: { region: 'scar' }, auto: true,
    steps: [
      talk('forgemother_ashka', 'Meet Forgemother Ashka in Cinderrest', {
        start: [['captain_marlow', 'Smoke over Cinderrest, up the Cinder Stair. Forgemother Ashka is asking for help. She never asks.']],
        done: [
          ['forgemother_ashka', 'You came up the Cinder Stair? Brave or lost. Either way, I need you.', 'The Veil took the Magma Forge. My grandmother’s forge.'],
          ['forgemother_ashka', 'They’re casting lanterns in it. Big ones. Cages with handles.'],
        ] }),
      reach('poi:p_caldera', 'Scout the Caldera Rim', { progress: [['forgemother_ashka', 'Climb the Caldera Rim, east. From up there you can see into the Forge.']] }),
      veil('veil_cinder', 'dungeon:d_scar@250:12', 'Drive the Veil forgehand from the Forge', {
        start: [['veil_cinder', 'Careful! This lantern holds a piece of the Ashen Totem. Don’t bump it.']] }),
      kai(3, 'town:scar@300:18', 'Kai is waiting in Cinderrest', {
        start: [['rival_kai', 'Cinderrest is SO hot. My eyebrows are sweating. Come battle me before I evaporate.']] }),
      clear('d_scar', 'scar', 'Take back the Magma Forge', {
        start: [['forgemother_ashka', 'You have the Forge Brand? Then the Forge will open for you. Go in and take it back.']] }),
      guardian('scar', 'Answer {guardian:scar} in the caldera'),
      talk('forgemother_ashka', 'Return to Forgemother Ashka', {
        done: [['forgemother_ashka', 'The Forge is ours again. It sounds happier. Forges have moods.', 'The Cinder Sigil. North of here, the Obsidian Arch will let you pass.']] }),
    ],
    turnIn: null,
    reward: { gold: 1100, aether: 400, relic: 'ember_charm', items: { fire_stone: 1 }, rankXp: 400 },
    unlocks: [{ shopTier: 2 }],
  },

  // ── Chapter 6 — "The Forest That Dreams" (Elderwood) ──
  {
    id: 'ch6_elder', kind: 'main', title: 'The Forest That Dreams', chapter: 'Chapter 6 · The Forest That Dreams', giver: 'oakspeaker_fenn', region: 'elder', level: 21,
    summary: 'The Elder Tree is having a nightmare and the forest paths keep rearranging themselves. Oakspeaker Fenn thinks someone is pruning its dreams.',
    requires: { region: 'elder' }, auto: true,
    steps: [
      talk('oakspeaker_fenn', 'Meet Oakspeaker Fenn in Elderhollow', {
        start: [['mother_sedge', 'The Rootgate is open, child. Beyond it the Elderwood dreams. Oakspeaker Fenn keeps its dreams.']],
        done: [
          ['oakspeaker_fenn', 'Shh. Softly. The forest is asleep, and it’s having a bad dream.', 'Paths move. Trees sigh. Yesterday the bakery ended up in a different glade.'],
          ['oakspeaker_fenn', 'Someone is snipping at the Elder Tree’s dreams. With shears. Tiny, rude shears.'],
        ] }),
      reach('poi:p_eldertree', 'Visit the Elder Tree'),
      veil('veil_thistle', 'poi:p_eldertree@45:12', 'Stop the Veil pruner', {
        start: [['veil_thistle', 'Old trees dream too loudly. A little pruning never hurt anyone.']],
        onDone: [{ reveal: 'd_elder' }] }),
      kai(4, 'town:elder@120:16', 'Kai is waiting in Elderhollow'),
      clear('d_elder', 'elder', 'Heal the heart of Heartwood Hollow', {
        start: [['oakspeaker_fenn', 'The Heartwood Seed! The tree is opening a door for you. Go in. Speak kindly.']] }),
      guardian('elder', 'Answer {guardian:elder} in the deepest glade'),
      talk('oakspeaker_fenn', 'Return to Oakspeaker Fenn', {
        done: [['oakspeaker_fenn', 'The dream has changed. It’s dreaming of you now. A great honour. Mostly.', 'The Heartwood Sigil. The Frostbark Gate to the north will know you.']] }),
    ],
    turnIn: null,
    reward: { gold: 1400, aether: 450, relic: 'verdant_seed', items: { leaf_stone: 1 }, rankXp: 500 },
    unlocks: [{ shopTier: 3 }],
  },

  // ── Chapter 7 — "Sands of Time" (Sunscorch Dunes) ──
  {
    id: 'ch7_dunes', kind: 'main', title: 'Sands of Time', chapter: 'Chapter 7 · Sands of Time', giver: 'caravan_queen_samira', region: 'dunes', level: 21,
    summary: 'The Last Oasis is drying up while the Hollow Veil digs beneath the dunes. Samira’s caravans can’t cross without water.',
    requires: { region: 'dunes' }, auto: true,
    steps: [
      talk('caravan_queen_samira', 'Meet Samira, the Caravan Queen of Sunreach', {
        start: [['forgemother_ashka', 'Past the Obsidian Arch the sand starts. Samira runs the caravans at Sunreach. Tell her Ashka sent you.']],
        done: [
          ['caravan_queen_samira', 'A Wayfarer! Sit, drink — well, sip. We’re rationing.', 'The Last Oasis shrinks a hand’s width a day, and the Veil are digging beside it.'],
          ['caravan_queen_samira', 'They say a lantern older than the Crown lies under the sand.', 'I say they’re draining my oasis to find it.'],
        ] }),
      reach('poi:p_oasis', 'Go to the Last Oasis'),
      veil('veil_sirocco', 'poi:p_oasis@150:12', 'Stop the Veil dig at the oasis', {
        start: [['veil_sirocco', 'There’s a lantern older than the Crown under all this sand. We just need to dig.']] }),
      kai(4, 'town:dunes@200:16', 'Kai is waiting in Sunreach'),
      clear('d_dunes', 'dunes', 'Delve into the Tomb of Sands', {
        start: [['caravan_queen_samira', 'The Sun Scarab opens the Tomb. Bring back my water, Wayfarer. And yourself.']] }),
      guardian('dunes', 'Wake and answer {guardian:dunes}'),
      talk('caravan_queen_samira', 'Return to Samira', {
        done: [['caravan_queen_samira', 'The spring is rising! My camels are dancing. It is horrible and wonderful.', 'Take the Sunstone Sigil. The Glassway north is open to you.']] }),
    ],
    turnIn: null,
    reward: { gold: 1400, aether: 450, relic: 'hourglass', items: { thunder_stone: 1 }, rankXp: 500 },
    unlocks: [{ shopTier: 3 }],
  },

  // ── Chapter 8 — "The Crowned Storm" (Stormreach Peaks) ──
  {
    id: 'ch8_peaks', kind: 'main', title: 'The Crowned Storm', chapter: 'Chapter 8 · The Crowned Storm', giver: 'abbot_halvard', region: 'peaks', level: 26,
    summary: 'Skyhold’s storm bells have fallen silent. Without them, Abbot Halvard fears the storm on the Crown will break loose this year.',
    requires: { region: 'peaks' }, auto: true,
    steps: [
      talk('abbot_halvard', 'Meet Abbot Halvard in Skyhold', {
        start: [['oakspeaker_fenn', 'The Frostbark Gate leads up to Skyhold. The monks there ring the storm to sleep. Or did.']],
        done: [
          ['abbot_halvard', 'Welcome to Skyhold. Mind the stairs — the last visitor fell up them.', 'Our bells once rang the storm to sleep each winter. Kai’s mother rang them last.'],
          ['abbot_halvard', 'The Veil crept up in the night and stole the clappers.', 'Now the storm grows, and no one can sing it down.'],
        ] }),
      reach('poi:p_glacier', 'Climb to Skyhold Glacier'),
      veil('veil_rime', 'poi:p_glacier@80:12', 'Take back the stolen bell clappers', {
        start: [['veil_rime', 'The bells called the storm down every year. So we took the clappers. Simple.']] }),
      { type: 'deliver', npc: 'abbot_halvard', item: 'bell_clapper', count: 1, text: 'Return the clapper to Abbot Halvard',
        done: [['abbot_halvard', 'Listen—', 'The first bell to ring in a month. I may weep. I am weeping.']] },
      kai(5, 'town:peaks@60:16', 'Kai is waiting in Skyhold'),
      clear('d_peaks', 'peaks', 'Cross the Frostfang Caverns'),
      guardian('peaks', 'Answer {guardian:peaks} on the heights'),
      talk('abbot_halvard', 'Return to Abbot Halvard', {
        done: [['abbot_halvard', 'The Storm Sigil. The Stormcrown only gives it to those it respects.', 'Look — the Skybridge to the Hollows burns bright again.']] }),
    ],
    turnIn: null,
    reward: { gold: 1800, aether: 500, relic: 'storm_feather', rankXp: 700 },
    unlocks: [{ shopTier: 4 }],
  },

  // ── Chapter 9 — "The Humming Deep" (Glimmer Hollows) ──
  {
    id: 'ch9_hollows', kind: 'main', title: 'The Humming Deep', chapter: 'Chapter 9 · The Humming Deep', giver: 'forewoman_brigid', region: 'hollows', level: 26,
    summary: 'Glimmerhold’s miners hear the rock humming like a heartbeat. Forewoman Brigid has found Veil tools in the deepest shaft.',
    requires: { region: 'hollows' }, auto: true,
    steps: [
      talk('forewoman_brigid', 'Meet Forewoman Brigid in Glimmerhold', {
        start: [['caravan_queen_samira', 'North past the Glassway, the miners of Glimmerhold dig by crystal-light. Brigid runs the place. Loudly.']],
        done: [
          ['forewoman_brigid', 'Helmet on. No, the other way. There.', 'Deepglow Mine’s been humming for a week. Not a machine hum. A heartbeat.'],
          ['forewoman_brigid', 'And we found Veil picks in the lowest shaft.', 'Somebody’s digging for the heart of the mountain.'],
        ] }),
      reach('poi:p_mine', 'Descend into Deepglow Mine'),
      veil('veil_facet', 'poi:p_mine@120:10', 'Stop the Veil prospector', {
        start: [['veil_facet', 'Every crystal here holds a little Guardian light. We only need a crown’s worth.']] }),
      kai(5, 'town:hollows@300:16', 'Kai is waiting in Glimmerhold'),
      clear('d_hollows', 'hollows', 'Find the Geode Heart', {
        onStart: [{ reveal: 'd_hollows' }],
        start: [['forewoman_brigid', 'That shard sings the same note as the humming. Follow it — it’ll lead you to the Heart.']] }),
      guardian('hollows', 'Answer {guardian:hollows} in the brightest vein'),
      talk('forewoman_brigid', 'Return to Forewoman Brigid', {
        done: [['forewoman_brigid', 'The humming’s stopped. The miners are singing instead. Worse, honestly.', 'Take the Glimmer Sigil. The Skybridge to the Peaks is yours to cross.']] }),
    ],
    turnIn: null,
    reward: { gold: 1800, aether: 500, relic: 'burst_prism', rankXp: 700 },
    unlocks: [{ shopTier: 4 }],
  },

  // ── Finale — "The Crown" ──
  {
    id: 'fin_crown', kind: 'main', title: 'The Crown', chapter: 'Finale · The Crown', giver: 'elder_maple', region: 'summit', level: 32,
    summary: 'Nine sigils. The Crown Gate stands open. Somewhere above, Magister Vesper is lighting nine stolen lanterns — and the storm is waiting.',
    requires: { bosses: ['vale', 'lakes', 'coast', 'marsh', 'scar', 'elder', 'dunes', 'peaks', 'hollows'] }, auto: true,
    steps: [
      talk('warden_brisa', 'Meet Warden Brisa at the Crown Gate', {
        stage: { warden_brisa: 'gate:g_crown@180:8' },
        start: [['warden_brisa', 'Nine sigils. I felt the Crown Gate open from the south wall. Come — I’ll meet you there.']],
        done: [['warden_brisa', 'Twenty years I watched that door stay shut.', 'Maple and Kai are waiting at Crownfall Camp. Go on. I’ll hold the gate.']] }),
      talk('elder_maple', 'Reach Crownfall Camp on the mountain', {
        stage: { elder_maple: 'town:summit@200:6', rival_kai: 'town:summit@150:7', warden_brisa: 'gate:g_crown@180:8' },
        done: [
          ['elder_maple', 'Vesper was my student. Aurel’s little sister. Kai’s aunt.', 'When the storm took Aurel, Vesper swore it would never take anyone again.'],
          ['elder_maple', 'She means to cage it forever. No storm — but no rain, no seasons, no Mystics born of weather.', 'A quiet sky is a dead sky. Stop her. Gently, if you can.'],
          ['rival_kai', 'I’m coming too. Not to battle you.', 'To stand next to you.'],
        ] }),
      { type: 'clear', id: 'd_crown', text: 'Climb through the Aether Sanctum', at: 'dungeon:d_crown', alt: [{ type: 'reach', id: 'p_ruins' }],
        stage: { elder_maple: 'town:summit@200:6', rival_kai: 'poi:p_ruins@170:16' } },
      veil('magister_vesper', 'poi:p_ruins@180:8', 'Face Magister Vesper at the summit', {
        stage: { magister_vesper: 'poi:p_ruins@180:8', rival_kai: 'poi:p_ruins@160:14', elder_maple: 'town:summit@200:6' },
        start: [
          ['magister_vesper', 'So. The Wayfarer. And little Kai, all grown up.', 'You have your mother’s scowl.'],
          ['rival_kai', 'And you have her eyes. Aunt Vesper — stop. Please.'],
          ['magister_vesper', 'I heard her calling from inside that storm. Twenty years I’ve heard it.', 'Nine lanterns. Enough light to cage it forever. Step aside.'],
        ],
        done: [
          ['rival_kai', 'Nobody else has to lose anyone. We answer it. Like Mum did.'],
          ['magister_vesper', 'The lanterns are breaking — the light is going home—', 'Wayfarer. If it answers you… answer it back.'],
        ] }),
      guardian('summit', 'Answer {guardian:summit}, the heart of the storm', {
        stage: { magister_vesper: 'poi:p_ruins@200:14', rival_kai: 'poi:p_ruins@160:14', elder_maple: 'town:summit@200:6' } }),
      talk('elder_maple', 'Return to Crownfall Camp', {
        stage: { elder_maple: 'town:summit@200:6', rival_kai: 'town:summit@150:7', magister_vesper: 'town:summit@240:8' },
        done: [
          ['elder_maple', 'Listen. Rain. Ordinary, beautiful rain.', 'The storm is sleeping, and the Guardians with it. You did what the Wardens did.'],
          ['magister_vesper', 'I’m going to sit by the fire for a while. If that’s allowed.'],
          ['rival_kai', 'It’s allowed. Aunt Vesper. Weird to say. Good weird.'],
          ['elder_maple', 'The island will always have storms, Wayfarer.', 'Now it has someone to answer them.'],
        ] }),
    ],
    turnIn: null,
    reward: { aether: 2000, tickets: 5, relic: 'crown_of_ages', rankXp: 1500 },
    unlocks: [{ feature: 'postgame' }, { flag: 'credits' }, { shopTier: 5 }],
  },

  // ── Epilogue ──
  {
    id: 'post_kai', kind: 'main', title: 'One Last Battle', chapter: 'Epilogue', giver: 'rival_kai', region: 'summit', level: 40,
    summary: 'No chart, no Veil, no storm. Kai wants one real battle at the top of the world.',
    requires: { quests: ['fin_crown'] }, auto: true,
    steps: [
      kai(7, 'poi:p_ruins@140:10', 'Meet Kai at the Sky Warden Ruins', {
        start: [['rival_kai', 'Hey. Meet me at the Ruins? One last battle. For real this time.']] }),
    ],
    turnIn: null,
    reward: { aether: 800, relic: 'aether_well', rankXp: 800 },
  },
  {
    id: 'post_starfall', kind: 'main', title: 'Where the Star Fell', chapter: 'Epilogue', giver: 'elder_maple', region: 'coast', level: 34,
    summary: 'Maple found Aurel’s old star chart. It marks an islet off the Sapphire Coast where a star fell into the sea.',
    requires: { quests: ['fin_crown'] }, auto: true,
    steps: [
      talk('elder_maple', 'Visit Elder Maple in Hearthwick', {
        start: [['elder_maple', 'I found something of Aurel’s. Come home when you can, Wayfarer.']],
        done: [['elder_maple', 'Aurel’s star chart. She always said a star fell off the Sapphire Coast.', 'At low tide a sandbar reaches the islet. She never got to go. You should.']],
        onDone: [{ give: { items: { star_chart: 1 } } }, { reveal: 'd_starfall' }] }),
      clear('d_starfall', 'summit', 'Explore the Starfall Grotto', { alt: [] }),
      talk('elder_maple', 'Tell Elder Maple what you found', {
        done: [['elder_maple', 'A cave full of starlight. Oh, she would have loved that.', 'Thank you for going for her.']] }),
    ],
    turnIn: null,
    reward: { aether: 1000, orbs: { sovereign: 3 }, rankXp: 600 },
  },
  {
    id: 'post_legend', kind: 'main', title: 'A Wayfarer’s Legend', chapter: 'Epilogue', giver: 'elder_maple', region: 'vale', level: 35,
    summary: 'Every Warden kept a Mysticodex. Maple wants yours to be the fullest one the island has ever seen.',
    requires: { quests: ['fin_crown'] }, auto: true,
    steps: [
      { type: 'dex', count: 80, text: 'Register 80 Mystics in your Mysticodex', at: 'npc:elder_maple' },
      talk('elder_maple', 'Show Elder Maple your Mysticodex', {
        done: [['elder_maple', 'Eighty! Aurel stopped at sixty-one. Don’t tell Kai I said so.']] }),
    ],
    turnIn: null,
    reward: { aether: 2000, orbs: { astral: 1 }, rankXp: 1000 },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// SIDE QUESTS — at least three per town, each with a named giver and a small story
// ═══════════════════════════════════════════════════════════════════════════
const AFTER_TUTORIAL: Requires = { quests: ['ch1_first_steps'] };

export const SIDE_QUESTS: QuestDef[] = [
  // ── Hearthwick (Verdant Vale) ──
  {
    id: 'side_vale_daisy', kind: 'side', title: 'Daisy Went Walking', giver: 'farmer_hask', region: 'vale', level: 4, requires: AFTER_TUTORIAL,
    summary: 'Farmer Hask’s Moolet, Daisy, bolts whenever it thunders. She was his late wife’s, and she’s missing again.',
    offer: [['farmer_hask', 'Wayfarer! My Moolet, Daisy, ran off again. She does that when it thunders.', 'She was my Elsie’s. Soft as butter, stubborn as a gate. Would you look for her?']],
    steps: [
      reach('poi:p_windmill', 'Look for Daisy at Miller’s Rise'),
      { type: 'defeat', species: 'voltcat', zone: 'vale', count: 2, at: 'poi:p_windmill@120:30', text: 'Chase off 2 Voltcats spooking the fields',
        start: [['farmer_hask', 'Hoofprints at the Rise? And scorch marks? Voltcats. Daisy hates thunder. Always has.']] },
    ],
    complete: [
      ['farmer_hask', 'She walked in the barn door an hour ago, bold as brass, like nothing happened.', 'Voltcats, was it? She never liked a storm. Neither did my Elsie.'],
      ['farmer_hask', 'Here. And come by for milk sometime. Daisy insists.'],
    ],
    reward: { gold: 250, items: { berry_treat: 3, super_tonic: 1 }, rankXp: 40 },
  },
  {
    id: 'side_vale_letters', kind: 'side', title: 'Letters for the Road', giver: 'postmistress_ada', region: 'vale', level: 9, requires: { bosses: ['vale'] },
    summary: 'The passes are open at last, and Postmistress Ada has a year of letters for Stillwater and Tidewatch.',
    offer: [['postmistress_ada', 'The passes are open! A year of letters for Stillwater and Tidewatch, finally moving.', 'You’re going that way anyway, dear. Everyone is now.']],
    steps: [
      { type: 'deliver', npc: 'ferrywoman_ysolde', item: 'letter_bundle', count: 1, text: 'Deliver letters to Ysolde in Stillwater',
        onStart: [{ give: { items: { letter_bundle: 2 } } }],
        done: [['ferrywoman_ysolde', 'Letters! One from my brother. He still can’t spell “ferry”.']] },
      { type: 'deliver', npc: 'captain_marlow', item: 'letter_bundle', count: 1, text: 'Deliver letters to Captain Marlow in Tidewatch',
        done: [['captain_marlow', 'Post! From my old first mate. Says he’s taken up knitting. Ha!']] },
    ],
    complete: [['postmistress_ada', 'Both towns? You’re faster than my pigeons, and they’re very committed.']],
    reward: { gold: 600, items: { escape_shard: 2 }, rankXp: 80 },
  },
  {
    id: 'side_vale_beacon', kind: 'side', title: 'The Vale Beacon', giver: 'lamplighter_jory', region: 'vale', level: 5, requires: AFTER_TUTORIAL,
    summary: 'Old Jory has lit the Vale Beacon every night for thirty years — until wild Mystics chased him off the hill.',
    offer: [['lamplighter_jory', 'The Vale Beacon’s gone cold. Thirty years I’ve lit it, every night.', 'Last night wild Mystics chased me off the hill. My knees aren’t what they were.']],
    steps: [
      { type: 'win', zone: 'vale', kind: 'wild', count: 2, at: 'poi:p_beacon', text: 'Clear wild Mystics near the Vale Beacon' },
      reach('poi:p_beacon', 'Light the Vale Beacon after dark', { night: true, radius: 20,
        start: [['lamplighter_jory', 'Now wait for dark and light her up. The flint’s in the little box. It sticks.']] }),
    ],
    complete: [['lamplighter_jory', 'I saw it from my window. Bright as the night my father taught me.', 'Thirty years. You’d think I’d be tired of it. I’m not.']],
    reward: { gold: 300, items: { lure_incense: 2, ward_incense: 2 }, rankXp: 60 },
  },
  {
    id: 'side_vale_home', kind: 'side', title: 'A Place to Call Home', giver: 'carpenter_edda', region: 'vale', level: 4, requires: AFTER_TUTORIAL,
    summary: 'Edda the carpenter says every Wayfarer needs a homestead, and the empty plot east of Hearthwick is yours.',
    offer: [['carpenter_edda', 'Every Wayfarer needs a homestead. That empty plot east of town is yours if you want it.', 'Build something. Anything. A shed! I love a shed.']],
    steps: [
      reach('homestead', 'Visit your Homestead plot', { radius: 26 }),
      count('build', 2, 'Build 2 structures at your Homestead', { at: 'homestead',
        start: [['carpenter_edda', 'Press H on your plot to start building. Mills make timber, quarries make stone.']] }),
    ],
    complete: [['carpenter_edda', 'Look at that! Crooked in all the right places.']],
    reward: { gold: 200, materials: { wood: 30, stone: 30 }, rankXp: 40 },
  },
  {
    id: 'side_vale_eggs', kind: 'side', title: 'Egg Hunt', giver: 'nan_rosehip', region: 'vale', level: 6, requires: { quests: ['ch1_first_bond'] },
    summary: 'Nan Rosehip has minded Hearthwick’s hatchery for fifty years. She likes to hear about every new arrival.',
    offer: [['nan_rosehip', 'Eggs love footsteps, dearie. The more you walk, the sooner they hatch.', 'Hatch two for me? I like to hear about every one.']],
    steps: [{ type: 'hatch', count: 2, at: 'service:vale:hatchery', text: 'Hatch 2 eggs' }],
    complete: [['nan_rosehip', 'Two little ones! Did they squeak? The best ones squeak.']],
    reward: { aether: 160, items: { hatch_charm: 1 }, rankXp: 60 },
  },

  // ── Stillwater (Mirror Lakes) ──
  {
    id: 'side_lakes_poem', kind: 'side', title: 'Reflections', giver: 'poet_linnea', region: 'lakes', level: 10,
    summary: 'Linnea writes a poem for every Mystic she meets. The one about water is missing its last line.',
    offer: [['poet_linnea', 'I write a poem for every Mystic I meet. I’m stuck on the one about water.', 'Catch me a Water Mystic from the lakes by moonlight? Then I’ll find my last line.']],
    steps: [{ type: 'catch', element: 'water', zone: 'lakes', night: true, count: 1, at: 'poi:p_mirror', text: 'Catch a Water Mystic in the Lakes at night' }],
    complete: [['poet_linnea', '“Still water keeps the stars / the way the heart keeps names.” Too sad? Too sad.', 'Here — for the inspiration.']],
    reward: { gold: 500, orbs: { tide: 3 }, rankXp: 80 },
  },
  {
    id: 'side_lakes_reeds', kind: 'side', title: 'Reeds for the Boats', giver: 'boatwright_oren', region: 'lakes', level: 9,
    summary: 'Half of Stillwater’s ferries are leaking. Oren the boatwright needs fibre to patch them.',
    offer: [['boatwright_oren', 'Half the ferries are leaking. The other half are sinking with more confidence.', 'Bring me twelve bundles of fibre and I’ll patch them up.']],
    steps: [{ type: 'count', event: 'gather', material: 'fiber', count: 12, at: 'region:lakes', text: 'Gather 12 Fiber' }],
    complete: [['boatwright_oren', 'Beautiful. That’ll hold a boat. Probably. Mostly.']],
    reward: { gold: 450, items: { worm_bait: 5, reed_bundle: 1 }, rankXp: 60 },
  },
  {
    id: 'side_lakes_twins', kind: 'side', title: 'The Twins’ Wager', giver: 'twins_mira', region: 'lakes', level: 10,
    summary: 'Mira bet her brother Milo a month of chores that wild Finnik live in the lakes. She needs proof.',
    offer: [['twins_mira', 'Milo says there are no Finniks in the lakes. I say there are. Loser does chores for a month.', 'Search the tall grass for me? And catch one, if you can. Please. It’s a MONTH.']],
    steps: [
      { type: 'count', event: 'grass', zone: 'lakes', count: 4, at: 'region:lakes', text: 'Find 4 Mystics in the Lakes’ tall grass' },
      { type: 'catch', species: 'finnik', count: 1, at: 'region:lakes', text: 'Catch a Finnik' },
    ],
    complete: [['twins_mira', 'HA! Milo! MILO! Chores! A MONTH!', 'Thank you, Wayfarer. Take my allowance. All of it.']],
    reward: { gold: 380, items: { water_stone: 1 }, rankXp: 80 },
  },

  // ── Tidewatch (Sapphire Coast) ──
  {
    id: 'side_coast_belfry', kind: 'side', title: 'Bells Under the Reef', giver: 'diver_saoirse', region: 'coast', level: 11,
    summary: 'A whole village drowned under Bellreef long ago. Saoirse the diver wants to know what lives in its belfry now.',
    offer: [['diver_saoirse', 'There’s a drowned village under Bellreef. You can hear its bells at slack tide.', 'Fish up two Mystics out there for me? I want to know who lives in the belfry now.']],
    steps: [
      reach('poi:p_reef', 'Go to Bellreef Shallows'),
      { type: 'catch', how: 'fish', zone: 'coast', count: 2, at: 'poi:p_reef', text: 'Fish up 2 Mystics off the coast' },
    ],
    complete: [['diver_saoirse', 'Those came up from the belfry? Then the old village isn’t empty.', 'It just moved on. Like we all do, I suppose.']],
    reward: { gold: 520, items: { glow_bait: 3, sea_glass: 1 }, rankXp: 80 },
  },
  {
    id: 'side_coast_crabs', kind: 'side', title: 'Crab Fight!', giver: 'fisher_tam', region: 'coast', level: 9,
    summary: 'Young Tam’s bait keeps vanishing. The culprits have claws and very smug faces.',
    offer: [['fisher_tam', 'Clackers keep nicking my bait! Five of them. I counted. They have smug little faces.', 'Beat ’em for me? Not too hard. Just a lesson.']],
    steps: [{ type: 'defeat', species: 'clacker', zone: 'coast', count: 5, at: 'region:coast', text: 'Defeat 5 Clackers on the coast' }],
    complete: [['fisher_tam', 'They’re gone! Well — sulking under rocks. Same thing.']],
    reward: { gold: 400, items: { worm_bait: 6 }, rankXp: 60 },
  },
  {
    id: 'side_coast_widow', kind: 'side', title: 'The Keeper’s Widow', giver: 'widow_rosalind', region: 'coast', level: 12, requires: { quests: ['ch3_coast'] },
    summary: 'Rosalind’s husband sailed out the night the light first failed, long ago. She has one last letter for him.',
    offer: [['widow_rosalind', 'My husband sailed out the night the light first failed. Long before your time.', 'I wrote him a letter. Drop it from the top of the Light? He always said he’d see the light first.']],
    steps: [reach('poi:p_lighthouse', 'Drop Rosalind’s letter from Tidewatch Light', { radius: 25 })],
    complete: [['widow_rosalind', 'Thank you, dear. I know he can’t read it. It’s for me, really.', 'The light’s bright again. That’s enough. That’s more than enough.']],
    reward: { gold: 300, items: { tide_charm: 1 }, rankXp: 60 },
  },

  // ── Mirehaven (Mistveil Marsh) ──
  {
    id: 'side_marsh_names', kind: 'side', title: 'Names for the Lanterns', giver: 'lantern_fen', region: 'marsh', level: 15,
    summary: 'Fen, Mirehaven’s youngest lamplighter, writes the name of every Mystic caught at night on his lantern. The fog can’t take a written name.',
    offer: [['lantern_fen', 'Mother Sedge says names keep the fog away. Every Mystic caught at night gets one.', 'Catch three after dark? I’ll write them on my lantern.']],
    steps: [{ type: 'catch', zone: 'marsh', night: true, count: 3, at: 'region:marsh', text: 'Catch 3 Mystics in the Marsh after dark' }],
    complete: [['lantern_fen', 'Three new names! The fog can’t have them now.']],
    reward: { orbs: { dusk: 5 }, items: { void_stone: 1 }, rankXp: 100 },
  },
  {
    id: 'side_marsh_soup', kind: 'side', title: 'Glowcap Soup', giver: 'nana_brine', region: 'marsh', level: 15,
    summary: 'Nana Brine’s glowcap soup cures homesickness. It tastes like a wet sock, but it works.',
    offer: [['nana_brine', 'My glowcap soup cures homesickness. Tastes like a wet sock, but it works.', 'Search the marsh nests for five glowcaps, love.']],
    steps: [
      { type: 'collect', item: 'glowcap', count: 5, drop: { event: 'search', zone: 'marsh' }, at: 'region:marsh', text: 'Search Marsh nests for 5 Glowcaps' },
      { type: 'deliver', npc: 'nana_brine', item: 'glowcap', count: 5, text: 'Bring the Glowcaps to Nana Brine' },
    ],
    complete: [['nana_brine', 'There. One bowl. Drink it all. Yes, all. I saw that face.']],
    reward: { gold: 600, items: { marsh_tea: 2, cleanse: 3 }, rankXp: 100 },
  },
  {
    id: 'side_marsh_ivy', kind: 'side', title: 'The Girl Who Forgot', giver: 'ghost_ivy', region: 'marsh', level: 17,
    summary: 'A pale girl waits by the water, looking for the name she dropped on the boardwalk long ago.',
    offer: [['ghost_ivy', 'Hello. Have you seen my name? I dropped it on the boardwalk. Long ago, I think.', 'It shines a little. The void Mystics like shiny things.']],
    steps: [
      { type: 'defeat', element: 'void', zone: 'marsh', count: 4, at: 'poi:p_boardwalk', text: 'Defeat 4 Void Mystics in the Marsh' },
      reach('poi:p_boardwalk', 'Search the Lantern Boardwalk at night', { night: true, radius: 25, onDone: [{ give: { items: { lost_locket: 1 } } }] }),
      { type: 'deliver', npc: 'ghost_ivy', item: 'lost_locket', count: 1, text: 'Return the silver locket to Ivy' },
    ],
    complete: [
      ['ghost_ivy', '“Come home when the lanterns are lit.” That was Mother’s voice.', 'My name is Ivy. My name is Ivy.'],
      ['ghost_ivy', 'The lanterns are lit now. I think… I can go home.'],
    ],
    reward: { aether: 300, items: { moon_lily: 1, phoenix_ash: 1 }, rankXp: 120 },
  },

  // ── Cinderrest (Ember Scar) ──
  {
    id: 'side_scar_parry', kind: 'side', title: 'Tempered', giver: 'apprentice_cole', region: 'scar', level: 14,
    summary: 'Cole, the Forge’s newest apprentice, wants to learn when to strike and when to hold — from a Wayfarer.',
    offer: [['apprentice_cole', 'Forgemother says a good smith knows when to strike and when to hold.', 'You Wayfarers parry! Do twenty and I’ll watch very closely.']],
    steps: [count('parry', 20, 'Parry 20 strikes in battle', { at: 'npc:apprentice_cole' })],
    complete: [['apprentice_cole', 'Twenty! I tried it on the anvil. The anvil won.']],
    reward: { relic: 'parry_sigil', rankXp: 150 },
  },
  {
    id: 'side_scar_ore', kind: 'side', title: 'Deep Veins', giver: 'miner_dagny', region: 'scar', level: 14,
    summary: 'The Veil scared Dagny’s crew out of the lower seams, and the Forge is hungry.',
    offer: [['miner_dagny', 'The Veil scared my crew out of the lower seams. The Forge is hungry.', 'Fifteen ore, Wayfarer. Just fifteen.']],
    steps: [{ type: 'count', event: 'gather', material: 'ore', count: 15, at: 'region:scar', text: 'Gather 15 Ore' }],
    complete: [['miner_dagny', 'Good weight. Good colour. You’ve got a miner’s eye.']],
    reward: { gold: 700, items: { fire_stone: 1 }, rankXp: 100 },
  },
  {
    id: 'side_scar_stew', kind: 'side', title: 'Lava Pepper Stew', giver: 'cook_pepper', region: 'scar', level: 15,
    summary: 'Cinderrest’s cook needs ember peppers for her famous stew. The fire Mystics keep eating them.',
    offer: [['cook_pepper', 'My stew needs ember peppers. The fire Mystics eat them all!', 'Win back four. Don’t lick your fingers after.']],
    steps: [
      { type: 'collect', item: 'ember_pepper', count: 4, drop: { event: 'defeat', element: 'fire', zone: 'scar' }, at: 'region:scar', text: 'Win 4 Ember Peppers from Fire Mystics' },
      { type: 'deliver', npc: 'cook_pepper', item: 'ember_pepper', count: 4, text: 'Bring the peppers to Pepper' },
    ],
    complete: [['cook_pepper', 'Now THAT is a stew. My eyebrows are gone. Worth it.']],
    reward: { gold: 650, items: { burn_salve: 5, star_candy: 1 }, rankXp: 100 },
  },

  // ── Elderhollow (Elderwood) ──
  {
    id: 'side_elder_story', kind: 'side', title: 'Seeds of Stories', giver: 'storyteller_wynn', region: 'elder', level: 19,
    summary: 'Grandmother Wynn collects beginnings. Every egg, she says, is a story that hasn’t started yet.',
    offer: [['storyteller_wynn', 'Every egg is a story that hasn’t started yet. I collect beginnings.', 'Hatch one for me, then tell the Elder Tree who came out.']],
    steps: [
      { type: 'hatch', count: 1, at: 'npc:storyteller_wynn', text: 'Hatch an egg' },
      reach('poi:p_eldertree', 'Tell the Elder Tree about it'),
    ],
    complete: [['storyteller_wynn', 'The tree rustled, did it? It does that when it likes a story.']],
    reward: { gold: 800, items: { leaf_stone: 1, berry_treat: 5 }, rankXp: 120 },
  },
  {
    id: 'side_elder_thorn', kind: 'side', title: 'Thorn in the Side', giver: 'ranger_holt', region: 'elder', level: 20,
    summary: 'Thornets are swarming the forest roads, and nobody can get to market.',
    offer: [['ranger_holt', 'Thornets are swarming the paths. Nobody can get to market.', 'Clear six Nature Mystics off the roads? My knees will thank you.']],
    steps: [{ type: 'defeat', element: 'nature', zone: 'elder', count: 6, at: 'region:elder', text: 'Defeat 6 Nature Mystics in the Elderwood' }],
    complete: [['ranger_holt', 'Roads are clear. Somebody’s already selling pies again.']],
    reward: { gold: 850, items: { super_tonic: 4 }, rankXp: 120 },
  },
  {
    id: 'side_elder_firefly', kind: 'side', title: 'The Firefly Jar', giver: 'girl_poppy', region: 'elder', level: 20,
    summary: 'Poppy has heard that Glenharts carry fireflies in their antlers. She has never seen one up close.',
    offer: [['girl_poppy', 'Glenharts carry fireflies in their antlers! I’ve never seen one up close.', 'Could you catch one? I promise I’ll just look. And maybe pat. Gently.']],
    steps: [{ type: 'catch', species: 'glenhart', count: 1, at: 'region:elder', text: 'Catch a Glenhart' }],
    complete: [['girl_poppy', 'It’s SO tall. Its antlers have little lights in them!', 'Can I ride it? I can’t ride it. Okay.']],
    reward: { gold: 700, orbs: { grand: 2 }, rankXp: 120 },
  },

  // ── Sunreach (Sunscorch Dunes) ──
  {
    id: 'side_dunes_water', kind: 'side', title: 'Water for the Caravan', giver: 'water_ines', region: 'dunes', level: 19,
    summary: 'Ines carries water from the Last Oasis to the caravans — or did, until the wild Mystics got thirsty.',
    offer: [['water_ines', 'I carry water from the oasis to the caravans. Or I did, before the wild Mystics got thirsty.', 'Clear five of them off the dunes?']],
    steps: [
      { type: 'defeat', zone: 'dunes', count: 5, at: 'region:dunes', text: 'Defeat 5 wild Mystics in the Dunes' },
      reach('poi:p_oasis', 'Check on the Last Oasis'),
    ],
    complete: [['water_ines', 'Clear roads, full jugs. You’re a blessing in boots.']],
    reward: { gold: 900, items: { oasis_water: 3 }, rankXp: 120 },
  },
  {
    id: 'side_dunes_script', kind: 'side', title: 'Sand Script', giver: 'scholar_ptah', region: 'dunes', level: 20,
    summary: 'Old stones with writing lie under the dunes. Scholar Ptah is sure the glimmering nests hide the best of them.',
    offer: [['scholar_ptah', 'The dunes bury old stones with writing on them. The nests hide them best.', 'Search six glimmering nests in the Dunes? I’ll translate whatever you find.']],
    steps: [{ type: 'count', event: 'search', zone: 'dunes', count: 6, at: 'region:dunes', text: 'Search 6 glimmering nests in the Dunes' }],
    complete: [['scholar_ptah', '“Here the Wardens rested, and the sand kept their secrets.”', 'Beautiful. Useless. Beautiful.']],
    reward: { gold: 950, items: { desert_rose: 1, earth_stone: 1 }, rankXp: 120 },
  },
  {
    id: 'side_dunes_change', kind: 'side', title: 'Changing Sands', giver: 'racer_kip', region: 'dunes', level: 20,
    summary: 'Kip lost a race when his Dustclaw evolved at the finish line. He calls it the best day of his life.',
    offer: [['racer_kip', 'My Dustclaw evolved mid-race and I lost. Best day of my life.', 'Evolve two Mystics. Trust me. It’s the best feeling.']],
    steps: [{ type: 'evolve', count: 2, at: 'npc:racer_kip', text: 'Evolve 2 Mystics' }],
    complete: [['racer_kip', 'See?! Doesn’t it feel like the whole world got bigger?']],
    reward: { aether: 300, items: { thunder_stone: 1, wind_stone: 1 }, rankXp: 120 },
  },

  // ── Skyhold (Stormreach Peaks) ──
  {
    id: 'side_peaks_towers', kind: 'side', title: 'The Sparking Towers', giver: 'bellringer_tomas', region: 'peaks', level: 24,
    summary: 'Storm Mystics roost in Skyhold’s bell towers now. Brother Tomas would like his towers back.',
    offer: [['bellringer_tomas', 'Storm Mystics roost in the bell towers now. Rude, sparky and very loud.', 'Defeat four of them? Gently. They’re pilgrims, in their way.']],
    steps: [{ type: 'defeat', element: 'storm', zone: 'peaks', count: 4, at: 'region:peaks', text: 'Defeat 4 Storm Mystics in the Peaks' }],
    complete: [['bellringer_tomas', 'The towers are quiet. I’ll miss the sparks, a little.']],
    reward: { gold: 1000, items: { thunder_stone: 1 }, rankXp: 150 },
  },
  {
    id: 'side_peaks_greta', kind: 'side', title: 'Summit Fever', giver: 'mountaineer_greta', region: 'peaks', level: 24,
    summary: 'Greta has climbed forty summits and got lost on every one. Waystones are how she gets home.',
    offer: [['mountaineer_greta', 'Forty summits! Lost twice on each. Waystones are how I get home.', 'Attune two Waystones in the Peaks and you’ll never be lost up here either.']],
    steps: [{ type: 'attune', zone: 'peaks', count: 2, text: 'Attune 2 Waystones in the Peaks' }],
    complete: [['mountaineer_greta', 'Now you’re a proper mountaineer. Lost, but efficiently.']],
    reward: { gold: 900, items: { escape_shard: 3, snow_bloom: 1 }, rankXp: 150 },
  },
  {
    id: 'side_peaks_lio', kind: 'side', title: 'Light on Your Feet', giver: 'novice_lio', region: 'peaks', level: 23,
    summary: 'Novice Lio falls over a lot. The Abbot has noticed. Lio would like to learn to jump like a Wayfarer.',
    offer: [['novice_lio', 'The Abbot says I fall over too much. I’ve fallen four times today. Five.', 'You jump shockwaves in battle! Do fifteen and teach me the trick?']],
    steps: [count('jump_dodge', 15, 'Jump over 15 shockwaves in battle', { at: 'npc:novice_lio' })],
    complete: [['novice_lio', 'Knees soft, eyes up, jump before you think. Got it. Ow. Got it.']],
    reward: { relic: 'dancer_anklet', rankXp: 150 },
  },

  // ── Glimmerhold (Glimmer Hollows) ──
  {
    id: 'side_hollows_canary', kind: 'side', title: 'Canary', giver: 'miner_pim', region: 'hollows', level: 24,
    summary: 'Miners used to carry a Storm Mystic down the shafts: if the sparks died, you ran. Pim’s retired to a hammock.',
    offer: [['miner_pim', 'Miners carried a Storm Mystic down the shafts. If the sparks died, you ran.', 'Catch me a new one? Mine retired. To a hammock.']],
    steps: [
      reach('poi:p_mine', 'Go to Deepglow Mine'),
      { type: 'catch', element: 'storm', zone: 'hollows', count: 1, at: 'poi:p_mine', text: 'Catch a Storm Mystic in the Hollows' },
    ],
    complete: [['miner_pim', 'Look at it crackle! We’ll be friends. Mostly it’ll be a lamp.']],
    reward: { gold: 1000, orbs: { grand: 3 }, rankXp: 150 },
  },
  {
    id: 'side_hollows_cogs', kind: 'side', title: 'Clockwork Friends', giver: 'tinker_quill', region: 'hollows', level: 24,
    summary: 'Coglings wake in the ruins and follow the first friendly face they see. Quill wants to see what the old kingdom built.',
    offer: [['tinker_quill', 'Coglings wake in the ruins and follow the first friendly face they see.', 'Catch one, then evolve a Mystic. I want to see what the old kingdom built.']],
    steps: [
      { type: 'catch', species: 'cogling', count: 1, at: 'region:hollows', text: 'Catch a Cogling' },
      { type: 'evolve', count: 1, at: 'npc:tinker_quill', text: 'Evolve a Mystic' },
    ],
    complete: [['tinker_quill', 'Magnificent. It beeps in a slightly deeper voice now.']],
    reward: { gold: 1100, items: { thunder_stone: 1, geode_candy: 2 }, rankXp: 150 },
  },
  {
    id: 'side_hollows_lamp', kind: 'side', title: 'The Humming Vein', giver: 'widower_hal', region: 'hollows', level: 25,
    summary: 'Hal’s wife loved the crystal light of the deep shafts. He wants to build a lamp from it for her grave.',
    offer: [['widower_hal', 'My wife loved the crystal light down in the deep shafts. She’s gone now.', 'I want to make her a lamp from it. Ten crystals. Please.']],
    steps: [{ type: 'count', event: 'gather', material: 'crystal', count: 10, at: 'region:hollows', text: 'Gather 10 Crystal' }],
    complete: [['widower_hal', 'It glows just like the shafts. She’d have laughed and said it was too bright.', 'Thank you, Wayfarer. Truly.']],
    reward: { gold: 1200, aether: 200, rankXp: 150 },
  },

  // ── Crownfall Camp (Aether Crown) ──
  {
    id: 'side_summit_shiny', kind: 'side', title: 'Shimmer and Shine', giver: 'scout_ren', region: 'summit', level: 30,
    summary: 'Scout Ren swears shiny Mystics shimmer brighter up here, closer to the sky.',
    offer: [['scout_ren', 'Up here the shinies shimmer brighter. Closer to the sky, I reckon.', 'Catch one and prove me right. I’ve been wrong about everything else this week.']],
    steps: [{ type: 'catch', shiny: true, count: 1, text: 'Catch a shiny Mystic anywhere' }],
    complete: [['scout_ren', 'LOOK at it. I was right! Write that down. Somewhere official.']],
    reward: { aether: 800, items: { shimmer_incense: 1 }, rankXp: 200 },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// BOUNTIES — Alphas (elite, oversized wild Mystics with a crown aura)
// The creatures workstream emits `alpha_defeat` / `alpha_catch` { species, zone }.
// ═══════════════════════════════════════════════════════════════════════════
const bounty = (region: string, title: string, giver: string, level: number, pitch: string, reward: Reward, requires: Requires = {}): QuestDef => ({
  id: `bounty_${region}`, kind: 'bounty', title: `Bounty: ${title}`, giver, region, level, board: true,
  summary: `An Alpha is terrorising {land:${region}}. ${pitch}`,
  requires: { features: ['bounties'], region, ...requires },
  offer: [[giver, pitch, 'Defeat it or catch it — either way, the bounty is yours.']],
  steps: [{ type: 'alpha', zone: region, mode: 'either', count: 1, at: `alpha:${region}`, text: `Defeat or catch an Alpha in {land:${region}}` }],
  complete: [[giver, 'The Alpha’s been dealt with? Then the bounty’s yours, fair and square.']],
  reward,
});

export const BOUNTIES: QuestDef[] = [
  bounty('vale', 'The Meadow Menace', 'warden_brisa', 9, 'Something huge with a crown of light is trampling the Vale’s hedgerows.', { gold: 800, orbs: { grand: 2 }, rankXp: 120 }),
  bounty('lakes', 'Lord of the Lakes', 'ferrywoman_ysolde', 14, 'An Alpha is capsizing ferries. The big kind of Alpha.', { gold: 1100, orbs: { grand: 2 }, rankXp: 160 }),
  bounty('coast', 'The Reef Tyrant', 'captain_marlow', 14, 'A crowned brute has claimed the tide pools and bites anything that moves.', { gold: 1100, orbs: { grand: 2 }, rankXp: 160 }),
  bounty('marsh', 'The Fog Beast', 'mother_sedge', 19, 'Something big walks in the fog, and the fog walks with it.', { gold: 1400, orbs: { dusk: 5 }, rankXp: 200 }),
  bounty('scar', 'Cinderhide', 'forgemother_ashka', 19, 'An Alpha is wallowing in the lava pools and scaring off my ore carts.', { gold: 1400, orbs: { ember: 5 }, rankXp: 200 }),
  bounty('elder', 'The Thornwood Brute', 'oakspeaker_fenn', 24, 'An Alpha is tearing up the old glades. The trees are upset. Very upset.', { gold: 1700, orbs: { grand: 3 }, rankXp: 240 }),
  bounty('dunes', 'The Dune Stalker', 'caravan_queen_samira', 24, 'A crowned Alpha is stalking my caravans between the dunes.', { gold: 1700, orbs: { grand: 3 }, rankXp: 240 }),
  bounty('peaks', 'The White Terror', 'abbot_halvard', 29, 'An Alpha has taken the high pass. Our pilgrims turn back in tears.', { gold: 2000, orbs: { sovereign: 1 }, rankXp: 280 }),
  bounty('hollows', 'The Crystal Horror', 'forewoman_brigid', 29, 'Something crowned and glittering is eating my mine carts. Whole.', { gold: 2000, orbs: { sovereign: 1 }, rankXp: 280 }),
  bounty('summit', 'Storm-Touched', 'scout_ren', 35, 'The storm left something behind on the Crown. Big. Angry. Crowned.', { gold: 3000, orbs: { sovereign: 2 }, rankXp: 400 }, { quests: ['fin_crown'] }),
];

// ═══════════════════════════════════════════════════════════════════════════
// DAILIES — three a day, drawn by date
// ═══════════════════════════════════════════════════════════════════════════
const daily = (id: string, title: string, step: StepDef, reward: Reward): QuestDef => ({ id, kind: 'daily', title: `Daily: ${title}`, region: 'vale', summary: step.text + '.', steps: [step], turnIn: null, reward });

export const DAILY_POOL: QuestDef[] = [
  daily('d_win', 'Victor', { type: 'win', count: 5, text: 'Win 5 battles' }, { aether: 60, gold: 250 }),
  daily('d_catch', 'Collector', { type: 'catch', count: 3, text: 'Catch 3 Mystics' }, { aether: 60, orbs: { mystic: 3 } }),
  daily('d_perfect', 'On the Beat', count('perfect', 12, 'Land 12 Perfect hits'), { aether: 50, gold: 200 }),
  daily('d_parry', 'Deflector', count('parry', 8, 'Parry 8 strikes'), { aether: 50, items: { tonic: 2 } }),
  daily('d_gather', 'Forager', count('gather', 15, 'Gather 15 materials'), { aether: 40, materials: { wood: 15, stone: 15 } }),
  daily('d_grass', 'Grass Walker', count('grass', 3, 'Find 3 Mystics in tall grass'), { aether: 40, gold: 200 }),
  daily('d_search', 'Snoop', count('search', 3, 'Search 3 glimmering nests'), { aether: 40, items: { ether: 1 } }),
  daily('d_break', 'Breaker', count('break', 4, 'Break 4 foes'), { aether: 50, gold: 220 }),
  daily('d_travel', 'Road Runner', count('step', 1500, 'Travel 1,500 metres on foot'), { aether: 40, gold: 200 }),
  daily('d_tamer', 'Duelist', { type: 'tamer', count: 2, text: 'Defeat 2 Tamers' }, { aether: 70, gold: 300 }),
  daily('d_quest', 'Good Neighbour', count('quest_done', 1, 'Finish a side quest or bounty'), { aether: 80, gold: 250 }),
];

// ═══════════════════════════════════════════════════════════════════════════
// KAI — the rival's arc, by how many times you have battled him (order-independent)
// ═══════════════════════════════════════════════════════════════════════════
export interface RivalBeat { before: Beat[]; win: Beat[]; lose: Beat[] }
export const KAI_ARC: RivalBeat[] = [
  // 0 — the prologue (the director plays its own scene; these are fallbacks)
  { before: [['rival_kai', 'Let’s see what the new kid’s got!']],
    win: [['rival_kai', 'Wait — what? We met our Mystics five minutes ago!']],
    lose: [['rival_kai', 'Ha! Told you. The chart never lies.']] },
  // 1
  { before: [['rival_kai', 'Grandma says you’re going to answer Thornjaw. YOU.', 'Beat me first. I’ve been practising. Mostly my victory pose.']],
    win: [['rival_kai', 'Okay. You’re good. Annoyingly good.', 'Go on, then. I’ll watch from a safe distance. For science.']],
    lose: [['rival_kai', 'Victory pose! Did you see it? I’ve been working on it.', 'You were close, though. Go on — Thornjaw’s waiting.']] },
  // 2
  { before: [['rival_kai', 'I’ve been training! Forty push-ups a day. My Mystics do most of them.', 'Let’s go!']],
    win: [['rival_kai', 'Fifty push-ups. Tomorrow I’m doing fifty.']],
    lose: [['rival_kai', 'The push-ups WORK. I’m telling everyone.']] },
  // 3
  { before: [['rival_kai', 'The Veil keep talking about a “Magister”. Grandma goes quiet when I ask.', 'Battle me. I think better when I’m losing. I mean winning.']],
    win: [['rival_kai', 'She’s hiding something. Grandmas always are.']],
    lose: [['rival_kai', 'Ha! Now help me figure out what Grandma isn’t telling me.']] },
  // 4
  { before: [['rival_kai', 'Grandma finally told me. My mum was a Sky Warden — the last one.', 'She climbed the Crown twenty years ago and didn’t come down.'], ['rival_kai', 'Battle me. I need to hit something that hits back.']],
    win: [['rival_kai', 'I want to know what happened up there.', 'Don’t tell anyone I cried. My Mystic cried. Not me.']],
    lose: [['rival_kai', 'Thanks. I needed that. Don’t tell anyone I cried.']] },
  // 5
  { before: [['rival_kai', 'Mum’s old journal says the Veil used to be the Wardens’ lamplighters. Helpers!', 'Something went wrong between them. Battle first, mystery second.']],
    win: [['rival_kai', 'I’m going to find out what went wrong. You’ll help. You don’t get a vote.']],
    lose: [['rival_kai', 'Lamplighters. Helpers. What happened to you, Veil?']] },
  // 6
  { before: [['rival_kai', 'The Magister’s name is Vesper. Grandma says she was Mum’s sister.', 'My aunt. My AUNT is the villain. This island is ridiculous.']],
    win: [['rival_kai', 'If she’s family… maybe she’ll listen. Maybe.']],
    lose: [['rival_kai', 'Sorry. Family stuff makes me hit harder.']] },
  // 7
  { before: [['rival_kai', 'A few more sigils and the Crown Gate opens. I’ll be there.', 'We go up together. But first — for old times’ sake!']],
    win: [['rival_kai', 'Together, then. Don’t be slow.']],
    lose: [['rival_kai', 'Together. And I’m carrying the snacks, because I won.']] },
  // 8
  { before: [['rival_kai', 'Last one before the Crown. Give it everything.']],
    win: [['rival_kai', 'Mum would’ve liked you. She liked people who don’t give up.']],
    lose: [['rival_kai', 'Okay. I feel ready. Are you ready? Be ready.']] },
  // 9
  { before: [['rival_kai', 'You found me! Battle? Battle.']],
    win: [['rival_kai', 'See you at the top.']],
    lose: [['rival_kai', 'See you at the top!']] },
];
/** The post-game rematch (Epilogue) always uses this beat. */
export const KAI_FINAL: RivalBeat = {
  before: [['rival_kai', 'No chart. No Veil. No storm.', 'Just us, at the top of the world. Ready?']],
  win: [['rival_kai', 'Heh. Of course. You were always going to be the Warden, weren’t you?', 'I’m glad it was you.']],
  lose: [['rival_kai', 'I WON. At the top of the world! Nobody can ever take that away.', 'Rematch whenever you like. Seriously. I’ll be up here. Forever, probably.']],
};

export const ALL_QUESTS: QuestDef[] = [...MAIN_QUESTS, ...SIDE_QUESTS, ...BOUNTIES, ...DAILY_POOL];
const BY_ID = new Map(ALL_QUESTS.map((q) => [q.id, q]));
export const questDef = (id: string) => BY_ID.get(id);
