import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyHeroUpkeep,
  desertTroopsByCost,
  evaluateHeroUpkeep,
  DESERT_COST_SHARE,
  DESERT_GRACE_WEEKS,
  MORALE_UNPAID_LOSS_MAX,
  mulberry32,
  platoonTroopTotal,
  type HeroUpkeepOptions,
  type UnitType,
} from "@heroes/engine";
import type { HeroState, Platoon } from "@heroes/contracts";
import { makeHero } from "../charter/_helpers";

function unit(id: string, upkeepGold: number, upkeepFood: number): UnitType {
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
    upkeepGold,
    upkeepFood,
  };
}

const UNIT_TYPES: Record<string, UnitType> = {
  peasant: unit("peasant", 1, 1),
  swordsman: unit("swordsman", 2, 2),
  archer: unit("archer", 2, 1),
  cavalry: unit("cavalry", 4, 4),
  eagle_prince: unit("eagle_prince", 10, 3),
};

interface HeroOpts {
  gold?: number;
  food?: number;
  morale?: number;
  unpaidSinceDay?: number | null;
  unpaidTroops?: number;
  unpaidGold?: number;
}

function heroWith(stacks: Platoon[], opts: HeroOpts = {}, id = "h0"): HeroState {
  const base = makeHero(id, 0, 2, 2, {
    gold: opts.gold ?? 0,
    troops: platoonTroopTotal(stacks),
    stacks,
  });
  return {
    ...base,
    morale: opts.morale ?? 100,
    upkeepUnpaidSinceDay: opts.unpaidSinceDay ?? null,
    upkeepUnpaidTroops: opts.unpaidTroops ?? 0,
    upkeepUnpaidGold: opts.unpaidGold ?? 0,
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: opts.food ?? 0 },
  };
}

function charge(hero: HeroState, day: number, extra: Partial<HeroUpkeepOptions> = {}): HeroState {
  const heroes = applyHeroUpkeep({ [hero.id]: hero }, {
    unitTypes: UNIT_TYPES,
    day,
    round: 3,
    castleSeed: 99,
    ...extra,
  });
  return heroes[hero.id];
}

// A real unpaid streak: charges land one week apart starting at `startDay`, and
// the hero state is threaded through them the way the server's day tick does.
function chargeStreak(hero: HeroState, startDay: number, charges: number): HeroState {
  let cur = hero;
  for (let i = 0; i < charges; i++) cur = charge(cur, startDay + i * 7);
  return cur;
}

function countOf(stacks: readonly Platoon[], unitTypeId: string): number {
  let n = 0;
  for (const p of stacks) for (const e of p.entries) if (e.unitTypeId === unitTypeId) n += e.count;
  return n;
}

function weeklyCost(stacks: readonly Platoon[]): number {
  let cost = 0;
  for (const p of stacks) {
    for (const e of p.entries) cost += e.count * (UNIT_TYPES[e.unitTypeId]?.upkeepGold ?? 1);
  }
  return cost;
}

function assertIntegralCounts(stacks: readonly Platoon[]): void {
  for (const p of stacks) {
    for (const e of p.entries) assert.equal(Number.isInteger(e.count), true, "no fractional troop count");
  }
}

test("upkeep charges gold and cargo food based on the stacks total, not the stale troops scalar", () => {
  const hero = {
    ...makeHero("h0", 0, 2, 2, {
      troops: 1,
      gold: 300,
      stacks: [
        { entries: [{ unitTypeId: "swordsman", count: 12 }] },
        { entries: [{ unitTypeId: "archer", count: 8 }] },
        { entries: [{ unitTypeId: "cavalry", count: 4 }] },
      ],
    }),
    morale: 100,
    upkeepUnpaidSinceDay: null,
    upkeepUnpaidTroops: 0,
    upkeepUnpaidGold: 0,
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 100 },
  };
  // Catalog-less: units.ts's per-unit default is 1g/1f, so 24 troops cost 24.
  const [after] = Object.values(applyHeroUpkeep({ h0: hero }));
  assert.equal(after.gold, 300 - 24);
  assert.equal(after.troops, 24);
  assert.equal(after.resources?.food, 100 - 24);
});

test("the bill comes from the per-unit catalog, not a flat 1 gold per troop", () => {
  const stacks: Platoon[] = [
    { entries: [{ unitTypeId: "eagle_prince", count: 2 }] },
    { entries: [{ unitTypeId: "peasant", count: 3 }] },
  ];
  const hero = heroWith(stacks, { gold: 100, food: 100 });
  const evaluated = evaluateHeroUpkeep(hero, UNIT_TYPES);
  assert.equal(evaluated.troops, 5);
  assert.equal(evaluated.costGold, 2 * 10 + 3 * 1);
  assert.equal(evaluated.costFood, 2 * 3 + 3 * 1);
  assert.equal(evaluated.unfed, 0);

  const after = charge(hero, 7);
  assert.equal(after.gold, 100 - 23);
  assert.equal(after.resources?.food, 100 - 9);
  assert.equal(after.troops, 5);
});

test("fully funded upkeep resets the shortfall bookkeeping and leaves morale alone", () => {
  const hero = heroWith([{ entries: [{ unitTypeId: "swordsman", count: 10 }] }], {
    gold: 40,
    food: 40,
    morale: 71,
    unpaidSinceDay: 3,
    unpaidTroops: 4,
    unpaidGold: 8,
  });
  const after = charge(hero, 14);
  assert.equal(after.gold, 20);
  assert.equal(after.resources?.food, 20);
  assert.equal(after.troops, 10);
  assert.equal(after.morale, 71, "morale does not recover when the bill is paid");
  assert.equal(after.upkeepUnpaidSinceDay, null);
  assert.equal(after.upkeepUnpaidTroops, 0);
  assert.equal(after.upkeepUnpaidGold, 0);
});

test("an unpaid charge costs morale but no troops during the two-charge grace", () => {
  const stacks: Platoon[] = [{ entries: [{ unitTypeId: "peasant", count: 12 }] }];
  // 12 gold/food owed, nothing in the purse and nothing in the wagon.
  const first = charge(heroWith(stacks, { gold: 0, food: 0 }), 7);
  assert.equal(first.gold, 0, "no debt is carried; the purse just runs dry");
  assert.equal(first.resources?.food, 0);
  assert.equal(first.troops, 12, "week 1 of the streak never loses a soldier");
  assert.equal(first.morale, 100 - MORALE_UNPAID_LOSS_MAX, "a fully unfed army bleeds the max");
  assert.equal(first.upkeepUnpaidSinceDay, 7, "the streak is stamped with the FIRST unpaid charge");
  assert.equal(first.upkeepUnpaidTroops, 12);
  assert.equal(first.upkeepUnpaidGold, 12);

  const second = charge(first, 14);
  assert.equal(second.troops, 12, "week 2 is the last grace week");
  assert.equal(second.morale, 100 - 2 * MORALE_UNPAID_LOSS_MAX);
  assert.equal(second.upkeepUnpaidSinceDay, 7, "the streak start is never moved forward");
  assert.equal(second.upkeepUnpaidGold, 12);
});

test("the third unpaid charge deserts troops worth ~20% of the unfed cost", () => {
  const stacks: Platoon[] = [{ entries: [{ unitTypeId: "peasant", count: 10 }] }];
  const third = chargeStreak(heroWith(stacks, { gold: 0, food: 0 }), 7, 3);
  const target = Math.ceil(DESERT_COST_SHARE * third.upkeepUnpaidGold);
  assert.equal(third.upkeepUnpaidGold, 10, "all 10 peasants are unfed, so the deficit is 10 gold");
  assert.equal(target, 2);
  assert.equal(third.troops, 8, "exactly two 1-gold peasants walk");
  assert.equal(
    platoonTroopTotal(third.stacks),
    third.troops,
    "the troops scalar stays consistent with the stacks after desertion",
  );
  assert.equal(third.morale, 100 - 3 * MORALE_UNPAID_LOSS_MAX);
  assert.equal(third.upkeepUnpaidSinceDay, 7, "the streak start survives the desertion");
  assert.equal(third.gold, 0);
});

test("a mixed army only loses the cost the 20% target can buy", () => {
  // 6 peasants (1g) + 3 archers (2g) + 1 Eagle Prince (10g) = 22 gold owed.
  // Purse empty, larder full: only gold starves them, and only the third of the
  // cost walks.
  const stacks: Platoon[] = [
    { entries: [{ unitTypeId: "peasant", count: 6 }] },
    { entries: [{ unitTypeId: "archer", count: 3 }] },
    { entries: [{ unitTypeId: "eagle_prince", count: 1 }] },
  ];
  const evaluated = evaluateHeroUpkeep(heroWith(stacks, { gold: 0, food: 100 }), UNIT_TYPES);
  assert.equal(evaluated.costGold, 22);
  assert.equal(evaluated.unfed, 10);
  assert.equal(evaluated.unfedCostGold, 22, "the whole army is the deficit here");

  const after = chargeStreak(heroWith(stacks, { gold: 0, food: 100 }), 7, 3);
  const target = Math.ceil(DESERT_COST_SHARE * 22);
  const removedCost = 22 - weeklyCost(after.stacks);
  assert.ok(removedCost >= target, `removed cost ${removedCost} reached the ${target} target`);
  // The last unit drawn can overshoot by at most its own upkeep (10g here).
  assert.ok(removedCost <= target + 10, `removed cost ${removedCost} overshot by more than one Eagle Prince`);
  assert.ok(after.troops < 10, "somebody walked");
  assert.equal(platoonTroopTotal(after.stacks), after.troops);
  assertIntegralCounts(after.stacks);
});

test("desertion is charged against the unfed troops' cost, never the army's", () => {
  // 8 Eagle Princes (10g) + 40 peasants (1g) = 120 gold, 48 troops. A purse of
  // 45 buys all 40 peasants and no Eagle Prince, so 8 troops go unfed and the
  // deficit is 8 x 10g = 80, NOT 8 x 1g = 8.
  const stacks: Platoon[] = [
    { entries: [{ unitTypeId: "eagle_prince", count: 8 }] },
    { entries: [{ unitTypeId: "peasant", count: 40 }] },
  ];
  // The streak is already two charges old, so this single charge opens the
  // desertion gate while the purse still shows the real 80-gold shortfall.
  const hero = heroWith(stacks, { gold: 45, food: 500, unpaidSinceDay: 7 });
  const evaluated = evaluateHeroUpkeep(hero, UNIT_TYPES);
  assert.equal(evaluated.costGold, 120);
  assert.equal(evaluated.unfed, 8);
  assert.equal(evaluated.unfedCostGold, 80);
  assert.equal(evaluated.share, 80 / 120);

  const after = charge(hero, 21);
  assert.equal(after.gold, 0);
  assert.equal(after.upkeepUnpaidGold, 80);
  assert.equal(
    after.morale,
    100 - Math.round(MORALE_UNPAID_LOSS_MAX * (80 / 120)),
    "the morale bleed scales with the VALUE that went unpaid",
  );
  const removedCost = 120 - weeklyCost(after.stacks);
  const target = Math.ceil(DESERT_COST_SHARE * 80);
  assert.ok(removedCost >= target, `removed ${removedCost} gold of upkeep, target ${target}`);
  assert.ok(removedCost <= target + 10, `overshot by more than one Eagle Prince: ${removedCost}`);
  assert.ok(countOf(after.stacks, "eagle_prince") < 8, "an Eagle Prince is the expensive casualty");
  assert.ok(after.troops >= 30, `the army is bled, not wiped: ${after.troops}`);
  assert.equal(platoonTroopTotal(after.stacks), after.troops);
});

test("cheap unpaid troops cost the 1-point morale floor, expensive ones hit hard", () => {
  const poorPeasants = heroWith([{ entries: [{ unitTypeId: "peasant", count: 100 }] }], {
    gold: 99,
    food: 200,
  });
  const cheap = evaluateHeroUpkeep(poorPeasants, UNIT_TYPES);
  assert.equal(cheap.unfed, 1);
  assert.equal(cheap.unfedCostGold, 1);
  assert.equal(cheap.share, 1 / 100);
  assert.equal(charge(poorPeasants, 7).morale, 99, "one unpaid peasant in a 100-troop army rounds to the floor");

  const richStacks: Platoon[] = [
    { entries: [{ unitTypeId: "eagle_prince", count: 1 }] },
    { entries: [{ unitTypeId: "peasant", count: 20 }] },
  ];
  const rich = evaluateHeroUpkeep(heroWith(richStacks, { gold: 29, food: 200 }, "rich"), UNIT_TYPES);
  assert.equal(rich.unfed, 1);
  assert.equal(rich.unfedCostGold, 10, "the purse ran out at the top of the bill: the Eagle Prince");
  assert.equal(
    charge(heroWith(richStacks, { gold: 29, food: 200 }, "rich"), 7).morale,
    100 - 8,
    "the same single unpaid unit costs 8 morale instead of 1",
  );
});

test("per-unit desertion odds scale with upkeep cost (weighted draw)", () => {
  // 1 cavalry (4g) + 36 peasants (1g) = 40 gold. A purse of 36 buys every
  // peasant and no cavalry, so exactly one troop is unfed, the deficit is 4g,
  // and the desertion target is ceil(0.2 * 4) = 1 -- one single unit walks.
  const stacks: Platoon[] = [
    { entries: [{ unitTypeId: "cavalry", count: 1 }] },
    { entries: [{ unitTypeId: "peasant", count: 36 }] },
  ];
  const probe = heroWith(stacks, { gold: 36, food: 100, unpaidSinceDay: -14 }, "probe");
  const evaluated = evaluateHeroUpkeep(probe, UNIT_TYPES);
  assert.equal(evaluated.unfed, 1);
  assert.equal(evaluated.unfedCostGold, 4);
  assert.equal(Math.ceil(DESERT_COST_SHARE * 4), 1, "the target is exactly one unit");

  let cavalryLeft = 0;
  let peasantsLeft = 0;
  for (let i = 0; i < 400; i++) {
    const day = 21 + i * 7;
    // A streak already two charges old, so this single charge opens the gate.
    const hero = heroWith(stacks, { gold: 36, food: 100, unpaidSinceDay: day - 14 });
    const after = charge(hero, day);
    assert.equal(after.troops, 36, "exactly one unit walks each charge");
    if (countOf(after.stacks, "cavalry") === 0) cavalryLeft++;
    else peasantsLeft++;
  }
  // Weight is upkeepGold, so the cavalry's per-unit odds are 4x a peasant's
  // even though peasants are 36x more numerous.
  const cavalryRate = cavalryLeft / 400;
  const peasantRate = peasantsLeft / (400 * 36);
  assert.ok(cavalryRate > 3 * peasantRate, `cavalry ${cavalryRate} vs peasant ${peasantRate}`);
  assert.ok(cavalryLeft > 10 && cavalryLeft < 90, `cavalry walked in ${cavalryLeft}/400 charges`);
});

test("the desertion draw is deterministic and keyed per entity", () => {
  const stacks: Platoon[] = [
    { entries: [{ unitTypeId: "eagle_prince", count: 2 }] },
    { entries: [{ unitTypeId: "peasant", count: 40 }] },
  ];
  const hero = heroWith(stacks, { gold: 45, food: 500, unpaidSinceDay: 7 });
  assert.deepEqual(charge(hero, 21), charge(hero, 21), "same inputs replay identically");

  const signatures = new Set<string>();
  for (const id of ["h0", "h1", "h2", "h3", "h4", "h5", "h6", "h7"]) {
    for (const day of [21, 28, 35, 42, 49, 56]) {
      const drawn = charge(heroWith(stacks, { gold: 45, food: 500, unpaidSinceDay: day - 14 }, id), day);
      signatures.add(JSON.stringify(drawn.stacks));
    }
  }
  assert.ok(signatures.size > 1, "different entity ids / days produce different draws");
});

test("desertTroopsByCost stops at the target and never writes fractional counts", () => {
  const flat: Platoon[] = [
    { entries: [{ unitTypeId: "peasant", count: 5 }] },
    { entries: [] },
  ];
  const flatResult = desertTroopsByCost(flat, 2, UNIT_TYPES, mulberry32(12345));
  assert.equal(flatResult.removed, 2, "a 2-gold target over 1-gold peasants removes exactly two");
  assert.equal(flatResult.removedCost, 2);
  assert.equal(platoonTroopTotal(flatResult.stacks), 3);
  assert.deepEqual(flatResult.stacks[0].entries, [{ unitTypeId: "peasant", count: 3 }]);
  assert.deepEqual(flatResult.stacks[1].entries, []);

  // Mixed army: the draw may stop on the first unit when that unit alone covers
  // the target (a 10-gold Eagle Prince always does), so only the floor is pinned.
  const mixed: Platoon[] = [
    { entries: [{ unitTypeId: "peasant", count: 5 }] },
    { entries: [{ unitTypeId: "eagle_prince", count: 1 }] },
  ];
  const mixedResult = desertTroopsByCost(mixed, 2, UNIT_TYPES, mulberry32(12345));
  assert.ok(mixedResult.removed >= 1 && mixedResult.removedCost >= 2);
  assert.equal(platoonTroopTotal(mixedResult.stacks), 6 - mixedResult.removed);
  assertIntegralCounts(mixedResult.stacks);

  const untouched = desertTroopsByCost(mixed, 0, UNIT_TYPES, mulberry32(1));
  assert.equal(untouched.removed, 0);
  assert.equal(untouched.removedCost, 0);
  assert.equal(platoonTroopTotal(untouched.stacks), 6);
});

test("DESERT_GRACE_WEEKS is two weekly charges", () => {
  assert.equal(DESERT_GRACE_WEEKS, 2);
});

test("a hero without cargo food pays no food and keeps its resources untouched", () => {
  const hero = makeHero("h0", 0, 2, 2, {
    troops: 12,
    gold: 50,
    stacks: [{ entries: [{ unitTypeId: "swordsman", count: 12 }] }],
  });
  const [after] = Object.values(applyHeroUpkeep({ h0: { ...hero, morale: 100 } as HeroState }));
  assert.equal(after.gold, 38);
  assert.equal(after.resources?.food ?? 0, 0);
});