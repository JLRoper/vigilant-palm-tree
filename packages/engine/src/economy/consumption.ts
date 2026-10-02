import type { SettlementState, Warehouse } from "@heroes/contracts";
import { buildingUpkeep } from "../buildingRegistry";
import { settlementTreasuryCap, treasuryHeadroom } from "../settlement/capacity";

export const FOOD_PER_POPULATION = 100;
export const MORALE_DECAY_PER_DEFICIT_RATIO = 10;
export const LOW_MORALE_EXTRA_DECAY = 1;
export const MORALE_RECOVERY_PER_SUPPLIED_TURN = 4;
export const MORALE_TAX_INCOME_DIVISOR = 100;
export const FOOD_CONSUMED_RESOURCES = ["food", "wood", "stone", "iron", "arcane"] as const;

/**
 * Food a headcount must eat per turn. Split out of `foodRequired` so callers
 * that only know a population -- the starter layout sizing a city's farmland
 * before the settlement exists -- read the same divisor instead of repeating
 * the arithmetic and drifting from it.
 */
export function foodRequiredForPopulation(population: number): number {
  const pop = Number.isFinite(population) ? population : 0;
  return Math.ceil(pop / FOOD_PER_POPULATION);
}

/**
 * Food a GROUP of populations must eat per turn, summed per headcount rather
 * than as `ceil(total / FOOD_PER_POPULATION)`: two settlements of 60 each eat
 * 2, not 1.
 *
 * This is the budget a player's holdings are sized against, not one
 * settlement's. A player who starts with a level-1 keep (500) and a level-2
 * town (1,500) eats 5 + 15 = 20 food/turn out of ONE pool of farms -- the
 * farms live in a single city grid, and auto-trade moves the surplus between
 * the player's own settlements (economy/trade.ts). Sizing farmland against
 * either settlement alone left the pair 5 food/turn short (measured: 29/60
 * seeded games net-negative, 11/60 at morale 0).
 *
 * Neutral settlements (ownerId null) are deliberately NOT a player's bill: they
 * are never consumed from, never morale-decayed and never traded with -- see
 * turn/endTurn.ts, whose consumption loop is gated on `s.ownerId === playerId`,
 * and trade.ts's `unowned_settlement` refusal.
 */
export function foodRequiredForPopulations(populations: Iterable<number>): number {
  let total = 0;
  for (const population of populations) total += foodRequiredForPopulation(population);
  return total;
}

export function foodRequired(s: SettlementState): number {
  return foodRequiredForPopulation(s.population ?? 0);
}

export function buildingUpkeepRequired(s: SettlementState): { wood: number; stone: number } {
  let wood = 0;
  let stone = 0;
  for (const b of s.buildings) {
    const u = buildingUpkeep(b.kind, b.level);
    wood += u.wood;
    stone += u.stone;
  }
  return { wood, stone };
}

export function foodDeficitRatio(s: SettlementState): number {
  const needed = foodRequired(s);
  const have = s.warehouse.food ?? 0;
  if (needed <= 0) return 0;
  return Math.max(0, (needed - have) / Math.max(1, needed));
}

export function suppliesDeficitRatio(s: SettlementState): number {
  const upkeep = buildingUpkeepRequired(s);
  if (upkeep.wood <= 0 && upkeep.stone <= 0) return 0;
  // Per-resource, never pooled: summing `wood + stone` against summed upkeep lets
  // a surplus in one resource mask a total shortfall in the other (0 wood and 300
  // stone against a 5w/14s upkeep read as fully supplied, and the stone shortfall
  // then cost no morale at all).
  const woodRatio =
    upkeep.wood <= 0 ? 0 : Math.max(0, (upkeep.wood - (s.warehouse.wood ?? 0)) / Math.max(1, upkeep.wood));
  const stoneRatio =
    upkeep.stone <= 0 ? 0 : Math.max(0, (upkeep.stone - (s.warehouse.stone ?? 0)) / Math.max(1, upkeep.stone));
  return Math.max(woodRatio, stoneRatio);
}

export function moraleDecay(s: SettlementState): number {
  const decay =
    foodDeficitRatio(s) * MORALE_DECAY_PER_DEFICIT_RATIO +
    suppliesDeficitRatio(s) * MORALE_DECAY_PER_DEFICIT_RATIO;
  const lowMoraleBoost = (s.morale ?? 100) < 50 ? LOW_MORALE_EXTRA_DECAY : 0;
  return decay + lowMoraleBoost;
}

export function effectiveIncome(s: SettlementState): number {
  const morale = clamp(s.morale ?? 100, 0, 100);
  const base = (s.population ?? 0) * (s.goldTax ?? 0);
  return Math.round((base * morale) / MORALE_TAX_INCOME_DIVISOR);
}

export function clampMorale(value: number): number {
  return clamp(value, 0, 100);
}

export function clampWarehouseNonNegative(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function applySettlementConsumption(s: SettlementState): SettlementState {
  const warehouse: Warehouse = { ...s.warehouse };
  const upkeep = buildingUpkeepRequired(s);
  warehouse.food = clampWarehouseNonNegative(warehouse.food - foodRequired(s));
  warehouse.wood = clampWarehouseNonNegative(warehouse.wood - upkeep.wood);
  warehouse.stone = clampWarehouseNonNegative(warehouse.stone - upkeep.stone);
  return { ...s, warehouse };
}

export function applyMoraleDecay(s: SettlementState): SettlementState {
  const decay = moraleDecay(s);
  // Recovery exists so falling behind is recoverable, not permanent: a fully
  // supplied settlement climbs back toward 100, while any shortfall leaves the
  // decay winning outright. The gate is "no food and no supplies shortfall", not
  // `decay === 0` -- LOW_MORALE_EXTRA_DECAY keeps `decay` positive below 50 even
  // with no shortfall at all, which would ratchet a fed settlement down forever.
  const fullySupplied = foodDeficitRatio(s) === 0 && suppliesDeficitRatio(s) === 0;
  const next = (s.morale ?? 100) + (fullySupplied ? MORALE_RECOVERY_PER_SUPPLIED_TURN : -decay);
  return { ...s, morale: clampMorale(Math.round(next)) };
}

export function applyEffectiveIncome(s: SettlementState): SettlementState {
  const inc = effectiveIncome(s);
  const headroom = treasuryHeadroom(s.gold, settlementTreasuryCap(s));
  return { ...s, gold: s.gold + Math.min(inc, headroom) };
}
