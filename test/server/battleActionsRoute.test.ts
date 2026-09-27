import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { pool } from "../../server/persistence/db";
import { router } from "../../server/routes";
import { errorHandler } from "../../server/errorHandler";
import { loginAndClaim, authHeader } from "../helpers/authFlow";

// Route-level coverage for POST /games/:name/battle-actions -- the manual
// arena's live action stream (plan/2026-09-27-manual-battle-wiring.md, work
// item 4b) -- over real Express + real Postgres (same harness pattern as
// eventsRoute.test.ts / commandsRoute.test.ts). The route is deliberately
// telemetry-plain (no game-row lookup, no transaction), so what's actually
// under test is: the row lands in battle_actions with the server-stamped
// seat, the payload round-trips as jsonb, and malformed rows 400 instead of
// inserting garbage. Anonymous callers (no auth/claim) must still be able to
// post -- seat NULL, same convention as game_events.actor_seat.
let server: Server;
let baseUrl: string;

before(async () => {
  const app = express();
  app.use(express.json());
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
  return `test-battle-actions-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function cleanupGame(name: string): Promise<void> {
  await pool.query(`DELETE FROM battle_actions WHERE game_name = $1`, [name]);
}

async function postAction(name: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${baseUrl}/games/${name}/battle-actions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? authHeader(token) : {}) },
    body: JSON.stringify(body),
  });
}

function validRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    attackerId: "h0",
    defenderId: "h1",
    seq: 0,
    phase: "start",
    payload: { obstacleSeed: 12345, humanSide: "attacker", grid: { cols: 15, rows: 13 } },
    ...overrides,
  };
}

test("POST battle-actions inserts the seed row and reads back with the payload intact", async () => {
  const name = uniqueName();
  try {
    const res = await postAction(name, validRow());
    assert.equal(res.status, 201);
    const { rows } = await pool.query<{
      game_name: string;
      seat: number | null;
      attacker_id: string;
      defender_id: string;
      seq: number;
      phase: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT game_name, seat, attacker_id, defender_id, seq, phase, payload
       FROM battle_actions WHERE game_name = $1 ORDER BY id`,
      [name],
    );
    assert.equal(rows.length, 1);
    assert.deepEqual(
      { ...rows[0], payload: { ...rows[0].payload } },
      {
        game_name: name,
        seat: null,
        attacker_id: "h0",
        defender_id: "h1",
        seq: 0,
        phase: "start",
        payload: { obstacleSeed: 12345, humanSide: "attacker", grid: { cols: 15, rows: 13 } },
      },
    );
  } finally {
    await cleanupGame(name);
  }
});

test("a signed-in seat claim stamps the row's seat from the session, not the body", async () => {
  const name = uniqueName();
  try {
    // The lobby claim (and therefore attachPlayerSeat's lookup) needs a
    // real, joinable game row; battle_actions itself never does (no FK, on
    // purpose), so this seed is only for the claim step.
    await pool.query(
      `INSERT INTO games (name, seed, hero_q, hero_r, active_player_id, players, map_size)
       VALUES ($1, 1, 0, 0, 0, $2::jsonb, 'small')`,
      [name, JSON.stringify([{ id: 0, faction: "player", name: "Human", color: "#000000", heroIds: [], settlementIds: [] }])],
    );
    // A real claimed session (same flow the production client uses) -- the
    // route must derive `seat` from req.playerSeat, and there is no seat
    // field on the wire at all (the server stamps it, like migration 012's
    // comment says).
    const token = await loginAndClaim(baseUrl, name, 0);
    const res = await postAction(name, validRow({ seq: 1, phase: "move" }), token);
    assert.equal(res.status, 201);
    const { rows } = await pool.query<{ seat: number | null; seq: number; phase: string }>(
      `SELECT seat, seq, phase FROM battle_actions WHERE game_name = $1 ORDER BY id`,
      [name],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].seat, 0);
    assert.equal(rows[0].seq, 1);
    assert.equal(rows[0].phase, "move");
  } finally {
    await cleanupGame(name);
  }
});

test("malformed rows are rejected with 400 and insert nothing", async () => {
  const name = uniqueName();
  try {
    for (const bad of [
      validRow({ seq: -1 }),
      validRow({ seq: 1.5 }),
      validRow({ phase: "teleport" }),
      validRow({ attackerId: "" }),
      validRow({ payload: "not-an-object" }),
      validRow({ payload: [1, 2, 3] }),
      { attackerId: "h0", defenderId: "h1" },
    ]) {
      const res = await postAction(name, bad);
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
    }
    const { rowCount } = await pool.query(`SELECT 1 FROM battle_actions WHERE game_name = $1`, [name]);
    assert.equal(rowCount, 0, "no rejected row may have been inserted");
  } finally {
    await cleanupGame(name);
  }
});

test("rows for a battle replay in seq order regardless of insert timing", async () => {
  const name = uniqueName();
  try {
    // Fire the whole battle's rows concurrently the way the arena's
    // fire-and-forget posts would land; seq is the client-assigned replay
    // order, so reading back ORDER BY seq must reconstruct the battle.
    const phases = ["start", "move", "attack", "retreat", "end"] as const;
    await Promise.all(
      phases.map((phase, seq) => postAction(name, validRow({ seq, phase }))),
    );
    const { rows } = await pool.query<{ seq: number; phase: string }>(
      `SELECT seq, phase FROM battle_actions WHERE game_name = $1 ORDER BY seq`,
      [name],
    );
    assert.deepEqual(
      rows.map((r) => [r.seq, r.phase]),
      phases.map((phase, seq) => [seq, phase]),
    );
  } finally {
    await cleanupGame(name);
  }
});
