# Plan: Enforce `core/` leaf-only and prevent runtime circular imports

**Source risk:** `docs/architecture.md` line 124 — *Circular imports.*
**Status:** ✅ Resolved (2026-08-10) — implemented via `.kilo/plans/1786339629694-circular-dependency-cleanup.md`, commit `526398e` on `architecture/circular-dep-cleanup`. `dependency-cruiser.cjs` exists with layer rules, `npm run lint:deps` runs in the precommit gate. The "Current state" section below describes the **pre-cleanup** situation and is preserved as historical context.

## Current state (verified against latest build)

- `npm run build` passes; 235 modules transformed.
- `core/` files have the following non-self imports:

  | File | Imports |
  |---|---|
  | `src/core/events.ts` | `import type { Axial } from "./hex";` + `import type { HeroId, SettlementId } from "../state/gameState";` |
  | `src/core/control.ts` | `import type { Axial } from "./hex";` + `import type { CastleLevel } from "../entities/settlement";` + `import type { BuildingDef } from "../render/cityBuildingDraw";` + `import { computeSettlementBonuses } from "./buildingModifiers";` |
  | `src/core/citySpots.ts` | `import type { ResourceType } from "../map/resourceTiles";` + `import type { CityViewSize } from "./cityGrid";` |
  | `src/core/buildingRegistry.ts` | `import type { BuildingKind } from "../render/cityBuildingDraw";` + `import type { ResourceType } from "../state/gameState";` |
  | `src/core/buildingModifiers.ts` | `import type { BuildingDef } from "../render/cityBuildingDraw";` + `import { buildingPlayerEffects } from "./buildingRegistry";` |
  | `src/core/eventRegistry.ts` | `import { bus } from "./eventBus";` |

- `render/` → `systems/`/`views/`: zero matches. ✓
- `entities/` → `render/`/`systems/`/`views/`: zero matches. ✓
- `map/` → `render/`/`systems/`/`views/`: zero matches. ✓
- `systems/` → `render/`/`views/`: zero matches. ✓
- Vite warns that `src/map/gameMap.ts` is statically + dynamically imported (`views/multiplayerLobby.ts` vs `managers/GameEngine.ts`, `managers/GameSessionManager.ts`). Not a cycle — chunk-splitting only — but a code-smell to clean up.

**Net assessment:** No *runtime* cycles today. All cross-boundary `core/` imports are `import type` (erased at runtime) **except** the `buildingModifiers` ↔ `buildingRegistry` sibling pair inside `core/`, which is fine. The risk is that the principle is now only enforced by convention; any future value import from `core/` into a sibling would silently introduce a cycle.

## Goal

Make the layer rules machine-checkable so the next contributor (or AI agent) cannot accidentally introduce a circular import or a `core/` value-import from a sibling.

## Plan

### 1. Document the layer rules in `docs/architecture.md`

Update the "Notes on choices" bullet for `core/` (line 62) to spell out:

- `core/` may import from itself freely.
- `core/` may `import type` from any sibling layer for shared types (this is what is happening today).
- `core/` must **not** have value imports from any sibling layer.
- `render/` must not import from `systems/` or `views/`.
- `entities/`, `map/`, `systems/`, `views/`, `io/` may import from `core/` and from each other within the existing dependency graph recorded in `docs/module-documentation-and-relationships.md`.

### 2. Enforce layer boundaries with `dependency-cruiser` (chosen)

**Decision:** Use **`dependency-cruiser`** (~5 MB dev dep). The current `core/` type-import violation already slipped past doc-only review, proving prose rules aren't enough. `dependency-cruiser` builds the import graph and fails on any forbidden edge.

Install:
```
npm i -D dependency-cruiser
```

Create `dependency-cruiser.cjs` at repo root with these rules:

```js
module.exports = {
  forbidden: [
    {
      name: "no-core-value-import-from-siblings",
      severity: "error",
      comment: "core/ must stay leaf-only. Type-only imports (import type) are allowed; value imports are not.",
      from: { path: "^src/core" },
      to:   { path: "^src/(?!core/|debug/|data/|shared/)", dependencyTypes: ["exclude-types"] },
    },
    {
      name: "no-render-into-systems-or-views",
      severity: "error",
      comment: "render/ draws the world; it must not know about UI state.",
      from: { path: "^src/render" },
      to:   { path: "^src/(systems|views)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileType: "ts" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "require", "node"] },
  },
};
```

Add to `package.json` scripts:
```
"lint:deps": "depcruise src --config dependency-cruiser.cjs"
```

### 3. Clean up the static+dynamic import on `map/gameMap.ts`

Convert `src/views/multiplayerLobby.ts` to use a static import of `GameMap` (or push the dynamic import into a small dedicated `map/loadMap.ts` helper so only one static importer remains). Removes the Vite chunk-split warning and keeps the dependency graph uniform.

### 4. Wire `npm run lint:deps` into `precommit-checker`

Invoke `precommit-checker` (already defined as a subagent) and extend its run to include `npm run lint:deps` alongside `npm run build` and `npm run test:all`. Any new violation fails the pre-commit gate and the PR cannot land until the import graph is fixed or the rule is updated with justification in `docs/architecture.md`.

### 5. Update `docs/module-documentation-and-relationships.md`

Reflect the new `core/` type-import relationships so the "current state" doc stays consistent with `architecture.md`.

## Validation

- `npm run build` still passes.
- New `npm run lint:deps` (or `eslint .`) passes with zero violations.
- `precommit-checker` runs both `npm run build` and `npm run lint:deps` and exits 0.
- Manually verify: changing one `import type` in `src/core/` to a value import causes the linter to fail.

## Out of scope

- Renaming existing `import type` lines (they are correct today).
- Reworking the `managers/` or `views/` directory shape (separate concern).
- Any runtime refactor — this plan only adds a guardrail.
