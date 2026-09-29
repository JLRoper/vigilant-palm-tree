import type { SettlementId } from "@heroes/contracts";
import type { NetCost } from "../screens/settlements/cityView/netCost";

const NET_COST_KEYS = ["gold", "wood", "stone", "iron", "arcane"] as const;

const pending: Map<SettlementId, NetCost[]> = new Map();

export function recordBuildCommit(settlementId: SettlementId, delta: NetCost): void {
  const copy: NetCost = {};
  for (const r of NET_COST_KEYS) {
    const v = delta[r] ?? 0;
    if (v !== 0) copy[r] = v;
  }
  if (Object.keys(copy).length === 0) return;
  const queue = pending.get(settlementId) ?? [];
  queue.push(copy);
  pending.set(settlementId, queue);
}

export function pendingBuildCommitCount(settlementId: SettlementId): number {
  return pending.get(settlementId)?.length ?? 0;
}

export function takeLastAppliedBuildDelta(settlementId: SettlementId): NetCost | undefined {
  const queue = pending.get(settlementId);
  if (!queue || queue.length === 0) return undefined;
  if (queue.length > 1) {
    pending.delete(settlementId);
    return undefined;
  }
  const delta = queue.shift();
  pending.delete(settlementId);
  return delta;
}
