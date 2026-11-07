# Faction combat-unit differentiation — measurement and pins

Measured 2026-11-07 against `github/main` at version **0.53.13**
(`be2d030`, merge of #374). The worktree this landed from was rebased onto that
tip before any measurement, so every figure below is current main, not a stale
branch.

Method: read the shipped data, not the design prose. Three sources, all of them
what the running game actually consumes:

- `packages/engine/src/factionRegistry.ts` — `FACTION_REGISTRY`, the roster/label
  catalog (`FactionDef.roster`).
- the `unit_types` table after every SQL migration has run (`initSchema()` against
  this worktree's own database, `game_poc_wtgui_faction_combat_unit_diff_f50e40`),
  which is where per-unit attack/defence/health/speed/range/tier/advantage_type/
  specialty/upkeep values live. There is no TypeScript stat catalog — the numbers
  below exist only in the migration-built rows.
- `packages/engine/src/buildingRegistry.ts` — the recruit table each faction's
  troop buildings carry.

The differentiating claims that hold are pinned in
`test/data/factionCombatUnitDifferentiation.test.ts` (9 tests, all green). A
surface where two factions are **not** distinguishable is deliberately **not**
asserted in a test — pinning sameness would freeze a gap as if it were the
design — and is recorded under ESCALATIONS below instead.

---

## What holds

### 1. Unit set — holds

Each seat faction (`human`, `ashen`, `ironmark`, `verdant`) fields exactly
**twelve** units, and the four rosters are **pairwise disjoint** (48 distinct
ids). The neutral catalog (`griffin`, `hydra`, `wisp`, `black_dragon`) shares no
id with any seat roster. Measured from the registry and re-checked against the
`unit_types.faction_id` column.

### 2. Stats — holds (with one exception, escalated)

Per faction, all twelve units carry **distinct combat stat lines**
(`attack/defence/health/speed/advantage_type/range`) — 12 distinct lines for
each of the four factions, no intra-faction duplicate.

Every seat faction also covers the whole power ladder and the whole triangle:

| faction  | tiers 1-7 present | advantage-type mix (inf / cav / rng / mon) |
|----------|-------------------|--------------------------------------------|
| human    | yes               | 4 / 1 / 4 / 3 |
| ashen    | yes               | 4 / 1 / 5 / 2 |
| ironmark | yes               | 5 / 1 / 4 / 2 |
| verdant  | yes               | 3 / 2 / 4 / 3 |

The four **tier ladders** (units per band) are pairwise distinct, and the four
**advantage-type mixes** are pairwise distinct — no two factions field a
same-shaped army. (Tier ladders: human 1,2,2,2,1,2,2; ashen 1,1,2,2,1,3,2;
ironmark 1,1,2,2,2,3,1; verdant 1,2,2,2,2,2,1.)

### 3. Buildings — holds

Each faction raises its troops from buildings that are **exclusively its own**,
and those buildings recruit **exactly the faction's registry roster** (no more,
no fewer):

| faction  | troop buildings | recruits == roster |
|----------|-----------------|--------------------|
| human    | farmhouse, barracks, archeryRange, mageGuild, stables, huntingLodge, eyrie | ✅ 12/12 |
| ashen    | crypt, ossuary, wraithBarrows, spireOfAsh, blackChapel, dragonBoneyard    | ✅ 12/12 |
| ironmark | delversHall, forgeHall, gunnersRedoubt, golemFoundry, deepAnvil, hearthTemple, ramPens | ✅ 12/12 |
| verdant  | seedlingGrove, groveSanctum, warrenLodge, sylvanStables, worldrootGrove, druidCircle | ✅ 12/12 |

No troop building is shared between factions, every one is gated to its owner
(`buildingAllowedForFaction` is `true` only for the owning faction), and no
building with recruits is faction-less.

---

## ESCALATIONS

### E1 — Faction unit sprites are not differentiated: units of different factions ship byte-identical art

**Surface:** sprites. **Verdict: does NOT hold.** This is a known, deliberate
placeholder debt (`design/arena-unit-sprites/roster-parity-placeholder-art.md`,
the 2026-10-22 roster expansion shipped byte-for-byte copies of existing PNGs),
but it was never measured, and it means factions are visually indistinguishable
for a third of the catalog. It is not pinned by any test today
(`test/render/unitArenaDescriptors.test.ts` and `test/data/unitIcons.coverage.test.ts`
assert every unit *has* art and follows the filename convention — not that the
art is unique).

Measurement — md5 of the shipped PNGs, grouped, keeping only groups with more
than one member:

- **Arena idle art** (`src/resources/units/arena/<id>-idle.png`): **12** duplicate
  groups, **5** of them cross-faction.
- **Icons** (`src/resources/units/icons/<id>.png`): **13** duplicate groups,
  **5** of them cross-faction.

Cross-faction collisions (units of different factions sharing the same bytes):

| ids sharing art | factions | surface |
|---|---|---|
| `grave_hound` = `warhound` | ashen = human | arena + icon |
| `bone_dragon` = `black_dragon` | ashen = neutral | arena + icon |
| `druid` = `hearth_priest` = `runesmith` | verdant = ironmark | arena |
| `elk_rider` = `ram_rider` | verdant = ironmark | arena + icon |
| `ursine_guardian` = `warbeast` = `war_boar` | verdant = ironmark | arena + icon |
| `druid` = `mage` | verdant = human | icon |

**3 of the 6 seat-faction pairs** (human↔ashen, human↔verdant, ironmark↔verdant)
share sprite bytes; ashen also shares with the neutral catalog. Within-faction
duplication is present too (e.g. all three ironmark axe units share one sprite).

**Suggested action:** this is art work, not a code defect — replace the copied
PNGs with per-unit art (the briefs in `design/arena-unit-sprites/prompts/` and the
`*-prompts/` folders describe them). When unique art lands, a distinctness test
("no two units share sprite bytes") becomes assertable and should be added then;
it deliberately is **not** added now, because it would assert the sameness we are
trying to remove.

### E2 — One combat stat line is shared across factions: ashen `bone_archer` ≡ human `archer`

**Surface:** stats. **Verdict: does NOT hold for this one unit pair.** Exactly
one combat stat line in the whole catalog is shared across factions (measured:
1 of 48 seat-unit lines):

- ashen `bone_archer` and human `archer`: both tier 4, `advantage_type` ranged,
  attack 4 / defence 2 / health 6 / speed 4, range 5, specialty `archery`
  (priority 1.0).

They differ only in id, name, `faction_id` and upkeep (ashen 6/0 by 037's
gold-only bill vs human 4/2) — i.e. in a battle they are mechanically identical,
so the two factions are indistinguishable on that unit. Every other cross-faction
stat line differs; this is the only collision, and it is *within the same tier*,
so it is not a "same stat at different power band" coincidence.

**Suggested action:** a balance/design decision, not a code fix — either retune
one of the two (nudge a stat or the specialty) so the Ashen tier-4 archer has its
own line, or record it as an accepted mirror. Not pinned by a test, on purpose:
asserting `bone_archer.line === archer.line` would pin the collision as intended.

---

## Note (not an escalation)

Combat resolution itself is **faction-blind**: `packages/engine/src/combat/*` and
`combatConfig.ts` contain no `faction` term (verified by grep). Factions
differentiate in combat *only* through the stats of the units they can field —
which is what the "Stats" section above measures. This is the design (the roster
is the identity), stated here so the mechanism is explicit rather than assumed.
