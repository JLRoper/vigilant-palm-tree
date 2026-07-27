import type { BuildingDef } from "../render/cityBuildingDraw";
import { buildingPlayerEffects } from "./buildingRegistry";

export interface PlayerBonuses {
  visionRangeBonus: number;
  controlRangeBonus: number;
  heroSpeedBonus: number;
  heroAttackBonus: number;
}

export function computeSettlementBonuses(buildings: BuildingDef[]): PlayerBonuses {
  let visionRangeBonus = 0;
  let controlRangeBonus = 0;
  let heroSpeedBonus = 0;
  let heroAttackBonus = 0;
  for (const b of buildings) {
    const pe = buildingPlayerEffects(b.kind, b.level);
    visionRangeBonus += pe.visionRangeBonus;
    controlRangeBonus += pe.controlRangeBonus;
    heroSpeedBonus += pe.heroSpeedBonus;
    heroAttackBonus += pe.heroAttackBonus;
  }
  return { visionRangeBonus, controlRangeBonus, heroSpeedBonus, heroAttackBonus };
}

export function computePlayerBonuses(allSettlements: { buildings: BuildingDef[] }[]): PlayerBonuses {
  let visionRangeBonus = 0;
  let controlRangeBonus = 0;
  let heroSpeedBonus = 0;
  let heroAttackBonus = 0;
  for (const s of allSettlements) {
    const b = computeSettlementBonuses(s.buildings);
    visionRangeBonus += b.visionRangeBonus;
    controlRangeBonus += b.controlRangeBonus;
    heroSpeedBonus += b.heroSpeedBonus;
    heroAttackBonus += b.heroAttackBonus;
  }
  return { visionRangeBonus, controlRangeBonus, heroSpeedBonus, heroAttackBonus };
}
