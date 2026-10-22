import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandError } from "../../src/io/commands";
import { isTransientCommandError, sendWithRetry } from "../../src/io/commandRetry";

const noSleep = async (): Promise<void> => {};

test("isTransientCommandError: 4xx rejections are permanent, 5xx and network errors are transient", () => {
  assert.equal(isTransientCommandError(new CommandError(409, "not_adjacent")), false);
  assert.equal(isTransientCommandError(new CommandError(403, "forbidden_not_your_turn")), false);
  assert.equal(isTransientCommandError(new CommandError(500, "internal")), true);
  assert.equal(isTransientCommandError(new CommandError(503, "unavailable")), true);
  assert.equal(isTransientCommandError(new TypeError("Failed to fetch")), true);
});

test("sendWithRetry returns the first success without retrying", async () => {
  let calls = 0;
  const result = await sendWithRetry(async () => {
    calls++;
    return "ok";
  }, { sleep: noSleep });
  assert.deepEqual(result, { ok: true, value: "ok" });
  assert.equal(calls, 1);
});

test("sendWithRetry retries transient failures and succeeds when the server recovers", async () => {
  let calls = 0;
  const slept: number[] = [];
  const result = await sendWithRetry(
    async () => {
      calls++;
      if (calls < 3) throw new CommandError(500, "internal");
      return 42;
    },
    { delaysMs: [10, 20], sleep: async (ms) => { slept.push(ms); } },
  );
  assert.deepEqual(result, { ok: true, value: 42 });
  assert.equal(calls, 3);
  assert.deepEqual(slept, [10, 20]);
});

test("sendWithRetry gives up after the last delay with the final transient reason", async () => {
  let calls = 0;
  const result = await sendWithRetry(
    async () => {
      calls++;
      throw new TypeError("Failed to fetch");
    },
    { delaysMs: [1, 1], sleep: noSleep },
  );
  assert.deepEqual(result, { ok: false, reason: "Failed to fetch", transient: true });
  assert.equal(calls, 3);
});

test("sendWithRetry fails fast on a permanent rejection -- resending the same payload cannot succeed", async () => {
  let calls = 0;
  const result = await sendWithRetry(
    async () => {
      calls++;
      throw new CommandError(409, "not_adjacent");
    },
    { delaysMs: [1, 1], sleep: noSleep },
  );
  assert.deepEqual(result, { ok: false, reason: "not_adjacent", transient: false });
  assert.equal(calls, 1);
});
