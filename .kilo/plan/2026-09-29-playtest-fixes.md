# Playtest fixes — 2026-09-29

Status: **Approved scope** (user confirmed 2026-09-29). Source: two Playwright playtest sessions (evidence screenshots under `local/playwright-tour/A` and `/B`, playtest reports in session transcripts). Root causes verified by two read-only research passes (file:line references current as of this date).

**User decisions:**
- Scope: **everything** (all bugs + all UX suggestions).
- Standardize player labels on **"Player N"**.
- Fogged tiles show **nothing terrain-related until seen** (pure "Unexplored").
- Visual baselines **may be regenerated** (`npm run test:visual:update-baselines`).
- Delivery: branch `playtest-fixes`, **grouped commits**, precommit gate before each push-worthy commit.

---

## Fix list

### F1 — City view clicks leak into the adventure map  (bug, major)
**Evidence:** ~50 clicks inside the open city dropped the hero's movement 7/7 → 0/7 with no visible hero move (`B` tour).
**Root cause:** City view is drawn on the **same `canvas#game`**; both input paths attach click listeners to it. `AdventureView.onClick` (`src/screens/adventure/adventureView.ts:463-508`, listener attached at :176) has **no city-open guard**, while `GameEngine.handleDblClick` (:409) has one — asymmetry proves oversight. `resolveAdventureClick` is pure and city-unaware, so clicks path the hidden-map hero. `stopPropagation` cannot help (same element). Secondary: mousedown-drag pans, window-level mousemove hovers, wheel zooms the hidden map.
**Fix:** Add `isCityOpen?: () => boolean` to `AdventureViewOptions`, wired from GameEngine as `() => this.ui.getCityView()?.isOpen() ?? false`; early-return at the top of `onClick`, `onMouseDown`, `onMouseMove`, `onWheel` when true.
**Files:** `src/screens/adventure/adventureView.ts`, `src/managers/GameEngine.ts`.
**Tests:** extend `test/cityView.test.ts`: select hero, open city, click canvas N times, assert `movementRemaining` unchanged and `lastClick` untouched.

### F2 — Treasury overdraft to −300g  (bug, major)
**Evidence:** `B\06-after-build.png`, `B\07-settlements-menu.png` — Treasury −300g after spam-placing Barracks.
**Root cause (verified):** authoritative gate is sound (`packages/engine/src/settlement/placeBuildings.ts:88-91` refuses `not_enough_gold`). The −300g is a **client-side artifact**: `UIManager.onClose` (`src/managers/UIManager.ts:223-249`) writes `gold: s.gold − net.gold` **unclamped and unchecked** (gold is the only resource handled this way — wood/stone are clamped at :233-236); its delta input desyncs because (a) `CityView.persistBuildings` advances `this.chargedNet` **even when the commit failed** (`src/screens/settlements/cityView/cityView.ts:510`), and (b) `regenerate()` (:451-458) re-inits the placer (resetting `committedNet`) without resetting `chargedNet`. Server rejection is toast-only (`src/game/turnHooks.ts:449-462`) — no cart rollback, no state resync.
**Fix (minimal, four parts):**
1. `cityView.ts`: advance `chargedNet` **only when** the placer commit succeeded.
2. `cityView.ts regenerate()`: reset `chargedNet` alongside `placer.init()`.
3. `UIManager.onClose`: clamp gold like the other resources **and** abort the persist (return false) when the net delta is unaffordable against committed state.
4. `turnHooks.onPlaceBuildings` catch: roll back the client-side delta (inverse of the last applied delta) instead of toast-only, so client state matches the server row until the next merge.
**Files:** `src/screens/settlements/cityView/cityView.ts`, `src/managers/UIManager.ts`, `src/game/turnHooks.ts`; extract clamping/delta helpers into `src/screens/settlements/cityView/netCost.ts` (pure) for unit tests.
**Tests:** extend `test/screens/settlements/netDelta.test.ts` (chargedNet advance-only-on-success, regenerate reset, clamp/abort logic).

### F3 — "Vanishing building" (13 → 12 across a round)
**Root cause (verified):** nothing in the round pipeline removes buildings (searched `endTurn.ts`, `advance.ts`, `turnService.ts`; no demolish/decay on buildings — only garrison troops desert). The drop is **F2's divergence window**: placement accepted locally → server rejected → client kept it → End Turn's `mergeFromEndTurn` (`turnHooks.ts:512`) replaced settlements with the server's row (without the building).
**Fix:** covered by F2 part 4 (rollback on rejection). No separate code. **Do not** file separately.

### F4 — Fogged-tile clicks silently spend movement
**Root cause:** moving into fog is *allowed* (by design, HoMM-style) and the click succeeds — the complaint is silence + illegibility (dim path alpha 0.30 over near-black fog; tile popup leaks terrain — see F8).
**Fix:** (a) F8 removes the misinformation; (b) `buildAdventureScene` marks path segments whose tiles are fogged; `paintPathSegment` draws fogged dim segments at slightly higher alpha with a thin dark outline so they read on dark fog; (c) F9 toasts make every click outcome visible.
**Files:** `src/render/scene/sceneBuilder/adventureScene.ts`, `src/render/scene/paint2d/index.ts` (+ `types.ts` node field).
**Baselines:** regen `adventure-overview` + both charter scenes (path renders in them).

### F5 — City Design box overlaps the Settlement/Hero panel
**Evidence:** `A\14-edge-dblclick.png`, `B\03-city-view.png`.
**Root cause:** `CityDesignBoxManager.show()` (`src/screens/settlements/cityView/CityDesignBoxManager.ts:18-103`) hard-anchors `left:12px; bottom:12px; z-index:100` and never consults `resolvePanelPlacement`, even though `CityView.openBuildPalette()` (:460-486) uses exactly that pattern for the palette. The settlement panel is deliberately kept visible in city view (`UIManager.ts:344-364`).
**Fix:** run the design box's desired rect through `resolvePanelPlacement` with `collectOccupiedRects()` (hero + settlement panel rects) at `show()` time; re-resolve on panel `userMoved` if cheap.
**Files:** `CityDesignBoxManager.ts` (+ reuse `src/screens/shared/panelPlacement.ts`).
**Tests:** unit-test the placement helper invocation shape in `test/screens/shared/panelPlacement.test.ts` style if a pure helper is extracted.

### F6 — "Human" vs "Player" label drift  → standardize on **"Player N"**
**Root cause (verified):** engine names seat 0 "Human" (`packages/engine/src/init.ts:164` `makePlayers`), then the client's anonymous seat claim renames it to literally "Player" (`src/managers/GameSessionManager.ts:127,166` → server `routes.ts:289-291`). Round 1 renders the pre-claim create-response; round 2+ renders the renamed server row (`mergeFromEndTurn`).
**Fix:** engine `makePlayers`: humans become `Player ${i+1}` ("Player 1", "Player 2"…); AI keeps `AI …`. `GameSessionManager` anonymous claim fallback becomes `Player ${seat+1}`. Tile popup fallback already matches ("Player ${ownerId}").
**Files:** `packages/engine/src/init.ts`, `src/managers/GameSessionManager.ts`; grep tests/smoke for "Human" assertions and update.
**Note:** top-bar/labels are DOM (toolbar), not canvas → no baseline impact.

### F7 — Selection-indicator cleanup
**Root causes (verified):**
- The red circle on castles is the **always-on ownership ring** (`paintCastle`, `paint2d/index.ts:409-428`) — reads as "selection".
- The *selected* castle variant is genuinely sticky: `selectHero` never clears `selectedSettlementId` (`src/state/gameState.ts:119-129` — asymmetric with `selectSettlement` :136-140), and `clickIntent.ts:126` only offers select-settlement when no hero is selected, so it can't be replaced by clicking.
- Hover hex (solid, lineWidth 3) + inspected tile (white dashed) legitimately stack on one tile; no mutual exclusion anywhere.
**Fix:**
1. `gameState.ts selectHero` also nulls `selectedSettlementId` (mirror `selectSettlement`). Update `test/state/turnController.test.ts` if it asserts the asymmetry.
2. `paintCastle`: make **selected** clearly distinct (bright double-ring / pulsing width), and de-emphasize the unselected ownership ring (lower alpha) so it stops reading as selection.
3. Hover highlight: lineWidth 3 → 2 (subtle de-emphasis; it's the most transient ring).
**Files:** `src/state/gameState.ts`, `src/render/scene/paint2d/index.ts`, `test/state/turnController.test.ts`.
**Baselines:** regen `adventure-overview` + both charter scenes (castle ring in frame).

### F8 — Tile popup leaks terrain info on unexplored tiles  → hide all until seen
**Root cause:** `describeTile` (`src/screens/adventure/tileInfo.ts:159-183`) reads terrain + `TERRAIN_COST` unconditionally (:177); "Unexplored" is appended in `tileInfoPanel.ts:66`. `isTileVisibleTo` (`src/render/fog.ts:47-63`) is already the gate (:171).
**Fix:** when `fogged`, return coordinates + `fogged: true` **only** (suppress terrain/cost/settlement/heroes/charter/territory lines — keep the existing `visibleOrOwned` exception for own-owned tiles); panel shows "Tile q,r — Unexplored".
**Files:** `tileInfo.ts`, `tileInfoPanel.ts` (+ their tests if present).
**Baselines:** none (DOM popup not captured).

### F9 — Rejected-action feedback (toasts)
**Infra exists:** `src/screens/shared/toast.ts` (`showToast(msg, "error"|"info")`, bus-driven `attachCommandFailureToasts` already wired). Add **dedupe** (same message within ~1.5 s refreshes instead of stacking).
**Fix:** map `applyClickIntent` / `resolveAdventureClick` outcome branches to short toasts: not enough movement (with numbers), "Select a hero first", move rejected reasons, attack/charter rejections. Keep `clamped to q,r` silent-ish (the dashed target marker already communicates it) or one info toast.
**Files:** `src/screens/shared/toast.ts`, `src/screens/adventure/adventureView.ts`.
**Tests:** unit-test the dedupe in a new `test/screens/shared/toast.test.ts` (node:test, DOM-light) if feasible without jsdom; otherwise keep logic pure and test that.

### F10 — Path cost readout
**Root cause:** `computeReachableSplit` (`src/render/overlays/pathOverlay.ts:14-28`) computes cumulative cost internally and **discards it**; `computePathCost` (`packages/engine/src/map/pathfinding.ts:72-80`) exists (returns 0 on impassable — mind that).
**Fix:** extend `computeReachableSplit` to also return `{ index, costToSplit, totalCost }` (update its 2 call sites: `adventureScene.ts:261-264`, `clickIntent.ts:100,137`); `AdventureView.updatePath` (:423-455) stores the numbers; HUD movement text appends `· Path 4.6/7` while a preview exists (fractional costs are real — forest 1.2).
**Files:** `pathOverlay.ts`, `adventureScene.ts`, `clickIntent.ts`, `adventureView.ts`, `hud.ts` (+ existing pathOverlay tests).
**Baselines:** path styling unchanged (numbers are DOM) → none beyond F4's.

### F11 — Economy transparency (HUD hover breakdown)
**Root cause of the confusing numbers (verified):** "Empire Income x/y" = Σ `effectiveIncome` (morale-scaled) / Σ `pop × goldTax` (`hud.ts:60-66`, `consumption.ts:49-53`); the −350/round is morale decay (`consumption.ts:41-47`: food/supplies deficit × 10); wood/stone drops are `applySettlementConsumption` building upkeep (`buildingRegistry.ts:320-326`); `settlementIncome`/`playerIncome` (toolbar "next turn gold") *includes* `goldPerTurn` while the HUD x/y excludes it — an inconsistency worth stating in the breakdown.
**Fix:** title/hover text on the HUD economy row (or the existing row's `title` attribute minimum, small hover div if cheap): `Gross 3500g · morale 90% → 3150g · upkeep 24g + 24 food · food deficit −10%/rd · goldPerTurn buildings +Xg`. All numbers already exported from `@heroes/engine` (`moraleDecay`, `foodDeficitRatio`, `buildingUpkeepRequired`, `playerIncome`, …) — presentation only.
**Files:** `src/screens/shared/hud.ts`, `src/managers/UIManager.ts` (snapshot builder).
**Baselines:** none (DOM).

### F12 — Onboarding & toolbar hygiene
**a) First-turn hint:** no onboarding exists. Add `attachFirstTurnHint()` in `GameEngine.initEventListeners` mirroring `mpPresenceHint.ts`'s self-contained DOM pattern; shown once after a game loads (skip via persisted flag `heroesJs.firstTurnHint.v1`, pattern from `settings.ts`/`panelLayout.ts`); 2–3 lines ("Click your hero, then click a hex to move · Double-click your settlement to enter it · Gear → Settings & help"); click/Esc dismisses.
**b) Test Battle → gear menu:** remove `toolbar.ts:350-355,362` main-row button; add `makeMenuItem("⚔ Test Battle")` under the divider next to Settings (closeDropdown + busy guard). **Update `test/visualRegression.test.ts:268`** to open the gear dropdown first (button becomes hidden until then).
**c) Hotkey/help overlay:** small modal listing current keys (Esc, B, R, 1–5 city styles/patterns, wheel/drag), opened from the gear menu and via `?`. Static content; lives in `screens/shared/`.
**Files:** `src/managers/GameEngine.ts`, `src/screens/shared/toolbar.ts`, new `src/screens/shared/firstTurnHint.ts` + `hotkeysModal.ts`, `src/state/settings.ts` (flag) or localStorage key, `test/visualRegression.test.ts`.

### F13 — Movement bar red at 0
**Fix:** in `HeroInfoMenu.update` (`src/screens/heroes/heroInfoMenu.ts:409-413`), set fill background conditionally: 0 → red gradient; ≤ 25% → amber; else existing green. Extract gradients to module constants at :191.
**Files:** `heroInfoMenu.ts`. **Baselines:** none (DOM).

### F14 — Trail fade
**Fix:** `paintHeroTrail` (`paint2d/index.ts:532-558`): index-based alpha ramp `0.55 * (0.4 + 0.6·i/n)` (oldest faintest); optionally `points.slice(-25)` in `adventureScene.ts:283` (render-side only).
**Files:** `paint2d/index.ts` (+ `adventureScene.ts` if slicing). **Baselines:** regen `adventure-overview` + charter scenes (trail in frame).

### F15 — Charter discoverability
**Root cause:** button disabled by `canStartCharter()` (`GameEngine.ts:252-267`; costs in `packages/engine/src/charter/start.ts:10-11`; funded from **hero purse**); reason is tooltip-only. Modal's Confirm never re-checks (`charterModal.ts:95-103`); failed start only `console.warn`s.
**Fix:** keep the button **enabled** whenever it's the player's turn with a hero selected; clicking opens a **requirements modal** listing pass/fail rows (hero on friendly settlement · purse 2500g · warehouse wood 20 · stone 15) using the `settlementInfoMenu.ts:382-411` `missing[]` pattern; Confirm enabled only when all pass → `enterCharterMode`. When purse is short, show hint: "Withdraw gold from a friendly settlement's treasury (hero must stand on it)". Also add explanatory `title`s to the grayed Withdraw/Deposit buttons (`heroInfoMenu.ts:427-436`).
**Files:** `src/screens/shared/toolbar.ts`, `src/screens/adventure/charterModal.ts` (or new requirements modal), `src/managers/GameEngine.ts`, `src/screens/heroes/heroInfoMenu.ts`.

### F16 — City view polish
**a) City labels hidden under toolbar** (verified: labels emitted for all tiers at `cityScene.ts:178-186`, painted `#ffffff` at canvas (12,12)/(12,30), occluded by fixed `#toolbar` z-10, ~125 px tall): pass toolbar height into `CitySceneInput` and offset the label `y`.
**b) Buildable-cell highlight:** new optional `CitySceneInput.buildableCells: ReadonlySet<string>` → `cityCell` node flag → subtle paint tint/outline in `paint2d` next to `paintCityCell`; `CityView.draw` computes the set from `placer.canPlaceAt` while the placer is active (`buildingPlacer.ts:530`).
**c) 2×2 buildings never fit the starter town** (verified: starter = `denseUrban` @70% fill on 5×5, expected clear 2×2 blocks ≈ 0.13): tweak `generateDenseUrban` (`src/render/cityBuildingGen.ts:266-290`) to **carve one guaranteed clear 2×2 block** (excluding center) so farm fields are placeable on the default layout.
**Files:** `cityScene.ts`, `paint2d/index.ts`, `cityView.ts`, `cityBuildingGen.ts` (+ `test/screens/settlements/buildListSections.test.ts`-adjacent gen test if one exists).
**Baselines:** regen both `city-view-*` (starter layout carve); buildable highlight only shows in build mode → no baseline beyond that.

### F17 — Hero sprite mid-tween "red smear" (small, verify-after)
No double-draw exists; plausible culprits: NN-resampling under squash, red trail under the sprite, pose-flip timing. F14's trail fade may resolve most of it. **Action:** after F14 lands, re-capture mid-tween frames; only if still smeary, try smoothing during motion or reducing squash. Time-boxed, optional.

---

## Implementation waves (file-ownership aware)

| Wave | Items | Files touched (hot files bolded) |
|---|---|---|
| 1 (parallel) | F6 · F7a · F8 · F13 · F5 · F2 · F12b+c | engine/init, GameSessionManager / state/gameState / tileInfo+tileInfoPanel / heroInfoMenu / CityDesignBoxManager / **cityView.ts+UIManager+turnHooks** / toolbar+visualRegression test |
| 2 (parallel) | F1+F12a · F4+F14+F16+F7b,c (render polish) | **adventureView+GameEngine**+firstTurnHint / paint2d+adventureScene+cityScene+cityBuildingGen |
| 3 (parallel) | F9+F10+F11 (feedback layer) · F15 | **adventureView**+toast+pathOverlay+**hud**+clickIntent / toolbar+charterModal+GameEngine+heroInfoMenu |
| 4 | Verification & delivery | build + lint:deps + test:unit + browser suites; baseline regen; grouped commits |

Conflict notes: `adventureView.ts` is touched in waves 1(F8 no)—2(F1)—3(F9/F10) → strictly sequential by wave. `GameEngine.ts` waves 2(F1/F12a)—3(F15) → sequential. `toolbar.ts` waves 1(F12b)—3(F15) → sequential. `cityView.ts` waves 1(F2)—2(F16) → sequential. `hud.ts` only wave 3. `paint2d/index.ts` only wave 2.

## Verification & delivery

- Branch `playtest-fixes` off current HEAD.
- **Stop the dev servers before running the full gate** (ports come from `.env`; the test runner spawns its own servers on the same ports). Restart dev after if desired.
- Gate before any commit: `precommit-checker` subagent (`npm run build` + `npm run test:all`).
- Baseline regen once, after all visual changes land: `npm run test:visual:update-baselines`, then eyeball the diff. Expected regens: `adventure-overview`, `charter-traveling`, `charter-constructing`, `city-view-parallax-on`, `city-view-parallax-off`. DOM-only changes (F6/F8/F9/F11/F12/F13) need none.
- Grouped commits: (1) state/input correctness bugs (F1, F2, F6, F7a), (2) fog/popup + toasts + readouts (F4, F8, F9, F10, F11), (3) render polish + city (F5, F7b/c, F13, F14, F16, F17 if touched) + baseline regen, (4) onboarding/toolbar/charter (F12, F15).
- `doc-updater` runs at start (fast-return) and again at the end (docs likely needing updates: `docs/architecture.md` module notes for new shared modules, render technical-spec for indicator/paint changes).
