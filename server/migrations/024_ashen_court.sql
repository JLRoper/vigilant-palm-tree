-- Idempotent migration: The Ashen Court roster — the game's second playable
-- faction (plan .plans/20261002-0050_faction-ashen-court_UNCLAIMED.md).
--
-- Seven undead units filling the faction ladder's 1-7 power bands (the 020
-- tier semantics: faction power-band classification, NOT purchase tier):
--   1  ghoul           infantry   the Court's cheap fast levy
--   3  bone_pikeman    infantry    the wall that does not flee
--   4  bone_archer     ranged      revenant bowmen
--   4  wraith          ranged      spectral touch
--   5  blood_knight    cavalry     dread cavalry
--   6  vampire_lord    infantry    the undead aristocracy
--   7  lich            ranged      the Court's cold crown
--
-- advantage_type stays a combat-triangle value (infantry/cavalry/ranged/
-- monster) exactly like every other unit; faction_id = 'ashen' is the roster
-- tag (006's column). All seven ship at the roster-flat upkeep_gold/
-- upkeep_food DEFAULT 1/1 like every existing unit — per-type tuning is a
-- later migration (021's source-of-truth rule).
--
-- The guarded pattern (specialty UPDATE AND specialty = 'militia',
-- faction_id UPDATE AND faction_id = 'neutral') matches 020/006: re-runs
-- only touch rows that still carry their DEFAULTs, so a later tuning pass
-- is never clobbered. Migrations re-run at every boot (server/db.ts), sorted
-- by filename.

INSERT INTO unit_types (id, name, attack, defence, health, speed, description, advantage_type) VALUES
  ('ghoul',         'Ghoul',         3,  1,  5, 5, 'Grave-scavengers pressed into the Court''s levy; fast, fragile, and always hungry.',        'infantry'),
  ('bone_pikeman',  'Bone Pikeman',  3,  8, 12, 3, 'Reassembled spearmen bound by wire and will; the wall that does not flee.',               'infantry'),
  ('bone_archer',   'Bone Archer',   4,  2,  5, 4, 'Rattling ranks of revenant bowmen whose arrows remember their living aim.',                'ranged'),
  ('wraith',        'Wraith',        6,  3,  7, 6, 'Grief given form; its touch drains the warmth from armor and wearer alike.',               'ranged'),
  ('blood_knight',  'Blood Knight',  8,  6, 17, 6, 'A dread cavalryman sworn on empty veins, charging where the living cannot follow.',       'cavalry'),
  ('vampire_lord',  'Vampire Lord', 11,  8, 26, 6, 'Aristocrat of the long night; what it slays, it owns.',                                 'infantry'),
  ('lich',          'Lich',         13,  8, 30, 5, 'A magister who traded mortality for tenure; the Court''s cold crown.',                     'ranged')
ON CONFLICT (id) DO NOTHING;

-- 007's guarded pattern: only applies while the row still carries the
-- DEFAULT specialty (i.e. effectively "if it was just inserted").
UPDATE unit_types SET specialty = 'militia', specialty_priority = 1.0 WHERE id = 'ghoul'         AND specialty = 'militia';
UPDATE unit_types SET specialty = 'pike',   specialty_priority = 1.0 WHERE id = 'bone_pikeman'  AND specialty = 'militia';
UPDATE unit_types SET specialty = 'archery', specialty_priority = 1.0 WHERE id = 'bone_archer'   AND specialty = 'militia';
UPDATE unit_types SET specialty = 'arcane', specialty_priority = 1.2 WHERE id = 'wraith'        AND specialty = 'militia';
UPDATE unit_types SET specialty = 'cavalry', specialty_priority = 1.0 WHERE id = 'blood_knight'  AND specialty = 'militia';
UPDATE unit_types SET specialty = 'sword',   specialty_priority = 1.0 WHERE id = 'vampire_lord'  AND specialty = 'militia';
UPDATE unit_types SET specialty = 'arcane', specialty_priority = 1.2 WHERE id = 'lich'          AND specialty = 'militia';

-- Arena attack range (hexes) per the roster table. Melee across the board;
-- only the revenant archers and the spectral casters outrange it.
UPDATE unit_types SET range = 1 WHERE id IN ('ghoul', 'bone_pikeman', 'blood_knight', 'vampire_lord');
UPDATE unit_types SET range = 5 WHERE id IN ('bone_archer');
UPDATE unit_types SET range = 4 WHERE id IN ('wraith');
UPDATE unit_types SET range = 6 WHERE id IN ('lich');

-- Faction ladder (1-7), per the 020 semantics.
UPDATE unit_types SET tier = 1 WHERE id = 'ghoul';
UPDATE unit_types SET tier = 3 WHERE id = 'bone_pikeman';
UPDATE unit_types SET tier = 4 WHERE id IN ('bone_archer', 'wraith');
UPDATE unit_types SET tier = 5 WHERE id = 'blood_knight';
UPDATE unit_types SET tier = 6 WHERE id = 'vampire_lord';
UPDATE unit_types SET tier = 7 WHERE id = 'lich';

-- Roster tag (006's guarded pattern: only fill rows still on the DEFAULT).
UPDATE unit_types SET faction_id = 'ashen'
  WHERE id IN ('ghoul','bone_pikeman','bone_archer','wraith','blood_knight','vampire_lord','lich')
    AND faction_id = 'neutral';
