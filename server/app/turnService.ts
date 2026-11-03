import { applyEndOfTurnDetailed, endTurn, advanceRound, endpointOwner, routeOwnerId, sameCaravanRecord } from "@heroes/engine";
import type { EndpointRecords, GameMap, UnitType } from "@heroes/engine";
import type { AutoTradeTransfer, CaravanState, GameState, TradeRouteId } from "@heroes/contracts";

// Round advances and weekly-upkeep triggers, per
// plan/2026-08-16-phase-3-parallel-dev-plan.md's Track 3.A Week 2 port of
// server/routes.ts's /end-turn endpoint -- "the biggest single behavior fix
// in this phase," since none of advanceCharters/advanceSettlementUpgrades/
// population growth currently run server-side independent of client
// cooperation. Called from server/app/commandHandler.ts's EndTurn case;
// kept here (not inline in the switch) because it's a multi-step pipeline,
// not a single reducer call like MoveHero/TransferGold's cases.
//
// All three steps below are @heroes/engine's own already-tested reducers,
// composed the same way src/state/turnController.ts's endCurrentTurn() used
// to compose them client-side -- this doesn't reimplement any of that
// logic, just moves the composition server-side so it runs against the
// server's authoritative row instead of a client-submitted GameState.
//
// AdvanceCharter status (plan/2026-08-17-consolidated-phase-1-5-track-map.md
// §5.1 R5): advanceRound() internally calls advanceCharters(), which
// decrements state.activeCharters' daysRemaining and founds the real
// settlement when a charter's "constructing" phase completes. That is now
// real server-side behavior for any game with charters (the schema gap is
// closed -- server/migrations/009_granular_entities.sql's `charters` table
// -- and commandHandler.ts's EndTurn case dual-writes finalState.
// activeCharters into charterRepo right after this call returns). The one
// piece still NOT server-authoritative is the hex-by-hex *travel* a
// "traveling"-phase charter's hero takes toward its target
// (stepTravelCharter(), driven purely client-side today by
// src/state/turnController.ts's advanceAutoTravel() loop) -- deliberately
// out of scope for this port; see that plan doc section for why.
export interface EndTurnOutcome {
  state: GameState;
  wrapped: boolean;
  transfers: AutoTradeTransfer[];
}

const DEFAULT_GROWTH_RATE = 0.1;
const MIN_GROWTH_RATE = 0.01;
const MAX_GROWTH_RATE = 0.5;

// Mirrors src/state/settings.ts's clampGrowthRate -- duplicated rather than
// imported since that module lives under src/ (client), which server/app/*
// cannot import (dependency-cruiser's no-server-from-src rule only exempts
// server/routes.ts). Same bounds, kept in sync by hand; small enough that
// this is cheaper than inventing a shared home for one clamp function.
export function clampGrowthRate(rate: number | undefined): number {
  if (rate === undefined || !Number.isFinite(rate)) return DEFAULT_GROWTH_RATE;
  return Math.max(MIN_GROWTH_RATE, Math.min(MAX_GROWTH_RATE, rate));
}

// `unitTypes` is the already-loaded EngineCtx catalog, threaded through to the
// weekly upkeep charge: per-unit upkeepGold/upkeepFood is the rule, and the
// desertion draw must replay identically on the server (it's the authority), so
// the catalog cannot be omitted on this path.
//
// `legacyAutoTrade` is the game-level instant auto-trade gate (2026-10-02),
// resolved by the EndTurn command case from the row's lobby jsonb
// (`lobby.legacyAutoTrade ?? true` -- absent means ON, so pre-flag saves are
// untouched; new games are written with false). A boolean parameter, not a
// global: the reducer stays replayable from any context that names the flag.
export function runEndTurn(
  state: GameState,
  growthRate: number,
  map: GameMap | null = null,
  unitTypes?: Record<string, UnitType>,
  legacyAutoTrade: boolean = true,
): EndTurnOutcome {
  const afterEot = applyEndOfTurnDetailed(state, { legacyAutoTrade });
  const afterPhase = endTurn(afterEot.state);
  if (afterPhase.phase.kind !== "ROUND_END") {
    return { state: afterPhase, wrapped: false, transfers: afterEot.transfers };
  }
  const final = advanceRound(afterPhase, growthRate, map, unitTypes);
  return { state: final, wrapped: true, transfers: afterEot.transfers };
}

// Trade routes present before the EndTurn pipeline but gone after it. The
// only remover inside that pipeline is the weekly caravan-maintenance
// desertion (applyCaravanUpkeep in advanceRound — advanceTradeRoutes never
// deletes routes, and neither does applyEndOfTurnDetailed/endTurn), so this
// set difference is exactly the routes whose last wagons deserted and is how
// the EndTurn command case derives the TradeRouteRemoved events it appends.
export function removedTradeRouteIds(before: GameState, after: GameState): TradeRouteId[] {
  const afterIds = new Set((after.tradeRoutes ?? []).map((r) => r.id));
  return (before.tradeRoutes ?? [])
    .filter((r) => !afterIds.has(r.id))
    .map((r) => r.id);
}

/** One route's caravan change over this EndTurn pipeline — the material for one CaravanAdvanced row. */
export interface CaravanAdvance {
  routeId: TradeRouteId;
  /** The route's caravan after the wrap, verbatim (null = home and unloaded). */
  caravan: CaravanState | null;
  /** Units (of the route payload's kind) the wrap loaded out of the FROM endpoint. */
  loaded: number;
  /** Units the wrap landed on the TO endpoint — 0 for a return, a reroute or a turnaround with cargo aboard. */
  delivered: number;
}

// The caravan records this EndTurn pipeline actually moved, per route, for
// the EndTurn command case to append as CaravanAdvanced rows — the same
// set-difference derivation as removedTradeRouteIds above, and the reason
// advanceTradeRoutes needs no event sink of its own: the movement pass stays
// a pure reducer and the server, which owns the log, derives what to report.
// A wrap that moved nothing yields no rows, and routes are never ADDED inside
// the pipeline (createTradeRoute is a command), so a route missing from
// `after` was removed by desertion and is skipped here — its own
// TradeRouteRemoved row already reports that.
//
// `loaded` is exactly the departure wrap's cargo: a caravan is created from
// null only by advanceTradeRoutes's load branch, which returns with
// `cargo: load, pathIndex: 0` and walks nothing that wrap.
//
// `delivered` is the cargo that left the caravan on the OUTBOUND leg while
// the destination was still deliverable — present, and owned by the route
// owner, in the after-state. That check is what keeps it exact: in
// advanceTradeRoutes a toDestination cargo only ever shrinks by delivering,
// and the two ways an outbound leg ends with its cargo intact (a dead hero
// destination, a destination that changed hands) both flip the cart to
// toHome with the cargo aboard. Without it, a death-return that also reached
// home in the same wrap would read as a delivery of the whole load
// (`{toDestination, cargo 50}` -> null). A homeward leg never reports a
// delivery: reaching the origin deposits a RETURN, and a lost origin
// reroutes to the owner's nearest settlement — a target this route-level
// comparison cannot name, which is why the endpoint stores themselves are
// left to the TurnEnded resync boundary.
export function caravanAdvances(before: GameState, after: GameState): CaravanAdvance[] {
  const routesAfter = new Map((after.tradeRoutes ?? []).map((r) => [r.id, r]));
  const records: EndpointRecords = { settlements: after.settlements, heroes: after.heroes };
  const advances: CaravanAdvance[] = [];
  for (const route of before.tradeRoutes ?? []) {
    const next = routesAfter.get(route.id);
    if (!next) continue;
    const was = route.caravan ?? null;
    const now = next.caravan ?? null;
    if (sameCaravanRecord(was, now)) continue;
    const loaded = was === null ? (now?.cargo ?? 0) : 0;
    const outboundDelivery = was?.phase === "toDestination" && endpointOwner(next.to, records) === routeOwnerId(next, records);
    const delivered = outboundDelivery ? was.cargo - (now?.cargo ?? 0) : 0;
    advances.push({ routeId: route.id, caravan: now, loaded, delivered });
  }
  return advances;
}
