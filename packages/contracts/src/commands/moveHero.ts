import type { Axial } from "../geometry";
import type { HeroId, PlayerSeat } from "../ids";

// Discriminated-union command for the port of server/routes.ts's
// spend_movement action (plan/2026-08-16-phase-3-parallel-dev-plan.md,
// Track 3.A Week 1). `actor` is self-describing (see @heroes/engine's
// ctx.ts for why it isn't on EngineCtx instead) so the command stays
// replay-safe.
export interface MoveHeroCommand {
  kind: "MoveHero";
  gameName: string;
  actor: PlayerSeat;
  heroId: HeroId;
  toTile: Axial;
  cost: number;
  // Ordered list of every tile the hero passes through, matching
  // @heroes/engine's startMove trailExtension parameter.
  trail?: Axial[];
}
