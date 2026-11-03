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
  // The seat the REQUESTING CLIENT is playing (playthrough round 2b, F1).
  // `actor` names the seat whose turn ENDS; this names the seat that ASKS --
  // and the two legitimately differ in exactly one place: on a browser-driven
  // game seat 0's client ends an AI seat's turn for it (the AI turn is driven
  // locally, plan/2026-09-29-ai-enemies.md D3). Everywhere else they must
  // match, and the route enforces it: the turn-ownership guard alone is
  // satisfied by naming the active seat, so a seat-0 client could end seat 1's
  // turn by pretending to be it. Required over HTTP (parseCommand); absent
  // only on in-process callers (dropPolicy's server-side skip, the AI driver),
  // which are already the server acting on the seat's own behalf.
  clientSeat?: PlayerSeat | null;
  // Client's locally configured population-growth dial
  // (src/state/settings.ts's populationGrowthRate). A pacing/balance
  // preference, not an integrity-sensitive value like a hero's gold or
  // troop count, so it rides along on the command the same way MoveHero's
  // cost/trail do. Server clamps defensively and falls back to the
  // engine's own default if omitted or out of range.
  growthRate?: number;
}
