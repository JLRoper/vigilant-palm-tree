# Spellcasting plan: from a disabled button to a real hero ability

## Goal

Give the manual battle arena's permanently-disabled "Cast Spell" button a
real mechanic behind it, using the same extension seams the morale/fatigue
plan (`docs/morale-fatigue-plan.md`) proposes to use — `CombatEffect` and
`BattleLogEntry` — so spellcasting drops into the existing turn loop instead
of requiring a rewrite of it.

## Current fit in the codebase

- [src/views/manualBattleArena.ts:979-1025](../src/views/manualBattleArena.ts)'s
  `buildHeroPanel()` builds a `castBtn` for each side's hero portrait, but
  it's a hard stub: `castBtn.disabled = true`, `castBtn.style.opacity =
  "0.4"`, `castBtn.title = "Spellcasting isn't implemented yet"`
  (lines 1015-1022). The comment right above it (lines 976-978) says this
  outright: "Cast Spell is a stub for now: no spell system exists yet, so
  the button just explains that." Both side's cast buttons are built, but
  only the human's (`humanCastBtn`, via `attackerCastBtn`/`defenderCastBtn`
  at lines 1078/1101) is ever wired into the footer layout
  (`humanCastBtn.insertAdjacentElement(...)` at lines 1137-1138, next to
  `retreatBtn`/`surrenderBtn`) — the AI's cast button exists but nothing
  reads it, since the AI turn logic (`runAiTurn` in `manualBattle.ts`) has
  no cast-spell branch.
- There is **no spell data model anywhere** in this repo. Not in
  `shared/combat/`, not in `src/state/`. No spell list, no mana/resource
  pool, no targeting rules, no effect application. This plan is starting
  from zero, unlike morale/fatigue which at least has placeholder UI bars
  wired to hard-coded numbers.
- The engine already has the right seams to hang spell effects off of,
  matching the pattern `docs/morale-fatigue-plan.md` uses for morale/fatigue:
  - `CombatEffect` ([shared/combat/types.ts:51-61](../shared/combat/types.ts))
    is explicitly documented as "the seam a future ability layer... can
    extend with new effect kinds without restructuring the turn loop." Right
    now it has exactly one `kind`: `"damage"`. Spells should add new `kind`
    values here (e.g. `"heal"`, `"buff"`, `"debuff"`) rather than overloading
    `"damage"`.
  - `BattleLogEntry` ([shared/combat/types.ts:63-67](../shared/combat/types.ts))
    is a discriminated union (`damage`/`self_retreat`/`hero_retreat`/
    `stalemate` today) — adding a `spell_cast` variant is additive, the same
    move `docs/morale-fatigue-plan.md` proposes for `morale_change`.
  - `SideModifiers.damageMultiplier`
    ([shared/combat/types.ts:119-121](../shared/combat/types.ts)) is already
    a caller-suppliable multiplier hook (built for Day/Night, reused by the
    morale/fatigue plan) — a damage-spell effect could read/write through
    the same kind of hook rather than inventing a parallel one.
  - Tunables belong in [shared/combatConfig.ts](../shared/combatConfig.ts)
    alongside `TYPE_ADVANTAGE_MULTIPLIER`, `PLATOON_RETREAT_LOSS`, etc. —
    spell costs, cooldowns, and effect magnitudes should follow the same
    named-constant pattern, not get inlined in the resolver.
- Damage math lives in
  [shared/combat/damage.ts](../shared/combat/damage.ts) (`computeDamage()`,
  `applyCasualties()`) — a damage-dealing spell should reuse
  `applyCasualties()` for casualty application rather than reimplementing
  entry-by-entry HP subtraction, but can bypass `computeDamage()`'s
  attack/defense ratio formula and type-multiplier step entirely if a spell
  just deals a flat or scaling amount (see "Open design questions" below).
- The turn loop lives in
  [shared/combat/manualBattle.ts](../shared/combat/manualBattle.ts):
  `attackWithPlatoon()` (lines 377-389) validates a target and consumes the
  acting platoon's turn (`unacted.delete(slotIndex)` then
  `checkRoundAdvance()`); `movePlatoon()` (lines 360-372) moves without
  consuming the turn; `endPlatoonTurn()` (lines 458-464) consumes the turn
  without acting. `spyOnPlatoon()` (lines 302-319) is the precedent for "an
  action that does *not* consume the platoon's official turn" — its comment
  says this explicitly (line 300-301: "Deliberately never touches the
  unacted set... that's what keeps Spy from counting as the platoon's
  official action for the turn"). A hero-cast spell is even further removed
  from the per-platoon turn structure than Spy: Spy is still something an
  acting *platoon* does, whereas a spell is cast by the *hero*, who isn't a
  `Combatant` at all in the current model (see below) — so a spell action
  probably shouldn't consume any platoon's `unacted` slot, similar to Spy,
  but the trigger point (the hero panel, not a platoon selection) is new
  territory the turn loop doesn't have precedent for yet.
  `checkRoundAdvance()` (lines 334-352) is the only place round transitions
  happen; a spell system should not need to touch it directly if spellcasting
  stays outside the unacted-set bookkeeping like Spy does.

## The missing piece: there is no hero stat block

This is the load-bearing gap the whole plan hinges on. Searching this
repo for where a hero's `Arcane`/`Intelligence` stats — the fields a spell
system would obviously key off of (mana pool size, spell power, etc.) —
might already exist turns up only a **UI placeholder that has never been
wired to real data**:

- [src/views/heroInfoMenu.ts:269](../src/views/heroInfoMenu.ts) renders a
  stat grid with the labels `["Attack", "Defence", "Arcane",
  "Intelligence"]`, via `makeRow()` (line 31). But `makeRow()` sets
  `value.textContent = "—"` (an em dash) and never gets updated —
  `this.statValues[stat]` (line 272) is assigned the `<span>` element but
  that map is never written to again anywhere else in the file. These four
  stat rows are permanently blank placeholders, exactly like the Morale/
  Fatigue bars `docs/morale-fatigue-plan.md` found hard-coded to `100`/`0`,
  except these don't even have hard-coded numbers — just a dash.
- [src/state/gameState.ts:56-73](../src/state/gameState.ts)'s `HeroState`
  interface has no `attack`, `defence`, `arcane`, `intelligence`, `mana`, or
  any other stat field — only `id`, `name`, `ownerId`, position/movement
  fields, `gold`, `troops`, `stacks: Platoon[]`, charter fields, and
  `horseVariant`.
- [src/state/units.ts](../src/state/units.ts)'s `UnitType`/`Platoon`/
  `PlatoonEntry` shapes (the actual combat data model) have no hero concept
  at all — heroes only enter the manual battle arena as `humanSide`/`aiSide`
  labels (`BattleSide`) plus a gold purse
  (`options.heroGold` in
  [src/views/manualBattleArena.ts:608](../src/views/manualBattleArena.ts),
  defaulting to 300). There is no `Combatant.hero` field, no hero HP/mana,
  nothing.
- `shared/combat/types.ts`'s `Combatant` (lines 21-39) — the thing that
  actually fights — is a **platoon**, not a hero: `side`, `slotIndex`,
  `position`, `entries`, `maxHealth`, `hasCounterCharge`, `retreated`,
  `scoutedBy`. Same conclusion `docs/morale-fatigue-plan.md` reached for
  morale/fatigue fields: nothing hero-shaped exists to extend.

**Conclusion:** before any spell can be cast, something has to decide
where a hero's mana pool and known-spells list live. That decision has no
existing code to anchor it to — seemingly the `Arcane`/`Intelligence`
labels were added to `heroInfoMenu.ts` anticipating this, but never
followed through with a data model. See "Open design questions" below;
this plan proposes an answer but flags it explicitly as a new decision,
not something read off existing code.

## Proposed model (v1, deliberately simple)

Keep this bounded the same way `docs/morale-fatigue-plan.md` keeps
morale/fatigue bounded — no spell schools, no talent trees, no per-spell
UI beyond a single button.

- **One spell per hero for v1**, not a spellbook/list. A hero either has a
  spell or doesn't (a `heroSpell?: SpellId` field, see below). This sidesteps
  needing a spell-selection UI inside the already-cramped hero portrait
  panel — `castBtn` just casts *the* spell, the way `spyBtn` just spies (no
  "which spy ability" choice either). A spellbook with multiple spells is an
  explicit v2 extension, not v1 scope.
- **A hero-level mana pool**, not per-platoon: `heroMana: number` /
  `heroMaxMana: number`, mirroring how `heroGold` already exists as a
  hero-level (not platoon-level) resource in
  `manualBattleArena.ts`'s `options.heroGold`. Casting spends mana; mana
  does **not** regenerate mid-battle in v1 (matching how fatigue in the
  morale/fatigue plan decays but morale doesn't reset mid-fight — keep v1's
  moving parts to a minimum). A full mana bar at battle start, spent down
  over the fight, zero regen — simplest possible resource model.
- **Two spell kinds only, both plugging into `CombatEffect`:**
  - A **damage spell** — targets one enemy platoon, deals a flat
    (non-type-multiplied, non-attack/defense-ratio) amount of damage via
    `applyCasualties()` from `damage.ts`. Reuses casualty math, skips
    `computeDamage()`'s formula entirely since a spell isn't a unit-vs-unit
    matchup.
  - A **buff/debuff spell** — targets one friendly or enemy platoon and
    applies a temporary multiplier to `SideModifiers.damageMultiplier`-style
    effective attack/defense for a fixed number of rounds, expiring via the
    same round-counter mechanism `timeOfDayForRound()` already uses
    (`shared/combat/manualBattle.ts:36-38`) to key off `state.round`.
  - Both extend `CombatEffect` with new `kind` values (`"spell_damage"`,
    `"spell_buff"`) rather than overloading `kind: "damage"`, consistent
    with the "extend, don't restructure" comment on `CombatEffect` itself.
  - No AoE, no multi-target, no chained/DoT effects in v1 — one spell, one
    target, one instant resolution.
- **Casting does not consume a platoon's turn.** A spell is cast by the
  hero, not a platoon, so it should follow the `spyOnPlatoon()` precedent
  of never touching `unactedAttacker`/`unactedDefender` — except unlike Spy,
  it isn't gated on a *platoon* being selected at all (see targeting flow
  below). Whether a hero should be limited to one cast per round/battle in
  v1 is an open question (see below) rather than an assumed answer.
- **Every number goes in `combatConfig.ts`** — spell mana cost, damage
  amount, buff/debuff magnitude and duration — as named constants, matching
  `TYPE_ADVANTAGE_MULTIPLIER` / `PLATOON_RETREAT_LOSS` today. No inlined
  magic numbers in the resolver or the arena UI.

### Targeting flow (modeled on Spy)

`spyOnPlatoon`'s UI flow in `manualBattleArena.ts` is the closest existing
precedent for "player clicks a button, then clicks a highlighted target on
the grid," and a cast-spell flow should mirror it structurally:

1. Player clicks `castBtn` (currently disabled/stubbed at
   [manualBattleArena.ts:1015-1022](../src/views/manualBattleArena.ts)).
   Unlike Spy, this doesn't require a platoon to be selected first — it's a
   hero-level action — so the click handler shouldn't gate on
   `selectedSlot`.
2. Enters a `castMode = true` state, parallel to the existing
   `spyMode`/`spyTargets` pair (lines 747-748), with its own
   `castTargets: Combatant[]` computed from a new `getValidSpellTargets()`
   in `manualBattle.ts` — for a damage/debuff spell this is "living enemy
   platoons," for a buff spell it's "living friendly platoons" (needs a
   spell-kind check, unlike Spy's single enemies-only target set).
3. Canvas click handling in `handleClick()`
   ([manualBattleArena.ts:1457](../src/views/manualBattleArena.ts)) needs a
   new intercept branch parallel to the existing `if (spyMode) { ... }`
   block (lines 1467-1494), checked before the normal select/attack/move
   chain, so a cast-armed click can't be misread as a platoon selection or
   attack.
4. On a valid target click, resolve immediately (no confirmation dialog
   needed for v1, unlike Spy's `openSpyCostDialog` — a spell has a fixed
   mana cost with no "which unit pays" choice the way Spy's troop cost has,
   since mana is hero-level not platoon-level) — call a new
   `castSpell(state, side, targetSlotIndex)` in `manualBattle.ts`, append a
   `spell_damage`/`spell_buff` `CombatEffect` to `state.log`, then
   `refresh()`.
5. Rendering: a third distinct highlight ring color/style for `castTargets`
   on the canvas, parallel to the existing red (attack) and gold-dashed
   (spy) rings around
   [manualBattleArena.ts:1251-1271](../src/views/manualBattleArena.ts).
6. `renderFooterActions()`
   ([manualBattleArena.ts:951-974](../src/views/manualBattleArena.ts))
   needs a `castMode` branch in `helpTextEl.textContent`, parallel to the
   existing `spyMode` branch, and `castBtn`'s disabled/enabled state should
   depend on `heroMana >= spellManaCost` rather than the current permanent
   `true`.

## Open design questions

These need a decision before implementation — this plan intentionally does
not invent answers unsupported by existing code:

1. **Where does a hero's mana and spell come from?** No `HeroState` field,
   no `Combatant` field, nothing. This plan proposes hero-level
   `heroMana`/`heroMaxMana`/`heroSpell` fields threaded through
   `openManualBattleArena()`'s `options` the same way `options.heroGold`
   already is (`manualBattleArena.ts:586,608`) — but that's a new decision,
   not something read off existing code. Where the *persistent* version of
   these fields would live outside a single battle (i.e. on `HeroState` in
   `gameState.ts`, for the mana pool to carry over between fights, or
   regenerate on the overworld) is entirely unaddressed by this plan and
   needs a separate decision.
2. **Do the `Arcane`/`Intelligence` stat labels in `heroInfoMenu.ts:269`
   already imply an intended design** (e.g. `Intelligence` sizes the mana
   pool, `Arcane` sizes spell power) that this plan should align with, or
   are they unrelated leftover UI scaffolding? No comment or commit
   message found ties them to a design doc. Worth checking with whoever
   added them before building the mana-pool math around an assumption.
3. **Does the AI ever cast?** `buildHeroPanel()` builds a cast button for
   both sides (`attackerCastBtn`/`defenderCastBtn`), but only the human's
   is wired into the visible footer layout — the AI's exists but is
   unused. `runAiTurn()` in `manualBattle.ts` has no casting branch. Should
   v1 give the AI a simple always-cast-if-affordable heuristic (consistent
   with its existing "attack the weakest enemy" heuristic), or is AI
   casting deferred to a later phase? Leaving the AI cast button
   permanently inert while enabling the human's would be an odd asymmetry
   worth deciding explicitly rather than defaulting into.
4. **Cast frequency limit.** Spy has an implicit limiter (it costs a troop,
   and a platoon only has so many). A hero's spell only costs mana in this
   proposal — is one cast per round enough of a soft limit via mana cost
   sizing, or does v1 need an explicit "once per battle" or "once per
   round" hard cap regardless of mana? This plan defaults to "mana is the
   only limiter" but flags it as a balancing decision, not a locked one.
5. **Buff/debuff expiry bookkeeping.** `SideModifiers.damageMultiplier` is
   currently a single static value per side per battle
   (`ResolveBattleOptions.attackerModifiers`/`defenderModifiers`), not a
   per-platoon, time-limited value. A round-limited debuff on one specific
   enemy platoon doesn't fit that shape as-is — it likely needs a new
   per-`Combatant` field (e.g. `activeEffects: { multiplier: number;
   expiresRound: number }[]`) rather than reusing `SideModifiers` directly.
   This plan flags the mismatch rather than resolving it, since it affects
   the `Combatant` shape morale/fatigue also wants to extend — the two
   plans should coordinate on `Combatant`'s new fields rather than land
   independently.

## Implementation phases

1. **Resolve open question #1** (where hero mana/spell data lives) — this
   blocks everything else; the rest of this phase list assumes a
   `heroMana`/`heroMaxMana`/`heroSpell` shape threaded through
   `ManualBattleOptions`/`openManualBattleArena()`'s `options`, adjustable
   once the decision lands.
2. **Data model** — add the resolved hero-mana fields to
   `ManualBattleState` in `manualBattle.ts` (parallel to how `sidesRetreated`
   or `moveBudgetAttacker` are tracked per-battle-state today), and a
   `SpellId`/`SpellDef` type (kind, mana cost, magnitude, duration) — likely
   in a new `shared/combat/spells.ts` alongside `damage.ts`/`grid.ts`.
3. **Constants** — spell mana costs, damage amounts, buff/debuff magnitude
   and duration added to `combatConfig.ts`.
4. **Effect types** — extend `CombatEffect`'s `kind` union with
   `"spell_damage"`/`"spell_buff"` in `types.ts`, and `BattleLogEntry` with
   a `spell_cast` variant (or reuse the extended `CombatEffect` union the
   way `damage` entries already do — see `BattleLogEntry`'s
   `({ round: number } & CombatEffect)` member).
5. **Resolver logic** — `castSpell(state, side, targetSlotIndex):
   CombatEffect` in `manualBattle.ts`: validates mana, applies the effect
   (damage via `applyCasualties()`, or buff/debuff via a new per-`Combatant`
   `activeEffects` field per open question #5), deducts mana, pushes to
   `state.log`. Deliberately does not touch `unactedAttacker`/
   `unactedDefender`, matching `spyOnPlatoon()`.
6. **Targeting** — `getValidSpellTargets(state, side, spellKind)` in
   `manualBattle.ts`, parallel to `getValidSpyTargets()`.
7. **UI wiring** — `manualBattleArena.ts`: enable `castBtn`, add
   `castMode`/`castTargets` state, the `handleClick()` intercept branch, the
   canvas highlight ring, and the `renderFooterActions()` help text/enabled
   state, all parallel to the existing Spy wiring.
8. **AI decision** (resolves open question #3) — if in scope for v1, a
   simple heuristic branch in `runAiTurn()`.
9. **Tests** — extend `test/combat/manualBattle.test.ts` with mana
   validation, effect application, targeting rules, and turn-loop
   non-interference (casting shouldn't consume `unacted`), matching the
   coverage style already used for `spyOnPlatoon`/`attackWithPlatoon`.

## Acceptance criteria

- A hero can cast their one v1 spell in the manual battle arena, spending
  mana and producing a real `CombatEffect`/log entry — not a stub.
- Casting does not consume the acting platoon's turn or advance the round
  by itself (matches Spy's non-interference with the turn loop).
- All spell numbers (mana cost, damage, buff/debuff magnitude and
  duration) are named constants in `combatConfig.ts`.
- The Cast Spell button's enabled/disabled state reflects real mana
  availability instead of being permanently disabled.
- No changes to the alternating-turn loop's overall shape in
  `manualBattle.ts` — spellcasting is an out-of-band hero action layered on
  top of the existing engine, the same way Spy is.
- Open design questions #1-#5 above have explicit answers on record
  (even "deferred to v2" counts) before implementation starts, rather than
  being decided implicitly by whatever the first PR happens to do.

## Suggested implementation order

1. Resolve open question #1 (hero mana/spell data source) — nothing else
   can start without this.
2. Data model + constants (phases 2-3) — no behavior change yet.
3. Effect types + resolver logic (phases 4-5) — the smallest closed loop,
   testable headless via `test/combat/manualBattle.test.ts` without any UI.
4. Targeting (phase 6), then UI wiring (phase 7) — now there's a working
   engine function to hang the arena's click flow off of.
5. AI decision (phase 8) only after the human-facing flow is solid — an
   AI heuristic casting into an untested effect system would make bugs
   harder to isolate.
6. Tests throughout, not deferred to the end — same principle
   `docs/morale-fatigue-plan.md` calls out for its own phases.
