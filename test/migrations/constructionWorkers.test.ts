import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pool } from "../../server/persistence/db";
import { initSchema } from "../../server/db";
import { withRollback } from "../helpers/pgTestTx";

// Mirrors test/migrations/rosterParity.test.ts's pattern for
// 034_construction_workers.sql (faction-construction plan, section 3).

const expectedUnits = [
  ["construction_worker_human", "human", 1, 1, 8, 4, 1, "infantry", "militia", 0.5, 5],
  ["construction_worker_ashen", "ashen", 1, 1, 8, 4, 1, "infantry", "militia", 0.5, 5],
  ["construction_worker_ironmark", "ironmark", 1, 1, 8, 4, 1, "infantry", "militia", 0.5, 5],
  ["construction_worker_verdant", "verdant", 1, 1, 8, 4, 1, "infantry", "militia", 0.5, 5],
] as const;
const newIds = expectedUnits.map(([id]) => id);

after(() => pool.end());

test("construction worker migration seeds full first-boot metadata with zero upkeep, and reruns safely", async () => {
  await initSchema();
  const sql = await readFile(new URL("../../server/migrations/034_construction_workers.sql", import.meta.url), "utf8");
  await withRollback(async (client) => {
    await client.query("DELETE FROM unit_types WHERE id = ANY($1::text[])", [newIds]);
    await client.query(sql);
    const first = await client.query("SELECT * FROM unit_types WHERE id = ANY($1::text[]) ORDER BY id", [newIds]);
    assert.equal(first.rowCount, 4);
    for (const row of first.rows) {
      assert.notEqual(row.faction_id, "neutral");
      assert.ok(row.description.length > 0);
      // Deliberate deviation from 021/033's COALESCE(tier, 8) formula: zero
      // ongoing upkeep (see the migration's own header comment) -- the
      // 650g recruit cost is the only gold this unit ever asks for.
      assert.equal(row.upkeep_gold, 0);
      assert.equal(row.upkeep_food, 0);
    }
    for (const expected of expectedUnits) {
      const row = first.rows.find((entry) => entry.id === expected[0]);
      assert.ok(row);
      assert.deepEqual(
        [row.id, row.faction_id, row.attack, row.defence, row.health, row.speed, row.range, row.advantage_type, row.specialty, Number(row.specialty_priority), row.tier],
        [...expected],
      );
    }
    // Idempotent re-run: a second application must be a no-op.
    await client.query(sql);
    const second = await client.query("SELECT * FROM unit_types WHERE id = ANY($1::text[]) ORDER BY id", [newIds]);
    assert.deepEqual(second.rows, first.rows);
    // A later tuning pass is never clobbered (033's guarded-UPDATE contract):
    // the faction_id guard only fires while still 'neutral', and the
    // upkeep guards only fire while still the column DEFAULT of 1.
    await client.query("UPDATE unit_types SET tier = 7, faction_id = 'human', upkeep_gold = 9, upkeep_food = 2 WHERE id = 'construction_worker_ashen'");
    await client.query(sql);
    const tuned = await client.query("SELECT tier, faction_id, upkeep_gold, upkeep_food FROM unit_types WHERE id = 'construction_worker_ashen'");
    assert.equal(tuned.rows[0].tier, 7);
    assert.equal(tuned.rows[0].faction_id, "human", "the faction_id guard does not re-fire on an already-tagged row");
    assert.equal(tuned.rows[0].upkeep_gold, 9, "the upkeep guard does not re-fire once tuned off its DEFAULT of 1");
    assert.equal(tuned.rows[0].upkeep_food, 2);
  });
});
