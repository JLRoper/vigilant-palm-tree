import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef } from "@heroes/contracts";
import {
  syncCartBuilding,
  syncCartBuildings,
} from "../../../src/screens/settlements/cityView/syncedBuildings";

// Regression for the stale-pot write-back: CityView.syncedBuildings() refreshes
// level/style/construction from live state on every sync but used to leave
// `bank` at its placement-time value, so a pot that changed while the city view
// was open (multiplayer, or a weekly-interest / 7-day-maturity boundary) was
// written back STALE on the next PlaceBuildings commit -- the change lost.
//
// cityView.ts itself cannot be imported here (its chain reaches Vite `?url`
// PNG imports), which is why the merge lives in this pure module.

function bank(overrides: Partial<BuildingDef> = {}): BuildingDef {
  return { gx: 2, gy: 3, kind: "bank", level: 1, style: "classic", ...overrides };
}

function cart(overrides: Partial<BuildingDef> = {}): BuildingDef {
  return { gx: 0, gy: 0, kind: "house", level: 1, style: "classic", ...overrides };
}

test("a pot that grew while the city view was open is re-synced, not written back stale", () => {
  const live = bank({ level: 1, bank: { gold: 5000, pendingOut: [] } });
  const merged = syncCartBuilding(cart(), live);
  assert.deepEqual(merged.bank, { gold: 5000, pendingOut: [] });
});

test("a pot that shrank (weekly interest push-back, matured withdrawals) is re-synced", () => {
  const merged = syncCartBuilding(
    cart({ bank: { gold: 5000, pendingOut: [{ gold: 100, maturesOnDay: 30 }] } }),
    bank({ bank: { gold: 4200, pendingOut: [] } }),
  );
  assert.deepEqual(merged.bank, { gold: 4200, pendingOut: [] });
});

test("pending withdrawals ride along with the live pot", () => {
  const merged = syncCartBuilding(
    cart(),
    bank({ bank: { gold: 100, pendingOut: [{ gold: 250, maturesOnDay: 42 }] } }),
  );
  assert.deepEqual(merged.bank?.pendingOut, [{ gold: 250, maturesOnDay: 42 }]);
});

test("the merged pot is a copy, not the live object", () => {
  const live = bank({ bank: { gold: 100, pendingOut: [{ gold: 10, maturesOnDay: 7 }] } });
  const merged = syncCartBuilding(cart(), live);
  assert.notEqual(merged.bank, live.bank);
  assert.notEqual(merged.bank?.pendingOut, live.bank?.pendingOut);
  assert.notEqual(merged.bank?.pendingOut[0], live.bank?.pendingOut[0]);
});

test("a live building with NO pot DELETES the cart's key rather than setting it undefined", () => {
  const merged = syncCartBuilding(cart({ bank: { gold: 900, pendingOut: [] } }), bank());
  assert.equal("bank" in merged, false);
  assert.equal(Object.keys(merged).includes("bank"), false);
  // settlementRepo's conditional spread distinguishes absent from explicit
  // undefined, and its deepStrictEqual fixtures depend on the absent shape.
  assert.deepEqual(merged, cart());
});

test("the construction branch's delete behavior is preserved verbatim", () => {
  const withConstruction = syncCartBuilding(
    cart({ construction: { daysRemaining: 3 } }),
    bank({ construction: undefined }),
  );
  assert.equal("construction" in withConstruction, false);
  const stillBuilding = syncCartBuilding(
    cart(),
    bank({ construction: { daysRemaining: 2 } }),
  );
  assert.deepEqual(stillBuilding.construction, { daysRemaining: 2 });
});

test("level and style still come from live state", () => {
  const merged = syncCartBuilding(
    cart({ level: 1, style: "classic" }),
    bank({ level: 3, style: "organic" }),
  );
  assert.equal(merged.level, 3);
  assert.equal(merged.style, "organic");
});

test("a live building with no style leaves the merged key absent, not undefined", () => {
  const merged = syncCartBuilding(
    { gx: 0, gy: 0, kind: "house", level: 1 },
    { gx: 0, gy: 0, kind: "house", level: 3 },
  );
  assert.equal("style" in merged, false);
  assert.equal(merged.level, 3);
});

test("cart entries with no live twin pass through untouched", () => {
  const fresh = cart({ gx: 4, gy: 4, construction: { daysRemaining: 5 } });
  const out = syncCartBuildings([fresh], [bank({ gx: 2, gy: 3 })]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], fresh);
  assert.equal(out[0], fresh);
});

test("matching is by gx, gy AND kind, and every matched entry is merged", () => {
  const out = syncCartBuildings(
    [
      cart({ gx: 2, gy: 3, kind: "house" }),
      bank({ gx: 2, gy: 3, level: 1 }),
      bank({ gx: 5, gy: 5, level: 2, bank: { gold: 250, pendingOut: [] } }),
    ],
    [
      // Same cell, different kind: NOT the cart bank's twin.
      bank({ gx: 2, gy: 3, level: 2, bank: { gold: 999, pendingOut: [] } }),
      bank({ gx: 5, gy: 5, level: 2, bank: { gold: 1000, pendingOut: [] } }),
    ],
  );
  assert.equal(out[0].bank, undefined);
  assert.deepEqual(out[1].bank, { gold: 999, pendingOut: [] });
  assert.deepEqual(out[2].bank, { gold: 1000, pendingOut: [] });
});