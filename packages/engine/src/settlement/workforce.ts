import type { BuildingDef, SettlementState } from "@heroes/contracts";
import {
  buildingMaxWorkers,
  WORKFORCE_UPGRADE_ACCEL_KINDS,
} from "../buildingRegistry";

// Workforce: the settlement's worker pool, and how a building's crew turns into
// effort.
//
// THE POOL. `workforcePool(s) = floor(population / WORKFORCE_PER_POPULATION)`.
// The divisor is a late-game lever: it decides where the pool stops covering a
// fully built-out city. Measured on github/main (0.40.0), fixture: a level-3
// castle whose 15x15 grid is filled with houses plus its two seeded districts
// filled with level-3 houses -- population at its 80,000 cap and a worker
// demand of **275** slots (sum of `buildingMaxWorkers` over every building):
//
//   divisor 100 (before) -> pool  800 = 291% of demand  (the pool never binds)
//   divisor 291          -> pool  274 = 100%            (the last binding value)
//   divisor 300 (now)    -> pool  266 =  97% of demand  (three slots short)
//
// At 100 the headline late-city feature was a no-op: the pool was three times
// the demand, so every building could sit at a fully explicit crew and 525
// workers were still idle. At 300 a fully built-out castle is a few slots short
// of its demand, so the player must choose what stays dark. See
// `docs/settlements.md` "Workers" for the curve and the early-game guard.
export const WORKFORCE_PER_POPULATION = 300;

export function workforcePool(s: SettlementState): number {
  return Math.floor((s.population ?? 0) / WORKFORCE_PER_POPULATION);
}

// THE CREW. `effortFraction` reads `undefined` as a full crew -- the legacy
// auto-staffed default. It is kept (a fresh city's pool is far below its own
// demand, so removing it starves the early game -- measured: a fresh level-2
// town at population 1,500 has a pool of 5 against a demand of 23) but it is no
// longer free to extend: `applyPlaceBuildings` only auto-crews a NEW placement
// while the settlement is a pure bootstrap (no explicit count and no districts),
// and the auto crew is now COUNTED and shown, not silent -- see
// `autoStaffedSlots` / `autoStaffedCount` below and the city view's workforce
// panel header.
export function effortFraction(b: BuildingDef): number {
  if (b.workers === undefined) return 1;
  return Math.min(b.workers / buildingMaxWorkers(b.kind), 1);
}

/** Worker slots the settlement's auto-staffed (`workers === undefined`) buildings occupy. */
export function autoStaffedSlots(s: SettlementState): number {
  let total = 0;
  for (const b of s.buildings) if (b.workers === undefined) total += buildingMaxWorkers(b.kind);
  for (const d of Object.values(s.districts ?? {})) {
    for (const b of d.buildings) if (b.workers === undefined) total += buildingMaxWorkers(b.kind);
  }
  return total;
}

/** Number of the settlement's buildings running on the auto crew (`workers === undefined`). */
export function autoStaffedCount(s: SettlementState): number {
  let total = s.buildings.filter((b) => b.workers === undefined).length;
  for (const d of Object.values(s.districts ?? {})) {
    total += d.buildings.filter((b) => b.workers === undefined).length;
  }
  return total;
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

/**
 * Whether a NEW placement into `s` is auto-crewed (legacy `workers: undefined`)
 * or starts at an explicit 0.
 *
 * Auto-crewing is the BOOTSTRAP only: a settlement with no explicit count AND no
 * districts is the town the game handed the player, and its buildings keep the
 * full-effort free crew. The moment it has any explicit count or ANY district it
 * is a city being grown, and a new building must be staffed out of the pool --
 * otherwise the free full crew would follow the player all the way to a
 * built-out castle and the pool could never bind (the defect this closes).
 */
export function newPlacementsAutoCrew(s: SettlementState): boolean {
  return !hasExplicitStaffing(s) && Object.keys(s.districts ?? {}).length === 0;
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