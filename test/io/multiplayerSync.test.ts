import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { EngineEvent, HeroState, Player, SettlementState } from "@heroes/contracts";
import { makeHero, makePlayer, makeSettlement } from "../charter/_helpers";

// multiplayerSync reaches for window.setInterval/clearInterval at start().
// Stubbed to a no-op scheduler so the tests drive pollOnce() by hand instead
// of racing a real timer, and installed before the module is imported.
const timerStub = {
  setInterval: () => 1,
  clearInterval: () => {},
  localStorage: undefined,
};
(globalThis as unknown as { window: unknown }).window = timerStub;

// SSE transport (plan 2026-09-28-sse-event-push.md): the browser's
// EventSource is replaced with a fake the tests drive by hand. Installed on
// window AND globalThis before the module import; the module looks the
// constructor up off window at start() time, so tests that never dispatch
// frames just carry an idle open stream -- inert for their assertions.
class FakeEventSource {
  static created: FakeEventSource[] = [];
  url: string;
  closed = false;
  onerror: ((ev: unknown) => void) | null = null;
  private logListeners: Array<(ev: { data: string; lastEventId: string }) => void> = [];

  constructor(url: string) {
    this.url = url;
    FakeEventSource.created.push(this);
  }

  addEventListener(type: string, listener: (ev: { data: string; lastEventId: string }) => void): void {
    if (type === "log") this.logListeners.push(listener);
  }

  close(): void {
    this.closed = true;
  }

  /** Simulates the server writing one `event: log` frame. */
  dispatchLog(data: unknown, id: string): void {
    const ev = { data: typeof data === "string" ? data : JSON.stringify(data), lastEventId: id };
    for (const listener of this.logListeners) listener(ev);
  }

  static latest(): FakeEventSource {
    const source = FakeEventSource.created[FakeEventSource.created.length - 1];
    assert.ok(source, "no EventSource was constructed");
    return source;
  }
}
(globalThis as unknown as { window: { EventSource?: unknown } }).window.EventSource = FakeEventSource;
(globalThis as unknown as { EventSource?: unknown }).EventSource = FakeEventSource;

const { MultiplayerSync } = await import("../../src/io/multiplayerSync");
const { setInMemoryLocalPlayerId } = await import("../../src/players/localPlayer");
const { bus } = await import("../../src/core/eventBus");

type EventRow = {
  id: string;
  kind: string;
  payload: unknown;
  actor_seat: number | null;
  created_at: string;
};

function row(id: number, event: EngineEvent, actorSeat: number | null): EventRow {
  return {
    id: String(id),
    kind: event.type,
    payload: event,
    actor_seat: actorSeat,
    created_at: "2026-08-21T00:00:00.000Z",
  };
}

interface GameRowOpts {
  heroes?: HeroState[];
  settlements?: SettlementState[];
  players?: Player[];
  lastEventId?: number;
  activePlayerId?: number;
}

function makeGameRow(name: string, opts: GameRowOpts = {}) {
  const heroList = opts.heroes ?? [makeHero("h0", 0, 2, 2), makeHero("h1", 1, 8, 8)];
  const settlementList = opts.settlements ?? [makeSettlement("s0", 0, 2, 2)];
  const heroes: Record<string, HeroState> = {};
  for (const h of heroList) heroes[h.id] = h;
  const settlements: Record<string, SettlementState> = {};
  for (const s of settlementList) settlements[s.id] = s;
  return {
    id: 1,
    name,
    seed: 1,
    hero_q: 2,
    hero_r: 2,
    turn: 1,
    gold: 0,
    enemy_positions: [],
    created_at: "2026-08-21T00:00:00.000Z",
    updated_at: "2026-08-21T00:00:00.000Z",
    round: 1,
    day: 1,
    active_player_id: opts.activePlayerId ?? 0,
    map_size: "small",
    players: opts.players ?? [makePlayer(0, "player", ["h0"], ["s0"]), makePlayer(1, "ai", ["h1"], [])],
    heroes,
    settlements,
    last_event_id: String(opts.lastEventId ?? 0),
    lobby: { claimed: {} },
  };
}

interface FakeServer {
  game: ReturnType<typeof makeGameRow>;
  events: EventRow[];
  calls: string[];
  // Drop policy (2026-09-27): what the telemetry POST responds with.
  telemetryPresence?: Record<string, { lastSeenAt: string; connected: boolean }> | null;
}

function installFetch(server: FakeServer): void {
  (globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
    const path = String(url);
    server.calls.push(`${init?.method ?? "GET"} ${path}`);
    const body = (value: unknown) =>
      new Response(JSON.stringify(value), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    if (path.includes("/events?after=")) {
      const after = Number(path.split("after=")[1]);
      return body(server.events.filter((e) => Number(e.id) > after));
    }
    if (path.endsWith("/telemetry")) {
      return body(init?.method === "POST" ? { presence: server.telemetryPresence ?? null } : { nodes: [], links: [], updatedAt: 0 });
    }
    return body(server.game);
  };
}

beforeEach(() => {
  bus.clear();
  FakeEventSource.created.length = 0;
});

test("the first poll hydrates full state once and seeds the cursor from the same response", async () => {
  const server: FakeServer = { game: makeGameRow("g1", { lastEventId: 42 }), events: [], calls: [] };
  installFetch(server);
  const sync = new MultiplayerSync();

  sync.start("g1");
  await sync.pollOnce();

  assert.equal(sync.getCursor(), 42);
  assert.equal(sync.getState()?.heroes.h0.q, 2);
  assert.equal(sync.getMirror().getHeroes().length, 2, "the mirror is bootstrapped from that hydrate");
  sync.stop();
});

test("a seeded start goes straight to the delta poll -- no full-state fetch at all", async () => {
  const moved: EngineEvent = { type: "HeroMoved", actor: 1, heroId: "h1", to: { q: 9, r: 8 } };
  const server: FakeServer = {
    game: makeGameRow("g2", { lastEventId: 10 }),
    events: [row(11, moved, 1)],
    calls: [],
  };
  installFetch(server);
  const { hydrateGameState } = await import("@heroes/engine");
  const sync = new MultiplayerSync();

  sync.start("g2", { cursor: 10, state: hydrateGameState(server.game) });
  await sync.pollOnce();

  const fetches = server.calls.filter((c) => !c.includes("/telemetry"));
  assert.ok(fetches.length > 0);
  assert.ok(
    fetches.every((c) => c.includes("/events?after=")),
    `every fetch should be a delta poll, got ${JSON.stringify(fetches)}`,
  );
  assert.equal(sync.getCursor(), 11);
  const hero = sync.getState()?.heroes.h1;
  assert.deepEqual([hero?.q, hero?.r], [9, 8]);
  sync.stop();
});

test("applied deltas advance the mirror and go out on the bus", async () => {
  const moved: EngineEvent = { type: "HeroMoved", actor: 1, heroId: "h1", to: { q: 9, r: 8 } };
  const server: FakeServer = { game: makeGameRow("g3", { lastEventId: 5 }), events: [], calls: [] };
  installFetch(server);
  const sync = new MultiplayerSync();

  sync.start("g3");
  await sync.pollOnce();

  const batches: EngineEvent[][] = [];
  bus.on("mp:eventsApplied", (ev: { events: EngineEvent[] }) => batches.push(ev.events));
  server.events.push(row(6, moved, 1));
  await sync.pollOnce();

  assert.deepEqual(batches, [[moved]]);
  assert.equal(sync.getMirror().getHero("h1")?.moving, true, "the mirror started a tween for the move");
  sync.stop();
});

test("an event whose effect isn't in its payload triggers exactly one full resync", async () => {
  const ended: EngineEvent = {
    type: "TurnEnded",
    actor: 0,
    round: 1,
    day: 2,
    activePlayerId: 1,
    wrapped: false,
  };
  const server: FakeServer = { game: makeGameRow("g4", { lastEventId: 5 }), events: [], calls: [] };
  installFetch(server);
  const sync = new MultiplayerSync();

  sync.start("g4");
  await sync.pollOnce();

  const reasons: string[] = [];
  bus.on("mp:resynced", (ev: { reason: string }) => reasons.push(ev.reason));
  server.events.push(row(6, ended, 0));
  server.game = makeGameRow("g4", { lastEventId: 6, activePlayerId: 1 });
  await sync.pollOnce();

  assert.deepEqual(reasons, ["event_not_derivable"]);
  assert.equal(sync.getCursor(), 6);
  assert.equal(sync.getState()?.activePlayerId, 1);
  sync.stop();
});

test("events this client's own seat caused are skipped, but the cursor still advances past them", async () => {
  const mine: EngineEvent = {
    type: "GoldTransferred",
    actor: 0,
    heroId: "h0",
    settlementId: "s0",
    direction: "deposit",
  };
  const server: FakeServer = {
    game: makeGameRow("g5", {
      lastEventId: 5,
      heroes: [makeHero("h0", 0, 2, 2, { gold: 100 })],
      settlements: [makeSettlement("s0", 0, 2, 2, { gold: 0 })],
    }),
    events: [],
    calls: [],
  };
  installFetch(server);
  setInMemoryLocalPlayerId("g5", 0);
  const sync = new MultiplayerSync();

  sync.start("g5");
  await sync.pollOnce();
  const goldBefore = sync.getState()!.heroes.h0.gold;

  server.events.push(row(6, mine, 0));
  await sync.pollOnce();

  assert.equal(sync.getCursor(), 6);
  assert.equal(sync.getState()!.heroes.h0.gold, goldBefore, "not re-applied on top of the local reducer");
  sync.stop();
});

test("noteSelfEventId skips a self-caused event when the local seat is unknown", async () => {
  const mine: EngineEvent = {
    type: "GoldTransferred",
    actor: 3,
    heroId: "h0",
    settlementId: "s0",
    direction: "deposit",
  };
  const server: FakeServer = {
    game: makeGameRow("g6", {
      lastEventId: 5,
      heroes: [makeHero("h0", 0, 2, 2, { gold: 100 })],
      settlements: [makeSettlement("s0", 0, 2, 2, { gold: 0 })],
    }),
    events: [],
    calls: [],
  };
  installFetch(server);
  const sync = new MultiplayerSync();

  sync.start("g6");
  await sync.pollOnce();

  sync.noteSelfEventId(6);
  server.events.push(row(6, mine, 3));
  await sync.pollOnce();

  assert.equal(sync.getCursor(), 6);
  assert.equal(sync.getState()!.heroes.h0.gold, 100, "skipped by id, not by seat");
  sync.stop();
});

test("the four legacy audit kinds are not EngineEvents and are stepped over", async () => {
  const server: FakeServer = { game: makeGameRow("g7", { lastEventId: 5 }), events: [], calls: [] };
  installFetch(server);
  const sync = new MultiplayerSync();

  sync.start("g7");
  await sync.pollOnce();

  const resyncs: string[] = [];
  bus.on("mp:resynced", (ev: { reason: string }) => resyncs.push(ev.reason));
  for (const [id, kind] of [
    [6, "turn_ended"],
    [7, "round_ended"],
    [8, "round_started"],
    [9, "ai_turn_started"],
  ] as const) {
    server.events.push({
      id: String(id),
      kind,
      payload: { round: 1 },
      actor_seat: null,
      created_at: "2026-08-21T00:00:00.000Z",
    });
  }
  await sync.pollOnce();

  assert.deepEqual(resyncs, [], "no resync -- these carry no EngineEvent to fail on");
  assert.equal(sync.getCursor(), 9);
  sync.stop();
});

test("stop() clears the cursor so the next start() re-seeds from a fresh hydrate", async () => {
  const server: FakeServer = { game: makeGameRow("g8", { lastEventId: 12 }), events: [], calls: [] };
  installFetch(server);
  const sync = new MultiplayerSync();

  sync.start("g8");
  await sync.pollOnce();
  assert.equal(sync.getCursor(), 12);

  sync.stop();
  assert.equal(sync.getCursor(), null);
  assert.equal(sync.isRunning(), false);
});

test("a failed delta poll leaves the cursor where it was instead of rewinding", async () => {
  const server: FakeServer = { game: makeGameRow("g9", { lastEventId: 3 }), events: [], calls: [] };
  installFetch(server);
  const sync = new MultiplayerSync();

  sync.start("g9");
  await sync.pollOnce();

  (globalThis as unknown as { fetch: unknown }).fetch = async () => {
    throw new Error("network down");
  };
  await sync.pollOnce();

  assert.equal(sync.getCursor(), 3);
  sync.stop();
});

// Drop policy (2026-09-27): the per-poll telemetry POST response carries the
// server's seat-presence view, and a full resync carries it on the row's
// lobby.presence -- both land on the bus as mp:presenceUpdated.

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

// Note: start() fires its own first poll immediately, and the tests below
// call pollOnce() by hand right after -- two cycles can overlap, and each
// cycle carries presence (that's the design: one read per poll). So these
// tests assert "every cycle carried the same presence, at least one landed"
// rather than an exact count; the exact-count semantics are the server
// dropPolicy tests' job.

test("seat presence from the telemetry response is emitted as mp:presenceUpdated", async () => {
  const server: FakeServer = { game: makeGameRow("g10", { lastEventId: 2 }), events: [], calls: [] };
  server.telemetryPresence = {
    "1": { lastSeenAt: "2026-09-27T07:00:00.000Z", connected: false },
  };
  installFetch(server);
  setInMemoryLocalPlayerId("g10", 0);
  const sync = new MultiplayerSync();

  const events: Array<{ presence: Record<string, { connected: boolean }> }> = [];
  bus.on("mp:presenceUpdated", (ev: { presence: Record<string, { connected: boolean }> }) =>
    events.push(ev),
  );
  sync.start("g10");
  await sync.pollOnce();
  await tick(); // the telemetry chain is fire-and-forget; let it land

  assert.ok(events.length >= 1, "at least one presence event per poll cycle");
  for (const ev of events) {
    assert.deepEqual(
      ev.presence,
      server.telemetryPresence,
      "every cycle carries the server's view verbatim",
    );
  }
  sync.stop();
});

test("no presence in the telemetry response means no mp:presenceUpdated", async () => {
  const server: FakeServer = { game: makeGameRow("g11", { lastEventId: 2 }), events: [], calls: [] };
  installFetch(server);
  setInMemoryLocalPlayerId("g11", 0);
  const sync = new MultiplayerSync();

  const events: unknown[] = [];
  bus.on("mp:presenceUpdated", (ev: unknown) => events.push(ev));
  sync.start("g11");
  await sync.pollOnce();
  await tick();

  assert.deepEqual(events, [], "an old API process (or a 204) emits nothing");
  sync.stop();
});

test("a resync emits mp:presenceUpdated from the row's lobby presence", async () => {
  const server: FakeServer = {
    game: makeGameRow("g12", { lastEventId: 2 }),
    events: [],
    calls: [],
  };
  server.game.lobby = {
    claimed: {},
    presence: { "0": { lastSeenAt: "2026-09-27T07:00:00.000Z", connected: true } },
  };
  installFetch(server);
  setInMemoryLocalPlayerId("g12", 0);
  const sync = new MultiplayerSync();

  const events: Array<{ presence: Record<string, { connected: boolean }> }> = [];
  bus.on("mp:presenceUpdated", (ev: { presence: Record<string, { connected: boolean }> }) =>
    events.push(ev),
  );
  sync.start("g12");
  await sync.pollOnce();

  assert.ok(events.length >= 1, "the resync's row carries presence onto the bus");
  for (const ev of events) {
    assert.deepEqual(ev.presence, server.game.lobby.presence);
  }
  sync.stop();
});

// SSE transport (plan/2026-09-28-sse-event-push.md): frames land in
// applyRows exactly like polled rows -- same cursor advance, same
// filtering, same mp:logRow fan-out -- so the 2 s poll stays a pure
// backstop and nothing downstream can tell which transport a row arrived
// on. The fake above is inert in every earlier test: start() opens a
// stream per test, but nothing dispatches into it.

test("start() opens the stream at the current cursor; stop() closes it", async () => {
  const server: FakeServer = { game: makeGameRow("gs1", { lastEventId: 7 }), events: [], calls: [] };
  installFetch(server);
  const sync = new MultiplayerSync();

  sync.start("gs1");
  const first = FakeEventSource.latest();
  assert.equal(first.url, "/api/games/gs1/events/stream?after=0", "unseeded start streams from 0");
  await sync.pollOnce();
  assert.equal(sync.getCursor(), 7);
  sync.stop();
  assert.equal(first.closed, true, "stop() closes the stream");

  sync.start("gs1", { cursor: 7 });
  const second = FakeEventSource.latest();
  assert.notEqual(second, first, "a start after stop opens a fresh source");
  assert.equal(second.url, "/api/games/gs1/events/stream?after=7", "seeded start resumes at the cursor");
  sync.stop();
  assert.equal(second.closed, true);
});

test("restarting into a different game closes the old stream first", async () => {
  const server: FakeServer = { game: makeGameRow("gs2", { lastEventId: 1 }), events: [], calls: [] };
  installFetch(server);
  const sync = new MultiplayerSync();

  sync.start("gs2a");
  const first = FakeEventSource.latest();
  sync.start("gs2b");
  assert.equal(first.closed, true, "the old game's stream is closed on re-start");
  assert.equal(FakeEventSource.latest().url, "/api/games/gs2b/events/stream?after=0");
  sync.stop();
});

test("an SSE log frame emits mp:logRow and applies the state delta", async () => {
  const moved: EngineEvent = { type: "HeroMoved", actor: 1, heroId: "h1", to: { q: 9, r: 8 } };
  const server: FakeServer = { game: makeGameRow("gs3", { lastEventId: 10 }), events: [], calls: [] };
  installFetch(server);
  const { hydrateGameState } = await import("@heroes/engine");
  const sync = new MultiplayerSync();
  sync.start("gs3", { cursor: 10, state: hydrateGameState(server.game) });
  const es = FakeEventSource.latest();

  const logRows: EventRow[] = [];
  bus.on("mp:logRow", (ev: { row: EventRow }) => logRows.push(ev.row));
  es.dispatchLog(row(11, moved, 1), "11");
  await tick();

  assert.equal(logRows.length, 1, "the frame fans out to the log before any filtering");
  assert.equal(logRows[0].id, "11");
  assert.equal(sync.getCursor(), 11, "the frame advances the cursor");
  assert.equal(sync.getMirror().getHero("h1")?.moving, true, "the mirror started a tween for the move");

  server.events.push(row(11, moved, 1));
  await sync.pollOnce();
  assert.equal(logRows.length, 1, "the poll backstop never re-delivers a streamed row");
  sync.stop();
});

test("a legacy audit kind row via SSE still fans out to the log but never resyncs", async () => {
  const server: FakeServer = { game: makeGameRow("gs4", { lastEventId: 10 }), events: [], calls: [] };
  installFetch(server);
  const { hydrateGameState } = await import("@heroes/engine");
  const sync = new MultiplayerSync();
  sync.start("gs4", { cursor: 10, state: hydrateGameState(server.game) });
  const es = FakeEventSource.latest();

  const logKinds: string[] = [];
  bus.on("mp:logRow", (ev: { row: { kind: string } }) => logKinds.push(ev.row.kind));
  const resyncs: string[] = [];
  bus.on("mp:resynced", (ev: { reason: string }) => resyncs.push(ev.reason));
  es.dispatchLog(
    { id: "11", kind: "turn_ended", payload: { round: 1 }, actor_seat: null, created_at: "2026-09-28T00:00:00.000Z" },
    "11",
  );
  await tick();

  assert.deepEqual(logKinds, ["turn_ended"], "the log is an audit view: every kind streams");
  assert.deepEqual(resyncs, [], "a non-engine kind carries no EngineEvent to fail on");
  assert.equal(sync.getCursor(), 11);
  sync.stop();
});

test("a self-seat row is skipped for state but still emitted as mp:logRow", async () => {
  const mine: EngineEvent = {
    type: "GoldTransferred",
    actor: 0,
    heroId: "h0",
    settlementId: "s0",
    direction: "deposit",
  };
  const server: FakeServer = {
    game: makeGameRow("gs5", {
      lastEventId: 5,
      heroes: [makeHero("h0", 0, 2, 2, { gold: 100 })],
      settlements: [makeSettlement("s0", 0, 2, 2, { gold: 0 })],
    }),
    events: [],
    calls: [],
  };
  installFetch(server);
  setInMemoryLocalPlayerId("gs5", 0);
  const { hydrateGameState } = await import("@heroes/engine");
  const sync = new MultiplayerSync();
  sync.start("gs5", { cursor: 5, state: hydrateGameState(server.game) });
  const es = FakeEventSource.latest();

  const logRows: EventRow[] = [];
  bus.on("mp:logRow", (ev: { row: EventRow }) => logRows.push(ev.row));
  es.dispatchLog(row(6, mine, 0), "6");
  await tick();

  assert.equal(logRows.length, 1, "own-seat rows are not filtered out of the log");
  assert.equal(sync.getCursor(), 6);
  assert.equal(sync.getState()!.heroes.h0.gold, 100, "state was not re-applied");
  sync.stop();
});

// Garrison sync: the three unit-recruitment/garrison-plan kinds. Deltas
// (UnitsRecruited/UnitsTransferred) apply incrementally; the settlement
// battle outcome is not derivable from its payload and rides the existing
// full-refetch resync path instead.

function stackTotal(stacks: { entries: { count: number }[] }[] | undefined): number {
  let total = 0;
  for (const p of stacks ?? []) {
    for (const e of p.entries) total += e.count;
  }
  return total;
}

test("UnitsRecruited and UnitsTransferred deltas apply to the sync state and fan out", async () => {
  const server: FakeServer = {
    game: makeGameRow("gm1", {
      lastEventId: 10,
      heroes: [makeHero("h1", 1, 8, 8)],
      settlements: [
        {
          ...makeSettlement("s0", 1, 8, 8),
          stacks: [{ entries: [{ unitTypeId: "pikeman", count: 4 }] }],
        },
      ],
      players: [makePlayer(0, "player", ["h0"], []), makePlayer(1, "player", ["h1"], ["s0"])],
    }),
    events: [],
    calls: [],
  };
  installFetch(server);
  const { hydrateGameState } = await import("@heroes/engine");
  const sync = new MultiplayerSync();
  sync.start("gm1", { cursor: 10, state: hydrateGameState(server.game) });

  const logKinds: string[] = [];
  bus.on("mp:logRow", (ev: { row: { kind: string } }) => logKinds.push(ev.row.kind));
  const batches: EngineEvent[][] = [];
  bus.on("mp:eventsApplied", (ev: { events: EngineEvent[] }) => batches.push(ev.events));

  const recruited: EngineEvent = {
    type: "UnitsRecruited",
    actor: 1,
    settlementId: "s0",
    unitTypeId: "pikeman",
    count: 5,
  };
  const transferred: EngineEvent = {
    type: "UnitsTransferred",
    actor: 1,
    heroId: "h1",
    settlementId: "s0",
    direction: "toHero",
    unitTypeId: "pikeman",
    count: 2,
  };
  server.events.push(row(11, recruited, 1), row(12, transferred, 1));
  await sync.pollOnce();

  assert.deepEqual(logKinds, ["UnitsRecruited", "UnitsTransferred"], "both rows fan out to the log");
  assert.deepEqual(batches, [[recruited, transferred]]);
  assert.equal(sync.getCursor(), 12);
  assert.equal(stackTotal(sync.getState()?.settlements.s0.stacks), 7, "recruit +5, transfer -2");
  assert.equal(stackTotal(sync.getState()?.heroes.h1.stacks), 2, "the hero picked up the transferred units");
  sync.stop();
});

test("SettlementBattleResolved flows through as one full resync with the fetched state applied", async () => {
  const server: FakeServer = {
    game: makeGameRow("gm2", {
      lastEventId: 10,
      heroes: [makeHero("h1", 1, 8, 8)],
      settlements: [makeSettlement("s0", 0, 8, 8)],
      players: [makePlayer(0, "player", ["h0"], []), makePlayer(1, "player", ["h1"], [])],
    }),
    events: [],
    calls: [],
  };
  installFetch(server);
  const { hydrateGameState } = await import("@heroes/engine");
  const sync = new MultiplayerSync();
  sync.start("gm2", { cursor: 10, state: hydrateGameState(server.game) });

  const resyncs: string[] = [];
  bus.on("mp:resynced", (ev: { reason: string }) => resyncs.push(ev.reason));
  const batches: EngineEvent[][] = [];
  bus.on("mp:eventsApplied", (ev: { events: EngineEvent[] }) => batches.push(ev.events));

  server.game = makeGameRow("gm2", {
    lastEventId: 13,
    heroes: [makeHero("h1", 1, 8, 8)],
    settlements: [
      {
        ...makeSettlement("s0", 1, 8, 8),
        stacks: [{ entries: [{ unitTypeId: "pikeman", count: 5 }] }],
      },
    ],
    players: [makePlayer(0, "player", ["h0"], []), makePlayer(1, "player", ["h1"], ["s0"])],
  });
  server.events.push(
    row(
      13,
      {
        type: "SettlementBattleResolved",
        actor: 1,
        attackerId: "h1",
        settlementId: "s0",
        winner: "attacker",
        captured: true,
      },
      1,
    ),
  );
  await sync.pollOnce();

  assert.deepEqual(resyncs, ["event_not_derivable"], "one full refetch, from the outcome row");
  assert.deepEqual(batches, [], "a non-derivable event never lands in the applied batch");
  assert.equal(sync.getCursor(), 13);
  const state = sync.getState()!;
  assert.equal(state.settlements.s0.ownerId, 1, "the capture flipped the owner");
  assert.equal(stackTotal(state.settlements.s0.stacks), 5, "the fetched garrison replaced the local view");
  sync.stop();
});

test("a self-seat garrison delta is skipped for state but still fans out and advances the cursor", async () => {
  const server: FakeServer = {
    game: makeGameRow("gm3", {
      lastEventId: 10,
      heroes: [makeHero("h1", 1, 8, 8)],
      settlements: [
        {
          ...makeSettlement("s0", 1, 8, 8),
          stacks: [{ entries: [{ unitTypeId: "pikeman", count: 4 }] }],
        },
      ],
    }),
    events: [],
    calls: [],
  };
  installFetch(server);
  setInMemoryLocalPlayerId("gm3", 1);
  const { hydrateGameState } = await import("@heroes/engine");
  const sync = new MultiplayerSync();
  sync.start("gm3", { cursor: 10, state: hydrateGameState(server.game) });

  const logKinds: string[] = [];
  bus.on("mp:logRow", (ev: { row: { kind: string } }) => logKinds.push(ev.row.kind));
  const batches: EngineEvent[][] = [];
  bus.on("mp:eventsApplied", (ev: { events: EngineEvent[] }) => batches.push(ev.events));

  server.events.push(
    row(11, { type: "UnitsRecruited", actor: 1, settlementId: "s0", unitTypeId: "pikeman", count: 5 }, 1),
  );
  await sync.pollOnce();

  assert.deepEqual(logKinds, ["UnitsRecruited"], "own rows still reach the log");
  assert.deepEqual(batches, [], "own rows are not re-applied on top of the local reducer");
  assert.equal(sync.getCursor(), 11);
  assert.equal(stackTotal(sync.getState()?.settlements.s0.stacks), 4);
  sync.stop();
});
