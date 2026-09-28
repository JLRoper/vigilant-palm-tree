-- docs/wagons-stockpiles-trade-routes-plan.md (2026-09-27), phases 2+4.
--
-- Heroes gain their wagon count and personal resource cargo. Both columns
-- are optional on HeroState (helper-accessed, legacy-save friendly), so the
-- granular columns carry defaults and the JSONB fallback path needs nothing.
ALTER TABLE heroes
  ADD COLUMN IF NOT EXISTS wagons INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS resources JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Trade routes ride the games row as JSONB (same shape as GameState.
-- tradeRoutes: TradeRouteState[] with the embedded caravan). Routes are
-- always read/written whole per game -- a granular table would buy nothing.
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS trade_routes JSONB NOT NULL DEFAULT '[]'::jsonb;
