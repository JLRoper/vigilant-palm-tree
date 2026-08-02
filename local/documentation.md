# Fallows of Elysiam — Module Documentation

A user-friendly overview of every module in the repo, grouped by area.
Each entry is a single line describing what the module *does*, not how it's implemented.

> Turn-based, hex-grid adventure game in the spirit of *Heroes of Might & Magic*. Move a hero across a procedurally generated map, build settlements on resource tiles, gather resources each turn, and defend them against enemy heroes.

---

## Root entry points

| File | What it does |
|---|---|
| `index.html` | The HTML host page that loads the game in the browser. |
| `src/main.ts` | Tiny boot script — instantiates the `GameEngine` and kicks off the main loop. |
| `server/index.ts` | Boots the Express API server on port 3001, wires up DB schema and routes. |
| `vite.config.ts` | Vite dev/build configuration for the front-end. |
| `tsconfig.json` | TypeScript compiler settings shared by client and server. |
| `package.json` | Project manifest — dependencies and `npm` scripts (`dev`, `test`, `build`, etc.). |
| `docker-compose.yml` | Spins up the local Postgres database for development. |
| `README.md` | High-level project readme with quick-start instructions. |
| `TECHNICAL_SPECIFICATIONS.MD` | Detailed tech-stack, build setup, and repo-shape reference. |

---

## Server — `server/`

The backend API and database layer.

| File | What it does |
|---|---|
| `server/index.ts` | Express bootstrap: CORS, JSON/raw body parsers, schema init, mounts the router. |
| `server/db.ts` | Postgres connection pool + runs all SQL migrations on startup. |
| `server/routes.ts` | All HTTP routes for games, tiles, units, and turn state. |
| `server/assetRoutes.ts` | Routes for listing, uploading, and deleting binary asset blobs (sprite packs). |
| `server/schema.sql` | Canonical SQL schema (referenced by the migration runner). |
| `server/migrations/001_turn_state.sql` | Migration: introduces the per-game turn/day/active-player state. |
| `server/migrations/002_unit_types.sql` | Migration: adds the catalog of unit types available in battles. |
| `server/migrations/003_resource_tables.sql` | Migration: adds tables for per-player resource stockpiles. |
| `server/migrations/004_game_assets.sql` | Migration: adds the table that stores uploaded asset blobs. |
| `server/migrations/005_unit_counters.sql` | Migration: adds counters (attack/defense/etc.) to unit types. |

---

## Shared — `shared/`

Code that runs on both the server and the client.

| File | What it does |
|---|---|
| `shared/combatConfig.ts` | One-file home for combat tuning knobs (damage multipliers, retreat penalties, etc.). |
| `shared/combat/index.ts` | Public surface of the shared combat engine — re-exports grid, damage, resolver, manual fight. |
| `shared/combat/types.ts` | Type definitions for the battle grid, hexes, and sides. |
| `shared/combat/grid.ts` | Builds battle grids and obstacles for combat encounters. |
| `shared/combat/damage.ts` | Computes damage between platoons, applies casualties, retreat losses. |
| `shared/combat/resolveBattle.ts` | Auto-resolves a whole battle round by round until one side wins. |
| `shared/combat/manualBattle.ts` | Interactive turn-by-turn battle engine used by the manual-fight sandbox. |

---

## Client — `src/`

### `src/core/` — Pure math & shared building blocks

| File | What it does |
|---|---|
| `src/core/hex.ts` | Axial hex coordinates, pixel conversion, distance, and corners math. |
| `src/core/rng.ts` | Shared seeded RNG so map generation and AI are deterministic. |
| `src/core/control.ts` | Calculates settlement "control" area (radius) for ownership and territory borders. |
| `src/core/cityGrid.ts` | Constants and helpers for the isometric city-view grid (tile width, cell math). |
| `src/core/citySpots.ts` | Defines the pre-placed spots and mine spots inside each settlement. |
| `src/core/buildingModifiers.ts` | Combines building effects into per-player bonuses (vision, etc.). |
| `src/core/buildingRegistry.ts` | Single source of truth for every building type — cost, upkeep, recruit list, etc. |
| `src/core/eventBus.ts` | Tiny typed pub/sub bus used to wire game events across modules. |
| `src/core/events.ts` | Type definitions for events that flow through the bus. |
| `src/core/eventRegistry.ts` | Registers all the bus listeners that the engine uses. |

### `src/data/` — Static catalogs

| File | What it does |
|---|---|
| `src/data/heroNames.ts` | List of randomly-pickable hero names. |
| `src/data/unitCatalog.ts` | Client-side cache for the unit-type catalog served by the API. |
| `src/data/unitImages.ts` | Maps unit-type ids to bundled PNG icons (falls back to placeholder art). |

### `src/economy/` — Per-turn economy math

| File | What it does |
|---|---|
| `src/economy/income.ts` | Computes a settlement's and player's total income per turn. |
| `src/economy/consumption.ts` | Computes food consumption, morale decay, and effective (post-morale) income. |
| `src/economy/settlementRates.ts` | Per-level base yield rates for settlements on resource tiles. |

### `src/entities/` — Things that live on the map

| File | What it does |
|---|---|
| `src/entities/hero.ts` | The `Hero` class — tile position, facing, army stack, movement tween, visuals. |
| `src/entities/settlement.ts` | The `Castle`/`Settlement` class — level, owner, warehouse, buildings, spots, mines. |

### `src/game/` — Game bootstrap & wiring

| File | What it does |
|---|---|
| `src/game/initState.ts` | Builds the initial `GameState` for a fresh game and hydrates one from a save. |
| `src/game/turnHooks.ts` | Side-effects that fire on turn end (save, AI turn, economy tick). |

### `src/io/` — Outside-the-game boundary

| File | What it does |
|---|---|
| `src/io/api.ts` | Typed HTTP client for the backend (`health`, `createGame`, `patchGame`, `logEvent`). |
| `src/io/assetApi.ts` | HTTP client for the asset-bucket endpoints (list, upload, delete). |
| `src/io/userGames.ts` | localStorage-backed "recently played games" list. |
| `src/io/debugCommands.ts` | Attaches the `window.__gameDebug` helpers used by the smoke test. |

### `src/ai/` — Computer-player brains

| File | What it does |
|---|---|
| `src/ai/aiBrain.ts` | Picks the AI hero's next move toward a goal (own castle, enemy, gold pile, etc.). |

### `src/combat/` — Battle test fixtures

| File | What it does |
|---|---|
| `src/combat/testArmies.ts` | Preset and randomized army generators used by the "Test Battle" sandbox. |

### `src/managers/` — High-level orchestrators

| File | What it does |
|---|---|
| `src/managers/GameEngine.ts` | The top-level orchestrator — wires everything together and runs the frame loop. |
| `src/managers/GameStateManager.ts` | Holds the current `GameState` and rebuilds Hero/Castle objects after each commit. |
| `src/managers/GameActions.ts` | Game-flow actions: end turn, manual save, battle modal flow. |
| `src/managers/GameSessionManager.ts` | New / load / save game lifecycle; bridges API, state, and view. |
| `src/managers/SessionManager.ts` | Tracks the active game (id, name, save status) and wraps manual-save calls. |
| `src/managers/ViewManager.ts` | Owns camera, renderer, minimap, and the adventure-view input wiring. |
| `src/managers/UIManager.ts` | Owns and refreshes every UI surface (toolbar, HUD, menus, city view). |
| `src/managers/CityDesignBoxManager.ts` | The little "Build / Generate / Back" panel inside the city view. |

### `src/map/` — The world itself

| File | What it does |
|---|---|
| `src/map/gameMap.ts` | The `GameMap` class — terrain, resources, castles, plus load-from-tiles helper. |
| `src/map/terrain.ts` | Terrain types, movement costs, and base colors used by the renderer. |
| `src/map/pathfinding.ts` | A* pathfinder that respects terrain cost and passability. |
| `src/map/resourceTiles.ts` | Resource types, yields, and placement on the map at generation time. |
| `src/map/castlePlacement.ts` | Deterministic placement of player and AI castles on a fresh map. |

### `src/render/` — Everything that draws to canvas

| File | What it does |
|---|---|
| `src/render/camera.ts` | Pan/zoom camera with screen↔world conversion. |
| `src/render/renderer.ts` | The main world renderer — terrain, heroes, castles, hover, fog of war. |
| `src/render/sprites.ts` | Sprite-load helpers + draw routines for heroes, horses, and castles. |
| `src/render/heroSprites.ts` | Procedural "horse-mounted hero" sprite drawer used when no real art is present. |
| `src/render/horseVariants.ts` | Registry of the different horse/commander visual variants. |
| `src/render/palettes.ts` | Color palettes shared between the procedural building drawer and resource icons. |
| `src/render/assetDescriptors.ts` | Registry of every sprite key the game knows about and how to resolve it. |
| `src/render/assets.ts` | The sprite provider — bundles, fallbacks, procedural drawers. |
| `src/render/assetSource.ts` | Where a sprite key actually comes from (bundle, procedural, remote). |
| `src/render/buildingStyles.ts` | The list of available building art styles (classic, blocky, crystalline, …). |
| `src/render/buildingStyleResolver.ts` | Picks a building style for a given settlement's culture/theme. |
| `src/render/cityRenderer.ts` | Renders the isometric city-view grid (cells, scale, layout). |
| `src/render/cityBuildingDraw.ts` | Routes a building draw call to the right style-specific drawer. |
| `src/render/cityBuildingGen.ts` | Generates a default building layout for a new settlement. |
| `src/render/minimap.ts` | Renders the corner minimap and handles minimap click-to-jump. |
| `src/render/fog.ts` | Fog-of-war visibility test for a hero at a given tile. |
| `src/render/docs/technical-spec.md` | Internal design notes for the rendering layer. |
| `src/render/cityBuildingDraw/types.ts` | Shared types used by every style-specific building drawer. |
| `src/render/cityBuildingDraw/primitives.ts` | Common helpers — footprint, height, color lightening/darkening, iso boxes. |
| `src/render/cityBuildingDraw/spots.ts` | Draws the pre-placed resource spots and mine markers in the city view. |
| `src/render/cityBuildingDraw/blocky.ts` | Draws buildings in the "Blocky Pixel" style. |
| `src/render/cityBuildingDraw/classic.ts` | Draws buildings in the "Classic Fantasy" style. |
| `src/render/cityBuildingDraw/crystalline.ts` | Draws buildings in the "Crystalline Elven" style. |
| `src/render/cityBuildingDraw/industrial.ts` | Draws buildings in the "Industrial" style. |
| `src/render/cityBuildingDraw/organic.ts` | Draws buildings in the "Organic Wooden" style. |
| `src/render/overlays/pathOverlay.ts` | Draws the yellow movement-path dots/lines on the world. |
| `src/render/overlays/resourceIcon.ts` | Draws the small resource-pile icon overlay on the map. |
| `src/render/overlays/territoryOutline.ts` | Draws the colored outline around a settlement's controlled hexes. |

### `src/state/` — Authoritative game state

| File | What it does |
|---|---|
| `src/state/gameState.ts` | The `GameState` type and all reducer-style state-mutation functions. |
| `src/state/turnController.ts` | Per-turn state machine — handles end-turn, movement, battle, and event flow. |
| `src/state/units.ts` | Platoon/unit data model and normalization helpers. |
| `src/state/settings.ts` | Player-facing settings (zoom, building style, horse variant, etc.). |
| `src/state/playerColors.ts` | The fixed palette of colors used to identify each player on the map. |

### `src/systems/` — Per-tick behavior

| File | What it does |
|---|---|
| `src/systems/movement.ts` | Advances hero movement tweens and fires arrival hooks when heroes stop. |
| `src/systems/enemyWander.ts` | Picks a random nearby wander target for each enemy hero each tick. |

### `src/views/` — User-facing screens & panels

| File | What it does |
|---|---|
| `src/views/adventureView.ts` | The main world view — canvas wiring, click/drag/zoom, path preview. |
| `src/views/hud.ts` | The bottom HUD — round/day display, gold, end-turn readiness. |
| `src/views/toolbar.ts` | The top toolbar — New / Load / Save / End Turn / roster buttons. |
| `src/views/menu.ts` | Shared menu styling and helpers used by every popup. |
| `src/views/settingsMenu.ts` | Settings panel (zoom, building style, hero visuals). |
| `src/views/developerSettingsMenu.ts` | Developer-only panel — asset manager, test battle, diagnostics. |
| `src/views/assetManager.ts` | Upload/list/delete custom asset blobs (developer feature). |
| `src/views/testBattleSetup.ts` | Sandbox setup screen that lets you jump straight into a manual battle. |
| `src/views/manualBattleArena.ts` | Interactive HoMM3-style manual battle arena (player vs AI, click to act). |
| `src/views/battleModal.ts` | The pre-battle dialog offering Auto-Resolve or Manual Fight. |
| `src/views/battleResultCard.ts` | End-of-battle summary card with casualties for each side. |
| `src/views/heroInfoMenu.ts` | Side panel for the selected hero — army, gold, transfer, reorder. |
| `src/views/heroRosterMenu.ts` | Full roster of the player's heroes with select/center actions. |
| `src/views/settlementInfoMenu.ts` | Side panel for the selected settlement — owner, garrison, recruit hero, upgrade. |
| `src/views/settlementPanel.ts` | Lightweight in-game settlement panel used in some flows. |
| `src/views/settlementRosterMenu.ts` | Full roster of the player's settlements. |
| `src/views/buildingMenu.ts` | Building-picker used while placing buildings in the city view. |
| `src/views/buildingPlacer.ts` | Click-to-place logic for buildings on city spots. |
| `src/views/buildingSelectionMenu.ts` | Sub-menu for choosing a building variant once a kind is picked. |
| `src/views/cityView.ts` | The isometric city interior screen — buildings, spots, upgrades. |
| `src/views/tradeModal.ts` | Resource-for-resource trade dialog between two settlements. |
| `src/views/confirmDialog.ts` | Reusable yes/no confirmation modal. |

### `src/resources/` — Art assets

PNG and SVG art used by the game — castle levels, hero banners, resource piles (cart, pile, crest, constellation variants), unit portraits, and isometric building sprites organized by style. Imported as URLs via Vite.

---

## Tests — `test/`

| File | What it does |
|---|---|
| `test/smoke.ts` | End-to-end smoke test — boots the game, plays movement/capture/battle/transfer/trade/economy, asserts on state and HUD. |
| `test/cityView.test.ts` | Focused tests for the city view — placement, upgrades, building close-flow. |
| `test/citySpots.test.ts` | Tests for pre-placed city spots and mine markers. |
| `test/cityGrid.test.ts` | Tests for the isometric city-grid math. |
| `test/pathfinding.test.ts` | Tests the A* pathfinder's cost and passability behavior. *(if present)* |
| `test/minimap.test.ts` | Tests the minimap camera and click-to-jump. |
| `test/dragDrop.test.ts` | Tests drag-and-drop interactions in the city view. |
| `test/proposedPath.test.ts` | Tests path preview rendering against a captured PNG. |

---

## Scripts — `scripts/`

| File | What it does |
|---|---|
| `scripts/cleanup.ps1` | Kills lingering dev processes from the current worktree before starting again. |
| `scripts/ports.ps1` | Allocates unique dev ports for this worktree so multiple worktrees can coexist. |
| `scripts/dev-status.ps1` | Reports whether the dev client, API, and DB are currently running for this worktree. |
| `scripts/seed-assets.ts` | Bulk-uploads the bundled sprites from `src/resources/` into the asset table. |
| `scripts/remove_background.py` | Python helper that strips the white background from AI-generated PNG assets. |
| `scripts/batch_remove_background.ps1` | Runs `remove_background.py` across every PNG in `src/resources/`. |
| `scripts/capture-path.ts` | Playwright helper that screenshots the proposed movement path for visual tests. |

---

## Tools — `tools/`

Asset generation and validation scripts that are not part of the game's runtime.

| File | What it does |
|---|---|
| `tools/run-smoke.ps1` | Convenience wrapper to run the smoke test on Windows. |
| `tools/sprites/validate-assets.mjs` | Sanity-checks the bundled sprites (sizes, presence, dimensions). |
| `tools/sprites/generate-preview.mjs` | Renders a preview HTML page of every sprite for visual review. |
| `tools/sprites/screenshot-preview.mjs` | Screenshots the preview page for diffing. |
| `tools/sprites/pixel-gen.mjs` | Generates pixel-art building sprites from prompt-driven generators. |
| `tools/sprites/pixel-gen-pure.mjs` | Same as `pixel-gen.mjs` but with no external image dependencies. |
| `tools/sprites/manifest.mjs` | Builds/updates the sprite manifest referenced by the asset descriptors. |
| `tools/sprites/outline-apply.mjs` | Post-processes sprites by adding a black outline. |
| `tools/sprites/pixel-art.html` | Browser UI for tweaking pixel-art generators. |
| `tools/sprites/flux-*.mjs` | A long list of one-off "Flux" generators — each explores a specific building or hero variant (castles, towers, markets, farms, hero sprites, horse variants, etc.). |

---

## Docs & plans — `docs/` and `feature-plans/`

Design documents, not code. They explain the *why* behind the modules above.

| File | What it does |
|---|---|
| `docs/README.md` | Index of every game-design doc. |
| `docs/architecture.md` | The canonical explanation of the `src/` module layout and how it was assembled. |
| `docs/resources.md` | Resource model — gold, wood, stone, iron, arcane, food. |
| `docs/settlements.md` | Settlement levels, capture, upgrades. |
| `docs/heroes.md` | Heroes — recruitment, army stack, movement, leveling. |
| `docs/economy.md` | Per-turn income, consumption, morale, decay. |
| `docs/army.md` | Army composition, recruitment, stacking. |
| `docs/map.md` | The adventure map — terrain, fog, exploration. |
| `docs/map-gen.md` | Procedural map generation rules. |
| `docs/event-system.md` | The event bus and the kinds of events that flow through it. |
| `docs/art-style.md` | The chosen visual style for the game. |
| `docs/isometric-building-prompts.md` | Prompts used to generate the isometric building art. |
| `docs/city-view-impl-plan.md` | Implementation plan for the city interior view. |
| `docs/ui-top-panel-plan.md` | Implementation plan for the top toolbar. |
| `docs/TODO-front-end-efficiency.md` | Performance TODOs for the renderer. |
| `docs/CombatResolutionEngine-TechnicalDesign.md` | Deep dive on the auto-resolve combat engine. |
| `feature-plans/CombatResolutionEngine.md` | The original feature plan that produced the combat engine. |

---

## Session notes — `sessionTracking/`

Working log of what was done in each development session, used for context when picking up the project later.
