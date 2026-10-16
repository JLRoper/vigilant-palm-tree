import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASE_STORAGE,
  BASE_TREASURY,
  applyEffectiveIncome,
  addStockClamped,
  buildingSettlementEffects,
  produceSettlementResources,
  settlementResourceCap,
  settlementTreasuryCap,
  treasuryHeadroom,
  warehouseHeadroom,
} from "@heroes/engine";
import { makeSettlement, makeState } from "../charter/_helpers";

test("settlementResourceCap: base scales by level, no buildings", () => {
  const s = makeSettlement("s0", 0, 0, 0, { level: 1 as 1 | 2 | 3 });
  assert.deepEqual(settlementResourceCap(s), {
    wood: 500, stone: 500, iron: 500, arcane: 500, food: 500,
  });
  const s3 = makeSettlement("s1", 0, 1, 1, { level: 3 as 1 | 2 | 3 });
  assert.equal(settlementResourceCap(s3).wood, BASE_STORAGE[3]);
  assert.equal(settlementTreasuryCap(s3), BASE_TREASURY[3]);
});

test("warehouse adds all-resource capacity, granary food-only, bank + treasury gold", () => {
  const s = makeSettlement("s0", 0, 0, 0, {
    level: 1 as 1 | 2 | 3,
    buildings: [
      { gx: 1, gy: 0, kind: "warehouse", level: 2, style: "classic" },
      { gx: 2, gy: 0, kind: "granary", level: 1, style: "classic" },
      { gx: 3, gy: 0, kind: "bank", level: 1, style: "classic" },
      { gx: 4, gy: 0, kind: "treasury", level: 1, style: "classic" },
    ],
  });
  const cap = settlementResourceCap(s);
  assert.equal(cap.wood, BASE_STORAGE[1] + 600 * 2, "warehouse 600/level × 2");
  assert.equal(cap.food, BASE_STORAGE[1] + 600 * 2 + 600, "warehouse + granary food bonus");
  assert.equal(cap.iron, BASE_STORAGE[1] + 600 * 2);
  assert.equal(
    settlementTreasuryCap(s),
    BASE_TREASURY[1] + 500 * 2 + 2000 + 2000,
    "warehouse 500/level × 2 + bank 2000 + treasury 2000",
  );
});

// The treasury kind was added to the registry without touching capacity.ts:
// settlementTreasuryCap sums `treasuryBonus` over every building, so a new
// cap-building is picked up from the registry alone. This is the pin that says
// so -- if a future refactor switches to a per-kind switch, it fails here.
test("a treasury contributes treasuryBonus with no capacity-code change", () => {
  const bare = makeSettlement("s0", 0, 0, 0, { level: 1 as 1 | 2 | 3 });
  const withTreasury = makeSettlement("s0", 0, 0, 0, {
    level: 1 as 1 | 2 | 3,
    buildings: [{ gx: 1, gy: 1, kind: "treasury", level: 1, style: "classic" }],
  });

  assert.equal(settlementTreasuryCap(withTreasury), BASE_TREASURY[1] + 2000);
  assert.equal(
    settlementTreasuryCap(withTreasury) - settlementTreasuryCap(bare),
    buildingSettlementEffects("treasury", 1).treasuryBonus,
  );
  assert.equal(
    buildingSettlementEffects("treasury", 1).treasuryBonus,
    buildingSettlementEffects("bank", 1).treasuryBonus,
    "treasury matches bank's treasury cap; the bank keeps a pot instead",
  );
});

test("treasury scales per level like every other building effect", () => {
  const s = makeSettlement("s0", 0, 0, 0, {
    level: 1 as 1 | 2 | 3,
    buildings: [{ gx: 1, gy: 1, kind: "treasury", level: 3, style: "classic" }],
  });
  assert.equal(settlementTreasuryCap(s), BASE_TREASURY[1] + 6000, "2000/level × 3");
});

// bank and treasury are cap-only: neither accrues gold per turn. The economy
// only ever credited goldMine's gold, so a bank carrying a goldPerTurn entry
// would advertise an effect the engine never applied.
test("bank and treasury add no goldPerTurn; only goldMine does", () => {
  assert.equal(buildingSettlementEffects("bank", 1).goldPerTurn, 0);
  assert.equal(buildingSettlementEffects("treasury", 1).goldPerTurn, 0);
  assert.equal(buildingSettlementEffects("goldMine", 1).goldPerTurn, 40);
});

test("addStockClamped: adds under cap, stops at cap, preserves legacy surplus", () => {
  assert.equal(addStockClamped(100, 50, 500), 150);
  assert.equal(addStockClamped(480, 50, 500), 500, "addition truncated to headroom");
  assert.equal(addStockClamped(500, 50, 500), 500);
  assert.equal(addStockClamped(900, 50, 500), 900, "legacy surplus is never destroyed");
  assert.equal(addStockClamped(499.5, 3, 500), 500, "fractional addition floors against headroom");
  assert.equal(addStockClamped(100, -5, 500), 100, "additions only; deductions are not clamped here");
  assert.equal(warehouseHeadroom(100, 500), 400);
  assert.equal(warehouseHeadroom(500, 500), 0);
  assert.equal(warehouseHeadroom(600, 500), 0);
  assert.equal(treasuryHeadroom(300, 1500), 1200);
});

test("production clamps to the settlement's stockpile caps", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    resourceRates: { wood: 100 },
    warehouse: { wood: 495, stone: 0, iron: 0, arcane: 0, food: 0 },
  });
  const [after] = Object.values(produceSettlementResources({ s0: settlement }, 0));
  assert.equal(after.warehouse.wood, 500, "100/turn rate truncated to the 5-unit headroom");
});

test("treasury clamps: producer gold and effective income stop at the treasury cap", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    population: 500,
    goldTax: 2 as 1 | 2 | 3,
    morale: 100,
    gold: BASE_TREASURY[1] - 10,
    citySpots: [],
    buildings: [{ gx: 2, gy: 2, kind: "goldMine", level: 1, style: "classic" }],
  });
  // Producer gold: mine would add ~40g but only 10 headroom exists.
  const [afterProduce] = Object.values(produceSettlementResources({ s0: settlement }, 7));
  assert.ok(
    afterProduce.gold <= BASE_TREASURY[1],
    `treasury must not exceed its cap, got ${afterProduce.gold}`,
  );
  // Effective income: 500 pop × tax 2 × 100% = 1000/turn, 10 headroom → +10.
  const afterIncome = applyEffectiveIncome(afterProduce);
  assert.equal(afterIncome.gold, BASE_TREASURY[1], "income truncated to headroom");
});
