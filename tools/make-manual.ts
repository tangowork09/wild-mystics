// Builds the Wild Mystics Field Manual (PDF) straight from game data, so numbers always match the build.
//   npx tsx tools/make-manual.ts            (needs the dev server on :5180 for portraits)
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { SPECIES, STARTERS, evolutionStages } from '../src/data/species';
import { ELEMENTS, effectiveness, type Element } from '../src/data/elements';
import { ABILITIES, NATURES, RARITY, RARITY_ORDER, STATUS } from '../src/data/traits';
import { ITEMS, ORBS, MATERIALS } from '../src/data/items';
import { RELICS, RELIC_MAX_LEVEL } from '../src/data/relics';
import { SKILLS } from '../src/data/skills';
import { ZONES, type SpawnMethod } from '../src/data/zones';
import { STRUCTURES, PRODUCTION_CAP_HOURS } from '../src/data/structures';
import { TAMERS } from '../src/data/tamers';
import { QUESTS, DAILY_POOL, ACHIEVEMENTS, LOGIN_REWARDS, RANK_TITLES } from '../src/data/progression';
import { RATES, SOFT_PITY, HARD_PITY, EPIC_PITY, ESSENCE_FOR_DUPE, PULL_COST, TEN_COST } from '../src/data/gacha';
import { ICON_PATHS, ICON_ALIAS } from '../src/ui/iconset';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT_DIR = path.join(ROOT, 'docs');
fs.mkdirSync(OUT_DIR, { recursive: true });

const ic = (name: string, color = 'currentColor') => {
  const d = ICON_PATHS[name] ?? ICON_PATHS[ICON_ALIAS[name] ?? ''] ?? 'M256 40l216 216-216 216L40 256z';
  return `<svg class="ic" viewBox="0 0 512 512"><path fill="${color}" d="${d}"/></svg>`;
};
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
const el = (e: Element) => `<span class="elb" style="--c:${ELEMENTS[e].color}">${ic(e, ELEMENTS[e].color)}${ELEMENTS[e].name}</span>`;
const rar = (r: keyof typeof RARITY) => `<span class="rar" style="--c:${RARITY[r].color}">${RARITY[r].name}</span>`;
/** Opaque blend of a colour into the page ink (PDF shading stays vector only when fully opaque). */
const mixInk = (hex: string, t: number, ink = '#110e17') => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [p(hex), p(ink)];
  return `#${a.map((v, i) => Math.round(b[i] + (v - b[i]) * t).toString(16).padStart(2, '0')).join('')}`;
};
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
const font = (pkg: string, file: string) => `data:font/woff2;base64,${fs.readFileSync(path.join(ROOT, 'node_modules/@fontsource', pkg, 'files', file)).toString('base64')}`;
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/assets/manifest.json'), 'utf8'));
// Portraits are embedded as small palette PNGs (the 256 px WebP sources would make a ~30 MB PDF).
const PORT = new Map<string, string>();
async function prepPortraits() {
  const jobs: Promise<void>[] = [];
  for (const [id, e] of Object.entries(manifest.creatures ?? {}) as [string, { portrait?: string; portraitShiny?: string }][]) {
    for (const [shiny, file, size] of [[false, e.portrait, 176], [true, e.portraitShiny, 96], [false, e.portrait, 44]] as const) {
      if (!file) continue;
      jobs.push(sharp(path.join(ROOT, 'public/assets', file)).resize(size, size).png({ palette: true, quality: 90, effort: 8 }).toBuffer()
        .then((b) => { PORT.set(`${id}${shiny ? '*' : ''}@${size}`, `data:image/png;base64,${b.toString('base64')}`); }));
    }
  }
  await Promise.all(jobs);
}
await prepPortraits();
const portrait = (id: string, shiny = false, size: 176 | 96 | 44 = shiny ? 96 : 176) => PORT.get(`${id}${shiny ? '*' : ''}@${size}`) ?? '';

const METHOD: Record<SpawnMethod, string> = { roam: 'Roaming', grass: 'Tall grass', search: 'Glimmering nests', night: 'Night only', fish: 'Fishing' };
const DEX = Object.values(SPECIES).filter((s) => !s.boss);
const habitats = (id: string) => ZONES.flatMap((z) => z.spawns.filter((s) => s.species === id).map((s) => ({ zone: z, method: s.method, weight: s.weight })));
const parentOf = (id: string) => Object.values(SPECIES).find((s) => s.evolves.some((e) => e.id === id));
const evoText = (e: { id: string; level?: number; item?: string; time?: string }) =>
  [e.level ? `Lv ${e.level}` : '', e.item ? ITEMS[e.item as keyof typeof ITEMS]?.name : '', e.time === 'night' ? 'at night' : e.time === 'day' ? 'by day' : ''].filter(Boolean).join(' + ');
const SPIRIT_OF: Record<string, string> = { verdant_rex: 'vale', deepcaller: 'lakes', ember_totem: 'scar', mire_prince: 'marsh', dune_titan: 'dunes', storm_seraph: 'peaks' };
const ELS = Object.keys(ELEMENTS) as Element[];

// ── Sections ────────────────────────────────────────────────────────────────
const sec = (id: string, n: string, title: string, sub: string, body: string) =>
  `<section class="chap" id="${id}"><header class="ch"><span class="chn">${n}</span><div><h1>${title}</h1><p>${sub}</p></div></header>${body}</section>`;
const table = (head: string[], rows: string[][], cls = '') =>
  `<table class="${cls}"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const box = (title: string, body: string, icon = 'star') => `<div class="box"><h3>${ic(icon)}${title}</h3>${body}</div>`;

const cover = `<section class="cover">
  <img class="cv-icon" src="icons/icon-512.png" alt="">
  <div class="cv-kick">A creature-collecting expedition</div>
  <h1 class="cv-title">Wild <em>Mystics</em></h1>
  <div class="cv-rule"><span></span>${ic('sparkles')}<span></span></div>
  <h2 class="cv-sub">Field Manual</h2>
  <p class="cv-desc">Every Mystic, every land, every mechanic and every control — generated from the game’s own data.</p>
  <div class="cv-trio">${STARTERS.map((id) => `<figure><img src="${portrait(id)}" alt=""><figcaption>${SPECIES[id].name}</figcaption></figure>`).join('')}</div>
  <div class="cv-meta">${DEX.length} Mystics · ${ZONES.length} lands · ${Object.keys(SKILLS).length} moves · ${Object.keys(ABILITIES).length} abilities · ${Object.keys(RELICS).length} relics · ${TAMERS.length} tamers · Web · Android · iOS</div>
</section>`;

const toc = `<section class="toc"><h1>Contents</h1><ol>
  ${[
    ['world', 'The Lands'], ['controls', 'Controls'], ['explore', 'Exploration'], ['battle', 'Battle System'], ['growth', 'Raising Mystics'],
    ['towns', 'Towns & Services'], ['home', 'Homestead'], ['summon', 'Summoning'], ['quests', 'Quests, Feats & Rewards'], ['account', 'Accounts, Saves & Settings'],
    ['dex', `Mystidex — all ${DEX.length} Mystics`], ['guardians', 'Guardians, Spirits & Tamers'], ['appendix', 'Appendix: Moves, Abilities, Natures, Relics'], ['credits', 'Credits'],
  ].map(([id, t], i) => `<li><a href="#${id}"><span>${String(i + 1).padStart(2, '0')}</span>${t}</a></li>`).join('')}
</ol>
<div class="quick">${box('Quick start', `<ol class="tight"><li>Create an account (or play as a guest) and pick your first Mystic: <b>Emberling</b>, <b>Finnik</b> or <b>Sporelet</b>.</li><li>Walk through <b>tall grass</b> or strike a wild Mystic first (<kbd>F</kbd>) to start a battle with the advantage.</li><li>In battle, press on the beat for <b>Perfect</b> hits, and <b>parry / dodge / jump</b> enemy strikes.</li><li>Weaken, then <b>Capture</b> with the right orb. Heal at a <b>Sanctuary</b>; attune <b>Waystones</b> for fast travel.</li><li>Defeat the six <b>Guardians</b>, build your <b>Homestead</b>, and fill the Mystidex.</li></ol>`, 'compass')}</div>
</section>`;

const world = sec('world', '01', 'The Lands', 'Six regions, each with its own Mystics, weather, music and Guardian.',
  table(['Land', 'Levels', 'Town', 'Guardian', 'Weather', 'Mystics'], ZONES.map((z) => [
    `<b>${z.name}</b><br><i>${z.subtitle}</i>`, `${z.levels[0]}–${z.levels[1]}`, `${z.town.name}<br><small>${z.town.kind === 'town' ? 'Full town' : 'Outpost'}</small>`,
    `${SPECIES[z.boss.species]?.name ?? '—'}<br><small>Lv ${z.boss.level}</small>`, z.weather, String(new Set(z.spawns.map((s) => s.species)).size),
  ]), 'zones') +
  ZONES.map((z) => {
    const by = (m: SpawnMethod) => z.spawns.filter((s) => s.method === m && SPECIES[s.species]);
    return `<div class="land" style="--c:${z.grass};--bg:${mixInk(z.grass, 0.14)}"><h2>${z.name} <small>Lv ${z.levels[0]}–${z.levels[1]} · ${z.town.name}</small></h2><p class="lore">${z.lore}</p>
      <div class="spawns">${(['roam', 'grass', 'search', 'night', 'fish'] as SpawnMethod[]).filter((m) => by(m).length).map((m) => `<div><h4>${METHOD[m]}</h4>${by(m).map((s) => `<span class="mini"><img src="${portrait(s.species, false, 44)}" alt="">${SPECIES[s.species].name}</span>`).join('')}</div>`).join('')}</div></div>`;
  }).join(''));

const controls = sec('controls', '02', 'Controls', 'Keyboard & mouse, touch, and battle inputs.',
  `<div class="cols2">${box('Exploring — keyboard & mouse', table(['Action', 'Input'], [
    ['Move', '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / arrows'], ['Sprint', '<kbd>Shift</kbd> (hold)'], ['Jump / double jump', '<kbd>Space</kbd>, press again mid-air'],
    ['Look / zoom', 'Drag with mouse · wheel'], ['Interact (talk, heal, search, gather, fish)', '<kbd>E</kbd> / <kbd>Enter</kbd>'], ['Strike a wild Mystic first', '<kbd>F</kbd>'],
    ['Ride / dismount', '<kbd>R</kbd>'], ['Build mode (at your Homestead)', '<kbd>H</kbd>'], ['Journal (last tab)', '<kbd>J</kbd>'], ['Team · Dex · Bag', '<kbd>T</kbd> · <kbd>C</kbd> · <kbd>B</kbd>'],
    ['Map · Summon · Quests', '<kbd>M</kbd> · <kbd>G</kbd> · <kbd>Q</kbd>'], ['Pause menu / back', '<kbd>Esc</kbd>'], ['Journal tabs (inside Journal)', '<kbd>[</kbd> <kbd>]</kbd> or tab letters · <kbd>R</kbd> relics · <kbd>F</kbd> feats · <kbd>P</kbd> profile · <kbd>O</kbd> settings'],
  ]), 'compass')}
  ${box('Exploring — touch', table(['Action', 'Input'], [
    ['Move', 'Left thumb (virtual stick appears where you touch)'], ['Look', 'Drag with right thumb'], ['Sprint', 'Sprint button (toggle) or push the stick fully'],
    ['Jump / double jump', 'Jump button, tap again mid-air'], ['Strike first', 'Strike button (glows when a wild Mystic is in reach)'], ['Ride', 'Ride button (when you own a rideable Mystic)'],
    ['Interact', 'Tap the prompt'], ['Menus', 'Bottom bar: Journal · Team · Dex · Bag · Map · Summon · Quests · Menu'], ['Android back', 'Closes the top window, or opens the pause menu'],
  ]), 'paw')}</div>
  ${box('Battle', table(['Action', 'Keyboard', 'Touch'], [
    ['Choose action', '<kbd>1</kbd>–<kbd>6</kbd> (Attack, Skills, Capture, Items, Swap, Flee) · <kbd>B</kbd> Burst', 'Tap the action'],
    ['Pick a target', '<kbd>←</kbd><kbd>→</kbd> then <kbd>Enter</kbd>', 'Tap the marker / card'],
    ['Timed hit (your attacks)', '<kbd>Space</kbd> / <kbd>Enter</kbd> / <kbd>F</kbd> as the ring closes', 'Tap anywhere'],
    ['Parry', '<kbd>E</kbd> / <kbd>Space</kbd>', 'PARRY button'], ['Dodge', '<kbd>Q</kbd> / <kbd>Shift</kbd>', 'DODGE button'], ['Jump (gold strikes)', '<kbd>W</kbd> / <kbd>↑</kbd>', 'JUMP button'],
    ['Auto battle · speed', '<kbd>A</kbd> · <kbd>X</kbd> (1× / 1.5× / 2×)', 'AUTO · speed chips'], ['Back', '<kbd>Esc</kbd> / <kbd>Backspace</kbd>', 'Back button'],
  ]), 'sword')}`);

const explore = sec('explore', '03', 'Exploration', 'An open world stitched from six lands, with a real day/night cycle.',
  `<div class="cols2">
  ${box('Moving around', '<p><b>Sprint</b>, <b>jump</b> and <b>double jump</b> (with a spin) across terrain. Steep cliffs, deep water and lava block you. Your camera pulls in when a building or boulder gets between you and it.</p><p><b>Riding:</b> 16 large Mystics are rideable (marked <span class="tag">Mount</span> in the Mystidex). Riding is faster and wild Mystics can’t bump into you — press <kbd>R</kbd> or tap Ride.</p>', 'footprint')}
  ${box('Finding Mystics', `<p>Every land has its own table. Mystics appear in five ways:</p><ul class="tight"><li><b>Roaming</b> — visible in the world. Some chase you (red “!” label).</li><li><b>Tall grass</b> — walking through it can trigger a hidden encounter (Lure Incense doubles the rate). Outside the Vale there’s a 22% chance of a second Mystic joining.</li><li><b>Glimmering nests</b> — search sparkling bushes: 50% hidden Mystic (double shiny odds), otherwise loot.</li><li><b>Night only</b> — some Mystics only come out after dark, fading at dawn.</li><li><b>Fishing</b> — cast at ripples; land the catch in a reel minigame to hook aquatic Mystics or treasure.</li></ul>`, 'eye')}
  ${box('Shiny Mystics', '<p>Each Mystic has a <b>1 in 300</b> chance to be shiny: a shifted colour palette, sparkles in the world and a special frame everywhere. <b>Shimmer Incense</b> triples the odds for 5 minutes, glimmering nests double them, and eggs from a shiny parent get <b>4×</b> odds (Guardian Spirit eggs 2×).</p>', 'sparkle')}
  ${box('Day & night', '<p>A full day lasts 24 real minutes by default (adjustable). Nights bring stars, moonlight, glowing lanterns, night-only Mystics and night-only evolutions. Rest at an inn (Sanctuary) to skip to nightfall or dawn.</p>', 'moon')}
  ${box('Waystones & fast travel', '<p>Three <b>Waystones</b> per land attune automatically when you walk up to them. Towns join your map when you first visit, and resting at a Guardian’s <b>Expedition Flag</b> adds a camp waypoint. Open the Map to fast travel to any attuned point, or straight home.</p>', 'waypoint_obelisk')}
  ${box('Gathering', `<p>Sixteen resource nodes per land yield ${Object.values(MATERIALS).map((m) => `<b>${m.name}</b>`).join(', ')} (they regrow after 4 minutes). Materials build and upgrade your Homestead and craft orbs and tonics.</p>`, 'log_wood')}
  ${box('Tamers', `<p>${TAMERS.length} wandering Tamers (three per land) wait with a “!” marker. Beat them for Gold, Aether, orbs, stones and relics. You can rematch each one once a day for half rewards (their Mystics come back 2 levels stronger).</p>`, 'crown')}
  ${box('Guardians', '<p>Each land’s Guardian waits in an arena beside an Expedition Flag. Guardians have huge HP, a Break gauge, <b>red</b> unblockable strikes and <b>gold</b> strikes you must jump. Below 50% HP they become <b>enraged</b>. Winning grants a <b>Guardian Spirit Egg</b> (a legendary Mystic), rare orbs, tonics and Aether.</p>', 'skull')}
  </div>`);

const chart = `<table class="chart"><thead><tr><th>Atk ↓ / Def →</th>${ELS.map((e) => `<th style="color:${ELEMENTS[e].color}">${ELEMENTS[e].name}</th>`).join('')}</tr></thead><tbody>${ELS.map((a) => `<tr><th style="color:${ELEMENTS[a].color}">${ELEMENTS[a].name}</th>${ELS.map((d) => { const m = effectiveness(a, d); return `<td class="${m > 1.2 ? 'sup' : m < 1 ? 'res' : m > 1 ? 'mild' : ''}">${m === 1 ? '·' : `×${m}`}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;

const battle = sec('battle', '04', 'Battle System', 'Turn-based, but every hit is timed — Expedition 33 reflexes meet Pokémon & Miscrits collecting.',
  `<div class="cols2">
  ${box('Turn order & AP', '<p>Up to <b>three</b> of your team fight at once (the fourth waits in reserve). A <b>timeline</b> at the top shows who acts next — it follows <b>Speed</b>. Basic <b>Attack</b> earns +1 <b>AP</b>; <b>Skills</b> spend AP (up to 9 stored). Each Mystic knows up to four moves plus Strike.</p>', 'lightning_speed')}
  ${box('Timed hits', '<p>When you attack, a ring shrinks onto the target for every hit. Press as it meets the inner ring: <b>Perfect</b> (bonus damage, more Break, Burst charge), <b>Good</b>, or <b>Miss</b>. Pressing early counts as a whiff and locks you out for 0.45 s, so mashing never works.</p>', 'star')}
  ${box('Defending', '<p>Enemy strikes show a blue ring. <b>Parry</b> right on impact (a tight window) or <b>Dodge</b> (a wider window). Parry <b>every</b> hit of a move to trigger a <b>counter-attack</b>. <span class="red">Red strikes</span> can’t be parried — dodge them. <span class="gold">Gold strikes</span> are shockwaves — <b>jump</b> over them. Accessibility options add wider windows or auto-defend.</p>', 'shield')}
  ${box('Break & Burst', '<p>Every hit fills the enemy’s <b>Break</b> gauge; when full the foe is <b>Broken</b>: stunned, takes extra damage and is 1.7× easier to capture. Perfect hits and parries charge your team’s <b>Burst</b> gauge; at 100% any Mystic can unleash its element’s <b>ultimate</b> (<kbd>B</kbd>).</p>', 'sparkles')}
  </div>
  <h2>Element wheel</h2><p class="lead">Two triangles: <b>Fire › Nature › Water › Fire</b> and <b>Earth › Storm › Wind › Earth</b>. Super-effective hits deal ×1.5; resisted hits ×0.66. <b>Void</b> is the boss element: it deals ×1.15 to everything and takes neutral damage.</p>${chart}
  <h2>Status effects</h2>${table(['Status', 'Tag', 'Effect'], Object.values(STATUS).map((s) => [`<b style="color:${s.color}">${s.name}</b>`, s.short, s.desc]))}
  <div class="cols2">
  ${box('Capturing', `<p>Only wild Mystics can be captured. Chance = species catch rate × (1.35 − HP%) × Broken bonus × orb × status × level factor, +12% per Perfect in the capture QTE. The target shows its exact chance before you throw.</p>${table(['Orb', 'Effect', 'Price'], Object.values(ORBS).map((o) => [`<b style="color:${o.color}">${o.name}</b>`, o.desc, o.price ? `${o.price} g` : 'Summon only']))}`, 'orb')}
  ${box('Items in battle', table(['Item', 'Effect'], Object.values(ITEMS).filter((i) => i.use === 'battle' || i.use === 'both').map((i) => [`<b>${i.name}</b>`, i.desc])) + '<p><b>Swap</b> brings in your reserve; <b>Flee</b> works from wild battles only (chance rises with Speed). <b>Auto battle</b> lets your team fight on its own; speed up to 2×.</p>', 'potion')}
  </div>
  ${box('Rewards', '<p>Victory grants XP to every Mystic (full share to those that fought, half to the rest), Gold, and <b>Elementum shards</b> of the defeated Mystics’ elements. Tamer battles pay 1.5×. Losing sends you back to the last Sanctuary or camp you rested at and costs 10% of your Gold.</p>', 'trophy')}`);

const stones = Object.entries(ITEMS).filter(([, i]) => i.use === 'evolve');
const growth = sec('growth', '05', 'Raising Mystics', 'Levels, evolution, rarity, genes, natures, abilities, relics and more.',
  `<div class="cols2">
  ${box('Levels & moves', '<p>Mystics level up to <b>60</b>, learning new moves along the way (see each Dex entry). A Mystic keeps four moves; forgotten moves can be re-learned for free at the Move Master, who can also <b>enhance</b> a move up to rank 5 (+12% power per rank, −1 AP at rank 5).</p>', 'book')}
  ${box('Evolution', `<p>Mystics evolve by <b>level</b>, by using an <b>evolution stone</b>, or only at a certain <b>time of day</b> — many families branch. Evolved forms are one rarity tier higher. Evolution happens after battle, or from the Team tab when conditions are met.</p><p>Stones: ${stones.map(([, i]) => `<b>${i.name}</b>`).join(', ')} (sold at different Outfitters in each land).</p>`, 'sparkles')}
  ${box('Rarity', table(['Tier', 'Stat multiplier', 'Summon rate'], RARITY_ORDER.map((r) => [rar(r), `×${RARITY[r].statMult}`, pct(RATES[r])])), 'gem')}
  ${box('Genes', '<p>Every Mystic has hidden genes (0–15) for HP, ATK, DEF and SPD, graded <b>S / A / B / C / D</b> by their total. Breeding passes on the best genes of both parents with a chance to mutate higher.</p>', 'dice')}
  ${box('Awakening (stars)', `<p>Duplicate summons and released Mystics give <b>Mystic Essence</b>. Spend it to awaken a Mystic up to <b>5★</b> (+5% all stats per star). At 3★ a Mystic gains a third relic slot.</p><p>Essence per duplicate: ${RARITY_ORDER.map((r) => `${RARITY[r].name} ${ESSENCE_FOR_DUPE[r]}`).join(' · ')}.</p>`, 'star')}
  ${box('Elementum infusion', '<p>At an Elementum Shrine, offer shards of a Mystic’s own element to infuse it up to 10 times (+3% all stats each). The shrine can also <b>attune</b> a Mystic to its other natural ability.</p>', 'crystal_cluster')}
  ${box('Natures', table(['Nature', '+10%', '−10%'], NATURES.map((n) => [`<b>${n.name}</b>`, n.up?.toUpperCase() ?? '—', n.down?.toUpperCase() ?? '—'])), 'heart')}
  ${box('Relics', `<p>Relics are charms equipped in 2 slots (3 at 3★). They add stats and effects such as +XP, capture bonus, burst charge or status immunity. Upgrade them to level ${RELIC_MAX_LEVEL} at your Homestead’s Relic Forge. Full list in the appendix.</p>`, 'crown')}
  </div>
  ${box('Breeding & eggs', '<p>At a Hatchery, leave two level-5+ Mystics together (150 Gold). The egg hatches as <b>Parent A’s first form</b>, inherits the best genes of both parents and learns <b>Parent B’s</b> latest move. Eggs hatch as you walk (300–460 m; a Hatch Charm halves it). The nest holds three eggs. Your first visit earns a free Mystery Egg. Legendary Mystics can’t breed.</p>', 'egg')}`);

const svcRows = [
  ['Sanctuary (Healer)', 'Fully heals every Mystic for free, sets your respawn point, and lets you rest until nightfall or dawn.'],
  ['Outfitter', 'Orbs (Mystic, Radiant, Dusk, Tide, Ember), supplies (Tonics, Elixirs, Ethers, Cleansing Salt, Lure Incense) and rare goods (Wisdom Scroll, Shimmer Incense, Hatch Charm and that land’s evolution stones).'],
  ['Hatchery', 'Breed pairs, track eggs, collect your free Mystery Egg.'],
  ['Elementum Shrine', 'Infuse Elementum for permanent stats; attune abilities.'],
  ['Move Master', 'Enhance moves, re-learn forgotten moves.'],
  ['Keeper', 'Swap Mystics between your team and storage.'],
  ['Wishing Spire (Hearthwick)', 'Summon Mystics and relics.'],
  ['Quest Board', 'Accept side quests posted by the townsfolk (six at a time).'],
];
const towns = sec('towns', '06', 'Towns & Services', 'Full towns offer every service; frontier outposts keep the essentials.',
  table(['Service', 'What it does'], svcRows.map(([a, b]) => [`<b>${a}</b>`, b])) +
  table(['Land', 'Town', 'Type', 'Services'], ZONES.map((z) => [z.name, z.town.name, z.town.kind === 'town' ? 'Town' : 'Outpost', z.town.kind === 'town' ? 'All six + Quest Board' + (z.id === 'vale' ? ' + Wishing Spire' : '') : 'Sanctuary, Outfitter, Keeper, Quest Board'])));

const home = sec('home', '07', 'Homestead', 'Your own plot east of Hearthwick. Build, produce, craft and house your Mystics.',
  `<p class="lead">Enter build mode at the plot (<kbd>E</kbd> or <kbd>H</kbd>), pick a structure, place it inside the golden ring, rotate (<kbd>R</kbd>) and confirm. Production accrues in real time and stockpiles up to <b>${PRODUCTION_CAP_HOURS} hours</b>. Structures can be upgraded, moved and demolished (half the base cost is refunded).</p>` +
  table(['Structure', 'Category', 'Cost', 'Produces / hour', 'Max', 'Notes'], STRUCTURES.map((s) => [
    `<b>${s.name}</b>`, s.category, Object.entries(s.cost).map(([k, v]) => `${v} ${k === 'gold' ? 'Gold' : MATERIALS[k as keyof typeof MATERIALS]?.name ?? k}`).join(', '),
    s.produces ? Object.entries(s.produces).map(([k, v]) => `${v} ${k === 'gold' ? 'Gold' : k === 'aether' ? 'Aether' : MATERIALS[k as keyof typeof MATERIALS]?.name ?? k}`).join(', ') : '—',
    String(s.max), `${s.desc}${s.rankReq ? ` Needs Rank ${s.rankReq}.` : ''}${s.maxLevel > 1 ? ` Upgrades to Lv ${s.maxLevel}.` : ''}`,
  ]), 'small'));

const summon = sec('summon', '08', 'Summoning', 'Wish upon the Spire. Everything is earned in-game — there are no real-money purchases.',
  `<div class="cols2">${box('Banners', '<ul class="tight"><li><b>Featured</b> — rotates weekly between the six Guardian Spirits; 50% of Legendary results are the featured Spirit.</li><li><b>Standard</b> — every summonable Mystic, plus one <b>free wish every day</b>.</li><li><b>Relic Forge</b> — relics of every rarity.</li></ul>', 'crystal_ball')}
  ${box('Costs & pity', `<p>One wish costs ${PULL_COST} Aether (or 1 Summon Ticket); ten wishes cost ${TEN_COST} Aether (or 10 tickets). Soft pity starts after ${SOFT_PITY} wishes without a Legendary (+6% each wish); a Legendary is guaranteed by wish ${HARD_PITY}. An Epic-or-better is guaranteed every ${EPIC_PITY} wishes, and every 10-wish includes a Rare or better.</p>`, 'gem')}</div>
  ${table(['Rarity', 'Rate', 'Essence for a duplicate'], RARITY_ORDER.slice().reverse().map((r) => [rar(r), pct(RATES[r]), String(ESSENCE_FOR_DUPE[r])]))}
  <p class="lead">Earn Aether from quests, achievements, daily login, Wayfarer rank-ups (+100 each, a ticket every 5 ranks), Tamers, Guardians and the Crystal Spire.</p>`);

const quests = sec('quests', '09', 'Quests, Feats & Rewards', 'Story chapters, town requests, dailies, lifetime achievements and a login calendar.',
  `<h2>Story — The Six Guardians</h2>${table(['Chapter', 'Goal', 'Reward'], QUESTS.filter((q) => q.kind === 'story').map((q) => [`<b>${q.title}</b>`, q.desc, rewardTxt(q.reward)]))}
  <h2>Side quests (town boards)</h2>${table(['Board', 'Quest', 'Goal', 'Reward'], QUESTS.filter((q) => q.kind === 'side').map((q) => [ZONES.find((z) => z.id === q.giver)?.town.name ?? '', `<b>${q.title}</b>`, q.desc, rewardTxt(q.reward)]), 'small')}
  <h2>Daily requests</h2><p class="lead">Three are drawn from this pool each day:</p>${table(['Daily', 'Goal', 'Reward'], DAILY_POOL.map((q) => [`<b>${q.title.replace('Daily: ', '')}</b>`, q.desc, rewardTxt(q.reward)]), 'small')}
  <h2>Feats (achievements)</h2>${table(['Feat', 'Counts', 'Tiers', 'Aether per tier'], ACHIEVEMENTS.map((a) => [`<b>${a.title}</b>`, a.desc, a.tiers.join(' / '), a.reward.join(' / ')]), 'small')}
  <div class="cols2">${box('Daily login calendar', table(['Day', 'Reward'], LOGIN_REWARDS.map((r, i) => [`Day ${i + 1}`, r.label])), 'gift')}
  ${box('Wayfarer rank', `<p>Battles, catches, hatching, evolving, discovering and building all give rank XP. Titles: ${RANK_TITLES.map((t, i) => `<b>${t}</b> (${i * 5 + 1}+)`).join(', ')}.</p>`, 'crown')}</div>`);

function rewardTxt(r: import('../src/data/progression').Reward) {
  const p: string[] = [];
  if (r.aether) p.push(`${r.aether} Aether`);
  if (r.gold) p.push(`${r.gold} Gold`);
  if (r.tickets) p.push(`${r.tickets} Ticket${r.tickets > 1 ? 's' : ''}`);
  if (r.orbs) for (const [k, v] of Object.entries(r.orbs)) p.push(`${v} ${ORBS[k as keyof typeof ORBS].name}${v! > 1 ? 's' : ''}`);
  if (r.items) for (const [k, v] of Object.entries(r.items)) p.push(`${v}× ${ITEMS[k as keyof typeof ITEMS].name}`);
  if (r.materials) for (const [k, v] of Object.entries(r.materials)) p.push(`${v} ${MATERIALS[k as keyof typeof MATERIALS].name}`);
  if (r.relic) p.push(`Relic: ${RELICS[r.relic]?.name}`);
  if (r.rankXp) p.push(`${r.rankXp} rank XP`);
  return p.join(' · ');
}

const account = sec('account', '10', 'Accounts, Saves & Settings', 'Play anywhere; your journey follows your account.',
  `<div class="cols2">${box('Accounts', '<ul class="tight"><li><b>Guest</b> — instant play, saved on this device. Upgrade to an account any time from Profile; your guest journey moves with you.</li><li><b>Account (cloud)</b> — when the game server is reachable, sign-up and sign-in use it and your save syncs automatically (this device wins if two devices conflict mid-session).</li><li><b>Account (device)</b> — offline, accounts are created on this device (passwords hashed with PBKDF2).</li></ul>', 'user_profile')}
  ${box('Saving', '<p>The game autosaves constantly (every change, every 30 s and whenever the app goes to the background). Export a backup file or import one from Settings → Data. “Start over” erases this account’s save on this device.</p>', 'chest')}</div>
  ${box('Settings', table(['Group', 'Options'], [
    ['Graphics', 'Quality preset (Auto/Low/Medium/High/Ultra), render scale, adaptive resolution, frame-rate cap (30/60/uncapped), shadows, ambient occlusion, bloom, grass density, draw distance'],
    ['Audio', 'Master, music and effects volume'], ['Gameplay', 'Default battle speed, damage numbers, screen shake, day length, tutorial hints'],
    ['Accessibility', 'Timing assist (50% wider windows), auto-defend, vibration'], ['Controls', 'Camera sensitivity, invert Y, camera distance, touch button size & opacity, left-handed layout'],
  ]), 'gear_settings')}
  ${box('Platforms & performance', '<p>Runs in any modern browser (installable as an app, works offline after the first load), and as native Android and iOS apps. The game picks a quality tier for your device, streams Mystic models on demand, caches the baked world, lowers resolution briefly when the frame rate dips, and pauses 3D rendering behind full-screen menus to save battery.</p>', 'lightning_speed')}`);

// ── Mystidex ────────────────────────────────────────────────────────────────
const statBar = (label: string, v: number, max: number, c: string) => `<div class="sb"><span>${label}</span><i><b style="width:${Math.min(100, (v / max) * 100)}%;background:${c}"></b></i><em>${v}</em></div>`;
const dexCards = DEX.map((s, i) => {
  const hab = habitats(s.id);
  const par = parentOf(s.id);
  const from = par ? `Evolves from <b>${par.name}</b> (${evoText(par.evolves.find((e) => e.id === s.id)!)})` : '';
  const to = s.evolves.filter((e) => SPECIES[e.id]).map((e) => `<b>${SPECIES[e.id].name}</b> (${evoText(e)})`).join(', ');
  const obtain = hab.length ? hab.map((h) => `${h.zone.name} · ${METHOD[h.method]}`).join('<br>') : s.rarity === 'legendary' ? `Summon · ${ZONES.find((z) => z.id === SPIRIT_OF[s.id])?.name ?? ''} Guardian egg` : par ? 'Evolution · breeding · summon' : 'Summon · breeding';
  const tags = [s.rideable ? '<span class="tag">Mount</span>' : '', s.swim ? '<span class="tag">Aquatic</span>' : '', s.variantOf ? `<span class="tag">Variant of ${SPECIES[s.variantOf]?.name}</span>` : '', STARTERS.includes(s.id) ? '<span class="tag">Starter</span>' : ''].join('');
  return `<article class="mon" style="--c:${ELEMENTS[s.element].color};--r:${RARITY[s.rarity].color};--bg:${mixInk(ELEMENTS[s.element].color, 0.13)};--rl:${mixInk(RARITY[s.rarity].color, 0.6)}">
    <div class="mon-art"><img src="${portrait(s.id)}" alt=""><img class="sh" src="${portrait(s.id, true)}" alt=""><span class="no">#${String(i + 1).padStart(3, '0')}</span></div>
    <div class="mon-b"><h3>${s.name}</h3><div class="mon-tags">${el(s.element)}${rar(s.rarity)}${tags}</div>
      <div class="stats">${statBar('HP', s.base.hp, 110, '#6fd18a')}${statBar('ATK', s.base.atk, 30, '#ff8a5a')}${statBar('DEF', s.base.def, 30, '#5ab4ff')}${statBar('SPD', s.base.spd, 30, '#f2c46a')}</div>
      <p class="kv"><b>Abilities</b> ${s.abilities.map((a) => ABILITIES[a].name).join(' / ')} · <b>Catch</b> ${Math.round(s.catchRate * 100)}% · <b>Height</b> ${s.height} m</p>
      <p class="kv"><b>Moves</b> ${s.learnset.filter(([, id]) => SKILLS[id]).map(([lv, id]) => `${SKILLS[id].name} <small>${lv}</small>`).join(', ')}</p>
      ${from ? `<p class="kv">${from}</p>` : ''}${to ? `<p class="kv">Evolves into ${to}</p>` : ''}
      <p class="kv"><b>Where</b> ${obtain}</p>
      <p class="lore">${esc(s.lore)}</p></div></article>`;
}).join('');
const dex = sec('dex', '11', `Mystidex — ${DEX.length} Mystics`, 'Normal and shiny colours shown side by side. Numbers match the in-game Mystidex.', `<div class="dexgrid">${dexCards}</div>`);

const bosses = Object.values(SPECIES).filter((s) => s.boss);
const guardians = sec('guardians', '12', 'Guardians, Spirits & Tamers', 'The six Guardians, the legendary Spirits they leave behind, and every Tamer.',
  `<div class="gcards">${ZONES.map((z) => {
    const b = SPECIES[z.boss.species];
    const spirit = Object.entries(SPIRIT_OF).find(([, zid]) => zid === z.id)?.[0];
    return b ? `<div class="gcard" style="--c:${ELEMENTS[b.element].color};--bg:${mixInk(ELEMENTS[b.element].color, 0.16)}"><img src="${portrait(b.id)}" alt=""><div><h3>${b.name}</h3><p class="kv">${z.name} · Lv ${z.boss.level} · ${el(b.element)} · HP base ${b.base.hp}</p><p class="kv"><b>Moves</b> ${b.learnset.map(([, id]) => SKILLS[id]?.name).filter(Boolean).join(', ')}</p><p class="kv"><b>Adds</b> ${z.boss.adds.map((a) => SPECIES[a]?.name).filter(Boolean).join(', ') || '—'}</p>${spirit ? `<p class="kv"><b>Spirit egg</b> ${SPECIES[spirit].name}</p>` : ''}<p class="lore">${esc(b.lore)}</p></div></div>` : '';
  }).join('')}</div>
  <h2>Tamers</h2>${table(['Tamer', 'Land', 'Team', 'First-win reward'], TAMERS.map((t) => [`<b>${t.title} ${t.name}</b><br><i>“${esc(t.intro)}”</i>`, ZONES.find((z) => z.id === t.zone)?.name ?? '', t.team.filter(([sp]) => SPECIES[sp]).map(([sp, lv]) => `${SPECIES[sp].name} ${lv}`).join(', '), rewardTxt(t.reward)]), 'small')}
  <p class="lead">${bosses.length} Guardians · 6 Guardian Spirits (legendary, summon or Guardian egg only).</p>`);

const moveRows = Object.values(SKILLS).filter((s) => s.id !== 'strike').sort((a, b) => a.element.localeCompare(b.element) || a.name.localeCompare(b.name));
const appendix = sec('appendix', '13', 'Appendix', 'Every move, ability and relic in the game.',
  `<h2>Moves</h2>${table(['Move', 'Element', 'Kind', 'Power × hits', 'AP', 'Effect'], moveRows.map((s) => [`<b>${s.name}</b>${s.ultimate ? ' <span class="tag">Burst</span>' : ''}`, el(s.element), s.kind, s.power ? `${s.power} × ${s.hits}` : '—', s.ultimate ? 'Burst' : String(s.ap), `${s.desc}${s.status ? ` (${Math.round(s.status.chance * 100)}% ${STATUS[s.status.id].name})` : ''}`]), 'tiny')}
  <h2>Abilities</h2>${table(['Ability', 'Effect'], Object.values(ABILITIES).map((a) => [`<b>${a.name}</b>`, a.desc]), 'small')}
  <h2>Relics</h2>${table(['Relic', 'Rarity', 'Effect'], Object.values(RELICS).map((r) => [`<b>${r.name}</b>`, rar(r.rarity), r.desc]), 'small')}
  <h2>Items</h2>${table(['Item', 'Use', 'Effect', 'Price'], Object.values(ITEMS).map((i) => [`<b>${i.name}</b>`, i.use, i.desc, `${i.price} g`]), 'small')}`);

const credits = sec('credits', '14', 'Credits', 'Wild Mystics is built with open assets. Thank you to their creators.',
  `<div class="cols2">${box('Art & models', '<p>Creatures, characters, nature and buildings: <b>Quaternius</b> (CC0), <b>KayKit</b> by Kay Lousberg (CC0), <b>Kenney</b> (CC0). Textures and HDRIs: <b>Poly Haven</b> (CC0). Icons: <b>game-icons.net</b> by Lorc, Delapouite, Carl Olsen, sbed (CC BY 3.0).</p>', 'tree')}
  ${box('Music & sound', '<p>Sound effects: Kenney RPG, Impact, Interface, UI, Casino and Music Jingles packs (CC0). Music from OpenGameArt (CC0): town, overworld, battle, boss, desert, swamp, night, summon and homestead themes, plus a victory fanfare. See CREDITS.md in the repository for every track and author.</p>', 'music_note')}</div>
  <p class="lead">Built with three.js, postprocessing, N8AO, Vite, TypeScript, Capacitor and Cloudflare Workers. Game design inspired by Pokémon, Miscrits and Clair Obscur: Expedition 33.</p>`);

// ── Document ────────────────────────────────────────────────────────────────
const css = `
@font-face { font-family: Cinzel; font-weight: 500; src: url(${font('cinzel', 'cinzel-latin-500-normal.woff2')}); }
@font-face { font-family: Cinzel; font-weight: 700; src: url(${font('cinzel', 'cinzel-latin-700-normal.woff2')}); }
@font-face { font-family: Cormorant; font-style: italic; font-weight: 500; src: url(${font('cormorant-garamond', 'cormorant-garamond-latin-500-italic.woff2')}); }
@font-face { font-family: Cormorant; font-style: normal; font-weight: 600; src: url(${font('cormorant-garamond', 'cormorant-garamond-latin-600-normal.woff2')}); }
@font-face { font-family: Inter; font-weight: 400; src: url(${font('inter', 'inter-latin-400-normal.woff2')}); }
@font-face { font-family: Inter; font-weight: 600; src: url(${font('inter', 'inter-latin-600-normal.woff2')}); }
@font-face { font-family: Inter; font-weight: 700; src: url(${font('inter', 'inter-latin-700-normal.woff2')}); }
@page { size: A4; margin: 14mm 13mm 16mm; background: #110e17; }
:root { --ink: #110e17; --paper: #efe5cf; --muted: #a89f8e; --gold: #d9b56d; --gold-hi: #f4dc9c; --line: rgba(217,181,109,.3); --faint: rgba(255,255,255,.07); }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--ink); color: var(--paper); font: 9.4pt/1.45 Inter, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.ic { width: 1.1em; height: 1.1em; vertical-align: -0.18em; flex: none; }
b { font-weight: 600; } i { font-family: Cormorant; font-size: 1.12em; color: #d8cfbd; }
small { color: var(--muted); font-size: .86em; }
kbd { font: 700 7.4pt Inter; padding: 1px 4px; border: 1px solid var(--line); border-radius: 3px; color: var(--gold-hi); background: rgba(0,0,0,.35); margin-right: 2px; white-space: nowrap; }
.red { color: #ff7a6a; font-weight: 600; } .gold { color: #ffd76a; font-weight: 600; }
h1, h2, h3 { font-family: Cinzel; font-weight: 500; letter-spacing: .08em; margin: 0; }
h2 { font-size: 13pt; color: var(--gold-hi); margin: 16px 0 8px; text-transform: uppercase; letter-spacing: .12em; break-after: avoid; }
h3 { font-size: 11pt; }
p { margin: 0 0 6px; }
.lead { color: #d8cfbd; margin: 6px 0 10px; }
.cover { height: 263mm; position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 8px; break-after: page; overflow: hidden; border-radius: 6px; background: radial-gradient(ellipse at 50% 32%, #33264a, #16111f 60%, #0d0b12); }
.cv-sky { position: absolute; inset: 0; background: radial-gradient(1.5px 1.5px at 12% 22%, #fff9, transparent), radial-gradient(1px 1px at 28% 68%, #fff8, transparent), radial-gradient(1.5px 1.5px at 44% 14%, #fffa, transparent), radial-gradient(1px 1px at 62% 42%, #fff7, transparent), radial-gradient(1.5px 1.5px at 78% 18%, #fff9, transparent), radial-gradient(1px 1px at 88% 62%, #fff8, transparent), radial-gradient(1px 1px at 6% 82%, #fff6, transparent), radial-gradient(1.5px 1.5px at 52% 88%, #fff7, transparent); }
.cv-icon { width: 128px; height: 128px; border-radius: 28px; position: relative; }
.cv-kick { font: italic 500 15pt Cormorant; color: var(--gold-hi); position: relative; margin-top: 10px; }
.cv-title { font-size: 44pt; letter-spacing: .14em; text-transform: uppercase; position: relative; line-height: 1; }
.cv-title em { font-style: normal; color: var(--gold-hi); }
.cv-rule { display: flex; align-items: center; gap: 12px; width: 60%; color: var(--gold); position: relative; } .cv-rule span { flex: 1; height: 1px; background: var(--gold); opacity: .6; }
.cv-sub { font-size: 20pt; letter-spacing: .3em; text-transform: uppercase; color: var(--gold-hi); position: relative; }
.cv-desc { font: italic 500 13pt Cormorant; color: #d8cfbd; max-width: 420px; position: relative; }
.cv-trio { display: flex; gap: 22px; margin-top: 18px; position: relative; }
.cv-trio figure { margin: 0; } .cv-trio img { width: 120px; height: 120px; object-fit: contain; }
.cv-trio figcaption { font: 500 10pt Cinzel; letter-spacing: .1em; }
.cv-meta { position: absolute; bottom: 20px; font-size: 8pt; color: var(--muted); letter-spacing: .06em; }
.toc { break-after: page; }
.toc h1 { font-size: 22pt; color: var(--gold-hi); margin-bottom: 14px; letter-spacing: .14em; text-transform: uppercase; }
.toc ol { list-style: none; padding: 0; margin: 0 0 18px; columns: 2; column-gap: 24px; }
.toc li a { display: flex; gap: 10px; align-items: baseline; padding: 7px 0; border-bottom: 1px solid var(--faint); color: var(--paper); text-decoration: none; font: 500 11pt Cinzel; letter-spacing: .06em; }
.toc li span { color: var(--gold); font: 700 9pt Inter; }
.chap { break-before: page; }
.ch { display: flex; gap: 14px; align-items: center; padding-bottom: 10px; margin-bottom: 12px; border-bottom: 1px solid var(--line); }
.chn { font: 700 26pt Cinzel; color: var(--gold); opacity: .8; }
.ch h1 { font-size: 20pt; text-transform: uppercase; letter-spacing: .12em; }
.ch p { margin: 2px 0 0; font: italic 500 12pt Cormorant; color: var(--muted); }
.cols2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: start; }
.box { padding: 10px 12px; margin-bottom: 10px; border: 1px solid #221d2b; border-radius: 6px; background: #16121c; break-inside: avoid; }
.box h3 { display: flex; align-items: center; gap: 7px; font-size: 10.5pt; color: var(--gold-hi); margin-bottom: 6px; text-transform: uppercase; letter-spacing: .1em; }
.box h3 .ic { color: var(--gold); }
ul.tight, ol.tight { margin: 4px 0 4px 16px; padding: 0; } ul.tight li, ol.tight li { margin-bottom: 3px; }
table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; font-size: 8.6pt; break-inside: auto; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th { text-align: left; font: 700 7.6pt Inter; letter-spacing: .08em; text-transform: uppercase; color: var(--gold); padding: 5px 6px; border-bottom: 1px solid var(--line); }
td { padding: 5px 6px; border-bottom: 1px solid var(--faint); vertical-align: top; }
tbody tr:nth-child(even) td { background: #15111a; }
table.small { font-size: 8pt; } table.tiny { font-size: 7.4pt; } table.tiny td { padding: 3px 5px; }
table.chart { width: auto; margin: 6px auto 12px; } table.chart td, table.chart th { text-align: center; padding: 5px 9px; }
td.sup { color: #7fe0a0; font-weight: 700; } td.res { color: #ff9a8a; } td.mild { color: #d0b8ff; }
.elb { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px 1px 4px; border-radius: 99px; font-size: 7.6pt; font-weight: 700; color: var(--c); border: 1px solid var(--c); white-space: nowrap; }
.rar { display: inline-block; padding: 1px 6px; border-radius: 2px; font-size: 7pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--c); border: 1px solid var(--c); }
.tag { display: inline-block; padding: 1px 6px; border-radius: 2px; font-size: 7pt; font-weight: 700; letter-spacing: .06em; color: var(--gold-hi); border: 1px solid var(--line); }
.land { padding: 10px 12px; margin: 10px 0; border-radius: 6px; border: 1px solid #221d2b; background: linear-gradient(90deg, var(--bg), #151119 60%); break-inside: avoid; }
.land h2 { margin: 0 0 4px; color: var(--paper); } .land h2 small { font: 600 8pt Inter; letter-spacing: 0; text-transform: none; color: var(--muted); margin-left: 6px; }
.lore { font: italic 500 11pt Cormorant; color: #d8cfbd; }
.spawns { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 6px 10px; margin-top: 6px; }
.spawns h4 { margin: 0 0 3px; font: 700 7.4pt Inter; letter-spacing: .1em; text-transform: uppercase; color: var(--gold); }
.mini { display: inline-flex; align-items: center; gap: 3px; margin: 0 6px 3px 0; font-size: 7.8pt; }
.mini img { width: 18px; height: 18px; object-fit: contain; }
.dexgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.mon { display: flex; gap: 10px; padding: 9px 10px; border-radius: 6px; border: 1px solid #221d2b; border-top: 1px solid var(--rl); background: linear-gradient(100deg, var(--bg), #151119 45%); break-inside: avoid; }
.mon-art { position: relative; flex: none; width: 88px; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.mon-art img { width: 84px; height: 84px; object-fit: contain; }
.mon-art img.sh { width: 42px; height: 42px; opacity: .95; }
.mon-art .no { position: absolute; top: 0; left: 0; font: 700 7pt Inter; color: var(--muted); }
.mon-b { flex: 1; min-width: 0; }
.mon-b h3 { font-size: 11.5pt; }
.mon-tags { display: flex; flex-wrap: wrap; gap: 4px; margin: 3px 0 5px; }
.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 10px; margin-bottom: 4px; }
.sb { display: grid; grid-template-columns: 24px 1fr 20px; gap: 5px; align-items: center; font: 700 6.8pt Inter; color: var(--muted); }
.sb i { height: 4px; background: rgba(255,255,255,.08); border-radius: 2px; overflow: hidden; } .sb i b { display: block; height: 100%; }
.sb em { font-style: normal; color: var(--paper); text-align: right; }
.kv { font-size: 7.8pt; margin: 0 0 3px; color: #d8cfbd; } .kv b { color: var(--gold-hi); font-weight: 600; margin-right: 3px; } .kv small { font-size: 6.6pt; }
.mon .lore { font-size: 9.6pt; margin: 3px 0 0; }
.gcards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.gcard { display: flex; gap: 10px; padding: 10px; border-radius: 6px; border: 1px solid #221d2b; background: linear-gradient(100deg, var(--bg), #151119 50%); break-inside: avoid; }
.gcard img { width: 96px; height: 96px; object-fit: contain; flex: none; }
.gcard h3 { font-size: 12pt; margin-bottom: 3px; }
table.zones td:first-child { width: 28%; }
`;

const html = `<!doctype html><html><head><meta charset="utf-8"><base href="http://localhost:5180/"><title>Wild Mystics — Field Manual</title><style>${css}</style></head><body>
${cover}${toc}${world}${controls}${explore}${battle}${growth}${towns}${home}${summon}${quests}${account}${dex}${guardians}${appendix}${credits}
</body></html>`;
const htmlPath = path.join(OUT_DIR, 'manual.html');
fs.writeFileSync(htmlPath, html);

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle0', timeout: 180000 });
await page.evaluate(() => document.fonts.ready);
const pdfPath = path.join(OUT_DIR, 'Wild-Mystics-Field-Manual.pdf');
await page.pdf({
  path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true, headerTemplate: '<span></span>',
  footerTemplate: '<div style="width:100%;font:8px Helvetica,Arial;color:#8a8070;padding:0 13mm;display:flex;justify-content:space-between;background:#110e17;-webkit-print-color-adjust:exact"><span>Wild Mystics · Field Manual</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  margin: { top: '14mm', bottom: '16mm', left: '13mm', right: '13mm' },
});
await browser.close();
console.log('✓', path.relative(ROOT, pdfPath), `${(fs.statSync(pdfPath).size / 1e6).toFixed(1)} MB`);
