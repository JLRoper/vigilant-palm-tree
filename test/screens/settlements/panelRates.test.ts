import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, SettlementState } from "@heroes/contracts";
import { WAREHOUSE_RESOURCES } from "@heroes/contracts";
import { buildingUpkeepRequired, foodRequired, producerTurnOutput } from "@heroes/engine";
import {
  dailyRateTitle,
  foodBalanceTitle,
  formatDailyRate,
  formatRate,
  resourceLabel,
  settlementDailyRates,
} from "../../../src/screens/settlements/panelRates";

// Self-contained fixtures, matching treasuryCap.test.ts: the rates model only
// needs the settlement fields the production loop itself reads
// (resourceRates/buildings/q/r/citySpots/warehouse/population/level), so a
// shared builder is not worth the coupling.

const SEED = 12345;

function building(kind: BuildingDef["kind"], level = 1, gx = 0, gy = 0): BuildingDef {
  return { gx, gy, kind, level, style: "classic" };
}

function settlement(overrides: Partial<SettlementState> = {}): SettlementState {
  return {
    id: "s0",
    name: "Blackrock Hold",
    ownerId: 0,
    q: 3,
    r: 3,
    level: 1,
    population: 500,
    goldTax: 1,
    resourceRates: {},
    foundedOnResource: null,
    gold: 300,
    warehouse: { wood: 300, stone: 300, iron: 300, arcane: 300, food: 0 },
    citySpots: [],
    cityMines: [],
    morale: 100,
    garrisonUnpaidSinceDay: null,
    garrisonUnpaidTroops: 0,
    garrisonUnpaidGold: 0,
    autoTrade: false,
    castleVariant: 0,
    buildings: [],
    ...overrides,
  };
}

test("one row per warehouse resource, in warehouse order, carrying the live stock", () => {
  const s = settlement({ warehouse: { wood: 12, stone: 34, iron: 56, arcane: 78, food: 90 } });
  const { rows } = settlementDailyRates(s, SEED);
  assert.deepEqual(rows.map((r) => r.resource), [...WAREHOUSE_RESOURCES]);
  assert.deepEqual(rows.map((r) => r.stock), [12, 34, 56, 78, 90]);
});

test("the top food row is the same entry as the warehouse's food row", () => {
  const s = settlement({ warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 42 } });
  const daily = settlementDailyRates(s, SEED);
  assert.deepEqual(daily.food, daily.rows.find((r) => r.resource === "food"));
  assert.equal(daily.food.stock, 42);
});

test("production is the production loop's own number: tile rates plus every producer building", () => {
  const s = settlement({
    resourceRates: { wood: 10 },
    buildings: [building("woodcutterHut"), building("woodcutterHut", 1, 2, 2)],
  });
  const { rows } = settlementDailyRates(s, SEED);
  const wood = rows.find((r) => r.resource === "wood")!;

  let expected = 10;
  for (const b of s.buildings) {
    const output = producerTurnOutput(b, s, SEED);
    assert.equal(output?.resource, "wood", "fixture premise: a woodcutterHut produces wood");
    expected += output?.amount ?? 0;
  }
  assert.equal(wood.produced, Math.round(expected * 100) / 100);
  assert.ok(wood.produced > 10, "a producer must add to the tile rate, not replace it");
});

test("a building under construction produces nothing, exactly as the turn loop pays nothing", () => {
  const built = settlement({ resourceRates: { wood: 4 }, buildings: [building("woodcutterHut")] });
  const inFlight = settlement({
    resourceRates: { wood: 4 },
    buildings: [{ ...building("woodcutterHut"), construction: { daysRemaining: 2 } }],
  });
  const builtWood = settlementDailyRates(built, SEED).rows[0];
  const flightWood = settlementDailyRates(inFlight, SEED).rows[0];
  assert.equal(flightWood.produced, 4, "only the tile rate");
  assert.ok(builtWood.produced > flightWood.produced);
});

test("wood and stone are charged the settlement's building upkeep, so a starter city reads as a drain", () => {
  // The starter set's own bill: townHall 3 wood / 2 stone, house 1 wood each.
  const s = settlement({
    buildings: [building("townHall"), building("house"), building("house")],
  });
  const upkeep = buildingUpkeepRequired(s);
  assert.deepEqual(upkeep, { wood: 5, stone: 2 }, "fixture premise");

  const { rows } = settlementDailyRates(s, SEED);
  const wood = rows.find((r) => r.resource === "wood")!;
  const stone = rows.find((r) => r.resource === "stone")!;
  assert.equal(wood.spent, 5);
  assert.equal(stone.spent, 2);
  assert.equal(wood.net, Math.round((wood.produced - 5) * 100) / 100);
  assert.ok(wood.net < 0, "no producers: the wood stock is draining");
  assert.ok(stone.net < 0, "no producers: the stone stock is draining");
});

test("food is charged to the population, and its net is production minus the mouths", () => {
  const s = settlement({ population: 500, buildings: [building("farmField")] });
  assert.equal(foodRequired(s), 5, "500 population eats 5/day");
  const food = settlementDailyRates(s, SEED).food;
  assert.equal(food.spent, 5);
  assert.equal(food.net, Math.round((food.produced - 5) * 100) / 100);
});

test("a population that out-eats its farms reports a negative food rate", () => {
  // 5,000 population eats 50/day; one farmField cannot cover that.
  const s = settlement({ population: 5000, buildings: [building("farmField")] });
  const food = settlementDailyRates(s, SEED).food;
  assert.ok(food.produced > 0, "the farm is producing");
  assert.ok(food.net < 0, `expected a deficit, got ${food.net}`);
});

test("a neutral pays no bill: the consumption step skips it, so its rows are pure production", () => {
  const owned = settlement({
    ownerId: 0,
    population: 500,
    buildings: [building("townHall"), building("farmField")],
  });
  const neutral = settlement({
    ownerId: null,
    population: 500,
    buildings: [building("townHall"), building("farmField")],
  });
  const ownedRates = settlementDailyRates(owned, SEED);
  const neutralRates = settlementDailyRates(neutral, SEED);

  for (const row of neutralRates.rows) assert.equal(row.spent, 0, `${row.resource} charged a neutral`);
  assert.equal(neutralRates.food.spent, 0, "a neutral never eats");
  assert.equal(neutralRates.food.net, neutralRates.food.produced);
  assert.equal(ownedRates.food.spent, 5, "an owned settlement eats its population's bill");
  assert.equal(ownedRates.rows[0].spent, 3, "and pays the town hall's 3 wood upkeep");
});

test("iron and arcane have no sink, so their net is their production", () => {
  const s = settlement({
    resourceRates: { iron: 6, arcane: 3 },
    buildings: [building("townHall"), building("house")],
  });
  const { rows } = settlementDailyRates(s, SEED);
  for (const resource of ["iron", "arcane"] as const) {
    const row = rows.find((r) => r.resource === resource)!;
    assert.equal(row.spent, 0);
    assert.equal(row.net, row.produced);
  }
});

test("districts pool into their parent settlement, the same as the turn loop", () => {
  const plain = settlement({ resourceRates: { wood: 2 } });
  const withDistrict = settlement({
    resourceRates: { wood: 2 },
    districts: {
      "4,4": {
        q: 4,
        r: 4,
        buildings: [building("woodcutterHut", 1, 1, 1)],
        citySpots: [],
      },
    } as unknown as SettlementState["districts"],
  });
  const plainWood = settlementDailyRates(plain, SEED).rows[0];
  const districtWood = settlementDailyRates(withDistrict, SEED).rows[0];
  assert.ok(
    districtWood.produced > plainWood.produced,
    "a district producer must reach the parent's rate row",
  );
});

test("a zero-rate resource reads +0/day rather than a blank or a dash", () => {
  const { rows } = settlementDailyRates(settlement(), SEED);
  assert.equal(formatDailyRate(rows[0].net), "+0/day");
});

test("rates carry their sign, and fractions are trimmed rather than padded", () => {
  assert.equal(formatDailyRate(3), "+3/day");
  assert.equal(formatDailyRate(-4), "-4/day");
  assert.equal(formatDailyRate(0), "+0/day");
  assert.equal(formatDailyRate(2.5), "+2.5/day");
  assert.equal(formatDailyRate(-0.25), "-0.25/day");
  assert.equal(formatDailyRate(0.001), "+0/day", "sub-hundredth noise is not a rate");
  assert.equal(formatRate(2.5), "2.5");
  assert.equal(formatRate(3), "3");
});

test("labels are title-cased from the resource id", () => {
  assert.equal(resourceLabel("wood"), "Wood");
  assert.equal(resourceLabel("arcane"), "Arcane");
  assert.equal(resourceLabel("food"), "Food");
});

test("a warehouse row's tooltip names what makes it, what spends it, and the balance", () => {
  const s = settlement({ buildings: [building("townHall")] });
  const wood = settlementDailyRates(s, SEED).rows.find((r) => r.resource === "wood")!;
  const title = dailyRateTitle(wood);
  assert.match(title, /Wood stock 300\./);
  assert.match(title, /3\/day spent on building upkeep\./);
  assert.match(title, /Net -3\/day\./);
  assert.ok(!title.includes("produced by tile rates"), "no producer, no production clause");
});

test("an inert resource says so instead of reading as a 0/day mystery", () => {
  const { rows } = settlementDailyRates(settlement(), SEED);
  const arcane = rows.find((r) => r.resource === "arcane")!;
  assert.equal(arcane.net, 0);
  assert.match(dailyRateTitle(arcane), /Nothing is produced or spent per day\./);
});

test("the food tooltip answers 'made vs eaten' in one unit and then the verdict", () => {
  const surplus = settlement({ population: 500, buildings: [building("farmField"), building("farmField")] });
  const foodRow = settlementDailyRates(surplus, SEED).food;
  const good = foodBalanceTitle(foodRow, surplus.population);
  assert.match(good, /^Food stock 0: .*\/day made by farms and tile rates, 5\/day eaten by 500 population — net /);
  assert.match(good, /accumulates in the warehouse/);

  const deficit = settlement({ population: 5000, buildings: [building("farmField")] });
  const short = settlementDailyRates(deficit, SEED).food;
  const bad = foodBalanceTitle(short, deficit.population);
  assert.match(bad, /50\/day eaten by 5,000 population/);
  assert.match(bad, /running a deficit/);

  const balanced = { resource: "food", stock: 10, produced: 5, spent: 5, net: 0 } as const;
  assert.match(foodBalanceTitle(balanced, 500), /exactly matches what the population eats/);
});

test("the same inputs give the same numbers twice (the panel is not a moving target)", () => {
  const s = settlement({ resourceRates: { wood: 10, stone: 4 }, buildings: [building("woodcutterHut")] });
  assert.deepEqual(settlementDailyRates(s, SEED), settlementDailyRates(s, SEED));
});
