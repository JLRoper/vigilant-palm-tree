import type { HeroId, PlayerSeat, SettlementId } from "../ids";
import type { TransferDirection } from "../gameState";

// Discriminated-union command for the port of server/routes.ts's /transfer
// endpoint (plan/2026-08-16-phase-3-parallel-dev-plan.md, Track 3.A Week 1).
export interface TransferGoldCommand {
  kind: "TransferGold";
  gameName: string;
  actor: PlayerSeat;
  heroId: HeroId;
  settlementId: SettlementId;
  direction: TransferDirection;
}
