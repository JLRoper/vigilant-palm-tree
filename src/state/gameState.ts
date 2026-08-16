import { normalizePlatoons } from "./units";
import { MOVEMENT_PER_TURN } from "@heroes/contracts";
import type {
  Player,
  HeroState,
  GameState,
  InitialStateOptions,
  HeroId,
  SettlementId,
  SettlementState,
} from "@heroes/contracts";

export {
  applySettlementConsumption,
  applyMoraleDecay,
  applyEffectiveIncome,
  runAutoTrade,
  transferGold,
  tradeResources,
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
  CAPTURE_GOLD_REWARD,
  captureSettlement,
  setAutoTrade,
  startBuildingUpgrade,
  applyBuildingUpgrade,
  startTownHallUpgrade,
  TOWN_HALL_COSTS,
  startSettlementUpgrade,
  SETTLEMENT_UPGRADE_COSTS,
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
  TradeResult,
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
} from "@heroes/contracts";

export function isHuman(p: Player): boolean {
  return p.faction === "player";
}

function defaultPlayers(): Player[] {
  return [
    { id: 0, faction: "player", name: "Human", color: "#d62828", heroIds: ["h0"], settlementIds: ["s0"] },
    { id: 1, faction: "ai", name: "AI", color: "#1d7dd1", heroIds: ["h1"], settlementIds: ["s1"] },
  ];
}

function defaultHeroes(): Record<HeroId, HeroState> {
  return {
    h0: { id: "h0", name: "Commander", ownerId: 0, q: 2, r: 2, movementRemaining: MOVEMENT_PER_TURN, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q: 2, r: 2 }], gold: 300, troops: 1, stacks: normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 12 }] }, { entries: [{ unitTypeId: "archer", count: 8 }] }, { entries: [{ unitTypeId: "cavalry", count: 4 }] }]), isChartering: false, charterId: null, horseVariant: "bubbly" },
    h1: { id: "h1", name: "Shadow Knight", ownerId: 1, q: 18, r: 4, movementRemaining: MOVEMENT_PER_TURN, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q: 18, r: 4 }], gold: 300, troops: 1, stacks: normalizePlatoons([{ entries: [{ unitTypeId: "crossbowman", count: 10 }] }, { entries: [{ unitTypeId: "griffin", count: 3 }] }]), isChartering: false, charterId: null, horseVariant: "shadow" },
  };
}

function defaultSettlements(): Record<SettlementId, SettlementState> {
  return {
    s0: {
      id: "s0",
      name: "Test Keep",
      ownerId: 0,
      q: 2,
      r: 2,
      level: 1,
      population: 500,
      goldTax: 1,
      resourceRates: {},
      foundedOnResource: null,
      gold: 300,
      warehouse: { wood: 300, stone: 300, iron: 300, arcane: 300, food: 0 },
      citySpots: [],
      cityMines: [],
      morale: 100,
      autoTrade: true,
      castleVariant: 0,
      buildings: [],
    },
    s1: {
      id: "s1",
      name: "AI Spire",
      ownerId: 1,
      q: 18,
      r: 4,
      level: 1,
      population: 500,
      goldTax: 1,
      resourceRates: {},
      foundedOnResource: null,
      gold: 300,
      warehouse: { wood: 300, stone: 300, iron: 300, arcane: 300, food: 0 },
      citySpots: [],
      cityMines: [],
      morale: 100,
      autoTrade: true,
      castleVariant: 0,
      buildings: [],
    },
  };
}

export function createInitialState(opts?: InitialStateOptions): GameState {
  const players = opts?.seedPlayers ?? defaultPlayers();
  const heroesRecord: Record<HeroId, HeroState> = {};
  if (opts?.seedHeroes) {
    for (const h of opts.seedHeroes) heroesRecord[h.id] = h;
  } else {
    Object.assign(heroesRecord, defaultHeroes());
  }
  const settlementsRecord: Record<SettlementId, SettlementState> = {};
  if (opts?.seedSettlements) {
    for (const s of opts.seedSettlements) settlementsRecord[s.id] = s;
  } else {
    Object.assign(settlementsRecord, defaultSettlements());
  }
  const activePlayerId = opts?.seedActivePlayerId ?? 0;
  const settlementCount = Object.keys(settlementsRecord).length;
  return {
    round: opts?.seedRound ?? 1,
    activePlayerId,
    players,
    heroes: heroesRecord,
    settlements: settlementsRecord,
    phase: { kind: "PLAYER_TURN", playerId: activePlayerId },
    selectedHeroId: null,
    selectedSettlementId: null,
    dirty: false,
    castleSeed: opts?.seedCastleSeed ?? 0,
    castleCount: opts?.seedCastleCount ?? 3,
    day: 1,
    activeCharters: [],
    nextCharterId: 0,
    nextSettlementId: settlementCount,
  };
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
  return { ...state, selectedHeroId: heroId };
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


