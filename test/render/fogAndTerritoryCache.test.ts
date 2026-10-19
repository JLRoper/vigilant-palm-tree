import { test } from "node:test";
import assert from "node:assert/strict";
import { Hero } from "../../src/entities/hero";
import { Castle } from "../../src/entities/settlement";
import { computeVision, computeVisionFromState, isVisible, VisionSet } from "../../src/render/fog";
import { HEX_SIZE, UNIT_HEX_CORNERS, hexCorners } from "../../src/core/hex";
import {
  Camera,
  HEX_COLUMN_WIDTH,
  computeMinZoomForHexWidth,
  getRowQBounds,
} from "../../src/render/camera";
import {
  clampMaxZoomOutHexesWide,
  maxZoomOutHexesWideBounds,
} from "../../src/state/settings";
import { hexPath } from "../../src/render/scene/paint2d/geometry";
import { buildAdventureScene } from "../../src/render/scene/sceneBuilder/adventureScene";
import type { TerrainHexNode, TerritoryOutlineEdgeNode } from "../../src/render/scene/types";
import { makeHero, makeSettlement, makeState } from "../charter/_helpers";
import { makeGrassMap, makeRenderOptions } from "./_helpers";

test("computeVision and computeVisionFromState memoize VisionSet until hero/castle vision inputs change", () => {
  const hero = new Hero("h0", "Hero", 2, 2, "player", 0);
  const castle = Castle.fromGameState(makeSettlement("c0", 0, 10, 10, { level: 1 }));

  const v1 = computeVision([hero], [castle], 0);
  const v2 = computeVision([hero], [castle], 0);
  assert.ok(v1 instanceof VisionSet);
  assert.equal(v1, v2, "unchanged hero/castle positions reuse the memoized VisionSet instance");

  // Moving the hero invalidates the cache
  hero.tile = { q: 3, r: 2 };
  const v3 = computeVision([hero], [castle], 0);
  assert.notEqual(v3, v1, "hero move invalidates computeVision cache");
  assert.equal(isVisible(v3, 7, 2), true);

  // Upgrading the castle invalidates the cache
  castle.level = 2;
  const v4 = computeVision([hero], [castle], 0);
  assert.notEqual(v4, v3, "castle level upgrade invalidates computeVision cache");

  // computeVisionFromState memoization & invalidation
  const state1 = makeState({
    heroes: [makeHero("h0", 0, 2, 2)],
    settlements: [makeSettlement("s0", 0, 10, 10, { level: 1 })],
  });
  const sv1 = computeVisionFromState(state1, 0);
  const sv2 = computeVisionFromState(state1, 0);
  assert.equal(sv1, sv2, "unchanged state reuses memoized VisionSet instance");

  const state2 = makeState({
    heroes: [makeHero("h0", 0, 4, 2)],
    settlements: [makeSettlement("s0", 0, 10, 10, { level: 1 })],
  });
  const sv3 = computeVisionFromState(state2, 0);
  assert.notEqual(sv3, sv1, "moved hero in state invalidates computeVisionFromState cache");
});

test("caravans contribute a 2-tile vision ring for their owner only", () => {
  const caravan = { q: 10, r: 10, ownerId: 0 };

  const own = computeVision([], [], 0, 4, [caravan]);
  assert.equal(isVisible(own, 10, 12), true, "2 tiles away is inside the wagon's ring");
  assert.equal(isVisible(own, 12, 10), true, "the other axis is symmetric");
  assert.equal(isVisible(own, 10, 13), false, "3 tiles away is outside the wagon's ring");

  const enemySeat = computeVision([], [], 0, 4, [{ ...caravan, ownerId: 1 }]);
  assert.equal(isVisible(enemySeat, 10, 11), false, "another seat's wagon reveals nothing to this one");

  const moved = computeVision([], [], 0, 4, [{ ...caravan, q: 14, r: 10 }]);
  assert.equal(isVisible(moved, 10, 10), false, "a moved wagon invalidates the memoized set");
  assert.equal(isVisible(moved, 14, 11), true);
});

test("computeVisionFromState resolves caravan rings from live trade routes", () => {
  const state = makeState({
    heroes: [makeHero("h0", 0, 0, 0), makeHero("ai-h", 1, 30, 30)],
    settlements: [makeSettlement("s0", 0, 10, 10, { level: 1 }), makeSettlement("s1", 1, 30, 30)],
    tradeRoutes: [{
      id: "r0",
      from: { kind: "settlement", id: "s0" },
      to: { kind: "settlement", id: "s1" },
      payload: { kind: "resource", resource: "wood" },
      wagons: 2,
      caravan: {
        phase: "toDestination",
        cargo: 50,
        path: [{ q: 12, r: 10 }, { q: 13, r: 10 }, { q: 14, r: 10 }, { q: 15, r: 10 }],
        pathIndex: 4,
      },
    }],
  });

  const visible = computeVisionFromState(state, 0);
  assert.equal(isVisible(visible, 15, 12), true, "the wagon at (15,10) sees two tiles out");
  assert.equal(isVisible(visible, 15, 13), false, "its ring is smaller than a hero's four");
});

test("VisionSet.hasCoords and isVisible agree with Set.has across positive, negative, and out-of-grid coordinates", () => {
  const heroAtOrigin = new Hero("h0", "Hero", 0, 0, "player", 0);
  const vis = computeVision([heroAtOrigin], [], 0, 4);

  for (let r = -6; r <= 6; r++) {
    for (let q = -6; q <= 6; q++) {
      const expected = vis.has(`${q},${r}`);
      assert.equal(vis.hasCoords(q, r), expected, `hasCoords mismatch at (${q},${r})`);
      assert.equal(isVisible(vis, q, r), expected, `isVisible mismatch at (${q},${r})`);
    }
  }

  // Out-of-grid coordinates (> 223 or < -32) fall back cleanly to super.has
  vis.addCoords(400, 500);
  assert.equal(vis.has("400,500"), true);
  assert.equal(isVisible(vis, 400, 500), true);
  assert.equal(isVisible(vis, 401, 500), false);
});

test("buildAdventureScene caches territoryOutlineEdge nodes and invalidates when castle state or vision changes", () => {
  const map = makeGrassMap(12, 12);
  const hero = new Hero("h0", "Hero", 5, 5, "player", 0);
  const castle = Castle.fromGameState(makeSettlement("c0", 0, 5, 5, { level: 1 }));

  const nodes1 = buildAdventureScene({
    map,
    heroes: [hero],
    castles: [castle],
    path: [],
    hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0 }),
  });
  const edges1 = nodes1.filter((n): n is TerritoryOutlineEdgeNode => n.kind === "territoryOutlineEdge");
  assert.ok(edges1.length > 0);

  const nodes2 = buildAdventureScene({
    map,
    heroes: [hero],
    castles: [castle],
    path: [],
    hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0 }),
  });
  const edges2 = nodes2.filter((n): n is TerritoryOutlineEdgeNode => n.kind === "territoryOutlineEdge");
  assert.equal(edges1[0], edges2[0], "steady-state frame reuses cached TerritoryOutlineEdgeNode instances");

  // Upgrade castle level -> territory expands -> new edge array
  castle.level = 2;
  const nodes3 = buildAdventureScene({
    map,
    heroes: [hero],
    castles: [castle],
    path: [],
    hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0 }),
  });
  const edges3 = nodes3.filter((n): n is TerritoryOutlineEdgeNode => n.kind === "territoryOutlineEdge");
  assert.notEqual(edges3[0], edges1[0], "castle level change invalidates territory edge cache");
  assert.ok(edges3.length > edges1.length);
});

test("UNIT_HEX_CORNERS, hexCorners, and hexPath match exact trig corner positions", () => {
  assert.equal(UNIT_HEX_CORNERS.length, 6);
  const cx = 100;
  const cy = 200;
  const size = HEX_SIZE;
  const corners = hexCorners(cx, cy, size);

  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    assert.equal(UNIT_HEX_CORNERS[i].x, Math.cos(angle));
    assert.equal(UNIT_HEX_CORNERS[i].y, Math.sin(angle));
    assert.equal(corners[i].x, cx + size * Math.cos(angle));
    assert.equal(corners[i].y, cy + size * Math.sin(angle));
  }

  const pts: Array<{ op: string; x: number; y: number }> = [];
  let closed = false;
  const fakeCtx = {
    beginPath() {},
    moveTo(x: number, y: number) {
      pts.push({ op: "M", x, y });
    },
    lineTo(x: number, y: number) {
      pts.push({ op: "L", x, y });
    },
    closePath() {
      closed = true;
    },
  } as unknown as CanvasRenderingContext2D;

  hexPath(fakeCtx, cx, cy, size);
  assert.equal(closed, true);
  assert.equal(pts.length, 6);
  assert.equal(pts[0].op, "M");
  for (let i = 0; i < 6; i++) {
    assert.equal(pts[i].x, corners[i].x);
    assert.equal(pts[i].y, corners[i].y);
  }
});

test("clampMaxZoomOutHexesWide clamps to [20, 34] and defaults to 20", () => {
  const b = maxZoomOutHexesWideBounds();
  assert.deepEqual(b, { min: 20, max: 34, default: 20 });
  assert.equal(clampMaxZoomOutHexesWide(undefined), 20);
  assert.equal(clampMaxZoomOutHexesWide(NaN), 20);
  assert.equal(clampMaxZoomOutHexesWide(10), 20);
  assert.equal(clampMaxZoomOutHexesWide(20), 20);
  assert.equal(clampMaxZoomOutHexesWide(27.4), 27);
  assert.equal(clampMaxZoomOutHexesWide(34), 34);
  assert.equal(clampMaxZoomOutHexesWide(50), 34);
});

test("computeMinZoomForHexWidth, Camera.zoomAt, and Camera.clampMinZoom enforce the 20-34 hex width floor", () => {
  const vw = 1920;
  const minZoom20 = computeMinZoomForHexWidth(vw, 20);
  const minZoom34 = computeMinZoomForHexWidth(vw, 34);

  // Visible hex columns across viewport = vw / (zoom * HEX_COLUMN_WIDTH)
  assert.ok(Math.abs(vw / (minZoom20 * HEX_COLUMN_WIDTH) - 20) < 1e-9);
  assert.ok(Math.abs(vw / (minZoom34 * HEX_COLUMN_WIDTH) - 34) < 1e-9);

  const cam = new Camera();
  cam.zoom = 2.0;
  // Scroll out repeatedly with minZoom34 floor
  for (let i = 0; i < 30; i++) {
    cam.zoomAt(960, 540, 1 / 1.1, minZoom34);
  }
  assert.equal(cam.zoom, minZoom34);

  // Tightening the cap from 34 -> 20 hexes wide clamps zoom up to minZoom20
  const clamped = cam.clampMinZoom(960, 540, minZoom20);
  assert.equal(clamped, true);
  assert.equal(cam.zoom, minZoom20);
  assert.equal(cam.clampMinZoom(960, 540, minZoom20), false);
});

test("row-clipped frustum culling trims sheared parallelogram corners while keeping all on-screen hexes", () => {
  const map = makeGrassMap(120, 90);
  const cam = new Camera();
  cam.zoom = computeMinZoomForHexWidth(1920, 34);
  cam.x = -1200;
  cam.y = -800;

  const bounds = cam.getVisibleAxialBounds(1920, 1080, map.width, map.height, 2);
  const unclippedBoxCount =
    (bounds.qMax - bounds.qMin + 1) * (bounds.rMax - bounds.rMin + 1);

  const nodes = buildAdventureScene({
    map,
    heroes: [],
    castles: [],
    path: [],
    hover: null,
    opts: makeRenderOptions({ viewPlayerId: 0 }),
    viewportBounds: bounds,
  });
  const hexNodes = nodes.filter((n): n is TerrainHexNode => n.kind === "terrainHex");

  assert.ok(
    hexNodes.length < unclippedBoxCount * 0.8,
    `expected row-clipped hex count (${hexNodes.length}) < 80% of unclipped box (${unclippedBoxCount})`,
  );

  // Every emitted hex satisfies getRowQBounds for its row r
  for (const h of hexNodes) {
    const rb = getRowQBounds(bounds, h.r);
    assert.ok(h.q >= rb.qMin && h.q <= rb.qMax);
  }
});
