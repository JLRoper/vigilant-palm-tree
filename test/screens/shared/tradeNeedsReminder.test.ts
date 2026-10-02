import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameState } from "@heroes/contracts";
import { evaluateTradeNeeds } from "@heroes/engine";
import { evaluateTradeReminder, resetTradeReminderDedupe, tradeReminderMessage, tradeRoutesConfigured } from "../../../src/screens/shared/tradeNeedsReminder";
import { emptyWarehouse, makeHero, makePlayer, makeSettlement, makeState } from "../../charter/_helpers";

// The End Turn trade-route reminder: pure read-side, toast-only, once per
// session per distinct recommendation.

function reminderWorld(): GameState {
  return makeState({
    players: [makePlayer(0, "player", ["h0"], ["s-rich", "s-low"], { wagonsOwned: 4, wagonsUnassigned: 4 })],
    heroes: [makeHero("h0", 0, 30, 2)],
    settlements: [
      makeSettlement("s-rich", 0, 2, 2, { gold: 1000, warehouse: emptyWarehouse({ food: 500 }) }),
      makeSettlement("s-low", 0, 6, 2, { population: 400 }),
    ],
    day: 1,
  });
}

test("fires once when recommendations exist and the seat has zero configured routes", () => {
  resetTradeReminderDedupe();
  const state = reminderWorld();
  const first = evaluateTradeReminder(state, 0);
  assert.ok(first, "a reminder fires");
  assert.ok(first.includes("No trade routes set up"), first);
  assert.ok(first.includes("s-rich"), "names the source settlement");
  assert.ok(first.includes("s-low"), "names the low settlement");
  assert.ok(first.includes("(food)"), "names the payload");

  assert.equal(evaluateTradeReminder(state, 0), null, "the SAME recommendation never re-toasts");
});

test("a changed recommendation set re-arms the reminder for the NEW entries only", () => {
  resetTradeReminderDedupe();
  const state = reminderWorld();
  assert.ok(evaluateTradeReminder(state, 0));
  // A second low settlement appears (new recommendation key).
  const grown: GameState = {
    ...state,
    settlements: {
      ...state.settlements,
      "s-low2": makeSettlement("s-low2", 0, 8, 2, { population: 400 }),
    },
  };
  const second = evaluateTradeReminder(grown, 0);
  assert.ok(second, "a NEW recommendation toasts again");
  assert.ok(second.includes("2 recommended"), "one summary toast counts the list");

  assert.equal(evaluateTradeReminder(grown, 0), null, "and then stays quiet for that set");
});

test("stays silent once any route is configured", () => {
  resetTradeReminderDedupe();
  const state = reminderWorld();
  const routed: GameState = {
    ...state,
    tradeRoutes: [
      {
        id: "route0",
        from: { kind: "settlement", id: "s-rich" },
        to: { kind: "settlement", id: "s-low" },
        payload: { kind: "resource", resource: "food" },
        wagons: 1,
        caravan: null,
      },
    ],
  };
  assert.equal(tradeRoutesConfigured(routed, 0), true);
  assert.equal(evaluateTradeReminder(routed, 0), null, "routes configured -> silent, regardless of recommendations");
});

test("no shortages or unknown seat -> silent; the dedupe reset is a test seam", () => {
  resetTradeReminderDedupe();
  const fed = makeState({
    players: [makePlayer(0, "player", [], ["s0"], { wagonsOwned: 2, wagonsUnassigned: 2 })],
    settlements: [makeSettlement("s0", 0, 2, 2, { gold: 500, warehouse: emptyWarehouse({ food: 100 }) })],
    day: 1,
  });
  assert.equal(evaluateTradeReminder(fed, 0), null, "no recommendations -> silent");
  assert.equal(evaluateTradeReminder(reminderWorld(), null), null, "unknown seat -> silent");

  const state = reminderWorld();
  assert.ok(evaluateTradeReminder(state, 0), "fires after the reset");
  assert.equal(evaluateTradeReminder(state, 0), null);
});

test("the summary toast names at most the top examples and the count", () => {
  resetTradeReminderDedupe();
  const state = reminderWorld();
  const grown: GameState = {
    ...state,
    settlements: {
      ...state.settlements,
      "s-low2": makeSettlement("s-low2", 0, 8, 2, { population: 400 }),
      "s-low3": makeSettlement("s-low3", 0, 10, 2, { population: 400 }),
    },
  };
  // Evaluate directly through the message builder for the shape pin.
  const recs = evaluateTradeNeeds(grown, 0);
  const message = tradeReminderMessage(recs, grown);
  assert.ok(message.startsWith("No trade routes set up — 3 recommended:"), message);
  assert.equal((message.match(/;/g) ?? []).length, 2, "three examples, two separators — never a wall of names");
});
