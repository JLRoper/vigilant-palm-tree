import type { TradeRouteId } from "../gameState";
import type { PlayerSeat } from "../ids";
import type { WarehouseResource } from "../resources";

// Changes an existing trade route: adjust the assigned wagon count
// (positive assigns from the unassigned pool, negative returns wagons),
// switch the carried resource (a treasure/gold route becomes a cargo
// route for that resource; there is no update path back to gold -- remove
// and re-create), or remove the route entirely (wagons return to the
// pool; carried cargo is lost). Endpoints are immutable on update, by
// design: a route that needs different endpoints is a different route.
export interface UpdateTradeRouteCommand {
  kind: "UpdateTradeRoute";
  gameName: string;
  actor: PlayerSeat;
  routeId: TradeRouteId;
  resource?: WarehouseResource;
  wagonsDelta?: number;
  remove?: boolean;
}
