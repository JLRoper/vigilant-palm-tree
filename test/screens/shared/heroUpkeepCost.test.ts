import { test } from "node:test";
import assert from "node:assert/strict";
import type { Platoon, UnitType } from "@heroes/engine";
import { evaluateTroopUpkeep } from "@heroes/engine";
import {
  empireUpkeepCost,
  empireUpkeepLabel,
  empireUpkeepTitleClause,
  heroUpkeepCost,
  heroUpkeepLabel,
  heroUpkeepTitle,
} from "@screens/shared/heroUpkeepCost";

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