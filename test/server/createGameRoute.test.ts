import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { pool } from "../../server/persistence/db";
import { router } from "../../server/routes";
import { errorHandler } from "../../server/errorHandler";

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
  return `test-create-route-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function cleanupGame(name: string): Promise<void> {
  await pool.query(`DELETE FROM games WHERE name = $1`, [name]);
}

type CreatedRow = {
  players: { id: number; faction: string; name: string }[];
  heroes: Record<string, { id: string; ownerId: number; name: string }>;
  lobby: {
    seats?: number;
    humanSlots?: number;
    claimed?: Record<string, unknown>;
  };
};

async function createGame(body: Record<string, unknown>): Promise<{ status: number; row: CreatedRow }> {
  const res = await fetch(`${baseUrl}/games`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seed: 99, hero_q: 2, hero_r: 2, enemy_positions: [], mapSize: "small", ...body }),
  });
  if (res.status !== 201) {
    assert.fail(`create should 201, got ${res.status}: ${await res.text()}`);
  }
  return { status: res.status, row: (await res.json()) as CreatedRow };
}

test("POST /games with humanSlots 1 + enemySlots 2 makes 3 players, AI factions, all heroes, and a human-only lobby", async () => {
  const name = uniqueName();
  try {
    const { row } = await createGame({ name, humanSlots: 1, enemySlots: 2 });
    assert.equal(row.players.length, 3);
    assert.equal(row.players[0].faction, "player");
    assert.equal(row.players[1].faction, "ai");
    assert.equal(row.players[2].faction, "ai");
    const heroOwners = new Set(Object.values(row.heroes).map((h) => h.ownerId));
    assert.deepEqual([...heroOwners].sort(), [0, 1, 2]);
    assert.equal(row.lobby.seats, 1, "lobby seats must stay human-count based");
    assert.equal(row.lobby.humanSlots, 1);
    assert.deepEqual(row.lobby.claimed, {});
  } finally {
    await cleanupGame(name);
  }
});

test("AI seats are not claimable: claim of seat 1 in a 1-human + 2-AI game is seat_out_of_range", async () => {
  const name = uniqueName();
  try {
    const { row } = await createGame({ name, humanSlots: 1, enemySlots: 2 });
    assert.equal(row.lobby.seats, 1);
    const aiSeat = await fetch(`${baseUrl}/games/${name}/lobby/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seat: 1, handle: "AI-invader" }),
    });
    assert.equal(aiSeat.status, 400);
    assert.deepEqual(await aiSeat.json(), { error: "seat_out_of_range" });
    const humanSeat = await fetch(`${baseUrl}/games/${name}/lobby/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seat: 0, handle: "Host" }),
    });
    assert.equal(humanSeat.status, 200);
  } finally {
    await cleanupGame(name);
  }
});

test("POST /games with humanSlots only (enemySlots omitted) keeps the multiplayer-lobby row shape", async () => {
  const name = uniqueName();
  try {
    const { row } = await createGame({ name, humanSlots: 2 });
    assert.equal(row.players.length, 2);
    for (const p of row.players) assert.equal(p.faction, "player");
    const heroOwners = new Set(Object.values(row.heroes).map((h) => h.ownerId));
    assert.deepEqual([...heroOwners].sort(), [0, 1]);
    assert.equal(row.lobby.seats, 2);
    assert.equal(row.lobby.humanSlots, 2);
    assert.deepEqual(row.lobby.claimed, {});
  } finally {
    await cleanupGame(name);
  }
});

test("enemySlots is clamped to MAX_PLAYERS - humanSlots when oversized", async () => {
  const name = uniqueName();
  try {
    const { row } = await createGame({ name, humanSlots: 8, enemySlots: 99 });
    assert.equal(row.players.length, 10);
    const aiCount = row.players.filter((p) => p.faction === "ai").length;
    assert.equal(aiCount, 2);
    assert.equal(row.lobby.seats, 8);
    assert.equal(row.lobby.humanSlots, 8);
  } finally {
    await cleanupGame(name);
  }
});

test("invalid enemySlots (negative, fractional) falls back to 0", async () => {
  for (const enemySlots of [-3, 1.5, "two"]) {
    const name = uniqueName();
    try {
      const { row } = await createGame({ name, humanSlots: 3, enemySlots });
      assert.equal(row.players.length, 3);
      for (const p of row.players) assert.equal(p.faction, "player");
      assert.equal(row.lobby.seats, 3);
    } finally {
      await cleanupGame(name);
    }
  }
});

test("legacy path without humanSlots keeps the old default row (no lobby, engine default players)", async () => {
  const name = uniqueName();
  try {
    const { row } = await createGame({ name });
    assert.equal(row.lobby.seats, undefined);
    assert.equal(row.lobby.humanSlots, undefined);
    assert.equal(row.players.length, 3);
    assert.equal(row.players[0].faction, "player");
  } finally {
    await cleanupGame(name);
  }
});
