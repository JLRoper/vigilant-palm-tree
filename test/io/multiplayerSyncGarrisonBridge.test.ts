import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { EngineEvent, GameState } from "@heroes/contracts";
import { makeHero, makePlayer, makeSettlement } from "../charter/_helpers";

// ---------------------------------------------------------------------------
// Copilot's finding on PR #288 (src/io/multiplayerSync.ts:432): on an unseeded
// load or EndTurn restart, garrisonEventBridge's onResynced can REJECT the
// initial snapshot -- unflagged games drop every reason but
// `event_not_derivable`, and a flagged one adopts only when `aiTurnSuperseded`
// -- while multiplayerSync has ALREADY seeded `this.cursor` from that same GET
// (resync(): `this.cursor = game.last_event_id`) and opened the event stream
// there (`ensureEventStream`), and applyRows' per-row filter
// (`if (Number.isFinite(id) && id <= cursor) continue;`) then discards the
// redelivery of those same rows. A pending BattleOffered, a troop total or a
// hero position committed between the state the client holds and that cursor is
// therefore lost for the whole session.
//
// These are the SYNC/BRIDGE INTEGRATION tests Copilot asked for: a real
// MultiplayerSync driving a real bus and a real garrisonEventBridge over a real
// TurnController, asserting what the CLIENT actually ends up holding -- not what
// either half does in isolation.
// ---------------------------------------------------------------------------

// multiplayerSync reaches for window.setInterval/clearInterval at start(), and
// for window.EventSource when it opens the stream. Stubbed before the module
// import, exactly as test/io/multiplayerSync.test.ts does.
const timerStub = {
  setInterval: () => 1,
  clearInterval: () => {},
  localStorage: undefined,
};
(globalThis as unknown as { window: unknown }).window = timerStub;

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
const { attachGarrisonEventBridge } = await import("../../src/game/garrisonEventBridge");
const { TurnController } = await import("../../src/state/turnController");
const { bus } = await import("../../src/core/eventBus");
const { setInMemoryLocalPlayerId } = await import("../../src/players/localPlayer");
const { hydrateGameState } = await import("@heroes/engine");
const serverDrivenPolicy = await import("../../src/io/serverDrivenGames");

type StubHooks = ConstructorParameters<typeof TurnController>[1];

// The bridge's own tests' stub hook surface (test/state/garrisonEventMerge.test.ts):
// every command hook a no-op, because these tests never dispatch a command.
function stubHooks(): StubHooks {
  const noop = async (): Promise<void> => {};
  return {
    onHumanTurnEnd: async (state: GameState) => state,
    onAiMove: noop,
    onHumanMove: noop,
    onBattleResolved: async (state: GameState) => ({ state, battle: null }),
    pickAiMove: () => null,
    logEvent: () => {},
    getMap: () => {
      throw new Error("map not needed");
    },
    rng: () => 0,
    onRecruitHero: noop,
    onUpgradeTownHall: noop,
    onSetAutoTrade: noop,
    onReorderStack: noop,
    onCaptureSettlement: noop,
    onTransferGold: noop,
    onStartCharter: noop,
    onAdvanceCharterTravel: noop,
    onUpgradeBuilding: noop,
    onUpgradeSettlement: noop,
    onRecruitUnits: noop,
    onTransferUnits: noop,
    onSettlementBattleSubmitted: noop,
    onPlaceBuildings: noop,
    onTransferResources: noop,
    onAssignWagons: noop,
    onBuyWagons: noop,
    onCreateTradeRoute: noop,
    onUpdateTradeRoute: noop,
  };
}

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
  lastEventId?: number;
  activePlayerId?: number;
  garrison?: number;
  players?: ReturnType<typeof makePlayer>[];
  flagged?: boolean;
}

function makeGameRow(name: string, opts: GameRowOpts = {}) {
  const players =
    opts.players ??
    [makePlayer(0, "player", ["h0"], ["s0"]), makePlayer(1, "player", ["h1"], [])];
  return {
    id: 1,
    name,
    seed: 1,
    hero_q: 2,
    hero_r: 2,
    gold: 0,
    enemy_positions: [],
    created_at: "2026-08-21T00:00:00.000Z",
    updated_at: "2026-08-21T00:00:00.000Z",
    round: 1,
    day: 1,
    active_player_id: opts.activePlayerId ?? 0,
    map_size: "small",
    players,
    heroes: { h0: makeHero("h0", 0, 2, 2), h1: makeHero("h1", 1, 8, 8) },
    settlements: {
      s0: {
        ...makeSettlement("s0", 0, 2, 2),
        stacks: [{ entries: [{ unitTypeId: "pikeman", count: opts.garrison ?? 4 }] }],
      },
    },
    last_event_id: String(opts.lastEventId ?? 0),
    lobby: opts.flagged ? { claimed: {}, aiDriver: "server" as const } : { claimed: {} },
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
      return body(init?.method === "POST" ? { presence: null } : { nodes: [], links: [], updatedAt: 0 });
    }
    return body(server.game);
  };
}

function stackTotal(state: GameState, id: string): number {
  let total = 0;
  const stacks = state.settlements[id]?.stacks ?? [];
  for (const platoon of stacks) {
    for (const entry of platoon.entries) total += entry.count;
  }
  return total;
}

// The client half of the load path: a real TurnController over the state the
// load hydrate produced, replaced wholesale when the bridge adopts a snapshot
// (production: GameStateManager.replaceState rebuilds the controller).
function harness(gameName: string, initialState: GameState, opts: { localSeat?: number | null } = {}) {
  const localSeat = opts.localSeat === undefined ? 0 : opts.localSeat;
  let tc: TurnController | null = new TurnController(initialState, stubHooks());
  const replaces: GameState[] = [];
  const detach = attachGarrisonEventBridge({
    getController: () => tc,
    replaceState: (next) => {
      replaces.push(next);
      tc = new TurnController(next, stubHooks());
    },
    isPrimaryActor: () => false,
    localSeat: () => localSeat,
  });
  return {
    detach,
    replaces,
    controller: () => {
      assert.ok(tc, "no controller installed");
      return tc;
    },
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  bus.clear();
  FakeEventSource.created.length = 0;
  serverDrivenPolicy.clearServerDriven("mpb1");
  serverDrivenPolicy.clearServerDriven("mpb2");
});

// --- Path 1: the local player's own turn on load ---------------------------
//
// The unseeded load (a load-list row carries no last_event_id, so
// GameSessionManager.loadGame calls start() with no cursor) hydrates S0 from a
// row fetched before the events below committed. The sync's own resync GET
// returns a LATER snapshot (S1) at cursor 5. The bridge refuses the snapshot
// (localSeat 0, PLAYER_TURN, unflagged), the cursor moves to 5, and the stream
// opens at after=5.
test("an unseeded load on the local player's turn still ends up holding the snapshot's rows", async () => {
  const name = "mpb1";
  const recruited: EngineEvent = {
    type: "UnitsRecruited",
    actor: 1,
    settlementId: "s0",
    unitTypeId: "pikeman",
    count: 5,
  };
  // What the client holds: the stale row (garrison 4).
  const stale = makeGameRow(name, { lastEventId: 5, garrison: 4 });
  const clientState = hydrateGameState(stale);
  // What the server holds now: garrison 9, at cursor 5.
  const server: FakeServer = {
    game: makeGameRow(name, { lastEventId: 5, garrison: 9 }),
    events: [row(4, recruited, 1)],
    calls: [],
  };
  installFetch(server);
  setInMemoryLocalPlayerId(name, 0);
  assert.equal(stackTotal(clientState, "s0"), 4, "fixture: the client starts behind the server");

  const h = harness(name, clientState, { localSeat: 0 });
  const sync = new MultiplayerSync();
  const resynced = new Promise<{ reason: string; cursor: number; state: GameState }>((resolve) => {
    bus.on("mp:resynced", (ev: { gameName: string; reason: string; cursor: number; state: GameState }) => {
      if (ev.gameName === name && ev.reason === "initial") resolve(ev);
    });
  });
  sync.start(name, { state: clientState });
  const initial = await resynced;
  await tick();

  assert.equal(initial.cursor, 5, "the initial resync's snapshot carries its own cursor");
  assert.equal(
    stackTotal(initial.state, "s0"),
    9,
    "the server's snapshot (what the sync adopted) already has the recruit",
  );
  assert.equal(
    FakeEventSource.latest().url,
    `/api/games/${name}/events/stream?after=5`,
    "the stream opens at the snapshot's cursor",
  );

  // The poll backstop runs the rest of the session from cursor 5.
  await sync.pollOnce();
  await sync.pollOnce();
  await tick();

  assert.equal(
    stackTotal(h.controller().getState(), "s0"),
    9,
    "the client must end up holding the row the snapshot carried, not the stale garrison 4",
  );
  h.detach();
  sync.stop();
});

// --- Path 2: a flagged game's unchanged AI turn ---------------------------
//
// Same shape on a server-driven game: the local controller is parked mid-AI-turn
// and the fetch is still inside that same AI turn (same round + seat), so
// garrisonEventBridge's aiTurnSuperseded() is false and the snapshot is refused
// -- while the cursor still jumps to it.
test("a flagged game's unchanged AI turn still ends up holding the snapshot's rows", async () => {
  const name = "mpb2";
  const recruited: EngineEvent = {
    type: "UnitsRecruited",
    actor: 1,
    settlementId: "s0",
    unitTypeId: "pikeman",
    count: 5,
  };
  const players = [makePlayer(0, "player", ["h0"], ["s0"]), makePlayer(1, "ai", ["h1"], [])];
  const stale = makeGameRow(name, { lastEventId: 5, activePlayerId: 1, garrison: 4, players, flagged: true });
  const clientState = hydrateGameState(stale);
  assert.equal(clientState.phase.kind, "AI_TURN", "fixture: the parked controller sits in the AI turn");
  const server: FakeServer = {
    game: makeGameRow(name, { lastEventId: 5, activePlayerId: 1, garrison: 9, players, flagged: true }),
    events: [row(4, recruited, 1)],
    calls: [],
  };
  installFetch(server);
  serverDrivenPolicy.clearServerDriven(name);
  serverDrivenPolicy.syncServerDrivenFromGame(server.game);
  setInMemoryLocalPlayerId(name, 0);

  const h = harness(name, clientState, { localSeat: 0 });
  const sync = new MultiplayerSync();
  const resynced = new Promise<{ reason: string; cursor: number; state: GameState }>((resolve) => {
    bus.on("mp:resynced", (ev: { gameName: string; reason: string; cursor: number; state: GameState }) => {
      if (ev.gameName === name && ev.reason === "initial") resolve(ev);
    });
  });
  sync.start(name, { state: clientState });
  const initial = await resynced;
  await tick();

  assert.equal(initial.cursor, 5, "the initial resync's snapshot carries its own cursor");
  assert.equal(stackTotal(initial.state, "s0"), 9, "the skipped AI-turn rows are in the snapshot");
  assert.equal(FakeEventSource.latest().url, `/api/games/${name}/events/stream?after=5`);

  await sync.pollOnce();
  await sync.pollOnce();
  await tick();

  assert.equal(
    stackTotal(h.controller().getState(), "s0"),
    9,
    "the spectator must not lose the AI turn's committed rows to the cursor jump",
  );
  h.detach();
  sync.stop();
  serverDrivenPolicy.clearServerDriven(name);
});

// --- The unpaired exception must not leak into PAIRED snapshots -----------
//
// A snapshot whose cursor the client's state IS paired with keeps the design's
// refusal rules: adopting it would rewind the state that pairing describes
// (in-flight optimistic commands, a parked local AI turn), and those refusals
// are phase-scoped -- the next boundary's full resync repairs them.
test("a paired snapshot still keeps the refusal rules", async () => {
  const name = "mpb1";
  const stale = makeGameRow(name, { lastEventId: 5, garrison: 4, activePlayerId: 0 });
  const clientState = hydrateGameState(stale);
  const server: FakeServer = {
    game: makeGameRow(name, { lastEventId: 5, garrison: 9, activePlayerId: 0 }),
    events: [],
    calls: [],
  };
  installFetch(server);
  setInMemoryLocalPlayerId(name, 0);

  const h = harness(name, clientState, { localSeat: 0 });
  // Same local-player's-turn position as path 1, but the client's state is
  // paired with a cursor, so it is the design's drop that applies.
  bus.emit({
    type: "mp:resynced",
    gameName: name,
    state: hydrateGameState(server.game),
    cursor: 5,
    pairedCursor: 5,
    reason: "initial",
  });
  await tick();

  assert.deepEqual(h.replaces, [], "a paired snapshot over the local turn is still refused");
  assert.equal(stackTotal(h.controller().getState(), "s0"), 4, "the same state the pairing describes");
  h.detach();
});

// --- Control: the harness itself reconciles when the client is behind ------
//
// Proves the integration harness can adopt a snapshot at all, so the two
// assertions above are about the dropped-snapshot paths and not a broken rig.
test("control: a resync the bridge adopts lands on the controller", async () => {
  const name = "mpb1";
  const stale = makeGameRow(name, { lastEventId: 5, garrison: 4, activePlayerId: 1 });
  const clientState = hydrateGameState(stale);
  const server: FakeServer = {
    game: makeGameRow(name, { lastEventId: 5, garrison: 9, activePlayerId: 1 }),
    events: [],
    calls: [],
  };
  installFetch(server);
  setInMemoryLocalPlayerId(name, 0);

  const h = harness(name, clientState, { localSeat: 0 });
  bus.emit({
    type: "mp:resynced",
    gameName: name,
    state: hydrateGameState(server.game),
    cursor: 5,
    reason: "event_not_derivable",
  });
  await tick();

  assert.equal(h.replaces.length, 1, "the snapshot is adopted");
  assert.equal(stackTotal(h.controller().getState(), "s0"), 9);
  h.detach();
});
