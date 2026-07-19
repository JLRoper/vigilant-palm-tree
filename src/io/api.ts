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
};

const BASE = "/api";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => fetch(`${BASE}/health`).then((r) => json<{ ok: boolean }>(r)),
  listGames: () => fetch(`${BASE}/games`).then((r) => json<Game[]>(r)),
  getGame: (name: string) =>
    fetch(`${BASE}/games/${encodeURIComponent(name)}`).then((r) => json<Game>(r)),
  createGame: (
    name: string,
    seed: number,
    hero_q: number,
    hero_r: number,
    enemy_positions: EnemyPos[] = []
  ) =>
    fetch(`${BASE}/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, seed, hero_q, hero_r, enemy_positions }),
    }).then((r) => json<Game>(r)),
  patchGame: (
    name: string,
    patch: Partial<Pick<Game, "hero_q" | "hero_r" | "turn" | "gold" | "enemy_positions">>
  ) =>
    fetch(`${BASE}/games/${encodeURIComponent(name)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => json<Game>(r)),
  logEvent: (name: string, kind: string, payload: Record<string, unknown> = {}) =>
    fetch(`${BASE}/games/${encodeURIComponent(name)}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, payload }),
    }).then((r) => json<{ id: number; kind: string }>(r)),
};
