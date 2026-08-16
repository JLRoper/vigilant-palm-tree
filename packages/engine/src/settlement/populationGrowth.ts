import type { SettlementId, SettlementState } from "@heroes/contracts";
import { foodRequired } from "../economy/consumption";
import { POP_BY_LEVEL } from "../economy/settlementRates";

export function applyPopulationGrowth(
  settlements: Record<SettlementId, SettlementState>,
  growthRate: number,
): Record<SettlementId, SettlementState> {
  const newSettlements: Record<SettlementId, SettlementState> = { ...settlements };
  for (const [id, s] of Object.entries(newSettlements)) {
    if (s.population <= 0) continue;
    const levelMax = POP_BY_LEVEL[s.level] ?? POP_BY_LEVEL[1];
    if (s.population >= levelMax) continue;
    const needed = foodRequired(s);
    if ((s.warehouse.food ?? 0) < needed) continue;
    const growth = Math.max(1, Math.ceil(s.population * growthRate));
    const newPop = Math.min(levelMax, s.population + growth);
    newSettlements[id] = { ...s, population: newPop };
  }
  return newSettlements;
}
