import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuildingDef, SettlementState } from "@heroes/contracts";
import {
  bankRejectionMessage,
  bankRowModel,
  treasuryRowModel,
  type BankGoldDirection,
} from "../../../src/screens/settlements/bankRows";
import { makeSettlement } from "../../charter/_helpers";

// The settlement panel's Banking section as data. DOM-free on purpose: the
// countdown, the cap progress and the interest figure are the parts that can
// be silently wrong (a negative countdown reads like a bug; a stale pot reads
// like the pot is empty), and they are all decided here.

function bank(gx: number, gy: number, level: number, pot?: BuildingDef["bank"]): BuildingDef {
  return { gx, gy, kind: "bank", level, style: "classic", ...(pot ? { bank: pot } : {}) };
}

function settlement(buildings: BuildingDef[], gold = 1000, level: 1 | 2 | 3 = 1): SettlementState {
  return makeSettlement("s0", 0, 2, 2, { gold, level, buildings });
}

test("a settlement with no bank reports an empty Banking section", () => {
  const model = bankRowModel(settlement([{ gx: 0, gy: 0, kind: "house", level: 1, style: "classic" }]), 10);
  assert.deepEqual(model.banks, []);
  assert.equal(model.totalStored, 0);
  assert.equal(model.totalCap, 0);
  assert.equal(model.weeklyInterestPct, 5);
  assert.equal(model.withdrawalDays, 7);
});

test("a pot with no `bank` key reads as empty rather than crashing", () => {
  const model = bankRowModel(settlement([bank(1, 1, 1)]), 10);
  assert.equal(model.banks.length, 1);
  assert.equal(model.banks[0].gold, 0);
  assert.equal(model.banks[0].cap, 5000);
  assert.equal(model.banks[0].canDeposit, true);
  assert.equal(model.banks[0].canWithdraw, false);
  assert.deepEqual(model.banks[0].pending, []);
});

test("cap scales 5000 per level and drives the headroom and percentage", () => {
  const model = bankRowModel(settlement([bank(1, 1, 3, { gold: 7500, pendingOut: [] })]), 10);
  const b = model.banks[0];
  assert.equal(b.cap, 15000);
  assert.equal(b.headroom, 7500);
  assert.equal(b.capPct, 50);
  assert.equal(b.canDeposit, true);
  assert.equal(model.totalStored, 7500);
  assert.equal(model.totalCap, 15000);
});

test("a full pot reports zero headroom, 100% and cannot take a deposit", () => {
  const model = bankRowModel(settlement([bank(1, 1, 1, { gold: 5000, pendingOut: [] })]), 10);
  const b = model.banks[0];
  assert.equal(b.headroom, 0);
  assert.equal(b.capPct, 100);
  assert.equal(b.canDeposit, false);
  assert.equal(b.canWithdraw, true);
});

test("interest is 5% of the pot, rounded, matching the weekly tick", () => {
  const model = bankRowModel(settlement([bank(1, 1, 1, { gold: 333, pendingOut: [] })]), 10);
  assert.equal(model.banks[0].weeklyInterest, 17);
  const empty = bankRowModel(settlement([bank(1, 1, 1, { gold: 3, pendingOut: [] })]), 10);
  assert.equal(empty.banks[0].weeklyInterest, 0);
});

test("each pending withdrawal counts down from its own maturity day", () => {
  const model = bankRowModel(
    settlement([bank(1, 1, 1, { gold: 0, pendingOut: [{ gold: 100, maturesOnDay: 20 }, { gold: 50, maturesOnDay: 8 }] })]),
    11,
  );
  const b = model.banks[0];
  assert.deepEqual(b.pending, [
    { gold: 100, maturesOnDay: 20, daysRemaining: 9, overdue: false },
    { gold: 50, maturesOnDay: 8, daysRemaining: 0, overdue: true },
  ]);
  assert.equal(b.pendingTotal, 150);
  assert.equal(model.totalPending, 150);
});

test("a countdown that has passed clamps at 0 and never reads negative", () => {
  // matureBankWithdrawals re-pushes an unpaid remainder at state.day, so a
  // pending entry is normally exactly 0 -- but a stale day must not underflow.
  const model = bankRowModel(
    settlement([bank(1, 1, 1, { gold: 0, pendingOut: [{ gold: 100, maturesOnDay: 5 }] })]),
    99,
  );
  const [entry] = model.banks[0].pending;
  assert.equal(entry.daysRemaining, 0);
  assert.equal(entry.overdue, true);
});

test("an empty pot makes the countdown irrelevant and keeps the pot spendable-free", () => {
  const model = bankRowModel(settlement([bank(1, 1, 2, { gold: 0, pendingOut: [] })]), 3);
  assert.equal(model.banks[0].canWithdraw, false);
  assert.equal(model.banks[0].pendingTotal, 0);
});

test("multiple banks are reported independently and summed for the header", () => {
  const model = bankRowModel(
    settlement([
      bank(1, 1, 1, { gold: 1000, pendingOut: [{ gold: 200, maturesOnDay: 12 }] }),
      bank(3, 3, 2, { gold: 4000, pendingOut: [] }),
    ]),
    5,
  );
  assert.equal(model.banks.length, 2);
  assert.equal(model.totalStored, 5000);
  assert.equal(model.totalCap, 5000 + 10000);
  assert.equal(model.totalPending, 200);
  assert.deepEqual(model.banks.map((b) => [b.gx, b.gy, b.level]), [
    [1, 1, 1],
    [3, 3, 2],
  ]);
});

test("non-bank buildings never appear in the Banking section", () => {
  const model = bankRowModel(
    settlement([
      { gx: 0, gy: 0, kind: "treasury", level: 1, style: "classic" },
      { gx: 0, gy: 2, kind: "warehouse", level: 1, style: "classic" },
    ]),
    5,
  );
  assert.deepEqual(model.banks, []);
});

test("the treasury row is absent unless a treasury building exists", () => {
  assert.equal(treasuryRowModel(settlement([bank(1, 1, 1)])), null);
  assert.equal(
    treasuryRowModel(settlement([{ gx: 0, gy: 0, kind: "warehouse", level: 1, style: "classic" }])),
    null,
  );
});

test("the treasury row states its own contribution and the settlement's cap", () => {
  const model = treasuryRowModel(
    settlement(
      [
        { gx: 0, gy: 0, kind: "treasury", level: 1, style: "classic" },
        { gx: 0, gy: 2, kind: "bank", level: 1, style: "classic" },
        { gx: 2, gy: 2, kind: "warehouse", level: 1, style: "classic" },
      ],
      2500,
    ),
  );
  assert.ok(model);
  // 1500 base + 2000 treasury + 2000 bank + 500 warehouse = 6000.
  assert.equal(model.treasuryBuildingBonus, 2000);
  assert.equal(model.totalBonus, 4500);
  assert.equal(model.cap, 6000);
  assert.equal(model.gold, 2500);
  assert.equal(model.overCap, false);
});

test("the treasury row flags gold sitting above the soft cap", () => {
  const model = treasuryRowModel(
    settlement([{ gx: 0, gy: 0, kind: "treasury", level: 1, style: "classic" }], 99_999),
  );
  assert.ok(model);
  assert.equal(model.cap, 3500);
  assert.equal(model.overCap, true);
});

test("every reducer/server reason maps to a sentence the player can act on", () => {
  const expected: Array<[BankGoldDirection, string, string]> = [
    ["deposit", "no_settlement", "That settlement no longer exists."],
    ["deposit", "not_a_bank", "That building is not a bank."],
    ["deposit", "nothing_to_deposit", "Enter an amount to deposit."],
    ["deposit", "not_enough_gold", "The treasury does not hold that much gold."],
    ["deposit", "pot_full", "The bank's pot is full."],
    ["withdraw", "nothing_to_withdraw", "Enter an amount to withdraw."],
    ["withdraw", "not_enough_in_pot", "The bank's pot does not hold that much gold."],
    ["withdraw", "forbidden_not_your_settlement", "That settlement is not yours."],
    ["withdraw", "forbidden_not_your_turn", "It is not your turn."],
  ];
  for (const [direction, reason, message] of expected) {
    assert.equal(bankRejectionMessage(direction, reason), message);
  }
});

test("an unmapped reason is shown verbatim instead of being swallowed", () => {
  assert.equal(bankRejectionMessage("deposit", "some_new_server_reason"), "some_new_server_reason");
});

test("nothing_to_deposit / nothing_to_withdraw follow the direction the player chose", () => {
  assert.equal(bankRejectionMessage("withdraw", "nothing_to_deposit"), "Enter an amount to withdraw.");
  assert.equal(bankRejectionMessage("deposit", "nothing_to_withdraw"), "Enter an amount to deposit.");
});