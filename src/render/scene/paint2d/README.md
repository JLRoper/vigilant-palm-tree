# `paint2d/` — Current Canvas2D Painter

<!-- docs:verified 2026-10-11 -->

`paintScene(ctx, nodes, deps, frame?)` consumes the `SceneNode[]` union produced by `src/render/scene/sceneBuilder/`. It is the single Canvas2D painter for the adventure map, city view, and battle arena. Per-kind city-building painting lives in `index.ts`; there are no separate style-leaf painters.

## Current Path

- `sceneBuilder/adventureScene.ts`, `cityScene.ts`, and `battleScene.ts` decide which nodes to draw.
- `paint2d/index.ts` dispatches by node kind and paints the scene in list order.
- `src/render/renderer.ts` paints the adventure scene; `src/render/cityRenderer.ts` remains a thin `paintScene` wrapper; `src/screens/combat/arena/paint.ts` adapts the arena.
- `src/render/paint2dDefaults.ts` supplies sprite resolvers, settings, colors, and dependencies outside the pure painter.
- `src/render/skybox.ts` owns the skybox `?url` imports and image/parallax caches.

## Boundary

The painter takes its external dependencies as `Paint2DDep` props from `deps.ts`: per-kind sprite resolvers for resources, heroes, buildings, castles, and units; color/style getters; owner colors; and a `SkyboxProvider`. It does not import `assetDescriptors.ts`, `assets.ts`, `sprites.ts`, `cityRenderer.ts`, or game settings as runtime values. `paint2dDefaults.ts` is the adapter to those browser/Vite modules.

Pure painter helpers are kept in `colors.ts` and `geometry.ts`. `index.ts` owns per-kind rendering, including city cells, resource spots, mines, pixel buildings, selection rings, and ghosts. Draw order is the builder's responsibility. Territory-edge runs and city-building bodies/rings are batched to preserve the established stroke order.

## Building Assets

Pixel buildings are sprite-first and have no procedural fallback. `gen-building-sprite-keys.mjs` emits `packages/engine/src/generated/buildingSpriteKeys.ts`; `gen-building-anchors.mjs` emits `src/render/generated/buildingAnchorOverrides.ts`. The exhaustive per-kind/per-level declaration remains in `packages/engine/src/buildingSpriteCoverage.ts`, guarded by `test/engine/buildingSpriteCoverage.test.ts`. `npm run validate-assets` checks generated key/anchor drift and other asset gates; the coverage unit test is a separate gate.

## Enforced Invariants

- `dependency-cruiser.cjs` forbids `assetDescriptors` imports and state value imports from this painter boundary.
- `test/render/paint2d.seam.test.ts` source-scans forbidden imports and imports the painter under bare `node:test`, where Vite `?url` specifiers cannot resolve.
- `npm run test:visual` protects the rendered scene baselines.

The former city-building drawing/generation modules and style folder are absent. Historical discussion of the former parallel painter lives in [`src/render/docs/technical-spec.md`](../../docs/technical-spec.md). Do not reintroduce those paths as current modules.
