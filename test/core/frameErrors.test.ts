import { test } from "node:test";
import assert from "node:assert/strict";
import { createFrameErrorLog } from "../../src/core/frameErrors";

// The rAF loop catches its own errors so a bad frame cannot kill it (the
// freeze bug), but a fault that persists across frames would then print 60x a
// second. These pin the suppression policy: repeats of the SAME error inside
// the window are dropped, a NEW error always surfaces, and an old repeat logs
// again once the window has passed.

function harness(minIntervalMs = 5_000) {
  const logged: unknown[] = [];
  let clock = 1_000;
  const log = createFrameErrorLog({
    minIntervalMs,
    now: () => clock,
    log: (e) => logged.push(e),
  });
  return {
    logged,
    advance: (ms: number) => {
      clock += ms;
    },
    report: (e: unknown) => log.report(e),
    reset: () => log.reset(),
  };
}

test("the first occurrence always logs", () => {
  const h = harness();
  assert.equal(h.report(new Error("boom")), true);
  assert.equal(h.logged.length, 1);
});

test("a persistent fault does not log every frame", () => {
  const h = harness();
  const err = new Error("boom");
  // ~1s of 60fps frames: exactly one log line, not sixty.
  for (let frame = 0; frame < 60; frame += 1) {
    h.report(err);
    h.advance(16);
  }
  assert.equal(h.logged.length, 1, "60 frames of the same error -> one log line");
});

test("a long-running fault is re-logged at most once per window, not every frame", () => {
  const h = harness(5_000);
  const err = new Error("boom");
  // ~10s of frames at 16ms. The window is 5s, so this can log at t=0 and
  // again once t passes 5s -- and nothing like 600 times.
  for (let frame = 0; frame < 600; frame += 1) {
    h.report(err);
    h.advance(16);
  }
  assert.equal(h.logged.length, 2, `10s of frames -> one log per 5s window, got ${h.logged.length}`);
});

test("a DIFFERENT error is never suppressed by the previous one", () => {
  const h = harness();
  h.report(new Error("boom"));
  h.advance(16);
  assert.equal(h.report(new Error("other boom")), true);
  assert.equal(h.logged.length, 2);
});

test("the same error logs again once the window has elapsed", () => {
  const h = harness(1_000);
  const err = new Error("boom");
  h.report(err);
  h.advance(16);
  assert.equal(h.report(err), false, "still inside the window");
  h.advance(1_000);
  assert.equal(h.report(err), true, "the window expired, so this occurrence logs");
  assert.equal(h.logged.length, 2);
});

test("reset() makes the next occurrence log again", () => {
  const h = harness();
  const err = new Error("boom");
  h.report(err);
  h.advance(16);
  assert.equal(h.report(err), false);
  h.reset();
  assert.equal(h.report(err), true);
});

test("the error key includes the class name, so distinct types do not collide", () => {
  const h = harness();
  h.report(new Error("same message"));
  h.advance(16);
  h.report(new TypeError("same message"));
  assert.equal(h.logged.length, 2, "Error vs TypeError with an identical message are distinct faults");
});