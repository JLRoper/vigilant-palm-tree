import type { ResourceType } from "../../../map/resourceTiles";

export type NetCost = Partial<Record<ResourceType, number>>;

const NET_COST_RESOURCES = ["gold", "wood", "stone", "iron", "arcane"] as const;

/** Amount still uncommitted: net cart cost minus what earlier incremental commits already charged. */
export function netDelta(net: NetCost, charged: NetCost): NetCost {
  const delta: NetCost = {};
  for (const r of NET_COST_RESOURCES) {
    const d = (net[r] ?? 0) - (charged[r] ?? 0);
    if (d !== 0) delta[r] = d;
  }
  return delta;
}
