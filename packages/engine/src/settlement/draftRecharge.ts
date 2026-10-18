import type { BuildingDef, DistrictState, SettlementId, SettlementState } from "@heroes/contracts";
import { buildingDraftMax, buildingDraftPerDay, getBuildingEffect } from "../buildingRegistry";
import { draftRechargeMultiplier } from "./workforce";

function stepBuilding(b: BuildingDef): BuildingDef {
  if (b.construction) return b;
  if (b.draft === undefined) return b;
  const roster = getBuildingEffect(b.kind).recruits;
  if (roster.length === 0) return b;
  const max = buildingDraftMax(b.kind);
  const perDay = buildingDraftPerDay(b.kind) * draftRechargeMultiplier(b);
  const changes: Record<string, number> = {};
  for (const entry of roster) {
    const current = b.draft[entry.unitTypeId] ?? max;
    const nextValue = Math.min(max, current + perDay);
    if (nextValue !== current) changes[entry.unitTypeId] = nextValue;
  }
  if (Object.keys(changes).length === 0) return b;
  return { ...b, draft: { ...b.draft, ...changes } };
}

export function applyDraftRecharge(
  settlements: Record<SettlementId, SettlementState>,
): Record<SettlementId, SettlementState> {
  let changed = false;
  const next: Record<SettlementId, SettlementState> = { ...settlements };
  for (const [id, s] of Object.entries(settlements)) {
    const buildings = s.buildings.map((b) => stepBuilding(b));
    const buildingsChanged = buildings.some((b, i) => b !== s.buildings[i]);
    let nextDistricts: Record<string, DistrictState> | undefined;
    if (s.districts) {
      for (const [dKey, d] of Object.entries(s.districts)) {
        const dBuildings = d.buildings.map((b) => stepBuilding(b));
        if (dBuildings.some((b, i) => b !== d.buildings[i])) {
          nextDistricts = nextDistricts ?? { ...s.districts };
          nextDistricts[dKey] = { ...d, buildings: dBuildings };
        }
      }
    }
    if (!buildingsChanged && !nextDistricts) continue;
    next[id] = {
      ...s,
      ...(buildingsChanged ? { buildings } : {}),
      ...(nextDistricts ? { districts: nextDistricts } : {}),
    };
    changed = true;
  }
  if (!changed) return settlements;
  return next;
}