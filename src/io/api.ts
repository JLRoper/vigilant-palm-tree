import type { Axial } from "../core/hex";
import type { Terrain } from "../map/terrain";
import type { ResourceType } from "../map/resourceTiles";
import type {
  GameState,
  HeroState,
  Player,
  SettlementState,
  WarehouseResource,
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

export type EndTurnResult = {
  round: number;
  day: number;
  activePlayerId: number;
  players: Player[];
  heroes: Record<string, HeroState>;
  settlements: Record<string, SettlementState>;
};

export type ResolveBattleResult = {
  players: Player[];
  heroes: Record<string, HeroState>;
  battle: import("@heroes/engine").BattleResult;
};

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
  getTiles: (name: string) =>
    fetchWithTimeout(`${BASE}/games/${encodeURIComponent(name)}/tiles`).then((r) =>
      json<TileRow[]>(r)
    ),
};

// Server is now fully authoritative for end-turn (Phase 3 Track A Week 2):
// this no longer sends the client's GameState at all. The old route
// trusted incomingState.heroes/players wholesale and only re-ran the
// per-day production/auto-trade/consumption pipeline against them; the
// server now loads its own row and runs the full pipeline itself
// (see server/app/turnService.ts), so all this needs to carry is who's
// ending their turn and the client's population-growth preference.
export async function endTurn(
  name: string,
  actor: number,
  growthRate?: number
): Promise<EndTurnResult> {
  const res = await fetchWithTimeout(
    `${BASE}/games/${encodeURIComponent(name)}/commands`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "EndTurn", actor, growthRate }),
    }
  );
  return json<EndTurnResult>(res);
}

export async function spendMovement(
  name: string,
  payload: {
    actor: number;
    heroId: string;
    fromTile: Axial;
    toTile: Axial;
    cost: number;
  }
): Promise<HeroState> {
  const res = await fetchWithTimeout(
    `${BASE}/games/${encodeURIComponent(name)}/commands`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "MoveHero", ...payload }),
    }
  );
  const result = await json<{ hero: HeroState }>(res);
  return result.hero;
}

export async function resolveBattle(
  name: string,
  payload: { attackerId: string; defenderId: string; state: GameState }
): Promise<ResolveBattleResult> {
  const res = await fetchWithTimeout(
    `${BASE}/games/${encodeURIComponent(name)}/resolve-battle`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  return json<ResolveBattleResult>(res);
}

export type TransferGoldResult = {
  hero: HeroState;
  settlement: SettlementState;
};

export async function transferGold(
  name: string,
  payload: {
    actor: number;
    heroId: string;
    settlementId: string;
    direction: "deposit" | "withdraw";
  }
): Promise<TransferGoldResult> {
  const res = await fetchWithTimeout(
    `${BASE}/games/${encodeURIComponent(name)}/commands`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "TransferGold", ...payload }),
    }
  );
  return json<TransferGoldResult>(res);
}

export type TradeResourcesResult = {
  from: SettlementState;
  to: SettlementState;
};

export async function tradeResources(
  name: string,
  payload: {
    fromSettlementId: string;
    toSettlementId: string;
    resource: WarehouseResource;
    amount: number;
  }
): Promise<TradeResourcesResult> {
  const res = await fetchWithTimeout(
    `${BASE}/games/${encodeURIComponent(name)}/trade`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  return json<TradeResourcesResult>(res);
}
