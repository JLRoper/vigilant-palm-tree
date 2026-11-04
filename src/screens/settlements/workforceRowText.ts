import type { SettlementState } from "@heroes/contracts";
import {
  assignedWorkersExplicit,
  autoStaffedCount,
  autoStaffedSlots,
  hasLegacyStaffing,
  stalledConstructionSites,
  workforcePool,
} from "@heroes/engine";

// The settlement panel's Workforce row, as one pure string (2026-11-03).
//
// The sentence itself is unchanged from before the build-crew rule; what is new
// is the STALL COUNT appended last, after the existing `over pool` marker. It is
// the one global tell that the rule is live: a site with no builders makes no
// progress, and this is the only surface that says so without the player opening
// every building. It is absent when nothing is stalled -- never "0 sites
// stalled" -- and both forms carry it, because a mixed settlement can hold
// auto-crew buildings (never themselves stalled) and an explicitly-0 stalled
// site at once.
//
// Pure and exported so the exact words are asserted without a DOM.

export function workforceRowText(settlement: SettlementState): string {
  const pool = workforcePool(settlement);
  const assigned = assignedWorkersExplicit(settlement);
  const stalled = stalledConstructionSites(settlement);
  const stallSuffix = stalled > 0 ? ` \u00b7 ${stalled} site${stalled === 1 ? "" : "s"} stalled` : "";
  return hasLegacyStaffing(settlement)
    ? `auto crew \u00b7 ${autoStaffedCount(settlement)} bldgs (${autoStaffedSlots(settlement)} slots), pool ${pool}${stallSuffix}`
    : `${assigned}/${pool} assigned \u00b7 ${Math.max(0, pool - assigned)} idle${assigned > pool ? " \u00b7 over pool" : ""}${stallSuffix}`;
}
