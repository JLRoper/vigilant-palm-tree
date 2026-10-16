-- Idempotent migration: every numeric game column becomes NUMERIC — the
-- rounding shadow is dead.
--
-- ── History ──
-- The engine deliberately models every numeric game quantity as a 2-decimal
-- float: producers.ts's producerTurnOutput rounds a farmField's yield to
-- 100ths (e.g. 6.4 food), produceResources.ts applies the same round2 to gold,
-- and consumption.ts's moraleDecay drives morale onto continuous values like
-- 90.4. But every column these landed in was declared INTEGER, and Postgres
-- rejects a float write into INTEGER outright ("invalid input syntax for type
-- integer: \"4171.6\""), aborting the whole statement's transaction — which is
-- what made a single food-producing settlement turn EVERY EndTurn into an
-- HTTP 500.
--
-- The interim fix (server/persistence/integerColumns.ts's toIntColumn(),
-- 2026-10-01) rounded at the persistence boundary: Math.round at all 8 write
-- sites, on the reasoning that Math.round never moves a value by more than
-- half a coin while Math.floor would silently destroy 0.6 of real farm gold
-- per persist. That unblocked every EndTurn but created a permanent,
-- documented known limitation: the granular tables (heroes, settlements,
-- settlement_resources, settlement_snapshots, resource_transactions, and the
-- legacy games.gold total) were a *rounded shadow* of the full-precision
-- games.heroes/games.settlements JSONB — and server/persistence/hydrate.ts
-- PREFERS the granular tables when both are populated, so every granular-read
-- game shed up to half a coin per quantity per command, compounding with each
-- load/save cycle.
--
-- ── This migration ──
-- Widens every numeric game column to NUMERIC so full-precision values
-- persist exactly. Postgres's NUMERIC is exact decimal: a 2-decimal engine
-- value round-trips bit-for-bit (the node-postgres side of that contract is
-- the OID-1700 type parser registered in server/persistence/pgTypes.ts —
-- without it node-postgres hands NUMERIC back as a STRING).
--
-- Affected columns, matching the old toIntColumn() call sites exactly:
--   games.gold                          (schema.sql — legacy cross-player total)
--   settlements.gold, settlements.morale
--   settlement_resources.amount         (the warehouse mirror)
--   heroes.gold, heroes.morale
--   settlement_snapshots.gold / .morale / .effective_income   (#89 tables)
--   resource_transactions.amount / .gold_paid                 (#89 tables)
--
-- Deliberately NOT touched: the *_unpaid_gold shortfall counters
-- (heroes.upkeep_unpaid_gold, settlements.garrison_unpaid_gold) stay INTEGER —
-- they are sums of per-unit upkeep, which is integral by construction.
-- movement_remaining is already DOUBLE PRECISION (011). The NUMERIC rate
-- columns (settlements.gold_rate, settlement_resources.rate) already existed.
--
-- Idempotence: ALTER COLUMN ... TYPE to the type it already has re-runs as a
-- clean no-op (migrations re-run at every boot, server/db.ts, sorted by
-- filename), and the INTEGER -> NUMERIC widening preserves NOT NULL, DEFAULT,
-- and every existing value exactly. integerColumns.ts predates this file; it
-- is now a shadow-free full-precision write guard.

ALTER TABLE games
  ALTER COLUMN gold TYPE NUMERIC;

ALTER TABLE settlements
  ALTER COLUMN gold TYPE NUMERIC,
  ALTER COLUMN morale TYPE NUMERIC;

ALTER TABLE settlement_resources
  ALTER COLUMN amount TYPE NUMERIC;

ALTER TABLE heroes
  ALTER COLUMN gold TYPE NUMERIC,
  ALTER COLUMN morale TYPE NUMERIC;

ALTER TABLE settlement_snapshots
  ALTER COLUMN gold TYPE NUMERIC,
  ALTER COLUMN morale TYPE NUMERIC,
  ALTER COLUMN effective_income TYPE NUMERIC;

ALTER TABLE resource_transactions
  ALTER COLUMN amount TYPE NUMERIC,
  ALTER COLUMN gold_paid TYPE NUMERIC;
