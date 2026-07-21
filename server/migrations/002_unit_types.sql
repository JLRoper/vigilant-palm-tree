-- Idempotent migration: stores the static catalog of unit types and their
-- combat stats + descriptions. Served to the client via GET /api/units.
CREATE TABLE IF NOT EXISTS unit_types (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  attack      INTEGER NOT NULL,
  defence     INTEGER NOT NULL,
  health      INTEGER NOT NULL,
  speed       INTEGER NOT NULL,
  description TEXT NOT NULL
);

INSERT INTO unit_types (id, name, attack, defence, health, speed, description) VALUES
  ('peasant',       'Peasant',       1,  1,  3,  3, 'Hastily-trained farmers wielding pitchforks and cudgels.'),
  ('archer',        'Archer',        4,  2,  5,  4, 'Rangers from the lowland woods; deadly at range, fragile in melee.'),
  ('crossbowman',   'Crossbowman',   6,  3,  7,  4, 'Steel-bolt skirmishers whose quarrels punch through light armour.'),
  ('swordsman',     'Swordsman',     5,  6,  10, 4, 'Steady line infantry clad in mail and armed with longswords.'),
  ('pikeman',       'Pikeman',       3,  8,  12, 3, 'A wall of iron against cavalry; slow but nigh-impregnable from the front.'),
  ('cavalry',       'Cavalry',       7,  5,  15, 7, 'Hammering lancers that strike first and overrun scattered foes.'),
  ('monk',          'Monk',          4,  4,  14, 4, 'Mendicant healers whose prayers knit wounds between blows.'),
  ('crusader',      'Crusader',      9,  9,  22, 4, 'Gilded templars sworn to hold the line to the last breath.'),
  ('griffin',       'Griffin',       8,  6,  18, 6, 'Lion-eagle mounts that swoop over shieldwalls to strike the rear.'),
  ('hydra',         'Hydra',         10, 7,  28, 5, 'Three-headed swamp terror; each severed head grows back twofold.'),
  ('wisp',          'Wisp',          2,  1,  2,  8, 'Flickering spirits of fallen scouts; faster than anything on two legs.'),
  ('black_dragon',  'Black Dragon', 14, 12, 40, 6, 'An apex wyrm whose acid breath leaves no survivors and no cover.')
ON CONFLICT (id) DO NOTHING;