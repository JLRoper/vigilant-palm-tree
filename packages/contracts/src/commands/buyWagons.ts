import type { PlayerSeat, SettlementId } from "../ids";

// Buys `count` wagons into the player's unassigned pool, paid from the
// settlement's treasury/warehouse (docs/wagons-stockpiles-trade-routes-plan.md
// §5.1: 200g + 5 wood each).
export interface BuyWagonsCommand {
  kind: "BuyWagons";
  gameName: string;
  actor: PlayerSeat;
  settlementId: SettlementId;
  count: number;
}
