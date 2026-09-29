import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  BuildingDef,
  Command,
  HeroId,
  HeroState,
  Player,
  PlayerId,
  SettlementId,
  SettlementState,
} from "@heroes/contracts";
import type { HydratableGameRow } from "@heroes/engine";
import { normalizePlatoons } from "@heroes/engine";
import { handleCommand } from "../../server/app/commandHandler";
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

function building(kind: BuildingDef["kind"], gx: number, gy: number, level = 1): BuildingDef {
  return { gx, gy, kind, level, style: "classic" };
}

const PLAYERS: Player[] = [
  { id: 0, faction: "player", name: "Player 1", color: "#000000", heroIds: ["h0"], settlementIds: ["s0"] },
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

const BARRACKS = { gx: 2, gy: 3 };

function recruitRow(settlementOverrides: Partial<SettlementState> = {}): HydratableGameRow {
  return makeRow(
    [makeHero("h0", 0, 9, 9)],
    [
      makeSettlement("s0", 0, 5, 5, {
        gold: 1000,
        buildings: [building("barracks", BARRACKS.gx, BARRACKS.gy)],
        ...settlementOverrides,
      }),
      makeSettlement("s1", 1, 18, 4),
    ],
  );
}

function recruitCommand(overrides: Partial<Extract<Command, { kind: "RecruitUnits" }>> = {}): Extract<Command, { kind: "RecruitUnits" }> {
  return {
    kind: "RecruitUnits",
    gameName: "test-game",
    actor: 0,
    settlementId: "s0",
    buildingKind: "barracks",
    gx: BARRACKS.gx,
    gy: BARRACKS.gy,
    unitTypeId: "swordsman",
    count: 2,
    ...overrides,
  };
}

test("RecruitUnits recruits 2 swordsmen into the garrison, deducts treasury gold, and emits UnitsRecruited", async () => {
  const { gameRepo, eventRepo, heroRepo, settlementRepo, deps } = makeDeps(recruitRow());
  const result = await handleCommand(recruitCommand(), deps);
  assert.equal(result.ok, true);

  const garrison = result.settlement?.stacks ?? [];
  assert.equal(garrison.length, 8, "garrison normalizes to the fixed 8 platoon slots");
  assert.deepEqual(garrison[0].entries, [{ unitTypeId: "swordsman", count: 2 }]);
  assert.equal(result.settlement?.gold, 600, "2 swordsmen at 200g each");
  assert.equal(result.lastEventId, 1);
  assert.deepEqual(eventRepo.events[0].payload, {
    type: "UnitsRecruited",
    actor: 0,
    settlementId: "s0",
    unitTypeId: "swordsman",
    count: 2,
  });

  const saved = gameRepo.rows["test-game"].settlements.s0;
  assert.equal(saved.gold, 600, "settlement gold deducted in the saved row");
  assert.deepEqual(saved.stacks, normalizePlatoons([{ entries: [{ unitTypeId: "swordsman", count: 2 }] }]));
  assert.equal(settlementRepo.calls.length, 1, "settlement dual-write fires");
  assert.equal(settlementRepo.calls[0].value.s0.gold, 600);
  assert.equal(heroRepo.calls.length, 0, "heroes unchanged, heroRepo never called");
});

test("RecruitUnits rejects recruiting from a settlement the actor doesn't own", async () => {
  const { gameRepo, eventRepo, deps } = makeDeps(recruitRow({ ownerId: 1 }));
  const result = await handleCommand(recruitCommand(), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "forbidden_not_your_settlement");
  assert.equal(eventRepo.events.length, 0);
  assert.equal(gameRepo.rows["test-game"].settlements.s0.gold, 1000, "nothing persisted on rejection");
});

test("RecruitUnits rejects a buildingKind/gx/gy that matches no placed building", async () => {
  const { deps, eventRepo } = makeDeps(recruitRow());
  const result = await handleCommand(recruitCommand({ gx: 9, gy: 9 }), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_building");
  assert.equal(eventRepo.events.length, 0);
});

test("RecruitUnits rejects a unit above the building's level (pikeman needs barracks L2)", async () => {
  const { deps, eventRepo } = makeDeps(recruitRow());
  const result = await handleCommand(recruitCommand({ unitTypeId: "pikeman", count: 1 }), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "building_level_too_low");
  assert.equal(eventRepo.events.length, 0);
});

test("RecruitUnits rejects more recruits than the treasury can pay for and persists nothing", async () => {
  const { gameRepo, eventRepo, settlementRepo, deps } = makeDeps(recruitRow({ gold: 100 }));
  const result = await handleCommand(recruitCommand({ count: 1 }), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_enough_gold");
  assert.equal(eventRepo.events.length, 0);
  assert.equal(gameRepo.rows["test-game"].settlements.s0.gold, 100);
  assert.equal(settlementRepo.calls.length, 0);
});

test("RecruitUnits rejects a count of 0", async () => {
  const { deps, eventRepo } = makeDeps(recruitRow());
  const result = await handleCommand(recruitCommand({ count: 0 }), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_count");
  assert.equal(eventRepo.events.length, 0);
});
