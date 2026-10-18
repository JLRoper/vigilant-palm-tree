import type {
  BuildingDef,
  BuildingKind,
  CastleLevel,
  DistrictState,
  ResourceType,
} from "@heroes/contracts";
import { hexDistance } from "@heroes/contracts";
import { buildingFootprintFromRegistry } from "../buildingRegistry";
import { districtKey } from "../control";
import { isPassable, type Terrain } from "../map/terrain";
import { hashString, mulberry32 } from "../rng";
import { pickStyleForBuilding } from "../styleResolver";
import { generateDistrictSpots, type CitySpot } from "./citySpots";
import { districtNeighbors } from "./districtConnectivity";

// Districts a settlement is BORN with.
//
// A district is a 5x5 satellite grid on an adjacent hex; until now every one of
// them was player-built (double-click a hex in the settlement's territory, then
// commit a cart). A settlement that starts life at tier 2 or 3 is supposed to
// already look like a grown town, so game creation seeds them:
//
//   tier 1 (settlement) -> no districts
//   tier 2 (town)       -> 1 district
//   tier 3 (castle)     -> 2 districts
//
// Each seeded district gets "a couple of buildings" -- two or three, drawn from
// a pool of district-scale kinds (never a town hall: the registry and the
// reducer both forbid one outside the main city). They are free and already
// built, exactly like the starter layout the main city is handed by
// seedStarterBuildings: they are the town the game started with, not work the
// player paid for.
//
// Every seeded district is connected to the settlement by construction: the
// first one is always a neighbour of the settlement's own hex, and later ones
// must touch the settlement or an already-chosen district. That is the same
// "no floating districts" invariant districtConnectivity.ts enforces on every
// later commit, so a seeded settlement can never start outside it.
//
// Determinism: this runs in a pass of its own with its own RNG stream, seeded
// from the castle seed + settlement id + hex. It draws NOTHING from the
// settlement-generation stream (makeSettlements' rng), so adding districts does
// not shift the horse variants, names or city spots every existing seeded map
// already pins.

/** Districts a settlement of this tier starts with. */
export function startupDistrictCount(level: CastleLevel): number {
  if (level === 1) return 0;
  return level === 2 ? 1 : 2;
}

/** Buildings a seeded district holds: "a couple", i.e. two or three. */
export const STARTUP_DISTRICT_MIN_BUILDINGS = 2;
export const STARTUP_DISTRICT_MAX_BUILDINGS = 3;

/**
 * The kinds a seeded district can be built from. District-scale and
 * self-contained: no town hall (forbidden outside the main city), and nothing
 * whose value depends on a resource spot the district may not have. All are
 * level-1 placements, already constructed.
 */
export const DISTRICT_BUILDING_POOL: readonly BuildingKind[] = [
  "house",
  "woodcutterHut",
  "stoneMine",
  "farmField",
  "farmhouse",
  "market",
  "granary",
  "smithy",
];

/** The minimum map surface district seeding needs (GameMap satisfies it). */
export interface DistrictSeedMap {
  readonly width: number;
  readonly height: number;
  get(q: number, r: number): Terrain | undefined;
  resourceTileAt(q: number, r: number): { resource: ResourceType } | undefined;
}

export interface DistrictSeedSettlement {
  id: string;
  q: number;
  r: number;
  level: CastleLevel;
}

export interface DistrictSeedOptions {
  /** Every settlement hex on the map -- a district never lands on one. */
  occupiedCenters?: ReadonlySet<string>;
  /** Seed the districts' spot sets and their building picks from. */
  castleSeed: number;
  /** Per-settlement district count override (tests / future tiers). */
  count?: number;
  /** Per-settlement building-count override. */
  buildingsPerDistrict?: number;
}

/**
 * The districts a settlement starts with, or undefined when it gets none
 * (tier 1, or no legal hex beside it).
 */
export function seedStartupDistricts(
  map: DistrictSeedMap,
  settlement: DistrictSeedSettlement,
  opts: DistrictSeedOptions,
): Record<string, DistrictState> | undefined {
  const count = opts.count ?? startupDistrictCount(settlement.level);
  if (count <= 0) return undefined;

  const rng = mulberry32(hashString(`startup-districts:${opts.castleSeed}:${settlement.id}`));
  const hexes = pickDistrictHexes(map, settlement, count, rng, opts.occupiedCenters);
  if (hexes.length === 0) return undefined;

  const districts: Record<string, DistrictState> = {};
  for (const hex of hexes) {
    const terrain = map.get(hex.q, hex.r) ?? "grass";
    const mapRes = map.resourceTileAt(hex.q, hex.r)?.resource ?? null;
    const spots: CitySpot[] = generateDistrictSpots(hex.q, hex.r, opts.castleSeed, terrain, mapRes);
    const buildings = buildDistrictBuildings(
      mapRes,
      hashString(`district-buildings:${opts.castleSeed}:${hex.q}:${hex.r}`),
      opts.buildingsPerDistrict,
    );
    districts[districtKey(hex.q, hex.r)] = { q: hex.q, r: hex.r, citySpots: spots, buildings };
  }
  return districts;
}

/**
 * The hexes the settlement's districts stand on: neighbours of the settlement
 * first, then their neighbours, always passable land, never another
 * settlement's hex, and always touching the settlement or a hex already picked.
 */
function pickDistrictHexes(
  map: DistrictSeedMap,
  settlement: DistrictSeedSettlement,
  count: number,
  rng: () => number,
  occupiedCenters: ReadonlySet<string> | undefined,
): Array<{ q: number; r: number }> {
  const center = { q: settlement.q, r: settlement.r };
  const chosen: Array<{ q: number; r: number }> = [];
  const seen = new Set<string>([districtKey(center.q, center.r)]);
  let ring: Array<{ q: number; r: number }> = [center];

  // Rings out to the settlement's own control range (level), so a seeded
  // district can never sit outside the territory the player can build in.
  for (let dist = 1; dist <= settlement.level && chosen.length < count; dist++) {
    const candidates: Array<{ q: number; r: number }> = [];
    for (const hex of ring) {
      for (const n of districtNeighbors(hex.q, hex.r)) {
        const key = districtKey(n.q, n.r);
        if (seen.has(key)) continue;
        seen.add(key);
        if (n.q < 0 || n.r < 0 || n.q >= map.width || n.r >= map.height) continue;
        if (occupiedCenters?.has(key)) continue;
        const terrain = map.get(n.q, n.r);
        if (!terrain || !isPassable(terrain)) continue;
        candidates.push(n);
      }
    }
    ring = candidates;
    shuffle(candidates, rng);
    for (const candidate of candidates) {
      if (chosen.length >= count) break;
      if (!touchesSettlementOrChosen(center, chosen, candidate)) continue;
      chosen.push(candidate);
    }
  }
  return chosen;
}

function touchesSettlementOrChosen(
  center: { q: number; r: number },
  chosen: ReadonlyArray<{ q: number; r: number }>,
  candidate: { q: number; r: number },
): boolean {
  if (hexDistance(center, candidate) === 1) return true;
  return chosen.some((c) => hexDistance(c, candidate) === 1);
}

/**
 * The buildings of one seeded district: two or three pool kinds, placed on
 * legal, non-overlapping cells of the 5x5 grid. Deterministic for a given
 * `seed`, and never a town hall.
 */
export function buildDistrictBuildings(
  mapResource: ResourceType | null,
  seed: number,
  count?: number,
): BuildingDef[] {
  const rng = mulberry32(seed);
  const wanted = Math.max(
    STARTUP_DISTRICT_MIN_BUILDINGS,
    Math.min(STARTUP_DISTRICT_MAX_BUILDINGS, Math.floor(count ?? pickBuildingCount(rng))),
  );

  const buildings: BuildingDef[] = [];
  const used = new Set<BuildingKind>();
  for (let i = 0; i < wanted; i++) {
    const kind = pickDistrictKind(rng, mapResource, used);
    const placed = placeInDistrictGrid(buildings, kind);
    if (!placed) continue;
    used.add(kind);
    buildings.push(placed);
  }
  return buildings;
}

function pickBuildingCount(rng: () => number): number {
  const span = STARTUP_DISTRICT_MAX_BUILDINGS - STARTUP_DISTRICT_MIN_BUILDINGS + 1;
  return STARTUP_DISTRICT_MIN_BUILDINGS + Math.floor(rng() * span);
}

/**
 * A district prefers buildings that pay off on the hex it stands on: a resource
 * deposit becomes the producer for that resource (or a farm field when the
 * deposit is food, which is the ~3x spot multiplier the city view advertises),
 * otherwise anything in the pool. Kinds already standing in this district are
 * skipped where the pool allows, so a seeded district reads as a little town
 * (a granary AND a granary is not one) instead of a repeated roll.
 */
function pickDistrictKind(
  rng: () => number,
  mapResource: ResourceType | null,
  used: ReadonlySet<BuildingKind>,
): BuildingKind {
  const producerForResource: Partial<Record<ResourceType, BuildingKind>> = {
    wood: "woodcutterHut",
    stone: "stoneMine",
    food: "farmField",
  };
  const match = mapResource ? producerForResource[mapResource] : undefined;
  if (match && !used.has(match)) return match;
  const available = DISTRICT_BUILDING_POOL.filter((k) => !used.has(k));
  const pool = available.length > 0 ? available : DISTRICT_BUILDING_POOL;
  return pool[Math.floor(rng() * pool.length)];
}

/** Place `kind` on the first free cell of a 5x5 district grid, or null when it does not fit. */
function placeInDistrictGrid(buildings: readonly BuildingDef[], kind: BuildingKind): BuildingDef | null {
  const fp = buildingFootprintFromRegistry(kind, 1);
  const w = Math.max(1, Math.floor(fp.w));
  const h = Math.max(1, Math.floor(fp.h));
  for (let y = 0; y + h <= 5; y++) {
    for (let x = 0; x + w <= 5; x++) {
      if (buildings.some((b) => coversCell(b, x, y, w, h))) continue;
      return { gx: x, gy: y, kind, level: 1, style: pickStyleForBuilding(kind, 1, "pixel") };
    }
  }
  return null;
}

function coversCell(b: BuildingDef, gx: number, gy: number, w: number, h: number): boolean {
  const fp = buildingFootprintFromRegistry(b.kind, b.level);
  const bw = b.w ?? fp.w;
  const bh = b.h ?? fp.h;
  return gx < b.gx + bw && gx + w > b.gx && gy < b.gy + bh && gy + h > b.gy;
}

/** In-place Fisher-Yates on a copy of the rng stream -- deterministic per seed. */
function shuffle<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
}
