import {
  createInitialState,
  type GameState,
  type HeroId,
  type HeroState,
  type Player,
  type SettlementState,
} from "../state/gameState";
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

const PLAYER_HERO_ID: HeroId = "p0-hero";
const AI_HERO_ID: HeroId = "p1-hero";
const EXTRA_AI_HERO_ID: HeroId = "p1-hero-2";

interface BuildInitialOptions {
  castleSeed?: number;
  castleCount?: number;
}

interface HydrateOptions {
  castleSeed?: number;
  castleCount?: number;
}

function makePlayers(settlementIds: Record<string, string[]>): Player[] {
  return [
    {
      id: 0,
      faction: "player",
      name: "Human",
      heroIds: [PLAYER_HERO_ID],
      settlementIds: settlementIds["p0"] ?? [],
      gold: 0,
    },
    {
      id: 1,
      faction: "ai",
      name: "AI",
      heroIds: [AI_HERO_ID, EXTRA_AI_HERO_ID],
      settlementIds: settlementIds["p1"] ?? [],
      gold: 0,
    },
  ];
}

function makeHeroes(castles: Castle[], map?: { width: number; height: number }): HeroState[] {
  const player = castles.find((c) => c.ownerId === 0);
  const ai = castles.find((c) => c.ownerId === 1);
  const heroes: HeroState[] = [];
  if (player) {
    heroes.push({
      id: PLAYER_HERO_ID,
      ownerId: 0,
      q: player.tile.q,
      r: player.tile.r,
      movementRemaining: 7,
      previousQ: null,
      previousR: null,
      previousMovementRemaining: null,
    });
  }
  if (ai) {
    heroes.push({
      id: AI_HERO_ID,
      ownerId: 1,
      q: ai.tile.q,
      r: ai.tile.r,
      movementRemaining: 7,
      previousQ: null,
      previousR: null,
      previousMovementRemaining: null,
    });
    let extraQ = ai.tile.q + 3;
    let extraR = ai.tile.r + 1;
    if (map) {
      extraQ = Math.max(0, Math.min(map.width - 1, extraQ));
      extraR = Math.max(0, Math.min(map.height - 1, extraR));
    }
    heroes.push({
      id: EXTRA_AI_HERO_ID,
      ownerId: 1,
      q: extraQ,
      r: extraR,
      movementRemaining: 7,
      previousQ: null,
      previousR: null,
      previousMovementRemaining: null,
    });
  }
  return heroes;
}

function makeSettlements(map: GameMap, rng: () => number, castles: Castle[]): SettlementState[] {
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
    };
  });
}

function splitByOwner(settlements: SettlementState[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const s of settlements) {
    const key = s.ownerId === 0 ? "p0" : s.ownerId === 1 ? "p1" : "neutral";
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

  const castles = generateCastles(map, {
    castleSeed,
    castleCount,
  });

  const settlements = makeSettlements(map, rng, castles);
  const settlementIds = splitByOwner(settlements);
  return createInitialState({
    seedPlayers: makePlayers(settlementIds),
    seedHeroes: makeHeroes(castles, map),
    seedSettlements: settlements,
    seedRound: 1,
    seedActivePlayerId: 0,
    seedCastleSeed: castleSeed,
    seedCastleCount: castleCount,
  });
}

export interface InitialStatePayload {
  round: number;
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

  const castles = generateCastles(map, { castleSeed, castleCount });
  const settlements = makeSettlements(map, rng, castles);
  const settlementIds = splitByOwner(settlements);
  const players = makePlayers(settlementIds);
  const heroes = makeHeroes(castles, map);
  return {
    round: 1,
    active_player_id: 0,
    players,
    heroes: Object.fromEntries(heroes.map((h) => [h.id, h])),
    settlements: Object.fromEntries(settlements.map((s) => [s.id, s])),
  };
}

function backfillSettlement(s: Partial<SettlementState> & { id: string; q: number; r: number; level: 1 | 2 | 3 }): SettlementState {
  return {
    name: s.name ?? s.id,
    ownerId: s.ownerId ?? null,
    population: s.population ?? defaultPopulation(s.level),
    goldTax: s.goldTax ?? SETTLEMENT_GOLD_TAX[s.level],
    resourceRates: s.resourceRates ?? {},
    foundedOnResource: s.foundedOnResource ?? null,
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
  return {
    round: row.round,
    activePlayerId: row.active_player_id,
    players: row.players,
    heroes: row.heroes,
    settlements: settlementsRecord,
    phase:
      row.players.find((p) => p.id === row.active_player_id)?.faction === "ai"
        ? { kind: "AI_TURN", playerId: row.active_player_id }
        : { kind: "PLAYER_TURN", playerId: row.active_player_id },
    selectedHeroId: null,
    dirty: false,
    castleSeed: opts?.castleSeed ?? defaultCastleSeedFromMapSeed(row.seed),
    castleCount: opts?.castleCount ?? CASTLE_COUNT_DEFAULT,
  };
}

export function defaultHeroesRecord(): HeroState[] {
  return [];
}

export function playerHeroId(): HeroId {
  return PLAYER_HERO_ID;
}

export function aiHeroIds(): HeroId[] {
  return [AI_HERO_ID, EXTRA_AI_HERO_ID];
}

export function seedCastlePositions(): Array<{ id: string; q: number; r: number; level: 1 | 2 | 3; ownerId: number | null }> {
  return [];
}

export function generatedCastles(
  map: GameMap,
  opts: { castleSeed: number; castleCount?: number },
): Castle[] {
  return generateCastles(map, {
    castleSeed: opts.castleSeed,
    castleCount: opts.castleCount ?? CASTLE_COUNT_DEFAULT,
  });
}

export function castlesFromCurrentState(state: GameState): Castle[] {
  return castlesFromGameState(state.settlements);
}

export { CASTLE_COUNT_MIN, CASTLE_COUNT_MAX, CASTLE_COUNT_DEFAULT };
