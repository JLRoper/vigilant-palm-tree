# Multiplayer — LAN Seats, Sync, and Session Policy

**Status:** ✅ Current (mechanics as built) — including the 2026-09-27 drop policy (shipped the same day, see [Drop policy](#2-drop-policy--grace-then-skip-decided-2026-09-27-shipped-2026-09-27)), the 2026-09-28 SSE event push (see [Sync model](#sync-model-srciomultiplayersyncts)), and the 2026-09-29 AI-enemy combatant seats (see [Decision 3](#3-ai-enemies--non-lobby-combatants-host-client-actor-2026-09-29)).

This is the design doc the multiplayer system never had (former open question #5). It records how LAN multiplayer actually works today, the session-policy decisions made on 2026-09-27, and the gap between the two.

## Scope

- **LAN multiplayer, 2–4 human seats.** Host and Join flows from the home screen (`src/screens/multiplayer/multiplayerLobby.ts`).
- **No internet play, no WebSocket/broker layer.** Sync is SSE push (`GET /api/games/:name/events/stream`, shipped 2026-09-28) with the 2 s HTTP poll kept as the backstop; `WS_PORT` remains reserved and dormant.
- **AI seats are combatants, not lobby seats.** Since 2026-09-29 a new game can add 0–3 AI enemy seats — real players that spawn castles + heroes and take turns (driven by the primary client, see [Decision 3](#3-ai-enemies--non-lobby-combatants-host-client-actor-2026-09-29)). They are not claimable lobby seats, and the LAN lobby flow still creates humans only in v1.

## Current mechanics (as built)

### Lobby and identity

| Mechanic | Where | Behaviour |
|---|---|---|
| Seat counts | `multiplayerLobby.ts` (`SEAT_COUNTS`) | 2, 3, or 4 seats per game |
| Host / Join | same | Host creates a game (default name `lan-YYYY-MM-DD-xxxx`); Join connects to an existing one by name |
| Seat claim | `server/routes.ts` lobby claim/start (writes `games.lobby` jsonb) | Each seat is claimed by index; `claimed` records `handle`, optional `email`, `claimedAt` |
| Handle | lobby UI | Purely cosmetic |
| Email binding | `attachPlayerSeat.ts` + `server/auth.ts` | If the claimer was signed in, the seat is bound to their auth email (server-derived, never client-supplied). Sign-in is optional — anonymous claims leave the seat unbound. |
| Start gate | `lobby.startedAt` | Game is playable once the host starts it |
| Rejoin reclaim | `server/routes.ts` lobby claim | A STARTED game's seat whose `claimed.email` matches the caller's auth email can be reclaimed by that identity (handle/claimedAt refresh; the game stays started). Anonymous (handle-only) claims cannot rebind, and brand-new seats stay unclaimable after start. |
| Local seat identity | `src/players/localPlayer.ts` | Seat id kept in `localStorage` (`heroes.mp.localPlayerId.<game>`) plus an in-memory map; `MultiplayerSync.resync()` falls back to seat 0 for legacy starter games nobody claimed |

### Sync model (`src/io/multiplayerSync.ts`)

- **SSE push (shipped 2026-09-28):** `start()` additionally opens an `EventSource` on `GET /api/games/:name/events/stream?after=<cursor>`. The server replays everything past `after` as catch-up, then live-tails new `game_events` rows — `INSERT` fires a Postgres `NOTIFY` (`migration 017`), one dedicated `LISTEN` connection per API process (`server/persistence/eventsNotifier.ts`) wakes the route (`server/http/routes/eventStream.ts`), and each row goes out as an `id:`-carrying `event: log` frame with a `: ping` heartbeat every 25 s. Every frame feeds the same `applyRows` pipeline as a polled row, so a streamed row advances the cursor and the poll's next `after=cursor` query never re-delivers it. On disconnect the browser auto-reconnects with `Last-Event-ID` — the same cursor under a different name — and the poll covers correctness in the meantime.
- **Poll cadence (backstop v1):** every 2s, `GET /api/games/:name/events?after=<last game_events.id>`. Unchanged by the SSE work; correctness never depends on the stream.
- **Incremental apply:** each row that is a declared `EngineEvent` (17 kinds since the 2026-09-29 capture/garrison wave — `UnitsRecruited`/`UnitsTransferred`/`SettlementBattleResolved` added; see `ENGINE_EVENT_KINDS`) is applied via `applyEngineEvent` from `@heroes/engine`; the renderer's `EntityMirror` tween cache is advanced per event. Garrison deltas additionally reach the live TurnController through `src/game/garrisonEventBridge.ts` (safe-phase gated, FIFO-deferred; `SettlementBattleResolved` arrives as the full-refetch snapshot behind `mp:resynced` — its winner/captured payload can't re-derive the resulting stacks/gold/hero outcomes).
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

**Not server-observable today, by design of the seam:** the BATTLE hold reads the hydrated server state's `phase`, and phase is not persisted in the games row (`hydrateGameState` yields `PLAYER_TURN`/`AI_TURN` only), so in practice the re-check loop passes through immediately until phase becomes server-persisted. The interlock is real code with a real test seam (`configureDropPolicy({ loadPhaseKind })`), and the "never resolve a battle" guarantee additionally holds structurally: a skip is exactly one `EndTurn` and touches nothing battle-related.

## Implementation decisions (2026-09-27)

All four decisions below are shipped (2026-09-27). Test coverage: `test/server/dropPolicy.test.ts` (presence transitions, row flushes, grace/cancel, BATTLE hold with injectable timings, the real `runServerEndTurnForSeat` pipeline + audit row), `test/server/attachPlayerSeat.test.ts` (reclaim paths), `test/io/multiplayerSync.test.ts` (presence onto the bus), and the telemetry round-trip in `test/multiplayer.smoke.ts`.

1. **Auto-EndTurn vs. BATTLE phase** — resolved: **hold during battle**. The skip timer pauses while `phase.kind === "BATTLE"` and the grace clock resumes once the phase resolves. The skip never escalates to cancel-move or battle resolution.
2. **Skip persistence** — accepted: an API restart mid-grace restarts the grace clock. Acceptable for LAN v1.
3. **Timings** — 60s disconnect detection / 2-minute active-turn grace, server-enforced constants (not per-lobby configurable in v1).
4. **Presence transport** — games row (`lobby` jsonb), not the topology snapshot; `presenceRegistry` remains dev-overlay-only.

### 3. AI enemies — non-lobby combatants, host-client actor (2026-09-29)

**Decision:** a new game can add 0–3 AI enemy seats ("Number of AI enemies" chip row on the home Create Game screen and the toolbar New Game modal, default 0). An AI seat is a real player in the engine — `playerCount = humanSeatCount + enemyCount` (clamped ≤ MAX_PLAYERS 10): it spawns a castle and a "Warlord" hero at init and takes its own `AI_TURN` phase. But AI seats are **not lobby seats**: `seats` stays = humanSlots, so claim/reclaim/start are unchanged (claiming an AI seat is a 400 `seat_out_of_range`). The LAN lobby path itself sends no `enemySlots` — humans-only in v1 (its seat-count label now reads "Number of human players").

**As built (2026-09-29):**

| Piece | Implementation |
|---|---|
| Wire + transport | `enemyCount` client-side → `enemySlots` on the wire: `POST /games` body (server clamps int 0..10−humanSlots), `api.createGame` / `SessionManager.createGame` / `handleNewGame` (clamps 0–3); `initOpts { playerCount: humanSlots + enemySlots, humanSeatCount: humanSlots }`. `generateCastles` preview uses the total count. |
| Turn actor | The client AI tick (`turnController.tick` + `src/ai/aiBrain.ts`) is gated to the **primary client** (`isPrimaryActor` = local seat 0): in solo play that's you; in LAN games seat 0's browser drives every AI turn and non-primary clients watch via sync. Engine `startMove` (`packages/engine/src/hero/move.ts`) admits `AI_TURN` moves for the active AI seat (ownership-checked). |
| Battles | After a successful AI move, adjacency → `enterBattle`. Resolution rides the existing quick-resolve predicate (`GameActions.maybeAutoResolveBattle`): any battle whose attacker is not the local human auto-resolves silently (AI-vs-AI and AI-attacker-vs-human; the result card still shows), while a human attacker keeps the Fight/Quick-Resolve/Flee modal. An AI-initiated battle returns the phase to `AI_TURN` (was a stall bug, fixed). A walk-in onto a beatable garrisoned settlement opens a `SETTLEMENT_BATTLE` that resolves through the same silent policy (`TurnController.resolveSettlementBattle` → fire-and-forget `SubmitSettlementBattleResult` for persistence; 2026-09-29 capture/garrison wave), and the AI's own walk-in capture serializes behind the move persist like the human path's. |
| Behavior | `aiBrain` targets enemy heroes within reach 7 (priority `1000 − dist·10`), then settlements within reach 8 — garrisoned ones it can beat (`GARRISON_ATTACK_RATIO = 1.5`: troop total ≥ 1.5× the garrison's, priority `700 − dist·5`), empty enemy-owned (`650 − dist·5`), neutral (`600 − dist·5`) — then unclaimed resources (reach 8), else wanders; walks onto empty enemy/neutral settlements to capture; an unfavorable garrison is still refused as a path step. AI does not charter (unchanged). |
| Garrison sync | `ENGINE_EVENT_KINDS` 14 → 17 (2026-09-29 capture/garrison wave): `UnitsRecruited`/`UnitsTransferred` apply as deltas through `applyEvent.ts`'s new applied-reducers (the recruit replay deposits into the garrison only — settled gold/warehouse follow at the TurnEnded resync boundary), `SettlementBattleResolved` is answered by a full-refetch resync. `src/game/garrisonEventBridge.ts` carries both into the live TurnController: safe-phase gating (blocked mid-battle, during ROUND_END, and the primary client's own `AI_TURN`; a snapshot landing during the local seat's own `PLAYER_TURN` is dropped, never queued), FIFO deferral with retry on `state:committed`, `flushPendingCommands()` before every merge. |

**Known v1 limitation:** there is no server-side AI actor — the host-client drives. If seat 0 is absent in a LAN game (its browser closed), AI turns stall until seat 0 returns.

**Rationale:** supersedes the earlier "no AI seats in v1" decision — its revisit trigger (solo-against-AI playtest demand) arrived. Keeping AI seats out of the lobby leaves the human seat-claim/reclaim machinery untouched; making seat 0's client the actor keeps the AI logic client-side for v1 (server-side actor is a non-goal).

## Open questions

1. **Auto-EndTurn vs. BATTLE phase** — ~~resolved 2026-09-27: hold during battle~~ (see Implementation decisions).
2. **Skip persistence** — accepted: an API restart mid-grace restarts the grace clock. Acceptable for LAN v1.

## Out of scope

Internet play, matchmaking, spectator seats, claimable AI lobby seats (AI enemy seats exist as non-lobby combatants since 2026-09-29 — Decision 3), simultaneous turns, and any WebSocket transport — still true after the 2026-09-28 SSE event push: SSE is plain HTTP streaming, not a WebSocket (see `plan/` → `.kilo/plan/` architecture walkthrough docs for the Tailscale/LAN deployment context).

## See also

- [network-map.md](./network-map.md) — the dev overlay that visualises the polling topology this doc describes
- [auth-model.md](./auth-model.md) — the optional email identity that seat binding reuses
- [module-documentation-and-relationships.md](./module-documentation-and-relationships.md) — mechanical module map (lobby §, sync §)
