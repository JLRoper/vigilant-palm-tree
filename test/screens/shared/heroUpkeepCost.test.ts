import { test } from "node:test";
import assert from "node:assert/strict";
import type { HeroState, Platoon, SettlementId, SettlementState } from "@heroes/contracts";
import type { UnitType } from "@heroes/engine";
import { evaluateTroopUpkeep } from "@heroes/engine";
import {
  daysToWeeklyCharge,
  empireUpkeepCost,
  empireUpkeepLabel,
  empireUpkeepTitleClause,
  heroLarderTitle,
  heroUpkeepCost,
  heroUpkeepCurrentlyUnfed,
  heroUpkeepLabel,
  heroUpkeepTitle,
  liveHeroUpkeepUnfed,
  liveSettlementUpkeepUnfed,
  settlementUpkeepCurrentlyUnfed,
} from "@screens/shared/heroUpkeepCost";
import { emptyWarehouse, makeHero, makeSettlement } from "../../charter/_helpers";

// The upkeep readout used to interpolate raw troop HEADCOUNT into a bill: a
// 24-troop army was told it cost "24g + 24 food" while the engine charged it
// 76 gold and 40 food (3.2x / 1.7x under-reported). Three surfaces showed it --
// heroInfoMenu's troop row + tooltip, the HUD's "Empire Upkeep" row, and the HUD
// economy tooltip -- and all three now render the engine's own bill.

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

// The real catalog's upkeep numbers, from server/migrations/021_upkeep_shortfall.sql:
// upkeep_gold = tier, upkeep_food = clamp(ceil(tier / 2), 1, 3).
const CATALOG: Record<string, UnitType> = {
  peasant: tierUnit("peasant", 1),
  swordsman: tierUnit("swordsman", 2),
  archer: tierUnit("archer", 4),
  cavalry: tierUnit("cavalry", 5),
  crossbowman: tierUnit("crossbowman", 4),
  griffin: tierUnit("griffin", 8),
};

/** 12 swordsman (2g/1f) + 8 archer (4g/2f) + 4 cavalry (5g/3f) = 24 troops, 76g, 40 food. */
function demoArmy(): Platoon[] {
  return [
    { entries: [{ unitTypeId: "swordsman", count: 12 }] },
    { entries: [{ unitTypeId: "archer", count: 8 }] },
    { entries: [{ unitTypeId: "cavalry", count: 4 }] },
  ];
}

test("a 24-troop army reads 76g + 40 food, not 24 + 24", () => {
  const stacks = demoArmy();
  const bill = heroUpkeepCost(stacks, CATALOG);

  assert.equal(bill.troops, 24);
  assert.equal(bill.gold, 76, "12x2 + 8x4 + 4x5");
  assert.equal(bill.food, 40, "12x1 + 8x2 + 4x3");
  assert.equal(
    heroUpkeepLabel(bill),
    "24 \u00B7 Upkeep: 76g + 40 food/wk",
    "the hero panel's troop row shows the real bill",
  );
  assert.equal(
    heroUpkeepLabel(bill).includes("24g"),
    false,
    "the headcount must not reappear as the gold figure",
  );
  assert.equal(heroUpkeepLabel(bill).includes("24 food"), false);
});

test("the bill agrees with evaluateTroopUpkeep across compositions", () => {
  const compositions: readonly (readonly [string, Platoon[]])[] = [
    ["empty army", [{ entries: [] }]],
    ["one peasant", [{ entries: [{ unitTypeId: "peasant", count: 1 }] }]],
    ["peasant wall", [{ entries: [{ unitTypeId: "peasant", count: 40 }] }]],
    ["griffins only", [{ entries: [{ unitTypeId: "griffin", count: 3 }] }]],
    [
      "one platoon, three entries",
      [
        {
          entries: [
            { unitTypeId: "peasant", count: 10 },
            { unitTypeId: "crossbowman", count: 5 },
            { unitTypeId: "griffin", count: 1 },
          ],
        },
      ],
    ],
    ["demo army", demoArmy()],
  ];
  for (const [label, stacks] of compositions) {
    // The engine's own evaluation, called independently of the helper.
    const reference = evaluateTroopUpkeep(stacks, CATALOG, 0, 0);
    const bill = heroUpkeepCost(stacks, CATALOG);
    assert.equal(bill.gold, reference.costGold, `${label}: gold`);
    assert.equal(bill.food, reference.costFood, `${label}: food`);
    assert.ok(Number.isInteger(bill.gold) && Number.isInteger(bill.food), `${label}: the bill is an integer`);
    assert.equal(bill.troops, stacks.reduce((t, p) => t + p.entries.reduce((x, e) => x + e.count, 0), 0));
  }
});

test("an empty catalog is the sanctioned 1g/1f fallback, not a crash", () => {
  const bill = heroUpkeepCost(demoArmy(), {});
  assert.equal(bill.gold, 24, "1 gold per troop");
  assert.equal(bill.food, 24, "1 food per troop -- this is the pre-catalog default, not the real bill");
  assert.equal(bill.troops, 24);
  assert.equal(heroUpkeepLabel(bill), "24 \u00B7 Upkeep: 24g + 24 food/wk");
});

test("empireUpkeepCost sums the same per-hero bill", () => {
  const bill = empireUpkeepCost([{ stacks: demoArmy() }, { stacks: demoArmy() }], CATALOG);
  assert.deepEqual(bill, { troops: 48, gold: 152, food: 80 });
  assert.deepEqual(empireUpkeepCost([], CATALOG), { troops: 0, gold: 0, food: 0 });
  // Same total as one evaluateTroopUpkeep over the concatenated stacks: the sum
  // is additive, so no hero's bill is lost or double counted.
  const merged = evaluateTroopUpkeep([...demoArmy(), ...demoArmy()], CATALOG, 0, 0);
  assert.equal(bill.gold, merged.costGold);
  assert.equal(bill.food, merged.costFood);
  assert.equal(empireUpkeepLabel(bill), "Empire Upkeep: 152g + 80 food/wk (48 troops)");
});

test("the tooltip states the actual funding rule: purse, then larder, then own settlements", () => {
  const title = heroUpkeepTitle(heroUpkeepCost(demoArmy(), CATALOG));

  assert.equal(
    title,
    "Weekly upkeep: 76g from the purse + 40 food, paid from the wagon larder first " +
      "and then from your own settlements' food while this hero stands on one of them; " +
      "unpaid gold makes troops desert",
  );
  assert.equal(title.includes("from cargo"), false, "food does not come from 'cargo' any more");
  assert.equal(title.includes("76g"), true);
  assert.equal(title.includes("40 food"), true);
  assert.match(title, /stands on one of them/, "the settlement funding only applies while standing on one");
});

test("the HUD tooltip clause names the real sources, not 'purse & packs'", () => {
  const clause = empireUpkeepTitleClause(heroUpkeepCost(demoArmy(), CATALOG));
  assert.equal(
    clause,
    "Upkeep: troops 76g + 40 food/wk (hero purse; larder first, then your own settlements' food while standing on one)",
  );
  assert.equal(clause.includes("packs"), false);
});

// ── Weekly cadence + the currently-unfed gate ─────────────────────────────
// The charge runs on day % 7 === 0, so a player watching an untouched larder
// reads it as dead stock. The larder tooltip states the cadence; the unfed
// gates answer the question a warning surface must actually ask -- would the
// NEXT charge see this entity as fed?

const ONE_PEASANT: Platoon[] = [{ entries: [{ unitTypeId: "peasant", count: 1 }] }];

/** A hero in the field: a one-peasant army, own town far away. */
function fieldHero(overrides: Partial<HeroState> = {}): HeroState {
  return {
    ...makeHero("h0", 0, 2, 2, { gold: 100, troops: 1, stacks: ONE_PEASANT }),
    ...overrides,
  };
}

function settlementRecord(
  settlement: SettlementState,
): Record<SettlementId, SettlementState> {
  return { [settlement.id]: settlement };
}

test("daysToWeeklyCharge counts down to the next day-% 7 charge", () => {
  assert.equal(daysToWeeklyCharge(1), 6);
  assert.equal(daysToWeeklyCharge(6), 1);
  assert.equal(daysToWeeklyCharge(7), 7, "a charge day is a full week from the next one, not zero");
  assert.equal(daysToWeeklyCharge(11), 3);
  assert.equal(daysToWeeklyCharge(14), 7);
});

test("the larder tooltip names the cadence and the weeks of cover", () => {
  // 90 food against an 18 food/wk bill: five weeks of cover, and on day 11 the
  // next charge is 3 days out.
  const title = heroLarderTitle({ troops: 14, gold: 34, food: 18 }, 90, 11);
  assert.equal(
    title,
    "Weekly upkeep: 18 food charged every 7th day (next charge in 3 days) — " +
      "this larder covers ~5 weeks. Paid from the wagon larder first, then the settlement this hero stands on.",
  );
  assert.match(title, /charged every 7th day/, "the weekly cadence is explicit");
  assert.match(title, /next charge in 3 days/);
  assert.match(title, /~5 weeks/);
  // One week reads singular; two do not.
  assert.match(heroLarderTitle({ troops: 2, gold: 2, food: 18 }, 18, 7), /~1 week\./);
  assert.match(heroLarderTitle({ troops: 2, gold: 2, food: 18 }, 36, 7), /~2 weeks\./);
});

test("the larder tooltip says so when the stock cannot cover one week", () => {
  const title = heroLarderTitle({ troops: 14, gold: 34, food: 18 }, 10, 11);
  assert.match(title, /does not cover one week/);
  assert.match(title, /next charge in 3 days/, "the cadence is stated even when the news is bad");
});

test("a zero food bill reads as a gold-only bill", () => {
  assert.equal(
    heroLarderTitle({ troops: 3, gold: 6, food: 0 }, 40, 5),
    "Weekly upkeep: no food cost. Gold upkeep is 6g/wk from the purse.",
  );
});

test("the hero gate asks what the next charge would see, not what the streak says", () => {
  const distant = settlementRecord(
    makeSettlement("s0", 0, 9, 9, { gold: 500, warehouse: emptyWarehouse({ food: 500 }) }),
  );

  // Purse + larder both cover the 1 peasant's 1g/1f bill.
  const fed = fieldHero({ gold: 10, resources: emptyWarehouse({ food: 5 }) });
  assert.equal(heroUpkeepCurrentlyUnfed(fed, distant, CATALOG), false);
  assert.equal(liveHeroUpkeepUnfed(fed, distant), false, "the live twin prices the same bill");

  // Empty purse and larder: a real shortfall.
  const broke = fieldHero({ gold: 0, resources: emptyWarehouse() });
  assert.equal(heroUpkeepCurrentlyUnfed(broke, distant, CATALOG), true);
  assert.equal(liveHeroUpkeepUnfed(broke, distant), true);

  // A brimming larder with an empty purse still starves: gold and food each
  // starve their own count, so funding one half does not hide the other.
  const goldShort = fieldHero({ gold: 0, resources: emptyWarehouse({ food: 50 }) });
  assert.equal(heroUpkeepCurrentlyUnfed(goldShort, distant, CATALOG), true);
  const foodShort = fieldHero({ gold: 500, resources: emptyWarehouse() });
  assert.equal(heroUpkeepCurrentlyUnfed(foodShort, distant, CATALOG), true);
});

test("the settlement under the hero funds the food half of the bill", () => {
  const atTown = fieldHero({ q: 4, r: 4, gold: 100, resources: emptyWarehouse() });

  const own = settlementRecord(
    makeSettlement("s0", 0, 4, 4, { gold: 0, warehouse: emptyWarehouse({ food: 50 }) }),
  );
  assert.equal(liveHeroUpkeepUnfed(atTown, own), false, "the city under the hero's boots is a legal source");

  const neutral = settlementRecord(
    makeSettlement("s0", null, 4, 4, { gold: 0, warehouse: emptyWarehouse({ food: 50 }) }),
  );
  assert.equal(liveHeroUpkeepUnfed(atTown, neutral), true, "a neutral town is nobody's larder");
});

test("the garrison twin reads treasury + warehouse", () => {
  const stacks: Platoon[] = [{ entries: [{ unitTypeId: "peasant", count: 2 }] }];

  const funded = {
    ...makeSettlement("s0", 0, 1, 1, { gold: 100, warehouse: emptyWarehouse({ food: 50 }) }),
    stacks,
  };
  assert.equal(settlementUpkeepCurrentlyUnfed(funded, CATALOG), false);
  assert.equal(liveSettlementUpkeepUnfed(funded), false);

  const broke = {
    ...makeSettlement("s0", 0, 1, 1, { gold: 0, warehouse: emptyWarehouse() }),
    stacks,
  };
  assert.equal(settlementUpkeepCurrentlyUnfed(broke, CATALOG), true);
  assert.equal(liveSettlementUpkeepUnfed(broke), true);

  // No garrison, no bill: a streak on an empty garrison has nothing to warn about.
  const empty = makeSettlement("s0", 0, 1, 1, { gold: 0, warehouse: emptyWarehouse() });
  assert.equal(liveSettlementUpkeepUnfed(empty), false);
});