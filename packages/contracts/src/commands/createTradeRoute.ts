import type { TradeRouteEndpoint, TradeRoutePayload } from "../gameState";
import type { PlayerSeat } from "../ids";

// Creates a trade route between two same-owner endpoints (settlement or
// hero, any direction), committing `wagons` from the player's unassigned
// pool (docs/wagons-stockpiles-trade-routes-plan.md §5.2). `payload` picks
// the caravan type: a resource payload is a cargo caravan, "gold" is a
// treasure caravan. The caravan starts loading at `from`'s tile on the
// next round wrap.
export interface CreateTradeRouteCommand {
  kind: "CreateTradeRoute";
  gameName: string;
  actor: PlayerSeat;
  from: TradeRouteEndpoint;
  to: TradeRouteEndpoint;
  payload: TradeRoutePayload;
  wagons: number;
}
