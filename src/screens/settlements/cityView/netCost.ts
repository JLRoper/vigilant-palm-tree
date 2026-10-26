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

// ─── the cart's charge readout ────────────────────────────────────────
//
// The palette's "Cart:" line is a CHARGE readout, so its sign has to follow
// the treasury, not the cart's internal accounting: `NetCost` counts a
// placement as a positive figure (it consumes resources), but a player
// reading "+150g" next to a green tint sees income. Every figure is therefore
// printed as the settlement's balance will move -- a cost is negative, a
// refund (destroy) is positive.
//
// Colour carries the same meaning: only a credit is green, because green is
// what made a cost read as income. A cost uses the codebase's established
// warning amber (see treasuryCap.ts's TREASURY_CAP_AMBER), and the one thing
// that legitimately wears red is a charge the treasury cannot cover.

/** How a cart charge reads: a cost, a cost the treasury cannot cover, or a credit. */
export type CartTone = "cost" | "over" | "credit";

/** The colour each tone is painted with (kept here so the tone and its hue cannot drift apart). */
export const CART_TONE_COLORS: Record<CartTone, string> = {
  cost: "#ffb300",
  over: "#f88",
  credit: "#8f8",
};

export interface CartCharge {
  /** The whole line, e.g. `Cart: -150g -5w` (spent) or `Cart: +75g` (refunded). */
  text: string;
  tone: CartTone;
}

function cartFigure(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(Math.abs(rounded));
}

/**
 * The palette's cart line for the charge `net` still owes, or null when
 * nothing is owed (the cart has settled). `affordable` is the caller's
 * affordability gate for that same charge -- it only softens the colour, never
 * the number.
 */
export function formatCartCharge(net: NetCost, affordable = true): CartCharge | null {
  const parts: string[] = [];
  let spends = false;
  for (const r of NET_COST_RESOURCES) {
    const v = net[r] ?? 0;
    if (v === 0) continue;
    const suffix = r === "gold" ? "g" : r[0];
    if (v > 0) {
      spends = true;
      parts.push(`-${cartFigure(v)}${suffix}`);
    } else {
      parts.push(`+${cartFigure(v)}${suffix}`);
    }
  }
  if (parts.length === 0) return null;
  return {
    text: `Cart: ${parts.join(" ")}`,
    tone: !spends ? "credit" : affordable ? "cost" : "over",
  };
}
