import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advanceTradeRoutes,
  assignWagons,
  buyWagons,
  CARAVAN_CATCHUP_REPATHS_PER_DAY,
  createTradeRoute,
  findPath,
  GameMap,
  hexDistance,
  heroGoldCap,
  hydrateGameState,
  normalizeTradeRoute,
  transferCargoLoot,
  transferResources,
  updateTradeRoute,
  type GameState,
} from "@heroes/engine";
import type { TradeRouteEndpoint, TradeRoutePayload } from "@heroes/contracts";
import { emptyWarehouse, makeHero, makePlayer, makeSettlement, makeState, makeTradeRoute } from "../charter/_helpers";

const settlementEndpoint = (id: string): TradeRouteEndpoint => ({ kind: "settlement", id });
const heroEndpoint = (id: string): TradeRouteEndpoint => ({ kind: "hero", id });
const WOOD: TradeRoutePayload = { kind: "resource", resource: "wood" };
const GOLD: TradeRoutePayload = { kind: "gold" };

function logisticsState(): GameState {
  const hero = {
    ...makeHero("h0", 0, 2, 2),
    wagons: 5,
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
  };
  const origin = makeSettlement("s0", 0, 2, 2, {
    gold: 1000,
    warehouse: { wood: 100, stone: 100, iron: 100, arcane: 100, food: 100 },
  });
  const dest = makeSettlement("s1", 0, 8, 2, {
    warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
  });
  const state = makeState({ heroes: [hero], settlements: [origin, dest], activePlayerId: 0 });
  state.players = state.players.map((p) =>
    p.id === 0
      ? { ...p, wagonsOwned: 8, wagonsUnassigned: 8, treasuryWagonsOwned: 6, treasuryWagonsUnassigned: 6 }
      : p,
  );
  return state;
}

function firstPassablePair(map: GameMap): Array<{ q: number; r: number }> {
  const out: Array<{ q: number; r: number }> = [];
  for (let r = 0; r < map.height && out.length < 2; r++) {
    for (let q = 0; q < map.width && out.length < 2; q++) {
      if (map.isPassable(q, r)) out.push({ q, r });
    }
  }
  return out;
}

// A passable pair far enough apart (>= minDist) that a caravan departing the
// origin is still mid-path after its first 4-tile daily wrap -- the fixture
// shape every catch-up/hero-death test needs, since an adjacent pair loads,
// walks, and delivers within a single advance call.
function reachableDistantPair(map: GameMap, minDist = 5): Array<{ q: number; r: number }> {
  const passable: Array<{ q: number; r: number }> = [];
  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      if (map.isPassable(q, r)) passable.push({ q, r });
    }
  }
  for (const a of passable) {
    for (const b of passable) {
      if (hexDistance(a, b) >= minDist && findPath(map, a, b).length > 0) return [a, b];
    }
  }
  throw new Error(`no reachable passable pair at distance >= ${minDist} on this map`);
}

function grantWagons(state: GameState, unassigned: number): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === 0 ? { ...p, wagonsOwned: unassigned, wagonsUnassigned: unassigned } : p,
    ),
  };
}

test("transferResources: load with an empty wagon moves nothing", () => {
  const state = logisticsState();
  const result = transferResources(state, 0, "h0", "s0", "load", { wood: 1000 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "nothing_transferred");
});

test("transferResources: unload pulls settlement stock into hero cargo up to the wagon cap", () => {
  const state = logisticsState();
  const result = transferResources(state, 0, "h0", "s0", "unload", { wood: 1000, food: 25 });
  assert.equal(result.ok, true);
  const hero = result.state.heroes.h0;
  assert.equal(hero.resources?.wood, 100, "5 wagons cap 250, but only 100 wood exists in stock");
  assert.equal(hero.resources?.food, 25);
  assert.equal(result.state.settlements.s0.warehouse.wood, 0);
  assert.equal(result.state.settlements.s0.warehouse.food, 75);
});

test("transferResources rejects wrong owner and distant settlements", () => {
  const state = logisticsState();
  assert.equal(transferResources(state, 1, "h0", "s0", "unload", { wood: 5 }).reason, "forbidden_not_your_hero");
  assert.equal(
    transferResources(state, 0, "h0", "s1", "unload", { wood: 5 }).reason,
    "hero_not_at_settlement",
    "s1 is a different tile",
  );
});

test("assignWagons moves wagons between the pool and a hero, respecting the invariant", () => {
  const state = logisticsState();
  // No slot argument = cargo (the pre-split behavior, byte-for-byte).
  const assign = assignWagons(state, 0, "h0", 3);
  assert.equal(assign.ok, true);
  assert.equal(assign.state.heroes.h0.wagons, 8);
  assert.equal(assign.state.players[0].wagonsUnassigned, 5);
  assert.equal(assign.state.heroes.h0.treasuryWagons, 5, "the cargo assign never touches the treasury slot");
  assert.equal(assign.state.players[0].treasuryWagonsUnassigned, 6, "or the treasury pool");

  const back = assignWagons(assign.state, 0, "h0", -10);
  assert.equal(back.ok, true);
  assert.equal(back.state.heroes.h0.wagons, 0, "delta clamps to the hero's actual wagons");
  assert.equal(back.state.players[0].wagonsUnassigned, 13);

  const empty = assignWagons(back.state, 0, "h0", -1);
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, "not_enough_wagons");
});

test("assignWagons with slot 'treasury' moves carts between the treasury pool and the hero's treasury slot, same invariant", () => {
  const state = logisticsState();
  const assign = assignWagons(state, 0, "h0", 4, "treasury");
  assert.equal(assign.ok, true);
  assert.equal(assign.state.heroes.h0.treasuryWagons, 9, "carts assign onto the treasury slot");
  assert.equal(assign.state.players[0].treasuryWagonsUnassigned, 2);
  assert.equal(assign.state.players[0].treasuryWagonsOwned, 6, "owned is carried through unchanged, as the cargo slot does");
  assert.equal(assign.state.heroes.h0.wagons, 5, "the treasury assign never touches the cargo slot");
  assert.equal(assign.state.players[0].wagonsUnassigned, 8, "or the cargo pool");

  const partial = assignWagons(assign.state, 0, "h0", 5, "treasury");
  assert.equal(partial.ok, true);
  assert.equal(partial.state.heroes.h0.treasuryWagons, 11, "a positive delta clamps to the pool's actual contents");
  assert.equal(partial.state.players[0].treasuryWagonsUnassigned, 0);

  const back = assignWagons(partial.state, 0, "h0", -20, "treasury");
  assert.equal(back.ok, true);
  assert.equal(back.state.heroes.h0.treasuryWagons, 0, "a negative delta clamps to the hero's actual carts");
  assert.equal(back.state.players[0].treasuryWagonsUnassigned, 11);

  const empty = assignWagons(back.state, 0, "h0", -1, "treasury");
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, "not_enough_wagons");

  // The pool-drained check must run on partial.state: `back` above RETURNED
  // the hero's 11 carts to the pool, so a +1 from back.state is legal. On
  // partial.state the treasury pool is genuinely at 0.
  const drainedPool = assignWagons(partial.state, 0, "h0", 1, "treasury");
  assert.equal(drainedPool.ok, false);
  assert.equal(drainedPool.reason, "not_enough_wagons_unassigned");
});

test("assignWagons on a pre-028 hero (absent treasuryWagons) seeds the slot from the 5-cart default, never from 0", () => {
  const state = logisticsState();
  const legacy = { ...state.heroes.h0 };
  delete legacy.treasuryWagons;
  const seeded: GameState = { ...state, heroes: { ...state.heroes, h0: legacy } };
  assert.equal(heroGoldCap(seeded.heroes.h0), 2500, "fixture: the absent field soft-defaults to a 2,500g purse cap");

  const up = assignWagons(seeded, 0, "h0", 1, "treasury");
  assert.equal(up.ok, true);
  assert.equal(
    up.state.heroes.h0.treasuryWagons,
    6,
    "5 (soft default) + 1 — the materialized count can never sit below the default, so the purse cap cannot shrink",
  );
  assert.equal(heroGoldCap(up.state.heroes.h0), 3000);

  const down = assignWagons(seeded, 0, "h0", -1, "treasury");
  assert.equal(down.ok, true, "the absent field soft-defaults to 5 carts, so -1 is a legal move");
  assert.equal(down.state.heroes.h0.treasuryWagons, 4);

  const drained = assignWagons(down.state, 0, "h0", -10, "treasury");
  assert.equal(drained.ok, true);
  assert.equal(drained.state.heroes.h0.treasuryWagons, 0, "the negative delta clamps against the real 4 carts, not 0");
});

test("buyWagons deducts 200g + 5 wood each and grows the pool", () => {
  const state = logisticsState();
  const result = buyWagons(state, 0, "s0", 2);
  assert.equal(result.ok, true);
  assert.equal(result.state.settlements.s0.gold, 1000 - 400);
  assert.equal(result.state.settlements.s0.warehouse.wood, 100 - 10);
  const player = result.state.players[0];
  assert.equal(player.wagonsOwned, 10);
  assert.equal(player.wagonsUnassigned, 10);
  assert.equal(player.treasuryWagonsOwned, 6, "a cargo buy never touches the treasury pool");
  assert.equal(player.treasuryWagonsUnassigned, 6);

  const broke = buyWagons({ ...result.state, settlements: { ...result.state.settlements, s0: { ...result.state.settlements.s0, gold: 10 } } }, 0, "s0", 1);
  assert.equal(broke.ok, false);
  assert.equal(broke.reason, "not_enough_gold");
});

test("buyWagons with slot 'treasury' costs the same 200g + 5 wood and grows ONLY the treasury pool", () => {
  const state = logisticsState();
  const result = buyWagons(state, 0, "s0", 2, "treasury");
  assert.equal(result.ok, true);
  assert.equal(result.state.settlements.s0.gold, 1000 - 400, "same cost as a cargo wagon");
  assert.equal(result.state.settlements.s0.warehouse.wood, 100 - 10);
  const player = result.state.players[0];
  assert.equal(player.treasuryWagonsOwned, 8);
  assert.equal(player.treasuryWagonsUnassigned, 8);
  assert.equal(player.wagonsOwned, 8, "the treasury buy never touches the cargo pool");
  assert.equal(player.wagonsUnassigned, 8);

  const broke = buyWagons({ ...result.state, settlements: { ...result.state.settlements, s0: { ...result.state.settlements.s0, gold: 10 } } }, 0, "s0", 1, "treasury");
  assert.equal(broke.ok, false);
  assert.equal(broke.reason, "not_enough_gold");
});

test("createTradeRoute locks wagons; update reallocates; remove releases them", () => {
  const state = logisticsState();
  const created = createTradeRoute(state, 0, settlementEndpoint("s0"), settlementEndpoint("s1"), WOOD, 3);
  assert.equal(created.ok, true);
  const route = created.route!;
  assert.equal(route.wagons, 3);
  assert.equal(created.state.players[0].wagonsUnassigned, 5, "3 of 8 locked into the route");

  const overCommit = createTradeRoute(created.state, 0, settlementEndpoint("s0"), settlementEndpoint("s1"), { kind: "resource", resource: "stone" }, 6);
  assert.equal(overCommit.ok, false, "only 5 unassigned wagons remain");

  const grown = updateTradeRoute(created.state, 0, route.id, { wagonsDelta: 5 });
  assert.equal(grown.ok, true);
  assert.equal(grown.state.tradeRoutes[0].wagons, 8);
  assert.equal(grown.state.players[0].wagonsUnassigned, 0);

  const overGrow = updateTradeRoute(grown.state, 0, route.id, { wagonsDelta: 1 });
  assert.equal(overGrow.reason, "not_enough_wagons_unassigned");

  const removed = updateTradeRoute(grown.state, 0, route.id, { remove: true });
  assert.equal(removed.ok, true);
  assert.equal(removed.state.tradeRoutes.length, 0);
  assert.equal(removed.state.players[0].wagonsUnassigned, 8, "all wagons released");

  // A resource change on a treasure route re-targets the payload to a cargo
  // route for that resource (endpoints stay immutable on update).
  const treasure = createTradeRoute(removed.state, 0, settlementEndpoint("s0"), settlementEndpoint("s1"), GOLD, 2);
  assert.equal(treasure.ok, true);
  assert.deepEqual(treasure.route!.payload, { kind: "gold" });
  const flipped = updateTradeRoute(treasure.state, 0, treasure.route!.id, { resource: "iron" });
  assert.equal(flipped.ok, true);
  assert.deepEqual(flipped.state.tradeRoutes[0].payload, { kind: "resource", resource: "iron" });
  assert.deepEqual(flipped.state.tradeRoutes[0].from, { kind: "settlement", id: "s0" }, "endpoints are immutable on update");
});

test("advanceTradeRoutes: caravan loads, walks, delivers at the destination, and cycles home", () => {
  const map = new GameMap(7, "small");
  const [a, b] = firstPassablePair(map);
  const hero = {
    ...makeHero("h0", 0, a.q, a.r),
    wagons: 4,
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
  };
  const origin = makeSettlement("s0", 0, a.q, a.r, {
    warehouse: { wood: 200, stone: 0, iron: 0, arcane: 0, food: 0 },
  });
  const dest = makeSettlement("s1", 0, b.q, b.r, {
    warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
  });
  const state = makeState({ heroes: [hero], settlements: [origin, dest], activePlayerId: 0 });
  state.players = state.players.map((p) => (p.id === 0 ? { ...p, wagonsOwned: 4, wagonsUnassigned: 4 } : p));
  const created = createTradeRoute(state, 0, settlementEndpoint("s0"), settlementEndpoint("s1"), WOOD, 4);
  assert.equal(created.ok, true);

  // Wrap 1: caravan loads 200 (4 wagons × 50) and starts walking.
  const departed = advanceTradeRoutes(created.state, map);
  const enRoute = departed.tradeRoutes![0].caravan!;
  assert.equal(enRoute.cargo, 200);
  assert.equal(enRoute.phase, "toDestination");
  assert.equal(departed.settlements.s0.warehouse.wood, 0);
  const totalPath = enRoute.path.length + enRoute.pathIndex;

  // Walk to the destination.
  let current = departed;
  for (let i = 0; i < totalPath; i++) {
    current = advanceTradeRoutes(current, map);
  }
  const arrived = current.tradeRoutes![0].caravan!;
  if (arrived.phase === "toDestination") {
    // Destination is level-1 (cap 500, headroom 500) — the full 200 lands.
    assert.equal(arrived.cargo, 0, "cargo fully delivered");
    assert.equal(current.settlements.s1.warehouse.wood, 200);
    // Next wrap flips it homeward.
    const homeward = advanceTradeRoutes(current, map);
    assert.equal(homeward.tradeRoutes![0].caravan?.phase, "toHome");
  } else {
    // Path was short enough to arrive and flip home in one wrap.
    assert.equal(arrived.phase, "toHome");
    assert.equal(current.settlements.s1.warehouse.wood, 200);
  }
});

test("advanceTradeRoutes: a full destination warehouse makes the caravan hold its cargo", () => {
  const map = new GameMap(11, "small");
  const [a, b] = firstPassablePair(map);
  const hero = {
    ...makeHero("h0", 0, a.q, a.r),
    wagons: 4,
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
  };
  const origin = makeSettlement("s0", 0, a.q, a.r, {
    warehouse: { wood: 200, stone: 0, iron: 0, arcane: 0, food: 0 },
  });
  // Level-3 destination stuffed to its base cap: no headroom at all.
  const dest = makeSettlement("s1", 0, b.q, b.r, {
    level: 3 as 1 | 2 | 3,
    warehouse: { wood: 4000, stone: 0, iron: 0, arcane: 0, food: 0 },
  });
  const state = makeState({ heroes: [hero], settlements: [origin, dest], activePlayerId: 0 });
  state.players = state.players.map((p) => (p.id === 0 ? { ...p, wagonsOwned: 4, wagonsUnassigned: 4 } : p));
  const created = createTradeRoute(state, 0, settlementEndpoint("s0"), settlementEndpoint("s1"), WOOD, 4);
  const departed = advanceTradeRoutes(created.state, map);
  let current = departed;
  for (let i = 0; i < 40; i++) {
    current = advanceTradeRoutes(current, map);
  }
  const caravan = current.tradeRoutes![0].caravan!;
  if (caravan.phase === "toDestination" && caravan.pathIndex >= caravan.path.length) {
    assert.equal(caravan.cargo, 200, "cargo held, nothing lost to a full warehouse");
    assert.equal(current.settlements.s1.warehouse.wood, 4000);
    assert.ok(current.settlements.s0.warehouse.wood <= 200);
  } else if (caravan.phase === "toHome") {
    assert.ok(caravan.cargo === 0, "delivered exactly when headroom existed");
  }
  // Either way, no cargo was ever destroyed.
  const totalWood =
    (current.settlements.s0.warehouse.wood ?? 0) +
    (current.settlements.s1.warehouse.wood ?? 0) +
    caravan.cargo +
    (current.heroes.h0.resources?.wood ?? 0);
  assert.ok(totalWood >= 200);
});

// ---- Hero endpoints + treasure caravans (the endpoints/payload model) ------

test("createTradeRoute accepts hero endpoints in both directions and rejects foreign, missing, or identical endpoints", () => {
  const state = grantWagons(
    makeState({
      players: [makePlayer(0, "player", ["h0"], ["s0"]), makePlayer(1, "ai", ["h9"], [])],
      heroes: [makeHero("h0", 0, 2, 2), makeHero("h9", 1, 8, 8)],
      settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 0, 8, 2), makeSettlement("s8", 1, 10, 10)],
      activePlayerId: 0,
    }),
    8,
  );

  const toHero = createTradeRoute(state, 0, settlementEndpoint("s1"), heroEndpoint("h0"), WOOD, 2);
  assert.equal(toHero.ok, true, toHero.reason);
  assert.deepEqual(toHero.route!.to, { kind: "hero", id: "h0" });
  assert.deepEqual(toHero.route!.payload, { kind: "resource", resource: "wood" });

  const fromHero = createTradeRoute(toHero.state, 0, heroEndpoint("h0"), settlementEndpoint("s1"), GOLD, 2);
  assert.equal(fromHero.ok, true, fromHero.reason);
  assert.deepEqual(fromHero.route!.from, { kind: "hero", id: "h0" });
  assert.deepEqual(fromHero.route!.payload, { kind: "gold" });

  // Same-owner rule: every endpoint must exist and resolve to the actor.
  assert.equal(createTradeRoute(state, 0, heroEndpoint("h9"), settlementEndpoint("s0"), GOLD, 1).reason, "forbidden_not_your_hero", "a foreign hero endpoint is rejected at creation");
  assert.equal(createTradeRoute(state, 0, settlementEndpoint("s0"), heroEndpoint("h9"), GOLD, 1).reason, "forbidden_not_your_hero");
  assert.equal(createTradeRoute(state, 0, heroEndpoint("h0"), heroEndpoint("h9"), GOLD, 1).reason, "forbidden_not_your_hero");
  assert.equal(createTradeRoute(state, 0, settlementEndpoint("s0"), settlementEndpoint("s8"), GOLD, 1).reason, "forbidden_not_your_settlement", "a foreign settlement endpoint is rejected at creation");
  assert.equal(createTradeRoute(state, 0, heroEndpoint("ghost"), settlementEndpoint("s0"), GOLD, 1).reason, "forbidden_not_your_hero", "a dead hero endpoint resolves to no owner");

  assert.equal(createTradeRoute(state, 0, settlementEndpoint("s0"), settlementEndpoint("s0"), GOLD, 1).reason, "same_endpoint");
  assert.equal(createTradeRoute(state, 0, heroEndpoint("h0"), heroEndpoint("h0"), GOLD, 1).reason, "same_endpoint");
});

test("a treasure caravan loads wagons x 500 from the origin treasury and delivers clamped by destination treasury headroom", () => {
  const map = new GameMap(13, "small");
  const [a, b] = firstPassablePair(map);
  const origin = makeSettlement("s0", 0, a.q, a.r, { gold: 3000 });
  // Level-1 treasury cap is 1500 (BASE_TREASURY): 1400 existing leaves 100 headroom.
  const dest = makeSettlement("s1", 0, b.q, b.r, { gold: 1400 });
  const state = grantWagons(makeState({ settlements: [origin, dest], activePlayerId: 0 }), 2);
  const created = createTradeRoute(state, 0, settlementEndpoint("s0"), settlementEndpoint("s1"), GOLD, 2);
  assert.equal(created.ok, true, created.reason);

  const departed = advanceTradeRoutes(created.state, map);
  const enRoute = departed.tradeRoutes![0].caravan!;
  assert.equal(enRoute.cargo, 1000, "2 wagons x WAGON_GOLD_CAPACITY (500) from the treasury");
  assert.equal(departed.settlements.s0.gold, 2000, "the load is deducted from the origin treasury");

  let current = departed;
  for (let i = 0; i < 20; i++) current = advanceTradeRoutes(current, map);
  assert.equal(current.settlements.s1.gold, 1500, "delivery clamps at the L1 treasury cap (100 headroom)");
  const parked = current.tradeRoutes![0].caravan!;
  assert.equal(parked.cargo, 900, "the remainder stays aboard (never lose cargo)");
  assert.equal(parked.phase, "toDestination", "a partial delivery parks at the destination to retry daily");
});

test("a treasure caravan delivering to a hero with 0 treasury carts delivers 0 gold and keeps its cargo", () => {
  const map = new GameMap(17, "small");
  const [a, b] = firstPassablePair(map);
  const dest = { ...makeHero("h0", 0, b.q, b.r), treasuryWagons: 0, resources: emptyWarehouse() };
  const origin = makeSettlement("s0", 0, a.q, a.r, { gold: 2500 });
  const state = grantWagons(makeState({ heroes: [dest], settlements: [origin], activePlayerId: 0 }), 1);
  const created = createTradeRoute(state, 0, settlementEndpoint("s0"), heroEndpoint("h0"), GOLD, 1);
  assert.equal(created.ok, true, created.reason);

  const departed = advanceTradeRoutes(created.state, map);
  assert.equal(departed.tradeRoutes![0].caravan!.cargo, 500, "1 wagon x 500 loaded from the treasury");

  let current = departed;
  for (let i = 0; i < 20; i++) current = advanceTradeRoutes(current, map);
  assert.equal(current.heroes.h0.gold, 0, "0 treasury carts -> 0g purse cap -> 0 gold delivered");
  const caravan = current.tradeRoutes![0].caravan!;
  assert.equal(caravan.cargo, 500, "the cargo rides intact (never lose cargo)");
  assert.equal(caravan.phase, "toDestination", "the caravan parks beside the hero and retries daily");
});

test("a cargo caravan delivering to a hero pays into the hero's wagon cargo, cap-clamped", () => {
  const map = new GameMap(23, "small");
  const [a, b] = firstPassablePair(map);
  const dest = { ...makeHero("h0", 0, b.q, b.r), wagons: 2, resources: emptyWarehouse() };
  const origin = makeSettlement("s0", 0, a.q, a.r, { warehouse: emptyWarehouse({ wood: 300 }) });
  const state = grantWagons(makeState({ heroes: [dest], settlements: [origin], activePlayerId: 0 }), 2);
  const created = createTradeRoute(state, 0, settlementEndpoint("s0"), heroEndpoint("h0"), WOOD, 2);
  assert.equal(created.ok, true, created.reason);

  const departed = advanceTradeRoutes(created.state, map);
  assert.equal(departed.tradeRoutes![0].caravan!.cargo, 100, "2 wagons x 50");
  assert.equal(departed.settlements.s0.warehouse.wood, 200);

  // The depart wrap only loads; the next wrap walks the adjacent tile and
  // delivers, capped by the hero's 2x50 wagon cargo.
  let current = departed;
  for (let i = 0; i < 20 && current.heroes.h0.resources?.wood !== 100; i++) {
    current = advanceTradeRoutes(current, map);
  }
  assert.equal(current.heroes.h0.resources?.wood, 100, "delivered into the hero's wagon cargo (cap 2x50=100)");
  assert.equal(current.settlements.s0.warehouse.wood, 200, "no double-counting at the origin");
  assert.equal(current.tradeRoutes![0].caravan!.phase, "toHome", "a full delivery flips the caravan homeward");
});

test("a hero origin loads gold from its purse and a settlement destination takes it into its treasury", () => {
  const map = new GameMap(29, "small");
  const [a, b] = firstPassablePair(map);
  const source = { ...makeHero("h0", 0, a.q, a.r), gold: 2000 };
  const dest = makeSettlement("s0", 0, b.q, b.r, { gold: 0 });
  const state = grantWagons(makeState({ heroes: [source], settlements: [dest], activePlayerId: 0 }), 2);
  const created = createTradeRoute(state, 0, heroEndpoint("h0"), settlementEndpoint("s0"), GOLD, 2);
  assert.equal(created.ok, true, created.reason);

  const departed = advanceTradeRoutes(created.state, map);
  assert.equal(departed.heroes.h0.gold, 1000, "the load comes out of the hero's purse");
  assert.equal(departed.tradeRoutes![0].caravan!.cargo, 1000);
  assert.equal(departed.settlements.s0.gold, 0, "the depart wrap only loads -- delivery starts next wrap");

  let current = departed;
  for (let i = 0; i < 20; i++) current = advanceTradeRoutes(current, map);
  // The route keeps cycling hero -> settlement; gold is conserved across
  // every load, delivery, and park, and delivery always clamps at the cap.
  const total = current.heroes.h0.gold + current.settlements.s0.gold + (current.tradeRoutes![0].caravan?.cargo ?? 0);
  assert.equal(total, 2000, "gold is conserved across the whole cycle (never lose cargo)");
  assert.ok(current.settlements.s0.gold >= 1000, "the first full delivery landed");
  assert.ok(current.settlements.s0.gold <= 1500, "the treasury never exceeds its cap");
});

// ---- Hero catch-up (the moving-target rule) ---------------------------------

test("catch-up: a hero endpoint that moves off the caravan's path is re-pathed to and delivered", () => {
  const map = new GameMap(31, "small");
  const [a, b] = reachableDistantPair(map);
  const mover = { ...makeHero("h0", 0, b.q, b.r), resources: emptyWarehouse() };
  const origin = makeSettlement("s0", 0, a.q, a.r, { gold: 2500 });
  const state = grantWagons(makeState({ heroes: [mover], settlements: [origin], activePlayerId: 0 }), 1);
  const created = createTradeRoute(state, 0, settlementEndpoint("s0"), heroEndpoint("h0"), GOLD, 1);
  assert.equal(created.ok, true, created.reason);

  // Wrap 1: loads 500 and walks 4 of the >= 5 tiles toward the hero.
  let current = advanceTradeRoutes(created.state, map);
  assert.equal(current.tradeRoutes![0].caravan!.cargo, 500);
  assert.ok(
    current.tradeRoutes![0].caravan!.pathIndex < current.tradeRoutes![0].caravan!.path.length,
    "still mid-path after the depart wrap -- the hero can now move",
  );

  // The hero marches away from the position the caravan pathed to at load.
  current = { ...current, heroes: { ...current.heroes, h0: { ...current.heroes.h0, q: a.q, r: a.r } } };

  // Daily chase: whenever the caravan's path is exhausted and the hero is
  // not on its tile, the caravan re-paths (A* to the hero's CURRENT
  // position) and keeps walking, cargo intact, until it lands on the hero.
  let delivered = false;
  for (let i = 0; i < 30 && !delivered; i++) {
    current = advanceTradeRoutes(current, map);
    delivered = current.heroes.h0.gold >= 500;
  }
  assert.ok(delivered, "the caravan caught up with the moved hero and delivered");
  assert.equal(current.heroes.h0.gold, 500, "full delivery, no cargo lost en route");
});

test("an exhausted chase waits for the next daily tick with cargo intact when it cannot re-path", () => {
  assert.equal(CARAVAN_CATCHUP_REPATHS_PER_DAY, 3, "the re-path cap is a named constant (suggest 3, per the brief)");
  const map = new GameMap(7, "small");
  const [a, b] = firstPassablePair(map);
  // A hand-built caravan already parked at b with its path exhausted, and a
  // hero endpoint that has moved off b -- the exact state the catch-up loop
  // starts from.
  const route = makeTradeRoute({
    id: "route0",
    from: settlementEndpoint("s0"),
    to: heroEndpoint("h0"),
    payload: GOLD,
    wagons: 1,
    caravan: { phase: "toDestination", cargo: 500, path: [b], pathIndex: 1 },
  });
  const state = makeState({
    heroes: [makeHero("h0", 0, a.q, a.r)],
    settlements: [makeSettlement("s0", 0, a.q, a.r, { gold: 0 })],
    tradeRoutes: [route],
    activePlayerId: 0,
  });

  // No map: the exhausted catch-up cannot re-path, so the day is a no-op --
  // the same state object returns (nothing moved, nothing lost).
  const waited = advanceTradeRoutes(state, null);
  assert.equal(waited, state, "the wait is an identity no-op, not a state change");
  assert.equal(state.tradeRoutes[0].caravan!.cargo, 500);
  assert.equal(state.heroes.h0.gold, 0);

  // The next daily tick with the map back ends the wait: re-path to the
  // hero's current position and deliver.
  let current = waited;
  for (let i = 0; i < 30 && current.heroes.h0.gold < 500; i++) current = advanceTradeRoutes(current, map);
  assert.equal(current.heroes.h0.gold, 500, "the wait ended and the chase delivered");
});

test("a dead hero destination flips the caravan home with its cargo, which is returned to the origin", () => {
  const map = new GameMap(41, "small");
  const [a, b] = reachableDistantPair(map);
  const mover = { ...makeHero("h0", 0, b.q, b.r), resources: emptyWarehouse() };
  const origin = makeSettlement("s0", 0, a.q, a.r, { warehouse: emptyWarehouse({ wood: 300 }) });
  const state = grantWagons(makeState({ heroes: [mover], settlements: [origin], activePlayerId: 0 }), 2);
  const created = createTradeRoute(state, 0, settlementEndpoint("s0"), heroEndpoint("h0"), WOOD, 2);
  assert.equal(created.ok, true, created.reason);

  // Depart (loads 100 of the 300 wood), then the hero dies mid-transit.
  let current = advanceTradeRoutes(created.state, map);
  assert.equal(current.settlements.s0.warehouse.wood, 200);
  assert.equal(current.tradeRoutes![0].caravan!.cargo, 100);
  current = { ...current, heroes: {} };

  // The caravan finishes the leg, discovers the dead endpoint, and rides
  // home with the cargo.
  let flipped = false;
  for (let i = 0; i < 10 && !flipped; i++) {
    current = advanceTradeRoutes(current, map);
    const caravan = current.tradeRoutes![0].caravan;
    flipped = caravan !== null && caravan.phase === "toHome";
  }
  assert.ok(flipped, "the dead hero destination flips the caravan homeward");
  assert.equal(current.tradeRoutes![0].caravan!.cargo, 100, "the cargo rides home (never lose cargo)");

  // Home: the wood is deposited back into the origin warehouse.
  for (let i = 0; i < 30 && current.tradeRoutes![0].caravan !== null; i++) {
    current = advanceTradeRoutes(current, map);
  }
  assert.equal(current.settlements.s0.warehouse.wood, 300, "the return cargo landed back in the origin");
  assert.equal(current.tradeRoutes![0].caravan, null, "home empty-handed; it cannot reload (the destination is gone)");
  assert.equal(current.tradeRoutes.length, 1, "the route itself stays -- its fate is updateTradeRoute({remove})'s to decide");
});

test("the return leg chases a moved hero origin too", () => {
  const map = new GameMap(47, "small");
  const [a, b] = reachableDistantPair(map);
  const mover = { ...makeHero("h0", 0, a.q, a.r), wagons: 2, resources: emptyWarehouse({ wood: 100 }) };
  const dest = makeSettlement("s0", 0, b.q, b.r);
  const state = grantWagons(makeState({ heroes: [mover], settlements: [dest], activePlayerId: 0 }), 2);
  const created = createTradeRoute(state, 0, heroEndpoint("h0"), settlementEndpoint("s0"), WOOD, 2);
  assert.equal(created.ok, true, created.reason);

  // Deliver the 100 wood to the settlement, then move the hero (the
  // caravan's home target) while it walks back.
  let current = advanceTradeRoutes(created.state, map);
  assert.equal(current.heroes.h0.resources?.wood, 0, "the cargo loaded out of the hero's wagons");
  for (let i = 0; i < 30 && current.settlements.s0.warehouse.wood < 100; i++) {
    current = advanceTradeRoutes(current, map);
  }
  assert.equal(current.settlements.s0.warehouse.wood, 100, "delivered at the settlement");
  current = { ...current, heroes: { ...current.heroes, h0: { ...current.heroes.h0, q: b.q, r: b.r } } };

  // The return leg re-paths to the hero's current position and ends there:
  // cargo 0, caravan null (reload next wrap).
  for (let i = 0; i < 30 && current.tradeRoutes![0].caravan !== null; i++) {
    current = advanceTradeRoutes(current, map);
  }
  assert.equal(current.tradeRoutes![0].caravan, null, "the empty caravan reached the moved hero and went to reload");
});

// ---- Legacy saves: normalize, don't migrate ---------------------------------

test("a legacy-shaped trade route hydrates to the endpoint shape and advances unchanged", () => {
  const map = new GameMap(43, "small");
  const [a, b] = firstPassablePair(map);
  const row = {
    name: "legacy-routes",
    seed: 1,
    round: 1,
    day: 1,
    active_player_id: 0,
    players: [makePlayer(0, "player", [], ["s0", "s1"], { wagonsOwned: 2, wagonsUnassigned: 2 })],
    heroes: {},
    settlements: {
      s0: makeSettlement("s0", 0, a.q, a.r, { warehouse: emptyWarehouse({ wood: 300 }) }),
      s1: makeSettlement("s1", 0, b.q, b.r),
    },
    // Old games.trade_routes JSONB: flat settlement ids + resource.
    trade_routes: [
      { id: "route0", fromSettlementId: "s0", toSettlementId: "s1", resource: "wood", wagons: 2, caravan: null },
    ],
  };
  const state = hydrateGameState(row);
  assert.deepEqual(state.tradeRoutes, [
    {
      id: "route0",
      from: { kind: "settlement", id: "s0" },
      to: { kind: "settlement", id: "s1" },
      payload: { kind: "resource", resource: "wood" },
      wagons: 2,
      caravan: null,
      ownerId: 0,
    },
  ]);
  assert.equal(state.nextTradeRouteId, 1, "the id counter derives from the hydrated route ids");

  // It advances exactly like a route created against the new shape: wrap 1
  // loads, wrap 2 walks the adjacent tile and delivers.
  const departed = advanceTradeRoutes(state, map);
  assert.equal(departed.settlements.s0.warehouse.wood, 200, "2 wagons x 50 loaded from the legacy route's origin");
  const enRoute = departed.tradeRoutes![0].caravan!;
  assert.equal(enRoute.phase, "toDestination");
  assert.equal(enRoute.cargo, 100);

  const deliveredState = advanceTradeRoutes(departed, map);
  assert.equal(deliveredState.settlements.s1.warehouse.wood, 100, "delivered at the destination");
  const flipped = deliveredState.tradeRoutes![0].caravan!;
  assert.equal(flipped.phase, "toHome", "a full delivery flips the legacy caravan homeward too");
  assert.equal(flipped.cargo, 0);
});

test("normalizeTradeRoute maps the legacy flat shape, passes the endpoint shape through, and drops garbage", () => {
  assert.deepEqual(
    normalizeTradeRoute({ id: "route0", fromSettlementId: "s0", toSettlementId: "s1", resource: "wood", wagons: 2, caravan: null }),
    {
      id: "route0",
      from: { kind: "settlement", id: "s0" },
      to: { kind: "settlement", id: "s1" },
      payload: { kind: "resource", resource: "wood" },
      wagons: 2,
      caravan: null,
    },
  );
  const shaped = {
    id: "route1",
    from: { kind: "hero", id: "h0" },
    to: { kind: "settlement", id: "s0" },
    payload: { kind: "gold" },
    wagons: 1,
    caravan: null,
  };
  assert.deepEqual(normalizeTradeRoute(shaped), shaped, "the current shape passes through untouched");
  assert.equal(normalizeTradeRoute(null), null);
  assert.equal(normalizeTradeRoute("route0"), null);
  assert.equal(
    normalizeTradeRoute({ id: "route0", fromSettlementId: "s0", toSettlementId: "s1", resource: "silver", wagons: 2 }),
    null,
    "an unknown resource drops the row",
  );
  assert.equal(
    normalizeTradeRoute({ id: "", from: { kind: "settlement", id: "s0" }, to: { kind: "settlement", id: "s1" }, payload: { kind: "gold" }, wagons: 1 }),
    null,
    "an empty id drops the row",
  );
  assert.equal(
    normalizeTradeRoute({ id: "route0", from: { kind: "settlement", id: "s0" }, to: { kind: "settlement", id: "s1" }, payload: { kind: "gold" }, wagons: -2 }),
    null,
    "a malformed wagon count drops the row",
  );
});

test("hydrated route ids seed nextTradeRouteId so a new route never collides (latent collision bug fixed)", () => {
  const shaped = (id: string) => ({
    id,
    from: { kind: "settlement", id: "s0" },
    to: { kind: "settlement", id: "s1" },
    payload: { kind: "gold" } as TradeRoutePayload,
    wagons: 1,
    caravan: null,
  });
  const row = {
    name: "counter-derivation",
    seed: 1,
    round: 1,
    day: 1,
    active_player_id: 0,
    players: [makePlayer(0, "player", [], ["s0", "s1"], { wagonsOwned: 2, wagonsUnassigned: 2 })],
    heroes: {},
    settlements: {
      s0: makeSettlement("s0", 0, 2, 2),
      s1: makeSettlement("s1", 0, 8, 2),
    },
    trade_routes: [shaped("route0"), shaped("route1"), shaped("route2")],
  };
  const state = hydrateGameState(row);
  assert.equal(state.nextTradeRouteId, 3, "one past the highest route<n> id");
  const created = createTradeRoute(state, 0, settlementEndpoint("s0"), settlementEndpoint("s1"), GOLD, 1);
  assert.equal(created.route!.id, "route3", "not route0 -- the counter no longer resets on every hydration");

  const emptyRow = { ...row, name: "counter-empty", trade_routes: [] };
  assert.equal(hydrateGameState(emptyRow).nextTradeRouteId, 0, "no routes -> counter 0");
});

// ---- Route ownership (ownerId stamp, update gate, hydrate backfill) ---------

test("createTradeRoute stamps the creating seat and rejects a same-tile endpoint pair", () => {
  const state = grantWagons(
    makeState({
      heroes: [makeHero("h0", 0, 2, 2)],
      settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 0, 8, 2)],
      activePlayerId: 0,
    }),
    2,
  );
  const created = createTradeRoute(state, 0, settlementEndpoint("s0"), settlementEndpoint("s1"), WOOD, 1);
  assert.equal(created.ok, true, created.reason);
  assert.equal(created.route!.ownerId, 0, "the creating seat is stamped on the route");

  // Same TILE, different endpoints: the hero stands on s0. The pair is
  // distinct but a route between them can never load.
  const sameTile = createTradeRoute(state, 0, settlementEndpoint("s0"), heroEndpoint("h0"), WOOD, 1);
  assert.equal(sameTile.ok, false);
  assert.equal(sameTile.reason, "same_tile");
});

test("updateTradeRoute gates on the persisted owner: a captured-origin route belongs to (and is removable by) its true owner, not the capturer", () => {
  const state = grantWagons(
    makeState({
      heroes: [],
      settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 0, 8, 2)],
      activePlayerId: 0,
    }),
    2,
  );
  const created = createTradeRoute(state, 0, settlementEndpoint("s0"), settlementEndpoint("s1"), WOOD, 1);
  assert.equal(created.ok, true, created.reason);
  const captured: GameState = {
    ...created.state,
    settlements: {
      ...created.state.settlements,
      s0: { ...created.state.settlements.s0, ownerId: 1 },
    },
  };
  const byCapturer = updateTradeRoute(captured, 1, created.route!.id, { remove: true });
  assert.equal(byCapturer.ok, false, "the capturer does not own the route");
  const byOwner = updateTradeRoute(captured, 0, created.route!.id, { remove: true });
  assert.equal(byOwner.ok, true, "the true owner can still remove it");
});

test("updateTradeRoute rejects a payload switch while the caravan is in flight, and a wagon delta that would zero the route", () => {
  const route = makeTradeRoute({
    id: "route0",
    from: settlementEndpoint("s0"),
    to: settlementEndpoint("s1"),
    payload: { kind: "gold" },
    wagons: 2,
    caravan: { phase: "toDestination", cargo: 500, path: [{ q: 3, r: 2 }], pathIndex: 1 },
  });
  const state = makeState({
    heroes: [],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 0, 8, 2)],
    tradeRoutes: [route],
    activePlayerId: 0,
  });
  state.players = state.players.map((p) => (p.id === 0 ? { ...p, wagonsOwned: 2, wagonsUnassigned: 2 } : p));

  const flipped = updateTradeRoute(state, 0, "route0", { resource: "wood" });
  assert.equal(flipped.ok, false, "the aboard cargo has no label; a mid-flight switch would reinterpret it at delivery");
  assert.equal(flipped.reason, "route_in_flight");

  const shrunk = updateTradeRoute(state, 0, "route0", { wagonsDelta: -2 });
  assert.equal(shrunk.ok, false, "a route always keeps at least one wagon -- no clamp to 0");
  assert.equal(shrunk.reason, "route_needs_a_wagon");

  const grownMidFlight = updateTradeRoute(state, 0, "route0", { wagonsDelta: 1 });
  assert.equal(grownMidFlight.ok, true, "a wagon delta mid-flight only affects the next load and stays legal");
  assert.equal(grownMidFlight.state.tradeRoutes[0].wagons, 3);
});

test("hydration backfills route ownership: the raw row wins, then the FROM endpoint's owner, then the TO's, else null", () => {
  const row = {
    name: "owner-backfill",
    seed: 1,
    round: 1,
    day: 1,
    active_player_id: 0,
    players: [makePlayer(0, "player", [], ["s0", "s1"], { wagonsOwned: 2, wagonsUnassigned: 2 }), makePlayer(2, "player", [], [])],
    heroes: {},
    settlements: {
      s0: makeSettlement("s0", 2, 2, 2),
      s1: makeSettlement("s1", 0, 8, 2),
    },
  };
  const shaped = (overrides: Record<string, unknown>) => ({
    id: "route0",
    from: { kind: "settlement", id: "s0" },
    to: { kind: "settlement", id: "s1" },
    payload: { kind: "gold" },
    wagons: 1,
    caravan: null,
    ...overrides,
  });

  assert.equal(
    hydrateGameState({ ...row, trade_routes: [shaped({ ownerId: 9 })] }).tradeRoutes![0].ownerId,
    9,
    "a persisted ownerId is trusted verbatim",
  );
  assert.equal(
    hydrateGameState({ ...row, trade_routes: [shaped({})] }).tradeRoutes![0].ownerId,
    2,
    "no raw ownerId -> the FROM endpoint's owner",
  );
  assert.equal(
    hydrateGameState({
      ...row,
      trade_routes: [
        { id: "route0", from: { kind: "hero", id: "h-gone" }, to: { kind: "settlement", id: "s1" }, payload: { kind: "gold" }, wagons: 1, caravan: null },
      ],
    }).tradeRoutes![0].ownerId,
    0,
    "a dead hero FROM endpoint falls back to the TO endpoint's owner",
  );
  const bothDead = hydrateGameState({
    ...row,
    trade_routes: [
      { id: "route0", from: { kind: "hero", id: "h-gone" }, to: { kind: "hero", id: "h-gone2" }, payload: { kind: "gold" }, wagons: 1, caravan: null },
    ],
  });
  assert.equal(
    bothDead.tradeRoutes![0].ownerId,
    null,
    "dead endpoints on both sides -> explicit null (the gate falls back; never misattributed)",
  );
});

test("normalizeTradeRoute passes a persisted ownerId through and drops corrupt caravans at the documented bounds", () => {
  const owned = normalizeTradeRoute({ id: "route0", fromSettlementId: "s0", toSettlementId: "s1", resource: "wood", wagons: 1, ownerId: 3, caravan: null });
  assert.equal(owned?.ownerId, 3, "a legacy row's persisted ownerId survives normalization");
  const unowned = normalizeTradeRoute({ id: "route0", fromSettlementId: "s0", toSettlementId: "s1", resource: "wood", wagons: 1, caravan: null });
  assert.equal(unowned === null || !("ownerId" in unowned), true, "no raw ownerId stays absent at the normalize layer (never ownerId: undefined)");

  const base = {
    id: "route0",
    from: { kind: "settlement", id: "s0" },
    to: { kind: "settlement", id: "s1" },
    payload: { kind: "resource", resource: "wood" },
    wagons: 1,
  };
  assert.equal(normalizeTradeRoute({ ...base, caravan: { phase: "toDestination", cargo: -1, path: [{ q: 3, r: 2 }], pathIndex: 0 } }), null, "negative cargo drops the route");
  const fractional = normalizeTradeRoute({ ...base, caravan: { phase: "toDestination", cargo: 1.5, path: [{ q: 3, r: 2 }], pathIndex: 0 } });
  assert.equal(fractional?.caravan?.cargo, 1.5, "fractional cargo stays (settlement stocks are 2-decimal since the NUMERIC migration)");
  assert.equal(normalizeTradeRoute({ ...base, caravan: { phase: "toDestination", cargo: 10, path: [], pathIndex: 0 } }), null, "an empty path drops the route");
  assert.equal(normalizeTradeRoute({ ...base, caravan: { phase: "toDestination", cargo: 10, path: [{ q: 3, r: 2 }], pathIndex: 2 } }), null, "pathIndex beyond the path drops the route");
  assert.equal(normalizeTradeRoute({ ...base, caravan: { phase: "toDestination", cargo: 10, path: [{ q: 3, r: 2 }], pathIndex: -1 } }), null, "a negative pathIndex drops the route");
  assert.equal(normalizeTradeRoute({ ...base, caravan: { phase: "toDestination", cargo: 10, path: [{ q: 3.5, r: 2 }], pathIndex: 0 } }), null, "fractional path coordinates drop the route");
  const arrived = normalizeTradeRoute({ ...base, caravan: { phase: "toDestination", cargo: 10, path: [{ q: 3, r: 2 }], pathIndex: 1 } });
  assert.equal(arrived?.caravan?.pathIndex, 1, "pathIndex === path.length (arrived) is in range and kept");
});

test("transferCargoLoot: the winner takes the purse and cargo up to their own caps", () => {
  const state = logisticsState();
  const winner = {
    ...makeHero("h1", 0, 9, 9),
    gold: 1000,
    wagons: 2,
    // Phase 1 split: the purse cap reads the treasury-cart slot, so "already
    // at the 1,000g cap" needs 2 CARTS (2 x 500) -- `wagons: 2` above now
    // governs only the 2 x 50 resource cargo cap.
    treasuryWagons: 2,
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
  };
  const loser = {
    ...makeHero("h0", 0, 2, 2),
    gold: 3000,
    wagons: 5,
    resources: { wood: 200, stone: 100, iron: 0, arcane: 0, food: 0 },
  };
  const battleState: GameState = {
    ...state,
    heroes: { h0: loser, h1: winner },
  };
  const result = transferCargoLoot(battleState.heroes, "h1", "h0");
  assert.equal(result.gold, 0, "winner is already at their 1000g purse cap — soft caps never force a transfer");
  assert.equal(result.heroes.h1.resources?.wood, 100, "winner cargo cap is 2×50");
  assert.equal(result.heroes.h0.resources?.wood, 100, "overflow stays with the loser (soft caps)");
});
