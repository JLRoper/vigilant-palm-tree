import type { BuildingKind, FactionId, SettlementState, Warehouse } from "@heroes/contracts";
import { buildingUpkeep, getBuildingEffect, normalizeFactionId } from "../buildingRegistry";
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
  for (const d of Object.values(s.districts ?? {})) {
    for (const b of d.buildings) {
      const u = buildingUpkeep(b.kind, b.level);
      wood += u.wood;
      stone += u.stone;
    }
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

// ── Occupation morale penalty (faction-construction plan, section 8) ──
// A settlement "foreign-occupied" relative to its current owner reads worse
// at income time than its stored morale alone would say, WITHOUT touching
// the stored, decaying/recovering `morale` field itself: they are different
// causes with different cures. Stored morale recovers from being fed
// (applyMoraleDecay above); this one only resolves by changing the building
// tally -- building more of your own faction's buildings, or demolishing
// the foreign ones (DemolishBuilding, section 5). Recomputed fresh every
// read from the CURRENT buildings array; never persisted.
export const OCCUPATION_PENALTY_PER_BUILDING = 5;
export const OCCUPATION_PENALTY_MAX = 40;

/** Count of faction-TAGGED buildings only (main + districts), by faction. Untagged (economy) buildings never count. */
export function settlementFactionTally(s: SettlementState): Partial<Record<FactionId, number>> {
  const tally: Partial<Record<FactionId, number>> = {};
  const bump = (kind: BuildingKind): void => {
    const faction = getBuildingEffect(kind).faction;
    if (faction === undefined) return;
    tally[faction] = (tally[faction] ?? 0) + 1;
  };
  for (const b of s.buildings) bump(b.kind);
  for (const d of Object.values(s.districts ?? {})) {
    for (const b of d.buildings) bump(b.kind);
  }
  return tally;
}

/**
 * The occupation penalty subtracted from stored morale AT INCOME-READ TIME
 * only (effectiveIncome below). A settlement is "foreign-occupied" when it
 * has >=1 foreign-tagged building and the owner's own-faction tally does not
 * exceed the largest foreign tally; the penalty scales with how far behind
 * the owner's own tally is (`imbalance`), capped at OCCUPATION_PENALTY_MAX.
 * `ownerFactionId` defaults "human" the same way the rest of the faction
 * plumbing does (normalizeFactionId "neutral"->"human", absent stays absent
 * -> "human" here since a settlement always has a real effective faction at
 * income time).
 */
export function occupationMoralePenalty(s: SettlementState, ownerFactionId?: FactionId): number {
  const ownFaction = normalizeFactionId(ownerFactionId) ?? "human";
  const tally = settlementFactionTally(s);
  const ownTally = tally[ownFaction] ?? 0;
  let foreignMaxTally = 0;
  for (const [faction, count] of Object.entries(tally) as [FactionId, number][]) {
    if (faction === ownFaction) continue;
    if (count > foreignMaxTally) foreignMaxTally = count;
  }
  if (foreignMaxTally === 0 || ownTally > foreignMaxTally) return 0;
  const imbalance = Math.max(0, foreignMaxTally - ownTally);
  return Math.min(OCCUPATION_PENALTY_MAX, OCCUPATION_PENALTY_PER_BUILDING * imbalance);
}

export function effectiveIncome(s: SettlementState, ownerFactionId?: FactionId): number {
  const effectiveMorale = clamp((s.morale ?? 100) - occupationMoralePenalty(s, ownerFactionId), 0, 100);
  const base = (s.population ?? 0) * (s.goldTax ?? 0);
  return Math.round((base * effectiveMorale) / MORALE_TAX_INCOME_DIVISOR);
}

export function clampMorale(value: number): number {
  return clamp(value, 0, 100);
}

export function clampWarehouseNonNegative(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
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

export const WAGE_POPULATION_PER_GOLD = 100;

export function settlementDailyWage(s: SettlementState): number {
  const pop = Number.isFinite(s.population) ? s.population : 0;
  return Math.floor(pop / WAGE_POPULATION_PER_GOLD);
}

export function applySettlementWages(s: SettlementState): SettlementState {
  const wage = settlementDailyWage(s);
  if (wage <= 0) return s;
  return { ...s, gold: Math.max(0, s.gold - wage) };
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

export function applyEffectiveIncome(s: SettlementState, ownerFactionId?: FactionId): SettlementState {
  const inc = effectiveIncome(s, ownerFactionId);
  const headroom = treasuryHeadroom(s.gold, settlementTreasuryCap(s));
  return { ...s, gold: Math.round(s.gold + Math.min(inc, headroom)) };
}
