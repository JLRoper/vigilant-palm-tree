# Phase 5.B Final — Renderer / CityRenderer Scene-Consumer Rewrite

**Date:** 2026-08-19
**Owner:** Dev B (renderer surface; this doc), Dev A can pick up the §3 Track 5.A tail in parallel.
**Status:** Draft. Plan for the next work session.
**Closes:** `issue #97` ("Complete Phase 5 part B"), §7.2 exit criteria, opens §3 to Track 5.A's tail.

---

## 1. Why this is the next phase

§7.2 ("Track 5.B — Scene Graph Builder & Entity Mirror") of `2026-08-17-consolidated-phase-1-5-track-map.md` listed six items; the recent batch closes all but the last one:

| §7.2 item | Status before this batch | Status now |
|---|---|---|
| `adventureScene.ts` (pure) | ✅ | ✅ |
| `cityScene.ts` (pure) | ✅ | ✅ |
| `battleScene.ts` (pure) | ✅ | ✅ |
| `paint2d/` dispatcher shell + dep seam | 🟡 partial | ✅ (Commit 1 — seam only) |
| `paint2dDefaults.ts` (only file allowed to wire the Vite-coupled sprite keys) + `skybox.ts` (only file allowed to take on the `?url` skybox PNG imports) | ⬜ not started | ✅ (**Commit 2** — PR #122 merged) |
| `paint2d/` per-kind Canvas transcription (28 stubs → real `paint<X>(ctx, node, deps)` calls) | ⬜ not started | ✅ (**Commits 3–10** — PR #135 merged for Commit 3, PR #136 open for Commits 4–10) |
| `entityMirror.ts` subscribes to events, smooth tweening without rAF | 🟡 partial (`HeroMoved`/`SettlementCaptured` only) | 🟡 partial — *deliberately still unwired* (depends on Track 5.A's event-cursor delivery, §3 below) |
| `manualBattleArena.ts` decomposition (CB-1..CB-5) | 🟡 CB-1/2/3 merged, CB-4 in progress | ✅ **all merged** (PRs #112, #113, #115, #117) |
| **`renderer.ts` / `cityRenderer.ts` rewritten to consume `SceneNode[]` instead of state directly** | **⬜ not started — deliberately last** | **⬜ still not started — this doc's scope** |

That last row is the only remaining piece of Track 5.B. It is the **highest-risk step** because it is the only §7.2 item that touches the live render path. It is also the **smallest source-diff step**: both `MapRenderer` (the orchestrator extracted in PR #122) and `drawCityView` already delegate most of their draw logic to per-kind classes, so the rewrite is a "swap the data source, keep the painters" exercise.

---

## 2. Scope

Two files. No new abstractions, no new modules, no new tests beyond the existing seam + integration ones.

### 2.1 `src/render/renderer.ts` → `MapRenderer.draw()`

Current call site: `src/screens/adventure/adventureView.ts` and `src/managers/ViewManager.ts` build a `Hero[]`/`Castle[]` from a `GameState` snapshot and hand it to `MapRenderer.draw(hover, heroes, path, castles, opts)`.

**Target signature:**

```ts
class MapRenderer {
  draw(
    hover: Axial | null,
    nodes: SceneNode[],   // buildAdventureScene(...) output
    frame?: Paint2DFrame, // unused for adventure (no citySkybox nodes) but accepted for API symmetry
  ): void;
}
```

Internally, the body shrinks to a single call: `paintScene(ctx, nodes, deps, frame)`. The current per-frame orchestration (BackgroundPainter + HexTerrainPainter + HexHoverPainter + HeroPainter + CastlePainter + CharterPainter + the resource-icon/territory/path overlays, plus the minimap secondary draw) either disappears (the painter classes were already extracted and are subsumed by the `paint<X>` functions) or becomes a thin wrapper around the equivalent `paint<X>` calls.

**Per-class migration matrix (the only non-trivial part of this commit):**

| Current call inside `MapRenderer.draw()` | Becomes |
|---|---|
| `BackgroundPainter.paint(ctx, w, h, "#0a0a0a")` | `ctx.fillStyle = "#0a0a0a"; ctx.fillRect(0, 0, w, h);` (inline; the class is gone) |
| `HexTerrainPainter.paint(ctx, map, visible)` — iterate q/r, call `paintHex`/`paintDecoration`/`paintFogHex` | The scene builder already emits `terrainHex`/`terrainDecoration`/`fogHex` nodes — `paintTerrainHex` + `paintTerrainDecoration` + `paintFogHex` consume them. Class deleted. |
| `HexHoverPainter.paint(ctx, hover, visible)` | `paintHoverHighlight(ctx, hoverHighlightNode, deps)` if `hover` is in `visible`. Class deleted. |
| `HeroPainter.paint(ctx, heroes, sprites, visible, opts)` | The scene builder already emits `hero` nodes — `paintHero(ctx, heroNode, deps)` consumes them. Class deleted. |
| `CastlePainter.paint(ctx, castles, sprites, visible, opts)` | `paintCastle(ctx, castleNode, deps)`. Class deleted. |
| `CharterPainter.paint(ctx, charters, validCharterHexes, visible)` | `paintCharterOverlay(ctx, charterOverlayNode, deps)` + `paintValidCharterHex(ctx, validCharterHexNode, deps)`. Class deleted. |
| `drawResourceIcons(ctx, sprites, map, visible)` | `paintResourceIcon(ctx, resourceIconNode, deps)`. `overlays/resourceIcon.ts` deleted. |
| `drawTerritoryOutlines(ctx, castles, colorForOwner, w, h, visible)` | `paintTerritoryOutlineEdge(ctx, territoryOutlineEdgeNode, deps)` — the scene builder already emits the pre-partitioned edges, so the whole `controlledPositions`/`territoryBoundaryEdges`/`hexDistance` partitioning math moves out of the render layer (into `adventureScene.ts`'s `buildTerritoryOutlineEdges`, where it already lives per §7.2). `overlays/territoryOutline.ts` deleted. |
| `drawPathOverlay(ctx, heroes, path, map, opts)` | `paintPathSegment(ctx, pathSegmentNode, deps)` — the scene builder already splits reachable vs unreachable. `drawTrail` becomes `paintHeroTrail(ctx, heroTrailNode, deps)`. `overlays/pathOverlay.ts` deleted (but the export `computeReachableSplit` stays in `overlays/pathOverlay.ts` as a pure helper, OR moves to `scene/sceneBuilder/adventureScene.ts` since only the scene builder calls it). |
| `drawMinimapPath(...)` | No equivalent `SceneNode` kind. The minimap is its own self-contained secondary view; the cleanest fit is to leave its draw inline at the end of `MapRenderer.draw()` for now (the scene graph doesn't model minimap content; adding `minimapPath`/`minimapHex`/`minimapHero` node kinds is a separate doc). |

**Files this commit touches:**
- `src/render/renderer.ts` — rewrite `draw()` body; delete the painter classes
- `src/render/painter/{Background,HexTerrain,HexHover,Hero,Castle,Charter}Painter.ts` — deleted
- `src/render/painter/index.ts` — deleted (the barrel)
- `src/render/overlays/{resourceIcon,territoryOutline}.ts` — deleted (logic moved into scene builders)
- `src/render/overlays/pathOverlay.ts` — keeps only `computeReachableSplit` (the rest is duplicated in `scene/paint2d/index.ts`)
- `src/render/decorationSeed.ts` — deleted (moved inline to `paint2d/index.ts` in Commit 3)
- `src/screens/adventure/adventureView.ts` — replace `MapRenderer.draw(hover, heroes, path, castles, opts)` with `MapRenderer.draw(hover, buildAdventureScene({...}))`
- `src/managers/ViewManager.ts` — same call-site swap

**Callers that stay unchanged:** `ViewManager.ts`'s `MapRenderer(ctx, map, camera, sprites, minimapCamera)` constructor signature; `hoverFromScreen(x, y)`; the `.map` field (still needed by `hoverFromScreen`). The construction site doesn't care about the data flow.

### 2.2 `src/render/cityRenderer.ts` → `drawCityView()` rewrite

Current call site: `src/screens/city/cityView.ts` builds `DrawCityViewOptions` (a 12-field bag wrapping the city layout math) and hands it to `drawCityView(ctx, opts)`.

**Target signature:**

```ts
function drawCityView(ctx, nodes: SceneNode[], frame: Paint2DFrame): void;
```

The `cityScene.ts` builder (already done, §7.2 ✅) takes the same `DrawCityViewOptions`'s payload as input and emits a `SceneNode[]` containing `citySkybox`, `cityCell`, `cityResourceSpot`, `cityMine`, `cityBuilding`, `cityGhostBuilding`, and `cityLabel` nodes. Internally, `drawCityView` becomes a thin `paintScene(ctx, nodes, arenaPaint2dDeps, frame)` call. The `CITY_BG` constant moves into `paint2d/index.ts` (already there from Commit 9).

**Files this commit touches:**
- `src/render/cityRenderer.ts` — body collapses to one call; `computeCityScale` and the `DrawCityViewOptions` interface move out (see §2.3 below)
- `src/screens/city/cityView.ts` — call site swap
- `src/buildingPlacer.ts` — was the only other consumer of `computeCityScale`; either use the `core/cityGrid.ts` re-export (already there from §7.2's side-fix) or import from there directly

### 2.3 Cleanup of the legacy city layout surface

`DrawCityViewOptions`'s 12 fields (`viewportW/H`, `settlementName`, `size`, `hover`, `ownerColor`, `provider`, `citySpots`, `cityMines`, `buildings`, `style`, `pattern`, `ghost?`, `selectedKeys?`) are *city-scene-builder inputs*, not *painter inputs*. They belong to `buildCityScene`'s call site, not to `drawCityView`'s.

- `cityScene.ts`'s `buildCityScene(input: CitySceneInput): SceneNode[]` (already exists per §7.2) — verify it takes all 12 fields as inputs; if it doesn't, widen it (likely the `citySpots`/`cityMines`/`buildings` arrays moved into the scene builder in the original §7.2 commit, so this is probably already done — verify and skip otherwise).
- Delete `DrawCityViewOptions` from `cityRenderer.ts`.
- Delete the `TIER_LABELS` / `STYLE_LABELS` constants — they were only used to compose the `ctx.fillText` overlay (now `paintCityLabel` nodes).

### 2.4 `combat` / `battle` already done

CB-1 through CB-5 are all merged (`#112`, `#113`, `#115`, `#117`). `manualBattleArena.ts` is a 16-line shim delegating to `arena/openManualBattleArena.ts`, which already has the `?paint=scenebuilder` flag wired through `paintSceneForArena()`. **Nothing to do here**; this doc explicitly does *not* touch the battle surface.

---

## 3. The Track 5.A tail (parallel work, Dev A's slice)

Not part of this commit, but should not be forgotten. The two outstanding ⬜ items in §7.1 depend on a server-side decision that nobody owns today:

1. **Decide ownership of `server/routes.ts:485`'s `?after=<id>` cursor filter.** §8 currently assigns it to nobody. Most natural owner is Track 5.A itself (one-line `AND id > $2` clause on the existing query, plus a test in `test/server/events.test.ts` that asserts pagination works). Confirm before the next session.
2. **Once that's decided:** rewrite `src/io/multiplayerSync.ts` from full-state polling (`api.getGame()` → `hydrateGameState()`) to cursor polling (`GET /games/:name/events?after=<lastId>` → apply events through `@heroes/engine`).
3. **Then:** wire `src/managers/GameSessionManager.ts`'s `loadGame()` to initialize the cursor (currently calls `getMultiplayerSync().start()` against the old full-state poller).
4. **Last:** delete `SessionManager.manualSave()`'s `PATCH` (currently still exercised by `test/smoke.ts`'s Save-button + "Last saved" assertion). Either replace the assertion with one against the new persistence-confirmation mechanism, or accept the test-update cost as part of the same commit.

Once §3 is done, `entityMirror.ts`'s `applyEvent()` can be wired live (currently a pure helper — the unit tests pass but nothing calls it from a real game loop), and §7.2's exit criteria is *truly* met (animations driven by events, not by state polling).

---

## 4. Exit criteria for this commit

1. `renderer.ts`'s `MapRenderer.draw(...)` body is ≤30 lines (a single `paintScene` call plus the minimap secondary view).
2. `cityRenderer.ts`'s `drawCityView(...)` body is ≤10 lines (a single `paintScene` call).
3. All six `painter/*` files and their barrel are deleted from the filesystem (not commented out, deleted).
4. `src/render/overlays/{resourceIcon,territoryOutline,pathOverlay}.ts` are deleted or shrunk to just their pure helpers.
5. `src/render/decorationSeed.ts` is deleted (already moved to `paint2d/index.ts` in Commit 3 — this commit removes the duplicate).
6. `npm run build`, `npm run lint:deps`, `npm run test:all` all green.
7. The `cityview` browser suite in `test:all` still passes (visual byte-equivalence with the pre-rewrite draw — the painter classes were extracted byte-for-byte in PR #122, and the `paint<X>` functions in `paint2d/index.ts` were transcribed byte-for-byte in Commits 3–10).
8. The `smoke` browser suite still passes (the live `MapRenderer.draw()` call path is exercised by `test/smoke.ts`).
9. No new files added to `src/render/painter/` or `src/render/overlays/` (this commit deletes, doesn't expand).

---

## 5. Risk register (in order of likelihood × impact)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| The minimap secondary view's draw isn't covered by `SceneNode` kinds and gets dropped | High | Medium | Don't drop — leave `drawMinimap` inline at the end of `MapRenderer.draw()` for now. Document the gap. Adding `minimapHero`/`minimapPath`/`minimapHex` node kinds is a separate doc (already called out in §2.1's table). |
| `adventureScene.ts`'s `buildTerritoryOutlineEdges` partitioning math subtly differs from `overlays/territoryOutline.ts`'s `drawTerritoryOutlines` partitioning | Low | High | The scene builder's partitioning logic was lifted out of `drawTerritoryOutlines` in §7.2's `adventureScene.ts` commit and unit-tested in `test/render/adventureScene.test.ts`. The test compares the resulting edges against `territoryBoundaryEdges` output for the same input. If green, the rendering output is byte-identical. |
| `MapRenderer.draw()`'s minimap camera state needs to be cleared/reset between the main draw and the minimap draw | Medium | Low | The minimap already uses `ctx.save()`/`ctx.restore()` around its `drawMinimap` call; this commit doesn't touch it. |
| `paint2dDefaults.ts`'s `createDefaultPaint2DDep()` (used by `arena/paint.ts` for `paintSceneForArena`) doesn't produce a `Paint2DDep` that's API-compatible with what `MapRenderer.draw()` now expects | Medium | High | Both call sites use the same `paintScene(ctx, nodes, deps, frame?)` entry point — there is no API divergence to worry about. The `arena` `Paint2DDep` is built by `buildArenaPaint2dDeps`; the `MapRenderer` one will use `createDefaultPaint2DDep` from `paint2dDefaults.ts`. Both satisfy the same `Paint2DDep` interface. |
| `paintCityBuilding`'s procedural fallback is missing (per PR #136's "Out of scope" note) | Medium | Low | The scene builder pre-resolves `buildingKey(style, kind, level)` and the painter uses `resolveSpriteForBuilding` for the sprite path. If no sprite is loaded, the painter is a no-op (visual gap). Mitigation: accept the gap for now; document it; the procedural style leaves (`cityBuildingDraw/{classic,blocky,...}.ts`) are importable and can be wired in a follow-up. |
| `BattleHexNode`'s hover overlay is missing (per PR #136's "Out of scope" note) | Low | Low | Adventure-scene hexes don't carry a hover overlay; the `hoverHighlight` node is a separate kind. No conflict. |
| The `combatAccent` field on `Paint2DDep` is only used by `manualBattleArena` and defaults to constants in `paint2dDefaults.ts` — does the adventure scene need a different default? | Low | Low | The defaults in `paint2dDefaults.ts` (`BATTLE_COMBATANT_ATTACKER` etc.) are battle-specific. The `MapRenderer` doesn't need `battleAccent` at all. Solution: make `battleAccent` optional in `Paint2DDep` (currently it defaults in `paint2dDefaults.ts` to the constants — but `createDefaultPaint2DDep`'s `battleAccent` arg is required for the type). Either provide an adventure-appropriate default or relax the type to `() => string` (the painter only calls it from battle nodes; the adventure call site never has battle nodes, so it never fires). |

---

## 6. Commit / PR plan

Single commit (consistent with the rest of Track 5.B's "merge as one big commit then optionally split retroactively" cadence):

- Title: `paint2d: rewire MapRenderer + drawCityView to consume SceneNode[] (Commit 11, §7.2 final)`
- Body: enumerate the per-class migration matrix, list every file deleted, list every call site changed, link to the §5 risk register, link to issue #97 closure.

Pre-push gate (per AGENTS.md): `npm run precommit-checker` runs `npm run build` + `npm run lint:deps` + `npm run test:all`. All three must be green. The `cityview` + `smoke` browser suites are the real proof — they render the live frame and diff it against the pre-rewrite baseline (the painter classes were byte-equivalent extractions in PR #122, and the `paint<X>` functions were byte-equivalent transcriptions in Commits 3–10, so the visual output must be byte-identical assuming the migration matrix in §2.1 is followed).

---

## 7. What this doc deliberately does NOT cover

- Adding `minimapPath` / `minimapHero` / `minimapHex` `SceneNode` kinds (so the minimap can also be scene-graph-driven). That's a separate doc, gated on this one landing first.
- Wiring `entityMirror.ts`'s `applyEvent()` into a real game loop (depends on Track 5.A's cursor delivery, §3 above).
- Adding the `?after=<id>` server-side cursor filter (Track 5.A's responsibility, §3 above).
- Restoring `BattleHexNode`'s hover overlay or `battleFloatingText`'s font-size-by-hexSize (called out as "Out of scope" in PR #136's body).
- Restoring `paintCityBuilding`'s procedural fallback (called out as "Out of scope" in PR #136's body).

---

## 8. Cross-references

- §7.2 of `2026-08-17-consolidated-phase-1-5-track-map.md` — the parent plan; update its "remaining" row + §12 "What's Next" once this commit lands.
- `src/render/docs/technical-spec.md` §7 (paint2d seam) and §7.2 (paint2dDefaults builder) — already documents the seam; add a §7.3 noting the renderer/cityRenderer consumers.
- Issue #97 "Complete Phase 5 part B" — closes when this commit lands + §3 is in flight.
- PRs: open is #136 (Commits 4–10); merged are #122 (Commit 2 — skybox + paint2dDefaults), #135 (Commit 3 — terrain hex / decoration / fog / hover), #117 (CB-4), #115 (CB-3), #113 (CB-2), #112 (CB-1).
- Track 5.A tail: §7.1 of the consolidated plan + the §3 of this doc.
