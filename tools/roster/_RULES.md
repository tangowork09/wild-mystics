# Wild Mystics roster pass — shared rules for all batch agents

Start by reading these files in `/Users/tango/expedition-wilds/`:
- `src/data/species.ts` — full existing species list (`LIST`/`make()`), the `Species`/`Row` types. This
  is where you look up the EXACT existing id, name, full stats, height, model, learnset, abilities,
  rarity, catchRate, tint and lore for every species in the lines you own (your task prompt tells you
  which lines and gives you the last existing stage's stats as a quick check, but read the real rows).
- `src/data/skills.ts` — valid skill ids (use ONLY ids that exist here).
- `src/data/traits.ts` — valid `AbilityId`s and `Rarity` (use ONLY ids that exist here).
- `tools/roster/_existing-registry.tsv` — every existing id/name/element/rarity (160 rows, tab-separated)
  so no new id or name you invent collides with an existing one.

You do not need `src/data/lines.ts` / `src/data/forms.ts` (they're empty stubs someone else fills from
your output) and you must not edit them or any file outside your one output JSON file below.

## Your job

You own a specific list of "lines" (given in your task prompt). For each line, the existing chain
members keep their ids and fill stages 1..k. You invent NEW species to fill stages k+1..5 (5 stages
total per line always). Then you write ONE JSON file with your batch's line data (new forms + lore)
and art-prompt entries for ALL 5 stages of every line you own (existing stages too).

**Branch lines**: id = `<parentStage1>__<stoneFormId>` (e.g. `bubblin__mosslime`). stage 1 = the
shared parent species (already exists, e.g. `bubblin`), stage 2 = the existing stone-evolved species
(e.g. `mosslime`). Element for stage 3-5 = the STONE FORM's element (e.g. mosslime is nature, not
bubblin's water), continuing that stone form's stats/tint, not the shared parent's.

## Output — write exactly this file (nothing else)

`tools/roster/<your-batch-file>.json` (path given in your task prompt), this exact shape:

```json
{
  "lines": [
    {
      "id": "chirpling",
      "branch": null,
      "stages": ["chirpling", "new_id_2", "new_id_3", "new_id_4", "new_id_5"],
      "existingCount": 1,
      "newForms": [
        {
          "id": "new_id_2", "name": "New Name Two", "element": "wind",
          "hp": 56, "atk": 15, "def": 11, "spd": 21,
          "height": 1.1, "model": "Birb",
          "learnset": [[1, "gale_cut"], [1, "feather_dart"], [10, "tailwind"], [16, "cyclone"]],
          "rarity": "rare", "catchRate": 0.25,
          "abilities": ["tailwind_soul", "swift"],
          "lore": "One warm, witty, short sentence in the house style."
        },
        { "id": "new_id_3", "...": "stage 3 fields, same shape" },
        { "id": "new_id_4", "...": "stage 4 fields" },
        { "id": "new_id_5", "...": "stage 5 fields, may include tintGlow / rideable" }
      ]
    }
  ],
  "prompts": [
    { "id": "chirpling", "name": "Chirpling", "line": "chirpling", "stage": 1, "element": "wind", "prompt": "..." },
    { "id": "new_id_2", "name": "New Name Two", "line": "chirpling", "stage": 2, "element": "wind", "prompt": "..." },
    { "id": "new_id_3", "name": "...", "line": "chirpling", "stage": 3, "element": "wind", "prompt": "..." },
    { "id": "new_id_4", "name": "...", "line": "chirpling", "stage": 4, "element": "wind", "prompt": "..." },
    { "id": "new_id_5", "name": "...", "line": "chirpling", "stage": 5, "element": "wind", "prompt": "..." }
  ]
}
```

Rules for the JSON:
- `newForms` covers ONLY the new stages (k+1..5) — do not re-emit existing species.
- Only include `tint`, `tintGlow`, `rideable`, `swim` keys when they apply (omit otherwise; never write `false`).
- `abilities` is always exactly 2 valid `AbilityId` strings.
- `catchRate` is a plain number (e.g. `0.18`), not a string.
- `prompts` covers **every** stage 1-5 of every line you own, including the pre-existing stages — write
  a fresh visual-description prompt for those too (base it on the existing name/lore/model you already
  have in context).
- Validate your own JSON before finishing (e.g. `node -e "JSON.parse(require('fs').readFileSync('tools/roster/<file>.json','utf8'))"`) and fix any syntax errors.

## Stat scaling (per new stage, from the previous stage's stats)

Multiply each of hp/atk/def/spd by roughly **1.12–1.16**, rounded to whole numbers, keeping the
line's personality (tank keeps def high relative to spd, glass cannon keeps spd/atk high, etc.).

**Hard caps at stage 5: hp ≤ 112, atk ≤ 30, def ≤ 30, spd ≤ 30. Never exceed these.** Legendaries run
~80–100 hp / 22–25 atk, so stage 5 may sit near that range but must respect the hard caps regardless.

Some lines' last EXISTING stage is already high (rare/epic/exotic bases). Before compounding blindly,
check: if `current_stat × 1.16 ^ (stages_left)` would exceed the cap, slow that stat down instead —
use whatever multiplier keeps you under the cap (can be as low as ~1.03–1.08 for an already-high stat),
independently per stat (hp/atk/def/spd don't have to share one multiplier). Worked examples:
- `quartzback` (earth, root, def **25** already) needs 4 new stages: def can only grow ~1.045/stage
  (25→~30), while hp (84) has more room (~1.07/stage to reach ~110). atk/spd similarly modest.
- `bellowdeep` (water, root, hp **95** already) needs 4 new stages: hp can only grow ~1.04/stage
  (95→~111), atk (20) has room to grow faster toward 30.
- A common low-stat root like `chirpling` (hp48/atk13/def9/spd18) has plenty of headroom — plain
  1.12–1.16 across all 4 new stages lands comfortably under every cap.
If ever unsure, undershoot rather than risk exceeding a cap.

## Height

Previous stage's height × **1.15–1.3**, capped at **3.4 m** absolute.

## Model

Every new stage reuses the line's **highest EXISTING stage's** `model` string verbatim (it's the 3D
placeholder until the sprite art lands) — all of stage 3, 4, 5 use that same one string.

## Learnset

Carry the previous stage's moves forward as `[1, skillId]` (its earliest 2-3 moves collapse to level 1;
1-2 of its later moves may keep a mid-teens level — see how `loamstrider`/`mossbuck`/`thornfang` do it
in species.ts for the house pattern), then add **1-2 new moves of the line's element** at a level drawn
from **22 / 28 / 34 / 40 / 45**, increasing as you move from stage 3 → stage 5. Use ONLY ids from this
list (already-valid, already used by non-legendary species — avoid `ult_*` Burst ultimates and the
patterned Guardian techniques `earthshaker tidal_crash root_quake sandstorm_fury bog_breath tide_bell
antler_rush geode_burst aether_judgement void_crown void_rend eclipse_wave gravemaw cinder_rain
maelstrom skyfall`, those are reserved for Legendaries/Guardians/Bosses):

- fire: ember_bite, flare_burst, kindle, meteor_fang, cinder_claw, flame_wheel, lantern_flare
- water: tide_lash, bubble_veil, riptide, mend_rain, aqua_jet, scald, purify, shell_guard, brine_lance
- nature: thorn_volley, bloom, vine_snare, grove_wrath, sleep_spore, pounce, thorn_howl
- earth: boulder_slam, stone_skin, tremor, rock_toss, geode_shell
- storm: spark_jab, thunderclap, overcharge, static_field, spark_storm, crystal_lance, prism_ray
- wind: gale_cut, cyclone, tailwind, feather_dart, frost_breath, gust_dive, moon_hoot, aether_gale
- void: shadow_claw, umbral_wave, soul_siphon, toxic_mist, hypno_glow, venom_fang, ink_cloud, warden_edge

## Abilities

Exactly 2 valid `AbilityId`s (from traits.ts) that fit the element. It's fine (and common) to just
carry the previous stage's 2 abilities forward unchanged; for stage 4-5 you may swap in something more
"final form" flavoured (`guardian_aura`, `intimidate`, `breaker`, `focus`, `rage`, `sturdy`…) if it fits.

## Rarity / catchRate (for the stages YOU are creating)

| stage | rarity | catchRate |
|---|---|---|
| 2 *(only if you must create stage 2 fresh, i.e. the line had just 1 existing stage)* | rare | ~0.22–0.28 |
| 3 | rare | ~0.18 |
| 4 | epic | ~0.10 |
| 5 | epic | ~0.06 |

Never edit an existing stage's rarity/catchRate — only set these on stages you're creating.

## Tint

Most base stages have no `tint` (defaults to the element's color). Element base colors: fire `#ff6f3c`,
water `#3aa8ff`, nature `#5ed66b`, earth `#e0a45a`, storm `#ffd23f`, wind `#6febd8`, void `#a983ff`.
Starting around stage 3-4, give new forms a `tint` hex that's a deeper/richer shift of that (or, for
branch/regional stages that already carry a `tint`, keep deepening from there). Add `tintGlow` (a
brighter accent hex) at minimum on stage 5 for **fire, storm and void** lines; optional elsewhere.

## Rideable / swim

`rideable: true` for stage 4-5 forms that are big land/bird creatures with height ≥ 1.8 m (skip it for
serpents/blobs/tiny things). `swim: true` only if the line's existing stages already have `swim: true`
(aquatic fish/eel lines) — carry it forward on every new stage; don't add it to lines that never had it.

## Names & lore

- id: unique snake_case, never reused across your batch or the existing registry.
- name: unique, Pokémon/Miscrits-grade, catchy — must sound like the SAME creature growing up (shared
  root sounds/themes with earlier stages), grander by stage 5. Avoid generic one-word names likely to
  collide with another batch (e.g. plain "Emberking"/"Inferno") — anchor names to this line's own root
  word so they're naturally distinctive.
- lore: one line, warm/witty/short, in the existing house style (see species.ts examples you already have).

## Art prompts

One entry per stage per line (existing stages included). Each `prompt` is 1-2 sentences describing
THAT form's visual design only — silhouette, palette, signature features, and how it visibly grows from
the previous stage (same colours/eyes/signature motifs, but bigger, more ornate, more majestic by stage
5). Do **not** repeat the style prefix the user pastes in front of every prompt:
*"Stylized fantasy creature concept art for a premium monster-collecting RPG, painterly, cute-to-majestic,
big expressive eyes, full body, 3/4 view, plain light-grey background, no shadow, no text —"*
Calibration (already-painted references, described so you don't need to open the files): `mossbuck`
(nature stag) is a moss-and-antler creature dripping with hanging ferns, tiny mushrooms and white
flowers, with glowing leaf-shaped eye markings down its flank and warm golden-brown fur fading to a
cream belly — ornate, warm, painterly, not scary. `reefwarden` (water) is a big round toad-turtle whose
shell is a coral reef: barnacles, sea fans, tiny waterfalls and glowing coral tips, teal-blue skin with
a cream belly, huge warm amber eyes. That's the target density/warmth for a mid-to-late evolution —
stage 5 forms should go noticeably further (more ornamentation, a stronger silhouette, a clear "final
form" presence) while staying readable and cute-rooted, never grotesque.

## Reminders

- Don't touch `species.ts` or any file outside `tools/roster/<your file>.json`.
- Stat caps, duplicate ids/names, and valid skill/ability ids are all checked centrally afterward — but
  get them right the first time, it saves a fix-up pass.
