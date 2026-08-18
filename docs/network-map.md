# Network Map — Live routing topology overlay

A dev overlay showing which clients are currently talking to the API, and how
healthy each connection is: round-trip time, poll-failure rate, and payload
throughput, with color-coded links.

Sibling to [dev-console.md](./dev-console.md) — same family of dev tools, same
"ships in `npm run build`, reachable from Developer Settings" posture.

Built for [issue #51](https://github.com/JLRoper/vigilant-palm-tree/issues/51);
design rationale in [../plan/2026-08-17-issue-51-network-map.md](../plan/2026-08-17-issue-51-network-map.md).

---

## 1. What it actually measures

**Read this before trusting a number on the overlay.** Issue #51 asked for a
P2P/relay network map with packet loss and bandwidth. heroes-js has no socket
transport — multiplayer is a 2s HTTP poll against one Express API
(`src/io/multiplayerSync.ts`). Three of the four metrics are therefore proxies,
and the overlay says so in its own subtitle:

| Field | What it really is | Real measurement? |
|---|---|---|
| `rttMs` | Wall-clock time around the existing poll `fetch` | ✅ Yes |
| `packetLossPct` | Rolling **poll-failure rate** over the client's last 10 attempts (fetch throw or non-2xx) | ❌ Proxy — HTTP exposes no per-packet loss |
| `bandwidthBytesPerSec` | Poll response's UTF-8 byte length ÷ poll interval | ❌ Proxy — not link capacity |
| `status` | Threshold classification of the two above | Derived |

The field names keep the issue's vocabulary (`packetLossPct`) so the overlay
answers the issue literally; the doc comments in
`packages/contracts/src/telemetry.ts` state what each one measures.

Likewise `NetworkEntityType` carries the issue's full node vocabulary —
`dedicated-server | client | host | peer | relay` — but **only
`dedicated-server` and `client` are ever constructed.** This project has no
host migration, no P2P mode, and no relay layer. The other three are schema-only
forward-compatibility, not a gap in the implementation.

---

## 2. Files

| File | Role |
|---|---|
| `packages/contracts/src/telemetry.ts` | Wire types, node-id helpers, `deriveLinkStatus()` thresholds |
| `server/telemetry/presenceRegistry.ts` | In-memory presence registry: ring buffer per player, staleness expiry, snapshot builder |
| `server/http/routes/telemetry.ts` | `POST`/`GET /api/games/:name/telemetry` |
| `src/io/multiplayerSync.ts` | Instruments the existing poll; emits `mp:topologyUpdated` |
| `src/screens/debug/networkMap.ts` | The overlay itself (`openNetworkMap()`, registered as view `"networkMap"`) |
| `src/screens/home/developerSettingsMenu.ts` | The "Network Map" button |

---

## 3. Presence is in-memory and per-process

The registry is a plain `Map` in the API process. **It is not a table, and it
must not become one.** Consequences worth internalising:

- It does not survive an API restart, by design. This is ephemeral debug data,
  not game state — it never touches the `games` row shape or any migration.
- A client disappears from the map ~6s (`STALE_AFTER_MS`, 3× the poll interval)
  after its last report. Expiry is checked lazily on read; there is no sweep.
- **Sharing a database does not share the map.** If you point `PGHOST` at the
  shared gameserver but run your own API, the overlay shows only the clients
  hitting *your* process. To watch the gameserver's real players, point the
  client at its API (`API_HOST`) instead. See [../.env.example](../.env.example).

---

## 4. Node identity

Graph node ids are strings so the single server node can share the `id` field
with player-backed nodes. `PlayerId` is a number everywhere else in the repo
and stays one on the wire.

```ts
SERVER_ENTITY_ID          // "server"
clientEntityId(0)         // "client:0"
playerIdFromEntityId(id)  // 0 | null   (null for "server" or a malformed id)
```

`ClientTelemetryReport.playerId` carries the **raw numeric seat**, unconverted;
the string form is produced only by `clientEntityId()`. Keep it that way. If the
client, the registry, and the snapshot builder ever disagree on the key format,
the failure mode is a silently empty graph rather than an error — which is why
the round-trip is pinned by tests in `test/net/linkStatus.test.ts`.

A client with no claimed seat has no `PlayerId`, so it reports nothing and has
no node. Every real join path sets the seat (lobby claim, session load, and the
seat-0 fallback inside `pollOnce`), so a genuine player is never missing.

---

## 5. Health thresholds

`deriveLinkStatus(rttMs, packetLossPct)` in `packages/contracts/src/telemetry.ts`:

| Status | Condition |
|---|---|
| `failing` | `rttMs === null` (no recent successful sample), or loss > 20%, or RTT > 1000ms |
| `degraded` | loss > 5%, or RTT > 300ms |
| `healthy` | otherwise |

Thresholds are a **tunable starting point**, not load-bearing on any acceptance
criterion beyond "normal, high-latency, and failing links are visually
distinguishable." Change them in one place; the constants are exported
(`LINK_DEGRADED_RTT_MS` etc.) so tests assert against the constants rather than
hard-coded numbers.

---

## 6. Usage

1. Join a multiplayer game so `MultiplayerSync` is polling — the overlay is
   driven entirely by that loop and shows "Waiting for a multiplayer poll…"
   until a snapshot arrives.
2. Open **Settings → Developer Settings → Network Map**.
3. The server node sits centre; clients ring it, one link each (star topology —
   every client talks straight to the API, so there is no path to compute).
4. **Copy JSON** puts the last 60 snapshots on the clipboard, mirroring the dev
   console's own Copy JSON button. This is the issue's "telemetry export"
   stretch goal; there is deliberately no server-side export endpoint.

The overlay redraws on each `mp:topologyUpdated` event rather than joining the
main `requestAnimationFrame` loop — the data changes once per poll, so a render
loop would redraw an identical picture ~120 times per update.

---

## 7. Bus event

```ts
interface MpTopologyUpdatedEvent {
  type: "mp:topologyUpdated";
  gameName: string;
  snapshot: NetworkTopologySnapshot;
}
```

Emitted once per poll cycle from `MultiplayerSync`, after the sample POST and
snapshot GET both resolve. Telemetry is strictly best-effort: it swallows its
own errors and must never delay or fail a poll, or affect
`mp:stateChanged` / `mp:turnStarted`.

---

## 8. Test surface

| Test | Covers |
|---|---|
| `test/server/presenceRegistry.test.ts` | Sample recording, ring-buffer eviction, rolling failure rate, staleness expiry + return, game isolation, snapshot shape |
| `test/net/linkStatus.test.ts` | Threshold boundaries (exclusive), node-id round-trip, malformed-id handling |
| `test/multiplayer.smoke.ts` | End-to-end round trip over real HTTP: empty snapshot → report → populated snapshot; 400 on malformed and on a stringly `playerId` |

Both unit files run under `npm run test:unit`. No canvas/DOM rendering tests —
consistent with `dev-console.md` §5, which unit-tests the pure log class and not
the modal.
