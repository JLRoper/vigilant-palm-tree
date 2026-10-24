import type { BuildingKind, FactionId, SettlementState } from "@heroes/contracts";
import {
  CONSTRUCTION_WORKER_GOLD_COST,
  CONSTRUCTION_WORKER_UNIT_BY_FACTION,
  constructionWorkerUnitId,
  getBuildingEffect,
  type RecruitEntry,
} from "../buildingRegistry";
import { settlementStacks } from "../units";

// Construction Worker (faction-construction plan): a non-combat unit, one
// per playable faction, that a settlement's garrison must hold at least one
// of before it can place a NEW building tagged with that SAME faction
// (buildingConstructionGate below). It is a standing requirement, not
// consumed on use -- losing the worker (e.g. in battle) blocks further
// faction-building construction there until another is walked or ridden in.
// The ids/price themselves live in buildingRegistry.ts (re-exported here)
// so the four starter troop buildings' own `recruits` literals can
// reference them without a module cycle; see that file's header comment.
export { CONSTRUCTION_WORKER_GOLD_COST, CONSTRUCTION_WORKER_UNIT_BY_FACTION, constructionWorkerUnitId };

/** True when `settlement`'s garrison currently holds at least one live Construction Worker of `factionId`. Presence only -- the worker is never consumed. */
export function settlementHasConstructionWorker(
  settlement: { stacks?: SettlementState["stacks"] } | undefined,
  factionId: FactionId,
): boolean {
  const unitTypeId = constructionWorkerUnitId(factionId);
  return settlementStacks(settlement).some((platoon) =>
    platoon.entries.some((entry) => entry.unitTypeId === unitTypeId && entry.count > 0),
  );
}

export type ConstructionGateReason = "missing_construction_worker";

export interface ConstructionGateResult {
  ok: boolean;
  reason?: ConstructionGateReason;
}

/**
 * Whether `settlement` may place a NEW building of `kind` right now.
 * Untagged (economy) buildings are always allowed -- no worker needed, same
 * as before. A building tagged faction F requires an F Construction Worker
 * currently present in the settlement's garrison/stacks (settlementStacks),
 * REGARDLESS of the settlement owner's own seat faction: the worker's
 * faction is what matters, not the seat's. This replaces the pure
 * seat-vs-building-tag check PR #252 shipped (buildingAllowedForFaction
 * compared the OWNER's factionId against the tag); that comparison is gone
 * from this gate entirely -- see placeBuildings.ts for where it used to run.
 */
export function buildingConstructionGate(
  kind: BuildingKind,
  settlement: { stacks?: SettlementState["stacks"] } | undefined,
): ConstructionGateResult {
  const faction = getBuildingEffect(kind).faction;
  if (faction === undefined) return { ok: true };
  if (settlementHasConstructionWorker(settlement, faction)) return { ok: true };
  return { ok: false, reason: "missing_construction_worker" };
}

/**
 * The Construction Worker's own recruit entry for `factionId`, appended to
 * that faction's starter troop building (farmhouse/crypt/delversHall/
 * seedlingGrove -- see starterLayout.ts's STARTER_TROOP_BUILDING_BY_FACTION)
 * rather than to townHall.
 *
 * Deviation flagged for review: the spec's own wording points at townHall
 * ("every faction already has one, in every settlement, untouched by
 * faction tagging"), specifically because townHall survives even if a
 * player demolishes their starter troop building (DemolishBuilding, section
 * 5, has no such protection). Wiring it onto townHall would need a NEW
 * per-settlement-faction recruit-list mechanism threaded through both the
 * engine recruit path AND the client's building menu / recruitment panel
 * (townHall is deliberately NOT faction-tagged, shared by every faction, so
 * its *static* registry recruit list can't vary by settlement the way a
 * tagged building's can) -- a materially bigger change than reusing the
 * existing faction-purity pattern the starter troop buildings already have.
 * Risk this accepts: a settlement that loses BOTH its starter troop building
 * (demolished) AND every Construction Worker of its own faction can no
 * longer recruit a replacement worker there at all (it would need a worker
 * walked in from elsewhere) -- worth a human's attention; see the PR
 * description.
 */
export function constructionWorkerRecruitEntry(factionId: FactionId): RecruitEntry {
  return { unitTypeId: constructionWorkerUnitId(factionId), goldCost: CONSTRUCTION_WORKER_GOLD_COST, minLevel: 1 };
}
