import { Client } from "pg";

// Process-wide fan-out point for Postgres NOTIFY wakeups on the
// 'game_events_changed' channel (migration 017's AFTER INSERT trigger on
// game_events). Consumed by server/http/routes/eventStream.ts to push new
// event rows to SSE subscribers without waiting for the 2 s poll.
//
// One dedicated pg.Client per process, NOT a pool client: LISTEN only
// delivers on the exact connection that issued it, so that connection must
// be held for the process lifetime. Borrowing a pool client would both
// starve the pool (the client is never released) and break delivery the
// moment it was released. One process = one LISTEN connection is trivial
// today (one API process per worktree) and is precisely the cue for the
// future broker stage of the plan.
//
// The notification payload is only the game_id; subscribers re-query the
// table for rows after their own cursor. That is safe because NOTIFY is
// delivered at commit -- whatever caused the wakeup is already visible to
// the handler's snapshot (see migration 017's header).

const CHANNEL = "game_events_changed";
const INITIAL_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 5000;

export interface EventsNotifier {
  // Registers cb to be invoked whenever a new game_events row is committed
  // for gameId. Returns an unsubscribe function. The callback carries no
  // payload -- callers re-query with their own cursor (same query as the
  // poll route), which makes delivery at-least-once and order-correct by
  // construction.
  subscribeGameEvents(gameId: number, cb: () => void): () => void;
  // Ends the client and stops any pending reconnect timer. Subsequent
  // subscribes are ignored.
  close(): Promise<void>;
}

// The slice of pg.Client the notifier actually uses, kept narrow so the
// unit test can inject a fake (an EventEmitter with a query() recording
// method is enough). The real pg Client satisfies this structurally.
export interface NotifierClient {
  query(sql: string): Promise<unknown>;
  on(event: "notification", listener: (msg: NotifierNotification) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  end(): Promise<void>;
}

// Shape of pg's "notification" event (its own Notification type has
// payload?: string, so undefined is a real possibility, not just null).
export interface NotifierNotification {
  channel: string;
  payload?: string | null;
}

export interface EventsNotifierDeps {
  // Overridable client factory for tests. Defaults to a real pg.Client
  // built from the same env values server/persistence/db.ts's pool reads --
  // duplicated rather than imported so this module never touches (or keeps
  // alive) the request pool. If a transaction-mode pgbouncer ever fronts
  // the DB, this is where a PGNOTIFY_DSN-style override would land.
  connect?: () => Promise<NotifierClient>;
  // Initial reconnect backoff in ms. Doubles per consecutive failure up to
  // MAX_BACKOFF_MS; reset to this value after a successful LISTEN. Defaults
  // to 250ms; tests inject something tiny.
  backoffMs?: number;
}

function defaultConnect(): Promise<NotifierClient> {
  const client = new Client({
    host: process.env.PGHOST ?? "localhost",
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER || "gameuser",
    password: process.env.PGPASSWORD || "gamepass",
    database: process.env.PGDATABASE ?? "game_poc",
  });
  return client.connect().then(() => client);
}

// Tolerates garbage payloads (a corrupted or foreign notification must
// never throw into the connection's event handler): anything that isn't a
// base-10 integer string is ignored.
function parseGameId(payload: string | null | undefined): number | null {
  if (typeof payload !== "string" || !/^\d+$/.test(payload)) return null;
  const n = Number(payload);
  return Number.isSafeInteger(n) ? n : null;
}

export function createEventsNotifier(deps?: EventsNotifierDeps): EventsNotifier {
  const connect = deps?.connect ?? defaultConnect;
  const initialBackoffMs = deps?.backoffMs ?? INITIAL_BACKOFF_MS;

  const subscribers = new Map<number, Set<() => void>>();
  let client: NotifierClient | null = null;
  let connecting = false;
  let closed = false;
  let backoffMs = initialBackoffMs;
  let reconnectTimer: NodeJS.Timeout | null = null;

  function handleNotification(msg: NotifierNotification): void {
    if (msg.channel !== CHANNEL) return;
    const gameId = parseGameId(msg.payload);
    if (gameId === null) return;
    const subs = subscribers.get(gameId);
    if (!subs || subs.size === 0) return;
    // Copy before iterating: a callback that unsubscribes itself (or a
    // peer) mid-emit must not corrupt the set being walked.
    for (const cb of [...subs]) cb();
  }

  function scheduleReconnect(): void {
    if (closed || reconnectTimer) return;
    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    // Unref'd: a dying process shouldn't be kept alive by a retry it will
    // never use; the API's http server and pool hold the process otherwise.
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void ensureConnected();
    }, delay);
    reconnectTimer.unref();
  }

  // Tear-down on error/end. `dead` is compared against the current client
  // because error and end usually both fire for one socket failure -- only
  // the first may schedule a reconnect, and a stale event from a
  // already-replaced client must be ignored.
  function handleConnectionLost(dead: NotifierClient): void {
    if (closed || client !== dead) return;
    client = null;
    void dead.end().catch(() => {});
    scheduleReconnect();
  }

  async function ensureConnected(): Promise<void> {
    if (closed || client || connecting) return;
    connecting = true;
    let c: NotifierClient | null = null;
    try {
      c = await connect();
      await c.query(`LISTEN ${CHANNEL}`);
    } catch (err) {
      if (c) void c.end().catch(() => {});
      connecting = false;
      if (closed) return;
      console.error("[api] events notifier connect failed, backing off:", err);
      scheduleReconnect();
      return;
    }
    connecting = false;
    if (closed) {
      void c.end().catch(() => {});
      return;
    }
    // Success: backoff resets so a one-off blip doesn't inherit a long
    // delay from a previous outage streak.
    backoffMs = initialBackoffMs;
    client = c;
    c.on("notification", handleNotification);
    c.on("error", () => handleConnectionLost(c));
    c.on("end", () => handleConnectionLost(c));
  }

  return {
    subscribeGameEvents(gameId: number, cb: () => void): () => void {
      if (closed) return () => {};
      let set = subscribers.get(gameId);
      if (!set) {
        set = new Set();
        subscribers.set(gameId, set);
      }
      set.add(cb);
      // Connect lazily: no socket is held while no SSE client is attached.
      // Registration is synchronous, so a notification that lands after the
      // future LISTEN is delivered; none can be lost in between because the
      // first tail query always re-reads from the caller's cursor.
      void ensureConnected();
      return () => {
        const s = subscribers.get(gameId);
        if (!s) return;
        s.delete(cb);
        if (s.size === 0) subscribers.delete(gameId);
      };
    },

    async close(): Promise<void> {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      subscribers.clear();
      const c = client;
      client = null;
      if (c) await c.end().catch(() => {});
    },
  };
}

let singleton: EventsNotifier | null = null;

// Lazy process-wide instance. The socket only opens on the first
// subscribeGameEvents, so merely importing the module (or mounting the
// stream route) costs nothing.
export function getEventsNotifier(): EventsNotifier {
  if (!singleton) singleton = createEventsNotifier();
  return singleton;
}
