import type {
  BuildingDef,
  BuildingKind,
  DistrictState,
  GameState,
  SettlementId,
  SettlementState,
  Warehouse,
} from "@heroes/contracts";
import type { Platoon } from "../units";
import { MAX_PLATOON_ENTRIES, normalizePlatoons, settlementStacks } from "../units";
import { buildingDraftMax, getBuildingEffect, type RecruitEntry } from "../buildingRegistry";
import { districtKey } from "../control";

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
  district?: { q: number; r: number };
}

// Construction-worker-gated faction-building feature: the SEAT-faction
// recruit gate (`unitAllowedForSeatFaction` + its `opts.seatFactionId`) is
// deleted here. It used to compare the recruiting SEAT's roster faction
// against each unit's own faction_id, but every recruit-building's roster is
// already faction-pure by construction (a crypt only ever lists ashen units,
// forgeHall only ironmark, etc. -- buildingFactionParity.test.ts and the
// per-faction building definitions in buildingRegistry.ts pin this), so
// gating on the OWNING building already enforces faction purity with no
// second check needed. A seat now recruits whatever its OWNED buildings
// (built or captured) currently offer -- which is also what makes a captured
// enemy building finally worth capturing: before this, a human seat that took
// an ashen crypt could never draft from it (unit_not_in_seat_faction), so the
// building sat as dead weight. See docs/army.md and the faction-construction
// plan for the fuller rationale.
export function eligibleRecruitSources(settlement: SettlementState): RecruitSource[] {
  const out: RecruitSource[] = [];
  for (const building of settlement.buildings) {
    if (building.construction) continue;
    for (const entry of getBuildingEffect(building.kind).recruits) {
      if ((entry.minLevel ?? 1) > building.level) continue;
      out.push({ buildingKind: building.kind, gx: building.gx, gy: building.gy, entry });
    }
  }
  for (const d of Object.values(settlement.districts ?? {})) {
    for (const building of d.buildings) {
      if (building.construction) continue;
      for (const entry of getBuildingEffect(building.kind).recruits) {
        if ((entry.minLevel ?? 1) > building.level) continue;
        out.push({
          buildingKind: building.kind,
          gx: building.gx,
          gy: building.gy,
          entry,
          district: { q: d.q, r: d.r },
        });
      }
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

type LocatedRecruitBuilding =
  | { where: "main"; building: BuildingDef; index: number; list: BuildingDef[] }
  | {
      where: "district";
      building: BuildingDef;
      index: number;
      list: BuildingDef[];
      district: DistrictState;
      districtKey: string;
    };

function locateRecruitBuilding(
  settlement: SettlementState,
  buildingKind: BuildingKind,
  gx: number,
  gy: number,
  district?: { q: number; r: number },
): LocatedRecruitBuilding | null {
  if (district) {
    const key = districtKey(district.q, district.r);
    const d = settlement.districts?.[key];
    const index =
      d?.buildings.findIndex((b) => b.kind === buildingKind && b.gx === gx && b.gy === gy) ?? -1;
    if (d && index >= 0) {
      return { where: "district", building: d.buildings[index], index, list: d.buildings, district: d, districtKey: key };
    }
    return null;
  }
  const mainIndex = settlement.buildings.findIndex(
    (b) => b.kind === buildingKind && b.gx === gx && b.gy === gy,
  );
  if (mainIndex >= 0) {
    return {
      where: "main",
      building: settlement.buildings[mainIndex],
      index: mainIndex,
      list: settlement.buildings,
    };
  }
  const matches: Array<Omit<Extract<LocatedRecruitBuilding, { where: "district" }>, "where">> = [];
  for (const d of Object.values(settlement.districts ?? {})) {
    const index = d.buildings.findIndex(
      (b) => b.kind === buildingKind && b.gx === gx && b.gy === gy,
    );
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

export function recruitUnits(
  state: GameState,
  opts: {
    settlementId: SettlementId;
    buildingKind: BuildingKind;
    gx: number;
    gy: number;
    unitTypeId: string;
    count: number;
    district?: { q: number; r: number };
  },
): { state: GameState; ok: boolean; reason: string; available?: number } {
  const settlement = state.settlements[opts.settlementId];
  if (!settlement) return { state, ok: false, reason: "no_settlement" };
  if (settlement.ownerId == null) return { state, ok: false, reason: "unowned_settlement" };
  const located = locateRecruitBuilding(settlement, opts.buildingKind, opts.gx, opts.gy, opts.district);
  if (!located) return { state, ok: false, reason: "no_building" };
  const building = located.building;
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
  const draftMax = buildingDraftMax(building.kind);
  const draftPool = building.draft?.[opts.unitTypeId] ?? draftMax;
  if (opts.count > Math.floor(draftPool)) {
    return { state, ok: false, reason: "draft_pool_empty", available: Math.floor(draftPool) };
  }
  const deposit = depositIntoGarrison(settlementStacks(settlement), opts.unitTypeId, opts.count);
  if (!deposit.ok) return { state, ok: false, reason: "garrison_full" };
  const warehouse: Warehouse = { ...settlement.warehouse };
  for (const [res, amount] of owedResources) warehouse[res] -= amount;
  const nextDraft = {
    ...(building.draft ?? {}),
    [opts.unitTypeId]: draftPool - opts.count,
  };
  const nextBuilding: BuildingDef = { ...building, draft: nextDraft };
  const buildings =
    located.where === "main"
      ? located.list.map((b, i) => (i === located.index ? nextBuilding : b))
      : settlement.buildings;
  const updated: SettlementState = {
    ...settlement,
    gold: settlement.gold - goldOwed,
    warehouse,
    stacks: deposit.stacks,
    ...(located.where === "main"
      ? { buildings }
      : {
          districts: {
            ...(settlement.districts ?? {}),
            [located.districtKey]: {
              ...located.district,
              buildings: located.list.map((b, i) => (i === located.index ? nextBuilding : b)),
            },
          },
        }),
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
