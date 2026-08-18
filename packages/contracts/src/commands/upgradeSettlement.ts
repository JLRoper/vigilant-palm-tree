import type { PlayerSeat, SettlementId } from "../ids";

// Discriminated-union command for starting a settlement-level upgrade
// (plan/2026-08-17-issue-88-remaining-command-ports.md, Track 2).
// targetLevel is NOT client-supplied -- the server derives it as
// settlement.level + 1 (commandHandler.ts's UpgradeSettlement case), same
// reasoning StartCharter uses for not trusting client-computed ids.
//
// upgradePopulationGate IS trusted from the client for now -- this is a
// deliberate, temporary exception (see the plan doc's "Resolved decisions"
// section). The gate backs a user-adjustable settings slider
// (src/state/settings.ts) that exists purely for testing convenience today;
// spoofing it isn't a current concern. Once that slider is hidden behind a
// wall later in development, this field should be replaced by a value
// preset server-side at game creation instead of trusting the client.
export interface UpgradeSettlementCommand {
  kind: "UpgradeSettlement";
  gameName: string;
  actor: PlayerSeat;
  settlementId: SettlementId;
  upgradePopulationGate: number;
}
