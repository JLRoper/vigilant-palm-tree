# Combat Resolution Engine — Feature Plan

Source: [`implementation-order.md`](../implementation-order.md) item **#1**.
Design intent for the target system lives in the sibling Kingdom Rule
project: `docs/GDD.md` §9/§9a/§9b and `docs/MANUAL.md` "How battles resolve"
(`C:\Users\james\Documents\Projects\KingdomRule`). This doc maps that design
onto what actually exists in *this* repo today.

## Why this is first

`implementation-order.md` reprioritizes Combat Resolution from "Phase 2" to
the starting point of the whole roadmap: Economy/Trade are being ported from
this codebase rather than built fresh, which removes the old blocking
prerequisite. Combat has no dependencies of its own, and what's here today
is only auto-resolve — not a real hex-battle engine — so it's genuinely
net-new work that unblocks Castle Actions (#2 — independent of this), Hero
Action Expansion (#3), the Political Layer's revolt combat (#4), and
Day/Night's combat modifier hook (#6).

## Current state (what exists in this repo today)

- `POST /games/:name/resolve-battle` (`server/routes.ts:609-717`) is the
  entire combat system right now: it looks up the attacker/defender hero,
  deletes the defender outright, transfers the defender's gold to the
  attacker, and logs a `combat_won` event. No stats are compared, no units
  survive or die individually, there's no grid.
- `docs/army.md` documents a **deferred** tactical system with its own
  auto-resolve plan (`attack`/`defense` derived from unit types + counts,
  random ±20% swing, instant outcome, no per-unit positioning) and notes a
  possible tactical-grid mode *after* that ships. `implementation-order.md`
  supersedes this — Kingdom Rule wants the hex tactical grid as the v1
  target, not a later stretch goal. **`docs/army.md`'s "deferred" framing
  needs to be reconciled/updated once this plan is adopted.**
- Units are DB-backed: `server/migrations/002_unit_types.sql` defines
  `unit_types` (`attack`, `defence`, `health`, `speed`, no counter/type
  tags) seeded with 12 units (peasant → black_dragon). Served via
  `GET /api/units`, cached client-side in `src/data/unitCatalog.ts`.
- Army composition is **single-type stack-based**: `src/state/units.ts`
  gives each hero exactly `ARMY_STACK_SLOTS` (8) slots, each holding
  `{ unitTypeId, count }` — one unit type per slot. **Resolved decision:**
  each slot becomes a **platoon** that can carry up to **3 unit types**
  simultaneously (see "Army model: platoons" below) — a middle ground
  between the current single-type stack and Kingdom Rule's GDD §4/Q3
  wording ("8 individual units... not a squad/stack"), which this
  supersedes for the actual implementation. `docs/GDD.md` §4 in the
  Kingdom Rule repo should be updated to match once this lands.
- The overworld is already a proper hex grid (`docs/map.md`: 24×18,
  axial `(q, r)`) — a separate battle sub-grid (GDD §9) is new but can
  reuse the same axial-coordinate conventions and hex-math utilities.
- Hero death today is instant deletion + gold loot. Kingdom Rule's design
  wants retreat paths (self-retreat per-unit at 15% loss, full hero
  retreat at 50% Renown/morale cost) and only loses all troops on an
  outright, no-retreat loss — a materially different flow.

## Scope

**In scope for this engine:**
- A standalone hex battle-grid resolver: given two rosters + starting
  positions, plays out stat-comparison combat with unit-type counters,
  returns a result (winner, per-unit survived/lost, a replayable log).
- Self-retreat (single unit, 15% loss) and full hero retreat (50%
  Renown/morale hit), replacing the current "defender just vanishes"
  behavior.
- The no-retreat loss path (lose all troops, triggers whatever the
  political/reputation system's response is — left to a later phase to
  wire up, this engine just needs to emit the result).
- Rewriting `POST /games/:name/resolve-battle` to call into this resolver
  instead of deleting the defender outright.
- Unit-type counter data (extending `unit_types`) and the damage formula —
  neither exists yet in this schema or in Kingdom Rule's GDD (flagged as
  an open item there too), so this phase closes that design gap as well
  as implementing it.

**Out of scope (left to later phases per implementation-order.md):**
- The overworld trigger for hero-vs-hero contact (walk into an enemy
  party → fight-or-trade choice) — that's Hero Action Expansion (#3),
  which will call into this resolver once built.
- Capture/pillage application logic on tiles/castles (#2/#3).
- Reputation/Favor mutation on loss (#4 — doesn't exist in this repo at
  all yet, per `implementation-order.md`).
- Day/night combat modifiers (#6) — this engine should expose a hook/
  multiplier point for it, not implement it.
- Battle-screen UI/rendering (#7, Client/UX Catch-Up) — can ship behind
  the existing event-log/API response shape first.

## Army model: platoons (resolved)

Each hero keeps **8 slots**, matching the current `ARMY_STACK_SLOTS`, but
each slot is now a **platoon** that can hold **up to 3 unit types** at
once (each with its own count), instead of today's one-type-per-slot
stack. Concretely, `src/state/units.ts`'s `UnitStack` (`{ unitTypeId,
count }`) becomes something like:

```ts
interface PlatoonEntry { unitTypeId: string; count: number }
interface Platoon { entries: PlatoonEntry[] } // entries.length <= 3
```

`ARMY_STACK_SLOTS` (8) is unchanged — a hero still has 8 platoons, just
each one is now mixed-composition. This is the shape `Combatant` and the
resolver below are built around.

Two follow-ups this creates, both worth resolving early rather than
during implementation:
- `docs/GDD.md` §4 in the Kingdom Rule repo currently says "8 individual
  units... not a squad/stack" — that wording is superseded by the platoon
  model and should be updated to match.
- Retreat granularity needs a decision: GDD's "any individual unit can
  self-retreat mid-battle at 15% loss" now has to map onto *which* level
  retreats — a whole platoon, or one unit type's count within a platoon
  (peeling entries the way single-type stacks do today). See Open
  Decisions below.

## Data model additions

- `unit_types`: add a counter-type tag (e.g. `counter_type` +
  `strong_against text[]`) — the actual chart still needs designing, a
  small rock-paper-scissors set (infantry/cavalry/ranged, roughly mapping
  onto the existing 12-unit roster) is the minimum viable version.
- New `shared`-style module (this repo has no `shared/` yet — client and
  server currently duplicate types like `UnitType`; worth a shared module
  for combat types specifically) with:
  - `BattleHex` — bounded battle grid, reusing the overworld's axial
    convention, some hexes flagged impassable.
  - `Combatant` — a platoon (or a single platoon-entry, depending on the
    retreat-granularity decision) + side + battle-grid position.
  - `BattleResult` — outcome, per-combatant survived/lost/retreated, hero
    Renown/morale deltas, a turn-by-turn log the client can replay.

## Resolution flow (proposed)

1. Pure function `resolveBattle(attackerPlatoons, defenderPlatoons, options)`
   — no DB/HTTP concerns, so it's testable standalone and reusable for
   hero-vs-hero fights and any future bandit/neutral-camp equivalent.
2. Place both rosters on a bounded battle grid sized for ≤8 platoons per
   side + a few obstacle hexes (GDD §9). Whether each platoon occupies one
   hex as a mixed-composition unit, or its ≤3 entries spread across
   adjacent hexes, is part of the retreat-granularity decision below.
3. Resolve in initiative order: each combatant attacks per stat comparison
   + counter bonus; track health/losses per platoon entry (unit type +
   remaining count).
4. Expose retreat as a resolution choice at whatever granularity gets
   decided (whole platoon, or one entry's count peeled off) rather than
   only computing a final win/loss — the caller decides whether to pull
   out mid-battle.
5. Return a `BattleResult`; `POST /games/:name/resolve-battle` applies it
   (update `heroes` JSONB with surviving platoons instead of
   `delete heroes[defenderId]`, transfer loot only on an actual win, log a
   richer `combat_resolved` event instead of always `combat_won`).

## Open decisions to resolve during this phase

- Retreat granularity for platoons: does "any individual unit can
  self-retreat at 15% loss" (GDD §9/MANUAL.md) apply to a whole platoon,
  or to one unit-type entry's count within a platoon? Blocks the
  `Combatant` shape above.
- Whether a platoon occupies one battle-grid hex (entries fight as a
  merged stat block) or its entries spread across multiple hexes
  (entries fight as separate combatants that happen to share a platoon).
- Exact damage formula and the unit-type counter chart (neither the
  existing `unit_types` table nor Kingdom Rule's GDD has this yet — GDD
  §13 lists it as an explicit open item).
- Whether counters are symmetric or one-way.
- Battle grid size/shape and obstacle seeding.
- Initiative order (fixed by unit type, stat-based, or alternating turns).
- Whether `docs/army.md`'s existing "±20% random swing, instant outcome"
  auto-resolve plan is dropped entirely in favor of the tactical grid, or
  kept as a fallback/preview before the full battle screen exists.

## Suggested file layout

- New shared combat module (client+server) for the resolver + types —
  first real use of a `shared/`-style boundary in this repo.
- `server/migrations/003_unit_counters.sql` (or extend `002`) for the
  counter-type columns.
- `server/routes.ts` — replace the `resolve-battle` handler's body with a
  call into the resolver.
- `src/state/units.ts` — replace `UnitStack` with the `Platoon`/
  `PlatoonEntry` shape (up to 3 entries per slot).
- Battle-screen UI stays deferred to #7 (Client/UX Catch-Up); this phase
  can ship with the existing event-log/API response shape.

## Definition of done

- `resolveBattle` handles attacker vs. defender platoon rosters (8 slots,
  ≤3 unit types each) with counters, retreat, and no-retreat paths,
  returning a deterministic-given-seed result and a replayable log.
- `POST /games/:name/resolve-battle` uses the real resolver instead of
  deleting the defender outright.
- `docs/army.md` is updated to reflect that the tactical grid is the v1
  target (not a deferred stretch goal), and its old "±20% swing"
  auto-resolve note is reconciled with the new formula.
- Unit-type counter chart and damage formula are documented and
  implemented, closing the corresponding open item in Kingdom Rule's
  `docs/GDD.md` §13.
