# Server-side AI actor (B2)

**Status:** Proposed — plan only, no code. 2026-09-30. Follow-up of [`.kilo/plan/2026-09-29-settlement-battle-followups.md`](./2026-09-29-settlement-battle-followups.md) item B2 and its scoping addendum. A full read-only scoping study (2026-09-29) produced the architecture below; its file:line evidence is summarized here.

## Context

Today the entire AI turn runs in seat 0's browser: `TurnController.tick()` gates on `AI_TURN` + `opts.isPrimaryActor()` (wired in `src/managers/GameEngine.ts` from "local player id === 0"), picks moves via `src/ai/aiBrain.ts` (`pickAiMove(state, heroId, map, rng, unitTypes, excludedSettlementIds)`), applies them optimistically, and submits commands (`MoveHero`, `CaptureSettlement`, `RecruitUnits`, `SubmitSettlementBattleResult`, `EndTurn`) with `actor = active AI seat` — all of which the server already validates (`forbidden_not_your_turn` passes for the active AI seat). **If seat 0 is absent in a LAN game, AI turns stall until it returns** (documented v1 limitation). There is no server-side timeout for AI seats (`server/app/dropPolicy.ts` only tracks seats that report heartbeats; AI seats never appear in the presence map).

Goal: the **server** drives AI seats end-to-end for flagged games — moves, walk-in captures, hero-battle auto-resolve, settlement battles, turn end — with browsers as pure spectators that learn via the existing SSE event stream / resync.

## Key facts (verified in scoping)

- **Dependency rules allow it:** `dependency-cruiser.cjs` `no-server-from-src` forbids server → `src/` only; server → `packages/engine` / `packages/contracts` is legal and heavily used (`server/app/commandHandler.ts` imports ~40 engine symbols).
- **`aiBrain` is NOT yet engine-importable** (material correction to the original plan text): `src/ai/aiBrain.ts` imports four `src/` shims (`core/hex`, `map/pathfinding`, `map/gameMap`, `map/terrain`) that are 1–3-line re-exports over `@heroes/engine` — the move is mechanical but real.
- **Hydration already yields `AI_TURN` for AI seats** (`packages/engine/src/hydrate.ts`), so engine `startMove`'s phase gate admits server-side AI moves unchanged.
- **Deterministic map reconstruction is an established, pinned pattern:** `new GameMap(row.seed, row.map_size)` (`test/server/gameMapReconstruction.test.ts`).
- **In-process dispatch precedent:** `runServerEndTurnForSeat` (`server/app/commandHandler.ts`) bypasses the HTTP router deliberately (the router's guard authenticates callers; the server acts on a seat's behalf) and builds `Command` objects through `handleCommandTransactional` — per-command `FOR UPDATE` transactions, dual-write, event append. Dispatching reducers directly would bypass persistence/event fan-out (the "two parallel implementations" failure mode this repo has paid for twice).
- **Transport is fully built:** SSE (`server/http/routes/eventStream.ts`) + `pg_notify` fan-out (`server/persistence/eventsNotifier.ts`); clients ingest via `multiplayerSync.applyRows` (17 engine kinds incl. `HeroMoved`, `TurnEnded`, `BattleResolved`, `SettlementBattleResolved`; battle outcomes answer "resync"). Non-seat-0 clients already see AI turns purely via events; the garrison bridge (`src/game/garrisonEventBridge.ts`) merges safe-phase updates.
- **Client-local battle phases:** `BATTLE`/`SETTLEMENT_BATTLE` are never persisted; the server re-derives their preconditions from position/ownership in the `ResolveBattle`/`SubmitBattleResult`/`SubmitSettlementBattleResult` handlers. A server driver must never CREATE a phase — it resolves immediately via those command paths.
- **Cost:** every `handleCommandTransactional` re-hydrates state (2–4 queries); a full AI turn ≈ tens of short transactions — fine at this scale. (Known pool-hardening item below, Phase 3.)

## Decision defaults (baked in — override before Phase 1 if wrong)

| # | Decision | Default |
|---|---|---|
| D1 | Rollout scope | **New games only**: `POST /games` persists `lobby.aiDriver: "server"` (inside the existing `lobby` jsonb — no schema migration) when `enemySlots > 0`. In-flight AI games keep browser driving. |
| D2 | Solo/starter games | Stay **browser-driven** (unflagged). One code path per game kind; no behavior change for single-player. |
| D3 | AI pacing | `AI_ACTION_PACING_MS = 250` between driver actions (spectator legibility; `0` disables). Named constant, knob later. |
| D4 | Determinism | Per-turn reseeded driver RNG: `mulberry32(row.seed ^ round ^ activeSeat)` — replayable AI turns. |
| D5 | Human-defender experience | Unchanged: silent auto-resolve + result card/toast (today's `GameActions` policy). No server-held wait state in v1. |
| D6 | Verdict wording | Land **B6** (`SettlementBattleResolved` verdict fields) before/during Phase 2 so event-derived result cards match the local path's wording. |
| D7 | Lobby AI slots | Out of scope v1 — the server driver covers the home-screen "AI enemies" path first. |

## Phase 0 — strategy relocation (no behavior change)

- Move `src/ai/aiBrain.ts` → `packages/engine/src/ai/aiBrain.ts`: swap the four `src/` shim imports for engine-internal modules (`hexDistance` from `packages/engine/src/map/pathfinding.ts`; `findPath`/`NEIGHBOR_DIRS`, `GameMap`, `TERRAIN_COST` likewise; `Axial` type from `@heroes/contracts`). Engine purity rules apply (no DOM/`Date.now`/`Math.random` — `pickGarrisonRecruitment` already complies).
- `packages/engine/src/index.ts`: export it. `src/ai/aiBrain.ts`: becomes a re-export shim (exact precedent: `src/map/pathfinding.ts`). `test/ai/aiBrain.test.ts` and `src/game/turnHooks.ts` keep working unchanged.
- Gate: `npm run lint:deps` + full unit suite unchanged.

## Phase 1 — server driver: moves, captures, battles, turn end (smallest useful milestone)

- **New `server/app/aiDriver.ts`** following the drop-policy scanner shape (`server/app/dropPolicy.ts`: per-process unref'd `setInterval`, non-overlapping pass, started once after `initSchema` from `server/index.ts`). Candidate games = hydrated rows with phase `AI_TURN` AND `lobby.aiDriver === "server"`; the driver re-validates the row (fresh `SELECT … FOR UPDATE` via the command path) before every action, exactly like `enforceSkipForSeat`.
- **Per-game drive state machine:** hydrate → `pickAiMove` (engine brain + reconstructed `GameMap` + per-turn RNG) → dispatch `MoveHero` (server already re-applies the `selectedHeroId` override per command and rejects stale `fromTile`) → walk-in `CaptureSettlement` when the move lands on an empty settlement → adjacency `ResolveBattle` (server auto-resolver) → walk-in onto a beatable garrison: compute survivor stacks with engine `resolveBattle` and dispatch `SubmitSettlementBattleResult` → no moves left → `EndTurn` (the `runServerEndTurnForSeat` shape). Serialize sequentially (each command settles before the next), pacing D3 between actions.
- **No new events, no payload changes, no UI work.** Non-seat-0 clients behave exactly as today; seat 0's browser degrades to "watch via events" (AI positions land at the `TurnEnded` resync).
- **Client flip:** `GameEngine`'s primary-actor source returns `false` for flagged games — BOTH lambdas (the tick source AND the separate `isPrimaryActor` lambda the garrison bridge uses). Add a `GameSettings` escape hatch (boolean guard, `src/state/settings.ts` pattern) to force browser driving if the driver misbehaves.
- **Double-drive safety:** old browsers in flagged games may still tick; their `MoveHero` storms lose the race and hit `hero_not_at_fromTile`/`forbidden_not_your_turn` rejections (guards exist — pin them with a test). Unflagged games never see the scanner.
- Tests: new `test/server/aiDriver.test.ts` on the `dropPolicy.test.ts` injectable-seam pattern (`scanNow`/`driveOnce`/`runCommand` injected): one move per pass with actor = AI seat; EndTurn when `pickAiMove` is null; capture chained after the move persist; settlement-battle resolution parity vs the human path; flagged-vs-unflagged gating; stale-client command rejection pins. Sync side: `test/io/multiplayerSync.test.ts` "AI moves arrive with no local tick". e2e: extend the create-game fixtures (`test/server/createGameRoute.test.ts`) with an API-only tour — create AI game, drive turns via API, observe advance + events with no browser.

## Phase 2 — client experience parity

- Result cards/toasts derived from received `BattleResolved`/`SettlementBattleResolved` events instead of direct command responses (requires **B6**: add `attackerVerdict`/`defenderVerdict` to the events so wording matches `battleVerdict*` helpers).
- Optional live tweening of remote AI moves (extend the garrison bridge to carry `HeroMoved` deltas into the controller during `AI_TURN`, or wire `EntityMirror` — backlog I3).
- `garrisonEventBridge` vestigial-gate cleanup; "AI is thinking" indicator off `mp:turnStarted` if wanted.

## Phase 3 — hardening & capability

- **AI-turn watchdog:** driver-side per-game timeout (e.g. 30 s → force `runServerEndTurnForSeat` + audit event reusing the `turn_skipped` convention) — today nothing anywhere bounds an AI turn.
- **Pool hardening** (from the 2026-09-29 stall investigation): explicit `max` + `connectionTimeoutMillis`/`statement_timeout` on the pg pool so a saturated/locked games row can't wedge commands past client aborts.
- **Server-driven B1:** `pickGarrisonRecruitment` is already engine-pure — the driver recruits for AI settlements during their turn. **B3 chartering** follows (`StartCharter` accepts AI actors; `advanceAutoTravel` needs driver treatment for AI charterers).
- Lobby AI slots (D7 revisit) and in-flight-game adoption (D1 revisit).

## Risks

| Risk | Mitigation |
|---|---|
| Mixed old-browser/new-server windows double-drive | Persisted flag gates both sides; server wins races; stale-command rejections pinned by tests |
| Driver wedges on a locked/slow DB | Phase 3 watchdog + pool timeouts; client 10 s `apiFetch` abort already bounds the browser side |
| Event-thin battle outcomes degrade remote UX until Phase 2 | Acceptable interim (non-seat-0 clients already live this way); D6 sequences B6 first |
| Hidden client dependencies on the leaked AI selection patterns | Phase 0/1 keep the client tick intact for unflagged games — zero risk to solo play |
| Two `isPrimaryActor` sources drift | Flip both in one commit + a seam test asserting both read the same flag |

## Out of scope (v1)

Human-defender arena input (D5), lobby AI seats (D7), simultaneous turns, WebSocket transport, adopting in-flight AI games (D1).
