# Expedition Wilds (prototype)

Open-world creature collector: Miscrits-style catching and teams, Expedition-33-style timed turn-based battles. Web build (three.js), plays on desktop and mobile browsers.

```bash
npm install
npm run dev          # http://localhost:5180  (also on your LAN IP, so you can open it on a phone)
npm run build        # production bundle in dist/
```

## What's in the MVP

- **Open world**: 520 m map with 4 zones (Verdant Vale, Ember Scar, Mirror Lakes, Stormreach Peaks). Procedural terrain, GPU grass that bends around you, lakes and lava, roads, sky and fog that shift by zone, a minimap and a world map.
- **Starter pick** from 3 (fire, water, nature). 38 catchable species, 12 evolution lines, 4 zone Guardians.
- **Encounters**:
  - visible wild creatures that wander, chase or flee
  - tall-grass random encounters
  - glimmering bushes to search
  - `F` to strike first, which gives you the advantage
- **Battles (E33-style)**:
  - speed-based turn timeline and per-creature AP
  - timed-hit QTE rings (Perfect / Good / Miss)
  - parry and dodge windows, with a whiff lockout that punishes mashing
  - unblockable red strikes, and counterattacks when you parry every strike
  - Break gauge that stuns, and bosses that enrage
  - elemental weakness wheel, buffs and debuffs
  - items, swap, flee
- **Capture**: weaken or Break the target, throw an orb, then steady it with a 3-beat QTE.
- **Towns** (one per zone):
  - Healer
  - Outfitter (shop)
  - **Hatchery**: breed two creatures into an egg that hatches by walking; genes inherit plus mutation, and one move is passed down
  - **Elementum Shrine**: infuse element shards for permanent stat boosts
  - **Move Master**: enhance skill ranks, remember forgotten moves
  - Keeper: team and storage box
- **Progression**: XP and levels, learnsets, evolution cinematic, gene grades (D–S), shiny variants, Crittdex, expedition-flag camps (rest and save), autosave in localStorage.

## Controls

| | Desktop | Touch |
|---|---|---|
| Move / look | WASD, drag mouse, wheel zoom | left thumb / right thumb |
| Sprint | Shift | Sprint button |
| Interact / strike first | E / F | prompt button / ⚔ |
| Menus | T team · C dex · B bag · M map · Esc | bottom-right buttons |
| Battle | 1–6 actions, ←→ Enter target, **Space** timed hits, **E/Space parry**, **Q/Shift dodge** | tap buttons / tap to hit / PARRY & DODGE |

## Your own art

See **[ASSET_PROMPTS.md](ASSET_PROMPTS.md)** for a prompt covering every asset. Drop in a model with:

```bash
node tools/add-asset.mjs creature emberling ~/Downloads/emberling.glb --height 1.1
```

The stand-in CC0 packs are rebuilt with `node tools/import-assets.mjs` (downloads live in `.asset-scout/`, which is git-ignored). Credits are in [CREDITS.md](CREDITS.md).

## Dev shortcuts (URL params)

- `?auto=world&pos=0,100&yaw=180`: skip the title with a test team
- `?auto=battle&sp=gloop,impling&lv=5`: jump straight into a battle
- `?auto=boss&zone=scar`: fight a guardian
- `&autoplay`: a bot plays the battle
- `?view=gallery`: every creature model
- `?q=low|medium|high`: force a quality tier (auto-detected otherwise)
- `node tools/shot.mjs <name> "<query>"`: headless screenshot into `.shots/`

## Code map

```
src/
  main.ts            game loop, event routing, battle orchestration
  data/              elements, skills, species, zones  ← balance lives here
  game/              creature math (stats, XP, evolution, breeding), save state
  world/             terrain bake, grass, water, atmosphere, props, towns, wilds, overworld
  battle/            battle controller (turn/QTE/parry/capture), UI, VFX
  ui/                HUD, minimap, menus, services, screens, styles.css
  assets/            manifest loader (GLB ↔ procedural fallback), placeholders
tools/               import-assets, add-asset, shot (headless verification)
```
