import { test } from "node:test";
import assert from "node:assert/strict";
import type { Command, HeroState, Player, SettlementState } from "@heroes/contracts";
import { SETTLERS_MODE_DEFAULTS, coveredWagonIdFor, hexDistance, seatHeroIdFor } from "@heroes/contracts";
import { GameMap, resolveSavedMapGenVersion } from "@heroes/engine";
import type { HydratableGameRow, UnitType } from "@heroes/engine";
import { handleCommand } from "../../server/app/commandHandler";
import {
  createMockCharterRepo,
  createMockEventRepo,
  createMockGameRepo,
  createMockHeroRepo,
  createMockSettlementRepo,
} from "../helpers/mockRepos";

// The server half of the settlers founding command (SETTLERS-PLAN.md §4 W3):
// parseCommand's branch is covered end-to-end by the route suite; this file
// covers the handler case's own authority checks and the engine rule it relays,
// against mock repos (no DB, no ports).
//
// The wagon is a HeroState whose id is coveredWagonIdFor(seat) -- see
// packages/contracts/src/gameMode.ts for why the id, not a field, carries
// "wagon".

function makeWagon(seat: number, q: number, r: number, overrides: Partial<HeroState> = {}): HeroState {
  return {
    id: coveredWagonIdFor(seat),
    name: "Covered Wagon",
    ownerId: seat,
    q,
    r,
    movementRemaining: 7,
    previousQ: null,
    previousR: null,
    previousMovementRemaining: null,
    trail: [{ q, r }],
    gold: 0,
    troops: 0,
    stacks: [],
    isChartering: false,
    charterId: null,
    horseVariant: "hero",
    arcane: 0,
    intelligence: 0,
    heroMana: 0,
    heroMaxMana: 0,
    heroSpell: null,
    morale: 100,
    upkeepUnpaidSinceDay: null,
    upkeepUnpaidTroops: 0,
    upkeepUnpaidGold: 0,
    wagons: 5,
    treasuryWagons: 5,
    resources: { ...SETTLERS_MODE_DEFAULTS.wagonSupplies },
    ...overrides,
  };
}

function makeNeutral(id: string, q: number, r: number): SettlementState {
  return {
    id,
    name: id,
    ownerId: null,
    q,
    r,
    level: 2,
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
  };
}

const PLAYERS: Player[] = [
  { id: 0, faction: "player", name: "Player 1", color: "#000000", heroIds: [coveredWagonIdFor(0)], settlementIds: [] },
  { id: 1, faction: "ai", name: "AI 1", color: "#111111", heroIds: [coveredWagonIdFor(1)], settlementIds: [] },
];

function makeRow(
  heroes: HeroState[],
  settlements: SettlementState[],
  overrides: Partial<HydratableGameRow & { lobby?: unknown }> = {},
): HydratableGameRow & { lobby?: unknown } {
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

function makeDeps(row: HydratableGameRow & { lobby?: unknown }, unitTypes: UnitType[] = []) {
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
    deps: {
      gameRepo,
      eventRepo,
      heroRepo,
      settlementRepo,
      charterRepo,
      ctx: { rng: () => 0.5, catalog: { unitTypes } },
    },
  };
}

// The handler's case reconstructs the map from row.seed/row.map_size exactly as
// StartCharter's does; the target hex is searched on that same map rather than
// hard-coded, so a future terrain change cannot silently break these fixtures
// (the findChartersTarget pattern in commandHandler.test.ts).
function mapFor(row: HydratableGameRow): GameMap {
  return new GameMap(row.seed, undefined, resolveSavedMapGenVersion());
}

function findOpenHex(map: GameMap, avoid: Array<{ q: number; r: number }>, minDist = 4): { q: number; r: number } {
  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      if (!map.isPassable(q, r)) continue;
      if (map.riverAt(q, r)) continue;
      if (map.resourceTileAt(q, r)) continue;
      if (avoid.some((a) => hexDistance({ q, r }, a) < minDist)) continue;
      return { q, r };
    }
  }
  throw new Error("findOpenHex: no legal founding hex on this fixture map");
}

const SETTLERS_LOBBY = { gameMode: "settlers", mapGenVersion: resolveSavedMapGenVersion() };

test("FoundSettlement founds in place and turns the wagon into the town's first hero", async () => {
  const neutral = { q: 3, r: 3 };
  const row = makeRow([makeWagon(0, 0, 0), makeWagon(1, 0, 0)], [makeNeutral("n0", neutral.q, neutral.r)], {
    lobby: SETTLERS_LOBBY,
  });
  const map = mapFor(row);
  const target = findOpenHex(map, [neutral]);
  row.heroes[coveredWagonIdFor(0)] = makeWagon(0, target.q, target.r);
  row.heroes[coveredWagonIdFor(1)] = makeWagon(1, target.q, target.r);
  const { gameRepo, eventRepo, deps } = makeDeps(row);

  const command: Command = {
    kind: "FoundSettlement",
    gameName: "test-game",
    actor: 0,
    founderId: coveredWagonIdFor(0),
    q: target.q,
    r: target.r,
  };
  const result = await handleCommand(command, deps);

  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  const settlement = result.settlement;
  assert.ok(settlement, "the result carries the new settlement for the client's own reconcile");
  assert.equal(settlement.ownerId, 0);
  assert.equal(settlement.q, target.q);
  assert.equal(settlement.r, target.r);
  assert.deepEqual(settlement.warehouse, SETTLERS_MODE_DEFAULTS.wagonSupplies);
  assert.deepEqual(
    settlement.buildings,
    [],
    "no prebuilt buildings: the mode never hands a founded town a city",
  );

  // Persisted: the settlement is in the row, the wagon's id is RENAMED to the
  // seat's hero id (one entity, not a delete-plus-create), and the seat's
  // rosters moved with it.
  const persisted = gameRepo.rows["test-game"];
  assert.ok(persisted.settlements[settlement.id], "the settlement is persisted");
  const heroId = seatHeroIdFor(0);
  assert.equal(persisted.heroes[coveredWagonIdFor(0)], undefined, "the wagon's own id is gone");
  assert.ok(persisted.heroes[heroId], "the seat's hero id carries the wagon");
  assert.equal(persisted.heroes[heroId].ownerId, 0);
  assert.deepEqual(
    { q: persisted.heroes[heroId].q, r: persisted.heroes[heroId].r },
    { q: target.q, r: target.r },
    "the town's first hero stands where the wagon did",
  );
  assert.ok(persisted.heroes[coveredWagonIdFor(1)], "the other seat's wagon is untouched");
  const seat0 = (persisted.players ?? []).find((p) => p.id === 0);
  assert.deepEqual(seat0?.heroIds, [heroId], "the roster follows the rename");
  assert.deepEqual(seat0?.settlementIds, [settlement.id]);
  // The counter moves atomically with the settlement: hydrated as the
  // pre-existing settlement count (1 neutral here), +1 for the founding.
  assert.equal(persisted.next_settlement_id, 2, "the id counter moves atomically with the settlement");

  // One event, its own kind, stamped with the acting seat.
  assert.deepEqual(eventRepo.events.map((e) => e.kind), ["SettlementFounded"]);
  assert.equal(eventRepo.events[0].actorSeat, 0);
  const event = result.events[0];
  assert.equal(event.type, "SettlementFounded");
  assert.equal(
    event.type === "SettlementFounded" && event.consumedFounder,
    false,
    "the founder was not consumed: it became the town's first hero",
  );
  assert.equal(event.type === "SettlementFounded" && event.name, settlement.name);
});

test("FoundSettlement refuses a classic game, a foreign founder and an unknown one", async () => {
  const neutral = { q: 3, r: 3 };
  const classicRow = makeRow([makeWagon(0, 0, 0)], [makeNeutral("n0", neutral.q, neutral.r)], {
    lobby: { mapGenVersion: resolveSavedMapGenVersion() },
  });
  const map = mapFor(classicRow);
  const target = findOpenHex(map, [neutral]);
  classicRow.heroes[coveredWagonIdFor(0)] = makeWagon(0, target.q, target.r);
  const classic = makeDeps(classicRow);
  const command: Command = {
    kind: "FoundSettlement",
    gameName: "test-game",
    actor: 0,
    founderId: coveredWagonIdFor(0),
    q: target.q,
    r: target.r,
  };
  const classicResult = await handleCommand(command, classic.deps);
  assert.equal(classicResult.ok, false);
  assert.equal(classicResult.reason, "not_settlers_mode", "founding is the settlers path only");
  assert.deepEqual(classic.eventRepo.events, [], "a refused founding appends nothing");

  const settlersRow = makeRow([makeWagon(0, 0, 0), makeWagon(1, 0, 0)], [makeNeutral("n0", neutral.q, neutral.r)], {
    lobby: SETTLERS_LOBBY,
  });
  const settlersMap = mapFor(settlersRow);
  const settlersTarget = findOpenHex(settlersMap, [neutral]);
  settlersRow.heroes[coveredWagonIdFor(0)] = makeWagon(0, settlersTarget.q, settlersTarget.r);
  settlersRow.heroes[coveredWagonIdFor(1)] = makeWagon(1, 0, 0);
  const { deps } = makeDeps(settlersRow);

  const foreign = await handleCommand(
    { ...command, founderId: coveredWagonIdFor(1), q: 0, r: 0 },
    deps,
  );
  assert.equal(foreign.ok, false);
  assert.equal(foreign.reason, "forbidden_not_your_hero");

  const missing = await handleCommand({ ...command, founderId: "p9-wagon" }, deps);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "no_hero");
});

test("FoundSettlement relays the engine's spacing refusal inside a settlement's dead zone", async () => {
  const neutral = { q: 3, r: 3 };
  const row = makeRow([makeWagon(0, 0, 0)], [makeNeutral("n0", neutral.q, neutral.r)], {
    lobby: SETTLERS_LOBBY,
  });
  const map = mapFor(row);
  let tooClose: { q: number; r: number } | undefined;
  for (let r = 0; r < map.height && !tooClose; r++) {
    for (let q = 0; q < map.width && !tooClose; q++) {
      const d = hexDistance({ q, r }, neutral);
      if (
        d > 0 &&
        d < SETTLERS_MODE_DEFAULTS.minFoundingDistance &&
        map.isPassable(q, r) &&
        !map.riverAt(q, r) &&
        !map.resourceTileAt(q, r)
      ) {
        tooClose = { q, r };
      }
    }
  }
  assert.ok(tooClose, "the fixture map must have a hex inside the neutral's dead zone");
  row.heroes[coveredWagonIdFor(0)] = makeWagon(0, tooClose.q, tooClose.r);
  const { eventRepo, deps } = makeDeps(row);

  const result = await handleCommand(
    {
      kind: "FoundSettlement",
      gameName: "test-game",
      actor: 0,
      founderId: coveredWagonIdFor(0),
      q: tooClose.q,
      r: tooClose.r,
    },
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "too_close_to_settlement");
  assert.deepEqual(eventRepo.events, []);
});

test("FoundSettlement with no hex on the wire founds where the founder stands", async () => {
  const neutral = { q: 3, r: 3 };
  const row = makeRow([makeWagon(0, 0, 0), makeWagon(1, 0, 0)], [makeNeutral("n0", neutral.q, neutral.r)], {
    lobby: SETTLERS_LOBBY,
  });
  const map = mapFor(row);
  const target = findOpenHex(map, [neutral]);
  row.heroes[coveredWagonIdFor(0)] = makeWagon(0, target.q, target.r);
  const { gameRepo, deps } = makeDeps(row);

  // FOUNDING IS IN PLACE: no q, no r. The handler derives them from the
  // founder's own row, which is what lets the client's single toolbar gesture
  // work -- and the engine still requires the integers, so the derivation is
  // the only place a hex can come from.
  const result = await handleCommand(
    { kind: "FoundSettlement", gameName: "test-game", actor: 0, founderId: coveredWagonIdFor(0) },
    deps,
  );
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  const settlement = result.settlement;
  assert.ok(settlement);
  assert.deepEqual(
    { q: settlement.q, r: settlement.r },
    { q: target.q, r: target.r },
    "the town lands on the hex the founder stood on",
  );
  const persisted = gameRepo.rows["test-game"];
  assert.deepEqual(
    { q: persisted.heroes[seatHeroIdFor(0)].q, r: persisted.heroes[seatHeroIdFor(0)].r },
    { q: target.q, r: target.r },
  );
  assert.deepEqual(result.events[0].type === "SettlementFounded" && {
    q: result.events[0].q,
    r: result.events[0].r,
  }, { q: target.q, r: target.r }, "the event records the derived hex, not an absent one");
});

test("FoundSettlement refuses a recruited hero: only a covered wagon founds", async () => {
  const neutral = { q: 3, r: 3 };
  const row = makeRow([makeWagon(0, 0, 0)], [makeNeutral("n0", neutral.q, neutral.r)], {
    lobby: SETTLERS_LOBBY,
  });
  const map = mapFor(row);
  const target = findOpenHex(map, [neutral]);
  // A recruited hero of the same seat, standing on legal ground.
  row.heroes.h9 = makeWagon(0, target.q, target.r, { id: "h9", name: "Recruit" });
  const { gameRepo, eventRepo, deps } = makeDeps(row);

  const result = await handleCommand(
    { kind: "FoundSettlement", gameName: "test-game", actor: 0, founderId: "h9" },
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "founder_not_a_wagon", "the engine's wagon-only gate, relayed verbatim");
  assert.deepEqual(eventRepo.events, [], "a refused founding appends nothing");
  assert.deepEqual(
    Object.keys(gameRepo.rows["test-game"].settlements),
    ["n0"],
    "…and the board is untouched: no settlement was planted",
  );
});
