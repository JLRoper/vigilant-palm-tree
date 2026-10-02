import type {
  EngineEvent,
  GameState,
  HeroState,
  PlayerSeat,
  SettlementId,
  TradeRouteId,
  TradeRouteState,
  WarehouseResource,
} from "@heroes/contracts";
import { transferGold } from "../economy/transfer";
import { depositIntoBank, requestBankWithdrawal } from "../economy/bank";
import { tradeResources } from "../economy/trade";
import { setAutoTrade } from "../settlement/autoTrade";
import { reorderStack } from "../hero/stacks";
import { captureSettlement } from "../settlement/capture";
import { startTownHallUpgrade } from "../settlement/upgradeTownHall";
import { depositIntoGarrison } from "../settlement/recruitUnits";
import { transferUnits } from "../settlement/transferUnits";
import { settlementStacks } from "../units";

// Phase 5.A (#146): the reducer the event-cursor client sync applies each
// polled EngineEvent through. Thirteen variants carry only the *fact* of a
// change and not the derived state it produced (TurnEnded's production/
// upkeep/movement reset, BattleResolved's troop losses, HeroRecruited's
// starting stacks, the rng-derived rates behind SettlementUpgradeStarted) --
// those return "resync" so the caller refetches rather than guesses. The
// trade/wagon/building kinds (TradeRouteUpdated/Removed, Wagons*,
// BuildingsPlaced, ResourcesTransferred) carry intentionally minimal
// payloads: their state effects are not payload-derivable either, so they
// land in the same resync arm (and are classified "ignore" for the sync
// layer in ENGINE_EVENT_SYNC_CLASS below). TradeRouteCreated is the one
// exception: applyTradeRouteCreated below reconstructs its state by
// targeted construction (the applyUnitsRecruited pattern) because the
// server derives route ids from a counter hydration never restores, so a
// reducer re-run could not reproduce the event's routeId -- the applier
// builds the route with the event's routeId verbatim instead.
export type EngineEventOutcome = "applied" | "noop" | "resync";

export interface ApplyEngineEventResult {
  state: GameState;
  outcome: EngineEventOutcome;
}

export type EngineEventSyncClass = "apply" | "resync" | "ignore";

// Declarative classification of every EngineEvent variant for the client
// sync layer (src/io/multiplayerSync.ts derives its admitted-kinds set from
// this). The Record<EngineEvent["type"], ...> annotation makes adding a new
// EngineEvent variant without classifying it here a compile error -- that is
// the point. This registry is data only: applyEngineEvent's switch below is
// NOT driven from it and keeps its own exhaustive default. "ignore" means
// the server may append the kind, but its state effects are not
// payload-derivable, so the client sync skips it and the effects arrive at
// the TurnEnded/poll resync boundary.
export const ENGINE_EVENT_SYNC_CLASS: Record<EngineEvent["type"], EngineEventSyncClass> = {
  HeroMoved: "apply",
  GoldTransferred: "apply",
  BankGoldMoved: "apply",
  TurnEnded: "resync",
  ResourcesTraded: "apply",
  BattleResolved: "resync",
  HeroRecruited: "resync",
  TownHallUpgradeStarted: "apply",
  AutoTradeToggled: "apply",
  StackReordered: "apply",
  SettlementCaptured: "apply",
  CharterStarted: "resync",
  BuildingUpgradeStarted: "resync",
  SettlementUpgradeStarted: "resync",
  CharterTravelAdvanced: "apply",
  BuildingsPlaced: "ignore",
  ResourcesTransferred: "ignore",
  WagonsAssigned: "ignore",
  WagonsBought: "ignore",
  TradeRouteCreated: "apply",
  TradeRouteUpdated: "ignore",
  TradeRouteRemoved: "ignore",
  UnitsRecruited: "apply",
  UnitsTransferred: "apply",
  SettlementBattleResolved: "resync",
};

function resync(state: GameState): ApplyEngineEventResult {
  return { state, outcome: "resync" };
}

// HeroMoved carries no movement cost, so movementRemaining is deliberately
// left untouched rather than invented. The drift is bounded: TurnEnded is a
// resync event, so every turn boundary refetches authoritative movement.
function applyHeroMoved(
  state: GameState,
  heroId: string,
  to: { q: number; r: number },
): ApplyEngineEventResult {
  const hero = state.heroes[heroId];
  if (!hero) return resync(state);
  if (hero.q === to.q && hero.r === to.r) return { state, outcome: "noop" };
  const moved: HeroState = {
    ...hero,
    q: to.q,
    r: to.r,
    previousQ: hero.q,
    previousR: hero.r,
    previousMovementRemaining: hero.movementRemaining,
    trail: [...(hero.trail ?? []), { q: to.q, r: to.r }],
  };
  return {
    state: { ...state, heroes: { ...state.heroes, [heroId]: moved } },
    outcome: "applied",
  };
}

// Same "carries only the fact of the move, not the cost" shape as
// applyHeroMoved above (see that function's own header comment) -- plus
// flipping the charter to "constructing" on arrival, since that's a fact
// this event's own payload (`to`) is enough to re-derive deterministically
// against the charter's already-known targetQ/targetR.
function applyCharterTravelAdvanced(
  state: GameState,
  heroId: string,
  charterId: string,
  to: { q: number; r: number },
): ApplyEngineEventResult {
  const hero = state.heroes[heroId];
  if (!hero) return resync(state);
  const charter = state.activeCharters.find((c) => c.id === charterId);
  if (!charter) return resync(state);
  if (hero.q === to.q && hero.r === to.r) return { state, outcome: "noop" };
  const arrived = to.q === charter.targetQ && to.r === charter.targetR;
  const moved: HeroState = {
    ...hero,
    q: to.q,
    r: to.r,
    previousQ: hero.q,
    previousR: hero.r,
    previousMovementRemaining: hero.movementRemaining,
    trail: [...(hero.trail ?? []), { q: to.q, r: to.r }],
    movementRemaining: arrived ? 0 : hero.movementRemaining,
  };
  const newCharters = arrived
    ? state.activeCharters.map((c) => (c.id === charterId ? { ...c, phase: "constructing" as const } : c))
    : state.activeCharters;
  return {
    state: { ...state, heroes: { ...state.heroes, [heroId]: moved }, activeCharters: newCharters },
    outcome: "applied",
  };
}

// UnitsRecruited carries the garrison delta (unitTypeId + count) but not the
// recruiting building or its per-unit cost, so the replay deposits the units
// only -- the settled gold/warehouse follow at the TurnEnded resync boundary
// (same bounded-drift policy as applyHeroMoved leaving movementRemaining).
function applyUnitsRecruited(
  state: GameState,
  settlementId: string,
  unitTypeId: string,
  count: number,
): ApplyEngineEventResult {
  const settlement = state.settlements[settlementId];
  if (!settlement) return resync(state);
  const deposit = depositIntoGarrison(settlementStacks(settlement), unitTypeId, count);
  if (!deposit.ok) return resync(state);
  return {
    state: {
      ...state,
      settlements: {
        ...state.settlements,
        [settlementId]: { ...settlement, stacks: deposit.stacks },
      },
      dirty: true,
    },
    outcome: "applied",
  };
}

// The event's fields map 1:1 onto transferUnits()'s opts minus toSlot (not
// carried, so a slot-targeted original replay deposits by the default rule --
// a slot-level placement drift the TurnEnded resync reconciles). Any
// rejection here means this client's state drifted from the server's
// pre-command state.
function applyUnitsTransferred(
  state: GameState,
  heroId: string,
  settlementId: string,
  direction: "toHero" | "toGarrison",
  unitTypeId: string,
  count: number,
): ApplyEngineEventResult {
  const result = transferUnits(state, {
    heroId,
    settlementId,
    direction,
    unitTypeId,
    count,
  });
  if (!result.ok) return resync(state);
  return { state: result.state, outcome: "applied" };
}

// TradeRouteCreated's payload is enough to rebuild the route record, but a
// reducer re-run is not an option: createTradeRoute() derives the route id
// from state.nextTradeRouteId, which hydration never restores (and the
// server re-hydrates per command), so the server's id is not reproducible
// from hydrated state. The applier therefore builds the route with the
// event's routeId verbatim (the applyUnitsRecruited targeted-construction
// pattern), debits the actor's unassigned wagons exactly as the reducer
// does, and bumps the counter monotonically past the event's id so a later
// reducer-created id cannot collide with it. An exact-tuple duplicate (id,
// endpoints, resource, wagons, no caravan yet) is what an already-applied
// event looks like -- the server can legitimately re-derive e.g. "route0"
// after a hydration reset, so the full-tuple match, not the id alone, is
// what makes the noop correct. Settlement ownership is not re-checked: the
// event is authoritative history.
function applyTradeRouteCreated(
  state: GameState,
  actor: PlayerSeat,
  routeId: TradeRouteId,
  fromSettlementId: SettlementId,
  toSettlementId: SettlementId,
  resource: WarehouseResource,
  wagons: number,
): ApplyEngineEventResult {
  const routes = state.tradeRoutes ?? [];
  const existing = routes.find((r) => r.id === routeId);
  if (existing) {
    if (
      existing.fromSettlementId === fromSettlementId &&
      existing.toSettlementId === toSettlementId &&
      existing.resource === resource &&
      existing.wagons === wagons &&
      existing.caravan === null
    ) {
      return { state, outcome: "noop" };
    }
  }
  if (!state.settlements[fromSettlementId] || !state.settlements[toSettlementId]) return resync(state);
  const player = state.players.find((p) => p.id === actor);
  if (!player) return resync(state);
  const unassigned = player.wagonsUnassigned ?? 0;
  if (!existing && wagons > unassigned) return resync(state);
  const route: TradeRouteState = {
    id: routeId,
    fromSettlementId,
    toSettlementId,
    resource,
    wagons,
    caravan: null,
  };
  const suffix = Number.parseInt(routeId.replace(/^route/, ""), 10);
  const derived = Number.isNaN(suffix) ? 0 : suffix + 1;
  return {
    state: {
      ...state,
      tradeRoutes: [...routes, route],
      nextTradeRouteId: Math.max(state.nextTradeRouteId ?? 0, derived),
      players: state.players.map((p) =>
        p.id === actor ? { ...p, wagonsUnassigned: unassigned - wagons } : p,
      ),
      dirty: true,
    },
    outcome: "applied",
  };
}

// BankGoldMoved carries everything the reducer needs (cell, amount,
// direction), so the replay is a straight re-run -- the GoldTransferred shape,
// with its same rejection handling: a move the treasury/pot can no longer
// cover (not_enough_gold / not_enough_in_pot) is what already-applied looks
// like from behind -> noop; every other rejection (no settlement, not a bank,
// pot at its cap) means this client has drifted and the caller refetches.
// Unlike GoldTransferred this is not UNAMBIGUOUS -- BankGold moves a partial
// amount, so a state that still affords the move replays it a second time. The
// drift is bounded and already the norm for the partial-payload kinds (see
// applyUnitsTransferred's header): the client advances its cursor past its own
// command's events (lastEventId), so its own row is never re-delivered, and
// TurnEnded's resync re-derives authoritative state at every week boundary.
function applyBankGoldMoved(
  state: GameState,
  settlementId: string,
  gx: number,
  gy: number,
  amount: number,
  direction: "deposit" | "withdraw",
): ApplyEngineEventResult {
  const result =
    direction === "deposit"
      ? depositIntoBank(state, settlementId, gx, gy, amount)
      : requestBankWithdrawal(state, settlementId, gx, gy, amount);
  if (!result.ok) {
    const emptyPurse =
      result.reason === "not_enough_gold" || result.reason === "not_enough_in_pot";
    return emptyPurse ? { state, outcome: "noop" } : resync(state);
  }
  return { state: result.state, outcome: "applied" };
}

export function applyEngineEvent(state: GameState, event: EngineEvent): ApplyEngineEventResult {
  switch (event.type) {
    case "HeroMoved":
      return applyHeroMoved(state, event.heroId, event.to);

    case "CharterTravelAdvanced":
      return applyCharterTravelAdvanced(state, event.heroId, event.charterId, event.to);

    case "GoldTransferred": {
      const result = transferGold(state, event.heroId, event.settlementId, event.direction);
      // An empty purse is what an already-applied transfer looks like from
      // behind; every other rejection means this client's state has drifted.
      if (!result.ok) {
        return result.reason === "nothing_to_deposit" || result.reason === "nothing_to_withdraw"
          ? { state, outcome: "noop" }
          : resync(state);
      }
      return { state: result.state, outcome: "applied" };
    }

    case "ResourcesTraded": {
      const result = tradeResources(
        state,
        event.fromSettlementId,
        event.toSettlementId,
        event.resource,
        event.amount,
      );
      if (!result.ok) return resync(state);
      return { state: result.state, outcome: "applied" };
    }

    case "AutoTradeToggled": {
      if (!state.settlements[event.settlementId]) return resync(state);
      const next = setAutoTrade(state, event.settlementId, event.autoTrade);
      return next === state ? { state, outcome: "noop" } : { state: next, outcome: "applied" };
    }

    case "StackReordered": {
      const result = reorderStack(state, event.heroId, event.fromIdx, event.toIdx);
      if (!result.ok) return resync(state);
      return { state: result.state, outcome: "applied" };
    }

    case "SettlementCaptured": {
      const settlement = state.settlements[event.settlementId];
      if (!settlement || !state.heroes[event.heroId]) return resync(state);
      if (settlement.ownerId === event.actor) return { state, outcome: "noop" };
      const result = captureSettlement(state, event.heroId, event.settlementId);
      if (!result.captured) return resync(state);
      return { state: result.state, outcome: "applied" };
    }

    case "TownHallUpgradeStarted": {
      const settlement = state.settlements[event.settlementId];
      if (!settlement) return resync(state);
      if (settlement.upgrade) return { state, outcome: "noop" };
      const result = startTownHallUpgrade(state, event.settlementId, event.targetLevel);
      if (!result.ok) return resync(state);
      return { state: result.state, outcome: "applied" };
    }

    case "BankGoldMoved":
      return applyBankGoldMoved(
        state,
        event.settlementId,
        event.gx,
        event.gy,
        event.amount,
        event.direction,
      );

    case "UnitsRecruited":
      return applyUnitsRecruited(state, event.settlementId, event.unitTypeId, event.count);

    case "UnitsTransferred":
      return applyUnitsTransferred(
        state,
        event.heroId,
        event.settlementId,
        event.direction,
        event.unitTypeId,
        event.count,
      );

    case "TradeRouteCreated":
      return applyTradeRouteCreated(
        state,
        event.actor,
        event.routeId,
        event.fromSettlementId,
        event.toSettlementId,
        event.resource,
        event.wagons,
      );

    // Listed per variant rather than swept into `default:` so a new
    // EngineEvent variant trips the exhaustiveness check below.
    case "TurnEnded":
    case "BattleResolved":
    case "HeroRecruited":
    case "CharterStarted":
    case "BuildingUpgradeStarted":
    case "SettlementUpgradeStarted":
    case "BuildingsPlaced":
    case "ResourcesTransferred":
    case "WagonsAssigned":
    case "WagonsBought":
    case "TradeRouteUpdated":
    case "TradeRouteRemoved":
    // SettlementBattleResolved carries only winner/captured -- the resulting
    // stacks, gold, and attacker relocation/removal are battle-internal and
    // not derivable from the payload, so the caller refetches.
    case "SettlementBattleResolved":
      return resync(state);

    default: {
      const exhaustive: never = event;
      void exhaustive;
      return resync(state);
    }
  }
}
