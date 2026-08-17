import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./persistence/db";

export { pool, withTransaction } from "./persistence/db";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function initSchema(): Promise<void> {
  const sql = readFileSync(join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);

  const migrationsDir = join(__dirname, "migrations");
  const migrationFiles = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    const migration = readFileSync(join(migrationsDir, file), "utf8");
    await pool.query(migration);
  }
}
