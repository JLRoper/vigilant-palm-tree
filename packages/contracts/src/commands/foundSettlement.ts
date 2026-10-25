import type { HeroId, PlayerSeat } from "../ids";

// The settlers mode's founding command (SETTLERS-PLAN.md §4 W1/W3). One
// entity founds one settlement, where that entity is standing.
//
// The payload is deliberately bare: the engine derives everything else -- the
// settlement's id (from state.nextSettlementId, the StartCharter allocation
// rule), its name, its warehouse stock and its city spots -- from the
// founder's own settlers stream, so a client cannot send a settlement into
// existence with an invented name or stockpile. Contrast StartCharter, whose
// payload carries a client-chosen name because charters are named by the
// player; a settlers wagon is not.
export interface FoundSettlementCommand {
  kind: "FoundSettlement";
  gameName: string;
  actor: PlayerSeat;
  /**
   * The founding entity (the seat's covered wagon), by id
   * (@heroes/contracts coveredWagonIdFor). Also the id its start was placed
   * with, so settlersStreamRng(seed, founderId) replays it.
   */
  founderId: HeroId;
  /** The target hex; founding is refused unless the founder stands on it. */
  q: number;
  r: number;
}
