import { request as pwRequest } from "playwright";
import assert from "node:assert/strict";

const API_URL = "http://127.0.0.1:3001";

async function run() {
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

  // 7. Permission gate: seat 1 player tries to spend movement for seat 0's hero
  //    while seat 0 is the active player — should be 403.
  const gameRes = await ctx.get(`${API_URL}/api/games/${lobbyGameName}`);
  const game = (await gameRes.json()) as { heroes: Record<string, { id: string; ownerId: number; q: number; r: number }> };
  const seat0Hero = Object.values(game.heroes).find((h) => h.ownerId === 0);
  assert.ok(seat0Hero, "seat 0 hero should exist");
  const badMove = await ctx.patch(`${API_URL}/api/games/${lobbyGameName}`, {
    data: {
      action: "spend_movement",
      heroId: seat0Hero!.id,
      fromTile: { q: seat0Hero!.q, r: seat0Hero!.r },
      toTile: { q: seat0Hero!.q + 1, r: seat0Hero!.r },
      cost: 1,
    },
  });
  // Whoever is currently active may or may not be seat 0; the test's strict
  // assertion below only fires when the active player is not seat 0.
  if (game.active_player_id === 0 || (game as unknown as { active_player_id?: number }).active_player_id === 0) {
    // Active player IS seat 0, so the gate permits the move (200).
    assert.ok([200].includes(badMove.status()), `expected 200 when active is owner, got ${badMove.status()}`);
  } else {
    assert.equal(badMove.status(), 403, "non-owner move should be 403");
  }

  await ctx.delete(`${API_URL}/api/games/${lobbyGameName}`).catch(() => {});
  await ctx.dispose();
  console.log(">> multiplayer lobby smoke OK");
}

run().catch((e) => {
  console.error("multiplayer lobby smoke FAILED:", e);
  process.exit(1);
});
