import type { ResourceType } from "@heroes/contracts";
import { hashString, mulberry32 } from "../rng";

export const RESOURCES: readonly ResourceType[] = ["gold", "wood", "stone", "iron", "arcane", "food"] as const;

export const RESOURCE_DENSITY: Record<string, Record<ResourceType, number>> = {
  grass: { gold: 0.06, wood: 0.02, stone: 0.02, iron: 0.005, arcane: 0, food: 0 },
  dirt: { gold: 0.05, wood: 0.01, stone: 0.06, iron: 0.03, arcane: 0.02, food: 0 },
  forest: { gold: 0.01, wood: 0.18, stone: 0.01, iron: 0, arcane: 0, food: 0 },
  desert: { gold: 0.01, wood: 0.005, stone: 0.01, iron: 0, arcane: 0.08, food: 0 },
  swamp: { gold: 0.02, wood: 0.10, stone: 0.005, iron: 0, arcane: 0.03, food: 0 },
  snow: { gold: 0.01, wood: 0.005, stone: 0.03, iron: 0.01, arcane: 0, food: 0 },
  mountain: { gold: 0, wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
  water: { gold: 0, wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
};

const MOUNTAIN_BORDER_BOOST = 0.5;
const STONE_BORDER_CAP = 0.2;
const IRON_BORDER_CAP = 0.15;

export const RESOURCE_YIELD: Record<ResourceType, number> = {
  gold: 20,
  wood: 15,
  stone: 12,
  iron: 8,
  arcane: 5,
  food: 10,
};

// How much a resource tile holds, DERIVED from that resource's own per-turn
// yield rather than from one fixed spread for every resource.
//
// The unit is TURNS of the production the tile pays the settlement that works
// it: `rate[r] = RESOURCE_YIELD[r] x level x count(tiles in radius)`
// (economy/settlementRates.ts), so one deposit worked by a level-1 settlement
// pays exactly RESOURCE_YIELD[r] of that resource every turn, and a pile of
// `RESOURCE_YIELD[r] x n` is worth n turns of it. Deriving the span from
// RESOURCE_YIELD therefore makes a pickup's worth the SAME band for every
// resource -- 1 to 50 turns -- instead of the wildly different worths a fixed
// 5-500 spread gave the six yields (up to 100 turns of arcane against 25 of
// gold at a level-1 settlement, measured over the 60-map sweep).
//
// The amounts a tile can hold are therefore per-resource: RESOURCE_YIELD[r] x 1
// (the smallest pile) up to RESOURCE_YIELD[r] x 50 (the largest). The old fixed
// floor of 5 survives as the weakest resource's one-turn pile (arcane 5), and
// the old fixed cap of 500 is no longer a ceiling at all -- gold's top pile is
// 1000. Higher levels pay more per turn, so the same pile is worth fewer turns
// there: 50 turns at L1 is 25 at L2 and 16.7 at L3.
export const RESOURCE_TURNS_MIN = 1;
export const RESOURCE_TURNS_MAX = 50;
export const RESOURCE_TURNS_SPAN = RESOURCE_TURNS_MAX - RESOURCE_TURNS_MIN + 1;

/** What one tile of `resource` can hold, in units: `yield x 1` to `yield x 50`. */
export function resourceAmountRangeFor(resource: ResourceType): { min: number; max: number } {
  return {
    min: RESOURCE_YIELD[resource] * RESOURCE_TURNS_MIN,
    max: RESOURCE_YIELD[resource] * RESOURCE_TURNS_MAX,
  };
}

/**
 * What an amount of `resource` is worth in turns of a LEVEL-1 settlement's
 * production of it. The same read the tile panel's yield line implies, so a
 * pickup's worth and the deposit's rate are one number, not two.
 */
export function resourceTurnsFor(amount: number, resource: ResourceType): number {
  return amount / RESOURCE_YIELD[resource];
}

/**
 * The amount a resource tile holds, derived from the map seed and the tile
 * itself. Three properties this has to have, and why:
 *
 * - It is a HASH of (seed, q, r, resource), never a draw on the map's RNG
 *   stream. A draw would consume a number from `mulberry32(seed)` and shift
 *   every placement that follows it, so an existing seed would generate
 *   different terrain than it does today -- the thing MapGenVersion exists to
 *   gate, and which this change does NOT do: terrain, rivers and the deposit
 *   PLACEMENTS are byte-identical (test/engine/mapGenDigestSweep.test.ts's
 *   STRUCTURAL_PIN, unmoved).
 * - It is stable for the life of the tile: the same key hashes to the same
 *   amount on every process, every reload and every client.
 * - It is computed, not carried. `amount` rides ResourceTile because the map
 *   is built from the seed on both sides, so the server and the client agree
 *   on the number with no field added to the wire.
 *
 * The derivation is the fleet's own pattern (settlers/startPlacement.ts's
 * `mulberry32(hashString(...))` stream): a stable string key mixed by FNV-1a,
 * one mulberry32 draw, scaled onto the resource's OWN span in turns, then
 * multiplied by the yield that span came from. The amount is always an exact
 * multiple of its resource's yield, so every pile is a whole number of turns.
 *
 * THE MAP VERSION MOVED WITH THIS DERIVATION (ADVENTURE P3). `amount` is not
 * gated on MapGenVersion and cannot be: the version is not an input to this
 * function, both sides derive the number from the seed alone, and
 * `GameMap.fromTiles` has no version to pass. So a map already in flight --
 * any stored version -- re-values its deposits on next load: the pristine
 * amount under every untouched tile changes, and a partially-picked tile's
 * stored remaining is clamped to the new pristine (hero/pickupResource.ts
 * `resourceRemainingOn`). `CURRENT_MAP_GEN_VERSION` is bumped to 6 to record
 * that the map content this build derives is not what the previous build
 * derived; it does not shield those saves. Terrain is untouched either way.
 */
export function resourceAmountFor(seed: number, q: number, r: number, resource: ResourceType): number {
  const roll = mulberry32(hashString(`resource-amount:${seed >>> 0}:${q}:${r}:${resource}`))();
  const turns = RESOURCE_TURNS_MIN + Math.floor(roll * RESOURCE_TURNS_SPAN);
  return RESOURCE_YIELD[resource] * turns;
}

/**
 * A tile's PRISTINE amount -- what it holds before any hero has picked from
 * it. The remaining amount is server-authoritative game state
 * (GameState.resourceDeposits, hero/pickupResource.ts), so this field is
 * never mutated: the map object is seed-derived and shared (GameMap is
 * cached per seed/size/version), and a pickup that wrote to it would leak
 * into every other game on that seed.
 */
export type ResourceTile = { q: number; r: number; resource: ResourceType; amount: number };

const AXIAL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

function isAdjacentToMountain(map: { get: (q: number, r: number) => string | undefined }, q: number, r: number): boolean {
  for (const [dq, dr] of AXIAL_DIRS) {
    if (map.get(q + dq, r + dr) === "mountain") return true;
  }
  return false;
}

export function placeResourceTiles(
  map: { height: number; width: number; get: (q: number, r: number) => string | undefined },
  rng: () => number,
  // The map's own seed. Only the AMOUNT derivation uses it -- which tile gets
  // which resource is still decided by the passed rng stream, so the
  // placements (and therefore the terrain) are exactly what they were before
  // amounts existed.
  seed = 1,
): ResourceTile[] {
  const out: ResourceTile[] = [];
  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      const terrain = map.get(q, r);
      if (!terrain || terrain === "water" || terrain === "mountain" || terrain === "denseForest") continue;
      const densities: Record<ResourceType, number> = { ...(RESOURCE_DENSITY[terrain] ?? { gold: 0, wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 }) };
      if (isAdjacentToMountain(map, q, r)) {
        densities.stone = Math.min(STONE_BORDER_CAP, densities.stone * (1 + MOUNTAIN_BORDER_BOOST));
        densities.iron = Math.min(IRON_BORDER_CAP, densities.iron * (1 + MOUNTAIN_BORDER_BOOST));
      }
      const roll = rng();
      let acc = 0;
      for (const res of RESOURCES) {
        acc += densities[res];
        if (roll < acc) {
          out.push({ q, r, resource: res, amount: resourceAmountFor(seed, q, r, res) });
          break;
        }
      }
    }
  }
  return out;
}
