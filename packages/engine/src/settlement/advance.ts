import type { BuildingDef, DistrictState, GameState, SettlementId, SettlementState } from "@heroes/contracts";
import { districtKey } from "../control";
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
        return { ...b, level: newLevel, style: newStyle };
      });
      newSettlements[id] = { ...s, buildings, upgrade: undefined };
      changed = true;
    } else if (upgrade.kind === "buildings" && upgrade.buildingRefs) {
      const refs = upgrade.buildingRefs;
      const mainRefs = refs.filter((r) => !(r.district ?? upgrade.district));
      const buildings =
        mainRefs.length > 0
          ? s.buildings.map((b) => {
              const ref = mainRefs.find((r) => r.gx === b.gx && r.gy === b.gy && r.kind === b.kind);
              if (!ref || b.level >= 3) return b;
              const newLevel = (b.level + 1) as 2 | 3;
              const newStyle = pickStyleForBuilding(b.kind, newLevel, b.style);
              return { ...b, level: newLevel, style: newStyle };
            })
          : s.buildings;
      let districts: Record<string, DistrictState> | undefined = s.districts;
      if (districts) {
        const byDistrict = new Map<string, typeof refs>();
        for (const r of refs) {
          const dCoord = r.district ?? upgrade.district;
          if (!dCoord) continue;
          const key = districtKey(dCoord.q, dCoord.r);
          const bucket = byDistrict.get(key);
          if (bucket) bucket.push(r);
          else byDistrict.set(key, [r]);
        }
        for (const [key, dRefs] of byDistrict) {
          const d: DistrictState | undefined = districts[key];
          if (!d) continue;
          const dBuildings: BuildingDef[] = d.buildings.map((b: BuildingDef) => {
            const match = dRefs.some((r) => r.gx === b.gx && r.gy === b.gy && r.kind === b.kind);
            if (!match || b.level >= 3) return b;
            const newLevel = (b.level + 1) as 2 | 3;
            const newStyle = pickStyleForBuilding(b.kind, newLevel, b.style);
            return { ...b, level: newLevel, style: newStyle };
          });
          districts = { ...districts, [key]: { ...d, buildings: dBuildings } };
        }
      }
      newSettlements[id] = { ...s, buildings, ...(districts ? { districts } : {}), upgrade: undefined };
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

export function advanceBuildingConstructions(state: GameState): GameState {
  let changed = false;
  const newSettlements: Record<SettlementId, SettlementState> = { ...state.settlements };
  const stepBuilding = (b: BuildingDef): BuildingDef => {
    if (!b.construction) return b;
    const daysRemaining = b.construction.daysRemaining - 1;
    changed = true;
    if (daysRemaining > 0) return { ...b, construction: { daysRemaining } };
    const { construction: _completed, ...finished } = b;
    return finished as BuildingDef;
  };
  for (const [id, s] of Object.entries(newSettlements)) {
    const hasMainConstruction = s.buildings.some((b) => b.construction);
    const hasDistrictConstruction = Object.values(s.districts ?? {}).some((d) =>
      d.buildings.some((b) => b.construction),
    );
    if (!hasMainConstruction && !hasDistrictConstruction) continue;
    const buildings = hasMainConstruction ? s.buildings.map(stepBuilding) : s.buildings;
    let districts = s.districts;
    if (hasDistrictConstruction && s.districts) {
      const nextDistricts: Record<string, DistrictState> = { ...s.districts };
      for (const [dKey, d] of Object.entries(s.districts)) {
        if (!d.buildings.some((b) => b.construction)) continue;
        nextDistricts[dKey] = { ...d, buildings: d.buildings.map(stepBuilding) };
      }
      districts = nextDistricts;
    }
    newSettlements[id] = { ...s, buildings, ...(districts ? { districts } : {}) };
  }
  if (!changed) return state;
  return { ...state, settlements: newSettlements, dirty: true };
}
