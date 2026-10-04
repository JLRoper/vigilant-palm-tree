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
// the only writer was a manual "unload at a settlement" action. So every charge
// was fully unfed: 25 morale per week from the first one (day 7), morale 0 by
// day 28, troops deserting from turn 22, byte-identically on every seed. The
// fix: a hero standing on one of its OWN settlements draws that bill out of
// THAT settlement's warehouse.
//
// The draw is NARROW since 2026-10-02: larder first, then ONLY the settlement
// under the hero's boots (same hex, same owner). Nothing travels -- the old
// owner-wide pool moved food up to 15+ hexes in a turn, which is exactly the
// teleport this pass removes. The narrow gate is survivable because new games
// run without instant auto-trade (lobby.legacyAutoTrade false): each
// settlement ACCUMULATES its own production surplus instead of being drained
// to exactly foodRequired every turn, so the keep holds real stock at the
// charge (init.ts sizes its farms against its population bill plus the
// starting hero's weekly bill). A hero that marched away from its food is the
// one that goes unfed -- the honest cliff, now the design; the caravan chain
// (economy/tradeNeeds.ts recommender -> route -> caravan -> larder/warehouse)
// is the replacement logistics.

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

test("CLIFF: a hero with no settlement at its hex gets no food, even from its own well-stocked town elsewhere", () => {
  // The narrow rule, pinned from the unhappy side: the owner's town holds 500
  // food eleven hexes away and sends none of it. Nothing travels; the army in
  // the field pays the full penalty (and a caravan route is the designed fix).
  const hero = heroAt(9, 9);
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
  assert.equal(neutral.foodDrawn, 0, "a neutral is nobody's bill (turn/endTurn.ts's consumption gate)");
  assert.equal(neutral.hero.upkeepUnpaidSinceDay, 7);
});

test("CLIFF: the well-stocked distant town is never drawn, even when the town under the hero runs dry", () => {
  // The old rule's centerpiece fixture, inverted: the keep under the hero is
  // empty and the owner's L2 town holds the season's surplus. The pool used to
  // pay from the town; the narrow rule lets the charge go short instead --
  // moving food was the teleport this pass removes.
  const settlements = {
    keep: settlementWith("keep", 0, 4, 7, 0),
    town: settlementWith("town", 0, 17, 4, 144),
  };
  const { hero: after, settlements: afterSettlements, foodDrawn } = charge(heroAt(4, 7), settlements);

  assert.equal(foodDrawn, 0, "the empty keep under the hero cannot pay, and the town does not travel");
  assert.equal(afterSettlements.keep.warehouse.food, 0);
  assert.equal(afterSettlements.town.warehouse.food, 144, "the distant surplus is untouched");
  assert.equal(after.upkeepUnpaidSinceDay, 7, "the shortfall streak starts");
  assert.equal(after.upkeepUnpaidTroops, 24);
  assert.equal(after.morale, 100 - MORALE_UNPAID_LOSS_MAX);
});

test("the only draw is the settlement under the hero's own hex, by id-independent of record order", () => {
  // Both towns belong to the hero; only the one at the hero's hex (zzz) is a
  // legal source, and the far one keeps its stock no matter where it sorts.
  const { settlements: afterSettlements } = charge(heroAt(2, 2), {
    aaa: settlementWith("aaa", 0, 9, 9, 100),
    zzz: settlementWith("zzz", 0, 2, 2, 100),
  });
  assert.equal(afterSettlements.zzz.warehouse.food, 60, "the town under the hero pays the bill");
  assert.equal(afterSettlements.aaa.warehouse.food, 100, "no other settlement is ever drawn");
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

test("an empty warehouse under the hero is not free food: the hero pays the full penalty", () => {
  const { hero: after, foodDrawn } = charge(heroAt(2, 2), { s0: settlementWith("s0", 0, 2, 2, 0) });
  assert.equal(foodDrawn, 0);
  assert.equal(after.upkeepUnpaidSinceDay, 7);
  assert.equal(after.upkeepUnpaidTroops, 24);
  assert.equal(after.upkeepUnpaidGold, 76);
  assert.equal(after.morale, 100 - MORALE_UNPAID_LOSS_MAX);
});

test("the larder pays first; the city under the hero only covers what is left of the bill", () => {
  const hero = heroAt(2, 2, {
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 30 },
  });
  const { hero: after, settlements: afterSettlements, foodDrawn } = charge(hero, {
    s0: settlementWith("s0", 0, 2, 2, 500),
  });
  assert.equal(foodDrawn, 10, "only the last 10 of the 40-food bill comes from the city");
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

// ── The regression: a default 1-player game's hero stands on its keep ─────

function defaultGame(seed: number): GameState {
  return buildInitialGameState(new GameMap(seed, "small"), mulberry32(seed), {
    castleSeed: seed,
    enemyCount: 0,
    humanSeatCount: 1,
    // The real POST /games path prices the starter farmland against the catalog
    // too (server/routes.ts reads unit_types and passes BuildInitialOptions.unitTypes),
    // so the keep's farms are sized against 5 population + 40/7 hero food/turn.
    unitTypes: CATALOG,
  });
}

interface ChargeTrace {
  day: number;
  /** The keep's own stock at the instant the charge ran -- the ONLY source the under-hero rule can draw. */
  keepFood: number;
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
 * sees is observable. New-game shape end to end: the auto-trade gate resolves
 * FALSE (init.ts also leaves every settlement autoTrade:false), so nothing
 * teleports and the keep accumulates its own surplus.
 */
function playDefaultGame(seed: number): ChargeTrace[] {
  let state = defaultGame(seed);
  const heroId = state.players[0].heroIds[0];
  const keepId = state.players[0].settlementIds[0];
  const traces: ChargeTrace[] = [];
  for (let turn = 0; turn < 24; turn++) {
    const phase = endTurn(applyEndOfTurnDetailed(state, { legacyAutoTrade: false }).state);
    if (phase.phase.kind !== "ROUND_END") {
      state = phase;
      continue;
    }
    const keepFood = phase.settlements[keepId]?.warehouse.food ?? 0;
    state = advanceRound(phase, 0.1, null, CATALOG);
    if (state.day % 7 !== 0) continue;
    const hero = state.heroes[heroId];
    traces.push({
      day: state.day,
      keepFood,
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

test("REGRESSION: the default 1-player hero is fully funded on every charge on 9 of 10 seeds", () => {
  // The keep now feeds its own hero out of its own accumulated surplus: the
  // 5x5 keep carries 3 farm fields (starterFarmsNeeded(5 + 40/7) asks 4; the
  // grid holds 3), sized against its population bill AND the hero's weekly one,
  // measured 98.05% turn-1 coverage over 4000 seeds. These 10 fixed seeds land
  // 9/10 fully funded (the starter farmhouse's +2 food/turn lifted the marginal
  // seed over the line); the one miss is the honest cliff of the narrow rule
  // (seed 32676's keep chronically runs ~half a bill short), not a teleport to
  // fix -- a caravan route is the designed remedy.
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
    if (traces.every((t) => t.unpaidSinceDay === null && t.unpaidTroops === 0 && t.morale === 100 && t.troops === 24)) {
      funded++;
      assert.deepEqual(
        traces.map((t) => t.gold),
        [224, 148, 72],
        `seed ${seed}: the purse paid 76 gold per charge`,
      );
    } else {
      // Not a spiral, a bounded shortfall. The penalty must stay proportional to
      // what the keep genuinely could not cover.
      shortfalls.push(seed.toString());
      for (const t of traces) {
        const affordable = evaluateTroopUpkeep(demoStacks(), CATALOG, 300, t.keepFood);
        assert.equal(t.unpaidTroops, affordable.unfed, `seed ${seed} day ${t.day}: charged more than the keep lacked`);
        assert.ok(t.morale >= 60, `seed ${seed} day ${t.day}: morale ${t.morale} is a collapse, not the honest cliff`);
      }
    }
  }
  assert.equal(funded, 9, `expected exactly 9/10 funded default games under the narrow rule (short on: ${shortfalls.join(", ")})`);
});

test("REGRESSION: the keep's draw is exactly what the hero's bill needed, no more", () => {
  // One seed, three charges, the keep's own warehouse read at each one: 40 food
  // a week leaves the city the hero stands on, and the hero's larder stays
  // empty (the food is eaten, never banked in a wagon where the player could
  // hoard it). The distant town is never drawn -- the keep covers the bill out
  // of its own accumulated surplus and still GROWS week over week.
  let state = defaultGame(1000);
  const heroId = state.players[0].heroIds[0];
  const keepId = state.players[0].settlementIds[0];
  const keeps: number[] = [];
  for (let turn = 0; turn < 24; turn++) {
    const phase = endTurn(applyEndOfTurnDetailed(state, { legacyAutoTrade: false }).state);
    if (phase.phase.kind !== "ROUND_END") {
      state = phase;
      continue;
    }
    const before = phase.settlements[keepId]?.warehouse.food ?? 0;
    state = advanceRound(phase, 0.1, null, CATALOG);
    if (state.day % 7 !== 0) continue;
    const after = state.settlements[keepId]?.warehouse.food ?? 0;
    assert.equal(before - after, 40, `day ${state.day}: exactly the bill left the keep`);
    assert.equal(state.heroes[heroId].resources?.food, 0, "settlement-funded food is eaten on the spot");
    keeps.push(before);
  }
  assert.deepEqual(
    keeps,
    [54, 77, 100],
    "the keep accumulates: its 3 farms out-produce its population bill AND the hero's weekly one (the starter farmhouse's +2 food/turn adds to the surplus)",
  );
});

test("REGRESSION COUNTERFACTUAL: with no city under the hero (the field rule) the same seeds spiral as reported", () => {
  // Proves the tests above measure the funding and not a passing-by-accident
  // state. Same game, same bill, larder-only funding: 25 morale a week from
  // day 7. This is also exactly what a hero that marched away from its keep
  // sees every week until a caravan finds it.
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

test("PIN: a hero standing on its keep with accumulated surplus stays funded through 3+ weekly charges", () => {
  // The survival chain of the narrow gate, pinned directly: an under-hero
  // settlement whose farm output exceeds its population need BANKS the
  // difference between charges, and every weekly draw lands in full while the
  // stock keeps growing. 90 food/turn of production against a 5/turn
  // population bill leaves +85/turn of accumulation, so the 40-food weekly
  // draw never catches the stock.
  let settlements: Record<string, SettlementState> = {
    s0: settlementWith("s0", 0, 2, 2, 50),
  };
  const hero = heroAt(2, 2);
  for (const day of [7, 14, 21, 28, 35]) {
    // The week's farm production lands before the charge (turn/endTurn.ts's
    // pass runs before turn/round.ts's weekly one).
    settlements.s0 = {
      ...settlements.s0,
      warehouse: { ...settlements.s0.warehouse, food: (settlements.s0.warehouse.food ?? 0) + 90 * 7 - 5 * 7 },
    };
    const result = applySuppliedHeroUpkeep({ [hero.id]: hero }, settlements, { ...OPTIONS, day });
    settlements = result.settlements;
    const after = result.heroes[hero.id];
    assert.equal(after.upkeepUnpaidSinceDay, null, `day ${day}: a surplus keep funds the whole bill`);
    assert.equal(after.morale, 100, `day ${day}: a funded charge never bleeds morale`);
    assert.equal(after.troops, 24, `day ${day}: nobody deserts a paid charge`);
    assert.equal(after.gold, 300 - 76, `day ${day}: the purse paid the gold half`);
    assert.equal(settlements.s0.warehouse.food, 50 + 555 * (day / 7), `day ${day}: the surplus keeps accumulating`);
  }
});

test("applyWeeklyUpkeep is the same charge end to end (the server's day-7 path)", () => {
  let state = defaultGame(1000);
  const heroId = state.players[0].heroIds[0];
  const keepId = state.players[0].settlementIds[0];
  const keepFood = (s: GameState): number => s.settlements[keepId]?.warehouse.food ?? 0;
  // Play the real pipeline (per-turn production + consumption, then the day
  // tick -- composed exactly like server/app/turnService.ts's runEndTurn) with
  // no player action. The weekly charge fires inside advanceRound at the day
  // 6 -> 7 wrap, AFTER that turn's production pass -- so the stock visible on
  // the wrapping phase is the stock the charge draws from.
  let preChargeStock = 0;
  for (let turn = 0; turn < 6; turn++) {
    const phase = endTurn(applyEndOfTurnDetailed(state, { legacyAutoTrade: false }).state);
    if (phase.phase.kind !== "ROUND_END") {
      state = phase;
      continue;
    }
    if (state.day < 6) {
      assert.equal(state.heroes[heroId].gold, 300, `day ${state.day}: no weekly charge has run yet`);
      assert.equal(state.heroes[heroId].upkeepUnpaidSinceDay, null);
    }
    preChargeStock = phase.settlements[keepId]?.warehouse.food ?? 0;
    state = advanceRound(phase, 0.1, null, CATALOG);
  }
  assert.equal(state.day, 7, "six turns of a 1-player game wrap to the day-7 weekly boundary");
  assert.ok(preChargeStock >= 40, `the keep's stock (${preChargeStock}) must cover the 40-food bill`);

  // The charge that ran inside that wrap is exactly what applyWeeklyUpkeep
  // does on the day-7 branch: the purse paid the gold half, the keep paid the
  // food half, nobody went unfed.
  const hero = state.heroes[heroId];
  assert.equal(hero.gold, 300 - 76, "the purse paid the gold half");
  assert.equal(hero.upkeepUnpaidSinceDay, null);
  assert.equal(hero.upkeepUnpaidTroops, 0);
  assert.equal(hero.morale, 100);
  assert.equal(hero.troops, 24);
  assert.equal(preChargeStock - keepFood(state), 40, "40 food left the keep's warehouse");
});

test("a garrison at the same settlement is charged from what is left after the heroes", () => {
  // Same-warehouse contention, pinned so it cannot drift silently: the hero's
  // bill is charged first (turn/round.ts's existing composition order), and the
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
