import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { pool } from "../../server/persistence/db";
import { attachAuth } from "../../server/auth";
import { attachPlayerSeat, invalidateMembershipCache } from "../../server/middleware/attachPlayerSeat";
import { router } from "../../server/routes";
import { errorHandler } from "../../server/errorHandler";
import { loginViaMagicLink, loginAndClaim, claimSeat, uniqueTestEmail, authHeader } from "../helpers/authFlow";

// Real Express app + real Postgres, same harness pattern as
// commandsRoute.test.ts/eventsRoute.test.ts -- attachPlayerSeat's whole job
// is a SQL lookup plus an in-process cache, so a mock would just re-describe
// the query instead of testing it.
let server: Server;
let baseUrl: string;

before(async () => {
  const app = express();
  app.use(express.json());
  // Minimal probe route: proves req.playerSeat made it through (or didn't).
  app.get("/api/games/:name/probe", attachAuth, attachPlayerSeat, (req, res) => {
    res.json({ playerSeat: req.playerSeat ?? null });
  });
  app.use("/api", router);
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

function uniqueName(): string {
  return `test-attach-player-seat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function seedGame(name: string, seats = 1): Promise<void> {
  await pool.query(
    `INSERT INTO games (name, seed, hero_q, hero_r, lobby) VALUES ($1, 1, 0, 0, $2::jsonb)`,
    [name, JSON.stringify({ seats })],
  );
}

async function cleanupGame(name: string): Promise<void> {
  await pool.query(`DELETE FROM games WHERE name = $1`, [name]);
}

// Sign-in is optional (issue #179 follow-up): attachAuth/attachPlayerSeat
// never reject a request. These pin the "never blocks" half of that.

test("attachPlayerSeat never rejects a request with no Authorization header", async () => {
  const name = uniqueName();
  await seedGame(name);
  try {
    const res = await fetch(`${baseUrl}/games/${name}/probe`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { playerSeat: null });
  } finally {
    await cleanupGame(name);
  }
});

test("attachPlayerSeat never rejects an authenticated caller who hasn't claimed a seat", async () => {
  const name = uniqueName();
  await seedGame(name);
  try {
    const token = await loginViaMagicLink(baseUrl, uniqueTestEmail("stranger"));
    const res = await fetch(`${baseUrl}/games/${name}/probe`, { headers: authHeader(token) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { playerSeat: null });
  } finally {
    await cleanupGame(name);
  }
});

test("attachPlayerSeat never rejects a request against a nonexistent game", async () => {
  const token = await loginViaMagicLink(baseUrl, uniqueTestEmail("no-game"));
  const res = await fetch(`${baseUrl}/games/does-not-exist-${Date.now()}/probe`, {
    headers: authHeader(token),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { playerSeat: null });
});

test("attachPlayerSeat sets req.playerSeat for a caller who claimed that seat", async () => {
  const name = uniqueName();
  await seedGame(name);
  try {
    const token = await loginAndClaim(baseUrl, name, 0);
    const res = await fetch(`${baseUrl}/games/${name}/probe`, { headers: authHeader(token) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { playerSeat: 0 });
  } finally {
    await cleanupGame(name);
  }
});

test("attachPlayerSeat resolves the right seat when multiple are claimed", async () => {
  const name = uniqueName();
  await seedGame(name, 2);
  try {
    const token0 = await loginAndClaim(baseUrl, name, 0, "seat0");
    const token1 = await loginAndClaim(baseUrl, name, 1, "seat1");
    const res0 = await fetch(`${baseUrl}/games/${name}/probe`, { headers: authHeader(token0) });
    const res1 = await fetch(`${baseUrl}/games/${name}/probe`, { headers: authHeader(token1) });
    assert.deepEqual(await res0.json(), { playerSeat: 0 });
    assert.deepEqual(await res1.json(), { playerSeat: 1 });
  } finally {
    await cleanupGame(name);
  }
});

test("attachPlayerSeat's membership cache reflects a claim made after invalidateMembershipCache", async () => {
  const name = uniqueName();
  await seedGame(name);
  try {
    const token = await loginViaMagicLink(baseUrl, uniqueTestEmail("late-claimer"));
    // First hit populates the cache with "no claimed seats yet".
    const before = await fetch(`${baseUrl}/games/${name}/probe`, { headers: authHeader(token) });
    assert.deepEqual(await before.json(), { playerSeat: null });

    await fetch(`${baseUrl}/games/${name}/lobby/claim`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader(token) },
      body: JSON.stringify({ seat: 0, handle: "late-claimer" }),
    });
    // lobby/claim calls invalidateMembershipCache itself (server/routes.ts),
    // so this should see the fresh claim immediately, not after the 5s TTL.
    const after = await fetch(`${baseUrl}/games/${name}/probe`, { headers: authHeader(token) });
    assert.deepEqual(await after.json(), { playerSeat: 0 });
  } finally {
    invalidateMembershipCache(name);
    await cleanupGame(name);
  }
});

test("POST /games/:name/lobby/claim succeeds for an anonymous (not signed in) caller", async () => {
  const name = uniqueName();
  await seedGame(name);
  try {
    const res = await fetch(`${baseUrl}/games/${name}/lobby/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seat: 0, handle: "anon-claimer" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { lobby: { claimed: Record<string, { handle: string; email?: string }> } };
    assert.equal(body.lobby.claimed["0"].handle, "anon-claimer");
    assert.equal(body.lobby.claimed["0"].email, undefined);
  } finally {
    await cleanupGame(name);
  }
});

// Drop-policy rejoin reclaim (docs/multiplayer.md, shipped 2026-09-27):
// a STARTED game's email-bound seat can be reclaimed by the same
// identity, so a closed laptop can rejoin without a new seat. Everything
// else about started-game claims stays rejected.

async function startLobby(name: string, token: string): Promise<void> {
  const res = await fetch(`${baseUrl}/games/${name}/lobby/start`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeader(token) },
    body: "{}",
  });
  assert.equal(res.status, 200, `lobby/start should succeed: ${res.status}`);
}

test("lobby claim on a STARTED game reclaims the email-bound seat for the same identity", async () => {
  const name = uniqueName();
  await seedGame(name, 1);
  try {
    const email = uniqueTestEmail("rejoiner");
    const token = await loginViaMagicLink(baseUrl, email);
    await claimSeat(baseUrl, token, name, 0, "original");
    await startLobby(name, token);

    const reclaimRes = await fetch(`${baseUrl}/games/${name}/lobby/claim`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader(token) },
      body: JSON.stringify({ seat: 0, handle: "rejoined" }),
    });
    assert.equal(reclaimRes.status, 200, "the same email must be able to reclaim its seat");
    const body = (await reclaimRes.json()) as {
      lobby: { claimed: Record<string, { handle: string; email?: string }>; startedAt?: string };
    };
    assert.equal(body.lobby.claimed["0"].handle, "rejoined", "the handle refreshes on reclaim");
    assert.equal(body.lobby.claimed["0"].email, email, "the email binding is re-asserted");
    assert.ok(body.lobby.startedAt, "the game stays started through a reclaim");
  } finally {
    await cleanupGame(name);
  }
});

test("a different signed-in identity cannot reclaim someone else's started-game seat", async () => {
  const name = uniqueName();
  await seedGame(name, 1);
  try {
    const ownerToken = await loginAndClaim(baseUrl, name, 0, "owner");
    await startLobby(name, ownerToken);

    const strangerToken = await loginViaMagicLink(baseUrl, uniqueTestEmail("stranger"));
    const res = await fetch(`${baseUrl}/games/${name}/lobby/claim`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader(strangerToken) },
      body: JSON.stringify({ seat: 0, handle: "stranger" }),
    });
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { error: string }).error, "lobby_already_started");
  } finally {
    await cleanupGame(name);
  }
});

test("an anonymous caller cannot reclaim an email-bound seat on a started game", async () => {
  const name = uniqueName();
  await seedGame(name, 1);
  try {
    const ownerToken = await loginAndClaim(baseUrl, name, 0, "bound-owner");
    await startLobby(name, ownerToken);

    const res = await fetch(`${baseUrl}/games/${name}/lobby/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seat: 0, handle: "anon-rejoiner" }),
    });
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { error: string }).error, "lobby_already_started");
  } finally {
    await cleanupGame(name);
  }
});

test("handle-only (anonymous) claims cannot be reclaimed after start, and unclaimed seats stay unclaimable", async () => {
  const name = uniqueName();
  await seedGame(name, 2);
  try {
    // Anonymous claim for seat 0; force-start via SQL so seat 1 stays open.
    await fetch(`${baseUrl}/games/${name}/lobby/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seat: 0, handle: "anon-only" }),
    });
    await pool.query(`UPDATE games SET lobby = jsonb_set(lobby, '{startedAt}', to_jsonb(now())) WHERE name = $1`, [name]);

    const anonReclaim = await fetch(`${baseUrl}/games/${name}/lobby/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seat: 0, handle: "anon-again" }),
    });
    assert.equal(anonReclaim.status, 409, "a handle-only claim cannot rebind");

    const freshSeat = await loginViaMagicLink(baseUrl, uniqueTestEmail("fresh-seat"));
    const freshRes = await fetch(`${baseUrl}/games/${name}/lobby/claim`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader(freshSeat) },
      body: JSON.stringify({ seat: 1, handle: "late" }),
    });
    assert.equal(freshRes.status, 409, "a brand-new seat still cannot be claimed after start");
    assert.equal(((await freshRes.json()) as { error: string }).error, "lobby_already_started");
  } finally {
    await cleanupGame(name);
  }
});
