-- Idempotent migration: persistence for lone Construction Worker transits
-- and paved-road tiles (faction-construction plan, sections 6/7). Mirrors
-- 014_wagons_cargo_trade_routes.sql's games.trade_routes column -- a
-- top-level JSONB array read/written whole per game, same shape as
-- GameState.workerTransits (packages/contracts/src/gameState.ts).

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS worker_transits JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS next_worker_transit_id INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS roaded_tiles JSONB NOT NULL DEFAULT '[]'::jsonb;
