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
  // Which pool the wagons land in (Phase 1 treasury-wagons split): "cargo"
  // (default, wagonsOwned/wagonsUnassigned) or "treasury"
  // (treasuryWagonsOwned/treasuryWagonsUnassigned). Same cost either way.
  // Optional so pre-split senders keep the cargo behavior. NOTE: the brief's
  // locked field name was `kind`, but `kind` is this union's discriminator
  // ("BuyWagons") -- a duplicate identifier is illegal in TS and the wire
  // body's `kind` must stay "BuyWagons" for the route to match -- so the
  // slot discriminator is named `slot`, matching AssignWagons and both
  // wagon event payloads.
  slot?: "cargo" | "treasury";
}
