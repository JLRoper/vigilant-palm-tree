import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, Command, HeroId, HeroState, Player, PlayerId, SettlementId, SettlementState } from "@heroes/contracts";
import type { HydratableGameRow } from "@heroes/engine";
import { handleCommand } from "../../server/app/commandHandler";
import {
  createMockCharterRepo,
  createMockEventRepo,
  createMockGameRepo,
  createMockHeroRepo,
  createMockSettlementRepo,
} from "../helpers/mockRepos";

// Server-level pins for the two new commands (faction-construction plan,
// sections 5 and 6): DemolishBuilding and StartWorkerTransit, through
// handleCommand with mock repos -- same style as test/server/recruitUnits.test.ts.

function makeHero(id: HeroId, ownerId: PlayerId, q: number, r: number): HeroState {
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

function building(kind: BuildingDef["kind"], gx: number, gy: number, level = 1): BuildingDef {
  return { gx, gy, kind, level, style: "classic" };
}

const PLAYERS: Player[] = [
  { id: 0, faction: "player", name: "Player 1", color: "#000000", heroIds: ["h0"], settlementIds: ["s0", "s1"] },
  { id: 1, faction: "ai", name: "AI", color: "#111111", heroIds: [], settlementIds: [] },
];

function makeRow(settlements: SettlementState[], overrides: Partial<HydratableGameRow> = {}): HydratableGameRow {
  return {
    name: "test-game",
    seed: 1,
    round: 1,
    day: 1,
    active_player_id: 0,
    players: PLAYERS,
    heroes: { h0: makeHero("h0", 0, 9, 9) },
    settlements: Object.fromEntries(settlements.map((s) => [s.id, s])),
    ...overrides,
  };
}

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
    deps: { gameRepo, eventRepo, heroRepo, settlementRepo, charterRepo, ctx: { rng: () => 0.5, catalog: { unitTypes: [] } } },
  };
}

// ── DemolishBuilding (section 5) ──

test("DemolishBuilding removes an owned building and consumes the per-turn cap", async () => {
  const row = makeRow([makeSettlement("s0", 0, 2, 2, { buildings: [building("house", 1, 1)] })]);
  const { deps, eventRepo, gameRepo } = makeDeps(row);
  const command: Extract<Command, { kind: "DemolishBuilding" }> = {
    kind: "DemolishBuilding",
    gameName: "test-game",
    actor: 0,
    settlementId: "s0",
    gx: 1,
    gy: 1,
    buildingKind: "house",
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(result.settlement?.buildings, []);
  assert.equal(result.settlement?.constructionActionUsedThisTurn, true);
  assert.equal(eventRepo.events[0]?.payload.type, "BuildingDemolished");
  assert.deepEqual(gameRepo.rows["test-game"].settlements.s0.buildings, []);

  // A second PlaceBuildings on the same settlement in the same turn is now blocked.
  const second = await handleCommand(
    { kind: "PlaceBuildings", gameName: "test-game", actor: 0, settlementId: "s0", buildings: [building("house", 2, 2)] },
    deps,
  );
  assert.equal(second.ok, false);
  assert.equal(second.reason, "construction_action_already_used_this_turn");
});

test("DemolishBuilding refuses a non-owner", async () => {
  const row = makeRow([makeSettlement("s0", 1, 2, 2, { buildings: [building("house", 3, 3)] })]);
  const { deps } = makeDeps(row);
  // active_player_id is 0 (seat 0's turn) and s0 belongs to seat 1, so
  // this reaches the reducer's own ownership check rather than the
  // generic turn-ownership gate.
  const forbidden = await handleCommand(
    { kind: "DemolishBuilding", gameName: "test-game", actor: 0, settlementId: "s0", gx: 3, gy: 3, buildingKind: "house" },
    deps,
  );
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.reason, "forbidden_not_your_settlement");
});

test("DemolishBuilding refuses a missing building and the town hall", async () => {
  const row = makeRow([makeSettlement("s0", 0, 2, 2, { buildings: [building("townHall", 1, 1), building("house", 3, 3)] })]);
  const { deps } = makeDeps(row);
  const missing = await handleCommand(
    { kind: "DemolishBuilding", gameName: "test-game", actor: 0, settlementId: "s0", gx: 9, gy: 9, buildingKind: "house" },
    deps,
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "no_building");

  const townHall = await handleCommand(
    { kind: "DemolishBuilding", gameName: "test-game", actor: 0, settlementId: "s0", gx: 1, gy: 1, buildingKind: "townHall" },
    deps,
  );
  assert.equal(townHall.ok, false);
  assert.equal(townHall.reason, "cannot_demolish_town_hall");
});

// ── StartWorkerTransit (section 6) ──

const WORKER_STACKS = [{ entries: [{ unitTypeId: "construction_worker_human", count: 1 }] }];

test("StartWorkerTransit sends a worker from an owned settlement to another, removing it from the origin garrison", async () => {
  const row = makeRow([
    makeSettlement("s0", 0, 2, 2, { gold: 10000, stacks: WORKER_STACKS }),
    makeSettlement("s1", 0, 6, 2, { gold: 0 }),
  ]);
  const { deps, eventRepo, gameRepo } = makeDeps(row);
  const command: Extract<Command, { kind: "StartWorkerTransit" }> = {
    kind: "StartWorkerTransit",
    gameName: "test-game",
    actor: 0,
    originSettlementId: "s0",
    destinationSettlementId: "s1",
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.workerTransits?.length, 1);
  assert.equal(result.workerTransits?.[0].originSettlementId, "s0");
  assert.equal(result.workerTransits?.[0].destinationSettlementId, "s1");
  assert.deepEqual(
    (result.settlement?.stacks ?? []).flatMap((p) => p.entries).filter((e) => e.unitTypeId === "construction_worker_human"),
    [],
    "the worker left the origin garrison",
  );
  assert.equal(eventRepo.events[0]?.payload.type, "WorkerTransitStarted");
  assert.equal(gameRepo.rows["test-game"].worker_transits?.length, 1, "persisted on the game row");
});

test("StartWorkerTransit refuses without a construction worker present", async () => {
  const row = makeRow([makeSettlement("s0", 0, 2, 2, { gold: 10000 }), makeSettlement("s1", 0, 6, 2)]);
  const { deps } = makeDeps(row);
  const noWorker = await handleCommand(
    { kind: "StartWorkerTransit", gameName: "test-game", actor: 0, originSettlementId: "s0", destinationSettlementId: "s1" },
    deps,
  );
  assert.equal(noWorker.ok, false);
  assert.equal(noWorker.reason, "no_construction_worker_present");
});

test("StartWorkerTransit refuses for a non-owner of the origin settlement", async () => {
  const row = makeRow([
    makeSettlement("s0", 1, 2, 2, { gold: 10000, stacks: WORKER_STACKS }),
    makeSettlement("s1", 0, 6, 2),
  ]);
  const { deps } = makeDeps(row);
  const forbidden = await handleCommand(
    { kind: "StartWorkerTransit", gameName: "test-game", actor: 0, originSettlementId: "s0", destinationSettlementId: "s1" },
    deps,
  );
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.reason, "forbidden_not_your_settlement");
});

test("StartWorkerTransit with buildRoads refuses without enough gold for the toll", async () => {
  const row = makeRow([
    makeSettlement("s0", 0, 2, 2, { gold: 0, stacks: WORKER_STACKS }),
    makeSettlement("s1", 0, 6, 2),
  ]);
  const { deps } = makeDeps(row);
  const result = await handleCommand(
    { kind: "StartWorkerTransit", gameName: "test-game", actor: 0, originSettlementId: "s0", destinationSettlementId: "s1", buildRoads: true },
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_enough_gold");
});
