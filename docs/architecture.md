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
| `src/ai/aiBrain.ts` | **Now live** (was already imported via turnHooks): targets enemy heroes within reach 7 (priority `1000 − dist·10`), neutral settlements and resources within reach 8, else wanders; fixed the path off-by-one that made enemy targeting illegal; approach/reposition beside enemies; garrisoned enemy settlements excluded as steps. **Amended later the same day (capture/garrison wave below):** the blanket garrison exclusion became strength-gated — `GARRISON_ATTACK_RATIO = 1.5` (a garrison the AI can beat stays pathable so the approach can *end* on the settlement tile; an unfavorable one stays blocked) — and settlement targeting gained bands: garrisoned `700 − dist·5`, empty enemy-owned `650 − dist·5`, neutral (now named) `600 − dist·5`. **Amended again (follow-ups wave below):** the ratio now compares **power** (`unitPower` = attack + defence from the unit catalog) instead of raw troop totals, and `pickAiMove` gained an `excludedSettlementIds` param — the I1 re-attack backoff strips a just-lost settlement from every target class and re-blocks it as a path obstacle for `GARRISON_BACKOFF_ROUNDS = 2` rounds. |
| ~~`src/systems/enemyWander.ts`~~ | **Deleted** — zero imports, unwired dead code (the repo's "unwired parallel implementation" lesson again). |

Behavior notes: walking onto an empty enemy/neutral settlement captures it (`tryCaptureAt`, existing rule); AI-involved battles auto-resolve silently through the existing `maybeAutoResolveBattle` predicate — AI-vs-AI and AI-attacker-vs-human show only the result card, while a human attacker keeps the Fight/Quick-Resolve/Flee modal. Known v1 limitation: no server-side AI actor — if seat 0 is absent in a LAN game, AI turns stall until it returns. No AI chartering (unchanged). AI behavior is `aiBrain`'s current weights; smarter targeting was an explicit non-goal. **Amended later the same day (capture/garrison wave below):** garrisoned settlements are no longer blanket-refused — strength-gated instead (see the `aiBrain` row); a walk-in onto a beatable garrisoned settlement (enemy-owned *or* neutral) opens a `SETTLEMENT_BATTLE` that auto-resolves via the new `resolveSettlementBattle`; and AI walk-in captures serialize behind the move persist like the human path's. **Amended again (follow-ups wave below):** AI seats now also **garrison their own settlements** — the tick runs `pickGarrisonRecruitment` once per round+seat and submits the shopping list through the existing `RecruitUnits` command path (actor = the AI seat) — so an unattended AI town grows a garrison instead of falling to the first walk-in.

Test inventory: new suites `test/ai/aiBrain.test.ts` (`test:unit` glob extended with `test/ai/*.test.ts`), `test/engine/init.test.ts` (enemyCount player-count derivation), `test/server/createGameRoute.test.ts` (`enemySlots` clamp, lobby seats humans-only); extended `test/state/gameState.test.ts` (the `AI_TURN` move-gate pins) and `test/state/turnController.test.ts` (AI tick moves, AI-initiated battle → auto-resolve → `AI_TURN` restore, primary-actor gate).

### Hero battle outcomes (2026-09-29)

Plan: [`.kilo/plan/2026-09-29-hero-outcomes.md`](../.kilo/plan/2026-09-29-hero-outcomes.md) — battles now end in per-hero verdicts instead of leaving a wiped loser standing with empty stacks. **Defeat** (side wiped to zero troops) **removes** the hero from the adventure map entirely (state heroes record + `player.heroIds` + `hero_platoons` rows); arena **retreat** respawns at the nearest **owned** settlement with all troops lost (stacks zeroed server-side — the arena's 15% pre-loss is subsumed; purse kept); **surrender** teleports there keeping troops (the surrender gold deduction is unchanged); with no owned settlement a retreating/surrendering hero stays at its post-cancel position (plan edge D1); a stalemate leaves both standing; modal **Flee** is unchanged (pre-battle cancel). The auto-resolver is run with no retreat policies, so AI-involved losses are always removals. Charter cleanup now runs for every **removed** hero (attacker or defender); retreating/surrendering heroes keep active charters and their auto-travel resumes from the relocated position.

| Module | Purpose |
|---|---|
| `packages/engine/src/combat/battleOutcome.ts` | Pure outcome helpers shared by both command paths: `deriveHeroVerdict(sideOutcome, conceded?)` → `"defeated" \| "retreated" \| "surrendered" \| "stood"`; `nearestOwnedSettlement(state, hero)` (hexDistance min, record-order tie-break, null when the owner holds nothing — the D1 stay-put edge); `relocateHeroToSettlement(hero, settlement)` (q/r set, `previous*` nulled, trail re-seeded — the recruit-spawn shape) |
| `packages/contracts/src/events/engineEvent.ts` | `HeroBattleVerdict` union; `BattleResolved` gains optional `attackerVerdict`/`defenderVerdict` — the only field that discriminates surrender vs retreat (both collapse onto `retreated_hero` in the outcome enum, plan D5) |
| `packages/contracts/src/commands/{resolveBattle,submitBattleResult}.ts` | `ResolveBattleResult`/`SubmitBattleResultResult` gain optional `attackerHero`/`defenderHero` (a defeated side's hero is absent — absence is the deletion signal) + optional verdicts |
| `server/app/commandHandler.ts` | `applyHeroBattleOutcomes` (defeat: delete from heroes record + prune owner's `heroIds`; retreat: stacks zeroed then relocate; surrender: relocate keeping stacks, gold already debited; none-owned → stay) runs after `buildPostBattleHeroes` so winner-takes-loot (purse + cargo, wagon-capped) lands before removal; `foldRemovedHeroCharters` extends `cleanupDefeatedHeroCharters` from wiped-defender-only to every removed hero; `persistBattleOutcome` always persists `players` (fixes the `heroIds` prune dangling on non-capture outcomes); post-battle capture skips removed/relocated attackers |
| `server/persistence/repositories/heroRepo.ts` | `upsertMany` sweeps orphaned `hero_platoons` rows (`NOT IN` the surviving id set) — a deleted hero never reaches the per-hero loop, so its platoon rows previously orphaned |
| `src/game/turnHooks.ts` | `mergeBattleOutcomeHeroes` (Quick Resolve path): absent heroes delete the local row, prune `heroIds`, clear a selection pointing at them (existence-checked); `consumeResolveBattleVerdicts` hands the resolve round-trip's verdicts to the result-card/toast layer |
| `src/managers/GameActions.ts` | Fight-path submit merge handles absent heroes the same way (`mergeBattleOutcomeHeroes`); AI-battle info toasts speak the verdicts via `battleResultText` |
| `src/screens/combat/battleResultText.ts` | Pure verdict wording: `battleVerdictCardLine` / `battleVerdictToastPhrase` / `battleToastMessage` / `settlementNameAt` — "slain" / "retreated to \<name\>" / "surrendered to \<name\>"; absent verdicts (pre-W1 servers) render nothing |
| `src/screens/combat/battleResultCard.ts` | Per-side verdict lines under the winner banner |
| `src/io/commands.ts` | `ResolveBattle`/`SubmitBattleResult` response types carry the optional heroes + verdicts |

Behavior notes: verdicts ride both the `BattleResolved` event and both command results, so every transport (direct response, SSE replay, poll catch-up) speaks the same wording; `battle:resolved` bus consumers are unchanged (the outcome enum keeps its shape). A `SubmitBattleResult` draw wipes only sides that submitted zero survivors (mirroring `defenderLostAllTroops`), so a stalemate with real survivors on both sides stands. Post-battle capture (attacker on an emptied enemy settlement) applies only when the attacker kept the collision hex — removed or relocated attackers can't capture. Settlement-garrison battles joined these rules later the same day — see the next section.

Test inventory: new suites `test/engine/battleOutcome.test.ts` (verdict derivation incl. the concession split, nearest-owned tie-break + null edge, relocation shape) and `test/combat/battleResultText.test.ts` (card/toast wording, settlement-name lookup, absent-verdict suppression); post-battle pins rewritten across `test/server/submitBattleResult.test.ts` (defeat removal, retreat zeroing + relocation, surrender keep-troops + debit, D1 no-owned edge), `test/server/commandHandler.test.ts`, `test/server/captureSettlementGarrison.test.ts`; `test/state/turnController.test.ts` extended for the client-side merges.

### Settlement capture & garrison battle correctness (2026-09-29)

Landed the same day as the two sections above; hardens the capture/battle seam they left rough. Five changes: walk-in captures serialize behind the triggering move persist and roll back on server rejection; neutral garrisoned settlements now fight (and a win captures them); settlement-battle losers follow the hero-outcome rules; garrison-affecting engine events reach remote clients; and the AI attacks garrisons it can beat.

| Module | Purpose |
|---|---|
| `src/state/turnController.ts` | Walk-in capture serialization: `lastMovePersist` records the triggering move's persist (human `requestMove` dispatches it **before** `tryCaptureAt`; the AI tick tracks it the same way), and `captureSettlement`'s hook awaits it before POSTing `CaptureSettlement` — killing the live-verified ~50% `hero_not_at_settlement` 409 race (human and AI). A server rejection rolls the optimistic capture back via engine `rollbackCaptureSettlement`; `already_owned` never reaches that path (turnHooks treats it as benign). `tryCaptureAt` no longer swallows `enterSettlementBattle` failure: it re-reads the garrison, falls back to capture only when it is actually empty, else emits a diagnostic `command:rejected` (`could_not_start_settlement_battle`). A same-move hero BATTLE no longer clobbers an opened SETTLEMENT_BATTLE (phase-checked adjacency on both the human and AI paths), and the human path gained the AI tick's 0-troop adjacency guard. New `resolveSettlementBattle(unitTypes)`: drains pendingCommands → engine auto-resolver → `applySettlementBattleResult` → removed-attacker selection clear → `AI_TURN` re-map → fire-and-forget `onSettlementBattleSubmitted`; a null unit catalog bounces the attacker (flee semantics) instead of inventing a result. |
| `packages/engine/src/settlement/capture.ts` | New pure `rollbackCaptureSettlement(state, heroId, settlementId, previousOwnerId)` — the inverse of `captureSettlement()`: owner/roster restore + clamped gold subtraction; a guarded reference-stable no-op when ownership already moved (a multiplayer merge beat it there). |
| `packages/engine/src/settlement/battle.ts` | Neutral garrisons fight: `startSettlementBattle`'s `unowned_settlement` gate removed (only the mover's OWN settlements are excluded). `applySettlementBattleResult` now returns `{ state, captured, attackerVerdict, removedHeroIds }` and applies the hero-outcome rules — defeat deletes the hero + prunes `heroIds` + folds the charter (`cleanupDefeatedHeroCharters`), retreat zeroes stacks and relocates to the nearest owned settlement (D1 stay-put), surrender relocates keeping stacks; `settlementAttackerVerdict` maps outcome + submitted stacks (a draw wipes only zero-survivor attackers). |
| `packages/contracts/src/commands/submitSettlementBattleResult.ts` | `SubmitSettlementBattleResultResult` gains optional `attackerHero` (absence = the deletion signal) + `attackerVerdict`; mirrored in `src/io/commands.ts`. |
| `server/app/commandHandler.ts` | The `SubmitSettlementBattleResult` case drops its `unowned_settlement` gate (a neutral garrison qualifies like an enemy-owned one), persists the outcome's players + granular charter fold alongside heroes/settlements, and returns `attackerVerdict` + the optional post-battle `attackerHero`. |
| `src/game/turnHooks.ts` | `onCaptureSettlement` treats `already_owned` as a benign no-op and **rethrows** everything else so the controller's serialized capture rolls back; the 9-arg `onSubmitSettlementBattleResult` hook collapses to a payload-taking `onSettlementBattleSubmitted`; `mergeBattleOutcomeHero` extracted as the single-hero half of `mergeBattleOutcomeHeroes` for the settlement flow. |
| `src/managers/GameActions.ts` | `startSettlementBattleFlow` merges the server outcome via `mergeBattleOutcomeHero` (an absent attacker was deleted server-side: charter fold + row drop + `heroIds` prune + selection clear) and shows the verdict on the result card; the arena is titled "Assault on \<name\>"; the SETTLEMENT_BATTLE branch of `maybeAutoResolveBattle` auto-resolves non-local-attacker battles (`autoResolveSettlementBattle` → controller `resolveSettlementBattle` → the D4 card/toast policy) and keeps the manual arena for local-human attackers. |
| `src/screens/combat/arena/openManualBattleArena.ts` | Optional `title` option (defaults to the Test Battle sandbox's) so a real settlement fight is never titled like the dev sandbox. |
| `src/io/multiplayerSync.ts` | `ENGINE_EVENT_KINDS` 14 → 17: `UnitsRecruited`/`UnitsTransferred` admitted as applied deltas; `SettlementBattleResolved` admitted knowing `applyEngineEvent` answers it with a resync (its winner/captured payload cannot re-derive the resulting stacks/gold/hero outcomes). |
| `packages/engine/src/events/applyEvent.ts` | `applyUnitsRecruited` (replays the garrison deposit only — the settled gold/warehouse follow at the TurnEnded resync boundary) and `applyUnitsTransferred` (maps 1:1 onto `transferUnits`, minus `toSlot`); any rejection → full-refetch resync. |
| `src/game/garrisonEventBridge.ts` | **New.** Subscribes `mp:eventsApplied`/`mp:resynced` and carries garrison deltas + full-refetch snapshots into the live TurnController (`flushPendingCommands()` before every merge, `replaceState` merge preserving existence-checked selections); safe-phase gating (blocked during BATTLE/SETTLEMENT_BATTLE/ROUND_END and the primary client's own `AI_TURN`; a snapshot landing while unsafe is **dropped, never queued** — it would rewind newer local state — and additionally gated off the local seat's own `PLAYER_TURN`), FIFO deferral of deltas that landed while unsafe, retried on `state:committed`. Attached from `GameEngine.initEventListeners`. |
| `src/ai/aiBrain.ts` | Garrison-aware targeting (amends the AI-enemies section above): the blanket garrison path-block replaced by strength gating — `GARRISON_ATTACK_RATIO = 1.5` (attack when the hero's troop total ≥ 1.5× the garrison's; favorable garrisons unblocked so paths can END on them, unfavorable stay blocked). New target classes: garrisoned settlements `700 − dist·5`, empty enemy-owned `650 − dist·5`, neutral `600 − dist·5` — enemy heroes stay the top band, resources unchanged. |

Behavior notes: the serialization holds for both the human path and the AI tick (the AI's own walk-in capture chains behind the same `lastMovePersist`); `already_owned` — the server having captured inline with a post-battle persist — reconciles as a no-op instead of rolling a correct capture back. Post-battle capture parity is pinned with tests so the hero-battle and settlement-battle paths can't diverge. A settlement battle the local human fights keeps the manual arena (now titled "Assault on \<name\>"); AI-attacker settlement battles resolve silently on the primary client and surface a result card/toast (a neutral settlement's owner is null, so it can never involve the local seat — the display policy treats that as seat `-1`). The no-clobber guards mean a same-move hero BATTLE and a walk-in SETTLEMENT_BATTLE can't overwrite each other — the first phase opened owns the move, the other re-fires on the next one.

Test inventory: new `test/engine/settlementBattle.test.ts` (verdict mapping, outcome application — defeat removal/retreat relocation/surrender — and the neutral-garrison gate), `test/state/garrisonEventMerge.test.ts`, and `test/settlements.e2e.ts` (npm `test:settlements`, wired into `test:all`); extended `test/state/turnController.test.ts` (serialization order, rollback, `already_owned`, phase no-clobber, `resolveSettlementBattle`), `test/ai/aiBrain.test.ts` (strength gating + the new target bands), `test/server/submitSettlementBattleResult.test.ts` + `test/server/captureSettlementGarrison.test.ts` (neutral gates, verdict persistence, capture parity, `already_owned` reconciliation), `test/engine/applyEvent.test.ts` + `test/io/multiplayerSync.test.ts` (the three admitted kinds). Full suite 896/896 unit + e2e green.

### Settlement battle follow-ups (2026-09-29)

Plan: [`.kilo/plan/2026-09-29-settlement-battle-followups.md`](../.kilo/plan/2026-09-29-settlement-battle-followups.md) — B5 (assault confirmation modal), B4 (power-weighted strength), B1 (AI garrison defense), I1 (AI re-attack backoff), plus two live-found fixes: a driven-AI-seat event skip on the primary client and a hero path/trail leak (an AI-tick selection override surviving into shared state drew a fog-hidden enemy hero's route).

| Module | Purpose |
|---|---|
| `src/screens/combat/assaultConfirmModal.ts` | **New** (B5): `openAssaultConfirmModal` — "Assault on \<name\>" dialog with You/Garrison summary lines (pure `formatStacksLabel`/`pluralizeUnitName`, unit-tested without a DOM) and Assault / Auto-resolve / Cancel; built on `openCenteredModal`/`styleButton` from `screens/shared/menu`. |
| `src/managers/GameActions.ts` | B5: `startSettlementBattleFlow` fronts the arena with the confirm modal for **local-human attackers only** (AI/non-local attackers keep the silent auto-resolve path). Assault enters the unchanged arena flow; Auto-resolve delegates to `autoResolveSettlementBattle`; Cancel calls the new `TurnController.cancelSettlementBattle()` and stops. |
| `src/state/turnController.ts` | B5 + B1 + I1: new `cancelSettlementBattle()` ends the client-local SETTLEMENT_BATTLE phase with the hero left standing on the settlement tile (garrison holds, capture deferred, nothing submitted; re-selecting the hero re-runs `tryCaptureAt` and re-opens the flow). The AI tick runs `runAiGarrisonRecruitment(seat)` at tick start — once per round+seat, per-item failures log (`ai_garrison_recruit_rejected`) and never stall the turn. New shared `AiTurnMemory` (`{ garrisonBackoff, aiRecruitedFor }` + `createAiTurnMemory()`), threaded via `TurnControllerOptions.aiMemory` so `replaceState` controller rebuilds preserve it; `resolveSettlementBattle` records a `GARRISON_BACKOFF_ROUNDS = 2` exclusion after a non-win AI assault, and the tick consults/prunes it via `activeGarrisonBackoff`. The tick also restores the pre-tick `selectedHeroId` after `startMove`'s selection override (the path/trail leak fix below). |
| `packages/engine/src/units.ts` | B4: `unitPower(t) = (attack ?? 1) + (defence ?? 1)` and `platoonPower(platoons, unitTypes)` — per-unit strength weights matching what the auto-resolver effectively scores with. A catalog miss (weight 2 per unit) scales both sides uniformly, degrading a power ratio exactly to the old troop-count comparison; existence gates (`platoonTroopTotal > 0` etc.) and auto-resolver math are untouched. Re-exported via `src/state/units.ts`. |
| `packages/engine/src/settlement/recruitUnits.ts` | B1: new shared `eligibleRecruitSources(settlement)` — the single source of the `RecruitUnits` command's building gates (construction finished + `minLevel`), consumed by both the command and the AI garrison planner. |
| `src/ai/aiBrain.ts` | B1 + B4 + I1: `pickGarrisonRecruitment(state, seat, unitTypes)` — for each settlement the seat owns with no hero standing on it, threat = Σ enemy-hero `platoonPower` within `GARRISON_THREAT_REACH = 8`, target = max(`GARRISON_POWER_FLOOR` 4, `GARRISON_TARGET_RATIO` 1.0 × threat), then greedy best power-per-gold purchases under the `GARRISON_GOLD_RESERVE` 100 / warehouse / `garrison_full` caps; pure and deterministic. `attackerBeatsGarrison` now compares power; `pickAiMove` gained `unitTypes` + `excludedSettlementIds` params. |
| `src/managers/GameStateManager.ts` + `src/managers/GameSessionManager.ts` | Own the `AiTurnMemory` instance — every `makeTurnController` hands the same one into `TurnControllerOptions`, so the rebuild on every `replaceState` (auto-resolve settle, SSE refetch, sync merge) carries backoff/recruit-guard across instead of wiping them mid-campaign (the live-found re-attack storm: a drawn assault re-targeted forever, 62 battles in 12 s). `resetAiTurnMemory()` on every `loadGame` so round/hero/settlement-keyed entries never leak across sessions. |
| `src/io/multiplayerSync.ts` | Driven-AI-seat skip: `applyRows` skips rows whose `actor_seat` is an AI seat **when the local client is seat 0** (the primary driver's own merges already applied those mutations locally) — fixes a live-found garrison double-apply (the additive `applyUnitsRecruited` replay deposited the same troops a second time on top of the optimistic deposit); non-primary clients still apply AI-seat rows, which is their only source of AI state. |
| `src/game/turnHooks.ts` + `src/game/garrisonEventBridge.ts` | `BuildTurnHooksOptions.localSeat` (wired from GameEngine); `mergeFromEndTurn(state, result, localSeat?)` and the bridge's `mergeResynced` preserve a hero selection only when `hero.ownerId === localSeat` (unknown seat keeps the legacy existence-only rule), so a foreign selection can never re-enter shared state and light up a fog-hidden hero's path/trail. turnHooks also gained the `pickGarrisonRecruitment` hook (feeding `aiBrain` against `cachedUnitTypes()`). |
| `src/render/scene/sceneBuilder/adventureScene.ts` | Path/trail leak fix (user-reported): `buildPathNodes` emits the path preview + trail **only for an own-seat selected hero** (`ownerId === viewPlayerId`); the `heroes[0]` fallbacks are gone — no selection means no path/trail nodes at all. The leaked AI-tick selection had drawn a bright-gold route from a fog-hidden hero's tile (fogged segments render brighter by design). |
| `src/data/unitCatalog.ts` | B4: sync `cachedUnitTypes()` accessor so the AI hooks hand the brain the full catalog without awaiting a load. |

Behavior notes: the assault confirm is client-local — Cancel submits no command and the server never learns a SETTLEMENT_BATTLE opened; the walk-in move is already persisted and the garrison untouched. `AiTurnMemory` is in-memory on the primary client by design (only that client runs the tick); round-keyed backoff entries expire silently on consultation. The path/trail fix also un-harms `canOpenCharterFlow`/`startCharter` and UIManager's city-close restore, which the leaked selection had been corrupting.

Test inventory: new `test/screens/combat/assaultConfirmModal.test.ts` + `test/engine/unitPower.test.ts`; extended `test/ai/aiBrain.test.ts` (garrison planner, power gating, backoff exclusions), `test/state/turnController.test.ts` (cancel, recruit tick, memory persistence across rebuilds), `test/state/mergeFromEndTurn.test.ts` (seat-gated selection preservation), `test/state/garrisonEventMerge.test.ts`, `test/render/adventureScene.test.ts` (own-seat-only path/trail), `test/io/multiplayerSync.test.ts` (driven-seat skip). Full suite 944/944.

## See also

- [module-documentation-and-relationships.md](./module-documentation-and-relationships.md) — current module-by-module dependency map for `src/`, `server/`, `shared/`, `test/`, `tools/`, `scripts/`. This doc (`architecture.md`) is the executed **plan** that established the layout; the dependency map is the maintained **current state** and reflects any drift since the move.
