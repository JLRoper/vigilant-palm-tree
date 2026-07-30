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
- `docs/army.md` (now titled `Army & Tactical Battlefield_fallback` —
  **resolved**) documents its own auto-resolve plan (`attack`/`defense`
  derived from unit types + counts, random ±20% swing, instant outcome, no
  per-unit positioning). `implementation-order.md` makes the hex tactical
  grid the v1 target instead, so `docs/army.md`'s plan is kept as a
  fallback/preview option rather than the primary path — its framing has
  been updated from "deferred" to "fallback" accordingly.
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
  positions, plays out stat-comparison combat with type advantages and
  counterattacks, returns a result (winner, per-unit survived/lost, a
  replayable log).
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

One follow-up this creates, worth resolving early rather than during
implementation:
- `docs/GDD.md` §4 in the Kingdom Rule repo currently says "8 individual
  units... not a squad/stack" — that wording is superseded by the platoon
  model and should be updated to match.

**Resolved: platoons act as a single unit.** A platoon's entries always
act together — they all attack together, all heal together (once healing
exists), and all retreat together. There's no peeling a count off one
entry while the rest of the platoon stays in the fight. This means:
- GDD's "any individual unit can self-retreat at 15% loss" (§9/MANUAL.md)
  now reads as *per platoon*, not per unit-type entry — a full platoon
  self-retreats at a 15% loss (applied across all its entries), distinct
  from a full *hero* retreat (50% Renown/morale, all remaining platoons
  pulled out).
- A platoon occupies exactly **one battle-grid hex** as a merged combatant
  — its ≤3 entries are never split across separate hexes or resolved as
  independent combatants.

## Special abilities: stat-only for v1 (resolved)

Combat stays **plain stat-comparison with unit-type counters** for this
phase — matching GDD §9's locked decision — with no ability system.
`monk`'s heal, `hydra`'s regrowth, and `black_dragon`'s breath attack are
flavor text only for now: those units fight using the same
attack/defense/health/speed/counter-type stats as everything else in
`unit_types`, no special-case behavior. Reasoning: GDD §9 didn't lock in
an ability system, and this is the first no-dependency phase of the
roadmap — better to keep it bounded than to design a general ability
system speculatively.

That said, the resolver's per-attack step should still go through a
single seam — e.g. `resolveAttack(combatant, target): CombatEffect[]`
rather than mutating health inline — so an ability layer (heal/regen/AoE)
can hook in later as new effect types without restructuring the core
turn loop. This is an extension *point*, not an extension *implementation*.

## Counterattacks (resolved)

**Naming note first:** this mechanic and the "unit-type counter chart"
below both use the word "counter" for different things. To avoid
ambiguity for the rest of this doc (and in code/naming during
implementation), use:
- **Type advantage** — a unit type dealing bonus damage against specific
  other types (GDD §9's "unit-type counters"; still an open decision
  below).
- **Counterattack** — the retaliation mechanic resolved here.

**Rule:** when a platoon is hit and survives, it immediately counterattacks
its attacker — but only if it has an available counterattack charge. A
platoon has at most **one** counterattack charge between its own turns:
once spent (by countering a hit), it cannot counter again no matter how
many more times it's hit, until it takes its own turn again, at which
point its counterattack charge refills. Concretely: platoon A is hit by B
→ A counters B (charge spent). A is hit again before its own turn (by B or
anyone else) → no counter. A's turn comes and it attacks B → B counters A
if B has a charge available (independent of A's charge state) — and A's
own charge refills, so the *next* time A is hit (even before A's following
turn) it can counter once more.

This plugs into the alternating-turn resolution loop below: each
platoon's `hasCounterCharge` flag resets to `true` at the start of that
platoon's own action, and flips to `false` the moment it spends a
counterattack.

## Damage formula & type-advantage chart (resolved)

Locked in as the v1 starting point — expected to get rebalanced from
actual playtesting, so every tunable number here must live as a **named
constant in one place**, not inlined in the resolver logic. See
"Tunability" at the end of this section for exactly what that means in
practice.

**Formula (ratio-based, deterministic):** for platoon A attacking platoon
B, sum each side's stats across their (≤3) entries, weighted by count:

```
effAttack(A)  = Σ entry.attack  × entry.count      (over A's entries)
effDefense(B) = Σ entry.defence × entry.count / totalCount(B)   (avg)
rawDamage     = effAttack(A) × effAttack(A) / (effAttack(A) + effDefense(B))
damage        = rawDamage × typeMultiplier(A, B)
```

No random swing (unlike `docs/army.md`'s old ±20%) — deterministic so a
given seed always replays identically, matching the "replayable log"
goal above. `damage` is then subtracted from B's remaining health pool
(`Σ entry.health × entry.count`), applied **entry-by-entry in listed
order** (first entry absorbs damage until its pool is exhausted, then the
next) — `unitsLost = floor(damageApplied / entry.health)` per entry. This
keeps the math simple without needing to split damage proportionally
across mixed compositions.

**Type-advantage tags — proposed mapping of the 12 existing units:**

| Tag | Units |
|---|---|
| Infantry | peasant, swordsman, pikeman, crusader |
| Cavalry | cavalry |
| Ranged | archer, crossbowman, monk |
| Monster | griffin, hydra, wisp, black_dragon |

**Triangle (base tags, symmetric):** infantry beats cavalry, cavalry beats
ranged, ranged beats infantry — each direction a flat **+30%**
`typeMultiplier` (1.3×) for the advantaged attacker, and implicitly a
disadvantage the same amount in reverse (symmetric, one number per
matchup). This lines up with `pikeman`'s existing flavor text ("a wall of
iron against cavalry"), which is already infantry-beats-cavalry — no
flavor-text conflicts to resolve.

**Monster tag — the one-way exception:** monster-tagged units get the
+30% `typeMultiplier` attacking *any* base tag (infantry/cavalry/ranged),
but never suffer the reverse penalty — nothing is "strong against" a
monster via the type chart (their weakness, if any, has to come from raw
stats, not a type bonus). This directly answers **"symmetric or one-way"**:
the base triangle is symmetric, monster tier is a deliberate one-way
exception layered on top. Monster-vs-monster: no bonus either way (`1.0×`).

**Tunability:** all of the above numbers — the +30%/1.3× advantage
multiplier, the triangle's win/lose pairs, the unit→tag assignments, and
the retreat/counterattack percentages from earlier sections (15% self-
retreat, 50% hero-retreat Renown/morale hit) — belong in a single
constants module (e.g. `shared/combatConfig.ts`), not scattered as magic
numbers through the resolver. Concretely:

```ts
export const TYPE_ADVANTAGE_MULTIPLIER = 1.3;
export const TYPE_TRIANGLE: Record<AdvantageType, AdvantageType | null> = {
  infantry: "cavalry", // infantry beats cavalry
  cavalry: "ranged",   // cavalry beats ranged
  ranged: "infantry",  // ranged beats infantry
  monster: null,       // handled as a one-way exception, not the triangle
};
export const PLATOON_RETREAT_LOSS = 0.15;
export const HERO_RETREAT_PENALTY = 0.5;
```

`resolveAttack()` and `resolveBattle()` read from this module rather than
hardcoding values, so a future balance pass is a one-file edit with no
resolver-logic changes.

## Battle grid: size, obstacles & scouting (resolved)

**Size/shape:** Heroes of Might & Magic III-style — a wide rectangular hex
grid, wider than tall, with the two outer columns reserved as each side's
starting positions (HoMM3's convention comfortably fits 8 platoons per
side in its ~11 rows). Obstacles are scattered through the open middle
columns. Exact column/row counts can be tuned during implementation; the
overall shape/proportions are what's locked here.

**Obstacles — random by default:** each battle procedurally generates its
own obstacle layout, seeded (so a given fight's seed always reproduces the
same layout — consistent with the "deterministic-given-seed" resolver
goal already established for `resolveBattle`).

**Scouting — obstacles become fixed per location:** the game will include
an item that lets a hero scout a specific battle location, tied to the
overworld tile the fight would happen on (`HeroState.q`/`r` — already
tracked per hero in this repo). Using it on a tile generates and **locks**
that tile's obstacle layout from that point on — any later battle fought
on the same tile reuses the stored layout instead of rerolling. Whoever
scouted the tile also gets to **choose which side of the battlefield they
start on** if a fight later happens there.

This creates two dependencies worth flagging now, though neither is
in-scope work for this engine phase:
- **Battles need a location.** `POST /games/:name/resolve-battle` today
  takes no tile — obstacle scouting requires keying off the fight's
  location, which hero `q`/`r` already gives us; the route just needs to
  start passing it through to the resolver.
- **The scouting item itself doesn't exist yet** — no inventory/item
  system exists in this repo or in Kingdom Rule's GDD, so building the
  item is new scope (Hero Action Expansion (#3) or a future Items system,
  not this engine). What *is* in scope here: `resolveBattle`'s options
  accept an optional `fixedObstacles` (from a prior scout) in place of
  generating fresh from a seed, plus an optional `sideChoice` for
  whichever party has scouting rights — the hook exists before the item
  does.

## Data model additions

- `unit_types`: add `advantage_type` (`infantry` / `cavalry` / `ranged` /
  `monster`, per the table above) — this is the schema the proposal
  above is written against.
- New `shared`-style module (this repo has no `shared/` yet — client and
  server currently duplicate types like `UnitType`; worth a shared module
  for combat types specifically) with:
  - `BattleHex` — bounded battle grid, reusing the overworld's axial
    convention, some hexes flagged impassable; generated from either an
    `obstacleSeed` or a `fixedObstacles` layout (see scouting above).
  - `Combatant` — a whole platoon (all ≤3 entries act as one) + side +
    battle-grid position + `hasCounterCharge: boolean`.
  - `CombatEffect` — the output of a single attack (damage dealt, unit
    lost, counterattack triggered, etc.) — the seam abilities will extend
    later.
  - `BattleResult` — outcome, per-combatant survived/lost/retreated, hero
    Renown/morale deltas, a turn-by-turn log the client can replay.

## Resolution flow (proposed)

1. Pure function `resolveBattle(attackerPlatoons, defenderPlatoons, options)`
   — no DB/HTTP concerns, so it's testable standalone and reusable for
   hero-vs-hero fights and any future bandit/neutral-camp equivalent.
   `options` includes `obstacleSeed` (default path) or `fixedObstacles` +
   `sideChoice` (scouted-tile path — see "Battle grid" above).
2. Place both rosters on a bounded HoMM3-style battle grid — one hex per
   platoon, positioned in the two outer columns — with obstacles generated
   from `obstacleSeed`/`fixedObstacles` scattered through the middle.
3. Resolve turns **alternating between sides** (attacker platoon acts,
   then a defender platoon, back and forth) — not speed-stat-based or
   fixed-by-type. Each acting platoon attacks through `resolveAttack()`
   (stat comparison + type-advantage bonus, returning `CombatEffect[]`,
   applied across all of the platoon's entries at once); track
   health/losses per platoon entry (unit type + remaining count) inside
   that combined result. If the target survives and has
   `hasCounterCharge: true`, it immediately counterattacks back and its
   charge flips to `false`; the acting platoon's own charge resets to
   `true` at the start of its turn (see "Counterattacks" above).
4. Expose retreat as a whole-platoon resolution choice (15% loss applied
   across all its entries) rather than only computing a final win/loss —
   the caller decides whether to pull a platoon out mid-battle, distinct
   from a full hero retreat (all remaining platoons, 50% Renown/morale).
5. Return a `BattleResult`; `POST /games/:name/resolve-battle` applies it
   (update `heroes` JSONB with surviving platoons instead of
   `delete heroes[defenderId]`, transfer loot only on an actual win, log a
   richer `combat_resolved` event instead of always `combat_won`).

All open decisions from earlier drafts of this plan are now resolved —
this doc is implementation-ready.

## Suggested file layout

- New shared combat module (client+server) for the resolver + types —
  first real use of a `shared/`-style boundary in this repo.
- `shared/combatConfig.ts` — the tunable-numbers module from "Tunability"
  above (advantage multiplier, triangle, retreat/counterattack percentages).
- `server/migrations/005_unit_counters.sql` for the `advantage_type` column
  (003 and 004 are already taken by `003_resource_tables.sql` and
  `004_game_assets.sql`).
- `server/routes.ts` — replace the `resolve-battle` handler's body with a
  call into the resolver.
- `src/state/units.ts` — replace `UnitStack` with the `Platoon`/
  `PlatoonEntry` shape (up to 3 entries per slot).
- Battle-screen UI stays deferred to #7 (Client/UX Catch-Up); this phase
  can ship with the existing event-log/API response shape.

## Definition of done

- `resolveBattle` handles attacker vs. defender platoon rosters (8 slots,
  ≤3 unit types each) with type advantages, counterattacks, retreat, and
  no-retreat paths, returning a deterministic-given-seed result and a
  replayable log.
- `POST /games/:name/resolve-battle` uses the real resolver instead of
  deleting the defender outright.
- Type-advantage chart and damage formula (numbers locked above, defined
  in `shared/combatConfig.ts` for easy tuning) are implemented, closing
  the corresponding open item in Kingdom Rule's `docs/GDD.md` §13.
