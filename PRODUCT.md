# Product

<!-- impeccable:product-schema 1 -->

> Written by the v3 **ui** workstream from `docs/v3/PLAN.md` and the player's quoted words relayed by the lead.
> No live interview was possible in this run; facts marked *(inferred)* come from the plan and the code, not from a confirmed answer.

## Platform

web

(Web/PWA first; the same bundle ships inside Capacitor shells for Android and iOS. The design language is the game's own, not native OS chrome.)

## Users

- Players of creature collectors (Pokémon, Miscrits, Palworld, Cassette Beasts) who also enjoy Expedition 33-style timed, turn-based battles. *(inferred)*
- Primary scene: a phone held **sideways** (844×390, 740×360 class), both thumbs on the glass, short sessions, the bright 3D world behind every overlay. *(inferred from PLAN §1, §6)*
- Secondary scene: desktop at 1440×900 or 1280×720 with WASD, mouse-drag camera and single-key hotkeys.
- The one player we have direct words from said: “need full revamp of the color palette and menus and design”, “why menus are scrollable”, “target no scroll and good looking menus”, “better font and menus better placements of everything”, “I have no clue where to go”.

## Product Purpose

Wild Mystics is an open-world creature collector: explore a hand-designed island of ten lands ringed around Mount Aether, catch chunky low-poly Mystics, battle them in timed turn-based duels (parry, dodge, jump, perfect hits, break, burst), follow a main story and side quests, and unlock sealed lands by answering each land's Guardian.

Success for v3 is “award-winning quality” in look, feel and polish; a player who always knows where to go next; and menus that fit the screen on every target size without scrolling.

## Positioning

Pokémon/Miscrits catching and collecting in a designed open world, with Expedition 33-style timed battles, running in a browser and as a native app from one self-hosted build. No real-money purchases in this build: Aether and summon tickets are earned by playing.

## Operating Context

- **Loop:** explore → encounter (roaming, tall grass, nests, fishing) → battle → catch → manage team/bag/dex → town services (healer, shops, hatchery, shrine, tutor, quest board) → quests and gates → next land.
- **Guidance surfaces:** quest tracker, compass bar, minimap, world map with fog of war, 3D objective beacon, breadcrumbs.
- **Input:** touch (floating left-thumb joystick, right-thumb camera, on-screen jump/sprint/strike/ride) detected via the `html.touch` class; keyboard + mouse on desktop (J/T/C/B/M/G/Q journal hotkeys, Esc menu, E interact, F strike, R ride).
- **Environment:** offline-capable PWA and Capacitor shells, so fonts and assets are self-hosted; phones have notches and safe areas.

## Capabilities and Constraints

- **Journal:** team + storage box, Mystidex (122 species), bag, relics, quests, feats, world map, summon (gacha), profile, settings.
- **Screens:** auth, title/main menu, loading, starter choice, NPC dialog, shop, town services, homestead build mode, battle HUD, rewards, level-up, evolution/hatch cinematics, daily login, field guide, pause.
- **Contracts** (`src/game/contracts.ts`): `QuestApi`, `ShopApi` and `WorldProgressApi` are view-models the content workstream implements and the UI renders; `Marker` feeds the compass, minimap, map and 3D beacon; `DialogSpec.face` is an NPC id, species id or image URL. A `?mock=quests,shops,world` mode supplies realistic fake data.
- **Hard rules:** no menu, list, panel or screen may scroll at 1440×900, 1280×720, 844×390 or 740×360 (only free text the player types is exempt); dark-first; touch hit targets ≥ 44 px; respect `prefers-reduced-motion`; self-hosted fonts (`@fontsource/*`), no CDN; CC0/CC-BY assets only, credited in `CREDITS.md`; UI must not break the frame budgets (60 fps desktop, ≥ 30 fps phone).
- **Terminology:** Mystics, Wayfarer, Guardians, Warden Gates, Waystones, sigils, Aether (premium currency), gold, Elementum shards, orbs, relics, Mystidex, Homestead, the Hollow Veil.
- **Ownership:** the ui workstream owns `src/ui/**`, `src/ui/styles.css`, `index.html`, `src/battle/battleUI.ts` and the font imports in `src/main.ts`; everything else is touched minimally and marked `// v3:ui`.

## Brand Commitments

- Name: **Wild Mystics**. Tone: warm, witty, a little melancholy (Pokémon warmth meets Expedition 33 wistfulness); short lines that read on a phone.
- Creatures are cute, chunky and low-poly, with a touch of mystic wonder. *(from the lead's brief)*
- The v2 look (dark purple glass, gold filigree, Cinzel/Cormorant/Inter) is explicitly rejected and serves only as an anti-reference.
- Icons: the game-icons.net set in `src/ui/iconset.ts` (CC BY 3.0) is kept.
- Seven elements with their own colours (`src/data/elements.ts`): fire, water, nature, earth, storm, wind, void. The colours may be retuned but must pop.

## Evidence on Hand

- 122 species with baked portraits (`public/assets/portraits/*.webp`), CC0 3D art (Quaternius, KayKit, Kenney, Poly Haven), game-icons.net icons.
- World data: ten lands, Warden Gates, dungeons, points of interest (`src/data/zones.ts`, `src/data/layout.ts`).
- Baseline screenshots of the rejected v2 UI: `~/expedition-wilds/.shots/v3base/*.png`.
- No testimonials, reviews, store listings or player numbers exist; none may be invented.

## Product Principles

1. **Always know where to go.** Every screen that can point somewhere (HUD, map, quest log, dialog) points at the next objective.
2. **Everything fits.** Paginate, tab and split instead of scrolling; a menu is a screen, not a document.
3. **The world is the star.** The HUD frames the island and gets out of the way; menus feel like part of the expedition.
4. **Thumb-first parity.** Every action is reachable by thumb with a ≥ 44 px target, and by a single key on desktop.
5. **Read it at a glance.** Short labels, strong hierarchy, element colour as information.

## Accessibility & Inclusion

- `prefers-reduced-motion` honoured; existing gameplay assists (timing assist, auto-defend, haptics toggle, left-handed layout, touch button size/opacity) stay reachable in Settings.
- Text must stay legible over a bright, busy 3D world (scrims, weight, contrast), including at 740×360.
