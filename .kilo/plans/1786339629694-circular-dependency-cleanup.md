# Plan: Circular Dependency Full Cleanup (Option C)

**Status:** ✅ Implemented — commit `526398e` on branch `architecture/circular-dep-cleanup` (2026-08-10). All five boundary violations fixed; `dependency-cruiser.cjs` + `npm run lint:deps` enforce the layer rules and are wired into the precommit gate. Not yet merged to `main`.
**Build baseline:** `npm run build` passes clean (235 modules).

---

## What We're Fixing (All Five)

| # | Violation | Root cause |
|---|---|---|
| 1 | `shared/combat/*` value-imports from `src/core/`, `src/state/` | `shared/` is supposed to be leaf; instead it reaches up into `src/` |
| 2 | `server/routes.ts` imports from `src/` | Server depends on client bundle source tree |
| 3 | `state/gameState.ts` → `render/buildingStyleResolver` (value), `state/settings.ts` → `render/horseVariants` (value) | State layer draws a runtime dep on render logic |
| 4 | `core/events.ts`, `core/control.ts`, `core/citySpots.ts`, `core/buildingRegistry.ts`, `core/buildingModifiers.ts` all `import type` from sibling layers | Unenforced convention — one value import away from a real cycle |
| 5 | `views/cityView.ts` value-imports from `managers/CityDesignBoxManager` | Views shouldn't depend on managers; potential cycle vector |

## Approach

Move all cross-boundary types and pure functions into `shared/`, making it the canonical leaf layer. Both `src/` and `server/` import from `shared/`. Then add `dependency-cruiser` to machine-enforce the layer rules.

The ordering below keeps the build green at every step. Each step ends with `npm run build`.

---

## Step 1: Create shared leaf files

### 1a. `shared/types.ts` — cross-cutting domain types

Move these type definitions here (copy, don't delete originals yet):

| Type | Current home | Notes |
|---|---|---|
| `Axial` | `src/core/hex.ts` | Also copy `axialRound`, `hexDistance` |
| `ResourceType` | `src/state/gameState.ts:23` | `"gold" \| "wood" \| "stone" \| "iron" \| "arcane" \| "food"` |
| `HeroId`, `SettlementId`, `CharterId`, `PlayerId` | `src/state/gameState.ts:18-22` | String/number type aliases |
| `Faction` | `src/state/gameState.ts:19` | `"player" \| "ai"` |
| `CastleLevel` | `src/entities/settlement.ts:5` | `1 \| 2 \| 3` |
| `CastleVariant` | `src/entities/settlement.ts:6` | `0 \| 1` |
| `BuildingKind` | `src/render/cityBuildingDraw/types.ts:3-16` | 13-kind union |
| `BuildingDef` | `src/render/cityBuildingDraw/types.ts:18-26` | Interface with `gx/gy/kind/level/style/w/h` |
| `HorseVariantId` | `src/render/horseVariants.ts:12` | String union of 8 variant ids |

All are **pure type/value exports** — no Canvas, DOM, or rendering dependencies.

### 1b. `shared/units.ts` — unit types

Copy from `src/state/units.ts`:
- `UnitType` interface
- `Platoon` interface
- `PlatoonEntry` interface
- `AdvantageType` type
- `normalizePlatoons` function (pure array transform)

### 1c. `shared/rng.ts` — RNG

Copy from `src/core/rng.ts`:
- `mulberry32(seed: number)` factory (pure function, no global state)

### 1d. `shared/constants.ts` — shared constants

```ts
export const WAREHOUSE_RESOURCES = ["wood", "stone", "iron", "arcane", "food"] as const;
```

### 1e. `shared/styleResolver.ts` — building style picking

Copy `pickStyleForBuilding` from `src/render/buildingStyleResolver.ts`:
- `BUILDING_SPRITE_KEYS` array
- `hasBuildingSpriteKey` function
- `pickStyleForBuilding` function

This function is pure logic (string matching against sprite key list); no Canvas or DOM dependency. The `GenerationStyle` type it references is just a string type — define it inline or import from shared.

**Verify:** `npm run build` — should still pass (these files are created but not yet consumed).

---

## Step 2: Redirect src/ imports to shared/

For each `src/` file that currently imports cross-layer, update to import from `../../shared/`:

### 2a. `src/core/` files

| File | Remove cross-layer import | Replace with |
|---|---|---|
| `core/events.ts` | `import type { HeroId, SettlementId } from "../state/gameState"` | `import type { HeroId, SettlementId } from "../../shared/types"` |
| `core/control.ts` | `import type { CastleLevel } from "../entities/settlement"` | `import type { CastleLevel } from "../../shared/types"` |
| `core/control.ts` | `import type { BuildingDef } from "../render/cityBuildingDraw"` | `import type { BuildingDef } from "../../shared/types"` |
| `core/citySpots.ts` | `import type { ResourceType } from "../map/resourceTiles"` | `import type { ResourceType } from "../../shared/types"` |
| `core/buildingRegistry.ts` | `import type { BuildingKind } from "../render/cityBuildingDraw"` | `import type { BuildingKind } from "../../shared/types"` |
| `core/buildingRegistry.ts` | `import type { ResourceType } from "../state/gameState"` | `import type { ResourceType } from "../../shared/types"` |
| `core/buildingModifiers.ts` | `import type { BuildingDef } from "../render/cityBuildingDraw"` | `import type { BuildingDef } from "../../shared/types"` |

### 2b. `src/state/` files

| File | Change |
|---|---|
| `state/gameState.ts` | Replace `import { pickStyleForBuilding } from "../render/buildingStyleResolver"` → `import { pickStyleForBuilding } from "../../shared/styleResolver"` |
| `state/gameState.ts` | Replace local `ResourceType`/`HeroId`/`SettlementId`/`CharterId`/`PlayerId`/`Faction` type definitions with imports from `../../shared/types` |
| `state/gameState.ts` | Replace `import type { BuildingDef, BuildingKind } from "../render/cityBuildingDraw"` → `import type { BuildingDef, BuildingKind } from "../../shared/types"` |
| `state/settings.ts` | Replace `import { HORSE_VARIANT_REGISTRY, type HorseVariantId, VALID_HORSE_VARIANTS } from "../render/horseVariants"` → `import type { HorseVariantId } from "../../shared/types"` |

For `state/settings.ts`, we need `HORSE_VARIANT_REGISTRY` (value) and `VALID_HORSE_VARIANTS` (value) for the settings dropdown. These come from `render/horseVariants.ts`. **Option:** keep `HORSE_VARIANT_REGISTRY` as a value import from render (it's needed for the dropdown UI), but move `HorseVariantId` type and `VALID_HORSE_VARIANTS` to shared/. The `HORSE_VARIANT_REGISTRY` is a value array with `commanderDir` fields — it's genuinely render data. We'll add a `dependency-cruiser` exception for it with justification.

Actually, let me reconsider. `settings.ts` re-exports `HORSE_VARIANT_REGISTRY` and `VALID_HORSE_VARIANTS` for use by other files (`entities/hero.ts`, `render/sprites.ts`, `render/assetDescriptors.ts`, etc.). If `settings.ts` imports them from render, then everything that needs them gets them transitively from state. 

Better approach: move `HorseVariantId` and `VALID_HORSE_VARIANTS` to `shared/types.ts`, move `HORSE_VARIANT_REGISTRY` to `shared/horseVariants.ts` (it's pure data, no rendering). Then `settings.ts` imports from shared/.

Wait, `HORSE_VARIANT_REGISTRY` has `commanderDir` which controls animation. Is that rendering? It's a numeric property used by the sprite system. But it's pure data — no Canvas access.

Let me keep it simple: move `HorseVariantId`, `VALID_HORSE_VARIANTS`, and `HORSE_VARIANT_REGISTRY` all to `shared/horseVariants.ts`. They're pure constants with no rendering code.

### 2c. `src/entities/` files

| File | Change |
|---|---|
| `entities/settlement.ts` | Replace `import type { BuildingDef } from "../render/cityBuildingDraw"` → `import type { BuildingDef } from "../../shared/types"` |
| `entities/settlement.ts` | Replace `import type { PlayerId, ResourceType, ... } from "../state/gameState"` → `import type { PlayerId, ResourceType, ... } from "../../shared/types"` |

### 2d. `src/render/` files

`render/` files that import from `state/settings` already follow the rule (render → state is allowed). But after moving HorseVariant types to shared/, update those imports too for consistency:

Files importing from `state/settings` for HorseVariant: `sprites.ts`, `assets.ts`, `cityRenderer.ts`, `cityBuildingDraw/spots.ts`, `assetDescriptors.ts`, `hero.ts` (entity). Update to import directly from `../../shared/horseVariants` instead of going through settings.

### 2e. Re-export from original locations for backward compat

In `src/render/cityBuildingDraw/types.ts`, re-export from shared/:
```ts
export type { BuildingKind, BuildingDef } from "../../../shared/types";
```
In `src/map/resourceTiles.ts`, re-export ResourceType.
In `src/state/gameState.ts`, re-export types from shared/.

This keeps the existing import paths working for files we haven't updated yet.

**Verify:** `npm run build` passes after this step.

---

## Step 3: Update shared/ and server/ imports

### 3a. `shared/combat/*` files

| File | Change |
|---|---|
| `shared/combat/types.ts` | `../../src/core/hex` → `../types` (Axial) |
| `shared/combat/types.ts` | `../../src/state/units` → `../units` (Platoon, PlatoonEntry, UnitType) |
| `shared/combat/grid.ts` | `../../src/core/hex` → `../types` (Axial) |
| `shared/combat/grid.ts` | `../../src/core/rng` → `../rng` (mulberry32) |
| `shared/combat/damage.ts` | `../../src/state/units` → `../units` (PlatoonEntry, UnitType) |
| `shared/combat/resolveBattle.ts` | `../../src/state/units` → `../units` |
| `shared/combat/manualBattle.ts` | `../../src/core/hex` → `../types` (Axial, axialRound, hexDistance) |
| `shared/combat/manualBattle.ts` | `../../src/state/units` → `../units` |
| `shared/validation/gameIntegrity.ts` | `../../src/state/gameState` → `../../shared/types` |

### 3b. `server/routes.ts`

Current imports from `src/`:

| Current import | Replace with |
|---|---|
| `import { GameMap, type MapSize } from "../src/map/gameMap"` | `import { GameMap, type MapSize } from "../shared/map/gameMap"` — requires moving GameMap class to shared/ |
| `import { mulberry32 } from "../src/core/rng"` | `import { mulberry32 } from "../shared/rng"` |
| `import { makeInitialStatePayload } from "../src/game/initState"` | Keep from src/ for now — this function orchestrates map gen, castle placement, economy init. Moved to shared/map/initState.ts in a follow-up after Step 4. **Add dependency-cruiser exception.** |
| `import { tradeResources, applyEndOfTurnDetailed, WAREHOUSE_RESOURCES } from "../src/state/gameState"` | With shared/types.ts in place and pickStyleForBuilding moved to shared/, `applyEndOfTurnDetailed` becomes importable from shared/. Keep the reducer in `src/state/gameState.ts` but also re-export from `shared/gameState.ts`. **OR:** import the individual reducers from `../shared/reducers` after extraction. |
| `import type { Platoon, UnitType } from "../src/state/units"` | `import type { Platoon, UnitType } from "../shared/units"` |
| `import { normalizePlatoons } from "../src/state/units"` | `import { normalizePlatoons } from "../shared/units"` |

#### 3b detail: GameMap move

`src/map/gameMap.ts` depends on:
- `./terrain` (pure types + colors + cost map)
- `./resourceTiles` (resource placement — uses GameMap, careful)
- `../core/hex` (moved to shared/)
- `../core/rng` (moved to shared/)

Resource tiles depends on GameMap. This is a circular dependency between gameMap and resourceTiles. But it's a logical dependency: `placeResourceTiles(map)` takes a GameMap parameter. We can extract the interface it needs.

**Decision:** Move `GameMap` class and `MapSize` type to `shared/map/gameMap.ts`. Move `terrain.ts` types (`Terrain`, `TERRAIN_COLORS`, `TERRAIN_COST`, `isPassable`) to `shared/map/terrain.ts`. Leave `resourceTiles.ts` in `src/` since it's a generator that produces data for GameMap — it's called by GameMap during construction, not the other way around.

Wait, actually `gameMap.ts` imports from `resourceTiles.ts` at line: `import { placeResourceTiles } from "./resourceTiles"`. And `resourceTiles.ts` imports `GameMap` from `./gameMap`. This IS a file-level circular value import! Let me check...

Actually, `resourceTiles.ts` imports `import type { GameMap, MapSize } from "./gameMap"` — it's `import type`! So it's not a runtime cycle. The type import is erased. At runtime, `gameMap.ts` calls `placeResourceTiles(this)`, which takes a GameMap parameter — the type is only needed at compile time.

So: both `gameMap.ts` and `resourceTiles.ts` can move to `shared/map/`, with `terrain.ts` moved too.

#### 3b detail: applyEndOfTurnDetailed

This function is ~150 lines of pure domain logic in `state/gameState.ts`. After our changes:
- It no longer imports `pickStyleForBuilding` from render (now from shared/styleResolver.ts)
- It no longer defines types locally (now from shared/types.ts)
- It still imports from `economy/consumption`, `economy/settlementRates`, `core/buildingRegistry`

The economy files import from `state/gameState.ts` for types, which would create a circular dependency if we move the reducer. Instead: extract the `applyEndOfTurnDetailed` function into `shared/turns/endTurnReducer.ts` as a standalone pure function. It takes GameState in, returns GameState out, with all needed types from shared/.

This requires also moving helper types that `applyEndOfTurnDetailed` references (SettlementState, TurnPhase, etc.) to shared/. Since we already put the core IDs in shared/types.ts, these larger state types should also go there.

**Decision for Step 3:** Keep `applyEndOfTurnDetailed` in `src/state/gameState.ts` for now and re-export it from `shared/gameState.ts`. The server imports from shared/. In a follow-up PR, extract the reducer to `shared/turns/`. This keeps Step 3 bounded.

Actually wait, the function still references `pickStyleForBuilding` which we already moved to shared/. And it references types that we've already moved to shared/types.ts. So the function body no longer has any render dependency. It CAN be cleanly imported from shared/ if we create a re-export file.

Simplest Step 3 approach: Create `shared/gameState.ts` that re-exports:
```ts
export { tradeResources, applyEndOfTurnDetailed, WAREHOUSE_RESOURCES } from "../src/state/gameState";
```
And `server/routes.ts` imports from `../shared/gameState` instead of `../src/state/gameState`.

This is a stepping stone — the function still lives in `src/` but the import path is through `shared/`, so the dependency direction is correct at the import-graph level. The actual extraction of the reducer body to `shared/turns/` is a follow-up (R9 from the bloat review).

**Verify:** `npm run build` passes. Server starts and serves API responses identically.

---

## Step 4: Clean up re-exports and remove duplicated definitions

Once all consumers import from `shared/`:
- Remove the now-duplicated type definitions from original files
- Remove the stepping-stone re-exports from `shared/` that point to `src/`
- Verify no file in `src/` still imports a cross-layer type that's now in shared/

**Verify:** `npm run build` passes. `npm run test:all` passes.

---

## Step 5: Fix views/cityView.ts → managers/CityDesignBoxManager

`CityDesignBoxManager` is a pure-DOM UI component (creates a div with buttons, no canvas, no state management). It has zero imports. It lives in `managers/` by convention only.

**Action:** Move `src/managers/CityDesignBoxManager.ts` → `src/views/CityDesignBoxManager.ts`.
Update `src/views/cityView.ts:16` to import from `./CityDesignBoxManager`.

**Verify:** `npm run build` passes. City view opens and the "City Design" panel renders correctly at bottom-left.

---

## Step 6: Add dependency-cruiser machine enforcement

### 6a. Install
```bash
npm i -D dependency-cruiser
```

### 6b. Create `dependency-cruiser.cjs` at repo root

```js
module.exports = {
  forbidden: [
    // core/ is leaf-only: no value imports from sibling layers
    {
      name: "no-core-value-import-from-siblings",
      severity: "error",
      from: { path: "^src/core" },
      to: { path: "^src/(?!core/|debug/|data/|shared/|game/|players/)", dependencyTypes: ["exclude-types"] },
    },
    // render/ must not import from systems/ or views/
    {
      name: "no-render-into-systems-or-views",
      severity: "error",
      from: { path: "^src/render" },
      to: { path: "^src/(systems|views)/" },
    },
    // state/ must not value-import from render/ or views/
    {
      name: "no-state-value-import-from-render-or-views",
      severity: "error",
      from: { path: "^src/state" },
      to: { path: "^src/(render|views)/", dependencyTypes: ["exclude-types"] },
    },
    // views/ must not import from managers/
    {
      name: "no-views-into-managers",
      severity: "error",
      from: { path: "^src/views" },
      to: { path: "^src/managers/" },
    },
    // shared/ must not import from src/ or server/
    {
      name: "no-shared-from-src-or-server",
      severity: "error",
      from: { path: "^shared" },
      to: { path: "^(src/|server/)" },
    },
    // server/ must not import from src/ (except documented exceptions)
    {
      name: "no-server-from-src",
      severity: "error",
      from: { path: "^server" },
      to: { path: "^src/" },
    },
    // entities/ must not import from render/ or views/ (value imports)
    {
      name: "no-entities-value-from-render-or-views",
      severity: "error",
      from: { path: "^src/entities" },
      to: { path: "^src/(render|views)/", dependencyTypes: ["exclude-types"] },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileType: "ts", configFileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node"],
    },
  },
};
```

### 6c. Add script
```json
"lint:deps": "depcruise src shared server --config dependency-cruiser.cjs"
```

### 6d. Wire into precommit-checker

Update the `precommit-checker` agent description (in `.kilo/agent/precommit-checker.md`) to also run `npm run lint:deps`.

---

## Step 7: Final validation

- `npm run build` — clean
- `npm run lint:deps` — zero violations
- `npm run test:all` — all pass
- Dev server (`npm run dev`) — renders map, pans/zooms, moves hero, builds city, runs end turn
- Server API — create game, load game, end turn, resolve battle all work

---

## Files to touch (estimated)

| Phase | Files changed |
|---|---|
| Step 1 (create shared/) | 5 new files |
| Step 2 (redirect src/) | ~15 files |
| Step 3 (redirect server/shared) | ~10 files |
| Step 4 (cleanup) | ~5 files |
| Step 5 (CityDesignBoxManager) | 2 files |
| Step 6 (dependency-cruiser) | 3 files |
| **Total** | ~40 files |

## Risks

- **Step 2e re-exports:** Must ensure no file ends up importing from both old and new paths during transition. Use `git grep` to verify after each sub-step.
- **GameMap circular import with resourceTiles:** Already safe (type-only import), but moving both to `shared/map/` should preserve the import relationship exactly.
- **State reducer extraction:** `applyEndOfTurnDetailed` references many internal types. Using re-exports from `shared/gameState.ts` as stepping stones avoids touching the function body in this plan. Full extraction (R9 in bloat review) is a follow-up.
- **settings.ts HorseVariant value import:** If `HORSE_VARIANT_REGISTRY` stays in `render/horseVariants.ts`, `settings.ts` still has a value import from render. Moving it to `shared/horseVariants.ts` is the final fix. We need to handle existing consumers of the registry (sprites, assetDescriptors, etc.) that import it from `settings.ts`.

## Out of scope

- Extracting `applyEndOfTurnDetailed` from `state/gameState.ts` into `shared/turns/` (R9) — follow-up
- Structured DB tables replacing JSONB (R1) — follow-up
- View layer split by screen (§4.4 in architecture expansion plan) — follow-up
- Render layer grouping by surface (§4.5) — follow-up
