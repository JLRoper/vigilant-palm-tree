import type { PlayerSeat, SettlementId } from "../ids";
import type { WarehouseResource } from "../resources";

// Creates a trade route between two same-owner settlements, committing
// `wagons` from the player's unassigned pool (docs/wagons-stockpiles-trade-
// routes-plan.md §5.2). The caravan starts loading at `fromSettlementId`
// on the next round wrap.
export interface CreateTradeRouteCommand {
  kind: "CreateTradeRoute";
  gameName: string;
  actor: PlayerSeat;
  fromSettlementId: SettlementId;
  toSettlementId: SettlementId;
  resource: WarehouseResource;
  wagons: number;
}
