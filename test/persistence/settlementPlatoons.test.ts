import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import type { Platoon } from "@heroes/contracts";
import { normalizePlatoons, settlementStacks } from "@heroes/engine";
import { withRollback } from "../helpers/pgTestTx";
import { pool } from "../../server/persistence/db";
import { createSettlementRepo } from "../../server/persistence/repositories/settlementRepo";
import { makeHero, makeSettlement } from "../charter/_helpers";

// withRollback pulls in the shared pg pool; close it once this file's tests
// are done so node:test's process can exit promptly instead of waiting out
// the pool's idle timeout -- same convention as test/persistence/*.test.ts.
after(() => pool.end());

// Round-trip check for migration 016's settlement_platoons
// (unit-recruitment/garrison plan task 10): SettlementState.stacks written
// through settlementRepo.upsertMany must come back intact via the granular
// read, stale rows must be replaced on update (delete+insert per upsert),
// and a settlement with no garrison must write zero rows and read back
// without the optional stacks key at all.

function uniqueName(): string {
  return `test-settlement-platoons-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function seedGameRow(client: PoolClient, name: string): Promise<void> {
  await client.query(
    `INSERT INTO games (name, seed, hero_q, hero_r, heroes, settlements)
     VALUES ($1, 1, 0, 0, $2::jsonb, $3::jsonb)`,
    [name, JSON.stringify({ h0: makeHero("h0", 0, 2, 2) }), JSON.stringify({})],
  );
}

function garrison(): Platoon[] {
  return [
    { entries: [{ unitTypeId: "swordsman", count: 2 }] },
    { entries: [{ unitTypeId: "archer", count: 1 }, { unitTypeId: "swordsman", count: 1 }] },
  ];
}

async function platoonRows(client: PoolClient, settlementId: string): Promise<Array<{ stack_index: number; unit_type_id: string; count: number }>> {
  const result = await client.query(
    `SELECT stack_index, unit_type_id, count FROM settlement_platoons
     WHERE settlement_id = $1 ORDER BY stack_index, unit_type_id`,
    [settlementId],
  );
  return result.rows;
}

test("settlement garrison stacks round-trip through settlementRepo dual-write + granular read-back, normalized to 8 slots", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGameRow(client, name);
    const repo = createSettlementRepo(client);
    await repo.upsertMany(name, {
      s0: { ...makeSettlement("s0", 0, 2, 2), stacks: garrison() },
    });

    assert.deepEqual(await platoonRows(client, "s0"), [
      { stack_index: 0, unit_type_id: "swordsman", count: 2 },
      { stack_index: 1, unit_type_id: "archer", count: 1 },
      { stack_index: 1, unit_type_id: "swordsman", count: 1 },
    ]);

    const loaded = (await repo.loadAllForGame(name)).find((s) => s.id === "s0");
    assert.ok(loaded, "settlement read back");
    assert.ok("stacks" in loaded, "a garrisoned settlement carries the stacks key");
    assert.deepEqual(loaded.stacks, normalizePlatoons(garrison()));
    assert.equal(loaded.stacks?.length, 8);
  });
});

test("updating a garrison replaces the stale platoon rows wholesale (delete+insert per upsert)", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGameRow(client, name);
    const repo = createSettlementRepo(client);
    await repo.upsertMany(name, {
      s0: { ...makeSettlement("s0", 0, 2, 2), stacks: garrison() },
    });
    const updated: Platoon[] = [{ entries: [{ unitTypeId: "cavalry", count: 4 }] }];
    await repo.upsertMany(name, {
      s0: { ...makeSettlement("s0", 0, 2, 2), stacks: updated },
    });

    assert.deepEqual(await platoonRows(client, "s0"), [
      { stack_index: 0, unit_type_id: "cavalry", count: 4 },
    ], "no swordsman/archer rows may survive the update");

    const loaded = (await repo.loadAllForGame(name)).find((s) => s.id === "s0");
    assert.ok(loaded);
    assert.deepEqual(loaded.stacks, normalizePlatoons(updated));
  });
});

test("a settlement with no garrison writes zero platoon rows and reads back key-less (settlementStacks -> 8 empty)", async () => {
  await withRollback(async (client) => {
    const name = uniqueName();
    await seedGameRow(client, name);
    const repo = createSettlementRepo(client);
    await repo.upsertMany(name, {
      s0: makeSettlement("s0", 0, 2, 2),
      s1: { ...makeSettlement("s1", 0, 5, 5), stacks: garrison() },
    });

    const count = await client.query(
      `SELECT count(*)::int AS n FROM settlement_platoons WHERE settlement_id = $1`,
      ["s0"],
    );
    assert.equal(count.rows[0].n, 0, "stacks-less settlement must write no rows");
    assert.equal((await platoonRows(client, "s1")).length, 3, "sibling with a garrison still writes its rows");

    const loaded = (await repo.loadAllForGame(name)).find((s) => s.id === "s0");
    assert.ok(loaded);
    assert.equal("stacks" in loaded, false, "no stacks key on the round-tripped settlement");
    const stacks = settlementStacks(loaded);
    assert.equal(stacks.length, 8);
    assert.ok(stacks.every((p) => p.entries.length === 0));
  });
});
