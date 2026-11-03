import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DISTRICT_ENTRY_REFUSALS,
  GameMap,
  districtEntryDecision,
  type DistrictEntryRefusal,
  type Terrain,
  type TileRow,
} from "@heroes/engine";
import type { BuildingDef, DistrictState } from "@heroes/contracts";

// The adventure map's district-entry gate (F3 of the round-2 district-road
// card): a double-click on a hex that cannot host a district must classify its
// refusal, so `GameEngine` can say WHY in the map's refusal toast instead of
// refusing silently and leaving the unrelated "Select a hero first" as the only
// words on screen. Both named classes are here -- OUT OF CONTROL RANGE and NOT
// TOUCHING THE CLUSTER -- plus the ownership and terrain refusals on the same
// path, keyed by their own codes.

function hexMap(width = 9, height = 9, overrides: Record<string, Terrain> = {}): GameMap {
  const rows: TileRow[] = [];
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      rows.push({ q, r, terrain: overrides[`${q},${r}`] ?? "grass", resource: null });
    }
  }
  return GameMap.fromTiles(rows);
}

function district(q: number, r: number, buildings: BuildingDef[] = [{ gx: 0, gy: 0, kind: "farmhouse", level: 1 }]): DistrictState {
  return { q, r, citySpots: [], buildings };
}

/** A settlement in the shape `districtEntryDecision` reads (id/ownerId/level/tile/districts). */
function settlement(overrides: Record<string, unknown> = {}) {
  return { id: "s1", ownerId: 0, level: 2 as const, tile: { q: 4, r: 4 }, ...overrides };
}

const OPEN = hexMap();

test("an adjacent, connected hex with no district yet may open", () => {
  assert.deepEqual(districtEntryDecision([settlement()], 0, OPEN, 5, 4), {
    ok: true,
    settlementId: "s1",
  });
});

test("a hex touching an existing district may open, even two out from the centre", () => {
  const s = settlement({ level: 3 as const, districts: { "5,4": district(5, 4) } });
  assert.deepEqual(districtEntryDecision([s], 0, OPEN, 6, 4), { ok: true, settlementId: "s1" });
});

test("an existing district of the settlement always opens", () => {
  const s = settlement({ level: 3 as const, districts: { "6,4": district(6, 4) } });
  assert.deepEqual(districtEntryDecision([s], 0, OPEN, 6, 4), { ok: true, settlementId: "s1" });
});

test("a hex inside the range but touching nothing in the cluster names district_not_connected", () => {
  const s = settlement({ level: 3 as const }); // L3 -> range 3, (6,4) is distance 2, touching nothing
  assert.deepEqual(districtEntryDecision([s], 0, OPEN, 6, 4), {
    ok: false,
    reason: "district_not_connected",
  });
});

test("a hex no settlement's control range reaches names outside_control_range", () => {
  const s = settlement(); // L2 at 4,4 -> range 2; (8,7) is far outside
  assert.deepEqual(districtEntryDecision([s], 0, OPEN, 8, 7), {
    ok: false,
    reason: "outside_control_range",
  });
});

test("another seat's land names not_your_settlement", () => {
  const mine = settlement();
  const theirs = { id: "s2", ownerId: 1, level: 2 as const, tile: { q: 0, r: 0 } };
  assert.deepEqual(districtEntryDecision([mine, theirs], 0, OPEN, 1, 0), {
    ok: false,
    reason: "not_your_settlement",
  });
});

test("forbidden terrain names impassable_district_terrain (mountain and dense forest)", () => {
  const s = settlement();
  const map = hexMap(9, 9, { "5,4": "mountain", "5,5": "denseForest" });
  assert.deepEqual(districtEntryDecision([s], 0, map, 5, 4), {
    ok: false,
    reason: "impassable_district_terrain",
  });
  assert.deepEqual(districtEntryDecision([s], 0, map, 5, 5), {
    ok: false,
    reason: "impassable_district_terrain",
  });
});

test("an off-map hex has nothing to say (null, not a refusal)", () => {
  assert.equal(districtEntryDecision([settlement()], 0, OPEN, 20, 20), null);
});

test("the refusal vocabulary is exactly the four codes the gate returns", () => {
  assert.deepEqual([...DISTRICT_ENTRY_REFUSALS], [
    "outside_control_range",
    "not_your_settlement",
    "district_not_connected",
    "impassable_district_terrain",
  ]);
  // Every code is reachable from a real input, so the list is the function's
  // vocabulary rather than a wish-list.
  const seen = new Set<DistrictEntryRefusal>();
  const mine = settlement();
  const theirs = { id: "s2", ownerId: 1, level: 2 as const, tile: { q: 0, r: 0 } };
  const map = hexMap(9, 9, { "5,5": "mountain" });
  const probes: Array<[number, number]> = [[8, 7], [1, 0], [6, 4], [5, 5]];
  for (const [q, r] of probes) {
    const decision = districtEntryDecision([mine, theirs], 0, map, q, r);
    if (decision && !decision.ok) seen.add(decision.reason);
  }
  assert.deepEqual([...seen].sort(), [...DISTRICT_ENTRY_REFUSALS].sort());
});
