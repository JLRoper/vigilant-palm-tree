import { test } from "node:test";
import assert from "node:assert/strict";
import { GameMap, ROAD_COST_MULTIPLIER, computePathCost, findPath } from "@heroes/engine";

// Section 7 (road-building side action): findPath/computePathCost gain an
// optional roadedTiles parameter, defaulting to "no effect on unroaded
// tiles" for every existing caller (backward compatible by construction).

// (2,2) is the guaranteed-passable hero spawn tile (map/gameMap.ts's own
// HERO_SPAWN invariant), so its cost is deterministic across seeds.
const SPAWN = { q: 2, r: 2 };

test("computePathCost halves a tile's cost when it is in roadedTiles", () => {
  const map = new GameMap(1, "small");
  const plainCost = computePathCost(map, [{ q: 0, r: 0 }, SPAWN]);
  const roadedCost = computePathCost(map, [{ q: 0, r: 0 }, SPAWN], new Set([`${SPAWN.q},${SPAWN.r}`]));
  assert.equal(roadedCost, plainCost * ROAD_COST_MULTIPLIER);
});

test("computePathCost is unaffected when roadedTiles omits the tile, or is empty/absent", () => {
  const map = new GameMap(1, "small");
  const plainCost = computePathCost(map, [{ q: 0, r: 0 }, SPAWN]);
  assert.equal(computePathCost(map, [{ q: 0, r: 0 }, SPAWN], new Set(["99,99"])), plainCost);
  assert.equal(computePathCost(map, [{ q: 0, r: 0 }, SPAWN], new Set()), plainCost);
  assert.equal(computePathCost(map, [{ q: 0, r: 0 }, SPAWN]), plainCost);
});

test("findPath with no roadedTiles argument is byte-identical to today (backward compatible)", () => {
  const map = new GameMap(5, "small");
  const a = findPath(map, { q: 1, r: 1 }, { q: 4, r: 4 });
  const b = findPath(map, { q: 1, r: 1 }, { q: 4, r: 4 }, undefined, new Set());
  assert.deepEqual(a, b);
});
