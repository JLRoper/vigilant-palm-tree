import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, SettlementState } from "@heroes/contracts";
import { WAREHOUSE_RESOURCES } from "@heroes/contracts";
import { buildingUpkeepRequired, foodRequired, producerTurnOutput, produceSettlementResources } from "@heroes/engine";
import {
  dailyRateTitle,
  foodBalanceTitle,
  formatDailyRate,
  formatRate,
  populationCapTitle,
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

// F-3 (the round-2 city-view card): one panel cannot print two contradictory
// Food rates. The settlement panel renders the top section's Food row from
// `daily.food` and the warehouse's own Food row by iterating `daily.rows`; the
// two must be the SAME entry, so the construction window -- the one moment a
// producer's rate flips from nothing to its full output -- cannot be rendered
// as two different numbers. The window itself is the honest half: an
// under-construction farm pays the turn nothing, so the rate on screen is the
// population's bill alone (the card's measured -5/day), and the instant the
// farm finishes the same entry becomes its output minus the bill (the card's
// +3.4/day, which is what the next turn paid: round(8.4) - 5 = +3).
test("F-3: the construction window is one entry, and its net is exactly what the turn pays", () => {
  const inFlight = settlement({
    population: 500,
    buildings: [{ ...building("farmField"), construction: { daysRemaining: 2 } }],
  });
  const window = settlementDailyRates(inFlight, SEED);
  const warehouseFood = window.rows.find((r) => r.resource === "food")!;

  assert.equal(
    window.food,
    warehouseFood,
    "the top Food row and the warehouse Food row must be one entry, not two entries that happen to be equal",
  );
  assert.equal(window.food.produced, 0, "an under-construction farm pays the turn nothing");
  assert.equal(window.food.spent, 5, "500 population eats 5/day");
  assert.equal(window.food.net, -5, "so the only honest rate in the window is the bill: -5/day");
  assert.equal(formatDailyRate(window.food.net), formatDailyRate(warehouseFood.net), "one number, both surfaces");

  const finished = settlement({ population: 500, buildings: [building("farmField")] });
  const after = settlementDailyRates(finished, SEED);
  assert.ok(after.food.produced > 0, "the completed farm produces");
  assert.equal(after.food, after.rows.find((r) => r.resource === "food"));
  assert.equal(
    after.food.net,
    Math.round((after.food.produced - 5) * 100) / 100,
    "and the projection is its output minus the bill -- the rate the next turn pays",
  );
  assert.ok(after.food.net > window.food.net, "the window's rate is not the finished rate");
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

  // E1: the loop adds the tile half once and each producer separately, rounding
  // the STOCK after every addition -- so the paid figure is the tile total
  // rounded, plus the rounded output of each producer, never the rounded sum.
  let expected = 10;
  for (const b of s.buildings) {
    const output = producerTurnOutput(b, s, SEED);
    assert.equal(output?.resource, "wood", "fixture premise: a woodcutterHut produces wood");
    expected += Math.round(output?.amount ?? 0);
  }
  assert.equal(wood.produced, expected);
  assert.ok(wood.produced > 10, "a producer must add to the tile rate, not replace it");
});

// E1 (playthrough round 2b): the panel's per-day rate must be the rate the turn
// PAYS. The card measured the Gold hold's rows against the store: panel
// -2.89/day of wood, store -2/day, and the same ~1-unit gap on stone and food
// (panel +15.72/day, store +15). The cause was arithmetic, not intent -- the
// panel summed raw producer fractions and rounded the total while the payment
// loop rounds each addition -- so this pins the panel to the loop's own output
// instead of a re-derived expectation that could drift with it.
test("E1: the rate row is the delta one turn of the production loop actually pays", () => {
  const s = settlement({
    population: 500,
    resourceRates: { wood: 7.11, stone: 24.5, iron: 2.4, food: 20.72 },
    buildings: [building("townHall"), building("woodcutterHut", 1, 0, 0), building("farmField", 1, 2, 0)],
  });
  const daily = settlementDailyRates(s, SEED);
  const before = { ...s.warehouse };
  const after = produceSettlementResources({ s0: s }, SEED, []).s0.warehouse;

  for (const row of daily.rows) {
    assert.equal(
      row.produced,
      after[row.resource] - before[row.resource],
      `${row.resource}: the panel's produced figure is what one turn of produceSettlementResources adds`,
    );
  }
  // The tile halves and the producers round on their own, and the panel reports
  // that arithmetic rather than the sum: 7.11/day of tile wood is 7/day in the
  // store, and the hut's own fraction rounds separately.
  assert.equal(daily.rows.find((r) => r.resource === "wood")!.produced, Math.round(7.11) + Math.round(producerTurnOutput(s.buildings[1], s, SEED)!.amount));
  assert.equal(daily.rows.find((r) => r.resource === "iron")!.produced, 2, "2.4/day of tile iron is 2/day in the store");
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

// C-MINOR-2: the Population row prints the engine's real cap and a tooltip that
// names where the ceiling comes from. Before this the row printed a bare
// population, so a capped town had no way to say why it was not growing.
test("C-MINOR-2: populationCapTitle states the cap, its source, and the verdict", () => {
  const capped = populationCapTitle(500, 500, 500, 0);
  assert.match(capped, /^Population 500 of 500 — 500 from the settlement's level cap/);
  assert.match(capped, /housing inside the main city adds nothing/);
  assert.match(capped, /At the cap: population grows no further until the settlement's level rises or more housing is built in a district\./);

  const withDistrictHousing = populationCapTitle(1680, 1800, 1500, 300);
  assert.match(withDistrictHousing, /^Population 1,680 of 1,800 — 1,500 from the settlement's level cap plus 300 from housing in its districts\./);
  assert.match(withDistrictHousing, /Grows weekly while the warehouse can feed it, and stops at the cap\./);
  assert.doesNotMatch(withDistrictHousing, /At the cap/);

  // The 5,040 neutral castle from the finding: two L1 district farmhouses.
  const castle = populationCapTitle(5040, 5040, 5000, 40);
  assert.match(castle, /^Population 5,040 of 5,040 — 5,000 from the settlement's level cap plus 40/);
  assert.match(castle, /At the cap/);
});
