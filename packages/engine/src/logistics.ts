import type {
  Axial,
  CaravanState,
  GameState,
  HeroId,
  HeroState,
  PlayerId,
  PlayerSeat,
  SettlementId,
  SettlementState,
  TradeRouteEndpoint,
  TradeRouteId,
  TradeRoutePayload,
  TradeRouteState,
  WarehouseResource,
} from "@heroes/contracts";
import { WAREHOUSE_RESOURCES } from "@heroes/contracts";
import type { GameMap } from "./map/gameMap";
import { findPath, hexDistance } from "./map/pathfinding";
import {
  DEFAULT_TREASURY_WAGONS,
  WAGON_COST,
  WAGON_GOLD_CAPACITY,
  WAGON_RESOURCE_CAPACITY,
  heroCargo,
  heroGoldCap,
  heroResourceCap,
  settlementResourceCap,
  settlementTreasuryCap,
  treasuryHeadroom,
  warehouseHeadroom,
} from "./settlement/capacity";

// docs/wagons-stockpiles-trade-routes-plan.md sections 4.2 and 6: hero
// cargo transfers (load/unload at a same-hex owned settlement) and wagon
// assignment between the player pool and a hero.

export interface TransferResourcesResult {
  ok: boolean;
  state: GameState;
  reason: string;
}

export interface AssignWagonsResult {
  ok: boolean;
  state: GameState;
  reason: string;
}

export type HeroTransferDirection = "load" | "unload";

function isSameTile(a: { q: number; r: number }, b: { q: number; r: number }): boolean {
  return a.q === b.q && a.r === b.r;
}

export function transferResources(
  state: GameState,
  actor: PlayerSeat,
  heroId: HeroId,
  settlementId: SettlementId,
  direction: HeroTransferDirection,
  amounts: Partial<Record<WarehouseResource, number>>,
): TransferResourcesResult {
  const hero = state.heroes[heroId];
  if (!hero) return { ok: false, state, reason: "no_hero" };
  if (hero.ownerId !== actor) return { ok: false, state, reason: "forbidden_not_your_hero" };
  const s = state.settlements[settlementId];
  if (!s) return { ok: false, state, reason: "no_settlement" };
  if (s.ownerId !== actor) return { ok: false, state, reason: "forbidden_not_your_settlement" };
  if (!isSameTile(hero, s)) return { ok: false, state, reason: "hero_not_at_settlement" };

  const heroResources = heroCargo(hero);
  const cargoCap = heroResourceCap(hero);
  const stockCap = settlementResourceCap(s);

  const newHeroCargo = { ...heroResources };
  const newWarehouse = { ...s.warehouse };
  let moved = 0;
  for (const r of WAREHOUSE_RESOURCES) {
    const requested = amounts[r] ?? 0;
    if (requested <= 0) continue;
    if (!Number.isFinite(requested) || !Number.isInteger(requested)) {
      return { ok: false, state, reason: "invalid_amount" };
    }
    if (direction === "load") {
      const move = Math.min(requested, heroResources[r] ?? 0, warehouseHeadroom(s.warehouse[r] ?? 0, stockCap[r]));
      newHeroCargo[r] = (heroResources[r] ?? 0) - move;
      newWarehouse[r] = (s.warehouse[r] ?? 0) + move;
    } else {
      const move = Math.min(requested, s.warehouse[r] ?? 0, warehouseHeadroom(heroResources[r] ?? 0, cargoCap[r]));
      newHeroCargo[r] = (heroResources[r] ?? 0) + move;
      newWarehouse[r] = (s.warehouse[r] ?? 0) - move;
    }
    moved += Math.abs(direction === "load" ? heroResources[r] - newHeroCargo[r] : newHeroCargo[r] - heroResources[r]);
  }
  if (moved <= 0) return { ok: false, state, reason: "nothing_transferred" };

  const newHeroes = {
    ...state.heroes,
    [heroId]: { ...hero, resources: newHeroCargo },
  };
  const newSettlements = {
    ...state.settlements,
    [settlementId]: { ...s, warehouse: newWarehouse },
  };
  return { ok: true, state: { ...state, heroes: newHeroes, settlements: newSettlements, dirty: true }, reason: "" };
}

export function assignWagons(
  state: GameState,
  actor: PlayerSeat,
  heroId: HeroId,
  delta: number,
  slot: "cargo" | "treasury" = "cargo",
): AssignWagonsResult {
  const hero = state.heroes[heroId];
  if (!hero) return { ok: false, state, reason: "no_hero" };
  if (hero.ownerId !== actor) return { ok: false, state, reason: "forbidden_not_your_hero" };
  const player = state.players.find((p) => p.id === actor);
  if (!player) return { ok: false, state, reason: "no_player" };
  if (!Number.isInteger(delta) || delta === 0) return { ok: false, state, reason: "invalid_amount" };

  // Phase 1 treasury-wagons split: the slot picks which hero field and
  // which pool the delta moves between. "cargo" keeps the pre-split
  // army-wagon behavior byte-for-byte (the default for legacy senders).
  const unassigned = slot === "treasury" ? (player.treasuryWagonsUnassigned ?? 0) : (player.wagonsUnassigned ?? 0);
  const owned = slot === "treasury" ? (player.treasuryWagonsOwned ?? 0) : (player.wagonsOwned ?? 0);
  // Belt over the migration gap (028 backfills NULL rows to 5): an absent
  // treasuryWagons is a pre-023 hero whose carts soft-default to 5 — seeding
  // the slot from 0 would materialize a sub-default cart count and SHRINK
  // the purse cap below 2,500g, and a negative delta must clamp against the
  // carts the hero really has.
  const current =
    slot === "treasury" ? (hero.treasuryWagons ?? DEFAULT_TREASURY_WAGONS) : (hero.wagons ?? 0);
  const move = delta > 0 ? Math.min(delta, unassigned) : Math.max(delta, -current);
  if (move === 0) {
    return { ok: false, state, reason: delta > 0 ? "not_enough_wagons_unassigned" : "not_enough_wagons" };
  }

  const newHeroes = {
    ...state.heroes,
    [heroId]: slot === "treasury" ? { ...hero, treasuryWagons: current + move } : { ...hero, wagons: current + move },
  };
  const newPlayers = state.players.map((p) =>
    p.id === actor
      ? slot === "treasury"
        ? { ...p, treasuryWagonsOwned: owned, treasuryWagonsUnassigned: unassigned - move }
        : { ...p, wagonsOwned: owned, wagonsUnassigned: unassigned - move }
      : p,
  );
  return {
    ok: true,
    state: { ...state, heroes: newHeroes, players: newPlayers, dirty: true },
    reason: "",
  };
}

export interface BuyWagonsResult {
  ok: boolean;
  state: GameState;
  reason: string;
}

export function wagonsCost(count: number): { gold: number; wood: number } {
  return { gold: WAGON_COST.gold * count, wood: WAGON_COST.wood * count };
}

export function buyWagons(
  state: GameState,
  actor: PlayerSeat,
  settlementId: SettlementId,
  count: number,
  slot: "cargo" | "treasury" = "cargo",
): BuyWagonsResult {
  const s = state.settlements[settlementId];
  if (!s) return { ok: false, state, reason: "no_settlement" };
  if (s.ownerId !== actor) return { ok: false, state, reason: "forbidden_not_your_settlement" };
  if (!Number.isInteger(count) || count <= 0) return { ok: false, state, reason: "invalid_amount" };
  const player = state.players.find((p) => p.id === actor);
  if (!player) return { ok: false, state, reason: "no_player" };
  const cost = wagonsCost(count);
  if (s.gold < cost.gold) return { ok: false, state, reason: "not_enough_gold" };
  if ((s.warehouse.wood ?? 0) < cost.wood) return { ok: false, state, reason: "not_enough_wood" };

  const newSettlements = {
    ...state.settlements,
    [settlementId]: {
      ...s,
      gold: s.gold - cost.gold,
      warehouse: { ...s.warehouse, wood: (s.warehouse.wood ?? 0) - cost.wood },
    },
  };
  // Phase 1 treasury-wagons split: the SAME 200g + 5 wood cost buys into
  // the matching pool; "cargo" (default) keeps the pre-split behavior.
  const newPlayers = state.players.map((p) => {
    if (p.id !== actor) return p;
    if (slot === "treasury") {
      return {
        ...p,
        treasuryWagonsOwned: (p.treasuryWagonsOwned ?? 0) + count,
        treasuryWagonsUnassigned: (p.treasuryWagonsUnassigned ?? 0) + count,
      };
    }
    return {
      ...p,
      wagonsOwned: (p.wagonsOwned ?? 0) + count,
      wagonsUnassigned: (p.wagonsUnassigned ?? 0) + count,
    };
  });
  return {
    ok: true,
    state: { ...state, settlements: newSettlements, players: newPlayers, dirty: true },
    reason: "",
  };
}

/** Battle-cargo loot: the winner takes what fits of the loser's cargo and purse (clamped to the winner's caps). */
export function transferCargoLoot(
  heroes: Record<HeroId, HeroState>,
  winnerId: HeroId,
  loserId: HeroId,
): { heroes: Record<HeroId, HeroState>; gold: number; resources: Partial<Record<WarehouseResource, number>> } {
  const winner = heroes[winnerId];
  const loser = heroes[loserId];
  if (!winner || !loser) return { heroes, gold: 0, resources: {} };

  const goldCap = heroGoldCap(winner);
  const goldTaken = Math.min(loser.gold, Math.max(0, goldCap - winner.gold));
  const winnerCap = heroResourceCap(winner);
  const winnerCargo = heroCargo(winner);
  const loserCargo = heroCargo(loser);
  const newWinnerCargo = { ...winnerCargo };
  const newLoserCargo = { ...loserCargo };
  const taken: Partial<Record<WarehouseResource, number>> = {};
  for (const r of WAREHOUSE_RESOURCES) {
    const move = Math.min(loserCargo[r] ?? 0, warehouseHeadroom(winnerCargo[r] ?? 0, winnerCap[r]));
    if (move > 0) {
      newWinnerCargo[r] = (winnerCargo[r] ?? 0) + move;
      newLoserCargo[r] = (loserCargo[r] ?? 0) - move;
      taken[r] = move;
    }
  }

  const newHeroes = {
    ...heroes,
    [winnerId]: { ...winner, gold: winner.gold + goldTaken, resources: newWinnerCargo },
    [loserId]: { ...loser, gold: loser.gold - goldTaken, resources: newLoserCargo },
  };
  return { heroes: newHeroes, gold: goldTaken, resources: taken };
}


// -- Trade routes (docs/wagons-stockpiles-trade-routes-plan.md §5.2) --------

export const CARAVAN_TILES_PER_DAY = 4;
// Hero endpoints are moving targets: when a caravan's path is exhausted the
// hero may have moved off that tile, and the caravan re-paths toward the
// hero's current position. This cap bounds re-path attempts per daily
// advance call so an unreachable (or pathological) target can never loop
// the advance -- past the cap the caravan waits with its cargo intact and
// the next daily tick retries fresh.
export const CARAVAN_CATCHUP_REPATHS_PER_DAY = 3;

export interface CreateTradeRouteResult {
  ok: boolean;
  state: GameState;
  reason: string;
  route?: TradeRouteState;
}

export interface UpdateTradeRouteResult {
  ok: boolean;
  state: GameState;
  reason: string;
}

export function tradeRoutesOf(state: GameState): TradeRouteState[] {
  return state.tradeRoutes ?? [];
}

/** Structural records-only view of GameState: full states and the mutable `{ settlements, heroes }` pairs inside advanceTradeRoutes both satisfy it. */
export type EndpointRecords = Pick<GameState, "settlements" | "heroes">;

/** The endpoint's live tile, or null when the endpoint no longer exists (a dead hero; settlements are never deleted, only captured). */
export function endpointTile(endpoint: TradeRouteEndpoint, state: EndpointRecords): Axial | null {
  if (endpoint.kind === "settlement") {
    const s = state.settlements[endpoint.id];
    return s ? { q: s.q, r: s.r } : null;
  }
  const h = state.heroes[endpoint.id];
  return h ? { q: h.q, r: h.r } : null;
}

/** The endpoint's owning seat (null for a missing endpoint or a neutral settlement). */
export function endpointOwner(endpoint: TradeRouteEndpoint, state: EndpointRecords): PlayerId | null {
  if (endpoint.kind === "settlement") {
    return state.settlements[endpoint.id]?.ownerId ?? null;
  }
  return state.heroes[endpoint.id]?.ownerId ?? null;
}

function isPayloadValid(payload: TradeRoutePayload): boolean {
  return payload.kind === "gold" || WAREHOUSE_RESOURCES.includes(payload.resource);
}

function endpointForbiddenReason(endpoint: TradeRouteEndpoint): string {
  return endpoint.kind === "settlement" ? "forbidden_not_your_settlement" : "forbidden_not_your_hero";
}

export function createTradeRoute(
  state: GameState,
  actor: PlayerSeat,
  from: TradeRouteEndpoint,
  to: TradeRouteEndpoint,
  payload: TradeRoutePayload,
  wagons: number,
): CreateTradeRouteResult {
  if (!isPayloadValid(payload)) {
    return { ok: false, state, reason: "invalid_resource" };
  }
  // Both endpoints must exist and share one owner with the actor. Any pair
  // is legal (settlement<->settlement, either direction city<->hero,
  // hero<->hero) -- only ownership and existence gate.
  for (const endpoint of [from, to]) {
    if (endpointOwner(endpoint, state) !== actor) {
      return { ok: false, state, reason: endpointForbiddenReason(endpoint) };
    }
  }
  if (from.kind === to.kind && from.id === to.id) {
    return { ok: false, state, reason: "same_endpoint" };
  }
  // Same-TILE, not same-endpoint: a settlement and a hero standing on it are
  // distinct endpoints on one tile, and a route between them can never load
  // (findPath returns [] for start===goal) -- it would sit "loading" forever
  // while weekly maintenance bills it. Reject at creation.
  const fromTile = endpointTile(from, state);
  const toTile = endpointTile(to, state);
  if (fromTile && toTile && isSameTile(fromTile, toTile)) {
    return { ok: false, state, reason: "same_tile" };
  }
  if (!Number.isInteger(wagons) || wagons <= 0) {
    return { ok: false, state, reason: "invalid_amount" };
  }
  const player = state.players.find((p) => p.id === actor);
  if (!player) return { ok: false, state, reason: "no_player" };
  const unassigned = player.wagonsUnassigned ?? 0;
  if (wagons > unassigned) return { ok: false, state, reason: "not_enough_wagons_unassigned" };

  const id = `route${state.nextTradeRouteId ?? 0}` as TradeRouteId;
  const route: TradeRouteState = {
    id,
    from,
    to,
    payload,
    wagons,
    caravan: null,
    ownerId: actor,
  };
  return {
    ok: true,
    state: {
      ...state,
      tradeRoutes: [...tradeRoutesOf(state), route],
      nextTradeRouteId: (state.nextTradeRouteId ?? 0) + 1,
      players: state.players.map((p) =>
        p.id === actor ? { ...p, wagonsUnassigned: unassigned - wagons } : p,
      ),
      dirty: true,
    },
    reason: "",
    route,
  };
}

export function updateTradeRoute(
  state: GameState,
  actor: PlayerSeat,
  routeId: TradeRouteId,
  change: { resource?: WarehouseResource; wagonsDelta?: number; remove?: boolean },
): UpdateTradeRouteResult {
  const routes = tradeRoutesOf(state);
  const route = routes.find((r) => r.id === routeId);
  if (!route) return { ok: false, state, reason: "no_route" };
  // The persisted owner decides (when present): a route outlives a dead or
  // captured ORIGIN endpoint, and its true owner must still be able to
  // remove it -- a gate on the FROM endpoint's live owner would make a
  // dead-hero-origin route unremovable by anyone and a captured origin
  // removable by the capturer. Absent (legacy rows) falls back to the
  // FROM endpoint's live owner, the pre-ownerId behavior.
  const owner = route.ownerId ?? endpointOwner(route.from, state);
  if (owner !== actor) {
    return { ok: false, state, reason: endpointForbiddenReason(route.from) };
  }
  const player = state.players.find((p) => p.id === actor);
  if (!player) return { ok: false, state, reason: "no_player" };

  if (change.remove) {
    const unassigned = player.wagonsUnassigned ?? 0;
    return {
      ok: true,
      state: {
        ...state,
        tradeRoutes: routes.filter((r) => r.id !== routeId),
        players: state.players.map((p) =>
          p.id === actor ? { ...p, wagonsUnassigned: unassigned + route.wagons } : p,
        ),
        dirty: true,
      },
      reason: "",
    };
  }

  let wagons = route.wagons;
  const unassigned = player.wagonsUnassigned ?? 0;
  let wagonsDelta = change.wagonsDelta ?? 0;
  if (wagonsDelta !== 0) {
    const move =
      wagonsDelta > 0 ? Math.min(wagonsDelta, unassigned) : Math.max(wagonsDelta, -wagons);
    if (move === 0) {
      return {
        ok: false,
        state,
        reason: wagonsDelta > 0 ? "not_enough_wagons_unassigned" : "not_enough_wagons",
      };
    }
    // A route always keeps at least one wagon: clamping a negative delta to
    // 0 would mint a zombie route that maintenance skips and nothing ever
    // removes.
    if (wagons + move < 1) {
      return { ok: false, state, reason: "route_needs_a_wagon" };
    }
    wagons += move;
    wagonsDelta = move;
  }
  // Endpoints are immutable on update. A resource change re-targets the
  // payload (a treasure route becomes a cargo route for that resource);
  // without one the payload -- including a gold payload -- rides unchanged.
  let payload = route.payload;
  if (change.resource !== undefined) {
    // The cargo aboard has no label; re-targeting mid-flight would make the
    // delivery reinterpret it under the NEW payload (500 gold landing as 500
    // wood), so a payload switch must wait for the caravan to come home.
    if (route.caravan !== null) {
      return { ok: false, state, reason: "route_in_flight" };
    }
    if (!WAREHOUSE_RESOURCES.includes(change.resource)) {
      return { ok: false, state, reason: "invalid_resource" };
    }
    payload = { kind: "resource", resource: change.resource };
  }
  const newRoutes = routes.map((r) => (r.id === routeId ? { ...r, wagons, payload } : r));
  const newPlayers =
    wagonsDelta !== 0
      ? state.players.map((p) =>
          p.id === actor ? { ...p, wagonsUnassigned: unassigned - wagonsDelta } : p,
        )
      : state.players;
  return {
    ok: true,
    state: { ...state, tradeRoutes: newRoutes, players: newPlayers, dirty: true },
    reason: "",
  };
}

/** The caravan's current map tile (last consumed path tile, or origin while loading). */
export function caravanTile(caravan: CaravanState, from: { q: number; r: number }): Axial {
  return caravan.pathIndex > 0 ? caravan.path[caravan.pathIndex - 1] : { q: from.q, r: from.r };
}

/** Load capacity for the route's wagon count: wagons x the payload kind's per-wagon capacity (the 10x gold convention). */
function caravanCapacity(payload: TradeRoutePayload, wagons: number): number {
  return payload.kind === "gold" ? wagons * WAGON_GOLD_CAPACITY : wagons * WAGON_RESOURCE_CAPACITY;
}

/** Deliverable headroom at a settlement, per payload kind (treasury cap or warehouse per-resource cap). Shared with caravanUpkeep's desertion return — one source of the clamp math. */
export function settlementDeliveryHeadroom(payload: TradeRoutePayload, s: SettlementState): number {
  if (payload.kind === "gold") return treasuryHeadroom(s.gold, settlementTreasuryCap(s));
  return warehouseHeadroom(s.warehouse[payload.resource] ?? 0, settlementResourceCap(s)[payload.resource]);
}

/** Deliverable headroom at a hero, per payload kind (treasury carts for gold, cargo wagons for resources). Shared with caravanUpkeep's desertion return. */
export function heroDeliveryHeadroom(payload: TradeRoutePayload, h: HeroState): number {
  if (payload.kind === "gold") return treasuryHeadroom(h.gold, heroGoldCap(h));
  return warehouseHeadroom(heroCargo(h)[payload.resource] ?? 0, heroResourceCap(h)[payload.resource]);
}

/** Applies a payload delta to a settlement (treasury or warehouse); negative deltas are loads out of the origin. Shared with caravanUpkeep's desertion return. */
export function settlementApplyDelivery(s: SettlementState, payload: TradeRoutePayload, delta: number): SettlementState {
  if (payload.kind === "gold") return { ...s, gold: s.gold + delta };
  return { ...s, warehouse: { ...s.warehouse, [payload.resource]: (s.warehouse[payload.resource] ?? 0) + delta } };
}

/** Applies a payload delta to a hero (purse or wagon cargo); negative deltas are loads out of the origin. Shared with caravanUpkeep's desertion return. */
export function heroApplyDelivery(h: HeroState, payload: TradeRoutePayload, delta: number): HeroState {
  if (payload.kind === "gold") return { ...h, gold: h.gold + delta };
  const cargo = heroCargo(h);
  return { ...h, resources: { ...cargo, [payload.resource]: (cargo[payload.resource] ?? 0) + delta } };
}

/**
 * The route's true owner seat: the persisted stamp when present, else the
 * FROM endpoint's live owner (legacy rows predate the stamp). One source of
 * truth for every owner re-validation: advanceTradeRoutes's dormant-route
 * checks, updateTradeRoute's removal gate, and caravanUpkeep's
 * maintenance-skip / desertion-return all resolve ownership through this.
 */
export function routeOwnerId(route: TradeRouteState, records: EndpointRecords): PlayerId | null {
  return route.ownerId ?? endpointOwner(route.from, records);
}

/**
 * The owner's nearest owned settlement to a tile (hexDistance min,
 * record-order tie-break), or null when the seat holds no settlement.
 */
function nearestSettlementOwnedBy(records: EndpointRecords, owner: PlayerId | null, from: Axial): SettlementState | null {
  if (owner === null) return null;
  let best: SettlementState | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const s of Object.values(records.settlements)) {
    if (s.ownerId !== owner) continue;
    const d = hexDistance(from, s);
    if (d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

/**
 * The toHome caravan after a delivery/dead-endpoint flip. The return leg is
 * a fresh path from the caravan's REAL tile (the last tile it occupies --
 * which after a chase is the delivery tile, not the outbound path's end) to
 * the origin endpoint's CURRENT tile (heroes move), so the arrival deposit
 * always happens where the caravan physically stands and the round-trip
 * throughput model survives a chase. pathIndex starts at 1 so caravanTile
 * reports the real departure tile from the flip onward. Falls back to the
 * legacy reversed path (pathIndex 0) only when no path exists -- the origin
 * is unreachable (or the map is missing this tick), where the old walk-home
 * semantics are the only option.
 */
function returnLegCaravan(
  cargo: number,
  realTile: Axial,
  originTile: Axial | null,
  map: GameMap | null,
  previousPath: { q: number; r: number }[],
): CaravanState {
  if (originTile && isSameTile(realTile, originTile)) {
    return { phase: "toHome" as const, cargo, path: [realTile], pathIndex: 1 };
  }
  const leg = map && originTile ? findPath(map, realTile, originTile) : [];
  if (leg.length > 0) {
    return { phase: "toHome" as const, cargo, path: [realTile, ...leg], pathIndex: 1 };
  }
  return { phase: "toHome" as const, cargo, path: [...previousPath].reverse(), pathIndex: 0 };
}

// Advance notes (docs plan §5.2 + the endpoints/catch-up rules):
// - Ownership: a route belongs to the seat stamped on it (ownerId, else the
//   FROM endpoint's live owner for legacy rows). A route whose ORIGIN
//   endpoint no longer belongs to that seat is DORMANT: the loading branch
//   skips it (no reload for a capturer), and in-flight caravans finish the
//   current leg only. The weekly maintenance mirror of this rule lives in
//   economy/caravanUpkeep.ts.
// - A captured DESTINATION receives nothing (no gifts to the enemy): the
//   arriving caravan flips toHome with its cargo intact instead of
//   delivering. Symmetrically, a hero destination owned by another seat is
//   skipped the same way (heroes cannot normally change owner; this is
//   defense in depth).
// - The toHome flip rebuilds the return path from the caravan's real tile
//   to the origin endpoint's CURRENT tile (see returnLegCaravan): arrival
//   deposits where the caravan physically stands.
// - At home, a returning caravan deposits into the origin ONLY while the
//   origin still belongs to the route owner; a lost origin reroutes the
//   cargo to the owner's nearest owned settlement, and an owner with no
//   settlement left holds the cargo aboard (never destroyed).
// - Loading happens at the origin endpoint's tile, per payload kind, out of
//   the origin's stock (settlement warehouse/treasury or hero cargo/purse).
// - Delivery caps at the destination: warehouseHeadroom/treasuryHeadroom for
//   a settlement, heroResourceCap/heroGoldCap for a hero. Leftover stays on
//   the caravan and delivers as headroom appears (never-lose-cargo).
// - A hero endpoint is a moving target: when the path is exhausted and the
//   hero is not on the caravan's tile, the caravan re-paths (A* to the
//   hero's current position) and continues, cargo intact, up to
//   CARAVAN_CATCHUP_REPATHS_PER_DAY re-paths per daily call; past the cap
//   (or on an unreachable target) it waits for the next daily tick.
// - A dead hero destination flips the caravan toHome with the return leg
//   built above; a dead hero origin leaves a returning caravan
//   holding its cargo at the path's end -- the route's fate is decided by
//   updateTradeRoute({remove}) or a later phase, cargo is never destroyed.
export function advanceTradeRoutes(state: GameState, map: GameMap | null): GameState {
  const routes = tradeRoutesOf(state);
  if (routes.length === 0) return state;
  const next: Record<SettlementId, SettlementState> = { ...state.settlements };
  const nextHeroes: Record<HeroId, HeroState> = { ...state.heroes };
  const records: EndpointRecords = { settlements: next, heroes: nextHeroes };
  let heroesChanged = false;
  let changed = false;

  const touchHero = (id: HeroId, hero: HeroState): void => {
    nextHeroes[id] = hero;
    heroesChanged = true;
  };

  const newRoutes: TradeRouteState[] = routes.map((route) => {
    const originTile = endpointTile(route.from, records);
    const destTile = endpointTile(route.to, records);
    const capacity = caravanCapacity(route.payload, route.wagons);

    // Loading at origin.
    if (!route.caravan) {
      if (!originTile || !destTile || !map) return route;
      // A dormant route (the origin endpoint changed hands) never reloads:
      // the capturer must not run the old owner's supply line, and the old
      // owner must not draw from a captured store. Legacy routes (no stamp)
      // derive their owner from the origin itself, so this is a no-op for
      // them.
      if (endpointOwner(route.from, records) !== routeOwnerId(route, records)) return route;
      if (route.from.kind === "settlement") {
        const from = next[route.from.id];
        if (!from) return route;
        const load =
          route.payload.kind === "gold"
            ? Math.min(capacity, from.gold)
            : Math.min(capacity, from.warehouse[route.payload.resource] ?? 0);
        if (load < 1) return route;
        const path = findPath(map, originTile, destTile);
        if (path.length === 0) return route;
        changed = true;
        next[route.from.id] = settlementApplyDelivery(from, route.payload, -load);
        return {
          ...route,
          caravan: { phase: "toDestination" as const, cargo: load, path, pathIndex: 0 },
        };
      }
      const from = nextHeroes[route.from.id];
      if (!from) return route;
      const cargo = heroCargo(from);
      const load =
        route.payload.kind === "gold"
          ? Math.min(capacity, from.gold)
          : Math.min(capacity, cargo[route.payload.resource] ?? 0);
      if (load < 1) return route;
      const path = findPath(map, originTile, destTile);
      if (path.length === 0) return route;
      changed = true;
      touchHero(route.from.id, heroApplyDelivery(from, route.payload, -load));
      return {
        ...route,
        caravan: { phase: "toDestination" as const, cargo: load, path, pathIndex: 0 },
      };
    }

    let caravan: CaravanState = { ...route.caravan, path: [...route.caravan.path] };

    // Movement: up to CARAVAN_TILES_PER_DAY tiles per wrap.
    let steps = CARAVAN_TILES_PER_DAY;
    while (steps > 0 && caravan.pathIndex < caravan.path.length) {
      caravan = { ...caravan, pathIndex: caravan.pathIndex + 1 };
      steps -= 1;
    }

    // Arrival handling.
    if (caravan.pathIndex >= caravan.path.length) {
      // The tile the caravan physically occupies at path end. The
      // caravanTile fallback needs a non-null origin only at pathIndex 0,
      // which an exhausted path never is.
      const here = caravan.path[caravan.path.length - 1] ?? originTile;
      if (!here) return route;

      if (caravan.phase === "toDestination") {
        // Settlement destinations are static: arrival is arrival.
        if (route.to.kind === "settlement") {
          const to = next[route.to.id];
          if (!to) return route;
          if (to.ownerId !== routeOwnerId(route, records)) {
            // Captured destination: no gifts to the enemy -- the caravan
            // turns around with its cargo intact.
            changed = true;
            return {
              ...route,
              caravan: returnLegCaravan(caravan.cargo, caravanTile(caravan, here), originTile, map, caravan.path),
            };
          }
          const headroom = settlementDeliveryHeadroom(route.payload, to);
          const delivered = Math.max(0, Math.min(caravan.cargo, headroom));
          changed = true;
          next[route.to.id] = settlementApplyDelivery(to, route.payload, delivered);
          const cargoLeft = caravan.cargo - delivered;
          if (cargoLeft <= 0) {
            return {
              ...route,
              caravan: returnLegCaravan(0, caravanTile(caravan, here), originTile, map, caravan.path),
            };
          }
          return { ...route, caravan: { ...caravan, cargo: cargoLeft } };
        }

        // Hero destination: a moving target. A dead hero returns the cargo.
        const hero = nextHeroes[route.to.id];
        if (!hero) {
          changed = true;
          return {
            ...route,
            caravan: returnLegCaravan(caravan.cargo, caravanTile(caravan, here), originTile, map, caravan.path),
          };
        }
        if (hero.ownerId !== routeOwnerId(route, records)) {
          // A destination owned by another seat receives nothing (heroes
          // cannot normally change owner -- defense in depth).
          changed = true;
          return {
            ...route,
            caravan: returnLegCaravan(caravan.cargo, caravanTile(caravan, here), originTile, map, caravan.path),
          };
        }
        // Catch-up: while the hero is not on the caravan's tile, re-path
        // toward the hero's current position and keep walking today's
        // remaining budget -- bounded by the per-day re-path cap.
        let repaths = 0;
        while (!isSameTile(hero, caravanTile(caravan, here))) {
          if (!map || steps <= 0 || repaths >= CARAVAN_CATCHUP_REPATHS_PER_DAY) break;
          const leg = findPath(map, caravanTile(caravan, here), { q: hero.q, r: hero.r });
          if (leg.length === 0) break;
          repaths += 1;
          // Prepend the current tile so pathIndex 1 keeps caravanTile at
          // `here` (findPath excludes the start tile).
          caravan = { ...caravan, path: [caravanTile(caravan, here), ...leg], pathIndex: 1 };
          while (steps > 0 && caravan.pathIndex < caravan.path.length) {
            caravan = { ...caravan, pathIndex: caravan.pathIndex + 1 };
            steps -= 1;
          }
        }
        if (!isSameTile(hero, caravanTile(caravan, here))) {
          // Wait (never lose cargo): retry on the next daily tick. Steps
          // already walked this wrap (or a re-path adopted mid-chase) still
          // persist -- discarding them would re-walk the same tiles every
          // day and never reach the wait state. A wrap with neither is the
          // pure wait: an identity no-op.
          const progressed = repaths > 0 || caravan.pathIndex > route.caravan.pathIndex;
          if (!progressed) return route;
          changed = true;
          return { ...route, caravan };
        }
        const headroom = heroDeliveryHeadroom(route.payload, hero);
        const delivered = Math.max(0, Math.min(caravan.cargo, headroom));
        const cargoLeft = caravan.cargo - delivered;
        changed = true;
        touchHero(route.to.id, heroApplyDelivery(hero, route.payload, delivered));
        if (cargoLeft <= 0) {
          return {
            ...route,
            caravan: returnLegCaravan(0, caravanTile(caravan, here), originTile, map, caravan.path),
          };
        }
        return { ...route, caravan: { ...caravan, cargo: cargoLeft } };
      }

      // toHome: arrive at the origin. Any cargo still aboard (a hero-death
      // return) is deposited back, headroom-clamped; leftover stays aboard.
      // The deposit goes to the origin ONLY while it still belongs to the
      // route owner -- a lost origin reroutes the return cargo to the
      // owner's nearest owned settlement, and an owner with no settlement
      // holds the cargo aboard (never destroyed).
      if (route.from.kind === "settlement") {
        const from = next[route.from.id];
        if (!from) return route;
        let cargo = caravan.cargo;
        const owner = routeOwnerId(route, records);
        if (cargo > 0 && from.ownerId !== owner) {
          const target = nearestSettlementOwnedBy(records, owner, here);
          if (!target) return route;
          const headroom = settlementDeliveryHeadroom(route.payload, target);
          const returned = Math.max(0, Math.min(cargo, headroom));
          changed = true;
          next[target.id] = settlementApplyDelivery(target, route.payload, returned);
          cargo -= returned;
          if (cargo > 0) return { ...route, caravan: { ...caravan, cargo } };
          return { ...route, caravan: null };
        }
        if (cargo > 0) {
          const headroom = settlementDeliveryHeadroom(route.payload, from);
          const returned = Math.max(0, Math.min(cargo, headroom));
          changed = true;
          next[route.from.id] = settlementApplyDelivery(from, route.payload, returned);
          cargo -= returned;
          if (cargo > 0) return { ...route, caravan: { ...caravan, cargo } };
        }
        // Home empty-handed; reload next wrap.
        changed = true;
        return { ...route, caravan: null };
      }
      const homeHero = nextHeroes[route.from.id];
      if (!homeHero) return route;
      // Moving target on the return leg too: re-path toward the hero's
      // current position, same cap and never-lose-cargo wait.
      let repaths = 0;
      while (!isSameTile(homeHero, caravanTile(caravan, here))) {
        if (!map || steps <= 0 || repaths >= CARAVAN_CATCHUP_REPATHS_PER_DAY) break;
        const leg = findPath(map, caravanTile(caravan, here), { q: homeHero.q, r: homeHero.r });
        if (leg.length === 0) break;
        repaths += 1;
        caravan = { ...caravan, path: [caravanTile(caravan, here), ...leg], pathIndex: 1 };
        while (steps > 0 && caravan.pathIndex < caravan.path.length) {
          caravan = { ...caravan, pathIndex: caravan.pathIndex + 1 };
          steps -= 1;
        }
      }
      if (!isSameTile(homeHero, caravanTile(caravan, here))) {
        // Same wait rule as the outbound leg: persist walked steps and
        // adopted re-paths, identity no-op only when neither happened.
        const progressed = repaths > 0 || caravan.pathIndex > route.caravan.pathIndex;
        if (!progressed) return route;
        changed = true;
        return { ...route, caravan };
      }
      let cargo = caravan.cargo;
      if (cargo > 0) {
        const headroom = heroDeliveryHeadroom(route.payload, homeHero);
        const returned = Math.max(0, Math.min(cargo, headroom));
        changed = true;
        touchHero(route.from.id, heroApplyDelivery(homeHero, route.payload, returned));
        cargo -= returned;
        if (cargo > 0) return { ...route, caravan: { ...caravan, cargo } };
      }
      changed = true;
      return { ...route, caravan: null };
    }

    changed = true;
    return { ...route, caravan };
  });
  if (!changed) return state;
  return {
    ...state,
    tradeRoutes: newRoutes,
    settlements: next,
    ...(heroesChanged ? { heroes: nextHeroes } : {}),
    dirty: true,
  };
}
