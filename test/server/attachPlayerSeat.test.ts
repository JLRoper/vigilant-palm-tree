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
import { loginViaMagicLink, loginAndClaim, uniqueTestEmail, authHeader } from "../helpers/authFlow";

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
