import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARENA_HEARTBEAT_INTERVAL_MS,
  startArenaHeartbeat,
  type ArenaHeartbeatTimers,
} from "../../../src/screens/combat/arena/arenaHeartbeat";

// The arena's liveness row is what keeps the AI driver's IDLE wait window
// open while a human is still fighting the offered battle: the driver
// (server/app/aiDriver.ts, AI_DEFENDER_WAIT_TIMEOUT_MS) measures the window
// from the newest battle_actions row for the pair, so a fight that is still
// being played must keep producing one even while the player sits and thinks.
// These tests pin the timer's contract with injected timers/clock -- no DOM,
// no fetch: one post per interval, the client's own clock in the payload, and
// a stop() that actually cancels (a leaked timer would keep posting rows for
// an arena that is long closed).

function fakeTimers(): ArenaHeartbeatTimers & {
  fire: (times?: number) => void;
  pending: () => number;
  cleared: number[];
} {
  const scheduled = new Map<number, () => void>();
  const cleared: number[] = [];
  let next = 1;
  return {
    setInterval(fn) {
      const handle = next++;
      scheduled.set(handle, fn);
      return handle;
    },
    clearInterval(handle) {
      cleared.push(handle);
      scheduled.delete(handle);
    },
    fire(times = 1) {
      for (let i = 0; i < times; i++) for (const fn of [...scheduled.values()]) fn();
    },
    pending: () => scheduled.size,
    cleared,
  };
}

test("the heartbeat posts one row per interval, stamped with the client's own clock", () => {
  const timers = fakeTimers();
  const posts: number[] = [];
  let clock = 1_000;
  startArenaHeartbeat((nowMs) => posts.push(nowMs), {
    intervalMs: 5_000,
    timers,
    now: () => (clock += 5_000),
  });

  assert.equal(posts.length, 0, "opening the arena posts nothing on its own (the arena's own start row is that evidence)");
  timers.fire(3);
  assert.deepEqual(posts, [6_000, 11_000, 16_000]);
  assert.equal(timers.pending(), 1, "one interval is armed, never a growing set");
});

test("stop() cancels the interval so a closed arena stops posting", () => {
  const timers = fakeTimers();
  const posts: number[] = [];
  const stop = startArenaHeartbeat((nowMs) => posts.push(nowMs), { timers, now: () => 42 });
  timers.fire(1);
  assert.equal(posts.length, 1);

  stop();

  timers.fire(5);
  assert.equal(posts.length, 1, "nothing posts after stop()");
  assert.equal(timers.pending(), 0);
  assert.equal(timers.cleared.length, 1);
});

test("the default interval is well inside the driver's idle window", () => {
  // The driver force-resolves only after 300s of silence from the pair; the
  // heartbeat must refresh far more often than that, or a player who is
  // thinking would still be voided out.
  assert.ok(ARENA_HEARTBEAT_INTERVAL_MS > 0);
  assert.ok(
    ARENA_HEARTBEAT_INTERVAL_MS <= 60_000,
    `the arena heartbeat (${ARENA_HEARTBEAT_INTERVAL_MS}ms) must be well inside the driver's 300s idle window`,
  );
});
