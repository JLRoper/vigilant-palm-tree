import type { MoveHeroCommand } from "./moveHero";
import type { TransferGoldCommand } from "./transferGold";
import type { BankGoldCommand } from "./bankGold";
import type { EndTurnCommand } from "./endTurn";
import type { ResolveBattleCommand } from "./resolveBattle";
import type { EnterBattleCommand } from "./enterBattle";
import type { RecruitHeroCommand } from "./recruitHero";
import type { UpgradeTownHallCommand } from "./upgradeTownHall";
import type { SetAutoTradeCommand } from "./setAutoTrade";
import type { ReorderStackCommand } from "./reorderStack";
import type { CaptureSettlementCommand } from "./captureSettlement";
import type { StartCharterCommand } from "./startCharter";
import type { UpgradeBuildingCommand } from "./upgradeBuilding";
import type { UpgradeSettlementCommand } from "./upgradeSettlement";
import type { AdvanceCharterTravelCommand } from "./advanceCharterTravel";
import type { SubmitBattleResultCommand } from "./submitBattleResult";
import type { PlaceBuildingsCommand } from "./placeBuildings";
import type { TransferResourcesCommand } from "./transferResources";
import type { AssignWagonsCommand } from "./assignWagons";
import type { BuyWagonsCommand } from "./buyWagons";
import type { CreateTradeRouteCommand } from "./createTradeRoute";
import type { UpdateTradeRouteCommand } from "./updateTradeRoute";
import type { RecruitUnitsCommand } from "./recruitUnits";
import type { TransferUnitsCommand } from "./transferUnits";
import type { SubmitSettlementBattleResultCommand } from "./submitSettlementBattleResult";

export * from "./moveHero";
export * from "./transferGold";
export * from "./bankGold";
export * from "./endTurn";
export * from "./resolveBattle";
export * from "./enterBattle";
export * from "./recruitHero";
export * from "./upgradeTownHall";
export * from "./setAutoTrade";
export * from "./reorderStack";
export * from "./captureSettlement";
export * from "./startCharter";
export * from "./upgradeBuilding";
export * from "./upgradeSettlement";
export * from "./advanceCharterTravel";
export * from "./submitBattleResult";
export * from "./placeBuildings";
export * from "./transferResources";
export * from "./assignWagons";
export * from "./buyWagons";
export * from "./createTradeRoute";
export * from "./updateTradeRoute";
export * from "./recruitUnits";
export * from "./transferUnits";
export * from "./submitSettlementBattleResult";

// Grows with each command port. Week 1 of Phase 3 Track 3.A shipped
// MoveHero/TransferGold; EndTurn followed in Week 2
// (plan/2026-08-16-phase-3-parallel-dev-plan.md's port order). Week 3
// added ResolveBattle, RecruitHero, UpgradeTownHall,
// SetAutoTrade, ReorderStack, and CaptureSettlement. StartCharter followed
// once the activeCharters schema gap closed
// (plan/2026-08-17-consolidated-phase-1-5-track-map.md §5.1 R5).
// UpgradeBuilding and UpgradeSettlement closed the last two gaps identified
// by issue #88's re-scoped review
// (plan/2026-08-17-issue-88-remaining-command-ports.md) -- the lobby
// actions and real new-construction (BuildStructure) remain deferred as
// low priority / no engine reducer, respectively. AdvanceCharterTravel
// (#152) closed the last piece of R5: charter travel-stepping, previously
// purely client-local. SubmitBattleResult
// (plan/2026-09-27-manual-battle-wiring.md, work item 4) is the 15th kind:
// the manual arena's played-out outcome, applied server-side with the same
// post-battle rules the auto-resolver uses.
// BankGold is the 25th kind: a bank building's own gold pot, both directions
// in one command (treasury -> pot, or a 7-day countdown out of the pot). The
// pot's fields ride BuildingDef (`bank?: BankPot`), which the PlaceBuildings
// shape gate has to preserve or every pot zeroes on the next build commit.
// TradeResources was deleted 2026-10-02 (dead code): the manual
// settlement-to-settlement teleport had no UI caller, and both of its jobs --
// deficit fill and surplus moving -- belong to the caravan routes now
// (economy/tradeNeeds.ts + logistics.ts). Legacy instant auto-trade survives
// behind lobby.legacyAutoTrade instead.
export type Command =
  | MoveHeroCommand
  | TransferGoldCommand
  | BankGoldCommand
  | EndTurnCommand
  | ResolveBattleCommand
  | RecruitHeroCommand
  | UpgradeTownHallCommand
  | SetAutoTradeCommand
  | ReorderStackCommand
  | CaptureSettlementCommand
  | StartCharterCommand
  | UpgradeBuildingCommand
  | UpgradeSettlementCommand
  | AdvanceCharterTravelCommand
  | SubmitBattleResultCommand
  | PlaceBuildingsCommand
  | TransferResourcesCommand
  | AssignWagonsCommand
  | BuyWagonsCommand
  | CreateTradeRouteCommand
  | UpdateTradeRouteCommand
  | RecruitUnitsCommand
  | TransferUnitsCommand
  | SubmitSettlementBattleResultCommand
  | EnterBattleCommand;
