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
      │       │  builds/spends locally, then          │    fixed port 5432)
      │       │  POST /commands (EndTurn) ────────────┼─► server runs the whole
      │       │  ◄──── authoritative heroes/           │    pipeline itself now
      │       │        settlements/round/day back      │    (server/app/turnService.ts)
      ▼                                                ▼
   TurnController (client-authoritative reducer)
      │  builds/spends Heroes, Settlements, Charters
      │  emits events via core/eventBus.ts
      ▼
   src/render/* draws every frame from hex map + Hero entities
```

`shared/combat/*` is engine-neutral and used by **both** sides — client drives the "Test Battle" dev arena; server resolves battles via the `ResolveBattle` command (`server/app/commandHandler.ts`), not a dedicated route, against its own DB-backed `unit_types` catalog.

---

## 2. Entry points

| Role | File | What it does |
|---|---|---|
| Client | `src/main.ts` | Creates `GameEngine`, runs `init`+`initBackend`, shows home view, kicks off `requestAnimationFrame` loop |
| API | `server/index.ts` | Express bootstrap, CORS, raw image + JSON parsers, mounts `/api` router on `API_PORT` |
| API routes | `server/routes.ts` | Games CRUD, tiles, events log, lobby claim/start; delegates MoveHero/TransferGold/EndTurn/TradeResources/ResolveBattle/RecruitHero/UpgradeTownHall/SetAutoTrade/ReorderStack/CaptureSettlement to `server/http/routes/commands.ts` (`server/app/commandHandler.ts`) instead of hand-rolled PATCH/POST branches — the old dedicated `resolve-battle`/`trade` routes are deleted |

---

## 3. `server/` — API process

| Module | Role | Depends on |
|---|---|---|
| `server/db.ts` | `pg.Pool` factory; `initSchema()` applies `schema.sql`, then auto-discovers and applies every `*.sql` file in `server/migrations/` (sorted by filename); `withTransaction()` helper | `pg`, `node:fs`, `node:path` |
| `server/auth.ts` | Email + 6-digit-code auth (SHA-256 hashed codes), bearer-token sessions w/ 30-day TTL, `requireAuth` middleware | `express`, `node:crypto`, `./db` |
| `server/assetRoutes.ts` | REST for `game_assets`: list, get binary (cache headers), put, delete, batch upload | `express`, `./db` |
| `server/routes.ts` | Core game API; orchestrates state mutations + combat. Also owns the **lobby** endpoints — `POST /games/:name/lobby/claim` (claim a seat by index + handle; 409 on `lobby_already_started` or `seat_already_claimed`) and `POST /games/:name/lobby/start` — backed by a `lobby` jsonb column (`LobbyState`: `seats`, `humanSlots`, `claimed: Record<seatIndex, { handle, claimedAt }>`, `startedAt`). Runs `validateGameRow` on load paths | `../shared/map/gameMap`, `../shared/rng`, `../src/game/initState`, `../shared/gameState`, `../shared/units`, `../shared/constants`, `../shared/combat/resolveBattle`, `../shared/combat/types`, `../shared/validation/gameIntegrity`, `./assetRoutes`, `./auth` |
| `server/http/routes/telemetry.ts` | `POST`/`GET /api/games/:name/telemetry` — the dev Network Map's data plane. `Router({ mergeParams: true })` (required for `:name` to reach it), mounted by `routes.ts`. Touches no DB at all | `express`, `@heroes/contracts`, `../../telemetry/presenceRegistry` |
| `server/telemetry/presenceRegistry.ts` | **In-memory, per-process, non-persisted** client presence for the Network Map: fixed ring of the last 10 samples per player, ~6s staleness expiry checked lazily on read, and a star-topology snapshot builder. Deliberately not a table — it must not survive a restart and never touches `games`. See [network-map.md](./network-map.md) | `@heroes/contracts` |
| `server/schema.sql` + `migrations/*.sql` | DDL for `games`, `tiles`, `game_events`, `settlement_snapshots`, `resource_transactions`, `game_assets`, `unit_types` + counter columns | — |

---

## 4. `shared/` — engine-neutral code (both sides import this)

| Module | Role | Depends on |
|---|---|---|
| `shared/types.ts` | Engine-neutral primitives: `Axial`, `axialRound`, `hexDistance`, identity types (`PlayerId`, `Faction`, `HeroId`, `SettlementId`, `CharterId`, `CastleLevel`, `CastleVariant`), and building/media types (`ResourceType`, `BuildingKind`, `GenerationStyle`, `BuildingDef`) | — |
| `shared/constants.ts` | `WAREHOUSE_RESOURCES` tuple (engine-neutral subset of resource keys) | — |
| `shared/rng.ts` | `mulberry32(seed)` factory — extracted from `src/core/rng.ts` so both sides share one RNG source | — |
| `shared/units.ts` | `UnitType`, `Platoon`, `PlatoonEntry`, `normalizePlatoons`, `demoPlatoonsForPlayer`; re-exports `AdvantageType` from `./combatConfig` | `./combatConfig` |
| `shared/map/terrain.ts` | `Terrain` union, `TERRAIN_COLORS`, `TERRAIN_COST` (water/mountain=∞), `isPassable` | — |
| `shared/map/resourceTiles.ts` | `ResourceType` (gold/wood/stone/iron/arcane/food), `RESOURCE_DENSITY`/`RESOURCE_YIELD`, `placeResourceTiles` (with mountain-border boost for stone/iron) | `./terrain`, `../types` |
| `shared/map/gameMap.ts` | Hex `GameMap` (small/medium/large sizes), procedural terrain blobs + hero-spawn safety; `GameMap.fromTiles` for server hydration | `./terrain`, `./resourceTiles`, `../types`, `../rng` |
| `shared/horseVariants.ts` | `HORSE_VARIANT_REGISTRY` (8 horse sprites), `HorseVariantId`, `VALID_HORSE_VARIANTS` | — |
| `shared/styleResolver.ts` | `BUILDING_SPRITE_KEYS`, `pickStyleForBuilding(kind, level, preferred)` | `./types` |
| `shared/gameState.ts` | **Stepping-stone barrel.** Re-exports `tradeResources`, `applyEndOfTurnDetailed`, `WAREHOUSE_RESOURCES`, and `AutoTradeTransfer` from `src/state/gameState` so the API server can import server-safe entry points without depending on client-only modules. (Eventually folded into `src/state/` once server-only side effects are pruned.) | `../src/state/gameState`, `./constants` |
| `shared/settlementTypes.ts` | Domain state types extracted from `src/state/gameState.ts`: `SettlementState`, `UpgradeState`, `Warehouse`, `WarehouseResource`, `BuildingRef`, `CharterPhase`, `CharterState`. Imported by both client (entities/settlement, economy/*) and the stepping-stone barrel so settlement-domain shapes are not pulled through `src/state/gameState`. | — |
| `shared/combatConfig.ts` | Tunables: `TYPE_TRIANGLE`, advantage multipliers, retreat loss, grid/row defaults, `RANGED_ATTACK_RANGE` | — |
| `shared/combat/types.ts` | `BattleSide`, `BattleHex`, `BattleGrid`, `Combatant`, `CombatantOutcome`, `BattleResult`, `BattleSnapshot`, `ResolveBattleOptions` | `../types`, `../units` |
| `shared/combat/damage.ts` | Pure math: `typeMultiplier`, `computeDamage` (effAttack²/(effAttack+effDefense) × adv × mod), `applyCasualties`, `applyRetreatLoss`; plus the UI-facing estimators `totalHealth` and `estimateWinChance` (used by `views/platoonInfoPopup.ts`) | `../units`, `../combatConfig` |
| `shared/combat/grid.ts` | `makeBattleGrid` (random obstacles via `mulberry32`), `deploymentPosition`, `columnOf`. Cells are generated in **odd-r offset** coordinates (`q = col - floor(r/2)`) so the pointy-top mapping produces a true rectangle instead of a rhombus — this changes only *which* axial cells exist, not the coordinate system, so `hexDistance`, the six neighbours, movement BFS and line-of-sight are unaffected. `deploymentPosition` and the obstacle filter convert via `columnOf` rather than reading raw `q` | `../types`, `../rng`, `../combatConfig` |
| `shared/combat/resolveBattle.ts` | Auto-resolver: turn loop, counterattack chains, retreat policies; exports `buildCombatants`, `resolveAttack`, `buildResults` | `../units`, `../combatConfig`, `./grid`, `./damage`, `./types` |
| `shared/combat/manualBattle.ts` | HoMM3-style interactive engine: `startManualBattle`, `movePlatoon`/`attackWithPlatoon`, BFS movement range, line-of-sight, `runAiTurn`, `retreatHero`, `finalizeManualBattle`, `timeOfDayForRound`. **Approach-hex targeting:** `getApproachHexes(state, actor, target)` returns the hexes an actor can strike a target from (one `movementCosts` lookup covers bounds, passability, occupancy and remaining budget; the actor's own hex comes back at cost 0 when already adjacent), and `attackFromHex` moves + attacks as one validated action, delegating to `movePlatoon`/`attackWithPlatoon`. Both are **melee-only** — ranged platoons shoot from where they stand | `../types`, `../units`, `../combatConfig`, `./grid`, `./resolveBattle`, `./types` |
| `shared/combat/index.ts` | Barrel re-export | (all above) |
| `shared/validation/gameIntegrity.ts` | Cross-process game-state invariant checks (used by both client and server) | `../types`, `../combatConfig`, `../units` |

### 4.1 `shared/validation/`

| Module | Role | Depends on |
|---|---|---|
| `shared/validation/gameIntegrity.ts` | Structural check for a persisted game row. `validateGameRow(row)` returns `IntegrityIssue[]` — **`error`** = malformed in a way `hydrateGameState` can't safely paper over (bad cross-references, wrong shapes: duplicate/unknown player ids, hero/settlement key ≠ `.id`, `ownerId` matching no player, non-finite `q`/`r`, settlement `level` outside 1–3); **`warning`** = a field `hydrateGameState` silently defaults on load (missing `day`, `movementRemaining`, `troops`, `stacks`, `warehouse` entries, roster arrays referencing absent ids). `isHealthy(issues)` = no errors. Consumed by `server/routes.ts` | `../../src/state/gameState` |

---

## 5. `src/` — client SPA

### 5.1 `src/main.ts`
- Orchestrator entry. Constructs `GameEngine`, wires home view callbacks (`onNewGame`, `onLoadGame`), starts rAF loop.

### 5.2 `src/core/` — pure utilities (no I/O)
| Module | Role | Imports |
|---|---|---|
| `hex.ts` | Axial-hex primitives: `HEX_SIZE=32`, `axialToPixel`/`pixelToAxial`, `axialRound`, `hexCorners`, `hexDistance`. Also the **canonical** `HEX_DIRECTIONS` (six axial vectors, edge-ordered so index `i` is the neighbour across edge `i`, whose midpoint sits at 60·`i`°) and `nearestHexEdge(cx, cy, px, py)` → edge index. These replaced two separate copies of the same vectors (`EDGE_NEIGHBORS` in `core/control.ts`, `NEIGHBOR_DIRS` in the battle engine) — add new direction math here, not in a consumer | — |
| `rng.ts` | Global LCG `rng()` — local, deliberately non-deterministic client-only randomness (AI wander, decorative city-grid placement). Re-export shim for `mulberry32(seed)` (definition now lives in `@heroes/engine`) | `@heroes/engine` |
| `eventBus.ts` | Typed pub/sub singleton (`bus.on`/`emit`/`clear`) | — |
| `eventRegistry.ts` | `registerAllListeners()` hook (placeholder) | `./eventBus` |
| `events.ts` | `GameEvent` discriminated union (`state:committed`, `turn:ended`, `phase:changed`, `hero:moved`, `settlement:captured`, `battle:resolved`, economy/morale, calc:vision/control/heroSpeed, `command:rejected`) | `../../shared/types`, `../state/gameState` |
| `cityGrid.ts` | Diamond-grid math for city view (`TILE_W=96`, `TILE_D=48`); `cellToScreen`/`screenToCell`, `cellsInDrawOrder` | — |
| `citySpots.ts` | `generateCitySpots` places 3/6/9 resource veins + mines for 5/10/15 city sizes | `../../shared/types`, `./cityGrid` |
| `control.ts` | `controlRange`, `settlementRateRadius`, `controlledPositions`, `territoryBoundaryEdges` (edge walk reads `HEX_DIRECTIONS` from `./hex`) | `./hex`, `../../shared/types` |
| `buildingRegistry.ts` | Master `REGISTRY` of 13 building kinds (townHall, house, tower, mageGuild, mine, market, barracks, smithy, apartment, farmField, farmhouse, archeryRange, granary) — placement/upkeep/effects | `../../shared/types` |
| `buildingModifiers.ts` | `computeSettlementBonuses`/`computePlayerBonuses` aggregators | `../../shared/types`, `./buildingRegistry` |

### 5.3 `src/state/` — authoritative game state (pure reducers)
| Module | Role | Imports |
|---|---|---|
| `gameState.ts` | **Core reducers.** Types (`Player`, `HeroState`, `GameState`) and **all pure reducers** (`selectHero`, `startMove`, `captureSettlement`, `startBattle`, `endBattlePhase`, `endTurn`, `transferGold`, `tradeResources`, `applySettlementConsumption`, `applyEndOfTurnDetailed`, `advanceRound`, charter flow, upgrade flow, `recruitHero`); re-exports `WAREHOUSE_RESOURCES` and identity/building types from `shared/types`. `SettlementState`/`CharterState`/etc. were moved to `shared/settlementTypes.ts` so domain shapes are not transitively pulled through this file. | `./units`, `../economy/consumption`, `../entities/settlement`, `./settings`, `../economy/settlementRates`, `../../shared/types`, `../../shared/styleResolver`, `../../shared/constants`, `../../shared/settlementTypes`, `../core/buildingRegistry` |
| `turnController.ts` | **Stateful wrapper.** Wraps every reducer; broadcasts `bus` events; `tick(dtMs)` runs AI turn (`pickAiMove`→`startMove`→`onAiMove`); `endHumanTurn` runs full pipeline; persists across moves | `./gameState`, `../core/eventBus`, `../map/pathfinding`, `../core/hex`, `./units`, `../map/gameMap`, `../economy/settlementRates`, `./settings`, `../core/citySpots`, `../core/cityGrid` |
| `units.ts` | Re-export shim: `UnitType`, `AdvantageType`, `Platoon`, `PlatoonEntry`, `ARMY_STACK_SLOTS`, `MAX_PLATOON_ENTRIES`, `emptyPlatoon`, `normalizePlatoons`, `platoonsHaveTroops` (definitions live in `@heroes/engine`); local `demoPlatoonsForPlayer()` (client-only fixture data) | `@heroes/engine`, `@heroes/contracts` |
| `settings.ts` | `HorseVariant` (8), `ResourceStyle` (8), `GameSettings` (move duration, sprite variant, building upgrade confirm, etc.); localStorage-persisted singleton `settings()` | `../../shared/horseVariants` |
| `playerColors.ts` | `PLAYER_COLORS` (10), `MAX_PLAYERS`, `colorForOwner` | — |

### 5.4 `src/entities/` — animated runtime objects
| Module | Role | Imports |
|---|---|---|
| `hero.ts` | `Hero` class — animation state (fromTile/toTile/moveProgress/pixelOffset), eased movement, `faction`, `horseVariant`; `toGameState`/`fromGameState` | `../core/hex`, `../state/gameState`, `../state/units`, `../state/settings` |
| `settlement.ts` | `Castle` class (level 1–3, warehouse, pop, morale, buildings, `upgrade`); `castlesFromGameState`, `castleAt` | `../../shared/types`, `../../shared/settlementTypes` |

### 5.5 `src/map/` — world model
| Module | Role | Imports |
|---|---|---|
| `terrain.ts` | Re-export shim: `Terrain`, `TERRAIN_COLORS`, `TERRAIN_COST`, `isPassable` (definitions live in `shared/map/terrain.ts`) | `../../shared/map/terrain` |
| `resourceTiles.ts` | Re-export shim: `RESOURCES`, `RESOURCE_DENSITY`, `RESOURCE_YIELD`, `placeResourceTiles`, `ResourceType`, `ResourceTile` (definitions live in `shared/map/resourceTiles.ts`) | `../../shared/types`, `../../shared/map/resourceTiles` |
| `gameMap.ts` | Re-export shim: `GameMap`, `MAP_SIZES`, `MapSize`, `TileRow` (definitions live in `shared/map/gameMap.ts`) | `../../shared/map/gameMap` |
| `pathfinding.ts` | A* over axial neighbors with terrain costs; `findPath`, `computePathCost` | `../core/hex`, `./gameMap`, `./terrain` |
| `castlePlacement.ts` | `generateCastles(map, opts)` — picks hexes avoiding edge-buffer + min-spacing; assigns owner + level 1/2/3; `defaultCastleSeedFromMapSeed`, `playerCastle`, `aiCastle` | `../core/rng`, `../entities/settlement`, `./gameMap`, `./terrain` |

### 5.6 `src/economy/` — math
| Module | Role | Imports |
|---|---|---|
| `consumption.ts` | `foodRequired` (1 unit per 100 pop), `buildingUpkeepRequired`, `foodDeficitRatio`, `moraleDecay`, `effectiveIncome`, `clampMorale`, `clampWarehouseNonNegative` | `../../shared/types`, `../../shared/settlementTypes`, `../core/buildingRegistry` |
| `income.ts` | Per-settlement `settlementIncome`, `playerIncome`, `playerWealth` | `../state/gameState`, `../core/buildingRegistry` |
| `settlementRates.ts` | `POP_BY_LEVEL`, `SETTLEMENT_GOLD_TAX`, name generators, `computeSettlementRates` (sums `RESOURCE_YIELD` over level-radius ring) | `../../shared/types`, `../map/gameMap`, `../map/resourceTiles`, `../entities/settlement`, `../core/control` |

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
| `api.ts` | Typed `fetch` wrappers (`health`, `listGames`, `getGame`, `createGame`, `patchGame`, `logEvent`, `getTiles`, `endTurn`, `spendMovement`, `resolveBattle`, `transferGold`, `tradeResources`, `reportTelemetry`, `getTopology`) with `apiFetch(url, init, timeoutMs)` + AbortController; re-exports shared types | `../core/hex`, `../map/terrain`, `../map/resourceTiles`, `../state/gameState`, `../../shared/combat/types` |
| `auth.ts` | localStorage-backed auth state (`heroesJs.authToken`/`authEmail`); `requestLoginCode`, `verifyLoginCode`, `checkSession`, `logout`, `authHeader` | `./api` |
| `assetApi.ts` | `fetchAssetList`, `fetchAssetBlob`, `assetUrl(key)`, `uploadAsset`, `deleteAsset`, `batchUpload` against `/api/assets*` | — |
| `userGames.ts` | localStorage cache `heroesJs.userGames` (recent games w/ `lastSeenAt`) for home screen | — |
| `multiplayerSync.ts` | **Polling** multiplayer client (no sockets). `MultiplayerSync.start(gameName, intervalMs = 2000)` polls `api.getGame` on a `setInterval`, hydrates each row and emits `mp:stateChanged` on the bus every tick (carrying `prev`/`next`/`serverActivePlayerId`), plus `mp:turnStarted` when `activePlayerId` changes between polls. Claims seat 0 in memory if the lobby shows it claimed and no local id is set. Singleton via `getMultiplayerSync()`; a failed poll warns and returns rather than stopping the timer. Also instruments each poll for the dev Network Map — real RTT around the `fetch`, UTF-8 response byte size, and ok/failed — reporting it to `/api/games/:name/telemetry` and emitting `mp:topologyUpdated` with the aggregated snapshot. That reporting is best-effort: it swallows its own errors and never delays or fails a poll (see [network-map.md](./network-map.md)) | `./api`, `../game/initState`, `../core/eventBus`, `../players/localPlayer` |
| `debugCommands.ts` | Attaches `window.__gameDebug` for manual poking (`endTurn`, `requestMove`, `enterBattle`, etc.) and exposes `__gameDebug.events` (`subscribe`/`getEntries`/`stats`/`clear`/`setCapacity`) backed by the `EventLog` | `../state/gameState`, `../map/pathfinding`, `../map/terrain`, `../core/hex`, `../debug/eventLog` |

### 5.10 `src/render/` — drawing pipeline
| Module | Role | Imports |
|---|---|---|
| `camera.ts` | `Camera` — pan, `zoomAt(screenX, screenY, factor)` anchored under cursor, `apply(ctx)` w/ DPR | — |
| `palettes.ts` | `GenerationStyle` alias, `RESOURCE_PAL`, `BUILDING_PALETTES` | `../map/resourceTiles`, `./buildingStyles` |
| `buildingStyles.ts` | `BUILDING_STYLE_REGISTRY` of 5 styles (classic/blocky/crystalline/organic/industrial) | — |
| `buildingStyleResolver.ts` | `BUILDING_SPRITE_KEYS`, `pickStyleForBuilding(kind, level, preferred)` | `../../shared/styleResolver` |
| `horseVariants.ts` | `HORSE_VARIANT_REGISTRY` of 8 horse sprites (bubbly, shadow, paladin, ranger, arcane, unicorn, samurai, hero) | `../../shared/horseVariants` |
| `assetDescriptors.ts` | 650-line registry: imports 90+ PNGs via Vite `?url`; exports `CASTLE_SPRITES`, `SETTLEMENT_BANNERS`, `HERO_BANNERS`, `RESOURCE_*`, `BUILDING_SPRITES` | `../entities/hero`, `../../shared/types`, `../map/resourceTiles`, `../state/settings`, `../../shared/horseVariants`, `../../shared/styleResolver`, `../resources/*` |
| `assetSource.ts` | `SpriteSource` interface + 5 impls (`ImageSpriteSource`, `OnDemandSpriteSource`, `ProceduralSpriteSource`, `CompositeSpriteSource`, `VariantAwareSource`, `ApiSpriteSource`) | — |
| `assets.ts` | `SpriteProvider` + `createDefaultProvider(proceduralDrawers)` (composite + variant-aware) | `./assetDescriptors`, `./assetSource`, `../state/settings` |
| `heroSprites.ts` | ASCII-art `drawKnightSprite`/`drawDemonSprite` procedural fallback | `./assetSource` |
| `sprites.ts` | `drawCastleSprite`, `drawResourceIcon`, `drawHeroSprite` (w/ scale-Y animation), `drawHorseSprite`, `drawWithDescriptor`; exports `HERO_PROCEDURAL_DRAWERS` | `../entities/hero`, `../../shared/types`, `../map/resourceTiles`, `../state/settings`, `./assets`, `./assetDescriptors`, `../../shared/horseVariants`, `./heroSprites` |
| `fog.ts` | `computeVision(heroes, castles, viewPlayerId)`, `isVisible`; `VISION_RANGE=4` | `../entities/hero`, `../entities/settlement`, `../core/hex`, `../core/control` |
| `minimap.ts` | `drawMinimap` (animated mist + fog edges); `MinimapCamera` class moved to `./minimapCamera` to break the minimap ↔ renderer cycle | `./minimapCamera`, `../entities/hero`, `../map/gameMap`, `../map/terrain`, `./overlays/pathOverlay`, `./fog`, `../core/hex` |
| `cityBuildingDraw/types.ts` | `BuildingKind` union (13), `BuildingDef`, `DrawBuildingContext` | `../../../shared/types` |
| `cityBuildingDraw/primitives.ts` | `coversCell`, `buildingFootprint`, `lighten`/`darken`, `buildingHeight`, `drawIsoBox` (3-face iso), `getOpts` | `../../core/cityGrid`, `../../core/buildingRegistry`, `./types` |
| `cityBuildingDraw/{classic,blocky,crystalline,organic,industrial}.ts` | One procedural renderer per style | shared `primitives`/`types`/`palettes` |
| `cityBuildingDraw/spots.ts` | `drawSpot`, `drawMine` | `./types`, `./primitives`, `../palettes`, `../assets` |
| `cityBuildingDraw.ts` | `STYLE_DRAW_FNS` orchestrator; `OffscreenBuildingCache` per style/kind/level/color; `drawBuilding()` prefers sprite → cached offscreen → `drawBuildingFromContext`; `drawTownHall`, `clearOffscreenBuildingCache` | (all sub-files) `./palettes`, `./assets`, `./assetDescriptors`, `./buildingStyles` |
| `cityBuildingGen.ts` | `generateBuildings(config)` with 6 layout patterns (denseUrban/sparseRural/radial/grid/clustered/sampler) + style enrichers | `./cityBuildingDraw`, `../core/cityGrid`, `../core/buildingRegistry`, `./buildingStyles` |
| `cityRenderer.ts` | `drawCityView(ctx, opts)` — skybox (cached variants), iso grid, resource spots/mines, ordered building draw, selection highlight, ghost placement, header text | `../core/cityGrid`, `../map/resourceTiles`, `./assets`, `./cityBuildingDraw`, `../core/buildingRegistry`, `./assetDescriptors`, `../state/settings` |
| `overlays/pathOverlay.ts` | `computeReachableSplit`, `drawPathSegment`, `drawTrail`, `drawPathOverlay` (yellow split-line + dots), `drawMinimapPath` | `../../core/hex`, `../../entities/hero`, `../../map/gameMap`, `../../map/terrain`, `../renderer`, `../minimap`, `../minimapCamera`, `../renderTypes` |
| `overlays/resourceIcon.ts` | Iterates map resource tiles in vision → `drawResourceIcon` | `../../map/gameMap`, `../../core/hex`, `../sprites`, `../assets` |
| `overlays/territoryOutline.ts` | `drawTerritoryOutlines` — partitions controlled hexes by nearest owner castle → colored Voronoi-style boundary edges | `../../entities/settlement`, `../../core/control`, `../../core/hex`, `../../state/settings` |
| `renderer.ts` | **Main per-frame world map orchestrator.** Exports `MapRenderer` (renamed from `Renderer` 2026-08-18). Owns the camera `save`/`apply`/`restore` and the per-frame painter-call order; delegates every paint call to a per-kind class under `./painter/`. Frame-option / minimap-geometry types live in `./renderTypes`; `MinimapCamera` from `./minimapCamera`. Public surface (`new MapRenderer(ctx, map, camera, sprites, minimapCamera)`, `.draw(hover, heroes, path, castles, opts)`, `.hoverFromScreen(x, y)`, `.map` field) is byte-equivalent to the previous `Renderer` | `../core/hex`, `./camera`, `./sprites`, `../entities/hero`, `../entities/settlement`, `../map/gameMap`, `./assets`, `./fog`, `./minimap`, `./renderTypes`, `./minimapCamera`, `./painter/*` |
| `painter/BackgroundPainter.ts` | Initial `#0a0a0a` full-viewport fill before any other painter runs | (none) |
| `painter/HexTerrainPainter.ts` | Per-tile hex fill, terrain decoration (forest/water/desert/mountain glyphs), and per-tile fog overlay when the hex is outside `visible` | `../../core/hex`, `../../map/gameMap`, `../../map/terrain`, `../fog`, `../decorationSeed` |
| `painter/HexHoverPainter.ts` | Yellow `#ffcc00` outline on the hex under the cursor, vision-gated | `../../core/hex`, `../fog` |
| `painter/HeroPainter.ts` | Hero sprite (bobbing math, variant branching between `drawHeroSprite`/`drawHorseSprite`), owner color dot, selection ring. Owns the only animation math (`bobAmplitude`/`phase`/`scaleY`) that was inline in `Renderer.draw()` | `../../core/hex`, `../../entities/hero`, `../sprites`, `../assets`, `../fog`, `../renderTypes` |
| `painter/CastlePainter.ts` | Castle sprite + owner-colored selection border (the dash pattern for unowned castles lives here). Combines the previous inline castle loop + private `drawCastleBorder` helper | `../../core/hex`, `../../entities/settlement`, `../sprites`, `../assets`, `../fog`, `../renderTypes` |
| `painter/CharterPainter.ts` | `activeCharters` per-charter hex outline + `constructing`-phase inner ring + `validCharterHexes` per-tile dashed outline. Combines the previous private `drawCharterOverlays` + `drawValidCharterHexes` | `../../core/hex`, `../../state/gameState`, `../fog` |
| `scene/types.ts` | *(Phase 5 Track B, in progress — not wired into the live render path)* `SceneNode` discriminated union (`terrainHex`, `fogHex`, `resourceIcon`, `castle`, `hero`, `cityCell`, `cityBuilding`, `citySkybox`, …) + `WorldPoint`. The eventual shared output type for pure scene builders and a future Canvas2D/WebGL painter | `../map/terrain`, `../map/resourceTiles`, `../entities/hero`, `../state/settings`, `@heroes/contracts` |
| `scene/sceneBuilder/adventureScene.ts` | `buildAdventureScene()` — faithful pure decomposition of `renderer.ts`'s `Renderer.draw()` into `SceneNode[]`. Takes the same `Hero[]`/`Castle[]`/`GameMap` inputs `Renderer.draw()` takes today, not raw `GameState` | `../../../core/hex`, `../../../map/gameMap`, `../../../entities/hero`, `../../../entities/settlement`, `../../renderTypes`, `../../fog`, `../../overlays/pathOverlay`, `@heroes/engine`, `../types` |
| `scene/sceneBuilder/cityScene.ts` | `buildCityScene()` — same treatment for `cityRenderer.ts`'s `drawCityView()`. Skybox image loading/caching/parallax stays a future `paint2d` concern; the `citySkybox` node only carries the resolved variant/parallax decision | `@heroes/engine`, `@heroes/contracts`, `../../../core/cityGrid`, `../../../map/resourceTiles`, `../../../state/settings`, `../../buildingStyles`, `../../cityBuildingDraw/primitives`, `../types` |
| `scene/sceneBuilder/battleScene.ts` | `buildBattleScene()` — same treatment for `manualBattleArena.ts`'s `draw()`/`renderPixelFor()`. Unlike `adventureScene.ts`/`cityScene.ts`, there's no `Hero`-style ticked class resolving animation timing before the builder runs, so it takes an explicit `nowMs` field and resolves moveAnim/impact/floating-text progress itself | `../../../core/hex`, `@heroes/engine`, `../types` |
| `scene/entityMirror.ts` | `EntityMirror` — the visual `Hero[]`/`Castle[]` tween cache. `bootstrap(state)` hard-resyncs from `GameState`; `applyEvent(event)` handles `HeroMoved` (tween) and `SettlementCaptured` (owner) with every other `EngineEvent` a documented no-op for now; `update(dtMs)` ticks tweens. Meant to replace `GameEngine.ts`'s wholesale rebuild-on-`state:committed` pattern once Track 5.A's event-cursor stream exists — not wired in yet | `../../entities/hero`, `../../entities/settlement`, `@heroes/contracts` |
| `scene/paint2d/` | `paintScene(ctx, nodes, deps, frame?)` — Canvas2D dispatcher shell for `SceneNode[]`. Currently switches on `node.kind` and dispatches to 28 stub per-kind painters (no Canvas behavior yet); the real 1:1 transcription per kind lands in follow-up commits. The Vite-`?url` seam is enforced here: `paint2d/` declares a `Paint2DDep` interface (`deps.ts`) with four per-kind sprite resolvers (`resolveSpriteForResource/Hero/Building/Castle`) + `SkyboxProvider` + state getters + `colorForOwner`/`battleAccent`/`fontFamily`/`charterStyle`, so the painter never names a key string, never reads `settings()` directly, and never imports `assetDescriptors.ts`/`assets.ts`/`sprites.ts`/`cityRenderer.ts`/`cityBuildingDraw.ts` (the barrel). Color constants live in `colors.ts`; shared geometry helpers (`hexPath`, `diamondPath`) in `geometry.ts`. The boundary is enforced by dependency-cruiser rules `paint2d-cannot-import-asset-descriptors` and `paint2d-cannot-value-import-state`, plus the runtime seam test `test/render/paint2d.seam.test.ts`. Wired into `manualBattleArena` via `arena/paint.ts`'s `paintSceneForArena()` behind the `useSceneBuilder` URL flag (`?paint=scenebuilder`); the orchestrator passes `drawLegacy()` as the fallback so the visual stays byte-identical to pre-CB-4 while every battle-kind painter is still a no-op stub. `Renderer`/`drawCityView` not wired yet | `../types`, `../../../core/hex` (current shell); per-kind bodies will pull from leaf-clean helpers (`../../palettes`, `../../cityBuildingDraw/primitives` + per-style leaves, `../../heroSprites`) — no Vite-`?url` coupling ever reaches the painter |

### 5.11 `src/managers/` — high-level orchestrators
| Module | Role | Imports |
|---|---|---|
| `GameEngine.ts` | **Top-level orchestrator.** Holds `spriteProvider`, `view`, `ui`, `actions`, `sessions`, `state`, `eventLog`; wires `initProviders/initGameState/initRendering/initUI/initInput/initDebug/initEventListeners`; `initGameState` calls `attachEventLog()` and wraps the built `turnHooks` before `setHooks`; `initDebug` forwards `eventLog` into `attachDebugApi` for `__gameDebug.events`; drives `loop(now)`, `fullFrame()`, `draw()`, charter placement, dbl-click city open, click handlers | `../map/gameMap`, `../render/assets`, `../render/sprites`, `../core/rng`, `../views/adventureView`, `../state/playerColors`, `../game/initState`, `../game/turnHooks`, `../core/cityGrid`, `../core/hex`, `../state/gameState`, `./SessionManager`, `./GameStateManager`, `./ViewManager`, `./UIManager`, `./GameActions`, `./GameSessionManager`, `../io/debugCommands`, `../core/eventBus`, `../core/eventRegistry`, `../debug/eventLog` |
| `GameStateManager.ts` | Owns `gameState`, `turnController`, `heroes`/`settlements` dicts, `gameMap`, `pathPreviewLock`; `setState`/`replaceState` rebuilds TurnController; `rebuildHeroesFromState`/`rebuildSettlementsFromState`/`syncHeroVisualsToState`; `update(dt)` ticks animations + turn controller | `../state/gameState`, `../entities/hero`, `../entities/settlement`, `../map/pathfinding`, `../map/gameMap`, `../state/turnController`, `../core/hex`, `../core/eventBus` |
| `ViewManager.ts` | Owns `Camera`, `MinimapCamera`, `Renderer`, `AdventureView`; `initializeRenderer`/`initializeAdventureView`/`updateMap`/`draw`/`drawCityOverlay`/`centerOn`/`resize`/`getHover`/`getPath`/`hoverFromScreen`. Resolves views through `../views/viewLauncher` rather than direct cross-imports | `../render/camera`, `../render/renderer`, `../render/minimap`, `../render/minimapCamera`, `../map/gameMap`, `../entities/hero`, `../entities/settlement`, `../views/adventureView`, `../views/viewLauncher`, `../render/assets`, `../core/hex`, `../views/cityView`, `../state/gameState` |
| `UIManager.ts` | Owns HUD, Toolbar, HeroInfoMenu, HeroRosterMenu, SettlementRosterMenu, SettlementInfoMenu, CityView; `initToolbar/initHeroMenu/initSettlementInfo/initCityView`, `refreshHud`, `buildCalendarSnapshot`. Resolves views through `../views/viewLauncher` | `../views/viewLauncher`, `../state/gameState`, `../entities/hero`, `../render/assets`, `../economy/income`, `./SessionManager`, `./GameStateManager`, `./ViewManager`, `../views/settingsMenu` |
| `SessionManager.ts` | Active game id/name, backend health, save status; `init()`, `manualSave()`, `createGame`, `getTiles`, `logEvent`, `getLatestGames` | `../io/api`, `../io/userGames` |
| `GameSessionManager.ts` | Bridges `SessionManager` ↔ `GameStateManager` ↔ `ViewManager`; `loadGame`, `handleManualSave`, `handleNewGame`, `createFreshStarter`, `initBackend` | `../map/gameMap`, `../economy/income`, `../state/gameState`, `../game/initState`, `../map/castlePlacement`, `../data/unitCatalog`, `../views/adventureView`, `../io/api` |
| `GameActions.ts` | Game-flow actions: `syncFromController`, `maybeAutoResolveBattle`, `startBattleFlow` (calls `showBattleModal`), `handleEndTurn` | `./GameStateManager`, `./SessionManager`, `../views/battleModal` |

### 5.12 `src/views/` — UI panels (mostly DOM, some canvas)
| Module | Role | Imports |
|---|---|---|
| `menu.ts` | Generic popup primitives: `menuTheme`, `styleButton`/`styleInput`, `PopupMenu` class (draggable, closeable, setContent/appendContent/clearContent/setPosition), `openCenteredModal` | — |
| `viewLauncher.ts` | View registration registry: views register themselves (show/hide/refresh hooks) here at module load so consumers reach them through a single entry point instead of direct cross-imports. Used today by `developerSettingsMenu.ts`, `manualBattleArena.ts`, `settingsMenu.ts`, and `testBattleSetup.ts` to break the dev-settings → test-battle → manual-arena → settings-menu cross-import cycle | — |
| `homeView.ts` | Home overlay: New/Load/Settings/Sign-In modals, `userGames` remember; hosts `newGameScreen` and launches `multiplayerLobby` | `../io/api`, `../io/userGames`, `../io/auth`, `./menu`, `./settingsMenu`, `./newGameScreen`, `./multiplayerLobby` |
| `newGameScreen.ts` | Full-screen **Create Game** panel hosted by `homeView` (replaces the landing button stack while the form is open). Fields: Name, Map Size (3 named presets, dropdown), Number of Human Players (1–4 chip selector), Map Seed (defaults to a fresh random 31-bit int, user-editable). `createNewGameScreen(opts)` → `{ root, setBusy, showError, clearError, destroy }`; the caller supplies `onCreate(values)`/`onCancel` and an `isBackendOk` gate | `./menu` |
| `multiplayerLobby.ts` | LAN lobby modal. Create-or-join flow over `POST /games/:name/lobby/claim` + `/lobby/start`: seat grid (2/3/4 seats) built by `snapshotFromGame` from the row's `lobby.claimed` map, colored via `PLAYER_COLORS`, default game name `lan-<YYYY-MM-DD>-<hex>`. Persists the claimed seat through `players/localPlayer` (both localStorage and in-memory) so `multiplayerSync` knows which seat is ours | `../io/api`, `./menu`, `../state/playerColors`, `../players/localPlayer` |
| `adventureView.ts` | **Main map view:** mouse drag/wheel/touch-pinch, hover tracking, path preview, click-to-move/adjacent-enemy/settlement, charter modal; `MAP_SEED=42` | `../core/hex`, `../render/camera`, `../map/gameMap`, `../render/renderer`, `../entities/hero`, `../map/pathfinding`, `../state/gameState`, `../state/turnController`, `../render/overlays/pathOverlay`, `../managers/GameStateManager`, `./menu`, `../render/minimap` |
| `cityView.ts` | Full-screen city build view: keyboard (B/Esc/Delete/1–5 styles/!@#$%^ patterns/R reroll); mouse→grid picking; place/destroy/select modes; `TurnController.startBuildingUpgrade`; persists on close; wires `BuildingPlacer`, `BuildingMenu`, `BuildingSelectionMenu`, `CityDesignBoxManager` | `../core/cityGrid`, `../render/cityRenderer`, `../map/resourceTiles`, `../render/assets`, `../render/cityBuildingDraw`, `../render/cityBuildingGen`, `./buildingMenu`, `./buildingPlacer`, `./buildingSelectionMenu`, `./confirmDialog`, `../state/settings`, `../state/gameState`, `../core/buildingRegistry`, `./CityDesignBoxManager` |
| `CityDesignBoxManager.ts` | Pure-DOM bottom-left "City Design" panel (Build/Generate/Back) while a city view is open (moved from `src/managers/` to `src/views/`) | — |
| `hud.ts` | Status line: round, wealth, morale, effective income, upkeep, save time | `../state/gameState`, `../economy/consumption`, `../economy/income` |
| `toolbar.ts` | Top toolbar: New/Save/Load + calendar chips (Day/Week/Month/ActivePlayer) + End Turn/Heroes/Settlements/Charter/Test Battle | `../io/api`, `../io/userGames`, `../state/gameState`, `../map/castlePlacement`, `./settingsMenu`, `./testBattleSetup`, `./menu` |
| `heroInfoMenu.ts` | Hero detail: banner, name, gold, food, movement bar, transfer buttons, stats, army grid w/ drag-drop reorder | `../state/gameState`, `../entities/hero`, `./menu`, `../state/units`, `../data/unitCatalog`, `../data/unitImages`, `../render/assetDescriptors` |
| `heroRosterMenu.ts` | Draggable heroes list (player roster) | `./menu`, `../state/gameState`, `../render/assetDescriptors` |
| `settlementInfoMenu.ts` | Settlement popup: banner, level, pop/income/treasury/morale/food, warehouse, recruit-hero, upgrade-settlement (gate-checks); `openRecruitHeroModal` (name + horse variant) | `../state/gameState`, `./menu`, `../render/assetDescriptors`, `../entities/settlement`, `../state/settings`, `../economy/settlementRates`, `../data/heroNames`, `../../shared/horseVariants` |
| `settlementPanel.ts` | All-settlements side panel: per-owner cards (pop/income/morale/food/warehouse), auto-trade toggle, Trade modal | `../state/gameState`, `../map/resourceTiles`, `./menu`, `./tradeModal` |
| `settlementRosterMenu.ts` | Active player's settlements list | `./menu`, `../state/gameState`, `../render/assetDescriptors` |
| `buildingMenu.ts` | Per-building popup (label/desc/effects/cost/upgrade/recruit) | `./menu`, `../render/cityBuildingDraw`, `../state/gameState`, `../core/buildingRegistry` |
| `buildingPlacer.ts` | Place/remove/destroy buildings; palette popup w/ build/destroy modes, cost summary, net-cost calculator | `../core/cityGrid`, `../render/cityRenderer`, `../render/cityBuildingDraw`, `./menu`, `../core/buildingRegistry`, `../render/assetDescriptors`, `../state/gameState` |
| `buildingSelectionMenu.ts` | Multi-select upgrade preview (aggregate effects, combined cost, single confirm) | `./menu`, `../render/cityBuildingDraw`, `../state/gameState`, `../core/buildingRegistry` |
| `battleModal.ts` | Tiny modal: Resolve or Flee before applying battle result | `./menu` |
| `battleResultCard.ts` | End-of-battle summary (per-side survivors/losses) | `../../shared/combat/types`, `../data/unitCatalog`, `./menu` |
| `manualBattleArena.ts` | **Fullscreen HoMM3-style arena** for Test Battle — **battlefield-first three-band layout**: status bar / battle row / action + log bar. Roster rails are 190px columns of ~33px platoon strips (specialty icon, count, HP bar; spent platoons dim); per-platoon stats live in the hover/selection info card (`platoonInfoPopup`), not on the tiles. Hex size is **solved for the available box** rather than drawn fixed and scaled down, and the canvas is 1:1 with its layout box over a DPR backing store. The engine's battle log is surfaced (collapsed to one line, expandable); unacted platoons get a gold hex outline. **Approach-hex targeting:** hovering a reachable enemy latches it and reads the approach hex off whichever sixth of its hex the cursor occupies (`nearestHexEdge`), drawn with a direction arrow; a sector pointing at a blocked or unreachable hex snaps to the nearest legal side; the latch survives the cursor moving onto one of the approach hexes, so clicking that hex directly also works. The approach branch is tested **before** the plain-attack and move branches — an approach hex is also an ordinary move-range hex, so branch order disambiguates the two meanings of the same click. Ranged platoons get their own help text (no side to choose). The **bump attack** now fires only when exactly one enemy is adjacent; with two or more the move stands and the click picks the target. The AI turn is **stepped on a timer** (telegraph the acting platoon with a white ring ~320ms, then resolve and repaint ~260ms) rather than resolved synchronously. Footer actions: End Turn, **Retreat**, **Surrender**, **⚙ Settings**. Retreat/Surrender call `retreatHero` (applyLoss true/false) → `finalizeManualBattle` → `showBattleResultCard`; Surrender costs SURRENDER_COST_GOLD (5000G) — if heroGold is insufficient, opens a Leave Behind picker (SURRENDER_UNIT_VALUE_GOLD=100 per unit) that strips the chosen counts from surviving platoons before finalize; Settings opens `openSettingsMenu({ parent: overlay })` | `../core/hex`, `../../shared/combat/damage`, `../../shared/combat/manualBattle`, `../../shared/combat/types`, `../../shared/combatConfig`, `../state/units`, `./battleResultCard`, `./confirmDialog`, `./menu`, `./platoonInfoPopup`, `./settingsMenu` |
| `platoonInfoPopup.ts` | Click/hover-anchored info card for a single platoon: composition, HP, movement left, optional specialty/stats/metrics rows, and — for an enemy — a win-odds estimate against your currently selected platoon (`estimateWinChance`). `createPlatoonInfoPopup(container)` → `{ show, hide }`. Deliberately a dumb render+placement component: the **caller** decides which side of the anchor counts as "behind the line" (away from the opposing army); this file just draws the card there and clamps it on-screen | `../../shared/combat/damage`, `../../shared/combat/types`, `../state/units`, `./menu` |
| `testBattleSetup.ts` | Test Battle entry modal: Blue/Red side pick, player preset + AI roster (Reroll), Start → `openManualBattleArena` | `../combat/testArmies`, `../data/unitCatalog`, `../../shared/combat/types`, `../state/units`, `./menu`, `./manualBattleArena` |
| `assetManager.ts` | Dev modal: list/upload/download/delete assets via `assetApi` | `./menu`, `../io/assetApi` |
| `developerSettingsMenu.ts` | Dev menu: event-bus inspector, Asset Manager launch, Test Battle launch, Dev Console launch (reads `__gameDebug.eventLog`) | `./menu`, `../core/eventBus`, `./assetManager`, `./testBattleSetup`, `../debug/devConsole` |
| `settingsMenu.ts` | Settings UI: Map Info + Game + Population + Confirmations + Visual sections (sliders → `updateSettings`), Reset, Developer Settings link | `./menu`, `../state/settings`, `./developerSettingsMenu` |
| `tradeModal.ts` | Move resources between settlements (gold cost, amount cap) | `../state/gameState`, `./menu` |
| `confirmDialog.ts` | Generic confirm/cancel dialog | `./menu` |
| `src/screens/shared/toast.ts` | Bottom-right dismissible/auto-expiring toast notifications (`showToast(message, kind, durationMs)`, z-index above every modal). `attachCommandFailureToasts()` — explicit-attach, called once from `GameEngine.initEventListeners()`, mirroring `debug/eventLog.ts`'s `attachEventLog()` convention — subscribes to the bus's `command:rejected` event and shows "`{action}` failed: `{reason}`", so a rejected fire-and-forget turn-hook command (#100) surfaces to the player instead of only a `console.warn` | `../../core/eventBus` |

### 5.13 `src/game/` — bootstrap + turn wiring
| Module | Role | Imports |
|---|---|---|
| `initState.ts` | `buildInitialGameState` (client-side factory using `generateCastles` + `computeSettlementRates` + city spots), `makeInitialStatePayload` (server DTO), `hydrateGameState(row)` (server→client); re-exports `CASTLE_COUNT_*` | `../state/gameState`, `../state/units`, `../io/api`, `../map/gameMap`, `../map/castlePlacement`, `../entities/settlement`, `../economy/settlementRates`, `../state/playerColors`, `../core/citySpots`, `../core/cityGrid`, `../state/settings` |
| `turnHooks.ts` | `buildTurnHooks` wires client reducers to API: `onHumanTurnEnd`→`/commands` (`EndTurn`), `onAiMove`→`/commands` (`MoveHero`), `onBattleResolved`→`/commands` (`ResolveBattle`), `onTradeResources`/`onRecruitHero`/`onUpgradeTownHall`/`onSetAutoTrade`/`onReorderStack`/`onCaptureSettlement`→`/commands` (fire-and-forget, same pattern as `onAiMove` — but a rejection is no longer silent: `reportCommandFailure` emits `command:rejected` on the bus alongside the existing `console.warn`, surfaced to the player as a toast by `src/screens/shared/toast.ts` (#100)), `pickAiMove`→`aiBrain`, `logEvent`→`/events` (intercepted by `EventLog.wrapHooks` when a dev console is attached) | `../io/api`, `../state/gameState`, `../state/turnController`, `../ai/aiBrain`, `../map/gameMap`, `../core/hex`, `../core/eventBus` |

### 5.14 `src/debug/` — real-time event log + dev console
| Module | Role | Imports |
|---|---|---|
| `eventLog.ts` | `EventLog` ring buffer (`record`/`subscribe`/`getEntries`/`stats`/`clear`/`setCapacity`), `attachEventLog()` subscribes the bus + returns a `wrapHooks(hooks)` interceptor for `TurnControllerHooks.logEvent` | `../core/eventBus`, `../state/turnController` |
| `devConsole.ts` | `openDevConsole(log, opts?)` modal (filter/pause/clear/copy) and `mountDevConsoleFooter(log, opts?)` sticky bar; backed by `EventLog` subscribe | `../views/menu`, `./eventLog` |

### 5.15 `src/factions/` — static roster data ⚠️ **not yet wired**

Design-time per-faction unit roster data, distinct from the server-driven `UnitType` in `state/units.ts`: `FactionUnit` adds `hp`/`walkDistance` and a bundled unit image (imported via Vite `?url`) so each unit is fully self-described.

| Module | Role | Imports |
|---|---|---|
| `factions/types.ts` | `FactionUnit` interface: `id`, `name`, `description`, `hp`, `attack`, `defence`, `speed`, `walkDistance`, `image` | — |
| `factions/humans/{swordsman,archer,cavalry,pikeman,crossbowman,griffin}.ts` | One `FactionUnit` const per unit | `../types`, `../../resources/units/*.png?url` |
| `factions/humans/index.ts` | Re-exports each unit plus the `humanUnits: FactionUnit[]` roster | `../types`, `./*` |

> ⚠️ **Nothing imports `src/factions/` yet.** It mirrors the unit set used by the Test Battle player preset (`combat/testArmies.ts` `PLAYER_PRESET`) and is intended as the template for other factions, but the runtime still reads units from `data/unitCatalog.ts` (server `/api/units`) and `state/units.ts`. Treat it as staged data awaiting a consumer — if you're looking for the units the game actually fights with, they are **not** here.

### 5.16 `src/players/` — local seat identity

| Module | Role | Imports |
|---|---|---|
| `localPlayer.ts` | Which seat *this browser* owns in a multiplayer game. localStorage-backed under `heroes.mp.localPlayerId.<gameName>` (`get`/`set`/`clearLocalPlayerId`, each guarded against localStorage being disabled) plus a parallel in-memory `Map` (`get`/`setInMemoryLocalPlayerId`) that survives a disabled/blocked store within the session | `../state/gameState` (type-only) |

---

## 6. `test/`
- **Unit (Node `node:test`):** `cityGrid`, `citySpots`, `minimap`, `state/economy`, `state/gameState`, `state/income`, `combat/resolveBattle`, `combat/manualBattle` (includes approach-hex/`attackFromHex` coverage), `charter/start`, `charter/travel`, `charter/advance`, `charter/cleanup`, `map/castlePlacement`.
- **Playwright integration:** `smoke.ts` (full E2E spawns API+Vite, verifies New/Load/Save/HUD/DB), `multiplayer.smoke.ts` (lobby lifecycle over the API: create → claim seat → duplicate claim rejected 409 → start blocked while a seat is unclaimed → host claims → start sets `startedAt`), `cityView.test.ts`, `dragDrop.test.ts`, `proposedPath.test.ts`. `smoke`, `multiplayer.smoke`, and `cityView.test.ts` boot their server through the shared `test/_request.ts` helper, which reads `local/.test-request.json` written by `tools/run-test.mjs`.

## 7. `tools/`
FLUX-driven sprite generation pipeline (`tools/sprites/flux-*.mjs` for castles, buildings, heroes, resources, horse variants, farms, market variants, town-hall, tower, piles, regeneration helpers), plus `pixel-gen.mjs`/`pixel-gen-pure.mjs` for pixel-art, `outline-apply.mjs`, `manifest.mjs`, `generate-preview.mjs`, `screenshot-preview.mjs`, and **`validate-assets.mjs`** (asserts every sprite key referenced by `assetDescriptors.ts` has a PNG).

## 8. `scripts/` (helpers, run by `npm` scripts or manually)
- PowerShell: `cleanup.ps1`, `dev-status.ps1`, `batch_remove_background.ps1`.
- TS/Node: `allocate-ports.ts` (OS-assigned port allocator via `net.Server.listen(0)`; replaces the old `ports.ps1`), `seed-assets.ts` (bulk-insert `src/resources/*` PNGs into `game_assets`), `capture-path.ts` (Playwright path debug screenshots).
- Python: `remove_background.py` (PIL flood-fill background removal).
- Hooks: `scripts/hooks/log-session-change.mjs`.

---

## 9. Key cross-cutting relationships

- **`core/`** has zero `state/`/`render/`/`views/` deps — pure math + pub/sub. Everything else depends on it.
- **`shared/`** is the engine-neutral layer both `src/` and `server/` import from. Identity/geometry/building/media types (`Axial`, `CastleLevel`, `BuildingKind`, `GenerationStyle`, `PlayerId`, etc.) live in `shared/types.ts`; `mulberry32` is in `shared/rng.ts`; `WAREHOUSE_RESOURCES` in `shared/constants.ts`; map primitives (`Terrain`, `GameMap`, `placeResourceTiles`) in `shared/map/*`. `shared/combat/*` and `shared/units.ts` are imported by both sides.
- **`state/gameState.ts`** is the **single source of truth** for game logic client-side; `turnController.ts` consumes its reducers for everything except end-turn, which is now server-authoritative end-to-end (`server/app/turnService.ts` composes `@heroes/engine`'s own `applyEndOfTurnDetailed`/`endTurn`/`advanceRound` against the DB row, not a client-submitted state — closes the settlement-upgrade and population-growth/weekly-upkeep gaps the old client-trusting `/end-turn` route left open; charter advancement is now server-authoritative too, synced into its own `charters` table via `charterRepo`).
- **`core/eventBus.ts`** is the spine connecting `TurnController` → `GameStateManager` → `ViewManager` → `UIManager`/`Renderer`.
- **`render/renderer.ts` (and its `painter/*` subclasses) is the only consumer** of `entities/Hero` + `entities/Settlement` for drawing; everything else uses `state/gameState` directly.
- **`shared/combat/*`** is the **only directory imported by both** `server/routes.ts` and `src/views/manualBattleArena.ts`.
- **`render/assetDescriptors.ts`** is the bridge from Vite-bundled PNGs (`src/resources/*`) to runtime sprite keys; `tools/sprites/validate-assets.mjs` enforces its consistency.
- **`core/buildingRegistry.ts`** is referenced from both logic (`state/gameState`, `economy/*`) and rendering (`render/cityBuildingDraw`, `views/buildingMenu`) — it's the canonical building definition.
- **`io/api.ts`** is the **only file that knows the HTTP shape**; every manager calls into it via `SessionManager`/`GameSessionManager`/`turnHooks`.
- **Multiplayer is poll-based, not push.** `io/multiplayerSync.ts` re-fetches the whole game row on a 2s interval and republishes it as `mp:stateChanged`/`mp:turnStarted` bus events — there is no socket and no delta protocol. Seat identity lives in `players/localPlayer.ts`; the server side of it is the `lobby` jsonb column driven by `views/multiplayerLobby.ts`. Started from `GameSessionManager`, consumed via `turnHooks` and `GameEngine`.
- **`shared/validation/gameIntegrity.ts`** encodes the contract between the DB row and `hydrateGameState`: its `error`/`warning` split is exactly "hydration cannot recover" vs. "hydration silently defaults". When you add a defaulted field to `hydrateGameState`, add the matching `warning` here.
- **Direction math has two homes by design.** `core/hex.ts` holds the canonical `HEX_DIRECTIONS`/`nearestHexEdge` for `src/`; `shared/types.ts` carries its own copy of `HEX_DIRECTIONS` (alongside the pre-existing duplicated `axialRound`/`hexDistance`) so `shared/combat/manualBattle.ts` never has to import from `src/` — see the no-shared-from-src-or-server rule below. Keep the two vector arrays in sync if the ordering ever changes.
- **Dependency boundaries are machine-enforced.** `dependency-cruiser` (`npm run lint:deps`, config in `dependency-cruiser.cjs`) lints `src/`, `shared/`, and `server/` against the cross-boundary rules below. It's a precondition of `npm run test:all` for circular import detection and is part of the pre-commit gate.
  - `src/` may depend on `shared/`, but never vice versa.
  - `shared/` may not depend on `src/`.
  - `server/` may depend on `shared/` and `src/`, but no path in the other direction may reach back.
  - `core/` remains leaf-only (no `state/`/`render/`/`views/` deps) by rule, not by convention.
