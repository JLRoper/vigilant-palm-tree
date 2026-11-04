import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, GameState, SettlementState } from "@heroes/contracts";
import {
  advanceBuildingConstructions,
  assignedWorkersExplicit,
  autoStaffedSlots,
  BUILD_RATE_PER_EXTRA_BUILDER,
  buildersOnSite,
  buildRate,
  buildingBuildDays,
  buildingConstructionProgress,
  CONSTRUCTION_MAX_BUILDERS,
  constructionStageFor,
  effortFraction,
  staffingCeiling,
  stalledConstructionSites,
  upgradeProgress,
  upgradeRefs,
  upgradeTotalDays,
} from "@heroes/engine";
import { makeSettlement, makeState } from "../charter/_helpers";
import { BUILDABLE_KINDS } from "../../src/screens/settlements/cityView/buildListSections";

test("upgradeRefs: building wraps its ref, buildings unwraps the array, others are empty", () => {
  const ref = { gx: 1, gy: 2, kind: "goldMine" as const };
  assert.deepEqual(upgradeRefs({ kind: "building", targetLevel: 2, daysRemaining: 4, buildingRef: ref }), [ref]);
  assert.deepEqual(
    upgradeRefs({ kind: "buildings", targetLevel: 2, daysRemaining: 4, buildingRefs: [ref] }),
    [ref],
  );
  assert.deepEqual(upgradeRefs({ kind: "townHall", targetLevel: 2, daysRemaining: 7 }), []);
  assert.deepEqual(upgradeRefs({ kind: "settlement", targetLevel: 2, daysRemaining: 15 }), []);
});

test("upgradeTotalDays: town hall uses the TH table, buildings take the max request, settlement the tier table", () => {
  assert.equal(upgradeTotalDays({ kind: "townHall", targetLevel: 2, daysRemaining: 7 }), 7);
  assert.equal(upgradeTotalDays({ kind: "townHall", targetLevel: 3, daysRemaining: 12 }), 12);
  assert.equal(
    upgradeTotalDays({
      kind: "buildings",
      targetLevel: 2,
      daysRemaining: 4,
      buildingRefs: [
        { gx: 0, gy: 0, kind: "house" },
        { gx: 1, gy: 1, kind: "goldMine" },
      ],
    }),
    4,
    "house L2 is 2 days, goldMine L2 is 4 days; total is the max",
  );
  assert.equal(upgradeTotalDays({ kind: "settlement", targetLevel: 2, daysRemaining: 15 }), 15);
  assert.equal(upgradeTotalDays({ kind: "settlement", targetLevel: 3, daysRemaining: 25 }), 25);
});

test("upgradeProgress: 0 at initiation, 1 at completion, clamped to [0,1]", () => {
  assert.equal(upgradeProgress({ kind: "townHall", targetLevel: 2, daysRemaining: 7 }), 0);
  assert.equal(upgradeProgress({ kind: "townHall", targetLevel: 2, daysRemaining: 0 }), 1);
  assert.equal(
    upgradeProgress({ kind: "townHall", targetLevel: 2, daysRemaining: -3 }),
    1,
    "over-complete stays clamped",
  );
  const p = upgradeProgress({ kind: "townHall", targetLevel: 3, daysRemaining: 6 });
  assert.ok(Math.abs(p - 0.5) < 1e-9, "6 of 12 days remaining is exactly half");
});

test("constructionStageFor: wood pile under 5%, scaffold to 75%, near-complete at 75%+", () => {
  assert.equal(constructionStageFor(0), 1);
  assert.equal(constructionStageFor(0.049), 1);
  assert.equal(constructionStageFor(0.05), 2);
  assert.equal(constructionStageFor(0.5), 2);
  assert.equal(constructionStageFor(0.749), 2);
  assert.equal(constructionStageFor(0.75), 3);
  assert.equal(constructionStageFor(1), 3);
});

test("buildingConstructionProgress: 0 at placement, 0.75 with one day left of four", () => {
  const total = { daysRemaining: 4 };
  assert.equal(buildingConstructionProgress({ gx: 0, gy: 0, kind: "goldMine", level: 1, style: "classic", construction: { ...total } }), 0);
  assert.equal(
    buildingConstructionProgress({ gx: 0, gy: 0, kind: "goldMine", level: 1, style: "classic", construction: { daysRemaining: 1 } }),
    0.75,
  );
  assert.equal(
    buildingConstructionProgress({ gx: 0, gy: 0, kind: "goldMine", level: 1, style: "classic" }),
    1,
    "a completed building (no construction field) counts as fully progressed",
  );
});

test("buildRate: 0 / 1.00 / 1.33 / 1.67 / 2.00 for 0-4 builders, and its top IS today's full-crew rate", () => {
  assert.equal(CONSTRUCTION_MAX_BUILDERS, 4, "the construction ceiling is a named constant");
  assert.equal(BUILD_RATE_PER_EXTRA_BUILDER, 1 / 3, "one third per extra builder");
  assert.equal(buildRate(0), 0);
  assert.equal(buildRate(1), 1);
  assert.ok(Math.abs(buildRate(2) - 4 / 3) < 1e-12);
  assert.ok(Math.abs(buildRate(3) - 5 / 3) < 1e-12);
  assert.equal(buildRate(4), 2, "four builders reach 2.00x EXACTLY");
  assert.equal(buildRate(9), 2, "the curve clamps at the ceiling: no crew buys more than 4");
  // THE INVARIANT THE CURVE EXISTS FOR: its top is the rate today's engine
  // already reaches at any kind's own full crew (1 + effortFraction, the
  // pre-2026-11-03 decrement), so an untouched building builds in exactly the
  // time it always did.
  const full = { gx: 0, gy: 0, kind: "goldMine", level: 1, style: "classic" } as BuildingDef;
  assert.equal(buildRate(CONSTRUCTION_MAX_BUILDERS), 1 + effortFraction(full), "2.00x today === 4 builders under the curve");
});

test("staffingCeiling/buildersOnSite: a site takes 4 whatever the kind, a finished building its kind's cap", () => {
  const site = (kind: BuildingDef["kind"], workers?: number): BuildingDef => ({
    gx: 0,
    gy: 0,
    kind,
    level: 1,
    style: "classic",
    ...(workers === undefined ? {} : { workers }),
    construction: { daysRemaining: 4 },
  });
  // A house's own cap is 1; while it is being built it takes 4.
  assert.equal(staffingCeiling({ gx: 0, gy: 0, kind: "house", level: 1, style: "classic" }), 1);
  assert.equal(staffingCeiling(site("house")), CONSTRUCTION_MAX_BUILDERS);
  assert.equal(staffingCeiling(site("bank")), CONSTRUCTION_MAX_BUILDERS);
  assert.equal(buildersOnSite(site("house", 4)), 4, "a house site can hold 4 builders");
  assert.equal(buildersOnSite(site("house", 9)), 4, "and the ceiling clamps an over-count");
  assert.equal(buildersOnSite(site("house", 0)), 0);
  assert.equal(buildersOnSite(site("house")), 4, "the auto crew is a FULL crew: never 1, never 0");
  assert.equal(buildersOnSite({ gx: 0, gy: 0, kind: "goldMine", level: 1, style: "classic" }), 3, "finished: the kind's cap");
});

test("advanceBuildingConstructions decrements daily and removes the field on completion", () => {
  // One builder -> buildRate(1) = 1.00x, so this pins the one-builder baseline.
  // An idle site is pinned by its own case below: it does NOT move at all.
  const settlement = makeSettlement("s0", 0, 2, 2, {
    buildings: [
      { gx: 0, gy: 0, kind: "goldMine", level: 1, style: "classic", workers: 1, construction: { daysRemaining: 2 } },
      { gx: 3, gy: 3, kind: "house", level: 1, style: "classic" },
    ],
  });
  const state = makeState({ settlements: [settlement] });

  const afterOne = advanceBuildingConstructions(state);
  assert.equal(afterOne.settlements.s0.buildings[0].construction?.daysRemaining, 1);
  assert.equal(afterOne.dirty, true);
  assert.equal("construction" in afterOne.settlements.s0.buildings[1], false, "finished buildings untouched");

  const afterTwo = advanceBuildingConstructions(afterOne);
  assert.equal(
    "construction" in afterTwo.settlements.s0.buildings[0],
    false,
    "reaching 0 remaining completes the building and clears the field in the same tick",
  );

  const stable = advanceBuildingConstructions(afterTwo);
  assert.equal(stable, afterTwo, "no constructions left means the same state object comes back (no-op)");
});

test("a site with nobody on it makes NO progress -- ten ticks leave it exactly where it was", () => {
  const settlement: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, {
      buildings: [
        { gx: 0, gy: 0, kind: "goldMine", level: 1, style: "classic", workers: 0, construction: { daysRemaining: 4 } },
      ],
    }),
    districts: {
      "3,2": {
        q: 3,
        r: 2,
        citySpots: [],
        buildings: [
          { gx: 0, gy: 0, kind: "bank", level: 1, style: "classic", workers: 0, construction: { daysRemaining: 5 } },
        ],
      },
    },
  };
  let state = makeState({ settlements: [settlement] });
  for (let i = 0; i < 10; i++) state = advanceBuildingConstructions(state);
  assert.equal(
    state.settlements.s0.buildings[0].construction?.daysRemaining,
    4,
    "the stall is an absence of decrement, not a negative one",
  );
  assert.equal(
    state.settlements.s0.districts!["3,2"].buildings[0].construction?.daysRemaining,
    5,
    "a district site stalls by the same rule",
  );
});

test("advanceBuildingConstructions scales the daily decrement with the crew (1.00 / 1.33 / 1.67 / 2.00)", () => {
  // A goldMine's own cap is 3, and a site takes 4 whatever the kind, so the whole
  // curve is reachable on one kind -- including the 4th builder a 3-cap kind
  // could never take before.
  const settlement = makeSettlement("s0", 0, 2, 2, {
    buildings: [
      { gx: 0, gy: 0, kind: "goldMine", level: 1, style: "classic", workers: 0, construction: { daysRemaining: 10 } },
      { gx: 2, gy: 0, kind: "goldMine", level: 1, style: "classic", workers: 1, construction: { daysRemaining: 10 } },
      { gx: 4, gy: 0, kind: "goldMine", level: 1, style: "classic", workers: 2, construction: { daysRemaining: 10 } },
      { gx: 6, gy: 0, kind: "goldMine", level: 1, style: "classic", workers: 3, construction: { daysRemaining: 10 } },
      { gx: 8, gy: 0, kind: "goldMine", level: 1, style: "classic", workers: 4, construction: { daysRemaining: 10 } },
      { gx: 10, gy: 0, kind: "goldMine", level: 1, style: "classic", construction: { daysRemaining: 10 } },
    ],
  });
  const after = advanceBuildingConstructions(makeState({ settlements: [settlement] }));
  const days = after.settlements.s0.buildings.map((b) => b.construction?.daysRemaining);
  assert.equal(days[0], 10, "0 builders: 0 days per tick");
  assert.equal(days[1], 9, "1 builder: 1.00x");
  assert.ok(Math.abs((days[2] ?? NaN) - (10 - 4 / 3)) < 1e-12, "2 builders: 1.33x");
  assert.ok(Math.abs((days[3] ?? NaN) - (10 - 5 / 3)) < 1e-12, "3 builders: 1.67x");
  assert.equal(days[4], 8, "4 builders: 2.00x");
  assert.equal(days[5], 8, "the auto crew (workers undefined) is a full 4-builder crew -> 2.00x");
});

test("the untouched-building invariant: an auto site builds in EXACTLY today's time", () => {
  // The reader's answer is the whole reason the curve is scaled to 2.00x at four
  // builders: a building nobody touched must build in exactly the same time as
  // before the feature. 4 days at 2.00x was 4 -> 2 -> done before, and it is
  // 4 -> 2 -> done now.
  const untouched: BuildingDef = { gx: 0, gy: 0, kind: "goldMine", level: 1, style: "classic", construction: { daysRemaining: 4 } };
  assert.equal(buildersOnSite(untouched), 4);
  assert.equal(buildRate(buildersOnSite(untouched)), 2);
  const after = advanceBuildingConstructions(
    makeState({ settlements: [makeSettlement("s0", 0, 2, 2, { buildings: [untouched] })] }),
  );
  assert.equal(after.settlements.s0.buildings[0].construction?.daysRemaining, 2, "4 days at 2.00x: one tick leaves 2");
  assert.equal("workers" in after.settlements.s0.buildings[0], false, "and the auto site is still auto (never staffed by the tick)");
});

test("whole-day outcomes per crew: the 4-builder column IS today's full-crew column", () => {
  // ceil() of the closed form and the engine's accumulated subtraction agree on
  // every row below except 4-day/2-builders, where the accumulation leaves a
  // last crumb above zero and costs one extra tick. The completed table is what
  // the player counts, so it is the table pinned here.
  const ticksToFinish = (buildDays: number, builders: number): number => {
    let remaining = buildDays;
    let ticks = 0;
    if (remaining <= 0) return 1; // a 0-day site completes on the first tick
    while (remaining > 0 && ticks < 50) {
      remaining -= buildRate(builders);
      ticks += 1;
    }
    return ticks;
  };
  const table: Array<[number, [number, number, number, number]]> = [
    [2, [2, 2, 2, 1]],
    [3, [3, 3, 2, 2]],
    [4, [4, 4, 3, 2]],
    [5, [5, 4, 4, 3]],
    [6, [6, 5, 4, 3]],
  ];
  for (const [buildDays, expected] of table) {
    const row = [1, 2, 3, 4].map((crew) => ticksToFinish(buildDays, crew));
    assert.deepEqual(row, expected, `${buildDays}-day build per crew`);
    assert.equal(
      row[3],
      Math.ceil(buildDays / 2),
      `a ${buildDays}-day build at 4 builders takes exactly the ticks a full crew takes today`,
    );
  }
  assert.equal(ticksToFinish(0, 0), 1, "a 0-day site completes on the first tick even with no builders");
});

test("a 0-day site (townHall) still completes on the first tick with zero builders", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    buildings: [
      { gx: 0, gy: 0, kind: "townHall", level: 1, style: "classic", workers: 0, construction: { daysRemaining: 0 } },
    ],
  });
  const after = advanceBuildingConstructions(makeState({ settlements: [settlement] }));
  assert.equal("construction" in after.settlements.s0.buildings[0], false, "the stall cannot reach a 0-day site");
});

test("a fully crewed site finishes sooner, and its crew is TRIMMED to the kind's cap on completion", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    buildings: [
      { gx: 0, gy: 0, kind: "goldMine", level: 1, style: "classic", workers: 4, construction: { daysRemaining: 2 } },
      { gx: 2, gy: 0, kind: "goldMine", level: 1, style: "classic", workers: 1, construction: { daysRemaining: 2 } },
    ],
  });
  const after = advanceBuildingConstructions(makeState({ settlements: [settlement] }));
  const done = after.settlements.s0.buildings[0];
  assert.equal("construction" in done, false, "2 days at 2.00x completes in one tick");
  assert.equal(done.workers, 3, "goldMine's own cap is 3: the surplus builder is released here, same tick");
  assert.equal(after.settlements.s0.buildings[1].construction?.daysRemaining, 1, "2 days at 1.00x leaves 1");
});

test("the completion trim is lossless and deterministic: the assigned total drops by exactly the surplus", () => {
  // A cap-1 house crewed with 4 while it builds, beside an auto-crewed site.
  const settlement = makeSettlement("s0", 0, 2, 2, {
    buildings: [
      { gx: 0, gy: 0, kind: "house", level: 1, style: "classic", workers: 4, construction: { daysRemaining: 1 } },
      { gx: 2, gy: 0, kind: "house", level: 1, style: "classic", construction: { daysRemaining: 1 } },
    ],
  });
  const before = makeState({ settlements: [settlement] });
  assert.equal(assignedWorkersExplicit(before.settlements.s0), 4, "4 explicit builders, pool-charged");
  const after = advanceBuildingConstructions(before);
  const [house, auto] = after.settlements.s0.buildings;
  assert.equal("construction" in house, false);
  assert.equal(house.workers, 1, "trimmed to the house's operational cap of 1");
  assert.equal(assignedWorkersExplicit(after.settlements.s0), 1, "the 3 surplus builders are idle in the pool again");
  assert.equal("workers" in auto, false, "the trim never auto-staffs a site -- the unattended one stays auto");
});

test("a stalled site is listed, a staffed or finished one is not", () => {
  const settlement: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, {
      buildings: [
        { gx: 0, gy: 0, kind: "goldMine", level: 1, style: "classic", workers: 0, construction: { daysRemaining: 4 } },
        { gx: 2, gy: 0, kind: "goldMine", level: 1, style: "classic", workers: 2, construction: { daysRemaining: 4 } },
        { gx: 4, gy: 0, kind: "goldMine", level: 1, style: "classic" },
        { gx: 6, gy: 0, kind: "goldMine", level: 1, style: "classic", construction: { daysRemaining: 4 } },
      ],
    }),
    districts: {
      "3,2": {
        q: 3,
        r: 2,
        citySpots: [],
        buildings: [
          { gx: 0, gy: 0, kind: "bank", level: 1, style: "classic", workers: 0, construction: { daysRemaining: 2 } },
        ],
      },
    },
  };
  assert.equal(stalledConstructionSites(settlement), 2, "the explicit-0 site and the district one; never the auto crew");
});


// ── THE INVARIANT THE READER'S CURVE EXISTS FOR (2026-11-03) ────────────────
//
// The curve is scaled to reach TODAY'S 2.00x at four builders (a 1/3 step, not
// the design document's 0.2 -- that section of the design is superseded), and
// the point of the scaling is this one: the free auto crew is a FULL crew, and
// today's engine already reaches 2.00x at a kind's own cap, so an untouched
// building must go on building in exactly the time it always did.
//
// The old rule is re-derived HERE -- `1 + effortFraction(b)`, the decrement the
// pre-2026-11-03 engine ran and the function the engine still uses for
// production -- rather than read back from the new `buildRate`. A test that
// compares the new rule against itself proves nothing; this one compares the
// real `advanceBuildingConstructions` against an independent statement of the
// old engine, tick by tick, for every kind a settlement can raise (the palette's
// 43, spanning all six `buildDays` in the registry), and fails the moment one
// tick of one kind moves.

/** The untouched building: no `workers` field at all -- a legacy settlement's
 * crew, or a bootstrap settlement's own placement. */
function autoSite(kind: BuildingDef["kind"]): BuildingDef {
  return { gx: 0, gy: 0, kind, level: 1, style: "classic", construction: { daysRemaining: buildingBuildDays(kind) } };
}

/** The PRE-change daily pass, exactly as the engine ran it before the crew
 * rule: one decrement per day tick, the field cleared on completion. */
function preCrewAdvance(state: GameState, decrement: (b: BuildingDef) => number): GameState {
  const settlements: GameState["settlements"] = {};
  for (const [id, s] of Object.entries(state.settlements)) {
    const step = (b: BuildingDef): BuildingDef => {
      if (!b.construction) return b;
      const daysRemaining = b.construction.daysRemaining - decrement(b);
      if (daysRemaining > 0) return { ...b, construction: { daysRemaining } };
      const { construction: _completed, ...finished } = b;
      return finished as BuildingDef;
    };
    const next: SettlementState = { ...s, buildings: s.buildings.map(step) };
    if (s.districts) {
      const districts: NonNullable<SettlementState["districts"]> = {};
      for (const [key, d] of Object.entries(s.districts)) districts[key] = { ...d, buildings: d.buildings.map(step) };
      next.districts = districts;
    }
    settlements[id] = next;
  }
  return { ...state, settlements };
}

/** The site's `daysRemaining` after each of `ticks` days, `null` once it is
 * finished -- one array per engine, compared element by element. */
function siteTrajectory(run: (state: GameState) => GameState, kind: BuildingDef["kind"], ticks: number): Array<number | null> {
  let state = makeState({ settlements: [makeSettlement("s0", 0, 2, 2, { buildings: [autoSite(kind)] })] });
  const out: Array<number | null> = [];
  for (let i = 0; i < ticks; i++) {
    state = run(state);
    out.push(state.settlements.s0.buildings[0].construction?.daysRemaining ?? null);
  }
  return out;
}

test("an untouched building's build time changes for NO kind: the auto crew IS today's full crew", () => {
  const TICKS = 12;
  const preCrew = (b: BuildingDef): number => 1 + effortFraction(b);
  assert.equal(BUILDABLE_KINDS.length, 43, "the palette's kind count -- a new kind is added to this domain deliberately");

  const classes = new Set<number>();
  for (const kind of BUILDABLE_KINDS) {
    classes.add(buildingBuildDays(kind));
    const site = autoSite(kind);
    // (a) The crew the invariant is about, at the kind's own operational cap or
    //     4 -- either way the top of the curve, which is today's rate.
    assert.equal(buildersOnSite(site), CONSTRUCTION_MAX_BUILDERS, `${kind}: the auto crew is a FULL crew, never 1 and never 0`);
    assert.equal(buildRate(buildersOnSite(site)), preCrew(site), `${kind}: four builders IS today's full-crew rate`);
    // (b) And the same TIME: the real pass against the pre-change pass.
    assert.deepEqual(
      siteTrajectory(advanceBuildingConstructions, kind, TICKS),
      siteTrajectory((s) => preCrewAdvance(s, preCrew), kind, TICKS),
      `${kind} (${buildingBuildDays(kind)} days): an untouched site must build in exactly the time it always did`,
    );
  }
  assert.deepEqual(
    [...classes].sort((a, b) => a - b),
    [0, 2, 3, 4, 5, 6],
    "every buildDays class the registry can produce is covered by the loop above",
  );

  // NOT VACUOUS, and this is the half that gives the comparison its teeth: the
  // design document's superseded 1.60x curve (a 0.2 step) does NOT reproduce
  // those times, so a tree that went back to it fails the rows below.
  const superseded = (b: BuildingDef): number => 1 + 0.2 * (buildersOnSite(b) - 1);
  const movedClasses = new Set(
    BUILDABLE_KINDS.filter(
      (kind) =>
        JSON.stringify(siteTrajectory((s) => preCrewAdvance(s, superseded), kind, TICKS)) !==
        JSON.stringify(siteTrajectory((s) => preCrewAdvance(s, preCrew), kind, TICKS)),
    ).map((kind) => buildingBuildDays(kind)),
  );
  assert.deepEqual(
    [...movedClasses].sort((a, b) => a - b),
    [2, 3, 4, 5, 6],
    "a 1.60x curve moves every class but the 0-day one -- which is what makes this test able to fail",
  );
});

// ── two more rows of the design's checklist, pinned (2026-11-03) ────────────

test("a crew change mid-build is a STEP: the new builders pay on the NEXT tick, and no progress is rewound", () => {
  // The day tick is the only clock (design §5.f): a rate is read once per day,
  // so adding builders mid-build changes the NEXT decrement and nothing else --
  // no re-derivation from the placement, no double credit, no negative progress.
  const started = makeSettlement("s0", 0, 2, 2, {
    buildings: [
      { gx: 0, gy: 0, kind: "goldMine", level: 1, style: "classic", workers: 1, construction: { daysRemaining: 6 } },
    ],
  });
  const afterOneTick = advanceBuildingConstructions(makeState({ settlements: [started] }));
  assert.equal(
    afterOneTick.settlements.s0.buildings[0].construction?.daysRemaining,
    5,
    "one builder: the first tick is 1.00x",
  );

  // The player adds three more builders. What the building has already built is
  // the state's, not the crew's.
  const reinforced: SettlementState = {
    ...afterOneTick.settlements.s0,
    buildings: [{ ...afterOneTick.settlements.s0.buildings[0], workers: 4 }],
  };
  let state = makeState({ settlements: [reinforced] });
  const after: Array<number | null> = [];
  for (let i = 0; i < 4; i++) {
    state = advanceBuildingConstructions(state);
    after.push(state.settlements.s0.buildings[0].construction?.daysRemaining ?? null);
  }
  assert.deepEqual(
    after,
    [3, 1, null, null],
    "5 days at 2.00x: 3, 1, done -- and the 1-day overshoot is discarded, never carried",
  );
  assert.equal(after.indexOf(null) + 1, Math.ceil(5 / buildRate(4)), "the ticks it took match its REMAINING days at the new rate");
  assert.equal(1 + after.indexOf(null) + 1, Math.ceil(6 / buildRate(4)) + 1, "and the slow first tick is remembered, not re-derived");
});

test("the pool counts a site at the CONSTRUCTION ceiling, and an auto-crewed one spends nothing", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    buildings: [
      { gx: 0, gy: 0, kind: "house", level: 1, style: "classic", workers: 4, construction: { daysRemaining: 4 } },
      { gx: 2, gy: 0, kind: "house", level: 1, style: "classic", construction: { daysRemaining: 4 } },
      { gx: 4, gy: 0, kind: "house", level: 1, style: "classic" },
    ],
  });
  assert.equal(assignedWorkersExplicit(settlement), 4, "a 4-builder site is charged 4 slots, not the kind's cap of 1");
  // The auto crew is COUNTED at the ceiling while the building is a site -- a
  // house site is 4 slots, not the 1 its finished cap gives -- and spends none
  // of the pool (nothing explicit is assigned).
  assert.equal(autoStaffedSlots(settlement), 5, "the auto SITE counts 4 and the finished auto house counts 1");
  assert.equal(staffingCeiling(settlement.buildings[0]), 4, "and the ceiling is why");
});

test("a district site builds by the same rule: staffed it advances, unstaffed it stalls", () => {
  // The rule is kind-blind and district-blind (design §5.h): the same ceiling,
  // the same curve, the same stall. This is the half the browser fixture cannot
  // reach without crewing a district building on the canvas.
  const settlement: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, { buildings: [] }),
    districts: {
      "3,2": {
        q: 3,
        r: 2,
        citySpots: [],
        buildings: [
          { gx: 0, gy: 0, kind: "goldMine", level: 1, style: "classic", workers: 1, construction: { daysRemaining: 10 } },
          { gx: 2, gy: 0, kind: "goldMine", level: 1, style: "classic", workers: 4, construction: { daysRemaining: 10 } },
          { gx: 4, gy: 0, kind: "goldMine", level: 1, style: "classic", workers: 0, construction: { daysRemaining: 10 } },
        ],
      },
    },
  };
  const after = advanceBuildingConstructions(makeState({ settlements: [settlement] }));
  const days = after.settlements.s0.districts!["3,2"].buildings.map((b) => b.construction?.daysRemaining);
  assert.equal(days[0], 9, "one builder on a district site: 1.00x");
  assert.equal(days[1], 8, "a full crew on a district site: 2.00x");
  assert.equal(days[2], 10, "nobody on a district site: no progress at all");
});
