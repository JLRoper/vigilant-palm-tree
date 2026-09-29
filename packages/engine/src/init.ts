import type {
  GameState,
  HeroId,
  HeroState,
  InitialStateOptions,
  PlacedCastle,
  Player,
  SettlementId,
  SettlementState,
} from "@heroes/contracts";
import { MOVEMENT_PER_TURN } from "@heroes/contracts";
import type { GameMap } from "./map/gameMap";
import { defaultCastleSeedFromMapSeed } from "./hydrate";
import { generateCastles } from "./map/castlePlacement";
import {
  computeSettlementRates,
  defaultPopulation,
  generateSettlementName,
  SETTLEMENT_GOLD_TAX,
} from "./economy/settlementRates";
import { DEFAULT_HERO_ARCANE, DEFAULT_HERO_INTELLIGENCE } from "./combatConfig";
import { DEFAULT_HERO_SPELL, maxManaFor } from "./combat/spells";
import { DEFAULT_HERO_WAGONS } from "./settlement/capacity";
import { demoPlatoonsForPlayer, normalizePlatoons, platoonTroopTotal } from "./units";
import { MAX_PLAYERS, PLAYER_COLORS } from "./playerColors";
import { cityViewSizeFor, generateCitySpots } from "./settlement/citySpots";
import { VALID_HORSE_VARIANTS } from "./horseVariants";

const DEFAULT_PLAYER_COUNT = 3;
const MAX_PLAYER_COUNT = MAX_PLAYERS;
const STARTING_GOLD = 300;
const STARTING_WAREHOUSE: SettlementState["warehouse"] = { wood: 300, stone: 300, iron: 300, arcane: 300, food: 0 };

const MANA_POOL_V1 = maxManaFor(DEFAULT_HERO_INTELLIGENCE);

function heroIdFor(playerIdx: number): HeroId {
  return `p${playerIdx}-hero`;
}

export interface BuildInitialOptions {
  castleSeed?: number;
  castleCount?: number;
  playerCount?: number;
  humanSeatCount?: number;
  enemyCount?: number;
}

function clampPlayerCount(n: number | undefined): number {
  if (!n || !Number.isFinite(n)) return DEFAULT_PLAYER_COUNT;
  return Math.max(2, Math.min(MAX_PLAYER_COUNT, Math.floor(n)));
}

function enemyDerivedPlayerCount(opts: BuildInitialOptions | undefined): number | null {
  const enemyCount = opts?.enemyCount;
  if (enemyCount === undefined || !Number.isFinite(enemyCount)) return null;
  const rawHumans = opts?.humanSeatCount;
  const humans = Number.isFinite(rawHumans) ? Math.max(1, Math.floor(rawHumans as number)) : 1;
  return Math.min(MAX_PLAYERS, Math.max(humans, humans + Math.floor(enemyCount)));
}

function clampHumanSeatCount(n: number | undefined, playerCount: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(playerCount, Math.floor(n as number)));
}

function defaultPlayers(): Player[] {
  return [
    { id: 0, faction: "player", name: "Player 1", color: "#d62828", heroIds: ["h0"], settlementIds: ["s0"] },
    { id: 1, faction: "ai", name: "AI", color: "#1d7dd1", heroIds: ["h1"], settlementIds: ["s1"] },
  ];
}

function defaultHeroes(): Record<HeroId, HeroState> {
  const h0Stacks = normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 12 }] }, { entries: [{ unitTypeId: "archer", count: 8 }] }, { entries: [{ unitTypeId: "cavalry", count: 4 }] }]);
  const h1Stacks = normalizePlatoons([{ entries: [{ unitTypeId: "crossbowman", count: 10 }] }, { entries: [{ unitTypeId: "griffin", count: 3 }] }]);
  return {
    h0: { id: "h0", name: "Commander", ownerId: 0, q: 2, r: 2, movementRemaining: MOVEMENT_PER_TURN, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q: 2, r: 2 }], gold: 300, troops: platoonTroopTotal(h0Stacks), stacks: h0Stacks, isChartering: false, charterId: null, horseVariant: "bubbly", arcane: DEFAULT_HERO_ARCANE, intelligence: DEFAULT_HERO_INTELLIGENCE, heroMana: MANA_POOL_V1, heroMaxMana: MANA_POOL_V1, heroSpell: DEFAULT_HERO_SPELL },
    h1: { id: "h1", name: "Shadow Knight", ownerId: 1, q: 18, r: 4, movementRemaining: MOVEMENT_PER_TURN, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q: 18, r: 4 }], gold: 300, troops: platoonTroopTotal(h1Stacks), stacks: h1Stacks, isChartering: false, charterId: null, horseVariant: "shadow", arcane: DEFAULT_HERO_ARCANE, intelligence: DEFAULT_HERO_INTELLIGENCE, heroMana: MANA_POOL_V1, heroMaxMana: MANA_POOL_V1, heroSpell: DEFAULT_HERO_SPELL },
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
    tradeRoutes: [],
    nextTradeRouteId: 0,
  };
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
    const name = isHuman ? `Player ${i + 1}` : `AI ${i + 1 - humanSeatCount}`;
    out.push({
      id: i,
      faction,
      name,
      color: PLAYER_COLORS[i] ?? "#cccccc",
      heroIds: [heroIdFor(i)],
      settlementIds: settlementIds[`p${i}`] ?? [],
      // Wagon pool (docs/wagons-stockpiles-trade-routes-plan.md §5.1): the
      // 5 starting wagons are already assigned to the starting hero.
      wagonsOwned: 5,
      wagonsUnassigned: 0,
    });  }
  return out;
}

function makeHeroes(
  castles: PlacedCastle[],
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
    const manaPool = maxManaFor(DEFAULT_HERO_INTELLIGENCE);
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
      stacks: demoPlatoonsForPlayer(i),
      troops: platoonTroopTotal(demoPlatoonsForPlayer(i)),
      isChartering: false,
      charterId: null,
      horseVariant: variantIds[Math.floor(rng() * variantIds.length)],
      // Spellcasting v1 (docs/spellcasting-plan.md): fixed starting stat
      // block, full mana bar, Magic Arrow for every hero.
      arcane: DEFAULT_HERO_ARCANE,
      intelligence: DEFAULT_HERO_INTELLIGENCE,
      heroMana: manaPool,
      heroMaxMana: manaPool,
      heroSpell: DEFAULT_HERO_SPELL,
      // Wagons & cargo (docs/wagons-stockpiles-trade-routes-plan.md §4.2):
      // 5 wagons = 2,500g purse cap, exactly the charter cost.
      wagons: DEFAULT_HERO_WAGONS,
      resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
    });
  }
  return heroes;
}

function makeSettlements(
  map: GameMap,
  rng: () => number,
  castles: PlacedCastle[],
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
  const playerCount = enemyDerivedPlayerCount(opts) ?? clampPlayerCount(opts?.playerCount);
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
  const playerCount = enemyDerivedPlayerCount(opts) ?? (opts?.playerCount ?? 3);
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

export function playerHeroId(): HeroId {
  return heroIdFor(0);
}
