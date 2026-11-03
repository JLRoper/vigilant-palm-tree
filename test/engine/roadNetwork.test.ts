import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, DistrictState } from "@heroes/contracts";
import {
  GameMap,
  MAX_ROADS_PER_ROUTE,
  WORKFORCE_PER_ROAD,
  buildingMaxWorkers,
  districtWorkforcePercent,
  roadsForWorkforce,
  settlementRoadNetwork,
  type SettlementDistrictLike,
  type Terrain,
  type TileRow,
} from "@heroes/engine";

const CENTER = { q: 4, r: 4 };

// District roads (docs/settlements.md "District roads"): the network grows
// outward from the settlement's own tile, nearest district first, and each
// district joins the cheapest node already in the network. Road COUNT is the
// district's own workforce read as traffic.

function grassMap(
  width = 9,
  height = 9,
  overrides: Record<string, Terrain> = {},
): GameMap {
  const rows: TileRow[] = [];
  for (let r = 0; r < height; r++) {
    for (let q = 0; q < width; q++) {
      rows.push({ q, r, terrain: overrides[`${q},${r}`] ?? "grass", resource: null });
    }
  }
  return GameMap.fromTiles(rows);
}

const BARRACKS_CAPACITY = buildingMaxWorkers("barracks");

/** Five barracks on one city row: slot i gets `crews[i]` workers (undefined = auto). */
function district(
  q: number,
  r: number,
  crews: Array<number | undefined> = [],
): DistrictState {
  const buildings: BuildingDef[] = crews.map((workers, gx) => ({
    gx,
    gy: 0,
    kind: "barracks",
    level: 1,
    ...(workers === undefined ? {} : { workers }),
  }));
  return { q, r, citySpots: [], buildings };
}

/** A district holding one shipyard -- the only building that may stand on water. */
function shipyard(q: number, r: number): DistrictState {
  return { q, r, citySpots: [], buildings: [{ gx: 1, gy: 0, kind: "shipyard", level: 1 }] };
}

function settlement(districts: Record<string, DistrictState>): SettlementDistrictLike {
  return { id: "s1", level: 2, tile: CENTER, districts };
}

test("roadsForWorkforce: one track per 5 workforce, 0 is no road at all", () => {
  assert.equal(WORKFORCE_PER_ROAD, 5);
  assert.equal(roadsForWorkforce(0), 0, "0/100 workforce is 0 roads");
  assert.equal(roadsForWorkforce(15), 3, "15/100 workforce is 3 roads");
  assert.equal(roadsForWorkforce(100), 20);
  assert.equal(roadsForWorkforce(MAX_ROADS_PER_ROUTE * WORKFORCE_PER_ROAD), MAX_ROADS_PER_ROUTE, "the count saturates");
  assert.equal(roadsForWorkforce(2), 0, "under half a road shows nothing");
  assert.equal(roadsForWorkforce(Number.NaN), 0);
});

test("districtWorkforcePercent reads the district's own job slots", () => {
  // The fixture premise: five barracks are five job slots of the same size.
  assert.equal(BARRACKS_CAPACITY, 4, "registry asked for a barracks to hold 4 workers");
  const capacity = 5 * BARRACKS_CAPACITY;

  assert.equal(districtWorkforcePercent(district(5, 4, [3, 0, 0, 0, 0])), (3 / capacity) * 100);
  assert.equal(districtWorkforcePercent(district(5, 4, [4, 4, 4, 4, 4])), 100);
  assert.equal(districtWorkforcePercent(district(5, 4, [0, 0, 0, 0, 0])), 0);
  assert.equal(
    districtWorkforcePercent(district(5, 4, [undefined, undefined, undefined, undefined, undefined])),
    100,
    "an absent crew is the pre-workforce auto (max) assignment, exactly as effortFraction reads it",
  );
  assert.equal(districtWorkforcePercent({ q: 5, r: 4, buildings: [] }), 0);
  assert.equal(districtWorkforcePercent(undefined), 0);
});

test("a settlement with no districts lays no road", () => {
  const map = grassMap();
  assert.deepEqual(settlementRoadNetwork(settlement({}), map).segments, []);
  assert.deepEqual(settlementRoadNetwork({ id: "s1" }, map).routes, []);
});

test("a staffed district gets a road from the settlement tile, one track per 15 workforce", () => {
  const map = grassMap();
  const { routes, segments } = settlementRoadNetwork(
    settlement({ "5,4": district(5, 4, [1, 0, 0, 0, 0]) }),
    map,
  );

  assert.equal(routes.length, 1);
  assert.deepEqual(routes[0].from, CENTER);
  assert.deepEqual(routes[0].tiles, [CENTER, { q: 5, r: 4 }]);
  assert.equal(routes[0].workforce, (1 / (5 * BARRACKS_CAPACITY)) * 100);
  assert.equal(routes[0].roads, 1);

  assert.equal(segments.length, 1, "one edge joins the district to the settlement");
  assert.deepEqual(segments[0].from, CENTER);
  assert.deepEqual(segments[0].to, { q: 5, r: 4 });
  assert.equal(segments[0].strands, 1);
});

test("15 of 100 workforce draws three tracks, and an idle district draws none", () => {
  const map = grassMap();
  const busy = settlementRoadNetwork(
    settlement({ "5,4": district(5, 4, [3, 0, 0, 0, 0]) }),
    map,
  );
  assert.equal(busy.routes[0].workforce, (3 / (5 * BARRACKS_CAPACITY)) * 100);
  assert.equal(busy.routes[0].roads, 3);
  assert.equal(busy.segments[0].strands, 3);

  const idle = settlementRoadNetwork(
    settlement({ "5,4": district(5, 4, [0, 0, 0, 0, 0]) }),
    map,
  );
  assert.equal(idle.routes.length, 1, "the district is still part of the network");
  assert.equal(idle.routes[0].roads, 0);
  assert.deepEqual(idle.segments, [], "0 workforce is 0 roads");
});

test("a district that stops holding buildings is not a district and lays no road", () => {
  const map = grassMap();
  assert.deepEqual(settlementRoadNetwork(settlement({ "5,4": district(5, 4) }), map).routes, []);
  assert.deepEqual(settlementRoadNetwork(settlement({ "5,4": district(5, 4) }), map).segments, []);
});

test("a farther district joins the nearest node already in the network, not the settlement", () => {
  const map = grassMap();
  const { routes, segments } = settlementRoadNetwork(
    settlement({
      "5,4": district(5, 4, [4, 4, 4, 4, 4]),
      "6,4": district(6, 4, [3, 0, 0, 0, 0]),
    }),
    map,
  );

  assert.deepEqual(routes.map((r) => r.districtKey), ["5,4", "6,4"]);
  assert.deepEqual(routes[1].from, { q: 5, r: 4 }, "it grew out of the district next to it");
  assert.deepEqual(routes[1].tiles, [{ q: 5, r: 4 }, { q: 6, r: 4 }]);

  assert.deepEqual(
    segments.map((s) => [s.from, s.to, s.strands]),
    [
      [CENTER, { q: 5, r: 4 }, 20],
      [{ q: 5, r: 4 }, { q: 6, r: 4 }, 3],
    ],
  );
});

test("abandoning a district re-routes the chain that hung off it", () => {
  const map = grassMap();
  const abandoned = settlement({
    "5,4": district(5, 4, [4, 4, 4, 4, 4]),
    "6,4": district(6, 4, [1, 0, 0, 0, 0]),
  });
  assert.equal(settlementRoadNetwork(abandoned, map).routes[1].from.q, 5);

  const afterAbandon = settlement({ "6,4": district(6, 4, [1, 0, 0, 0, 0]) });
  const { routes, segments } = settlementRoadNetwork(afterAbandon, map);

  assert.deepEqual(routes.map((r) => r.districtKey), ["6,4"]);
  assert.deepEqual(routes[0].from, CENTER, "the surviving district reaches past the hole to the settlement");
  assert.deepEqual(routes[0].tiles, [CENTER, { q: 5, r: 4 }, { q: 6, r: 4 }]);
  assert.deepEqual(
    segments.map((s) => s.strands),
    [1, 1],
    "both edges now carry the survivor's own track count",
  );
});

test("every edge is laid once, even when routes overlap", () => {
  const map = grassMap();
  const { segments } = settlementRoadNetwork(
    settlement({
      "5,4": district(5, 4, [4, 4, 4, 4, 4]),
      "5,3": district(5, 3, [4, 4, 4, 4, 4]),
      "5,5": district(5, 5, [4, 4, 4, 4, 4]),
      "6,4": district(6, 4, [1, 0, 0, 0, 0]),
      "7,4": district(7, 4, [1, 0, 0, 0, 0]),
    }),
    map,
  );
  const keys = segments.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length, "no edge is drawn twice");
});

test("a district the network cannot reach on foot gets no road", () => {
  // Water is not walkable and a barracks is not a harbour: a district sitting on
  // water with no shipyard is not a legal district, so nothing links it. (The
  // harbour case below is the one over-water exception.)
  const map = grassMap(9, 9, { "5,4": "water" });
  const { routes, segments } = settlementRoadNetwork(
    settlement({ "5,4": district(5, 4, [4, 4, 4, 4, 4]) }),
    map,
  );
  assert.deepEqual(routes, [], "a water district is a harbour, not a road end");
  assert.deepEqual(segments, []);
});

// F4 (round 2 district-road card): a shipyard district on water used to get no
// road and no explanation. It is a legal district (the shipyard is the one
// building that may stand on water), so it now joins the network by a single
// pier edge to the node it was founded against -- drawn in the same two-tone
// hairline as every land road, so the harbour no longer looks disconnected from
// its own settlement.
test("F4: a shipyard water district joins the network by a pier across the water", () => {
  const map = grassMap(9, 9, { "5,4": "water" });
  const { routes, segments } = settlementRoadNetwork(settlement({ "5,4": shipyard(5, 4) }), map);

  assert.deepEqual(routes.map((r) => r.districtKey), ["5,4"], "the harbour is part of the network");
  assert.deepEqual(routes[0].tiles, [CENTER, { q: 5, r: 4 }], "one pier edge, walkable or not");
  assert.equal(routes[0].roads, 20, "a fully staffed harbour draws the full band");
  assert.deepEqual(segments, [
    { key: "4,4|5,4", from: CENTER, to: { q: 5, r: 4 }, strands: 20 },
  ]);
});

test("F4: a harbour bridges a strait -- the land district behind it gets its landing edge", () => {
  const map = grassMap(9, 9, { "5,4": "water" });
  const { routes, segments } = settlementRoadNetwork(
    settlement({ "5,4": shipyard(5, 4), "6,4": district(6, 4, [4, 4, 4, 4, 4]) }),
    map,
  );

  assert.deepEqual(routes.map((r) => r.districtKey), ["5,4", "6,4"]);
  assert.deepEqual(
    routes[1].tiles,
    [{ q: 5, r: 4 }, { q: 6, r: 4 }],
    "the land district lands off the harbour, not the castle",
  );
  assert.deepEqual(
    segments.map((s) => [s.from, s.to]),
    [
      [CENTER, { q: 5, r: 4 }],
      [{ q: 5, r: 4 }, { q: 6, r: 4 }],
    ],
  );
});

test("F4: a district walled off with no harbour adjacent still gets no road", () => {
  // A harbour only bridges water; a district no node can walk to and no
  // harbour touches keeps its silence rather than inventing a causeway.
  const map = grassMap(9, 9, { "5,4": "mountain" });
  const { routes, segments } = settlementRoadNetwork(
    settlement({ "5,4": district(5, 4, [4, 4, 4, 4, 4]) }),
    map,
  );
  assert.deepEqual(routes, []);
  assert.deepEqual(segments, []);
});

test("a road bends around impassable terrain instead of crossing it", () => {
  const map = grassMap(9, 9, {
    "5,4": "mountain",
    "5,3": "mountain",
    "6,3": "denseForest",
  });
  const { routes, segments } = settlementRoadNetwork(
    settlement({ "6,4": district(6, 4, [4, 4, 4, 4, 4]) }),
    map,
  );

  assert.equal(routes.length, 1);
  for (const tile of routes[0].tiles) {
    const terrain = map.get(tile.q, tile.r) as Terrain;
    assert.ok(map.isPassable(tile.q, tile.r), `route crosses impassable ${terrain} at ${tile.q},${tile.r}`);
  }
  assert.ok(
    !routes[0].tiles.some((t) => t.q === 5 && t.r === 4),
    "the mountain is not part of the road",
  );
  assert.equal(segments.length, routes[0].tiles.length - 1);
});

test("the same settlement and map always produce the same network", () => {
  const map = grassMap(9, 9, { "5,4": "mountain", "6,3": "denseForest" });
  const input = settlement({
    "6,4": district(6, 4, [1, 0, 0, 0, 0]),
    "5,3": district(5, 3, [2, 0, 0, 0, 0]),
    "4,5": district(4, 5, [undefined, undefined, undefined, undefined, undefined]),
  });
  assert.deepEqual(settlementRoadNetwork(input, map), settlementRoadNetwork(input, map));
});
