import type { BuildingDef, BuildingRef, UpgradeState } from "@heroes/contracts";
import { buildingBuildDays, buildingUpgradeCost } from "../buildingRegistry";
import { SETTLEMENT_UPGRADE_COSTS } from "./upgradeSettlement";
import { TOWN_HALL_COSTS } from "./upgradeTownHall";

export function upgradeRefs(upgrade: UpgradeState): BuildingRef[] {
  if (upgrade.kind === "building" && upgrade.buildingRef) return [upgrade.buildingRef];
  if (upgrade.kind === "buildings") return upgrade.buildingRefs ?? [];
  return [];
}

export function upgradeTotalDays(upgrade: UpgradeState): number {
  const currentLevel = Math.max(1, upgrade.targetLevel - 1);
  if (upgrade.kind === "townHall") return TOWN_HALL_COSTS[currentLevel]?.days ?? 1;
  if (upgrade.kind === "settlement") return SETTLEMENT_UPGRADE_COSTS[currentLevel]?.days ?? 1;
  let max = 1;
  for (const ref of upgradeRefs(upgrade)) {
    const days = buildingUpgradeCost(ref.kind, currentLevel)?.days ?? 1;
    if (days > max) max = days;
  }
  return max;
}

export function upgradeProgress(upgrade: UpgradeState): number {
  const total = upgradeTotalDays(upgrade);
  return Math.min(1, Math.max(0, 1 - upgrade.daysRemaining / total));
}

export function constructionStageFor(progress: number): 1 | 2 | 3 {
  if (progress >= 0.75) return 3;
  if (progress >= 0.05) return 2;
  return 1;
}

export function buildingConstructionProgress(building: BuildingDef): number {
  const total = buildingBuildDays(building.kind);
  return Math.min(1, Math.max(0, 1 - (building.construction?.daysRemaining ?? 0) / total));
}
