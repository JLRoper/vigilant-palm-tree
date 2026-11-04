import type { BuildingDef } from "@heroes/contracts";
import { buildingPlayerEffects } from "./buildingRegistry";

export interface PlayerBonuses {
  controlRangeBonus: number;
  heroSpeedBonus: number;
}

export function computeSettlementBonuses(buildings: BuildingDef[]): PlayerBonuses {
  let controlRangeBonus = 0;
  let heroSpeedBonus = 0;
  for (const b of buildings) {
    const pe = buildingPlayerEffects(b.kind, b.level);
    controlRangeBonus += pe.controlRangeBonus;
    heroSpeedBonus += pe.heroSpeedBonus;
  }
  return { controlRangeBonus, heroSpeedBonus };
}

export function computePlayerBonuses(
  allSettlements: { buildings: BuildingDef[]; districts?: Record<string, { buildings: BuildingDef[] }> }[],
): PlayerBonuses {
  let controlRangeBonus = 0;
  let heroSpeedBonus = 0;
  for (const s of allSettlements) {
    const b = computeSettlementBonuses(s.buildings);
    controlRangeBonus += b.controlRangeBonus;
    heroSpeedBonus += b.heroSpeedBonus;
    for (const d of Object.values(s.districts ?? {})) {
      const db = computeSettlementBonuses(d.buildings);
      controlRangeBonus += db.controlRangeBonus;
      heroSpeedBonus += db.heroSpeedBonus;
    }
  }
  return { controlRangeBonus, heroSpeedBonus };
}
