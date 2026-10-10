import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GameMap,
  RESOURCE_DENSITY,
  TERRAIN_COLORS,
  TERRAIN_COST,
  foodBiasForTerrain,
  isPassable,
} from "@heroes/engine";

const BASE_COSTS: Record<string, number> = {
  grass: 1,
  dirt: 1,
  forest: 1.2,
  water: Infinity,
  desert: 1.4,
  mountain: Infinity,
};

test("swamp and snow are passable, cost 2, and carry colors", () => {
  for (const terrain of ["swamp", "snow"] as const) {
    assert.equal(TERRAIN_COST[terrain], 2, `${terrain} costs 2 movement`);
    assert.equal(TERRAIN_COST[terrain], 2 * TERRAIN_COST.grass, `${terrain} is 2x a normal tile`);
    assert.equal(isPassable(terrain), true, `${terrain} is passable`);
    assert.ok(TERRAIN_COLORS[terrain].fill.length > 0, `${terrain} fill is set`);
    assert.ok(TERRAIN_COLORS[terrain].stroke.length > 0, `${terrain} stroke is set`);
  }
});

test("every pre-existing terrain cost is unchanged", () => {
  for (const [terrain, cost] of Object.entries(BASE_COSTS)) {
    assert.equal(TERRAIN_COST[terrain as keyof typeof TERRAIN_COST], cost, `${terrain} cost changed`);
  }
  assert.equal(isPassable("water"), false, "water stays impassable");
  assert.equal(isPassable("mountain"), false, "mountain stays impassable");
});

test("map generation is deterministic per seed", () => {
  const a = new GameMap(42);
  const b = new GameMap(42);
  assert.deepEqual(a.tiles, b.tiles);
});

test("both new biomes appear across seeds 1..20 on a large map", () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 20; seed++) {
    for (const terrain of new GameMap(seed, "large").tiles) seen.add(terrain);
  }
  assert.ok(seen.has("swamp"), "swamp never generated across seeds 1..20");
  assert.ok(seen.has("snow"), "snow never generated across seeds 1..20");
});

test("RESOURCE_DENSITY pins the new biomes' exact values", () => {
  assert.deepEqual(RESOURCE_DENSITY.swamp, { gold: 0.02, wood: 0.1, stone: 0.005, iron: 0, arcane: 0.03, food: 0 });
  assert.deepEqual(RESOURCE_DENSITY.snow, { gold: 0.01, wood: 0.005, stone: 0.03, iron: 0.01, arcane: 0, food: 0 });
});

test("city food bias pins for the new biomes", () => {
  assert.equal(foodBiasForTerrain("swamp"), 0.15);
  assert.equal(foodBiasForTerrain("snow"), 0.02);
});
