import type { HeroId, PlayerSeat } from "../ids";

// settlementId/charterId/resourceRates/foundedOnResource/citySpots are
// server-recomputed in commandHandler.ts's StartCharter case, not
// client-supplied (mirrors resolveBattle.ts's "server re-derives"
// precedent; @heroes/engine's startCharter() doesn't self-allocate
// them the way recruitHero() does).
export interface StartCharterCommand {
  kind: "StartCharter";
  gameName: string;
  actor: PlayerSeat;
  heroId: HeroId;
  targetQ: number;
  targetR: number;
  settlementName: string;
}
