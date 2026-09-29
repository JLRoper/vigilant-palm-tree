import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { pool } from "../../server/persistence/db";
import { initSchema } from "../../server/db";
import {
  createEventsNotifier,
  type EventsNotifier,
} from "../../server/persistence/eventsNotifier";
import { createEventStreamRouter } from "../../server/http/routes/eventStream";

// Real Express app + real Postgres + a real createEventsNotifier() instance
// with its own dedicated LISTEN connection (same pattern as
// eventsRoute.test.ts -- mocks would just re-describe the SQL). The
// live-tail case depends on migration 017's AFTER INSERT trigger existing,
// so this file runs initSchema() in before(): tests run under plain
// tsx --test with no .env and no server boot, and initSchema() is
// idempotent by design (it runs at every server start), so this is the
// cheap way to guarantee the trigger is in place on a fresh DB.
let server: Server;
let baseUrl: string;
let notifier: EventsNotifier;

before(async () => {
  await initSchema();
  notifier = createEventsNotifier();
  const app = express();
  app.use(express.json());
  app.use("/api/games/:name/events/stream", createEventStreamRouter(notifier));
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

after(async () => {
  // SSE connections are long-lived by design; force-close any survivor so
  // server.close()'s callback (and this test process) can't hang on one.
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await notifier.close();
  await pool.end();
});

function uniqueName(): string {
  return `test-events-stream-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function seedGame(name: string): Promise<void> {
  await pool.query(
    `INSERT INTO games (name, seed, hero_q, hero_r) VALUES ($1, $2, $3, $4)`,
    [name, 1, 0, 0],
  );
}

async function seedEvent(
  name: string,
  kind: string,
  payload: unknown,
  actorSeat: number | null = null,
): Promise<string> {
  // pg returns BIGSERIAL as a string (int8 driver quirk) -- kept as a
  // string here so every comparison below is string-vs-string, matching
  // what the SSE frames carry.
  const r = await pool.query<{ id: string }>(
    `INSERT INTO game_events (game_id, kind, payload, actor_seat)
     SELECT id, $2, $3::jsonb, $4 FROM games WHERE name = $1
     RETURNING id`,
    [name, kind, JSON.stringify(payload), actorSeat],
  );
  return r.rows[0].id;
}

async function gameIdOf(name: string): Promise<number> {
  const r = await pool.query<{ id: number }>("SELECT id FROM games WHERE name = $1", [name]);
  if (r.rowCount === 0) throw new Error(`game ${name} missing`);
  return r.rows[0].id;
}

// Cascades to game_events (schema.sql: game_id ... ON DELETE CASCADE).
async function cleanupGame(name: string): Promise<void> {
  await pool.query(`DELETE FROM games WHERE name = $1`, [name]);
}

interface SseFrame {
  id: string | null;
  event: string | null;
  data: string | null;
  comment: string | null;
  retry: string | null;
}

function parseFrame(block: string): SseFrame {
  const frame: SseFrame = { id: null, event: null, data: null, comment: null, retry: null };
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) frame.comment = line.slice(1).trim();
    else if (line.startsWith("id:")) frame.id = line.slice(3).trim();
    else if (line.startsWith("event:")) frame.event = line.slice(6).trim();
    else if (line.startsWith("data:")) frame.data = line.slice(5).trim();
    else if (line.startsWith("retry:")) frame.retry = line.slice(6).trim();
  }
  return frame;
}

// Incremental SSE reader over Node's streaming fetch body: the stream
// stays open after catch-up, so tests must read frames as they arrive
// instead of awaiting the whole body. waitFor polls the parsed frame list
// (chunk boundaries never align with frame boundaries). close() cancels
// the body, which closes the request and runs the server-side "close"
// path (unsubscribe + heartbeat clear), so nothing outlives the test.
function makeSseReader(res: globalThis.Response) {
  const body = res.body;
  if (!body) throw new Error("response has no body to read");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frames: SseFrame[] = [];
  let streamDone = false;
  let pendingRead: Promise<void> | null = null;

  async function pump(): Promise<void> {
    const { value, done } = await reader.read();
    if (done) {
      streamDone = true;
      return;
    }
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const idx = buffer.indexOf("\n\n");
      if (idx === -1) break;
      frames.push(parseFrame(buffer.slice(0, idx)));
      buffer = buffer.slice(idx + 2);
    }
  }

  async function waitFor(
    predicate: (frames: SseFrame[]) => boolean,
    timeoutMs: number,
  ): Promise<SseFrame[]> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate(frames)) {
      if (streamDone) {
        throw new Error(`stream ended before expected frames arrived; got ${JSON.stringify(frames)}`);
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for frames; got ${JSON.stringify(frames)}`);
      }
      if (!pendingRead) {
        pendingRead = pump().finally(() => {
          pendingRead = null;
        });
      }
      await Promise.race([
        pendingRead,
        new Promise<void>((resolve) => setTimeout(resolve, 25)),
      ]);
    }
    return frames;
  }

  async function close(): Promise<void> {
    await reader.cancel().catch(() => {});
  }

  return { frames, waitFor, close };
}

// The notifier connects and LISTENs lazily on first subscribe, while the
// first POST route request is already in flight -- an INSERT fired before
// LISTEN completes wakes nobody (Postgres does not queue notifications for
// not-yet-attached listeners). This helper loops until an inserted probe
// row's wakeup actually lands (fresh probe per attempt), so every test
// below runs against an already-LISTENing connection and is deterministic.
async function awaitLiveNotifier(gameId: number, name: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const hits: number[] = [];
    const unsub = notifier.subscribeGameEvents(gameId, () => hits.push(1));
    try {
      await seedEvent(name, "notifier_probe", { attempt });
      const deadline = Date.now() + 1000;
      while (hits.length === 0 && Date.now() < deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
      }
      if (hits.length > 0) return;
    } finally {
      unsub();
    }
  }
  throw new Error("notifier never delivered a live notification; LISTEN not established");
}

test("GET stream for an unknown game is 404 game not found", async () => {
  const res = await fetch(`${baseUrl}/games/${uniqueName()}/events/stream`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "game not found" });
});

test("GET stream with a non-numeric or negative ?after is 400 invalid after cursor", async () => {
  const name = uniqueName();
  await seedGame(name);
  try {
    for (const bad of ["not-a-number", "-1", "1.5"]) {
      const res = await fetch(`${baseUrl}/games/${name}/events/stream?after=${bad}`);
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: "invalid after cursor" });
    }
  } finally {
    await cleanupGame(name);
  }
});

test("catch-up replay streams the retry frame then exactly the rows after the cursor", async () => {
  const name = uniqueName();
  await seedGame(name);
  try {
    const first = await seedEvent(name, "before_cursor", { i: 0 });
    const second = await seedEvent(name, "HeroMoved", { i: 1 }, 2);
    const third = await seedEvent(name, "round_started", { round: 2 }, null);

    const res = await fetch(`${baseUrl}/games/${name}/events/stream?after=${first}`);
    assert.equal(res.status, 200);
    assert.ok((res.headers.get("content-type") ?? "").startsWith("text/event-stream"));
    assert.equal(res.headers.get("cache-control"), "no-cache");
    assert.equal(res.headers.get("x-accel-buffering"), "no");

    const sse = makeSseReader(res);
    try {
      const frames = await sse.waitFor(
        (f) => f.filter((x) => x.event === "log").length >= 2,
        5000,
      );
      assert.equal(frames[0].retry, "3000", "first frame sets EventSource's reconnect interval");
      const logs = frames.filter((f) => f.event === "log");
      assert.deepEqual(
        logs.map((f) => f.id),
        [second, third],
        "exactly the rows after the cursor, oldest first",
      );
      const row = JSON.parse(logs[0].data ?? "null") as {
        id: string;
        kind: string;
        actor_seat: number | null;
        payload: { i: number };
      };
      assert.equal(row.id, second);
      assert.equal(row.kind, "HeroMoved");
      assert.equal(row.actor_seat, 2);
      assert.equal(row.payload.i, 1);
    } finally {
      await sse.close();
    }
  } finally {
    await cleanupGame(name);
  }
});

test("live tail: a row inserted after the stream opens arrives as a NOTIFY-driven frame, in id order", async () => {
  const name = uniqueName();
  await seedGame(name);
  try {
    const id1 = await seedEvent(name, "seed_one", { i: 1 });
    const id2 = await seedEvent(name, "seed_two", { i: 2 });
    await awaitLiveNotifier(await gameIdOf(name), name);

    // Cursor at the current end minus one row: catch-up replays everything
    // past id1 (including the probe rows awaitLiveNotifier inserted), then
    // the live insert arrives through the trigger + LISTEN path.
    const gameId = await gameIdOf(name);
    const res = await fetch(`${baseUrl}/games/${name}/events/stream?after=${id1}`);
    assert.equal(res.status, 200);
    const sse = makeSseReader(res);
    try {
      const expectedCatchup = await pool.query<{ id: string }>(
        "SELECT id FROM game_events WHERE game_id = $1 AND id > $2 ORDER BY id ASC",
        [gameId, id1],
      );
      assert.ok(expectedCatchup.rowCount && expectedCatchup.rowCount >= 1);
      const pre = await sse.waitFor(
        (f) => f.filter((x) => x.event === "log").length >= expectedCatchup.rowCount!,
        5000,
      );
      const preIds = pre.filter((f) => f.event === "log").map((f) => f.id);
      assert.ok(preIds.includes(id2), "catch-up carries the pre-existing rows");

      const liveId = await seedEvent(name, "live_insert", { i: 3 }, 1);
      const all = await sse.waitFor(
        (f) => f.some((x) => x.event === "log" && x.id === liveId),
        5000,
      );
      const logIds = all.filter((f) => f.event === "log").map((f) => f.id);
      assert.ok(logIds.includes(liveId), "the inserted row's frame arrived");
      const numeric = logIds.map(Number);
      assert.deepEqual(
        numeric,
        [...numeric].sort((a, b) => a - b),
        "frames are in ascending game_events.id order",
      );
      assert.equal(logIds.length, new Set(logIds).size, "no duplicate frames");
      const liveFrame = all.find((f) => f.event === "log" && f.id === liveId);
      assert.ok(liveFrame?.data);
      const liveRow = JSON.parse(liveFrame.data) as { kind: string; actor_seat: number | null };
      assert.equal(liveRow.kind, "live_insert");
      assert.equal(liveRow.actor_seat, 1);
    } finally {
      await sse.close();
    }
  } finally {
    await cleanupGame(name);
  }
});
