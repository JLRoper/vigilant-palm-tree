import type { Axial } from "../core/hex";
import type { Terrain } from "../map/terrain";
import type { ResourceType } from "../map/resourceTiles";
import type {
  GameState,
  HeroState,
  Player,
  SettlementState,
} from "../state/gameState";

export type {
  GameState,
  HeroState,
  Player,
  SettlementState,
} from "../state/gameState";

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

export type SpendMovementAction = {
  action: "spend_movement";
  heroId: string;
  fromTile: Axial;
  toTile: Axial;
  cost: number;
  settlements?: Record<string, SettlementState>;
};

export type GamePatch = LegacyGamePatch | SpendMovementAction;

export type EndTurnResult = {
  round: number;
  activePlayerId: number;
  players: Player[];
};

export type ResolveBattleResult = {
  players: Player[];
  heroes: Record<string, HeroState>;
};

const BASE = "/api";
const DEFAULT_TIMEOUT_MS = 10_000;

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`request timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

async function fetchWithTimeout(
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
): Promise<Game | HeroState> {
  const res = await fetchWithTimeout(
    `${BASE}/games/${encodeURIComponent(name)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }
  );
  if ("action" in patch && patch.action === "spend_movement") {
    return json<HeroState>(res);
  }
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
  createGame: (
    name: string,
    seed: number,
    hero_q: number,
    hero_r: number,
    enemy_positions: EnemyPos[] = []
  ) =>
    fetchWithTimeout(`${BASE}/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, seed, hero_q, hero_r, enemy_positions }),
    }).then((r) => json<Game>(r)),
  patchGame: ((name: string, patch: GamePatch) =>
    patchGameImpl(name, patch)) as {
    (name: string, patch: SpendMovementAction): Promise<HeroState>;
    (name: string, patch: LegacyGamePatch): Promise<Game>;
    (name: string, patch: GamePatch): Promise<Game | HeroState>;
  },
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

export async function endTurn(
  name: string,
  state: GameState
): Promise<EndTurnResult> {
  const res = await fetchWithTimeout(
    `${BASE}/games/${encodeURIComponent(name)}/end-turn`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    }
  );
  return json<EndTurnResult>(res);
}

export async function spendMovement(
  name: string,
  payload: {
    heroId: string;
    fromTile: Axial;
    toTile: Axial;
    cost: number;
    settlements?: Record<string, SettlementState>;
  }
): Promise<HeroState> {
  const res = await fetchWithTimeout(
    `${BASE}/games/${encodeURIComponent(name)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "spend_movement", ...payload }),
    }
  );
  return json<HeroState>(res);
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
