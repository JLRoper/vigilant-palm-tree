import type { PlayerSeat, SettlementId } from "../ids";

// Discriminated-union command for starting a town-hall upgrade
// (plan/2026-08-16-phase-3-parallel-dev-plan.md, Track 3.A Week 3+).
// Never had a dedicated route -- src/state/turnController.ts's
// startTownHallUpgrade() only ever ran @heroes/engine's
// startTownHallUpgrade() against local client state. The *completion*
// side (advanceSettlementUpgrades on round wrap) is already
// server-authoritative via server/app/turnService.ts; this closes the
// matching gap on the *start* side.
export interface UpgradeTownHallCommand {
  kind: "UpgradeTownHall";
  gameName: string;
  actor: PlayerSeat;
  settlementId: SettlementId;
  targetLevel: 2 | 3;
}
