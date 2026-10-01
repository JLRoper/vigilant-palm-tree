import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyGarrisonUpkeep,
  applyHeroUpkeep,
  applyWeeklyUpkeep,
  MORALE_UNPAID_LOSS_MAX,
  normalizePlatoons,
  platoonTroopTotal,
  settlementStacks,
  type GarrisonUpkeepOptions,
  type UnitType,
} from "@heroes/engine";
import type { HeroState, Platoon, SettlementId, SettlementState } from "@heroes/contracts";
import { emptyWarehouse, makeHero, makeSettlement, makeState } from "../charter/_helpers";

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

interface SettlementOpts {
  morale?: number;
  unpaidSinceDay?: number | null;
  unpaidTroops?: number;
  unpaidGold?: number;
}

function settlementWithStacks(
  id: SettlementId,
  stacks: Platoon[],
  gold: number,
  food = 0,
  ownerId: number | null = 0,
  opts: SettlementOpts = {},
): SettlementState {
  return {
    ...makeSettlement(id, ownerId, 5, 5, {
      gold,
      warehouse: emptyWarehouse({ food }),
      morale: opts.morale ?? 100,
    }),
    stacks,
    garrisonUnpaidSinceDay: opts.unpaidSinceDay ?? null,
    garrisonUnpaidTroops: opts.unpaidTroops ?? 0,
    garrisonUnpaidGold: opts.unpaidGold ?? 0,
  };
}

function chargeGarrison(settlement: SettlementState, day: number, extra: Partial<GarrisonUpkeepOptions> = {}): SettlementState {
  return applyGarrisonUpkeep({ [settlement.id]: settlement }, {
    unitTypes: UNIT_TYPES,
    day,
    round: 3,
    castleSeed: 99,
    ...extra,
  })[settlement.id];
}

function chargeStreak(settlement: SettlementState, startDay: number, charges: number): SettlementState {
  let cur = settlement;
  for (let i = 0; i < charges; i++) cur = chargeGarrison(cur, startDay + i * 7);
  return cur;
}

function countOf(stacks: readonly Platoon[], unitTypeId: string): number {
  let n = 0;
  for (const p of stacks) for (const e of p.entries) if (e.unitTypeId === unitTypeId) n += e.count;
  return n;
}

test("garrisonUpkeep: a covered treasury pays the per-unit catalog bill in gold and food", () => {
  const stacks: Platoon[] = [
    { entries: [{ unitTypeId: "swordsman", count: 7 }] },
    { entries: [{ unitTypeId: "archer", count: 5 }] },
  ];
  const after = chargeGarrison(settlementWithStacks("s0", stacks, 100, 50), 7);
  assert.equal(after.gold, 100 - 24, "7 x 2g swordsmen + 5 x 2g archers");
  assert.equal(after.warehouse.food, 50 - 19, "7 x 2f swordsmen + 5 x 1f archers");
  assert.equal(platoonTroopTotal(settlementStacks(after)), 12, "the garrison survives when gold covers upkeep");
  assert.equal(after.morale, 100);
  assert.equal(after.garrisonUnpaidSinceDay, null);
});

test("garrisonUpkeep: a paid charge clears a previous shortfall but never restores morale", () => {
  const stacks: Platoon[] = [{ entries: [{ unitTypeId: "swordsman", count: 10 }] }];
  const after = chargeGarrison(
    settlementWithStacks("s0", stacks, 40, 40, 0, { morale: 62, unpaidSinceDay: 3, unpaidTroops: 4, unpaidGold: 8 }),
    14,
  );
  assert.equal(after.gold, 20);
  assert.equal(after.warehouse.food, 20);
  assert.equal(after.morale, 62, "morale does not recover when the bill is paid");
  assert.equal(after.garrisonUnpaidSinceDay, null);
  assert.equal(after.garrisonUnpaidTroops, 0);
  assert.equal(after.garrisonUnpaidGold, 0);
});

test("garrisonUpkeep: an unpaid charge costs morale but no troops during the two-charge grace", () => {
  const stacks: Platoon[] = [{ entries: [{ unitTypeId: "peasant", count: 12 }] }];
  const first = chargeGarrison(settlementWithStacks("s0", stacks, 0, 0), 7);
  assert.equal(first.gold, 0, "no debt is carried; the treasury just runs dry");
  assert.equal(first.warehouse.food, 0);
  assert.equal(platoonTroopTotal(settlementStacks(first)), 12, "week 1 of the streak never loses a soldier");
  assert.equal(first.morale, 100 - MORALE_UNPAID_LOSS_MAX);
  assert.equal(first.garrisonUnpaidSinceDay, 7);
  assert.equal(first.garrisonUnpaidTroops, 12);
  assert.equal(first.garrisonUnpaidGold, 12);

  const second = chargeGarrison(first, 14);
  assert.equal(platoonTroopTotal(settlementStacks(second)), 12, "week 2 is the last grace week");
  assert.equal(second.morale, 100 - 2 * MORALE_UNPAID_LOSS_MAX);
  assert.equal(second.garrisonUnpaidSinceDay, 7, "the streak start is never moved forward");
});

test("garrisonUpkeep: the third unpaid charge deserts troops worth ~20% of the unfed cost", () => {
  const stacks: Platoon[] = [{ entries: [{ unitTypeId: "peasant", count: 10 }] }];
  const third = chargeStreak(settlementWithStacks("s0", stacks, 0, 0), 7, 3);
  assert.equal(third.garrisonUnpaidGold, 10);
  assert.equal(platoonTroopTotal(settlementStacks(third)), 8, "two 1-gold peasants walk");
  assert.equal(countOf(settlementStacks(third), "peasant"), 8);
  assert.equal(third.morale, 100 - 3 * MORALE_UNPAID_LOSS_MAX);
  assert.equal(third.garrisonUnpaidSinceDay, 7, "the streak start survives the desertion");
});

test("garrisonUpkeep: the morale bleed scales with the value of the unfed troops", () => {
  const stacks: Platoon[] = [
    { entries: [{ unitTypeId: "eagle_prince", count: 8 }] },
    { entries: [{ unitTypeId: "peasant", count: 40 }] },
  ];
  // 120 gold owed, a 45-gold treasury buys every peasant and no Eagle Prince, so
  // 8 troops are unfed and the shortfall is 8 x 10g = 80.
  const after = chargeGarrison(settlementWithStacks("s0", stacks, 45, 500, 0, { unpaidSinceDay: 7 }), 21);
  assert.equal(after.garrisonUnpaidTroops, 8);
  assert.equal(after.garrisonUnpaidGold, 80);
  assert.equal(after.morale, 100 - Math.round(MORALE_UNPAID_LOSS_MAX * (80 / 120)));
  assert.equal(after.gold, 0);
  assert.ok(countOf(settlementStacks(after), "eagle_prince") < 8, "an Eagle Prince is the expensive casualty");
  assert.ok(platoonTroopTotal(settlementStacks(after)) >= 30, "the garrison is bled, not wiped");
});

test("garrisonUpkeep: an empty treasury does not wipe the garrison on the first charge", () => {
  const stacks: Platoon[] = [
    { entries: [{ unitTypeId: "swordsman", count: 12 }] },
    { entries: [{ unitTypeId: "archer", count: 8 }] },
    { entries: [{ unitTypeId: "cavalry", count: 4 }] },
  ];
  const after = chargeStreak(settlementWithStacks("s0", stacks, 3, 100), 7, 3);
  const total = platoonTroopTotal(settlementStacks(after));
  assert.ok(total > 0, "troops only leave once the grace is spent, and only 20% of the cost");
  assert.ok(total >= 18, `at most ~20% of the 56-gold bill's cost leaves, got ${total} troops`);
  for (const p of settlementStacks(after)) {
    for (const e of p.entries) assert.equal(Number.isInteger(e.count), true, "no fractional troop count");
  }
});

test("garrisonUpkeep: unowned settlements are skipped entirely", () => {
  const stacks: Platoon[] = [{ entries: [{ unitTypeId: "swordsman", count: 5 }] }];
  const after = chargeStreak(settlementWithStacks("s0", stacks, 100, 50, null), 7, 4);
  assert.equal(after.gold, 100);
  assert.equal(platoonTroopTotal(settlementStacks(after)), 5);
  assert.equal(after.warehouse.food, 50);
  assert.equal(after.morale, 100);
  assert.equal(after.garrisonUnpaidSinceDay, null);
});

test("garrisonUpkeep: a troop-less settlement is untouched and grows no stacks field", () => {
  const settlement = makeSettlement("s0", 0, 5, 5, { gold: 500, warehouse: emptyWarehouse({ food: 20 }) });
  const after = chargeStreak(settlement, 7, 3);
  assert.equal(after.gold, 500);
  assert.equal(after.warehouse.food, 20);
  assert.equal(after.morale, 100);
  assert.equal(after.stacks, undefined, "no stacks field is manufactured for a garrison-less settlement");
});

test("hero and garrison upkeep resolve identically for the same army, purse and day", () => {
  // Same entity id on both sides => the same deterministic desertion seed, so
  // any divergence here would be a divergence in the RULES, not the draw.
  const stacks: Platoon[] = [
    { entries: [{ unitTypeId: "eagle_prince", count: 3 }] },
    { entries: [{ unitTypeId: "peasant", count: 20 }] },
  ];
  const hero: HeroState = {
    ...makeHero("x0", 0, 2, 2, { gold: 20, troops: 23, stacks }),
    morale: 100,
    upkeepUnpaidSinceDay: null,
    upkeepUnpaidTroops: 0,
    upkeepUnpaidGold: 0,
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 60 },
  };
  const settlement = settlementWithStacks("x0", stacks, 20, 60);
  const heroAfter = applyHeroUpkeep({ x0: hero }, {
    unitTypes: UNIT_TYPES, day: 21, round: 3, castleSeed: 99,
  }).x0;
  const settlementAfter = applyGarrisonUpkeep({ x0: settlement }, {
    unitTypes: UNIT_TYPES, day: 21, round: 3, castleSeed: 99,
  }).x0;
  assert.equal(heroAfter.gold, settlementAfter.gold);
  assert.equal(heroAfter.morale, settlementAfter.morale);
  assert.equal(heroAfter.upkeepUnpaidSinceDay, settlementAfter.garrisonUnpaidSinceDay);
  assert.equal(heroAfter.upkeepUnpaidTroops, settlementAfter.garrisonUnpaidTroops);
  assert.equal(heroAfter.upkeepUnpaidGold, settlementAfter.garrisonUnpaidGold);
  assert.equal(heroAfter.troops, platoonTroopTotal(settlementStacks(settlementAfter)));
  assert.deepEqual(
    normalizePlatoons(heroAfter.stacks).map((p) => p.entries),
    normalizePlatoons(settlementStacks(settlementAfter)).map((p) => p.entries),
    "the two copies of the rule produce the same desertion draw",
  );
});

test("wire-check: applyWeeklyUpkeep applies garrison upkeep alongside hero upkeep", () => {
  const covered = settlementWithStacks(
    "s0",
    [
      { entries: [{ unitTypeId: "swordsman", count: 7 }] },
      { entries: [{ unitTypeId: "archer", count: 5 }] },
    ],
    100,
    50,
  );
  const short = settlementWithStacks(
    "s1",
    [{ entries: [{ unitTypeId: "peasant", count: 24 }] }],
    3,
    0,
  );
  const hero = {
    ...makeHero("h0", 0, 2, 2, { gold: 100, troops: 10, stacks: [{ entries: [{ unitTypeId: "peasant", count: 10 }] }] }),
    morale: 100,
    upkeepUnpaidSinceDay: null,
    upkeepUnpaidTroops: 0,
    upkeepUnpaidGold: 0,
  };
  const unitTypes = UNIT_TYPES;
  const after = applyWeeklyUpkeep(
    makeState({ settlements: [covered, short], heroes: [hero], round: 4, day: 7 }),
    0.1,
    unitTypes,
  );
  assert.equal(after.settlements.s0.gold, 76, "24 catalog gold for the covered garrison");
  assert.equal(platoonTroopTotal(settlementStacks(after.settlements.s0)), 12);
  assert.equal(after.settlements.s1.gold, 0, "a 3-gold treasury cannot pay for 24 troops");
  assert.equal(
    platoonTroopTotal(settlementStacks(after.settlements.s1)),
    24,
    "the shortfall only bites morale on the first charge; nobody walks yet",
  );
  assert.equal(after.settlements.s1.garrisonUnpaidSinceDay, 7);
  assert.equal(after.settlements.s1.morale, 100 - MORALE_UNPAID_LOSS_MAX);
  assert.equal(after.heroes.h0.gold, 90);
  assert.equal(after.heroes.h0.troops, 10);
  assert.equal(after.dirty, true);
});

test("wire-check: a catalog-less weekly charge falls back to the flat 1 gold / 1 food default", () => {
  const hero = {
    ...makeHero("h0", 0, 2, 2, { gold: 100, troops: 10, stacks: [{ entries: [{ unitTypeId: "eagle_prince", count: 10 }] }] }),
    morale: 100,
    upkeepUnpaidSinceDay: null,
    upkeepUnpaidTroops: 0,
    upkeepUnpaidGold: 0,
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 100 },
  };
  const after = applyWeeklyUpkeep(makeState({ heroes: [hero], round: 4, day: 7 }), 0.1);
  assert.equal(after.heroes.h0.gold, 90, "unknown unit ids bill at units.ts's 1-gold default");
  assert.equal(after.heroes.h0.upkeepUnpaidSinceDay, null);
  assert.equal(after.heroes.h0.morale, 100);
});