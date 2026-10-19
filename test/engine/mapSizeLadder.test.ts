// Pins the map-size ladder itself: the three tiers above `epic` are real
// generated maps (not just registry rows), the ladder stays ordered by area
// and 4:3, and every consumer's size guard accepts exactly the shipped tiers.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GameMap,
  MAP_SIZE_ORDER,
  MAP_SIZES,
  isMapSize,
  mapSizeLabel,
  resolveMapSize,
  type MapSize,
} from "@heroes/engine";

const NEW_TIERS: MapSize[] = ["colossal", "titanic", "gigantic"];

test("MAP_SIZE_ORDER lists every MAP_SIZES key, smallest first", () => {
  assert.deepEqual([...MAP_SIZE_ORDER].sort(), Object.keys(MAP_SIZES).sort());
  const areas = MAP_SIZE_ORDER.map((size) => MAP_SIZES[size].width * MAP_SIZES[size].height);
  for (let i = 1; i < areas.length; i++) {
    assert.ok(areas[i] > areas[i - 1], `${MAP_SIZE_ORDER[i]} must be larger than ${MAP_SIZE_ORDER[i - 1]}`);
  }
});

test("every tier keeps the 4:3 aspect ratio the renderer and minimap assume", () => {
  for (const size of MAP_SIZE_ORDER) {
    const { width, height } = MAP_SIZES[size];
    assert.equal(width % 4, 0, `${size} width ${width} is not a multiple of 4`);
    assert.equal(width / 4, height / 3, `${size} ${width}x${height} is not 4:3`);
  }
});

test("the three tiers above epic generate their declared dimensions and tile counts", () => {
  const expected: Record<string, [number, number]> = {
    colossal: [180, 135],
    titanic: [240, 180],
    gigantic: [300, 225],
  };
  for (const size of NEW_TIERS) {
    const [width, height] = expected[size];
    assert.equal(MAP_SIZES[size].width, width);
    assert.equal(MAP_SIZES[size].height, height);

    const map = new GameMap(2026, size);
    assert.equal(map.width, width);
    assert.equal(map.height, height);
    assert.equal(map.tiles.length, width * height);
    assert.equal(map.resourceTiles.length, width * height);
    assert.ok(map.placedResourceTiles.length > 0, `${size} placed no resource tiles`);
    // The hero spawn is forced passable, exactly as on every smaller tier.
    assert.ok(map.isPassable(2, 2), `${size} hero spawn (2,2) is not passable`);
    assert.equal(map.get(-1, 0), undefined);
    assert.equal(map.get(width, 0), undefined);
    assert.equal(map.get(0, height), undefined);
  }
});

test("isMapSize accepts every shipped tier and rejects junk", () => {
  for (const size of MAP_SIZE_ORDER) assert.ok(isMapSize(size), `${size} should be a MapSize`);
  for (const bad of ["", "SMALL", "enormous", "toString", "constructor", "__proto__", 24, null, undefined, {}]) {
    assert.equal(isMapSize(bad), false, `${JSON.stringify(bad)} should not be a MapSize`);
  }
});

test("resolveMapSize normalizes the new tiers and still falls back to small", () => {
  for (const size of NEW_TIERS) assert.equal(resolveMapSize(size), size);
  assert.equal(resolveMapSize("enormous"), "small");
  assert.equal(resolveMapSize(undefined), "small");
  assert.equal(resolveMapSize("toString"), "small");
});

test("mapSizeLabel renders the dropdown label from the registry", () => {
  assert.equal(mapSizeLabel("small"), "Small (24×18)");
  assert.equal(mapSizeLabel("epic"), "Epic (120×90)");
  assert.equal(mapSizeLabel("colossal"), "Colossal (180×135)");
  assert.equal(mapSizeLabel("titanic"), "Titanic (240×180)");
  assert.equal(mapSizeLabel("gigantic"), "Gigantic (300×225)");
});
