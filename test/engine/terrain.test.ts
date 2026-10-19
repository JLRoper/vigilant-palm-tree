import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GameMap,
  NEIGHBOR_DIRS,
  RESOURCE_DENSITY,
  TERRAIN_COLORS,
  TERRAIN_COST,
  foodBiasForTerrain,
  isPassable,
  touchesTerrain,
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

test("dense forest is an impassable, distinctly coloured biome", () => {
  assert.equal(TERRAIN_COST.denseForest, Infinity, "dense forest cannot be walked through");
  assert.equal(isPassable("denseForest"), false);
  assert.equal(isPassable("forest"), true, "normal forest stays walkable");
  assert.ok(TERRAIN_COLORS.denseForest.fill.length > 0, "dense forest fill is set");
  assert.ok(TERRAIN_COLORS.denseForest.stroke.length > 0, "dense forest stroke is set");
  assert.notEqual(
    TERRAIN_COLORS.denseForest.fill,
    TERRAIN_COLORS.forest.fill,
    "dense forest must not paint as normal forest",
  );
});

test("dense forest only appears from map-gen v4, and v4 only ADDS it", () => {
  for (let seed = 1; seed <= 8; seed++) {
    for (const version of [2, 3] as const) {
      const tiles = new GameMap(seed, "small", version).tiles;
      assert.equal(tiles.includes("denseForest"), false, `v${version} seed ${seed} carries no dense forest`);
    }
    const v3 = new GameMap(seed, "small", 3);
    const v4 = new GameMap(seed, "small", 4);
    assert.equal(v4.tiles.includes("denseForest"), true, `v4 seed ${seed} generated no dense forest`);
    for (let i = 0; i < v3.tiles.length; i++) {
      if (v3.tiles[i] === v4.tiles[i]) continue;
      assert.equal(v4.tiles[i], "denseForest", "v4 differs from v3 only by adding dense forest");
      assert.notEqual(v3.tiles[i], "forest", "the dense-forest pass never consumes normal forest");
    }
  }
});

test("dense forest is rarer than forest and clusters against the forest edge", () => {
  let forest = 0;
  let dense = 0;
  let denseTouchingForest = 0;
  let passable = 0;
  let passableTouchingForest = 0;
  const nonForestNeighbours = new Set<string>();

  for (let seed = 1; seed <= 12; seed++) {
    const map = new GameMap(seed, "large", 4);
    for (let r = 0; r < map.height; r++) {
      for (let q = 0; q < map.width; q++) {
        const terrain = map.get(q, r)!;
        const touchesForest = touchesTerrain(map, q, r, "forest");
        if (terrain === "forest") {
          forest++;
        } else if (isPassable(terrain)) {
          passable++;
          if (touchesForest) passableTouchingForest++;
        }
        if (terrain !== "denseForest") continue;
        dense++;
        if (touchesForest) denseTouchingForest++;
        for (const d of NEIGHBOR_DIRS) {
          const neighbour = map.get(q + d.q, r + d.r);
          if (neighbour && neighbour !== "forest" && neighbour !== "denseForest") {
            nonForestNeighbours.add(neighbour);
          }
        }
      }
    }
  }

  assert.ok(dense > 0, "dense forest never generated across seeds 1..12");
  assert.ok(dense < forest, `dense forest (${dense}) must stay rarer than forest (${forest})`);
  const denseShare = denseTouchingForest / dense;
  const baseShare = passableTouchingForest / passable;
  assert.ok(denseShare > 0.5, `dense forest should mostly border forest, got ${denseShare.toFixed(3)}`);
  assert.ok(
    denseShare > baseShare * 1.5,
    `dense forest must hug forest far more than a plain passable tile does (${denseShare.toFixed(3)} vs ${baseShare.toFixed(3)})`,
  );
  assert.ok(nonForestNeighbours.size >= 3, "dense forest still borders other biomes, not only forest");
});

test("dense forest never carries a resource tile", () => {
  for (let seed = 1; seed <= 5; seed++) {
    const map = new GameMap(seed, "large", 4);
    for (const tile of map.placedResourceTiles) {
      assert.notEqual(map.get(tile.q, tile.r), "denseForest", "an impassable tile cannot hold a deposit");
    }
  }
});
