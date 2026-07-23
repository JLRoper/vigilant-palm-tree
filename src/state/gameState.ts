import { normalizeStacks, type UnitStack } from "./units";
import {
  buildingUpkeepRequired,
  clampMorale,
  clampWarehouseNonNegative,
  effectiveIncome,
  foodRequired,
  moraleDecay,
} from "../economy/consumption";

export type PlayerId = number;
export type Faction = "player" | "ai";
export type HeroId = string;
export type SettlementId = string;
export type ResourceType = "gold" | "wood" | "stone" | "iron" | "arcane" | "food";

export const WAREHOUSE_RESOURCES = [
  "wood",
  "stone",
  "iron",
  "arcane",
  "food",
] as const;

export type WarehouseResource = (typeof WAREHOUSE_RESOURCES)[number];

export type Warehouse = {
  wood: number;
  stone: number;
  iron: number;
  arcane: number;
  food: number;
};

export interface Player {
  id: PlayerId;
  faction: Faction;
  name: string;
  color: string;
  heroIds: HeroId[];
  settlementIds: SettlementId[];
}

export interface HeroState {
  id: HeroId;
  name: string;
  ownerId: PlayerId;
  q: number;
  r: number;
  movementRemaining: number;
  previousQ: number | null;
  previousR: number | null;
  previousMovementRemaining: number | null;
  trail: { q: number; r: number }[];
  gold: number;
  troops: number;
  stacks: UnitStack[];
}

export interface SettlementState {
  id: SettlementId;
  name: string;
  ownerId: PlayerId | null;
  q: number;
  r: number;
  level: 1 | 2 | 3;
  population: number;
  goldTax: number;
  resourceRates: Partial<Record<ResourceType, number>>;
  foundedOnResource: ResourceType | null;
  gold: number;
  warehouse: Warehouse;
  citySpots: Array<{ cell: { x: number; y: number }; resource: ResourceType; vein: string }>;
  cityMines: Array<{ cell: { x: number; y: number }; resource: ResourceType; level: number }>;
  morale: number;
  autoTrade: boolean;
}

export type GamePhase =
  | { kind: "PLAYER_TURN"; playerId: PlayerId }
  | { kind: "AI_TURN"; playerId: PlayerId }
  | { kind: "BATTLE"; attackerId: HeroId; defenderId: HeroId }
  | { kind: "ROUND_END"; nextRound: number };

export interface GameState {
  round: number;
  day: number;
  activePlayerId: PlayerId;
  players: Player[];
  heroes: Record<HeroId, HeroState>;
  settlements: Record<SettlementId, SettlementState>;
  phase: GamePhase;
  selectedHeroId: HeroId | null;
  selectedSettlementId: SettlementId | null;
  dirty: boolean;
  castleSeed: number;
  castleCount: number;
}

export const DAYS_PER_WEEK = 7;
export const DAYS_PER_MONTH = 30;

export interface CalendarParts {
  week: number;
  dayOfWeek: number;
  month: number;
  dayOfMonth: number;
}

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

export const MOVEMENT_PER_TURN = 7;

const NEIGHBOR_DIRS: { q: number; r: number }[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export interface InitialStateOptions {
  seedPlayers?: Player[];
  seedHeroes?: HeroState[];
  seedSettlements?: SettlementState[];
  seedRound?: number;
  seedActivePlayerId?: PlayerId;
  seedCastleSeed?: number;
  seedCastleCount?: number;
}

function defaultPlayers(): Player[] {
  return [
    { id: 0, faction: "player", name: "Human", color: "#d62828", heroIds: ["h0"], settlementIds: ["s0"] },
    { id: 1, faction: "ai", name: "AI", color: "#1d7dd1", heroIds: ["h1"], settlementIds: ["s1"] },
  ];
}

function defaultHeroes(): Record<HeroId, HeroState> {
  return {
    h0: { id: "h0", name: "Commander", ownerId: 0, q: 2, r: 2, movementRemaining: MOVEMENT_PER_TURN, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q: 2, r: 2 }], gold: 0, troops: 1, stacks: normalizeStacks([{ unitTypeId: "swordsman", count: 12 }, { unitTypeId: "archer", count: 8 }, { unitTypeId: "cavalry", count: 4 }]) },
    h1: { id: "h1", name: "Shadow Knight", ownerId: 1, q: 18, r: 4, movementRemaining: MOVEMENT_PER_TURN, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q: 18, r: 4 }], gold: 0, troops: 1, stacks: normalizeStacks([{ unitTypeId: "crossbowman", count: 10 }, { unitTypeId: "griffin", count: 3 }]) },
  };
}

function emptyWarehouse(): Warehouse {
  return { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 };
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
      gold: 0,
      warehouse: emptyWarehouse(),
      citySpots: [],
      cityMines: [],
      morale: 100,
      autoTrade: true,
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
      gold: 0,
      warehouse: emptyWarehouse(),
      citySpots: [],
      cityMines: [],
      morale: 100,
      autoTrade: true,
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

export type StartMoveResult =
  | { state: GameState; ok: true }
  | { state: GameState; ok: false; reason: string };

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

export interface ReorderResult {
  state: GameState;
  ok: boolean;
  reason: string;
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
  console.debug("[reorderStack] swap", fromIdx, "->", toIdx, "hero=", heroId, "new order=", stacks.map(s => s.unitTypeId ?? "_"));
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

export const CAPTURE_GOLD_REWARD = 100;

export interface CaptureResult {
  state: GameState;
  captured: boolean;
  previousOwnerId: PlayerId | null;
}

export function captureSettlement(
  state: GameState,
  heroId: HeroId,
  settlementId: SettlementId,
): CaptureResult {
  const hero = state.heroes[heroId];
  const settlement = state.settlements[settlementId];
  if (!hero || !settlement) return { state, captured: false, previousOwnerId: null };
  if (hero.ownerId === settlement.ownerId) {
    return { state, captured: false, previousOwnerId: settlement.ownerId };
  }
  const newOwnerId = hero.ownerId;
  const previousOwnerId = settlement.ownerId;
  const newSettlements: Record<SettlementId, SettlementState> = {
    ...state.settlements,
    [settlementId]: { ...settlement, ownerId: newOwnerId },
  };
  const newPlayers = state.players.map((p) => {
    if (p.id === newOwnerId) {
      if (p.settlementIds.includes(settlementId)) return p;
      return { ...p, settlementIds: [...p.settlementIds, settlementId] };
    }
    if (p.id === previousOwnerId) {
      return { ...p, settlementIds: p.settlementIds.filter((id) => id !== settlementId) };
    }
    return p;
  });
  const newHeroes: Record<HeroId, HeroState> = {
    ...state.heroes,
    [heroId]: { ...hero, gold: hero.gold + CAPTURE_GOLD_REWARD },
  };
  return {
    state: { ...state, settlements: newSettlements, players: newPlayers, heroes: newHeroes, dirty: true },
    captured: true,
    previousOwnerId,
  };
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

export function resolveBattle(state: GameState): GameState {
  if (state.phase.kind !== "BATTLE") return state;
  const { attackerId, defenderId } = state.phase;
  const attacker = state.heroes[attackerId];
  const defender = state.heroes[defenderId];
  if (!attacker || !defender) {
    return { ...state, phase: { kind: "PLAYER_TURN", playerId: state.activePlayerId }, dirty: true };
  }
  const newHeroes: Record<HeroId, HeroState> = { ...state.heroes };
  const lootedGold = defender.gold;
  newHeroes[attackerId] = { ...attacker, gold: attacker.gold + lootedGold };
  delete newHeroes[defenderId];
  return {
    ...state,
    heroes: newHeroes,
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

export interface AutoTradeTransfer {
  fromSettlementId: SettlementId;
  toSettlementId: SettlementId;
  resource: WarehouseResource;
  amount: number;
  goldPaid: number;
}

export interface ApplyEndOfTurnResult {
  state: GameState;
  transfers: AutoTradeTransfer[];
}

export function applySettlementConsumption(s: SettlementState): SettlementState {
  const warehouse: Warehouse = { ...s.warehouse };
  const upkeep = buildingUpkeepRequired(s);
  warehouse.food = clampWarehouseNonNegative(warehouse.food - foodRequired(s));
  warehouse.wood = clampWarehouseNonNegative(warehouse.wood - upkeep.wood);
  warehouse.stone = clampWarehouseNonNegative(warehouse.stone - upkeep.stone);
  return { ...s, warehouse };
}

export function applyMoraleDecay(s: SettlementState): SettlementState {
  return { ...s, morale: clampMorale((s.morale ?? 100) - moraleDecay(s)) };
}

export function applyEffectiveIncome(s: SettlementState): SettlementState {
  const inc = effectiveIncome(s);
  return { ...s, gold: s.gold + inc };
}

export function runAutoTrade(
  settlements: Record<SettlementId, SettlementState>,
  playerId: PlayerId,
): { settlements: Record<SettlementId, SettlementState>; transfers: AutoTradeTransfer[] } {
  const next: Record<SettlementId, SettlementState> = { ...settlements };
  const transfers: AutoTradeTransfer[] = [];
  const resources = WAREHOUSE_RESOURCES;
  for (const s of Object.values(next)) {
    if (s.ownerId !== playerId || !s.autoTrade) continue;
    const updatedS: SettlementState = { ...next[s.id] };
    for (const r of resources) {
      const deficit = computeDeficit(updatedS, r);
      if (deficit <= 0) continue;
      const sources = Object.values(next).filter(
        (other) => other.id !== s.id && other.ownerId === playerId && (other.warehouse[r] ?? 0) > 0 && (other.gold ?? 0) > 0,
      );
      let remaining = deficit;
      for (const src of sources) {
        if (remaining <= 0) break;
        const sourceUpd: SettlementState = { ...next[src.id] };
        const transferable = Math.max(0, Math.min(sourceUpd.warehouse[r] ?? 0, sourceUpd.gold ?? 0, remaining));
        if (transferable <= 0) continue;
        sourceUpd.warehouse = { ...sourceUpd.warehouse, [r]: clampWarehouseNonNegative((sourceUpd.warehouse[r] ?? 0) - transferable) };
        sourceUpd.gold = sourceUpd.gold - transferable;
        updatedS.warehouse = { ...updatedS.warehouse, [r]: (updatedS.warehouse[r] ?? 0) + transferable };
        next[src.id] = sourceUpd;
        remaining -= transferable;
        transfers.push({
          fromSettlementId: src.id,
          toSettlementId: s.id,
          resource: r as WarehouseResource,
          amount: transferable,
          goldPaid: transferable,
        });
      }
    }
    next[s.id] = updatedS;
  }
  return { settlements: next, transfers };
}

function computeDeficit(s: SettlementState, r: WarehouseResource): number {
  if (r === "food") {
    return Math.max(0, foodRequired(s) - (s.warehouse.food ?? 0));
  }
  if (r === "wood") {
    return Math.max(0, buildingUpkeepRequired(s).wood - (s.warehouse.wood ?? 0));
  }
  if (r === "stone") {
    return Math.max(0, buildingUpkeepRequired(s).stone - (s.warehouse.stone ?? 0));
  }
  return 0;
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
  let newSettlements: Record<SettlementId, SettlementState> = { ...state.settlements };
  for (const s of Object.values(newSettlements)) {
    const newWarehouse: Warehouse = { ...s.warehouse };
    for (const r of WAREHOUSE_RESOURCES) {
      const rate = s.resourceRates[r] ?? 0;
      if (rate > 0) newWarehouse[r] = (newWarehouse[r] ?? 0) + rate;
    }
    newSettlements[s.id] = { ...newSettlements[s.id], warehouse: newWarehouse };
  }
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

export function setAutoTrade(state: GameState, settlementId: SettlementId, autoTrade: boolean): GameState {
  const s = state.settlements[settlementId];
  if (!s) return state;
  if ((s.autoTrade ?? true) === autoTrade) return state;
  return {
    ...state,
    settlements: { ...state.settlements, [settlementId]: { ...s, autoTrade } },
    dirty: true,
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
  return { ...state, heroes: newHeroes, dirty: true };
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
  const withDay: GameState = {
    ...state,
    round: state.round + 1,
    day: nextDay,
    activePlayerId: 0,
    phase: { kind: "PLAYER_TURN", playerId: 0 },
    heroes: newHeroes,
    selectedHeroId: null,
    selectedSettlementId: null,
  };
  if (nextDay % 7 === 0) return applyWeeklyUpkeep(withDay);
  return withDay;
}

export function markSaved(state: GameState): GameState {
  if (!state.dirty) return state;
  return { ...state, dirty: false };
}

export type TransferDirection = "deposit" | "withdraw";

export interface TransferResult {
  state: GameState;
  ok: boolean;
  reason: string;
}

export function transferGold(
  state: GameState,
  heroId: HeroId,
  settlementId: SettlementId,
  direction: TransferDirection,
): TransferResult {
  const hero = state.heroes[heroId];
  const settlement = state.settlements[settlementId];
  if (!hero) return { state, ok: false, reason: "no_hero" };
  if (!settlement) return { state, ok: false, reason: "no_settlement" };
  if (hero.q !== settlement.q || hero.r !== settlement.r) {
    return { state, ok: false, reason: "hero_not_at_settlement" };
  }
  if (settlement.ownerId === null || settlement.ownerId !== hero.ownerId) {
    return { state, ok: false, reason: "not_owned_settlement" };
  }
  if (direction === "deposit") {
    if (hero.gold <= 0) return { state, ok: false, reason: "nothing_to_deposit" };
    const amount = hero.gold;
    return {
      state: {
        ...state,
        heroes: { ...state.heroes, [heroId]: { ...hero, gold: 0 } },
        settlements: { ...state.settlements, [settlementId]: { ...settlement, gold: settlement.gold + amount } },
        dirty: true,
      },
      ok: true,
      reason: "",
    };
  }
  if (direction === "withdraw") {
    if (settlement.gold <= 0) return { state, ok: false, reason: "nothing_to_withdraw" };
    const amount = settlement.gold;
    return {
      state: {
        ...state,
        heroes: { ...state.heroes, [heroId]: { ...hero, gold: hero.gold + amount } },
        settlements: { ...state.settlements, [settlementId]: { ...settlement, gold: 0 } },
        dirty: true,
      },
      ok: true,
      reason: "",
    };
  }
  return { state, ok: false, reason: "invalid_direction" };
}

export interface TradeResult {
  state: GameState;
  ok: boolean;
  reason: string;
}

export function tradeResources(
  state: GameState,
  fromSettlementId: SettlementId,
  toSettlementId: SettlementId,
  resource: WarehouseResource,
  amount: number,
): TradeResult {
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
    return { state, ok: false, reason: "invalid_amount" };
  }
  const from = state.settlements[fromSettlementId];
  const to = state.settlements[toSettlementId];
  if (!from) return { state, ok: false, reason: "no_from_settlement" };
  if (!to) return { state, ok: false, reason: "no_to_settlement" };
  if (from.ownerId === null || to.ownerId === null) {
    return { state, ok: false, reason: "unowned_settlement" };
  }
  if (from.ownerId !== to.ownerId) {
    return { state, ok: false, reason: "different_owners" };
  }
  if (from.warehouse[resource] < amount) {
    return { state, ok: false, reason: "insufficient_resource" };
  }
  if (from.gold < amount) {
    return { state, ok: false, reason: "insufficient_gold" };
  }
  const newFromWarehouse: Warehouse = { ...from.warehouse, [resource]: from.warehouse[resource] - amount };
  const newToWarehouse: Warehouse = { ...to.warehouse, [resource]: to.warehouse[resource] + amount };
  return {
    state: {
      ...state,
      settlements: {
        ...state.settlements,
        [fromSettlementId]: { ...from, gold: from.gold - amount, warehouse: newFromWarehouse },
        [toSettlementId]: { ...to, warehouse: newToWarehouse },
      },
      dirty: true,
    },
    ok: true,
    reason: "",
  };
}

export const MAX_HEROES_PER_PLAYER = 5;
export const HERO_RECRUIT_COST = 1;

export interface RecruitHeroResult {
  state: GameState;
  hero?: HeroState;
  error?: string;
}

export function recruitHero(
  state: GameState,
  playerId: PlayerId,
  heroName: string,
  settlementId: SettlementId,
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
    stacks: normalizeStacks([]),
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
