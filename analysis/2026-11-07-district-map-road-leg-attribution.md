# A grown settlement's second and later districts draw no road leg — measured, attributed, and intended

**Branch** `wtgui/measure-first-a-grown-se-f01311` · **PR** (link below) · worktree
`C:\ProjectDevelopment\heroes-js\.worktrees\measure-first-a-grown-se-f01311`

The card that decomposed the `district-map` scene found all 1,455 of its failing pixels in the
settlement road network and left the baseline RED rather than absorb a moved subject. It named two
movers and left one question open: **is a district placed into an EXISTING settlement meant to draw no
road leg at all?** This row re-measured before writing any code, and the answer is **yes — it is
intended**, so **the baseline stays un-re-cut** and no source or doc file is touched.

## What was re-measured, on what tree

`git fetch github && git merge --ff-only github/main` — a true fast-forward, no merge into the landing
branch. The first pass measured on `github/main` **`73b08df`, version `0.53.19`**; main then moved twice
under the branch (`af4b4d3`, `0.53.21`, the faction building-set pins) and **every number below was
re-taken on the rebased tree** (`f897c16`, `0.53.22`), where the suite's own run reads the same
`district-map` 1,455 px. The frame reproduces the suite's own number **to the pixel** in every state,
which is what makes each number a measurement *of the scene* rather than of the diff.

The probe (`local/probe/probe-district-map.ts`, gitignored) mirrors the scene exactly — same seed 13,
same game-form choices, same click order, same `page.locator("canvas").last()` capture, same 1280x800
viewport and `reducedMotion` — and spawns its **own** api + vite on freshly allocated ports. That last
part is load-bearing: a long-lived `npm run dev` serves a **stale** transform of a file edited after it
started (measured — the perturbed module was still served verbatim), which silently turns a revert
measurement into a no-op. The probe prints the tree identity it is actually running
(`v0.53.19 (73b08df)` / `v0.53.22 (f897c16)`) before it drives anything.

## Every pixel of the 1,455, attributed

Each state is reached by reverting **only one** behaviour in place, then restoring it (`git status
clean` afterwards, quoted below). The 8 px toolbar glyph residual at `[666,15 -> 1259,19]` is the
documented `image-rendering: pixelated` instrument and is quoted **apart** from the content — it is
present in some runs and absent in others, which is what makes it an instrument:

| state | px vs the committed baseline | what it isolates |
|---|---|---|
| HEAD (one cased leg) | 1,463 = **1,455** + 8 | both movers together |
| road stack reverted to pre-0.49.0 (one hairline leg) | 446 = **438** + 8 | 0.51.1's zero-workforce stamp alone |
| engine staffing rule reverted (three cased legs) | **2,426** (exact) | 0.49.0's cased band over three legs |
| **BOTH reverted** (three hairline legs) | **0** — byte-identical to the baseline | the baseline is exactly "pre-0.49.0 art + pre-0.51.1 client staffing" |

**2,426 is to the pixel the number `d9e741a`'s own commit recorded for the road landing on its merge
base**, and **0 px with both reverted** is the proof that the committed baseline is precisely the
pre-both state: the two movers account for the whole surface with **0 px uncovered**.

At HEAD the failure is four clusters, and every one of them is the road — the thing this scene exists
to pin ("the district sprite AND the settlement road network both render"):

| px | bbox | mover | what it is |
|---|---|---|---|
| 1,017 | `[541,227 -> 604,310]` | **0.49.0** `d9e741a` | the ONE leg both frames draw (up, to the first district at (9,6)): the cased 3.55–4.50 px body against the baseline's sub-pixel hairline |
| 171 | `[486,360 -> 524,367]` | **0.51.1** `8a0e09d` | the LEFT leg (district (8,7)): in the baseline, **not drawn at HEAD** |
| 253 | `[539,391 -> 572,445]` | **0.51.1** `8a0e09d` | the DOWN-LEFT leg (district (8,8)): the same |
| 14 | `[534,362 -> 537,365]` | 0.49.0 / 0.51.1 | a band edge at the junction |
| **1,455** | | | **1,017 + 438 (171 + 253 + 14), uncovered 0** |

So the decompose card's "one mover, and it is 0.49.0" is right about the pixels and **wrong about the
mover**: there are two, and the second one **masks** the first. The 8 px instrument is separable and
was seen in the same runs (the two `head` runs differ by exactly those 8 px and nothing else).

## The mechanism, measured on a running settlement

The fixture founds three districts on the passable hexes around its home tile `(9,7)`: `(9,6)` north,
`(8,7)` west, `(8,8)` south-west. Recomputing `settlementRoadNetwork(settlement, map)` in Node over the
**server's own** settlement and the game's own map (`seed 13`, `small`, gen v6) gives:

| district | building `workers` (client / server) | `districtWorkforcePercent` | `roadsForWorkforce` | route | segment drawn |
|---|---|---|---|---|---|
| `(9,6)` — founded FIRST, while the settlement had no district at all | absent / absent (the bootstrap auto crew) | 100.0 % | 20 | yes | **yes** |
| `(8,7)` — placed into a settlement that already had one | 0 / 0 | 0.0 % | 0 | yes | **no** |
| `(8,8)` — the same | 0 / 0 | 0.0 % | 0 | yes | **no** |

`routes: 3, segments: 1`. The absent legs are **not** a connectivity failure: every district has a
route to the settlement. `freshPlacementWorkers` (the 0.43.0 workforce rebalance, `f15a912`) gives a
fresh placement into a settlement that already has a district an explicit `workers: 0`, and the client's
own row agrees with the server's — which is exactly what 0.51.1 (`8a0e09d`) fixed. `districtWorkforcePercent`
then reads 0.0 %, `roadsForWorkforce(0)` is 0, and `roadNetwork.ts`'s `if (route.roads <= 0) continue;`
skips the route.

## It is intended, and the leg comes back once the district is staffed

`docs/settlements.md` states the rule **three times** — "`0` workforce is no road at all" — and
`roadNetwork.ts`'s own header says it a fourth: *"Road COUNT is the visualization: one track per
WORKFORCE_PER_ROAD points of the district's own workforce, so 0 staffed is no road at all."* The
absence is the documented workforce display, not an accident.

**And it is not a dead end.** Staffing one district through the real `AssignWorkers` command (1 worker
on a 4-builder site = 25 % = 5 tracks) takes the network from **1 drawn segment to 3** — the same
`settlementRoadNetwork` call over the server's own settlement, before and after — and the leg is
**visibly back on the map** after the state commit (the evidence page's last frame). Two further
measured facts about that path:

- **the client does not re-render the road from the command alone.** The frame straight after
  `AssignWorkers` is **0 px** against the pre-staffing frame: the client's `Castle` mirror is rebuilt
  only on a state commit, so the leg appears on the next turn. That is the documented shape of the
  client's own state, not a road bug.
- **a classic L1 town's worker pool is exactly 1** (`floor(500 / WORKFORCE_PER_POPULATION 300)`), so of
  three districts a player can light **exactly one** at L1: the second `AssignWorkers` is refused
  `409 pool_exhausted`.

## What was NOT done, and why

- **The baseline is NOT re-cut.** A baseline that absorbs a moved subject hides the defect forever —
  and here the subject *did* move while the suite read OK (1,455 px = 0.142 % of a 5,120 px budget).
  The scene's own note now carries the full attribution, the movers, the mechanism and the reason, so
  the next reader meets the numbers at the scene rather than in a report.
- **No source change.** The two readings the measurement rules out are both *shipped behaviour the card
  was not sent to change*: pricing the hex off the DRAWN segments would remove a discount the player has
  today, and drawing a leg with no workforce would change a rule the docs state three times. Both are
  design forks for the reader, not fixes.
- **No doc change.** A documented rule that a card disagrees with is a row, not an edit.

## The three follow-ups, reported unfixed, each with its measurement

| # | finding | measurement |
|---|---|---|
| **a** | the engine and the renderer disagree about what a road is: `roadNetworkTiles` reads **routes**, the renderer draws **segments** | `roadNetworkTiles` hands **4** hexes to `GameMap.setRoadTiles` while a drawn segment touches **2**; `(8,7)` and `(8,8)` are **roaded-but-not-drawn**, so an unstaffed district's hex costs `0.75x` terrain with no road on screen. The docs' own sentence — "entering a hex a road crosses costs `ROAD_MOVEMENT_MULTIPLIER`" — does not hold for those hexes. 0.51.1 is what put this on the client's own screen for the first time (pre-0.51.1 the client's row was `undefined` → 20 tracks → drawn, so its own price and its own art agreed) |
| **b** | the docs promise a harbour's pier is "drawn in the same two-tone hairline as every land road", and that a strait is "crossed through its shipyard … rather than left silent" | a harbour route is skipped by the same `roads <= 0` guard, so a 0-workforce harbour draws **no pier** and the strait **is** left silent. The engine-level harbour test passes only because its fixture uses the auto crew (`workers` absent) |
| **c** | a classic L1 town's worker pool is exactly 1 | of three districts a player can light exactly one; the second `AssignWorkers` answers `409 pool_exhausted`. Measured on the running settlement, both sides |

## The changeset

| file | what |
|---|---|
| `test/visualRegression.test.ts` | +66 comment lines on the `district-map` scene: the four-state attribution table, the cluster-to-leg mapping, the mechanism, the "it is intended" record, and the three follow-ups |
| `analysis/2026-11-07-district-map-road-leg-attribution.md` | this report |
| `package.json` / `CHANGELOG.md` | the version, per the card's "one PR above 0.53.18" |

No `src/`, `packages/` or `server/` file is touched, and **no baseline PNG is touched**:
`git status --short test/visual-baselines/` is empty and every baseline is byte-identical to
`github/main`. The suite change is provably comment-only —
`git diff -U0 -- '*.ts' | grep -E '^[+-]' | grep -vE '^(^\+\+\+|---)' | grep -vE '^[+-]\s*//' | grep
-vE '^[+-]\s*$'` prints **nothing**.

## Gate

Run on this worktree's private database (`game_poc_wtgui_measure_first_a_grown_se_f01311`) with the PG
block exported in the same command, on the **rebased** tree (`f897c16`, `0.53.22`):

- `npm run build` ✓ (925 modules transformed)
- `npm run lint:deps` ✓ (no violations, 547 modules, 1,841 dependencies)
- `npm run test:types` ✓ (application clean, 0 errors; test tree 296/296, no regressions)
- `node tools/docs-check.mjs --changed-from github/main` ✓ (20 maintained docs, 221 local links, 567 source paths)
- `npm run test:unit` ✓ **3,035/3,035**
- `npm run test:visual` ✓ **13/13**, `district-map` at **1,455 px = 0.142 %** (under the 5,120 px budget)
  and **not re-cut**; the only other non-zero scene is `adventure-overview` at 8 px, the toolbar glyph
  instrument

The whole lot was re-run after the rebase — a green pre-rebase tree proves nothing about the merged one.

## Version

**`0.53.21` → `0.53.22`** (patch). The card asks for a version above `0.53.18`; AGENTS.md's own
carve-out puts tests and docs **outside** the bump ("tests, tooling and docs never bump"), so the bump
is taken **because the card asks for one**, not because the changeset needs it — stated here rather than
left silent, since the precedent (the sibling re-cut PR `0.53.18`) bumped for the same reason. The bump
was re-taken three times as main moved under the branch (`0.53.19` → `0.53.20` → `0.53.21` →
`0.53.22`), each time by re-running `scripts/bump-version.mjs` and re-splicing this entry's block under
the new heading.

## Deliverables

- **The evidence page** —
  `C:\ProjectDevelopment\heroes-js\.agentboard\settlers-reports\wtgui-measure-first-a-grown-settle-b1e3f9-regions.html`
  — every measured frame cropped to the road region with the four clusters drawn on HEAD, plus the
  attribution, cluster, mechanism and follow-up tables.
- The scene's own note in `test/visualRegression.test.ts` (the record that lands on main).

## Landed

(filled in after the merge)
