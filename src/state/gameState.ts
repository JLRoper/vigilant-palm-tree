export type PlayerId = number;
export type Faction = "player" | "ai";
export type HeroId = string;
export type SettlementId = string;
export type ResourceType = "gold" | "wood" | "stone" | "iron" | "arcane";

export interface Player {
  id: PlayerId;
  faction: Faction;
  name: string;
  color: string;
  heroIds: HeroId[];
  settlementIds: SettlementId[];
  gold: number;
}

export interface HeroState {
  id: HeroId;
  ownerId: PlayerId;
  q: number;
  r: number;
  movementRemaining: number;
  previousQ: number | null;
  previousR: number | null;
  previousMovementRemaining: number | null;
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
export const BATTLE_GOLD_REWARD = 50;

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
    { id: 0, faction: "player", name: "Human", color: "#d62828", heroIds: ["h0"], settlementIds: ["s0"], gold: 0 },
    { id: 1, faction: "ai", name: "AI", color: "#1d7dd1", heroIds: ["h1"], settlementIds: ["s1"], gold: 0 },
  ];
}

function defaultHeroes(): Record<HeroId, HeroState> {
  return {
    h0: { id: "h0", ownerId: 0, q: 2, r: 2, movementRemaining: MOVEMENT_PER_TURN, previousQ: null, previousR: null, previousMovementRemaining: null },
    h1: { id: "h1", ownerId: 1, q: 18, r: 4, movementRemaining: MOVEMENT_PER_TURN, previousQ: null, previousR: null, previousMovementRemaining: null },
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
  if (hero.movementRemaining < cost) {
    return { state, ok: false, reason: "insufficient_movement" };
  }
  const updatedHero: HeroState = {
    ...hero,
    q: toTile.q,
    r: toTile.r,
    movementRemaining: hero.movementRemaining - cost,
    previousQ: hero.q,
    previousR: hero.r,
    previousMovementRemaining: hero.movementRemaining,
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

export function resolveBattle(state: GameState): GameState {
  if (state.phase.kind !== "BATTLE") return state;
  const { attackerId, defenderId } = state.phase;
  const attacker = state.heroes[attackerId];
  const defender = state.heroes[defenderId];
  if (!attacker || !defender) {
    return { ...state, phase: { kind: "PLAYER_TURN", playerId: state.activePlayerId }, dirty: true };
  }
  const newHeroes: Record<HeroId, HeroState> = { ...state.heroes };
  delete newHeroes[defenderId];
  const newPlayers = state.players.map((p) =>
    p.id === attacker.ownerId ? { ...p, gold: p.gold + BATTLE_GOLD_REWARD } : p,
  );
  return {
    ...state,
    heroes: newHeroes,
    players: newPlayers,
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
      };
    }
  }
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    return { ...state, heroes: newHeroes, dirty: true };
  }
  const goldEarned = player.settlementIds.length;
  const newPlayers = state.players.map((p) =>
    p.id === playerId ? { ...p, gold: p.gold + goldEarned } : p,
  );
  return { ...state, heroes: newHeroes, players: newPlayers, dirty: true };
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
    };
  }
  return {
    ...state,
    round: state.round + 1,
    day: state.day + 1,
    activePlayerId: 0,
    phase: { kind: "PLAYER_TURN", playerId: 0 },
    heroes: newHeroes,
    selectedHeroId: null,
    selectedSettlementId: null,
  };
}

export function markSaved(state: GameState): GameState {
  if (!state.dirty) return state;
  return { ...state, dirty: false };
}
