import { test } from "node:test";
import assert from "node:assert/strict";
import { toIntColumn } from "../../server/persistence/integerColumns";

// The rounding rule the whole persistence layer now shares. See that module's
// header for the full rationale; these cases pin the parts a future edit could
// plausibly get wrong.

test("toIntColumn is the identity on integers, so existing round-trip pins stay exact", () => {
  // test/persistence/gameRepo.test.ts asserts `row.gold === 42` after writing
  // 42; rounding must not perturb the overwhelmingly common integer case.
  assert.equal(toIntColumn(0), 0);
  assert.equal(toIntColumn(42), 42);
  assert.equal(toIntColumn(2500), 2500);
  assert.equal(toIntColumn(100), 100);
});

test("toIntColumn rounds to NEAREST rather than truncating toward zero", () => {
  // The regression this exists for: 4171.6 was the exact value that made every
  // EndTurn abort with `invalid input syntax for type integer`.
  assert.equal(toIntColumn(4171.6), 4172);
  assert.equal(toIntColumn(0.6), 1, "0.6 gold is real money a farm produced; a floor would destroy it on every persist");
  assert.equal(toIntColumn(6.25), 6);
  assert.equal(toIntColumn(6.75), 7);
  assert.equal(toIntColumn(0.5), 1, "Math.round rounds halves up");
  assert.equal(toIntColumn(945.45), 945);
  assert.equal(toIntColumn(98.6), 99);
});

test("toIntColumn never moves a value by more than half a coin", () => {
  for (const value of [0.1, 1.49, 2.5, 33.333, 4171.6, -4.4, 1234.5678]) {
    assert.ok(
      Math.abs(toIntColumn(value) - value) <= 0.5,
      `${value} moved to ${toIntColumn(value)}`,
    );
  }
});

test("toIntColumn collapses non-finite input to 0 instead of propagating it", () => {
  // Same defensive convention as consumption.ts's clampWarehouseNonNegative
  // (NaN -> 0) and clamp (non-finite -> min): a non-numeric purse or morale is
  // never meaningful, and NaN through Math.round is still NaN, which Postgres
  // would reject just as loudly as "4171.6".
  assert.equal(toIntColumn(NaN), 0);
  assert.equal(toIntColumn(Infinity), 0);
  assert.equal(toIntColumn(-Infinity), 0);
});

test("toIntColumn handles negative fractional input without losing the sign", () => {
  assert.equal(toIntColumn(-0.4), -0);
  assert.equal(toIntColumn(-0.6), -1);
  assert.equal(toIntColumn(-7), -7);
});