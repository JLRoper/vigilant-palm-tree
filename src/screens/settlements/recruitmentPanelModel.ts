import type { BuildingDef, BuildingKind, SettlementState, Warehouse, WarehouseResource } from "@heroes/contracts";
import {
  buildingDraftMax,
  buildingDraftPerDay,
  buildingLabel,
  buildingMaxWorkers,
  canAssignWorkers,
  districtKey,
  draftRechargeMultiplier,
  getBuildingEffect,
  hasLegacyStaffing,
  assignedWorkersExplicit,
  tierDraftRechargeMultiplier,
  workforcePool,
  type UnitType,
} from "@heroes/engine";

// The recruitment panel as data: every offering the open settlement can train
// right now, grouped BY BUILDING KIND (six farmhouses are one FARMHOUSE block,
// not six) with the ready pool, the per-building staffing stepper basis, the
// buy-all allocation and the affordability arithmetic resolved here. DOM-free
// on purpose so the draft/staffing/affordability numbers are unit-testable
// (the bankRows.ts pattern).

export interface RecruitmentCostRow {
  resource: WarehouseResource;
  amount: number;
}

/** One building of a kind: its own pool of every unit the kind offers. */
export interface RecruitmentSource {
  gx: number;
  gy: number;
  district: { q: number; r: number } | null;
  buildingLevel: number;
  /** floor(draft[id] ?? draftMax), clamped at 0. */
  ready: number;
  /** Daily draft pool ceiling for this building kind. */
  draftMax: number;
  /** Nominal refill per day at THIS building's own staffing. */
  perDay: number;
}

export interface RecruitmentUnitRow {
  unitTypeId: string;
  buildingKind: BuildingKind;
  goldCost: number;
  resources: RecruitmentCostRow[];
  /** Sum of the sources' ready counts. */
  ready: number;
  /** Sum of the sources' draftMax. */
  capacity: number;
  /** Daily draft ceiling of ONE source building (every source shares it). */
  draftMax: number;
  /** Nominal refill per week across every source building. */
  perWeek: number;
  /**
   * The buildings that can supply this unit, most-stocked first (stable
   * tie-break: main city before districts, then coords) -- the order both the
   * row's `+` and buy-all draw from.
   */
  sources: RecruitmentSource[];
}

export interface RecruitmentBuildingRow {
  key: string;
  gx: number;
  gy: number;
  district: { q: number; r: number } | null;
  level: number;
  /** Explicit workers; undefined = legacy auto-staffing (effort 1). */
  workers: number | undefined;
  maxWorkers: number;
  /** This building's own ready total across the units it offers. */
  ready: number;
}

export interface RecruitmentGroup {
  /** The building kind -- one group per kind, however many buildings exist. */
  key: string;
  kind: BuildingKind;
  label: string;
  buildings: RecruitmentBuildingRow[];
  units: RecruitmentUnitRow[];
  /** Sum of the unit rows' ready counts. */
  ready: number;
  /** Sum of the unit rows' capacity. */
  capacity: number;
}

export interface RecruitmentSnapshotModel {
  groups: RecruitmentGroup[];
  ready: number;
  capacity: number;
  /** Idle + assigned workforce totals, the stepper's budget. */
  pool: number;
  assigned: number;
  /** Settlement-wide legacy staffing flag (any building without an explicit count). */
  legacy: boolean;
}

export interface RecruitmentFilter {
  isUnitRecruitable?: (unitTypeId: string) => boolean;
  /** Unit catalog for the tier-scaled refill rate; absent reads as tier 1. */
  unitTypes?: Record<string, UnitType>;
}

/** Where one recruit allocation lands, in commit order. */
export interface RecruitmentAllocationStep {
  gx: number;
  gy: number;
  district: { q: number; r: number } | null;
  count: number;
}

function costRows(entry: { resourceCost?: Partial<Record<WarehouseResource, number>> }): RecruitmentCostRow[] {
  const out: RecruitmentCostRow[] = [];
  for (const [resource, amount] of Object.entries(entry.resourceCost ?? {})) {
    if ((amount ?? 0) > 0) out.push({ resource: resource as WarehouseResource, amount: amount as number });
  }
  return out;
}

/** Mirrors settlement/draftRecharge.ts's per-day step for one unit entry. */
function perDayFor(building: BuildingDef, unitTypeId: string, unitTypes?: Record<string, UnitType>): number {
  return (
    buildingDraftPerDay(building.kind) *
    draftRechargeMultiplier(building) *
    tierDraftRechargeMultiplier(unitTypes?.[unitTypeId])
  );
}

function sourceRank(a: RecruitmentSource, b: RecruitmentSource): number {
  if (a.district === null && b.district !== null) return -1;
  if (a.district !== null && b.district === null) return 1;
  if (a.gx !== b.gx) return a.gx - b.gx;
  return a.gy - b.gy;
}

/**
 * Every offering of one building kind across the settlement, as a single group.
 * Buildings are walked main-city-first then in stable district-key order, and
 * each unit row's sources are re-sorted most-stocked-first, so the list never
 * reorders between renders.
 */
export function recruitmentSnapshot(
  settlement: SettlementState | undefined,
  filter?: RecruitmentFilter,
): RecruitmentSnapshotModel {
  const byKind = new Map<BuildingKind, RecruitmentGroup>();
  const addBuilding = (building: BuildingDef, district: { q: number; r: number } | null): void => {
    if (building.construction) return;
    const draftMax = buildingDraftMax(building.kind);
    const scope = district ? districtKey(district.q, district.r) : "main";
    let group = byKind.get(building.kind);
    if (!group) {
      group = {
        key: building.kind,
        kind: building.kind,
        label: buildingLabel(building.kind),
        buildings: [],
        units: [],
        ready: 0,
        capacity: 0,
      };
      byKind.set(building.kind, group);
    }
    let buildingReady = 0;
    for (const entry of getBuildingEffect(building.kind).recruits) {
      if ((entry.minLevel ?? 1) > building.level) continue;
      if (filter?.isUnitRecruitable && !filter.isUnitRecruitable(entry.unitTypeId)) continue;
      const ready = Math.max(0, Math.floor(building.draft?.[entry.unitTypeId] ?? draftMax));
      const perDay = perDayFor(building, entry.unitTypeId, filter?.unitTypes);
      let row = group.units.find((u) => u.unitTypeId === entry.unitTypeId);
      if (!row) {
        row = {
          unitTypeId: entry.unitTypeId,
          buildingKind: building.kind,
          goldCost: entry.goldCost,
          resources: costRows(entry),
          ready: 0,
          capacity: 0,
          draftMax,
          perWeek: 0,
          sources: [],
        };
        group.units.push(row);
      }
      row.ready += ready;
      row.capacity += draftMax;
      row.perWeek += perDay * 7;
      row.sources.push({
        gx: building.gx,
        gy: building.gy,
        district,
        buildingLevel: building.level,
        ready,
        draftMax,
        perDay,
      });
      buildingReady += ready;
    }
    group.buildings.push({
      key: `${building.kind}:${building.gx},${building.gy}:${scope}`,
      gx: building.gx,
      gy: building.gy,
      district,
      level: building.level,
      workers: building.workers,
      maxWorkers: buildingMaxWorkers(building.kind),
      ready: buildingReady,
    });
  };

  const groups: RecruitmentGroup[] = [];
  if (settlement) {
    for (const building of settlement.buildings) addBuilding(building, null);
    const districts = Object.values(settlement.districts ?? {})
      .slice()
      .sort((a, b) => districtKey(a.q, a.r).localeCompare(districtKey(b.q, b.r)));
    for (const d of districts) {
      const district = { q: d.q, r: d.r };
      for (const building of d.buildings) addBuilding(building, district);
    }
    for (const group of byKind.values()) {
      if (group.units.length === 0) continue;
      for (const row of group.units) row.sources.sort((a, b) => b.ready - a.ready || sourceRank(a, b));
      group.ready = group.units.reduce((sum, u) => sum + u.ready, 0);
      group.capacity = group.units.reduce((sum, u) => sum + u.capacity, 0);
      groups.push(group);
    }
  }
  return {
    groups,
    ready: groups.reduce((sum, g) => sum + g.ready, 0),
    capacity: groups.reduce((sum, g) => sum + g.capacity, 0),
    pool: settlement ? workforcePool(settlement) : 0,
    assigned: settlement ? assignedWorkersExplicit(settlement) : 0,
    legacy: settlement ? hasLegacyStaffing(settlement) : false,
  };
}

/** The group owning one building kind (undefined when the settlement has none). */
export function recruitmentGroupFor(
  model: RecruitmentSnapshotModel,
  kind: BuildingKind,
): RecruitmentGroup | undefined {
  return model.groups.find((g) => g.kind === kind);
}

/**
 * Split `total` units of one row across its source buildings: the most-stocked
 * building supplies first, and once the pools level out the draw round-robins
 * between them. Sources that end up supplying nothing are omitted, and steps
 * keep first-pick order so the commit order matches the description. Every
 * source shares the kind's cost table, so the caller's single affordability
 * check covers the whole allocation.
 */
export function allocateRecruitCounts(row: RecruitmentUnitRow, total: number): RecruitmentAllocationStep[] {
  const left = row.sources.map((s) => s.ready);
  const pooled = left.reduce((sum, n) => sum + n, 0);
  let remaining = Math.max(0, Math.min(Math.floor(total), pooled));
  const counts = row.sources.map(() => 0);
  const order: number[] = [];
  while (remaining > 0) {
    let best = -1;
    for (let i = 0; i < left.length; i++) {
      if (left[i] <= 0) continue;
      if (best === -1 || left[i] > left[best]) best = i;
    }
    if (best === -1) break;
    if (counts[best] === 0) order.push(best);
    counts[best] += 1;
    left[best] -= 1;
    remaining -= 1;
  }
  return order.map((i) => ({
    gx: row.sources[i].gx,
    gy: row.sources[i].gy,
    district: row.sources[i].district,
    count: counts[i],
  }));
}

/** Idle workers available to spend on a building right now. */
export function recruitmentIdleWorkers(snapshot: RecruitmentSnapshotModel): number {
  return Math.max(0, snapshot.pool - snapshot.assigned);
}

/**
 * The stepper's working count: legacy auto-staffing reads as 0, so the first
 * `+` on an untouched building starts its explicit crew (the engine then
 * auto-crews the rest of the settlement) -- the workforce panel's rule.
 */
export function recruitmentWorkerBase(
  building: RecruitmentBuildingRow,
  snapshot: RecruitmentSnapshotModel,
): number {
  return snapshot.legacy ? 0 : (building.workers ?? building.maxWorkers);
}

/** Whether one more worker can be added from the idle pool. */
export function recruitmentCanAddWorker(
  building: RecruitmentBuildingRow,
  snapshot: RecruitmentSnapshotModel,
): boolean {
  return canAssignWorkers(
    recruitmentWorkerBase(building, snapshot),
    building.maxWorkers,
    1,
    snapshot.pool,
    snapshot.assigned,
  );
}

/** Whether one worker can be taken off this building. */
export function recruitmentCanRemoveWorker(
  building: RecruitmentBuildingRow,
  snapshot: RecruitmentSnapshotModel,
): boolean {
  return recruitmentWorkerBase(building, snapshot) > 0;
}

/** The count a stepper click commits (clamped to the building's own slots). */
export function recruitmentWorkerTarget(
  building: RecruitmentBuildingRow,
  snapshot: RecruitmentSnapshotModel,
  delta: 1 | -1,
): number {
  const base = recruitmentWorkerBase(building, snapshot);
  return delta > 0 ? Math.min(base + 1, building.maxWorkers) : Math.max(0, base - 1);
}

/** True when `count` of one row could be paid out of the treasury. */
export function recruitmentAffordable(
  settlement: SettlementState | undefined,
  row: RecruitmentUnitRow,
  count: number,
): boolean {
  if (!settlement || !Number.isInteger(count) || count < 1) return false;
  if (settlement.gold < row.goldCost * count) return false;
  for (const cost of row.resources) {
    if ((settlement.warehouse[cost.resource] ?? 0) < cost.amount * count) return false;
  }
  return true;
}

/**
 * Largest count of one row that is both ready across its sources and payable.
 * 0 means the row is dead this turn -- the panel greys it out.
 */
export function recruitmentMaxCount(
  settlement: SettlementState | undefined,
  row: RecruitmentUnitRow,
): number {
  if (!settlement || row.ready < 1) return 0;
  let max = row.ready;
  if (row.goldCost > 0) max = Math.min(max, Math.floor(settlement.gold / row.goldCost));
  for (const cost of row.resources) {
    if (cost.amount > 0) max = Math.min(max, Math.floor((settlement.warehouse[cost.resource] ?? 0) / cost.amount));
  }
  return Math.max(0, max);
}

/** Settlement treasury readout for the panel's header strip. */
export function recruitmentTreasury(settlement: SettlementState | undefined): {
  gold: number;
  warehouse: Warehouse;
} {
  return {
    gold: settlement?.gold ?? 0,
    warehouse: settlement?.warehouse ?? { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
  };
}
