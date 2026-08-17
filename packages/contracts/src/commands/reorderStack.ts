import type { HeroId, PlayerSeat } from "../ids";

// Discriminated-union command for swapping two of a hero's army-stack
// slots (plan/2026-08-16-phase-3-parallel-dev-plan.md, Track 3.A Week
// 3+). @heroes/engine's reorderStack() has no ownership check at all,
// and neither does its only existing caller
// (src/state/turnController.ts) -- commandHandler.ts's new case adds
// hero.ownerId !== command.actor from scratch here, with no existing
// code in the repo to model it on directly.
export interface ReorderStackCommand {
  kind: "ReorderStack";
  gameName: string;
  actor: PlayerSeat;
  heroId: HeroId;
  fromIdx: number;
  toIdx: number;
}
