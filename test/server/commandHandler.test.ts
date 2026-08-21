import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  CharterState,
  Command,
  HeroId,
  HeroState,
  Player,
  PlayerId,
  Platoon,
  SettlementId,
  SettlementState,
} from "@heroes/contracts";
import type { HydratableGameRow, UnitType } from "@heroes/engine";
import { GameMap } from "@heroes/engine";
import { hexDistance } from "@heroes/contracts";
import { handleCommand, handleCommandTransactional } from "../../server/app/commandHandler";
import {
  createMockCharterRepo,
  createMockEventRepo,
  createMockGameRepo,
  createMockHeroRepo,
  createMockSettlementRepo,
} from "../helpers/mockRepos";

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

const PLAYERS: Player[] = [
  { id: 0, faction: "player", name: "Human", color: "#000000", heroIds: ["h0"], settlementIds: ["s0"] },
  { id: 1, faction: "ai", name: "AI", color: "#111111", heroIds: ["h1"], settlementIds: ["s1"] },
];

function makeRow(
  heroes: HeroState[],
  settlements: SettlementState[],
  overrides: Partial<HydratableGameRow> = {},
): HydratableGameRow {
  return {
    name: "test-game",
    seed: 1,
    round: 1,
    day: 1,
    active_player_id: 0,
    players: PLAYERS,
    heroes: Object.fromEntries(heroes.map((h) => [h.id, h])),
    settlements: Object.fromEntries(settlements.map((s) => [s.id, s])),
    ...overrides,
  };
}

function makeDeps(row: HydratableGameRow, unitTypes: UnitType[] = []) {
  const gameRepo = createMockGameRepo({ [row.name as string]: row });
  const eventRepo = createMockEventRepo();
  const heroRepo = createMockHeroRepo({ [row.name as string]: row.heroes });
  const settlementRepo = createMockSettlementRepo({ [row.name as string]: row.settlements });
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

// StartCharter test support: rather than hand-pick (q,r) coordinates that
// happen to work for a specific seed (fragile against any future change to
// packages/engine/src/map/gameMap.ts's terrain generation), search the same
// GameMap server/app/commandHandler.ts's StartCharter case itself
// reconstructs for a hex that actually satisfies its checks.
function findChartersTarget(
  map: GameMap,
  avoid: Array<{ q: number; r: number }>,
  minDist = 4,
): { q: number; r: number } {
  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      if (!map.isPassable(q, r)) continue;
      if (avoid.some((a) => hexDistance({ q, r }, a) < minDist)) continue;
      return { q, r };
    }
  }
  throw new Error("findChartersTarget: no valid target hex found for this seed/mapSize");
}

function findTooCloseButPassableTarget(map: GameMap, settlement: { q: number; r: number }): { q: number; r: number } {
  for (let dr = -3; dr <= 3; dr++) {
    for (let dq = -3; dq <= 3; dq++) {
      if (dq === 0 && dr === 0) continue;
      const q = settlement.q + dq;
      const r = settlement.r + dr;
      if (!map.isPassable(q, r)) continue;
      if (hexDistance({ q, r }, settlement) < 4) return { q, r };
    }
  }
  throw new Error("findTooCloseButPassableTarget: no valid target hex found for this seed/mapSize");
}

test("MoveHero succeeds, persists the new position, and emits HeroMoved", async () => {
  const row = makeRow([makeHero("h0", 0, 2, 2)], [makeSettlement("s0", 0, 2, 2)]);
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const command: Command = {
    kind: "MoveHero",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    fromTile: { q: 2, r: 2 },
    toTile: { q: 3, r: 2 },
    cost: 1,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(gameRepo.rows["test-game"].heroes.h0.q, 3);
  assert.equal(gameRepo.rows["test-game"].heroes.h0.movementRemaining, 6);
  assert.equal(eventRepo.events.length, 1);
  assert.equal(eventRepo.events[0].kind, "HeroMoved");
  assert.equal(eventRepo.events[0].actorSeat, command.actor);
  assert.equal(result.lastEventId, 1);
});

test("MoveHero rejects a move onto a tile already occupied by another hero", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 3, 2)],
    [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 1, 18, 4)],
  );
  const { deps } = makeDeps(row);
  const command: Command = {
    kind: "MoveHero",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    fromTile: { q: 2, r: 2 },
    toTile: { q: 3, r: 2 },
    cost: 1,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "occupied");
  assert.equal(result.events.length, 0);
});

test("MoveHero rejects a move by a hero that is currently chartering", async () => {
  const row = makeRow([makeHero("h0", 0, 2, 2, { isChartering: true, charterId: "c0" })], [makeSettlement("s0", 0, 2, 2)]);
  const { deps } = makeDeps(row);
  const command: Command = {
    kind: "MoveHero",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    fromTile: { q: 2, r: 2 },
    toTile: { q: 3, r: 2 },
    cost: 1,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "is_chartering");
  assert.equal(result.events.length, 0);
});

test("MoveHero rejects a stale fromTile that doesn't match the hero's server-side position", async () => {
  const row = makeRow([makeHero("h0", 0, 2, 2)], [makeSettlement("s0", 0, 2, 2)]);
  const { deps } = makeDeps(row);
  const command: Command = {
    kind: "MoveHero",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    fromTile: { q: 5, r: 5 },
    toTile: { q: 3, r: 2 },
    cost: 1,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "hero_not_at_fromTile");
  assert.equal(result.events.length, 0);
});

test("MoveHero rejects a command whose actor is not the active player", async () => {
  const row = makeRow([makeHero("h0", 0, 2, 2)], [makeSettlement("s0", 0, 2, 2)], { active_player_id: 1 });
  const { deps } = makeDeps(row);
  const command: Command = {
    kind: "MoveHero",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    fromTile: { q: 2, r: 2 },
    toTile: { q: 3, r: 2 },
    cost: 1,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "forbidden_not_your_turn");
  assert.equal(result.events.length, 0);
});

test("TransferGold deposit moves gold from hero to settlement and emits GoldTransferred", async () => {
  const row = makeRow([makeHero("h0", 0, 2, 2, { gold: 50 })], [makeSettlement("s0", 0, 2, 2, { gold: 10 })]);
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const command: Command = {
    kind: "TransferGold",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    settlementId: "s0",
    direction: "deposit",
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(gameRepo.rows["test-game"].heroes.h0.gold, 0);
  assert.equal(gameRepo.rows["test-game"].settlements.s0.gold, 60);
  assert.equal(eventRepo.events.length, 1);
  assert.equal(eventRepo.events[0].kind, "GoldTransferred");
});

test("TransferGold rejects when the hero is not at the settlement", async () => {
  const row = makeRow([makeHero("h0", 0, 2, 2, { gold: 50 })], [makeSettlement("s0", 0, 9, 9)]);
  const { deps } = makeDeps(row);
  const command: Command = {
    kind: "TransferGold",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    settlementId: "s0",
    direction: "deposit",
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "hero_not_at_settlement");
});

const SOLO_PLAYER: Player[] = [
  { id: 0, faction: "player", name: "Human", color: "#000000", heroIds: ["h0"], settlementIds: ["s0"] },
];

test("EndTurn advances to the next player without wrapping the round", async () => {
  const row = makeRow(
    // gold: 15 so the legacy-gold assertion below is actually
    // exercising something -- neither applyEndOfTurnDetailed (no round
    // wrap, so no hero upkeep) nor this settlement's income (goldTax: 0
    // by default) touch it, so it should pass through unchanged.
    [makeHero("h0", 0, 2, 2, { movementRemaining: 2, gold: 15 })],
    [makeSettlement("s0", 0, 2, 2)],
  );
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const command: Command = { kind: "EndTurn", gameName: "test-game", actor: 0 };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(result.activePlayerId, 1);
  assert.equal(result.round, 1);
  // Movement reset only applies to the ending player's own heroes
  // (applyEndOfTurnDetailed's resetHeroMovement(state.heroes, playerId)) --
  // h0 belongs to player 0, who just ended their turn.
  assert.equal(gameRepo.rows["test-game"].heroes.h0.movementRemaining, 7);
  assert.equal(gameRepo.rows["test-game"].active_player_id, 1);
  // Legacy `gold` column recomputation (server/app/commandHandler.ts's
  // sumPlayerGold) actually gets persisted -- h0's 15 is the only gold
  // anywhere in this row's heroes/settlements.
  assert.equal(gameRepo.rows["test-game"].gold, 15);
  // The canonical TurnEnded EngineEvent (matching MoveHero/TransferGold's
  // own append-what-you-return convention) always fires first; turn_ended
  // is the old /end-turn route's separate legacy-shaped audit-trail entry,
  // which always fires too; ai_turn_started also fires here because
  // PLAYERS[1] (the next player) is faction "ai" -- matching the old
  // /end-turn route's same check.
  assert.equal(eventRepo.events.map((e) => e.kind).join(","), "TurnEnded,turn_ended,ai_turn_started");
  assert.equal((eventRepo.events[1].payload as { playerId: number }).playerId, 0);
  // TurnEnded/turn_ended are attributable to the player who ended their
  // turn; ai_turn_started is not attributable to a single seat (see
  // server/migrations/010_event_seq.sql's header) and gets null.
  assert.deepEqual(
    eventRepo.events.map((e) => e.actorSeat),
    [0, 0, null],
  );
  assert.equal(result.lastEventId, 3);
});

test("EndTurn wraps the round, advances settlement upgrades, and applies weekly upkeep on day%7 -- closing the gaps the old /end-turn route left client-trusted", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2, { gold: 0, troops: 3 })],
    [
      makeSettlement("s0", 0, 2, 2, {
        population: 100,
        level: 1,
        // Large buffer so applyEndOfTurnDetailed's consumption step can't
        // exhaust it before applyPopulationGrowth's food check runs --
        // this test only needs to prove growth fires, not predict the
        // exact post-consumption remainder.
        warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 10_000 },
        upgrade: { kind: "townHall", targetLevel: 2, daysRemaining: 1 },
      }),
    ],
    { players: SOLO_PLAYER, day: 6 },
  );
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const command: Command = { kind: "EndTurn", gameName: "test-game", actor: 0, growthRate: 0.1 };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(result.round, 2);
  assert.equal(result.day, 7);
  assert.equal(result.activePlayerId, 0);

  const s0 = gameRepo.rows["test-game"].settlements.s0;
  // advanceSettlementUpgrades: gap #1. Old route never called this --
  // upgrade.daysRemaining (1) hits 0 and clears.
  assert.equal(s0.upgrade, undefined);
  // applyPopulationGrowth: gap #2. Old route never called this at all.
  assert.ok(s0.population > 100, `expected population growth, got ${s0.population}`);

  // applyHeroUpkeep (part of the same weekly-upkeep gap): troops=3, cost=3,
  // hero had 0 gold, so the shortfall branch sets gold:0, troops:<old gold>.
  const h0 = gameRepo.rows["test-game"].heroes.h0;
  assert.equal(h0.gold, 0);
  assert.equal(h0.troops, 0);

  assert.equal(eventRepo.events.map((e) => e.kind).join(","), "TurnEnded,turn_ended,round_ended,round_started");
  // round_started is not attributable to a single seat; the other three
  // are attributable to the player who ended the turn/round.
  assert.deepEqual(
    eventRepo.events.map((e) => e.actorSeat),
    [0, 0, 0, null],
  );
  assert.equal(result.lastEventId, 4);
});

// ---------------------------------------------------------------------------
// Week 3+ ports (plan/2026-08-16-phase-3-parallel-dev-plan.md): TradeResources,
// ResolveBattle, RecruitHero, UpgradeTownHall, SetAutoTrade, ReorderStack,
// CaptureSettlement. Each pair below covers the happy path plus the specific
// validation gap this port's own audit found for that command (see the PR
// description for the full per-command gap list).
// ---------------------------------------------------------------------------

test("TradeResources moves resources between the actor's own settlements and recomputes legacy gold", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2)],
    [
      makeSettlement("s0", 0, 2, 2, { warehouse: { wood: 50, stone: 0, iron: 0, arcane: 0, food: 0 }, gold: 100 }),
      makeSettlement("s1", 0, 5, 5),
    ],
  );
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const command: Command = {
    kind: "TradeResources",
    gameName: "test-game",
    actor: 0,
    fromSettlementId: "s0",
    toSettlementId: "s1",
    resource: "wood",
    amount: 10,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(result.fromSettlement?.warehouse.wood, 40);
  assert.equal(result.toSettlement?.warehouse.wood, 10);
  // tradeResources() charges `amount` gold from the FROM settlement as the
  // trade's cost (packages/engine/src/economy/trade.ts).
  assert.equal(gameRepo.rows["test-game"].settlements.s0.gold, 90);
  assert.equal(gameRepo.rows["test-game"].gold, 90);
  assert.equal(eventRepo.events.map((e) => e.kind).join(","), "ResourcesTraded");
});

test("TradeResources rejects trading between settlements the actor doesn't own, even when they share an owner", async () => {
  // tradeResources() itself only requires from.ownerId === to.ownerId --
  // both settlements below satisfy that (both owned by player 1), but
  // neither is owned by the acting player (0). Closing this gap is this
  // command's whole reason for its own explicit ownership check.
  const row = makeRow(
    [makeHero("h0", 0, 2, 2)],
    [
      makeSettlement("s0", 1, 2, 2, { warehouse: { wood: 50, stone: 0, iron: 0, arcane: 0, food: 0 }, gold: 100 }),
      makeSettlement("s1", 1, 5, 5),
    ],
  );
  const { deps } = makeDeps(row);
  const command: Command = {
    kind: "TradeResources",
    gameName: "test-game",
    actor: 0,
    fromSettlementId: "s0",
    toSettlementId: "s1",
    resource: "wood",
    amount: 10,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "forbidden_not_your_settlement");
});

// Same attack:100/defence:100/health:100 vs. attack:1/defence:1/health:5
// profile as test/combat/resolveBattle.test.ts's own "overwhelming attacker"
// case -- reused here rather than inventing a new one, since that test
// already establishes this pairing deterministically wipes the defender.
const RESOLVE_BATTLE_UNIT_TYPES: UnitType[] = [
  { id: "hero_unit", name: "Hero Unit", attack: 100, defence: 100, health: 100, speed: 5, description: "", advantageType: "infantry", specialty: "militia", specialtyPriority: 1 },
  { id: "weak_unit", name: "Weak Unit", attack: 1, defence: 1, health: 5, speed: 1, description: "", advantageType: "cavalry", specialty: "militia", specialtyPriority: 1 },
];

function makeSingleEntryPlatoon(unitTypeId: string, count: number): Platoon {
  return { entries: [{ unitTypeId, count }] };
}

test("ResolveBattle resolves combat, loots gold from a wiped defender, and persists the obstacleSeed", async () => {
  const row = makeRow(
    [
      makeHero("h0", 0, 2, 2, { stacks: [makeSingleEntryPlatoon("hero_unit", 10)] }),
      // {q:1, r:0} is a real HEX_DIRECTIONS neighbour offset
      // (packages/contracts/src/geometry.ts) -- (3,2) is genuinely
      // adjacent to (2,2), not just close.
      makeHero("h1", 1, 3, 2, { gold: 40, stacks: [makeSingleEntryPlatoon("weak_unit", 1)] }),
    ],
    [makeSettlement("s0", 0, 2, 2)],
  );
  const { gameRepo, eventRepo, deps } = makeDeps(row, RESOLVE_BATTLE_UNIT_TYPES);
  const command: Command = { kind: "ResolveBattle", gameName: "test-game", actor: 0, attackerId: "h0", defenderId: "h1" };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(result.battle?.winner, "attacker");
  assert.equal(result.battle?.defenderOutcome, "lost_all_troops");
  assert.equal(result.attackerHero?.gold, 40, "looted gold from the wiped defender");
  assert.equal(result.defenderHero?.gold, 0);
  assert.equal(gameRepo.rows["test-game"].heroes.h0.gold, 40);
  assert.equal(eventRepo.events.map((e) => e.kind).join(","), "BattleResolved");
  // ctx.rng is fixed at 0.5 in makeDeps() -- obstacleSeed is deterministic,
  // and it's the OLD /resolve-battle route's own Date.now()-based seed that
  // never got persisted anywhere at all (plan/2026-08-16-phase-3-parallel-dev-plan.md).
  const expectedSeed = Math.floor(0.5 * 0x1_0000_0000) >>> 0;
  assert.equal((eventRepo.events[0].payload as { obstacleSeed: number }).obstacleSeed, expectedSeed);
});

test("ResolveBattle rejects a defenderId that isn't actually adjacent to the attacker", async () => {
  const row = makeRow(
    [
      makeHero("h0", 0, 2, 2, { stacks: [makeSingleEntryPlatoon("hero_unit", 10)] }),
      makeHero("h1", 1, 9, 9, { stacks: [makeSingleEntryPlatoon("weak_unit", 1)] }),
    ],
    [makeSettlement("s0", 0, 2, 2)],
  );
  const { deps } = makeDeps(row, RESOLVE_BATTLE_UNIT_TYPES);
  const command: Command = { kind: "ResolveBattle", gameName: "test-game", actor: 0, attackerId: "h0", defenderId: "h1" };
const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_adjacent");
});

test("ResolveBattle cleans up the defender's charter when it loses all troops mid-charter, and persists the removal via charterRepo", async () => {
  // Closes the gap flagged for the StartCharter port
  // (plan/2026-08-17-consolidated-phase-1-5-track-map.md §5.1 R5): once
  // charters are server-persisted, a chartering hero killed in a
  // server-resolved battle must not leave an orphaned charter row behind.
  // Mirrors src/state/turnController.ts's own resolveCurrentBattle(),
  // which runs the identical cleanupDefeatedHeroCharters() call
  // client-side today.
  const h0 = makeHero("h0", 0, 2, 2, { stacks: [makeSingleEntryPlatoon("hero_unit", 10)] });
  const h1 = makeHero("h1", 1, 3, 2, {
    gold: 40,
    stacks: [makeSingleEntryPlatoon("weak_unit", 1)],
    isChartering: true,
    charterId: "ch0",
  });
  const s0 = makeSettlement("s0", 0, 2, 2);
  const row = makeRow([h0, h1], [s0]);
  const { deps, charterRepo, heroRepo, settlementRepo } = makeDeps(row, RESOLVE_BATTLE_UNIT_TYPES);
  // activeCharters only ever comes from the granular path
  // (server/persistence/hydrate.ts) -- seed hero/settlementRepo too so
  // hydrateFromRepos() doesn't fall back to the JSONB row (which always
  // hydrates activeCharters as []).
  heroRepo.rows["test-game"] = { h0, h1 };
  settlementRepo.rows["test-game"] = { s0 };
  const charter: CharterState = {
    id: "ch0",
    heroId: "h1",
    ownerId: 1,
    targetQ: 3,
    targetR: 2,
    settlementName: "Doomed Town",
    phase: "traveling",
    daysRemaining: 10,
    settlementId: "s5",
    resourceRates: {},
    foundedOnResource: null,
    citySpots: [],
  };
  charterRepo.rows["test-game"] = [charter];

  const command: Command = { kind: "ResolveBattle", gameName: "test-game", actor: 0, attackerId: "h0", defenderId: "h1" };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(result.battle?.defenderOutcome, "lost_all_troops");
  assert.equal(charterRepo.calls.length, 1, "cleanupDefeatedHeroCharters removing ch0 should trigger a charterRepo sync");
  assert.deepEqual(charterRepo.calls[0].value, []);
  assert.equal(charterRepo.rows["test-game"].length, 0);
});

test("ResolveBattle never touches charterRepo when the defender isn't chartering", async () => {
  const row = makeRow(
    [
      makeHero("h0", 0, 2, 2, { stacks: [makeSingleEntryPlatoon("hero_unit", 10)] }),
      makeHero("h1", 1, 3, 2, { gold: 40, stacks: [makeSingleEntryPlatoon("weak_unit", 1)] }),
    ],
    [makeSettlement("s0", 0, 2, 2)],
  );
  const { deps, charterRepo } = makeDeps(row, RESOLVE_BATTLE_UNIT_TYPES);
  const command: Command = { kind: "ResolveBattle", gameName: "test-game", actor: 0, attackerId: "h0", defenderId: "h1" };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(result.battle?.defenderOutcome, "lost_all_troops");
  assert.equal(charterRepo.calls.length, 0);
});

// ---------------------------------------------------------------------------
// handleCommandTransactional: wraps the live Postgres path so that load /
// validate / saveHeroesAndSettlements / eventRepo.append all share a single
// PoolClient AND the games row is SELECT ... FOR UPDATE-locked for the
// duration of the command (closing the concurrent-overwrite gap Copilot
// flagged in PR #91 review: without the lock, two MoveHero/TradeResources
// commands issued in the same millisecond each load the pre-state, each
// mutate, and each save -- last write clobbers the first).
//
// mockRepos is in-memory and atomic-per-call, so testing the wrapper end
// to end requires a fake "PoolClient" that records the queries
// handleCommandTransactional issues (notably the FOR UPDATE) and exposes
// just enough query surface for createGameRepo/createEventRepo to load
// and persist against. The point of these tests is the lock + commit
// ordering, not the in-memory repo behavior (which the handleCommand tests
// above already exhaustively cover).
// ---------------------------------------------------------------------------

interface FakePoolClient {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
  release: () => void;
}

function makeFakePoolClient(
  row: HydratableGameRow,
): FakePoolClient & { queries: string[] } {
  const queries: string[] = [];
  let nextEventId = 1;
  return {
    queries,
    async query(sql: string, _params?: unknown[]) {
      queries.push(sql);
      // Dispatch on leading keyword, not on substring matches --
      // /UPDATE/i matches "updated_at" inside a SELECT, and BEGIN/COMMIT/
      // ROLLBACK don't match any of the table-shaped patterns.
      const head = sql.trim().split(/\s+/, 2).join(" ").toUpperCase();
      if (head === "BEGIN" || head === "COMMIT" || head === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      if (head.startsWith("SELECT") && /FOR UPDATE/i.test(sql)) {
        return { rows: [{ id: 1 }], rowCount: 1 };
      }
      if (
        head.startsWith("SELECT") &&
        /FROM\s+games\s+WHERE\s+name\s*=\s*\$1/i.test(sql)
      ) {
        return { rows: [row], rowCount: 1 };
      }
      // UPDATE games SET ... WHERE name = $N -- head parsing only takes
      // two words so we have to substring-match the SET marker.
      if (/^UPDATE\s+games\s+SET\b/i.test(sql.trim())) {
        return { rows: [], rowCount: 1 };
      }
      // INSERT INTO game_events / settlement_snapshots / resource_transactions
      // -- same problem (head is just "INSERT INTO"), so substring-match.
      if (/^INSERT\s+INTO\s+game_events\b/i.test(sql.trim())) {
        return { rows: [{ id: nextEventId++ }], rowCount: 1 };
      }
      if (/^INSERT\s+INTO\s+settlement_snapshots\b/i.test(sql.trim())) {
        return { rows: [], rowCount: 1 };
      }
      if (/^INSERT\s+INTO\s+resource_transactions\b/i.test(sql.trim())) {
        return { rows: [], rowCount: 1 };
      }
      // Phase 4 Track A: heroRepo/settlementRepo/charterRepo are
      // constructed against this same fake client inside
      // handleCommandTransactional's requestDeps (real repo factories, not
      // mocks -- see server/persistence/repositories/*.ts). These tests
      // only care about the lock/commit ordering (asserted via `queries`
      // above), not granular data, so every granular SELECT reads back
      // empty (hydrateFromRepos falls back to the JSONB `row` already
      // handled above) and every DELETE/INSERT the repos' upsertMany
      // issues is accepted as a generic write.
      if (
        /^SELECT\b/i.test(sql.trim()) &&
        /\bFROM\s+(heroes|hero_platoons|settlements|settlement_resources|settlement_buildings|charters)\b/i.test(sql)
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (/^DELETE\s+FROM\s+(heroes|hero_platoons|settlements|settlement_resources|settlement_buildings|charters)\b/i.test(sql.trim())) {
        return { rows: [], rowCount: 0 };
      }
      if (/^INSERT\s+INTO\s+(heroes|hero_platoons|settlements|settlement_resources|settlement_buildings|charters)\b/i.test(sql.trim())) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`fakePoolClient: unhandled query: ${head}`);
    },
    release() {},
  };
}

function makeTransactionalDeps(row: HydratableGameRow) {
  const gameRepo = createMockGameRepo({ [row.name as string]: row });
  const eventRepo = createMockEventRepo();
  // handleCommandTransactional never reads these three off `deps` itself --
  // it rebuilds its own requestDeps from the (fake) client, same as it
  // already does for gameRepo/eventRepo above -- but LiveCommandDeps
  // extends CommandDeps, so they're still required to satisfy the type.
  const heroRepo = createMockHeroRepo();
  const settlementRepo = createMockSettlementRepo();
  const charterRepo = createMockCharterRepo();
  const ctx = { rng: () => 0.5, catalog: { unitTypes: [] as UnitType[] } };
  let activeClient: FakePoolClient | null = null;
  const pool = {
    async connect() {
      activeClient = makeFakePoolClient(row);
      return activeClient;
    },
  };
  return {
    gameRepo,
    eventRepo,
    queries: () => activeClient?.queries ?? [],
    deps: {
      gameRepo,
      eventRepo,
      heroRepo,
      settlementRepo,
      charterRepo,
      ctx,
      pool: pool as unknown as import("pg").Pool,
    },
  };
}

test("handleCommandTransactional acquires a SELECT FOR UPDATE on the games row before delegating to handleCommand", async () => {
  const row = makeRow([makeHero("h0", 0, 2, 2)], [makeSettlement("s0", 0, 2, 2)]);
  const { deps, queries } = makeTransactionalDeps(row);
  const command: Command = {
    kind: "MoveHero",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    fromTile: { q: 2, r: 2 },
    toTile: { q: 3, r: 2 },
    cost: 1,
  };
  const result = await handleCommandTransactional(command, deps);
  assert.equal(result.ok, true);
  // Lock issued first; load, save, and event-append follow it in the
  // same connection. The exact ordering of load/save/event is whatever
  // handleCommand does, but FOR UPDATE must precede any of them.
  const lockIdx = queries().findIndex((q) => /FOR UPDATE/i.test(q));
  const loadIdx = queries().findIndex(
    (q) => /^SELECT\b/i.test(q.trim()) && /FROM\s+games\s+WHERE\s+name\s*=\s*\$1/i.test(q) && !/FOR UPDATE/i.test(q),
  );
  const saveIdx = queries().findIndex((q) => /^UPDATE\s+games\s+set/i.test(q.trim()));
  const eventIdx = queries().findIndex((q) => /^INSERT\s+INTO\s+game_events/i.test(q.trim()));
  assert.ok(lockIdx >= 0, "FOR UPDATE must be issued");
  assert.ok(loadIdx > lockIdx, "load must follow FOR UPDATE on the same client");
  assert.ok(saveIdx > lockIdx, "save must follow FOR UPDATE on the same client");
  assert.ok(eventIdx > lockIdx, "event-append must follow FOR UPDATE on the same client");
});

test("handleCommandTransactional rolls back the transaction when handleCommand returns a non-ok result", async () => {
  // MoveHero onto a tile already occupied by h1 must fail with "occupied"
  // (engine rejects it). The transactional wrapper must NOT issue the
  // save or event-append in that case -- otherwise a client sending a
  // command that fails validation could partially-mutate state.
  const row = makeRow(
    [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 3, 2)],
    [makeSettlement("s0", 0, 2, 2)],
  );
  const { deps, queries } = makeTransactionalDeps(row);
  const command: Command = {
    kind: "MoveHero",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    fromTile: { q: 2, r: 2 },
    toTile: { q: 3, r: 2 },
    cost: 1,
  };
  const result = await handleCommandTransactional(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "occupied");
  // FOR UPDATE was acquired; no UPDATE games SET / INSERT INTO game_events
  // issued (engine rejected before either).
  assert.ok(queries().some((q) => /FOR UPDATE/i.test(q)));
  assert.ok(!queries().some((q) => /^UPDATE\s+games\s+set/i.test(q.trim())), "no save issued on engine failure");
  assert.ok(!queries().some((q) => /^INSERT\s+INTO\s+game_events/i.test(q.trim())), "no event issued on engine failure");
});

test("RecruitHero adds a new hero, deducts the recruit cost, and updates the player's heroIds", async () => {
  const row = makeRow(
    // h0 parked away from s0's own tile -- recruitHero()'s "Hex is
    // occupied" check (packages/engine/src/hero/recruit.ts) would
    // otherwise reject spawning the new hero right on top of it.
    [makeHero("h0", 0, 9, 9)],
    [makeSettlement("s0", 0, 2, 2, { gold: 50 })],
  );
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const command: Command = {
    kind: "RecruitHero",
    gameName: "test-game",
    actor: 0,
    heroName: "Sir Newman",
    settlementId: "s0",
    horseVariant: "bubbly",
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(result.hero?.name, "Sir Newman");
  assert.equal(result.hero?.ownerId, 0);
  const newHeroId = result.hero!.id;
  assert.ok(gameRepo.rows["test-game"].heroes[newHeroId], "new hero should be persisted");
  assert.ok(result.players?.find((p) => p.id === 0)?.heroIds.includes(newHeroId));
  // HERO_RECRUIT_COST is 1 gold (packages/engine/src/hero/recruit.ts).
  assert.equal(gameRepo.rows["test-game"].settlements.s0.gold, 49);
  assert.equal(eventRepo.events.map((e) => e.kind).join(","), "HeroRecruited");
});

test("RecruitHero rejects recruiting at a settlement the actor doesn't own", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2)],
    [makeSettlement("s0", 1, 2, 2, { gold: 50 })],
  );
  const { deps } = makeDeps(row);
  const command: Command = {
    kind: "RecruitHero",
    gameName: "test-game",
    actor: 0,
    heroName: "Sir Newman",
    settlementId: "s0",
    horseVariant: "bubbly",
  };
const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "Not your settlement");
});

test("UpgradeTownHall starts an upgrade on a level-1 town hall with enough resources", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2)],
    [
      makeSettlement("s0", 0, 2, 2, {
        gold: 2000,
        warehouse: { wood: 20, stone: 15, iron: 0, arcane: 0, food: 0 },
        buildings: [{ gx: 0, gy: 0, kind: "townHall", level: 1, style: "classic" }],
      }),
    ],
  );
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const command: Command = { kind: "UpgradeTownHall", gameName: "test-game", actor: 0, settlementId: "s0", targetLevel: 2 };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(result.settlement?.upgrade?.kind, "townHall");
  assert.equal(result.settlement?.upgrade?.targetLevel, 2);
  // TOWN_HALL_COSTS[1] = { gold: 1500, ... } (packages/engine/src/settlement/upgradeTownHall.ts).
  assert.equal(gameRepo.rows["test-game"].settlements.s0.gold, 500);
  assert.equal(eventRepo.events.map((e) => e.kind).join(","), "TownHallUpgradeStarted");
});

test("UpgradeTownHall rejects a settlement the actor doesn't own -- startTownHallUpgrade() never checked this itself", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2)],
    [
      makeSettlement("s0", 1, 2, 2, {
        gold: 2000,
        warehouse: { wood: 20, stone: 15, iron: 0, arcane: 0, food: 0 },
        buildings: [{ gx: 0, gy: 0, kind: "townHall", level: 1, style: "classic" }],
      }),
    ],
  );
  const { deps } = makeDeps(row);
  const command: Command = { kind: "UpgradeTownHall", gameName: "test-game", actor: 0, settlementId: "s0", targetLevel: 2 };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "forbidden_not_your_settlement");
});

test("SetAutoTrade toggles the flag on the actor's own settlement", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2)],
    [makeSettlement("s0", 0, 2, 2, { autoTrade: true })],
  );
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const command: Command = { kind: "SetAutoTrade", gameName: "test-game", actor: 0, settlementId: "s0", autoTrade: false };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(result.settlement?.autoTrade, false);
  assert.equal(gameRepo.rows["test-game"].settlements.s0.autoTrade, false);
  assert.equal(eventRepo.events.map((e) => e.kind).join(","), "AutoTradeToggled");
});

test("SetAutoTrade rejects toggling a settlement the actor doesn't own -- setAutoTrade() never checked this itself", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2)],
    [makeSettlement("s0", 1, 2, 2, { autoTrade: true })],
  );
  const { deps } = makeDeps(row);
  const command: Command = { kind: "SetAutoTrade", gameName: "test-game", actor: 0, settlementId: "s0", autoTrade: false };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "forbidden_not_your_settlement");
});

test("ReorderStack swaps two of the actor's own hero's stack slots", async () => {
  const row = makeRow(
    [
      makeHero("h0", 0, 2, 2, {
        stacks: [makeSingleEntryPlatoon("a", 1), makeSingleEntryPlatoon("b", 2)],
      }),
    ],
    [makeSettlement("s0", 0, 2, 2)],
  );
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const command: Command = { kind: "ReorderStack", gameName: "test-game", actor: 0, heroId: "h0", fromIdx: 0, toIdx: 1 };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(result.hero?.stacks[0].entries[0].unitTypeId, "b");
  assert.equal(result.hero?.stacks[1].entries[0].unitTypeId, "a");
  assert.equal(gameRepo.rows["test-game"].heroes.h0.stacks[0].entries[0].unitTypeId, "b");
  assert.equal(eventRepo.events.map((e) => e.kind).join(","), "StackReordered");
});

test("ReorderStack rejects reordering a hero the actor doesn't own -- no existing code checked this before this port", async () => {
  const row = makeRow(
    [
      makeHero("h0", 1, 2, 2, {
        stacks: [makeSingleEntryPlatoon("a", 1), makeSingleEntryPlatoon("b", 2)],
      }),
    ],
    [makeSettlement("s0", 1, 2, 2)],
  );
  const { deps } = makeDeps(row);
  const command: Command = { kind: "ReorderStack", gameName: "test-game", actor: 0, heroId: "h0", fromIdx: 0, toIdx: 1 };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "forbidden_not_your_hero");
});

test("CaptureSettlement lets a hero standing on an enemy settlement capture it and awards gold", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 5, 5, { gold: 10 })],
    [makeSettlement("s0", 1, 5, 5)],
  );
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const command: Command = { kind: "CaptureSettlement", gameName: "test-game", actor: 0, heroId: "h0", settlementId: "s0" };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(result.settlement?.ownerId, 0);
  // CAPTURE_GOLD_REWARD is 100 (packages/engine/src/settlement/capture.ts).
  assert.equal(result.hero?.gold, 110);
  assert.ok(result.players?.find((p) => p.id === 0)?.settlementIds.includes("s0"));
  assert.equal(gameRepo.rows["test-game"].settlements.s0.ownerId, 0);
  assert.equal(eventRepo.events.map((e) => e.kind).join(","), "SettlementCaptured");
});

test("CaptureSettlement rejects a hero that isn't actually standing on the settlement -- the largest gap this port closes", async () => {
  // captureSettlement() itself never compares hero/settlement position at
  // all -- see packages/contracts/src/commands/captureSettlement.ts's own
  // header comment. h0 is nowhere near s0 here.
  const row = makeRow(
    [makeHero("h0", 0, 2, 2, { gold: 10 })],
    [makeSettlement("s0", 1, 5, 5)],
  );
  const { deps } = makeDeps(row);
  const command: Command = { kind: "CaptureSettlement", gameName: "test-game", actor: 0, heroId: "h0", settlementId: "s0" };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "hero_not_at_settlement");
});

// ---------------------------------------------------------------------------
// StartCharter (plan/2026-08-17-consolidated-phase-1-5-track-map.md §5.1
// R5): the last Track 3.A-era command port, closing a real client/server
// desync bug (charter state applied locally was previously silently
// reverted by the next EndTurn round-trip). Follows RecruitHero's own
// two-test template (happy path + a validation-gap rejection), plus a
// dedicated regression test for the counter-persistence gap this port's
// own audit found (server/persistence/repositories/gameRepo.ts's
// next_charter_id/next_settlement_id columns).
// ---------------------------------------------------------------------------

const CHARTER_WAREHOUSE: SettlementState["warehouse"] = { wood: 100, stone: 100, iron: 0, arcane: 0, food: 0 };

test("StartCharter founds a new charter, deducts hero gold and settlement warehouse, and persists it via charterRepo", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2, { gold: 5000 })],
    [makeSettlement("s0", 0, 2, 2, { warehouse: CHARTER_WAREHOUSE })],
  );
  const { gameRepo, eventRepo, heroRepo, settlementRepo, charterRepo, deps } = makeDeps(row);
  const map = new GameMap(row.seed, undefined);
  const target = findChartersTarget(map, [{ q: 2, r: 2 }]);
  const command: Command = {
    kind: "StartCharter",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    targetQ: target.q,
    targetR: target.r,
    settlementName: "New Town",
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true, `expected StartCharter to succeed, got reason=${result.reason}`);
  assert.equal(result.hero?.isChartering, true);
  assert.equal(result.hero?.charterId, "ch0");
  // CHARTER_GOLD_COST is 2500, CHARTER_WAREHOUSE_COST is {wood:20, stone:15}
  // (packages/engine/src/charter/start.ts).
  assert.equal(gameRepo.rows["test-game"].heroes.h0.gold, 2500);
  assert.equal(gameRepo.rows["test-game"].settlements.s0.warehouse.wood, 80);
  assert.equal(gameRepo.rows["test-game"].settlements.s0.warehouse.stone, 85);
  assert.equal(gameRepo.rows["test-game"].next_charter_id, 1);
  assert.equal(gameRepo.rows["test-game"].next_settlement_id, 2);
  assert.equal(heroRepo.calls.length, 1);
  assert.equal(settlementRepo.calls.length, 1);
  assert.equal(charterRepo.calls.length, 1);
  assert.equal(charterRepo.calls[0].value.length, 1);
  assert.equal(charterRepo.calls[0].value[0].id, "ch0");
  assert.equal(charterRepo.calls[0].value[0].settlementId, "s1");
  assert.equal(charterRepo.calls[0].value[0].phase, "traveling");
  assert.equal(eventRepo.events.map((e) => e.kind).join(","), "CharterStarted");
});

test("StartCharter rejects a target hex too close to an existing settlement -- a check the engine function itself doesn't make", async () => {
  // @heroes/engine's startCharter() (packages/engine/src/charter/start.ts)
  // has no distance-from-settlement check at all -- that guarantee existed
  // purely because src/state/turnController.ts's own startCharter() method
  // pre-checked it client-side before ever calling the engine reducer.
  const row = makeRow(
    [makeHero("h0", 0, 2, 2, { gold: 5000 })],
    [makeSettlement("s0", 0, 2, 2, { warehouse: CHARTER_WAREHOUSE })],
  );
  const { deps } = makeDeps(row);
  const map = new GameMap(row.seed, undefined);
  const target = findTooCloseButPassableTarget(map, { q: 2, r: 2 });
  const command: Command = {
    kind: "StartCharter",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    targetQ: target.q,
    targetR: target.r,
    settlementName: "Too Close",
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "too_close_to_settlement");
});

test("StartCharter allocates a distinct charterId/settlementId for a second charter in the same game -- next_charter_id/next_settlement_id counter-persistence regression", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2, { gold: 5000 }), makeHero("h1", 0, 2, 2, { gold: 5000 })],
    [makeSettlement("s0", 0, 2, 2, { warehouse: CHARTER_WAREHOUSE })],
  );
  const { gameRepo, charterRepo, deps } = makeDeps(row);
  const map = new GameMap(row.seed, undefined);
  const target1 = findChartersTarget(map, [{ q: 2, r: 2 }]);
  const target2 = findChartersTarget(map, [{ q: 2, r: 2 }, target1]);

  const command1: Command = {
    kind: "StartCharter",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    targetQ: target1.q,
    targetR: target1.r,
    settlementName: "First Town",
  };
  const result1 = await handleCommand(command1, deps);
  assert.equal(result1.ok, true, `expected first StartCharter to succeed, got reason=${result1.reason}`);

  // Loads a fresh row via deps.gameRepo.load() again, exactly like a
  // second, independent HTTP request would -- if next_charter_id/
  // next_settlement_id weren't actually persisted and re-read (the bug
  // this test guards against), this would collide with command1's ids.
  const command2: Command = {
    kind: "StartCharter",
    gameName: "test-game",
    actor: 0,
    heroId: "h1",
    targetQ: target2.q,
    targetR: target2.r,
    settlementName: "Second Town",
  };
  const result2 = await handleCommand(command2, deps);
  assert.equal(result2.ok, true, `expected second StartCharter to succeed, got reason=${result2.reason}`);

  const charters = charterRepo.rows["test-game"];
  assert.equal(charters.length, 2);
  assert.equal(charters[0].id, "ch0");
  assert.equal(charters[1].id, "ch1");
  assert.equal(charters[0].settlementId, "s1");
  assert.equal(charters[1].settlementId, "s2");
  assert.equal(gameRepo.rows["test-game"].next_charter_id, 2);
  assert.equal(gameRepo.rows["test-game"].next_settlement_id, 3);
});

// ---------------------------------------------------------------------------
// Phase 4 Track A (plan/2026-08-17-phase-4-db-deblobbing-dev-plan.md):
// dual-write into heroRepo/settlementRepo alongside the existing
// gameRepo.saveHeroesAndSettlements JSONB write, and the granular-first
// read-path cutover (server/persistence/hydrate.ts). Every test above this
// banner never seeds heroRepo/settlementRepo/charterRepo (makeDeps's
// mocks default to empty), so they've all been implicitly exercising --
// and continue to exercise, unchanged -- the JSONB-fallback branch of
// hydrateFromRepos(). These tests specifically exercise the granular side.
// ---------------------------------------------------------------------------

test("MoveHero dual-writes the touched hero into heroRepo but never calls settlementRepo (settlements unchanged)", async () => {
  const row = makeRow([makeHero("h0", 0, 2, 2)], [makeSettlement("s0", 0, 2, 2)]);
  const { deps, heroRepo, settlementRepo } = makeDeps(row);
  const command: Command = {
    kind: "MoveHero",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    fromTile: { q: 2, r: 2 },
    toTile: { q: 3, r: 2 },
    cost: 1,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(heroRepo.calls.length, 1, "heroRepo.upsertMany should fire once");
  assert.equal(heroRepo.calls[0].value.h0.q, 3);
  assert.equal(settlementRepo.calls.length, 0, "settlementRepo.upsertMany should never fire for MoveHero");
});

test("TransferGold dual-writes both heroRepo and settlementRepo (both sides change)", async () => {
  const row = makeRow([makeHero("h0", 0, 2, 2, { gold: 50 })], [makeSettlement("s0", 0, 2, 2, { gold: 10 })]);
  const { deps, heroRepo, settlementRepo } = makeDeps(row);
  const command: Command = {
    kind: "TransferGold",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    settlementId: "s0",
    direction: "deposit",
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(heroRepo.calls.length, 1);
  assert.equal(heroRepo.calls[0].value.h0.gold, 0);
  assert.equal(settlementRepo.calls.length, 1);
  assert.equal(settlementRepo.calls[0].value.s0.gold, 60);
});

test("TradeResources dual-writes settlementRepo but never calls heroRepo (heroes unchanged)", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2)],
    [
      makeSettlement("s0", 0, 2, 2, { warehouse: { wood: 50, stone: 0, iron: 0, arcane: 0, food: 0 }, gold: 100 }),
      makeSettlement("s1", 0, 5, 5),
    ],
  );
  const { deps, heroRepo, settlementRepo } = makeDeps(row);
  const command: Command = {
    kind: "TradeResources",
    gameName: "test-game",
    actor: 0,
    fromSettlementId: "s0",
    toSettlementId: "s1",
    resource: "wood",
    amount: 10,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(heroRepo.calls.length, 0, "heroRepo.upsertMany should never fire for TradeResources");
  assert.equal(settlementRepo.calls.length, 1);
  assert.equal(settlementRepo.calls[0].value.s0.warehouse.wood, 40);
  assert.equal(settlementRepo.calls[0].value.s1.warehouse.wood, 10);
});

test("ResolveBattle dual-writes heroRepo but never calls settlementRepo (settlements unchanged)", async () => {
  const row = makeRow(
    [
      makeHero("h0", 0, 2, 2, { stacks: [makeSingleEntryPlatoon("hero_unit", 10)] }),
      makeHero("h1", 1, 3, 2, { gold: 40, stacks: [makeSingleEntryPlatoon("weak_unit", 1)] }),
    ],
    [makeSettlement("s0", 0, 2, 2)],
  );
  const { deps, heroRepo, settlementRepo } = makeDeps(row, RESOLVE_BATTLE_UNIT_TYPES);
  const command: Command = { kind: "ResolveBattle", gameName: "test-game", actor: 0, attackerId: "h0", defenderId: "h1" };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(heroRepo.calls.length, 1);
  assert.equal(heroRepo.calls[0].value.h0.gold, 40, "looted gold present in the dual-written hero record");
  assert.equal(settlementRepo.calls.length, 0);
});

test("SetAutoTrade dual-writes settlementRepo but never calls heroRepo", async () => {
  const row = makeRow([makeHero("h0", 0, 2, 2)], [makeSettlement("s0", 0, 2, 2, { autoTrade: true })]);
  const { deps, heroRepo, settlementRepo } = makeDeps(row);
  const command: Command = { kind: "SetAutoTrade", gameName: "test-game", actor: 0, settlementId: "s0", autoTrade: false };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(heroRepo.calls.length, 0);
  assert.equal(settlementRepo.calls.length, 1);
  assert.equal(settlementRepo.calls[0].value.s0.autoTrade, false);
});

test("SetAutoTrade rejecting as a no-op change never reaches the dual-write step", async () => {
  // nextState === state (setAutoTrade()'s own no-op short-circuit) returns
  // before saveHeroesAndSettlements/dualWriteEntities are ever called --
  // this guards against a future refactor accidentally moving the
  // dual-write step above that early return.
  const row = makeRow([makeHero("h0", 0, 2, 2)], [makeSettlement("s0", 0, 2, 2, { autoTrade: true })]);
  const { deps, heroRepo, settlementRepo } = makeDeps(row);
  const command: Command = { kind: "SetAutoTrade", gameName: "test-game", actor: 0, settlementId: "s0", autoTrade: true };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_change");
  assert.equal(heroRepo.calls.length, 0);
  assert.equal(settlementRepo.calls.length, 0);
});

test("EndTurn dual-writes heroRepo/settlementRepo and syncs charterRepo (a no-op full-sync with no active charters)", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2, { movementRemaining: 2, gold: 15 })],
    [makeSettlement("s0", 0, 2, 2)],
  );
  const { deps, heroRepo, settlementRepo, charterRepo } = makeDeps(row);
  const command: Command = { kind: "EndTurn", gameName: "test-game", actor: 0 };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(heroRepo.calls.length, 1);
  assert.equal(heroRepo.calls[0].value.h0.movementRemaining, 7);
  assert.equal(settlementRepo.calls.length, 1);
  // advanceRound()'s advanceCharters() call needs its result synced every
  // EndTurn now that StartCharter is ported -- charterRepo.upsertMany is
  // safe to call unconditionally on the granular path (its full-sync
  // DELETE is correct on a no-op empty array). The source gate that
  // prevents this same call from wiping real rows on JSONB fallback is
  // covered by the dedicated test below.
  assert.equal(charterRepo.calls.length, 1, "charterRepo.upsertMany now runs every EndTurn");
  assert.deepEqual(charterRepo.calls[0].value, []);
});

test("EndTurn does NOT call charterRepo when hydration fell back to JSONB -- guards against wiping real charter rows in a partially-backfilled game", async () => {
  // Counterpart to the test above: when hydrateFromRepos() falls back to
  // the legacy JSONB row (heroes or settlements granular table empty,
  // partial/inconsistent state), state.activeCharters is [] regardless of
  // what the charters table really contains -- so an unconditional
  // upsertMany([]) would silently DELETE real charter rows. Source gate
  // introduced after PR #105's Copilot review caught this.
  const row = makeRow(
    [makeHero("h0", 0, 2, 2, { movementRemaining: 2, gold: 15 })],
    [makeSettlement("s0", 0, 2, 2)],
  );
  const { deps, heroRepo, settlementRepo, charterRepo } = makeDeps(row);
  // Force the JSONB fallback: clear the granular seeds so hydrateFromRepos
  // sees heroes.length === 0 and returns source="jsonb".
  delete heroRepo.rows["test-game"];
  delete settlementRepo.rows["test-game"];
  charterRepo.rows["test-game"] = [
    {
      id: "ch0",
      heroId: "h99",
      ownerId: 0,
      targetQ: 5,
      targetR: 5,
      settlementName: "Real Charter",
      phase: "traveling",
      daysRemaining: 10,
      settlementId: "s5",
      resourceRates: {},
      foundedOnResource: null,
      citySpots: [],
    },
  ];
  const command: Command = { kind: "EndTurn", gameName: "test-game", actor: 0 };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(charterRepo.calls.length, 0, "must not write to charterRepo on JSONB fallback (would wipe real rows)");
  assert.equal(charterRepo.rows["test-game"].length, 1, "real charter row preserved");
});

test("StartCharter rejects outright when hydration fell back to JSONB -- no source for charterRepo.upsertMany to be safe against", async () => {
  // Symmetric to the EndTurn case above: StartCharter's success path
  // requires writing to charterRepo, but on JSONB fallback the hydrate
  // result can't see real charters that might exist, so racing them is
  // unsafe. Reject the command outright rather than risk overwriting.
  // Source gate runs BEFORE startCharter() and any persistence calls, so a
  // rejected StartCharter leaves gameRepo/heroRepo/settlementRepo/
  // charterRepo/eventRepo all untouched (unlike EndTurn/ResolveBattle's
  // gate, which runs after their engine pipeline because those pipelines
  // only touch heroes/settlements -- StartCharter is the only case that
  // touches the charters table hydrate-on-fallback can't see).
  const row = makeRow(
    [makeHero("h0", 0, 2, 2, { gold: 5000 })],
    [makeSettlement("s0", 0, 2, 2, { warehouse: CHARTER_WAREHOUSE })],
  );
  const { deps, gameRepo, heroRepo, settlementRepo, charterRepo, eventRepo } = makeDeps(row);
  delete heroRepo.rows["test-game"];
  delete settlementRepo.rows["test-game"];
  const command: Command = {
    kind: "StartCharter",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    targetQ: 6,
    targetR: 6,
    settlementName: "Won't Happen",
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "charters_persist_unavailable");
  // No side effects: the rejection must be a true no-op.
  assert.equal(charterRepo.calls.length, 0);
  assert.equal(heroRepo.calls.length, 0);
  assert.equal(settlementRepo.calls.length, 0);
  assert.equal(eventRepo.events.length, 0);
  // Counters must NOT have been incremented -- a rejected StartCharter must
  // leave next_charter_id/next_settlement_id exactly as they were. gameRepo
  // doesn't expose a `calls` array the way the other mock repos do, but
  // saveHeroesAndSettlements is the only path that mutates those fields;
  // asserting the row reference is unchanged (same object as input) is the
  // strongest "saveHeroesAndSettlements never ran" proof -- if it had run,
  // mockGameRepo would have replaced `rows[name]` with a new spread object.
  assert.equal(gameRepo.rows["test-game"], row);
});

test("read-path cutover: a game with granular hero/settlement rows hydrates from those instead of the (differing) legacy JSONB row", async () => {
  // TransferGold is deliberately the command exercised here, not MoveHero:
  // MoveHero's staleness guard (commandHandler.ts's MoveHero case) checks
  // command.fromTile against `row.heroes[heroId]` -- the raw JSONB row --
  // by design (it's meant to catch a client computing a path against a
  // position that's since changed underneath it), not against the
  // granular-or-JSONB-sourced `state`. In real operation that's harmless
  // (dual-write keeps row and the granular tables value-identical for any
  // game either has ever touched), but it means MoveHero can't distinguish
  // "hydrated from JSONB" from "hydrated from granular" in a test either --
  // both always see the same row-sourced position for that specific check.
  // TransferGold has no such row-based pre-check; transferGold() itself
  // does every check (hero exists, settlement exists, position, ownership)
  // against `state` alone, so it's a clean signal for which source actually
  // fed the hydration.
  //
  // The JSONB row's own h0/s0 sit apart (9,9) -- if handleCommand hydrated
  // from it, transferGold() would reject with hero_not_at_settlement.
  // Seeding heroRepo/settlementRepo with both co-located at (2,2) and
  // asserting success is what proves hydrateFromRepos() actually took the
  // granular branch rather than silently falling back.
  const row = makeRow(
    [makeHero("h0", 0, 9, 9, { gold: 50 })],
    [makeSettlement("s0", 0, 2, 2, { gold: 10 })],
  );
  const { deps, heroRepo, settlementRepo } = makeDeps(row);
  heroRepo.rows["test-game"] = { h0: makeHero("h0", 0, 2, 2, { gold: 50 }) };
  settlementRepo.rows["test-game"] = { s0: makeSettlement("s0", 0, 2, 2, { gold: 10 }) };
  const command: Command = {
    kind: "TransferGold",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    settlementId: "s0",
    direction: "deposit",
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true, `expected granular-path hydration to co-locate h0/s0 at (2,2); got reason=${result.reason}`);
  assert.equal(result.settlement?.gold, 60);
});

test("read-path cutover: a game with only empty granular rows falls back to the legacy JSONB row unchanged", async () => {
  const row = makeRow([makeHero("h0", 0, 2, 2)], [makeSettlement("s0", 0, 2, 2)]);
  const { deps } = makeDeps(row);
  const command: Command = {
    kind: "MoveHero",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    fromTile: { q: 2, r: 2 },
    toTile: { q: 3, r: 2 },
    cost: 1,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(result.hero?.q, 3);
});

// ---------------------------------------------------------------------------
// UpgradeBuilding / UpgradeSettlement
// (plan/2026-08-17-issue-88-remaining-command-ports.md): the last two
// mutations issue #88's re-scoped review found still silently discarded by
// the EndTurn cutover. Both follow UpgradeTownHall's own template (happy
// path + ownership-gap rejection + one reducer rejection).

test("UpgradeBuilding starts an upgrade on a level-1 building with enough resources", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2)],
    [
      makeSettlement("s0", 0, 2, 2, {
        gold: 999999,
        warehouse: { wood: 999999, stone: 999999, iron: 0, arcane: 0, food: 0 },
        buildings: [{ gx: 1, gy: 1, kind: "market", level: 1, style: "classic" }],
      }),
    ],
  );
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const command: Command = {
    kind: "UpgradeBuilding",
    gameName: "test-game",
    actor: 0,
    settlementId: "s0",
    requests: [{ gx: 1, gy: 1, kind: "market" }],
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(result.settlement?.upgrade?.kind, "buildings");
  assert.deepEqual(gameRepo.rows["test-game"].settlements.s0.upgrade?.buildingRefs, [
    { gx: 1, gy: 1, kind: "market" },
  ]);
  assert.equal(eventRepo.events.map((e) => e.kind).join(","), "BuildingUpgradeStarted");
});

test("UpgradeBuilding rejects a missing settlement", async () => {
  const row = makeRow([makeHero("h0", 0, 2, 2)], [makeSettlement("s0", 0, 2, 2)]);
  const { deps } = makeDeps(row);
  const command: Command = {
    kind: "UpgradeBuilding",
    gameName: "test-game",
    actor: 0,
    settlementId: "does-not-exist",
    requests: [{ gx: 1, gy: 1, kind: "market" }],
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_settlement");
});

test("UpgradeBuilding rejects a settlement the actor doesn't own -- startBuildingUpgrade() never checked this itself", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2)],
    [
      makeSettlement("s0", 1, 2, 2, {
        gold: 999999,
        warehouse: { wood: 999999, stone: 999999, iron: 0, arcane: 0, food: 0 },
        buildings: [{ gx: 1, gy: 1, kind: "market", level: 1, style: "classic" }],
      }),
    ],
  );
  const { deps } = makeDeps(row);
  const command: Command = {
    kind: "UpgradeBuilding",
    gameName: "test-game",
    actor: 0,
    settlementId: "s0",
    requests: [{ gx: 1, gy: 1, kind: "market" }],
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "forbidden_not_your_settlement");
});

test("UpgradeBuilding rejects a building already at max level", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2)],
    [
      makeSettlement("s0", 0, 2, 2, {
        gold: 999999,
        warehouse: { wood: 999999, stone: 999999, iron: 0, arcane: 0, food: 0 },
        buildings: [{ gx: 1, gy: 1, kind: "market", level: 3, style: "classic" }],
      }),
    ],
  );
  const { deps } = makeDeps(row);
  const command: Command = {
    kind: "UpgradeBuilding",
    gameName: "test-game",
    actor: 0,
    settlementId: "s0",
    requests: [{ gx: 1, gy: 1, kind: "market" }],
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "max_level");
});

test("UpgradeSettlement starts an upgrade on a level-1 settlement with enough resources, population, and town hall level", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2)],
    [
      makeSettlement("s0", 0, 2, 2, {
        level: 1,
        population: 100000,
        gold: 999999,
        warehouse: { wood: 999999, stone: 999999, iron: 999999, arcane: 999999, food: 0 },
        buildings: [{ gx: 0, gy: 0, kind: "townHall", level: 2, style: "classic" }],
      }),
    ],
  );
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const command: Command = {
    kind: "UpgradeSettlement",
    gameName: "test-game",
    actor: 0,
    settlementId: "s0",
    upgradePopulationGate: 0,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(result.settlement?.upgrade?.kind, "settlement");
  assert.equal(result.settlement?.upgrade?.targetLevel, 2);
  assert.equal(gameRepo.rows["test-game"].settlements.s0.upgrade?.targetLevel, 2);
  assert.equal(eventRepo.events.map((e) => e.kind).join(","), "SettlementUpgradeStarted");
});

test("UpgradeSettlement rejects a missing settlement", async () => {
  const row = makeRow([makeHero("h0", 0, 2, 2)], [makeSettlement("s0", 0, 2, 2)]);
  const { deps } = makeDeps(row);
  const command: Command = {
    kind: "UpgradeSettlement",
    gameName: "test-game",
    actor: 0,
    settlementId: "does-not-exist",
    upgradePopulationGate: 0,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_settlement");
});

test("UpgradeSettlement rejects a settlement the actor doesn't own -- startSettlementUpgrade() never checked this itself", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2)],
    [
      makeSettlement("s0", 1, 2, 2, {
        level: 1,
        population: 100000,
        gold: 999999,
        warehouse: { wood: 999999, stone: 999999, iron: 999999, arcane: 999999, food: 0 },
        buildings: [{ gx: 0, gy: 0, kind: "townHall", level: 2, style: "classic" }],
      }),
    ],
  );
  const { deps } = makeDeps(row);
  const command: Command = {
    kind: "UpgradeSettlement",
    gameName: "test-game",
    actor: 0,
    settlementId: "s0",
    upgradePopulationGate: 0,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "forbidden_not_your_settlement");
});

test("UpgradeSettlement rejects when population is below the client-supplied gate", async () => {
  // upgradePopulationGate is trusted from the client (see
  // packages/contracts/src/commands/upgradeSettlement.ts's header comment)
  // -- this pins down that the server still enforces whatever gate value it
  // was sent, not that it ignores the gate entirely.
  const row = makeRow(
    [makeHero("h0", 0, 2, 2)],
    [
      makeSettlement("s0", 0, 2, 2, {
        level: 1,
        population: 0,
        gold: 999999,
        warehouse: { wood: 999999, stone: 999999, iron: 999999, arcane: 999999, food: 0 },
        buildings: [{ gx: 0, gy: 0, kind: "townHall", level: 2, style: "classic" }],
      }),
    ],
  );
  const { deps } = makeDeps(row);
  const command: Command = {
    kind: "UpgradeSettlement",
    gameName: "test-game",
    actor: 0,
    settlementId: "s0",
    upgradePopulationGate: 1,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "population_too_low");
});

// ---------------------------------------------------------------------------
// Cross-cutting EndTurn-survival regression class
// (plan/2026-08-17-issue-88-remaining-command-ports.md's "Background"
// section): nothing in this file previously chained "issue command -> run
// EndTurn -> re-hydrate -> assert the mutation survived" for ANY mutation
// type, not even the five #88 originally reported that are otherwise fully
// covered above by their own isolated happy-path tests. This is the
// regression #88 actually needed -- its absence is why #88 shipped in the
// first place, and it's why re-persisting the mutation (via
// saveHeroesAndSettlements + dualWriteEntities inside each case above)
// isn't enough on its own to prove the fix: only a second handleCommand
// call, against the same in-memory repos, reusing the row EndTurn's own
// hydrateFromRepos() will read, proves the mutation is still there once
// EndTurn's read-then-overwrite cycle has run.
//
// Each test below deliberately ends the SAME player's turn who made the
// mutation, without wrapping the round (two players, so one EndTurn call
// only advances active_player_id -- see "EndTurn advances to the next
// player without wrapping the round" above). advanceRound()'s settlement
// upgrade/charter advancement only runs on a round wrap
// (server/app/turnService.ts), so a non-wrapping EndTurn here is the
// simplest case that isolates "did the mutation survive hydration" from
// "did advancing the round also change it," while still exercising the
// exact hydrate-then-persist cycle the original bug was about.

test("RecruitHero survives an EndTurn round-trip", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 9, 9)],
    [makeSettlement("s0", 0, 2, 2, { gold: 50 })],
  );
  const { gameRepo, deps } = makeDeps(row);
  const recruit: Command = {
    kind: "RecruitHero",
    gameName: "test-game",
    actor: 0,
    heroName: "Sir Newman",
    settlementId: "s0",
    horseVariant: "bubbly",
  };
  const recruitResult = await handleCommand(recruit, deps);
  assert.equal(recruitResult.ok, true);
  const newHeroId = recruitResult.hero!.id;

  const endTurnResult = await handleCommand(
    { kind: "EndTurn", gameName: "test-game", actor: 0 },
    deps,
  );
  assert.equal(endTurnResult.ok, true);
  assert.ok(
    gameRepo.rows["test-game"].heroes[newHeroId],
    "recruited hero must survive EndTurn's hydrate-then-persist cycle",
  );
});

test("UpgradeTownHall survives an EndTurn round-trip", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2)],
    [
      makeSettlement("s0", 0, 2, 2, {
        gold: 2000,
        warehouse: { wood: 20, stone: 15, iron: 0, arcane: 0, food: 0 },
        buildings: [{ gx: 0, gy: 0, kind: "townHall", level: 1, style: "classic" }],
      }),
    ],
  );
  const { gameRepo, deps } = makeDeps(row);
  const upgrade: Command = {
    kind: "UpgradeTownHall",
    gameName: "test-game",
    actor: 0,
    settlementId: "s0",
    targetLevel: 2,
  };
  assert.equal((await handleCommand(upgrade, deps)).ok, true);

  const endTurnResult = await handleCommand(
    { kind: "EndTurn", gameName: "test-game", actor: 0 },
    deps,
  );
  assert.equal(endTurnResult.ok, true);
  assert.equal(
    gameRepo.rows["test-game"].settlements.s0.upgrade?.kind,
    "townHall",
    "town hall upgrade must survive EndTurn's hydrate-then-persist cycle",
  );
});

test("SetAutoTrade survives an EndTurn round-trip", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2)],
    [makeSettlement("s0", 0, 2, 2, { autoTrade: true })],
  );
  const { gameRepo, deps } = makeDeps(row);
  const toggle: Command = {
    kind: "SetAutoTrade",
    gameName: "test-game",
    actor: 0,
    settlementId: "s0",
    autoTrade: false,
  };
  assert.equal((await handleCommand(toggle, deps)).ok, true);

  const endTurnResult = await handleCommand(
    { kind: "EndTurn", gameName: "test-game", actor: 0 },
    deps,
  );
  assert.equal(endTurnResult.ok, true);
  assert.equal(
    gameRepo.rows["test-game"].settlements.s0.autoTrade,
    false,
    "auto-trade toggle must survive EndTurn's hydrate-then-persist cycle",
  );
});

test("ReorderStack survives an EndTurn round-trip", async () => {
  const row = makeRow(
    [
      makeHero("h0", 0, 2, 2, {
        stacks: [makeSingleEntryPlatoon("a", 1), makeSingleEntryPlatoon("b", 2)],
      }),
    ],
    [makeSettlement("s0", 0, 2, 2)],
  );
  const { gameRepo, deps } = makeDeps(row);
  const reorder: Command = { kind: "ReorderStack", gameName: "test-game", actor: 0, heroId: "h0", fromIdx: 0, toIdx: 1 };
  assert.equal((await handleCommand(reorder, deps)).ok, true);

  const endTurnResult = await handleCommand(
    { kind: "EndTurn", gameName: "test-game", actor: 0 },
    deps,
  );
  assert.equal(endTurnResult.ok, true);
  assert.equal(
    gameRepo.rows["test-game"].heroes.h0.stacks[0].entries[0].unitTypeId,
    "b",
    "reordered stack must survive EndTurn's hydrate-then-persist cycle",
  );
});

test("CaptureSettlement survives an EndTurn round-trip", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 5, 5, { gold: 10 })],
    [makeSettlement("s0", 1, 5, 5)],
  );
  const { gameRepo, deps } = makeDeps(row);
  const capture: Command = { kind: "CaptureSettlement", gameName: "test-game", actor: 0, heroId: "h0", settlementId: "s0" };
  assert.equal((await handleCommand(capture, deps)).ok, true);

  const endTurnResult = await handleCommand(
    { kind: "EndTurn", gameName: "test-game", actor: 0 },
    deps,
  );
  assert.equal(endTurnResult.ok, true);
  assert.equal(
    gameRepo.rows["test-game"].settlements.s0.ownerId,
    0,
    "captured settlement must survive EndTurn's hydrate-then-persist cycle",
  );
});

test("UpgradeBuilding survives an EndTurn round-trip -- the gap this port closes", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2)],
    [
      makeSettlement("s0", 0, 2, 2, {
        gold: 999999,
        warehouse: { wood: 999999, stone: 999999, iron: 0, arcane: 0, food: 0 },
        buildings: [{ gx: 1, gy: 1, kind: "market", level: 1, style: "classic" }],
      }),
    ],
  );
  const { gameRepo, deps } = makeDeps(row);
  const upgrade: Command = {
    kind: "UpgradeBuilding",
    gameName: "test-game",
    actor: 0,
    settlementId: "s0",
    requests: [{ gx: 1, gy: 1, kind: "market" }],
  };
  assert.equal((await handleCommand(upgrade, deps)).ok, true);

  const endTurnResult = await handleCommand(
    { kind: "EndTurn", gameName: "test-game", actor: 0 },
    deps,
  );
  assert.equal(endTurnResult.ok, true);
  assert.equal(
    gameRepo.rows["test-game"].settlements.s0.upgrade?.kind,
    "buildings",
    "building upgrade must survive EndTurn's hydrate-then-persist cycle",
  );
});

test("UpgradeSettlement survives an EndTurn round-trip -- the gap this port closes", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2)],
    [
      makeSettlement("s0", 0, 2, 2, {
        level: 1,
        population: 100000,
        gold: 999999,
        warehouse: { wood: 999999, stone: 999999, iron: 999999, arcane: 999999, food: 0 },
        buildings: [{ gx: 0, gy: 0, kind: "townHall", level: 2, style: "classic" }],
      }),
    ],
  );
  const { gameRepo, deps } = makeDeps(row);
  const upgrade: Command = {
    kind: "UpgradeSettlement",
    gameName: "test-game",
    actor: 0,
    settlementId: "s0",
    upgradePopulationGate: 0,
  };
  assert.equal((await handleCommand(upgrade, deps)).ok, true);

  const endTurnResult = await handleCommand(
    { kind: "EndTurn", gameName: "test-game", actor: 0 },
    deps,
  );
  assert.equal(endTurnResult.ok, true);
  assert.equal(
    gameRepo.rows["test-game"].settlements.s0.upgrade?.kind,
    "settlement",
    "settlement upgrade must survive EndTurn's hydrate-then-persist cycle",
  );
});
