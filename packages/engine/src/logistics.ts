import type {
  Axial,
  CaravanState,
  GameState,
  HeroId,
  HeroState,
  PlayerSeat,
  SettlementId,
  SettlementState,
  TradeRouteId,
  TradeRouteState,
  WarehouseResource,
} from "@heroes/contracts";
import { WAREHOUSE_RESOURCES } from "@heroes/contracts";
import type { GameMap } from "./map/gameMap";
import { findPath } from "./map/pathfinding";
import {
  WAGON_COST,
  heroCargo,
  heroGoldCap,
  heroResourceCap,
  settlementResourceCap,
  warehouseHeadroom,
} from "./settlement/capacity";

// docs/wagons-stockpiles-trade-routes-plan.md §4.2/§6 — hero cargo
// transfers (load/unload at a same-hex owned settlement) and wagon
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
): AssignWagonsResult {
  const hero = state.heroes[heroId];
  if (!hero) return { ok: false, state, reason: "no_hero" };
  if (hero.ownerId !== actor) return { ok: false, state, reason: "forbidden_not_your_hero" };
  const player = state.players.find((p) => p.id === actor);
  if (!player) return { ok: false, state, reason: "no_player" };
  if (!Number.isInteger(delta) || delta === 0) return { ok: false, state, reason: "invalid_amount" };

  const unassigned = player.wagonsUnassigned ?? 0;
  const owned = player.wagonsOwned ?? 0;
  const current = hero.wagons ?? 0;
  const move = delta > 0 ? Math.min(delta, unassigned) : Math.max(delta, -current);
  if (move === 0) {
    return { ok: false, state, reason: delta > 0 ? "not_enough_wagons_unassigned" : "not_enough_wagons" };
  }

  const newHeroes = {
    ...state.heroes,
    [heroId]: { ...hero, wagons: current + move },
  };
  const newPlayers = state.players.map((p) =>
    p.id === actor ? { ...p, wagonsOwned: owned, wagonsUnassigned: unassigned - move } : p,
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
  const newPlayers = state.players.map((p) =>
    p.id === actor
      ? {
          ...p,
          wagonsOwned: (p.wagonsOwned ?? 0) + count,
          wagonsUnassigned: (p.wagonsUnassigned ?? 0) + count,
        }
      : p,
  );
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


// -- Trade routes (docs/wagons-stockpiles-trade-routes-plan.md �5.2) --------

export const CARAVAN_TILES_PER_DAY = 4;
export const CARAVAN_WAGON_LOAD = 50;

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

function ownedBy(state: GameState, settlementId: SettlementId, actor: PlayerSeat): boolean {
  const s = state.settlements[settlementId];
  return !!s && s.ownerId === actor;
}

export function createTradeRoute(
  state: GameState,
  actor: PlayerSeat,
  fromSettlementId: SettlementId,
  toSettlementId: SettlementId,
  resource: WarehouseResource,
  wagons: number,
): CreateTradeRouteResult {
  if (!WAREHOUSE_RESOURCES.includes(resource)) {
    return { ok: false, state, reason: "invalid_resource" };
  }
  if (!ownedBy(state, fromSettlementId, actor) || !ownedBy(state, toSettlementId, actor)) {
    return { ok: false, state, reason: "forbidden_not_your_settlement" };
  }
  if (fromSettlementId === toSettlementId) {
    return { ok: false, state, reason: "same_settlement" };
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
    fromSettlementId,
    toSettlementId,
    resource,
    wagons,
    caravan: null,
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
  if (!ownedBy(state, route.fromSettlementId, actor)) {
    return { ok: false, state, reason: "forbidden_not_your_settlement" };
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
    wagons += move;
    wagonsDelta = move;
  }
  const resource = change.resource ?? route.resource;
  if (!WAREHOUSE_RESOURCES.includes(resource)) {
    return { ok: false, state, reason: "invalid_resource" };
  }
  const newRoutes = routes.map((r) => (r.id === routeId ? { ...r, wagons, resource } : r));
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

/** Advances every caravan one round wrap. Caravans wait (never lose cargo) when the map is unavailable, the source is empty, or the destination is full. */
export function advanceTradeRoutes(state: GameState, map: GameMap | null): GameState {
  const routes = tradeRoutesOf(state);
  if (routes.length === 0) return state;
  const next: Record<SettlementId, SettlementState> = { ...state.settlements };
  let changed = false;
  const newRoutes: TradeRouteState[] = routes.map((route) => {
    const from = next[route.fromSettlementId];
    const to = next[route.toSettlementId];
    if (!from || !to) return route;
    const capacity = route.wagons * CARAVAN_WAGON_LOAD;

    // Loading at origin.
    if (!route.caravan) {
      const load = Math.min(capacity, from.warehouse[route.resource] ?? 0);
      if (load < 1 || !map) return route;
      const path = findPath(map, { q: from.q, r: from.r }, { q: to.q, r: to.r });
      if (path.length === 0) return route;
      changed = true;
      next[route.fromSettlementId] = {
        ...from,
        warehouse: { ...from.warehouse, [route.resource]: (from.warehouse[route.resource] ?? 0) - load },
      };
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
      if (caravan.phase === "toDestination") {
        const cap = settlementResourceCap(to)[route.resource];
        const delivered = Math.min(
          caravan.cargo,
          warehouseHeadroom(to.warehouse[route.resource] ?? 0, cap),
        );
        changed = true;
        next[route.toSettlementId] = {
          ...to,
          warehouse: { ...to.warehouse, [route.resource]: (to.warehouse[route.resource] ?? 0) + delivered },
        };
        const cargoLeft = caravan.cargo - delivered;
        if (cargoLeft <= 0) {
          return {
            ...route,
            caravan: {
              phase: "toHome" as const,
              cargo: 0,
              path: [...caravan.path].reverse(),
              pathIndex: 0,
            },
          };
        }
        return { ...route, caravan: { ...caravan, cargo: cargoLeft } };
      }
      // Arrived home empty-handed (cargo was delivered); reload next wrap.
      changed = true;
      return { ...route, caravan: null };
    }

    changed = true;
    return { ...route, caravan };
  });
  if (!changed) return state;
  return { ...state, tradeRoutes: newRoutes, settlements: next, dirty: true };
}
