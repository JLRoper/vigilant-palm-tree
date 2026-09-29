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
