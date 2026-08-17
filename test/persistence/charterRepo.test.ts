import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { withRollback } from "../helpers/pgTestTx";
import { pool } from "../../server/persistence/db";
import { createHeroRepo } from "../../server/persistence/repositories/heroRepo";
import { createCharterRepo } from "../../server/persistence/repositories/charterRepo";
import { makeCharter, makeHero } from "../charter/_helpers";

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

// charters.hero_id references heroes(id) -- a charter needs its hero row to
// already exist (see server/migrations/009_granular_entities.sql's note on
// why the FK only runs this direction, not both). Takes every hero id in one
// call, not one call per hero: heroRepo.upsertMany full-syncs (deletes any
// hero for the game not in the given record), so calling it once per hero
// would delete each previously-seeded hero the moment the next one is added.
async function seedHeroes(client: PoolClient, gameName: string, heroIds: string[]): Promise<void> {
  const heroes = Object.fromEntries(heroIds.map((id) => [id, makeHero(id, 0, 1, 1)]));
  await createHeroRepo(client).upsertMany(gameName, heroes);
}

test("charterRepo.loadAllForGame returns [] for a game with no charters", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createCharterRepo(client);

    assert.deepEqual(await repo.loadAllForGame(name), []);
  });
});

test("charterRepo.upsertMany writes a charter and loadAllForGame reads it back", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    await seedHeroes(client, name, ["h0"]);
    const repo = createCharterRepo(client);
    const charter = makeCharter({ id: "c0", heroId: "h0", ownerId: 0, resourceRates: { wood: 10 } });

    await repo.upsertMany(name, [charter]);
    const loaded = await repo.loadAllForGame(name);

    assert.deepEqual(loaded, [charter]);
  });
});

test("charterRepo.upsertMany is a full sync: a charter missing from the array is deleted (charter completed)", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    await seedHeroes(client, name, ["h0", "h1"]);
    const repo = createCharterRepo(client);
    await repo.upsertMany(name, [
      makeCharter({ id: "c0", heroId: "h0", ownerId: 0 }),
      makeCharter({ id: "c1", heroId: "h1", ownerId: 0 }),
    ]);

    await repo.upsertMany(name, [makeCharter({ id: "c0", heroId: "h0", ownerId: 0 })]);
    const loaded = await repo.loadAllForGame(name);

    assert.deepEqual(loaded.map((c) => c.id), ["c0"]);
  });
});

test("charterRepo.upsertMany is a no-op for an empty array", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createCharterRepo(client);

    await repo.upsertMany(name, []);
    assert.deepEqual(await repo.loadAllForGame(name), []);
  });
});
