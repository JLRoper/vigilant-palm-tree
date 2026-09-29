import type { HeroBattleVerdict } from "../events/engineEvent";
import type { HeroId, PlayerSeat } from "../ids";
import type { HeroState } from "../gameState";

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

// Post-battle hero pair (hero-outcomes plan W1). Both heroes are OPTIONAL:
// a defeated side's hero row is deleted (state.heroes + player.heroIds), so
// the result only carries the heroes that survived the battle. Verdicts ride
// alongside so the client can message "slain" / "retreated to <name>" /
// "surrendered" without re-deriving them (retreat vs surrender are
// indistinguishable in the event's retreated_hero outcome).
export interface ResolveBattleResult {
  attackerHero?: HeroState;
  defenderHero?: HeroState;
  attackerVerdict?: HeroBattleVerdict;
  defenderVerdict?: HeroBattleVerdict;
}
