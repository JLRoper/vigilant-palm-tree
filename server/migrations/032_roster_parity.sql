-- Idempotent roster parity migration. Because migrations rerun in filename order,
-- 032 is the source of truth for the existing-unit balance stats below.
-- New rows reapply 021 upkeep formulas after their tier is assigned on first boot.

INSERT INTO unit_types (id, name, attack, defence, health, speed, description, advantage_type) VALUES
  ('skeleton_warrior', 'Skeleton Warrior', 5, 4, 9, 4, 'Reassembled swordsmen march beneath the Court''s banners, their borrowed blades never tiring.', 'infantry'),
  ('grave_hound', 'Grave Hound', 4, 2, 7, 7, 'Barrow-born hunting beasts run down the living by the warmth of their breath.', 'monster'),
  ('dark_acolyte', 'Dark Acolyte', 5, 3, 12, 4, 'A chapel initiate whose whispered devotions bind the dead to one more battle.', 'ranged'),
  ('necromancer', 'Necromancer', 9, 2, 8, 4, 'A scholar of forbidden rites who turns the battlefield''s fallen into the Court''s next levy.', 'ranged'),
  ('bone_dragon', 'Bone Dragon', 12, 7, 28, 7, 'An ancient wyrm raised from the boneyard, its empty wings carrying the weight of centuries.', 'monster'),
  ('tunnel_levy', 'Tunnel Levy', 1, 2, 4, 2, 'Delvers called from the deep roads, holding the line with picks and stubborn mountain pride.', 'infantry'),
  ('war_boar', 'War Boar', 3, 4, 9, 5, 'An armored boar bred beneath the holds, charging through shields like rotten timber.', 'monster'),
  ('axe_thrower', 'Axe Thrower', 4, 3, 6, 3, 'A patient hold-warrior whose throwing axes find the gaps a shield wall leaves.', 'ranged'),
  ('hearth_priest', 'Hearth Priest', 4, 5, 15, 3, 'Keeper of the ancestral flame, carrying the strength of the hearth into the shield line.', 'ranged'),
  ('ram_rider', 'Ram Rider', 7, 7, 17, 5, 'A mountain rider atop a battle ram, breaking enemy ranks with horn and hammer.', 'cavalry'),
  ('sproutling', 'Sproutling', 1, 1, 3, 4, 'A young grove-spirit answering the forest call with twig limbs and fearless roots.', 'infantry'),
  ('bramble_blade', 'Bramble Blade', 4, 5, 9, 5, 'A thorn-armored warden whose living blade grows sharper with every trespass.', 'infantry'),
  ('wildwood_ranger', 'Wildwood Ranger', 6, 2, 7, 5, 'A silent hunter of the deep canopy, loosing arrows long before an intruder sees the grove.', 'ranged'),
  ('druid', 'Druid', 8, 3, 9, 4, 'A voice of the old forest, calling root and storm against those who scar its soil.', 'ranged'),
  ('ursine_guardian', 'Ursine Guardian', 8, 8, 22, 4, 'A towering bear bound to the grove, its hide as unyielding as ancient bark.', 'monster')
ON CONFLICT (id) DO NOTHING;

UPDATE unit_types SET specialty = 'sword', specialty_priority = 1.0 WHERE id = 'skeleton_warrior' AND specialty = 'militia';
UPDATE unit_types SET range = 1 WHERE id = 'skeleton_warrior' AND range = 1;
UPDATE unit_types SET tier = 2 WHERE id = 'skeleton_warrior' AND tier = 1;
UPDATE unit_types SET faction_id = 'ashen' WHERE id = 'skeleton_warrior' AND faction_id = 'neutral';

UPDATE unit_types SET specialty = 'monster', specialty_priority = 1.0 WHERE id = 'grave_hound' AND specialty = 'militia';
UPDATE unit_types SET range = 1 WHERE id = 'grave_hound' AND range = 1;
UPDATE unit_types SET tier = 3 WHERE id = 'grave_hound' AND tier = 1;
UPDATE unit_types SET faction_id = 'ashen' WHERE id = 'grave_hound' AND faction_id = 'neutral';

UPDATE unit_types SET specialty = 'prayer', specialty_priority = 1.2 WHERE id = 'dark_acolyte' AND specialty = 'militia';
UPDATE unit_types SET range = 4 WHERE id = 'dark_acolyte' AND range = 1;
UPDATE unit_types SET tier = 6 WHERE id = 'dark_acolyte' AND tier = 1;
UPDATE unit_types SET faction_id = 'ashen' WHERE id = 'dark_acolyte' AND faction_id = 'neutral';

UPDATE unit_types SET specialty = 'arcane', specialty_priority = 1.2 WHERE id = 'necromancer' AND specialty = 'militia';
UPDATE unit_types SET range = 6 WHERE id = 'necromancer' AND range = 1;
UPDATE unit_types SET tier = 6 WHERE id = 'necromancer' AND tier = 1;
UPDATE unit_types SET faction_id = 'ashen' WHERE id = 'necromancer' AND faction_id = 'neutral';

UPDATE unit_types SET specialty = 'monster', specialty_priority = 1.0 WHERE id = 'bone_dragon' AND specialty = 'militia';
UPDATE unit_types SET range = 1 WHERE id = 'bone_dragon' AND range = 1;
UPDATE unit_types SET tier = 7 WHERE id = 'bone_dragon' AND tier = 1;
UPDATE unit_types SET faction_id = 'ashen' WHERE id = 'bone_dragon' AND faction_id = 'neutral';

UPDATE unit_types SET specialty = 'militia', specialty_priority = 1.0 WHERE id = 'tunnel_levy' AND specialty = 'militia';
UPDATE unit_types SET range = 1 WHERE id = 'tunnel_levy' AND range = 1;
UPDATE unit_types SET tier = 1 WHERE id = 'tunnel_levy' AND tier = 1;
UPDATE unit_types SET faction_id = 'ironmark' WHERE id = 'tunnel_levy' AND faction_id = 'neutral';

UPDATE unit_types SET specialty = 'monster', specialty_priority = 1.0 WHERE id = 'war_boar' AND specialty = 'militia';
UPDATE unit_types SET range = 1 WHERE id = 'war_boar' AND range = 1;
UPDATE unit_types SET tier = 3 WHERE id = 'war_boar' AND tier = 1;
UPDATE unit_types SET faction_id = 'ironmark' WHERE id = 'war_boar' AND faction_id = 'neutral';

UPDATE unit_types SET specialty = 'archery', specialty_priority = 1.0 WHERE id = 'axe_thrower' AND specialty = 'militia';
UPDATE unit_types SET range = 4 WHERE id = 'axe_thrower' AND range = 1;
UPDATE unit_types SET tier = 4 WHERE id = 'axe_thrower' AND tier = 1;
UPDATE unit_types SET faction_id = 'ironmark' WHERE id = 'axe_thrower' AND faction_id = 'neutral';

UPDATE unit_types SET specialty = 'prayer', specialty_priority = 1.2 WHERE id = 'hearth_priest' AND specialty = 'militia';
UPDATE unit_types SET range = 4 WHERE id = 'hearth_priest' AND range = 1;
UPDATE unit_types SET tier = 6 WHERE id = 'hearth_priest' AND tier = 1;
UPDATE unit_types SET faction_id = 'ironmark' WHERE id = 'hearth_priest' AND faction_id = 'neutral';

UPDATE unit_types SET specialty = 'cavalry', specialty_priority = 1.0 WHERE id = 'ram_rider' AND specialty = 'militia';
UPDATE unit_types SET range = 1 WHERE id = 'ram_rider' AND range = 1;
UPDATE unit_types SET tier = 5 WHERE id = 'ram_rider' AND tier = 1;
UPDATE unit_types SET faction_id = 'ironmark' WHERE id = 'ram_rider' AND faction_id = 'neutral';

UPDATE unit_types SET specialty = 'militia', specialty_priority = 1.0 WHERE id = 'sproutling' AND specialty = 'militia';
UPDATE unit_types SET range = 1 WHERE id = 'sproutling' AND range = 1;
UPDATE unit_types SET tier = 1 WHERE id = 'sproutling' AND tier = 1;
UPDATE unit_types SET faction_id = 'verdant' WHERE id = 'sproutling' AND faction_id = 'neutral';

UPDATE unit_types SET specialty = 'sword', specialty_priority = 1.0 WHERE id = 'bramble_blade' AND specialty = 'militia';
UPDATE unit_types SET range = 1 WHERE id = 'bramble_blade' AND range = 1;
UPDATE unit_types SET tier = 2 WHERE id = 'bramble_blade' AND tier = 1;
UPDATE unit_types SET faction_id = 'verdant' WHERE id = 'bramble_blade' AND faction_id = 'neutral';

UPDATE unit_types SET specialty = 'archery', specialty_priority = 1.0 WHERE id = 'wildwood_ranger' AND specialty = 'militia';
UPDATE unit_types SET range = 6 WHERE id = 'wildwood_ranger' AND range = 1;
UPDATE unit_types SET tier = 4 WHERE id = 'wildwood_ranger' AND tier = 1;
UPDATE unit_types SET faction_id = 'verdant' WHERE id = 'wildwood_ranger' AND faction_id = 'neutral';

UPDATE unit_types SET specialty = 'arcane', specialty_priority = 1.2 WHERE id = 'druid' AND specialty = 'militia';
UPDATE unit_types SET range = 5 WHERE id = 'druid' AND range = 1;
UPDATE unit_types SET tier = 6 WHERE id = 'druid' AND tier = 1;
UPDATE unit_types SET faction_id = 'verdant' WHERE id = 'druid' AND faction_id = 'neutral';

UPDATE unit_types SET specialty = 'monster', specialty_priority = 1.0 WHERE id = 'ursine_guardian' AND specialty = 'militia';
UPDATE unit_types SET range = 1 WHERE id = 'ursine_guardian' AND range = 1;
UPDATE unit_types SET tier = 5 WHERE id = 'ursine_guardian' AND tier = 1;
UPDATE unit_types SET faction_id = 'verdant' WHERE id = 'ursine_guardian' AND faction_id = 'neutral';

UPDATE unit_types SET upkeep_gold = COALESCE(tier, 8) WHERE id IN ('skeleton_warrior', 'grave_hound', 'dark_acolyte', 'necromancer', 'bone_dragon', 'tunnel_levy', 'war_boar', 'axe_thrower', 'hearth_priest', 'ram_rider', 'sproutling', 'bramble_blade', 'wildwood_ranger', 'druid', 'ursine_guardian');
UPDATE unit_types SET upkeep_food = LEAST(3, GREATEST(1, CEIL(COALESCE(tier, 8) / 2.0))) WHERE id IN ('skeleton_warrior', 'grave_hound', 'dark_acolyte', 'necromancer', 'bone_dragon', 'tunnel_levy', 'war_boar', 'axe_thrower', 'hearth_priest', 'ram_rider', 'sproutling', 'bramble_blade', 'wildwood_ranger', 'druid', 'ursine_guardian');

UPDATE unit_types SET attack = 4, defence = 2, health = 6 WHERE id = 'archer';
UPDATE unit_types SET attack = 3, defence = 3, health = 8 WHERE id = 'warhound';
UPDATE unit_types SET attack = 4, defence = 6, health = 9 WHERE id = 'swordsman';
UPDATE unit_types SET attack = 4, defence = 8, health = 16 WHERE id = 'pikeman';
UPDATE unit_types SET attack = 9, defence = 3, health = 8 WHERE id = 'mage';
UPDATE unit_types SET attack = 2, defence = 1, health = 4 WHERE id = 'ghoul';
UPDATE unit_types SET attack = 4, defence = 2, health = 6 WHERE id = 'bone_archer';
UPDATE unit_types SET attack = 4, defence = 7, health = 17 WHERE id = 'bone_pikeman';
UPDATE unit_types SET attack = 7, defence = 3, health = 8 WHERE id = 'wraith';
UPDATE unit_types SET attack = 5, defence = 6, health = 9 WHERE id = 'dwarf_axeman';
UPDATE unit_types SET attack = 4, defence = 9, health = 17 WHERE id = 'shield_bearer';
UPDATE unit_types SET attack = 7, defence = 3, health = 7 WHERE id = 'hand_gunner';
UPDATE unit_types SET attack = 7, defence = 6, health = 15 WHERE id = 'runesmith';
UPDATE unit_types SET attack = 8, defence = 9, health = 22 WHERE id = 'ironsworn';
UPDATE unit_types SET attack = 15, defence = 13, health = 44 WHERE id = 'forge_lord';
UPDATE unit_types SET attack = 4, defence = 7, health = 12 WHERE id = 'briar_warden';
UPDATE unit_types SET attack = 5, defence = 4, health = 12 WHERE id = 'warbeast';
UPDATE unit_types SET attack = 14, defence = 10, health = 38 WHERE id = 'stag_knight';
