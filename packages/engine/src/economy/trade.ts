import type {
  AutoTradeTransfer,
  GameState,
  PlayerId,
  SettlementId,
  SettlementState,
  TradeResult,
  Warehouse,
  WarehouseResource,
} from "@heroes/contracts";
import { buildingUpkeepRequired, clampWarehouseNonNegative, foodRequired } from "./consumption";

// computeDeficit below only ever returns non-zero for these three -- iron/
// arcane have no consumption/upkeep concept, so they can never be in
// deficit. Looping WAREHOUSE_RESOURCES' full 5-element list would be a
// guaranteed no-op for the other two on every settlement, every turn.
const AUTO_TRADE_RESOURCES: readonly WarehouseResource[] = ["food", "wood", "stone"];

export function tradeResources(
  state: GameState,
  fromSettlementId: SettlementId,
  toSettlementId: SettlementId,
  resource: WarehouseResource,
  amount: number,
): TradeResult {
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
    return { state, ok: false, reason: "invalid_amount" };
  }
  const from = state.settlements[fromSettlementId];
  const to = state.settlements[toSettlementId];
  if (!from) return { state, ok: false, reason: "no_from_settlement" };
  if (!to) return { state, ok: false, reason: "no_to_settlement" };
  if (from.ownerId === null || to.ownerId === null) {
    return { state, ok: false, reason: "unowned_settlement" };
  }
  if (from.ownerId !== to.ownerId) {
    return { state, ok: false, reason: "different_owners" };
  }
  if (from.warehouse[resource] < amount) {
    return { state, ok: false, reason: "insufficient_resource" };
  }
  if (from.gold < amount) {
    return { state, ok: false, reason: "insufficient_gold" };
  }
  const newFromWarehouse: Warehouse = { ...from.warehouse, [resource]: from.warehouse[resource] - amount };
  const newToWarehouse: Warehouse = { ...to.warehouse, [resource]: to.warehouse[resource] + amount };
  return {
    state: {
      ...state,
      settlements: {
        ...state.settlements,
        [fromSettlementId]: { ...from, gold: from.gold - amount, warehouse: newFromWarehouse },
        [toSettlementId]: { ...to, warehouse: newToWarehouse },
      },
      dirty: true,
    },
    ok: true,
    reason: "",
  };
}

export function runAutoTrade(
  settlements: Record<SettlementId, SettlementState>,
  playerId: PlayerId,
): { settlements: Record<SettlementId, SettlementState>; transfers: AutoTradeTransfer[] } {
  const next: Record<SettlementId, SettlementState> = { ...settlements };
  const transfers: AutoTradeTransfer[] = [];
  const resources = AUTO_TRADE_RESOURCES;
  for (const s of Object.values(next)) {
    if (s.ownerId !== playerId || !s.autoTrade) continue;
    const updatedS: SettlementState = { ...next[s.id] };
    for (const r of resources) {
      const deficit = computeDeficit(updatedS, r);
      if (deficit <= 0) continue;
      const sources = Object.values(next).filter(
        (other) => other.id !== s.id && other.ownerId === playerId && (other.warehouse[r] ?? 0) > 0 && (other.gold ?? 0) > 0,
      );
      let remaining = deficit;
      for (const src of sources) {
        if (remaining <= 0) break;
        const sourceUpd: SettlementState = { ...next[src.id] };
        const transferable = Math.max(0, Math.min(sourceUpd.warehouse[r] ?? 0, sourceUpd.gold ?? 0, remaining));
        if (transferable <= 0) continue;
        sourceUpd.warehouse = { ...sourceUpd.warehouse, [r]: clampWarehouseNonNegative((sourceUpd.warehouse[r] ?? 0) - transferable) };
        sourceUpd.gold = sourceUpd.gold - transferable;
        updatedS.warehouse = { ...updatedS.warehouse, [r]: (updatedS.warehouse[r] ?? 0) + transferable };
        next[src.id] = sourceUpd;
        remaining -= transferable;
        transfers.push({
          fromSettlementId: src.id,
          toSettlementId: s.id,
          resource: r,
          amount: transferable,
          goldPaid: transferable,
        });
      }
    }
    next[s.id] = updatedS;
  }
  return { settlements: next, transfers };
}

function computeDeficit(s: SettlementState, r: WarehouseResource): number {
  if (r === "food") {
    return Math.max(0, foodRequired(s) - (s.warehouse.food ?? 0));
  }
  if (r === "wood") {
    return Math.max(0, buildingUpkeepRequired(s).wood - (s.warehouse.wood ?? 0));
  }
  if (r === "stone") {
    return Math.max(0, buildingUpkeepRequired(s).stone - (s.warehouse.stone ?? 0));
  }
  return 0;
}
