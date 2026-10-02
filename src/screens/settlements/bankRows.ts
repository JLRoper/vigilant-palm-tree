import type { SettlementState } from "@heroes/contracts";
import {
  BANK_WEEKLY_INTEREST_RATE,
  BANK_WITHDRAWAL_DAYS,
  bankGoldCap,
  bankGoldOf,
  bankPendingOut,
  buildingSettlementEffects,
  settlementTreasuryCap,
} from "@heroes/engine";

// The settlement panel's Banking section, as data. Every number the panel
// renders for a bank pot goes through here so the countdown/cap arithmetic is
// unit-testable without a DOM (the settlementInfoMenu test seam pattern --
// the same one buildEntryStatus.ts and panelRects.ts use).

export interface BankPendingRow {
  gold: number;
  maturesOnDay: number;
  /** maturesOnDay - nowDay, clamped at 0. */
  daysRemaining: number;
  /** True once the countdown has run out: matured, but the treasury had no headroom, so it is still pending. */
  overdue: boolean;
}

export interface BankRowModel {
  gx: number;
  gy: number;
  level: number;
  /** Gold currently in the pot. */
  gold: number;
  /** bankGoldCap(b): 5000 * level. */
  cap: number;
  /** Room left before the pot is full; 0 when it is. */
  headroom: number;
  /** Integer 0..100. */
  capPct: number;
  /** Math.round(gold * BANK_WEEKLY_INTEREST_RATE) -- what this pot earns next week. */
  weeklyInterest: number;
  /** Pending withdrawals, each with its own countdown. */
  pending: BankPendingRow[];
  /** Sum of every pending withdrawal still in flight (gold already out of the pot). */
  pendingTotal: number;
  canDeposit: boolean;
  canWithdraw: boolean;
}

export interface BankRowsModel {
  banks: BankRowModel[];
  /** Stored gold summed across every bank, for the accordion header's right slot. */
  totalStored: number;
  totalCap: number;
  totalPending: number;
  /** Integer percent, e.g. 5. */
  weeklyInterestPct: number;
  /** BANK_WITHDRAWAL_DAYS, restated so the panel can name the delay. */
  withdrawalDays: number;
}

export interface TreasuryRowModel {
  /** treasuryBonus summed over the settlement's `treasury` buildings only. */
  treasuryBuildingBonus: number;
  /** treasuryBonus summed over every cap-building (bank + treasury + warehouse). */
  totalBonus: number;
  /** settlementTreasuryCap(settlement). */
  cap: number;
  gold: number;
  /** True when stored gold sits above the cap (soft cap: never reduced, only frozen). */
  overCap: boolean;
}

export function bankRowModel(settlement: SettlementState, nowDay: number): BankRowsModel {
  const banks: BankRowModel[] = [];
  for (const b of settlement.buildings) {
    if (b.kind !== "bank") continue;
    const cap = bankGoldCap(b);
    const gold = bankGoldOf(b);
    const pending = bankPendingOut(b).map((e) => {
      const daysRemaining = Math.max(0, e.maturesOnDay - nowDay);
      return { gold: e.gold, maturesOnDay: e.maturesOnDay, daysRemaining, overdue: daysRemaining === 0 };
    });
    banks.push({
      gx: b.gx,
      gy: b.gy,
      level: b.level,
      gold,
      cap,
      headroom: Math.max(0, cap - gold),
      capPct: cap > 0 ? Math.min(100, Math.round((gold / cap) * 100)) : 0,
      weeklyInterest: Math.round(gold * BANK_WEEKLY_INTEREST_RATE),
      pending,
      pendingTotal: pending.reduce((sum, e) => sum + e.gold, 0),
      canDeposit: gold < cap,
      canWithdraw: gold > 0,
    });
  }
  return {
    banks,
    totalStored: banks.reduce((sum, b) => sum + b.gold, 0),
    totalCap: banks.reduce((sum, b) => sum + b.cap, 0),
    totalPending: banks.reduce((sum, b) => sum + b.pendingTotal, 0),
    weeklyInterestPct: Math.round(BANK_WEEKLY_INTEREST_RATE * 100),
    withdrawalDays: BANK_WITHDRAWAL_DAYS,
  };
}

/** null when the settlement has no `treasury` building -- the row is then hidden. */
export function treasuryRowModel(settlement: SettlementState): TreasuryRowModel | null {
  let treasuryBuildingBonus = 0;
  let totalBonus = 0;
  for (const b of settlement.buildings) {
    const bonus = buildingSettlementEffects(b.kind, b.level).treasuryBonus;
    if (bonus <= 0) continue;
    totalBonus += bonus;
    if (b.kind === "treasury") treasuryBuildingBonus += bonus;
  }
  if (treasuryBuildingBonus <= 0) return null;
  const cap = settlementTreasuryCap(settlement);
  return {
    treasuryBuildingBonus,
    totalBonus,
    cap,
    gold: settlement.gold,
    overCap: settlement.gold > cap,
  };
}

export type BankGoldDirection = "deposit" | "withdraw";

/** Reducer + server reason string -> the sentence the player reads. */
export function bankRejectionMessage(direction: BankGoldDirection, reason: string): string {
  switch (reason) {
    case "no_settlement":
      return "That settlement no longer exists.";
    case "not_a_bank":
      return "That building is not a bank.";
    case "nothing_to_deposit":
    case "nothing_to_withdraw":
      return direction === "deposit" ? "Enter an amount to deposit." : "Enter an amount to withdraw.";
    case "not_enough_gold":
      return "The treasury does not hold that much gold.";
    case "pot_full":
      return "The bank's pot is full.";
    case "not_enough_in_pot":
      return "The bank's pot does not hold that much gold.";
    case "forbidden_not_your_settlement":
      return "That settlement is not yours.";
    case "forbidden_not_your_turn":
      return "It is not your turn.";
    default:
      return reason;
  }
}