// Regression tests for the logistics fix plan (folded into the test:unit glob).
// Run: npx tsx --test test/logistics-bugs/logistics.routeLifecycle.test.ts
//
// BUG L1: a same-tile route (settlement -> hero standing on that settlement) is accepted at
//   creation but stalls forever: findPath returns [] for start===goal, so the caravan never
//   departs, silently, while the route is still billed weekly.
// BUG L2: a route whose ORIGIN hero died is unremovable — updateTradeRoute's owner gate
//   (endpointOwner(route.from) !== actor) always fails for a dead hero, contradicting the
//   module's own comments (logistics.ts advance notes + caravanUpkeep.ts header: "the route's
//   fate stays with the manual remove").
// BUG L3: advanceTradeRoutes never re-validates ownership — after the origin settlement is
//   captured the old owner's route keeps loading from the (enemy) origin and delivering to the
//   old owner.
// BUG L4: updateTradeRoute({resource}) has no in-flight guard — a treasure caravan carrying
//   gold has its cargo reinterpreted by the NEW payload and delivers the amount as the new
//   resource (gold vanishes).
// BUG L5: updateTradeRoute's negative wagonsDelta clamps to 0 wagons, yielding a 0-wagon
//   route that maintenance skips and nothing ever auto-removes (zombie route).
//
// Evidence refs: packages/engine/src/logistics.ts (createTradeRoute same_endpoint check
// ~line 322; updateTradeRoute owner gate ~367, wagons clamp ~392-404, payload switch ~405-414;
// advanceTradeRoutes loading ~499-534, arrival ~546+, toHome ~640+); packages/engine/src/economy/
// caravanUpkeep.ts (~88 zero-wagon skip, ~155-161 desertion auto-remove); docs/resource-gathering.md
// §6.6 (:204-205); docs/wagons-stockpiles-trade-routes-plan.md §5.2.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advanceTradeRoutes,
  applyCaravanUpkeep,
  createTradeRoute,
  findPath,
  GameMap,
  hexDistance,
  updateTradeRoute,
  type GameState,
} from "@heroes/engine";
import type { TradeRouteEndpoint, TradeRoutePayload } from "@heroes/contracts";
import { emptyWarehouse, makeHero, makeSettlement, makeState, makeTradeRoute } from "../charter/_helpers";

const settlementEndpoint = (id: string): TradeRouteEndpoint => ({ kind: "settlement", id });
const heroEndpoint = (id: string): TradeRouteEndpoint => ({ kind: "hero", id });
const WOOD: TradeRoutePayload = { kind: "resource", resource: "wood" };
const GOLD: TradeRoutePayload = { kind: "gold" };

function grantWagons(state: GameState, unassigned: number): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === 0 ? { ...p, wagonsOwned: unassigned, wagonsUnassigned: unassigned } : p,
    ),
  };
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

// A passable pair far enough apart (>= minDist) that a departing caravan is still mid-path
// after its first 4-tile daily wrap (fixture shape copied from test/engine/logistics.test.ts).
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

// ---- L1 ----------------------------------------------------------------------

test("a same-tile route (settlement -> hero standing on it) is rejected at creation or delivers immediately, never stalls", () => {
  const map = new GameMap(71, "small");
  const [a] = firstPassablePair(map);
  const hero = { ...makeHero("h0", 0, a.q, a.r), resources: emptyWarehouse() };
  const origin = makeSettlement("s0", 0, a.q, a.r, { gold: 1000 });
  const state = grantWagons(
    makeState({ heroes: [hero], settlements: [origin], activePlayerId: 0 }),
    1,
  );

  const created = createTradeRoute(state, 0, settlementEndpoint("s0"), heroEndpoint("h0"), GOLD, 1);
  if (!created.ok) return; // intended alternative A: same-tile routes are rejected at creation

  let current = created.state;
  let delivered = false;
  for (let i = 0; i < 8 && !delivered; i++) {
    current = advanceTradeRoutes(current, map);
    delivered = current.heroes.h0.gold >= 500;
  }
  assert.ok(
    delivered,
    `intended: a same-tile route loads+delivers immediately (or is rejected); actual: stall — caravan=${JSON.stringify(current.tradeRoutes[0].caravan)} after 8 advances, hero gold ${current.heroes.h0.gold}`,
  );
});

test("a hand-built same-tile route (the legacy-hydrated shape) is still billed weekly while it never departs [pins-current]", () => {
  const map = new GameMap(71, "small");
  const [a] = firstPassablePair(map);
  const hero = { ...makeHero("h0", 0, a.q, a.r), resources: emptyWarehouse() };
  const origin = makeSettlement("s0", 0, a.q, a.r, { gold: 1000 });
  // L1's create-time rejection now guards NEW routes, so the pair is built
  // directly in state -- the shape a pre-fix persisted row still carries
  // (hydration cannot retract an existing route).
  const route = makeTradeRoute({
    id: "route0",
    from: settlementEndpoint("s0"),
    to: heroEndpoint("h0"),
    payload: GOLD,
    wagons: 1,
  });
  const state = makeState({
    heroes: [hero],
    settlements: [origin],
    tradeRoutes: [route],
    activePlayerId: 0,
  });

  let current = state;
  for (let i = 0; i < 5; i++) current = advanceTradeRoutes(current, map);
  assert.equal(
    current.tradeRoutes[0].caravan,
    null,
    "evidence: the caravan never departs (start===goal -> findPath returns [])",
  );
  const billed = applyCaravanUpkeep(current, 7);
  assert.equal(
    billed.state.settlements.s0.gold,
    999,
    "pins-current: the stalled route is billed anyway (1g/wk out of the origin treasury for a caravan that can never move); create-time rejection cannot retract persisted routes",
  );
});

// ---- L2 ----------------------------------------------------------------------

test("a route whose origin hero died is removable by its owning seat (ownership is persisted on the route)", () => {
  const state = makeState({
    heroes: [],
    settlements: [makeSettlement("s1", 0, 8, 2)],
    tradeRoutes: [
      makeTradeRoute({
        id: "route0",
        from: heroEndpoint("h0"),
        to: settlementEndpoint("s1"),
        payload: GOLD,
        wagons: 1,
        // The fix: the route carries its owner, so removal no longer
        // depends on the (now dead) origin hero resolving to one.
        ownerId: 0,
      }),
    ],
    activePlayerId: 0,
  });
  const removed = updateTradeRoute(state, 0, "route0", { remove: true });
  assert.equal(
    removed.ok,
    true,
    `intended: the owning seat can remove the dead-origin route (logistics.ts advance notes + caravanUpkeep.ts header both say "the route's fate stays with the manual remove"); actual reason: ${removed.reason}`,
  );
});

test("a dead-origin returning caravan holds its cargo at path end, undestroyed [pins-current]", () => {
  const route = makeTradeRoute({
    id: "route0",
    from: heroEndpoint("h0"),
    to: settlementEndpoint("s1"),
    payload: GOLD,
    wagons: 1,
    caravan: { phase: "toHome", cargo: 500, path: [{ q: 2, r: 2 }, { q: 8, r: 2 }], pathIndex: 2 },
  });
  const state = makeState({
    heroes: [],
    settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 0, 8, 2)],
    tradeRoutes: [route],
    activePlayerId: 0,
  });
  const advanced = advanceTradeRoutes(state, null);
  assert.equal(
    advanced,
    state,
    "pins-current: the hold is an identity no-op (logistics.ts advance notes: 'a dead hero origin leaves a returning caravan holding its cargo at the path's end')",
  );
  assert.equal(state.tradeRoutes[0].caravan?.cargo, 500, "pins-current: cargo rides intact, never destroyed");
  assert.equal(state.settlements.s1.gold, 0, "pins-current: nothing is deposited while the origin hero is gone");
});

// ---- L3 ----------------------------------------------------------------------

test("a captured origin goes dormant: the route stops loading and delivers at most its pre-capture cargo", () => {
  const map = new GameMap(61, "small");
  const [a, b] = reachableDistantPair(map);
  const origin = makeSettlement("s0", 0, a.q, a.r, { warehouse: emptyWarehouse({ wood: 200 }) });
  const dest = makeSettlement("s1", 0, b.q, b.r);
  const state = grantWagons(
    makeState({ heroes: [], settlements: [origin, dest], activePlayerId: 0 }),
    2,
  );
  const created = createTradeRoute(state, 0, settlementEndpoint("s0"), settlementEndpoint("s1"), WOOD, 2);
  assert.equal(created.ok, true, created.reason);

  const departed = advanceTradeRoutes(created.state, map);
  assert.equal(
    departed.settlements.s0.warehouse.wood,
    100,
    "wrap 1 loaded 2x50 from the origin (precondition)",
  );
  // Capture: the origin changes hands (direct state mutation simulating settlement capture).
  let current: GameState = {
    ...departed,
    settlements: {
      ...departed.settlements,
      s0: { ...departed.settlements.s0, ownerId: 1 },
    },
  };

  for (let i = 0; i < 40 && (current.settlements.s1.warehouse.wood ?? 0) < 200; i++) {
    current = advanceTradeRoutes(current, map);
  }
  const destWood = current.settlements.s1.warehouse.wood ?? 0;
  const originWood = current.settlements.s0.warehouse.wood ?? 0;
  // INTENDED (least-invasive defensible): once the origin no longer belongs to the route
  // owner, the route stops loading and the caravan turns home — the destination receives at
  // most the pre-capture cargo, and the enemy-owned origin is not drained further.
  assert.ok(
    destWood <= 100,
    `intended: at most the pre-capture 100 wood reaches the destination; actual: ${destWood} delivered to the old owner`,
  );
  assert.ok(
    originWood >= 100,
    `intended: the captured (enemy) origin is not drained further by the stale route; actual: enemy stock drained to ${originWood}`,
  );
});

// ---- L4 ----------------------------------------------------------------------

test("an in-flight payload switch is rejected, so a treasure caravan's cargo is never reinterpreted", () => {
  const map = new GameMap(67, "small");
  const [a, b] = reachableDistantPair(map);
  const origin = makeSettlement("s0", 0, a.q, a.r, { gold: 2500 });
  const dest = makeSettlement("s1", 0, b.q, b.r);
  const state = grantWagons(
    makeState({ heroes: [], settlements: [origin, dest], activePlayerId: 0 }),
    1,
  );
  const created = createTradeRoute(state, 0, settlementEndpoint("s0"), settlementEndpoint("s1"), GOLD, 1);
  assert.equal(created.ok, true, created.reason);

  let current = advanceTradeRoutes(created.state, map);
  assert.equal(current.tradeRoutes[0].caravan?.cargo, 500, "wrap 1 loaded 1x500 gold (precondition)");

  const flipped = updateTradeRoute(current, 0, "route0", { resource: "wood" });
  if (!flipped.ok) return; // intended alternative: in-flight payload switches are rejected
  current = flipped.state;

  for (let i = 0; i < 40 && (current.settlements.s1.warehouse.wood ?? 0) < 500; i++) {
    current = advanceTradeRoutes(current, map);
  }
  assert.equal(
    current.settlements.s1.warehouse.wood,
    500,
    "evidence (actual): the 500 gold landed as 500 WOOD at the destination",
  );
  assert.equal(
    current.settlements.s1.gold,
    500,
    "intended: the caravan's cargo keeps its original meaning and delivers as gold (or the in-flight switch is rejected); actual: the gold vanished into wood",
  );
});

// ---- L5 ----------------------------------------------------------------------

test("a wagonsDelta that would zero a route is rejected, so no 0-wagon zombie route can exist", () => {
  const state = grantWagons(
    makeState({
      heroes: [],
      settlements: [makeSettlement("s0", 0, 2, 2), makeSettlement("s1", 0, 8, 2)],
      activePlayerId: 0,
    }),
    1,
  );
  const created = createTradeRoute(state, 0, settlementEndpoint("s0"), settlementEndpoint("s1"), WOOD, 1);
  assert.equal(created.ok, true, created.reason);

  const shrunk = updateTradeRoute(created.state, 0, created.route!.id, { wagonsDelta: -1 });
  if (!shrunk.ok) return; // intended alternative: a -1 that would zero the route is rejected outright
  assert.equal(
    shrunk.state.tradeRoutes[0].wagons,
    0,
    "evidence: the negative delta clamps to 0 wagons and the update succeeds",
  );
  assert.equal(
    shrunk.state.tradeRoutes.length,
    0,
    "intended: wagons at 0 auto-remove the route (docs/resource-gathering.md:205, the desertion rule); actual: a 0-wagon zombie route survives forever — maintenance skips it (caravanUpkeep) and the UI's next -1 fails silently",
  );
});
