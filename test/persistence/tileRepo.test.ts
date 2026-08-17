import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { withRollback } from "../helpers/pgTestTx";
import { pool } from "../../server/persistence/db";
import { createTileRepo } from "../../server/persistence/repositories/tileRepo";

// withRollback pulls in the shared pg pool; close it once this file's tests
// are done so node:test's process can exit promptly instead of waiting out
// the pool's idle timeout.
after(() => pool.end());

async function seedGame(client: PoolClient, name: string): Promise<void> {
  await client.query(
    `INSERT INTO games (name, seed, hero_q, hero_r) VALUES ($1, $2, $3, $4)`,
    [name, 1, 0, 0],
  );
}

function uniqueName(): string {
  return `test-game-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

test("tileRepo.loadAllForGame returns [] for a game with no tiles", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createTileRepo(client);

    assert.deepEqual(await repo.loadAllForGame(name), []);
  });
});

test("tileRepo.loadAllForGame reads tiles back ordered by r then q, resource null-safe", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const gameId = (await client.query<{ id: number }>("SELECT id FROM games WHERE name = $1", [name]))
      .rows[0].id;
    await client.query(
      `INSERT INTO tiles (game_id, q, r, terrain, resource) VALUES
         ($1, 1, 0, 'grass', NULL), ($1, 0, 0, 'forest', 'wood'), ($1, 0, 1, 'dirt', NULL)`,
      [gameId],
    );
    const repo = createTileRepo(client);

    const loaded = await repo.loadAllForGame(name);

    assert.deepEqual(loaded, [
      { q: 0, r: 0, terrain: "forest", resource: "wood" },
      { q: 1, r: 0, terrain: "grass", resource: null },
      { q: 0, r: 1, terrain: "dirt", resource: null },
    ]);
  });
});
