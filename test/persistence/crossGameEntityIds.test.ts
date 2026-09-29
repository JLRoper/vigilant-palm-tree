import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import type { HeroState } from "@heroes/contracts";
import { withRollback } from "../helpers/pgTestTx";
import { pool } from "../../server/persistence/db";
import { createHeroRepo } from "../../server/persistence/repositories/heroRepo";
import { createSettlementRepo } from "../../server/persistence/repositories/settlementRepo";
import { makeHero, makeSettlement } from "../charter/_helpers";

// Regression test for cross-game id stealing (migration 017): entity ids are
// only unique PER GAME -- every game seeds an "h0"/"s0" -- so the granular
// tables must key rows on (game_id, id) and every repo query must carry
// game_id. Before the fix, game B's upsert of "h0" ran ON CONFLICT (id) DO
// UPDATE SET game_id = EXCLUDED.game_id and stole game A's row wholesale;
// the victim's next EndTurn hydrate then returned the depleted record and
// its heroes vanished from the map. This is the EndTurn-hero-loss repro at
// the persistence layer: both games upsert the SAME ids, and each must read
// back its OWN rows afterwards.

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
  return `test-cross-game-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function heroA(): HeroState {
  return {
    ...makeHero("h0", 0, 1, 1, {
      gold: 50,
      stacks: [{ entries: [{ unitTypeId: "archer", count: 5 }] }],
    }),
    name: "Alice",
  };
}

test("two games upserting the same hero id keep independent rows (no cross-game stealing)", async () => {
  await withRollback(async (client) => {
    const nameA = uniqueName();
    const nameB = uniqueName();
    await seedGame(client, nameA);
    await seedGame(client, nameB);

    const heroB: HeroState = { ...makeHero("h0", 1, 2, 2, { gold: 7 }), name: "Bob" };
    await createHeroRepo(client).upsertMany(nameA, { h0: heroA() });
    await createHeroRepo(client).upsertMany(nameB, { h0: heroB });

    const [loadedA, loadedB] = await Promise.all([
      createHeroRepo(client).loadAllForGame(nameA),
      createHeroRepo(client).loadAllForGame(nameB),
    ]);

    assert.equal(loadedA.length, 1, "game A still sees exactly its own h0");
    assert.equal(loadedA[0].name, "Alice");
    assert.equal(loadedA[0].ownerId, 0);
    assert.equal(loadedA[0].gold, 50);

    assert.equal(loadedB.length, 1, "game B still sees exactly its own h0");
    assert.equal(loadedB[0].name, "Bob");
    assert.equal(loadedB[0].ownerId, 1);
    assert.equal(loadedB[0].gold, 7);
  });
});

test("hero platoon rows do not bleed across games sharing an id", async () => {
  await withRollback(async (client) => {
    const nameA = uniqueName();
    const nameB = uniqueName();
    await seedGame(client, nameA);
    await seedGame(client, nameB);

    const heroB: HeroState = makeHero("h0", 1, 2, 2, { gold: 7 });
    await createHeroRepo(client).upsertMany(nameA, { h0: heroA() });
    await createHeroRepo(client).upsertMany(nameB, { h0: heroB });

    const [loadedA, loadedB] = await Promise.all([
      createHeroRepo(client).loadAllForGame(nameA),
      createHeroRepo(client).loadAllForGame(nameB),
    ]);

    assert.deepEqual(loadedA[0].stacks, [{ entries: [{ unitTypeId: "archer", count: 5 }] }]);
    assert.deepEqual(loadedB[0].stacks, [], "game B's platoon-less h0 must not inherit game A's rows");
  });
});

test("two games upserting the same settlement id keep independent rows and child rows", async () => {
  await withRollback(async (client) => {
    const nameA = uniqueName();
    const nameB = uniqueName();
    await seedGame(client, nameA);
    await seedGame(client, nameB);

    const settlementA = makeSettlement("s0", 0, 2, 2, {
      gold: 10,
      warehouse: { wood: 12, stone: 0, iron: 0, arcane: 0, food: 5 },
      buildings: [{ gx: 1, gy: 1, kind: "house", level: 1, style: "classic" }],
    });
    const settlementB = makeSettlement("s0", 1, 9, 9, { gold: 90 });
    await createSettlementRepo(client).upsertMany(nameA, { s0: settlementA });
    await createSettlementRepo(client).upsertMany(nameB, { s0: settlementB });

    const [loadedA, loadedB] = await Promise.all([
      createSettlementRepo(client).loadAllForGame(nameA),
      createSettlementRepo(client).loadAllForGame(nameB),
    ]);

    assert.equal(loadedA.length, 1, "game A still sees exactly its own s0");
    assert.equal(loadedA[0].ownerId, 0);
    assert.equal(loadedA[0].q, 2);
    assert.equal(loadedA[0].r, 2);
    assert.equal(loadedA[0].gold, 10);
    assert.deepEqual(loadedA[0].warehouse, settlementA.warehouse);
    assert.deepEqual(loadedA[0].buildings, settlementA.buildings);

    assert.equal(loadedB.length, 1, "game B still sees exactly its own s0");
    assert.equal(loadedB[0].ownerId, 1);
    assert.equal(loadedB[0].q, 9);
    assert.equal(loadedB[0].r, 9);
    assert.equal(loadedB[0].gold, 90);
    assert.deepEqual(loadedB[0].warehouse, { wood: 0, stone: 0, iron: 0, arcane: 0, food: 0 });
    assert.deepEqual(loadedB[0].buildings, []);
  });
});
