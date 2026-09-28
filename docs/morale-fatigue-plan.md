# Morale & fatigue plan: from placeholder bars to real combat stats

> **Status (2026-09-27):** ✅ Shipped. Implemented per the 8 phases below on
> top of the manual-battle wiring; paths refreshed to the canonical
> `packages/engine` / `src/screens` locations (the originals predated the
> `shared/` → `packages/engine` and `src/views/` → `src/screens` moves).
> First-pass tunables live in the "Morale & fatigue" block of
> [packages/engine/src/combatConfig.ts](../packages/engine/src/combatConfig.ts)
> and are flagged for an owner tuning pass. Two deliberate v1 calls worth
> knowing: low morale is applied **literally** as written here — it *lowers*
> the `auto` self-retreat HP threshold, so a demoralized platoon is pulled
> off the field *later* (flip `effectiveSelfRetreatHpPct` for the opposite
> reading) — and "suppress the counterattack charge refill" was left out of
> v1 to keep the counter chain untouched.

## Goal

Give morale and fatigue actual mechanical weight in the manual battle engine
instead of the hard-coded display placeholders that existed, using the
extension seams the combat engine already exposes so the turn loop doesn't
need restructuring.

## Current fit in the codebase

- [packages/engine/src/combat/types.ts](../packages/engine/src/combat/types.ts)'s
  `Combatant` had no `morale`/`fatigue` fields — only `side`, `slotIndex`,
  `position`, `entries`, `maxHealth`, `hasCounterCharge`, `retreated`.
- `metricsFor()` in
  [src/screens/combat/arena/openManualBattleArena.ts](../src/screens/combat/arena/openManualBattleArena.ts)
  rendered Morale and Fatigue bars via `makeMetricBar()`, but the values were
  hard-coded (`100` and `0`) — "the slot exists in the UI for when the combat
  system gets around to tracking them," per the comment there.
- The engine already had the right seams to hang real mechanics off of
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
    live in [packages/engine/src/combatConfig.ts](../packages/engine/src/combatConfig.ts)
    as named constants — morale/fatigue numbers should follow the same pattern.
- Damage math lives in
  [packages/engine/src/combat/damage.ts](../packages/engine/src/combat/damage.ts)
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
   `openManualBattleArena.ts`'s `metricsFor()` (was
   `manualBattleArena.ts:221-227` pre-move) with the real
   `Combatant.morale`/`fatigue` values.
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
  state instead of hard-coded `100`/`0`. (Now `metricsFor(c)` in
  `src/screens/combat/arena/openManualBattleArena.ts`.)
- No changes to the alternating-turn loop's overall shape in
  `manualBattle.ts` — this stays a stat/threshold layer on the existing
  engine, not a new turn-order system.
- Every morale/fatigue mutation is mirrored into the log as a `morale_change`
  entry (deltas + resulting values), so both stats stay fully determined by
  the battle log — the legality-check constraint from the battle updates
  roadmap.

## As built (2026-09-27)

Shipped per this plan (8/8 phases). Constants in
`packages/engine/src/combatConfig.ts`, all owner-tunable:

| Constant | Value | Effect |
|---|---|---|
| `FATIGUE_PER_MOVE` / `FATIGUE_PER_ATTACK` / `FATIGUE_DECAY_PER_TURN` | 6 / 15 / 5 | ~+10 net/round for a once-per-round fighter |
| `FATIGUE_MAX_PENALTY` | 0.35 | atk **and** def mult 1 → 0.65 at fatigue 100 |
| `MORALE_LOSS_PER_CASUALTY` / `_ADJACENT_DEATH` / `GAIN_PER_KILL` | 2 / 10 / 10 | ~5 heavy hits break an uneven fight |
| `MORALE_MAX_ATTACK_PENALTY` | 0.3 | attack-only mult 1 → 0.7 at morale 0 |
| `MORALE_LOW_THRESHOLD` / `_RETREAT_THRESHOLD_REDUCTION` | 30 / 0.15 | below 30 morale the auto-retreat HP threshold **rises** 0.15 — demoralized platoons rout EARLIER (owner decision, overriding this doc's literal "lowers the threshold" wording) |

Implementation notes: attack fatigue accrual lives in `resolveAttack`
(the seam shared by both engines, so counterattacks count); every
mutation emits a `morale_change` log entry with deltas + resulting
values (legality-checker constraint); the arena's roster rail, info
popup, and battle scene read the real values. Canonical as-built
narrative: [battle-view-architecture.md](./battle-view-architecture.md)
§"Combat stats & spellcasting".

## Suggested implementation order

1. Data model + constants (steps 1-2) — no behavior change yet, just the
   fields existing and initialized.
2. Fatigue accrual/decay + damage-math hookup (steps 3, 5) — smallest
   closed loop, testable in isolation.
3. Morale triggers + retreat interaction (steps 4, 6).
4. UI wiring (step 7) — now has real data to display.
5. Tests throughout, not deferred to the end — each phase above should
   land with its own coverage in the same PR.
