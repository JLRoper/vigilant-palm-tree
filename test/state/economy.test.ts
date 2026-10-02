import { test } from "node:test";
import assert from "node:assert/strict";
import {
  foodRequired,
  buildingUpkeepRequired,
  foodDeficitRatio,
  suppliesDeficitRatio,
  moraleDecay,
  applyMoraleDecay,
  effectiveIncome,
  clampMorale,
  clampWarehouseNonNegative,
  FOOD_PER_POPULATION,
  MORALE_DECAY_PER_DEFICIT_RATIO,
  LOW_MORALE_EXTRA_DECAY,
  MORALE_RECOVERY_PER_SUPPLIED_TURN,
  MORALE_TAX_INCOME_DIVISOR,
} from "@heroes/engine";
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
    buildings: [],
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

test("buildingUpkeepRequired sums per-building registry upkeep (0 with no buildings)", () => {
  assert.deepEqual(buildingUpkeepRequired(makeSettlement({ level: 1 })), { wood: 0, stone: 0 });
  assert.deepEqual(buildingUpkeepRequired(makeSettlement({ level: 3 })), { wood: 0, stone: 0 });
  const built = makeSettlement({
    buildings: [
      { gx: 1, gy: 1, kind: "house", level: 1, style: "classic" },
      { gx: 2, gy: 2, kind: "tower", level: 2, style: "classic" },
    ],
  });
  assert.deepEqual(buildingUpkeepRequired(built), { wood: 3, stone: 2 });
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

test("suppliesDeficitRatio: 0 with no buildings (no upkeep required)", () => {
  const s = makeSettlement({ warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 } });
  assert.equal(suppliesDeficitRatio(s), 0);
});

const UPKEEP_BUILDINGS = [
  { gx: 1, gy: 1, kind: "house", level: 1, style: "classic" },
  { gx: 2, gy: 2, kind: "tower", level: 2, style: "classic" },
] as const;

function stockedSettlement(wood: number, stone: number): SettlementState {
  return makeSettlement({ buildings: [...UPKEEP_BUILDINGS], warehouse: { wood, stone, iron: 0, arcane: 0, food: 0 } });
}

test("suppliesDeficitRatio: a wood surplus does not mask a stone shortfall (the pooled-ratio bug)", () => {
  // house L1 + tower L2 cost 3 wood and 2 stone. Pooled, 300 wood against that
  // 5-unit bill read as "have 300, need 5 -> ratio 0", so a settlement that could
  // not pay a single stone owed nothing.
  assert.deepEqual(buildingUpkeepRequired(stockedSettlement(300, 0)), { wood: 3, stone: 2 });
  assert.equal(suppliesDeficitRatio(stockedSettlement(300, 0)), 1, "2 of 2 stone missing is a total stone deficit");
  assert.equal(suppliesDeficitRatio(stockedSettlement(0, 300)), 1, "3 of 3 wood missing is a total wood deficit");
  assert.equal(suppliesDeficitRatio(stockedSettlement(0, 0)), 1, "both missing stays a total deficit, as before");
});

test("suppliesDeficitRatio: 0 when both resources are covered", () => {
  assert.equal(suppliesDeficitRatio(stockedSettlement(3, 2)), 0);
  assert.equal(suppliesDeficitRatio(stockedSettlement(300, 300)), 0, "a surplus in both is still 0");
});

test("suppliesDeficitRatio: the WORSE resource sets the ratio, so a partial shortfall is not averaged away", () => {
  // Wood half covered (ratio 2/3), stone fully covered -> the wood shortfall decides.
  assert.equal(Math.round(suppliesDeficitRatio(stockedSettlement(1, 2)) * 1000) / 1000, 0.667);
  // Stone untouched but wood empty -> the wood shortfall decides.
  assert.equal(suppliesDeficitRatio(stockedSettlement(0, 2)), 1);
  // Wood covered, stone empty -> the stone shortfall decides.
  assert.equal(suppliesDeficitRatio(stockedSettlement(3, 0)), 1);
});

test("suppliesDeficitRatio: a resource with no upkeep owed contributes no ratio", () => {
  const woodOnly = makeSettlement({
    buildings: [{ gx: 0, gy: 0, kind: "house", level: 1, style: "classic" }],
    warehouse: { wood: 99, stone: 0, iron: 0, arcane: 0, food: 0 },
  });
  assert.deepEqual(buildingUpkeepRequired(woodOnly), { wood: 1, stone: 0 });
  assert.equal(suppliesDeficitRatio(woodOnly), 0, "an empty stone store is irrelevant when no stone upkeep exists");
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

const FED = { wood: 0, stone: 0, iron: 0, arcane: 0, food: 5 };

test("MORALE_RECOVERY_PER_SUPPLIED_TURN is the bounded per-turn recovery", () => {
  assert.equal(MORALE_RECOVERY_PER_SUPPLIED_TURN, 4);
});

test("applyMoraleDecay: a fully supplied settlement below 100 climbs instead of ratcheting", () => {
  const half = applyMoraleDecay(makeSettlement({ population: 500, warehouse: FED, morale: 50 }));
  assert.equal(half.morale, 54);
  const bottom = applyMoraleDecay(makeSettlement({ population: 500, warehouse: FED, morale: 0 }));
  assert.equal(bottom.morale, 4, "a settlement that fell to zero is recoverable, not stuck at zero forever");
});

test("applyMoraleDecay: a fully supplied settlement recovers even below the low-morale threshold", () => {
  // LOW_MORALE_EXTRA_DECAY would otherwise keep moraleDecay() positive at zero
  // shortfall and sink a fed settlement 1 point per turn forever.
  const s = applyMoraleDecay(makeSettlement({ population: 500, warehouse: FED, morale: 40 }));
  assert.equal(s.morale, 44);
  assert.equal(moraleDecay(makeSettlement({ population: 500, warehouse: FED, morale: 40 })), LOW_MORALE_EXTRA_DECAY);
});

test("applyMoraleDecay: recovery is clamped at 100", () => {
  assert.equal(applyMoraleDecay(makeSettlement({ population: 500, warehouse: FED, morale: 98 })).morale, 100);
  assert.equal(applyMoraleDecay(makeSettlement({ population: 500, warehouse: FED, morale: 100 })).morale, 100);
});

test("applyMoraleDecay: a settlement in food deficit decays and never recovers", () => {
  const hungry = { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 };
  assert.equal(applyMoraleDecay(makeSettlement({ population: 500, warehouse: hungry, morale: 90 })).morale, 80);
});

test("applyMoraleDecay: a supplies deficit masks no recovery either -- decay wins", () => {
  const starved = applyMoraleDecay(stockedSettlement(0, 0));
  assert.equal(starved.morale, 100 - MORALE_DECAY_PER_DEFICIT_RATIO * suppliesDeficitRatio(stockedSettlement(0, 0)));
  assert.equal(starved.morale, 90);
});

test("applyMoraleDecay: decay clamps at 0 (never negative)", () => {
  const spent = applyMoraleDecay(makeSettlement({ population: 500, warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 }, morale: 2 }));
  assert.equal(spent.morale, 0);
});

test("applyMoraleDecay writes an integer, never the fractional ratio", () => {
  // moraleDecay is a continuous ratio (deficit / required), so a partial
  // shortfall produced 58.099999999999994 in the settlement panel. The rounding
  // lives at the write so persisted morale never carries a fraction.
  const partial = stockedSettlement(1, 2);
  assert.equal(suppliesDeficitRatio(partial), (3 - 1) / 3, "the raw ratio is fractional");
  assert.equal(Number.isInteger(moraleDecay(partial)), false, "and so is the decay built from it");

  const one = applyMoraleDecay(partial);
  assert.equal(one.morale, 93);
  assert.ok(Number.isInteger(one.morale), `morale must be an integer, got ${one.morale}`);

  // Every seed, at every starting morale: never fractional.
  for (let seed = 1; seed <= 200; seed++) {
    const wood = seed % 4;
    const stone = Math.floor(seed / 4) % 3;
    const start = (seed % 101) - 1;
    const next = applyMoraleDecay(
      makeSettlement({
        buildings: [...UPKEEP_BUILDINGS],
        warehouse: { wood, stone, iron: 0, arcane: 0, food: seed % 7 },
        population: (seed % 11) * 100,
        morale: start,
      }),
    );
    assert.ok(Number.isInteger(next.morale), `seed ${seed}: morale ${next.morale} is fractional`);
    assert.ok(next.morale >= 0 && next.morale <= 100, `seed ${seed}: morale ${next.morale} escaped [0, 100]`);
  }
});

test("applyMoraleDecay rounding keeps both clamp bounds at 0 and 100", () => {
  const empty = { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 };
  assert.equal(applyMoraleDecay(makeSettlement({ population: 500, warehouse: empty, morale: 5 })).morale, 0);
  assert.equal(applyMoraleDecay(makeSettlement({ population: 500, warehouse: empty, morale: 1 })).morale, 0);
  const fed = { wood: 0, stone: 0, iron: 0, arcane: 0, food: 5 };
  assert.equal(applyMoraleDecay(makeSettlement({ population: 500, warehouse: fed, morale: 97 })).morale, 100);
  assert.equal(applyMoraleDecay(makeSettlement({ population: 500, warehouse: fed, morale: 100 })).morale, 100);
});

test("applyMoraleDecay leaves every other field untouched", () => {
  const s = makeSettlement({ population: 500, warehouse: FED, morale: 70, gold: 123, goldTax: 2 });
  const next = applyMoraleDecay(s);
  assert.equal(next.gold, 123);
  assert.equal(next.goldTax, 2);
  assert.equal(next.population, 500);
  assert.deepEqual(next.warehouse, FED, "consumption is a separate step");
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