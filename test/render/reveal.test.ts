import { test } from "node:test";
import assert from "node:assert/strict";
import { revealTilesFor, resetReveal } from "../../src/render/reveal";

test("revealTilesFor seeds from the stored list and keeps accumulating the visible union", () => {
  resetReveal();
  const revealed = revealTilesFor("game-a", ["1,2"], new Set(["3,4"]));
  assert.ok(revealed.has("1,2"), "seed keys come from the persisted list");
  assert.ok(revealed.has("3,4"), "currently visible keys are unioned in");

  const again = revealTilesFor("game-a", ["1,2"], new Set(["5,6"]));
  assert.ok(again.has("3,4"), "same game keeps earlier accumulation across frames");
  assert.ok(again.has("5,6"));
  assert.ok(!again.has("7,8"), "never-revealed keys stay absent");
});

test("a different game name reseeds the accumulator and drops prior tiles", () => {
  resetReveal();
  revealTilesFor("game-a", ["1,2"], new Set(["3,4"]));
  const other = revealTilesFor("game-b", ["9,9"], new Set(["3,4"]));
  assert.ok(!other.has("1,2"), "game-a's seed is dropped on the name change");
  assert.ok(other.has("9,9"), "game-b's seed replaces it");
  assert.ok(other.has("3,4"));
});

test("resetReveal clears the accumulator back to an empty fresh set", () => {
  resetReveal();
  revealTilesFor("game-a", ["1,2"], new Set(["3,4"]));
  resetReveal();
  const fresh = revealTilesFor("game-a", ["8,8"], new Set());
  assert.ok(fresh.has("8,8"), "the same name reseeds from scratch after a reset");
  assert.ok(!fresh.has("1,2"), "pre-reset seed did not survive");
  assert.ok(!fresh.has("3,4"), "pre-reset accumulation did not survive");
});

test("the drawn set follows the CURRENT persisted reveal, not the one at load (F1)", () => {
  resetReveal();
  const atLoad = ["1,2"];
  const first = revealTilesFor("game-c", atLoad, new Set(["3,4"]));
  assert.ok(first.has("1,2"));

  // The seat's mirror grows after a move (the TurnController reconciles it from
  // the same engine rule the server persists). The drawn set must pick the new
  // key up immediately -- keeping a copy of the reveal taken on the first frame
  // is the compensating path the staleness hid behind.
  const grown = ["1,2", "9,9"];
  const next = revealTilesFor("game-c", grown, new Set(["3,4"]));
  assert.ok(next.has("9,9"), "a key the mirror gained after load is drawn");

  // And the drawn set is exactly mirror ∪ this session's vision: nothing here
  // remembers a key the mirror no longer carries, because the union is not a
  // second source of truth about the game.
  const shrunk = ["1,2"];
  const after = revealTilesFor("game-c", shrunk, new Set(["3,4"]));
  assert.equal(after.has("9,9"), false, "the drawn set is mirror ∪ session vision, nothing else");
  assert.ok(after.has("1,2") && after.has("3,4"));
});