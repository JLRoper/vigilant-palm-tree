// Regression tests for the logistics fix plan (folded into the test:unit glob).
// Run: npx tsx --test test/logistics-bugs/logistics.upkeepDesertion.test.ts
//
// BUG L8: the desertion auto-remove (applyCaravanUpkeep's `remaining <= 0` branch) drops the
//   route outright — cargo aboard an IN-FLIGHT caravan (already debited from the origin at
//   load) evaporates with an id-only removal, violating docs/resource-gathering.md:204's
//   "cargo is never lost" rule.
// Evidence refs: packages/engine/src/economy/caravanUpkeep.ts:155-161 (auto-remove discards the
//   caravan and its cargo), docs/resource-gathering.md:204 ("cargo is never lost"), :205 (the
//   auto-remove rule itself).

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCaravanUpkeep } from "@heroes/engine";
import type { TradeRouteEndpoint, TradeRoutePayload } from "@heroes/contracts";
import { emptyWarehouse, makeSettlement, makeState, makeTradeRoute } from "../charter/_helpers";

const settlementEndpoint = (id: string): TradeRouteEndpoint => ({ kind: "settlement", id });
const WOOD: TradeRoutePayload = { kind: "resource", resource: "wood" };

test("the desertion auto-remove returns the caravan's in-flight cargo to the origin before disbanding", () => {
  const route = makeTradeRoute({
    id: "route0",
    from: settlementEndpoint("s0"),
    to: settlementEndpoint("s1"),
    payload: WOOD,
    wagons: 1,
    unpaidSinceDay: 7,
    caravan: { phase: "toDestination", cargo: 100, path: [{ q: 3, r: 2 }, { q: 4, r: 2 }], pathIndex: 1 },
  });
  // A BROKE origin (already debited at load: warehouse wood 0): the weekly bill can never be
  // paid, so the desertion ladder runs to its end.
  const origin = makeSettlement("s0", 0, 2, 2, { gold: 0, warehouse: emptyWarehouse() });
  const dest = makeSettlement("s1", 0, 8, 2);
  const state = makeState({ settlements: [origin, dest], tradeRoutes: [route], day: 7 });

  // Evidence: at day 21 the 2-week grace gate is open; the last wagon deserts and the route
  // auto-removes (the mechanism the fix plan must keep).
  const result = applyCaravanUpkeep(state, 21);
  assert.deepEqual(
    result.removedRouteIds,
    ["route0"],
    "evidence: the desertion ladder removed the 1-wagon route (gate open at day 21 vs unpaid since 7)",
  );
  assert.equal(result.state.tradeRoutes.length, 0, "the route is gone");

  // INTENDED (docs/resource-gathering.md:204 "cargo is never lost"): the 100 wood aboard the
  // in-flight caravan must be preserved somewhere (returned home / deposited on disband).
  const woodSomewhere =
    (result.state.settlements.s0.warehouse.wood ?? 0) +
    (result.state.settlements.s1.warehouse.wood ?? 0);
  assert.equal(
    woodSomewhere,
    100,
    `intended: the caravan's 100 in-flight wood survives the auto-remove; actual: ${woodSomewhere} — the cargo evaporated with the id-only removal`,
  );
});
