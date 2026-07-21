import { test } from "node:test";
import assert from "node:assert/strict";
import {
  foodRequired,
  buildingUpkeepRequired,
  foodDeficitRatio,
  suppliesDeficitRatio,
  moraleDecay,
  effectiveIncome,
  clampMorale,
  clampWarehouseNonNegative,
  FOOD_PER_POPULATION,
  BUILDING_UPKEEP_WOOD,
  BUILDING_UPKEEP_STONE,
  MORALE_DECAY_PER_DEFICIT_RATIO,
  LOW_MORALE_EXTRA_DECAY,
  MORALE_TAX_INCOME_DIVISOR,
} from "../../src/economy/consumption";
import type { SettlementState } from "../../src/state/gameState";

function makeSettlement(overrides: Partial<SettlementState> = {}): SettlementState {
  return {
    id: "s",
    name: "Test",
    ownerId: 0,
    q: 0,
    r: 0,
    level: 1,
    population: 0,
    goldTax: 0,
    resourceRates: {},
    foundedOnResource: null,
    gold: 0,
    warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
    morale: 100,
    autoTrade: true,
    ...overrides,
  };
}

test("foodRequired returns ceil(population / FOOD_PER_POPULATION)", () => {
  assert.equal(foodRequired(makeSettlement({ population: 0 })), 0);
  assert.equal(foodRequired(makeSettlement({ population: 100 })), 1);
  assert.equal(foodRequired(makeSettlement({ population: 101 })), 2);
  assert.equal(foodRequired(makeSettlement({ population: 500 })), 5);
  assert.equal(foodRequired(makeSettlement({ population: 999 })), 10);
});

test("FOOD_PER_POPULATION defaults to 100", () => {
  assert.equal(FOOD_PER_POPULATION, 100);
});

test("buildingUpkeepRequired returns BUILDING_UPKEEP_* scaled by level (0 for now)", () => {
  assert.deepEqual(buildingUpkeepRequired(makeSettlement({ level: 1 })), { wood: 0, stone: 0 });
  assert.deepEqual(buildingUpkeepRequired(makeSettlement({ level: 2 })), { wood: 0, stone: 0 });
  assert.deepEqual(buildingUpkeepRequired(makeSettlement({ level: 3 })), { wood: 0, stone: 0 });
  assert.equal(BUILDING_UPKEEP_WOOD, 0);
  assert.equal(BUILDING_UPKEEP_STONE, 0);
});

test("foodDeficitRatio: 0 when warehouse has enough food", () => {
  const s = makeSettlement({ population: 500, warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 5 } });
  assert.equal(foodDeficitRatio(s), 0);
});

test("foodDeficitRatio: 1 when warehouse has zero food and population requires food", () => {
  const s = makeSettlement({ population: 500, warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 } });
  assert.equal(foodDeficitRatio(s), 1);
});

test("foodDeficitRatio: 0 when no population", () => {
  const s = makeSettlement({ population: 0, warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 } });
  assert.equal(foodDeficitRatio(s), 0);
});

test("foodDeficitRatio: partial ratio when partial food", () => {
  const s = makeSettlement({ population: 1000, warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 5 } });
  assert.equal(foodRequired(s), 10);
  assert.equal(foodDeficitRatio(s), 0.5);
});

test("suppliesDeficitRatio: 0 because BUILDING_UPKEEP is 0", () => {
  const s = makeSettlement({ warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 } });
  assert.equal(suppliesDeficitRatio(s), 0);
});

test("moraleDecay: 0 when fully supplied", () => {
  const s = makeSettlement({ population: 500, warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 5 }, morale: 100 });
  assert.equal(moraleDecay(s), 0);
});

test("moraleDecay: includes LOW_MORALE_EXTRA_DECAY when morale < 50", () => {
  const s = makeSettlement({ population: 500, warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 5 }, morale: 40 });
  assert.equal(moraleDecay(s), LOW_MORALE_EXTRA_DECAY);
});

test("moraleDecay: food deficit at full ratio gives MORALE_DECAY_PER_DEFICIT_RATIO", () => {
  const s = makeSettlement({ population: 500, warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 }, morale: 100 });
  assert.equal(moraleDecay(s), MORALE_DECAY_PER_DEFICIT_RATIO);
});

test("moraleDecay: full food deficit + low morale = ratio*10 + 1", () => {
  const s = makeSettlement({ population: 500, warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 }, morale: 30 });
  assert.equal(moraleDecay(s), MORALE_DECAY_PER_DEFICIT_RATIO + LOW_MORALE_EXTRA_DECAY);
});

test("effectiveIncome scales linearly with morale", () => {
  const base = makeSettlement({ population: 500, goldTax: 1, morale: 100 });
  assert.equal(effectiveIncome(base), 500);
  const half = makeSettlement({ population: 500, goldTax: 1, morale: 50 });
  assert.equal(effectiveIncome(half), 250);
  const zero = makeSettlement({ population: 500, goldTax: 1, morale: 0 });
  assert.equal(effectiveIncome(zero), 0);
});

test("effectiveIncome clamps morale to [0, 100]", () => {
  const neg = makeSettlement({ population: 1000, goldTax: 1, morale: -10 });
  assert.equal(effectiveIncome(neg), 0);
  const over = makeSettlement({ population: 1000, goldTax: 1, morale: 200 });
  assert.equal(effectiveIncome(over), 1000);
});

test("effectiveIncome: morale=67% on 500 pop × 1 tax = 335 (rounded)", () => {
  const s = makeSettlement({ population: 500, goldTax: 1, morale: 67 });
  assert.equal(effectiveIncome(s), Math.round((500 * 1 * 67) / MORALE_TAX_INCOME_DIVISOR));
});

test("clampMorale clamps to [0, 100]", () => {
  assert.equal(clampMorale(-5), 0);
  assert.equal(clampMorale(0), 0);
  assert.equal(clampMorale(50), 50);
  assert.equal(clampMorale(100), 100);
  assert.equal(clampMorale(150), 100);
  assert.equal(clampMorale(NaN), 0);
});

test("clampWarehouseNonNegative floors negatives and rejects NaN", () => {
  assert.equal(clampWarehouseNonNegative(-3), 0);
  assert.equal(clampWarehouseNonNegative(0), 0);
  assert.equal(clampWarehouseNonNegative(7), 7);
  assert.equal(clampWarehouseNonNegative(7.9), 7);
  assert.equal(clampWarehouseNonNegative(NaN), 0);
});