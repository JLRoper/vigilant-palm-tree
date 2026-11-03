// F7 (playthrough round 4): a caravan's whole journey -- the load at its
// origin, the seven-tile day, the delivery into the hero's larder and the turn
// for home -- used to leave the event log with nothing but the day's TurnEnded
// and audit rows, so the only way to learn where a wagon's cargo went was to
// read games.trade_routes directly. These tests drive the REAL server pipeline
// (handleCommand's EndTurn case over the daily advanceRound) and read the rows
// it appends.
//
// Run: npx tsx --test test/server/caravanJourneyEvents.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  CaravanState,
  Command,
  EngineEvent,
  HeroState,
  Player,
  SettlementState,
  TradeRouteState,
} from "@heroes/contracts";
import {
  GameMap,
  advanceTradeRoutes,
  createTradeRoute,
  findPath,
  hexDistance,
  hydrateGameState,
} from "@heroes/engine";
import { handleCommand } from "../../server/app/commandHandler";
import { caravanAdvances } from "../../server/app/turnService";
import { makeHero, makeSettlement } from "../charter/_helpers";
import {
  createMockCharterRepo,
  createMockEventRepo,
  createMockGameRepo,
  createMockHeroRepo,
  createMockSettlementRepo,
} from "../helpers/mockRepos";

// The map the server's EndTurn case rebuilds for seed 1 / map_size "small"
// (commandHandler's getOrCreateGameMap), so the fixture's tiles and the
// caravan's A* paths are over the same terrain the command will use.
const MAP = new GameMap(1, "small");

function passable(): Array<{ q: number; r: number }> {
  const tiles: Array<{ q: number; r: number }> = [];
  for (let r = 0; r < MAP.height; r++) {
    for (let q = 0; q < MAP.width; q++) {
      if (MAP.isPassable(q, r)) tiles.push({ q, r });
    }
  }
  return tiles;
}

// A settlement tile and a hero tile whose A* leg is a known number of steps,
// so a test can say which wrap the cart arrives on instead of hoping.
function pairWithLeg(steps: number): [{ q: number; r: number }, { q: number; r: number }] {
  for (const a of passable()) {
    for (const b of passable()) {
      if (hexDistance(a, b) !== steps) continue;
      if (findPath(MAP, a, b).length === steps) return [a, b];
    }
  }
  throw new Error(`fixture: no passable pair exactly ${steps} steps apart on this map`);
}

// 5 cargo wagons = the 250-unit larder the card measured (50/250).
function heroAt(at: { q: number; r: number }): HeroState {
  return makeHero("h0", 0, at.q, at.r, {
    wagons: 5,
    treasuryWagons: 5,
    troops: 0,
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
  });
}

// Zero population: no growth, no consumption and no garrison bill, so the only
// thing that can move the origin's store is the caravan itself.
function settlementAt(at: { q: number; r: number }, food: number): SettlementState {
  return makeSettlement("s0", 0, at.q, at.r, {
    population: 0,
    goldTax: 0,
    autoTrade: false,
    warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food },
  });
}

const PLAYERS: Player[] = [
  {
    id: 0,
    faction: "player",
    name: "Player 1",
    color: "#000000",
    heroIds: ["h0"],
    settlementIds: ["s0"],
    wagonsOwned: 1,
    wagonsUnassigned: 1,
  },
];

// The EndTurn command's own read/write cycle over one route: the row carries
// the route verbatim (the JSONB the server hydrates), so the command advances
// exactly the caravan a client created.
function seedRoute(
  origin: { q: number; r: number },
  hero: HeroState,
  originFood: number,
  payload: { kind: "resource"; resource: "food" } = { kind: "resource", resource: "food" },
): { row: Record<string, unknown>; route: TradeRouteState } {
  const heroRecord = hero;
  const settlement = settlementAt(origin, originFood);
  const seedRow = {
    name: "caravan-journey",
    seed: 1,
    map_size: "small",
    round: 1,
    day: 1,
    active_player_id: 0,
    players: PLAYERS,
    heroes: { h0: heroRecord },
    settlements: { s0: settlement },
    lobby: { legacyAutoTrade: false, claimed: {} },
  };
  const hydrated = hydrateGameState(seedRow as unknown as Parameters<typeof hydrateGameState>[0]);
  const created = createTradeRoute(
    hydrated,
    0,
    { kind: "settlement", id: "s0" },
    { kind: "hero", id: "h0" },
    payload,
    1,
  );
  assert.equal(created.ok, true, `fixture: route creation failed (${created.reason})`);
  const route = created.state.tradeRoutes?.[0];
  assert.ok(route, "fixture: the created route is in the state");
  return { row: { ...seedRow, trade_routes: [route] }, route };
}

interface Server {
  deps: Parameters<typeof handleCommand>[1];
  rows: () => Record<string, { trade_routes?: TradeRouteState[]; heroes: Record<string, HeroState>; settlements: Record<string, SettlementState> }>;
  events: Array<{ kind: string; actorSeat: number | null; payload: unknown }>;
}

function startServer(row: Record<string, unknown>): Server {
  const gameRepo = createMockGameRepo({ "caravan-journey": row as never });
  const eventRepo = createMockEventRepo();
  const heroRows = (row.heroes ?? {}) as Record<string, HeroState>;
  const settlementRows = (row.settlements ?? {}) as Record<string, SettlementState>;
  const deps = {
    gameRepo,
    eventRepo,
    heroRepo: createMockHeroRepo({ "caravan-journey": heroRows }),
    settlementRepo: createMockSettlementRepo({ "caravan-journey": settlementRows }),
    charterRepo: createMockCharterRepo(),
    ctx: { rng: () => 0.5, catalog: { unitTypes: [] } },
  } as unknown as Parameters<typeof handleCommand>[1];
  return {
    deps,
    rows: () => (gameRepo as unknown as { rows: Record<string, never> }).rows as never,
    events: eventRepo.events as unknown as Server["events"],
  };
}

interface Wrap {
  day: number;
  kinds: string[];
  advance: Extract<EngineEvent, { type: "CaravanAdvanced" }> | null;
  caravan: CaravanState | null;
  heroFood: number;
  originFood: number;
}

async function runWrap(server: Server): Promise<Wrap> {
  const before = server.events.length;
  const command: Command = { kind: "EndTurn", gameName: "caravan-journey", actor: 0, growthRate: 0.1 };
  const result = await handleCommand(command, server.deps);
  assert.equal(result.ok, true);
  const appended = server.events.slice(before);
  const row = server.rows()["caravan-journey"];
  return {
    day: result.day ?? 0,
    kinds: appended.map((e) => e.kind),
    advance: (appended.find((e) => e.kind === "CaravanAdvanced")?.payload ?? null) as Wrap["advance"],
    caravan: row.trade_routes?.[0]?.caravan ?? null,
    heroFood: row.heroes.h0.resources?.food ?? 0,
    originFood: row.settlements.s0.warehouse.food,
  };
}

test("each wrap of a caravan's journey appends one CaravanAdvanced row -- the load, the seven-tile day, the delivery and the turn for home", async () => {
  const [origin, heroTile] = pairWithLeg(8);
  const { row } = seedRoute(origin, heroAt(heroTile), 500);
  const server = startServer(row);

  // The card's own journey, wrap by wrap: a load, a seven-tile day, the
  // delivery with the turn for home in the same wrap, then the arrival home
  // (caravan null, reloading on a later wrap).
  const load = await runWrap(server);
  assert.deepEqual(
    load.kinds,
    ["CaravanAdvanced", "TurnEnded", "turn_ended", "round_ended", "round_started"],
    "the loading wrap must report itself before the boundary row",
  );
  assert.equal(load.advance?.loaded, 50, "the load's amount is the cargo it drew out of the origin");
  assert.equal(load.advance?.delivered, 0);
  assert.equal(load.advance?.caravan?.cargo, 50);
  assert.equal(load.advance?.caravan?.pathIndex, 0, "loading walks nothing that wrap");
  assert.equal(load.advance?.actor, 0, "the row is attributed to the route's owner");
  assert.equal(load.originFood, 450, "the origin really did give up 50 food in that wrap");
  assert.equal(
    server.events.filter((e) => e.kind === "CaravanAdvanced")[0].actorSeat,
    0,
    "actor_seat rides the row, so every other seat applies it and the owner's own client skips it",
  );

  const walk = await runWrap(server);
  assert.equal(
    walk.advance?.caravan?.pathIndex,
    7,
    "the seven-tile day is itself a reported wrap (pathIndex 0 -> 7), not silence between boundaries",
  );
  assert.equal(walk.advance?.loaded, 0);
  assert.equal(walk.advance?.delivered, 0);
  assert.equal(walk.heroFood, 0, "fixture: nothing has landed yet");

  const delivery = await runWrap(server);
  assert.equal(delivery.heroFood, 50, "the whole wagon load landed in the hero's larder that wrap");
  assert.equal(delivery.advance?.delivered, 50, "and the row says so");
  assert.equal(
    delivery.advance?.caravan?.phase,
    "toHome",
    "the same row carries the turn for home -- one row for one record mutation",
  );
  assert.equal(delivery.advance?.caravan?.cargo, 0);
  assert.equal(delivery.advance?.caravan?.anchored, true);
  assert.equal(delivery.advance?.loaded, 0);

  const home = await runWrap(server);
  assert.equal(home.advance?.caravan, null, "the arrival home is reported too: the cart unloaded and its record cleared");
  assert.equal(home.advance?.delivered, 0, "a homeward arrival is not a delivery");
  assert.equal(home.heroFood, 50, "and it does not touch the larder");

  // Exactly one row per moved wrap, and never two deliveries for one load.
  const rows = server.events.filter((e) => e.kind === "CaravanAdvanced");
  assert.equal(rows.length, 4, "four moved wraps, four rows -- no row for a wrap that moved nothing");
  assert.equal(
    rows.filter((e) => (e.payload as { delivered: number }).delivered > 0).length,
    1,
    "the delivery is reported once",
  );
});

test("a wrap that moves nothing appends no caravan row", async () => {
  const [origin, heroTile] = pairWithLeg(8);
  // An empty origin cannot load, so the cart never departs: the daily tick is
  // a real no-op and the log stays quiet.
  const { row } = seedRoute(origin, heroAt(heroTile), 0);
  const server = startServer(row);
  const wrap = await runWrap(server);
  assert.deepEqual(wrap.kinds, ["TurnEnded", "turn_ended", "round_ended", "round_started"]);
  assert.equal(wrap.caravan, null);
});

test("a homeward leg is never reported as a delivery, even when it reaches home in the same wrap", () => {
  // Origin and destination adjacent: the outbound leg is one step, so the
  // delivery wrap has six steps of movement left -- enough to turn around AND
  // walk home inside the same wrap. With the hero destination dead, that whole
  // wrap is `{toDestination, cargo 50}` -> null, which a naive cargo delta
  // would report as a 50-unit delivery to a hero that was never there.
  const [origin, heroTile] = pairWithLeg(1);
  const { row } = seedRoute(origin, heroAt(heroTile), 500);
  const hydrated = hydrateGameState(row as unknown as Parameters<typeof hydrateGameState>[0]);
  const loaded = advanceTradeRoutes(hydrated, MAP);
  assert.equal(loaded.tradeRoutes?.[0].caravan?.pathIndex, 0, "fixture: the first wrap loads and walks nothing");

  const deadHero: typeof loaded = {
    ...loaded,
    heroes: {},
    players: loaded.players.map((p) => ({ ...p, heroIds: [] })),
  };
  const arrived = advanceTradeRoutes(deadHero, MAP);

  const advances = caravanAdvances(deadHero, arrived);
  assert.equal(advances.length, 1, "the wrap moved the record, so it is reported");
  assert.equal(advances[0].caravan, null, "the cart is home and unloaded in that one wrap");
  assert.equal(
    advances[0].delivered,
    0,
    "the cargo came home with the cart -- a dead destination receives nothing",
  );
  assert.equal(advances[0].loaded, 0);
  assert.equal(
    arrived.settlements.s0.warehouse.food,
    500,
    "and the origin has its 50 food back, which is the proof the wrap was a return",
  );

  // Control: the same geometry with the hero alive delivers the load and says
  // so -- the discriminating pair is where the 50 food ENDED UP (the hero's
  // larder here, the origin's warehouse above), not the shape of the record.
  const delivered: typeof loaded = {
    ...loaded,
    heroes: { h0: { ...loaded.heroes.h0, resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 } } },
  };
  const afterDelivery = advanceTradeRoutes(delivered, MAP);
  const deliveryAdvances = caravanAdvances(delivered, afterDelivery);
  assert.equal(deliveryAdvances[0].delivered, 50, "a live hero's larder gets the whole load");
  assert.equal(afterDelivery.heroes.h0.resources?.food, 50);
  assert.equal(
    afterDelivery.settlements.s0.warehouse.food,
    450,
    "and the origin is 50 short -- the delivery, not a return",
  );
});
