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
  computeSettlementRates,
  defaultPopulation,
  generateSettlementName,
  SETTLEMENT_GOLD_TAX,
} from "../economy/settlementRates";

const PLAYER_HERO_ID: HeroId = "p0-hero";
const AI_HERO_ID: HeroId = "p1-hero";
const EXTRA_AI_HERO_ID: HeroId = "p1-hero-2";

interface SeedCastle {
  id: string;
  q: number;
  r: number;
  level: 1 | 2 | 3;
  ownerId: number | null;
}

const SEED_CASTLES: SeedCastle[] = [
  { id: "castle-l1", q: 6, r: 5, level: 1, ownerId: 0 },
  { id: "castle-l2", q: 14, r: 8, level: 2, ownerId: 1 },
  { id: "castle-l3", q: 10, r: 12, level: 3, ownerId: null },
];

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

function makeHeroes(seed: SeedCastle[]): HeroState[] {
  const l1 = seed.find((c) => c.id === "castle-l1")!;
  const l2 = seed.find((c) => c.id === "castle-l2")!;
  return [
    {
      id: PLAYER_HERO_ID,
      ownerId: 0,
      q: l1.q,
      r: l1.r,
      movementRemaining: 7,
      previousQ: null,
      previousR: null,
      previousMovementRemaining: null,
    },
    {
      id: AI_HERO_ID,
      ownerId: 1,
      q: l2.q,
      r: l2.r,
      movementRemaining: 7,
      previousQ: null,
      previousR: null,
      previousMovementRemaining: null,
    },
    {
      id: EXTRA_AI_HERO_ID,
      ownerId: 1,
      q: l2.q + 3,
      r: l2.r + 1,
      movementRemaining: 7,
      previousQ: null,
      previousR: null,
      previousMovementRemaining: null,
    },
  ];
}

function makeSettlements(
  map: GameMap,
  rng: () => number,
  seed: SeedCastle[] = SEED_CASTLES,
): SettlementState[] {
  return seed.map((c) => {
    const computed = computeSettlementRates(map, c.q, c.r, c.level);
    return {
      id: c.id,
      name: generateSettlementName(rng, c.ownerId),
      ownerId: c.ownerId,
      q: c.q,
      r: c.r,
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

export function buildInitialGameState(map: GameMap, rng: () => number): GameState {
  const settlements = makeSettlements(map, rng);
  const settlementIds = splitByOwner(settlements);
  return createInitialState({
    seedPlayers: makePlayers(settlementIds),
    seedHeroes: makeHeroes(SEED_CASTLES),
    seedSettlements: settlements,
    seedRound: 1,
    seedActivePlayerId: 0,
  });
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

export function hydrateGameState(row: Game, map: GameMap, rng: () => number): GameState {
  if (
    typeof row.round === "number" &&
    typeof row.active_player_id === "number" &&
    Array.isArray(row.players) &&
    row.players.length > 0 &&
    row.heroes &&
    Object.keys(row.heroes).length > 0 &&
    row.settlements &&
    Object.keys(row.settlements).length > 0
  ) {
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
    };
  }

  const settlements = makeSettlements(map, rng);
  const settlementIds = splitByOwner(settlements);
  const players = makePlayers(settlementIds);
  const heroQ = row.hero_q;
  const heroR = row.hero_r;
  const heroes: Record<string, HeroState> = {
    [PLAYER_HERO_ID]: {
      id: PLAYER_HERO_ID,
      ownerId: 0,
      q: heroQ,
      r: heroR,
      movementRemaining: 7,
      previousQ: null,
      previousR: null,
      previousMovementRemaining: null,
    },
  };
  for (let i = 0; i < players[1].heroIds.length; i++) {
    const id = players[1].heroIds[i];
    const pos = row.enemy_positions[i];
    if (!pos) continue;
    heroes[id] = {
      id,
      ownerId: 1,
      q: pos.q,
      r: pos.r,
      movementRemaining: 7,
      previousQ: null,
      previousR: null,
      previousMovementRemaining: null,
    };
  }
  const l2 = SEED_CASTLES.find((c) => c.id === "castle-l2")!;
  if (!heroes[AI_HERO_ID]) {
    heroes[AI_HERO_ID] = {
      id: AI_HERO_ID,
      ownerId: 1,
      q: l2.q,
      r: l2.r,
      movementRemaining: 7,
      previousQ: null,
      previousR: null,
      previousMovementRemaining: null,
    };
  }
  if (!heroes[EXTRA_AI_HERO_ID]) {
    heroes[EXTRA_AI_HERO_ID] = {
      id: EXTRA_AI_HERO_ID,
      ownerId: 1,
      q: l2.q + 3,
      r: l2.r + 1,
      movementRemaining: 7,
      previousQ: null,
      previousR: null,
      previousMovementRemaining: null,
    };
  }
  for (const id of players[1].heroIds) {
    if (!heroes[id]) players[1].heroIds = players[1].heroIds.filter((x) => x !== id);
  }
  return {
    round: 1,
    activePlayerId: 0,
    players,
    heroes,
    settlements: Object.fromEntries(settlements.map((s) => [s.id, s])),
    phase: { kind: "PLAYER_TURN", playerId: 0 },
    selectedHeroId: null,
    dirty: false,
  };
}

export function defaultHeroesRecord(): HeroState[] {
  return makeHeroes(SEED_CASTLES);
}

export function playerHeroId(): HeroId {
  return PLAYER_HERO_ID;
}

export function aiHeroIds(): HeroId[] {
  return [AI_HERO_ID, EXTRA_AI_HERO_ID];
}

export function seedCastlePositions(): { id: string; q: number; r: number; level: 1 | 2 | 3; ownerId: number | null }[] {
  return SEED_CASTLES.map((c) => ({ ...c }));
}
