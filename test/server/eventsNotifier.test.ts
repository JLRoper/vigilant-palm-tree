import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  createEventsNotifier,
  type NotifierClient,
} from "../../server/persistence/eventsNotifier";

// Pure unit test: the notifier is driven through an injected fake client
// (an EventEmitter with a query recorder -- exactly the surface
// NotifierClient exposes), so no Postgres or sockets are involved. The
// real-LISTEN integration path is covered end-to-end by
// eventStreamRoute.test.ts.

const CHANNEL = "game_events_changed";

interface FakeClient extends NotifierClient {
  notify(payload: string | null, channel?: string): void;
  fail(err: Error): void;
}

interface FakeClientHarness {
  client: FakeClient;
  queries: string[];
  endCalls: () => number;
}

// EventEmitter is structurally assignable to the event-half of
// NotifierClient; query/end are bolted on as recording closures so the
// harness can assert exactly which SQL the notifier issued and how many
// sockets it ended.
function makeFakeClient(): FakeClientHarness {
  const ee = new EventEmitter();
  const queries: string[] = [];
  let ends = 0;
  const client = ee as EventEmitter & FakeClient;
  client.query = (sql: string): Promise<unknown> => {
    queries.push(sql);
    return Promise.resolve({});
  };
  client.end = (): Promise<void> => {
    ends += 1;
    return Promise.resolve();
  };
  client.notify = (payload: string | null, channel: string = CHANNEL): void => {
    ee.emit("notification", { channel, payload });
  };
  client.fail = (err: Error): void => {
    ee.emit("error", err);
  };
  return { client, queries, endCalls: () => ends };
}

// Hands out the given fake clients in order; the initial-backoff override
// keeps the reconnect test's wall time in the tens of milliseconds.
function makeNotifier(backoffMs: number, ...clients: FakeClient[]) {
  const handedOut: FakeClient[] = [];
  const notifier = createEventsNotifier({
    backoffMs,
    connect: async (): Promise<NotifierClient> => {
      const next = clients[handedOut.length];
      if (!next) throw new Error("test harness: fake client pool exhausted");
      handedOut.push(next);
      return next;
    },
  });
  return { notifier, handedOut };
}

const tick = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 10));

test("issues LISTEN on the channel when the first subscriber registers", async () => {
  const c = makeFakeClient();
  const { notifier } = makeNotifier(5, c.client);
  try {
    notifier.subscribeGameEvents(7, () => {});
    await tick();
    assert.deepEqual(c.queries, [`LISTEN ${CHANNEL}`]);
  } finally {
    await notifier.close();
  }
});

test("two subscribers for one gameId both fire on that game's notification", async () => {
  const c = makeFakeClient();
  const { notifier } = makeNotifier(5, c.client);
  try {
    const a: number[] = [];
    const b: number[] = [];
    notifier.subscribeGameEvents(1, () => a.push(1));
    notifier.subscribeGameEvents(1, () => b.push(1));
    await tick();
    c.client.notify("1");
    assert.deepEqual(a, [1]);
    assert.deepEqual(b, [1]);
  } finally {
    await notifier.close();
  }
});

test("a notification for a different gameId does not call the subscribers", async () => {
  const c = makeFakeClient();
  const { notifier } = makeNotifier(5, c.client);
  try {
    const got: number[] = [];
    const wrong: number[] = [];
    notifier.subscribeGameEvents(1, () => got.push(1));
    notifier.subscribeGameEvents(2, () => wrong.push(2));
    await tick();
    c.client.notify("2");
    assert.deepEqual(got, [], "game 1's subscriber must not see game 2's wakeup");
    assert.deepEqual(wrong, [2]);
  } finally {
    await notifier.close();
  }
});

test("unsubscribe removes the callback so later notifications are silent", async () => {
  const c = makeFakeClient();
  const { notifier } = makeNotifier(5, c.client);
  try {
    const got: number[] = [];
    const unsub = notifier.subscribeGameEvents(1, () => got.push(1));
    await tick();
    c.client.notify("1");
    unsub();
    c.client.notify("1");
    assert.deepEqual(got, [1]);
  } finally {
    await notifier.close();
  }
});

test("garbage payloads and foreign channels are ignored, not thrown on", async () => {
  const c = makeFakeClient();
  const { notifier } = makeNotifier(5, c.client);
  try {
    const got: number[] = [];
    notifier.subscribeGameEvents(1, () => got.push(1));
    await tick();
    c.client.notify(null);
    c.client.notify(undefined);
    c.client.notify("");
    c.client.notify("not-a-number");
    c.client.notify("1.5");
    c.client.notify("-1");
    c.client.notify("1", "some_other_channel");
    assert.deepEqual(got, []);
    c.client.notify("1");
    assert.deepEqual(got, [1], "still delivers after the garbage");
  } finally {
    await notifier.close();
  }
});

test("a callback unsubscribing mid-emit does not break delivery to peers", async () => {
  const c = makeFakeClient();
  const { notifier } = makeNotifier(5, c.client);
  try {
    const calls: string[] = [];
    const unA = notifier.subscribeGameEvents(1, () => {
      calls.push("a");
      unA();
      unB();
    });
    const unB = notifier.subscribeGameEvents(1, () => calls.push("b"));
    const unC = notifier.subscribeGameEvents(1, () => calls.push("c"));
    await tick();
    c.client.notify("1");
    // Copy-before-iterate semantics: the emit walks the set snapshot, so a
    // callback removed by an earlier callback still gets exactly this one
    // emit, and nobody is skipped or visited twice.
    assert.deepEqual(calls, ["a", "b", "c"]);
    unC();
    c.client.notify("1");
    assert.deepEqual(calls, ["a", "b", "c"], "removals take effect after the emit");
  } finally {
    await notifier.close();
  }
});

test("after a client error it reconnects with backoff, re-issues LISTEN, and subscriptions survive", async () => {
  const c1 = makeFakeClient();
  const c2 = makeFakeClient();
  const { notifier, handedOut } = makeNotifier(5, c1.client, c2.client);
  try {
    const got: number[] = [];
    notifier.subscribeGameEvents(3, () => got.push(3));
    await tick();
    assert.equal(handedOut.length, 1);

    c1.client.fail(new Error("boom"));
    await tick();
    assert.ok(c1.endCalls() >= 1, "the dead socket is ended");

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    assert.equal(handedOut.length, 2, "a second client was connected after the backoff");
    assert.deepEqual(c2.queries, [`LISTEN ${CHANNEL}`], "LISTEN is re-issued on the new connection");

    c2.client.notify("3");
    assert.deepEqual(got, [3], "the registration map survived the reconnect");
  } finally {
    await notifier.close();
  }
});

test("close() ends the active client and stops delivery", async () => {
  const c = makeFakeClient();
  const { notifier } = makeNotifier(5, c.client);
  const got: number[] = [];
  notifier.subscribeGameEvents(1, () => got.push(1));
  await tick();
  await notifier.close();
  assert.equal(c.endCalls(), 1);
  c.client.notify("1");
  assert.deepEqual(got, []);
});
