import { test } from "node:test";
import assert from "node:assert/strict";
import type { HeroState, Platoon, SettlementId, SettlementState } from "@heroes/contracts";
import {
  applySuppliedHeroUpkeep,
  evaluateGarrisonUpkeep,
  evaluateSuppliedHeroUpkeep,
  type HeroUpkeepOptions,
  type UnitType,
} from "@heroes/engine";
import { emptyWarehouse, makeHero, makeSettlement } from "../charter/_helpers";

// ── The bug this file pins ────────────────────────────────────────────────
// The bug: a hero's larder showed 100 food in the hero info panel, yet every
// end turn still warned "unfed troops" and the larder never decreased. The
// weekly charge (applySuppliedHeroUpkeep) is correct and was not the culprit:
// the streak had been stamped at day 7 while the larder was still 0 (the food
// caravan loaded out of the castle that same tick and had not arrived yet),
// the charge is weekly (day % 7 === 0), so the persisted streak stayed set
// until day 14 -- and every warning surface read that stale streak instead of
// asking what the next charge WOULD see against the now-funded larder.
//
// These tests pin both halves of that: the read-side evaluators answer the
// current question, and the charge itself consumes the larder at the next
// weekly boundary and clears the streak.

// The real catalog's upkeep numbers (server/migrations/021_upkeep_shortfall.sql):
// upkeep_gold = tier, upkeep_food = clamp(ceil(tier / 2), 1, 3). The reported
// live game was 12 swordsman + 2 cavalry = (24 + 10) gold / (12 + 6) food =
// 34 gold / 18 food per weekly charge.
type UnitTier = 1 | 2 | 3 | 4 | 5 | 6 | 7;

function tierUnit(id: string, tier: UnitTier): UnitType {
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
};

const OPTIONS: HeroUpkeepOptions = { unitTypes: CATALOG, round: 14, castleSeed: 0 };

/** The reported army: 12 swordsman (2g/1f) + 2 cavalry (5g/3f) = 34g / 18f. */
function reportedStacks(): Platoon[] {
  return [
    { entries: [{ unitTypeId: "swordsman", count: 12 }] },
    { entries: [{ unitTypeId: "cavalry", count: 2 }] },
  ];
}

interface HeroOpts {
  gold?: number;
  food?: number;
  morale?: number;
  unpaidSinceDay?: number | null;
  unpaidTroops?: number;
  unpaidGold?: number;
}

/** A hero in the field: own settlement elsewhere, streak stamped at day 7. */
function fieldHero(opts: HeroOpts = {}): HeroState {
  const stacks = reportedStacks();
  const base = makeHero("h0", 0, 7, 7, {
    gold: opts.gold ?? 366,
    troops: 14,
    stacks,
    morale: opts.morale ?? 75,
    upkeepUnpaidSinceDay: opts.unpaidSinceDay ?? 7,
    upkeepUnpaidTroops: opts.unpaidTroops ?? 0,
    upkeepUnpaidGold: opts.unpaidGold ?? 0,
  });
  return {
    ...base,
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: opts.food ?? 100 },
  };
}

/** The owner's town at a DIFFERENT hex: never a legal source, by the narrow rule. */
function distantTown(): Record<SettlementId, SettlementState> {
  return {
    s0: makeSettlement("s0", 0, 2, 3, { warehouse: emptyWarehouse({ food: 837 }) }),
  };
}

function settlementWithStacks(
  id: SettlementId,
  stacks: Platoon[],
  gold: number,
  food: number,
  ownerId: number | null = 0,
  q = 4,
  r = 4,
): SettlementState {
  return {
    ...makeSettlement(id, ownerId, q, r, {
      gold,
      warehouse: emptyWarehouse({ food }),
    }),
    stacks,
  };
}

test("read-side: a stocked larder funds the hero at the next charge", () => {
  // The live-game fixture verbatim: 100 food in the larder, a fully funded
  // purse, a stale day-7 streak -- and a well-stocked town eleven hexes away
  // that the narrow rule would never draw. Nothing about the read cares where
  // the food came from; it only answers "would the next charge see this fed?".
  const hero = fieldHero();
  const evaluation = evaluateSuppliedHeroUpkeep(hero, distantTown(), CATALOG);
  assert.equal(evaluation.troops, 14);
  assert.equal(evaluation.costGold, 34, "12 x 2g swordsmen + 2 x 5g cavalry");
  assert.equal(evaluation.costFood, 18, "12 x 1f swordsmen + 2 x 3f cavalry");
  assert.equal(evaluation.unfed, 0, "the larder covers the whole food bill");
});

test("charge: the weekly charge consumes the stocked larder and clears the streak", () => {
  // The user's core doubt, pinned the other way round: the larder IS eaten at
  // the next weekly charge, exactly as expected, and the funded charge clears
  // the stale streak instead of leaving the warning to fire forever.
  const hero = fieldHero();
  const settlements = distantTown();
  const result = applySuppliedHeroUpkeep({ [hero.id]: hero }, settlements, { ...OPTIONS, day: 14 });
  const after = result.heroes[hero.id];
  assert.equal(after.resources?.food, 100 - 18, "the larder paid the food half of the bill");
  assert.equal(after.gold, 366 - 34, "the purse paid the gold half");
  assert.equal(after.upkeepUnpaidSinceDay, null, "a funded charge clears the streak");
  assert.equal(after.upkeepUnpaidTroops, 0);
  assert.equal(after.upkeepUnpaidGold, 0);
  assert.equal(after.morale, 75, "morale is never restored by a paid charge");
  assert.equal(after.troops, 14, "nobody deserts a paid charge");
  assert.equal(
    result.settlements.s0.warehouse.food,
    837,
    "the distant town is not a source -- nothing travels",
  );
});

test("read-side: an empty larder in the field leaves the hero unfed", () => {
  const broke = fieldHero({ gold: 0, food: 0 });
  assert.ok(evaluateSuppliedHeroUpkeep(broke, distantTown(), CATALOG).unfed > 0);

  // Gold plentiful but food 0: food starves its own count, so a rich purse does
  // not hide an empty larder.
  const richAndHungry = fieldHero({ gold: 5000, food: 0 });
  assert.ok(evaluateSuppliedHeroUpkeep(richAndHungry, distantTown(), CATALOG).unfed > 0);
});

test("read-side: the settlement under the hero funds the bill", () => {
  const stacks = reportedStacks();
  const heroAt = (q: number, r: number): HeroState => ({
    ...makeHero("h0", 0, q, r, { gold: 1000, troops: 14, stacks, morale: 100 }),
    resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
  });

  const own = evaluateSuppliedHeroUpkeep(
    heroAt(4, 4),
    { s0: settlementWithStacks("s0", [], 0, 50, 0, 4, 4) },
    CATALOG,
  );
  assert.equal(own.unfed, 0, "the city under the hero's boots is the one legal source");

  const neutral = evaluateSuppliedHeroUpkeep(
    heroAt(4, 4),
    { s0: settlementWithStacks("s0", [], 0, 50, null, 4, 4) },
    CATALOG,
  );
  assert.ok(neutral.unfed > 0, "a neutral town is nobody's bill and nobody's larder");

  const enemy = evaluateSuppliedHeroUpkeep(
    heroAt(4, 4),
    { s0: settlementWithStacks("s0", [], 0, 50, 1, 4, 4) },
    CATALOG,
  );
  assert.ok(enemy.unfed > 0, "another seat's warehouse is not this hero's larder");
});

test("read-side: the garrison twin reads treasury + warehouse as its purse and larder", () => {
  const stacks: Platoon[] = [{ entries: [{ unitTypeId: "swordsman", count: 6 }] }];

  const covered = evaluateGarrisonUpkeep(settlementWithStacks("s0", stacks, 100, 50), CATALOG);
  assert.equal(covered.troops, 6);
  assert.equal(covered.costGold, 12, "6 x 2g");
  assert.equal(covered.costFood, 6, "6 x 1f");
  assert.equal(covered.unfed, 0, "a funded town is fed at the next charge");

  const broke = evaluateGarrisonUpkeep(settlementWithStacks("s0", stacks, 0, 0), CATALOG);
  assert.ok(broke.unfed > 0, "an empty treasury and an empty warehouse starve the garrison");

  const empty = evaluateGarrisonUpkeep(settlementWithStacks("s0", [], 500, 90), CATALOG);
  assert.equal(empty.troops, 0, "no garrison, no bill");
  assert.equal(empty.unfed, 0);
});

test("read-side: the read is pure and never mutates its inputs", () => {
  const hero = fieldHero();
  const settlements = distantTown();
  const heroBefore = JSON.stringify(hero);
  const settlementsBefore = JSON.stringify(settlements);
  evaluateSuppliedHeroUpkeep(hero, settlements, CATALOG);
  evaluateGarrisonUpkeep(settlements.s0, CATALOG);
  assert.equal(JSON.stringify(hero), heroBefore);
  assert.equal(JSON.stringify(settlements), settlementsBefore);
});
