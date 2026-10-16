// Regression tests for the logistics fix plan (folded into the test:unit glob).
// Run: npx tsx --test test/logistics-bugs/logistics.hydrateNormalize.test.ts
//
// BUG L10: normalizeTradeRoute's isCaravanState accepts a corrupt caravan (cargo is only
//   checked "finite" — a NEGATIVE cargo passes, as does an out-of-range pathIndex), and the
//   corrupted row then STEALS from the destination: advanceTradeRoutes computes
//   delivered = min(negative cargo, headroom) and applies it as a NEGATIVE delivery delta,
//   decreasing the destination's stock.
// Evidence refs: packages/engine/src/hydrate.ts:225-236 (isCaravanState: finite cargo +
//   pathIndex >= 0 only) vs the normalizer's own contract ("a record ... carrying a malformed
//   caravan ... is dropped with a warning"), packages/engine/src/logistics.ts:452-461 +
//   553-561 (delivered = min(cargo, headroom) applied unclamped).

import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceTradeRoutes, normalizeTradeRoute } from "@heroes/engine";
import { emptyWarehouse, makeSettlement, makeState } from "../charter/_helpers";

function corruptRouteJson() {
  return {
    id: "route0",
    from: { kind: "settlement", id: "s0" },
    to: { kind: "settlement", id: "s1" },
    payload: { kind: "resource", resource: "wood" },
    wagons: 1,
    caravan: { phase: "toDestination", cargo: -50, path: [{ q: 3, r: 2 }, { q: 4, r: 2 }], pathIndex: 2 },
  };
}

test("normalizeTradeRoute never accepts a corrupt caravan (negative cargo, arrived pathIndex)", () => {
  const corrupt = normalizeTradeRoute(corruptRouteJson());
  // INTENDED: the normalizer drops a corrupt row ("could not advance safely ... would crash
  // the daily tick") or clamps its cargo to >= 0.
  const acceptedWithNegativeCargo = corrupt !== null && (corrupt.caravan?.cargo ?? 0) < 0;
  assert.equal(
    acceptedWithNegativeCargo,
    false,
    `intended: the corrupt caravan is dropped (or its cargo clamped >= 0); actual: normalized and accepted with cargo ${corrupt?.caravan?.cargo}`,
  );
});

test("a corrupt caravan never steals from the destination on advance", () => {
  const corrupt = normalizeTradeRoute(corruptRouteJson());
  const state = makeState({
    settlements: [
      makeSettlement("s0", 0, 2, 2),
      makeSettlement("s1", 0, 4, 2, { warehouse: emptyWarehouse({ wood: 10 }) }),
    ],
    tradeRoutes: corrupt ? [corrupt] : [],
    activePlayerId: 0,
  });
  const after = advanceTradeRoutes(state, null);
  assert.ok(
    (after.settlements.s1.warehouse.wood ?? 0) >= 10,
    `intended: the destination's stock never decreases (corrupt row dropped or clamped); actual: wood ${after.settlements.s1.warehouse.wood} < 10 — the caravan STOLE ${10 - (after.settlements.s1.warehouse.wood ?? 0)} from the destination`,
  );
});
