import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advanceChargedOnCommit,
  applyNetToSettlement,
  invertNet,
  netDelta,
  settleNet,
} from "../../../src/screens/settlements/cityView/netCost";
import { emptyWarehouse, makeSettlement, makeState } from "../../charter/_helpers";
import {
  pendingBuildCommitCount,
  recordBuildCommit,
  takeLastAppliedBuildDelta,
} from "../../../src/game/buildCommitLedger";

test("empty carts yield an empty delta", () => {
  assert.deepEqual(netDelta({}, {}), {});
});

test("full net cost is reported when nothing has been charged yet", () => {
  assert.deepEqual(netDelta({ gold: -100, wood: -2 }, {}), { gold: -100, wood: -2 });
});

test("already-charged amounts are subtracted from the net", () => {
  assert.deepEqual(netDelta({ gold: -100, wood: -2 }, { gold: -40 }), { gold: -60, wood: -2 });
});

test("fully committed deltas come out empty", () => {
  const net = { gold: -100, wood: -2, stone: 5 };
  assert.deepEqual(netDelta(net, { ...net }), {});
});

test("refunds (positive entries) participate like costs", () => {
  assert.deepEqual(netDelta({ gold: 10 }, { gold: 4 }), { gold: 6 });
});

test("resources outside the tracked set are ignored", () => {
  assert.deepEqual(netDelta({ food: -5 } as never, {}), {});
});

test("equal offsetting entries collapse to empty", () => {
  assert.deepEqual(netDelta({ gold: -50, wood: 50 }, { gold: -50 }), { wood: 50 });
});

test("charged tracking advances to the placer net only on a successful commit", () => {
  const net = { gold: -100, wood: -2 };
  const charged = { gold: -40 };
  assert.deepEqual(advanceChargedOnCommit(true, net, charged), { gold: -100, wood: -2 });
  assert.deepEqual(advanceChargedOnCommit(false, net, charged), { gold: -40 });
});

test("a failed commit keeps the previous charged snapshot without aliasing it", () => {
  const charged = { gold: -40 };
  const kept = advanceChargedOnCommit(false, { gold: -100 }, charged);
  assert.deepEqual(kept, charged);
  assert.notEqual(kept, charged);
});

test("settleNet aborts when gold would go negative, with the computed numbers intact", () => {
  const settled = settleNet(
    { gold: 50, wood: 10, stone: 10, iron: 0, arcane: 0 },
    { gold: 100, wood: 2 },
  );
  assert.equal(settled.ok, false);
  assert.equal(settled.gold, -50);
  assert.equal(settled.wood, 8);
});

test("settleNet charges exactly when affordable and clamps warehouse resources at zero", () => {
  const settled = settleNet(
    { gold: 300, wood: 1, stone: 5, iron: 0, arcane: 0 },
    { gold: 100, wood: 2, stone: 8 },
  );
  assert.equal(settled.ok, true);
  assert.equal(settled.gold, 200);
  assert.equal(settled.wood, 0);
  assert.equal(settled.stone, 0);
});

test("settleNet passes refunds through instead of clamping them away", () => {
  const settled = settleNet(
    { gold: 10, wood: 0, stone: 0, iron: 0, arcane: 0 },
    { gold: -60, stone: -5 },
  );
  assert.equal(settled.ok, true);
  assert.equal(settled.gold, 70);
  assert.equal(settled.stone, 5);
});

test("invertNet negates every tracked resource and ignores untracked ones", () => {
  assert.deepEqual(invertNet({ gold: 300, wood: 2, stone: -5 }), { gold: -300, wood: -2, stone: 5 });
  assert.deepEqual(invertNet({ food: -5 } as never), {});
  assert.deepEqual(invertNet({}), {});
});

test("applying the inverse of an applied delta restores the settlement's committed stock", () => {
  const delta = { gold: 300, wood: 2 };
  const postCommit = makeState({
    settlements: [makeSettlement("s0", 0, 2, 2, { gold: 300, warehouse: emptyWarehouse({ wood: 2, stone: 4 }) })],
  });

  const rolledBack = applyNetToSettlement(postCommit, "s0", invertNet(delta));

  assert.ok(rolledBack);
  const s = rolledBack!.settlements["s0"];
  assert.equal(s.gold, 600);
  assert.equal(s.warehouse.wood, 4);
  assert.equal(s.warehouse.stone, 4);
  assert.equal(rolledBack!.dirty, true);
});

test("applyNetToSettlement returns null for a missing settlement or an unaffordable net", () => {
  const state = makeState({
    settlements: [makeSettlement("s0", 0, 2, 2, { gold: 5 })],
  });
  assert.equal(applyNetToSettlement(state, "missing", { gold: 10 }), null);
  assert.equal(applyNetToSettlement(state, "s0", { gold: 10 }), null);
});

test("applying an inverse delta leaves other settlements untouched", () => {
  const state = makeState({
    settlements: [
      makeSettlement("s0", 0, 2, 2, { gold: 300 }),
      makeSettlement("s1", 1, 18, 4, { gold: 123 }),
    ],
  });

  const rolledBack = applyNetToSettlement(state, "s0", invertNet({ gold: 300 }));

  assert.ok(rolledBack);
  assert.equal(rolledBack!.settlements["s0"].gold, 600);
  assert.equal(rolledBack!.settlements["s1"].gold, 123);
});

test("build ledger: a single pending commit is returned FIFO for rollback", () => {
  assert.equal(pendingBuildCommitCount("ledger-solo"), 0);
  recordBuildCommit("ledger-solo", { gold: -220, wood: -2 });
  assert.equal(pendingBuildCommitCount("ledger-solo"), 1);
  assert.deepEqual(takeLastAppliedBuildDelta("ledger-solo"), { gold: -220, wood: -2 });
  assert.equal(pendingBuildCommitCount("ledger-solo"), 0);
  assert.equal(takeLastAppliedBuildDelta("ledger-solo"), undefined);
});

test("build ledger: zero-value deltas are never recorded", () => {
  recordBuildCommit("ledger-empty", {});
  recordBuildCommit("ledger-empty", { gold: 0 });
  assert.equal(pendingBuildCommitCount("ledger-empty"), 0);
});

test("build ledger: multiple pending commits drop the whole ledger and roll back nothing", () => {
  recordBuildCommit("ledger-spam", { gold: -100 });
  recordBuildCommit("ledger-spam", { gold: -120 });
  assert.equal(pendingBuildCommitCount("ledger-spam"), 2);
  assert.equal(takeLastAppliedBuildDelta("ledger-spam"), undefined);
  assert.equal(pendingBuildCommitCount("ledger-spam"), 0, "the whole queue is dropped, not just the oldest delta");
  assert.equal(takeLastAppliedBuildDelta("ledger-spam"), undefined);
});

test("build ledger: settlements keep independent queues", () => {
  recordBuildCommit("ledger-a", { gold: -1 });
  recordBuildCommit("ledger-b", { gold: -2 });
  assert.deepEqual(takeLastAppliedBuildDelta("ledger-b"), { gold: -2 });
  assert.deepEqual(takeLastAppliedBuildDelta("ledger-a"), { gold: -1 });
});
