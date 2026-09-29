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

// The garrison guard half covers CaptureSettlement (unit-recruitment/garrison
// plan task 7): a walk-in capture only applies to a settlement whose garrison
// has been defeated (or never existed). The post-battle capture half covers
// the SubmitBattleResult branch that applies the same capture when an
// attacker ends a WON hero-vs-hero battle standing on an enemy settlement
// tile with an empty garrison (applyPostBattleCapture in
// server/app/commandHandler.ts). Same harness as submitBattleResult.test.ts.

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

function stack(unitTypeId: string, count: number): Platoon {
  return { entries: [{ unitTypeId, count }] };
}

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

function makeDeps(row: HydratableGameRow) {
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
    deps: { gameRepo, eventRepo, heroRepo, settlementRepo, charterRepo, ctx: { rng: () => 0.5, catalog: { unitTypes: UNIT_TYPES } } },
  };
}

test("CaptureSettlement with a live garrison is rejected (garrison_not_defeated)", async () => {
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
    heroes: { h0: makeHero("h0", 0, 5, 5, { gold: 10 }), h1: makeHero("h1", 1, 18, 4) },
    settlements: {
      s0: makeSettlement("s0", 0, 0, 0),
      s1: makeSettlement("s1", 1, 5, 5, { stacks: [stack("swordsman", 2)] }),
    },
  };
  const { gameRepo, eventRepo, heroRepo, settlementRepo, deps } = makeDeps(row);
  const command: Command = { kind: "CaptureSettlement", gameName: "test-game", actor: 0, heroId: "h0", settlementId: "s1" };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "garrison_not_defeated");
  assert.equal(eventRepo.events.length, 0);
  assert.equal(gameRepo.rows["test-game"].settlements.s1.ownerId, 1, "owner unchanged");
  assert.equal(heroRepo.calls.length, 0);
  assert.equal(settlementRepo.calls.length, 0);
});

test("CaptureSettlement with an explicitly emptied garrison still captures as before", async () => {
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
    heroes: { h0: makeHero("h0", 0, 5, 5, { gold: 10 }), h1: makeHero("h1", 1, 18, 4) },
    settlements: {
      s0: makeSettlement("s0", 0, 0, 0),
      s1: makeSettlement("s1", 1, 5, 5, { stacks: normalizePlatoons([]) }),
    },
  };
  const { gameRepo, eventRepo, deps } = makeDeps(row);
  const command: Command = { kind: "CaptureSettlement", gameName: "test-game", actor: 0, heroId: "h0", settlementId: "s1" };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.equal(result.settlement?.ownerId, 0);
  assert.equal(result.hero?.gold, 110, "10 purse + CAPTURE_GOLD_REWARD (100)");
  assert.equal(eventRepo.events.map((e) => e.kind).join(","), "SettlementCaptured");
  assert.equal(gameRepo.rows["test-game"].settlements.s1.ownerId, 0);
  assert.ok(gameRepo.rows["test-game"].players.find((p) => p.id === 0)?.settlementIds.includes("s1"));
});

function makePostBattleRow(withEnemySettlementOnTile: boolean): HydratableGameRow {
  const players: Player[] = [
    { id: 0, faction: "player", name: "Player 1", color: "#000000", heroIds: ["h0"], settlementIds: ["s0"] },
    { id: 1, faction: "ai", name: "AI", color: "#111111", heroIds: ["h1"], settlementIds: withEnemySettlementOnTile ? ["s1"] : [] },
  ];
  const settlements: Record<SettlementId, SettlementState> = { s0: makeSettlement("s0", 0, 0, 0) };
  if (withEnemySettlementOnTile) {
    settlements.s1 = makeSettlement("s1", 1, 3, 2);
  }
  return {
    name: "test-game",
    seed: 1,
    round: 1,
    day: 1,
    active_player_id: 0,
    players,
    heroes: {
      h0: makeHero("h0", 0, 3, 2, {
        gold: 100,
        stacks: [stack("swordsman", 5)],
        previousQ: 2,
        previousR: 2,
        previousMovementRemaining: 7,
        movementRemaining: 6,
      }),
      h1: makeHero("h1", 1, 3, 3, { gold: 250, stacks: [] }),
    },
    settlements,
  };
}

function submitBattleCommand(): Extract<Command, { kind: "SubmitBattleResult" }> {
  return {
    kind: "SubmitBattleResult",
    gameName: "test-game",
    actor: 0,
    attackerId: "h0",
    defenderId: "h1",
    outcome: "attackerWon",
    attackerStacks: [stack("swordsman", 3)],
    defenderStacks: [],
    rounds: 7,
    obstacleSeed: 42,
  };
}

test("post-battle capture: a won hero battle on an empty-garrison enemy settlement flips the owner and pays the 100g reward", async () => {
  const { gameRepo, eventRepo, heroRepo, settlementRepo, deps } = makeDeps(makePostBattleRow(true));
  const result = await handleCommand(submitBattleCommand(), deps);
  assert.equal(result.ok, true);

  const saved = gameRepo.rows["test-game"];
  assert.equal(saved.heroes.h0.gold, 450, "250 looted from the wiped defender + CAPTURE_GOLD_REWARD (100)");
  assert.equal(saved.heroes.h1, undefined, "the wiped defender is removed from the heroes record");
  assert.ok(!saved.players.find((p) => p.id === 1)?.heroIds.includes("h1"), "removed defender pruned from heroIds");
  assert.equal("h1" in heroRepo.calls[0].value, false, "granular upsert is a full sync -- h1 gone there too");
  assert.equal(saved.settlements.s1.ownerId, 0, "settlement captured in the same persist");
  assert.ok(saved.players.find((p) => p.id === 0)?.settlementIds.includes("s1"), "winner's seat gains the settlement");
  assert.ok(!saved.players.find((p) => p.id === 1)?.settlementIds.includes("s1"), "loser's seat loses it");
  assert.equal(result.attackerHero?.gold, 450);
  assert.equal(result.defenderHero, undefined, "the removed defender is omitted from the result");
  assert.equal(result.defenderVerdict, "defeated");
  assert.equal(eventRepo.events.map((e) => e.kind).join(","), "BattleResolved", "capture rides the battle persist, no extra event");
  assert.equal(heroRepo.calls.length, 1);
  assert.equal(settlementRepo.calls.length, 1);
  assert.equal(settlementRepo.calls[0].value.s1.ownerId, 0);
});

test("post-battle capture control: with no settlement on the post-win tile, the battle resolves with no capture", async () => {
  const { gameRepo, eventRepo, heroRepo, settlementRepo, deps } = makeDeps(makePostBattleRow(false));
  const result = await handleCommand(submitBattleCommand(), deps);
  assert.equal(result.ok, true);

  const saved = gameRepo.rows["test-game"];
  assert.equal(saved.heroes.h0.gold, 350, "loot only, no capture reward");
  assert.equal(saved.heroes.h1, undefined, "the wiped defender is removed even with no capture");
  assert.deepEqual(saved.players.find((p) => p.id === 1)?.heroIds, []);
  assert.equal(saved.settlements.s0.ownerId, 0, "own settlement untouched");
  assert.equal(saved.settlements.s1, undefined);
  assert.equal(result.attackerHero?.gold, 350);
  assert.equal(result.defenderHero, undefined);
  assert.equal(eventRepo.events.map((e) => e.kind).join(","), "BattleResolved");
  assert.equal(heroRepo.calls.length, 1);
  assert.equal(settlementRepo.calls.length, 0, "no settlement reference changed, dual-write gate skips the settlement repo");
});

// Capture-gate parity pin (2026-09-29 settlement-capture fixes): the server's
// applyPostBattleCapture skips NEUTRAL settlements by design; the reachable
// neutral case (attacker ends a won hero battle standing on a neutral,
// empty-garrison settlement tile) reconciles through the client's serialized
// walk-in CaptureSettlement POST instead. These tests pin both halves of that
// rule: no inline capture server-side, correct capture via the follow-up POST.
function makeNeutralPostBattleRow(): HydratableGameRow {
  const players: Player[] = [
    { id: 0, faction: "player", name: "Player 1", color: "#000000", heroIds: ["h0"], settlementIds: ["s0"] },
    { id: 1, faction: "ai", name: "AI", color: "#111111", heroIds: ["h1"], settlementIds: [] },
  ];
  return {
    name: "test-game",
    seed: 1,
    round: 1,
    day: 1,
    active_player_id: 0,
    players,
    heroes: {
      h0: makeHero("h0", 0, 3, 2, {
        gold: 100,
        stacks: [stack("swordsman", 5)],
        previousQ: 2,
        previousR: 2,
        previousMovementRemaining: 7,
        movementRemaining: 6,
      }),
      h1: makeHero("h1", 1, 3, 3, { gold: 250, stacks: [] }),
    },
    settlements: {
      s0: makeSettlement("s0", 0, 0, 0),
      s2: makeSettlement("s2", null, 3, 2),
    },
  };
}

test("post-battle capture parity: the server skips NEUTRAL settlements (no inline capture, no reward)", async () => {
  const { gameRepo, eventRepo, deps } = makeDeps(makeNeutralPostBattleRow());
  const result = await handleCommand(submitBattleCommand(), deps);
  assert.equal(result.ok, true);

  const saved = gameRepo.rows["test-game"];
  assert.equal(saved.settlements.s2.ownerId, null, "neutral settlement NOT captured inline");
  assert.equal(saved.heroes.h0.gold, 350, "loot only -- no CAPTURE_GOLD_REWARD without the inline capture");
  assert.ok(!saved.players.find((p) => p.id === 0)?.settlementIds.includes("s2"));
  assert.equal(eventRepo.events.map((e) => e.kind).join(","), "BattleResolved", "no SettlementCaptured event");
});

test("post-battle capture parity: the client's walk-in CaptureSettlement POST reconciles the neutral case", async () => {
  const { gameRepo, eventRepo, deps } = makeDeps(makeNeutralPostBattleRow());
  const battle = await handleCommand(submitBattleCommand(), deps);
  assert.equal(battle.ok, true);

  const command: Command = { kind: "CaptureSettlement", gameName: "test-game", actor: 0, heroId: "h0", settlementId: "s2" };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true, `walk-in capture must reconcile the neutral case: ${result.reason}`);

  const saved = gameRepo.rows["test-game"];
  assert.equal(saved.settlements.s2.ownerId, 0, "final ownership matches the client's walk-in rule");
  assert.equal(saved.heroes.h0.gold, 450, "350 loot + CAPTURE_GOLD_REWARD (100)");
  assert.ok(saved.players.find((p) => p.id === 0)?.settlementIds.includes("s2"));
  assert.equal(eventRepo.events.map((e) => e.kind).join(","), "BattleResolved,SettlementCaptured");
});

test("post-battle capture parity: a redundant CaptureSettlement after the server's inline capture is a benign already_owned no-op", async () => {
  const { gameRepo, eventRepo, heroRepo, settlementRepo, deps } = makeDeps(makePostBattleRow(true));
  const battle = await handleCommand(submitBattleCommand(), deps);
  assert.equal(battle.ok, true, "enemy-owned empty-garrison settlement captured inline with the battle");

  const command: Command = { kind: "CaptureSettlement", gameName: "test-game", actor: 0, heroId: "h0", settlementId: "s1" };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "already_owned");

  const saved = gameRepo.rows["test-game"];
  assert.equal(saved.settlements.s1.ownerId, 0, "the inline capture stands");
  assert.equal(saved.heroes.h0.gold, 450, "exactly one CAPTURE_GOLD_REWARD -- the no-op must not double-pay or revert");
  assert.equal(eventRepo.events.length, 1, "no second event for the no-op");
  assert.equal(heroRepo.calls.length, 1, "nothing re-persisted by the no-op");
  assert.equal(settlementRepo.calls.length, 1);
});
