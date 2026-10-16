import { test } from "node:test";
import assert from "node:assert/strict";
import { poolConfig } from "../../server/persistence/db";

// Phase 3 pool hardening (plan 20261004-2210): the pool's contract as a pure
// function of the environment. No socket is opened -- importing db.ts
// constructs the lazy pg Pool, which connects on first query only.

const BASE = {
  PGHOST: "db-host",
  PGPORT: "6543",
  PGUSER: "pooluser",
  PGPASSWORD: "poolpass",
  PGDATABASE: "pooldb",
};

test("connection fields pass through exactly as before the hardening", () => {
  const cfg = poolConfig(BASE);
  assert.equal(cfg.host, "db-host");
  assert.equal(cfg.port, 6543);
  assert.equal(cfg.user, "pooluser");
  assert.equal(cfg.password, "poolpass");
  assert.equal(cfg.database, "pooldb");
});

test("hardening defaults apply when the env vars are unset", () => {
  const cfg = poolConfig({});
  assert.equal(cfg.host, "localhost");
  assert.equal(cfg.port, 5432);
  assert.equal(cfg.user, "gameuser");
  assert.equal(cfg.password, "gamepass");
  assert.equal(cfg.database, "game_poc");
  assert.equal(cfg.max, 10);
  assert.equal(cfg.connectionTimeoutMillis, 5_000);
  assert.equal(cfg.idleTimeoutMillis, 30_000);
  assert.equal(cfg.statement_timeout, 30_000);
  assert.equal(cfg.idle_in_transaction_session_timeout, 30_000);
});

test("explicit overrides flow through", () => {
  const cfg = poolConfig({
    ...BASE,
    PGPOOL_MAX: "3",
    PGPOOL_CONNECT_TIMEOUT_MS: "1000",
    PGPOOL_IDLE_TIMEOUT_MS: "5000",
    PG_STATEMENT_TIMEOUT_MS: "8000",
    PG_IDLE_TX_TIMEOUT_MS: "9000",
  });
  assert.equal(cfg.max, 3);
  assert.equal(cfg.connectionTimeoutMillis, 1_000);
  assert.equal(cfg.idleTimeoutMillis, 5_000);
  assert.equal(cfg.statement_timeout, 8_000);
  assert.equal(cfg.idle_in_transaction_session_timeout, 9_000);
});

test("garbage and empty values fall back to defaults; explicit 0 is respected", () => {
  const cfg = poolConfig({
    PGPOOL_MAX: "abc",
    PGPOOL_CONNECT_TIMEOUT_MS: "",
    PG_STATEMENT_TIMEOUT_MS: "0",
    PG_IDLE_TX_TIMEOUT_MS: "-5",
  });
  assert.equal(cfg.max, 10);
  assert.equal(cfg.connectionTimeoutMillis, 5_000);
  assert.equal(cfg.statement_timeout, 0, "0 explicitly disables the statement guard");
  assert.equal(cfg.idle_in_transaction_session_timeout, 30_000);
});
