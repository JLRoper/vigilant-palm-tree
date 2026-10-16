import type {
  Player,
  GameState,
  HeroId,
  SettlementId,
} from "@heroes/contracts";

export { createInitialState } from "@heroes/engine";

export {
  applySettlementConsumption,
  applyMoraleDecay,
  applyEffectiveIncome,
  runAutoTrade,
  transferGold,
  transferResources,
  assignWagons,
  buyWagons,
  createTradeRoute,
  updateTradeRoute,
} from "@heroes/engine";

export {
  advanceCharters,
  CHARTER_GOLD_COST,
  CHARTER_WAREHOUSE_COST,
  cleanupDefeatedHeroCharters,
  startCharter,
  stepTravelCharter,
} from "@heroes/engine";

export {
  recruitUnits,
  transferUnits,
  startSettlementBattle,
} from "@heroes/engine";

export {
  CAPTURE_GOLD_REWARD,
  captureSettlement,
  setAutoTrade,
  startBuildingUpgrade,
  applyBuildingUpgrade,
  startTownHallUpgrade,
  TOWN_HALL_COSTS,
  startSettlementUpgrade,
  SETTLEMENT_UPGRADE_COSTS,
  applyPlaceBuildings,
} from "@heroes/engine";

export {
  startMove,
  cancelMove,
  reorderStack,
  detectAdjacentEnemy,
  MAX_HEROES_PER_PLAYER,
  HERO_RECRUIT_COST,
  recruitHero,
} from "@heroes/engine";

export {
  startBattle,
  endBattlePhase,
  endTurn,
  canEndTurn,
  applyEndOfTurn,
  applyEndOfTurnDetailed,
  applyWeeklyUpkeep,
  advanceRound,
  DAYS_PER_WEEK,
  DAYS_PER_MONTH,
  calendarFromDay,
  monthName,
} from "@heroes/engine";

export { MOVEMENT_PER_TURN, WAREHOUSE_RESOURCES } from "@heroes/contracts";
export type {
  Player,
  HeroState,
  GamePhase,
  GameState,
  CalendarParts,
  InitialStateOptions,
  StartMoveResult,
  ReorderResult,
  CaptureResult,
  AutoTradeTransfer,
  ApplyEndOfTurnResult,
  TransferDirection,
  TransferResult,
  RecruitHeroResult,
  StartCharterPayload,
  StartCharterResult,
  StepTravelResult,
  StartUpgradeResult,
  BuildingUpgradeRequest,
  PlayerId,
  Faction,
  HeroId,
  SettlementId,
  CharterId,
  ResourceType,
  BuildingDef,
  BuildingKind,
  BuildingRef,
  CharterState,
  SettlementState,
  UpgradeState,
  Warehouse,
  WarehouseResource,
  TradeRouteEndpoint,
  TradeRoutePayload,
  TradeRouteState,
  TradeRouteId,
} from "@heroes/contracts";

export function isHuman(p: Player): boolean {
  return p.faction === "player";
}

export function selectHero(state: GameState, heroId: HeroId): GameState {
  if (state.phase.kind !== "PLAYER_TURN") return state;
  if (state.phase.playerId !== state.activePlayerId) return state;
  const activePlayer = state.players.find((p) => p.id === state.activePlayerId);
  if (!activePlayer || activePlayer.faction !== "player") return state;
  const hero = state.heroes[heroId];
  if (!hero) return state;
  if (hero.ownerId !== state.activePlayerId) return state;
  if (hero.isChartering) return state;
  return { ...state, selectedHeroId: heroId, selectedSettlementId: null };
}

export function clearSelection(state: GameState): GameState {
  if (state.selectedHeroId === null && state.selectedSettlementId === null) return state;
  return { ...state, selectedHeroId: null, selectedSettlementId: null };
}

export function selectSettlement(state: GameState, settlementId: SettlementId): GameState {
  if (!state.settlements[settlementId]) return state;
  if (state.selectedSettlementId === settlementId) return state;
  return { ...state, selectedSettlementId: settlementId, selectedHeroId: null };
}

export function clearSettlementSelection(state: GameState): GameState {
  if (state.selectedSettlementId === null) return state;
  return { ...state, selectedSettlementId: null };
}

export function markSaved(state: GameState): GameState {
  if (!state.dirty) return state;
  return { ...state, dirty: false };
}


