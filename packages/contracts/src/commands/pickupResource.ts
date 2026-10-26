import type { HeroId, PlayerSeat } from "../ids";

// A hero picks the resources off the resource tile it is STANDING ON up
// (docs' M-MAJOR-1: no hero deposit-pickup verb existed). The payload names
// the hero and the tile; how much moves is the engine's call
// (hero/pickupResource.ts: min(remaining, the hero's remaining cargo room)),
// so a client cannot ask for an amount -- a partial pickup is the success
// case, and what does not fit stays on the floor.
export interface PickupResourceCommand {
  kind: "PickupResource";
  gameName: string;
  actor: PlayerSeat;
  heroId: HeroId;
  q: number;
  r: number;
}
