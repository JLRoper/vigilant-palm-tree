import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEngineEvent, ENGINE_EVENT_SYNC_CLASS } from "@heroes/engine";
import { makeHero, makeSettlement, makeState } from "../charter/_helpers";

test("every declared EngineEvent variant is classified exactly once", () => {
  // 25 -> 24 (2026-10-02): ResourcesTraded was deleted outright (dead code --
  // no producer after the manual trade command's removal), so the union is one
  // variant smaller and the registry tracks it.
  assert.equal(Object.keys(ENGINE_EVENT_SYNC_CLASS).length, 24);
});

test("classification counts: 11 apply, 7 resync, 6 ignore", () => {
  const counts = { apply: 0, resync: 0, ignore: 0 };
  for (const cls of Object.values(ENGINE_EVENT_SYNC_CLASS)) counts[cls] += 1;
  assert.deepEqual(counts, { apply: 11, resync: 7, ignore: 6 });
});

test("class agrees with the reducer: BankGoldMoved is an apply kind that replays the reducer", () => {
  assert.equal(ENGINE_EVENT_SYNC_CLASS.BankGoldMoved, "apply");
  const state = makeState({
    settlements: [
      {
        ...makeSettlement("s0", 0, 2, 2, { gold: 900 }),
        buildings: [{ gx: 1, gy: 1, kind: "bank", level: 1, style: "classic", bank: { gold: 100, pendingOut: [] } }],
      },
    ],
  });
  const deposit = applyEngineEvent(state, {
    type: "BankGoldMoved",
    actor: 0,
    settlementId: "s0",
    gx: 1,
    gy: 1,
    amount: 400,
    direction: "deposit",
  });
  assert.equal(deposit.outcome, "applied");
  assert.equal(deposit.state.settlements.s0.gold, 500);
  assert.equal(deposit.state.settlements.s0.buildings[0].bank?.gold, 500);
  // A rejection on replay (the treasury/ pot can no longer cover the move) is
  // what already-applied looks like from behind -> noop, not a resync storm.
  const drained = {
    ...deposit.state,
    settlements: { ...deposit.state.settlements, s0: { ...deposit.state.settlements.s0, gold: 0 } },
  };
  const replay = applyEngineEvent(drained, {
    type: "BankGoldMoved",
    actor: 0,
    settlementId: "s0",
    gx: 1,
    gy: 1,
    amount: 400,
    direction: "deposit",
  });
  assert.equal(replay.outcome, "noop");
  // ...but a real drift (no such settlement) still refetches.
  const drifted = applyEngineEvent(state, {
    type: "BankGoldMoved",
    actor: 0,
    settlementId: "nope",
    gx: 9,
    gy: 9,
    amount: 400,
    direction: "deposit",
  });
  assert.equal(drifted.outcome, "resync");
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
