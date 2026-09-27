# Multiplayer — LAN Seats, Sync, and Session Policy

**Status:** ✅ Current (mechanics as built) — including the 2026-09-27 drop policy, shipped the same day (see [Drop policy](#2-drop-policy--grace-then-skip-decided-2026-09-27-shipped-2026-09-27)).

This is the design doc the multiplayer system never had (former open question #5). It records how LAN multiplayer actually works today, the session-policy decisions made on 2026-09-27, and the gap between the two.

## Scope

- **LAN multiplayer, 2–4 human seats.** Host and Join flows from the home screen (`src/screens/multiplayer/multiplayerLobby.ts`).
- **No internet play, no realtime layer.** All sync is HTTP polling against the Express API. `WS_PORT` remains reserved and dormant.
- **AI is not a seat.** The AI that exists is the wandering enemy-hero layer (`src/systems/enemyWander.ts`, `src/ai/aiBrain.ts`) — it does not own players or take turns.

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

- **Poll cadence:** every 2s, `GET /api/games/:name/events?cursor=<last game_events.id>`.
- **Incremental apply:** each row that is a declared `EngineEvent` (14 kinds, see `ENGINE_EVENT_KINDS`) is applied via `applyEngineEvent` from `@heroes/engine`; the renderer's `EntityMirror` tween cache is advanced per event.
- **Self-event dedup:** the client's own commands return `lastEventId`; those ids are skipped (a client must not re-apply its own mutations, which were applied locally). The `actor_seat` column covers the same ground whenever the local seat is known; the id set protects the unclaimed-seat case.
- **Full resync** (`getGame` + `hydrateGameState`, cursor reseeded from `game.last_event_id`) on: initial load, an event the engine cannot derive (`event_not_derivable`), or a cursor gap. Rejoin after any absence heals through the same path — no special rejoin flow exists or is needed for state.
- **Turn flow:** strict round-robin. The server enforces turn ownership on every command (`server/app/commandHandler.ts` guard); `activePlayerId` changes on the client emit `mp:turnStarted` off the bus.
- **Telemetry/presence:** each poll fires a best-effort report (RTT, bytes, ok) to `/api/games/:name/telemetry`; `server/telemetry/presenceRegistry.ts` keeps an in-memory, per-process, non-persisted ring and prunes clients silent for `STALE_AFTER_MS = 6s`. This feeds the dev Network Map overlay (`src/screens/debug/networkMap.ts`, see [network-map.md](./network-map.md)). On top of that debug view there is now an **enforcement-grade presence layer** — `server/app/dropPolicy.ts` counts telemetry reports *and* valid commands as heartbeats, marks seats disconnected after 60s, and persists the disconnected signal into the games row (see [Drop policy](#2-drop-policy--grace-then-skip-decided-2026-09-27-shipped-2026-09-27)). The same telemetry POST answers 200 with the live seat-presence view, so the client's per-poll call doubles as the presence read.

## Design decisions (2026-09-27)

### 1. Turn timer — none in v1

**Decision:** a player may hold the turn indefinitely. No client or server timer in v1.

**Rationale:** LAN sessions are intimate and cooperative by default; a stall is a social problem before it is a technical one. Enforcement-grade timers want the realtime layer (server push, reconnection UX) that does not exist yet.

**Revisit trigger:** when `WS_PORT` wakes up, or when public-internet play becomes a goal.

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

### 3. AI fill — no AI seats in v1

**Decision:** unclaimed seats stay empty. AI never owns a player seat or takes turns; AI remains the wandering enemy-hero layer.

**Rationale:** matches current code and keeps scope small. Full-turn AI (chartering, trading, recruiting) is a large surface with no current consumer; revisit only if solo-against-AI playtest demand appears.

## Open questions

1. **Auto-EndTurn vs. BATTLE phase** — ~~resolved 2026-09-27: hold during battle~~ (see Implementation decisions).
2. **Skip persistence** — accepted: an API restart mid-grace restarts the grace clock. Acceptable for LAN v1.

## Out of scope

Internet play, matchmaking, spectator seats, AI seats, simultaneous turns, and any WebSocket transport (see `plan/` → `.kilo/plan/` architecture walkthrough docs for the Tailscale/LAN deployment context).

## See also

- [network-map.md](./network-map.md) — the dev overlay that visualises the polling topology this doc describes
- [auth-model.md](./auth-model.md) — the optional email identity that seat binding reuses
- [module-documentation-and-relationships.md](./module-documentation-and-relationships.md) — mechanical module map (lobby §, sync §)
