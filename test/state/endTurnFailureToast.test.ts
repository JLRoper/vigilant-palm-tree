import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildTurnHooks } from "../../src/game/turnHooks";
import { bus } from "../../src/core/eventBus";
import { makeState } from "../charter/_helpers";

// Regression: onHumanTurnEnd swallowed EVERY EndTurn POST failure (403
// forbidden_not_your_turn / actor_mismatch / ai_seat_command_forbidden, a 5xx,
// the 10s TimeoutError) into a console.warn and returned the identical state --
// so the End Turn click was completely invisible while the toolbar still looked
// live. reportCommandFailure is what makes attachCommandFailureToasts
// (src/screens/shared/toast.ts) show the player something; this hook is the one
// that was missing it.
//
// The bus event is the seam under test: toast.ts is DOM-bound, and the bus
// event is exactly what it consumes ("${action} failed: ${reason}").

// turnHooks -> io/multiplayerSync -> render/entityMirror reach for window, and
// settings/api read localStorage. Installed before the hooks run.
const savedWindow = (globalThis as { window?: unknown }).window;
const savedFetch = (globalThis as { fetch?: unknown }).fetch;

function hooks() {
  return buildTurnHooks({
    gameName: () => "g1",
    gameMap: () => ({}) as never,
    rng: () => 0.5,
  });
}

// The failure path re-starts the multiplayer sync, which immediately fetches
// GET /api/games/g1 and then its event poll. Only the EndTurn POST is scripted;
// every other request gets a minimal answer so the test's own cleanup does not
// throw and bury the assertion output.
function installFetch(endTurnPost: () => Promise<Response>): void {
  const state = makeState();
  (globalThis as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith("/commands")) return endTurnPost();
    if (path.includes("/events?after=")) return new Response("[]", { status: 200 });
    if (path.includes("/telemetry")) return new Response("{}", { status: 200 });
    return new Response(
      JSON.stringify({
        id: 1,
        name: "g1",
        seed: 1,
        hero_q: 2,
        hero_r: 2,
        turn: 1,
        gold: 0,
        enemy_positions: [],
        created_at: "2026-10-01T00:00:00.000Z",
        updated_at: "2026-10-01T00:00:00.000Z",
        round: 1,
        day: 1,
        active_player_id: 0,
        map_size: "small",
        players: state.players,
        heroes: state.heroes,
        settlements: state.settlements,
        last_event_id: "0",
        lobby: {},
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
}

function commandFailure(status: number, body: unknown): () => Promise<Response> {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

function captureRejections(): Array<{ action?: unknown; reason?: unknown }> {
  const rejected: Array<{ action?: unknown; reason?: unknown }> = [];
  bus.on("command:rejected", (ev: { action?: unknown; reason?: unknown }) => rejected.push(ev));
  return rejected;
}

beforeEach(() => {
  bus.clear();
  (globalThis as { window: unknown }).window = {
    setInterval: () => 1,
    clearInterval: () => {},
    localStorage: undefined,
  };
});

afterEach(() => {
  if (savedWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window: unknown }).window = savedWindow;
  if (savedFetch === undefined) delete (globalThis as { fetch?: unknown }).fetch;
  else (globalThis as { fetch: unknown }).fetch = savedFetch;
  bus.clear();
});

test("a 403 on End Turn reports a failure the player can see", async () => {
  installFetch(commandFailure(403, { error: "forbidden_not_your_turn" }));
  const rejected = captureRejections();

  const state = makeState();
  const next = await hooks().onHumanTurnEnd(state);

  assert.equal(rejected.length, 1, "the failure is reported, not swallowed");
  assert.equal(rejected[0].action, "End turn");
  assert.equal(rejected[0].reason, "forbidden_not_your_turn", "the server's reason reaches the toast verbatim");
  assert.equal(next, state, "the state is still returned unchanged (no optimistic end-turn ran)");
});

test("ai_seat_command_forbidden is surfaced too (the server-driven AI route)", async () => {
  installFetch(commandFailure(403, { error: "ai_seat_command_forbidden" }));
  const rejected = captureRejections();

  await hooks().onHumanTurnEnd(makeState());

  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].action, "End turn");
  assert.equal(rejected[0].reason, "ai_seat_command_forbidden");
});

test("a 5xx is surfaced as well", async () => {
  installFetch(commandFailure(503, { error: "upstream_unavailable" }));
  const rejected = captureRejections();

  await hooks().onHumanTurnEnd(makeState());

  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, "upstream_unavailable");
});

test("a network-level failure (the 10s TimeoutError shape) is surfaced with its message", async () => {
  installFetch(async () => {
    throw new Error("request timed out after 10000ms");
  });
  const rejected = captureRejections();

  await hooks().onHumanTurnEnd(makeState());

  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, "request timed out after 10000ms");
});

test("a successful End Turn reports nothing", async () => {
  const state = makeState();
  installFetch(
    async () =>
      new Response(
        JSON.stringify({
          round: 1,
          day: 2,
          activePlayerId: 1,
          players: state.players,
          heroes: state.heroes,
          settlements: state.settlements,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  );
  const rejected = captureRejections();

  await hooks().onHumanTurnEnd(state);

  assert.deepEqual(rejected, [], "no toast on the happy path");
});