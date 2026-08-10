# Battle Screen UI Overhaul

Target: `src/views/manualBattleArena.ts` (1696 lines), plus a new shared theme module.

## Context

The game is in development, not shipping. The manual battle arena is the real
battle screen, not a throwaway sandbox — it should be built as such.

Design width is **1920×1080**, behaving gracefully from ~1440 up through
ultrawide. Side rails stay fixed-width; the battlefield absorbs the extra space.

Morale / Fatigue / Terrain stay as visible placeholder slots. They are
deliberate skeleton for mechanics that don't exist yet, and the plan preserves
them rather than hiding them.

## Decisions taken

| Question | Decision |
| --- | --- |
| Art direction | Adopt the main menu's gold/navy/serif identity across the battle screen |
| Blank 200px right rail | Delete it; give the width to the battlefield |
| Map sizing | Let the battlefield scale **up** to fill available space, not just down |

---

## Stage 0 — Shared theme tokens

**Why first:** the gold/navy identity currently exists in three disconnected
places — four CSS vars in `index.html:8-15` that almost nothing reads, and
hardcoded inline literals in `homeView.ts:52` and `:607`. Meanwhile
`menuTheme` (`src/views/menu.ts:4`) is a generic dark-chrome theme
(`system-ui`, `#1a1a1a`, green primary) that the battle screen and ~10 other
views draw from. There is no single source of truth to restyle against.

**Build:** a new `src/views/theme.ts` exporting the real token set —
color ramp (navy grounds, gold accents, cream text), the serif display font
and the UI font, spacing, radii, elevation, and semantic roles
(`primary` / `neutral` / `destructive`).

Then rebuild `menuTheme` on top of those tokens, keeping its current exported
shape so existing consumers compile unchanged.

**Deliberate side effect, worth confirming before I start:** because
`menuTheme` backs `devConsole`, `heroRosterMenu`, `heroInfoMenu`,
`confirmDialog`, `buildingPlacer`, `buildingSelectionMenu`, `assetManager`,
`developerSettingsMenu` and `battleResultCard`, restyling it restyles all of
them at once. That is the cheapest possible fix for the app-wide
two-design-systems problem — and also the widest blast radius in this plan.

`index.html` vars and the `homeView` literals get pointed at the same tokens so
the duplication stops.

---

## Stage 1 — Bugs

Independent of the visual work; can land first and separately.

**1a. `Morale 10000`.** `makeMetricBar` (`:591`) documents `value` as a 0–1
ratio and computes its label as `Math.round(value * 100)`. The callers at
`:582-583` pass `100` and `0`. Fix the callers to pass `1` and `0`. Fatigue is
currently correct only by coincidence (`0 × 100 = 0`); both colour ramps read
correctly at the ratio values.

**1b. Map tokens don't identify their platoon.** `:1346` draws the platoon's
*unit count* inside each map circle, while every panel on screen is organised
by `Platoon 1–6`. There is no way to connect a token to its tile in either
direction. Draw the platoon number as the token's primary label and move unit
count to a secondary position (small badge, or into the existing HP bar row).

**1c. Selection popup covers your own platoon tiles.** `behindSide()`
(`:1249`) correctly keeps the popup out of the ground between the armies, but
for the left-hand army "behind the line" is exactly where your platoon rail
lives. Clamp the popup to the canvas bounds so it can never escape over a rail.

---

### Stage 1 as built

All three landed in `src/views/manualBattleArena.ts`. `tsc --noEmit` clean;
`test/combat/manualBattle.test.ts` 10/10.

- **1a** — callers now pass `1` / `0`. Label reads `Morale 100`. Note the label
  renders bare (`Morale 100`) next to HP's `100% HP`; leaving the unit
  mismatch alone for now, it belongs with the Stage 3 typography pass.
- **1b** — platoon number is the token's centred primary label; unit count
  moved to a badge on the upper-right shoulder. The badge sits inside the
  token's own footprint deliberately — stacking the count under the HP bar
  put it at `y+35`, which collides with the top edge of the token in the hex
  row below (`y+32`).
- **1c** — root cause was the *caller*, not the popup: `showInfoPopupFor` was
  passing whole-viewport bounds, so the card was free to land on the rails.
  Now bounded to the gap between `humanColumn` and `aiColumn` horizontally,
  and to `container` vertically.

### Stage 1d — Fog of war on the map tokens

Found while building 1b, and fixed on request.

The Enemy Platoons rail correctly gated composition behind `scoutedBy` and read
"Unscouted" for all six, but the map tokens rendered each enemy's exact unit
count and a live HP bar regardless — the counts on the grid matched the AI
roster from the setup dialog exactly, which made both the Spy action and the
whole `scoutedBy` system ineffective. Predates Stage 1 (the count was already
drawn at `:1349`; 1b only moved it into a badge).

`draw()` now applies the same `c.side === humanSide || c.scoutedBy.has(humanSide)`
predicate that `buildStatusTile` uses at `:453`:

- Platoon number still drawn for everyone — the rail already titles unscouted
  enemies "Platoon N", and the number is what ties a token to its tile.
- Count badge shows `?` instead of the number. Kept as a badge rather than
  omitted so the fog reads as missing information, not a half-drawn token.
- HP bar omitted entirely. A greyed or empty track would read as "0 HP"
  rather than "unknown".

**Verification gap worth knowing about:** the hiding is confirmed end-to-end —
enemy tokens show `?` with no bar while friendlies still show real counts and
bars. The *reveal* path is not visually confirmed: `getValidSpyTargets` only
offers enemies reachable this turn, and at round 1 the armies start far enough
apart that no platoon (including Cavalry at Spd 7) can reach one, so Spy never
lights up a target. The gate shares its predicate and its `scoutedBy` Set with
the rail, which is observably working, so there is no second code path to get
wrong — but it has not been watched flipping on screen.

## Stage 2 — Layout

**2a. Delete the dead rail.** `sidePanel` (`:1160`) reserves a fixed 200px but
`renderSidePanel` (`:1651`) only ever fills it with a single
"Waiting on the AI…" line, and it is empty on your own turn. It is also
subtracted from the battlefield's available width in `fitCanvasToContainer`
(`:1225`). Remove it and relocate the waiting message into the footer status
row, where the rest of the turn state already lives.

**2b. Let the battlefield scale up — properly.** `fitCanvasToContainer`
(`:1218`) caps scale at `Math.min(1, …)`, so the map can only ever shrink.

Removing the cap alone would CSS-upscale a fixed-size bitmap and soften every
hex, bar and label. Instead: size the canvas **backing buffer** to the target
display size (multiplied by `devicePixelRatio`) and apply the scale via
`ctx.setTransform` before drawing. Everything on the canvas is vector 2D work,
so it re-renders crisp at any size — and this fixes the existing blurriness on
HiDPI displays as a side effect.

`HEX_SIZE`-space hit-testing stays intact: the click handler at `:1643`
already maps screen coords back through `canvas.width / rect.width`, and the
draw transform keeps grid coordinates unchanged.

Retain a sane maximum so hexes don't become absurd on ultrawide, and keep the
existing `CANVAS_MIN_SCALE` floor for narrow viewports.

**2c. Reclaim the dead band under the map.** Both hero columns are pinned with
`alignSelf: "flex-start"` (`:1119`) — for a good documented reason (keeping the
two portraits level despite unequal column heights) — but the result at 1080p
is ~135px of empty space between the map and the footer while your platoon
list simultaneously scrolls and clips Platoons 5 and 6.

Keep the portraits top-aligned, but let each rail's platoon grid consume the
remaining column height instead of being capped at
`calc(100vh - 260px)` (`:1082`). At 1080p all six tiles then fit without
scrolling.

**2d. Fix the footer hierarchy.** Round / Your Turn / Dawn are currently
18px semibold boxes (`:834`) — the largest text on the screen — for state that
never changes mid-turn, while End Turn, Spy and Settings are small buttons in
the corner. Demote the status chips to a quiet single status line; promote
End Turn to the clear primary action.

---

### Stage 2 as built

`tsc --noEmit` clean; `test/combat/manualBattle.test.ts` 10/10.

- **2a** — `sidePanel` deleted. "Waiting on the AI…" moved into the footer help
  line, which also fixed that row telling the player to "click one of your
  platoons" during the AI's turn, when nothing is selectable.
- **2b** — split the old single `canvas.width` notion into three explicit
  values: `GRID_W`/`GRID_H` (fixed logical drawing space), `canvasScale`
  (logical → CSS px), and `devicePixelRatio` (CSS → device px). The backing
  buffer is sized at `scale * dpr` and the context transform bakes the same
  factor in, so `draw()` still speaks plain grid coordinates and the map
  renders crisp at any size. Scale now fits **both** axes — width alone was
  fine while the map could only shrink, but a growing map on a wide-but-short
  viewport would have run past the bottom of the container.
- **2c** — `alignSelf: flex-start` → `stretch` on the side columns (portraits
  stay level, which was the original point, but the column now runs full
  height), and the platoon grid went from `maxHeight: calc(100vh - 260px)` to
  `flex: 1; minHeight: 0`.
- **2d** — the three 18px bordered chips became one quiet 12.5px status line
  (`Round 1 · Your Turn · 🌅 Dawn`), and End Turn was promoted to the primary
  button style.

### Knock-on fixes Stage 2 forced

**Popup now flips sides instead of only clamping** (`platoonInfoPopup.ts`).
With the battlefield filling the space between the rails there is no longer a
wide gutter to absorb the card, so the Stage 1c clamp started pushing it back
across its own anchor and onto the platoon it describes. It now tries the
opposite side before falling back to clamping, and the tail follows the side
it actually landed on.

**`refreshAfterMove` re-anchors the popup.** It recomputed movement and
targets but never called `showInfoPopupFor`, so after a move the card sat at
the platoon's old hex still advertising the pre-move movement budget.
Pre-existing — `selectPlatoon` had the call and this path didn't — but only
obvious once the map was big enough to see the gap.

### Not verified

The narrow-viewport path (`CANVAS_MIN_SCALE`, and resize recalculation
generally) is **untested**. `resize_window` had no effect on the viewport in
this browser session — it stayed 1568×751 regardless — so the map was only
ever exercised at one width. The resize listener is wired to the new
`fitCanvasToContainer`, which recomputes scale, reapplies the transform and
redraws, but that has not been watched happening.

Six platoon tiles still scroll at a 751px-tall window: three rows of ~186px
tiles need ~560px and the rail only gets ~400px there. The plan's claim that
all six would fit holds at the 1080p design target (~765px available) but not
at this window size. Shortening the tiles or going 3-up would fix it properly.

## Stage 3 — Restyle onto the tokens

**3a. Overlay + header.** The arena background is `menuTheme.panel.background`
(`:737`) and the title bar is translucent enemy-red (`:764`) — the same red
that means "AI side" everywhere else on the screen. Move to the navy ground
and a gold-ruled header consistent with the menu shell.

**3b. Platoon tiles.** Keep the existing per-side accent tinting
(`${accent}22`, `:423`) — the blue/red coding is load-bearing and works. Move
the type, spacing and borders onto tokens.

**3c. Typography.** Serif display face for headings and the title bar (matching
the menu), UI sans for dense stat rows where the serif hurts legibility at
10–11px.

---

## Stage 4 — Interaction polish

**4a. Disabled affordance.** Cast Spell is dimmed with `cursor: not-allowed`
and a hover-only "Spellcasting isn't implemented yet" title (`:1060-1061`).
Say so visibly rather than on hover.

**4b. Distinguish Surrender from Retreat.** Two identical dark buttons today;
one is recoverable, one ends the run. Give Surrender the destructive role from
the token set.

**4c. Contextual help.** Correction to the original review: this row *is*
already state-aware (`renderFooterActions` branches on spy mode / nothing
selected / moves remaining / out of movement, and Stage 2 added the
waiting-on-AI case). What's actually wrong is the writing — the
moves-remaining branch packs three separate rules into one small run-on
sentence. Tighten the copy; the branching is fine.

**4d. Enemy rail.** Six identical "Unscouted" boxes occupy a full 320px rail.
Fog of war is intentional and stays, but the unscouted tile can be visually
lighter so the rail doesn't read as broken.

---

## Sequencing

Stage 1 is independent and can land first. Stage 0 must precede Stage 3.
Stage 2 is independent of the theme work and can run in parallel.

Suggested order: **1 → 2 → 0 → 3 → 4**, so visible structural wins land before
the wide-blast-radius theme change.

## Testing

`test/combat/manualBattle.test.ts` covers combat logic, not layout, and should
stay green throughout — none of this touches `shared/combat/`. The canvas
transform change in 2b is the only item with real regression risk (hit-testing);
verify by clicking hexes at several viewport widths, including the narrow end
where `CANVAS_MIN_SCALE` engages.
