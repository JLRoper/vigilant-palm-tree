import type { PlayerSeat } from "../ids";

// Discriminated-union command for the port of server/routes.ts's
// /end-turn endpoint (plan/2026-08-16-phase-3-parallel-dev-plan.md, Track
// 3.A Week 2 -- "the biggest single behavior fix in this phase"). Unlike
// the old route, this command does NOT carry a client-computed GameState:
// the old route trusted incomingState.heroes/players wholesale and only
// re-ran the per-day production/auto-trade/consumption pipeline against
// them. This command carries just the actor; the server loads its own
// authoritative row and runs the full pipeline itself.
export interface EndTurnCommand {
  kind: "EndTurn";
  gameName: string;
  actor: PlayerSeat;
  // Client's locally configured population-growth dial
  // (src/state/settings.ts's populationGrowthRate). A pacing/balance
  // preference, not an integrity-sensitive value like a hero's gold or
  // troop count, so it rides along on the command the same way MoveHero's
  // cost/trail do. Server clamps defensively and falls back to the
  // engine's own default if omitted or out of range.
  growthRate?: number;
}
