# LAN Multiplayer (Host on Local Network)

## Goal
Add a "Multiplayer" mode where one player hosts the game (runs the API + DB) on their machine and other players join from other machines on the same LAN. Each player controls their own hero/settlements; turns are serial, server-authoritative.

## Recommended design (one-paragraph)
Turn-based LAN multiplayer that reuses the existing HTTP API as the authoritative source of truth. The host runs `npm run dev` with the API bound to `0.0.0.0`. A joiner opens the host's `CLIENT_PORT` URL in their browser, picks the game from a lobby, and is assigned a `Player.id` by the host. Every client polls `GET /games/:name` every ~2 s while not on their turn (so a joiner sees turn changes, hero moves, captures, battles). On their own turn the client uses the existing `TurnController` (client-side prediction) and the existing `apiFetch` mutations (`spend_movement`, `transfer`, `trade`, `resolve-battle`, `end-turn`). No WebSocket; no new dependency.

This works because `routes.ts` already serializes actions through Postgres transactions with optimistic concurrency checks (`active_player_id` mismatch → 409), and `applyEndOfTurnDetailed` is re-run server-side to keep DB drift-safe. The only missing piece is (a) API bind to LAN, (b) per-player identity, (c) a lobby.

## Locked decisions

1. **Networking model**: HTTP only. Polling, not push. Adds no dependency. Aligns with `scripts/ports.ps1`'s existing-but-unused `WS_PORT=4100` slot which we leave for a later milestone if a push layer is ever wanted.
2. **Authoritative layer**: server (Postgres + Express), same as today. Client keeps using `TurnController` for local prediction; UI reconciles on the next poll.
3. **Player identity**: each human joiner gets one `Player.id` from the host's lobby. The client knows its own `playerId` (in memory + `localStorage` keyed by game name).
4. **`Player.faction` model**: keep the literal `"player"` string but stop treating it as "must be id 0". Generalize the codebase from "the player" → "the local player's id". AI remains `"ai"`. Any number of `"player"`-faction players is allowed.
5. **Turn gating**: server rejects actions when `hero.ownerId !== row.active_player_id` (already enforced by `routes.ts` for AI; needs the same explicit gate for non-active humans).
6. **Host bind**: API bound to `0.0.0.0` for LAN multiplayer. Guard with an explicit env flag so single-machine dev stays on `127.0.0.1` by default.
7. **Discovery**: manual. Joiner types the host's LAN URL (or scans a QR code the host shows). Defer mDNS / UDP broadcast to a follow-up.
8. **Lobby**: host creates a game with N human slots (N from 2 to 4, current `playerCount` chip repurposed). Game sits in a `lobby` state until all slots claim an identity. Host clicks "Start" to begin (or auto-starts when full).
9. **Save game / auth**: out of scope. LAN multiplayer games are still keyed by game name in the shared DB; "Sign In" is unchanged. Per-player auth for LAN is a separate feature.
10. **Map**: unchanged. `GameMap(seed, mapSize)` is deterministic; both clients generate the same map from the same seed.

## Affected boundaries

### Server
- `server/index.ts` — bind to `0.0.0.0` when `LAN_HOST=1` (default off for single-machine dev). CORS already permissive.
- `server/routes.ts`:
  - `POST /games` — accept `lobby: { seats: number; humanSlots: number }` and persist `lobby` jsonb column (new migration). Reject if `humanSlots < 1`.
  - `GET /games/:name` — already returns full game; add `lobby` and a derived `availableSeats` field (seat ids not yet claimed).
  - `POST /games/:name/lobby/claim` (new) — body `{ seat: number, handle: string }`; assigns that seat's `Player.id` to the joiner, sets `Player.faction = "player"`, writes `displayName`. Returns the updated game. Refuses if seat already claimed, game not in lobby, or game has started.
  - `POST /games/:name/lobby/start` (new) — host only; flips state from lobby → started (sets `active_player_id` to seat 0 if not set, persists). Refuses if not all seats claimed.
  - `PATCH /games/:name` (spend_movement path), `POST /games/:name/transfer`, `POST /games/:name/trade`, `POST /games/:name/resolve-battle` — add explicit guard: `hero.ownerId === row.active_player_id` (server is already authoritative on `active_player_id`; this is the per-player-permission gate). Return `403 forbidden_not_your_turn` otherwise.
  - `POST /games/:name/end-turn` — already checks `incomingState.activePlayerId !== row.active_player_id`; works as-is for any active player.
- `server/migrations/008_lobby.sql` (new) — `ALTER TABLE games ADD COLUMN lobby jsonb NOT NULL DEFAULT '{}'::jsonb;`. Lobby shape: `{ seats: number; humanSlots: number; claimed: Record<seatIndex, { handle: string; claimedAt: string }> }`. `seatIndex === Player.id`.
- No change to `auth.ts` — LAN games skip sign-in.

### Shared types / state
- `src/state/gameState.ts` — extend `Faction = "player" | "ai"` is already correct; just stop hardcoding id 0 as "the player". `defaultPlayers()` is only used by the legacy starter path; keep it untouched. New helper `isHuman(p: Player): boolean` (`p.faction === "player"`) so call sites don't compare strings directly.
- Update callers that currently special-case id 0:
  - `src/managers/GameActions.ts:62` — gate on `localPlayerId(state)`, not `phase.playerId === id 0`.
  - `src/views/hud.ts:75` — gate on local player.
  - `src/views/heroRosterMenu.ts:86` — same.
  - `src/views/settlementInfoMenu.ts:317` — same.
  - `src/state/gameState.ts:299` (`selectHero`) — same.
  - `src/entities/hero.ts:235` — `factionForOwner` already returns `"player"` for `"player"`; fine.
- Add a `localPlayerId` derivation: `getLocalPlayerId(state): PlayerId | null` = the seat the current browser owns (from in-memory state set at lobby claim / join). Persist it in `localStorage` keyed by game name so a page reload restores identity.

### Game init
- `src/game/initState.ts:59` — replace `i === 0 ? "player" : "ai"` with a parameter `{ humanSeatCount: number }`. Seats `0..humanSeatCount-1` get `faction: "player"`, the rest `faction: "ai"`. Carry through `BuildInitialOptions`, `HydrateOptions`, `buildInitialGameState`, and the two `makeInitialStatePayload` call sites used by the server (`routes.ts:187`) and the starter path.
- `src/managers/GameSessionManager.ts:92` — `handleNewGame` takes `humanSeatCount` from the new-game screen and forwards it.
- `src/players/seats.ts` (new) — helper `assignSeats(state): { seatPlayers: Player[] }` re-tags the requested number of seats from `"ai"` → `"player"` if the host created a single-player game but now wants LAN (only used in lobby creation path).

### UI / UX
- `src/views/homeView.ts` — add a "Multiplayer" big button next to "New Game" / "Load Game". Opens a new sub-modal with three actions:
  1. **Host** — generate `lan://<host>/<gameName>` and a QR code (use a tiny inline SVG QR generator, ~3 kB, or `qrcode` npm dep if acceptable; default to inline to keep deps flat). Show the LAN URL prominently, plus the local `http://<lan-ip>:<CLIENT_PORT>` text fallback. Auto-creates the game in lobby state with the chosen seat count.
  2. **Join** — input "Host address" (defaults to `http://<detected-lan-ip>:5173` if `window.location` is reachable) + "Game name" + "Your handle". On submit, calls `POST /games/:name/lobby/claim`.
  3. **Start** (host only, visible when seats are filled) — calls `POST /games/:name/lobby/start`.
- `src/views/multiplayerLobby.ts` (new) — modal showing seat grid: each seat shows handle or "Open". Seat colors pulled from `PLAYER_COLORS` (already in `initState.ts`). Re-renders on every poll.
- `src/views/newGameScreen.ts` — add a "Players" selector (2–4) labeled "Number of human players" instead of the current "Number of players". Single-player legacy flow still works (defaults to 1 human).
- `src/views/hud.ts` — when local player's `phase.kind !== "PLAYER_TURN"`, show a top banner: "Waiting for <otherPlayerName>'s turn… (Round N, Day D)". Use the existing `bus.emit` event channel to update names.
- `src/views/menu.ts:241` (`openCenteredModal`) is reused for the new modals.

### Polling
- `src/io/multiplayerSync.ts` (new) — `class MultiplayerSync`:
  - `start(gameName, intervalMs = 2000)` — calls `api.getGame(gameName)`; diffs `active_player_id`, `round`, `day`, `heroes`, `settlements`, `players` against the current `GameState`. Emits `bus.emit({ type: "mp:stateChanged", diff })`.
  - `stop()` — clears interval. Called when the local player ends their own turn (so they don't overwrite their own predicted state) and re-armed when the active player id changes away from them.
- Wire into `TurnControllerHooks.onHumanTurnEnd` so it stops on local end-turn and starts again when the server returns the new `activePlayerId`.
- On poll diff: if the local player's id appears in a settlement ownership change / hero capture they didn't initiate, animate the change rather than snapping (start with a snap; animation is a polish follow-up).

### Dev environment / scripts
- `vite.config.ts` — already binds to `0.0.0.0` (`server.host` and `preview.host`). Good for LAN access of the client. Keep.
- `server/index.ts` — bind `LAN_HOST=1` → `0.0.0.0`; otherwise keep `127.0.0.1`.
- `.env.example` (or AGENTS.md note) — add `LAN_HOST=0` default; instruct host to set `LAN_HOST=1` and `npm run dev`.
- `scripts/ports.ps1` — no change. `WS_PORT` slot is dormant; leave it. `CLIENT_PORT` is already served on `0.0.0.0`.
- `scripts/dev-status.ps1` — extend the report so the host sees their LAN URLs (`http://<lan-ip>:<CLIENT_PORT>`) when `LAN_HOST=1`.

### Tests
- `test/multiplayer.smoke.ts` (new) — boots two headless browsers on different contexts against the same `LAN_HOST=1` server. Drives: host creates lobby → joiner claims seat → host starts → joiner polls and sees its hero → joiner attempts an out-of-turn action and gets `403` → host takes their turn → joiner polls and sees the new state. Asserts on game JSON.
- `test/smoke.ts` — unchanged. Add a regression that the single-player path still seeds `humanSeatCount = 1`.

## Risks / open questions
1. **Map sync**: trivial because `GameMap` is deterministic, but if `castlePlacement` uses `Math.random()` anywhere outside an injected `rng` callback (verify in `src/map/castlePlacement.ts`), two clients could disagree on starting positions. Audit and pin to injected RNG before shipping.
2. **Clock skew**: none — turns are server-sequenced.
3. **Late joins / disconnects**: out of scope. A player who closes their tab forfeits their turn (server is still authoritative; AI fallback is **not** in this plan). Note in the lobby UI.
4. **Multiple browsers on the host machine**: yes, supported — each browser gets its own `localStorage` identity. The host's own seat and a joiner on the same machine both work.
5. **AI players in a multiplayer game**: keep them. A 2-human 1-AI game is allowed; only the seat count of humans matters.
6. **Auth / cheating on LAN**: server is authoritative for `spend_movement`, `transfer`, `trade`, `resolve-battle`, `end-turn`. Client-side prediction is a UX nicety, not a trust boundary. A malicious LAN peer can't cheat because every mutating endpoint validates against `row.active_player_id` and re-runs reducers.
7. **Open decision — QR vs text only**: ship text-only first (no QR dep). Add QR later if the user asks.
8. **Open decision — push (WebSocket) vs poll**: poll is the plan. Push is a clean follow-up that replaces `MultiplayerSync`'s polling loop with a `ws` subscription to `/api/ws?game=…`. Out of scope for v1.

## Out of scope (explicit)
- Internet play (only LAN; no relay / NAT traversal).
- Spectator mode.
- Reconnection / seat hand-off.
- mDNS / Bonjour discovery.
- WebSocket push layer.
- Per-player save-game ownership (`Sign In` flow untouched).
- Replays / event log UI.
- New combat, fog of war, etc. (existing deferred list unaffected).

## Validation
- `npm run build` clean.
- `npm run test:all` (existing smoke + cityView tests still pass).
- New `test/multiplayer.smoke.ts` passes.
- Manual: on Windows host with `LAN_HOST=1 npm run dev`, from a second machine on the same Wi-Fi open `http://<host-lan-ip>:5173`, click Multiplayer → Join, claim seat, host starts, each player moves on their own turn and sees the other's moves within ~2 s.
- Confirm `npm run dev:status` shows LAN URLs when `LAN_HOST=1`.
