import { request as pwRequest } from "playwright";
import { ChildProcess } from "node:child_process";
import assert from "node:assert/strict";
import { getApiPort, spawnLogged, waitForUrl, treeKill } from "./_request";

const API_PORT = getApiPort(3001);
const API_URL = `http://127.0.0.1:${API_PORT}`;

const api: { child?: ChildProcess } = {};
let cleaned = false;

function startApi(): ChildProcess {
  api.child = spawnLogged("api", "npx", ["tsx", "server/index.ts"], { API_PORT: String(API_PORT) });
  return api.child;
}

function cleanup(): void {
  if (cleaned) return;
  cleaned = true;
  if (api.child && api.child.pid != null) treeKill(api.child.pid);
}

process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(1); });
process.on("SIGTERM", () => { cleanup(); process.exit(1); });
process.on("uncaughtException", (err) => { console.error(err); cleanup(); process.exit(1); });

async function run() {
  startApi();
  await waitForUrl(`${API_URL}/api/health`);

  const ctx = await pwRequest.newContext();
  const lobbyGameName = `mp-smoke-${Date.now().toString(36)}`;

  // Clean up if it already exists from a previous failed run.
  await ctx.delete(`${API_URL}/api/games/${lobbyGameName}`).catch(() => {});

  // 1. Host creates a 2-player lobby with 2 human slots.
  const createRes = await ctx.post(`${API_URL}/api/games`, {
    data: {
      name: lobbyGameName,
      seed: 4242,
      hero_q: 4,
      hero_r: 4,
      enemy_positions: [],
      mapSize: "small",
      humanSlots: 2,
    },
  });
  assert.equal(createRes.status(), 201, "createGame should return 201");
  const created = (await createRes.json()) as { lobby: { seats: number; humanSlots: number; claimed: Record<string, unknown> } };
  assert.equal(created.lobby.seats, 2, "lobby should have 2 seats");
  assert.equal(created.lobby.humanSlots, 2, "lobby should mark 2 human slots");
  assert.deepEqual(created.lobby.claimed, {}, "no seats claimed yet");

  // 2. Joiner claims seat 1.
  const claim1 = await ctx.post(`${API_URL}/api/games/${lobbyGameName}/lobby/claim`, {
    data: { seat: 1, handle: "Joiner" },
  });
  assert.equal(claim1.status(), 200, "first claim should return 200");
  const afterClaim1 = (await claim1.json()) as { players: Array<{ id: number; name: string; faction: string }>; lobby: { claimed: Record<string, { handle: string }> } };
  assert.equal(afterClaim1.players.find((p) => p.id === 1)?.name, "Joiner");
  assert.equal(afterClaim1.players.find((p) => p.id === 1)?.faction, "player");
  assert.equal(afterClaim1.lobby.claimed["1"]?.handle, "Joiner");

  // 3. Trying to claim seat 1 again is rejected.
  const dupClaim = await ctx.post(`${API_URL}/api/games/${lobbyGameName}/lobby/claim`, {
    data: { seat: 1, handle: "Imposter" },
  });
  assert.equal(dupClaim.status(), 409, "duplicate claim should be 409");

  // 4. Trying to start with seat 0 unclaimed fails.
  const earlyStart = await ctx.post(`${API_URL}/api/games/${lobbyGameName}/lobby/start`, {
    data: {},
  });
  assert.equal(earlyStart.status(), 409, "start should fail with unclaimed seats");

  // 5. Host claims seat 0.
  const claim0 = await ctx.post(`${API_URL}/api/games/${lobbyGameName}/lobby/claim`, {
    data: { seat: 0, handle: "Host" },
  });
  assert.equal(claim0.status(), 200, "host claim should return 200");

  // 6. Start succeeds.
  const start = await ctx.post(`${API_URL}/api/games/${lobbyGameName}/lobby/start`, {
    data: {},
  });
  assert.equal(start.status(), 200, "start should return 200");
  const started = (await start.json()) as { lobby: { startedAt?: string } };
  assert.ok(started.lobby.startedAt, "startedAt should be set");

  // 7. Permission gate: POST /commands MoveHero, claiming to act as
  //    whichever seat is NOT the currently active player -- the
  //    turn-ownership guard in server/app/commandHandler.ts must reject
  //    with 403 regardless of which seat that happens to be, so this
  //    doesn't need to guess (or depend on) which seat the lobby started
  //    active. (Movement moved from PATCH /games/:name {action:
  //    "spend_movement"} to POST /games/:name/commands {kind: "MoveHero"}
  //    in Phase 3 Track A Week 2 -- see plan/2026-08-16-phase-3-parallel-dev-plan.md.)
  const gameRes = await ctx.get(`${API_URL}/api/games/${lobbyGameName}`);
  const game = (await gameRes.json()) as {
    active_player_id: number;
    heroes: Record<string, { id: string; ownerId: number; q: number; r: number }>;
  };
  const seat0Hero = Object.values(game.heroes).find((h) => h.ownerId === 0);
  assert.ok(seat0Hero, "seat 0 hero should exist");
  const nonActiveActor = game.active_player_id === 0 ? 1 : 0;
  const badMove = await ctx.post(`${API_URL}/api/games/${lobbyGameName}/commands`, {
    data: {
      kind: "MoveHero",
      actor: nonActiveActor,
      heroId: seat0Hero!.id,
      fromTile: { q: seat0Hero!.q, r: seat0Hero!.r },
      toTile: { q: seat0Hero!.q + 1, r: seat0Hero!.r },
      cost: 1,
    },
  });
  assert.equal(badMove.status(), 403, "non-active-player move should be 403");

  await ctx.delete(`${API_URL}/api/games/${lobbyGameName}`).catch(() => {});
  await ctx.dispose();
  console.log(">> multiplayer lobby smoke OK");
}

run().catch((e) => {
  console.error("multiplayer lobby smoke FAILED:", e);
  process.exit(1);
});
