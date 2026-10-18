import { test } from "node:test";
import assert from "node:assert/strict";
import { GameMap, NEIGHBOR_DIRS, sampleCityBackdrop } from "@heroes/engine";
import type { Terrain } from "@heroes/engine";

const GRID: Terrain[][] = [
  ["mountain", "forest", "snow"],
  ["desert", "forest", "water"],
  ["grass", "swamp", "dirt"],
];

function mapFromGrid(grid: Terrain[][]): GameMap {
  const rows = [];
  for (let r = 0; r < grid.length; r++) {
    for (let q = 0; q < grid[r].length; q++) {
      rows.push({ q, r, terrain: grid[r][q], resource: null });
    }
  }
  return GameMap.fromTiles(rows);
}

test("NEIGHBOR_DIRS is the six axial directions in E, NE, NW, W, SW, SE order", () => {
  assert.deepEqual(NEIGHBOR_DIRS, [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
  ]);
});

test("sampleCityBackdrop reads the center and its six neighbors in NEIGHBOR_DIRS order", () => {
  const map = mapFromGrid(GRID);
  const signature = sampleCityBackdrop(map, 1, 1, 1234);
  assert.equal(signature.center, "forest");
  assert.deepEqual(signature.neighbors, ["water", "snow", "forest", "desert", "grass", "swamp"]);
});

test("sampleCityBackdrop falls back to the center terrain for off-map neighbors", () => {
  const map = mapFromGrid(GRID);
  const signature = sampleCityBackdrop(map, 0, 0, 7);
  assert.equal(signature.center, "mountain");
  assert.deepEqual(signature.neighbors, ["forest", "mountain", "mountain", "mountain", "mountain", "desert"]);
});

test("sampleCityBackdrop falls back to grass for an off-map center and is deterministic", () => {
  const map = mapFromGrid(GRID);
  const a = sampleCityBackdrop(map, 9, 9, 42);
  const b = sampleCityBackdrop(map, 9, 9, 42);
  assert.equal(a.center, "grass");
  assert.equal(a.neighbors.length, 6);
  assert.ok(a.neighbors.every((t) => t === "grass"));
  assert.deepEqual(a, b);

  const otherSeed = sampleCityBackdrop(map, 9, 9, 43);
  assert.notEqual(otherSeed.seed, a.seed);

  const otherCell = sampleCityBackdrop(map, 1, 1, 42);
  assert.notEqual(otherCell.seed, a.seed);
});
