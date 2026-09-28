import { test } from "node:test";
import assert from "node:assert/strict";
import type { Command, HeroId, HeroState, Player, PlayerId, Platoon, SettlementId, SettlementState } from "@heroes/contracts";
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

function stack(unitTypeId: string, count: number): Platoon {
  return { entries: [{ unitTypeId, count }] };
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

function transferRow(): HydratableGameRow {
  return makeRow(
    [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 2, 2)],
    [
      makeSettlement("s0", 0, 2, 2, { stacks: [stack("swordsman", 2)] }),
      makeSettlement("s1", 1, 9, 9),
    ],
  );
}

test("TransferUnits toHero moves garrison stacks into the hero's platoons and emits UnitsTransferred", async () => {
  const { gameRepo, eventRepo, heroRepo, settlementRepo, deps } = makeDeps(transferRow());
  const command: Command = {
    kind: "TransferUnits",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    settlementId: "s0",
    direction: "toHero",
    unitTypeId: "swordsman",
    count: 2,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, true);

  assert.deepEqual(result.hero?.stacks, normalizePlatoons([stack("swordsman", 2)]), "hero received the units");
  assert.deepEqual(result.settlement?.stacks, normalizePlatoons([]), "garrison drained");

  assert.equal(result.lastEventId, 1);
  assert.deepEqual(eventRepo.events[0].payload, {
    type: "UnitsTransferred",
    actor: 0,
    heroId: "h0",
    settlementId: "s0",
    direction: "toHero",
    unitTypeId: "swordsman",
    count: 2,
  });

  const saved = gameRepo.rows["test-game"];
  assert.deepEqual(saved.heroes.h0.stacks, normalizePlatoons([stack("swordsman", 2)]));
  assert.deepEqual(saved.settlements.s0.stacks, normalizePlatoons([]));
  assert.equal(heroRepo.calls.length, 1, "both sides changed, both repos dual-write");
  assert.equal(settlementRepo.calls.length, 1);
});

test("TransferUnits rejects a hero that isn't standing on the settlement tile", async () => {
  const row = makeRow(
    [makeHero("h0", 0, 2, 2)],
    [makeSettlement("s0", 0, 9, 9, { stacks: [stack("swordsman", 2)] })],
  );
  const { deps, eventRepo, heroRepo, settlementRepo } = makeDeps(row);
  const command: Command = {
    kind: "TransferUnits",
    gameName: "test-game",
    actor: 0,
    heroId: "h0",
    settlementId: "s0",
    direction: "toHero",
    unitTypeId: "swordsman",
    count: 2,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "hero_not_at_settlement");
  assert.equal(eventRepo.events.length, 0);
  assert.equal(heroRepo.calls.length, 0);
  assert.equal(settlementRepo.calls.length, 0);
});

test("TransferUnits rejects a hero the actor doesn't own", async () => {
  const { deps, eventRepo } = makeDeps(transferRow());
  const command: Command = {
    kind: "TransferUnits",
    gameName: "test-game",
    actor: 0,
    heroId: "h1",
    settlementId: "s1",
    direction: "toHero",
    unitTypeId: "swordsman",
    count: 2,
  };
  const result = await handleCommand(command, deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "forbidden_not_your_hero");
  assert.equal(eventRepo.events.length, 0);
});
