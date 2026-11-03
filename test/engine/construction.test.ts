import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, SettlementState } from "@heroes/contracts";
import {
  advanceBuildingConstructions,
  assignedWorkersExplicit,
  BUILD_RATE_PER_EXTRA_BUILDER,
  buildersOnSite,
  buildRate,
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

