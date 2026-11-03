# Consolidation — the trio's turnover playthrough findings: decided, implemented, folded back

- **Thread**: `wtgui-consolidate-the-trio-s-playw-800828dc` (panel job `800828dc`)
- **Worktree**: `C:/ProjectDevelopment/heroes-js/.worktrees/consolidate-the-trio-s-p-348a7f`
- **Branch**: `wtgui/consolidate-the-trio-s-p-348a7f`, cut with
  `git switch -C wtgui/consolidate-the-trio-s-p-348a7f turnover/heroes-local-20261102`
  (parent tip `c0c4223`, release 0.37.2) — **never** from `main`.
- **Fold back**: `turnover/heroes-local-20261102` (checked out in
  `.worktrees/build-the-turnover-branc-0817cc`) is fast-forwarded to this branch's tip; its dev
  instance (client `57083`, API `57082`, DB `game_poc_turnover_0817cc`) is left running and
  hot-reloads the result. **LOCAL-ONLY: nothing pushed, no remote branch, no PR.**
- **Measurement**: 2026-11-02 EST, this worktree's own DB `game_poc_ctrio_348a7f`.

## Decision list

One line per filed finding, decided in order. "Implement" means code + a test that fails without
it; "drop" means the acceptance criterion is already met by something that exists, with the reason.

| # | Finding | Decision | Why |
|---|---|---|---|
| 17 | Unaffordable palette rows are dimmed and inert but `button.disabled` is `false` | **implement** | The row is a lie to a keyboard/AT user: it is focusable, enabled and announced as actionable, and does nothing. The click handler already returned early, so `row.disabled = disabled` changes no behaviour and states the same fact the colour and the tooltip state. Two unit cases, RED→GREEN. |
| 18 | The cart's own affordability notice, reached by the turnover card and not by the refusal-surfaces card | **drop** (no code) | Already covered twice: `0c04855`'s end-to-end case 4 asserts the sentence in the palette on a real client (`Not enough gold (need 300, have 100)`, nothing sent, retires on the next reading), and `test/screens/settlements/cityPlacementRefusal.test.ts` pins the placer's half for both `placeAt` and `confirmPlacement`. The earlier run could not reach it because arming a row the snapshot calls unaffordable is impossible through the UI — a drive limitation, not a defect. Nothing left to implement. |
| 20 | The New Game form overflows a 566px viewport: `Create Game` is a silent no-op and the client quick-starts a `starter-*` CLASSIC game | **implement** | The home overlay was a centred fixed flex container with no overflow of its own, so a 669px form card hung over both edges of the viewport with no scroll — `elementFromPoint` at the button's centre returned `null` and a real click did nothing. The overlay now scrolls and the card is centred by its own auto margins (which resolve to zero when it overflows). New browser spec `test/newGameFormViewport.e2e.ts`, RED→GREEN. |
| 21 | `POST /games` logs a hero start `(2,5)` the wagon never had | **implement** | The line printed the REQUEST's `hero_q/hero_r`, which the start placement ignores in **both** modes (measured: `requestedHero=(10,2)` for a `p0-hero` at `(11,7)`; `requestedHero=(8,23)` for a `p0-wagon` at `(18,20)`). The request's start is now labelled as the request's, and a second line reports where each seat actually spawned, read back from the state the INSERT stores. Route test, RED→GREEN. |
| 22 | The shared `getClientPort` fallback can silently attach a browser suite to port 5173 — this box's deployed Docker web — and measure an older built bundle | **implement** | `getClientPort(5173)` was a guess whose guess WAS the deployed stack (`game_web`, `0.0.0.0:5173->80`, answering `/src/*.ts` with `text/html`), so a suite whose `vite --strictPort` lost the bind race reported the deployed build's behaviour as a product failure. The shared helper now resolves request file → environment → default and **refuses** a default that is the deployed stack, the way `test/_envGuard.ts` already refuses for the by-hand entries. Asking for a deployed port explicitly still works. `test/core/testPorts.test.ts`. |
| — | Coverage gap: the founding adjacency refusal is unexercised | **drop** (no code) | It is already exercised deterministically at all three layers — the engine's `canFoundSettlement` (`test/engine/settlersMode.test.ts`, "…on occupied, impassable and too-close hexes"), the `FoundSettlement` route relaying it (`test/server/foundSettlement.test.ts`, "relays the engine's spacing refusal inside a settlement's dead zone"), and the client's own sentence (`test/screens/adventure/clickIntent.test.ts`, `tileInfo.test.ts`). What the trio could not do is drive it LIVE, and that is unreachable by construction: a seat has exactly one wagon and founding consumes its wagon-ness, so no second too-close founding exists to attempt. The unexercised thing was the playthrough, not the rule. |

`#19` is not in this brief (the brief lists #17, #18, #20, #21, #22 and the coverage gap), so no
decision is recorded for it here.

## What was gathered

Both of the trio's own commits were cherry-picked onto the branch (their branches already carry the
parent's six commits, so the branches themselves were not merged):

| Trio commit | On this branch | Contents |
|---|---|---|
| `0c04855` (branch `wtgui/city-grid-turnover-playthrough`, worktree `playthrough-the-turnover-9c702e`) | `07b5011` | `test/cityGridTurnover.e2e.ts`, its `test:cityGridTurnover` script and its `tools/run-test.mjs` entry |
| `a9a424d` (branch `wtgui/refusal-surfaces-turnover`, worktree `playthrough-the-turnover-983126`) | `6225a8a` | `analysis/2026-11-02-refusal-surfaces-turnover-playthrough.md` |

The settlers card (`wtgui/settlers-turnover-playthrough`, worktree `playthrough-the-turnover-cf5e3e`)
carries **no commit of its own** — its tip is the parent tip `c0c4223` — so there was nothing to
cherry-pick from it. All three reports under
`C:/ProjectDevelopment/heroes-js/.agentboard/playthrough-reports/`
(`…-4ddaff` city grid, `…-20b954` settlers founding, `…-f14017` refusal surfaces) were read in full,
and the filed findings #17, #18, #20, #21, #22 plus the coverage gap were decided above.

## Implementation, with the evidence

Everything below was measured on this worktree, `PGDATABASE=game_poc_ctrio_348a7f`.

### #17 — a refused row is disabled, not merely dimmed

`src/screens/settlements/cityView/buildingPlacer.ts` (`renderBuildList`) now assigns
`row.disabled = disabled` beside the opacity, the colour and the title it already set.

RED (fix reverted) → GREEN, `test/screens/settlements/cityBuildPaletteAffordability.test.ts`:

```
✖ palette: an unaffordable row is DISABLED, not merely dimmed
✖ palette: a structural refusal is disabled too, not only a treasury one
ℹ pass 2  ℹ fail 2          →  ℹ pass 11  ℹ fail 0
```

The second case is deliberate: the flag is the entry status's `disabled`, not "gold is short", so a
second town hall is refused by the control's own state too.

### #20 — the Create Game form is reachable at a 566px viewport

`src/screens/home/homeView.ts`: the home overlay gained `overflowY: auto`, `overflowX: hidden`,
`padding: 24px 16px`, `boxSizing: border-box` and `alignItems: flex-start`; the card gained
`margin: auto` and `width: min(560px, 100%)`. Auto margins are what re-centre the card when there is
room and degrade to "flush to the top, scroll for the rest" when there is not.

New spec `test/newGameFormViewport.e2e.ts` (registered as `newGameForm` in `tools/run-test.mjs`,
npm script `test:newGameForm`), driving the real client at **1258×566**:

RED (fix reverted):

```
>> TEST FAILED: the form must sit in a container that can scroll: on a 566px-tall viewport the
   overlay overflows with no scroll of its own (the finding's own measurement)
>> run-test FAILED: [newGameForm] exited code=1 signal=null
```

GREEN:

```
>> Opening New Game at 1258x566
>> Form container scrolls (566 -> 819, scrolled to 253) ✓
>> Create Game reachable: y 483.0..513.0 of 566; hit test -> BUTTON: Create Game ✓
>> Create Game submitted newgame-viewport-mw01zqvx (gameMode settlers) and opened it ✓
>> All new-game-form viewport tests passed ✓
```

The last two lines are the point of the finding: the click submits exactly ONE game, with the name
and the mode the form was filled in with, and the client opens that game — not the boot-time
`starter-*` classic one.

### #21 — the create log tells the truth about the spawn

`server/routes.ts`: the request line is now
`[api] POST /games name=… requestedHero=(q,r) mapSize=… gameMode=…`, and a second line
`[api] POST /games name=… spawned=<id>@(q,r) …` is logged from `initial` — the same object the
INSERT stores, so the line cannot drift from the row.

RED (fix reverted) → GREEN, `test/server/createGameRoute.test.ts`:

```
✖ POST /games logs where the seats' entities spawn, not the hero_q/hero_r the mode ignored
  AssertionError: the create must log where the seats spawn; saw:
ℹ pass 23  ℹ fail 1          →  ℹ pass 24  ℹ fail 0
```

Seen live in the trio's own suite (which is itself the evidence for the trap):

```
[api] POST /games name=starter-mw01xark requestedHero=(10,2) … spawned=p0-hero@(11,7) p1-hero@(5,11) p2-hero@(4,15)
[api] POST /games name=citygrid-turnover-mw01xcel requestedHero=(8,23) … spawned=p0-wagon@(18,20)
```

### #22 — the shared port helper refuses to guess the deployed stack

`test/_request.ts` keeps the precedence it had (fresh request file → environment → default) and adds
`resolveTestPort`, which `getApiPort`/`getClientPort` now use. The default is honoured only when it
is not a deployed port; `API_PORT=3001` / `CLIENT_PORT=5173` passed **explicitly** still work (the
guess is what was refused, not the target); a malformed port refuses instead of falling back.

`test/core/testPorts.test.ts` — 7 cases, all green. Live demonstration, run from a directory with no
request file and no `CLIENT_PORT`:

```
REFUSED (no request file, no CLIENT_PORT):
CLIENT_PORT is unset and this run would fall back to 5173 -- this box's DEPLOYED Docker stack.
Refusing: the run would drive a built image (the deployed web serves /src/*.ts as text/html, so a
browser suite would measure an OLDER BUNDLE) instead of this worktree.

Pass CLIENT_PORT explicitly (a free port; scripts/allocate-ports.ts writes .env for the npm scripts),
or ask for the deployed stack out loud with CLIENT_PORT=5173.
```

The normal paths are unaffected: `npm run test:cityview` (which loads `.env` written by
`scripts/allocate-ports.ts`) and the wrapper-driven suites (which get a fresh request file) both run
green below, and the two new browser specs pick their own kernel-assigned ports.

## Gate

Run on this branch, `PGDATABASE=game_poc_ctrio_348a7f`:

| Gate | Result |
|---|---|
| `npm run build` (`tsc && vite build`) | green — `✓ built in 1.53s` |
| `npm run docs:check` | green — `20 maintained docs, 214 local links, 519 source paths` |
| `npm run lint:deps` | green — `no dependency violations found (524 modules, 1737 dependencies cruised)` |
| `npm run test:cityview` | green — `>> All city view tests passed ✓` |
| `npm run test:cityGridTurnover` (the trio's spec) | green — `>> All city-grid turnover tests passed ✓`, `>> run-test OK` |
| `npm run test:newGameForm` (new) | green — `>> All new-game-form viewport tests passed ✓`, `>> run-test OK` |
| `test/core/testPorts.test.ts` + `test/screens/settlements/cityBuildPaletteAffordability.test.ts` | green — 11/11 |
| `test/server/createGameRoute.test.ts` | green — 24/24 |

## Fold back

The parent branch is checked out in `.worktrees/build-the-turnover-branc-0817cc` with a dev server
running from it (client `57083`, API `57082`, DB `game_poc_turnover_0817cc`). It was fast-forwarded
in place with `git -C <that worktree> merge --ff-only wtgui/consolidate-the-trio-s-p-348a7f` — a
fast-forward, so no merge commit, no history rewrite, and the running instance was never stopped,
restarted or pointed anywhere else; it hot-reloads the new code. The old tip was `c0c4223` (it is
quoted in this branch's commit messages); the new tip is this branch's tip, which is the commit that
carries this file. This work is LOCAL-ONLY: no `git push`, no remote branch, no pull request.

## Leftovers

- **Database** `game_poc_ctrio_348a7f` — this consolidation's own; the games created by the specs are
  `starter-*`, `citygrid-turnover-*`, `newgame-viewport-*`. `DROP DATABASE game_poc_ctrio_348a7f;`
  clears all of them; nothing in it is shared with the turnover instance.
- **`node_modules`** in this worktree is a junction to the parent worktree's install (the main
  checkout's `node_modules` is an empty stub on this box).
- The panel's copy of this report lives beside the trio's reports, untracked:
  `C:/ProjectDevelopment/heroes-js/.agentboard/settlers-reports/wtgui-consolidate-the-trio-s-playw-e9d80b.md`.
