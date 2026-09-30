import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createAiThinkingTracker,
  shouldShowAiThinking,
} from "../../../src/screens/shared/aiThinkingHint";
import { makePlayer, makeState } from "../../charter/_helpers";
import { bus } from "../../../src/core/eventBus";

// Pure-logic tests only (no DOM): the AI-active predicate and the tracker's
// bus-fed state machine. attachAiThinkingHint's DOM factory needs document
// and is exercised by the browser build.

const aiState = () => {
  const warlord = { ...makePlayer(1, "ai", ["h1"], ["s1"]), name: "Warlord Grok" };
  return makeState({ players: [makePlayer(0, "player", ["h0"], ["s0"]), warlord], activePlayerId: 1 });
};

const humanState = () => makeState({ activePlayerId: 0 });

// The tracker itself is bus-free (the DOM shell owns the wiring); tests
// reproduce attachAiThinkingHint's exact wiring so real bus payloads flow
// through the tracker without touching document.
function wire(tracker: ReturnType<typeof createAiThinkingTracker>): void {
  bus.on("mp:stateChanged", tracker.onStateChanged);
  bus.on("mp:turnStarted", tracker.onTurnStarted);
}

beforeEach(() => {
  bus.clear();
});

test("shouldShowAiThinking shows for an AI-active state", () => {
  assert.equal(shouldShowAiThinking(aiState(), 1, null), true);
  assert.equal(shouldShowAiThinking(aiState(), 1, 2), true, "a foreign local seat does not block");
});

test("shouldShowAiThinking hides for a human-active state", () => {
  assert.equal(shouldShowAiThinking(humanState(), 0, null), false);
});

test("shouldShowAiThinking hides when activePlayerId matches no player", () => {
  assert.equal(shouldShowAiThinking(aiState(), 9, null), false);
});

test("shouldShowAiThinking hides when the local seat is the active AI", () => {
  assert.equal(shouldShowAiThinking(aiState(), 1, 1), false);
});

test("tracker turns visible on an AI-active stateChanged and shows the AI's name", () => {
  const tracker = createAiThinkingTracker();
  wire(tracker);
  bus.emit({ type: "mp:stateChanged", gameName: "g1", prev: null, next: aiState(), serverActivePlayerId: 1 });
  assert.equal(tracker.getVisible(), true);
  const text = tracker.getText();
  assert.ok(text.includes("Warlord Grok"), text);
  assert.ok(text.includes("is thinking"), text);
});

test("tracker hides again when a human-active stateChanged arrives", () => {
  const tracker = createAiThinkingTracker();
  wire(tracker);
  bus.emit({ type: "mp:stateChanged", gameName: "g1", prev: null, next: aiState(), serverActivePlayerId: 1 });
  assert.equal(tracker.getVisible(), true);
  bus.emit({ type: "mp:stateChanged", gameName: "g1", prev: null, next: humanState(), serverActivePlayerId: 0 });
  assert.equal(tracker.getVisible(), false);
  assert.equal(tracker.getText(), "");
});

test("a turnStarted alone (no prior stateChanged) never shows; the next stateChanged does", () => {
  const tracker = createAiThinkingTracker();
  wire(tracker);
  bus.emit({ type: "mp:turnStarted", gameName: "g1", activePlayerId: 1 });
  assert.equal(tracker.getVisible(), false, "no cached state means no visible hint");
  assert.equal(tracker.getText(), "");
  bus.emit({ type: "mp:stateChanged", gameName: "g1", prev: null, next: aiState(), serverActivePlayerId: 1 });
  assert.equal(tracker.getVisible(), true);
});

test("a turnStarted for a different game is ignored as stale", () => {
  const tracker = createAiThinkingTracker();
  wire(tracker);
  bus.emit({ type: "mp:stateChanged", gameName: "g1", prev: null, next: aiState(), serverActivePlayerId: 1 });
  assert.equal(tracker.getVisible(), true);
  bus.emit({ type: "mp:turnStarted", gameName: "g2", activePlayerId: 0 });
  assert.equal(tracker.getVisible(), true, "the foreign turnStarted was not applied");
  assert.ok(tracker.getText().includes("Warlord Grok"), "the cached game's text is untouched");
});

test("the tracker suppresses the hint when the local seat is the active AI", () => {
  const tracker = createAiThinkingTracker({ getLocalSeat: () => 1 });
  wire(tracker);
  bus.emit({ type: "mp:stateChanged", gameName: "g1", prev: null, next: aiState(), serverActivePlayerId: 1 });
  assert.equal(tracker.getVisible(), false);

  const foreign = createAiThinkingTracker({ getLocalSeat: () => 2 });
  foreign.onStateChanged({ type: "mp:stateChanged", gameName: "g1", prev: null, next: aiState(), serverActivePlayerId: 1 });
  assert.equal(foreign.getVisible(), true);
});

test("a nameless AI player falls back to 'AI (seat N) is thinking…'", () => {
  const nameless = { ...makePlayer(1, "ai", ["h1"], ["s1"]), name: "" };
  const state = makeState({ players: [makePlayer(0, "player", ["h0"], ["s0"]), nameless], activePlayerId: 1 });
  const tracker = createAiThinkingTracker();
  wire(tracker);
  bus.emit({ type: "mp:stateChanged", gameName: "g1", prev: null, next: state, serverActivePlayerId: 1 });
  assert.equal(tracker.getVisible(), true);
  assert.equal(tracker.getText(), "AI (seat 1) is thinking\u2026");
});
