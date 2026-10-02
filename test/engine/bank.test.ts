import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, GameState, SettlementId } from "@heroes/contracts";
import {
  BANK_WEEKLY_INTEREST_RATE,
  BANK_WITHDRAWAL_DAYS,
  accrueBankInterest,
  bankGoldCap,
  bankGoldOf,
  bankPendingOut,
  depositIntoBank,
  matureBankWithdrawals,
  requestBankWithdrawal,
  settlementTreasuryCap,
} from "@heroes/engine";
import { makeSettlement, makeState } from "../charter/_helpers";

function bank(gx: number, gy: number, level = 1, pot?: { gold: number; pendingOut: { gold: number; maturesOnDay: number }[] }): BuildingDef {
  return { gx, gy, kind: "bank", level, style: "classic", ...(pot ? { bank: pot } : {}) };
}

function stateWith(buildings: BuildingDef[], gold = 0, day = 10): GameState {
  return makeState({
    day,
    settlements: [
      makeSettlement("s0", 0, 2, 2, { gold, buildings }),
      makeSettlement("s1", 1, 18, 4),
    ],
  });
}

function potGold(state: GameState, gx: number, gy: number): number {
  const b = state.settlements.s0.buildings.find((x) => x.gx === gx && x.gy === gy);
  assert.ok(b, "building present");
  return bankGoldOf(b);
}

test("bankGoldCap scales 5000 per level", () => {
  assert.equal(bankGoldCap(bank(0, 0, 1)), 5000);
  assert.equal(bankGoldCap(bank(0, 0, 2)), 10000);
  assert.equal(bankGoldCap(bank(0, 0, 3)), 15000);
});

test("bankGoldOf/bankPendingOut treat an absent pot as empty", () => {
  assert.equal(bankGoldOf(bank(0, 0)), 0);
  assert.deepEqual(bankPendingOut(bank(0, 0)), []);
});

test("depositIntoBank moves gold from the treasury into the pot", () => {
  const next = depositIntoBank(stateWith([bank(2, 2)], 1000), "s0", 2, 2, 400);
  assert.equal(next.ok, true);
  assert.equal(next.reason, "");
  assert.equal(next.state.settlements.s0.gold, 600);
  assert.equal(potGold(next.state, 2, 2), 400);
});

test("depositIntoBank is rejected when the treasury cannot cover it", () => {
  const next = depositIntoBank(stateWith([bank(2, 2)], 100), "s0", 2, 2, 400);
  assert.equal(next.ok, false);
  assert.equal(next.reason, "not_enough_gold");
});

test("depositIntoBank rejects a deposit that would exceed the pot cap", () => {
  const s = stateWith([bank(2, 2, 1, { gold: 4800, pendingOut: [] })], 1000);
  const next = depositIntoBank(s, "s0", 2, 2, 201);
  assert.equal(next.ok, false);
  assert.equal(next.reason, "pot_full");
});

test("depositIntoBank accepts a deposit exactly up to the cap", () => {
  const s = stateWith([bank(2, 2, 1, { gold: 4800, pendingOut: [] })], 1000);
  const next = depositIntoBank(s, "s0", 2, 2, 200);
  assert.equal(next.ok, true);
  assert.equal(potGold(next.state, 2, 2), 5000);
});

test("depositIntoBank rejects a zero/negative/fractional amount", () => {
  const s = stateWith([bank(2, 2)], 1000);
  for (const amount of [0, -5, 12.5, Number.NaN]) {
    const next = depositIntoBank(s, "s0", 2, 2, amount);
    assert.equal(next.ok, false, `amount ${amount}`);
    assert.equal(next.reason, "nothing_to_deposit");
  }
});

test("depositIntoBank rejects a non-bank building and a missing settlement", () => {
  const s = stateWith([{ gx: 2, gy: 2, kind: "house", level: 1, style: "classic" }], 1000);
  const notBank = depositIntoBank(s, "s0", 2, 2, 100);
  assert.equal(notBank.ok, false);
  assert.equal(notBank.reason, "not_a_bank");
  const emptyCell = depositIntoBank(s, "s0", 4, 4, 100);
  assert.equal(emptyCell.ok, false);
  assert.equal(emptyCell.reason, "not_a_bank");
  const noSettlement = depositIntoBank(s, "nope" as SettlementId, 2, 2, 100);
  assert.equal(noSettlement.ok, false);
  assert.equal(noSettlement.reason, "no_settlement");
});

test("requestBankWithdrawal takes the gold out of the pot immediately and starts a 7-day countdown", () => {
  const s = stateWith([bank(2, 2, 1, { gold: 1000, pendingOut: [] })], 0, 10);
  const next = requestBankWithdrawal(s, "s0", 2, 2, 300);
  assert.equal(next.ok, true);
  assert.equal(potGold(next.state, 2, 2), 700, "money leaves the pot at once");
  assert.equal(next.state.settlements.s0.gold, 0, "and is NOT yet spendable");
  const b = next.state.settlements.s0.buildings[0];
  assert.deepEqual(bankPendingOut(b), [{ gold: 300, maturesOnDay: 10 + BANK_WITHDRAWAL_DAYS }]);
});

test("requestBankWithdrawal rejects more than the pot holds, so pending can't be spent twice", () => {
  const s = stateWith([bank(2, 2, 1, { gold: 100, pendingOut: [{ gold: 400, maturesOnDay: 30 }] })], 0, 10);
  const tooMuch = requestBankWithdrawal(s, "s0", 2, 2, 101);
  assert.equal(tooMuch.ok, false);
  assert.equal(tooMuch.reason, "not_enough_in_pot");
  const empty = requestBankWithdrawal(
    stateWith([bank(2, 2, 1, { gold: 0, pendingOut: [{ gold: 400, maturesOnDay: 30 }] })]),
    "s0", 2, 2, 1,
  );
  assert.equal(empty.ok, false, "pending gold is already out of the pot");
});

test("matureBankWithdrawals does nothing before the maturity day", () => {
  const s = stateWith([bank(2, 2, 1, { gold: 0, pendingOut: [{ gold: 300, maturesOnDay: 17 }] })], 0, 16);
  const next = matureBankWithdrawals(s);
  assert.equal(next, s, "no-op returns the SAME state object");
  assert.equal(next.settlements.s0.gold, 0);
});

test("matureBankWithdrawals pays out on the maturity day", () => {
  const s = stateWith([bank(2, 2, 1, { gold: 0, pendingOut: [{ gold: 300, maturesOnDay: 17 }] })], 100, 17);
  const next = matureBankWithdrawals(s);
  assert.equal(next.settlements.s0.gold, 400);
  assert.deepEqual(bankPendingOut(next.settlements.s0.buildings[0]), []);
});

test("matureBankWithdrawals keeps a treasury-capped remainder pending instead of destroying it", () => {
  // The bank's own registry effect (treasuryBonus 2000) is part of the cap, so
  // read the cap off the settlement that actually carries the bank.
  const withBank = stateWith([bank(2, 2, 1, { gold: 0, pendingOut: [{ gold: 9999, maturesOnDay: 17 }] })], 0, 17);
  const cap = settlementTreasuryCap(withBank.settlements.s0);
  assert.equal(cap, 1500 + 2000);
  const s = { ...withBank, settlements: { ...withBank.settlements, s0: { ...withBank.settlements.s0, gold: cap - 500 } } };
  const next = matureBankWithdrawals(s);
  assert.equal(next.settlements.s0.gold, cap, "capped at the treasury cap");
  assert.deepEqual(
    bankPendingOut(next.settlements.s0.buildings[0]),
    [{ gold: 9999 - 500, maturesOnDay: 17 }],
    "the remainder stays pending for a later day",
  );
  // Once the treasury drains, the held-back remainder lands -- up to the cap,
  // with the still-unaffordable tail held back again (soft caps never destroy).
  const drained = { ...next, settlements: { ...next.settlements, s0: { ...next.settlements.s0, gold: 0 } } };
  const later = matureBankWithdrawals(drained);
  assert.equal(later.settlements.s0.gold, cap);
  assert.deepEqual(bankPendingOut(later.settlements.s0.buildings[0]), [
    { gold: 9499 - cap, maturesOnDay: 17 },
  ]);
});

test("accrueBankInterest pays a flat 5% weekly, clamped to the pot cap", () => {
  const s = stateWith([bank(2, 2, 1, { gold: 1000, pendingOut: [] })], 0);
  const next = accrueBankInterest(s);
  assert.equal(potGold(next, 2, 2), 1050);
  assert.equal(BANK_WEEKLY_INTEREST_RATE, 0.05);

  const nearCap = stateWith([bank(2, 2, 1, { gold: 4990, pendingOut: [] })], 0);
  assert.equal(potGold(accrueBankInterest(nearCap), 2, 2), 5000, "clamped to the level-1 cap");
});

test("accrueBankInterest is a no-op on an empty pot", () => {
  const s = stateWith([bank(2, 2, 1, { gold: 0, pendingOut: [{ gold: 10, maturesOnDay: 99 }] })], 0);
  const next = accrueBankInterest(s);
  assert.equal(next, s, "no-op returns the SAME state object");
});

test("unlimited banks in one settlement accrue independently", () => {
  const s = stateWith(
    [
      bank(0, 0, 1, { gold: 1000, pendingOut: [] }),
      bank(1, 1, 3, { gold: 2000, pendingOut: [] }),
      bank(2, 2, 2, { gold: 500, pendingOut: [] }),
    ],
    0,
  );
  const next = accrueBankInterest(s);
  assert.equal(potGold(next, 0, 0), 1050);
  assert.equal(potGold(next, 1, 1), 2100);
  assert.equal(potGold(next, 2, 2), 525);
});

test("deposits and withdrawals never lose value across a full cycle", () => {
  const start = 2000;
  let s = stateWith([bank(2, 2, 1, { gold: 0, pendingOut: [] })], start, 10);
  s = depositIntoBank(s, "s0", 2, 2, 1200).state;
  assert.equal(s.settlements.s0.gold + potGold(s, 2, 2), start);
  s = requestBankWithdrawal(s, "s0", 2, 2, 500).state;
  assert.equal(s.settlements.s0.gold + potGold(s, 2, 2) + bankPendingOut(s.settlements.s0.buildings[0])[0].gold, start);
  s = matureBankWithdrawals({ ...s, day: 17 });
  assert.equal(s.settlements.s0.gold + potGold(s, 2, 2), start);
});