# Construction build crews — the analysis (stage 2 of 4)

<!-- Status: ANALYSIS ONLY. This is the hostile review of `docs/construction-build-crews.md` (stage 1).
     No engine change, no UI change, no schema change, no test. Stage 3 implements against the design
     *as amended by this file*; stage 4 verifies. Where this file and the design disagree, this file
     states why and what the reader paid for it. -->

**Branch:** `wtgui/stage-1-of-4-re-issued-d-3a7e42` (worktree
`.worktrees/stage-1-of-4-re-issued-d-3a7e42`), the branch of PR **#350** — this companion file is
committed onto it so the PR carries both the design and its critique.
**Reviewed revision:** `fc0e587`. The engine and docs at `fc0e587` are **byte-identical** to the design's
stated `0e356c4` (`git diff --stat 0e356c4..fc0e587` is the design file alone), so every line number
below is the line the design itself cites.
**Method:** every claim was checked against the function that computes it, not against a summary line —
`buildingRegistry.ts`'s `maxWorkers`/`buildDays` fields (parsed out of the registry, all 44 kinds),
`workforce.ts`'s `effortFraction`/`workforcePool`/`staffingBase`/`canAssignWorkers`,
`advance.ts`'s `stepBuilding`, `round.ts`'s `advanceRound`, and the client seams named in §7 of the
design. Arithmetic was re-derived from the re-read source; it was not copied from the design.

## 0. How to read this

The design is, on the whole, **numerically honest** — unusually so. This file found **no second
clamp-blind rate error** of the kind stage 1 already corrected (the 2.33× that is really 2.00× because
`workforce.ts:41` clamps `workers / buildingMaxWorkers` at 1). Every per-kind count, every whole-day
cell and every "today" rate in §4.1/§4.2/§4.3/§5/§8 reproduces exactly against the registry and the
decrement. What the design gets wrong is of three narrower kinds, listed in three sections:

- **N — a number that disagrees with the engine.** Five findings. One is a row no kind can reach; the
  rest are claims that read as engine facts but are not.
- **S — a decision written as a slogan instead of arithmetic.** Seven findings, the design's own
  §11.2-2 "untouched building builds in exactly the same time" first, as the worked example of the class.
- **I — an implementation step that cannot be done as written.** Eleven findings: a constant naming a
  function that does not exist, a call site the design does not own, and a gate that will fight the
  design's own acceptance test.

Each finding carries a one-line counter-proposal and its cost. **Nothing here reopens stage 1's scope
decisions** (§6 restates them so no one mistakes a critique for a reopening).

---

## 1. N — numbers that disagree with the engine

### N1. §4.3(c)'s slot-day row for `buildDays: 2` cannot be reached by any kind.
The table "Slot-days for one site, at the kind's cap today vs 4 builders under the premise" gives
`buildDays 2 → 3 vs 8 slot-days (2.67×)` and `4 → 6 vs 12 (2.00×)` and `5 → 9 vs 16 (1.78×)`. All three
baseline figures are a **cap-3 kind's** (9 = 3 turns × 3, 6 = 2 × 3, 3 = 1 × 3). But there is **no
cap-3 kind with `buildDays: 2`**: the six 2-day kinds are `house` (cap 1) and
`farmField`/`farmhouse`/`crypt`/`delversHall`/`seedlingGrove` (cap 2) — `buildingRegistry.ts:96`, `:239`,
`:253`, `:463`, `:712`, `:767`. The real figures for that class: cap 2 → **2 vs 8 slot-days (4.00×)**;
cap 1 (`house`) → **1 vs 8 (8.00×)**. The row understates the cost by 1.5×–3×, and it is the row the
reader's eye lands on because a house is the most common build in the game.
*Counter:* restate the row for the real caps (2 vs 8 for a cap-2 2-day kind), or label every row
"illustrative, cap-3 kind" and add the house's own line.
*Cost:* one sentence; the "construction costs more labour" conclusion gets **stronger**, not weaker.

### N2. §4.3(c)'s baseline column ("at the kind's cap today") is not one number.
The same table's baseline is kind-dependent inside each `buildDays` class: the 5-day class is cap 2
(`apartment`/`bank`/`treasury`), cap 3 (`shipyard`) and cap 4 (`barracks`/`wraithBarrows`/`forgeHall`);
the 4-day class is cap 2 (`tower`/`smithy`), cap 3 (`mine`/`stoneMine`/`ironMine`/`goldMine`/`arcaneFont`)
and cap 4 (seven kinds). "9 slot-days" is the shipyard's alone. Presented as one row per `buildDays`, the
baseline silently picks the cap-3 kind in each class.
*Counter:* either name the kind each row measures, or give the class as a low/high pair.
*Cost:* one table column; no conclusion moves.

### N3. §4.3(a)'s "the fastest possible build is now 2 day ticks" contradicts §5.a.
§5.a establishes that `townHall` is the one `buildDays: 0` kind (`buildingRegistry.ts:60`) and that a
0-day site completes on the first tick whatever the rate, because `advance.ts:127`'s `daysRemaining > 0`
test is false when `daysRemaining` is already 0. So the fastest build in the registry is **one tick**,
not two. The 2-tick floor is a property of `buildDays ≥ 2`.
*Counter:* "the fastest *non-instant* build".
*Cost:* nil.

### N4. §5.e-3 states a gate exists that does not.
"**Its placement planners (`pickHeroArmyBuildings` and the others) gate on `pool - assigned >= 1` for that
settlement**." There is exactly **one** AI placement planner, `pickHeroArmyBuildings`
(`packages/engine/src/ai/aiBrain.ts:418`), and it gates on `heroArmyDeficit`, `recruitCapacityPower`,
`GARRISON_GOLD_RESERVE` and warehouse stock (`aiBrain.ts:443-447`). It **never reads the settlement's
worker pool** — `workforcePool`/`assignedWorkersExplicit` are not imported into `aiBrain.ts` at all
(grep at `fc0e587`). So the design describes a requirement as an existing property. The consequence is
material: stage 3 could "leave the gate alone" and ship an AI that places sites it can never staff, which
is the exact failure §5.e-3 exists to prevent.
*Counter:* state it as **new** code — import `workforcePool`/`assignedWorkersExplicit`, compute
`pool - assigned`, add the gate to `pickHeroArmyBuildings`, and keep the gold/stock gates it already has.
*Cost:* the plumbing is new, not a change; ~10 lines in `aiBrain.ts`, and it is now in the card's scope
where before it looked free.

### N5. §3's "a site already spends slots today" is true only for an explicit crew.
`assignedWorkersExplicit` (`workforce.ts:65-76`) sums `b.workers` **only when it is not `undefined`**, so
an auto-crewed site (`workers === undefined`) spends nothing. Today a site is pool-charged only if it
carries an explicit count — which is the `0` row of `placeBuildings.ts:141`, i.e. it spends 0. The design
leans on the sentence to argue that `AssignWorkers` needs no new pool concept (§3, §5.c); it does not,
but the sentence as written is false for the auto crew.
*Counter:* "a site with an explicit crew spends slots; an auto-crewed site spends none" — which is also
what §5.e's table already says.
*Cost:* nil.

**Not found, and worth recording as found absent:** no unclamped `workers / cap` ratio survives anywhere
in the document. §4.1's "2.00× at every kind's cap", §4.2's two curves, §4.3(a)/(b)'s whole-day tables,
§4.3(c)'s pool column (`floor(pop/300)` = 1 / 5 / 16 / 266), §5.b's `2.6667`-after-a-tick and
`4 → 2.6 → 1.2 → done`, and §8's eyrie worked example (`6 → 4.4 → 2.8 → 1.2 → done` at 1.60×, four ticks
against three today) all re-derive **exactly**. The kind census is exact too: 44 kinds, caps **1/12/13/18**,
`buildDays` **0/6/6/14/7/10** — all five design figures match the parsed registry to the kind.

---

## 2. S — decisions written as a slogan rather than as arithmetic

### S1. The worked example: "an untouched building builds in exactly the same time as before."
Stated in §5.g ("It cannot be 'exactly the same time as it builds today'") and parked as open question
§11.2-2. Today the auto crew's rate is **2.00×** — `effortFraction` returns **1** for `workers ===
undefined` (`workforce.ts:42`), and the decrement is `1 + effortFraction` (`advance.ts:125`) — while the
new curve's top is **1.60×**. The two numbers are in the source, ten lines apart, and they cannot be made
equal by any wording: an untouched 4-day site goes 2→3 ticks, a 2-day site 1→2. This is the design's own
statement, so its own §5.g *is* the arithmetic; the slogan is the sentence that promises the invariant
anyway.
*Counter:* delete the invariant sentence from §5.g/§11.2-2 and keep only what the design can prove —
"an untouched site follows the **4-builder / 1.60×** path, never the 0-builder path; its build time
lengthens on 2-, 4-, 5- and 6-day builds." That is exactly §8's #21 test, and it is the honest form.
*Cost:* nil — the words are already in the document; the slogan is what should go.

### S2. The premise's own definition: "1 builder = 1.0× the current default build rate."
Reader's sentence (verbatim in §"The ask") + premise item 2. There is **no single "current default"** in
the engine: a placement in a bootstrap settlement is `undefined` → auto crew → **2.00×**
(`workforce.ts:42`), and a placement anywhere else is `0` → **1.00×** (`placeBuildings.ts:141` +
`advance.ts:125`). The design defines "1.0×" as the idle site's rate (§1) and then reports it as if it
were the reader's own word. It is not; it is the design's pick, and it is the pick that **creates the
entire nerf** S1 worries about.
*Counter:* say it plainly — "1 builder = the **explicit-0** site's 1.00×, *not* the auto crew's 2.00×;
that choice is what makes an untouched site slower."
*Cost:* nil, and it converts S1 from a surprise into a stated premise.

### S3. §5.e: "an AI building site must never stall by construction."
A policy goal with no arithmetic behind it. Its own mechanism does not exist (N4), and even with it, a
seat whose pool falls to 0 after a placement keeps a dark site — which is the human's rule too.
*Counter:* "AI placements are staffed at placement time when the pool allows; a site starved afterwards
stalls exactly as the human's does."
*Cost:* nil.

### S4. §3 / §9-3: "the crew that built it runs it."
Narrative offered as the reason the trim is to-cap rather than to-zero. It is a good narrative and it is
doing real work (it is what forbids `workers = 0`), but it is not arithmetic and should not be read as
one.
*Counter:* keep the rule; label the sentence as the narrative it is.
*Cost:* nil.

### S5. §6: "the pool's vocabulary does not change."
A UX decision dressed as a constraint. Its arithmetic consequence is that one panel prints `n / 4` for a
site and `n / 1` (house) for the same kind finished, under one word ("Workers", "Auto (max)").
*Counter:* keep the decision, but make the two ceilings explicit in §6's vocabulary so the panel is not
read as inconsistent when a house's number moves from 4 to 1 on completion.
*Cost:* nil.

### S6. §5.c: "no site gets a discount."
Pure decision, correctly recorded as one — but it is stated in the same breath as a claim ("the crew
**is** spent from the pool") whose auto-crew exception is N5.
*Counter:* split the decision from the fact.
*Cost:* nil.

### S7. §5.h: "a district full of sites reads a wider road — which is honest (the people really are there)."
"Honest" is doing the work of an argument here. The arithmetic effect is real (a site's 4 builders raise
`districtWorkforcePercent`'s numerator *and* its denominator, `roadNetwork.ts:88-97`), but what it means
is that the district road is a **workforce** display, not a **production** display — it will widen for
builders who produce nothing.
*Counter:* state the effect and hand the reader the fork (road width tracks crews, or tracks production);
do not settle it with the word "honest".
*Cost:* one sentence; it is a genuine reader fork, so it belongs in §11.2 rather than in §5.h.

---

## 3. I — implementation steps that cannot be done as written

### I1. §7-5: `rolesFor` receives a **kind**, not a building.
"the new `\"building\"` site role … chosen by `rolesFor` when `construction` is set". The function is
`private rolesFor(kind: BuildingKind): WorkforceBuildingRole[]` (`cityView.ts:708`) and its one caller is
`this.rolesFor(b.kind)` (`cityView.ts:727`). A kind cannot tell you whether *this* site is under
construction, so the step as written is impossible.
*Counter:* change the signature to `rolesFor(b: BuildingDef)` and pass `b`; add the
`construction` branch there.
*Cost:* one signature plus one call site — small, but it is a signature change the design does not admit
it needs.

### I2. §7-11 / §5.e-3: the AI gate does not exist (see N4).
`pickHeroArmyBuildings` (`aiBrain.ts:418`) never reads the pool, and there are no "other" planners in
`aiBrain.ts` — `pickAiMove` (`aiBrain.ts:774`) is hero movement. The driver issues **no** `AssignWorkers`
anywhere (`server/app/aiDriver.ts` contains only the `PlaceBuildings` dispatch at `:933`).
*Counter:* item 11 is **new work with a new call site**, not a change to an existing gate: import
`workforcePool`/`assignedWorkersExplicit`, add the idle-slot gate to the planner, and add the
`AssignWorkers` dispatch to the driver.
*Cost:* the largest item in stage 3's card, correctly, but the design currently undersizes it by
describing half of it as already present.

### I3. §6 ("no change to the drag gesture") is false — the client drag owns its own maxima.
The drag pickup and drop paths compute `buildingMaxWorkers` **independently of the panel and the
reducer**: `cityView.ts:907` (`buildingMaxWorkers(hit.building.kind) < 1` — pickup refused), `:908`
(`max`), `:910` (`hit.building.workers ?? max` — the pickup base of an auto site), `:976`
(`targetMax`), `:978` (`if (nextTarget > targetMax) return` — the drop refused), `:987` (`sourceMax`).
Left alone, a drag can **never** place the 2nd–4th builder on a site (`nextTarget > kindMax`), and an
auto site's pickup base is the kind cap, not 4. §7-5 names `cityView.ts:68/708/717-718` and stops; none
of these six lines is in the plan.
*Counter:* route all six through `staffingCeiling`/`buildersOnSite`, and delete the "no change to the
drag gesture" sentence from §6.
*Cost:* ~6 mechanical edits — but the design has explicitly told stage 3 not to make them, so the
default outcome is a broken drag that no unit test in §8 would catch (the checklist tests the reducer and
the panel, not the canvas gesture).

### I4. §8-23's "no bare 4" test would fail on §6-6's own expression.
#23 asks for "a source test (or lint) that no other file writes a bare `4` as a construction crew
limit", while §6-6 writes the scene count as `min(buildersOnSite(b), 4)` — a bare `4`, and one that
already exists today at `cityScene.ts:206`. The gate §7-13 asks stage 3 to add would fail on code §7-10
asks stage 3 to write.
*Counter:* write it `min(buildersOnSite(b), CONSTRUCTION_MAX_BUILDERS)` — `buildersOnSite` already
clamps to the ceiling, so the outer `min` can also simply go.
*Cost:* nil.

### I5. §7-3: none of the four workforce functions reads a kind, so "read the same ceiling" is a call-site
change the design does not enumerate.
`staffingBase(workers, max, legacy)` (`workforce.ts:94`) and `canAssignWorkers(current, max, delta, pool,
assigned)` (`workforce.ts:139`) take `max` **from the caller**; `autoStaffedSlots` (`:49`, `:51`) and
`assignedWorkersExplicit` (`:68`, `:72`) use `buildingMaxWorkers`/the raw count. The callers that must
move to `staffingCeiling` and are named nowhere in §7: `buildingMenu.ts:462` (the stepper `max`), `:522`,
`:527`, `:541`, `:549`; `workforcePanel.ts:229`, `:236` (fed by `snapshotEntry`'s `max`,
`cityView.ts:718` — which §7-5 does name); `cityView.ts:976`, `:978`, `:987` (I3);
`recruitmentPanelModel.ts:199`, `:213` (sets `maxWorkers`), `:302`, `:310`, `:334` (reads it).
*Counter:* reword item 3 as an explicit call-site list; any one left behind ships a second ceiling.
*Cost:* mechanical, but enumerable — and the recruitment panel's `maxWorkers` is a site-blindness the
design never mentions.

### I6. §7-2: "the surplus returns to the pool" describes a write that does not happen.
`stepBuilding` (`advance.ts:118-130`) maps **one** building and returns it; the pool is **derived**
(`workforcePool`, `workforce.ts:28`) and idle workers are implicit (`pool − assigned`, printed at
`settlementInfoMenu.ts:549`). There is no pool object to add to. The trim is therefore: in the
completion branch (`advance.ts:128`, where the def is rebuilt without `construction`), also set
`workers` — `b.workers === undefined ? undefined : Math.min(b.workers, buildingMaxWorkers(b.kind))`.
Everything else in §3's trim paragraph is commentary on that one expression.
*Counter:* state the trim as that expression and drop the "returns to the pool / before any other system
reads the crew" framing (which reads as if a pool write exists).
*Cost:* nil — and it keeps §8-22's "lossless" test honest, because the only thing that can be
"released" is a lower integer.

### I7. §7-12: the doc-ownership citation is truncated.
`DOC_OWNERSHIP["docs/settlements.md"]` is not `packages/engine/src/settlement/**` alone; it is
`packages/engine/src/settlement/**`, `packages/engine/src/turn/**`, `server/migrations/**`,
`server/persistence/**`, `src/entities/**`, `src/game/**`, `src/io/**` (`tools/docs-check.mjs:82-90`).
The gate fires for the right reason; the citation would mislead stage 3 into thinking *only* settlement
edits trigger it.
*Counter:* cite the mapping in full.
*Cost:* nil.

### I8. §7-1/§2-6/§2-12/§5.c cite three files at paths that do not exist.
`income.ts` is `packages/engine/src/economy/income.ts`; `settlementRates.ts` is
`packages/engine/src/economy/settlementRates.ts`; `buildingPlacer.ts` is
`src/screens/settlements/cityView/buildingPlacer.ts`. `packages/engine/src/settlement/income.ts` does
**not** exist. The `:40/:46/:86/:92`, `:7` and `:159` line numbers are correct *within* the real files.
*Counter:* give each a full path once.
*Cost:* nil.

### I9. §7-9: `buildTimeLine(kind)` has an import set that does not include the new constants.
`buildEntryStatus.ts:2` imports only `buildingBuildDays, buildingPlacementCost, buildingUpkeep` from
`@heroes/engine`; §6-5's "read the `1.60×` from `BUILD_RATE_PER_EXTRA_BUILDER`/`CONSTRUCTION_MAX_BUILDERS`,
never typed twice" adds an import to a client module and means the string is built from
`buildRate(CONSTRUCTION_MAX_BUILDERS)`, not a literal.
*Counter:* note the import addition; keep the derived string.
*Cost:* nil.

### I10. §7-11's "the AI's own placement/building step" is one function, and it is not the driver.
The planner lives in `packages/engine/src/ai/aiBrain.ts` (engine), while the `PlaceBuildings` dispatch
lives in `server/app/aiDriver.ts:933`. §5.e-5 says "where the assignment is decided (the AI's own
placement/building step)" as if it were one seam; it is two files in two packages, and the
`AssignWorkers` dispatch has to be added at the driver while the idle-slot gate has to be added at the
planner.
*Counter:* name both seams.
*Cost:* nil.

### I11. §7-6's union addition is safe, but only because the exhaustive map is single.
Adding `"building"` to `WorkforceBuildingRole` (`cityView.ts:68`) forces exactly one exhaustive
consumer to gain the key: `ROLE_LABELS: Record<WorkforceBuildingRole, string>` (`workforcePanel.ts:14`).
Verified by grep at `fc0e587` — there is no second `Record<WorkforceBuildingRole, …>` and no `switch`
over the union. Recorded so stage 4 does not read a green build as evidence the union was handled.
*Counter:* none — the design is right here; this is the check, not a defect.
*Cost:* nil.

---

## 4. Counter-proposals at a glance

| # | Finding | Counter-proposal | Cost |
|---|---|---|---|
| N1 | 2-day slot-day row uses a cap-3 kind that does not exist | Use the real caps (cap 2 → 2 vs 8; house → 1 vs 8) | one sentence; conclusion strengthens |
| N2 | "at the kind's cap today" is not one number | Name the measured kind or give a low/high pair | one column |
| N3 | "fastest build is now 2 ticks" | "fastest *non-instant* build" | nil |
| N4 | AI pool gate asserted to exist | State it as new code (import pool helpers, add the gate) | ~10 lines, newly in scope |
| N5 | "a site already spends slots today" | "an explicit crew spends slots; an auto-crewed site spends none" | nil |
| S1 | "untouched builds in the same time" | Keep only the provable form: free 4-builder/1.60× path, slower on 2/4/5/6-day | nil (delete the slogan) |
| S2 | "1 builder = the current default" | Say "the explicit-0 1.00×, not the auto crew's 2.00×" | nil |
| S3 | "an AI site must never stall" | "staffed at placement when the pool allows; stalls as the human's does" | nil |
| S4 | "the crew that built it runs it" | Keep the rule, label the sentence narrative | nil |
| S5 | "the pool's vocabulary does not change" | Keep, but state both ceilings in the panel's words | nil |
| S6 | "no site gets a discount" | Split the decision from the pool fact (N5) | nil |
| S7 | "which is honest" | State the effect; make road-width a §11.2 reader fork | one sentence |
| I1 | `rolesFor` gets a kind | `rolesFor(b: BuildingDef)`; pass `b` | signature + 1 call site |
| I2 | AI gate/AssignWorkers do not exist | New code, not a change (see N4, I10) | largest item; correctly so |
| I3 | "no change to the drag gesture" is false | Route `cityView.ts:907/908/910/976/978/987` through the ceiling; delete the sentence | ~6 edits |
| I4 | #23's test fails on §6-6's bare `4` | Use `CONSTRUCTION_MAX_BUILDERS` | nil |
| I5 | four workforce helpers read no kind | Reword item 3 as the call-site list (11 sites) | mechanical |
| I6 | trim "returns to the pool" | State the trim as one `workers` assignment in the completion branch | nil |
| I7 | ownership citation truncated | Cite the full `DOC_OWNERSHIP` entry | nil |
| I8 | three bare-path citations | Full paths for `income.ts`, `settlementRates.ts`, `buildingPlacer.ts` | nil |
| I9 | `buildTimeLine` import set | Note the added import | nil |
| I10 | "the AI's placement step" is two seams | Name `aiBrain.ts` and `aiDriver.ts` separately | nil |
| I11 | union addition | (design is right; recorded as checked) | nil |

**Net cost of the critique:** one table row rewritten, one AI gate re-scoped from "keep" to "build", one
canvas gesture moved from "untouched" to "edited", one signature changed, and a set of wording fixes.
**No finding changes the mechanic, the curve, the ceiling, the trim, the pool model or the scope.**

---

## 5. What the design got RIGHT and must not be changed while the rest is edited

These were re-derived independently and are correct. Stage 3 must carry them through untouched; a later
edit that "simplifies" any of them is a regression, not a cleanup.

1. **The engine rule is genuinely one expression and one ceiling.** `advance.ts:125` is the only
   decrement and `round.ts:93` is its only caller (verified by grep: `advanceBuildingConstructions` is
   called from `round.ts` and tests only). The claim "one function replacing one expression" is true.
2. **The 2.00× today-figure is right and must stay 2.00×.** `workforce.ts:41` clamps at 1, so no crew
   exceeds 2.00×, and `effortFraction` returns 1 for `undefined` (`:42`). Stage 1's corrected figure is
   the correct one; do not "restore" a 2.33×.
3. **The kind census is exact.** 44 kinds; caps **1** (`house`), **12**, **13**, **18**; `buildDays`
   **0** (1), **2** (6), **3** (6), **4** (14), **5** (7), **6** (10); no `buildDays: 1` and no
   `buildDays: 7`. The named examples in §3 and §4.2 are the right kinds.
4. **§4.1's today-curve table is exact** (1.000 / 1.5 / 1.667 / … / 2.000, and 2.00× at every kind's own
   cap), and **§4.2's two curves and whole-day tables are exact**, including the claim that additive and
   compounding differ in **exactly one cell** (5-day, 4 builders: 4 vs 3) and both give 5 at a
   hypothetical 7-day build.
5. **§4.3(a)'s verdicts are exact**: four of the five classes take longer at the new maximum than
   today's full crew, and the 3-day class only matches; the nerf is real at crew 1 as well (1.333× →
   1.000× on a cap-3 kind).
6. **§4.3(b)'s lumpy table is exact**, including "the 3rd builder is worth nothing on a 6-day build" and
   "the 2nd worker is already worth nothing today on a 4-day cap-3 build" (4/3/3/2).
7. **§5.a is exact and must be kept**: a 0-day site completes on the first tick with zero builders
   (`advance.ts:127`), and `buildingConstructionProgress` divides by zero for a `townHall` →
   `NaN` → `constructionStageFor` stage 1 (`construction.ts:35-37`, `:29-33`). Leaving both alone is
   right; both are pre-existing and neither is this feature's bug.
8. **§5.b's fraction arithmetic is exact**: a goldMine with 1 of 3 workers reads **2.6667** after a tick
   (4 − 1.3333), and a 4-day site with 3 builders goes **4 → 2.6 → 1.2 → done** with the 0.2 overshoot
   discarded; the menu does print the raw float (`cityView.ts:613` passes `construction?.daysRemaining`
   straight to `buildingMenu.ts:273`).
9. **All five "a site does nothing else" citations are exact** — `producers.ts:107`,
   `income.ts:40/46/86/92`, `draftRecharge.ts:8`, `recruitUnits.ts:174` — and so is the upgrade
   exclusion (`workforce.ts:118`, `WORKFORCE_UPGRADE_ACCEL_KINDS`, `buildingRegistry.ts:943`).
10. **The AI diagnosis in §5.e is correct**: an AI seat's level-2/3 settlement is never a bootstrap
    (`districtSeed.ts` seeds 1 district at tier 2 and 2 at tier 3, and `newPlacementsAutoCrew` requires
    *no* districts, `workforce.ts:109-111`), so every AI placement is the `0` row and, under
    `buildRate(0) = 0`, freezes. `aiDriver.ts:933` issues `PlaceBuildings` with `{kind, gx, gy, level}`
    and no `workers`, and issues no `AssignWorkers`.
11. **The trim must be a decrement and needs no new rejection path.** `staffWorkers.ts:150` gates on
    increments only, so lowering `workers` is always allowed; §3's claim is correct and §8-22's
    "lossless" property follows.
12. **The UI seams and their line numbers are real**: `buildingMenu.ts:267/273/462/523`,
    `buildEntryStatus.ts:146` (with the exact today-string and the `days <= 0 → ""` rule),
    `workforcePanel.ts:14` (`ROLE_LABELS`), `cityView.ts:68/708/717-718`, `settlementInfoMenu.ts:549`
    (both forms, byte for byte), `cityScene.ts:205-206`. The `×` is U+00D7 and the menu already uses it
    (`buildingMenu.ts:253`).
13. **The settlement/panel strings the design quotes are each surface-correct** — the settlement panel's
    `auto crew · N bldgs (M slots), pool P` and the workforce panel's own
    `Workers: auto crew on N buildings (M slots) · pool P` are different sentences on different
    surfaces, and the design quotes each where it belongs.
14. **No schema change, no new command and no new field are needed.** `BuildingDef.workers` is already
    nullable (`packages/contracts/src/buildings.ts`), already rides migration `030`, and carries both
    meanings the design gives it.
15. **The trim-on-completion-not-walk-off decision, the "no discount" decision, the "no new rejection
    reason" decision, the six-surface UI plan and the additive curve are all correct as decisions** —
    critique S1–S7 is about wording, not about any of them being wrong.

---

## 6. Scope this analysis does not reopen

Stage 1's decisions stand and are out of bounds here (restated only so this file is not misread):

- **Upgrades are out of scope.** `advanceSettlementUpgrades` keeps its own accel curve; the fork stays
  with the reader (§11.2-1).
- **Any building takes up to 4 builders while under construction**, whatever its kind, trimmed to the
  kind's operational cap on completion.
- **The construction cap raises no operational capacity.**
- **The curve is additive** (`1 + 0.2 × (builders − 1)`); the compounding fork is settled and not to be
  re-asked.
- **The AI crews from its own pool under the human's rule, with no carve-out** (the *work* to do so is
  larger than the design implies — I2/N4/I10 — but the decision itself is not questioned).
- **PR #350 is not to be landed by stage 2.** This file is a companion, not a landing.

---

## 7. What stage 3 must therefore build, that §7 of the design does not say

A short, additive list — everything else in the design's §7 stands:

- `cityView.ts:708` — `rolesFor` takes the building, not the kind (I1).
- `cityView.ts:907/908/910/976/978/987` — the canvas drag's own maxima (I3).
- `recruitmentPanelModel.ts:199/213/302/310/334` — the recruitment panel's `maxWorkers` (I5).
- `aiBrain.ts:418` — the idle-slot gate, as **new** code (N4/I2).
- `aiDriver.ts:933` — the `AssignWorkers` dispatch for the AI, as **new** code (I2/I10).
- `cityScene.ts:206` — the outer `4` becomes the constant or is dropped (I4).
- `docs/settlements.md` — the two lines, plus the marker; and the doc's own "Construction sites" sentence
  (`:238`) plus the per-kind caps sentence (`:239`) are the right targets.
