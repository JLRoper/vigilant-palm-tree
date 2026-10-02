import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WAREHOUSE_RESOURCES, type ResourceType } from "@heroes/contracts";
import { computeSettlementRates, GameMap, produceSettlementResources, warehouseRates } from "@heroes/engine";
import { emptyWarehouse, makeSettlement } from "../charter/_helpers";

// `resourceRates` is computed from map resource tiles, so a settlement founded
// near a gold tile carries a gold entry -- and the settlement panel rendered it
// as "N/turn". Nothing ever paid it: gold is not a WAREHOUSE_RESOURCE, so
// produceSettlementResources cannot deliver it and the turn loop credits gold
// only from effectiveIncome (tax) and gold producers. The panel now lists the
// rates through warehouseRates, the same function production uses.

test("gold is not a warehouse resource, so it can never appear as a delivered rate", () => {
  assert.equal(WAREHOUSE_RESOURCES.includes("gold" as ResourceType), false);
});

test("warehouseRates drops gold and every non-positive entry, keeping warehouse order", () => {
  assert.deepEqual(
    warehouseRates({ gold: 40, wood: 3, stone: 0, iron: -5, arcane: 2, food: 0 }),
    [
      { resource: "wood", perTurn: 3 },
      { resource: "arcane", perTurn: 2 },
    ],
  );
  assert.deepEqual(warehouseRates({ gold: 40 }), [], "a gold-only rate map delivers nothing at all");
  assert.deepEqual(warehouseRates({}), []);
  for (const entry of warehouseRates({ wood: 1, stone: 1, iron: 1, arcane: 1, food: 1, gold: 1 })) {
    assert.ok(WAREHOUSE_RESOURCES.includes(entry.resource), `${entry.resource} is a warehouse resource`);
    assert.ok(entry.perTurn > 0);
  }
});

test("produceSettlementResources never credits a gold rate map entry to the treasury", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 300,
    warehouse: emptyWarehouse(),
    resourceRates: { gold: 40, wood: 3 },
  });
  const [after] = Object.values(produceSettlementResources({ s0: settlement }, 7));
  assert.equal(after.gold, 300, "the phantom gold income does not exist");
  assert.equal(after.warehouse.wood, 3, "the warehouse rates it advertises are the ones it pays");
});

test("every rate the panel can list is credited at exactly that rate", () => {
  const rates = { gold: 40, wood: 12, stone: 4, iron: 0, arcane: 6, food: 2 };
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 0,
    warehouse: emptyWarehouse(),
    resourceRates: rates,
  });
  const [after] = Object.values(produceSettlementResources({ s0: settlement }, 7));
  for (const { resource, perTurn } of warehouseRates(rates)) {
    assert.equal(after.warehouse[resource], perTurn, `${resource} pays the rate the panel shows`);
  }
});

test("computeSettlementRates really does produce the gold entry the panel used to render", () => {
  // Pins WHY the gold line existed: the map scan adds every resource type it
  // finds, gold included. The fix is the display side; this test keeps the
  // producer side honest so nobody "fixes" it by deleting the rate instead.
  const map = new GameMap(99, "small");
  let sawGold = false;
  for (let q = 0; q < map.width && !sawGold; q++) {
    for (let r = 0; r < map.height && !sawGold; r++) {
      if (map.resourceTileAt(q, r)?.resource !== "gold") continue;
      const computed = computeSettlementRates(map, q, r, 1);
      sawGold = (computed.rates.gold ?? 0) > 0;
    }
  }
  assert.ok(sawGold, "expected at least one gold rate on this seed; the map scan may have changed");
  assert.equal(warehouseRates(computeSettlementRates(map, 2, 2, 1).rates).some((r) => r.resource === "gold"), false);
});

test("the settlement panel renders through warehouseRates and no longer indexes resourceRates", () => {
  // settlementPanel.ts is a DOM module (its import graph reaches Vite ?url
  // assets), so this is a source guard in the coverage-guard style of
  // test/data/unitIcons.coverage.test.ts rather than a live render.
  const source = readFileSync(
    fileURLToPath(new URL("../../src/screens/settlements/settlementPanel.ts", import.meta.url)),
    "utf8",
  );
  assert.ok(source.includes("warehouseRates("), "the panel must list rates through warehouseRates");
  assert.equal(
    source.includes("resourceRates["),
    false,
    "the panel must not index resourceRates directly -- that is how the phantom gold line came back",
  );
});