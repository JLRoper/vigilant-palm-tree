// The multiplayer lobby's host panel asked the player to pick a seat count and
// then never sent it. Create Lobby handed api.createGame only the human count,
// so the server built the lobby's seats from that count -- server/routes.ts:
// `const explicitSeats = lobbyObj && Number.isInteger(lobbyObj.seats) ? ... ;
//  const seats = explicitSeats ?? (humanCount !== null ? humanCount : null);`
// -- and `explicitSeats` is `lobby.seats` off the request body, which no client
// has ever sent. A host who picked 4 seats with 2 human players got a TWO-seat
// lobby, which is why the chip row's label had to be hedged to "Maximum seats"
// in the first place.
//
// This drives the real screen (createMultiplayerLobby) over the hand-rolled DOM
// stand-in the other screen suites use and reads the create REQUEST BODY -- the
// wire the server actually sees -- so the chip's promise is pinned end to end
// rather than in the handler's local variables.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  installDom,
  restoreDom,
  findAll,
  findByText,
  textOf,
  type MockElement,
} from "../../helpers/mockDom";
import { createMultiplayerLobby } from "../../../src/screens/multiplayer/multiplayerLobby";

type PostRecord = { url: string; body: Record<string, unknown> };

let body: MockElement;
let posted: PostRecord[];
/** The row the stubbed API answers every request with. */
let row: Record<string, unknown>;

function seatLobbyRow(claimedSeats: number[]): Record<string, unknown> {
  const claimed: Record<string, { handle: string; claimedAt: string }> = {};
  for (const seat of claimedSeats) {
    claimed[String(seat)] = { handle: seat === 0 ? "Host" : `Player ${seat + 1}`, claimedAt: "2026-11-03T00:00:00.000Z" };
  }
  return {
    id: 1,
    name: "seat-test-lobby",
    seed: 7,
    hero_q: 4,
    hero_r: 4,
    gold: 0,
    enemy_positions: [],
    created_at: "2026-11-03T00:00:00.000Z",
    updated_at: "2026-11-03T00:00:00.000Z",
    round: 1,
    day: 1,
    active_player_id: 0,
    players: [
      { id: 0, name: "Host", color: "#d62828", faction: "player", heroIds: [] },
      { id: 1, name: "Player 2", color: "#1d7dd1", faction: "player", heroIds: [] },
      { id: 2, name: "AI 3", color: "#2a9d8f", faction: "ai", heroIds: [] },
      { id: 3, name: "AI 4", color: "#f77f00", faction: "ai", heroIds: [] },
    ],
    heroes: {},
    settlements: {},
    lobby: { seats: 4, humanSlots: 2, claimed },
  };
}

function makeResponse(payload: unknown): unknown {
  return {
    ok: true,
    status: 201,
    statusText: "Created",
    json: async () => payload,
    text: async () => "",
  };
}

function seatChip(n: number): MockElement {
  const group = findAll(body, (el) => el.getAttribute("role") === "group")[0];
  assert.ok(group, "the seat chip row carries a role=group of its own");
  const chip = findAll(group, (el) => el.tagName === "BUTTON" && el.textContent === String(n))[0];
  assert.ok(chip, `the chip row offers a ${n}-seat choice`);
  return chip;
}

/** The numeric human-player input: the named control that takes typing. */
function humanCountInput(): MockElement {
  const input = findAll(
    body,
    (el) => el.tagName === "INPUT" && /human player/i.test(el.getAttribute("aria-label") ?? ""),
  )[0];
  assert.ok(input, "the human-player count input carries its own accessible name");
  return input;
}

function button(label: string): MockElement {
  const found = findByText(body, "BUTTON", label);
  assert.ok(found, `the lobby has a "${label}" button`);
  return found;
}

/** Picks `seats` and `humans`, clicks Create Lobby, and waits for the POST. */
async function createLobby(seats: number, humans: number): Promise<PostRecord> {
  seatChip(seats).click();
  const input = humanCountInput();
  input.value = String(humans);
  button("Create Lobby").click();
  const deadline = Date.now() + 30_000;
  let create: PostRecord | undefined;
  while (!create && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
    create = posted.find((p) => p.url.endsWith("/api/games"));
  }
  assert.ok(create, `Create Lobby must POST /api/games; posted ${JSON.stringify(posted.map((p) => p.url))}`);
  return create;
}

beforeEach(() => {
  posted = [];
  row = seatLobbyRow([0, 1]);
  const dom = installDom({
    fetchImpl: (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && typeof init.body === "string") {
        posted.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
      }
      return makeResponse(row);
    },
  });
  // The lobby polls the created game on an interval; the stand-in has no timer.
  const win = dom.window as {
    setInterval?: (fn: () => void, ms: number) => number;
    clearInterval?: (handle?: number) => void;
  };
  win.setInterval = () => 0;
  win.clearInterval = () => {};
  body = dom.body;
  createMultiplayerLobby({
    isBackendOk: () => true,
    onEnterGame: () => {},
    onJoinGame: async () => {},
  });
});

afterEach(() => {
  body.replaceChildren();
  restoreDom();
});

test("a 4-seat pick with 2 human players sends the seat count and the 2 AI seats that fill it", async () => {
  const create = await createLobby(4, 2);
  assert.equal(create.body.humanSlots, 2, "the human count the player typed is sent as the human count");
  assert.deepEqual(
    create.body.lobby,
    { seats: 4 },
    "the seat chip row's own choice is sent, or the server builds seats = humanCount (server/routes.ts)",
  );
  assert.equal(
    create.body.enemySlots,
    2,
    "the seats no human fills are AI combatant seats, so the lobby really has the 4 seats it promised",
  );
});

test("the 2-seat, 2-human pick keeps the humans-only create body", async () => {
  const create = await createLobby(2, 2);
  assert.equal(create.body.humanSlots, 2, "the human count is unchanged");
  assert.deepEqual(create.body.lobby, { seats: 2 }, "the seat count is still sent -- on this pick it equals the human count");
  assert.equal(create.body.enemySlots, 0, "the default pick adds no AI seats");
});

test("the lobby grid names its AI combatant seats, and Start waits on the human seats only", async () => {
  // Seats 0 and 1 claimed by humans, 2 and 3 filled by AI: the lobby is full.
  await createLobby(4, 2);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(findByText(body, "DIV", "Seat 2 — AI"), "an AI combatant seat is not rendered as an open seat");
  assert.ok(findByText(body, "DIV", "Seat 3 — AI"), "every AI seat is named");
  assert.equal(button("Start Game").disabled, false, "AI seats hold nobody's place: the human seats are all claimed");

  // The same lobby with seat 1 still unclaimed: Start must still wait.
  posted = [];
  body.replaceChildren();
  row = seatLobbyRow([0]);
  createMultiplayerLobby({
    isBackendOk: () => true,
    onEnterGame: () => {},
    onJoinGame: async () => {},
  });
  await createLobby(4, 2);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(findByText(body, "DIV", "Seat 1 — open"), "an unclaimed human seat reads open");
  assert.ok(textOf(button("Start Game")).length > 0, "the start gate is on the human seats");
  assert.equal(button("Start Game").disabled, true, "an unclaimed human seat still blocks the start");
});
