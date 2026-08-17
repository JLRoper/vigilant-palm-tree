import type { HeroId, PlayerSeat, SettlementId } from "../ids";

// Discriminated-union command for a hero capturing an unowned/enemy
// settlement it's standing on (plan/2026-08-16-phase-3-parallel-dev-plan.md,
// Track 3.A Week 3+). This is the largest concrete gap this port's audit
// found: @heroes/engine's captureSettlement() never compares the hero's
// position to the settlement's at all -- that guarantee exists purely
// because its only existing caller, src/state/turnController.ts's
// tryCaptureAt(), pre-filters to settlements at the hero's own
// just-moved-to tile before ever calling it. A command shaped as just
// {heroId, settlementId} calling the engine function as-is would let a
// player capture any enemy settlement anywhere on the map regardless of
// hero position, so commandHandler.ts's new case adds an explicit
// hero.q === settlement.q && hero.r === settlement.r check of its own.
export interface CaptureSettlementCommand {
  kind: "CaptureSettlement";
  gameName: string;
  actor: PlayerSeat;
  heroId: HeroId;
  settlementId: SettlementId;
}
