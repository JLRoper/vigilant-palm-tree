# Multiplayer — LAN Seats, Sync, and Session Policy

**Status:** ✅ Current (mechanics as built) — with one policy decided 2026-09-27 whose implementation is pending (see [Drop policy](#drop-policy-decided-2026-09-27-implementation-pending)).

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
| Local seat identity | `src/players/localPlayer.ts` | Seat id kept in `localStorage` (`heroes.mp.localPlayerId.<game>`) plus an in-memory map; `MultiplayerSync.resync()` falls back to seat 0 for legacy starter games nobody claimed |

### Sync model (`src/io/multiplayerSync.ts`)

- **Poll cadence:** every 2s, `GET /api/games/:name/events?cursor=<last game_events.id>`.
- **Incremental apply:** each row that is a declared `EngineEvent` (14 kinds, see `ENGINE_EVENT_KINDS`) is applied via `applyEngineEvent` from `@heroes/engine`; the renderer's `EntityMirror` tween cache is advanced per event.
- **Self-event dedup:** the client's own commands return `lastEventId`; those ids are skipped (a client must not re-apply its own mutations, which were applied locally). The `actor_seat` column covers the same ground whenever the local seat is known; the id set protects the unclaimed-seat case.
- **Full resync** (`getGame` + `hydrateGameState`, cursor reseeded from `game.last_event_id`) on: initial load, an event the engine cannot derive (`event_not_derivable`), or a cursor gap. Rejoin after any absence heals through the same path — no special rejoin flow exists or is needed for state.
- **Turn flow:** strict round-robin. The server enforces turn ownership on every command (`server/app/commandHandler.ts` guard); `activePlayerId` changes on the client emit `mp:turnStarted` off the bus.
- **Telemetry/presence:** each poll fires a best-effort report (RTT, bytes, ok) to `/api/games/:name/telemetry`; `server/telemetry/presenceRegistry.ts` keeps an in-memory, per-process, non-persisted ring and prunes clients silent for `STALE_AFTER_MS = 6s`. This feeds the dev Network Map overlay (`src/screens/debug/networkMap.ts`, see [network-map.md](./network-map.md)). The server has **no other notion of a connected client**.

## Design decisions (2026-09-27)

### 1. Turn timer — none in v1

**Decision:** a player may hold the turn indefinitely. No client or server timer in v1.

**Rationale:** LAN sessions are intimate and cooperative by default; a stall is a social problem before it is a technical one. Enforcement-grade timers want the realtime layer (server push, reconnection UX) that does not exist yet.

**Revisit trigger:** when `WS_PORT` wakes up, or when public-internet play becomes a goal.

### 2. Drop policy — grace, then skip (decided 2026-09-27; implementation pending)

**Decision:** a seat whose client stops reporting is marked **disconnected** after ~60s of missed heartbeats. If the disconnected seat holds the active turn, a further **~2-minute grace** applies, after which the **server auto-EndTurns** for that seat. Email-bound seats can rejoin and reclaim their seat; handle-only seats cannot rebind.

**Rationale:** the failure mode being avoided is a whole table blocked forever on a closed laptop lid. The two-tier timing avoids punishing a flaky Wi-Fi blip (60s ≫ the 6s presence-staleness window and many poll retries) while guaranteeing the game moves.

**What already exists:** heartbeat reports per poll (`multiplayerSync.reportTelemetry`), presence staleness tracking (`presenceRegistry`, tuned for 6s debug freshness), rejoin healing via full resync, email-bound seat claims, and a server-side EndTurn pipeline to reuse (`server/app/turnService.ts` `runEndTurn`).

**What must be built (decisions locked 2026-09-27):**

| Piece | Decision |
|---|---|
| Enforcement-grade presence | Per-seat last-seen is written into the **games row** (the `lobby` jsonb), not the debug telemetry path. `presenceRegistry` stays dev-Network-Map-only. Detection window: **~60s** without a heartbeat → seat marked disconnected. API restart forgetting in-memory timers is accepted (grace clock restarts; worst case is a longer wait, never a wrong action). |
| Server-side skip timer | On "disconnected seat holds the active turn", schedule `runEndTurn` (`server/app/turnService.ts`) after a **~2-minute grace**; cancel on any heartbeat or valid command from the seat. **BATTLE interlock: hold** — while `phase.kind === "BATTLE"` the timer pauses and the grace clock resumes after the phase resolves; the skip never cancels a move or resolves a battle the player didn't see. |
| Disconnected-seat signal to clients | The games-row presence field IS the signal: clients read it off the existing game poll (2s event-cursor cycle already refetches the row on resync; a lightweight per-poll presence read rides the same transport) and render "waiting for seat N (disconnected)". |
| Rejoin reclaim | Lobby claim route: if a seat's `claimed.email` matches the requester's auth email, allow reclaiming a started game's seat (groundwork exists; the "started game" path needs wiring). |

## Implementation decisions (2026-09-27)

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
