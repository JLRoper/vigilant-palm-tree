import type {
  BuildingKind,
  GameState,
  SettlementId,
  SettlementState,
  Warehouse,
} from "@heroes/contracts";
import type { Platoon } from "../units";
import { MAX_PLATOON_ENTRIES, normalizePlatoons, settlementStacks } from "../units";
import { getBuildingEffect } from "../buildingRegistry";

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
