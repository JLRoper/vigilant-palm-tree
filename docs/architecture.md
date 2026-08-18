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
- **`render/renderer.ts` decomposition (2026-08-18).** The `Renderer` class was renamed to `MapRenderer` and internally split into stateless per-kind painter classes under `render/painter/` (`BackgroundPainter`, `HexTerrainPainter`, `HexHoverPainter`, `HeroPainter`, `CastlePainter`, `CharterPainter`). The orchestrator owns only the camera transform and the per-frame painter call order; no raw `ctx.*` paint calls remain in `renderer.ts` itself. The public constructor signature, `draw(...)`, `hoverFromScreen(...)`, and the `map` field are unchanged — callers in `ViewManager.ts` and `adventureView.ts` were updated in place.
- **`castles.ts` split.** Read the file fully before splitting — the draw code likely references castle level sprites (`castle-l1/2/3.png`) and the entity state shape; preserve both halves exactly. The sprite list lives in `src/resources/`.
- **Unused `planEnemyMove`.** Confirmed unused in `main.ts`; safe to delete during the `enemyWander.ts` move.
- **`window.__gameDebug`** in `main.ts` references many internals; after refactor it must keep working because the smoke test may read it.

### Linked mitigation plans

- `../plan/2026-08-09-risk-circular-imports.md` — ✅ resolved 2026-08-10 (commit `526398e`): layer rules machine-enforced via `dependency-cruiser.cjs` / `npm run lint:deps`; see resolution notes under "Risks" above
- `../plan/2026-08-09-risk-gameDebug-contract.md` — still applicable (surface has grown past what the architecture doc described)

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

## See also

- [module-documentation-and-relationships.md](./module-documentation-and-relationships.md) — current module-by-module dependency map for `src/`, `server/`, `shared/`, `test/`, `tools/`, `scripts/`. This doc (`architecture.md`) is the executed **plan** that established the layout; the dependency map is the maintained **current state** and reflects any drift since the move.
