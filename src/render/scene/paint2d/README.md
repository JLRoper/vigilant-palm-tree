# `paint2d/` — Canvas2D Painter Boundary

This module is the Canvas2D consumer of the `SceneNode[]` union produced by
`src/render/scene/sceneBuilder/{adventureScene,cityScene,battleScene}.ts`. The
plan doc's §7.2 and revision note 4 are the canonical source for *why* this
seam exists. TL;DR: the painter must be pure-importable from `node:test`, so it
cannot transitively import any module that has Vite `?url` asset specifiers at
module scope.

## The boundary

**Allowed to import from inside `paint2d/`:**

- `src/render/scene/types.ts` (pure types)
- `src/core/hex.ts` (pure math)
- `src/core/cityGrid.ts` (pure math)
- `src/map/terrain.ts` (re-exports `TERRAIN_COLORS` from `@heroes/engine`)
- `src/render/palettes.ts` (pure constants, verified)
- `src/render/cityBuildingDraw/primitives.ts` (pure helpers: `lighten`,
  `darken`, `buildingFootprint`, `buildingHeight`, `drawIsoBox`)
- `src/render/cityBuildingDraw/{classic,blocky,crystalline,organic,industrial}.ts`
  (style leaves — verified leaf-clean, only `primitives.ts` + `palettes.ts`)
- `src/render/heroSprites.ts` (procedural knight/demon — only imports a
  `ProceduralDrawer` type from `assetSource.ts`)
- **Type-only** imports of `src/state/settings.ts` (for `HorseVariant`,
  `ResourceStyle` types — never the value `settings()`)
- `@heroes/engine`, `@heroes/contracts` (the rules layer)

**Forbidden inside `paint2d/`** (the dependency-cruiser rule
`paint2d-cannot-import-asset-descriptors` and `paint2d-cannot-value-import-state`
enforce this at lint time):

- `src/render/assetDescriptors.ts` — ~100 `?url` PNG imports at module scope
- `src/render/assets.ts` — transitively pulls in `assetDescriptors.ts`
- `src/render/sprites.ts` — imports the `*Key` helpers from `assetDescriptors.ts`
- `src/render/cityRenderer.ts` — 4 `?url` skybox imports at module scope
- `src/render/cityBuildingDraw.ts` (the barrel) — imports `buildingKey`
- `src/render/cityBuildingDraw/spots.ts` — imports `resourceStyleKey`
- `src/state/settings.ts` as a value import (singleton with cleanup lifecycle)

## The seam

`paint2d/` declares a `Paint2DDep` interface (see `deps.ts`). Every external
piece of state the painter needs is a *prop* of that interface, not an `import`
inside `paint2d/`. The two biggest seams:

1. **Sprite resolution.** Four per-kind helpers
   (`resolveSpriteForResource/Hero/Building/Castle`) wrap the `*Key` constructors
   from `assetDescriptors.ts`. The painter never names a key string. The
   default-deps builder at `src/render/paint2dDefaults.ts` (outside `paint2d/`,
   forthcoming) wires these from `assetDescriptors.ts`.

2. **Skybox.** The live `cityRenderer.ts` owns four `?url` skybox PNG imports
   + module-scope `skyboxCache`/`layerCanvasCache` Maps. The painter's
   `SkyboxProvider` dep (see `deps.ts`) replaces all of that. The skybox module
   at `src/render/skybox.ts` (forthcoming) owns the `?url` imports.

The default-deps builder and the skybox module are the **only two files** in the
painter project that are allowed to touch the forbidden set. They live outside
`paint2d/` so the painter itself stays pure-importable.

## The dispatcher

`src/render/scene/paint2d/index.ts` exports `paintScene(ctx, nodes, deps,
frame?)`. It switches on `node.kind` and dispatches to a per-kind painter
function. The per-kind functions are currently stubs (no-ops); the
1:1 Canvas transcription per kind is a follow-up commit sequence (Commits 3-10
in the design doc). This commit only establishes the module skeleton, the
dispatcher, the dep interface, the file tree, and the boundary enforcement.

## Why this commit exists

The headline pitfall of *this* module is the Vite `?url` seam. If we tried to
ship the actual Canvas transcription in one massive commit, the pitfall would
likely slip in undiscovered (a `node:test` import path that crashes only
locally, masked by Vite's loader elsewhere). The shell + seam approach
isolates the risk: the seam test (`test/render/paint2d.seam.test.ts`) **fails
loudly** if the boundary ever leaks, before any Canvas work touches the
forbidden imports.
