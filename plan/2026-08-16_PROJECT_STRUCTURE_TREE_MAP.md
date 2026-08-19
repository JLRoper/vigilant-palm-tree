# Project Structure & Architecture Tree Map

*Generated: 2026-08-16*
*Repository: heroes-js*

This document captures the current real-world file, package, class, and module hierarchy of the `heroes-js` codebase.

---

## 1. Directory & File Tree

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
│   │   ├── scene/                               # Phase 5 Track B renderer seam (PR #101, #104)
│   │   │   ├── entityMirror.ts                  # Hero/Castle tween mirror (applyEvent-shaped; not yet wired to a live event stream)
│   │   │   ├── types.ts                         # SceneNode union + per-builder input types
│   │   │   └── sceneBuilder/                    # Pure: GameState + Camera → SceneNode[]
│   │   │       ├── adventureScene.ts
│   │   │       ├── cityScene.ts
│   │   │       └── battleScene.ts
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

## 2. Class & Object-Oriented Architecture Map

```
SYSTEM CONTROLLERS
  GameEngine                     (Central loop, canvas contexts, sub-manager coordinator)
  ├── GameStateManager          (Reactive GameState store, listener subscriptions)
  ├── GameActions                (Dispatches game intents: move, recruit, trade, build)
  ├── ViewManager                (Switches active screens: adventure, cityView, combat)
  ├── UIManager                  (Renders and coordinates DOM HUD, toolbar, modal menus)
  ├── GameSessionManager         (Coordinates new game creation, save/load, server sync)
  └── SessionManager             (Debounced auto-save engine and status broadcaster)

GAMEPLAY & MAP ENTITIES
  Hero                           (Hero state wrapper: movement, directions, platoons)
  Castle                         (Settlement state wrapper: control radius, upgrades)
  GameMap                        (Axial hex grid tile store, terrain queries, map generators)
  TurnController                 (Turn state machine: human, AI, and calendar transitions)

CANVAS RENDERING & VIEWPORTS
  Renderer                       (2D canvas adventure map rasterizer)
  Camera                         (Pan/zoom coordinates, worldToScreen, screenToWorld)
  MinimapCamera                  (Minimap projection and pan-to-click calculator)
  OffscreenBuildingCache         (Isometric building prerender cache)

SPRITE ASSET PIPELINE
  SpriteProvider                 (Central loader and cache for image assets)
  SpriteSource (Hierarchy)
  ├── ImageSpriteSource          (Wraps static HTMLImageElement)
  ├── OnDemandSpriteSource       (Lazy image loader)
  ├── ProceduralSpriteSource     (Canvas procedural drawer)
  ├── CompositeSpriteSource      (Multi-source fallback chain)
  ├── VariantAwareSource         (Variant-keyed sprite selector)
  └── ApiSpriteSource            (Network-loaded custom uploaded assets)

UI SCREENS & MODALS
  AdventureView                  (World map input, hex hover, right-click movement)
  CityView                       (Isometric city screen, skybox, parallax, placement)
  BuildingPlacer                 (Interactive building cursor preview & grid placement)
  BuildingMenu                   (Building action/upgrade modal dialog)
  BuildingSelectionMenu          (Building construct menu palette)
  CityDesignBoxManager           (City grid design bounding box manager)
  HeroInfoMenu                   (Hero army inspector, stack reordering)
  HeroRosterMenu                 (Side drawer hero list)
  SettlementInfoMenu             (Town details, warehouse, upgrade actions)
  SettlementRosterMenu           (Side drawer settlement list)
  SettlementPanel                (Docked bottom settlement HUD)
  Toolbar                        (Top resource bar, calendar date, screen view buttons)
  PopupMenu                      (Base class for styled animated dialogs)

COMMUNICATIONS & NETWORK
  MultiplayerSync                (EventSource SSE realtime game state subscriber)
  EventBus                       (Pub/sub game event distribution bus)
  EventLog                       (In-game event recorder and query engine)
  TimeoutError                   (Custom HTTP network timeout error)
```
