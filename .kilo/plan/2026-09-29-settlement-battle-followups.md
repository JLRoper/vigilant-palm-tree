# Settlement battle follow-ups — improvement backlog

**Status:** Proposed, not started. Backlog compiled 2026-09-29 from the research, live Playwright probes, and implementation waves behind the settlement capture & garrison battle correctness work (`ec13268` + `d6b638a` on `playtest-fixes`). Live-probe evidence from that effort lives in `local/probe/out/` (gitignored) and its harness in `local/probe/runProbes.mjs` — reusable for any item below.

## Context

The landed wave made settlement capture reliable (serialized behind the move persist + rollback), made neutral garrisons fight, aligned settlement-battle loser outcomes with hero-battle rules, propagated garrison events to remote clients, and gave the AI strength-gated garrison attacks (`GARRISON_ATTACK_RATIO = 1.5` in `src/ai/aiBrain.ts`) with auto-resolved settlement battles. Working through that surfaced the gaps below.

## Build upon (new capability)

### B1. AI garrison defense (highest player-visible payoff)
AI seats never recruit garrison troops into their own settlements, so every AI town falls to a walk-in unless an AI hero happens to be standing on it — the attack capability added in the wave has no counterpart. Let the AI spend its treasury through the existing `RecruitUnits` command path (building-gated, `garrison_full` cap) to garrison its settlements, sized against nearby enemy strength. Touch points: `src/ai/aiBrain.ts` (a garrisoning decision alongside `pickAiMove` or a settlement-turn action), `src/state/turnController.ts` AI tick (submit `RecruitUnits` with the AI seat as actor — the server case already accepts AI actors), server `SubmitSettlementBattleResult`-style command plumbing already exists for AI actors. Acceptance: an AI-owned settlement left alone for N turns holds a garrison; a player walk-in triggers a settlement battle; `test/ai/` + `test/state/turnController.test.ts` coverage; probe scenario "AI garrisons its castle".

### B2. Server-side AI actor (highest robustness payoff)
The entire AI turn runs in seat 0's browser (`TurnControllerOptions.isPrimaryActor`); if that seat is absent in a LAN game, AI turns stall until it returns (documented v1 limitation, inherited by everything in the wave). Move the AI tick server-side (or elect a server driver): the server already validates every AI command (`MoveHero`, `RecruitUnits`, `SubmitSettlementBattleResult` all accept the AI seat as actor). This is an architectural change — plan it separately, keep the client `aiBrain` as the strategy module the server invokes (it is engine-importable pure logic already: `pickAiMove(state, heroId, map, rng)`).

### B3. AI chartering
Still explicitly unimplemented ("No AI chartering" from the AI-enemies milestone). Now that AI takes and holds settlements, chartering new ones when the purse allows is the natural next capability. Reuses `evaluateCharterRequirements` (`src/screens/adventure/charterRequirements.ts` — needs an AI-usable pure form) + `startCharter`.

### B4. Unit-quality strength model
Both the AI's attack gating and outcome expectations use `platoonTroopTotal` — a militia weighs the same as a griffin. Add a per-unit power weight from the unit catalog (packages/contracts unit stats) and use it in `aiBrain`'s `GARRISON_ATTACK_RATIO` comparison and any future odds display. Cheap, contained, immediate behavior improvement.

### B5. Assault confirmation modal with odds
Settlement battles open the arena directly (kept per spec decision during the wave). A lightweight confirm — "Your army vs the garrison of \<name\>: Assault / Cancel" plus a power-readout — prevents accidental arena entries and doubles as the odds preview. Touch points: `src/managers/GameActions.ts` `startSettlementBattleFlow`, modal pattern from `openCenteredModal` (`src/screens/shared/menu.ts`).

### B6. Verdict on the wire for settlement battles
`SettlementBattleResolved` carries only winner/captured; remote clients learn outcomes via full-refetch resync and get no "slain / retreated to \<name\>" wording. Extend the event payload with `attackerVerdict` (+ optional hero ids) so remote seats render the same result-card/toast text the primary client does (`battleVerdict*` helpers in `src/screens/combat/battleResultText.ts` are ready to consume it).

## Improve (hardening / polish)

### I1. AI re-attack backoff
After losing or drawing a garrison assault the AI re-attacks next turn — the strength gate has no memory of the failure and will suicide-loop into a superior garrison whose garrison grew. Track per-hero recent failed assaults (state field or in-memory on the primary client) and suppress that target for N turns.

### I2. Path-based AI reach
AI target reach is straight-line `hexDistance ≤ REACH`; a target 9 tiles away by distance but trivially walkable is invisible. Switch reach checks to path cost (or distance-with-terrain-cost) in `aiBrain`.

### I3. Wire EntityMirror
`src/render/scene/entityMirror.ts` exists to replace the wholesale rebuild-on-`state:committed` pattern with tweened remote movement (`bootstrap`/`applyEvent` are implemented; `HeroMoved`/`SettlementCaptured` are handled) but is not wired into `GameEngine`/`GameStateManager`. The wave's `garrisonEventBridge` established the safe-merge plumbing pattern this needs. Removes the visible "snap" on remote moves.

### I4. Drop the redundant `already_owned` round-trip
When a hero battle's server persist already captured the settlement inline, the client's post-battle re-check still POSTs `CaptureSettlement` and relies on the `already_owned` benign no-op (pinned by tests). Carrying the inline capture in the battle response would remove the extra round-trip; deferred during the wave as "smallest change". Touch points: `ResolveBattle`/`SubmitBattleResult` results + `src/game/turnHooks.ts`.

### I5. Garrison dismiss button
Garrisons can be recruited and transferred but never manually disbanded — upkeep starvation is the only release valve. Add a dismiss action to the settlement panel's garrison accordion (`src/screens/settlements/settlementInfoMenu.ts`) backed by a small command (or reuse `TransferUnits` semantics with a discard direction — new engine command preferred).

### I6. Starter-game fetch retry
Every fresh page load races the booting API for the auto-"starter" game, logging one benign "Failed to fetch". Add a short retry/backoff where the starter game is requested on boot for clean first-run logs.

## Suggested priority

1. **B1** AI garrison defense — closes the biggest gameplay asymmetry; everything it needs shipped in the wave.
2. **B5** Assault confirm + odds — small, high player-visible polish.
3. **B4** Power-weighted strength — small; makes B1's decisions smarter too.
4. **B2** Server-side AI actor — largest robustness win, needs its own plan.
5. **I1** AI backoff — pairs with B1/B4 tuning.
6. Remaining items as capacity allows; B3 after B1 (chartering presupposes holding settlements).

## B2 scoping addendum (2026-09-29 scoping study)

Material correction to B2 as written: `src/ai/aiBrain.ts` is NOT yet engine-importable — it imports `../core/hex`, `../map/pathfinding`, `../map/gameMap`, `../map/terrain`, which are 1–3-line re-export shims over `@heroes/engine`. The move is nearly mechanical but real.

**Recommended architecture:**
- **Phase 0 (no behavior change):** move `src/ai/aiBrain.ts` → `packages/engine/src/ai/aiBrain.ts` (swap the four shim imports for engine-internal modules; `Axial` type from `@heroes/contracts`); leave `src/ai/aiBrain.ts` as a re-export shim (precedent: `src/map/pathfinding.ts`). 3 files + `lint:deps`; `test/ai/aiBrain.test.ts` passes unchanged.
- **Phase 1 (smallest useful milestone):** new `server/app/aiDriver.ts` following the drop-policy scanner pattern (per-process unref'd `setInterval`, started once after `initSchema` in `server/index.ts`): hydrate → for the active AI seat, `pickAiMove` → dispatch `Command` objects (actor = AI seat) through `handleCommandTransactional` sequentially (in-process calls, NOT HTTP-to-self, NOT direct reducers — precedent `runServerEndTurnForSeat`, and direct reducers would bypass persistence/event fan-out). Moves + walk-in `CaptureSettlement` + adjacency `ResolveBattle` + beatable-garrison `SubmitSettlementBattleResult` (engine `resolveBattle` for survivor stacks) + `EndTurn` when nothing can move. Server must never CREATE a phase — client-local BATTLE/SETTLEMENT_BATTLE phases are re-derived server-side from position/ownership gates. Double-drive protection: persist `lobby.aiDriver = "server"` in the existing `lobby` jsonb at game creation (`POST /games`, no schema migration); server scanner only drives flagged games; client flips BOTH `isPrimaryActor` sources (`GameEngine.ts` tick source AND the separate garrison-bridge lambda) to `false` for flagged games, with a settings escape hatch. Unflagged/old games keep browser driving.
- **Phase 2 (client parity):** result cards/toasts derived from `BattleResolved`/`SettlementBattleResolved` events (pairs with B6 verdict-on-the-wire); optional `EntityMirror` wiring (I3) or bridge extension so remote AI moves tween live; garrison-bridge gate cleanup.
- **Phase 3 (hardening):** AI-turn watchdog (no timeout exists today even client-side); driver audit event (reuse `turn_skipped` convention); B1 recruitment + B3 chartering become server-driven (`advanceAutoTravel` for AI charterers needs driver treatment too).

**Key facts:** server→`packages/engine` imports are legal (`no-server-from-src` only forbids `src/`); engine hydrate already yields `AI_TURN` for AI seats; deterministic map reconstruction `new GameMap(row.seed, row.map_size)` is pinned byte-identical by `test/server/gameMapReconstruction.test.ts`; RNG via `mulberry32` (optional per-turn reseed `seed ^ round ^ day ^ seat`); cost is tens of short `FOR UPDATE` transactions per AI turn — fine at this scale.

**Open questions to answer before starting B2:** (1) rollout scope — new games only (persisted flag) vs adopting in-flight AI games; (2) solo/starter games — keep host-browser driving or one server path; (3) AI pacing — resolve as fast as possible vs pace actions ~250–500 ms so humans can follow; (4) determinism — replayable per-turn RNG or process-lifetime rng; (5) human-defender experience — keep silent auto-resolve + card, or server-held wait state for arena input (large scope); (6) sequence B6 (verdict on the wire) before Phase 2; (7) lobby AI slots vs home-screen "AI enemies" path first.

**B1/I1 note (landed 2026-09-29):** `pickGarrisonRecruitment` was written engine-importable-pure (recruit eligibility shared with the command via `eligibleRecruitSources` in `packages/engine/src/settlement/recruitUnits.ts`), so the server driver can adopt it unchanged in Phase 3; the backoff map is client-in-memory and would move server-side with B2.
