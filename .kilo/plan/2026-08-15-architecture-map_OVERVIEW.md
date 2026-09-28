# heroes-js — 4-Package Architecture Map (Additions to Fable's Plan)

*Authored 2026-08-15. Extends `plan/2026-08-11-srp-module-reorganization.fable.md` §2 with the missing per-package module map, including the `managers/` decomposition (which the original plan referenced but never expanded) and the split of the `{ subscribe, apply, teardown }` contract into orthogonal `Subscribes` + `Applies` interfaces.*

---

## Dependency law (recap, unchanged from Fable)

```
@heroes/contracts   ←   @heroes/engine   ←   @heroes/client
                                  ↑
                                  └──── @heroes/server
```

Enforced by `dependency-cruiser.cjs` (Phase 0 ✅). One forbidden edge per layer crossing.

---

## `@heroes/contracts` — types and vocabulary only

**Purpose:** the wire. Zero runtime dependencies, zero logic. Every cross-package reference goes through this package; nothing else is shareable.

### `ids.ts`
Branded types so `HeroId` and `SettlementId` can't be passed where `GameId` is expected:
- `GameId`, `HeroId`, `SettlementId`, `CharterId`, `BuildingId`, `PlayerSeat`
- Branded-string and branded-number helpers (`type Branded<T, B> = T & { __brand: B }`)

### `geometry.ts`
- `Axial` (cube-coord pair), `Facing = "N" | "E" | "S" | "W"`, `MapSize = "small" | "medium" | "large"`
- No math, just shapes — the hex math lives in `engine/hex.ts`

### `resources.ts`
- `ResourceType = "wood" | "stone" | "iron" | "arcane" | "food" | "gold"`
- `WAREHOUSE_RESOURCES` (the non-gold subset), `Warehouse` interface

### `commands/` — one file per command
Each file exports exactly one discriminated-union variant, e.g.:
- `moveHero.ts` → `{ kind: "MoveHero"; heroId; path: Axial[] }`
- `endTurn.ts` → `{ kind: "EndTurn"; seat: PlayerSeat }`
- `recruitHero.ts`, `buildStructure.ts`, `tradeResources.ts`, `startCharter.ts`, `upgradeTownHall.ts`, `upgradeBuilding.ts`, `upgradeSettlement.ts`, `transferGold.ts`, `reorderStack.ts`, `selectHero.ts`, `selectSettlement.ts`, `cancelMove.ts`, `resolveBattle.ts`

### `events/` — one file per event
Same shape discipline as commands. Examples:
- `heroMoved.ts`, `turnEnded.ts`, `structureBuilt.ts`, `heroRecruited.ts`, `battleResolved.ts`, `goldTransferred.ts`, `charterStarted.ts`, `charterAdvanced.ts`, `settlementUpgraded.ts`

### `dto/`
HTTP request/response shapes, one file per endpoint. Lives here because both `client` and `server` import from it:
- `createGameDto.ts`, `getGameDto.ts`, `postCommandDto.ts`, `getEventsDto.ts`, `lobbyClaimDto.ts`, `authDto.ts`

### `catalog/`
Shape definitions for data-driven content rows (consumed via `EngineCtx.catalog`, populated by repos):
- `BuildingDefRow`, `CastleLevelRow`, `UnitTypeRow`, `SpriteSetRow`

---

## `@heroes/engine` — deterministic rules, no I/O

**Purpose:** pure functions of state. The single source of game logic. Anything in this package can be unit-tested with no DOM, no `pg`, no `Date.now`, no `Math.random` (RNG is injected via `EngineCtx`).

### `state/`
- `gameState.ts` — the composed `GameState` interface (~60 lines, just the shape). Replaces today's 1404-line `src/state/gameState.ts` by composition, not by copy.
- `turnController.ts` — the in-process runtime that owns the current `GameState`, exposes `select(cmd)` and `apply(cmd, events)`. This is the only thing the client holds a long-lived reference to.
- `calendar.ts` — round/day/month math. Today's `calendarFromDay`/`monthName` from `gameState.ts` move here.

### `hero/`
- `types.ts` — `HeroState`
- `move.ts` — `validate` + `apply` for `MoveHero` (~80 lines)
- `recruit.ts` — `validate` + `apply` for `RecruitHero`
- `stacks.ts` — platoon reorder/normalize; `canStartCharter(state, heroId)` and `validCharterTargets(state)` are extracted here from `GameEngine.ts:229-290`
- `movement.ts` — movement-point arithmetic

### `settlement/`
- `types.ts` — `SettlementState`
- `capture.ts`, `buildStructure.ts`, `upgradeTownHall.ts`, `upgradeSettlement.ts` — one command per file

### `economy/`
- `income.ts` — (moves from `src/economy/income.ts`)
- `consumption.ts`
- `morale.ts`
- `trade.ts` — `tradeResources` + `runAutoTrade`
- `transfer.ts` — hero↔settlement gold

### `charter/`
- `start.ts`, `travel.ts`, `advance.ts`, `cleanup.ts`

### `turn/`
- `endTurn.ts` — the pipeline; **extracted last** in Phase 2 because it calls into every other domain (see ordering note below)
- `phases.ts` — `GamePhase` transitions

### `combat/`
(Direct rename of `shared/combat/`. Already well-factored.)
- `grid.ts`, `damage.ts`, `resolveBattle.ts`, `manualBattle.ts`, `ai.ts` (extracted from `manualBattleArena.ts` so the server can use it too)

### `map/`
- `gameMap.ts`, `terrain.ts`, `resourceTiles.ts`, `pathfinding.ts`, `castlePlacement.ts`

### `init/`
- `newGame.ts` — today's `makeInitialStatePayload`, split into `castles.ts` / `heroes.ts` / `players.ts` seeders
- `hydrate.ts` — server-row → `GameState` (replaces today's `hydrateGameState`)

### `catalog/`
- `buildingCatalog.ts` — `BuildingDef[]` lookup (replaces 289-line `src/core/buildingRegistry.ts`)
- `castleLevels.ts` — `CastleLevel[]` lookup (unlocks "more castle sizes" as data)
- `unitCatalog.ts` — moves from `src/data/unitCatalog.ts`

### `validation/`
- `gameIntegrity.ts` — moves from `shared/validation/`
- Per-command `Violation` type unions in `commands/violations.ts`

### Misc
- `rng.ts`, `hex.ts` — pure utilities
- `engineCtx.ts` — the injected context: `{ rng: Rng, catalog: Catalog }`. Anything deterministic the engine needs lives here; if/when a clock is needed, it slots into `EngineCtx` explicitly.

**Phase 2 ordering rule (callout from the Fable review):** extract `economy/*` → `charter/*` → `settlement/*` → `hero/*` → `turn/endTurn.ts` *last*. `endTurn.ts` depends on every other domain; extracting it first creates a new 400-line monster or circular imports.

---

## `@heroes/server` — thin HTTP over command handlers over repositories

**Purpose:** persistence + transport. The command loop lives here. Server is authoritative; clients send Commands, receive Events.

### `http/`
- `routes/commands.ts` — single generic `POST /games/:id/commands` endpoint (Decision 1.A/C). One route file; the command loop is the same code path for every command kind.
- `routes/queries.ts` — read endpoints: `GET /games/:id`, `GET /games/:id/events?after=seq`, `GET /games/:id/tiles`, lobby CRUD, auth, assets. Plain REST; reads were never going to be commands.
- `routes/index.ts` — mounts the above under Express.

### `app/`
- `commandHandler.ts` — THE core loop (~100 lines): `loadState(repos)` → `engine.validate(cmd)` → `engine.apply(cmd)` → `persistDeltas(repos)` + `appendEvents(eventRepo)` in one transaction. The reusable shared loop, built *before* the first endpoint is ported (per the Phase 3 ordering callout).
- `turnService.ts` — weekly upkeep / round advance orchestration; invoked by the `EndTurn` command.
- `lobbyService.ts`, `authService.ts`, `assetService.ts` — non-game-flow concerns.

### `persistence/`
- `db.ts`, `migrations/` — pg client + schema migrations
- `repositories/` — one file per table, plain CRUD, no business logic:
  - `gameRepo.ts`, `gamePlayerRepo.ts`, `heroRepo.ts`, `heroPlatoonRepo.ts`, `settlementRepo.ts`, `settlementBuildingRepo.ts`, `settlementSpotRepo.ts`, `settlementMineRepo.ts`, `settlementResourceRepo.ts`, `charterRepo.ts`, `tileRepo.ts`, `eventRepo.ts`
  - `buildingDefRepo.ts`, `castleLevelRepo.ts`, `unitTypeRepo.ts`, `spriteSetRepo.ts`, `spriteRepo.ts` — catalog tables, read into `EngineCtx.catalog` at command-loop time
- `eventLog.ts` — append + cursor queries (`eventsAfter(gameId, seq)`); the engine's load-bearing sync mechanism

### `auth/`
- `bearerTokens.ts` — 32-byte token issue/validate (replaces today's `console.log`-only recovery codes with real email delivery when triggered; schema unchanged today)
- `userSessions.ts` — sliding 30-day TTL, mint-on-recovery-only

### `assets/`
- `spriteManifest.ts` — validates uploaded sprites against the `{set}.{entity}.{variant}.{level}.{facing}` key schema from §6

---

## `@heroes/client` — screens, scene building, painting

**Purpose:** everything that touches the DOM, canvas, or local user state. The decomposition here is the missing piece from Fable's plan.

### `boot/`
- `game.ts` — composition root. Replaces today's 422-line `GameEngine.ts`. Shrinks to ~80 lines: instantiate subsystems, call `subscribe()` on every `Subscribes`, register every `Applies` with the command router, start the animation ticker. **No** wiring callbacks manually, **no** charter placement state, **no** input handlers.
- `main.ts` — DOM bootstrap (`<canvas>` + `<div id="toolbar">`), calls `bootGame()`.

### `session/`
- `apiClient.ts` — ex-`SessionManager.ts`, minus the save-status state. Pure HTTP. Issues commands (implements `Applies`), reads (returns DTOs). **No** GameState manipulation — it doesn't know what a Command *means*, only how to send one.
- `gameSession.ts` — ex-`GameSessionManager.ts`. Lifecycle: `loadGame` becomes `GET /games/:id` (small tables) + `GET /games/:id/events?after=0` (replay through engine) + `eventCursor.set(seq)` + `multiplayerSync.start(gameId)`. `handleNewGame` becomes `POST /games` + `loadGame` the result. `handleManualSave` is **deleted** — replaced by a server-snapshot timer; clients don't manually save state blobs anymore.
- `commands.ts` — ex-`GameActions.ts`, rewritten as the **command dispatcher**. The *only* place in the client that talks to the command endpoint. Builds Command objects from user intent, calls `apiClient.apply(cmd)`, applies returned events locally. Decision 2.C (cosmetic prediction) lives here — animation plays optimistically, state waits for ack.
- `multiplayerSync.ts` — moves from `src/io/multiplayerSync.ts`. Polls `GET /games/:id/events?after=seq`, applies events through engine. Same contract over WS later.

### `state/`
- `gameStateStore.ts` — the *engine boundary* on the client. Holds the current `GameState` + `engine/runtime/turnController.ts` runtime. Thin wrapper around `runtime.apply(cmd)` and `runtime.events$.subscribe(...)`. **No** visual entity mirror here.
- `eventCursor.ts` — tracks the last-applied event `seq` for multiplayer sync.

### `scene/` — the renderer seam (Fable §6, fully realized)
- `viewShell.ts` — ex-`ViewManager.ts` minus `AdventureView`. Owns `canvas`, `ctx`, `Camera`, `MinimapCamera`. Wires scene-builder + painter.
- `sceneBuilder/` — pure: `GameState` + `Camera` → `SceneNode[]`
  - `adventureScene.ts`, `cityScene.ts`, `battleScene.ts`
- `paint2d/` — Canvas2D painter for `SceneNode[]`. Today's `src/render/` drawing code moves here wholesale. Knows nothing about the game.
- `paint3d/` — empty placeholder for the WebGL/three future (Fable §6).
- `entityMirror.ts` — the visual `Hero[]`/`Castle[]` tween cache, **subscribed to events** instead of being rebuilt wholesale on `state:committed`. `Hero.moving`/`fromTile`/`toTile`/`pixelOffset` live here. On `HeroMoved`, tween from old tile to new over 200ms. On `StructureBuilt`, flash. This is the fix for `GameEngine.ts:192-197`.
- `animationTicker.ts` — replaces today's `rAF` full-frame loop. Only ticks `entityMirror` while tweens are active; emits `scene:redraw` when frames need to advance. **No** `state.update(dt)` per frame — state updates happen at command time, not animation time.

### `screens/` — replaces `src/views/` and `src/managers/UIManager.ts`
Per Fable Decision 3.C: mechanical folder-move PR first, then decomposition as-touched.

- `shared/`
  - `toolbar.ts` — today's `src/views/toolbar.ts`. Implements `Subscribes` only.
  - `hud.ts` — implements `Subscribes` only.
- `adventure/`
  - `charterPlacement.ts` — the charter mode controller currently leaking into `GameEngine.ts:43-44, 229-307`. Validation is pure engine (`engine/hero/recruit.ts:canStartCharter`); the red-tint overlay application is presentation. Owns `charterPlacementMode` + `validCharterHexes` locally.
  - `inputBindings.ts` — ex-`handleDblClick`/`Click`/`MouseMove`/`Resize` from `GameEngine.ts:382-421`. Builds Commands from canvas events.
  - `adventureScene.ts` — already listed under `scene/sceneBuilder/`; the screen-level orchestration lives here too.
- `heroes/`
  - `heroInfoMenu.ts`, `heroRosterMenu.ts` — today in `src/views/`. Each is a small screen.
- `settlements/`
  - `settlementInfoMenu.ts`, `settlementRosterMenu.ts`
  - `cityView/` — per Fable §2.4 example. `cityScreen.ts` (mount/lifecycle), `gridCanvas.ts`, `buildingTile.ts`, `buildingCatalog.ts` (UI selection, not data).
- `combat/`
  - Per Fable §2.4 example: `arenaScreen.ts`, `gridCanvas.ts`, `platoonTile.ts`, `actionBar.ts`, `retreatModal.ts`, `surrenderModal.ts`, `banner.ts` — replaces today's 1701-line `manualBattleArena.ts`.
- `multiplayer/`
  - `multiplayerLobby.ts`, `lobbyList.ts`, `seatClaim.ts` — split out of today's `src/views/multiplayerLobby.ts`.
- `debug/` (package-internal)
  - `devConsole.ts`, `debugApi.ts`, `eventLog.ts` — moves from `src/debug/`. Mounted only in dev builds.

### `sprites/`
- `manifest.ts` — `{set}.{entity}.{variant}.{level}.{facing}` key resolution (Fable §6)
- `assets.ts`, `assetApi.ts` — moves from `src/render/assets.ts`
- `proceduralDrawers.ts` — `HERO_PROCEDURAL_DRAWERS` moves from `src/render/sprites.ts` (kept for dev until art pipeline lands; see gap below)

### `settings/`, `data/`
- Settings menu and the few static-data loaders (e.g. faction colors, player colors). Splits from today's `src/views/settingsMenu.ts` and `src/state/playerColors.ts`.

---

## Cross-cutting

### `tools/art-pipeline/`
Per Fable §6, the SVG → PNG rasterizer that emits sprite-manifest entries. **Gap callout:** Fable references this as "exists as `tools/sprites`" — verify before Phase 6; if absent, the rotation/facings seam is built on missing infrastructure and the pipeline becomes a Phase 1 prerequisite, not a Phase 6 detail.

### `test/`
Grows mirrors of `engine/` domains as those domains migrate. Per Fable: "a domain migration PR moves files AND their tests."

---

## Open additions vs Fable (decisions the original plan deferred)

1. **Two orthogonal interfaces, not one uniform contract.**
   ```ts
   interface Subscribes { subscribe(bus: EventBus): Unsubscribe; }
   interface Applies    { apply(cmd: Command): Promise<CommandResult>; }
   ```
   `boot/game.ts` composes them generically. A module may implement either, both, or neither — `Toolbar` is `Subscribes` only; `apiClient` is `Applies` only; `commands.ts` is both. Fable's wording of "managers/ shrink into `boot/`" was too aggressive; this preserves the seam that was missing in the original `managers/` directory.

2. **Phase 2 ordering**: `economy/*` → `charter/*` → `settlement/*` → `hero/*` → `turn/endTurn.ts` last. `endTurn.ts` depends on every other domain.

3. **Phase 3 ordering**: build `commandHandler.ts` (the reusable loop) *before* porting any endpoint. Otherwise every ported endpoint re-implements auth + turn-check + version-check + transaction.

4. **Phase 6 catalog work moves into Phase 2 baseline**: stubs for `building_defs` / `castle_levels` / `sprite_sets` tables + `EngineCtx.catalog` interface land with Phase 2, not Phase 6. "More castle sizes" is a near-term owner goal and shouldn't wait on the whole reorg.

5. **`props JSONB` promotion rule**: anything in `props` that's queried (`WHERE`/`ORDER BY`/`JOIN`) or referenced in 2+ business-logic sites within a release gets promoted to a real column. Write into `AGENTS.md` alongside other constraints.

6. **`GameStateManager`'s visual entity mirror moves to `scene/entityMirror.ts`** and subscribes to events instead of being rebuilt wholesale on `state:committed`. This is the architectural fix that makes the rAF loop deletable.

7. **`manualSave` is deleted.** Server snapshots on a timer; clients don't push whole-state PATCHes anymore.
