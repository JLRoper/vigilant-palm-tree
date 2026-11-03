import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveInitialLocalSeat } from "../../src/players/localPlayer";

// Playthrough round 2b (F2, the seat-truth half): the browser's OWN claim is
// the seat it plays. Before this, GameSessionManager.loadGame adopted the
// FIRST claimed seat in the lobby, so a browser that claimed seat 1 through
// the lobby's Join tab (`setLocalPlayerId(name, 1)`) was silently reset to
// seat 0 on load -- the second human seat in one browser could not be held.
test("the browser's own claim wins over the first claimed seat", () => {
  assert.equal(resolveInitialLocalSeat([0, 1], 1), 1);
  assert.equal(resolveInitialLocalSeat([0, 1, 2], 2), 2);
});

test("a browser with no claim of its own falls back to the first claimed seat (legacy behaviour)", () => {
  assert.equal(resolveInitialLocalSeat([0], null), 0);
  assert.equal(resolveInitialLocalSeat([1, 2], null), 1);
  assert.equal(resolveInitialLocalSeat([], null), null);
});

test("a stored seat nobody holds is not adopted (the lobby is the authority)", () => {
  assert.equal(resolveInitialLocalSeat([0], 1), 0);
  assert.equal(resolveInitialLocalSeat([], 3), null);
});
