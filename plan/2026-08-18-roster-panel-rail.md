# Dock the Heroes / Settlements roster panels into a right-hand rail

**Date:** 2026-08-18
**Branch:** `feat/roster-panel-rail` (off `origin/main`)
**Status:** Implemented, verified live, build + full test suite green.

## Background

Clicking **⚔ Heroes** or **⌂ Settlements** in the toolbar opened a floating `PopupMenu` at a
hardcoded position (`{x:260, y:16}` and `{x:260, y:220}` respectively). Both landed somewhere
that felt arbitrary and, worse, the Heroes panel physically covered toolbar buttons next to the
one just clicked. Root causes, confirmed live against a running game:

1. **Magic-number anchors unrelated to the toolbar** — the Heroes panel (y 16→128) opened
   entirely inside the toolbar's header band (y 0→125).
2. **A stacking-context accident** — `#app` is `position: fixed; z-index: 0`, which traps
   `#toolbar` (z-index 10, but *inside* `#app`'s stacking context) below the body-level panels
   at z-index 60. No z-index inside the toolbar could win.
3. **Viewport reads captured once at construction** — sibling panels computed anchors from
   `window.innerWidth/innerHeight` at startup; resizing afterward left them stale.
4. **Variable toolbar height nothing accounted for** — the toolbar wraps under `flexWrap`, so a
   narrower window grows the header and swallows more of whatever opened at a fixed `y`.

Plus: `PopupMenu` kept its position across close/reopen with no resize clamp, so a dragged panel
could be stranded off-screen.

## What shipped

**New module — [`src/screens/shared/panelRail.ts`](../src/screens/shared/panelRail.ts):** a
singleton, `position: fixed` rail docked to the right edge, top pinned to the toolbar's *measured*
height (`--toolbar-h` CSS var), bottom pinned to a reserved zone above the minimap
(`--minimap-reserve`). Heroes and Settlements both mount into it via `mountPanel()`; either can be
open alone or together, non-overlapping by construction instead of by coincidence.

**[`src/screens/shared/menu.ts`](../src/screens/shared/menu.ts) made dock-aware:**
- `PopupMenu.setLayout("docked" | "floating")` — docked mode is `position: static`, non-draggable,
  capped at `calc(50% - 4px)` height (see below); floating mode restores the original absolute
  positioning + drag behavior.
- Fixed a latent bug where `setDraggable(false)` only changed the cursor — the mousedown handler
  stayed live, so a "non-draggable" panel was still draggable. Docked mode depends on the real fix.
- `addHeaderAction()` — generic header button slot, used for the pop-out/dock toggle (⧉ / ⇲).
- `minTop` option + shared `clampMenuIntoView()` (also now reused by `openCenteredModal`, which had
  its own copy of the same clamp) — a floating panel can't be dragged under the toolbar.

**Roster menus** ([`heroRosterMenu.ts`](../src/screens/heroes/heroRosterMenu.ts),
[`settlementRosterMenu.ts`](../src/screens/settlements/settlementRosterMenu.ts)) now mount into
the rail instead of `document.body` at a fixed coordinate. Everything else (game-state wiring,
row rendering, `UIManager`'s open/close toggle) is unchanged.

### Follow-up refinements (same session, after initial review)

- **Hard stop above the minimap.** The minimap is canvas-drawn (not DOM), bottom-right corner —
  exactly where the rail's `bottom: 0` used to extend. Added
  `getMinimapReserveHeight(mapWidth, mapHeight)` to [`minimap.ts`](../src/render/minimap.ts),
  reusing its existing geometry math. `UIManager.setMapDimensions()` feeds that into
  `panelRail.setMinimapReserve()`, called every frame from `GameEngine.fullFrame()` so it tracks
  the current map's size (and resizes) without hooking every new-game/load-game code path.
- **50% max height per panel**, not a full-rail stretch. `setLayout("docked")` changed from
  `flex: 1 1 0` (grow to fill) to `flex: 0 1 auto; maxHeight: calc(50% - 4px)` — a panel with one
  hero now sizes to its content instead of stretching to fill the whole rail; two open panels
  still split it, each capped independently.
- **Vertical scroll confirmed to survive the cap** — the existing `overflow-y: auto` content div
  still scrolls once content exceeds the 50% box (stress-tested by injecting 30 synthetic rows:
  panel plateaued at the cap, content scrolled 1585px of height inside a 349px viewport).
- **Pop-out/dock persistence gated on login.** There's no server-side settings table yet, so an
  anonymous session's floating positions and dock/float choice only live in memory for that page
  load — every non-logged-in session now starts back at the default (docked), verified by
  popping a panel out, dragging it, and confirming `localStorage` never got written while
  anonymous, then reloading and seeing it come back docked. Logged-in sessions still fall back to
  `localStorage` (via `getCachedAuth()` in [`auth.ts`](../src/io/auth.ts)) as the nearest thing to
  durable per-user storage until a real DB-backed settings store exists.

### Bug found during verification (not in the original plan)

The toolbar-height `ResizeObserver` in `panelRail.ts` held no reference to itself
(`new ResizeObserver(apply).observe(el)`), making it eligible for GC after its first callback in
some engines — the rail's top would freeze at whatever the toolbar measured on first paint and
silently drift out of sync as the toolbar grew (e.g. once real calendar/gold values replaced
placeholder text). Fixed by storing the observer at module scope, and additionally made the
height measurement eager/synchronous on every panel mount so correctness never depends on
`ResizeObserver` timing at all — it's now a live-update convenience layered on a synchronous
measurement taken at the moment that matters.

## Out of scope — flagged, not changed

- **Hero / Settlement info panels** still float at hardcoded `x: 16`, so they can still land on
  top of each other. Same rail infrastructure applies; not touched this round.
- **[`settlementPanel.ts`](../src/screens/settlements/settlementPanel.ts) is dead code** —
  `SettlementPanel` is defined but never instantiated anywhere in `src/`.
- **The z-index scale** (55 / 60 / 75 / 100 / 120 / 200 / 300 / 10000) stays as-is. The
  `#app`/z-index:0 stacking-context accident (cause #2 above) is what let it hide; a named
  constants module would be a good follow-up.
- **Real server-side settings storage.** Logged-in persistence still rides on `localStorage`, not
  a database — flagged in a comment in `panelRail.ts` as the interim state.

## Verification

- `npm run build` (tsc + vite build) — clean, both at initial implementation and after every
  follow-up change.
- `npm run test:all` (smoke + multiplayer smoke + cityView + 201 `node:test` unit tests) — all
  green throughout, including after the login-gated persistence change.
- Live browser verification at each stage (via the Browser pane's DOM/JS tools, since
  `test/screens/` has no DOM harness — `arena.test.ts` hand-rolls a mock `document` and
  deliberately avoids jsdom):
  - Heroes alone, Settlements alone, both together — no overlap, `elementFromPoint` over every
    toolbar button returns that button (the original bug's regression check).
  - Closing one panel expands the other to fill the rail.
  - Pop-out moves a panel to floating, drag-clamped so it can't go under the toolbar or off
    the minimap's reserved zone; state persists across reload only when logged in.
  - Minimap reserve verified algebraically against live-measured DOM rects (rail bottom vs.
    computed minimap box top) across the small map's aspect ratio.
  - 50%-cap and scroll-survival verified by measuring actual panel/content heights with 1, 2, and
    (synthetically) 30+ rows.
