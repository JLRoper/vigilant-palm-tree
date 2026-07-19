# Source Module Organization Plan

**Timestamp:** 2026-07-19T02:21
**Author:** Kilo (planning)
**Status:** Implementation-ready

## Context

The previous agent created 7 empty subdirectories under `src/` (`core/`, `entities/`, `io/`, `map/`, `render/`, `systems/`, `views/`) but never recorded a plan for what belongs in each one. Meanwhile every real module still lives flat at `src/` root. The design docs in this folder (`resources.md`, `settlements.md`, `heroes.md`, `map.md`, `economy.md`, `city-view.md`, `army.md`) are authoritative for *game* design but say nothing about TypeScript module layout. This plan fills the gap and gives the implementation agent an unambiguous file map.

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
- `npm test` succeeds (smoke test in `test/smoke.ts`).
- Dev server (`npm run dev`) loads `index.html`, renders the same hex map, pans/zooms, moves the player hero along an A* path, wanders enemies, and persists via the API exactly as today.
- `git grep -nE "^import.*from \"\\./hex\"" src/` and similar greps confirm no flat-root `hex.ts` / `pathfinding.ts` / `camera.ts` / `sprites.ts` / `api.ts` / `hero.ts` / `castles.ts` / `ai.ts` remain at `src/` root.
- `src/main.ts` is shorter and reads as an orchestrator: init, rAF loop, delegate to views + systems.

## Risks

- **Circular imports.** `hex.ts` -> no internal deps. `pathfinding.ts` depends on `map/gameMap.ts` and `core/hex.ts`. `entities/hero.ts` depends on `core/hex.ts`. `systems/enemyWander.ts` depends on `map/gameMap.ts`, `core/hex.ts`, `entities/hero.ts`, `map/pathfinding.ts`. `systems/movement.ts` depends on `entities/hero.ts`, `core/hex.ts`, `io/api.ts`. `render/renderer.ts` depends on `map/gameMap.ts`, `map/terrain.ts`, `core/hex.ts`, `render/camera.ts`, `entities/hero.ts`. **No cycles expected** as long as `core/` stays leaf-only and `render/` does not import from `systems/` or `views/`.
- **Stale imports.** After every move, run `tsc --noEmit` before the next move. Don't batch all moves.
- **`castles.ts` split.** Read the file fully before splitting — the draw code likely references castle level sprites (`castle-l1/2/3.png`) and the entity state shape; preserve both halves exactly. The sprite list lives in `src/resources/`.
- **Unused `planEnemyMove`.** Confirmed unused in `main.ts`; safe to delete during the `enemyWander.ts` move.
- **`window.__gameDebug`** in `main.ts` references many internals; after refactor it must keep working because the smoke test may read it.

## Out of scope

- Creating placeholder files for not-yet-built modules (per "Implementation order" step 13 note). The empty directories are the deliverable; the modules land with their milestones.
- Renaming public types or changing `Game` / `Hero` / `GameMap` / `Renderer` / `Camera` APIs.
- Server, schema, test, or tool changes.
- Adding a `src/index.ts` barrel.
