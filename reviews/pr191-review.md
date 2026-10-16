# PR #191 Review — `feat/add-larger-map-sizes`

- **PR:** [JLRoper/vigilant-palm-tree#191](https://github.com/JLRoper/vigilant-palm-tree/pull/191) · "feat: add huge and epic map sizes"
- **Reviewed at:** head `71f0948` (merge of `github/main` at `ae5169c`), 2026-10-15
- **CI:** `Build + smoke test` is **failing**. The cause is `Port 36049 is already in use` when the preview server starts, followed by a 60s `waitForFunction` timeout. This looks like a runner port collision, not a code failure. Re-run it before merging.

## 1. What the PR actually contains now

The title and description are **out of date**. Most of the branch's earlier work is already on `main`: huge/epic sizes, the Tier 0–3 performance work, the minimap LOD, the LRU map cache and the fog-filtered pathing. Against `main`, the diff is only **10 files, +269/−22**:

| Area | Change |
|---|---|
| `src/render/camera.ts` | `computeMinZoomForHexWidth`, `HEX_COLUMN_WIDTH`, `Camera.clampMinZoom`, a `minZoom` floor in `zoomAt`, and row-clipped bounds (`getRowQBounds`, `isTileInViewportBounds`, `wxMin/wxMax` added to `getVisibleAxialBounds`) |
| `src/render/scene/sceneBuilder/adventureScene.ts` | Terrain, resource and charter-hex loops now cull per row, trimming the corners of the sheared axial parallelogram |
| `src/state/settings.ts`, `src/screens/home/settingsMenu.ts` | New `maxZoomOutHexesWide` setting (20–34, default 20) and a "Max zoom-out width" slider |
| `src/screens/adventure/adventureView.ts` | Wheel zoom uses the floor; a settings subscription clamps the zoom when the cap changes |
| `test/render/fogAndTerritoryCache.test.ts` | Tests for the clamp, the zoom floor and row clipping |
| docs | Architecture, module and player-guide notes for the above |

**Recommendation:** retitle the PR to something like "perf(render): configurable zoom-out cap + row-clipped frustum culling" and rewrite the body. Most of the Copilot threads below point at code that is no longer in this diff.

## 2. Verdict

**Changes requested, but mostly not for this diff.** The new zoom-cap and culling code is small and sound, with one real defect: the zoom floor isn't enforced at startup or on resize. Several Copilot findings that are still valid now live on `main`, and one is P1 (save compatibility). They should be tracked as follow-up issues, not fixed here.

## 3. Copilot comments, checked against the current head

Legend: ✅ valid · 🟡 partly addressed or plausible · ❌ fixed or not valid · **In diff?** = whether the code is still part of this PR's diff against `main`

### Valid, high priority

| # | Finding | Verdict | In diff? | Notes |
|---|---|---|---|---|
| [r4289795786](https://github.com/JLRoper/vigilant-palm-tree/pull/191#discussion_r4289795786) | Terrain generator change breaks existing saves | ✅ **P1** | No (on main via `c52738e`) | The bitset frontier dedup plus swap-and-pop changes RNG consumption, so the same seed now produces different terrain. `main.ts:21` calls `loadGame(loaded)` without tiles, so `getOrCreateGameMap(seed, size)` regenerates the map. Old saves get a new world under their stored heroes, castles and charters. Fix: persist a generator version, or keep the legacy generator for old games. Add a fixture from the legacy generator. |
| [r4289501731](https://github.com/JLRoper/vigilant-palm-tree/pull/191#discussion_r4289501731) | Heroes can walk through fog-hidden enemies | ✅ | No | `clickIntent.ts` drops hidden heroes from `occupiedHexes`, so A* routes through them. `startMove` only checks occupancy at the destination (`move.ts:36-40`), and the adjacency check runs only after the move. Fix: keep hidden enemies out of the preview, but stop the executed route at the first tile occupied by a hidden enemy (an ambush or interrupt). |
| [r4290060957](https://github.com/JLRoper/vigilant-palm-tree/pull/191#discussion_r4290060957) | Zoom floor not enforced at init or resize | ✅ | **Yes** | Confirmed with numbers: `HEX_SIZE=32` gives a column width of about 55.4px, so the floor for 20 hexes on a 1920px viewport is ≈ **1.73**. The camera starts at `zoom = 1` (≈ 35 columns), which is already past the 34 maximum. `zoomAt` keeps `min(this.zoom, minZoom)` when zooming out, so the camera stays there. The first scroll-in then **snaps** from 1.0 to 1.73. Clamp in the constructor and on resize, and drop the "allow staying below the floor" branch. Also check whether a default of 20 is too tight: it is a much closer view than today's default framing. |

### Valid, medium or low priority

| # | Finding | Verdict | In diff? | Notes |
|---|---|---|---|---|
| [r4289795822](https://github.com/JLRoper/vigilant-palm-tree/pull/191#discussion_r4289795822) | `resolveMapSize` uses `in` | ✅ | No | `MAP_SIZES` is a plain object literal, so `"constructor" in MAP_SIZES` is true and gives `undefined` dimensions. The input comes from `games.map_size` and the request body, but server validation limits the risk. It's a one-line fix (`Object.hasOwn`). |
| [r4289795922](https://github.com/JLRoper/vigilant-palm-tree/pull/191#discussion_r4289795922) | `tileInfo` territory uses `controlRange(level, buildings)` | ✅ | No | `controlledPositions()` (`control.ts:26`), and so the drawn outline, ignores buildings. The tile popup can say "controlled" outside the drawn border. Pick one rule. Fog also uses the building bonus, so the fix might be to make the outlines use it too rather than dropping it from `tileInfo`. |
| [r4289795883](https://github.com/JLRoper/vigilant-palm-tree/pull/191#discussion_r4289795883) | City overlay shortcut with nonzero bg offsets | 🟡 plausible | No | The non-parallax `paintCitySkybox` path draws a cover-fit image shifted by `offsetX/Y` (range ±500) and returns without an opaque fill. Large offsets can expose strips that are never cleared now that `GameEngine.draw()` skips the adventure draw. Not reproduced in a browser. A cheap fix is an opaque `CITY_BG` fill before `drawImage`. |
| [r4289501670](https://github.com/JLRoper/vigilant-palm-tree/pull/191#discussion_r4289501670) | Adjacent-enemy hover shows no path, but click moves | ✅ | No | Hover sets `bestPath = []` when the hero is already adjacent. Click skips zero-length paths and walks to *another* adjacent tile, spending movement. I recommend the **opposite** of Copilot's fix: when the hero is already adjacent, the click should attack in place. |
| [r4279239926](https://github.com/JLRoper/vigilant-palm-tree/pull/191#discussion_r4279239926) | Remote snapshots and moves aren't reconciled through the manager | 🟡 plausible | No | Confirmed that `EntityMirror.bootstrap` no-ops once live refs are bound. `garrisonEventBridge` forwards only server-AI `HeroMoved`, and drops human-only `initial`/`cursor_gap` resyncs. Remote human moves therefore tween the shared `Hero` instance against stale controller state, and `GameStateManager.update()` can snap it back. Needs a LAN two-client repro before investing in a fix. |
| "Previously missed": `hero.ts:206` | Multi-hex fallback animates in a straight line | ✅ | No | `previousQ/R` is the origin of the whole move, so a two-point tween cuts across obstacles. Animate only adjacent steps, or use `s.trail`. |
| [r4290060987](https://github.com/JLRoper/vigilant-palm-tree/pull/191#discussion_r4290060987) | New slider has no accessible name | ✅ | **Yes** | Valid, but none of the 9 range inputs in `settingsMenu.ts` have one. Add `aria-label` here, and ideally fix all of them in one pass. |
| [r4256497486](https://github.com/JLRoper/vigilant-palm-tree/pull/191#discussion_r4256497486) | Lobby hero coords from the wrong map | 🟡 partly fixed | No | The coordinates now come from a `huge` map (correct), but it still generates a full map just to read its size (`MAP_SIZES.huge.width >> 1` would do), and `"huge"` is still hard-coded with no selector. |

### Valid docs and tests

| # | Finding | Verdict | Notes |
|---|---|---|---|
| [r4267572947](https://github.com/JLRoper/vigilant-palm-tree/pull/191#discussion_r4267572947) | `architecture.md` claims LAN-lobby and Settings map-size selectors | ✅ | Only New Game and the shared modal have selectors. The lobby hard-codes `huge`, and Settings only shows the value. Related stale detail: the doc says LRU `max = 8`, but `GAME_MAP_CACHE_CAPACITY` is 32. |
| [r4267573035](https://github.com/JLRoper/vigilant-palm-tree/pull/191#discussion_r4267573035) | `multiplayer.md` says the host picks from 5 sizes | ✅ | Same root cause as above. |
| [r4267572993](https://github.com/JLRoper/vigilant-palm-tree/pull/191#discussion_r4267572993) | Perf report names `MAP_SIZE_PRESETS` and has stale commit stats | ✅ | It also includes absolute local paths (`C:\ProjectDevelopment\...`) and notes about worktree state that don't belong in a checked-in doc. |
| [r4267572848](https://github.com/JLRoper/vigilant-palm-tree/pull/191#discussion_r4267572848) | Route tests only cover `small` | ✅ | `createGameRoute.test.ts` still only posts `mapSize: "small"`. |
| [r4267572910](https://github.com/JLRoper/vigilant-palm-tree/pull/191#discussion_r4267572910) | Sub-4px minimap mist branch is untested | ✅ | `minimap.test.ts` only uses size `6.5`. |
| [r4256497543](https://github.com/JLRoper/vigilant-palm-tree/pull/191#discussion_r4256497543) | Size test doesn't pin dimensions | 🟡 partly | `epic` is pinned (120×90 in the bitset perf test); `huge` and the rest aren't. Assert against `MAP_SIZES` inside the loop. |

### Resolved

| # | Finding | Verdict |
|---|---|---|
| [r4256497367](https://github.com/JLRoper/vigilant-palm-tree/pull/191#discussion_r4256497367) | `inferMapSize` ignores huge/epic | ❌ fixed: now iterates over all `MAP_SIZES` entries (`GameSessionManager.ts:52-60`). Resolve the thread. |

## 4. Additional findings in the current diff

1. **Settings subscription leak** (`adventureView.ts` constructor): `subscribeSettings` returns an unsubscribe function, and the code throws it away. `AdventureView` has a `detach()`, so store the unsubscribe and call it there.
2. **Duplicated viewport math**: `clientWidth || innerWidth || 1280` appears twice (in the subscription and in `getMinCameraZoom`). The floor is based on width only. That matches the "hexes wide" wording, but tall or portrait viewports get no vertical cap.
3. **The zoom floor's behaviour is the real UX change.** With a default of 20, most desktop users will notice a tighter maximum zoom-out than today. Consider a default of about 30–34 to keep the current framing, or say so clearly in the PR.
4. **Row-clipping math looks correct** for the pointy-top `axialToPixel` (`x = √3·size·(q + r/2)`). The 2-hex margin keeps sprite overflow safe. The test checks both the reduction and that culling is exact per row.
5. `test/failure-page.html` (a Playwright failure dump) is checked into the repo on `main`. It should be gitignored.

## 5. Suggested path to merge

1. Retitle and rewrite the PR description to match the 10-file diff.
2. Fix in this PR: clamp the zoom on init and resize and remove the "stay below the floor" branch (§3), add the slider `aria-label`, unsubscribe on `detach()`, and reconsider the default cap.
3. Re-run CI (the failure is a port collision).
4. Open follow-up issues for the valid findings now on `main`, ordered as: **terrain save compatibility (P1)** → hidden-enemy traversal → adjacent-attack click → `resolveMapSize` own-property check → territory rule consistency → docs and test gaps → remote-move reconciliation (repro first).
5. Resolve the outdated or fixed Copilot threads so the review overview shows only live items.
