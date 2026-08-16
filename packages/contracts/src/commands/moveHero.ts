import type { HeroId, PlayerSeat } from "../ids";

export interface MoveHeroCommand {
  kind: "MoveHero";
  actor: PlayerSeat;
  heroId: HeroId;
  // Staleness guard: the client's believed current position. startMove
  // itself doesn't check this (it just moves the hero from wherever the
  // server thinks it is) -- the old spend_movement route rejected a move
  // whose fromTile didn't match server state, protecting against a client
  // computing cost/path from a position that's since changed underneath it.
  fromTile: { q: number; r: number };
  toTile: { q: number; r: number };
  cost: number;
  trailExtension?: { q: number; r: number }[];
}
