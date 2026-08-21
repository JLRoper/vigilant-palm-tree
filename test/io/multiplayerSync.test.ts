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
      return body(init?.method === "POST" ? {} : { nodes: [], links: [], updatedAt: 0 });
    }
    return body(server.game);
  };
}

beforeEach(() => {
  bus.clear();
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
