import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CELL_MULTIPLIER_PEAK,
  CELL_MULTIPLIER_SIGMA,
  SPOT_MULTIPLIER_PEAK,
  cellMultiplier,
  type CellMultiplierInput,
} from "@heroes/engine";

function input(overrides: Partial<CellMultiplierInput> = {}): CellMultiplierInput {
  return {
    seed: 42,
    q: 7,
    r: -3,
    gx: 2,
    gy: 4,
    resource: "gold",
    spots: [],
    ...overrides,
  };
}

test("cellMultiplier is deterministic: same inputs, same value, in any call order", () => {
  const a = cellMultiplier(input());
  const b = cellMultiplier(input());
  const c = cellMultiplier(input({ resource: "wood" }));
  const d = cellMultiplier(input({ resource: "wood" }));
  assert.equal(a, b);
  assert.equal(c, d);
});

test("cellMultiplier rounds to 2 decimals", () => {
  for (let seed = 0; seed < 500; seed++) {
    const m = cellMultiplier(input({ seed, gx: seed % 25, gy: (seed * 7) % 25 }));
    assert.ok(
      Math.abs(m * 100 - Math.round(m * 100)) < 1e-6,
      `seed ${seed} produced ${m}, not a 2-decimal value`,
    );
  }
});

test("normal cells center on the 1.0 peak across seeds", () => {
  let sum = 0;
  const n = 3000;
  for (let seed = 0; seed < n; seed++) {
    sum += cellMultiplier(input({ seed, gx: seed % 25, gy: (seed * 3) % 25 }));
  }
  const mean = sum / n;
  assert.ok(
    Math.abs(mean - CELL_MULTIPLIER_PEAK) < 0.05,
    `expected mean near ${CELL_MULTIPLIER_PEAK}, got ${mean}`,
  );
});

test("a spot cell's own resource centers on the 3.0 peak; other resources stay at 1.0", () => {
  const spots = [{ cell: { x: 2, y: 4 }, resource: "gold" as const }];
  const n = 3000;
  let goldSum = 0;
  let foodSum = 0;
  for (let seed = 0; seed < n; seed++) {
    goldSum += cellMultiplier(input({ seed, spots, resource: "gold" }));
    foodSum += cellMultiplier(input({ seed, spots, resource: "food" }));
  }
  const goldMean = goldSum / n;
  const foodMean = foodSum / n;
  assert.ok(
    Math.abs(goldMean - SPOT_MULTIPLIER_PEAK) < 0.05,
    `expected spot mean near ${SPOT_MULTIPLIER_PEAK}, got ${goldMean}`,
  );
  assert.ok(
    Math.abs(foodMean - CELL_MULTIPLIER_PEAK) < 0.05,
    `expected non-spot-resource mean near ${CELL_MULTIPLIER_PEAK}, got ${foodMean}`,
  );
});

test("the sigma drives spread, and different seeds do not all collapse to one value", () => {
  const values = new Set<number>();
  for (let seed = 0; seed < 200; seed++) {
    values.add(cellMultiplier(input({ seed })));
  }
  assert.ok(values.size > 40, `expected varied multipliers, got ${values.size} distinct`);
  assert.equal(CELL_MULTIPLIER_SIGMA, 0.25);
});

test("multipliers vary by cell position, settlement position, and resource", () => {
  const base = cellMultiplier(input());
  const otherCell = cellMultiplier(input({ gx: 3, gy: 4 }));
  const otherSettlement = cellMultiplier(input({ q: 8 }));
  const otherResource = cellMultiplier(input({ resource: "arcane" }));
  const distinct = new Set([base, otherCell, otherSettlement, otherResource]);
  assert.ok(distinct.size >= 3, `expected position/resource sensitivity, got ${distinct.size}`);
});
