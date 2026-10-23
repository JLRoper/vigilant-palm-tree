import type { HeroId, PlayerSeat } from "../ids";
import type { WarehouseResource } from "../resources";

// One side's contribution to a field trade between two heroes of the same
// seat: gold out of the purse, warehouse resources out of the cargo wagons,
// and whole unit stacks out of the army. Every field is optional and an
// absent field means "nothing of this kind"; amounts are integers and zero
// is the same as absent. `units` entries are (unitTypeId, count) pairs --
// duplicate types are summed before the move.
export interface HeroTradeOffer {
  gold?: number;
  resources?: Partial<Record<WarehouseResource, number>>;
  units?: { unitTypeId: string; count: number }[];
}

// A two-sided swap between two ADJACENT heroes owned by the acting seat.
// `give` leaves `heroId`, `take` leaves `partnerId`; both move in one
// command so the trade cannot half-apply (a rejected side moves nothing).
export interface HeroTradeRequest {
  heroId: HeroId;
  partnerId: HeroId;
  give: HeroTradeOffer;
  take: HeroTradeOffer;
}

export interface TradeHeroesCommand extends HeroTradeRequest {
  kind: "TradeHeroes";
  gameName: string;
  actor: PlayerSeat;
}
