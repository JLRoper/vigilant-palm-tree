// Food spots in the city view (designer's call, 2026-10-01).
//
// Food spots are generated (citySpots.ts's RESOURCE_POOL rolls them,
// terrain-biased) and a farm placed on one earns the ~3x spot multiplier, so
// the cell is a real decision. GameEngine.handleDblClick used to hand
// cityView.open() only the "mineable" spots, dropping food on the floor: the
// mechanic existed and was unmakeable. Three things are pinned here so the
// mechanic cannot silently go dark again:
//
//   1. the open() call no longer filters food out (source scan -- the filter
//      lived inline in a DOM-bound handler with no unit-testable seam),
//   2. buildCityScene emits a cityResourceSpot node for a food spot,
//   3. that node paints: food has a RESOURCE_PAL entry AND a `resource.food`
//      sprite descriptor, so it is drawn with art, and the procedural
//      RESOURCE_PAL diamond is the fallback, not the only path.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildCityScene, type CitySceneInput } from "../../src/render/scene/sceneBuilder/cityScene";
import type { CityResourceSpotNode } from "../../src/render/scene/types";
import { paintCityResourceSpot } from "../../src/render/scene/paint2d";
import { RESOURCE_PAL } from "../../src/render/palettes";
import { makeNoopPaint2DDep, makeRecordingCtx } from "./_helpers";

const FOOD_SPOT = { cell: { x: 1, y: 1 }, resource: "food", vein: "food_vein_0" } as const;

function baseInput(overrides: Partial<CitySceneInput> = {}): CitySceneInput {
  return {
    viewportW: 800,
    viewportH: 600,
    settlementName: "Home",
    size: 5,
    hover: null,
    citySpots: [],
    cityMines: [],
    buildings: [],
    style: "classic",
    pattern: "grid-1",
    citySettings: {
      spriteVariant: 2,
      parallaxEnabled: true,
      parallaxLayerCount: 3,
      cityBgOffsetX: 10,
      cityBgOffsetY: -5,
    },
    ...overrides,
  };
}

test("GameEngine no longer filters food spots out of the cityView.open() call", () => {
  const code = readFileSync("src/managers/GameEngine.ts", "utf8");
  const open = code.slice(code.indexOf("cityView.open("), code.indexOf("cityView.open(") + 400);
  assert.ok(open.length > 0, "cityView.open( must still exist in GameEngine");
  assert.ok(!/citySpots\.filter/.test(open), "citySpots must be passed through unfiltered");
  assert.ok(
    !/const isMineable\s*=/.test(code),
    "the food-dropping isMineable type guard must be gone",
  );
  assert.ok(open.includes("castle.citySpots"), "open() receives the settlement's spots as-is");
});

test("buildCityScene emits a cityResourceSpot node for a food spot", () => {
  const nodes = buildCityScene(baseInput({ citySpots: [FOOD_SPOT] }));
  const spots = nodes.filter((n): n is CityResourceSpotNode => n.kind === "cityResourceSpot");
  assert.equal(spots.length, 1, "a food spot produces a node like any other spot");
  assert.equal(spots[0].resource, "food", "the node carries the food resource through");
  assert.equal(spots[0].gx, FOOD_SPOT.cell.x);
  assert.equal(spots[0].gy, FOOD_SPOT.cell.y);
});

test("food has sprite art, so a food spot is not a blank diamond", () => {
  assert.ok(RESOURCE_PAL.food, "RESOURCE_PAL carries a food entry (procedural fallback)");
  // assetDescriptors.ts is Vite-?url-coupled and cannot be imported under
  // node:test (the paint2d seam pitfall), so this reads its source instead:
  // RESOURCE_DESCRIPTORS is generated from RESOURCES over RESOURCE_SPRITES,
  // and food must be present in that sprite record to produce `resource.food`.
  const descriptors = readFileSync("src/render/assetDescriptors.ts", "utf8");
  const sprites = descriptors.slice(descriptors.indexOf("RESOURCE_SPRITES"));
  const foodRow = sprites.split("\n").find((line) => /^\s*food\s*:/.test(line));
  assert.ok(foodRow, "RESOURCE_SPRITES has a food entry -> resource.food resolves to art");
});

test("paintCityResourceSpot draws a food spot (fallback path emits real geometry)", () => {
  const { ctx, calls } = makeRecordingCtx();
  paintCityResourceSpot(
    ctx,
    { kind: "cityResourceSpot", gx: 1, gy: 1, screen: { x: 10, y: 20 }, tileWidth: 40, tileHeight: 40, resource: "food" },
    makeNoopPaint2DDep(),
  );
  assert.ok(calls.some((c) => c.name === "fill"), "the fallback diamond fills");
  assert.ok(calls.some((c) => c.name === "stroke"), "the fallback diamond outlines");
  const fill = calls.find((c) => c.name === "set:fillStyle");
  assert.ok(fill?.args[0]?.length > 0, "the fill uses a real colour, not an empty string");
});
