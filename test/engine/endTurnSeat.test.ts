import { test } from "node:test";
import assert from "node:assert/strict";
import { canEndTurn, canEndTurnFromSeat } from "@heroes/engine";
import { makePlayer, makeState } from "../charter/_helpers";

// Playthrough round 2b (F1): the toolbar's End Turn control is about the LOCAL
// seat's own turn. `canEndTurn` alone answers "is the seat holding the turn a
// human one", which is ALSO true on the other human seat's turn -- that is how
// a seat-0 client was served a live, enabled button during seat 1's turn and
// ended it. The seat-scoped variant is the rule the toolbar (and the hotkey)
// gates on; the case that must stay working is the unknown-seat one (a solo or
// no-server game has nothing to compare against) plus the AI path, which the
// tick drives and never asks this predicate about.
function twoHumanSeats() {
  return makeState({
    players: [makePlayer(0, "player", ["h0"], ["s0"]), makePlayer(1, "player", ["h1"], ["s1"])],
    activePlayerId: 1,
    phase: { kind: "PLAYER_TURN", playerId: 1 },
  });
}

test("canEndTurnFromSeat refuses the control on another seat's turn (F1)", () => {
  const state = twoHumanSeats();
  assert.equal(canEndTurn(state), true, "the turn belongs to a human seat -- the old rule offers the control");
  assert.equal(
    canEndTurnFromSeat(state, 0),
    false,
    "seat 0's client must not be offered seat 1's turn",
  );
  assert.equal(
    canEndTurnFromSeat(state, 1),
    true,
    "the seat whose turn it is keeps the control",
  );
});

test("an unknown local seat keeps the legacy behaviour (no seat to compare against)", () => {
  assert.equal(canEndTurnFromSeat(twoHumanSeats(), null), true);
});

test("a battle or round-end phase offers the control to nobody", () => {
  const state = twoHumanSeats();
  assert.equal(
    canEndTurnFromSeat({ ...state, phase: { kind: "ROUND_END", nextRound: 2 } }, 1),
    false,
  );
});

test("an AI seat's turn is never endable from the control, by any seat (the tick ends it)", () => {
  const state = makeState({ activePlayerId: 1, phase: { kind: "AI_TURN", playerId: 1 } });
  assert.equal(canEndTurnFromSeat(state, 0), false);
  assert.equal(canEndTurnFromSeat(state, 1), false);
  assert.equal(canEndTurnFromSeat(state, null), false);
});
