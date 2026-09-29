# Architecture & Module Layout

**Status:** Executed. Describes the current `src/` shape — this was the implementation plan, now applied. Originally written 2026-07-19 under a timestamped filename; renamed to `architecture.md` as the canonical name.

## Context

The repo started with 7 empty subdirectories under `src/` (`core/`, `entities/`, `io/`, `map/`, `render/`, `systems/`, `views/`) but every real module still lived flat at `src/` root. The design docs in this folder (`resources.md`, `settlements.md`, `heroes.md`, `map.md`, `economy.md`, `army.md`) are authoritative for *game* design but say nothing about TypeScript module layout. This plan filled that gap and gave the implementation agent an unambiguous file map.

## Goal

Move the current flat `src/` modules into the 7 scaffolded subdirectories, in a way that maps 1:1 to the design-doc domains, so that the next milestone (planned items in `economy.md`, `settlements.md`, `map.md` resource-tile work, `city-view.md`) drops new files into obvious, pre-decided places.

## Non-goals

- No new features, no behavioral changes.
- No renames of public types (e.g. `Hero`, `GameMap`, `Renderer`, `Camera`, `Faction`, `Axial`, `Terrain`).
- No server-side changes (`server/` untouched).
- No `package.json` / `vite.config.ts` / `tsconfig.json` edits (path roots stay at `src/`).
- Don't introduce barrels (`index.ts`) — keep imports explicit.

## Target layout

```
src/
  main.ts                          # entry; composes the others
  core/
    hex.ts                         # Axial, axialToPixel, pixelToAxial, hexDistance, hexCorners, HEX_SIZE
    rng.ts                         # shared seeded RNG (extracted from main.ts's rng())
    types.ts                       # cross-cutting types if any emerge (currently empty — create only when needed)
  entities/
    hero.ts                        # Hero class, Faction type
    settlement.ts                  # Settlement type/builder (new, lands with settlements milestone)
  io/
    api.ts                         # api client (health, createGame, patchGame, logEvent) + Game type
  map/
    terrain.ts                     # Terrain union, TERRAIN_COST, TERRAIN_COLORS (extracted from renderer.ts)
    gameMap.ts                     # GameMap class (moved from renderer.ts)
    resourceTiles.ts               # resource-tile placement & lookup (new, lands with map.md milestone)
    pathfinding.ts                 # findPath (A*)
  render/
    camera.ts                      # Camera class
    renderer.ts                    # Renderer class (terrain + overlay draw; keeps hero/sprite draw)
    sprites.ts                     # preloadCastleSprites, sprite helpers
    overlays/
      resourceIcon.ts              # resource overlay draw (new, lands with map.md)
      settlementSprite.ts          # settlement overlay draw (new, lands with settlements.md)
      pathOverlay.ts               # yellow path dots/lines draw (new, split out of renderer.ts)
  systems/
    movement.ts                    # hero movement tween + arrival hook (extracted from Hero.update + main.onPlayerArrived)
    economy.ts                     # per-turn resource tick (new, lands with economy.md)
    combat.ts                      # hexDistance-based combat check + auto-resolve stub (new; stub allowed, army.md deferred)
    capture.ts                     # settlement-capture-by-walk (new, lands with settlements.md)
    enemyWander.ts                 # pickWanderTarget (moved from ai.ts) + wander tick (split from main.updateEnemies)
  views/
    adventureView.ts               # canvas + camera + click/drag/wheel wiring (split from main.ts)
    cityView.ts                    # 10x10 settlement interior (new, lands with city-view.md)
    hud.ts                         # bottom HUD text update (split from main.ts updateHud)
```

Notes on choices:

- **`core/`** holds pure math + geometry with no game-domain knowledge. `hex.ts` is the obvious fit; the seeded RNG in `main.ts` becomes `core/rng.ts` so all systems share one source of randomness (deterministic map generation, AI).
- **`entities/`** holds the things that *are on the map*: hero, settlement. (No separate `castle.ts` — castles *are* settlements in this game per `settlements.md`; existing `castles.ts` content gets folded into `entities/settlement.ts` and `render/overlays/settlementSprite.ts`.)
- **`io/`** is the boundary to the outside world (HTTP backend). Only `api.ts` lives here today.
- **`map/`** is everything about the world itself: terrain, the map data structure, resource-tile placement, and how to traverse it. `pathfinding.ts` belongs here because it operates on the map data.
- **`render/`** is everything that draws to the canvas. Subdirectory `overlays/` is allowed *only* for overlays — keep camera, renderer, sprites flat at the `render/` level so the common path stays shallow.
- **`systems/`** is per-tick behavior: movement, economy, combat, capture, AI. Each system is a small module that takes the world state and mutates it. This matches the per-turn loop in `economy.md`.
- **`views/`** is the input/event wiring and screen-scoped rendering (adventure view, city view, HUD). This is what makes future city-view work drop in cleanly.

## File-by-file moves

| From (current) | To | Rename? |
|---|---|---|
| `src/hex.ts` | `src/core/hex.ts` | no |
| `src/hero.ts` | `src/entities/hero.ts` | no |
| `src/castles.ts` | split into `src/entities/settlement.ts` (types/builder) + `src/render/overlays/settlementSprite.ts` (draw) | yes (split) |
| `src/api.ts` | `src/io/api.ts` | no |
| `src/pathfinding.ts` | `src/map/pathfinding.ts` | no |
| `src/renderer.ts` (GameMap class) | `src/map/gameMap.ts` | yes (extract class) |
| `src/renderer.ts` (Terrain, TERRAIN_COST, TERRAIN_COLORS) | `src/map/terrain.ts` | yes (extract) |
| `src/renderer.ts` (Renderer class) | `src/render/renderer.ts` | yes (keep) |
| `src/camera.ts` | `src/render/camera.ts` | no |
| `src/sprites.ts` | `src/render/sprites.ts` | no |
| `src/ai.ts` | `src/systems/enemyWander.ts` | yes (`pickWanderTarget`); `planEnemyMove` is unused — drop it |
| `src/main.ts` | `src/main.ts` (stays) but shrinks: pulls RNG into `core/rng.ts`, pulls `onPlayerArrived` + arrival hook into `systems/movement.ts`, pulls `updateEnemies` tick into `systems/enemyWander.ts`, pulls `updateHud` into `views/hud.ts`, pulls click/drag/wheel/resize into `views/adventureView.ts` | refactor |
| `src/resources/` (PNG/SVG assets) | unchanged | no |

## Implementation order

Execute in this order so the working tree compiles at every step:

1. Create `src/core/rng.ts` — move `rng()` and `rngState` out of `main.ts`. Update import.
2. Move `src/hex.ts` -> `src/core/hex.ts`. Fix the import in `hero.ts`, `ai.ts`, `pathfinding.ts`, `renderer.ts`, `main.ts`.
3. Split `src/renderer.ts`:
   - Extract `Terrain`, `TERRAIN_COST`, and any colour constants -> `src/map/terrain.ts`.
   - Extract `GameMap` class -> `src/map/gameMap.ts`.
   - What remains (`Renderer`) -> `src/render/renderer.ts`.
   - Fix imports in `main.ts`, `hero.ts`, `ai.ts`, `pathfinding.ts`.
4. Move `src/pathfinding.ts` -> `src/map/pathfinding.ts`. Fix imports.
5. Move `src/camera.ts` -> `src/render/camera.ts`. Fix import in `main.ts`.
6. Move `src/sprites.ts` -> `src/render/sprites.ts`. Fix import in `main.ts`.
7. Move `src/api.ts` -> `src/io/api.ts`. Fix import in `main.ts`.
8. Move `src/hero.ts` -> `src/entities/hero.ts`. Fix imports.
9. Move `src/castles.ts` -> split into `src/entities/settlement.ts` + `src/render/overlays/settlementSprite.ts`. Fix imports.
10. Delete `src/ai.ts` (its only used export `pickWanderTarget` is replaced by the new module); create `src/systems/enemyWander.ts` containing `pickWanderTarget` and a `tickEnemyWander(map, enemies, rng, dtMs)` helper. Fix import in `main.ts`.
11. Create `src/views/hud.ts` containing `updateHud(...)`. `main.ts` calls it.
12. Create `src/views/adventureView.ts` containing the click/drag/wheel/resize wiring and the `hoverFromScreen` glue. `main.ts` becomes the orchestrator: owns the rAF loop, owns the game state, delegates to `adventureView` for input and to systems for tick logic.
13. Create `src/systems/movement.ts` containing `onPlayerArrived` (renamed `onHeroArrived` since it generalises). `main.ts` calls it from the rAF loop after the player stops moving.

Do **not** create in this plan: `entities/settlement.ts` content, `map/resourceTiles.ts`, `systems/economy.ts`, `systems/combat.ts`, `systems/capture.ts`, `render/overlays/*.ts`, `views/cityView.ts`. These are placeholders for the next implementation agent; the directory scaffold is created now but the modules land with their respective design-doc milestones.

## Validation

After all 13 steps, the project must:

- `npm run build` succeeds (tsc + vite build, both clean).
- `npm test` succeeds (smoke test in `test/smoke.ts`; `pretest` allocates ports via `scripts/allocate-ports.ts`, and the smoke entry reads its boot contract from `local/.test-request.json` written by `tools/run-test.mjs`).
- Dev server (`npm run dev`) loads `index.html`, renders the same hex map, pans/zooms, moves the player hero along an A* path, wanders enemies, and persists via the API exactly as today.
- `git grep -nE "^import.*from \"\\./hex\"" src/` and similar greps confirm no flat-root `hex.ts` / `pathfinding.ts` / `camera.ts` / `sprites.ts` / `api.ts` / `hero.ts` / `castles.ts` / `ai.ts` remain at `src/` root.
- `src/main.ts` is shorter and reads as an orchestrator: init, rAF loop, delegate to views + systems.

## Risks

- **Circular imports.** `hex.ts` -> no internal deps. `pathfinding.ts` depends on `map/gameMap.ts` and `core/hex.ts`. `entities/hero.ts` depends on `core/hex.ts`. `systems/enemyWander.ts` depends on `map/gameMap.ts`, `core/hex.ts`, `entities/hero.ts`, `map/pathfinding.ts`. `systems/movement.ts` depends on `entities/hero.ts`, `core/hex.ts`, `io/api.ts`. `render/renderer.ts` depends on `map/gameMap.ts`, `map/terrain.ts`, `core/hex.ts`, `render/camera.ts`, `entities/hero.ts`. **No cycles expected** as long as `core/` stays leaf-only and `render/` does not import from `systems/` or `views/`.
  - **Resolved by machine enforcement (2026-08-10).** `dependency-cruiser` (`dependency-cruiser.cjs`, run via `npm run lint:deps`) lints `src/`, `shared/`, and `server/` against the cross-boundary rules: `core/` is leaf-only by rule (not just convention), `shared/` cannot import from `src/`, `src/` cannot be reached by `server/`, and cycles across any boundary are flagged. The prior "by convention" risk is no longer applicable.
  - **Resolved (2026-08-10) — 7 remaining intra-`src/` cycles fixed.** `dependency-cruiser` `no-circular` severity was bumped from `warn` to `error` to keep these from regressing. The 5 fixes that broke the cycles:
    1. **View registration via `src/views/viewLauncher.ts`** — `homeView`, `adventureView`, `cityView`, and `CityDesignBoxManager` now register themselves in a single registry; `ViewManager` / `UIManager` resolve views through it instead of importing each other directly.
    2. **`MinimapCamera` extracted to `src/render/minimapCamera.ts`** — `minimap.ts` no longer owns the camera class, so `renderer.ts` / `overlays/pathOverlay.ts` can import the camera without pulling the full minimap module (and vice versa).
    3. **Cross-cutting render types extracted to `src/render/renderTypes.ts`** — `RenderOptions` and `MinimapGeometry` are now leaf-level, so `renderer.ts`, `minimap.ts`, and `overlays/pathOverlay.ts` no longer import types from each other.
    4. **Domain state shapes extracted to `shared/settlementTypes.ts`** — `SettlementState`, `CharterState`, `UpgradeState`, `Warehouse`, `WarehouseResource`, `BuildingRef`, `CharterPhase` now live in `shared/`, so `src/state/gameState.ts` no longer transitively defines shapes that other modules needed to import through it.
    5. **`economy/consumption.ts` and `economy/settlementRates.ts` import from `shared/types` directly** — they no longer reach into `../state/gameState` for shape types, removing the last economy → state → shared cycle.
- **Stale imports.** After every move, run `tsc --noEmit` before the next move. Don't batch all moves.
- **`render/renderer.ts` decomposition (2026-08-18, superseded 2026-08-21).** The `Renderer` class was renamed to `MapRenderer` and internally split into stateless per-kind painter classes under `render/painter/`. That directory is **now deleted** (issue #148): it was a second implementation of drawing logic that `render/scene/paint2d/` already carried, and only one of the two ever ran, so they drifted apart in six separate ways before anyone noticed. `MapRenderer.draw()` now builds a `SceneNode[]` via `buildAdventureScene()` and hands it to `paintScene()`. The lesson worth carrying: **an unwired parallel implementation is not a safe intermediate state.** If a decomposition is meant to be transitional, say so in writing and give it a deadline, or the two copies will diverge silently. The public constructor signature, `draw(...)`, `hoverFromScreen(...)`, and the `map` field survived both changes unchanged.
- **`castles.ts` split.** Read the file fully before splitting — the draw code likely references castle level sprites (`castle-l1/2/3.png`) and the entity state shape; preserve both halves exactly. The sprite list lives in `src/resources/`.
- **Unused `planEnemyMove`.** Confirmed unused in `main.ts`; safe to delete during the `enemyWander.ts` move.
- **`window.__gameDebug`** in `main.ts` references many internals; after refactor it must keep working because the smoke test may read it.

### Linked mitigation plans

- `../.kilo/plan/2026-08-09-risk-circular-imports.md` — ✅ resolved 2026-08-10 (commit `526398e`): layer rules machine-enforced via `dependency-cruiser.cjs` / `npm run lint:deps`; see resolution notes under "Risks" above
- `../.kilo/plan/2026-08-09-risk-gameDebug-contract.md` — still applicable (surface has grown past what the architecture doc described)

## Out of scope

- Creating placeholder files for not-yet-built modules (per "Implementation order" step 13 note). The empty directories are the deliverable; the modules land with their milestones.
- Renaming public types or changing `Game` / `Hero` / `GameMap` / `Renderer` / `Camera` APIs.
- Server, schema, test, or tool changes.
- Adding a `src/index.ts` barrel.

## Subsequent additions

The following modules landed after this plan was executed and are documented here so the file map stays current. They follow the same conventions (strict TS, no barrels, `core/` leaf-only, no `render/` → `systems/`/`views/` imports).

### Home page + email magic-link sign-in (issue #29)

A full-screen home view is shown over the canvas on startup; the existing rAF loop keeps running underneath so revealing the game is a no-op.

| Module | Purpose |
|---|---|
| `src/views/homeView.ts` | Landing screen (New Game / Load Game / Settings / Sign In). Owns its own New Game + Load Game modals; reuses `openSettingsMenu` from `views/settingsMenu.ts` for Settings and `openCenteredModal` / `styleButton` / `styleInput` from `views/menu.ts` for the auth modal. |
| `src/io/auth.ts` | Client-side email magic-link flow: `requestLoginCode`, `verifyLoginCode`, `checkSession`, `logout`, `getCachedAuth`. Token + email are cached in `localStorage`; `Authorization: Bearer <token>` is the wire format. |
| `src/io/api.ts` | `apiFetch` was promoted from internal helper to a named export so `auth.ts` can share the timeout/abort logic. |

Server-side additions:

| Module | Purpose |
|---|---|
| `server/auth.ts` | `POST /api/auth/request-code`, `POST /api/auth/verify-code`, `GET /api/auth/session`, `POST /api/auth/logout`. 6-digit codes are SHA-256 hashed (salted by email) and stored in `auth_codes` with a 10-minute TTL; `user_sessions` holds bearer tokens with a 30-day rolling expiry. Also exports a `requireAuth` Express middleware (unused for now — game endpoints are still anonymous). In dev (`NODE_ENV !== "production"`) the code is also returned in the response so the magic-link flow can be exercised without a real SMTP integration. `NODE_ENV` used to be unset everywhere, including the deployed image, so this `devCode` branch was actually active in production too; #98 now sets it explicitly (`development` in `.env.example` for local dev, `production` in `docker/Dockerfile`'s `api-runtime` stage for the deployed image), closing that gap. |
| `server/schema.sql` | New tables: `auth_codes`, `user_sessions` (plus indexes). |

Entry-point change in `src/main.ts`: after `engine.initBackend()`, a `HomeView` is constructed and shown. Its `onNewGame` / `onLoadGame` callbacks delegate to `engine.sessions.handleNewGame` / `engine.sessions.loadGame`; `onEnterGame` just hides the overlay (no loop teardown). `GameEngine.fullFrame()` was promoted from `private` to `public`, and a thin `refreshToolbarAndFrame()` helper was added so home-view callbacks can resync the toolbar after a load.

### UI panel decompression + TurnController `commit()` dispatcher (2026-09-27)

A five-step refactor shrank the largest UI modules by extracting their inner responsibilities into small shared modules (all unit-testable without a DOM where the logic is pure). `homeView` still owns its own modals — the extracted shared ones are used by `Toolbar`.

| Module | Purpose |
|---|---|
| `src/screens/shared/newGameModal.ts` | `openNewGameModal` + `NewGameHandler`; the New Game modal extracted from `toolbar.ts` (with its `randomSuffix`/`defaultName` helpers). Toolbar keeps the button, not the modal. |
| `src/screens/shared/loadGameModal.ts` | `openLoadGameModal` + `LoadGameHandler`; the Load Game modal extracted from `toolbar.ts` (with `makeLoadRow`/`readUserGamesFrom*`/`closeAllModals`/`sortByLastSeen`/`formatTime`). |
| `src/screens/shared/dockedPanel.ts` | `DockedPanel`: shared `userMoved`/reposition/anchor policy used by `HeroInfoMenu` + `SettlementInfoMenu`. |
| `src/screens/shared/panelWidgets.ts` | Shared `makeRow(label, { opacity? })` label/value row widget; second export `AccordionSection`, a collapsible section header (chevron + label + right slot + body). |
| `src/screens/shared/panelLayout.ts` | Persisted floating-panel geometry: `PanelGeometryKey` (`"heroInfo" \| "settlementInfo" \| "buildPalette"`), `loadPanelGeometry`/`savePanelGeometry` over localStorage key `heroesJs.panelGeometry.v1` (validated, cached, node-safe `localStorage` guard). |
| `src/screens/shared/panelPlacement.ts` | Pure collision-free placement: `PanelRect`/`rectsOverlap`/`resolvePanelPlacement(desired, occupied, viewport, minTop)` (clamp → right-shift → up-shift), unit-tested without a DOM. |
| `src/screens/adventure/dragTracker.ts` | `DragTracker`: one parameterized drag-state machine replacing three copy-pasted mousedown/mousemove/mouseup trios in `adventureView.ts`; `consumeMoved`/`reset` semantics. |
| `src/screens/adventure/clickIntent.ts` | Pure `resolveAdventureClick` → discriminated `ClickIntent` union: the move/attack pathfinding + `computeReachableSplit` + clamping decision logic from `AdventureView.onClick`, unit-tested in `test/screens/adventure/clickIntent.test.ts`. |
| `src/screens/adventure/charterModal.ts` | `openCharterModal`; charter naming + DOM moved out of `AdventureView`. |
| `src/screens/heroes/armySection.ts` | `ArmySection`: grid-only tile grid when expanded (no row list) + HTML5 drag reorder, extracted from `HeroInfoMenu`; replaces positional child-index DOM access with stored refs. |
| `src/screens/settlements/cityView/netCost.ts` | `netDelta(net, charged)` pure helper (net building cost after charges), unit-tested in `test/screens/settlements/netDelta.test.ts`. |
| `src/screens/settlements/cityView/buildListSections.ts` | `buildListSections()` — palette build-list sectioning: classifies `BUILDABLE_KINDS` by registry data (recruits → Troop Buildings, `isProducerKind` → Production, else Civilian), preserving `BUILDABLE_KINDS` order per section; also owns `BUILDABLE_KINDS` (now incl. `stables`)/`BUILD_LIST_SECTION_TITLES`/`BuildListSection`, unit-tested in `test/screens/settlements/buildListSections.test.ts`. |

Shrinkage on the donor side: `toolbar.ts` is chrome-only now; `adventureView.ts` is input wiring only (click decisions live in `clickIntent.ts`); `heroInfoMenu.ts`'s constructor DOM moved into a `buildHeroPanelDom` factory; `settlementInfoMenu.ts` adopts `DockedPanel` + the shared `makeRow`; `cityView.ts`/`buildingPlacer.ts` do their screen→grid math via `core/cityGrid`'s new `cityLayout`/`screenToGridCell` pair (`BUILDING_PAD_RATIO = 0.18` moved there too — the three duplicated copies of that math, constant included, are gone; `computeCityScale` is no longer consumed through `cityRenderer`'s re-export).

Two behavior-adjacent notes: `state/turnController.ts` gained a private `commit()` helper that collapses the reducer→assign→logEvent→`bus.emit`→`trackCommand` template across 15 command methods (`requestMove`/`startCharter`/`advanceAutoTravel` and the turn lifecycle stay explicit); and `HeroInfoMenu` now displays the hero's wagon cargo — a cargo/stockpile section reading `HeroState` wagon contents + per-resource caps through `heroCargo`/`heroWagons`/`heroResourceCap`/`heroGoldCap` from `@heroes/engine` (this changed the panel's measured height, hence the visual-baseline regeneration). New unit tests: `test/state/turnController.test.ts`, `test/screens/adventure/clickIntent.test.ts`, `test/screens/settlements/netDelta.test.ts`, `test/screens/settlements/buildListSections.test.ts`. In a follow-up accordion pass, the hero panel sections (Cargo, Stats & Army, and the Army grid itself) and the settlement Warehouse section became `AccordionSection` accordions collapsed by default to a single header line with a chevron (E2E expands them via the `data-accordion` attribute); visual baselines were regenerated again for the new collapsed-by-default panel appearance.

**Follow-up (2026-09-28) — persistent panel layout.** Floating panels (HeroInfoMenu, SettlementInfoMenu, the build palette) now persist x/y **and** open/closed state across rebuilds, End Turn, city-view transitions, and page reloads: the two info menus persist drags via `panelLayout` and restore stored geometry into `DockedPanel`'s new optional `restore` constructor arg (each exposes a `floatingRect()` accessor); `buildingPlacer`'s palette popup moved to `zIndex: 75` (above the z-60 docked panels) with `onMove` persistence. `cityView`'s `openBuildPalette()` is collision-aware — occupied rects come from the `getFloatingPanelRects` provider (visible hero/settlement panels + the City Design box via `CityDesignBoxManager.getElement()`) fed through `resolvePanelPlacement` — and `open()` captures a `CitySelectionSnapshot` via the `getSelection` provider that `UIManager` restores on city close (hero-first, existence-revalidated) instead of force-selecting the settlement. `turnHooks.mergeFromEndTurn` preserves `selectedHeroId`/`selectedSettlementId` on existence only — no `activePlayerId` ownership term, since selections are client-local UI state; they survive End Turn and the AI-phase hand-offs (which flow through the same hook), and destroyed entities drop them. New unit tests: `test/screens/shared/panelLayout.test.ts`, `test/screens/shared/panelPlacement.test.ts`, `test/state/mergeFromEndTurn.test.ts` (includes the AI-hand-off regression case); the `test:unit` glob now also covers `test/state/*.test.ts` (pre-existing gap that had left `turnController.test.ts` out of the standard gate).

### SSE event push (2026-09-28)

Multiplayer state sync is no longer poll-only. Plan: [`.kilo/plan/2026-09-28-sse-event-push.md`](../.kilo/plan/2026-09-28-sse-event-push.md) — implemented and gate-green the same day. A `game_events` INSERT now reaches the owning game's connected browsers in ~low hundreds of ms, with the untouched 2 s poll demoted to backstop (v1) and resume path:

| Module | Purpose |
|---|---|
| `server/migrations/017_game_events_notify.sql` | `AFTER INSERT` trigger on `game_events` → `pg_notify('game_events_changed', game_id)`. The notification is a wakeup only — no payload data — and is delivered at commit, so whatever caused it is already visible to the handler's snapshot (no notification-vs-payload race). Idempotent (re-run at every boot). |
| `server/persistence/eventsNotifier.ts` | Process-wide fan-out singleton owning **one dedicated `pg.Client`** (never a pool client — LISTEN only delivers on the connection that issued it, so it must be held for the process lifetime). Lazy connect on first `subscribeGameEvents(gameId, cb)`; callbacks carry no payload (subscribers re-query with their own cursor → at-least-once, order-correct by construction); connection loss reconnects with exponential backoff (250 ms → 5 s cap, reset on success) and re-`LISTEN`s. |
| `server/http/routes/eventStream.ts` | `GET /api/games/:name/events/stream` (SSE): same `?after` validation and 404 ordering as the poll route; catch-up replay past `after` then a NOTIFY-driven live tail, both running the exact poll-route SQL so a cursor means the same thing on both transports; overlapping wakeups collapse into one re-run from the last-sent id; every frame carries `id:` (browser `Last-Event-ID` resume == the poll cursor); `: ping` heartbeat every 25 s; all rows stream (engine kinds and legacy audit kinds alike). `server/routes.ts` mounts it alongside the other sub-routers. |
| `src/io/multiplayerSync.ts` | `start()` additionally opens an `EventSource` on the stream; frames parse → validate → feed the **existing** `applyRows([row])` — same cursor advance, same self-event skip, same `mp:*` emissions — so nothing downstream can tell which transport a row arrived on, and the poll's `after=cursor` query never re-delivers a streamed row. `applyRows` fans out **every** row as `mp:logRow` **before** any state filtering (use case 1's feed). Missing `EventSource` (node tests) skips the stream silently; `stop()` closes it. |
| `src/core/events.ts` | `MpLogRow` + `MpLogRowEvent` (`mp:logRow`) — the sixth `mp:*` bus event. Declared locally because `core/` is leaf-only and must not import from `io/`. |
| `src/state/settings.ts` | `showLogPanel: boolean` (default `false`) — the exact `parallaxEnabled` pattern (`GameSettings` + default + `updateSettings`/`loadFromStorage` boolean guards); the toggle lives in the settings menu. |
| `src/screens/shared/logPanel.ts` | The Log Message Panel (first whole-game log view): 500-entry ring buffer, **no filtering** (every row, every seat, own included — an audit view, not a state view), one backlog hydrate via `api.getEvents(name, 0)` with row-id dedupe so catch-up racing the live stream can't duplicate, pause/clear + autoscroll; visibility and buffering gated on `showLogPanel`; deliberately not an extension of the dev `EventLog`. |

Test-wait note: the browser suites (`smoke.ts`, `cityView.test.ts`, `dragDrop.test.ts`, `proposedPath.test.ts`, `visualRegression.test.ts`) now navigate with `waitUntil: "load"` — once a session boots, its SSE stream holds a pending request forever, so `networkidle` can never fire. New unit tests: `test/server/eventsNotifier.test.ts`, `test/server/eventStreamRoute.test.ts`, `test/screens/shared/logPanel.test.ts`, plus SSE coverage in `test/io/multiplayerSync.test.ts`. `WS_PORT` remains reserved and dormant — SSE is plain HTTP, not a WebSocket.

### Playtest fixes (2026-09-29)

Plan: [`.kilo/plan/2026-09-29-playtest-fixes.md`](../.kilo/plan/2026-09-29-playtest-fixes.md) — 17 fixes (F1–F17) from two Playwright playtest sessions, delivered in three grouped commits. New modules:

| Module | Purpose |
|---|---|
| `src/screens/shared/firstTurnHint.ts` | One-time first-turn onboarding hint (F12a): pointer-events:none panel shown once after a game becomes active, dismissed by click/Esc; persisted via localStorage key `heroesJs.firstTurnHint.v1` (the `panelLayout.ts` validated/cached pattern). Explicit-attach from `GameEngine.initEventListeners` (the `toast.ts`/`mpPresenceHint.ts` convention). |
| `src/screens/shared/hotkeysModal.ts` | Keyboard & mouse shortcuts modal (F12c), static content; opened from the toolbar gear menu and via `?`. |
| `src/screens/settlements/cityView/panelRects.ts` | Pure helpers behind F5: `collectPanelRects`/`elementRect`/`resolveDesignBoxPlacement` — runs the City Design box's desired rect through `resolvePanelPlacement` against the visible floating panels, so it stops overlapping the hero/settlement panels. |
| `src/screens/adventure/charterRequirements.ts` | `evaluateCharterRequirements(state, heroId)` (F15): pure pass/fail rows for charter provisioning (hero selected/not chartering/on friendly settlement/purse 2500g/warehouse wood 20/stone 15) + `missing[]`/`hints[]`; unit-tested in `test/screens/adventure/charterRequirements.test.ts`. |
| `src/game/buildCommitLedger.ts` | Per-settlement queue of client-applied build deltas: `recordBuildCommit` (on optimistic apply) / `takeLastAppliedBuildDelta` (on server rejection) — the rollback ledger that lets a rejected `PlaceBuildings` un-apply the local delta instead of leaving phantom buildings/gold. |

Behavior notes, by fix group: **city-view input guard** — `AdventureView` takes an `isCityOpen?: () => boolean` (wired from GameEngine) and early-returns from `onClick`/`onMouseDown`/`onMouseMove`/`onWheel` while the city view is open (F1; city view shares the same canvas). **Build-cost accounting** (F2/F3): `CityView.persistBuildings` advances `chargedNet` only when the placer commit succeeds, `regenerate()` resets it, `UIManager.onClose` writes gold through `netCost.settleNet` (clamped like the other resources; aborts the whole persist when the net delta is unaffordable), and `turnHooks.onPlaceBuildingsRejected` rolls the last applied delta back via the ledger. **Fog legibility** (F4/F8): `pathSegment.fogged` styling + trail fade (see `src/render/docs/technical-spec.md` §2.5.1/§7.4), and fogged tile popups show "Unexplored" only — `TileInfo.terrain` is now nullable and every descriptor suppresses on fog (own-owned tiles stay visible). **Feedback layer** (F9/F10/F11): toast dedupe (`isDuplicateToast`, 1.5 s window, refresh-not-stack), HUD path-cost readout (`· Path 4.6/7` / `· Path x of y`) fed by `computeReachableSplitDetailed`, and an economy hover breakdown (`economyBreakdown()`) on the HUD row's `title`. **Indicators & city polish** (F5/F7/F13/F14/F16): castle ring restyle + hover lineWidth 2 + trail fade (technical-spec §7.4); `selectHero` now also clears `selectedSettlementId`; the hero movement bar is red at 0 / amber ≤ 25%; denseUrban carves one guaranteed clear 2×2; city labels offset by the toolbar height (`labelOffsetY`) and placer-accepted cells tint (`buildableCells`). **Onboarding & toolbar** (F12/F15): player labels standardized on **"Player N"** (engine `makePlayers` + the `GameSessionManager` anonymous-claim fallback — "Human" is gone); Test Battle moved from a main-row button into the gear menu (⚔ menu item); the Charter button now enables whenever it's the player's turn with a hero selected and opens the requirements modal (full affordability re-checked on Confirm).

Visual baselines (`adventure-overview`, both charter scenes, both city views) were regenerated for the pixel-affecting subset. New/extended unit tests: `pathOverlay`, `adventureScene`, `paint2d`, `cityScene`, `cityBuildingGen`, `charterRequirements`, `panelRects`, `hud`, `toastDedupe`, `tileInfo`, `netDelta`, `clickIntent`, `state/gameState`, `state/turnController`.

### AI enemies (2026-09-29)

Plan: [`.kilo/plan/2026-09-29-ai-enemies.md`](../.kilo/plan/2026-09-29-ai-enemies.md) — AI enemy seats end-to-end: a New Game "AI enemies" option (0–3), AI seats that spawn and take turns, wander/fight/capture behavior, and auto-resolved AI battles. `playerCount = humanSeatCount + enemyCount` (clamped ≤ `MAX_PLAYERS` 10); AI seats are **not** claimable lobby seats (`seats` stays = humanSlots, claiming one is a 400 `seat_out_of_range`); the LAN lobby path is unchanged (no `enemySlots` in v1) and its label now reads "Number of human players".

| Module | Purpose |
|---|---|
| `packages/engine/src/init.ts` | `BuildInitialOptions.enemyCount`; `buildInitialGameState` + `makeInitialStatePayload` derive `playerCount = humanSeatCount + enemyCount` (legacy behavior when absent). AI seats spawn castles + "Warlord" heroes. |
| `packages/engine/src/hero/move.ts` | `startMove`'s phase gate now admits `AI_TURN` when the mover is the active AI seat (`hero.ownerId === activePlayerId`); ownership/selection checks unchanged (the AI tick satisfies selection the same way the server does — naming the mover as selected). |
| `server/routes.ts` | `POST /games` destructures + clamps `enemySlots` (int, 0..10−humanSlots); `initOpts { playerCount: humanSlots + enemySlots, humanSeatCount: humanSlots }`; lobby `seats` = humanSlots (start gate untouched); `generateCastles` preview uses the total count. |
| `src/io/api.ts` + `src/managers/SessionManager.ts` + `src/managers/GameSessionManager.ts` | `enemySlots` param end-to-end: `api.createGame` body, `SessionManager.createGame`, `handleNewGame` (clamps 0–3). |
| `src/screens/home/newGameScreen.ts` + `src/screens/shared/newGameModal.ts` | "Number of AI enemies" chip row (0–3, default 0) mirroring the players row on both New Game UIs; `NewGameFormValues.enemyCount` / `NewGameHandler.enemyCount`; `homeView` payload + `GameEngine` passthrough wired. |
| `src/screens/multiplayer/multiplayerLobby.ts` | Stale "humans + AIs" seat-count label corrected to "Number of human players" (AI seats aren't lobby seats). |
| `src/state/turnController.ts` | The AI tick runs during `AI_TURN`, gated to the **primary client** (`TurnControllerOptions.isPrimaryActor` — local seat 0, wired from GameEngine; non-primary browsers watch via sync). Post-move adjacency → `enterBattle`; `resolveCurrentBattle` re-maps the phase back to `AI_TURN` when an AI initiated the battle (was a stall bug). Selection override is the server's commandHandler trick. |
| `src/ai/aiBrain.ts` | **Now live** (was already imported via turnHooks): targets enemy heroes within reach 7 (priority `1000 − dist·10`), neutral settlements and resources within reach 8, else wanders; fixed the path off-by-one that made enemy targeting illegal; approach/reposition beside enemies; garrisoned enemy settlements excluded as steps. |
| ~~`src/systems/enemyWander.ts`~~ | **Deleted** — zero imports, unwired dead code (the repo's "unwired parallel implementation" lesson again). |

Behavior notes: walking onto an empty enemy/neutral settlement captures it (`tryCaptureAt`, existing rule); AI-involved battles auto-resolve silently through the existing `maybeAutoResolveBattle` predicate — AI-vs-AI and AI-attacker-vs-human show only the result card, while a human attacker keeps the Fight/Quick-Resolve/Flee modal. Known v1 limitation: no server-side AI actor — if seat 0 is absent in a LAN game, AI turns stall until it returns. No AI chartering (unchanged). AI behavior is `aiBrain`'s current weights; smarter targeting was an explicit non-goal.

Test inventory: new suites `test/ai/aiBrain.test.ts` (`test:unit` glob extended with `test/ai/*.test.ts`), `test/engine/init.test.ts` (enemyCount player-count derivation), `test/server/createGameRoute.test.ts` (`enemySlots` clamp, lobby seats humans-only); extended `test/state/gameState.test.ts` (the `AI_TURN` move-gate pins) and `test/state/turnController.test.ts` (AI tick moves, AI-initiated battle → auto-resolve → `AI_TURN` restore, primary-actor gate).

## See also

- [module-documentation-and-relationships.md](./module-documentation-and-relationships.md) — current module-by-module dependency map for `src/`, `server/`, `shared/`, `test/`, `tools/`, `scripts/`. This doc (`architecture.md`) is the executed **plan** that established the layout; the dependency map is the maintained **current state** and reflects any drift since the move.
