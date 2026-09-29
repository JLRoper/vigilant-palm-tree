# AI enemies — spawn, count option, wander, auto-resolve — 2026-09-29

Status: **Approved** (user asked; scope defaults confirmed by proceeding: separate Enemies selector 0–3, AI wander+fight, redeploy after push). Branch: continues on `playtest-fixes`.

## Why AI don't start with heroes (root cause, verified)

- `makeHeroes` (packages/engine/src/init.ts:187-224) gives **every** seat a hero — AI included ("Warlord", full platoons, 300g). Not the bug.
- `POST /games` (server/routes.ts:379-388) sets `playerCount = humanSlots`, so `makePlayers` produces all-human seats and there is no AI to spawn for. The home chips pick humans only.
- Even with AI seats, the actor is dead code: the client tick (`src/state/turnController.ts:927-963` + `src/ai/aiBrain.ts`) only acts during `AI_TURN`, but engine `startMove` (packages/engine/src/hero/move.ts:16-17) rejects any move when `phase.kind !== "PLAYER_TURN"` → `not_player_turn`; `AI_TURN` is unreachable in live play and degenerates to instant auto-end-turn. Pins: test/state/gameState.test.ts:226-234.
- Also: `src/systems/enemyWander.ts` is unwired dead code (zero imports); `docs/multiplayer.md:74-78` records the old "no AI seats in v1" decision this work supersedes.

## Design decisions

- **D1 enemyCount option end-to-end.** New `enemyCount` (0–3, default 0) on BOTH new-game UIs. `playerCount = humanSeatCount + enemyCount` (≤ MAX_PLAYERS 10). Lobby `seats` stays = humanSlots (AI seats are not claimable lobby seats). LAN lobby path unchanged (sends no enemyCount → 0) in v1; fix its stale "humans + AIs" label (multiplayerLobby.ts:148).
- **D2 unblock AI movement.** `startMove` admits `AI_TURN` when the mover is the active (AI) seat: replace the phase gate with "phase PLAYER_TURN, or phase AI_TURN and hero.ownerId === activePlayerId". Ownership (:24-26) and selection (:27-29) checks stay; the AI tick satisfies selection locally by passing `{ ...state, selectedHeroId: heroId }` (same trick the server uses, commandHandler.ts:455). Update the pinning tests to the new rule.
- **D3 single actor.** The AI tick runs in every browser today. Gate it to the primary client only (local seat === 0 via `getInMemoryLocalPlayerId(gameName) ?? 0`): in solo play that's you; in LAN games seat 0's client drives AI. Non-primary clients just watch state sync. Known v1 limitation: if seat 0 is absent, AI turns stall (documented).
- **D4 AI battles auto-resolve.** In the tick: after a successful AI move (and before wander), if `detectAdjacentEnemyFn(state, heroId)` → `enterBattle`. Resolution rides the existing loop: `GameActions.maybeAutoResolveBattle`'s predicate (GameActions.ts:77-87) already quick-resolves when the local seat isn't the attacker — AI-vs-AI and AI-vs-human-defender both auto-resolve silently (result card still shown); human-attacker-vs-AI keeps the modal. `onBattleResolved` posts `actor = attacker.ownerId` (the AI seat = active player during its turn) and passes all three server guards (commandHandler.ts:405/690/699). `aiBrain` already prioritizes enemy heroes (kind:"enemy", 1000 − dist·10) — it becomes live.
- **D5 capture.** `tryCaptureAt` already fires from the tick — walking onto a settlement flips it (existing rule). No new logic.
- **D6 cleanup.** Delete unwired `src/systems/enemyWander.ts`; docs pass supersedes the "no AI seats" multiplayer decision.

## Work items

| # | Item | Files |
|---|---|---|
| W1a | Engine: `BuildInitialOptions.enemyCount`; derive `playerCount = humanSeatCount + enemyCount` (clamp ≤10) in `buildInitialGameState` + `makeInitialStatePayload` (keep legacy behavior when enemyCount absent); admit `AI_TURN` for the active AI seat in `move.ts` phase gate; update pinning tests | init.ts, hero/move.ts, test/engine/*, test/state/gameState.test.ts |
| W1b | Server + transport: `api.createGame` body + `SessionManager.createGame` + `handleNewGame` accept `enemyCount`; `POST /games` destructure + clamp (int, 0..10−humanSlots), `initOpts { playerCount: humanSlots + enemySlots, humanSeatCount: humanSlots }`, lobby `seats = humanSlots` (AI seats unclaimable — start gate untouched); `generateCastles` preview uses total count | src/io/api.ts, src/managers/SessionManager.ts, src/managers/GameSessionManager.ts, server/routes.ts, test/server/*, test/multiplayer.smoke.ts (lobby shape unchanged) |
| W1c | UI: enemy chips ("Number of AI enemies", 0–3) in home `newGameScreen.ts` (mirror players row; `NewGameFormValues.enemyCount`) + toolbar `newGameModal.ts` (new row; `NewGameHandler.enemyCount`); wire `homeView.ts` payload + `GameEngine.ts` onNew passthrough; multiplayerLobby label fix | those 5 files + any UI tests |
| W2 | Tick: host-only gate (`isPrimaryActor` opt wired from GameEngine), selection override, post-move `detectAdjacentEnemyFn` → `enterBattle` (resolution via existing `maybeAutoResolveBattle` loop path), keep `tryCaptureAt` + `endCurrentTurn`; delete `src/systems/enemyWander.ts`; tests: tick moves AI hero on AI_TURN, battle starts + auto-resolves AI-vs-AI, host-gate blocks non-primary | src/state/turnController.ts, src/managers/GameStateManager.ts, src/managers/GameEngine.ts, src/ai/aiBrain.ts (only if needed), test/state/turnController.test.ts, new test/ai/aiBrain.test.ts |

## Waves

1. W1a ∥ W1b ∥ W1c (disjoint files; param name fixed by this plan: `enemyCount` client-side, `enemySlots` on the wire/server).
2. W2 (needs W1a's gate).
3. Gate (build + test:all), commit + push, redeploy docker, verification tour (create game with 2 enemies → AI heroes visible and wandering after End Turn → force an AI-vs-AI fight → auto-resolve, no modal; human-attacker modal unchanged), docs pass.

## Explicit non-goals (v1)

- LAN lobby enemy seats; server-side AI actor (host-client drives instead); AI chartering; smarter targeting than aiBrain's current weights; defender-side manual battle when an AI attacks you (auto-resolve + result card only).
