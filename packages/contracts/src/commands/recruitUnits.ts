import type { PlayerSeat, SettlementId } from "../ids";
import type { BuildingKind } from "../buildings";

// Buy units from a settlement building's roster; recruits land in the
// settlement garrison (plan/1790560842471-unit-recruitment-garrison-plan.md §1).
export interface RecruitUnitsCommand {
  kind: "RecruitUnits";
  gameName: string;
  actor: PlayerSeat;
  settlementId: SettlementId;
  buildingKind: BuildingKind;
  gx: number;
  gy: number;
  unitTypeId: string;
  count: number;
}
