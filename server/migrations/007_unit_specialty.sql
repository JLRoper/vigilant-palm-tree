-- Add the specialty + specialty_priority columns to unit_types so the
-- battle arena can show a per-platoon specialty icon (top-left of the
-- status tile) — see shared/combat/manualBattle.ts computeSpecialty() and
-- src/views/manualBattleArena.ts buildStatusTile().
--
-- specialty is the categorical tag (e.g. "archery", "shield", "pike",
-- "sword", "cavalry", "monster", "prayer"). specialty_priority is the
-- tiebreaker weight used when a platoon mixes units of more than one
-- specialty: the specialty with the highest sum(count * priority) wins.
-- 1.0 = baseline. Bumping priority above 1.0 lets a smaller-but-heavier
-- specialty take precedence (e.g. 5 shieldsmen out-vote 6 pikemen even
-- though the pikes outnumber them).

ALTER TABLE unit_types ADD COLUMN IF NOT EXISTS specialty TEXT NOT NULL DEFAULT 'militia';
ALTER TABLE unit_types ADD COLUMN IF NOT EXISTS specialty_priority REAL NOT NULL DEFAULT 1.0;

UPDATE unit_types SET specialty = 'militia',  specialty_priority = 1.0 WHERE id = 'peasant'      AND specialty = 'militia';
UPDATE unit_types SET specialty = 'archery',  specialty_priority = 1.0 WHERE id = 'archer'       AND specialty = 'militia';
UPDATE unit_types SET specialty = 'archery',  specialty_priority = 1.0 WHERE id = 'crossbowman'  AND specialty = 'militia';
UPDATE unit_types SET specialty = 'sword',    specialty_priority = 1.0 WHERE id = 'swordsman'    AND specialty = 'militia';
UPDATE unit_types SET specialty = 'pike',     specialty_priority = 1.0 WHERE id = 'pikeman'      AND specialty = 'militia';
UPDATE unit_types SET specialty = 'cavalry',  specialty_priority = 1.0 WHERE id = 'cavalry'      AND specialty = 'militia';
UPDATE unit_types SET specialty = 'prayer',   specialty_priority = 1.2 WHERE id = 'monk'         AND specialty = 'militia';
UPDATE unit_types SET specialty = 'sword',    specialty_priority = 1.0 WHERE id = 'crusader'     AND specialty = 'militia';
UPDATE unit_types SET specialty = 'monster',  specialty_priority = 1.0 WHERE id = 'griffin'      AND specialty = 'militia';
UPDATE unit_types SET specialty = 'monster',  specialty_priority = 1.0 WHERE id = 'hydra'        AND specialty = 'militia';
UPDATE unit_types SET specialty = 'monster',  specialty_priority = 1.0 WHERE id = 'wisp'         AND specialty = 'militia';
UPDATE unit_types SET specialty = 'monster',  specialty_priority = 1.0 WHERE id = 'black_dragon' AND specialty = 'militia';
