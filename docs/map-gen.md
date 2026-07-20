# Procedural Map Generation

> Status: 📋 Planned for review. Current implementation: **blob growth** (see `src/map/gameMap.ts` → `generateTerrain`). This doc covers alternatives and when to swap.

## Current implementation: blob growth

`generateTerrain(rng, width, height)` in `src/map/gameMap.ts`:

1. Fill the grid with `grass`.
2. For each non-grass terrain (`mountain`, `desert`, `water`, `forest`, `dirt`) in order of scarcity:
   - Seed N random starting tiles (the "blobs").
   - Repeatedly pick a random tile from the growing frontier; if it's still grass, convert it to the target terrain and add its 6 hex neighbors to the frontier.
   - Stop at the target fraction of the map.
3. Unclaimed tiles stay grass.

**Why this works:** terrain ends up in coherent clusters (a forest, a mountain range, a lake) instead of salt-and-pepper noise. Different seeds produce visibly different maps because the blob seeds and growth order are both RNG-driven.

**Properties:**
- ~30 lines, zero dependencies.
- Deterministic per seed (mulberry32).
- O(terrain_count × max_steps) — fine for 24×18, acceptable up to ~50×40.
- Coarse: no smooth coastlines, no elevation gradients. Forests are blobs, not density fields.

## Alternatives, ranked by complexity

### 1. Biome regions (simplest upgrade)

Divide the map into a small grid (e.g. 4×3 of ~6×6-tile regions). For each region, pick a dominant biome at random (forest-heavy, mountain-heavy, water-heavy, etc.). Within each region, bias `pickTerrain` toward that biome's distribution.

- **Pros:** ~20 lines. Very natural-looking (large forest belts, mountain ranges). Different seeds → wildly different continental shapes.
- **Cons:** Region edges are visible seams. No sub-region detail.
- **Scale:** Excellent at any size — the region count is what matters, not the map size.
- **Swap cost:** Trivial. Replaces `generateTerrain` only.

### 2. Value noise / Perlin / Simplex (the classic)

Sample a 2D smooth noise function (Perlin, Simplex, or value noise) at each tile. Threshold the noise to pick terrain. Multi-octave (3–5 layers at different frequencies) gives natural variation: large-scale biome + medium-scale features + small-scale detail.

- **Pros:** The standard for natural-looking terrain. Smooth coastlines, gradual transitions, convincing mountain ranges. Libraries exist (`simplex-noise` is ~3 KB).
- **Cons:** Needs a noise implementation or a small dep. Choosing thresholds per terrain is fiddly. Outputs are still "noisy" — you may want a heightmap + biome pass on top.
- **Scale:** Linear in tile count. Works great at 240×180.
- **Swap cost:** Add `src/map/noise.ts` (~50 lines if rolling your own value noise) or `npm i simplex-noise`. Replace `generateTerrain`.

### 3. Heightmap + biomes (the "real" approach)

Generate a heightmap via 2–3 octaves of Perlin/Simplex. Then assign biomes by height: ocean (< 0.2), beach (0.2–0.25), grassland (0.25–0.5), forest (0.5–0.7), mountain (> 0.7). Add moisture noise (second channel) to subdivide grassland into grass/desert.

- **Pros:** The most natural-looking terrain of any option. Mountain ranges form ridges, rivers naturally follow low points, biomes make geographic sense. This is what Civilization and most 4X games use.
- **Cons:** ~100 lines of code (noise + thresholds + moisture pass). Two noise channels needed.
- **Scale:** Linear. The 10× map size is the sweet spot for this approach.
- **Swap cost:** Moderate. New module, new terrain types (beach, hill, swamp possible).

### 4. Voronoi / cellular noise

Scatter N seed points across the map. Each tile belongs to its nearest seed's region. Assign each seed a random terrain. Tiles near a region boundary can blend or pick the most common neighbor.

- **Pros:** Produces continent-like shapes with clear regional identity. Visually distinct from Perlin — more "polygonal."
- **Cons:** Boundaries are straight lines. Needs smoothing pass to look natural. N needs to scale with map size.
- **Scale:** O(tiles × seeds) naive, but spatial indexing makes it fast. Works at any size.
- **Swap cost:** Medium. ~80 lines with a simple grid-based nearest-seed lookup.

### 5. Marching squares / dual contouring (overkill for now)

Treat the noise as a continuous field, extract contour lines (coastlines, biome borders) as smooth polygons, rasterize into hexes. Used by some modern 4X games for hand-crafted-looking maps.

- **Pros:** Smoothest possible coastlines and biome borders.
- **Cons:** Complex (~200+ lines). Overkill for a hex grid where each tile is already discrete.
- **Scale:** Irrelevant — this is the wrong tool for a tile-based game.
- **Swap cost:** High. New subsystem.

## What we have now vs. what's worth it

| Approach | Lines | Deps | Natural look | Scales to 240×180? | Recommended for |
|---|---|---|---|---|---|
| Blob growth (current) | ~30 | 0 | Coarse clusters | Marginal — frontiers grow | 24×18 (now) |
| Biome regions | ~20 | 0 | Regional character | Yes | Quick upgrade if blobs feel flat |
| Perlin/Simplex | ~50–80 | 0–1 | Smooth terrain | Yes | Sweet spot at 10× size |
| Heightmap + biomes | ~100 | 0–1 | Best | Yes | When you want Civ-quality maps |
| Voronoi | ~80 | 0 | Continent shapes | Yes | Alternative to Perlin if you want polygonal feel |
| Marching squares | ~200+ | 0 | Smoothest | Yes | Overkill — skip |

## Recommendation

**Keep blob growth for now.** It's deterministic, zero-dep, and fits the current map size. When you bump to 10×:

1. **First try:** bump blob counts and frontier cap. Add a simple smoothing pass (each tile adopts the majority terrain among its 6 neighbors, 2 iterations). This might be enough.
2. **If that still looks flat:** switch to Perlin/Simplex with a single noise channel. Pick terrain by thresholding. ~50 lines, one optional dep.
3. **If you want Civ-quality:** heightmap + moisture. Worth it because the 10× map size justifies the complexity.

## Determinism guarantee

Whichever approach we pick, the smoke test in `test/smoke.ts` (`runDeterminismChecks`) must continue to hold:

```ts
const m1 = new GameMap(42);
const m2 = new GameMap(42);
assert.deepEqual(m1.resourceTiles, m2.resourceTiles, "..."); // still passes
```

`GameMap` already uses `mulberry32(seed)` for both terrain and resource placement. Any swap to Perlin/Voronoi/etc. must use the same RNG or a seedable equivalent. The smoke test should be extended to assert `m1.tiles` equality too.

## When the size grows

The 10× jump (24×18 → ~76×57, or 240×180 if true 10× area) changes the calculus:

- **Blob growth** frontier grows with map area; the random-pick becomes slow and biased toward the center. Guard step count needs to scale, and the per-iteration cost goes up.
- **Perlin/Simplex** is linear in tile count — easy.
- **Heightmap + biomes** same — linear, and the visual payoff is biggest at large sizes.

The schema already accommodates larger maps (`tiles (game_id, q, r)` has no size limit). `generateAndInsertTiles` in `server/routes.ts` builds one big VALUES list — fine for thousands of rows, but at 100k+ tiles you'd want `COPY` or chunked inserts. Not a concern until then.

## Cross-references

- Map data model: [map.md](./map.md)
- Terrain + biome rules: [map.md](./map.md) § "Terrain types", § "Biome rules (summary)"
- Resource placement (separate RNG, same seed scheme): [resources.md](./resources.md)

[← Back to index](./README.md)
