import { test } from "node:test";
import assert from "node:assert/strict";
import type { Command, HeroId, HeroState, Player, Platoon, SettlementId, SettlementState } from "@heroes/contracts";
import type { HydratableGameRow, UnitType } from "@heroes/engine";
import { normalizePlatoons } from "@heroes/engine";
import { handleCommand } from "../../server/app/commandHandler";
import {
  createMockCharterRepo,
  createMockEventRepo,
  createMockGameRepo,
  createMockHeroRepo,
  createMockSettlementRepo,
} from "../helpers/mockRepos";

// Server-side coverage for the SubmitSettlementBattleResult command
// (unit-recruitment/garrison plan tasks 6+7): the manual arena's played-out
// settlement-garrison battle, applied through the engine's
// applySettlementBattleResult reducer. Same harness as
// submitBattleResult.test.ts (makeDeps-style fakes, handleCommand called
// directly); the wire-shape half of the validation lives in parseCommand.

function makeHero(id: HeroId, ownerId: number, q: number, r: number, overrides: Partial<HeroState> = {}): HeroState {
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
  ownerId: number | null,
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
  { id: 0, faction: "player", name: "Player 1", color: "#000000", heroIds: ["h0"], settlementIds: ["s0"] },
  { id: 1, faction: "ai", name: "AI", color: "#111111", heroIds: ["h1"], settlementIds: ["s1"] },
];

const UNIT_TYPES: UnitType[] = [
  {
    id: "swordsman",
    name: "Swordsman",
    attack: 5,
    defence: 5,
    health: 20,
    speed: 3,
    description: "",
    advantageType: "infantry",
    specialty: "shield",
    specialtyPriority: 0,
  },
];

function makeDeps(row: HydratableGameRow, unitTypes: UnitType[] = UNIT_TYPES) {
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

function stack(unitTypeId: string, count: number): Platoon {
  return { entries: [{ unitTypeId, count }] };
}

// The canonical fixture: h0 (seat 0's attacker) walked from (4,5) onto the
// enemy settlement s1's tile at (5,5), whose garrison holds 2 swordsmen.
// previousQ/R/movement populated exactly like startMove leaves them, which
// is what the defenderWon/retreat/surrender cancel path restores.
function makeSettlementBattleRow(
  attackerOverrides: Partial<HeroState> = {},
  settlementOverrides: Partial<SettlementState> = {},
): HydratableGameRow {
  return {
    name: "test-game",
    seed: 1,
    round: 1,
    day: 1,
    active_player_id: 0,
    players: PLAYERS,
    heroes: {
      h0: makeHero("h0", 0, 5, 5, {
        gold: 100,
        stacks: [stack("swordsman", 5)],
        previousQ: 4,
        previousR: 5,
        previousMovementRemaining: 7,
        movementRemaining: 6,
        ...attackerOverrides,
      }),
      h1: makeHero("h1", 1, 18, 4),
    },
    settlements: {
      s0: makeSettlement("s0", 0, 0, 0),
      s1: makeSettlement("s1", 1, 5, 5, {
        stacks: [stack("swordsman", 2)],
        ...settlementOverrides,
      }),
    },
  };
}

function settlementBattleCommand(
  overrides: Partial<Extract<Command, { kind: "SubmitSettlementBattleResult" }>> = {},
): Extract<Command, { kind: "SubmitSettlementBattleResult" }> {
  return {
    kind: "SubmitSettlementBattleResult",
    gameName: "test-game",
    actor: 0,
    attackerId: "h0",
    settlementId: "s1",
    outcome: "attackerWon",
    attackerStacks: [stack("swordsman", 3)],
    defenderStacks: [],
    rounds: 5,
    obstacleSeed: 42,
    ...overrides,
  };
}

test("attackerWon captures the settlement: owner flips, garrison empties, attacker pockets CAPTURE_GOLD_REWARD", async () => {
  const { gameRepo, eventRepo, heroRepo, settlementRepo, deps } = makeDeps(makeSettlementBattleRow());
  const result = await handleCommand(settlementBattleCommand(), deps);
  assert.equal(result.ok, true);

  assert.equal(result.settlement?.ownerId, 0, "settlement flipped to the attacker's seat");
  assert.deepEqual(result.settlement?.stacks, normalizePlatoons([]), "garrison destroyed on capture");
  assert.equal(result.attackerHero?.gold, 200, "100 purse + CAPTURE_GOLD_REWARD (100)");

  assert.equal(result.lastEventId, 1);
  assert.deepEqual(eventRepo.events[0].payload, {
    type: "SettlementBattleResolved",
    actor: 0,
    attackerId: "h0",
    settlementId: "s1",
    winner: "attacker",
    captured: true,
  });

  const saved = gameRepo.rows["test-game"];
  assert.equal(saved.settlements.s1.ownerId, 0);
  assert.deepEqual(saved.settlements.s1.stacks, normalizePlatoons([]));
  assert.equal(saved.heroes.h0.gold, 200);
  assert.ok(saved.players.find((p) => p.id === 0)?.settlementIds.includes("s1"), "winner's seat gains the settlement");
  assert.ok(!saved.players.find((p) => p.id === 1)?.settlementIds.includes("s1"), "loser's seat loses it");
  assert.equal(heroRepo.calls.length, 1, "heroes dual-written");
  assert.equal(settlementRepo.calls.length, 1, "settlements dual-written");
  assert.equal(settlementRepo.calls[0].value.s1.ownerId, 0);
});

test("defenderWon persists the garrison survivors and cancels the attacker's move", async () => {
  const { gameRepo, eventRepo, deps } = makeDeps(makeSettlementBattleRow());
  const result = await handleCommand(
    settlementBattleCommand({
      outcome: "defenderWon",
      attackerStacks: [],
      defenderStacks: [stack("swordsman", 2)],
    }),
    deps,
  );
  assert.equal(result.ok, true);

  const saved = gameRepo.rows["test-game"];
  assert.equal(saved.settlements.s1.ownerId, 1, "no capture on a loss");
  assert.deepEqual(saved.settlements.s1.stacks, normalizePlatoons([stack("swordsman", 2)]), "garrison survivors persist");
  assert.equal(saved.heroes.h0.q, 4, "cancelMove restored the pre-move hex");
  assert.equal(saved.heroes.h0.r, 5);
  assert.equal(saved.heroes.h0.movementRemaining, 7, "pre-move movement restored");
  assert.equal(saved.heroes.h0.previousQ, null);
  assert.deepEqual(saved.heroes.h0.stacks, normalizePlatoons([]));
  assert.equal(saved.heroes.h0.gold, 100, "no capture reward without a capture");

  assert.deepEqual(eventRepo.events[0].payload, {
    type: "SettlementBattleResolved",
    actor: 0,
    attackerId: "h0",
    settlementId: "s1",
    winner: "defender",
    captured: false,
  });
});

test("retreat leaves the garrison intact (pre-battle stacks) and bounces the attacker", async () => {
  const { gameRepo, eventRepo, deps } = makeDeps(makeSettlementBattleRow());
  const result = await handleCommand(
    settlementBattleCommand({
      outcome: "retreat",
      attackerStacks: [stack("swordsman", 3)],
      defenderStacks: [stack("swordsman", 2)],
    }),
    deps,
  );
  assert.equal(result.ok, true);

  const saved = gameRepo.rows["test-game"];
  assert.deepEqual(
    saved.settlements.s1.stacks,
    normalizePlatoons([stack("swordsman", 2)]),
    "a retreat never touches the garrison",
  );
  assert.equal(saved.settlements.s1.ownerId, 1);
  assert.equal(saved.heroes.h0.q, 4, "attacker bounced back");
  assert.equal(saved.heroes.h0.r, 5);
  assert.equal(saved.heroes.h0.movementRemaining, 7);
  assert.equal(saved.heroes.h0.previousQ, null);
  assert.equal(eventRepo.events[0].payload.captured, false);
  assert.equal(eventRepo.events[0].payload.winner, "defender");
});

test("surrender deducts the priced gold from the attacker and keeps both armies", async () => {
  const { gameRepo, eventRepo, deps } = makeDeps(makeSettlementBattleRow());
  const result = await handleCommand(
    settlementBattleCommand({
      outcome: "surrender",
      attackerStacks: [stack("swordsman", 5)],
      defenderStacks: [stack("swordsman", 2)],
      surrenderedGold: 40,
    }),
    deps,
  );
  assert.equal(result.ok, true);

  const saved = gameRepo.rows["test-game"];
  assert.equal(saved.heroes.h0.gold, 60, "surrender price debited from the attacker's purse");
  assert.equal(saved.heroes.h0.q, 4, "surrender cancels the attacker's move like a retreat");
  assert.deepEqual(saved.heroes.h0.stacks, normalizePlatoons([stack("swordsman", 5)]));
  assert.deepEqual(saved.settlements.s1.stacks, normalizePlatoons([stack("swordsman", 2)]), "garrison intact");
  assert.equal(saved.settlements.s1.ownerId, 1);
  assert.deepEqual(eventRepo.events[0].payload, {
    type: "SettlementBattleResolved",
    actor: 0,
    attackerId: "h0",
    settlementId: "s1",
    winner: "defender",
    captured: false,
  });
});

test("surrender is rejected when the priced gold exceeds the attacker's purse", async () => {
  const { gameRepo, eventRepo, heroRepo, settlementRepo, deps } = makeDeps(makeSettlementBattleRow());
  const result = await handleCommand(
    settlementBattleCommand({ outcome: "surrender", surrenderedGold: 40_000 }),
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "surrender_gold_exceeds_purse");
  assert.equal(eventRepo.events.length, 0);
  assert.equal(heroRepo.calls.length, 0, "nothing persisted on rejection");
  assert.equal(settlementRepo.calls.length, 0);
  assert.equal(gameRepo.rows["test-game"].heroes.h0.gold, 100);
});

test("a settlement with no garrison troops rejects the battle outright (garrison_empty)", async () => {
  const { deps, eventRepo } = makeDeps(makeSettlementBattleRow({}, { stacks: undefined }));
  const result = await handleCommand(settlementBattleCommand(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "garrison_empty");
  assert.equal(eventRepo.events.length, 0);
});

test("an attacker not standing on the settlement tile is rejected (hero_not_at_settlement)", async () => {
  const { deps, eventRepo } = makeDeps(makeSettlementBattleRow({ q: 7, r: 7, previousQ: 6, previousR: 7 }));
  const result = await handleCommand(settlementBattleCommand(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "hero_not_at_settlement");
  assert.equal(eventRepo.events.length, 0);
});

test("survivor stacks naming a unit outside the server's catalog are rejected", async () => {
  const { deps, eventRepo } = makeDeps(makeSettlementBattleRow());
  const result = await handleCommand(
    settlementBattleCommand({ attackerStacks: [stack("dragon", 3)] }),
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unknown_unit_type");
  assert.equal(eventRepo.events.length, 0);
});

test("a hero the actor doesn't own is rejected (forbidden_not_your_hero)", async () => {
  const { deps, eventRepo } = makeDeps(makeSettlementBattleRow());
  const result = await handleCommand(
    settlementBattleCommand({ attackerId: "h1" }),
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "forbidden_not_your_hero");
  assert.equal(eventRepo.events.length, 0);
});
