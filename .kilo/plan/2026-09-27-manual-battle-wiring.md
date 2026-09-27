# Manual Battle Wiring — hero collision → tactical arena

**Status:** ✅ Implemented (2026-09-27). All work items landed: the Fight/Quick Resolve/Flee modal, the arena invocation with the phase's real armies, `onComplete` result capture, the `SubmitBattleResult` command (contracts + parseCommand + commandHandler with the shared post-battle helpers factored out of `ResolveBattle`), the `battle_actions` migration/endpoint/client stream, and the docs. Item 5 (#143 double-paint) was verified **already fixed on main** — the arena's draw modes are exclusive, pinned by the `arena.test.ts` unit test and the visual legacy-vs-scenebuilder cross-diff — so no code change was needed there. Implementation deltas beyond the plan text: the command payload gained `rounds`/`obstacleSeed` (the `BattleResolved` event requires both fields on every path, and the determinism requirement wants the arena's real seed, not a zeroed placeholder) and a `"draw"` outcome (the arena's max-rounds stalemate is a real result; folding it into a win would loot on the wrong side). "Server phase is BATTLE for this hero pair" is implemented as adjacency re-derivation via `detectAdjacentEnemy` — the server never persists a BATTLE phase (`hydrateGameState` always derives PLAYER_TURN/AI_TURN), so adjacency + the submitting seat owning one combatant is the honest equivalent. Verified en route: the BATTLE phase's attacker is always the mover, and `createArenaAi`/`planAiTurn`/`pickTarget` use no `Math.random()` — AI actions are re-derivable from the seed row alone.
**Supersedes:** the "wiring the hero-collision trigger into the manual arena UI is in progress" note in README.md; completes `feature-plans/CombatResolutionEngine.md` item "collision → manual arena".

## Decisions locked (2026-09-27)

1. **Trigger:** manual arena is the **default** collision outcome. The pre-battle modal gains a third button **"Quick Resolve"** that runs the existing server auto-resolver. Three paths: Fight (arena) / Quick Resolve / Flee.
2. **PvP:** hero-vs-hero collisions between two human players **stay on the auto-resolver** in v1 (both players get the result card). Only player-vs-wandering-enemy collisions open the arena. Human-vs-human tactical play is deferred.
3. **Retreat/surrender mapping:**
   - Pre-battle **Flee** = attacker cancels the move (unchanged, `tc.cancelMove(attackerId)`).
   - In-arena **Retreat** = withdraw after fighting: survivors keep their armies, attacker's move is cancelled, no loot/capture changes.
   - In-arena **Surrender** = pay the arena's priced surrender gold (already computed from surviving army value), keep army, move cancelled.
4. **Trust model:** v1 **trusts the client's** played-out result via a new command (LAN trust; cheat-able by a modified client — accepted). The async server-side legality-check architecture below is **documented for future implementation**, and v1 deliberately records everything that future needs.

## Current flow (verified)

- Collision → `phase.kind === "BATTLE" { attackerId, defenderId }` (client reducer; server applies the same engine reducer so the phase exists server-side too).
- `GameActions.startBattleFlow()` (`src/managers/GameActions.ts:36-67`): modal (Flee/Resolve) → `tc.resolveCurrentBattle()` posts the `ResolveBattle` command → server runs `@heroes/engine` `resolveBattle` (grid auto-resolver) → outcome applied server-side (capture/loot/hero removal) → `BattleResolved` event → result card.
- Arena: `openManualBattleArena(playerPlatoons, aiPlatoons, unitTypes, humanSide, { heroGold, surrenderCost })` (`src/screens/combat/arena/openManualBattleArena.ts`) — fire-and-forget; internally handles retreat/surrender/leave-behind and ends at `finalizeManualBattle` + `showBattleResultCard`. Real-army inputs exist: `HeroState.stacks: Platoon[]` (`packages/contracts/src/gameState.ts:31`), unit catalog via `loadUnitCatalog()`, hero gold on state.
- Dev Test Battle (`testBattleSetup.ts`) exercises the arena with preset/random armies and **skips** real-game application — the boundary this plan closes.

## Target flow

```
collision → BATTLE phase → startBattleFlow()
  ├─ Flee           → cancelMove(attackerId)                    (unchanged)
  ├─ Quick Resolve  → ResolveBattle command                     (unchanged)
  └─ Fight (default)→ openManualBattleArena(
                        attacker stacks, defender stacks,        ← real armies
                        unitTypes, humanSide by collidee kind,   ← player vs wanderer
                        { heroGold: attacker.gold }
                      )
                      → finalizeManualBattle() → survivors + outcome
                      → SubmitBattleResult command (15th kind)    ← new
                      → server applies outcome (same rules as auto-resolve)
                      → BattleResolved event → result card
```

PvP branch: if `defender` hero's owner is a human seat ≠ local seat → route to Quick Resolve automatically (modal skipped or modal shown with Fight disabled — implementer's call, note in code).

## Work breakdown

1. **Modal** (`src/screens/combat/battleModal.ts`): `BattleModalResult = "fight" | "quickResolve" | "cancel"`; buttons Fight (primary) / Quick Resolve / Flee. Label update: "Resolve" text becomes "Quick Resolve"; new primary "Fight".
2. **Arena invocation** (`GameActions.startBattleFlow`): on `"fight"` — load unit catalog (pattern: `testBattleSetup.buildSetup`), pull both heroes' `stacks`, `heroGold` from attacker state, `humanSide` = "attacker" (player collided into enemy) or "defender" (enemy wandered onto player — verify how collision direction is encoded in phase; if attacker is always the mover, player-as-defender is the enemy-moved-onto-you case). Arena must render **before** the phase resolves and block `battleInFlight` re-entry (existing guard).
3. **Arena result capture** (`arena/state.ts` / where `finalizeManualBattle` is called): return the outcome to the caller instead of fire-and-forget — `{ outcome: "attackerWon" | "defenderWon" | "retreat" | "surrender", attackerSurvivors, defenderSurvivors, surrenderedGold }` with per-platoon survivor entry counts. Add an `onComplete` callback param (Test Battle keeps working by passing none).
4. **New command `SubmitBattleResult`** (15th kind — touch `packages/contracts/src/commands.ts` or wherever command payloads are typed, `server/http/routes/commands.ts` parseCommand, `server/app/commandHandler.ts`):
   - Payload: `{ attackerId, defenderId, outcome, attackerStacks: survivor platoons, defenderStacks: survivor platoons, surrenderedGold? }`. (The action log is NOT in the payload — moves stream to their own table as they happen, item 4b.)
   - Server validation: phase is BATTLE for this hero pair; survivors shape-valid against unit catalog; outcome∈enum; surrenderedGold ≤ hero gold.
   - Outcome application: reuse the auto-resolver's post-battle application (defender death → hero removal + gold capture; attacker win semantics) — factor that shared logic out of the `ResolveBattle` handler so both paths apply identical rules. Retreat/surrender: restore survivors to both stacks, cancel attacker move (server-side equivalent of `cancelMove`), surrender deducts gold.
   - Emit the existing `BattleResolved` engine event on all paths (so `battle:resolved` bus/UI keeps working); retreat/surrender may need `attackerSurvived: true, defenderSurvived: true` semantics in the event payload — check the event shape and extend only if required.

4b. **Live move streaming → custom table (IN v1, per owner 2026-09-27):** the server monitors the BATTLE phase and every arena action is logged to the database as it happens — the legality-check consumer comes later, on top of this table.
   - **Migration:** new `battle_actions` table: `id`, `game_name`, `seat`, `attacker_id`, `defender_id`, `seq` (per-battle action ordinal), `phase` ("start" | "move" | "attack" | "retreat" | "surrender" | "end"), `payload` jsonb (full action + state context: round, time-of-day, acting slot, from/to or attacker/target), `created_at`. Index on `(game_name, attacker_id, defender_id, seq)`.
   - **Endpoint:** fire-and-forget `POST /api/games/:name/battle-actions` (telemetry-style: never blocks or fails the arena; failures logged, not surfaced). Server stamps seat from the session/claim where available.
   - **Arena instrumentation:** each existing action site in `arena/state.ts` (`moveSelectedTo`, `attackFromSelectedHex`, `attackFromTarget`, `retreatAction`, `surrenderAction`) plus battle start (logs the seed: `obstacleSeed`, initial stacks, sides) and battle end posts one row. The seed row is mandatory — it is what makes any future re-simulation possible.
   - **What v1 does NOT do:** no validation of the streamed actions, no consumer, no re-simulation — the table is written and left for the future consumer (below).
5. **#143 double-paint fix** (`src/screens/combat/arena/paint.ts` `drawLegacy`): the `?paint=scenebuilder` path paints legacy + scene — make the modes exclusive; verify with the battle-arena visual baselines (3 arena scenes exist in `test/visual-baselines/`).
6. **Docs**: README status line, `docs/battle-view-architecture.md` (trigger flow), module map battle rows, this file's status → ✅.

## Future work (documented now; streaming IS in v1, the consumer is NOT): async legality checking

The owner's target architecture — refined 2026-09-27:

- **v1 streams every arena action into `battle_actions`** (see 4b) — the monitoring half exists from day one.
- **Later: an event consumer** reads `battle_actions` (poll or LISTEN/NOTIFY) and re-simulates each action against the recorded battle state, checking legality (unit already acted this round, move within `getMovementRange`, attack within range/valid targets, time-of-day progression via `timeOfDayForRound`).
- On the first illegal action the consumer writes a **violation record** (game, seat, battle, seq, reason) to the database. The cheating user is **not interrupted mid-battle** — the next command they send returns the stored violation error. Outcome policy at that point (void result / mark seat) decided then.
- **Determinism requirements (already satisfiable from v1 data):** re-simulation needs the logged seed row (`obstacleSeed` + initial stacks + sides — logged as the battle's `seq 0` row), the deterministic AI (`createArenaAi` — verify `Math.random()` isn't used inside it; if it is, the AI seed must also be logged), and the per-action log rows. The only current non-determinism is `openManualBattleArena`'s `Math.floor(Math.random()*1_000_000)` obstacle seed, which v1 captures in the seed row.

## Validation plan

- New server tests: SubmitBattleResult happy path (win → capture/loot identical to auto-resolver on same armies), malformed survivors rejected, retreat path restores stacks + cancels move, surrender deducts gold, non-BATTLE phase rejected; battle_actions streaming: endpoint inserts rows, seed row carries obstacleSeed + stacks, arena start/move/attack/retreat/surrender each produce a row, endpoint failure never blocks the arena.
- Client: arena smoke via existing suites; multiplayer smoke green (PvP auto-resolve path unchanged); visual baselines 8/8 (+#143 fix must keep the 3 arena scenes matching or get baselines regenerated with justification).
- Full gate before commit.

## Out of scope (v1)

Human-vs-human tactical play; server re-simulation; arena balance changes; leave-behind persistence changes beyond what surrender/retreat already do.
