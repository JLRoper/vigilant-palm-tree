import { test } from "node:test";
import assert from "node:assert/strict";
import type { Axial, BuildingDef, DistrictState, GamePhase } from "@heroes/contracts";
import {
  CURRENT_MAP_GEN_VERSION,
  GameMap,
  ROAD_MOVEMENT_MULTIPLIER,
  TERRAIN_COST,
  buildingMaxWorkers,
  computePathCost,
  emptyGameState,
  findPath,
  hexDistance,
  settlementRoadNetwork,
  settlementRoadTiles,
  startMove,
  syncSettlementRoads,
  type SettlementDistrictLike,
  type Terrain,
  type TileRow,
} from "@heroes/engine";
import { makeHero } from "../charter/_helpers";

// District roads, MECHANICAL half (docs/settlements.md "District roads").
//
// The layout itself is pinned in test/engine/roadNetwork.test.ts. This file
// pins what the layout PRICES: entering a roaded hex costs
// ROAD_MOVEMENT_MULTIPLIER of its terrain cost, applied as a modifier on the
// engine's one movement-cost table (GameMap.cost) and therefore inherited by
// findPath's A*, computePathCost, the reachable split and the AI -- never by a
// second cost path of its own.
//
// Every assertion below is written so that REMOVING the modifier (deleting the
// `roadTiles` branch in GameMap.cost, or the sync that installs it) breaks it.

const CENTER = { q: 2, r: 2 };
/** Two districts east of the centre, so the route to the far one is four hexes. */
const NEAR = { q: 4, r: 2 };
const FAR = { q: 6, r: 2 };

function grassMap(
  width = 11,
  height = 7,
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

/** One barracks per crew entry; `undefined` is the legacy auto-staffed (max) crew. */
function district(q: number, r: number, crews: Array<number | undefined> = [undefined]): DistrictState {
  const buildings: BuildingDef[] = crews.map((workers, gx) => ({
    gx,
    gy: 0,
    kind: "barracks",
    level: 1,
    ...(workers === undefined ? {} : { workers }),
  }));
  return { q, r, citySpots: [], buildings };
}

function shipyard(q: number, r: number): DistrictState {
  return { q, r, citySpots: [], buildings: [{ gx: 1, gy: 0, kind: "shipyard", level: 1 }] };
}

function settlement(districts: Record<string, DistrictState>): SettlementDistrictLike {
  return { id: "s1", level: 2, tile: CENTER, districts };
}

/** The fixture: centre plus two staffed districts east of it. */
function roadedSettlement(): SettlementDistrictLike {
  return settlement({ "4,2": district(NEAR.q, NEAR.r), "6,2": district(FAR.q, FAR.r) });
}

/** The four-hex walk from the centre to the far district. */
function routeToFar(map: GameMap): Axial[] {
  const step = findPath(map, CENTER, FAR);
  return [{ q: CENTER.q, r: CENTER.r }, ...step];
}

test("a roaded hex costs ROAD_MOVEMENT_MULTIPLIER of its terrain cost", () => {
  const map = grassMap();
  assert.equal(ROAD_MOVEMENT_MULTIPLIER, 0.75);
  // Unworn ground: exactly the terrain table's price, nothing else.
  assert.equal(map.cost(NEAR.q, NEAR.r), TERRAIN_COST.grass, "a map with no roads is priced as before");
  assert.equal(map.cost(NEAR.q, NEAR.r), 1);

  syncSettlementRoads(map, [roadedSettlement()]);

  // Roaded ground: three quarters of the same terrain cost. Delete the
  // modifier and this becomes 1 -- the assertion fails.
  assert.equal(map.cost(NEAR.q, NEAR.r), TERRAIN_COST.grass * ROAD_MOVEMENT_MULTIPLIER);
  assert.equal(map.cost(NEAR.q, NEAR.r), 0.75);
  assert.ok(
    map.cost(NEAR.q, NEAR.r) < TERRAIN_COST.grass,
    "a roaded hex must be cheaper to enter than the same hex unworn",
  );
  // Every roaded tile is discounted, and a hex off the road is not.
  for (const key of settlementRoadTiles([roadedSettlement()], map)) {
    const [q, r] = key.split(",").map(Number);
    assert.equal(map.cost(q, r), TERRAIN_COST.grass * ROAD_MOVEMENT_MULTIPLIER, `roaded ${key}`);
  }
  assert.equal(map.cost(0, 6), TERRAIN_COST.grass, "a hex off every road keeps its terrain price");
});

test("the discount rides the ONE cost table: findPath and computePathCost agree with it", () => {
  const map = grassMap();
  const unroaded = routeToFar(map);
  const unroadedCost = computePathCost(map, unroaded);
  assert.equal(unroadedCost, 4 * TERRAIN_COST.grass, "four plain grass hexes");

  syncSettlementRoads(map, [roadedSettlement()]);

  // A* ran over the discounted table, so the route it returns is priced by it.
  const roaded = routeToFar(map);
  assert.deepEqual(roaded, unroaded, "on open grass the road route is the same hex chain");
  const roadedTiles = settlementRoadTiles([roadedSettlement()], map);
  assert.ok(
    roaded.every((t) => roadedTiles.has(`${t.q},${t.r}`)),
    "every hex the route walks is a hex the network laid a road across",
  );

  const roadedCost = computePathCost(map, roaded);
  assert.equal(roadedCost, 3, "four roaded hexes at 0.75 each");
  assert.ok(roadedCost < unroadedCost, `roaded ${roadedCost} must be under unroaded ${unroadedCost}`);
  assert.equal(unroadedCost - roadedCost, 1, "one movement point saved over the four-hex route");
});

test("the roads' own routes price below the same hexes unworn", () => {
  const map = grassMap();
  const network = settlementRoadNetwork(roadedSettlement(), map);
  assert.ok(network.routes.length >= 2, "the fixture lays at least two routes");

  const unworn = network.routes.map((route) => computePathCost(map, route.tiles));
  syncSettlementRoads(map, [roadedSettlement()]);
  const worn = network.routes.map((route) => computePathCost(map, route.tiles));

  unworn.forEach((cost, i) => {
    assert.ok(worn[i] < cost, `route ${i}: roaded ${worn[i]} must be under unroaded ${cost}`);
  });
});

test("a real hero pays the roaded price: startMove deducts less over the same route", () => {
  const map = grassMap();
  const route = routeToFar(map);
  const unwornCost = computePathCost(map, route);
  syncSettlementRoads(map, [roadedSettlement()]);
  const wornCost = computePathCost(map, route);

  const move = (cost: number) => {
    const base = emptyGameState();
    const state = {
      ...base,
      activePlayerId: 0,
      selectedHeroId: "h0",
      phase: { kind: "PLAYER_TURN", playerId: 0 } as GamePhase,
      heroes: { h0: makeHero("h0", 0, CENTER.q, CENTER.r, { movementRemaining: 7 }) },
    };
    assert.equal(state.heroes.h0.movementRemaining, 7);
    const result = startMove(state, "h0", { q: FAR.q, r: FAR.r }, cost, route.slice(1));
    assert.equal(result.ok, true);
    return result.ok ? result.state.heroes.h0 : null;
  };

  const unwornMove = move(unwornCost);
  const wornMove = move(wornCost);
  assert.ok(unwornMove && wornMove);
  assert.equal(unwornMove.q, FAR.q);
  assert.equal(unwornMove.r, FAR.r);
  assert.equal(unwornMove.movementRemaining, 3, "7 - 4 unworn hexes");
  assert.equal(wornMove.movementRemaining, 4, "7 - 3 worn: the same walk costs one point less");
  assert.ok(
    wornMove.movementRemaining > unwornMove.movementRemaining,
    `roaded move must leave more movement than the unroaded one (${wornMove.movementRemaining} vs ${unwornMove.movementRemaining})`,
  );
  assert.deepEqual(wornMove.trail, route, "the trail is the same route either way");
});

test("the road layering cannot walk on water: an impassable hex stays impassable", () => {
  // A harbour: a shipyard on water ADJACENT to the centre, so the network's
  // pier/bridge rule gives it a route and the water hex IS flagged as roaded.
  const map = grassMap(11, 7, { "3,2": "water" });
  const harbour = settlement({ "3,2": shipyard(3, 2) });
  const network = settlementRoadNetwork(harbour, map);
  assert.equal(network.routes.length, 1);
  assert.deepEqual(network.routes[0].tiles, [CENTER, { q: 3, r: 2 }], "the pier edge is centre -> water");
  assert.ok(settlementRoadTiles([harbour], map).has("3,2"), "the pier tile is flagged as a road");

  syncSettlementRoads(map, [harbour]);
  assert.equal(map.cost(3, 2), Infinity, "a road over water is drawn, not walked");
  assert.equal(map.cost(4, 2), TERRAIN_COST.grass, "the harness itself is unworn without a district on it");
  assert.equal(map.isPassable(3, 2), false, "passability is the terrain table's, unchanged");
});

test("the layering is wholesale and idempotent, and clearing it restores raw costs", () => {
  const map = grassMap();
  const installed = syncSettlementRoads(map, [roadedSettlement()]);
  assert.ok(installed > 0);
  assert.equal(map.cost(FAR.q, FAR.r), 0.75);

  const again = syncSettlementRoads(map, [roadedSettlement()]);
  assert.equal(again, installed, "installing the same network twice is a no-op");
  assert.equal(map.cost(FAR.q, FAR.r), 0.75);

  // Abandoning every district re-lays nothing: the discount goes with the road.
  assert.equal(syncSettlementRoads(map, [settlement({})]), 0);
  assert.equal(map.cost(FAR.q, FAR.r), TERRAIN_COST.grass, "no road, no discount");
  assert.equal(map.setRoadTiles(null), 0);
  assert.equal(map.cost(FAR.q, FAR.r), TERRAIN_COST.grass);
});

test("roads are derived data: installing them cannot move the generated world", () => {
  // The version moved to 6 with ADVENTURE P3's yield-derived pickup span, NOT
  // for this change: a road layering is installed onto an already-generated map
  // and touches no generation pass, river pass or deposit placement. The hash
  // below covers terrain, rivers and deposits (placement AND amount) of the
  // 60-map grid; the AMOUNT half of it moved with that span, the
  // terrain/river/placement half did not -- `mapGenDigestSweep.test.ts` pins
  // those two halves separately, and its structural pin is still the value
  // captured before this card.
  assert.equal(CURRENT_MAP_GEN_VERSION, 6, "roads do not move MapGenVersion; the pickup span does");
  // FNV-1a over the generated tiles, placed rivers and placed resources of
  // 60 maps (2 sizes x 5 versions x seeds 1..6). Captured on this change's
  // parent commit (github/main a8ac9bf) with the same script and identical --
  // installing a road layering onto an already-generated map cannot move it.
  // Re-pinned once, for the amount half only (2e36f1b3 -> 74ce29c5).
  const fnv1a = (s: string): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  const parts: string[] = [];
  for (const size of ["small", "large"] as const) {
    for (const version of [1, 2, 3, 4, 5] as const) {
      for (let seed = 1; seed <= 6; seed++) {
        const m = new GameMap(seed, size, version);
        const rivers = m.placedRivers.map((t) => `${t.q},${t.r},${t.kind},${t.bridge ? 1 : 0}`).join(";");
        const res = m.placedResourceTiles.map((t) => `${t.q},${t.r},${t.resource},${t.amount}`).join(";");
        parts.push(`${size}:v${version}:s${seed}:${fnv1a(m.tiles.join(","))}:${fnv1a(rivers)}:${fnv1a(res)}`);
      }
    }
  }
  assert.equal(parts.length, 60);
  assert.equal(fnv1a(parts.join("|")), "74ce29c5", "generated terrain/rivers/resources moved");
  // And a fresh map carries no road layering of its own.
  assert.equal(new GameMap(42, "small", 6).roadTiles, null);
});

test("the fixture's road really is a road: the network tiles are what got priced", () => {
  const map = grassMap();
  const tiles = settlementRoadTiles([roadedSettlement()], map);
  assert.deepEqual([...tiles].sort(), ["2,2", "3,2", "4,2", "5,2", "6,2"]);
  const network = settlementRoadNetwork(roadedSettlement(), map);
  assert.equal(network.routes.length, 2);
  assert.equal(hexDistance(CENTER, NEAR), 2);
  assert.ok(buildingMaxWorkers("barracks") > 0);
});
