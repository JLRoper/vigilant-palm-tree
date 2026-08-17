import type { Axial } from "../core/hex";
import type { Terrain } from "../map/terrain";
import type { ResourceType } from "../map/resourceTiles";
import type {
  HeroState,
  HorseVariantId,
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
  attackerHero: HeroState;
  defenderHero: HeroState;
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

// Phase 3 Track A Week 3+: ported from the old dedicated /resolve-battle
// route to the /commands bus. No longer carries the client's GameState at
// all -- the server loads its own row, its own unit_types catalog, and
// re-derives adjacency itself (see server/app/commandHandler.ts's
// ResolveBattle case) instead of trusting attackerId/defenderId wholesale.
export async function resolveBattle(
  name: string,
  payload: { actor: number; attackerId: string; defenderId: string }
): Promise<ResolveBattleResult> {
  const res = await fetchWithTimeout(
    `${BASE}/games/${encodeURIComponent(name)}/commands`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "ResolveBattle", ...payload }),
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
  fromSettlement: SettlementState;
  toSettlement: SettlementState;
};

// Phase 3 Track A Week 3+: ported from the old dedicated /trade route to
// the /commands bus.
export async function tradeResources(
  name: string,
  payload: {
    actor: number;
    fromSettlementId: string;
    toSettlementId: string;
    resource: Exclude<WarehouseResource, "food">;
    amount: number;
  }
): Promise<TradeResourcesResult> {
  const res = await fetchWithTimeout(
    `${BASE}/games/${encodeURIComponent(name)}/commands`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "TradeResources", ...payload }),
    }
  );
  return json<TradeResourcesResult>(res);
}

// The five functions below are new in Phase 3 Track A Week 3+ -- none of
// RecruitHero/UpgradeTownHall/SetAutoTrade/ReorderStack/CaptureSettlement
// had any server round-trip at all before this (see this port's PR
// description's cross-cutting finding). Each is called fire-and-forget
// from src/game/turnHooks.ts, mirroring onAiMove's existing pattern for
// MoveHero -- the response bodies are intentionally unused by the callers
// (client trusts its own already-applied local reducer result; these
// calls exist purely so the mutation also persists server-side).

export async function recruitHero(
  name: string,
  payload: { actor: number; heroName: string; settlementId: string; horseVariant: HorseVariantId }
): Promise<void> {
  const res = await fetchWithTimeout(`${BASE}/games/${encodeURIComponent(name)}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "RecruitHero", ...payload }),
  });
  await json(res);
}

export async function upgradeTownHall(
  name: string,
  payload: { actor: number; settlementId: string; targetLevel: 2 | 3 }
): Promise<void> {
  const res = await fetchWithTimeout(`${BASE}/games/${encodeURIComponent(name)}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "UpgradeTownHall", ...payload }),
  });
  await json(res);
}

export async function setAutoTrade(
  name: string,
  payload: { actor: number; settlementId: string; autoTrade: boolean }
): Promise<void> {
  const res = await fetchWithTimeout(`${BASE}/games/${encodeURIComponent(name)}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "SetAutoTrade", ...payload }),
  });
  await json(res);
}

export async function reorderStack(
  name: string,
  payload: { actor: number; heroId: string; fromIdx: number; toIdx: number }
): Promise<void> {
  const res = await fetchWithTimeout(`${BASE}/games/${encodeURIComponent(name)}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "ReorderStack", ...payload }),
  });
  await json(res);
}

export async function captureSettlement(
  name: string,
  payload: { actor: number; heroId: string; settlementId: string }
): Promise<void> {
  const res = await fetchWithTimeout(`${BASE}/games/${encodeURIComponent(name)}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "CaptureSettlement", ...payload }),
  });
  await json(res);
}

