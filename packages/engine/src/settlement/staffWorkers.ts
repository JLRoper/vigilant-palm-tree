import type {
  BuildingDef,
  DistrictState,
  GameState,
  SettlementId,
  SettlementState,
} from "@heroes/contracts";
import { districtKey } from "../control";
import { buildingMaxWorkers } from "../buildingRegistry";
import { assignedWorkersExplicit, hasLegacyStaffing, workforcePool } from "./workforce";

export interface AssignWorkersOptions {
  settlementId: SettlementId;
  gx: number;
  gy: number;
  workers: number;
  source?: { gx: number; gy: number };
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

/**
 * Workforce staffing (`AssignWorkers`). The pool is `floor(population / 100)`
 * and is spent by EXPLICIT counts only: a building whose `workers` is undefined
 * is legacy auto-staffed at full effort (`effortFraction` -> 1), which is how
 * every pre-workforce save behaves.
 *
 * The first assignment in a legacy settlement used to convert the WHOLE
 * settlement: it normalized every building to an explicit count and
 * auto-employed the remaining pool across job kinds. A level-1 pool of 5
 * against 13 buildings is a cliff, not a nudge -- one click on one building
 * left the city advertising -12.8 wood/day where it had advertised -3.84,
 * turned +6.64 stone into -1.11 and +14.33 food into -0.53, and the measured
 * turn deltas matched (C-MAJOR-2). That conversion is gone. An assignment now
 * writes the ADDRESSED building and nothing else, so every other building keeps
 * the staffing it already had -- legacy auto-staffing at full effort for an
 * untouched city -- and a player converts a city one building at a time, seeing
 * what each step costs before taking the next.
 *
 * The pool gate is unchanged: an incremented total is checked against
 * `workforcePool`, and decrements are always allowed (an oversubscribed
 * settlement must be able to shed workers).
 */
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
  if (opts.source) {
    const source = locateBuilding(settlement, opts.source.gx, opts.source.gy, opts.district);
    if (!source || source.building === building) return { state, ok: false, reason: "invalid_source" };
    const sourceMax = buildingMaxWorkers(source.building.kind);
    // A legacy source is auto-staffed at its own cap, so a pick-up takes one
    // from max -- the same base the client's stepper reads and displays.
    const sourceWorkers = (source.building.workers ?? sourceMax) - 1;
    const destinationWorkers = hasLegacyStaffing(settlement) ? 1 : (building.workers ?? maxWorkers) + 1;
    if (sourceMax < 1 || sourceWorkers < 0 || sourceWorkers > sourceMax || destinationWorkers > maxWorkers || opts.workers !== destinationWorkers) {
      return { state, ok: false, reason: "invalid_workers" };
    }
    const afterSource = writeWorkers(settlement, source, sourceWorkers);
    const destination = locateBuilding(afterSource, opts.gx, opts.gy, opts.district)!;
    const updatedSettlement = writeWorkers(afterSource, destination, destinationWorkers);
    if (assignedWorkersExplicit(updatedSettlement) > workforcePool(updatedSettlement)) {
      return { state, ok: false, reason: "pool_exhausted" };
    }
    return {
      state: { ...state, settlements: { ...state.settlements, [opts.settlementId]: updatedSettlement }, dirty: true },
      ok: true,
    };
  }
  const updatedSettlement = writeWorkers(settlement, located, opts.workers);
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
