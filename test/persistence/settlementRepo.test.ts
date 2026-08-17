import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { withRollback } from "../helpers/pgTestTx";
import { pool } from "../../server/persistence/db";
import { createSettlementRepo } from "../../server/persistence/repositories/settlementRepo";
import { emptyWarehouse, makeSettlement } from "../charter/_helpers";

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

test("settlementRepo.loadAllForGame returns [] for a game with no settlements", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);

    assert.deepEqual(await repo.loadAllForGame(name), []);
  });
});

test("settlementRepo.upsertMany writes a settlement and loadAllForGame reads it back", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);
    const settlement = makeSettlement("s0", 0, 3, 4, {
      warehouse: emptyWarehouse({ wood: 12, food: 5 }),
      gold: 200,
    });

    await repo.upsertMany(name, { s0: settlement });
    const loaded = await repo.loadAllForGame(name);

    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0], settlement);
  });
});

test("settlementRepo.upsertMany round-trips a partial resourceRates including gold", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);
    // Deliberately partial (only wood + gold have a rate) -- resourceRates
    // is Partial<Record<ResourceType, number>>, and ResourceType includes
    // "gold" even though Warehouse doesn't track it (see the note on
    // settlements.gold_rate in server/migrations/009_granular_entities.sql).
    const settlement = makeSettlement("s0", 0, 3, 4, {
      resourceRates: { wood: 15, gold: 20 },
    });

    await repo.upsertMany(name, { s0: settlement });
    const [loaded] = await repo.loadAllForGame(name);

    assert.deepEqual(loaded.resourceRates, { wood: 15, gold: 20 });
    assert.equal(loaded.resourceRates.stone, undefined);
  });
});

test("settlementRepo.upsertMany round-trips buildings", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);
    const settlement = makeSettlement("s0", 0, 3, 4, {
      buildings: [
        { gx: 1, gy: 2, kind: "house", level: 1, style: "classic" },
        { gx: 3, gy: 4, kind: "market", level: 2, style: "blocky", w: 2, h: 2 },
      ],
    });

    await repo.upsertMany(name, { s0: settlement });
    const [loaded] = await repo.loadAllForGame(name);

    assert.deepEqual(loaded.buildings, settlement.buildings);
  });
});

test("settlementRepo.upsertMany is a full sync: a settlement missing from the record is deleted", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);
    await repo.upsertMany(name, {
      s0: makeSettlement("s0", 0, 1, 1),
      s1: makeSettlement("s1", 0, 2, 2),
    });

    await repo.upsertMany(name, { s0: makeSettlement("s0", 0, 1, 1) });
    const loaded = await repo.loadAllForGame(name);

    assert.deepEqual(loaded.map((s) => s.id), ["s0"]);
  });
});

test("settlementRepo.upsertMany replaces buildings on update rather than merging them", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);
    await repo.upsertMany(name, {
      s0: makeSettlement("s0", 0, 1, 1, {
        buildings: [{ gx: 1, gy: 1, kind: "house", level: 1, style: "classic" }],
      }),
    });

    const updated = makeSettlement("s0", 0, 1, 1, {
      buildings: [{ gx: 5, gy: 5, kind: "tower", level: 1, style: "classic" }],
    });
    await repo.upsertMany(name, { s0: updated });
    const [loaded] = await repo.loadAllForGame(name);

    assert.deepEqual(loaded.buildings, updated.buildings);
  });
});
