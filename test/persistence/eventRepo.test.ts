import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { withRollback } from "../helpers/pgTestTx";
import { pool } from "../../server/persistence/db";
import { createEventRepo } from "../../server/persistence/repositories/eventRepo";

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

test("eventRepo.append inserts a row readable back from game_events", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createEventRepo(client);

    await repo.append(name, "move_completed", { heroId: "h0", cost: 1 });
    const r = await client.query<{ kind: string; payload: unknown }>(
      `SELECT e.kind, e.payload FROM game_events e
       JOIN games g ON g.id = e.game_id WHERE g.name = $1 ORDER BY e.id DESC LIMIT 1`,
      [name],
    );

    assert.equal(r.rowCount, 1);
    assert.equal(r.rows[0].kind, "move_completed");
    assert.deepEqual(r.rows[0].payload, { heroId: "h0", cost: 1 });
  });
});

test("eventRepo.append records multiple events in insertion order", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createEventRepo(client);

    await repo.append(name, "move_completed", { step: 1 });
    await repo.append(name, "transfer_gold", { step: 2 });
    const r = await client.query<{ kind: string }>(
      `SELECT e.kind FROM game_events e
       JOIN games g ON g.id = e.game_id WHERE g.name = $1 ORDER BY e.id ASC`,
      [name],
    );

    assert.deepEqual(r.rows.map((row) => row.kind), ["move_completed", "transfer_gold"]);
  });
});

test("eventRepo.append is a no-op when the game name doesn't exist", async () => {
  await withRollback(async (client) => {
    const repo = createEventRepo(client);
    // A kind unique to this test run, so the count below can't be inflated
    // by unrelated events already sitting in the shared dev/CI database.
    const kind = `test-kind-${uniqueName()}`;

    await repo.append("does-not-exist", kind, { step: 1 });
    const r = await client.query(`SELECT count(*) FROM game_events WHERE kind = $1`, [kind]);

    assert.equal(Number(r.rows[0].count), 0);
  });
});
