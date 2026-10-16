import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { pool } from "../../server/persistence/db";
import { router } from "../../server/routes";
import { errorHandler } from "../../server/errorHandler";
import { makeHero, makePlayer, makeSettlement, makeTradeRoute } from "../charter/_helpers";

// Regression pin: routes.ts once carried its own GAME_COLUMNS copy that
// omitted trade_routes/next_charter_id/next_settlement_id, so every game
// GET came back without them and the client hydrated tradeRoutes: [] on
// reload. The column list must come from gameRepo (single source).
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
  return `test-game-columns-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function cleanupGame(name: string): Promise<void> {
  await pool.query(`DELETE FROM games WHERE name = $1`, [name]);
}

async function seedGameWithRoute(name: string): Promise<unknown[]> {
  const routes = [
    makeTradeRoute({
      id: "1",
      from: { kind: "settlement", id: `${name}-s0` },
      to: { kind: "hero", id: `${name}-h0` },
      payload: { kind: "resource", resource: "wood" },
    }),
  ];
  await pool.query(
    `INSERT INTO games (name, seed, hero_q, hero_r, active_player_id, players, heroes, settlements, map_size, next_charter_id, next_settlement_id, trade_routes)
     VALUES ($1, 1, 2, 2, 0, $2::jsonb, $3::jsonb, $4::jsonb, 'small', 7, 9, $5::jsonb)`,
    [
      name,
      JSON.stringify([makePlayer(0, "player", [`${name}-h0`], [`${name}-s0`])]),
      JSON.stringify({ [`${name}-h0`]: makeHero(`${name}-h0`, 0, 2, 2) }),
      JSON.stringify({ [`${name}-s0`]: makeSettlement(`${name}-s0`, 0, 2, 2) }),
      JSON.stringify(routes),
    ],
  );
  return routes;
}

test("GET /games/:name returns trade_routes, next_charter_id and next_settlement_id (drifted local GAME_COLUMNS regression)", async () => {
  const name = uniqueName();
  const routes = await seedGameWithRoute(name);
  try {
    const res = await fetch(`${baseUrl}/games/${name}`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(body.trade_routes, routes, "GET /games/:name must carry the game's trade routes");
    assert.equal(body.next_charter_id, 7);
    assert.equal(body.next_settlement_id, 9);
  } finally {
    await cleanupGame(name);
  }
});

test("GET /games (list) rows carry trade_routes too (same shared column list)", async () => {
  const name = uniqueName();
  const routes = await seedGameWithRoute(name);
  try {
    const res = await fetch(`${baseUrl}/games`);
    assert.equal(res.status, 200);
    const rows = (await res.json()) as Record<string, unknown>[];
    const row = rows.find((r) => r.name === name);
    assert.ok(row, "the seeded game is listed");
    assert.deepEqual(row.trade_routes, routes);
  } finally {
    await cleanupGame(name);
  }
});
