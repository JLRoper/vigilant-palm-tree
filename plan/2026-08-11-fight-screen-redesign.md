# Plan: Fight screen redesign — battlefield-first tactical layout

**Source request:** rethink the manual fight arena's design around how we want the
gameplay to feel. Agreed direction: **tactical centerpiece** (the grid is the payoff,
positioning matters), **battlefield-first** (rosters collapse to strips, detail on
demand), scoped to **layout/UX only** — no combat-engine changes.

**Status:** Stage 1 implemented and verified in the running app. Stages 2–4 not started.
Stage 2 is the open design question (grid geometry) and needs a decision before work.

**Branch:** `claude/fight-screen-design-532553` — nothing committed yet.

---

## Why this started (measured, before any change)

At 1280×720, in the arena reached from Developer Settings → Test Battle:

| Measurement | Value |
|---|---|
| Viewport | 1280×720 |
| Battlefield canvas, on screen | **368×225** |
| Canvas bitmap | 1344×822 |
| Effective scale | **27%** (~12px hexes) |
| Fixed-width chrome (2 rosters + side panel) | **840px** |
| Side panel (`renderSidePanel`) | 200px wide, **0px tall — permanently empty** |
| Left roster column height vs container | 659px in a 605px box (clipped) |

The battlefield — the thing you actually play on — got 28% of the width and rendered at
just over a quarter scale. At 1920×1080 it was survivable (76% scale), so the design
silently assumed a large monitor.

### Contributing design problems

1. **Inverted information density.** Sixteen always-on stat tiles
   (Atk/Def/Spd/Rng/Terrain/HP/Morale/Fatigue) dominated, while grid tokens were plain
   coloured circles with a number.
2. **Much of it was placeholder.** Terrain always `—`, Morale always 100, Fatigue always
   0, Cast Spell permanently disabled — roughly 40% of each tile.
3. **The battle log was invisible.** `shared/combat/manualBattle.ts` produces a full
   replayable `state.log`; the UI forwarded it to `console.log` and showed the player
   nothing.
4. **The canvas never reflowed.** Fixed bitmap, scale-down only — a narrow window shrank
   hexes instead of tightening the grid.

The engine underneath was in much better shape than the screen: BFS movement budgets,
line-of-sight, ranged vs melee, counterattack chains, type advantage, scouting/fog. The
UI simply wasn't showing it.

---

## Stage 1 — Battlefield-first layout ✅ implemented & verified

Files: `src/views/manualBattleArena.ts`, `src/views/platoonInfoPopup.ts`.
No engine files touched.

**Structure.** Three stacked bands replace the old four-column row:

```
┌─────────────────────────────────────────────────────────┐
│ Test Battle · You: Blue   Round 3/30 · ☀ Day · Your Turn · ⚙ │  40px
├────────┬───────────────────────────────────┬────────────┤
│ You    │                                   │ AI Opponent│
│ ▸ P1   │          BATTLEFIELD              │ ▸ P1  ?    │
│ ▸ P2   │          (flex, reflows)          │ ▸ P2  ?    │
│ …      │                                   │ …          │
│ Retreat│                                   │            │
│ Surrend│                                   │            │
├────────┴───────────────────────────────────┴────────────┤
│ help text                        [Spy] [End Turn]       │
│ ▸ Log   R2 · Enemy P3 → You P2 · 24 dmg · 4 lost        │
└─────────────────────────────────────────────────────────┘
```

- Roster rails **190px** (was 320px); one ~33px strip per platoon (specialty icon, `P1`,
  count, HP bar). Spent platoons dim; unscouted enemies show `?P1×?` with a hatched bar.
- Full stats moved into the hover/click info card (`platoonInfoPopup.ts` gained optional
  `specialty` / `stats[]` / `metrics[]`).
- The empty 200px side panel and the floating translucent header are **deleted**.
- The grid **reflows**: hex size is solved for the available box
  (`fitHexSize`), rendered 1:1 with a device-pixel backing store.
- Battle log surfaced — collapsed to one line (20px), expandable to 128px, coloured by
  side.
- Per request, **no turn-order/progress readout**. Unacted platoons instead get a gold
  hex outline on the grid, since every platoon has to move each round anyway.

**Results:**

| Viewport | Battlefield before | after | Share of width |
|---|---|---|---|
| 1280×720 | 368×225 (~12px hexes) | **846×523** (~21px hexes) | 29% → **66%** |
| 1920×1080 | 1018×623 | **1460×891** (~37px hexes) | 53% → **76%** |

**Verified live:** hit-testing exact after the coordinate change (token centroid →
hex `(0,0)` → deselect; one hex right → `move attacker#0: (0,0) -> (1,0) (1 hex),
movement left: 12`); fog gating correct; hover card renders full stats; log populates
(`R2 · Enemy P3 → You P2 · 24 dmg · 4 lost (advantage)`); expanding the log reflows the
canvas to 770×477; a full battle ran to completion into the result card.
`tsc --noEmit` clean with `noUnusedLocals`, `npm run build` clean.

**Not yet visually confirmed:** the gold unacted-platoon outline. Implemented in
`draw()` and running, but screenshots were unavailable this session (Browser pane not
displayed). Verifiable by sampling the canvas for that colour.

---

## Stage 2 — Straighten the battlefield ⬜ decision needed

**This is the open question.** The field is a skewed parallelogram, and it wastes a lot
of space.

### Root cause

`makeBattleGrid` (`shared/combat/grid.ts:20-24`) emits a rectangular *axial* range:

```ts
for (let q = 0; q < cols; q++)
  for (let r = 0; r < rows; r++)
    hexes.push({ q, r, impassable: false });
```

Under the pointy-top mapping in `src/core/hex.ts:8`
(`x = size · (√3·q + √3/2·r)`), the `√3/2·r` term slides **every row half a hex right of
the one above**. A rectangular `(q,r)` range therefore renders as a rhombus, not a
rectangle. The grid is 15×15 (`DEFAULT_GRID_COLS` / `DEFAULT_GRID_ROWS`).

### Measured cost

| Measurement | Value |
|---|---|
| Canvas bitmap at 1280×720 | 1298×806 |
| Pixels that are background, not grid | **44%** |
| Pixels that are grid | 56% |

Geometrically, the horizontal span is inflated by the skew:

- **Now:** `spanX = √3 · (cols−1 + (rows−1)/2) = √3 × 21 = 36.37` hex-size units
- **Straightened:** `spanX = √3 · (cols−1 + 0.5) = √3 × 14.5 = 25.12` units
- `spanY = 1.5 × (rows−1) = 21` units either way

So the skew costs **~45% extra width** for zero extra playable hexes, and the surplus is
two large empty triangles.

### Proposed fix

Generate the grid in **odd-r offset** coordinates converted to axial — `q = col − ⌊r/2⌋`
— which cancels the `r/2` term and renders a true rectangle.

Crucially this changes only *which cells exist*, not the coordinate system:
`hexDistance`, the six axial neighbours, `movementCosts` BFS, `hasLineOfSight`, and
`occupiedHexes` all keep working unchanged, because they are axial-generic.

Two call sites need updating alongside it:

1. `deploymentPosition` (`grid.ts:60-69`) — the outer columns are no longer `q = 0` and
   `q = cols−1`; they become `q = −⌊r/2⌋` and `q = cols−1−⌊r/2⌋`.
2. The obstacle-candidate filter (`grid.ts:34`, `h.q > 0 && h.q < cols - 1`) — must
   filter on *column*, i.e. `col = h.q + ⌊h.r/2⌋`, not raw `q`.

Plus whatever position assertions exist in `test/combat/`.

### Projected result

Hex size solves as `min((W−40)/(spanX+2), (H−40)/(spanY+2))`, clamped to 14–44:

| Viewport | Battlefield box | Hex size now | Hex size straightened |
|---|---|---|---|
| 1280×720 | 852×595 | 21 (width-bound) | **24** (height-bound) |
| 1920×1080 | 1492×954 | 37 (width-bound) | **39** (height-bound) |

Note what changes qualitatively: straightening flips the grid from **width-bound to
height-bound**. The empty corners vanish and hexes grow, but the field becomes roughly
square (15 cols × 15 rows ≈ 25.1 × 21 units) and leaves ~160px of horizontal slack at
1280.

### Follow-on question: should the field be wide rather than square?

`DEFAULT_GRID_ROWS` was raised 11 → 15 purely to fit deployment: 8 `ARMY_STACK_SLOTS`
platoons spaced 2 rows apart need rows 0,2,…,14 (see the comment at
`combatConfig.ts:39-43`). HoMM3's field is 15×11 — wide, not square — which suits
widescreen far better.

If a wide field is wanted, the deployment rule has to change first, e.g. two staggered
back columns of 4 platoons each, which would free rows to drop back to 11. **That is a
gameplay change, not a layout change** — flagged here as a decision, not proposed work.

### Scope note

Stage 2 edits `shared/combat/grid.ts`, which is **outside the "layout/UX only" scope**
originally agreed. It needs explicit sign-off before implementation. It is, however,
contained: two functions, plus test updates.

---

## Stage 3 — Small-viewport behaviour ⬜ not started

At **900×600** the hex size hits its `HEX_SIZE_MIN` floor (14) and the canvas overflows
its box by ~106px, overlapping the rails:

| Viewport | Battlefield box | Canvas | Fits |
|---|---|---|---|
| 1920×1080 | 1492×954 | 1460×891 | yes |
| 1366×768 | 938×536 | 846×523 | yes |
| 1280×720 | 852×595 | 846×523 | yes |
| 900×600 | 472×367 | 578×362 | **no** |

The old code called 1280px "the narrowest supported viewport", so 900 is below spec — but
overlapping reads as broken rather than as a graceful floor.

**Proposed:** let the battlefield pan instead of overflow (`overflow: auto`, with
`margin: auto` on the canvas wrapper so centering still works when it fits and both edges
stay reachable when it doesn't). Below the floor you scroll rather than squint.

This requires first reparenting the info card from `canvasWrap` to `overlay`, because
`overflow: auto` would otherwise clip it. That also simplifies the card's current
`minX: margin - wrapRect.left` arithmetic into plain viewport bounds.

**Alternatives:** accept 1280 as the hard floor and do nothing; or lower `HEX_SIZE_MIN`
and accept smaller hexes.

Note Stage 2 reduces the pressure here considerably — a straightened grid needs ~45% less
width, so the floor engages at a much narrower viewport.

---

## Stage 4 — Docs & commit ⬜ not started

Stale references created by Stage 1:

- `docs/CombatResolutionEngine-TechnicalDesign.md` §9 — "**No UI for any of this**" is no
  longer true of the log; the arena now renders it.
- `docs/morale-fatigue-plan.md` — cites `manualBattleArena.ts:221-227` for the hard-coded
  Morale/Fatigue bars. Those moved into `metricsFor()` and the info card. Step 7 of that
  plan ("UI wiring") now points at the wrong place.
- `docs/army.md` — describes the arena as the in-progress tactical target; worth a note
  that the screen has been reworked.

Commit gate: `AGENTS.md` mandates `precommit-checker` / `session-tracker` / `doc-updater`
subagents. **Those agent types are not available in this environment** — `npm run build`
and `tsc --noEmit` were run directly instead. Worth resolving before relying on that gate.

---

## Decisions needed

| # | Question | Options |
|---|---|---|
| 1 | Straighten the grid (Stage 2)? | Yes — accept the `shared/combat/grid.ts` change / No — keep the rhombus |
| 2 | If yes: square or wide field? | Keep 15×15 square / Go wide (needs a deployment-rule change first) |
| 3 | Small-viewport behaviour (Stage 3)? | Pan below the floor / 1280 is the hard floor / lower the floor |
| 4 | Verify the gold unacted-platoon highlight now? | Yes (pixel-sample) / wait for a session with screenshots |
| 5 | Commit Stage 1 on its own, or bundle with Stage 2? | Separate commits / one change |
