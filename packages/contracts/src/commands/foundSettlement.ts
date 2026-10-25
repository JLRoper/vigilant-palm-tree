import type { HeroId, PlayerSeat } from "../ids";

// The settlers mode's founding command (SETTLERS-PLAN.md §4 W1/W3). One
// entity founds one settlement, WHERE IT STANDS: the mode has no
// tile-selection step, so the hex is optional on the wire and the server
// derives it from the founder's own row.
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
  /**
   * The target hex. ABSENT is the mode's own answer: founding happens in
   * place, on the hex the founder stands on, so a client sends only
   * `founderId` and server/app/commandHandler.ts derives (q, r) from the
   * founder's row before handing the engine the integers it requires. A hex
   * may still be sent -- the AI driver sends the one its brain chose, and a
   * replay sends what was recorded -- but the engine refuses any hex the
   * founder is not standing on (`founder_not_at_tile`), so accepting one can
   * never widen the rule.
   *
   * Both or neither: a lone `q` is a malformed payload (server/http/routes/
   * commands.ts), not a half-derived hex.
   */
  q?: number;
  r?: number;
}
