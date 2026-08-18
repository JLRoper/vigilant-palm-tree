// Network topology telemetry — the wire shape behind the dev Network Map
// overlay (issue #51). See plan/2026-08-17-issue-51-network-map.md for why
// several of these fields are documented proxies rather than true
// transport-level measurements: heroes-js has no socket layer, only the
// 2s HTTP poll in src/io/multiplayerSync.ts.

import type { PlayerId } from "./ids";

/**
 * The issue's full requested node vocabulary. This codebase's multiplayer is a
 * star topology against one Express API — there is no host migration, no P2P
 * transport, and no relay layer — so `host`, `peer`, and `relay` are carried
 * here for forward-compatibility only: no code path ever constructs one today.
 */
export type NetworkEntityType = "dedicated-server" | "client" | "host" | "peer" | "relay";

export type NetworkLinkStatus = "healthy" | "degraded" | "failing";

// Graph node ids are strings so the one dedicated-server node can share the
// `id` field with player-backed client nodes. PlayerId itself is a number
// (packages/contracts/src/ids.ts) and stays a number everywhere it is carried
// as a player id -- notably on ClientTelemetryReport below, which reports the
// raw seat unconverted. The string form exists only at the graph layer, and
// only via clientEntityId(), so the client, the server registry, and the
// snapshot builder cannot drift into disagreeing key formats.

/** The single dedicated-server node's id — one per API process, not per request. */
export const SERVER_ENTITY_ID = "server";

/** Prefix distinguishing player-backed node ids from `SERVER_ENTITY_ID`. */
export const CLIENT_ENTITY_ID_PREFIX = "client:";

/** The one and only way to turn a numeric PlayerId into a graph node id. */
export function clientEntityId(playerId: PlayerId): string {
  return `${CLIENT_ENTITY_ID_PREFIX}${playerId}`;
}

/** Inverse of `clientEntityId`; null for the server node or any malformed id. */
export function playerIdFromEntityId(entityId: string): PlayerId | null {
  if (!entityId.startsWith(CLIENT_ENTITY_ID_PREFIX)) return null;
  const suffix = entityId.slice(CLIENT_ENTITY_ID_PREFIX.length);
  // Number("") is 0, so an empty suffix would otherwise parse as seat 0.
  if (suffix.length === 0) return null;
  const raw = Number(suffix);
  return Number.isInteger(raw) ? raw : null;
}

export interface NetworkEntity {
  /** `SERVER_ENTITY_ID` for the dedicated server; `clientEntityId(playerId)` (e.g. `"client:0"`) for clients. */
  id: string;
  type: NetworkEntityType;
  /** Player handle, or "Dedicated Server". */
  label: string;
  /** Epoch ms of the most recent sample from this entity. */
  lastSeenAt: number;
}

export interface NetworkLink {
  fromId: string;
  toId: string;
  /** Real, client-measured wall-clock round trip around the poll fetch. Null when no recent successful sample. */
  rttMs: number | null;
  /** PROXY, not packet-level loss: the rolling poll-failure rate (fetch throw or non-2xx) over the client's last N poll attempts, as a percentage. HTTP does not expose per-packet loss. */
  packetLossPct: number;
  /** PROXY, not link capacity: the poll response's payload byte length divided by the poll interval. */
  bandwidthBytesPerSec: number | null;
  status: NetworkLinkStatus;
}

export interface NetworkTopologySnapshot {
  gameName: string;
  capturedAt: number;
  entities: NetworkEntity[];
  links: NetworkLink[];
}

/** One client's report of a single completed poll attempt. */
export interface ClientTelemetryReport {
  /** The reporting client's seat, raw and unconverted — a number, matching PlayerId everywhere else. */
  playerId: PlayerId;
  label: string;
  /** Elapsed wall-clock ms around the poll fetch — reported even when the poll failed. */
  rttMs: number;
  /** Approximate size of the poll response body in bytes; 0 for a failed poll. */
  responseBytes: number;
  /** Did this poll attempt succeed. */
  ok: boolean;
}

// Thresholds are a deliberately simple starting point, tunable rather than
// load-bearing: the acceptance criterion is only that normal, high-latency,
// and failing links are visually distinguishable.
export const LINK_FAILING_LOSS_PCT = 20;
export const LINK_FAILING_RTT_MS = 1000;
export const LINK_DEGRADED_LOSS_PCT = 5;
export const LINK_DEGRADED_RTT_MS = 300;

/**
 * Pure threshold classifier for link health. A null `rttMs` means no recent
 * successful sample at all, which counts as failing.
 */
export function deriveLinkStatus(rttMs: number | null, packetLossPct: number): NetworkLinkStatus {
  if (rttMs === null) return "failing";
  if (packetLossPct > LINK_FAILING_LOSS_PCT || rttMs > LINK_FAILING_RTT_MS) return "failing";
  if (packetLossPct > LINK_DEGRADED_LOSS_PCT || rttMs > LINK_DEGRADED_RTT_MS) return "degraded";
  return "healthy";
}
