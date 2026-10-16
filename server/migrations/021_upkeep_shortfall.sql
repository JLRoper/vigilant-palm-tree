-- Idempotent migration: unpaid-upkeep state (hero morale + hero/settlement
-- shortfall counters) + per-tier unit upkeep.
--
-- ── 1. Hero-side upkeep shortfall ──
-- Weekly upkeep (engine hero/upkeep.ts) charges a hero's purse and cargo. A
-- charge a hero cannot cover leaves a recorded shortfall rather than a silent
-- no-op, so the UI can warn and desertion/morale effects have something to
-- key off:
--   morale                    0..100, the hero analogue of settlements.morale
--   upkeep_unpaid_since_day   calendar day of the FIRST unpaid weekly charge
--                              (NULL = paid up). Never reset downward while
--                              a shortfall runs -- it is a streak, not a
--                              per-week flag.
--   upkeep_unpaid_troops      how many troops are currently unfed (unpaid
--                              gold, or no food)
--   upkeep_unpaid_gold        the weekly gold cost attributable to those
--                              unfed troops (the deficit magnitude)
--
-- ── 2. Settlement-side garrison upkeep shortfall ──
-- Same three counters for a settlement's garrison, mirroring the hero block.
-- Settlement morale itself already exists (009) and is untouched here.
--
-- ── 3. Per-tier unit upkeep (unit_types.upkeep_gold / upkeep_food) ──
-- 015 left every one of the 16 catalog units at the flat 1/1 default "to
-- preserve the current hero-economy behavior exactly (per-unit tuning is
-- explicitly deferred)". This migration performs that tuning, deriving BOTH
-- columns from `tier` (the faction power-band ladder redefined by 020: 1
-- peasant .. 7 eagle_prince; the four monsters are NULL, outside the ladder):
--
--   upkeep_gold = COALESCE(tier, 8)
--   upkeep_food = LEAST(3, GREATEST(1, CEIL(COALESCE(tier, 8) / 2.0)))
--
-- resulting in:
--   tier 1 peasant                     1 gold / 1 food
--   tier 2 swordsman, crusader          2 gold / 1 food
--   tier 3 pikeman, warhound            3 gold / 2 food
--   tier 4 archer, crossbowman          4 gold / 2 food
--   tier 5 cavalry                      5 gold / 3 food
--   tier 6 monk, mage                   6 gold / 3 food
--   tier 7 giant_eagle, eagle_prince    7 gold / 3 food
--   NULL   griffin, hydra, wisp,
--          black_dragon                 8 gold / 3 food
--
-- Tier 7 is 7 gold, not 10: upkeep_gold tracks tier one-for-one across the
-- whole ladder (tier N -> N gold), and the four monsters are the only 8.
--
-- THIS IS THE SINGLE SOURCE OF TRUTH for the tier -> upkeep mapping. The
-- engine reads these columns via UnitType.upkeepGold / upkeepFood
-- (packages/engine/src/units.ts's unitUpkeepGold / unitUpkeepFood); it does
-- NOT hardcode the tier numbers anywhere. Retune by editing the two UPDATE
-- statements below, not the engine.
--
-- Every statement is idempotent, so this file re-runs safely at every boot:
-- ADD COLUMN IF NOT EXISTS never fails on a second pass, and the upkeep
-- recomputation below is a pure function of `tier`, so it lands on the same
-- values every time. Note the flip side: because it is unconditional, a
-- hand-tuned per-unit override WILL be reverted on the next boot. Retuning is
-- therefore a migration edit (this file), not a manual UPDATE.

ALTER TABLE heroes
  ADD COLUMN IF NOT EXISTS morale                   INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS upkeep_unpaid_since_day INTEGER,
  ADD COLUMN IF NOT EXISTS upkeep_unpaid_troops    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upkeep_unpaid_gold      INTEGER NOT NULL DEFAULT 0;

ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS garrison_unpaid_since_day INTEGER,
  ADD COLUMN IF NOT EXISTS garrison_unpaid_troops    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS garrison_unpaid_gold      INTEGER NOT NULL DEFAULT 0;

-- Backfill. The NOT NULL DEFAULTs above already populate every pre-existing
-- row, so these are belt-and-braces: they repair any row that predates the
-- default (a column re-added without one) and state the intent explicitly.
-- Historical heroes/settlements were all created paid up and content, so the
-- correct value for every legacy row is the default.
UPDATE heroes SET morale = 100 WHERE morale IS NULL;
UPDATE heroes SET upkeep_unpaid_troops = 0 WHERE upkeep_unpaid_troops IS NULL;
UPDATE heroes SET upkeep_unpaid_gold = 0 WHERE upkeep_unpaid_gold IS NULL;
-- upkeep_unpaid_since_day is intentionally left NULL for every legacy row --
-- no charge was ever missed, so there is no streak to record. No UPDATE needed.

UPDATE settlements SET garrison_unpaid_troops = 0 WHERE garrison_unpaid_troops IS NULL;
UPDATE settlements SET garrison_unpaid_gold = 0 WHERE garrison_unpaid_gold IS NULL;
-- garrison_unpaid_since_day stays NULL for every legacy row, same reasoning.

-- Unit catalog upkeep, derived from the faction ladder (see the formula in
-- this file's header). Two statements rather than one CASE so the gold and
-- food rules stay independently tunable.
UPDATE unit_types SET upkeep_gold = COALESCE(tier, 8);
UPDATE unit_types SET upkeep_food = LEAST(3, GREATEST(1, CEIL(COALESCE(tier, 8) / 2.0)));