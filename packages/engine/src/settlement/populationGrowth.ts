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

/**
 * The settlement's real population ceiling: its level's base cap
 * (`POP_BY_LEVEL`) plus the population every completed house / farmhouse /
 * apartment standing in its DISTRICTS grants (a House is +300 at L1, +1,000 at
 * L2, +1,500 at L3 -- `populationByLevel` in the registry).
 *
 * C-MINOR-2: growth stops here, and the settlement panel prints this exact
 * number, so "why is my town not growing?" has one answer in the engine and on
 * screen. It is deliberately DISTRICT-scoped -- `districtPopulationBonus` walks
 * `s.districts` only, so housing inside the main city grid raises no cap.
 */
export function settlementPopulationCap(s: SettlementState): number {
  return (POP_BY_LEVEL[s.level] ?? POP_BY_LEVEL[1]) + districtPopulationBonus(s);
}

export function applyPopulationGrowth(
  settlements: Record<SettlementId, SettlementState>,
  growthRate: number,
): Record<SettlementId, SettlementState> {
  const newSettlements: Record<SettlementId, SettlementState> = { ...settlements };
  for (const [id, s] of Object.entries(newSettlements)) {
    if (s.population <= 0) continue;
    const bonus = districtPopulationBonus(s);
    const levelMax = settlementPopulationCap(s);
    if (s.population >= levelMax) continue;
    const needed = foodRequired(s);
    if ((s.warehouse.food ?? 0) < needed) continue;
    const growth = Math.max(1, Math.ceil((s.population + bonus) * growthRate));
    const newPop = Math.min(s.population + growth, levelMax);
    newSettlements[id] = { ...s, population: newPop };
  }
  return newSettlements;
}
