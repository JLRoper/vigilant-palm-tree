import type { Platoon } from "@heroes/contracts";
import { hashString, mulberry32 } from "../rng";
import {
  desertTroopsByCost,
  platoonTroopTotal,
  unitUpkeepFood,
  unitUpkeepGold,
  type UnitType,
} from "../units";
import { clampMorale } from "./consumption";

// ── Weekly troop upkeep (the morale / desertion rule) ─────────────────────
// One charge per calendar week (turn/round.ts fires on day % 7 === 0),
// charged against a hero's purse + wagon cargo, or a settlement's treasury +
// warehouse food. Heroes and garrisons run the SAME rules through this
// module: the two call sites (hero/upkeep.ts, settlement/garrisonUpkeep.ts)
// only map their own entity fields in and out, so the two copies cannot
// drift.
//
// The rule, in order, per charge:
//   1. total the weekly gold/food bill from the per-unit catalog upkeep
//      (never a flat 1g/1f);
//   2. count the troops the purse (or the larder) could not cover -- gold and
//      food each starve their own count and the WORSE of the two wins, since
//      one unfed soldier is still one unfed soldier;
//   3. paid in full -> clear the shortfall bookkeeping, morale unchanged;
//   4. short -> stamp the first-unpaid day, bleed morale in proportion to how
//      much VALUE the unfed troops represent, then pay whatever IS there
//      (clamped at 0 -- no debt is carried across charges);
//   5. only after DESERT_GRACE_WEEKS do troops actually leave, and then only
//      20% of the unfed shortfall's COST per week.

// Upkeep is a weekly charge, so one "week" of an unpaid streak is exactly this
// many days; the grace is denominated in charges, not days.
export const UPKEEP_CHARGE_DAYS = 7;
// Ceiling on the weekly morale bleed for a fully unfed army ("medium
// punishing" -- a bankrupt force loses a quarter of its morale every week).
export const MORALE_UNPAID_LOSS_MAX = 25;
// Unpaid weeks before anyone walks. Two weekly charges ~= 14 days; the naive
// one-week grace was doubled because a single missed payment is almost always
// a timing accident, and deserting an army over one is a death spiral.
export const DESERT_GRACE_WEEKS = 2;
// Fraction of the unfed shortfall's weekly COST that deserts per week once the
// gate is open. Expressed in cost, not headcount, so an Eagle Prince counts
// as many peasants.
export const DESERT_COST_SHARE = 0.2;

export interface TroopUpkeepEvaluation {
  /** Headcount the bill was computed from -- platoonTroopTotal(stacks). */
  troops: number;
  costGold: number;
  costFood: number;
  /** Troops the gold or the food could not cover. 0 = paid in full. */
  unfed: number;
  /** Weekly gold cost attributable to those unfed troops (the deficit magnitude). */
  unfedCostGold: number;
  /** unfedCostGold / max(totalCostGold, 1), clamped to 0..1 by construction. */
  share: number;
}

export interface TroopUpkeepCarrier {
  id: string;
  stacks: Platoon[];
  gold: number;
  food: number;
  morale: number;
  unpaidSinceDay: number | null;
  unpaidTroops: number;
  unpaidGold: number;
}

export interface TroopUpkeepOptions {
  /** Catalog id -> UnitType. Omitting it falls back to units.ts's per-unit
   *  1g/1f defaults, which is the pre-catalog behaviour. */
  unitTypes?: Record<string, UnitType>;
  day?: number;
  round?: number;
  castleSeed?: number;
}

export interface TroopUpkeepResolution extends TroopUpkeepCarrier {
  /** Headcount recomputed from `stacks` -- never carried over as a scalar. */
  troops: number;
  /** True only when desertion actually rewrote the stacks. */
  deserted: boolean;
}

// The weekly bill and the shortfall it produces. `availableGold`/`availableFood`
// are the pre-charge stocks; the caller clamps the post-charge result.
export function evaluateTroopUpkeep(
  stacks: readonly Platoon[],
  unitTypes: Record<string, UnitType>,
  availableGold: number,
  availableFood: number,
): TroopUpkeepEvaluation {
  const troops = platoonTroopTotal(stacks);
  const buckets = new Map<string, UnitBucket>();
  let costGold = 0;
  let costFood = 0;
  for (const p of stacks) {
    for (const e of p.entries) {
      if (e.count <= 0) continue;
      costGold += e.count * unitUpkeepGold(unitTypes[e.unitTypeId]);
      costFood += e.count * unitUpkeepFood(unitTypes[e.unitTypeId]);
      const bucket = buckets.get(e.unitTypeId);
      if (bucket) bucket.count += e.count;
      else {
        buckets.set(e.unitTypeId, {
          goldCost: unitUpkeepGold(unitTypes[e.unitTypeId]),
          foodCost: unitUpkeepFood(unitTypes[e.unitTypeId]),
          count: e.count,
        });
      }
    }
  }
  const all = [...buckets.values()];
  // How many troops the purse / the larder can actually feed: cheapest units
  // first, whole units only. With a flat 1g/1f catalog (the pre-catalog
  // default) this is exactly `min(troops, floor(stock))`; it only differs once
  // upkeepGold/upkeepFood vary per unit, where comparing the stock against the
  // raw HEADCOUNT would let a mixed army underpay its bill for free.
  const unpaidByGold = troops - affordableHeadcount(all, availableGold, (b) => b.goldCost);
  const noFoodTroops = troops - affordableHeadcount(all, availableFood, (b) => b.foodCost);
  // One unfed soldier is one unfed soldier whichever shortage caused it, so the
  // worse of gold and food wins.
  const unfed = Math.max(unpaidByGold, noFoodTroops);
  const unfedCostGold = unfedWeeklyCostGold(all, unfed);
  return {
    troops,
    costGold,
    costFood,
    unfed,
    unfedCostGold,
    share: unfedCostGold / Math.max(costGold, 1),
  };
}

interface UnitBucket {
  /** Per-unit weekly upkeep in gold and in food. */
  goldCost: number;
  foodCost: number;
  count: number;
}

// Cheapest-units-first fill of a stock: whole units only, so a purse of 3.5
// gold cannot buy a 4th 1-gold soldier. Budgets are floored for the same
// reason (gold/food are integers; a fraction cannot buy a fraction of a man).
function affordableHeadcount(
  buckets: readonly UnitBucket[],
  stock: number,
  costOf: (bucket: UnitBucket) => number,
): number {
  let remaining = Math.max(0, Math.floor(stock));
  let fed = 0;
  const ordered = [...buckets].sort((a, b) => costOf(a) - costOf(b));
  for (const bucket of ordered) {
    if (remaining <= 0) break;
    const perUnit = costOf(bucket);
    if (perUnit <= 0) {
      fed += bucket.count;
      continue;
    }
    const buyable = Math.min(bucket.count, Math.floor(remaining / perUnit));
    fed += buyable;
    remaining -= buyable * perUnit;
  }
  return fed;
}

// Which troops the money "didn't reach". Gold is fungible, so there is no
// literal cutoff position in the army -- the defensible reading is that the
// purse runs out at the TOP of the bill: the unfed troops are the most
// expensive `unfed` units. That is also the only reading under which the
// design's "cheap troops cost the 1-point floor, expensive unpaid troops hit
// hard" holds: an unpaid Eagle Prince (10g) among 100 peasants carries a 10g
// deficit, while an unpaid peasant among the same army carries 1g.
//
// Bucketed by unit type (not expanded per unit) so a 500-strong army stays
// O(distinct types). The sorts are stable, so equal-cost buckets keep their
// first-seen stack order and every number is reproducible run to run.
function unfedWeeklyCostGold(buckets: readonly UnitBucket[], unfed: number): number {
  if (unfed <= 0) return 0;
  const ordered = [...buckets].sort((a, b) => b.goldCost - a.goldCost);
  let remaining = unfed;
  let total = 0;
  for (const bucket of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(bucket.count, remaining);
    total += take * bucket.goldCost;
    remaining -= take;
  }
  return total;
}

// Morale bleed for one unpaid charge: proportional to the share of the weekly
// bill that went unpaid, with a 1-point floor so any shortfall is felt and a
// MORALE_UNPAID_LOSS_MAX ceiling so a fully unfed army is punished but not
// deleted from the fight.
export function unpaidMoraleLoss(unfedCostGold: number, totalCostGold: number): number {
  const share = unfedCostGold / Math.max(totalCostGold, 1);
  const floor = share > 0 ? 1 : 0;
  return Math.max(floor, Math.min(MORALE_UNPAID_LOSS_MAX, Math.round(MORALE_UNPAID_LOSS_MAX * share)));
}

// Whole charges elapsed since the first unpaid one. 0 on the charge that
// started the streak, 1 on the second, 2 (the gate) on the third.
export function weeksUnpaid(currentDay: number, unpaidSinceDay: number | null): number {
  if (unpaidSinceDay === null) return 0;
  return Math.max(0, Math.floor((currentDay - unpaidSinceDay) / UPKEEP_CHARGE_DAYS));
}

export function desertionGateOpen(currentDay: number, unpaidSinceDay: number | null): boolean {
  return weeksUnpaid(currentDay, unpaidSinceDay) >= DESERT_GRACE_WEEKS;
}

// Per-entity, per-charge seed. Everything is either persisted state or a
// stable id, so the server replays a charge bit-for-bit: no Math.random, no
// shared cursor whose position depends on how many other entities were
// charged first.
export function upkeepSeed(castleSeed: number, round: number, day: number, entityId: string): number {
  return (castleSeed ^ Math.imul(round, 2654435761) ^ Math.imul(day, 40503) ^ hashString(entityId)) >>> 0;
}

// The single upkeep implementation both heroes and garrisons run. `stacks` is
// the caller's already-normalized working copy; the returned `stacks` is the
// SAME reference unless desertion rewrote it, so callers that must not
// manufacture a stacks field (settlements with no garrison row) can test
// `deserted` instead of comparing identities.
export function resolveTroopUpkeep(
  carrier: TroopUpkeepCarrier,
  options: TroopUpkeepOptions = {},
): TroopUpkeepResolution {
  const unitTypes = options.unitTypes ?? {};
  const day = options.day ?? 0;
  const evalResult = evaluateTroopUpkeep(carrier.stacks, unitTypes, carrier.gold, carrier.food);
  // No debt is carried between charges: whatever is missing is simply gone
  // (clamped at 0), matching applySettlementConsumption's floor-at-zero rule.
  const gold = Math.max(0, carrier.gold - evalResult.costGold);
  const food = Math.max(0, carrier.food - evalResult.costFood);

  if (evalResult.unfed <= 0) {
    return {
      ...carrier,
      stacks: carrier.stacks,
      troops: evalResult.troops,
      gold,
      food,
      morale: clampMorale(carrier.morale),
      unpaidSinceDay: null,
      unpaidTroops: 0,
      unpaidGold: 0,
      deserted: false,
    };
  }

  const unpaidSinceDay = carrier.unpaidSinceDay ?? day;
  const morale = clampMorale(carrier.morale - unpaidMoraleLoss(evalResult.unfedCostGold, evalResult.costGold));
  if (!desertionGateOpen(day, unpaidSinceDay)) {
    return {
      ...carrier,
      stacks: carrier.stacks,
      troops: evalResult.troops,
      gold,
      food,
      morale,
      unpaidSinceDay,
      unpaidTroops: evalResult.unfed,
      unpaidGold: evalResult.unfedCostGold,
      deserted: false,
    };
  }

  // Math.ceil so any non-zero deficit costs at least one unit, however small.
  const desertValue = Math.ceil(DESERT_COST_SHARE * evalResult.unfedCostGold);
  const rng = mulberry32(upkeepSeed(options.castleSeed ?? 0, options.round ?? 0, day, carrier.id));
  const desertion = desertTroopsByCost(carrier.stacks, desertValue, unitTypes, rng);
  return {
    ...carrier,
    stacks: desertion.stacks,
    troops: platoonTroopTotal(desertion.stacks),
    gold,
    food,
    morale,
    unpaidSinceDay,
    unpaidTroops: evalResult.unfed,
    unpaidGold: evalResult.unfedCostGold,
    deserted: desertion.removed > 0,
  };
}