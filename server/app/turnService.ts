import { applyEndOfTurnDetailed, endTurn, advanceRound } from "@heroes/engine";
import type { AutoTradeTransfer, GameState } from "@heroes/contracts";

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
// Known limitation, not an oversight: advanceRound() internally calls
// advanceCharters(), which operates on state.activeCharters. There is no
// `charters`/`active_charters` column anywhere in server/schema.sql or
// server/migrations/, and packages/engine/src/hydrate.ts's
// hydrateGameState() always defaults activeCharters to [] because of that
// (see its own `?? []` fallback). So this call is safe (it no-ops on an
// empty array) but it does NOT actually close the charter-advancement gap
// -- charters a player has in flight still only advance/complete via the
// client's own local simulation, same as before this port. Closing that
// for real needs a schema addition, which
// plan/2026-08-16-phase-3-parallel-dev-plan.md explicitly rules out for
// Phase 3 ("no schema changes... that's Phase 4"). Flagging here rather
// than silently skipping the call, since calling the real advanceRound()
// (instead of a hand-picked subset of it) is the architecturally correct
// choice regardless -- it's what will pick up charter advancement for free
// the day a charters column exists, with zero changes needed here.
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

export function runEndTurn(state: GameState, growthRate: number): EndTurnOutcome {
  const afterEot = applyEndOfTurnDetailed(state);
  const afterPhase = endTurn(afterEot.state);
  if (afterPhase.phase.kind !== "ROUND_END") {
    return { state: afterPhase, wrapped: false, transfers: afterEot.transfers };
  }
  const final = advanceRound(afterPhase, growthRate);
  return { state: final, wrapped: true, transfers: afterEot.transfers };
}
