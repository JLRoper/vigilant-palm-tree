import type { GameState, SettlementState } from "../../../state/gameState";
import type { ResourceType } from "../../../map/resourceTiles";

export type NetCost = Partial<Record<ResourceType, number>>;

const NET_COST_RESOURCES = ["gold", "wood", "stone", "iron", "arcane"] as const;

export interface TreasuryStock {
  gold: number;
  wood: number;
  stone: number;
  iron: number;
  arcane: number;
}

export interface SettledNet {
  ok: boolean;
  gold: number;
  wood: number;
  stone: number;
  iron: number;
  arcane: number;
}

/** Amount still uncommitted: net cart cost minus what earlier incremental commits already charged. */
export function netDelta(net: NetCost, charged: NetCost): NetCost {
  const delta: NetCost = {};
  for (const r of NET_COST_RESOURCES) {
    const d = (net[r] ?? 0) - (charged[r] ?? 0);
    if (d !== 0) delta[r] = d;
  }
  return delta;
}

export function invertNet(delta: NetCost): NetCost {
  const inverse: NetCost = {};
  for (const r of NET_COST_RESOURCES) {
    const v = delta[r] ?? 0;
    if (v !== 0) inverse[r] = -v;
  }
  return inverse;
}

/** Apply a signed net to a stock. Gold below zero makes the whole write invalid (ok: false); warehouse resources clamp at 0. */
export function settleNet(stock: TreasuryStock, net: NetCost): SettledNet {
  const gold = stock.gold - (net.gold ?? 0);
  return {
    ok: gold >= 0,
    gold,
    wood: Math.max(0, stock.wood - (net.wood ?? 0)),
    stone: Math.max(0, stock.stone - (net.stone ?? 0)),
    iron: Math.max(0, stock.iron - (net.iron ?? 0)),
    arcane: Math.max(0, stock.arcane - (net.arcane ?? 0)),
  };
}

export function advanceChargedOnCommit(commitOk: boolean, net: NetCost, charged: NetCost): NetCost {
  return commitOk ? { ...net } : { ...charged };
}

export function applyNetToSettlement(state: GameState, settlementId: string, net: NetCost): GameState | null {
  const s: SettlementState | undefined = state.settlements[settlementId];
  if (!s) return null;
  const settled = settleNet(
    {
      gold: s.gold,
      wood: s.warehouse.wood ?? 0,
      stone: s.warehouse.stone ?? 0,
      iron: s.warehouse.iron ?? 0,
      arcane: s.warehouse.arcane ?? 0,
    },
    net,
  );
  if (!settled.ok) return null;
  const updated: SettlementState = {
    ...s,
    gold: settled.gold,
    warehouse: {
      ...s.warehouse,
      wood: settled.wood,
      stone: settled.stone,
      iron: settled.iron,
      arcane: settled.arcane,
      food: s.warehouse.food ?? 0,
    },
  };
  return { ...state, settlements: { ...state.settlements, [settlementId]: updated }, dirty: true };
}
