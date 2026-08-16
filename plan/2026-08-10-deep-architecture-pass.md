# Plan: Deep Architecture Pass (Beyond Cycle Elimination)

**Status:** Planned. Targets the four areas surfaced at the end of the cycle cleanup that the depcruise work deliberately did NOT touch.
**Build baseline:** `npm run build`, `npm run lint:deps`, `npm run test:all` all pass on `architecture/circular-dep-cleanup` (commit `526398e`).

---

## What we're fixing (4 workstreams)

| # | Concern | Why it matters |
|---|---|---|
| 1 | R9 stepping stone (`shared/gameState.ts` → `src/state/gameState.ts`) is still in the codebase | R9 promised "finish what shared/gameState.ts started." Right now it's a documented exception. |
| 2 | `src/state/gameState.ts` (1290 lines) mixes types, constants, reducers, helpers | 30+ exports in one file. Editing turn logic means scrolling past charter constants. |
| 3 | `src/views/` (28 files, no subfolders) lumps screens, modals, panels, HUD into one directory | Unrelated concerns sit next to each other. `CityDesignBoxManager` and `manualBattleArena` are both "views" but have nothing in common. |
| 4 | `src/render/` (29 files, flat) has renderer, minimap, building-gen, asset-descriptors, palettes all mixed | Same problem — "render" is too coarse a label. |

---

## Discovery (current state)

### `src/state/gameState.ts` — 1290 lines, 60+ exports

Mixed concerns inside one file:
- **Constants** (lines 94–95, 124, 406, 891–895, 897, 1177): `DAYS_PER_WEEK`, `DAYS_PER_MONTH`, `MOVEMENT_PER_TURN`, `CAPTURE_GOLD_REWARD`, charter/settlement/town-hall cost tables
- **Pure utilities** (38, 104, 119): `isHuman`, `calendarFromDay`, `monthName`
- **Turn-related reducers** (515–587, 643, 668): `applySettlementConsumption`, `applyMoraleDecay`, `applyEffectiveIncome`, `runAutoTrade`, `applyEndOfTurn`, `applyEndOfTurnDetailed`, `setAutoTrade`, `applyWeeklyUpkeep`, `advanceRound` — pure `(GameState) → GameState` functions, **all eligible for R9 extraction**
- **Movement reducers** (271, 327, 356, 391): `startMove`, `cancelMove`, `reorderStack`, `detectAdjacentEnemy`
- **Battle/capture reducers** (414, 452, 467): `captureSettlement`, `startBattle`, `endBattlePhase`
- **Charter reducers** (918, 1015, 1086, 1166): `startCharter`, `stepTravelCharter`, `advanceCharters`, `cleanupDefeatedHeroCharters`
- **Settlement upgrade reducers** (1192, 1247, 1268, 1298, 1349): `startBuildingUpgrade`, `applyBuildingUpgrade`, `startTownHallUpgrade`, `startSettlementUpgrade`, `advanceSettlementUpgrades`
- **Trade/recruit reducers** (710, 763, 815): `transferGold`, `tradeResources`, `recruitHero`
- **Selection reducers** (239, 251, 256, 262): `selectHero`, `clearSelection`, `selectSettlement`, `clearSettlementSelection`

### `src/views/` — 28 files, no subfolders

| Type | Files (approx line count) |
|---|---|
| Full-screen views | `adventureView.ts` (688), `cityView.ts` (418), `homeView.ts` (591), `manualBattleArena.ts` (1562), `multiplayerLobby.ts` (441), `newGameScreen.ts` (289), `toolbar.ts` (703) |
| Modal popups | `settingsMenu.ts` (623), `developerSettingsMenu.ts` (173), `testBattleSetup.ts` (147), `battleModal.ts` (46), `battleResultCard.ts` (103), `buildingMenu.ts` (230), `buildingSelectionMenu.ts` (233), `settlementInfoMenu.ts` (434), `heroInfoMenu.ts` (628), `settlementPanel.ts` (280), `heroRosterMenu.ts` (163), `settlementRosterMenu.ts` (141), `tradeModal.ts` (125), `platoonInfoPopup.ts` (192), `assetManager.ts` (189), `buildingPlacer.ts` (504), `confirmDialog.ts` (70) |
| HUD overlays | `hud.ts` (78) |
| Pure DOM panels | `CityDesignBoxManager.ts` (111) |
| Cross-cutting | `menu.ts` (296 — primitives: `openCenteredModal`, `styleButton`, `menuTheme`), `viewLauncher.ts` (18) |

### `src/render/` — 29 files, mostly flat

- `renderer.ts` (325), `cityRenderer.ts` (368), `cityBuildingGen.ts` (374), `assetDescriptors.ts` (581) — top-level orchestrators
- `overlays/` (3 files): `pathOverlay.ts` (127), `resourceIcon.ts` (21), `territoryOutline.ts` (90)
- `cityBuildingDraw/` (8 files): `classic.ts` (59), `blocky.ts` (302), `organic.ts` (390), `crystalline.ts` (57), `industrial.ts` (60), `primitives.ts` (124), `spots.ts` (96), `types.ts` (19)
- Standalone: `sprites.ts` (148), `heroSprites.ts` (127), `minimap.ts` (196), `minimapCamera.ts` (90), `renderTypes.ts` (30), `fog.ts` (36), `camera.ts` (31), `palettes.ts` (77), `assets.ts` (70), `assetSource.ts` (138), `buildingStyles.ts` (9), `buildingStyleResolver.ts` (1, shim), `horseVariants.ts` (2, shim)

### R9 stepping stone

`shared/gameState.ts` currently re-exports `tradeResources`, `applyEndOfTurnDetailed`, `AutoTradeTransfer` from `../src/state/gameState`. `server/routes.ts` imports through it. The depcruise config has `pathNot: "^shared/gameState\\.ts$"` on the `no-shared-from-src-or-server` rule to keep this from blocking the gate.

---

## Approach

Each workstream is its own phase. Each phase ends with `npm run build` + `npm run lint:deps` + `npm run test:all`.

### Phase 1 — R9: extract turn reducers to `shared/turns/`

The previous plan left this as a stepping stone. Finish it.

**New file:** `shared/turns/index.ts` (or `shared/turns.ts` — using subfolder keeps future turn helpers extensible).

Contents (all `(GameState) → GameState` or pure helpers, all eligible to live in the engine-neutral leaf):
- `applySettlementConsumption`
- `applyMoraleDecay`
- `applyEffectiveIncome`
- `runAutoTrade`
- `applyEndOfTurn`
- `applyEndOfTurnDetailed`
- `setAutoTrade`
- `applyWeeklyUpkeep`
- `advanceRound`
- `AutoTradeTransfer`, `ApplyEndOfTurnResult` types
- `WAREHOUSE_RESOURCES` re-export (already in `shared/constants.ts`)

**Sub-issues:**
- `applyEndOfTurnDetailed` and `runAutoTrade` reference helpers in `src/economy/consumption.ts` (`buildingUpkeepRequired`, `clampMorale`, `clampWarehouseNonNegative`, `effectiveIncome`, `foodRequired`, `moraleDecay`). Those economy helpers would need to move to `shared/economy/` or be inlined into `shared/turns/`. Plan: move them to `shared/economy/consumption.ts` (also a leaf — they're pure functions).
- `applyWeeklyUpkeep` references `buildingUpkeepRequired` (same `economy/consumption.ts` move).
- `advanceSettlementUpgrades` references `pickStyleForBuilding` (already in `shared/styleResolver.ts`).

**Cleanup:**
- Delete `shared/gameState.ts`.
- Update `server/routes.ts` to import from `../shared/turns` (and `../shared/economy/consumption` if needed) directly.
- Remove the `pathNot: "^shared/gameState\\.ts$"` exception from `dependency-cruiser.cjs`.

**Verification:** build, lint:deps shows `✔ no dependency violations found` with no exceptions needed for shared/gameState.

---

### Phase 2 — `src/state/` SRP split (group reducers by concern)

After Phase 1, `state/gameState.ts` shrinks but still has ~1000 lines. Group reducers by responsibility into `state/reducers/`:

```
src/state/
├── gameState.ts          # types, GameState, initial state, isHuman, select*/clear* (200-300 lines)
├── settings.ts           # unchanged
├── turnController.ts     # unchanged
├── units.ts              # unchanged (legacy, mostly type re-exports)
└── reducers/
    ├── movement.ts       # startMove, cancelMove, reorderStack, detectAdjacentEnemy
    ├── battle.ts         # startBattle, endBattlePhase
    ├── capture.ts        # captureSettlement
    ├── charter.ts        # startCharter, stepTravelCharter, advanceCharters, cleanupDefeatedHeroCharters
    ├── settlement.ts     # startBuildingUpgrade, applyBuildingUpgrade, startTownHallUpgrade, startSettlementUpgrade, advanceSettlementUpgrades
    └── trade.ts          # transferGold, tradeResources, recruitHero
```

Each `reducers/*.ts` exports the same surface (`export function startMove(...)`) so existing import sites don't change.

Constants move with their reducers:
- `CAPTURE_GOLD_REWARD` → `reducers/capture.ts`
- `CHARTER_*`, `SETTLEMENT_UPGRADE_COSTS` → `reducers/charter.ts` and `reducers/settlement.ts`
- `TOWN_HALL_COSTS` → `reducers/settlement.ts`
- `MAX_HEROES_PER_PLAYER`, `HERO_RECRUIT_COST` → `reducers/trade.ts`

**`gameState.ts` keeps:**
- All types (`Player`, `HeroState`, `GameState`, `GamePhase`, etc.)
- Initial-state factory (`createInitialState`)
- Selection reducers (small, tightly coupled to GameState shape)
- Pure utilities (`isHuman`, `calendarFromDay`, `monthName`)
- Constants `DAYS_PER_WEEK`, `DAYS_PER_MONTH`, `MOVEMENT_PER_TURN`

---

### Phase 3 — `src/views/` split by concern

Proposed structure:

```
src/views/
├── viewLauncher.ts                  # unchanged (registry, 18 lines)
├── menu.ts                          # unchanged (DOM primitives library, 296 lines)
├── screens/                         # full-screen views
│   ├── adventureView.ts             # was views/adventureView.ts
│   ├── cityView.ts                  # was views/cityView.ts
│   ├── homeView.ts                  # was views/homeView.ts
│   ├── manualBattleArena.ts         # was views/manualBattleArena.ts
│   ├── manualBattleArena/
│   │   ├── ui.ts                    # NEW: buildStatusTile, makeMetricBar, computeLayout, specialtyIcon
│   │   └── dialogs.ts               # NEW: openLeaveBehindDialog, openSpyCostDialog
│   ├── multiplayerLobby.ts
│   ├── newGameScreen.ts
│   └── toolbar.ts                   # SRP split below
├── modals/                          # modal popups
│   ├── assetManager.ts
│   ├── battleModal.ts
│   ├── battleResultCard.ts
│   ├── buildingMenu.ts
│   ├── buildingPlacer.ts
│   ├── buildingSelectionMenu.ts
│   ├── confirmDialog.ts
│   ├── developerSettingsMenu.ts
│   ├── heroInfoMenu.ts
│   ├── heroRosterMenu.ts
│   ├── platoonInfoPopup.ts
│   ├── settlementInfoMenu.ts
│   ├── settlementPanel.ts
│   ├── settlementRosterMenu.ts
│   ├── settingsMenu.ts
│   ├── testBattleSetup.ts
│   └── tradeModal.ts
├── hud/                             # in-canvas HUD overlays
│   └── hud.ts
└── panels/                          # pure DOM panels (no canvas, no state)
    └── CityDesignBoxManager.ts
```

**Why modals/ and screens/ and panels/:**
- `screens/` — own the viewport, drive game state. Lifecycle = open/close the screen.
- `modals/` — pop up over a screen, don't drive game state on their own (they read state, dispatch actions through callbacks).
- `panels/` — pure DOM bits with no canvas and no state. Just buttons. `CityDesignBoxManager` fits here exactly.

**Why `toolbar.ts` is special (703 lines):** It's the in-game chrome — buttons for menu/end-turn/save — but it's also a "screen" that owns the viewport's top region. Either it stays at `screens/toolbar.ts` (and gets an internal SRP split into `toolbar/state.ts` + `toolbar/builders.ts` if needed), or it becomes its own `chrome/` folder alongside `screens/`. Recommendation: `screens/toolbar.ts` with one helper file if it grows past 800 lines after the move. Don't pre-split.

**Files touched by Phase 3:** 28 view files moved into subfolders. Import paths inside each file change from `"./menu"` to `"../menu"` (etc.) but the actual module paths in the rest of `src/` (e.g. `views/assetDescriptors.ts` imports `from "./overlays/pathOverlay"`) stay the same because the moved view files import the same things from sibling render/state modules via relative paths that don't change.

---

### Phase 4 — `src/render/` split by surface

Proposed structure:

```
src/render/
├── renderer.ts                      # main orchestrator (unchanged position)
├── renderTypes.ts                   # cross-cutting types (unchanged)
├── camera.ts                        # main-viewport camera (unchanged)
├── fog.ts                           # vision/fog (unchanged)
├── palettes.ts                      # color palettes (unchanged)
├── assets/                          # asset pipeline
│   ├── assets.ts                    # was render/assets.ts
│   ├── assetSource.ts               # was render/assetSource.ts
│   └── assetDescriptors.ts          # was render/assetDescriptors.ts
├── heroes/                          # hero/horse sprite drawing
│   ├── sprites.ts                   # was render/sprites.ts
│   ├── heroSprites.ts               # was render/heroSprites.ts
│   ├── buildingStyles.ts            # was render/buildingStyles.ts (style registry, used by sprite picker)
│   └── horseVariants.ts             # was render/horseVariants.ts (shim)
├── buildings/                       # city/building rendering
│   ├── cityRenderer.ts              # was render/cityRenderer.ts
│   ├── cityBuildingGen.ts           # was render/cityBuildingGen.ts
│   └── cityBuildingDraw/            # unchanged (already a subfolder)
│       └── ...
├── minimap/                         # minimap
│   ├── minimap.ts                   # was render/minimap.ts
│   └── minimapCamera.ts             # was render/minimapCamera.ts (already moved in cycle cleanup)
└── overlays/                        # unchanged (already a subfolder)
    └── ...
```

**Why this split:** "render" mixes concerns that have nothing in common. `assets/` is data plumbing (sprite keys, asset URLs). `heroes/` is one type of draw call. `buildings/` is another. `minimap/` has its own camera and rotation logic. `overlays/` is the only folder already organized this way.

**Files touched by Phase 4:** 15 file moves + ~25 import-path updates.

---

## Order

```
Phase 1 (R9 reducer extraction)
   ↓
Phase 2 (state/ SRP split)
   ↓
Phase 3 (views/ split by concern)
   ↓
Phase 4 (render/ split by surface)
   ↓
Each phase ends with build + lint:deps + test:all green.
```

Phase 1 → 2 because Phase 2 splits the same `gameState.ts` Phase 1 extracted from. Phase 2 → 3 because Phase 2's split exposes more "view responsibilities" — easier to spot screens vs modals once state is organized. Phase 3 → 4 last because render code is more independent and the lowest-risk move.

---

## Estimated scope

| Phase | New files | Moved files | Import-path updates |
|---|---|---|---|
| 1 (R9) | 2 (`shared/turns.ts`, `shared/economy/consumption.ts`) | 1 deleted (`shared/gameState.ts`) | ~10 |
| 2 (state SRP) | 6 (`state/reducers/*.ts`) | 0 | ~25 |
| 3 (views split) | 2 (manualBattleArena/ui.ts, dialogs.ts) | 28 (moved into subfolders) | ~80 (just `../menu` style fixups per file) |
| 4 (render split) | 0 | 15 | ~25 |
| **Total** | **10** | **44** | **~140** |

Most of Phase 3 and Phase 4 work is mechanical (move file + rewrite its relative imports).

---

## Risks

- **Phase 1 dependency on `economy/consumption.ts`:** `applyEndOfTurnDetailed` imports `buildingUpkeepRequired`, `clampMorale`, etc. from `src/economy/`. Moving `economy/consumption.ts` to `shared/economy/consumption.ts` adds another leaf module and another file to the depcruise rule "shared/ cannot import from src/". The move is safe (those helpers are pure functions over `SettlementState`), but the import-graph surface area grows.
- **Phase 2 reducer extraction:** Each reducer file currently uses locals from `gameState.ts`. Moving them requires re-importing `GameState`, `HeroState`, `SettlementState`, etc. Most are already in `shared/types` or `shared/settlementTypes`, but reducer-local interfaces (`StartMoveResult`, `ReorderResult`, `CaptureResult`, `StartCharterPayload`, etc.) need to move with their reducer or be promoted to `shared/settlementTypes.ts`.
- **Phase 3 view split:** `manualBattleArena.ts` at 1562 lines is the biggest risk. Its UI helpers (`buildStatusTile`, `makeMetricBar`) and dialog flows (`openLeaveBehindDialog`, `openSpyCostDialog`) reference each other and the main `openManualBattleArena` closure. Splitting requires either lifting shared state into a context object or carefully passing closures. The phased split (just `ui.ts` + `dialogs.ts`) is the minimal-risk version.
- **Phase 4 render split:** `cityRenderer.ts`, `cityBuildingGen.ts`, and `assetDescriptors.ts` all read from each other. Moving them into subfolders risks subtle ordering issues if circular imports sneak in. depcruise catches this, but the failed build cycle costs time.

---

## Out of scope (deliberate)

- **Function-level SRP** inside large reducers (e.g. `createInitialState` could split into "spawn players", "spawn heroes", "spawn settlements"). Each is <50 lines; not worth it yet.
- **Module-level cohesion across layers** — e.g. should `economy/` move under `state/`? Should `combat/` go in `shared/`? These are organizational questions that depend on how the team wants to grow the engine. This plan defers them.
- **Test coverage** — no new tests added. Each phase relies on `npm run test:all` to catch regressions.
- **Performance** — file moves don't change runtime behavior. Build time may improve slightly due to better chunking (Vite groups by directory).
- **Pre-commit gate expansions** — could add `npm run lint:tsc --noEmit` or per-file size limits. Out of scope.

---

## Validation gates

After each phase:
1. `npm run build` — must pass.
2. `npm run lint:deps` — must remain at `✔ no dependency violations found`. New shared/ files (Phase 1) must NOT trigger the `no-shared-from-src-or-server` rule.
3. `npm run test:all` — all three suites (smoke, multiplayer, cityView) must pass.
4. `git diff --stat` — confirm only intended files changed.

After Phase 1 specifically: the depcruise `pathNot: "^shared/gameState\\.ts$"` exception is removed. If that surfaces a regression, the exception stays in until R9 is fully done.
