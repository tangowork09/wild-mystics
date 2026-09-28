---
version: 1
slug: "src-ui-hud-ts"
primary_target: "src/ui/hud.ts"
related_targets: ["src/ui/journal.ts","src/ui/screens.ts","src/ui/services.ts","src/battle/battleUI.ts","src/ui/styles.css"]
---

# Wild Mystics v3 game UI — surface brief

## Scope and mode

- **Scope:** the whole game UI owned by the ui workstream: in-world HUD (badge, party, compass, tracker, minimap, beacon, prompt, touch controls, title card, toasts), Journal (team/storage, Mystidex, bag, relics, quests, feats, map, summon, profile, settings), screens (auth, title, loading, starter, dialog, shop, services, build mode, battle HUD, rewards, level-up, evolution/hatch, daily, guide, pause).
- **Mode:** Operate (game UI). Scanability, state and thumb reach outrank expression; delight is saved for moments (starter choice, summon, region card, captures, level-up).

## Audience, task, constraints

- Players on a phone held sideways (844×390, 740×360) and on desktop (1440×900, 1280×720).
- Jobs: know where to go next; read party health at a glance; manage team, bag and dex; buy and sell; fight with timed inputs.
- Hard rules: nothing scrolls at the four sizes (only typed free text is exempt); dark-first; ≥ 44 px touch targets under `html.touch`; `prefers-reduced-motion`; self-hosted fonts; element colours must pop.

## Chosen direction: Capsule Station

Gashapon capsule-toy packaging at night. Mystics are collectibles, so every container is a two-tone capsule or a die-cut sticker on dark cabinet ink, every collection is a numbered lineup card, and holo foil marks the secret rares. Assigned by the roll after the decision page closed unanswered (no structured question tool in this harness); proceeding unattended with the assignment.

Raises carried from the declined challengers:
- **From the viewfinder HUD:** the centre third stays empty; each corner owns one readout cluster; the objective beacon snaps corner brackets onto its target.
- **From the nixie counter:** gold, Aether, HP, XP and dex totals roll digit by digit when they change.
- **From the cracktro queue:** rank is one variable — selected, active and focused states ride one lift scale (flat → raised → popped).
- **From the orizuru fold sequence:** quest steps are numbered in a margin column; finished steps stay visible and stamped.
- **From the leather studio:** every control travels 2–4 px onto a real contact shadow.
- **From the cloud quarry:** sections part with gaps and colour blocks, never hairline rules.

Signature interaction: the **capsule pop** — panels open by splitting like a twisted capsule, confirmations land as a sticker slap (short overshoot, slight tilt, settle), counts roll. Motion grammar: 160–220 ms ease-out for state; overshoot only for slaps and reveals; reduced motion swaps every move for a fade.

Memorable moment: the starter choice — three capsules on the machine's shelf, each dome tinted by its element, one pops open to reveal the companion.

## Unresolved decisions

- NPC portraits use a stylised avatar until content supplies a bust resolver.
- The painted world map (`public/world/map.webp`) is used when the terrain workstream ships it; until then the map falls back to `world.data.colorMap`.

## Direction contract

THESIS: Mystics are collectibles, so the UI is a night-lit capsule machine: solid ink-outlined capsules and die-cut stickers that read over any biome. It refuses translucent fantasy glass with gold filigree.
OWN-WORLD: Cabinet ink ground, two-tone capsules (element dome, ink base), ink outline plus pale die-cut edge, magenta for objectives and primary actions, coin yellow for gold, holo foil only for rare, shiny and Aether; Dela Gothic One titles, M PLUS Rounded 1c everything else.
STORY: The player sees where to go at a glance, trusts every press, and pages collections like lineup cards.
FIRST VIEWPORT: Island full-bleed; player and party capsules top-left, mission sticker beneath, compass tape top-centre, capsule-window minimap top-right, centre empty, magenta beacon on the objective, touch actions in a bottom-right arc.
FORM: gashapon capsule-toy packaging at night, item 7 of my 7; seed 0dc7f1df.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
