-- Idempotent migration: adds the type-advantage tag used by the combat
-- resolver (feature-plans/CombatResolutionEngine.md "Damage formula &
-- type-advantage chart"). Base triangle (infantry beats cavalry, cavalry
-- beats ranged, ranged beats infantry) plus a one-way "monster" tag that's
-- always advantaged attacking but never disadvantaged — see
-- shared/combatConfig.ts TYPE_TRIANGLE for the multiplier logic.
ALTER TABLE unit_types ADD COLUMN IF NOT EXISTS advantage_type TEXT NOT NULL DEFAULT 'infantry'
  CHECK (advantage_type IN ('infantry', 'cavalry', 'ranged', 'monster'));
ALTER TABLE unit_types DROP COLUMN IF EXISTS counter_type;
ALTER TABLE unit_types DROP COLUMN IF EXISTS strong_against;

UPDATE unit_types SET advantage_type = 'infantry'
  WHERE id IN ('peasant', 'swordsman', 'pikeman', 'crusader');
UPDATE unit_types SET advantage_type = 'cavalry'
  WHERE id IN ('cavalry');
UPDATE unit_types SET advantage_type = 'ranged'
  WHERE id IN ('archer', 'crossbowman', 'monk');
UPDATE unit_types SET advantage_type = 'monster'
  WHERE id IN ('griffin', 'hydra', 'wisp', 'black_dragon');
