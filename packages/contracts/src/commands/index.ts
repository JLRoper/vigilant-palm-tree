import type { MoveHeroCommand } from "./moveHero";
import type { TransferGoldCommand } from "./transferGold";
import type { EndTurnCommand } from "./endTurn";

export * from "./moveHero";
export * from "./transferGold";
export * from "./endTurn";

// Grows with each command port. Week 1 of Phase 3 Track 3.A shipped
// MoveHero/TransferGold; EndTurn follows in Week 2
// (plan/2026-08-16-phase-3-parallel-dev-plan.md's port order).
export type Command = MoveHeroCommand | TransferGoldCommand | EndTurnCommand;
