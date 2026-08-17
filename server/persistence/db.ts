import { Pool, type PoolClient } from "pg";

export const pool = new Pool({
  host: process.env.PGHOST ?? "localhost",
  // The db runs in a single shared docker-compose container on a fixed
  // host port (see docker-compose.yml). scripts/allocate-ports.ts only
  // allocates API_PORT/CLIENT_PORT/WS_PORT per worktree - it never writes
  // a DB port, so there's nothing per-worktree to read here. PGPORT
  // remains available as an explicit override.
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER || "gameuser",
  password: process.env.PGPASSWORD || "gamepass",
  database: process.env.PGDATABASE ?? "game_poc",
});

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    console.error("[api] withTransaction rolling back:", err);
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
