import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyEndOfTurn,
  cellMultiplier,
  isProducerKind,
  produceSettlementResources,
  producerBasePerTurn,
  producerResource,
  producerTurnOutput,
} from "@heroes/engine";
import { emptyWarehouse, makeSettlement, makeState } from "../charter/_helpers";

const GOLD_SPOT = { cell: { x: 2, y: 2 }, resource: "gold" as const };
const IRON_SPOT = { cell: { x: 3, y: 3 }, resource: "iron" as const };

test("isProducerKind recognizes the producer buildings", () => {
  assert.equal(isProducerKind("goldMine"), true);
  assert.equal(isProducerKind("woodcutterHut"), true);
  assert.equal(isProducerKind("stoneMine"), true);
  assert.equal(isProducerKind("ironMine"), true);
  assert.equal(isProducerKind("mine"), true);
  assert.equal(isProducerKind("arcaneFont"), true);
  assert.equal(isProducerKind("house"), false);
  assert.equal(isProducerKind("townHall"), false);
});

test("producerResource: dedicated mines are fixed; legacy mine follows the spot under it", () => {
  const spots = [GOLD_SPOT, IRON_SPOT];
  assert.equal(producerResource("stoneMine", spots, 3, 3), "stone");
  assert.equal(producerResource("stoneMine", spots, 2, 2), "stone", "a gold spot does not change a stone mine");
  assert.equal(producerResource("ironMine", spots, 2, 2), "iron");
  assert.equal(producerResource("ironMine", spots, 9, 9), "iron", "an iron mine produces iron off-spot too");
  assert.equal(producerResource("mine", spots, 3, 3), "iron", "legacy mine on an iron spot produces iron");
  assert.equal(producerResource("mine", spots, 2, 2), "stone", "a gold spot does not make a legacy mine produce gold");
  assert.equal(producerResource("mine", spots, 9, 9), "stone", "off-spot legacy mines default to stone");
  assert.equal(producerResource("goldMine", spots, 3, 3), "gold");
  assert.equal(producerResource("woodcutterHut", [], 0, 0), "wood");
  assert.equal(producerResource("arcaneFont", [], 0, 0), "arcane");
});

test("producerBasePerTurn reads the registry: goldMine 40 gold, +3 magnitudes elsewhere", () => {
  assert.equal(producerBasePerTurn("goldMine", 1, "gold"), 40);
  assert.equal(producerBasePerTurn("goldMine", 2, "gold"), 80);
  assert.equal(producerBasePerTurn("woodcutterHut", 1, "wood"), 3);
  assert.equal(producerBasePerTurn("stoneMine", 1, "stone"), 3);
  assert.equal(producerBasePerTurn("ironMine", 1, "iron"), 3);
  assert.equal(producerBasePerTurn("mine", 1, "stone"), 3);
  assert.equal(producerBasePerTurn("mine", 1, "iron"), 3);
  assert.equal(producerBasePerTurn("arcaneFont", 1, "arcane"), 3);
});

test("producerTurnOutput scales the base by the cell multiplier", () => {
  const settlement = { q: 5, r: 5, citySpots: [GOLD_SPOT] };
  const building = { gx: 2, gy: 2, kind: "goldMine" as const, level: 1 };
  const out = producerTurnOutput(building, settlement, 42);
  assert.ok(out);
  const m = cellMultiplier({
    seed: 42,
    q: 5,
    r: 5,
    gx: 2,
    gy: 2,
    resource: "gold",
    spots: [GOLD_SPOT],
  });
  assert.equal(out.multiplier, m);
  assert.equal(out.basePerTurn, 40);
  assert.equal(out.amount, Math.round(40 * m * 100) / 100);
});

test("producerTurnOutput returns null for non-producers", () => {
  const settlement = { q: 5, r: 5, citySpots: [] };
  assert.equal(producerTurnOutput({ gx: 0, gy: 0, kind: "house", level: 1 }, settlement, 1), null);
});

test("producerTurnOutput returns null while the building is under construction", () => {
  const settlement = { q: 5, r: 5, citySpots: [GOLD_SPOT] };
  const constructing = producerTurnOutput(
    { gx: 2, gy: 2, kind: "goldMine", level: 1, construction: { daysRemaining: 3 } },
    settlement,
    42,
  );
  assert.equal(constructing, null, "a building under construction produces nothing");
  assert.notEqual(producerTurnOutput({ gx: 2, gy: 2, kind: "goldMine", level: 1 }, settlement, 42), null);
});

test("produceSettlementResources adds producer outputs to warehouse and treasury", () => {
  const before = cellMultiplier({ seed: 7, q: 2, r: 2, gx: 2, gy: 2, resource: "gold", spots: [GOLD_SPOT] });
  const woodMult = cellMultiplier({ seed: 7, q: 2, r: 2, gx: 4, gy: 4, resource: "wood", spots: [GOLD_SPOT] });
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 100,
    warehouse: emptyWarehouse(),
    citySpots: [GOLD_SPOT],
    buildings: [
      { gx: 2, gy: 2, kind: "goldMine", level: 1 },
      { gx: 4, gy: 4, kind: "woodcutterHut", level: 1 },
    ],
  });
  const [after] = Object.values(produceSettlementResources({ s0: settlement }, 7));
  assert.equal(after.gold, 100 + Math.round(40 * before * 100) / 100);
  assert.equal(after.warehouse.wood, Math.round(3 * woodMult * 100) / 100);
  assert.equal(after.warehouse.food, 0);
});

test("settlements without producers produce only their tile rates, unchanged", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    resourceRates: { wood: 15 },
    warehouse: emptyWarehouse({ wood: 10 }),
    buildings: [{ gx: 0, gy: 0, kind: "house", level: 1 }],
  });
  const [after] = Object.values(produceSettlementResources({ s0: settlement }, 99));
  assert.equal(after.warehouse.wood, 25);
  assert.equal(after.gold, 0);
});

test("EndTurn pays producer gold into the treasury (server tick parity via the same reducer)", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    citySpots: [GOLD_SPOT],
    buildings: [{ gx: 2, gy: 2, kind: "goldMine", level: 1 }],
  });
  const state = makeState({ settlements: [settlement], activePlayerId: 0 });
  const next = applyEndOfTurn(state);
  const expectedGold = Math.round(40 * cellMultiplier({
    seed: 0,
    q: 2,
    r: 2,
    gx: 2,
    gy: 2,
    resource: "gold",
    spots: [GOLD_SPOT],
  }) * 100) / 100;
  assert.equal(next.settlements.s0.gold, expectedGold);
});
