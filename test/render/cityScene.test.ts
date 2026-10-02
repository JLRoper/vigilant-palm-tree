import { test } from "node:test";
import assert from "node:assert/strict";
import { buildingFootprintFromRegistry, pickStyleForBuilding } from "@heroes/engine";
import type { BuildingDef } from "@heroes/contracts";
import { cellOrigin, cellToScreen, computeCityScale, TILE_D, TILE_W } from "../../src/core/cityGrid";
import { buildingFootprint, buildingHeight, coversCell } from "../../src/render/cityBuildingDraw/primitives";
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

test("warehouse is 2x2 and covers all four of its cells at every level", () => {
  assert.deepEqual(
    buildingFootprintFromRegistry("warehouse", 1),
    { w: 2, h: 2 },
    "a 2x2 footprint at L1",
  );
  // Deliberately pinned per level: buildingFootprintFromRegistry has a 1.5x1.5
  // L2/L3 override list, and a 2x2 kind landing in it would SHALLOW to 2 cells
  // on upgrade, freeing the other two. warehouse must stay out of that list.
  for (const level of [1, 2, 3]) {
    assert.deepEqual(
      buildingFootprintFromRegistry("warehouse", level),
      { w: 2, h: 2 },
      `warehouse must stay 2x2 at level ${level}`,
    );
  }

  const warehouse: BuildingDef = { gx: 1, gy: 1, kind: "warehouse", level: 1, style: "classic" };
  for (const [gx, gy] of [[1, 1], [2, 1], [1, 2], [2, 2]] as const) {
    assert.ok(coversCell(warehouse, gx, gy), `(${gx},${gy}) is inside the 2x2 warehouse`);
  }
  for (const [gx, gy] of [[0, 1], [1, 0], [3, 1], [1, 3], [3, 3]] as const) {
    assert.ok(!coversCell(warehouse, gx, gy), `(${gx},${gy}) is outside the 2x2 warehouse`);
  }

  // A 2x2 building must also be drawn on the footprint the registry reports,
  // not a 1x1 tile -- the scene node geometry is the only place the sprite's
  // visual size comes from.
  const nodes = buildCityScene(baseInput({ buildings: [warehouse] }));
  const [node] = nodesOfKind<CityBuildingNode>(nodes, "cityBuilding");
  const tileScale = computeCityScale(5, 800, 600);
  const gridOrigin = cellOrigin(5);
  // Mirrors cityScene.ts's own screenOrigin: gridVCenter is the grid's vertical
  // midpoint for the city size, not the building's gx.
  const gridVCenter = ((5 - 1) * TILE_D) / 2;
  const screenOrigin = { x: 400, y: 300 - (gridVCenter + 5 * TILE_D * 0.18) * tileScale };
  const fp = buildingFootprint(1, 1, gridOrigin, screenOrigin, tileScale, 2, 2);
  assert.deepEqual(node?.center, { x: fp.cx, y: fp.cy });
  assert.equal(node?.halfWidth, fp.hw);
});

test("treasury is a 1x1 footprint and has a nonzero procedural height", () => {
  assert.deepEqual(buildingFootprintFromRegistry("treasury", 1), { w: 1, h: 1 });
  assert.ok(buildingHeight("treasury", 1) > 0, "buildingHeight must cover treasury (exhaustive record)");
});

test("no upgrade means no construction stage on any building node", () => {
  const buildings: BuildingDef[] = [
    { gx: 0, gy: 0, kind: "townHall", level: 1, style: "classic" },
    { gx: 4, gy: 4, kind: "house", level: 1, style: "classic" },
  ];
  const nodes = buildCityScene(baseInput({ buildings }));
  for (const b of nodesOfKind<CityBuildingNode>(nodes, "cityBuilding")) {
    assert.equal(b.constructionStage, undefined);
  }
});

test("a town hall upgrade in flight stages the town hall node by progress", () => {
  const buildings: BuildingDef[] = [
    { gx: 0, gy: 0, kind: "townHall", level: 1, style: "classic" },
    { gx: 4, gy: 4, kind: "house", level: 1, style: "classic" },
  ];
  const base = { kind: "townHall" as const, targetLevel: 2 as const };

  const justStarted = buildCityScene(baseInput({ buildings, upgrades: { ...base, daysRemaining: 7 } }));
  const startedNodes = nodesOfKind<CityBuildingNode>(justStarted, "cityBuilding");
  assert.equal(startedNodes.find((n) => n.buildingKind === "townHall")?.constructionStage, 1);
  assert.equal(startedNodes.find((n) => n.buildingKind === "house")?.constructionStage, undefined);

  const mid = buildCityScene(baseInput({ buildings, upgrades: { ...base, daysRemaining: 5 } }));
  assert.equal(nodesOfKind<CityBuildingNode>(mid, "cityBuilding").find((n) => n.buildingKind === "townHall")?.constructionStage, 2);

  const late = buildCityScene(baseInput({ buildings, upgrades: { ...base, daysRemaining: 1 } }));
  assert.equal(nodesOfKind<CityBuildingNode>(late, "cityBuilding").find((n) => n.buildingKind === "townHall")?.constructionStage, 3);
});

test("a batch building upgrade stages only its requested buildings, at the max-days progress", () => {
  const buildings: BuildingDef[] = [
    { gx: 1, gy: 1, kind: "goldMine", level: 1, style: "classic" },
    { gx: 2, gy: 1, kind: "house", level: 1, style: "classic" },
    { gx: 3, gy: 1, kind: "market", level: 1, style: "classic" },
  ];
  const nodes = buildCityScene(
    baseInput({
      buildings,
      upgrades: {
        kind: "buildings",
        targetLevel: 2,
        daysRemaining: 1,
        buildingRefs: [
          { gx: 1, gy: 1, kind: "goldMine" },
          { gx: 2, gy: 1, kind: "house" },
        ],
      },
    }),
  );
  const buildingNodes = nodesOfKind<CityBuildingNode>(nodes, "cityBuilding");
  assert.equal(buildingNodes.find((n) => n.buildingKind === "goldMine")?.constructionStage, 3, "goldMine total is 4 days, 3 elapsed = 75%");
  assert.equal(buildingNodes.find((n) => n.buildingKind === "house")?.constructionStage, 3);
  assert.equal(buildingNodes.find((n) => n.buildingKind === "market")?.constructionStage, undefined, "market is not part of the upgrade");
});

test("a settlement-tier upgrade does not stage any city building", () => {
  const buildings: BuildingDef[] = [{ gx: 0, gy: 0, kind: "townHall", level: 1, style: "classic" }];
  const nodes = buildCityScene(
    baseInput({ buildings, upgrades: { kind: "settlement", targetLevel: 2, daysRemaining: 10 } }),
  );
  for (const b of nodesOfKind<CityBuildingNode>(nodes, "cityBuilding")) {
    assert.equal(b.constructionStage, undefined);
  }
});

test("newly placed buildings stage from their own construction timer", () => {
  const buildings: BuildingDef[] = [
    { gx: 0, gy: 0, kind: "goldMine", level: 1, style: "classic", construction: { daysRemaining: 4 } },
    { gx: 1, gy: 1, kind: "goldMine", level: 1, style: "classic", construction: { daysRemaining: 1 } },
    { gx: 2, gy: 1, kind: "woodcutterHut", level: 1, style: "classic", construction: { daysRemaining: 1 } },
    { gx: 3, gy: 1, kind: "house", level: 1, style: "classic" },
  ];
  const nodes = buildCityScene(baseInput({ buildings }));
  const buildingNodes = nodesOfKind<CityBuildingNode>(nodes, "cityBuilding");
  assert.equal(
    buildingNodes.find((n) => n.gx === 0)?.constructionStage,
    1,
    "goldMine total is 4 days, none elapsed = wood-pile plot",
  );
  assert.equal(
    buildingNodes.find((n) => n.gx === 1)?.constructionStage,
    3,
    "goldMine at 3 of 4 days elapsed = 75% = near-complete scaffold",
  );
  assert.equal(
    buildingNodes.find((n) => n.gx === 2)?.constructionStage,
    2,
    "woodcutter total is 3 days, 2 elapsed = 66.7% = scaffold",
  );
  assert.equal(buildingNodes.find((n) => n.buildingKind === "house")?.constructionStage, undefined);
});

test("placement construction takes precedence over upgrade staging", () => {
  const buildings: BuildingDef[] = [
    { gx: 1, gy: 1, kind: "goldMine", level: 1, style: "classic", construction: { daysRemaining: 4 } },
  ];
  const nodes = buildCityScene(
    baseInput({
      buildings,
      upgrades: {
        kind: "buildings",
        targetLevel: 2,
        daysRemaining: 1,
        buildingRefs: [{ gx: 1, gy: 1, kind: "goldMine" }],
      },
    }),
  );
  const node = nodesOfKind<CityBuildingNode>(nodes, "cityBuilding")[0];
  assert.equal(node.constructionStage, 1, "the in-flight placement wins over the (impossible-but-safe) upgrade path");
});

test("ghost building node is only present when a ghost is provided, and resolves its style via pickStyleForBuilding", () => {  const withoutGhost = buildCityScene(baseInput());
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

test("labelOffsetY shifts both labels below the fixed toolbar overlay (F16a)", () => {
  const nodes = buildCityScene(baseInput({ labelOffsetY: 125 }));
  const labels = nodesOfKind<CityLabelNode>(nodes, "cityLabel");
  assert.equal(labels.length, 2);
  assert.equal(labels[0].y, 137, "name label 12 + 125");
  assert.equal(labels[1].y, 155, "subtitle label 30 + 125");
  assert.equal(labels[0].x, 12, "x positions are untouched");
});

test("buildableCells flags exactly the free cells, keyed \"gx,gy\" (F16b)", () => {
  const nodes = buildCityScene(baseInput({ buildableCells: new Set(["0,0", "2,3"]) }));
  const cells = nodesOfKind<CityCellNode>(nodes, "cityCell");
  const buildable = cells.filter((c) => c.buildable).map((c) => `${c.gx},${c.gy}`).sort();
  assert.deepEqual(buildable, ["0,0", "2,3"]);

  const none = buildCityScene(baseInput());
  assert.ok(nodesOfKind<CityCellNode>(none, "cityCell").every((c) => !c.buildable), "no buildableCells input -> every cell unflagged");
});
