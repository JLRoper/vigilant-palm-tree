import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import type { HeroState } from "@heroes/contracts";
import { withRollback } from "../helpers/pgTestTx";
import { pool } from "../../server/persistence/db";
import { createHeroRepo } from "../../server/persistence/repositories/heroRepo";
import { makeHero } from "../charter/_helpers";

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

test("heroRepo.loadAllForGame returns [] for a game with no heroes", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createHeroRepo(client);

    assert.deepEqual(await repo.loadAllForGame(name), []);
  });
});

test("heroRepo.upsertMany writes a hero and loadAllForGame reads it back", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createHeroRepo(client);
    const hero = makeHero("h0", 0, 3, 4, { gold: 50, troops: 7 });

    await repo.upsertMany(name, { h0: hero });
    const loaded = await repo.loadAllForGame(name);

    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0], hero);
  });
});

test("heroRepo.upsertMany round-trips stacks with multiple platoons and entries", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createHeroRepo(client);
    const hero = makeHero("h0", 0, 3, 4, {
      stacks: [
        { entries: [{ unitTypeId: "archer", count: 5 }, { unitTypeId: "swordsman", count: 3 }] },
        { entries: [{ unitTypeId: "cavalry", count: 2 }] },
      ],
    });

    await repo.upsertMany(name, { h0: hero });
    const [loaded] = await repo.loadAllForGame(name);

    assert.deepEqual(loaded.stacks, hero.stacks);
  });
});

test("heroRepo.upsertMany is a full sync: a hero missing from the record is deleted", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createHeroRepo(client);
    await repo.upsertMany(name, { h0: makeHero("h0", 0, 1, 1), h1: makeHero("h1", 0, 2, 2) });

    await repo.upsertMany(name, { h0: makeHero("h0", 0, 1, 1) });
    const loaded = await repo.loadAllForGame(name);

    assert.deepEqual(loaded.map((h) => h.id), ["h0"]);
  });
});

test("heroRepo.upsertMany replaces stacks on update rather than merging them", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createHeroRepo(client);
    const stackedHero = makeHero("h0", 0, 1, 1, {
      stacks: [{ entries: [{ unitTypeId: "archer", count: 5 }] }],
    });
    await repo.upsertMany(name, { h0: stackedHero });

    const reorderedHero = makeHero("h0", 0, 1, 1, {
      stacks: [{ entries: [{ unitTypeId: "cavalry", count: 1 }] }],
    });
    await repo.upsertMany(name, { h0: reorderedHero });
    const [loaded] = await repo.loadAllForGame(name);

    assert.deepEqual(loaded.stacks, reorderedHero.stacks);
  });
});

test("heroRepo.upsertMany round-trips a fractional movementRemaining (forest/desert terrain costs are non-integer)", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createHeroRepo(client);
    const hero: HeroState = {
      ...makeHero("h0", 0, 3, 4, { movementRemaining: 1.1999999999999993 }),
      previousQ: 2,
      previousR: 4,
      previousMovementRemaining: 3.4,
    };

    await repo.upsertMany(name, { h0: hero });
    const [loaded] = await repo.loadAllForGame(name);

    assert.deepEqual(loaded, hero);
  });
});

test("heroRepo.upsertMany is a no-op for an empty record", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createHeroRepo(client);

    await repo.upsertMany(name, {});
    assert.deepEqual(await repo.loadAllForGame(name), []);
  });
});

test("heroRepo.upsertMany deletes every hero when the record goes fully empty", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createHeroRepo(client);
    await repo.upsertMany(name, { h0: makeHero("h0", 0, 1, 1), h1: makeHero("h1", 0, 2, 2) });

    await repo.upsertMany(name, {});
    const loaded = await repo.loadAllForGame(name);

    assert.deepEqual(loaded, []);
  });
});
