import type { MoveHeroCommand } from "./moveHero";
import type { TransferGoldCommand } from "./transferGold";

export * from "./moveHero";
export * from "./transferGold";

// Grows with each command port. Week 1 of Phase 3 Track 3.A ships exactly
// these two (plan/2026-08-16-phase-3-parallel-dev-plan.md's port order).
export type Command = MoveHeroCommand | TransferGoldCommand;
