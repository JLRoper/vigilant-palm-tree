import {
  createInitialState,
  WAREHOUSE_RESOURCES,
  type GameState,
  type HeroId,
  type HeroState,
  type Player,
  type SettlementState,
} from "../state/gameState";
import { demoPlatoonsForPlayer, normalizePlatoons } from "../state/units";
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
import { generateCitySpots } from "../core/citySpots";
import { cityViewSizeFor } from "../core/cityGrid";
import { VALID_HORSE_VARIANTS } from "../../shared/horseVariants";

const DEFAULT_PLAYER_COUNT = 3;
const MAX_PLAYER_COUNT = MAX_PLAYERS;
const STARTING_GOLD = 300;
const STARTING_WAREHOUSE: SettlementState["warehouse"] = { wood: 300, stone: 300, iron: 300, arcane: 300, food: 0 };

function heroIdFor(playerIdx: number): HeroId {
  return `p${playerIdx}-hero`;
}

interface BuildInitialOptions {
  castleSeed?: number;
  castleCount?: number;
  playerCount?: number;
  humanSeatCount?: number;
}

interface HydrateOptions {
  castleSeed?: number;
  castleCount?: number;
}

function clampPlayerCount(n: number | undefined): number {
  if (!n || !Number.isFinite(n)) return DEFAULT_PLAYER_COUNT;
  return Math.max(2, Math.min(MAX_PLAYER_COUNT, Math.floor(n)));
}

function clampHumanSeatCount(n: number | undefined, playerCount: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(playerCount, Math.floor(n as number)));
}

function makePlayers(
  settlementIds: Record<string, string[]>,
  playerCount: number,
  humanSeatCount: number,
): Player[] {
  const out: Player[] = [];
  for (let i = 0; i < playerCount; i++) {
    const isHuman = i < humanSeatCount;
    const faction: Player["faction"] = isHuman ? "player" : "ai";
    const name = isHuman ? (i === 0 ? "Human" : `Human ${i + 1}`) : `AI ${i + 1 - humanSeatCount}`;
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
  rng: () => number,
  humanSeatCount: number,
): HeroState[] {
  const heroes: HeroState[] = [];
  for (let i = 0; i < playerCount; i++) {
    const castle = castles.find((c) => c.ownerId === i);
    if (!castle) continue;
    const variantIds = VALID_HORSE_VARIANTS;
    const isHuman = i < humanSeatCount;
    heroes.push({
      id: heroIdFor(i),
      name: isHuman ? "Commander" : "Warlord",
      ownerId: i,
      q: castle.tile.q,
      r: castle.tile.r,
      movementRemaining: 7,
      previousQ: null,
      previousR: null,
      previousMovementRemaining: null,
      trail: [{ q: castle.tile.q, r: castle.tile.r }],
      gold: STARTING_GOLD,
      troops: 1,
      stacks: demoPlatoonsForPlayer(i),
      isChartering: false,
      charterId: null,
      horseVariant: variantIds[Math.floor(rng() * variantIds.length)],
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
    const size = cityViewSizeFor(c.level);
    const { spots, mines } = generateCitySpots(size, rng);
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
      gold: STARTING_GOLD,
      warehouse: { ...STARTING_WAREHOUSE },
      citySpots: spots,
      cityMines: mines,
      morale: 100,
      autoTrade: true,
      castleVariant: rng() < 0.5 ? 1 : 0,
      buildings: [],
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
  const playerCount = clampPlayerCount(opts?.playerCount);
  const humanSeatCount = clampHumanSeatCount(opts?.humanSeatCount, playerCount);
  const castleCount = opts?.castleCount ?? (2 * playerCount);

  const castles = generateCastles(map, {
    castleSeed,
    playerCount,
    castleCount: Math.max(castleCount, playerCount),
  });

  const settlements = makeSettlements(map, rng, castles, playerCount);
  const settlementIds = splitByOwner(settlements);
  return createInitialState({
    seedPlayers: makePlayers(settlementIds, playerCount, humanSeatCount),
    seedHeroes: makeHeroes(castles, playerCount, rng, humanSeatCount),
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
  const playerCount = opts?.playerCount ?? 3;
  const humanSeatCount = clampHumanSeatCount(opts?.humanSeatCount, playerCount);
  const castleCount = opts?.castleCount ?? (2 * playerCount);

  const castles = generateCastles(map, {
    castleSeed,
    playerCount,
    castleCount: Math.max(castleCount, playerCount),
  });
  const settlements = makeSettlements(map, rng, castles, playerCount);
  const settlementIds = splitByOwner(settlements);
  const players = makePlayers(settlementIds, playerCount, humanSeatCount);
  const heroes = makeHeroes(castles, playerCount, rng, humanSeatCount);
  return {
    round: 1,
    day: 1,
    active_player_id: 0,
    players,
    heroes: Object.fromEntries(heroes.map((h) => [h.id, h])),
    settlements: Object.fromEntries(settlements.map((s) => [s.id, s])),
  };
}

function warnMissing(path: string, field: string): void {
  console.warn(`[hydrateGameState] ${path} missing "${field}"; using default`);
}

function backfillHero(h: Partial<import("../state/gameState").HeroState> & { id: import("../state/gameState").HeroId; ownerId: number; q: number; r: number }): import("../state/gameState").HeroState {
  const variantIds = VALID_HORSE_VARIANTS;
  const path = `heroes.${h.id}`;
  if (h.movementRemaining === undefined) warnMissing(path, "movementRemaining");
  if (h.gold === undefined) warnMissing(path, "gold");
  if (h.troops === undefined) warnMissing(path, "troops");
  if (h.stacks === undefined) warnMissing(path, "stacks");
  if (h.horseVariant === undefined) warnMissing(path, "horseVariant");
  return {
    movementRemaining: h.movementRemaining ?? 7,
    previousQ: h.previousQ ?? null,
    previousR: h.previousR ?? null,
    previousMovementRemaining: h.previousMovementRemaining ?? null,
    trail: h.trail ?? [{ q: h.q, r: h.r }],
    gold: h.gold ?? 0,
    troops: h.troops ?? 1,
    stacks: normalizePlatoons(h.stacks),
    isChartering: h.isChartering ?? false,
    charterId: h.charterId ?? null,
    id: h.id,
    name: h.name ?? h.id,
    ownerId: h.ownerId,
    q: h.q,
    r: h.r,
    horseVariant: h.horseVariant ?? variantIds[0],
  };
}

function emptyWarehouse(): SettlementState["warehouse"] {
  return { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 };
}

function backfillSettlement(s: Partial<SettlementState> & { id: string; q: number; r: number; level: 1 | 2 | 3 }): SettlementState {
  const path = `settlements.${s.id}`;
  if (s.warehouse === undefined) {
    warnMissing(path, "warehouse");
  } else {
    for (const res of WAREHOUSE_RESOURCES) {
      if (s.warehouse[res] === undefined) warnMissing(`${path}.warehouse`, res);
    }
  }
  if (s.population === undefined) warnMissing(path, "population");
  if (s.goldTax === undefined) warnMissing(path, "goldTax");
  if (s.morale === undefined) warnMissing(path, "morale");
  if (s.autoTrade === undefined) warnMissing(path, "autoTrade");
  if (s.castleVariant === undefined) warnMissing(path, "castleVariant");
  if (s.buildings === undefined) warnMissing(path, "buildings");
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
    citySpots: s.citySpots ?? [],
    cityMines: s.cityMines ?? [],
    morale: s.morale ?? 100,
    autoTrade: s.autoTrade ?? true,
    q: s.q,
    r: s.r,
    level: s.level,
    id: s.id,
    castleVariant: s.castleVariant ?? 0,
    buildings: (s as any).buildings ?? [],
    upgrade: (s as any).upgrade ?? undefined,
  };
}

export function hydrateGameState(
  row: Game,
  opts?: HydrateOptions,
): GameState {
  if (row.day === undefined) warnMissing(row.name ? `games.${row.name}` : "game", "day");
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
  const settlementCount = Object.keys(settlementsRecord).length;
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
    activeCharters: (row as unknown as { activeCharters?: GameState["activeCharters"] }).activeCharters ?? [],
    nextCharterId: (row as unknown as { nextCharterId?: number }).nextCharterId ?? 0,
    nextSettlementId: (row as unknown as { nextSettlementId?: number }).nextSettlementId ?? settlementCount,
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
    castleCount: Math.max(opts.castleCount ?? (2 * playerCount), playerCount),
  });
}

export function castlesFromCurrentState(state: GameState): Castle[] {
  return castlesFromGameState(state.settlements);
}

export { CASTLE_COUNT_MIN, CASTLE_COUNT_MAX, CASTLE_COUNT_DEFAULT };
