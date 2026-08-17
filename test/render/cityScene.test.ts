import { test } from "node:test";
import assert from "node:assert/strict";
import { buildingFootprintFromRegistry, pickStyleForBuilding } from "@heroes/engine";
import type { BuildingDef } from "@heroes/contracts";
import { cellOrigin, cellToScreen, computeCityScale, TILE_D, TILE_W } from "../../src/core/cityGrid";
import { buildingFootprint } from "../../src/render/cityBuildingDraw/primitives";
import { buildCityScene, type CitySceneInput } from "../../src/render/scene/sceneBuilder/cityScene";
import type {
  CityBuildingNode,
  CityCellNode,
  CityGhostBuildingNode,
  CityLabelNode,
  CityMineNode,
  CityResourceSpotNode,
  CitySkyboxNode,
} from "../../src/render/scene/types";

function nodesOfKind<K extends { kind: string }>(nodes: unknown[], kind: K["kind"]): K[] {
  return (nodes as { kind: string }[]).filter((n) => n.kind === kind) as K[];
}

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

test("citySkybox node carries the resolved settings decision, not the settings object itself", () => {
  const nodes = buildCityScene(baseInput());
  const skyboxes = nodesOfKind<CitySkyboxNode>(nodes, "citySkybox");
  assert.equal(skyboxes.length, 1);
  assert.deepEqual(skyboxes[0], {
    kind: "citySkybox",
    viewportW: 800,
    viewportH: 600,
    spriteVariant: 2,
    parallaxEnabled: true,
    parallaxLayerCount: 3,
    offsetX: 10,
    offsetY: -5,
  });
});

test("one cityCell node per grid cell, hovered flag set only for the hovered cell", () => {
  const nodesNoHover = buildCityScene(baseInput({ size: 5, hover: null }));
  const cellsNoHover = nodesOfKind<CityCellNode>(nodesNoHover, "cityCell");
  assert.equal(cellsNoHover.length, 25);
  assert.ok(cellsNoHover.every((c) => c.hovered === false));

  const nodes = buildCityScene(baseInput({ size: 5, hover: { gx: 2, gy: 2 } }));
  const cells = nodesOfKind<CityCellNode>(nodes, "cityCell");
  const hovered = cells.filter((c) => c.hovered);
  assert.equal(hovered.length, 1);
  assert.equal(hovered[0].gx, 2);
  assert.equal(hovered[0].gy, 2);

  const tileScale = computeCityScale(5, 800, 600);
  const gridOrigin = cellOrigin(5);
  const gridVCenter = (4 * TILE_D) / 2;
  const buildingPad = 5 * TILE_D * 0.18;
  const screenOrigin = { x: 400, y: 300 - (gridVCenter + buildingPad) * tileScale };
  const c = cellToScreen(2, 2, gridOrigin);
  assert.deepEqual(hovered[0].screen, { x: screenOrigin.x + c.x * tileScale, y: screenOrigin.y + c.y * tileScale });
  assert.equal(hovered[0].halfWidth, (TILE_W * tileScale) / 2);
  assert.equal(hovered[0].halfHeight, (TILE_D * tileScale) / 2);
});

test("resource spots and mines only produce nodes at their own cell", () => {
  const nodes = buildCityScene(
    baseInput({
      citySpots: [{ cell: { x: 1, y: 1 }, resource: "gold", vein: "v1" }],
      cityMines: [{ cell: { x: 3, y: 3 }, resource: "iron", level: 2 }],
    }),
  );

  const spots = nodesOfKind<CityResourceSpotNode>(nodes, "cityResourceSpot");
  assert.equal(spots.length, 1);
  assert.equal(spots[0].gx, 1);
  assert.equal(spots[0].gy, 1);
  assert.equal(spots[0].resource, "gold");

  const mines = nodesOfKind<CityMineNode>(nodes, "cityMine");
  assert.equal(mines.length, 1);
  assert.equal(mines[0].gx, 3);
  assert.equal(mines[0].gy, 3);
  assert.equal(mines[0].resource, "iron");
  assert.equal(mines[0].level, 2);
});

test("buildings are emitted in ascending (gx+gy) draw order with correct footprint/selection", () => {
  const buildings: BuildingDef[] = [
    { gx: 4, gy: 4, kind: "house", level: 1, style: "classic" },
    { gx: 0, gy: 0, kind: "townHall", level: 1, style: "classic" },
  ];
  const nodes = buildCityScene(
    baseInput({ buildings, selectedKeys: new Set(["0,0,townHall"]) }),
  );

  const buildingNodes = nodesOfKind<CityBuildingNode>(nodes, "cityBuilding");
  assert.equal(buildingNodes.length, 2);
  assert.equal(buildingNodes[0].gx, 0, "gx+gy=0 (townHall) must be drawn before gx+gy=8 (house)");
  assert.equal(buildingNodes[0].buildingKind, "townHall");
  assert.equal(buildingNodes[0].selected, true);
  assert.equal(buildingNodes[1].selected, false);

  const tileScale = computeCityScale(5, 800, 600);
  const gridOrigin = cellOrigin(5);
  const gridVCenter = (4 * TILE_D) / 2;
  const buildingPad = 5 * TILE_D * 0.18;
  const screenOrigin = { x: 400, y: 300 - (gridVCenter + buildingPad) * tileScale };
  const fpSize = buildingFootprintFromRegistry("townHall", 1);
  const fp = buildingFootprint(0, 0, gridOrigin, screenOrigin, tileScale, fpSize.w, fpSize.h);
  assert.deepEqual(buildingNodes[0].center, { x: fp.cx, y: fp.cy });
  assert.equal(buildingNodes[0].halfWidth, fp.hw);
  assert.equal(buildingNodes[0].halfHeight, fp.hh);
});

test("ghost building node is only present when a ghost is provided, and resolves its style via pickStyleForBuilding", () => {
  const withoutGhost = buildCityScene(baseInput());
  assert.equal(nodesOfKind(withoutGhost, "cityGhostBuilding").length, 0);

  const nodes = buildCityScene(
    baseInput({ ghost: { gx: 1, gy: 0, kind: "house", w: 1, h: 1, valid: true } }),
  );
  const ghosts = nodesOfKind<CityGhostBuildingNode>(nodes, "cityGhostBuilding");
  assert.equal(ghosts.length, 1);
  assert.equal(ghosts[0].buildingKind, "house");
  assert.equal(ghosts[0].valid, true);
  assert.equal(ghosts[0].style, pickStyleForBuilding("house", 1, "classic"));

  const tileScale = computeCityScale(5, 800, 600);
  const gridOrigin = cellOrigin(5);
  const gridVCenter = (4 * TILE_D) / 2;
  const buildingPad = 5 * TILE_D * 0.18;
  const screenOrigin = { x: 400, y: 300 - (gridVCenter + buildingPad) * tileScale };
  const fp = buildingFootprint(1, 0, gridOrigin, screenOrigin, tileScale, 1, 1);
  assert.deepEqual(ghosts[0].center, { x: fp.cx, y: fp.cy });
});

test("exactly two labels: settlement name, then tier/style/pattern subtitle", () => {
  const nodes = buildCityScene(baseInput({ settlementName: "Home", size: 5, style: "classic", pattern: "grid-1" }));
  const labels = nodesOfKind<CityLabelNode>(nodes, "cityLabel");
  assert.equal(labels.length, 2);
  assert.deepEqual(labels[0], { kind: "cityLabel", text: "Home", x: 12, y: 12, fontPx: 14, alpha: 1 });
  assert.deepEqual(labels[1], {
    kind: "cityLabel",
    text: "5\u00d75 Settlement  \u2014  Classic Fantasy  \u2014  grid-1",
    x: 12,
    y: 30,
    fontPx: 11,
    alpha: 0.7,
  });
});
