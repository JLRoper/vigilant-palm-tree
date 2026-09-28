import type { SettlementId, SettlementState, Warehouse } from "@heroes/contracts";
import { WAREHOUSE_RESOURCES } from "@heroes/contracts";
import { addStockClamped, settlementResourceCap, settlementTreasuryCap, treasuryHeadroom } from "./capacity";
import { producerTurnOutput } from "./producers";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
    for (const r of WAREHOUSE_RESOURCES) {
      const rate = s.resourceRates[r] ?? 0;
      if (rate > 0) newWarehouse[r] = addStockClamped(newWarehouse[r] ?? 0, rate, caps[r]);
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
