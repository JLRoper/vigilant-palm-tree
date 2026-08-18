import {
  SERVER_ENTITY_ID,
  clientEntityId,
  deriveLinkStatus,
  type ClientTelemetryReport,
  type NetworkEntity,
  type NetworkLink,
  type NetworkTopologySnapshot,
  type PlayerId,
} from "@heroes/contracts";

// In-memory, per-process, non-persisted presence + telemetry for the dev
// Network Map overlay (issue #51, plan/2026-08-17-issue-51-network-map.md §2).
//
// This is deliberately NOT a table: it is ephemeral debug data, it must not
// survive a restart, and it must never touch the `games` row shape or any
// existing persistence path. The server has no other notion of a "connected
// client" -- it only ever knows that a row was read or written -- so presence
// here means "this player reported a poll within STALE_AFTER_MS".

/** One client's report of a single poll attempt, stamped on arrival. */
export interface ClientTelemetrySample extends ClientTelemetryReport {
  /** Server-side epoch ms, set by the registry rather than trusted from the client. */
  receivedAt: number;
}

/**
 * How long a client stays in the topology after its last report. Three times
 * the 2s client poll interval, so a single dropped poll doesn't flap a node
 * out of the map.
 */
export const STALE_AFTER_MS = 6_000;

/** How many recent attempts the rolling poll-failure rate is computed over. */
export const FAILURE_WINDOW = 10;

const SERVER_LABEL = "Dedicated Server";

interface PlayerTelemetry {
  playerId: PlayerId;
  label: string;
  /** Fixed-capacity ring of the last FAILURE_WINDOW samples, oldest first. */
  ring: ClientTelemetrySample[];
}

// Keyed by the raw numeric PlayerId, not the graph node id -- the string form
// is produced once, at snapshot time, by clientEntityId().
const games = new Map<string, Map<PlayerId, PlayerTelemetry>>();

export function recordSample(gameName: string, sample: ClientTelemetrySample): void {
  let players = games.get(gameName);
  if (!players) {
    players = new Map<PlayerId, PlayerTelemetry>();
    games.set(gameName, players);
  }
  let entry = players.get(sample.playerId);
  if (!entry) {
    entry = { playerId: sample.playerId, label: sample.label, ring: [] };
    players.set(sample.playerId, entry);
  }
  // Latest label wins -- a player can rename between polls.
  entry.label = sample.label;
  entry.ring.push(sample);
  if (entry.ring.length > FAILURE_WINDOW) {
    entry.ring.splice(0, entry.ring.length - FAILURE_WINDOW);
  }
}

/**
 * Drops players whose newest sample is older than STALE_AFTER_MS, and drops
 * the game entirely once no players remain. Called lazily on read: at this
 * scale (a handful of players per game) a background sweep buys nothing.
 */
function pruneStale(players: Map<PlayerId, PlayerTelemetry>, now: number): void {
  for (const [playerId, entry] of players) {
    const newest = entry.ring[entry.ring.length - 1];
    if (!newest || now - newest.receivedAt > STALE_AFTER_MS) {
      players.delete(playerId);
    }
  }
}

/** Rolling poll-failure rate over the ring, as a percentage. See NetworkLink.packetLossPct. */
function failureRatePct(ring: ClientTelemetrySample[]): number {
  if (ring.length === 0) return 0;
  const failures = ring.reduce((n, s) => (s.ok ? n : n + 1), 0);
  return (failures / ring.length) * 100;
}

/** RTT of the newest *successful* sample, or null when the ring holds no successes. */
function latestOkRttMs(ring: ClientTelemetrySample[]): number | null {
  for (let i = ring.length - 1; i >= 0; i--) {
    if (ring[i].ok) return ring[i].rttMs;
  }
  return null;
}

/**
 * Bytes/sec proxy: the newest successful poll's response size spread over the
 * client poll interval. Null when there is no successful sample to size.
 */
function bandwidthBytesPerSec(ring: ClientTelemetrySample[], pollIntervalMs: number): number | null {
  for (let i = ring.length - 1; i >= 0; i--) {
    if (ring[i].ok) return (ring[i].responseBytes * 1000) / pollIntervalMs;
  }
  return null;
}

export interface SnapshotOptions {
  /** Client poll cadence used for the bandwidth proxy; matches MultiplayerSync's default. */
  pollIntervalMs?: number;
  /** Injectable clock, so tests can drive staleness without sleeping. */
  now?: number;
}

/**
 * Builds the current topology for one game: the single dedicated-server node
 * plus one client node per live player, and one link per client. Star
 * topology -- every client talks directly to the one API process, so there is
 * no routing path to compute.
 */
export function getSnapshot(gameName: string, options: SnapshotOptions = {}): NetworkTopologySnapshot {
  const now = options.now ?? Date.now();
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const players = games.get(gameName);
  if (players) {
    pruneStale(players, now);
    if (players.size === 0) games.delete(gameName);
  }

  const entities: NetworkEntity[] = [
    { id: SERVER_ENTITY_ID, type: "dedicated-server", label: SERVER_LABEL, lastSeenAt: now },
  ];
  const links: NetworkLink[] = [];

  for (const entry of players?.values() ?? []) {
    const newest = entry.ring[entry.ring.length - 1];
    const nodeId = clientEntityId(entry.playerId);
    entities.push({
      id: nodeId,
      type: "client",
      label: entry.label,
      lastSeenAt: newest.receivedAt,
    });
    const rttMs = latestOkRttMs(entry.ring);
    const packetLossPct = failureRatePct(entry.ring);
    links.push({
      fromId: nodeId,
      toId: SERVER_ENTITY_ID,
      rttMs,
      packetLossPct,
      bandwidthBytesPerSec: bandwidthBytesPerSec(entry.ring, pollIntervalMs),
      status: deriveLinkStatus(rttMs, packetLossPct),
    });
  }

  return { gameName, capturedAt: now, entities, links };
}

/** Test/dev hook: wipe all recorded presence. Never called by request handling. */
export function resetRegistry(): void {
  games.clear();
}
