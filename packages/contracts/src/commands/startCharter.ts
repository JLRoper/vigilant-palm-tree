import type { HeroId, PlayerSeat } from "../ids";

// Discriminated-union command for founding a new settlement via a
// chartering hero (plan/2026-08-17-consolidated-phase-1-5-track-map.md
// §5.1 R5). Unlike src/state/turnController.ts's own local startCharter()
// call, this does NOT carry a client-computed settlementId/charterId/
// resourceRates/foundedOnResource/citySpots -- the server reconstructs its
// own GameMap (row.seed/row.map_size) and re-derives all of those itself
// (see server/app/commandHandler.ts's StartCharter case), the same way
// ResolveBattle re-derives adjacency instead of trusting the client's
// pairing (see resolveBattle.ts's own header comment). @heroes/engine's
// startCharter() does not self-allocate settlementId/charterId the way
// recruitHero() self-allocates heroId (see recruitHero.ts's own header
// comment) -- commandHandler.ts is the caller that builds them, from its
// own state.nextCharterId/nextSettlementId.
export interface StartCharterCommand {
  kind: "StartCharter";
  gameName: string;
  actor: PlayerSeat;
  heroId: HeroId;
  targetQ: number;
  targetR: number;
  settlementName: string;
}
