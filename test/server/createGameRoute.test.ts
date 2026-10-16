import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { pool } from "../../server/persistence/db";
import { router } from "../../server/routes";
import { errorHandler } from "../../server/errorHandler";
import { aiDriverBootToken } from "../../server/app/aiDriverToken";

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
  players: { id: number; faction: string; name: string; factionId?: string }[];
  heroes: Record<string, { id: string; ownerId: number; name: string }>;
  lobby: {
    seats?: number;
    humanSlots?: number;
    claimed?: Record<string, unknown>;
    aiDriver?: string;
    aiDriverToken?: string;
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

// D1 (plan/2026-09-30-server-side-ai-actor.md): the aiDriver flag rides the
// lobby jsonb on every game created with enemySlots > 0; legacy/starter/
// lobby games (D2) stay browser-driven.
test("enemySlots > 0 persists lobby.aiDriver = 'server' inside the lobby jsonb", async () => {
  const name = uniqueName();
  try {
    const { row } = await createGame({ name, humanSlots: 1, enemySlots: 2 });
    assert.equal(row.lobby.aiDriver, "server");
    assert.equal(row.lobby.seats, 1, "the flag does not disturb the human-based seat count");
    assert.deepEqual(row.lobby.claimed, {});
  } finally {
    await cleanupGame(name);
  }
});

test("games without enemySlots carry no aiDriver flag (browser-driven, D2)", async () => {
  const legacy = uniqueName();
  const lobbyOnly = uniqueName();
  try {
    const legacyRow = await createGame({ name: legacy });
    assert.equal(legacyRow.row.lobby.aiDriver, undefined, "the legacy starter row has no flag despite its default AI seats");
    const lobbyRow = await createGame({ name: lobbyOnly, humanSlots: 2 });
    assert.equal(lobbyRow.row.lobby.aiDriver, undefined, "a plain multiplayer lobby has no flag");
  } finally {
    await cleanupGame(legacy);
    await cleanupGame(lobbyOnly);
  }
});

// Boot-token scoping (cross-server race fix, 2026-09-30): the create route
// stamps THIS process's boot token beside the aiDriver flag, so shared-DB
// neighbor servers never drive each other's AI games.
test("enemySlots > 0 stamps lobby.aiDriverToken with this server's boot token", async () => {
  const name = uniqueName();
  try {
    const { row } = await createGame({ name, humanSlots: 1, enemySlots: 2 });
    assert.equal(row.lobby.aiDriver, "server");
    assert.equal(row.lobby.aiDriverToken, aiDriverBootToken(), "the stamp is this process's boot token");
    assert.ok(row.lobby.aiDriverToken.length > 0, "the token is a non-empty string");
  } finally {
    await cleanupGame(name);
  }
});

test("ON CONFLICT (name) resurrection re-stamps a drifted lobby.aiDriverToken", async () => {
  const name = uniqueName();
  try {
    await createGame({ name, humanSlots: 1, enemySlots: 1 });
    await pool.query(`UPDATE games SET lobby = lobby || $1::jsonb WHERE name = $2`, [
      JSON.stringify({ aiDriverToken: "stale-foreign-token" }),
      name,
    ]);
    const { row } = await createGame({ name, humanSlots: 1, enemySlots: 1 });
    assert.equal(row.lobby.aiDriver, "server");
    assert.equal(row.lobby.aiDriverToken, aiDriverBootToken(), "the fresh lobby write replaced the drifted token");
  } finally {
    await cleanupGame(name);
  }
});

test("games without enemySlots carry no aiDriverToken either", async () => {
  const name = uniqueName();
  try {
    const { row } = await createGame({ name, humanSlots: 2 });
    assert.equal(row.lobby.aiDriverToken, undefined, "a plain multiplayer lobby is tokenless");
  } finally {
    await cleanupGame(name);
  }
});

// Rec 4 (2026-10-02): the legacy instant auto-trade gate. POST /games writes
// lobby.legacyAutoTrade explicitly on EVERY new game -- false by default, true
// only on an explicit body opt-in -- so "absent" can never mean anything but
// "pre-flag save" and existing saves keep firing auto-trade unchanged.
test("every new game carries lobby.legacyAutoTrade = false unless the body opts in", async () => {
  const plain = uniqueName();
  const optedIn = uniqueName();
  const junk = uniqueName();
  try {
    const plainRow = await createGame({ name: plain });
    assert.equal(
      plainRow.row.lobby.legacyAutoTrade,
      false,
      "the flag is written explicitly (not just absent) so absent stays reserved for pre-flag saves",
    );

    const optInRes = await fetch(`${baseUrl}/games`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: optedIn, legacyAutoTrade: true }),
    });
    assert.equal(optInRes.status, 201);
    assert.equal(((await optInRes.json()) as CreatedRow).lobby.legacyAutoTrade, true, "the body param opts a new game back into the legacy behaviour");

    const junkRes = await fetch(`${baseUrl}/games`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: junk, legacyAutoTrade: "yes" }),
    });
    assert.equal(junkRes.status, 201);
    assert.equal(((await junkRes.json()) as CreatedRow).lobby.legacyAutoTrade, false, "non-boolean junk reads as the default");
  } finally {
    await cleanupGame(plain);
    await cleanupGame(optedIn);
    await cleanupGame(junk);
  }
});

// ── seatFactions (faction-registry foundation): the creator's local
// per-seat roster-faction choice, riding the enemySlots precedent. ──

test("POST /games seatFactions rides through to the players jsonb and clamps beyond the seat count", async () => {
  const name = uniqueName();
  try {
    const { row } = await createGame({
      name,
      humanSlots: 1,
      enemySlots: 1,
      seatFactions: ["ashen", "human", "verdant"],
    });
    assert.equal(row.players.length, 2, "the third entry is beyond the seat count and is never read");
    assert.equal(row.players[0].factionId, "ashen");
    assert.equal(row.players[1].factionId, "human");
    assert.equal(row.players[0].faction, "player", "the seat faction is untouched by the roster faction");
    assert.equal(row.players[1].faction, "ai");
  } finally {
    await cleanupGame(name);
  }
});

test("POST /games without seatFactions keeps the legacy player shape (no factionId key)", async () => {
  const name = uniqueName();
  try {
    const { row } = await createGame({ name, humanSlots: 2 });
    for (const p of row.players) {
      assert.equal("factionId" in p, false, "absent param must not add the key");
    }
  } finally {
    await cleanupGame(name);
  }
});

// ── Ironmark Holds (025_ironmark_holds): an ironmark seat is creatable now
// that the registry faction carries a shipped roster. ──

test("POST /games seatFactions [\"ironmark\"] stamps the seat with the Ironmark Holds", async () => {
  const name = uniqueName();
  try {
    const { row } = await createGame({ name, humanSlots: 1, seatFactions: ["ironmark"] });
    assert.equal(row.players.length, 1);
    assert.equal(row.players[0].factionId, "ironmark");
    assert.equal(row.players[0].faction, "player", "the seat faction is untouched by the roster faction");
  } finally {
    await cleanupGame(name);
  }
});

test("POST /games rejects seatFactions entries outside the registry", async () => {
  const name = uniqueName();
  try {
    for (const seatFactions of [["elves"], ["human", 42], "ashen", ["human", "ELVES"]]) {
      const res = await fetch(`${baseUrl}/games`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, seed: 99, hero_q: 2, hero_r: 2, enemy_positions: [], mapSize: "small", humanSlots: 1, seatFactions }),
      });
      assert.equal(res.status, 400, `seatFactions ${JSON.stringify(seatFactions)} must be rejected`);
      assert.deepEqual(await res.json(), { error: "seatFactions must be an array of faction ids" });
    }
  } finally {
    await cleanupGame(name);
  }
});

test("POST /games seatFactions ['verdant'] stamps a verdant seat (the 026 content faction)", async () => {
  const name = uniqueName();
  try {
    const { row } = await createGame({ name, humanSlots: 1, seatFactions: ["verdant"] });
    assert.equal(row.players[0].factionId, "verdant");
    assert.equal(row.players[0].faction, "player", "the roster faction never disturbs the seat's player/ai faction");
  } finally {
    await cleanupGame(name);
  }
});
