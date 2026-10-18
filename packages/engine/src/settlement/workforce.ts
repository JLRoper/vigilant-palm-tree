import type { BuildingDef, SettlementState } from "@heroes/contracts";
import {
  buildingMaxWorkers,
  WORKFORCE_UPGRADE_ACCEL_KINDS,
} from "../buildingRegistry";

export const WORKFORCE_PER_POPULATION = 100;

export function workforcePool(s: SettlementState): number {
  return Math.floor((s.population ?? 0) / WORKFORCE_PER_POPULATION);
}

export function effortFraction(b: BuildingDef): number {
  if (b.workers === undefined) return 1;
  return Math.min(b.workers / buildingMaxWorkers(b.kind), 1);
}

export function assignedWorkersExplicit(s: SettlementState): number {
  let total = 0;
  for (const b of s.buildings) {
    if (b.workers !== undefined) total += b.workers;
  }
  for (const d of Object.values(s.districts ?? {})) {
    for (const b of d.buildings) {
      if (b.workers !== undefined) total += b.workers;
    }
  }
  return total;
}

export function hasLegacyStaffing(s: SettlementState): boolean {
  if (s.buildings.some((b) => b.workers === undefined)) return true;
  for (const d of Object.values(s.districts ?? {})) {
    if (d.buildings.some((b) => b.workers === undefined)) return true;
  }
  return false;
}

export function hasExplicitStaffing(s: SettlementState): boolean {
  if (s.buildings.some((b) => b.workers !== undefined)) return true;
  for (const d of Object.values(s.districts ?? {})) {
    if (d.buildings.some((b) => b.workers !== undefined)) return true;
  }
  return false;
}

export function staffingBase(workers: number | undefined, max: number, legacy: boolean): number {
  return legacy ? 0 : (workers ?? max);
}

function accelEffortOf(b: BuildingDef): number {
  if (b.workers === undefined) return 0;
  return Math.min(b.workers / buildingMaxWorkers(b.kind), 1);
}

export function upgradeAccelEffort(s: SettlementState): number {
  let maxEffort = 0;
  for (const b of s.buildings) {
    if (!WORKFORCE_UPGRADE_ACCEL_KINDS.includes(b.kind)) continue;
    const e = accelEffortOf(b);
    if (e > maxEffort) maxEffort = e;
  }
  for (const d of Object.values(s.districts ?? {})) {
    for (const b of d.buildings) {
      if (!WORKFORCE_UPGRADE_ACCEL_KINDS.includes(b.kind)) continue;
      const e = accelEffortOf(b);
      if (e > maxEffort) maxEffort = e;
    }
  }
  return maxEffort;
}

export function draftRechargeMultiplier(b: BuildingDef): number {
  return 1 + effortFraction(b);
}

export function canAssignWorkers(
  current: number | undefined,
  max: number,
  delta: number,
  pool: number,
  assigned: number,
): boolean {
  const target = (current ?? max) + delta;
  if (target < 0 || target > max) return false;
  if (target > (current ?? max)) {
    return assigned + (target - (current ?? max)) <= pool;
  }
  return true;
}