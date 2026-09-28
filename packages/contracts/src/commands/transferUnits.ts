import type { HeroId, PlayerSeat, SettlementId } from "../ids";

// Move units between a settlement garrison and a hero standing on its tile,
// mirroring TransferGold/TransferResources (plan/1790560842471-unit-recruitment-garrison-plan.md §1).
export interface TransferUnitsCommand {
  kind: "TransferUnits";
  gameName: string;
  actor: PlayerSeat;
  heroId: HeroId;
  settlementId: SettlementId;
  direction: "toHero" | "toGarrison";
  unitTypeId: string;
  count: number;
  toSlot?: number;
}
