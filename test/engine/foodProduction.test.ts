import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameState, SettlementState, UnitType } from "@heroes/contracts";
import {
  CELL_MULTIPLIER_PEAK,
  DEFAULT_FOOD_BIAS,
  GameMap,
  RESOURCE_DENSITY,
  RESOURCES,
  applyEndOfTurnDetailed,
  buildInitialGameState,
  buildingSettlementEffects,
  cellMultiplier,
  foodBiasForTerrain,
  foodRequired,
  foodRequiredForPopulation,
  generateCitySpots,
  heroFoodPerTurn,
  isProducerKind,
  mulberry32,
  produceSettlementResources,
  producerBasePerTurn,
  producerResource,
  producerTurnOutput,
  starterFarmsNeeded,
} from "@heroes/engine";
import { emptyWarehouse, makeSettlement } from "../charter/_helpers";

// The real catalog's upkeep columns (same fixture the sizing tests use):
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

const STARTER_CATALOG: Record<string, UnitType> = {
  peasant: tierUnit("peasant", 1),
  swordsman: tierUnit("swordsman", 2),
  archer: tierUnit("archer", 4),
  cavalry: tierUnit("cavalry", 5),
  crossbowman: tierUnit("crossbowman", 4),
  griffin: tierUnit("griffin", 8),
};

// Non-cyclic on purpose: running past the script throws, so every test below
// also pins the rng draw count (one draw per cell attempt + ONE per resource
// pick -- the same order the pre-food generator used).
function scriptedRng(values: readonly number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i];
    i += 1;
    if (v === undefined) throw new Error(`scripted rng exhausted after ${values.length} draws`);
    return v;
  };
}

// Draws for one 5x5 run: (0,1), (2,3), (4,4) -- centre (2,2) avoided, no dupes.
const DEFAULT_SCRIPT = [0.1, 0.2, 0.05, 0.5, 0.6, 0.9, 0.9, 0.95, 0.4] as const;

// Unbounded, reproducible LCG stream (the same generator cityBuildingGen uses)
// for the multi-size and share checks, where the spot count -- and therefore
// the draw count -- depends on the grid.
function sequenceRng(seed = 123456789): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const FOOD_SPOT = { cell: { x: 1, y: 1 }, resource: "food" as const };
const IRON_SPOT = { cell: { x: 2, y: 2 }, resource: "iron" as const };
const GOLD_SPOT = { cell: { x: 3, y: 3 }, resource: "gold" as const };

test("foodBiasForTerrain: green plains rich, barrens barren, impassable tiles zero", () => {
  assert.equal(foodBiasForTerrain("grass"), 0.55);
  assert.equal(foodBiasForTerrain("forest"), 0.32);
  assert.equal(foodBiasForTerrain("dirt"), 0.22);
  assert.equal(foodBiasForTerrain("desert"), 0.05);
  assert.equal(foodBiasForTerrain("mountain"), 0);
  assert.equal(foodBiasForTerrain("water"), 0);
  assert.equal(foodBiasForTerrain("lava"), 0, "unknown terrain has no bias");
  assert.equal(foodBiasForTerrain(""), 0, "a map miss has no bias");
});

test("grass out-biases every other passable terrain", () => {
  for (const terrain of ["forest", "dirt", "desert", "mountain", "water"]) {
    assert.ok(foodBiasForTerrain("grass") > foodBiasForTerrain(terrain), `grass should out-bias ${terrain}`);
  }
});

test("food spots are generated, and the default bias is DEFAULT_FOOD_BIAS", () => {
  assert.equal(DEFAULT_FOOD_BIAS, 0.35);
  const explicit = generateCitySpots(5, scriptedRng(DEFAULT_SCRIPT), { foodBias: DEFAULT_FOOD_BIAS });
  const implicit = generateCitySpots(5, scriptedRng(DEFAULT_SCRIPT));
  assert.deepEqual(implicit, explicit, "omitting opts must use DEFAULT_FOOD_BIAS");
  assert.deepEqual(implicit.spots.map((s) => s.resource), ["food", "arcane", "gold"]);
  assert.ok(implicit.spots.some((s) => s.resource === "food"), "food spots now exist");
});

test("foodBias 1 makes every spot food; foodBias 0 makes none", () => {
  for (const size of [5, 10, 15] as const) {
    const all = generateCitySpots(size, sequenceRng(), { foodBias: 1 });
    assert.ok(all.spots.length > 0, `${size}x${size} still generates spots`);
    assert.ok(all.spots.every((s) => s.resource === "food"), `${size}x${size}: every spot is food`);
  }
  const none = generateCitySpots(5, scriptedRng(DEFAULT_SCRIPT), { foodBias: 0 });
  assert.ok(none.spots.every((s) => s.resource !== "food"), "no food spots at bias 0");
  // bias 0 must reproduce the pre-food uniform pick exactly: floor(roll * 5).
  assert.deepEqual(none.spots.map((s) => s.resource), ["gold", "arcane", "stone"]);
});

test("terrain bias visibly shifts how often food rolls", () => {
  const foodShare = (foodBias: number): number => {
    let food = 0;
    let total = 0;
    for (let g = 0; g < 30; g++) {
      // A fresh seed per city, or all 30 cities would be the identical layout.
      const { spots } = generateCitySpots(5, sequenceRng(1000 + g * 7919), { foodBias });
      food += spots.filter((s) => s.resource === "food").length;
      total += spots.length;
    }
    return food / total;
  };

  const grass = foodShare(foodBiasForTerrain("grass"));
  const desert = foodShare(foodBiasForTerrain("desert"));
  assert.ok(grass > desert + 0.3, `grass (${grass.toFixed(2)}) should far out-bias desert (${desert.toFixed(2)})`);
  assert.ok(grass > 0.3 && grass < 0.8, `grass share ${grass.toFixed(2)} is not near 0.55`);
  assert.ok(desert >= 0 && desert < 0.2, `desert share ${desert.toFixed(2)} is not near 0.05`);
});

test("spot generation stays deterministic for the same rng script", () => {
  const opts = { foodBias: foodBiasForTerrain("grass") };
  const a = generateCitySpots(10, sequenceRng(), opts);
  const b = generateCitySpots(10, sequenceRng(), opts);
  assert.deepEqual(a, b);
  assert.deepEqual(a, generateCitySpots(10, sequenceRng(), opts), "a third run is byte-identical");
  assert.deepEqual(a.mines, [], "no mines are generated");
  a.spots.forEach((spot, i) => {
    assert.equal(spot.vein, `${spot.resource}_vein_${i}`);
  });
  assert.deepEqual(
    generateCitySpots(5, scriptedRng(DEFAULT_SCRIPT), opts),
    generateCitySpots(5, scriptedRng(DEFAULT_SCRIPT), opts),
  );
});

test("the draw budget is unchanged: 2 per cell attempt, 1 per resource pick", () => {
  // 3 spots on an empty 5x5 grid, none retrying -> 3 cells * 2 + 3 resources = 9 draws.
  const spots = generateCitySpots(5, scriptedRng(DEFAULT_SCRIPT));
  assert.equal(spots.spots.length, 3);
  assert.equal(DEFAULT_SCRIPT.length, 9, "the script must not need a 10th draw");
});

test("isProducerKind: the three farm buildings are producers", () => {
  assert.equal(isProducerKind("farmField"), true);
  assert.equal(isProducerKind("farmhouse"), true);
  assert.equal(isProducerKind("granary"), true);
});

test("producerResource: farm kinds are fixed on food, the legacy mine still probes its spot", () => {
  const spots = [FOOD_SPOT, IRON_SPOT, GOLD_SPOT];
  for (const kind of ["farmField", "farmhouse", "granary"] as const) {
    assert.equal(producerResource(kind, spots, 1, 1), "food", `${kind} on a food spot`);
    assert.equal(producerResource(kind, spots, 4, 4), "food", `${kind} off any spot`);
    assert.equal(producerResource(kind, spots, 3, 3), "food", `${kind} on a gold spot still makes food`);
  }
  assert.equal(producerResource("mine", spots, 2, 2), "iron", "legacy mine on an iron spot produces iron");
  assert.equal(producerResource("mine", spots, 3, 3), "stone", "a gold spot does not make a legacy mine produce gold");
  assert.equal(producerResource("mine", spots, 9, 9), "stone", "off-spot legacy mines default to stone");
  assert.equal(producerResource("goldMine", spots, 0, 0), "gold", "the gold branch is untouched");
});

test("producerBasePerTurn reads foodPerTurn from the registry, level-scaled", () => {
  assert.equal(producerBasePerTurn("farmField", 1, "food"), 5);
  assert.equal(producerBasePerTurn("farmField", 2, "food"), 10);
  assert.equal(producerBasePerTurn("farmhouse", 1, "food"), 2);
  assert.equal(producerBasePerTurn("farmhouse", 3, "food"), 6);
  assert.equal(producerBasePerTurn("granary", 1, "food"), 3);
  assert.equal(producerBasePerTurn("granary", 2, "food"), 6);
  // food is not a resourceYieldBonus resource, so a farm asked for wood yields nothing.
  assert.equal(producerBasePerTurn("farmField", 1, "wood"), 0);
  // the non-food producers are unchanged
  assert.equal(producerBasePerTurn("goldMine", 1, "gold"), 40);
  assert.equal(producerBasePerTurn("woodcutterHut", 1, "wood"), 3);
});

test("a farmField on a food spot earns the ~3x spot multiplier, on a plain cell ~1x", () => {
  const seed = 4242;
  const q = 7;
  const r = 3;
  const building = { gx: 1, gy: 1, kind: "farmField" as const, level: 1 };

  const onSpot = producerTurnOutput(building, { q, r, citySpots: [FOOD_SPOT] }, seed);
  const offSpot = producerTurnOutput(building, { q, r, citySpots: [] }, seed);
  assert.ok(onSpot && offSpot);

  assert.equal(onSpot.resource, "food");
  assert.equal(offSpot.resource, "food");
  assert.equal(onSpot.basePerTurn, 5);
  assert.equal(offSpot.basePerTurn, 5);

  const mSpot = cellMultiplier({ seed, q, r, gx: 1, gy: 1, resource: "food", spots: [FOOD_SPOT] });
  const mPlain = cellMultiplier({ seed, q, r, gx: 1, gy: 1, resource: "food", spots: [] });
  assert.equal(onSpot.multiplier, mSpot);
  assert.equal(offSpot.multiplier, mPlain);

  // The hash ignores spots, so the only difference is the peak: 3.0 vs 1.0.
  assert.ok(Math.abs(mSpot - mPlain - 2) <= 0.02, `spot peak should be exactly +2 (got ${mSpot} vs ${mPlain})`);
  assert.ok(mSpot > 2.4 && mSpot < 3.6, `food-spot multiplier ~3 (got ${mSpot})`);
  assert.ok(mPlain > 0.4 && mPlain < 1.6, `plain-cell multiplier ~1 (got ${mPlain})`);

  // Ranges, not hardcoded floats: 5 * ~3 and 5 * ~1.
  assert.ok(onSpot.amount > 12 && onSpot.amount < 18, `farm on food spot yields 5*~3 (got ${onSpot.amount})`);
  assert.ok(offSpot.amount > 2 && offSpot.amount < 8, `farm on plain cell yields 5*~1 (got ${offSpot.amount})`);
  assert.equal(onSpot.amount, Math.round(5 * mSpot * 100) / 100);
  assert.equal(offSpot.amount, Math.round(5 * mPlain * 100) / 100);
});

test("farmhouse and granary produce food too", () => {
  const seed = 99;
  const settlement = { q: 2, r: 4, citySpots: [FOOD_SPOT] };
  const farmhouse = producerTurnOutput({ gx: 1, gy: 1, kind: "farmhouse" as const, level: 1 }, settlement, seed);
  const granary = producerTurnOutput({ gx: 1, gy: 1, kind: "granary" as const, level: 1 }, settlement, seed);
  assert.ok(farmhouse && granary);
  assert.equal(farmhouse.resource, "food");
  assert.equal(granary.resource, "food");
  assert.equal(farmhouse.basePerTurn, 2);
  assert.equal(granary.basePerTurn, 3);
  assert.equal(farmhouse.multiplier, granary.multiplier, "same cell + seed + resource => same multiplier");
  assert.ok(farmhouse.amount > 4 && farmhouse.amount < 8);
  assert.ok(granary.amount > 7 && granary.amount < 12);
});

test("a farm under construction yields nothing", () => {
  const settlement = { q: 2, r: 2, citySpots: [FOOD_SPOT] };
  assert.equal(
    producerTurnOutput({ gx: 1, gy: 1, kind: "farmField" as const, level: 1, construction: { daysRemaining: 1 } }, settlement, 5),
    null,
  );
});

test("produceSettlementResources banks the farm output as food in the warehouse", () => {
  const seed = 7;
  const settlement = makeSettlement("s0", 0, 2, 2, {
    warehouse: emptyWarehouse(),
    citySpots: [FOOD_SPOT],
    buildings: [
      { gx: 1, gy: 1, kind: "farmField", level: 1 },
      { gx: 4, gy: 4, kind: "farmhouse", level: 1 },
    ],
  });
  const [after] = Object.values(produceSettlementResources({ s0: settlement }, seed));
  const onSpot = cellMultiplier({ seed, q: 2, r: 2, gx: 1, gy: 1, resource: "food", spots: [FOOD_SPOT] });
  const offSpot = cellMultiplier({ seed, q: 2, r: 2, gx: 4, gy: 4, resource: "food", spots: [FOOD_SPOT] });
  const expected = Math.round(5 * onSpot * 100) / 100 + Math.round(2 * offSpot * 100) / 100;
  assert.ok(expected > 12 && expected < 22, `expected a farm-sized surplus (got ${expected})`);
  assert.equal(after.warehouse.food, expected);
  assert.equal(after.gold, 0, "food never leaks into the treasury");
});

test("DESIGNER DECISION: food has no map-tile source anywhere", () => {
  assert.ok(RESOURCES.includes("food"), "food is still a first-class resource type");
  for (const [terrain, densities] of Object.entries(RESOURCE_DENSITY)) {
    assert.equal(densities.food, 0, `${terrain} must not place free food tiles`);
  }
});

// A 1-player game creates a level-2 town next to the level-1 keep: population
// 1500 against foodRequired(1500) = 15 food/turn, and a warehouse that starts
// empty. Created with no buildings it produced nothing, and the old instant
// auto-trade regime drained the keep's surplus to cover the gap until both
// towns sat at morale 0 by turn 12. It is now created with the farmland its
// own food bill needs -- and since the teleport's removal (lobby.legacyAutoTrade
// false for new games), that self-sufficiency is the only thing feeding it.

/** 40 distinct seeded games, each a fresh 1-player map. */
function seededTownGames(count = 40): GameState[] {
  const out: GameState[] = [];
  for (let i = 0; i < count; i++) {
    const seed = 1000 + i * 7919;
    out.push(buildInitialGameState(new GameMap(seed, "small"), mulberry32(seed), { castleSeed: seed, enemyCount: 0, humanSeatCount: 1 }));
  }
  return out;
}

/** Food a settlement's own production banks in one turn, before any trade or consumption. */
function foodProduced(settlement: SettlementState, seed: number): number {
  return produceSettlementResources({ [settlement.id]: settlement }, seed)[settlement.id].warehouse.food ?? 0;
}

test("the seeded level-2 town's farms cover its food requirement from the registry", () => {
  const state = seededTownGames(1)[0];
  const town = Object.values(state.settlements).find((s) => s.level === 2);
  assert.ok(town);

  const perFarm = buildingSettlementEffects("farmField", 1).foodPerTurn ?? 0;
  const farms = town.buildings.filter((b) => b.kind === "farmField");
  const required = foodRequired(town);
  assert.equal(required, 15, "population 1500 eats 15 food/turn");
  assert.ok(
    farms.length * perFarm * CELL_MULTIPLIER_PEAK >= required,
    `${farms.length} farms x ${perFarm} x peak must cover ${required}`,
  );
  assert.ok(
    farms.length >= Math.ceil(required / perFarm),
    "never fewer farms than the requirement needs outright",
  );
});

test("turn 1: the level-2 town is fed by its own farms in at least 95% of seeded games", () => {
  // production only -- auto-trade could cover the gap, but that is the bug
  // (it strips the keep's surplus), not a fix.
  const games = seededTownGames(40);
  let fed = 0;
  for (const state of games) {
    const town = Object.values(state.settlements).find((s) => s.level === 2);
    assert.ok(town);
    if (foodProduced(town, state.castleSeed) >= foodRequired(town)) fed++;
  }
  assert.ok(
    fed / games.length >= 0.95,
    `only ${fed}/${games.length} seeded games feed the level-2 town on turn 1`,
  );
});

test("one farm would not have fixed it: the same 40 games run a permanent full deficit", () => {
  // The counterfactual behind the farm count: a single farm's ~5 food/turn
  // against 15 required is the reported collapse, so "start with a farm" alone
  // is not a fix.
  const games = seededTownGames(40);
  let fed = 0;
  for (const state of games) {
    const town = Object.values(state.settlements).find((s) => s.level === 2);
    assert.ok(town);
    const oneFarm = { ...town, buildings: town.buildings.filter((b) => b.kind === "farmField").slice(0, 1) };
    const produced = foodProduced(oneFarm, state.castleSeed);
    if (produced >= foodRequired(town)) fed++;
    assert.ok(produced < foodRequired(town), "a single farm is short of the requirement");
  }
  assert.ok(fed / games.length <= 0.1, `a single farm covered ${fed}/${games.length} games -- the reported bug`);
});

// A 1-player game seats two settlements on the keep+town pair. Instant
// auto-trade used to move surplus between a player's own settlements, which is
// why sizing was pooled into one host city. That teleport is gone for new games
// (lobby.legacyAutoTrade false, 2026-10-02), so sizing is PER SETTLEMENT: each
// city's farmland covers its own bill -- the town its 15/turn population, the
// keep its 5/turn population PLUS the starting hero's weekly bill (the
// under-hero draw rule, hero/upkeep.ts). No settlement can borrow a sibling's
// surplus anymore; the settlement accumulates its own instead.

const BUDGET_GAMES = 1000;

function budgetGames(): GameState[] {
  const out: GameState[] = [];
  for (let i = 0; i < BUDGET_GAMES; i++) {
    const seed = 1000 + i * 7919;
    // The real POST /games path passes the catalog (server/routes.ts), which is
    // what puts the hero's 40/week into the keep's sizing -- same here.
    out.push(buildInitialGameState(new GameMap(seed, "small"), mulberry32(seed), { castleSeed: seed, enemyCount: 0, humanSeatCount: 1, unitTypes: STARTER_CATALOG }));
  }
  return out;
}

/** A settlement's own food bill: its population, plus the hero standing on it (the keep). */
function ownFoodBill(s: SettlementState, state: GameState): number {
  const hero = Object.values(state.heroes).find((h) => h.ownerId === s.ownerId && h.q === s.q && h.r === s.r);
  return foodRequiredForPopulation(s.population) + (hero ? heroFoodPerTurn(hero.stacks, STARTER_CATALOG) : 0);
}

function classOf(s: SettlementState): string {
  return s.ownerId === null ? "neutral-L3" : s.level === 1 ? "keep-L1+hero" : "town-L2";
}

test("every settlement's own farms cover ITS OWN food bill, on real cell multipliers", () => {
  // Per-settlement coverage over 1000 seeded games (the 4000-seed sweep behind
  // the counts measured keep 98.05% / town 98.25% / neutral 90.54%; this 1000-seed
  // subset runs 98.80 / 98.70 / 89.55 -- the assertions sit just under those
  // observed floors so a registry or multiplier change fails loudly instead of
  // drifting).
  const games = budgetGames();
  const stats = new Map<string, { n: number; covered: number; worst: number }>();
  let minMultiplier = Infinity;
  for (const state of games) {
    for (const s of Object.values(state.settlements)) {
      const cls = classOf(s);
      const bill = ownFoodBill(s, state);
      const produced = foodProduced(s, state.castleSeed);
      const rec = stats.get(cls) ?? { n: 0, covered: 0, worst: 0 };
      rec.n++;
      if (produced >= bill) rec.covered++;
      rec.worst = Math.max(rec.worst, bill - produced);
      stats.set(cls, rec);
      for (const b of s.buildings) {
        if (b.kind !== "farmField" || s.level !== 1) continue;
        minMultiplier = Math.min(
          minMultiplier,
          cellMultiplier({ seed: state.castleSeed, q: s.q, r: s.r, gx: b.gx, gy: b.gy, resource: "food", spots: s.citySpots }),
        );
      }
    }
  }
  // Not a best-case-float assertion: the multipliers behind it are the real
  // per-cell draws. The observed floor is far below the 1.0 peak the count is
  // DERIVED from, which is exactly why STARTER_FARM_VARIANCE_HEADROOM exists
  // and why the target is a coverage rate rather than a hard inequality.
  assert.ok(minMultiplier < 0.5, `expected a real spread of multipliers, floor was ${minMultiplier}`);

  // The keep carries the hero term on top of its population and is CLAMPED at
  // 3 farms (a 5x5 grid holds no fourth 2x2 beside the town hall) -- 98.8%
  // coverage with a worst shortfall of 4.06 of its 10.71/turn bill.
  const keep = stats.get("keep-L1+hero");
  assert.ok(keep, "the sweep saw keeps");
  assert.equal(keep.n, BUDGET_GAMES);
  assert.ok(
    keep.covered / keep.n >= 0.98,
    `only ${keep.covered}/${keep.n} seeded keeps cover the 5 + 40/7 bill (worst shortfall ${keep.worst.toFixed(2)})`,
  );
  assert.ok(keep.worst < 5, `worst keep shortfall ${keep.worst.toFixed(2)} is a variance miss, not a collapse`);

  // The town asks for and GETS its full derived count (4 farms for 15/turn).
  const town = stats.get("town-L2");
  assert.ok(town, "the sweep saw towns");
  assert.equal(town.n, BUDGET_GAMES);
  assert.ok(
    town.covered / town.n >= 0.98,
    `only ${town.covered}/${town.n} seeded towns cover their own 15/turn (worst shortfall ${town.worst.toFixed(2)})`,
  );

  // Neutrals never consume and never decay (turn/endTurn.ts's gates), so their
  // bill is NOTIONAL until someone captures them -- the loosest bar, recorded
  // so a regression still shows up.
  const neutral = stats.get("neutral-L3");
  assert.ok(neutral && neutral.n > 0, "the sweep saw neutrals");
  assert.ok(
    neutral.covered / neutral.n >= 0.85,
    `only ${neutral.covered}/${neutral.n} seeded neutrals cover their notional 50/turn`,
  );
});

test("the old POOLED sizing (keep 1 farm, town the whole pool) cannot feed the keep's hero anymore", () => {
  // Counterfactual on the same seeds: restore the pre-2026-10-02 allocation --
  // the whole owner's farm pool concentrated in the town, the keep with the
  // base single farm -- and the keep, which may draw ONLY from its own
  // warehouse now (under-hero rule), is left covering 5 + 40/7 with one farm's
  // ~5.3/turn. The pooling was viable only while auto-trade teleported the
  // town's surplus to the keep every turn; that transport is gone.
  const games = budgetGames();
  let keepCovered = 0;
  for (const state of games) {
    const keep = Object.values(state.settlements).find((s) => s.ownerId === 0 && s.level === 1);
    assert.ok(keep);
    const oneFarmKeep = { ...keep, buildings: keep.buildings.filter((b) => b.kind === "farmField").slice(0, 1) };
    if (foodProduced(oneFarmKeep, state.castleSeed) >= ownFoodBill(keep, state)) keepCovered++;
  }
  assert.ok(
    keepCovered / games.length < 0.1,
    `a single-farm keep covered ${keepCovered}/${games.length} games -- if that reads high the pooled era is back`,
  );
});

test("turn 22: no seed lets any settlement collapse to morale 0 (accumulated surplus is the buffer)", () => {
  // The keep/town farm counts are sized per settlement and every city banks its
  // own surplus between turns -- even a turn-1 shortfall town (worst ratio 0.88)
  // bleeds slowly enough that 22 turns of production + consumption never empty
  // it to a collapse. Measured over these same 1000 seeds: minimum town morale
  // 78, keeps and neutrals untouched at 100.
  const games = budgetGames();
  let collapsed = 0;
  let minTownMorale = 100;
  for (const state of games) {
    let cur = state;
    for (let t = 0; t < 22; t++) cur = applyEndOfTurnDetailed(cur, { legacyAutoTrade: false }).state;
    for (const s of Object.values(cur.settlements)) {
      if (s.ownerId === 0 && s.level === 2) minTownMorale = Math.min(minTownMorale, s.morale ?? 100);
      if ((s.morale ?? 100) <= 0) collapsed++;
    }
  }
  assert.equal(collapsed, 0, `${collapsed}/${games.length} seeded games collapse to morale 0 by turn 22`);
  assert.ok(minTownMorale >= 50, `worst town morale ${minTownMorale} by turn 22 is a collapse in slow motion`);
});