import type { TradeRouteId } from "../gameState";
import type { PlayerSeat } from "../ids";
import type { WarehouseResource } from "../resources";

// Changes an existing trade route: adjust the assigned wagon count
// (positive assigns from the unassigned pool, negative returns wagons),
// switch the carried resource, or remove the route entirely (wagons return
// to the pool; carried cargo is lost).
export interface UpdateTradeRouteCommand {
  kind: "UpdateTradeRoute";
  gameName: string;
  actor: PlayerSeat;
  routeId: TradeRouteId;
  resource?: WarehouseResource;
  wagonsDelta?: number;
  remove?: boolean;
}
