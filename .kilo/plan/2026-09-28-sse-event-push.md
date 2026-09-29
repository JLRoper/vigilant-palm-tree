# SSE Event Push — Postgres LISTEN/NOTIFY (the "now" step)

**Status:** Planned, not started. Written 2026-09-28.
**Follow-on:** [`future/2026-09-28-kafka-upgrade.md`](./future/2026-09-28-kafka-upgrade.md) is the later broker stage. This plan is deliberately shaped so nothing here is thrown away by it: the table stays the system of record, the cursor stays the browser resume token, and polling stays the fallback.

## Context

- The multiplayer event pipeline is HTTP short-polling: `MultiplayerSync` polls `GET /api/games/:name/events?after=<cursor>` every 2 s (`src/io/multiplayerSync.ts:55,80`). The server reads the append-only `game_events` table (`server/schema.sql:23-31`), whose BIGSERIAL `id` doubles as the cursor (`server/routes.ts:481-517`).
- There is no broker of any kind (runtime deps: `cors`, `express`, `pg`, `tsx`, `vite`); `WS_PORT` is reserved and dormant. Plan docs already note the GET events endpoint is the intended future push contract.
- This plan activates that contract: same log, same cursor, same client reducer — near-realtime delivery via SSE instead of "up to 2 s late".
- Why SSE and not WebSocket: game events are one-way server→client. SSE is plain HTTP (no upgrade negotiation through proxies/LBs), and the browser's native `EventSource` auto-reconnects sending `Last-Event-ID` — which is exactly our existing `after=<id>` cursor under a different name.

## Goal

A row inserted into `game_events` reaches the owning game's connected browsers in ~low hundreds of ms without a client-driven request, via:

```
INSERT INTO game_events
  → AFTER INSERT trigger (pg_notify 'game_events_changed', game_id)
  → one dedicated LISTEN connection per API process
  → GET /api/games/:name/events/stream  (SSE)
  → MultiplayerSync fans out EVERY row as mp:logRow ──► Log Message Panel (use case 1)
  → existing client apply pipeline (applyRows / applyEngineEvent / mirror)
```

**Use case 1 — this plan's first shipped consumer — is the game log:** a settings-toggled Log Message Panel receiving a constant stream of every log/audit row for the current game: authoritative EngineEvent rows *and* snake_case audit rows, for **all seats, including this client's own**.

## Use case 1: what generates the log messages, and what consumes them

**Producers — every path lands in `game_events`:**

| Producer | Rows written | Where |
|---|---|---|
| `handleCommand()` — one EngineEvent per successful command (~30 append sites) | EngineEvent rows, `kind` = `event.type`, `actor_seat` set (`HeroMoved`, `BattleResolved`, `SettlementCaptured`, `TradeRouteCreated`, …) | `server/app/commandHandler.ts` |
| EndTurn side-audit | `turn_ended`, `round_ended`, `round_started`, `ai_turn_started` (actor `null`) | `commandHandler.ts:601-617` |
| Drop-policy server-side skip | `turn_skipped` (actor `null`) | `commandHandler.ts:1816-1838` |
| Client hooks, fire-and-forget `api.logEvent` → `POST /games/:name/events` | snake_case audit rows: `move_completed`, `settlement_captured`, `battle_started`, `battle_resolved`, `charter_*`, `transfer_gold`, `hero_recruited`, … | `src/game/turnHooks.ts:466-479` → `server/routes.ts:460-479` |
| Session markers | `new_game`, `load_game`, `session_start` | `src/managers/GameSessionManager.ts:72,131,170`, `src/managers/SessionManager.ts:101` |

**Consumers on the client:**

| Consumer | Rows it takes | Status |
|---|---|---|
| `MultiplayerSync.applyRows` → `applyEngineEvent` → `EntityMirror` | EngineEvent rows only, self-events skipped, non-whitelisted kinds skipped | exists — the state pipeline, untouched by this plan's UI work |
| **`LogPanel` (new, `src/screens/shared/logPanel.ts`)** | **every row — all kinds, all seats, own seat included, no filtering** | **this plan** |
| Dev EventLog / dev console (`src/debug/`) | local bus types + own `hooks.logEvent` calls only — it has *never* seen other seats' rows | unchanged; the panel becomes the first whole-game log view |

## Non-goals

- No WebSocket, no broker, no new dependencies.
- No change to the polling endpoint or its contract (it stays as fallback and the resume path).
- No change to `applyEngineEvent` semantics, self-event dedupe, or resync policy.
- No auth changes (game endpoints are anonymous today; the stream is anonymous for parity).
- No EntityMirror→renderer cutover (that remains #148).
- No log history UI beyond the panel's capped ring buffer + one backlog fetch — the database stays the history; no pagination, no search, no retention changes.
- No change to the dev EventLog / dev console (`src/debug/`) — it stays a local-only debug tool.

## Design

### Server: notify path

1. **Migration** `server/migrations/014_game_events_notify.sql` (verify next free number at implementation time):
   - `CREATE OR REPLACE FUNCTION game_events_notify()` → `PERFORM pg_notify('game_events_changed', NEW.game_id::text)`
   - `CREATE TRIGGER ... AFTER INSERT ON game_events FOR EACH ROW EXECUTE FUNCTION ...`
   - NOTIFY is delivered at commit, so any row the handler then SELECTs is already visible — no notification-vs-payload race.
2. **`server/persistence/eventsNotifier.ts`** (new): process-wide singleton owning one dedicated `pg.Client` (not a pool client — LISTEN must hold its connection for the process lifetime; holding a pool client would starve the pool). API: `subscribeGameEvents(gameId, cb): () => void`. On notification, invoke the callbacks registered for that `game_id`. On connection error: exponential-backoff reconnect + re-`LISTEN`.
   - Env: `.env` may point `PGHOST` at the shared gameserver (AGENTS.md). The notifier reads the same env as the pool, which `.env.test` already pins for tests. If a transaction-mode pgbouncer ever fronts the DB, add a `PGNOTIFY_DSN`-style override for the LISTEN connection (same precedent as Centrifugo's `partition_notification_dsn`).

### Server: SSE route

3. **`server/http/routes/eventStream.ts`** (new), mounted in `server/routes.ts` alongside the other sub-routers (`router.use("/games/:name/events/stream", eventStreamRouter)` at the `routes.ts:26-30` block).
   - `GET /` — 404 when the game doesn't exist (match sibling routes); validate `?after` with the same `/^\d+$/` rule as the poll route (`routes.ts:490-498`); respond with `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`; first frame `retry: 3000`.
   - Catch-up replay: run the exact poll query (`routes.ts:513`) with `id > after`, emitting each row as `id: <id>\nevent: log\ndata: <row json>\n\n`.
   - Live tail: notifier callback re-runs the same query from the last-sent id and writes frames. `id` is sent on every frame so `EventSource` resume works.
   - Heartbeat `: ping\n\n` every ~25 s (below typical 30–60 s proxy idle timeouts); timer cleared on disconnect.
   - `req.on("close")` unsubscribes and clears the heartbeat. Backpressure: rely on `res.write()` + the low event volume; document rather than over-engineer.
   - **All rows stream** — EngineEvent rows and legacy audit kinds alike. The log is the product; the client already separates the two via `isEngineEventRow`.

### Client: SSE transport in `MultiplayerSync`

4. **`src/io/api.ts`**: `eventStreamUrl(gameName, after)` helper using the same base-URL logic as the other calls. Use `EventSource` directly (no polyfill).
   - **Module placement decision (2026-09-28): no new `src/` section.** SSE is transport, so it lives in the existing `io/` layer — start inline in `multiplayerSync.ts` (the poller's sibling concern); extract a thin `src/io/eventStream.ts` (connect / Last-Event-ID resume / `onRow` wrapper) only if the transport code grows past ~100 lines, keeping `multiplayerSync.ts` as the orchestrator. Likewise the `LogPanel` goes in the existing `src/screens/shared/` (next to `toast.ts`, `dockedPanel.ts`) and the flag in `src/state/settings.ts` — no `src/events/` section, per the io-is-the-boundary rule and the #148 no-parallel-structures lesson.
5. **`src/io/multiplayerSync.ts` — SSE as an accelerator, poll as backstop (v1):**
   - `start()` additionally opens `EventSource(.../events/stream?after=<cursor ?? 0>)`.
   - Each frame parses to a `GameEventRow` (`id` arrives as a string in JSON, same as the poll path) and feeds the **existing** `applyRows(gameName, [row])` — cursor advance, self-event skip (`selfEventIds` + `actor_seat`), kind filter, `applyEngineEvent`, mirror apply, and the `mp:*` bus emissions are reused verbatim.
   - Because `applyRows` advances `this.cursor`, the untouched 2 s poll's `after=cursor` query naturally returns only what SSE missed — there is no duplicate-application path (and `applyEngineEvent`'s `noop` outcome covers the theoretical in-flight race; worst case is one redundant resync).
   - **Every frame fans out to UI before any engine filtering:** after parsing, emit `{ type: "mp:logRow", gameName, row }` on the bus (`src/core/events.ts` gains this `GameEvent` variant). One SSE connection per client serves both the state pipeline and the log panel; a `bus.on("mp:logRow")` subscriber that isn't installed costs nothing.
   - On `EventSource` `error`: the browser auto-reconnects with `Last-Event-ID`; nothing to do beyond a `console.warn`. Poll already covers correctness while disconnected.
   - `stop()` closes the EventSource. The turn-end pause in `src/game/turnHooks.ts:81-96` (stop/start around the EndTurn POST) keeps working unchanged.
   - Poll cadence stays 2000 ms in v1. Follow-up (flagged, separate change): demote to ~10–15 s once SSE is proven in `test:multiplayer`.
6. **Settings flag** `showLogPanel: boolean` (default `false`) in `src/state/settings.ts`: add to `GameSettings`, `DEFAULT_SETTINGS`, and the `typeof === "boolean"` guards in `updateSettings()` and `loadFromStorage()` — the exact pattern of `parallaxEnabled` (`settings.ts:79,163-165,219-221`). Persists automatically via the existing `heroesJs.settings` localStorage key. Toggle lives in the settings menu (`src/screens/home/settingsMenu.ts`), labelled e.g. "Game log panel".
7. **`src/screens/shared/logPanel.ts`** (new) — use case 1's consumer:
   - Subscribes `bus.on("mp:logRow")` into its own capped ring buffer (default 500 entries, the `EventLog` capacity precedent). **No filtering**: EngineEvent rows and legacy audit kinds, all seats, own seat included — this is an audit view, not a state view. No `isEngineEventRow`, no `actor_seat` skip.
   - The stream is the single source: the client's own audit rows come back through SSE after their `POST /events` lands, so there is no local echo — a dropped fire-and-forget POST (`turnHooks.ts:478`'s `.catch(() => {})`) simply doesn't appear, same as today.
   - Backlog on open: hydrate recent history via the existing `api.getEvents(name, 0)` tail-trimmed to the buffer, so the panel isn't empty on first reveal; live frames append after it (dedupe by row `id` covers the catch-up/live overlap).
   - Renders rows newest-last, monospace: `#id · created_at · kind · payload summary`; auto-scroll unless the user scrolled up; pause + clear controls. DOM via the shared menu primitives (`openCenteredModal` / `menu.ts`), same posture as the dev console but user-facing.
   - Visibility driven by `settings().showLogPanel` + `subscribeSettings`; the buffer only fills while the setting is on. Hidden by default.
   - Deliberately **not** an extension of the dev `EventLog` (`src/debug/eventLog.ts`): its `LogSource` union (`"bus" | "hook"`) and console filters stay untouched; the panel owns a small standalone buffer. (Rejected alternative: widening `LogSource` with a `"server"` value — couples a user feature to a debug tool.)

## Implementation order

1. Migration + notifier + unit test (callback dispatch with a fake client; migration exercised via the existing `test/migrations/` pattern).
2. SSE route + integration test: insert via `eventRepo.append` against the test DB, assert frames arrive; assert catch-up replay from `after`; assert 404/400 paths.
3. Client transport + `mp:logRow` fan-out + `test/io` unit for frame-parse → `applyRows` wiring.
4. Settings flag (`showLogPanel`) + settings-menu toggle.
5. `LogPanel` module + unit test (ring-buffer cap, `mp:logRow` subscription, backlog hydrate + id-dedupe) via the existing `test/screens/**` pattern.
6. `test:multiplayer` run; manual two-browser check (cross-client move latency well under a second; both browsers' panels show both seats' rows).
7. Docs: `docs/multiplayer.md` (the "All sync is HTTP polling" paragraph) and architecture-doc pointers.

## Validation

- `npm run build` clean; `npm run test:all` green, including the new unit tests.
- `test:multiplayer` passes with SSE enabled — the harness boots the real API, and `.env.test` must keep the notifier's LISTEN connection pinned to `127.0.0.1` like every other test DB path.
- Manual: `curl -N "http://127.0.0.1:$API_PORT/api/games/<name>/events/stream?after=0"` streams frames; a move in browser A appears in browser B sub-second; `docker stop game_db` shows reconnect backoff, `docker start` recovers.
- Panel manual checks: toggle on in Settings → panel appears and persists across reload (localStorage); opening hydrates backlog; a move in browser A appends to browser B's panel sub-second and vice versa (both seats' rows, own included); buffer caps at 500; clear/pause work; toggle off hides the panel and stops buffering.
- No visual-baseline regeneration (no render-path change; the panel and settings toggle are DOM-only).

## Risks

- **PGHOST at the shared gameserver:** LISTEN against it would be a cross-worktree hazard. Mitigated by the same `.env.test` pinning tests already rely on; dev machines point at the local container per AGENTS.md.
- **One LISTEN connection per API process** — trivial today (one process per worktree); becomes N under horizontal scale, which is precisely the future Kafka plan's cue.
- **Proxy buffering** in front of a deployed API — `X-Accel-Buffering: no` + heartbeats; verify at deploy time.
- **CORS for `EventSource`:** `app.use(cors())` already covers it; credentials are unused today, so no `withCredentials` concerns.
- **SSE + poll race duplicates:** bounded by cursor advance + `noop` outcomes; worst case a redundant resync.
- **`mp:logRow` bus volume:** one event per streamed row, including this client's own audit rows and legacy kinds — negligible at a turn-based game's rate, and the panel's ring buffer caps memory regardless. Subscribers that filter nothing must stay O(1) per event.
