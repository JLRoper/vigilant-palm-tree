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
  assert.equal(saved.settlements.s1.ownerId, 0, "settlement captured in the same persist");
  assert.ok(saved.players.find((p) => p.id === 0)?.settlementIds.includes("s1"), "winner's seat gains the settlement");
  assert.ok(!saved.players.find((p) => p.id === 1)?.settlementIds.includes("s1"), "loser's seat loses it");
  assert.equal(result.attackerHero?.gold, 450);
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
  assert.equal(saved.settlements.s0.ownerId, 0, "own settlement untouched");
  assert.equal(saved.settlements.s1, undefined);
  assert.equal(result.attackerHero?.gold, 350);
  assert.equal(eventRepo.events.map((e) => e.kind).join(","), "BattleResolved");
  assert.equal(heroRepo.calls.length, 1);
  assert.equal(settlementRepo.calls.length, 0, "no settlement reference changed, dual-write gate skips the settlement repo");
});
