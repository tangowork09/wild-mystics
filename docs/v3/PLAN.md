# Wild Mystics v3 — master plan

v3 is a full overhaul of Wild Mystics (three.js creature collector). It targets web/PWA, Android and iOS (Capacitor), phones in landscape, and desktop.

Every workstream agent reads this file first. It is the contract between the workstreams.

## 1. What the player asked for

Every item below is required.

1. **Award-winning quality.** This covers the look, the feel and the polish.
2. **The map.** It must be massive, built around a designed layout, with better terrain and better graphics throughout: sky, water, light, vegetation and post.
3. **Quests, with no more "no clue where to go".**
   - A main story plus side quests.
   - Clear guidance to every objective: a tracker, a compass, map pins, a world beacon, and a breadcrumb trail.
4. **Onboarding.**
   - A new player spawns with no Mystics.
   - A town guard walks up, talks to them, and lets them choose one of three starters.
   - With that Mystic they get the first quests, which teach catching, healing, shopping and the map.
5. **Regions are locked, then unlocked by exploring and progressing.**
   - Sealed Warden Gates open when a Guardian is answered.
   - Fog of war covers the map.
   - Hidden dungeons can be discovered.
6. **Hidden dungeons.** Each one is its own interior with fights, chests, puzzles and a dungeon boss.
7. **Shops, and every item in them.** Each town gets an outfitter plus a specialty shop, and there is a traveling merchant. Players can buy and sell.
8. **Better monsters.** This means the look (shading, outline, shiny), behaviour in the world, more species/variants, and alphas.
9. **Better fonts and a full colour palette revamp.**
10. **Menus that look great and never scroll.** Every menu fits the viewport on desktop and on a phone in landscape.
11. **Better placement of everything.** This covers the HUD layout, the town layouts, props, and battle staging.

## 2. World layout (source of truth: `src/data/zones.ts` and `src/data/layout.ts`)

### The world

- It is a **2048 × 2048 m** square with an **island** in the middle; ocean fills the space beyond the coast.
- Coordinates:
  - x runs east.
  - z runs south, so north is −z, the top of the map.
  - A bearing is measured in compass degrees from north, clockwise.
- **Mount Aether** is a central massif at (0, −40):
  - Foot radius about 330 m; summit about 230 m high.
  - The Sky Warden ruins sit on the summit plateau.
  - It is visible from everywhere and acts as the island's compass landmark.
- **Eight lands ring the mountain.** Each land is a 40° wedge, running from the mountain foot out to the coast (radius about 330–915 m).
  - **Spurs:** ridges radiate from the mountain to the sea between neighbouring lands. The bearings are in `SPURS`.
  - **Gates:** you can only pass a spur at a **Warden Gate** (`GATES`), where the ring road crosses the spur.
  - **Ring road:** it runs through the eight towns at a radius of about 560 m.
- **Progression tiers** (the player can pick the order within each tier):

| Tier | Lands (levels) | Reached by |
|---|---|---|
| 1 | Verdant Vale (2–8) | Start. Hearthwick sits at the mountain's south foot |
| 2 | Mirror Lakes (8–13), Sapphire Coast (8–13) | Beating the Vale Guardian opens both gates |
| 3 | Mistveil Marsh (13–18), Ember Scar (13–18) | Beating the neighbouring tier-2 Guardian |
| 4 | Elderwood (18–23), Sunscorch Dunes (18–23) | Beating the neighbouring tier-3 Guardian |
| 5 | Stormreach Peaks (23–28), Glimmer Hollows (23–28) | Beating the neighbouring tier-4 Guardian. The Skybridge between them opens after either Guardian |
| 6 | Aether Crown (28–35) | **The Crown Gate** (just north of Hearthwick) opens with all 9 Guardian sigils |

- **Dungeons** (`DUNGEONS`): there is one per land, plus the Starfall Grotto on an offshore islet.
  - Some are hidden. They are revealed by a night visit, by searching, by a quest, or by an item.
- **Points of interest** (`POIS`): vistas, ruins, groves, a lighthouse, a mine and an oasis. They are used for discovery and quests.
- **Homestead:** it sits east of Hearthwick.
- **Start position:** the start position `START_POS` is Hearthwick's south gate.

The world workstream may nudge positions to fit the terrain but must keep the ids. If a nudge exceeds 30 m, update `zones.ts`/`layout.ts` in the same commit.

## 3. Story and progression outline

The content workstream owns the full script. Tone: warm, witty and a little melancholy (Pokémon warmth meets Expedition 33 wistfulness). Lines are short and readable on a phone.

- **Prologue — "Empty-handed"**
  1. The Wayfarer arrives at Hearthwick's south gate with nothing.
  2. **Warden Brisa**, the town guard, walks up: "No Mystic? The wilds will eat you alive."
  3. She escorts the player to **Elder Maple**, the Mystic scholar (the Pokémon "professor").
  4. Maple presents three young Mystics — Emberling (fire), Finnik (water) and Sporelet (nature) — and the player chooses one.
  5. The rival **Kai**, Maple's grandchild, takes the counter-pick and challenges the player to a first, winnable battle.
- **Chapter 1 — "First Bond" (Vale)**
  - The player learns the basics: catch a Mystic in Whisperwind Meadow (given 5 orbs), heal at the Healer, buy at the Outfitter, attune the Waystone, and read the map.
  - Maple explains that a storm grows on the Crown each year and the Guardians wake restless.
  - **The Hollow Veil** first appears: masked tamers siphoning Guardian light.
  - Rootway Burrow (the tutorial dungeon) leads to the Old Grove. There the player answers **Thornjaw Rex**, earning the Verdant Sigil, and both tier-2 gates open.
- **Chapters 2–9 — one land each**
  - Each land has its own chain:
    1. Arrive in town and meet the local leader.
    2. Face a local problem tied to the Veil.
    3. Face Veil tamers and a rival battle with Kai.
    4. Clear the dungeon; it is optional in some lands and part of the story in others.
    5. Answer the Guardian and earn its sigil, which opens the next gate.
  - The lands need not be done in order; within a tier, the player chooses.
- **Finale — "The Crown"**
  - With nine sigils, the Crown Gate opens. The player climbs Mount Aether and clears the Aether Sanctum.
  - They face Magister Vesper of the Hollow Veil, then calm the Storm Seraph.
- **Post-game:** legendaries, the Starfall Grotto, alphas, shiny hunting, bounties, dailies, and Kai's final rematch.

**Side content:**
- Town quest boards and NPC personal quests (at least 3 per town).
- Bounties against **Alphas**: elite, oversized wild Mystics with a crown aura.
- Treasure chests at points of interest.
- Tamers in every land.
- Dailies stay.

## 4. Workstreams and ownership

Each workstream runs in its own git worktree or branch. **Only edit files you own.** If you must touch a file someone else owns, keep the change minimal and additive, and list it under "Integration notes" in your final report.

| Workstream | Owns (create or rewrite freely) | Must preserve |
|---|---|---|
| **terrain** | `tools/worldgen/**`, `public/world/**`, `src/world/terrain*.ts`, `src/world/bake.worker.ts`, `src/world/water.ts`, `src/world/roads.ts` (new), and the terrain/position fields of `src/data/zones.ts` + `src/data/layout.ts` | The `TerrainData` sampling API (`heightAt`, `slopeAt`, `grassAt`, `tallAt`, `pathAt`, `plazaAt`, `lavaAt`), `WORLD_SIZE`, `WATER_LEVEL`, `FEATURES`/`PATHS` (or documented replacements), and `data.colorMap` or a documented map image |
| **look** | `src/core/renderer.ts`, `src/world/atmosphere.ts` (sky, clouds, sun/moon, fog, day/night, weather), `src/world/grass.ts`, `src/world/props.ts` (vegetation scatter, LOD and impostors), `src/world/flora/**` (new), and the colour/weather fields of `zones.ts` | The `Props` API used by others (`nearby`, `addCollider`, `setClear`, `update`, `group`) and `Grass.setClear` |
| **ui** | `src/ui/**` (all menus, HUD, screens, minimap, map, dialog, shop UI, quest log/tracker, compass, markers), `src/ui/styles.css`, `index.html` (loading), `src/battle/battleUI.ts`, and the font imports at the top of `src/main.ts` | The function signatures `main.ts` calls (`openJournal`, `openService`, `screens.*`, `Hud`), unless you update the call sites |
| **creatures** | `src/assets/manifest.ts` (creature rigs/materials), `src/assets/placeholders.ts`, `src/world/wilds.ts`, `src/battle/battle.ts` + `unit.ts` + `vfx.ts` (staging, camera, VFX, not the battle UI), `src/data/species.ts`, `src/data/spawns.ts`, `src/data/skills.ts`, `src/data/traits.ts`, and new creature models under `public/assets/models/creatures` | The `BattleSetup`/`Battle.run()` shape `main.ts` uses, and the save format of `Creature` |
| **content** | `src/game/quests.ts` (new engine), `src/data/quests.ts`, `src/data/npcs.ts`, `src/data/shops.ts`, `src/data/items.ts`, `src/data/progression.ts`, `src/data/tamers.ts`, `src/game/progress.ts`, `src/game/shop.ts`, `src/game/story.ts` (onboarding director), `src/game/explore.ts` (fog of war), `src/game/gates.ts`, `src/world/npcs.ts` (NPC actors), `src/world/gates.ts` (gate barriers), and `src/game/state.ts` (save v3 + migration) | `GameState` migration from v2 saves |
| **towns** (phase 2) | `src/world/towns.ts`, `src/world/landmarks.ts`, `src/world/homestead.ts`, `src/world/poi/**` | The `Interactable` contract |
| **dungeons** (phase 2) | `src/world/dungeon/**` and `src/data/dungeons.ts` | — |

`src/main.ts` is shared glue. Keep your edits small, isolated and commented with `// v3:<workstream>`. The integrator (lead) resolves main.ts conflicts.

`src/world/world.ts` is also shared. Add your system as its own class, with a single `build` call and a single `update` call in `Overworld`. Don't restructure other systems' code.

### Phases

- **Phase 1**, run in parallel: terrain, look, ui, creatures, content (engine + data + UI-less logic), plus an asset scout (Sonnet).
- **Phase 2:**
  - The lead merges phase 1.
  - Then towns and dungeons run in parallel.
  - Content does the world integration: NPC actors, the onboarding scene and gate barriers.
  - ui and look do polish passes.
- **Phase 3:** the lead integrates, runs a performance pass on the Android emulator and iOS simulator, verifies with screenshots, updates the PDF manual and docs, and commits.

## 5. Contracts (`src/game/contracts.ts`)

- **`QuestApi`**, **`ShopApi`** and **`WorldProgressApi`** are view-models.
  - Content registers the implementations.
  - The UI renders them.
  - The stubs keep the UI's empty states working until then.
  - The UI should also include a mock mode (`?mock=quests,shops,world`) so it can be designed with realistic data before content lands.
- **`Marker`** covers everything the compass, minimap, map and 3D beacons point at.
- **`DialogSpec`**: `face` can be an NPC id, a species id, or an image URL.
  - The UI must render NPC portraits. Use the NPC rig bust render, or a stylised initial/avatar fallback.
- **Fog of war:** `explored()` is a 128² bitmap over the world square. The map and minimap mask unexplored land with a painterly cloud or parchment fog.
- **Event bus:** `src/game/events.ts` (`emit`/`on`) stays the way systems talk. Content may add events such as `talk`, `enter_region`, `enter_dungeon`, `open_chest`, `buy`, `gate_open`, `reach`, `item_get` and `dungeon_clear`. Add them to `GameEvents`.

## 6. Technical bar

### Performance budgets

These are measured with `tools/shot.mjs`, which prints fps, and in the Android emulator.

| Tier | Target fps | Draw calls | Triangles | Other |
|---|---|---|---|---|
| Desktop high | 60 at 1440×900 | < 400 | < 3 M | — |
| Phone medium | 60 target, never < 30 | < 250 | < 1.2 M | Texture memory < 300 MB |
| Low tier | Must look good, not just run | — | — | Fewer instances and shorter draw distance, never a broken look |

### Other rules

- **Load time:** first playable in under 8 s on desktop, with no worldgen at runtime. The world is pre-baked by `tools/worldgen`, shipped in `public/world/` and loaded compressed.
- **Assets:** only CC0 (or CC-BY with a credit) assets. Add every new asset to `CREDITS.md`. Existing candidates are in `~/expedition-wilds/.asset-scout/` (gitignored, shared); the scout adds more under `.asset-scout/v3/`.
- **Fonts:** self-hosted via `@fontsource/*` (offline/Capacitor). No CDN fonts.
- **No-scroll UI rule:** no menu, panel, list or screen may scroll, on desktop (1440×900, 1280×720) or phone landscape (844×390, 740×360).
  - Use pagination (pages with arrows or dots, swipe, keys), tabs/sections, master-detail layouts and responsive grids sized from the container.
  - The only allowed exception is free text that the player types.
- **Dark-first:** the game UI is dark-themed. Build and verify dark first.
- **Touch:** detect touch with the `html.touch` class (`src/core/device.ts`), never `pointer: coarse` alone. Hit targets must be at least 44 px on touch.

### Verification (per workstream, before reporting)

1. Run `npx tsc --noEmit` and `npm run build`; both must be green.
2. Take screenshots of your surfaces with `SHOT_PORT=<your port> node tools/shot.mjs <name> "<query>" <waitMs> <WxH> [--mobile]`, at desktop 1440×900 and phone 844×390 `--mobile`, and **look at them**.
3. The console must be clean: `errors: []`.
4. Iterate until it looks award-worthy, then report with the screenshot paths.

### Dev URL params

These are in `src/debug.ts`:

| Param | Effect |
|---|---|
| `auto=world&fresh` | Start in the world with a fresh save |
| `pos=x,z`, `yaw`, `pitch`, `dist` | Camera placement |
| `auto=battle&sp=a,b&lv=N` | Start a battle |
| `auto=boss&zone=<id>` | Start a boss fight |
| `ui=<tab>`, `ui=service:<svc>`, `ui=screen:<name>` | Open a UI surface |
| `q=low\|medium\|high\|ultra` | Quality tier |
| `rebake` | Rebake the terrain |

Add new params for your surfaces, such as `ui=shop:<id>`, `auto=dungeon&id=`, `auto=onboarding` and `mock=`.

### Worktree setup (each agent)

1. `cp -Rc ~/expedition-wilds/node_modules ./node_modules` (APFS clone; fast, no extra disk).
2. Run your own dev server on your port: `npx vite --host --port <port>` (in the background).
3. Ports:

| Port | Workstream |
|---|---|
| 5181 | terrain |
| 5182 | look |
| 5183 | ui |
| 5184 | creatures |
| 5185 | content |
| 5186 | towns |
| 5187 | dungeons |
| 5180 | lead (main tree) |

4. Commit your work to your worktree branch in logical commits with clear messages. Don't push. Don't touch `main`.
5. Git identity: use the repo-local identity that is already configured. Never change the global git config.
