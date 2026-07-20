import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createInitialState,
  selectHero,
  clearSelection,
  startMove,
  cancelMove,
  detectAdjacentEnemy,
  startBattle,
  resolveBattle,
  endTurn,
  applyEndOfTurn,
  advanceRound,
  markSaved,
  MOVEMENT_PER_TURN,
  BATTLE_GOLD_REWARD,
  type GameState,
  type Player,
  type HeroState,
  type SettlementState,
  type PlayerId,
  type HeroId,
  type GamePhase,
} from "../../src/state/gameState";

function makePlayer(id: PlayerId, faction: Player["faction"], name: string, heroIds: HeroId[], settlementIds: string[], gold = 0): Player {
  return { id, faction, name, heroIds, settlementIds, gold };
}

function makeHero(id: HeroId, ownerId: PlayerId, q: number, r: number, movementRemaining = MOVEMENT_PER_TURN): HeroState {
  return { id, ownerId, q, r, movementRemaining, previousQ: null, previousR: null, previousMovementRemaining: null };
}

interface StateOverrides {
  players?: Player[];
  heroes?: HeroState[];
  settlements?: SettlementState[];
  round?: number;
  activePlayerId?: PlayerId;
  phase?: GamePhase;
  selectedHeroId?: HeroId | null;
}

function makeState(overrides: StateOverrides = {}): GameState {
  const players = overrides.players ?? [
    makePlayer(0, "player", "Human", ["h0"], ["s0"], 0),
    makePlayer(1, "ai", "AI", ["h1"], ["s1"], 0),
  ];
  const heroes = overrides.heroes ?? [
    makeHero("h0", 0, 2, 2),
    makeHero("h1", 1, 18, 4),
  ];
  const settlements = overrides.settlements ?? [
    { id: "s0", ownerId: 0, q: 2, r: 2, level: 1 },
    { id: "s1", ownerId: 1, q: 18, r: 4, level: 1 },
  ];
  const initial = createInitialState({
    seedPlayers: players,
    seedHeroes: heroes,
    seedSettlements: settlements,
    seedRound: overrides.round ?? 1,
    seedActivePlayerId: overrides.activePlayerId ?? 0,
  });
  if (overrides.phase) return { ...initial, phase: overrides.phase };
  if (overrides.selectedHeroId !== undefined) return { ...initial, selectedHeroId: overrides.selectedHeroId };
  return initial;
}

test("createInitialState defaults", () => {
  const s = createInitialState();
  assert.equal(s.round, 1);
  assert.equal(s.activePlayerId, 0);
  assert.equal(s.players.length, 2);
  assert.equal(s.players[0].faction, "player");
  assert.equal(s.players[1].faction, "ai");
  for (const h of Object.values(s.heroes)) {
    assert.equal(h.movementRemaining, MOVEMENT_PER_TURN);
  }
  assert.equal(s.phase.kind, "PLAYER_TURN");
  assert.equal(s.selectedHeroId, null);
  assert.equal(s.dirty, false);
});

test("createInitialState with seeds", () => {
  const s = createInitialState({
    seedPlayers: [makePlayer(0, "player", "P", ["h0"], ["s0"], 100)],
    seedHeroes: [makeHero("h0", 0, 5, 5, 3)],
    seedSettlements: [{ id: "s0", ownerId: 0, q: 5, r: 5, level: 2 }],
    seedRound: 7,
    seedActivePlayerId: 0,
  });
  assert.equal(s.round, 7);
  assert.equal(s.players[0].gold, 100);
  assert.equal(s.heroes.h0.movementRemaining, 3);
  assert.equal(s.settlements.s0.level, 2);
});

test("selectHero accepts owned hero of active human player", () => {
  const s = makeState();
  const next = selectHero(s, "h0");
  assert.equal(next.selectedHeroId, "h0");
});

test("selectHero rejects when no hero exists", () => {
  const s = makeState();
  const next = selectHero(s, "ghost");
  assert.equal(next.selectedHeroId, null);
});

test("selectHero rejects hero of other player", () => {
  const s = makeState();
  const next = selectHero(s, "h1");
  assert.equal(next.selectedHeroId, null);
});

test("selectHero rejects during AI_TURN phase", () => {
  const s = makeState({ phase: { kind: "AI_TURN", playerId: 1 } });
  const next = selectHero(s, "h1");
  assert.equal(next.selectedHeroId, null);
});

test("selectHero rejects when active player is ai faction", () => {
  const s = makeState({
    players: [makePlayer(0, "ai", "AI1", ["h0"], ["s0"]), makePlayer(1, "player", "Human", ["h1"], ["s1"])],
    heroes: [makeHero("h0", 0, 0, 0), makeHero("h1", 1, 10, 10)],
    settlements: [
      { id: "s0", ownerId: 0, q: 0, r: 0, level: 1 },
      { id: "s1", ownerId: 1, q: 10, r: 10, level: 1 },
    ],
    activePlayerId: 0,
    phase: { kind: "PLAYER_TURN", playerId: 0 },
  });
  const next = selectHero(s, "h0");
  assert.equal(next.selectedHeroId, null);
});

test("clearSelection clears selectedHeroId", () => {
  const s = makeState({ selectedHeroId: "h0" });
  const next = clearSelection(s);
  assert.equal(next.selectedHeroId, null);
});

test("startMove succeeds when valid", () => {
  const s = makeState({ selectedHeroId: "h0" });
  const result = startMove(s, "h0", { q: 3, r: 2 }, 1);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.state.heroes.h0.q, 3);
    assert.equal(result.state.heroes.h0.r, 2);
    assert.equal(result.state.heroes.h0.movementRemaining, 6);
    assert.equal(result.state.dirty, true);
  }
});

test("startMove deducts cost correctly", () => {
  const s = makeState({ selectedHeroId: "h0" });
  const result = startMove(s, "h0", { q: 4, r: 2 }, 2);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.state.heroes.h0.movementRemaining, 5);
  }
});

test("startMove rejects insufficient movement", () => {
  const s = makeState({ selectedHeroId: "h0" });
  const result = startMove(s, "h0", { q: 3, r: 2 }, 10);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "insufficient_movement");
});

test("startMove rejects when not active player", () => {
  const s = makeState({ selectedHeroId: "h0" });
  const result = startMove(s, "h1", { q: 3, r: 2 }, 1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "not_owner");
});

test("startMove rejects when phase is not PLAYER_TURN", () => {
  const s = makeState({
    phase: { kind: "AI_TURN", playerId: 1 },
    selectedHeroId: "h1",
  });
  const result = startMove(s, "h1", { q: 3, r: 2 }, 1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "not_player_turn");
});

test("startMove rejects when hero not selected", () => {
  const s = makeState();
  const result = startMove(s, "h0", { q: 3, r: 2 }, 1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "not_selected");
});

test("startMove rejects impassable (infinity cost)", () => {
  const s = makeState({ selectedHeroId: "h0" });
  const result = startMove(s, "h0", { q: 3, r: 2 }, Infinity);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "impassable");
});

test("cancelMove restores position and refunds movement", () => {
  const s = makeState({ selectedHeroId: "h0" });
  const moved = startMove(s, "h0", { q: 5, r: 5 }, 3);
  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  const cancelled = cancelMove(moved.state, "h0");
  assert.equal(cancelled.heroes.h0.q, 2);
  assert.equal(cancelled.heroes.h0.r, 2);
  assert.equal(cancelled.heroes.h0.movementRemaining, MOVEMENT_PER_TURN);
  assert.equal(cancelled.heroes.h0.previousQ, null);
});

test("cancelMove is no-op when no previous move", () => {
  const s = makeState({ selectedHeroId: "h0" });
  const next = cancelMove(s, "h0");
  assert.equal(next, s);
});

test("detectAdjacentEnemy returns enemy hero id when adjacent", () => {
  const s = makeState({
    heroes: [
      makeHero("h0", 0, 2, 2),
      makeHero("h1", 1, 3, 2),
    ],
  });
  assert.equal(detectAdjacentEnemy(s, "h0"), "h1");
});

test("detectAdjacentEnemy returns null when friendly adjacent", () => {
  const s = makeState({
    players: [
      makePlayer(0, "player", "Human", ["h0", "h0b"], ["s0"]),
      makePlayer(1, "ai", "AI", ["h1"], ["s1"]),
    ],
    heroes: [
      makeHero("h0", 0, 2, 2),
      makeHero("h0b", 0, 3, 2),
      makeHero("h1", 1, 18, 4),
    ],
    settlements: [
      { id: "s0", ownerId: 0, q: 2, r: 2, level: 1 },
      { id: "s1", ownerId: 1, q: 18, r: 4, level: 1 },
    ],
  });
  assert.equal(detectAdjacentEnemy(s, "h0"), null);
});

test("detectAdjacentEnemy returns null when no neighbors", () => {
  const s = makeState();
  assert.equal(detectAdjacentEnemy(s, "h0"), null);
});

test("startBattle transitions to BATTLE phase", () => {
  const s = makeState({ selectedHeroId: "h0" });
  const next = startBattle(s, "h0", "h1");
  assert.equal(next.phase.kind, "BATTLE");
  if (next.phase.kind === "BATTLE") {
    assert.equal(next.phase.attackerId, "h0");
    assert.equal(next.phase.defenderId, "h1");
  }
  assert.equal(next.selectedHeroId, null);
});

test("resolveBattle removes defender, returns to PLAYER_TURN, sets dirty", () => {
  const s = makeState({
    players: [makePlayer(0, "player", "Human", ["h0"], ["s0"], 0), makePlayer(1, "ai", "AI", ["h1"], ["s1"], 0)],
    phase: { kind: "BATTLE", attackerId: "h0", defenderId: "h1" },
  });
  const next = resolveBattle(s);
  assert.equal(next.heroes.h1, undefined);
  assert.equal(next.phase.kind, "PLAYER_TURN");
  assert.equal(next.dirty, true);
  assert.equal(next.players[0].gold, BATTLE_GOLD_REWARD);
});

test("resolveBattle is no-op outside BATTLE phase", () => {
  const s = makeState();
  const next = resolveBattle(s);
  assert.equal(next, s);
});

test("endTurn from PLAYER_TURN for player 0 transitions to AI_TURN for player 1", () => {
  const s = makeState();
  const next = endTurn(s);
  assert.equal(next.activePlayerId, 1);
  assert.equal(next.phase.kind, "AI_TURN");
  if (next.phase.kind === "AI_TURN") assert.equal(next.phase.playerId, 1);
  assert.equal(next.selectedHeroId, null);
});

test("endTurn from AI_TURN (last player) transitions to ROUND_END", () => {
  const s = makeState({
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  const next = endTurn(s);
  assert.equal(next.phase.kind, "ROUND_END");
  if (next.phase.kind === "ROUND_END") assert.equal(next.phase.nextRound, 2);
});

test("endTurn advances to next human player in 3-player game", () => {
  const s = makeState({
    players: [
      makePlayer(0, "player", "P1", ["h0"], ["s0"]),
      makePlayer(1, "ai", "AI1", ["h1"], ["s1"]),
      makePlayer(2, "player", "P2", ["h2"], ["s2"]),
    ],
    heroes: [makeHero("h0", 0, 0, 0), makeHero("h1", 1, 10, 10), makeHero("h2", 2, 20, 20)],
    settlements: [
      { id: "s0", ownerId: 0, q: 0, r: 0, level: 1 },
      { id: "s1", ownerId: 1, q: 10, r: 10, level: 1 },
      { id: "s2", ownerId: 2, q: 20, r: 20, level: 1 },
    ],
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
  });
  const next = endTurn(s);
  assert.equal(next.activePlayerId, 2);
  assert.equal(next.phase.kind, "PLAYER_TURN");
});

test("endTurn from last player wraps to ROUND_END regardless of faction", () => {
  const s = makeState({
    players: [
      makePlayer(0, "player", "P1", ["h0"], ["s0"]),
      makePlayer(1, "ai", "AI1", ["h1"], ["s1"]),
      makePlayer(2, "player", "P2", ["h2"], ["s2"]),
    ],
    heroes: [makeHero("h0", 0, 0, 0), makeHero("h1", 1, 10, 10), makeHero("h2", 2, 20, 20)],
    settlements: [
      { id: "s0", ownerId: 0, q: 0, r: 0, level: 1 },
      { id: "s1", ownerId: 1, q: 10, r: 10, level: 1 },
      { id: "s2", ownerId: 2, q: 20, r: 20, level: 1 },
    ],
    activePlayerId: 2,
    phase: { kind: "PLAYER_TURN", playerId: 2 },
  });
  const next = endTurn(s);
  assert.equal(next.phase.kind, "ROUND_END");
});

test("applyEndOfTurn resets movement to 7 for current player heroes", () => {
  const s = makeState({
    heroes: [
      { ...makeHero("h0", 0, 2, 2), movementRemaining: 2 },
      { ...makeHero("h1", 1, 18, 4), movementRemaining: 3 },
    ],
  });
  const next = applyEndOfTurn(s);
  assert.equal(next.heroes.h0.movementRemaining, MOVEMENT_PER_TURN);
  assert.equal(next.heroes.h1.movementRemaining, 3);
});

test("applyEndOfTurn awards population*goldTax for current player's settlements", () => {
  const s = makeState({
    players: [
      makePlayer(0, "player", "Human", ["h0"], ["s0", "s0b"], 5),
      makePlayer(1, "ai", "AI", ["h1"], ["s1"], 10),
    ],
    settlements: [
      { id: "s0", ownerId: 0, q: 2, r: 2, level: 1, population: 500, goldTax: 1 },
      { id: "s0b", ownerId: 0, q: 3, r: 3, level: 1, population: 500, goldTax: 1 },
      { id: "s1", ownerId: 1, q: 18, r: 4, level: 1, population: 500, goldTax: 1 },
    ],
  });
  const next = applyEndOfTurn(s);
  assert.equal(next.players[0].gold, 1005);
  assert.equal(next.players[1].gold, 10);
  assert.equal(next.dirty, true);
});

test("advanceRound increments round, resets all heroes' movement, sets activePlayerId 0, phase PLAYER_TURN", () => {
  const s = makeState({
    heroes: [
      { ...makeHero("h0", 0, 2, 2), movementRemaining: 1 },
      { ...makeHero("h1", 1, 18, 4), movementRemaining: 2 },
    ],
    activePlayerId: 1,
    phase: { kind: "ROUND_END", nextRound: 2 },
    round: 1,
  });
  const next = advanceRound(s);
  assert.equal(next.round, 2);
  assert.equal(next.activePlayerId, 0);
  assert.equal(next.phase.kind, "PLAYER_TURN");
  assert.equal(next.heroes.h0.movementRemaining, MOVEMENT_PER_TURN);
  assert.equal(next.heroes.h1.movementRemaining, MOVEMENT_PER_TURN);
  assert.equal(next.selectedHeroId, null);
});

test("markSaved clears dirty", () => {
  const s = makeState();
  const dirty: GameState = { ...s, dirty: true };
  const next = markSaved(dirty);
  assert.equal(next.dirty, false);
});

test("markSaved is no-op when already clean", () => {
  const s = makeState();
  const next = markSaved(s);
  assert.equal(next, s);
});

test("state is immutable: reducers return new objects", () => {
  const s = makeState();
  const s2 = selectHero(s, "h0");
  assert.notEqual(s, s2);
  const moved = startMove(s2, "h0", { q: 3, r: 2 }, 1);
  if (moved.ok) {
    assert.notEqual(s2.heroes, moved.state.heroes);
    assert.equal(s2.heroes.h0.q, 2);
    assert.equal(moved.state.heroes.h0.q, 3);
  } else {
    assert.fail("expected ok");
  }
});
