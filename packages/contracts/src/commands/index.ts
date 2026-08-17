import type { MoveHeroCommand } from "./moveHero";
import type { TransferGoldCommand } from "./transferGold";
import type { EndTurnCommand } from "./endTurn";
import type { TradeResourcesCommand } from "./tradeResources";
import type { ResolveBattleCommand } from "./resolveBattle";
import type { RecruitHeroCommand } from "./recruitHero";
import type { UpgradeTownHallCommand } from "./upgradeTownHall";
import type { SetAutoTradeCommand } from "./setAutoTrade";
import type { ReorderStackCommand } from "./reorderStack";
import type { CaptureSettlementCommand } from "./captureSettlement";
import type { StartCharterCommand } from "./startCharter";

export * from "./moveHero";
export * from "./transferGold";
export * from "./endTurn";
export * from "./tradeResources";
export * from "./resolveBattle";
export * from "./recruitHero";
export * from "./upgradeTownHall";
export * from "./setAutoTrade";
export * from "./reorderStack";
export * from "./captureSettlement";
export * from "./startCharter";

// Grows with each command port. Week 1 of Phase 3 Track 3.A shipped
// MoveHero/TransferGold; EndTurn followed in Week 2
// (plan/2026-08-16-phase-3-parallel-dev-plan.md's port order). Week 3
// added TradeResources, ResolveBattle, RecruitHero, UpgradeTownHall,
// SetAutoTrade, ReorderStack, and CaptureSettlement. StartCharter followed
// once the activeCharters schema gap closed
// (plan/2026-08-17-consolidated-phase-1-5-track-map.md §5.1 R5) --
// UpgradeSettlement, BuildStructure, and the lobby actions stay deferred
// (missing engine prerequisite / low priority respectively).
export type Command =
  | MoveHeroCommand
  | TransferGoldCommand
  | EndTurnCommand
  | TradeResourcesCommand
  | ResolveBattleCommand
  | RecruitHeroCommand
  | UpgradeTownHallCommand
  | SetAutoTradeCommand
  | ReorderStackCommand
  | CaptureSettlementCommand
  | StartCharterCommand;
