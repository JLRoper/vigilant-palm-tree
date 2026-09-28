import { test } from "node:test";
import assert from "node:assert/strict";
import { applyGarrisonUpkeep, applyWeeklyUpkeep, normalizePlatoons, platoonTroopTotal, settlementStacks, trimPlatoonsFromEnd } from "@heroes/engine";
import type { Platoon, SettlementId, SettlementState } from "@heroes/contracts";
import { emptyWarehouse, makeSettlement, makeState } from "../charter/_helpers";

function settlementWithStacks(
  id: SettlementId,
  stacks: Platoon[],
  gold: number,
  food = 0,
  ownerId: number | null = 0,
): SettlementState {
  return {
    ...makeSettlement(id, ownerId, 5, 5, { gold, warehouse: emptyWarehouse({ food }) }),
    stacks,
  };
}

test("garrisonUpkeep: a covered treasury pays 1 gold and 1 food per troop", () => {
  const stacks: Platoon[] = [
    { entries: [{ unitTypeId: "swordsman", count: 7 }] },
    { entries: [{ unitTypeId: "archer", count: 5 }] },
  ];
  const after = applyGarrisonUpkeep({ s0: settlementWithStacks("s0", stacks, 100, 50) });
  assert.equal(after.s0.gold, 100 - 12);
  assert.equal(platoonTroopTotal(settlementStacks(after.s0)), 12, "the garrison survives when gold covers upkeep");
  assert.equal(after.s0.warehouse.food, 50 - 12);
});

test("garrisonUpkeep: an empty treasury trims the garrison from the end down to what gold covers", () => {
  const stacks: Platoon[] = [
    { entries: [{ unitTypeId: "swordsman", count: 12 }] },
    { entries: [{ unitTypeId: "archer", count: 8 }] },
    { entries: [{ unitTypeId: "cavalry", count: 4 }] },
  ];
  const after = applyGarrisonUpkeep({ s0: settlementWithStacks("s0", stacks, 3, 100) });
  assert.equal(after.s0.gold, 0);
  assert.deepEqual(
    settlementStacks(after.s0),
    normalizePlatoons(trimPlatoonsFromEnd(stacks, 24 - 3)),
    "24 troops owe 24 gold but only 3 is available; last platoons/entries desert first",
  );
  assert.equal(platoonTroopTotal(settlementStacks(after.s0)), 3);
  assert.equal(after.s0.warehouse.food, 76, "food drains by the pre-trim troop total, mirroring applyHeroUpkeep");
});

test("garrisonUpkeep: food drains up to the stock and floors at 0", () => {
  const stacks: Platoon[] = [{ entries: [{ unitTypeId: "swordsman", count: 10 }] }];
  const after = applyGarrisonUpkeep({ s0: settlementWithStacks("s0", stacks, 1000, 4) });
  assert.equal(after.s0.gold, 1000 - 10);
  assert.equal(after.s0.warehouse.food, 0, "4 food feeds 4 of 10 troops, never negative");

  const dry = applyGarrisonUpkeep({ s0: settlementWithStacks("s0", stacks, 100, 0) });
  assert.equal(dry.s0.warehouse.food, 0, "a zero stock stays at zero");
  assert.equal(dry.s0.gold, 100 - 10);
});

test("garrisonUpkeep: unowned settlements are skipped entirely", () => {
  const stacks: Platoon[] = [{ entries: [{ unitTypeId: "swordsman", count: 5 }] }];
  const after = applyGarrisonUpkeep({ s0: settlementWithStacks("s0", stacks, 100, 50, null) });
  assert.equal(after.s0.gold, 100);
  assert.equal(platoonTroopTotal(settlementStacks(after.s0)), 5);
  assert.equal(after.s0.warehouse.food, 50);
});

test("garrisonUpkeep: a troop-less settlement is untouched", () => {
  const settlement = makeSettlement("s0", 0, 5, 5, { gold: 500, warehouse: emptyWarehouse({ food: 20 }) });
  const after = applyGarrisonUpkeep({ s0: settlement });
  assert.equal(after.s0.gold, 500);
  assert.equal(after.s0.warehouse.food, 20);
  assert.equal(after.s0.stacks, undefined, "no stacks field is manufactured for a garrison-less settlement");
});

test("wire-check: applyWeeklyUpkeep applies garrison upkeep alongside hero upkeep", () => {
  const covered = settlementWithStacks(
    "s0",
    [
      { entries: [{ unitTypeId: "swordsman", count: 7 }] },
      { entries: [{ unitTypeId: "archer", count: 5 }] },
    ],
    100,
    50,
  );
  const short = settlementWithStacks(
    "s1",
    [
      { entries: [{ unitTypeId: "swordsman", count: 12 }] },
      { entries: [{ unitTypeId: "archer", count: 8 }] },
      { entries: [{ unitTypeId: "cavalry", count: 4 }] },
    ],
    3,
    0,
  );
  const after = applyWeeklyUpkeep(makeState({ settlements: [covered, short] }), 0.1);
  assert.equal(after.settlements.s0.gold, 88, "12 covered troops cost 12 gold");
  assert.equal(platoonTroopTotal(settlementStacks(after.settlements.s0)), 12);
  assert.equal(after.settlements.s1.gold, 0, "a 3-gold treasury cannot pay for 24 troops");
  assert.equal(platoonTroopTotal(settlementStacks(after.settlements.s1)), 3, "the unpaid garrison shrank to 3 survivors");
  assert.equal(after.dirty, true);
});
