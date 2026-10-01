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
  endBattlePhase,
  endTurn,
  applyEndOfTurn,
  applyEndOfTurnDetailed,
  applyWeeklyUpkeep,
  advanceRound,
  markSaved,
  transferGold,
  tradeResources,
  setAutoTrade,
  runAutoTrade,
  reorderStack,
  MOVEMENT_PER_TURN,
  type GameState,
  type Player,
  type HeroState,
  type SettlementState,
  type PlayerId,
  type HeroId,
  type GamePhase,
} from "../../src/state/gameState";
import { normalizePlatoons } from "../../src/state/units";
import {
  DESERT_COST_SHARE,
  DESERT_GRACE_WEEKS,
  MORALE_UNPAID_LOSS_MAX,
  desertionGateOpen,
  evaluateTroopUpkeep,
  platoonTroopTotal,
  unpaidMoraleLoss,
  weeksUnpaid,
  type UnitType,
} from "@heroes/engine";
import { makeHero as makeFixtureHero } from "../charter/_helpers";
import type { Platoon } from "@heroes/contracts";

function upkeepUnit(id: string, upkeepGold: number, upkeepFood: number): UnitType {
  return {
    id,
    name: id,
    attack: 1,
    defence: 1,
    health: 1,
    speed: 1,
    description: "",
    advantageType: "infantry",
    specialty: "",
    specialtyPriority: 0,
    upkeepGold,
    upkeepFood,
  };
}

function makePlayer(id: PlayerId, faction: Player["faction"], name: string, heroIds: HeroId[], settlementIds: string[]): Player {
  return { id, faction, name, heroIds, settlementIds };
}

function makeHero(id: HeroId, ownerId: PlayerId, q: number, r: number, movementRemaining = MOVEMENT_PER_TURN, gold = 0, troops = 1): HeroState {
  // The upkeep-shortfall trio defaults to paid up (morale 100, no streak), which
  // is what every hero the engine creates actually looks like -- a fixture that
  // omitted them would run upkeep against `morale: undefined`.
  return { id, name: id, ownerId, q, r, movementRemaining, previousQ: null, previousR: null, previousMovementRemaining: null, trail: [{ q, r }], gold, troops, stacks: troops > 0 ? normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: troops }] }]) : [], isChartering: false, charterId: null, morale: 100, upkeepUnpaidSinceDay: null, upkeepUnpaidTroops: 0, upkeepUnpaidGold: 0 };
}

function emptyWarehouse() {
  return { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 };
}

function makeSettlement(
  id: string,
  ownerId: PlayerId | null,
  q: number,
  r: number,
  opts: Partial<Pick<SettlementState, "population" | "goldTax" | "gold" | "resourceRates" | "morale" | "autoTrade" | "warehouse">> = {},
): SettlementState {
  // The garrison-unpaid trio defaults to paid up, matching every settlement the
  // engine creates; a fixture that omitted them would run garrison upkeep with
  // `garrisonUnpaidSinceDay: undefined`.
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
    warehouse: opts.warehouse ?? emptyWarehouse(),
    morale: opts.morale ?? 100,
    garrisonUnpaidSinceDay: null,
    garrisonUnpaidTroops: 0,
    garrisonUnpaidGold: 0,
    autoTrade: opts.autoTrade ?? true,
    buildings: [],
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
    makePlayer(0, "player", "Player 1", ["h0"], ["s0"]),
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

test("selectHero clears a prior settlement selection", () => {
  const s = makeState();
  const withSettlement: GameState = { ...s, selectedSettlementId: "s0" };
  const next = selectHero(withSettlement, "h0");
  assert.equal(next.selectedHeroId, "h0");
  assert.equal(next.selectedSettlementId, null);
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
    players: [makePlayer(0, "ai", "AI1", ["h0"], ["s0"]), makePlayer(1, "player", "Player 2", ["h1"], ["s1"])],
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

test("startMove admits the active AI seat's own hero during AI_TURN", () => {
  const s = makeState({
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
    selectedHeroId: "h1",
  });
  const result = startMove(s, "h1", { q: 3, r: 2 }, 1);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.state.heroes.h1.q, 3);
    assert.equal(result.state.heroes.h1.movementRemaining, MOVEMENT_PER_TURN - 1);
    assert.equal(result.state.dirty, true);
  }
});

test("startMove rejects a hero owned by another seat during AI_TURN", () => {
  const s = makeState({
    activePlayerId: 1,
    phase: { kind: "AI_TURN", playerId: 1 },
    selectedHeroId: "h0",
  });
  const result = startMove(s, "h0", { q: 3, r: 2 }, 1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "not_player_turn");
});

test("startMove rejects when phase is not a turn phase", () => {
  const s = makeState({
    phase: { kind: "ROUND_END", nextRound: 2 },
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
      makePlayer(0, "player", "Player 1", ["h0", "h0b"], ["s0"]),
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

test("endBattlePhase transitions BATTLE back to PLAYER_TURN without touching heroes", () => {
  const s = makeState({
    players: [makePlayer(0, "player", "Player 1", ["h0"], ["s0"]), makePlayer(1, "ai", "AI", ["h1"], ["s1"])],
    heroes: [makeHero("h0", 0, 2, 2, 7, 10), makeHero("h1", 1, 3, 2, 7, 75)],
    phase: { kind: "BATTLE", attackerId: "h0", defenderId: "h1" },
  });
  const next = endBattlePhase(s);
  // Actual combat resolution (gold transfer, casualties) is server-side —
  // see server/routes.ts resolve-battle and
  // packages/engine/src/combat/resolveBattle.ts.
  assert.equal(next.heroes.h0.gold, 10);
  assert.equal(next.heroes.h1.gold, 75);
  assert.equal(next.phase.kind, "PLAYER_TURN");
  assert.equal(next.dirty, true);
});

test("endBattlePhase is no-op outside BATTLE phase", () => {
  const s = makeState();
  const next = endBattlePhase(s);
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
      makePlayer(0, "player", "Player 1", ["h0"], ["s0", "s0b"]),
      makePlayer(1, "ai", "AI", ["h1"], ["s1"]),
    ],
    settlements: [
      { ...makeSettlement("s0", 0, 2, 2, { population: 500, goldTax: 1, gold: 100 }), warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 100 } },
      { ...makeSettlement("s0b", 0, 3, 3, { population: 500, goldTax: 1, gold: 0 }), warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 100 } },
      { ...makeSettlement("s1", 1, 18, 4, { population: 500, goldTax: 1, gold: 50 }), warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 100 } },
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
  const next = advanceRound(s, 0.1);
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
      { ...makeSettlement("s0", 0, 2, 2, { population: 500, goldTax: 1, gold: 100 }), warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 100 } },
      { ...makeSettlement("s1", 1, 18, 4, { population: 500, goldTax: 1, gold: 50 }), warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 100 } },
    ],
  });
  const next = applyEndOfTurn(s);
  assert.equal(next.settlements.s0.gold, 600);
  assert.equal(next.settlements.s1.gold, 50);
});

// ── Weekly troop upkeep (morale / shortfall / desertion) ───────────────────
// `applyWeeklyUpkeep` is a thin state-level wrapper: it threads day/round/
// castleSeed into the shared rule in
// packages/engine/src/economy/troopUpkeep.ts and runs it over BOTH heroes and
// garrisons. These tests pin the wrapper, so every expectation is derived from
// the engine's own exported helpers (evaluateTroopUpkeep / weeksUnpaid /
// desertionGateOpen / unpaidMoraleLoss and the DESERT_* / MORALE_* constants)
// rather than re-implementing the math here — a second copy of the formula in
// the test is exactly how the old "100% of the shortfall deserts troops" pin
// survived the rule change unnoticed.

const UPKEEP_UNIT_TYPES: Record<string, UnitType> = {
  peasant: upkeepUnit("peasant", 1, 1),
  swordsman: upkeepUnit("swordsman", 2, 1),
  eagle_prince: upkeepUnit("eagle_prince", 10, 3),
};

interface UpkeepHeroOpts {
  stacks: Platoon[];
  gold?: number;
  food?: number;
  morale?: number;
  unpaidSinceDay?: number | null;
  unpaidTroops?: number;
  unpaidGold?: number;
}

function upkeepHero(opts: UpkeepHeroOpts, id = "h0"): HeroState {
  return {
    ...makeFixtureHero(id, 0, 2, 2, {
      stacks: opts.stacks,
      troops: platoonTroopTotal(opts.stacks),
      gold: opts.gold ?? 0,
      morale: opts.morale ?? 100,
      upkeepUnpaidSinceDay: opts.unpaidSinceDay ?? null,
      upkeepUnpaidTroops: opts.unpaidTroops ?? 0,
      upkeepUnpaidGold: opts.unpaidGold ?? 0,
    }),
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: opts.food ?? 0 },
  };
}

// One weekly charge at `day`, threading the previous charge's result forward
// the way the engine's round tick does.
function chargeUpkeep(state: GameState, day: number): GameState {
  return applyWeeklyUpkeep({ ...state, day }, 0.1, UPKEEP_UNIT_TYPES);
}

function weeklyBill(stacks: readonly Platoon[]): { costGold: number; costFood: number } {
  const evaluated = evaluateTroopUpkeep(stacks, UPKEEP_UNIT_TYPES, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  return { costGold: evaluated.costGold, costFood: evaluated.costFood };
}

function stacksCostGold(stacks: readonly Platoon[]): number {
  return weeklyBill(stacks).costGold;
}

test("applyWeeklyUpkeep charges a funded hero's weekly gold and food bill and clears the shortfall", () => {
  const stacks: Platoon[] = [{ entries: [{ unitTypeId: "swordsman", count: 10 }] }];
  const hero = upkeepHero({ stacks, gold: 100, food: 100, morale: 71, unpaidSinceDay: 3, unpaidTroops: 4, unpaidGold: 8 });
  const bill = weeklyBill(stacks);
  assert.deepEqual(bill, { costGold: 20, costFood: 10 }, "10 tier-2 swordsmen: 2 gold + 1 food each");

  const next = chargeUpkeep(makeState({ heroes: [hero] }), 7);
  assert.equal(next.heroes.h0.gold, 100 - bill.costGold);
  assert.equal(next.heroes.h0.resources?.food, 100 - bill.costFood);
  assert.equal(next.heroes.h0.troops, 10);
  assert.equal(platoonTroopTotal(next.heroes.h0.stacks), 10);
  assert.equal(next.heroes.h0.morale, 71, "a paid charge neither costs nor restores morale");
  assert.equal(next.heroes.h0.upkeepUnpaidSinceDay, null, "paying up clears the streak");
  assert.equal(next.heroes.h0.upkeepUnpaidTroops, 0);
  assert.equal(next.heroes.h0.upkeepUnpaidGold, 0);
});

test("applyWeeklyUpkeep leaves a second, funded hero untouched when it can also pay", () => {
  const stacks: Platoon[] = [{ entries: [{ unitTypeId: "peasant", count: 3 }] }];
  const hero = upkeepHero({ stacks, gold: 5, food: 10 }, "h1");
  const bill = weeklyBill(stacks);
  const next = chargeUpkeep(makeState({ heroes: [hero] }), 7);
  assert.equal(next.heroes.h1.gold, 5 - bill.costGold);
  assert.equal(next.heroes.h1.troops, 3);
  assert.equal(next.heroes.h1.morale, 100);
  assert.equal(next.heroes.h1.upkeepUnpaidSinceDay, null);
});

test("an unpaid weekly charge spends what is there, stamps the streak, and costs morale without losing troops", () => {
  // 10 swordsmen owe 20 gold / 10 food; the purse holds 3 and the wagon holds 0.
  const stacks: Platoon[] = [{ entries: [{ unitTypeId: "swordsman", count: 10 }] }];
  const hero = upkeepHero({ stacks, gold: 3, food: 0 });
  const before = evaluateTroopUpkeep(stacks, UPKEEP_UNIT_TYPES, hero.gold, 0);
  assert.equal(before.costGold, 20);
  assert.equal(before.unfed, 10, "the empty larder starves the whole army, not just what 3 gold covers");
  assert.equal(before.unfedCostGold, 20);

  const next = chargeUpkeep(makeState({ heroes: [hero] }), 7);
  assert.equal(next.heroes.h0.gold, 0, "no debt is carried across charges; the purse just runs dry");
  assert.equal(next.heroes.h0.resources?.food, 0);
  assert.equal(next.heroes.h0.troops, 10, "week 1 of a streak never loses a soldier");
  assert.equal(
    next.heroes.h0.morale,
    100 - unpaidMoraleLoss(before.unfedCostGold, before.costGold),
    "the morale bleed scales with the value that went unpaid",
  );
  assert.equal(next.heroes.h0.morale, 100 - MORALE_UNPAID_LOSS_MAX, "a fully unfed army bleeds the ceiling");
  assert.equal(next.heroes.h0.upkeepUnpaidSinceDay, 7, "the streak is stamped with the FIRST unpaid charge");
  assert.equal(next.heroes.h0.upkeepUnpaidTroops, before.unfed);
  assert.equal(next.heroes.h0.upkeepUnpaidGold, before.unfedCostGold);
  assert.equal(weeksUnpaid(7, next.heroes.h0.upkeepUnpaidSinceDay), 0);
  assert.equal(desertionGateOpen(7, next.heroes.h0.upkeepUnpaidSinceDay), false);
});

test("the second unpaid weekly charge is still grace: morale bleeds, troops stay", () => {
  const stacks: Platoon[] = [{ entries: [{ unitTypeId: "swordsman", count: 10 }] }];
  const first = chargeUpkeep(makeState({ heroes: [upkeepHero({ stacks, gold: 3, food: 0 })] }), 7);
  assert.equal(weeksUnpaid(14, first.heroes.h0.upkeepUnpaidSinceDay), 1);
  assert.equal(desertionGateOpen(14, first.heroes.h0.upkeepUnpaidSinceDay), false);

  const second = chargeUpkeep(first, 14);
  assert.equal(second.heroes.h0.troops, 10, "week 2 is the last grace week");
  assert.equal(platoonTroopTotal(second.heroes.h0.stacks), 10);
  assert.equal(second.heroes.h0.morale, 100 - 2 * MORALE_UNPAID_LOSS_MAX);
  assert.equal(second.heroes.h0.upkeepUnpaidSinceDay, 7, "the streak start is never moved forward");
  assert.equal(second.heroes.h0.upkeepUnpaidGold, 20);
  assert.equal(weeksUnpaid(21, second.heroes.h0.upkeepUnpaidSinceDay), DESERT_GRACE_WEEKS);
});

test("the third unpaid weekly charge is the first to desert, and only by the cost-based share", () => {
  const stacks: Platoon[] = [{ entries: [{ unitTypeId: "swordsman", count: 10 }] }];
  const third = chargeUpkeep(
    chargeUpkeep(chargeUpkeep(makeState({ heroes: [upkeepHero({ stacks, gold: 3, food: 0 })] }), 7), 14),
    21,
  );
  const hero = third.heroes.h0;
  assert.equal(hero.upkeepUnpaidSinceDay, 7, "the streak start survives the desertion");
  assert.equal(weeksUnpaid(21, hero.upkeepUnpaidSinceDay), DESERT_GRACE_WEEKS);
  assert.equal(desertionGateOpen(21, hero.upkeepUnpaidSinceDay), true);

  const bill = weeklyBill(stacks).costGold;
  const removedCost = bill - stacksCostGold(hero.stacks);
  const target = Math.ceil(DESERT_COST_SHARE * hero.upkeepUnpaidGold);
  assert.equal(hero.upkeepUnpaidGold, 20, "the whole army is still unfed on the third charge");
  assert.equal(target, 4, "20% of a 20-gold deficit");
  assert.ok(removedCost >= target, `removed cost ${removedCost} reached the ${target} target`);
  // The draw may stop on the first unit that covers the target, so the only
  // bound available is the cost of one unit (2 gold per swordsman here).
  assert.ok(removedCost <= target + 2, `removed cost ${removedCost} overshot by more than one swordsman`);
  assert.ok(hero.troops < 10, "somebody walked");
  assert.equal(platoonTroopTotal(hero.stacks), hero.troops, "the troops scalar stays consistent with the stacks");
  for (const platoon of hero.stacks) {
    for (const entry of platoon.entries) assert.equal(Number.isInteger(entry.count), true, "no fractional troop count");
  }
  assert.equal(hero.morale, 100 - 3 * MORALE_UNPAID_LOSS_MAX);
  assert.equal(hero.gold, 0);
});

test("an expensive unpaid unit costs more desertion than a cheap one for the same deficit", () => {
  // 1 Eagle Prince (10 gold) + 20 peasants (1 gold) = 30 gold owed. A purse of
  // 20 buys every peasant and no Eagle Prince, so ONE troop is unfed and the
  // deficit is the Eagle Prince's 10 gold — 20% of that is 2, which one
  // Eagle Prince already covers, whereas 20% of the 1-gold shortfall would
  // have cost two peasants.
  const stacks: Platoon[] = [
    { entries: [{ unitTypeId: "peasant", count: 20 }] },
    { entries: [{ unitTypeId: "eagle_prince", count: 1 }] },
  ];
  const hero = upkeepHero({ stacks, gold: 20, food: 100, unpaidSinceDay: 7 });
  const evaluated = evaluateTroopUpkeep(stacks, UPKEEP_UNIT_TYPES, hero.gold, hero.resources?.food ?? 0);
  assert.equal(evaluated.costGold, 30);
  assert.equal(evaluated.unfed, 1);
  assert.equal(evaluated.unfedCostGold, 10, "the purse runs out at the top of the bill");

  const after = chargeUpkeep(makeState({ heroes: [hero] }), 21);
  const removedCost = weeklyBill(stacks).costGold - stacksCostGold(after.heroes.h0.stacks);
  assert.equal(Math.ceil(DESERT_COST_SHARE * 10), 2);
  assert.ok(removedCost >= 2, `removed cost ${removedCost} reached the cost-based target`);
  assert.ok(removedCost <= 12, `removed cost ${removedCost} overshot by more than one Eagle Prince`);
  assert.ok(after.heroes.h0.troops >= 15, `the army is bled, not wiped: ${after.heroes.h0.troops}`);
  assert.equal(platoonTroopTotal(after.heroes.h0.stacks), after.heroes.h0.troops);
});

test("applyWeeklyUpkeep is no-op when hero has 0 troops and 0 gold", () => {
  const s = makeState({
    heroes: [makeHero("h0", 0, 2, 2, 7, 0, 0)],
  });
  const next = applyWeeklyUpkeep(s, 0.1);
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
  const next = advanceRound(s, 0.1);
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
  const next = advanceRound(s, 0.1);
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
test("applyEndOfTurn consumes food from the warehouse for the active player", () => {
  const s = makeState({
    settlements: [
      makeSettlement("s0", 0, 2, 2, { population: 500, goldTax: 1, gold: 0 }),
      makeSettlement("s1", 1, 18, 4),
    ],
  });
  s.settlements.s0.warehouse.food = 10;
  const next = applyEndOfTurn(s);
  assert.equal(next.settlements.s0.warehouse.food, 5);
  assert.equal(next.settlements.s0.morale, 100);
});

test("applyEndOfTurn decays morale when food missing", () => {
  const s = makeState({
    settlements: [
      { ...makeSettlement("s0", 0, 2, 2, { population: 500, goldTax: 1, gold: 0 }), warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 } },
      makeSettlement("s1", 1, 18, 4),
    ],
  });
  const next = applyEndOfTurn(s);
  assert.ok((next.settlements.s0.morale ?? 100) < 100, "morale should drop from 100");
  assert.ok((next.settlements.s0.morale ?? 100) >= 0);
});

test("applyEndOfTurn awards effective income scaled by morale", () => {
  const s = makeState({
    settlements: [
      { ...makeSettlement("s0", 0, 2, 2, { population: 500, goldTax: 1, gold: 0, morale: 50 }), warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 100 } },
      makeSettlement("s1", 1, 18, 4),
    ],
  });
  const next = applyEndOfTurn(s);
  assert.equal(next.settlements.s0.gold, 250);
});

test("applyEndOfTurnDetailed returns transfers array alongside state", () => {
  const s = makeState({
    settlements: [
      { ...makeSettlement("s0", 0, 2, 2, { population: 500, goldTax: 1, gold: 100 }), warehouse: { wood: 10, stone: 0, iron: 0, arcane: 0, food: 5 }, morale: 100, autoTrade: true },
      { ...makeSettlement("s0b", 0, 3, 3, { gold: 0 }), warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 }, morale: 100, autoTrade: true },
      makeSettlement("s1", 1, 18, 4),
    ],
  });
  const detail = applyEndOfTurnDetailed(s);
  assert.ok(Array.isArray(detail.transfers));
  assert.equal(detail.state.settlements.s0.warehouse.wood, 10);
  assert.equal(detail.state.settlements.s0b.warehouse.wood, 0);
});

test("runAutoTrade returns no transfers when all warehouses are stocked", () => {
  const s = makeState({
    settlements: [
      { ...makeSettlement("s0", 0, 2, 2, { population: 500, goldTax: 1, gold: 10 }), warehouse: { wood: 10, stone: 0, iron: 0, arcane: 0, food: 5 }, morale: 100, autoTrade: true },
      { ...makeSettlement("s0b", 0, 3, 3, { population: 500, goldTax: 1, gold: 0 }), warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 5 }, morale: 100, autoTrade: true },
      makeSettlement("s1", 1, 18, 4),
    ],
  });
  const result = runAutoTrade(s.settlements, 0);
  assert.equal(result.transfers.length, 0);
});

test("setAutoTrade toggles a settlement's autoTrade flag", () => {
  const s = makeState({
    settlements: [
      makeSettlement("s0", 0, 2, 2, { population: 500, goldTax: 1, gold: 0 }),
      makeSettlement("s1", 1, 18, 4),
    ],
  });
  const next = setAutoTrade(s, "s0", false);
  assert.equal(next.settlements.s0.autoTrade, false);
  assert.equal(next.dirty, true);
});

test("setAutoTrade is no-op when value unchanged", () => {
  const s = makeState({
    settlements: [makeSettlement("s0", 0, 2, 2, { population: 500, goldTax: 1, gold: 0 })],
  });
  const next = setAutoTrade(s, "s0", true);
  assert.equal(next, s);
});

test("setAutoTrade returns same state when settlement is unknown", () => {
  const s = makeState();
  const next = setAutoTrade(s, "ghost", false);
  assert.equal(next, s);
});

// --- reorderStack: army slots are FIXED battlefield positions, so this is a
// swap of two slots, not a move-and-shift.

test("reorderStack swaps the contents of two occupied slots", () => {
  const s = makeState({
    heroes: [
      {
        ...makeHero("h0", 0, 2, 2),
        stacks: [
          { entries: [{ unitTypeId: "swordsman", count: 12 }] },
          { entries: [{ unitTypeId: "archer", count: 8 }] },
          { entries: [{ unitTypeId: "cavalry", count: 4 }] },
        ],
      },
      makeHero("h1", 1, 18, 4),
    ],
  });
  const result = reorderStack(s, "h0", 0, 2);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const stacks = result.state.heroes.h0.stacks;
  assert.equal(stacks[0].entries[0].unitTypeId, "cavalry");
  assert.equal(stacks[1].entries[0].unitTypeId, "archer");
  assert.equal(stacks[2].entries[0].unitTypeId, "swordsman");
  assert.equal(result.state.heroes.h0.stacks.length, 3);
});

test("reorderStack dragging onto an empty slot leaves source empty (swap with empty)", () => {
  const s = makeState({
    heroes: [
      {
        ...makeHero("h0", 0, 2, 2),
        stacks: [
          { entries: [{ unitTypeId: "archer", count: 8 }] },
          { entries: [] },
          { entries: [] },
        ],
      },
      makeHero("h1", 1, 18, 4),
    ],
  });
  const result = reorderStack(s, "h0", 0, 2);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const stacks = result.state.heroes.h0.stacks;
  assert.equal(stacks[0].entries.length, 0);
  assert.equal(stacks[2].entries[0].unitTypeId, "archer");
  assert.equal(stacks[2].entries[0].count, 8);
});

test("reorderStack with from === to is a successful no-op (state unchanged)", () => {
  const s = makeState({
    heroes: [
      {
        ...makeHero("h0", 0, 2, 2),
        stacks: [
          { entries: [{ unitTypeId: "swordsman", count: 12 }] },
          { entries: [{ unitTypeId: "archer", count: 8 }] },
        ],
      },
      makeHero("h1", 1, 18, 4),
    ],
  });
  const result = reorderStack(s, "h0", 1, 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.heroes.h0.stacks[0].entries[0].unitTypeId, "swordsman");
  assert.equal(result.state.heroes.h0.stacks[1].entries[0].unitTypeId, "archer");
});

test("reorderStack rejects out-of-range indices", () => {
  const s = makeState({
    heroes: [
      {
        ...makeHero("h0", 0, 2, 2),
        stacks: [
          { entries: [{ unitTypeId: "swordsman", count: 12 }] },
          { entries: [{ unitTypeId: "archer", count: 8 }] },
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
          { entries: [{ unitTypeId: "swordsman", count: 12 }] },
          { entries: [{ unitTypeId: "archer", count: 8 }] },
        ],
      },
      {
        ...makeHero("h1", 1, 18, 4),
        stacks: [{ entries: [{ unitTypeId: "griffin", count: 3 }] }],
      },
    ],
  });
  const result = reorderStack(s, "h0", 0, 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.heroes.h1.stacks[0].entries[0].unitTypeId, "griffin");
  assert.equal(result.state.heroes.h1.stacks[0].entries[0].count, 3);
});
