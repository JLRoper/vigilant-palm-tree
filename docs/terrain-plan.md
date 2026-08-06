# Terrain plan: from placeholder field to a real per-hex mechanic

## Goal

Give battle-grid terrain actual mechanical weight (a combat bonus tied to
where a platoon stands, and optionally a movement-cost effect) instead of
the "Terrain: —" placeholder the manual battle arena's platoon status tile
ships with today, using the same extension seams the damage formula already
exposes so the turn loop and resolver don't need restructuring — mirroring
how [docs/morale-fatigue-plan.md](morale-fatigue-plan.md) sequences fatigue
and morale onto the same engine.

## Current fit in the codebase

- **There is no terrain concept anywhere in this repo today** — confirmed
  by a case-insensitive grep for "terrain" across `shared/` and `src/`:
  zero matches. This doc is greenfield, not a partial-feature writeup.
- [shared/combat/types.ts:6-14](../shared/combat/types.ts)'s `BattleHex`
  (`extends Axial`) has exactly one flag beyond position: `impassable:
  boolean`. `BattleGrid` is just `{ cols, rows, hexes: BattleHex[] }`. A
  `terrain` field would extend this same per-hex shape alongside
  `impassable`, not replace it — a hex can be impassable (an obstacle) and
  independently have a terrain type, or terrain could be restricted to
  passable hexes only (see "Proposed model" below for which this doc picks).
- [shared/combat/grid.ts](../shared/combat/grid.ts)'s `makeBattleGrid()`
  (lines 12-45) is the only place `BattleHex` values are constructed. It
  builds a flat `cols × rows` grid of `{ q, r, impassable: false }`, then
  either restores impassable hexes from a caller-supplied `fixedObstacles`
  layout (the scouting path) or scatters `obstacleCount` of them via a
  seeded `mulberry32` RNG over the open middle columns (`q > 0 && q < cols
  - 1`, i.e. excluding the two deployment columns). Terrain generation
  would plug into this same function, using the same `rng` stream (or a
  second seeded stream) so a given `obstacleSeed`/`fixedObstacles` fight
  stays fully deterministic and replayable, per
  [feature-plans/CombatResolutionEngine.md](../feature-plans/CombatResolutionEngine.md)
  "Battle grid: size, obstacles & scouting."
- [shared/combatConfig.ts:38-45](../shared/combatConfig.ts) is where
  `DEFAULT_GRID_COLS`, `DEFAULT_GRID_ROWS`, and `DEFAULT_OBSTACLE_COUNT`
  live — the natural home for terrain's own tunables (type list, per-type
  hex count/frequency, the combat multiplier), following the file's
  established "every tunable is a named constant here" convention (see
  `TYPE_ADVANTAGE_MULTIPLIER`, `PLATOON_RETREAT_LOSS`, `RANGED_ATTACK_RANGE`
  in the same file).
- [shared/combat/damage.ts](../shared/combat/damage.ts)'s `computeDamage()`
  (lines 78-99) is the formula terrain would hook into: `effAttack` is
  summed from attacker entries, `effDefense` is the defender's
  count-weighted average, `rawDamage = effAttack² / (effAttack +
  effDefense)`, then scaled by `typeMultiplier()` (lines 44-65) and a
  caller-supplied `modifier`. A terrain bonus should scale `effAttack`/
  `effDefense` the same way `typeMultiplier` already scales `rawDamage` —
  this is the exact seam
  [docs/morale-fatigue-plan.md](morale-fatigue-plan.md) "Feed into damage
  math" (step 5) proposes for fatigue/morale, and terrain should follow the
  identical pattern rather than invent a third mechanism. Note
  `computeDamage()` currently takes no positional/grid argument at all —
  today it's pure stat math with no awareness of *where* the fight is
  happening, so wiring in terrain means threading each combatant's current
  hex (or its terrain) into the call, not just referencing state that's
  already in scope.
- [shared/combat/types.ts:119-121](../shared/combat/types.ts)'s
  `SideModifiers.damageMultiplier` is a caller-suppliable multiplier hook
  (built for a future Day/Night bonus) — generic enough that a terrain
  bonus *could* piggyback on it, but it's a single side-wide scalar with no
  per-platoon/per-hex granularity, so it's the wrong seam for "this specific
  platoon is standing on its preferred terrain." Terrain needs a
  per-combatant lookup (position → hex → terrain, then terrain vs. that
  platoon's own preferred terrain), which only the damage-formula seam
  above can express.
- [src/state/units.ts:15-36](../src/state/units.ts)'s `UnitType` has
  `attack`, `defence`, `health`, `speed`, `advantageType` (the
  infantry/cavalry/ranged/monster counter tag), `specialty` (a categorical
  tag — infantry/archery/cavalry/etc. — used only to pick the status tile's
  icon, per `computeSpecialty()` in
  [shared/combat/manualBattle.ts:417-446](../shared/combat/manualBattle.ts)),
  and `specialtyPriority` (a tiebreaker weight for mixed-specialty
  platoons). None of these represent a terrain preference. `specialty` is
  structurally the closest existing precedent for "a categorical tag on
  `UnitType` that the UI reads back out" — a `preferredTerrain` field would
  follow the same shape (a string/enum field, sourced from unit data) — but
  it is a *separate* concern from `specialty`: `specialty` is about the
  type-triangle/icon system, `preferredTerrain` would be about where a unit
  fights best. They should not be conflated into one field.
- [src/views/manualBattleArena.ts:412-546](../src/views/manualBattleArena.ts)'s
  `buildStatusTile()` is the per-platoon status tile. It currently renders
  title, specialty icon, composition lines, an HP bar, then — at lines
  537-543 — Morale and Fatigue bars via `makeMetricBar()`, with a comment
  explaining the established pattern this doc follows for Terrain too:
  > "Morale + Fatigue placeholder bars. No actual mechanic behind these
  > yet — the values are hard-coded (morale always 100, fatigue always 0)
  > so the slot exists in the UI for when the combat system gets around to
  > tracking them."

  **This session's UI decision:** the tile ships now with a `Terrain: —`
  placeholder line (not a `makeMetricBar()` — there's no 0..1 ratio to
  show, just an unresolved label) ahead of any terrain mechanic existing,
  matching this same "UI slot exists before the mechanic does" pattern.
  Once both pieces of this plan land, that placeholder becomes a real
  lookup: `Combatant.position` → the grid hex under the platoon (via
  `state.grid.hexes`) → that hex's `terrain` field, shown alongside whether
  it matches the platoon's own `preferredTerrain` (e.g. `Terrain: Forest
  (+)` when standing on home turf, `Terrain: Hill` otherwise).
- [src/views/manualBattleArena.ts:1234-1302](../src/views/manualBattleArena.ts)'s
  `draw()` is the canvas renderer for the battle grid. The per-hex fill
  logic is three-way today (line 1244):
  `ctx.fillStyle = hex.impassable ? "#3a2a2a" : inRange ? "rgba(210,210,215,0.35)" : "#20242c"`
  — impassable obstacles get a dark brown fill, in-range-for-movement hexes
  get a translucent white overlay, everything else is a flat dark
  background color. There is currently no per-hex visual variety among
  *passable* hexes at all. Making terrain "visibly render differently on
  the grid" means extending this ternary into a terrain → base-color
  lookup (still overlaid by the in-range highlight and the impassable
  override, which should keep taking priority so obstacles/movement
  feedback aren't obscured) — a config-driven color map (e.g. in
  `combatConfig.ts` or inline in the view) is the smallest version of this,
  textures/sprites would be a later polish pass.
- [shared/combat/manualBattle.ts:105-109](../shared/combat/manualBattle.ts)'s
  `remainingMovement()` and
  [manualBattle.ts:190-210](../shared/combat/manualBattle.ts)'s
  `movementCosts()` are the movement-budget BFS: every non-impassable,
  unoccupied neighbor hex costs exactly 1 step (`visited.set(key, dist +
  1)`, line 205), regardless of what's there. A terrain-based movement cost
  (e.g. forest costs 2 to enter) would mean looking up `hex.terrain` inside
  the BFS's neighbor-expansion loop and using a per-terrain cost instead of
  the flat `+1` — a real but scoped change, isolated to this one function.
  `hasLineOfSight()` (lines 234-247) currently only blocks on
  `hex.impassable`; a "forest blocks/reduces LOS" idea is plausible future
  design space but is **not** part of this plan — flagged here only so a
  later terrain-v2 doc doesn't have to rediscover the seam.

## Proposed model (v1, deliberately simple)

Deliberately **not** a biome/weather system — no seasonal effects, no
per-terrain unit restrictions, no terrain-driven vision/LOS changes. Just
enough for "some hexes are visibly different and reward standing on your
preferred one."

- **A small fixed set of terrain types**, matching the visual variety the
  obstacle system already hints at (dark "obstacle" hexes vs. open
  ground): `plains` (the default — most of the grid), `forest`, `hill`.
  Exactly three keeps the type→bonus→color mapping trivial to reason about
  and matches the existing three `AdvantageType` triangle nodes in scale
  (`combatConfig.ts`'s `TYPE_TRIANGLE`), though there's no gameplay reason
  it must stay at three going forward.
- **`terrain: TerrainType` field on `BattleHex`**
  (`shared/combat/types.ts`), independent of `impassable`. Obstacles keep
  meaning "can't stand here" exactly as today; terrain is a separate
  passable-hex attribute. `makeBattleGrid()` assigns every hex a terrain
  (defaulting new/impassable hexes to `plains` is fine — an impassable
  hex's terrain is never read since nothing can stand on it) using the same
  seeded RNG so terrain layout stays deterministic-given-seed and
  reproducible under the scouting/`fixedObstacles` path the same way
  obstacle placement already is.
- **`preferredTerrain?: TerrainType` field on `UnitType`**
  (`src/state/units.ts`), optional (many units — especially generic
  infantry — may have no preference, i.e. `undefined`/`plains`-neutral).
  Sourced from unit data the same way `advantageType`/`specialty` are.
- **A flat combat multiplier, applied per-side, per-attack** — following
  morale/fatigue's seam exactly: when computing `computeDamage()`, look up
  the attacking platoon's current hex terrain against its entries'
  dominant `preferredTerrain` and, if they match, scale `effAttack` by
  `TERRAIN_BONUS_MULTIPLIER`; independently, do the same lookup for the
  defending platoon's hex/terrain against its `effDefense`. Both checks are
  independent — an attacker and defender can each be on their own
  preferred terrain in the same exchange, or neither, or one of the two.
  One named constant (`TERRAIN_BONUS_MULTIPLIER`, e.g. `1.2`) in
  `combatConfig.ts`, not per-terrain-type tuning — keep v1 to a single
  number, matching how `TYPE_ADVANTAGE_MULTIPLIER` is one number for the
  whole triangle rather than one per matchup.
- **Dominant-preference lookup for mixed platoons** reuses the same
  weighted-majority shape `computeSpecialty()` already establishes
  (`shared/combat/manualBattle.ts:417-446`) rather than inventing a new
  aggregation rule — sum entries by `preferredTerrain`, take the largest
  group, no threshold gate needed for a damage multiplier the way
  `SPECIALTY_VISIBILITY_THRESHOLD` gates the UI icon (a partial bonus
  reads fine; a partial icon reveal doesn't).
- **Movement cost is explicitly out of v1, flagged as a stretch/later
  phase** — see "Implementation phases" step 7 below. The combat bonus
  alone is a complete, shippable v1; movement cost touches a BFS shared
  with obstacle avoidance and deserves its own testing pass rather than
  landing in the same PR.
- **This session's UI decision, restated:** the platoon status tile ships
  *now* with a `Terrain: —` placeholder (see the exact citation above),
  ahead of this mechanic existing — same treatment as Morale/Fatigue. Once
  steps 1-2 below land, the tile's real value is just `state.grid.hexes`
  looked up by `Combatant.position`, plus the platoon's own
  `preferredTerrain` for the "(+)" match indicator — no new state needed
  beyond what this plan already adds.

## Implementation phases

1. **Terrain types & constants** — add a `TerrainType` union
   (`"plains" | "forest" | "hill"`) and `TERRAIN_BONUS_MULTIPLIER` to
   `shared/combatConfig.ts`, following the file's existing constant style.
2. **Data model** — add `terrain: TerrainType` to `BattleHex`
   (`shared/combat/types.ts:6-8`) and `preferredTerrain?: TerrainType` to
   `UnitType` (`src/state/units.ts:15-36`).
3. **Grid generation** — extend `makeBattleGrid()`
   (`shared/combat/grid.ts:12-45`) to assign a terrain to every hex using
   the existing seeded `rng`, and to restore terrain (not just
   `impassable`) from a `fixedObstacles`-equivalent locked layout so
   scouted tiles stay fully reproducible, not just obstacle-reproducible.
4. **Damage math hookup** — in `computeDamage()`
   (`shared/combat/damage.ts:78-99`), thread each side's current hex
   terrain in (the caller — `resolveAttack()` in `resolveBattle.ts`/
   `manualBattle.ts` — already has both combatants' `position`s and the
   `grid`, so this is a lookup at the call site, not new state), and apply
   `TERRAIN_BONUS_MULTIPLIER` to `effAttack`/`effDefense` exactly where
   fatigue/morale are planned to apply their own multipliers per
   [docs/morale-fatigue-plan.md](morale-fatigue-plan.md) step 5 — same
   step, same seam, so the two features compose instead of conflicting.
5. **Rendering** — extend `draw()`'s hex-fill logic
   (`src/views/manualBattleArena.ts:1244`) with a terrain → base-color
   lookup, keeping the existing `impassable` and `inRange` overrides taking
   priority in that order.
6. **UI wiring** — replace the `Terrain: —` placeholder in
   `buildStatusTile()` (`src/views/manualBattleArena.ts:537-543` area)
   with the real per-hex/per-platoon lookup described above.
7. **(Stretch, optional for v1) Movement cost interaction** — give
   `movementCosts()` (`shared/combat/manualBattle.ts:190-210`) a per-terrain
   step cost instead of the flat `+1`, e.g. forest costs 2. Deliberately
   deferred: it changes pathing behavior (and interacts with the
   `RANGED_ATTACK_RANGE`/line-of-sight logic in ways combat-bonus-only
   terrain doesn't), so it should land as its own follow-up once the
   combat-bonus half has shipped and been played with.
8. **Tests** — extend `test/combat/` coverage (mirroring
   `manualBattle.test.ts`/`resolveBattle.test.ts` conventions) for: terrain
   assignment is deterministic given a seed, the damage multiplier applies
   only when a platoon's dominant `preferredTerrain` matches its current
   hex, and (if step 7 lands) movement costs reflect terrain correctly in
   `movementCosts()`/`getMovementRange()`.

## Acceptance criteria

- `BattleGrid`/`BattleHex` carries a real `terrain` value per hex,
  generated deterministically from `obstacleSeed`/`fixedObstacles` the same
  way obstacles already are.
- `UnitType` carries an optional `preferredTerrain`, and platoons with a
  dominant preferred terrain measurably deal/take different damage
  depending on which hex they're fighting from — not just a cosmetic
  label.
- `TERRAIN_BONUS_MULTIPLIER` (and the terrain type list) are named
  constants in `combatConfig.ts`, not inlined magic numbers.
- The battle grid visibly renders terrain variety (`draw()`), distinct from
  and layered correctly under the existing impassable/in-range overlays.
- `manualBattleArena.ts`'s status tile shows the platoon's real current
  terrain (and whether it matches that platoon's preference) instead of
  the `—` placeholder.
- No change to `resolveBattle`/`manualBattle`'s turn-order shape — this
  stays a stat-multiplier layer on the existing engine, matching the
  constraint `docs/morale-fatigue-plan.md` holds itself to.
- Movement-cost effects remain fully optional/deferred unless explicitly
  scoped into a follow-up phase.

## Suggested implementation order

1. Data model + constants (steps 1-2) — no behavior change yet, just the
   fields existing, defaulting every hex to `plains` and every unit to no
   preference.
2. Grid generation (step 3) — terrain now actually varies across a
   generated grid, still no gameplay effect.
3. Damage math hookup (step 4) — smallest closed loop that makes terrain
   *matter*, testable in isolation the same way fatigue/morale's step 5 is.
4. Rendering + UI wiring (steps 5-6) — now there's real data to show, and
   the player can see why a fight went the way it did.
5. Tests throughout, not deferred to the end — each phase above should
   land with its own coverage in the same PR, per the same discipline
   `docs/morale-fatigue-plan.md` calls out.
6. Movement cost (step 7) — only after the above has shipped and the
   combat-only version has been played with; revisit as its own follow-up
   rather than bundling it in up front.
