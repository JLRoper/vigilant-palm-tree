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