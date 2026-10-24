// The single shared list of unit-catalog ids (server/migrations/
// 002_unit_types.sql + 015_unit_catalog_v1.sql's mage + 020_faction_ladder_
// units.sql's three + 024_ashen_court.sql's, 025_ironmark_holds.sql's, and
// 026_verdant_wild.sql's seven each). Every consumer that used to
// hand-duplicate the list (unitIcons.coverage.test.ts,
// unitArenaDescriptors.test.ts) imports this instead; unitCatalogParity.test.ts
// pins it against the DB column and the faction registry so a catalog change
// fails a test instead of drifting. Static on purpose — "no DB" for consumers
// that only need the ids.

export const UNIT_CATALOG_IDS = [
  "peasant",
  "archer",
  "crossbowman",
  "swordsman",
  "pikeman",
  "cavalry",
  "monk",
  "crusader",
  "griffin",
  "hydra",
  "wisp",
  "black_dragon",
  "mage",
  "warhound",
  "giant_eagle",
  "eagle_prince",
  "ghoul",
  "bone_pikeman",
  "bone_archer",
  "wraith",
  "blood_knight",
  "vampire_lord",
  "lich",
  "dwarf_axeman",
  "shield_bearer",
  "hand_gunner",
  "ironsworn",
  "iron_golem",
  "runesmith",
  "forge_lord",
  "forest_scout",
  "briar_warden",
  "warbeast",
  "thorn_archer",
  "elk_rider",
  "treant_elder",
  "stag_knight",
  "skeleton_warrior",
  "grave_hound",
  "dark_acolyte",
  "necromancer",
  "bone_dragon",
  "tunnel_levy",
  "war_boar",
  "axe_thrower",
  "hearth_priest",
  "ram_rider",
  "sproutling",
  "bramble_blade",
  "wildwood_ranger",
  "druid",
  "ursine_guardian",
  // Construction Worker, one per faction (034_construction_workers.sql,
  // faction-construction plan section 3): non-combat, recruited from the
  // faction's starter troop building (farmhouse/crypt/delversHall/
  // seedlingGrove), not part of that faction's 12-unit combat roster count
  // but still a real unit_types row and FACTION_REGISTRY.roster member.
  "construction_worker_human",
  "construction_worker_ashen",
  "construction_worker_ironmark",
  "construction_worker_verdant",
] as const;

export type UnitCatalogId = (typeof UNIT_CATALOG_IDS)[number];