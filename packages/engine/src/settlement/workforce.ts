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

// THE BUILD CREW (2026-11-03). A building under construction is staffed work:
// its daily decrement is `buildRate(buildersOnSite(b))` days per day tick and a
// site with no builders makes NO progress at all (0 builders = 0 days). The
// crew ceiling while `construction` is set is `CONSTRUCTION_MAX_BUILDERS` for
// EVERY kind; the moment the timer clears, `buildingMaxWorkers(kind)` governs
// again, so the construction ceiling raises no building's operational capacity
// (a house still holds exactly 1 worker once it is finished).
//
// The curve is scaled so its TOP is the rate today's engine already reaches at
// a kind's own cap -- `buildRate(4) === 2.00 === 1 + effortFraction(full crew)`
// -- one step is 1/3. That equality is the whole point: the free auto crew
// (`workers === undefined` = a full crew) therefore builds in EXACTLY the time
// it builds today, and an untouched building is not nerfed by this feature.
export const CONSTRUCTION_MAX_BUILDERS = 4;
export const BUILD_RATE_PER_EXTRA_BUILDER = 1 / 3;

/** Days a site advances per day tick: 0 / 1.00 / 1.33 / 1.67 / 2.00 for 0-4
 * builders. The ceiling is applied here as well as in `buildersOnSite`, so no
 * caller can buy more than the construction cap by passing a raw count. */
export function buildRate(builders: number): number {
  const crew = Math.min(Math.max(builders, 0), CONSTRUCTION_MAX_BUILDERS);
  if (crew <= 0) return 0;
  return 1 + BUILD_RATE_PER_EXTRA_BUILDER * (crew - 1);
}

/** THIS building's crew cap: the construction ceiling while it is a site, its
 * kind's own operational cap once it is finished. Every ceiling reader (the
 * reducer, the pool arithmetic, the stepper, the drag, the panels, the district
 * road) reads this and never `buildingMaxWorkers` directly for a crew limit. */
export function staffingCeiling(b: BuildingDef): number {
  return b.construction ? CONSTRUCTION_MAX_BUILDERS : buildingMaxWorkers(b.kind);
}

/** The builders actually on the building: an absent count is the auto crew and
 * reads as the ceiling (unchanged), an explicit count is clamped to it. An
 * auto-crewed site is therefore a full 4-builder crew. */
export function buildersOnSite(b: BuildingDef): number {
  const ceiling = staffingCeiling(b);
  if (b.workers === undefined) return ceiling;
  return Math.min(Math.max(b.workers, 0), ceiling);
}

/** How many of the settlement's construction sites have nobody on them -- the
 * sites making no progress. Main city and every district. The settlement panel
 * prints this so a frozen site somewhere is visible without opening it. */
export function stalledConstructionSites(s: SettlementState): number {
  const stalled = (b: BuildingDef): boolean => b.construction !== undefined && buildersOnSite(b) <= 0;
  let total = s.buildings.filter(stalled).length;
  for (const d of Object.values(s.districts ?? {})) total += d.buildings.filter(stalled).length;
  return total;
}

/**
 * The pool slots the settlement's buildings have CLAIMED (2026-11-03): a site
 * claims the crew it may hold while it is being built, a finished building claims
 * the count it holds.
 *
 * This is the accounting a PLACEMENT gate reads, and the reason it cannot be
 * `assignedWorkersExplicit`: a site nobody has been assigned to yet stores an
 * explicit `0`, so it contributes nothing there and the seat's idle pool looks
 * untouched on the next round -- it then starts a second site, and a third,
 * against slots that are already spoken for (measured: 31 AI buildings against a
 * 17-slot pool, 22 of 23 sites then frozen half-built).
 *
 * A SITE's claim is `CONSTRUCTION_MAX_BUILDERS`, not its kind's own cap: that is
 * what the crew pass puts on it (`pickAiConstructionStaffing`, stalled site
 * first, up to the ceiling), so a placement the seat cannot put builders on this
 * round is a site it cannot start -- charging the smaller pin instead let a seat
 * open eight sites for a sixteen-slot pool and leave four of them dark for
 * rounds (seen in a real game). The claim is always at least the crew the
 * completion trim will pin, because no kind's cap exceeds the ceiling.
 *
 * The auto crew (`workers === undefined`) claims nothing -- it is free by
 * convention, exactly as it is in `assignedWorkersExplicit` and
 * `autoStaffedSlots`.
 */
export function committedWorkerSlots(s: SettlementState): number {
  let total = 0;
  const add = (b: BuildingDef): void => {
    if (b.workers === undefined) return;
    total += b.construction ? CONSTRUCTION_MAX_BUILDERS : b.workers;
  };
  for (const b of s.buildings) add(b);
  for (const d of Object.values(s.districts ?? {})) {
    for (const b of d.buildings) add(b);
  }
  return total;
}

/** Worker slots the settlement's auto-staffed (`workers === undefined`) buildings occupy. */
export function autoStaffedSlots(s: SettlementState): number {
  let total = 0;
  for (const b of s.buildings) if (b.workers === undefined) total += staffingCeiling(b);
  for (const d of Object.values(s.districts ?? {})) {
    for (const b of d.buildings) if (b.workers === undefined) total += staffingCeiling(b);
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
 * Whether THIS building runs on the legacy auto crew -- its OWN missing count,
 * not the settlement's (2026-11-03).
 *
 * The settlement-wide `hasLegacyStaffing` is the right question for the panel's
 * header and for `newPlacementsAutoCrew`, and the WRONG one for anything that
 * steps a single building: a city holding one auto-crewed building (every classic
 * starter city, and every settlers town whose first placement kept `workers`
 * undefined) reads as legacy as a whole, so `staffingBase` returned 0 for every
 * OTHER building too and `+` wrote 1 forever. Measured on a level-2 town holding
 * a 4-builder site: three clicks on `+` sent three identical
 * `{"kind":"AssignWorkers","workers":1}` commands and the row stayed `1 / 4`, so
 * the 1.33x / 1.67x / 2.00x steps this feature introduces were unreachable from
 * the interface.
 */
export function buildingLegacyStaffing(b: { workers?: number }): boolean {
  return b.workers === undefined;
}

/** The count a stepper's next `+`/`-` writes for ONE building (`ceiling` is its
 * `staffingCeiling`): one step (`delta`) from its own resume point, clamped to
 * the ceiling and never below 0. Shared by the building menu's row and the
 * workforce panel's rows, so one step is one rule. */
export function steppedWorkers(b: { workers?: number }, ceiling: number, delta: number): number {
  const base = staffingBase(b.workers, ceiling, buildingLegacyStaffing(b));
  return Math.max(0, Math.min(base + delta, ceiling));
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