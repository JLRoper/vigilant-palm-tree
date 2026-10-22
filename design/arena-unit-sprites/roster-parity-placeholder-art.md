# Roster parity placeholder art

The 2026-10-22 roster expansion deliberately ships byte-for-byte copies of existing project PNGs. These are temporary visual stand-ins, not newly generated or unique character art. All paths below are relative to the project root. The briefs in `prompts/` describe future replacement art and were not used to generate these files.

## Units

Each destination has `src/resources/units/icons/<id>.png` and `src/resources/units/arena/<id>-idle.png`. The source column names the same paths with the source id substituted, except where noted.

| New id | Icon source id | Arena idle source id |
|---|---|---|
| axe_thrower | dwarf_axeman | dwarf_axeman |
| bone_dragon | black_dragon | black_dragon |
| bramble_blade | briar_warden | briar_warden |
| dark_acolyte | wraith | wraith |
| druid | mage | runesmith |
| grave_hound | warhound | warhound |
| hearth_priest | runesmith | runesmith |
| necromancer | lich | lich |
| ram_rider | elk_rider | elk_rider |
| skeleton_warrior | bone_pikeman | bone_pikeman |
| sproutling | treant_elder | treant_elder |
| tunnel_levy | dwarf_axeman | dwarf_axeman |
| ursine_guardian | warbeast | warbeast |
| war_boar | warbeast | warbeast |
| wildwood_ranger | thorn_archer | thorn_archer |

The mage has no dedicated arena idle PNG, so the druid uses the runesmith idle. Cross-faction substitutions retain the original palettes and silhouettes: the grave hound resembles a living hound, bone dragon a living black dragon, war boar and ursine guardian a warbeast, and ram rider an elk rider. Skeleton Warrior retains a spear silhouette, Axe Thrower a melee axe, and Sproutling a full treant silhouette until dedicated art replaces them.

## Buildings

All destinations are `src/resources/buildings/building-pixel-<kind>-1.png`; sources follow the same filename convention.

| New kind | Source kind |
|---|---|
| blackChapel | spireOfAsh |
| delversHall | forgeHall |
| dragonBoneyard | ossuary |
| druidCircle | worldrootGrove |
| hearthTemple | deepAnvil |
| ramPens | stables |
| seedlingGrove | groveSanctum |

The building sprite-key and anchor tables are regenerated from these copied files. `assetDescriptors.ts` discovers building and arena PNGs by glob, so it needs no hand-wired entries. Unique faction silhouettes and palettes remain follow-up art work.

All seven new buildings reuse their level-one PNG at levels two and three through explicit aliases in tools/sprites/gen-building-sprite-keys.mjs. Upgrades remain visible with the same placeholder silhouette and anchor at every level.
