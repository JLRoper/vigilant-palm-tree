import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advanceBuildingConstructions,
  buildingConstructionProgress,
  constructionStageFor,
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

test("advanceBuildingConstructions decrements daily and removes the field on completion", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    buildings: [
      { gx: 0, gy: 0, kind: "goldMine", level: 1, style: "classic", construction: { daysRemaining: 2 } },
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
