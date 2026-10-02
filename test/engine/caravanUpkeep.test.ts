import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCaravanUpkeep,
  applyWeeklyUpkeep,
  CARAVAN_DESERT_COST_SHARE,
  CARAVAN_DESERT_GRACE_WEEKS,
  CARAVAN_UPKEEP_FOOD_PER_WAGON,
  CARAVAN_UPKEEP_GOLD_PER_WAGON,
  caravanDesertion,
  DESERT_COST_SHARE,
  DESERT_GRACE_WEEKS,
} from "@heroes/engine";
import type { GameState, TradeRouteState, UnitType } from "@heroes/contracts";
import { emptyWarehouse, makeHero, makeSettlement, makeState, makeTradeRoute } from "../charter/_helpers";

// Phase 3 — weekly caravan maintenance, paid FIRST in applyWeeklyUpkeep.

const settlementEndpoint = (id: string) => ({ kind: "settlement" as const, id });
const heroEndpoint = (id: string) => ({ kind: "hero" as const, id });

test("caravan constants: both per-wagon rates are 1 and the ladder constants are the shared troop-upkeep ones", () => {
  assert.equal(CARAVAN_UPKEEP_GOLD_PER_WAGON, 1);
  assert.equal(CARAVAN_UPKEEP_FOOD_PER_WAGON, 1);
  // Re-exported, not re-implemented: the caravan ladder MUST be the troop
  // ladder's constants (a fork here would silently desync the two ladders).
  assert.equal(CARAVAN_DESERT_GRACE_WEEKS, DESERT_GRACE_WEEKS);
  assert.equal(CARAVAN_DESERT_GRACE_WEEKS, 2);
  assert.equal(CARAVAN_DESERT_COST_SHARE, DESERT_COST_SHARE);
  assert.equal(caravanDesertion(2), 1, "max(1, ceil(2 x 0.2)) = 1");
  assert.equal(caravanDesertion(10), 2, "ceil(10 x 0.2) = 2");
  assert.equal(caravanDesertion(0), 1, "the 1-wagon floor holds at zero");
});

function upkeepWorld(route: TradeRouteState, opts?: { day?: number }): GameState {
  const origin = makeSettlement("s0", 0, 2, 2, { gold: 100, warehouse: emptyWarehouse({ food: 100 }) });
  const dest = makeSettlement("s1", 0, 8, 2);
  const state = makeState({
    settlements: [origin, dest],
    tradeRoutes: [route],
    day: opts?.day ?? 1,
  });
  return state;
}

test("a settlement-origin route bills its treasury and warehouse food (caravan in flight bills too)", () => {
  const route = makeTradeRoute({
    id: "route0",
    from: settlementEndpoint("s0"),
    to: settlementEndpoint("s1"),
    payload: { kind: "resource", resource: "wood" },
    wagons: 3,
    caravan: { phase: "toDestination", cargo: 10, path: [{ q: 3, r: 2 }, { q: 4, r: 2 }], pathIndex: 1 },
  });
  const result = applyCaravanUpkeep(upkeepWorld(route), 7);
  assert.equal(result.state.settlements.s0.gold, 100 - 3, "3 wagons x 1g");
  assert.equal(result.state.settlements.s0.warehouse.food, 100 - 3, "3 wagons x 1f");
  assert.equal(result.state.tradeRoutes?.[0].wagons, 3);
  // Fully paid and never unpaid before: the streak key stays ABSENT.
  const after = result.state.tradeRoutes?.[0] as TradeRouteState;
  assert.equal("unpaidSinceDay" in after, false, "a paid route that never went unpaid keeps the field absent");
  assert.equal(result.removedRouteIds.length, 0);
});

test("a hero-origin route bills its purse and its larder", () => {
  const hero = { ...makeHero("h0", 0, 2, 2), gold: 10, resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 10 } };
  const origin = makeSettlement("s0", 0, 2, 2);
  const dest = makeSettlement("s1", 0, 8, 2);
  const state = makeState({
    heroes: [hero],
    settlements: [origin, dest],
    tradeRoutes: [
      makeTradeRoute({
        id: "route0",
        from: heroEndpoint("h0"),
        to: settlementEndpoint("s1"),
        payload: { kind: "gold" },
        wagons: 2,
      }),
    ],
    day: 7,
  });
  const result = applyCaravanUpkeep(state, 7);
  assert.equal(result.state.heroes.h0.gold, 10 - 2, "2 wagons x 1g out of the purse");
  assert.equal(result.state.heroes.h0.resources?.food, 10 - 2, "2 wagons x 1f out of the larder");
  assert.equal(result.state.settlements.s0.gold, 0, "the origin SETTLEMENT is untouched for a hero-origin route");
  assert.equal(result.state.tradeRoutes?.[0].unpaidSinceDay ?? null, null, "fully paid -> no streak");
});

test("a short origin store pays clamped (no debt) and stamps the first-unpaid day", () => {
  const origin = makeSettlement("s0", 0, 2, 2, { gold: 1, warehouse: emptyWarehouse({ food: 10 }) });
  const dest = makeSettlement("s1", 0, 8, 2);
  const state = makeState({
    settlements: [origin, dest],
    tradeRoutes: [
      makeTradeRoute({
        id: "route0",
        from: settlementEndpoint("s0"),
        to: settlementEndpoint("s1"),
        payload: { kind: "gold" },
        wagons: 2,
      }),
    ],
    day: 7,
  });
  const result = applyCaravanUpkeep(state, 14);
  assert.equal(result.state.settlements.s0.gold, 0, "the 1 available gold is paid, never borrowed");
  assert.equal(result.state.settlements.s0.warehouse.food, 10 - 2, "food was available and paid in full");
  assert.equal(result.state.tradeRoutes?.[0].unpaidSinceDay, 14, "the charge day stamps the streak");
  assert.equal(result.state.tradeRoutes?.[0].wagons, 2, "grace: nothing deserts on the first unpaid charge");
});

test("an unpaid route that pays in full later clears its streak to null", () => {
  const route = makeTradeRoute({
    id: "route0",
    from: settlementEndpoint("s0"),
    to: settlementEndpoint("s1"),
    payload: { kind: "gold" },
    wagons: 1,
    unpaidSinceDay: 7,
  });
  const result = applyCaravanUpkeep(upkeepWorld(route), 14);
  const after = result.state.tradeRoutes?.[0];
  assert.equal(after?.unpaidSinceDay, null, "a full payment clears the streak (null, not absent)");
  assert.equal(after?.wagons, 1);
});

test("desertion ladder: two unpaid weeks of grace, then max(1, ceil(wagons x share)) wagons per unpaid week until the route disbands", () => {
  let route = makeTradeRoute({
    id: "route0",
    from: settlementEndpoint("s0"),
    to: settlementEndpoint("s1"),
    payload: { kind: "resource", resource: "wood" },
    wagons: 2,
    unpaidSinceDay: 7,
  });
  // A BROKE origin: the bill can never be paid, so the streak persists.
  const broke = makeSettlement("s0", 0, 2, 2, { gold: 0, warehouse: emptyWarehouse() });
  let state = makeState({
    settlements: [broke, makeSettlement("s1", 0, 8, 2)],
    tradeRoutes: [route],
    day: 7,
  });

  // Charge 2 of the streak (day 14): one unpaid week elapsed, grace is 2 — closed.
  let result = applyCaravanUpkeep(state, 14);
  assert.equal(result.state.tradeRoutes?.[0].wagons, 2, "still inside the grace window");
  assert.equal(result.state.tradeRoutes?.[0].unpaidSinceDay, 7, "the streak keeps its FIRST unpaid day");
  state = result.state;

  // Charge 3 (day 21): gate open — one wagon deserts, GONE (not pooled).
  result = applyCaravanUpkeep(state, 21);
  assert.equal(result.state.tradeRoutes?.[0].wagons, 1, "max(1, ceil(2 x 0.2)) = 1 deserted");
  assert.equal(result.state.players[0].wagonsUnassigned, 0, "deserted wagons do NOT return to the pool");
  assert.equal(result.removedRouteIds.length, 0);
  state = result.state;

  // Charge 4 (day 28): the last wagon deserts — the route auto-removes.
  result = applyCaravanUpkeep(state, 28);
  assert.equal(result.state.tradeRoutes?.length, 0, "0 wagons -> route removed");
  assert.deepEqual(result.removedRouteIds, ["route0"]);
  assert.equal(result.state.players[0].wagonsUnassigned, 0, "still nothing returned to the pool");
});

test("a dead-origin route skips maintenance entirely (no bill, no streak, no desertion)", () => {
  const state = makeState({
    settlements: [makeSettlement("s1", 0, 8, 2)],
    heroes: [makeHero("h-alive", 0, 5, 5)],
    tradeRoutes: [
      makeTradeRoute({
        id: "route0",
        from: heroEndpoint("h-dead"),
        to: settlementEndpoint("s1"),
        payload: { kind: "gold" },
        wagons: 2,
      }),
    ],
    day: 7,
  });
  const result = applyCaravanUpkeep(state, 21);
  assert.equal(result.state, state, "nothing changed anywhere — same state identity");
  assert.equal(result.state.tradeRoutes?.length, 1, "the route survives");
  assert.equal(result.removedRouteIds.length, 0);
});

test("a zero-wagon route bills nothing and a routeless state is a no-op", () => {
  const zeroWagon = makeTradeRoute({
    id: "route0",
    from: settlementEndpoint("s0"),
    to: settlementEndpoint("s1"),
    payload: { kind: "gold" },
    wagons: 0,
  });
  const withZero = upkeepWorld(zeroWagon, { day: 7 });
  const zeroResult = applyCaravanUpkeep(withZero, 7);
  assert.equal(zeroResult.state.settlements.s0.gold, 100, "no bill for zero wagons");
  assert.equal(zeroResult.state.tradeRoutes?.length, 1);

  const empty = makeState({ day: 7 });
  const emptyResult = applyCaravanUpkeep(empty, 7);
  assert.equal(emptyResult.state, empty, "no routes -> identity no-op");
  assert.deepEqual(emptyResult.removedRouteIds, []);
});

// ── The paid-FIRST ordering guarantee ──────────────────────────────────────

const peasant: UnitType = {
  id: "peasant",
  name: "peasant",
  attack: 1,
  defence: 1,
  health: 1,
  speed: 1,
  description: "",
  advantageType: "infantry",
  specialty: "",
  specialtyPriority: 0,
  upkeepGold: 1,
  upkeepFood: 1,
};

test("applyWeeklyUpkeep charges caravan maintenance BEFORE hero upkeep: on a shortage the caravan is paid and the HERO goes unfed", () => {
  // s0 holds exactly enough to pay the caravan (2w: 2g + 2f) and nothing more;
  // the hero standing on it carries a 3g/3f army with a 1g purse and an empty
  // larder. If the caravan ran after the hero, the hero's settlement food draw
  // would eat the warehouse first and the caravan would starve instead.
  const origin = makeSettlement("s0", 0, 2, 2, { gold: 3, warehouse: emptyWarehouse({ food: 2 }) });
  const dest = makeSettlement("s1", 0, 8, 2);
  const hero = {
    ...makeHero("h0", 0, 2, 2, { troops: 3, stacks: [{ entries: [{ unitTypeId: "peasant", count: 3 }] }] }),
    gold: 1,
  };
  const state = makeState({
    settlements: [origin, dest],
    heroes: [hero],
    tradeRoutes: [
      makeTradeRoute({
        id: "route0",
        from: settlementEndpoint("s0"),
        to: settlementEndpoint("s1"),
        payload: { kind: "resource", resource: "wood" },
        wagons: 2,
      }),
    ],
    day: 7,
  });

  const after = applyWeeklyUpkeep(state, 0.1, { peasant });

  assert.equal(after.settlements.s0.gold, 3 - 2, "the caravan's gold bill came out of the treasury FIRST");
  assert.equal(after.settlements.s0.warehouse.food, 0, "the caravan's food bill emptied the warehouse FIRST");
  const route = after.tradeRoutes?.[0];
  assert.ok(route, "the route survives");
  assert.equal(route?.unpaidSinceDay ?? null, null, "the caravan paid in full — no streak");
  assert.equal(route?.wagons, 2, "no wagons deserted");
  const charged = after.heroes.h0;
  assert.equal(charged.gold, 0, "the hero paid its purse (1g) toward a 3g bill");
  assert.notEqual(charged.upkeepUnpaidSinceDay, null, "the HERO is the consumer that went unfed");
  assert.ok((charged.upkeepUnpaidTroops ?? 0) > 0, "the hero has unfed troops");
});
