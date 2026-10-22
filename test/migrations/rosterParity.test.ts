import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pool } from "../../server/persistence/db";
import { initSchema } from "../../server/db";
import { withRollback } from "../helpers/pgTestTx";

const expectedUnits = [
  ["skeleton_warrior", "ashen", 5, 4, 9, 4, 1, "infantry", "sword", 1, 2],
  ["grave_hound", "ashen", 4, 2, 7, 7, 1, "monster", "monster", 1, 3],
  ["dark_acolyte", "ashen", 5, 3, 12, 4, 4, "ranged", "prayer", 1.2, 6],
  ["necromancer", "ashen", 9, 2, 8, 4, 6, "ranged", "arcane", 1.2, 6],
  ["bone_dragon", "ashen", 12, 7, 28, 7, 1, "monster", "monster", 1, 7],
  ["tunnel_levy", "ironmark", 1, 2, 4, 2, 1, "infantry", "militia", 1, 1],
  ["war_boar", "ironmark", 3, 4, 9, 5, 1, "monster", "monster", 1, 3],
  ["axe_thrower", "ironmark", 4, 3, 6, 3, 4, "ranged", "archery", 1, 4],
  ["hearth_priest", "ironmark", 4, 5, 15, 3, 4, "ranged", "prayer", 1.2, 6],
  ["ram_rider", "ironmark", 7, 7, 17, 5, 1, "cavalry", "cavalry", 1, 5],
  ["sproutling", "verdant", 1, 1, 3, 4, 1, "infantry", "militia", 1, 1],
  ["bramble_blade", "verdant", 4, 5, 9, 5, 1, "infantry", "sword", 1, 2],
  ["wildwood_ranger", "verdant", 6, 2, 7, 5, 6, "ranged", "archery", 1, 4],
  ["druid", "verdant", 8, 3, 9, 4, 5, "ranged", "arcane", 1.2, 6],
  ["ursine_guardian", "verdant", 8, 8, 22, 4, 1, "monster", "monster", 1, 5],
] as const;
const newIds = expectedUnits.map(([id]) => id);

after(() => pool.end());

test("roster parity seeds full first-boot metadata and tier upkeep, and reruns safely", async () => {
  await initSchema();
  const sql = await readFile(new URL("../../server/migrations/032_roster_parity.sql", import.meta.url), "utf8");
  await withRollback(async (client) => {
    await client.query("DELETE FROM unit_types WHERE id = ANY($1::text[])", [newIds]);
    await client.query(sql);
    const first = await client.query("SELECT * FROM unit_types WHERE id = ANY($1::text[]) ORDER BY id", [newIds]);
    assert.equal(first.rowCount, 15);
    const balanced = await client.query("SELECT attack, defence, health, speed FROM unit_types WHERE id = 'ghoul'");
    assert.deepEqual(balanced.rows[0], { attack: 2, defence: 1, health: 4, speed: 5 });
    await client.query("UPDATE unit_types SET attack = 99, defence = 99, health = 99 WHERE id = 'ghoul'");
    for (const row of first.rows) {
      assert.notEqual(row.faction_id, "neutral");
      assert.ok(row.description.length > 0);
      assert.equal(row.upkeep_gold, row.tier);
      assert.equal(row.upkeep_food, Math.min(3, Math.max(1, Math.ceil(row.tier / 2))));
    }
    for (const expected of expectedUnits) {
      const row = first.rows.find((entry) => entry.id === expected[0]);
      assert.ok(row);
      assert.deepEqual(
        [row.id, row.faction_id, row.attack, row.defence, row.health, row.speed, row.range, row.advantage_type, row.specialty, Number(row.specialty_priority), row.tier],
        [...expected],
      );
    }
    await client.query(sql);
    const second = await client.query("SELECT * FROM unit_types WHERE id = ANY($1::text[]) ORDER BY id", [newIds]);
    assert.deepEqual(second.rows, first.rows);
    const restored = await client.query("SELECT attack, defence, health, speed FROM unit_types WHERE id = 'ghoul'");
    assert.deepEqual(restored.rows[0], balanced.rows[0]);
    await client.query("UPDATE unit_types SET specialty = 'cavalry', specialty_priority = 2, range = 9, tier = 5, faction_id = 'human' WHERE id = 'necromancer'");
    await client.query(sql);
    const tuned = await client.query("SELECT specialty, specialty_priority, range, tier, faction_id, upkeep_gold, upkeep_food FROM unit_types WHERE id = 'necromancer'");
    assert.equal(tuned.rows[0].specialty, "cavalry");
    assert.equal(Number(tuned.rows[0].specialty_priority), 2);
    assert.equal(tuned.rows[0].range, 9);
    assert.equal(tuned.rows[0].tier, 5);
    assert.equal(tuned.rows[0].faction_id, "human");
    assert.equal(tuned.rows[0].upkeep_gold, 5);
    assert.equal(tuned.rows[0].upkeep_food, 3);
  });
});
