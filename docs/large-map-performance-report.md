# Large-Map Performance Deep-Dive & Scaling Roadmap (`feat/add-larger-map-sizes`)

<!-- docs:verified 2026-10-14 -->

## 1. Executive Summary & Headline Empirical Findings

### 1.1 Branch Context & Repository State
Branch `feat/add-larger-map-sizes` (`bc7e23e`, 14 files changed, +29/-21 lines) expands `MAP_SIZE_PRESETS` in `packages/engine/src/map/gameMap.ts` by adding two larger world sizes and changing the default multiplayer lobby map size in `src/screens/multiplayer/multiplayerLobby.ts`:
- **`"small"`**: $24 \times 18 = 432$ tiles ($1.0\times$ baseline)
- **`"medium"`**: $36 \times 27 = 972$ tiles ($2.25\times$ `small`)
- **`"large"`**: $48 \times 36 = 1,728$ tiles ($4.0\times$ `small`, previous maximum)
- **`"huge"` (new)**: $72 \times 54 = 3,888$ tiles ($9.0\times$ `small`, $2.25\times$ `large`)
- **`"epic"` (new)**: $120 \times 90 = 10,800$ tiles ($25.0\times$ `small`, $6.25\times$ `large`)

**Note on `.worktrees/larger-map-sizes` vs. Root Checkout State:** `C:\ProjectDevelopment\heroes-js\.worktrees\larger-map-sizes` is an unlinked snapshot directory lacking a `.git` pointer and still containing pre-branch code (`small | medium | large` only), whereas `feat/add-larger-map-sizes` (`bc7e23e`) is checked out in the primary repository `C:\ProjectDevelopment\heroes-js` (with 1 unstaged local edit in `src/entities/hero.ts` lines 201–220). All benchmarks and line references in this report were executed against `C:\ProjectDevelopment\heroes-js` on `feat/add-larger-map-sizes`.

### 1.2 Headline Playwright Chromium Canvas2D Measurements (`1280×800`, 60 Frames)
Real browser measurements in headless Chromium (`1280×800` viewport, 15 warmup frames + 60 timed frames, raster-flushed via `ctx.getImageData(0, 0, 1, 1)`) demonstrate severe frame-rate collapse as map dimensions grow:
- **`epic` ($120 \times 90 = 10,800$ tiles)**: **75.67–77.96 ms/frame (12.8–13.2 FPS)** at `deviceScaleFactor: 1` (`DPR=1`) and **82.83–83.97 ms/frame (11.9–12.1 FPS)** at `DPR=2` (`2560×1600` backing store).
- **`huge` ($72 \times 54 = 3,888$ tiles)**: **28.47 ms/frame (35.1 FPS)** at `DPR=1` and **35.98 ms/frame (27.8 FPS)** at `DPR=2`.
- **`large` ($48 \times 36 = 1,728$ tiles)**: **14.34 ms/frame (69.8 FPS)** at `DPR=1`, dropping to **22.09 ms/frame (45.3 FPS)** at `DPR=2`.
- **`small` ($24 \times 18 = 432$ tiles)**: **5.11 ms/frame (195.8 FPS)** at `DPR=1` and **11.52 ms/frame (86.8 FPS)** at `DPR=2`.

### 1.3 Where the Frame Time Actually Goes on `epic` (Empirical Profile vs. Static Intuition)
Static code inspection suggests the main adventure canvas (`buildAdventureScene` + `paintScene` over 32,362 `SceneNode`s) is the primary bottleneck. Empirical Chromium profiling proves the opposite:
1. **`drawMinimap` (`src/render/minimap.ts` lines 196–300): `63.41 ms/frame` at DPR=1 (`81.3%` of total frame time!) / `60.93 ms/frame` at DPR=2**, of which `drawMistCell` (`src/render/minimap.ts` lines 149–194) alone takes **`59.46 ms/frame`**.
2. **`paintScene` (`src/render/scene/paint2d/index.ts` lines 184–324): `10.42 ms/frame` at DPR=1 (`13.4%`) / `17.72 ms/frame` at DPR=2 (`21.4%`)** across 32,362 unculled nodes (`terrainHex`: 3.50 ms, `fogHex`: 3.55 ms, `terrainDecoration`: 1.96 ms, overlays/entities: 0.02 ms at DPR=1).
3. **`buildAdventureScene` (`src/render/scene/sceneBuilder/adventureScene.ts` lines 40–177): `0.92–1.11 ms/frame` (`~1.2%`)**.
4. **`computeVision` (`src/render/fog.ts` lines 8–24): `0.007–0.010 ms/frame` (`<0.02%`)**.

### 1.4 Measured Optimization Proof in Chromium (`epic` 120×90)
Testing viewport culling (Opt 1) and offscreen minimap caching (Opt 2) independently and together in Chromium confirms why ranking matters:
- **Baseline (unculled 32,362 nodes + uncached minimap)**: **77.96 ms (12.8 FPS)** at DPR=1 | **83.97 ms (11.9 FPS)** at DPR=2.
- **Opt 1 Alone (main-scene viewport culling to 266 hexes / 798 nodes, uncached minimap)**: **66.55 ms (15.0 FPS, `1.17×` speedup)** at DPR=1 | **71.99 ms (13.9 FPS, `1.17×`)** at DPR=2 — *culling the main canvas alone leaves the game unplayable at 15 FPS because `drawMinimap` still burns 60+ ms every frame*.
- **Opt 2 Alone (cached offscreen minimap, unculled 32,362-node main scene)**: **12.62 ms (79.2 FPS, `6.18×` speedup)** at DPR=1 | **21.24 ms (47.1 FPS, `3.95×` speedup)** at DPR=2.
- **Opt 1 + Opt 2 Combined (viewport-culled 532-node main scene skipping fog/grass/dirt decorations + cached offscreen minimap)**: **`1.86 ms` (538.6 FPS, `41.99×` speedup!)** at DPR=1 | **`9.12 ms` (109.7 FPS, `9.21×` speedup!)** at DPR=2.

---

## 2. Head-to-Head Comparison with the Reference AI Review

| Dimension / Finding | Reference AI Review Claim | Empirical Reality & Deep-Dive Verdict |
|---|---|---|
| **#1 vs #2 Render Bottleneck** | Ranked Main-Scene Viewport Culling **#1** and Minimap Redraw **#2**. | **Inverted.** `drawMinimap` takes **63.41 ms** vs `paintScene`'s **10.42 ms** and `buildAdventureScene`'s **0.92 ms** (minimap is **6.1× slower** than main-canvas painting). |
| **Why `drawMinimap` Dominates** | Noted 21,400 gradients and 32,100 fills in `drawMistCell`. | Identified the exact GPU/Skia root cause: main-canvas offscreen hexes are rejected by Skia's viewport clip before shading, whereas at `minimapCamera.zoom = 1`, all 10,800 minimap cells sit **inside** the 180×135px clip rect (`cellSize = 1.5px`), forcing Skia to allocate and shade **21,282 `CanvasGradient`s + 63,846 `addColorStop`s + 42,564 `fillRect`s** every frame. |
| **Zoom-Out Cliff (`camera.zoom = 0.25`)** | Claimed viewport culling reduces the main scene to "a few hundred hexes." | **True at `zoom = 1` (266 hexes), false at min zoom.** `src/render/camera.ts` line 9 allows `zoom = 0.25`, where a `1280×800` viewport spans $5120 \times 3200$ world px (**~6,206 hexes**) and `1920×1080` spans **all 10,800 hexes**, defeating frustum culling unless paired with 16×16 terrain chunk caching and zoom LOD. |
| **Redraw Amplification & CityView Overdraw** | Noted `GameEngine.loop` draws every rAF and pointer flush also triggers a draw. | **Understated.** `src/managers/GameEngine.ts` lines 163–164 wire `onHudUpdate: () => this.fullFrame()` (which calls `draw()`) AND `onRedraw: () => this.draw()`. `src/screens/adventure/adventureView.ts` calls both back-to-back at lines 372–373, 409–410, 436–437, 592–593, and 630–631 — causing **3× full redraws per hover step (234 ms)** and **up to 5× per click**. Also missed: when `CityView` is open (`GameEngine.ts` lines 488–491), the engine still draws the entire 10,800-tile adventure map + minimap underneath the opaque `#1a1620` city canvas every frame. |
| **Hover A* Freeze & Fog-of-War Leak** | Mentioned `findPath` runs on pointer hover and click. | **Missed critical 93.3 ms UI freeze & info leak.** `AdventureView.updatePath()` (`adventureView.ts` lines 464–471) adds **all** non-self heroes (including fog-hidden enemies — leaking their positions!) into `occupiedHexes`. Hovering an enemy hero passes a goal that is in `blockedHexes`, and because `findPath` (`packages/engine/src/map/pathfinding.ts` line 56) lacks an early `if (blockedHexes?.has(key(goal))) return [];` guard, A* exhaustively expands the **entire 10,800-tile map (93.28 ms)** before returning `[]`. |
| **Fogged Decorations & `hexPath` Trig** | Noted `terrainDecoration` nodes are emitted for `grass`/`dirt`. | Also missed: `adventureScene.ts` line 52 emits `terrainDecoration` for all **10,641 fogged tiles** (immediately painted over by `fogHex`), `paintTerrainDecoration` runs `Math.sin` 3× even for `grass`/`dirt`, and `hexPath` (`src/render/scene/paint2d/geometry.ts` lines 18–28) runs `Math.cos`/`Math.sin` 6× per hex (~257,000 trig calls/frame on `epic`). |
| **Per-Frame DOM & Economy Thrashing** | Mentioned `refreshHud()` runs in `fullFrame()`. | **Missed 60 Hz economy & territory work:** `updateHud` + `economyBreakdown` (`src/screens/shared/hud.ts` lines 70–162) + `toolbar.refresh` (`src/screens/shared/toolbar.ts` lines 467–520, calling `getCalendar()` twice at lines 471 & 505) recompute `playerEffectiveSettlementIncome` **4×/frame**, `buildingUpkeepRequired` **3×/settlement/frame**, `toLocaleTimeString()` at 60 Hz (`hud.ts` line 174), and when `inspectedTile !== null`, `UIManager.refreshTileInfoPanel` (`src/managers/UIManager.ts` lines 458–481) recomputes `controlledPositions` for every owned castle at 60 Hz (`src/screens/adventure/tileInfo.ts` lines 135–157). |
| **AI Turn Stalls (`pickWanderStep` & Residual MP)** | Not analyzed in detail. | **Critical server and client AI stall (`34.1–36.6 ms/step`):** On `epic`, `ENEMY_REACH = 7` / `SETTLEMENT_REACH = 8` / `RESOURCE_REACH = 8` (`packages/engine/src/ai/aiBrain.ts` lines 35–37) are tiny, so AI heroes fall through to `pickWanderStep` (`lines 387–409`), which runs **all 20 full-map random A* searches** because `hexDistance(step.toTile, hero)` (`line 402`) is always `1` (`step.toTile` is `path[0]`) and never breaks early. Worse, when forest/desert steps leave fractional movement $0 < \text{mp} < 1$ (e.g. `0.4`), `hero.movementRemaining <= 0` (`line 257`) passes and runs all 20 full-map A* searches (**36.59 ms**) before `firstStepCost` (`line 347`) rejects every step. |
| **PostgreSQL 65,535-Param Limit & Unused `tiles`** | Noted `generateAndInsertTiles` inserts 10,800 rows and `new GameMap` runs twice. | **Missed hard DB protocol ceiling & dead table:** `generateAndInsertTiles` (`server/routes.ts` lines 119–148) builds one `INSERT` with $5 \times W \times H = 54,000$ bind params on `epic` — **82.4% of PostgreSQL's hard 65,535 (`UInt16`) parameter limit** (any map $> 13,107$ tiles crashes `POST /api/games`). Furthermore, `server/persistence/repositories/tileRepo.ts` is **never read by server game logic**, while `server/app/aiDriver.ts` line 942 and `server/app/commandHandler.ts` line 1360 reconstruct `new GameMap(seed, mapSize)` (**51.93 ms** on `epic`) on **every single AI/charter hex step**. |
| **Branch-Specific Bugs (`bc7e23e`)** | Noted `multiplayerLobby.ts` default changed to `"huge"`. | **Missed 2 bugs & map-gen scaling:** (1) `src/screens/multiplayer/multiplayerLobby.ts` line 252 still calls `new GameMap(seed)` (default `"small"` 24×18) while line 255 sends `mapSize: "huge"`; (2) `src/managers/GameSessionManager.ts` line 130 calls `generateCastles(this.getGameMap(), ...)` on the *old* loaded map before creating a new game; (3) `generateTerrain` uses fixed `blobs: 2..5` (`gameMap.ts` lines 107–115) and `castlePlacement.ts` uses fixed `CASTLE_COUNT_MAX = 15` / `MIN_CASTLE_SPACING = 4` with no path-connectivity check between left/right starting capitals. |

---

## 3. Complete Empirical Benchmark Tables (Suite A & Suite B)

### 3.1 Suite A.1 — Map Generation (`new GameMap(seed, size)`)
Measured via Node v22 / `tsx` (`small`–`epic`: 10 warmup + 40 timed iterations; `240x180`: 3 warmup + 15 timed iterations; inner-loop steps and `frontier.splice` counts averaged over seeds 1–20):

| Map Size | Dimensions | Total Tiles | `new GameMap` Total (mean / p50 / p95 ms) | `generateTerrain` (mean / p50 / p95 ms) | `placeResourceTiles` (mean / p50 / p95 ms) | Avg Inner-Loop Steps | Avg `frontier.splice` Calls | Avg Max Frontier Length |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `small` | 24×18 | 432 | **0.125** / 0.101 / 0.221 | **0.072** / 0.063 / 0.189 | **0.026** / 0.025 / 0.044 | 930 | 431 | 290 |
| `medium` | 36×27 | 972 | **0.158** / 0.142 / 0.235 | **0.083** / 0.079 / 0.137 | **0.057** / 0.052 / 0.089 | 2,970 | 1,178 | 586 |
| `large` | 48×36 | 1,728 | **0.288** / 0.266 / 0.401 | **0.178** / 0.167 / 0.272 | **0.097** / 0.092 / 0.150 | 6,206 | 2,368 | 977 |
| `huge` | 72×54 | 3,888 | **4.755** / 4.920 / 5.177 | **4.236** / 4.701 / 5.270 | **0.206** / 0.199 / 0.255 | 16,531 | 6,135 | 2,111 |
| `epic` | 120×90 | 10,800 | **51.928** / 53.932 / 56.690 | **51.178** / 53.931 / 56.808 | **0.588** / 0.567 / 0.724 | 62,367 | 18,719 | 5,831 |
| `240x180` | 240×180 | 43,200 | **792.542** / 797.662 / 938.152 | **782.182** / 795.366 / 905.462 | **2.278** / 2.210 / 2.617 | 394,082 | 71,268 | 23,156 |

### 3.2 Suite A.2 — A* Pathfinding (`findPath`) vs. Binary Min-Heap + Reusable TypedArrays

#### 3.2a Current `findPath` (`packages/engine/src/map/pathfinding.ts`) Across Map Sizes (Seed 42)
| Map Size | Tiles | Path Scenario | Hex Distance | Path Length | Current `findPath` (mean / p50 / p95 ms) |
|---|---:|---|---:|---:|---:|
| `small` | 432 | Short (~6 hexes) | 3 | 3 | **0.012** / 0.009 / 0.024 |
| `small` | 432 | Medium (~25 hexes) | 30 | 30 | **0.310** / 0.314 / 0.365 |
| `small` | 432 | Cross-map | 32 | 32 | **0.288** / 0.286 / 0.307 |
| `small` | 432 | Blocked goal (full map exhaustion) | 32 | 0 | **0.568** / 0.535 / 0.736 |
| `large` | 1,728 | Short (~6 hexes) | 7 | 7 | **0.019** / 0.018 / 0.020 |
| `large` | 1,728 | Medium (~25 hexes) | 30 | 30 | **0.304** / 0.300 / 0.311 |
| `large` | 1,728 | Cross-map | 74 | 74 | **2.595** / 2.572 / 2.719 |
| `large` | 1,728 | Blocked goal (full map exhaustion) | 74 | 0 | **4.934** / 4.891 / 5.336 |
| `huge` | 3,888 | Short (~6 hexes) | 7 | 7 | **0.019** / 0.018 / 0.028 |
| `huge` | 3,888 | Medium (~25 hexes) | 30 | 30 | **0.413** / 0.407 / 0.430 |
| `huge` | 3,888 | Cross-map | 116 | 117 | **16.969** / 16.757 / 19.751 |
| `huge` | 3,888 | Blocked goal (full map exhaustion) | 116 | 0 | **16.974** / 16.915 / 17.456 |
| `epic` | 10,800 | Short (~6 hexes) | 7 | 7 | **0.036** / 0.035 / 0.062 |
| `epic` | 10,800 | Medium (~25 hexes) | 30 | 30 | **0.280** / 0.274 / 0.365 |
| `epic` | 10,800 | Cross-map | 200 | 200 | **14.299** / 14.156 / 15.296 |
| `epic` | 10,800 | Blocked goal (full map exhaustion) | 200 | 0 | **93.284** / 93.133 / 96.825 |

#### 3.2b Binary Min-Heap + Generation-Tagged Reusable TypedArray A* Speedup Matrix
| Map Size | Scenario | Current `findPath` Mean (ms) | Per-Call Alloc Heap A* Mean (ms) | Zero-Alloc Heap A* (No Goal Guard) (mean / p50 / p95 ms) | Pure Algorithmic Speedup (×) | Zero-Alloc Heap A* (+ Blocked-Goal Guard) (mean / p50 / p95 ms) | Total Speedup (×) |
|---|---|---:|---:|---:|---:|---:|---:|
| `small` | Short (~6 hexes) | 0.0172 | — | **0.0046** / 0.0040 / 0.0075 | **3.7×** | **0.0063** / 0.0050 / 0.0186 | **2.7×** |
| `small` | Medium (~25 hexes) | 0.4000 | — | **0.0352** / 0.0352 / 0.0386 | **11.4×** | **0.0404** / 0.0373 / 0.0625 | **9.9×** |
| `small` | Cross-map (32 hexes) | 0.3486 | — | **0.0079** / 0.0078 / 0.0086 | **44.1×** | **0.0082** / 0.0081 / 0.0087 | **42.5×** |
| `small` | Blocked goal (exhaustion) | 0.5748 | — | **0.0744** / 0.0713 / 0.0838 | **7.7×** | **0.0002** / 0.0002 / 0.0003 | **2,874×** |
| `large` | Short (~6 hexes) | 0.0215 | — | **0.0032** / 0.0032 / 0.0034 | **6.7×** | **0.0042** / 0.0034 / 0.0113 | **5.1×** |
| `large` | Medium (~25 hexes) | 0.3159 | — | **0.0073** / 0.0070 / 0.0079 | **43.3×** | **0.0077** / 0.0077 / 0.0082 | **41.0×** |
| `large` | Cross-map (74 hexes) | 2.6127 | — | **0.0571** / 0.0564 / 0.0638 | **45.8×** | **0.0663** / 0.0661 / 0.0684 | **39.4×** |
| `large` | Blocked goal (exhaustion) | 4.9348 | — | **0.1305** / 0.1271 / 0.1595 | **37.8×** | **0.0007** / 0.0001 / 0.0002 | **7,050×** |
| `huge` | Short (~6 hexes) | 0.0202 | — | **0.0012** / 0.0012 / 0.0013 | **16.8×** | **0.0017** / 0.0012 / 0.0016 | **11.9×** |
| `huge` | Medium (~25 hexes) | 0.4237 | — | **0.0068** / 0.0068 / 0.0070 | **62.3×** | **0.0084** / 0.0075 / 0.0110 | **50.4×** |
| `huge` | Cross-map (117 hexes) | 16.6329 | — | **0.3107** / 0.3095 / 0.3380 | **53.5×** | **0.3149** / 0.3118 / 0.3387 | **52.8×** |
| `huge` | Blocked goal (exhaustion) | 16.8838 | — | **0.3197** / 0.3115 / 0.3857 | **52.8×** | **0.0001** / 0.0001 / 0.0001 | **168,838×** |
| `epic` | Short (~6 hexes) | 0.0364 | 0.1250 | **0.0071** / 0.0039 / 0.0116 | **5.1×** | **0.0116** / 0.0111 / 0.0175 | **3.1×** |
| `epic` | Medium (~25 hexes) | 0.2802 | 0.1552 | **0.0384** / 0.0381 / 0.0401 | **7.3×** | **0.0390** / 0.0382 / 0.0432 | **7.2×** |
| `epic` | Cross-map (200 hexes) | 13.6908 | 0.2657 | **0.1307** / 0.1287 / 0.1412 | **104.7×** | **0.1330** / 0.1309 / 0.1426 | **102.9×** |
| `epic` | Blocked goal (exhaustion) | 92.3473 | 1.2525 | **1.0002** / 0.9955 / 1.0775 | **92.3×** | **0.0001** / 0.0001 / 0.0002 | **923,473×** |

### 3.3 Suite A.3 — AI Turn Planning (`pickAiMove`, `validCharterHexes`, `pickCharterAction`)

#### 3.3a `pickAiMove` (`packages/engine/src/ai/aiBrain.ts`) on `epic` (120×90)
| `pickAiMove` Scenario on `epic` (120×90) | Behavior Triggered | Mean (ms) | p50 (ms) | p95 (ms) | Min / Max (ms) |
|---|---|---:|---:|---:|---:|
| Enemy/resource within 8 hexes (`movementRemaining = 7`) | 1 short A* call (`stepTowardEnemy`) | **0.198** | 0.125 | 0.462 | 0.112 / 0.506 |
| No target within 8 hexes (`movementRemaining = 7`) | `pickWanderStep` → **20 random full-map A* calls** | **34.079** | 36.940 | 66.819 | 11.278 / 66.819 |
| `movementRemaining = 0.4` (residual MP, near target) | Passes `<= 0` check → target A* (`firstStepCost` returns `null`) → **20 wander A* calls** (all return `null`) | **36.589** | 37.627 | 51.209 | 17.329 / 51.209 |
| `movementRemaining = 0.4` (residual MP, no target) | Passes `<= 0` check → **20 wander A* calls** (all return `null`) | **32.500** | 34.316 | 42.216 | 25.376 / 42.216 |

#### 3.3b `validCharterHexes` (`packages/engine/src/charter/requirements.ts`) & `pickCharterAction`
| Map Size | Tiles | Settlements | Valid Charter Hexes Returned | `validCharterHexes` (mean / p50 / p95 ms) | `pickCharterAction` (mean / p50 / p95 ms) |
|---|---:|---:|---:|---:|---:|
| `small` | 432 | 6 / 15 | 201 / 59 | **0.100** / 0.090 / 0.142 \| **0.103** / 0.109 / 0.140 | — |
| `large` | 1,728 | 6 / 15 | 1,325 / 1,077 | **0.134** / 0.135 / 0.144 \| **0.183** / 0.176 / 0.190 | — |
| `huge` | 3,888 | 6 / 15 | 3,178 / 2,876 | **0.308** / 0.306 / 0.318 \| **0.423** / 0.418 / 0.439 | — |
| `epic` | 10,800 | 6 | 9,174 | **1.113** / 1.079 / 1.278 | **1.559** / 1.515 / 1.837 |
| `epic` | 10,800 | 15 | 8,850 | **1.416** / 1.373 / 1.496 | **1.885** / 1.837 / 1.946 |

### 3.4 Suite A.4 — Scene Builder (`computeVision` + `buildAdventureScene`) & Exact `SceneNode` Counts
| Map Size | Tiles | Scenario | Visible Tiles | `computeVision` (mean ms) | `buildAdventureScene` (mean / p50 / p95 ms) | Total `SceneNode`s | `terrainHex` | `terrainDecoration` | `fogHex` | `resourceIcon` | `validCharterHex` | Other (`castle` / `territory` / `hero` / `hover`) |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `small` | 432 | Mostly fogged | 159 | 0.010 | **0.201** / 0.151 / 0.302 | **1,314** | 432 | 432 | 273 | 18 | 0 | 5 / 152 / 2 / 0 |
| `small` | 432 | Fully visible | 432 | 0.010 | **0.187** / 0.166 / 0.255 | **1,104** | 432 | 432 | 0 | 52 | 0 | 6 / 178 / 3 / 1 |
| `small` | 432 | Charter (fogged / visible) | 159 / 432 | 0.010 | **0.186** / 0.160 / 0.292 | **1,332 / 1,305** | 432 | 432 | 273 / 0 | 18 / 52 | 18 / 201 | 5 / 152 / 2 / 0 |
| `large` | 1,728 | Mostly fogged | 159 | 0.009 | **0.246** / 0.230 / 0.302 | **5,141** | 1,728 | 1,728 | 1,574 | 17 | 0 | 3 / 90 / 1 / 0 |
| `large` | 1,728 | Fully visible | 1,728 | 0.009 | **0.280** / 0.269 / 0.359 | **3,851** | 1,728 | 1,728 | 0 | 211 | 0 | 6 / 174 / 3 / 1 |
| `large` | 1,728 | Charter (fogged / visible) | 159 / 1,728 | 0.009 | **0.379** / **0.423** | **5,171 / 5,176** | 1,728 | 1,728 | 1,574 / 0 | 17 / 211 | 30 / 1,325 | 3 / 90 / 1 / 0 |
| `huge` | 3,888 | Mostly fogged | 159 | 0.009 | **0.380** / 0.339 / 0.414 | **11,617** | 3,888 | 3,888 | 3,729 | 18 | 0 | 3 / 90 / 1 / 0 |
| `huge` | 3,888 | Fully visible | 3,888 | 0.009 | **0.395** / 0.376 / 0.391 | **8,396** | 3,888 | 3,888 | 0 | 436 | 0 | 6 / 174 / 3 / 1 |
| `huge` | 3,888 | Charter (fogged / visible) | 159 / 3,888 | 0.009 | **0.716** / **0.899** | **11,651 / 11,574** | 3,888 | 3,888 | 3,729 / 0 | 18 / 436 | 34 / 3,178 | 3 / 90 / 1 / 0 |
| `epic` | 10,800 | Mostly fogged | 159 | 0.009 | **1.111** / 0.954 / 3.372 | **32,362** | 10,800 | 10,800 | 10,641 | 27 | 0 | 3 / 90 / 1 / 0 |
| `epic` | 10,800 | Fully visible | 10,800 | 0.009 | **1.158** / 0.993 / 3.435 | **23,034** | 10,800 | 10,800 | 0 | 1,250 | 0 | 6 / 174 / 3 / 1 |
| `epic` | 10,800 | Charter (mostly fogged) | 159 | 0.009 | **2.454** / 2.052 / 5.283 | **32,410** | 10,800 | 10,800 | 10,641 | 27 | 48 | 3 / 90 / 1 / 0 |
| `epic` | 10,800 | Charter (fully visible) | 10,800 | 0.009 | **2.739** / 2.340 / 5.914 | **32,208** | 10,800 | 10,800 | 0 | 1,250 | 9,174 | 6 / 174 / 3 / 1 |

### 3.5 Suite B.1 — Playwright Chromium Canvas2D Per-Layer Breakdown (`1280×800`, 60 Frames)

#### 3.5a `deviceScaleFactor: 1` (`1280×800` Backing Store, 159 Visible Tiles)
| Metric / Stage (mean / p50 / p95 ms) | `small` (24×18, 432 tiles) | `large` (48×36, 1,728 tiles) | `huge` (72×54, 3,888 tiles) | `epic` (120×90, 10,800 tiles) |
|---|---:|---:|---:|---:|
| Fogged tiles on map | 273 | 1,569 | 3,729 | 10,641 |
| `computeVision` | **0.010** / 0.000 / 0.100 | **0.007** / 0.000 / 0.100 | **0.017** / 0.000 / 0.100 | **0.007** / 0.000 / 0.100 |
| `buildAdventureScene` | **0.143** / 0.100 / 0.400 | **0.188** / 0.200 / 0.300 | **0.392** / 0.400 / 0.700 | **0.923** / 0.800 / 1.300 |
| `paintScene`: only `terrainHex` | **0.683** / 0.200 / 0.300 | **1.002** / 0.500 / 0.600 | **1.637** / 1.100 / 1.900 | **3.502** / 2.800 / 4.300 |
| `paintScene`: only `terrainDecoration` | **0.095** / 0.100 / 0.200 | **0.780** / 0.300 / 0.400 | **0.692** / 0.700 / 1.400 | **1.957** / 1.900 / 2.700 |
| `paintScene`: only `fogHex` | **0.620** / 0.100 / 0.200 | **0.898** / 0.400 / 0.500 | **1.417** / 0.900 / 1.200 | **3.553** / 2.500 / 2.700 |
| `paintScene`: overlays + entities | **0.667** / 0.000 / 0.200 | **0.022** / 0.000 / 0.100 | **0.050** / 0.000 / 0.100 | **0.022** / 0.000 / 0.100 |
| **`paintScene` Total** | **3.025** / 0.400 / 37.700 | **3.083** / 1.400 / 33.800 | **6.458** / 3.200 / 34.200 | **10.422** / 8.600 / 41.900 |
| `drawMinimap`: isolated `drawMistCell` loop | **2.097** / 1.000 / 19.400 | **9.653** / 5.900 / 24.000 | **20.523** / 25.900 / 28.900 | **59.463** / 60.400 / 72.800 |
| **`drawMinimap` Total (current)** | **2.355** / 1.300 / 15.900 | **10.610** / 6.300 / 21.800 | **23.112** / 25.700 / 30.500 | **63.412** / 63.500 / 70.400 |
| `drawMinimap` w/ flat `fillRect` fog (no `drawMistCell`) | **0.037** / 0.000 / 0.100 | **0.237** / 0.000 / 0.100 | **0.242** / 0.000 / 0.900 | **0.252** / 0.000 / 0.700 |
| `drawMinimap` w/ cached offscreen canvas | **0.003** / 0.000 / 0.000 | **0.003** / 0.000 / 0.000 | **0.017** / 0.000 / 0.000 | **0.005** / 0.000 / 0.100 |
| **Total Frame Time (CPU)** | **5.032** / 2.000 / 28.200 | **14.510** / 8.700 / 27.700 | **28.190** / 30.900 / 33.800 | **76.860** / 75.900 / 88.500 |
| **Total Frame Time (Raster-Flushed)** | **5.107** / 5.100 / 5.400 | **14.337** / 13.800 / 16.400 | **28.467** / 28.200 / 31.800 | **75.667** / 74.800 / 83.300 |
| **Equivalent FPS (CPU / Flushed)** | **198.7 / 195.8 FPS** | **68.9 / 69.8 FPS** | **35.5 / 35.1 FPS** | **13.0 / 13.2 FPS** |

#### 3.5b `deviceScaleFactor: 2` (`2560×1600` Backing Store, 159 Visible Tiles)
| Metric / Stage (mean / p50 / p95 ms) | `small` (24×18, 432 tiles) | `large` (48×36, 1,728 tiles) | `huge` (72×54, 3,888 tiles) | `epic` (120×90, 10,800 tiles) |
|---|---:|---:|---:|---:|
| `computeVision` | **0.012** / 0.000 / 0.100 | **0.015** / 0.000 / 0.100 | **0.007** / 0.000 / 0.100 | **0.030** / 0.000 / 0.100 |
| `buildAdventureScene` | **0.132** / 0.100 / 0.300 | **0.188** / 0.200 / 0.300 | **0.425** / 0.400 / 0.700 | **0.913** / 0.800 / 1.300 |
| `paintScene`: only `terrainHex` | **2.742** / 0.200 / 0.300 | **3.060** / 0.600 / 0.700 | **3.887** / 1.300 / 2.100 | **5.973** / 3.400 / 4.200 |
| `paintScene`: only `terrainDecoration` | **0.103** / 0.100 / 0.200 | **2.620** / 0.300 / 0.400 | **0.775** / 0.700 / 1.400 | **2.078** / 2.000 / 2.900 |
| `paintScene`: only `fogHex` | **1.792** / 0.100 / 0.200 | **2.813** / 0.500 / 0.600 | **3.588** / 1.100 / 1.300 | **7.537** / 3.100 / 4.000 |
| `paintScene`: overlays + entities | **2.212** / 0.000 / 0.100 | **0.020** / 0.000 / 0.100 | **0.055** / 0.000 / 0.600 | **0.058** / 0.000 / 0.600 |
| **`paintScene` Total** | **9.592** / 0.500 / 136.600 | **9.045** / 1.600 / 146.800 | **11.493** / 4.100 / 150.900 | **17.718** / 10.600 / 148.900 |
| `drawMinimap`: isolated `drawMistCell` loop | **2.245** / 0.900 / 18.900 | **9.863** / 5.800 / 25.800 | **20.272** / 26.200 / 29.200 | **57.457** / 56.100 / 68.100 |
| **`drawMinimap` Total (current)** | **2.422** / 1.300 / 16.900 | **10.893** / 6.600 / 23.200 | **22.750** / 24.700 / 30.300 | **60.925** / 60.100 / 68.500 |
| `drawMinimap` w/ flat `fillRect` fog (no `drawMistCell`) | **0.040** / 0.000 / 0.100 | **0.263** / 0.000 / 0.100 | **0.197** / 0.000 / 0.100 | **0.222** / 0.000 / 0.200 |
| `drawMinimap` w/ cached offscreen canvas | **0.007** / 0.000 / 0.100 | **0.003** / 0.000 / 0.000 | **0.005** / 0.000 / 0.100 | **0.020** / 0.000 / 0.100 |
| **Total Frame Time (CPU)** | **10.973** / 2.100 / 80.200 | **23.628** / 8.600 / 50.400 | **35.693** / 38.800 / 48.900 | **82.555** / 81.900 / 91.200 |
| **Total Frame Time (Raster-Flushed)** | **11.517** / 11.500 / 12.200 | **22.093** / 21.400 / 23.800 | **35.983** / 35.700 / 39.000 | **82.830** / 82.200 / 89.400 |
| **Equivalent FPS (CPU / Flushed)** | **91.1 / 86.8 FPS** | **42.3 / 45.3 FPS** | **28.0 / 27.8 FPS** | **12.1 / 12.1 FPS** |

### 3.6 Suite B.2 — Simulated Optimization Matrix in Chromium on `epic` (120×90)
| Optimization Configuration on `epic` (120×90) | DPR=1 CPU Frame (mean / p50 / p95 ms) | DPR=1 Flushed Frame (mean / p50 / p95 ms) | DPR=1 Flushed FPS | DPR=2 CPU Frame (mean / p50 / p95 ms) | DPR=2 Flushed Frame (mean / p50 / p95 ms) | DPR=2 Flushed FPS | Speedup vs Baseline (Flushed DPR 1 / DPR 2) |
|---|---:|---:|---:|---:|---:|---:|---:|
| **(Baseline)** Unculled `buildAdventureScene` + `paintScene` (32,362 nodes) + uncached `drawMinimap` | **76.82** / 76.70 / 83.50 | **77.96** / 77.60 / 88.90 | **12.8 FPS** | **82.21** / 81.50 / 87.60 | **83.97** / 84.00 / 88.60 | **11.9 FPS** | 1.00× / 1.00× |
| **(Opt 1 only)** Viewport-culled `buildAdventureScene` + `paintScene` (266 hexes, 798 nodes) + uncached `drawMinimap` | **68.06** / 67.80 / 79.30 | **66.55** / 66.70 / 71.10 | **15.0 FPS** | **72.86** / 71.10 / 81.30 | **71.99** / 71.50 / 76.30 | **13.9 FPS** | **1.17× / 1.17×** |
| **(Opt 2 only)** Unculled main scene (32,362 nodes) + cached offscreen `drawMinimap` | **12.69** / 10.30 / 44.50 | **12.62** / 12.70 / 13.90 | **79.2 FPS** | **21.80** / 11.60 / 162.60 | **21.24** / 21.20 / 22.70 | **47.1 FPS** | **6.18× / 3.95×** |
| **(Opt 1 + Opt 2 combined)** Viewport-culled main scene (532 nodes, skipping fog/grass/dirt `terrainDecoration`) + cached offscreen `drawMinimap` | **1.86** / 0.30 / 31.60 | **1.86** / 1.80 / 2.20 | **538.6 FPS** | **8.05** / 0.30 / 154.40 | **9.12** / 8.40 / 12.70 | **109.7 FPS** | **41.99× / 9.21×** |

---

## 4. Prioritized Engineering Roadmap (Tier 0 → Tier 4)

### 4.1 Tier 0: Immediate Frame-Rate Rescues (`epic` 12.8 FPS → 110–538 FPS)

1. **Minimap Offscreen Layer Cache + LOD Mist Cutoff (`src/render/minimap.ts` lines 149–300, `src/render/minimapCamera.ts`):**
   - Cache the static terrain + fog/mist + resource dots into an offscreen `HTMLCanvasElement` (or `OffscreenCanvas`) keyed by `(map, minimapCamera.zoom, minimapCamera.panQ, minimapCamera.panR, minimapCamera.rotation, visionVersion, dpr)`.
   - On steady-state frames, blit the cached layer via `ctx.drawImage(offscreen, 0, 0)` (**`0.005 ms`** at DPR=1 / **`0.020 ms`** at DPR=2) and draw only the dynamic path (`drawMinimapPath`), hero dots, and camera viewport polygon on top.
   - **Sub-4px Mist LOD:** When `cellSize < 4` (on `epic` at `minimapCamera.zoom = 1`, `cellSize = 1.5px`), replace `drawMistCell`'s 2 `ctx.createLinearGradient` + 6 `addColorStop` + 3 `fillRect` calls (`src/render/minimap.ts` lines 163–193) with a single deterministic alpha `ctx.fillRect`. Visually identical at 1.5px and reduces even cache-rebuild frames from **63.41 ms to 0.25 ms (`250×` faster)**.

2. **Camera Frustum Culling + Fog/Decoration Pruning in `buildAdventureScene` (`src/render/scene/sceneBuilder/adventureScene.ts` lines 40–177, `src/render/camera.ts`):**
   - Compute the visible axial bounding box `[qMin..qMax, rMin..rMax]` by projecting the 4 screen corners `(0, 0)`..`(viewportW, viewportH)` through inverse camera transform (`pixelToAxial`) plus a 2-hex margin for tall castle/hero sprites (`castle.3` `hexSizeMul: 3.0`) and hex borders.
   - Restrict Loop 1 (`adventureScene.ts` lines 47–58) to `r = rMin..rMax`, `q = qMin..qMax` (reducing `epic` at `zoom = 1` from 10,800 tiles to **266 tiles**).
   - **Skip `terrainDecoration` emission** when `!vis` (fogged tiles paint an opaque-ish `fogHex` directly over decorations anyway) or when `terrain === "grass" || terrain === "dirt"` (no-op in `paintTerrainDecoration`, `src/render/scene/paint2d/index.ts` lines 202–245).
   - **Sparse Resource Tile Iteration:** Expose `readonly placedResourceTiles: readonly ResourceTile[]` on `GameMap` (`packages/engine/src/map/gameMap.ts` line 43) and iterate either `map.placedResourceTiles` or the frustum-culled `[qMin..qMax, rMin..rMax]` window instead of scanning all $W \times H$ tiles in Loop 2 (`adventureScene.ts` lines 60–67).
   - **Skip Adventure Render Under `CityView`:** In `src/managers/GameEngine.ts` lines 486–491, when `this.ui.getCityView().isOpen()` is true, skip `this.view.draw(...)` (the adventure canvas and minimap) since `CityView.draw()` immediately fills the full canvas with opaque `#1a1620`.

3. **Eliminate Synchronous 3×–5× Redraw Amplification & Idle 60 Hz Redraws (`src/managers/GameEngine.ts` lines 163–164, 427–492; `src/screens/adventure/adventureView.ts`):**
   - Remove the redundant `this.opts.onRedraw()` calls that immediately follow `this.opts.onHudUpdate()` in `src/screens/adventure/adventureView.ts` at lines 372–373, 409–410, 436–437, 592–593, and 630–631 (`onHudUpdate` already invokes `fullFrame()` $\rightarrow$ `draw()`).
   - Replace direct `this.draw()` / `this.fullFrame()` callbacks with coalesced dirty flags (`this.needsCanvasRedraw = true`, `this.needsHudRefresh = true`) consumed once per `requestAnimationFrame` in `GameEngine.loop()`. When idle (`!changed && !this.needsCanvasRedraw && !hasActiveTweenOrFade`), skip `draw()` altogether.

---

### 4.2 Tier 1: Pathfinding, Hover Freeze, & Fog-of-War Leak Fixes (`epic` A* 14–93 ms → 0.0001–0.13 ms)

1. **Zero-Allocation Binary Min-Heap + Generation-Tagged TypedArray A* (`packages/engine/src/map/pathfinding.ts` lines 23–92):**
   - Add an immediate O(1) goal guard at the top of `findPath`:
     `if (!map.isPassable(goal.q, goal.r) || blockedHexes?.has(`${goal.q},${goal.r}`)) return [];`
     (**eliminates the 93.28 ms blocked-goal exhaustion in 0.0001 ms — `923,473×` speedup**).
   - Replace `open: Axial[]` + `Map<string, number>` (`gScore`, `fScore`, `cameFrom`) with module-reusable generation-tagged flat arrays sized to `max(N)`: `gScore: Float64Array`, `fScore: Float64Array`, `cameFrom: Int32Array`, `visitGen: Uint32Array`, `heapPos: Int32Array`, and a binary min-heap of integer tile indices `idx = r * width + q`.
   - Convert `blockedHexes?: Set<string>` once per `findPath` call into a `blockedGen: Uint32Array` tag (or accept a `Uint8Array` mask directly), eliminating all template-string allocations inside the A* loop.
   - Replace `path.unshift(...)` (`line 88`) with `path.push(...)` followed by `path.reverse()`.
   - **Measured impact on `epic`**: Cross-map A* (200 hexes) drops from **13.69 ms to 0.13 ms (`104.7×` faster)**.

2. **Fix Hover-Over-Enemy Exhaustion & Fog-of-War Info Leak (`src/screens/adventure/adventureView.ts` lines 440–472, `src/screens/adventure/clickIntent.ts` lines 102–154):**
   - In `AdventureView.updatePath()`, filter `occupiedHexes` by `isVisible(visible, h.q, h.r)` so fog-hidden enemy heroes never deflect the player's yellow path preview (fixing the fog-of-war info leak).
   - When `this.hover` contains a visible enemy hero, route the hover preview to the best adjacent passable attack hex (matching `clickIntent.ts` lines 112–135) and cache the resulting path so clicking reuses the hover path instead of running 6× `findPath` again.

---

### 4.3 Tier 2: Server AI, Map Generation, & Database Scaling (`epic` AI Turns → <10 ms)

1. **Process-Wide `GameMap` LRU Cache (`packages/engine/src/map/gameMap.ts`):**
   - `GameMap` is 100% deterministic and immutable for a given `(seed, mapSize)`. Add a lightweight `getOrCreateGameMap(seed, size)` LRU cache (capacity 16–32).
   - Eliminates the duplicate `new GameMap` in `POST /api/games` (`server/routes.ts` lines 126 & 406) and eliminates reconstructing `new GameMap` (**51.93 ms** on `epic`) on every AI hero step (`server/app/aiDriver.ts` lines 888, 942) and every `AdvanceCharterTravel` / `EndTurn` / `UpgradeSettlement` command (`server/app/commandHandler.ts` lines 710, 1257, 1360, 1843) with **zero change to RNG sequence**.

2. **Eliminate Quadratic `frontier.splice` in `generateTerrain` (`packages/engine/src/map/gameMap.ts` lines 103–148):**
   - `generateTerrain` currently accounts for **98.6% of `new GameMap` time on `epic` (`51.18 ms` of `51.93 ms`)** and **782.18 ms on `240x180`** because `if (frontier.length > targetCount * 3) frontier.splice(idx, 1)` (`line 143`) runs 18,719 times on a 5,831-element array.
   - Replace `frontier.splice(idx, 1)` with either O(1) swap-and-pop (`frontier[idx] = frontier[frontier.length - 1]; frontier.pop()`) plus an `inFrontier: Uint8Array(total)` bitset so non-grass/already-queued neighbors are never pushed twice, or compact dead entries in a single O(F) pass when `frontier.length > targetCount * 3`.

3. **Fix AI `pickAiMove`, `pickWanderStep`, & `pickCharterAction` (`packages/engine/src/ai/aiBrain.ts` lines 212–409):**
   - **Residual Movement Guard (`line 257`):** Change `if (hero.movementRemaining <= 0) return null;` to `if (hero.movementRemaining < 1) return null;` (since minimum terrain cost in `TERRAIN_COST` is `1.0`), eliminating the **36.59 ms** wasted pass after forest/desert steps.
   - **Fix `pickWanderStep` (`lines 387–409`):** Sample candidate tiles within a local ring (radius 6–12 around `hero`) rather than across all $120 \times 90$ tiles, and **`break` immediately on the first valid `step`** (currently `const d = hexDistance(step.toTile, hero)` at `line 402` is always `1` because `step.toTile` is `path[0]`, so all 20 A* calls always execute!).
   - **Bound Resource & Charter Scans (`lines 212–245, 311–327`):** Iterate only the radius-8 hex disk ($217$ hexes) around `hero` instead of scanning all $10,800$ map tiles, and check `dist > RESOURCE_REACH` *before* scanning `state.settlements`.

4. **Fix PostgreSQL 65,535 Bind-Parameter Ceiling & Redundant `tiles` Persistence (`server/routes.ts` lines 119–148, `server/persistence/repositories/tileRepo.ts`):**
   - **Immediate Fix:** Rewrite `generateAndInsertTiles` (`server/routes.ts` lines 119–148) to pass 4 arrays into `INSERT INTO tiles (game_id, q, r, terrain, resource) SELECT $1, * FROM UNNEST($2::int[], $3::int[], $4::text[], $5::text[])` (**uses 5 bind parameters total for any map size**, removing the 13,107-tile PostgreSQL crash ceiling) and accept the already-built `GameMap` from `POST /games` (`line 406`).
   - **Architectural Cleanup:** Because `server/persistence/repositories/tileRepo.ts` is unused by server commands and tiles are purely deterministic from `(seed, map_size)`, deprecate storing 10,800 rows per game in `tiles` and reconstruct `GameMap(seed, map_size)` client-side.

5. **Fix Branch Bugs in `multiplayerLobby.ts` & `GameSessionManager.ts`:**
   - In `src/screens/multiplayer/multiplayerLobby.ts` line 252, pass `"huge"` to `new GameMap((seed ^ 0x9e3779b1) >>> 0, "huge")` to match line 255 (`mapSize: "huge"`).
   - In `src/managers/GameSessionManager.ts` line 130, remove the unused `generateCastles(this.getGameMap(), ...)` call that runs against the previous session's `GameMap`.

---

### 4.4 Tier 3: Caching Fog, Territory, Charter Mode, & 60 Hz HUD/DOM Updates

1. **Flat `Uint8Array(width * height)` Visibility Map (`src/render/fog.ts`):**
   - Replace `Set<string>` and per-tile `` `${q},${r}` `` string allocations (~40,000–85,000 strings/frame on `epic`) with a flat `Uint8Array(width * height)` indexed by `r * width + q`.
2. **Memoize Territory Boundaries & Precompute Unit Hex Corners (`src/render/scene/sceneBuilder/adventureScene.ts` lines 179–252, `packages/engine/src/control.ts`, `src/render/scene/paint2d/geometry.ts`):**
   - Cache `buildTerritoryOutlineEdges` on settlement state identity (recomputing only when settlement ownership, level, or watchtower buildings change), and pass `c.buildings` into `controlRange(level, buildings)` in `controlledPositions` (`packages/engine/src/control.ts` line 26).
   - Precompute the 6 unit hex corner offsets `(cos, sin)` in `src/core/hex.ts` and `src/render/scene/paint2d/geometry.ts` lines 18–28 (eliminating ~257,000 trig calls/frame on `epic`).
3. **Optimize `validCharterHexes` & Charter Auto-Travel (`packages/engine/src/charter/requirements.ts` lines 101–135, `src/state/turnController.ts` lines 829–910):**
   - Hoist `const settlements = Object.values(state.settlements)` out of the `r × q` loop in `validCharterHexes` (or stamp radius-3 forbidden disks around settlements into a `Uint8Array(width * height)` in $O(S \cdot 3^2 + N)$).
   - Viewport-cull `validCharterHex` nodes in `adventureScene.ts` lines 80–89, and cache the charter path across steps in `TurnController.advanceAutoTravel`.
4. **Event-Driven HUD, Toolbar, & TileInfo Updates (`src/managers/UIManager.ts`, `src/screens/shared/hud.ts`, `src/screens/shared/toolbar.ts`):**
   - Gate `refreshHud()`, `toolbar.refresh()`, and `refreshTileInfoPanel()` on state/selection/hover dirty flags rather than running at 60 Hz; deduplicate `getCalendar()` in `src/screens/shared/toolbar.ts` lines 471 & 505; cache the 3 `querySelector` nodes (`lines 506–508`); and memoize `formatTime(lastSavedAt)` (`src/screens/shared/hud.ts` line 174).

---

### 4.5 Tier 4: Scaling Beyond `epic` ($240 \times 180 = 43,200$ to $500 \times 500 = 250,000$ Tiles)

1. **Chunked $16 \times 16$ Offscreen Terrain Atlas + Zoom Level-of-Detail (LOD):**
   - At `camera.zoom = 0.25` (`src/render/camera.ts` line 9), frustum culling still leaves **6,206–10,800 visible hexes** in view. Partition the map into $16 \times 16$ hex chunks (`256` tiles/chunk) pre-rendered to offscreen canvases; drawing the zoomed-out `epic` map becomes **42 `ctx.drawImage` chunk blits (~0.4 ms)** instead of 32,000 vector path calls. At `zoom < 0.5`, omit 1px hex strokes and micro-decorations.
2. **Scale Map-Gen & Gameplay Parameters with $\sqrt{N / 432}$:**
   - Scale `generateTerrain` blob counts (`packages/engine/src/map/gameMap.ts` lines 107–115), `castleCount` / `MIN_CASTLE_SPACING` (`packages/engine/src/map/castlePlacement.ts`), and AI perception radii (`packages/engine/src/ai/aiBrain.ts` lines 35–37) proportionally to $\sqrt{W \cdot H / 432}$ ($5\times$ on `epic`), and verify A* connectivity between starting castles during `generateCastles`.
3. **Dirty-Entity Persistence (`server/app/commandHandler.ts` lines 249–263):**
   - Track mutated settlement/hero IDs per command so `dualWriteEntities` only upserts dirty rows rather than all $S$ settlements and $H$ heroes on every move.

---

## 5. Reproducible Performance Benchmarking & CI Regression Gates

To prevent large-map regressions from re-entering the codebase, add a non-DB benchmark and complexity gate script (`npm run bench`, alongside `tools/run-test.mjs`):
1. **Deterministic Operation-Count Gates (CI-safe, zero wall-clock flakiness, runnable in `npm run test:unit`):**
   - **Viewport Culling Gate:** Assert that `buildAdventureScene` on an `epic` ($120 \times 90$) map with a `1280×800` camera at `zoom = 1.0` emits **$\le 900$ `SceneNode`s** (down from `32,362`) and **$0$ `terrainDecoration` nodes on fogged or `grass`/`dirt` tiles**.
   - **Minimap Shader Gate:** Spy on `ctx.createLinearGradient` during steady-state `drawMinimap` on `epic` and assert **$0$ gradient allocations on cached frames** and **$0$ gradient allocations when `cellSize < 4`**.
   - **A* Complexity Gate:** Assert that `findPath` to a goal in `blockedHexes` expands **$0$ nodes** (down from `9,000+`), and cross-map A* on `epic` (seed 42) completes in **$< 2.0\text{ ms}$** (budgeted 15× above the 0.13 ms measured mean).
   - **SQL Parameter Gate:** Assert that `generateAndInsertTiles` on `epic` ($10,800$ tiles) or `240x180` ($43,200$ tiles) never constructs a query exceeding **10,000 bind parameters** (or uses `UNNEST` with **5 parameters**).
2. **Headless Chromium Frame-Budget Benchmark (`npm run bench`):**
   - Launches Playwright Chromium at `1280×800` (`DPR=1` and `DPR=2`), runs 60 raster-flushed frames on `huge` and `epic` at `zoom = 1.0` and `zoom = 0.25`, and reports p50/p95 ms for `buildAdventureScene`, `paintScene`, and `drawMinimap` against a hard **$< 8.0\text{ ms}$ (120+ FPS)** frame budget at `DPR=1` and **$< 14.0\text{ ms}$ (70+ FPS)** at `DPR=2`.

