# Plan: Finishing the Combat Breakout — Decomposing `manualBattleArena.ts`

*Authored 2026-08-17. Sibling to `plan/2026-08-17-consolidated-phase-1-5-track-map.md` (this is the missing concrete plan for §7.2's `Decompose src/screens/combat/manualBattleArena.ts into modular components` row, currently ⬜ not started with the caveat "vague scope, high risk without a pre-agreed target structure"). Also touches the last open item from `plan/2026-08-11-srp-module-reorganization.fable.md` §1's diagnosis table — the SRP fable's table-of-shame listed `src/views/manualBattleArena.ts` (then 1562 lines; now 2064) as the prime example of "1000+ line files are the disease." The fable's Target Architecture for the client package got mostly delivered (the `combat/` subdirectory, the scene-builder seam, the entityMirror); this plan delivers the one big file it left undone.*

**Status (2026-08-17, session start): CB-4 starting now** — worktree `phase5/track-b-combat-decomposition-cb4` cut from `main` (`8f8a32d`, has CB-1 + CB-2 + CB-3 merged). CB-1/2/3 are already ✅ merged via PRs #112, #113, #115 — see §5 status table. **CB-4 still blocked on paint2d/ per-kind transcription (5.B P1 #5) for full byte-equivalence, but can land now behind the `useSceneBuilder` flag with a `draw()` fallback (§9.3).**

---

## 1. What's already broken out (so we don't redo it)

This plan **does not** touch any of the following — they're done:

| Layer | Files | Tests |
|---|---|---|
| Engine — pure rules | `packages/engine/src/combat/{types,damage,grid,manualBattle,resolveBattle}.ts` (6 files, largest 603 lines) + `combatConfig.ts` | `test/combat/manualBattle.test.ts` (10/10), `test/combat/resolveBattle.test.ts` (10/10) — per §5.3 of the phase map |
| Server | `server/app/commandHandler.ts`'s `ResolveBattle` case (PR #91) + `cleanupDefeatedHeroCharters()` on battle result (R5 closure) | `test/server/commandHandler.test.ts` |
| Pure draw decomposition | `src/render/scene/sceneBuilder/battleScene.ts` — `BattleSceneInput → SceneNode[]`, 15 tests, 8 new node kinds | `test/render/battleScene.test.ts` |
| Adjacent UI helpers | `src/screens/combat/{battleModal.ts:46, battleResultCard.ts:103, platoonInfoPopup.ts:246, testBattleSetup.ts:147}` | Each has its own focused responsibility today |

**Crucial detail:** `battleScene.ts` produces `SceneNode[]` but **nothing consumes it yet**. `manualBattleArena.ts`'s `draw()` still calls `ctx.fillRect`/`ctx.stroke` directly. Wiring that consumption is part of this plan (CB-3 below).

---

## 2. What isn't broken out — the 2064-line file

`src/screens/combat/manualBattleArena.ts` does ten things in one file. Verified by `grep` of `^(export )?(function|const|class|interface|type)` — the file exports one entry (`openManualBattleArena` at line 581) and internally defines 26+ helpers + 5 interfaces + 1 type alias covering:

| Concern | Approx. line range | Notes |
|---|---|---|
| Constants (`HEX_SIZE_MAX`, `HEX_SIZE_MIN`, `CANVAS_MARGIN`, `RAIL_WIDTH`, `DEBUG_LOG`, `LOG_PREFIX`) | 65–86 | Mixed in at the top with magic numbers |
| Debug logging (`debugLog`, `LOG_PREFIX`) | 85–91 | Debug flag still `true` |
| Hex formatting helpers (`fmtHex`, `platoonLabel`, `gridExtent`, `fitHexSize`) | 93–155 | Pure math, no DOM, no Canvas |
| Specialty icons (`SPECIALTY_ICONS`, `specialtyIcon`) | 138–155 | Static table + lookup |
| Leave-behind dialog (sub-flow for surrender gold distribution) | 156–378 | A 222-line surrender-popup inside the arena file |
| Specialty visibility (`isAlive`, `visibleSpecialty`, `hpRatio`, `hpColor`) | 379–416 | Pure functions on Combatant |
| Platoon strip DOM construction (`PlatoonStripDetail`, `detailRow`, `buildPlatoonStrip`) | 418–580 | DOM-only, no Canvas |
| `openManualBattleArena` — the orchestrator | 581 → end (2064) | The orchestrator + canvas drawing + state mutation + AI stepping + click/hover input |

The 2064-line file is one orchestrator that's been growing since the 2026-08-11 fight-screen redesign added Stage 1 (reflow), then G1 (AI pacing on timers), each of which grew the file instead of splitting it.

---

## 3. Goal

Replace `src/screens/combat/manualBattleArena.ts` (2064 lines, 1 export) with a **directory** `src/screens/combat/arena/` containing 7–10 focused files (each ≤300 lines, single responsibility, independently testable), plus a thin orchestrator (≤150 lines) that wires them. The arena's public API stays the same: `openManualBattleArena(opts)` is still called the same way from `src/state/turnController.ts` and from `testBattleSetup.ts`.

**Success criteria:**
- `manualBattleArena.ts` ≤ 150 lines and contains only the orchestrator (`openManualBattleArena`) + the `ManualBattleController` return type.
- `npm run build`, `npm run lint:deps`, `npm run validate-assets`, `npm run test:all` all pass unchanged.
- The existing `test/render/battleScene.test.ts` (15 tests) passes against the new paint path (proves the `SceneNode[]` wiring is byte-equivalent).
- A new `test/screens/combat/arena.test.ts` covers the new module seams (input, state mutators, AI pacing) without booting a browser.

---

## 4. Target module split

```
src/screens/combat/
├── arena/                          ← NEW DIRECTORY
│   ├── index.ts                    (~30 lines) — re-exports openManualBattleArena
│   ├── openManualBattleArena.ts    (~120 lines) — the orchestrator + ManualBattleController interface
│   ├── constants.ts                (~25 lines) — HEX_SIZE_MAX/MIN, CANVAS_MARGIN, RAIL_WIDTH, AI_TELEGRAPH_MS, AI_STEP_MS
│   ├── layout.ts                   (~120 lines) — gridExtent, fitHexSize, hex math (pure)
│   ├── draw.ts                     (~280 lines) — draw() with raw Canvas2D calls (current path, kept)
│   ├── paint.ts                    (~120 lines) — paintSceneForArena() — new path that consumes battleScene.ts's SceneNode[] via paint2d/
│   ├── input.ts                    (~180 lines) — click/hover delegation, hit-testing, selection state, pendingTarget/approachHexes
│   ├── state.ts                    (~200 lines) — ManualBattleStateMirror + attack/move/retreat/surrender/endTurn mutators
│   ├── ai.ts                       (~140 lines) — advanceAi() stepped on timers, telegraph rings, closeArena() timer cancel
│   ├── view.ts                     (~250 lines) — DOM construction (rails, header, info card overlay), event delegation
│   └── leaveBehind.ts              (~220 lines) — openLeaveBehindDialog(), applyLeaveBehind() — the 222-line surrender sub-flow
├── battleModal.ts                  (unchanged)
├── battleResultCard.ts              (unchanged)
├── platoonInfoPopup.ts             (unchanged)
├── testBattleSetup.ts              (unchanged)
└── manualBattleArena.ts            (REWRITTEN, ≤150 lines) — calls into arena/openManualBattleArena.ts, keeps the file as the legacy entry-point for callers that still import the old path
```

### 4.1 Module responsibilities (what each owns, what it must not)

| Module | Owns | Must not import |
|---|---|---|
| `constants.ts` | Pure numeric/string constants for the arena | anything DOM, Canvas, or `@heroes/engine` |
| `layout.ts` | Grid extent solving, hex math (pure) | DOM, Canvas |
| `draw.ts` | The current Canvas2D `draw()` (kept as-is, no behavior change in CB-1) | `@heroes/engine` mutating calls; pure rendering only |
| `paint.ts` | The new `SceneNode[] → canvas` path via `paint2d/paintScene()` + `Paint2DDep` | Vite-coupled asset files (`assetDescriptors.ts`, `assets.ts`, `sprites.ts`, `cityRenderer.ts`, `cityBuildingDraw.ts` barrel) |
| `input.ts` | Click/hover delegation, hex hit-testing, selection, `pendingTarget`/`approachHexes`/`approachChoice` state | Game-state mutation (delegates to `state.ts`) |
| `state.ts` | The mutable `ManualBattleState` mirror, attack/move/retreat/surrender/endTurn mutators, calls `handleCommand` for any persistable action | DOM, Canvas, setTimeout/setInterval (timer ownership lives in `ai.ts`) |
| `ai.ts` | The timer-driven `advanceAi()` step, telegraph ring state, `closeArena()` cancels timers | DOM mutation outside of ai-driven repaint signals |
| `view.ts` | DOM construction: rails (with the G1 delegated hover listeners), header, info card overlay | Canvas, `@heroes/engine` mutating calls |
| `leaveBehind.ts` | The leave-behind surrender-gold distribution popup | Canvas, `@heroes/engine` mutating calls |
| `openManualBattleArena.ts` | Wires `layout` + `state` + `ai` + `input` + `view` + (`draw` or `paint`); owns the `ManualBattleController` returned to callers | Anything that would create a cycle with `state.ts` |

### 4.2 Dependency direction (acyclic)

```
constants ← layout ← draw
                  ← paint
                  ← input
                  ← state ← ai
                          ← view ← openManualBattleArena
                  ← leaveBehind ← openManualBattleArena
```

`state.ts` is the only module that mutates game state and the only module that calls `handleCommand`. `view.ts` and `draw.ts` read state via a passed-in `getState()` callback (the same pattern `battleScene.ts`'s `BattleSceneInput` already uses — see `plan/2026-08-17-consolidated-phase-1-5-track-map.md` §7.2 row "deliberately does not model the directional-melee hover latch").

### 4.3 The two-renderer question (CB-3)

The arena's `draw()` is currently raw Canvas2D. `battleScene.ts` already produces a pure `SceneNode[]` for the same content. Two ways to land the wiring:

- **CB-3a (recommended):** keep `draw.ts` as-is in the decomposition, add `paint.ts` alongside it, expose a `useSceneBuilder: boolean` flag on `openManualBattleArena` (default false in production, true in dev/test). Land the SceneNode wiring in this plan, but don't flip the default until `paint2d/`'s per-kind transcription is done (that's 5.B P1 #5 in the verification plan, a separate workstream). This way the decomp and the SceneNode wiring land independently.
- **CB-3b (deferred):** flip the default in the same PR as the decomp. Riskier — every visual change becomes a regression candidate at the same time as a structural change, conflating two risk surfaces.

**Recommended: CB-3a.** The two PRs can land back-to-back but each one is independently revertable.

---

## 5. PR breakdown & status chart

| PR | Title | Status | Depends on |
|---|---|---|---|
| **CB-1** | Extract `arena/` subdirectory: `constants`, `layout`, `view`, `input`, `leaveBehind` | ✅ merged (PR #112, 2026-08-17) | — |
| **CB-2** | Extract `arena/state.ts` (game-state mirror + mutators) + `arena/ai.ts` (timer-driven pacing) | ✅ merged (PR #113, 2026-08-17) | CB-1 |
| **CB-3** | `manualBattleArena.ts` shrinks to ≤150-line orchestrator that delegates to `arena/openManualBattleArena.ts`; delete the old inline code | ✅ merged (PR #115, 2026-08-17) | CB-2 |
| **CB-4** | Add `arena/paint.ts` — `SceneNode[]` consumer wired via `paint2d/paintScene()` + `Paint2DDep` (behind a `useSceneBuilder` flag, default false) | 🟡 in progress — worktree `phase5/track-b-combat-decomposition-cb4` (CB-4 lands with `draw()` fallback since all battle-kind painters are still no-op stubs; flag flips in a follow-up commit when paint2d/ per-kind transcription, 5.B P1 #5, completes) | paint2d |
| **CB-5** | New `test/screens/combat/arena.test.ts` — module-level tests for the seams that aren't exercised by the existing smoke suite | ✅ merged with CB-1 (12 tests, lands in PR #112) | CB-1 (lands first as scaffolding) |

**Status legend:** ⬜ not started · 🟡 in progress · ✅ merged · 🚫 blocked / deferred

### 5.1 Recommended PR shape

CB-1 + CB-5 together (decomp scaffolding + its own tests) → CB-2 + CB-4 together (state+ai extracted + orchestrator slims down) → CB-3 standalone (SceneNode wiring, behind the flag). That's **3 PRs total**.

### 5.2 Why this order

- **CB-1 first** because `constants`, `layout`, `view`, `input`, and `leaveBehind` are the lowest-risk extractions — pure helpers and DOM-only code with no state mutation. Landing them first proves the dependency graph works (especially the `view` ↔ `state` boundary), and gives CB-2 a clean place to drop the state mirror without fighting layout code.
- **CB-2 second** because `state.ts` + `ai.ts` are the highest-risk extractions (game state mutation, timer lifecycle, AI pacing). Land them when the surrounding code is already decomposed, so any regression points to the new modules directly.
- **CB-3 third** because it requires `paint2d/` per-kind transcription to exist first (5.B P1 #5 in the verification plan, owned by whoever does paint2d work). It also adds risk — visual change in addition to structural change — so it gets its own PR for clean revert.
- **CB-4 last** because the orchestrator can't shrink until the modules exist. Some of CB-4's diff will overlap with CB-1/CB-2's "delete the inline code" steps — that's intentional, easier to review each PR in isolation.
- **CB-5 in CB-1's PR** because module-level tests are most useful when the modules first appear.

---

## 6. Per-PR file changes

### 6.1 CB-1 — Extract `arena/{constants,layout,view,input,leaveBehind}`

**New files:**

- `src/screens/combat/arena/constants.ts` — `HEX_SIZE_MAX`, `HEX_SIZE_MIN`, `CANVAS_MARGIN`, `RAIL_WIDTH`, `SPECIALTY_VISIBILITY_THRESHOLD = 0.4` (currently a magic number at line 379), `DEBUG_LOG`, `LOG_PREFIX`. Pure values + types.
- `src/screens/combat/arena/layout.ts` — `GridExtent` interface, `gridExtent(state, size)`, `fitHexSize(unitExtent, availW, availH)`. Re-exports `hexCorners`, `axialToPixel`, `pixelToAxial`, `hexDistance`, `HEX_DIRECTIONS`, `nearestHexEdge` from `core/hex.ts` so the orchestrator only imports from `arena/layout.ts`. Pure, no DOM, no Canvas.
- `src/screens/combat/arena/view.ts` — `buildPlatoonStrip(opts)`, `detailRow(label, value)`, `PlatoonStripDetail` interface. DOM construction only. Includes the G1 delegated `mouseover/mouseout` listeners bound to the list containers (currently inlined in `manualBattleArena.ts`'s `renderRails()`).
- `src/screens/combat/arena/input.ts` — Click hit-testing (`pixelToAxial` + `hexDistance`), hover state (delegated), `pendingTarget`/`approachHexes`/`approachChoice` accessors. Pure functions that take the current state + a callback for "what to do on click"; no direct mutation of game state (delegates to caller).
- `src/screens/combat/arena/leaveBehind.ts` — `LeaveBehindKey` type, `leaveBehindKey()`, `applyLeaveBehind()`, `openLeaveBehindDialog()`. The 222-line surrender-gold popup, lifted verbatim.

**Modified files:**

- `src/screens/combat/manualBattleArena.ts` — at the top of the file, add `import { HEX_SIZE_MAX, … } from "./arena/constants"` etc., replace the inline definitions with imports. **No behavior change in this PR** — the file still works, it's just importing from the new modules instead of defining inline.
- `src/screens/combat/arena/index.ts` (NEW) — `export * from "./openManualBattleArena"` (which we'll add in CB-4); for CB-1, just an empty barrel.

**Test changes:**

- `test/screens/combat/arena.test.ts` (NEW, lands in CB-1's PR) — module-level tests:
  - `layout.test.ts` cases: `fitHexSize` for various avail boxes (1280×720, 1920×1080, 900×600), `gridExtent` against a known `BattleGrid`.
  - `view.test.ts` cases: `buildPlatoonStrip` with a known `Combatant` + `UnitType` produces the expected DOM structure (using `jsdom` or a minimal DOM mock — check what's already in use; the project uses Playwright for browser tests, may need to add `jsdom` as a dev dep).
  - `input.test.ts` cases: click hit-testing for known canvas coordinates, hover delegation tracking.
  - `leaveBehind.test.ts` cases: `applyLeaveBehind` distributes gold correctly across known stacks, handles edge cases (zero cost, more stacks than slots).

### 6.2 CB-2 — Extract `arena/state.ts` + `arena/ai.ts`

**New files:**

- `src/screens/combat/arena/state.ts` — `ManualBattleStateMirror` interface (the mutable copy of `ManualBattleState` the arena keeps), `createStateMirror()`, mutators: `attackWithSelected(state, targetSlot)`, `moveSelected(state, hex)`, `retreat(state)`, `surrender(state)`, `endTurn(state)`. Each mutator calls the appropriate engine function from `packages/engine/src/combat/manualBattle.ts` and returns the new state. For actions that need to persist server-side (anything that mutates `GameState`, not just the local battle mirror), calls `handleCommand` from `src/io/commands.ts` (per the Phase 5.A pattern). The mirror is the only mutable arena state; everything else reads from it via a `getState()` callback.
- `src/screens/combat/arena/ai.ts` — `advanceAi(state, deps)` stepped on timers: `AI_TELEGRAPH_MS = 320`, `AI_STEP_MS = 260`. Owns the `aiActing` flag, `aiActingSlot`/`aiTargetHex` for the telegraph ring. `cancelAiTimers()` called from `closeArena()` so timers can't fire against a detached overlay. Pure functions that read state and return timer-scheduled callbacks; timer lifecycle owned here, not in `state.ts` or `view.ts`.

**Modified files:**

- `src/screens/combat/manualBattleArena.ts` — replace the inline `applyMove()`, `applyAttack()`, `applyRetreat()`, `applySurrender()`, `applyEndTurn()`, and `advanceAi()` with imports from `arena/state.ts` and `arena/ai.ts`. Replace the inline AI timer setup with `arena/ai.ts`'s exported setup. **Behavior-preserving** — same G1 pacing, same cancellation on `closeArena()`.

**No test changes in CB-2 itself** — the smoke test (`test/smoke.ts`) exercises the full flow, and CB-1's `arena.test.ts` already covers the seams. CB-2 is pure mechanical extraction.

### 6.3 CB-4 — Add `arena/paint.ts` (SceneNode wiring behind a flag)

**New files:**

- `src/screens/combat/arena/paint.ts` — `paintSceneForArena(args)` + `buildArenaPaint2dDeps(opts)` + `readUseSceneBuilder(search)`. Calls `buildBattleScene(input)` from `src/render/scene/sceneBuilder/battleScene.ts` to get `SceneNode[]`, then `paintScene(ctx, nodes, deps, frame)` from `src/render/scene/paint2d/index.ts`. Constructs a minimal `Paint2DDep` for battle (no resource/parallax/charter bits, plus `battleAccent` from the arena's ATTACKER_ACCENT/DEFENDER_ACCENT). For the bits that aren't yet supported by `paint2d/` per-kind transcription (5.B P1 #5), the orchestrator passes `drawFallback: drawLegacy` and `paintSceneForArena` calls it after `paintScene()` so the visual stays byte-identical to pre-CB-4 today.

**Modified files:**

- `src/screens/combat/arena/openManualBattleArena.ts` — at the top of the orchestrator, read `useSceneBuilder = readUseSceneBuilder(window.location.search)` (default false, opt-in via `?paint=scenebuilder` per §9.4). Rename the existing inline `draw()` body to `drawLegacy()`; add a new `draw()` that branches: `useSceneBuilder ? paintSceneForArena({..., drawFallback: drawLegacy}) : drawLegacy()`. Default false in production — flipping the default waits on `paint2d/` per-kind transcription.

**Test changes:**

- `test/screens/combat/arena.test.ts` — append a `paint tests` describe block. Covers: `readUseSceneBuilder` for missing/empty/wrong-value/scenebuilder search strings; `buildArenaPaint2dDeps` returns a well-formed `Paint2DDep` with correct `battleAccent` and inert defaults; `paintSceneForArena` invokes `drawFallback` exactly once after `paintScene()`, and handles an active `moveAnim` without throwing. Uses hand-rolled `Proxy`-based mocks for `CanvasRenderingContext2D` (no jsdom; matches the CB-1/CB-5 pattern).

### 6.4 CB-3 — `manualBattleArena.ts` shrinks to orchestrator

**Modified files:**

- `src/screens/combat/arena/openManualBattleArena.ts` (NEW) — the actual orchestrator, lifted out of `manualBattleArena.ts`. Wires `layout` + `state` + `ai` + `input` + `view` + (`draw` or `paint`) together. Returns `ManualBattleController` (same shape callers already use).
- `src/screens/combat/arena/index.ts` — `export { openManualBattleArena } from "./openManualBattleArena"`.
- `src/screens/combat/manualBattleArena.ts` — shrinks to:
  ```
  // Compatibility shim — see src/screens/combat/arena/openManualBattleArena.ts
  // for the real implementation. This file exists so the old import path keeps working.
  export { openManualBattleArena } from "./arena/openManualBattleArena";
  export type { ManualBattleArenaOptions, ManualBattleController } from "./arena/openManualBattleArena";
  ```

**No test changes in CB-4 itself** — smoke test continues to exercise the same entry point.

### 6.5 CB-5 — `test/screens/combat/arena.test.ts`

(See §6.1 — actually lands in CB-1's PR, called out here for tracking.)

---

## 7. Module count

**New files: 11**

- `src/screens/combat/arena/index.ts`
- `src/screens/combat/arena/openManualBattleArena.ts`
- `src/screens/combat/arena/constants.ts`
- `src/screens/combat/arena/layout.ts`
- `src/screens/combat/arena/draw.ts`
- `src/screens/combat/arena/paint.ts`
- `src/screens/combat/arena/input.ts`
- `src/screens/combat/arena/state.ts`
- `src/screens/combat/arena/ai.ts`
- `src/screens/combat/arena/view.ts`
- `src/screens/combat/arena/leaveBehind.ts`
- `test/screens/combat/arena.test.ts` (single file with describe-blocks per module — 12th file)

**Modified files: 1** (or 2 if `package.json` needs `jsdom` added for the DOM-mock tests)

**Files I deliberately do not touch:**
- `packages/engine/src/combat/*` — already broken out, fully tested.
- `src/screens/combat/{battleModal,battleResultCard,platoonInfoPopup,testBattleSetup}.ts` — already focused.
- `src/render/scene/sceneBuilder/battleScene.ts` — already exists, output not consumed yet (CB-3 fixes that).
- `src/state/turnController.ts` — out of scope; that's the entry-point wiring for the manual arena from real gameplay collisions, a separate gap.

**Net file count:** +11 to +12 source/test files, -1900 lines from the monolith (which becomes a 5-line compatibility shim).

---

## 8. Validation gates (every PR)

1. `npm run build` (tsc strict + vite build; Phase 3+ type-checks `server/`)
2. `npm run lint:deps` (zero `dependency-cruiser.cjs` boundary violations)
3. `npm run validate-assets` (sprite descriptors resolved)
4. `npm run test:all` (smoke + multiplayer.smoke + cityView + domain unit tests)

**Additional CB-3 gate:** pixel-snapshot diff vs. `draw()` output for at least one canonical state (per the verification doc's canvas pixel-sampling approach). CB-3 lands behind a flag, so visual changes are gated by the flag flip in a separate commit (not in CB-3 itself).

**Additional gate for `lint:deps`:** the new dependency-cruiser rules `arena-cannot-import-server` and `arena-cannot-import-game-actions` (or the equivalent boundaries inferred from §4.1's "must not import" column). Mirror the paint2d/ pattern from `2026-08-15_OVERVIEW.md`'s seam test.

---

## 9. Risks & decisions

### 9.1 Risk: behavior drift during extraction

Each PR is mechanical extraction with "no behavior change in this PR" as the rule. **Decision: enforce by comparing `npm run test:all` output byte-for-byte before and after each PR.** If a test fails or a screenshot diff shows a pixel change, the PR is wrong, not the test.

### 9.2 Risk: cycle between `view.ts` ↔ `state.ts`

The orchestrator owns both. `view.ts` reads state via a `getState()` callback; `state.ts` mutates and returns new state. The orchestrator wires them together. The dependency direction in §4.2 makes this impossible at import time, but the runtime data flow (view → state via click handler → view re-renders) is owned by the orchestrator.

### 9.3 Risk: `paint2d/` per-kind transcription blocks CB-4

CB-4 cannot land with full byte-equivalence until 5.B P1 #5 (paint2d per-kind Canvas transcription) is done. **Decision:** land CB-4 with `paint2d/`'s current dispatcher-shell stub (28 no-op painters, of which the 8 battle-kind ones are the relevant subset) wrapped in a fallback that calls `drawLegacy()` after `paintScene()` runs. This gives us a working `paintSceneForArena` that exercises the `SceneNode[]` pipeline end-to-end, while keeping the visual identical. The flag stays off in production until paint2d/ transcription is complete — at which point `drawFallback` is dropped per-kind as each per-kind painter lands.

### 9.4 Decision: which `useSceneBuilder` flag mechanism

Three options: (a) URL query param `?paint=scenebuilder`, (b) localStorage flag, (c) Kilo dev-console toggle. Default for CB-4: query param (easiest to test, easy to script, easy to disable). Promote to dev-console toggle in a follow-up if it stays useful past CB-4.

### 9.5 Risk: smoke test depends on details of the orchestrator

`test/smoke.ts` reaches `openManualBattleArena` indirectly via the Test Battle button. The orchestrator's `ManualBattleController` return shape must stay identical or the smoke test breaks. **Decision: lock the `ManualBattleController` interface with a structural test** — `arena.test.ts` includes a test that constructs a minimal `ManualBattleController` and asserts the public method names + their signatures.

---

## 10. Out of scope (tracked elsewhere)

This plan **does not** address:

| Gap | Where tracked | Why out |
|---|---|---|
| Hero-collision → manual arena entry point (README's "in progress") | New plan TBD | Different files (`src/state/turnController.ts` + `src/managers/GameActions.ts`); different risk surface (UI trigger vs. UI structure). |
| G2 hover feedback on grid | `plan/2026-08-11-fight-screen-redesign.md` §"Gaps" G2 | UX feature, not a decomp item. **✅ Closed 2026-08-18** — hex under-cursor highlight added in `arena/openManualBattleArena.ts` (`hoveredHex: Axial \| null`, updated via `pixelToAxial` on `mousemove`, cleared on `mouseleave`, drawn in `draw()` as a 12% cyan fill + outline). Outcome preview half still open per fight-screen-redesign.md Decision #7. |
| G3 enemy threat range | fight-screen-redesign.md G3 | Engine-side already works (`getMovementRange`); UI surfacing is a feature, not a decomp. |
| G4 outcome preview + bump-attack confirm | fight-screen-redesign.md G4 | Decision (#8 in that doc) still open. UI feature. |
| G5 deployment phase | fight-screen-redesign.md G5 | Gameplay change, not decomp. |
| G6 keyboard support | fight-screen-redesign.md G6 | UX feature. |
| G7 keep battlefield behind result card | fight-screen-redesign.md G7 | UX fix. Trivial once the orchestrator is decomposed. **✅ Closed 2026-08-18** — `finishBattle()` reordered in `arena/openManualBattleArena.ts`; it now cancels AI timers/animations, clears input state, refreshes, and only then opens the result card with `onCarryOn: () => { closeArena(); }`. The modal's 60% backdrop dims the arena instead of hiding it. |
| G8 obstacles/terrain rendering | fight-screen-redesign.md G8 | Render work — would slot into `arena/paint.ts` once CB-3 lands. |
| Stage 3 small-viewport pan | fight-screen-redesign.md Stage 3 | Layout feature; `arena/layout.ts` is the home. |
| Stage 4 stale doc references | fight-screen-redesign.md Stage 4 | Doc fixes only. |
| Fog-of-war revival | `plan/2026-08-15-combat-reveal-fog-of-war.md` | Parked explicitly; needs a real design pass before code. |
| Square-vs-wide grid (Stage 2 follow-on) | fight-screen-redesign.md "Decisions" #2 | Gameplay change. |

---

## 11. Cross-plan references

- `plan/2026-08-17-consolidated-phase-1-5-track-map.md` §7.2 (this row is ⬜ not started; this plan delivers it).
- `plan/2026-08-11-srp-module-reorganization.fable.md` §1 (the diagnosis table's lead row).
- `plan/2026-08-11-fight-screen-redesign.md` (the fight-screen UX backlog that this plan leaves to follow-ups; the G7 fix becomes trivial once the orchestrator is decomposed).
- `plan/2026-08-15-combat-reveal-fog-of-war.md` (fog-of-war parked; not addressed by this plan).
- `packages/engine/src/combat/index.ts` (the barrel these new client modules import from).
- `src/render/scene/sceneBuilder/battleScene.ts` (the pure decomposition this plan's CB-3 finally consumes).
- `src/render/scene/paint2d/README.md` (the Vite-`?url` boundary rules CB-3 must respect; mirror the `paint2d-cannot-import-asset-descriptors` rule for `arena/paint.ts`).

---

## 12. Open questions (resolved before CB-1 merges)

1. **§9.5 decision: lock `ManualBattleController` with a structural test?** Default: yes, included in `arena.test.ts`. Confirm.
2. **§9.4 decision: `useSceneBuilder` flag mechanism.** Default: URL query param. Confirm.
3. **§6.1 test framework: `jsdom` for DOM-mock tests?** Check if `jsdom` is already a transitive dep (it's used by Playwright's tooling); if not, add it as a dev dep. Confirm.
4. **Does CB-4 ship before paint2d/ per-kind transcription is done?** Default: yes, behind a flag, with `drawLegacy()` fallback for unsupported kinds. The flag flips later as a separate commit when paint2d/ catches up. Confirm.
5. **Should CB-4 happen at all, or should `manualBattleArena.ts` be deleted?** Default: keep the 5-line shim so the old import path keeps working — fewer call-site changes. Confirm.