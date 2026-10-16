-- Idempotent migration: faction roster ladder 1-7 + roster expansion to 16 units.
--
-- tier is REDEFINED by this migration: 015 used it as "purchase tier = lowest
-- building level offering the unit" (1-3). It is now the unit's faction
-- power-band classification, independent of building levels (which remain
-- 1-3 and still gate recruit entries via buildingRegistry's minLevel):
--   1  peasant
--   2  swordsman, crusader
--   3  pikeman, warhound
--   4  archer, crossbowman
--   5  cavalry
--   6  monk, mage
--   7  giant_eagle, eagle_prince
-- Monsters (griffin, hydra, wisp, black_dragon) leave the ladder entirely:
-- tier becomes NULL (neutral, catalog-only content). They remain
-- non-recruitable -- griffin deliberately so.
--
-- tier therefore drops NOT NULL (015 created it as SMALLINT NOT NULL).
-- The three new units ship at the roster-wide flat upkeep 1/1 (per-type
-- tuning is still deferred).
--
-- Recruitment gating is unchanged in kind: huntingLodge offers warhound at
-- building L1; eyrie offers giant_eagle at L1 and eagle_prince at L2 (see
-- packages/engine/src/buildingRegistry.ts).

ALTER TABLE unit_types ALTER COLUMN tier DROP NOT NULL;

INSERT INTO unit_types (id, name, attack, defence, health, speed, description, advantage_type) VALUES
  ('warhound',     'Warhound',     4,  3,  9,  7, 'Crown-bred hunting hounds that run the enemy down in a sprinting pack.', 'monster'),
  ('giant_eagle',  'Giant Eagle',  11, 9,  28, 8, 'The realm''s great eagles -- swift, proud, and loyal to those who feed them.', 'monster'),
  ('eagle_prince', 'Eagle Prince', 14, 12, 38, 9, 'Eldest of the eyerie; battle-proven, near-mythical, the crown''s final word.', 'monster')
ON CONFLICT (id) DO NOTHING;

-- 015's guarded pattern: only applies while the row still carries the
-- DEFAULT specialty, i.e. effectively "if it was just inserted" -- a later
-- tuning change to these units' specialty won't be clobbered by a re-run.
UPDATE unit_types SET specialty = 'monster', specialty_priority = 1.0
WHERE id IN ('warhound', 'giant_eagle', 'eagle_prince') AND specialty = 'militia';

-- Melee across the board (arena attack range in hexes).
UPDATE unit_types SET range = 1 WHERE id IN ('warhound', 'giant_eagle', 'eagle_prince');

-- Faction ladder (1-7), replacing 015's building-level purchase tiers.
UPDATE unit_types SET tier = 1 WHERE id = 'peasant';
UPDATE unit_types SET tier = 2 WHERE id IN ('swordsman', 'crusader');
UPDATE unit_types SET tier = 3 WHERE id IN ('pikeman', 'warhound');
UPDATE unit_types SET tier = 4 WHERE id IN ('archer', 'crossbowman');
UPDATE unit_types SET tier = 5 WHERE id = 'cavalry';
UPDATE unit_types SET tier = 6 WHERE id IN ('monk', 'mage');
UPDATE unit_types SET tier = 7 WHERE id IN ('giant_eagle', 'eagle_prince');

-- Monsters are catalog-only neutral content: outside the faction ladder.
UPDATE unit_types SET tier = NULL WHERE id IN ('griffin', 'hydra', 'wisp', 'black_dragon');
