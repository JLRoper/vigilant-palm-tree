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

test("heroRepo.upsertMany writes a hero and loadAllForGame reads it back (incl. wagons + cargo)", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createHeroRepo(client);
    const hero = {
      ...makeHero("h0", 0, 3, 4, { gold: 50, troops: 7 }),
      wagons: 3,
      resources: { wood: 10, stone: 0, iron: 0, arcane: 2, food: 0 },
    };

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
      wagons: 5,
      resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
    };

    await repo.upsertMany(name, { h0: hero });
    const [loaded] = await repo.loadAllForGame(name);

    assert.deepEqual(loaded, hero);
  });
});

test("heroRepo.upsertMany round-trips morale and the unpaid-upkeep shortfall counters", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createHeroRepo(client);
    // Deliberately non-default across all four fields: the default
    // (100/null/0/0) round-trip is already covered by every other test in
    // this file, which would not catch a column wired to the wrong field.
    const hero = {
      ...makeHero("h0", 0, 3, 4, {
        morale: 42,
        upkeepUnpaidSinceDay: 17,
        upkeepUnpaidTroops: 9,
        upkeepUnpaidGold: 63,
      }),
      // Same reason the earlier round-trip test passes these: heroRepo
      // materializes both on write (wagons defaults to 5, resources to {}),
      // so omitting them from the fixture would fail the whole-object
      // deepEqual below for reasons unrelated to the upkeep columns.
      wagons: 3,
      resources: { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 },
    };

    await repo.upsertMany(name, { h0: hero });
    const [loaded] = await repo.loadAllForGame(name);

    assert.equal(loaded.morale, 42);
    assert.equal(loaded.upkeepUnpaidSinceDay, 17);
    assert.equal(loaded.upkeepUnpaidTroops, 9);
    assert.equal(loaded.upkeepUnpaidGold, 63);
    assert.deepEqual(loaded, hero);
  });
});

test("heroRepo.upsertMany clears the unpaid-upkeep streak back to paid up on update", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createHeroRepo(client);
    await repo.upsertMany(name, {
      h0: makeHero("h0", 0, 1, 1, {
        morale: 30,
        upkeepUnpaidSinceDay: 12,
        upkeepUnpaidTroops: 5,
        upkeepUnpaidGold: 25,
      }),
    });

    // Paying the arrears must reset the streak to NULL, not leave the old
    // value behind -- the nullable since_day column is the one place a
    // naive read-modify-write could drop the reset entirely.
    const paidUp = makeHero("h0", 0, 1, 1, { morale: 100 });
    await repo.upsertMany(name, { h0: paidUp });
    const [loaded] = await repo.loadAllForGame(name);

    assert.equal(loaded.morale, 100);
    assert.equal(loaded.upkeepUnpaidSinceDay, null);
    assert.equal(loaded.upkeepUnpaidTroops, 0);
    assert.equal(loaded.upkeepUnpaidGold, 0);
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
