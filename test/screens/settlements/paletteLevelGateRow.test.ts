// The settlement tiers BUY a level gate on buildings: a kind declares the
// settlement level its new placements require (the registry's `requiredLevel`,
// enforced by applyPlaceBuildings beside the faction rule), and the build
// palette must state that rule on the row instead of offering a build the
// engine will refuse. Driven through the real BuildingPlacer with the shared
// mock-DOM harness, so what is asserted is the row the player sees.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildRowButtons, openPlacer, restoreDom } from "./_cityPlacerHarness";

afterEach(() => {
  restoreDom();
});

/** A palette row by the tail of its text: the cost icons precede the label, and 2x2 kinds carry their footprint after it. */
function exactRow(root: Parameters<typeof buildRowButtons>[0], label: string) {
  const rows = buildRowButtons(root);
  const row = rows.find((b) => b.textContent.endsWith(label));
  if (!row) throw new Error(`palette row "${label}" must exist; saw ${rows.map((b) => b.textContent).join(" | ")}`);
  return row;
}

const LEVEL_2_RULE = /Requires a level 2 town \u2014 upgrade this settlement to place it/;
const LEVEL_3_RULE = /Requires a level 3 castle \u2014 upgrade this settlement to place it/;

test("a level-1 settlement's palette says which rows its tier does not include yet", () => {
  const { body } = openPlacer([], undefined, 1);

  const tiers: Record<string, RegExp> = {
    Bank: LEVEL_2_RULE,
    Treasury: LEVEL_2_RULE,
    "Grove Sanctum": LEVEL_2_RULE,
    "Deep Anvil": LEVEL_3_RULE,
    "Mage Guild": LEVEL_3_RULE,
  };
  for (const [label, rule] of Object.entries(tiers)) {
    const row = exactRow(body, label);
    assert.equal(row.disabled, true, `${label}: the keep cannot build it yet`);
    assert.match(row.title, rule, `${label}: the row says which tier unlocks it`);
  }
  // The 2x2 rows carry their footprint suffix, and keep every other line.
  const warehouse = exactRow(body, "Warehouse (2\u00D72)");
  assert.equal(warehouse.disabled, true, "Warehouse: the keep cannot build it yet");
  assert.match(warehouse.title, LEVEL_2_RULE);
  assert.match(warehouse.title, /Build time: 3 days/, "the row still prices its build time");

  // The rows the keep DOES have are untouched offers.
  for (const label of ["House", "Farmhouse", "Woodcutter's Hut", "Stone Mine", "Smithy", "Market"]) {
    const row = exactRow(body, label);
    assert.equal(row.disabled, false, `${label} is a level-1 kind`);
    assert.ok(!LEVEL_2_RULE.test(row.title) && !LEVEL_3_RULE.test(row.title), `${label} says nothing about tier`);
  }
});

test("the same rows unlock when the settlement reaches the tier", () => {
  const { body } = openPlacer([], undefined, 2);
  assert.equal(exactRow(body, "Bank").disabled, false, "a level-2 town builds a bank");
  assert.equal(exactRow(body, "Warehouse (2\u00D72)").disabled, false, "and a warehouse");
  const late = exactRow(body, "Deep Anvil");
  assert.equal(late.disabled, true, "but a castle-tier building is still out of reach");
  assert.match(late.title, LEVEL_3_RULE);

  const castle = openPlacer([], undefined, 3);
  assert.equal(exactRow(castle.body, "Deep Anvil").disabled, false, "a level-3 castle builds it");
  assert.equal(exactRow(castle.body, "Mage Guild").disabled, false);
  assert.equal(exactRow(castle.body, "Worldroot Grove").disabled, false);
});
