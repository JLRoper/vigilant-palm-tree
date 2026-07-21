import type { SettlementState } from "../state/gameState";

export const FOOD_PER_POPULATION = 100;
export const BUILDING_UPKEEP_WOOD = 0;
export const BUILDING_UPKEEP_STONE = 0;
export const MORALE_DECAY_PER_DEFICIT_RATIO = 10;
export const LOW_MORALE_EXTRA_DECAY = 1;
export const MORALE_TAX_INCOME_DIVISOR = 100;
export const FOOD_CONSUMED_RESOURCES = ["food", "wood", "stone", "iron", "arcane"] as const;

export function foodRequired(s: SettlementState): number {
  return Math.ceil((s.population ?? 0) / FOOD_PER_POPULATION);
}

export function buildingUpkeepRequired(s: SettlementState): { wood: number; stone: number } {
  const levelBoost = s.level ?? 1;
  return {
    wood: BUILDING_UPKEEP_WOOD * levelBoost,
    stone: BUILDING_UPKEEP_STONE * levelBoost,
  };
}

export function foodDeficitRatio(s: SettlementState): number {
  const needed = foodRequired(s);
  const have = s.warehouse.food ?? 0;
  if (needed <= 0) return 0;
  return Math.max(0, (needed - have) / Math.max(1, needed));
}

export function suppliesDeficitRatio(s: SettlementState): number {
  const upkeep = buildingUpkeepRequired(s);
  const needed = upkeep.wood + upkeep.stone;
  if (needed <= 0) return 0;
  const have = (s.warehouse.wood ?? 0) + (s.warehouse.stone ?? 0);
  return Math.max(0, (needed - have) / Math.max(1, needed));
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
