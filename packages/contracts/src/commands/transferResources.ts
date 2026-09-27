import type { HeroId, PlayerSeat, SettlementId } from "../ids";
import type { WarehouseResource } from "../resources";

// Hero cargo load/unload at a same-hex owned settlement
// (docs/wagons-stockpiles-trade-routes-plan.md §6). Amounts are per
// resource, integers, zero = "none of this one".
export interface TransferResourcesCommand {
  kind: "TransferResources";
  gameName: string;
  actor: PlayerSeat;
  heroId: HeroId;
  settlementId: SettlementId;
  direction: "load" | "unload";
  amounts: Partial<Record<WarehouseResource, number>>;
}
