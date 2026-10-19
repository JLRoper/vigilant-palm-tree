import { test } from "node:test";
import assert from "node:assert/strict";
import type { CaravanState, HeroState, SettlementState, TradeRouteId, TradeRouteState } from "@heroes/contracts";
import { Hero } from "../../src/entities/hero";
import { axialToPixel } from "../../src/core/hex";
import { CaravanVisualTracker, caravanAtWorldPoint, resolveCaravanMarkers } from "../../src/render/caravanMarkers";
import { buildAdventureScene } from "../../src/render/scene/sceneBuilder/adventureScene";
import { paintCaravanMarker } from "../../src/render/scene/paint2d/index";
import type { Paint2DDep, ResolvedSprite } from "../../src/render/scene/paint2d/deps";
import type { CaravanMarkerNode, CaravanRouteNode } from "../../src/render/scene/types";
import { makeHero } from "../charter/_helpers";
import { makeGrassMap, makeRenderOptions, stubColorForOwner } from "./_helpers";

function nodesOfKind<K extends { kind: string }>(nodes: unknown[], kind: K["kind"]): K[] {
  return (nodes as { kind: string }[]).filter((n) => n.kind === kind) as K[];
}

function makeSettlement(id: string, ownerId: number | null, q: number, r: number): SettlementState {
  return {
    id,
    name: `Settlement ${id}`,
    ownerId,
    q,
    r,
    level: 1,
    population: 10,
    goldTax: 0,
    resourceRates: {},
    foundedOnResource: null,
    gold: 0,
    warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
    citySpots: [],
    cityMines: [],
    morale: 100,
    garrisonUnpaidSinceDay: null,
    garrisonUnpaidTroops: 0,
    garrisonUnpaidGold: 0,
    autoTrade: false,
    castleVariant: 0,
    buildings: [],
  };
}

// The endpoint/payload route shape (the 2026-10-02 caravan-types split):
// settlement endpoints + a wood cargo payload by default; `overrides`
// swaps in hero endpoints or a gold payload for the per-kind tests.
function makeRoute(
  id: string,
  fromId: string,
  toId: string,
  wagons: number,
  caravan: CaravanState | null,
  overrides: Partial<TradeRouteState> = {},
): TradeRouteState {
  return {
    id,
    from: { kind: "settlement", id: fromId },
    to: { kind: "settlement", id: toId },
    payload: { kind: "resource", resource: "wood" },
    wagons,
    caravan,
    ...overrides,
  };
}

// ---- resolveCaravanMarkers (caller-side resolution) -------------------------

test("a still-loading route (caravan null) produces no marker spec -- it never reaches the builder", () => {
  const settlements = { "s-a": makeSettlement("s-a", 0, 0, 0) };
  const specs = resolveCaravanMarkers([makeRoute("r0", "s-a", "s-b", 4, null)], settlements);
  assert.deepEqual(specs, []);
});

test("a departed caravan with pathIndex 0 resolves to the origin settlement tile", () => {
  const settlements = {
    "s-a": makeSettlement("s-a", 1, 3, 2),
    "s-b": makeSettlement("s-b", 1, 3, 8),
  };
  const caravan: CaravanState = { phase: "toDestination", cargo: 200, path: [{ q: 3, r: 3 }, { q: 3, r: 4 }], pathIndex: 0 };
  const specs = resolveCaravanMarkers([makeRoute("r0", "s-a", "s-b", 4, caravan)], settlements);
  assert.equal(specs.length, 1);
  assert.deepEqual(specs[0], {
    routeId: "r0",
    q: 3,
    r: 2,
    ownerId: 1,
    wagons: 4,
    payloadKind: "resource",
    remainingPath: [{ q: 3, r: 3 }, { q: 3, r: 4 }],
  }, "pathIndex 0 -> the from-settlement tile, from's owner, route wagons, whole leg remaining");
});

test("a walking caravan occupies the last consumed path tile (path[pathIndex - 1])", () => {
  const settlements = {
    "s-a": makeSettlement("s-a", 2, 0, 0),
    "s-b": makeSettlement("s-b", 2, 6, 0),
  };
  const path = [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }, { q: 4, r: 0 }, { q: 5, r: 0 }];
  const caravan: CaravanState = { phase: "toHome", cargo: 0, path, pathIndex: 3 };
  const specs = resolveCaravanMarkers([makeRoute("r0", "s-a", "s-b", 7, caravan)], settlements);
  assert.deepEqual(specs[0], {
    routeId: "r0",
    q: 3,
    r: 0,
    ownerId: 2,
    wagons: 7,
    payloadKind: "resource",
    remainingPath: [{ q: 4, r: 0 }, { q: 5, r: 0 }],
  }, "pathIndex 3 -> path[2] = (3,0), remaining = the two tiles after it");
});

test("a returning caravan (toHome, pathIndex >= 1) resolves to its real path tile, never the origin-tile fallback", () => {
  const settlements = {
    "s-a": makeSettlement("s-a", 1, 3, 2),
    "s-b": makeSettlement("s-b", 1, 3, 8),
  };
  // The return-leg shape the advance builds on every toHome flip: path[0]
  // is the caravan's real departure tile and pathIndex starts at 1, so the
  // marker sits on the walked tile. The pathIndex-0 origin-tile fallback
  // only ever applies to OUTBOUND loading (pinned above).
  const caravan: CaravanState = {
    phase: "toHome",
    cargo: 0,
    path: [{ q: 3, r: 7 }, { q: 3, r: 6 }, { q: 3, r: 5 }, { q: 3, r: 4 }, { q: 3, r: 3 }],
    pathIndex: 1,
  };
  const specs = resolveCaravanMarkers([makeRoute("r0", "s-a", "s-b", 4, caravan)], settlements);
  assert.deepEqual(
    specs,
    [{
      routeId: "r0",
      q: 3,
      r: 7,
      ownerId: 1,
      wagons: 4,
      payloadKind: "resource",
      remainingPath: [{ q: 3, r: 6 }, { q: 3, r: 5 }, { q: 3, r: 4 }, { q: 3, r: 3 }],
    }],
    "pathIndex 1 -> path[0] = (3,7), the real departure tile (the origin at (3,2) is never reported for a walked toHome caravan)",
  );
});

test("a hero-origin route resolves tile and owner from the heroes record", () => {
  const settlements = { "s-b": makeSettlement("s-b", 1, 6, 0) };
  const hero: HeroState = makeHero("h-0", 1, 3, 2);
  const caravan: CaravanState = { phase: "toDestination", cargo: 100, path: [{ q: 3, r: 3 }], pathIndex: 1 };
  const specs = resolveCaravanMarkers(
    [makeRoute("r0", "s-a", "s-b", 3, caravan, { from: { kind: "hero", id: "h-0" } })],
    settlements,
    { "h-0": hero },
  );
  assert.deepEqual(specs, [{ routeId: "r0", q: 3, r: 3, ownerId: 1, wagons: 3, payloadKind: "resource" }], "tile from the path, owner from the hero, wagons from the route");
});

test("a hero-origin route with a missing hero produces no spec; a gold route carries payloadKind gold", () => {
  const settlements = { "s-b": makeSettlement("s-b", 1, 6, 0) };
  const caravan: CaravanState = { phase: "toDestination", cargo: 500, path: [{ q: 4, r: 0 }], pathIndex: 1 };
  const gone = resolveCaravanMarkers(
    [makeRoute("r-gone", "s-a", "s-b", 2, caravan, { from: { kind: "hero", id: "h-x" } })],
    settlements,
    {},
  );
  assert.deepEqual(gone, [], "a dead hero origin resolves to no marker, like a missing settlement");
  const treasure = resolveCaravanMarkers(
    [makeRoute("r-gold", "s-b", "s-b", 2, caravan, { payload: { kind: "gold" } })],
    settlements,
    {},
  );
  assert.deepEqual(treasure, [{ routeId: "r-gold", q: 4, r: 0, ownerId: 1, wagons: 2, payloadKind: "gold" }], "the additive payload kind rides along for a gold-tinted marker");
});

test("routes whose origin settlement is missing or unowned produce no marker spec", () => {
  const settlements = {
    "s-a": makeSettlement("s-a", 0, 0, 0),
    "s-n": makeSettlement("s-n", null, 4, 0),
  };
  const caravan: CaravanState = { phase: "toDestination", cargo: 50, path: [{ q: 1, r: 0 }], pathIndex: 1 };
  const specs = resolveCaravanMarkers(
    [
      makeRoute("r-gone", "s-x", "s-a", 2, caravan),
      makeRoute("r-neutral", "s-n", "s-a", 2, caravan),
    ],
    settlements,
  );
  assert.deepEqual(specs, [], "a missing settlement and a null-owner settlement both skip");
});

test("undefined or empty trade routes resolve to no marker specs", () => {
  assert.deepEqual(resolveCaravanMarkers(undefined, {}), []);
  assert.deepEqual(resolveCaravanMarkers([], {}), []);
});

// ---- buildAdventureScene emission (fog + z-order) ---------------------------

test("the builder emits one caravanMarker node per visible caravan with position, owner colour, and wagons", () => {
  const map = makeGrassMap(10, 1);
  const hero = new Hero("h0", "Hero", 0, 0, "player", 0);
  const nodes = buildAdventureScene({
    map,
    heroes: [hero],
    castles: [],
    path: [],
    hover: null,
    opts: makeRenderOptions({
      viewPlayerId: 0,
      caravans: [{ routeId: "r0", q: 2, r: 0, ownerId: 0, wagons: 5, payloadKind: "gold" }],
    }),
  });

  const markers = nodesOfKind<CaravanMarkerNode>(nodes, "caravanMarker");
  assert.equal(markers.length, 1);
  const [node] = markers;
  assert.equal(node.q, 2);
  assert.equal(node.r, 0);
  assert.deepEqual(node.world, axialToPixel(2, 0));
  assert.equal(node.color, stubColorForOwner(0));
  assert.equal(node.wagons, 5);
  assert.equal(node.payloadKind, "gold", "the payload kind threads through the node additively (nothing paints it yet)");
});

test("an enemy caravan hidden in fog of war is invisible; in vision it draws", () => {
  const map = makeGrassMap(10, 1);
  const hero = new Hero("h0", "Hero", 0, 0, "player", 0);
  const opts = makeRenderOptions({
    viewPlayerId: 0,
    caravans: [
      { routeId: "r-hidden", q: 2, r: 0, ownerId: 1, wagons: 3 },
      { routeId: "r-far", q: 8, r: 0, ownerId: 1, wagons: 3 },
    ],
  });

  const nodes = buildAdventureScene({ map, heroes: [hero], castles: [], path: [], hover: null, opts });
  const markers = nodesOfKind<CaravanMarkerNode>(nodes, "caravanMarker");
  assert.equal(markers.length, 1, "only the caravan within VISION_RANGE=4 of the own hero draws");
  assert.equal(markers[0].q, 2);
  assert.equal(markers[0].color, stubColorForOwner(1), "enemy caravan carries the enemy seat's colour");
});

test("an own caravan renders even outside the visible set, mirroring the hero and castle own-seat gate", () => {
  const map = makeGrassMap(10, 1);
  const hero = new Hero("h0", "Hero", 0, 0, "player", 0);
  const nodes = buildAdventureScene({
    map,
    heroes: [hero],
    castles: [],
    path: [],
    hover: null,
    opts: makeRenderOptions({
      viewPlayerId: 0,
      caravans: [{ routeId: "r0", q: 8, r: 0, ownerId: 0, wagons: 2 }],
    }),
  });

  const markers = nodesOfKind<CaravanMarkerNode>(nodes, "caravanMarker");
  assert.equal(markers.length, 1, "own seat -> canSee short-circuits exactly like the hero loop");
});

test("caravan markers paint after path segments and before heroes (entity layer)", () => {
  const map = makeGrassMap(10, 1);
  const hero = new Hero("h0", "Hero", 0, 0, "player", 0, 10);
  const nodes = buildAdventureScene({
    map,
    heroes: [hero],
    castles: [],
    path: [{ q: 1, r: 0 }, { q: 2, r: 0 }],
    hover: null,
    opts: makeRenderOptions({
      viewPlayerId: 0,
      selectedHeroId: "h0",
      caravans: [{ routeId: "r0", q: 2, r: 0, ownerId: 0, wagons: 4 }],
    }),
  });

  const idx = (kind: string, pick?: (n: { kind: string }) => boolean): number[] =>
    nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.kind === kind && (!pick || pick(n))).map(({ i }) => i);
  const segments = idx("pathSegment");
  const caravans = idx("caravanMarker");
  const heroes = idx("hero");
  assert.ok(segments.length > 0, "fixture produces path segment nodes");
  assert.equal(caravans.length, 1);
  assert.equal(heroes.length, 1);
  assert.ok(caravans[0] > segments[segments.length - 1], "caravan paints after the last path segment");
  assert.ok(caravans[0] < heroes[0], "caravan paints before the hero so a hero on the same tile draws above it");
});

// ---- hover: ring any visible cart, preview only own routes ------------------

test("hovering an own caravan rings the marker and emits its remaining route", () => {
  const map = makeGrassMap(10, 1);
  const hero = new Hero("h0", "Hero", 0, 0, "player", 0);
  const nodes = buildAdventureScene({
    map,
    heroes: [hero],
    castles: [],
    path: [],
    hover: null,
    opts: makeRenderOptions({
      viewPlayerId: 0,
      hoveredCaravanId: "r0",
      caravans: [{
        routeId: "r0",
        q: 2,
        r: 0,
        ownerId: 0,
        wagons: 3,
        payloadKind: "resource",
        remainingPath: [{ q: 3, r: 0 }, { q: 4, r: 0 }],
      }],
    }),
  });

  const routes = nodesOfKind<CaravanRouteNode>(nodes, "caravanRoute");
  assert.equal(routes.length, 1);
  assert.equal(routes[0].routeId, "r0");
  assert.deepEqual(routes[0].points, [
    axialToPixel(2, 0),
    axialToPixel(3, 0),
    axialToPixel(4, 0),
  ], "route starts at the cart and follows the remaining leg");
  const [marker] = nodesOfKind<CaravanMarkerNode>(nodes, "caravanMarker");
  assert.equal(marker.hovered, true);
});

test("hovering an enemy caravan rings it but never draws its route", () => {
  const map = makeGrassMap(10, 1);
  const hero = new Hero("h0", "Hero", 0, 0, "player", 0);
  const nodes = buildAdventureScene({
    map,
    heroes: [hero],
    castles: [],
    path: [],
    hover: null,
    opts: makeRenderOptions({
      viewPlayerId: 0,
      hoveredCaravanId: "r-enemy",
      caravans: [{
        routeId: "r-enemy",
        q: 2,
        r: 0,
        ownerId: 1,
        wagons: 2,
        remainingPath: [{ q: 3, r: 0 }],
      }],
    }),
  });

  assert.equal(nodesOfKind<CaravanRouteNode>(nodes, "caravanRoute").length, 0, "enemy destination stays hidden");
  const [marker] = nodesOfKind<CaravanMarkerNode>(nodes, "caravanMarker");
  assert.equal(marker.hovered, true, "the visible enemy cart still rings under the pointer");
});

// ---- painter seam ----------------------------------------------------------

test("paintCaravanMarker resolves the per-direction sprite and rings a hovered cart", () => {
  const requested: Array<[string | undefined, string | undefined]> = [];
  const ellipses: number[][] = [];
  const drawnImages: unknown[] = [];
  const fakeImg = { naturalWidth: 256, naturalHeight: 256 } as unknown as HTMLImageElement;

  const deps = {
    sprite: {
      resolveSpriteForCaravan: (payloadKind?: "resource" | "gold", direction?: string) => {
        requested.push([payloadKind, direction]);
        return {
          drawable: fakeImg,
          ready: true,
          descriptor: {
            key: `caravan.${payloadKind === "gold" ? "gold" : "resource"}.${direction}`,
            url: "x.png",
            anchor: "bottom",
            sizing: { kind: "fitHeight", hexSizeMul: 1.45 },
            naturalSize: 256,
            anchorOffsetY: 2,
          },
        } satisfies ResolvedSprite;
      },
      resolveSprite: () => undefined,
    },
  } as unknown as Paint2DDep;

  const ctx = {
    imageSmoothingEnabled: true,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    save() {},
    restore() {},
    translate() {},
    scale() {},
    drawImage(img: unknown) { drawnImages.push(img); },
    beginPath() {},
    arc() {},
    ellipse(x: number, y: number, rx: number, ry: number) { ellipses.push([x, y, rx, ry]); },
    fill() {},
    stroke() {},
    strokeText() {},
    fillText() {},
  } as unknown as CanvasRenderingContext2D;

  paintCaravanMarker(
    ctx,
    {
      kind: "caravanMarker",
      q: 1,
      r: 0,
      world: { x: 100, y: 100 },
      color: "#3388ff",
      wagons: 3,
      payloadKind: "gold",
      facingDirection: "sw",
      hovered: true,
    },
    deps,
  );

  assert.deepEqual(requested, [["gold", "sw"]], "the painter asks for the gold cart facing south-west");
  assert.deepEqual(drawnImages, [fakeImg]);
  assert.equal(ellipses.length, 2, "hover draws the bright inner ellipse and the owner-tinted halo");
  assert.deepEqual(ellipses[0], [100, 100, 32 * 0.72, 32 * 0.4]);
});

test("caravanAtWorldPoint picks the cart under the pointer and ignores empty ground", () => {
  const caravans = [
    { routeId: "r0" as TradeRouteId, q: 2, r: 0, ownerId: 0, wagons: 3 },
    { routeId: "r1" as TradeRouteId, q: 6, r: 0, ownerId: 0, wagons: 2, pixelOffset: { x: 12, y: 0 } },
  ];
  const cart = axialToPixel(2, 0);
  assert.equal(caravanAtWorldPoint(caravans, { x: cart.x, y: cart.y - 8 }), "r0", "torso of the sprite hits");
  assert.equal(caravanAtWorldPoint(caravans, { x: cart.x + 30, y: cart.y - 8 }), null, "empty ground beside it misses");
  const moving = axialToPixel(6, 0);
  assert.equal(caravanAtWorldPoint(caravans, { x: moving.x + 12, y: moving.y - 8 }), "r1", "mid-tween offset is honoured");
});

test("CaravanVisualTracker tweens a caravan step-by-step along its walked path at turn end", () => {
  const map = makeGrassMap(10, 4);
  const settlements = {
    "s-a": makeSettlement("s-a", 0, 0, 0),
    "s-b": makeSettlement("s-b", 0, 6, 0),
  };
  const path = [
    { q: 1, r: 0 },
    { q: 2, r: 0 },
    { q: 3, r: 0 },
    { q: 4, r: 0 },
    { q: 5, r: 0 },
    { q: 6, r: 0 },
  ];

  const tracker = new CaravanVisualTracker();
  // Initial boot/load state: caravan loaded at origin (pathIndex: 0)
  tracker.syncFromState(
    {
      tradeRoutes: [
        makeRoute("r0", "s-a", "s-b", 3, {
          phase: "toDestination",
          cargo: 150,
          path,
          pathIndex: 0,
        }),
      ],
      settlements,
      heroes: {},
    },
    map,
  );
  const initialSpecs = tracker.getMarkerSpecs();
  assert.equal(initialSpecs.length, 1);
  assert.equal(initialSpecs[0].q, 0);
  assert.equal(initialSpecs[0].r, 0);
  assert.equal(initialSpecs[0].moving, undefined);

  // End of turn: caravan advances 4 steps to (4,0)
  tracker.syncFromState(
    {
      tradeRoutes: [
        makeRoute("r0", "s-a", "s-b", 3, {
          phase: "toDestination",
          cargo: 150,
          path,
          pathIndex: 4,
        }),
      ],
      settlements,
      heroes: {},
    },
    map,
  );

  const visual = tracker.getVisual("r0");
  assert.ok(visual);
  assert.equal(visual.moving, true);
  assert.equal(visual.animationPath.length, 5, "origin + 4 walked steps");
  assert.deepEqual(visual.animationPath, [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: 2, r: 0 },
    { q: 3, r: 0 },
    { q: 4, r: 0 },
  ]);
  assert.deepEqual(visual.tile, { q: 0, r: 0 }, "the tween starts at the walk path's first tile (the origin)");
  assert.deepEqual(visual.toTile, { q: 1, r: 0 });
  assert.equal(visual.facingDirection, "e");

  // Mid-segment tick: pixelOffset is non-zero and world position in buildAdventureScene is interpolated
  assert.equal(tracker.update(110), true);
  const midSpec = tracker.getMarkerSpecs()[0];
  assert.equal(midSpec.moving, true);
  assert.ok((midSpec.pixelOffset?.x ?? 0) > 0, "interpolating eastward toward (1,0)");

  const sceneNodes = buildAdventureScene({
    map,
    heroes: [],
    castles: [],
    path: [],
    hover: null,
    opts: makeRenderOptions({
      viewPlayerId: 0,
      caravans: [midSpec],
    }),
  });
  const [markerNode] = nodesOfKind<CaravanMarkerNode>(sceneNodes, "caravanMarker");
  assert.ok(markerNode.world.x > axialToPixel(0, 0).x && markerNode.world.x < axialToPixel(1, 0).x, "interpolating eastward toward (1,0)");
  assert.ok(markerNode.markerWorld, "moving caravan emits steady markerWorld for owner dot and count badge");

  // Advance through all 4 segments to completion
  for (let i = 0; i < 20 && visual.moving; i++) {
    tracker.update(120);
  }
  assert.equal(visual.moving, false);
  assert.deepEqual(visual.tile, { q: 4, r: 0 });
});

test("CaravanVisualTracker animates a returning toHome caravan into the origin settlement before retiring", () => {
  const map = makeGrassMap(10, 4);
  const settlements = {
    "s-a": makeSettlement("s-a", 0, 0, 0),
    "s-b": makeSettlement("s-b", 0, 3, 0),
  };
  const returnPath = [
    { q: 3, r: 0 },
    { q: 2, r: 0 },
    { q: 1, r: 0 },
    { q: 0, r: 0 },
  ];

  const tracker = new CaravanVisualTracker();
  tracker.syncFromState(
    {
      tradeRoutes: [
        makeRoute("r0", "s-a", "s-b", 2, {
          phase: "toHome",
          cargo: 0,
          path: returnPath,
          pathIndex: 1,
        }),
      ],
      settlements,
      heroes: {},
    },
    map,
  );
  assert.deepEqual(tracker.getVisual("r0")?.tile, { q: 3, r: 0 });

  // End of turn: caravan finishes return leg and unloads at origin (caravan becomes null)
  tracker.syncFromState(
    {
      tradeRoutes: [makeRoute("r0", "s-a", "s-b", 2, null)],
      settlements,
      heroes: {},
    },
    map,
  );

  const visual = tracker.getVisual("r0");
  assert.ok(visual, "visual remains alive to walk the final steps into the origin settlement");
  assert.equal(visual.moving, true);
  assert.equal(visual.retiringAfterMove, true);
  assert.equal(visual.facingDirection, "w");

  for (let i = 0; i < 20 && visual.moving; i++) {
    tracker.update(120);
  }
  assert.equal(tracker.getVisual("r0"), undefined, "visual retires once it arrives at origin");
  assert.equal(tracker.getMarkerSpecs().length, 0);
});
