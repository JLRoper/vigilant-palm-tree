import { Pool, type PoolClient, type PoolConfig } from "pg";
import "./pgTypes";

export type { PoolClient };

function intFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

// The pool's contract as a pure function of the environment, so it is
// unit-testable without opening a socket. Phase 3 pool hardening (plan
// 20261004-2210_ai-actor-phase3-watchdog-pool): explicit budget + fail-fast
// backpressure + per-session statement guards on top of the original
// connection fields (identical defaults when the new env vars are unset).
export function poolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  return {
    host: env.PGHOST ?? "localhost",
    // The db runs in a single shared docker-compose container on a fixed
    // host port (see docker-compose.yml). scripts/allocate-ports.ts only
    // allocates API_PORT/CLIENT_PORT/WS_PORT per worktree - it never writes
    // a DB port, so there's nothing per-worktree to read here. PGPORT
    // remains available as an explicit override.
    port: Number(env.PGPORT ?? 5432),
    user: env.PGUSER || "gameuser",
    password: env.PGPASSWORD || "gamepass",
    database: env.PGDATABASE ?? "game_poc",
    // Explicit client budget (was pg's implicit 10). The AI driver holds one
    // dedicated advisory-lock client per drive pass alongside the per-command
    // transaction clients, so the ceiling is stated, not accidental.
    max: intFromEnv(env.PGPOOL_MAX, 10),
    // Backpressure: an exhausted pool FAILS FAST instead of queueing a
    // connect forever (the silent-hang failure mode). defaultWithGameLock
    // maps this to its skipped_locked outcome.
    connectionTimeoutMillis: intFromEnv(env.PGPOOL_CONNECT_TIMEOUT_MS, 5_000),
    idleTimeoutMillis: intFromEnv(env.PGPOOL_IDLE_TIMEOUT_MS, 30_000),
    // Per-session guards (pg sends these as startup parameters): a wedged
    // query or a leaked BEGIN can no longer pin a pooled client forever.
    statement_timeout: intFromEnv(env.PG_STATEMENT_TIMEOUT_MS, 30_000),
    idle_in_transaction_session_timeout: intFromEnv(env.PG_IDLE_TX_TIMEOUT_MS, 30_000),
  };
}

export const pool = new Pool(poolConfig());

// When Postgres goes away (server restart, docker stop), terminated idle
// pool clients surface as Pool 'error' events. Without a listener the
// unhandled 'error' event crashes the process (observed 2026-09-28: the
// API died in 0.06s and crash-looped for the whole outage instead of
// letting server/persistence/eventsNotifier.ts's designed backoff
// engage). Logging and surviving lets the pool hand out fresh
// connections on the next query.
pool.on("error", (err: Error) => {
  console.error("[api] pg idle client connection error:", err.message);
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
