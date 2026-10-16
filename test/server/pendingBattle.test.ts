import { test } from "node:test";
import assert from "node:assert/strict";
import type { Command, HeroId, HeroState, Player, PlayerId, Platoon, SettlementId, SettlementState } from "@heroes/contracts";
import type { HydratableGameRow, UnitType } from "@heroes/engine";
import { handleCommand } from "../../server/app/commandHandler";
import { hydrateFromRepos } from "../../server/persistence/hydrate";
import {
  createMockCharterRepo,
  createMockEventRepo,
  createMockGameRepo,
  createMockHeroRepo,
  createMockSettlementRepo,
} from "../helpers/mockRepos";

// Defender-chosen battle flow (server half): the AI driver dispatches
// EnterBattle against a HUMAN defender, the lobby jsonb carries the
// pendingBattle marker, and the defender's own seat resolves via the
// existing ResolveBattle / SubmitBattleResult commands -- which the generic
// turn guard now admits during the AI's turn when the actor owns one of
// the two combatants.

function makeHero(id: HeroId, ownerId: PlayerId, q: number, r: number, overrides: Partial<HeroState> = {}): HeroState {
  return {
    id,
    name: id,
    ownerId,
    q,
    r,
    movementRemaining: 7,
    previousQ: null,
    previousR: null,
    previousMovementRemaining: null,
    trail: [{ q, r }],
    gold: 0,
    troops: 1,
    stacks: [],
    isChartering: false,
    charterId: null,
    horseVariant: "bubbly",
    ...overrides,
  };
}

function makeSettlement(
  id: SettlementId,
  ownerId: PlayerId | null,
  q: number,
  r: number,
  overrides: Partial<SettlementState> = {},
): SettlementState {
  return {
    id,
    name: id,
    ownerId,
    q,
    r,
    level: 1,
    population: 0,
    goldTax: 0,
    resourceRates: {},
    foundedOnResource: null,
    gold: 0,
    warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
    citySpots: [],
    cityMines: [],
    morale: 100,
    autoTrade: true,
    castleVariant: 0,
    buildings: [],
    ...overrides,
  };
}

// Seat 1 is the ACTIVE (AI) seat for every row here: the whole flow runs
// during the AI's turn, with seat 0's hero as the human defender.
const PLAYERS: Player[] = [
  { id: 0, faction: "player", name: "Player 1", color: "#000000", heroIds: ["h0"], settlementIds: ["s0"] },
  { id: 1, faction: "ai", name: "AI", color: "#111111", heroIds: ["h1"], settlementIds: ["s1"] },
];

type LobbyBag = Record<string, unknown>;

function makeRow(
  heroes: HeroState[],
  settlements: SettlementState[],
  overrides: {
    players?: Player[];
    active_player_id?: number;
    lobby?: LobbyBag;
  } = {},
): HydratableGameRow & { lobby?: LobbyBag } {
  return {
    name: "test-game",
    seed: 1,
    round: 1,
    day: 1,
    active_player_id: overrides.active_player_id ?? 1,
    players: overrides.players ?? PLAYERS,
    heroes: Object.fromEntries(heroes.map((h) => [h.id, h])),
    settlements: Object.fromEntries(settlements.map((s) => [s.id, s])),
    // Other lobby keys a flagged game really carries -- every assertion on
    // marker writes below checks these survive the read-modify-write.
    lobby: overrides.lobby ?? { legacyAutoTrade: false, aiDriver: "server" },
    ...overrides,
  };
}

type MockGameRepo = ReturnType<typeof createMockGameRepo>;

function makeDeps(row: HydratableGameRow, unitTypes: UnitType[] = []) {
  const gameRepo = createMockGameRepo({ [row.name as string]: row });
  const eventRepo = createMockEventRepo();
  const heroRepo = createMockHeroRepo();
  const settlementRepo = createMockSettlementRepo();
  const charterRepo = createMockCharterRepo();
  return {
    gameRepo,
    eventRepo,
    heroRepo,
    settlementRepo,
    charterRepo,
    deps: { gameRepo, eventRepo, heroRepo, settlementRepo, charterRepo, ctx: { rng: () => 0.5, catalog: { unitTypes } } },
  };
}

function lobbyOf(repo: MockGameRepo, name = "test-game"): LobbyBag {
  return (repo.rows[name].lobby ?? {}) as LobbyBag;
}

// Same attack:100/defence:100/health:100 vs. attack:1/defence:1/health:5
// profile as test/server/commandHandler.test.ts's ResolveBattle cases --
// deterministically wipes the defender so both resolve paths succeed.
const UNIT_TYPES: UnitType[] = [
  { id: "hero_unit", name: "Hero Unit", attack: 100, defence: 100, health: 100, speed: 5, description: "", advantageType: "infantry", specialty: "militia", specialtyPriority: 1 },
  { id: "weak_unit", name: "Weak Unit", attack: 1, defence: 1, health: 5, speed: 1, description: "", advantageType: "cavalry", specialty: "militia", specialtyPriority: 1 },
];

function stack(unitTypeId: string, count: number): Platoon {
  return { entries: [{ unitTypeId, count }] };
}

// h1 (the AI seat's hero) stands adjacent to the human defender h0:
// (3,2) is a real HEX_DIRECTIONS neighbour of (2,2).
function makeDefenderRow(): { row: HydratableGameRow & { lobby?: LobbyBag }; h0: HeroState; h1: HeroState } {
  const h0 = makeHero("h0", 0, 2, 2, { stacks: [stack("weak_unit", 1)] });
  const h1 = makeHero("h1", 1, 3, 2, { stacks: [stack("hero_unit", 10)] });
  const row = makeRow(
    [h0, h1],
    [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 20, 20)],
  );
  return { row, h0, h1 };
}

function enterBattle(actor: number, attackerId: string, defenderId: string): Command {
  return { kind: "EnterBattle", gameName: "test-game", actor, attackerId, defenderId };
}

test("EnterBattle happy path persists the marker beside other lobby keys and appends BattleOffered", async () => {
  const { row } = makeDefenderRow();
  const { gameRepo, eventRepo, deps } = makeDeps(row, UNIT_TYPES);
  const result = await handleCommand(enterBattle(1, "h1", "h0"), deps);
  assert.equal(result.ok, true);
  const lobby = lobbyOf(gameRepo);
  const marker = lobby.pendingBattle as { attackerId: string; defenderId: string; since: number };
  assert.deepEqual(
    { attackerId: marker.attackerId, defenderId: marker.defenderId },
    { attackerId: "h1", defenderId: "h0" },
  );
  assert.equal(typeof marker.since, "number");
  assert.equal(lobby.legacyAutoTrade, false, "other lobby keys survive the marker write");
  assert.equal(lobby.aiDriver, "server");
  assert.equal(eventRepo.events.length, 1);
  assert.equal(eventRepo.events[0].kind, "BattleOffered");
  assert.equal(eventRepo.events[0].actorSeat, 1);
  assert.equal(result.lastEventId, 1);
});

test("EnterBattle is idempotent for the same pending pair: no second event, since preserved", async () => {
  const { row } = makeDefenderRow();
  const { gameRepo, eventRepo, deps } = makeDeps(row, UNIT_TYPES);
  const first = await handleCommand(enterBattle(1, "h1", "h0"), deps);
  assert.equal(first.ok, true);
  const since = (lobbyOf(gameRepo).pendingBattle as { since: number }).since;
  const second = await handleCommand(enterBattle(1, "h1", "h0"), deps);
  assert.equal(second.ok, true);
  assert.equal(second.events.length, 0, "no second BattleOffered");
  assert.equal(eventRepo.events.length, 1);
  assert.equal((lobbyOf(gameRepo).pendingBattle as { since: number }).since, since, "marker untouched");
});

test("EnterBattle rejects a different pair while an offer is pending", async () => {
  const h0 = makeHero("h0", 0, 2, 2, { stacks: [stack("weak_unit", 1)] });
  const h1 = makeHero("h1", 1, 3, 2, { stacks: [stack("hero_unit", 10)] });
  // A second AI hero of the same seat, also adjacent to h0.
  const h1b = makeHero("h1b", 1, 2, 3, { stacks: [stack("hero_unit", 10)] });
  const row = makeRow([h0, h1, h1b], [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 20, 20)]);
  const { gameRepo, deps } = makeDeps(row, UNIT_TYPES);
  const first = await handleCommand(enterBattle(1, "h1", "h0"), deps);
  assert.equal(first.ok, true);
  const since = (lobbyOf(gameRepo).pendingBattle as { since: number }).since;
  const second = await handleCommand(enterBattle(1, "h1b", "h0"), deps);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "battle_already_pending");
  const marker = lobbyOf(gameRepo).pendingBattle as { attackerId: string; defenderId: string; since: number };
  assert.deepEqual(
    { attackerId: marker.attackerId, defenderId: marker.defenderId, since: marker.since },
    { attackerId: "h1", defenderId: "h0", since },
    "the first offer stays pending",
  );
});

test("EnterBattle rejections: AI defender, non-adjacent pair, attacker owned by another seat", async () => {
  // AI defender: h2 belongs to a second AI seat, so the offer is refused.
  const aiPlayers: Player[] = [
    { id: 0, faction: "player", name: "Player 1", color: "#000000", heroIds: [], settlementIds: ["s0"] },
    { id: 1, faction: "ai", name: "AI 1", color: "#111111", heroIds: ["h1"], settlementIds: ["s1"] },
    { id: 2, faction: "ai", name: "AI 2", color: "#222222", heroIds: ["h2"], settlementIds: ["s2"] },
  ];
  const h1 = makeHero("h1", 1, 3, 2, { stacks: [stack("hero_unit", 10)] });
  const h2 = makeHero("h2", 2, 2, 2);
  const row = makeRow(
    [h1, h2],
    [makeSettlement("s1", 1, 20, 20), makeSettlement("s2", 2, 21, 21)],
    { players: aiPlayers },
  );
  const { gameRepo, deps } = makeDeps(row, UNIT_TYPES);
  const aiDefender = await handleCommand(enterBattle(1, "h1", "h2"), deps);
  assert.equal(aiDefender.ok, false);
  assert.equal(aiDefender.reason, "defender_not_human");
  assert.equal(lobbyOf(gameRepo).pendingBattle, undefined, "no marker written on rejection");

  // Non-adjacent defender.
  const far = makeDefenderRow();
  far.h0.q = 9;
  far.h0.r = 9;
  const { gameRepo: farRepo, deps: farDeps } = makeDeps(far.row, UNIT_TYPES);
  const notAdjacent = await handleCommand(enterBattle(1, "h1", "h0"), farDeps);
  assert.equal(notAdjacent.ok, false);
  assert.equal(notAdjacent.reason, "not_adjacent");
  assert.equal(lobbyOf(farRepo).pendingBattle, undefined);

  // Attacker the acting seat doesn't own.
  const { row: ownedRow } = makeDefenderRow();
  const { gameRepo: ownedRepo, deps: ownedDeps } = makeDeps(ownedRow, UNIT_TYPES);
  const notYourHero = await handleCommand(enterBattle(1, "h0", "h1"), ownedDeps);
  assert.equal(notYourHero.ok, false);
  assert.equal(notYourHero.reason, "forbidden_not_your_hero");
  assert.equal(lobbyOf(ownedRepo).pendingBattle, undefined);
});

test("SubmitBattleResult from the human defender's seat passes the turn guard during the AI turn, resolves, and clears the marker", async () => {
  const { row } = makeDefenderRow();
  const { gameRepo, eventRepo, deps } = makeDeps(row, UNIT_TYPES);
  const offer = await handleCommand(enterBattle(1, "h1", "h0"), deps);
  assert.equal(offer.ok, true);
  const command: Command = {
    kind: "SubmitBattleResult",
    gameName: "test-game",
    actor: 0,
    attackerId: "h1",
    defenderId: "h0",
    outcome: "attackerWon",
    attackerStacks: [stack("hero_unit", 10)],
    defenderStacks: [stack("weak_unit", 1)],
    rounds: 1,
    obstacleSeed: 0,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(eventRepo.events.map((e) => e.kind).join(","), "BattleOffered,BattleResolved");
  assert.equal("pendingBattle" in lobbyOf(gameRepo), false, "resolved battle clears the marker");
});

test("A seat owning neither combatant still gets forbidden_not_your_turn during the AI turn", async () => {
  const thirdSeat: Player[] = [
    ...PLAYERS,
    { id: 2, faction: "player", name: "Player 3", color: "#333333", heroIds: [], settlementIds: [] },
  ];
  const { row } = makeDefenderRow();
  row.players = thirdSeat;
  const { deps } = makeDeps(row, UNIT_TYPES);
  const command: Command = {
    kind: "SubmitBattleResult",
    gameName: "test-game",
    actor: 2,
    attackerId: "h1",
    defenderId: "h0",
    outcome: "attackerWon",
    attackerStacks: [stack("hero_unit", 10)],
    defenderStacks: [stack("weak_unit", 1)],
    rounds: 1,
    obstacleSeed: 0,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "forbidden_not_your_turn");
});

test("EnterBattle from a non-active seat is still forbidden_not_your_turn", async () => {
  const { row } = makeDefenderRow();
  const { deps } = makeDeps(row, UNIT_TYPES);
  const result = await handleCommand(enterBattle(0, "h1", "h0"), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "forbidden_not_your_turn");
  assert.equal(result.events.length, 0);
});

test("ResolveBattle from the human defender's seat succeeds and clears the pending marker", async () => {
  const { row } = makeDefenderRow();
  const { gameRepo, eventRepo, deps } = makeDeps(row, UNIT_TYPES);
  const offer = await handleCommand(enterBattle(1, "h1", "h0"), deps);
  assert.equal(offer.ok, true);
  const command: Command = { kind: "ResolveBattle", gameName: "test-game", actor: 0, attackerId: "h1", defenderId: "h0" };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(result.battle?.winner, "attacker");
  assert.equal(result.defenderHero, undefined, "the wiped human defender is removed");
  assert.equal(eventRepo.events.map((e) => e.kind).join(","), "BattleOffered,BattleResolved");
  assert.equal("pendingBattle" in lobbyOf(gameRepo), false);
});

test("ResolveBattle not_adjacent rejection clears a matching stale pending marker", async () => {
  const { row } = makeDefenderRow();
  row.heroes.h0.q = 9;
  row.heroes.h0.r = 9;
  row.lobby = { legacyAutoTrade: false, pendingBattle: { attackerId: "h1", defenderId: "h0", since: 123 } };
  const { gameRepo, deps } = makeDeps(row, UNIT_TYPES);
  const command: Command = { kind: "ResolveBattle", gameName: "test-game", actor: 0, attackerId: "h1", defenderId: "h0" };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_adjacent");
  assert.equal("pendingBattle" in lobbyOf(gameRepo), false, "stale offer self-heals");
});

test("ResolveBattle hero_not_found clears a matching stale pending marker", async () => {
  const { row } = makeDefenderRow();
  delete row.heroes.h0;
  row.lobby = { legacyAutoTrade: false, pendingBattle: { attackerId: "h1", defenderId: "h0", since: 123 } };
  const { gameRepo, deps } = makeDeps(row, UNIT_TYPES);
  const command: Command = { kind: "ResolveBattle", gameName: "test-game", actor: 1, attackerId: "h1", defenderId: "h0" };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "hero_not_found");
  assert.equal("pendingBattle" in lobbyOf(gameRepo), false);
});

test("SubmitBattleResult surrender_gold_exceeds_purse rejection KEEPS the pending marker for retry", async () => {
  const { row } = makeDefenderRow();
  const { gameRepo, deps } = makeDeps(row, UNIT_TYPES);
  const offer = await handleCommand(enterBattle(1, "h1", "h0"), deps);
  assert.equal(offer.ok, true);
  const command: Command = {
    kind: "SubmitBattleResult",
    gameName: "test-game",
    actor: 0,
    attackerId: "h1",
    defenderId: "h0",
    outcome: "surrender",
    attackerStacks: [stack("hero_unit", 10)],
    defenderStacks: [stack("weak_unit", 1)],
    surrenderedGold: 9999,
    rounds: 1,
    obstacleSeed: 0,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "surrender_gold_exceeds_purse");
  const marker = lobbyOf(gameRepo).pendingBattle as { attackerId: string; defenderId: string } | undefined;
  assert.deepEqual(
    marker && { attackerId: marker.attackerId, defenderId: marker.defenderId },
    { attackerId: "h1", defenderId: "h0" },
    "the defender can retry after a rejection",
  );
});

test("EndTurn clears a stale pending marker", async () => {
  const { row } = makeDefenderRow();
  row.lobby = {
    legacyAutoTrade: false,
    aiDriver: "server",
    pendingBattle: { attackerId: "h1", defenderId: "h0", since: 123 },
  };
  const { gameRepo, deps } = makeDeps(row, UNIT_TYPES);
  const result = await handleCommand({ kind: "EndTurn", gameName: "test-game", actor: 1 }, deps);
  assert.equal(result.ok, true);
  const lobby = lobbyOf(gameRepo);
  assert.equal("pendingBattle" in lobby, false, "an offer must never outlive the AI's turn");
  assert.equal(lobby.legacyAutoTrade, false, "other lobby keys survive the clear");
  assert.equal(lobby.aiDriver, "server");
});

test("hydrateFromRepos derives the BATTLE phase from the lobby marker on both paths", async () => {
  const { row: withMarker } = makeDefenderRow();
  withMarker.lobby = { legacyAutoTrade: false, pendingBattle: { attackerId: "h1", defenderId: "h0", since: 123 } };
  const repos = {
    heroRepo: createMockHeroRepo(),
    settlementRepo: createMockSettlementRepo(),
    charterRepo: createMockCharterRepo(),
  };

  // JSONB fallback path (granular tables empty).
  const jsonb = await hydrateFromRepos(withMarker, repos, "test-game");
  assert.equal(jsonb.source, "jsonb");
  assert.deepEqual(jsonb.state.phase, { kind: "BATTLE", attackerId: "h1", defenderId: "h0" });

  // Granular path (both granular tables seeded).
  const seeded = {
    ...repos,
    heroRepo: createMockHeroRepo({ "test-game": withMarker.heroes }),
    settlementRepo: createMockSettlementRepo({ "test-game": withMarker.settlements }),
  };
  const granular = await hydrateFromRepos(withMarker, seeded, "test-game");
  assert.equal(granular.source, "granular");
  assert.deepEqual(granular.state.phase, { kind: "BATTLE", attackerId: "h1", defenderId: "h0" });

  // Without a marker the phase stays faction-derived (active seat 1 is AI).
  const { row: withoutMarker } = makeDefenderRow();
  const plain = await hydrateFromRepos(withoutMarker, repos, "test-game");
  assert.deepEqual(plain.state.phase, { kind: "AI_TURN", playerId: 1 });
});
