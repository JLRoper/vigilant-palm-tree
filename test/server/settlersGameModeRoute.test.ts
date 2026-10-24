import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { SETTLERS_MODE_DEFAULTS, coveredWagonIdFor, isCoveredWagonId } from "@heroes/contracts";
import { pool } from "../../server/persistence/db";
import { router } from "../../server/routes";
import { errorHandler } from "../../server/errorHandler";

// End-to-end coverage for choosing the settlers mode at game creation over
// real Express + real Postgres (the createGameRoute.test.ts harness): the mode
// has to survive the request body -> lobby.gameMode -> the entity seeding pass,
// and the game the client then loads has to be bare wilderness with one covered
// wagon per seat.

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

function uniqueName(prefix: string): string {
  return `test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function cleanupGame(name: string): Promise<void> {
  await pool.query(`DELETE FROM games WHERE name = $1`, [name]);
}

interface CreatedRow {
  seed: number;
  players: { id: number; faction: string; heroIds: string[]; settlementIds: string[] }[];
  heroes: Record<
    string,
    { id: string; ownerId: number; q: number; r: number; troops: number; movementRemaining: number; resources?: Record<string, number> }
  >;
  settlements: Record<string, { id: string; ownerId: number | null; q: number; r: number }>;
  lobby: { gameMode?: string; mapGenVersion?: number };
}

async function createGame(body: Record<string, unknown>): Promise<{ status: number; row: CreatedRow }> {
  const res = await fetch(`${baseUrl}/games`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seed: 99, hero_q: 2, hero_r: 2, enemy_positions: [], mapSize: "small", ...body }),
  });
  const text = await res.text();
  return { status: res.status, row: JSON.parse(text) as CreatedRow };
}

test("POST /games with gameMode settlers stores the mode and seeds bare wilderness with one wagon per seat", async () => {
  const name = uniqueName("settlers-create");
  try {
    const { status, row } = await createGame({ name, humanSlots: 1, enemySlots: 1, gameMode: "settlers" });
    assert.equal(status, 201, JSON.stringify(row));

    assert.equal(row.lobby.gameMode, "settlers", "the mode rides the lobby jsonb (no column, no migration)");

    // Bare wilderness: no seat owns a town, settlement or castle. The neutral
    // castles are entity seeding and stay (design answer 4).
    const owned = Object.values(row.settlements).filter((s) => s.ownerId !== null);
    assert.deepEqual(owned.map((s) => s.id), [], "a settlers seat must not start with a pre-existing town");
    for (const s of Object.values(row.settlements)) {
      assert.equal(s.ownerId, null, "only neutral wilderness castles remain");
    }

    // One covered wagon per seat, carrying the mode's supplies.
    const seats = row.players.length;
    assert.equal(seats, 2, "humanSlots 1 + enemySlots 1 is two seats");
    assert.equal(Object.keys(row.heroes).length, seats);
    for (const player of row.players) {
      assert.deepEqual(player.heroIds, [coveredWagonIdFor(player.id)]);
      assert.deepEqual(player.settlementIds, [], "no starting settlement list");
      const wagon = row.heroes[coveredWagonIdFor(player.id)];
      assert.ok(wagon, `seat ${player.id} must own its wagon`);
      assert.ok(isCoveredWagonId(wagon.id));
      assert.equal(wagon.ownerId, player.id);
      assert.equal(wagon.troops, 0, "a wagon carries no army");
      assert.equal(wagon.movementRemaining, 7, "wagon movement is a hero's");
      assert.deepEqual(wagon.resources, SETTLERS_MODE_DEFAULTS.wagonSupplies, "the supplies ride as cargo");
    }
  } finally {
    await cleanupGame(name);
  }
});

test("POST /games without a gameMode still creates a classic game with seat castles", async () => {
  const name = uniqueName("classic-create");
  try {
    const { status, row } = await createGame({ name, humanSlots: 1, enemySlots: 1 });
    assert.equal(status, 201, JSON.stringify(row));
    assert.equal(row.lobby.gameMode, "classic", "every new game states its mode explicitly");
    const ownedOwners = new Set(
      Object.values(row.settlements).filter((s) => s.ownerId !== null).map((s) => s.ownerId),
    );
    assert.deepEqual([...ownedOwners].sort(), [0, 1], "classic seats still start on their own castles");
    for (const player of row.players) {
      assert.deepEqual(player.heroIds, [`p${player.id}-hero`], "classic seats still start with a commander");
      assert.ok(player.settlementIds.length > 0);
    }
  } finally {
    await cleanupGame(name);
  }
});

test("POST /games rejects a gameMode that is not a known mode", async () => {
  const name = uniqueName("bad-mode");
  try {
    const { status } = await createGame({ name, humanSlots: 1, gameMode: "sandbox" });
    assert.equal(status, 400, "a typo'd mode is refused rather than silently resolved to classic");
  } finally {
    await cleanupGame(name);
  }
});
