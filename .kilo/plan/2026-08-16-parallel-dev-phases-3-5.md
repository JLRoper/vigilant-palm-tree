# Plan: Parallel Development Execution (Phases 3 – 5)

*Authored: 2026-08-16*
*Status: Phases 0–4 Complete → Phase 5 in progress (Track 5.A partial, Track 5.B scene graph builders + entityMirror landed; paint2d/, manualBattleArena decomposition, renderer.ts/cityRenderer.ts rewrite still ⬜). See `plan/2026-08-17-consolidated-phase-1-5-track-map.md` for the live status.*
*Supplements: `plan/2026-08-15-parallel-dev-split.md`, `plan/2026-08-15_OVERVIEW.md`, `plan/2026-08-15-architecture-map_OVERVIEW.md`*

---

## 1. Executive Summary & Status Check

The monorepo reorganization has successfully completed **Phase 0 through Phase 4** (Phases 3 and 4 both landed — Phase 3 via Track 3.A command bus + Track 3.B repos merged across PRs #86/#87/#91/#92 + #84/#90; Phase 4 via Track 4.A dual-write/hydrate (PR #95) + Track 4.B granular tables + backfill (PR #93)). Phase 5 is in progress on both tracks (see consolidated plan for live status).

- ✅ **Phase 0**: Dependency cruiser rules established (`dependency-cruiser.cjs`), zero circular violations.
- ✅ **Phase 1**: Root npm workspaces (`packages/contracts`, `packages/engine`), baseline contracts extracted, views moved to `src/screens/`.
- ✅ **Phase 2 (COMPLETED)**: Complete domain extraction from `src/state/gameState.ts` into pure, deterministic modules in `@heroes/engine`:
  - `economy/*` (`income.ts`, `consumption.ts`, `settlementRates.ts`, `trade.ts`, `transfer.ts`)
  - `charter/*` (`start.ts`, `travel.ts`, `advance.ts`, `cleanup.ts`)
  - `settlement/*` (`advance.ts`, `autoTrade.ts`, `capture.ts`, `citySpots.ts`, `populationGrowth.ts`, `produceResources.ts`, `upgradeBuilding.ts`, `upgradeSettlement.ts`, `upgradeTownHall.ts`)
  - `hero/*` (`move.ts`, `recruit.ts`, `stacks.ts`, `upkeep.ts`)
  - `combat/*` (`grid.ts`, `damage.ts`, `resolveBattle.ts`, `manualBattle.ts`, `types.ts`)
  - `map/*` (`gameMap.ts`, `terrain.ts`, `resourceTiles.ts`)
  - Registries (`buildingRegistry.ts`, `buildingModifiers.ts`, `styleResolver.ts`, `control.ts`)
  - Unit test suites in `test/charter/`, `test/combat/`, `test/state/`, `test/map/`.

This document also covers the now-completed **Phase 3 (Server Command Loop & Repositories)** and **Phase 4 (Database De-blobbing & Dual-Write)**, and the in-progress **Phase 5 (Event-Cursor Sync & Scene Renderer Seam)**, split across two parallel development tracks (**Track A: Dev A** and **Track B: Dev B**) with zero toe-stepping. Phases 3 and 4 are both ✅ complete per the consolidated phase-1-5 track map; Phase 5 is 🟡 in progress.

---

## 2. Current File & Architecture Structure (as of 2026-08-16)

```
heroes-js/
├── packages/
│   ├── contracts/                               # Shared types, IDs, and interfaces (@heroes/contracts)
│   │   └── src/
│   │       ├── index.ts                         # Barrel export
│   │       ├── ids.ts                           # Branded ID types (HeroId, SettlementId, PlayerId, etc.)
│   │       ├── geometry.ts                      # Axial coordinates (q, r), HEX_DIRECTIONS
│   │       ├── resources.ts                     # ResourceType, Warehouse interface
│   │       ├── buildings.ts                     # BuildingKind, BuildingDef, BuildingRef
│   │       ├── castle.ts                        # CastleLevel, CastleVariant, GenerationStyle
│   │       ├── units.ts                         # Platoon, PlatoonEntry
│   │       ├── settlement.ts                    # SettlementState, CharterState, UpgradeState
│   │       └── gameState.ts                     # GameState, Player, HeroState, action contracts
│   │
│   └── engine/                                  # Deterministic game rules & simulation (@heroes/engine)
│       └── src/
│           ├── index.ts                         # Engine barrel export
│           ├── control.ts                       # Settlement controlRange calculation
│           ├── combatConfig.ts                  # Battle constants and multipliers
│           ├── horseVariants.ts                 # Horse visual variant registries
│           ├── buildingRegistry.ts              # Building definitions, costs, and footprints
│           ├── buildingModifiers.ts             # Settlement/player modifier aggregators
│           ├── rng.ts                           # mulberry32 deterministic PRNG
│           ├── styleResolver.ts                 # Style selector (classic, pixel, blocky)
│           ├── units.ts                         # Platoon normalization helpers
│           ├── charter/                         # Expansion charter lifecycle
│           │   ├── start.ts                     # startCharter validation & initiation
│           │   ├── travel.ts                    # stepTravelCharter movement step
│           │   ├── advance.ts                   # advanceCharters founding completion
│           │   └── cleanup.ts                   # cleanupDefeatedHeroCharters
│           ├── combat/                          # Hex combat simulation
│           │   ├── index.ts
│           │   ├── types.ts                     # Combatant, BattleGrid, BattleResult
│           │   ├── grid.ts                      # makeBattleGrid, deploymentPosition
│           │   ├── damage.ts                    # computeDamage, applyCasualties, estimateWinChance
│           │   ├── manualBattle.ts              # Turn-by-turn manual combat engine
│           │   └── resolveBattle.ts             # Automated combat loop
│           ├── economy/                         # Economy formulas
│           │   ├── income.ts                    # computeGoldIncome, computeResourceIncome
│           │   ├── consumption.ts               # computeFoodConsumption
│           │   ├── settlementRates.ts           # computeSettlementRates (radius yields)
│           │   ├── trade.ts                     # tradeResources (market pricing)
│           │   └── transfer.ts                  # transferWarehouse (hero/settlement)
│           ├── hero/                            # Hero state logic
│           │   ├── move.ts                      # startMove, cancelMove, detectAdjacentEnemy
│           │   ├── recruit.ts                   # recruitHero
│           │   ├── stacks.ts                    # reorderStack army organization
│           │   └── upkeep.ts                    # applyHeroUpkeep
│           ├── map/                             # Map generation & grid store
│           │   ├── gameMap.ts                   # GameMap store & generators
│           │   ├── terrain.ts                   # Terrain costs & passability
│           │   └── resourceTiles.ts             # ResourceTile placement
│           ├── settlement/                      # Settlement lifecycle
│           │   ├── advance.ts                   # advanceSettlements round ticks
│           │   ├── autoTrade.ts                 # Automated market trades
│           │   ├── capture.ts                   # Siege capture ownership transfer
│           │   ├── citySpots.ts                 # generateCitySpots (isometric building anchors)
│           │   ├── populationGrowth.ts          # Population growth formulas
│           │   ├── produceResources.ts          # Local settlement resource output
│           │   ├── upgradeBuilding.ts           # Building level progression
│           │   ├── upgradeSettlement.ts         # Castle tier progression (Level 1 -> 3)
│           │   └── upgradeTownHall.ts           # Town Hall progression
│           └── validation/
│               └── gameIntegrity.ts             # validateGameRow invariant validator
│
├── src/                                         # Vite Single-Page Web App (Client)
│   ├── main.ts                                  # App bootstrap & view initialization
│   ├── vite-env.d.ts                            # Vite client types
│   ├── ai/
│   │   └── aiBrain.ts                           # pickAiMove heuristic decision engine
│   ├── combat/
│   │   └── testArmies.ts                        # Static army compositions for testing
│   ├── core/
│   │   ├── cityGrid.ts                          # Isometric 2D projection math (cellToScreen)
│   │   ├── eventBus.ts                          # EventBus pub/sub singleton
│   │   ├── eventRegistry.ts                     # Event listener binder
│   │   ├── events.ts                            # GameEvent union types
│   │   ├── hex.ts                               # Hex grid geometry & axial conversions
│   │   └── rng.ts                               # Client-side PRNG shims
│   ├── data/
│   │   ├── heroNames.ts                         # Hero name generation pool
│   │   ├── unitCatalog.ts                       # Unit stats cache & API client
│   │   └── unitImages.ts                        # Unit sprite paths
│   ├── debug/
│   │   ├── devConsole.ts                        # Floating HUD dev console overlay
│   │   └── eventLog.ts                          # EventLog recorder
│   ├── entities/
│   │   ├── hero.ts                              # Hero entity wrapper class
│   │   └── settlement.ts                        # Castle entity wrapper class
│   ├── factions/
│   │   ├── types.ts                             # FactionUnit interface
│   │   └── humans/                              # Human unit templates (archer, cavalry, etc.)
│   ├── game/
│   │   ├── initState.ts                         # buildInitialGameState
│   │   └── turnHooks.ts                         # buildTurnHooks
│   ├── io/
│   │   ├── api.ts                               # REST API client & TimeoutError
│   │   ├── assetApi.ts                          # Asset endpoints
│   │   ├── auth.ts                              # Auth header management
│   │   ├── debugCommands.ts                     # window.__heroes debug harness
│   │   ├── multiplayerSync.ts                   # MultiplayerSync SSE client
│   │   └── userGames.ts                         # LocalStorage saved games store
│   ├── managers/                                # High-level orchestrators
│   │   ├── GameActions.ts                       # Dispatches player intent operations
│   │   ├── GameEngine.ts                        # Central orchestrator & rAF game loop
│   │   ├── GameSessionManager.ts                # Coordinates new/load/save flows
│   │   ├── GameStateManager.ts                  # Reactive state store
│   │   ├── SessionManager.ts                    # Auto-save debouncing
│   │   ├── UIManager.ts                         # Coordinates HUD, toolbar, menus
│   │   └── ViewManager.ts                       # Coordinates screen switches
│   ├── map/
│   │   ├── castlePlacement.ts                   # Procedural castle spacing
│   │   ├── gameMap.ts                           # Re-exports from @heroes/engine
│   │   ├── pathfinding.ts                       # A* pathfinding on hexes
│   │   ├── resourceTiles.ts                     # Re-exports from @heroes/engine
│   │   └── terrain.ts                           # Re-exports from @heroes/engine
│   ├── players/
│   │   └── localPlayer.ts                       # Local player session cache
│   ├── render/                                  # 2D Canvas Graphics & Asset Pipeline
│   │   ├── assetDescriptors.ts                  # Sprite bounds, anchors, frame maps
│   │   ├── assets.ts                            # SpriteProvider class
│   │   ├── assetSource.ts                       # SpriteSource hierarchy
│   │   ├── buildingStyles.ts                    # BuildingStyle definitions
│   │   ├── buildingStyleResolver.ts             # Sprite mappings for buildings
│   │   ├── camera.ts                            # Camera viewport class
│   │   ├── cityBuildingDraw.ts                  # drawBuilding & OffscreenBuildingCache
│   │   ├── cityBuildingDraw/                    # Style drawers (classic, blocky, organic, etc.)
│   │   ├── cityBuildingGen.ts                   # Procedural city building generator
│   │   ├── cityRenderer.ts                      # drawCityView isometric composition
│   │   ├── fog.ts                               # computeVision & fog-of-war masks
│   │   ├── heroSprites.ts                       # Directional hero rasterizers
│   │   ├── horseVariants.ts                     # Horse variant helpers
│   │   ├── minimap.ts                           # drawMinimap renderer
│   │   ├── minimapCamera.ts                     # MinimapCamera class
│   │   ├── overlays/                            # Path, resource icon, and territory overlays
│   │   ├── palettes.ts                          # Hex color palettes
│   │   ├── renderTypes.ts                       # RenderOptions & MinimapGeometry
│   │   ├── renderer.ts                          # Adventure map 2D canvas renderer
│   │   └── sprites.ts                           # Sprite drawing functions
│   ├── screens/                                 # UI Screens & Dialogs
│   │   ├── adventure/adventureView.ts           # AdventureView class
│   │   ├── combat/                              # BattleModal, ManualBattleArena, BattleResultCard
│   │   ├── heroes/                              # HeroInfoMenu, HeroRosterMenu
│   │   ├── home/                                # HomeView, NewGameScreen, SettingsMenu, AssetManager
│   │   ├── multiplayer/multiplayerLobby.ts      # MultiplayerLobby class
│   │   ├── settlements/                         # SettlementInfoMenu, SettlementPanel, TradeModal
│   │   │   └── cityView/                        # CityView, BuildingMenu, BuildingPlacer, BuildingSelectionMenu
│   │   └── shared/                              # Toolbar, HUD, PopupMenu, ConfirmDialog, ViewLauncher
│   └── state/
│       ├── gameState.ts                         # Client selectors & state helpers
│       ├── playerColors.ts                      # Player palette mappings
│       ├── settings.ts                          # Reactive settings store
│       ├── turnController.ts                    # TurnController state machine
│       └── units.ts                             # Client demo unit rosters
│
├── server/                                      # Backend API & Multiplayer Server
│   ├── index.ts                                 # Express app bootstrap
│   ├── db.ts                                    # PostgreSQL connection pool (pg.Pool)
│   ├── auth.ts                                  # JWT auth router
│   ├── routes.ts                                # REST endpoints & SSE /events stream
│   ├── assetRoutes.ts                           # Asset upload/fetch endpoints
│   ├── schema.sql                               # Baseline database schema
│   └── migrations/                              # SQL migrations (001_turn_state to 008_lobby)
│
├── scripts/                                     # Build & Dev Utilities
│   ├── allocate-ports.ts                        # Free TCP port allocator for worktrees
│   ├── cleanup.ps1                              # Scoped process cleanup helper
│   ├── dev-status.ps1                           # Dev environment status reporter
│   ├── seed-assets.ts                           # Database asset seeder
│   └── split-skybox-layers.ts                   # Parallax skybox layer cutter
│
└── test/                                        # Test Suites
    ├── smoke.ts                                 # Core headless game smoke test
    ├── multiplayer.smoke.ts                     # Multi-client turn cycle integration test
    ├── cityView.test.ts                         # City view rendering integration test
    ├── charter/                                 # Charter unit tests (start, travel, advance, cleanup)
    ├── combat/                                  # Combat unit tests (manualBattle, resolveBattle)
    ├── map/                                     # Castle placement tests
    └── state/                                   # Economy, income, and game state tests
```

---

## 3. Parallel Development Strategy: Dev A & Dev B

With Phase 2 complete, the primary dependency bottleneck is lifted. The deterministic engine is ready to be consumed by the server command loop and client command dispatcher.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PARALLEL TRACK MAPPING                            │
└─────────────────────────────────────────────────────────────────────────────┘

       PHASE 3: Server Command Loop & Repositories
       ──────────────────────────────────────────
       Track 3.A (Dev A): Server Command Bus & Handlers
       Track 3.B (Dev B): Persistence Repositories & Test Harness

                           ▼ (Sync Point 1)

       PHASE 4: Database De-blobbing & Dual-Write
       ──────────────────────────────────────────
       Track 4.A (Dev A): Command Handler Dual-Write & Granular Persistence
       Track 4.B (Dev B): Table Migrations & Historical Game Backfill

                           ▼ (Sync Point 2)

       PHASE 5: Client Command Flow & Scene Renderer Seam
       ──────────────────────────────────────────────────
       Track 5.A (Dev A): Client Command Dispatcher & Event-Cursor Sync
       Track 5.B (Dev B): Scene Graph Builder & Entity Mirror Animation
```

---

## 4. Detailed Phase Breakdown & Ownership

### Phase 3: Server Command Loop & Repositories

#### **Track 3.A (Dev A) — Server Command Bus & Handlers**
- **Goal:** Replace ad-hoc REST mutation routes with a unified command execution pipeline powered by `@heroes/engine`.
- **Owned Tree:**
  - `packages/contracts/src/commands/` (command discriminated-union types: `MoveHeroCommand`, `EndTurnCommand`, `RecruitHeroCommand`, `StartCharterCommand`, `UpgradeBuildingCommand`, `TradeResourcesCommand`, etc.)
  - `server/app/commandHandler.ts` (the central transaction loop: load state via repos → `engine.validate` → `engine.apply` → persist delta + append event).
  - `server/http/routes/commands.ts` (`POST /api/games/:id/commands`).
  - `server/app/turnService.ts` (round advances, weekly upkeep triggers).
- **Exit Criteria:**
  - `POST /api/games/:id/commands` accepts commands, validates with `@heroes/engine`, commits state, and returns `{ events: GameEvent[], version: number }`.
  - Full test suite in `test/server/commandHandler.test.ts`.

#### **Track 3.B (Dev B) — Persistence Repositories & Test Fixtures**
- **Goal:** Create typed CRUD repositories for database access, eliminating raw inline SQL strings in route handlers.
- **Owned Tree:**
  - `server/persistence/repositories/`
    - `gameRepo.ts` (game shell, active seat, round/day, version)
    - `heroRepo.ts` (hero state, position, movement, platoons)
    - `settlementRepo.ts` (settlements, buildings, warehouse resources)
    - `charterRepo.ts` (charter expedition states)
    - `eventRepo.ts` (append-only game events log with monotonic `seq`)
    - `tileRepo.ts` (map tile queries)
  - `server/persistence/db.ts` (transaction helper: `withTransaction(async (client) => ...)`).
  - `test/helpers/mockRepos.ts` (in-memory repository doubles for unit tests).
- **Exit Criteria:**
  - Repositories provide clean interfaces (`loadGame`, `saveGameDeltas`, `appendEvents`).
  - Unit tests verify all repo CRUD operations within isolated transactions.

---

### Phase 4: Database De-blobbing & Dual-Write

#### **Track 4.A (Dev A) — Dual-Write Integration & State Hydration**
- **Goal:** Transition the server from saving/loading a single monolithic JSONB blob to saving and hydrating from discrete entity tables.
- **Owned Tree:**
  - `server/app/commandHandler.ts` (update persistence step to dual-write to `games.state` and granular tables).
  - `server/persistence/hydrate.ts` (reconstructs `GameState` from `gameRepo`, `heroRepo`, `settlementRepo`, `charterRepo`, `tileRepo`).
  - Read-path cutover with fallback to legacy JSONB if granular rows are not yet populated.
- **Exit Criteria:**
  - Commands persist to normalized tables.
  - Server hydrates identical `GameState` from normalized tables as it did from the JSONB blob.

#### **Track 4.B (Dev B) — SQL Migrations & Data Migration Scripts**
- **Goal:** Establish the production database schema with small tables and migrate existing games.
- **Owned Tree:**
  - `server/migrations/`
    - `009_granular_entities.sql` (`heroes`, `hero_platoons`, `settlements`, `settlement_resources`, `settlement_buildings`, `charters`).
    - `010_event_seq.sql` (adds `seq` BIGSERIAL / monotonic sequence and `actor_seat` to `game_events`).
  - `scripts/migrate-jsonb-to-tables.ts` (CLI migration script to parse historical `games.state` JSONB and insert normalized rows).
  - `test/migrations/migration.test.ts` (verifies round-trip integrity of migrated game rows).
- **Exit Criteria:**
  - Migration runs idempotently.
  - Migration script successfully unpacks 100% of sample games without data loss.

---

### Phase 5: Client Event Sync & Scene Renderer Seam

#### **Track 5.A (Dev A) — Client Command Dispatcher & Event-Cursor Sync**
- **Goal:** Replace full-state client pushing (`POST /api/games/:id/save`) with command emission and event-cursor sync.
- **Owned Tree:**
  - `src/io/commands.ts` (client command dispatcher, replaces `GameActions.ts`).
  - `src/io/multiplayerSync.ts` (polls `GET /api/games/:id/events?after=<seq>` or receives SSE and applies events through `@heroes/engine`).
  - `src/managers/GameSessionManager.ts` (updates new/load lifecycle to initialize event cursor).
  - Deletion of manual save push (`SessionManager.ts` full-state pushes).
- **Exit Criteria:**
  - Client actions execute as commands against `POST /commands`.
  - Multiplayer games synchronize state exclusively via delta events.

#### **Track 5.B (Dev B) — Scene Graph Builder & Entity Mirror**
- **Goal:** Decouple canvas rendering from game state via pure scene builders and event-driven tweening.
- **Owned Tree:**
  - `src/render/scene/sceneBuilder/` (pure functions: `GameState + Camera -> SceneNode[]`):
    - `adventureScene.ts`, `cityScene.ts`, `battleScene.ts`.
  - `src/render/scene/paint2d/` (Canvas2D painter reading `SceneNode[]`).
  - `src/render/scene/entityMirror.ts` (subscribes to `HeroMoved`, `StructureBuilt` events to drive smooth tweening without rAF full-state re-polling).
  - Decomposing large screen views (e.g. `src/screens/combat/manualBattleArena.ts` -> modular components).
- **Exit Criteria:**
  - Canvas rendering runs from immutable `SceneNode[]` lists.
  - Hero movement animations interpolate smoothly driven by event subscriptions.

---

## 5. File Ownership Matrix (Conflict Prevention)

| File / Directory | Phase 3 Owner | Phase 4 Owner | Phase 5 Owner |
| :--- | :--- | :--- | :--- |
| `packages/contracts/src/commands/` | **Dev A** | Shared | Shared |
| `server/app/commandHandler.ts` | **Dev A** | **Dev A** | Shared |
| `server/http/routes/commands.ts` | **Dev A** | **Dev A** | - |
| `server/app/turnService.ts` | **Dev A** | - | - |
| `server/persistence/repositories/*` | **Dev B** | **Dev B** | - |
| `server/persistence/db.ts` | **Dev B** | - | - |
| `server/migrations/*` | - | **Dev B** | - |
| `scripts/migrate-jsonb-to-tables.ts` | - | **Dev B** | - |
| `src/io/commands.ts` | - | - | **Dev A** |
| `src/io/multiplayerSync.ts` | - | - | **Dev A** |
| `src/managers/GameActions.ts` | - | - | **Dev A** |
| `src/render/scene/sceneBuilder/*` | - | - | **Dev B** |
| `src/render/scene/entityMirror.ts` | - | - | **Dev B** |
| `src/screens/combat/*` | - | - | **Dev B** |

---

## 6. Verification & Quality Gates

Each PR must pass the standard quality gates:
1. `npm run build` (tsc strict + vite build)
2. `npm run lint:deps` (0 dependency cruiser boundary violations)
3. `npm run validate-assets` (all sprite descriptors resolved)
4. `npm run test:all` (smoke, multiplayer smoke, cityView tests, and new domain unit tests)
