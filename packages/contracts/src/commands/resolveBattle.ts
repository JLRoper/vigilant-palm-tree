import type { HeroId, PlayerSeat } from "../ids";

// Discriminated-union command for the port of server/routes.ts's
// /resolve-battle endpoint (plan/2026-08-16-phase-3-parallel-dev-plan.md,
// Track 3.A Week 3+). Unlike the old route, this does NOT carry a
// client-computed GameState or a unit-type catalog -- the server loads
// its own authoritative row and its own unit_types catalog (see
// server/app/commandHandler.ts's createLiveCommandDeps()), and derives
// "is defenderId actually adjacent to attackerId" itself (via
// @heroes/engine's detectAdjacentEnemy) instead of trusting the pairing
// the client asks it to resolve.
export interface ResolveBattleCommand {
  kind: "ResolveBattle";
  gameName: string;
  actor: PlayerSeat;
  attackerId: HeroId;
  defenderId: HeroId;
}
