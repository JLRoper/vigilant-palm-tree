import { test } from "node:test";
import assert from "node:assert/strict";
import { netDelta } from "../../../src/screens/settlements/cityView/netCost";

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
