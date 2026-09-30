# Server-side AI actor (B2)

**Status:** Planning complete — verified twice (HEAD `55cba84`, then HEAD `deac28bd` **including the in-flight event-sync refactor** in the working tree), all decisions user-confirmed 2026-09-30. **No code started.** This document supersedes the B2 sections of [`.kilo/plan/2026-09-29-settlement-battle-followups.md`](./2026-09-29-settlement-battle-followups.md). Two independent adversarial reviews (client/transport readiness; server safety) produced the blockers and refinements below — each is traceable to a decision record entry (D8–D15) or a phase bullet.

**Workspace coordination note:** another workstream is actively refactoring event sync in this tree (`ENGINE_EVENT_SYNC_CLASS` registry in `packages/engine/src/events/applyEvent.ts`, derived kinds in `src/io/multiplayerSync.ts`, shared poll/SSE SQL in `server/eventStream.ts`, migration 019 audit-index, deleted `src/core/eventRegistry.ts`). Nothing invalidates this plan's facts, but **Phase 1's multiplayerSync edit must be written against the post-refactor file**, and the plan references the classification registry instead of a hand-listed kind count. That workstream also owns `docs/event-system.md` and several uncommitted docs — leave their files alone.

## Context

Today the entire AI turn runs in seat 0's browser (`TurnController.tick()` gated on `AI_TURN` + `isPrimaryActor()`), submitting commands with `actor = active AI seat`, all of which the server already validates. If seat 0 is absent, AI turns stall — no server-side AI-turn timeout exists **anywhere** (dropPolicy iterates presence only; AI seats report no telemetry). Goal: the server drives AI seats end-to-end for flagged games; browsers become spectators fed by the existing SSE stream / resync.

## Key facts (verified at `deac28bd` + in-flight work)

- **Dependency rules:** server → `packages/engine` / `@heroes/contracts` legal; server → `src/` forbidden for value imports. Phase 0 must ALSO replace `aiBrain`'s `@heroes/engine` self-barrel import with leaf imports (`units`, `settlement/recruitUnits`) or the relocated module imports its own barrel.
- **`aiBrain` relocation is mechanical:** three 2–4-line shim imports (`map/pathfinding`, `map/gameMap`, `map/terrain`) + one full 80-line local implementation (`core/hex`; engine twin `hexDistance` in `packages/engine/src/map/pathfinding.ts`, `Axial` in contracts). `pickAiMove(state, heroId, map, rng, unitTypes = {}, excludedSettlementIds = new Set())` and `pickGarrisonRecruitment(state, seat, unitTypes)` are pure.
- **Route authority is caller-only and leaky:** `actor_mismatch` (403) applies only to authenticated seat-claimers; **anonymous callers fully trust `command.actor`** — so old-browser AI-seat commands are VALID while the AI seat holds the turn (first-writer-wins, not "server wins races"). Fix is D10's route block.
- **Compute-vs-apply:** the `SubmitSettlementBattleResult` handler validates, runs `applySettlementBattleResult` exactly once (survivor stacks, garrison emptying, capture, hero outcomes, charter fold), persists, and appends `SettlementBattleResolved`. The command carries compute INPUTS (outcome, survivor stacks, rounds, `obstacleSeed`). `ResolveBattle`'s handler computes the battle itself from `ctx.rng` — its `obstacleSeed` is NOT a command field; `SubmitSettlementBattleResult`'s seed IS (`parseCommand` enforces non-negative int).
- **No server flee exists:** outcome `"retreat"` zeroes stacks + relocates (far harsher than the client's null-catalog local cancel). The live catalog is a non-null memoized DB record — the realistic failure is a thrown read, not null. Server-side bounce therefore = defer/fail-safe (submit nothing, hero stays, backoff recorded); **never use `"retreat"` as a bounce mechanism.**
- **Garrison upkeep decays towns:** weekly `applyGarrisonUpkeep` trims platoons when town gold can't cover upkeep — the reason B1 recruitment must be Phase 1 (D13), not Phase 3.
- **Turn advancement:** `endTurn` walks `players[currentIdx+1]`; `advanceRound` hard-wraps to seat 0 (safe because seat 0 is always human — D7). `ai_turn_started` audit rows are appended when the next player is an AI seat — the driver's activation marker.
- **Transport:** SSE + `pg_notify` fan-out; clients ingest via `multiplayerSync.applyRows` (kinds now DERIVED from the `ENGINE_EVENT_SYNC_CLASS` registry); `TurnEnded` rows carry `actor_seat = command.actor` and answer "resync". `GAME_COLUMNS` (create/load/GET) all return the `lobby` jsonb — the flag rides every transport for free (D8).
- **Snapshot completeness caveat:** `GET /games/:name` omits trade routes/counters and does not assemble active charters; hydrate defaults them, and the garrison bridge adopts hydrate wholesale. Phase 1 owns a turn-boundary reconciliation + snapshot-completeness contract (see Phase 1).
- **Map reconstruction pinned:** `new GameMap(row.seed, row.map_size)` (`test/server/gameMapReconstruction.test.ts`). Catalog is a DB-loaded non-null memoized record per process.
- **Client tick contract (parity reference):** one hero-step per frame; selection restore; rejected move persist → rollback + cancel the battle it opened; settlement-battle submit awaited with the tick gated; walk-in gate order defending-hero → garrison-battle → capture; B1 recruits once per round+seat; I1 backoff in shared `AiTurnMemory`. Engine-pure pieces the driver reuses: `pickAiMove`, `pickGarrisonRecruitment`, `startMove`, `captureSettlement`, `resolveBattle`, `eligibleRecruitSources`. Client-bound pieces it must NOT replicate: tweens, bus emissions, toasts/cards, selection state.

## Decision record (user-confirmed 2026-09-30)

| # | Decision |
|---|---|
| D1 | **Any game created with `enemySlots > 0` is server-driven** — including 1-human games. `POST /games` persists `lobby.aiDriver: "server"` (existing `lobby` jsonb, no schema migration). In-flight pre-flag AI games keep browser driving. |
| D2 | **Only games created WITHOUT explicit AI enemies stay browser-driven** (starter/legacy home-screen games, LAN lobby games — lobby defaults `enemySlots` 0). Resolves the former D1/D2 contradiction. |
| D3 | **`AI_ACTION_PACING_MS = 250`** between driver actions (`0` disables). Named constant. |
| D4 | **One RNG stream per (game, round, seat)**, created at turn start and **continued across scans/actions**; reset only when round/seat changes. Per-pass reseeding would livelock (a rejected move re-plans into the identical move). `SubmitSettlementBattleResult`'s `obstacleSeed` is drawn as a non-negative int from this stream; `ResolveBattle`'s internal seed is `ctx.rng` (outside D4). "Replayable" is scoped to an uninterrupted in-process turn — a restart mid-turn is NOT a replay (stream position + memory are in-process). |
| D5 | **Defender experience:** unflagged games unchanged. Flagged Phase 1: an AI attacking a human resolves **silently, no card/toast** (the driving client no longer exists to emit it); state corrects via resync. Phase 2 restores parity. |
| D6 | **B6, narrowed:** `BattleResolved` **already carries** `attackerVerdict`/`defenderVerdict` (both server producers populate them). Remaining work: add `attackerVerdict` + an accurate draw representation to `SettlementBattleResolved` (draws currently collapse to defender-won); decide whether event-derived cards need casualty context (`attackerResults`/`defenderResults`, absent from both events) or are derived from verdicts + resynced state; specify one event-ID-deduplicated feedback path across direct response / SSE / poll catch-up (including cursor jumps). Lands **with Phase 2**. |
| D7 | **No lobby AI slots; seat 0 stays human** (protects `advanceRound`'s seat-0 hard-wrap and every client seat-0 assumption). |
| D8 | **Flag transport: every game-bearing response already carries it.** `POST /games` (creation), load, and `GET /games/:name` all return `lobby` via `GAME_COLUMNS`. Client: a shared per-game driver-policy module (single source — see Phase 1) consumes flag metadata from creation/load/resync; server gating NEVER depends on client discovery state. |
| D9 | **Backoff + AI-turn memory live in-memory on the driver**, per game: garrison backoff `{heroId → {settlementId → expiryRound}}` (bounce path records it too), the once-per-round+seat recruit guard, and the D4 stream position. Server restart wipes them (accepted). |
| D10 | **Route-level block (BLOCKER FIX):** client-origin commands with `actor` = an AI seat of a flagged game are rejected **403 `ai_seat_command_forbidden`** — checked after `actor_mismatch`, **before `touchSeat`** (AI seats never enter presence; the old touchSeat/dropPolicy hazard class is closed by construction). Trusted internal dispatch (driver, dropPolicy) bypasses the HTTP route entirely — never a request-body flag. |
| D11 | **Compute-vs-apply discipline (BLOCKER FIX):** the driver calls pure engine functions to COMPUTE (`resolveBattle`), dispatches the command whose handler APPLIES exactly once, then **re-hydrates before its next action**. The driver never calls `applySettlementBattleResult` locally and never pre-computes hero battles (dispatch `ResolveBattle`, read the result). |
| D12 | **Termination is Phase 1, not Phase 3:** per-turn action budget (~64) + per-game pass deadline (15–30 s) → best-effort `EndTurn` + audit row on exhaustion; per-game in-flight guard (`Map<gameName, Promise>` — a game already driving is skipped by later scans); per-game exception isolation inside the scan loop; `game_gone` eviction of all driver memory; rejected-command policy: `forbidden_not_your_turn` → pass over; `hero_not_at_fromTile`/`not_adjacent`/`insufficient_movement`/`occupied` → drop the action, re-hydrate, re-plan on the NEXT scan (progressed RNG, never an immediate same-input retry); battle-submit rejections → bounce + backoff; thrown errors → abort pass. |
| D13 | **B1 recruitment moves into Phase 1** (~15 lines; all engine-pure after Phase 0). Without it, flagged AI towns stop recruiting AND bleed weekly garrison upkeep — a real regression. |
| D14 | **Growth rate: server default (0.1).** The driver's `EndTurn` omits `growthRate` (client default is also 0.1; a customized seat-0 setting is not mirrored — accepted delta). |
| D15 | **Immediate-submit chaining:** after a hero battle ON a garrisoned settlement tile, the driver submits the garrison battle immediately (the submit handler's preconditions are already satisfied) — simpler than the client's defer-and-refire, both legal. |
| — | **Escape hatch REPLACED:** no browser-local settings override (it cannot stop the server driver). Rollback = server-controlled: quiesce driver actions for the game → flip the authoritative `lobby.aiDriver` → clients refetch and resume browser driving. |

## Phase 0 — strategy relocation (no behavior change)

- Move `src/ai/aiBrain.ts` → `packages/engine/src/ai/aiBrain.ts`: swap the three shim imports for engine-internal modules; replace `core/hex` with the engine's `hexDistance` + contracts `Axial`; **replace the `@heroes/engine` self-barrel import with leaf imports** (`units`, `settlement/recruitUnits` — the latter owns deposit/eligibility helpers). Engine purity already holds.
- Export from `packages/engine/src/index.ts`; leave `src/ai/aiBrain.ts` as a re-export shim (precedent: `src/map/pathfinding.ts`). `test/ai/aiBrain.test.ts` and `src/game/turnHooks.ts` unchanged.
- Gate: `npm run lint:deps` + full unit suite unchanged.

## Phase 1 — server driver: moves, captures, battles, recruitment, turn end

- **New `server/app/aiDriver.ts`** (drop-policy scanner shape: per-process unref'd non-overlapping `setInterval`, started after `initSchema`). Scan → candidates (hydrated `AI_TURN` + `lobby.aiDriver === "server"`) → **whole-turn drive per game-pass** (multi-hero loop with D3 pacing between actions), guarded by a per-game in-flight map (D12); per-game exception isolation; candidates re-validated (including the hero list) before EVERY action; stamp activations next to the `ai_turn_started` audit convention.
- **Drive state machine:** hydrate → D13 recruitment (once per round+seat, per-item rejection tolerated) → per hero: `pickAiMove` (engine brain + reconstructed `GameMap` + D4 stream + D9 exclusions) → `MoveHero` → walk-in gates (defending hero → adjacency `ResolveBattle` dispatched, result read; beatable garrison → D11 compute + `SubmitSettlementBattleResult`, **D15 immediate-submit** when chaining; empty → `CaptureSettlement`) → backoff recorded on any non-win assault or deferred/fail-safe bounce (D9; **never outcome `"retreat"`**) → no moves left → `EndTurn` (omits `growthRate`, D14). Re-hydrate before every action (D11).
- **Route block (D10)** in `server/http/routes/commands.ts` + rejection pins. DropPolicy interaction neutralized by construction (AI seats never enter presence); the driver treats `forbidden_not_your_turn` as pass-over.
- **Client flip — THREE gates + one policy:** a shared per-game driver-policy helper (e.g. `isServerDriven(game)` / `shouldDriveAi(game)`) consumed by (1) `GameEngine`'s primary-actor source, (2) the garrison bridge's lambda + localSeat deps, (3) `multiplayerSync.applyRows`' driven-AI-seat skip (computed only when `localSeat === 0 && !serverDriven`) — written against the post-refactor file. Flag metadata via creation + load + resync (D8). **Turn-boundary reconciliation + snapshot-completeness contract** is a Phase 1 work item: `onHumanTurnEnd` restarts sync unseeded and the initial catch-up may already contain the completed AI turn; the bridge drops unsafe snapshots and adopts hydrate wholesale — either extend the snapshot (trade routes/counters, assembled charters) or define the TurnEnded-resync reconciliation explicitly so no stale snapshot replays over optimistic state.
- Tests: `test/server/aiDriver.test.ts` on `configureDropPolicy`-style injectables (+ RNG stream capture): whole-turn drive per pass; re-entrancy (second scan during drive = no-op); budget/deadline force EndTurn + audit; per-reason rejection policies; backoff exclusion/expiry incl. bounce-path recording; recruitment once-per-round; flagged/unflagged route-block 403 pins; restart-resume from the row; `game_gone` eviction; no presence writes internally. Sync side: flagged-game variants of the driven-seat skip pins + boundary reconciliation. e2e: **browser-closed full-turn advance** (headline), replayed/malformed client AI commands, seat-0 spectator sees the AI turn complete.

## Phase 2 — client experience parity

- **B6 (D6, narrowed):** `SettlementBattleResolved` gains `attackerVerdict` + accurate draw representation; design the deduplicated event-ID feedback path across all transports; decide card inputs (verdicts + resynced state vs extending events with casualties); then derive result cards/toasts from events (restores D5 parity for flagged games and gives remote seats real wording everywhere).
- Optional live tweening of remote AI moves (bridge `HeroMoved` extension or `EntityMirror` — backlog I3); `garrisonEventBridge` vestigial-gate cleanup; optional "AI is thinking" indicator.

## Phase 3 — hardening & capability

- Cross-scan watchdog (defense-in-depth on top of D12's budgets — the driver needs its own per-game timer; dropPolicy's presence map can't carry it). Pool hardening (`max`, `connectionTimeoutMillis`, `statement_timeout`). **B3 chartering** (`StartCharter` accepts AI actors; `advanceAutoTravel` needs driver treatment). Revisit D1 in-flight adoption and D7 lobby AI slots only if demanded.

## Risks

| Risk | Mitigation |
|---|---|
| Old-browser AI commands race the driver | D10 route block (403 before touchSeat); internal dispatch route-free; stale-command pins |
| multiplayerSync third gate missed → seat-0 freeze | Explicit third flip + flagged-game sync test variants; shared driver policy module |
| Double-applied battle outcomes | D11 compute-vs-apply discipline; handler is the single applier (verified) |
| Driver livelock on repeated rejection | D4 continued stream + progressed re-plan; D12 budget/deadline + bounce-path backoff |
| Snapshot incompleteness (routes/counters/charters) adopted wholesale | Phase 1 reconciliation contract + snapshot tests |
| Flag discovery late (fresh creation) | D8: flag rides creation/load responses; server never depends on client discovery |
| Driver wedges on locked/slow DB | D12 deadline + Phase 3 pool timeouts + watchdog; per-command atomicity bounds blast radius |
| Event-thin outcomes during Phase 1 | D5 accepted (silent window); D6 sequences the fix |
| Restart wipes driver memory | Accepted (D9); resume-from-row covers turns; budgets bound any repeated work |
| Concurrent event-sync refactor in this tree | Phase 1 sync edit written post-refactor; registry-based kinds; coordinate before touching shared files |

## Out of scope (v1)

Human-defender arena input (no server-held wait state), lobby AI slots / seat-0-AI, simultaneous turns, WebSocket transport, adopting pre-flag in-flight AI games, replay-after-restart guarantees.
