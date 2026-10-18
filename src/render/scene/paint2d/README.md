# `paint2d/` — Current Canvas2D Painter

<!-- docs:verified 2026-10-18 -->

`paintScene(ctx, nodes, deps, frame?)` consumes the `SceneNode[]` union produced by `src/render/scene/sceneBuilder/`. It is the single Canvas2D painter for the adventure map, city view, and battle arena. Per-kind city-building painting lives in `index.ts`; there are no separate style-leaf painters.

## Current Path

- `sceneBuilder/adventureScene.ts`, `cityScene.ts`, and `battleScene.ts` decide which nodes to draw.
- `paint2d/index.ts` dispatches by node kind and paints the scene in list order.
- `src/render/renderer.ts` paints the adventure scene; `src/render/cityRenderer.ts` remains a thin `paintScene` wrapper; `src/screens/combat/arena/paint.ts` adapts the arena.
- `src/render/paint2dDefaults.ts` supplies sprite resolvers, settings, colors, and dependencies outside the pure painter.
- `src/render/skybox.ts` owns the skybox `?url` imports and image/parallax caches.
- `src/render/scene/paint2d/cityDiorama.ts` owns the biome-diorama city backdrop and its offscreen canvas cache; `paintCitySkybox` dispatches to it when the node's `backdropMode` is `diorama`.

## Boundary

The painter takes its external dependencies as `Paint2DDep` props from `deps.ts`: per-kind sprite resolvers for resources, heroes, buildings, castles, districts, and units; color/style getters; owner colors; and a `SkyboxProvider`. It does not import `assetDescriptors.ts`, `assets.ts`, `sprites.ts`, `cityRenderer.ts`, or game settings as runtime values. `paint2dDefaults.ts` is the adapter to those browser/Vite modules. For level-1 castles, `resolveSpriteForCastle(level, variant, fullness?)` resolves `castle.1.v${variant}.f${fullness ?? 1}` against the 20 Tier 1 settlement sprites in `src/resources/settlements/` (`settlement-l1-v{0..3}-f{1..5}.png`), where `CastleNode.fullness` is derived in `src/render/scene/sceneBuilder/adventureScene.ts` via `settlementFullnessForCount(count)` (Fullness 1: 0–3 buildings, Fullness 2: 4–6, Fullness 3: 7–9, Fullness 4: 10–12, Fullness 5: 13+).

Pure painter helpers are kept in `colors.ts` and `geometry.ts`. `index.ts` owns per-kind rendering, including city cells, resource spots, mines, pixel buildings, selection rings, and ghosts. Draw order is the builder's responsibility. Territory-edge runs and city-building bodies/rings are batched to preserve the established stroke order.

## Building Assets

Pixel buildings are sprite-first and have no procedural fallback. `gen-building-sprite-keys.mjs` emits `packages/engine/src/generated/buildingSpriteKeys.ts`; `gen-building-anchors.mjs` emits `src/render/generated/buildingAnchorOverrides.ts`. The exhaustive per-kind/per-level declaration remains in `packages/engine/src/buildingSpriteCoverage.ts`, guarded by `test/engine/buildingSpriteCoverage.test.ts`. `npm run validate-assets` checks generated key/anchor drift and other asset gates; the coverage unit test is a separate gate.

## Enforced Invariants

- `dependency-cruiser.cjs` forbids `assetDescriptors` imports and state value imports from this painter boundary.
- `test/render/paint2d.seam.test.ts` source-scans forbidden imports and imports the painter under bare `node:test`, where Vite `?url` specifiers cannot resolve.
- `npm run test:visual` protects the rendered scene baselines.

The former city-building drawing/generation modules and style folder are absent. Historical discussion of the former parallel painter lives in [`src/render/docs/technical-spec.md`](../../docs/technical-spec.md). Do not reintroduce those paths as current modules.
