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

test("settlementRepo.upsertMany round-trips fractional gold/morale/warehouse at full precision (migration 027 NUMERIC columns)", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);
    // The fractional shapes the engine actually produces: round2'd gold
    // production (500.55), a continuous foodDeficitRatio morale (90.4), and a
    // hundredths-rounded food output in the warehouse (6.45). Under the old
    // INTEGER columns the write boundary rounded all three; the granular read
    // is what hydrateFromRepos PREFERS, so that rounding was a recurring
    // per-command loss.
    const settlement = makeSettlement("s0", 0, 3, 4, {
      gold: 500.55,
      morale: 90.4,
      warehouse: emptyWarehouse({ wood: 12.25, food: 6.45 }),
    });

    await repo.upsertMany(name, { s0: settlement });
    const loaded = await repo.loadAllForGame(name);

    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].gold, 500.55);
    assert.equal(loaded[0].morale, 90.4);
    assert.equal(loaded[0].warehouse.wood, 12.25);
    assert.equal(loaded[0].warehouse.food, 6.45);
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
        { gx: 3, gy: 4, kind: "market", level: 2, style: "blocky", w: 2, h: 2, construction: { daysRemaining: 3 } },
      ],
    });

    await repo.upsertMany(name, { s0: settlement });
    const [loaded] = await repo.loadAllForGame(name);

    assert.deepEqual(loaded.buildings, settlement.buildings, "construction state must round-trip; finished buildings must not gain a key");
  });
});

test("settlementRepo round-trips a per-building bank pot (and absent stays absent)", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);
    const settlement = makeSettlement("s0", 0, 3, 4, {
      buildings: [
        {
          gx: 1,
          gy: 1,
          kind: "bank",
          level: 2,
          style: "classic",
          bank: {
            gold: 1234,
            pendingOut: [
              { gold: 100, maturesOnDay: 12 },
              { gold: 250, maturesOnDay: 19 },
            ],
          },
        },
        // No pot: the key must be absent on the way back out, never
        // `undefined` -- an explicit undefined key is not deepStrictEqual to
        // an omitted one, which is the same trap `construction` documents.
        { gx: 4, gy: 4, kind: "treasury", level: 1, style: "classic" },
        // Empty pot (0 gold, nothing pending) is NOT the same as absent and
        // must still round-trip -- `bank: {}` is falsy-adjacent but truthy.
        { gx: 6, gy: 6, kind: "bank", level: 1, style: "classic", bank: { gold: 0, pendingOut: [] } },
      ],
    });

    await repo.upsertMany(name, { s0: settlement });
    const [loaded] = await repo.loadAllForGame(name);

    assert.deepEqual(loaded.buildings, settlement.buildings, "pot state must round-trip byte-for-byte");
    assert.equal(loaded.buildings[0]?.bank?.gold, 1234);
    assert.equal(loaded.buildings[0]?.bank?.pendingOut.length, 2);
    assert.ok(
      !("bank" in (loaded.buildings[1] as object)),
      "a building with no pot must come back without the key at all",
    );
    assert.ok("bank" in (loaded.buildings[2] as object), "an opened-but-empty pot still carries the key");
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

test("settlementRepo.upsertMany round-trips the garrison unpaid-upkeep shortfall counters", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);
    // Non-default values on all three: the paid-up default is already
    // exercised by every other round-trip in this file.
    const settlement = makeSettlement("s0", 0, 3, 4, {
      garrisonUnpaidSinceDay: 21,
      garrisonUnpaidTroops: 14,
      garrisonUnpaidGold: 112,
    });

    await repo.upsertMany(name, { s0: settlement });
    const [loaded] = await repo.loadAllForGame(name);

    assert.equal(loaded.garrisonUnpaidSinceDay, 21);
    assert.equal(loaded.garrisonUnpaidTroops, 14);
    assert.equal(loaded.garrisonUnpaidGold, 112);
    assert.deepEqual(loaded, settlement);
  });
});

test("settlementRepo.upsertMany clears the garrison upkeep streak back to paid up on update", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGame(client, name);
    const repo = createSettlementRepo(client);
    await repo.upsertMany(name, {
      s0: makeSettlement("s0", 0, 1, 1, {
        garrisonUnpaidSinceDay: 8,
        garrisonUnpaidTroops: 6,
        garrisonUnpaidGold: 48,
      }),
    });

    const paidUp = makeSettlement("s0", 0, 1, 1);
    await repo.upsertMany(name, { s0: paidUp });
    const [loaded] = await repo.loadAllForGame(name);

    assert.equal(loaded.garrisonUnpaidSinceDay, null);
    assert.equal(loaded.garrisonUnpaidTroops, 0);
    assert.equal(loaded.garrisonUnpaidGold, 0);
  });
});
