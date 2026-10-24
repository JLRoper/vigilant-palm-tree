import type { BuildingKind } from "../buildings";
import type { PlayerSeat, SettlementId } from "../ids";

// Removes one building (main city or district) from a settlement the actor
// owns (faction-construction plan, section 5). Separate from PlaceBuildings'
// own cart-based removal (which refunds 50% of the placement cost): this
// command targets a single building and refunds nothing. Shares the
// per-settlement, per-turn construction cap with PlaceBuildings
// (SettlementState.constructionActionUsedThisTurn).
export interface DemolishBuildingCommand {
  kind: "DemolishBuilding";
  gameName: string;
  actor: PlayerSeat;
  settlementId: SettlementId;
  gx: number;
  gy: number;
  buildingKind: BuildingKind;
  district?: { q: number; r: number };
}
