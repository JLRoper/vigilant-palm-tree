import type { SettlementId, SettlementState } from "@heroes/contracts";
import { buildingSettlementEffects } from "../buildingRegistry";
import { foodRequired } from "../economy/consumption";
import { POP_BY_LEVEL } from "../economy/settlementRates";

export function districtPopulationBonus(s: SettlementState): number {
  let bonus = 0;
  for (const d of Object.values(s.districts ?? {})) {
    for (const b of d.buildings) {
      if (b.construction) continue;
      bonus += buildingSettlementEffects(b.kind, b.level).populationBonus;
    }
  }
  return bonus;
}

export function applyPopulationGrowth(
  settlements: Record<SettlementId, SettlementState>,
  growthRate: number,
): Record<SettlementId, SettlementState> {
  const newSettlements: Record<SettlementId, SettlementState> = { ...settlements };
  for (const [id, s] of Object.entries(newSettlements)) {
    if (s.population <= 0) continue;
    const bonus = districtPopulationBonus(s);
    const levelMax = (POP_BY_LEVEL[s.level] ?? POP_BY_LEVEL[1]) + bonus;
    if (s.population >= levelMax) continue;
    const needed = foodRequired(s);
    if ((s.warehouse.food ?? 0) < needed) continue;
    const growth = Math.max(1, Math.ceil((s.population + bonus) * growthRate));
    const newPop = Math.min(s.population + growth, levelMax);
    newSettlements[id] = { ...s, population: newPop };
  }
  return newSettlements;
}
