import type { Terrain } from "../map/terrain";
import type { ResourceType } from "../map/resourceTiles";
import type {
  ClientTelemetryReport,
  HeroState,
  NetworkTopologySnapshot,
  Player,
  SettlementState,
} from "@heroes/contracts";
import { getCachedAuth } from "./authStorage";

export type {
  GameState,
  HeroState,
  Player,
  SettlementState,
} from "@heroes/contracts";

export type EnemyPos = { q: number; r: number };

// One seat's server-side presence snapshot (drop policy, shipped
// 2026-09-27) -- mirrors the `presence` entry shape in server/routes.ts's
// LobbyState and src/core/events.ts's MpSeatPresence.
export type SeatPresence = { lastSeenAt: string; connected: boolean };

// The games row's lobby jsonb, as clients see it off GET /games/:name.
// Structurally mirrors server/routes.ts's LobbyState (kept as a separate
// client-side type: io/ cannot import server code, and the engine package
// doesn't carry lobby shapes).
export type GameLobbyState = {
  seats?: number;
  humanSlots?: number;
  claimed?: Record<string, { handle: string; email?: string; claimedAt: string }>;
  startedAt?: string;
  // Disconnected-seat signal, keyed by seat index; written by the server on
  // connected<->disconnected transitions. Seats with no entry have not
  // transitioned -- absence reads as "nothing to flag".
  presence?: Record<string, SeatPresence>;
};

export type Game = {
  id: number;
  name: string;
  seed: number;
  hero_q: number;
  hero_r: number;
  turn: number;
  gold: number;
  enemy_positions: EnemyPos[];
  created_at: string;
  updated_at: string;
  round: number;
  day: number;
  active_player_id: number;
  map_size?: "small" | "medium" | "large";
  players: Player[];
  heroes: Record<string, HeroState>;
  settlements: Record<string, SettlementState>;
  // Newest game_events.id at the moment this snapshot was read (#146). Only
  // GET /games/:name returns it; the list route and the command responses
  // don't, hence optional. String because it's a BIGSERIAL over the wire.
  last_event_id?: string;
  // Only GET /games/:name returns it (same as last_event_id): the lobby
  // column carries seat claims, startedAt, and drop-policy presence.
  lobby?: GameLobbyState;
};

// One row of GET /games/:name/events. Raw DB shape (snake_case, id and
// actor_seat straight off the row) -- `payload` is the persisted EngineEvent
// for the engine kinds and a bespoke audit blob for the legacy
// turn_ended/round_ended/round_started/ai_turn_started kinds, so it stays
// unknown here and is narrowed at the point of use. Which kinds the client
// admits as engine events is owned by ENGINE_EVENT_KINDS in
// src/io/multiplayerSync.ts.
export type GameEventRow = {
  id: string;
  kind: string;
  payload: unknown;
  actor_seat: number | null;
  created_at: string;
};

export type TileRow = {
  q: number;
  r: number;
  terrain: Terrain;
  resource: ResourceType | null;
};

const BASE = "/api";
const DEFAULT_TIMEOUT_MS = 10_000;

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`request timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

// Attaches the cached session token to every request that doesn't already
// carry an explicit Authorization header -- src/io/auth.ts's own
// checkSession()/logout() pass a specific token as an explicit header (e.g.
// while verifying a not-yet-cached token), and that must win over whatever
// happens to be cached.
function withCachedAuth(init: RequestInit): RequestInit {
  const auth = getCachedAuth();
  if (!auth) return init;
  const headers = new Headers(init.headers);
  if (headers.has("Authorization")) return init;
  headers.set("Authorization", `Bearer ${auth.token}`);
  return { ...init, headers };
}

export async function apiFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...withCachedAuth(init), signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new TimeoutError(timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  return apiFetch(url, init, timeoutMs);
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () =>
    fetchWithTimeout(`${BASE}/health`, {}, 3_000).then((r) => json<{ ok: boolean }>(r)),
  listGames: () =>
    fetchWithTimeout(`${BASE}/games`).then((r) => json<Game[]>(r)),
  getGame: (name: string) =>
    fetchWithTimeout(`${BASE}/games/${encodeURIComponent(name)}`).then((r) =>
      json<Game>(r)
    ),
  deleteGame: async (name: string): Promise<void> => {
    const res = await fetchWithTimeout(`${BASE}/games/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText} ${text}`);
    }
  },
  createGame: (
    name: string,
    seed: number,
    hero_q: number,
    hero_r: number,
    enemy_positions: EnemyPos[] = [],
    mapSize?: "small" | "medium" | "large",
    humanSlots?: number,
    enemySlots: number = 0,
  ) => {
    console.log("[api] createGame mapSize:", mapSize);
    return fetchWithTimeout(`${BASE}/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, seed, hero_q, hero_r, enemy_positions, mapSize, humanSlots, enemySlots }),
    }).then((r) => json<Game>(r));
  },
  claimLobbySeat: (name: string, seat: number, handle: string) =>
    fetchWithTimeout(`${BASE}/games/${encodeURIComponent(name)}/lobby/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seat, handle }),
    }).then((r) => json<Game>(r)),
  startLobby: (name: string) =>
    fetchWithTimeout(`${BASE}/games/${encodeURIComponent(name)}/lobby/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).then((r) => json<Game>(r)),
  logEvent: (name: string, kind: string, payload: Record<string, unknown> = {}) =>
    fetchWithTimeout(
      `${BASE}/games/${encodeURIComponent(name)}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, payload }),
      },
      5_000
    ).then((r) => json<{ id: string; kind: string; payload: unknown; created_at: string }>(r)),
  // ?after=<cursor> is the event-cursor poll (#146/#145). 0 means "the whole
  // log"; the server rejects a non-integer cursor with a 400 rather than
  // silently refetching everything.
  getEvents: (name: string, after: number) =>
    fetchWithTimeout(
      `${BASE}/games/${encodeURIComponent(name)}/events?after=${encodeURIComponent(String(after))}`
    ).then((r) => json<GameEventRow[]>(r)),
  getTiles: (name: string) =>
    fetchWithTimeout(`${BASE}/games/${encodeURIComponent(name)}/tiles`).then((r) =>
      json<TileRow[]>(r)
    ),
  // Dev Network Map telemetry (issue #51) + drop-policy heartbeat read
  // (2026-09-27): the POST body is the per-poll report; the response body
  // carries the server's current seat-presence view, so the call the client
  // already makes every poll doubles as the presence read (the server used
  // to answer 204 with no body -- an old API process still parses as null
  // below). Best-effort debug/presence data on a short timeout: it must
  // never be the reason a poll cycle stalls.
  reportTelemetry: async (name: string, report: ClientTelemetryReport): Promise<Record<string, SeatPresence> | null> => {
    const res = await fetchWithTimeout(
      `${BASE}/games/${encodeURIComponent(name)}/telemetry`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
      },
      3_000
    );
    if (!res.ok) return null;
    try {
      const body = (await res.json()) as { presence?: Record<string, SeatPresence> };
      return body.presence ?? null;
    } catch {
      return null;
    }
  },
  getTopology: (name: string) =>
    fetchWithTimeout(`${BASE}/games/${encodeURIComponent(name)}/telemetry`, {}, 3_000).then((r) =>
      json<NetworkTopologySnapshot>(r)
    ),
  // Manual-arena action stream (plan/2026-09-27-manual-battle-wiring.md,
  // work item 4b): one row per arena action, written to the server's
  // battle_actions table as it happens. Same fire-and-forget posture as
  // reportTelemetry above -- short timeout, every failure swallowed into a
  // `false` return (the caller logs it at most), because a dropped telemetry
  // row must never block or fail the arena. v1 validates nothing here and
  // reads nothing back; the future legality-check consumer owns that half.
  postBattleAction: async (
    name: string,
    row: {
      attackerId: string;
      defenderId: string;
      seq: number;
      phase: "start" | "move" | "attack" | "retreat" | "surrender" | "spell" | "end";
      payload: Record<string, unknown>;
    },
  ): Promise<boolean> => {
    try {
      const res = await fetchWithTimeout(
        `${BASE}/games/${encodeURIComponent(name)}/battle-actions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(row),
        },
        3_000
      );
      return res.ok;
    } catch {
      return false;
    }
  },
};

// SSE event stream (plan/2026-09-28-sse-event-push.md): the URL for the
// /events/stream endpoint, whose `after` query is the same game_events.id
// cursor the poll uses (the browser replays it as Last-Event-ID on
// auto-reconnect). A plain string helper outside the api object because
// EventSource takes no RequestInit -- fetchWithTimeout's timeout/abort
// machinery has nothing to attach to.
export function eventStreamUrl(name: string, after: number): string {
  return `${BASE}/games/${encodeURIComponent(name)}/events/stream?after=${after}`;
}

