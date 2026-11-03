# Playthrough — the turnover tip: the other surfaces sharing the refusal path, and the suite

Thread: wtgui-playthrough-the-turnover-tip-f14017
Tree: C:/ProjectDevelopment/heroes-js/.worktrees/playthrough-the-turnover-983126
Branch: wtgui/refusal-surfaces-turnover, cut from turnover/heroes-local-20261102 (tip c0c4223, release 0.37.2). LOCAL-ONLY; nothing pushed.
Date: 2026-11-02

**One line:** yes — every surface that shares the refusal path still speaks in words and places nothing
(adventure map: toast + tile-panel sentences; build palette: `palette-notice` sentence, dimmed rows), and
`npm run test:cityview` runs to completion — 23 cases, 0 skipped, exit 0; the retarget commit 513425c is
what makes it complete (9 of 23 cases before it).

---

## 0. Isolation

- Branch cut from the turnover tip, never from main:
  `git switch -C wtgui/refusal-surfaces-turnover turnover/heroes-local-20261102` → `## wtgui/refusal-surfaces-turnover`,
  clean tree (the only untracked paths are `.env` and `local/`, both gitignored).
- Own database `game_play_983126` (`CREATE DATABASE game_play_983126 OWNER gameuser;`), own ports from
  `npx tsx scripts/allocate-ports.ts`: **API 61045, CLIENT 61046, WS 61047**.
- Reserved things untouched: `netstat -ano | grep -i listen` shows 57082/57083 still LISTENING (the turnover
  instance); `game_poc_turnover_0817cc` was never opened — every psql call below is `-d game_play_983126`.
  The panel (7331), the gateway (8642) and the shared dev server were not touched.
- The turnover tip changes, vs its base b6646da (i.e. main), exactly:
  `CHANGELOG.md`, `package.json` (0.37.2), `src/screens/settlements/cityView/buildingPlacer.ts` (+48),
  `src/screens/settlements/cityView/cityView.ts` (+28), `test/cityView.test.ts` and four new test files
  (`_cityPlacerHarness.ts`, `cityBuildPaletteAffordability.test.ts`, `cityPlacementClick.test.ts`,
  `cityPlacementRefusal.test.ts`). So the surfaces I was sent to check are untouched by the turnover, which
  is the point: a fix verified on one surface is not a fix for the symptom.

Game used: the starter classic game **starter-mw00s87q** (client auto-created on first load; loaded from the
landing page's Load Game list, which is the LIST route). Player seat 0, hero `p0-hero` at (11,7), two owned
settlements: `castle-1-11-7` (level 1) and `castle-2-17-2` "Frost crest" (level 2).

## 1. The adventure map's own refusals (surface 1)

Hero `p0-hero` selected (client `selectedHeroId` = `p0-hero`), everything below captured with a `fetch`
recorder and a `MutationObserver` on `#toast-container` installed in the page.

**1a. An impassable tile still speaks and still moves nobody.** Tile (11,9) — wide river over forest.
Click on it:

- `__gameDebug.lastClick` → `{"hover":{"q":11,"r":9},"path":[],"reason":"empty path","moved":false}`
- toast → **"No path there"**
- tile info panel body → **"Forest · impassable"** / **"Wide river — impassable without a bridge"** (title "Tile 11, 9")
- hero before and after → `{q:11, r:7, movementRemaining:7, trail:[{q:11,r:7}]}` — unchanged
- no request of any kind: the only write in the whole session's log is the `load_game` event
  (`POST /api/games/starter-mw00s87q/events` 201, body `{"id":"84","kind":"load_game",...}`).

**1b. A dead tile (a passable hex with no way in) refuses the same way.** All six neighbours of (6,1) are
impassable, so it is passable but unreachable. Panned to it, clicked it with the hero selected:

- `lastClick` → `{"hover":{"q":6,"r":1},"path":[],"reason":"empty path","moved":false}`
- toast → **"No path there"**; hero unchanged; the tile panel reads "Unexplored" (outside vision) — nothing placed, nothing written.

**1c. A repeated click on the SAME tile repeats the refusal and writes nothing.** Two further clicks on (11,9):
`lastClick` identical (`reason:"empty path"`), the toast is the deduped single "No path there" (the 1.5 s
`isDuplicateToast` window refreshes the node rather than stacking), and the request log gained **no** event
or command POST.

**Attribution gap worth recording (harness, not product):** my first attempts all failed with
`reason:"no selection"` and the toast "Select a hero first", even with the hero visibly selected. Cause
found: `document.visibilityState` was **"hidden"** and `requestAnimationFrame` was frozen (1 tick/s), so
`GameStateManager.update()` never copied the turn controller's state into the client state — and the
adventure view reads the CLIENT state (`getGameState: () => this.state.getState()`) while `selectHero`
writes the TURN CONTROLLER's state. `cdp('Page.bringToFront')` → `visibilityState: "visible"`, 364 rAF ticks
in 1.5 s, and the real refusals above appeared. Nothing was changed to fix this (documented, not fixed); the
coupling is pre-existing (these files are byte-identical to main) and the click path still refuses cleanly —
it just refuses with the wrong sentence while the tab is throttled.

## 2. The build palette, from a DIFFERENT settlement, at the affordability boundary (surface 2)

Settlement **castle-2-17-2 "Frost crest", level 2** (10×10 city grid, `cityViewSizeFor(2) === 10`), opened by
dispatching a DOM `dblclick` on `canvas#game` at `screenFor(17,2)`; palette opened with the ⚒ Build button.
The turnover's own suite drives a level-1 size-5 city, so this is a genuinely different settlement and grid.

**2a. The geometry refusal still speaks, in the palette.** With **Tower** armed (1×1, cost **300 g / 8 wood /
5 stone** — exactly the treasury at that moment), a grid click on the centre cell (the town-hall cell (5,5),
derived from `cityLayout(10, 1258, 566, 86)` + `cellToScreen`, tileScale 0.95, screenOrigin (629, 116.5)):

- `[data-testid="palette-notice"]` → **"The center cell is reserved."**
- no `palette-cart`, no placement, no command POST.

Driving note: `click_at_xy` on a grid cell is swallowed — `cityView` re-arms `suppressNextCanvasClick` for
350 ms when it sees mousedown/mouseup. A lone synthetic `click` (or `mousemove` then `click`) on
`canvas#game` is what the view listens for; used for every grid click below.

**2b. Both sides of the boundary, with gold exactly equal to a row's cost (300 g).**

| treasury | Tower row (cost exactly 300) | Archery Range (350) | House (100) |
|---|---|---|---|
| **300 g** | `opacity 1`, title "Upkeep: 1 wood, 1 stone per turn" → AFFORDABLE | `opacity 0.5`, "Not enough gold (need 350, have 300)" | lit |
| **299 g** (hand-set in the DB, reloaded) | `opacity 0.5`, **"Not enough gold (need 300, have 299)"** | "need 350, have 299" | lit |

and the 300 g side is not merely lit: placing the armed Tower on the free cell (0,1) auto-committed —

- `POST /api/games/starter-mw00s87q/commands` **200**, body `{"events":[{"type":"BuildingsPlaced","actor":0,"settlementId":"castle-2-17-2"}],"lastEventId":86,"settlement":{"name":"Frost crest",...,"gold":0,"warehouse":{"wood":292,"stone":295,...}}}`
- i.e. treasury 300 → **0**, wood 300 → **292**, stone 300 → **295** — exactly the Tower's 300/8/5.
- The DB agrees afterwards: `settlements->'castle-2-17-2'->'buildings'` kinds end `..., "farmhouse", "tower"`.

So the boundary sits exactly at `cost == treasury`, and both sides are exercised at that value.

**2c. The palette's affordability follows the treasury while the city stays open (the 0.37.2 fix, on this
other settlement).** With the palette open and the treasury at 0 (the Tower's commit), **all 43 rows** were
dimmed at "have 0". One real ▶ End Turn click, without leaving the city view: **42 lit / 1 dimmed** (the only
dimmed row being "Town Hall (built) — A town hall already exists in this settlement"), settlement gold
**3105**. Nothing was exited or re-entered.

**2d. A dimmed row is inert but NOT `disabled` — finding (low).** Every unaffordable row has
`button.disabled === false`; `renderBuildList` sets `opacity 0.5` and the title, and the click handler
`if (disabled) return;` — but never assigns `row.disabled`. Measured: clicking the dimmed Tower row
(gold 299) left its background at `rgba(255,255,255,0.04)` (not the armed `rgba(60,120,60,0.6)`), so nothing
was armed; a following grid click produced no `palette-notice`, no `palette-cart` and no request at all.
Consequence: correct behaviour, weak semantics (a keyboard/AT user gets a focusable, enabled-looking button
that silently does nothing). This also contradicts the playthrough skill's note that such a row is
"DISABLED, not just dimmed" — the skill has been corrected rather than the code (the task says document,
don't fix).

**2e. The cart's own refusal line could not be reached from the UI (documented, not a defect claim).**
`buildingPlacer.confirmPlacement` writes the affordability sentence ("Not enough gold (need N, have M)", via
`affordabilityRefusal`) into the same `palette-notice` — read in the code, not measured. To observe it the
palette's snapshot must be STALE (it must say a building is affordable while the treasury cannot cover it),
and in this build the snapshot re-syncs on every commit and on `turn:ended`/`state:committed`
(`cityView.syncAffordability`), while a row the snapshot calls unaffordable cannot be armed at all. The two
conditions are mutually exclusive in the UI, so I never saw the sentence; I am not claiming it is broken —
I am saying the run could not exercise it. The geometry half of the same notice IS measured (2a).

## 3. `test:cityview` in a fresh tree (surface 3)

Run as `PGDATABASE=game_play_983126 npm run test:cityview` (a real process env var; `.env.test` pins
`PGDATABASE=game_poc` and is loaded after `.env`, so only the environment wins).

- **exit 0**; log: **23** `>> Test:` lines, **35** ✓ lines, **0** occurrences of "skip" anywhere in the log,
  then `>> All city view tests passed ✓` and `>> Cleaning up subprocesses...`. It runs to completion with
  nothing skipped.
- **Is the retarget commit what makes it run? Measured, yes.** I swapped in main's pre-retarget fixture
  (`git show b6646da:test/cityView.test.ts > test/cityView.test.ts`) and re-ran the same command:
  **exit 1**, only **9** `>> Test:` lines, aborting at
  `>> TEST FAILED: pool 5: touched town hall 1, each farm 1, the hut fills to 2, the house stays empty while job slots remain`
  with actual `[1, undefined, undefined, undefined, undefined]` vs expected `[1, 1, 1, 2, 0]`.
  Restored with `git checkout -- test/cityView.test.ts` (working tree clean again). So the retarget 513425c
  takes the suite from 9 of 23 cases to 23 of 23.

## Leftovers

- Database `game_play_983126`; game **starter-mw00s87q** — delete by exact name:
  `docker exec game_db psql -U gameuser -d game_play_983126 -c "DELETE FROM games WHERE name='starter-mw00s87q';"`
- My dev instance still runs on 61045 (api) / 61046 (web) / 61047 (ws); stop it with the `npm run dev` job
  in that worktree (and `npm run cleanup` before any suite that spawns its own api+vite).
- Hand-edited for the boundary run: `games.settlements->'castle-2-17-2'->>'gold'` is **299** (was 3105).
- Raw logs kept in the worktree: `local/dev-out.log`, `local/cityview-run.log`,
  `local/cityview-preretarget.log`.
