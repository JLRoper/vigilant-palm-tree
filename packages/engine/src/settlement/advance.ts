import type { BuildingDef, GameState, SettlementId, SettlementState } from "@heroes/contracts";
import { pickStyleForBuilding } from "../styleResolver";

export function advanceSettlementUpgrades(state: GameState): GameState {
  let changed = false;
  const newSettlements: Record<SettlementId, SettlementState> = { ...state.settlements };
  for (const [id, s] of Object.entries(newSettlements)) {
    if (!s.upgrade) continue;
    const daysRemaining = s.upgrade.daysRemaining - 1;
    if (daysRemaining > 0) {
      newSettlements[id] = { ...s, upgrade: { ...s.upgrade, daysRemaining } };
      changed = true;
      continue;
    }
    const upgrade = s.upgrade;
    if (upgrade.kind === "townHall") {
      const buildings = s.buildings.map((b) => {
        const newLevel = Math.max(b.level, upgrade.targetLevel) as 1 | 2 | 3;
        const newStyle = pickStyleForBuilding(b.kind, newLevel, b.style);
        return { ...b, level: newLevel, style: newStyle as BuildingDef["style"] };
      });
      newSettlements[id] = { ...s, buildings, upgrade: undefined };
      changed = true;
    } else if (upgrade.kind === "buildings" && upgrade.buildingRefs) {
      const refs = upgrade.buildingRefs;
      const buildings = s.buildings.map((b) => {
        const ref = refs.find((r) => r.gx === b.gx && r.gy === b.gy && r.kind === b.kind);
        if (!ref || b.level >= 3) return b;
        const newLevel = (b.level + 1) as 2 | 3;
        const newStyle = pickStyleForBuilding(b.kind, newLevel, b.style) as BuildingDef["style"];
        return { ...b, level: newLevel, style: newStyle };
      });
      newSettlements[id] = { ...s, buildings, upgrade: undefined };
      changed = true;
    } else if (upgrade.kind === "settlement") {
      const targetLevel = upgrade.targetLevel;
      const goldTax = targetLevel === 2 ? 2 : 3;
      const mergedSpots = [...s.citySpots];
      if (upgrade.newCitySpots) {
        for (const spot of upgrade.newCitySpots) {
          if (!mergedSpots.some((ms) => ms.cell.x === spot.cell.x && ms.cell.y === spot.cell.y)) {
            mergedSpots.push(spot);
          }
        }
      }
      newSettlements[id] = {
        ...s,
        level: targetLevel as 1 | 2 | 3,
        goldTax,
        resourceRates: upgrade.newResourceRates ?? s.resourceRates,
        citySpots: mergedSpots,
        upgrade: undefined,
      };
      changed = true;
    }
  }
  if (!changed) return state;
  return { ...state, settlements: newSettlements, dirty: true };
}
