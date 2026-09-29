-- Idempotent migration: unit catalog v1 for recruitment + settlement
-- garrisons (.kilo/plans/1790560842471-unit-recruitment-garrison-plan.md,
-- "Roster / building mapping" + implementation task 2).
--
-- unit_types gains the purchase-economy and arena-combat columns:
--   tier          purchase tier = lowest building level offering the unit
--   upkeep_gold   weekly gold per troop (hero purse / settlement treasury)
--   upkeep_food   weekly food per troop (hero cargo / warehouse)
--   range         arena attack range in hexes; manualBattle's platoonRange
--                 reads it per platoon (replaces the flat
--                 RANGED_ATTACK_RANGE = 6 for all-ranged platoons)
-- "range" is safe unquoted: RANGE is a non-reserved keyword in PostgreSQL
-- (verified against the dev game_db, PG 16.14 -- parsed, inserted, and
-- selected without quoting inside a probe transaction). The engine's
-- UnitType field is likewise named range.
--
-- Also inserts the 13th catalog unit "mage", fixing buildingRegistry's
-- mageGuild recruit entry that referenced a nonexistent id.
--
-- upkeep_gold/upkeep_food stay at their DEFAULT 1 for every unit: the
-- roster locks all thirteen units at 1/1 to preserve the current
-- hero-economy behavior exactly (per-unit tuning is explicitly deferred),
-- so no UPDATE is needed for either column.
ALTER TABLE unit_types
  ADD COLUMN IF NOT EXISTS tier SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS upkeep_gold INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS upkeep_food INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS range INTEGER NOT NULL DEFAULT 1;

INSERT INTO unit_types (id, name, attack, defence, health, speed, description, advantage_type) VALUES
  ('mage', 'Mage', 6, 3, 6, 4, 'Guild-trained battle casters whose bolts of raw arcana strike from afar.', 'ranged')
ON CONFLICT (id) DO NOTHING;

-- 007's guarded pattern: only applies while the row still carries the
-- DEFAULT specialty, i.e. effectively "if it was just inserted" -- a later
-- tuning change to mage's specialty won't be clobbered by a re-run.
UPDATE unit_types SET specialty = 'arcane', specialty_priority = 1.2 WHERE id = 'mage' AND specialty = 'militia';

-- Arena attack range (hexes) per the roster table. Melee units and monsters
-- are pinned at 1; only archer/crossbowman/monk/mage outrange melee.
UPDATE unit_types SET range = 1 WHERE id IN ('peasant', 'swordsman', 'pikeman', 'cavalry', 'crusader', 'griffin', 'hydra', 'wisp', 'black_dragon');
UPDATE unit_types SET range = 4 WHERE id IN ('monk');
UPDATE unit_types SET range = 5 WHERE id IN ('archer');
UPDATE unit_types SET range = 6 WHERE id IN ('crossbowman', 'mage');

-- Purchase tier: 1 = level-1 buildings, 2 = level-2, 3 = level-3 /
-- non-purchasable monsters. Mage is tier 2 (level-2 mageGuild).
UPDATE unit_types SET tier = 1 WHERE id IN ('peasant', 'archer', 'swordsman', 'monk');
UPDATE unit_types SET tier = 2 WHERE id IN ('crossbowman', 'pikeman', 'cavalry', 'mage');
UPDATE unit_types SET tier = 3 WHERE id IN ('crusader', 'griffin', 'hydra', 'wisp', 'black_dragon');
