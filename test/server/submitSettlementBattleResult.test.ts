import { test } from "node:test";
import assert from "node:assert/strict";
import type { Command, HeroId, HeroState, Player, Platoon, SettlementId, SettlementState } from "@heroes/contracts";
import { MOVEMENT_PER_TURN } from "@heroes/contracts";
import type { HydratableGameRow, UnitType } from "@heroes/engine";
import { CAPTURE_GOLD_REWARD, DEFAULT_TREASURY_WAGONS, WAGON_GOLD_CAPACITY, normalizePlatoons } from "@heroes/engine";
import { handleCommand } from "../../server/app/commandHandler";
import { makeCharter } from "../charter/_helpers";
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
  // Phase 1 heroGoldCap enforcement: the capture reward is clamped to the
  // attacker's treasury-cart purse headroom; this hero holds the legacy
  // soft default (2,500g cap) with 100g in it, so the full 100g lands.
  assert.equal(
    result.attackerHero?.gold,
    100 + Math.min(CAPTURE_GOLD_REWARD, DEFAULT_TREASURY_WAGONS * WAGON_GOLD_CAPACITY - 100),
    "100 purse + the headroom-clamped CAPTURE_GOLD_REWARD",
  );

  assert.equal(result.lastEventId, 1);
  assert.deepEqual(eventRepo.events[0].payload, {
    type: "SettlementBattleResolved",
    actor: 0,
    attackerId: "h0",
    settlementId: "s1",
    winner: "attacker",
    captured: true,
    outcome: "attackerWon",
    attackerVerdict: "stood",
  });

  const saved = gameRepo.rows["test-game"];
  assert.equal(saved.settlements.s1.ownerId, 0);
  assert.deepEqual(saved.settlements.s1.stacks, normalizePlatoons([]));
  assert.equal(saved.heroes.h0.gold, 100 + Math.min(CAPTURE_GOLD_REWARD, DEFAULT_TREASURY_WAGONS * WAGON_GOLD_CAPACITY - 100));
  assert.ok(saved.players.find((p) => p.id === 0)?.settlementIds.includes("s1"), "winner's seat gains the settlement");
  assert.ok(!saved.players.find((p) => p.id === 1)?.settlementIds.includes("s1"), "loser's seat loses it");
  assert.equal(heroRepo.calls.length, 1, "heroes dual-written");
  assert.equal(settlementRepo.calls.length, 1, "settlements dual-written");
  assert.equal(settlementRepo.calls[0].value.s1.ownerId, 0);
});

test("defenderWon REMOVES the wiped attacker: row gone, heroIds pruned, platoons swept, verdict defeated", async () => {
  const { gameRepo, eventRepo, heroRepo, deps } = makeDeps(makeSettlementBattleRow());
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
  assert.equal(saved.heroes.h0, undefined, "the wiped attacker is deleted from the heroes record");
  assert.deepEqual(
    saved.players.find((p) => p.id === 0)?.heroIds,
    [],
    "attacker pruned from seat 0's heroIds",
  );
  assert.equal("h0" in heroRepo.calls[0].value, false, "the granular upsert omits the removed hero (NOT-IN platoon sweep input)");
  assert.equal(saved.settlements.s1.ownerId, 1, "no capture on a loss");
  assert.deepEqual(saved.settlements.s1.stacks, normalizePlatoons([stack("swordsman", 2)]), "garrison survivors persist");
  assert.equal(saved.heroes.h0?.gold, undefined);

  assert.equal(result.attackerHero, undefined, "the removed attacker is omitted from the result");
  assert.equal(result.attackerVerdict, "defeated");
  assert.deepEqual(result.settlement?.stacks, normalizePlatoons([stack("swordsman", 2)]));

  assert.deepEqual(eventRepo.events[0].payload, {
    type: "SettlementBattleResolved",
    actor: 0,
    attackerId: "h0",
    settlementId: "s1",
    winner: "defender",
    captured: false,
    outcome: "defenderWon",
    attackerVerdict: "defeated",
  });
});

test("a defeat removes a chartering attacker's outstanding charter (granular charters persisted)", async () => {
  const row = makeSettlementBattleRow({ isChartering: true, charterId: "c-traveling" });
  const { gameRepo, deps } = makeDeps(row);
  const seeded = createMockCharterRepo({
    "test-game": [makeCharter({ id: "c-traveling", heroId: "h0", ownerId: 0 })],
  });
  deps.charterRepo = seeded;
  const result = await handleCommand(
    settlementBattleCommand({
      outcome: "defenderWon",
      attackerStacks: [],
      defenderStacks: [stack("swordsman", 2)],
    }),
    deps,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(seeded.rows["test-game"], [], "the removed attacker's outstanding charter is gone");
  assert.equal(gameRepo.rows["test-game"].heroes.h0, undefined, "the chartering attacker is removed outright");
});

test("retreat zeroes the stacks and relocates the attacker to their nearest OWNED settlement", async () => {
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
  const retreated = saved.heroes.h0;
  assert.ok(retreated, "a retreat keeps the hero");
  assert.equal(retreated.q, 0, "relocated to the owner's nearest settlement (s0 at 0,0)");
  assert.equal(retreated.r, 0);
  assert.equal(retreated.movementRemaining, MOVEMENT_PER_TURN, "fresh-turn movement at the relocation hex");
  assert.deepEqual(retreated.trail, [{ q: 0, r: 0 }], "trail reseeded at the settlement");
  assert.deepEqual(retreated.stacks, normalizePlatoons([]), "retreat loses ALL troops");
  assert.equal(retreated.troops, 0);
  assert.equal(result.attackerVerdict, "retreated");
  assert.deepEqual(result.attackerHero, retreated);
  assert.equal(eventRepo.events[0].payload.captured, false);
  assert.equal(eventRepo.events[0].payload.winner, "defender");
});

test("retreat with no owned settlement stays at the post-cancel position (D1)", async () => {
  const row = makeSettlementBattleRow();
  row.settlements.s0 = makeSettlement("s0", null, 0, 0);
  const { gameRepo, deps } = makeDeps(row);
  const result = await handleCommand(
    settlementBattleCommand({
      outcome: "retreat",
      attackerStacks: [stack("swordsman", 3)],
      defenderStacks: [stack("swordsman", 2)],
    }),
    deps,
  );
  assert.equal(result.ok, true);

  const retreated = gameRepo.rows["test-game"].heroes.h0;
  assert.ok(retreated, "D1 keeps the hero in the record");
  assert.equal(retreated.q, 4, "stays at the cancelled pre-move hex");
  assert.equal(retreated.r, 5);
  assert.equal(retreated.movementRemaining, 7, "cancelMove's movement restoration stands");
  assert.deepEqual(retreated.stacks, normalizePlatoons([]), "troops are still lost");
  assert.equal(result.attackerVerdict, "retreated");
});

test("surrender deducts the priced gold, relocates to the nearest OWNED settlement, keeps the army", async () => {
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
  const conceded = saved.heroes.h0;
  assert.ok(conceded, "a surrender keeps the hero");
  assert.equal(conceded.gold, 60, "surrender price debited from the attacker's purse");
  assert.equal(conceded.q, 0, "relocated to the owner's nearest settlement (s0 at 0,0)");
  assert.equal(conceded.r, 0);
  assert.deepEqual(conceded.trail, [{ q: 0, r: 0 }]);
  assert.deepEqual(conceded.stacks, normalizePlatoons([stack("swordsman", 5)]), "surrender keeps the army");
  assert.deepEqual(saved.settlements.s1.stacks, normalizePlatoons([stack("swordsman", 2)]), "garrison intact");
  assert.equal(saved.settlements.s1.ownerId, 1);
  assert.equal(result.attackerVerdict, "surrendered");
  assert.deepEqual(result.attackerHero, conceded);
  assert.deepEqual(eventRepo.events[0].payload, {
    type: "SettlementBattleResolved",
    actor: 0,
    attackerId: "h0",
    settlementId: "s1",
    winner: "defender",
    captured: false,
    outcome: "defenderWon",
    attackerVerdict: "surrendered",
  });
});

test("a draw with survivors on both sides bounces the attacker unchanged (verdict stood)", async () => {
  const { gameRepo, eventRepo, heroRepo, deps } = makeDeps(makeSettlementBattleRow());
  const result = await handleCommand(
    settlementBattleCommand({
      outcome: "draw",
      attackerStacks: [stack("swordsman", 3)],
      defenderStacks: [stack("swordsman", 2)],
    }),
    deps,
  );
  assert.equal(result.ok, true);

  const saved = gameRepo.rows["test-game"];
  const hero = saved.heroes.h0;
  assert.ok(hero, "a stalemate keeps the attacker standing");
  assert.equal(hero.q, 4, "bounce to the pre-move hex");
  assert.equal(hero.r, 5);
  assert.equal(hero.movementRemaining, 7, "pre-move movement restored");
  assert.deepEqual(hero.stacks, normalizePlatoons([stack("swordsman", 3)]), "survivor stacks kept");
  assert.deepEqual(saved.settlements.s1.stacks, normalizePlatoons([stack("swordsman", 2)]), "garrison replaced with submitted survivors");
  assert.equal(result.attackerVerdict, "stood");
  assert.deepEqual(result.attackerHero, hero);
  assert.equal("h0" in heroRepo.calls[0].value, true, "the surviving attacker persists");
  assert.deepEqual(eventRepo.events[0].payload, {
    type: "SettlementBattleResolved",
    actor: 0,
    attackerId: "h0",
    settlementId: "s1",
    // Legacy collapsed winner stays defender; the truthful draw rides
    // `outcome` (B6/D6) so event-derived wording can say stalemate.
    winner: "defender",
    captured: false,
    outcome: "draw",
    attackerVerdict: "stood",
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

test("a NEUTRAL garrisoned settlement accepts the battle win and captures for the attacker", async () => {
  const players: Player[] = [
    { id: 0, faction: "player", name: "Player 1", color: "#000000", heroIds: ["h0"], settlementIds: ["s0"] },
    { id: 1, faction: "ai", name: "AI", color: "#111111", heroIds: ["h1"], settlementIds: ["s1"] },
  ];
  const row: HydratableGameRow = {
    name: "test-game",
    seed: 1,
    round: 1,
    day: 1,
    active_player_id: 0,
    players,
    heroes: {
      h0: makeHero("h0", 0, 5, 5, {
        gold: 100,
        stacks: [stack("swordsman", 5)],
        previousQ: 4,
        previousR: 5,
        previousMovementRemaining: 7,
        movementRemaining: 6,
      }),
      h1: makeHero("h1", 1, 18, 4),
    },
    settlements: {
      s0: makeSettlement("s0", 0, 0, 0),
      s2: makeSettlement("s2", null, 5, 5, { stacks: [stack("swordsman", 2)] }),
    },
  };
  const { gameRepo, eventRepo, settlementRepo, deps } = makeDeps(row);
  const command = settlementBattleCommand({ settlementId: "s2" });
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true, `neutral garrisoned settlement must be fightable: ${result.reason}`);

  assert.equal(result.settlement?.ownerId, 0, "neutral settlement flipped to the attacker");
  assert.deepEqual(result.settlement?.stacks, normalizePlatoons([]));
  // Same clamped-reward shape as the enemy-settlement case: 100 purse +
  // min(100, headroom of the 2,500g soft-default cap) = 200 (Phase 1).
  assert.equal(
    result.attackerHero?.gold,
    100 + Math.min(CAPTURE_GOLD_REWARD, DEFAULT_TREASURY_WAGONS * WAGON_GOLD_CAPACITY - 100),
    "100 purse + the headroom-clamped CAPTURE_GOLD_REWARD",
  );
  assert.deepEqual(eventRepo.events[0].payload, {
    type: "SettlementBattleResolved",
    actor: 0,
    attackerId: "h0",
    settlementId: "s2",
    winner: "attacker",
    captured: true,
    outcome: "attackerWon",
    attackerVerdict: "stood",
  });

  const saved = gameRepo.rows["test-game"];
  assert.equal(saved.settlements.s2.ownerId, 0);
  assert.ok(saved.players.find((p) => p.id === 0)?.settlementIds.includes("s2"), "attacker's seat gains the neutral settlement");
  assert.ok(!saved.players.find((p) => p.id === 1)?.settlementIds.includes("s2"));
  assert.equal(settlementRepo.calls[0].value.s2.ownerId, 0);
});
