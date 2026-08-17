import type { PlayerSeat, SettlementId } from "../ids";
import type { WarehouseResource } from "../resources";

// Discriminated-union command for the port of server/routes.ts's /trade
// endpoint (plan/2026-08-16-phase-3-parallel-dev-plan.md, Track 3.A Week
// 3+ -- "cheapest remaining... already partially wired"). Unlike the old
// route, ownership is re-derived server-side from `actor` +
// commandHandler.ts's own explicit from/to-settlement-ownership check --
// see that file's TradeResources case for why the engine's own
// tradeResources() (which only requires from.ownerId === to.ownerId, not
// "...=== the active player") isn't sufficient on its own.
export interface TradeResourcesCommand {
  kind: "TradeResources";
  gameName: string;
  actor: PlayerSeat;
  fromSettlementId: SettlementId;
  toSettlementId: SettlementId;
  // "food" is deliberately excluded, matching the old route's own
  // VALID_RESOURCES list -- manual settlement-to-settlement food trading
  // was never exposed here (auto-trade is the only thing that moves food).
  resource: Exclude<WarehouseResource, "food">;
  amount: number;
}
