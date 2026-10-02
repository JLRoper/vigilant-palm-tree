import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateTradeNeeds,
  heroTradeNeeds,
  settlementFoodNeed,
  settlementGoldNeed,
  TRADE_GOLD_RESERVE,
  TRADE_LOW_FOOD_RATIO,
  TRADE_MAX_RECOMMENDATIONS,
  type UnitType,
} from "@heroes/engine";
import type { GameState, Platoon } from "@heroes/contracts";
import { emptyWarehouse, makeHero, makePlayer, makeSettlement, makeState, makeTradeRoute } from "../charter/_helpers";

// Phase 5 — the recommendation evaluator (pure, deterministic, DOM-free).

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

function settlement(
  id: string,
  ownerId: number | null,
  q: number,
  r: number,
  opts: { population?: number; gold?: number; food?: number; stacks?: Platoon[] } = {},
) {
  const s = makeSettlement(id, ownerId, q, r, {
    population: opts.population ?? 0,
    gold: opts.gold ?? 0,
    warehouse: emptyWarehouse({ food: opts.food ?? 0 }),
  });
  if (opts.stacks) s.stacks = opts.stacks;
  return s;
}

function stack(unitTypeId: string, count: number): Platoon[] {
  return [{ entries: [{ unitTypeId, count }] }];
}

test("thresholds: settlement food is low below 25% of its weekly requirement and only then", () => {
  // population 400 -> foodRequired = 4; TRADE_LOW_FOOD_RATIO x 4 = 1.
  assert.equal(TRADE_LOW_FOOD_RATIO, 0.25);
  const boundary = settlement("s0", 0, 2, 2, { population: 400, food: 1 });
  assert.equal(settlementFoodNeed(boundary), null, "exactly at the ratio line is NOT low (>=)");
  const low = settlement("s0", 0, 2, 2, { population: 400, food: 0 });
  assert.equal(settlementFoodNeed(low), 4, "the need refills one full week's requirement");
  const fed = settlement("s0", 0, 2, 2, { population: 400, food: 5 });
  assert.equal(settlementFoodNeed(fed), null);
  const emptyPop = settlement("s0", 0, 2, 2, { population: 0, food: 0 });
  assert.equal(settlementFoodNeed(emptyPop), null, "no population, no food requirement, no recommendation");
});

test("thresholds: settlement gold is low when the garrison's weekly gold bill exceeds weekly income", () => {
  // 5 peasants x 1g = 5g/wk burn; pop 0 x tax 0 = 0 income. Building upkeep
  // (wood/stone) is deliberately NOT part of a gold comparison.
  const garrisoned = settlement("s0", 0, 2, 2, { stacks: stack("peasant", 5) });
  assert.equal(settlementGoldNeed(garrisoned, { peasant }), 5, "burn 5 > income 0; need tops up one week of burn");
  const rich = settlement("s0", 0, 2, 2, { stacks: stack("peasant", 5), gold: 500 });
  assert.equal(settlementGoldNeed(rich, { peasant }), null, "the treasury already covers the burn");
  const ungarrisoned = settlement("s0", 0, 2, 2, {});
  assert.equal(settlementGoldNeed(ungarrisoned, { peasant }), null, "no garrison, no burn, no gold recommendation");
});

test("thresholds: a hero is low when purse + larder cannot cover its army's next weekly bill (the upkeep evaluator itself)", () => {
  const hero = makeHero("h0", 0, 2, 2, {
    troops: 5,
    stacks: stack("peasant", 5),
    gold: 2,
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 3 },
  });
  const needs = heroTradeNeeds(hero, { peasant });
  assert.equal(needs.gold, 3, "5g bill - 2g purse");
  assert.equal(needs.food, 2, "5f bill - 3f larder");
  const covered = makeHero("h0", 0, 2, 2, {
    troops: 5,
    stacks: stack("peasant", 5),
    gold: 5,
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 5 },
  });
  const none = heroTradeNeeds(covered, { peasant });
  assert.equal(none.gold, null);
  assert.equal(none.food, null);
});

function needsWorld(): GameState {
  // Seat 0: s-rich (food surplus + gold) funds; s-low (food) and s-burn
  // (garrison burn) need. Seat 1 owns entities too — they must never appear.
  return makeState({
    players: [
      makePlayer(0, "player", ["h0"], ["s-rich", "s-low", "s-burn"], { wagonsOwned: 10, wagonsUnassigned: 10 }),
      makePlayer(1, "ai", ["h1"], ["s-foreign-low"]),
    ],
    heroes: [
      makeHero("h0", 0, 30, 2, { troops: 0, stacks: [] }),
      makeHero("h1", 1, 40, 2, { troops: 0, stacks: [] }),
    ],
    settlements: [
      settlement("s-rich", 0, 2, 2, { food: 500, gold: 1000 }),
      settlement("s-low", 0, 6, 2, { population: 400, food: 0 }),
      settlement("s-burn", 0, 10, 2, { stacks: stack("peasant", 5) }),
      settlement("s-foreign-low", 1, 20, 2, { population: 400, food: 0 }),
      settlement("s-foreign-rich", 1, 24, 2, { food: 500, gold: 1000 }),
    ],
    day: 1,
  });
}

test("recommends food/gold ONLY, own-seat entities only, with deterministic source picks", () => {
  const recs = evaluateTradeNeeds(needsWorld(), 0, { peasant });
  // Deterministic: settlements in id order (s-burn < s-low), each entity's
  // food rec before its gold rec; sources from s-rich.
  assert.deepEqual(
    recs.map((rec) => [rec.to.id, rec.payload.kind]),
    [
      ["s-burn", "gold"],
      ["s-low", "resource"],
    ],
  );
  for (const rec of recs) {
    assert.equal(rec.from.kind, "settlement");
    assert.equal(rec.from.id, "s-rich", "s-rich is the only surplus source");
    assert.ok(
      rec.payload.kind === "gold" || rec.payload.resource === "food",
      "payloads are food or gold only",
    );
  }
  const goldRec = recs[0];
  assert.equal(goldRec.payload.kind, "gold");
  assert.ok(goldRec.reason.includes("Treasury short"));
  const foodRec = recs[1];
  assert.equal(foodRec.payload.kind === "resource" ? foodRec.payload.resource : "", "food");
  assert.ok(foodRec.reason.includes("Food low"));

  // Seat 1's evaluator sees its own pair, never seat 0's entities.
  const aiRecs = evaluateTradeNeeds(needsWorld(), 1, { peasant });
  assert.deepEqual(aiRecs.map((rec) => rec.to.id), ["s-foreign-low"]);
  assert.equal(aiRecs[0].from.id, "s-foreign-rich");
});

test("wagons: clamped to the unassigned pool, floored at 1, scaled by the per-wagon capacity", () => {
  const state = needsWorld();
  const recs = evaluateTradeNeeds(state, 0, { peasant });
  const foodRec = recs.find((rec) => rec.to.id === "s-low");
  assert.ok(foodRec, "the food recommendation exists");
  assert.equal(foodRec.wagons, 1, "need 4 food = ceil(4/50) = 1 wagon");

  // need 61 -> 2 wagons, pool 10 covers it.
  const bigLow = settlement("s-biglow", 0, 12, 2, { population: 6100, food: 0 });
  const bigState: GameState = {
    ...state,
    settlements: { ...state.settlements, "s-biglow": bigLow },
  };
  const bigRecs = evaluateTradeNeeds(bigState, 0, { peasant });
  assert.equal(bigRecs[0].to.id, "s-biglow");
  assert.equal(bigRecs[0].wagons, 2, "ceil(61/50) = 2");

  // Empty pool -> still a 1-wagon recommendation (documented: visible and
  // honest; the accept path may reject and the AI flow buys first).
  const noPool: GameState = {
    ...state,
    players: state.players.map((p) => (p.id === 0 ? { ...p, wagonsUnassigned: 0, wagonsOwned: 0 } : p)),
  };
  assert.equal(evaluateTradeNeeds(noPool, 0, { peasant }).find((rec) => rec.to.id === "s-low")?.wagons, 1);

  // Pool smaller than the suggestion clamps to the pool.
  const smallPool: GameState = {
    ...state,
    settlements: { ...state.settlements, "s-biglow": settlement("s-biglow", 0, 12, 2, { population: 6100, food: 0 }) },
    players: state.players.map((p) => (p.id === 0 ? { ...p, wagonsUnassigned: 1, wagonsOwned: 1 } : p)),
  };
  assert.equal(evaluateTradeNeeds(smallPool, 0, { peasant })[0].wagons, 1, "min(pool 1, ceil(61/50) 2)");
});

test("skips pairs already connected by a live route with the same payload kind (either direction)", () => {
  const state = needsWorld();
  const connected: GameState = {
    ...state,
    tradeRoutes: [
      makeTradeRoute({
        id: "route0",
        from: { kind: "settlement", id: "s-low" },
        to: { kind: "settlement", id: "s-rich" },
        payload: { kind: "resource", resource: "food" },
        wagons: 1,
      }),
    ],
  };
  const recs = evaluateTradeNeeds(connected, 0, { peasant });
  assert.deepEqual(recs.map((rec) => rec.to.id), ["s-burn"], "the food pair is connected (reversed route counts); the gold pair does not");

  const otherPayload: GameState = {
    ...connected,
    tradeRoutes: [
      makeTradeRoute({
        id: "route0",
        from: { kind: "settlement", id: "s-low" },
        to: { kind: "settlement", id: "s-rich" },
        payload: { kind: "resource", resource: "wood" },
        wagons: 1,
      }),
    ],
  };
  assert.equal(evaluateTradeNeeds(otherPayload, 0, { peasant }).length, 2, "a wood route does not suppress the food recommendation");
});

test("the source never doubles as its own destination", () => {
  // s-both is simultaneously food-low AND the largest gold reserve — it must
  // not recommend a route to itself.
  const state = makeState({
    players: [makePlayer(0, "player", [], ["s-both"], { wagonsOwned: 10, wagonsUnassigned: 10 })],
    heroes: [],
    settlements: [
      settlement("s-both", 0, 2, 2, { population: 400, gold: 1000, stacks: stack("peasant", 5) }),
    ],
    day: 1,
  });
  const recs = evaluateTradeNeeds(state, 0, { peasant });
  for (const rec of recs) {
    assert.ok(
      !(rec.to.kind === "settlement" && rec.to.id === rec.from.id),
      "no self-route",
    );
  }
});

test("caps the list at 5 and is deterministic across runs", () => {
  const settlements = [settlement("s-src", 0, 0, 0, { food: 10_000, gold: 10_000 })];
  for (let i = 0; i < 8; i++) {
    settlements.push(settlement(`s-low${i}`, 0, 2 + i, 2, { population: 400, food: 0 }));
  }
  const state = makeState({
    players: [makePlayer(0, "player", [], ["s-src"], { wagonsOwned: 99, wagonsUnassigned: 99 })],
    heroes: [],
    settlements,
    day: 1,
  });
  const first = evaluateTradeNeeds(state, 0, { peasant });
  const second = evaluateTradeNeeds(state, 0, { peasant });
  assert.equal(TRADE_MAX_RECOMMENDATIONS, 5);
  assert.equal(first.length, TRADE_MAX_RECOMMENDATIONS);
  assert.deepEqual(first, second, "same input, same list");
  assert.deepEqual(
    first.map((rec) => rec.to.id),
    ["s-low0", "s-low1", "s-low2", "s-low3", "s-low4"],
    "id-ordered destinations",
  );
});

test("a seat with no player row or no shortages yields no recommendations", () => {
  assert.deepEqual(evaluateTradeNeeds(needsWorld(), 7, { peasant }), []);
  const allFed = makeState({
    players: [makePlayer(0, "player", [], ["s0"], { wagonsOwned: 5, wagonsUnassigned: 5 })],
    heroes: [makeHero("h0", 0, 2, 2)],
    settlements: [settlement("s0", 0, 2, 2, { food: 100, gold: 1000 })],
    day: 1,
  });
  assert.deepEqual(evaluateTradeNeeds(allFed, 0, { peasant }), []);
});
