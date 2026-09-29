import { test } from "node:test";
import assert from "node:assert/strict";
import type { Axial } from "../../src/core/hex";
import { GameMap, type TileRow } from "../../src/map/gameMap";
import type { Terrain } from "../../src/map/terrain";
import { computeReachableSplit, computeReachableSplitDetailed } from "../../src/render/overlays/pathOverlay";

function makeTerrainMap(cells: Array<{ q: number; r: number; terrain: Terrain }>): GameMap {
  const lookup = new Map(cells.map((c) => [`${c.q},${c.r}`, c.terrain]));
  const width = Math.max(...cells.map((c) => c.q)) + 1;
  const height = Math.max(...cells.map((c) => c.r)) + 1;
  const rows: TileRow[] = [];
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      rows.push({ q, r, terrain: lookup.get(`${q},${r}`) ?? "grass", resource: null });
    }
  }
  return GameMap.fromTiles(rows);
}

function row(terrains: Terrain[]): Axial[] {
  return terrains.map((_, q) => ({ q, r: 0 }));
}

test("detailed split: fully reachable path returns index === path.length and both costs equal the full walk", () => {
  const map = makeTerrainMap([{ q: 0, r: 0, terrain: "grass" }, { q: 1, r: 0, terrain: "dirt" }, { q: 2, r: 0, terrain: "grass" }]);
  const path = row(["grass", "dirt", "grass"]);
  const detailed = computeReachableSplitDetailed(path, map, 10);
  assert.deepEqual(detailed, { index: 3, costToSplit: 3, totalCost: 3 });
  assert.equal(computeReachableSplit(path, map, 10), detailed.index);
});

test("detailed split: clamped mid-path reports costToSplit at the split and the full path cost", () => {
  const map = makeTerrainMap([{ q: 0, r: 0, terrain: "grass" }, { q: 1, r: 0, terrain: "grass" }, { q: 2, r: 0, terrain: "grass" }, { q: 3, r: 0, terrain: "grass" }]);
  const path = row(["grass", "grass", "grass", "grass"]);
  const detailed = computeReachableSplitDetailed(path, map, 1);
  assert.deepEqual(detailed, { index: 1, costToSplit: 1, totalCost: 4 });
  assert.equal(computeReachableSplit(path, map, 1), 1);
});

test("detailed split: fractional costs accumulate (forest 1.2)", () => {
  const map = makeTerrainMap([{ q: 0, r: 0, terrain: "forest" }, { q: 1, r: 0, terrain: "forest" }, { q: 2, r: 0, terrain: "grass" }]);
  const path = row(["forest", "forest", "grass"]);
  const clamped = computeReachableSplitDetailed(path, map, 2);
  assert.deepEqual(clamped, { index: 2, costToSplit: 2.4, totalCost: 3.4 });
  const reachable = computeReachableSplitDetailed(path, map, 3.4);
  assert.deepEqual(reachable, { index: 3, costToSplit: 3.4, totalCost: 3.4 });
});

test("detailed split: an impassable tile stops the walk for both costs (never computePathCost's 0-on-impassable quirk)", () => {
  const map = makeTerrainMap([{ q: 0, r: 0, terrain: "grass" }, { q: 1, r: 0, terrain: "water" }, { q: 2, r: 0, terrain: "grass" }]);
  const path = row(["grass", "water", "grass"]);
  const detailed = computeReachableSplitDetailed(path, map, 10);
  assert.deepEqual(detailed, { index: 1, costToSplit: 1, totalCost: 1 });
  assert.equal(computeReachableSplit(path, map, 10), 1);
});

test("detailed split: an impassable first tile yields a zero-cost split at index 0", () => {
  const map = makeTerrainMap([{ q: 0, r: 0, terrain: "grass" }, { q: 1, r: 0, terrain: "mountain" }]);
  const path = row(["grass", "mountain"]);
  const detailed = computeReachableSplitDetailed(path, map, 5);
  assert.deepEqual(detailed, { index: 1, costToSplit: 1, totalCost: 1 });
  const firstStep = computeReachableSplitDetailed([{ q: 1, r: 0 }], map, 5);
  assert.deepEqual(firstStep, { index: 0, costToSplit: 0, totalCost: 0 });
});

test("detailed split: single-tile path reachable on fractional movement (issue #129 parity)", () => {
  const map = makeTerrainMap([{ q: 0, r: 0, terrain: "grass" }, { q: 1, r: 0, terrain: "grass" }]);
  const path = [{ q: 1, r: 0 }];
  assert.deepEqual(computeReachableSplitDetailed(path, map, 0.5), { index: 1, costToSplit: 1, totalCost: 1 });
  assert.deepEqual(computeReachableSplitDetailed(path, map, 0), { index: 0, costToSplit: 0, totalCost: 1 });
});

test("detailed split: a tile missing from the map is treated as impassable, not as a zero cost", () => {
  const map = makeTerrainMap([{ q: 0, r: 0, terrain: "grass" }]);
  const path = [{ q: 0, r: 0 }, { q: 9, r: 9 }];
  const detailed = computeReachableSplitDetailed(path, map, 10);
  assert.deepEqual(detailed, { index: 1, costToSplit: 1, totalCost: 1 });
});

test("detailed split: empty path yields a zeroed result", () => {
  const map = makeTerrainMap([{ q: 0, r: 0, terrain: "grass" }]);
  assert.deepEqual(computeReachableSplitDetailed([], map, 7), { index: 0, costToSplit: 0, totalCost: 0 });
});

test("detailed split: exact-cost movement still counts as fully reachable (>= boundary)", () => {
  const map = makeTerrainMap([{ q: 0, r: 0, terrain: "grass" }, { q: 1, r: 0, terrain: "grass" }, { q: 2, r: 0, terrain: "grass" }]);
  const path = row(["grass", "grass", "grass"]);
  assert.deepEqual(computeReachableSplitDetailed(path, map, 3), { index: 3, costToSplit: 3, totalCost: 3 });
  assert.deepEqual(computeReachableSplitDetailed(path, map, 2.9), { index: 3, costToSplit: 3, totalCost: 3 },
    "fractional remaining below the last hex's cost still affords it (issue #129 rule)");
});
