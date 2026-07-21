import {
  createInitialState,
  type GameState,
  type HeroId,
  type HeroState,
  type Player,
  type SettlementState,
} from "../state/gameState";
import { demoStacksForPlayer, normalizeStacks } from "../state/units";
import type { Game } from "../io/api";
import type { GameMap } from "../map/gameMap";
import {
  CASTLE_COUNT_DEFAULT,
  CASTLE_COUNT_MAX,
  CASTLE_COUNT_MIN,
  defaultCastleSeedFromMapSeed,
  generateCastles,
} from "../map/castlePlacement";
import { Castle, castlesFromGameState } from "../entities/settlement";
import {
  computeSettlementRates,
  defaultPopulation,
  generateSettlementName,
  SETTLEMENT_GOLD_TAX,
} from "../economy/settlementRates";
import { PLAYER_COLORS, MAX_PLAYERS } from "../state/playerColors";

const DEFAULT_PLAYER_COUNT = 3;
const MAX_PLAYER_COUNT = MAX_PLAYERS;

function heroIdFor(playerIdx: number): HeroId {
  return `p${playerIdx}-hero`;
}

interface BuildInitialOptions {
  castleSeed?: number;
  castleCount?: number;
  playerCount?: number;
}

interface HydrateOptions {
  castleSeed?: number;
  castleCount?: number;
}

function clampPlayerCount(n: number | undefined): number {
  if (!n || !Number.isFinite(n)) return DEFAULT_PLAYER_COUNT;
  return Math.max(2, Math.min(MAX_PLAYER_COUNT, Math.floor(n)));
}

function makePlayers(settlementIds: Record<string, string[]>, playerCount: number): Player[] {
  const out: Player[] = [];
  for (let i = 0; i < playerCount; i++) {
    const faction = i === 0 ? "player" : "ai";
    const name = i === 0 ? "Human" : `AI ${i}`;
    out.push({
      id: i,
      faction,
      name,
      color: PLAYER_COLORS[i] ?? "#cccccc",
      heroIds: [heroIdFor(i)],
      settlementIds: settlementIds[`p${i}`] ?? [],
    });
  }
  return out;
}

function makeHeroes(
  castles: Castle[],
  playerCount: number,
): HeroState[] {
  const heroes: HeroState[] = [];
  for (let i = 0; i < playerCount; i++) {
    const castle = castles.find((c) => c.ownerId === i);
    if (!castle) continue;
    heroes.push({
      id: heroIdFor(i),
      ownerId: i,
      q: castle.tile.q,
      r: castle.tile.r,
      movementRemaining: 7,
      previousQ: null,
      previousR: null,
      previousMovementRemaining: null,
      trail: [{ q: castle.tile.q, r: castle.tile.r }],
      gold: 0,
      troops: 1,
      stacks: demoStacksForPlayer(i),
    });
  }
  return heroes;
}

function makeSettlements(
  map: GameMap,
  rng: () => number,
  castles: Castle[],
  _playerCount: number,
): SettlementState[] {
  return castles.map((c) => {
    const computed = computeSettlementRates(map, c.tile.q, c.tile.r, c.level);
    return {
      id: c.id,
      name: generateSettlementName(rng, c.ownerId),
      ownerId: c.ownerId,
      q: c.tile.q,
      r: c.tile.r,
      level: c.level,
      population: defaultPopulation(c.level),
      goldTax: SETTLEMENT_GOLD_TAX[c.level],
      resourceRates: computed.rates,
      foundedOnResource: computed.foundedOn,
      gold: 0,
      warehouse: emptyWarehouse(),
      morale: 100,
      autoTrade: true,
    };
  });
}

function splitByOwner(settlements: SettlementState[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const s of settlements) {
    const key = s.ownerId === null ? "neutral" : `p${s.ownerId}`;
    if (!out[key]) out[key] = [];
    out[key].push(s.id);
  }
  return out;
}

export function buildInitialGameState(
  map: GameMap,
  rng: () => number,
  opts?: BuildInitialOptions,
): GameState {
  const mapSeed = opts?.castleSeed ?? 1;
  const castleSeed = opts?.castleSeed ?? defaultCastleSeedFromMapSeed(mapSeed);
  const castleCount = opts?.castleCount ?? CASTLE_COUNT_DEFAULT;
  const playerCount = clampPlayerCount(opts?.playerCount);

  const castles = generateCastles(map, {
    castleSeed,
    playerCount,
    castleCount: Math.max(castleCount, playerCount),
  });

  const settlements = makeSettlements(map, rng, castles, playerCount);
  const settlementIds = splitByOwner(settlements);
  return createInitialState({
    seedPlayers: makePlayers(settlementIds, playerCount),
    seedHeroes: makeHeroes(castles, playerCount),
    seedSettlements: settlements,
    seedRound: 1,
    seedActivePlayerId: 0,
    seedCastleSeed: castleSeed,
    seedCastleCount: Math.max(castleCount, playerCount),
  });
}

export interface InitialStatePayload {
  round: number;
  day: number;
  active_player_id: number;
  players: Player[];
  heroes: Record<string, HeroState>;
  settlements: Record<string, SettlementState>;
}

export function makeInitialStatePayload(
  map: GameMap,
  rng: () => number,
  opts?: BuildInitialOptions,
): InitialStatePayload {
  const mapSeed = opts?.castleSeed ?? 1;
  const castleSeed = opts?.castleSeed ?? defaultCastleSeedFromMapSeed(mapSeed);
  const castleCount = opts?.castleCount ?? CASTLE_COUNT_DEFAULT;
  const playerCount = opts?.playerCount ?? 3;

  const castles = generateCastles(map, {
    castleSeed,
    playerCount,
    castleCount: Math.max(castleCount, playerCount),
  });
  const settlements = makeSettlements(map, rng, castles, playerCount);
  const settlementIds = splitByOwner(settlements);
  const players = makePlayers(settlementIds, playerCount);
  const heroes = makeHeroes(castles, playerCount);
  return {
    round: 1,
    day: 1,
    active_player_id: 0,
    players,
    heroes: Object.fromEntries(heroes.map((h) => [h.id, h])),
    settlements: Object.fromEntries(settlements.map((s) => [s.id, s])),
  };
}

function backfillHero(h: Partial<HeroState> & { id: HeroId; ownerId: number; q: number; r: number }): HeroState {
  return {
    movementRemaining: h.movementRemaining ?? 7,
    previousQ: h.previousQ ?? null,
    previousR: h.previousR ?? null,
    previousMovementRemaining: h.previousMovementRemaining ?? null,
    trail: h.trail ?? [{ q: h.q, r: h.r }],
    gold: h.gold ?? 0,
    troops: h.troops ?? 1,
    stacks: normalizeStacks(h.stacks),
    id: h.id,
    ownerId: h.ownerId,
    q: h.q,
    r: h.r,
  };
}

function emptyWarehouse(): SettlementState["warehouse"] {
  return { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 };
}

function backfillSettlement(s: Partial<SettlementState> & { id: string; q: number; r: number; level: 1 | 2 | 3 }): SettlementState {
  const warehouse = s.warehouse ?? emptyWarehouse();
  const filledWarehouse: SettlementState["warehouse"] = {
    wood: warehouse.wood ?? 0,
    stone: warehouse.stone ?? 0,
    iron: warehouse.iron ?? 0,
    arcane: warehouse.arcane ?? 0,
    food: warehouse.food ?? 0,
  };
  return {
    name: s.name ?? s.id,
    ownerId: s.ownerId ?? null,
    population: s.population ?? defaultPopulation(s.level),
    goldTax: s.goldTax ?? SETTLEMENT_GOLD_TAX[s.level],
    resourceRates: s.resourceRates ?? {},
    foundedOnResource: s.foundedOnResource ?? null,
    gold: s.gold ?? 0,
    warehouse: filledWarehouse,
    morale: s.morale ?? 100,
    autoTrade: s.autoTrade ?? true,
    q: s.q,
    r: s.r,
    level: s.level,
    id: s.id,
  };
}

export function hydrateGameState(
  row: Game,
  opts?: HydrateOptions,
): GameState {
  const settlementsRecord: Record<string, SettlementState> = {};
  for (const [id, raw] of Object.entries(row.settlements)) {
    settlementsRecord[id] = backfillSettlement({ ...raw, id });
  }
  const heroesRecord: Record<HeroId, HeroState> = {};
  for (const [id, raw] of Object.entries(row.heroes)) {
    heroesRecord[id] = backfillHero({
      ...raw,
      id,
      ownerId: raw.ownerId,
      q: raw.q,
      r: raw.r,
    });
  }
  return {
    round: row.round,
    day: row.day ?? row.round,
    activePlayerId: row.active_player_id,
    players: row.players,
    heroes: heroesRecord,
    settlements: settlementsRecord,
    phase:
      row.players.find((p) => p.id === row.active_player_id)?.faction === "ai"
        ? { kind: "AI_TURN", playerId: row.active_player_id }
        : { kind: "PLAYER_TURN", playerId: row.active_player_id },
    selectedHeroId: null,
    selectedSettlementId: null,
    dirty: false,
    castleSeed: opts?.castleSeed ?? defaultCastleSeedFromMapSeed(row.seed),
    castleCount: opts?.castleCount ?? CASTLE_COUNT_DEFAULT,
  };
}

export function defaultHeroesRecord(): HeroState[] {
  return [];
}

export function playerHeroId(): HeroId {
  return heroIdFor(0);
}

export function aiHeroIds(): HeroId[] {
  return [heroIdFor(1), heroIdFor(2)];
}

export function seedCastlePositions(): Array<{ id: string; q: number; r: number; level: 1 | 2 | 3; ownerId: number | null }> {
  return [];
}

export function generatedCastles(
  map: GameMap,
  opts: { castleSeed: number; castleCount?: number; playerCount?: number },
): Castle[] {
  const playerCount = opts.playerCount ?? 3;
  return generateCastles(map, {
    castleSeed: opts.castleSeed,
    playerCount,
    castleCount: Math.max(opts.castleCount ?? CASTLE_COUNT_DEFAULT, playerCount),
  });
}

export function castlesFromCurrentState(state: GameState): Castle[] {
  return castlesFromGameState(state.settlements);
}

export { CASTLE_COUNT_MIN, CASTLE_COUNT_MAX, CASTLE_COUNT_DEFAULT };
