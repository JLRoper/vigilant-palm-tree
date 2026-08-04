-- Idempotent migration: stores the static catalog of unit types and their
-- combat stats + descriptions. Served to the client via GET /api/units.
--
-- advantage_type is the type-triangle tag read by the combat resolver
-- (shared/combatConfig.ts TYPE_TRIANGLE, shared/combat/damage.ts). Without
-- this column GET /api/units throws and the "Test Battle" modal refuses to
-- open ("Failed to load the unit catalog..."). Migration 005 adds the
-- column to existing DBs that pre-date this field; on fresh DBs it lands
-- here.
CREATE TABLE IF NOT EXISTS unit_types (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  attack         INTEGER NOT NULL,
  defence        INTEGER NOT NULL,
  health         INTEGER NOT NULL,
  speed          INTEGER NOT NULL,
  description    TEXT NOT NULL,
  advantage_type TEXT NOT NULL DEFAULT 'infantry'
    CHECK (advantage_type IN ('infantry', 'cavalry', 'ranged', 'monster'))
);

INSERT INTO unit_types (id, name, attack, defence, health, speed, description, advantage_type) VALUES
  ('peasant',       'Peasant',       1,  1,  3,  3, 'Hastily-trained farmers wielding pitchforks and cudgels.',         'infantry'),
  ('archer',        'Archer',        4,  2,  5,  4, 'Rangers from the lowland woods; deadly at range, fragile in melee.', 'ranged'),
  ('crossbowman',   'Crossbowman',   6,  3,  7,  4, 'Steel-bolt skirmishers whose quarrels punch through light armour.', 'ranged'),
  ('swordsman',     'Swordsman',     5,  6,  10, 4, 'Steady line infantry clad in mail and armed with longswords.',      'infantry'),
  ('pikeman',       'Pikeman',       3,  8,  12, 3, 'A wall of iron against cavalry; slow but nigh-impregnable from the front.', 'infantry'),
  ('cavalry',       'Cavalry',       7,  5,  15, 7, 'Hammering lancers that strike first and overrun scattered foes.',    'cavalry'),
  ('monk',          'Monk',          4,  4,  14, 4, 'Mendicant healers whose prayers knit wounds between blows.',        'ranged'),
  ('crusader',      'Crusader',      9,  9,  22, 4, 'Gilded templars sworn to hold the line to the last breath.',        'infantry'),
  ('griffin',       'Griffin',       8,  6,  18, 6, 'Lion-eagle mounts that swoop over shieldwalls to strike the rear.', 'monster'),
  ('hydra',         'Hydra',         10, 7,  28, 5, 'Three-headed swamp terror; each severed head grows back twofold.',  'monster'),
  ('wisp',          'Wisp',          2,  1,  2,  8, 'Flickering spirits of fallen scouts; faster than anything on two legs.', 'monster'),
  ('black_dragon',  'Black Dragon', 14, 12, 40, 6, 'An apex wyrm whose acid breath leaves no survivors and no cover.',   'monster')
ON CONFLICT (id) DO NOTHING;