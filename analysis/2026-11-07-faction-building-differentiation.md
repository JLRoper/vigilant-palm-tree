# Faction building differentiation — measurement and pins

Measured 2026-11-07 against `github/main` at version **0.53.15**
(`7933049`, merge of #376), then re-measured **unchanged** at `8a6f845`
(0.53.16, the unit-art wave) when main advanced under this branch mid-flight —
that wave touched only unit sprites, docs and the units test, no building file
(`git diff --name-only 7933049 8a6f845` lists no `building*`,
`factionRegistry.ts` or `starterLayout.ts`). The worktree this landed from was
fast-forwarded onto the newer tip before landing, so every figure below is
current main, not a stale branch.

Method: read the shipped data, not the design prose. Four sources, all of them
what the running game actually consumes:

- `packages/engine/src/buildingRegistry.ts` — `REGISTRY: Record<BuildingKind,
  BuildingEffect>`, the optional per-building `faction` tag, the `recruits`
  table, and the gate `buildingAllowedForFaction(kind, factionId)` (line 839:
  `true` when the caller passes no faction, when the building carries no faction
  tag, or when the tag equals the caller's faction).
- `packages/engine/src/factionRegistry.ts` — `FACTION_REGISTRY`, the four seat
  rosters plus the neutral catalog bucket.
- `packages/engine/src/buildingSpriteCoverage.ts` — `BUILDING_SPRITE_COVERAGE`,
  a `Record<BuildingKind, …>` and therefore the exhaustive runtime list of every
  building kind (44). A new kind is a compile error there before it can be a
  hole in this measurement.
- the real bytes of the shipped art under `src/resources/buildings/` (md5), and
  this worktree's own database
  (`game_poc_wtgui_measure_the_buildings_si_d28c03`, the name
  `databaseNameForBranch()` derives from this branch) after every migration has
  run via `initSchema()`.

The differentiating claims that hold are pinned in
`test/data/factionBuildingDifferentiation.test.ts` (5 tests, all green). A
surface where two factions are **not** distinguishable is deliberately **not**
asserted in a test — pinning sameness would freeze a gap as if it were the
design — and is recorded under ESCALATIONS below instead.

The recruit table is **not** re-measured here: #167 already pinned that each
faction's troop buildings recruit exactly its own registry roster, exclusively
and gated (`test/data/factionCombatUnitDifferentiation.test.ts`). This report
re-derives only the two surfaces the units card left open on the buildings side:
the building **sets** and the building **sprites**.

---

## What holds

### 1. The building sets — the four factions' buildable sets are pairwise distinct

Of the **44** building kinds, **18** carry no faction tag (buildable by every
seat) and **26** are faction-tagged:

| faction  | own kinds | count |
|----------|-----------|-------|
| human    | mageGuild, barracks, farmhouse, archeryRange, stables, huntingLodge, eyrie | 7 |
| ashen    | crypt, ossuary, wraithBarrows, spireOfAsh, blackChapel, dragonBoneyard | 6 |
| ironmark | forgeHall, gunnersRedoubt, golemFoundry, deepAnvil, delversHall, hearthTemple, ramPens | 7 |
| verdant  | groveSanctum, warrenLodge, sylvanStables, worldrootGrove, seedlingGrove, druidCircle | 6 |

The 18 shared kinds are exactly the faction-less ones: townHall, house, tower,
mine, stoneMine, ironMine, market, smithy, apartment, farmField, granary,
warehouse, bank, treasury, goldMine, woodcutterHut, arcaneFont, shipyard. Every
seat can build all 18.

Walking `buildingAllowedForFaction` over all 44 kinds, each seat faction's
buildable set is the 18 shared kinds plus its own, and the two parts are
disjoint:

| faction  | buildable kinds | symmetric difference vs each other seat |
|----------|-----------------|------------------------------------------|
| human    | **25** | ashen 13 · ironmark 14 · verdant 13 |
| ashen    | **24** | ironmark 13 · verdant 12 |
| ironmark | **25** | verdant 13 |
| verdant  | **24** | — |

**All six seat-faction pairs differ**, by 12–14 kinds, and the four sets are
pairwise distinct (4 distinct set signatures out of 4). This holds and is pinned.

### 2. The city-view palette states the same difference

The build menu (`src/screens/settlements/cityView/buildListSections.ts`) walks
its own `BUILDABLE_KINDS` list (43 kinds — every registry kind except the legacy,
non-buildable generic `mine`) through the same gate. Measured palette sizes:
human 24, ashen 23, ironmark 24, verdant 23 — each split troop 7/6/7/6,
production 7/7/7/7, civilian 10/10/10/10. The per-faction difference the player
sees is the same 26-kind partition, one kind narrower than the gate only because
`mine` is not placeable.

### 3. The starter city differs by exactly the faction troop building

Every settlement the game creates is seeded with the same level-1 starter set
(`buildStarterLayout`): town hall, its `farms` farm fields, two houses, two
woodcutter huts, one stone mine, and the faction's own troop building
(`STARTER_TROOP_BUILDING_BY_FACTION`). Measured over the four factions (size 10,
`farms: 4`), the starter kind sets are identical except for that one entry:

| faction  | starter troop building |
|----------|------------------------|
| human    | farmhouse |
| ashen    | crypt |
| ironmark | delversHall |
| verdant  | seedlingGrove |

Every pair's symmetric difference is exactly `{owner's troop building}` vs
`{other's troop building}` — the other five distinct kinds (townHall,
farmField, house, woodcutterHut, stoneMine) match. This holds and is pinned.

### 4. The DB's faction axis is the same five values

`unit_types_faction_id_check` constrains `faction_id` to exactly
`human, ashen, ironmark, verdant, neutral` — the contracts `FactionId` union —
and every one of those five values has migration-built rows behind it
(`ashen=12, human=12, ironmark=12, verdant=12, neutral=4`). This is the faction
axis the building gate is expressed in, and it holds. Pinned.

---

## ESCALATIONS

### E1 — Faction building sprites are not differentiated: 1 of the 6 seat-faction pairs ships byte-identical building art

**Surface:** sprites. **Verdict: does NOT hold.** Buildings of different
factions ship the same bytes, so two of the four seats are visually
indistinguishable on one of their buildings. This is the buildings-side twin of
the units-side gap the combat-unit card escalated
(`analysis/2026-11-07-faction-combat-unit-differentiation.md` §E1): the same
placeholder-art debt, on the building sheet.

Measurement — md5 of the shipped building PNGs, grouped, keeping only groups
with more than one member. Scope is the **registered pixel family** (123 files,
`building-pixel-<kind>-<level>[-alt].png`): `BUILDING_SPRITE_KEYS` is
pixel-only, and `starterStyleFor` resolves every building kind to `pixel`, so
these 123 files are the art the game actually draws. The legacy
`building-classic-*` / `building-blocky-*` / `*-raw` / `*-variant*` exploration
files are deliberately not registered and are not shipped art.

- **7 duplicate groups** in the pixel family, every one a pair.
- **6** of them are **within a single faction** (one sprite reused by two of
  that faction's own buildings):

| ids sharing art | faction |
|---|---|
| `blackChapel` = `spireOfAsh` | ashen |
| `dragonBoneyard` = `ossuary` | ashen |
| `deepAnvil` = `hearthTemple` | ironmark |
| `delversHall` = `forgeHall` | ironmark |
| `druidCircle` = `worldrootGrove` | verdant |
| `groveSanctum` = `seedlingGrove` | verdant |

- **1** is **cross-faction** — buildings of two different seats sharing the
  exact same bytes:

| ids sharing art | factions | file |
|---|---|---|
| `ramPens` = `stables` | ironmark = human | `building-pixel-ramPens-1.png` = `building-pixel-stables-1.png` |

So **1 of the 6 seat-faction pairs** (human↔ironmark) collides on building art.
The other five pairs (human↔ashen, human↔verdant, ashen↔ironmark,
ashen↔verdant, ironmark↔verdant) do not share any building sprite bytes today.
No faction building collides with a shared/neutral building. Across the whole
160-file folder the same 7 groups appear plus one more
(`building-classic-smithy-2.png` = `building-pixel-smithy-2.png`, a legacy style
file for the same kind — not a cross-faction collision).

**Not pinned, on purpose:** a distinctness test ("no two factions share building
sprite bytes") would **fail** today on the `stables`/`ramPens` pair, and
asserting the collision as intended would freeze the gap into the design. The
same reasoning the units card used: when unique art lands, a distinctness test
becomes assertable and should be added then.

**Suggested action:** this is art work, not a code defect — give `ramPens` (or
`stables`) its own sprite, and replace the six within-faction copies, the way
the companion unit-sprite card is doing for the arena and icon sets. This card
deliberately leaves `assets/` untouched.

---

## Note (not an escalation)

### N1 — the DB holds no building catalog; the registry is the only source of the building sets

Measured on this worktree's own database after `initSchema()`: the 17 public
tables are auth_codes, battle_actions, charters, game_assets, game_events,
games, hero_platoons, heroes, resource_transactions, settlement_buildings,
settlement_platoons, settlement_resources, settlement_snapshots, settlements,
tiles, unit_types, user_sessions. There is **no** building-type or
building-faction table — `settlement_buildings` holds *instances* only
(`id, settlement_id, gx, gy, kind TEXT, level, style, w, h, construction,
game_id, bank, workers, draft, district_q, district_r`) with no `kind` CHECK
constraint and no faction column, and a grep of `server/schema.sql` and every
file in `server/migrations/` finds no building-kind literal at all.

Consequence, stated so the mechanism is explicit rather than assumed: the
database cannot express a faction gate on buildings. `buildingAllowedForFaction`
in the engine registry is the single source of the building sets, and the
per-faction content plans (024/025/026) add units, not buildings. The DB's only
contribution to the faction axis is the `unit_types.faction_id` vocabulary
pinned above.
