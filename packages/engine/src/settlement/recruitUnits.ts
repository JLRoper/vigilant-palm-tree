import type {
  BuildingKind,
  FactionId,
  GameState,
  SettlementId,
  SettlementState,
  Warehouse,
} from "@heroes/contracts";
import type { Platoon, UnitType } from "../units";
import { MAX_PLATOON_ENTRIES, normalizePlatoons, settlementStacks, unitFactionId } from "../units";
import { getBuildingEffect, type RecruitEntry } from "../buildingRegistry";

// The recruit-eligibility gate shared by the RecruitUnits command and the AI
// garrison planner: a building offers a unit only when construction finished
// and the unit's minLevel is met. The command keeps its granular per-check
// reason codes; this helper is the single source of "what can this settlement
// recruit right now".
export interface RecruitSource {
  buildingKind: BuildingKind;
  gx: number;
  gy: number;
  entry: RecruitEntry;
}

// The faction gate's inputs (faction-registry foundation, D5). Both halves
// must be present for the gate to act — when either is absent the filter
// no-ops, which is what keeps every existing caller (AI planner, client
// paths) byte-identical until factions exist.
export interface RecruitFactionGate {
  unitTypes?: Record<string, UnitType>;
  seatFactionId?: FactionId;
}

// Whether one unit id may be recruited by a seat of `opts.seatFactionId`.
// Unknown unit ids default to "human" (unitFactionId's D3 rule), so a
// catalog-less comparison never blocks anything. Absent/incomplete opts =
// allowed (the dormant gate).
export function unitAllowedForSeatFaction(unitTypeId: string, opts?: RecruitFactionGate): boolean {
  if (!opts?.unitTypes || !opts.seatFactionId) return true;
  return unitFactionId(opts.unitTypes[unitTypeId]) === opts.seatFactionId;
}

export function eligibleRecruitSources(
  settlement: SettlementState,
  opts?: RecruitFactionGate,
): RecruitSource[] {
  const out: RecruitSource[] = [];
  for (const building of settlement.buildings) {
    if (building.construction) continue;
    for (const entry of getBuildingEffect(building.kind).recruits) {
      if ((entry.minLevel ?? 1) > building.level) continue;
      if (!unitAllowedForSeatFaction(entry.unitTypeId, opts)) continue;
      out.push({ buildingKind: building.kind, gx: building.gx, gy: building.gy, entry });
    }
  }
  return out;
}

// Merge `count` units of one type into a platoon set: an entry of the same
// type grows in place, else the first platoon below MAX_PLATOON_ENTRIES gets
// a new entry, else it fails. Input is normalized first so the result always
// holds exactly 8 slots of at most 3 valid entries.
export function depositIntoGarrison(
  stacks: Platoon[],
  unitTypeId: string,
  count: number,
): { stacks: Platoon[]; ok: boolean } {
  const out = normalizePlatoons(stacks);
  let target = out.find((p) => p.entries.some((e) => e.unitTypeId === unitTypeId));
  if (!target) target = out.find((p) => p.entries.length < MAX_PLATOON_ENTRIES);
  if (!target) return { stacks: out, ok: false };
  const entry = target.entries.find((e) => e.unitTypeId === unitTypeId);
  if (entry) entry.count += count;
  else target.entries.push({ unitTypeId, count });
  return { stacks: out, ok: true };
}

export function recruitUnits(
  state: GameState,
  opts: {
    settlementId: SettlementId;
    buildingKind: BuildingKind;
    gx: number;
    gy: number;
    unitTypeId: string;
    count: number;
  },
): { state: GameState; ok: boolean; reason: string } {
  const settlement = state.settlements[opts.settlementId];
  if (!settlement) return { state, ok: false, reason: "no_settlement" };
  if (settlement.ownerId == null) return { state, ok: false, reason: "unowned_settlement" };
  const building = settlement.buildings.find(
    (b) => b.kind === opts.buildingKind && b.gx === opts.gx && b.gy === opts.gy,
  );
  if (!building) return { state, ok: false, reason: "no_building" };
  if (building.construction) return { state, ok: false, reason: "building_under_construction" };
  const recruitEntry = getBuildingEffect(opts.buildingKind).recruits.find(
    (r) => r.unitTypeId === opts.unitTypeId,
  );
  if (!recruitEntry) return { state, ok: false, reason: "not_recruitable" };
  if ((recruitEntry.minLevel ?? 1) > building.level) {
    return { state, ok: false, reason: "building_level_too_low" };
  }
  if (!Number.isInteger(opts.count) || opts.count < 1) {
    return { state, ok: false, reason: "invalid_count" };
  }
  const goldOwed = recruitEntry.goldCost * opts.count;
  if (settlement.gold < goldOwed) return { state, ok: false, reason: "not_enough_gold" };
  const owedResources: Array<[keyof Warehouse, number]> = [];
  for (const res of Object.keys(recruitEntry.resourceCost ?? {}) as (keyof Warehouse)[]) {
    owedResources.push([res, (recruitEntry.resourceCost?.[res] ?? 0) * opts.count]);
  }
  for (const [res, amount] of owedResources) {
    if (settlement.warehouse[res] < amount) {
      return { state, ok: false, reason: `not_enough_${res}` };
    }
  }
  const deposit = depositIntoGarrison(settlementStacks(settlement), opts.unitTypeId, opts.count);
  if (!deposit.ok) return { state, ok: false, reason: "garrison_full" };
  const warehouse: Warehouse = { ...settlement.warehouse };
  for (const [res, amount] of owedResources) warehouse[res] -= amount;
  const updated: SettlementState = {
    ...settlement,
    gold: settlement.gold - goldOwed,
    warehouse,
    stacks: deposit.stacks,
  };
  return {
    state: {
      ...state,
      settlements: { ...state.settlements, [opts.settlementId]: updated },
      dirty: true,
    },
    ok: true,
    reason: "",
  };
}
