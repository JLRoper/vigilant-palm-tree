import type { ResourceType, SettlementId, SettlementState, Warehouse, WarehouseResource } from "@heroes/contracts";
import { WAREHOUSE_RESOURCES } from "@heroes/contracts";
import { addStockClamped, settlementResourceCap, settlementTreasuryCap, treasuryHeadroom } from "./capacity";
import { producerTurnOutput } from "./producers";

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

export function produceSettlementResources(
  settlements: Record<SettlementId, SettlementState>,
  seed: number,
): Record<SettlementId, SettlementState> {
  const newSettlements: Record<SettlementId, SettlementState> = { ...settlements };
  for (const s of Object.values(newSettlements)) {
    const caps = settlementResourceCap(s);
    const treasuryCap = settlementTreasuryCap(s);
    const newWarehouse: Warehouse = { ...s.warehouse };
    for (const { resource, perTurn } of warehouseRates(s.resourceRates)) {
      newWarehouse[resource] = addStockClamped(newWarehouse[resource] ?? 0, perTurn, caps[resource]);
    }
    let gold = 0;
    for (const b of s.buildings) {
      const output = producerTurnOutput(b, s, seed);
      if (!output) continue;
      if (output.resource === "gold") {
        gold += output.amount;
      } else {
        newWarehouse[output.resource] = addStockClamped(
          newWarehouse[output.resource] ?? 0,
          output.amount,
          caps[output.resource],
        );
      }
    }
    if (gold > 0) {
      const addGold = Math.min(round2(gold), treasuryHeadroom(s.gold, treasuryCap));
      newSettlements[s.id] = {
        ...newSettlements[s.id],
        warehouse: newWarehouse,
        gold: round2(s.gold + addGold),
      };
    } else {
      newSettlements[s.id] = { ...newSettlements[s.id], warehouse: newWarehouse };
    }
  }
  return newSettlements;
}
