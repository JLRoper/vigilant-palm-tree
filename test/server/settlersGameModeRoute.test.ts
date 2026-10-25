import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { SETTLERS_MODE_DEFAULTS, coveredWagonIdFor, isCoveredWagonId, seatHeroIdFor } from "@heroes/contracts";
import { pool } from "../../server/persistence/db";
import { router } from "../../server/routes";
import { errorHandler } from "../../server/errorHandler";

// End-to-end coverage for choosing the settlers mode at game creation over
// real Express + real Postgres (the createGameRoute.test.ts harness): the mode
// has to survive the request body -> lobby.gameMode -> the entity seeding pass,
// and the game the client then loads has to be BARE wilderness with one covered
// wagon per seat.
//
// The second half of this file drives the mode's founding command over the same
// real stack -- through parseCommand (where a malformed payload is a 400), the
// handler's authority checks, the engine's rule and the persistence write -- so
// `POST /games/:name/commands { kind: "FoundSettlement", founderId }` with NO
// hex is pinned at the layer the client actually talks to.

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
  settlements: Record<
    string,
    { id: string; name?: string; ownerId: number | null; q: number; r: number; level?: number; buildings?: unknown[]; warehouse?: Record<string, number> }
  >;
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

/** POST /api/games/:name/commands -- the client's own entry point. */
async function postCommand(name: string, body: Record<string, unknown>): Promise<{ status: number; json: { error?: string } | null }> {
  const res = await fetch(`${baseUrl}/games/${name}/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let json: { error?: string } | null = null;
  try {
    json = (await res.json()) as { error?: string };
  } catch {
    /* non-json */
  }
  return { status: res.status, json };
}

/** The games row, re-read (the persistence half of every command assertion). */
async function storedRow(name: string): Promise<CreatedRow & { next_settlement_id?: number }> {
  const r = await pool.query(
    `SELECT seed, players, heroes, settlements, next_settlement_id FROM games WHERE name = $1`,
    [name],
  );
  assert.ok(r.rows[0], `game ${name} missing from the database`);
  return r.rows[0] as CreatedRow & { next_settlement_id?: number };
}

/** Rows in the granular heroes table (migration 009) -- what a rename must move. */
async function granularHeroIds(name: string): Promise<string[]> {
  const r = await pool.query(
    `SELECT h.id FROM heroes h JOIN games g ON g.id = h.game_id WHERE g.name = $1 ORDER BY h.id`,
    [name],
  );
  return r.rows.map((row) => row.id as string);
}

test("POST /games with gameMode settlers stores the mode and seeds BARE wilderness with one wagon per seat", async () => {
  const name = uniqueName("settlers-create");
  try {
    const { status, row } = await createGame({ name, humanSlots: 1, enemySlots: 1, gameMode: "settlers" });
    assert.equal(status, 201, JSON.stringify(row));

    assert.equal(row.lobby.gameMode, "settlers", "the mode rides the lobby jsonb (no column, no migration)");

    // Bare wilderness: no settlement at all. Zero seat castles AND zero neutral
    // castles, so there is no neutral town, no seeded starter buildings and no
    // startup district anywhere on the board either -- all three are downstream
    // of the castle list this mode filters out.
    assert.deepEqual(
      Object.values(row.settlements),
      [],
      "a settlers board holds no settlement: neither a seat's town nor a neutral castle",
    );

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
    assert.ok(
      Object.values(row.settlements).some((s) => s.ownerId === null),
      "…and classic keeps its neutral castles",
    );
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

test("FoundSettlement with no hex founds IN PLACE: the wagon becomes the town's first hero", async () => {
  const name = uniqueName("settlers-found");
  try {
    const { status, row } = await createGame({ name, seed: 4242, humanSlots: 1, enemySlots: 1, gameMode: "settlers" });
    assert.equal(status, 201, JSON.stringify(row));
    const wagon = row.heroes[coveredWagonIdFor(0)];
    assert.ok(wagon, "seat 0 starts with its wagon");

    // FOUNDING IS IN PLACE: the command names only WHO founds. The server
    // derives the hex from the founder's own row (commandHandler.ts), which is
    // what makes the client's single toolbar gesture possible.
    const res = await postCommand(name, {
      kind: "FoundSettlement",
      actor: 0,
      founderId: coveredWagonIdFor(0),
    });
    assert.equal(res.status, 200, `founding -> ${res.status} ${JSON.stringify(res.json)}`);

    const after = await storedRow(name);
    const founded = Object.values(after.settlements).find((s) => s.ownerId === 0);
    assert.ok(founded, "the settlement is persisted");
    assert.equal(founded!.q, wagon.q, "…on the hex the founder stood on, with no hex on the wire");
    assert.equal(founded!.r, wagon.r);
    assert.deepEqual(founded!.buildings, [], "no prebuilt buildings");
    assert.deepEqual(
      founded!.warehouse,
      SETTLERS_MODE_DEFAULTS.wagonSupplies,
      "the wagon's cargo is the town's warehouse",
    );
    assert.equal(after.next_settlement_id, 1, "the id counter moved atomically with the settlement");

    // The identity conversion, all the way through persistence: the wagon's own
    // id is gone, the seat's hero id is the same record, and the roster names it.
    const heroId = seatHeroIdFor(0);
    assert.equal(after.heroes[coveredWagonIdFor(0)], undefined, "the wagon's own id is gone");
    const hero = after.heroes[heroId];
    assert.ok(hero, "the seat's hero id carries the wagon");
    assert.equal(hero!.ownerId, 0);
    assert.equal(hero!.q, wagon.q, "it stands where the wagon did");
    assert.equal(hero!.r, wagon.r);
    const seat0 = after.players.find((p) => p.id === 0);
    assert.deepEqual(seat0?.heroIds, [heroId], "the roster follows the rename");
    assert.deepEqual(seat0?.settlementIds, [founded!.id]);
    assert.deepEqual(
      await granularHeroIds(name),
      [coveredWagonIdFor(1), heroId].sort(),
      "the granular heroes table moved with it: the wagon's row is deleted, the hero's inserted",
    );
  } finally {
    await cleanupGame(name);
  }
});

test("FoundSettlement refuses a second founding, a converted founder, and a malformed hex", async () => {
  const name = uniqueName("settlers-refuse");
  try {
    const { status } = await createGame({ name, seed: 4243, humanSlots: 1, enemySlots: 1, gameMode: "settlers" });
    assert.equal(status, 201);

    const first = await postCommand(name, {
      kind: "FoundSettlement",
      actor: 0,
      founderId: coveredWagonIdFor(0),
    });
    assert.equal(first.status, 200, JSON.stringify(first.json));

    // The wagon is gone, so a repeat naming it is an authority refusal.
    const repeat = await postCommand(name, {
      kind: "FoundSettlement",
      actor: 0,
      founderId: coveredWagonIdFor(0),
    });
    assert.equal(repeat.status, 409, JSON.stringify(repeat.json));
    assert.equal(repeat.json?.error, "no_hero", "the consumed wagon's id is nobody's");

    // The converted founder exists and is the seat's -- and the ENGINE refuses
    // it: only a covered wagon founds, so one wagon buys exactly one town.
    const converted = await postCommand(name, {
      kind: "FoundSettlement",
      actor: 0,
      founderId: seatHeroIdFor(0),
    });
    assert.equal(converted.status, 409, JSON.stringify(converted.json));
    assert.equal(converted.json?.error, "founder_not_a_wagon");

    // A hex is optional, but if one is sent it must be a real pair of integers:
    // a lone q is a malformed payload, refused by parseCommand before any
    // handler runs.
    const halfHex = await postCommand(name, {
      kind: "FoundSettlement",
      actor: 0,
      founderId: coveredWagonIdFor(1),
      q: 3,
    });
    assert.equal(halfHex.status, 400, JSON.stringify(halfHex.json));

    const fractional = await postCommand(name, {
      kind: "FoundSettlement",
      actor: 0,
      founderId: coveredWagonIdFor(1),
      q: 3.5,
      r: 3,
    });
    assert.equal(fractional.status, 400, JSON.stringify(fractional.json));

    // …and the other seat's wagon is untouched by any of it.
    const after = await storedRow(name);
    assert.ok(after.heroes[coveredWagonIdFor(1)], "seat 1's wagon is still there");
    assert.equal(Object.values(after.settlements).filter((s) => s.ownerId === 0).length, 1);
  } finally {
    await cleanupGame(name);
  }
});
