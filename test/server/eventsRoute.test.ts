import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { pool } from "../../server/persistence/db";
import { router } from "../../server/routes";
import { errorHandler } from "../../server/errorHandler";

// Real Express app + real Postgres (same pattern server/index.ts wires up),
// not a mocked route -- the thing under test is the SQL WHERE clause and
// query-param parsing/validation, which mocks would just re-describe.
let server: Server;
let baseUrl: string;

before(async () => {
  const app = express();
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
  return `test-events-route-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function seedGame(name: string): Promise<void> {
  await pool.query(
    `INSERT INTO games (name, seed, hero_q, hero_r) VALUES ($1, $2, $3, $4)`,
    [name, 1, 0, 0],
  );
}

async function seedEvents(name: string, count: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const r = await pool.query<{ id: number }>(
      `INSERT INTO game_events (game_id, kind, payload)
       SELECT id, $2, $3::jsonb FROM games WHERE name = $1
       RETURNING id`,
      [name, `test_kind_${i}`, JSON.stringify({ i })],
    );
    ids.push(r.rows[0].id);
  }
  return ids;
}

// Cascades to game_events (schema.sql: game_id ... ON DELETE CASCADE).
async function cleanupGame(name: string): Promise<void> {
  await pool.query(`DELETE FROM games WHERE name = $1`, [name]);
}

test("GET /games/:name/events with no ?after returns the whole log, oldest first", async () => {
  const name = uniqueName();
  await seedGame(name);
  const ids = await seedEvents(name, 3);
  try {
    const res = await fetch(`${baseUrl}/games/${name}/events`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { id: number }[];
    assert.deepEqual(body.map((e) => e.id), ids);
  } finally {
    await cleanupGame(name);
  }
});

test("GET /games/:name/events?after=0 behaves the same as no cursor", async () => {
  const name = uniqueName();
  await seedGame(name);
  const ids = await seedEvents(name, 2);
  try {
    const res = await fetch(`${baseUrl}/games/${name}/events?after=0`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { id: number }[];
    assert.deepEqual(body.map((e) => e.id), ids);
  } finally {
    await cleanupGame(name);
  }
});

test("GET /games/:name/events?after=<mid-log id> returns only events after the cursor", async () => {
  const name = uniqueName();
  await seedGame(name);
  const ids = await seedEvents(name, 3);
  try {
    const res = await fetch(`${baseUrl}/games/${name}/events?after=${ids[0]}`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { id: number }[];
    assert.deepEqual(body.map((e) => e.id), ids.slice(1));
  } finally {
    await cleanupGame(name);
  }
});

test("GET /games/:name/events?after=<id past the end> returns an empty array, not 404", async () => {
  const name = uniqueName();
  await seedGame(name);
  const ids = await seedEvents(name, 2);
  try {
    const res = await fetch(`${baseUrl}/games/${name}/events?after=${ids[ids.length - 1]}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, []);
  } finally {
    await cleanupGame(name);
  }
});

test("GET /games/:name/events?after=<non-numeric> is rejected with 400, not silently ignored", async () => {
  const name = uniqueName();
  await seedGame(name);
  try {
    const res = await fetch(`${baseUrl}/games/${name}/events?after=not-a-number`);
    assert.equal(res.status, 400);
  } finally {
    await cleanupGame(name);
  }
});

test("GET /games/:name/events?after=-1 is rejected with 400 (not a non-negative integer)", async () => {
  const name = uniqueName();
  await seedGame(name);
  try {
    const res = await fetch(`${baseUrl}/games/${name}/events?after=-1`);
    assert.equal(res.status, 400);
  } finally {
    await cleanupGame(name);
  }
});

test("GET /games/:name/events returns actor_seat, the column #144 wrote and nothing read", async () => {
  const name = uniqueName();
  await seedGame(name);
  try {
    await pool.query(
      `INSERT INTO game_events (game_id, kind, payload, actor_seat)
       SELECT id, 'HeroMoved', '{"type":"HeroMoved"}'::jsonb, 2 FROM games WHERE name = $1`,
      [name],
    );
    await pool.query(
      `INSERT INTO game_events (game_id, kind, payload, actor_seat)
       SELECT id, 'round_started', '{"round":2}'::jsonb, NULL FROM games WHERE name = $1`,
      [name],
    );
    const res = await fetch(`${baseUrl}/games/${name}/events`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { kind: string; actor_seat: number | null }[];
    assert.deepEqual(
      body.map((e) => [e.kind, e.actor_seat]),
      [["HeroMoved", 2], ["round_started", null]],
    );
  } finally {
    await cleanupGame(name);
  }
});

test("GET /games/:name returns last_event_id, the cursor a fresh client load seeds from", async () => {
  const name = uniqueName();
  await seedGame(name);
  try {
    const empty = await fetch(`${baseUrl}/games/${name}`);
    assert.equal(empty.status, 200);
    assert.equal(((await empty.json()) as { last_event_id: string }).last_event_id, "0");

    const ids = await seedEvents(name, 3);
    const res = await fetch(`${baseUrl}/games/${name}`);
    const body = (await res.json()) as { last_event_id: string };
    assert.equal(Number(body.last_event_id), Number(ids[ids.length - 1]));

    const after = await fetch(`${baseUrl}/games/${name}/events?after=${body.last_event_id}`);
    assert.deepEqual(await after.json(), [], "seeding from it means the first poll replays nothing");
  } finally {
    await cleanupGame(name);
  }
});
