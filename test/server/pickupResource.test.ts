import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  Command,
  HeroId,
  HeroState,
  Player,
  PlayerId,
  SettlementState,
  WarehouseResource,
} from "@heroes/contracts";
import type { HydratableGameRow } from "@heroes/engine";
import { getOrCreateGameMap, heroCargo, resolveSavedMapGenVersion, type ResourceTile } from "@heroes/engine";
import { handleCommand } from "../../server/app/commandHandler";
import {
  createMockCharterRepo,
  createMockEventRepo,
  createMockGameRepo,
  createMockHeroRepo,
  createMockSettlementRepo,
} from "../helpers/mockRepos";

// The pickup verb through the real command handler: the event it emits, the
// hero's cargo before and after, the tile's remaining amount before and after,
// and -- the part that makes it real state rather than a client-side trick --
// that the reduced amount is what the NEXT command hydrates, turn after turn.

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

const PLAYERS: Player[] = [
  { id: 0, faction: "player", name: "Player 1", color: "#000000", heroIds: ["h0", "h1"], settlementIds: [] },
  { id: 1, faction: "ai", name: "AI", color: "#111111", heroIds: [], settlementIds: [] },
];

/**
 * The map the handler itself will build for this row -- same seed, same size,
 * same SAVED map-gen version -- so the test's tile is the server's tile.
 */
function handlerMap(row: HydratableGameRow) {
  return getOrCreateGameMap(
    Number(row.seed) || 1,
    row.map_size as "small" | undefined,
    resolveSavedMapGenVersion((row as { lobby?: { mapGenVersion?: number } }).lobby?.mapGenVersion),
  );
}

/**
 * The first warehouse-resource deposit the handler's own map places. Gold is
 * skipped so the cargo assertions read heroCargo rather than the purse (the
 * gold cap has its own test in test/engine/resourcePickup.test.ts).
 */
function firstDeposit(row: HydratableGameRow): ResourceTile {
  const tiles = handlerMap(row).placedResourceTiles;
  const tile = tiles.find((t) => t.resource !== "gold") ?? tiles[0];
  assert.ok(tile, "the fixture seed places at least one resource tile");
  return tile;
}

function makeRow(heroes: HeroState[], overrides: Partial<HydratableGameRow> = {}): HydratableGameRow {
  return {
    name: "pickup-game",
    seed: 1234,
    round: 1,
    day: 1,
    active_player_id: 0,
    players: PLAYERS,
    heroes: Object.fromEntries(heroes.map((h) => [h.id, h])),
    settlements: {} as Record<string, SettlementState>,
    map_size: "small",
    ...overrides,
  };
}

function makeDeps(row: HydratableGameRow) {
  const gameRepo = createMockGameRepo({ [row.name as string]: row });
  const eventRepo = createMockEventRepo();
  const heroRepo = createMockHeroRepo({ [row.name as string]: row.heroes });
  const settlementRepo = createMockSettlementRepo();
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
      ctx: { rng: () => 0.5, catalog: { unitTypes: [] } },
    },
  };
}

function pickupCommand(heroId: string, q: number, r: number): Command {
  return { kind: "PickupResource", gameName: "pickup-game", actor: 0, heroId, q, r };
}

test("PickupResource: the event, the cargo and the tile's remaining amount, quoted", async () => {
  const row = makeRow([makeHero("h0", 0, 0, 0, { wagons: 2 })]);
  const tile = firstDeposit(row);
  // Stand the hero on the deposit (the fixture's position is irrelevant to the
  // command -- the engine reads the hero's own row).
  row.heroes.h0 = { ...row.heroes.h0, q: tile.q, r: tile.r };
  const { deps, eventRepo, gameRepo } = makeDeps(row);
  const map = handlerMap(row);
  const hero = row.heroes.h0;
  const pristine = tile.amount;
  const room = 2 * 50;

  console.log(
    `[command] tile (${tile.q},${tile.r}) ${tile.resource} pristine=${pristine} hero wagons=2 room=${room}`,
  );
  console.log(`[command] before: cargo=${JSON.stringify(heroCargo(hero))} remaining-on-tile=${pristine}`);

  const result = await handleCommand(pickupCommand("h0", tile.q, tile.r), deps);
  assert.equal(result.ok, true);
  assert.equal(result.reason, undefined);

  console.log(`[command] event =\n${JSON.stringify(eventRepo.events[0].payload, null, 2)}`);
  console.log(
    `[command] after: cargo=${JSON.stringify(heroCargo(result.hero as HeroState))} remaining-on-tile=${result.resourceDeposits?.[`${tile.q},${tile.r}`]}`,
  );

  assert.equal(eventRepo.events.length, 1);
  assert.equal(eventRepo.events[0].kind, "ResourcePickedUp");
  const expectedTaken = Math.min(pristine, room);
  assert.deepEqual(eventRepo.events[0].payload, {
    type: "ResourcePickedUp",
    actor: 0,
    heroId: "h0",
    q: tile.q,
    r: tile.r,
    resource: tile.resource,
    amount: expectedTaken,
    remaining: pristine - expectedTaken,
  });
  assert.equal(result.lastEventId, 1);

  // The hero's cargo before -> after, and the tile's remaining amount.
  assert.equal(heroCargo(hero)[tile.resource as WarehouseResource], 0, "the fixture hold started empty");
  assert.equal(
    heroCargo(result.hero as HeroState)[tile.resource as WarehouseResource],
    expectedTaken,
    "what fitted went into the hero's cargo",
  );
  assert.equal(result.resourceDeposits?.[`${tile.q},${tile.r}`], pristine - expectedTaken);

  // Persisted: the mock row carries the remaining amount, and a SECOND command
  // (a different hero, whose own room is fresh) reads exactly that number --
  // the reload-and-carry-on path, end to end.
  assert.deepEqual(gameRepo.rows["pickup-game"].resource_deposits, {
    [`${tile.q},${tile.r}`]: pristine - expectedTaken,
  });
  const secondRow = { ...gameRepo.rows["pickup-game"], heroes: { ...gameRepo.rows["pickup-game"].heroes, h1: makeHero("h1", 0, tile.q, tile.r, { wagons: 5 }) } } as HydratableGameRow;
  const second = await handleCommand(pickupCommand("h1", tile.q, tile.r), makeDeps(secondRow).deps);
  assert.equal(second.ok, true);
  const leftAfterFirst = pristine - expectedTaken;
  const secondTake = pristine - room; // the second hero has 5 wagons (250 cap)
  assert.equal(
    heroCargo(second.hero as HeroState)[tile.resource as WarehouseResource],
    secondTake,
    "the second hero took what the FIRST pickup left, not a fresh tile's amount",
  );
  assert.equal(second.resourceDeposits?.[`${tile.q},${tile.r}`], leftAfterFirst - secondTake);
  assert.equal(
    heroCargo(second.hero as HeroState)[tile.resource as WarehouseResource] +
      (second.resourceDeposits?.[`${tile.q},${tile.r}`] ?? 0) +
      expectedTaken,
    pristine,
    "both takes plus what is still on the floor add back up to the pristine amount",
  );

  // The map the handler used is untouched: the tile still reports its pristine
  // amount, and the remaining amount only ever lived in the game state -- so a
  // second game on the same seed starts from the same world.
  assert.equal(map.resourceTileAt(tile.q, tile.r)?.amount, pristine);
  assert.deepEqual(handlerMap(row).resourceTileAt(tile.q, tile.r), tile);
});

test("PickupResource refuses a hero with no room and writes nothing at all", async () => {
  const row = makeRow([makeHero("h0", 0, 0, 0, { wagons: 0 })]);
  const tile = firstDeposit(row);
  row.heroes.h0 = { ...row.heroes.h0, q: tile.q, r: tile.r };
  const { deps, eventRepo, gameRepo, heroRepo } = makeDeps(row);

  const result = await handleCommand(pickupCommand("h0", tile.q, tile.r), deps);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "not_enough_cargo_space");
  assert.deepEqual(result.events, []);
  assert.equal(eventRepo.events.length, 0, "no event for a refusal");
  assert.equal(gameRepo.rows["pickup-game"].resource_deposits, undefined, "the row was not written");
  assert.equal(heroRepo.calls.length, 0, "no dual-write for a refusal");
});

test("PickupResource rejects a hero off the tile, another seat's hero, and a bare hex", async () => {
  const row = makeRow([makeHero("h0", 0, 0, 0, { wagons: 5 }), makeHero("h9", 1, 0, 0, { wagons: 5 })]);
  const tile = firstDeposit(row);
  row.heroes.h0 = { ...row.heroes.h0, q: tile.q + 1, r: tile.r };
  const { deps, eventRepo } = makeDeps(row);

  const offTile = await handleCommand(pickupCommand("h0", tile.q, tile.r), deps);
  assert.equal(offTile.ok, false);
  assert.equal(offTile.reason, "not_on_resource_tile");

  const notMine = await handleCommand(pickupCommand("h9", tile.q, tile.r), deps);
  assert.equal(notMine.ok, false);
  assert.equal(notMine.reason, "forbidden_not_your_hero");

  const missing = await handleCommand(pickupCommand("nope", tile.q, tile.r), deps);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "no_hero");

  assert.equal(eventRepo.events.length, 0, "a refusal appends nothing, ever");
});

test("PickupResource is refused outside the actor's turn (the shared guard)", async () => {
  const row = makeRow([makeHero("h0", 0, 0, 0, { wagons: 5 })]);
  const tile = firstDeposit(row);
  row.heroes.h0 = { ...row.heroes.h0, q: tile.q, r: tile.r };
  const { deps, eventRepo } = makeDeps(row);
  const result = await handleCommand(
    { kind: "PickupResource", gameName: "pickup-game", actor: 1, heroId: "h0", q: tile.q, r: tile.r },
    deps,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "forbidden_not_your_turn");
  assert.equal(eventRepo.events.length, 0);
});
