import {
  createInitialState,
  type GameState,
  type HeroId,
  type HeroState,
  type Player,
  type SettlementState,
} from "../state/gameState";
import { CASTLES } from "../entities/settlement";
import type { Game } from "../io/api";

const PLAYER_HERO_ID: HeroId = "p0-hero";
const AI_HERO_ID: HeroId = "p1-hero";
const EXTRA_AI_HERO_ID: HeroId = "p1-hero-2";

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

function makeHeroes(map = CASTLES): HeroState[] {
  const l1 = map.find((c) => c.id === "castle-l1")!;
  const l2 = map.find((c) => c.id === "castle-l2")!;
  return [
    {
      id: PLAYER_HERO_ID,
      ownerId: 0,
      q: l1.tile.q,
      r: l1.tile.r,
      movementRemaining: 7,
      previousQ: null,
      previousR: null,
      previousMovementRemaining: null,
    },
    {
      id: AI_HERO_ID,
      ownerId: 1,
      q: l2.tile.q,
      r: l2.tile.r,
      movementRemaining: 7,
      previousQ: null,
      previousR: null,
      previousMovementRemaining: null,
    },
    {
      id: EXTRA_AI_HERO_ID,
      ownerId: 1,
      q: l2.tile.q + 3,
      r: l2.tile.r + 1,
      movementRemaining: 7,
      previousQ: null,
      previousR: null,
      previousMovementRemaining: null,
    },
  ];
}

function makeSettlements(): SettlementState[] {
  return CASTLES.map((c) => c.toGameState());
}

export function buildInitialGameState(): GameState {
  const settlements = makeSettlements();
  const settlementIds: Record<string, string[]> = {};
  for (const s of settlements) {
    const key = s.ownerId === 0 ? "p0" : s.ownerId === 1 ? "p1" : "neutral";
    if (!settlementIds[key]) settlementIds[key] = [];
    settlementIds[key].push(s.id);
  }
  return createInitialState({
    seedPlayers: makePlayers(settlementIds),
    seedHeroes: makeHeroes(),
    seedSettlements: settlements,
    seedRound: 1,
    seedActivePlayerId: 0,
  });
}

export function hydrateGameState(row: Game): GameState {
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
    return {
      round: row.round,
      activePlayerId: row.active_player_id,
      players: row.players,
      heroes: row.heroes,
      settlements: row.settlements,
      phase:
        row.players.find((p) => p.id === row.active_player_id)?.faction === "ai"
          ? { kind: "AI_TURN", playerId: row.active_player_id }
          : { kind: "PLAYER_TURN", playerId: row.active_player_id },
      selectedHeroId: null,
      dirty: false,
    };
  }

  const settlements = makeSettlements();
  const settlementIds: Record<string, string[]> = {};
  for (const s of settlements) {
    const key = s.ownerId === 0 ? "p0" : s.ownerId === 1 ? "p1" : "neutral";
    if (!settlementIds[key]) settlementIds[key] = [];
    settlementIds[key].push(s.id);
  }
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
  if (!heroes[AI_HERO_ID]) {
    const l2 = CASTLES.find((c) => c.id === "castle-l2")!;
    heroes[AI_HERO_ID] = {
      id: AI_HERO_ID,
      ownerId: 1,
      q: l2.tile.q,
      r: l2.tile.r,
      movementRemaining: 7,
      previousQ: null,
      previousR: null,
      previousMovementRemaining: null,
    };
  }
  if (!heroes[EXTRA_AI_HERO_ID]) {
    const l2 = CASTLES.find((c) => c.id === "castle-l2")!;
    heroes[EXTRA_AI_HERO_ID] = {
      id: EXTRA_AI_HERO_ID,
      ownerId: 1,
      q: l2.tile.q + 3,
      r: l2.tile.r + 1,
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
  return makeHeroes();
}

export function playerHeroId(): HeroId {
  return PLAYER_HERO_ID;
}

export function aiHeroIds(): HeroId[] {
  return [AI_HERO_ID, EXTRA_AI_HERO_ID];
}
