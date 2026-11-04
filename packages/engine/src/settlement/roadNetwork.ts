import type { Axial } from "@heroes/contracts";
import { hexDistance } from "@heroes/contracts";
import { districtKey } from "../control";
import type { GameMap } from "../map/gameMap";
import { computePathCost, findPath } from "../map/pathfinding";
import {
  districtHasBuildings,
  isWaterDistrict,
  settlementCenterOf,
  type DistrictLike,
  type SettlementDistrictLike,
} from "./districtConnectivity";
import { staffingCeiling } from "./workforce";

// District roads -- the adventure map's district road network, as pure data.
//
// The network GROWS outward from the settlement's own tile. Districts are
// walked nearest-first, and each one joins the cheapest node already in the
// network (the centre, or a district that joined earlier). Distance order is
// the build order the map can still see: a district may only be built touching
// the centre or an existing district of the same settlement, so districts are
// inherently founded outward from the castle. Every district therefore ends up
// with a route back to the settlement, later districts re-use the trunks their
// neighbours already laid, and abandoning a district re-routes everything that
// hung off it -- the "roads through it die off when a shorter path exists"
// rule falls out of the recompute instead of needing its own pass.
//
// Road COUNT is the visualization: one track per WORKFORCE_PER_ROAD points of
// the district's own workforce, so 0 staffed is no road at all, 15 is three
// tracks and a fully staffed district is a wide band. Staffing reads off the
// map as how worn the road is.
//
// F2 (round 2 district-road card): that reading is real but sub-pixel, and the
// reason is measured, not guessed. When this was written the drawn band was
// ROAD_WIDTH_BASE 0.55px + 0.05px per track capped at ROAD_WIDTH_MAX 1.5px, so
// 1 track drew 0.60px and 20 tracks 1.50px on a 55.4px hex (HEX_SIZE 32 x
// sqrt 3) -- a 0.90px delta, 1.6% of the pitch, under one screen pixel at every
// gameplay zoom. The count is NOT a fake reading: it follows the district's
// actual staffing (15% -> 3 tracks -> 0.70px, 100% -> 20 -> 1.50px). What pinned
// the common case flat was the staffing convention upstream -- a new building in
// a never-staffed settlement was placed with `workers: undefined`
// (placeBuildings' hasExplicitStaffing ? 0 : undefined) and `undefined` is the
// legacy auto-staffed (max) crew this module reads as `max`, exactly as
// effortFraction does -- so every district of an untouched game WAS fully
// staffed. Decided (not faked): the width mapping stays the carrier rather than
// inventing variation the data does not carry.
//
// RESOLVED 2026-11-03 (the road study, stage B+C): the mapping itself was the
// other half of the problem and it moved. Two independent studies measured the
// same conclusion -- at 0.60-1.50px the band is a scratch on real terrain, so
// neither a busy trunk nor a light lane could be SEEN, whatever the junction
// geometry did. The renderer now draws ROAD_WIDTH_BASE 1.5px + 0.05px per track
// capped at ROAD_WIDTH_MAX 2.5px with a 1.0px casing each side, i.e. a 1.55px
// body under a 3.55px band at 1 track and 2.50/4.50 at the 20-track cap: the
// same per-track delta on a base the eye can see. The measurement, and the
// stream widths it was checked against (14.0px small / 18.0px wide at the
// alpha-64 contour), are in `.agentboard/road-reports/synthesis/index.html`;
// the constants are in src/render/scene/roadGraph.ts. Nothing in THIS file
// changed for it -- the track count is still the one carrier.
//
// RESOLVED 2026-11-03 (the workforce rebalance): the auto crew is now a
// BOOTSTRAP only -- a new placement into a settlement that has any district (or
// any explicit count) starts at `workers: 0`, and WORKFORCE_PER_POPULATION
// moved 100 -> 300 so the pool binds in a built-out city -- so the band is a
// live reading for any district the player grows and reads flat 100% only on a
// seeded district of a game nobody has staffed (the auto crew doing its job on
// the town the game handed the player). See docs/settlements.md "Map
// visualisation" for the measurement and the resolution.
//
// Roads follow real terrain (A* over the same passability the game uses), so a
// route bends off mountains, dense forest and water. A WATER district -- a
// harbour holding a shipyard -- is not walkable, so A* cannot reach it; it
// still joins the network by a single pier/bridge edge to the adjacent node it
// was founded against, because the shipyard is the one building that turns
// water into a district and the design bridges a strait through it. A district
// whose only way out is such a harbour gets the same landing edge, so a
// settlement across a strait stays connected. Nothing shorter than that is
// drawn: a district no node is adjacent to still gets no road.
//
// The network is DERIVED data: it is recomputed from the settlement's live
// districts and nothing of it is persisted. It now prices as well as draws --
// entering a roaded hex costs `ROAD_MOVEMENT_MULTIPLIER` (0.75) of that hex's
// terrain cost, applied as a modifier on the engine's one movement-cost table
// (`GameMap.cost`, see packages/engine/src/map/gameMap.ts), so pathfinding, the
// route price, the reachability split and the AI all read the same number with
// no second cost path. `syncSettlementRoads` below installs the tiles;
// impassable hexes stay impassable because the modifier multiplies, so a pier
// over water is still drawn and still unwalked. Terrain generation and
// MapGenVersion are untouched by this -- the roads are layered onto an
// already-generated map, and a map nobody has laid roads on costs exactly what
// it always did.

/** Workforce points per road track: 0 -> 0, 15 -> 3, 100 -> 20. */
export const WORKFORCE_PER_ROAD = 5;

/** Hard ceiling on a single route's track count; also the full-workforce count. */
export const MAX_ROADS_PER_ROUTE = 20;

/** The district's staffing share on a 0..100 scale, from its own job slots.
 *
 * The slots are `staffingCeiling` (2026-11-03), not `buildingMaxWorkers`: a
 * district building under construction carries up to 4 builders, so a district
 * full of sites reads a WIDER road than its finished caps would give it. The
 * road is a workforce display, not a production one, and the builders really are
 * there. */
export function districtWorkforcePercent(district: DistrictLike | undefined): number {
  let assigned = 0;
  let capacity = 0;
  for (const b of district?.buildings ?? []) {
    const max = staffingCeiling(b);
    capacity += max;
    // An absent count is the pre-workforce "auto (max)" crew (effortFraction
    // reads it the same way), so it counts as fully staffed.
    const workers = b.workers === undefined ? max : Math.min(Math.max(b.workers, 0), max);
    assigned += workers;
  }
  if (capacity <= 0) return 0;
  return (assigned / capacity) * 100;
}

/** Tracks drawn for a workforce figure, rounded to the nearest whole road. */
export function roadsForWorkforce(workforce: number): number {
  if (!Number.isFinite(workforce) || workforce <= 0) return 0;
  return Math.min(MAX_ROADS_PER_ROUTE, Math.round(workforce / WORKFORCE_PER_ROAD));
}

export interface RoadRoute {
  /** The district this route serves ("q,r"). */
  districtKey: string;
  /** The network node the route leaves from: the settlement centre, or another district. */
  from: Axial;
  /** The tiles walked after `from`, ending on the district (findPath's shape). */
  path: Axial[];
  /** `from` plus `path`: the full tile chain, which is what gets drawn. */
  tiles: Axial[];
  /** Tracks to draw along the whole route. */
  roads: number;
  /** The district's staffing share, 0..100. */
  workforce: number;
}

export interface RoadSegment {
  /** Direction-independent edge key over the two adjacent tiles. */
  key: string;
  /** The tile nearer the settlement; the segment is drawn outward from here. */
  from: Axial;
  /** The tile further out. */
  to: Axial;
  /** Tracks on this edge: the busiest route using it, so trunks run wide. */
  strands: number;
}

export interface RoadNetwork {
  /** The settlement's own tile, where every route ultimately leads. */
  center: Axial;
  /** One entry per district that has a route, in network-growth order. */
  routes: RoadRoute[];
  /** Every drawn edge, deduplicated, in first-laid order. */
  segments: RoadSegment[];
}

function edgeKey(a: Axial, b: Axial): string {
  const aFirst = a.q < b.q || (a.q === b.q && a.r <= b.r);
  const first = aFirst ? a : b;
  const second = aFirst ? b : a;
  return `${first.q},${first.r}|${second.q},${second.r}`;
}

/**
 * The road network of one settlement over `map`.
 *
 * Empty (no routes, no segments) when the settlement has no centre or no
 * district holds a building -- a district that holds nothing is not a district,
 * so it neither draws a road nor anchors one.
 */
export function settlementRoadNetwork(
  settlement: SettlementDistrictLike,
  map: GameMap,
): RoadNetwork {
  const center = settlementCenterOf(settlement);
  if (!center) return { center: { q: 0, r: 0 }, routes: [], segments: [] };

  const entries = Object.entries(settlement.districts ?? {})
    .filter(([, d]) => districtHasBuildings(d))
    .map(([key, d]) => ({ key, q: d.q, r: d.r, workforce: districtWorkforcePercent(d), district: d }))
    .sort(
      (a, b) =>
        hexDistance(center, a) - hexDistance(center, b) || a.q - b.q || a.r - b.r,
    );

  const nodes: Axial[] = [{ q: center.q, r: center.r }];
  const routes: RoadRoute[] = [];

  for (const entry of entries) {
    const goal: Axial = { q: entry.q, r: entry.r };
    let best: { from: Axial; path: Axial[]; cost: number } | null = null;
    for (const node of nodes) {
      const path = findPath(map, node, goal);
      // findPath returns [] for an impassable goal (water) or one walled off by
      // mountains. Such a district gets no A* route; a harbour may still join by
      // a pier below.
      if (path.length === 0) continue;
      const cost = computePathCost(map, path);
      const better =
        best === null ||
        path.length < best.path.length ||
        (path.length === best.path.length && cost < best.cost);
      if (better) best = { from: { q: node.q, r: node.r }, path, cost };
    }
    if (!best) {
      // The over-water exceptions: a water district (a harbour holding a
      // shipyard) cannot be walked to, and a district whose nearest network
      // node is a harbour has the water between them. Both join the network by
      // a single pier/bridge edge to a node they are adjacent to -- the
      // shipyard is the one building that turns water into a district, and the
      // design bridges a strait through it. A district with no adjacent node at
      // all (or with no harbour on either side of the water) still gets no road.
      const adjacent = nodes
        .map((node) => ({ node, dist: hexDistance(node, goal) }))
        .filter((candidate) => candidate.dist === 1)
        .sort((a, b) => a.node.q - b.node.q || a.node.r - b.node.r);
      const bridge = adjacent.find(
        ({ node }) =>
          isWaterDistrict(entry.district) ||
          isWaterDistrict(settlement.districts?.[districtKey(node.q, node.r)]),
      );
      if (bridge) best = { from: { q: bridge.node.q, r: bridge.node.r }, path: [goal], cost: 0 };
    }
    // The district joins the network even when nothing can reach it, so a
    // farther district in its direction is not silently orphaned.
    nodes.push(goal);
    if (!best) continue;
    routes.push({
      districtKey: entry.key,
      from: best.from,
      path: best.path,
      tiles: [best.from, ...best.path],
      roads: roadsForWorkforce(entry.workforce),
      workforce: entry.workforce,
    });
  }

  const byKey = new Map<string, RoadSegment>();
  const segments: RoadSegment[] = [];
  for (const route of routes) {
    if (route.roads <= 0) continue;
    for (let i = 1; i < route.tiles.length; i++) {
      const from = route.tiles[i - 1];
      const to = route.tiles[i];
      const key = edgeKey(from, to);
      const existing = byKey.get(key);
      if (existing) {
        if (route.roads > existing.strands) existing.strands = route.roads;
        continue;
      }
      const segment: RoadSegment = { key, from, to, strands: route.roads };
      byKey.set(key, segment);
      segments.push(segment);
    }
  }

  return { center, routes, segments };
}

/**
 * Every tile a network crosses -- the union of its routes' tile chains -- as
 * the `"q,r"` keys `GameMap.setRoadTiles` takes. A route's `tiles` is
 * `[from, ...path]`, so a hex two routes share is listed once by the Set.
 *
 * The pier/bridge edge of a harbour route is included: it is a drawn road, and
 * the discount cannot make it walkable because a water hex prices at `Infinity`
 * before the road modifier is ever applied.
 */
export function roadNetworkTiles(network: RoadNetwork): Set<string> {
  const tiles = new Set<string>();
  for (const route of network.routes) {
    for (const tile of route.tiles) tiles.add(`${tile.q},${tile.r}`);
  }
  return tiles;
}

/**
 * The district-road tiles of every settlement given, over `map`. This is the
 * one derivation of "which hexes a road makes cheaper to enter" -- the map's
 * own modifier read it in `GameMap.setRoadTiles`.
 */
export function settlementRoadTiles(
  settlements: Iterable<SettlementDistrictLike>,
  map: GameMap,
): Set<string> {
  const tiles = new Set<string>();
  for (const settlement of settlements) {
    for (const key of roadNetworkTiles(settlementRoadNetwork(settlement, map))) {
      tiles.add(key);
    }
  }
  return tiles;
}

/**
 * Installs the settlement district roads onto `map` and returns the number of
 * roaded tiles. Wholesale replace, never a merge: a road that stopped being
 * laid stops being discounted, and an empty settlement list clears the layer
 * back to raw terrain costs.
 *
 * Call this wherever a game's settlements and its map meet before movement is
 * priced -- the client's GameStateManager and the server's per-command/charter
 * map (server/app/commandHandler.ts, server/app/aiDriver.ts). It is idempotent,
 * so a frame or a command that re-installs an unchanged network costs only the
 * comparison, and a settlement with no districts returns 0 without any A*.
 */
export function syncSettlementRoads(
  map: GameMap,
  settlements: Iterable<SettlementDistrictLike>,
): number {
  return map.setRoadTiles(settlementRoadTiles(settlements, map));
}
