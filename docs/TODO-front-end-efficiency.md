# Front-End Efficiency TODO

<!-- docs:verified 2026-10-15 -->

**Status:** Historical performance backlog, not a current work queue. The drawing model below predates the scene-graph and pixel-building sprite cutovers, as well as the 2026-10-14..16 large-map performance rescue (Tiers 0, 1, and 3 — see [`docs/large-map-performance-report.md`](./large-map-performance-report.md)). Current paths are [`src/render/scene/sceneBuilder/cityScene.ts`](../src/render/scene/sceneBuilder/cityScene.ts), [`src/render/scene/paint2d/index.ts`](../src/render/scene/paint2d/index.ts), and [`src/render/docs/technical-spec.md`](../src/render/docs/technical-spec.md). Profile the current implementation before acting on any item.

## Rendering model tradeoff summary

| Approach              | What it stores                         | Per-frame cost            | Blocked by runtime params? |
|-----------------------|----------------------------------------|---------------------------|----------------------------|
| **Bake-once-blit** (existing sprite system) | One offscreen `<canvas>` per sprite key in RAM | One `ctx.drawImage()`    | Yes — `ownerColor` is free-form hex; requires one cache entry per `(kind, style, level, ownerColor)` combo |
| **Redraw-every-frame** (historical city painter) | Nothing | `ctx.fill()` / `ctx.lineTo()` / `ctx.stroke()` triangle calls | No — color is a fill argument |

The old procedural building painter used redraw-every-frame because the combinatorial space (`kind × style × level × ownerColor × w×h`) made bake-once-blit impractical for unbounded `ownerColor`. That painter is no longer the current rendering path; city buildings now flow through the scene painter and sprite resolvers.

## Future optimization

If profiling shows the city view hurting frame time (e.g. a 15×15 castle with 50+ buildings), the recovery path is:

1. Pre-bake one offscreen canvas per `(kind, style, level)` using a **neutral gray mask** (e.g. `#808080` where colors vary).
2. On each frame, blit the cached canvas with `ctx.drawImage(cached, x, y, w, h)`.
3. Immediately tint to `ownerColor` using a second pass:
   ```ts
   ctx.globalCompositeOperation = "source-atop";
   ctx.fillStyle = ownerColor;
   ctx.fillRect(x, y, w, h);
   ctx.globalCompositeOperation = "source-over";
   ```
4. Non-owner colors (wood, soil, crop greens) can be baked as-is since they don't vary per player.

This brings buildings into the asset system's "blit a cached canvas" pattern without the O(n × colors) cache footprint.

## Landscape items (not urgent)

- [ ] **Profile `cityView.draw()` at 15×15 with ~50 buildings + full spots/mines.** Determine whether triangle math or canvas fill is the bottleneck.
- [ ] **If buildings are the bottleneck**, implement the bake-then-tint optimization described above.
- [ ] **If `drawSpot`/`drawMine` sprite resolution is invasive**, consider pre-resolving and hoisting lookups out of the hot loop.
- [ ] **Consider off-screen culling** if the city view ever gains pan/zoom (currently static framing per the impl-plan).
- [ ] **Adventure map hex rendering** — same immediate-mode pattern. Not a concern at the current map sizes, but file a note here for completeness.
- [ ] **Batch fill/stroke state changes** in the building draw loop — currently each `drawBuilding()` call issues its own `ctx.save()`/`ctx.restore()` pairs and style resets. A batch pass that groups buildings of the same style/palette could reduce state flushes.

## Decision log

| Date       | Decision                                                                                |
|------------|-----------------------------------------------------------------------------------------|
| 2026-07-21 | Keep buildings as redraw-every-frame for v1. Static entity count, no measured perf issue. |
| 2026-07-21 | Added `TODO-front-end-efficiency.md`.                                                 |
