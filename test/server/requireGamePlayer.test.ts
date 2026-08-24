import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { pool } from "../../server/persistence/db";
import { requireAuth } from "../../server/auth";
import { requireGamePlayer, invalidateMembershipCache } from "../../server/middleware/requireGamePlayer";
import { router } from "../../server/routes";
import { errorHandler } from "../../server/errorHandler";
import { loginViaMagicLink, loginAndClaim, uniqueTestEmail, authHeader } from "../helpers/authFlow";

// Real Express app + real Postgres, same harness pattern as
// commandsRoute.test.ts/eventsRoute.test.ts -- requireGamePlayer's whole job
// is a SQL lookup plus an in-process cache, so a mock would just re-describe
// the query instead of testing it.
let server: Server;
let baseUrl: string;

before(async () => {
  const app = express();
  app.use(express.json());
  // Minimal probe route: proves req.playerSeat made it through.
  app.get("/api/games/:name/probe", requireAuth, requireGamePlayer, (req, res) => {
    res.json({ playerSeat: req.playerSeat });
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
  return `test-require-game-player-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

test("requireGamePlayer 404s when the game doesn't exist", async () => {
  const token = await loginViaMagicLink(baseUrl, uniqueTestEmail("no-game"));
  const res = await fetch(`${baseUrl}/games/does-not-exist-${Date.now()}/probe`, {
    headers: authHeader(token),
  });
  assert.equal(res.status, 404);
});

test("requireGamePlayer 403s an authenticated caller who hasn't claimed a seat", async () => {
  const name = uniqueName();
  await seedGame(name);
  try {
    const token = await loginViaMagicLink(baseUrl, uniqueTestEmail("stranger"));
    const res = await fetch(`${baseUrl}/games/${name}/probe`, { headers: authHeader(token) });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "not_a_player" });
  } finally {
    await cleanupGame(name);
  }
});

test("requireGamePlayer 401s a request with no Authorization header at all", async () => {
  const name = uniqueName();
  await seedGame(name);
  try {
    const res = await fetch(`${baseUrl}/games/${name}/probe`);
    assert.equal(res.status, 401);
  } finally {
    await cleanupGame(name);
  }
});

test("requireGamePlayer sets req.playerSeat for a caller who claimed that seat", async () => {
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

test("requireGamePlayer resolves the right seat when multiple are claimed", async () => {
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

test("requireGamePlayer's membership cache reflects a claim made after invalidateMembershipCache", async () => {
  const name = uniqueName();
  await seedGame(name);
  try {
    const token = await loginViaMagicLink(baseUrl, uniqueTestEmail("late-claimer"));
    // First hit populates the cache with "no claimed seats yet" (a real 403).
    const before403 = await fetch(`${baseUrl}/games/${name}/probe`, { headers: authHeader(token) });
    assert.equal(before403.status, 403);

    await fetch(`${baseUrl}/games/${name}/lobby/claim`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeader(token) },
      body: JSON.stringify({ seat: 0, handle: "late-claimer" }),
    });
    // lobby/claim calls invalidateMembershipCache itself (server/routes.ts),
    // so this should see the fresh claim immediately, not after the 5s TTL.
    const after = await fetch(`${baseUrl}/games/${name}/probe`, { headers: authHeader(token) });
    assert.equal(after.status, 200);
    assert.deepEqual(await after.json(), { playerSeat: 0 });
  } finally {
    invalidateMembershipCache(name);
    await cleanupGame(name);
  }
});
