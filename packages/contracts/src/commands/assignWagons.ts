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
}
