import type { SettlementId, SettlementState } from "@heroes/contracts";
import { platoonTroopTotal, settlementStacks, trimPlatoonsFromEnd } from "../units";

export function applyGarrisonUpkeep(
  settlements: Record<SettlementId, SettlementState>,
): Record<SettlementId, SettlementState> {
  const newSettlements: Record<SettlementId, SettlementState> = { ...settlements };
  for (const s of Object.values(newSettlements)) {
    if (s.ownerId === null) continue;
    const stacks = settlementStacks(s);
    const total = platoonTroopTotal(stacks);
    if (total <= 0) continue;
    // Flat 1 gold / 1 food per troop, mirroring applyHeroUpkeep exactly;
    // per-type upkeepGold/upkeepFood wiring is deferred until the unit
    // catalog reaches the engine.
    const cost = total * 1;
    if (s.gold >= cost) {
      newSettlements[s.id] = { ...s, gold: s.gold - cost };
    } else {
      const survivors = Math.max(0, s.gold);
      newSettlements[s.id] = {
        ...s,
        stacks: trimPlatoonsFromEnd(stacks, total - survivors),
        gold: 0,
      };
    }
    const fed = newSettlements[s.id];
    const foodStock = fed.warehouse.food;
    if (foodStock > 0) {
      newSettlements[s.id] = {
        ...fed,
        warehouse: { ...fed.warehouse, food: Math.max(0, foodStock - total) },
      };
    }
  }
  return newSettlements;
}
