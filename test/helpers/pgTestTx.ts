import type { PoolClient } from "pg";
import { pool } from "../../server/persistence/db";

// Runs fn against a client inside an open transaction that is always rolled
// back afterwards, regardless of pass/fail - so repo tests never leave
// residue in the shared dev/CI Postgres database. Bind repos to the same
// client (e.g. createGameRepo(client)) so their reads see the test's own
// uncommitted writes.
export async function withRollback<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}
