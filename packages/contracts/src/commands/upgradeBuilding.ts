import type { BuildingUpgradeRequest } from "../gameState";
import type { PlayerSeat, SettlementId } from "../ids";

// Discriminated-union command for starting a building-level upgrade
// (plan/2026-08-17-issue-88-remaining-command-ports.md, Track 1).
// Named UpgradeBuilding, not BuildStructure -- the deferral comment this
// closes (commands/index.ts) used BuildStructure, but that implies new
// construction. No such reducer exists: buildings come from citySpots at
// settlement creation, and @heroes/engine's startBuildingUpgrade() only
// moves an existing building level 1->3. BuildStructure stays reserved for
// real new-construction, if that's ever built.
export interface UpgradeBuildingCommand {
  kind: "UpgradeBuilding";
  gameName: string;
  actor: PlayerSeat;
  settlementId: SettlementId;
  requests: BuildingUpgradeRequest[];
}
