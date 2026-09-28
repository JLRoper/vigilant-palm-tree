# Plan: Fight screen redesign — battlefield-first tactical layout

**Source request:** rethink the manual fight arena's design around how we want the
gameplay to feel. Agreed direction: **tactical centerpiece** (the grid is the payoff,
positioning matters), **battlefield-first** (rosters collapse to strips, detail on
demand), scoped to **layout/UX only** — no combat-engine changes.

**Status:** Stage 1 shipped. Stage 2 (straighten the grid) and G1 (visible AI) approved
and implemented, along with defects D1–D3. G2 (hex under-cursor highlight) and G7
(keep the battlefield alive behind the result card) implemented post-decomp in
`src/screens/combat/arena/openManualBattleArena.ts` — see the gap notes below. Stage
3 (small viewports) and Stage 4 (docs) still open, as are gaps G3, G4, G5, G6, G8.

**Branch:** `claude/fight-screen-design-532553` — committed as `667f463`, open as
[PR #19](https://github.com/Millerfly91/vigilant-palm-tree/pull/19).

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

## Review findings (2026-08-12) — D1–D3 ✅ done; G1 ✅ done; G2, G7 ✅ done; G3–G6, G8 ⬜ open

Code-level audit of what Stage 1 shipped. The browser tooling was unavailable for this
pass, so these are read from source, not observed live — the three defects are reasoned
from the code and should be reproduced before fixing.

### Defects introduced by Stage 1

**D1 — The info card goes stale on reflow.** `relayoutCanvas()` recomputes `hexSize`,
`offsetX`, `offsetY` and calls `draw()`, but never repositions an open info card. The
card's `anchorX`/`anchorY` were computed from the *previous* geometry, so after any
reflow it points at the wrong hex. Easy to hit: open a card, then expand the battle log —
that reflows the canvas (confirmed in Stage 1 testing: 846×523 → 770×477). Fix: call
`restoreInfoPopup()` at the end of `relayoutCanvas()`.

**D2 — Hover can strand the card.** `renderRails()` calls `list.replaceChildren(...)` on
every `refresh()`, destroying the strip the pointer is over. A destroyed element never
fires `mouseleave`, so the card can keep showing a platoon you are no longer pointing at
— for example when a refresh lands mid-hover as the AI resolves. Fix: track the hovered
slot and reconcile after the rebuild, or attach the listeners once to the list and use
event delegation.

**D3 — `canAct` means two different things.** `renderRails()` passes
`actableSlots.includes(...)` for your rail but `isAlive(c)` for the enemy's, so the same
`buildPlatoonStrip` parameter means "has an action left" on one side and "is alive" on the
other. The visible consequence is that enemy strips never dim. Harmless today, misleading
to the next reader. Fix: split into `dimmed` and let each caller decide.

**All three fixed.** D1 by calling `restoreInfoPopup()` at the end of `relayoutCanvas()`;
D2 by moving hover onto delegated `mouseover`/`mouseout` listeners bound once to the
persistent list containers instead of per-strip `mouseenter`/`mouseleave`; D3 by renaming
the parameter to `dimmed` and letting each rail decide what it means.

### Gaps not covered anywhere in this plan

Ordered by how much they cost the "tactical centerpiece" goal.

**G1 — The AI is invisible.** ✅ **Fixed.** `advanceAi()` used to resolve AI turns
*synchronously*: one AI platoon after each of your actions, then a `while` loop that burned
the rest of its round once you had no platoons left — no timers, no animation, one repaint
at the end. You never saw the AI move; the board teleported between your clicks.

Now stepped on a timer in two beats per platoon: mark the platoon that is about to act and
repaint (`AI_TELEGRAPH_MS`, 320ms, drawn as a white ring around the token), then resolve
and repaint (`AI_STEP_MS`, 260ms, before the next platoon). An `aiActing` flag locks player
input for the duration — `handleClick` ignores clicks, rail strips stop being selectable,
and End Turn / Spy / Retreat / Surrender hide. The gold "still to act" outline is
suppressed while the AI moves so the only thing lit is the platoon actually moving, and the
turn chip reads "AI's Turn" even when you still hold unacted platoons. `closeArena()`
cancels any pending beat so a timer can't fire against a detached overlay.

**G2 — No hover feedback on the grid.** ✅ **Fixed (post-decomp).** The canvas now
tracks a `hoveredHex: Axial | null` alongside the existing `selectedSlot`/`hoveredSlot`
selection state. `mousemove` updates it via `pixelToAxial`, `mouseleave` clears it,
and `draw()` paints a subtle cyan outline (`rgba(180,220,255,0.85)`) + 12% fill
(`rgba(180,220,255,0.12)`) on the hex under the cursor. The highlight is suppressed
while `ai.isActing()`, when `isBattleOver(state)`, and on impassable hexes — so it
never gives input feedback during animations the player can't act on, or on terrain
they can't enter. Distinct from `input.ts`'s `pendingTarget`/`approachChoice`, which
only track directional melee targeting and were never meant to be a general pointer
indicator. Outcome preview (the "this is who you'd hit" half of G2) deliberately not
bundled with the highlight — see Decision #7 below and G4 for that scope.

**G3 — No enemy threat range.** Knowing where the enemy can reach next round is core to
tactical positioning. `getMovementRange(state, combatant)` is already engine-side and
works for any combatant regardless of side; nothing in the UI surfaces it for enemies.

**G4 — No outcome preview before committing.** `estimateWinChance` exists but only
appears on an enemy's card, and only while one of your platoons is selected. There is no
"this attack costs you ~N" before you click. Worse, a move that lands adjacent to an enemy
triggers `refreshAfterMove()`'s bump-attack, which resolves the fight **immediately with
no confirmation** — a misclick on a move hex can spend a platoon's turn on an attack you
didn't intend.

**G5 — No deployment phase.** `deploymentPosition()` is fixed: outer column, rows 0,2,4…
In HoMM3 much of the tactical decision lives in arranging the army before the first round.
This is a gameplay change, not layout.

**G6 — No keyboard support.** No Escape, no cycling platoons, no key to end a turn. The
arena is mouse-only.

**G7 — The result card destroys the battlefield first.** ✅ **Fixed (post-decomp).**
`finishBattle()` no longer calls `closeArena()` before `showBattleResultCard()`. The
new order is: bump the AI run token and clear its timer, cancel clearable animations
(`clearAnimations()`), clear input state (`selectedSlot = null`, empty `moveRange`/
`attackTargets`, `input.clearPendingAttack()`, hide the info popup), call `refresh()`
to repaint the final board, then open the result card with
`onCarryOn: () => { closeArena(); }`. The modal's 60% black backdrop dims the arena
without hiding it, so the player can review the final board position and the battle
log underneath the card before pressing Carry On.

**G8 — Obstacles and terrain are undrawn.** Obstacles are flat `#3a2a2a` hexes; Terrain is
a `—` placeholder in the info card. This is the visual difference between "a battlefield"
and "a diagram", and was explicitly out of scope for Stage 1.

### Which of these are still "layout/UX only"

G1, G2, G4 (the preview half), G6, G7 and the three defects sit inside the original scope.
G3, G4 (the bump-attack confirm), G5 and G8 change gameplay or engine behaviour and need
the same sign-off as Stage 2.

---

## Stage 2 — Straighten the battlefield ✅ approved & implemented

The field was a skewed parallelogram wasting a large slice of the canvas.

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

### As built — verified

`rowShift(r) = ⌊r/2⌋` and an exported `columnOf(hex)` were added to `grid.ts`;
`makeBattleGrid` now iterates rows-then-columns emitting `q = col − rowShift(r)`, the
obstacle filter keys on `columnOf`, and `deploymentPosition` converts its column to axial
the same way. No other file changed — the arena picks the new geometry up automatically,
because `fitHexSize` solves against the real grid extent.

Measured against a freshly built 15×15 grid:

| Check | Result |
|---|---|
| Cell count | 225 (unchanged) |
| `spanX` | **25.115** units (was 36.373; predicted 25.115) |
| `spanY` | 21.000 units (unchanged) |
| Distinct row widths | **one** — 24.249 (i.e. a true rectangle) |
| Row left edges | alternating `0, 0.866, 0, 0.866…` (brick offset) |
| Hex size @1280×720 | **24** (was 21) |
| Hex size @1920×1080 | **39** (was 37) |
| Deployment cells landing off-grid | none, across all 8 slots × 2 sides |
| Obstacle columns | 2–10, inside the required 1–13 |

`test/combat/manualBattle.test.ts` (10/10) and `test/combat/resolveBattle.test.ts` (10/10)
pass unchanged — their position assertions all sit on row 0, where the offset conversion
is the identity. `npm run build` and `npm run test:all` clean.

**Still open from this stage:** the square-vs-wide question below.

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

## Stage 4 — Docs ⬜ not started

Stage 1 is committed (`667f463`) and open as PR #19; the doc updates below were **not**
included and are still outstanding.

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

Resolved: **#1 straighten the grid — yes** (done); **#6 make the AI visible — yes** (done);
**#5 D1–D3 — fixed alongside**, since stepping the AI on a timer makes D1 and D2 far easier
to trigger; **#7 hover feedback — hover only** — G2 landed as a hex-under-cursor
highlight on the canvas (post-decomp, in `openManualBattleArena.ts`); the outcome
preview half (G4) deliberately stays out of this scope; **#9 keep the battlefield
alive behind the result card — yes** — G7 landed as a `finishBattle()` reorder so the
result modal dims the arena via its 60% backdrop instead of destroying it first
(`closeArena()` now runs from the card's Carry On button).

Still open:

| # | Question | Options |
|---|---|---|
| 2 | Square or wide field? | Keep 15×15 square / go wide (needs a deployment-rule change first) |
| 3 | Small-viewport behaviour (Stage 3)? | Pan below the floor / 1280 is the hard floor / lower the floor |
| 4 | Verify the gold outline + AI telegraph visually? | Needs a session with working browser tooling |
| 8 | Confirm before an unintended bump-attack (G4)? | Yes / no — keep the fast path |
| 10 | Deployment phase (G5) and enemy threat range (G3)? | Later stage / not wanted |

Also worth revisiting now that the grid is straightened: **AI pacing**. `AI_TELEGRAPH_MS`
(320ms) and `AI_STEP_MS` (260ms) are first guesses. With 8 platoons a full AI round is
roughly 4-5 seconds, which may be too slow once the novelty wears off — a speed control, or
skipping the telegraph for platoons that only move, are both cheap adjustments.

### Suggested order for what remains

1. **Visual confirmation** of the AI telegraph and gold outline (blocked on tooling).
2. **G2/G4** (hover + outcome preview) — makes positioning legible.
3. **Stage 3** (small viewports) — much less pressing now that the grid needs ~31% less width.
4. **Stage 4** (docs).
5. **G5/G3/G8** — larger gameplay/art work, separate planning.
