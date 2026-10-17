# Current Module Map

<!-- docs:verified 2026-10-17 -->

This is the current code map, verified against the repository on 2026-10-17. The executed layout plan in [`architecture.md`](./architecture.md) is historical. Shared boundary types live in `packages/contracts/`, game rules/economy in `packages/engine/`, and browser UI in `src/screens/`.

## Data Flow

```text
Browser client                                      Express API
  src/screens + src/state                           server/routes
       |                                                   |
  src/io commands ---- HTTP commands ----------------> commandHandler
       |                                                   |
  @heroes/engine reducers <-------------------------- @heroes/engine
       |                                                   |
  SSE + poll backstop <--------- game_events ---------- Postgres
       |                                                   ^
  src/render scene builders                           server/app/aiDriver
       |                                             (trusted internal dispatch)
  paint2d/index.ts
```

`@heroes/contracts` is the wire contract: 25 command kinds and 25 `EngineEvent` variants (12 apply, 7 resync, 6 ignore). `@heroes/engine` owns the pure reducers used by both the client and server. The server persists accepted commands transactionally; flagged games run AI turns through the same internal command handler. Client SSE applies event rows and the poller remains a recovery/backstop path.

## Workspace Packages

| Package | Responsibility |
|---|---|
| `packages/contracts/` (`@heroes/contracts`) | Leaf types shared across client/server: game state, ids, resources, buildings, factions, commands, engine events, and telemetry. It imports no engine, client, or server code. |
| `packages/engine/` (`@heroes/engine`) | Pure game rules: initialization/hydration (`init.ts` + `castlePlacement.ts` scale default/max settlement counts by $\sqrt{N/432}$ via `defaultCastleCountForMap`/`maxCastleCountForMap` and enforce passable BFS connectivity via `buildReachableMask`), movement, chartering (`charter/requirements.ts` uses a flat `Uint8Array` forbidden mask + optional `{ center, maxDistance }` bounds in `validCharterHexes`), settlement/building/recruitment, resource production/upkeep, trade-route logistics, combat/outcomes, turn progression, event replay, registries, map algorithms (`packages/engine/src/map/gameMap.ts` provides a process-wide `getOrCreateGameMap` LRU cache + `Uint8Array` bitset frontier deduplication, O(1) swap-and-pop, and `scaledTerrainBlobs` in `generateTerrain`; `pathfinding.ts` uses a binary min-heap + reusable generation-tagged TypedArray buffers with FIFO tie-breaking and blocked-goal early exit), and AI strategy (`packages/engine/src/ai/aiBrain.ts` bounds `pickWanderStep` to a local radius ring with early exit, returns early when `movementRemaining < 1`, scopes resource/charter scans to a local radius, and scales enemy/settlement target reach on large maps via `aiTargetReachForMap`). Depends on contracts only. |

## Server (`server/`)

| Area | Responsibility |
|---|---|
| `server/index.ts`, `server/routes.ts` | Express bootstrap, `/api` router composition, schema/migration initialization, bulk 5-parameter `UNNEST` tile insertion in `generateAndInsertTiles` + `getOrCreateGameMap` reuse, and service start. `LAN_HOST=1` controls API binding. |
| `server/http/routes/` | HTTP boundary: command validation, games/lobbies, SSE event stream, telemetry, auth, and assets. Client AI-seat commands for server-driven games are rejected at the command route. |
| `server/app/commandHandler.ts` | Transactional command dispatch: load state, validate authority, call engine reducers, persist affected rows (`dualWriteEntities` passes `before.heroes`/`before.settlements` into `upsertMany` so unchanged entity references skip SQL queries), and append events. |
| `server/app/aiDriver.ts`, `aiDriverToken.ts` | Drives flagged AI seats, including garrisons, trade routes, charters, battles, and turn completion. Per-process tokens, heartbeat watchdog/adoption, and PostgreSQL per-game advisory locks prevent stale or duplicate drivers. |
| `server/app/dropPolicy.ts` | Heartbeat-based disconnect detection, grace period, and server End Turn for disconnected seats. |
| `server/persistence/` | PostgreSQL pool, transactions, event notification, repositories, hydration, and numeric mappings. |
| `server/migrations/` | 28 ordered SQL migrations (`001`-`028`), applied after `schema.sql` during startup. |

The server does not depend on `src/screens/` or `src/render/`. Keep server behavior in the engine/server layers; HTTP routes are adapters, not game-rule implementations.

## Client (`src/`)

| Area | Responsibility |
|---|---|
| `src/main.ts` | Bootstrap `GameEngine`, register screens, show the home view, and start the animation loop. |
| `src/managers/` | App orchestration: `GameEngine`, state/entity synchronization, sessions (`GameSessionManager` reconstructs `GameMap` client-side via `getOrCreateGameMap` in `loadGame`/`handleNewGame`/`createFreshStarter` without fetching `/tiles`), view setup, UI (`UIManager` with dirty-keyed `refreshHud`/`setMapDimensions`), and high-level actions. |
| `src/state/` | Client-local state/controller facade: the persisted settings singleton (`settings.ts`, e.g. `toolbarStyle` — default `modern`, unknown values normalize to `modern`; `maxZoomOutHexesWide` — `20..34` hexes wide, default `20`) and the toolbar theme token registry (`toolbarThemes.ts` — palette + shape tokens per theme). Reducers and authoritative game rules are imported from `@heroes/engine`. |
| `src/screens/` | DOM UI and input: home, adventure (`adventureView.ts` + `clickIntent.ts` filter `occupiedHexes`/enemy targets by fog visibility via `computeVisionFromState`, preview adjacent attack paths on enemy hover, and enforce the `maxZoomOutHexesWide` zoom-out floor; `tileInfo.ts` checks territory via `hexDistance <= controlRange`), combat, settlement/city, logistics, multiplayer, shared menus/panels (`hud.ts` memoizes economy snapshots + `formatTime`, `toolbar.ts` caches status-row elements), and debug screens. The toolbar theme applier `src/screens/shared/toolbarTheme.ts` writes the `--tb-*` tokens onto the document root and reacts to settings changes; the Visual "Toolbar style" selector and "Max zoom-out width" slider live in `src/screens/home/settingsMenu.ts`. View registration is through `src/screens/shared/viewLauncher.ts`. |
| `src/io/` | Typed REST/auth client, command sender, multiplayer SSE plus poll backstop, local game index, and the per-game flag registries (`unchartedGames.ts` — uncharted fog mode — and `serverDrivenGames.ts`). |
| `src/render/scene/sceneBuilder/` | Pure state-to-`SceneNode[]` builders for adventure, city, and battle views (`adventureScene.ts` supports row-clipped `viewportBounds` frustum culling via `getRowQBounds`/`isTileInViewportBounds`, omits no-op `grass`/`dirt` decoration nodes, iterates sparse `GameMap.placedResourceTiles`, memoizes `buildTerritoryOutlineEdges`, and swaps `fogHex` for `unchartedHex` on never-revealed tiles in uncharted mode via `AdventureSceneInput.revealed`). |
| `src/render/scene/paint2d/` | Canvas2D scene painter. `index.ts` contains per-kind drawing; `deps.ts`, `colors.ts`, and `geometry.ts` (`hexPath` via `UNIT_HEX_CORNERS`) define the painter seam and helpers. |
| `src/render/paint2dDefaults.ts`, `src/render/skybox.ts`, `src/render/minimap.ts`, `src/render/camera.ts`, `src/render/fog.ts`, `src/render/reveal.ts`, `src/render/renderTypes.ts` | Browser/Vite asset wiring, settings adapters, sprite resolvers, skybox asset/cache ownership, offscreen-cached minimap rendering (`staticLayerCache` + `computeVisionHash` + `MIST_GRADIENT_MIN_CELL_PX` LOD), `Camera.getVisibleAxialBounds` + `getRowQBounds` + `computeMinZoomForHexWidth` frustum/zoom math, `VisionSet` (`Uint8Array(256 * 256)` flat grid + memoized `computeVision`/`computeVisionFromState`), the per-game session reveal accumulator (`revealTilesFor`, keyed by `RenderOptions.gameName`, seeded from `RenderOptions.revealedTiles`), and the render options bag (`RenderOptions.uncharted` gate). These stay outside the pure painter package. |
| `src/render/cityRenderer.ts` | Thin city-view wrapper around `paintScene`; it is not the scene builder or a building-art library. |
| `src/core/`, `src/entities/`, `src/map/`, `src/data/`, `src/players/`, `src/debug/` | Client math/events (`src/core/hex.ts` precomputes `UNIT_HEX_CORNERS`), visual entities, map adapters, cached catalogs/assets, seat identity, and developer diagnostics. |
| `src/ai/`, `src/systems/`, `src/combat/` | `src/ai/aiBrain.ts` is a compatibility re-export of engine AI; `src/systems/movement.ts` is the client arrival hook; `src/combat/testArmies.ts` supports the developer battle sandbox. |

The current city scene builder is `src/render/scene/sceneBuilder/cityScene.ts`; the painter is `src/render/scene/paint2d/index.ts`. The former procedural city-building draw/generation helpers and style-leaf folder have been retired; do not use those historical module names as current paths.

## Tests and Tooling

| Area | Responsibility |
|---|---|
| `test/` | Node `node:test` suites plus Playwright browser/e2e/visual suites. `npm run test:unit` is serial; `npm run test:all` runs eight browser/e2e entries and then the unit suites. See `AGENTS.md` and the operations guide before DB-backed tests. |
| `tools/` | Test wrapper, sprite generation/validation/code generation, and developer utilities. Pixel building sprite keys and anchor offsets have generated drift checks; `buildingSpriteCoverage.ts` has an exhaustive engine unit-test gate. |
| `scripts/` | Port allocation, cleanup, DB seeding/migration helpers, skybox processing, versioning, and Docker build wrapper. |

## Import Boundaries

- Contracts are dependency-free; engine imports contracts only.
- Server code does not import client screens or rendering. `server/routes.ts` retains the existing narrow `src/game/initState.ts` bootstrap exception recorded in `dependency-cruiser.cjs`.
- Render painters consume `SceneNode[]` plus `Paint2DDep`; they do not import Vite `?url` asset modules or value-import settings. `paint2dDefaults.ts` is the adapter.
- Dependency-cruiser enforces package boundaries, cycles, and the render/painter seam; run `npm run lint:deps` when source code changes.

For feature behavior, see the [documentation catalog](./README.md). For the earlier layout plan and its dated implementation history, see [`architecture.md`](./architecture.md).
