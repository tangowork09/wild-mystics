# Expedition Wilds — Asset Prompt Pack

Everything in the MVP currently uses **free CC0 stand-ins** (Quaternius monsters, KayKit characters/buildings, Kenney FX/audio). This file gives you a prompt for **every asset slot** so you can generate your own art and drop it in, one piece at a time. Anything you don't replace keeps working.

---

## 0. Pipeline (per asset, ~10–20 min each)

1. **Concept image**: GPT-image / Midjourney / Flux, using the *Style prefix* + the asset's prompt. Generate 4, pick 1.
2. **Clean front view**: re-prompt or edit to get a **single, centred, full-body, neutral A-pose, plain light-grey background** image. Image→3D tools need this.
   *Optional:* also generate side and back views for multi-view tools (Hunyuan3D-2mv, Tripo multi-view).
3. **Image → 3D**: Hunyuan3D 2.5 (or Tripo / Meshy / Rodin). Ask for PBR textures, ≤ 15k tris for wild creatures, ≤ 40k for bosses.
4. **Blender cleanup**: Apply scale, face **+Z** (forward), feet on origin, decimate if heavy, one material if possible, 2048 (or 1024) textures.
5. **Rig + animate**:
   - Bipeds: Mixamo auto-rig + Mixamo animations, or Auto-Rig Pro / Rigify.
   - Quadrupeds / birds / blobs: Auto-Rig Pro, Rigify animal metarigs, Tripo auto-rig or AccuRig. Keyframe the short list in §1.3.
6. **Export GLB** (animations embedded, "+Y up"), then run:
   ```bash
   node tools/add-asset.mjs creature emberling ~/Downloads/emberling.glb --height 1.1
   ```
   The tool optimises the model (WebP textures, dedup), auto-maps your clip names (Idle/Walk/Run/Attack/Hit/Death/Cast/Victory), and updates `public/assets/manifest.json`. **Refresh the browser. That's it.**

---

## 1. Global specs

### 1.1 Style prefix (paste before every creature/character prompt)

> *Stylized fantasy creature concept art for a premium 3D monster-collecting RPG, painterly Belle-Époque fantasy mood inspired by Clair Obscur: Expedition 33, appealing chunky readable silhouette, big expressive eyes, hand-painted PBR materials, soft rim light, full body, neutral standing A-pose, front view, orthographic, centred, plain light-grey background, no cast shadow, no text, no watermark —*

For **evolutions**, add: *"same creature as the reference image, evolved: larger, more confident, keeps the same colour palette, eye design and signature features, more ornate"*, and attach the base form's image.

### 1.2 Technical targets

| Asset | Tris | Textures | Height in game |
|---|---|---|---|
| Wild creature | 4k–15k | 1× 2048 PBR (1024 ok) | per table (0.8–2.2 m) |
| Boss | 15k–40k | 1–2× 2048 | 6.5–7.5 m (auto-scaled) |
| Player / NPC | 8k–25k | 1× 2048 | 1.7–1.8 m |
| Building | 2k–15k | 1× 2048 atlas | 6–12 m |
| Tree / prop | 0.5k–8k | shared atlases | 0.3–10 m |

- GLB, Y-up, **facing +Z**, origin at the feet, any unit scale (the game normalises to the height column).
- Up to about 60 bones. Embed animations in the same GLB.

### 1.3 Animation sets (name clips like this; the tool also fuzzy-matches)

| Body plan | Required clips | Notes |
|---|---|---|
| **Biped** | `Idle`, `Walk`, `Run`, `Attack`, `Hit`, `Death`, `Cast`, `Victory` | Attack impact ≈ 45% into a 0.8–1.0 s clip |
| **Quadruped / ground** | `Idle`, `Walk`, `Run`, `Attack` (bite/pounce), `Hit`, `Death`, `Cast` (roar), `Victory` (hop) | |
| **Flyer** | `Idle` (hover loop), `Run` (fast fly), `Attack` (dive/headbutt), `Hit`, `Death` (fall), `Cast`, `Victory` (loop-de-loop) | Hover ~1 m off the origin inside the clip |
| **Blob** | `Idle` (breathe/bounce), `Run` (hop), `Attack` (slam), `Hit` (squash), `Death` (melt), `Cast` (inflate), `Victory` | |

---

## 2. Creatures (38 catchable)

Columns: **id** (use with `add-asset`), element, height, body plan, prompt (after the style prefix).

### Starters

| id | Element | H | Plan | Prompt |
|---|---|---|---|---|
| `emberling` | Fire | 1.1 | Flyer | small ember-drake hatchling, round belly, stubby wings with glowing ember-veined membranes, two horn nubs, smouldering tail tip, charcoal-orange scales with gold freckles, curious happy face |
| `pyrowyrm` | Fire | 2.2 | Flyer | evolved Emberling: sleek young fire wyrm, wide ember-veined wings, crown of short obsidian horns, molten cracks glowing along the chest, trailing sparks from the tail, noble but friendly |
| `finnik` | Water | 1.1 | Ground | walking fish creature with stubby legs, big glossy eyes, bright teal scales, yellow fan fins like little wings, tiny sharp grin, water droplets orbiting its head |
| `tidecaller` | Water | 2.0 | Biped | evolved Finnik: athletic fish warrior standing upright, fin-crest mohawk, gold fin gauntlets, coral jewellery, flowing tail fin, calm heroic pose |
| `sporelet` | Nature | 1.0 | Ground | tiny mushroom creature with a wide blue-teal cap, cream stubby body, sleepy half-lidded eyes, little root feet, glowing spores drifting from the cap |
| `mycobloom` | Nature | 1.4 | Ground | evolved Sporelet: bigger mushroom with a spotted crown cap edged in golden spikes, open cheerful mouth, flowers sprouting at its feet, bioluminescent gills |
| `sporeking` | Nature | 2.1 | Biped | final evolution: regal mushroom monarch standing upright, broad teal cap like a royal hat, mossy cape, staff of living root, tiny mushroom attendants on its shoulders |

### Verdant Vale

| id | Element | H | Plan | Prompt |
|---|---|---|---|---|
| `gloop` | Nature | 0.9 | Blob | wobbly moss-green slime blob with leafy bumps, one big friendly eye, tiny clover sprouting on top |
| `spikegloop` | Nature | 1.3 | Blob | evolved Gloop: darker moss blob covered in pale thorn spikes, grumpy squint, flowers blooming between the spikes |
| `chirpling` | Wind | 0.9 | Ground | round fluffy bird with a crest shaped like a paper plane, sky-blue and coral feathers, tiny feet, overconfident hawk expression |
| `pecklet` | Earth | 0.9 | Ground | chubby hen creature with pebble-grey stony plumage, mossy comb, crystal pebbles lodged in its feathers |
| `hopscotch` | Wind | 1.4 | Biped | lanky white rabbit adventurer, long ears streaming like ribbons, wind-swirl markings, springy legs, scarf |
| `pricklet` | Nature | 0.9 | Ground | small round cactus critter wearing a tiny flower-sombrero, stubby arm-pads, shy smile |
| `saguardian` | Nature | 1.9 | Biped | evolved Pricklet: tall saguaro-cactus guardian, flowering crown, stoic face, desert-sun poncho, spine-lined shoulders |
| `voltcat` | Storm | 0.9 | Ground | orange tabby cat with static-puffed fur, zigzag stripes that glow faint yellow, lightning-bolt tail tip |
| `monkroose` | Earth | 1.5 | Biped | mongoose-monkey hybrid juggling river stones, sandy fur with clay-painted markings, big mischievous grin |

### Ember Scar

| id | Element | H | Plan | Prompt |
|---|---|---|---|---|
| `impling` | Fire | 1.0 | Flyer | tiny red imp with bat wings, stubby horns, ember-tipped tail, holding a little charred pitchfork, cheeky grin |
| `hellion` | Fire | 1.9 | Biped | evolved Impling: tall lanky fire demon, curled horns, cracked-lava skin, flaming mane, tattered wing-cloak, confident smirk |
| `grunt` | Earth | 1.0 | Ground | small stout goblin-like rock creature with a crystal mohawk, round belly, oversized ears, loud open mouth |
| `warlord` | Earth | 2.0 | Biped | evolved Grunt: hulking stone-skinned warrior with a crystal crest, spiked stone club, bark-and-bone armour, scarred but kind eyes |
| `cinderquid` | Fire | 1.2 | Flyer | squid creature that swims through air like lava, glowing magma-orange tentacles, obsidian beak, heat-shimmer fins |
| `gloomling` | Void | 1.0 | Flyer | small olive-grey bat gremlin with a beaky snout and tattered wings, violet glowing eyes, giggling pose |
| `gloomlord` | Void | 1.7 | Flyer | evolved Gloomling: gremlin lord with a stolen golden crown, wide shadow wings trailing smoke, violet runes on its chest |

### Mirror Lakes

| id | Element | H | Plan | Prompt |
|---|---|---|---|---|
| `glub` | Water | 1.0 | Flyer | floating purple-blue fish-balloon with fin-wings, bubble antenna, puffy cheeks |
| `glubbernaut` | Water | 1.7 | Flyer | evolved Glub: armoured deep-sea diver creature, brass-helmet-like head shell, pressure-glow portholes, large fin wings |
| `croakus` | Water | 1.4 | Biped | mustard-yellow frog bard with a throat sac that glows when it croaks, lily-pad hat, webbed hands |
| `bubblin` | Water | 0.8 | Blob | pink translucent slime with a strawberry-shaped core, floating bubbles, sleepy face |
| `alpuff` | Wind | 1.1 | Flyer | cloud-fluffy alpaca-like creature that floats, golden wool, tiny wing-tufts, helmet-shaped head tuft |
| `alpaqueen` | Wind | 1.8 | Flyer | evolved Alpuff: regal floating alpaca queen, flowing wool cape, feather crown, jewelled halter, gentle eyes |
| `whirlie` | Water | 1.2 | Flyer | purple octopus-like creature spinning a small whirlpool beneath it, curling tentacles, playful |

### Stormreach Peaks

| id | Element | H | Plan | Prompt |
|---|---|---|---|---|
| `zapbee` | Storm | 0.9 | Flyer | chubby bumblebee with black-and-gold stripes that spark, crackling antennae, translucent wings |
| `voltarmor` | Storm | 1.6 | Flyer | evolved Zapbee: armoured storm hornet, gold-plated chitin, lightning-rod stinger, heroic stance |
| `zorp` | Storm | 1.0 | Ground | tiny purple alien bulb with curly green antennae, one-tooth smile, static glow |
| `xenobolt` | Storm | 1.9 | Biped | evolved Zorp: tall purple alien with spiral horns channeling lightning, sleek suit-like skin, calm mysterious face |
| `frostling` | Wind | 1.0 | Ground | small blue snow-yeti blob with frosty fur, big toothy grin, snowball in hand |
| `glaciator` | Wind | 2.1 | Biped | evolved Frostling: towering yeti with ice-crystal shoulder armour, frost breath, icicle beard |
| `shadekin` | Wind | 1.0 | Ground | tiny round ninja creature in a black hood, two short swords on its back, wide innocent eyes |
| `shinobi` | Wind | 1.8 | Biped | evolved Shadekin: agile masked ninja beast, wind-scarf trailing, dual blades, crouched ready pose |
| `sparkmage` | Storm | 1.0 | Ground | little wizard blob under a giant purple star-embroidered hat, sparks crackling from its hat brim |
| `wisp` | Void | 1.1 | Flyer | ghostly lantern-spirit with bat-like wisps for wings, violet flame body, gentle glowing eyes |

---

## 3. Guardians (bosses)

Make these the showpieces: more detail, 20k–40k tris, emissive accents. Add to the prefix: *"towering boss monster, dramatic, menacing but still stylized, glowing emissive details"*.

| id | Element | H | Plan | Prompt |
|---|---|---|---|---|
| `thornjaw` | Nature | 6.5 | Biped | **Thornjaw Rex**: ancient forest tyrannosaur covered in bark plates and flowering vines, jaws lined with thorn teeth, a crown of antler-branches with glowing pink blossoms, moss hanging from its arms |
| `ashen_totem` | Fire | 6.8 | Flyer | **Ashen Totem**: colossal floating tiki mask carved from obsidian, feathers of flame, molten eyes, ember runes, orbiting fragments of charred wood |
| `abyssal_tyrant` | Water | 6.8 | Biped | **Abyssal Tyrant**: hulking deep-sea ogre, abyssal blue skin, bioluminescent teal markings, coral-encrusted club, anglerfish lure on its brow |
| `stormcrown` | Void | 7.5 | Flyer | **Stormcrown**: crowned wraith with a skull face, shredded violet storm-cloud robes, lightning crackling through its ribs, crown of floating shards |

---

## 4. Characters

| Slot | Command | Prompt (use a human-character prefix: *"stylized 3D RPG character, Belle-Époque expedition gear, painterly, A-pose, front view, plain background"*) |
|---|---|---|
| Player | `add-asset player - hero.glb` | young expedition explorer, satchel and brass compass, long travelling coat, scarf, sturdy boots, capture-orb holster on the belt, determined friendly face |
| Healer keeper | `add-asset npc - healer.glb` | gentle village healer in white-and-rose robes, herb pouch, round spectacles |
| Outfitter keeper | `npc` | cheerful merchant with a blue apron, pack of orbs on her back |
| Hatchery keeper | `npc` | farmer in straw hat and overalls cradling a speckled egg |
| Shrine keeper | `npc` | robed mystic with a crystal-tipped staff, violet sash |
| Move Master | `npc` | retired martial artist, red headband, calm, wooden practice staff |
| Keeper (storage) | `npc` | innkeeper with a ledger and ring of keys |
| Villagers ×3 | `npc` | townsfolk variations: baker, child with kite, old fisherman |

Biped clips: `Idle`, `Walk`, `Run`, `Attack` (throw an orb), `Cast`, `Hit`, `Death`, `Victory` (cheer), `Interact`.

---

## 5. Buildings and town

Prefix: *"stylized fantasy village building, 3D game asset, Belle-Époque storybook architecture, warm plaster and timber, painterly, isometric three-quarter view, plain background"*.

| Key | Command | Prompt |
|---|---|---|
| `healer` | `add-asset building healer x.glb --height 11` | chapel-like healing house, rose-coloured roof, stained-glass heart window, herb garden boxes |
| `shop` | `building shop` | outfitter shop with a striped blue awning, display of glowing capture orbs, hanging sign |
| `hatchery` | `building hatchery` | round barn with a giant decorative egg on the roof, warm lanterns, straw nests visible |
| `shrine` | `building shrine` | open marble rotunda with a floating violet Elementum crystal in the centre, elemental runes on the pillars |
| `tutor` | `building tutor` | two-tier dojo/training hall, red lacquered roof, practice dummies outside |
| `storage` | `building storage` | cosy inn and warehouse, stacked crates, big wooden doors, creature-bed windows |
| `house` ×4 | `building house` (run 4 times) | small village houses, different roof colours (red, blue, green, amber) |
| `well`, `barrel`, `crate`, `sack`, `fence`, `flag` | `add-asset decor <key> x.glb` | matching storybook props |
| Expedition camp | `add-asset decor camp x.glb --height 3` | expedition tent with flag, campfire ring, bedroll |
| Arena stones | `add-asset decor standing_stone x.glb --height 5` | tall carved monolith with glowing rune grooves |

---

## 6. Nature (per zone)

Prefix: *"stylized hand-painted 3D game environment asset, painterly foliage cards, soft gradients, isolated on plain background"*.
Add variants with `add-asset env <key> file.glb`; each call adds one variant, and `--replace` clears the old ones first.

| Key | Where | Prompt |
|---|---|---|
| `tree_round` | Vale, Lakes | lush round broadleaf tree, layered painterly leaf clusters, warm sunlight tints |
| `tree_pine` | Lakes, Peaks | tall stylized pine, layered needle tiers, some with snow caps |
| `tree_dead` | Ember Scar | charred dead tree with ember-glowing cracks and ash on branches |
| `tree_twisted` | all | twisted autumn tree with crimson and amber foliage |
| `tree_crystal` | Peaks | cluster of violet and ice-blue crystal spires growing from rock, glowing cores |
| `rock`, `boulder` | all | mossy stylized rocks and big boulders; volcanic variants for the Scar; icy variants for the Peaks |
| `bush`, `fern`, `flowers`, `mushroom`, `pebbles` | all | ground cover set in the same painterly style |

**Ground textures** (tileable, 2048, seamless): *"seamless tileable stylized hand-painted ___ texture, top-down, game-ready"*
- grass
- dirt path
- cobblestone plaza
- volcanic ash
- lake sand
- snow
- cliff rock

Save as `public/assets/textures/ground_detail.webp` and `rock_detail.webp` (these replace the current ones).

**Skyboxes** (Blockade Labs Skybox AI, one per zone, for a future HDRI mode):
- Vale: "golden hour pastoral valley sky, painterly clouds"
- Scar: "smoky crimson sunset with distant volcano glow"
- Lakes: "misty turquoise morning over mirror lakes"
- Peaks: "violet storm clouds with lightning over snowy peaks"

---

## 7. UI and 2D

| Asset | Prompt |
|---|---|
| Logo | "EXPEDITION WILDS" title lettering, engraved gold serif, Belle-Époque ornament, subtle creature silhouette in the W, transparent background |
| Element icons ×7 | flat-ish gilded icons in a diamond frame: Fire flame, Water drop, Nature leaf, Earth mountain, Storm bolt, Wind swirl, Void star-eye |
| Item icons | capture orb (red/gold), great orb (blue/gold), tonic bottle, elixir flask, gold coin, Elementum shard (per element colour), egg |
| Portraits (optional) | `add-asset portrait <id> file.png`: square 3/4 bust render on transparent background (the game auto-renders portraits from the 3D model if you skip this) |
| Loading art | panoramic painting of the four zones meeting at Hearthwick at dusk |

---

## 8. VFX textures (white on black or transparent, 512²)

Put these in `public/assets/vfx/` using the same file names to override the Kenney ones:
- `slash_01..04`: stylized crescent slash arcs
- `spark_05`, `star_06/07`: impact stars
- `flare_01`: soft lens flare
- `magic_01/03`: arcane swirls
- `symbol_01/02`: rune circles
- `circle_02/05`: shockwave rings
- `smoke_04/07`: puffs
- `twirl_02`: vortex
- `trace_01/04`: streaks
- `dirt_02`: debris chunk
- `scorch_01`: ground scorch

---

## 9. Audio

**Music** (Suno / Udio / Stable Audio). Replace `public/assets/audio/music_*.mp3`:
- `music_overworld`: "orchestral adventure, French café accordion meets strings and harp, hopeful, wandering tempo 95 bpm, loopable, Expedition 33 inspired"
- `music_town`: "cosy village waltz, music box, cello, warm hearth, loopable"
- `music_battle`: "energetic orchestral battle, driving strings, choir stabs, piano ostinato, 140 bpm, loopable"
- `music_boss`: "epic dark orchestral boss theme, full choir, pipe organ, timpani, heroic climax, loopable"

**SFX** (ElevenLabs Sound Effects). Replace `public/assets/audio/<name>.mp3`:
- `hit`: meaty stylized impact
- `hit2`: heavier impact
- `slash`: blade whoosh
- `quake`: ground slam
- `perfect`: bright crystal ding
- `parry`: metallic clang with shimmer
- `dodge`: cloth whoosh
- `miss`: dull thud
- `select`, `back`, `open`, `error`: UI clicks
- `capture`: orb throw whoosh
- `orb`: orb wobble click
- `captured`: triumphant chime
- `break`: glass shatter plus bass
- `heal`: soft sparkle
- `levelup`: fanfare sting
- `encounter`: dramatic hit
- `faint`: descending whimper
- `coin`: coin clink

---

## 10. Suggested order (biggest visual win first)

1. **Player** and the **3 starters (plus their evolutions)**: you see them every minute.
2. **4 guardians**: the showpieces.
3. **Zone trees** (`tree_round`, `tree_pine`, `tree_dead`) and the ground textures.
4. **6 service buildings**.
5. The remaining wild creatures, zone by zone (Vale first).
6. Music, then SFX, then icons and logo.
