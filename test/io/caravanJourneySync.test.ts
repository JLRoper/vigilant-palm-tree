// F7 (playthrough round 4): a client that is NOT the one driving the turn had
// nothing to react to while a caravan loaded, delivered and turned for home --
// no row, so nothing but the next full refetch could tell it the cart had
// moved. These are the CLIENT half of that fix: a real MultiplayerSync over a
// real bus and a real garrisonEventBridge over a real TurnController, fed the
// row the server now appends, asserting what the listening client actually
// ends up holding.
//
// Run: npx tsx --test test/io/caravanJourneySync.test.ts

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { EngineEvent, GameState, TradeRouteState } from "@heroes/contracts";
import type { TurnControllerHooks } from "../../src/state/turnController";
import { makeHero, makePlayer, makeSettlement } from "../charter/_helpers";

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
const { attachGarrisonEventBridge } = await import("../../src/game/garrisonEventBridge");
const { TurnController } = await import("../../src/state/turnController");
const { bus } = await import("../../src/core/eventBus");
const { setInMemoryLocalPlayerId } = await import("../../src/players/localPlayer");
const { hydrateGameState } = await import("@heroes/engine");

// Every command hook a no-op: these tests never dispatch a command, they only
// feed the stream (the bridge's own harness in
// test/io/multiplayerSyncGarrisonBridge.test.ts).
function stubHooks(): TurnControllerHooks {
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
    onReorderGarrison: noop,
    onCaptureSettlement: noop,
    onTransferGold: noop,
    onStartCharter: noop,
    onFoundSettlement: noop,
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
    onAssignWorkers: noop,
    onTradeHeroes: noop,
    onBankGold: noop,
    onPickupResource: noop,
  };
}

// The route as the server persists it: route0 hauls food from seat 0's
// settlement to seat 0's hero, and its cart is seven tiles along the outbound
// leg -- exactly the state the card measured on its fourth day.
const OUTBOUND_PATH = [
  { q: 3, r: 2 },
  { q: 4, r: 2 },
  { q: 5, r: 2 },
  { q: 6, r: 2 },
  { q: 7, r: 2 },
  { q: 8, r: 2 },
  { q: 9, r: 2 },
  { q: 10, r: 2 },
];

function outwardRoute(): TradeRouteState {
  return {
    id: "route0",
    from: { kind: "settlement", id: "s0" },
    to: { kind: "hero", id: "h0" },
    payload: { kind: "resource", resource: "food" },
    wagons: 1,
    caravan: { phase: "toDestination", cargo: 50, path: OUTBOUND_PATH, pathIndex: 7 },
    ownerId: 0,
  };
}

function makeGameRow(name: string, route: TradeRouteState, lastEventId: number) {
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
    active_player_id: 0,
    map_size: "small",
    // Two human seats: seat 0 drives, seat 1 is the listening client.
    players: [makePlayer(0, "player", ["h0"], ["s0"]), makePlayer(1, "player", [], [])],
    heroes: { h0: makeHero("h0", 0, 2, 2) },
    settlements: { s0: makeSettlement("s0", 0, 2, 2) },
    trade_routes: [route],
    last_event_id: String(lastEventId),
    lobby: { claimed: {} },
  };
}

interface FakeServer {
  game: ReturnType<typeof makeGameRow>;
  events: Array<{ id: string; kind: string; payload: unknown; actor_seat: number | null; created_at: string }>;
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

function row(id: number, event: EngineEvent, actorSeat: number | null) {
  return {
    id: String(id),
    kind: event.type,
    payload: event,
    actor_seat: actorSeat,
    created_at: "2026-11-03T00:00:00.000Z",
  };
}

// The client half of the load path: a real TurnController over the state the
// client holds, replaced wholesale when the bridge adopts a snapshot or a
// bridged delta (production: GameStateManager.replaceState).
function harness(initialState: GameState, localSeat: number | null) {
  let tc: InstanceType<typeof TurnController> | null = new TurnController(initialState, stubHooks());
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
    held: (): TradeRouteState | undefined => tc?.getState().tradeRoutes?.[0],
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  bus.clear();
  FakeEventSource.created.length = 0;
});

test("a listening client's own state gains the caravan's delivery and turn for home from the stream alone -- no refetch", async () => {
  const name = "caravan-mp";
  // The row the server's EndTurn case appends for that wrap: the delivered
  // load lands, and the same row carries the cart homeward.
  const advance: EngineEvent = {
    type: "CaravanAdvanced",
    actor: 0,
    routeId: "route0",
    caravan: {
      phase: "toHome",
      cargo: 0,
      path: [
        { q: 10, r: 2 },
        { q: 9, r: 2 },
        { q: 8, r: 2 },
        { q: 7, r: 2 },
        { q: 6, r: 2 },
        { q: 5, r: 2 },
      ],
      pathIndex: 3,
      anchored: true,
    },
    loaded: 0,
    delivered: 50,
  };
  const server: FakeServer = { game: makeGameRow(name, outwardRoute(), 1), events: [], calls: [] };
  installFetch(server);
  setInMemoryLocalPlayerId(name, 1);

  const clientState = hydrateGameState(makeGameRow(name, outwardRoute(), 1));
  assert.equal(clientState.tradeRoutes?.[0].caravan?.phase, "toDestination", "fixture: the client starts on the outbound leg");
  const h = harness(clientState, 1);
  const sync = new MultiplayerSync();
  // Seeded at cursor 1, so the frame below is the client's first news of that
  // wrap: nothing else can carry it.
  sync.start(name, { state: clientState, cursor: 1 });

  FakeEventSource.latest().dispatchLog(row(2, advance, 0), "2");
  await tick();

  assert.equal(
    h.held()?.caravan?.phase,
    "toHome",
    "the listening client's live state must hold the turn for home, not the stale outbound leg",
  );
  assert.equal(h.held()?.caravan?.cargo, 0, "the delivery emptied the cart in the client's own state too");
  assert.equal(h.held()?.caravan?.anchored, true);
  assert.equal(
    h.replaces.length,
    1,
    "exactly one merge for the row -- the delta reached the controller through the normal path",
  );
  assert.deepEqual(
    server.calls.filter((call) => call.endsWith(`/api/games/${name}`)),
    [],
    "and it took no refetch: the stream row was enough",
  );
  h.detach();
  sync.stop();
});

test("a redelivered CaravanAdvanced row is a noop -- the client keeps the record it already holds", async () => {
  const name = "caravan-mp-noop";
  const advance: EngineEvent = {
    type: "CaravanAdvanced",
    actor: 0,
    routeId: "route0",
    caravan: {
      phase: "toHome",
      cargo: 0,
      path: [
        { q: 10, r: 2 },
        { q: 9, r: 2 },
        { q: 8, r: 2 },
        { q: 7, r: 2 },
        { q: 6, r: 2 },
        { q: 5, r: 2 },
      ],
      pathIndex: 3,
      anchored: true,
    },
    loaded: 0,
    delivered: 50,
  };
  const server: FakeServer = { game: makeGameRow(name, outwardRoute(), 1), events: [], calls: [] };
  installFetch(server);
  setInMemoryLocalPlayerId(name, 1);

  const clientState = hydrateGameState(makeGameRow(name, outwardRoute(), 1));
  const h = harness(clientState, 1);
  const sync = new MultiplayerSync();
  sync.start(name, { state: clientState, cursor: 1 });

  FakeEventSource.latest().dispatchLog(row(2, advance, 0), "2");
  await tick();
  const afterFirst = h.replaces.length;
  assert.equal(afterFirst, 1);

  // The same record again, on a higher id (a reconnect replay): the applier
  // finds the route already holding it and reports a noop, so no merge is
  // published and nothing re-renders.
  FakeEventSource.latest().dispatchLog(row(3, advance, 0), "3");
  await tick();
  assert.equal(h.replaces.length, afterFirst, "a duplicate record is not a second state change");
  assert.equal(sync.getCursor(), 3, "the row still advanced the cursor");
  h.detach();
  sync.stop();
});

test("a CaravanAdvanced row naming a route this client does not hold refetches instead of inventing one", async () => {
  const name = "caravan-mp-drift";
  const advance: EngineEvent = {
    type: "CaravanAdvanced",
    actor: 0,
    routeId: "route9",
    caravan: { phase: "toHome", cargo: 0, path: [{ q: 9, r: 2 }], pathIndex: 1, anchored: true },
    loaded: 0,
    delivered: 50,
  };
  const server: FakeServer = { game: makeGameRow(name, outwardRoute(), 1), events: [], calls: [] };
  installFetch(server);
  setInMemoryLocalPlayerId(name, 1);

  const clientState = hydrateGameState(makeGameRow(name, outwardRoute(), 1));
  const h = harness(clientState, 1);
  const sync = new MultiplayerSync();
  sync.start(name, { state: clientState, cursor: 1 });

  FakeEventSource.latest().dispatchLog(row(2, advance, 0), "2");
  await tick();

  assert.equal(
    server.calls.filter((call) => call.endsWith(`/api/games/${name}`)).length,
    1,
    "an unknown route is drift, so the client refetches rather than fabricating a route",
  );
  assert.equal(h.held()?.id, "route0", "and its state still holds only the route the server really has");
  h.detach();
  sync.stop();
});
