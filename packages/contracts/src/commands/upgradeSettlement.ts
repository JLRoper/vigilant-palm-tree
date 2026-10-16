import type { PlayerSeat, SettlementId } from "../ids";

// Discriminated-union command for starting a settlement-level upgrade
// (plan/2026-08-17-issue-88-remaining-command-ports.md, Track 2).
// targetLevel is NOT client-supplied -- the server derives it as
// settlement.level + 1 (commandHandler.ts's UpgradeSettlement case), same
// reasoning StartCharter uses for not trusting client-computed ids.
//
// The population requirement is likewise server-owned: the engine constant
// UPGRADE_POPULATION_GATE (packages/engine/src/settlement/upgradeSettlement.ts)
// replaced the former client-trusted upgradePopulationGate field (issue
// #153) -- that field rode a user-adjustable settings slider and 0 was a
// wire-valid "no requirement" bypass.
export interface UpgradeSettlementCommand {
  kind: "UpgradeSettlement";
  gameName: string;
  actor: PlayerSeat;
  settlementId: SettlementId;
}
