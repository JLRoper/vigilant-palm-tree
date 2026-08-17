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

// Grows with each command port. Week 1 of Phase 3 Track 3.A shipped
// MoveHero/TransferGold; EndTurn followed in Week 2
// (plan/2026-08-16-phase-3-parallel-dev-plan.md's port order). Week 3
// adds TradeResources, ResolveBattle, RecruitHero, UpgradeTownHall,
// SetAutoTrade, ReorderStack, and CaptureSettlement -- UpgradeSettlement,
// StartCharter, AdvanceCharter, BuildStructure, and the lobby actions stay
// deferred (schema gap / missing engine prerequisite / low priority
// respectively; see this port's PR description).
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
  | CaptureSettlementCommand;
