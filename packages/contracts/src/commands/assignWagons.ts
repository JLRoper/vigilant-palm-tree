import type { HeroId, PlayerSeat } from "../ids";

// Moves wagons between the player's unassigned pool and a hero. A positive
// delta assigns (pool → hero), a negative delta returns wagons to the pool.
// Wagons locked into trade routes are not touchable here.
export interface AssignWagonsCommand {
  kind: "AssignWagons";
  gameName: string;
  actor: PlayerSeat;
  heroId: HeroId;
  delta: number;
  // Which slot the delta moves (Phase 1 treasury-wagons split): "cargo"
  // (default, army wagons <-> wagonsUnassigned pool, resources cap) or
  // "treasury" (treasury carts <-> treasuryWagonsUnassigned pool, gold
  // cap). Optional so pre-split senders keep the cargo behavior.
  slot?: "cargo" | "treasury";
}
