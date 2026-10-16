import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, SettlementState } from "@heroes/contracts";
import { producerTurnOutput, settlementProductionRates } from "@heroes/engine";

// U1 (logistics-interface-fixes plan §5.8): the rates line a settlement panel
// shows must be the COMBINED production picture — warehouseRates() tile rates
// plus the producerTurnOutput() building half — not the tile-only half.

const SEED = 1234;

function settlement(overrides: Partial<SettlementState> = {}): SettlementState {
  return {
    id: "s0",
    name: "s0",
    ownerId: 0,
    q: 3,
    r: 3,
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
    garrisonUnpaidSinceDay: null,
    garrisonUnpaidTroops: 0,
    garrisonUnpaidGold: 0,
    autoTrade: true,
    castleVariant: 0,
    buildings: [],
    ...overrides,
  };
}

function building(kind: BuildingDef["kind"], gx = 0, gy = 0, level = 1): BuildingDef {
  return { gx, gy, kind, level, style: "classic" };
}

test("settlementProductionRates: empty settlement produces nothing", () => {
  assert.deepEqual(settlementProductionRates(settlement(), SEED), { rates: [], goldPerTurn: 0 });
});

test("settlementProductionRates: tile-only rates pass through unchanged", () => {
  const s = settlement({ resourceRates: { wood: 2, food: 3 } });
  assert.deepEqual(settlementProductionRates(s, SEED), {
    rates: [
      { resource: "wood", perTurn: 2 },
      { resource: "food", perTurn: 3 },
    ],
    goldPerTurn: 0,
  });
});

test("settlementProductionRates: building producers merge into the tile rates", () => {
  const woodcutter = building("woodcutterHut", 1, 0);
  const farm = building("farmField", 0, 1);
  const s = settlement({
    resourceRates: { wood: 2 },
    buildings: [woodcutter, farm],
  });
  const woodOutput = producerTurnOutput(woodcutter, s, SEED);
  const foodOutput = producerTurnOutput(farm, s, SEED);
  assert.ok(woodOutput && woodOutput.resource === "wood" && woodOutput.amount > 0);
  assert.ok(foodOutput && foodOutput.resource === "food" && foodOutput.amount > 0);

  const result = settlementProductionRates(s, SEED);
  assert.deepEqual(result.rates, [
    { resource: "wood", perTurn: Math.round((2 + woodOutput.amount) * 100) / 100 },
    { resource: "food", perTurn: Math.round(foodOutput.amount * 100) / 100 },
  ]);
  assert.equal(result.goldPerTurn, 0);
});

test("settlementProductionRates: gold producers surface separately and the tile map's gold entry never leaks into the rates", () => {
  const mine = building("goldMine", 2, 0);
  const s = settlement({
    // resourceRates carries gold for settlements founded near gold tiles, but
    // gold is not a warehouse resource and the production loop never pays it.
    resourceRates: { gold: 5, wood: 1 },
    buildings: [mine],
  });
  const goldOutput = producerTurnOutput(mine, s, SEED);
  assert.ok(goldOutput && goldOutput.resource === "gold" && goldOutput.amount > 0);

  const result = settlementProductionRates(s, SEED);
  assert.deepEqual(
    result.rates.map((r) => r.resource),
    ["wood"],
    "the unpaid tile gold entry must not appear as a warehouse rate",
  );
  assert.equal(result.goldPerTurn, Math.round(goldOutput.amount * 100) / 100);
});

test("settlementProductionRates: in-construction buildings contribute nothing", () => {
  const underConstruction: BuildingDef = { ...building("farmField", 0, 1), construction: { daysRemaining: 2 } };
  const s = settlement({ buildings: [underConstruction] });
  assert.deepEqual(settlementProductionRates(s, SEED), { rates: [], goldPerTurn: 0 });
});

test("settlementProductionRates: rates stay in warehouse-resource order regardless of building order", () => {
  const farm = building("farmField", 0, 1);
  const hut = building("woodcutterHut", 1, 0);
  const s = settlement({ resourceRates: { food: 1 }, buildings: [farm, hut] });
  const result = settlementProductionRates(s, SEED);
  assert.deepEqual(
    result.rates.map((r) => r.resource),
    ["wood", "food"],
  );
});
