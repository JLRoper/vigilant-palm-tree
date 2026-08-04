# Module Documentation & Relationships

> Module-by-module dependency map for the `heroes-js` codebase. Each section lists what the module does and the **internal** modules it imports (external npm deps are omitted unless architecturally significant).
>
> This is the maintained **current state**. Compare with [`architecture.md`](./architecture.md), which is the executed **plan** that established the layout — the two will drift over time.

## 1. High-level data flow

Two runnable processes share engine code:

```
Browser (Vite SPA)                                  Express API server
  src/main.ts ─► GameEngine                         server/index.ts ─► routes.ts
      │                                                │
      ├─ src/io/api.ts ──── fetch /api/* ─────────────►  │   pool = pg.Pool
      ├─ src/io/auth.ts ─── fetch /api/auth/* ───────►  │       │
      ├─ src/io/assetApi.ts fetch /api/assets/* ─────►  │       ▼
      │                                                │   postgres (shared
      │   src/state/gameState.ts                      │    "game_db" container,
      │       │  applyEndOfTurnDetailed()             │    fixed port 5432)
      │       │  reconcile against server result ◄───┼── server re-applies same
      ▼                                                ▼
   TurnController (client-authoritative reducer)
      │  builds/spends Heroes, Settlements, Charters
      │  emits events via core/eventBus.ts
      ▼
   src/render/* draws every frame from hex map + Hero entities
```

`shared/combat/*` is engine-neutral and used by **both** sides — client drives the "Test Battle" dev arena; server calls `resolveBattle()` inside route handlers against the DB-backed `unit_types` catalog.

---

## 2. Entry points

| Role | File | What it does |
|---|---|---|
| Client | `src/main.ts` | Creates `GameEngine`, runs `init`+`initBackend`, shows home view, kicks off `requestAnimationFrame` loop |
| API | `server/index.ts` | Express bootstrap, CORS, raw image + JSON parsers, mounts `/api` router on `API_PORT` |
| API routes | `server/routes.ts` | Games CRUD, tiles, events log, end-turn pipeline, resolve-battle, gold transfer, resource trade; re-runs `applyEndOfTurnDetailed` server-side for drift safety |

---

## 3. `server/` — API process

| Module | Role | Depends on |
|---|---|---|
| `server/db.ts` | `pg.Pool` factory; `initSchema()` applies `schema.sql` + migrations 001–005; `withTransaction()` helper | `pg`, `node:fs`, `node:path` |
| `server/auth.ts` | Email + 6-digit-code auth (SHA-256 hashed codes), bearer-token sessions w/ 30-day TTL, `requireAuth` middleware | `express`, `node:crypto`, `./db` |
| `server/assetRoutes.ts` | REST for `game_assets`: list, get binary (cache headers), put, delete, batch upload | `express`, `./db` |
| `server/routes.ts` | Core game API; orchestrates state mutations + combat | `../src/map/gameMap`, `../src/core/rng`, `../src/game/initState`, `../src/state/gameState`, `../src/state/units`, `../../shared/combat/resolveBattle`, `./assetRoutes`, `./auth` |
| `server/schema.sql` + `migrations/001..005` | DDL for `games`, `tiles`, `game_events`, `settlement_snapshots`, `resource_transactions`, `game_assets`, `unit_types` + counter columns | — |

---

## 4. `shared/` — engine-neutral code (both sides import this)

| Module | Role | Depends on |
|---|---|---|
| `shared/combatConfig.ts` | Tunables: `TYPE_TRIANGLE`, advantage multipliers, retreat loss, grid/row defaults, `RANGED_ATTACK_RANGE` | — |
| `shared/combat/types.ts` | `BattleSide`, `BattleHex`, `BattleGrid`, `Combatant`, `CombatantOutcome`, `BattleResult`, `BattleSnapshot`, `ResolveBattleOptions` | `../../src/core/hex`, `../../src/state/units` |
| `shared/combat/damage.ts` | Pure math: `typeMultiplier`, `computeDamage` (effAttack²/(effAttack+effDefense) × adv × mod), `applyCasualties`, `applyRetreatLoss` | `../../src/state/units`, `../combatConfig` |
| `shared/combat/grid.ts` | `makeBattleGrid` (random obstacles via `mulberry32`), `deploymentPosition` | `../../src/core/hex`, `../../src/core/rng`, `../combatConfig` |
| `shared/combat/resolveBattle.ts` | Auto-resolver: turn loop, counterattack chains, retreat policies; exports `buildCombatants`, `resolveAttack`, `buildResults` | `../../src/state/units`, `../combatConfig`, `./grid`, `./damage`, `./types` |
| `shared/combat/manualBattle.ts` | HoMM3-style interactive engine: `startManualBattle`, `movePlatoon`/`attackWithPlatoon`, BFS movement range, line-of-sight, `runAiTurn`, `finalizeManualBattle` | `../../src/core/hex`, `../../src/state/units`, `../combatConfig`, `./grid`, `./resolveBattle`, `./types` |
| `shared/combat/index.ts` | Barrel re-export | (all above) |

---

## 5. `src/` — client SPA

### 5.1 `src/main.ts`
- Orchestrator entry. Constructs `GameEngine`, wires home view callbacks (`onNewGame`, `onLoadGame`), starts rAF loop.

### 5.2 `src/core/` — pure utilities (no I/O)
| Module | Role | Imports |
|---|---|---|
| `hex.ts` | Axial-hex primitives: `HEX_SIZE=32`, `axialToPixel`/`pixelToAxial`, `axialRound`, `hexDistance` | — |
| `rng.ts` | Global LCG `rng()` + `mulberry32(seed)` factory | — |
| `eventBus.ts` | Typed pub/sub singleton (`bus.on`/`emit`/`clear`) | — |
| `eventRegistry.ts` | `registerAllListeners()` hook (placeholder) | `./eventBus` |
| `events.ts` | `GameEvent` discriminated union (`state:committed`, `turn:ended`, `phase:changed`, `hero:moved`, `settlement:captured`, `battle:resolved`, economy/morale, calc:vision/control/heroSpeed) | `./hex`, `../state/gameState` |
| `cityGrid.ts` | Diamond-grid math for city view (`TILE_W=96`, `TILE_D=48`); `cellToScreen`/`screenToCell`, `cellsInDrawOrder` | — |
| `citySpots.ts` | `generateCitySpots` places 3/6/9 resource veins + mines for 5/10/15 city sizes | `../map/resourceTiles`, `./cityGrid` |
| `control.ts` | `controlRange`, `settlementRateRadius`, `controlledPositions`, `territoryBoundaryEdges` | `./hex`, `../entities/settlement`, `../render/cityBuildingDraw` |
| `buildingRegistry.ts` | Master `REGISTRY` of 13 building kinds (townHall, house, tower, mageGuild, mine, market, barracks, smithy, apartment, farmField, farmhouse, archeryRange, granary) — placement/upkeep/effects | `../render/cityBuildingDraw`, `../state/gameState` |
| `buildingModifiers.ts` | `computeSettlementBonuses`/`computePlayerBonuses` aggregators | `../render/cityBuildingDraw`, `./buildingRegistry` |

### 5.3 `src/state/` — authoritative game state (pure reducers)
| Module | Role | Imports |
|---|---|---|
| `gameState.ts` | **1460-line core.** Types (`Player`, `HeroState`, `SettlementState`, `CharterState`, `GameState`) and **all pure reducers** (`selectHero`, `startMove`, `captureSettlement`, `startBattle`, `endBattlePhase`, `endTurn`, `transferGold`, `tradeResources`, `applySettlementConsumption`, `applyEndOfTurnDetailed`, `advanceRound`, charter flow, upgrade flow, `recruitHero`) | `./units`, `../economy/consumption`, `../entities/settlement`, `./settings`, `../economy/settlementRates`, `../render/cityBuildingDraw`, `../render/buildingStyleResolver`, `../core/buildingRegistry` |
| `turnController.ts` | **Stateful wrapper.** Wraps every reducer; broadcasts `bus` events; `tick(dtMs)` runs AI turn (`pickAiMove`→`startMove`→`onAiMove`); `endHumanTurn` runs full pipeline; persists across moves | `./gameState`, `../core/eventBus`, `../map/pathfinding`, `../core/hex`, `./units`, `../map/gameMap`, `../economy/settlementRates`, `./settings`, `../core/citySpots`, `../core/cityGrid` |
| `units.ts` | Unit/platoon types (`UnitType`, `Platoon`, `PlatoonEntry`), `normalizePlatoons`, `demoPlatoonsForPlayer`; re-exports `AdvantageType` | `../../shared/combatConfig` |
| `settings.ts` | `HorseVariant` (8), `ResourceStyle` (8), `GameSettings` (move duration, sprite variant, building upgrade confirm, etc.); localStorage-persisted singleton `settings()` | `../render/horseVariants` |
| `playerColors.ts` | `PLAYER_COLORS` (10), `MAX_PLAYERS`, `colorForOwner` | — |

### 5.4 `src/entities/` — animated runtime objects
| Module | Role | Imports |
|---|---|---|
| `hero.ts` | `Hero` class — animation state (fromTile/toTile/moveProgress/pixelOffset), eased movement, `faction`, `horseVariant`; `toGameState`/`fromGameState` | `../core/hex`, `../state/gameState`, `../state/units`, `../state/settings` |
| `settlement.ts` | `Castle` class (level 1–3, warehouse, pop, morale, buildings, `upgrade`); `castlesFromGameState`, `castleAt` | `../core/hex`, `../state/gameState`, `../render/cityBuildingDraw` |

### 5.5 `src/map/` — world model
| Module | Role | Imports |
|---|---|---|
| `terrain.ts` | `Terrain` union, `TERRAIN_COLORS`, `TERRAIN_COST` (water/mountain=∞), `isPassable` | — |
| `resourceTiles.ts` | `ResourceType` (gold/wood/stone/iron/arcane/food), `RESOURCE_DENSITY`/`RESOURCE_YIELD`, `placeResourceTiles` (with mountain-border boost for stone/iron) | `./gameMap`, `./terrain` |
| `gameMap.ts` | Hex `GameMap` (small/medium/large sizes), procedural terrain blobs + hero-spawn safety; `GameMap.fromTiles` for server hydration | `./terrain`, `./resourceTiles`, `../core/hex`, `../core/rng` |
| `pathfinding.ts` | A* over axial neighbors with terrain costs; `findPath`, `computePathCost` | `../core/hex`, `./gameMap`, `./terrain` |
| `castlePlacement.ts` | `generateCastles(map, opts)` — picks hexes avoiding edge-buffer + min-spacing; assigns owner + level 1/2/3; `defaultCastleSeedFromMapSeed`, `playerCastle`, `aiCastle` | `../core/rng`, `../entities/settlement`, `./gameMap`, `./terrain` |

### 5.6 `src/economy/` — math
| Module | Role | Imports |
|---|---|---|
| `consumption.ts` | `foodRequired` (1 unit per 100 pop), `buildingUpkeepRequired`, `foodDeficitRatio`, `moraleDecay`, `effectiveIncome`, `clampMorale`, `clampWarehouseNonNegative` | `../state/gameState`, `../core/buildingRegistry` |
| `income.ts` | Per-settlement `settlementIncome`, `playerIncome`, `playerWealth` | `../state/gameState`, `../core/buildingRegistry` |
| `settlementRates.ts` | `POP_BY_LEVEL`, `SETTLEMENT_GOLD_TAX`, name generators, `computeSettlementRates` (sums `RESOURCE_YIELD` over level-radius ring) | `../map/gameMap`, `../map/resourceTiles`, `../entities/settlement`, `../core/control` |

### 5.7 `src/ai/` and `src/combat/` (dev-only test arena)
| Module | Role | Imports |
|---|---|---|
| `ai/aiBrain.ts` | `pickAiMove` — target-prioritised (enemy hero > neutral settlement > unclaimed resource > wander) with pathfinding | `../core/hex`, `../map/pathfinding`, `../map/gameMap`, `../state/gameState`, `../map/terrain` |
| `systems/enemyWander.ts` | `pickAiWanderTarget` (random reachable hex 3–6 away) | `../core/hex`, `../map/pathfinding`, `../map/gameMap`, `../state/gameState`, `../map/terrain` |
| `systems/movement.ts` | `onHeroArrived` — find path, compute cost, call `turnController.requestMove`, animate | `../core/hex`, `../map/pathfinding`, `../map/gameMap`, `../state/gameState`, `../state/turnController`, `../entities/hero` |
| `combat/testArmies.ts` | `fixedTestPlayerPlatoons()`, `randomAiPlatoons()` for Test Battle sandbox | `../state/units` |

### 5.8 `src/data/` — catalog caches
| Module | Role |
|---|---|
| `heroNames.ts` | `pickHeroName()`/`releaseHeroName()` from 60-entry fantasy list + `Commander #N` fallback |
| `unitCatalog.ts` | Client cache of `/api/units`; `loadUnitCatalog()` (deduped promise), `getCachedUnit(id)`, `catalogReady()` |
| `unitImages.ts` | `getUnitImageUrl(unitTypeId)` → `src/resources/units/{placeholder,swordsman,archer,cavalry}.png` |

### 5.9 `src/io/` — network + dev console
| Module | Role | Imports |
|---|---|---|
| `api.ts` | Typed `fetch` wrappers (`health`, `listGames`, `getGame`, `createGame`, `patchGame`, `logEvent`, `getTiles`, `endTurn`, `spendMovement`, `resolveBattle`, `transferGold`, `tradeResources`) with `apiFetch(url, init, timeoutMs)` + AbortController; re-exports shared types | `../core/hex`, `../map/terrain`, `../map/resourceTiles`, `../state/gameState`, `../../shared/combat/types` |
| `auth.ts` | localStorage-backed auth state (`heroesJs.authToken`/`authEmail`); `requestLoginCode`, `verifyLoginCode`, `checkSession`, `logout`, `authHeader` | `./api` |
| `assetApi.ts` | `fetchAssetList`, `fetchAssetBlob`, `assetUrl(key)`, `uploadAsset`, `deleteAsset`, `batchUpload` against `/api/assets*` | — |
| `userGames.ts` | localStorage cache `heroesJs.userGames` (recent games w/ `lastSeenAt`) for home screen | — |
| `debugCommands.ts` | Attaches `window.__gameDebug` for manual poking (`endTurn`, `requestMove`, `enterBattle`, etc.) and exposes `__gameDebug.events` (`subscribe`/`getEntries`/`stats`/`clear`/`setCapacity`) backed by the `EventLog` | `../state/gameState`, `../map/pathfinding`, `../map/terrain`, `../core/hex`, `../debug/eventLog` |

### 5.10 `src/render/` — drawing pipeline
| Module | Role | Imports |
|---|---|---|
| `camera.ts` | `Camera` — pan, `zoomAt(screenX, screenY, factor)` anchored under cursor, `apply(ctx)` w/ DPR | — |
| `palettes.ts` | `GenerationStyle` alias, `RESOURCE_PAL`, `BUILDING_PALETTES` | `../map/resourceTiles`, `./buildingStyles` |
| `buildingStyles.ts` | `BUILDING_STYLE_REGISTRY` of 5 styles (classic/blocky/crystalline/organic/industrial) | — |
| `buildingStyleResolver.ts` | `BUILDING_SPRITE_KEYS`, `pickStyleForBuilding(kind, level, preferred)` | `./palettes` |
| `horseVariants.ts` | `HORSE_VARIANT_REGISTRY` of 8 horse sprites (bubbly, shadow, paladin, ranger, arcane, unicorn, samurai, hero) | — |
| `assetDescriptors.ts` | 650-line registry: imports 90+ PNGs via Vite `?url`; exports `CASTLE_SPRITES`, `SETTLEMENT_BANNERS`, `HERO_BANNERS`, `RESOURCE_*`, `BUILDING_SPRITES` | `../entities/hero`, `../entities/settlement`, `../map/resourceTiles`, `../state/settings`, `./horseVariants`, `./buildingStyleResolver`, `../resources/*` |
| `assetSource.ts` | `SpriteSource` interface + 5 impls (`ImageSpriteSource`, `OnDemandSpriteSource`, `ProceduralSpriteSource`, `CompositeSpriteSource`, `VariantAwareSource`, `ApiSpriteSource`) | — |
| `assets.ts` | `SpriteProvider` + `createDefaultProvider(proceduralDrawers)` (composite + variant-aware) | `./assetDescriptors`, `./assetSource`, `../state/settings` |
| `heroSprites.ts` | ASCII-art `drawKnightSprite`/`drawDemonSprite` procedural fallback | `./assetSource` |
| `sprites.ts` | `drawCastleSprite`, `drawResourceIcon`, `drawHeroSprite` (w/ scale-Y animation), `drawHorseSprite`, `drawWithDescriptor`; exports `HERO_PROCEDURAL_DRAWERS` | `../entities/hero`, `../entities/settlement`, `../map/resourceTiles`, `../state/settings`, `./assets`, `./assetDescriptors`, `./horseVariants`, `./heroSprites` |
| `fog.ts` | `computeVision(heroes, castles, viewPlayerId)`, `isVisible`; `VISION_RANGE=4` | `../entities/hero`, `../entities/settlement`, `../core/hex`, `../core/control` |
| `minimap.ts` | `MinimapCamera` (independent pan/zoom/rotation), `drawMinimap` (animated mist + fog edges) | `../entities/hero`, `../map/gameMap`, `../map/terrain`, `./overlays/pathOverlay`, `./fog`, `../core/hex` |
| `cityBuildingDraw/types.ts` | `BuildingKind` union (13), `BuildingDef`, `DrawBuildingContext` | `../palettes` |
| `cityBuildingDraw/primitives.ts` | `coversCell`, `buildingFootprint`, `lighten`/`darken`, `buildingHeight`, `drawIsoBox` (3-face iso), `getOpts` | `../../core/cityGrid`, `../../core/buildingRegistry`, `./types` |
| `cityBuildingDraw/{classic,blocky,crystalline,organic,industrial}.ts` | One procedural renderer per style | shared `primitives`/`types`/`palettes` |
| `cityBuildingDraw/spots.ts` | `drawSpot`, `drawMine` | `./types`, `./primitives`, `../palettes`, `../assets` |
| `cityBuildingDraw.ts` | `STYLE_DRAW_FNS` orchestrator; `OffscreenBuildingCache` per style/kind/level/color; `drawBuilding()` prefers sprite → cached offscreen → `drawBuildingFromContext`; `drawTownHall`, `clearOffscreenBuildingCache` | (all sub-files) `./palettes`, `./assets`, `./assetDescriptors`, `./buildingStyles` |
| `cityBuildingGen.ts` | `generateBuildings(config)` with 6 layout patterns (denseUrban/sparseRural/radial/grid/clustered/sampler) + style enrichers | `./cityBuildingDraw`, `../core/cityGrid`, `../core/buildingRegistry`, `./buildingStyles` |
| `cityRenderer.ts` | `drawCityView(ctx, opts)` — skybox (cached variants), iso grid, resource spots/mines, ordered building draw, selection highlight, ghost placement, header text | `../core/cityGrid`, `../map/resourceTiles`, `./assets`, `./cityBuildingDraw`, `../core/buildingRegistry`, `./assetDescriptors`, `../state/settings` |
| `overlays/pathOverlay.ts` | `computeReachableSplit`, `drawPathSegment`, `drawTrail`, `drawPathOverlay` (yellow split-line + dots), `drawMinimapPath` | `../../core/hex`, `../../entities/hero`, `../../map/gameMap`, `../../map/terrain`, `../renderer`, `../minimap` |
| `overlays/resourceIcon.ts` | Iterates map resource tiles in vision → `drawResourceIcon` | `../../map/gameMap`, `../../core/hex`, `../sprites`, `../assets` |
| `overlays/territoryOutline.ts` | `drawTerritoryOutlines` — partitions controlled hexes by nearest owner castle → colored Voronoi-style boundary edges | `../../entities/settlement`, `../../core/control`, `../../core/hex`, `../../state/settings` |
| `renderer.ts` | **Main per-frame hex renderer:** terrain + decorations + fog + resource icons + castles + territory outlines + path overlay + hover ring + animated heroes; routes to `drawMinimap`; handles `activeCharters`/`validCharterHexes` overlays | `../core/hex`, `./camera`, `../entities/hero`, `./sprites`, `../entities/settlement`, `../map/gameMap`, `../map/terrain`, `./overlays/*`, `./assets`, `./fog`, `./minimap`, `../state/gameState` |

### 5.11 `src/managers/` — high-level orchestrators
| Module | Role | Imports |
|---|---|---|
| `GameEngine.ts` | **Top-level orchestrator.** Holds `spriteProvider`, `view`, `ui`, `actions`, `sessions`, `state`, `eventLog`; wires `initProviders/initGameState/initRendering/initUI/initInput/initDebug/initEventListeners`; `initGameState` calls `attachEventLog()` and wraps the built `turnHooks` before `setHooks`; `initDebug` forwards `eventLog` into `attachDebugApi` for `__gameDebug.events`; drives `loop(now)`, `fullFrame()`, `draw()`, charter placement, dbl-click city open, click handlers | `../map/gameMap`, `../render/assets`, `../render/sprites`, `../core/rng`, `../views/adventureView`, `../state/playerColors`, `../game/initState`, `../game/turnHooks`, `../core/cityGrid`, `../core/hex`, `../state/gameState`, `./SessionManager`, `./GameStateManager`, `./ViewManager`, `./UIManager`, `./GameActions`, `./GameSessionManager`, `../io/debugCommands`, `../core/eventBus`, `../core/eventRegistry`, `../debug/eventLog` |
| `GameStateManager.ts` | Owns `gameState`, `turnController`, `heroes`/`settlements` dicts, `gameMap`, `pathPreviewLock`; `setState`/`replaceState` rebuilds TurnController; `rebuildHeroesFromState`/`rebuildSettlementsFromState`/`syncHeroVisualsToState`; `update(dt)` ticks animations + turn controller | `../state/gameState`, `../entities/hero`, `../entities/settlement`, `../map/pathfinding`, `../map/gameMap`, `../state/turnController`, `../core/hex`, `../core/eventBus` |
| `ViewManager.ts` | Owns `Camera`, `MinimapCamera`, `Renderer`, `AdventureView`; `initializeRenderer`/`initializeAdventureView`/`updateMap`/`draw`/`drawCityOverlay`/`centerOn`/`resize`/`getHover`/`getPath`/`hoverFromScreen` | `../render/camera`, `../render/renderer`, `../render/minimap`, `../map/gameMap`, `../entities/hero`, `../entities/settlement`, `../views/adventureView`, `../render/assets`, `../core/hex`, `../views/cityView`, `../state/gameState` |
| `UIManager.ts` | Owns HUD, Toolbar, HeroInfoMenu, HeroRosterMenu, SettlementRosterMenu, SettlementInfoMenu, CityView; `initToolbar/initHeroMenu/initSettlementInfo/initCityView`, `refreshHud`, `buildCalendarSnapshot` | `../views/*`, `../state/gameState`, `../entities/hero`, `../render/assets`, `../economy/income`, `./SessionManager`, `./GameStateManager`, `./ViewManager`, `../views/settingsMenu` |
| `SessionManager.ts` | Active game id/name, backend health, save status; `init()`, `manualSave()`, `createGame`, `getTiles`, `logEvent`, `getLatestGames` | `../io/api`, `../io/userGames` |
| `GameSessionManager.ts` | Bridges `SessionManager` ↔ `GameStateManager` ↔ `ViewManager`; `loadGame`, `handleManualSave`, `handleNewGame`, `createFreshStarter`, `initBackend` | `../map/gameMap`, `../economy/income`, `../state/gameState`, `../game/initState`, `../map/castlePlacement`, `../data/unitCatalog`, `../views/adventureView`, `../io/api` |
| `GameActions.ts` | Game-flow actions: `syncFromController`, `maybeAutoResolveBattle`, `startBattleFlow` (calls `showBattleModal`), `handleEndTurn` | `./GameStateManager`, `./SessionManager`, `../views/battleModal` |
| `CityDesignBoxManager.ts` | Pure-DOM bottom-left "City Design" panel (Build/Generate/Back) while a city view is open | — |

### 5.12 `src/views/` — UI panels (mostly DOM, some canvas)
| Module | Role | Imports |
|---|---|---|
| `menu.ts` | Generic popup primitives: `menuTheme`, `styleButton`/`styleInput`, `PopupMenu` class (draggable, closeable, setContent/appendContent/clearContent/setPosition), `openCenteredModal` | — |
| `homeView.ts` | Home overlay: New/Load/Settings/Sign-In modals, `userGames` remember | `../io/api`, `../io/userGames`, `../io/auth`, `./menu`, `./settingsMenu` |
| `adventureView.ts` | **Main map view:** mouse drag/wheel/touch-pinch, hover tracking, path preview, click-to-move/adjacent-enemy/settlement, charter modal; `MAP_SEED=42` | `../core/hex`, `../render/camera`, `../map/gameMap`, `../render/renderer`, `../entities/hero`, `../map/pathfinding`, `../state/gameState`, `../state/turnController`, `../render/overlays/pathOverlay`, `../managers/GameStateManager`, `./menu`, `../render/minimap` |
| `cityView.ts` | Full-screen city build view: keyboard (B/Esc/Delete/1–5 styles/!@#$%^ patterns/R reroll); mouse→grid picking; place/destroy/select modes; `TurnController.startBuildingUpgrade`; persists on close; wires `BuildingPlacer`, `BuildingMenu`, `BuildingSelectionMenu`, `CityDesignBoxManager` | `../core/cityGrid`, `../render/cityRenderer`, `../map/resourceTiles`, `../render/assets`, `../render/cityBuildingDraw`, `../render/cityBuildingGen`, `./buildingMenu`, `./buildingPlacer`, `./buildingSelectionMenu`, `./confirmDialog`, `../state/settings`, `../state/gameState`, `../core/buildingRegistry`, `../managers/CityDesignBoxManager` |
| `hud.ts` | Status line: round, wealth, morale, effective income, upkeep, save time | `../state/gameState`, `../economy/consumption`, `../economy/income` |
| `toolbar.ts` | Top toolbar: New/Save/Load + calendar chips (Day/Week/Month/ActivePlayer) + End Turn/Heroes/Settlements/Charter/Test Battle | `../io/api`, `../io/userGames`, `../state/gameState`, `../map/castlePlacement`, `./settingsMenu`, `./testBattleSetup`, `./menu` |
| `heroInfoMenu.ts` | Hero detail: banner, name, gold, food, movement bar, transfer buttons, stats, army grid w/ drag-drop reorder | `../state/gameState`, `../entities/hero`, `./menu`, `../state/units`, `../data/unitCatalog`, `../data/unitImages`, `../render/assetDescriptors` |
| `heroRosterMenu.ts` | Draggable heroes list (player roster) | `./menu`, `../state/gameState`, `../render/assetDescriptors` |
| `settlementInfoMenu.ts` | Settlement popup: banner, level, pop/income/treasury/morale/food, warehouse, recruit-hero, upgrade-settlement (gate-checks); `openRecruitHeroModal` (name + horse variant) | `../state/gameState`, `./menu`, `../render/assetDescriptors`, `../entities/settlement`, `../state/settings`, `../economy/settlementRates`, `../data/heroNames`, `../render/horseVariants` |
| `settlementPanel.ts` | All-settlements side panel: per-owner cards (pop/income/morale/food/warehouse), auto-trade toggle, Trade modal | `../state/gameState`, `../map/resourceTiles`, `./menu`, `./tradeModal` |
| `settlementRosterMenu.ts` | Active player's settlements list | `./menu`, `../state/gameState`, `../render/assetDescriptors` |
| `buildingMenu.ts` | Per-building popup (label/desc/effects/cost/upgrade/recruit) | `./menu`, `../render/cityBuildingDraw`, `../state/gameState`, `../core/buildingRegistry` |
| `buildingPlacer.ts` | Place/remove/destroy buildings; palette popup w/ build/destroy modes, cost summary, net-cost calculator | `../core/cityGrid`, `../render/cityRenderer`, `../render/cityBuildingDraw`, `./menu`, `../core/buildingRegistry`, `../render/assetDescriptors`, `../state/gameState` |
| `buildingSelectionMenu.ts` | Multi-select upgrade preview (aggregate effects, combined cost, single confirm) | `./menu`, `../render/cityBuildingDraw`, `../state/gameState`, `../core/buildingRegistry` |
| `battleModal.ts` | Tiny modal: Resolve or Flee before applying battle result | `./menu` |
| `battleResultCard.ts` | End-of-battle summary (per-side survivors/losses) | `../../shared/combat/types`, `../data/unitCatalog`, `./menu` |
| `manualBattleArena.ts` | **Fullscreen HoMM3-style arena** for Test Battle: grid + side panels + footer (round/turn/time-of-day info row + action row with End Turn, **Retreat**, **Surrender**, **⚙ Settings** buttons); click-to-move/attack; alternates with `runAiTurn`; Retreat/Surrender call `retreatHero` (applyLoss true/false) → `finalizeManualBattle` → `showBattleResultCard`; Surrender costs SURRENDER_COST_GOLD (5000G) — if heroGold is insufficient, opens a Leave Behind picker (SURRENDER_UNIT_VALUE_GOLD=100 per unit) that strips the chosen counts from surviving platoons before finalize; Settings opens `openSettingsMenu({ parent: overlay })` | `../core/hex`, `../../shared/combat/damage`, `../../shared/combat/manualBattle`, `../../shared/combat/types`, `../../shared/combatConfig`, `../state/units`, `./battleResultCard`, `./confirmDialog`, `./menu`, `./settingsMenu` |
| `testBattleSetup.ts` | Test Battle entry modal: Blue/Red side pick, player preset + AI roster (Reroll), Start → `openManualBattleArena` | `../combat/testArmies`, `../data/unitCatalog`, `../../shared/combat/types`, `../state/units`, `./menu`, `./manualBattleArena` |
| `assetManager.ts` | Dev modal: list/upload/download/delete assets via `assetApi` | `./menu`, `../io/assetApi` |
| `developerSettingsMenu.ts` | Dev menu: event-bus inspector, Asset Manager launch, Test Battle launch, Dev Console launch (reads `__gameDebug.eventLog`) | `./menu`, `../core/eventBus`, `./assetManager`, `./testBattleSetup`, `../debug/devConsole` |
| `settingsMenu.ts` | Settings UI: Map Info + Game + Population + Confirmations + Visual sections (sliders → `updateSettings`), Reset, Developer Settings link | `./menu`, `../state/settings`, `./developerSettingsMenu` |
| `tradeModal.ts` | Move resources between settlements (gold cost, amount cap) | `../state/gameState`, `./menu` |
| `confirmDialog.ts` | Generic confirm/cancel dialog | `./menu` |

### 5.13 `src/game/` — bootstrap + turn wiring
| Module | Role | Imports |
|---|---|---|
| `initState.ts` | `buildInitialGameState` (client-side factory using `generateCastles` + `computeSettlementRates` + city spots), `makeInitialStatePayload` (server DTO), `hydrateGameState(row)` (server→client); re-exports `CASTLE_COUNT_*` | `../state/gameState`, `../state/units`, `../io/api`, `../map/gameMap`, `../map/castlePlacement`, `../entities/settlement`, `../economy/settlementRates`, `../state/playerColors`, `../core/citySpots`, `../core/cityGrid`, `../state/settings` |
| `turnHooks.ts` | `buildTurnHooks` wires client reducers to API: `onHumanTurnEnd`→`/end-turn`, `onAiMove`→`/spend_movement`, `onBattleResolved`→`/resolve-battle`, `pickAiMove`→`aiBrain`, `logEvent`→`/events` (intercepted by `EventLog.wrapHooks` when a dev console is attached) | `../io/api`, `../state/gameState`, `../state/turnController`, `../ai/aiBrain`, `../map/gameMap`, `../core/hex` |

### 5.14 `src/debug/` — real-time event log + dev console
| Module | Role | Imports |
|---|---|---|
| `eventLog.ts` | `EventLog` ring buffer (`record`/`subscribe`/`getEntries`/`stats`/`clear`/`setCapacity`), `attachEventLog()` subscribes the bus + returns a `wrapHooks(hooks)` interceptor for `TurnControllerHooks.logEvent` | `../core/eventBus`, `../state/turnController` |
| `devConsole.ts` | `openDevConsole(log, opts?)` modal (filter/pause/clear/copy) and `mountDevConsoleFooter(log, opts?)` sticky bar; backed by `EventLog` subscribe | `../views/menu`, `./eventLog` |

---

## 6. `test/`
- **Unit (Node `node:test`):** `cityGrid`, `citySpots`, `minimap`, `state/economy`, `state/gameState`, `state/income`, `combat/resolveBattle`, `combat/manualBattle`, `map/castlePlacement`.
- **Playwright integration:** `smoke.ts` (full E2E spawns API+Vite, verifies New/Load/Save/HUD/DB), `cityView.test.ts`, `dragDrop.test.ts`, `proposedPath.test.ts`.

## 7. `tools/`
FLUX-driven sprite generation pipeline (`tools/sprites/flux-*.mjs` for castles, buildings, heroes, resources, horse variants, farms, market variants, town-hall, tower, piles, regeneration helpers), plus `pixel-gen.mjs`/`pixel-gen-pure.mjs` for pixel-art, `outline-apply.mjs`, `manifest.mjs`, `generate-preview.mjs`, `screenshot-preview.mjs`, and **`validate-assets.mjs`** (asserts every sprite key referenced by `assetDescriptors.ts` has a PNG).

## 8. `scripts/` (helpers, run by `npm` scripts or manually)
- PowerShell: `cleanup.ps1`, `ports.ps1`, `dev-status.ps1`, `batch_remove_background.ps1`.
- TS/Node: `seed-assets.ts` (bulk-insert `src/resources/*` PNGs into `game_assets`), `capture-path.ts` (Playwright path debug screenshots).
- Python: `remove_background.py` (PIL flood-fill background removal).
- Hooks: `scripts/hooks/log-session-change.mjs`.

---

## 9. Key cross-cutting relationships

- **`core/`** has zero `state/`/`render/`/`views/` deps — pure math + pub/sub. Everything else depends on it.
- **`state/gameState.ts`** is the **single source of truth** for game logic; both `turnController.ts` and `server/routes.ts` consume its reducers (drift safety: server re-runs `applyEndOfTurnDetailed`).
- **`core/eventBus.ts`** is the spine connecting `TurnController` → `GameStateManager` → `ViewManager` → `UIManager`/`Renderer`.
- **`render/renderer.ts`** is the **only consumer** of `entities/Hero` + `entities/Settlement` for drawing; everything else uses `state/gameState` directly.
- **`shared/combat/*`** is the **only directory imported by both** `server/routes.ts` and `src/views/manualBattleArena.ts`.
- **`render/assetDescriptors.ts`** is the bridge from Vite-bundled PNGs (`src/resources/*`) to runtime sprite keys; `tools/sprites/validate-assets.mjs` enforces its consistency.
- **`core/buildingRegistry.ts`** is referenced from both logic (`state/gameState`, `economy/*`) and rendering (`render/cityBuildingDraw`, `views/buildingMenu`) — it's the canonical building definition.
- **`io/api.ts`** is the **only file that knows the HTTP shape**; every manager calls into it via `SessionManager`/`GameSessionManager`/`turnHooks`.
