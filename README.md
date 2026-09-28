# Wild Mystics

An open-world creature-collecting expedition: Pokémon/Miscrits-style catching, teams, breeding and evolution, with **Clair Obscur: Expedition 33-style** timed turn-based battles (perfect hits, parries, dodges, jumps, Break and Burst). Built with three.js; runs in the browser (installable, offline) and as native **Android** and **iOS** apps via Capacitor.

📖 **[Field Manual (PDF)](docs/Wild-Mystics-Field-Manual.pdf)** — every Mystic, land, mechanic and control, generated from the game data.

```bash
npm install
npm run dev          # http://localhost:5180 (also on your LAN IP for phones)
npm run build        # type-check + production bundle in dist/ (PWA: manifest + service worker)
```

## Features

- **Six lands** on a 760 m world: Verdant Vale, Mirror Lakes, Ember Scar, Mistveil Marsh, Sunscorch Dunes and Stormreach Peaks. Each has its own terrain, flora, weather, music, town or outpost, three Tamers, three Waystones and a Guardian.
- **122 collectible Mystics**, 6 Guardians and 6 legendary Guardian Spirits.
  - Rarities run from common to legendary, with natures, genes (D–S), 28 abilities and awakening stars.
  - 16 are rideable mounts and 13 are aquatic. There are regional variants.
  - Evolution can be by level, by stone or by time of day, and many lines branch.
- **Finding Mystics**: roaming, tall grass, glimmering nests, night-only spawns and a fishing minigame. Shinies are 1/300 (Shimmer Incense ×3).
- **Exploration**: sprint, jump and double jump, mounts, a day/night cycle, fast travel between attuned waypoints, and gathering nodes.
- **Battles**:
  - a speed timeline and AP
  - QTE timed hits, plus parry / dodge / jump defence against red and gold strikes, and counters
  - Break gauge and a team Burst gauge with element ultimates
  - six status effects and an element wheel
  - capture with six orb types, auto battle and 1×–2× speed
- **Towns**:
  - Sanctuary: heal, and rest until night or day
  - Outfitter: regional evolution stones
  - Hatchery: breeding and eggs
  - Elementum Shrine: infusion and ability attunement
  - Move Master
  - Keeper
  - Quest Board
  - Wishing Spire
- **Homestead base building**: 16 structures (production, habitats, forge crafting, training hall, market, decor) with real-time production and upgrades.
- **Summoning (gacha)**: featured, standard and relic banners, a free daily wish, soft and hard pity, duplicates into Essence, and a cinematic reveal. All currency is earned in play.
- **Progression**: story, side and daily quests, 14 feats, Wayfarer rank, a 7-day login calendar and 33 relics.
- **Accounts**: guest, device or cloud accounts, and cloud saves (see [server/](server/README.md)). Saves can be exported and imported.
- **Settings**: graphics tiers, adaptive resolution, an FPS cap, audio, gameplay, accessibility (timing assist, auto-defend) and touch layout.

## Controls

| | Desktop | Touch |
|---|---|---|
| Move · sprint · jump (×2) | WASD · Shift · Space | left thumb · Sprint · Jump |
| Look · zoom | drag · wheel | right thumb |
| Interact · strike first · ride | E · F · R | prompt · Strike · Ride |
| Journal · team · dex · bag · map · summon · quests | J · T · C · B · M · G · Q | bottom bar |
| Build mode (at Homestead) · pause | H · Esc | Homestead panel · Menu |
| Battle | 1–6 actions, B burst, ←→ Enter target, **Space** timed hits, **E** parry, **Q** dodge, **W** jump, A auto, X speed | tap / PARRY / DODGE / JUMP |

## Native apps (Capacitor)

```bash
npm run build && npx cap sync            # copy dist/ into android/ and ios/ (runs pod install for iOS)
# Android debug APK (needs JDK 21 + Android SDK):
cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@21 ./gradlew assembleDebug   # → app/build/outputs/apk/debug/app-debug.apk
# iOS (CocoaPods): open in Xcode and sign with your team, or build for the simulator:
npx cap open ios
cd ios/App && xcodebuild -workspace App.xcworkspace -scheme App -sdk iphonesimulator -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
```

App ID `com.tangowork09.wildmystics`, landscape-locked, status bar hidden. Both shells have been verified: the Android emulator and the iOS Simulator each run through to the 3D world. Haptics are wired in, and the Android back button acts as Esc. Icons and splash screens come from `resources/` (`node tools/make-icons.mjs`, then `npx @capacitor/assets generate`).

## Accounts backend

The client works fully offline, with guest and device accounts. For cloud accounts and saves, deploy the Cloudflare Worker in [`server/`](server/README.md) and set `VITE_API_URL` at build time.

## Tools

- `node tools/import-assets.mjs`: rebuild `public/assets` (models, audio, textures) from the CC0 packs in `.asset-scout/`, which is git-ignored.
- `node tools/bake-portraits.mjs`: render every portrait (normal + shiny) to WebP. Needs `npm run dev`.
- `node tools/add-asset.mjs creature <id> <file.glb> --height 1.1`: drop in your own art (see [ASSET_PROMPTS.md](ASSET_PROMPTS.md)).
- `npx tsx tools/make-manual.ts`: regenerate the PDF manual. Needs `npm run dev`.
- `node tools/make-icons.mjs`: regenerate the app, PWA and store icons.
- `node tools/shot.mjs <name> "<query>" [wait] [WxH] [--mobile]`: headless screenshot plus console errors into `.shots/`.

## Dev shortcuts (URL params)

- `?auto=world&fresh`: skip sign-in and the title with a test team.
  - Add `&pos=x,z&yaw=deg` to place the camera.
  - Add `&ui=team|dex|bag|relics|quests|achievements|map|summon|profile|settings` to open that Journal tab.
  - Add `&ui=service:shop|healer|hatchery|shrine|tutor|quests` to open a town service.
  - Add `&ui=build|homestead` for the Homestead, or `&ui=screen:starter|fishing|daily|guide|dialog` for a screen.
- `?auto=battle&sp=gloop,impling&lv=5`: go straight into a battle. `?auto=boss&zone=scar` fights a Guardian. Add `&autoplay` to let a bot play.
- `?view=gallery`: every model. `?view=portraits` renders the portraits.
- `?q=low|medium|high|ultra`: force a quality tier. `?guest`: skip the sign-in screen.

## Code map

```
src/
  main.ts            boot (auth → save slot → assets → world), loop, event routing, battles, native shell
  core/              renderer + quality tiers + adaptive resolution, input, audio, settings, haptics
  data/              species, skills, zones, items, relics, traits, structures, tamers, quests, gacha  ← balance lives here
  game/              creature math, save state (+migration), progress/quests/achievements, gacha, homestead, event bus
  world/             terrain bake (worker + IndexedDB cache), grass, water, atmosphere, props, towns, landmarks, homestead, wilds
  battle/            battle controller (timeline/QTE/parry/jump/break/burst/capture), UI, VFX
  net/               accounts + cloud save client (talks to server/)
  ui/                HUD, minimap, journal + tabs, services, screens, base-build UI, kit, icons, styles.css
server/              Cloudflare Worker + D1 accounts & cloud saves (70 tests)
tools/               asset import, portraits, icons, manual, screenshots
docs/                Field Manual PDF
android/ ios/        Capacitor native projects
```

Assets are CC0 stand-ins (Quaternius, KayKit, Kenney, Poly Haven, OpenGameArt). Icons are from game-icons.net (CC BY 3.0). See [CREDITS.md](CREDITS.md).
