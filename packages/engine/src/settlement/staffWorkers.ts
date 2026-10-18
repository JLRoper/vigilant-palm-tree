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

// Auto-crew priority for the first-touch conversion: every job slot is filled
// before any housing is used. Food producers first (starvation), then the other
// producers, the market, recruiters, and the town hall's upgrade acceleration;
// houses/apartments are the fallback ("sit at a house") for workers with no
// job left. Inert kinds are never auto-filled -- parking there is a manual
// choice.
const AUTO_JOB_ORDER: readonly BuildingDef["kind"][] = [
  "farmField", "farmhouse", "granary",
  "woodcutterHut", "stoneMine", "mine", "ironMine", "arcaneFont", "goldMine",
  "market",
  "barracks", "archeryRange", "stables", "huntingLodge", "eyrie", "smithy",
  "mageGuild", "crypt", "ossuary", "wraithBarrows", "spireOfAsh", "forgeHall",
  "gunnersRedoubt", "golemFoundry", "deepAnvil", "groveSanctum", "warrenLodge",
  "sylvanStables", "worldrootGrove",
  "townHall",
];
const AUTO_HOUSING_ORDER: readonly BuildingDef["kind"][] = ["house", "apartment"];
const AUTO_JOB_RANK = new Map<BuildingDef["kind"], number>(AUTO_JOB_ORDER.map((k, i) => [k, i]));
const AUTO_HOUSING_RANK = new Map<BuildingDef["kind"], number>(AUTO_HOUSING_ORDER.map((k, i) => [k, i]));

interface AutoCrewTarget {
  kind: BuildingDef["kind"];
  max: number;
  districtKey: string | null;
  index: number;
  workers: number;
}

function autoKey(district: string | null, b: { gx: number; gy: number }): string {
  return `${district ?? "main"}:${b.gx},${b.gy}`;
}

/** Every building the settlement left unassigned (workers undefined) before
 * normalization, addressed by its own list so main/district coordinate overlap
 * cannot collide. */
function collectLegacyKeys(settlement: SettlementState): Set<string> {
  const keys = new Set<string>();
  for (const b of settlement.buildings) if (b.workers === undefined) keys.add(autoKey(null, b));
  for (const [key, d] of Object.entries(settlement.districts ?? {})) {
    for (const b of d.buildings) if (b.workers === undefined) keys.add(autoKey(key, b));
  }
  return keys;
}

function collectAutoCrewTargets(
  settlement: SettlementState,
  autoKeys: ReadonlySet<string>,
  reserved: ReadonlySet<string>,
): AutoCrewTarget[] {
  const targets: AutoCrewTarget[] = [];
  const push = (b: BuildingDef, index: number, district: string | null): void => {
    const key = autoKey(district, b);
    if (!autoKeys.has(key) || reserved.has(key)) return;
    const max = buildingMaxWorkers(b.kind);
    if (max < 1 || b.construction) return;
    targets.push({ kind: b.kind, max, districtKey: district, index, workers: b.workers ?? 0 });
  };
  settlement.buildings.forEach((b, i) => push(b, i, null));
  for (const [key, d] of Object.entries(settlement.districts ?? {})) d.buildings.forEach((b, i) => push(b, i, key));
  return targets;
}

function autoPosition(a: AutoCrewTarget, b: AutoCrewTarget): number {
  return (a.districtKey ?? "").localeCompare(b.districtKey ?? "") || a.index - b.index;
}

/** Level-fill round-robin ACROSS JOB KINDS: one worker per kind per pass (to
 * the least-staffed building of that kind), so a small pool opens a balanced
 * set of jobs -- food, wood, stone, etc. -- instead of spending everything on
 * the first kind in the priority list. */
function fillByKind(
  targets: AutoCrewTarget[],
  rank: ReadonlyMap<BuildingDef["kind"], number>,
  remaining: number,
): number {
  if (targets.length === 0 || remaining <= 0) return remaining;
  const groups = new Map<BuildingDef["kind"], AutoCrewTarget[]>();
  for (const t of targets) {
    let group = groups.get(t.kind);
    if (!group) {
      group = [];
      groups.set(t.kind, group);
    }
    group.push(t);
  }
  const kinds = [...groups.keys()].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  for (const group of groups.values()) group.sort(autoPosition);
  let left = remaining;
  let placed = true;
  while (left > 0 && placed) {
    placed = false;
    for (const kind of kinds) {
      if (left <= 0) break;
      let next: AutoCrewTarget | null = null;
      for (const t of groups.get(kind)!) {
        if (t.workers >= t.max) continue;
        if (next === null || t.workers < next.workers) next = t;
      }
      if (next === null) continue;
      next.workers += 1;
      left -= 1;
      placed = true;
    }
  }
  return left;
}

function writeAutoCrew(settlement: SettlementState, targets: readonly AutoCrewTarget[]): SettlementState {
  if (targets.length === 0) return settlement;
  const main = new Map<number, number>();
  const districts = new Map<string, Map<number, number>>();
  for (const t of targets) {
    if (t.districtKey === null) {
      main.set(t.index, t.workers);
    } else {
      let updates = districts.get(t.districtKey);
      if (!updates) {
        updates = new Map<number, number>();
        districts.set(t.districtKey, updates);
      }
      updates.set(t.index, t.workers);
    }
  }
  const buildings = settlement.buildings.map((b, i) => (main.has(i) ? { ...b, workers: main.get(i)! } : b));
  const nextDistricts: Record<string, DistrictState> | undefined = settlement.districts
    ? Object.fromEntries(
        Object.entries(settlement.districts).map(([key, d]) => {
          const updates = districts.get(key);
          return updates
            ? [key, { ...d, buildings: d.buildings.map((b, i) => (updates.has(i) ? { ...b, workers: updates.get(i)! } : b)) }]
            : [key, d];
        }),
      )
    : undefined;
  return { ...settlement, buildings, ...(nextDistricts ? { districts: nextDistricts } : {}) };
}

/** The first assignment converts a legacy settlement to explicit crews, but the
 * workers it did NOT place are auto-employed: jobs first (priority order,
 * level-filled), then houses/apartments, and only the true remainder stays
 * idle. Explicit counts and the command's own target/source are reserved. */
function autoCrewSettlement(
  settlement: SettlementState,
  autoKeys: ReadonlySet<string>,
  reserved: ReadonlySet<string>,
): SettlementState {
  const remainingStart = workforcePool(settlement) - assignedWorkersExplicit(settlement);
  if (remainingStart <= 0 || autoKeys.size === 0) return settlement;
  const targets = collectAutoCrewTargets(settlement, autoKeys, reserved);
  if (targets.length === 0) return settlement;
  const jobs = targets.filter((t) => AUTO_JOB_RANK.has(t.kind));
  const housing = targets.filter((t) => AUTO_HOUSING_RANK.has(t.kind));
  const remaining = fillByKind(jobs, AUTO_JOB_RANK, remainingStart);
  if (remaining > 0) fillByKind(housing, AUTO_HOUSING_RANK, remaining);
  return writeAutoCrew(settlement, targets);
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
  if (opts.source) {
    const source = locateBuilding(settlement, opts.source.gx, opts.source.gy, opts.district);
    if (!source || source.building === building) return { state, ok: false, reason: "invalid_source" };
    const sourceMax = buildingMaxWorkers(source.building.kind);
    const sourceWorkers = (source.building.workers ?? sourceMax) - 1;
    const destinationWorkers = hasLegacyStaffing(settlement) ? 1 : (building.workers ?? maxWorkers) + 1;
    if (sourceMax < 1 || sourceWorkers < 0 || sourceWorkers > sourceMax || destinationWorkers > maxWorkers || opts.workers !== destinationWorkers) {
      return { state, ok: false, reason: "invalid_workers" };
    }
    const normalized = hasLegacyStaffing(settlement) ? normalizeStaffing(settlement) : settlement;
    const legacyKeys = normalized === settlement ? null : collectLegacyKeys(settlement);
    const normalizedSource = locateBuilding(normalized, opts.source.gx, opts.source.gy, opts.district)!;
    const afterSource = writeWorkers(normalized, normalizedSource, sourceWorkers);
    const destination = locateBuilding(afterSource, opts.gx, opts.gy, opts.district)!;
    let updatedSettlement = writeWorkers(afterSource, destination, destinationWorkers);
    if (assignedWorkersExplicit(updatedSettlement) > workforcePool(updatedSettlement)) {
      return { state, ok: false, reason: "pool_exhausted" };
    }
    if (legacyKeys) {
      const reserved = new Set([
        autoKey(located.where === "district" ? located.districtKey : null, building),
        autoKey(source.where === "district" ? source.districtKey : null, source.building),
      ]);
      updatedSettlement = autoCrewSettlement(updatedSettlement, legacyKeys, reserved);
    }
    return { state: { ...state, settlements: { ...state.settlements, [opts.settlementId]: updatedSettlement }, dirty: true }, ok: true };
  }
  const legacyKeys = hasLegacyStaffing(settlement) ? collectLegacyKeys(settlement) : null;
  const normalized = legacyKeys ? normalizeStaffing(settlement) : settlement;
  const target = normalized === settlement ? located : locateBuilding(normalized, opts.gx, opts.gy, opts.district);
  if (!target) return { state, ok: false, reason: "no_building" };
  let updatedSettlement = writeWorkers(normalized, target, opts.workers);
  if (opts.workers > (building.workers ?? 0)) {
    if (assignedWorkersExplicit(updatedSettlement) > workforcePool(updatedSettlement)) {
      return { state, ok: false, reason: "pool_exhausted" };
    }
  }
  if (legacyKeys) {
    updatedSettlement = autoCrewSettlement(
      updatedSettlement,
      legacyKeys,
      new Set([autoKey(target.where === "district" ? target.districtKey : null, target.building)]),
    );
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