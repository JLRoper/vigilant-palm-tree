-- Idempotent migration: the Construction Worker, one per playable faction
-- (faction-construction plan, section 3). A non-combat unit that unlocks
-- placing NEW buildings tagged with its own faction wherever it stands in a
-- settlement's garrison (packages/engine/src/settlement/constructionWorkers.ts's
-- buildingConstructionGate) -- a standing requirement, never consumed.
--
-- Priced like a mid-tier (tier 4-5) purchase, not a starter levy: see
-- buildingRegistry.ts's CONSTRUCTION_WORKER_GOLD_COST (650g). Minimal
-- attack/defence, enough health to survive a stray hit but clearly not a
-- fighting unit -- advantage_type stays a required combat-triangle value
-- (infantry/cavalry/ranged/monster); 'infantry' is the closest fit for a
-- unit that is never meant to fight.
--
-- Follows 033_roster_parity.sql's pattern: INSERT with DEFAULT faction_id
-- ('neutral'), then guarded per-row UPDATEs (only touch rows still on their
-- DEFAULT, so a later tuning pass is never clobbered).
--
-- Upkeep is a DELIBERATE DEVIATION from 021/033's COALESCE(tier, 8) formula
-- (flagged in the PR description): a Construction Worker costs 650g once to
-- recruit but has ZERO ongoing upkeep. It is a standing-presence
-- requirement seeded for free into every settlement's garrison from turn 1
-- (init.ts), not a soldier to feed -- giving it the formula's tier-5 upkeep
-- (5 gold / 3 food per turn, every settlement, forever) would have quietly
-- retuned the game's existing food/gold balance as a side effect of this
-- feature, which several pinned economy regression tests measure to the
-- exact unit (test/engine/heroFoodSupply.test.ts). The guarded UPDATE
-- (AND upkeep_gold/upkeep_food = the column DEFAULT of 1) keeps a later
-- manual tuning pass from being clobbered, same as every other guarded
-- UPDATE in this file.

INSERT INTO unit_types (id, name, attack, defence, health, speed, description, advantage_type) VALUES
  ('construction_worker_human', 'Construction Worker', 1, 1, 8, 4, 'A Crownlands builder who travels with pick and plan, the only hands that can raise the realm''s own halls.', 'infantry'),
  ('construction_worker_ashen', 'Barrow Mason', 1, 1, 8, 4, 'An undead stonewright of the Court, patient enough to rebuild a crypt stone by stone.', 'infantry'),
  ('construction_worker_ironmark', 'Hold Delver', 1, 1, 8, 4, 'A tunnel-wise mason of the Holds, reading the mountain''s grain before the first strike falls.', 'infantry'),
  ('construction_worker_verdant', 'Grovewright', 1, 1, 8, 4, 'A Wild-born shaper of living wood, coaxing a living hall to grow where it is needed.', 'infantry')
ON CONFLICT (id) DO NOTHING;

UPDATE unit_types SET specialty = 'militia', specialty_priority = 0.5 WHERE id = 'construction_worker_human' AND specialty = 'militia';
UPDATE unit_types SET specialty = 'militia', specialty_priority = 0.5 WHERE id = 'construction_worker_ashen' AND specialty = 'militia';
UPDATE unit_types SET specialty = 'militia', specialty_priority = 0.5 WHERE id = 'construction_worker_ironmark' AND specialty = 'militia';
UPDATE unit_types SET specialty = 'militia', specialty_priority = 0.5 WHERE id = 'construction_worker_verdant' AND specialty = 'militia';

UPDATE unit_types SET range = 1 WHERE id IN ('construction_worker_human', 'construction_worker_ashen', 'construction_worker_ironmark', 'construction_worker_verdant') AND range = 1;

-- Tier 5 (the COALESCE(tier, 8) upkeep formula below reads this): a
-- mid-tier purchase, matching the 650g price (buildingRegistry.ts), not a
-- starter levy.
UPDATE unit_types SET tier = 5 WHERE id IN ('construction_worker_human', 'construction_worker_ashen', 'construction_worker_ironmark', 'construction_worker_verdant') AND tier = 1;

UPDATE unit_types SET faction_id = 'human' WHERE id = 'construction_worker_human' AND faction_id = 'neutral';
UPDATE unit_types SET faction_id = 'ashen' WHERE id = 'construction_worker_ashen' AND faction_id = 'neutral';
UPDATE unit_types SET faction_id = 'ironmark' WHERE id = 'construction_worker_ironmark' AND faction_id = 'neutral';
UPDATE unit_types SET faction_id = 'verdant' WHERE id = 'construction_worker_verdant' AND faction_id = 'neutral';

UPDATE unit_types SET upkeep_gold = 0 WHERE id IN ('construction_worker_human', 'construction_worker_ashen', 'construction_worker_ironmark', 'construction_worker_verdant') AND upkeep_gold = 1;
UPDATE unit_types SET upkeep_food = 0 WHERE id IN ('construction_worker_human', 'construction_worker_ashen', 'construction_worker_ironmark', 'construction_worker_verdant') AND upkeep_food = 1;
