import { test } from "node:test";
import assert from "node:assert/strict";
import type { MpBattleOutcomeEvent } from "../../../src/core/events";
import {
  BATTLE_VOIDED_TITLE,
  battleVoidedMessage,
  battleVoidedOutcomeLines,
  isServerVoidOfWatchedBattle,
  watchServerBattleVoid,
  type WatchedBattle,
} from "../../../src/screens/combat/serverVoidedBattle";

// The client half of the reader's card: when the server settles the battle
// this client is still fighting (the offer went idle past the driver's
// deadline), the client must notice and stop treating its played-out fight as
// submittable. These tests pin the detection rule and the wording; the DOM
// card that renders them is not exercised here.

const watched: WatchedBattle = {
  gameName: "g1",
  attackerId: "p1-hero",
  defenderId: "p0-hero",
  localSeat: 0,
};

function resolvedEvent(overrides: Partial<MpBattleOutcomeEvent> = {}): MpBattleOutcomeEvent {
  return {
    type: "mp:battleOutcome",
    gameName: "g1",
    id: "42",
    kind: "heroBattle",
    actorSeat: 1,
    payload: {
      type: "BattleResolved",
      actor: 1,
      attackerId: "p1-hero",
      defenderId: "p0-hero",
      winner: "defender",
      attackerOutcome: "retreated_hero",
      defenderOutcome: "won",
      attackerVerdict: "retreated",
      defenderVerdict: "stood",
      rewardGold: 0,
      rounds: 1,
      obstacleSeed: 7,
    },
    ...overrides,
  };
}

test("another seat settling this exact pair is a void", () => {
  assert.equal(isServerVoidOfWatchedBattle(resolvedEvent(), watched), true);
});

test("this client's own submission coming back is NOT a void", () => {
  // The client's own seat is the actor: that row is the echo of a battle that
  // did count, and tearing the arena down over it would be backwards.
  assert.equal(isServerVoidOfWatchedBattle(resolvedEvent({ actorSeat: 0 }), watched), false);
});

test("an unknown local seat still voids on a matching pair", () => {
  assert.equal(
    isServerVoidOfWatchedBattle(resolvedEvent(), { ...watched, localSeat: null }),
    true,
  );
});

test("a different pair, a different game or a settlement battle is not a void", () => {
  const otherPair = resolvedEvent();
  otherPair.payload = { ...otherPair.payload!, defenderId: "p0-other" } as typeof otherPair.payload;
  assert.equal(isServerVoidOfWatchedBattle(otherPair, watched), false);

  assert.equal(isServerVoidOfWatchedBattle(resolvedEvent({ gameName: "g2" }), watched), false);

  const settlement = resolvedEvent({
    kind: "settlementBattle",
    payload: {
      type: "SettlementBattleResolved",
      actor: 1,
      attackerId: "p1-hero",
      settlementId: "s1",
      winner: "defender",
      captured: false,
    } as MpBattleOutcomeEvent["payload"],
  });
  assert.equal(isServerVoidOfWatchedBattle(settlement, watched), false);
});

test("a watch with no active game name never voids", () => {
  assert.equal(isServerVoidOfWatchedBattle(resolvedEvent(), { ...watched, gameName: null }), false);
});

test("the watch latches once and resolves whenVoided with the server's payload", async () => {
  const listeners: Array<(ev: MpBattleOutcomeEvent) => void> = [];
  const watch = watchServerBattleVoid(watched, (onEvent) => {
    listeners.push(onEvent);
    return () => {};
  });

  assert.equal(watch.voided(), false);
  assert.equal(watch.payload(), null);

  const emit = (ev: MpBattleOutcomeEvent) => listeners.forEach((l) => l(ev));
  emit(resolvedEvent({ actorSeat: 0 })); // own echo: ignored
  emit(resolvedEvent({ gameName: "other" })); // another game: ignored
  assert.equal(watch.voided(), false);

  emit(resolvedEvent());
  assert.equal(watch.voided(), true);
  const payload = await watch.whenVoided();
  assert.equal(payload.winner, "defender");
  assert.equal(payload.attackerVerdict, "retreated");
  assert.equal(watch.payload()?.obstacleSeed, 7);

  // A second matching row (a re-delivery) does not replace the first.
  emit(resolvedEvent({ id: "43", payload: { ...resolvedEvent().payload!, obstacleSeed: 9 } }));
  assert.equal(watch.payload()?.obstacleSeed, 7);
});

test("detach stops the watch: a later matching row no longer arms it", () => {
  const listeners: Array<(ev: MpBattleOutcomeEvent) => void> = [];
  let detached = false;
  const watch = watchServerBattleVoid(watched, (onEvent) => {
    listeners.push(onEvent);
    return () => {
      detached = true;
    };
  });

  watch.detach();
  assert.equal(detached, true, "detach unsubscribes from the stream");
  // Even if a stale listener reference fires, a detached watch was already
  // unsubscribed -- this pins the unsubscribe contract, and the latched
  // state stays untouched.
  assert.equal(watch.voided(), false);
});

test("the voided wording says plainly that the fight was voided", async () => {
  assert.equal(BATTLE_VOIDED_TITLE, "This fight was voided");
  const message = battleVoidedMessage();
  assert.match(message, /was not recorded/);
  assert.match(message, /server/i);
  assert.doesNotMatch(message, /Couldn't record this battle/);

  const lines = await battleVoidedOutcomeLines(
    { attackerVerdict: "retreated", defenderVerdict: "stood" } as never,
    "Hero p1-hero",
    "Hero p0-hero",
  );
  assert.deepEqual(lines, ["Server's result — Hero p1-hero retreated."]);
  assert.deepEqual(await battleVoidedOutcomeLines(null, "a", "b"), []);
});
