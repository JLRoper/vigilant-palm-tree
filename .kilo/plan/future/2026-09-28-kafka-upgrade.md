# Kafka Upgrade — Postgres log → Kafka-backed fan-out (future)

**Status:** Future / not scheduled. Written 2026-09-28. Do not start until a precondition below is met.
**Preceded by:** [`../2026-09-28-sse-event-push.md`](../2026-09-28-sse-event-push.md) (SSE + Postgres LISTEN/NOTIFY). Nothing in that plan is discarded by this one: `game_events` stays the system of record, the BIGSERIAL id stays the browser's resume token, and the poll endpoint stays the outage/resume path.

## Preconditions (any one justifies starting)

1. A **second consumer class** exists that shouldn't ride the API process: analytics, achievements, matchmaking/ELO, replay recording, bots.
2. Multiple API/gateway replicas make per-process Postgres LISTEN + fan-out wasteful, or cross-region delivery is needed.
3. Retention/replay requirements exceed what the pruned `game_events` table should hold.

If none apply, the SSE plan is the correct end state — a broker for its own sake is pure operational weight.

## Context recap

- Today's log: `game_events` (append-only, BIGSERIAL cursor, `kind` discriminator, JSONB payload, `actor_seat`), written transactionally with state by `handleCommandTransactional` (`server/app/commandHandler.ts:1735-1783`).
- Today's delivery: SSE fed by `LISTEN/NOTIFY`, one LISTEN connection per API process, with 2 s polling as backstop.
- No Kafka anywhere in the repo; `kafkajs` is not a dependency today and gets added only in Phase 1–2 of this plan.

## Target architecture

```
game_events (Postgres, system of record)
  │  logical replication / CDC
  ▼
Debezium connector ──► topic: heroes.game-events   (key = game_id ⇒ per-game ordering)
                          │
            ┌─────────────┼──────────────────┐
            ▼             ▼                  ▼
   SSE/WS gateway     analytics svc     achievements svc
   consumer group     (own group)       (own group)
   "event-gateways"
            │  SSE (client contract unchanged)
            ▼
        Browser  (resumes via BIGSERIAL id; Kafka offsets are server-internal)
```

### Key decisions

- **CDC, not dual-write.** State + event already commit atomically in Postgres; producing to Kafka from app code would break that invariant and reintroduce lost-write classes of bugs. Debezium turns the existing table into the stream with zero producer-side changes. Fallback if the hosting DB doesn't permit logical replication: a `game_events_outbox` table written inside the same transaction, drained by Debezium or a poller.
- **Partition key = `game_id`.** Preserves the per-game ordering the cursor implies. Global cross-game order is required by no consumer (each browser follows one game).
- **Headers carry `game_events.id`, `kind`, `actor_seat`.** The browser-facing cursor remains the table id (monotonic, snapshot-consistent via `GET /games/:name`'s `last_event_id`); Kafka offsets are internal transport state. This is what makes the upgrade invisible to clients.
- **Client library:** `kafkajs`, first added when a server consumer exists.

## Phases

### Phase 0 — stand up the broker
- Dev/small-prod default: **Redpanda** (Kafka API, single Rust binary, no JVM/ZooKeeper; Centrifugo-verifiably compatible). Managed alternative: Confluent Cloud / MSK / Upstash. **Strimzi** on k8s only if already committed to operating Kafka itself.
- Run dev broker in docker-compose next to `game_db`; do not share across worktrees.

### Phase 1 — CDC pipeline + shadow validation
- Debezium Postgres connector on `game_events` → `heroes.game-events`. Legacy audit rows stream too; consumers filter by `kind` exactly like `isEngineEventRow` does on the client.
- Shadow consumer (kafkajs, group `shadow`): compares the Kafka id-stream per game against `max(id)` from the table; alert on drift or lag. Bake in production with zero client impact.

### Phase 2 — gateway switch behind a flag
- Gateway pods (the existing Express processes, or a later split-out `event-gateway` service) run a kafkajs consumer group `event-gateways`.
- **Routing: fan-out-on-read.** Every gateway consumes all partitions and forwards only rows for games with a connected SSE client on that pod. Chosen over a routing registry (Redis `game_id → pod`) because at this scale duplicated reads are cheap and a registry is a second stateful thing to operate. Revisit only when `partitions × replicas` makes duplicate reads a real cost.
- Flag flips per deployment; fallback is instantaneous — the browser only ever knew the SSE/poll contract. **The GET poll endpoint is never removed**: it is the resume path after any outage.

### Phase 3 — second consumers onboard
- Analytics/achievements/etc. join with their own consumer groups, a DLQ topic, and consumer-lag monitoring.

### Phase 4 — optional transport upgrade
- Only if bidirectional push is ever needed, add WebSocket (the dormant `WS_PORT` contract) behind the same gateway. SSE remains sufficient while events stay one-way.

## Operational notes

- **Retention:** 7–30 days on the topic; the table remains the durable/replayable record with its own pruning policy.
- **Delivery:** at-least-once — safe because `applyEngineEvent` is idempotent (`noop` on already-applied deltas) and gateways dedupe by `game_events.id` per connection.
- **Monitoring:** consumer lag per group, CDC connector state, per-partition skew (a hot `game_id`).
- **Honest cost note:** one broker is one more stateful thing to patch, monitor, and secure — which is why preconditions gate this plan.

## Rollback

Flag off → gateways return to LISTEN/NOTIFY + poll; CDC keeps running harmlessly as a shadow. Nothing to undo: Kafka holds only derived data.

## Explicit non-goals

- No rewrite of `applyRows`/`applyEngineEvent`; no schema change to `game_events`; no browser-side broker library (browsers never talk to Kafka directly); no removal of the HTTP endpoints.
