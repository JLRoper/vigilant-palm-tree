# Faction territory & construction — phased handoff

> **Status (2026-10-23):** 🚧 Draft handoff, not a locked spec. This is the
> design conversation from today's session broken into PR-sized phases so no
> single change touches everything at once. **Every phase has a "Still needs
> fleshing out" list — those are open calls, not settled decisions. Nobody
> should implement a phase straight off this doc without re-checking its own
> callouts first**, including an agent handed this file directly.

## Why this exists

PR #252 gave every faction its own starter troop building and a full
12-unit roster, but left a gap: capturing an enemy settlement hands you
buildings you can never use, because recruiting is gated on *your seat's*
faction, not the building's. A session-long design conversation worked
through the fix and then kept growing scope (demolish, a per-turn
construction cap, scaled occupation morale, a per-faction Construction
Worker unit, transport/escort, road-building). A single side agent was
already dispatched this session to implement that entire cluster as one
draft branch/PR — treat whatever it returns as a **reference
implementation to mine phase-by-phase**, not something to merge whole.
This doc is the breakdown for redoing it (or reviewing its output) in
smaller, independently-reviewable pieces.

## Phase 1 — Recruit-gate fix + the neutral-seat bug

**Status: ✅ landed 2026-10-25.** The seat-faction recruit gate is deleted
and the `"neutral"`-seat validation gap is closed server-side (see
`docs/architecture.md`'s "Recruit-gate removal + the neutral-seat bug fix"
section for the file-by-file breakdown). The engine-side defensive
normalization called out below was **not** done — only the server-side
`routes.ts` validation fix — a deliberate "pick one" per this phase's own
callout, not an oversight.

**Scope:** Delete the seat-faction check from recruiting
(`unitAllowedForSeatFaction`'s use in `eligibleRecruitSources` /
`recruitUnits.ts` / `commandHandler.ts`'s `RecruitUnits` path /
`UIManager.ts`'s build menu / `aiBrain.ts`'s garrison planner). Rely on the
existing invariant that every building's `recruits` list in
`buildingRegistry.ts` is already faction-pure. Separately, fold in the
confirmed bug from the PR #252 code review: a seat assigned
`factionId: "neutral"` via direct API (not the UI picker, which already
excludes it) gets its first free starter-layout commit permanently
rejected as `wrong_faction`, because `starterTroopBuilding("neutral")`
returns `farmhouse` (tagged `human`) but `buildingAllowedForFaction`
compares `"human" !== "neutral"`.

**Why first:** smallest, almost entirely subtractive, unblocks captured
settlements immediately, no new data model.

**Still needs fleshing out:**
- The "every recruit list is faction-pure" invariant is asserted, not
  verified against the live registry — audit all ~20 recruit-bearing
  buildings before deleting the check, don't assume PR #252 held the line
  everywhere.
- Confirm nothing else reads `aiBrain.ts`'s per-settlement `factionId`
  lookup before deleting it (it was flagged separately as a redundant
  linear scan by the code review — fine to fix both at once, but check
  for other callers first).
- Fix the `"neutral"` gap in both places or just one: normalize
  `factionId` to `"human"` defensively inside the engine (matches
  `starterTroopBuilding`'s existing fallback), AND/OR tighten
  `server/routes.ts`'s `seatFactions` validation to reject `"neutral"` as
  an assignable seat value. Doing only the server-side fix leaves the
  engine fragile to the next caller that skips validation; doing only the
  engine-side fix leaves a `"neutral"` seat selectable but silently
  coerced, which may surprise someone debugging later. Pick one or both
  deliberately.
- Don't break `"neutral"`'s *other* legitimate use as the monster/unowned
  tag elsewhere in `FACTION_REGISTRY` — this fix is scoped to seat
  assignment, not the tag itself.

## Phase 2 — Demolish command + a shared per-turn build/demolish cap

**Scope:** New `DemolishBuilding` command (no faction gate — tear down
anything you own). A persisted per-settlement, per-turn flag consumed by
either a `PlaceBuildings` commit or a `DemolishBuilding` commit — whichever
happens first blocks the other until next turn. The free, pre-built
starter layout (`initialLayout: true`) must stay exempt.

**Why this scope, this order:** it's the one piece of the whole cluster
that's a pure win on its own — it also resolves **Option 3** from
`docs/income-rebalancing-plan.md` ("cap concurrent construction per
settlement"), which is currently an open, undecided option in that doc.
Landing this phase should update that doc to say so rather than leaving it
stale.

**Still needs fleshing out:**
- Resource refund on demolish: none, partial, or full? Not decided — "none"
  is the simplest default but may feel punishing enough that nobody ever
  demolishes voluntarily, undercutting its use as an occupation-morale
  cure (see Phase 3).
- Should demolish share the exact same cap as build, or should it be
  cheaper (e.g. free, or half an action) to encourage players to actually
  clean up captured territory instead of just slow-building over it? The
  "shared single pool" design is a starting guess, not a conclusion.
- Per-settlement cap vs. per-player (global) cap — this doc assumes
  per-settlement; confirm that's actually what fixes the "steamroll the
  build queue in one turn" problem the income-rebalancing doc describes,
  rather than just relocating it to "steamroll N settlements in one turn."
- Audit for other "free" building commits that might need the same
  exemption as `initialLayout` (e.g. charter-founded towns, any future
  scripted/event-driven building grant) — don't let the cap silently catch
  something that was never meant to be a player action.

## Phase 3 — Occupation morale penalty, scaled

**Scope:** `settlementFactionTally(settlement)` — derived count of
faction-tagged buildings by faction (untagged buildings never count).
"Foreign-occupied" = owner's own-faction tally doesn't exceed the largest
foreign tally, with ≥1 foreign-tagged building present.
`imbalance = max(0, foreignMax - ownTally)`; penalty = `PER_BUILDING_PENALTY
× imbalance`, capped. Applied as a separate modifier read only at
income-calculation time (`effectiveMorale = clamp(storedMorale -
occupationPenalty, 0, 100)`) — never folded into the stored, decaying
`morale` field, since supply-shortfall morale and occupation morale have
different cures.

**Why after Phase 2:** without demolish, the only cure for a fully
foreign-tagged captured settlement is building more of your own — which
(after Phase 4 lands) requires a Construction Worker you may not have yet.
Landing the morale penalty before there's a usable cure path risks a dead
end that just feels punitive with no available response.

**Still needs fleshing out:**
- `PER_BUILDING_PENALTY` and the cap are both placeholders. This needs an
  actual balance pass, and should probably be sequenced *with* the tax-curve
  question already open in `docs/income-rebalancing-plan.md` rather than
  tuned independently — two unreleased morale/income levers landing
  separately makes each one harder to evaluate in isolation.
- Should unowned/neutral settlements ever accrue this penalty? There's no
  seat faction to compare against for them — presumably exempt, but that
  should be an explicit check, not an accidental side effect of
  `ownerId == null` short-circuiting somewhere.
- Double-check no existing code reads `settlement.morale` assuming it's
  the *only* source of penalty (e.g. UI tooltips, AI decision thresholds)
  before adding a second, separately-computed effective-morale value that
  diverges from the stored field.

## Phase 4 — Construction Worker unit + presence-gated faction building

**Scope:** One new non-combat unit per playable faction, priced as a real
mid-tier spend, recruited from each faction's `townHall`. New migration
following `033_roster_parity.sql`'s idempotent pattern. Placing a NEW
faction-tagged building now requires at least one Construction Worker of
that same faction currently garrisoned in the settlement — a standing
requirement, not consumed on use. Every settlement's starter layout seeds
one matching worker from turn 1 (otherwise no new game could ever place a
second faction building anywhere).

**Still needs fleshing out (this phase has the most open calls):**
- Pricing is currently just "comparable to a tier 4-5 unit" — needs an
  actual number, ideally derived from the `tools/balance/` scripts PR #252
  already built rather than guessed fresh.
- **Captured-settlement inherited worker:** if a captured settlement's
  previous owner had their own faction's worker garrisoned there and it
  survived the battle, does it do anything for the new owner? Current
  default assumption is "no — it's just an inert foreign garrison unit,
  the new owner still needs their own faction's worker," but that's the
  easy default, not a confirmed design intent. Worth a deliberate yes/no.
- **Retroactive backfill:** does every settlement in a game *already in
  progress* before this ships get a free worker (a migration/backfill), or
  only brand-new games? Shipping this without a backfill decision means
  every existing save's settlements are permanently locked out of placing
  any new faction building the instant this lands.
- The `wrong_faction` rejection reason may need to change (something like
  `missing_construction_worker` for the new failure mode, keeping
  `wrong_faction` for an actually-wrong faction tag if that path still
  exists in some form). Check whether any client code or test currently
  keys on the exact string `"wrong_faction"` before renaming anything.

## Phase 5 — Transport: walk alone, or escorted by a hero

**Scope:** A Construction Worker can either merge into a hero's platoon
and travel as part of that hero's normal movement, or move alone across
the map as its own path-walking entity (reusing the existing
`CaravanState`-style plumbing rather than inventing new movement). A lone
worker is a valid target for the same ambush/encounter mechanism that
already applies to other map-present units.

**Still needs fleshing out — the single biggest scope-reduction lever in
the whole list:**
- Is solo movement (and therefore ambush risk) actually needed for a v1,
  or should Phase 5 ship as **escort-only** (merge into a hero's stack,
  full stop) and defer standalone movement to a later phase? Escort-only
  is a much smaller change (reuses existing hero-movement and
  unit-transfer code wholesale) and already satisfies "transport them to
  the new territory" — solo movement only adds the "walk alone, at risk"
  texture on top. Worth a explicit go/no-go before starting, not an
  assumed yes.
- If solo movement ships: what specifically triggers an ambush against a
  lone worker — the unmodified existing wandering-monster/encounter rate,
  or does it need its own tuning? A worker is high-value and has near-zero
  combat ability, so reusing an unmodified encounter rate might make solo
  transport something nobody ever risks in practice, quietly making the
  whole mechanic decorative.

## Phase 6 — Road-building during transport

**Scope:** While a worker travels solo, the player can toggle "build
roads," costing money and halving movement speed while active; paved
tiles reduce movement cost for later crossings by any unit.

**Still needs fleshing out — flagged as the most speculative part of the
whole cluster, recommend confirming it's wanted at all before scheduling:**
- There is currently **no terrain/road movement-cost concept anywhere in
  `packages/engine/src/map/pathfinding.ts`** — this phase isn't extending
  an existing system, it's building one from nothing. Worth weighing
  against how much the game actually needs it right now versus Phases 1-5
  landing and bedding in first.
- Gold cost per tile (or per trip) is an unset placeholder.
- Does a paved tile benefit every player/faction that crosses it, or only
  the one who built it? Either answer has real balance and multiplayer
  implications and isn't decided.
- Where roads persist (map state vs. game state) isn't decided, and
  affects save-file shape/size.

## Suggested order

Phases 1 → 2 → 3 → 4 → 5 → 6, each its own PR, each re-litigating its own
"still needs fleshing out" list before work starts rather than carrying
forward whatever the single combined draft agent assumed. Phase 1 and
Phase 2 are the only two that stand on their own with no dependency on
anything below them — either could land independently even if the rest of
this doc changes shape.

[← Back to index](./README.md)
