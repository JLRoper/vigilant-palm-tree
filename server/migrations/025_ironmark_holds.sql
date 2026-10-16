-- Idempotent migration: The Ironmark Holds roster (faction content wave).
--
-- Fills the ironmark roster on the faction-foundation column
-- (006_faction_rosters.sql's unit_types.faction_id): 7 units, tiers 2-7.
-- The roster's only monster-triangle entry (iron_golem) rides the same
-- documented debt as warhound/giant_eagle: advantage_type 'monster' means
-- an always-advantaged attacker (005_unit_counters.sql), which is deliberate
-- for a construct and consistent with how in-roster monsters already behave.
--
-- Recruitment gating is unchanged in kind: forgeHall offers dwarf_axeman at
-- L1 and shield_bearer at L2, gunnersRedoubt offers hand_gunner at L1,
-- golemFoundry offers ironsworn at L1 and iron_golem at L2, deepAnvil offers
-- runesmith at L1 and forge_lord at L2 (see
-- packages/engine/src/buildingRegistry.ts). The RecruitUnits command's
-- faction gate (unitAllowedForSeatFaction) starts rejecting the moment
-- these rows exist: only an ironmark seat may recruit them.
--
-- upkeep_gold/upkeep_food stay at their DEFAULT 1 (the roster-wide flat
-- 1/1, per-type tuning still deferred). The guarded UPDATEs below follow
-- 020's pattern: they only apply while the row still carries the DEFAULT,
-- so a later tuning pass is never clobbered by a re-run (migrations re-run
-- at every boot, server/db.ts, sorted by filename).

INSERT INTO unit_types (id, name, attack, defence, health, speed, description, advantage_type) VALUES
  ('dwarf_axeman', 'Dwarf Axeman',   5,  6, 10, 3, 'Beard-deep in the shield wall, and delighted about it.',                            'infantry'),
  ('shield_bearer','Shield Bearer',  3,  9, 14, 3, 'A door that walks. Hold the line; the line is the hold.',                        'infantry'),
  ('hand_gunner',  'Hand Gunner',    7,  3,  6, 4, 'Thunder in a teacup: the Holds'' answer to bow and spell alike.',                 'ranged'),
  ('ironsworn',    'Ironsworn',       8,  9, 20, 3, 'Full-plate veterans who have sworn their bones to the anvil guild.',              'infantry'),
  ('iron_golem',   'Iron Golem',    10, 12, 34, 3, 'Ore that learned obedience. Slow as a lawsuit, final as a tomb door.',          'monster'),
  ('runesmith',    'Runesmith',      6,  6, 14, 4, 'Sings to hot metal; the metal sings back with force the enemy feels.',          'ranged'),
  ('forge_lord',   'Forge Lord',    14, 13, 40, 4, 'Master of the Deep Anvil, wearing a century of masterworks into battle.',        'infantry')
ON CONFLICT (id) DO NOTHING;

-- 007/015/020's guarded pattern: only applies while the row still carries
-- the DEFAULT specialty ("if it was just inserted").
UPDATE unit_types SET specialty = 'sword',   specialty_priority = 1.0 WHERE id = 'dwarf_axeman'  AND specialty = 'militia';
UPDATE unit_types SET specialty = 'shield',  specialty_priority = 1.0 WHERE id = 'shield_bearer' AND specialty = 'militia';
UPDATE unit_types SET specialty = 'archery', specialty_priority = 1.0 WHERE id = 'hand_gunner'   AND specialty = 'militia';
UPDATE unit_types SET specialty = 'sword',   specialty_priority = 1.0 WHERE id = 'ironsworn'     AND specialty = 'militia';
UPDATE unit_types SET specialty = 'monster', specialty_priority = 1.0 WHERE id = 'iron_golem'    AND specialty = 'militia';
UPDATE unit_types SET specialty = 'arcane',  specialty_priority = 1.2 WHERE id = 'runesmith'     AND specialty = 'militia';
UPDATE unit_types SET specialty = 'sword',   specialty_priority = 1.0 WHERE id = 'forge_lord'    AND specialty = 'militia';

-- Arena attack range (hexes) per the roster table: melee and the construct
-- at 1; only hand_gunner and runesmith outrange melee.
UPDATE unit_types SET range = 1 WHERE id IN ('dwarf_axeman', 'shield_bearer', 'ironsworn', 'iron_golem', 'forge_lord');
UPDATE unit_types SET range = 4 WHERE id IN ('runesmith');
UPDATE unit_types SET range = 6 WHERE id IN ('hand_gunner');

-- Faction ladder (1-7): 2/3/4/5/6/6/7.
UPDATE unit_types SET tier = 2 WHERE id = 'dwarf_axeman';
UPDATE unit_types SET tier = 3 WHERE id = 'shield_bearer';
UPDATE unit_types SET tier = 4 WHERE id = 'hand_gunner';
UPDATE unit_types SET tier = 5 WHERE id = 'ironsworn';
UPDATE unit_types SET tier = 6 WHERE id IN ('iron_golem', 'runesmith');
UPDATE unit_types SET tier = 7 WHERE id = 'forge_lord';

-- Roster faction. Guarded on faction_id = 'neutral' (the column DEFAULT)
-- like 006's backfill, so a re-run never clobbers a later retag.
UPDATE unit_types SET faction_id = 'ironmark'
  WHERE id IN ('dwarf_axeman', 'shield_bearer', 'hand_gunner', 'ironsworn',
               'iron_golem', 'runesmith', 'forge_lord')
    AND faction_id = 'neutral';
