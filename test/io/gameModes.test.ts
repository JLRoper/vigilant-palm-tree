import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearGameMode,
  gameModeFor,
  isSettlersGame,
  resetGameModes,
  setGameMode,
} from "../../src/io/gameModes";
import { DEFAULT_GAME_MODE } from "@heroes/contracts";

// The per-game mode registry (SETTLERS-PLAN.md §4 W4), the
// io/serverDrivenGames.test.ts shape: what the client knows about the ACTIVE
// game's mode before it has walked the game state.

beforeEach(() => {
  resetGameModes();
});

test("an unknown game reads as the default mode, never as an error", () => {
  assert.equal(gameModeFor("never-registered"), DEFAULT_GAME_MODE);
  assert.equal(gameModeFor(null), DEFAULT_GAME_MODE);
  assert.equal(gameModeFor(undefined), DEFAULT_GAME_MODE);
  assert.equal(isSettlersGame("never-registered"), false);
});

test("setGameMode registers a settlers game and isSettlersGame answers it", () => {
  assert.equal(isSettlersGame("wg-settlers"), false);
  setGameMode("wg-settlers", "settlers");
  assert.equal(isSettlersGame("wg-settlers"), true);
  assert.equal(gameModeFor("wg-settlers"), "settlers");
});

test("junk normalizes to the default through the contracts vocabulary", () => {
  setGameMode("wg-junk", "not-a-mode");
  setGameMode("wg-missing", undefined);
  setGameMode("wg-null", null);
  setGameMode("wg-number", 7);
  assert.equal(gameModeFor("wg-junk"), DEFAULT_GAME_MODE, "a typo'd mode is a classic game");
  assert.equal(gameModeFor("wg-missing"), DEFAULT_GAME_MODE);
  assert.equal(gameModeFor("wg-null"), DEFAULT_GAME_MODE);
  assert.equal(gameModeFor("wg-number"), DEFAULT_GAME_MODE);
});

test("re-registering a game replaces its entry rather than stacking one", () => {
  setGameMode("wg-flip", "settlers");
  setGameMode("wg-flip", "classic");
  assert.equal(isSettlersGame("wg-flip"), false);
  setGameMode("wg-flip", "settlers");
  assert.equal(isSettlersGame("wg-flip"), true);
});

test("clearGameMode drops one game and leaves the others alone", () => {
  setGameMode("wg-a", "settlers");
  setGameMode("wg-b", "settlers");
  clearGameMode("wg-a");
  assert.equal(isSettlersGame("wg-a"), false, "the cleared game reads as classic");
  assert.equal(isSettlersGame("wg-b"), true, "a sibling game's entry is untouched");
});

test("clearing an unknown game is a no-op", () => {
  clearGameMode("wg-never-seen");
  assert.equal(isSettlersGame("wg-never-seen"), false);
});

test("the registry is per game, so a game switch cannot inherit the previous mode", () => {
  setGameMode("wg-first", "settlers");
  // GameSessionManager.loadGame clears the outgoing entry before registering the
  // incoming one; this pins the registry half of that contract.
  clearGameMode("wg-first");
  setGameMode("wg-second", "classic");
  assert.equal(isSettlersGame("wg-first"), false);
  assert.equal(isSettlersGame("wg-second"), false);
});
