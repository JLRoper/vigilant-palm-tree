import { test } from "node:test";
import assert from "node:assert/strict";
import { toNumericColumn } from "../../server/persistence/integerColumns";

// The write-boundary guard every numeric game column write passes through.
// Since migration 027_numeric_columns.sql every such column is NUMERIC, so the
// guard's job is NOT rounding (the old toIntColumn Math.round left the granular
// tables a permanently-rounded shadow of the JSONB -- that history is in the
// module's header): values pass through at FULL PRECISION, and only the
// non-finite defense remains.

test("toNumericColumn is the identity on every finite value, integral or fractional", () => {
  // test/persistence/gameRepo.test.ts pins `row.gold === 42` after writing 42,
  // and the fractional round-trips pin 6.4 -> 6.4.
  assert.equal(toNumericColumn(0), 0);
  assert.equal(toNumericColumn(42), 42);
  assert.equal(toNumericColumn(2500), 2500);
  assert.equal(toNumericColumn(6.4), 6.4);
  assert.equal(toNumericColumn(90.4), 90.4);
  assert.equal(toNumericColumn(4171.6), 4171.6, "4171.6 was the exact value the old INTEGER column rejected");
  assert.equal(toNumericColumn(0.30000000000000004), 0.30000000000000004, "float-sum artifacts must survive too: the granular mirror stays byte-identical to the JSONB source");
  assert.equal(toNumericColumn(-7.25), -7.25);
});

test("toNumericColumn no longer moves a fractional value at all", () => {
  // The old test asserted |f(value) - value| <= 0.5 (rounding can't move a
  // value by more than half a coin). The shadow that limit permitted is now
  // the thing that is dead: the guard must be EXACT.
  for (const value of [0.1, 1.49, 2.5, 6.45, 33.333, 4171.6, -4.4, 1234.5678]) {
    assert.equal(toNumericColumn(value), value, `${value} must round-trip untouched`);
  }
});

test("toNumericColumn collapses non-finite input to 0 instead of propagating it", () => {
  // Same defensive convention as consumption.ts's clampWarehouseNonNegative
  // (NaN -> 0) and clamp (non-finite -> min): a non-numeric purse or morale is
  // never meaningful, and Postgres rejects NaN/Infinity input as loudly as it
  // once rejected "4171.6".
  assert.equal(toNumericColumn(NaN), 0);
  assert.equal(toNumericColumn(Infinity), 0);
  assert.equal(toNumericColumn(-Infinity), 0);
});
