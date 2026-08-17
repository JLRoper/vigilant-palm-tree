# Combat Resolution Engine — Technical Design (as built so far)

**Status:** In progress, uncommitted on `feature/combat-resolution-engine`. Describes
the code that exists in the working tree today, not the target/finished
design — see [`../feature-plans/CombatResolutionEngine.md`](../feature-plans/CombatResolutionEngine.md) for the
locked design decisions this implements. Update this doc as the
implementation changes; it should always describe what's actually there.

**Framing:** the resolver at [`shared/combat/resolveBattle.ts`](../shared/combat/resolveBattle.ts) documented here is the **temporary default auto-resolver** that runs server-side via the `ResolveBattle` command on `POST /api/games/:name/commands` whenever heroes collide on the adventure map. It is auto in the sense that no player drives it; the eventual target is the **tactical (manual) resolver** at [`shared/combat/manualBattle.ts`](../shared/combat/manualBattle.ts) + the dev Test Battle arena at [`src/views/manualBattleArena.ts`](../src/views/manualBattleArena.ts), which is the work this engine feeds into. See [`./army.md`](./army.md) for the full status.

## 1. Summary

A pure, deterministic hex-battle resolver (`shared/combat/resolveBattle.ts`) — currently the **temporary default auto-resolver** for adventure-map combat — replaces the old
"defender just vanishes" stub behind what is now the `ResolveBattle` command on
`POST /games/:name/commands`. Given two 8-slot platoon rosters, it plays
out stat-comparison combat with type advantages, counterattacks, and
per-side retreat policies, and returns a full result + replayable log. The
route now applies that result to `heroes` JSONB instead of deleting the
defender.

## 2. Dependencies

**Upstream (things this engine reads or builds on):**
- `unit_types` DB table (`server/migrations/002_unit_types.sql`), extended by
  the new `server/migrations/005_unit_counters.sql` with an `advantage_type`
  column (`infantry` / `cavalry` / `ranged` / `monster`, `NOT NULL DEFAULT
  'infantry'`, checked). Applied via `server/db.ts:initSchema()`, which now
  also runs `005_unit_counters.sql` on every server start (idempotent:
  `ADD COLUMN IF NOT EXISTS`, `DROP COLUMN IF EXISTS` for two abandoned
  earlier column names).
- `src/core/hex.ts` — `Axial` type, reused as-is for battle-grid coordinates
  (no new hex-math was needed).
- `src/core/rng.ts` — `mulberry32(seed)`, reused for seeded, reproducible
  obstacle-layout generation (separate from the module-level `rng()` used
  elsewhere for non-deterministic randomness).
- `src/state/units.ts` — `Platoon` / `PlatoonEntry` / `UnitType` /
  `ARMY_STACK_SLOTS` / `MAX_PLATOON_ENTRIES`, the army data model the
  resolver operates on (see §4).

**Downstream (things that now depend on this engine):**
- `server/app/commandHandler.ts` (`ResolveBattle` command, via
  `POST /games/:name/commands`) — calls `resolveBattle()` directly
  (server-authoritative; needs the DB-backed unit-type catalog).
- `src/state/turnController.ts` `resolveCurrentBattle()` — awaits the
  server's result via `hooks.onBattleResolved` *before* closing out the
  local `BATTLE` phase (previously resolved combat locally, then
  synced after).
- `src/game/turnHooks.ts` `onBattleResolved` — calls `resolveBattle()` in
  `src/io/api.ts`, merges `players`/`heroes` back into `GameState`.
- `src/views/heroInfoMenu.ts` — renders a `Platoon`'s up-to-3 `entries`
  instead of a single `{ unitTypeId, count }` stack (primary unit's image +
  total count + a "+N" badge for mixed platoons).
- `test/combat/resolveBattle.test.ts`, `test/state/gameState.test.ts` —
  updated/new coverage (see §7).

**No new package dependencies** — everything is built from existing
in-repo primitives (`mulberry32`, `Axial`, `node:test`).

## 3. Architecture

```
                         ┌───────────────────────────────┐
                         │   shared/combat/  (pure, no    │
                         │   DB/HTTP/IO — used by both    │
                         │   client and server)           │
                         │                                │
                         │  types.ts     — all interfaces │
                         │  grid.ts      — battle grid +  │
                         │                 deployment      │
                         │  damage.ts    — damage formula, │
                         │                 type multiplier,│
                         │                 casualty/retreat│
                         │                 math            │
                         │  resolveBattle.ts — turn loop,  │
                         │                 counterattacks,  │
                         │                 retreat policy   │
                         │  index.ts     — re-exports      │
                         └───────────┬────────────────────┘
                                     │ imports
                    ┌────────────────┼─────────────────────┐
                    │                                       │
        ┌───────────▼───────────┐                ┌──────────▼─────────┐
        │ commandHandler.ts      │                │ src/state/units.ts  │
        │ ResolveBattle command  │                │ Platoon/PlatoonEntry│
        │ - loads unit_types     │                │ /UnitType shapes    │
        │ - normalizePlatoons()  │                │ shared by client &  │
        │ - resolveBattle(...)   │                │ server              │
        │ - writes heroes JSONB  │                └─────────────────────┘
        │ - logs combat_resolved │
        └───────────┬────────────┘
                    │ HTTP response { players, heroes, battle }
        ┌───────────▼────────────┐
        │ src/io/api.ts           │
        │ resolveBattle(name,...) │
        └───────────┬─────────────┘
                    │
        ┌───────────▼────────────────┐
        │ src/game/turnHooks.ts       │
        │ onBattleResolved(state)     │
        │ - merges players/heroes     │
        │ - console.logs outcome       │
        └───────────┬──────────────────┘
                    │
        ┌───────────▼───────────────────┐
        │ src/state/turnController.ts     │
        │ resolveCurrentBattle()          │
        │ - awaits onBattleResolved first │
        │ - then endBattlePhase() (local, │
        │   just clears BATTLE phase)     │
        └────────────────────────────────┘
```

Key architectural decision: **the resolver is pure and side-effect-free**
(`shared/combat/resolveBattle.ts` touches no DB/HTTP), so it's usable from
both the server route and (later) a client-side preview/replay without
duplicating logic. Combat is **server-authoritative** — the client never
computes the outcome itself, only replays the `BattleResult` it's handed
back, because only the server has the `unit_types` catalog (client caches a
copy via `GET /api/units` / `src/data/unitCatalog.ts`, but that's for display,
not for resolving fights).

`src/state/gameState.ts`'s old `resolveBattle()` reducer was renamed to
`endBattlePhase()` and stripped down to just the phase transition
(`BATTLE` → `PLAYER_TURN`) — it no longer touches gold or deletes heroes.
That responsibility moved entirely server-side.

**Scope boundary — manual-arena surrender.** The Test Battle UI
(`src/views/manualBattleArena.ts`) adds a separate gold-gated
side-concession that is *not* part of this resolver's `RetreatPolicy`
system: the player's Surrender button costs `SURRENDER_COST_GOLD` (5000G,
from `shared/combatConfig.ts`); if the hero can't cover it, a Leave
Behind picker opens at `SURRENDER_UNIT_VALUE_GOLD` (100G) per unit,
strips the chosen counts off the surviving platoons (so they surface as
casualties on the result card via the same `buildResults` diff), and
then calls `retreatHero(... applyLoss: false)`. The auto-resolve
`RetreatPolicy` (auto/custom/fight) still governs in-flight
retreats during the turn loop; the manual surrender is purely a player
action that sits on top.

## 4. Objects / types (`shared/combat/types.ts` unless noted)

| Type | Shape | Purpose |
|---|---|---|
| `Platoon` / `PlatoonEntry` (`src/state/units.ts`) | `{ entries: PlatoonEntry[] }`, `{ unitTypeId, count }` | Army data model: 8 slots per hero, ≤3 entries per platoon. `normalizePlatoons()` sanitizes/pads to exactly `ARMY_STACK_SLOTS`. |
| `UnitType` (`src/state/units.ts`) | adds `advantageType: AdvantageType` to the existing attack/defence/health/speed/description fields | Now carries the type-advantage tag read from the DB's `advantage_type` column. |
| `AdvantageType` (`shared/combatConfig.ts`) | `"infantry" \| "cavalry" \| "ranged" \| "monster"` | Type-advantage tag domain. |
| `BattleHex` / `BattleGrid` | `Axial & { impassable }`, `{ cols, rows, hexes }` | Battle-grid representation; generated by `makeBattleGrid()`, seeded or fixed. |
| `Combatant` | one live platoon in a running battle: `{ side, slotIndex, position, entries, maxHealth, hasCounterCharge, retreated }` | The resolver's internal working unit — `slotIndex` ties results back to `ARMY_STACK_SLOTS`. |
| `CombatEffect` | `{ kind: "damage", side, attackerSlot, targetSlot, damage, advantageBonus, disadvantagePenalty, casualties, isCounterattack }` | Output of one `resolveAttack()` call — the extension seam for a future ability layer. |
| `BattleLogEntry` | `CombatEffect` tagged with `round`, or `self_retreat` / `hero_retreat` / `stalemate` variants | Full replayable turn-by-turn log. |
| `CombatantOutcome` | `"won" \| "lost_all_troops" \| "retreated_self" \| "retreated_hero" \| "survived"` | Per-platoon and per-side outcome tag. |
| `CombatantResult` | `{ slotIndex, platoon, outcome, casualties }` | Per-slot final state, used to rebuild `HeroState.stacks`. |
| `BattleResult` | winner, both sides' outcomes/platoons/results, Renown deltas, `rounds`, `log`, `grid`, `obstacleSeed` | Top-level return value of `resolveBattle()`; also what the HTTP response and client both carry around. |
| `RetreatPolicy` | `{kind:"fight"} \| {kind:"auto", selfRetreatHpPct, heroRetreatHpPct} \| {kind:"custom", decide}` | Caller-suppliable per-side decision policy, evaluated once per round. |
| `SideModifiers` | `{ damageMultiplier: number }` | Unused today; hook point for a future Day/Night modifier. |
| `ResolveBattleOptions` | unit types, obstacle seed/fixed layout, side choice, grid size, retreat policies, modifiers, `maxRounds` | Full input contract to `resolveBattle()`. |

Tunable constants live in `shared/combatConfig.ts`
(`TYPE_ADVANTAGE_MULTIPLIER = 1.3`, `TYPE_DISADVANTAGE_MULTIPLIER = 0.7`,
`TYPE_TRIANGLE`, `PLATOON_RETREAT_LOSS = 0.15`, `HERO_RETREAT_PENALTY = 0.5`,
grid defaults, `DEFAULT_MAX_ROUNDS = 30`) — a single edit point for balance
passes, per the feature plan's "Tunability" section.

## 5. Core algorithms

### 5.1 Auto-resolver (`shared/combat/resolveBattle.ts`)

1. **Setup:** build a `BattleGrid` (seeded or fixed obstacles), convert both
   platoon rosters into `Combatant[]` (empty platoons filtered out,
   deployed one-per-row in the outer columns via `deploymentPosition()`).
2. **Round loop** (up to `maxRounds`, default 30): stops early once one side
   has no living combatants.
   - **Turn order:** alternates attacker/defender, slot-index order within
     each side (interleaved, not speed-based — a deliberate simplification
     per the feature plan).
   - **Attack resolution** (`resolveAttack`): `computeDamage()` sums
     effective attack (Σ attack × count) vs. average effective defense,
     applies the ratio formula `atk² / (atk + def)`, then the type-advantage
     multiplier from `typeMultiplier()`, then the caller's `SideModifiers`
     multiplier. `applyCasualties()` subtracts damage entry-by-entry in
     listed order.
   - **Counterattack chain:** a hit combatant that survives and still has
     `hasCounterCharge` immediately counters; a counter itself can be
     countered once more if the original attacker's own charge is still
     available. Charges refill only at the start of that platoon's own
     turn. This is implemented as a `for(;;)` ping-pong loop in
     `resolveBattle()`, not a fixed depth-2 special case, so it
     self-terminates whenever a charge is spent.
   - **Retreat policy check** (`applyRetreatPolicy`): evaluated once per
     side at the end of each round, given a `BattleSnapshot` (cloned
     combatant state). `"auto"` computes side-wide and per-platoon
     HP percentages against configurable thresholds; `"custom"` hands a
     decision list back from caller-supplied logic; `"fight"` never
     retreats. A whole-side retreat immediately ends the battle.
3. **Outcome resolution:** winner/draw and per-side `CombatantOutcome`
   derived from which side(s) still have living combatants and whether a
   hero-retreat occurred; a `stalemate` log entry is added if `maxRounds`
   is hit with both sides still alive.
4. **Result construction:** `buildResults()` diffs original vs. surviving
   entries per slot to produce casualties, and reconstitutes each side's
   platoon array (re-indexed by `slotIndex`) for the caller to write back
   to `HeroState.stacks`.

### 5.2 Manual arena (`shared/combat/manualBattle.ts`)

Shares the grid, damage and result-building primitives with the auto-resolver
but replaces its turn loop with player/AI-driven per-platoon actions. Reachable
today only from the Test Battle sandbox (`src/views/testBattleSetup.ts`).

- **Round model:** each side holds a set of platoons that have not yet acted
  this round (`unactedAttacker` / `unactedDefender`). Every living platoon gets
  one action per round; the player chooses the order theirs act in. The round
  advances — and both unacted sets and movement budgets refill — only once both
  sides' sets are empty (`checkRoundAdvance`).
- **Movement vs. action:** a platoon's movement budget for the round is its
  slowest unit's speed and may be spent across several separate moves. Moving
  does *not* consume its action; attacking (or `endPlatoonTurn`) does.
  `getMovementPath()` returns the hex-by-hex route to a destination —
  informational only, for animating the walk; `movePlatoon()` still takes a
  destination and re-derives the cost itself.
- **Turn order is strict alternation**, enforced by the arena rather than the
  engine: one player platoon acts, then one AI platoon, back and forth. Every
  path by which a player platoon can finish — attacking, bumping into melee,
  the End Turn button, or exhausting its movement with nothing in range — must
  route through `afterPlayerAction()`. When one side's pool empties first, the
  other runs out its remaining platoons consecutively to close the round.
- **AI decision/execution split:** `planAiTurn()` is pure and returns an
  `AiTurnPlan` (`slotIndex`, optional `moveTo`, optional `attackTargetSlot`)
  for the lowest unacted slot; `executeAiPlan()` applies it. `runAiTurn()`
  wraps both for callers that want the whole turn in one step. The split exists
  so the arena can render the decision (telegraph, walk animation) *before* its
  effect lands, instead of the board teleporting. The heuristic itself is
  unchanged and deliberately simple: target the weakest living enemy via the
  shared `pickTarget()`, close to range/adjacency, attack if able.
- **Turn consumption is unconditional.** `executeAiPlan()` falls back to
  `endPlatoonTurn()` whenever the attack is refused — a slot left in the
  unacted pool would stall `checkRoundAdvance` for the rest of the battle.

## 6. Type-advantage & damage formula (`shared/combat/damage.ts`)

- **Formula:** `effAttack = Σ(attack × count)` over the attacker's entries;
  `effDefense = Σ(defence × count) / totalCount` (average) over the
  defender's entries; `rawDamage = effAttack² / (effAttack + effDefense)`;
  final `damage = round(rawDamage × typeMultiplier × sideModifier)`,
  floored at 1. No random swing — same inputs always produce the same
  damage.
- **Type triangle:** infantry beats cavalry beats ranged beats infantry,
  symmetric ±30% (`1.3×` / `0.7×`). `monster` is a one-way exception: always
  gets the +30% attacking any base tag, never takes the −30% in return,
  and monster-vs-monster is neutral (`1.0×`). A platoon's type set is the
  union of its (≤3) entries' tags — if any entry is advantaged/disadvantaged
  against the target, the whole platoon's attack gets that multiplier
  (no partial/mixed application within one attack).

## 7. Data model changes

`server/migrations/005_unit_counters.sql`:
```sql
ALTER TABLE unit_types ADD COLUMN IF NOT EXISTS advantage_type TEXT NOT NULL
  DEFAULT 'infantry' CHECK (advantage_type IN ('infantry','cavalry','ranged','monster'));
ALTER TABLE unit_types DROP COLUMN IF EXISTS counter_type;      -- abandoned earlier name
ALTER TABLE unit_types DROP COLUMN IF EXISTS strong_against;    -- abandoned earlier name
-- + UPDATE statements tagging all 12 existing units per the table in
--   CombatResolutionEngine.md
```
Auto-discovered by `server/db.ts:initSchema()` (every `*.sql` file in
`server/migrations/`, sorted by filename — so this one applies right after
`004_game_assets.sql`); runs on every boot (idempotent).

`GET /api/units` and the `ResolveBattle` command handler both now select
`advantage_type` and map it to `UnitType.advantageType` in application code
(`UnitTypeRow` → `UnitType` mapping duplicated across `server/routes.ts` and
`server/app/commandHandler.ts` — see §9 gaps).

`HeroState.stacks` (`src/state/gameState.ts`) is now typed `Platoon[]`
instead of `UnitStack[]`; `src/entities/hero.ts`'s `Hero` class mirrors the
same change. `normalizeStacks` → `normalizePlatoons` throughout.

## 8. API contract change

The `ResolveBattle` command (`POST /games/:name/commands`):
- **Request:** unchanged shape (attacker/defender hero IDs; no battle
  location/tile is passed yet — flagged as a known gap, see §9 and the
  feature plan's "Battle grid" section).
- **Response:** was `{ players, heroes }`; now `{ players, heroes, battle }`
  where `battle: BattleResult` carries the full outcome/log (`src/io/api.ts`
  `ResolveBattleResult`).
- **Event log:** `combat_won` → `combat_resolved`, payload now includes
  `winner`, `attackerOutcome`, `defenderOutcome`, `rounds` alongside the
  existing `attackerId`/`defenderId`/`attackerOwnerId`/`rewardGold`.
- **Gold/loot:** only transferred when `defenderOutcome === "lost_all_troops"`
  (previously: always, since the defender was always deleted). Hero
  entities are **never deleted** now — a fully-defeated hero just ends up
  with empty platoons; what happens to that hero (capture/ransom/etc.) is
  explicitly out of scope for this engine.

## 9. Known gaps / not yet implemented

These are things visible in the current diff that aren't finished, as
distinct from the feature plan's deliberate "out of scope" list:

- **Obstacle seed isn't reproducible in practice.** `server/routes.ts`
  generates `obstacleSeed` as `(row.id * 2654435761 + Date.now()) >>> 0` —
  including wall-clock time means the same fight can't be replayed
  identically from the same DB state, undercutting the "deterministic
  given seed" goal for anything beyond the same in-process call. No tile
  location is threaded through yet either (needed for the scouting
  feature described in the plan).
- **Battle-grid position is generated but not used by combat resolution.**
  `Combatant.position` and obstacle placement exist, but `pickTarget()`
  targets purely by lowest-HP-then-slot-index — no adjacency, movement, or
  obstacle-blocking logic reads `position`/`impassable` at all yet. The
  `obstacleSeed changes obstacle layout but not combat log` test
  (`test/combat/resolveBattle.test.ts:36`) documents this as current,
  expected behavior, not a bug — but it means the grid is currently
  cosmetic/log-only.
- **No UI for any of this.** `turnHooks.ts` only `console.log`s the battle
  outcome; there's no battle-screen rendering of the log, grid, or
  round-by-round combat (tracked separately as implementation-order.md #7,
  explicitly deferred by the feature plan).
- **`UnitTypeRow` → `UnitType` mapping is duplicated** across
  `server/routes.ts` (`GET /units`) and `server/app/commandHandler.ts`
  (the `ResolveBattle` command handler) — worth collapsing into one
  helper if a third call site appears.
- **No overworld trigger, capture/pillage, or reputation mutation** yet —
  all explicitly out of scope per the feature plan (items #3/#2/#4 in
  `implementation-order.md`).
- **`docs/GDD.md` §4 in the sibling Kingdom Rule repo** still says "8
  individual units... not a squad/stack" and hasn't been updated to
  reflect the platoon model this implements.

## 10. Testing

- `test/combat/resolveBattle.test.ts` (new): determinism given a seed,
  obstacle-seed independence from the combat log, no-retreat-loss wipeout,
  empty-roster instant win, auto self-retreat and hero-retreat policies,
  custom retreat policy callback, the counterattack-chain sequencing (4
  hits/round breakdown for symmetric platoons), and both type-advantage
  and monster-exception damage multiplier checks.
- `test/combat/manualBattle.test.ts`: movement budget carry-over and per-round
  speed cap, line-of-sight blocking, melee/ranged target validation, wipeout
  detection; plus `getMovementPath()` (route contents, one-hex steps, routes
  around obstacles, unreachable/self destinations), `planAiTurn()` purity
  (planning moves nothing, deals no damage, consumes no turn), and
  `executeAiPlan()` consuming the turn even when the attack is refused.
- `test/state/gameState.test.ts` (updated): `resolveBattle` reducer tests
  replaced with `endBattlePhase` tests (phase transition only, no
  gold/hero mutation); `reorderStack` tests updated for the
  `Platoon`/`entries` shape.
- Run via `npm test` (`node tools/run-test.mjs smoke`, which writes `local/.test-request.json` and hands off to `test/smoke.ts`) — note
  `test/combat/` isn't wired into `test/smoke.ts` or `package.json` scripts
  yet; currently must be run directly, e.g.
  `tsx --env-file=.env test/combat/resolveBattle.test.ts`. The
  `npm run test:all` chain also routes through `tools/run-test.mjs`, so
  every entry in the suite shares one boot contract.
