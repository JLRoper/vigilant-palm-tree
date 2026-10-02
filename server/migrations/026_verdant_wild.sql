-- Idempotent migration: The Verdant Wild faction roster (plan
-- .plans/20261002-0050_faction-verdant-wild). Third and final content wave of
-- the initial faction set: 7 forest units, tiers 2-7, faction_id 'verdant'.
--
-- Speed is the faction identity: elk_rider (spd 8) and stag_knight (spd 9) are
-- the fastest units in the game. Costs are wood-forward (only stag_knight pays
-- arcane), matching the sylvan economy of the four new buildings (see
-- packages/engine/src/buildingRegistry.ts: groveSanctum, warrenLodge,
-- sylvanStables, worldrootGrove).
--
-- Re-run safety follows 020/023's guarded-UPDATE pattern: the faction_id and
-- specialty UPDATEs only touch rows that still carry their column DEFAULT, so
-- a later tuning pass is never clobbered by a re-run (migrations re-run at
-- every boot, server/db.ts, sorted by filename).
--
-- Tier/ladder (020's redefinition: faction power-band 1-7): forest_scout 2,
-- briar_warden 3, warbeast 3, thorn_archer 4, elk_rider 5, treant_elder 6,
-- stag_knight 7. upkeep stays at the roster-wide flat 1/1 default (per-type
-- tuning still deferred).

INSERT INTO unit_types (id, name, attack, defence, health, speed, description, advantage_type) VALUES
  ('forest_scout',  'Forest Scout',  3,  2,  6,  5, 'Reads the canopy like a ledger and shoots from between the lines.',        'ranged'),
  ('briar_warden',  'Briar Warden',  4,  7, 11,  4, 'Thorn-plated lodge guard; the hedge has opinions.',                          'infantry'),
  ('warbeast',      'Warbeast',      6,  4, 16,  6, 'A den-raised dire bear that has decided, temporarily, that you are pack.',  'monster'),
  ('thorn_archer',  'Thorn Archer',  5,  3,  6,  4, 'Splinter-tipped shafts grown, not fletched.',                               'ranged'),
  ('elk_rider',     'Elk Rider',     8,  5, 16,  8, 'Antler-and-hoof cavalry that arrives before the war horn finishes.',        'cavalry'),
  ('treant_elder',  'Treant Elder',  9, 11, 32,  3, 'Three centuries of growth that walked away from the grove to handle this.', 'monster'),
  ('stag_knight',   'Stag Knight',  13, 10, 34,  9, 'The Wild''s answer to kings: a crowned beast and the rider it chose.',      'cavalry')
ON CONFLICT (id) DO NOTHING;

-- 020's guarded pattern: only applies while the row still carries the DEFAULT
-- specialty, i.e. effectively "if it was just inserted" -- a later tuning
-- change to these units' specialty won't be clobbered by a re-run.
UPDATE unit_types SET specialty = 'archery',  specialty_priority = 1.0 WHERE id IN ('forest_scout', 'thorn_archer') AND specialty = 'militia';
UPDATE unit_types SET specialty = 'shield',   specialty_priority = 1.0 WHERE id = 'briar_warden'  AND specialty = 'militia';
UPDATE unit_types SET specialty = 'monster',  specialty_priority = 1.0 WHERE id IN ('warbeast', 'treant_elder') AND specialty = 'militia';
UPDATE unit_types SET specialty = 'cavalry',  specialty_priority = 1.0 WHERE id IN ('elk_rider', 'stag_knight') AND specialty = 'militia';

-- Arena attack range (hexes): the faction's two archers outrange melee, the
-- rest are melee.
UPDATE unit_types SET range = 4 WHERE id = 'forest_scout';
UPDATE unit_types SET range = 5 WHERE id = 'thorn_archer';
UPDATE unit_types SET range = 1 WHERE id IN ('briar_warden', 'warbeast', 'elk_rider', 'treant_elder', 'stag_knight');

-- Faction ladder (020's 1-7 power bands).
UPDATE unit_types SET tier = 2 WHERE id = 'forest_scout';
UPDATE unit_types SET tier = 3 WHERE id IN ('briar_warden', 'warbeast');
UPDATE unit_types SET tier = 4 WHERE id = 'thorn_archer';
UPDATE unit_types SET tier = 5 WHERE id = 'elk_rider';
UPDATE unit_types SET tier = 6 WHERE id = 'treant_elder';
UPDATE unit_types SET tier = 7 WHERE id = 'stag_knight';

-- Roster faction: guarded on the column DEFAULT like 023's backfill, so a
-- re-run never clobbers a later retag.
UPDATE unit_types SET faction_id = 'verdant'
  WHERE id IN ('forest_scout', 'briar_warden', 'warbeast', 'thorn_archer',
               'elk_rider', 'treant_elder', 'stag_knight')
    AND faction_id = 'neutral';