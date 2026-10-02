import type {
  GameState,
  HeroState,
  SettlementState,
  TradeRouteId,
  TradeRouteState,
} from "@heroes/contracts";
import {
  DESERT_COST_SHARE,
  desertionGateOpen,
} from "./troopUpkeep";

// ── Weekly caravan maintenance (Phase 3, paid FIRST) ───────────────────────
// Caravans are the designer's first-priority consumer ("whether they're with
// a hero, or on a trade-route, they are the first to get paid so they start
// deserting last"): turn/round.ts's applyWeeklyUpkeep slots this charge BEFORE
// hero upkeep, so on a shortage week the caravans are paid and the HERO is
// the one going unfed. "Paid first so they desert last" is an ordering
// guarantee inside that one function, not a separate mechanic.
//
// The rule, in order, per route:
//   1. bill wagons × (gold + food) per wagon — both constants are 1;
//   2. pay out of the ORIGIN endpoint's store — settlement: treasury gold +
//      warehouse food; hero: purse + larder — clamped to what is actually
//      there, never into debt (the same floor-at-zero rule as every other
//      upkeep charge);
//   3. paid in full -> the unpaid streak clears to null;
//   4. short -> stamp the first-unpaid day; nothing deserts yet;
//   5. after DESERT_GRACE_WEEKS (2, the shared troop-upkeep constant) of
//      unpaid charges, lose max(1, ceil(wagons × DESERT_COST_SHARE)) wagons
//      per unpaid week. Deserted wagons are GONE — they walked off with the
//      caravan hands and are deliberately NOT returned to the player's pool
//      (this deviates from the master plan's assumption-1 "returns wagons"
//      half on purpose; wagons only ever re-enter the pool via a manual
//      updateTradeRoute({remove:true}) disband, which is that rule's other
//      half and is unchanged).
//   6. wagons reaching 0 removes the route outright.
//
// Which routes bill: every route holding wagons, whether its caravan is in
// flight (caravan !== null), walking home, or loading at the origin
// (caravan === null). The wagons are locked out of the player's pool the
// whole time either way — an idle-at-home caravan is a garrisoned expense,
// not a free one — so "bills" is simply `route.wagons > 0`.
//
// Dead-origin edge: a route whose origin endpoint no longer resolves (the
// origin hero died) is skipped entirely — no bill, no streak change, no
// desertion. logistics.ts's advanceTradeRoutes already handles the caravan
// itself (return-home), and the route's fate stays with the manual remove.

export const CARAVAN_UPKEEP_GOLD_PER_WAGON = 1;
export const CARAVAN_UPKEEP_FOOD_PER_WAGON = 1;

export interface CaravanUpkeepResult {
  state: GameState;
  /** Ids of routes auto-removed this charge (their last wagons deserted). */
  removedRouteIds: TradeRouteId[];
}

/** The weekly gold bill for one route's wagon commitment. */
export function caravanUpkeepGoldBill(wagons: number): number {
  return Math.max(0, wagons) * CARAVAN_UPKEEP_GOLD_PER_WAGON;
}

/** The weekly food bill for one route's wagon commitment. */
export function caravanUpkeepFoodBill(wagons: number): number {
  return Math.max(0, wagons) * CARAVAN_UPKEEP_FOOD_PER_WAGON;
}

/** Wagons lost to desertion on one unpaid charge once the grace gate is open. */
export function caravanDesertion(wagons: number): number {
  return Math.max(1, Math.ceil(Math.max(0, wagons) * DESERT_COST_SHARE));
}

export function applyCaravanUpkeep(state: GameState, day?: number): CaravanUpkeepResult {
  const chargeDay = day ?? state.day;
  const routes = state.tradeRoutes ?? [];
  if (routes.length === 0) return { state, removedRouteIds: [] };

  const nextSettlements: Record<string, SettlementState> = { ...state.settlements };
  const nextHeroes: Record<string, HeroState> = { ...state.heroes };
  let settlementsChanged = false;
  let heroesChanged = false;
  const removedRouteIds: TradeRouteId[] = [];
  const newRoutes: TradeRouteState[] = [];
  let changed = false;

  for (const route of routes) {
    if (route.wagons <= 0) {
      newRoutes.push(route);
      continue;
    }

    const goldBill = caravanUpkeepGoldBill(route.wagons);
    const foodBill = caravanUpkeepFoodBill(route.wagons);
    let paidGold = 0;
    let paidFood = 0;

    if (route.from.kind === "settlement") {
      const origin = nextSettlements[route.from.id];
      if (!origin) {
        // Dead origin: skip maintenance entirely (see module header).
        newRoutes.push(route);
        continue;
      }
      paidGold = Math.min(goldBill, Math.max(0, origin.gold));
      paidFood = Math.min(foodBill, Math.max(0, origin.warehouse.food ?? 0));
      if (paidGold > 0 || paidFood > 0) {
        settlementsChanged = true;
        nextSettlements[route.from.id] = {
          ...origin,
          gold: origin.gold - paidGold,
          warehouse: { ...origin.warehouse, food: (origin.warehouse.food ?? 0) - paidFood },
        };
      }
    } else {
      const origin = nextHeroes[route.from.id];
      if (!origin) {
        newRoutes.push(route);
        continue;
      }
      paidGold = Math.min(goldBill, Math.max(0, origin.gold));
      const larder = origin.resources?.food ?? 0;
      paidFood = Math.min(foodBill, Math.max(0, larder));
      if (paidGold > 0 || paidFood > 0) {
        heroesChanged = true;
        // Cargo food is only rewritten when the hero already carries a
        // larder object — a wagon-less-resources hero never grows one here
        // (the same rule hero/upkeep.ts applies).
        const resources =
          origin.resources && paidFood > 0
            ? { ...origin.resources, food: larder - paidFood }
            : origin.resources;
        nextHeroes[route.from.id] = { ...origin, gold: origin.gold - paidGold, resources };
      }
    }

    const fullyPaid = paidGold >= goldBill && paidFood >= foodBill;
    if (fullyPaid) {
      if (route.unpaidSinceDay == null) {
        newRoutes.push(route);
      } else {
        changed = true;
        newRoutes.push({ ...route, unpaidSinceDay: null });
      }
      continue;
    }

    const unpaidSinceDay = route.unpaidSinceDay ?? chargeDay;
    changed = true;
    if (!desertionGateOpen(chargeDay, unpaidSinceDay)) {
      newRoutes.push(route.unpaidSinceDay === unpaidSinceDay ? route : { ...route, unpaidSinceDay });
      continue;
    }

    // Wagons desert; they are gone, not pooled (module header, rule 5).
    const remaining = route.wagons - caravanDesertion(route.wagons);
    if (remaining <= 0) {
      removedRouteIds.push(route.id);
      continue;
    }
    newRoutes.push({ ...route, wagons: remaining, unpaidSinceDay });
  }

  if (!changed && !settlementsChanged && !heroesChanged && removedRouteIds.length === 0) {
    return { state, removedRouteIds };
  }
  return {
    state: {
      ...state,
      tradeRoutes: newRoutes,
      settlements: settlementsChanged ? nextSettlements : state.settlements,
      ...(heroesChanged ? { heroes: nextHeroes } : {}),
      dirty: true,
    },
    removedRouteIds,
  };
}

// Re-exported here (not re-implemented) so callers can reason about the
// caravan ladder with the same vocabulary as the troop ladder: the streak
// clock is the shared troop-upkeep math and MUST NOT fork.
export {
  DESERT_COST_SHARE as CARAVAN_DESERT_COST_SHARE,
  DESERT_GRACE_WEEKS as CARAVAN_DESERT_GRACE_WEEKS,
  weeksUnpaid as caravanWeeksUnpaid,
} from "./troopUpkeep";
