import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createInitialState,
  selectHero,
  clearSelection,
  startMove,
  cancelMove,
  reorderStack,
  detectAdjacentEnemy,
  startBattle,
  resolveBattle,
  endTurn,
  applyEndOfTurn,
  applyWeeklyUpkeep,
  advanceRound,
  markSaved,
  transferGold,
  tradeResources,
  MOVEMENT_PER_TURN,
  type GameState,
  type Player,
  type HeroState,
  type SettlementState,
  type PlayerId,
  type HeroId,
  type GamePhase,
} from "../../src/state/gameState";

function makePlayer(id: PlayerId, faction: Player["faction"], name: string, heroIds: HeroId[], settlementIds: string[]): Player {
  return { id, faction, name, heroIds, settlementIds };
}

function makeHero(id: HeroId, ownerId: PlayerId, q: number, r: number, movementRemaining = MOVEMENT_PER_TURN, gold = 0, troops = 1): HeroState {
  return { id, ownerId, q, r, movementRemaining, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q, r }], gold, troops };
}

function emptyWarehouse() {
  return { wood: 0, stone: 0, iron: 0, arcane: 0 };
}

function makeSettlement(
  id: string,
  ownerId: PlayerId | null,
  q: number,
  r: number,
  opts: Partial<Pick<SettlementState, "population" | "goldTax" | "gold" | "resourceRates">> = {},
): SettlementState {
  return {
    id,
    ownerId,
    q,
    r,
    level: 1,
    population: opts.population ?? 0,
    goldTax: opts.goldTax ?? 0,
    resourceRates: opts.resourceRates ?? {},
    foundedOnResource: null,
    gold: opts.gold ?? 0,
    warehouse: emptyWarehouse(),
  };
}

interface StateOverrides {
  players?: Player[];
  heroes?: HeroState[];
  settlements?: SettlementState[];
  round?: number;
  day?: number;
  activePlayerId?: PlayerId;
  phase?: GamePhase;
  selectedHeroId?: HeroId | null;
}

function makeState(overrides: StateOverrides = {}): GameState {
  const players = overrides.players ?? [
    makePlayer(0, "player", "Human", ["h0"], ["s0"]),
    makePlayer(1, "ai", "AI", ["h1"], ["s1"]),
  ];
  const heroes = overrides.heroes ?? [
    makeHero("h0", 0, 2, 2),
    makeHero("h1", 1, 18, 4),
  ];
  const settlements = overrides.settlements ?? [
    makeSettlement("s0", 0, 2, 2),
    makeSettlement("s1", 1, 18, 4),
  ];
  const initial = createInitialState({
    seedPlayers: players,
    seedHeroes: heroes,
    seedSettlements: settlements,
    seedRound: overrides.round ?? 1,
    seedActivePlayerId: overrides.activePlayerId ?? 0,
  });
  let state: GameState = initial;
  if (overrides.day !== undefined) state = { ...state, day: overrides.day };
  if (overrides.phase) state = { ...state, phase: overrides.phase };
  if (overrides.selectedHeroId !== undefined) state = { ...state, selectedHeroId: overrides.selectedHeroId };
  return state;
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
    seedPlayers: [makePlayer(0, "player", "P", ["h0"], ["s0"])],
    seedHeroes: [makeHero("h0", 0, 5, 5, 3, 50)],
    seedSettlements: [makeSettlement("s0", 0, 5, 5)],
    seedRound: 7,
    seedActivePlayerId: 0,
  });
  assert.equal(s.round, 7);
  assert.equal(s.heroes.h0.gold, 50);
  assert.equal(s.heroes.h0.movementRemaining, 3);
  assert.equal(s.settlements.s0.level, 1);
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

test("startMove with trailExtension appends every tile in the path", () => {
  const s = makeState({ selectedHeroId: "h0" });
  const trail = [
    { q: 3, r: 2 },
    { q: 4, r: 2 },
    { q: 5, r: 2 },
  ];
  const result = startMove(s, "h0", { q: 5, r: 2 }, 3, trail);
  assert.equal(result.ok, true);
  if (result.ok) {
    const finalTrail = result.state.heroes.h0.trail;
    assert.equal(finalTrail.length, 4); // initial {2,2} + 3 trail entries
    assert.deepEqual(finalTrail[0], { q: 2, r: 2 });
    assert.deepEqual(finalTrail[1], { q: 3, r: 2 });
    assert.deepEqual(finalTrail[2], { q: 4, r: 2 });
    assert.deepEqual(finalTrail[3], { q: 5, r: 2 });
  }
});

test("startMove without trailExtension falls back to appending only the destination", () => {
  const s = makeState({ selectedHeroId: "h0" });
  const result = startMove(s, "h0", { q: 5, r: 2 }, 3);
  assert.equal(result.ok, true);
  if (result.ok) {
    const finalTrail = result.state.heroes.h0.trail;
    assert.equal(finalTrail.length, 2); // initial + destination
    assert.deepEqual(finalTrail[1], { q: 5, r: 2 });
  }
});

test("startMove with empty trailExtension falls back to appending only the destination", () => {
  const s = makeState({ selectedHeroId: "h0" });
  const result = startMove(s, "h0", { q: 5, r: 2 }, 3, []);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.state.heroes.h0.trail.length, 2);
    assert.deepEqual(result.state.heroes.h0.trail[1], { q: 5, r: 2 });
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
      makeSettlement("s0", 0, 2, 2),
      makeSettlement("s1", 1, 18, 4),
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

test("resolveBattle transfers defender.gold to attacker.gold (winner takes all)", () => {
  const s = makeState({
    players: [makePlayer(0, "player", "Human", ["h0"], ["s0"]), makePlayer(1, "ai", "AI", ["h1"], ["s1"])],
    heroes: [makeHero("h0", 0, 2, 2, 7, 10), makeHero("h1", 1, 3, 2, 7, 75)],
    phase: { kind: "BATTLE", attackerId: "h0", defenderId: "h1" },
  });
  const next = resolveBattle(s);
  assert.equal(next.heroes.h1, undefined);
  assert.equal(next.heroes.h0.gold, 85);
  assert.equal(next.phase.kind, "PLAYER_TURN");
  assert.equal(next.dirty, true);
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
      makeSettlement("s0", 0, 0, 0),
      makeSettlement("s1", 1, 10, 10),
      makeSettlement("s2", 2, 20, 20),
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
      makeSettlement("s0", 0, 0, 0),
      makeSettlement("s1", 1, 10, 10),
      makeSettlement("s2", 2, 20, 20),
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

test("applyEndOfTurn awards population*goldTax into each owned settlement's treasury", () => {
  const s = makeState({
    players: [
      makePlayer(0, "player", "Human", ["h0"], ["s0", "s0b"]),
      makePlayer(1, "ai", "AI", ["h1"], ["s1"]),
    ],
    settlements: [
      makeSettlement("s0", 0, 2, 2, { population: 500, goldTax: 1, gold: 100 }),
      makeSettlement("s0b", 0, 3, 3, { population: 500, goldTax: 1, gold: 0 }),
      makeSettlement("s1", 1, 18, 4, { population: 500, goldTax: 1, gold: 50 }),
    ],
  });
  const next = applyEndOfTurn(s);
  assert.equal(next.settlements.s0.gold, 600);
  assert.equal(next.settlements.s0b.gold, 500);
  assert.equal(next.settlements.s1.gold, 50);
  assert.equal(next.dirty, true);
  assert.equal(next.heroes.h0.gold, 0);
  assert.equal(next.heroes.h1.gold, 0);
});

test("applyEndOfTurn never awards gold to heroes", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, 7, 42), makeHero("h1", 1, 18, 4, 7, 99)],
  });
  const next = applyEndOfTurn(s);
  assert.equal(next.heroes.h0.gold, 42);
  assert.equal(next.heroes.h1.gold, 99);
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

test("transferGold deposit moves all hero purse into settlement treasury", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, 7, 250), makeHero("h1", 1, 18, 4)],
    settlements: [makeSettlement("s0", 0, 2, 2, { gold: 100 }), makeSettlement("s1", 1, 18, 4)],
  });
  const next = transferGold(s, "h0", "s0", "deposit");
  assert.equal(next.ok, true);
  if (next.ok) {
    assert.equal(next.state.heroes.h0.gold, 0);
    assert.equal(next.state.settlements.s0.gold, 350);
    assert.equal(next.state.dirty, true);
  }
});

test("transferGold withdraw moves all settlement treasury to hero purse", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, 7, 10), makeHero("h1", 1, 18, 4)],
    settlements: [makeSettlement("s0", 0, 2, 2, { gold: 800 }), makeSettlement("s1", 1, 18, 4)],
  });
  const next = transferGold(s, "h0", "s0", "withdraw");
  assert.equal(next.ok, true);
  if (next.ok) {
    assert.equal(next.state.heroes.h0.gold, 810);
    assert.equal(next.state.settlements.s0.gold, 0);
  }
});

test("transferGold rejects when hero is not at settlement tile", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 5, 5, 7, 50), makeHero("h1", 1, 18, 4)],
    settlements: [makeSettlement("s0", 0, 2, 2, { gold: 100 }), makeSettlement("s1", 1, 18, 4)],
  });
  const next = transferGold(s, "h0", "s0", "deposit");
  assert.equal(next.ok, false);
  if (!next.ok) assert.equal(next.reason, "hero_not_at_settlement");
});

test("transferGold rejects at enemy-owned settlement", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, 7, 50), makeHero("h1", 1, 18, 4)],
    settlements: [makeSettlement("s1", 1, 2, 2, { gold: 100 }), makeSettlement("s0", 0, 18, 4)],
  });
  const next = transferGold(s, "h0", "s1", "deposit");
  assert.equal(next.ok, false);
  if (!next.ok) assert.equal(next.reason, "not_owned_settlement");
});

test("transferGold rejects at neutral settlement", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, 7, 50), makeHero("h1", 1, 18, 4)],
    settlements: [makeSettlement("s_neutral", null, 2, 2, { gold: 100 }), makeSettlement("s0", 0, 18, 4)],
  });
  const next = transferGold(s, "h0", "s_neutral", "deposit");
  assert.equal(next.ok, false);
  if (!next.ok) assert.equal(next.reason, "not_owned_settlement");
});

test("transferGold rejects deposit when hero purse is empty", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, 7, 0), makeHero("h1", 1, 18, 4)],
    settlements: [makeSettlement("s0", 0, 2, 2, { gold: 100 }), makeSettlement("s1", 1, 18, 4)],
  });
  const next = transferGold(s, "h0", "s0", "deposit");
  assert.equal(next.ok, false);
  if (!next.ok) assert.equal(next.reason, "nothing_to_deposit");
});

test("transferGold rejects withdraw when settlement treasury is empty", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, 7, 50), makeHero("h1", 1, 18, 4)],
    settlements: [makeSettlement("s0", 0, 2, 2, { gold: 0 }), makeSettlement("s1", 1, 18, 4)],
  });
  const next = transferGold(s, "h0", "s0", "withdraw");
  assert.equal(next.ok, false);
  if (!next.ok) assert.equal(next.reason, "nothing_to_withdraw");
});

test("applyEndOfTurn accumulates resourceRates into warehouse for all settlements", () => {
  const s = makeState({
    settlements: [
      { ...makeSettlement("s0", 0, 2, 2), resourceRates: { wood: 3, stone: 2 } },
      { ...makeSettlement("s1", 1, 18, 4), resourceRates: { wood: 1, iron: 4 } },
      makeSettlement("sN", null, 5, 5),
    ],
  });
  const next = applyEndOfTurn(s);
  assert.equal(next.settlements.s0.warehouse.wood, 3);
  assert.equal(next.settlements.s0.warehouse.stone, 2);
  assert.equal(next.settlements.s0.warehouse.iron, 0);
  assert.equal(next.settlements.s1.warehouse.wood, 1);
  assert.equal(next.settlements.s1.warehouse.iron, 4);
  assert.equal(next.settlements.sN.warehouse.wood, 0);
  assert.equal(next.dirty, true);
});

test("applyEndOfTurn does not award gold to non-active-player settlements", () => {
  const s = makeState({
    activePlayerId: 0,
    settlements: [
      makeSettlement("s0", 0, 2, 2, { population: 500, goldTax: 1, gold: 100 }),
      makeSettlement("s1", 1, 18, 4, { population: 500, goldTax: 1, gold: 50 }),
    ],
  });
  const next = applyEndOfTurn(s);
  assert.equal(next.settlements.s0.gold, 600);
  assert.equal(next.settlements.s1.gold, 50);
});

test("applyWeeklyUpkeep deducts cost when hero can pay", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, 7, 100, 10), makeHero("h1", 1, 18, 4, 7, 5, 3)],
  });
  const next = applyWeeklyUpkeep(s);
  assert.equal(next.heroes.h0.gold, 90);
  assert.equal(next.heroes.h0.troops, 10);
  assert.equal(next.heroes.h1.gold, 2);
  assert.equal(next.heroes.h1.troops, 3);
});

test("applyWeeklyUpkeep sets gold to 0 and troops to previous gold when hero cannot pay", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, 7, 3, 10)],
  });
  const next = applyWeeklyUpkeep(s);
  assert.equal(next.heroes.h0.gold, 0);
  assert.equal(next.heroes.h0.troops, 3);
});

test("applyWeeklyUpkeep is no-op when hero has 0 troops and 0 gold", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, 7, 0, 0)],
  });
  const next = applyWeeklyUpkeep(s);
  assert.equal(next.heroes.h0.gold, 0);
  assert.equal(next.heroes.h0.troops, 0);
});

test("advanceRound fires applyWeeklyUpkeep when day becomes divisible by 7", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, 7, 100, 10)],
    round: 6,
    day: 6,
    phase: { kind: "ROUND_END", nextRound: 7 },
  });
  const next = advanceRound(s);
  assert.equal(next.day, 7);
  assert.equal(next.heroes.h0.gold, 90);
  assert.equal(next.heroes.h0.troops, 10);
});

test("advanceRound does not fire applyWeeklyUpkeep on non-week days", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, 7, 100, 10)],
    round: 2,
    day: 2,
    phase: { kind: "ROUND_END", nextRound: 3 },
  });
  const next = advanceRound(s);
  assert.equal(next.day, 3);
  assert.equal(next.heroes.h0.gold, 100);
  assert.equal(next.heroes.h0.troops, 10);
});

test("tradeResources moves resources between same-owner settlements and charges gold", () => {
  const s = makeState({
    settlements: [
      { ...makeSettlement("s0", 0, 2, 2, { gold: 100 }), warehouse: { wood: 10, stone: 0, iron: 0, arcane: 0 } },
      { ...makeSettlement("s0b", 0, 3, 3, { gold: 0 }), warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0 } },
      makeSettlement("s1", 1, 18, 4),
    ],
  });
  const next = tradeResources(s, "s0", "s0b", "wood", 3);
  assert.equal(next.ok, true);
  if (next.ok) {
    assert.equal(next.state.settlements.s0.warehouse.wood, 7);
    assert.equal(next.state.settlements.s0.gold, 97);
    assert.equal(next.state.settlements.s0b.warehouse.wood, 3);
    assert.equal(next.state.dirty, true);
  }
});

test("tradeResources rejects when settlements have different owners", () => {
  const s = makeState({
    settlements: [
      { ...makeSettlement("s0", 0, 2, 2, { gold: 100 }), warehouse: { wood: 10, stone: 0, iron: 0, arcane: 0 } },
      { ...makeSettlement("s1", 1, 18, 4, { gold: 100 }), warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0 } },
    ],
  });
  const next = tradeResources(s, "s0", "s1", "wood", 2);
  assert.equal(next.ok, false);
  if (!next.ok) assert.equal(next.reason, "different_owners");
});

test("tradeResources rejects when from settlement has insufficient resource", () => {
  const s = makeState({
    settlements: [
      { ...makeSettlement("s0", 0, 2, 2, { gold: 100 }), warehouse: { wood: 1, stone: 0, iron: 0, arcane: 0 } },
      { ...makeSettlement("s0b", 0, 3, 3, { gold: 0 }), warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0 } },
    ],
  });
  const next = tradeResources(s, "s0", "s0b", "wood", 5);
  assert.equal(next.ok, false);
  if (!next.ok) assert.equal(next.reason, "insufficient_resource");
});

test("tradeResources rejects when from settlement has insufficient gold", () => {
  const s = makeState({
    settlements: [
      { ...makeSettlement("s0", 0, 2, 2, { gold: 1 }), warehouse: { wood: 10, stone: 0, iron: 0, arcane: 0 } },
      { ...makeSettlement("s0b", 0, 3, 3, { gold: 0 }), warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0 } },
    ],
  });
  const next = tradeResources(s, "s0", "s0b", "wood", 5);
  assert.equal(next.ok, false);
  if (!next.ok) assert.equal(next.reason, "insufficient_gold");
});

test("tradeResources rejects when either settlement is unowned (neutral)", () => {
  const s = makeState({
    settlements: [
      { ...makeSettlement("s0", 0, 2, 2, { gold: 100 }), warehouse: { wood: 10, stone: 0, iron: 0, arcane: 0 } },
      { ...makeSettlement("sN", null, 3, 3, { gold: 0 }), warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0 } },
    ],
  });
  const next = tradeResources(s, "s0", "sN", "wood", 1);
  assert.equal(next.ok, false);
  if (!next.ok) assert.equal(next.reason, "unowned_settlement");
});

test("tradeResources rejects non-positive or non-integer amount", () => {
  const s = makeState({
    settlements: [
      { ...makeSettlement("s0", 0, 2, 2, { gold: 100 }), warehouse: { wood: 10, stone: 0, iron: 0, arcane: 0 } },
      { ...makeSettlement("s0b", 0, 3, 3, { gold: 0 }), warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0 } },
    ],
  });
  assert.equal(tradeResources(s, "s0", "s0b", "wood", 0).ok, false);
  assert.equal(tradeResources(s, "s0", "s0b", "wood", -3).ok, false);
  assert.equal(tradeResources(s, "s0", "s0b", "wood", 1.5).ok, false);
});

// --- reorderStack: army slots are FIXED battlefield positions, so this is a
// swap of two slots, not a move-and-shift.

test("reorderStack swaps the contents of two occupied slots", () => {
  const s = makeState({
    heroes: [
      {
        ...makeHero("h0", 0, 2, 2),
        stacks: [
          { unitTypeId: "swordsman", count: 12 },
          { unitTypeId: "archer", count: 8 },
          { unitTypeId: "cavalry", count: 4 },
        ],
      },
      makeHero("h1", 1, 18, 4),
    ],
  });
  const result = reorderStack(s, "h0", 0, 2);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const stacks = result.state.heroes.h0.stacks;
  assert.equal(stacks[0].unitTypeId, "cavalry");
  assert.equal(stacks[1].unitTypeId, "archer");
  assert.equal(stacks[2].unitTypeId, "swordsman");
  assert.equal(result.state.heroes.h0.stacks.length, 3);
});

test("reorderStack dragging onto an empty slot leaves source empty (swap with empty)", () => {
  const s = makeState({
    heroes: [
      {
        ...makeHero("h0", 0, 2, 2),
        stacks: [
          { unitTypeId: "archer", count: 8 },
          { unitTypeId: null, count: 0 },
          { unitTypeId: null, count: 0 },
        ],
      },
      makeHero("h1", 1, 18, 4),
    ],
  });
  const result = reorderStack(s, "h0", 0, 2);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const stacks = result.state.heroes.h0.stacks;
  assert.equal(stacks[0].unitTypeId, null);
  assert.equal(stacks[0].count, 0);
  assert.equal(stacks[2].unitTypeId, "archer");
  assert.equal(stacks[2].count, 8);
});

test("reorderStack with from === to is a successful no-op (state unchanged)", () => {
  const s = makeState({
    heroes: [
      {
        ...makeHero("h0", 0, 2, 2),
        stacks: [
          { unitTypeId: "swordsman", count: 12 },
          { unitTypeId: "archer", count: 8 },
        ],
      },
      makeHero("h1", 1, 18, 4),
    ],
  });
  const result = reorderStack(s, "h0", 1, 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.heroes.h0.stacks[0].unitTypeId, "swordsman");
  assert.equal(result.state.heroes.h0.stacks[1].unitTypeId, "archer");
});

test("reorderStack rejects out-of-range indices", () => {
  const s = makeState({
    heroes: [
      {
        ...makeHero("h0", 0, 2, 2),
        stacks: [
          { unitTypeId: "swordsman", count: 12 },
          { unitTypeId: "archer", count: 8 },
        ],
      },
      makeHero("h1", 1, 18, 4),
    ],
  });
  assert.equal(reorderStack(s, "h0", -1, 0).ok, false);
  assert.equal(reorderStack(s, "h0", 0, 5).ok, false);
  assert.equal(reorderStack(s, "h0", 0, 1.5).ok, false);
});

test("reorderStack leaves other heroes untouched", () => {
  const s = makeState({
    heroes: [
      {
        ...makeHero("h0", 0, 2, 2),
        stacks: [
          { unitTypeId: "swordsman", count: 12 },
          { unitTypeId: "archer", count: 8 },
        ],
      },
      {
        ...makeHero("h1", 1, 18, 4),
        stacks: [{ unitTypeId: "griffin", count: 3 }],
      },
    ],
  });
  const result = reorderStack(s, "h0", 0, 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.heroes.h1.stacks[0].unitTypeId, "griffin");
  assert.equal(result.state.heroes.h1.stacks[0].count, 3);
});
