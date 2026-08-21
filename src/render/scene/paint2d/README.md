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
function -- all 27 kinds are real Canvas transcriptions (PRs #135, #136), none
are stubs.

Two kinds are **run-batched** rather than painted one node at a time, because
their pre-cutover originals drew in passes rather than per item:

- consecutive same-owner `territoryOutlineEdge` nodes stroke as one path.
  `drawTerritoryOutlines()` batched per owner and the stroke runs at
  `globalAlpha: 0.45` with round caps -- per-edge strokes double-blend every
  shared endpoint into a visible bead.
- a run of `cityBuilding` nodes paints every building body first, and only
  then the dashed selection rings, matching `drawCityView()`'s two passes.
  Otherwise a later building can paint over an earlier one's ring.

Draw order is the scene builder's business, not the painter's: `paintScene`
walks the list it is given.

## Consumers

- `src/render/renderer.ts` -- `MapRenderer.draw()` (adventure map)
- `src/render/cityRenderer.ts` -- `drawCityView()` (city interior)
- `src/screens/combat/arena/paint.ts` -- `paintSceneForArena()` (battle,
  behind `?paint=scenebuilder`; see #143 for that flag's double-paint)

## Why this module exists

The headline pitfall is the Vite `?url` seam. A `node:test` import path that
crashes only outside Vite is exactly the kind of thing that slips in
undiscovered, so the seam test (`test/render/paint2d.seam.test.ts`) **fails
loudly** the moment the boundary leaks -- before any Canvas work depends on it.

The second reason is the one issue #148 paid for: while `paint2d/` sat unwired
next to a live `src/render/painter/` set drawing the same things, the two
drifted apart in six separate ways and nothing caught it, because only one of
them ran. There is now one painter set, and `npm run test:visual` diffs its
output against committed screenshots.
