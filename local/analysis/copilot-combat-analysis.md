# Combat System Analysis

Scope: everything under `shared/combat/`, `shared/combatConfig.ts`, `src/views/{battleModal,battleResultCard,manualBattleArena,testBattleSetup}.ts`, `src/combat/testArmies.ts`, `server/routes.ts` (`resolve-battle`), `src/state/turnController.ts`, `src/game/turnHooks.ts`, and the two design docs (`feature-plans/CombatResolutionEngine.md`, `docs/CombatResolutionEngine-TechnicalDesign.md`).

## 1. What's actually there

There are **two independent combat implementations** in this codebase, and only one of them is reachable from the real game.

### 1a. The resolver engine (`shared/combat/`) — solid, well-designed, mostly unused

`resolveBattle.ts` is a pure, deterministic auto-resolver: two 8-slot platoon rosters in, a full `BattleResult` + replayable log out. Mechanically it's good work:

- **Damage formula** (`damage.ts`): `atk² / (atk + def)` — a ratio formula (Lanchester-ish), no random swing, so any fight is 100% reproducible given the same rosters. Deliberate design choice, documented, tested (`resolveBattle.test.ts` asserts `r1 deepEqual r2`).
- **Type triangle**: infantry → cavalry → ranged → infantry, ±30%, plus a one-way "monster" tag that's always advantaged and never disadvantaged. All numbers live in one file (`combatConfig.ts`) per an explicit "tunability" requirement in the feature plan — genuinely easy to rebalance.
- **Counterattacks**: a real resolved mechanic, not a fixed depth-2 special case — a `for(;;)` ping-pong loop that self-terminates once both platoons' single charge-per-own-turn is spent. Modeled cleanly as data (`hasCounterCharge: boolean`) rather than baked into control flow.
- **Retreat model**: platoon self-retreat (15% loss) vs. full hero retreat (50% Renown/morale hit, emitted as a delta for a reputation system that doesn't exist yet) vs. no-retreat wipeout — three meaningfully different outcomes instead of HoMM3's single "flee the whole battle" button.
- **Platoons-as-mixed-stacks**: each of the 8 army slots can hold up to 3 unit types acting as one combatant (one HP pool, one attack roll, one hex). This is a genuine design improvement over "8 single-type stacks" — it lets a slot represent e.g. "10 swordsmen + 8 archers" without needing 16 slots, at the cost of some abstraction (damage absorption is applied entry-by-entry in list order, not proportionally — a documented simplification).

But per the tech-design doc's own "known gaps" section, **the grid is currently cosmetic in this engine**: `Combatant.position` and obstacles exist and get returned in the result, but `resolveBattle()`'s `pickTarget()` picks the lowest-HP living enemy irrespective of position — no adjacency, movement, or line-of-sight is read at all. It's an auto-resolver wearing hex-grid clothing; the "battle" is really just an alternating-turn stat fight with a decorative grid attached to the result payload.

### 1b. The manual arena (`shared/combat/manualBattle.ts` + `src/views/manualBattleArena.ts`) — the actual tactical game, but dev-only

This is where the interesting design lives: movement budgets, BFS pathing with obstacle/occupancy blocking, melee adjacency vs. ranged range+LOS, an AI heuristic (`runAiTurn`), per-platoon specialty icons that reveal only after "contact" (`scoutedBy`), a day/night flavor clock (`timeOfDayForRound`, currently cosmetic), and a properly thought-through Surrender flow (gold cost → "Leave Behind" unit-sacrifice picker if the hero can't afford it). The code is well-commented about *why* (e.g. the movement-budget-carries-across-multiple-calls-per-turn behavior, the specialty-reveal-on-contact rule, the "why 2× row spacing" note in `grid.ts`).

The catch, stated plainly in the file's own header comment: **"Currently only reachable from the Test Battle sandbox... see that file's header for the scope boundary against the real game's battle flow."** It's a fully-built tactical battle screen that a normal playthrough will never see.

### 1c. The real game's battle flow — the actual current-state problem

`GameActions.startBattleFlow()` → `showBattleModal()` (`src/views/battleModal.ts`) → `tc.resolveCurrentBattle()` → server's `resolveBattle()` engine → `turnHooks.ts` `onBattleResolved`.

Two concrete issues here:

1. **`battleModal.ts`'s copy is stale and describes behavior that no longer exists.** It reads: *"Resolve to award +50 gold to the attacker and remove the defender."* That was true when combat was "delete the defender outright" (the pre-engine behavior the feature plan explicitly replaced). The actual server route now runs the full stat/type-advantage/counterattack resolver and only transfers gold if the defender is fully wiped — the modal's text is simply wrong for what currently happens.
2. **The result is never shown to the player.** `onBattleResolved` in `turnHooks.ts` does `console.log(`[combat] battle resolved: winner=...`)` and returns updated state — that's it. `battleResultCard.ts` (the "winner banner + per-platoon casualties" component) exists and is fully built, but it's wired only into the manual-arena sandbox flow, never into `startBattleFlow`. A real player clicks "Resolve" on a modal with wrong text, and then their hero's army may have taken real casualties (or been wiped) with **zero on-screen feedback** — they'd have to open devtools to see what happened.

This is the single highest-value gap: the tactical depth in 1a/1b exists but the production path surfaces neither the numbers nor the outcome.

### Other current-state notes

- **`obstacleSeed` isn't actually reproducible in prod** — `server/routes.ts` seeds it as `(row.id * 2654435761 + Date.now()) >>> 0`, so wall-clock time defeats the "deterministic given seed" property the resolver otherwise guarantees. Combined with the scouting design (an item that "locks" a tile's obstacle layout) never having shipped an item system, the seed/location plumbing described in the feature plan is only half-built.
- **Morale and Fatigue are hard-coded placeholders** in the arena's status tiles (`manualBattleArena.ts`: morale always 100, fatigue always 0) — UI slots exist, no mechanic backs them yet.
- **Turn order is not speed-based** — it strictly alternates attacker/defender by slot index. `UnitType.speed` only governs *movement distance* in the manual arena; it plays no role in *who acts first* in either engine. A player fielding all cavalry gets no initiative advantage over one fielding all peasants.
- **AI is a single greedy heuristic** (`runAiTurn`): target lowest-HP enemy, move one step toward range/adjacency if not already there, attack if possible, otherwise end turn. No focus-fire coordination across the AI's own platoons, no retreat/self-preservation logic, no exploiting the type triangle deliberately (it just happens to benefit from it via the same damage formula the player uses). Reasonable for a test sandbox; would read as flat if it were the shipped opponent AI.
- **Abilities are stat-only by design for v1** — monk's heal, hydra's regrowth, black_dragon's breath are flavor text only, sharing generic attack/defense/health/speed stats with everything else. This is a deliberate, documented scope cut (not a bug), with `resolveAttack()` structured as a single seam so an ability layer can extend `CombatEffect` later without a rewrite.
- **Test coverage is solid on the resolver** (determinism, retreat policies, counterattack chains, type-advantage math) and on the manual engine's movement/LOS/targeting rules, but isn't wired into `npm run test:all` / `smoke.ts` — must be run directly per the tech-design doc's own note.

## 2. How similar games handle these same problems

The three gaps above (no result feedback, no initiative/speed role, flat single-heuristic AI) map onto solved problems in the genre this is explicitly modeled on (HoMM3) and its contemporaries.

**Surfacing outcomes (the actual current bug, #1c above).** HoMM3 never lets an auto-battle vanish silently — even the "quick combat" skip still plays a fast log recap and drops you at a result screen with per-stack losses before returning to the map. The cheapest fix here isn't new design, it's *plumbing*: `battleResultCard.ts` already exists and already does the right thing (winner banner + per-side casualties) — `startBattleFlow` just needs to call it with the server's `BattleResult` instead of only console-logging it, and `battleModal.ts`'s copy needs to describe what the resolver actually does rather than the old delete-and-loot behavior.

**Speed/initiative mattering.** HoMM3's actual combat (not this repo's turn-alternation) sorts the whole round's action queue by unit Speed, and several units get "Fast Retaliation"/double-turn effects at speed thresholds — the type triangle answers *who wins the trade*, but Speed answers *who gets there first and hits first*, which is what makes cavalry (fast + strong) meaningfully different from a slow high-HP wall even before the type-advantage math kicks in. This codebase already stores `UnitType.speed` and uses it for movement distance — a natural extension (if the team wants combat to feel less like a metronome) is sorting each round's turn queue by speed instead of strict alternation, which is a small, contained change since the turn loop already builds an ordered queue (`resolveBattle.ts`'s `turnQueue`).

**AI depth without much extra complexity.** Total War and Age of Wonders-style tactical AIs get a lot of mileage from a short priority list evaluated per unit rather than one flat heuristic: (1) can I kill something this turn? attack the killable target over the merely-weakest one; (2) is my type-triangle matchup favorable against anything in range? prefer that target over raw lowest-HP; (3) am I below some HP threshold and unsupported? retreat/reposition instead of trading. `runAiTurn`'s single-target-by-lowest-HP rule is a fine v0 but doesn't use the type triangle or counterattack-charge state it has access to — e.g. it'll happily walk a ranged platoon into melee counterattack range for a marginal kill instead of preferring a target it's advantaged against.

**Positional/tactical texture.** Games in this space (HoMM3, Fire Emblem, Wesnoth) lean hard on terrain and flanking to make the grid feel like more than a stat-fight backdrop: chokepoints from obstacles, zone-of-control-style "can't just walk past an enemy," and back-row protection for ranged/caster units. `manualBattle.ts` already has the primitives for this (BFS movement, obstacle blocking, adjacency checks) — the missing piece is that `resolveBattle.ts` (the engine that's actually reachable in production) never consults `position` at all, so none of that texture exists in the path players actually experience. If the manual arena is ever promoted from dev-sandbox to real feature, that's the point where its already-built pathing/LOS logic starts paying for itself; until then, it's dead weight relative to what ships.

**Morale/Fatigue as real mechanics, if kept.** The placeholder bars are a fork in the road worth deciding early rather than late: HoMM3's morale (bonus/skipped turn, chance-based) and various tactics-RPGs' fatigue (accumulating action-cost or accuracy penalty) are both cheap to bolt onto an existing turn loop, but the UI already promises them to the player (two labeled bars, always full/empty) with nothing behind it — that's a small trust cost (a bar that never moves reads as "broken," not "not implemented yet") worth resolving by either wiring a minimal version in or pulling the placeholder bars until there's a mechanic to show.

## 3. Bottom line

The hard part — a deterministic, tunable, type-advantage stat engine plus a genuinely capable hex-tactics layer — is already built and unit-tested. The gap is almost entirely in *wiring*, not design: the good engine (1a) isn't positional, the positional engine (1b) isn't reachable by players, and the one path players actually go through (1c) throws away the result instead of showing it. Closing #1c (wire `battleResultCard` into `startBattleFlow`, fix `battleModal`'s copy) is a small, high-leverage fix relative to the effort already sunk into the two engines behind it.
