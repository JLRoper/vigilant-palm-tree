import { test } from "node:test";
import assert from "node:assert/strict";
import type { SettlementState } from "@heroes/contracts";
import { applyEndOfTurnDetailed, foodRequired, runAutoTrade } from "@heroes/engine";
import { makeSettlement, makeState } from "../charter/_helpers";

// Auto-trade must not be able to push a settlement below the food its own
// population needs.
//
// The bug: applyEndOfTurnDetailed runs produce -> runAutoTrade ->
// applyMoraleDecay -> applySettlementConsumption, and morale is evaluated on the
// PRE-consumption settlement. A settlement with a food surplus used to sell all
// of it to a needy sibling, then be scored at 0 food -- foodDeficitRatio 1.0, a
// 100% morale penalty -- for food it grew itself. The starter L1 (+1.4 food per
// turn) walked into that every single turn with no way out.
//
// The fix reserves foodRequired(population) inside runAutoTrade, so only a
// genuine surplus is tradeable. These cases pin both halves: the reservation
// holds, and the feature is still useful.

const HOUSE = { gx: 1, gy: 1, kind: "house", level: 1, style: "classic" };
const TOWER = { gx: 2, gy: 2, kind: "tower", level: 2, style: "classic" };

function settlements(...list: SettlementState[]): Record<string, SettlementState> {
  const out: Record<string, SettlementState> = {};
  for (const s of list) out[s.id] = s;
  return out;
}

function food(g: number): SettlementState["warehouse"] {
  return { wood: 0, stone: 0, iron: 0, arcane: 0, food: g };
}

// A hungry settlement: population 500 => foodRequired 5, no food at all.
function hungry(id: string): SettlementState {
  return makeSettlement(id, 0, 8, 8, { population: 500, goldTax: 0, gold: 0, warehouse: food(0) });
}

test("a settlement holding EXACTLY its food requirement exports nothing", () => {
  const source = makeSettlement("s0", 0, 2, 2, { population: 500, goldTax: 0, gold: 100, warehouse: food(5) });
  assert.equal(foodRequired(source), 5, "fixture must sit exactly on the requirement");

  const result = runAutoTrade(settlements(source, hungry("s1")), 0);

  assert.equal(result.transfers.length, 0);
  assert.equal(result.settlements.s0.warehouse.food, 5);
  assert.equal(result.settlements.s1.warehouse.food, 0);
});

test("a settlement BELOW its own requirement exports nothing even as the only source", () => {
  const source = makeSettlement("s0", 0, 2, 2, { population: 500, goldTax: 0, gold: 100, warehouse: food(3) });

  const result = runAutoTrade(settlements(source, hungry("s1")), 0);

  assert.equal(result.transfers.length, 0, "its whole stock is already spoken for by its own people");
  assert.equal(result.settlements.s0.warehouse.food, 3);
});

test("a settlement ABOVE its food requirement exports exactly the surplus", () => {
  const source = makeSettlement("s0", 0, 2, 2, { population: 500, goldTax: 0, gold: 100, warehouse: food(6.25) });

  const result = runAutoTrade(settlements(source, hungry("s1")), 0);

  assert.equal(result.transfers.length, 1);
  assert.deepEqual(result.transfers[0], {
    fromSettlementId: "s0",
    toSettlementId: "s1",
    resource: "food",
    amount: 1.25,
    goldPaid: 1.25,
  });
  assert.equal(result.settlements.s0.warehouse.food, 5, "the 5 it needs to eat stays put");
  assert.equal(result.settlements.s1.warehouse.food, 1.25);
  assert.equal(result.settlements.s0.gold, 98.75, "the buyer pays the seller for the food");
});

test("a large surplus still feeds a needy sibling in full -- auto-trade stays useful", () => {
  const source = makeSettlement("s0", 0, 2, 2, { population: 500, goldTax: 0, gold: 100, warehouse: food(20) });

  const result = runAutoTrade(settlements(source, hungry("s1")), 0);

  assert.equal(result.transfers.length, 1);
  assert.equal(result.transfers[0].amount, 5, "s1's whole 5-unit deficit");
  assert.equal(result.settlements.s1.warehouse.food, 5);
  assert.equal(result.settlements.s0.warehouse.food, 15, "keeps its own 5 plus the 10 it did not need to sell");
});

test("each source reserves its OWN requirement, and the next source covers the rest", () => {
  // Three 500-population towns: each needs 5 food, and the third is empty. The
  // first has 4 spare, the second another 4 -- so both must donate, and each
  // must be left holding its own 5.
  const bigA = makeSettlement("s0", 0, 2, 2, { population: 500, goldTax: 0, gold: 100, warehouse: food(9) });
  const bigB = makeSettlement("s0b", 0, 3, 3, { population: 500, goldTax: 0, gold: 100, warehouse: food(9) });
  const empty = makeSettlement("s1", 0, 4, 4, { population: 500, goldTax: 0, gold: 0, warehouse: food(0) });

  const result = runAutoTrade(settlements(bigA, bigB, empty), 0);

  assert.equal(result.settlements.s1.warehouse.food, 5, "the empty town's whole 5-unit deficit");
  assert.equal(result.settlements.s0.warehouse.food, 5, "gave its 4 surplus away, kept its 5");
  assert.equal(result.settlements.s0b.warehouse.food, 8, "gave the remaining 1, kept its 5");
  assert.equal(result.transfers.length, 2);
});

test("the reservation does not apply to wood or stone -- those export in full", () => {
  // house L1 + tower L2 cost 3 wood and 2 stone (test/state/economy.test.ts pins
  // that), so a needy settlement with those buildings has a 3-wood deficit.
  const needy = makeSettlement("s1", 0, 4, 4, {
    population: 0,
    goldTax: 0,
    gold: 0,
    buildings: [HOUSE as SettlementState["buildings"][number], TOWER as SettlementState["buildings"][number]],
    warehouse: food(0),
  });
  // Source sits at exactly its food requirement AND has plenty of wood: the food
  // reservation must not make it ineligible as a wood donor.
  const source = makeSettlement("s0", 0, 2, 2, {
    population: 500,
    goldTax: 0,
    gold: 100,
    warehouse: { wood: 40, stone: 40, iron: 0, arcane: 0, food: 5 },
  });

  const result = runAutoTrade(settlements(source, needy), 0);

  assert.equal(result.settlements.s1.warehouse.wood, 3, "the full wood deficit is covered");
  assert.equal(result.settlements.s0.warehouse.wood, 37, "no reservation applies to wood");
  assert.equal(result.settlements.s0.warehouse.food, 5);
});

test("an UNINHABITED settlement holds no food reservation and donates its whole stock", () => {
  // foodRequired is 0 with no population, so nothing is reserved and the depot's
  // full 10 is genuine surplus.
  const depot = makeSettlement("s0", 0, 2, 2, { population: 0, goldTax: 0, gold: 100, warehouse: food(10) });

  const result = runAutoTrade(settlements(depot, hungry("s1")), 0);

  assert.equal(result.transfers.length, 1);
  assert.equal(result.transfers[0].amount, 5, "the hungry town's whole 5-unit deficit");
  assert.equal(result.settlements.s0.warehouse.food, 5, "it has no mouths of its own to feed");
});

test("the death spiral is gone end to end: a surplus producer is scored as fully fed", () => {
  // Before the reservation this exact fixture produced:
  //   producer food 6.25 -> sells all 6.25 -> morale scored at 0 food
  //   -> foodDeficitRatio 1.0 -> 50 - 10 = 40, every turn, forever.
  const producer = makeSettlement("s0", 0, 2, 2, {
    population: 500,
    goldTax: 0,
    gold: 100,
    morale: 50,
    warehouse: food(6.25),
  });
  const state = makeState({ settlements: [producer, hungry("s1")], activePlayerId: 0 });

  const detail = applyEndOfTurnDetailed(state);

  // Morale is evaluated pre-consumption, so the producer is holding its
  // reserved 5 at that moment: fully supplied, so it RECOVERS rather than decays.
  assert.equal(
    detail.state.settlements.s0.morale,
    54,
    "a food producer must never be charged a food-deficit morale penalty for its own surplus",
  );
  assert.equal(detail.state.settlements.s0.warehouse.food, 0, "it kept 5 to eat, then consumed them");
  assert.equal(detail.transfers.length, 1);
  assert.equal(detail.transfers[0].amount, 1.25);
  assert.equal(detail.state.settlements.s0.gold, 98.75, "it was paid for the surplus, not taxed for it");
});

test("a settlement that genuinely cannot feed itself still decays", () => {
  // The reservation must not paper over a real shortfall: a producer yielding
  // less than it eats is still in deficit, and still loses morale.
  const producer = makeSettlement("s0", 0, 2, 2, {
    population: 500,
    goldTax: 0,
    gold: 100,
    morale: 50,
    warehouse: food(2.5),
  });
  const state = makeState({ settlements: [producer, hungry("s1")], activePlayerId: 0 });

  const detail = applyEndOfTurnDetailed(state);

  // (5 - 2.5) / 5 = 0.5 deficit ratio -> 0.5 * 10 = 5 morale lost.
  assert.equal(detail.state.settlements.s0.morale, 45);
  assert.equal(detail.transfers.length, 0, "a starving settlement has nothing to sell");
});