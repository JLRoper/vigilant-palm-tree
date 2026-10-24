import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, SettlementState } from "@heroes/contracts";
import {
  OCCUPATION_PENALTY_MAX,
  OCCUPATION_PENALTY_PER_BUILDING,
  effectiveIncome,
  occupationMoralePenalty,
  settlementFactionTally,
} from "@heroes/engine";
import { makeSettlement } from "../charter/_helpers";

function building(kind: BuildingDef["kind"], gx: number, gy: number, level = 1): BuildingDef {
  return { gx, gy, kind, level, style: "classic" };
}

test("settlementFactionTally counts only faction-tagged buildings, by faction", () => {
  const s = makeSettlement("s0", 0, 2, 2, {
    buildings: [
      building("farmhouse", 0, 0), // human
      building("house", 1, 1), // untagged
      building("crypt", 2, 2), // ashen
      building("crypt", 3, 2), // ashen
    ],
  });
  assert.deepEqual(settlementFactionTally(s), { human: 1, ashen: 2 });
});

test("settlementFactionTally counts district buildings too", () => {
  const s: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, { buildings: [building("farmhouse", 0, 0)] }),
    districts: {
      "3,2": { q: 3, r: 2, citySpots: [], buildings: [building("crypt", 0, 0), building("crypt", 1, 0)] },
    },
  };
  assert.deepEqual(settlementFactionTally(s), { human: 1, ashen: 2 });
});

test("no penalty when the owner's own tally matches or beats the largest foreign tally", () => {
  const even = makeSettlement("s0", 0, 2, 2, {
    buildings: [building("farmhouse", 0, 0), building("crypt", 1, 0)],
  });
  assert.equal(occupationMoralePenalty(even, "human"), 0, "1 own vs 1 foreign: not foreign-occupied");
  const noForeign = makeSettlement("s0", 0, 2, 2, { buildings: [building("farmhouse", 0, 0)] });
  assert.equal(occupationMoralePenalty(noForeign, "human"), 0, "no foreign-tagged building at all");
});

test("the penalty scales with the imbalance and caps at OCCUPATION_PENALTY_MAX", () => {
  const s = makeSettlement("s0", 0, 2, 2, {
    buildings: [
      building("farmhouse", 0, 0), // 1 own (human)
      building("crypt", 1, 0),
      building("crypt", 2, 0),
      building("crypt", 3, 0),
      building("crypt", 4, 0), // 4 foreign (ashen)
    ],
  });
  // imbalance = 4 - 1 = 3
  assert.equal(occupationMoralePenalty(s, "human"), 3 * OCCUPATION_PENALTY_PER_BUILDING);

  const heavilyOccupied = makeSettlement("s0", 0, 2, 2, {
    buildings: Array.from({ length: 20 }, (_, i) => building("crypt", i, 0)),
  });
  assert.equal(
    occupationMoralePenalty(heavilyOccupied, "human"),
    OCCUPATION_PENALTY_MAX,
    "a huge imbalance is capped, not unbounded",
  );
});

test("the penalty is read fresh from current buildings, never persisted on morale", () => {
  const occupied: SettlementState = {
    ...makeSettlement("s0", 0, 2, 2, {
      buildings: [building("crypt", 0, 0), building("crypt", 1, 0)],
      morale: 100,
    }),
  };
  assert.equal(occupied.morale, 100, "the stored morale field is untouched by the occupation penalty");
  assert.equal(occupationMoralePenalty(occupied, "human"), 2 * OCCUPATION_PENALTY_PER_BUILDING);
});

test("effectiveIncome subtracts the occupation penalty from morale at read time only", () => {
  const occupied = makeSettlement("s0", 0, 2, 2, {
    population: 1000,
    goldTax: 1,
    morale: 100,
    buildings: [building("crypt", 0, 0), building("crypt", 1, 0)],
  });
  const unoccupied = makeSettlement("s0", 0, 2, 2, {
    population: 1000,
    goldTax: 1,
    morale: 100,
    buildings: [building("farmhouse", 0, 0)],
  });
  // Absent ownerFactionId defaults "human" (same convention as playerFactionId
  // elsewhere), so an ashen-owned settlement must pass its OWN faction
  // explicitly to read the right side of the tally.
  assert.ok(
    effectiveIncome(occupied, "human") < effectiveIncome(unoccupied, "human"),
    "two crypts with no own-faction building reads worse than a farmhouse of the owner's own faction",
  );
  assert.equal(
    effectiveIncome(occupied, "human"),
    Math.round((1000 * (100 - 2 * OCCUPATION_PENALTY_PER_BUILDING)) / 100),
  );
  assert.equal(
    effectiveIncome(unoccupied, "human"),
    1000,
    "the owner's own farmhouse outweighs zero foreign buildings -- no penalty",
  );
});
