import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameState, HeroState, SettlementState, UnitType } from "@heroes/contracts";
import {
  GameMap,
  advanceRound,
  applyEndOfTurnDetailed,
  applySuppliedHeroUpkeep,
  applyWeeklyUpkeep,
  buildInitialGameState,
  endTurn,
  evaluateTroopUpkeep,
  MORALE_UNPAID_LOSS_MAX,
  mulberry32,
  platoonTroopTotal,
  type HeroUpkeepOptions,
} from "@heroes/engine";
import { makeHero, makeSettlement, makeState } from "../charter/_helpers";

// ── The bug this file pins ────────────────────────────────────────────────
// The starting hero's weekly food bill was charged against a wagon larder that
// starts at 0 (engine init.ts) and that nothing in a default game ever fills --
// the only writer is a manual "unload at a settlement" action. So every charge
// was fully unfed: 25 morale per week from the first one (day 7), morale 0 by
// day 28, troops deserting from turn 22, byte-identically on every seed. The
// fix: a hero standing on one of its OWN settlements draws that bill out of its
// owner's warehouses (hero/upkeep.ts's applySuppliedHeroUpkeep).

// The real catalog's upkeep numbers for the demo platoon, from
// server/migrations/021_upkeep_shortfall.sql: upkeep_gold = tier,
// upkeep_food = clamp(ceil(tier / 2), 1, 3).
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
  };
}

const CATALOG: Record<string, UnitType> = {
  peasant: tierUnit("peasant", 1),
  swordsman: tierUnit("swordsman", 2),
  archer: tierUnit("archer", 4),
  cavalry: tierUnit("cavalry", 5),
  crossbowman: tierUnit("crossbowman", 4),
  griffin: tierUnit("griffin", 8),
};

const OPTIONS: HeroUpkeepOptions = { unitTypes: CATALOG, round: 1, castleSeed: 7 };

/** The starting army: 12 swordsman (2g/1f) + 8 archer (4g/2f) + 4 cavalry (5g/3f) = 76 gold / 40 food. */
function demoStacks(): HeroState["stacks"] {
  return [
    { entries: [{ unitTypeId: "swordsman", count: 12 }] },
    { entries: [{ unitTypeId: "archer", count: 8 }] },
    { entries: [{ unitTypeId: "cavalry", count: 4 }] },
  ];
}

function heroAt(q: number, r: number, opts: Partial<HeroState> = {}): HeroState {
  const stacks = demoStacks();
  return {
    ...makeHero("h0", 0, q, r, {
      gold: 300,
      stacks,
      troops: platoonTroopTotal(stacks),
      morale: 100,
      upkeepUnpaidSinceDay: null,
    }),
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
    ...opts,
  };
}

function settlementWith(id: string, ownerId: 0 | 1 | null, q: number, r: number, food: number): SettlementState {
  return makeSettlement(id, ownerId, q, r, {
    warehouse: { wood: 0, stone: 0, iron: 0, arcane: 0, food },
  });
}

interface Charge {
  hero: HeroState;
  settlements: Record<string, SettlementState>;
  /** Food that left the settlements, derived from the before/after warehouses. */
  foodDrawn: number;
}

function charge(hero: HeroState, settlements: Record<string, SettlementState>, day = 7): Charge {
  const result = applySuppliedHeroUpkeep({ [hero.id]: hero }, settlements, { ...OPTIONS, day });
  let foodDrawn = 0;
  for (const [id, after] of Object.entries(result.settlements)) {
    foodDrawn += (settlements[id]?.warehouse.food ?? 0) - (after.warehouse.food ?? 0);
  }
  return { hero: result.heroes[hero.id], settlements: result.settlements, foodDrawn };
}

test("a hero standing on its own settlement's tile is fed from that settlement's warehouse", () => {
  const hero = heroAt(2, 2);
  const unfunded = evaluateTroopUpkeep(hero.stacks, CATALOG, hero.gold, 0);
  assert.equal(unfunded.costFood, 40, "the demo army's weekly food bill");
  assert.equal(unfunded.unfed, 24, "with an empty larder every troop is unfed -- the bug");

  const home = { s0: settlementWith("s0", 0, 2, 2, 60) };
  const { hero: after, foodDrawn } = charge(hero, home);

  assert.equal(foodDrawn, 40, "the settlement pays exactly the bill, no more");
  assert.equal(after.upkeepUnpaidSinceDay, null, "a funded charge clears the shortfall");
  assert.equal(after.upkeepUnpaidTroops, 0);
  assert.equal(after.upkeepUnpaidGold, 0);
  assert.equal(after.morale, 100, "a funded charge never touches morale");
  assert.equal(after.gold, 300 - 76, "the purse still pays the gold half of the bill");
  assert.equal(after.resources?.food, 0, "settlement-funded food is eaten, not stockpiled in the wagon");
  assert.equal(after.troops, 24, "nobody deserts a paid charge");
  assert.equal(home.s0.warehouse.food, 60, "the input record is never mutated");
});

test("a hero with NO settlement at its hex gets no food, does not crash, and starves as before", () => {
  const hero = heroAt(9, 9);
  // A settlement on another tile, owned by the hero's own seat: still no food.
  const settlements = { s0: settlementWith("s0", 0, 2, 2, 500) };
  const { hero: after, foodDrawn, settlements: afterSettlements } = charge(hero, settlements);

  assert.equal(foodDrawn, 0, "food never travels to an army in the field");
  assert.equal(afterSettlements.s0.warehouse.food, 500, "the settlement keeps every unit");
  assert.equal(after.upkeepUnpaidSinceDay, 7, "the streak starts on the charge day");
  assert.equal(after.upkeepUnpaidTroops, 24);
  assert.equal(after.morale, 100 - MORALE_UNPAID_LOSS_MAX);
  assert.deepEqual(afterSettlements.s0, settlements.s0, "an untouched settlement comes back unchanged");
});

test("no settlement at all (the field-only entry point) is the same charge as before", () => {
  const { hero: after } = charge(heroAt(9, 9), {});
  assert.equal(after.upkeepUnpaidSinceDay, 7);
  assert.equal(after.upkeepUnpaidTroops, 24);
  assert.equal(after.morale, 100 - MORALE_UNPAID_LOSS_MAX);
  assert.equal(after.gold, 300 - 76);
});

test("an enemy or NEUTRAL town under the hero funds nothing", () => {
  const enemy = charge(heroAt(2, 2), { s1: settlementWith("s1", 1, 2, 2, 500) });
  assert.equal(enemy.foodDrawn, 0, "another seat's warehouse is not this hero's larder");
  assert.equal(enemy.hero.upkeepUnpaidSinceDay, 7);

  const neutral = charge(heroAt(2, 2), { sn: settlementWith("sn", null, 2, 2, 500) });
  assert.equal(neutral.foodDrawn, 0, "a neutral is nobody's bill (turn/endTurn.ts, economy/trade.ts)");
  assert.equal(neutral.hero.upkeepUnpaidSinceDay, 7);
});

test("the pool is the OWNER's, not one settlement's: the keep has nothing and the town pays", () => {
  // The default 1-player game's shape, measured: the hero stands on the L1 keep,
  // whose warehouse is empty at every weekly tick because auto-trade tops it up
  // to exactly foodRequired and the same turn's consumption spends it. The
  // 5-farm L2 town of the same owner holds the season's surplus. A per-settlement
  // draw would leave a 40-food bill ~97% unfunded and the spiral intact.
  const settlements = {
    keep: settlementWith("keep", 0, 4, 7, 0),
    town: settlementWith("town", 0, 17, 4, 144),
  };
  const { hero: after, settlements: afterSettlements, foodDrawn } = charge(heroAt(4, 7), settlements);

  assert.equal(foodDrawn, 40);
  assert.equal(afterSettlements.town.warehouse.food, 104, "the town paid, out of its own surplus");
  assert.equal(afterSettlements.keep.warehouse.food, 0, "the empty keep is untouched");
  assert.equal(after.upkeepUnpaidSinceDay, null);
  assert.equal(after.morale, 100);
});

test("the settlement under the hero is drawn first", () => {
  const { settlements: afterSettlements } = charge(heroAt(2, 2), {
    aaa: settlementWith("aaa", 0, 9, 9, 100),
    zzz: settlementWith("zzz", 0, 2, 2, 100),
  });
  assert.equal(afterSettlements.zzz.warehouse.food, 60, "the town it is standing on pays first");
  assert.equal(afterSettlements.aaa.warehouse.food, 100, "the far town is only a fallback");
});

test("a short warehouse feeds what it has and the hero takes the morale penalty for the rest", () => {
  const hero = heroAt(2, 2);
  // 30 food buys the 12 swordsmen (12) and all 8 archers (16) with 2 left over,
  // which is not a cavalry's 3 -- so the 4 cavalry go unfed at 5 gold each.
  const { hero: after, settlements: afterSettlements } = charge(hero, {
    s0: settlementWith("s0", 0, 2, 2, 30),
  });
  const expected = evaluateTroopUpkeep(hero.stacks, CATALOG, after.gold, 30);
  assert.equal(expected.unfed, 4, "the 4 cavalry the warehouse could not feed");
  assert.equal(expected.unfedCostGold, 20);
  assert.equal(afterSettlements.s0.warehouse.food, 0, "the warehouse is emptied, not partially billed");
  assert.equal(after.upkeepUnpaidSinceDay, 7);
  assert.equal(after.upkeepUnpaidTroops, 4);
  assert.equal(after.upkeepUnpaidGold, 20);
  assert.equal(after.morale, 100 - 7, "round(25 * 20/76)");
  assert.equal(after.troops, 24, "the two-charge grace still holds");
});

test("an empty warehouse is not free food: the hero pays the full penalty", () => {
  const { hero: after, foodDrawn } = charge(heroAt(2, 2), { s0: settlementWith("s0", 0, 2, 2, 0) });
  assert.equal(foodDrawn, 0);
  assert.equal(after.upkeepUnpaidSinceDay, 7);
  assert.equal(after.upkeepUnpaidTroops, 24);
  assert.equal(after.upkeepUnpaidGold, 76);
  assert.equal(after.morale, 100 - MORALE_UNPAID_LOSS_MAX);
});

test("the larder pays first; the pool only covers what is left of the bill", () => {
  const hero = heroAt(2, 2, {
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 30 },
  });
  const { hero: after, settlements: afterSettlements, foodDrawn } = charge(hero, {
    s0: settlementWith("s0", 0, 2, 2, 500),
  });
  assert.equal(foodDrawn, 10, "only the last 10 of the 40-food bill comes from the town");
  assert.equal(afterSettlements.s0.warehouse.food, 490);
  assert.equal(after.resources?.food, 0);
  assert.equal(after.upkeepUnpaidSinceDay, null);
});

test("a full larder means the settlement is never touched", () => {
  const hero = heroAt(2, 2, {
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 200 },
  });
  const { foodDrawn, settlements: afterSettlements } = charge(hero, {
    s0: settlementWith("s0", 0, 2, 2, 500),
  });
  assert.equal(foodDrawn, 0);
  assert.equal(afterSettlements.s0.warehouse.food, 500);
});

test("two heroes on one settlement share one warehouse, not two copies of it", () => {
  const a = heroAt(2, 2);
  const b = { ...heroAt(2, 2), id: "h1" as HeroState["id"] };
  const result = applySuppliedHeroUpkeep({ h0: a, h1: b }, { s0: settlementWith("s0", 0, 2, 2, 50) }, {
    ...OPTIONS,
    day: 7,
  });

  assert.equal(result.settlements.s0.warehouse.food, 0, "50 food is not 100: the stock is finite");
  assert.equal(result.draws.length, 2);
  assert.equal(result.draws[0].food, 40, "the first hero takes the whole bill");
  assert.equal(result.draws[1].food, 10, "the second takes what is left of its own 40");
  // 10 food buys 10 of the 12 1-food swordsmen: 14 unfed, 4 cavalry + 8 archers
  // + 2 swordsmen = 56 gold of deficit, round(25 * 56/76) = 18 morale.
  assert.equal(result.heroes.h0.upkeepUnpaidSinceDay, null, "the funded one is fed");
  assert.equal(result.heroes.h0.morale, 100);
  assert.equal(result.heroes.h1.upkeepUnpaidSinceDay, 7, "the second is left short and says so");
  assert.equal(result.heroes.h1.upkeepUnpaidTroops, 14);
  assert.equal(result.heroes.h1.upkeepUnpaidGold, 56);
  assert.equal(result.heroes.h1.morale, 82);
});

test("the charge is deterministic: the same inputs replay identically", () => {
  const hero = heroAt(2, 2);
  const settlements = { s0: settlementWith("s0", 0, 2, 2, 47) };
  assert.deepEqual(charge(hero, settlements), charge(hero, settlements));
});

// ── The regression: a default 1-player game must not starve its hero ──────

function defaultGame(seed: number): GameState {
  return buildInitialGameState(new GameMap(seed, "small"), mulberry32(seed), {
    castleSeed: seed,
    enemyCount: 0,
    humanSeatCount: 1,
    // The real POST /games path prices the starter farmland against the catalog
    // too (server/routes.ts reads unit_types and passes BuildInitialOptions.unitTypes),
    // so the seeded farm pool already covers 20 population + 40/7 hero food/turn.
    unitTypes: CATALOG,
  });
}

interface ChargeTrace {
  day: number;
  /** The owner's whole food stock at the instant the charge ran. */
  pool: number;
  unpaidTroops: number;
  unpaidSinceDay: number | null;
  morale: number;
  troops: number;
  gold: number;
}

/**
 * 24 turns of a default 1-player game with no player action, composed exactly
 * the way server/app/turnService.ts's runEndTurn does -- but with the
 * end-of-turn pass and the day tick split apart, so the stock the weekly charge
 * sees is observable.
 */
function playDefaultGame(seed: number): ChargeTrace[] {
  let state = defaultGame(seed);
  const heroId = state.players[0].heroIds[0];
  const traces: ChargeTrace[] = [];
  for (let turn = 0; turn < 24; turn++) {
    const phase = endTurn(applyEndOfTurnDetailed(state).state);
    if (phase.phase.kind !== "ROUND_END") {
      state = phase;
      continue;
    }
    const pool = Object.values(phase.settlements)
      .filter((s) => s.ownerId === 0)
      .reduce((total, s) => total + (s.warehouse.food ?? 0), 0);
    state = advanceRound(phase, 0.1, null, CATALOG);
    if (state.day % 7 !== 0) continue;
    const hero = state.heroes[heroId];
    traces.push({
      day: state.day,
      pool,
      unpaidTroops: hero.upkeepUnpaidTroops,
      unpaidSinceDay: hero.upkeepUnpaidSinceDay,
      morale: hero.morale,
      troops: hero.troops,
      gold: hero.gold,
    });
  }
  return traces;
}

const DEFAULT_GAME_SEEDS = [1000, 8919, 16838, 24757, 32676, 40595, 48514, 56433, 64352, 72271];

test("REGRESSION: the default 1-player hero is paid up through 3 weekly charges on 10 of 10 seeds", () => {
  // Before the fix every one of these seeds read
  //   day 7/14/21 -> morale 75/50/25, upkeepUnpaidSinceDay 7, troops deserting
  // from turn 22, byte-identically. The hero's larder starts empty and nothing
  // in a default game ever filled it.
  //
  // 9 of 10 once the settlement-funded draw landed; 10 of 10 since the starter
  // farm pool was sized against the hero's 40-food weekly bill as well as the
  // 20/turn population one (starterLayout's heroFoodPerTurn). The shortfall
  // branch below stays as the penalty-shape guard for a future regression.
  let funded = 0;
  const shortfalls: string[] = [];
  for (const seed of DEFAULT_GAME_SEEDS) {
    const traces = playDefaultGame(seed);
    assert.equal(traces.length, 3, `seed ${seed}: 24 turns is 3 weekly charges`);
    assert.deepEqual(
      traces.map((t) => t.day),
      [7, 14, 21],
      `seed ${seed}: the charges land on the day-7 cadence`,
    );
    if (traces.every((t) => t.unpaidSinceDay === null && t.morale === 100 && t.troops === 24)) {
      funded++;
      assert.deepEqual(
        traces.map((t) => t.gold),
        [224, 148, 72],
        `seed ${seed}: the purse paid 76 gold per charge`,
      );
    } else {
      // Not a spiral, a bounded shortfall. The penalty must stay proportional to
      // what the pool genuinely could not cover.
      shortfalls.push(seed.toString());
      for (const t of traces) {
        const affordable = evaluateTroopUpkeep(demoStacks(), CATALOG, 300, t.pool);
        assert.equal(t.unpaidTroops, affordable.unfed, `seed ${seed} day ${t.day}: charged more than the pool lacked`);
        assert.ok(t.morale >= 85, `seed ${seed} day ${t.day}: morale ${t.morale} is the old spiral`);
      }
    }
  }
  assert.equal(funded, 10, `only ${funded}/10 default games kept the hero paid up (short on: ${shortfalls.join(", ")})`);
});

test("REGRESSION: the pool draw is exactly what the hero's bill needed, no more", () => {
  // One seed, three charges, the warehouse read at each one: 40 food a week
  // leaves the settlements' pool, and the hero's larder stays empty (the food
  // is eaten, never banked in a wagon where the player could hoard it).
  let state = defaultGame(1000);
  const heroId = state.players[0].heroIds[0];
  const pools: number[] = [];
  for (let turn = 0; turn < 24; turn++) {
    const phase = endTurn(applyEndOfTurnDetailed(state).state);
    if (phase.phase.kind !== "ROUND_END") {
      state = phase;
      continue;
    }
    const before = Object.values(phase.settlements)
      .filter((s) => s.ownerId === 0)
      .reduce((total, s) => total + (s.warehouse.food ?? 0), 0);
    state = advanceRound(phase, 0.1, null, CATALOG);
    if (state.day % 7 !== 0) continue;
    const after = Object.values(state.settlements)
      .filter((s) => s.ownerId === 0)
      .reduce((total, s) => total + (s.warehouse.food ?? 0), 0);
    assert.equal(before - after, 40, `day ${state.day}: exactly the bill left the pool`);
    assert.equal(state.heroes[heroId].resources?.food, 0, "settlement-funded food is eaten on the spot");
    pools.push(before);
  }
  assert.deepEqual(
    pools,
    [126, 233, 340],
    "the pool grows as the farms out-produce the population AND the hero's weekly bill",
  );
});

test("REGRESSION COUNTERFACTUAL: with no pool (the old rule) the same seeds spiral as reported", () => {
  // Proves the tests above measure the fix and not a passing-by-accident state.
  // Same game, same bill, larder-only funding: 25 morale a week from day 7.
  let state = defaultGame(1000);
  const heroId = state.players[0].heroIds[0];
  const charged: { day: number; morale: number; unpaidSince: number | null }[] = [];
  for (const day of [7, 14, 21]) {
    const result = applySuppliedHeroUpkeep(state.heroes, {}, {
      unitTypes: CATALOG,
      day,
      round: state.round,
      castleSeed: state.castleSeed,
    });
    state = { ...state, heroes: result.heroes };
    const hero = state.heroes[heroId];
    charged.push({ day, morale: hero.morale, unpaidSince: hero.upkeepUnpaidSinceDay });
  }
  assert.deepEqual(charged, [
    { day: 7, morale: 75, unpaidSince: 7 },
    { day: 14, morale: 50, unpaidSince: 7 },
    { day: 21, morale: 25, unpaidSince: 7 },
  ]);
});

test("applyWeeklyUpkeep is the same charge end to end (the server's day-7 path)", () => {
  let state = defaultGame(1000);
  const heroId = state.players[0].heroIds[0];
  const ownerFood = (s: GameState): number =>
    Object.values(s.settlements)
      .filter((x) => x.ownerId === 0)
      .reduce((total, x) => total + (x.warehouse.food ?? 0), 0);
  // Play the real pipeline (production + consumption, then the day tick) up to
  // the day before the first weekly charge.
  for (let turn = 0; turn < 5 && state.day < 6; turn++) {
    const phase = endTurn(applyEndOfTurnDetailed(state).state);
    state = phase.phase.kind === "ROUND_END" ? advanceRound(phase, 0.1, null, CATALOG) : phase;
  }
  assert.equal(state.day, 6, "no weekly charge has run yet");
  assert.equal(state.heroes[heroId].gold, 300);
  assert.equal(state.heroes[heroId].upkeepUnpaidSinceDay, null);
  const pool = ownerFood(state);
  assert.ok(pool >= 40, `the owner's pool (${pool}) must cover the 40-food bill`);

  // The weekly pass itself -- what the server's advanceRound calls on day 7.
  const charged = applyWeeklyUpkeep(state, 0.1, CATALOG);
  assert.equal(charged.heroes[heroId].gold, 300 - 76, "the purse paid the gold half");
  assert.equal(charged.heroes[heroId].upkeepUnpaidSinceDay, null);
  assert.equal(charged.heroes[heroId].upkeepUnpaidTroops, 0);
  assert.equal(charged.heroes[heroId].morale, 100);
  assert.equal(charged.heroes[heroId].troops, 24);
  assert.equal(pool - ownerFood(charged), 40, "40 food left the settlements' warehouses");
});

test("a garrison at the same settlement is charged from what is left after the heroes", () => {
  // Shared-pool contention, pinned so it cannot drift silently: the hero's bill
  // is charged first (turn/round.ts's existing composition order), and the
  // garrison then takes the remainder. 50 food - 40 for the hero leaves 10 of
  // the garrison's 12 peasants: a 2-troop shortfall, not a wiped garrison.
  const settlement: SettlementState = {
    ...settlementWith("s0", 0, 2, 2, 50),
    gold: 300,
    stacks: [{ entries: [{ unitTypeId: "peasant", count: 12 }] }],
  };
  const state = makeState({ heroes: [heroAt(2, 2)], settlements: [settlement], day: 7 });
  const charged = applyWeeklyUpkeep(state, 0.1, CATALOG);
  assert.equal(charged.settlements.s0.warehouse.food, 0);
  assert.equal(charged.heroes.h0.upkeepUnpaidSinceDay, null, "the hero was funded first");
  assert.equal(charged.settlements.s0.garrisonUnpaidSinceDay, 7, "the garrison got only the 10 food that was left");
  assert.equal(charged.settlements.s0.garrisonUnpaidTroops, 2);
  assert.equal(charged.settlements.s0.garrisonUnpaidGold, 2);
});

test("a settlement with no garrison and no hero standing on it is returned untouched", () => {
  const state = makeState({
    heroes: [heroAt(9, 9)],
    settlements: [settlementWith("s0", 0, 2, 2, 12)],
    day: 7,
  });
  const charged = applyWeeklyUpkeep(state, 0.1, CATALOG);
  assert.equal(charged.settlements.s0.warehouse.food, 12, "food does not travel to the field");
  assert.equal(charged.heroes.h0.upkeepUnpaidSinceDay, 7);
});