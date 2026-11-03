# Construction build crews — population builds, the design

<!-- Status: DESIGN ONLY. This file is the whole deliverable of stage 1 of 4: no engine change, no UI
     change, no schema change, no test. Stage 3 implements exactly this; stage 2 critiques it. -->

**Branch:** `wtgui/stage-1-of-4-re-issued-d-3a7e42` (worktree
`.worktrees/stage-1-of-4-re-issued-d-3a7e42`), cut from `main` and fast-forwarded to `github/main`
**`0e356c4`** / `package.json` **0.48.1** — the revision every number in this document was measured on.
**Stage:** 1 of 4 (design). Stage 2 reviews it, stage 3 implements it, stage 4 verifies it.
**Nothing in this file is code.** Where a change is named, it is named as *what the implementation card
must do*, with the `file:line` that carries it today.

## The ask, in the reader's words

> we need to have population working on a building to make progress on it — 1 = the current default
> build rate, but each additional worker makes it 20% faster, up to 4 people building it.

## The premise this document designs to (LOCKED — the reader's own answer; the reader may overrule it)

1. **No workers = no progress.** A site with zero builders does not advance, ever.
2. **1 builder = 1.0× the current default build rate.**
3. **Each extra builder is +20%, ADDITIVE**: 1.00 / 1.20 / 1.40 / 1.60.
4. **Hard cap 4 builders** on a site.

The unit of "1.0×" is fixed precisely, because everything below is measured in it: **1.0× = one day of
the site's own `buildDays` per day tick**, i.e. the rate an idle site gets *today*
(`advance.ts:125`, `1 + effortFraction` with `effortFraction = 0`). So a building's `buildDays` field
now means **"day ticks at exactly one builder"**, and the number on the card is the number of End Turns
the site takes from one builder.

---

## 1. The rule

```
CONSTRUCTION_MAX_BUILDERS      = 4
BUILD_RATE_PER_EXTRA_BUILDER   = 0.2

buildRate(n) = n <= 0 ? 0 : 1 + BUILD_RATE_PER_EXTRA_BUILDER * (n - 1)     // n clamped to 0..4

staffingCeiling(b) = b.construction ? CONSTRUCTION_MAX_BUILDERS : buildingMaxWorkers(b.kind)
buildersOnSite(b)  = b.workers === undefined ? staffingCeiling(b)          // the auto crew, unchanged
                                             : min(max(b.workers, 0), staffingCeiling(b))

daily decrement = buildRate(buildersOnSite(b))      // replaces `1 + effortFraction(b)`
```

| builders | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| days per day tick | **0.00** | 1.00 | 1.20 | 1.40 | 1.60 |

That is the whole engine rule: **one function** replacing one expression at `advance.ts:125`, plus the
crew ceiling it reads. Everything else in this document is the consequences of those two lines, and
what the rest of the game must therefore do.

**No schema change, no new field, no new command.** `BuildingDef.workers` already exists (an integer,
nullable — migration `030_workforce.sql`, `NULL` = legacy auto-staffed) and a construction site already
carries a crew and is already charged for it against the settlement's worker pool. The feature needs the
existing field to mean one more thing; it does not need a second one.

---

## 2. Where it lands — the measured seams

Every line below was re-read at `0e356c4`; the citations are `grep -n` on the symbol, not copied from a
fragment.

| # | Seam | Today | This design |
|---|---|---|---|
| 1 | `advanceBuildingConstructions` — `packages/engine/src/settlement/advance.ts:115`, decrement at **`:125`** | `daysRemaining - (1 + effortFraction(b))` | `daysRemaining - buildRate(buildersOnSite(b))` |
| 2 | `advanceRound` day tick — `packages/engine/src/turn/round.ts:93` | calls (1) once per day tick, on the round wrap | unchanged; the one caller |
| 3 | Server authority — `server/app/turnService.ts` (`advanceRound` at `:75`) | the day tick is server-run on End Turn | unchanged; the client runs no construction pass of its own (`turnController.ts`'s local reducers are gone) |
| 4 | `buildingMaxWorkers` — `packages/engine/src/buildingRegistry.ts:945` | the one per-kind crew cap, read by production, pool accounting, the reducer, the panel and the stepper | becomes the **production** cap; the new `staffingCeiling` (4) is the cap for a site under construction |
| 5 | `assignWorkers` validation — `packages/engine/src/settlement/staffWorkers.ts:122`, `:124`, `:135` | rejects `workers > buildingMaxWorkers(kind)`; the drag path checks `destinationWorkers > maxWorkers` | validates against `staffingCeiling(b)`; **no new rejection reason** |
| 6 | Pool accounting — `workforce.ts:47` (`autoStaffedSlots`), `:65` (`assignedWorkersExplicit`), `:94` (`staffingBase`), `:139` (`canAssignWorkers`) | counts/spends against `buildingMaxWorkers` | counts/spends against `staffingCeiling` — a site's 4 builders are 4 pool slots (a site already spends slots today) |
| 7 | Auto crew — `workforce.ts:109` (`newPlacementsAutoCrew`), `placeBuildings.ts:141` | a new placement in a bootstrap settlement gets `workers: undefined` (auto, free, full effort); in a settlement with any explicit count or any district it gets `0` | unchanged rules; what changes is what `undefined` **is worth** on a site: a free full crew = `staffingCeiling` = 4 builders = 1.60× |
| 8 | Placement timer — `placeBuildings.ts:85`, `buildingPlacer.ts:159` | `{ daysRemaining: buildingBuildDays(kind) }` for a new placement | unchanged |
| 9 | Site progress — `packages/engine/src/settlement/construction.ts:35` | `1 - daysRemaining / buildingBuildDays(kind)` | unchanged (already fractional, already clamped) |
| 10 | Site art stage — `construction.ts:29` (`constructionStageFor`) | wood pile `< 0.05`, scaffold `>= 0.05`, near-complete `>= 0.75` | unchanged; the wood pile is what a stalled site shows forever |
| 11 | Site sprites — `src/render/scene/sceneBuilder/cityScene.ts:205-206` | `if (b.construction) continue;` then `count = min(b.workers ?? buildingMaxWorkers(kind), 4)` | **drop the skip** and read `min(buildersOnSite(b), 4)` — the `4` cap in this expression is already the precedent the premise's cap matches |
| 12 | Workforce panel — `src/screens/settlements/cityView/workforcePanel.ts:14` (`ROLE_LABELS`), `:81` (header) | a constructing building is tagged by its **finished** role (`Producer`, `Recruit`, …) while producing nothing (`producers.ts:107`, `income.ts:40`) | a site is tagged `Building`; the header's assigned/idle counts follow #6 |
| 13 | Building menu — `buildingMenu.ts:267` (row gate), `:273` (construction line), `:462` (stepper max) | `Under construction — N days remaining`; stepper `n / kindMax` | the construction line gains the crew and the rate; the stepper's cap is `staffingCeiling` |
| 14 | Build palette — `buildEntryStatus.ts:146` (`buildTimeLine`) | `Build time: 4 days — its upkeep is paid while it is under construction, and it produces nothing until it is finished` | states the crew dependence and the stall (§6) |
| 15 | District roads — `packages/engine/src/settlement/roadNetwork.ts:87` (`districtWorkforcePercent`) | district staffing share from `min(workers, buildingMaxWorkers)` | same ceiling function, so a crew on a site still counts toward the district's road width |
| 16 | Settlement panel — `src/screens/settlements/settlementInfoMenu.ts:549` | `assigned/pool assigned · N idle[ · over pool]` | gains the stall count (§6) |
| 17 | AI placements — `server/app/aiDriver.ts:933` | `PlaceBuildings` with `{kind, gx, gy, level}` and **no** `workers` field; the driver never issues `AssignWorkers` | must crew what it places (§5) — the largest new work this premise creates |

**What a site's crew means today, exactly:** it is the *only* thing in the game that reads a
constructing building's crew, and it buys `+workers/kindMax` days per tick. A site
- produces nothing — `producers.ts:107` returns `null` while `construction` is set;
- pays no gold — `income.ts:40`, `:46`, `:86`, `:92` skip a building under construction;
- refills no draft pool — `draftRecharge.ts:8` returns early while `construction` is set;
- recruits nothing — `recruitUnits.ts:174` refuses with `building_under_construction`;
- does not accelerate upgrades — `workforce.ts:118` reads only `WORKFORCE_UPGRADE_ACCEL_KINDS`
  (`townHall`, `mageGuild`).

So this card touches **one** behaviour of a site's crew (the decrement) and the crew's *ceiling*. Every
other rule about a site reads `construction`, not its crew, and none of them moves.

---

## 3. "Up to 4 builders" and the workforce machinery — one system, not two

The premise's "up to 4" is **not** a second crew system next to the existing workforce. It is the same
`BuildingDef.workers` integer, spent from the same `floor(population / 300)` pool
(`workforce.ts:26`, `:28`), written by the same `AssignWorkers` command
(`packages/contracts/src/commands/assignWorkers.ts`, reducer `staffWorkers.ts:115`), emitted as the
same `WorkersAssigned` event, shown by the same stepper, the same drag gesture and the same panel — and
drawn by the same person clusters, which already cap at 4 per building (`cityScene.ts:206`).

What the premise adds is **one distinction inside that system**: a building's crew cap depends on
whether it is finished.

- **Finished building** → `buildingMaxWorkers(kind)`, exactly today. A house holds 1, a goldMine 3, a
  barracks 4. Production, gold, draft recharge, upgrade acceleration and the pool reading are untouched.
- **Site under construction** → 4, whatever the kind. A house can be built by 4 people; so can a bank.

**Why the site ceiling and not the kind's cap** (the alternative, and why it loses): the per-kind caps
today, counted over the registry's 44 kinds at `0e356c4` (`buildingRegistry.ts:945`), are **1** (house),
**2** (12 kinds — including the 5-day `apartment`, `bank` and `treasury` and the 4-day `tower` and
`smithy`), **3** (13 kinds) and **4** (18 kinds). Under the kind's cap a house is **permanently 1.00×** —
it can never have a second builder — and the slowest, most expensive buildings in the game (`bank`,
`treasury`, `apartment` at 5 days; `tower`, `smithy` at 4) would be capped at 1.20×, so the buildings
where build time costs the player most would be exactly the ones the feature cannot speed up. That
inverts the reader's intent ("up to 4 people building it" is about the *job*, not the building's output
slots).

**When a site finishes, its crew is trimmed to the kind's production cap in the same tick** that clears
`construction`: `workers = min(workers, buildingMaxWorkers(kind))`. The surplus returns to the pool.
Without the trim, a finished house would sit at 4/1 workers — `effortFraction` clamps at 1 so nothing
reads the excess, but `assignedWorkersExplicit` would, so the pool would leak slots permanently. The
trim is a decrement, and decrements are always allowed (`staffWorkers.ts:150`'s gate is on increments
only), so no new rejection path exists. The alternative — the crew walks off entirely (`workers = 0`) —
is rejected in §9: it would silently unstaff every building the player rushed, turning a rush into two
chores (build it, then staff it) and hiding work the player already paid pool slots for.

---

## 4. Balance — what the premise does to today's numbers

### 4.1 Today's curve, measured

`effortFraction(b) = min(workers / buildingMaxWorkers(kind), 1)` (`workforce.ts:41`), `decrement = 1 +
effortFraction`, so **today, at the kind's own cap, every kind builds at exactly 2.00×** — a goldMine
at 3/3, a house at 1/1, a barracks at 4/4 all pay 2 days per tick:

| kind cap | 0 workers | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| 1 (house) | 1.000 | **2.000** | — | — | — |
| 2 | 1.000 | 1.500 | **2.000** | — | — |
| 3 (goldMine) | 1.000 | 1.333 | 1.667 | **2.000** | — |
| 4 (barracks, eyrie) | 1.000 | 1.250 | 1.500 | 1.750 | **2.000** |

Two facts follow, and both matter:

- **Zero workers already advances at 1×.** A site nobody staffed still finishes (slowly). The premise
  removes that floor — this is the intended new pressure ("no workers = no progress").
- **Today's ceiling is 2×, reached by every kind at its own cap.** The premise's ceiling is 1.60×, so
  **the premise nerfs the maximum rate by 20%.** It is not a buff for anyone.

### 4.2 The two candidate curves, whole-day outcomes

Crew `n` beyond the first is worth +0.20× additive or ×1.20 compounding:

| builders | 0 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| **additive** (premise) | 0.000 | 1.000 | 1.200 | 1.400 | 1.600 |
| compounding | 0.000 | 1.000 | 1.200 | 1.440 | 1.728 |

A site's outcome the player sees is the **whole number of day ticks** (`ceil(buildDays / rate)`;
`buildDays` values in the registry — `buildingRegistry.ts:17`, `:819` — are 0, 2, 3, 4, 5, 6):

| `buildDays` | today, the kind's full crew (2.00× at max 3, 2.33× at max 4) | additive 1b | additive 2b | additive 3b | additive 4b | compounding 4b |
|---|---|---|---|---|---|---|
| 2 (house, farmField, farmhouse, crypt, delversHall, seedlingGrove — 6 kinds) | **1** | 2 | 2 | 2 | 2 | 2 |
| 3 (market, granary, warehouse, huntingLodge, woodcutterHut, warrenLodge — 6 kinds) | **2** | 3 | 3 | 3 | 2 | 2 |
| 4 (tower, mines, smithy, stables, archeryRange, goldMine, … — 14 kinds) | **2** | 4 | 4 | 3 | 3 | 3 |
| 5 (barracks, apartment, bank, treasury, shipyard, wraithBarrows, forgeHall — 7 kinds) | **3** | 5 | 5 | 4 | 4 | 3 |
| 6 (mageGuild, eyrie, spireOfAsh, golemFoundry, worldrootGrove, dragonBoneyard, … — 10 kinds) | **3** | 6 | 5 | 5 | 4 | 4 |

Those five rows are the whole registry: **no kind carries `buildDays: 7`** (the widest live value is
6), so the brief's "buildDays 7" row is hypothetical — for completeness, additive and compounding both
give 5 turns there, which is the same reading the brief records.

**Where the two curves differ in whole days: exactly one cell** — a 5-day build at 4 builders (4 turns
additive, 3 compounding). The brief's own measurement reproduces: 5-day/4b additive 4 vs compounding 3,
and 6-day/4b 4 either way. The premise picks **additive**, and the design agrees with the premise on the
merits, not just on obedience:

- Additive keeps the reader's sentence true at **every** crew size ("each additional worker makes it
  20% faster" — the 4th builder is worth the same +0.20× as the 2nd). Compounding makes the 3rd and
  4th worth +0.24× and +0.29×, which is a different statement than the one made.
- Additive's value per extra builder is constant, so stacking all four on one site is not
  disproportionately better than spreading four builders over four sites — the compounding curve
  rewards concentration, which is exactly the "dump everyone on one building" degenerate play a
  village-style economy wants to avoid.
- 1.44 and 1.728 are numbers a player cannot hold in their head; 1.20/1.40/1.60 are the premise's own
  arithmetic, printed verbatim on the site line (§6).

### 4.3 The consequences, with numbers

**(a) Slower than today at every crew size, and slower than today's ceiling at the new maximum.**

| `buildDays` | today at the kind's full crew (2.00×/2.33×) | today at 1× (an idle site) | new at 4 builders (the best there is) | verdict at best |
|---|---|---|---|---|
| 2 | 1 turn | 2 | 2 | **2× slower** |
| 3 | 2 | 3 | 2 | equal |
| 4 | 2 | 4 | 3 | **+1 turn** |
| 5 | 3 | 5 | 4 | **+1 turn** |
| 6 | 3 | 6 | 4 | **+1 turn** |

**Four of the five build-day classes take longer at the new maximum crew than they take today with a
full crew**; the fifth (3-day builds) only matches it. Also, today's single builder on a max-3 kind is
1.333× while the premise's is 1.000× — **the nerf applies at crew 1 too**. And the minimum: with no
`buildDays: 1` kind in the registry and a 1.60× ceiling, **the fastest possible build is now 2 day
ticks**, where a 2-day house today finishes in one. That doubling is the first thing a returning player
will notice; it is a consequence of the premise, not of an implementation choice, and the reader should
be told it plainly rather than discover it.

**(b) The crew's value is lumpy in whole days — and one builder of the four is often worth nothing.**
With one decrement per tick and the overshoot discarded at completion, the completion date is a step
function of the crew:

| `buildDays` | 1b | 2b | 3b | 4b | which builders buy a whole turn |
|---|---|---|---|---|---|
| 2 | 2 | 2 | 2 | 2 | none — 1 builder is already the floor of 2 |
| 3 | 3 | 3 | 3 | 2 | the 4th only |
| 4 | 4 | 4 | 3 | 3 | the 3rd only |
| 5 | 5 | 5 | 4 | 4 | the 3rd only |
| 6 | 6 | 5 | 5 | 4 | the 2nd and the 4th; the **3rd is worth nothing** |

(The last row is the widest `buildDays` in the registry; there is no 7-day kind — see §4.2.)

This lumpiness is **pre-existing, not new** — today a 4-day build on a max-3 kind goes 4 / 3 / 3 / 2
turns at 0/1/2/3 workers, so the 2nd worker is already worth nothing there. The premise makes it more
visible (it is the whole point of the feature), and the honest framing for the reader is: *the bar on
the site moves with every builder; the completion date only moves on some crews.* The HUD shows the
fraction (§6), so a "wasted" builder is visible as a faster bar, not as a broken feature.

**(c) Slots: the rush is expensive, and the pool is the real cap — not the 4.** A crew is pool
workers, so a rush is paid in production elsewhere. Pool = `floor(population / 300)`:

| settlement | population | pool |
|---|---|---|
| level-1 town (the starting town, `POP_BY_LEVEL[1]`, `settlementRates.ts:7`) | 500 | **1** |
| level-2 town | 1,500 | **5** |
| level-3 castle | 5,000 | **16** |
| fully built-out level-3 castle | 80,000 | 266 |

The repo's own measurement stands beside this (`docs/settlements.md:232`): a level-2 town at
population 1,500 has a pool of 5 against a worker demand of 23. Consequences a player lives with:

- A **level-1 town has a pool of 1**: one builder on one site (1.00×), or no builder anywhere else.
  Early construction under this premise is slower than today by construction, and the free auto crew
  (bootstrap settlements only, §5.e) is what keeps a brand-new town moving at all.
- A **level-2 town can rush exactly one site at a time** (4 of its 5 slots) and leave nothing else.
- Slot-days for one site, at the kind's cap today vs 4 builders under the premise: `buildDays` 5 → 9 vs
  16 slot-days (1.78×); 4 → 6 vs 12 (2.00×); 2 → 3 vs 8 (2.67×). **The premise makes construction
  spend more of the village's labour for the same building.** That is a real cost the reader is buying
  with this feature, and it is the lever to revisit first (`WORKFORCE_PER_POPULATION`, the "late-game
  lever" the workforce doc already names) if the early game feels starved.

**(d) The stall has no self-recovery.** A site at 0 builders sits at progress 0 — stage 1, the wood
pile (`constructionStageFor(0) = 1`, `construction.ts:29`) — until a player issues `AssignWorkers`.
Nothing in the engine re-staffs it: there is no reconcile pass, and population never falls (§5.d), so
the only actors that can restart a site are the player, the drag gesture, and (once it exists) the AI's
own staffing rule (§5.e). Every surface that can leave a site dark therefore has to *say* it (§6).

---

## 5. The questions this premise raises, answered with numbers

### (a) Zero-`buildDays` placements — the stall cannot stall them

`townHall` is the one kind with `buildDays: 0` (`buildingRegistry.ts:60`). It is banned in districts
(`buildEntryStatus.ts:79-80`) and refused once the settlement already has one (`:78`), but it is
placeable in the main city of a settlement that has none (a founded settlers town, whose free starter
set is off), and a placement is stamped `construction: { daysRemaining: 0 }` (`placeBuildings.ts:85`,
`buildingPlacer.ts:159`). With
`daysRemaining = 0`, `advanceBuildingConstructions`'s `if (daysRemaining > 0)` test
(`advance.ts:127`) is false on the *first* tick whatever the rate — including `buildRate(0) = 0` — so a
0-day site still completes on the next day tick with no builders. Decision: **leave that alone**; it is
the registry saying "this is instant", and a 0-day site that stalls forever would be a bug factory.
The card must pin it with a test (one 0-day site, zero builders, one tick, completed).

Related edge the card must pin and not "fix" silently: `buildingConstructionProgress`
(`construction.ts:35`) divides by `buildingBuildDays(kind)`, which is **0** for a `townHall` no matter
what state blocks or clears it, so a town hall that *has* a `construction` field reads progress `NaN`
→ `constructionStageFor(NaN)` → stage 1. That is today's behaviour at `0e356c4`, reached only through
the "free starter set"/`freeInitialLayout` path that commits buildings already built. It is not this
feature's bug; it is named here so stage 3 does not report it as one and stage 4 does not read it as a
regression.

### (b) Fractional progress when builders change mid-build

`daysRemaining` is already fractional today — a goldMine (4 days) with 1 of 3 workers sits at
`2.6667` after a tick, and the UI already prints fractions (the menu interpolates the raw number at
`buildingMenu.ts:273`, and there is a card in the repo's history whose whole subject was that raw float
appearing in the tile-info panel). Under the premise: same shape, different constants — a 4-day site
with 3 builders goes `4 → 2.6 → 1.2 → completed` (the third tick's overshoot of 0.2 is **discarded**,
not carried anywhere; the building is finished and its timer is deleted from state,
`advance.ts:128`). Rules the card must implement, in order:

1. **Step function, read at the tick.** The decrement reads the crew as it stands when the day tick
   runs, once per tick. A crew that changes mid-tick does not get a partial decrement, and a crew that
   changes between ticks takes effect on the very next tick. There is no accrual, no per-move
   interpolation, and no fractional crew.
2. **Changing the crew never rewinds progress.** `daysRemaining` is the only stored quantity; both
   directions (adding builders, pulling them off) simply change the next decrement.
3. **Overshoot is discarded at completion**, as today. A 2-day site finished at 1.60× needs two ticks
   (the first leaves 0.4, the second's 1.6 overshoots by 1.2) and the site is simply done — the 1.2 is
   not a head start on the player's next build, and it is not stored anywhere.
4. **The trim at completion** (§3) happens in the same tick, before any other system reads the crew.
5. **No progress is stored as progress**, i.e. the stall is an absence of decrement, not a negative
   decrement or a flag. A stalled site's `daysRemaining` stays exactly where it was.

### (c) Does a builder already have a job?

**Not on a site, and that is the point.** The crew on a constructing building does nothing else: it
produces nothing (`producers.ts:107`), pays no gold (`income.ts:40`, `:46`, `:86`, `:92`), refills no
draft pool (`draftRecharge.ts:8`) and recruits nothing (`recruitUnits.ts:174`). So there is no
double-dipping to police — but the crew **is** spent from the pool (today as well as after the change),
which makes the new feature a straight trade: *four slots that would have been producing are, instead,
finishing this building sooner.* A player who crews every site at 4 in a level-2 town (pool 5) has
turned off almost all of its production. That is a decision, it is legible, and it is exactly what the
reader asked for; the design does not soften it, and no site gets a discount (no "builders don't count
against the pool" rule) — a discount would make the 4-cap meaningless and re-introduce the free-crew
leak the workforce rebalance closed.

### (d) Population falling mid-build

**Population never falls in this engine**, so the question is moot today and the design must not invent
the machinery for it: the only writer is `applyPopulationGrowth`
(`packages/engine/src/settlement/populationGrowth.ts:46`, `newPop = min(population + growth, cap)`),
which only ever adds, skips growth when food is short, and never subtracts. Nothing else assigns
`population` (grep at `0e356c4`: `init.ts`, `hydrate.ts`, `charter/advance.ts`'s founding population,
`settlers/found.ts`). Two consequences the card must respect:

1. **A crew can only shrink by a player's own `AssignWorkers`** (or by the building being destroyed, in
   which case its crew disappears with it). The pool gate is checked on **increments only**
   (`staffWorkers.ts:150`), and there is no trim-the-over-pool pass, so a settlement can sit `over pool`
   indefinitely (`workforce.ts`'s panel prints `over pool` for exactly this state).
2. **If a future rule does shrink population, this feature does not add a new failure mode**: an
   over-pool settlement keeps whatever crews it wrote, sites keep building, and the stall only appears
   when a site's own count is 0. The design deliberately does *not* add an auto-unstaff pass — pulling
   workers off a site to satisfy a pool arithmetic would break the reader's rule (progress would stop
   and start without the player acting), and it would be invisible on screen.

### (e) The AI — the premise quietly breaks the AI's building programme, and the card must fix it

`server/app/aiDriver.ts:933` issues `PlaceBuildings` with buildings shaped `{kind, gx, gy, level: 1}` —
**no `workers` field at all** — and the driver never issues `AssignWorkers` anywhere (grep at
`0e356c4`). `placeBuildings.ts:141` therefore decides the new site's crew:
`newPlacementsAutoCrew(s) ? undefined : 0`, and that gate (`workforce.ts:109`) is true only for a pure
bootstrap settlement — no explicit worker count anywhere **and no districts at all**.

Measured consequence: an AI seat's level-2/level-3 settlement is **not** a bootstrap (districts are
seeded by `districtSeed.ts` — tier 2 gets one, tier 3 gets two), so every building the AI places after
the premise lands starts at `workers: 0` and, under `buildRate(0) = 0`, **never finishes**. Today the
same placement crawls at 1× and completes. The AI's garrison-growth programme in particular places
buildings to raise draft capacity (`aiDriver.ts:901`'s comment), and it would place them for nothing.

The card must therefore include an AI rule. Recommended (smallest rule that keeps the AI correct):

- **The AI crews its own sites, through the same command a player uses.** After (or with) each
  placement, for each settlement it owns, assign builders to its unfinished sites by this priority:
  (1) a site at 0 builders (a stalled site first — otherwise the placement is a wasted cost), then
  (2) the site with the fewest `daysRemaining`, taking up to `CONSTRUCTION_MAX_BUILDERS` each, spending
  only idle pool slots (`pool - assigned`), largest `buildDays` first when ties. Rejections
  (`pool_exhausted`) are tolerated and logged, exactly as the driver's other passes do.
- **And the AI does not place what it cannot staff**: `pickHeroArmyBuildings` and the other placement
  planners gate on `pool - assigned >= 1` for that settlement. A settlement with no idle slot banks its
  resources instead of adding a site it will never finish.
- **Explicitly rejected**: exempting AI placements from the rule (an auto-crew for the AI). It would
  give the AI a 2×-class advantage over the player on the exact axis the feature is about, and any
  player-visible AI city would keep completing buildings while the player's own sites froze.

Verification the card must carry (stage 4 will look for it): a server-side test that drives the AI
driver over N rounds and asserts an AI-placed building is **completed** (its `construction` field gone)
within `ceil(buildDays / 1.0) + 1` ticks, plus a unit test of the planner that a settlement with zero
idle slots places nothing.

### (f) Step function vs integrated per turn — step, one decrement per day tick, as today

Construction advances **once per day tick, on the round wrap** — `advanceRound`
(`packages/engine/src/turn/round.ts:67`, call at `:93`), run server-side inside End Turn
(`turnService.ts:75`). The client runs no construction pass of its own (the local
`advanceRoundReducer` pass is gone; `turnController.ts`'s end-turn comment states the server is
authoritative for the whole pipeline). So:

- one decrement per tick, from the crew as it stands at that tick;
- no per-turn interpolation, no per-hour accrual, no partial credit when builders join a site mid-tick;
- the game's own "day" is the unit; `buildDays` and this feature share it, and a site's card is
  measured in day ticks, not in real time;
- the same code path is used whatever the game mode (classic and settlers settlements are the same
  settlements; §2 #7's auto-crew gate is the only mode-adjacent difference, and it is not mode-gated).

### (g) Save compatibility — what happens to the sites that already exist

`BuildingDef.workers` rides migration `030`'s nullable `settlement_buildings.workers` column; `NULL`
means `undefined` = legacy auto-staffed (`workforce.ts:41`, `docs/settlements.md:232`). On load:

| stored crew | today | under the premise |
|---|---|---|
| `NULL` / `undefined` (legacy untouched) | full effort → 2.00× | auto crew = 4 builders = **1.60×** (still free — spends no pool) |
| explicit `0` on a site | 1.00× — crawls and finishes | **0.00× — frozen until staffed** |
| explicit `1` on a max-3 kind's site | 1.33× | 1.00× |
| explicit `2` / `3` on a max-3 kind's site | 1.67× / 2.00× | 1.20× / 1.40× |
| explicit 4 (only possible on a 4-cap kind today) | 2.00× | 1.60× |

The loudest line is row 2: **an existing save whose sites were left dark freezes mid-build**, with the
wood pile unmoved. That is the premise working as asked, and it is the one change a player will read as
a defect unless the UI says it (§6). No migration is needed and none should be written: the field's
meaning is unchanged, only the curve reading it.

### (h) Districts

District buildings run the same rule — `advanceBuildingConstructions` walks `s.districts` in the same
loop (`advance.ts:139-146`), and the district test above (`test/engine/construction.test.ts:138`) pins
it. Two district-specific consequences:

- The district's road width reads its buildings' staffing (`roadNetwork.ts:87`,
  `districtWorkforcePercent`), and its `capacity` term is the sum of per-kind caps. With one ceiling
  function (§3) a site's 4 builders count toward that share, so a district full of sites reads a wider
  road — which is honest (the people really are there) and is the reason the ceiling function, not
  `buildingMaxWorkers`, must be what that function calls.
- A district placement is never a bootstrap placement (§2 #7): the auto crew's gate requires *no*
  districts, so **every** building the player adds to a district starts at 0 builders and stalls unless
  staffed. This is already true today (`docs/settlements.md:232`, 2026-11-03) — the premise only makes
  the consequence hard (frozen, not slow).

### (i) What this card does NOT change (named, so no one assumes it silently did)

- **Upgrade timers.** `advanceSettlementUpgrades` (`advance.ts:29`) uses the same
  `1 + upgradeAccelEffort(s)` shape (`workforce.ts:118`, `WORKFORCE_UPGRADE_ACCEL_KINDS` = `townHall`,
  `mageGuild`). A town-hall upgrade is not "a building under construction" — it is a settlement-wide
  timer with its own acceleration rule — and the reader's sentence is about a building's progress.
  Left untouched; §11 asks the reader (this is a genuinely new fork, not the resolved one).
- **Production, gold, draft recharge, recruiting, road widths and the pool divisor.** Untouched (§2).
- **`WORKFORCE_PER_POPULATION = 300`.** Untouched: the pool's behaviour changes only because crews now
  want up to 4 slots on a site. If the early game feels starved, this constant is the one lever, and
  moving it is a separate card with its own measurement (the workforce doc's own table of
  divisor/pool/demand is the template, `docs/settlements.md:223`).
- **The `AssignWorkers` command, its event, its rejection reasons and the schema.** Untouched (§1, §3).

---

## 6. The UI shape, and the exact on-screen words

One principle: **the pool's vocabulary does not change** ("Workers" stays "Workers"; the site's crew is
built out of the same stepper, drag gesture and panel chips), and **the premise appears in exactly six
places on screen** — five existing lines that gain the crew and the rate (one of which is a build-time
tooltip), and one that is a deliberate deletion.

**1 — Building menu, a site selected.** Existing line, existing element, existing colour
(`buildingMenu.ts:273-275`, `#f0c860`, 11px). Format, verbatim:

| builders | exact string |
|---|---|
| 0 | `Under construction — stalled: no builders · 4 days remaining` |
| n ≥ 1 | `Under construction — 1.40× (3 of 4 builders) · 4 days remaining` |

- The rate is printed with two decimals and a trailing `×` (U+00D7), the same multiplication sign the
  menu already uses for the cell multiplier and the palette for costs.
- The crew is `(n of 4 builders)`, with 4 read from `CONSTRUCTION_MAX_BUILDERS` — never a second
  literal.
- `day`/`days` and the raw number are kept exactly as they are today, fractions included: the existing
  string's normalisation is not touched, so a site at 2.6 days keeps reading `2.6 days remaining`.
- Browser hooks the pass can assert on: the line carries
  `data-testid="site-status"`, `data-builders="<n>"`, `data-rate="<0.00|1.00|1.20|1.40|1.60>"`.

**2 — The Workers row on a site.** The label stays `Workers`; the counter reads `<n> / 4` (the site
ceiling) using the existing `n / max` format at `buildingMenu.ts:523`. A legacy (auto) site keeps
`Auto (max)` verbatim — the words do not change, but on a site "max" now means 4. The `+` refuses when
`canAssignWorkers(base, staffingCeiling(b), 1, pool, assigned)` says so, unchanged.

**3 — Workforce panel, the site's row.** The role tag (the uppercase 9px line under the name,
`workforcePanel.ts:14`, `:198`) reads **`Building`** while `b.construction` is set, instead of the
finished role it shows today (`Producer`, `Recruit`, … ). This is the one *new* word in the feature and
it is load-bearing: the panel is where a player crews sites from, and a site tagged `Producer` while
producing nothing (`producers.ts:107`) is the panel lying. Implemented as a `"building"` member of the
role union with `ROLE_LABELS.building = "Building"`, chosen by `rolesFor` when `construction` is set
(`cityView.ts:708-716`). The row's chip title keeps today's wording (`Add a worker from the idle pool ·
cell (gx, gy)` — `workforcePanel.ts:173-175`). The header line keeps its wording too
(`Workers: 3 assigned · 2 idle`) and its numbers now count site builders up to the ceiling.

**4 — Settlement panel, the Workforce row** (`settlementInfoMenu.ts:549`). Unchanged wording **plus a
stall count** when at least one of the settlement's sites has 0 builders, appended to both the explicit
form and the legacy form:

- `3/5 assigned · 2 idle · 1 site stalled`
- `auto crew · 8 bldgs (14 slots), pool 5 · 2 sites stalled`

Exact words: `1 site stalled`, `2 sites stalled` (singular/plural on the count only). Absent when no
site is stalled — no `0 sites stalled`. The suffix goes **last**, after the existing ` · over pool`
marker when that is present, so the composed explicit string is
`${assigned}/${pool} assigned · ${idle} idle[ · over pool][ · N sites stalled]` and the legacy string is
`auto crew · ${count} bldgs (${slots} slots), pool ${pool}[ · N sites stalled]`. This is the one global
tell that the premise is live, and the only way a player learns that a site somewhere is frozen without
opening every building. (The legacy form can carry the suffix too: `hasLegacyStaffing` is true when
*any* building is auto-staffed (`workforce.ts:78`), so a mixed settlement can have auto-crew buildings
and an explicitly-0 stalled site at once — those auto-crew sites are never themselves stalled.)

**5 — Build palette, the build-time line on a buildable entry** (`buildEntryStatus.ts:146`,
`buildTimeLine`; today `Build time: 4 days — its upkeep is paid while it is under construction, and it
produces nothing until it is finished`). The player must learn the crew dependence **before** spending
anything, so the line becomes:

```
Build time: 4 days at 1 builder, up to 1.60× with 4 — its upkeep is paid while it is under
construction, it produces nothing until it is finished, and a site with no builders makes no progress
```

(`day`/`days` keep today's singular rule; the `1.60×` is read from
`BUILD_RATE_PER_EXTRA_BUILDER`/`CONSTRUCTION_MAX_BUILDERS`, never typed twice; a `buildDays: 0` kind
still returns the empty string and prints no line at all, as today.)

**6 — The city scene: builders are drawn on a site.** Today the person clusters skip a building under
construction (`cityScene.ts:205`) and cap at 4 (`:206`). The skip is **deleted**; the count becomes
`min(buildersOnSite(b), 4)`. A stalled site therefore draws **no** persons — the visual statement of
"nobody is working here", and the fastest way for a browser pass to confirm the rule end to end.

**Not changed, deliberately:** no toast, no modal, no new panel, no change to the drag gesture, and no
new refusal reason in `AssignWorkers`. A player who never opens a site's menu still learns the rule
from the settlement panel's stall count and from buildings that stop appearing finished.

**What the browser pass checks (for the checklist in §8):** place a site in a non-bootstrap settlement
→ the menu says `stalled: no builders`, no persons are drawn, the wood pile does not move across two
End Turns; drag one worker onto it → the line switches to `1.00× (1 of 4 builders)`, a person appears,
the day count ticks down by 1; add three more → `1.60× (4 of 4 builders)` and 4 persons; let it
finish → the crew is trimmed to the kind's cap and the menu's Workers row shows `n / kindMax`.

---

## 7. What the implementation card does, in order

1. `packages/engine/src/settlement/workforce.ts` — add `CONSTRUCTION_MAX_BUILDERS = 4`,
   `BUILD_RATE_PER_EXTRA_BUILDER = 0.2`, `buildRate(n)`, `staffingCeiling(b)`, `buildersOnSite(b)`.
   `effortFraction` is **not** changed: production keeps its own curve.
2. `packages/engine/src/settlement/advance.ts:125` — the decrement becomes
   `buildRate(buildersOnSite(b))`; the trim on completion (`workers = min(workers, kind cap)`) lands in
   the same `stepBuilding` body, in the branch that clears `construction`.
3. `packages/engine/src/settlement/staffWorkers.ts:122/124/135` — validate against `staffingCeiling`.
   `workforce.ts`'s `staffingBase` / `canAssignWorkers` / `autoStaffedSlots` / `assignedWorkersExplicit`
   read the same ceiling, so the pool arithmetic cannot disagree with the reducer.
4. `packages/engine/src/settlement/roadNetwork.ts:87` — the district's `capacity`/`assigned` terms read
   the ceiling.
5. `src/screens/settlements/cityView/cityView.ts:68` (the `WorkforceBuildingRole` union) and `:708`
   (`rolesFor`) — the new `"building"` site role; `snapshotEntry` (`:717-718`) `max` becomes the ceiling.
6. `src/screens/settlements/cityView/workforcePanel.ts:14` — `ROLE_LABELS.building = "Building"`.
7. `src/screens/settlements/cityView/buildingMenu.ts:273` (the §6 string + `data-*` hooks) and `:462`
   (the stepper's cap).
8. `src/screens/settlements/settlementInfoMenu.ts:549` — the stall suffix (§6.4).
9. `src/screens/settlements/cityView/buildEntryStatus.ts:146` — `buildTimeLine` states the crew
   dependence and the stall: `Build time: 4 days at 1 builder, up to 1.60× with 4 — its upkeep is paid
   while it is under construction, it produces nothing until it is finished, and a site with no
   builders makes no progress` (singular `day` when `buildDays === 1`; `0`-day kinds already return
   `""` and keep doing so).
10. `src/render/scene/sceneBuilder/cityScene.ts:205-206` — drop the construction skip; read
    `buildersOnSite`.
11. `server/app/aiDriver.ts` — the AI staffing rule and the "only place what you can staff" gate (§5.e).
12. `docs/settlements.md` — the two lines this changes (`:238` the construction-site rule, `:239` the
    per-kind caps sentence) and its `docs:verified` marker; `DOC_OWNERSHIP` maps `docs/settlements.md`
    to `packages/engine/src/settlement/**`, so the doc gate will ask for it.
13. Tests: the curve and the whole-day table (§8's rows each name the suite that can hold them).
14. `CHANGELOG.md` + a version bump are the **stage 4** release step's, not this card's, per the repo's
    `/version-bump` rule (game code bumps; docs alone never do).

---

## 8. The acceptance checklist this card is held to

One line per item; each is either a test the card must carry or an observable a browser pass can see.
"Site" always means a building with `construction` set.

1. `buildRate` is `0 / 1.00 / 1.20 / 1.40 / 1.60` for 0–4 builders, and the constants 4 and 0.2 exist
   once in the engine (`workforce.ts`), read by the reducer, the UI and the tests — no second literal.
2. A site with 0 builders does not advance: one End Turn leaves `construction.daysRemaining`
   **unchanged**, and ten leave it unchanged (unit test, main city and district).
3. A site with 1 builder advances exactly 1.0 per tick; 2/3/4 builders advance 1.2/1.4/1.6 per tick
   (unit test, asserted on `daysRemaining`, fractional values included).
4. Whole-day outcomes match the §4.2 table for every `buildDays` in the registry and every crew 1–4
   (a table test, so the doc and the code cannot drift).
5. `daysRemaining` never goes below 0 and never persists a negative: completion clears the field in the
   same tick the overshoot is discarded, and no progress carries to another building.
6. A crew change mid-build is a step: adding the 4th builder on tick N changes the tick N+1 decrement
   only, and progress is never rewound or double-credited (unit test).
7. On completion, a site crewed above its kind's cap is trimmed to `buildingMaxWorkers(kind)` in the
   same tick, and the surplus returns to the pool (`assignedWorkersExplicit` drops by the surplus).
8. `assignWorkers` accepts up to 4 on a site of any kind and still refuses 5 (`invalid_workers`), and
   refuses an increment past the pool (`pool_exhausted`), with no new rejection reason.
9. A house (cap 1) can be crewed with 4 builders **while it is a site**, and reads 1.60×; finished, it
   accepts at most 1.
10. Pool accounting uses the ceiling: a settlement with one 4-builder site reports `4` assigned slots,
    and a legacy/auto site reports the auto crew's slots at the ceiling value.
11. A legacy save (`workers: null` everywhere) reloads and its sites read as a full crew at **1.60×**,
    spending no pool — and its untouched buildings behave exactly as before (a regression test on the
    existing workforce suite).
12. An existing save whose site is at `workers: 0` is frozen until staffed — pinned by a test, and
    stated in the release notes rather than discovered by a player.
13. `townHall` (`buildDays: 0`) placed with a construction timer still completes on the next day tick
    with zero builders (the stall cannot reach a 0-day site).
14. The upstream day tick is unchanged: `advanceRound` calls the construction pass once per day, the
    server remains the only writer, and there is no client-side construction pass.
15. The menu line matches §6.1 character for character for crews 0 and 3, carries the `data-*` hooks,
    and the Workers row reads `n / 4` on a site.
16. The workforce panel tags a site `Building` and not its finished role; the settlement panel appends
    ` · 1 site stalled` exactly when one site has 0 builders.
17. The city scene draws 1–4 persons on a staffed site and none on a stalled one (visual regression
    scene, pinned).
18. The AI completes its own placements: a driver test asserts an AI-placed building finishes within
    `ceil(buildDays / 1.0) + 1` ticks, and the planner places nothing in a settlement with no idle
    worker.
19. Nothing else moved: production, gold, draft recharge, recruiting, road width and upgrade timers are
    byte-identical for a completed building, and `npm run build` / `lint:deps` / `test:types` /
    `docs:check` are green on the changed tree (`docs/settlements.md`'s marker refreshed).
20. The premise is stated to the player, not hidden: the palette's build-time line (§6.5) says a site
    with no builders makes no progress before the player spends anything on it.

### One worked example (the arithmetic the card is graded against)

**An `eyrie` — `buildDays: 6`, `maxWorkers: 4` — in a level-3 castle with a pool of 16, crewed with 4
builders before the first End Turn.**

| tick | builders | decrement | `daysRemaining` after |
|---|---|---|---|
| — | 4 | — | 6.0 (as placed) |
| 1 | 4 | 1.60 | 4.4 |
| 2 | 4 | 1.60 | 2.8 |
| 3 | 4 | 1.60 | 1.2 |
| 4 | 4 | 1.60 | ≤ 0 → **completed**, timer cleared, overshoot 0.4 discarded |

Four End Turns (today, at 2.00×, the same eyrie takes three). The crew stays at 4 — an eyrie's cap *is*
4, so no trim fires.

**The same eyrie, placed and left alone in that castle (which has districts, so it is not a
bootstrap):** `workers: 0`, `daysRemaining` stays 6.0 across every End Turn, the scene draws no persons,
the settlement panel reads `… · 1 site stalled`, and the site's own line reads `Under construction —
stalled: no builders · 6 days remaining`. Assign one worker on the tick after that: 6.0 → 5.0 → 4.0 →
3.0 → 2.0 → 1.0 → completed on the sixth tick *after* staffing (six more turns for the one builder,
against four for the full crew). Pull that one worker off at 3.0 and the count sits at 3.0 forever: the
stall is an absence of decrement, and nothing in the engine puts a worker back on the site.

---

## 9. Considered and rejected

| # | Option | Why it loses |
|---|---|---|
| 1 | **Compounding** (1.00/1.20/1.44/1.728) | Differs from additive in whole-day terms in **one cell of the whole table** (5-day build, 4 builders: 3 vs 4 turns, §4.2), so it buys nothing measurable, and it makes the 3rd and 4th builder worth +0.24×/+0.29× — contradicting the reader's own sentence ("each additional worker makes it 20% faster") and rewarding dumping all four workers on one site over spreading them. |
| 2 | **The kind's cap as the site ceiling** (no ceiling raise) | A house is permanently 1.00× (cap 1) and the 5-day `bank`/`treasury`/`apartment` cap at 1.20× — the feature would be unavailable exactly where build time costs most (§3). |
| 3 | **Crew walks off entirely at completion** (`workers = 0`) | A rush becomes two chores (build it, then staff it) and silently unstaffs every building the player just paid pool slots for. Trim-to-cap (§3) keeps the narrative "the crew that built it runs it". |
| 4 | **A new `builders` field / a new command / a new event** | Three new seams for one curve. `workers` already exists, already rides a nullable column, is already pool-accounted, already validated by a reducer, already steppers/drags/panels and already draws up to 4 persons. The premise adds a *ceiling*, not an entity (§3). |
| 5 | **A parallel construction crew resource** ("builders" that do not count against the pool) | Makes the 4-cap meaningless, re-opens the free-crew leak the 2026-11-03 workforce rebalance closed, and removes the one real decision the feature creates (tempo vs output). |
| 6 | **Integrated accounting** (accrue fractional crew-days continuously, or key the rate off the fraction of the day elapsed) | Contradicts the game's granularity: the day tick is the only clock (`advanceRound`), and every existing timer (construction, upgrades, draft recharge, bank maturity) is a whole-step counter. A finer clock is a different feature with its own determinism question. |
| 7 | **Carry the completion overshoot into the player's next build** | Rewards micro-management of exactly when a site finishes with a hidden head start, and needs somewhere to store it (a new field). Today's "discard the overshoot" rule is kept (§5.b). |
| 8 | **Auto-unstaff a site when the pool is over-subscribed** | Progress would start and stop without the player acting; nothing on screen would explain it; and population never falls anyway (§5.d). |
| 9 | **Exempt the AI from the rule (auto-crew its placements)** | Hands the AI a straight advantage on the feature's own axis and leaves AI cities visibly finishing while the player's stall (§5.e). |
| 10 | **Extending the rule to the upgrade timers in the same card** | A different system (`advanceSettlementUpgrades`, `WORKFORCE_UPGRADE_ACCEL_KINDS`) with its own accel curve; scope creep here would make this card unreviewable. Asked as an open fork instead (§11). |
| 11 | **A "hammer" icon or a new panel for builders** | The people on screen, the stepper and the stall count already carry it; a second surface for the same integer is where the game's own UI debt comes from. |

---

## 10. What I could not judge from a desk

- **Whether the stall reads as tension or as a bug.** The strongest reading of the reader's sentence is
  that a site nobody is working on should not progress — but the first time a returning player's
  half-built bank sits still, they will look for a broken timer. Only a playthrough settles it; §6's
  four surfaces are designed to answer it, and the answer may still want a nudge (a one-off notice on
  the first stalled tick, or a highlight on the workforce panel's idle count). No telemetry exists in
  this repo for "how long a site sat at 0 builders", so this cannot be measured after the fact either.
- **Whether `WORKFORCE_PER_POPULATION = 300` still fits.** The pool was tuned against a fully built-out
  castle's *completed* demand (275 slots, `docs/settlements.md:223`); sites add transient demand (a
  district with five sites at 4 builders is 20 extra slots). A level-1 town's pool of 1 is the sharpest
  case (§4.3.c) and it is a single constant away from feeling different. I did not simulate a
  full-game economy to pick a value — that needs a play, and moving this constant would also move the
  district-road reading.
- **Whether the AI staffing policy in §5.e is the right shape.** It is the smallest rule that keeps the
  AI's building programme from freezing, but how an AI seat prioritises (rush the garrison buildings vs
  the economy vs finishing whatever is closest) is a judgement that wants its own card and its own
  measurement — I have sized it (it is the largest single item in §7) rather than solved it.
- **Save-visible consequences beyond the freeze.** I can read the field's meaning and the curve, but I
  have no save corpus in this worktree to count how many existing sites sit at `workers: 0` (the row
  that freezes) versus `workers: undefined` (the row that keeps building). A one-off query against the
  live database would answer it; that is a stage-4 or operations question, not a design one.
- **Legibility of the lumpy table** (§4.3.b): the completion date ignores some builders entirely on
  some builds. I have stated it rather than smoothed it (smoothing means a finer clock, rejected in
  §9.6) — but whether players read a "wasted" builder as wasted is a play question.

---

## 11. The genuinely new forks (asked AFTER this document was committed)

These are new questions the measuring raised. They are **not** the resolved fork (the curve, the cap and
the stall are settled), and none of them blocks an implementation that takes the recommendation each
line carries:

1. **Do the upgrade timers follow the same curve?** `advanceSettlementUpgrades` (`advance.ts:29`) uses
   the same `1 + accel` shape with `upgradeAccelEffort` (`workforce.ts:118`), and a town-hall upgrade is
   capped at 2× today. *Recommendation: no — leave upgrades alone in this card; the reader's sentence is
   about a building's progress, and one curve change per card is what keeps it reviewable.*
2. **Is the site ceiling really 4 for a house?** *Recommendation: yes, with a trim to the kind's cap on
   completion (§3) — otherwise a house can never have a second builder and the feature is invisible on
   half the registry.*
3. **Is a legacy/auto site a full crew of 4?** *Recommendation: yes — `undefined` already means "full
   effort" everywhere, and the auto crew spends no pool, which is what keeps a brand-new town's own
   placements moving.*
4. **Does the AI crew its own sites (the §5.e rule), or is the AI's building programme allowed to
   stall?** *Recommendation: crew them, and do not place what it cannot staff — a stalled AI is
   indistinguishable from a broken AI.*

The report for this run records these four in the panel's own words; the branch to read them on is
`wtgui/stage-1-of-4-re-issued-d-3a7e42`, and this file is the only artifact it carries.

