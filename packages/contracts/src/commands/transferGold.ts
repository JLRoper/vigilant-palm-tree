import type { HeroId, PlayerSeat, SettlementId } from "../ids";
import type { TransferDirection } from "../gameState";

export interface TransferGoldCommand {
  kind: "TransferGold";
  actor: PlayerSeat;
  heroId: HeroId;
  settlementId: SettlementId;
  direction: TransferDirection;
}
