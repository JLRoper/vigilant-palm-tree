import type { Axial } from "../geometry";
import type { HeroId, PlayerSeat } from "../ids";

// Issue #152 (R5 remainder): stepTravelCharter() (packages/engine/src/
// charter/travel.ts) was the last piece of the charter lifecycle still
// purely client-local -- StartCharter (#105) and the EndTurn/advanceCharters
// countdown were already server-authoritative. One command per hex-step,
// firing once per src/state/turnController.ts's advanceAutoTravel() loop
// iteration -- mirrors MoveHeroCommand's shape (including its fromTile
// staleness guard) rather than carrying the whole intended path, matching
// the established onHumanMove precedent instead of inventing a second
// command shape for the same "move a hero one hex" concept.
export interface AdvanceCharterTravelCommand {
  kind: "AdvanceCharterTravel";
  gameName: string;
  actor: PlayerSeat;
  heroId: HeroId;
  // Staleness guard, same purpose as MoveHeroCommand's: reject a step
  // computed from a hero position that's since changed underneath it.
  fromTile: Axial;
  toTile: Axial;
  // Cost is NOT trusted -- server/app/commandHandler.ts's AdvanceCharterTravel
  // case re-derives it from a GameMap reconstructed from row.seed/
  // row.map_size, the same trust boundary StartCharter's target-hex check
  // uses. Carried here only so a rejected command's reason can distinguish
  // "your cost was wrong" from other failures during development/debugging;
  // the server never reads it.
  cost: number;
}
