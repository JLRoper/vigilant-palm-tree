# Issue #51 — Network Map (routing topology between entities during gameplay)

**Date:** 2026-08-17
**Source:** [#51](https://github.com/JLRoper/vigilant-palm-tree/issues/51)

## Background

Issue #51 asks for a real-time visual network map: nodes for Dedicated Server / Host / P2P clients / Relays, directional routing links, RTT/packet-loss/bandwidth overlays, color-coded health, a dev-toggle, and optional telemetry export.

**This does not match heroes-js's actual networking model.** There is no socket-level transport, no host-migration or P2P mode, and no relay layer:

- Multiplayer is a single Express+Postgres HTTP API (`server/routes.ts`, `server/http/routes/commands.ts`) that every client talks to directly.
- Each client polls `GET /api/games/:name` every 2s (`src/io/multiplayerSync.ts`, `MultiplayerSync.pollOnce`) and diffs the result; commands are `POST /api/games/:name/commands`.
- `AGENTS.md` confirms `WS_PORT` is allocated but dormant — reserved for "a future realtime layer" that doesn't exist yet.
- There is no server-side concept of a connected client (no socket registry, no heartbeat/presence tracking) — the server only knows a row was read or written, never who's currently online.

Per explicit user instruction, this plan builds the issue **literally** — the full node-type vocabulary (dedicated-server / host / peer / relay), routing links, RTT, packet-loss, bandwidth, color-coded health, toggle, and export — rather than silently rescoping it to "just show my one poll timer." Since real host/peer/relay topology doesn't exist in this codebase, those node types are built as a real, generic schema and renderer that today only ever populates with the two node types that are real (`dedicated-server`, `client`) — not faked data. Packet loss and bandwidth are not observable at the HTTP layer the way they would be over raw sockets, so this plan defines explicit proxy metrics (documented below) rather than pretending to measure things the transport doesn't expose.

## Scope decisions (read before implementing)

1. **Entities.** `dedicated-server` = the single Express API process (always exactly one node, id = the API's own identity, not per-request). `client` = one node per player currently polling the lobby's game (see presence, below). `host` and `peer` node types are defined in the schema/type union for forward-compatibility with the issue's vocabulary, but **no code path ever constructs one** — this project has no host-migration or P2P mode. `relay` is likewise schema-only. Document this explicitly in the code (one line, on the type union) so it doesn't read as an oversight later.
2. **Presence (who counts as "connected").** The server has no persistent knowledge of connected clients today. Add a lightweight **in-memory, per-process, non-persisted** presence/telemetry registry (see §2) — not a DB table. This is ephemeral debug data, not game state; it must not survive a server restart and must not affect `games` row shape or existing persistence paths.
3. **RTT.** Measured client-side, real: wall-clock time around the existing poll `fetch` in `MultiplayerSync.pollOnce`. This is a genuine measurement, not a proxy.
4. **Packet loss.** HTTP doesn't expose per-packet loss. Proxy: rolling failure rate over the last N poll attempts (fetch throw or non-2xx) per client, reported as a percentage. Label it "poll failure rate" in code/types, but keep the wire/UI field name `packetLossPct` to satisfy the issue's literal ask — the doc comment on the field must say what it actually measures.
5. **Bandwidth.** Proxy: response payload byte length (from the poll response body) divided by the poll interval, per client. Field name `bandwidthBytesPerSec`, again documented as a proxy in a one-line comment.
6. **Routing links.** Since every client talks directly to the one dedicated-server node (star topology, no mesh), each client node gets exactly one edge to the server node. No routing-path computation is needed or should be built.
7. **Update cadence.** Reuse the existing 2s poll cadence already in `MultiplayerSync` rather than inventing a second timer — the network map is exactly as "real-time" as the existing sync loop.

## §1 — Shared telemetry types

New file `packages/contracts/src/telemetry.ts` (mirrors the existing per-domain file layout in `packages/contracts/src`, e.g. `settlement.ts`, `castle.ts`):

```ts
export type NetworkEntityType = "dedicated-server" | "client" | "host" | "peer" | "relay";
// host/peer/relay are part of the issue's requested vocabulary; this codebase has no
// host-migration or P2P transport, so no code path ever constructs those three types today.

export type NetworkLinkStatus = "healthy" | "degraded" | "failing";

// Node ids are strings so the single dedicated-server node can share the `id` field
// with player-backed client nodes. PlayerId itself is a number (contracts/src/ids.ts)
// and stays a number wherever it is carried as a player id -- see ClientTelemetryReport
// in §2. The string form exists only at the graph layer, and is produced only by
// clientEntityId(), so client / server registry / snapshot builder cannot drift into
// disagreeing key formats (which would yield a silently empty graph, not an error).
export const SERVER_ENTITY_ID = "server";
export const CLIENT_ENTITY_ID_PREFIX = "client:";
export function clientEntityId(playerId: PlayerId): string;   // 0 -> "client:0"
export function playerIdFromEntityId(id: string): PlayerId | null;  // inverse; null for "server"

export interface NetworkEntity {
  id: string;               // SERVER_ENTITY_ID, or clientEntityId(playerId) e.g. "client:0"
  type: NetworkEntityType;
  label: string;             // player handle, or "Dedicated Server"
  lastSeenAt: number;        // epoch ms
}

export interface NetworkLink {
  fromId: string;
  toId: string;
  rttMs: number | null;              // real, client-measured
  packetLossPct: number;             // proxy: rolling poll-failure rate, see plan doc
  bandwidthBytesPerSec: number | null; // proxy: response bytes / poll interval, see plan doc
  status: NetworkLinkStatus;         // derived from thresholds, see §4
}

export interface NetworkTopologySnapshot {
  gameName: string;
  capturedAt: number;
  entities: NetworkEntity[];
  links: NetworkLink[];
}
```

Export from `packages/contracts/src/index.ts` alongside the other domain exports.

## §2 — Server: in-memory presence/telemetry registry

New file `server/telemetry/presenceRegistry.ts`. Plain in-memory `Map<gameName, Map<PlayerId, ClientTelemetrySample>>` (keyed by the numeric seat, not the `client:N` graph id), no DB. A sample expires (is dropped from the map) if not refreshed within a staleness window (e.g. 3x the poll interval, 6s) — checked lazily on read, no background sweep needed at this scale.

```ts
interface ClientTelemetrySample {
  playerId: PlayerId;   // number, raw and unconverted -- NOT the "client:N" graph id
  label: string;
  rttMs: number;
  responseBytes: number;
  ok: boolean;         // did this poll succeed
  receivedAt: number;   // epoch ms, server-side
}

export function recordSample(gameName: string, sample: ClientTelemetrySample): void;
export function getSnapshot(gameName: string): NetworkTopologySnapshot; // builds entities+links from live samples, folds in the rolling failure-rate window per player
```

Rolling failure rate needs a short history per player (last ~10 samples), not just the latest — keep a small fixed-size ring per `playerId` inside the registry (same ring-buffer idea as `EventLog` in `src/debug/eventLog.ts`, much smaller capacity).

New route, mounted next to the other per-game routes in `server/routes.ts`:

```
POST /api/games/:name/telemetry   { playerId, label, rttMs, responseBytes, ok }  -> 204
GET  /api/games/:name/telemetry   -> NetworkTopologySnapshot
```

Keep this as its own small router file (`server/http/routes/telemetry.ts`) mounted via `router.use("/games/:name/telemetry", telemetryRouter)` (unprefixed here on purpose — `server/index.ts` mounts the whole router at `/api`, so the live paths are `/api/games/:name/telemetry`), matching the existing `commandsRouter` mounting pattern — not inlined into the already-large `routes.ts`.

## §3 — Client: instrument the existing poll loop

Extend `MultiplayerSync.pollOnce` (`src/io/multiplayerSync.ts`) — do not add a second timer:

1. Wrap the existing `api.getGame(gameName)` call with `performance.now()` before/after to get real RTT.
2. On success, compute the response's approximate byte size (`new TextEncoder().encode(JSON.stringify(game)).length` — UTF-8 bytes, since `String.length` counts UTF-16 code units and under-reports any non-ASCII payload; exact `Content-Length` still isn't available through the existing `api.getGame` wrapper without changing its return type, and this is a debug-only proxy metric per §Scope-decisions item 5).
3. Fire-and-forget `POST /api/games/:name/telemetry` with the sample (own player id from `getInMemoryLocalPlayerId`, RTT, byte size, `ok`). On fetch failure, still report `ok: false` with `rttMs: null`-equivalent (use the elapsed time up to the failure).
4. This report must not block or affect the existing `mp:stateChanged` / `mp:turnStarted` emission — telemetry reporting is best-effort and swallows its own errors (`.catch(() => {})`), same posture as the existing `console.warn` on poll failure.
5. Also fetch the aggregated `GET /api/games/:name/telemetry` snapshot once per poll cycle (can piggyback on the same `pollOnce` tick) and emit a new bus event:

```ts
export interface MpTopologyUpdatedEvent {
  type: "mp:topologyUpdated";
  gameName: string;
  snapshot: NetworkTopologySnapshot;
}
```

## §4 — Health thresholds

Small pure function, `deriveLinkStatus(rttMs, packetLossPct): NetworkLinkStatus`, colocated with the contracts type or in a small `src/net/linkStatus.ts`:

- `failing`: packetLossPct > 20% OR rttMs > 1000 OR rttMs === null (no recent successful sample)
- `degraded`: packetLossPct > 5% OR rttMs > 300
- `healthy`: otherwise

Pure, unit-testable in isolation — no DOM/canvas dependency. Thresholds are a starting point; call this out as tunable, not load-bearing on any acceptance criterion beyond "clear visual cues distinguish normal from high-latency/failing links."

## §5 — Visualization: `src/screens/debug/networkMap.ts`

New debug screen, registered via the existing `registerView`/`launchView` pattern (`src/screens/shared/viewLauncher.ts`, same pattern `developerSettingsMenu.ts` and `testBattleSetup` already use).

- Simple canvas or absolutely-positioned DOM star layout: one dedicated-server node centered, client nodes arranged in a circle around it (no force-directed layout needed — star topology per §Scope-decisions item 6 makes that overkill).
- Each node: label (handle or "Dedicated Server"), small status dot.
- Each edge: line colored by `NetworkLinkStatus` (green/yellow/red per the issue's acceptance criterion #2), with `rttMs` / `packetLossPct` / `bandwidthBytesPerSec` text near the midpoint.
- Subscribes to `bus.on("mp:topologyUpdated", ...)` and redraws on each event — satisfies acceptance criterion #1 (dynamic updates as entities connect/disconnect), driven by the registry's staleness expiry (§2) removing stale entities from the snapshot.
- No new render loop — this is a modal/overlay drawn on its own redraw-on-event basis, not integrated into the main `requestAnimationFrame` loop.

## §6 — Toggle

Add a "Network Map" button to `src/screens/home/developerSettingsMenu.ts`, following the exact pattern already used there for `testBattleBtn` / `devConsoleBtn` (`modal.close()` then `setTimeout(() => launchView("networkMap"), 100)`). Satisfies acceptance criterion / requirement "In-Game / Dev Overlay Toggle."

## §7 — Export (stretch, per issue's "optional/stretch goal")

A "Copy JSON" button on the network map screen, mirroring `openDevConsole`'s existing Copy JSON button (`src/debug/devConsole.ts`) — dumps the current `NetworkTopologySnapshot` (or a short rolling history buffer of snapshots, same ring-buffer idea as `EventLog`) to the clipboard. Do not build a server-side export/download endpoint — clipboard copy matches the existing dev-tool convention in this repo and satisfies the stretch goal without new server surface.

## Out of scope

- Any real socket/WS transport, host-migration, or P2P mode — `WS_PORT` stays dormant per `AGENTS.md`; this plan does not touch it.
- True packet-level loss/bandwidth measurement — not observable over `fetch`; proxies are defined and documented in §Scope-decisions, not hidden.
- Persisting telemetry to Postgres — presence/telemetry is in-memory and ephemeral by design (§2); it must never touch the `games` table or its migrations.
- Multi-hop routing / relay path computation — topology is a star (client ↔ server only); no pathfinding needed.
- Production enablement — this is a dev/debug overlay in the same family as the existing Dev Console and Asset Manager; no requirement to gate it out of production builds beyond what those already do (they ship in `npm run build` per `docs/dev-console.md`).

## Suggested order

1. §1 shared types (`packages/contracts/src/telemetry.ts`) — no runtime behavior, unblocks everything else.
2. §2 server presence registry + `POST`/`GET /api/games/:name/telemetry` routes, with unit tests on `presenceRegistry.ts` directly (ring buffer eviction, staleness expiry) — no HTTP needed for these tests.
3. §3 client instrumentation of `MultiplayerSync.pollOnce` + new `mp:topologyUpdated` bus event.
4. §4 `deriveLinkStatus` as a small pure/unit-tested function, landed alongside §2 or §3 (no ordering dependency).
5. §5 the `networkMap` screen, consuming the bus event.
6. §6 the Developer Settings toggle button.
7. §7 clipboard export, once §5 exists.

## Tests

- `test/server/presenceRegistry.test.ts` (or under wherever `server/telemetry/` tests land): sample recording, ring-buffer rolling failure rate, staleness expiry, snapshot shape.
- `test/net/linkStatus.test.ts`: threshold boundaries for `deriveLinkStatus`.
- Extend `test/multiplayer.smoke.ts` (already exercises the poll loop end-to-end) with an assertion that a telemetry sample round-trips: after one `pollOnce()`, `GET /api/games/:name/telemetry` includes the calling client with a non-null `rttMs`.
- No canvas/DOM rendering tests — out of line with this repo's existing test surface (`docs/dev-console.md` §5 only unit-tests the pure log class, not the modal rendering).
