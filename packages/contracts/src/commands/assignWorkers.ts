import type { PlayerSeat, SettlementId } from "../ids";

// Set one building's explicit workforce size (0 = shut down). Absent
// BuildingDef.workers means legacy auto-staffing; this command writes the
// explicit number from the first assignment onward.
export interface AssignWorkersCommand {
  kind: "AssignWorkers";
  gameName: string;
  actor: PlayerSeat;
  settlementId: SettlementId;
  gx: number;
  gy: number;
  workers: number;
  source?: { gx: number; gy: number };
  district?: { q: number; r: number };
}