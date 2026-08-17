import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./persistence/db";

export { pool, withTransaction } from "./persistence/db";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function initSchema(): Promise<void> {
  const sql = readFileSync(join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
  const migration = readFileSync(
    join(__dirname, "migrations", "001_turn_state.sql"),
    "utf8"
  );
  await pool.query(migration);
  const unitTypesMigration = readFileSync(
    join(__dirname, "migrations", "002_unit_types.sql"),
    "utf8"
  );
  await pool.query(unitTypesMigration);
  const resourceTablesMigration = readFileSync(
    join(__dirname, "migrations", "003_resource_tables.sql"),
    "utf8"
  );
  await pool.query(resourceTablesMigration);
  const assetsMigration = readFileSync(
    join(__dirname, "migrations", "004_game_assets.sql"),
    "utf8"
  );
  await pool.query(assetsMigration);
  const unitCountersMigration = readFileSync(
    join(__dirname, "migrations", "005_unit_counters.sql"),
    "utf8"
  );
  await pool.query(unitCountersMigration);
  const unitSpecialtyMigration = readFileSync(
    join(__dirname, "migrations", "007_unit_specialty.sql"),
    "utf8"
  );
  await pool.query(unitSpecialtyMigration);
  const lobbyMigration = readFileSync(
    join(__dirname, "migrations", "008_lobby.sql"),
    "utf8"
  );
  await pool.query(lobbyMigration);
  const granularEntitiesMigration = readFileSync(
    join(__dirname, "migrations", "009_granular_entities.sql"),
    "utf8"
  );
  await pool.query(granularEntitiesMigration);
  const eventSeqMigration = readFileSync(
    join(__dirname, "migrations", "010_event_seq.sql"),
    "utf8"
  );
  await pool.query(eventSeqMigration);
}
