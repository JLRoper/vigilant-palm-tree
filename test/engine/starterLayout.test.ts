import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, CityViewSize, UnitType } from "@heroes/engine";
import {
  CELL_MULTIPLIER_PEAK,
  applyPlaceBuildings,
  buildStarterLayout,
  buildingFootprintFromRegistry,
  buildingSettlementEffects,
  buildingUpkeepRequired,
  demoPlatoonsForPlayer,
  eligibleRecruitSources,
  evaluateTroopUpkeep,
  foodRequiredForPopulation,
  heroFoodPerTurn,
  isProducerKind,
  pickGarrisonRecruitment,
  producerBasePerTurn,
  producerResource,
  recruitUnits,
  STARTER_BASE_FARMS,
  STARTER_BUILDING_KINDS,
  STARTER_BUILDING_LEVEL,
  STARTER_FARM_VARIANCE_HEADROOM,
  STARTER_PRODUCER_KINDS,
  STARTER_STONE_PRODUCER,
  STARTER_TROOP_BUILDING,
  STARTER_WOOD_PRODUCER,
  starterCityOnOpen,
  starterFarmsNeeded,
  UPKEEP_CHARGE_DAYS,
} from "@heroes/engine";
import { makeSettlement, makeState } from "../charter/_helpers";

// The real catalog's upkeep columns, from server/migrations/021_upkeep_shortfall.sql:
// upkeep_gold = tier, upkeep_food = clamp(ceil(tier / 2), 1, 3).
function tierUnit(id: string, tier: number): UnitType {
  return {
    id,
    name: id,
    attack: 1,
    defence: 1,
    health: 1,
    speed: 1,
    description: "",
    advantageType: "infantry",
    specialty: "",
    specialtyPriority: 0,
    upkeepGold: tier,
    upkeepFood: Math.min(3, Math.max(1, Math.ceil(tier / 2))),
    tier,
  } as UnitType;
}

const CATALOG: Record<string, UnitType> = {
  peasant: tierUnit("peasant", 1),
  swordsman: tierUnit("swordsman", 2),
  archer: tierUnit("archer", 4),
  cavalry: tierUnit("cavalry", 5),
  crossbowman: tierUnit("crossbowman", 4),
  griffin: tierUnit("griffin", 8),
};

function countOf(buildings: readonly BuildingDef[], kind: string): number {
  return buildings.filter((b) => b.kind === kind).length;
}

// A new settlement's starting city used to be the dense PROCEDURAL layout
// (cityBuildingGen's denseUrban pattern, ~14 buildings with a free level-2
// town hall, all already constructed, nothing to pay for). It charged roughly
// 24 wood + 14 stone per turn against a 300/300 start -- bankrupt by ~turn 12
// -- and had no producer. These pin the replacement: the explicit minimal
// starter set, free, constructed, and cheap to run.

function cellsOf(b: BuildingDef): string[] {
  const fp = buildingFootprintFromRegistry(b.kind, b.level);
  const w = b.w ?? fp.w;
  const h = b.h ?? fp.h;
  const out: string[] = [];
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) out.push(`${b.gx + dx},${b.gy + dy}`);
  }
  return out;
}

function kindsOf(buildings: readonly BuildingDef[]): string[] {
  return buildings.map((b) => b.kind);
}

test("a previously-empty settlement's free starter commit is townHall + farm + 2 houses + 2 wood producers + stone + farmhouse", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 300,
    warehouse: { wood: 300, stone: 300, iron: 0, arcane: 0, food: 0 },
    buildings: [],
  });
  const state = makeState({ settlements: [settlement] });
  const starter = buildStarterLayout({ size: 5, style: "classic" });

  const result = applyPlaceBuildings(state, "s0", 0, starter, true);

  assert.equal(result.ok, true);
  const after = result.state.settlements.s0;
  assert.deepEqual(kindsOf(after.buildings), [
    "townHall",
    "farmField",
    "house",
    "house",
    STARTER_WOOD_PRODUCER,
    STARTER_STONE_PRODUCER,
    STARTER_WOOD_PRODUCER,
    STARTER_TROOP_BUILDING,
  ]);
  assert.deepEqual(
    after.buildings.map((b) => b.level),
    [1, 1, 1, 1, 1, 1, 1, 1],
    "starter set is level 1 throughout",
  );
  assert.deepEqual(kindsOf(starter), [...STARTER_BUILDING_KINDS]);
  assert.equal(STARTER_BUILDING_LEVEL, 1);
  assert.equal(countOf(after.buildings, "house"), 2);
  assert.equal(countOf(after.buildings, "townHall"), 1);
  assert.equal(countOf(after.buildings, "farmField"), 1);
  assert.equal(countOf(after.buildings, STARTER_WOOD_PRODUCER), 2);
  assert.equal(countOf(after.buildings, STARTER_STONE_PRODUCER), 1);
  assert.equal(countOf(after.buildings, STARTER_TROOP_BUILDING), 1);
});

test("the starter set costs nothing and arrives already constructed", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 300,
    warehouse: { wood: 300, stone: 300, iron: 0, arcane: 0, food: 0 },
    buildings: [],
  });
  const state = makeState({ settlements: [settlement] });
  const result = applyPlaceBuildings(state, "s0", 0, buildStarterLayout({ size: 5, style: "classic" }), true);

  const after = result.state.settlements.s0;
  assert.equal(after.gold, 300, "the starter set is free");
  assert.equal(after.warehouse.wood, 300);
  assert.equal(after.warehouse.stone, 300);
  for (const b of after.buildings) {
    assert.equal(
      "construction" in b,
      false,
      `${b.kind} carries no build timer — the player never paid to build it`,
    );
  }
});

test("the starter set's upkeep is 10 wood + 2 stone per turn -- 30 turns of runway from 300/300", () => {
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 300,
    warehouse: { wood: 300, stone: 300, iron: 0, arcane: 0, food: 0 },
    buildings: [],
  });
  const state = makeState({ settlements: [settlement] });
  const result = applyPlaceBuildings(state, "s0", 0, buildStarterLayout({ size: 5, style: "classic" }), true);

  const upkeep = buildingUpkeepRequired(result.state.settlements.s0);
  // townHall 3w+2s, house 1w x2, woodcutterHut 1w x2, stoneMine 2w, farmField 0+0, farmhouse 1w+0s.
  assert.deepEqual(upkeep, { wood: 10, stone: 2 });
  // The old dense layout's ~24 wood + ~14 stone ran a 300/300 start dry by
  // roughly turn 12. The pre-producer set (5w) stretched that to 60 turns; the
  // three producers cost 4 wood of upkeep and buy 6 wood + 3 stone per turn
  // back, so 30 turns of GUARANTEED runway is the price -- and the map is no
  // longer the only thing keeping a settlement solvent. The second hut (the
  // 2026-10-02 balance fix) spends that +1 wood of upkeep to roughly DOUBLE the
  // effective runway at the median cell: the set's net wood goes -5 -> -3, so
  // 300 wood lasts ~100 turns, not ~60. The farmhouse (2026-10-04) spends one
  // more wood of upkeep on its recruit entry -- 33 guaranteed turns became 30.
  assert.equal(Math.floor(300 / upkeep.wood), 30, "wood covers 30 turns of upkeep even with zero map income");
  assert.equal(Math.floor(300 / upkeep.stone), 150);
});

test("the starter set carries two wood producers and one stone producer", () => {
  const starter = buildStarterLayout({ size: 5, style: "classic" });
  assert.equal(countOf(starter, STARTER_WOOD_PRODUCER), 2, "the wood producer ships twice -- one hut left the set net wood-negative");
  assert.equal(countOf(starter, STARTER_STONE_PRODUCER), 1, "one stone producer");
  for (const kind of new Set(STARTER_PRODUCER_KINDS)) {
    assert.equal(isProducerKind(kind), true, `${kind} is wired as a producer, so it actually produces`);
  }
  assert.equal(producerResource(STARTER_WOOD_PRODUCER, [], 0, 0), "wood");
  assert.equal(producerResource(STARTER_STONE_PRODUCER, [], 0, 0), "stone");
  assert.equal(producerBasePerTurn(STARTER_WOOD_PRODUCER, 1, "wood"), 3);
  assert.equal(producerBasePerTurn(STARTER_STONE_PRODUCER, 1, "stone"), 3);
  assert.equal(producerBasePerTurn("farmhouse", 1, "food"), 2);
  // The troop building doubles as a small food producer, so it shows up in the
  // producing set below -- its point is the peasant recruit entry, not the food.
  assert.equal(isProducerKind(STARTER_TROOP_BUILDING), true);

  // The producers are the cheapest dedicated source for their resource in the
  // registry, and the arithmetic per settlement at the median cell (x1.0):
  //   wood  +6 (two huts) - 2 (hut upkeep) - 2 (mine upkeep) = +2 of the set's 9 upkeep
  //   stone +3 (mine) - 0                                     = +3, pure gain
  // So the two huts cover the producers' own 4 wood of upkeep and 2 of the
  // hall+houses' 5; the remaining -3/turn median drain is what the map's
  // resource tiles exist to cover (measured over 400 seeded games with map
  // rates zeroed: net wood median -3, worst -6.8 -- vs -5 / -7.3 with a single
  // hut, i.e. ~100 turns of runway from 300 wood instead of ~60).
  assert.equal(buildingSettlementEffects(STARTER_WOOD_PRODUCER, 1).resourceYieldBonus?.wood, 3);
  assert.equal(buildingSettlementEffects(STARTER_STONE_PRODUCER, 1).resourceYieldBonus?.stone, 3);
  assert.equal(buildingSettlementEffects("farmField", 1).foodPerTurn, 5, "the farm field is still the food source");
  // Only the farm fields, the three producers, and the farmhouse produce
  // anything at all (the farmhouse's +2 food/turn makes it a producer kind).
  const producing = starter.filter((b) => isProducerKind(b.kind));
  assert.deepEqual(kindsOf(producing), [
    "farmField",
    STARTER_WOOD_PRODUCER,
    STARTER_STONE_PRODUCER,
    STARTER_WOOD_PRODUCER,
    STARTER_TROOP_BUILDING,
  ]);
});

test("the starter set is deterministic: two calls are byte-identical, and it takes no seed", () => {
  const a = buildStarterLayout({ size: 5, style: "classic" });
  const b = buildStarterLayout({ size: 5, style: "classic" });
  assert.deepEqual(a, b);
  // No RNG: the same settlement always starts as the same little farmstead, so
  // a replayed/committed starter city is reproducible without a seed.
  assert.deepEqual(a, buildStarterLayout({ size: 5, style: "classic" }));
});

test("the starter set is the explicit 8-building set, not a generated city", () => {
  const starter = buildStarterLayout({ size: 5, style: "classic" });
  assert.equal(starter.length, 8, "a starter town is 8 buildings, not the ~14 denseUrban produced");
  assert.deepEqual(
    [...new Set(kindsOf(starter))].sort(),
    ["farmField", "farmhouse", "house", "stoneMine", "townHall", "woodcutterHut"],
    "no market/smithy/tower/mine/granary — only the town hall, a farm, two houses, two wood producers, one stone producer, and the farmhouse",
  );
  assert.equal(
    starter.find((b) => b.kind === "townHall")?.level,
    1,
    "a free level-2 town hall would unlock settlement upgrades on turn 0",
  );
});

test("the town hall is 2x2 over the centre cell on every city size", () => {
  for (const size of [5, 10, 15] as CityViewSize[]) {
    const starter = buildStarterLayout({ size, style: "classic" });
    const hall = starter.find((b) => b.kind === "townHall");
    assert.ok(hall, `townHall present at size ${size}`);
    assert.deepEqual(
      buildingFootprintFromRegistry(hall.kind, hall.level),
      { w: 2, h: 2 },
      "level-1 town hall is the 2x2 registry footprint (the 1.5x1.5 override is level-2 only)",
    );
    const center = Math.floor(size / 2);
    assert.equal(hall.gx, center, "anchored on the centre cell the placer reserves");
    assert.equal(hall.gy, center);
    assert.equal(cellsOf(hall).length, 4);
  }
});

test("the starter set is legal on every city size: in bounds, nothing overlapping", () => {
  for (const size of [5, 10, 15] as CityViewSize[]) {
    const starter = buildStarterLayout({ size, style: "classic" });
    const seen = new Set<string>();
    for (const b of starter) {
      const cells = cellsOf(b);
      assert.ok(cells.length > 0, `${b.kind} occupies at least one cell at size ${size}`);
      for (const cell of cells) {
        const [gx, gy] = cell.split(",").map(Number);
        assert.ok(gx >= 0 && gy >= 0 && gx < size && gy < size, `${b.kind} cell ${cell} is inside the ${size}x${size} grid`);
        assert.equal(seen.has(cell), false, `${b.kind} overlaps an existing building at ${cell} (size ${size})`);
        seen.add(cell);
      }
    }
    // The farm field is the only other 2x2, and it must clear the town hall --
    // the old dense layout's carveGuaranteedClear2x2 existed for exactly this.
    const hall = starter.find((b) => b.kind === "townHall");
    const field = starter.find((b) => b.kind === "farmField");
    assert.ok(hall && field);
    assert.equal(cellsOf(field).length, 4);
    for (const cell of cellsOf(field)) {
      assert.equal(cellsOf(hall).includes(cell), false, `farm field at ${cell} collides with the town hall`);
    }
    // The placer refuses to remove whatever covers the centre cell, so only
    // the town hall may sit there.
    const center = `${Math.floor(size / 2)},${Math.floor(size / 2)}`;
    const onCenter = starter.filter((b) => cellsOf(b).includes(center)).map((b) => b.kind);
    assert.deepEqual(onCenter, ["townHall"], "the town hall alone owns the reserved centre cell");
  }
});

test("the starter set is style-stamped but otherwise seed-free", () => {
  const organic = buildStarterLayout({ size: 5, style: "organic" });
  assert.deepEqual(
    organic.map((b) => b.style),
    ["organic", "organic", "organic", "organic", "organic", "organic", "organic", "organic"],
  );
  assert.deepEqual(
    organic.map(({ style: _style, ...rest }) => rest),
    buildStarterLayout({ size: 5, style: "classic" }).map(({ style: _s, ...rest }) => rest),
    "only the visual style varies with the caller's style",
  );
});

// A settlement's farm count is sized against ITS OWN food bill -- its
// population, plus the weekly bill of the starting hero standing on it (the
// keep, for seat 0), because hero/upkeep.ts's under-hero rule draws that bill
// out of exactly this settlement's warehouse. The whole-owner pool this used to
// size (keep + town + heroes through one host city) died with the instant
// auto-trade teleport it existed to feed (lobby.legacyAutoTrade false for new
// games, 2026-10-02): no settlement can borrow a sibling's surplus anymore, so
// each city's farmland covers its own mouths.
//
// `heroFoodPerTurn` is the engine's own evaluateTroopUpkeep bill spread over
// the charge interval. Where the bill is computed (init.ts's
// seedStarterBuildings) and whether it actually covers on real seeds
// (init.test.ts / foodProduction.test.ts) are both tested there; this file owns
// the layout and the count itself.

test("starterFarmsNeeded takes a FOOD BILL (food/turn), not a population", () => {
  assert.equal(starterFarmsNeeded(0), STARTER_BASE_FARMS);
  assert.equal(starterFarmsNeeded(5), STARTER_BASE_FARMS, "5 food/turn is fed by the base single farm at peak");
  assert.equal(starterFarmsNeeded(15), 4, "15 food/turn -> 4 farms (3 cover it 51% of seeds, 4 in 98%)");
  assert.equal(starterFarmsNeeded(20), 5, "the 1-player keep+town bill alone: 5 + 15 = 20 food/turn");
  assert.equal(starterFarmsNeeded(50), 11, "a neutral 5000-population castle eats 50 food/turn");
  assert.equal(STARTER_FARM_VARIANCE_HEADROOM, 1, "one farm of variance headroom, as measured");

  // The bill is summed per settlement, never ceil of a summed population (two
  // settlements of 60 each eat 2, not 1) -- which is why the caller passes one
  // settlement's bill at a time and the engine never sums populations itself.
  assert.equal(foodRequiredForPopulation(60) + foodRequiredForPopulation(60), 2, "ceil(120/100) would under-count this as 1");

  // Sufficiency, derived rather than hardcoded: whatever the count, the peak
  // output must cover the requirement for every population the game creates.
  const perFarm = buildingSettlementEffects("farmField", STARTER_BUILDING_LEVEL).foodPerTurn ?? 0;
  assert.ok(perFarm > 0, "a farm field produces food at all");
  for (const population of [0, 1, 100, 500, 1000, 1500, 2500, 5000, 12345]) {
    const required = foodRequiredForPopulation(population);
    const farms = starterFarmsNeeded(required);
    assert.ok(farms >= STARTER_BASE_FARMS, `population ${population} must keep at least the base farm`);
    assert.ok(
      farms * perFarm >= required,
      `population ${population}: ${farms} farms x ${perFarm} must cover ${required} food/turn at peak`,
    );
  }
});

test("heroFoodPerTurn is the engine's own weekly bill, spread over the charge interval", () => {
  const stacks = demoPlatoonsForPlayer(0);
  // Pinned against evaluateTroopUpkeep itself rather than a literal, so a change
  // to the catalog's upkeep_gold/upkeep_food (or to the demo army) moves this
  // expectation instead of quietly invalidating the sizing.
  const bill = evaluateTroopUpkeep(stacks, CATALOG, 0, 0);

  assert.equal(bill.costFood, 40, "12 swordsman x1 + 8 archer x2 + 4 cavalry x3 food");
  assert.equal(
    heroFoodPerTurn(stacks, CATALOG),
    bill.costFood / UPKEEP_CHARGE_DAYS,
    "farms produce per turn; the charge lands once every UPKEEP_CHARGE_DAYS turns",
  );
  assert.equal(
    heroFoodPerTurn(stacks, CATALOG),
    40 / 7,
    "40 food/week is ~5.71 food/turn of extra demand on the owner's farm pool",
  );
  // The bill is a pure function of the stacks: the available purse/larder only
  // decide `unfed`, so the sizing call cannot depend on one.
  assert.equal(heroFoodPerTurn(stacks, CATALOG), heroFoodPerTurn(stacks, CATALOG));
  assert.equal(heroFoodPerTurn([], CATALOG), 0, "an army-less owner adds nothing");
  // The catalog-less fallback is units.ts's flat 1g/1f per troop: 24, not 40.
  assert.equal(heroFoodPerTurn(stacks, {}), 24 / 7);
});

test("the hero bill is INCLUDED in the starter farm count", () => {
  const stacks = demoPlatoonsForPlayer(0);
  const populationBill = foodRequiredForPopulation(500);
  const heroBill = heroFoodPerTurn(stacks, CATALOG);
  const combined = populationBill + heroBill;

  // The counterfactual this pins: the sizing used to be derived from the
  // population term alone, which is what left the keep short from the FIRST
  // weekly charge (day 7) on 2 of 6 measured seeds.
  assert.equal(starterFarmsNeeded(populationBill), 1, "the keep's population bill alone");
  assert.equal(starterFarmsNeeded(combined), 4, "population + the hero's 40/week bills 4 farms");
  assert.ok(
    starterFarmsNeeded(combined) > starterFarmsNeeded(populationBill),
    "adding the hero's food bill must change the count -- this is the bug",
  );

  // Sufficiency at the peak, derived: whatever the count, the peak output covers
  // the WHOLE bill, population and hero together.
  const perFarm = (buildingSettlementEffects("farmField", STARTER_BUILDING_LEVEL).foodPerTurn ?? 0) * CELL_MULTIPLIER_PEAK;
  assert.ok(perFarm > 0);
  assert.ok(
    starterFarmsNeeded(combined) * perFarm >= combined,
    `${starterFarmsNeeded(combined)} farms x ${perFarm} must cover ${combined} food/turn at peak`,
  );

  // The ask is 4 but the keep's 5x5 grid holds at most three 2x2 farms beside
  // the 2x2 town hall: the placer honours the count and silently clamps at
  // capacity (init.test.ts pins the resulting 3, foodProduction.test.ts
  // measures the coverage of the clamped count over real seeds).
  const keep = buildStarterLayout({ size: 5, style: "classic", farms: starterFarmsNeeded(combined) });
  assert.equal(countOf(keep, "farmField"), 3, "5x5 capacity: 25 cells - 4 town hall - 2 houses - 3 producers - 1 farmhouse");
  assert.equal(countOf(keep, "townHall"), 1);
  assert.equal(countOf(keep, STARTER_WOOD_PRODUCER), 2, "the clamp never displaces a producer");
  assert.equal(countOf(keep, STARTER_STONE_PRODUCER), 1);
  assert.equal(countOf(keep, "house"), 2);

  // A grid that CAN host the ask places it in full (an AI seat's hero spawns on
  // a 15x15 castle; the same math must not clamp there).
  const castle = buildStarterLayout({ size: 15, style: "classic", farms: starterFarmsNeeded(50 + heroBill) });
  assert.equal(countOf(castle, "farmField"), starterFarmsNeeded(50 + heroBill));
});

test("the default farm count is the historical one, so the level-1 starter set is byte-identical", () => {
  assert.deepEqual(buildStarterLayout({ size: 5, style: "classic" }), buildStarterLayout({ size: 5, style: "classic", farms: 1 }));
  assert.deepEqual(buildStarterLayout({ size: 5, style: "classic", farms: 0 }), buildStarterLayout({ size: 5, style: "classic" }));
  assert.deepEqual(buildStarterLayout({ size: 5, style: "classic", farms: -3 }), buildStarterLayout({ size: 5, style: "classic" }));
  assert.deepEqual(kindsOf(buildStarterLayout({ size: 5, style: "classic" })), [...STARTER_BUILDING_KINDS]);
});

test("a food-hungry settlement's set is town hall + its farms + the same two houses + the producers + the troop building", () => {
  const farms = starterFarmsNeeded(20);
  const set = buildStarterLayout({ size: 10, style: "classic", farms });
  assert.equal(countOf(set, "townHall"), 1, "the town hall matters: an already-seeded settlement skips the free commit");
  assert.equal(countOf(set, "farmField"), farms);
  assert.equal(countOf(set, "house"), 2);
  assert.deepEqual(kindsOf(set), [
    "townHall",
    ...Array.from({ length: farms }, () => "farmField"),
    "house",
    "house",
    ...STARTER_PRODUCER_KINDS,
    STARTER_TROOP_BUILDING,
  ]);
});

test("a multi-farm set is legal, deterministic, and costs no upkeep beyond the base set's", () => {
  for (const size of [5, 10, 15] as CityViewSize[]) {
    for (const farms of [1, 2, 4, 5, 6, 7, 11, 12]) {
      const set = buildStarterLayout({ size, style: "classic", farms });
      assert.deepEqual(set, buildStarterLayout({ size, style: "classic", farms }), `size ${size} farms ${farms} is deterministic`);
      const seen = new Set<string>();
      for (const b of set) {
        for (const cell of cellsOf(b)) {
          const [gx, gy] = cell.split(",").map(Number);
          assert.ok(gx >= 0 && gy >= 0 && gx < size && gy < size, `${b.kind} cell ${cell} inside the ${size}x${size} grid (farms ${farms})`);
          assert.equal(seen.has(cell), false, `${b.kind} overlaps at ${cell} (size ${size}, farms ${farms})`);
          seen.add(cell);
        }
      }
      // The placer refuses to remove whatever covers the centre cell.
      const center = `${Math.floor(size / 2)},${Math.floor(size / 2)}`;
      assert.deepEqual(
        set.filter((b) => cellsOf(b).includes(center)).map((b) => b.kind),
        ["townHall"],
        `the town hall alone owns the reserved centre cell (size ${size}, farms ${farms})`,
      );
      // Producers are placed LAST, so a farm count that overruns the named ring
      // can only ever displace a producer -- and a 5x5 holds at most 3 farm
      // fields, so the producers must still be there at every count.
      assert.equal(countOf(set, STARTER_WOOD_PRODUCER), 2, `both woodcutterHuts survive size ${size} farms ${farms}`);
      assert.equal(countOf(set, STARTER_STONE_PRODUCER), 1, `stoneMine survives size ${size} farms ${farms}`);
      assert.equal(countOf(set, "house"), 2, `both houses survive size ${size} farms ${farms}`);
      assert.equal(countOf(set, "townHall"), 1, `the town hall survives size ${size} farms ${farms}`);
      assert.equal(countOf(set, STARTER_TROOP_BUILDING), 1, `the farmhouse survives size ${size} farms ${farms} (1x1 fits at every combination)`);
    }
  }
  // farmField upkeep is 0 wood / 0 stone, so extra farmland is free to run.
  const upkeep = makeSettlement("s0", 0, 2, 2, { buildings: buildStarterLayout({ size: 10, style: "classic", farms: 5 }) });
  assert.deepEqual(buildingUpkeepRequired(upkeep), { wood: 10, stone: 2 }, "5 farms cost the same upkeep as 1");
});

test("every settlement the game can create gets ALL the farms its food requirement asks for", () => {
  // A farm that does not fit degrades to "next free cell" and, past the last
  // free cell, is dropped -- so the count has to be checked against the
  // (level -> population, level -> grid size) pairs the game actually creates,
  // which is what init.ts builds from.
  for (const [level, size, population] of [
    [1, 5, 500],
    [2, 10, 1500],
    [3, 15, 5000],
  ] as const) {
    const farms = starterFarmsNeeded(foodRequiredForPopulation(population));
    const set = buildStarterLayout({ size, style: "classic", farms });
    assert.equal(
      countOf(set, "farmField"),
      farms,
      `level ${level} (${size}x${size}, population ${population}) asked for ${farms} farms on a grid that cannot hold them`,
    );
  }
});

test("starterCityOnOpen: an empty settlement gets the free set, one with buildings gets its own back untouched", () => {
  for (const existing of [undefined, []]) {
    const onOpen = starterCityOnOpen({ size: 5, style: "classic", existing });
    assert.equal(onOpen.free, true, "no buildings -> the free starter commit");
    assert.deepEqual(kindsOf(onOpen.buildings), [...STARTER_BUILDING_KINDS]);
  }

  // The seeded level-2 town: it arrives WITH its buildings, so opening its
  // city must hand them straight back and must NOT commit a second city.
  const seeded = buildStarterLayout({ size: 10, style: "classic", farms: starterFarmsNeeded(20) });
  const onOpen = starterCityOnOpen({ size: 10, style: "classic", existing: seeded });
  assert.equal(onOpen.free, false, "already-seeded: nothing is free-committed on open");
  assert.equal(onOpen.buildings, seeded, "the settlement's own buildings, by identity");

  // A player-built city is likewise never free-committed.
  const built: BuildingDef[] = [{ gx: 1, gy: 1, kind: "house", level: 1, style: "classic" }];
  const builtOpen = starterCityOnOpen({ size: 5, style: "classic", existing: built });
  assert.equal(builtOpen.free, false);
  assert.equal(builtOpen.buildings, built);
});

test("the starter city can recruit garrison troops from turn 0", () => {
  const starter = buildStarterLayout({ size: 5, style: "classic" });
  const settlement = makeSettlement("s0", 0, 2, 2, {
    gold: 300,
    warehouse: { wood: 300, stone: 300, iron: 0, arcane: 0, food: 0 },
    buildings: starter,
  });
  const state = makeState({ settlements: [settlement] });

  for (const b of state.settlements.s0.buildings) {
    assert.equal("construction" in b, false, `${b.kind} arrives constructed, so the eligibility gate passes immediately`);
  }

  const gx = starter.find((b) => b.kind === STARTER_TROOP_BUILDING)?.gx;
  const gy = starter.find((b) => b.kind === STARTER_TROOP_BUILDING)?.gy;
  assert.ok(gx !== undefined && gy !== undefined, "the starter set carries the troop building");

  const sources = eligibleRecruitSources(state.settlements.s0);
  assert.equal(sources.length, 1, "the farmhouse is the starter set's only recruit source");
  assert.equal(sources[0].buildingKind, "farmhouse");
  assert.equal(sources[0].gx, gx);
  assert.equal(sources[0].gy, gy);
  assert.equal(sources[0].entry.unitTypeId, "peasant");
  assert.equal(sources[0].entry.goldCost, 25);
  assert.equal(sources[0].entry.minLevel ?? 1, 1);

  const recruited = recruitUnits(state, {
    settlementId: "s0",
    buildingKind: "farmhouse",
    gx,
    gy,
    unitTypeId: "peasant",
    count: 5,
  });
  assert.equal(recruited.ok, true, "a fresh settlement recruits peasants from its farmhouse");
  const after = recruited.state.settlements.s0;
  const peasantCount = (after.stacks ?? []).reduce(
    (total, platoon) => total + platoon.entries.filter((e) => e.unitTypeId === "peasant").reduce((n, e) => n + e.count, 0),
    0,
  );
  assert.equal(peasantCount, 5, "the garrison holds the 5 recruited peasants");
  assert.equal(after.gold, 175, "5 peasants at 25g each debits 300 -> 175");

  // The AI garrison planner shops from the same gate: a settlement with no
  // hero on it gets a purchase through the farmhouse. No hero anywhere (the
  // default fixture spawns one on s0, which would make the planner skip it);
  // with the tier-1 catalog, power-per-peasant is 2, so the planner's floor
  // target of 4 power asks for at least two peasants.
  const aiState = makeState({ settlements: [settlement], heroes: [] });
  const purchases = pickGarrisonRecruitment(aiState, 0, CATALOG);
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].buildingKind, "farmhouse");
  assert.equal(purchases[0].unitTypeId, "peasant");
  assert.equal(purchases[0].gx, gx);
  assert.equal(purchases[0].gy, gy);
  assert.ok(purchases[0].count >= 1, "the planner buys at least one peasant through the farmhouse");
});
