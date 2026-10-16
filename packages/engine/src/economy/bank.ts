import type { BuildingDef, GameState, SettlementId, SettlementState } from "@heroes/contracts";
import { settlementTreasuryCap, treasuryHeadroom } from "../settlement/capacity";

// A bank's OWN gold pot (designer's spec: own pot, 7-day withdrawal delay,
// weekly interest, unlimited banks). Three rules make it a pot and not a
// second treasury: the pot has its own level-scaled capacity, a
// withdrawal is a 7-day countdown (money leaves the pot at once but is not
// spendable until it matures), and it earns a flat weekly rate.
//
// Where the money lands: the pot is the kingdom's money, so matured
// withdrawals and weekly interest both ADD to the settlement treasury, gated
// by exactly the same soft cap gate the rest of the economy uses
// (applyEffectiveIncome's `s.gold + Math.min(inc, headroom)` idiom in
// economy/consumption.ts). Nothing is ever destroyed by a cap: whatever does
// not fit stays in the pot / pendingOut and lands on a later tick, the same
// way advanceTradeRoutes leaves undeliverable cargo on the caravan.
//
// Copy-on-write + a `changed` flag, early-returning the SAME state object when
// nothing changed: that keeps commandHandler's dualWriteEntities
// reference-equality diff honest (a fresh settlements object would trigger a
// pointless full-sync upsertMany on every turn of every game).

/** Days between requesting a withdrawal and it becoming spendable. */
export const BANK_WITHDRAWAL_DAYS = 7;

/**
 * Flat weekly rate on the pot. Deliberately NOT level-scaled: capacity
 * scales by level instead (bankGoldCap), so a level-3 bank is a bigger vault
 * rather than a gold printer.
 */
export const BANK_WEEKLY_INTEREST_RATE = 0.05;

const BANK_GOLD_CAP_PER_LEVEL = 5000;

export function bankGoldCap(building: BuildingDef): number {
  return BANK_GOLD_CAP_PER_LEVEL * building.level;
}

export function bankGoldOf(building: BuildingDef): number {
  return building.bank?.gold ?? 0;
}

/** Pending withdrawals not yet spendable (they already left the pot). */
export function bankPendingOut(building: BuildingDef): { gold: number; maturesOnDay: number }[] {
  return building.bank?.pendingOut ?? [];
}

export interface BankGoldResult {
  ok: boolean;
  state: GameState;
  reason: string;
}

function withBuilding(
  state: GameState,
  settlementId: SettlementId,
  settlement: SettlementState,
  buildings: BuildingDef[],
): GameState {
  return {
    ...state,
    settlements: {
      ...state.settlements,
      [settlementId]: { ...settlement, buildings },
    },
    dirty: true,
  };
}

function replaceBuilding(
  settlement: SettlementState,
  gx: number,
  gy: number,
  bank: NonNullable<BuildingDef["bank"]>,
): BuildingDef[] {
  return settlement.buildings.map((b) =>
    b.gx === gx && b.gy === gy ? { ...b, bank } : b,
  );
}

/** Resolves the target bank building, or the reason it isn't one. */
function findBank(
  state: GameState,
  settlementId: SettlementId,
  gx: number,
  gy: number,
): { settlement: SettlementState; building: BuildingDef } | { reason: string } {
  const settlement = state.settlements[settlementId];
  if (!settlement) return { reason: "no_settlement" };
  const building = settlement.buildings.find((b) => b.gx === gx && b.gy === gy);
  if (!building || building.kind !== "bank") return { reason: "not_a_bank" };
  return { settlement, building };
}

/** Moves gold from the settlement treasury into a bank's pot. */
export function depositIntoBank(
  state: GameState,
  settlementId: SettlementId,
  gx: number,
  gy: number,
  amount: number,
): BankGoldResult {
  const found = findBank(state, settlementId, gx, gy);
  if ("reason" in found) return { ok: false, state, reason: found.reason };
  const { settlement, building } = found;
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, state, reason: "nothing_to_deposit" };
  if (settlement.gold < amount) return { ok: false, state, reason: "not_enough_gold" };

  const pot = bankGoldOf(building);
  const cap = bankGoldCap(building);
  if (pot + amount > cap) return { ok: false, state, reason: "pot_full" };

  const bank = {
    gold: pot + amount,
    pendingOut: [...bankPendingOut(building)],
  };
  return {
    ok: true,
    state: withBuilding(
      state,
      settlementId,
      { ...settlement, gold: settlement.gold - amount },
      replaceBuilding(settlement, gx, gy, bank),
    ),
    reason: "",
  };
}

/**
 * Moves gold OUT of the pot into `pendingOut`: the money leaves the pot
 * immediately (so it can never be spent twice) but is not spendable until
 * `state.day + BANK_WITHDRAWAL_DAYS`. Amount is bounded by the pot's current
 * gold only — pending withdrawals are already out of the pot and therefore
 * not counted.
 */
export function requestBankWithdrawal(
  state: GameState,
  settlementId: SettlementId,
  gx: number,
  gy: number,
  amount: number,
): BankGoldResult {
  const found = findBank(state, settlementId, gx, gy);
  if ("reason" in found) return { ok: false, state, reason: found.reason };
  const { settlement, building } = found;
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, state, reason: "nothing_to_withdraw" };
  const pot = bankGoldOf(building);
  if (amount > pot) return { ok: false, state, reason: "not_enough_in_pot" };

  const bank = {
    gold: pot - amount,
    pendingOut: [
      ...bankPendingOut(building),
      { gold: amount, maturesOnDay: state.day + BANK_WITHDRAWAL_DAYS },
    ],
  };
  return {
    ok: true,
    state: withBuilding(
      state,
      settlementId,
      settlement,
      replaceBuilding(settlement, gx, gy, bank),
    ),
    reason: "",
  };
}

/**
 * DAILY tick: every matured pendingOut entry moves into the settlement
 * treasury, clamped to treasury headroom. The overflow is pushed BACK into
 * pendingOut (same maturity day) rather than destroyed, so a full treasury
 * delays the payout instead of eating it — the soft-cap rule capacity.ts
 * documents ("stock above cap is never destroyed, it just can't grow").
 *
 * `state.day` is read as-is, so callers must run this AFTER the day's
 * increment (advanceRound does).
 */
export function matureBankWithdrawals(state: GameState): GameState {
  const next: Record<SettlementId, SettlementState> = { ...state.settlements };
  let changed = false;
  for (const [id, s] of Object.entries(next)) {
    if (!s.buildings.some((b) => b.bank && b.bank.pendingOut.length > 0)) continue;
    let gold = s.gold;
    let headroom = treasuryHeadroom(gold, settlementTreasuryCap(s));
    let maturedAny = false;
    const buildings = s.buildings.map((b) => {
      if (!b.bank || b.bank.pendingOut.length === 0) return b;
      let matured = 0;
      const stillPending: { gold: number; maturesOnDay: number }[] = [];
      for (const entry of b.bank.pendingOut) {
        if (entry.maturesOnDay > state.day) {
          stillPending.push(entry);
          continue;
        }
        matured += entry.gold;
      }
      if (matured === 0) return b;
      maturedAny = true;
      const paid = Math.min(matured, headroom);
      headroom -= paid;
      gold += paid;
      const unpaid = matured - paid;
      if (unpaid > 0) stillPending.push({ gold: unpaid, maturesOnDay: state.day });
      return { ...b, bank: { gold: b.bank.gold, pendingOut: stillPending } };
    });
    if (!maturedAny) continue;
    changed = true;
    next[id] = { ...s, gold, buildings };
  }
  if (!changed) return state;
  return { ...state, settlements: next, dirty: true };
}

/**
 * WEEKLY tick: every bank holding gold earns a flat
 * BANK_WEEKLY_INTEREST_RATE, rounded, clamped to the pot's cap. A pot at 0 is
 * skipped (a no-op bank must not rewrite its BuildingDef).
 */
export function accrueBankInterest(state: GameState): GameState {
  const next: Record<SettlementId, SettlementState> = { ...state.settlements };
  let changed = false;
  for (const [id, s] of Object.entries(next)) {
    if (!s.buildings.some((b) => b.bank && b.bank.gold > 0)) continue;
    let touched = false;
    const buildings = s.buildings.map((b) => {
      if (!b.bank || b.bank.gold <= 0) return b;
      const cap = bankGoldCap(b);
      const grown = Math.min(cap, b.bank.gold + Math.round(b.bank.gold * BANK_WEEKLY_INTEREST_RATE));
      if (grown === b.bank.gold) return b;
      touched = true;
      return { ...b, bank: { gold: grown, pendingOut: [...b.bank.pendingOut] } };
    });
    if (touched) {
      changed = true;
      next[id] = { ...s, buildings };
    }
  }
  if (!changed) return state;
  return { ...state, settlements: next, dirty: true };
}