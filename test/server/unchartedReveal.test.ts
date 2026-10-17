import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { pool } from "../../server/persistence/db";
import { router } from "../../server/routes";
import { errorHandler } from "../../server/errorHandler";

// End-to-end coverage for the server-side half of uncharted mode's reveal
// persistence: MoveHero merges the walked corridor into the acting human
// seat's players[N].revealedTiles (and only when lobby.uncharted is true),
// over real Express + real Postgres (same harness as createGameRoute.test.ts
// and commandsRoute.test.ts).

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
  return `test-uncharted-reveal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function cleanupGame(name: string): Promise<void> {
  await pool.query(`DELETE FROM games WHERE name = $1`, [name]);
}

type GameRow = {
  players: { id: number; faction: string; revealedTiles?: string[] }[];
  heroes: Record<string, { id: string; ownerId: number; q: number; r: number; movementRemaining: number }>;
  lobby: { uncharted?: boolean };
};

async function createGame(body: Record<string, unknown>): Promise<GameRow> {
  const res = await fetch(`${baseUrl}/games`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seed: 99, hero_q: 2, hero_r: 2, enemy_positions: [], mapSize: "small", ...body }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  return (await res.json()) as GameRow;
}

async function getGame(name: string): Promise<GameRow> {
  const res = await fetch(`${baseUrl}/games/${name}`);
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()) as GameRow;
}

async function postCommand(name: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl}/games/${name}/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

// The engine's reveal sorts keys numerically by (q, then r), which
// lexicographic string sort does NOT reproduce once q has mixed signs or
// digit lengths -- so the assertion must use the same comparator.
function isSortedByQR(keys: string[]): boolean {
  for (let i = 1; i < keys.length; i++) {
    const [aq, ar] = keys[i - 1].split(",").map(Number);
    const [bq, br] = keys[i].split(",").map(Number);
    if (!(aq < bq || (aq === bq && ar < br))) return false;
  }
  return true;
}

test("MoveHero in an uncharted game merges the walked corridor into the actor's reveal", async () => {
  const name = uniqueName();
  try {
    await createGame({ name, uncharted: true });
    const before = await getGame(name);
    assert.equal(before.lobby.uncharted, true, "the game is created uncharted");
    const hero = Object.values(before.heroes).find((h) => h.ownerId === 0);
    assert.ok(hero, "the human hero exists");

    const from = { q: hero!.q, r: hero!.r };
    const actorBefore = before.players.find((p) => p.id === 0);
    assert.ok(
      Array.isArray(actorBefore?.revealedTiles) && actorBefore!.revealedTiles!.length > 0,
      "the seed reveal exists before the move",
    );

    // Move 5 hexes along +q, carrying the full corridor as the trail so the
    // reveal merge covers the intermediate tiles, not just the endpoints.
    // The destination ring (radius 4) extends 9 hexes past the spawn, so the
    // merged reveal must grow beyond the spawn ring.
    const trail = Array.from({ length: 6 }, (_, i) => ({ q: from.q + i, r: from.r }));
    const to = trail[trail.length - 1];

    const res = await postCommand(name, {
      kind: "MoveHero",
      actor: 0,
      heroId: hero!.id,
      fromTile: from,
      toTile: to,
      cost: trail.length - 1,
      trail,
    });
    assert.equal(res.error, undefined, `MoveHero should succeed: ${JSON.stringify(res)}`);

    const after = await getGame(name);
    const actorAfter = after.players.find((p) => p.id === 0);
    const corridorKey = `${to.q},${to.r}`;
    assert.ok(
      Array.isArray(actorAfter?.revealedTiles) && actorAfter!.revealedTiles!.includes(corridorKey),
      "the walked destination is revealed",
    );
    assert.ok(
      actorAfter!.revealedTiles!.length > actorBefore!.revealedTiles!.length,
      "the reveal grew beyond the spawn ring",
    );
    assert.ok(isSortedByQR(actorAfter!.revealedTiles!), "the merged reveal stays sorted (q, then r)");
  } finally {
    await cleanupGame(name);
  }
});

test("MoveHero in a non-uncharted game leaves no revealedTiles key on any player", async () => {
  const name = uniqueName();
  try {
    await createGame({ name });
    const before = await getGame(name);
    assert.notEqual(before.lobby.uncharted, true, "the game is not uncharted");
    for (const p of before.players) {
      assert.equal("revealedTiles" in p, false, "no reveal before the move");
    }
    const hero = Object.values(before.heroes).find((h) => h.ownerId === 0);
    assert.ok(hero, "the human hero exists");
    const from = { q: hero!.q, r: hero!.r };

    const res = await postCommand(name, {
      kind: "MoveHero",
      actor: 0,
      heroId: hero!.id,
      fromTile: from,
      toTile: { q: from.q + 1, r: from.r },
      cost: 1,
    });
    assert.equal(res.error, undefined, `MoveHero should succeed: ${JSON.stringify(res)}`);

    const after = await getGame(name);
    for (const p of after.players) {
      assert.equal(
        "revealedTiles" in p,
        false,
        "a non-uncharted MoveHero must not stamp reveal even though players now ride the persist",
      );
    }
  } finally {
    await cleanupGame(name);
  }
});