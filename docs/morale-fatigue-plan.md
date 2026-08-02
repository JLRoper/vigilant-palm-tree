# Morale & fatigue plan: from placeholder bars to real combat stats

## Goal

Give morale and fatigue actual mechanical weight in the manual battle engine
instead of the hard-coded display placeholders that exist today, using the
extension seams the combat engine already exposes so the turn loop doesn't
need restructuring.

## Current fit in the codebase

- [shared/combat/types.ts](../shared/combat/types.ts)'s `Combatant`
  (lines 21-39) has no `morale`/`fatigue` fields — only `side`, `slotIndex`,
  `position`, `entries`, `maxHealth`, `hasCounterCharge`, `retreated`,
  `scoutedBy`.
- [src/views/manualBattleArena.ts:221-227](../src/views/manualBattleArena.ts)
  renders Morale and Fatigue bars via `makeMetricBar()`, but the values are
  hard-coded (`100` and `0`) — "the slot exists in the UI for when the combat
  system gets around to tracking them," per the comment there.
- The engine already has the right seams to hang real mechanics off of
  without a rewrite:
  - `CombatEffect` (`types.ts:51-61`) is explicitly documented as "the seam
    a future ability layer... can extend with new effect kinds without
    restructuring the turn loop."
  - `SideModifiers.damageMultiplier` (`types.ts:119-121`) is already a
    caller-suppliable multiplier hook, built for Day/Night but generic
    enough to reuse.
  - `BattleLogEntry` (`types.ts:63-67`) is a discriminated union — adding a
    new log kind (e.g. `morale_change`) is additive, not a rewrite.
  - All existing tunables (type-advantage multiplier, retreat percentages)
    live in [shared/combatConfig.ts](../shared/combatConfig.ts) as named
    constants — morale/fatigue numbers should follow the same pattern.
- Damage math lives in [shared/combat/damage.ts](../shared/combat/damage.ts)
  (ratio formula `atk² / (atk + def)`, documented in
  [feature-plans/CombatResolutionEngine.md](../feature-plans/CombatResolutionEngine.md));
  fatigue/morale should feed in as multipliers on `effAttack`/`effDefense`
  rather than a separate formula.

## Proposed model (v1, deliberately simple)

- **Fatigue** (0-100, starts at 0): increases each time a platoon moves or
  attacks in a round; decays at the start of each of that platoon's own
  turns. High fatigue reduces `effAttack`/`effDefense` via a multiplier —
  mirrors how `typeMultiplier` already scales `rawDamage` in `damage.ts`.
- **Morale** (0-100, starts at 100): drops when the platoon takes
  casualties or when an adjacent/allied platoon is destroyed; rises on a
  kill. Low morale lowers the HP threshold at which `RetreatPolicy`'s
  `auto` kind considers self-retreat (`types.ts:100-103`), and can suppress
  the counterattack charge refill. No "extra turn" or "skip turn" mechanic
  in v1 — keep it a numeric modifier, not a new turn-order rule, so
  `manualBattle.ts`'s alternating-turn loop doesn't change shape.
- Every numeric threshold (fatigue-per-action, fatigue decay rate, morale
  delta per casualty/kill, the multiplier curve applied to attack/defense)
  goes in `combatConfig.ts` as named constants, matching
  `TYPE_ADVANTAGE_MULTIPLIER` / `PLATOON_RETREAT_LOSS` today.

## Implementation phases

1. **Data model** — add `morale: number` and `fatigue: number` to
   `Combatant` in `types.ts`; initialize in `buildCombatants()`
   (`resolveBattle.ts`) and `cloneCombatant()`/snapshot helpers so they
   survive round transitions the same way `hasCounterCharge` does.
2. **Constants** — add fatigue/morale tunables to `combatConfig.ts`
   (accrual per action, decay per turn, casualty/kill deltas, multiplier
   curve).
3. **Fatigue accrual & decay** — wire into `manualBattle.ts`'s move/attack
   action handlers and the per-platoon turn-start logic (same place
   `hasCounterCharge` resets to `true`).
4. **Morale triggers** — wire into the casualty-application and
   counterattack paths in `damage.ts`/`resolveBattle.ts`'s `resolveAttack()`
   so morale updates happen in the same seam that already produces
   `CombatEffect`.
5. **Feed into damage math** — apply fatigue/morale multipliers to
   `effAttack`/`effDefense` in `damage.ts`, same shape as the existing
   `typeMultiplier` step.
6. **Retreat interaction** — low morale lowers the self-retreat HP
   threshold for `RetreatPolicy`'s `auto` kind (`types.ts:100-103`).
7. **UI wiring** — replace the hard-coded `100`/`0` in
   `manualBattleArena.ts:221-227` with the real `Combatant.morale`/`fatigue`
   values.
8. **Tests** — extend `test/combat/manualBattle.test.ts` and
   `resolveBattle.test.ts` to cover fatigue accrual/decay, morale deltas on
   casualties/kills, and the retreat-threshold interaction.

## Acceptance criteria

- `Combatant` carries live `morale`/`fatigue` values that change round to
  round based on actions taken and damage suffered.
- Fatigue and morale measurably affect damage output and/or retreat
  behavior — not just cosmetic numbers.
- All thresholds/curves are named constants in `combatConfig.ts`, not
  inlined magic numbers.
- `manualBattleArena.ts`'s Morale/Fatigue bars display real per-platoon
  state instead of hard-coded `100`/`0`.
- No changes to the alternating-turn loop's overall shape in
  `manualBattle.ts` — this stays a stat/threshold layer on the existing
  engine, not a new turn-order system.

## Suggested implementation order

1. Data model + constants (steps 1-2) — no behavior change yet, just the
   fields existing and initialized.
2. Fatigue accrual/decay + damage-math hookup (steps 3, 5) — smallest
   closed loop, testable in isolation.
3. Morale triggers + retreat interaction (steps 4, 6).
4. UI wiring (step 7) — now has real data to display.
5. Tests throughout, not deferred to the end — each phase above should
   land with its own coverage in the same PR.
