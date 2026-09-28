import { Router, type Request } from "express";
import { pool } from "../../persistence/db";
import {
  getEventsNotifier,
  type EventsNotifier,
} from "../../persistence/eventsNotifier";

// GET /api/games/:name/events/stream -- SSE push transport for the same
// game_events log the poll route serves (plan
// .kilo/plan/2026-09-28-sse-event-push.md). Same cursor contract: `?after=`
// is a game_events.id, catch-up replay covers everything past it, and every
// frame carries `id:` so the browser's EventSource resume (Last-Event-ID)
// is exactly the poll cursor under a different name. The database stays the
// system of record; this route is a tail, not a store.

// Row shape as pg returns it: BIGSERIAL id arrives as a string (int8 driver
// quirk, same as the poll route's JSON), timestamptz as Date (serialized to
// ISO by JSON.stringify, same as res.json there).
interface GameEventRow {
  id: string;
  kind: string;
  payload: unknown;
  actor_seat: number | null;
  created_at: Date;
}

// Exact poll-route SQL (server/routes.ts GET /games/:name/events) so both
// transports can never drift apart in what a cursor means.
const ROWS_AFTER_SQL =
  "SELECT id, kind, payload, actor_seat, created_at FROM game_events WHERE game_id = $1 AND id > $2 ORDER BY id ASC";

const HEARTBEAT_MS = 25_000; // below typical 30-60s proxy idle timeouts

export function createEventStreamRouter(notifier: EventsNotifier): Router {
  // mergeParams: true is required for the parent's :name to reach this
  // router (see commands.ts's header comment on the same Express behavior).
  const eventStreamRouter = Router({ mergeParams: true });

  eventStreamRouter.get("/", async (req: Request<{ name: string }>, res) => {
    // Same ?after validation as the poll route, in the same order (cursor
    // first, then game existence), so both endpoints answer identical
    // errors for identical mistakes.
    const afterRaw = req.query.after;
    let after = 0;
    if (afterRaw !== undefined) {
      if (typeof afterRaw !== "string" || !/^\d+$/.test(afterRaw)) {
        res.status(400).json({ error: "invalid after cursor" });
        return;
      }
      after = Number(afterRaw);
    }
    const game = await pool.query<{ id: number }>(
      "SELECT id FROM games WHERE name = $1",
      [req.params.name]
    );
    if (game.rowCount === 0) {
      res.status(404).json({ error: "game not found" });
      return;
    }
    const gameId = game.rows[0].id;

    // X-Accel-Buffering: no disables nginx response buffering so frames
    // leave immediately instead of coalescing.
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    res.write("retry: 3000\n\n");

    let closed = false;
    let lastSentId = after;

    // Backpressure is accepted at this event volume: res.write() buffers
    // internally and rows arrive at per-command pace (a turn-based game),
    // so waiting on 'drain' would add machinery without a scenario. If a
    // client ever stalls long enough for the buffer to matter, its socket
    // times out and the close path below reclaims everything.
    function writeFrame(row: GameEventRow): void {
      res.write(`id: ${row.id}\nevent: log\ndata: ${JSON.stringify(row)}\n\n`);
    }

    async function fetchRows(afterId: number): Promise<GameEventRow[]> {
      const r = await pool.query<GameEventRow>(ROWS_AFTER_SQL, [gameId, afterId]);
      return r.rows;
    }

    // Live-tail body, also used for the initial catch-up. Serialized with a
    // writing/rerun pair rather than a promise chain: overlapping triggers
    // (a notification landing while a run is mid-flight) collapse into one
    // follow-up re-run from lastSentId instead of stacking concurrent
    // queries, which both preserves frame order and bounds query churn.
    // Subscribing BEFORE the first run closes the query-vs-notify gap: a
    // notification that arrives during catch-up just sets rerun, and the
    // re-run picks up from lastSentId with nothing missed or duplicated
    // (rows are id-ordered and lastSentId only ever advances).
    let running = false;
    let rerun = false;
    async function tail(): Promise<void> {
      if (closed) return;
      if (running) {
        rerun = true;
        return;
      }
      running = true;
      try {
        do {
          rerun = false;
          const rows = await fetchRows(lastSentId);
          for (const row of rows) {
            writeFrame(row);
            lastSentId = Number(row.id);
          }
        } while (rerun);
      } catch (err) {
        // Log once and end: the browser's EventSource reconnects on its own
        // (retry frame above) and the reconnect re-runs catch-up from its
        // Last-Event-ID, so correctness survives without in-band recovery.
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        console.error("[api] event stream query failed, ending stream:", err);
        res.end();
        return;
      } finally {
        running = false;
      }
    }

    const unsubscribe = notifier.subscribeGameEvents(gameId, () => {
      void tail();
    });

    const heartbeat = setInterval(() => {
      if (!closed) res.write(": ping\n\n");
    }, HEARTBEAT_MS);
    heartbeat.unref();

    req.on("close", () => {
      closed = true;
      unsubscribe();
      clearInterval(heartbeat);
    });

    await tail();
  });

  return eventStreamRouter;
}

// Ready-to-mount instance bound to the process-wide notifier singleton --
// same module-level export convention as commands.ts's commandsRouter.
export const eventStreamRouter = createEventStreamRouter(getEventsNotifier());
