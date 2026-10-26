import type { HeroState, SettlementState, WarehouseResource } from "@heroes/contracts";
import { WAREHOUSE_RESOURCES } from "@heroes/contracts";
import { buildingUpkeepRequired, foodRequired, settlementProductionRates } from "@heroes/engine";

// The settlement panel's per-day numbers, as data.
//
// Two rows in that panel were asking the player to do arithmetic the engine
// already does. The warehouse printed a bare stock with no indication of which
// way it was moving -- a stock that drops every turn and one that climbs look
// identical. The top "Food" row printed `stock / required`, a ratio with no
// unit, which reads as a capacity readout rather than the per-day balance it
// is. Every stock the panel renders now goes through here, so the arithmetic is
// unit-testable without a DOM (the bankRows.ts / treasuryCap.ts seam pattern).
//
// The production half is `settlementProductionRates()` -- literally the loop
// body `produceSettlementResources()` runs -- so the rate on screen cannot
// drift from the rate the turn pays (the reason the logistics panel reads the
// same function). The drain half is what the consumption step charges:
// building upkeep in wood and stone, and food for the population. Iron and
// arcane have no sink, so their net is their production.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface ResourceDailyRate {
  resource: WarehouseResource;
  /** Warehouse stock right now. */
  stock: number;
  /** What tile rates and producer buildings add per day. */
  produced: number;
  /** What the settlement spends per day: building upkeep (wood/stone), population food. */
  spent: number;
  /** produced - spent. Negative means the stock is draining. */
  net: number;
}

export interface SettlementDailyRates {
  /** One entry per WAREHOUSE_RESOURCE, in warehouse order (wood, stone, iron, arcane, food). */
  rows: ResourceDailyRate[];
  /** The food entry of `rows` -- the top section's balance row. */
  food: ResourceDailyRate;
}

/**
 * Per-day production, drain and net for every warehouse resource.
 *
 * `seed` is the game seed the production loop passes (`state.castleSeed`
 * client-side) and `heroes` is the state's hero map, which the loop uses to
 * decide whether a district is cut off -- both must be the values the turn
 * itself uses or the panel advertises production the turn never pays.
 */
export function settlementDailyRates(
  settlement: SettlementState,
  seed: number,
  heroes?: Iterable<HeroState> | Record<string, HeroState>,
): SettlementDailyRates {
  const produced = new Map<WarehouseResource, number>();
  for (const { resource, perTurn } of settlementProductionRates(settlement, seed, heroes).rates) {
    produced.set(resource, perTurn);
  }
  // Drains are OWNED settlements only. The consumption step runs inside
  // `applyEndOfTurnDetailed`'s `if (s.ownerId !== playerId) continue;` loop, so
  // a neutral never eats and never pays building upkeep -- its warehouse only
  // grows. Charging a neutral here would advertise a bill the turn loop never
  // charges, which is the drift this module exists to prevent.
  const upkeep = settlement.ownerId === null ? { wood: 0, stone: 0 } : buildingUpkeepRequired(settlement);
  const spent: Partial<Record<WarehouseResource, number>> = {
    wood: upkeep.wood,
    stone: upkeep.stone,
    food: settlement.ownerId === null ? 0 : foodRequired(settlement),
  };

  const entryFor = (resource: WarehouseResource): ResourceDailyRate => {
    const producedPerDay = round2(produced.get(resource) ?? 0);
    const spentPerDay = round2(spent[resource] ?? 0);
    return {
      resource,
      stock: settlement.warehouse[resource] ?? 0,
      produced: producedPerDay,
      spent: spentPerDay,
      net: round2(producedPerDay - spentPerDay),
    };
  };

  return { rows: WAREHOUSE_RESOURCES.map(entryFor), food: entryFor("food") };
}

/** A rate with no sign, trailing zeros trimmed: 3, 2.5, 0. */
export function formatRate(value: number): string {
  return String(round2(value));
}

/** A signed per-day rate: "+3/day", "-4/day", "+0/day". */
export function formatDailyRate(net: number): string {
  const sign = net >= 0 ? "+" : "-";
  return `${sign}${formatRate(Math.abs(net))}/day`;
}

/**
 * Hover text for the Population row: the number, the ceiling it is filling, and
 * what the ceiling is made of. The row this belongs to used to print the bare
 * population, so "why is my town not growing?" had no answer on screen
 * (C-MINOR-2). `cap` is the engine's own `settlementPopulationCap`, `districtBonus`
 * the part of it that comes from housing in the settlement's districts, and
 * `levelBase` the level's own cap.
 */
export function populationCapTitle(
  population: number,
  cap: number,
  levelBase: number,
  districtBonus: number,
): string {
  const made =
    districtBonus > 0
      ? `${levelBase.toLocaleString()} from the settlement's level cap plus ${districtBonus.toLocaleString()} from housing in its districts`
      : `${levelBase.toLocaleString()} from the settlement's level cap (housing inside the main city adds nothing)`;
  const verdict =
    population >= cap
      ? " At the cap: population grows no further until the settlement's level rises or more housing is built in a district."
      : " Grows weekly while the warehouse can feed it, and stops at the cap.";
  return `Population ${population.toLocaleString()} of ${cap.toLocaleString()} — ${made}.${verdict}`;
}

export function resourceLabel(resource: WarehouseResource): string {
  return resource.charAt(0).toUpperCase() + resource.slice(1);
}

/** Hover text for one warehouse row: what makes it, what spends it, and the balance. */
export function dailyRateTitle(rate: ResourceDailyRate): string {
  const parts = [`${resourceLabel(rate.resource)} stock ${rate.stock.toLocaleString()}.`];
  if (rate.produced <= 0 && rate.spent <= 0) {
    parts.push("Nothing is produced or spent per day.");
    return parts.join(" ");
  }
  if (rate.produced > 0) parts.push(`${formatRate(rate.produced)}/day produced by tile rates and producers.`);
  if (rate.spent > 0) {
    parts.push(
      rate.resource === "food"
        ? `${formatRate(rate.spent)}/day eaten by the population.`
        : `${formatRate(rate.spent)}/day spent on building upkeep.`,
    );
  }
  parts.push(`Net ${formatDailyRate(rate.net)}.`);
  return parts.join(" ");
}

/**
 * Hover text for the top section's Food row. The question that row has to
 * answer is "am I making more than I eat", so it names both halves in the same
 * unit (per day) and then the verdict.
 */
export function foodBalanceTitle(rate: ResourceDailyRate, population: number): string {
  const made =
    rate.produced > 0
      ? `${formatRate(rate.produced)}/day made by farms and tile rates`
      : "nothing made by farms or tile rates";
  const eaten =
    rate.spent > 0
      ? `${formatRate(rate.spent)}/day eaten by ${population.toLocaleString()} population`
      : "nothing eaten";
  const verdict =
    rate.net < 0
      ? " The settlement is running a deficit: morale falls whenever the warehouse is empty."
      : rate.net > 0
        ? " The surplus accumulates in the warehouse."
        : " Production exactly matches what the population eats.";
  return `Food stock ${rate.stock.toLocaleString()}: ${made}, ${eaten} — net ${formatDailyRate(rate.net)}.${verdict}`;
}
