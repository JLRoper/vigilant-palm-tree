import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { pool } from "../../server/persistence/db";
import { router } from "../../server/routes";
import { authRouter } from "../../server/auth";
import { errorHandler } from "../../server/errorHandler";
import { loginViaMagicLink, uniqueTestEmail } from "../helpers/authFlow";

let server: Server;
let baseUrl: string;

before(async () => {
  const migrationSql = readFileSync(
    new URL("../../server/migrations/029_users_and_stats.sql", import.meta.url),
    "utf8",
  );
  await pool.query(migrationSql);

  const app = express();
  app.use(express.json());
  app.use("/api", router);
  app.use("/api/auth", authRouter);
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

const EMAIL_PREFIX = "test-gamestats-";

function uniqueName(): string {
  return `test-gamestats-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function deleteByEmailPrefix(pattern: string): Promise<void> {
  await pool.query(
    `DELETE FROM user_sessions WHERE email LIKE $1 AND last_seen_at < now() - interval '1 hour'`,
    [pattern],
  );
  await pool.query(
    `DELETE FROM auth_codes WHERE email LIKE $1 AND created_at < now() - interval '1 hour'`,
    [pattern],
  );
  await pool.query(
    `DELETE FROM user_stats WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [pattern],
  );
  await pool.query(`DELETE FROM users WHERE email LIKE $1 AND created_at < now() - interval '1 hour'`, [pattern]);
}

async function cleanupGames(): Promise<void> {
  await pool.query(`DELETE FROM games WHERE name LIKE $1`, [`${EMAIL_PREFIX}%`]);
}

async function gamesStartedFor(email: string): Promise<{ games_started: number; last_played_at: Date | null } | null> {
  const r = await pool.query<{ games_started: number; last_played_at: Date | null }>(
    `SELECT games_started, last_played_at FROM user_stats WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
    [email],
  );
  return r.rows[0] ?? null;
}

async function createGame(name: string, token?: string): Promise<number> {
  const res = await fetch(`${baseUrl}/games`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ name, seed: 99, hero_q: 2, hero_r: 2, enemy_positions: [], mapSize: "small" }),
  });
  return res.status;
}

test("POST /games with a Bearer token counts games_started and stamps last_played_at", async () => {
  const email = uniqueTestEmail("gamestats");
  const token = await loginViaMagicLink(baseUrl, email);
  const first = uniqueName();
  const second = uniqueName();
  try {
    assert.equal(await createGame(first, token), 201);
    const stats1 = await gamesStartedFor(email);
    assert.notEqual(stats1, null, "signed-in create must create a user_stats row");
    assert.equal(stats1?.games_started, 1);
    assert.notEqual(stats1?.last_played_at, null);

    assert.equal(await createGame(second, token), 201);
    const stats2 = await gamesStartedFor(email);
    assert.equal(stats2?.games_started, 2);
  } finally {
    await cleanupGames();
    await deleteByEmailPrefix(`${EMAIL_PREFIX}%@example.com`);
  }
});

test("POST /games without a token stays anonymous and leaves other users' counters untouched", async () => {
  const email = uniqueTestEmail("gamestats");
  const token = await loginViaMagicLink(baseUrl, email);
  const signedName = uniqueName();
  const anonName = uniqueName();
  try {
    assert.equal(await createGame(signedName, token), 201);
    const before = await gamesStartedFor(email);
    assert.equal(before?.games_started, 1);

    assert.equal(await createGame(anonName), 201);
    const after = await gamesStartedFor(email);
    assert.equal(after?.games_started, 1, "an anonymous create must not bump another user's counter");
  } finally {
    await cleanupGames();
    await deleteByEmailPrefix(`${EMAIL_PREFIX}%@example.com`);
  }
});
