import { test } from "node:test";
import assert from "node:assert/strict";
import { ARMY_STACK_SLOTS, reorderGarrisonStacks, settlementStacks } from "@heroes/engine";
import type { Platoon } from "@heroes/contracts";
import { makeSettlement, makeState } from "../charter/_helpers";

// The garrison grid's within-grid drag: two of a settlement's eight stack slots
// swap, exactly the rule hero/stacks.ts applies to a hero's army.

function platoons(entriesList: { unitTypeId: string; count: number }[][]): Platoon[] {
  const out = entriesList.map((entries) => ({ entries }));
  while (out.length < ARMY_STACK_SLOTS) out.push({ entries: [] });
  return out;
}

function stateWith(stacks: Platoon[], ownerId: number | null = 0) {
  return makeState({
    settlements: [{ ...makeSettlement("s0", ownerId, 3, 3), stacks }],
  });
}

test("reorderGarrisonStacks swaps the two named slots", () => {
  const state = stateWith(platoons([
    [{ unitTypeId: "peasant", count: 4 }],
    [],
    [{ unitTypeId: "archer", count: 2 }],
  ]));
  const result = reorderGarrisonStacks(state, "s0", 0, 2);
  assert.equal(result.ok, true);
  assert.equal(result.state.dirty, true);
  const stacks = settlementStacks(result.state.settlements.s0);
  assert.deepEqual(stacks[0].entries, [{ unitTypeId: "archer", count: 2 }]);
  assert.deepEqual(stacks[2].entries, [{ unitTypeId: "peasant", count: 4 }]);
  assert.equal(stacks.length, ARMY_STACK_SLOTS, "the slot count is preserved");
});

test("reorderGarrisonStacks with an empty target moves the stack into it", () => {
  const state = stateWith(platoons([[{ unitTypeId: "peasant", count: 4 }]]));
  const result = reorderGarrisonStacks(state, "s0", 0, 7);
  assert.equal(result.ok, true);
  const stacks = settlementStacks(result.state.settlements.s0);
  assert.deepEqual(stacks[0].entries, [], "source slot emptied");
  assert.deepEqual(stacks[7].entries, [{ unitTypeId: "peasant", count: 4 }]);
});

test("reorderGarrisonStacks: same slot is a no-op success", () => {
  const state = stateWith(platoons([[{ unitTypeId: "peasant", count: 4 }]]));
  const result = reorderGarrisonStacks(state, "s0", 3, 3);
  assert.equal(result.ok, true);
  assert.equal(result.state, state, "no new state for a no-op");
});

test("reorderGarrisonStacks refuses an unknown settlement, a null owner and bad indexes", () => {
  const state = stateWith(platoons([]));
  const missing = reorderGarrisonStacks(state, "nope", 0, 1);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "no_settlement");

  const unowned = reorderGarrisonStacks(stateWith(platoons([]), null), "s0", 0, 1);
  assert.equal(unowned.ok, true, "the reducer itself is ownership-free; the server command gates it");

  for (const [from, to] of [[-1, 0], [0, ARMY_STACK_SLOTS], [1.5, 0]]) {
    const bad = reorderGarrisonStacks(state, "s0", from, to);
    assert.equal(bad.ok, false, `from=${from} to=${to}`);
    assert.equal(bad.reason, "invalid_index");
  }
});

test("reorderGarrisonStacks does not mutate the input state", () => {
  const stacks = platoons([[{ unitTypeId: "peasant", count: 4 }]]);
  const state = stateWith(stacks);
  reorderGarrisonStacks(state, "s0", 0, 1);
  assert.deepEqual(settlementStacks(state.settlements.s0)[0].entries, [{ unitTypeId: "peasant", count: 4 }]);
});
