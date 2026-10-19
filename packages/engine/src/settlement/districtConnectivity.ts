import { HEX_DIRECTIONS, hexDistance } from "@heroes/contracts";
import type { Axial, BuildingDef, BuildingKind, CastleLevel } from "@heroes/contracts";
import { districtKey } from "../control";

// District adjacency -- "no floating districts".
//
// A district is a 5x5 city grid on a hex that belongs to a settlement. Before
// this rule, a district could be dropped on ANY hex inside the settlement's
// control range (controlRange(level): 1 / 2 / 3), so an L3 castle could own a
// district two hexes out with nothing between it and the city -- a district
// floating in the map, unreachable from the settlement it belongs to.
//
// The rule now: a non-empty district must be part of ONE connected cluster
// rooted at the settlement's own hex. A district is connected when it is
// hex-adjacent to the settlement's centre, or to another connected district of
// the same settlement. Chains work (centre - A - B), which is also what makes
// the water case expressible: a district across a strait is connected when a
// WATER district holding a shipyard sits on the water between them, because
// that water district is itself a district in the chain.
//
// The shipyard is therefore the exception the design asks for: water separates
// two districts and only a shipyard on a water district bridges them. A water
// hex with no shipyard is not a district at all (and cannot be built on), so a
// strait with no harbour in it breaks the chain exactly as it should.

/** Edge length of every district's city grid (districts are always 5x5). */
export const DISTRICT_GRID_SIZE = 5;

/** The building that turns a water hex into a (bridge) water district. */
export const SHIPYARD_KIND: BuildingKind = "shipyard";

/** Terrain a district may not be placed on at all. */
const FORBIDDEN_DISTRICT_TERRAIN = new Set(["mountain", "denseForest"]);

/**
 * True for terrain a district may never occupy (mountain, dense forest). The
 * city view's open gate and `districtTerrainProblem` share this one set, so the
 * map's double-click and the server's refusal cannot disagree.
 */
export function isForbiddenDistrictTerrain(terrain: string | undefined): boolean {
  return terrain !== undefined && FORBIDDEN_DISTRICT_TERRAIN.has(terrain);
}

export interface DistrictLike {
  q: number;
  r: number;
  buildings?: BuildingDef[];
}

export interface SettlementDistrictLike {
  id: string;
  level?: CastleLevel;
  q?: number;
  r?: number;
  tile?: Axial;
  districts?: Record<string, DistrictLike>;
}

/** The settlement's own hex, whichever of the three shapes it carries. */
export function settlementCenterOf(s: SettlementDistrictLike): Axial | undefined {
  if (s.tile) return { q: s.tile.q, r: s.tile.r };
  if (typeof s.q === "number" && typeof s.r === "number") return { q: s.q, r: s.r };
  return undefined;
}

/** The six hex neighbours of (q, r), in HEX_DIRECTIONS order. */
export function districtNeighbors(q: number, r: number): Axial[] {
  return HEX_DIRECTIONS.map((d) => ({ q: q + d.q, r: r + d.r }));
}

/** A district that still holds buildings. An empty district is not a district. */
export function districtHasBuildings(d: DistrictLike | undefined): boolean {
  return Boolean(d && d.buildings && d.buildings.length > 0);
}

/**
 * A water district: a district holding a shipyard. Only a water district may
 * sit on water, and only a water district may bridge districts across water.
 */
export function isWaterDistrict(d: DistrictLike | undefined): boolean {
  return Boolean(d?.buildings?.some((b) => b.kind === SHIPYARD_KIND));
}

/**
 * Keys of every district reachable from the settlement's centre by walking
 * district-to-district adjacency (the centre itself is the root). Districts
 * that hold no buildings are ignored -- they are deleted, not stranded.
 */
export function connectedDistrictKeys(
  settlement: SettlementDistrictLike,
  districts: Record<string, DistrictLike> | undefined = settlement.districts,
): Set<string> {
  const connected = new Set<string>();
  if (!districts) return connected;
  const center = settlementCenterOf(settlement);
  if (!center) return connected;

  // Multi-source BFS from the centre: seed the frontier with every non-empty
  // district adjacent to the centre, then walk outwards.
  const frontier: Axial[] = [center];
  const seenHexes = new Set<string>([districtKey(center.q, center.r)]);
  while (frontier.length > 0) {
    const hex = frontier.pop() as Axial;
    for (const n of districtNeighbors(hex.q, hex.r)) {
      const key = districtKey(n.q, n.r);
      if (seenHexes.has(key)) continue;
      const district = districts[key];
      if (!districtHasBuildings(district)) continue;
      seenHexes.add(key);
      connected.add(key);
      frontier.push(n);
    }
  }
  return connected;
}

/**
 * The non-empty districts that are NOT part of the settlement's connected
 * cluster, sorted by key. An empty result is the invariant the whole module
 * exists to hold: no floating districts.
 */
export function disconnectedDistrictKeys(
  settlement: SettlementDistrictLike,
  districts: Record<string, DistrictLike> | undefined = settlement.districts,
): string[] {
  const connected = connectedDistrictKeys(settlement, districts);
  const stranded: string[] = [];
  for (const [key, district] of Object.entries(districts ?? {})) {
    if (!districtHasBuildings(district)) continue;
    if (!connected.has(key)) stranded.push(key);
  }
  return stranded.sort();
}

/**
 * Why a district hex is not part of the settlement's cluster, or null when it
 * is. Used for the "can I build here?" decision on a hex that has no district
 * yet: a district must touch the settlement's centre or an existing district of
 * the same settlement.
 */
export function districtConnectionReason(
  settlement: SettlementDistrictLike,
  q: number,
  r: number,
  districts: Record<string, DistrictLike> | undefined = settlement.districts,
): string | null {
  const center = settlementCenterOf(settlement);
  if (center && hexDistance(center, { q, r }) === 1) return null;
  for (const n of districtNeighbors(q, r)) {
    if (districtHasBuildings(districts?.[districtKey(n.q, n.r)])) return null;
  }
  return "district_not_connected";
}

/**
 * Why the submitted buildings may not be placed on this terrain, or null.
 *
 * Two rules, both about water:
 *   - A mountain hex is never a district.
 *   - A water hex is a district only when it holds a shipyard (a water
 *     district / harbour). Any other water district is refused as impassable.
 *   - A shipyard may only stand on water, so a land district cannot hold one.
 *
 * The terrain argument is the map's terrain for the district hex; pass
 * undefined when the caller has no map (the check then only enforces the
 * land/shipyard pairing it can see).
 */
export function districtTerrainProblem(
  terrain: string | undefined,
  buildings: readonly BuildingDef[],
): string | null {
  if (terrain === undefined) return null;
  if (isForbiddenDistrictTerrain(terrain)) return "impassable_district_terrain";
  const hasShipyard = buildings.some((b) => b.kind === SHIPYARD_KIND);
  if (terrain === "water") return hasShipyard ? null : "impassable_district_terrain";
  return hasShipyard ? "shipyard_requires_water" : null;
}

/** True when `terrain` is water -- the only terrain a shipyard may stand on. */
export function isWaterTerrain(terrain: string | undefined): boolean {
  return terrain === "water";
}
