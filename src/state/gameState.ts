import { normalizePlatoons } from "./units";
import type { HorseVariant } from "./settings";
import { settings } from "./settings";
import {
  advanceCharters,
  advanceSettlementUpgrades,
  applyEffectiveIncome,
  applyMoraleDecay,
  applyPopulationGrowth,
  applySettlementConsumption,
  produceSettlementResources,
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
  StartMoveResult,
  ReorderResult,
  ApplyEndOfTurnResult,
  RecruitHeroResult,
  PlayerId,
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

const NEIGHBOR_DIRS: { q: number; r: number }[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

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

export function startMove(
  state: GameState,
  heroId: HeroId,
  toTile: { q: number; r: number },
  cost: number,
  // Ordered list of every tile the hero will pass through during this move
  // (including the destination). When omitted, only the destination is
  // appended to the trail — which produces a "as the crow flies" line for
  // multi-hex moves. Callers should pass the full clamped path so the trail
  // reflects the actual route.
  trailExtension?: { q: number; r: number }[],
): StartMoveResult {
  if (state.phase.kind !== "PLAYER_TURN") {
    return { state, ok: false, reason: "not_player_turn" };
  }
  const hero = state.heroes[heroId];
  if (!hero) return { state, ok: false, reason: "no_hero" };
  if (hero.isChartering) {
    return { state, ok: false, reason: "is_chartering" };
  }
  if (hero.ownerId !== state.activePlayerId) {
    return { state, ok: false, reason: "not_owner" };
  }
  if (state.selectedHeroId !== heroId) {
    return { state, ok: false, reason: "not_selected" };
  }
  if (!Number.isFinite(cost) || cost < 0) {
    return { state, ok: false, reason: "impassable" };
  }
  for (const [id, other] of Object.entries(state.heroes)) {
    if (id !== heroId && other.q === toTile.q && other.r === toTile.r) {
      return { state, ok: false, reason: "occupied" };
    }
  }
  if (hero.movementRemaining < cost) {
    return { state, ok: false, reason: "insufficient_movement" };
  }
  const trailExtensionFinal = trailExtension && trailExtension.length > 0
    ? trailExtension
    : [toTile];
  const updatedHero: HeroState = {
    ...hero,
    q: toTile.q,
    r: toTile.r,
    movementRemaining: hero.movementRemaining - cost,
    previousQ: hero.q,
    previousR: hero.r,
    previousMovementRemaining: hero.movementRemaining,
    trail: [...(hero.trail ?? []), ...trailExtensionFinal],
  };
  return {
    state: { ...state, heroes: { ...state.heroes, [heroId]: updatedHero }, dirty: true },
    ok: true,
  };
}

export function cancelMove(state: GameState, heroId: HeroId): GameState {
  const hero = state.heroes[heroId];
  if (!hero) return state;
  if (hero.previousQ === null || hero.previousR === null || hero.previousMovementRemaining === null) {
    return state;
  }
  const restored: HeroState = {
    ...hero,
    q: hero.previousQ,
    r: hero.previousR,
    movementRemaining: hero.previousMovementRemaining,
    previousQ: null,
    previousR: null,
    previousMovementRemaining: null,
  };
  return { ...state, heroes: { ...state.heroes, [heroId]: restored }, dirty: true };
}

// The 8 army slots are FIXED positions on the battlefield (front line, back
// line, etc.), so the user can only SWAP the contents of two slots. Same
// from/to is a no-op success. Dragging onto an empty slot effectively moves
// the stack there while leaving the source empty (swap with empty). Marks the
// state dirty so the next save/turn boundary persists it.
export function reorderStack(
  state: GameState,
  heroId: HeroId,
  fromIdx: number,
  toIdx: number,
): ReorderResult {
  const hero = state.heroes[heroId];
  if (!hero) return { state, ok: false, reason: "no_hero" };
  const stacks = [...(hero.stacks ?? [])];
  if (
    !Number.isInteger(fromIdx) ||
    !Number.isInteger(toIdx) ||
    fromIdx < 0 ||
    fromIdx >= stacks.length ||
    toIdx < 0 ||
    toIdx >= stacks.length
  ) {
    return { state, ok: false, reason: "invalid_index" };
  }
  if (fromIdx === toIdx) return { state, ok: true, reason: "" };
  const tmp = stacks[fromIdx];
  stacks[fromIdx] = stacks[toIdx];
  stacks[toIdx] = tmp;
  console.debug("[reorderStack] swap", fromIdx, "->", toIdx, "hero=", heroId, "new order=", stacks.map(s => s.entries[0]?.unitTypeId ?? "_"));
  return {
    state: {
      ...state,
      heroes: { ...state.heroes, [heroId]: { ...hero, stacks } },
      dirty: true,
    },
    ok: true,
    reason: "",
  };
}

export function detectAdjacentEnemy(state: GameState, moverId: HeroId): HeroId | null {
  const mover = state.heroes[moverId];
  if (!mover) return null;
  for (const dir of NEIGHBOR_DIRS) {
    const nq = mover.q + dir.q;
    const nr = mover.r + dir.r;
    for (const [id, h] of Object.entries(state.heroes)) {
      if (id === moverId) continue;
      if (h.ownerId === mover.ownerId) continue;
      if (h.q === nq && h.r === nr) return id;
    }
  }
  return null;
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
  const newHeroes: Record<HeroId, HeroState> = { ...state.heroes };
  for (const hero of Object.values(newHeroes)) {
    if (hero.ownerId === playerId) {
      newHeroes[hero.id] = {
        ...hero,
        movementRemaining: MOVEMENT_PER_TURN,
        previousQ: null,
        previousR: null,
        previousMovementRemaining: null,
        trail: [{ q: hero.q, r: hero.r }],
      };
    }
  }
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
  const newHeroes: Record<HeroId, HeroState> = { ...state.heroes };
  for (const hero of Object.values(newHeroes)) {
    const cost = hero.troops * 1;
    if (hero.gold >= cost) {
      newHeroes[hero.id] = { ...hero, gold: hero.gold - cost };
    } else {
      newHeroes[hero.id] = { ...hero, gold: 0, troops: hero.gold };
    }
  }
  const newSettlements = applyPopulationGrowth(state.settlements, settings().populationGrowthRate);
  return { ...state, heroes: newHeroes, settlements: newSettlements, dirty: true };
}

export function advanceRound(state: GameState): GameState {
  const newHeroes: Record<HeroId, HeroState> = { ...state.heroes };
  for (const hero of Object.values(newHeroes)) {
    newHeroes[hero.id] = {
      ...hero,
      movementRemaining: MOVEMENT_PER_TURN,
      previousQ: null,
      previousR: null,
      previousMovementRemaining: null,
      trail: [{ q: hero.q, r: hero.r }],
    };
  }
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

export const MAX_HEROES_PER_PLAYER = 5;
export const HERO_RECRUIT_COST = 1;

export function recruitHero(
  state: GameState,
  playerId: PlayerId,
  heroName: string,
  settlementId: SettlementId,
  horseVariant: HorseVariant,
): RecruitHeroResult {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { state, error: "Player not found" };
  if (player.heroIds.length >= MAX_HEROES_PER_PLAYER) {
    return { state, error: "Already have 5 heroes" };
  }

  const settlement = state.settlements[settlementId];
  if (!settlement) return { state, error: "Settlement not found" };
  if (settlement.ownerId !== playerId) return { state, error: "Not your settlement" };
  if (settlement.gold < HERO_RECRUIT_COST) {
    return { state, error: "Not enough gold" };
  }

  for (const hero of Object.values(state.heroes)) {
    if (hero.q === settlement.q && hero.r === settlement.r) {
      return { state, error: "Hex is occupied" };
    }
  }

  const indices = Array.from({ length: MAX_HEROES_PER_PLAYER }, (_, i) => i);
  const usedIndices = new Set(
    player.heroIds.map((id) => {
      const num = parseInt(id.replace(/^h/, ""), 10);
      return Number.isFinite(num) ? num : -1;
    }),
  );
  const nextIdx = indices.find((i) => !usedIndices.has(i)) ?? player.heroIds.length;
  const heroId = `h${nextIdx}`;

  const hero: HeroState = {
    id: heroId,
    name: heroName,
    ownerId: playerId,
    q: settlement.q,
    r: settlement.r,
    movementRemaining: MOVEMENT_PER_TURN,
    previousQ: null,
    previousR: null,
    previousMovementRemaining: null,
    trail: [{ q: settlement.q, r: settlement.r }],
    gold: 0,
    troops: 1,
    stacks: normalizePlatoons([]),
    isChartering: false,
    charterId: null,
    horseVariant,
  };

  return {
    state: {
      ...state,
      heroes: { ...state.heroes, [heroId]: hero },
      settlements: {
        ...state.settlements,
        [settlement.id]: { ...settlement, gold: settlement.gold - HERO_RECRUIT_COST },
      },
      players: state.players.map((p) =>
        p.id === playerId ? { ...p, heroIds: [...p.heroIds, heroId] } : p,
      ),
      dirty: true,
    },
    hero,
  };
}

