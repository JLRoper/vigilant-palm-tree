import type { Terrain } from "../map/terrain";
import type { ResourceType } from "../map/resourceTiles";
import type {
  ClientTelemetryReport,
  HeroState,
  NetworkTopologySnapshot,
  Player,
  SettlementState,
} from "@heroes/contracts";

export type {
  GameState,
  HeroState,
  Player,
  SettlementState,
} from "@heroes/contracts";

export type EnemyPos = { q: number; r: number };

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
};

// One row of GET /games/:name/events. Raw DB shape (snake_case, id and
// actor_seat straight off the row) -- `payload` is the persisted EngineEvent
// for the 13 EngineEvent kinds and a bespoke audit blob for the legacy
// turn_ended/round_ended/round_started/ai_turn_started kinds, so it stays
// unknown here and is narrowed at the point of use.
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

export type LegacyGamePatch = Partial<
  Pick<Game, "hero_q" | "hero_r" | "turn" | "gold" | "enemy_positions">
>;

export type GamePatch = LegacyGamePatch;

const BASE = "/api";
const DEFAULT_TIMEOUT_MS = 10_000;

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`request timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export async function apiFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
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

async function patchGameImpl(
  name: string,
  patch: GamePatch
): Promise<Game> {
  const res = await fetchWithTimeout(
    `${BASE}/games/${encodeURIComponent(name)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }
  );
  return json<Game>(res);
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
  ) => {
    console.log("[api] createGame mapSize:", mapSize);
    return fetchWithTimeout(`${BASE}/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, seed, hero_q, hero_r, enemy_positions, mapSize, humanSlots }),
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
  patchGame: (name: string, patch: GamePatch): Promise<Game> => patchGameImpl(name, patch),
  logEvent: (name: string, kind: string, payload: Record<string, unknown> = {}) =>
    fetchWithTimeout(
      `${BASE}/games/${encodeURIComponent(name)}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, payload }),
      },
      5_000
    ).then((r) => json<{ id: number; kind: string }>(r)),
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
  // Dev Network Map telemetry (issue #51). Best-effort debug data on a short
  // timeout: it must never be the reason a poll cycle stalls.
  reportTelemetry: async (name: string, report: ClientTelemetryReport): Promise<void> => {
    await fetchWithTimeout(
      `${BASE}/games/${encodeURIComponent(name)}/telemetry`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
      },
      3_000
    );
  },
  getTopology: (name: string) =>
    fetchWithTimeout(`${BASE}/games/${encodeURIComponent(name)}/telemetry`, {}, 3_000).then((r) =>
      json<NetworkTopologySnapshot>(r)
    ),
};

