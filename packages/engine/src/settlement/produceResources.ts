import type {
  DistrictState,
  PlayerId,
  ResourceType,
  SettlementId,
  SettlementState,
  Warehouse,
  WarehouseResource,
} from "@heroes/contracts";
import { WAREHOUSE_RESOURCES } from "@heroes/contracts";
import { addStockClamped, settlementResourceCap, settlementTreasuryCap, treasuryHeadroom } from "./capacity";
import { districtSpecialisation, districtSpecialisationScale } from "./districtSpecialisation";
import { buildingFallbackGold, isDistrictBlockedByHero, producerTurnOutput, type ProducerResource } from "./producers";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface WarehouseRate {
  resource: WarehouseResource;
  perTurn: number;
}

/**
 * The per-turn rates a settlement's warehouse actually receives: every
 * WAREHOUSE_RESOURCE with a positive rate, in the warehouse's own order.
 *
 * Gold is deliberately absent, and this is the reason the map is a *rate map*
 * and not a settlement's whole income: `resourceRates` is computed from map
 * resource tiles (computeSettlementRates) and therefore carries a gold entry
 * for any settlement founded near a gold tile, but gold is not a warehouse
 * resource, so nothing ever delivers it. A settlement's gold income is
 * `effectiveIncome` (tax) plus gold producers. Rendering must go through this
 * function rather than iterating the raw map, or the panel advertises income the
 * turn loop never pays.
 */
export function warehouseRates(rates: Partial<Record<ResourceType, number>>): WarehouseRate[] {
  const out: WarehouseRate[] = [];
  for (const resource of WAREHOUSE_RESOURCES) {
    const perTurn = rates[resource] ?? 0;
    if (perTurn > 0) out.push({ resource, perTurn });
  }
  return out;
}

export interface SettlementProductionRates {
  /** Combined per-turn warehouse income: tile rates + building producers, per WAREHOUSE_RESOURCE, in warehouse order. */
  rates: WarehouseRate[];
  /** Gold producers' per-turn total — real income paid to the treasury, kept out of `rates` (gold is not a warehouse resource). */
  goldPerTurn: number;
}

/**
 * One production line a district contributes in a turn: the resource and the
 * raw amount (the caller applies its own rounding, exactly as it does for the
 * producer half).
 */
export interface DistrictProductionLine {
  resource: ProducerResource;
  amount: number;
}

/** The part of a district a production line needs. */
export type DistrictProductionDistrict = Pick<DistrictState, "q" | "r" | "citySpots" | "buildings">;

/**
 * Every production line one district contributes, with the district's DERIVED
 * specialisation applied (`districtSpecialisation.ts`).
 *
 * This is the ONE place a district's buildings are turned into output, and both
 * loops below go through it -- the payment loop and the panel's rate map -- so
 * the number a player reads at a district cannot drift from the number the turn
 * pays for it, the same rule the tile and producer halves already follow.
 *
 * The shape matters, and it is what makes the change neutral by default:
 *
 *   1. EVERY producer pays exactly what it paid before, one line each, in the
 *      same order. A district that is not specialised (a MIXED district, and
 *      every district the game seeds -- two or three distinct kinds, one short
 *      of `DISTRICT_CHAIN_MIN_PRODUCERS`) stops here with not one line added,
 *      so its numbers are the pre-specialisation numbers byte for byte.
 *   2. A specialised district then gets ONE ADJUSTMENT LINE PER RESOURCE it
 *      has producers on: `effect` of that resource's output added when it is
 *      the district's chain, taken away when it is not. The adjustment is
 *      computed on the chain's own TOTAL rather than on each producer, because
 *      a level-1 producer pays 2-6 units and a fractional per-producer
 *      multiplier on those is swallowed whole by the loop's per-addition
 *      rounding -- a 4-farm district at full specialisation paid 22 where the
 *      headline said 19 + 25%. Aggregated, the same district pays 19 + 4.
 */
export function districtProductionLines(
  district: DistrictProductionDistrict,
  seed: number,
): DistrictProductionLine[] {
  const lines: DistrictProductionLine[] = [];
  const rawByResource = new Map<ProducerResource, number>();
  for (const b of district.buildings) {
    const output = producerTurnOutput(
      b,
      { q: district.q, r: district.r, citySpots: district.citySpots },
      seed,
    );
    if (!output) {
      // The market and the other flat-gold buildings ride the same lines so a
      // caller has one list to walk. Specialisation never touches them: it
      // scales chains, and these are not producers.
      const fallbackGold = buildingFallbackGold(b);
      if (fallbackGold > 0) lines.push({ resource: "gold", amount: fallbackGold });
      continue;
    }
    lines.push({ resource: output.resource, amount: output.amount });
    rawByResource.set(output.resource, (rawByResource.get(output.resource) ?? 0) + output.amount);
  }

  const spec = districtSpecialisation(district);
  if (!spec || spec.effect === 0) return lines;

  // Insertion order of `rawByResource` is producer order, which is the order
  // the buildings were persisted in -- so the adjustment lines are as
  // deterministic as the producer lines they follow.
  for (const [resource, raw] of rawByResource) {
    const scale = districtSpecialisationScale(spec, resource);
    if (scale === 1) continue;
    lines.push({ resource, amount: round2(raw * (scale - 1)) });
  }
  return lines;
}

/**
 * The full per-turn production picture a settlement panel should display:
 * warehouseRates() tile half merged with the producerTurnOutput() building
 * half per warehouse resource (in-construction buildings contribute nothing,
 * the same rule the production loop itself applies). The plan's U1: a
 * farm-only settlement must not read "no warehouse production" while its
 * warehouse receives food every turn. `seed` is the game seed the production
 * loop passes (state.castleSeed client-side), so the numbers shown are the
 * numbers paid -- including the payment loop's own per-addition rounding, so a
 * rate row equals the store's daily DELTA rather than a sum of raw fractions
 * (see the note in the body; playthrough round 2b, E1).
 */
export function settlementProductionRates(
  settlement: Pick<SettlementState, "resourceRates" | "buildings" | "q" | "r" | "citySpots"> & {
    ownerId?: PlayerId | null;
    districts?: Record<string, DistrictState>;
  },
  seed: number,
  heroes?: Iterable<{ ownerId: PlayerId; q: number; r: number }> | Record<string, { ownerId: PlayerId; q: number; r: number }>,
): SettlementProductionRates {
  // E1 (playthrough round 2b): these numbers must be the numbers the turn PAYS.
  // The payment loop (`produceSettlementResources` below) adds the tile half in
  // one addition and each producer's output in its own, rounding the STOCK
  // after every one of them -- `Math.round(addStockClamped(stock, amount,
  // cap))` -- while this function used to sum the raw amounts and round the
  // TOTAL once. On an integral store (the only kind the turn loop leaves
  // behind: consumption and every clamp round) the paid delta is therefore
  // round(tile) + the sum of round(each producer), and a panel that rounded the
  // sum instead was off by up to a unit per resource per day, in whichever
  // direction the fractional parts fell -- measured on the round-2b Gold hold,
  // the panel advertised -2.89/day of wood and the store lost 2/day. The
  // rounding below is the payment's own arithmetic rather than a new rule.
  const totals = new Map<WarehouseResource, number>();
  for (const { resource, perTurn } of warehouseRates(settlement.resourceRates)) {
    totals.set(resource, (totals.get(resource) ?? 0) + Math.round(perTurn));
  }
  let gold = 0;
  for (const b of settlement.buildings) {
    const output = producerTurnOutput(b, settlement, seed);
    if (!output) {
      const fallbackGold = buildingFallbackGold(b);
      if (fallbackGold > 0) gold += fallbackGold;
      continue;
    }
    if (output.resource === "gold") {
      gold += output.amount;
    } else {
      totals.set(output.resource, (totals.get(output.resource) ?? 0) + Math.round(output.amount));
    }
  }
  for (const d of Object.values(settlement.districts ?? {})) {
    if (isDistrictBlockedByHero(settlement.ownerId ?? null, d.q, d.r, heroes)) continue;
    for (const line of districtProductionLines(d, seed)) {
      if (line.resource === "gold") {
        gold += line.amount;
      } else {
        totals.set(line.resource, (totals.get(line.resource) ?? 0) + Math.round(line.amount));
      }
    }
  }
  const rates: WarehouseRate[] = [];
  for (const resource of WAREHOUSE_RESOURCES) {
    const perTurn = totals.get(resource) ?? 0;
    if (perTurn > 0) rates.push({ resource, perTurn: round2(perTurn) });
  }
  // Gold is different in kind: the loop sums every gold producer's raw amount
  // and rounds ONCE, as it writes the treasury (`Math.round(s.gold +
  // Math.min(gold, treasuryHeadroom))`), so the paid figure is the rounded sum.
  return { rates, goldPerTurn: Math.round(gold) };
}

export function produceSettlementResources(
  settlements: Record<SettlementId, SettlementState>,
  seed: number,
  heroes?: Iterable<{ ownerId: PlayerId; q: number; r: number }> | Record<string, { ownerId: PlayerId; q: number; r: number }>,
): Record<SettlementId, SettlementState> {
  const newSettlements: Record<SettlementId, SettlementState> = { ...settlements };
  for (const s of Object.values(newSettlements)) {
    const caps = settlementResourceCap(s);
    const treasuryCap = settlementTreasuryCap(s);
    const newWarehouse: Warehouse = { ...s.warehouse };
    for (const { resource, perTurn } of warehouseRates(s.resourceRates)) {
      newWarehouse[resource] = Math.round(addStockClamped(newWarehouse[resource] ?? 0, perTurn, caps[resource]));
    }
    let gold = 0;
    for (const b of s.buildings) {
      const output = producerTurnOutput(b, s, seed);
      if (!output) {
        const fallbackGold = buildingFallbackGold(b);
        if (fallbackGold > 0) gold += fallbackGold;
        continue;
      }
      if (output.resource === "gold") {
        gold += output.amount;
      } else {
        newWarehouse[output.resource] = Math.round(
          addStockClamped(
            newWarehouse[output.resource] ?? 0,
            output.amount,
            caps[output.resource],
          ),
        );
      }
    }
    for (const d of Object.values(s.districts ?? {})) {
      if (isDistrictBlockedByHero(s.ownerId, d.q, d.r, heroes)) continue;
      for (const line of districtProductionLines(d, seed)) {
        if (line.resource === "gold") {
          gold += line.amount;
        } else {
          newWarehouse[line.resource] = Math.round(
            addStockClamped(
              newWarehouse[line.resource] ?? 0,
              line.amount,
              caps[line.resource],
            ),
          );
        }
      }
    }
    if (gold > 0) {
      newSettlements[s.id] = {
        ...newSettlements[s.id],
        warehouse: newWarehouse,
        gold: Math.round(s.gold + Math.min(gold, treasuryHeadroom(s.gold, treasuryCap))),
      };
    } else {
      newSettlements[s.id] = { ...newSettlements[s.id], warehouse: newWarehouse };
    }
  }
  return newSettlements;
}
