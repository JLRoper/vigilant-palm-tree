import type { BuildingDef } from "@heroes/contracts";
import type { ResourceType } from "../../../state/gameState";

/** The resources a cart can owe (mirrors netCost's list, kept local so the signature cannot drift from it). */
const SIGNATURE_RESOURCES: readonly ResourceType[] = ["gold", "wood", "stone", "iron", "arcane"];

/**
 * A stable fingerprint of "the cart as the server would store it": the synced
 * buildings, the district it belongs to, the initial-layout flag, and the net
 * charge still owed.
 *
 * Two commits with the same fingerprint would send byte-identical payloads, so
 * the second one is a no-op by construction. That is what makes `✓ Confirm`
 * after a placement write nothing: every placement already commits
 * incrementally, and Confirm used to re-send the same cart (playthrough finding
 * 3: two identical POSTs, a second `buildings_placed` event, and a duplicate-key
 * rejection from the granular store).
 *
 * The charge is part of the fingerprint on purpose: place a paid building and
 * destroy it again and the cart's buildings are back where they started, but the
 * commit still owes a refund -- a signature without the delta would swallow it.
 */
export function cartCommitSignature(
  buildings: BuildingDef[],
  initialLayout: boolean,
  district: { q: number; r: number } | undefined,
  delta: Partial<Record<ResourceType, number>>,
): string {
  const cells = buildings
    .map((b) =>
      [
        b.gx,
        b.gy,
        b.kind,
        b.level,
        b.style ?? "",
        b.w ?? "",
        b.h ?? "",
        b.construction?.daysRemaining ?? "",
      ].join(","),
    )
    .sort();
  const charge = SIGNATURE_RESOURCES.map((r) => `${r}:${delta[r] ?? 0}`).join(",");
  const where = district ? `${district.q},${district.r}` : "-";
  return `${where}|${initialLayout ? "initial" : "user"}|${cells.join(";")}|${charge}`;
}
