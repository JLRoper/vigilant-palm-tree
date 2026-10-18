# Multiplayer — LAN Seats, Sync, and Session Policy

<!-- docs:verified 2026-10-17 -->

**Status:** Current mechanics, including SSE/poll sync, the disconnect drop policy, and server-driven AI. The AI section below retains earlier decision history; the 2026-10-11 correction supersedes its original host-client-only/no-chartering notes.

This is the design doc the multiplayer system never had (former open question #5). It records how LAN multiplayer actually works today, the session-policy decisions made on 2026-09-27, and the gap between the two.

## Scope

- **LAN multiplayer, 2–4 human seats.** Host and Join flows from the home screen (`src/screens/multiplayer/multiplayerLobby.ts`).
- **No internet play, no WebSocket/broker layer.** Sync is SSE push (`GET /api/games/:name/events/stream`, shipped 2026-09-28) with the 2 s HTTP poll kept as the backstop; `WS_PORT` remains reserved and dormant.
- **AI seats are combatants, not lobby seats.** New games support 0–3 AI enemies; they spawn castles/heroes but are not claimable lobby seats. Games with AI enemies are flagged for the server-side driver; the LAN lobby still claims human seats only.

## Current mechanics (as built)

### Lobby and identity

| Mechanic | Where | Behaviour |
|---|---|---|
| Seat counts | `multiplayerLobby.ts` (`SEAT_COUNTS`) | 2, 3, or 4 seats per game |
| Host / Join | same | Host creates a game (default name `lan-YYYY-MM-DD-xxxx`, map size `small`/`medium`/`large`/`huge`/`epic`); Join connects to an existing one by name |
| Seat claim | `server/routes.ts` lobby claim/start (writes `games.lobby` jsonb) | Each seat is claimed by index; `claimed` records `handle`, optional `email`, `claimedAt` |
| Handle | lobby UI | Purely cosmetic |
| Email binding | `attachPlayerSeat.ts` + `server/auth.ts` | If the claimer was signed in, the seat is bound to their auth email (server-derived, never client-supplied). Sign-in is optional — anonymous claims leave the seat unbound. |
| Start gate | `lobby.startedAt` | Game is playable once the host starts it |
| Rejoin reclaim | `server/routes.ts` lobby claim | A STARTED game's seat whose `claimed.email` matches the caller's auth email can be reclaimed by that identity (handle/claimedAt refresh; the game stays started). Anonymous (handle-only) claims cannot rebind, and brand-new seats stay unclaimable after start. |
| Local seat identity | `src/players/localPlayer.ts` | Seat id kept in `localStorage` (`heroes.mp.localPlayerId.<game>`) plus an in-memory map; `MultiplayerSync.resync()` falls back to seat 0 for legacy starter games nobody claimed |

### Sync model (`src/io/multiplayerSync.ts`)

- **SSE push (shipped 2026-09-28):** `start()` additionally opens an `EventSource` on `GET /api/games/:name/events/stream?after=<cursor>`. The server replays everything past `after` as catch-up, then live-tails new `game_events` rows — `INSERT` fires a Postgres `NOTIFY` (`migration 017`), one dedicated `LISTEN` connection per API process (`server/persistence/eventsNotifier.ts`) wakes the route (`server/http/routes/eventStream.ts`), and each row goes out as an `id:`-carrying `event: log` frame with a `: ping` heartbeat every 25 s. Every frame feeds the same `applyRows` pipeline as a polled row, so a streamed row advances the cursor and the poll's next `after=cursor` query never re-delivers it. On disconnect the browser auto-reconnects with `Last-Event-ID` — the same cursor under a different name — and the poll covers correctness in the meantime.
- **Poll cadence (backstop v1):** every 2s, `GET /api/games/:name/events?after=<last game_events.id>`. Unchanged by the SSE work; correctness never depends on the stream.
- **Incremental apply:** each row that is a declared `EngineEvent` is applied via `applyEngineEvent` from `@heroes/engine`; `EntityMirror` advances per event. `ENGINE_EVENT_SYNC_CLASS` classifies 26 variants (12 apply, 7 resync, 7 ignore); 19 are admitted by the multiplayer path. Garrison deltas reach the live TurnController through `src/game/garrisonEventBridge.ts`; `SettlementBattleResolved` triggers a full-refetch snapshot, while `BattleOffered` is a bridged delta that opens the defender's choice modal. A reload mid-offer re-derives `BATTLE` from `lobby.pendingBattle` through `src/io/hydrateClientGame.ts`.
- **Self-event dedup:** the client's own commands return `lastEventId`; those ids are skipped (a client must not re-apply its own mutations, which were applied locally). The `actor_seat` column covers the same ground whenever the local seat is known; the id set protects the unclaimed-seat case.
- **Full resync** (`getGame` + `hydrateGameState`, cursor reseeded from `game.last_event_id`) on: initial load, an event the engine cannot derive (`event_not_derivable`), or a cursor gap. Rejoin after any absence heals through the same path — no special rejoin flow exists or is needed for state.
- **Turn flow:** strict round-robin. The server enforces turn ownership on every command (`server/app/commandHandler.ts` guard); `activePlayerId` changes on the client emit `mp:turnStarted` off the bus.
- **Telemetry/presence:** each poll fires a best-effort report (RTT, bytes, ok) to `/api/games/:name/telemetry`; `server/telemetry/presenceRegistry.ts` keeps an in-memory, per-process, non-persisted ring and prunes clients silent for `STALE_AFTER_MS = 6s`. This feeds the dev Network Map overlay (`src/screens/debug/networkMap.ts`, see [network-map.md](./network-map.md)). On top of that debug view there is now an **enforcement-grade presence layer** — `server/app/dropPolicy.ts` counts telemetry reports *and* valid commands as heartbeats, marks seats disconnected after 60s, and persists the disconnected signal into the games row (see [Drop policy](#2-drop-policy--grace-then-skip-decided-2026-09-27-shipped-2026-09-27)). The same telemetry POST answers 200 with the live seat-presence view, so the client's per-poll call doubles as the presence read.

## Design decisions (2026-09-27)

### 1. Turn timer — none in v1

**Decision:** a player may hold the turn indefinitely. No client or server timer in v1.

**Rationale:** LAN sessions are intimate and cooperative by default; a stall is a social problem before it is a technical one. Enforcement-grade timers want the realtime layer (server push, reconnection UX). Server push now exists — the 2026-09-28 SSE event stream — but reconnection UX is still just the browser's auto-reconnect, so the decision stands for v1.

**Revisit trigger:** when public-internet play becomes a goal, or a WebSocket/broker layer with richer reconnection UX lands (the SSE push shipped 2026-09-28 removed the "no push at all" half of the original trigger).

### 2. Drop policy — grace, then skip (decided 2026-09-27, shipped 2026-09-27)

**Decision:** a seat whose client stops reporting is marked **disconnected** after ~60s of missed heartbeats. If the disconnected seat holds the active turn, a further **~2-minute grace** applies, after which the **server auto-EndTurns** for that seat. Email-bound seats can rejoin and reclaim their seat; handle-only seats cannot rebind.

**Rationale:** the failure mode being avoided is a whole table blocked forever on a closed laptop lid. The two-tier timing avoids punishing a flaky Wi-Fi blip (60s ≫ the 6s presence-staleness window and many poll retries) while guaranteeing the game moves.

**As built (2026-09-27):**

| Piece | Implementation |
|---|---|
| Enforcement-grade presence | `server/app/dropPolicy.ts` — per-seat last-seen in an in-process map, fed by `touchSeat` from two heartbeat sources: the per-poll telemetry POST (`server/http/routes/telemetry.ts`) and any valid command (`server/http/routes/commands.ts`, after the actor-vs-seat guard). Heartbeats never touch the games row; the row (`lobby.presence`, see `LobbyState` in `server/routes.ts`) is written only on **transitions** — connected→disconnected at 60s of silence, and disconnect-cleared on a returning heartbeat — via an atomic depth-one `jsonb_set` + `jsonb_build_object` merge (`jsonb_set` cannot create intermediate objects, and depth-two paths silently no-op; the merge also preserves sibling seats' entries and can't clobber a concurrently written claim). One lazy per-game seed from the row on first touch keeps a pre-restart "disconnected" from resurrecting after an API restart. `presenceRegistry` stays dev-Network-Map-only. Detection window: **`DISCONNECT_AFTER_MS = 60_000`**. API restart forgetting in-memory timers is accepted (grace clock restarts; worst case is a longer wait, never a wrong action). |
| Server-side skip timer | `scanOnce()` (5s in-process scanner started from `server/index.ts`) schedules a **`SKIP_GRACE_MS = 120_000`** grace timer per disconnected seat that holds `active_player_id`; any heartbeat or valid command cancels it. On expiry, `enforceSkipForSeat` re-validates everything against the live row (stale-timer races land as no-ops), holds while the phase is BATTLE (re-check every 5s until the phase resolves — the skip never cancels a move or resolves a battle the player didn't see), and otherwise runs `runServerEndTurnForSeat` (`server/app/commandHandler.ts`): the full `turnService.runEndTurn` pipeline via the same command transaction an HTTP EndTurn uses, entered at service level rather than through the command router's auth path (the internal turn-ownership guard still runs and doubles as the stale-timer check). A `turn_skipped` audit row (actor_seat NULL, snake_case like the other legacy audit kinds) records that the EndTurn was server-initiated. |
| Disconnected-seat signal to clients | Two carriers: the games row (`lobby.presence`) read off `GET /games/:name` (lobby seat list, resyncs), and the **telemetry POST response** (`200` + presence body — was `204`), which gives every poll cycle a free presence read without an extra request. `MultiplayerSync` puts both on the bus as `mp:presenceUpdated` (`src/core/events.ts`). UI: the lobby seat grid renders "(disconnected)" (`multiplayerLobby.ts`) and an in-game fixed-position hint shows "Waiting for seat N (disconnected)" while a disconnected seat holds the active turn (`src/screens/shared/mpPresenceHint.ts`, attached from `GameEngine.initEventListeners`). |
| Rejoin reclaim | Lobby claim route (`server/routes.ts`): on a STARTED game, a claim whose `claimed.email` equals the caller's server-derived auth email is reclaimed instead of 409'd (handle/claimedAt refresh, membership cache invalidated, game stays started). Everything else about started-game claims is unchanged. |

**Not server-observable today, by design of the seam:** the BATTLE hold reads the hydrated server state's `phase`, and phase is not persisted in the games row (`hydrateGameState` yields `PLAYER_TURN`/`AI_TURN` only), so in practice the re-check loop passes through immediately until phase becomes server-persisted. **Amended 2026-10-04:** hydrate can now derive a `BATTLE` phase — but only from the AI driver's `games.lobby.pendingBattle` marker (the defender-chosen battle offer, see [Decision 3](#3-ai-enemies--non-lobby-combatants-host-client-actor-2026-09-29)), so the hold genuinely bites for a server-offered battle: a disconnected seat's skip waits while an offered battle is unresolved. The interlock remains real code with a real test seam (`configureDropPolicy({ loadPhaseKind })`), and the "never resolve a battle" guarantee additionally holds structurally: a skip is exactly one `EndTurn` and touches nothing battle-related.

## Implementation decisions (2026-09-27)

All four decisions below are shipped (2026-09-27). Test coverage: `test/server/dropPolicy.test.ts` (presence transitions, row flushes, grace/cancel, BATTLE hold with injectable timings, the real `runServerEndTurnForSeat` pipeline + audit row), `test/server/attachPlayerSeat.test.ts` (reclaim paths), `test/io/multiplayerSync.test.ts` (presence onto the bus), and the telemetry round-trip in `test/multiplayer.smoke.ts`.

1. **Auto-EndTurn vs. BATTLE phase** — resolved: **hold during battle**. The skip timer pauses while `phase.kind === "BATTLE"` and the grace clock resumes once the phase resolves. The skip never escalates to cancel-move or battle resolution. **Caveat (2026-10-04):** a BATTLE phase the AI driver itself offered (`lobby.pendingBattle`) must not hold the game hostage either — the driver's own wait deadline (`AI_DEFENDER_WAIT_TIMEOUT_MS`, 300 s) force-resolves the offer server-side and appends an `ai_defender_wait_expired` audit row, and the `EndTurn` case clears any marker that survived into the next turn's persist.
2. **Skip persistence** — accepted: an API restart mid-grace restarts the grace clock. Acceptable for LAN v1.
3. **Timings** — 60s disconnect detection / 2-minute active-turn grace, server-enforced constants (not per-lobby configurable in v1).
4. **Presence transport** — games row (`lobby` jsonb), not the topology snapshot; `presenceRegistry` remains dev-overlay-only.

### 3. AI enemies — non-lobby combatants, host-client actor (2026-09-29)

**Current status correction (2026-10-11):** The original host-client-only description below is retained as history. AI turns in games with `enemySlots > 0` are server-driven. Phase 3 heartbeat/watchdog and pool hardening are implemented, and B3 AI chartering/travel is live through `pickCharterAction` in `packages/engine/src/ai/aiBrain.ts` and `server/app/aiDriver.ts`. AI chartering follows the same 2,500g purse, 20 wood, 15 stone, minimum-distance, and 10-day construction rules as player charters. The driver also handles garrison recruitment and up to three trade-route recommendations per round/seat; per-boot tokens, a stale-driver watchdog, and per-game PostgreSQL advisory locks prevent duplicate drivers.

**Decision:** a new game can add 0–3 AI enemy seats ("Number of AI enemies" chip row on the home Create Game screen and the toolbar New Game modal, default 0). An AI seat is a real player in the engine — `playerCount = humanSeatCount + enemyCount` (clamped ≤ MAX_PLAYERS 10): it spawns a castle and a "Warlord" hero at init and takes its own `AI_TURN` phase. But AI seats are **not lobby seats**: `seats` stays = humanSlots, so claim/reclaim/start are unchanged (claiming an AI seat is a 400 `seat_out_of_range`). The LAN lobby path itself sends no `enemySlots` — humans-only in v1 (its seat-count label now reads "Number of human players").

**As built (2026-09-29):**

| Piece | Implementation |
|---|---|
| Wire + transport | `enemyCount` client-side → `enemySlots` on the wire: `POST /games` body (server clamps int 0..10−humanSlots), `api.createGame` / `SessionManager.createGame` / `handleNewGame` (clamps 0–3); `initOpts { playerCount: humanSlots + enemySlots, humanSeatCount: humanSlots }`. `generateCastles` preview uses the total count. |
| Turn actor | **Current:** games created with `enemySlots > 0` persist `lobby.aiDriver: "server"`; `server/app/aiDriver.ts` drives them internally, and seat 0's browser is a spectator. Only unflagged legacy games retain the browser-driven path. |
| Battles | After a successful AI move, adjacency → `enterBattle`. Resolution rides `GameActions.maybeAutoResolveBattle` — since 2026-10-04 through `resolveBattleChoice` (`src/screens/combat/battleChoicePolicy.ts`) instead of the old `pvp` predicate: a human attacker keeps the Fight/Quick-Resolve/Flee modal, and an **AI attacking the local human no longer auto-resolves** — the driver dispatches `EnterBattle`, the server stamps `games.lobby.pendingBattle` + appends the `BattleOffered` event (an apply-class delta), and the defender's own client opens the Fight/Quick-Resolve modal (the bridged `BattleOffered` delta merges via `replaceState`, so the `state:committed` listener's `maybeAutoResolveBattle()` call is the opener; the modal is non-dismissible; Flee hidden — fleeing cancels the *attacker's* move) and submits `ResolveBattle`/`SubmitBattleResult` from its own seat during the AI's turn (the turn-ownership guard exempts the battle pair). A reload or resync mid-offer maps the nested `lobby.pendingBattle` via `src/io/hydrateClientGame.ts`, so the phase re-derives and the modal re-opens. AI-vs-AI still auto-resolves silently on the driving client (the result card still shows). An AI-initiated battle returns the phase to `AI_TURN` (was a stall bug, fixed). A walk-in onto a beatable garrisoned settlement opens a `SETTLEMENT_BATTLE` that resolves through the same silent policy (`TurnController.resolveSettlementBattle` → fire-and-forget `SubmitSettlementBattleResult` for persistence; 2026-09-29 capture/garrison wave), and the AI's own walk-in capture serializes behind the move persist like the human path's. |
| Behavior | The engine brain prioritizes reachable enemies, beatable garrisons, empty settlements, and resources, otherwise wandering. The server driver now also starts AI charters and advances their travel/construction, recruits garrisons, and accepts trade needs through the same engine rules. |
| Garrison sync | 19 multiplayer-admitted event kinds are derived from the 25-variant sync-class map. `UnitsRecruited`/`UnitsTransferred` apply as deltas; `SettlementBattleResolved` triggers a refetch. `src/game/garrisonEventBridge.ts` applies safe-phase gating and FIFO deferral. |

**Remaining legacy limitation:** unflagged pre-driver games can still use the browser-driven AI path; if seat 0 is absent, their AI turn can stall. New games with AI enemies are server-flagged, server-driven, protected by the client-command route block, and recover stale ownership through the heartbeat/watchdog. Rollback is server-controlled.

**Historical rationale:** this section records the original host-client v1 choice. The server actor and B3 chartering described in the current-status correction supersede that implementation decision for flagged games.

## Open questions

1. **Auto-EndTurn vs. BATTLE phase** — ~~resolved 2026-09-27: hold during battle~~ (see Implementation decisions).
2. **Skip persistence** — accepted: an API restart mid-grace restarts the grace clock. Acceptable for LAN v1.

## Out of scope

Internet play, matchmaking, spectator seats, claimable AI lobby seats, simultaneous turns, and WebSocket transport remain out of scope. SSE is plain HTTP streaming, not a WebSocket. See the [operations guide](./operations.md) for LAN configuration.

## See also

- [network-map.md](./network-map.md) — the dev overlay that visualises the polling topology this doc describes
- [auth-model.md](./auth-model.md) — the optional email identity that seat binding reuses
- [module-documentation-and-relationships.md](./module-documentation-and-relationships.md) — mechanical module map (lobby §, sync §)
