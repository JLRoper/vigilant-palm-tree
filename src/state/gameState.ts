import { normalizePlatoons } from "./units";
import { settings } from "./settings";
import {
  advanceCharters,
  advanceSettlementUpgrades,
  applyEffectiveIncome,
  applyHeroUpkeep,
  applyMoraleDecay,
  applyPopulationGrowth,
  applySettlementConsumption,
  produceSettlementResources,
  resetHeroMovement,
  runAutoTrade,
  tradeResources,
  transferGold,
} from "@heroes/engine";
import { MOVEMENT_PER_TURN } from "@heroes/contracts";
import type {
  Player,
  HeroState,
  GamePhase,
  GameState,
  CalendarParts,
  InitialStateOptions,
  ApplyEndOfTurnResult,
  HeroId,
  SettlementId,
  SettlementState,
} from "@heroes/contracts";

export { applySettlementConsumption, applyMoraleDecay, applyEffectiveIncome, runAutoTrade, transferGold, tradeResources };

export { advanceCharters };
export {
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

// gameState.ts shrinks to a re-export barrel for its types (Track A / Phase
// 1, stage 2 of plan/2026-08-15-parallel-dev-split.md) — the type
// definitions now live in @heroes/contracts; this file keeps re-exporting
// them so none of its ~35 existing consumers need to change on this PR.
// Runtime behavior (the functions below) is unchanged.
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

export const DAYS_PER_WEEK = 7;
export const DAYS_PER_MONTH = 30;

export function calendarFromDay(day: number): CalendarParts {
  const d = Math.max(1, Math.floor(day));
  return {
    week: Math.floor((d - 1) / DAYS_PER_WEEK) + 1,
    dayOfWeek: ((d - 1) % DAYS_PER_WEEK) + 1,
    month: Math.floor((d - 1) / DAYS_PER_MONTH) + 1,
    dayOfMonth: ((d - 1) % DAYS_PER_MONTH) + 1,
  };
}

const MONTH_NAMES: readonly string[] = [
  "Frostmoon", "Thawmist", "Greenrise", "Bloomtide", "Sunpeak", "Goldfall",
  "Harvest", "Emberveil", "Hollowmoon", "Stillrime", "Longnight", "Stormwane",
];

export function monthName(month: number): string {
  if (month < 1) return MONTH_NAMES[0];
  return MONTH_NAMES[(month - 1) % MONTH_NAMES.length];
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

export function startBattle(state: GameState, attackerId: HeroId, defenderId: HeroId): GameState {
  if (state.phase.kind === "BATTLE") return state;
  return {
    ...state,
    phase: { kind: "BATTLE", attackerId, defenderId },
    selectedHeroId: null,
    selectedSettlementId: null,
  };
}

// The actual combat resolution (stat comparison, counters, retreat) is
// server-authoritative — see POST /games/:name/resolve-battle and
// shared/combat/resolveBattle.ts — because it needs the DB-backed unit-type
// catalog. This just closes out the local BATTLE phase once the caller has
// the server's result in hand; heroes/players are merged in separately.
export function endBattlePhase(state: GameState): GameState {
  if (state.phase.kind !== "BATTLE") return state;
  return {
    ...state,
    phase: { kind: "PLAYER_TURN", playerId: state.activePlayerId },
    dirty: true,
  };
}

export function endTurn(state: GameState): GameState {
  const currentIdx = state.players.findIndex((p) => p.id === state.activePlayerId);
  if (currentIdx < 0) return state;
  const isLast = currentIdx === state.players.length - 1;
  if (isLast) {
    return {
      ...state,
      phase: { kind: "ROUND_END", nextRound: state.round + 1 },
      selectedHeroId: null,
      selectedSettlementId: null,
    };
  }
  const nextPlayer = state.players[currentIdx + 1];
  const newPhase: GamePhase =
    nextPlayer.faction === "ai"
      ? { kind: "AI_TURN", playerId: nextPlayer.id }
      : { kind: "PLAYER_TURN", playerId: nextPlayer.id };
  return {
    ...state,
    activePlayerId: nextPlayer.id,
    phase: newPhase,
    selectedHeroId: null,
    selectedSettlementId: null,
  };
}

export function applyEndOfTurn(state: GameState): GameState {
  return applyEndOfTurnDetailed(state).state;
}

export function applyEndOfTurnDetailed(state: GameState): ApplyEndOfTurnResult {
  const playerId = state.activePlayerId;
  const newHeroes: Record<HeroId, HeroState> = resetHeroMovement(state.heroes, playerId);
  // 1. Produce resources for ALL settlements
  let newSettlements: Record<SettlementId, SettlementState> = produceSettlementResources(state.settlements);
  // 2. Auto-trade for active player's settlements
  const autoTrade = runAutoTrade(newSettlements, playerId);
  newSettlements = autoTrade.settlements;
  // 3. Consumption + morale decay + effective income for active player's settlements
  for (const s of Object.values(newSettlements)) {
    if (s.ownerId !== playerId) continue;
    const consumed = applySettlementConsumption(s);
    const moraleAfter = applyMoraleDecay(consumed);
    newSettlements[s.id] = applyEffectiveIncome(moraleAfter);
  }
  return {
    state: { ...state, heroes: newHeroes, settlements: newSettlements, dirty: true },
    transfers: autoTrade.transfers,
  };
}

export function applyWeeklyUpkeep(state: GameState): GameState {
  const newHeroes = applyHeroUpkeep(state.heroes);
  const newSettlements = applyPopulationGrowth(state.settlements, settings().populationGrowthRate);
  return { ...state, heroes: newHeroes, settlements: newSettlements, dirty: true };
}

export function advanceRound(state: GameState): GameState {
  const newHeroes: Record<HeroId, HeroState> = resetHeroMovement(state.heroes);
  const nextDay = state.day + 1;
  let withDay: GameState = {
    ...state,
    round: state.round + 1,
    day: nextDay,
    activePlayerId: 0,
    phase: { kind: "PLAYER_TURN", playerId: 0 },
    heroes: newHeroes,
    selectedHeroId: null,
    selectedSettlementId: null,
  };
  withDay = advanceCharters(withDay);
  withDay = advanceSettlementUpgrades(withDay);
  if (nextDay % 7 === 0) return applyWeeklyUpkeep(withDay);
  return withDay;
}

export function markSaved(state: GameState): GameState {
  if (!state.dirty) return state;
  return { ...state, dirty: false };
}


