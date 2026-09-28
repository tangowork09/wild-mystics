// Builds "Wild Mystics — Vision & Visual Prompt Pack" (PDF), a product overview plus a
// ready-to-use AI art prompt for every new creature, land, character and dungeon theme in v3.
// Pure data → HTML → PDF; no dev server needed (no in-game portraits, just prompt text).
//   npx tsx tools/make-vision-doc.ts
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const OUT = path.resolve('docs/v3/Wild-Mystics-Vision-and-Prompts.pdf');
const STYLE_PREFIX =
  'Stylized fantasy creature concept art for a premium 3D monster-collecting RPG, painterly Belle-Époque fantasy mood inspired by Clair Obscur: Expedition 33, appealing chunky readable silhouette, big expressive eyes, hand-painted PBR materials, soft rim light, full body, neutral standing A-pose, front view, orthographic, centred, plain light-grey background, no cast shadow, no text, no watermark —';

// ── New species (v3), harvested from the creatures workstream ──────────────
interface Sp { id: string; name: string; element: string; role: string; lore: string; prompt: string }

const EL_WORD: Record<string, string> = { fire: 'fire', water: 'water', nature: 'nature', earth: 'earth', storm: 'storm/lightning', wind: 'wind', void: 'void/shadow' };

const NEW_SPECIES: Sp[] = [
  { id: 'skimgull', name: 'Skimgull', element: 'wind', role: 'Coast — common', lore: 'Steals chips from the Tidewatch docks, then apologises with a very nice shell.', prompt: 'plump seagull-like creature, pale grey-white plumage, orange webbed feet, cheeky sideways grin, a tiny shell clutched in one wing, salt-spray droplets frozen mid-air around it' },
  { id: 'saltfox', name: 'Saltfox', element: 'water', role: 'Coast — rare', lore: 'Dips its tail in tide pools and flicks crabs onto the sand for later.', prompt: 'sleek fox with pale aquamarine fur, fin-shaped ears, a paddle-flat tail dripping seawater, tide-pool patterns like tattoos along its flanks, sly clever eyes' },
  { id: 'shellback', name: 'Shellback', element: 'water', role: 'Coast — common (evolves to Reefwarden)', lore: 'A hermit toad that borrows the biggest shell on the beach, then naps in it for a week.', prompt: 'squat teal toad wearing an oversized peach-pink conch shell like a backpack, stubby legs, sleepy contented face, tiny barnacles on its shell' },
  { id: 'reefwarden', name: 'Reefwarden', element: 'water', role: 'Coast — rare, rideable (evolved Shellback)', lore: 'A whole reef lives on its shell, and it would never dream of shaking them off.', prompt: 'large noble toad-turtle with a living coral reef growing across its broad shell, soft glowing coral polyps, calm guardian expression, sturdy legs planted like a throne' },
  { id: 'coralclack', name: 'Coralclack', element: 'water', role: 'Coast — rare (Clacker variant)', lore: 'Coast Clackers wear a living coral garden and defend it with great ceremony.', prompt: 'crab-like creature with pink-and-coral-pink branching coral growing from its back like a crown, oversized ceremonial claw, proud puffed-up stance' },
  { id: 'jestfin', name: 'Jestfin', element: 'water', role: 'Coast — common, swims', lore: 'Tells the same joke to every anemone. The anemones love it every time.', prompt: 'small round clownfish creature with exaggerated orange-and-white stripes, an oversized comedic grin, bubble trail shaped like a speech balloon' },
  { id: 'lancefin', name: 'Lancefin', element: 'water', role: 'Coast — rare, swims', lore: 'Duels sailfish at dawn and has never once lost its temper, or a duel.', prompt: 'slender swordfish creature, deep cobalt-blue body, a long rapier-like bill, dorsal fin like a raised visor, dignified duellist posture, dawn-lit water droplets' },
  { id: 'inkwhirl', name: 'Inkwhirl', element: 'void', role: 'Coast — rare', lore: 'Crawls up the beach on moonless nights to arrange the shells into little poems.', prompt: 'small octopus creature in deep indigo-black, faintly luminous ink-purple markings along its arms, one arm curled around a tiny shell, moonlit beach mood' },
  { id: 'fawnlet', name: 'Fawnlet', element: 'nature', role: 'Elderwood — common (evolves to Mossbuck)', lore: 'Its spots are dapples of sunlight it forgot to give back.', prompt: 'small spotted fawn creature, warm honey-brown coat with sunlight-dapple spots that faintly glow, oversized gentle eyes, dainty legs, forest-floor light' },
  { id: 'mossbuck', name: 'Mossbuck', element: 'nature', role: 'Elderwood — rare, rideable (evolved Fawnlet)', lore: 'Moss grows on its antlers faster than it can rub it off, so it has stopped trying.', prompt: 'large stag creature, mossy antlers sprouting small mushrooms and ferns, deep olive-green coat, calm ancient forest-guardian presence, dappled canopy light' },
  { id: 'bramblewolf', name: 'Bramblewolf', element: 'nature', role: 'Elderwood — common (evolves to Thornfang)', lore: 'Hunts in threes and howls in harmony. The harmony is the frightening part.', prompt: 'lean wolf creature with a mane of woven brambles and thorns down its back, deep forest-green fur, alert pack-hunter stance, thorn-vine tail' },
  { id: 'thornfang', name: 'Thornfang', element: 'nature', role: 'Elderwood — rare, rideable (evolved Bramblewolf)', lore: 'Its thorns only come out when it is protecting something smaller.', prompt: 'large wolf creature, thick bramble mane bristling with long thorns, small curved bone-white horns, glowing lime-green eyes, protective noble stance' },
  { id: 'lanternfox', name: 'Lanternfox', element: 'fire', role: 'Elderwood — rare', lore: 'Leads lost Wayfarers home through the Elderwood, then back in again for fun.', prompt: 'small fox with deep violet fur, a warm ember-orange flame flickering at the tip of its tail like a lantern, playful knowing smile, firefly-lit forest night' },
  { id: 'hootsage', name: 'Hootsage', element: 'wind', role: 'Elderwood — rare', lore: 'Has read every book in Elderhollow twice and disagrees with most of them.', prompt: 'wise owl creature, round spectacled eyes, a small scroll tucked under one wing, tawny-brown plumage with subtle rune markings, perched contemplative pose' },
  { id: 'mosshulk', name: 'Mosshulk', element: 'nature', role: 'Elderwood — rare', lore: 'An old boundary stone that grew tired of standing still.', prompt: 'stout stone golem entirely overgrown with thick green moss, a crown of small leaves and mushrooms sprouting from its head, sturdy immovable stance, patient ancient face carved in the stone' },
  { id: 'geodgloop', name: 'Geodgloop', element: 'earth', role: 'Glimmer Hollows — rare (Gloop variant)', lore: 'A Gloop that napped in a crystal vein for a hundred years and woke up sparkly.', prompt: 'wobbly slime blob in deep amethyst-purple, studded with small glowing pale-blue crystal facets across its back like a geode split open, one sparkling eye' },
  { id: 'glimfox', name: 'Glimfox', element: 'storm', role: 'Glimmer Hollows — rare', lore: 'Grows a new crystal every time it outruns a thunderclap.', prompt: 'quick fox creature, indigo-blue fur crackling with tiny static sparks, pale cyan crystal shards growing along its spine like a mohawk, alert electric-eyed expression' },
  { id: 'shardmaw', name: 'Shardmaw', element: 'earth', role: 'Glimmer Hollows — rare', lore: 'Chews raw geodes to keep its teeth sharp and its breath sparkling.', prompt: 'muscular wolf-like creature, slate-grey hide, jagged amethyst crystal shards jutting from its back and shoulders, sparkling breath, fierce crystalline teeth' },
  { id: 'prismbat', name: 'Prismbat', element: 'storm', role: 'Glimmer Hollows — rare (Squeakwing variant)', lore: 'Hangs in the crystal caves and hums in chords only other Prismbats can hear.', prompt: 'small bat creature with translucent prism-like wings that split cave light into rainbow glints, deep indigo-blue fur, a single faceted gem on its chest, hanging pose' },
  { id: 'quartzback', name: 'Quartzback', element: 'earth', role: 'Glimmer Hollows — rare, rideable (Kilnback variant)', lore: 'Its back plates are geodes; miners follow it hoping one falls off.', prompt: 'sturdy stegosaurus-like creature, lavender-grey hide, back plates that are actually cracked-open amethyst geodes glowing faintly from within, calm plodding gait' },
  { id: 'galeherald', name: 'Galeherald', element: 'wind', role: 'Glimmer Hollows — rare (evolved Skimgull)', lore: 'A Skimgull that rode the updraft to the Crown and came back gilded.', prompt: 'regal bird creature, gilded gold-white plumage, long trailing tail feathers like banners, wind-swept heraldic mane, soaring triumphant pose against high clouds' },
  { id: 'stormhowl', name: 'Stormhowl', element: 'storm', role: 'Glimmer Hollows — epic, rideable', lore: 'Runs along the lightning to the summit and howls the thunder back down.', prompt: 'powerful wolf creature, storm-white fur crackling with pale yellow lightning veins, a mane like frozen lightning bolts, howling stance atop a storm-lit ridge' },
  { id: 'stormray', name: 'Stormray', element: 'storm', role: 'Glimmer Hollows — epic, flyer (Skysail variant)', lore: 'Swims through storm clouds the way Skysails swim through lakes.', prompt: 'manta-ray creature gliding as if flying, deep indigo-blue wings with glowing golden lightning-vein patterns, serene glide through storm clouds' },
  { id: 'haloling', name: 'Haloling', element: 'void', role: 'Summit — epic (Wisp variant)', lore: 'A Wisp that climbed the whole mountain and was given a halo for its trouble.', prompt: 'small glowing ghost-wisp creature, warm cream-gold light instead of its usual dark hue, a thin golden halo ring floating above it, serene ascended expression' },
  { id: 'wardenshade', name: 'Wardenshade', element: 'void', role: 'Summit — epic (Bonewarden variant)', lore: 'An echo of a Sky Warden, still walking its rounds among the summit ruins.', prompt: 'tall skeletal knight-creature in pale silver-blue bone armour, faint cyan spectral glow between the joints, holding a ceremonial guardian stance among ruined columns' },
  { id: 'tidesinger', name: 'Tidesinger', element: 'water', role: 'Coast Spirit — legendary', lore: 'A choir of one. When it sings, the drowned bells under the reef answer.', prompt: 'ethereal jellyfish-like spirit, translucent cyan-teal bell body glowing from within, long trailing bioluminescent tendrils, a faint halo above it, serene singing pose, bubbles rising like musical notes' },
  { id: 'sylvan_hart', name: 'Sylvan Hart', element: 'nature', role: 'Elderwood Spirit — legendary, rideable', lore: 'The Elder Stag’s kindness, given legs of its own.', prompt: 'radiant white stag spirit, antlers wreathed in soft mint-green light and blossoms, translucent glowing hooves that leave a trail of tiny leaves, gentle luminous eyes' },
  { id: 'prism_wyrm', name: 'Prism Wyrm', element: 'storm', role: 'Glimmer Hollows Spirit — legendary', lore: 'A sliver of the Geode Colossus’s heart that learned to fly.', prompt: 'small serpentine dragon spirit made of faceted crystal and light, violet-and-cyan prismatic scales that scatter rainbow light, trailing crystal shard motes, elegant coiled flight pose' },
  { id: 'bellwyrm', name: 'Bellwyrm', element: 'water', role: 'Sapphire Coast Guardian — boss, ~5.2 m', lore: 'Guardian of the Sapphire Coast. Bronze bells grew from its barnacles, and it rings them to call the tide home.', prompt: 'colossal sea-serpent guardian, deep sapphire-blue barnacled scales, three weathered bronze bells fused to its chest, coral crown along its head, imposing coiled sea-god presence, crashing waves and mist' },
  { id: 'elder_stag', name: 'Elder Stag', element: 'nature', role: 'Elderwood Guardian — boss, ~6.8 m', lore: 'Guardian of the Elderwood. Its antlers hold up the canopy of the deepest glade.', prompt: 'colossal ancient stag guardian, immense antlers that spread like the canopy of a great tree, bark-textured hide, glowing green moss and mushrooms across its back, standing beneath dappled forest light, primal and serene' },
  { id: 'geode_colossus', name: 'Geode Colossus', element: 'earth/storm', role: 'Glimmer Hollows Guardian — boss, ~7.4 m', lore: 'Guardian of Glimmer Hollows. It sleeps in the brightest vein, and the vein is its heart.', prompt: 'colossal crystal-and-stone golem guardian, its chest split open to reveal a glowing geode heart crackling with lightning, jagged amethyst and citrine crystal formations across its back and head, slow immense power' },
  { id: 'aether_sovereign', name: 'Aether Sovereign', element: 'storm/void', role: 'Final Boss — Aether Crown, ~9.5 m, the grandest model', lore: 'The storm at the top of the world, given a crown and a will. The Guardians’ restlessness begins in its dreams.', prompt: 'magnificent dragon-sovereign, deep midnight-blue and gold scales, a crown of storm-lightning horns, a halo of eclipsed light behind its head, wings like a captured storm front, immense godlike presence, the final boss on a mountain summit under a churning aurora sky' },
];

// ── Lands (v3 ten-region ring) ───────────────────────────────────────────────
interface Land { name: string; subtitle: string; tier: number; prompt: string }
const LANDS: Land[] = [
  { name: 'Verdant Vale', subtitle: 'Where every journey begins', tier: 1, prompt: 'rolling sunlit meadows and gentle hills around a cozy timber-frame hub town, a lazy river, wildflowers, warm gold-green palette, painterly Ghibli-esque pastoral fantasy' },
  { name: 'Mirror Lakes', subtitle: 'Still waters, restless depths', tier: 2, prompt: 'a hundred mirror-still lakes among pine hills, soft morning mist, stilt houses on the water, teal-and-silver reflections, tranquil and slightly eerie depths' },
  { name: 'Sapphire Coast', subtitle: 'Salt wind and sunken bells', tier: 2, prompt: 'white sand coves, sea stacks, tide pools and cliffs below a lighthouse harbour town, bright turquoise sea, salt-spray light, cheerful nautical fantasy' },
  { name: 'Mistveil Marsh', subtitle: 'Where the fog remembers names', tier: 3, prompt: 'flat wetland of sunken boardwalks, glowing spores, hanging lanterns and thick fog, muted green-grey palette, quiet and a little melancholy' },
  { name: 'Ember Scar', subtitle: 'Ash, obsidian and old fire', tier: 3, prompt: 'a volcanic caldera of charred mesas, glowing lava channels and a basalt forge town, deep orange-and-black palette, heat haze, dramatic dark fantasy' },
  { name: 'Elderwood', subtitle: 'The forest that dreams', tier: 4, prompt: 'ancient towering trees older than the world, lantern-moss, fireflies, a treehouse village built into giant roots, deep emerald and gold dappled light, wondrous and dreamlike' },
  { name: 'Sunscorch Dunes', subtitle: 'Gold sand over sleeping giants', tier: 4, prompt: 'endless golden dunes, glassy salt flats, one green oasis, a sandstone-domed caravan town, warm ochre-and-turquoise palette, mirage heat shimmer' },
  { name: 'Stormreach Peaks', subtitle: 'The sky remembers every storm', tier: 5, prompt: 'frozen lakes and pine ridges climbing to snow-capped summits, a stone mountain-fortress town, cool blue-white palette, thin crisp mountain light, aurora hints' },
  { name: 'Glimmer Hollows', subtitle: 'Where the mountain keeps its light', tier: 5, prompt: 'crystal canyons humming with trapped lightning, a mining town lit by glowing crystal lamps, violet-cyan palette, bioluminescent geode light' },
  { name: 'Aether Crown', subtitle: 'The storm at the top of the world', tier: 6, prompt: 'the ruined summit plateau of a central sacred mountain, ancient Sky Warden ruins, a churning storm and aurora overhead, dramatic god-tier finale vista, gold-and-violet palette' },
];

// ── Dungeon themes (v3 layout.ts) ───────────────────────────────────────────
const DUNGEONS = [
  { name: 'Rootway Burrow', theme: 'burrow', region: 'Verdant Vale', prompt: 'cozy earthen tunnels dug beneath giant tree roots, warm dappled light through root-gaps, packed dirt walls, tutorial-friendly and inviting, not scary' },
  { name: 'Drowned Chapel', theme: 'chapel', region: 'Mirror Lakes', prompt: 'a sunken stone chapel behind a waterfall, water trickling through cracked stained glass, moss and silt, hushed reverent gloom, shafts of blue-green light' },
  { name: 'Smuggler’s Grotto', theme: 'grotto', region: 'Sapphire Coast', prompt: 'a sea cave hideout strung with lanterns and rope, smuggled crates, glistening wet rock, turquoise light reflected off water pools, roguish adventure mood' },
  { name: 'Hollow Crypt', theme: 'crypt', region: 'Mistveil Marsh', prompt: 'a moonlit crypt of cracked tombs, hanging cobwebs, pale will-o-wisps, mossy skulls and gravestones, eerie blue-green fog, gothic but whimsical, not gory' },
  { name: 'Magma Forge', theme: 'forge', region: 'Ember Scar', prompt: 'an ancient smiths’ forge carved into the caldera, glowing lava channels, giant anvils, basalt columns, deep orange firelight, industrious dwarven-fantasy mood' },
  { name: 'Heartwood Hollow', theme: 'heartwood', region: 'Elderwood', prompt: 'the hollow interior of a colossal living tree, glowing sap veins, soft bioluminescent fungi, warm amber-green light, sacred and alive' },
  { name: 'Tomb of Sands', theme: 'tomb', region: 'Sunscorch Dunes', prompt: 'a half-buried desert pyramid interior, sandstone hieroglyph-carved halls, shafts of harsh sunlight through cracks, golden dust motes, adventurous tomb-raider mood' },
  { name: 'Frostfang Caverns', theme: 'ice', region: 'Stormreach Peaks', prompt: 'blue glacier ice caves, translucent frozen walls, hanging icicles, cold cyan-white light, crisp and pristine, faint aurora glow through the ice' },
  { name: 'Geode Heart', theme: 'geode', region: 'Glimmer Hollows', prompt: 'a hollow crystal cavern shaped like a cracked-open geode, giant glowing amethyst and citrine crystal formations, violet bioluminescence, awe-inspiring scale' },
  { name: 'Aether Sanctum', theme: 'sanctum', region: 'Aether Crown', prompt: 'the ruined sanctum of ancient Sky Wardens on the summit, floating stone platforms, storm-light pouring through a broken dome, gold-and-violet celestial grandeur' },
  { name: 'Starfall Grotto', theme: 'starfall', region: 'offshore islet, Sapphire Coast', prompt: 'a meteor crater grotto on a tiny offshore islet, a fallen star embedded in glassy black rock, faint cosmic glow, tide pools reflecting starlight, mysterious and rare' },
];

// ── Key NPCs (v3 content workstream) ────────────────────────────────────────
const NPCS = [
  { name: 'Warden Brisa', title: 'Hearthwick Guard', prompt: 'a stern but warm-hearted town guard woman in practical leather-and-steel armour, short cropped auburn hair, a kind no-nonsense expression, holding a spear at ease' },
  { name: 'Elder Maple', title: 'Mystic Scholar', prompt: 'an elderly robed scholar with a long grey beard and half-moon spectacles, warm cream-and-teal scholar robes, holding an ancient tome, gentle wise smile' },
  { name: 'Kai', title: 'Rival', prompt: 'a cocky teenage rival with messy dark hair, a confident lopsided grin, a light rogue-style traveling outfit, hands on hips in a challenging pose' },
  { name: 'Magister Vesper', title: 'Magister of the Hollow Veil', prompt: 'a tall masked villain in dark violet-and-black robes with silver filigree, an ornate porcelain mask hiding the face, an air of cold, elegant menace' },
];

const html = () => {
  const now = new Date().toISOString().slice(0, 10);
  const card = (title: string, sub: string, body: string, tag?: string) => `
    <div class="card">
      <div class="card-h"><h3>${title}</h3>${tag ? `<span class="tag">${tag}</span>` : ''}</div>
      <div class="sub">${sub}</div>
      <div class="prompt"><b>Prompt:</b> ${STYLE_PREFIX} ${body}</div>
    </div>`;

  const speciesCards = NEW_SPECIES.map((s) => card(`${s.name} <small>(${EL_WORD[s.element] ?? s.element})</small>`, `${s.role} — “${s.lore}”`, s.prompt)).join('');
  const landCards = LANDS.map((l) => `
    <div class="card land">
      <div class="card-h"><h3>${l.name}</h3><span class="tag">Tier ${l.tier}</span></div>
      <div class="sub">${l.subtitle}</div>
      <div class="prompt"><b>Environment prompt:</b> Painterly stylized fantasy game environment concept art, wide establishing shot, Clair Obscur × Zelda BotW mood, dramatic lighting, no text, no watermark — ${l.prompt}</div>
    </div>`).join('');
  const dungeonCards = DUNGEONS.map((d) => `
    <div class="card">
      <div class="card-h"><h3>${d.name}</h3><span class="tag">${d.theme}</span></div>
      <div class="sub">${d.region}</div>
      <div class="prompt"><b>Interior prompt:</b> Stylized fantasy dungeon interior concept art, painterly low-poly-friendly game environment, atmospheric lighting, no text, no watermark — ${d.prompt}</div>
    </div>`).join('');
  const npcCards = NPCS.map((n) => card(n.name, n.title, n.prompt)).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #2a2418; margin: 0; background: #faf6ec; }
    .page { width: 210mm; min-height: 297mm; padding: 16mm 16mm 14mm; page-break-after: always; position: relative; }
    .page:last-child { page-break-after: auto; }
    h1 { font-size: 30px; margin: 0 0 4px; letter-spacing: 0.5px; }
    h2 { font-size: 20px; margin: 0 0 10px; border-bottom: 2px solid #b89658; padding-bottom: 6px; color: #6b4a1e; }
    .kicker { color: #a07a30; font-size: 12px; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 10px; }
    .cover { display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; height: 297mm; background: linear-gradient(160deg,#f3ead1,#e6d3a3); }
    .cover h1 { font-size: 44px; }
    .cover .date { margin-top: 40px; color: #7a6030; font-size: 13px; }
    .lede { font-size: 13.5px; line-height: 1.65; margin-bottom: 14px; }
    ul.tight { margin: 6px 0 14px; padding-left: 20px; font-size: 12.5px; line-height: 1.55; }
    table.spec { width: 100%; border-collapse: collapse; font-size: 11.5px; margin: 8px 0 16px; }
    table.spec th, table.spec td { border: 1px solid #d8c69a; padding: 5px 8px; text-align: left; }
    table.spec th { background: #efe0b8; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .card { border: 1px solid #d8c69a; border-radius: 6px; padding: 9px 11px; background: #fffdf6; break-inside: avoid; }
    .card.land { grid-column: span 2; }
    .card-h { display: flex; justify-content: space-between; align-items: baseline; }
    .card h3 { margin: 0; font-size: 13.5px; color: #5c3d16; }
    .card h3 small { font-weight: normal; color: #8a6a3a; }
    .tag { font-size: 9.5px; background: #e6d3a3; color: #6b4a1e; padding: 1px 6px; border-radius: 10px; }
    .sub { font-size: 10.5px; color: #6a5a3a; font-style: italic; margin: 3px 0 5px; }
    .prompt { font-size: 10px; line-height: 1.45; color: #2a2418; }
    .footer { position: absolute; bottom: 8mm; left: 16mm; right: 16mm; font-size: 9px; color: #9a8558; display: flex; justify-content: space-between; border-top: 1px solid #d8c69a; padding-top: 4px; }
    .pipeline li { margin-bottom: 5px; }
  </style></head><body>

  <div class="page cover">
    <div class="kicker">Wild Mystics · v3</div>
    <h1>Vision &amp; Visual Prompt Pack</h1>
    <p style="max-width:120mm;font-size:14px;color:#6b4a1e;margin-top:18px">A product overview of the v3 overhaul, plus a ready-to-paste AI art prompt for every new creature, land, dungeon and character it adds.</p>
    <div class="date">Generated ${now} · Wild Mystics repo: tangowork09/wild-mystics · branch v3</div>
  </div>

  <div class="page">
    <div class="kicker">Product</div>
    <h2>What Wild Mystics is</h2>
    <div class="lede">Wild Mystics is an open-world creature-collecting RPG for web, Android and iOS: catch, train, battle and evolve over 150 Mystics across a living island, in the spirit of Miscrits and Pokémon, with turn-based battles staged and paced like Clair Obscur: Expedition 33 (real-time parries, dodges and QTEs inside a turn-based structure).</div>
    <h2>The v3 overhaul — what's changing</h2>
    <ul class="tight">
      <li><b>A ten-times bigger, designed world.</b> A 2 km island with ten lands ringed around a central mountain, Mount Aether, visible from everywhere.</li>
      <li><b>Real progression, not "no clue where to go."</b> A main story, side quests, a compass, an on-screen tracker and a 3D beacon always point at your next objective.</li>
      <li><b>A proper new-game opening.</b> New players start with nothing; a town guard walks up, a scholar offers three starters, and a rival kicks off the first battle.</li>
      <li><b>Locked lands, opened by play.</b> Sealed Warden Gates open only once you beat the neighbouring Guardian; fog of war covers the map until explored; hidden dungeons are found by searching, at night, or via a quest.</li>
      <li><b>Eleven hidden dungeons.</b> Each is a real interior with patrols, puzzles, chests and a boss.</li>
      <li><b>Every town has real shops.</b> An outfitter and a specialty shop in each of the nine towns, plus a rotating traveling merchant.</li>
      <li><b>Better monsters.</b> A stylised toon shading pass with rim light and outlines, shiny variants, giant "Alpha" wild Mystics, and 31 new species and Guardians for the four new lands.</li>
      <li><b>A full visual and UI overhaul.</b> A new colour palette, new fonts, a redesigned HUD, and every menu fitting the screen with no scrolling, on desktop and on a phone in landscape.</li>
      <li><b>Better graphics throughout.</b> A sculpted, eroded terrain; a real sky with clouds, stars and aurora; day/night lighting; dense forests and grass; and a hand-painted atlas-style world map.</li>
    </ul>
    <h2>How this pack is meant to be used</h2>
    <div class="lede">Every card below pairs a short in-game description with a complete, ready-to-paste prompt for an image model (Midjourney, GPT-Image, Flux, Seedream). Generate a clean front-view concept, then follow the existing asset pipeline in <code>ASSET_PROMPTS.md</code> (image → 3D via Hunyuan3D/Tripo/Meshy → Blender cleanup → rig → <code>tools/add-asset.mjs</code>) to drop your own art into the game. Anything you don't replace keeps using the free CC0 stand-ins.</div>
    <table class="spec">
      <tr><th>Asset</th><th>Tris</th><th>Textures</th><th>Notes</th></tr>
      <tr><td>Wild creature</td><td>4k–15k</td><td>1× 2048 PBR</td><td>Height per the game's data, 0.7–2.2 m</td></tr>
      <tr><td>Guardian / final boss</td><td>15k–50k</td><td>1–2× 2048</td><td>5–9.5 m, auto-scaled in-game</td></tr>
      <tr><td>NPC</td><td>8k–25k</td><td>1× 2048</td><td>1.6–1.9 m, biped rig with 8 standard clips</td></tr>
      <tr><td>Land / environment art</td><td>—</td><td>—</td><td>Reference-only concept art; guides the terrain and look workstreams' palette and mood, not a direct 3D import</td></tr>
      <tr><td>Dungeon interior</td><td>—</td><td>—</td><td>Reference-only mood art for theme, palette and prop dressing</td></tr>
    </table>
    <div class="footer"><span>Wild Mystics — Vision &amp; Visual Prompt Pack</span><span>Page 2</span></div>
  </div>

  <div class="page">
    <div class="kicker">New lands</div>
    <h2>Ten lands around Mount Aether</h2>
    <div class="lede">Environment concept-art prompts for the world's ten regions, tier 1 (starting) to tier 6 (the finale). Use these to art-direct the terrain palette, sky mood and vegetation per land.</div>
    <div class="grid">${landCards}</div>
    <div class="footer"><span>Wild Mystics — Vision &amp; Visual Prompt Pack</span><span>Page 3</span></div>
  </div>

  <div class="page">
    <div class="kicker">New creatures — Coast &amp; Elderwood</div>
    <h2>New Mystics (1 of 2)</h2>
    <div class="grid">${NEW_SPECIES.slice(0, 15).map((s) => card(`${s.name} <small>(${EL_WORD[s.element] ?? s.element})</small>`, `${s.role} — “${s.lore}”`, s.prompt)).join('')}</div>
    <div class="footer"><span>Wild Mystics — Vision &amp; Visual Prompt Pack</span><span>Page 4</span></div>
  </div>

  <div class="page">
    <div class="kicker">New creatures — Hollows, Summit &amp; Guardians</div>
    <h2>New Mystics (2 of 2)</h2>
    <div class="grid">${NEW_SPECIES.slice(15).map((s) => card(`${s.name} <small>(${EL_WORD[s.element] ?? s.element})</small>`, `${s.role} — “${s.lore}”`, s.prompt)).join('')}</div>
    <div class="footer"><span>Wild Mystics — Vision &amp; Visual Prompt Pack</span><span>Page 5</span></div>
  </div>

  <div class="page">
    <div class="kicker">Hidden dungeons</div>
    <h2>Eleven dungeon themes</h2>
    <div class="lede">One hidden dungeon per land, plus the offshore Starfall Grotto. Use these for interior mood, palette and prop dressing.</div>
    <div class="grid">${dungeonCards}</div>
    <div class="footer"><span>Wild Mystics — Vision &amp; Visual Prompt Pack</span><span>Page 6</span></div>
  </div>

  <div class="page">
    <div class="kicker">Key characters</div>
    <h2>Story cast</h2>
    <div class="lede">The four named characters carrying the v3 story: the prologue's guard and scholar, your rival, and the game's masked villain.</div>
    <div class="grid">${npcCards}</div>
    <h2 style="margin-top:18px">Pipeline reminder</h2>
    <ul class="tight pipeline">
      <li><b>1. Concept image</b> — generate 4 variations from the prompt above, pick the best.</li>
      <li><b>2. Clean front view</b> — re-prompt for a single centred full-body A-pose on plain grey, for image-to-3D tools.</li>
      <li><b>3. Image → 3D</b> — Hunyuan3D 2.5, Tripo, Meshy or Rodin, PBR textures, triangle budget per the table on page 2.</li>
      <li><b>4. Blender cleanup</b> — apply scale, face +Z, feet on origin, decimate if heavy.</li>
      <li><b>5. Rig + animate</b> — Mixamo for bipeds; Auto-Rig Pro / Rigify / Tripo auto-rig for quadrupeds, flyers and blobs.</li>
      <li><b>6. Import</b> — <code>node tools/add-asset.mjs creature &lt;id&gt; ~/Downloads/&lt;file&gt;.glb --height &lt;m&gt;</code>. The full per-asset spec (element list, evolutions, exact ids) lives in <code>ASSET_PROMPTS.md</code> and <code>src/data/species.ts</code>.</li>
    </ul>
    <div class="footer"><span>Wild Mystics — Vision &amp; Visual Prompt Pack</span><span>Page 7</span></div>
  </div>

  </body></html>`;
};

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
  });
  const page = await browser.newPage();
  await page.setContent(html(), { waitUntil: 'load' });
  await page.pdf({ path: OUT, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await browser.close();
  console.log('Wrote', OUT, `(${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB)`);
}

void main();
