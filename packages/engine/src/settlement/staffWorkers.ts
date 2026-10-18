import type {
  BuildingDef,
  DistrictState,
  GameState,
  SettlementId,
  SettlementState,
} from "@heroes/contracts";
import { districtKey } from "../control";
import { buildingMaxWorkers } from "../buildingRegistry";
import { assignedWorkersExplicit, workforcePool } from "./workforce";

export interface AssignWorkersOptions {
  settlementId: SettlementId;
  gx: number;
  gy: number;
  workers: number;
  district?: { q: number; r: number };
}

export interface AssignWorkersResult {
  state: GameState;
  ok: boolean;
  reason?: string;
}

type LocatedBuilding =
  | { where: "main"; building: BuildingDef; index: number; list: BuildingDef[] }
  | {
      where: "district";
      building: BuildingDef;
      index: number;
      list: BuildingDef[];
      district: DistrictState;
      districtKey: string;
    };

function locateBuilding(
  settlement: SettlementState,
  gx: number,
  gy: number,
  district?: { q: number; r: number },
): LocatedBuilding | null {
  if (district) {
    const key = districtKey(district.q, district.r);
    const d = settlement.districts?.[key];
    const index = d?.buildings.findIndex((b) => b.gx === gx && b.gy === gy) ?? -1;
    if (d && index >= 0) {
      return { where: "district", building: d.buildings[index], index, list: d.buildings, district: d, districtKey: key };
    }
    return null;
  }
  const mainIndex = settlement.buildings.findIndex((b) => b.gx === gx && b.gy === gy);
  if (mainIndex >= 0) {
    return {
      where: "main",
      building: settlement.buildings[mainIndex],
      index: mainIndex,
      list: settlement.buildings,
    };
  }
  const matches: Array<Omit<Extract<LocatedBuilding, { where: "district" }>, "where">> = [];
  for (const d of Object.values(settlement.districts ?? {})) {
    const index = d.buildings.findIndex((b) => b.gx === gx && b.gy === gy);
    if (index >= 0) {
      matches.push({
        building: d.buildings[index],
        index,
        list: d.buildings,
        district: d,
        districtKey: districtKey(d.q, d.r),
      });
    }
  }
  if (matches.length === 1) return { where: "district", ...matches[0] };
  return null;
}

function writeWorkers(settlement: SettlementState, located: LocatedBuilding, workers: number): SettlementState {
  const buildings = located.list.map((b, i) => (i === located.index ? { ...b, workers } : b));
  if (located.where === "main") {
    return { ...settlement, buildings };
  }
  return {
    ...settlement,
    districts: {
      ...(settlement.districts ?? {}),
      [located.districtKey]: { ...located.district, buildings },
    },
  };
}

function hasLegacyStaffing(settlement: SettlementState): boolean {
  if (settlement.buildings.some((b) => b.workers === undefined)) return true;
  for (const d of Object.values(settlement.districts ?? {})) {
    if (d.buildings.some((b) => b.workers === undefined)) return true;
  }
  return false;
}

function normalizeStaffing(settlement: SettlementState): SettlementState {
  const normalizeList = (buildings: BuildingDef[]): BuildingDef[] =>
    buildings.map((b) => (b.workers === undefined ? { ...b, workers: 0 } : b));
  const buildings = normalizeList(settlement.buildings);
  const districts = settlement.districts;
  if (!districts) return { ...settlement, buildings };
  const nextDistricts: Record<string, DistrictState> = {};
  for (const [key, d] of Object.entries(districts)) {
    nextDistricts[key] = { ...d, buildings: normalizeList(d.buildings) };
  }
  return { ...settlement, buildings, districts: nextDistricts };
}

export function assignWorkers(state: GameState, opts: AssignWorkersOptions): AssignWorkersResult {
  const settlement = state.settlements[opts.settlementId];
  if (!settlement) return { state, ok: false, reason: "no_settlement" };
  if (settlement.ownerId == null) return { state, ok: false, reason: "unowned_settlement" };
  const located = locateBuilding(settlement, opts.gx, opts.gy, opts.district);
  if (!located) return { state, ok: false, reason: "no_building" };
  const building = located.building;
  const maxWorkers = buildingMaxWorkers(building.kind);
  if (maxWorkers < 1) return { state, ok: false, reason: "not_staffable" };
  if (!Number.isInteger(opts.workers) || opts.workers < 0 || opts.workers > maxWorkers) {
    return { state, ok: false, reason: "invalid_workers" };
  }
  const normalized = hasLegacyStaffing(settlement) ? normalizeStaffing(settlement) : settlement;
  const target = normalized === settlement ? located : locateBuilding(normalized, opts.gx, opts.gy, opts.district);
  if (!target) return { state, ok: false, reason: "no_building" };
  const updatedSettlement = writeWorkers(normalized, target, opts.workers);
  if (opts.workers > (building.workers ?? 0)) {
    if (assignedWorkersExplicit(updatedSettlement) > workforcePool(updatedSettlement)) {
      return { state, ok: false, reason: "pool_exhausted" };
    }
  }
  return {
    state: {
      ...state,
      settlements: { ...state.settlements, [opts.settlementId]: updatedSettlement },
      dirty: true,
    },
    ok: true,
  };
}