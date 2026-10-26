import type { GameState, HeroId, HeroState, ResourceType, Warehouse, WarehouseResource } from "@heroes/contracts";
import type { GameMap } from "../map/gameMap";
import { hexDistance } from "../map/pathfinding";
import { heroCargo, heroGoldCap, heroResourceCap, warehouseHeadroom } from "../settlement/capacity";

// Heroes pick the resources on the adventure map up.
//
// A resource tile's amount is a hash of the seed and the tile
// (map/resourceTiles.ts's resourceAmountFor), so the map object is
// seed-derived, shared and CACHED -- never mutated. What a pickup consumes is
// recorded per tile here, in the game state: `GameState.resourceDeposits` holds
// the amount still on the floor for every tile a hero has picked from, absent
// for a tile nobody has touched (whose remaining amount is the pristine one).
// That makes the remaining amount server-authoritative, evented and
// reload-safe without the map ever knowing a pickup happened.

/**
 * How far from the tile a hero may stand and still pick it up. ZERO: the hero
 * has to be ON the tile. One named constant so widening the verb to an
 * adjacent hex (or a radius) is a one-line change and every check -- the
 * server's, the client's preview, the panel's -- moves together.
 */
export const RESOURCE_PICKUP_RANGE = 0;

export type ResourcePickupRefusal =
  | "no_hero"
  | "no_resource_tile"
  | "not_on_resource_tile"
  | "deposit_depleted"
  // The existing over-cap vocabulary (hero/tradeHeroes.ts): a hero with no
  // room for what is on the floor is refused in the same words a
  // too-large field trade is, so the player reads one sentence for one
  // situation. Gold rides the purse and gets that slot's wording.
  | "not_enough_cargo_space"
  | "not_enough_gold_space";

export interface ResourcePickupRequest {
  heroId: HeroId;
  q: number;
  r: number;
}

/** The per-tile key `GameState.resourceDeposits` is indexed by. */
export function resourceDepositKey(q: number, r: number): string {
  return `${q},${r}`;
}

/**
 * The amount still on a tile: the stored remaining amount when a hero has
 * picked here, the tile's pristine amount otherwise. Clamped to the pristine
 * amount, so a corrupt or hand-edited row can never report more than the tile
 * ever held.
 */
export function resourceRemainingOn(state: GameState, q: number, r: number, pristine: number): number {
  const stored = state.resourceDeposits?.[resourceDepositKey(q, r)];
  if (stored === undefined) return pristine;
  if (!Number.isFinite(stored)) return pristine;
  return Math.max(0, Math.min(pristine, stored));
}

/**
 * The hero's remaining room for one resource: its cargo wagons' cap for a
 * warehouse resource, its treasury carts' purse cap for gold. A wagon-less
 * hero is a real 0 (capacity.ts's own note), which is what makes "left on the
 * floor" the natural outcome rather than a special case.
 */
export function heroRoomFor(hero: HeroState, resource: ResourceType): number {
  if (resource === "gold") return warehouseHeadroom(hero.gold ?? 0, heroGoldCap(hero));
  const cargo: Warehouse = heroCargo(hero);
  return warehouseHeadroom(cargo[resource as WarehouseResource] ?? 0, heroResourceCap(hero)[resource as WarehouseResource]);
}

/** Adds a picked-up amount to the hero that picked it. */
function withPickup(hero: HeroState, resource: ResourceType, amount: number): HeroState {
  if (resource === "gold") return { ...hero, gold: (hero.gold ?? 0) + amount };
  const cargo: Warehouse = { ...heroCargo(hero) };
  cargo[resource as WarehouseResource] = (cargo[resource as WarehouseResource] ?? 0) + amount;
  return { ...hero, resources: cargo };
}

export interface ResourcePickupPreview {
  ok: boolean;
  /** Empty string when ok; otherwise the refusal the command would answer with. */
  reason: ResourcePickupRefusal | "";
  resource: ResourceType;
  /** Still on the tile (pristine amount minus everything picked so far). */
  remaining: number;
  /** Space left in the hero's hold for this resource. */
  room: number;
  /** What a pickup right now would take: min(remaining, room). */
  amount: number;
}

/**
 * What a pickup would do, as data: the client panel and the server command run
 * this same read, so the button cannot promise an amount the command refuses.
 * Null when there is nothing to describe (no such hero, or no resource tile
 * here).
 */
export function previewResourcePickup(
  state: GameState,
  map: GameMap,
  request: ResourcePickupRequest,
): ResourcePickupPreview | null {
  const hero = state.heroes[request.heroId];
  if (!hero) return null;
  const tile = map.resourceTileAt(request.q, request.r);
  if (!tile) return null;
  const remaining = resourceRemainingOn(state, request.q, request.r, tile.amount);
  const room = heroRoomFor(hero, tile.resource);
  const reason = refusePickup(state, map, hero, request);
  if (reason) {
    return { ok: false, reason, resource: tile.resource, remaining, room, amount: 0 };
  }
  return {
    ok: true,
    reason: "",
    resource: tile.resource,
    remaining,
    room,
    amount: Math.min(remaining, room),
  };
}

/** The refusal a pickup by this hero would answer with, or null when it may proceed. */
function refusePickup(
  state: GameState,
  map: GameMap,
  hero: HeroState,
  request: ResourcePickupRequest,
): ResourcePickupRefusal | null {
  const tile = map.resourceTileAt(request.q, request.r);
  if (!tile) return "no_resource_tile";
  // The hero must be ON the tile. hexDistance > RESOURCE_PICKUP_RANGE is the
  // same distance rule the field trade uses (hero/tradeHeroes.ts), with the
  // range constant this verb's own.
  if (hexDistance({ q: hero.q, r: hero.r }, { q: request.q, r: request.r }) > RESOURCE_PICKUP_RANGE) {
    return "not_on_resource_tile";
  }
  const remaining = resourceRemainingOn(state, request.q, request.r, tile.amount);
  if (remaining <= 0) return "deposit_depleted";
  if (heroRoomFor(hero, tile.resource) <= 0) {
    return tile.resource === "gold" ? "not_enough_gold_space" : "not_enough_cargo_space";
  }
  return null;
}

export interface ResourcePickupResult {
  ok: boolean;
  state: GameState;
  reason: ResourcePickupRefusal | "";
  /** The tile's resource type; null on a refusal that never found a tile. */
  resource: ResourceType | null;
  /** What the hero actually took (0 on a refusal). */
  taken: number;
  /** What is left on the tile after the pickup. */
  remaining: number;
}

/**
 * Takes min(remaining, room) off the tile and puts it in the hero's hold,
 * leaving the rest on the floor.
 *
 * A PARTIAL pickup is a success: the hero takes what fits and the tile keeps
 * the difference. The command is refused only when NOTHING fits (a full hold,
 * or a wagon-less hero), and then the state comes back untouched. The tile's
 * resource TYPE -- and therefore its city-view contribution, the deposit the
 * settlement works for its per-turn yield -- is never read or written here:
 * only `GameState.resourceDeposits`, which is a quantity, changes.
 */
export function pickupResource(
  state: GameState,
  map: GameMap,
  request: ResourcePickupRequest,
): ResourcePickupResult {
  const hero = state.heroes[request.heroId];
  if (!hero) {
    return { ok: false, state, reason: "no_hero", resource: null, taken: 0, remaining: 0 };
  }
  const tile = map.resourceTileAt(request.q, request.r);
  if (!tile) {
    return { ok: false, state, reason: "no_resource_tile", resource: null, taken: 0, remaining: 0 };
  }
  const remaining = resourceRemainingOn(state, request.q, request.r, tile.amount);
  const refusal = refusePickup(state, map, hero, request);
  if (refusal) {
    return { ok: false, state, reason: refusal, resource: tile.resource, taken: 0, remaining };
  }
  const room = heroRoomFor(hero, tile.resource);
  const taken = Math.min(remaining, room);
  const left = remaining - taken;
  return {
    ok: true,
    reason: "",
    resource: tile.resource,
    taken,
    remaining: left,
    state: {
      ...state,
      heroes: { ...state.heroes, [hero.id]: withPickup(hero, tile.resource, taken) },
      resourceDeposits: { ...(state.resourceDeposits ?? {}), [resourceDepositKey(request.q, request.r)]: left },
      dirty: true,
    },
  };
}
