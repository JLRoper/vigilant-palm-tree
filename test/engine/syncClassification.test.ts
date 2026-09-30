import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEngineEvent, ENGINE_EVENT_SYNC_CLASS } from "@heroes/engine";
import { makeHero, makeState } from "../charter/_helpers";

test("every declared EngineEvent variant is classified exactly once", () => {
  assert.equal(Object.keys(ENGINE_EVENT_SYNC_CLASS).length, 24);
});

test("classification counts: 11 apply, 7 resync, 6 ignore", () => {
  const counts = { apply: 0, resync: 0, ignore: 0 };
  for (const cls of Object.values(ENGINE_EVENT_SYNC_CLASS)) counts[cls] += 1;
  assert.deepEqual(counts, { apply: 11, resync: 7, ignore: 6 });
});

test("class agrees with the reducer: an apply kind replays through applyEngineEvent", () => {
  assert.equal(ENGINE_EVENT_SYNC_CLASS.HeroMoved, "apply");
  const state = makeState({ heroes: [makeHero("h1", 1, 5, 5)], settlements: [] });
  const result = applyEngineEvent(state, {
    type: "HeroMoved",
    actor: 1,
    heroId: "h1",
    to: { q: 6, r: 5 },
  });
  assert.equal(result.outcome, "applied");
});

test("class agrees with the reducer: a resync kind is admitted and refetches", () => {
  assert.equal(ENGINE_EVENT_SYNC_CLASS.TurnEnded, "resync");
  assert.notEqual(ENGINE_EVENT_SYNC_CLASS.TurnEnded, "ignore");
  const result = applyEngineEvent(makeState(), {
    type: "TurnEnded",
    actor: 0,
    round: 2,
    day: 2,
    activePlayerId: 1,
    wrapped: false,
  });
  assert.equal(result.outcome, "resync");
});

test("an ignore kind is dropped by the sync filter yet would resync at the reducer", () => {
  assert.equal(ENGINE_EVENT_SYNC_CLASS.BuildingsPlaced, "ignore");
  const result = applyEngineEvent(makeState(), {
    type: "BuildingsPlaced",
    actor: 0,
    settlementId: "s0",
  });
  assert.equal(result.outcome, "resync");
});
