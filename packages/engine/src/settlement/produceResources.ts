import type { SettlementId, SettlementState, Warehouse } from "@heroes/contracts";
import { WAREHOUSE_RESOURCES } from "@heroes/contracts";

export function produceSettlementResources(
  settlements: Record<SettlementId, SettlementState>,
): Record<SettlementId, SettlementState> {
  const newSettlements: Record<SettlementId, SettlementState> = { ...settlements };
  for (const s of Object.values(newSettlements)) {
    const newWarehouse: Warehouse = { ...s.warehouse };
    for (const r of WAREHOUSE_RESOURCES) {
      const rate = s.resourceRates[r] ?? 0;
      if (rate > 0) newWarehouse[r] = (newWarehouse[r] ?? 0) + rate;
    }
    newSettlements[s.id] = { ...newSettlements[s.id], warehouse: newWarehouse };
  }
  return newSettlements;
}
